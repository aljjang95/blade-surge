import { expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Floor, ROOM_TYPE } from '../src/game/world.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionFollowers, expeditionRoster, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { Pack, pickRoomPack, planRoomPacks, packSlot } from '../src/game/pack-pursuit.js';
import { GLASS_GARDEN_KIT_ASSETS, extractKitGeometry } from '../src/engine/glass-garden-kit.js';
import { createMapTactics } from '../src/game/map-tactics.js';
import { GLASS_GARDEN_DECOR, GLASS_GARDEN_PROPS, buildGlassGardenDecor, footprintGap, footprintPoints, packSlotPoints, planGlassGardenDecor, placementViolation,
  roomFixtures, tacticPoints, walkableRect, wallOpenings } from '../src/game/glass-garden-decor.js';

setDefaultTimeout(30_000);
const root = new URL('../', import.meta.url);

// 실제 첫 던전(기본·심층)과 같은 길로 만든 월드, 그리고 같은 레이아웃의 다른 시드 월드.
function gardenWorld(depth: 'standard' | 'deep') {
  return buildExpeditionWorld(buildExpeditionStage('dungeon', 'glass_garden', null, { depth }));
}
function seededWorld(seed: number) {
  const world = new Floor(1, 'garden', seed, EXPEDITION_LAYOUTS.glass_garden);
  (world as any).expeditionRouteId = 'glass_garden';
  return world;
}
const worlds = (): [string, any][] => [['기본', gardenWorld('standard')], ['심층', gardenWorld('deep')],
  ...[11, 29, 4242, 90210].map(seed => [`시드 ${seed}`, seededWorld(seed)] as [string, any])];

test('유리 정원에서만 장식하고 층 난수·시드·마스크를 건드리지 않으며 같은 층은 같은 배치다', () => {
  const world = gardenWorld('standard'), twin = gardenWorld('standard');
  const maskBefore = createHash('sha256').update(world.mask!).digest('hex');
  const rooms = JSON.stringify(world.rooms.map((room: any) => [room.id, room.x, room.z, room.w, room.h, room.type]));
  const plan = planGlassGardenDecor(world);
  // 계획이 층 난수를 소비했다면 같은 시드의 쌍둥이 월드와 다음 값이 어긋난다.
  expect(world.rand()).toBe(twin.rand());
  expect(plan.length).toBeGreaterThan(20);
  expect(planGlassGardenDecor(world)).toEqual(plan);
  expect(createHash('sha256').update(world.mask!).digest('hex')).toBe(maskBefore);
  expect(JSON.stringify(world.rooms.map((room: any) => [room.id, room.x, room.z, room.w, room.h, room.type]))).toBe(rooms);
  // 다른 던전·다른 길은 배치가 없다.
  expect(planGlassGardenDecor(buildExpeditionWorld(buildExpeditionStage('dungeon', 'ember_vault', null)))).toEqual([]);
  expect(planGlassGardenDecor(new Floor(1, 'garden'))).toEqual([]);
  // 시드가 달라지면 방 크기·배치도 달라진다.
  expect(JSON.stringify(planGlassGardenDecor(seededWorld(11)))).not.toBe(JSON.stringify(planGlassGardenDecor(seededWorld(29))));
});

