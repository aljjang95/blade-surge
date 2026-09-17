// Control-first combat economy: ultimate access is earned by readable player actions.
export const CONTROL_MP_GAIN = Object.freeze({ comboFinisher: 6, perfectDodge: 12 });

export const CONTROL_ULT_GAIN = Object.freeze({
  basicHit: 1,
  basicCrit: 1.4,
  comboFinisher: 7,
  kill: 1,
  eliteKill: 4,
  bossKill: 10,
  perfectDodge: 18,
  perfectGuard: 14,
  postUltimateLock: .65,
});

export function ultHitGain({ basic = false, crit = false } = {}) {
  return basic ? (crit ? CONTROL_ULT_GAIN.basicCrit : CONTROL_ULT_GAIN.basicHit) : 0;
}

export function ultKillGain(enemy = {}) {
  return enemy.isBoss ? CONTROL_ULT_GAIN.bossKill : enemy.isElite ? CONTROL_ULT_GAIN.eliteKill : CONTROL_ULT_GAIN.kill;
}

export function ultimateLockDuration(impl = {}) {
  const active = Number(impl.total ?? impl.dur ?? .8);
  return Math.max(.8, Number.isFinite(active) ? active : .8) + CONTROL_ULT_GAIN.postUltimateLock;
}
