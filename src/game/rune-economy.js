/**
 * 룬·전운의 저장 상태와 Economy 연결점. 규칙은 rune-core·blessing-core 의 순수 함수가 정하고,
 * 여기서는 세이브(eco.s)에 결과를 반영·저장·롤백만 한다. economy.js 의 메서드는 이 함수들을 부르는 얇은 래퍼다.
 *
 * 저장 상태(R2 계약):
 * - save.runes = { bag: RuneBag, dust: 룬 가루(정수), giftClaimed: 첫 개방 선물 수령 여부, dropSeq: 룬 드랍 정산 순번 }
 * - save.blessing = normalizeBlessing(...) (blessing-core 상단 주석)
 * - 인벤토리 인스턴스 inst.sockets: normalizeSockets(등급, raw). 박힌 룬이 하나도 없으면 필드를 두지 않는다(빈 소켓과 같은 뜻).
 * 실패는 { ok: false, reason } 이고 세이브는 그대로다.
 */
import { ITEM_BY_ID, SLOTS } from '../data/items.js';
import { RUNES, RUNE_BY_ID, RUNE_FAMILY_IDS, RUNE_GRADE_LABEL, RUNE_SOURCES } from '../data/runes.js';
import { BLESSING_CHARM_GRANTS } from '../data/blessing.js';
import {
  normalizeRuneBag, normalizeSockets, maxSocketCount, insertRune, removeRune, replaceRune, mergeRunes,
  recoverOnDestroy, recoverOnSell, runeEffects,
} from './rune-core.js';
import { normalizeBlessing, roll, pick, consumeOnRunStart, addCharms, rollCost, gemRollsLeft, pityLeft } from './blessing-core.js';
import { createSeededRng, hashSeed } from '../shared/rng.js';

const MAX = Number.MAX_SAFE_INTEGER;
const record = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (/** @type {unknown} */ v, max = MAX) => (Number.isSafeInteger(v) ? Math.min(max, Math.max(0, /** @type {number} */ (v))) : 0);
const fail = (/** @type {string} */ reason) => ({ ok: /** @type {const} */ (false), reason });

/** 첫 개방 선물: 네 가문에서 RUNES 순서상 첫 룬 I 을 1개씩(결정적). */
export function giftBag() {
  /** @type {Record<string, number[]>} */
  const bag = {};
  for (const family of RUNE_FAMILY_IDS) {
    const rune = RUNES.find((r) => r.family === family);
    if (rune) bag[rune.id] = [RUNE_SOURCES.firstGift.perFamily, 0, 0];
  }
  return bag;
}

/**
 * 룬 저장 정규화. giftClaimed 가 true 가 아닌 세이브(룬 도입 전 세이브 포함)는 이때 선물을 한 번 넣고 true 로 바꾼다.
 * 여러 번 적용해도 결과가 같다(두 번째부터는 giftClaimed=true).
 */
export function normalizeRunes(/** @type {unknown} */ raw) {
  const r = /** @type {Record<string, unknown>} */ (record(raw) ? raw : {});
  let bag = normalizeRuneBag(r.bag);
  const giftClaimed = r.giftClaimed === true;
  if (!giftClaimed) {
    for (const [id, counts] of Object.entries(giftBag())) {
      const cur = bag[id] || [0, 0, 0];
      bag[id] = cur.map((n, i) => n + counts[i]);
    }
    bag = normalizeRuneBag(bag);
  }
  return { bag, dust: count(r.dust), giftClaimed: true, dropSeq: count(r.dropSeq) };
}

/** 소켓을 저장 모양으로: 박힌 룬이 없으면 undefined(필드 생략). */
function storedSockets(/** @type {string} */ grade, /** @type {unknown} */ raw) {
  const sockets = normalizeSockets(grade, raw);
  return sockets.some(Boolean) ? sockets : undefined;
}

/**
 * save-base 의 인벤토리 정규화는 { uid, id, enh } 만 남겨 sockets 를 지운다. 같은 필터 순서로 원본을 다시 읽어
 * 인덱스로 짝지어 붙인다(uid 재배정이 일어나도 순서는 같다).
 * @param {{ inventory: Array<{ uid: number, id: string, enh: number, sockets?: unknown }> }} save
 * @param {unknown} rawInventory
 */
export function restoreSockets(save, rawInventory) {
  const list = Array.isArray(rawInventory) ? rawInventory : [], seen = new Set();
  const kept = list.filter((item) => {
    if (!record(item) || !Object.hasOwn(ITEM_BY_ID, item.id) || !Number.isSafeInteger(item.uid) || item.uid < 1 || item.uid >= MAX || seen.has(item.uid)) return false;
    seen.add(item.uid); return true;
  });
  save.inventory.forEach((inst, i) => {
    const raw = kept[i];
    const sockets = raw && raw.id === inst.id ? storedSockets(ITEM_BY_ID[inst.id].rarity, raw.sockets) : undefined;
    if (sockets) inst.sockets = sockets; else delete inst.sockets;
  });
}