test('모든 배치는 여유 규칙을 지킨다: 발자국이 벽 띠 안, 입구·봉인·기둥·횃불·랜드마크·장치와 겹치지 않는다', () => {
  for (const [name, world] of worlds()) {
    const plan = planGlassGardenDecor(world);
    expect(plan.length, name).toBeGreaterThan(15);
    const byRoom = new Map<number, any[]>();
    for (const placement of plan) byRoom.set(placement.roomId, [...(byRoom.get(placement.roomId) || []), placement]);
    for (const [roomId, list] of byRoom) {
      const room = world.rooms[roomId], rect = walkableRect(world, room), fix = roomFixtures(room);
      const placed: any[] = [];
      for (const placement of list) {
        expect(placementViolation(world, room, placement, placed), `${name} 방${roomId} ${placement.asset}@${placement.wall}`).toBeNull();
        placed.push(placement);
        const spec = (GLASS_GARDEN_PROPS as Record<string, any>)[placement.asset];
        expect(Object.keys(GLASS_GARDEN_PROPS)).toContain(placement.asset);
        // 앞면이 방 안쪽을 본다: 벽 방향 단위 벡터와 +Z 회전 결과가 같다.
        const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[placement.wall as 'N'];
        const front = [Math.sin(placement.yaw), Math.cos(placement.yaw)];
        const dot = front[0] * inward[0] + front[1] * inward[1];
        expect(dot).toBeGreaterThan(spec.spin ? 0.6 : 0.999);
        for (const [x, z] of footprintPoints(placement)) {
          const toWall = { N: z - rect.z0, S: rect.z1 - z, W: x - rect.x0, E: rect.x1 - x }[placement.wall as 'N'];
          expect(toWall).toBeGreaterThanOrEqual(GLASS_GARDEN_DECOR.wallGap - 1e-6);
          expect(toWall).toBeLessThanOrEqual(GLASS_GARDEN_DECOR.bandDepth + 1e-6);
          // 스폰 영역(randomIn 여백 2.5, 이름 상 방 가장자리 기준)과 겹치지 않는다.
          const inSpawn = Math.abs(x - room.x) < room.w / 2 - 2.5 && Math.abs(z - room.z) < room.h / 2 - 2.5;
          expect(inSpawn, `${name} 방${roomId} 스폰 영역 침범`).toBe(false);
          // 복도(문) 사각형 안에는 발자국이 없다.
          for (const corridor of world.corridors) {
            const inside = Math.abs(x - corridor.x) < corridor.w / 2 + .1 && Math.abs(z - corridor.z) < corridor.h / 2 + .1;
            expect(inside, `${name} 방${roomId} 복도 침범`).toBe(false);
          }
        }
        // 방 중심(영웅 시작·상자·코인), 환경 제어 지점은 발자국에서 충분히 멀다.
        for (const point of [{ x: room.x, z: room.z }, ...tacticPoints(room)]) {
          const nearest = Math.min(...footprintPoints(placement).map(([x, z]) => Math.hypot(x - point.x, z - point.z)));
          expect(nearest).toBeGreaterThan(2);
        }
        for (const point of [...fix.pillars, ...fix.torches, ...fix.banners]) {
          const nearest = Math.min(...footprintPoints(placement).map(([x, z]) => Math.hypot(x - point.x, z - point.z)));
          expect(nearest).toBeGreaterThan(.2);
        }
        if (placement.wall === 'S') expect(spec.height * placement.scale).toBeLessThanOrEqual(GLASS_GARDEN_DECOR.cameraSideMaxHeight);
      }
      // 입구 구간마다 발자국과 doorMargin 이상 떨어진다.
      for (const door of wallOpenings(world, rect)) for (const placement of list) {
        const nearest = Math.min(...footprintPoints(placement).map(([x, z]) => Math.hypot(x - door[0], z - door[1])));
        expect(nearest, `${name} 방${roomId} 입구 여유`).toBeGreaterThanOrEqual(GLASS_GARDEN_DECOR.doorMargin - .25);
      }
    }
    // 보스 봉인 사각형 주변은 비어 있다.
    for (const gate of world.gates || []) for (const placement of plan) {
      const clear = Math.abs(placement.x - gate.x) >= gate.w / 2 + GLASS_GARDEN_DECOR.gateMargin || Math.abs(placement.z - gate.z) >= gate.h / 2 + GLASS_GARDEN_DECOR.gateMargin;
      expect(clear, `${name} 봉인 근처`).toBe(true);
    }
  }
});

