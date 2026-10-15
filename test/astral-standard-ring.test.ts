// 성운 첨탑 일반(BUNDLE-13): 조율판 4곳(방 1 → 3 → 4 → 6) 복원 뒤 열리는 '기록 외곽 고리 이탈'(방 7)과 공용 고리 엔진.
// 방 입장·정화·봉인·승리는 실제 Battle 코드와 실제 Floor 를 쓰고, 영웅 위치와 시간만 테스트가 정한다.
// 심층(성좌 외곽 고리 정화)도 같은 틀로 문구를 검사해 공용화가 심층 문구를 바꾸지 않았음을 확인한다.
import { expect, test } from 'bun:test';
import { heapStats } from 'bun:jsc';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { HEROES } from '../src/data/heroes.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { AstralConstellations } from '../src/game/astral-constellations.js';
import { AstralRingConstellations } from '../src/game/astral-ring-constellations.js';
import { AstralDeepConstellations } from '../src/game/astral-deep-constellations.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';

const noop = () => {};
const STD = ROUTE_OBJECTIVES.astral_standard;
const RING = STD.ring;
const GATES = [1, 3, 4, 6];

function fixture(opts: { depth?: string; noRoute?: boolean } = {}) {
  const stage = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null, { depth: opts.depth || 'standard' });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: any[] = [], spawns: any[] = [];
  const counts = { portal: 0, objective: 0 };
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, sp: { clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    scene: new Scene(),
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop,
      setObjective: () => { counts.objective++; }, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: () => { counts.portal++; },
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop, embers: noop },
    drops: { spawn: (_at: any, kind: string, value: any) => spawns.push({ kind, value }), clear: noop }, rollDrop: () => ({}),
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number, o: any = {}) => { hurts.push({ n, ...o }); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn?.(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = opts.noRoute ? null : createRouteObjectives(stage, world);
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, hurts, spawns, counts, stage };
}
type F = ReturnType<typeof fixture>;
const roomOf = (f: F, id: number): any => f.world.rooms[id];
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id);
const ring = (f: F) => f.route.ring;
const at = (f: F, id: number, dx = 0, dz = 0) => { const r = roomOf(f, id); f.g.player.pos.set(r.x + dx, 0, r.z + dz); };
const atMark = (f: F, i: number, dx = 0, dz = 0) => { const p = ring(f).marks[i].pos; f.g.player.pos.set(p.x + dx, 0, p.z + dz); };
const flush = (f: F) => { for (const timer of f.g.timers.splice(0)) timer.fn(); };
/** 실제 입장 → 처치 → 정화 시도를 되풀이해 방을 정화하거나(조율판 방은 준비될 때까지) 증원 단계를 모두 겪는다. */
function clearRoom(f: F, id: number) {
  const room = roomOf(f, id), gate = f.route ? gateOf(f, id) : null;
  f.g.enterRoom(room); flush(f);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
  return room;
}
/** 지금 차례인 조율판을 복원한다: 정리 → 단서 1초 → 정답 판 1초 + 다음 유효 프레임. */
function restore(f: F, index = f.route.progress) {
  const gate = f.route.gates[index];
  clearRoom(f, gate.room.id);
  f.g.player.pos.copy(gate.pos); f.route.update(f.g, 1);
  f.g.player.pos.copy(gate.pads.find((p: any) => p.id === gate.answer).pos);
  f.route.update(f.g, .99); f.route.update(f.g, .01); f.route.update(f.g, .01);
  expect(f.route.progress).toBe(index + 1);
  return gate;
}
function restoreAll(f: F) { for (let i = 0; i < f.route.gates.length; i++) restore(f, i); }
/** 조율판 방이 아닌 구역(시작·보스방 제외)을 모두 정화한다. */
function clearZones(f: F, except: number[] = []) {
  const gateRooms = f.route.gates.map((g: any) => g.room.id);
  for (const r of f.world.rooms) if (r.type !== 'start' && r.type !== 'boss' && !gateRooms.includes(r.id) && !except.includes(r.id)) clearRoom(f, r.id);
}
/** 조율판을 모두 복원하고 방 7 을 뺀 구역을 정화한다. */
function untilRoomSeven(f: F) { restoreAll(f); clearZones(f, [7]); }
/** 고리를 연 상태(영웅은 where 위치, 열리는 스텝 직후). */
function opened(where: [number, number, number] = [6, 0, 0], depth = 'standard') {
  const f = fixture({ depth }); untilRoomSeven(f); clearRoom(f, 7); at(f, ...where); f.messages.length = 0;
  f.route.update(f.g, 1 / 60);
  expect(ring(f).phase).toBe('open');
  return f;
}
/** 방 안 안전한 자리: 중심에서 5.9, 서쪽 표지에서 4.6, 북쪽 표지에서 도 먼 곳(일반·심층 공통). */
const SAFE: [number, number] = [-4.2, 4.2];
function running(depth = 'standard') {
  const f = opened([6, 0, 0], depth); at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25);
  expect(ring(f).phase).toBe('running');
  return f;
}
function run(f: F, seconds: number, dt = .25) { for (let t = 0; t < seconds - 1e-9; t += dt) f.route.update(f.g, dt); }