/** 규칙 함수용 장비 보기. */
export function gearRunes(/** @type {{ id: string, enh?: number, sockets?: unknown }} */ inst) {
  const grade = ITEM_BY_ID[inst?.id]?.rarity || 'N';
  return { grade, enh: count(inst?.enh), sockets: normalizeSockets(grade, inst?.sockets) };
}

/** eco.s.runes 를 보장한다(로드 경로 밖에서 만든 세이브 대비). */
export function runesOf(/** @type {any} */ eco) {
  if (!record(eco.s.runes) || eco.s.runes.giftClaimed !== true) eco.s.runes = normalizeRunes(eco.s.runes);
  return eco.s.runes;
}
export function blessingOf(/** @type {any} */ eco) {
  eco.s.blessing = normalizeBlessing(eco.s.blessing);
  return eco.s.blessing;
}

/**
 * 변경을 적용하고 저장한다. 저장에 실패하면 세이브 전체를 되돌린다(구매 경로와 같은 방식).
 * @template {{ ok: boolean }} T
 * @param {any} eco @param {() => T} fn
 * @returns {T | { ok: false, reason: string }}
 */
function commit(eco, fn) {
  const before = structuredClone(eco.s);
  const out = fn();
  if (!out.ok) { eco.s = before; return out; }
  if (!eco.save()) { eco.s = before; return fail('storage'); }
  for (const f of eco.listeners || []) f(eco.s);
  return out;
}

const findInst = (/** @type {any} */ eco, /** @type {number} */ uid) => eco.s.inventory.find((/** @type {any} */ x) => x.uid === uid) || null;
function writeSockets(/** @type {any} */ inst, /** @type {unknown[]} */ sockets) {
  const stored = storedSockets(ITEM_BY_ID[inst.id].rarity, sockets);
  if (stored) inst.sockets = stored; else delete inst.sockets;
}

/** 장비 소켓 조작(박기·빼기·덮어 박기) 공통. */
function socketOp(/** @type {any} */ eco, /** @type {number} */ uid, /** @type {(state: any) => any} */ rule) {
  const inst = findInst(eco, uid); if (!inst) return fail('item');
  return commit(eco, () => {
    const runes = runesOf(eco), res = rule({ item: gearRunes(inst), bag: runes.bag, gold: eco.s.gold });
    if (!res.ok) return fail(res.error);
    writeSockets(inst, res.sockets); runes.bag = res.bag; eco.s.gold = res.gold;
    return { ok: /** @type {const} */ (true), uid, sockets: normalizeSockets(ITEM_BY_ID[inst.id].rarity, inst.sockets), cost: res.cost, ...(res.removed ? { removed: res.removed } : {}) };
  });
}
export const runeInsert = (/** @type {any} */ eco, /** @type {number} */ uid, /** @type {number} */ index, /** @type {unknown} */ rune) => socketOp(eco, uid, (st) => insertRune(st, index, rune));
export const runeRemove = (/** @type {any} */ eco, /** @type {number} */ uid, /** @type {number} */ index) => socketOp(eco, uid, (st) => removeRune(st, index));
export const runeReplace = (/** @type {any} */ eco, /** @type {number} */ uid, /** @type {number} */ index, /** @type {unknown} */ rune) => socketOp(eco, uid, (st) => replaceRune(st, index, rune));

/** 합성: 같은 룬 아래 등급 3개 + 골드(+룬 가루) → 한 등급 위 1개. */
export function runeMerge(/** @type {any} */ eco, /** @type {string} */ id, /** @type {number} */ toGrade) {
  return commit(eco, () => {
    const runes = runesOf(eco), res = mergeRunes({ bag: runes.bag, gold: eco.s.gold, runeDust: runes.dust }, id, toGrade);
    if (!res.ok) return fail(res.error);
    runes.bag = res.bag; runes.dust = res.runeDust; eco.s.gold = res.gold;
    return { ok: /** @type {const} */ (true), created: res.created, cost: res.cost };
  });
}

/**
 * 장비가 사라지기 직전(판매·분해·강화 파괴) 박힌 룬을 가방으로 돌린다. 저장은 호출자 몫.
 * @returns {Array<{ id: string, grade: number }>} 회수한 룬
 */
export function recoverItemRunes(/** @type {any} */ eco, /** @type {any} */ inst, /** @type {'destroy'|'sell'} */ why = 'sell') {
  if (!inst?.sockets) return [];
  const runes = runesOf(eco), res = (why === 'destroy' ? recoverOnDestroy : recoverOnSell)({ item: gearRunes(inst), bag: runes.bag });
  runes.bag = res.bag; delete inst.sockets;
  return res.recovered;
}

