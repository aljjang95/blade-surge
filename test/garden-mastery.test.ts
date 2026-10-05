import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { GARDEN_MASTERY, gardenMasteryForStage } from '../src/data/garden-mastery.js';
import { ENEMIES } from '../src/data/stages.js';
import { DUNGEONS } from '../src/data/expansion.js';
import { MOB_ROLES, MAX_MOB_ROLE_ATTACKS } from '../src/data/mob-roles.js';
import { Floor } from '../src/game/world.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { createMapTactics } from '../src/game/map-tactics.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { discoveredMapView } from '../src/ui/battle-objective-view.js';
import { normalizeRunRoute, runRouteForStage, runHistoryContext, runDetailsForBattle, runRouteLabel } from '../src/game/run-history.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { choosePersonalGoal, capturePersonalGoal, summarizePersonalRuns, evaluatePersonalGoal } from '../src/game/run-personal-goals.js';

const garden = () => buildExpeditionStage('dungeon', 'glass_garden', null);
const oldRoster = ['skel_minion', 'ghost', 'skel_rogue', 'skel_minion', 'ghost_skull', 'bomb_slime'];
const legacyRoute = () => ({ kind: 'dungeon', id: 'glass_garden', depth: 'standard', conquestId: null, riftId: null });
const details = (route: unknown, timeSec = 60) => ({ route, heroId: 'knight', heroLevel: 3, control: 'manual', timeSec, perfects: 2, breaks: 1 });
const historyRun = (runId: number, route: unknown, timeSec: number) => ({ runId, floor: 1, outcome: 'victory', boonIds: [], details: details(route, timeSec) });
type Point = [number, number];
type Diagonal = { fromX: number; fromZ: number; toX: number; toZ: number };
type MasteryRoom = { id: number; x: number; z: number; w: number; h: number; gx: number; gy: number; type: string;
  links: number[]; discovered: boolean; gardenMastery?: { version: string; approachRoomIds: readonly number[]; diagonals: readonly Diagonal[] } };
type RoomRange = { roomId: number; materialRole: number; start: number; count: number };
type DiscoveredRoomView = { id: number; label: string };

function traverse(world: Floor, route: Point[]) {
  let [x, z] = route[0];
  for (const [tx, tz] of route.slice(1)) {
    const sx = x, sz = z, steps = Math.ceil(Math.hypot(tx - sx, tz - sz) / .2);
    for (let i = 1; i <= steps; i++) {
      const nx = sx + (tx - sx) * i / steps, nz = sz + (tz - sz) * i / steps;
      for (const [dx, dz] of [[.56, 0], [-.56, 0], [0, .56], [0, -.56]]) expect(world.walkable(nx + dx, nz + dz)).toBe(true);
      expect(world.resolve(x, z, nx, nz, .56)).toEqual([nx, nz]);
      [x, z] = [nx, nz];
    }
  }
}

test('사냥터는 중복 잡몹의 네 번째 자리만 기존 분쇄형으로 바꾸고 정원·보스 구성은 보존한다', () => {
  const before = JSON.stringify(ENEMIES), stage = garden(), world = buildExpeditionWorld(stage);
  expect(gardenMasteryForStage(stage)).toBe(GARDEN_MASTERY);
  expect(stage).toMatchObject({ encounterVersion: GARDEN_MASTERY.version });
  expect(expeditionRoster(stage, world.rooms[1])).toEqual(oldRoster);
  expect(expeditionRoster(stage, world.rooms[2])).toEqual(['skel_minion', 'skel_rogue', 'ghost_skull']);
  const roster = expeditionRoster(stage, world.rooms[3]);
  expect(roster).toEqual(['skel_minion', 'ghost', 'skel_rogue', 'bone_orc', 'ghost_skull', 'bomb_slime']);
  expect(roster).toHaveLength(6);
  for (const index of [0, 1, 2, 4, 5]) expect(roster[index]).toBe(oldRoster[index]);
  expect(expeditionRoster(stage, world.bossRoom)).toEqual([stage.encounter.enemyId]);
  expect(ENEMIES.bone_orc).toMatchObject({ meleeRole: 'crusher' }); expect(ENEMIES.skel_rogue).toMatchObject({ meleeRole: 'flanker' });
  expect(roster[4]).toBe('ghost_skull'); expect(ENEMIES.ghost_skull.ranged).toBe(true); expect(MAX_MOB_ROLE_ATTACKS).toBe(3);
  expect(MOB_ROLES.crusher).toMatchObject({ windup: 1.2, recovery: 1.05 });
  expect(ENEMIES.bone_orc.hp - ENEMIES.skel_minion.hp).toBe(630);
  expect(ENEMIES.bone_orc.exp - ENEMIES.skel_minion.exp).toBe(7);
  expect(ENEMIES.bone_orc.gold - ENEMIES.skel_minion.gold).toBe(1);
  expect(JSON.stringify(ENEMIES)).toBe(before);
  expect(DUNGEONS.find(def => def.id === 'glass_garden')).toMatchObject({ energy: 4,
    rewards: { gold: 360, xp: 100, materials: { glass_leaf: 3 }, consumables: { hp_tonic: 1 } } });
});

