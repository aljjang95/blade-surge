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
