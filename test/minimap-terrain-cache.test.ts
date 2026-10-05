import { afterEach, expect, test } from 'bun:test';
import { Minimap } from '../src/ui/minimap.js';
import { discoveredMapBounds } from '../src/ui/battle-objective-view.js';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
type DrawCall = { operation: string; args: unknown[]; fill: unknown; stroke: unknown };
function publicView(map: Minimap) {
  if (!map.terrainView) throw Error('지형을 아직 그리지 않음');
  return map.terrainView;
}
function recordingContext() {
  const calls: DrawCall[] = [], state: Record<string, unknown> = { fillStyle: '', strokeStyle: '' };
  const context = new Proxy(state, { get(target, property) {
    if (property in target) return Reflect.get(target, property);
    return (...args: unknown[]) => calls.push({ operation: String(property), args, fill: state.fillStyle, stroke: state.strokeStyle });
  } });
  return { context, calls, operations: (name: string) => calls.filter(call => call.operation === name) };
}
function room(id: number, x: number, z: number, type: string, discovered: boolean) {
  return { id, gx: id === 0 ? 0 : 1, gy: id === 2 ? 1 : 0, x, z, w: 20, h: 20, type,
    discovered, cleared: id === 0, label: '', attunementPending: false, attuned: false, conquestLabel: '' };
}
function fixture() {
  let notify: ((entries: Array<{ target: unknown; contentRect: { width: number; height: number } }>) => void) | undefined;
  const environment = { devicePixelRatio: 1, addEventListener() {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: environment });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: typeof notify) { notify = callback; } observe() {}
  } });
  const main = recordingContext(), terrain = recordingContext();
  const terrainCanvas = { width: 0, height: 0, getContext: () => terrain.context };
  const canvas = { ownerDocument: { createElement: () => terrainCanvas }, clientWidth: 88, clientHeight: 88,
    width: 0, height: 0, getContext: () => main.context };
  const rooms = [room(0, 0, 0, 'start', true), room(1, 24, 0, 'normal', false), room(2, 24, 24, 'boss', false)];
  const world = { rooms, bossRoom: rooms[2], layout: { width: 6 }, sealed: true,
    linkPending: [[[0, 0], [1, 0]], [[1, 0], [1, 1]]] };
  const tactics = { roomDiscovered: true, used: false, nearbyId: 'gather', actionable: true,
    nodes: [{ id: 'gather', operator: { x: 2, z: 0 } }, { id: 'release', operator: { x: -2, z: 0 } }] };
  const player = { pos: { x: 0, z: 0 }, yaw: 0 }, enemy = { alive: true, pos: { x: 1, z: 0 }, isBoss: false };
  const battle = { world, player, curRoom: rooms[0], enemies: [enemy, { ...enemy, pos: { x: 24, z: 0 } }],
    drops: { items: [{ kind: 'item', mesh: { position: { x: 3, z: 0 } } }, { kind: 'item', mesh: { position: { x: 24, z: 0 } } }] },
    stage: { party: true }, app: { party: { members: [{ id: 1 }], players: new Map([[1, { pos: { x: -1, z: 0 }, alive: true }]]) } },
    mapTactics: { snapshot: () => tactics }, routeObjectives: undefined as undefined | { world: typeof world;
      progress: number; closed: boolean; coexistsAttunement: boolean; def: { kind: string; holdSeconds: number };
      gates: Array<{ room: typeof rooms[number]; ready: boolean }>; hold: number } };
  const map = new Minimap(canvas); map.setFloor(world);
  return { map, canvas, terrainCanvas, main, terrain, rooms, world, battle, enemy, tactics, environment,
    builds: () => terrain.operations('clearRect').length,
    resize(width: number, height: number) { notify?.([{ target: canvas, contentRect: { width, height } }]); } };
}

