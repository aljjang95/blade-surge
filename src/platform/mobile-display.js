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

export function renderPixelRatio({ width, height, dpr = 1, quality = 'mid', touch = false, thermalTier = 0 }) {
  const limit = quality === 'low' ? 1 : quality === 'mid' ? 1.5 : 2;
  const ratio = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, limit);
  // 고해상도 태블릿을 포함해 모든 전체 화면 후처리 버퍼를 제한한다.
  const budget = quality === 'low' ? 600000 : quality === 'high' ? 1500000 : 1000000;
  const base = touch ? Math.min(ratio, Math.sqrt(budget / Math.max(1, width * height))) : ratio;
  // 지속 부하 3단계: 해상도를 20% 낮춘다. 갤럭시 탭 S7+ 실측(2026-10-20)에서 기본값이 이미 0.94라
  // 하한 1.0 규칙으로는 아무것도 줄지 않았으므로 하한을 0.6으로 둔다(GPU 채움 부하는 해상도 제곱에 비례).
  return thermalTier >= 3 ? Math.min(base, Math.max(0.6, base * 0.8)) : base;
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
