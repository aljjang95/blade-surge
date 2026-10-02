import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { AstralConstellations } from '../src/game/astral-constellations.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';

const noop = () => {};
function fixture() {
  const stage = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null);
  const world = buildExpeditionWorld(stage), messages: string[] = [], drops: any[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, result: null, pauseReasons: new Set(),
    input: { enabled: true, clear: noop }, app: { eco: { s: {} } }, scene: new Scene(), sp: { clear: noop },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop, buildFloor: noop }, openPortal: noop,
    fx: { damage: noop, castCircle: noop, groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { spawn: (...args: any[]) => drops.push(args), clear: noop }, rollDrop: () => ({ id: 'test-drop' }),
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop },
    // The small roster/render actors are fixtures. Battle's spawn queue, rooms,
    // rewards, seal, victory, result, Floor and AUTO navigation are production.
    roomRoster: () => ['guard', 'guard'],
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, pos: new Vector3(room.x, 0, room.z), dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as AstralConstellations;
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages, drops };
}
type Fixture = ReturnType<typeof fixture>;
function flush(f: Fixture) { for (const timer of f.g.timers.splice(0)) timer.fn(); }
function enter(f: Fixture, id: number, delayed = false) {
  const room = f.world.rooms[id]; f.g.enterRoom(room); if (!delayed) flush(f); return room;
}
function killWave(f: Fixture, room: any) {
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
}
function defend(f: Fixture, id: number) { const room = enter(f, id); killWave(f, room); return room; }
function read(f: Fixture, index = f.route.progress) {
  const gate = f.route.gates[index]; f.g.player.pos.copy(gate.pos); f.g.updateExpedition(1); return gate;
}
function select(f: Fixture, id: string, index = f.route.progress) {
  const gate = f.route.gates[index], pad = gate.pads.find((p: any) => p.id === id)!;
  f.g.player.pos.copy(pad.pos); f.g.updateExpedition(.99); f.g.updateExpedition(.01);
  // Confirmation is deferred across the entire final damage/projectile pass.
  f.g.updateExpedition(.01); return gate;
}
function restore(f: Fixture, index = f.route.progress) { defend(f, f.route.gates[index].room.id); const gate = read(f, index); select(f, gate.answer, index); return gate; }
function cell(world: any, point: any) { return Math.floor(point.z - world.minZ) * world.cols + Math.floor(point.x - world.minX); }

test('only solo standard Astral has four distinct stations; other modes and deep keep their existing contract', () => {
  const f = fixture(), base = f.g.stage;
  expect(f.route).toBeInstanceOf(AstralConstellations); expect(f.world.sealed).toBe(true);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([1, 3, 4, 6]);
  expect(f.route.gates.map((g: any) => g.stationId)).toEqual([1, 2, 3, 4]);
  expect(f.route.gates.map((g: any) => g.answer)).toEqual(['triangle', 'diamond', 'circle', 'triangle']);
  expect(f.route.def.radius).toBe(1.2); expect(f.route.def.readSeconds).toBe(1); expect(f.route.def.holdSeconds).toBe(1);
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    ...[{ kind: 'arena' }, { riftId: 'x' }, { conquestId: 'x' }, { depth: 'deep' }, { depth: 'unknown' }, { id: 'star_archive' }]
      .map(extra => ({ ...base, expedition: { ...base.expedition, ...extra } }))]) {
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
  expect(f.route.coexistsAttunement).toBe(false);
  expect(f.world.rooms.some(r => f.route.allowsAttunement(r))).toBe(false);
});

