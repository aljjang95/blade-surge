import { expect, spyOn, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { NightglassRecords } from '../src/game/nightglass-records.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';
import * as assets from '../src/engine/assets.js';

const noop = () => {};
function fixture(depth = 'standard') {
  const stage = buildExpeditionStage('dungeon', 'nightglass_observatory', null, { depth });
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
    // 렌더 액터만 대체한다. 입장/스폰 큐/증원/보상/봉인/결과/길찾기는 실제 메서드다.
    roomRoster: () => ['guard', 'guard'],
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as NightglassRecords;
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages, drops };
}
type Fixture = ReturnType<typeof fixture>;
function flush(f: Fixture) { for (const timer of f.g.timers.splice(0)) timer.fn(); }
function enter(f: Fixture, id: number, delayed = false) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  if (!delayed) flush(f);
  return room;
}
function killWave(f: Fixture, room: any) {
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
}
function defend(f: Fixture, id: number) {
  const room = enter(f, id);
  for (let i = 0; i <= (room.type === 'elite' ? f.g.stage.expedition.mechanics.reinforcements : 0); i++) killWave(f, room);
  return room;
}
function restore(f: Fixture, index: number) {
  const gate = f.route.gates[index]; defend(f, gate.room.id);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(2);
  return gate;
}
function cell(world: any, point: any) {
  return Math.floor(point.z - world.minZ) * world.cols + Math.floor(point.x - world.minX);
}

test('real sealed Floors expose standard 2/5/6 and deep 6->4->1 with three distinct page identities', () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(depth), ids = depth === 'standard' ? [2, 5, 6] : [6, 4, 1];
    const pages = depth === 'standard' ? [1, 2, 3] : [3, 2, 1];
    expect(f.route).toBeInstanceOf(NightglassRecords); expect(f.world.sealed).toBe(true);
    expect(f.route.def.kind).toBe('records'); expect(f.route.def.radius).toBe(2); expect(f.route.def.holdSeconds).toBe(2);
    expect(f.route.gates.map((g: any) => g.room.id)).toEqual(ids);
    expect(f.route.gates.map((g: any) => g.pageId)).toEqual(pages);
    expect(new Set(f.route.gates.map((g: any) => g.id)).size).toBe(3);
    expect(new Set(f.route.gates.map((g: any) => g.label)).size).toBe(3);
    let from: any = f.world.startRoom;
    for (const gate of f.route.gates) {
      const flow = f.world.buildFlow(from.x, from.z)!;
      expect(flow[cell(f.world, gate.pos)]).toBeGreaterThanOrEqual(0);
      expect(gate.room.objectiveProp).toBe('nightglass-record');
      from = gate.pos;
    }
    expect(f.route.hint()).toContain(depth === 'deep' ? '3→2→1' : '1→2→3');
    const altars = f.world.rooms.filter((r: any) => f.route.allowsAttunement(r));
    expect(altars.map((r: any) => r.id)).toEqual(depth === 'deep' ? [2, 5] : []);
    for (const room of altars) {
      expect(room.type).toBe('treasure'); expect((room as any).objectiveProp).toBeUndefined();
      expect(f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)![cell(f.world, room)]).toBeGreaterThanOrEqual(0);
    }
  }
});

test('records exclude party, arena, rift, conquest and unknown depths; unreachable placement fails closed', () => {
  const f = fixture(), base = f.g.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    ...[{ kind: 'arena' }, { riftId: 'x' }, { conquestId: 'x' }, { depth: 'unknown' }]
      .map(extra => ({ ...base, expedition: { ...base.expedition, ...extra } }))]) {
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
  const def = { ...f.route.def, gates: [{ ...f.route.def.gates[0], roomId: f.world.bossRoom.id }] };
  expect(() => new NightglassRecords(def, f.world)).toThrow(RangeError);
  const blocked = { ...f.world, buildFlow: () => new Int32Array(f.world.cols! * f.world.rows!).fill(-1) };
  expect(() => new NightglassRecords(f.route.def, blocked)).toThrow(RangeError);
});

test('initial spawn count, alive enemies and pending queue independently block readiness', () => {
  const f = fixture(), room = enter(f, 2, true), gate = f.route.gates[0];
  f.g.markCleared(room); expect(gate.ready).toBe(false); expect(gate.spawnCount).toBe(0);
  const first = f.g.timers.shift(); first.fn(); killWave(f, room);
  expect(gate.spawnCount).toBe(1); expect(gate.ready).toBe(false);
  flush(f); f.g.markCleared(room); expect(gate.ready).toBe(false);
  f.g.pending.push({ t: 'guard', room }); killWave(f, room); expect(gate.ready).toBe(false);
  const pending = f.g.pending.shift(); f.g.spawnEnemy(pending.t, null, room); killWave(f, room);
  expect(gate.ready).toBe(true); expect(room.cleared).toBe(false);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(1.99); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.01); expect(f.route.progress).toBe(1); expect(room.cleared).toBe(true);
  const paid = f.drops.length;
  f.g.markCleared(room); f.g.updateExpedition(2); expect(f.g.roomsCleared).toBe(1); expect(f.drops.length).toBe(paid);
});