test('파티·균열·심층·전술 공략·다른 지역은 사냥터 저작과 버전 표식을 얻지 않는다', () => {
  const standard = garden(), excluded = [
    { ...standard, party: { seed: 7 } }, { ...standard, riftId: 'iron' },
    { ...standard, expedition: { ...standard.expedition, riftId: 'iron' } },
    { ...standard, expedition: { ...standard.expedition, conquestId: 'garden_dawn' } },
    buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep', conquestId: 'garden_dawn' }),
    buildExpeditionStage('dungeon', 'ember_vault', null), buildExpeditionStage('arena', 'rookie', null),
  ];
  for (const stage of excluded) {
    expect(gardenMasteryForStage(stage)).toBeNull();
    expect(JSON.stringify(runRouteForStage(stage))).not.toContain(GARDEN_MASTERY.version);
    const world = buildExpeditionWorld(stage);
    for (const room of world.rooms as MasteryRoom[]) expect(room.gardenMastery).toBeUndefined();
  }
  for (const stage of excluded.slice(0, 4)) expect(expeditionRoster(stage, { id: 3, type: 'normal' })).toEqual(oldRoster);
});

test('사냥터 표식은 고정 방·봉인·난수 상태를 바꾸지 않고 두 실제 입구와 대각선에 접근할 수 있다', () => {
  const stage = garden(), world = buildExpeditionWorld(stage);
  // 기존 JS 생성자의 layout 기본값은 null로 추론된다. 실제 카탈로그 레이아웃만 전달한다.
  const baseline = new Floor(stage.idx, stage.theme, world.seed, EXPEDITION_LAYOUTS.glass_garden as any);
  const rooms = world.rooms as MasteryRoom[], original = baseline.rooms as MasteryRoom[], room = rooms[3];
  expect(world.seed).toBe(3944785920);
  const shape = (r: MasteryRoom) => [r.id, r.gx, r.gy, r.x, r.z, r.w, r.h, r.type];
  expect(rooms.map(shape)).toEqual(original.map(shape)); expect(world.gates).toEqual(baseline.gates);
  expect(Array.from({ length: 8 }, () => world.rand())).toEqual(Array.from({ length: 8 }, () => baseline.rand()));
  expect(room.links).toEqual([1, 4, 2]); expect(world.sealed).toBe(true);
  const mask = Array.from(world.mask!), tactics = createMapTactics(stage, world)!;
  const authored = room.gardenMastery!;
  expect(authored.approachRoomIds).toEqual([1, 2]); expect(authored.diagonals).toHaveLength(2);
  for (const id of authored.approachRoomIds) {
    const entry = rooms[id];
    traverse(world, [[entry.x, entry.z], [room.x, entry.z], [room.x, room.z]]);
    for (const node of tactics.nodes) traverse(world, [[room.x, room.z], [node.operator.x, node.operator.z]]);
  }
  for (const path of authored.diagonals) {
    traverse(world, [[path.fromX, path.fromZ], [path.toX, path.toZ]]);
    for (const node of tactics.nodes) {
      expect(Math.hypot(path.fromX - node.operator.x, path.fromZ - node.operator.z)).toBeGreaterThan(node.operatorRadius + .6);
      expect(Math.hypot(path.fromX - node.anchor.x, path.fromZ - node.anchor.z)).toBeGreaterThan(.9);
    }
  }
  expect(Array.from(world.mask!)).toEqual(mask); expect(world.sealed).toBe(true);
});