test('고정 지형은 한 번만 그리고 이동 중인 적과 플레이어·전술 상태는 매번 반영한다', () => {
  const f = fixture(); f.map.draw(f.battle); const view = publicView(f.map);
  for (let frame = 0; frame < 75; frame++) {
    f.enemy.pos.x = 1 + frame % 3; f.battle.player.pos.x = frame % 2; f.battle.player.yaw = frame / 10;
    f.tactics.used = frame >= 30; f.map.draw(f.battle);
  }
  expect(f.builds()).toBe(1); expect(f.map.terrainView).toBe(view);
  expect(f.main.operations('clearRect')).toHaveLength(76); expect(f.main.operations('drawImage')).toHaveLength(76);
  expect(f.main.operations('translate')).toHaveLength(76); expect(f.main.operations('rotate').at(-1)?.args[0]).toBe(-7.4 + Math.PI);
  const enemies = f.main.operations('arc').filter(call => call.fill === '#eaae8c');
  expect(enemies).toHaveLength(76); expect(new Set(enemies.map(call => call.args[0])).size).toBeGreaterThan(1);
  expect(f.main.operations('arc').filter(call => call.fill === '#ebcf8c')).toHaveLength(76);
  expect(f.main.operations('arc').filter(call => call.fill === '#78ddff')).toHaveLength(76);
  expect(f.main.operations('fill').some(call => call.fill === '#a6f0d4')).toBe(true);
  expect(f.main.operations('fill').some(call => call.fill === '#7d8c7a')).toBe(true);
  const directions = f.main.operations('fillText').filter(call => call.args[0] === '?');
  expect(directions).toHaveLength(76); expect(new Set(directions.map(call => call.args[1])).size).toBeGreaterThan(1);
});

test('새 발견과 발견 취소는 실제 연결 양끝만 캐시하고 숨겨진 지형과 이전 픽셀을 남기지 않는다', () => {
  const f = fixture(), hidden = f.rooms[1];
  Object.defineProperty(hidden, 'w', { configurable: true, get() { throw Error('미발견 지형 접근'); } });
  f.map.draw(f.battle); f.map.draw(f.battle);
  expect(publicView(f.map).rooms.map((known: { id: number }) => known.id)).toEqual([0]);
  expect(publicView(f.map).corridors).toHaveLength(0); expect(f.builds()).toBe(1);
  Object.defineProperty(hidden, 'w', { configurable: true, writable: true, value: 20 }); hidden.discovered = true;
  f.map.draw(f.battle);
  expect(publicView(f.map).rooms.map((known: { id: number }) => known.id)).toEqual([0, 1]);
  expect(publicView(f.map).corridors).toMatchObject([{ fromId: 0, toId: 1 }]); expect(f.builds()).toBe(2);
  expect(publicView(f.map).rooms.some((known: { type: string }) => known.type === 'boss')).toBe(false);
  const visibleEnemies = f.main.operations('arc').filter(call => call.fill === '#eaae8c');
  expect(visibleEnemies).toHaveLength(4);
  hidden.discovered = false; f.map.draw(f.battle);
  expect(publicView(f.map).rooms.map((known: { id: number }) => known.id)).toEqual([0]);
  expect(publicView(f.map).corridors).toHaveLength(0); expect(f.builds()).toBe(3);
  const images = f.main.operations('drawImage').length; f.rooms[0].discovered = false; f.map.draw(f.battle);
  expect(f.main.operations('drawImage')).toHaveLength(images); expect(f.main.calls.at(-1)?.operation).toBe('clearRect');
});

test('정화·공명·표식·지형·통로·봉인 변경은 실제 정적 표시를 즉시 무효화한다', () => {
  const f = fixture(); f.rooms.forEach(known => { known.discovered = true; }); f.map.draw(f.battle);
  const changes = [() => { f.rooms[1].cleared = true; }, () => { f.rooms[1].label = '공명 정원'; },
    () => { f.rooms[1].attunementPending = true; }, () => { f.rooms[1].attuned = true; },
    () => { f.rooms[1].conquestLabel = 'A'; }, () => { f.rooms[1].type = 'elite'; },
    () => { f.rooms[1].x += 1; }, () => { f.rooms[1].w += 2; }, () => { f.world.layout.width = 8; },
    () => { f.world.linkPending[0] = [[1, 0], [0, 0]]; }, () => { f.world.sealed = false; }];
  for (const change of changes) { const builds = f.builds(); change(); f.map.draw(f.battle); expect(f.builds()).toBe(builds + 1); }
  expect(f.terrain.operations('fillRect').some(call => call.fill === '#526b6070')).toBe(true);
  expect(f.terrain.operations('fillText').some(call => call.args[0] === 'A')).toBe(true);
  expect(publicView(f.map).corridors[0]).toMatchObject({ fromId: 1, toId: 0 });
  expect(publicView(f.map).corridors.every((edge: { sealed: boolean }) => !edge.sealed)).toBe(true);
});

