import { expect, spyOn, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { routeObjectiveForStage, ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { CometDeepOrbits } from '../src/game/comet-deep-orbits.js';
import { CometDeepOrbitView } from '../src/game/comet-deep-orbit-view.js';
import { CometOrbits, angleDiff } from '../src/game/comet-orbits.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';

const noop = () => {};
const RING_ROOMS = [1, 2, 3, 5, 7];
const DEF = ROUTE_OBJECTIVES.comet_deep;
const DT = 1 / 30;

interface Opts { depth?: string; reduced?: boolean }
/** 실제 buildExpeditionWorld·Battle 메서드(markCleared·enterRoom·updateExpedition)를 쓰고 렌더 액터만 대체한다. */
function fixture({ depth = 'deep', reduced = false }: Opts = {}) {
  const stage = buildExpeditionStage('dungeon', 'comet_bastion', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: number[] = [], drops: any[] = [], strikes: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, result: null, pauseReasons: new Set(),
    input: { enabled: true, clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: reduced } }, scene: new Scene(), sp: { clear: noop },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop, hurtVignette: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop, buildFloor: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, burst: noop, embers: noop,
      castCircle: (_p: any, _c: any, o: any) => { if (o?.radius === DEF.storm.radius) strikes.push(1); } },
    drops: { spawn: (...args: any[]) => drops.push(args), clear: noop }, rollDrop: () => ({ id: 'test-drop' }),
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number) => { hurts.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as CometDeepOrbits;
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, hurts, drops, strikes, stage };
}
type F = ReturnType<typeof fixture>;
const gateOf = (f: F, id: number): any => f.route.gates.find((x: any) => x.room.id === id)!;
const rewardItems = (f: F) => f.drops.filter(d => d[1] === 'item').length;

/** 방에 들어가 적을 처치하고 Battle.markCleared 를 호출한다(증원·정화는 Battle 규칙 그대로). */
function killAll(f: F, room: any) { for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false; }
function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id];
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  killAll(f, room);
  f.g.markCleared(room);
  return room;
}
const hero = (f: F) => f.g.player.pos as Vector3;
const onTrack = (g: any, a: number, r: number) => new Vector3(g.room.x + Math.sin(a) * r, 0, g.room.z + Math.cos(a) * r);
const place = (f: F, v: Vector3) => hero(f).copy(v);
/** 시작 방에서 방 중심으로 5 u/s 직선(흐름장)으로 걸어 처음 방 사각형에 들어서는 지점. */
function doorEntry(world: any, room: any, from: any) {
  const flow = world.buildFlow(room.x, room.z);
  let x = from.x, z = from.z;
  for (let t = 0; t < 120; t += DT) {
    if (world.roomAt(x, z) === room) return new Vector3(x, 0, z);
    const d = world.flowDir(flow, x, z) || [room.x - x, room.z - z], l = Math.hypot(d[0], d[1]) || 1;
    x += d[0] / l * 5 * DT; z += d[1] / l * 5 * DT;
  }
  throw new Error('door entry not found');
}
/** 실제 autoPoint 를 향해 speed u/s 로 걷는 AUTO 모델(영웅 속도 5.6~7.2 보다 느린 보수 가정). 고리가 connected 가 되면 끝난다. */
function autoWalk(f: F, g: any, seconds: number, speed = 5, dt = DT) {
  const p = hero(f);
  for (let t = 0; t < seconds; t += dt) {
    if (g.phase === 'connected') return t;
    const cur = f.route.current;
    const pt = cur ? f.route.autoPoint(cur.room) : null;
    if (pt) { const dx = pt.x - p.x, dz = pt.z - p.z, l = Math.hypot(dx, dz); if (l > .65) { const s = Math.min(l, speed * dt); p.x += dx / l * s; p.z += dz / l * s; } }
    f.route.update(f.g, dt);
  }
  return seconds;
}
/** 방을 정화해 ready 로 만든 뒤 AUTO 모델로 연결까지 진행한다. */
function connectRing(f: F, id: number, speed = 5) {
  const g = gateOf(f, id);
  clearRoom(f, id);
  place(f, doorEntry(f.world, g.room, f.world.startRoom));
  const used = autoWalk(f, g, 60, speed);
  expect(g.phase).toBe('connected');
  return used;
}
/** 고리를 폭풍 직전(연결 직후, 영웅은 중심)으로 만든다. 룬석은 실제 밀기로 맞춘다. */
function toStorm(f: F, id: number) {
  const g = gateOf(f, id);
  clearRoom(f, id);
  place(f, doorEntry(f.world, g.room, f.world.startRoom));
  for (let t = 0; t < 30 && g.phase !== 'storm'; t += DT) {
    const pt = f.route.autoPoint(g.room);
    const p = hero(f);
    if (pt) { const dx = pt.x - p.x, dz = pt.z - p.z, l = Math.hypot(dx, dz); if (l > .65) { const s = Math.min(l, 5 * DT); p.x += dx / l * s; p.z += dz / l * s; } }
    f.route.update(f.g, DT);
  }
  expect(g.phase).toBe('storm');
  return g;
}
/** 폭풍을 stormIndex 가 index 가 될 때까지(그 회차 충돌 직후) 진행한다. */
function runStormUntil(f: F, g: any, index: number, dt = DT) {
  for (let i = 0; i < 600 && g.stormIndex < index; i++) f.route.update(f.g, dt);
  expect(g.stormIndex).toBe(index);
}