test('all four stations, full pad circles and hero margin are reachable on the sealed production Floor', () => {
  const f = fixture(); let from: any = f.world.startRoom;
  for (const gate of f.route.gates) {
    const flow = f.world.buildFlow(from.x, from.z)!;
    expect(flow[cell(f.world, gate.pos)]).toBeGreaterThanOrEqual(0);
    expect(gate.room.objectiveProp).toBe('astral-constellation');
    expect(gate.pads.map((p: any) => [p.code, p.glyph, p.name])).toEqual([['A', '△', '삼각'], ['B', '○', '원'], ['C', '◇', '마름모']]);
    for (const pad of gate.pads) {
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, r = f.route.def.radius + .6;
        expect(flow[cell(f.world, { x: pad.pos.x + Math.cos(a) * r, z: pad.pos.z + Math.sin(a) * r })]).toBeGreaterThanOrEqual(0);
      }
      expect(f.world.buildFlow(pad.pos.x, pad.pos.z)![cell(f.world, gate.pos)]).toBeGreaterThanOrEqual(0);
    }
    from = gate.pos;
  }
  const blocked = { ...f.world, buildFlow: () => new Int32Array(f.world.cols! * f.world.rows!).fill(-1) };
  expect(() => new AstralConstellations(f.route.def, blocked)).toThrow(RangeError);
  const badAnswer = { ...f.route.def, gates: [{ ...f.route.def.gates[0], answer: 'missing' }] };
  expect(() => new AstralConstellations(badAnswer, f.world)).toThrow(RangeError);
  const sealedGate = { ...f.route.def, gates: [{ ...f.route.def.gates[0], roomId: f.world.bossRoom.id }] };
  expect(() => new AstralConstellations(sealedGate, f.world)).toThrow(RangeError);
});

test('delayed spawn receipt, alive enemies and pending queue each block clues; ordinary rooms also cannot clear early', () => {
  const f = fixture(), gate = f.route.gates[0], room = enter(f, gate.room.id, true);
  expect(f.route.ownsHazards(room)).toBe(false);
  f.g.player.pos.copy(gate.pos); f.g.markCleared(room); f.g.updateExpedition(5);
  expect(gate.ready).toBe(false); expect(gate.available).toBe(false); expect(f.route.read).toBe(0);
  f.g.timers.shift().fn(); killWave(f, room); expect(gate.spawnCount).toBe(1); expect(gate.ready).toBe(false);
  flush(f); f.g.markCleared(room); expect(gate.ready).toBe(false);
  f.g.pending.push({ room }); killWave(f, room); expect(gate.ready).toBe(false);
  f.g.pending.length = 0; killWave(f, room); expect(gate.ready).toBe(true); expect(room.cleared).toBe(false);
  const treasure = enter(f, 2, true); f.g.markCleared(treasure); expect(treasure.cleared).toBe(false);
  flush(f); killWave(f, treasure); expect(treasure.cleared).toBe(true);
  read(f); expect(f.route.revealed).toBe(true); expect(f.route.progress).toBe(0);
  expect(f.route.ownsHazards(room)).toBe(true);
});

test('read phase precedes any choice, shared AUTO target advances to the advertised correct pad only after reading', () => {
  const f = fixture(), gate = f.route.gates[0]; defend(f, gate.room.id);
  f.g.player.pos.copy(gate.pads.find((p: any) => p.id === gate.answer)!.pos);
  f.g.updateExpedition(.99); expect(f.route.phase).toBe('read'); expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
  expect(f.route.autoPoint(gate.room)).toBe(gate.pos);
  expect(f.route.hint()).toContain('A △ 삼각');
  f.g.updateExpedition(.01); expect(f.route.phase).toBe('select'); expect(f.route.hold).toBe(0);
  expect(f.route.autoPoint(gate.room)).toBe(gate.pads.find((p: any) => p.id === gate.answer)!.pos);
  expect(Player.prototype.autoExplore.call(f.g.player, .016)).toEqual({ x: 0, y: 0 });
  f.g.updateExpedition(1); expect(f.route.progress).toBe(0); expect(gate.attuned).toBe(false);
  f.g.updateExpedition(.01); expect(f.route.progress).toBe(1); expect(gate.room.cleared).toBe(true);
  const paid = f.drops.length; f.g.markCleared(gate.room); f.g.updateExpedition(5);
  expect(f.drops.length).toBe(paid); expect(f.g.roomsCleared).toBe(1);
  expect(f.route.ownsHazards(gate.room)).toBe(false);
});

