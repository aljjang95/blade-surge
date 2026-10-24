/**
 * 룬 강화 규칙 — 순수 함수만 둔다. 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
 *
 * 상태 모양(R2 레인이 economy/save 에 붙일 계약):
 * - 룬 참조 RuneRef: { id: BOONS id, grade: 1|2|3 }
 * - 장비 인스턴스 inst.sockets: Array<RuneRef|null>, 길이 = maxSocketCount(장비 등급).
 *   +15 아래로 내려가도 3번째 칸의 룬은 그대로 저장되고 socketStates 에서 locked 로만 보인다.
 * - 규칙 함수에 넘기는 장비 GearRunes: { grade: 'N'|'S'|'E'|'U'|'L', enh: 강화 수치, sockets }
 * - 룬 가방 RuneBag: { [runeId]: [I 개수, II 개수, III 개수] } — 0만 있는 id 는 빠진다.
 * - 재화: gold, runeDust (정수).
 * 실패는 { ok: false, error } 이고 입력은 그대로다.
 */
import { sumEffects } from './masterworks-core.js';
import {
  RUNE_BY_ID, RUNE_FAMILY_IDS, RUNE_GRADES, RUNE_SOCKETS, RUNE_SOCKET_BONUS, RUNE_SOCKET_BONUS_ENH,
  RUNE_DUPLICATE_CAP, RUNE_MERGE_COST, RUNE_REMOVE_COST, RUNE_SYNERGIES, RUNE_SYNERGY_MIN,
} from '../data/runes.js';

/** @typedef {{ id: string, grade: number }} RuneRef */
/** @typedef {Record<string, number[]>} RuneBag */
/** @typedef {{ grade: string, enh?: number, sockets?: unknown }} GearRunes */

const MAX = 1000000;
const int = (/** @type {unknown} */ v, max = MAX) => (Number.isSafeInteger(v) ? Math.min(max, Math.max(0, /** @type {number} */ (v))) : 0);
// 재화(골드·룬 가루)는 save-base처럼 안전 정수 전체를 허용한다. MAX는 룬 개수 상한에만 쓴다.
const coin = (/** @type {unknown} */ v) => int(v, Number.MAX_SAFE_INTEGER);
const obj = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const err = (/** @type {string} */ error) => /** @type {{ ok: false, error: string }} */ ({ ok: false, error });

/** 올바른 룬 참조면 새 객체, 아니면 null. */
export function normalizeRune(/** @type {unknown} */ raw) {
  if (!obj(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (typeof r.id !== 'string' || !Object.hasOwn(RUNE_BY_ID, r.id)) return null;
  if (!RUNE_GRADES.includes(/** @type {number} */ (r.grade))) return null;
  return { id: r.id, grade: /** @type {number} */ (r.grade) };
}

/** 장비 등급의 최대 소켓 수(+15 칸 포함). 알 수 없는 등급은 0. */
export function maxSocketCount(/** @type {string} */ grade) {
  return Object.hasOwn(RUNE_SOCKETS, grade) ? RUNE_SOCKETS[grade] + RUNE_SOCKET_BONUS[grade] : 0;
}

/** 지금 효과가 살아 있는 소켓 수. +15 이상이면 E/U/L 에 1칸이 더 열린다. */
export function socketCount(/** @type {string} */ grade, /** @type {number} */ enhanceLevel = 0) {
  if (!Object.hasOwn(RUNE_SOCKETS, grade)) return 0;
  return RUNE_SOCKETS[grade] + (int(enhanceLevel) >= RUNE_SOCKET_BONUS_ENH ? RUNE_SOCKET_BONUS[grade] : 0);
}

/** 저장된 소켓 배열 정규화: 길이를 최대 소켓 수로 맞추고 잘못된 룬은 빈 칸(null)으로. */
export function normalizeSockets(/** @type {string} */ grade, /** @type {unknown} */ raw) {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: maxSocketCount(grade) }, (_, i) => normalizeRune(list[i]));
}

/** 화면·규칙용 소켓 보기: 칸마다 { index, rune, locked }. 잠긴 칸의 룬은 보존되지만 효과가 없다. */
export function socketStates(/** @type {GearRunes} */ item) {
  const open = socketCount(item.grade, item.enh);
  return normalizeSockets(item.grade, item.sockets).map((rune, index) => ({ index, rune, locked: index >= open }));
}

/** 룬 가방 정규화: 알 수 없는 id·등급·음수 제거, 0만 남은 id 는 뺀다. */
export function normalizeRuneBag(/** @type {unknown} */ raw) {
  /** @type {RuneBag} */
  const out = {};
  if (!obj(raw)) return out;
  const r = /** @type {Record<string, unknown>} */ (raw);
  for (const id of Object.keys(RUNE_BY_ID)) {
    const v = Object.hasOwn(r, id) && Array.isArray(r[id]) ? /** @type {unknown[]} */ (r[id]) : [];
    const counts = RUNE_GRADES.map((_, i) => int(v[i]));
    if (counts.some((n) => n > 0)) out[id] = counts;
  }
  return out;
}