test('1. deep 은 CometDeepOrbits(1·2·3·5·7), 일반판은 CometOrbits(1·3·5·7), 파티·균열·정복·결투는 null', () => {
  const f = fixture();
  expect(f.route).toBeInstanceOf(CometDeepOrbits);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual(RING_ROOMS);
  expect(f.route.gates.map((g: any) => g.index)).toEqual([0, 1, 2, 3, 4]);
  for (const g of f.route.gates as any[]) {
    expect(g.phase).toBe('locked'); expect(g.room.objectiveProp).toBe('comet-orbit'); expect(g.room.label).toBe(g.label);
    expect(g.stone.distanceTo(onTrack(g, g.start, DEF.track))).toBeLessThan(1e-9);
  }
  const standard = fixture({ depth: 'standard' });
  expect(standard.route).toBeInstanceOf(CometOrbits);
  expect(standard.route).not.toBeInstanceOf(CometDeepOrbits);
  expect((standard.route as any).gates.map((g: any) => g.room.id)).toEqual([1, 3, 5, 7]);
  const base = f.g.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' }, { ...base, expedition: { ...base.expedition, conquestId: 'x' } },
    { ...base, expedition: { ...base.expedition, kind: 'arena' } }]) {
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
  // 다른 심층 원정의 라우트 목표는 그대로다.
  const nightglass = buildExpeditionStage('dungeon', 'nightglass_observatory', null, { depth: 'deep' });
  expect(routeObjectiveForStage(nightglass)?.id).toBe('nightglass_records_deep');
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth: 'deep' }))).toBeNull();
  // 고리 방이 시작·보스방이면 생성에 실패한다.
  for (const roomId of [0, 8]) {
    expect(() => new CometDeepOrbits({ ...DEF, gates: [{ ...DEF.gates[0], roomId }] }, f.world)).toThrow(RangeError);
  }
});

test('2. 보물방 2·7 공명은 고리로 교체되고, 정예방 4·6 증원은 각 2회 뒤에만 정화된다', () => {
  const f = fixture();
  expect(f.route.coexistsAttunement).toBe(false);
  expect(f.stage.expedition.mechanics.attunement).toBe(true);   // 데이터는 그대로, 컨트롤러가 명시적으로 교체한다
  for (const id of [2, 7]) {
    const room: any = clearRoom(f, id);
    expect(f.route.allowsAttunement(room)).toBe(false);
    expect(room.attunementPending).toBeFalsy(); expect(room.cleared).toBe(false);
    expect(gateOf(f, id).phase).toBe('ready');
    // 중심에서 오래 기다려도 공명으로 정화되지 않는다(실제 updateExpedition 경로).
    place(f, new Vector3(room.x, 0, room.z));
    for (let i = 0; i < 20; i++) f.g.updateExpedition(.5);
    expect(room.attuned).toBeFalsy(); expect(room.cleared).toBe(false); expect(f.g.treasureRooms).toBe(0);
    f.g.markCleared(room);   // 다시 호출해도 beforeClear 가 정화를 막는다
    expect(room.cleared).toBe(false);
  }
  expect(f.messages.some(m => /공명|제단/.test(m))).toBe(false);
  // 정예방은 고리가 아니라 기존 증원 2회 경로를 그대로 탄다.
  for (const id of [4, 6]) {
    const room: any = clearRoom(f, id);
    expect(f.route.combatPending(f.g, room)).toBe(false);
    expect(f.route.ownsHazards(room)).toBe(false);
    expect(room.forgeWave).toBe(1); expect(room.cleared).toBe(false);
    killAll(f, room); f.g.markCleared(room);
    expect(room.forgeWave).toBe(2); expect(room.cleared).toBe(false);
    killAll(f, room); f.g.markCleared(room);
    expect(room.forgeWave).toBe(2); expect(room.cleared).toBe(true);
  }
});

test('3. ready 는 방치해도 시계가 0이고, 적이 남았거나 띠 밖이면 밀리지 않으며, 첫 실제 밀기에서만 9초가 시작된다', () => {
  const f = fixture(), g = gateOf(f, 1), room = g.room;
  f.g.enterRoom(room); for (const timer of f.g.timers.splice(0)) timer.fn();
  // 적이 남아 있는 동안은 룬석 바로 뒤에 서 있어도 locked 이며 움직이지 않는다.
  place(f, onTrack(g, g.start - .1, DEF.track));
  for (let i = 0; i < 30; i++) f.route.update(f.g, DT);
  expect(g.phase).toBe('locked'); expect(g.angle).toBe(g.start); expect(g.clock).toBe(0);
  place(f, g.center);   // 접촉하지 않는 자리에서 적을 모두 처치한다
  killAll(f, room);
  f.route.update(f.g, DT);   // markCleared 없이 update 만으로도 locked → ready 로 올라간다
  expect(g.phase).toBe('ready');
  // 궤도 띠 밖(안쪽 band 밖·바깥 band 밖)은 60초 서 있어도 밀리지 않는다.
  for (const r of [DEF.track - DEF.band - .5, DEF.track + DEF.band + .5]) {
    place(f, onTrack(g, g.start - .1, r));
    for (let i = 0; i < 60 * 30; i++) f.route.update(f.g, DT);
    expect(g.phase).toBe('ready'); expect(g.clock).toBe(0); expect(g.angle).toBe(g.start); expect(g.failures).toBe(0);
  }
  // 첫 실제 밀기에서 붕괴 시작: 시계는 9초에서 한 하위 단계만 줄어 있다.
  place(f, onTrack(g, g.start - .1, DEF.track));
  f.route.update(f.g, DT);
  expect(g.phase).toBe('collapse'); expect(angleDiff(g.angle, g.start)).toBeGreaterThan(0);
  expect(g.clock).toBeCloseTo(DEF.collapseSeconds - DT, 6);
  f.route.update(f.g, 1);
  expect(g.clock).toBeCloseTo(DEF.collapseSeconds - DT - 1, 6);
  // 붕괴 중 다시 밀어 각이 바뀌어도 시계는 9초로 되돌아가지 않는다.
  const before = g.angle;
  place(f, onTrack(g, g.angle - .1, DEF.track)); f.route.update(f.g, DT);
  expect(angleDiff(g.angle, before)).toBeGreaterThan(0);
  expect(g.clock).toBeCloseTo(DEF.collapseSeconds - 2 * DT - 1, 6);
  expect(f.messages.filter(m => /궤도 붕괴 시작/.test(m))).toHaveLength(1);
});

