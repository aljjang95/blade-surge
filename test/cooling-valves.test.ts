import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves, coolingVent, coolingVentContains } from '../src/game/cooling-valves.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';

const noop = () => {};
function fixture(depth = 'standard') {
  const stage = buildExpeditionStage('dungeon', 'cinder_tide_lock', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hits: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop }, drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop,
      hurt: (n: number) => { hits.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as CoolingValves;
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages, hits };
}
function enter(f: ReturnType<typeof fixture>, id: number, flush = true) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  if (flush) for (const timer of f.g.timers.splice(0)) timer.fn();
  return room;
}
function killWave(f: ReturnType<typeof fixture>, room: any) {
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
}
function defend(f: ReturnType<typeof fixture>, id: number) {
  const room = enter(f, id);
  for (let i = 0; i < (room.type === 'elite' ? 3 : 1); i++) killWave(f, room);
  return room;
}
function open(f: ReturnType<typeof fixture>, id: number) {
  defend(f, id);
  const gate = f.route.gates.find((g: any) => g.room.id === id)!;
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(2);
  return gate;
}

test('standard has two real accessible valves; deep has three, excluded modes remain unchanged', () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(depth), ids = depth === 'standard' ? [2, 5] : [2, 5, 6];
    expect(f.route).toBeInstanceOf(CoolingValves);
    expect(f.route.gates.map((g: any) => g.room.id)).toEqual(ids);
    for (const gate of f.route.gates) {
      const flow = f.world.buildFlow(gate.room.x, gate.room.z)!;
      for (const offset of [-3.5, 3.5]) {
        const cell = Math.floor(gate.room.z - f.world.minZ!) * f.world.cols! + Math.floor(gate.room.x + offset - f.world.minX!);
        expect(flow[cell]).toBeGreaterThanOrEqual(0);
      }
      expect(gate.room.type).not.toBe('boss');
      expect(gate.room.objectiveProp).toBe('cooling-valve');
    }
    const base = f.g.stage;
    for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
      { ...base, expedition: { ...base.expedition, conquestId: 'x' } },
      { ...base, expedition: { ...base.expedition, riftId: 'x' } },
      { ...base, expedition: { ...base.expedition, depth: 'unknown' } }]) {
      expect(createRouteObjectives(stage, f.world)).toBeNull();
    }
  }
});

test('delayed spawns and queued reinforcements prevent premature interaction and duplicate waves', () => {
  const f = fixture(), room: any = enter(f, 2, false), gate = f.route.gates[0];
  f.g.markCleared(room); expect(room.forgeWave).toBeUndefined(); expect(gate.ready).toBe(false);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  killWave(f, room); expect(room.forgeWave).toBe(1); expect(gate.ready).toBe(false);
  f.g.markCleared(room); expect(room.forgeWave).toBe(1);
  f.g.maxAlive = 0; killWave(f, room);
  expect(room.forgeWave).toBe(2); expect(f.g.pending.length).toBe(4);
  f.g.markCleared(room); expect(gate.ready).toBe(false);
  for (const pending of f.g.pending.splice(0)) f.g.spawnEnemy(pending.t, null, pending.room);
  killWave(f, room); expect(gate.ready).toBe(true); expect(room.cleared).toBe(false);
  expect(f.g.enemies.length).toBe(10); // initial 2 + two existing waves of 4
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(2);
  expect(room.cleared).toBe(true); expect(f.g.roomsCleared).toBe(1);
  f.g.markCleared(room); f.g.updateExpedition(2); expect(f.g.roomsCleared).toBe(1);
});

