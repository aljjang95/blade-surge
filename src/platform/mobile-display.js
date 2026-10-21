// Capability-based sizing: device names and user-agent strings do not determine GPU quality.
export function resolveQuality(requested, { cores = 4, memory = 4, touch = false } = {}) {
  if (['low', 'mid', 'high'].includes(requested)) return requested;
  if (cores <= 2 || memory <= 2) return 'low';
  return touch || cores <= 4 || memory <= 4 ? 'mid' : 'high';
}

export function displaySize(host) {
  // 캔버스는 컷아웃을 포함한 레이아웃 뷰포트에 맞춰야 하므로 visualViewport로 줄이지 않는다.
  const positive = (n, fallback) => Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  return { width: positive(host.innerWidth, 1), height: positive(host.innerHeight, 1) };
}

/** 화질별 DPR 상한과 터치 기기의 전체 화면 픽셀 예산. 예산은 동적 해상도의 출발점(최대치)이며, 실제 프레임 시간이 넘칠 때만 아래로 내려간다. */
export const RENDER_LIMITS = Object.freeze({
  low: Object.freeze({ dpr: 1, pixels: 600000 }),
  mid: Object.freeze({ dpr: 2, pixels: 1600000 }),
  high: Object.freeze({ dpr: 2.5, pixels: 2200000 }),
});

/** 동적 해상도 배율 범위와 단계. 한 단계(10%)마다 렌더 타깃을 다시 잡으므로 큰 폭으로 움직이지 않는다.
 * 최소 0.7: 갤럭시 S26 급(출발 2.0)에서도 바닥이 1.4로, 예전 고정값(1.5)에 가깝다. 그보다 더 낮추는 것은 열 단계 3(×0.8)의 몫이다. */
export const RESOLUTION_SCALE = Object.freeze({ min: 0.7, max: 1, step: 0.1 });

/** 배율을 단계 격자(0.7, 0.8, 0.9, 1.0)에 맞춘다. 부동소수점 오차 없이 비교할 수 있게 소수 첫째 자리로 고정한다. */
export function snapResolutionScale(scale) {
  if (!Number.isFinite(scale)) return RESOLUTION_SCALE.max;
  const stepped = Math.round(scale / RESOLUTION_SCALE.step) * RESOLUTION_SCALE.step;
  return Math.round(Math.min(RESOLUTION_SCALE.max, Math.max(RESOLUTION_SCALE.min, stepped)) * 10) / 10;
}

export function renderPixelRatio({ width, height, dpr = 1, quality = 'mid', touch = false, thermalTier = 0, resolutionScale = 1 }) {
  const limits = RENDER_LIMITS[quality] || RENDER_LIMITS.mid;
  // 데스크톱은 픽셀 예산이 없으므로 이전과 같이 DPR 2 를 넘기지 않는다. 2.5 는 예산이 걸린 터치 기기에서만 쓴다.
  const ratio = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, touch ? limits.dpr : Math.min(limits.dpr, 2));
  // 고해상도 태블릿을 포함해 모든 전체 화면 후처리 버퍼를 제한한다.
  const base = touch ? Math.min(ratio, Math.sqrt(limits.pixels / Math.max(1, width * height))) : ratio;
  // 지속 부하 3단계: 해상도를 20% 낮춘다. 갤럭시 탭 S7+ 실측(2026-10-20)에서 기본값이 이미 0.94라
  // 하한 1.0 규칙으로는 아무것도 줄지 않았으므로 하한을 0.6으로 둔다(GPU 채움 부하는 해상도 제곱에 비례).
  const floor = thermalTier >= 3 ? Math.min(base, Math.max(0.6, base * 0.8)) : base;
  // 동적 해상도 배율은 열 단계 값 위에 곱하되, 배율 때문에 0.6 아래로 내려가지는 않는다(열 단계가 이미 더 낮으면 그 값).
  return Math.max(Math.min(floor, 0.6), floor * snapResolutionScale(resolutionScale));
}

/**
 * 동적 해상도 한 단계를 정하는 순수 함수. 반환값은 배율 변화 방향(-1 낮춤, 0 유지, 1 올림).
 * - 낮춤: 과부하가 downMs 이상 이어지고 직전 변경 뒤 cooldownMs 가 지났을 때. 이미 최소면 유지.
 * - 올림: 여유가 upMs 이상 이어지고 cooldownMs 가 지났을 때. 이미 최대면 유지. 올림 대기(upMs)는 호출자가 되돌림 이력으로 늘린다.
 * 한 번에 한 단계만 움직이고 같은 평가에서 위·아래가 동시에 성립하면 낮춤이 이긴다(깜빡임 방지).
 */
export function decideResolutionStep({ scale, overloadMs = 0, headroomMs = 0, sinceChangeMs = Infinity,
  downMs = 2000, upMs = 10000, cooldownMs = 2500 }) {
  const current = snapResolutionScale(scale);
  if (sinceChangeMs < cooldownMs) return 0;
  if (overloadMs >= downMs && current > RESOLUTION_SCALE.min) return -1;
  if (headroomMs >= upMs && overloadMs === 0 && current < RESOLUTION_SCALE.max) return 1;
  return 0;
}

/** CAS 선명화 강도(0~1). 렌더 해상도가 기기 해상도보다 낮을수록(확대되어 흐려질수록) 조금 더 세게, 최대 0.75로 후광을 막는다. */
export function sharpenStrength(renderRatio, nativeRatio) {
  const native = Number.isFinite(nativeRatio) && nativeRatio > 0 ? nativeRatio : 1;
  const ratio = Number.isFinite(renderRatio) && renderRatio > 0 ? renderRatio : native;
  const deficit = Math.min(1, Math.max(0, 1 - ratio / native));
  return 0.4 + 0.35 * deficit;
}

/** 전투 FXAA 는 렌더 해상도가 기기 해상도보다 낮아 모서리가 확대될 때만 켠다(낮음 화질은 항상 끈다). */
export function battleNeedsFxaa(renderRatio, nativeRatio, quality) {
  return quality !== 'low' && Number.isFinite(renderRatio) && Number.isFinite(nativeRatio) && renderRatio < nativeRatio - 0.01;
}

/** mid 터치는 그림자 면적을 1/4로, 블룸 밉의 입력 면적을 약 9/16으로 줄인다. */
export function thermalRenderProfile(quality, touch, tier = 0) {
  const mobileMid = touch && quality === 'mid';
  return {
    softShadow: !mobileMid,
    shadowScale: (mobileMid ? 0.5 : 1) * (tier >= 1 ? 0.5 : 1),
    bloomEnabled: quality !== 'low' && tier < 2,
    bloomDivisor: mobileMid ? 4 : 3,
    bloomLimit: mobileMid ? 256 : 320,
  };
}
