import { expect, test } from 'bun:test';
import { Group, Scene, Vector3 } from 'three';
import { GARDEN_MAP_TACTICS, mapTacticsForStage } from '../src/data/map-tactics.js';
import { createMapTactics, MapTactics } from '../src/game/map-tactics.js';
import { buildExpeditionStage, buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { Floor } from '../src/game/world.js';
import { Actor } from '../src/game/actor.js';
import { Enemy } from '../src/game/enemies.js';
import { Battle } from '../src/game/battle-base.js';

const noop = () => {};
// 원래 JS 생성자의 null 기본값 추론만 보완한다. 실제 Floor와 작성된 이동 지도를 그대로 실행한다.
const AuthoredFloor = Floor as unknown as new (floor: number, theme: string, seed: number,
  layout: typeof EXPEDITION_LAYOUTS.glass_garden) => Floor;
function fixture() {
  const stage = buildExpeditionStage('dungeon', 'glass_garden', null), world = buildExpeditionWorld(stage);
  const messages: string[] = [], rewards: any[] = [], game: any = Object.create(Battle.prototype);
  Object.assign(game, { stage, world, active: true, paused: false, bossDefeated: false, scene: new Scene(),
    enemies: [], pending: [], projectiles: [], timers: [], roomsCleared: 0, treasureRooms: 0,
    kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, pauseReasons: new Set(),
    app: { eco: { s: {} } }, renderer: { desat: 0, shake: noop, flashScreen: noop },
    arena: { openSeal: noop }, openPortal: noop, input: { enabled: true, clear: noop },
    ui: { toast: (message: string) => messages.push(message), showResult: noop, showHud: noop,
      setObjective: noop, setFloorLabel: noop, showBoss: noop, waveBanner: noop },
    fx: { burst: noop, embers: noop, groundTex: noop, castCircle: noop, clearAll: noop },
    drops: { spawn: (...args: any[]) => rewards.push(args), clear: noop }, rollDrop: () => ({ id: 'fixture-drop' }),
    player: { alive: true, auto: false, hp: 100, maxHp: 100, state: 'idle',
      pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      forward: (v: Vector3) => v.set(1, 0, 0), play: noop, dispose: noop },
  });
  const tactics = createMapTactics(stage, world)!;
  game.mapTactics = tactics; tactics.room.discovered = true; tactics.room.spawned = true;
  return { stage, world, game, tactics, messages, rewards };
}
type Fixture = ReturnType<typeof fixture>;
function operator(f: Fixture, choice = 'gather') {
  const node = f.tactics.nodes.find((node: any) => node.id === choice)!;
  f.game.player.pos.set(node.operator.x, 0, node.operator.z); return node;
}
function enemy(f: Fixture, node: any, dx = 3, dz = 0, extra: any = {}) {
  // 실제 Actor의 충격·감쇠·Floor.resolve와 Enemy의 당김 저항을 사용한다. 모델 로드는 제외한다.
  const e: any = Object.create(Enemy.prototype), root = new Group(), model = new Group(), motionRoot = new Group();
  root.add(motionRoot); motionRoot.add(model); root.position.set(node.anchor.x + dx, 0, node.anchor.z + dz);
  Object.assign(e, { game: f.game, root, model, motionRoot, pos: root.position,
    mixer: { update: noop, stopAllAction: noop, uncacheRoot: noop, getRoot: () => model },
    vel: new Vector3(), kb: new Vector3(), rig: { hover: 0 },
    radius: .7, yaw: 0, stun: 0, slowT: 0, invuln: 0, mats: [], flashT: 0,
    deathT: -1, alive: true, dead: false, spawning: false, isBoss: false, isElite: false,
    homeRoom: f.tactics.room, hp: 100, ...extra });
  f.game.enemies.push(e); return e;
}
function step(f: Fixture, dt: number) {
  f.tactics.update(f.game, dt);
  for (const e of f.game.enemies) Actor.prototype.update.call(e, dt);
}
function cell(world: any, point: any) { return Math.floor(point.z - world.minZ) * world.cols + Math.floor(point.x - world.minX); }

test('first standard solo garden owns two distinct, reachable operator areas while every original room and seal remain', () => {
  const f = fixture(), base = f.stage;
  expect(mapTacticsForStage(base)).toBe(GARDEN_MAP_TACTICS);
  expect(f.tactics.nodes.map((node: any) => node.id)).toEqual(['gather', 'release']);
  expect(f.world.rooms).toHaveLength(5); expect(f.world.sealed).toBe(true);
  expect(f.world.rooms.map(room => room.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'boss']);
  const variants = [{ ...base, party: {} }, { ...base, riftId: 'x' },
    ...[{ id: 'bellfall_crypt' }, { depth: 'deep' }, { depth: undefined }, { kind: 'arena' },
      { conquestId: 'x' }, { riftId: 'x' }].map(extra => ({ ...base, expedition: { ...base.expedition, ...extra } }))];
  for (const stage of variants) expect(createMapTactics(stage, f.world)).toBeNull();
  // 배치 흔들림과 방 크기 변형에서 조작판 전체가 실제 봉인 바깥 거리장에 남아야 한다.
  for (let seed = 1; seed <= 32; seed++) {
    const world = new AuthoredFloor(1, 'garden', seed, EXPEDITION_LAYOUTS.glass_garden);
    const tactics = new MapTactics(GARDEN_MAP_TACTICS, world);
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z)!;
    for (const node of tactics.nodes) {
      expect(flow[cell(world, node.operator)]).toBeGreaterThanOrEqual(0);
      expect(flow[cell(world, node.anchor)]).toBeGreaterThanOrEqual(0);
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const point = { x: node.operator.x + Math.cos(angle) * 1.95, z: node.operator.z + Math.sin(angle) * 1.95 };
        expect(flow[cell(world, point)]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(flow[cell(world, world.bossRoom)]).toBe(-1);
  }
});

test('manual context consumes shared charge atomically, rejects zero targets and never lets AUTO choose', () => {
  const f = fixture(), node = operator(f);
  expect(f.tactics.snapshot(f.game)).toMatchObject({ actionable: false, blockedReason: 'no-targets', targetCount: 0 });
  expect(f.tactics.interact(f.game)).toBe(false); expect(f.tactics.used).toBe(false);
  expect(f.messages).toContain('범위 안 적 없음');
  const alreadyGathered = enemy(f, node, .4);
  expect(f.tactics.snapshot(f.game).targetCount).toBe(0);
  expect(f.tactics.interact(f.game)).toBe(false); expect(f.tactics.used).toBe(false);
  alreadyGathered.alive = false;
  enemy(f, node);
  for (const blocked of ['paused', 'auto', 'dead'] as const) {
    if (blocked === 'paused') f.game.paused = true;
    if (blocked === 'auto') f.game.player.auto = true;
    if (blocked === 'dead') f.game.player.alive = false;
    expect(f.tactics.snapshot(f.game).blockedReason).toBe(blocked);
    expect(f.tactics.interact(f.game)).toBe(false); expect(f.tactics.used).toBe(false);
    f.game.paused = false; f.game.player.auto = false; f.game.player.alive = true;
  }
  expect(f.tactics.interact(f.game)).toBe(true);
  expect(f.tactics.interact(f.game)).toBe(false);
  operator(f, 'release'); expect(f.tactics.interact(f.game)).toBe(false);
  expect(f.tactics.snapshot(f.game)).toMatchObject({ selectedId: 'gather', phase: 'windup', used: true, blockedReason: 'spent' });
  expect(f.game.roomsCleared).toBe(0); expect(f.game.treasureRooms).toBe(0); expect(f.rewards).toHaveLength(0);
});

test('radius-six fire-time eligibility excludes other rooms, boss, spawn and stale targets; receipts count actual impulse recipients', () => {
  const f = fixture(), node = operator(f, 'release');
  const inside = enemy(f, node, 6), outside = enemy(f, node, 6.001);
  const boss = enemy(f, node, 2, 0, { isBoss: true }), spawning = enemy(f, node, 2, 0, { spawning: true });
  const other = enemy(f, node, 2, 0, { homeRoom: f.world.rooms[1] });
  const stale = enemy(f, node, 2), late = enemy(f, node, 7);
  expect(f.tactics.snapshot(f.game).targetCount).toBe(2);
  expect(f.tactics.interact(f.game)).toBe(true);
  f.tactics.update(f.game, .349); expect(inside.kb.length()).toBe(0);
  stale.alive = false; late.pos.x = node.anchor.x + 3;
  f.game.player.state = 'attack'; f.tactics.update(f.game, .001);
  expect(inside.kb.x).toBe(14); expect(late.kb.x).toBe(14);
  for (const e of [outside, boss, spawning, other, stale]) expect(e.kb.length()).toBe(0);
  const report = f.tactics.finish();
  expect(report).toMatchObject({ selectedId: 'release', label: '방출', affectedCount: 2, phase: 'spent', used: true, canceled: false });
  expect(Object.isFrozen(report)).toBe(true); expect(f.tactics.finish()).toBe(report);
  expect(inside.hp).toBe(100); expect(f.rewards).toHaveLength(0);
});

test('windup reservation can truthfully finish with no recipient after all targets leave or die', () => {
  const f = fixture(), node = operator(f, 'release'), e = enemy(f, node);
  expect(f.tactics.interact(f.game)).toBe(true); e.pos.x = node.anchor.x + 7;
  f.tactics.update(f.game, 1);
  expect(e.kb.length()).toBe(0);
  expect(f.tactics.finish()).toMatchObject({ used: true, selectedId: 'release', affectedCount: 0, canceled: false });
});

test('gather rechecks each tick, scales impulse by dt, preserves elite resistance and counts each recipient once', () => {
  const f = fixture(), node = operator(f), normal = enemy(f, node), elite = enemy(f, node, 3, 0, { isElite: true });
  const center = enemy(f, node, .4), leaving = enemy(f, node, 4);
  expect(f.tactics.interact(f.game)).toBe(true); f.tactics.update(f.game, .35);
  expect(normal.kb.length()).toBe(0); expect(f.tactics.phase).toBe('active');
  f.tactics.update(f.game, .1);
  expect(normal.kb.x).toBeCloseTo(-3); expect(elite.kb.x).toBeCloseTo(-1.5); expect(center.kb.length()).toBe(0);
  expect(f.tactics.affectedCount).toBe(3);
  leaving.pos.x = node.anchor.x + 7; const prior = leaving.kb.x;
  f.tactics.update(f.game, .1); expect(leaving.kb.x).toBe(prior);
  expect(f.tactics.affectedCount).toBe(3);
  expect(normal.hp).toBe(100); expect(elite.stun).toBe(0);
});

function runMovement(choice: string, fps: number, elite = false) {
  const f = fixture(), node = operator(f, choice), e = enemy(f, node, 3.8, 0, { isElite: elite });
  const initial = e.pos.distanceTo(new Vector3(node.anchor.x, 0, node.anchor.z));
  expect(f.tactics.interact(f.game)).toBe(true);
  for (let frame = 0; frame < fps * 1.3; frame++) step(f, 1 / fps);
  return { initial, distance: e.pos.distanceTo(new Vector3(node.anchor.x, 0, node.anchor.z)),
    position: e.pos.clone(), report: f.tactics.finish() };
}
test('30/60/120fps produce actual collision-resolved gathering and space creation with bounded frame variation', () => {
  for (const choice of ['gather', 'release']) {
    const runs = [30, 60, 120].map(fps => runMovement(choice, fps));
    for (const run of runs) {
      expect(run.report.affectedCount).toBe(1);
      if (choice === 'gather') expect(run.distance).toBeLessThan(run.initial - 2);
      else expect(run.distance).toBeGreaterThan(run.initial + .8);
    }
    const distances = runs.map(run => run.distance);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(.2);
  }
  expect(runMovement('release', 60, true).distance).toBeLessThan(runMovement('release', 60).distance);
});

test('outward pulse cannot move an enemy through the actual room wall or sealed boss entry', () => {
  const f = fixture(), node = operator(f, 'release'), e = enemy(f, node);
  e.pos.set(f.tactics.room.x + f.tactics.room.w / 2 - .7, 0, node.anchor.z - 4);
  expect(f.tactics.interact(f.game)).toBe(true);
  for (let frame = 0; frame < 120; frame++) {
    step(f, 1 / 60);
    expect(f.world.walkable(e.pos.x, e.pos.z)).toBe(true);
    expect(e.pos.x).toBeLessThan(f.tactics.room.x + f.tactics.room.w / 2);
    expect(f.world.roomAt(e.pos.x, e.pos.z)).not.toBe(f.world.bossRoom);
  }
  expect(f.world.sealed).toBe(true); expect(f.game.roomsCleared).toBe(0);
});

test('release retains normal armor and elite impulse resistance without invoking damage or shield-break state', () => {
  const f = fixture(), node = operator(f, 'release');
  const normal = enemy(f, node), armored = enemy(f, node, 3, 0, { def: { armor: .2 } });
  const elite = enemy(f, node, 3, 0, { isElite: true }), both = enemy(f, node, 3, 0, { isElite: true, def: { armor: .2 } });
  expect(f.tactics.interact(f.game)).toBe(true); f.tactics.update(f.game, .35);
  expect(normal.kb.x).toBe(14); expect(armored.kb.x).toBeCloseTo(8.4);
  expect(elite.kb.x).toBe(7); expect(both.kb.x).toBeCloseTo(4.2);
  for (const target of [normal, armored, elite, both]) { expect(target.hp).toBe(100); expect(target.stun).toBe(0); }
  expect(f.tactics.finish().affectedCount).toBe(4);
});

test('pause freezes reserved windup and active pull; death, room exit, stop and restart keep old charge spent', () => {
  const f = fixture(), node = operator(f), e = enemy(f, node);
  expect(f.tactics.interact(f.game)).toBe(true); f.tactics.update(f.game, .2);
  const before = f.tactics.snapshot(f.game).remainingSeconds;
  f.game.setPaused('companion', true); f.tactics.update(f.game, 30);
  expect(f.tactics.snapshot(f.game).remainingSeconds).toBe(before); expect(e.kb.length()).toBe(0);
  f.game.setPaused('map', true); f.game.setPaused('companion', false); expect(f.game.paused).toBe(true);
  f.game.setPaused('map', false); f.tactics.update(f.game, .25);
  expect(f.tactics.phase).toBe('active'); const impulse = e.kb.x;
  f.game.setPaused('manual', true); f.tactics.update(f.game, 30); expect(e.kb.x).toBe(impulse);
  f.game.setPaused('manual', false);
  f.game.player.pos.copy(new Vector3(f.world.rooms[1].x, 0, f.world.rooms[1].z));
  f.tactics.update(f.game, 1); expect(f.tactics.phase).toBe('canceled'); expect(e.kb.x).toBe(impulse);
  operator(f); expect(f.tactics.interact(f.game)).toBe(false);
  expect(f.tactics.finish()).toMatchObject({ used: true, canceled: true, affectedCount: 1 });
  for (const boundary of ['death', 'stop', 'world', 'inactive']) {
    const run = fixture(), op = operator(run); enemy(run, op); run.tactics.interact(run.game);
    if (boundary === 'death') run.game.player.alive = false;
    if (boundary === 'stop') run.tactics.stop();
    if (boundary === 'world') run.game.world = buildExpeditionWorld(run.stage);
    if (boundary === 'inactive') run.game.active = false;
    run.tactics.update(run.game, 1);
    expect(run.tactics.finish()).toMatchObject({ used: true, canceled: true, affectedCount: 0 });
    expect(run.tactics.interact(run.game)).toBe(false);
  }
  const fresh = createMapTactics(f.stage, buildExpeditionWorld(f.stage))!;
  expect(fresh.used).toBe(false); expect(fresh.selectedId).toBeNull(); expect(fresh.affectedCount).toBe(0);
});

test('read-only snapshot is frozen and cannot choose, move enemies, complete a room or grant rewards', () => {
  const f = fixture(), node = operator(f), e = enemy(f, node), position = e.pos.clone();
  const first = f.tactics.snapshot(f.game);
  for (let i = 0; i < 20; i++) expect(f.tactics.snapshot(f.game)).toBe(first);
  expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.nodes)).toBe(true);
  expect(Object.isFrozen(first.nodes[0])).toBe(true); expect(Object.isFrozen(first.nodes[0].operator)).toBe(true);
  expect(first).toMatchObject({ targetCount: 1, selectedId: null, used: false, actionable: true });
  expect(e.pos.equals(position)).toBe(true); expect(e.kb.length()).toBe(0);
  expect(f.tactics.room.cleared).toBe(false); expect(f.world.sealed).toBe(true); expect(f.rewards).toHaveLength(0);
});

