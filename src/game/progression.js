export const DEFAULT_SKILL_LOADOUT = Object.freeze([4, 5]);
export const MP_BASE = 100;
export const MP_REGEN_PER_SEC = 2;
// 회피 재사용 대기는 없다(2026-10-16 사용자 요구). 진행 중 회피·사망·기절·일시정지 경계는 Player 가 그대로 막는다.
export const DODGE_COOLDOWN_SEC = 0;
// 회피 무적은 구르기(0.32초) 안쪽 앞 0.26초만 덮는다. 끝 0.06초와 구르기 뒤는 맞을 수 있어 쿨타임 없이
// 연타해도 끊김 없는 영구 무적이 되지 않는다. 구르기를 사격으로 끊으면 그 순간 회피 무적도 끝난다.
export const DODGE_INVULN_SEC = 0.26;

export function normalizeSkillLoadout(def, value) {
  const source = Array.isArray(value) ? value : DEFAULT_SKILL_LOADOUT;
  const choices = def?.skills || [];
  const next = DEFAULT_SKILL_LOADOUT.map((fallback, slot) => {
    const candidate = source[slot];
    return Number.isInteger(candidate) && candidate >= 4 && candidate < choices.length ? candidate : fallback;
  });
  if (next[0] === next[1]) {
    next[1] = [4, 5, 6, 7].find((index) => index < choices.length && index !== next[0]) ?? 5;
  }
  return next;
}

export function skillIndexForCombatSlot(loadout, slot) {
  if (slot < 4) return slot;
  if (slot > 5) return -1;
  return loadout?.[slot - 4] ?? DEFAULT_SKILL_LOADOUT[slot - 4];
}

export const skillMpCost = (skill) => skill?.ult ? 0 : Math.max(0, Number(skill?.mp) || 0);
