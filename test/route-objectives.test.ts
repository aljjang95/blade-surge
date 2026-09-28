import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';
import { UI } from '../src/ui/ui.js';

const noop = () => {};
function fixture(stage: any = buildExpeditionStage('dungeon', 'bellfall_crypt', null)) {
  const world = buildExpeditionWorld(stage);
  const hints: string[] = [], circles: any[] = [], labels: string[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    enemies: [], pending: [], timers: [], projectiles: [], result: null, pauseReasons: new Set(),
    curRoom: world.startRoom, app: { eco: { s: {} } }, renderer: { desat: 0, shake: noop, flashScreen: noop },
    input: { enabled: true, clear: noop }, sp: { clear: noop },
    arena: { openSeal: noop }, openPortal: noop,
    ui: { toast: noop, waveBanner: noop, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop,
      setObjective() { hints.push(g.routeObjectives?.hint() || ''); } },
    fx: { castCircle: (p: any, color: number, opts: any) => circles.push({ p, color, ...opts }),
      damage: (_p: any, _n: number, opts: any) => labels.push(opts.text), groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { clear: noop, spawn: noop }, rollDrop: () => null,
    player: { alive: true, hp: 100, maxHp: 100, pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      forward: (v: Vector3) => v.set(1, 0, 0), play: noop, dispose: noop },
    // Enemy models/rendering are unnecessary here; room entry, queues, objective,
    // clear/reward, seal, result and AUTO/pathfinding methods are production code.
    roomRoster: () => ['guard', 'guard'],
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room);
      g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  g.routeObjectives = createRouteObjectives(stage, world);
  g.autoTarget = g.routeObjectives?.autoRoom() || null;
  g.player.game = g;
  return { g, world, route: g.routeObjectives!, hints, circles, labels };
}
function enter(f: ReturnType<typeof fixture>, id: number) {
  const room = f.world.rooms[id];
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  return room;
}
function clearCombat(f: ReturnType<typeof fixture>, id: number) {
  const room = enter(f, id);
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  return room;
}
function tickAt(f: ReturnType<typeof fixture>, id: number, dt: number) {
  const room = f.world.rooms[id]; f.g.player.pos.set(room.x, 0, room.z);
  f.g.updateExpedition(dt);
}
function attune(f: ReturnType<typeof fixture>, id: number) { clearCombat(f, id); tickAt(f, id, 2); }
const cell = (w: any, r: any) => Math.floor(r.z - w.minZ) * w.cols + Math.floor(r.x - w.minX);

test('three numbered authored bellfall rooms are accessible through the sealed floor mask', () => {
  const f = fixture();
  expect(f.world.layout).toBe(EXPEDITION_LAYOUTS.bellfall_crypt);
  expect(ROUTE_OBJECTIVES.bellfall_crypt.gates.map(g => g.roomId)).toEqual([2, 3, 5]);
  expect(f.world.rooms.filter(r => r.type === 'treasure')).toHaveLength(2);
  for (const id of [0, 2, 3, 5]) {
    const from = f.world.rooms[id], flow = f.world.buildFlow(from.x, from.z)!;
    for (const target of [2, 3, 5]) expect(flow[cell(f.world, f.world.rooms[target])]).toBeGreaterThanOrEqual(0);
    expect(flow[cell(f.world, f.world.bossRoom)]).toBe(-1);
  }
  expect(f.world.rooms[3].type).toBe('normal');
  expect(f.world.rooms[2].label).toContain('1번 종문');
  expect(f.world.rooms[3].label).toContain('2번 종문');
  expect(f.world.rooms[5].label).toContain('3번 종문');
});

test('only standard solo bellfall is selected; party, rift, deep, conquest and other routes keep legacy paths', () => {
  const base: any = buildExpeditionStage('dungeon', 'bellfall_crypt', null);
  const variants = [
    { ...base, party: {} }, { ...base, riftId: 'iron' },
    ...[{ depth: 'deep' }, { depth: undefined }, { conquestId: 'fake' }, { riftId: 'iron' },
      { kind: 'arena' }, { id: 'glass_garden' }, { id: '__proto__' }].map(change => ({ ...base, expedition: { ...base.expedition, ...change } })),
    { ...base, expedition: undefined },
  ];
  expect(routeObjectiveForStage(base)).toBe(ROUTE_OBJECTIVES.bellfall_crypt);
  for (const stage of variants) {
    expect(createRouteObjectives(stage, buildExpeditionWorld(base))).toBeNull();
  }
  const f = fixture({ ...base, party: {} });
  clearCombat(f, 2);
  expect(f.world.rooms[2].cleared).toBe(false);
  expect((f.world.rooms[2] as any).attunementPending).toBe(true);
  tickAt(f, 2, 2);
  expect((f.world.rooms[2] as any).attuned).toBe(true);
});

test('order is 2 → 3 → 5; out-of-order cleared rooms stay available without duplicate loot', () => {
  const f = fixture();
  clearCombat(f, 5); tickAt(f, 5, 10);
  clearCombat(f, 3); tickAt(f, 3, 10);
  expect(f.route.progress).toBe(0); expect(f.g.treasureRooms).toBe(0);
  expect(f.g.autoTarget.id).toBe(2);
  attune(f, 2); expect(f.route.progress).toBe(1); expect(f.g.treasureRooms).toBe(1);
  tickAt(f, 5, 4); expect(f.route.progress).toBe(1);
  tickAt(f, 3, 2); expect(f.route.progress).toBe(2);
  tickAt(f, 5, 2); expect(f.route.progress).toBe(3); expect(f.g.treasureRooms).toBe(2);
  expect([2, 3, 5].map(id => f.world.rooms[id].cleared)).toEqual([true, true, true]);
  for (const id of [2, 3, 5]) f.g.markCleared(f.world.rooms[id]);
  tickAt(f, 5, 5); expect(f.g.roomsCleared).toBe(3); expect(f.g.treasureRooms).toBe(2);
});

test('unspawned, living, queued and scheduled guards prevent attunement', () => {
  const f = fixture(), room = f.world.rooms[2];
  f.g.markCleared(room); tickAt(f, 2, 5); expect(f.route.hold).toBe(0);
  f.g.enterRoom(room);
  const timers = f.g.timers.splice(0);
  timers[0].fn(); f.g.enemies[0].alive = false;
  f.g.markCleared(room); tickAt(f, 2, 5); expect(f.route.progress).toBe(0);
  timers[1].fn(); f.g.markCleared(room); tickAt(f, 2, 5); expect(f.route.progress).toBe(0);
  f.g.enemies[1].alive = false; f.g.pending.push({ room });
  f.g.markCleared(room); tickAt(f, 2, 5); expect(f.route.progress).toBe(0);
  f.g.pending.length = 0; f.g.markCleared(room); tickAt(f, 2, 2);
  expect(f.route.progress).toBe(1);
});

test('two continuous seconds are required; leaving radius resets and overshoot never counts another gate', () => {
  const f = fixture(); clearCombat(f, 2);
  tickAt(f, 2, 1.9); expect(f.route.progress).toBe(0);
  f.g.player.pos.x += 3.01; f.g.updateExpedition(.01); expect(f.route.hold).toBe(0);
  tickAt(f, 2, 1.99); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.01); expect(f.route.progress).toBe(1);
  attune(f, 3); clearCombat(f, 5);
  tickAt(f, 3, 10); expect(f.route.progress).toBe(2);
  tickAt(f, 5, 2); expect(f.route.progress).toBe(3);
});