test('정의 연결: 고리가 있는 일반 정의는 공용 고리 엔진, 심층은 그 하위 빈 클래스이며 같은 엔진을 쓴다', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(STD);
  expect(f.route.constructor).toBe(AstralRingConstellations);
  expect(f.route).toBeInstanceOf(AstralConstellations);
  const deep = fixture({ depth: 'deep' });
  expect(deep.route.constructor).toBe(AstralDeepConstellations);
  expect(deep.route).toBeInstanceOf(AstralRingConstellations);
  // 일반 지도: 조율판 1 → 3 → 4 → 6, 고리는 정예방 7. 고리 방 이름은 정의의 label 이다.
  expect(f.world.rooms.map((r: any) => r.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'elite', 'treasure', 'normal', 'elite', 'boss']);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual(GATES);
  const r = ring(f), room = roomOf(f, 7);
  expect(r.room).toBe(room); expect(room.label).toBe('기록 외곽 고리');
  expect(r).toMatchObject({ phase: 'idle', clock: 0, limit: 24, left: 24, elapsed: 0, collapses: 0, shardHits: 0, purified: 0, held: -1,
    minX: room.x - room.w / 2, maxX: room.x + room.w / 2, minZ: room.z - room.h / 2, maxZ: room.z + room.h / 2 });
  expect(r.center.toArray()).toEqual([room.x, 0, room.z]);
  expect(r.marks.map((m: any) => [m.pos.x - room.x, m.pos.z - room.z])).toEqual([[-6, 0], [0, -6], [6, 0]]);
  expect(r.marks.every((m: any) => m.hold === 0 && m.done === false)).toBe(true);
  expect(r.shard).toEqual({ state: 'calm', age: 0, cycle: -1 });
  expect(f.route.autoGoal()).toBeNull(); expect(f.route.canUnseal()).toBe(false); expect(f.route.canWin()).toBe(false);
  expect(f.route.coexistsAttunement).toBe(false);
});

test('잘못된 고리 정의는 생성 때 RangeError 로 거절되고, 오류 문구도 정의의 낱말을 쓴다', () => {
  const f = fixture();
  const make = (extra: any, world: any = buildExpeditionWorld(f.stage)) => new AstralRingConstellations({ ...STD, ring: extra && { ...RING, ...extra } } as any, world);
  expect(() => make({})).not.toThrow();
  for (const roomId of [0, 8, 1, 3, 4, 6, 99]) expect(() => make({ roomId })).toThrow(RangeError);   // 시작·보스·조율판 방·없는 방
  expect(() => make(null)).toThrow(RangeError);
  expect(() => make({ marks: [] })).toThrow('항로 표지');
  expect(() => make({ marks: [[-6, 0], [0, 40]] })).toThrow(RangeError);       // 방 밖 표지
  expect(() => make({ marks: [[-13, 0]] })).toThrow(RangeError);              // 판정 원이 방 벽에 걸림
  const blocked = { ...f.world, buildFlow: () => new Int32Array(f.world.cols! * f.world.rows!).fill(-1) };
  expect(() => make({}, blocked)).toThrow(RangeError);
  // 표지 판정 원 둘레의 여유(원 + .6)가 막히면 거절: 표지 주변 한 칸만 이동 불가로 만든다.
  const world = buildExpeditionWorld(f.stage) as any, room = world.rooms[7];
  const real = world.buildFlow.bind(world);
  world.buildFlow = (x: number, z: number) => {
    const flow = real(x, z).slice();
    const cx = Math.floor(room.x + 6 + RING.markRadius + .6 - world.minX), cz = Math.floor(room.z - world.minZ);
    flow[cz * world.cols + cx] = -1;
    return flow;
  };
  expect(() => make({}, world)).toThrow(RangeError);
});

test('열림: 조율판 4/4 와 시작·보스방을 뺀 모든 구역 정화가 모두 끝난 다음 update 에만 열리고, 열리는 스텝에는 clock 이 흐르지 않는다', () => {
  // 구역은 모두 정화됐지만 조율판이 3/4
  const a = fixture(); for (let i = 0; i < 3; i++) restore(a, i); clearZones(a);
  run(a, 5, .5); expect(ring(a).phase).toBe('idle'); expect(ring(a).clock).toBe(0);
  // 조율판 4/4 인데 방 7 이 남음
  const b = fixture(); restoreAll(b); clearZones(b, [7]);
  run(b, 5, .5); expect(ring(b).phase).toBe('idle');
  expect(b.route.hint()).toBe('별자리 4/4 복원 · 남은 구역 정화');
  // 방 5 가 남아도 열리지 않는다
  const c = fixture(); restoreAll(c); clearZones(c, [5]);
  run(c, 5, .5); expect(ring(c).phase).toBe('idle');
  // 마지막 구역을 Battle 이 정화한 뒤 첫 update: 열리되 시간은 0
  clearRoom(c, 5); expect(ring(c).phase).toBe('idle');
  c.route.update(c.g, .5);
  expect(ring(c).phase).toBe('open'); expect(ring(c).clock).toBe(0); expect(ring(c).shard).toEqual({ state: 'calm', age: 0, cycle: -1 });
  expect(ring(c).left).toBe(24); expect(c.messages).toContain('기록 외곽 고리 개방 · 고리 위 항로 표지 3개를 밝히세요');
  expect(c.route.hint()).toBe('외곽 고리 이탈 · 기록 외곽 고리로 이동');
  // 열리는 스텝에도 봉인은 그대로
  flush(c); c.g.unsealBoss(); expect(c.world.sealed).toBe(true);
});

