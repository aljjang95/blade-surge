// Capability-based sizing: device names and user-agent strings do not determine GPU quality.
export function resolveQuality(requested, { cores = 4, memory = 4, touch = false } = {}) {
  if (['low', 'mid', 'high'].includes(requested)) return requested;
  if (cores <= 2 || memory <= 2) return 'low';
  return touch || cores <= 4 || memory <= 4 ? 'mid' : 'high';
}

export function displaySize(host) {
  const viewport = host.visualViewport;
  // Pinch zoom must not resize the drawing buffer on every gesture frame.
  const visible = viewport && Math.abs((viewport.scale || 1) - 1) < .01 ? viewport : host;
  const positive = (n, fallback) => Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  return { width: positive(visible.width, positive(host.innerWidth, 1)), height: positive(visible.height, positive(host.innerHeight, 1)) };
}

export function renderPixelRatio({ width, height, dpr = 1, quality = 'mid', touch = false }) {
  const limit = quality === 'low' ? 1 : quality === 'mid' ? 1.5 : 2;
  const ratio = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, limit);
  if (!touch) return ratio;
  // Bound every full-screen postprocess target, including high-DPI tablets.
  const budget = quality === 'low' ? 600000 : quality === 'high' ? 1500000 : 1000000;
  return Math.min(ratio, Math.sqrt(budget / Math.max(1, width * height)));
}
