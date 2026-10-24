// 상점·마을 상인의 진행도 게이트(docs/balance-audit-2026-10-24.md).
// 시작 재화(골드 12,000·보석 1,500+우편 500)로 1레벨이 후반 재료·전설 장비를 바로 사는 길을 막는다.
// 플레이로 얻는 길(드랍·재료 제작·세트 조각 제작·무한의 성)은 게이트하지 않는다 — 이 표는 "재화로 사는 길"만 다룬다.
import { recommendedLevel } from './loot-tables.js';
import { CHAPTERS, STAGES_PER_CHAPTER } from './stages.js';

/** 장비 등급별 상점 구매 최소 영웅 레벨. 1장 보스가 U·L을 떨어뜨리므로 L은 2장 진입(권장 Lv.20)부터 산다. */
export const RARITY_BUY_LEVEL = Object.freeze({ N: 1, S: 1, E: 5, U: 10, L: 20 });

/**
 * 보석 상점 상품별 최소 영웅 레벨. 쓰임새가 열리는 시점에 맞춘다.
 * 상급 강화석은 +10부터, 전설 강화석은 +15부터(enhanceStoneTier), 초월석은 SSR→SSSR 초월.
 * 골드 교환은 시작 골드(12,000)의 몇십 배를 1레벨에 주지 않게 금액이 큰 것부터 늦게 연다.
 */
export const SKU_BUY_LEVEL = Object.freeze({ gold2: 10, gold3: 20, stone_hi: 15, stone_legend: 30, tstone10: 30 });

/** 계정 진행도 = 영웅 중 최고 레벨(마을 해금 normalizeTownState와 같은 기준). */
export function accountLevel(save) {
  let best = 1;
  for (const hero of Object.values(save?.heroes || {})) {
    const level = Math.floor(Number(hero?.level) || 1);
    if (level > best) best = level;
  }
  return best;
}

/** 레벨 need가 처음 권장되는 캠페인 관문 코드(예: 20 → '2-1'). 잠금 문구의 "어디쯤" 안내용. */
export function stageForLevel(need) {
  for (let ch = 1; ch <= CHAPTERS.length; ch++) {
    for (let st = 1; st <= STAGES_PER_CHAPTER; st++) if (recommendedLevel(ch, st) >= need) return `${ch}-${st}`;
  }
  return `${CHAPTERS.length}-${STAGES_PER_CHAPTER}`;
}

/** @returns {{ ok: boolean, need: number, have: number, reason?: 'level', label?: string, text?: string }} */
export function levelGate(need, save) {
  const have = accountLevel(save);
  need = Math.max(1, Math.floor(Number(need) || 1));
  if (have >= need) return { ok: true, need, have };
  return { ok: false, need, have, reason: 'level', label: `Lv.${need} 해금`,
    text: `영웅 Lv.${need}(${stageForLevel(need)} 권장 레벨) 달성 후 구매 · 현재 Lv.${have}` };
}

export const skuGate = (sku, save) => levelGate(SKU_BUY_LEVEL[sku?.id] || 1, save);
export const rarityGate = (rarity, save) => levelGate(RARITY_BUY_LEVEL[rarity] || 1, save);
