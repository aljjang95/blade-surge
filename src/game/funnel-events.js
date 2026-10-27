// 로컬 전용 퍼널 계측 링 버퍼. 네트워크 전송·DOM 접근·세이브 원문 저장이 없다.
// 이벤트 이름과 payload 키는 고정 스키마로만 허용하며 자유 문자열·개인정보는 저장하지 않는다.
// 결제 "성공" 이벤트(purchase_verified)는 서버 verify가 granted를 돌려준 뒤에만 기록한다. 시트 열림·구매 시도·취소·대기는 성공이 아니다.
// 구매 토큰·주문 ID는 어떤 이벤트에도 넣지 않는다.
import { SKUS, SHOP_TABS } from '../data/shop.js';
import { HERO_ORDER } from '../data/heroes.js';
import { HERO_LEGACY_IDS } from '../data/hero-roster.js';
import { IAP_PRODUCTS, HERO_ALL_PRODUCT_ID, heroProductId } from '../shared/iap-catalog.js';

export const FUNNEL_STORAGE_KEY = 'bladesurge_funnel_v1';
export const FUNNEL_DEFAULT_CAP = 200;
export const FUNNEL_MAX_CAP = 500;
export const FUNNEL_MAX_AGE_MS = 30 * 86400000;
// 비정상적으로 큰 저장값은 파싱하지 않고 버린다.
const MAX_RAW_CHARS = 128 * 1024;

// 영웅 구매 화면 sku 는 서버 카탈로그(영웅 개별 hero_<id>_v1 + 전원 해금)에서 파생한다.
const HERO_SKU_IDS = Object.freeze([...HERO_ORDER.map(heroProductId), HERO_ALL_PRODUCT_ID].filter((id) => IAP_PRODUCTS.some((p) => p.id === id)));
const SKU_IDS = Object.freeze([...SKUS.map((sku) => sku.id), ...HERO_SKU_IDS]);
const TAB_IDS = Object.freeze(SHOP_TABS.map((tab) => tab.id));

const int = (min, max) => (v) => Number.isSafeInteger(v) && v >= min && v <= max;
const oneOf = (values) => (v) => typeof v === 'string' && values.includes(v);
const bool = (v) => typeof v === 'boolean';

// 각 이벤트: required/optional 키 → 검증 함수. 목록에 없는 키는 모두 거부한다.
const SCHEMA = Object.freeze({
  // 세션 시작 표식. main이 직전 session_start 시각으로 first_run/return_session을 판단한다.
  session_start: { required: {}, optional: {} },
  first_run: { required: {}, optional: {} },
  tutorial_step: { required: { step: int(0, 50) }, optional: {} },
  tutorial_complete: { required: { steps: int(0, 50) }, optional: { skipped: bool } },
  heal_hint_shown: { required: { tier: oneOf(['early', 'critical']) }, optional: {} },
  auto_retry_selected: { required: {}, optional: {} },
  reward_claim: {
    required: { source: oneOf(['daily', 'pass_free', 'quest', 'stage', 'achievement', 'offline', 'expedition', 'journey', 'mail']) },
    optional: { day: int(1, 31) },
  },
  gacha_view: { required: {}, optional: { pity: int(0, 80) } },
  gacha_pull: {
    required: { count: (v) => v === 1 || v === 10, currency: oneOf(['gems', 'tickets', 'ssr_ticket']) },
    optional: { pityBefore: int(0, 80), ssr: int(0, 10), sr: int(0, 10), dupes: int(0, 10) },
  },
  upgrade: {
    required: { kind: oneOf(['hero_level', 'hero_star', 'skill', 'item_enhance']) },
    optional: { level: int(0, 200), success: bool },
  },
  // 사냥 EXP로 저절로 오른 레벨. 사용자가 누른 강화(upgrade)와 섞이지 않게 따로 센다.
  hero_level_up: {
    required: { source: oneOf(['combat', 'stage']), level: int(1, 200) },
    optional: {},
  },
  shop_view: { required: { tab: oneOf(TAB_IDS) }, optional: {} },
  // 결제 시트 "열림"만 기록한다. 성공은 purchase_verified(서버 검증 뒤)로만 남긴다.
  paysheet_open: { required: { sku: oneOf([...SKU_IDS, 'pass']) }, optional: {} },
  // 서버가 영수증을 검증하고 지급(granted)했을 때만 기록한다. 토큰·금액은 넣지 않는다.
  purchase_verified: { required: { sku: oneOf([...SKU_IDS, 'pass']) }, optional: {} },
  // 보석으로 영웅을 무료 해금한 순간(서버 결제 아님). step 은 지금까지 무료로 연 영웅 수.
  hero_unlock_free: { required: { hero: oneOf(HERO_LEGACY_IDS), step: int(0, 50) }, optional: {} },
  return_session: { required: { gapDays: int(0, 3650) }, optional: {} },
  // 세계관 연출(docs/WORLD_BIBLE.md 6장). 장면 view/skip/done/replay 와 도감 탭 열람. 로컬 기록만 하고 서버 전송 목록에는 넣지 않는다.
  lore_scene: { required: { ch: int(1, 20), act: oneOf(['view', 'skip', 'done', 'replay']) }, optional: { line: int(0, 10) } },
  codex_open: { required: { tab: oneOf(['region', 'boss', 'monster', 'hero']) }, optional: {} },
});

