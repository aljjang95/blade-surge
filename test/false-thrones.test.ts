import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { FalseThrones } from '../src/game/false-thrones.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
function fixture(depth = 'standard') {
  const stage = buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop }, drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop,
      hurt: (n: number) => { hurts.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      // 판정 위치에 닿지 않는 먼 곳에 세워 왕좌 판정만 검사한다.
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route = createRouteObjectives(stage, world) as FalseThrones;
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, hurts };
}
type F = ReturnType<typeof fixture>;
function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  return room;
}
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id)!;
/** 모래시계가 멈출 때까지 시간을 보낸다. */
function untilStill(f: F, gate: any) { for (let i = 0; i < 200 && gate.phase !== 'still'; i++) f.route.update(f.g, .05); }
/** 실제 근접 판정 경로(hitArea)로 왕좌 옆에서 휘두른다. */
function swing(f: F, gate: any) {
  f.g.player.pos.copy(gate.stand);
  return f.g.hitArea(f.g.player, f.g.player.pos, 0, 2.4, 120, 10, {});
}

test('standard places three reachable false thrones; deep and excluded modes keep their own rules', () => {
  const f = fixture();
  expect(f.route).toBeInstanceOf(FalseThrones);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 5, 6]);
  for (const gate of f.route.gates) {
    expect(gate.room.objectiveProp).toBe('false-throne');
    expect(['boss', 'start']).not.toContain(gate.room.type);
    const flow = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
    const cell = Math.floor(gate.stand.z - f.world.minZ!) * f.world.cols! + Math.floor(gate.stand.x - f.world.minX!);
    expect(flow[cell]).toBeGreaterThanOrEqual(0);
  }
  expect(fixture('deep').route).toBeNull();
  const base = f.g.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' }, { ...base, expedition: { ...base.expedition, conquestId: 'x' } }]) {
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
});

test('a throne cannot be damaged before its room is cleared and the room stays open until it breaks', () => {
  const f = fixture(), gate = gateOf(f, 2);
  f.g.enterRoom(gate.room); for (const timer of f.g.timers.splice(0)) timer.fn();
  untilStill(f, gate);
  expect(swing(f, gate)).toBe(0);
  expect(gate.hits).toBe(0); expect(f.route.blocked).toBe(1);
  for (const e of f.g.enemies) e.alive = false;
  f.g.markCleared(gate.room);
  expect(gate.ready).toBe(true); expect(gate.room.cleared).toBe(false);
});

test('spinning hourglass reflects sand with a cooldown; only a stopped hourglass takes cracks', () => {
  const f = fixture(), gate = gateOf(f, 2);
  clearRoom(f, 2);
  expect(gate.phase).toBe('spin');
  expect(swing(f, gate)).toBe(1);
  expect(f.hurts).toEqual([5]); expect(gate.hits).toBe(0);
  f.route.update(f.g, .25); swing(f, gate);
  expect(f.hurts.length).toBe(1);   // 반사 재사용 대기 1.2초
  untilStill(f, gate);
  expect(swing(f, gate)).toBe(1); expect(gate.hits).toBe(1);
  expect(swing(f, gate)).toBe(0); expect(gate.hits).toBe(1);   // 같은 순간 연타는 1타
  f.route.update(f.g, .21); swing(f, gate);
  expect(gate.hits).toBe(2); expect(f.route.reflects).toBe(1);
});

test('five cracks break a throne, clear its room, and thrones may break in any order', () => {
  const f = fixture();
  for (const id of [6, 2, 5]) {
    const gate = gateOf(f, id); clearRoom(f, id);
    while (!gate.broken) { untilStill(f, gate); swing(f, gate); f.route.update(f.g, .21); }
    expect(gate.room.cleared).toBe(true);
  }
  expect(f.route.progress).toBe(3); expect(f.route.complete).toBe(true);
  expect(f.messages.some(m => /마지막 가짜 왕좌 파괴/.test(m))).toBe(true);
  expect(f.route.canUnseal()).toBe(false);   // 다른 구역이 남아 있다
  for (const room of f.world.rooms) if (!['start', 'boss'].includes(room.type)) room.cleared = true;
  expect(f.route.canUnseal()).toBe(true);
});

test('projectiles crack a stopped throne once each and are consumed', () => {
  const f = fixture(), gate = gateOf(f, 5);
  clearRoom(f, 5); untilStill(f, gate);
  const bolt = { pos: gate.pos.clone(), radius: .4, hit: new Set(), pierce: false };
  expect(f.route.strikeProjectile(f.g, bolt)).toBe(true);
  expect(f.route.strikeProjectile(f.g, bolt)).toBe(false);
  expect(gate.hits).toBe(1);
});

test('AUTO waits beside a spinning throne and attacks only early in the stopped window', () => {
  const f = fixture(), gate = gateOf(f, 2);
  expect(f.route.autoRoom()).toBe(gate.room);
  clearRoom(f, 2);
  expect(f.route.autoPoint(gate.room)).toBe(gate.stand);
  f.g.player.pos.copy(gate.stand);
  expect(f.route.autoStrike(f.g.player)).toBeNull();
  untilStill(f, gate);
  expect(f.route.autoStrike(f.g.player)).toBe(gate);
  f.route.update(f.g, f.route.def.stillSeconds - .5);
  expect(f.route.autoStrike(f.g.player)).toBeNull();
});

test('objective panel and result report reflect real progress; a loss is never complete', () => {
  const f = fixture(), gate = gateOf(f, 2);
  gate.room.discovered = true;
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '가짜 왕좌 파괴', action: '이 구역의 적을 먼저 처치', progress: 0, total: 3 });
  clearRoom(f, 2);
  expect(battleObjectiveView(f.g).action).toMatch(/모래시계 회전/);
  untilStill(f, gate); swing(f, gate);
  expect(battleObjectiveView(f.g)).toMatchObject({ action: '모래시계 멈춤 · 지금 왕좌 공격', hold: 1, holdTotal: 5 });
  const report = f.route.finish(false);
  expect(report).toMatchObject({ id: 'sable_false_thrones', label: '가짜 왕좌 파괴', complete: false, progress: 0, target: 3, sandReflects: 0 });
  expect(f.route.finish(true)).toBe(report);
});
