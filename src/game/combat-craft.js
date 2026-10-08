const finite = n => Number.isFinite(n) ? n : 0;
export const MELEE_ATTACK_SLOTS = 3;

export function packSeparation(self, enemies = [], { padding = .22, range = 2.8, gain = 5.2, maxNeighbors = 8 } = {}) {
  let x = 0, z = 0, count = 0, overlap = 0;
  for (let i = 0; i < enemies.length; i++) {
    const other = enemies[i];
    if (!other || other === self || !other.alive || other.spawning) continue;
    const dx = finite(self?.pos?.x) - finite(other?.pos?.x), dz = finite(self?.pos?.z) - finite(other?.pos?.z);
    if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
    const min = Math.max(.6, finite(self?.radius) + finite(other?.radius) + padding);
    let d = Math.hypot(dx, dz), nx, nz;
    if (d >= min) continue;
    if (d < 1e-4) {
      // 완전히 겹친 쌍도 서로 반대로 밀어낸다. 생성 순번을 쓰므로 명단 순서나
      // 렌더 주기와 무관하며 새 난수로 공격·드랍 시드를 소비하지 않는다.
      const selfId = Number.isSafeInteger(self?.packId) ? self.packId : Math.max(0, enemies.indexOf(self));
      const otherId = Number.isSafeInteger(other.packId) ? other.packId : i;
      const angle = (Math.min(selfId, otherId) * 17 + Math.max(selfId, otherId) * 31) * 2.399963;
      const side = selfId < otherId || (selfId === otherId && enemies.indexOf(self) < i) ? -1 : 1;
      nx = Math.cos(angle) * side; nz = Math.sin(angle) * side; d = 0;
    }
    else { nx = dx / d; nz = dz / d; }
    const penetration = min - d;
    x += nx * penetration * gain; z += nz * penetration * gain; overlap += penetration;
    if (++count >= maxNeighbors) break;
  }
  return { x, z, count, overlap };
}

export function canCommitMelee(self, enemies = [], player, { slots = MELEE_ATTACK_SLOTS, radius = 6.5 } = {}) {
  if (!self || self.isBoss || self.isElite || self.def?.ranged) return true;
  let active = 0;
  for (const other of enemies) {
    if (!other || other === self || !other.alive || other.spawning || other.isBoss || other.isElite || other.def?.ranged) continue;
    if (other.state !== 'attack') continue;
    // 먼 거리에서 준비한 돌격도 곧 근접한다. 역할 계획은 기존 전역 3명
    // 한도와 함께 점유해 적 갱신 순서로 일반 공격이 추가 진입하지 못하게 한다.
    if (!other.mobRole?.plan && player?.pos && Math.hypot(finite(other.pos?.x) - finite(player.pos.x), finite(other.pos?.z) - finite(player.pos.z)) > radius) continue;
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