test('4. 시간 초과는 그 고리만 처음 위치로 돌리고 실패를 세며, 방 정화·보상·피해는 없고 다른 고리는 유지된다', () => {
  const f = fixture();
  connectRing(f, 3);
  const done = gateOf(f, 3), doneRoom = done.room;
  expect(done.phase).toBe('connected'); expect(doneRoom.cleared).toBe(true);
  const items = rewardItems(f), cleared = f.g.roomsCleared;
  // 2번 고리를 한 번 밀고 가만히 있으면 9초 뒤 실패한다.
  const g = gateOf(f, 2), room = g.room;
  clearRoom(f, 2);
  place(f, onTrack(g, g.start - .1, DEF.track));
  f.route.update(f.g, DT);
  expect(g.phase).toBe('collapse');
  place(f, new Vector3(room.x + 9, 0, room.z + 9));
  for (let t = 0; t < DEF.collapseSeconds - .2; t += DT) f.route.update(f.g, DT);
  expect(g.phase).toBe('collapse'); expect(g.failures).toBe(0);
  for (let t = 0; t < .5; t += DT) f.route.update(f.g, DT);
  expect(g.phase).toBe('ready'); expect(g.failures).toBe(1); expect(f.route.collapseFailures).toBe(1);
  expect(g.angle).toBe(g.start); expect(g.clock).toBe(0); expect(g.lockT).toBe(0); expect(g.connectT).toBe(0);
  expect(g.stone.distanceTo(onTrack(g, g.start, DEF.track))).toBeLessThan(1e-9);
  expect(room.cleared).toBe(false); expect(f.g.treasureRooms).toBe(0); expect(rewardItems(f)).toBe(items);
  expect(f.g.roomsCleared).toBe(cleared); expect(f.hurts).toHaveLength(0);
  expect(f.messages.filter(m => /붕괴 · 룬석이 처음 위치로 돌아갔습니다/.test(m))).toHaveLength(1);
  // 다른 연결 고리와 그 방의 정화는 그대로다.
  expect(done.phase).toBe('connected'); expect(doneRoom.cleared).toBe(true); expect(f.route.progress).toBe(1);
  // 실패 뒤에도 다시 밀 수 있고, 연결되면 보물방 보상은 정확히 한 번이다.
  place(f, doorEntry(f.world, room, f.world.startRoom));
  autoWalk(f, g, 60);
  expect(g.phase).toBe('connected'); expect(room.cleared).toBe(true);
  expect(f.g.treasureRooms).toBe(1); expect(f.route.progress).toBe(2); expect(g.failures).toBe(1);
});

test('5. 동률: 마지막 하위 단계에서 완성한 연결은 유효하고, 한 단계 늦거나 정렬이 마지막 단계면 실패한다', () => {
  const setup = () => {
    const f = fixture(), g = gateOf(f, 1);
    clearRoom(f, 1);
    place(f, onTrack(g, g.start - .1, DEF.track));
    f.route.update(f.g, DT);   // 첫 밀기: collapse
    place(f, g.center);
    Object.assign(g, { phase: 'shelter', angle: g.target, lockT: 0 });
    return { f, g };
  };
  {
    const { f, g } = setup();
    Object.assign(g, { clock: DT, connectT: DEF.connectSeconds - DT + 1e-6 });
    f.route.update(f.g, DT);
    expect(g.phase).toBe('storm'); expect(g.failures).toBe(0); expect(g.slack).toBeCloseTo(DT, 9); expect(g.clock).toBe(0);
  }
  {
    const { f, g } = setup();
    Object.assign(g, { clock: DT, connectT: DEF.connectSeconds - 2 * DT + 1e-6 });
    f.route.update(f.g, DT);
    expect(g.phase).toBe('ready'); expect(g.failures).toBe(1); expect(g.angle).toBe(g.start);
  }
  {
    // 쉼터 단계에서는 룬석이 목표에 고정되어 밀어도 움직이지 않는다.
    const { f, g } = setup();
    place(f, onTrack(g, g.target - .1, DEF.track));
    for (let i = 0; i < 10; i++) f.route.update(f.g, DT);
    expect(g.angle).toBe(g.target); expect(g.phase).toBe('shelter'); expect(g.connectT).toBe(0);
  }
  {
    // 정렬이 마지막 하위 단계에 끝나도 같은 단계의 시계 만료를 막지 않는다.
    const { f, g } = setup();
    Object.assign(g, { phase: 'collapse', angle: g.target + .01, clock: DT, lockT: DEF.lockSeconds - DT + 1e-6 });
    place(f, new Vector3(g.room.x + 9, 0, g.room.z + 9));
    f.route.update(f.g, DT);
    expect(g.phase).toBe('ready'); expect(g.failures).toBe(1);
  }
});

