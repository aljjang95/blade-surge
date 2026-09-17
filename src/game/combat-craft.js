const finite = n => Number.isFinite(n) ? n : 0;
export const MELEE_ATTACK_SLOTS = 3;

export function packSeparation(self, enemies = [], { padding = .22, range = 2.8, gain = 5.2, maxNeighbors = 8 } = {}) {
  let x = 0, z = 0, count = 0, overlap = 0;
  const selfIndex = Math.max(0, enemies.indexOf(self));
  for (let i = 0; i < enemies.length; i++) {
    const other = enemies[i];
    if (!other || other === self || !other.alive || other.spawning) continue;
    const dx = finite(self?.pos?.x) - finite(other?.pos?.x), dz = finite(self?.pos?.z) - finite(other?.pos?.z);
    if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
    const min = Math.max(.6, finite(self?.radius) + finite(other?.radius) + padding);
    let d = Math.hypot(dx, dz), nx, nz;
    if (d >= min) continue;
    if (d < 1e-4) { nx = ((selfIndex + i) & 1) ? 1 : -1; nz = ((selfIndex ^ i) & 2) ? .35 : -.35; d = 0; }
    else { nx = dx / d; nz = dz / d; }
    const penetration = min - d;
    x += nx * penetration * gain; z += nz * penetration * gain; overlap += penetration;
    if (++count >= maxNeighbors) break;
  }
  return { x, z, count, overlap };
}

export function canCommitMelee(self, enemies = [], player, { slots = MELEE_ATTACK_SLOTS, radius = 6.5 } = {}) {
  if (!self || self.isBoss || self.isElite || self.def?.ranged || self.mobRole) return true;
  let active = 0;
  for (const other of enemies) {
    if (!other || other === self || !other.alive || other.spawning || other.isBoss || other.isElite || other.def?.ranged) continue;
    if (other.state !== 'attack') continue;
    if (player?.pos && Math.hypot(finite(other.pos?.x) - finite(player.pos.x), finite(other.pos?.z) - finite(player.pos.z)) > radius) continue;
    if (++active >= slots) return false;
  }
  return true;
}

export function packSteer(self, player, separation = { x: 0, z: 0 }, canAttack = true) {
  const out = { x: finite(separation.x), z: finite(separation.z) };
  if (canAttack || !self?.pos || !player?.pos) return out;
  const dx = finite(player.pos.x) - finite(self.pos.x), dz = finite(player.pos.z) - finite(self.pos.z), d = Math.hypot(dx, dz) || 1;
  if (d > 5.5) return out;
  const side = self.packSide < 0 ? -1 : 1;
  const orbit = d < 4.8 ? 1.35 : .7;
  out.x += (-dz / d) * side * orbit; out.z += (dx / d) * side * orbit;
  if (d < 2.35) { const retreat = (2.35 - d) * 2.2; out.x -= dx / d * retreat; out.z -= dz / d * retreat; }
  return out;
}
