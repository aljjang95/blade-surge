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

export function renderPixelRatio({ width, height, dpr = 1, quality = 'mid', touch = false }) {
  const limit = quality === 'low' ? 1 : quality === 'mid' ? 1.5 : 2;
  const ratio = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, limit);
  if (!touch) return ratio;
  // Bound every full-screen postprocess target, including high-DPI tablets.
  const budget = quality === 'low' ? 600000 : quality === 'high' ? 1500000 : 1000000;
  return Math.min(ratio, Math.sqrt(budget / Math.max(1, width * height)));
}
