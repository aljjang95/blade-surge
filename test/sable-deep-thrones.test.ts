// 흑사막 분지 심층(BUNDLE-09): 가짜 왕좌 4곳(방 2·3·5·6) 파괴와 모든 구역 정화 뒤 열리는 거울 미궁 탈출 규칙.
// 방 입장·증원·정화·봉인·hitArea 판정은 실제 Battle 코드를 쓰고, 영웅 위치와 시간만 테스트가 정한다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { FalseThrones } from '../src/game/false-thrones.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
const DEEP = ROUTE_OBJECTIVES.sable_deep;
const ESC = DEEP.escape;

function fixture(depth = 'deep') {
  const stage = buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: any[] = [];
  const counts = { portal: 0 };
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, sp: { clear: noop }, app: { eco: { s: {} } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: () => { counts.portal++; },
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop, embers: noop },
    drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number, o: any = {}) => { hurts.push({ n, ...o }); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      // 판정 위치에 닿지 않는 먼 곳에 세워 왕좌 판정만 검사한다.
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = createRouteObjectives(stage, world);
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, hurts, counts, stage };
}
type F = ReturnType<typeof fixture>;
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id);
const roomOf = (f: F, id: number): any => f.world.rooms[id];
const maze = (f: F) => f.route.maze;
/** 실제 입장 → 처치 → 정화 시도를 되풀이해 방을 정화하거나(왕좌 방은 왕좌가 준비될 때까지) 증원 단계를 모두 겪는다. */
function clearRoom(f: F, id: number) {
  const room = roomOf(f, id);
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  const gate = f.route.gates.find((x: any) => x.room === room);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
  return room;
}
function untilStill(f: F, gate: any) { for (let i = 0; i < 200 && gate.phase !== 'still'; i++) f.route.update(f.g, .05); }
/** 실제 근접 판정 경로(hitArea)로 왕좌 옆에서 휘두른다. */
function swing(f: F, gate: any) {
  f.g.player.pos.copy(gate.stand);
  return f.g.hitArea(f.g.player, f.g.player.pos, 0, 2.4, 120, 10, {});
}
function breakThrone(f: F, id: number) {
  const gate = gateOf(f, id); clearRoom(f, id);
  for (let i = 0; i < 60 && !gate.broken; i++) { untilStill(f, gate); swing(f, gate); f.route.update(f.g, .21); }
  return gate;
}
/** 왕좌 4곳을 모두 부수고 남은 구역(1·4·7)을 정화한다. 마지막 정화·파괴 뒤에는 route.update 를 부르지 않는다. */
function finishRooms(f: F, order = [2, 3, 5, 6, 1, 4, 7]) {
  for (const id of order) { if ([2, 3, 5, 6].includes(id)) breakThrone(f, id); else clearRoom(f, id); }
}
const idx = (w: any, x: number, z: number) => Math.floor(z - w.minZ) * w.cols + Math.floor(x - w.minX);
const flowToMirror = (f: F) => f.world.buildFlow(maze(f).real.x, maze(f).real.z)!;
const at = (f: F, id: number) => { const r = roomOf(f, id); f.g.player.pos.set(r.x, 0, r.z); };
const near = (f: F, p: Vector3, dx = 0, dz = 0) => f.g.player.pos.set(p.x + dx, 0, p.z + dz);
/** 미궁을 연 상태(방 7 중심에서 시작). */
function runningMaze() {
  const f = fixture(); finishRooms(f); at(f, 7); f.route.update(f.g, 1 / 60);
  return f;
}