test('발자국을 전부 막힌 칸으로 쳐도 모든 방이 시작방에서 이어지고 방 중앙 이동 영역은 전혀 줄지 않는다', () => {
  for (const [name, world] of worlds()) {
    const plan = planGlassGardenDecor(world);
    const blocked = new Uint8Array(world.cols * world.rows);
    for (const placement of plan) for (const [x, z] of footprintPoints(placement)) {
      blocked[Math.floor(z - world.minZ) * world.cols + Math.floor(x - world.minX)] = 1;
    }
    // 연결: 막힌 칸을 제외하고 시작방 중심에서 BFS(8-이웃 침식 없이 4-이웃).
    const start = world.startRoom, seen = new Uint8Array(world.mask.length);
    const index = (x: number, z: number) => Math.floor(z - world.minZ) * world.cols + Math.floor(x - world.minX);
    const queue = [index(start.x, start.z)]; seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head], z = Math.floor(at / world.cols), x = at - z * world.cols;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, ni = nz * world.cols + nx;
        if (nx < 0 || nz < 0 || nx >= world.cols || nz >= world.rows || seen[ni] || blocked[ni] || !world.architectureMask[ni]) continue;
        seen[ni] = 1; queue.push(ni);
      }
    }
    for (const room of world.rooms) expect(seen[index(room.x, room.z)], `${name} 방${room.id} 도달`).toBe(1);
    // 방 중앙(가장자리 2.5m 바깥) 칸은 하나도 막히지 않았다.
    for (const room of world.rooms) {
      const x0 = Math.ceil(room.x - room.w / 2 + 2.5), x1 = Math.floor(room.x + room.w / 2 - 2.5);
      const z0 = Math.ceil(room.z - room.h / 2 + 2.5), z1 = Math.floor(room.z + room.h / 2 - 2.5);
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) expect(blocked[index(x + .5, z + .5)]).toBe(0);
    }
    // 복도 중심선 칸도 막히지 않았다.
    for (const corridor of world.corridors) {
      const horizontal = corridor.w > corridor.h, half = (horizontal ? corridor.h : corridor.w) / 2 - .5;
      for (let t = -half; t <= half; t += 1) expect(blocked[index(corridor.x + (horizontal ? 0 : t), corridor.z + (horizontal ? t : 0))]).toBe(0);
    }
  }
});

// ---- 무리 대형(planRoomPacks·pickRoomPack·packSlot 운영 경로) ----
const packWorlds = () => {
  const rows: [string, any, any][] = [];
  for (const depth of ['standard', 'deep'] as const) {
    const stage = buildExpeditionStage('dungeon', 'glass_garden', null, { depth });
    rows.push([depth, buildExpeditionWorld(stage), stage]);
  }
  const stage = buildExpeditionStage('dungeon', 'glass_garden', null);
  for (const seed of [11, 29, 4242]) rows.push([`시드 ${seed}`, seededWorld(seed), stage]);
  return rows;
};

test('장식 배치가 가정한 방 명단·졸개 수가 운영 명단을 덮는다', () => {
  for (const [name, world, stage] of packWorlds()) for (const room of world.rooms) {
    if (!['normal', 'elite', 'treasure'].includes(room.type)) continue;
    const [lo, hi] = (GLASS_GARDEN_DECOR.packRoster as Record<string, number[]>)[room.type];
    const roster = expeditionRoster(stage, room).length;
    expect(roster, `${name} 방${room.id}`).toBeGreaterThanOrEqual(lo); expect(roster).toBeLessThanOrEqual(hi);
    const followers = expeditionFollowers(stage, room, roster).length;
    const share = (GLASS_GARDEN_DECOR.packFollowerShare as Record<string, number>)[room.type];
    expect(followers).toBeLessThanOrEqual(Math.max(3, Math.min(7, Math.round(roster * share))));
  }
});

