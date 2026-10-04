import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Floor } from '../src/game/world.js';
import { buildExpeditionStage, buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { expeditionDepth } from '../src/data/expedition-depths.js';
import { discoveredMapView } from '../src/ui/battle-objective-view.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';

type LoopRoom = { id: number; gx: number; gy: number; x: number; z: number; w: number; h: number;
  type: string; pathLen: number; links: number[]; discovered: boolean; cleared: boolean };
type MapEdge = { fromId: number; toId: number; points: number[][]; sealed: boolean };
const roomShape = ({ id, gx, gy, x, z, w, h, type, pathLen }: LoopRoom) => ({ id, gx, gy, x, z, w, h, type, pathLen });
const cell = (world: Floor, room: LoopRoom) => Math.floor(room.z - world.minZ!) * world.cols! + Math.floor(room.x - world.minX!);
const garden = () => buildExpeditionStage('dungeon', 'glass_garden', null);

test('기본 정원 순환은 기존 방·봉인·난수 진행을 보존하고 물리 연결 하나만 더한다', () => {
  const stage = garden(), world = buildExpeditionWorld(stage);
  const baseline = new Floor(stage.idx, stage.theme, world.seed, EXPEDITION_LAYOUTS.glass_garden as any);
  const currentRooms: LoopRoom[] = world.rooms, originalRooms: LoopRoom[] = baseline.rooms;
  expect(world.seed).toBe(3944785920);
  expect(currentRooms.map(roomShape)).toEqual(originalRooms.map(roomShape));
  expect(world.gates).toEqual(baseline.gates);
  expect(world.bossRoom.id).toBe(4); expect(world.bossRoom.links).toEqual([3]);
  expect(world.linkPending.length - world.rooms.length + 1).toBe(1);
  expect(world.corridors.length).toBe(baseline.corridors.length + 2);
  expect(currentRooms[2].links).toEqual([1, 3]); expect(currentRooms[3].links).toEqual([1, 4, 2]);
  expect(Array.from({ length: 8 }, () => world.rand())).toEqual(Array.from({ length: 8 }, () => baseline.rand()));
});

test('새 L자 회랑은 실제 .56 이동 반경으로 양방향 통과하며 봉인된 보스를 우회하지 않는다', () => {
  const stage = garden(), world = buildExpeditionWorld(stage);
  const baseline = new Floor(stage.idx, stage.theme, world.seed, EXPEDITION_LAYOUTS.glass_garden as any);
  const rooms: LoopRoom[] = world.rooms, a = rooms[2], b = rooms[3];
  const points = [[a.x, a.z], [b.x, a.z], [b.x, b.z]];
  expect(baseline.walkable((a.x + b.x) / 2, a.z)).toBe(false);
  for (const route of [points, [...points].reverse()]) {
    let [x, z] = route[0];
    for (const [tx, tz] of route.slice(1)) {
      const sx = x, sz = z, steps = Math.ceil(Math.hypot(tx - sx, tz - sz) / .2);
      for (let step = 1; step <= steps; step++) {
        const nx = sx + (tx - sx) * step / steps, nz = sz + (tz - sz) * step / steps;
        expect(world.walkable(nx + .56, nz) && world.walkable(nx - .56, nz)
          && world.walkable(nx, nz + .56) && world.walkable(nx, nz - .56)).toBe(true);
        expect(world.resolve(x, z, nx, nz, .56)).toEqual([nx, nz]);
        [x, z] = [nx, nz];
      }
    }
  }
  const sealed = world.buildFlow(world.startRoom.x, world.startRoom.z)!;
  for (const room of rooms) expect(sealed[cell(world, room)] >= 0).toBe(room.id !== 4);
  expect(world.sealed).toBe(true);
  world.unseal();
  const open = world.buildFlow(world.bossRoom.x, world.bossRoom.z)!;
  for (const room of rooms) expect(open[cell(world, room)]).toBeGreaterThanOrEqual(0);
});

test('새 회랑의 발견 정보는 양끝을 실제로 발견하기 전에는 지도에 나타나지 않는다', () => {
  const world = buildExpeditionWorld(garden()), rooms: LoopRoom[] = world.rooms;
  rooms[2].discovered = true;
  expect(discoveredMapView(world).corridors.some((edge: MapEdge) => edge.fromId === 2 && edge.toId === 3)).toBe(false);
  rooms[3].discovered = true;
  const view = discoveredMapView(world), loop = view.corridors.find((edge: MapEdge) => edge.fromId === 2 && edge.toId === 3)!;
  expect(loop.points).toEqual([[rooms[2].x, rooms[2].z], [rooms[3].x, rooms[2].z], [rooms[3].x, rooms[3].z]]);
  expect(view.rooms.some((room: { id: number }) => room.id === 4)).toBe(false);
  expect(loop.sealed).toBe(false); expect(view.sealed).toBe(true);
});

test('심층·다른 지역·파티·균열·전술 공략은 새 정원 회랑을 얻지 않는다', () => {
  const standard = garden();
  const stages = [buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep' }),
    buildExpeditionStage('dungeon', 'ember_vault', null),
    { ...standard, party: { seed: 7 } }, { ...standard, riftId: 'iron' },
    { ...standard, expedition: { ...standard.expedition, riftId: 'iron' } },
    { ...standard, expedition: { ...standard.expedition, conquestId: 'garden_dawn' } }];
  for (const stage of stages) {
    const world = buildExpeditionWorld(stage), route = stage.expedition;
    const layout = route.depth === 'deep' ? expeditionDepth(route.id)!.layout : EXPEDITION_LAYOUTS[route.id as 'glass_garden' | 'ember_vault'];
    const baseline = new Floor(stage.idx, stage.theme, world.seed, layout as any);
    expect(world.linkPending).toEqual(baseline.linkPending);
    expect(world.corridors).toEqual(baseline.corridors);
    expect(Array.from(world.mask!)).toEqual(Array.from(baseline.mask!));
  }
});

test('새 회랑 양끝의 높은 지역 장식은 전체 바닥 면적이 실제 이동 마스크와 겹치지 않는다', () => {
  const world = buildExpeditionWorld(garden()), before = Array.from(world.mask!);
  const group = buildRegionArchitecture(world, 'garden');
  for (const node of group.children) {
    if (!/^garden-room-[23]-/.test(node.name)) continue;
    const mesh = node as THREE.Mesh, position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 3) {
      if (Math.max(position.getY(i), position.getY(i + 1), position.getY(i + 2)) <= .2) continue;
      const xs = [position.getX(i), position.getX(i + 1), position.getX(i + 2)];
      const zs = [position.getZ(i), position.getZ(i + 1), position.getZ(i + 2)];
      const x0 = Math.floor(Math.min(...xs) - world.minX!), x1 = Math.floor(Math.max(...xs) - world.minX!);
      const z0 = Math.floor(Math.min(...zs) - world.minZ!), z1 = Math.floor(Math.max(...zs) - world.minZ!);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (x >= 0 && z >= 0 && x < world.cols! && z < world.rows!) expect(world.mask![z * world.cols! + x]).toBe(0);
      }
    }
  }
  expect(Array.from(world.mask!)).toEqual(before);
  expect(group.children.length).toBeLessThanOrEqual(world.rooms.length * 3);
  group.userData.dispose();
});
