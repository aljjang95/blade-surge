const finite = value => Number.isFinite(value) ? value : 0;
const clamp01 = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const proximity = (d, inner, outer) => {
  const t = clamp01((outer - d) / (outer - inner));
  return t * t * (3 - 2 * t);
};

/** Pure framing policy: local threats, bounded anticipation and short impact focus. */
export function battleFraming({ player, enemies = [], boss, impactTarget = null, impactWeight = 0, preset = 'auto', presets }) {
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
  // 기본 타격 순간에는 시선을 영웅과 접촉 지점 사이로 아주 짧게 당긴다.
  // 화면 흔들림으로 위치를 잃게 하지 않고, 공격 방향과 적 반응을 한 프레임에 읽게 한다.
  if (impactTarget?.pos && impactWeight > 0) {
    const ix = finite(impactTarget.pos.x) - finite(p.x), iz = finite(impactTarget.pos.z) - finite(p.z);
    const d = Math.hypot(ix, iz);
    if (d > 0) { const bias = Math.min(.58, .22 * Math.min(1, impactWeight) * Math.min(1.6, d)); x += ix / d * bias; z += iz / d * bias; }
  }
  const lead = Math.hypot(x, z);
  if (lead > 1.5) { x *= 1.5 / lead; z *= 1.5 / lead; }
  let pressure = 0;
  for (const enemy of enemies) if (enemy.alive && !enemy.spawning && enemy.pos) pressure += proximity(distance(p, enemy.pos), 5, 9);
  const bossWeight = boss?.alive && !boss.spawning && boss.pos ? proximity(distance(p, boss.pos), 6, 14) : 0;
  const automatic = !presets[preset];
  const crowd = automatic ? clamp01(pressure / 12) : 0;
  const base = automatic ? presets.action : presets[preset];
  const desired = { ...base };
  if (automatic) for (const key of ['y', 'z', 'fov', 'lookY', 'lag']) desired[key] += (presets.wide[key] - desired[key]) * bossWeight;
  return {
    target: { x: finite(p.x) + x, y: finite(p.y), z: finite(p.z) + z },
    desired, crowd, bossWeight,
    // One modest density allowance; boss composition never stacks a second pullback.
    extraY: crowd * .35, extraZ: crowd * .28, extraFov: crowd * .7,
  };
}

export const framingBlend = (dt, rate) => 1 - Math.exp(-Math.max(0, finite(dt)) * rate);
