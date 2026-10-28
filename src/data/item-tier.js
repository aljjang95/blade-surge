// 고통 단계 장비 파워 — docs/SPEC_720H.md 3.2. 장비 인스턴스의 tp(드랍된 고통 단계, 1~50)가 스탯 배율 1 + itemPowerStep·tp 를 만든다.
// 기존 장비·저장은 tp 가 없어 배율 1이다(마이그레이션 없음). items.js 의 itemStats 를 감싸는 얇은 층이라 items.js(렌더 매니페스트가 해시를 고정)는 건드리지 않는다.
import { itemStats as baseItemStats, ITEM_BY_ID, SLOT_BASE, enhanceUnits } from './items.js';
import { TORMENT } from './content-90d.js';

/** 고통 단계 장비 파워 배율. tp 가 양의 정수가 아니면 1. */
export const itemTierMul = (tp) => Number.isSafeInteger(tp) && tp > 0 ? 1 + TORMENT.itemPowerStep * Math.min(TORMENT.maxTier, tp) : 1;
// 스테이지 장비 레벨(il): 필드 드랍이 나온 스테이지의 권장 레벨(loot-tables.js dropItemLevel). 후반 드랍이 초반 +8 장비를 넘게 한다.
// 깊은 스테이지 장비는 "미리 단련된" 채로 나온다: 강화 단위(enhanceUnits)에 il 보너스 단위를 더해 슬롯 기준치의 평평한 보너스로 붙는다(배율이 아니라 가산).
//  · 보너스 단위 = min(ILU_MAX, ILU_STEP·(il-1)) × 등급 계수(N .4 · S .6 · E .8 · U .9 · L 1)
//  · 직접 강화가 쌓일수록 줄어든다: × max(0, 1 − 강화단위/ILU_FADE). 고강화 장비·90일 성장 곡선(sim:90d 밴드)은 거의 그대로이고, 낮은 강화의 새 드랍만 앞선다.
// il 이 없는 기존 장비·가챠·제작 장비는 보너스가 없어 능력치가 그대로다. 고통 단계 장비(tp)는 자기 배율이 있어 il 을 달지 않는다.
// 소수는 한 자리로 굳혀 클라이언트·서버(V8) 어디서든 같은 정수 능력치가 나오게 한다(곱셈·덧셈만 쓴다).
export const ITEM_LEVEL_MAX = 80;
export const ILU_STEP = 0.45, ILU_MAX = 16, ILU_FADE = 24;   // ILU_MAX < ILU_FADE 여야 강화가 언제나 능력치를 올린다. 이보다 세면 sim:90d 룬 전투력 밴드(미드 D90 ≤35)를 넘는다(2026-10-28 실측).
const ILU_RARITY = Object.freeze({ N: 0.4, S: 0.6, E: 0.8, U: 0.9, L: 1 });
const ILU_TABLE = Object.freeze(Array.from({ length: ITEM_LEVEL_MAX + 1 }, (_, il) => il <= 1 ? 0 : Math.round(Math.min(ILU_MAX, ILU_STEP * (il - 1)) * 10) / 10));
export const validItemLevel = (il) => (Number.isSafeInteger(il) && il > 1 ? Math.min(ITEM_LEVEL_MAX, il) : 0);
/** il·등급·현재 강화 단위로 계산한 보너스 강화 단위(0 이상). */
export const itemLevelUnits = (il, rarity, enhUnits = 0) => {
  const base = ILU_TABLE[validItemLevel(il)] ?? 0;
  if (!base) return 0;
  return Math.round(base * (ILU_RARITY[rarity] ?? 0.6) * Math.max(0, 1 - enhUnits / ILU_FADE) * 100) / 100;
};
/** 장비 이름 앞에 붙는 고대·태고 접두(고통 단계 장비). 없으면 ''. */
export const itemTierPrefix = (tp) => (Number.isSafeInteger(tp) ? TORMENT.itemPrefixes.find((p) => tp >= p.from)?.name : '') || '';

/** 장비 하나의 능력치(강화·등급 규칙은 items.js itemStats 그대로) × 고통 단계 파워. 치명은 장비 고유값이라 배율이 없다. */
export function itemStats(inst) {
  const base = baseItemStats(inst), t = itemTierMul(inst.tp);
  const def = inst.tp > 0 ? null : validItemLevel(inst.il) ? ITEM_BY_ID[inst.id] : null;
  const units = def ? itemLevelUnits(inst.il, def.rarity, enhanceUnits(inst.enh || 0)) : 0;
  const sb = def ? SLOT_BASE[def.slot] : null;
  // il 보너스: 슬롯 기준치 × 단위 × 0.6(공격·HP)·0.5(방어) — items.js itemStats 의 강화 평탄 보너스와 같은 식
  const b = units ? { atk: base.atk + Math.floor((sb.atk || 0) * units * 0.6), hp: base.hp + Math.floor((sb.hp || 0) * units * 0.6), def: base.def + Math.floor((sb.def || 0) * units * 0.5), crit: base.crit } : base;
  return t === 1 ? b : { atk: Math.floor(b.atk * t), hp: Math.floor(b.hp * t), def: Math.floor(b.def * t), crit: b.crit };
}
