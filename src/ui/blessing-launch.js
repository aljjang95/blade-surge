/**
 * 전운 각인을 출격 시작에 연결한다(설계 3.2-5).
 * - 시작 직전: 보관 각인을 preRunBoons(등급 n이면 같은 id n번)로 Battle.setPreRunBoons 에 넘긴다.
 * - 시작 직전 economy.blessingConsume() 으로 소모를 먼저 저장한다(저장 실패면 출격하지 않는다).
 * - 시작 실패(로딩 오류·에너지 부족 등)면 보관 각인을 되돌리고, 넘겼던 각인도 거둬 다음 파티·결투 출격에 새지 않게 한다.
 * - 원정 준비 창(개인 원정)에서만 부른다. 파티·AI 결투 시작 경로는 이 함수를 거치지 않는다.
 */

/** 보관 각인 → preRunBoons. 보관이 없으면 빈 배열. */
export function heldPreRunBoons(held) {
  if (!held || typeof held.id !== 'string' || !Number.isSafeInteger(held.grade) || held.grade < 1) return [];
  return Array.from({ length: Math.min(3, held.grade) }, () => held.id);
}

/** 소모할 것이 있는가: 보관 각인이 있거나, 굴린 후보·준비 굴림 수가 남아 있으면 true(깨끗한 상태면 저장하지 않는다). */
function hasPending(st) {
  return !!(st && (st.held || st.offer || st.runGemRolls > 0 || st.runRolls > 0));
}

/**
 * 순서(리뷰 반영): 소모 저장 → setPreRunBoons → 출격 시작.
 * - 보관 각인이 없어도 굴린 후보(offer)와 준비 굴림 수(runGemRolls·runRolls)는 출격 성공 때 초기화되어야 하므로 소모는 항상 부른다.
 * - 소모 저장이 실패하면 출격하지 않고(saveFailed) 각인도 넘기지 않는다. 전투 효과만 적용되고 각인이 남아 재사용되는 일을 막는다.
 * - 출격 시작이 실패(false·예외)하면 넘긴 각인을 거두고 economy.blessingRestore 로 보관 각인을 되돌린다.
 * @param {{ eco?: any, battle?: any }} app
 * @param {() => Promise<boolean>|boolean} start 실제 출격 시작(성공이면 true)
 * @returns {Promise<{ started: boolean, consumed: boolean, preRunBoons: string[], saveFailed?: boolean }>}
 */
export async function launchWithBlessing(app, start) {
  const eco = app?.eco, battle = app?.battle;
  const canBless = typeof eco?.blessingState === 'function' && typeof eco?.blessingConsume === 'function' && typeof battle?.setPreRunBoons === 'function';
  if (!canBless) return { started: (await start()) === true, consumed: false, preRunBoons: [] };
  const before = eco.blessingState();
  const held = before?.held ? { ...before.held } : null;
  const ids = heldPreRunBoons(held);
  let consumed = false;
  if (hasPending(before)) {
    const out = eco.blessingConsume();
    if (!out?.ok) return { started: false, consumed: false, preRunBoons: [], saveFailed: true };
    consumed = true;
  }
  if (ids.length) battle.setPreRunBoons(ids);
  let started = false;
  try { started = (await start()) === true; }
  finally {
    if (!started) {
      // 실패했으면 넘긴 각인을 거두고 보관 각인을 돌려준다(다음 개인 출격에서 다시 넘긴다).
      if (ids.length) battle.setPreRunBoons([]);
      if (consumed && held && typeof eco.blessingRestore === 'function') eco.blessingRestore(held);
    }
  }
  return { started, consumed: started && consumed, preRunBoons: ids };
}