test('wrong pad confirms once, states the mismatch and requires leaving all circles despite interrupt/pause', () => {
  const f = fixture(); defend(f, 1); const gate = read(f); select(f, 'circle');
  expect(f.route.progress).toBe(0); expect(f.route.mistakes).toBe(1); expect(f.route.phase).toBe('retry');
  expect(f.route.feedback).toContain('B ○ 오답'); expect(f.route.feedback).toContain('A △');
  expect(gate.room.cleared).toBe(false); expect(f.drops).toHaveLength(0);
  f.route.interrupt(); f.g.setPaused('test', true); f.g.setPaused('test', false); f.g.updateExpedition(10);
  expect(f.route.phase).toBe('retry'); expect(f.route.read).toBe(0); expect(f.route.mistakes).toBe(1);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(.01); expect(f.route.phase).toBe('read');
  read(f); select(f, gate.answer); expect(f.route.progress).toBe(1); expect(f.route.mistakes).toBe(1);
});

test('out-of-order stations wait; nearby alive enemies from another room hide selection and reset incomplete time', () => {
  const f = fixture(); defend(f, 3); defend(f, 1); read(f, 1);
  expect(f.route.progress).toBe(0); expect(f.route.gates[1].available).toBe(false); expect(f.route.gates[1].attuned).toBe(false);
  const gate = read(f, 0); f.g.player.pos.copy(gate.pads[0].pos); f.g.updateExpedition(.7);
  const intruder = { alive: true, homeRoom: f.world.rooms[2], pos: f.g.player.pos.clone(), dispose: noop };
  f.g.enemies.push(intruder); f.route.observePlayer(f.g.player);
  expect(gate.available).toBe(false); expect(f.route.hold).toBe(0);
  f.g.updateExpedition(.1);
  expect(gate.available).toBe(false); expect(f.route.read).toBe(0); expect(f.route.hold).toBe(0);
  expect(f.route.hint()).toContain('전투 중'); expect(f.route.autoPoint(gate.room)).toBeNull();
  intruder.alive = false; read(f, 0); select(f, gate.answer); expect(f.route.progress).toBe(1);
});

test('attack, skill, ult, dodge, hurt, damage, pause and leaving the station require a fresh read and selection', () => {
  for (const auto of [false, true]) for (const cause of ['attack', 'skill', 'ult', 'dodge', 'hurt', 'damage', 'pause', 'leave']) {
    const f = fixture(); defend(f, 1); const gate = read(f); f.g.player.auto = auto;
    f.g.player.pos.copy(gate.pads[0].pos); f.g.updateExpedition(.7);
    if (cause === 'pause') { f.g.setPaused('test', true); f.g.updateExpedition(5); f.g.setPaused('test', false); }
    else { if (cause === 'leave') f.g.player.pos.x += 20; else if (cause === 'damage') f.g.player.hp--; else f.g.player.state = cause; f.g.updateExpedition(.1); }
    expect(f.route.hold).toBe(0); expect(f.route.read).toBe(0); expect(f.route.progress).toBe(0);
    f.g.player.state = 'idle'; read(f); select(f, gate.answer); expect(f.route.progress).toBe(1);
  }
});

test('leaving a pad resets its hold but preserves the already-read clue within the station', () => {
  const f = fixture(); defend(f, 1); const gate = read(f);
  f.g.player.pos.copy(gate.pads[0].pos); f.g.updateExpedition(.7);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(.1);
  expect(f.route.hold).toBe(0); expect(f.route.revealed).toBe(true); expect(f.route.progress).toBe(0);
  select(f, gate.answer); expect(f.route.progress).toBe(1);
});