test('4/4 순간: 부모의 복원 완료 토스트 뒤 안내 토스트가 한 번 나오고 고리는 그 스텝에 열리지 않는다', () => {
  const f = fixture(); for (let i = 0; i < 3; i++) restore(f, i); clearZones(f);
  f.messages.length = 0;
  restore(f, 3);
  const done = f.messages.findIndex(m => m.endsWith('복원 완료 · 4/4')), all = f.messages.indexOf('모든 별자리 복원 · 모든 구역을 정화하면 기록 외곽 고리가 열립니다');
  expect(done).toBeGreaterThanOrEqual(0); expect(all).toBe(done + 1);
  expect(f.messages.some(m => m.includes('개방'))).toBe(false);
  expect(ring(f).phase).toBe('idle');
  run(f, 1, .5);
  expect(ring(f).phase).toBe('open');
  expect(f.messages.filter(m => m.startsWith('모든 별자리 복원'))).toHaveLength(1);
  expect(f.messages.filter(m => m.includes('개방'))).toHaveLength(1);
});

test('방 밖에서는 시작되지 않고, 방 사각형(경계 포함)에 들어서는 스텝에 limit 24 로 시작하며 그 스텝에는 시간이 흐르지 않는다', () => {
  const f = opened(), r = ring(f), room = roomOf(f, 7);
  const hx = room.w / 2, hz = room.h / 2;
  at(f, 6); run(f, 3, .5);
  expect(r.phase).toBe('open'); expect(r.clock).toBe(3); expect(r.elapsed).toBe(0); expect(r.left).toBe(24);
  for (const [dx, dz] of [[-hx - .01, 0], [hx + .01, 0], [0, hz + .01], [0, -hz - .01]]) { at(f, 7, dx, dz); f.route.update(f.g, .25); expect(r.phase).toBe('open'); }
  at(f, 7, -hx, hz);                                                                      // 모서리 경계 포함
  f.messages.length = 0; f.route.update(f.g, .25);
  expect(r.phase).toBe('running'); expect(r.limit).toBe(24); expect(r.left).toBe(24); expect(r.elapsed).toBe(0);
  expect(f.messages).toContain('외곽 고리 이탈 시작 · 24초');
  expect(f.route.hint()).toBe('외곽 고리 이탈 · 항로 표지 0/3 · 기록 파편이 모이면 중심 밖으로 · 24초');
  f.route.update(f.g, .25);
  expect(r.elapsed).toBe(.25); expect(r.left).toBe(23.75);
});

test('항로 표지: 중심 1.4 안에서 1초 머물면 점등, 벗어나면 그 표지 유지 초기화, 순서 자유, 점등한 표지는 유지된다', () => {
  const f = running(), r = ring(f);
  atMark(f, 2, 1.4); f.route.update(f.g, .5);                                             // 경계 포함
  expect(r.held).toBe(2); expect(r.marks[2].hold).toBeCloseTo(.5);
  atMark(f, 2, 1.41); f.route.update(f.g, .25);
  expect(r.held).toBe(-1); expect(r.marks[2].hold).toBe(0); expect(r.purified).toBe(0);
  atMark(f, 2); f.route.update(f.g, .75); expect(r.purified).toBe(0); expect(r.marks[2].done).toBe(false);
  f.messages.length = 0; f.route.update(f.g, .25);
  expect(r.purified).toBe(1); expect(r.marks[2].done).toBe(true); expect(r.held).toBe(-1);
  expect(f.messages).toEqual(['항로 표지 점등 · 1/3']);
  expect(f.route.hint()).toMatch(/^외곽 고리 이탈 · 항로 표지 1\/3 · 기록 파편이 모이면 중심 밖으로 · \d+초$/);
  // 점등한 표지 위에 다시 서도 유지로 세지 않는다. 순서는 자유(동 → 서 → 북).
  f.route.update(f.g, 1); expect(r.held).toBe(-1); expect(r.purified).toBe(1);
  atMark(f, 0); f.route.update(f.g, 1); expect(r.purified).toBe(2);
  expect(r.marks.map((m: any) => m.done)).toEqual([true, false, true]);
  expect(r.phase).toBe('running'); expect(f.route.canUnseal()).toBe(false);
  // 한 표지의 유지는 다른 표지로 옮기면 이어지지 않는다.
  atMark(f, 1); f.route.update(f.g, .5); atMark(f, 0); f.route.update(f.g, .5); atMark(f, 1); f.route.update(f.g, .5);
  expect(r.purified).toBe(2); expect(r.marks[1].hold).toBeCloseTo(.5);
});