test('Battle retry stops the old controller and creates fresh optional choice before rendering, without changing other routes', async () => {
  const f = fixture(), node = operator(f); enemy(f, node); f.tactics.interact(f.game); f.tactics.update(f.game, .5);
  const old = f.tactics;
  f.game.arena.buildFloor = () => { throw Error('render-boundary'); };
  await expect(f.game.start(f.stage, 'knight', { level: 1 }, {})).rejects.toThrow('render-boundary');
  expect(old.phase).toBe('closed'); expect(old.finish()).toMatchObject({ used: true, canceled: true, affectedCount: 1 });
  expect(f.game.mapTactics).not.toBe(old); expect(f.game.mapTactics.used).toBe(false);
  expect(f.game.mapTactics.selectedId).toBeNull(); expect(f.game.mapTactics.affectedCount).toBe(0);
  expect(f.game.world).not.toBe(f.world); expect(f.game.result).toBeNull();
  const other = buildExpeditionStage('dungeon', 'ember_vault', null);
  await expect(f.game.start(other, 'knight', { level: 1 }, {})).rejects.toThrow('render-boundary');
  expect(f.game.mapTactics).toBeNull();
});

test('normal Battle room/altar rewards and seal behave identically with unused or used optional plinth; result is a frozen receipt', () => {
  const counts: any[] = [];
  for (const use of [false, true]) {
    const f = fixture(), node = operator(f, 'release');
    if (use) { const e = enemy(f, node); f.tactics.interact(f.game); f.tactics.update(f.game, .35); e.alive = false; }
    for (const id of [1, 2, 3]) {
      const room: any = f.world.rooms[id]; room.spawned = true; f.game.markCleared(room);
      if (id === 2) {
        expect(room.cleared).toBe(false); f.game.player.pos.set(room.x, 0, room.z); f.game.updateExpedition(2);
        expect(room.attuned).toBe(true);
      }
    }
    for (const timer of f.game.timers.splice(0)) timer.fn();
    expect(f.world.sealed).toBe(false); expect(f.game.treasureRooms).toBe(1);
    const boss = f.world.bossRoom; boss.spawned = true; f.game.bossDefeated = true; f.game.markCleared(boss);
    f.game.victory(); expect(f.game.result.win).toBe(true);
    expect(f.game.result.mapTactics).toMatchObject({ used: use, affectedCount: use ? 1 : 0 });
    expect(Object.isFrozen(f.game.result.mapTactics)).toBe(true);
    counts.push({ rewards: f.rewards.length, rooms: f.game.roomsCleared, treasures: f.game.treasureRooms,
      fullClear: f.game.result.fullClear, stars: f.game.result.stars });
  }
  expect(counts[0]).toEqual(counts[1]);
  const loss = fixture(), op = operator(loss); enemy(loss, op); loss.tactics.interact(loss.game); loss.game.defeat();
  expect(loss.game.result.mapTactics).toMatchObject({ used: true, canceled: true, affectedCount: 0 });
  expect(loss.game.result.win).toBe(false); expect(loss.rewards).toHaveLength(0);
});