test('심층 정의: 가짜 왕좌 4곳이 방 2·3·5·6이고 정예는 2·5, 거울 전당 방 4에 걸어 닿는 거울이 선다', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(DEEP);
  expect(f.route).toBeInstanceOf(FalseThrones);
  expect(f.route.def.id).toBe('sable_mirror_thrones_deep');
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 3, 5, 6]);
  expect(f.world.rooms.map(r => r.type)).toEqual(['start', 'normal', 'elite', 'normal', 'treasure', 'elite', 'normal', 'treasure', 'boss']);
  expect(f.world.rooms.map(r => r.label).slice(2, 7)).toEqual(['1번 가짜 왕좌 · 거울 회랑', '2번 가짜 왕좌 · 모래 신전', '거울 전당', '3번 가짜 왕좌 · 환영 정원', '4번 가짜 왕좌 · 거울 교차로']);
  const start = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
  for (const gate of f.route.gates) {
    expect(gate.room.objectiveProp).toBe('false-throne');
    expect(start[idx(f.world, gate.stand.x, gate.stand.z)]).toBeGreaterThanOrEqual(0);
  }
  const m = maze(f), room = roomOf(f, 4);
  expect(m.room).toBe(room);
  expect(m.real.toArray()).toEqual([room.x + 5, 0, room.z + 3.5]);
  expect(m.illusion.toArray()).toEqual([room.x - 5, 0, room.z + 3.5]);
  for (const p of [m.real, m.illusion]) {
    expect((f.world as any).inner[idx(f.world, p.x, p.z)]).toBe(1);
    expect(start[idx(f.world, p.x, p.z)]).toBeGreaterThanOrEqual(0);
  }
  expect(m).toMatchObject({ phase: 'idle', limit: 0, left: 0, elapsed: 0, collapses: 0, illusions: 0, cooldown: 0, trailN: 0, trailT: 0 });
  expect(m.trail).toBeInstanceOf(Float32Array); expect(m.trail.length).toBe(ESC.trailCount * 2);
  expect(f.route.autoGoal()).toBeNull();
});

test('잘못된 거울 정의는 생성 때 RangeError 로 거절된다', () => {
  const f = fixture();
  const make = (escape: any, world = buildExpeditionWorld(f.stage)) => new FalseThrones({ ...DEEP, escape: { ...ESC, ...escape } } as any, world);
  expect(() => make({})).not.toThrow();
  for (const roomId of [0, 8, 2, 99]) expect(() => make({ roomId })).toThrow(RangeError);
  expect(() => make({ real: [500, 0] })).toThrow(RangeError);
  // 지도 안이지만 걸을 수 없는 칸(벽/허공)도 거절한다.
  const world: any = buildExpeditionWorld(f.stage), room = world.rooms[4];
  const cell = world.inner.indexOf(0), cx = cell % world.cols, cz = Math.floor(cell / world.cols);
  expect(() => make({ illusion: [world.minX + cx + .5 - room.x, world.minZ + cz + .5 - room.z] }, world)).toThrow(RangeError);
});

test('정예방 왕좌는 실제 증원 2회를 겪기 전에는 준비되지 않고, 일반방 왕좌는 첫 처치 뒤 준비된다', () => {
  const f = fixture(), elite = gateOf(f, 2), normal = gateOf(f, 3);
  const room = roomOf(f, 2);
  f.g.enterRoom(room); for (const timer of f.g.timers.splice(0)) timer.fn();
  for (let wave = 1; wave <= 2; wave++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
    expect(room.forgeWave).toBe(wave); expect(elite.ready).toBe(false);
  }
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  expect(elite.ready).toBe(true); expect(room.cleared).toBe(false);
  clearRoom(f, 3);
  expect(normal.ready).toBe(true); expect(roomOf(f, 3).cleared).toBe(false);
});

test('왕좌 4곳이 순서와 상관없이 부서져도 구역이 남아 있으면 미궁은 닫혀 있고 정화 안내가 나온다', () => {
  const f = fixture();
  for (const id of [6, 3, 2, 5]) breakThrone(f, id);
  expect(f.route.progress).toBe(4); expect(f.route.complete).toBe(true);
  f.route.update(f.g, .1); f.route.update(f.g, .1);
  expect(maze(f).phase).toBe('idle'); expect(f.route.autoGoal()).toBeNull();
  expect(f.route.canUnseal()).toBe(false);
  expect(f.route.hint()).toBe('가짜 왕좌 4/4 파괴 · 남은 구역 정화');
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '가짜 왕좌 파괴', action: '남은 구역 정화', progress: 4, total: 4 });
  // 구역(1·4·7)을 일부만 정화해도 하나가 남아 있으면 열리지 않는다.
  clearRoom(f, 1); clearRoom(f, 4); f.route.update(f.g, .1);
  expect(maze(f).phase).toBe('idle');
});