test('집결 위상: 1.5초부터 5초 주기로 예고 2초 → 터짐 .5초이고, 같은 cycle 은 한 번만 피해를 주며, 경계 포함 반경 3.2', () => {
  const f = opened(); at(f, 7, SAFE[0], SAFE[1]);
  const r = ring(f), clock = () => r.clock;
  const seen: [number, string, number, number][] = [];
  const probe = (dt: number) => { f.route.update(f.g, dt); seen.push([clock(), r.shard.state, r.shard.cycle, r.shard.age]); };
  probe(.25);                                                                              // 시작 스텝 clock .25
  while (clock() < 11.75 - 1e-9) probe(.25);
  const at_ = (t: number) => seen.find(s => Math.abs(s[0] - t) < 1e-9)!;
  expect(at_(1.25).slice(1, 3)).toEqual(['calm', -1]);
  expect(at_(1.5).slice(1, 3)).toEqual(['warning', 0]); expect(at_(3.25).slice(1, 3)).toEqual(['warning', 0]);
  expect(at_(3.5).slice(1, 3)).toEqual(['burst', 0]); expect(at_(3.75).slice(1, 3)).toEqual(['burst', 0]);
  expect(at_(4).slice(1, 3)).toEqual(['calm', 0]); expect(at_(6.25).slice(1, 3)).toEqual(['calm', 0]);
  expect(at_(6.5).slice(1, 3)).toEqual(['warning', 1]); expect(at_(8.25).slice(1, 3)).toEqual(['warning', 1]);
  expect(at_(8.5).slice(1, 3)).toEqual(['burst', 1]); expect(at_(9).slice(1, 3)).toEqual(['calm', 1]);
  expect(at_(11.5).slice(1, 3)).toEqual(['warning', 2]);
  expect(at_(2.25)[3]).toBeCloseTo(.75); expect(at_(3.75)[3]).toBeCloseTo(.25);
  expect(f.hurts).toHaveLength(0);                                                         // 중심 밖이면 피해 없음
  // 피해는 터지는 동안 중심 반경 3.2(경계 포함) 안에서 집결마다 한 번.
  const g = opened(); at(g, 7, SAFE[0], SAFE[1]); g.route.update(g.g, .25);
  at(g, 7, 3.2, 0); run(g, 3.25 - .25, .25);                                               // clock 3.25: 아직 예고
  expect(g.hurts).toHaveLength(0);
  g.route.update(g.g, .25);                                                                // clock 3.5: 터짐 시작
  expect(g.hurts).toHaveLength(1); expect(g.hurts[0].n).toBeCloseTo(4, 10); expect(g.hurts[0]).toMatchObject({ kb: 0, kind: 'magic' });
  expect(ring(g).shardHits).toBe(1); expect(g.messages).toContain('기록 파편 집결 피격 · 기록 파편이 모이면 중심 밖으로');
  g.route.update(g.g, .25); expect(g.hurts).toHaveLength(1);                               // 같은 cycle 두 번째 스텝
  run(g, 3, .25); expect(g.hurts).toHaveLength(1);                                         // 터짐 끝나고 calm
  run(g, 2, .25);                                                                          // cycle 1 터짐(clock 8.5~9)
  expect(g.hurts).toHaveLength(2); expect(ring(g).shardHits).toBe(2);
  // 반경 밖(3.21)은 맞지 않는다.
  const h = opened(); at(h, 7, SAFE[0], SAFE[1]); h.route.update(h.g, .25);
  at(h, 7, 3.21, 0); run(h, 12, .25); expect(h.hurts).toHaveLength(0);
});

test('고리 위 표지 사이 직선은 안전하다: 이웃한 표지를 잇는 직선은 중심 반경 밖이다', () => {
  const f = running(), marks = ring(f).marks, c = ring(f).center;
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i].pos, b = marks[i + 1].pos;
    for (let k = 0; k <= 20; k++) {
      const x = a.x + (b.x - a.x) * k / 20, z = a.z + (b.z - a.z) * k / 20;
      expect(Math.hypot(x - c.x, z - c.z)).toBeGreaterThan(RING.core);
    }
  }
});

test('core 경계: 중심에서 정확히 core(부동소수 오차 안) 떨어진 자리는 맞고, 그보다 조금 밖은 맞지 않는다', () => {
  const hit = (extra: number) => {
    const f = opened(); at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25);
    const r = ring(f);
    while (r.shard.state !== 'burst') { f.g.player.pos.set(r.center.x + RING.core + extra, 0, r.center.z); f.route.update(f.g, 1 / 60); }
    f.g.player.pos.set(r.center.x + RING.core + extra, 0, r.center.z); f.route.update(f.g, 1 / 60);
    return [Math.hypot(f.g.player.pos.x - r.center.x, f.g.player.pos.z - r.center.z), r.shardHits];
  };
  const [d0, h0] = hit(5e-10), [d1, h1] = hit(1e-6);
  expect(d0).toBeGreaterThanOrEqual(RING.core); expect(h0).toBe(1);
  expect(d1).toBeGreaterThan(RING.core + 1e-7); expect(h1).toBe(0);
});

test('회피 무적·완벽 방어로 피해가 흡수되면(hurt false) 파편 피격으로 세지 않고 알리지 않으며, 같은 집결에서 다시 맞지 않는다', () => {
  const f = opened(); at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25);
  const r = ring(f); let calls = 0;
  f.g.player.hurt = () => { calls++; return false; };
  while (r.shard.state !== 'burst') f.route.update(f.g, 1 / 60);
  at(f, 7);
  const cycle = r.shard.cycle;
  while (r.shard.state === 'burst' && r.shard.cycle === cycle) f.route.update(f.g, 1 / 60);
  expect(calls).toBe(1); expect(r.shardHits).toBe(0);
  expect(f.messages.some(m => m.includes('집결 피격'))).toBe(false);
});

test('붕괴: 시간이 다 되면 최대 체력 4% 피해, 표지 0/3, 시간 24초 다시, 진행은 막히지 않는다', () => {
  const f = running(), r = ring(f);
  atMark(f, 0); f.route.update(f.g, 1);
  expect(r.purified).toBe(1);
  at(f, 7, SAFE[0], SAFE[1]);
  f.messages.length = 0;
  while (r.left > .5 + 1e-9) f.route.update(f.g, .25);
  expect(r.collapses).toBe(0); expect(r.purified).toBe(1);
  f.route.update(f.g, .25); expect(r.collapses).toBe(0);
  f.route.update(f.g, .25);
  expect(r.collapses).toBe(1); expect(r.purified).toBe(0); expect(r.left).toBe(24); expect(r.phase).toBe('running');
  expect(r.marks.every((m: any) => !m.done && m.hold === 0)).toBe(true);
  expect(f.hurts).toHaveLength(1); expect(f.hurts[0].n).toBeCloseTo(4, 10); expect(f.hurts[0]).toMatchObject({ kb: 0, kind: 'magic' });
  expect(f.messages).toContain('외곽 고리 붕괴 · 항로 표지가 흐려졌습니다 · 다시 24초');
  expect(r.elapsed).toBeGreaterThan(23.5);
  // 다시 점등할 수 있다.
  for (const i of [0, 1, 2]) { atMark(f, i); f.route.update(f.g, 1); }
  expect(r.phase).toBe('done'); expect(r.collapses).toBe(1);
});

