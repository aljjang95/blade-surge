const finite = value => Number.isFinite(value) ? value : 0;
const clamp01 = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const proximity = (d, inner, outer) => {
  const t = clamp01((outer - d) / (outer - inner));
  return t * t * (3 - 2 * t);
};

/** Pure framing policy: local threats only, bounded anticipation, no impact motion. */
export function battleFraming({ player, enemies = [], boss, preset = 'auto', presets }) {
  const p = player.pos, vx = finite(player.vel?.x), vz = finite(player.vel?.z), speed = Math.hypot(vx, vz);
  let x = 0, z = 0;
  if (speed > .5) {
    const lead = Math.min(1.1, (speed - .5) * .2);
    x = vx / speed * lead; z = vz / speed * lead;
  }
  const lock = player.lockTarget;
  if (lock?.alive && !lock.spawning && lock.pos) {
    const d = distance(p, lock.pos);
    const bias = Math.min(.65, d * .1) * proximity(d, 8, 18);
    if (d > 0) { x += (lock.pos.x - p.x) / d * bias; z += (lock.pos.z - p.z) / d * bias; }
  }
  const lead = Math.hypot(x, z);
  if (lead > 1.5) { x *= 1.5 / lead; z *= 1.5 / lead; }
  let pressure = 0;
  for (const enemy of enemies) if (enemy.alive && !enemy.spawning && enemy.pos) pressure += proximity(distance(p, enemy.pos), 5, 9);
  const bossWeight = boss?.alive && !boss.spawning && boss.pos ? proximity(distance(p, boss.pos), 6, 14) : 0;
  const automatic = !presets[preset];
  const crowd = automatic ? clamp01(pressure / 12) : 0;
  const base = automatic ? (pressure === 0 && speed > 2 ? presets.action : presets.top) : presets[preset];
  const desired = { ...base };
  if (automatic) for (const key of ['y', 'z', 'fov', 'lookY', 'lag']) desired[key] += (presets.wide[key] - desired[key]) * bossWeight;
  return {
    target: { x: finite(p.x) + x, y: finite(p.y), z: finite(p.z) + z },
    desired, crowd, bossWeight,
    // One modest density allowance; boss composition never stacks a second pullback.
    extraY: crowd * .65, extraZ: crowd * .55, extraFov: crowd * 1.2,
  };
}

export const framingBlend = (dt, rate) => 1 - Math.exp(-Math.max(0, finite(dt)) * rate);