/** 가방 안 특정 룬·등급 보유 수. */
export function bagCount(/** @type {unknown} */ bag, /** @type {string} */ id, /** @type {number} */ grade) {
  const b = normalizeRuneBag(bag);
  return Object.hasOwn(b, id) && RUNE_GRADES.includes(grade) ? b[id][grade - 1] : 0;
}

/** 가방에 delta 만큼 더한 새 가방(부족하면 null). */
function bagAdd(/** @type {RuneBag} */ bag, /** @type {RuneRef} */ rune, /** @type {number} */ delta) {
  const next = normalizeRuneBag(bag);
  const counts = next[rune.id] ? [...next[rune.id]] : [0, 0, 0];
  const value = counts[rune.grade - 1] + delta;
  if (value < 0) return null;
  counts[rune.grade - 1] = Math.min(MAX, value);
  if (counts.some((n) => n > 0)) next[rune.id] = counts;
  else delete next[rune.id];
  return next;
}

/** 박힌 룬을 빼는 골드 비용. */
export function removeCost(/** @type {unknown} */ rune) {
  const r = normalizeRune(rune);
  return r ? RUNE_REMOVE_COST[r.grade] : 0;
}

function socketTarget(/** @type {GearRunes} */ item, /** @type {number} */ index) {
  const sockets = normalizeSockets(item.grade, item.sockets);
  if (!Number.isInteger(index) || index < 0 || index >= sockets.length) return null;
  return { sockets, locked: index >= socketCount(item.grade, item.enh) };
}

/**
 * 빈 칸에 가방의 룬을 박는다(무료). 잠긴 칸에는 박을 수 없다.
 * @param {{ item: GearRunes, bag: unknown, gold?: number }} state
 * @param {number} index
 * @param {unknown} rune
 */
export function insertRune(state, index, rune) {
  const r = normalizeRune(rune); if (!r) return err('unknown');
  const t = socketTarget(state.item, index); if (!t) return err('index');
  if (t.locked) return err('locked');
  if (t.sockets[index]) return err('occupied');
  const bag = bagAdd(normalizeRuneBag(state.bag), r, -1); if (!bag) return err('bag');
  const sockets = [...t.sockets]; sockets[index] = r;
  return { ok: /** @type {const} */ (true), sockets, bag, gold: coin(state.gold), cost: 0 };
}

/**
 * 박힌 룬을 가방으로 뺀다(등급별 골드). 잠긴 칸의 룬도 뺄 수 있다.
 * @param {{ item: GearRunes, bag: unknown, gold?: number }} state
 * @param {number} index
 */
export function removeRune(state, index) {
  const t = socketTarget(state.item, index); if (!t) return err('index');
  const old = t.sockets[index]; if (!old) return err('empty');
  const cost = RUNE_REMOVE_COST[old.grade], gold = coin(state.gold);
  if (gold < cost) return err('gold');
  const bag = /** @type {RuneBag} */ (bagAdd(normalizeRuneBag(state.bag), old, 1));
  const sockets = [...t.sockets]; sockets[index] = null;
  return { ok: /** @type {const} */ (true), sockets, bag, gold: gold - cost, cost, removed: old };
}

/**
 * 덮어 박기: 기존 룬은 가방으로(빼기 비용과 같음), 새 룬은 가방에서. 잠긴 칸은 불가.
 * @param {{ item: GearRunes, bag: unknown, gold?: number }} state
 * @param {number} index
 * @param {unknown} rune
 */
export function replaceRune(state, index, rune) {
  const r = normalizeRune(rune); if (!r) return err('unknown');
  const t = socketTarget(state.item, index); if (!t) return err('index');
  if (t.locked) return err('locked');
  const old = t.sockets[index]; if (!old) return err('empty');
  if (old.id === r.id && old.grade === r.grade) return err('same');
  const cost = RUNE_REMOVE_COST[old.grade], gold = coin(state.gold);
  if (gold < cost) return err('gold');
  const taken = bagAdd(normalizeRuneBag(state.bag), r, -1); if (!taken) return err('bag');
  const bag = /** @type {RuneBag} */ (bagAdd(taken, old, 1));
  const sockets = [...t.sockets]; sockets[index] = r;
  return { ok: /** @type {const} */ (true), sockets, bag, gold: gold - cost, cost, removed: old };
}

/**
 * 합성: 같은 룬 (toGrade-1) 3개 + 골드(+룬 가루) → toGrade 1개. 100% 결정적.
 * @param {{ bag: unknown, gold?: number, runeDust?: number }} state
 * @param {string} id
 * @param {number} toGrade 2 또는 3
 */