test('왕좌 3곳만 부순 채 나머지 구역이 정화돼도 미궁은 열리지 않는다', () => {
  const f = fixture();
  for (const id of [2, 3, 5]) breakThrone(f, id);
  for (const id of [1, 4, 7]) clearRoom(f, id);
  clearRoom(f, 6);   // 4번째 왕좌는 준비만 됐을 뿐 부서지지 않았다.
  expect(roomOf(f, 6).cleared).toBe(false);
  f.route.update(f.g, .1);
  expect(maze(f).phase).toBe('idle');
});

test('마지막 정화·파괴 뒤 첫 경로 목표 갱신에서 미궁이 열리고 제한 시간은 시작 칸의 거리장으로 정해진다', () => {
  const f = fixture(); finishRooms(f);
  expect(maze(f).phase).toBe('idle');   // 정화·파괴 자체는 미궁을 열지 않는다
  // 마지막 정화에 붙은 1.2초 봉인 타이머도 미궁이 끝나기 전에는 봉인을 풀 수 없다.
  for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(f.world.sealed).toBe(true); expect(f.counts.portal).toBe(0);
  at(f, 7);
  f.messages.length = 0;
  f.route.update(f.g, 1 / 60);
  const m = maze(f);
  expect(m.phase).toBe('running');
  const dist = flowToMirror(f)[idx(f.world, f.g.player.pos.x, f.g.player.pos.z)];
  expect(dist).toBeGreaterThan(0);
  expect(m.limit).toBe(Math.ceil(dist / ESC.pace + ESC.grace)); expect(m.left).toBe(m.limit);
  expect(m.limit).toBe(30);   // 방 7에서 시작하는 심층의 계약 값
  expect(m.elapsed).toBe(0); expect(m.trailT).toBe(ESC.trailEvery);
  expect(f.messages).toContain('거울 미궁 · 모래 발자국을 따라 진짜 거울로 30초 안에 탈출');
  expect(f.route.autoGoal()).toBe(m.real);
  expect(f.route.hint()).toBe('거울 미궁 탈출 · 모래 발자국을 따라 진짜 거울로 · 30초');
  expect(f.world.sealed).toBe(true);
  // 더 가까운 곳(방 6)에서 시작하면 제한 시간이 줄어든다.
  const g = fixture(); finishRooms(g); at(g, 6); g.route.update(g.g, 1 / 60);
  expect(maze(g).limit).toBe(22);
});

test('발자국은 영웅 칸에서 진짜 거울로 거리장을 따라 줄어들고 0.5초마다 영웅 위치에서 다시 찍힌다', () => {
  const f = runningMaze(), m = maze(f), flow = flowToMirror(f);
  const cellDist = (i: number) => flow[idx(f.world, m.trail[i * 2], m.trail[i * 2 + 1])];
  expect(m.trailN).toBeGreaterThanOrEqual(3); expect(m.trailN).toBeLessThanOrEqual(ESC.trailCount);
  const hero = flow[idx(f.world, f.g.player.pos.x, f.g.player.pos.z)];
  let prev = hero;
  for (let i = 0; i < m.trailN; i++) {
    const d = cellDist(i);
    expect((f.world as any).inner[idx(f.world, m.trail[i * 2], m.trail[i * 2 + 1])]).toBe(1);
    expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(prev);
    expect(prev - d).toBeGreaterThanOrEqual(1);   // 점마다 1칸 이상 진짜 거울에 가까워진다
    prev = d;
  }
  expect(cellDist(0)).toBeGreaterThan(cellDist(m.trailN - 1));
  const first = [m.trail[0], m.trail[1]];
  // 영웅이 길을 따라 한참 가면 다음 갱신에서 발자국도 앞으로 옮겨 찍힌다.
  at(f, 5);
  f.route.update(f.g, .25); expect([m.trail[0], m.trail[1]]).toEqual(first);   // 0.5초 전에는 그대로
  f.route.update(f.g, .26);
  expect([m.trail[0], m.trail[1]]).not.toEqual(first);
  expect(cellDist(0)).toBeLessThan(hero);
});