test('6. 일시정지·비활성·사망·월드 불일치 동안 시계가 멈추고, setPaused 와 실제 Player.hurt 는 쉼터 유지를 0으로 만든다', () => {
  const causes: Record<string, (f: F, on: boolean) => void> = {
    paused: (f, on) => { f.g.paused = on; },
    inactive: (f, on) => { f.g.active = !on; },
    dead: (f, on) => { f.g.player.alive = !on; },
    world: (f, on) => { f.g.world = on ? {} : f.world; },
    boss: (f, on) => { f.g.bossDefeated = on; },
  };
  for (const [name, set] of Object.entries(causes)) {
    const f = fixture(), g = gateOf(f, 1);
    clearRoom(f, 1);
    place(f, onTrack(g, g.start - .1, DEF.track));
    f.route.update(f.g, DT);
    const clock = g.clock;
    set(f, true);
    f.route.update(f.g, 5);
    expect([name, g.clock, g.phase]).toEqual([name, clock, 'collapse']);
    set(f, false);
    f.route.update(f.g, 1);
    expect(g.clock).toBeLessThan(clock - .9);
  }
  // 일시정지 중에도 stop 뒤에도 시계는 움직이지 않는다.
  {
    const f = fixture(), g = gateOf(f, 1);
    clearRoom(f, 1); place(f, onTrack(g, g.start - .1, DEF.track)); f.route.update(f.g, DT);
    const clock = g.clock; f.route.stop(); f.route.update(f.g, 3);
    expect(g.clock).toBe(clock);
  }
  // 쉼터 유지 중 setPaused(실제 Battle 메서드)와 실제 Player.hurt 가 connectT 를 0으로 만든다.
  const shelter = () => {
    const f = fixture(), g = gateOf(f, 1);
    clearRoom(f, 1); place(f, onTrack(g, g.start - .1, DEF.track)); f.route.update(f.g, DT);
    Object.assign(g, { phase: 'shelter', angle: g.target }); place(f, g.center);
    f.route.update(f.g, .25);
    expect(g.connectT).toBeCloseTo(.25, 6);
    return { f, g };
  };
  {
    const { f, g } = shelter();
    f.g.setPaused('menu', true);
    expect(g.connectT).toBe(0);
    f.g.setPaused('menu', false);
  }
  for (const guard of ['none', 'invulnerable']) {
    const { f, g } = shelter(), p = f.g.player;
    p.hurt = Player.prototype.hurt;   // 실제 피격 경로(성공한 피해에서만 목표를 끊는다)
    Object.assign(p, { def: { id: 'knight' }, stats: { def: 0 }, invuln: guard === 'invulnerable' ? 1 : 0, flash: noop, knockback: noop, stopTrail: noop });
    const hit = p.hurt(10, { kb: 0 });
    expect(hit).toBe(guard === 'none');
    if (guard === 'none') expect(g.connectT).toBe(0);
    else expect(g.connectT).toBeCloseTo(.25, 6);   // 피해가 들어가지 않으면 유지 시간도 끊기지 않는다
  }
});

test('7. 같은 시나리오를 dt 1/60, 1/30, 1/7, 0.5 로 돌려도 phase 순서·충돌·피격·실패 수가 같다', () => {
  const gap = DEF.contact / DEF.track;
  // 영웅 위치는 정수 초에서만 바뀐다(스크립트는 시뮬레이션 시간만 읽는다).
  const run = (dt: number, scenario: 'success' | 'fail') => {
    const f = fixture(), g = gateOf(f, 1);
    clearRoom(f, 1);
    const total = scenario === 'success' ? 30 : 25;
    const n = Math.round(total / dt), sizes = .9 * gap;
    const steps = Math.ceil((angleDiff(g.target, g.start) - .02) / sizes);
    const stoneAfter = (k: number) => k >= steps ? g.target + .02 : g.start + k * sizes;
    let sec = -1;
    for (let i = 0; i < n; i++) {
      const second = Math.floor(i * dt + 1e-6);
      if (second !== sec) {
        sec = second;
        if (scenario === 'success') {
          const k = second + 1;
          if (k <= steps) place(f, onTrack(g, stoneAfter(k) - gap, DEF.track));   // k번째 밀기 뒤 룬석이 stoneAfter(k)에 놓인다
          else place(f, g.center);
        } else if (second === 0) place(f, onTrack(g, g.start - .1, DEF.track));
        else if (second === 10) place(f, new Vector3(g.room.x + 9, 0, g.room.z + 9));
      }
      f.route.update(f.g, dt);
    }
    const order = f.messages.filter(m => /붕괴 시작|정렬|연결|피격|붕괴 ·/.test(m)).map(m => m.replace(/^.*?· /, ''));
    return { phase: g.phase, order, strikes: f.strikes.length, hits: g.hits, hurts: f.hurts.length, failures: g.failures, slack: g.slack, stormIndex: g.stormIndex };
  };
  const results = [1 / 60, 1 / 30, 1 / 7, .5].map(dt => run(dt, 'success'));
  for (const r of results) {
    const { slack: _s, ...rest } = r as any; const { slack: _b, ...base } = results[0] as any;
    expect(rest).toEqual(base);
  }
  expect(results[0].phase).toBe('connected'); expect(results[0].strikes).toBe(3);
  expect(results[0].hits).toBe(2);   // 영웅이 중심에만 서 있으면 첫 빈 원(중심)만 피한다
  expect(results[0].failures).toBe(0);
  for (const r of results) expect(Math.abs(r.slack - results[0].slack)).toBeLessThan(.06);
  const fails = [1 / 60, 1 / 30, 1 / 7, .5].map(dt => run(dt, 'fail'));
  for (const r of fails) {
    const { slack: _s, ...rest } = r as any; const { slack: _b, ...base } = fails[0] as any;
    expect(rest).toEqual(base);
  }
  expect(fails[0].failures).toBe(2); expect(fails[0].strikes).toBe(0);
});

