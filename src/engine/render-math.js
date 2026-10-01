/** Pure rendering math. No scene state, gameplay RNG, or frame-time allocation. */
export function bloomRenderSize(width, height) {
  const w = Number.isFinite(width) ? Math.max(1, width) : 1;
  const h = Number.isFinite(height) ? Math.max(1, height) : 1;
  // One scale for BOTH axes: independent caps distort bloom on wide screens.
  const scale = Math.min(1 / 3, 320 / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Exponential damping composes across frames; linear dt * rate does not. */
export function cameraBlend(dt, response) {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(response) || response <= 0) return 0;
  return -Math.expm1(-dt * response);
}
