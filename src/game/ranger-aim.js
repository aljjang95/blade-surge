/**
 * 수동 궁수 기본 공격의 조준 보조. 이동 입력과 조준을 분리한다.
 *  · 대상: 살아 있고 등장·잠복 중이 아니며(spawning) 사거리(화살 도달 거리 + 몸 반경) 안에 있고 벽에 가리지 않은 적.
 *  · 기존 조준 대상이 같은 사거리 안에서 여전히 유효하면 더 가까운 적이 생겨도 유지한다(대상 튐 방지).
 *    사거리 밖·현재 적 목록에서 빠진 대상(소멸·방 교체)은 유지하지 않는다. 아니면 가장 가까운 대상, 동률은 적 목록 순서.
 *  · 대상이 없으면 null 을 돌려 호출자가 기존 방향으로 쏜다. 위치 이동·순간 이동·AUTO 전환을 만들지 않는다.
 *  · 난수를 쓰지 않으므로 같은 입력·같은 상태에서 같은 대상을 고른다(리플레이 결정성).
 */
const SIGHT_STEP = .5;

/** 월드 보행 마스크를 따라 직선 시야를 검사한다. 마스크가 없는 아레나는 막힘이 없다. */
export function clearShot(world, ax, az, bx, bz, targetRadius = 0) {
  if (!world?.walkable) return true;
  const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
  const reach = length - Math.max(.35, targetRadius);
  if (reach <= SIGHT_STEP) return true;
  const ux = dx / length, uz = dz / length;
  for (let d = SIGHT_STEP; d < reach; d += SIGHT_STEP) if (!world.walkable(ax + ux * d, az + uz * d)) return false;
  return true;
}

export function aimTargetValid(shooter, enemy, range, world = shooter.game?.world) {
  if (!enemy || !enemy.alive || enemy.spawning || enemy.dead || (enemy.invuln || 0) > 0) return false;
  const dx = enemy.pos.x - shooter.pos.x, dz = enemy.pos.z - shooter.pos.z, distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance - (enemy.radius || 0) > range) return false;
  return clearShot(world, shooter.pos.x, shooter.pos.z, enemy.pos.x, enemy.pos.z, enemy.radius || 0);
}

export class RangerAim {
  constructor() { this.target = null; this.yaw = null; }
  clear() { this.target = null; this.yaw = null; }
  /**
   * @param {{pos:{x:number,z:number}, game:{enemies:any[], world?:any}}} shooter
   * @param {number} range 화살 도달 거리
   * @returns {any|null}
   */
  select(shooter, range) {
    const world = shooter.game?.world, enemies = shooter.game?.enemies || [];
    // 잠금 유지도 실제 화살 도달 범위 안에서만 한다. 범위 밖까지 늘리는 여유는 두지 않는다.
    if (this.target && enemies.includes(this.target) && aimTargetValid(shooter, this.target, range, world)) return this.target;
    let best = null, bestDistance = Infinity;
    for (const enemy of enemies) {
      if (!aimTargetValid(shooter, enemy, range, world)) continue;
      const distance = Math.hypot(enemy.pos.x - shooter.pos.x, enemy.pos.z - shooter.pos.z);
      if (distance < bestDistance - 1e-6) { best = enemy; bestDistance = distance; }
    }
    this.target = best;
    return best;
  }
  /** 현재 대상이 아직 유효할 때만 방향을 준다. 발사 순간에는 다시 select 해 무효 대상을 버린다. */
  yawTo(shooter, target = this.target) {
    if (!target) return null;
    const dx = target.pos.x - shooter.pos.x, dz = target.pos.z - shooter.pos.z;
    return dx || dz ? Math.atan2(dx, dz) : null;
  }
}
