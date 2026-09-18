// 연출 전용 난수 — 게임 로직의 Math.random 흐름과 분리한다.
// 오디오(피치 흔들림·기합 변형)와 FX(파티클·데미지 숫자 위치)는 실시간 게이트 뒤에서 난수를 뽑는다:
// audio.play 는 AudioContext 시각으로 최소 간격을 재고, 데미지 숫자는 CSS animationend(벽시계)로 지워지는 DOM 개수로 막힌다.
// 이것들이 Math.random 을 쓰면 벽시계에 따라 게임 난수 열이 밀려 같은 시드·같은 dt 인데도 층이 140~183초로 흔들렸다(2026-09-18 실측).
// 고정 시드다 — 연출은 매 세션 같은 열이어도 눈에 띄지 않고, 하네스 스크린샷이 비교 가능해진다.
export function makeRng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
/** 연출용 공용 난수 [0, 1) — 게임 로직에서 쓰지 마라 */
export const prand = makeRng(0x5eed0f0f);