test('pause, inactive, dead and boss-defeated clocks cannot progress; stop closes retained state', () => {
  for (const boundary of ['pause', 'inactive', 'dead', 'boss']) {
    const f = fixture(); clearCombat(f, 2); tickAt(f, 2, 1.5);
    if (boundary === 'pause') f.g.setPaused('manual', true);
    if (boundary === 'inactive') f.g.active = false;
    if (boundary === 'dead') f.g.player.alive = false;
    if (boundary === 'boss') f.g.bossDefeated = true;
    f.g.updateExpedition(100); expect(f.route.progress).toBe(0); expect(f.route.hold).toBe(0);
  }
  const f = fixture(); clearCombat(f, 2); tickAt(f, 2, 1.5);
  f.g.setPaused('manual', true); f.g.update(30); f.g.setPaused('manual', false);
  tickAt(f, 2, .5); expect(f.route.progress).toBe(0);
  f.g.stop(); expect(f.g.routeObjectives).toBeNull(); expect(f.route.autoRoom()).toBeNull();
  f.route.update(f.g, 10); expect(f.route.progress).toBe(0);
  expect(f.route.finish(true).complete).toBe(false);
});

test('2/3 keeps the physical boss seal, and 3/3 also needs every other combat room', () => {
  const f = fixture(); attune(f, 2); attune(f, 3);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  attune(f, 5); f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  for (const id of [1, 4]) clearCombat(f, id);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  clearCombat(f, 6);
  expect(f.route.canUnseal()).toBe(true); expect(f.world.sealed).toBe(true);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(f.world.sealed).toBe(false);
  expect(f.world.buildFlow(f.world.bossRoom.x, f.world.bossRoom.z)![cell(f.world, f.world.startRoom)]).toBeGreaterThanOrEqual(0);
});