/**
 * 서버 검증 완료 이벤트(purchase_verified)의 sku. 영웅 상품은 진입 이벤트(paysheet_open)와 같은 상품 id(hero_<id>_v1)를 쓰고,
 * 나머지는 상점 sku(shopSku)를 쓴다. 카탈로그 shopSku(hero_mage·hero_all)는 스키마가 받지 않아 완료 이벤트가 버려졌다.
 */
export function funnelSkuFor({ productId, shopSku }) {
  return HERO_SKU_IDS.includes(productId) ? productId : (shopSku ?? productId ?? null);
}

export const FUNNEL_EVENTS = Object.freeze(Object.keys(SCHEMA));

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 이벤트 이름/payload를 검증하고 정규화된 payload 사본을 돌려준다.
 * @param {unknown} name
 * @param {unknown} [payload]
 * @returns {{ ok: true, payload: Record<string, number | boolean | string> } | { ok: false, reason: string }}
 */
export function validateFunnelEvent(name, payload = {}) {
  if (typeof name !== 'string' || !Object.hasOwn(SCHEMA, name)) return { ok: false, reason: 'unknown_event' };
  if (!isRecord(payload) || Object.getPrototypeOf(payload) !== Object.prototype && Object.getPrototypeOf(payload) !== null) {
    return { ok: false, reason: 'invalid_payload' };
  }
  const spec = SCHEMA[name], out = {};
  for (const key of Object.keys(payload)) {
    const check = Object.hasOwn(spec.required, key) ? spec.required[key] : Object.hasOwn(spec.optional, key) ? spec.optional[key] : null;
    if (!check) return { ok: false, reason: 'unknown_key:' + key.slice(0, 32) };
    if (!check(payload[key])) return { ok: false, reason: 'invalid_value:' + key };
    out[key] = payload[key];
  }
  for (const key of Object.keys(spec.required)) if (!Object.hasOwn(out, key)) return { ok: false, reason: 'missing_key:' + key };
  return { ok: true, payload: out };
}

