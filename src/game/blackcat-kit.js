// 검은 고양이 사냥꾼 고유 스킬 수치. 스킬 구현(skills.js)·표식 피해 배율(battle-base.js)·균형 시뮬레이터·테스트가 같은 값을 읽는다.
// 불길한 징조: 가장 위협적인 적 arrows명(정예·보스 우선)에게 저주 화살을 한 발씩 겨눠 쏘고, 맞은 적에게 time초 표식(시전자 피해 taken배).
export const BLACKCAT_OMEN = Object.freeze({ arrows: 3, reach: 16, time: 6, taken: 1.15, speed: 34, life: 0.7, radius: 0.75 });
// 아홉 목숨의 밤: 무적으로 뒤로 물러나며 shots발의 그림자 화살을 표적마다 돌려 쏘고(표식 적 우선), 끝에 표식 적 전원에게 그믐 폭발.
export const BLACKCAT_NIGHT = Object.freeze({ shots: 9, step: 0.09, total: 1.2, reach: 18, shotMul: 0.3, burstMul: 0.5, burstRadius: 3.2, backstep: 7 });