test('발자국은 거리가 같은 이웃이면 x+ → x− → z+ → z− 순서로 고른다', () => {
  const f = runningMaze(), m = maze(f), { minX, minZ } = f.world as any;
  // 진짜 거울의 왼쪽 아래(-x, -z)에서는 x+ 와 z+ 가 모두 가까워진다. x+ 가 먼저다.
  near(f, m.real, -4, -3);
  const cx = Math.floor(f.g.player.pos.x - minX), cz = Math.floor(f.g.player.pos.z - minZ);
  f.route.update(f.g, ESC.trailEvery + .01);
  expect(m.trail[0]).toBeCloseTo(minX + cx + 2 + .5, 3); expect(m.trail[1]).toBeCloseTo(minZ + cz + .5, 3);   // Float32Array 라 근사 비교
  // 오른쪽 위(+x, +z)에서는 x− 와 z− 가 모두 가까워진다. x− 가 먼저다.
  near(f, m.real, 3, 2);
  const rx = Math.floor(f.g.player.pos.x - minX), rz = Math.floor(f.g.player.pos.z - minZ);
  f.route.update(f.g, ESC.trailEvery + .01);
  expect(m.trail[0]).toBeCloseTo(minX + rx - 2 + .5, 3); expect(m.trail[1]).toBeCloseTo(minZ + rz + .5, 3);
});

test('미궁 갱신은 AUTO 와 같은 거리장 캐시를 쓰고 난수·시계를 쓰지 않는다', () => {
  const f = runningMaze();
  const random = Math.random, now = Date.now, perf = performance.now;
  Math.random = () => { throw new Error('난수 사용'); }; Date.now = () => { throw new Error('시계 사용'); }; performance.now = () => { throw new Error('시계 사용'); };
  try {
    const a = flowToMirror(f);
    for (let i = 0; i < 90; i++) f.route.update(f.g, 1 / 60);
    expect(flowToMirror(f)).toBe(a);
  } finally { Math.random = random; Date.now = now; performance.now = perf; }
});

test('환영 거울은 반사 피해와 밀침을 주고 재사용 대기 안의 재접촉은 무시하며 탈출이 아니다', () => {
  const f = runningMaze(), m = maze(f);
  near(f, m.illusion, .5, 0);
  f.messages.length = 0;
  f.route.update(f.g, 1 / 60);
  expect(f.hurts.length).toBe(1);
  expect(f.hurts[0].n).toBeCloseTo(100 * ESC.illusionDamage, 6);
  expect(f.hurts[0].dirx).toBeGreaterThan(0.9); expect(f.hurts[0].kb).toBe(3);   // 거울 반대 방향(+x)으로 민다
  expect(m.illusions).toBe(1); expect(m.phase).toBe('running'); expect(f.world.sealed).toBe(true);
  expect(f.messages).toContain('환영 거울 · 모래 발자국이 닿지 않는 거울입니다');
  for (let i = 0; i < 60; i++) f.route.update(f.g, 1 / 60);   // 1초: 재사용 대기 1.5초 안
  expect(f.hurts.length).toBe(1); expect(m.illusions).toBe(1);
  for (let i = 0; i < 40; i++) f.route.update(f.g, 1 / 60);   // 1.67초
  expect(f.hurts.length).toBe(2); expect(m.illusions).toBe(2);
  expect(f.route.canUnseal()).toBe(false);
});

test('시간이 다 되면 거울이 붕괴해 피해를 주고 지금 위치에서 제한 시간을 다시 계산하며 진행은 막지 않는다', () => {
  const f = runningMaze(), m = maze(f);
  const firstLimit = m.limit;
  // 영웅이 제자리에 서서 실제 갱신을 여러 번 불러 left 를 0 아래로 보낸다.
  let steps = 0;
  while (m.collapses === 0 && steps < 2000) { f.route.update(f.g, .1); steps++; }
  expect(m.collapses).toBe(1);
  expect(steps).toBeGreaterThanOrEqual(firstLimit * 10 - 1); expect(steps).toBeLessThanOrEqual(firstLimit * 10 + 1);
  expect(f.hurts.length).toBe(1); expect(f.hurts[0].n).toBeCloseTo(100 * ESC.collapseDamage, 6);
  expect(m.phase).toBe('running'); expect(f.world.sealed).toBe(true);
  expect(m.left).toBe(m.limit); expect(m.limit).toBe(firstLimit);   // 같은 자리라 같은 시간으로 다시 시작
  // 영웅이 거울 전당 중심으로 옮겨 간 뒤의 붕괴는 그 위치에서 다시 계산한다.
  at(f, 4);
  while (m.collapses === 1) f.route.update(f.g, .1);
  const here = flowToMirror(f)[idx(f.world, f.g.player.pos.x, f.g.player.pos.z)];
  expect(m.limit).toBe(Math.ceil(here / ESC.pace + ESC.grace)); expect(m.limit).toBeLessThan(firstLimit);
  expect(f.hurts.length).toBe(2);
  // 붕괴 뒤에도 진짜 거울에 닿으면 탈출한다.
  near(f, m.real); f.route.update(f.g, .05);
  expect(m.phase).toBe('done'); expect(f.world.sealed).toBe(false);
});

