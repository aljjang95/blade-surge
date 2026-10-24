// 늑대인간 족장 고유 스킬 수치. 스킬 구현(skills.js)·처치 회복(battle-base.js)·균형 시뮬레이터·테스트가 같은 값을 읽는다.
export const WEREWOLF_HOWL = Object.freeze({ radius: 7, fear: 1.0, atk: 1.4, atkSpd: 1.35, spd: 1.25, time: 7, killHeal: 0.02 });
export const WEREWOLF_HUNT = Object.freeze({ leaps: 6, step: 0.2, total: 1.55, reach: 14, clawRadius: 3, clawMul: 0.21, moonRadius: 7 });