test('같은 스텝에서 완료가 붕괴보다 먼저다: 남은 시간이 정확히 바닥나는 스텝에 마지막 표지가 켜지면 붕괴하지 않는다', () => {
  const f = running(), r = ring(f);
  for (const i of [0, 1]) { atMark(f, i); f.route.update(f.g, 1); }                        // elapsed 2
  at(f, 7, SAFE[0], SAFE[1]); run(f, 21, .25);                                             // elapsed 23, left 1
  expect(r.left).toBeCloseTo(1, 9); expect(r.purified).toBe(2);
  atMark(f, 2); f.route.update(f.g, 1);                                                    // hold 1 과 left 0 이 같은 스텝
  expect(r.left).toBeLessThanOrEqual(1e-9);                                                // 정말 같은 스텝에 시간이 바닥났다
  expect(r.phase).toBe('done'); expect(r.collapses).toBe(0); expect(f.hurts).toHaveLength(0);
});

test('완료 전에는 봉인이 유지되고, 표지 3개를 점등하면 완료 스텝에 실제 Battle 봉인이 풀린다', () => {
  const f = fixture(); untilRoomSeven(f); clearRoom(f, 7);
  flush(f); f.g.unsealBoss();                                                              // Battle.markCleared 의 지연 해제 시도 포함
  expect(f.world.sealed).toBe(true);
  at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25); f.route.update(f.g, .25);
  expect(ring(f).phase).toBe('running');
  for (const i of [0, 1]) { atMark(f, i); f.route.update(f.g, 1); }
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true); expect(f.counts.portal).toBe(0);
  expect(f.route.canUnseal()).toBe(false);
  f.messages.length = 0; atMark(f, 2); f.route.update(f.g, 1);
  expect(ring(f).phase).toBe('done'); expect(f.world.sealed).toBe(false); expect(f.counts.portal).toBe(1);
  // 마지막 표지는 완료 토스트 하나로만 알린다(같은 순간 '항로 표지 점등 · 3/3' 을 따로 내지 않는다).
  expect(f.messages[0]).toBe('외곽 고리 이탈 · 레비아탄의 봉인이 풀립니다');
  expect(f.messages).not.toContain('항로 표지 점등 · 3/3');
  expect(f.messages).toContain('보스의 봉인이 풀렸다!');
  expect(f.route.canUnseal()).toBe(true); expect(f.route.hint()).toBe('별자리 4/4 복원 · 레비아탄 처치');
  // 완료 뒤에는 상태가 더 바뀌지 않는다.
  const snapshot = JSON.stringify([ring(f).clock, ring(f).elapsed, ring(f).shardHits, ring(f).collapses]);
  at(f, 7); run(f, 20, .5);
  expect(JSON.stringify([ring(f).clock, ring(f).elapsed, ring(f).shardHits, ring(f).collapses])).toBe(snapshot);
  expect(f.hurts).toHaveLength(0); expect(f.route.ownsHazards(roomOf(f, 7))).toBe(false); expect(f.route.autoGoal()).toBeNull();
});

test('ownsHazards·AUTO 목표: 고리가 열려 있거나 도는 동안만 고리 방을 맡고, 가장 가까운 미점등 표지(같은 거리면 배열 순서 앞)로 향한다', () => {
  const f = fixture(), seven = roomOf(f, 7);
  expect(f.route.ownsHazards(seven)).toBe(false); expect(f.route.autoGoal()).toBeNull();
  const g = opened(), marks = ring(g).marks;
  expect(g.route.ownsHazards(roomOf(g, 7))).toBe(true); expect(g.route.ownsHazards(roomOf(g, 6))).toBe(false);
  at(g, 6); g.route.update(g.g, .25);
  expect(g.route.autoGoal()).toBe(marks[0].pos);                                           // 서쪽 문 쪽에서 가장 가깝다
  at(g, 7, 0, 3); g.route.update(g.g, .25);                                                // 서·동 표지가 같은 거리(6.7) → 첫 번째
  expect(ring(g).phase).toBe('running'); expect(g.route.autoGoal()).toBe(marks[0].pos); expect(g.route.ownsHazards(roomOf(g, 7))).toBe(true);
  atMark(g, 0); g.route.update(g.g, 1);                                                    // 서쪽 점등: 북(8.5)이 동(12)보다 가깝다
  expect(g.route.autoGoal()).toBe(marks[1].pos);
  atMark(g, 1); g.route.update(g.g, 1); expect(g.route.autoGoal()).toBe(marks[2].pos);
  atMark(g, 2); g.route.update(g.g, 1); expect(g.route.autoGoal()).toBeNull(); expect(g.route.ownsHazards(roomOf(g, 7))).toBe(false);
  const h = running(); h.route.stop(); expect(h.route.autoGoal()).toBeNull(); expect(h.route.ownsHazards(roomOf(h, 7))).toBe(false);
});