test('진짜 거울에 닿으면 탈출하고 그 자리에서 실제 unsealBoss 가 봉인을 풀며 포탈이 열린다', () => {
  const f = runningMaze(), m = maze(f);
  const phases: string[] = [], unseal = f.g.unsealBoss;
  f.g.unsealBoss = function () { phases.push(m.phase); return unseal.call(this); };   // 실제 unsealBoss 를 부르되 호출 시점의 phase 를 기록한다
  at(f, 4); for (let i = 0; i < 10; i++) f.route.update(f.g, 1 / 60);
  expect(m.phase).toBe('running'); expect(f.world.sealed).toBe(true);   // 거울 전당 안이어도 반경 밖이면 아직이다
  expect(phases).toEqual([]);
  f.messages.length = 0;
  near(f, m.real, 1.3, 0);
  f.route.update(f.g, 1 / 60);
  expect(m.phase).toBe('done');
  expect(f.world.sealed).toBe(false); expect(f.counts.portal).toBe(1);
  expect(phases).toEqual(['done']);   // unsealBoss 는 canUnseal 을 다시 확인하므로 phase 를 바꾼 뒤에 한 번 불린다
  expect(f.route.canUnseal()).toBe(true); expect(f.route.autoGoal()).toBeNull();
  expect(f.messages).toContain('진짜 거울 통과 · 환영 여왕의 본체가 드러납니다');
  expect(f.hurts.length).toBe(0);
  expect(f.route.hint()).toBe('거울 미궁 탈출 완료 · 여왕 처치');
  const left = m.left, elapsed = m.elapsed;
  for (let i = 0; i < 30; i++) f.route.update(f.g, .1);
  expect([m.left, m.elapsed]).toEqual([left, elapsed]);   // 탈출 뒤에는 시계가 멈춘다
});

test('반경 바로 바깥은 탈출이 아니다', () => {
  const f = runningMaze(), m = maze(f);
  near(f, m.real, ESC.radius + .05, 0); f.route.update(f.g, 1 / 60);
  expect(m.phase).toBe('running');
});

test('같은 스텝에서 진짜 거울 도달이 시간 초과보다 우선한다', () => {
  const f = runningMaze(), m = maze(f);
  while (m.left > .4) f.route.update(f.g, .2);
  near(f, m.real);
  f.route.update(f.g, .5);   // 이 스텝에서 left 가 0 아래로 내려간다
  expect(m.phase).toBe('done'); expect(m.collapses).toBe(0); expect(f.hurts.length).toBe(0);
  expect(f.world.sealed).toBe(false);
});

test('환영 접촉과 시간 초과가 같은 스텝이면 둘 다 적용된다(환영 먼저)', () => {
  const f = runningMaze(), m = maze(f);
  while (m.left > .4) f.route.update(f.g, .2);
  near(f, m.illusion, .3, 0);
  f.route.update(f.g, .5);
  expect(m.illusions).toBe(1); expect(m.collapses).toBe(1);
  expect(f.hurts.map(h => Math.round(h.n))).toEqual([6, 6]);
  expect(f.hurts[0].kb).toBe(3);   // 첫 피해가 환영 반사(밀침 있음)
});