test('wrong order, room center, interruption, paused/dead/stale world and skills cannot fake a valve hold', () => {
  const f = fixture(); defend(f, 5); defend(f, 2);
  const first = f.route.gates[0], second = f.route.gates[1];
  f.g.player.pos.copy(second.pad); f.g.updateExpedition(2); expect(f.route.progress).toBe(0);
  f.g.player.pos.copy(first.pos); f.g.updateExpedition(1); expect(f.route.hold).toBe(0);
  f.g.player.pos.copy(first.pad); f.g.updateExpedition(.9); expect(f.route.hold).toBeCloseTo(.9);
  f.g.setPaused('test', true); f.g.updateExpedition(9); expect(f.route.hold).toBe(0);
  f.g.setPaused('test', false);
  for (const state of ['attack', 'skill', 'ult', 'dodge', 'hurt']) {
    f.g.player.state = state; f.g.updateExpedition(.05); expect(f.route.hold).toBe(0);
  }
  f.g.player.state = 'idle'; f.g.player.alive = false; f.g.updateExpedition(2); expect(f.route.progress).toBe(0);
  f.g.player.alive = true; f.g.world = {}; f.route.update(f.g, 2); expect(f.route.progress).toBe(0);
  f.g.world = f.world; f.g.player.pos.copy(first.pad); f.g.updateExpedition(1.1);
  f.g.player.pos.copy(first.pos); f.g.updateExpedition(.01); expect(f.route.hold).toBe(0);
});

test('overheat has a full warning, exact hit footprint, one hit per vent and alternates sides', () => {
  const f = fixture(); enter(f, 2); const gate = f.route.gates[0];
  const h = coolingVent(gate); f.g.player.pos.set(h.x, 0, h.z);
  expect(coolingVentContains(gate, { x: h.x + 2, z: h.z + 6 })).toBe(true);
  expect(coolingVentContains(gate, { x: h.x + 2.01, z: h.z })).toBe(false);
  expect(coolingVentContains(gate, gate.pad)).toBe(false);
  f.g.updateExpedition(4); expect(gate.phase).toBe('warning'); expect(f.hits).toEqual([]);
  f.g.updateExpedition(1.39); expect(f.hits).toEqual([]);
  f.g.updateExpedition(.02); expect(gate.phase).toBe('vent'); expect(f.hits).toEqual([6]);
  f.g.updateExpedition(.4); expect(f.hits).toEqual([6]);
  f.g.updateExpedition(.4); expect(gate.side).toBe(-1); expect(gate.phase).toBe('heat');
  expect(gate.pad.x).toBe(gate.room.x + 3.5);
  defend(f, 2); f.g.player.pos.copy(gate.pad); f.g.updateExpedition(2);
  expect(gate.attuned).toBe(true); expect(gate.hits).toBe(1);
});

test('cooled valves plus ALL rooms gate boss seal and frozen result; failure never awards completion', () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(depth);
    for (const gate of f.route.gates) open(f, gate.room.id);
    expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(false);
    f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
    for (const r of f.world.rooms) if (!['start', 'boss'].includes(r.type) && !r.cleared) defend(f, r.id);
    f.g.unsealBoss(); expect(f.world.sealed).toBe(false);
    const boss = f.world.bossRoom; boss.cleared = true;
    const report: any = f.route.finish(true);
    expect(report.complete).toBe(true); expect(report.progress).toBe(depth === 'standard' ? 2 : 3);
    expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
    expect(f.route.finish(false)).toBe(report);
  }
  const f = fixture(); open(f, 2); const loss: any = f.route.finish(false);
  expect(loss.complete).toBe(false); expect(loss.progress).toBe(1);
  f.g.updateExpedition(10); expect(f.route.progress).toBe(1);
  expect(f.route.autoRoom()).toBeNull();
});

test('AUTO routes to the actual safe pad and stops inside its hold radius', () => {
  const f = fixture(); defend(f, 2); const gate = f.route.gates[0];
  f.g.player.pos.copy(gate.pad);
  expect(Player.prototype.autoExplore.call(f.g.player, .016)).toEqual({ x: 0, y: 0 });
  f.g.player.pos.copy(gate.pos); const move = Player.prototype.autoExplore.call(f.g.player, .016);
  expect(Math.hypot(move.x, move.y)).toBeGreaterThan(0);
  expect(f.route.autoPoint(gate.room)).toBe(gate.pad);
  let disposed = 0; (f.route as any).view = { dispose: () => disposed++ };
  f.route.stop(); f.route.stop(); expect(disposed).toBe(1); expect(f.route.autoPoint(gate.room)).toBeNull();
});