function defaultStorage() {
  try { const s = globalThis.localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}

/**
 * @typedef {{ n: string, t: number, s: number, p: Record<string, number | boolean | string> }} FunnelRecord
 * @param {{ storage?: { getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem?(k: string): void } | null, now?: () => number, cap?: number, maxAgeMs?: number, key?: string }} [options]
 */
export function createFunnelLog(options = {}) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const cap = Number.isSafeInteger(options.cap) ? Math.max(1, Math.min(FUNNEL_MAX_CAP, /** @type {number} */ (options.cap))) : FUNNEL_DEFAULT_CAP;
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && /** @type {number} */ (options.maxAgeMs) > 0 ? /** @type {number} */ (options.maxAgeMs) : FUNNEL_MAX_AGE_MS;
  const key = typeof options.key === 'string' && options.key ? options.key : FUNNEL_STORAGE_KEY;
  /** @type {FunnelRecord[] | null} */ let memory = null;

  // 초 단위로 낮춘 시각. 비정상 시계는 0으로 둔다.
  const clock = () => { const t = Number(now()); return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) * 1000 : 0; };

  // 저장소 값은 신뢰하지 않는다. 레코드마다 스키마를 다시 통과시킨다.
  function load() {
    if (memory) return memory;
    let parsed = [];
    try {
      const raw = storage ? storage.getItem(key) : null;
      if (typeof raw === 'string' && raw.length <= MAX_RAW_CHARS) { const v = JSON.parse(raw); if (Array.isArray(v)) parsed = v; }
    } catch { parsed = []; }
    const clean = [];
    for (const r of parsed) {
      if (!isRecord(r) || !Number.isSafeInteger(r.t) || r.t < 0 || !Number.isSafeInteger(r.s) || r.s < 1) continue;
      const v = validateFunnelEvent(r.n, isRecord(r.p) ? r.p : {});
      if (v.ok) clean.push({ n: /** @type {string} */ (r.n), t: r.t, s: r.s, p: v.payload });
    }
    clean.sort((a, b) => a.s - b.s);
    memory = clean;
    return memory;
  }

  // 개수·기간 한도를 적용하되, 가장 최근 session_start 한 건은 보존해 복귀 간격을 계산할 수 있게 한다.
  function prune(list, at) {
    const fresh = at > 0 ? list.filter((r) => at - r.t <= maxAgeMs) : list;
    let kept = fresh.length > cap ? fresh.slice(fresh.length - cap) : fresh;
    const session = lastSession(list);
    if (session && cap >= 2 && !kept.includes(session)) {
      kept = [session, ...(kept.length >= cap ? kept.slice(kept.length - (cap - 1)) : kept)];
    }
    return kept;
  }

  function lastSession(list) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].n === 'session_start') return list[i];
    return null;
  }

  function persist(list) {
    if (!storage) return false;
    try { storage.setItem(key, JSON.stringify(list)); return true; } catch { return false; }
  }

  return {
    cap,
    /**
     * @param {unknown} name
     * @param {unknown} [payload]
     * @returns {{ ok: true, persisted: boolean, record: FunnelRecord } | { ok: false, reason: string }}
     */
    track(name, payload = {}) {
      try {
        const v = validateFunnelEvent(name, payload);
        if (!v.ok) return v;
        const list = load(), at = clock();
        const last = list.length ? list[list.length - 1].s : 0;
        const record = { n: /** @type {string} */ (name), t: at, s: last + 1, p: v.payload };
        memory = prune([...list, record], at);
        return { ok: true, persisted: persist(memory), record: { ...record, p: { ...record.p } } };
      } catch {
        return { ok: false, reason: 'internal_error' };
      }
    },
    /** @returns {FunnelRecord[]} */
    read() {
      try { return prune(load(), clock()).map((r) => ({ ...r, p: { ...r.p } })); } catch { return []; }
    },
    /**
     * 가장 최근 session_start 기록 사본. 새 세션을 기록하기 전에 호출하면 직전 세션이 된다.
     * @returns {FunnelRecord | null}
     */
    latestSession() {
      try { const r = lastSession(prune(load(), clock())); return r ? { ...r, p: { ...r.p } } : null; } catch { return null; }
    },
    clear() {
      memory = [];
      try { if (storage && typeof storage.removeItem === 'function') storage.removeItem(key); } catch {}
    },
  };
}

/**
 * 앱 시작 시 기록할 퍼널 이벤트를 정한다. 세이브는 첫 행동 뒤에야 생기므로
 * 세이브가 없어도 이전 session_start가 있으면 같은 신규 사용자의 새로고침이다.
 * @param {{ hasStoredSave: boolean, previousSession: { t: number } | null, now: number }} input
 * @returns {Array<[string, Record<string, number>]>}
 */
export function sessionOpenEvents({ hasStoredSave, previousSession, now }) {
  const events = [];
  if (!hasStoredSave && !previousSession) events.push(['first_run', {}]);
  else if (previousSession && Number.isFinite(previousSession.t)) {
    const gapDays = Math.floor((now - previousSession.t) / 86400000);
    if (gapDays >= 1) events.push(['return_session', { gapDays: Math.min(3650, gapDays) }]);
  }
  events.push(['session_start', {}]);
  return events;
}
