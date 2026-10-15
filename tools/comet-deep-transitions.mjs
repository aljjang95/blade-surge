// 혜성 심층 QA 타임라인의 고리 phase 전이 판정. 브라우저 없이 단위 검사할 수 있게 분리했다.
export const ALLOWED = Object.freeze({ locked: ['ready'], ready: ['collapse'], collapse: ['shelter', 'ready'], shelter: ['storm', 'ready'], storm: ['connected'], connected: [] });

// 관측은 app.step 한 번(1/60초) 끝에서만 한다. 설계 4절상 같은 스텝 안에서 locked→ready(적 처치로 열림)와
// ready→collapse(궤도 위 영웅의 첫 실제 밀기)가 이어질 수 있다. 이 합성 전이는 두 증거가 모두 있을 때만 허용한다.
// 1) 그 스텝에서 붕괴가 막 시작됐다: 남은 시계가 붕괴 시간에서 한 판정 단계(1/30초) 이내다.
// 2) 그 스텝에 고리 방의 살아 있는 적과 대기 증원(pending)이 모두 0이다(열림 조건 enemiesCleared 의 관측 증거).
// 증거 필드가 없거나 숫자가 아니면 거부한다. 그 밖의 건너뛰기는 그대로 실패다.
export function legalStep(e, collapseSeconds) {
  if (ALLOWED[e.from]?.includes(e.to)) return true;
  return e.from === 'locked' && e.to === 'collapse' && Number.isFinite(collapseSeconds) && Number.isFinite(e.clock)
    && e.clock <= collapseSeconds + 1e-9 && e.clock >= collapseSeconds - 1 / 30 - 1e-9
    && e.roomAlive === 0 && e.roomPending === 0;
}

/** 허용 목록 밖이지만 legalStep 이 증거로 허용한 합성 전이만 돌려준다. */
export function compositeSteps(list, collapseSeconds) {
  return list.filter(e => !ALLOWED[e.from]?.includes(e.to) && legalStep(e, collapseSeconds));
}
