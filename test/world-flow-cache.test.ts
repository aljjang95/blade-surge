import { expect, test } from 'bun:test';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';

// buildFlow 는 마지막 거리장 하나를 캐시한다. 같은 반올림 좌표라도 다른 칸이 목표면 그 칸까지의 거리장을 돌려줘야 한다.
test('buildFlow 캐시는 목표 칸이 바뀌면 새 거리장을 만든다', () => {
  const world: any = buildExpeditionWorld(buildExpeditionStage('dungeon', 'comet_bastion', null, { depth: 'deep' }));
  const room = world.rooms[1];
  // 방 1 안에서 반올림 좌표는 같고 내림 칸은 다른 두 목표.
  const kx = Math.round(room.x - 1.42), kz = Math.round(room.z + 3.74);
  const a = { x: kx - .49, z: kz - .49 }, b = { x: kx + .49, z: kz + .49 };
  const cell = (p: any) => [Math.floor(p.x - world.minX), Math.floor(p.z - world.minZ)];
  expect(cell(a)).not.toEqual(cell(b));
  const target = (flow: Int32Array) => { const i = flow.indexOf(0); return [i % world.cols, Math.floor(i / world.cols)]; };
  expect(target(world.buildFlow(a.x, a.z))).toEqual(cell(a));
  expect(target(world.buildFlow(b.x, b.z))).toEqual(cell(b));
  // 같은 칸의 다른 좌표(칸 중심)는 캐시를 그대로 쓴다.
  const [bx, bz] = cell(b), first = world.buildFlow(b.x, b.z);
  expect(world.buildFlow(world.minX + bx + .5, world.minZ + bz + .5)).toBe(first);
});

/** 수정 전 알고리즘과 같은 기준 BFS(테스트 안 참조 구현). 시작 칸이 걸을 수 없으면 null. */
function referenceFlow(world: any, tx: number, tz: number): Int32Array | null {
  const sx = Math.floor(tx - world.minX), sz = Math.floor(tz - world.minZ);
  if (sx < 0 || sz < 0 || sx >= world.cols || sz >= world.rows) return null;
  const si = sz * world.cols + sx;
  if (world.inner[si] !== 1) return null;
  const dist = new Int32Array(world.cols * world.rows).fill(-1), queue = [si];
  dist[si] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head], cz = Math.floor(cur / world.cols), cx = cur - cz * world.cols;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= world.cols || nz >= world.rows) continue;
      const ni = nz * world.cols + nx;
      if (dist[ni] !== -1 || world.inner[ni] !== 1) continue;
      dist[ni] = dist[cur] + 1; queue.push(ni);
    }
  }
  return dist;
}
/** 고정 시드 난수(mulberry32). */
function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const newWorld = (): any => buildExpeditionWorld(buildExpeditionStage('dungeon', 'comet_bastion', null, { depth: 'deep' }));

test('buildFlow 는 무작위 목표 다수에서 기준 BFS 와 같은 거리장을 주고, 같은 칸 재호출은 같은 배열을 준다', () => {
  const world = newWorld(), rand = rng(20261015);
  let walkable = 0, blocked = 0;
  for (let i = 0; i < 150; i++) {
    // 맵 가장자리 밖까지 포함해 무작위 좌표를 뽑는다.
    const x = world.minX + rand() * (world.cols + 6) - 3, z = world.minZ + rand() * (world.rows + 6) - 3;
    const flow = world.buildFlow(x, z), expected = referenceFlow(world, x, z);
    if (!expected) { expect(flow).toBeNull(); blocked++; continue; }
    walkable++;
    expect(flow).not.toBeNull();
    expect(Array.from(flow as Int32Array)).toEqual(Array.from(expected));
    expect(world.buildFlow(x, z)).toBe(flow);
  }
  // 걸을 수 있는 목표와 없는 목표가 모두 표본에 들어 있어야 위 검사가 의미가 있다.
  expect(walkable).toBeGreaterThan(20); expect(blocked).toBeGreaterThan(5);
});

test('걸을 수 없는 목표는 null 이고 직전 캐시의 키·배열·내용을 바꾸지 않는다', () => {
  const world = newWorld(), room = world.rooms[1];
  const flow = world.buildFlow(room.x, room.z) as Int32Array, key = world._flowKey, snapshot = Array.from(flow);
  // 지도 밖과 벽 칸.
  let wall: number[] | null = null;
  for (let i = 0; i < world.inner.length && !wall; i++) if (world.inner[i] !== 1) wall = [world.minX + (i % world.cols) + .5, world.minZ + Math.floor(i / world.cols) + .5];
  expect(wall).not.toBeNull();
  for (const [x, z] of [wall!, [world.minX - 5, world.minZ], [world.minX, world.minZ + world.rows + 5]]) expect(world.buildFlow(x, z)).toBeNull();
  expect(world._flowKey).toBe(key); expect(world._flow).toBe(flow);
  expect(Array.from(flow)).toEqual(snapshot);
  expect(world.buildFlow(room.x, room.z)).toBe(flow);
});

test('이미 받은 거리장은 다른 목표로 buildFlow 를 불러도 내용이 바뀌지 않는다', () => {
  const world = newWorld(), rand = rng(7);
  // 생성자들이 시작 방 거리장을 받아 쓰는 것과 같은 상황.
  const held = world.buildFlow(world.startRoom.x, world.startRoom.z) as Int32Array, snapshot = Array.from(held);
  for (let i = 0; i < 60; i++) {
    const r = world.rooms[Math.floor(rand() * world.rooms.length)];
    const other = world.buildFlow(r.x + (rand() - .5) * 3, r.z + (rand() - .5) * 3);
    if (other && other !== held) expect(other).not.toBe(held);
  }
  expect(Array.from(held)).toEqual(snapshot);
  expect(Array.from(held)).toEqual(Array.from(referenceFlow(world, world.startRoom.x, world.startRoom.z)!));
});