test('운영 무리 경로가 세울 수 있는 모든 자리(진입 격자 × 영웅 위치 × 졸개 포함)가 장식 발자국에서 clearance 이상 떨어진다', () => {
  let checked = 0, slots = 0;
  for (const [name, world, stage] of packWorlds()) {
    let combat = 0;
    const plan = planGlassGardenDecor(world);
    for (const room of world.rooms) {
      if (!['normal', 'elite', 'treasure'].includes(room.type)) continue;
      const decor = plan.filter((entry: any) => entry.roomId === room.id);
      expect(decor.length, `${name} 방${room.id}에 장식이 남아 있다`).toBeGreaterThanOrEqual(1);
      combat += decor.length;
      const roster = expeditionRoster(stage, room).length, total = roster + expeditionFollowers(stage, room, roster).length;
      const rect = walkableRect(world, room);
      // 구현이 쓰지 않은 독립 표본: 방 전체 3 m 격자와 모든 입구 안쪽 지점을 진입 위치로, 영웅은 진입 위치 또는 그 주변.
      const entries: { x: number; z: number }[] = [{ x: room.x, z: room.z }];
      for (let x = rect.x0 + 1.5; x < rect.x1; x += 3) for (let z = rect.z0 + 1.5; z < rect.z1; z += 3) entries.push({ x, z });
      for (const door of wallOpenings(world, rect).filter((_, i) => i % 3 === 0)) entries.push({ x: door[0] + Math.sign(room.x - door[0]) * .8, z: door[1] + Math.sign(room.z - door[1]) * .8 });
      for (const entry of entries) {
        const planned = planRoomPacks(world, room, roster, entry.x, entry.z)!;
        for (const [hx, hz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
          const hero = { x: entry.x + hx, z: entry.z + hz }, fake = { packs: planned.map((pack: any) => new Pack(room, pack.x, pack.z)), packCursor: 0 }, out = { x: 0, z: 0 };
          for (let i = 0; i < total; i++) {
            packSlot(world, pickRoomPack(fake, hero), out); slots++;
            for (const placement of decor) {
              if (footprintGap(placement, out.x, out.z) < GLASS_GARDEN_DECOR.packClearance - 1e-9) {
                throw new Error(`${name} 방${room.id} 진입 ${entry.x.toFixed(1)},${entry.z.toFixed(1)} 슬롯 ${out.x.toFixed(2)},${out.z.toFixed(2)}가 ${placement.asset}(${placement.x.toFixed(1)},${placement.z.toFixed(1)}) 안`);
              }
            }
          }
          checked++;
        }
      }
    }
    expect(combat, `${name} 전투방 장식 합계(장식이 사라져 검사가 헛돌지 않게)`).toBeGreaterThanOrEqual(8);
  }
  expect(checked).toBeGreaterThan(1000); expect(slots).toBeGreaterThan(10000);
});

test('무리 자리 집합은 층에서만 정해지고(결정적) 시작·보스방에는 없다, 장식은 그 집합과 겹치지 않는다', () => {
  const world = gardenWorld('standard');
  expect(packSlotPoints(world, world.startRoom)).toEqual([]);
  expect(packSlotPoints(world, world.bossRoom)).toEqual([]);
  const room = world.rooms[1], once = packSlotPoints(world, room);
  expect(once.length).toBeGreaterThan(20);
  expect(packSlotPoints(gardenWorld('standard'), gardenWorld('standard').rooms[1])).toEqual(once);
  // 일부러 슬롯 위에 놓은 후보는 거부된다.
  const slot = once[0], rect = walkableRect(world, room);
  const probe = { asset: 'crystal-cluster-s', roomId: room.id, wall: 'W', x: slot.x, z: slot.z, yaw: Math.PI / 2, scale: 1, tone: 0 };
  expect(footprintGap(probe, slot.x, slot.z)).toBe(0);
  expect(placementViolation(world, room, { ...probe, x: rect.x0 + .9 })).not.toBeNull();
  const violation = (p: any) => placementViolation(world, room, p);
  const onSlot = once.find((point: any) => violation({ ...probe, x: point.x, z: point.z }) === 'pack');
  expect(onSlot).toBeDefined();
});

test('환경 제어 장치방(방 3)의 조작판·당김 종착점은 MapTactics 실제 좌표와 같은 식으로 비운다', () => {
  const stage = buildExpeditionStage('dungeon', 'glass_garden', null);
  const world = buildExpeditionWorld(stage);
  const tactics = createMapTactics(stage, world)!;
  const mine = tacticPoints(world.rooms[3]);
  expect(mine).toHaveLength(4);
  for (const node of tactics.nodes) {
    expect(mine.some((point: any) => Math.abs(point.x - node.operator.x) < 1e-9 && Math.abs(point.z - node.operator.z) < 1e-9)).toBe(true);
    expect(mine.some((point: any) => Math.abs(point.x - node.anchor.x) < 1e-9 && Math.abs(point.z - node.anchor.z) < 1e-9)).toBe(true);
  }
  for (const placement of planGlassGardenDecor(world).filter((entry: any) => entry.roomId === 3)) {
    for (const node of tactics.nodes) for (const point of [node.operator, node.anchor]) {
      const nearest = Math.min(...footprintPoints(placement).map(([x, z]) => Math.hypot(x - point.x, z - point.z)));
      expect(nearest).toBeGreaterThan(2.5);
    }
  }
});

test('같은 규칙이 일부러 어긴 배치를 거부한다(입구·기둥·랜드마크·낮은 띠·겹침)', () => {
  const world = gardenWorld('standard');
  const room = world.rooms[1], rect = walkableRect(world, room);
  const inset = (asset: string) => { const spec = (GLASS_GARDEN_PROPS as Record<string, any>)[asset]; return GLASS_GARDEN_DECOR.wallGap + (spec.shape === 'rect' ? spec.depth : spec.radius) + .1; };
  const at = (asset: string, wall: 'N' | 'S' | 'W' | 'E', u: number, yaw = ({ N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 })[wall]) => ({
    asset, roomId: room.id, wall, yaw, scale: 1, tone: 0,
    x: wall === 'W' ? rect.x0 + inset(asset) : wall === 'E' ? rect.x1 - inset(asset) : u,
    z: wall === 'N' ? rect.z0 + inset(asset) : wall === 'S' ? rect.z1 - inset(asset) : u });
  // 실제 입구 한가운데
  const door = wallOpenings(world, rect).find(d => d[0] === rect.x0 || d[0] === rect.x1)!;
  expect(door).toBeDefined();
  const doorWall = door[0] === rect.x0 ? 'W' : 'E';
  expect(placementViolation(world, room, at('crystal-cluster-s', doorWall, door[1]))).toBe('door');
  // 입구에서 충분히 떨어진 같은 벽 자리는 통과한다(기둥·횃불을 피해 모서리 쪽 빈 곳).
  const clear = [...Array(40)].map((_, i) => rect.z0 + 1 + i * .5).filter(z => !placementViolation(world, room, at('crystal-cluster-s', doorWall, z)));
  expect(clear.length).toBeGreaterThanOrEqual(1);
  // 중앙 이동 영역(벽 띠 밖)은 거부
  expect(placementViolation(world, room, { ...at('crystal-cluster-l', 'N', room.x), z: room.z })).toMatch(/lane/);
  // 보이는 벽 속·벽 밖
  expect(placementViolation(world, room, { ...at('crystal-cluster-s', 'W', room.z), x: rect.x0 - .4 })).toMatch(/in-wall|blocked/);
  // 기둥 위
  const pillar = roomFixtures(room).pillars[0];
  expect(placementViolation(world, room, { ...at('crystal-cluster-s', 'W', pillar.z), x: pillar.x })).not.toBeNull();
  // 카메라 쪽(남쪽) 띠의 키 큰 소품
  expect(placementViolation(world, room, at('hanging-lantern', 'S', room.x + 3.1))).toBe('camera-side');
  expect(placementViolation(world, room, at('trellis-arch', 'S', room.x + 3.1))).toBe('camera-side');
  // 겹침
  const first = at('crystal-cluster-s', 'W', clear[0]);
  expect(placementViolation(world, room, first)).toBeNull();
  expect(placementViolation(world, room, first, [first])).toBe('overlap');
  // 랜드마크 방(보스)의 북쪽 가운데는 비운다.
  const boss = world.bossRoom, bossRect = walkableRect(world, boss);
  expect(roomFixtures(boss).landmark).toBe(true);
  expect(placementViolation(world, boss, { ...at('moss-edging', 'N', boss.x), roomId: boss.id, z: bossRect.z0 + .8 })).not.toBeNull();
  // 목표 장치가 붙은 방은 아예 장식하지 않는다.
  const objective = { ...room, objectiveProp: 'cooling-valve' };
  expect(planGlassGardenDecor({ ...world, rooms: world.rooms.map((entry: any) => entry === room ? objective : entry) })
    .filter((entry: any) => entry.roomId === room.id)).toHaveLength(0);
});

// ---- 렌더 병합: 템플릿을 실제 GLB에서 만든다 ----
async function templates() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const map = new Map<string, any>();
  for (const id of GLASS_GARDEN_KIT_ASSETS) {
    const entry: any = {};
    for (const lod of [0, 1]) {
      const bytes = readFileSync(new URL(`public/models/glass-garden-kit-v1/${id}${lod ? '-lod1' : ''}.glb`, root));
      const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
      entry[lod ? 'lod1' : 'lod0'] = extractKitGeometry(gltf.scene);
    }
    map.set(id, entry);
  }
  return map;
}
const fingerprint = (map: Map<string, any>) => createHash('sha256').update(JSON.stringify([...map].map(([id, entry]) =>
  [id, ['lod0', 'lod1'].map(lod => ['matte', 'glow'].map(role => entry[lod][role].map((g: THREE.BufferGeometry) =>
    createHash('sha256').update(Buffer.from((g.getAttribute('position').array as Float32Array).buffer)).digest('hex'))))]))).digest('hex');

