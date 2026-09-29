import * as THREE from 'three';
import { AWAKENING_III } from '../src/game/awakening-iii.js';

// Frozen main implementation before the Lv.30 lane change (b7d92f8, skills.js).
// Keeping the old cast here makes the comparison reproducible after main moves.
const OLD_SUNBREAKER = {
  cast(game, player, ctx) {
    const at = player.forward(new THREE.Vector3()).multiplyScalar(4).add(player.pos);
    game.vacuum(at, 8, 18);
    game.hitRadius(at, 5.5, ctx.dmg);
    game.fx.shockTex(at, 0xffd060, { r1: 6, life: .45 });
    game.after(.18, () => { if (game.active) game.hitRadius(at, 6.5, ctx.dmg * .65); });
  },
};

function castDamage(impl, enemies) {
  const timers = [];
  const game = {
    active: true, enemies,
    after: (delay, run) => timers.push({ delay, run }),
    damageEnemy: (enemy, damage) => { enemy.damage += damage; },
    hitRadius: (at, radius, damage) => {
      let hits = 0;
      for (const enemy of enemies) {
        const dx = enemy.pos.x - at.x, dz = enemy.pos.z - at.z;
        if (dx * dx + dz * dz > (radius + 1.5) ** 2) continue;
        if (Math.hypot(dx, dz) - enemy.radius * .5 > radius) continue;
        enemy.damage += damage;
        if (++hits >= 30) break;
      }
    },
    // Pull accelerates real enemies between frames. Static positions isolate
    // hit geometry and cannot stand in for live DPS or crowd control value.
    vacuum() {},
    fx: { groundTex() {}, boltTex() {}, slashSprite() {}, shockTex() {}, holyBurst() {} },
  };
  const player = { alive: true, pos: new THREE.Vector3(), forward: out => out.set(0, 0, 1) };
  impl.cast(game, player, { dmg: 1, data: {} });
  timers.sort((a, b) => a.delay - b.delay).forEach(({ run }) => run());
  return enemies.map(enemy => enemy.damage);
}

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];

export function simulateSunbreaker({ iterations = 2000, seed = 20260929 } = {}) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100000)
    throw new RangeError('iterations must be 1..100000');
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff)
    throw new RangeError('seed must be a positive uint32');
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
  const ratios = [], oldTotals = [], newTotals = [], oldCoverage = [], newCoverage = [];
  let maxPerTarget = 0, oldZero = 0;
  for (let i = 0; i < iterations; i++) {
    const count = 1 + Math.floor(random() * 24);
    const layout = Array.from({ length: count }, () => new THREE.Vector3((random() - .5) * 10, 0, random() * 12));
    const enemies = () => layout.map(pos => ({ alive: true, spawning: 0, radius: .6, pos: pos.clone(), damage: 0 }));
    const oldHits = castDamage(OLD_SUNBREAKER, enemies());
    const newHits = castDamage(AWAKENING_III.sunbreaker, enemies());
    const oldTotal = oldHits.reduce((sum, damage) => sum + damage, 0);
    const newTotal = newHits.reduce((sum, damage) => sum + damage, 0);
    oldTotals.push(oldTotal); newTotals.push(newTotal);
    oldCoverage.push(oldHits.filter(damage => damage > 0).length / count);
    newCoverage.push(newHits.filter(damage => damage > 0).length / count);
    maxPerTarget = Math.max(maxPerTarget, ...newHits);
    if (oldTotal > 0) ratios.push(newTotal / oldTotal);
    else oldZero++;
  }
  const medianRatio = percentile(ratios, .5);
  const medianCoverage = percentile(newCoverage, .5);
  const failures = [];
  // ±20% median damage keeps the new control pattern from being a stealth
  // nerf/buff; 60% coverage preserves a useful mob-clearing lane.
  if (!Number.isFinite(medianRatio) || medianRatio < .8 || medianRatio > 1.2) failures.push('median-damage-ratio-outside-0.8..1.2');
  if (!Number.isFinite(medianCoverage) || medianCoverage < .6) failures.push('median-coverage-below-0.6');
  if (!Number.isFinite(maxPerTarget) || maxPerTarget > 1.75 + 1e-9) failures.push('per-target-damage-above-1.75');
  return {
    skill: 'sunbreaker', baselineSha: 'b7d92f8141dc1ccc59e2e2653e453d4ca5812c0f',
    iterations, seed,
    layout: '1..24 enemies, x=-5..5, z=0..12, radius=0.6; static positions, no crit or vacuum displacement',
    oldTotal: { median: percentile(oldTotals, .5), p90: percentile(oldTotals, .9) },
    newTotal: { median: percentile(newTotals, .5), p90: percentile(newTotals, .9) },
    headToOldRatio: { median: medianRatio, p10: percentile(ratios, .1), p90: percentile(ratios, .9) },
    coverage: { oldMedian: percentile(oldCoverage, .5), newMedian: medianCoverage },
    maxPerTarget, oldZero, failures,
    limitation: 'Hit geometry only. Live DPS, enemy motion, cooldown pacing, survival, economy and retention require separate evidence.',
  };
}