/** 유니크·레전드리 분해: 룬 가루 U 10 · L 30, 박힌 룬 회수, 장착 해제. N/S/E 는 기존 salvage(uids). */
export function salvageItem(/** @type {any} */ eco, /** @type {number} */ uid) {
  const inst = findInst(eco, uid); if (!inst) return fail('item');
  const rarity = ITEM_BY_ID[inst.id]?.rarity;
  /** @type {Record<string, number>} */
  const table = RUNE_SOURCES.dismantleDust;
  if (!rarity || !Object.hasOwn(table, rarity)) return fail('rarity');
  return commit(eco, () => {
    const recovered = recoverItemRunes(eco, inst, 'sell');
    for (const hid in eco.s.heroes) { const e = eco.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; }
    eco.s.inventory.splice(eco.s.inventory.indexOf(inst), 1);
    const runes = runesOf(eco), dust = table[rarity];
    runes.dust = Math.min(MAX, runes.dust + dust);
    return { ok: /** @type {const} */ (true), uid, runeDust: dust, recovered };
  });
}

/** 장착 장비 4부위의 룬 효과(공명 포함). 출격 시작 때 한 번 계산해 캐시한다. */
export function heroRuneEffects(/** @type {any} */ eco, /** @type {string} */ heroId, /** @type {{ blessingBoonId?: string|null }} */ options = {}) {
  const h = eco.s.heroes?.[heroId]; if (!h) return {};
  const items = [];
  for (const sl of SLOTS) { const inst = findInst(eco, h.equip[sl]); if (inst?.sockets) items.push(gearRunes(inst)); }
  return items.length || options.blessingBoonId ? runeEffects(items, options) : {};
}

// ---------- 룬 드랍(출격 정산) ----------
/** 전투 중 정예·보스 처치를 필드 장부에 센다. 장부가 없거나(파티·결투) 정산이 끝났으면 무시. */
export function recordRuneKill(/** @type {any} */ eco, /** @type {any} */ stage, /** @type {'elite'|'boss'} */ rank, /** @type {string} */ heroId = eco.s.selected) {
  const ledger = eco.fieldRewardsFor(stage) || eco.beginFieldRewards(stage, heroId);
  if (!ledger || ledger.settled || (rank !== 'elite' && rank !== 'boss')) return false;
  ledger.runeKills ||= { elite: 0, boss: 0 };
  ledger.runeKills[rank] = Math.min(10000, ledger.runeKills[rank] + 1);
  return true;
}

/**
 * 처치 수와 출격 종류로 룬 드랍과 완료 상자 룬 가루를 정한다. 순수 함수(같은 seed → 같은 결과).
 * @param {{ elite?: number, boss?: number }} kills
 * @param {{ deep?: boolean, hell?: boolean, first?: boolean, win?: boolean }} kind deep=심층 원정, hell=지옥 난이도(둘 다 심층 보스 판정), first=첫 클리어(상자 가루 추가)
 * @param {number} seed
 */
export function rollRuneDrops(kills, { deep = false, hell = false, first = false, win = true } = {}, seed = 0) {
  const rng = createSeededRng(seed >>> 0), S = RUNE_SOURCES, drops = [];
  const pickId = () => RUNES[Math.floor(rng() * RUNES.length)].id;
  for (let i = 0; i < count(kills?.elite, 10000); i++) if (rng() < S.eliteDrop.chance) drops.push({ id: pickId(), grade: S.eliteDrop.grade });
  const deepBoss = deep || hell;
  for (let i = 0; i < count(kills?.boss, 10000); i++) {
    if (rng() >= (deepBoss ? S.bossDrop.deepChance : S.bossDrop.chance)) continue;
    const grade = deepBoss && rng() < S.bossDrop.deepGrade2Chance ? 2 : S.bossDrop.grade;
    drops.push({ id: pickId(), grade });
  }
  const dust = win ? (hell ? S.expeditionDust.hell : deep ? S.expeditionDust.deep : S.expeditionDust.base) + (first ? S.expeditionDust.first : 0) : 0;
  return { drops, dust };
}

/**
 * 정산 장부의 처치 수로 룬·가루를 지급한다(승리 정산 경로에서만 호출). 시드는 세이브 생성 시각과 정산 순번.
 * 저장은 호출자(정산 트랜잭션) 몫. 반환은 addRewards 와 같은 got 항목 배열.
 */
