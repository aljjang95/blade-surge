// 강화 확률·비용 표 (+0 ~ +20, 던파식). items.js 가 그대로 다시 내보낸다.
// 클라이언트 강화(Economy.enhance), 서버 명령(EconomyCore → worker/v1/cmd), 90일 시뮬(tools/sim-90d.mjs)이 모두 이 표를 쓴다.
/** 성공 확률(키 = 현재 단계, 결과 = 다음 단계 성공 확률). 대표님 2026-10-28 "던파식 긴장":
 *  +1~+3 확정, +4 90% → +8 60% → +10 50% → +12 42% 로 단계마다 떨어진다. +13(현재 +12) 이상은 기존 값 그대로.
 *  지휘 세션 초안(+8 50%·+10 35%·+13 28%)은 sim-90d 마라톤 밴드(S2 주요 진행일 66<70, S5b 고통 D60 14<15·D90 17<22)를 깨서 중간 구간을 완화했다.
 *  (예전: +8까지 100% — 신규 계정 1-1 한 판에 전투력 3,200→7,896, 그중 약 49%가 무위험 강화였다.) */
export const ENHANCE_CHANCE = Object.freeze({ 3: 0.9, 4: 0.8, 5: 0.7, 6: 0.65, 7: 0.6, 8: 0.55, 9: 0.5, 10: 0.45, 11: 0.42, 12: 0.4, 13: 0.3, 14: 0.25, 15: 0.2, 16: 0.15, 17: 0.13, 18: 0.11, 19: 0.09 });
export const ENH_SAFE_MAX = 3;   // 이 단계까지는 성공 100%
export const enhanceChance = (lv) => lv < ENH_SAFE_MAX ? 1 : (ENHANCE_CHANCE[lv] ?? 0.08);
/** 실패 시 파괴 확률 (+12 이상). 보호 주문서로 0 */
export const destroyChance = (lv) => lv < 12 ? 0 : lv < 15 ? 0.1 : 0.2;
/** 실패 시 단계 하락: +10 이상에서 1 (던파 +11↑ 하락에 해당) */
export const enhanceDown = (lv) => lv >= 10 ? 1 : 0;
export const enhanceCost = (lv) => Math.floor(250 * Math.pow(1.3, lv));
/** 강화석 개수: +3까지 0, +4·+5 1개, +6~+12 2개, +13~+16 3개, 그 위 5개(+6~+8 은 예전 1개 → 2개) */
export const enhanceStones = (lv) => lv < 3 ? 0 : lv < 5 ? 1 : lv < 12 ? 2 : lv < 16 ? 3 : 5;
/** 확정 강화(골드): +3 → +4 부터 +10 → +11 까지, 웃돈 골드를 더 내면 그 시도는 반드시 성공한다(대표님 2026-10-29 "+11 전에 골드를 쓸 곳").
 *  캠페인 실측(신규 계정, 4-5 도달 시 보유 골드 약 175만, 강화·훈련 소비 합계 약 7.5만)에서 플레이어가 성공률 80% 아래(+5↑)에서 멈추고 골드가 쌓였다.
 *  웃돈은 단계마다 1.55배라 +4 한 번이 1장 끝 골드의 약 5%, +10 → +11 한 번이 3장 끝 골드의 약 14% 다(네 부위 +3 → +11 합계 약 188만).
 *  보석 축복 주문서(+20%, +11 이상도 가능)와 함께 쓰지 않는다. 일반 강화 비용·강화석은 그대로 낸다. 범위 밖이면 null. */
export const ENH_SURE_MIN = ENH_SAFE_MAX, ENH_SURE_MAX = 10;
export const enhanceSureCost = (lv) => Number.isInteger(lv) && lv >= ENH_SURE_MIN && lv <= ENH_SURE_MAX ? Math.round(8000 * Math.pow(1.55, lv - ENH_SURE_MIN) / 100) * 100 : null;