test('out-of-order clearance waits and late pending or live enemies reset an active hold', () => {
  const f = fixture(); defend(f, 5); defend(f, 2);
  const first = f.route.gates[0], second = f.route.gates[1];
  f.g.player.pos.copy(second.pos); f.g.updateExpedition(4); expect(f.route.progress).toBe(0);
  expect(second.ready).toBe(true); expect(second.attuned).toBe(false); expect(second.room.cleared).toBe(false);
  f.g.player.pos.copy(first.pos); f.g.updateExpedition(1);
  f.g.pending.push({ t: 'guard', room: first.room }); f.g.updateExpedition(.1); expect(f.route.hold).toBe(0);
  f.g.pending.length = 0; f.g.updateExpedition(1);
  f.g.spawnEnemy('guard', null, first.room); f.g.updateExpedition(.1); expect(f.route.hold).toBe(0);
  killWave(f, first.room); f.g.updateExpedition(2); expect(f.route.progress).toBe(1);
  f.g.player.pos.copy(second.pos); f.g.updateExpedition(2); expect(f.route.progress).toBe(2);
});

test('actions, hurt, leaving and pause each require a fresh continuous two-second hold for manual and AUTO', () => {
  for (const auto of [false, true]) {
    for (const cause of ['attack', 'skill', 'ult', 'dodge', 'hurt', 'damage', 'leave', 'pause']) {
      const f = fixture(); defend(f, 2); const gate = f.route.gates[0];
      f.g.player.auto = auto; f.g.player.pos.copy(gate.pos); f.g.updateExpedition(1.5);
      if (cause === 'pause') { f.g.setPaused('test', true); f.g.updateExpedition(5); f.g.setPaused('test', false); }
      else {
        if (cause === 'leave') f.g.player.pos.x += f.route.def.radius + .01;
        else if (cause === 'damage') f.g.player.hp--;
        else f.g.player.state = cause;
        f.g.updateExpedition(.1);
      }
      expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
      f.g.player.state = 'idle'; f.g.player.pos.copy(gate.pos); f.g.updateExpedition(1.99);
      expect(f.route.progress).toBe(0); f.g.updateExpedition(.01); expect(f.route.progress).toBe(1);
    }
  }
});

test('an action ending within the same frame and health loss before healing still interrupt', () => {
  const f = fixture(); defend(f, 2); f.g.player.pos.copy(f.route.gates[0].pos); f.g.updateExpedition(1.5);
  f.g.player.state = 'skill'; f.route.observePlayer(f.g.player);
  f.g.player.state = 'idle'; f.g.updateExpedition(2); expect(f.route.progress).toBe(0); expect(f.route.hold).toBe(0);
  f.g.updateExpedition(1.5); f.g.player.hp -= 10; f.route.observePlayer(f.g.player);
  f.g.player.hp += 10; f.g.updateExpedition(2); expect(f.route.hold).toBe(0);
  f.g.updateExpedition(2); expect(f.route.progress).toBe(1);
});

test('actual Player.hurt immediately interrupts record and altar holds only after successful damage', () => {
  for (const target of ['record', 'altar']) {
    for (const guard of ['none', 'invulnerable', 'shield']) {
      const f = fixture('deep');
      const room: any = defend(f, target === 'record' ? 6 : 5);
      const p = f.g.player;
      Object.assign(p, { def: { id: 'knight' }, stats: { def: 0 }, invuln: guard === 'invulnerable' ? 1 : 0,
        flash: noop, knockback: noop, stopTrail: noop });
      f.g.ui.hurtVignette = noop;
      if (guard === 'shield') f.g.absorbDamage = () => 0;
      p.pos.set(room.x, 0, room.z); f.g.updateExpedition(1.25);
      const hold = () => target === 'record' ? f.route.hold : room.attunementT;
      expect(hold()).toBeCloseTo(1.25);
      const hit = Player.prototype.hurt.call(p, 10, { kb: 0 });
      expect(hit).toBe(guard === 'none');
      expect(p.hp).toBe(guard === 'none' ? 90 : 100);
      expect(hold()).toBe(guard === 'none' ? 0 : 1.25);
      expect(f.route.progress).toBe(0); expect(room.cleared).toBe(false);
      if (guard === 'none') {
        f.g.updateExpedition(2); expect(hold()).toBe(0);
        p.state = 'idle'; f.g.updateExpedition(1.99); expect(room.cleared).toBe(false);
        f.g.updateExpedition(.01); expect(room.cleared).toBe(true);
      }
    }
  }
});

