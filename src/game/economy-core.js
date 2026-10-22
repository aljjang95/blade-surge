// 서버(Cloudflare Worker)·bun·브라우저에서 같은 경제 규칙을 돌리는 저장 분리 코어.
import { Economy } from './economy.js';

/**
 * 프로세스 메모리 저장소. localStorage와 같은 getItem/setItem/removeItem 모양이며 전역 저장소를 건드리지 않는다.
 * @returns {{ getItem(key: string): string|null, setItem(key: string, value: string): void, removeItem(key: string): void }}
 */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/**
 * 키를 정렬한 정규 JSON. JSON.stringify와 같은 값 규칙(undefined·함수 생략, 비유한 수는 null)을 따른다.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (typeof (/** @type {any} */ (value)).toJSON === 'function') return canonicalJson((/** @type {any} */ (value)).toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const item = /** @type {Record<string, unknown>} */ (value)[key];
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * 순수 동기 64비트 해시(cyrb53 계열 두 32비트 레인). 브라우저·bun·workerd에서 같은 16자리 hex를 낸다.
 * 암호학적 해시가 아니다. 클라이언트·서버 상태 불일치 감지용이다.
 * @param {string} text
 * @returns {string}
 */
export function stableHash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * 저장소 없이 돌아가는 경제 규칙 클래스 (docs/MMO_DESIGN.md 5장 P1-C `EconomyCore`).
 *
 * 이름은 설계서의 P1-C를 따르지만 규칙 본문은 economy.js의 `Economy`에 그대로 둔다.
 * 다른 레인이 economy.js를 동시에 고치는 동안 큰 이동으로 충돌을 만들지 않으려는 선택이며,
 * 여기서는 저장소·시계·난수만 주입형으로 바꾼다.
 * - 저장: 메모리 저장소만 쓰며 `save()`는 전역 저장소를 건드리지 않고 항상 성공한다.
 * - 시계: `now`(ms)를 주입한다. 에너지 회복·일/주 경계·월정액·VIP가 모두 이 시계를 따른다.
 * - 난수: `rng`는 강화·드랍 등 규칙 난수, `gachaRng`는 소환 난수다. 서버는 `cryptoRng()`를 넣는다.
 */
export class EconomyCore extends Economy {
  /** @param {ConstructorParameters<typeof Economy>[0]} [options] */
  constructor(options = {}) {
    super({ ...options, storage: options.storage || createMemoryStorage() });
  }

  /**
   * 세이브 문서로 코어를 만든다. 입력은 복제한 뒤 로드 경로와 같은 `normalizeSave` 마이그레이션을 거친다.
   * 생성자처럼 주입 시계로 에너지 회복(tickEnergy)까지 반영한다. state가 객체가 아니면 새 계정 상태로 시작한다.
   * @param {unknown} state
   * @param {{ rng?: () => number, now?: () => number, gachaRng?: () => number, gachaSeed?: number }} [options]
   * @returns {EconomyCore}
   */
  static fromState(state, { rng, now, gachaRng, gachaSeed } = {}) {
    const core = new this({ rng, now, gachaRng, gachaSeed });
    if (state && typeof state === 'object') {
      core.s = core.migrate(structuredClone(state));
      core.hasStoredSave = true;
      core.tickEnergy();
    }
    core._lastGoodSave = null;
    core.storageStatus = 'ready';
    return core;
  }

  /** 전역 저장소에 쓰지 않는다. 직렬화 비용도 들이지 않고 항상 성공한다. */
  save() {
    this.storageStatus = 'ready';
    return true;
  }

  /** 현재 상태의 깊은 복제(일반 JSON 객체). 서버 문서 저장·응답에 쓴다. */
  snapshot() {
    return JSON.parse(JSON.stringify(this.s));
  }

  /** 키 정렬 정규 JSON의 64비트 해시(16자리 hex). 클라이언트·서버 상태 비교용. */
  stateHash() {
    return stableHash(canonicalJson(this.s));
  }
}
