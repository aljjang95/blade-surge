export const DEFAULT_SKILL_LOADOUT = Object.freeze([4, 5]);
export const MP_BASE = 100;
export const MP_REGEN_PER_SEC = 4;
export const DODGE_COOLDOWN_SEC = 1.35;

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