test('8. 폭풍 판정: 빈 원 안·반경 12 밖은 무피해, 그 사이는 회차당 1번 피해, 방 이탈은 진행을 멈추고 복귀하면 그 회차를 다시 한다', () => {
  const strikeWith = (relative: (g: any) => Vector3, expected: number) => {
    const f = fixture(), g = toStorm(f, 1);
    expect(g.stormWarn).toBe(true); expect(g.stormIndex).toBe(0);
    place(f, relative(g));
    runStormUntil(f, g, 1);
    expect([f.hurts.length, g.hits, f.route.stormHits]).toEqual([expected, expected, expected]);
    if (expected) expect(f.hurts[0]).toBeCloseTo(8);   // 최대 체력 100 의 8%
    return { f, g };
  };
  const rel = (g: any, dx: number, dz: number) => new Vector3(g.center.x + dx, 0, g.center.z + dz);
  strikeWith(g => g.stormShelter.clone(), 0);                                        // 빈 원 한가운데
  strikeWith(g => rel(g, DEF.shelterRadius - .05, 0), 0);                             // 빈 원 가장자리 안쪽
  strikeWith(g => rel(g, DEF.shelterRadius + .05, 0), 1);                             // 가장자리 바로 밖
  strikeWith(g => rel(g, 6, 0), 1);                                                   // 사이
  strikeWith(g => rel(g, g.room.w / 2 - .5, g.room.h / 2 - .5), 0);                   // 방 모서리: 반경 12 밖
  // 한 회차는 피해를 한 번만 준다.
  { const { f, g } = strikeWith(g => rel(g, 6, 0), 1); for (let i = 0; i < 20; i++) f.route.update(f.g, DT); expect(g.stormIndex).toBe(1); expect(f.hurts).toHaveLength(1); }

  // 방 이탈: 예고가 꺼지고 시계가 서며, 이미 맞은 회차는 유지되고 복귀하면 그 회차의 처음부터 다시 한다.
  const f = fixture(), g = toStorm(f, 1);
  place(f, g.stormShelter.clone()); for (let i = 0; i < 20; i++) f.route.update(f.g, DT);
  expect(g.stormWarn).toBe(true); expect(g.stormWarnT).toBeLessThan(DEF.storm.warning);
  place(f, new Vector3(f.world.startRoom.x, 0, f.world.startRoom.z));
  f.route.update(f.g, DT);
  expect(g.present).toBe(false); expect(g.stormWarn).toBe(false); expect(g.stormT).toBe(0);
  for (let i = 0; i < 5 * 30; i++) f.route.update(f.g, DT);
  expect([g.stormIndex, g.stormWarn, g.stormT, g.phase]).toEqual([0, false, 0, 'storm']);
  place(f, g.center); f.route.update(f.g, DT);
  expect(g.stormWarn).toBe(true); expect(g.stormWarnT).toBeGreaterThan(DEF.storm.warning - 2 * DT);
  runStormUntil(f, g, 1);
  place(f, new Vector3(f.world.startRoom.x, 0, f.world.startRoom.z));
  for (let i = 0; i < 30; i++) f.route.update(f.g, DT);
  expect(g.stormIndex).toBe(1); expect(g.stormWarn).toBe(false);
  place(f, g.center); f.route.update(f.g, DT);
  expect(g.stormWarn).toBe(false);   // 둘째 회차는 빈 간격(gap)부터 다시 시작한다
  for (let t = 0; t < DEF.storm.gap + .1; t += DT) f.route.update(f.g, DT);
  expect(g.stormWarn).toBe(true);
});