test('일시정지·사망·보스 처치 동안 시계와 발자국과 재사용 대기는 변하지 않는다', () => {
  const f = runningMaze(), m = maze(f);
  for (let i = 0; i < 20; i++) f.route.update(f.g, .1);
  const snap = () => [m.left, m.elapsed, m.trailT, m.cooldown, m.trailN, Array.from(m.trail).join()].join('|');
  const before = snap(), leftBefore = m.left;
  f.g.paused = true;
  for (let i = 0; i < 120; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.paused = false; f.g.player.alive = false;
  for (let i = 0; i < 30; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.player.alive = true; f.g.bossDefeated = true;
  for (let i = 0; i < 30; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.bossDefeated = false;
  f.route.update(f.g, .1);
  expect(m.left).toBeCloseTo(leftBefore - .1, 6);
  // 유한하지 않거나 0 이하인 dt 는 시간을 진행하지 않는다.
  const after = snap();
  for (const dt of [0, -1, NaN, Infinity]) f.route.update(f.g, dt);
  expect(snap()).toBe(after);
});

test('autoGoal 은 미궁이 도는 동안에만 진짜 거울이고, AUTO 는 그 지점으로 거리장을 따라 걸어 탈출한다', () => {
  const f = fixture(); finishRooms(f);
  expect(f.route.autoGoal()).toBeNull();
  at(f, 7); f.route.update(f.g, 1 / 60);
  expect(f.route.autoGoal()).toBe(maze(f).real);
  // 실제 Player.autoExplore 의 이동 방향으로 걷는다(속도 5, 1/30초 스텝).
  const ctx: any = { game: f.g, pos: f.g.player.pos };
  const random = Math.random;
  Math.random = () => { throw new Error('AUTO 이동이 난수를 소비했다'); };
  let t = 0;
  try {
    while (maze(f).phase === 'running' && t < 40 * 30) {
      const dir = Player.prototype.autoExplore.call(ctx, 1 / 30);
      f.g.player.pos.x += dir.x * 5 / 30; f.g.player.pos.z += dir.y * 5 / 30;
      f.route.update(f.g, 1 / 30); t++;
    }
  } finally { Math.random = random; }
  expect(maze(f).phase).toBe('done');
  expect(maze(f).collapses).toBe(0); expect(maze(f).illusions).toBe(0);
  expect(maze(f).elapsed).toBeLessThan(maze(f).limit);
  expect(f.world.sealed).toBe(false);
  expect(f.route.autoGoal()).toBeNull();
});

test('결과 보고: 탈출 기록이 실제 값이고 패배·미탈출은 완료가 아니며 한 번 만든 보고는 바뀌지 않는다', () => {
  const lost = runningMaze();
  const loss = lost.route.finish(false);
  expect(loss).toMatchObject({ id: 'sable_mirror_thrones_deep', label: '가짜 왕좌 파괴', complete: false, progress: 4, target: 4,
    escape: { escaped: false, collapses: 0, illusions: 0, seconds: 0 } });
  expect(lost.route.finish(true)).toBe(loss);

  const f = runningMaze(), m = maze(f);
  near(f, m.illusion, .4, 0); f.route.update(f.g, .3);
  while (m.collapses === 0) { at(f, 7); f.route.update(f.g, .5); }
  near(f, m.real); f.route.update(f.g, .1);
  // 보스 처치는 Battle 소유다. 보스방이 정화된 상태를 만든다.
  f.world.bossRoom.cleared = true;
  const win = f.route.finish(true);
  expect(win).toMatchObject({ id: 'sable_mirror_thrones_deep', complete: true, progress: 4, target: 4, rooms: [2, 3, 5, 6],
    escape: { escaped: true, collapses: 1, illusions: 1 } });
  expect(win.escape.seconds).toBe(Math.round(m.elapsed * 100) / 100);
  expect(win.escape.seconds).toBeGreaterThan(0);
  expect(Object.isFrozen(win)).toBe(true); expect(Object.isFrozen(win.escape)).toBe(true);
});

test('탈출하지 못한 채 보스방이 정화된 것처럼 보여도 승리 완료로 세지 않는다', () => {
  const f = runningMaze();
  f.world.bossRoom.cleared = true;
  expect(f.route.canWin()).toBe(false);
  expect(f.route.finish(true).complete).toBe(false);
});

test('목표창: 미궁이 도는 동안 남은 시간과 거울 전당을 보이고 탈출 뒤에는 보스 흐름으로 돌아간다', () => {
  const f = runningMaze(), m = maze(f);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '거울 미궁 탈출', action: '모래 발자국을 따라 진짜 거울로 · 30초',
    progress: 4, total: 4, roomId: 4 });
  for (let i = 0; i < 30; i++) f.route.update(f.g, .1);   // 3초
  expect(battleObjectiveView(f.g).action).toBe('모래 발자국을 따라 진짜 거울로 · 27초');
  f.route.update(f.g, .01);
  expect(battleObjectiveView(f.g).action).toBe('모래 발자국을 따라 진짜 거울로 · 27초');
  near(f, m.real); f.route.update(f.g, .1);
  expect(battleObjectiveView(f.g).title).not.toBe('거울 미궁 탈출');
  expect(battleObjectiveView(f.g).title).toMatch(/보스/);
});

test('일반 흑사막(3곳)은 거울 미궁 없이 기존 판정·문구·보고 그대로다', () => {
  const f = fixture('standard');
  expect(f.route.def.id).toBe('sable_false_thrones');
  expect(f.route.maze).toBeNull(); expect(f.route.autoGoal()).toBeNull();
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 5, 6]);
  expect(f.route.hint()).toBe('가짜 왕좌 0/3 · 1번 가짜 왕좌 · 거울 회랑 · 적 처치 후 공격');
  for (const id of [2, 5, 6]) breakThrone(f, id);
  expect(f.route.hint()).toBe('가짜 왕좌 3/3 파괴 · 남은 구역 정화');
  expect(f.route.canUnseal()).toBe(false);
  for (const r of f.world.rooms) if (!['start', 'boss'].includes(r.type)) r.cleared = true;
  expect(f.route.canUnseal()).toBe(true);
  expect(f.route.hint()).toBe('가짜 왕좌 3/3 파괴 · 여왕 처치');
  f.route.update(f.g, .1);
  const report = f.route.finish(true);
  expect(report).toMatchObject({ id: 'sable_false_thrones', progress: 3, target: 3 });
  expect('escape' in report).toBe(false);
  expect(f.world.sealed).toBe(true);   // 일반은 Battle 의 기존 1.2초 타이머가 푼다. 이 클래스가 풀지 않는다.
});

