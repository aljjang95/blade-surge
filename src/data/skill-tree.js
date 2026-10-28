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
// 기본 스킬 단계 해금(2026-10-27 대표님 피드백 '처음부터 먼치킨'): Lv1 은 평타 + 첫 스킬, Lv3 둘째, Lv5 셋째, Lv8 궁극기, Lv10 부터 각성.
// SP 비용·저장 스킬 레벨은 그대로이고, 레벨이 오를 때 쓸 수 있는 시점만 늦춘다(1-1 한 판에 Lv3~5 까지 올라 둘째·셋째가 열린다).
export const BASIC_SKILL_GATES = Object.freeze([1, 3, 5]);
export const ULT_GATE_LEVEL = 8;
/** i번 스킬을 쓸 수 있는 최소 영웅 레벨(각성은 unlock, 기본은 단계 해금, 궁극기는 Lv8). */
export function skillGateLevel(def, i) {
  const skills = def?.skills || [], sk = skills[i];
  if (!sk) return 1;
  if (sk.unlock) return sk.unlock;
  if (sk.ult) return ULT_GATE_LEVEL;
  let k = 0; for (let j = 0; j < i; j++) if (!skills[j].unlock && !skills[j].ult) k++;
  return BASIC_SKILL_GATES[Math.min(k, BASIC_SKILL_GATES.length - 1)];
}
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
/** SP 도입 전 저장의 보상 SP(예전에 골드로 올린 스킬이 레벨로 번 SP보다 많던 만큼). 초기화 뒤에도 남는 영웅별 예산이다. */
export function spBonus(state) { const v = Math.floor(Number(state?.spBonus) || 0); return v > 0 ? Math.min(v, 999) : 0; }
/** 영웅이 쓸 수 있는 SP 총예산 = 레벨로 번 SP + 보상 SP. */
export function spBudget(state) { return spEarned(state?.level) + spBonus(state); }
export function spAvailable(def, state) { return Math.max(0, spBudget(state) - spSpent(def, state?.skills)); }
/** i번 스킬을 한 단계 올릴 수 있는지. reason: 'skill' | 'max' | 'level' | 'sp' */
export function canLearnSkill(def, state, i) {
  const skill = def?.skills?.[i]; if (!skill) return { ok: false, reason: 'skill' };
  const current = Math.floor(Number(state?.skills?.[i]) || 0);
  if (current >= SKILL_MAX_LV) return { ok: false, reason: 'max' };
  // 단계 해금(기본 Lv3·5, 궁극기 Lv8) 전에는 SP를 쓰지 못한다: 전투에서 못 쓰는 스킬에 SP가 묶이지 않게.
  const need = skillGateLevel(def, i);
  if ((state?.level || 1) < need) return { ok: false, reason: 'level', need };
  const cost = spCostForLevel(skill, current + 1);
  if (spAvailable(def, state) < cost) return { ok: false, reason: 'sp', cost };
  return { ok: true, cost, toLevel: current + 1 };
}
/** 초기화 뒤 스킬 레벨 배열(기본·궁극기 1, 각성 0). */
export function baselineSkillLevels(def) { return (def?.skills || []).map(skillBaseLevel); }
export function skillLearned(level) { return (Number(level) || 0) >= 1; }