test('dead, stopped, inactive, paused and stale-world controllers cannot restore pages or altars', () => {
  for (const cause of ['dead', 'stop', 'inactive', 'paused', 'world', 'boss']) {
    const f = fixture('deep'), room: any = defend(f, 5);
    f.g.player.pos.set(room.x, 0, room.z); f.g.updateExpedition(1);
    if (cause === 'dead') f.g.player.alive = false;
    if (cause === 'stop') f.route.stop();
    if (cause === 'inactive') f.g.active = false;
    if (cause === 'paused') f.g.paused = true;
    if (cause === 'world') f.g.world = {};
    if (cause === 'boss') f.g.bossDefeated = true;
    f.g.updateExpedition(8); expect(room.attunementT).toBe(0); expect(room.cleared).toBe(false);
    expect(f.route.progress).toBe(0);
  }
});

test('deep treasure altars retain separate two-second attunement, interruption, AUTO targets and rewards', () => {
  const f = fixture('deep');
  for (const id of [5, 2]) {
    const room: any = enter(f, id, true);
    f.g.markCleared(room); expect(room.attunementPending).toBeUndefined();
    flush(f); killWave(f, room);
    expect(room.attunementPending).toBe(true); expect(room.cleared).toBe(false);
    expect(f.route.autoRoom()).toBe(room); expect(f.g.autoTarget).toBe(room);
    const pos = f.route.autoPoint(room)!; f.g.player.pos.copy(pos);
    expect(Player.prototype.autoExplore.call(f.g.player, .016)).toEqual({ x: 0, y: 0 });
    f.g.updateExpedition(1.5); expect(room.attunementT).toBeCloseTo(1.5);
    f.g.setPaused('test', true); expect(room.attunementT).toBe(0); f.g.setPaused('test', false);
    f.g.updateExpedition(1.5); f.g.player.state = 'attack'; f.g.updateExpedition(.1); expect(room.attunementT).toBe(0);
    f.g.player.state = 'idle'; f.g.updateExpedition(1.99); expect(room.cleared).toBe(false);
    f.g.updateExpedition(.01); expect(room.attuned).toBe(true); expect(room.cleared).toBe(true);
    const paid = f.drops.length; f.g.markCleared(room); f.g.updateExpedition(3); expect(f.drops.length).toBe(paid);
    expect(f.route.autoRoom()).toBe(f.route.gates[0].room); expect(f.route.progress).toBe(0);
  }
  expect(f.g.treasureRooms).toBe(2); expect(f.route.hint()).toContain('제단 2/2');
});

test('existing elite reinforcement waves cannot duplicate or permit early record operation', () => {
  const f = fixture(); f.g.stage.expedition.mechanics.reinforcements = 2;
  const room: any = enter(f, 4, true);
  f.g.markCleared(room); expect(room.forgeWave).toBeUndefined();
  flush(f); killWave(f, room); expect(room.forgeWave).toBe(1);
  f.g.markCleared(room); expect(room.forgeWave).toBe(1);
  f.g.maxAlive = 0; killWave(f, room); expect(room.forgeWave).toBe(2); expect(f.g.pending).toHaveLength(4);
  f.g.markCleared(room); expect(room.cleared).toBe(false);
  for (const pending of f.g.pending.splice(0)) f.g.spawnEnemy(pending.t, null, pending.room);
  killWave(f, room); expect(room.cleared).toBe(true); expect(f.g.enemies).toHaveLength(10);
  const paid = f.drops.length; f.g.markCleared(room); expect(f.drops.length).toBe(paid);
});

test('all rooms AND both deep altars gate the boss, while Battle victory freezes page identity receipts', () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(depth);
    for (let i = 0; i < 3; i++) restore(f, i);
    expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(false);
    f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
    f.g.bossDefeated = true; f.g.victory(); expect(f.g.result).toBeNull(); f.g.bossDefeated = false;
    for (const r of f.world.rooms) if (!['start', 'boss'].includes(r.type) && !r.cleared) defend(f, r.id);
    if (depth === 'deep') {
      f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
      for (const id of [2, 5]) { const r = f.world.rooms[id]; f.g.player.pos.set(r.x, 0, r.z); f.g.updateExpedition(2); }
    }
    f.g.unsealBoss(); expect(f.world.sealed).toBe(false);
    f.world.bossRoom.cleared = true; f.g.bossDefeated = true; f.g.victory();
    const report = f.g.result.routeObjective;
    expect(report.complete).toBe(true); expect(report.progress).toBe(3); expect(report.target).toBe(3);
    expect(report.pages.map((p: any) => p.pageId)).toEqual(depth === 'deep' ? [3, 2, 1] : [1, 2, 3]);
    expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
    expect(Object.isFrozen(report.pages)).toBe(true); expect(report.pages.every(Object.isFrozen)).toBe(true);
    expect(f.route.finish(false)).toBe(report); expect(f.route.autoRoom()).toBeNull();
    const label = report.pages[0].label; f.route.gates[0].label = 'changed'; expect(report.pages[0].label).toBe(label);
  }
});

