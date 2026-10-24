/**
 * 전운 각인을 출격 시작에 연결한다(설계 3.2-5).
 * - 시작 직전: 보관 각인을 preRunBoons(등급 n이면 같은 id n번)로 Battle.setPreRunBoons 에 넘긴다.
 * - 시작 성공(start() === true) 뒤에만 economy.blessingConsume() 으로 보관을 비운다.
 * - 시작 실패(로딩 오류·에너지 부족 등)면 소모하지 않고, 넘겼던 각인도 거둬 다음 파티·결투 출격에 새지 않게 한다.
 * - 원정 준비 창(개인 원정)에서만 부른다. 파티·AI 결투 시작 경로는 이 함수를 거치지 않는다.
 */

/** 보관 각인 → preRunBoons. 보관이 없으면 빈 배열. */
export function heldPreRunBoons(held) {
  if (!held || typeof held.id !== 'string' || !Number.isSafeInteger(held.grade) || held.grade < 1) return [];
  return Array.from({ length: Math.min(3, held.grade) }, () => held.id);
}

/**
 * @param {{ eco?: any, battle?: any }} app
 * @param {() => Promise<boolean>|boolean} start 실제 출격 시작(성공이면 true)
 * @returns {Promise<{ started: boolean, consumed: boolean, preRunBoons: string[] }>}
 */
export async function launchWithBlessing(app, start) {
  const eco = app?.eco, battle = app?.battle;
  const canBless = typeof eco?.blessingState === 'function' && typeof eco?.blessingConsume === 'function' && typeof battle?.setPreRunBoons === 'function';
  const ids = canBless ? heldPreRunBoons(eco.blessingState().held) : [];
  if (canBless && ids.length) battle.setPreRunBoons(ids);
  let started = false;
  try { started = (await start()) === true; }
  finally {
    // 실패했으면 넘긴 각인을 거둔다(다음 개인 출격에서 보관 각인을 다시 넘긴다).
    if (!started && canBless && ids.length) battle.setPreRunBoons([]);
  }
  if (!started || !canBless || !ids.length) return { started, consumed: false, preRunBoons: ids };
  const out = eco.blessingConsume();
  return { started, consumed: !!out?.ok, preRunBoons: ids };
}