test('일시정지·영웅 사망·보스 처치·비활성·월드 교체·dt 무효·종료에서는 고리가 진행하지 않는다', () => {
  for (const cause of ['paused', 'dead', 'boss', 'inactive', 'world', 'dt0', 'dtNaN', 'stop']) {
    const f = running(), r = ring(f);
    f.route.update(f.g, .5);
    const snap = JSON.stringify([r.clock, r.elapsed, r.left, r.marks.map((m: any) => m.hold)]);
    atMark(f, 1);
    if (cause === 'paused') f.g.paused = true; if (cause === 'dead') f.g.player.alive = false; if (cause === 'boss') f.g.bossDefeated = true;
    if (cause === 'inactive') f.g.active = false; if (cause === 'world') f.g.world = {}; if (cause === 'stop') f.route.stop();
    f.route.update(f.g, cause === 'dt0' ? 0 : cause === 'dtNaN' ? NaN : 5);
    expect(JSON.stringify([r.clock, r.elapsed, r.left, r.marks.map((m: any) => m.hold)])).toBe(snap);
    expect(r.purified).toBe(0); expect(f.hurts).toHaveLength(0);
  }
});

test('보고: 완료한 런은 조율판 보고에 고리 결과가 더해지고, 한 번 만든 보고는 바뀌지 않는다', () => {
  const f = fixture(); untilRoomSeven(f); clearRoom(f, 7);
  at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25); f.route.update(f.g, .25);
  atMark(f, 0); f.route.update(f.g, 1);
  at(f, 7, 0, 0);
  run(f, 2.5, .25);                                                                        // clock 3.5~4 의 터짐(2.5 + .25 + 1 + ...)에 한 번 맞음
  expect(ring(f).shardHits).toBe(1);
  for (const i of [1, 2]) { atMark(f, i); f.route.update(f.g, 1); }
  expect(ring(f).phase).toBe('done');
  f.world.bossRoom.cleared = true; f.g.bossDefeated = true; f.g.victory();
  const report = f.g.result.routeObjective;
  expect(report).toMatchObject({ id: 'astral_constellations_standard', complete: true, progress: 4, target: 4, mistakes: 0, rooms: GATES });
  expect(report.constellations.map((c: any) => [c.stationId, c.roomId, c.choice])).toEqual(
    [[1, 1, 'triangle'], [2, 3, 'diamond'], [3, 4, 'circle'], [4, 6, 'triangle']]);
  expect(report.ring).toEqual({ purified: true, marks: 3, collapses: 0, shardHits: 1, seconds: report.ring.seconds });
  expect(report.ring.seconds).toBeGreaterThan(3);
  expect(Object.keys(report).sort()).toEqual(['complete', 'constellations', 'id', 'mistakes', 'progress', 'ring', 'rooms', 'target']);
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.ring)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  ring(f).collapses = 9; expect(f.route.finish(false)).toBe(report); expect(f.route.finish(true).ring.collapses).toBe(0);
});

test('패배 보고: 고리 도중 패배는 완료로 바뀌지 않고 실제 점등·붕괴·피격만 센다', () => {
  const f = running(), r = ring(f);
  atMark(f, 0); f.route.update(f.g, 1);
  at(f, 7, SAFE[0], SAFE[1]); run(f, 24, .25);                                             // 붕괴 1회로 표지 0/3
  atMark(f, 1); f.route.update(f.g, 1);
  expect(r.collapses).toBeGreaterThanOrEqual(1);
  f.g.defeat();
  const report = f.g.result.routeObjective;
  expect(report.complete).toBe(false); expect(report.progress).toBe(4);
  expect(report.ring).toEqual({ purified: false, marks: 1, collapses: r.collapses, shardHits: 0, seconds: report.ring.seconds });
  f.g.active = true; atMark(f, 2); for (let i = 0; i < 5; i++) f.route.update(f.g, 1);
  expect(f.route.finish(true)).toBe(report); expect(report.ring.marks).toBe(1);
  // 조율판 도중 패배: 고리는 시작도 하지 않았다.
  const g = fixture(); restore(g, 0); g.g.defeat();
  expect(g.g.result.routeObjective).toMatchObject({ complete: false, progress: 1, rooms: [1], ring: { purified: false, marks: 0, collapses: 0, shardHits: 0, seconds: 0 } });
});

/* ------------------------------------------------------------ 문구 틀 (일반·심층) ------------------------------------------------------------ */

// 두 정의의 문구를 글자 그대로 적는다(틀 함수가 아니라 기대 문자열). 심층 줄은 B12 문구 그대로여야 한다.
const COPY: Record<string, any> = {
  standard: {
    n: 3, label: '기록 외곽 고리', done4: '모든 별자리 복원 · 모든 구역을 정화하면 기록 외곽 고리가 열립니다',
    open: '기록 외곽 고리 개방 · 고리 위 항로 표지 3개를 밝히세요', start: '외곽 고리 이탈 시작 · 24초',
    mark: ['항로 표지 점등 · 1/3', '항로 표지 점등 · 2/3'],
    hit: '기록 파편 집결 피격 · 기록 파편이 모이면 중심 밖으로', collapse: '외곽 고리 붕괴 · 항로 표지가 흐려졌습니다 · 다시 24초',
    done: '외곽 고리 이탈 · 레비아탄의 봉인이 풀립니다', hintOpen: '외곽 고리 이탈 · 기록 외곽 고리로 이동',
    hintRun: (k: number, s: number) => '외곽 고리 이탈 · 항로 표지 ' + k + '/3 · 기록 파편이 모이면 중심 밖으로 · ' + s + '초',
  },
  deep: {
    n: 4, label: '성좌 외곽 고리', done4: '모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다',
    open: '성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요', start: '외곽 고리 정화 시작 · 20초',
    mark: ['성표 정화 · 1/4', '성표 정화 · 2/4', '성표 정화 · 3/4'],
    hit: '파편 집결 피격 · 파편이 모이면 중심 밖으로', collapse: '외곽 고리 붕괴 · 성표가 흐려졌습니다 · 다시 20초',
    done: '외곽 고리 정화 · 레비아탄의 봉인이 풀립니다', hintOpen: '외곽 고리 정화 · 성좌 외곽 고리로 이동',
    hintRun: (k: number, s: number) => '외곽 고리 정화 · 성표 ' + k + '/4 · 파편이 모이면 중심 밖으로 · ' + s + '초',
  },
};

