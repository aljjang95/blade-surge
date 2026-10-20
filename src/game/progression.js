export const DEFAULT_SKILL_LOADOUT = Object.freeze([4, 5]);
export const MP_BASE = 100;
export const MP_REGEN_PER_SEC = 2;
// 회피 재사용 대기는 없다(2026-10-16 사용자 요구). 진행 중 회피·사망·기절·일시정지 경계는 Player 가 그대로 막는다.
export const DODGE_COOLDOWN_SEC = 0;
// 회피 무적은 구르기(0.32초) 안쪽 앞 0.26초만 덮는다. 끝 0.06초와 구르기 뒤는 맞을 수 있어 쿨타임 없이
// 연타해도 끊김 없는 영구 무적이 되지 않는다. 구르기를 사격으로 끊으면 그 순간 회피 무적도 끝난다.
export const DODGE_INVULN_SEC = 0.26;

export function normalizeSkillLoadout(def, value, skillLevels = null, heroLevel = Infinity) {
  const source = Array.isArray(value) ? value : DEFAULT_SKILL_LOADOUT;
  const choices = def?.skills || [];
  // 저장/미리보기의 기존 두 인자 호출은 유지하고, 전투·습득 변경은 실제 레벨·습득 상태로 검사한다.
  const available = (index) => index >= 4 && index < choices.length &&
    (!choices[index].unlock || heroLevel >= choices[index].unlock) &&
    (!skillLevels || skillLevels[index] >= 1);
  // -1 은 스킬 초기화가 비운 칸이다. 그대로 비워 두고, 쓸 수 없는 칸(-2)만 다른 습득 스킬로 채운다.
  const next = DEFAULT_SKILL_LOADOUT.map((fallback, slot) => {
    const candidate = source[slot];
    if (candidate === -1) return -1;
    return Number.isInteger(candidate) && available(candidate) ? candidate : available(fallback) ? fallback : -2;
  });
  for (let slot = 0; slot < next.length; slot++) {
    if (next[slot] === -2 || (slot === 1 && next[0] >= 0 && next[0] === next[1])) {
      next[slot] = choices.findIndex((_, index) => available(index) && index !== next[1 - slot]);
    }
  }
  return next;
}

export function skillIndexForCombatSlot(loadout, slot) {
  if (slot < 4) return slot;
  if (slot > 5) return -1;
  return loadout?.[slot - 4] ?? DEFAULT_SKILL_LOADOUT[slot - 4];
}

export const skillMpCost = (skill) => skill?.ult ? 0 : Math.max(0, Number(skill?.mp) || 0);