test('미발견 입구는 지도에 나타나지 않고 두 발견된 통로는 같은 사냥터에 연결된다', () => {
  const world = buildExpeditionWorld(garden()), rooms = world.rooms as MasteryRoom[];
  rooms[3].discovered = true;
  let view = discoveredMapView(world);
  expect(view.rooms.find((room: DiscoveredRoomView) => room.id === 3)?.label).toBe(GARDEN_MASTERY.label);
  expect(view.corridors.some(edge => edge.fromId === 2 || edge.toId === 2)).toBe(false);
  rooms[1].discovered = true; view = discoveredMapView(world);
  expect(view.corridors.filter(edge => edge.fromId === 3 || edge.toId === 3)).toHaveLength(1);
  rooms[2].discovered = true; view = discoveredMapView(world);
  expect(view.corridors.filter(edge => edge.fromId === 3 || edge.toId === 3).map(edge => [edge.fromId, edge.toId])).toEqual([[1, 3], [2, 3]]);
  expect(view.rooms.some((room: DiscoveredRoomView) => room.id === 4)).toBe(false);
});

test('대각 이음선은 기존 석재 배치 안의 낮은 여덟 삼각형이며 다른 방·재질·메시 수를 보존한다', () => {
  const stage = garden(), world = buildExpeditionWorld(stage), baseline = buildExpeditionWorld(stage);
  const oldRoom = baseline.rooms[3] as MasteryRoom; delete oldRoom.gardenMastery;
  const mask = Array.from(world.mask!), current = buildRegionArchitecture(world, 'garden'), old = buildRegionArchitecture(baseline, 'garden');
  const entries = (group: THREE.Group) => group.children.map(node => node as THREE.Mesh).flatMap(mesh =>
    (mesh.userData.roomRanges as RoomRange[]).map(range => ({ mesh, range })));
  expect(current.children.map(mesh => mesh.name)).toEqual(old.children.map(mesh => mesh.name));
  const before = entries(old);
  for (const { mesh, range } of entries(current)) {
    const previous = before.find(entry => entry.range.roomId === range.roomId && entry.range.materialRole === range.materialRole)!;
    const added = range.roomId === 3 && range.materialRole === 0 ? 24 : 0;
    expect(range.count).toBe(previous.range.count + added);
    const positions = mesh.geometry.getAttribute('position'), original = previous.mesh.geometry.getAttribute('position');
    for (let i = 0; i < previous.range.count; i++) for (const key of ['getX', 'getY', 'getZ'] as const) {
      expect(positions[key](range.start + i)).toBe(original[key](previous.range.start + i));
    }
    for (let i = range.start + previous.range.count; i < range.start + range.count; i++) {
      expect(positions.getY(i)).toBeGreaterThan(.04997); expect(positions.getY(i)).toBeLessThan(.11);
      expect(world.walkable(positions.getX(i), positions.getZ(i))).toBe(true);
    }
  }
  expect(Array.from(world.mask!)).toEqual(mask);
  current.userData.dispose(); old.userData.dispose();
});

test('이전 개인 기록과 목표는 보존되지만 사냥터 v1 승리와 비교하지 않는다', () => {
  const old = legacyRoute(), current = runRouteForStage(garden())!;
  expect<unknown>(normalizeRunRoute(old)).toEqual(old);
  expect(normalizeRunRoute(current)).toMatchObject({ encounterVersion: GARDEN_MASTERY.version });
  const raw = { history: [historyRun(1, old, 30), historyRun(2, current, 50)] }, unchanged = JSON.stringify(raw);
  const state = normalizeMasterworks(raw);
  expect(choosePersonalGoal(state, 1, 'time')).toEqual({ ok: true });
  const captured = capturePersonalGoal(state)!;
  expect(captured.baseline).toBe(30);
  expect(evaluatePersonalGoal(captured, details(current, 20), 'victory')).toMatchObject({ eligible: false, achieved: false, reason: 'conditions' });
  expect(summarizePersonalRuns(state.history, details(old)).runIds).toEqual([1]);
  expect(summarizePersonalRuns(state.history, details(current)).runIds).toEqual([2]);
  expect(normalizeMasterworks(JSON.parse(JSON.stringify(state))).history).toEqual(state.history);
  expect(JSON.stringify(raw)).toBe(unchanged);
  expect(runRouteLabel(old)).toContain('전투 구성 버전 미기록'); expect(runRouteLabel(current)).toContain('사냥터 v1');
});