test('파티·균열·전술 공략 심층 원정은 가짜 왕좌 규칙을 쓰지 않는다', () => {
  const f = fixture();
  const base: any = f.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    { ...base, expedition: { ...base.expedition, riftId: 'x' } }, { ...base, expedition: { ...base.expedition, conquestId: 'x' } }]) {
    expect(routeObjectiveForStage(stage)).toBeNull();
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
});

function fakeViews(f: F) {
  const calls: any[] = [], opts = new Set<any>();
  const view = { update: (_r: any, dt: number) => calls.push(['view', dt, f.route.gates.map((g: any) => [g.ready, g.hits, g.broken].join())]),
    shatter: noop, disposed: 0, dispose() { this.disposed++; } };
  const mazeView = { update: (_r: any, dt: number, o: any) => { calls.push(['maze', dt, o.reduced]); opts.add(o); },
    disposed: 0, dispose() { this.disposed++; } };
  f.route.view = view; f.route.mazeView = mazeView;
  return { calls, opts, view, mazeView };
}

test('거울 뷰 연결: 일시정지에는 갱신하지 않고 옵션 객체를 재사용하며 규칙이 일찍 끝나도 이어서 그린다', () => {
  const f = runningMaze(), v = fakeViews(f);
  f.g.app.reducedMotion = { matches: false };
  f.route.update(f.g, .1);
  expect(v.calls.filter(c => c[0] === 'maze')).toEqual([['maze', .1, false]]);
  f.g.app.reducedMotion = { matches: true };
  f.route.update(f.g, .1);
  expect(v.calls.filter(c => c[0] === 'maze').at(-1)).toEqual(['maze', .1, true]);
  expect(v.opts.size).toBe(1);   // 같은 객체를 다시 쓴다
  v.calls.length = 0;
  f.g.paused = true;
  f.route.update(f.g, .1);
  expect(v.calls).toEqual([]);
  f.g.paused = false;
  for (const dt of [0, -1, NaN]) f.route.update(f.g, dt);
  expect(v.calls.filter(c => c[0] === 'maze')).toEqual([]);
  // 보스를 쓰러뜨린 뒤(규칙 조기 반환)에도 일시정지가 아니면 뷰는 갱신한다.
  f.g.bossDefeated = true;
  f.route.update(f.g, .1);
  expect(v.calls.filter(c => c[0] === 'maze')).toEqual([['maze', .1, true]]);
});

