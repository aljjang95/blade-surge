// 클리어 루프(docs/CLEAR_LOOP.md): 던전 클리어 직후 카드 보상 선택 · 무기 내구도와 수리. 순수 규칙이다.
// 대표님 2026-10-29 실기기 피드백: "장비 몇 개 얻었다보다 3장 중 1장 고르는 보상, 한 판 완수 느낌", "수리로 무기 애착", "재화를 금방 쓸 곳(인플레 방지)".
// - 카드는 난수를 소비하지 않고 저장 상태(관문·판 수·영웅·장비 순번)의 해시로 정한다. 그래서 클라이언트와 서버(applySettlement → completeStage)가
//   같은 카드를 만들고, 기존 정산의 난수 순서(필드 장비·강화)를 바꾸지 않는다.
// - 내구도는 무기만. 깨지지 않고 공격력만 조금 내려간다(초보 불이익 최소). 수리 골드는 강화 단계에 따라 커져 후반 골드 소모처가 된다.
import { createSeededRng, hashSeed } from '../shared/rng.js';
import { ITEM_POOL, RARITY_INFO, SLOTS } from '../data/items.js';
import { enhanceCost } from '../data/enhance.js';

// ---------- 카드 보상 ----------
/** 카드 희귀도: 가중치·배율. 배율은 관문 기본 골드(stage.rewards.gold) 대비 카드 가치다. */
export const CARD_TIERS = Object.freeze({
  common: Object.freeze({ id: 'common', name: '일반', weight: 56, mul: 0.5 }),
  rare: Object.freeze({ id: 'rare', name: '희귀', weight: 30, mul: 0.8 }),
  epic: Object.freeze({ id: 'epic', name: '영웅', weight: 11, mul: 1.2 }),
  legend: Object.freeze({ id: 'legend', name: '전설', weight: 3, mul: 2 }),
});
export const CARD_TIER_ORDER = Object.freeze(['common', 'rare', 'epic', 'legend']);
/** 카드 종류. repair 는 착용 무기가 닳았을 때만 후보가 된다. scroll 은 영웅·전설에서만. */
export const CARD_KINDS = Object.freeze(['gold', 'stones', 'gear', 'fragments', 'repair', 'scroll']);
const GEAR_RARITY = Object.freeze({ common: 'S', rare: 'E', epic: 'E', legend: 'U' });
const STONE_N = Object.freeze({ common: 2, rare: 3, epic: 5, legend: 8 });
const FRAGMENT_N = Object.freeze({ common: 5, rare: 10, epic: 18, legend: 35 });
export const CARD_COUNT = 3;
/** sim-90d 모형: 고른 카드의 기댓값. 골드 카드 평균(관문 골드 × 약 1.14)을 고를 확률 약 절반 + 강화석 카드 몫. */
export const CLEAR_CARD_SIM = Object.freeze({ goldShare: 0.55, stones: 1 });

const pickTier = (rng, floor = 0) => {
  const list = CARD_TIER_ORDER.slice(floor), total = list.reduce((n, id) => n + CARD_TIERS[id].weight, 0);
  let r = rng() * total;
  for (const id of list) { r -= CARD_TIERS[id].weight; if (r < 0) return id; }
  return list[list.length - 1];
};

/**
 * 카드 3장을 만든다(같은 입력 = 같은 카드).
 * @param {{ seed: string, gold: number, ch: number, first?: boolean, boss?: boolean, il?: number, weaponWorn?: boolean }} ctx
 *  gold = 관문 기본 골드, il = 장비 레벨(dropItemLevel), weaponWorn = 착용 무기 내구도가 100 미만인지
 */
export function rollClearCards({ seed, gold, ch, first = false, boss = false, il = 0, weaponWorn = false }) {
  const rng = createSeededRng(hashSeed('clear-card', seed));
  const base = Math.max(100, Math.floor(Number(gold) || 0));
  const kinds = ['gold', 'stones', 'gear', 'fragments', ...(weaponWorn ? ['repair'] : [])];
  const cards = [];
  const used = new Set();
  for (let i = 0; i < CARD_COUNT; i++) {
    // 첫 클리어·보스 관문은 가운데 카드가 희귀 이상(한 판 완수 보상감). 나머지는 가중치대로.
    const tier = pickTier(rng, (first || boss) && i === 1 ? 1 : 0);
    let pool = kinds.filter((k) => !used.has(k));
    if (tier === 'epic' || tier === 'legend') pool = [...pool, ...(used.has('scroll') ? [] : ['scroll'])];
    const kind = pool[Math.floor(rng() * pool.length)];
    used.add(kind);
    cards.push(makeCard(kind, tier, { base, ch, il, rng }));
  }
  return cards;
}