test('8b. 쉼터 세 곳은 한 변 4.0의 정삼각형이고, 가장자리에서 출발해도 반응 0.3초 뒤 5 u/s 로 다음 빈 원에 닿는다', () => {
  const f = fixture();
  for (const g of f.route.gates as any[]) {
    const [c, s, o] = g.shelters as Vector3[];
    expect(c.distanceTo(g.center)).toBeLessThan(1e-9);
    for (const [a, b] of [[c, s], [s, o], [o, c]]) expect(a.distanceTo(b)).toBeCloseTo(DEF.track, 9);
    // 현재 빈 원의 반대편 가장자리에서 다음 빈 원 안까지 이동 거리는 중심 간 거리와 같다.
    for (const [a, b] of [[c, s], [s, o], [o, c], [s, c], [o, s], [c, o]]) expect(a.distanceTo(b) / 5 + .3).toBeLessThan(DEF.storm.warning);
  }
  // 실제 폭풍에서 검사: 매 회차 이전 빈 원의 다음 쉼터 반대편 가장자리에 서 있다가, 예고를 보고 0.3초 뒤 5 u/s 로 이동한다.
  for (const id of RING_ROOMS) {
    const f2 = fixture(), g = toStorm(f2, id);
    const p = hero(f2);
    let reactT = 0, lastIndex = -1;
    for (let i = 0; i < 20 * 30 && g.phase === 'storm'; i++) {
      if (g.stormWarn && g.stormIndex !== lastIndex) {
        // 예고가 막 켜진 시점: 이전 빈 원에서 새 빈 원의 반대쪽 가장자리로 순간 배치(최악 위치).
        lastIndex = g.stormIndex; reactT = 0;
        const next: Vector3 = g.stormShelter, prev: Vector3 = g.shelters[(g.stormIndex + 2) % 3];
        const dx = prev.x - next.x, dz = prev.z - next.z, l = Math.hypot(dx, dz);
        p.set(prev.x + dx / l * DEF.shelterRadius * .99, 0, prev.z + dz / l * DEF.shelterRadius * .99);
      }
      if (g.stormWarn) {
        reactT += DT;
        if (reactT > .3) {
          const dx = g.stormShelter.x - p.x, dz = g.stormShelter.z - p.z, l = Math.hypot(dx, dz);
          if (l > .05) { const s = Math.min(l, 5 * DT); p.x += dx / l * s; p.z += dz / l * s; }
        }
      }
      f2.route.update(f2.g, DT);
    }
    expect(g.phase).toBe('connected'); expect(f2.hurts).toHaveLength(0); expect(f2.route.stormHits).toBe(0);
  }
});

test('9. 방 보상은 연결 때 고리당 정확히 1번이고, 5/5 + 모든 방 정화 전에는 봉인이 풀리지 않는다', () => {
  const f = fixture();
  expect(f.route.canUnseal()).toBe(false);
  const itemsBefore = rewardItems(f);
  let treasure = 0;
  for (const id of RING_ROOMS) {
    const g = gateOf(f, id), room = g.room;
    clearRoom(f, id);
    // 정화 직후·붕괴 중·쉼터·폭풍 동안에는 방도 보상도 없다.
    expect(room.cleared).toBe(false); expect(f.g.treasureRooms).toBe(treasure);
    place(f, doorEntry(f.world, room, f.world.startRoom));
    for (let t = 0; t < 60 && g.phase !== 'storm'; t += DT) {
      autoWalkStep(f);
      expect(room.cleared).toBe(false);
    }
    expect(g.phase).toBe('storm'); expect(room.cleared).toBe(false);
    autoWalk(f, g, 30);
    expect(g.phase).toBe('connected'); expect(room.cleared).toBe(true);
    if (room.type === 'treasure') treasure++;
    expect(f.g.treasureRooms).toBe(treasure);
    // 이후 update·markCleared 를 더 불러도 보상은 늘지 않는다.
    const items = rewardItems(f), count = f.g.roomsCleared;
    f.g.markCleared(room); for (let i = 0; i < 60; i++) f.route.update(f.g, DT);
    expect([rewardItems(f), f.g.roomsCleared]).toEqual([items, count]);
  }
  expect(treasure).toBe(2); expect(f.g.treasureRooms).toBe(2);
  expect(f.route.progress).toBe(5); expect(f.route.complete).toBe(true);
  expect(rewardItems(f)).toBeGreaterThan(itemsBefore);
  // 5/5 라도 정예방이 남아 있으면 봉인은 유지된다.
  expect(f.route.canUnseal()).toBe(false); expect(f.world.sealed).toBe(true);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  for (const id of [4, 6]) { const room = clearRoom(f, id); killAll(f, room); f.g.markCleared(room); killAll(f, room); f.g.markCleared(room); expect(room.cleared).toBe(true); }
  expect(f.route.canUnseal()).toBe(true);
  for (const t of f.g.timers.splice(0)) t.fn();   // 마지막 정화가 예약한 봉인 해제
  expect(f.world.sealed).toBe(false);
  expect(f.route.canWin()).toBe(false);           // 보스방이 정화되기 전에는 승리할 수 없다
  f.world.bossRoom.cleared = true;
  expect(f.route.canWin()).toBe(true);
  expect(f.messages.some(m => /궤도 고리 5개 연결 · 혜성 요새의 봉인이 흔들립니다/.test(m))).toBe(true);
  // 반대로 고리 4개만 연결하면 모든 방이 정화돼도 봉인되어 있다.
  const g4 = fixture();
  for (const id of RING_ROOMS.slice(0, 4)) connectRing(g4, id);
  for (const id of [4, 6]) { const room = clearRoom(g4, id); killAll(g4, room); g4.g.markCleared(room); killAll(g4, room); g4.g.markCleared(room); }
  expect(g4.route.progress).toBe(4); expect(g4.route.canUnseal()).toBe(false);
});
function autoWalkStep(f: F) {
  const p = hero(f), cur = f.route.current, pt = cur ? f.route.autoPoint(cur.room) : null;
  if (pt) { const dx = pt.x - p.x, dz = pt.z - p.z, l = Math.hypot(dx, dz); if (l > .65) { const s = Math.min(l, 5 * DT); p.x += dx / l * s; p.z += dz / l * s; } }
  f.route.update(f.g, DT);
}