test('출격 시 카탈로그 버전을 동결하며 알 수 없거나 범위를 벗어난 저장 버전은 구형으로 추정하지 않는다', () => {
  const stage = garden(), context = runHistoryContext(stage, 'knight', 3);
  stage.expedition.id = 'ember_vault';
  const observed = runDetailsForBattle({ stage, elapsed: 42, run: { historyContext: context, controlSeen: 1, perfects: 2, breaks: 1 } });
  expect(observed?.route).toMatchObject({ id: 'glass_garden', encounterVersion: GARDEN_MASTERY.version });
  expect(Object.isFrozen(context.route)).toBe(true);
  for (const encounterVersion of ['future_v2', '__proto__', 1, [], {}]) expect(normalizeRunRoute({ ...legacyRoute(), encounterVersion })).toBeNull();
  for (const route of [{ ...legacyRoute(), depth: 'deep' }, { ...legacyRoute(), riftId: 'iron' }, { ...legacyRoute(), id: 'ember_vault' }]) {
    expect(normalizeRunRoute({ ...route, encounterVersion: GARDEN_MASTERY.version })).toBeNull();
  }
});

test('실제 출격 표식의 누락·미지 버전과 동결된 null 경로를 나중 카탈로그로 재분류하지 않는다', () => {
  const native: any = garden(), nativeRoute = runRouteForStage(native)!;
  expect(nativeRoute).toMatchObject({ encounterVersion: GARDEN_MASTERY.version });
  for (const encounterVersion of ['future_v2', 'garden_mastery_v0', 1, [], {}]) {
    expect(runRouteForStage({ ...garden(), encounterVersion })).toBeNull();
  }
  const missing: any = garden(); delete missing.encounterVersion;
  for (const stage of [missing, { ...garden(), encounterVersion: null }]) {
    const route = runRouteForStage(stage)!;
    expect<unknown>(route).toEqual(legacyRoute());
    expect(runRouteLabel(route)).toContain('전투 구성 버전 미기록');
    const runs = [historyRun(1, route, 30), historyRun(2, nativeRoute, 50)];
    expect(summarizePersonalRuns(runs, details(route)).runIds).toEqual([1]);
    expect(summarizePersonalRuns(runs, details(nativeRoute)).runIds).toEqual([2]);
  }
  const invalid: any = { ...garden(), encounterVersion: 'future_v2' };
  const unknownEntry = runHistoryContext(invalid, 'knight', 3);
  expect(unknownEntry.route).toBeNull();
  invalid.encounterVersion = GARDEN_MASTERY.version;
  const terminal = { stage: invalid, elapsed: 42, run: { historyContext: unknownEntry, controlSeen: 1, perfects: 2, breaks: 1 } };
  expect(runDetailsForBattle(terminal)?.route).toBeNull();
  expect(runDetailsForBattle({ stage: invalid, elapsed: 42, run: { controlSeen: 1, perfects: 2, breaks: 1 } })?.route).toEqual(nativeRoute);
  const knownEntry = runHistoryContext(native, 'knight', 3);
  native.encounterVersion = 'future_v2'; native.expedition.id = 'ember_vault';
  expect(runDetailsForBattle({ ...terminal, stage: native, run: { ...terminal.run, historyContext: knownEntry } })?.route).toEqual(nativeRoute);
  expect(runRouteForStage({ ...garden(), riftId: 'iron' })).toMatchObject({ riftId: 'iron' });
  expect(JSON.stringify(runRouteForStage({ ...garden(), riftId: 'iron' }))).not.toContain(GARDEN_MASTERY.version);
});
