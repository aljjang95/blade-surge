/** Contact-locked animation tempo: anticipation -> fast strike -> recovery.
 * It never changes gameplay hitAt, attack range, cooldowns or damage. */
const clamp01 = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const smooth = t => t * t * (3 - 2 * t);
export function attackPhase(t, contact = 0.4) {
  t = clamp01(t); contact = Math.max(0.1, Math.min(0.85, Number.isFinite(contact) ? contact : 0.4));
  const windup = contact * 0.64;
  if (t < windup) return contact * 0.3 * smooth(t / windup);
  if (t < contact) return contact * (0.3 + 0.7 * ((t - windup) / (contact - windup)) ** 1.25);
  const settle = contact + (1 - contact) * 0.22;
  if (t < settle) return contact + (1 - contact) * 0.63 * (1 - (1 - (t - contact) / (settle - contact)) ** 2);
  return contact + (1 - contact) * (0.63 + 0.37 * smooth((t - settle) / (1 - settle)));
}

export function attackBody(t, contact, weapon = '1h', ranged = false) {
  t = clamp01(t); contact = Math.max(0.1, Math.min(0.85, contact || 0.4));
  const weight = ranged ? 0.45 : weapon === '2h' ? 1.15 : weapon === 'dual' ? 0.7 : 1;
  const before = t < contact;
  const pulse = before ? -Math.sin(Math.PI * t / contact) * 0.6 : (1 - (t - contact) / (1 - contact)) ** 2;
  return { pitch: pulse * 0.085 * weight, yaw: pulse * 0.075 * weight, forward: before ? pulse * 0.045 : pulse * 0.085 * weight };
}

export function impactStrength({ finisher = false, crit = false, boss = false, elite = false } = {}) {
  return (finisher ? 1 : crit ? 0.75 : 0.5) * (boss ? 0.22 : elite ? 0.55 : 1);
}

/** Uses the unscaled clock, and consumes partial-frame stops rather than dropping a whole frame.
 * Repeated hits extend a stop to a maximum, never sum a stop per enemy. */
export class ImpactClock {
  constructor() { this.stop = 0; this.slow = 1; this.slowT = 0; this.scale = 1; this._stopped = 0; this._rearm = 0; }
  hitstop(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || this._rearm > 0) return;
    this.stop = Math.max(this.stop, Math.min(seconds, Math.max(0, 0.12 - this._stopped)));
  }
  slowmo(scale, seconds) {
    if (!Number.isFinite(scale) || !Number.isFinite(seconds) || seconds <= 0) return;
    this.slow = Math.min(this.slow, Math.max(0.05, Math.min(1, scale))); this.slowT = Math.max(this.slowT, seconds);
  }
  step(realDt) {
    if (!Number.isFinite(realDt) || realDt <= 0) return 0;
    const dt = Math.min(realDt, 0.25);
    this._rearm = Math.max(0, this._rearm - dt);
    const frozen = Math.min(this.stop, dt);
    this.stop = Math.max(0, this.stop - frozen); this._stopped += frozen;
    let remaining = dt - frozen, scaled = remaining;
    if (remaining > 0 && this.slowT > 0) {
      const slowPart = Math.min(this.slowT, remaining);
      scaled = slowPart * this.slow + remaining - slowPart;
      this.slowT = Math.max(0, this.slowT - remaining);
      if (this.slowT === 0) this.slow = 1;
    }
    if (this.stop === 0 && this._stopped > 0) { this._rearm = Math.max(this._rearm, 0.045); this._stopped = 0; }
    this.scale = scaled / realDt;
    return scaled;
  }
}