test('result cannot claim a missing objective or win; real completed boss win reports 3/3 and loss stays false', () => {
  const f = fixture(); attune(f, 2); attune(f, 3);
  f.g.victory(); expect(f.g.active).toBe(true); expect(f.g.result).toBeNull();
  const rejected = f.route.finish(true); expect(rejected.complete).toBe(false); expect(rejected.progress).toBe(2);
  expect(Object.isFrozen(rejected)).toBe(true);
  expect(f.route.finish(false)).toBe(rejected);
  const loss = fixture(); attune(loss, 2); loss.g.defeat();
  expect(loss.g.result.routeObjective).toMatchObject({ progress: 1, complete: false });
  const win = fixture(); for (const id of [2, 3, 5]) attune(win, id);
  win.g.victory(); expect(win.g.active).toBe(true);
  for (const id of [1, 4, 6]) clearCombat(win, id);
  for (const timer of win.g.timers.splice(0)) timer.fn();
  win.g.bossDefeated = true; win.g.markCleared(win.world.bossRoom); win.g.victory();
  expect(win.g.result.win).toBe(true);
  expect(win.g.result.routeObjective).toMatchObject({ complete: true, progress: 3, rooms: [2, 3, 5] });
});

test('Battle.start resets actual objective state on retry and excludes party before asset loading', async () => {
  const f = fixture(); attune(f, 2); tickAt(f, 3, 1);
  const old = f.route, stage = f.g.stage;
  // Stop at the asset/render boundary, after production start's world/route setup.
  f.g.arena.buildFloor = () => { throw Error('test-render-boundary'); };
  await expect(f.g.start(stage, 'knight', { level: 1 }, {})).rejects.toThrow('test-render-boundary');
  expect(f.g.routeObjectives).not.toBe(old); expect(f.g.world).not.toBe(f.world);
  expect(f.g.routeObjectives.progress).toBe(0); expect(f.g.routeObjectives.hold).toBe(0);
  expect(f.g.autoTarget.id).toBe(2); expect(f.g.result).toBeNull(); expect(old.autoRoom()).toBeNull();
  expect(f.g.world.rooms[2].cleared).toBe(false);
  await expect(f.g.start({ ...stage, party: {} }, 'knight', { level: 1 }, {})).rejects.toThrow('test-render-boundary');
  expect(f.g.routeObjectives).toBeNull(); expect(f.g.autoTarget).toBeNull();
});

test('production AUTO follows walkable flow around walls, returns to earlier gates, and completes all three', () => {
  const f = fixture();
  // Guards are dealt with by normal autoMove combat; pre-clear in reverse order
  // to isolate production autoExplore + actual collision from combat randomness.
  for (const id of [5, 3, 2]) clearCombat(f, id);
  f.g.player.pos.set(f.world.rooms[5].x, 0, f.world.rooms[5].z);
  const visited: number[] = [];
  let wallDetour = false, lastProgress = 0;
  for (let frame = 0; frame < 5000 && !f.route.complete; frame++) {
    f.g.updateExpedition(.05);
    if (f.route.progress > lastProgress) { visited.push([2, 3, 5][lastProgress]); lastProgress++; }
    if (f.route.complete) break;
    expect(f.g.autoTarget.id).toBe([2, 3, 5][f.route.progress]);
    const pos = f.g.player.pos, target = f.g.autoTarget;
    const dir = Player.prototype.autoExplore.call(f.g.player, .05);
    const directX = target.x - pos.x, directZ = target.z - pos.z;
    if (Math.abs(dir.x * directZ - dir.y * directX) > 8) wallDetour = true;
    const next = f.world.resolve(pos.x, pos.z, pos.x + dir.x * .3, pos.z + dir.y * .3, .55);
    expect(f.world.walkable(next[0], next[1])).toBe(true);
    pos.set(next[0], 0, next[1]);
  }
  expect(wallDetour).toBe(true); expect(visited).toEqual([2, 3, 5]); expect(f.route.complete).toBe(true);
});

test('real objective HUD and existing floor FX show numbered next target and partial hold', () => {
  const f = fixture(); clearCombat(f, 2); tickAt(f, 2, .5);
  expect(f.circles.some(c => c.radius === 3 && c.color === 0xffd060)).toBe(true);
  expect(f.labels).toContain('1번 종문 · 중심 2초');
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const appended: any[] = [];
  const el = { innerHTML: '', append: (node: any) => appended.push(node) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: () => el, createElement: () => ({ className: '', textContent: '' }),
  } });
  try {
    UI.prototype.setObjective.call({ app: { battle: f.g } } as any, f.world);
    expect(appended[0].className).toBe('conquest-hint');
    expect(appended[0].textContent).toContain('종문 0/3 · 다음 1번 종문 · 북쪽 예배실');
    expect(appended[0].textContent).toContain('0.5/2');
    tickAt(f, 2, 1.5); appended.length = 0;
    UI.prototype.setObjective.call({ app: { battle: f.g } } as any, f.world);
    expect(appended[0].textContent).toContain('종문 1/3 · 다음 2번 종문');
  } finally {
    if (before) Object.defineProperty(globalThis, 'document', before); else Reflect.deleteProperty(globalThis, 'document');
  }
});