for (const depth of ['standard', 'deep']) {
  test('문구 틀 (' + depth + '): 4/4 · 열림 · 시작 · 피격 · 점등 · 붕괴 · 완료 토스트와 안내 문구가 정의의 낱말로 나온다', () => {
    const c = COPY[depth], f = fixture({ depth }), n = f.route.gates.length;
    for (let i = 0; i < n - 1; i++) restore(f, i);
    clearZones(f, [7]); clearRoom(f, 7);
    f.messages.length = 0;
    restore(f, n - 1);
    expect(f.messages.filter(m => m === c.done4)).toHaveLength(1);
    expect(f.route.hint()).toBe('별자리 4/4 복원 · 남은 구역 정화');
    f.messages.length = 0;
    at(f, 6); f.route.update(f.g, .25);
    expect(f.messages).toEqual([c.open]); expect(f.route.hint()).toBe(c.hintOpen);
    f.messages.length = 0;
    const r = ring(f), limit = r.limit;
    at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25);
    expect(f.messages).toEqual([c.start]); expect(f.route.hint()).toBe(c.hintRun(0, limit));
    // 터지는 동안 중심에 서서 한 번 맞는다.
    f.messages.length = 0;
    while (r.shard.state !== 'burst') f.route.update(f.g, .25);
    at(f, 7); f.route.update(f.g, .25);
    expect(f.messages).toEqual([c.hit]);
    // 첫 표지 점등 → 시간 초과 붕괴 → 다시 전부 점등.
    f.messages.length = 0; atMark(f, 0); f.route.update(f.g, 1);
    expect(f.messages).toEqual([c.mark[0]]); expect(f.route.hint()).toBe(c.hintRun(1, Math.ceil(r.left - 1e-9)));
    f.messages.length = 0; at(f, 7, SAFE[0], SAFE[1]);
    while (r.collapses === 0) f.route.update(f.g, .25);
    expect(f.messages).toEqual([c.collapse]); expect(f.route.hint()).toBe(c.hintRun(0, limit));
    f.messages.length = 0;
    for (let i = 0; i < c.n; i++) { atMark(f, i); f.route.update(f.g, 1); }
    expect(f.messages.filter(m => m !== '보스의 봉인이 풀렸다!')).toEqual([...c.mark.slice(0, c.n - 1), c.done]);
    expect(f.route.hint()).toBe('별자리 4/4 복원 · 레비아탄 처치');
  });
}

/* ------------------------------------------------------------ 무할당 ------------------------------------------------------------ */

/** 프레임 루프 무할당 관찰: Vector3·Array 생성자 호출을 센다(Vector3 는 생성자의 prototype.isVector3 대입, Array 는 전역 감싸개). */
function countConstructors(body: () => void) {
  const proto = Vector3.prototype as any, saved = Object.getOwnPropertyDescriptor(proto, 'isVector3');
  const realArray = globalThis.Array, counts = { vector: 0, array: 0 };
  Object.defineProperty(proto, 'isVector3', { configurable: true, get: () => true, set: () => { counts.vector++; } });
  const wrapFn = (key: 'from' | 'of') => (...args: any[]) => { counts.array++; return (realArray as any)[key](...args); };
  (globalThis as any).Array = new Proxy(realArray, {
    apply: (target, self, args) => { counts.array++; return Reflect.apply(target, self, args); },
    construct: (target, args, newTarget) => { counts.array++; return Reflect.construct(target, args, newTarget === receiverOf ? target : newTarget); },
    get: (target, key) => (key === 'from' || key === 'of') ? wrapFn(key) : Reflect.get(target, key, target),
  });
  const receiverOf = (globalThis as any).Array;
  try { body(); } finally {
    (globalThis as any).Array = realArray;
    if (saved) Object.defineProperty(proto, 'isVector3', saved); else delete proto.isVector3;
  }
  return counts;
}

test('무할당 관찰 도구 자체 검사: 생성자 호출을 실제로 센다', () => {
  const c = countConstructors(() => { new Vector3(); new Vector3(1, 2, 3); new Array(3); Array.from([1]); Array(2); });
  expect(c).toEqual({ vector: 2, array: 3 });
  expect(countConstructors(() => { [1, 2].map(x => x); })).toEqual({ vector: 0, array: 0 });
});