test('loss records only restored pages and cannot later become success or issue extra rewards', () => {
  const f = fixture('deep'); restore(f, 0); f.g.defeat();
  const report = f.g.result.routeObjective, paid = f.drops.length;
  expect(report.complete).toBe(false); expect(report.progress).toBe(1);
  expect(report.pages.map((p: any) => p.pageId)).toEqual([3]);
  f.g.active = true; f.g.player.pos.copy(f.route.gates[1].pos); f.g.updateExpedition(10);
  expect(f.route.progress).toBe(1); expect(f.route.finish(true)).toBe(report); expect(f.drops.length).toBe(paid);
});

test('AUTO walks real Floor paths through records, ordinary rooms and both deep altars to unseal', () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(depth), visitedAltars = new Set<number>(); f.g.player.auto = true;
    for (let frame = 0; frame < 5000 && f.world.sealed; frame++) {
      const room = f.world.roomAt(f.g.player.pos.x, f.g.player.pos.z);
      if (room) f.g.enterRoom(room);
      flush(f);
      for (const r of f.world.rooms) if (r.spawned && !r.cleared && r.type !== 'boss') killWave(f, r);
      f.g.updateExpedition(.1);
      if (f.g.autoTarget?.attunementPending) visitedAltars.add(f.g.autoTarget.id);
      const move = Player.prototype.autoExplore.call(f.g.player, .1), pos = f.g.player.pos;
      const [x, z] = f.world.resolve(pos.x, pos.z, pos.x + move.x * .8, pos.z + move.y * .8, .6);
      pos.set(x, 0, z);
    }
    expect(f.world.sealed).toBe(false); expect(f.route.progress).toBe(3);
    expect(f.g.roomsCleared).toBe(f.world.rooms.length - 2); expect(f.g.treasureRooms).toBe(2);
    expect([...visitedAltars].sort()).toEqual(depth === 'deep' ? [2, 5] : []);
  }
});

test('concurrent view preparations share one load and cancelled late loads never attach a view', async () => {
  const f = fixture(); let release!: (gltf: any) => void, loaded!: () => void;
  const requested = new Promise<void>(resolve => { loaded = resolve; });
  const model = new Promise<any>(resolve => { release = resolve; });
  const load = spyOn(assets, 'loadModel').mockImplementation(() => { loaded(); return model; });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const a = f.route.prepareView(f.g.scene), b = f.route.prepareView(f.g.scene);
    // 지연 import가 이벤트 루프에 작업을 남기지 않아도 완료 없이 테스트가 종료되지 않는다.
    await Promise.race([requested, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('record model load was not requested')), 1000);
    })]);
    expect(load).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledWith('tllNightglassRecord');
    f.route.stop(); release({}); await Promise.all([a, b]);
    expect(f.route.view).toBeNull(); expect(f.g.scene.children).toHaveLength(0);
    await f.route.prepareView(f.g.scene); expect(load).toHaveBeenCalledTimes(1);
  } finally { clearTimeout(timeout); f.route.stop(); release({}); load.mockRestore(); }
});

test('Battle repeated start and cancellation close old controllers and reject late start continuations', async () => {
  const f = fixture(), releases: Array<() => void> = [];
  let disposed = 0; (f.route as any).view = { dispose: () => disposed++ };
  const prepare = spyOn(NightglassRecords.prototype, 'prepareView').mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)));
  try {
    const first = f.g.start(f.g.stage, 'knight', { level: 1 }, {}), routeA = f.g.routeObjectives;
    expect(disposed).toBe(1); expect(f.route.closed).toBe(true);
    const second = f.g.start(f.g.stage, 'knight', { level: 1 }, {}), routeB = f.g.routeObjectives;
    expect(routeA.closed).toBe(true); expect(routeB).not.toBe(routeA); expect(routeB.progress).toBe(0);
    releases[0](); await first; expect(f.g.routeObjectives).toBe(routeB); expect(f.g.active).toBe(false);
    f.g.stop(); releases[1](); await second;
    expect(routeB.closed).toBe(true); expect(f.g.player).toBeNull(); expect(f.g.world).toBeNull(); expect(f.g.active).toBe(false);
    expect(f.g.routeObjectives).toBeNull(); expect(disposed).toBe(1);
  } finally { prepare.mockRestore(); releases.forEach(resolve => resolve()); }
});