test('10. finish: 패배는 완료가 아니고, 결과는 처음 만든 동결 객체이며 필드가 실제 진행을 반영한다', () => {
  const f = fixture();
  connectRing(f, 1);
  const g2 = gateOf(f, 2); clearRoom(f, 2); place(f, onTrack(g2, g2.start - .1, DEF.track)); f.route.update(f.g, DT);
  place(f, new Vector3(g2.room.x + 9, 0, g2.room.z + 9));
  for (let t = 0; t < 10; t += DT) f.route.update(f.g, DT);
  expect(f.route.collapseFailures).toBe(1);
  const report = f.route.finish(false);
  expect(report).toEqual({ id: 'comet_deep_orbits', label: '궤도 고리 연결', complete: false, progress: 1, target: 5, rooms: [1], collapseFailures: 1, stormHits: 0 });
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  expect(f.route.finish(true)).toBe(report);   // 나중에 이겼다고 해도 처음 결과를 동결해 돌려준다
  expect(f.route.finish(false)).toBe(report);
  expect(f.route.closed).toBe(true);
  // 모든 조건을 갖춘 승리만 완료다. 같은 진행이라도 stop 된 컨트롤러는 완료로 바뀌지 않는다.
  const win = fixture();
  for (const id of RING_ROOMS) connectRing(win, id);
  for (const id of [4, 6]) { const room = clearRoom(win, id); killAll(win, room); win.g.markCleared(room); killAll(win, room); win.g.markCleared(room); }
  for (const t of win.g.timers.splice(0)) t.fn();
  win.world.bossRoom.cleared = true;
  expect(win.route.finish(true)).toMatchObject({ complete: true, progress: 5, target: 5, rooms: RING_ROOMS });
  const stopped = fixture();
  for (const id of RING_ROOMS) connectRing(stopped, id);
  stopped.route.stop();
  for (const room of stopped.world.rooms) room.cleared = true; stopped.world.sealed = false;
  expect(stopped.route.finish(true).complete).toBe(false);
  expect(fixture().route.finish(true).complete).toBe(false);
});

test('11. AUTO(문 입구에서 5 u/s, 실제 autoPoint): 5고리 모두 연결, 고리별 slack ≥ 4초, 폭풍 피격 0', () => {
  for (const speed of [5, 2.8]) {
    const f = fixture(), slacks: Record<string, number> = {}, used: Record<string, number> = {};
    for (const id of RING_ROOMS) {
      const g = gateOf(f, id);
      used[id] = +connectRing(f, id, speed).toFixed(2);
      slacks[id] = +g.slack.toFixed(2);
      expect(g.failures).toBe(0); expect(g.hits).toBe(0);
      if (speed === 5) expect(g.slack).toBeGreaterThanOrEqual(4);
      else expect(g.slack).toBeGreaterThan(0);
    }
    console.log('[AUTO ' + speed + ' u/s] 고리별 slack(초):', JSON.stringify(slacks), '연결까지(초):', JSON.stringify(used));
    expect(f.route.progress).toBe(5); expect(f.route.stormHits).toBe(0); expect(f.hurts).toHaveLength(0); expect(f.route.collapseFailures).toBe(0);
  }
});

test('12. stop 뒤 closed·뷰 dispose 1회, stop 뒤에 끝난 prepareView 는 뷰를 만들지 않고, 종료 사유 첫 프레임에 예고를 거두고 뷰를 한 번 갱신한다', async () => {
  const dispose = spyOn(CometDeepOrbitView.prototype, 'dispose');
  try {
    const f = fixture(), scene = new Scene();
    await f.route.prepareView(scene);
    expect(f.route.view).toBeInstanceOf(CometDeepOrbitView);
    f.route.stop();
    expect(f.route.closed).toBe(true); expect(f.route.view).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
    f.route.stop(); expect(dispose).toHaveBeenCalledTimes(1);
    f.route.update(f.g, 1);   // 닫힌 뒤 update 는 아무 일도 하지 않는다
    const late = fixture(), pending = late.route.prepareView(scene);
    late.route.stop();
    await pending;
    expect(late.route.view).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
  } finally { dispose.mockRestore(); }

  // 사망(정지 외 종료 사유)의 첫 프레임: 예고를 거두고 뷰를 dt 0 으로 한 번만 갱신한다.
  const f = fixture({ reduced: true }), g = toStorm(f, 1);
  const updates: any[][] = [];
  f.route.view = { update: (...args: any[]) => updates.push(args), dispose: noop } as any;
  f.route.update(f.g, DT); f.route.update(f.g, DT);
  expect(updates).toHaveLength(2); expect(updates[0][2]).toBe(updates[1][2]); expect(updates[0][2]).toEqual({ reduced: true });
  expect(g.stormWarn).toBe(true);
  updates.length = 0;
  f.g.player.alive = false;
  f.route.update(f.g, DT);
  expect(g.stormWarn).toBe(false); expect(updates).toHaveLength(1); expect(updates[0][0]).toBe(f.route); expect(updates[0][1]).toBe(0);
  f.route.update(f.g, DT); f.route.update(f.g, DT);
  expect(updates).toHaveLength(1);
  // 일시정지는 마지막 화면을 유지한다(예고를 거두지 않는다).
  const p = fixture(), pg = toStorm(p, 1), seen: any[][] = [];
  p.route.view = { update: (...args: any[]) => seen.push(args), dispose: noop } as any;
  p.g.paused = true; p.route.update(p.g, DT);
  expect(pg.stormWarn).toBe(true); expect(seen).toHaveLength(0);
  p.g.paused = false;
  // finish 도 같은 정리를 하고 뷰를 한 번 갱신한다.
  p.route.finish(false); p.route.finish(false);
  expect(pg.stormWarn).toBe(false); expect(seen).toHaveLength(1); expect(seen[0][1]).toBe(0);
});