test('방별 병합: 재질 둘·방당 메시 최대 2개, 삼각형 예산 안, 경계는 방 안, 원본 템플릿은 그대로, 정리는 한 번만', async () => {
  const map = await templates();
  const before = fingerprint(map);
  for (const [name, world] of worlds().slice(0, 3)) {
    const plan = planGlassGardenDecor(world);
    const group = buildGlassGardenDecor(world, { templates: map, quality: 'high' });
    const rooms = new Set(plan.map((entry: any) => entry.roomId));
    const meshes = group.children as THREE.Mesh[];
    expect(meshes.length, name).toBeLessThanOrEqual(rooms.size * 2);
    expect(meshes.length).toBeGreaterThanOrEqual(rooms.size);
    expect(group.userData.stats.meshes).toBe(meshes.length);
    expect(new Set(meshes.map(mesh => mesh.material)).size).toBe(2);
    const triangles = new Map<number, number>();
    for (const mesh of meshes) {
      const roomId = mesh.userData.roomId, room = world.rooms[roomId], rect = walkableRect(world, room);
      const count = mesh.geometry.index!.count / 3;
      triangles.set(roomId, (triangles.get(roomId) || 0) + count);
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      expect(box.min.x).toBeGreaterThan(rect.x0 - 1.2); expect(box.max.x).toBeLessThan(rect.x1 + 1.2);
      expect(box.min.z).toBeGreaterThan(rect.z0 - 1.2); expect(box.max.z).toBeLessThan(rect.z1 + 1.2);
      expect(box.min.y).toBeGreaterThanOrEqual(-.05); expect(box.max.y).toBeLessThan(4.3);
      expect(mesh.castShadow).toBe(false);
      const colors = mesh.geometry.getAttribute('color').array as Float32Array;
      expect(colors.every(Number.isFinite)).toBe(true);
    }
    for (const [roomId, count] of triangles) expect(count, `${name} 방${roomId}`).toBeLessThanOrEqual(GLASS_GARDEN_DECOR.maxTrianglesPerRoom);
    // LOD1은 같은 배치를 더 적은 삼각형으로 그린다.
    const low = buildGlassGardenDecor(world, { templates: map, quality: 'low' });
    expect(low.userData.stats.triangles).toBeLessThan(group.userData.stats.triangles * .6);
    expect(low.userData.stats.placements).toBe(group.userData.stats.placements);
    // 정리: 지오메트리·재질 해제, 두 번째 호출은 무해, 원본은 그대로.
    let disposed = 0;
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => disposed++);
    const holder = new THREE.Group(); holder.add(group);
    group.userData.dispose(); group.userData.dispose();
    low.userData.dispose();
    expect(disposed).toBe(meshes.length);
    expect(group.parent).toBeNull();
  }
  expect(fingerprint(map)).toBe(before);
});

test('키트가 없거나 계획이 비면 비어 있는 정리 가능한 그룹을 돌려준다', () => {
  const world = gardenWorld('standard');
  const empty = buildGlassGardenDecor(world, { templates: null });
  expect(empty.children).toHaveLength(0);
  empty.userData.dispose(); empty.userData.dispose();
  const none = buildGlassGardenDecor(buildExpeditionWorld(buildExpeditionStage('dungeon', 'ember_vault', null)), { templates: new Map() });
  expect(none.children).toHaveLength(0);
  expect(ROOM_TYPE.BOSS).toBe('boss');
});