/** 가비지 수집 직후 살아 있는 객체 수를 재고, 수집 없이 steps 번 update 한 뒤 다시 잰다. 늘어난 수 = 그 동안 만든 객체(쓰레기 포함). */
/** 터짐(.5초) 안에서 수천 스텝을 재도록 아주 작은 dt 를 쓴다. 이 구간에서는 안내 문구의 올림 초가 바뀌지 않는다. */
const TINY = 1 / 16384;
function allocPerUpdate(f: F, steps: number) {
  const count = () => { const t: any = heapStats().objectTypeCounts; return { o: (t.Object || 0) + (t.Array || 0) + (t.Function || 0), s: (t.string || 0) + (t.String || 0) }; };
  // 코드 최적화·첫 호출 준비로 생기는 일회성 객체가 섞이지 않도록 먼저 같은 길을 돌려 둔다.
  for (let i = 0; i < 1500; i++) f.route.update(f.g, TINY);
  // 측정 자체(heapStats 호출)가 남기는 객체를 0 스텝으로 재서 뺀다.
  Bun.gc(true); const z0 = count(); const z1 = count();
  Bun.gc(true); const a = count();
  for (let i = 0; i < steps; i++) f.route.update(f.g, TINY);
  const b = count();
  return { objects: (b.o - a.o - (z1.o - z0.o)) / steps, strings: (b.s - a.s - (z1.s - z0.s)) / steps };
}

test('무할당: 열림 · 도는 중(예고·터짐 포함) · 완료 · 4/4 뒤 구역 대기에서 update 가 Vector3·Array 를 만들지 않고 스텝마다 객체·문자열을 쌓지 않는다', () => {
  const idle = fixture(); restoreAll(idle); clearZones(idle, [7]); idle.route.update(idle.g, .1);
  const open = opened();
  const warn = running(); run(warn, 2, .25);                                              // 예고(1.5~3.5) 안
  const burst = running(); run(burst, 3.25, .25);                                         // clock 3.5: 터짐(3.5~4.0) 시작. 영웅은 안전한 자리
  const done = fixture(); untilRoomSeven(done); clearRoom(done, 7); at(done, 7, SAFE[0], SAFE[1]); done.route.update(done.g, .25); done.route.update(done.g, .25);
  for (const i of [0, 1, 2]) { atMark(done, i); done.route.update(done.g, 1); }
  expect([ring(idle).phase, ring(open).phase, ring(warn).phase, ring(burst).phase, ring(done).phase]).toEqual(['idle', 'open', 'running', 'running', 'done']);
  const states: Record<string, F> = { idle, open, warn, burst, done };
  for (const [name, f] of Object.entries(states)) {
    // 부모 observePlayer 포함: 수백 스텝, 영웅은 같은 자리(안전).
    const c = countConstructors(() => { for (let i = 0; i < 400; i++) f.route.update(f.g, TINY); });
    expect([name, c]).toEqual([name, { vector: 0, array: 0 }]);
  }
  for (const [name, f] of Object.entries(states)) {
    const m = allocPerUpdate(f, 3000);
    // 한 스텝에 객체나 문자열을 하나라도 새로 만들면 3000 스텝에 1000 이상 늘어난다. 1/100 이하만 허용한다(계측 잡음).
    expect([name, m.objects <= .01, m.strings <= .01]).toEqual([name, true, true]);
  }
  expect(ring(burst).shard.state).toBe('burst');                                           // 터짐 구간 안에서 쟀다
});

/* ------------------------------------------------------------ AUTO 모의 ------------------------------------------------------------ */

// 영웅 속도: src/data/heroes.js base.spd — mage 5.6(가장 느림), barbarian 5.8, knight 6.2, ranger 6.6, rogue 7.2(가장 빠름).
const SLOW = HEROES.mage.base.spd, FAST = HEROES.rogue.base.spd;
test('AUTO 모의 속도의 근거: 가장 느린 영웅 5.6, 가장 빠른 영웅 7.2', () => {
  const speeds = Object.values(HEROES).map((h: any) => h.base.spd);
  expect(Math.min(...speeds)).toBe(5.6); expect(Math.max(...speeds)).toBe(7.2);
  expect([SLOW, FAST]).toEqual([5.6, 7.2]);
});

/** 실제 Player.autoExplore 와 실제 Floor 이동 지도로 영웅을 한 걸음 옮긴다(속도 × dt, 벽은 Floor.resolve). 판정은 실제 규칙 update. */
function autoStep(f: F, speed: number, dt: number) {
  f.route.update(f.g, dt);
  const move = Player.prototype.autoExplore.call(f.g.player, dt), pos = f.g.player.pos;
  const [x, z] = f.world.resolve(pos.x, pos.z, pos.x + move.x * speed * dt, pos.z + move.y * speed * dt, .6); pos.set(x, 0, z);
}

test('AUTO 모의(조율판): 실제 일반판 Floor 에서 영웅이 모든 방에서 출발해도 1 → 3 → 4 → 6 조율판을 단서 → 정답 판 → 복원까지 끝낸다(적 없음, 오답·피해 없음)', () => {
  const dt = 1 / 30;
  for (const speed of [SLOW, FAST]) for (let index = 0; index < 4; index++) for (let start = 0; start <= 7; start++) {
    const f = fixture(); f.g.player.auto = true;
    for (let k = 0; k < index; k++) restore(f, k);
    clearRoom(f, f.route.gates[index].room.id);
    expect(f.route.gates[index].ready).toBe(true);
    at(f, start); f.g.autoTarget = f.route.autoRoom();
    let t = 0;
    while (f.route.progress === index && t < 120) { autoStep(f, speed, dt); t += dt; }
    const label = 'gate ' + index + ' (room ' + GATES[index] + ') from room ' + start + ' @' + speed;
    expect([label, f.route.progress]).toEqual([label, index + 1]);
    expect(f.route.mistakes).toBe(0); expect(f.hurts).toHaveLength(0);
  }
}, 120000);
