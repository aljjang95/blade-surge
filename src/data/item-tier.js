// 고통 단계 장비 파워 — docs/SPEC_720H.md 3.2. 장비 인스턴스의 tp(드랍된 고통 단계, 1~50)가 스탯 배율 1 + itemPowerStep·tp 를 만든다.
// 기존 장비·저장은 tp 가 없어 배율 1이다(마이그레이션 없음). items.js 의 itemStats 를 감싸는 얇은 층이라 items.js(렌더 매니페스트가 해시를 고정)는 건드리지 않는다.
import { itemStats as baseItemStats } from './items.js';
import { TORMENT } from './content-90d.js';

/** 고통 단계 장비 파워 배율. tp 가 양의 정수가 아니면 1. */
export const itemTierMul = (tp) => Number.isSafeInteger(tp) && tp > 0 ? 1 + TORMENT.itemPowerStep * Math.min(TORMENT.maxTier, tp) : 1;
// 스테이지 장비 레벨(il): 필드 드랍이 나온 스테이지의 권장 레벨(loot-tables.js dropItemLevel). 후반 드랍이 초반 +8 장비를 넘게 한다.
// 배율 1 + 0.021·(il-1)^1.5 (1-1 = 1.00, 2장 끝 20 → 2.7, 3-10 34 → 5.0, 7장 50 → 8.2). il 이 없는 기존 장비·가챠·제작 장비는 배율 1이라 능력치가 그대로다.
// 소수점은 3자리로 굳혀 클라이언트·서버(V8) 어디서든 같은 정수 능력치가 나오게 한다. 고통 단계 장비(tp)는 자기 배율이 있어 il 을 달지 않는다.
export const ITEM_LEVEL_MAX = 80;
const ITEM_LEVEL_MUL = Object.freeze(Array.from({ length: ITEM_LEVEL_MAX + 1 }, (_, il) => il <= 1 ? 1 : Math.round((1 + 0.021 * Math.pow(il - 1, 1.5)) * 1000) / 1000));
export const validItemLevel = (il) => (Number.isSafeInteger(il) && il > 1 ? Math.min(ITEM_LEVEL_MAX, il) : 0);
export const itemLevelMul = (il) => ITEM_LEVEL_MUL[validItemLevel(il)] ?? 1;
/** 장비 이름 앞에 붙는 고대·태고 접두(고통 단계 장비). 없으면 ''. */
export const itemTierPrefix = (tp) => (Number.isSafeInteger(tp) ? TORMENT.itemPrefixes.find((p) => tp >= p.from)?.name : '') || '';

/** 장비 하나의 능력치(강화·등급 규칙은 items.js itemStats 그대로) × 고통 단계 파워. 치명은 장비 고유값이라 배율이 없다. */
export function itemStats(inst) {
  const base = baseItemStats(inst), t = Math.round(itemTierMul(inst.tp) * itemLevelMul(inst.il) * 1000) / 1000;
  return t === 1 ? base : { atk: Math.floor(base.atk * t), hp: Math.floor(base.hp * t), def: Math.floor(base.def * t), crit: base.crit };
}