test('공명 종료와 실제 경로 목표 전환은 목표 테두리를 옮기고 미발견 목표는 공개하지 않는다', () => {
  const f = fixture(), altar = f.rooms[1]; altar.discovered = true; altar.type = 'treasure'; altar.attunementPending = true;
  f.battle.routeObjectives = { world: f.world, progress: 0, closed: false, coexistsAttunement: true,
    def: { kind: 'records', holdSeconds: 2 }, gates: [{ room: f.rooms[0], ready: true }, { room: f.rooms[2], ready: false }], hold: 0 };
  f.map.draw(f.battle); expect(f.map.objectiveRoomId).toBe(altar.id);
  const firstBuilds = f.builds(); altar.attuned = true; altar.attunementPending = false; f.map.draw(f.battle);
  expect(f.map.objectiveRoomId).toBe(0); expect(f.builds()).toBe(firstBuilds + 1);
  f.battle.routeObjectives.progress = 1; const strokes = f.terrain.operations('strokeRect').length; f.map.draw(f.battle);
  expect(f.map.objectiveRoomId).toBeNull();
  expect(f.terrain.operations('strokeRect').slice(strokes).some(call => call.stroke === '#e6c88c')).toBe(false);
  f.rooms[2].discovered = true; f.map.draw(f.battle); expect(f.map.objectiveRoomId).toBe(2);
  const builds = f.builds(); f.battle.curRoom = altar; f.map.draw(f.battle);
  expect(f.map.currentRoomId).toBe(altar.id); expect(f.builds()).toBe(builds + 1);
});

test('실제 플레이어 경계·크기·DPR·월드 변경은 투영을 갱신하고 두 캔버스를 지운 뒤 복사한다', () => {
  const f = fixture(); f.map.draw(f.battle); f.battle.player.pos.x = 18; f.map.draw(f.battle);
  expect(f.builds()).toBe(2);
  const bounds = discoveredMapBounds(publicView(f.map), f.battle.player.pos);
  expect([f.map.minX, f.map.maxX, f.map.minZ, f.map.maxZ]).toEqual([bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ]);
  expect(f.map.px(18, 0)[0]).toBeLessThan(88); expect(f.map.px(18, 0)[0]).toBeGreaterThan(0);
  f.resize(420, 240); f.environment.devicePixelRatio = 2; f.map.draw(f.battle);
  expect([f.canvas.width, f.canvas.height, f.terrainCanvas.width, f.terrainCanvas.height]).toEqual([840, 480, 840, 480]);
  expect(f.terrain.operations('setTransform').at(-1)?.args).toEqual([2, 0, 0, 2, 0, 0]);
  expect(f.main.operations('drawImage').at(-1)?.args).toEqual([f.terrainCanvas, 0, 0, 420, 240]);
  for (let index = 0; index < f.terrain.calls.length; index++) if (f.terrain.calls[index].operation === 'clearRect')
    expect(f.terrain.calls[index + 1].operation).toBe('fillRect');
  for (let index = 0; index < f.main.calls.length; index++) if (f.main.calls[index].operation === 'clearRect')
    expect(f.main.calls[index + 1].operation).toBe('drawImage');
  const view = publicView(f.map), builds = f.builds(); f.battle.world = { ...f.world }; f.map.setFloor(f.battle.world); f.map.draw(f.battle);
  expect(f.builds()).toBe(builds + 1); expect(f.map.terrainView).not.toBe(view);
});