test('post-route damage or a same-frame action cancels the one-second pending confirmation before any payment', () => {
  for (const cause of ['damage', 'skill']) {
    const f = fixture(); defend(f, 1); const gate = read(f);
    f.g.player.pos.copy(gate.pads[0].pos); f.g.updateExpedition(1);
    expect(gate.attuned).toBe(false); expect(f.route.progress).toBe(0); expect(f.drops).toHaveLength(0);
    if (cause === 'damage') f.g.player.hp -= 5; else f.g.player.state = 'skill';
    f.route.observePlayer(f.g.player); f.g.player.state = 'idle'; f.g.player.hp = 100;
    f.g.updateExpedition(1); expect(gate.attuned).toBe(false); expect(f.route.read).toBe(0);
    read(f); select(f, gate.answer); expect(f.route.progress).toBe(1);
  }
});

test('dead, stopped, inactive, paused, replaced-world and ended-boss controllers cannot confirm or restore', () => {
  for (const cause of ['dead', 'stop', 'inactive', 'paused', 'world', 'boss']) {
    const f = fixture(); defend(f, 1); const gate = read(f); f.g.player.pos.copy(gate.pads[0].pos); f.g.updateExpedition(1);
    if (cause === 'dead') f.g.player.alive = false; if (cause === 'stop') f.route.stop(); if (cause === 'inactive') f.g.active = false;
    if (cause === 'paused') f.g.paused = true; if (cause === 'world') f.g.world = {}; if (cause === 'boss') f.g.bossDefeated = true;
    f.g.updateExpedition(10); expect(f.route.progress).toBe(0); expect(f.route.read).toBe(0); expect(f.route.hold).toBe(0);
    expect(gate.room.cleared).toBe(false); expect(f.drops).toHaveLength(0);
  }
});

test('4/4 AND every nonboss room gate the actual Battle seal/victory; frozen report and repeated clear cannot pay twice', () => {
  const f = fixture(); for (let i = 0; i < 4; i++) restore(f, i);
  expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(false); f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  f.g.bossDefeated = true; f.g.victory(); expect(f.g.result).toBeNull(); f.g.bossDefeated = false;
  for (const room of f.world.rooms) if (!['start', 'boss'].includes(room.type) && !room.cleared) defend(f, room.id);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(false); expect(f.route.canWin()).toBe(false);
  f.world.bossRoom.cleared = true; f.g.bossDefeated = true; f.g.victory();
  const report = f.g.result.routeObjective;
  expect(report.complete).toBe(true); expect(report.progress).toBe(4); expect(report.target).toBe(4);
  expect(report.constellations.map((c: any) => c.stationId)).toEqual([1, 2, 3, 4]);
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  expect(Object.isFrozen(report.constellations)).toBe(true); expect(report.constellations.every(Object.isFrozen)).toBe(true);
  const label = report.constellations[0].label, paid = f.drops.length; f.route.gates[0].label = 'changed';
  expect(report.constellations[0].label).toBe(label); expect(f.route.finish(false)).toBe(report); expect(f.route.autoRoom()).toBeNull();
  f.g.victory(); for (const gate of f.route.gates) f.g.markCleared(gate.room); expect(f.drops.length).toBe(paid);
});

test('loss preserves only actual restored identities; stop/new run starts 0/4 with no old pending confirmation', () => {
  const f = fixture(); restore(f); f.g.defeat(); const report = f.g.result.routeObjective, paid = f.drops.length;
  expect(report.complete).toBe(false); expect(report.progress).toBe(1); expect(report.constellations.map((c: any) => c.stationId)).toEqual([1]);
  f.g.active = true; read(f, 1); select(f, 'diamond', 1); expect(f.route.progress).toBe(1); expect(f.route.finish(true)).toBe(report);
  f.route.stop(); expect(f.route.canUnseal()).toBe(false); expect(f.route.canWin()).toBe(false); const next = fixture(); expect(next.route.progress).toBe(0); expect(next.route.read).toBe(0); expect(next.route.mistakes).toBe(0);
  expect(f.drops.length).toBe(paid);
});

