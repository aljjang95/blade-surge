// 스킬 포인트(SP) 규칙. 레벨이 오를 때 SP를 받고, SP로 스킬을 배우거나 올린다.
// 모든 스킬을 최대로 올릴 만큼 SP가 나오지 않으므로 무엇을 찍을지가 선택이다(잘못 찍으면 스킬 초기화서로 되돌린다).
// SP 잔량은 저장하지 않고 영웅 레벨과 스킬 레벨에서 매번 계산한다(저장값 어긋남이 없다).
export const SKILL_MAX_LV = 10;
export const SP_START = 3;
export const SP_MILESTONES = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80]);
export const SP_MILESTONE_BONUS = 2;
// 이 레벨 미만이면 스킬 초기화가 무료다(입문 구간에서 마음껏 시험해 보게).
export const FREE_RESET_BELOW_LEVEL = 20;

/** 처음부터 배운 상태(기본 스킬·궁극기 1레벨)인지, 레벨 해금 뒤 SP로 배워야 하는 각성 스킬(0레벨)인지. */
export function skillBaseLevel(skill) { return skill?.unlock ? 0 : 1; }
export function skillRequiredLevel(skill) { return skill?.unlock || 1; }
/** toLevel 로 올릴 때 드는 SP. 각성 첫 습득·궁극기·6레벨 이상은 2, 나머지는 1. */
export function spCostForLevel(skill, toLevel) {
  if (!skill || toLevel < 1 || toLevel > SKILL_MAX_LV) return Infinity;
  if (skill.ult || toLevel > 5) return 2;
  if (skill.unlock && toLevel === 1) return 2;
  return 1;
}
export function spEarned(heroLevel) {
  const lv = Math.max(1, Math.floor(Number(heroLevel) || 1));
  return SP_START + (lv - 1) + SP_MILESTONES.filter((m) => lv >= m).length * SP_MILESTONE_BONUS;
}
export function spSpent(def, skillLevels = []) {
  let total = 0;
  (def?.skills || []).forEach((skill, i) => {
    const level = Math.max(0, Math.min(SKILL_MAX_LV, Math.floor(Number(skillLevels[i]) || 0)));
    for (let next = skillBaseLevel(skill) + 1; next <= level; next++) total += spCostForLevel(skill, next);
  });
  return total;
}
export function spAvailable(def, state) { return Math.max(0, spEarned(state?.level) - spSpent(def, state?.skills)); }
/** i번 스킬을 한 단계 올릴 수 있는지. reason: 'skill' | 'max' | 'level' | 'sp' */
export function canLearnSkill(def, state, i) {
  const skill = def?.skills?.[i]; if (!skill) return { ok: false, reason: 'skill' };
  const current = Math.floor(Number(state?.skills?.[i]) || 0);
  if (current >= SKILL_MAX_LV) return { ok: false, reason: 'max' };
  if ((state?.level || 1) < skillRequiredLevel(skill)) return { ok: false, reason: 'level', need: skillRequiredLevel(skill) };
  const cost = spCostForLevel(skill, current + 1);
  if (spAvailable(def, state) < cost) return { ok: false, reason: 'sp', cost };
  return { ok: true, cost, toLevel: current + 1 };
}
/** 초기화 뒤 스킬 레벨 배열(기본·궁극기 1, 각성 0). */
export function baselineSkillLevels(def) { return (def?.skills || []).map(skillBaseLevel); }
export function skillLearned(level) { return (Number(level) || 0) >= 1; }