test('13. ownsHazards: locked 는 false, ready~storm 은 true, connected·closed·고리 아닌 방은 false', () => {
  const f = fixture(), g = gateOf(f, 1), room = g.room;
  expect(f.route.ownsHazards(room)).toBe(false);
  f.g.enterRoom(room); for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(g.phase).toBe('locked'); expect(f.route.ownsHazards(room)).toBe(false);
  killAll(f, room); f.g.markCleared(room);
  expect(g.phase).toBe('ready'); expect(f.route.ownsHazards(room)).toBe(true);
  const seen: string[] = [];
  place(f, doorEntry(f.world, room, f.world.startRoom));
  for (let t = 0; t < 60 && g.phase !== 'connected'; t += DT) {
    autoWalkStep(f);
    if (seen[seen.length - 1] !== g.phase) seen.push(g.phase);
    if (g.phase !== 'connected') expect(f.route.ownsHazards(room)).toBe(true);
  }
  expect(seen).toEqual(['ready', 'collapse', 'shelter', 'storm', 'connected']);
  expect(f.route.ownsHazards(room)).toBe(false);
  expect(f.route.ownsHazards(f.world.rooms[4])).toBe(false);
  const closed = fixture(); clearRoom(closed, 1); closed.route.stop();
  expect(closed.route.ownsHazards(closed.world.rooms[1])).toBe(false);
});

test('14. 문 방향: 모든 연결 복도에서 방 중심으로 가는 직선이 시작 룬석의 접촉 범위(contact + 0.5)를 지나지 않는다', () => {
  const f = fixture();
  const distToSegment = (p: Vector3, a: Vector3, b: Vector3) => {
    const abx = b.x - a.x, abz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)));
    return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
  };
  let checked = 0;
  for (const g of f.route.gates as any[]) {
    const room = g.room, stone = onTrack(g, g.start, DEF.track);
    expect(room.links.length).toBeGreaterThan(0);
    for (const nid of room.links) {
      const entry = doorEntry(f.world, room, f.world.rooms[nid]);
      const clearance = distToSegment(stone, entry, g.center);
      expect([room.id, nid, clearance > DEF.contact + .5]).toEqual([room.id, nid, true]);
      checked++;
    }
  }
  expect(checked).toBeGreaterThanOrEqual(8);
});

test('토스트 문구의 숫자는 def 에서 채워지고 연결 순서대로 나온다', () => {
  const f = fixture();
  connectRing(f, 1);
  const m = f.messages.filter(x => /1번 궤도 고리/.test(x));
  expect(m.some(x => x.includes(`룬석을 밀면 궤도 붕괴 ${DEF.collapseSeconds}초가 시작됩니다`))).toBe(true);
  expect(m.some(x => x.includes(`중심 쉼터에 ${DEF.connectSeconds}초 머물러 연결`))).toBe(true);
  expect(m.some(x => x.includes('유성 폭풍 · 빈 원을 따라 이동'))).toBe(true);
  expect(m.some(x => x.includes('연결 완료 · 1/5'))).toBe(true);
  expect(DEF.collapseSeconds).toBe(9); expect(DEF.connectSeconds).toBe(.5);
});

test('목표 패널·AUTO 가 읽는 값: current 는 영웅이 있는 활성/미연결 고리를 따라가고 autoPoint 는 단계별 지점을 돌려준다', () => {
  const f = fixture();
  expect(f.route.current).toBe(gateOf(f, 1)); expect(f.route.autoRoom()).toBe(f.world.rooms[1]);
  expect(f.route.autoPoint(f.world.rooms[1])).toBeNull();   // locked
  const g3 = gateOf(f, 3);
  clearRoom(f, 3); place(f, g3.center); f.route.update(f.g, DT);
  expect(f.route.current).toBe(g3);   // 영웅이 있는 방의 미연결 고리
  expect(f.g.autoTarget).toBe(g3.room);
  expect(f.route.autoPoint(f.world.rooms[1])).toBeNull();
  const point = f.route.autoPoint(g3.room)!;
  expect(point).toBe(g3.approach);   // 할당 없이 재사용
  expect(f.route.autoPoint(g3.room)).toBe(point);
  const hints: string[] = []; let calls = 0;
  f.g.ui.setObjective = () => { calls++; hints.push(f.route.hint()); };
  for (let i = 0; i < 30; i++) f.route.update(f.g, DT);
  expect(calls).toBe(0);   // 카운트다운만 바뀌는 프레임에서는 문장이 바뀌지 않는다
  expect(f.route.here).toBe(g3.room);
});