function makeCard(kind, tier, { base, ch, il, rng }) {
  const t = CARD_TIERS[tier];
  if (kind === 'gold') return { kind, tier, gold: Math.round(base * t.mul * 1.6 / 10) * 10 };
  if (kind === 'stones') {
    // 5장부터 중급 강화석을 섞는다(그 단계의 강화에 실제로 쓰는 재료).
    const key = ch >= 5 ? 'stones2' : 'stones';
    return { kind, tier, key, n: key === 'stones2' ? Math.max(1, Math.ceil(STONE_N[tier] / 2)) : STONE_N[tier] };
  }
  if (kind === 'fragments') return { kind, tier, n: FRAGMENT_N[tier] };
  if (kind === 'repair') return { kind, tier, gold: Math.round(base * t.mul * 0.6 / 10) * 10 };   // 무료 완전 수리 + 약간의 골드
  if (kind === 'scroll') return { kind, tier, key: tier === 'legend' ? 'protect' : 'bless', n: 1 };
  // gear: 부위와 장비를 해시 난수로 고른다(addItem 의 난수를 쓰지 않는다).
  const rarity = GEAR_RARITY[tier], slot = SLOTS[Math.floor(rng() * SLOTS.length)];
  const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
  const def = pool.length ? pool[Math.floor(rng() * pool.length)] : ITEM_POOL[slot][0];
  return { kind, tier, id: def.id, slot, rarity: def.rarity, ...(il > 1 ? { il } : {}) };
}

/** 저장된 카드 상태 정규화. 형태가 틀리면 null(카드 없음). */
export function normalizeClearCard(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.length > 80 || !Array.isArray(raw.cards) || raw.cards.length !== CARD_COUNT) return null;
  const cards = raw.cards.map((c) => (c && typeof c === 'object' && CARD_KINDS.includes(c.kind) && CARD_TIERS[c.tier] ? { ...c } : null));
  if (cards.some((c) => !c)) return null;
  const picked = Number.isInteger(raw.picked) && raw.picked >= 0 && raw.picked < CARD_COUNT ? raw.picked : null;
  return { id: raw.id, heroId: typeof raw.heroId === 'string' ? raw.heroId : '', cards, picked };
}

// ---------- 무기 내구도·수리 ----------
export const DUR_MAX = 100;
/** 캠페인 승리 한 판의 마모(보스 관문은 조금 더). 약 15판(하루 플레이 한두 세션)에 50 아래로 내려간다. */
export const DUR_WEAR = Object.freeze({ win: 3, boss: 5 });
/** 내구도 구간별 무기 공격력 배율: 깨지지 않고 성능만 소폭 감소. */
export const DUR_STEPS = Object.freeze([{ min: 50, mul: 1, label: '양호' }, { min: 25, mul: 0.96, label: '무뎌짐' }, { min: 1, mul: 0.92, label: '많이 닳음' }, { min: 0, mul: 0.88, label: '수리 필요' }]);
export const durOf = (inst) => (Number.isInteger(inst?.dur) && inst.dur >= 0 && inst.dur < DUR_MAX ? inst.dur : DUR_MAX);
export const durStep = (dur) => DUR_STEPS.find((s) => dur >= s.min) || DUR_STEPS[DUR_STEPS.length - 1];
/** 무기 공격력 배율(내구도 필드가 없으면 1). */
export const durMul = (inst) => durStep(durOf(inst)).mul;
/**
 * 완전 수리(0 → 100) 골드: 등급 판매가의 30% + 그 단계 강화 비용의 60%.
 * 강화가 높을수록 비싸서(강화 몫만 +10 약 2,070, +15 약 7,680 골드) 후반 골드 잔액을 꾸준히 빨아들인다.
 */
export function repairFullCost(inst, rarity) {
  const sell = RARITY_INFO[rarity]?.sell || 200, enh = Math.max(0, Math.min(20, Number(inst?.enh) || 0));
  return Math.max(100, Math.round((sell * 0.3 + enhanceCost(enh) * 0.6) / 10) * 10);
}
/** 지금 내구도에서 100까지 수리 골드(닳은 만큼만, 10골드 단위 올림). 닳지 않았으면 0. */
export function repairCost(inst, rarity) {
  const missing = DUR_MAX - durOf(inst);
  return missing <= 0 ? 0 : Math.max(10, Math.ceil(repairFullCost(inst, rarity) * missing / DUR_MAX / 10) * 10);
}
/** 한 판 마모를 적용한 새 내구도. */
export const wornDur = (inst, boss) => Math.max(0, durOf(inst) - (boss ? DUR_WEAR.boss : DUR_WEAR.win));