export function settleRuneDrops(/** @type {any} */ eco, /** @type {any} */ ledger, /** @type {{ deep?: boolean, hell?: boolean, first?: boolean }} */ kind = {}) {
  if (!ledger || ledger.settled) return [];
  const runes = runesOf(eco);
  runes.dropSeq = Math.min(MAX, runes.dropSeq + 1);
  const res = rollRuneDrops(ledger.runeKills || {}, { ...kind, win: true }, hashSeed('rune-drop', count(eco.s.created), runes.dropSeq));
  /** @type {any[]} */
  const got = [];
  const bag = { ...runes.bag };
  for (const d of res.drops) { const c = bag[d.id] ? [...bag[d.id]] : [0, 0, 0]; c[d.grade - 1]++; bag[d.id] = c; got.push({ k: 'rune', id: d.id, grade: d.grade, n: 1, label: `${RUNE_BY_ID[d.id].name} ${RUNE_GRADE_LABEL[d.grade]}` }); }
  runes.bag = normalizeRuneBag(bag);
  if (res.dust) { runes.dust = Math.min(MAX, runes.dust + res.dust); got.push({ k: 'runeDust', n: res.dust }); }
  return got;
}

// ---------- 전운 ----------
/** 화면용 견적: 다음 굴림 비용·남은 보석 굴림·천장까지·보관 각인. */
export function blessingQuote(/** @type {any} */ eco, /** @type {number} */ now) {
  const b = blessingOf(eco), cost = rollCost(b, now);
  return { cost, gems: eco.s.gems, affordable: cost.allowed && (cost.kind !== 'gem' || eco.s.gems >= cost.gems),
    gemRollsLeft: gemRollsLeft(b, now), pityLeft: pityLeft(b), charms: b.charms, held: b.held && { ...b.held },
    offer: b.offer && { ...b.offer, candidates: b.offer.candidates.map((c) => ({ ...c })) } };
}

/** 굴리기: 무료 → 부적 → 보석. 보석이면 차감에 성공해야만 새 상태를 저장한다. */
export function blessingRoll(/** @type {any} */ eco, /** @type {number} */ now, /** @type {unknown} */ seed) {
  const res = roll(blessingOf(eco), now, seed ?? `${count(eco.s.created)}`);
  if (!res.ok) return fail(res.error);
  if (res.paid.kind === 'gem' && !(eco.s.gems >= res.paid.gems)) return fail('gems');
  return commit(eco, () => {
    if (res.paid.kind === 'gem') eco.s.gems -= res.paid.gems;
    eco.s.blessing = res.state;
    return { ok: /** @type {const} */ (true), candidates: res.candidates, guaranteed: res.guaranteed, paid: res.paid };
  });
}

export function blessingPick(/** @type {any} */ eco, /** @type {number} */ index) {
  const res = pick(blessingOf(eco), index);
  if (!res.ok) return fail(res.error);
  return commit(eco, () => { eco.s.blessing = res.state; return { ok: /** @type {const} */ (true), held: res.held }; });
}

/**
 * 출격 시작 성공 직후에만 부른다(R5). 보관 각인을 preRunBoons 로 꺼내 비우고 저장한다.
 * boonId 는 전운 각인 id(가문 공명 +1 용, 보관이 없으면 null).
 */
export function blessingConsume(/** @type {any} */ eco) {
  const res = consumeOnRunStart(blessingOf(eco));
  const boonId = res.preRunBoons[0] || null;
  const out = commit(eco, () => { eco.s.blessing = res.state; return { ok: /** @type {const} */ (true), preRunBoons: res.preRunBoons, boonId }; });
  return out.ok ? out : { ...out, preRunBoons: /** @type {string[]} */ ([]), boonId: null };
}

/** 부적 지급(저장은 호출자 몫). 실제로 더해진 수. */
export function grantCharms(/** @type {any} */ eco, /** @type {number} */ amount) {
  const res = addCharms(blessingOf(eco), amount);
  eco.s.blessing = res.state;
  return res.added;
}

/** 일일·주간 의뢰 수령 보너스: 그 기간 첫 수령에 부적(일일 1·주간 3), 주간은 룬 가루 30도. */
export function contractBonus(/** @type {'daily'|'weekly'} */ kind) {
  return kind === 'weekly'
    ? { blessingCharm: BLESSING_CHARM_GRANTS.weeklyContract, runeDust: RUNE_SOURCES.weeklyDust }
    : { blessingCharm: BLESSING_CHARM_GRANTS.dailyContract };
}

/** 시즌 패스 무료 줄 n 단계마다 부적. */
export const passCharms = (/** @type {number} */ level) => (level > 0 && level % BLESSING_CHARM_GRANTS.passEveryLevels === 0 ? BLESSING_CHARM_GRANTS.passAmount : 0);

export { maxSocketCount, normalizeBlessing };

/** 월정액 매일 수령에 붙는 부적 수. */
export const BLESSING_MONTHLY_CHARMS = BLESSING_CHARM_GRANTS.monthlyDaily;