test('syncView 는 왕좌 뷰와 거울 뷰를 시간 진행 없이(dt 0) 함께 갱신하고 일시정지에는 아무것도 하지 않는다', () => {
  const f = runningMaze(), v = fakeViews(f);
  f.route.syncView(f.g);
  expect(v.calls.map(c => [c[0], c[1]])).toEqual([['view', 0], ['maze', 0]]);
  v.calls.length = 0;
  f.g.paused = true; f.route.syncView(f.g);
  expect(v.calls).toEqual([]);
  const bare = fixture('standard');
  expect(() => bare.route.syncView(bare.g)).not.toThrow();   // 뷰가 없어도 안전하다
});

test('왕좌가 준비되는 순간과 균열·파괴 직후에 같은 프레임으로 뷰를 맞춘다', () => {
  const f = fixture(), v = fakeViews(f);
  const gate = gateOf(f, 3), room = roomOf(f, 3);
  f.g.enterRoom(room); for (const timer of f.g.timers.splice(0)) timer.fn();
  v.calls.length = 0;
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  // 준비(ready)를 세운 직후 시간 진행 없는 뷰 갱신이 일어났고, 그 시점에 ready 가 이미 true 였다.
  const sync = v.calls.filter(c => c[0] === 'view' && c[1] === 0);
  expect(sync.length).toBeGreaterThanOrEqual(1);
  expect(sync.at(-1)![2][1]).toBe('true,0,false');
  expect(v.calls.filter(c => c[0] === 'maze' && c[1] === 0).length).toBeGreaterThanOrEqual(1);

  untilStill(f, gate);
  v.calls.length = 0;
  swing(f, gate);   // 실제 hitArea → 균열 1
  const crack = v.calls.filter(c => c[0] === 'view' && c[1] === 0);
  expect(crack.length).toBe(1); expect(crack[0][2][1]).toBe('true,1,false');
  expect(v.calls.filter(c => c[0] === 'maze' && c[1] === 0).length).toBe(1);
  // 회전 중 공격(반사)처럼 표시 입력이 바뀌지 않는 판정은 뷰를 갱신하지 않는다.
  gate.phase = 'spin'; gate.gap = 0; v.calls.length = 0;
  swing(f, gate);
  expect(v.calls.filter(c => c[1] === 0)).toEqual([]);

  for (let i = 0; i < 60 && !gate.broken; i++) { untilStill(f, gate); v.calls.length = 0; swing(f, gate); f.route.update(f.g, .21); }
  expect(gate.broken).toBe(true);
  const last = v.calls.filter(c => c[0] === 'view' && c[1] === 0).at(-1)!;
  expect(last[2][1]).toBe('true,5,true');   // 파괴 직후의 표시 입력으로 맞췄다
});

test('stop 은 두 뷰를 한 번씩 해제하고 반복 호출해도 안전하다', () => {
  const f = fixture(), v = fakeViews(f);
  f.route.stop(); f.route.stop();
  expect(v.view.disposed).toBe(1); expect(v.mazeView.disposed).toBe(1);
  expect(f.route.view).toBeNull(); expect(f.route.mazeView).toBeNull();
  expect(f.route.closed).toBe(true); expect(f.route.autoGoal()).toBeNull();
});

test('prepareView 는 거울 정의가 있을 때만 거울 뷰를 시도하고 stop 이 정리한다', async () => {
  const std = fixture('standard');
  await std.route.prepareView(new Scene());
  expect(std.route.mazeView).toBeNull();
  const deep = fixture();
  await deep.route.prepareView(new Scene());
  // 거울 뷰 파일은 다른 lane 이 만든다. 있으면 해제 가능한 뷰가, 없거나 만들 수 없으면 규칙 그대로 null 이다.
  expect(deep.route.mazeView === null || typeof deep.route.mazeView.dispose === 'function').toBe(true);
  expect(deep.route.view).not.toBeNull();
  deep.route.stop();
  expect(deep.route.mazeView).toBeNull(); expect(deep.route.view).toBeNull();
});
