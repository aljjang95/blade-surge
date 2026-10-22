// 상태 해시: 브라우저·bun·workerd에서 같은 값을 내는 순수 동기 해시(정렬 키 JSON + 53비트 cyrb53 2회).
// 그림자 모드 패리티는 시계·기기 의존 필드(에너지 시각, 로컬 설정, 도감 기록 등)를 뺀 경제 부분만 비교한다.

/** 키를 정렬한 JSON. undefined·함수는 JSON.stringify와 같이 생략한다. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== 'function').sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/** 22자 base36 해시. 보안용이 아니라 동일성 확인용이다. */
export function hashText(text) { return cyrb53(text, 0) + cyrb53(text, 0x9e3779b9); }
export function hashValue(value) { return hashText(canonicalJson(value)); }

/** 패리티 비교 대상: 서버가 정본으로 지는 경제·진행 필드. */
export const PARITY_KEYS = Object.freeze([
  'gold', 'gems', 'tickets', 'ssrTickets', 'sweep', 'stones', 'stones2', 'stones3', 'fragments', 'protect', 'bless',
  'transcendStones', 'skillResets', 'heroes', 'selected', 'inventory', 'invSeq', 'avatars', 'progress', 'pass',
  'daily', 'mail', 'quests', 'gacha', 'pity', 'totalPulls', 'monthlyClaimed',
]);
export function paritySubset(state) {
  const out = {};
  for (const key of PARITY_KEYS) if (state && state[key] !== undefined) out[key] = state[key];
  return out;
}
export function parityHash(state) { return hashValue(paritySubset(state)); }

/**
 * 서버 권위 계정에서 서버 문서가 덮어쓰는 필드(P1 범위). 설정·튜토리얼·원정·마을·여정 등 아직 서버 명령이 없는
 * 필드는 로컬 값을 유지한다. 그래서 서버 권위 컷오버(V1_SERVER_AUTHORITY_PERCENT)는 해당 시스템이 서버로 옮겨진 뒤에 연다.
 */
export const SERVER_OWNED_KEYS = Object.freeze([...PARITY_KEYS, 'energy', 'energyT']);
export function mergeServerOwned(local, server) {
  const out = { ...local };
  for (const key of SERVER_OWNED_KEYS) if (server && server[key] !== undefined) out[key] = server[key];
  return out;
}