test('AUTO walks actual Floor inner-mask paths through four choices and remaining ordinary rooms to unseal', () => {
  const f = fixture(); f.g.player.auto = true;
  for (let frame = 0; frame < 7000 && f.world.sealed; frame++) {
    const room = f.world.roomAt(f.g.player.pos.x, f.g.player.pos.z); if (room) f.g.enterRoom(room); flush(f);
    for (const r of f.world.rooms) if (r.spawned && !r.cleared && r.type !== 'boss') killWave(f, r);
    f.g.updateExpedition(.1);
    const move = Player.prototype.autoExplore.call(f.g.player, .1), pos = f.g.player.pos;
    const [x, z] = f.world.resolve(pos.x, pos.z, pos.x + move.x * .8, pos.z + move.y * .8, .6); pos.set(x, 0, z);
  }
  expect(f.world.sealed).toBe(false); expect(f.route.progress).toBe(4);
  expect(f.g.roomsCleared).toBe(f.world.rooms.length - 2); expect(f.g.treasureRooms).toBe(2);
});

test('actual Astral catalog ticket pays once, rejects replay after save/reload, and loss/abandon do not pay', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  } });
  try {
    const eco = new Economy(), x = new ExpeditionEconomy(eco); x.claimQuest('first_oath');
    // Progress only through the pre-existing catalog settlement authority.
    for (let i = 0; i < 6; i++) { const run = x.begin('dungeon', 'glass_garden'); expect(run.ok).toBe(true); expect(x.settle(run.ticket, { win: true }).ok).toBe(true); }
    expect(x.dungeonAccess('astral_leviathan_spire').ok).toBe(true);
    const f = fixture(); for (let i = 0; i < 4; i++) restore(f, i);
    for (const room of f.world.rooms) if (!['start', 'boss'].includes(room.type) && !room.cleared) defend(f, room.id);
    f.g.unsealBoss(); f.world.bossRoom.cleared = true; f.g.bossDefeated = true; f.g.victory();
    const entry = x.begin('dungeon', 'astral_leviathan_spire'); expect(entry.ok).toBe(true);
    expect(x.settle(entry.ticket, f.g.result).ok).toBe(true); const paid = eco.s.gold, stats = x.s.stats.astral_leviathan_spire;
    expect(x.settle(entry.ticket, f.g.result).ok).toBe(false); expect(eco.s.gold).toBe(paid);
    const loaded = new Economy(), y = new ExpeditionEconomy(loaded); expect(y.settle(entry.ticket, f.g.result).ok).toBe(false);
    expect(loaded.s.gold).toBe(paid); expect(y.s.stats.astral_leviathan_spire).toBe(stats);
    const loss = y.begin('dungeon', 'astral_leviathan_spire'); expect(loss.ok).toBe(true);
    expect(y.settle(loss.ticket, { win: false }).ok).toBe(true); expect(loaded.s.gold).toBe(paid);
    const abandoned = y.begin('dungeon', 'astral_leviathan_spire'); expect(abandoned.ok).toBe(true);
    expect(y.abandon(abandoned.ticket).ok).toBe(true); expect(y.abandon(abandoned.ticket).ok).toBe(false); expect(loaded.s.gold).toBe(paid);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('actual catalog roster counts are preserved and require every production spawn receipt before a clue', () => {
  const f = fixture(); f.g.roomRoster = (room: any) => expeditionRoster(f.g.stage, room);
  for (const id of [1, 3, 4, 6]) {
    const gate = f.route.gates.find((g: any) => g.room.id === id)!;
    const count = expeditionRoster(f.g.stage, gate.room).length, room = enter(f, id, true);
    expect(count).toBe(room.type === 'elite' ? 5 : 7); expect(gate.expected).toBe(count);
    f.g.timers.shift().fn(); killWave(f, room); expect(gate.ready).toBe(false);
    flush(f); killWave(f, room); expect(gate.spawnCount).toBe(count); expect(gate.ready).toBe(true);
  }
});