export function mergeRunes(state, id, toGrade) {
  if (typeof id !== 'string' || !Object.hasOwn(RUNE_BY_ID, id)) return err('unknown');
  if (!Object.hasOwn(RUNE_MERGE_COST, toGrade)) return err('grade');
  const cost = RUNE_MERGE_COST[toGrade], gold = coin(state.gold), runeDust = coin(state.runeDust);
  const taken = bagAdd(normalizeRuneBag(state.bag), { id, grade: toGrade - 1 }, -cost.count);
  if (!taken) return err('materials');
  if (gold < cost.gold) return err('gold');
  if (runeDust < cost.runeDust) return err('dust');
  const bag = /** @type {RuneBag} */ (bagAdd(taken, { id, grade: toGrade }, 1));
  return { ok: /** @type {const} */ (true), bag, gold: gold - cost.gold, runeDust: runeDust - cost.runeDust,
    created: { id, grade: toGrade }, cost: { ...cost } };
}

/**
 * 장비가 사라질 때(판매·분해·강화 파괴) 박힌 룬 전부를 무료로 가방에 돌려준다. 잠긴 칸 포함.
 * @param {{ item: GearRunes, bag: unknown }} state
 */
export function recoverRunes(state) {
  const sockets = normalizeSockets(state.item.grade, state.item.sockets);
  let bag = normalizeRuneBag(state.bag);
  /** @type {RuneRef[]} */
  const recovered = [];
  for (const rune of sockets) if (rune) { bag = /** @type {RuneBag} */ (bagAdd(bag, rune, 1)); recovered.push(rune); }
  return { ok: /** @type {const} */ (true), bag, sockets: sockets.map(() => null), recovered };
}
/** 강화 실패 파괴 회수(무료). */
export const recoverOnDestroy = (/** @type {{ item: GearRunes, bag: unknown }} */ state) => recoverRunes(state);
/** 판매·분해 회수(무료). */
export const recoverOnSell = (/** @type {{ item: GearRunes, bag: unknown }} */ state) => recoverRunes(state);

/**
 * 장착 장비 전체의 소켓마다 효과가 살아 있는지 판정한다.
 * 잠긴 칸은 'locked', 같은 룬 id 3번째부터는 'duplicate'(높은 등급 → 앞 장비 → 앞 칸 순으로 2개를 살린다).
 * @param {GearRunes[]} items
 */
export function runeActivation(items) {
  /** @type {Array<{ item: number, index: number, rune: RuneRef, active: boolean, reason: null|'locked'|'duplicate' }>} */
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item, itemIndex) => {
    if (!item) return;
    for (const s of socketStates(item)) if (s.rune) out.push({ item: itemIndex, index: s.index, rune: s.rune, active: !s.locked, reason: s.locked ? 'locked' : null });
  });
  const order = out.filter((e) => e.active).sort((a, b) => b.rune.grade - a.rune.grade || a.item - b.item || a.index - b.index);
  /** @type {Record<string, number>} */
  const seen = {};
  for (const e of order) {
    seen[e.rune.id] = (seen[e.rune.id] || 0) + 1;
    if (seen[e.rune.id] > RUNE_DUPLICATE_CAP) { e.active = false; e.reason = 'duplicate'; }
  }
  return out;
}

/**
 * 살아 있는 룬을 가문별로 센다. blessingBoonId(전운 각인 1개)를 주면 그 가문에 +1.
 * @param {GearRunes[]} items
 * @param {{ blessingBoonId?: string|null }} [options]
 */
export function familyCounts(items, options = {}) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(RUNE_FAMILY_IDS.map((f) => [f, 0]));
  for (const e of runeActivation(items)) if (e.active) counts[RUNE_BY_ID[e.rune.id].family]++;
  const bless = options.blessingBoonId;
  if (typeof bless === 'string' && Object.hasOwn(RUNE_BY_ID, bless)) counts[RUNE_BY_ID[bless].family]++;
  return counts;
}

/** 켜진 공명: 두 가문 각 RUNE_SYNERGY_MIN(2)개 이상. */
export function runeSynergies(/** @type {Record<string, number>} */ counts) {
  return RUNE_SYNERGIES.filter((s) => s.families.every((f) => (counts?.[f] || 0) >= RUNE_SYNERGY_MIN));
}

/**
 * 장착 장비들의 룬 효과 합계(공명 포함). rank = grade, 같은 룬 2개 상한, 잠긴 칸 제외,
 * 상한 규칙은 masterworks-core 의 sumEffects 와 같다.
 * 전운 각인의 효과 자체는 preRunBoons 쪽에서 더하고, 여기서는 가문 공명 수에만 +1로 반영한다.
 * @param {GearRunes[]} items
 * @param {{ blessingBoonId?: string|null }} [options]
 */
export function runeEffects(items, options = {}) {
  const parts = runeActivation(items).filter((e) => e.active).map((e) =>
    Object.fromEntries(Object.entries(RUNE_BY_ID[e.rune.id].effects).map(([k, v]) => [k, v * e.rune.grade])));
  return sumEffects([...parts, ...runeSynergies(familyCounts(items, options)).map((s) => s.effects)]);
}
