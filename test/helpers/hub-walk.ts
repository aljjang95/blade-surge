import { HubMovement } from '../../src/game/hub-movement.js';

/**
 * 마을 배치(hub)에서 spawn 으로부터 걸어서 닿는 격자 칸 집합과 hotspot 도달 여부를 구한다.
 * 이동 규칙은 실제 HubMovement(_walkable · 경계 · 반경 .34)를 그대로 쓴다. 도달 조건 = 닿는 칸과의 거리 < interactionRadius.
 */
export function hubReach(hub: any, step = .2) {
  const mover: any = new HubMovement({ bounds: hub.bounds, spawn: hub.spawn, hotspots: hub.hotspots, blockers: hub.blockers });
  const { minX, maxX, minZ, maxZ } = hub.bounds, r = mover.radius;
  const nx = Math.floor((maxX - minX - 2 * r) / step) + 1, nz = Math.floor((maxZ - minZ - 2 * r) / step) + 1;
  const px = (i: number) => minX + r + i * step, pz = (j: number) => minZ + r + j * step;
  const seen = new Uint8Array(nx * nz);
  // spawn 에서 가장 가까운 칸에서 시작한다.
  const si = Math.round((hub.spawn.x - minX - r) / step), sj = Math.round((hub.spawn.z - minZ - r) / step);
  const queue: number[] = [];
  if (mover._walkable(px(si), pz(sj))) { seen[si * nz + sj] = 1; queue.push(si * nz + sj); }
  for (let head = 0; head < queue.length; head++) {
    const i = Math.floor(queue[head] / nz), j = queue[head] % nz;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[a * nz + b] || !mover._walkable(px(a), pz(b))) continue;
      seen[a * nz + b] = 1; queue.push(a * nz + b);
    }
  }
  const cells = queue.map(index => ({ x: px(Math.floor(index / nz)), z: pz(index % nz) }));
  const nearestDistance = (spot: any) => cells.reduce((best, cell) => Math.min(best, Math.hypot(cell.x - spot.x, cell.z - spot.z)), Infinity);
  return { cells, nearestDistance, reaches: (spot: any) => nearestDistance(spot) < spot.interactionRadius };
}
