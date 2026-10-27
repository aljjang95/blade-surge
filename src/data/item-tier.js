// 고통 단계 장비 파워 — docs/SPEC_720H.md 3.2. 장비 인스턴스의 tp(드랍된 고통 단계, 1~50)가 스탯 배율 1 + itemPowerStep·tp 를 만든다.
// 기존 장비·저장은 tp 가 없어 배율 1이다(마이그레이션 없음). items.js 의 itemStats 를 감싸는 얇은 층이라 items.js(렌더 매니페스트가 해시를 고정)는 건드리지 않는다.
import { itemStats as baseItemStats } from './items.js';
import { TORMENT } from './content-90d.js';

/** 고통 단계 장비 파워 배율. tp 가 양의 정수가 아니면 1. */
export const itemTierMul = (tp) => Number.isSafeInteger(tp) && tp > 0 ? 1 + TORMENT.itemPowerStep * Math.min(TORMENT.maxTier, tp) : 1;
/** 장비 이름 앞에 붙는 고대·태고 접두(고통 단계 장비). 없으면 ''. */
export const itemTierPrefix = (tp) => (Number.isSafeInteger(tp) ? TORMENT.itemPrefixes.find((p) => tp >= p.from)?.name : '') || '';

/** 장비 하나의 능력치(강화·등급 규칙은 items.js itemStats 그대로) × 고통 단계 파워. 치명은 장비 고유값이라 배율이 없다. */
export function itemStats(inst) {
  const base = baseItemStats(inst), t = itemTierMul(inst.tp);
  return t === 1 ? base : { atk: Math.floor(base.atk * t), hp: Math.floor(base.hp * t), def: Math.floor(base.def * t), crit: base.crit };
}
