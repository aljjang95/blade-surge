// 성운 첨탑 심층(BUNDLE-12): 성좌 4곳(방 3 → 2 → 5 → 6, 일반판 조율판 엔진 규칙)과 4/4·모든 구역 뒤 열리는 성좌 외곽 고리 정화(방 7).
// 방 입장·증원·정화·봉인·보물방 보상은 실제 Battle 코드를 쓰고, 영웅 위치와 시간만 테스트가 정한다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { EXPEDITION_CONQUESTS, conquestForRun } from '../src/data/expedition-conquests.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { AstralConstellations } from '../src/game/astral-constellations.js';
import { AstralDeepConstellations } from '../src/game/astral-deep-constellations.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';
import { HEROES } from '../src/data/heroes.js';

const noop = () => {};
const DEEP = ROUTE_OBJECTIVES.astral_deep;
const RING = DEEP.ring;
const ORDER = [3, 2, 5, 6];

function fixture(opts: { depth?: string; mushroom?: boolean; noRoute?: boolean } = {}) {
  const stage = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null, { depth: opts.depth || 'deep' });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], banners: string[] = [], hurts: any[] = [], spawns: any[] = [];
  const counts = { portal: 0, objective: 0 };
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, sp: { clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    scene: new Scene(),
    ui: { toast: (text: string) => messages.push(text), waveBanner: (text: string) => banners.push(text),
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
  return { g, world, route, messages, banners, hurts, spawns, counts, stage };
}
type F = ReturnType<typeof fixture>;
const roomOf = (f: F, id: number): any => f.world.rooms[id];
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id);
const ring = (f: F) => f.route.ring;
const at = (f: F, id: number, dx = 0, dz = 0) => { const r = roomOf(f, id); f.g.player.pos.set(r.x + dx, 0, r.z + dz); };
const atMark = (f: F, i: number, dx = 0, dz = 0) => { const p = ring(f).marks[i].pos; f.g.player.pos.set(p.x + dx, 0, p.z + dz); };
const hurtsOf = (f: F) => f.hurts.map(h => h.n);
const flush = (f: F) => { for (const timer of f.g.timers.splice(0)) timer.fn(); };
/** 실제 입장 → 처치 → 정화 시도를 되풀이해 방을 정화하거나(성좌 방은 준비될 때까지) 증원 단계를 모두 겪는다. */
function clearRoom(f: F, id: number) {
  const room = roomOf(f, id), gate = f.route ? gateOf(f, id) : null;
  f.g.enterRoom(room); flush(f);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
  return room;
}
/** 지금 차례인 성좌를 복원한다: 정리 → 단서 1초 → 정답 판 1초 + 다음 유효 프레임. */
function restore(f: F, index = f.route.progress) {
  const gate = f.route.gates[index];
  clearRoom(f, gate.room.id);
  f.g.player.pos.copy(gate.pos); f.route.update(f.g, 1);
  f.g.player.pos.copy(gate.pads.find((p: any) => p.id === gate.answer).pos);
  f.route.update(f.g, .99); f.route.update(f.g, .01); f.route.update(f.g, .01);
  expect(f.route.progress).toBe(index + 1);
  return gate;
}
function restoreAll(f: F) { for (let i = 0; i < 4; i++) restore(f, i); }
/** 성좌 4곳을 복원하고 방 1·4 를 정화한다. 방 7 만 남는다. */
function untilRoomSeven(f: F) { restoreAll(f); clearRoom(f, 1); clearRoom(f, 4); }
/** 고리를 연 상태(영웅은 방 6 중심, 열리는 스텝 직후). */
function opened(where: [number, number, number] = [6, 0, 0]) {
  const f = fixture(); untilRoomSeven(f); clearRoom(f, 7); at(f, ...where); f.messages.length = 0;
  f.route.update(f.g, 1 / 60);
  expect(ring(f).phase).toBe('open');
  return f;
}
/** 고리가 도는 상태: 방 안 안전한 자리(중심에서 4.6, 북쪽 성표와 서쪽 성표에서 먼 곳)로 들어서 시작한다. */
const SAFE: [number, number] = [-4.2, 4.2];
function running() {
  const f = opened(); at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25);
  expect(ring(f).phase).toBe('running');
  return f;
}
function run(f: F, seconds: number, dt = .25) { for (let t = 0; t < seconds - 1e-9; t += dt) f.route.update(f.g, dt); }

test('정의: 성좌는 방 3 → 2 → 5 → 6, 고리는 정예방 7 이고 일반 성운은 그대로 AstralConstellations', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(DEEP);
  expect(f.route).toBeInstanceOf(AstralDeepConstellations);
  expect(f.route).toBeInstanceOf(AstralConstellations);
  expect(f.world.rooms.map((r: any) => r.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'elite', 'treasure', 'normal', 'elite', 'boss']);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual(ORDER);
  expect(f.route.gates.map((g: any) => g.stationId)).toEqual([1, 2, 3, 4]);
  expect(f.route.gates.map((g: any) => g.room.label)).toEqual(['1번 성좌 · 끊어진 별길', '2번 성좌 · 되돌아온 빛', '3번 성좌 · 가라앉은 닻별', '4번 성좌 · 귀환 좌표']);
  expect(f.route.gates.map((g: any) => g.answer)).toEqual(['circle', 'diamond', 'triangle', 'circle']);
  const r = ring(f), room = roomOf(f, 7);
  expect(r.room).toBe(room); expect(room.label).toBe('성좌 외곽 고리');
  expect([room.w, room.h]).toEqual([22, 24]);
  expect(r).toMatchObject({ phase: 'idle', clock: 0, limit: 20, elapsed: 0, collapses: 0, shardHits: 0, purified: 0, held: -1,
    minX: room.x - 11, maxX: room.x + 11, minZ: room.z - 12, maxZ: room.z + 12 });
  expect(r.center.toArray()).toEqual([room.x, 0, room.z]);
  expect(r.marks.map((m: any) => [m.pos.x - room.x, m.pos.z - room.z])).toEqual([[-6, 0], [0, -6], [6, 0], [0, 6]]);
  expect(r.marks.every((m: any) => m.hold === 0 && m.done === false)).toBe(true);
  expect(r.shard).toEqual({ state: 'calm', age: 0, cycle: -1 });
  expect(f.route.autoGoal()).toBeNull(); expect(f.route.canUnseal()).toBe(false); expect(f.route.canWin()).toBe(false);
  expect(f.route.coexistsAttunement).toBe(false);
  expect(f.world.rooms.some((x: any) => f.route.allowsAttunement(x))).toBe(false);
  // 일반 성운 첨탑은 그대로 부모 클래스다.
  const standard = fixture({ depth: 'standard' });
  expect(standard.route.constructor).toBe(AstralConstellations);
  expect(standard.route.ring).toBeUndefined();
});

test('파티·균열·전술 공략·알 수 없는 난이도는 목표를 만들지 않고 이 원정에는 전술 공략 자체가 없다', () => {
  const f = fixture(), base = f.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    ...[{ kind: 'arena' }, { riftId: 'x' }, { conquestId: 'x' }, { depth: 'unknown' }, { id: 'star_archive' }]
      .map(extra => ({ ...base, expedition: { ...base.expedition, ...extra } }))]) {
    expect(routeObjectiveForStage(stage)).not.toBe(DEEP);
  }
  expect(createRouteObjectives({ ...base, party: {} }, f.world)).toBeNull();
  expect(createRouteObjectives({ ...base, expedition: { ...base.expedition, conquestId: 'x' } }, f.world)).toBeNull();
  // 전술 공략이 없으므로 conquestTactic 도 두지 않는다. 있는 공략 id 를 이 원정에 쓰면 거절된다.
  expect(EXPEDITION_CONQUESTS.some(c => c.dungeonId === 'astral_leviathan_spire')).toBe(false);
  for (const c of EXPEDITION_CONQUESTS) expect(conquestForRun('astral_leviathan_spire', 'deep', c.id)).toBeNull();
  expect(() => buildExpeditionStage('dungeon', 'astral_leviathan_spire', null, { depth: 'deep', conquestId: 'vault_signal' })).toThrow(RangeError);
});

test('잘못된 고리 정의는 생성 때 RangeError 로 거절된다', () => {
  const f = fixture();
  const make = (ring: any, world: any = buildExpeditionWorld(f.stage)) => new AstralDeepConstellations({ ...DEEP, ring: ring && { ...RING, ...ring } } as any, world);
  expect(() => make({})).not.toThrow();
  for (const roomId of [0, 8, 3, 2, 5, 6, 99]) expect(() => make({ roomId })).toThrow(RangeError);   // 시작·보스·성좌 방·없는 방
  expect(() => make(null)).toThrow(RangeError);
  expect(() => make({ marks: [] })).toThrow(RangeError);
  expect(() => make({ marks: [[-6, 0], [0, 40]] })).toThrow(RangeError);       // 방 밖 성표
  expect(() => make({ marks: [[-10.5, 0]] })).toThrow(RangeError);            // 판정 원이 방 벽에 걸림
  const blocked = { ...f.world, buildFlow: () => new Int32Array(f.world.cols! * f.world.rows!).fill(-1) };
  expect(() => make({}, blocked)).toThrow(RangeError);
  // 성표 판정 원 둘레의 여유(원 + .6)가 막히면 거절: 성표 주변 한 칸만 이동 불가로 만든다.
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

test('차례가 아닌 성좌 방: 먼저 정리해도 복원 순서 대기이고 방은 정화되지 않으며 차례가 오면 곧바로 복원한다', () => {
  const f = fixture();
  clearRoom(f, 2);
  const waiting = gateOf(f, 2);
  expect(waiting.ready).toBe(true); expect(roomOf(f, 2).cleared).toBe(false);
  expect(f.messages).toContain('2번 성좌 · 되돌아온 빛 정화 · 복원 순서 대기');
  // 차례가 아닌 방의 판 위에 서도 단서도 확정도 없다.
  f.g.player.pos.copy(waiting.pos); f.route.update(f.g, 3);
  expect(waiting.available).toBe(false); expect(f.route.read).toBe(0);
  f.g.player.pos.copy(waiting.pads[0].pos); f.route.update(f.g, 3);
  expect(f.route.progress).toBe(0); expect(roomOf(f, 2).cleared).toBe(false);
  expect(f.route.autoRoom()).toBe(roomOf(f, 3));
  restore(f, 0);
  expect(roomOf(f, 3).cleared).toBe(true); expect(f.route.autoRoom()).toBe(roomOf(f, 2));
  restore(f, 1);
  expect(roomOf(f, 2).cleared).toBe(true);
  expect(f.route.gates.map((g: any) => g.attuned)).toEqual([true, true, false, false]);
});

test('보물방 2·5: 공명 대신 성좌 복원으로 정화되고 보상은 공명 시절과 같은 종류·수로 한 번만 나온다', () => {
  // 기준: 같은 월드를 경로 목표 없이 실제 Battle 공명 경로로 정화했을 때의 보상.
  const base = fixture({ noRoute: true });
  for (const id of [2, 5]) {
    const room = roomOf(base, id);
    base.g.enterRoom(room); flush(base);
    for (const e of base.g.enemies) if (e.homeRoom === room) e.alive = false;
    base.g.markCleared(room);
    expect(room.attunementPending).toBe(true);
    room.attuned = true; room.attunementPending = false; base.g.markCleared(room);
    expect(room.cleared).toBe(true);
  }
  const expected = base.spawns.map(s => s.kind), perRoom = expected.length / 2;
  expect(expected.filter(k => k === 'item').length).toBe(6); expect(expected.filter(k => k === 'stone').length).toBe(2);

  const f = fixture();
  clearRoom(f, 2); clearRoom(f, 5);
  expect(f.spawns).toHaveLength(0); expect(f.g.treasureRooms).toBe(0);                   // 차례가 오기 전에는 정화·보상 없음
  expect(roomOf(f, 2).attunementPending).toBeFalsy(); expect(roomOf(f, 5).attunementPending).toBeFalsy();   // 공명 제단은 만들어지지 않는다
  restore(f, 0);                                                                         // 방 3 은 일반 구역: 보물방 보상이 아니다
  const normal = f.spawns.length;
  restore(f, 1); expect(f.g.treasureRooms).toBe(1);
  expect(f.spawns.slice(normal).map(s => s.kind)).toEqual(expected.slice(0, perRoom));
  restore(f, 2); expect(f.g.treasureRooms).toBe(2);
  expect(f.spawns.slice(normal + perRoom).map(s => s.kind)).toEqual(expected.slice(perRoom));
  // 이미 정화된 방을 다시 정화해도 두 번 지급되지 않는다.
  const paid = f.spawns.length;
  f.g.markCleared(roomOf(f, 2)); f.g.markCleared(roomOf(f, 5)); f.route.update(f.g, 5);
  expect(f.spawns).toHaveLength(paid); expect(f.g.treasureRooms).toBe(2);
  expect(f.messages.filter(m => m === '보물방 클리어!')).toHaveLength(2);
});

test('정예방 4·7: 증원은 각각 1회, 성좌와 고리는 증원을 대신하지 않는다', () => {
  const f = fixture();
  for (const id of [4, 7]) {
    const room = roomOf(f, id);
    f.g.enterRoom(room); flush(f);
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
    expect(room.cleared).toBe(false); expect(room.forgeWave).toBe(1);
    expect(f.banners).toContain('금고 증원 1/1');
    expect(f.g.enemies.some((e: any) => e.alive && e.homeRoom === room)).toBe(true);
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
    expect(room.cleared).toBe(true); expect(room.forgeWave).toBe(1);
  }
  expect(f.banners.filter(b => b.startsWith('금고 증원'))).toEqual(['금고 증원 1/1', '금고 증원 1/1']);
  expect(ring(f).phase).toBe('idle');
});

test('4/4 순간: 부모의 복원 완료 토스트 뒤 모든 별자리 복원 토스트가 한 번 나오고 고리는 그 스텝에 열리지 않는다', () => {
  const f = fixture(); restore(f, 0); restore(f, 1); restore(f, 2);
  clearRoom(f, 1); clearRoom(f, 4); clearRoom(f, 7);                                    // 구역은 모두 정화, 성좌 하나가 남음
  f.messages.length = 0;
  restore(f, 3);
  const done = f.messages.indexOf('4번 성좌 · 귀환 좌표 복원 완료 · 4/4'), all = f.messages.indexOf('모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다');
  expect(done).toBeGreaterThanOrEqual(0); expect(all).toBe(done + 1);
  expect(f.messages.filter(m => m.startsWith('모든 별자리 복원'))).toHaveLength(1);
  expect(f.messages.some(m => m.startsWith('성좌 외곽 고리 개방'))).toBe(false);
  expect(ring(f).phase).toBe('idle');
  run(f, 1, .5);                                                                          // 다음 update 에서 열리고 토스트가 여러 번 반복되지 않는다
  expect(ring(f).phase).toBe('open');
  expect(f.messages.filter(m => m.startsWith('모든 별자리 복원'))).toHaveLength(1);
  expect(f.messages.filter(m => m === '성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요')).toHaveLength(1);
});

test('고리는 4/4 와 시작·보스방을 뺀 모든 구역 정화가 모두 끝난 다음 update 에만 열리고, 열리는 스텝에는 clock 이 흐르지 않는다', () => {
  // 구역은 모두 정화됐지만 성좌가 3/4
  const a = fixture(); restore(a, 0); restore(a, 1); restore(a, 2); clearRoom(a, 1); clearRoom(a, 4); clearRoom(a, 7);
  run(a, 5, .5); expect(ring(a).phase).toBe('idle'); expect(ring(a).clock).toBe(0);
  // 성좌 4/4 인데 방 7 이 남음
  const b = fixture(); restoreAll(b); clearRoom(b, 1); clearRoom(b, 4);
  run(b, 5, .5); expect(ring(b).phase).toBe('idle');
  expect(b.route.hint()).toBe('별자리 4/4 복원 · 남은 구역 정화');
  // 방 1 이 남아도 열리지 않는다
  const c = fixture(); restoreAll(c); clearRoom(c, 4); clearRoom(c, 7);
  run(c, 5, .5); expect(ring(c).phase).toBe('idle');
  // 마지막 구역을 Battle 이 정화한 뒤 첫 update: 열리되 시간은 0
  clearRoom(c, 1); expect(ring(c).phase).toBe('idle');
  c.route.update(c.g, .5);
  expect(ring(c).phase).toBe('open'); expect(ring(c).clock).toBe(0); expect(ring(c).shard).toEqual({ state: 'calm', age: 0, cycle: -1 });
  expect(ring(c).left).toBe(20); expect(c.messages).toContain('성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요');
  expect(c.route.hint()).toBe('외곽 고리 정화 · 성좌 외곽 고리로 이동');
  // 봉인은 그대로
  flush(c); c.g.unsealBoss(); expect(c.world.sealed).toBe(true);
});

test('방 밖에서는 정화가 시작되지 않고, 방 사각형(경계 포함)에 들어서는 스텝에 limit 20 으로 시작한다', () => {
  const f = opened();
  const r = ring(f);
  at(f, 6); run(f, 3, .5);
  expect(r.phase).toBe('open'); expect(r.clock).toBe(3); expect(r.elapsed).toBe(0); expect(r.left).toBe(20);
  for (const [dx, dz] of [[-11.01, 0], [11.01, 0], [0, 12.01], [0, -12.01]]) { at(f, 7, dx, dz); f.route.update(f.g, .25); expect(r.phase).toBe('open'); }
  at(f, 7, -11, 12);                                                                      // 모서리 경계 포함
  f.messages.length = 0; f.route.update(f.g, .25);
  expect(r.phase).toBe('running'); expect(r.limit).toBe(20); expect(r.left).toBe(20); expect(r.elapsed).toBe(0);
  expect(f.messages).toContain('외곽 고리 정화 시작 · 20초');
  expect(f.route.hint()).toBe('외곽 고리 정화 · 성표 0/4 · 파편이 모이면 중심 밖으로 · 20초');
  f.route.update(f.g, .25);
  expect(r.elapsed).toBe(.25); expect(r.left).toBe(19.75);
});

test('성표: 중심 1.4 안에서 1초 머물면 정화, 벗어나면 그 성표 유지 초기화, 순서 자유, 정화한 성표는 유지된다', () => {
  const f = running(), r = ring(f);
  atMark(f, 2, 1.4); f.route.update(f.g, .5);                                             // 경계 포함
  expect(r.held).toBe(2); expect(r.marks[2].hold).toBeCloseTo(.5);
  atMark(f, 2, 1.41); f.route.update(f.g, .25);
  expect(r.held).toBe(-1); expect(r.marks[2].hold).toBe(0); expect(r.purified).toBe(0);
  atMark(f, 2); f.route.update(f.g, .75); expect(r.purified).toBe(0); expect(r.marks[2].done).toBe(false);
  f.messages.length = 0; f.route.update(f.g, .25);
  expect(r.purified).toBe(1); expect(r.marks[2].done).toBe(true); expect(r.held).toBe(-1);
  expect(f.messages).toEqual(['성표 정화 · 1/4']);
  expect(f.route.hint()).toMatch(/^외곽 고리 정화 · 성표 1\/4 · 파편이 모이면 중심 밖으로 · \d+초$/);
  // 정화한 성표 위에 다시 서도 유지로 세지 않는다. 순서는 자유(3 → 0).
  f.route.update(f.g, 1); expect(r.held).toBe(-1); expect(r.purified).toBe(1);
  atMark(f, 3); f.route.update(f.g, 1); expect(r.purified).toBe(2);
  atMark(f, 0); f.route.update(f.g, 1); expect(r.purified).toBe(3);
  expect(r.marks.map((m: any) => m.done)).toEqual([true, false, true, true]);
  expect(r.phase).toBe('running'); expect(f.route.canUnseal()).toBe(false);
});

test('집결 위상: 1초부터 4.5초 주기로 예고 1.5초 → 터짐 .5초, 같은 cycle 은 한 번만 피해, 경계 포함 반경 3.4', () => {
  const f = opened(); at(f, 7, SAFE[0], SAFE[1]);
  const r = ring(f), clock = () => r.clock;
  const seen: [number, string, number, number][] = [];
  const probe = (dt: number) => { f.route.update(f.g, dt); seen.push([clock(), r.shard.state, r.shard.cycle, r.shard.age]); };
  probe(.25);                                                                              // 시작 스텝 clock .25
  while (clock() < 10.25 - 1e-9) probe(.25);
  const at_ = (t: number) => seen.find(s => Math.abs(s[0] - t) < 1e-9)!;
  expect(at_(.75).slice(1, 3)).toEqual(['calm', -1]);
  expect(at_(1).slice(1, 3)).toEqual(['warning', 0]); expect(at_(2.25).slice(1, 3)).toEqual(['warning', 0]);
  expect(at_(2.5).slice(1, 3)).toEqual(['burst', 0]); expect(at_(2.75).slice(1, 3)).toEqual(['burst', 0]);
  expect(at_(3).slice(1, 3)).toEqual(['calm', 0]); expect(at_(5.25).slice(1, 3)).toEqual(['calm', 0]);
  expect(at_(5.5).slice(1, 3)).toEqual(['warning', 1]); expect(at_(7).slice(1, 3)).toEqual(['burst', 1]);
  expect(at_(7.5).slice(1, 3)).toEqual(['calm', 1]); expect(at_(10).slice(1, 3)).toEqual(['warning', 2]);
  expect(at_(1.75)[3]).toBeCloseTo(.75); expect(at_(2.75)[3]).toBeCloseTo(.25);
  expect(f.hurts).toHaveLength(0);                                                         // 중심 밖이면 피해 없음
  // 피해는 터지는 동안 중심 반경 3.4(경계 포함) 안에서 집결마다 한 번.
  const g = opened(); at(g, 7, SAFE[0], SAFE[1]); g.route.update(g.g, .25);
  at(g, 7, 3.4, 0); run(g, 2.25 - .25, .25);                                               // clock 2.25: 아직 예고
  expect(g.hurts).toHaveLength(0);
  g.route.update(g.g, .25);                                                                // clock 2.5: 터짐 시작
  expect(g.hurts).toHaveLength(1); expect(g.hurts[0]).toMatchObject({ n: 6, kb: 0, kind: 'magic' });
  expect(ring(g).shardHits).toBe(1); expect(g.messages).toContain('파편 집결 피격 · 파편이 모이면 중심 밖으로');
  g.route.update(g.g, .25); expect(g.hurts).toHaveLength(1);                               // 같은 cycle 두 번째 스텝
  run(g, 2.5, .25); expect(g.hurts).toHaveLength(1);                                       // 터짐 끝나고 calm
  run(g, 2.5, .25);                                                                        // cycle 1 터짐(clock 7~7.5)
  expect(g.hurts).toHaveLength(2); expect(ring(g).shardHits).toBe(2);
  // 반경 밖(3.41)은 맞지 않는다.
  const h = opened(); at(h, 7, SAFE[0], SAFE[1]); h.route.update(h.g, .25);
  at(h, 7, 3.41, 0); run(h, 9, .25); expect(h.hurts).toHaveLength(0);
});

test('고리 위 성표 사이 직선은 안전하다: 이웃한 성표를 잇는 직선은 중심 반경 밖이다', () => {
  const f = running();
  for (let i = 0; i < 4; i++) {
    const a = ring(f).marks[i].pos, b = ring(f).marks[(i + 1) % 4].pos, c = ring(f).center;
    for (let k = 0; k <= 20; k++) {
      const x = a.x + (b.x - a.x) * k / 20, z = a.z + (b.z - a.z) * k / 20;
      expect(Math.hypot(x - c.x, z - c.z)).toBeGreaterThan(RING.core);
    }
  }
});

test('붕괴: 시간이 다 되면 최대 체력 6% 피해, 성표 0/4, 시간 20초 다시, 진행은 막히지 않는다', () => {
  const f = running(), r = ring(f);
  atMark(f, 0); f.route.update(f.g, 1);
  expect(r.purified).toBe(1);
  at(f, 7, SAFE[0], SAFE[1]);
  f.messages.length = 0;
  run(f, 18.75, .25);                                                                      // 시작 스텝 뒤 총 19.75초 경과, 남은 .25초
  expect(r.collapses).toBe(0); expect(r.purified).toBe(1);
  f.route.update(f.g, .25);
  expect(r.collapses).toBe(1); expect(r.purified).toBe(0); expect(r.left).toBe(20); expect(r.phase).toBe('running');
  expect(r.marks.every((m: any) => !m.done && m.hold === 0)).toBe(true);
  expect(f.hurts).toHaveLength(1); expect(f.hurts[0]).toMatchObject({ n: 6, kb: 0, kind: 'magic' });
  expect(f.messages).toContain('외곽 고리 붕괴 · 성표가 흐려졌습니다 · 다시 20초');
  // 다시 정화할 수 있다.
  for (const i of [0, 1, 2, 3]) { atMark(f, i); f.route.update(f.g, 1); }
  expect(r.phase).toBe('done'); expect(r.collapses).toBe(1);
});

test('같은 스텝에서 정화 완료가 붕괴보다 먼저다', () => {
  const f = running(), r = ring(f);
  for (const i of [0, 1, 2]) { atMark(f, i); f.route.update(f.g, 1); }
  at(f, 7, SAFE[0], SAFE[1]);
  run(f, 20 - 3 - 1 - .5 - 1e-9 - 0, .25);                                                 // 남은 시간이 1.0 이 될 때까지 대기(안전한 자리)
  expect(r.left).toBeCloseTo(1.5);
  atMark(f, 3); f.route.update(f.g, .5);                                                   // left 1.0, hold .5
  expect(r.left).toBeCloseTo(1); expect(r.purified).toBe(3);
  f.route.update(f.g, .5);                                                                 // left .5
  f.route.update(f.g, .5);                                                                 // hold 1.5 ≥ 1 and left 0 → 완료가 우선
  expect(r.phase).toBe('done'); expect(r.collapses).toBe(0); expect(f.hurts).toHaveLength(0);
});

test('완료 전에는 봉인이 유지되고, 4/4 성표를 정화하면 실제 Battle 봉인이 풀린다', () => {
  const f = fixture(); untilRoomSeven(f); clearRoom(f, 7);
  flush(f); f.g.unsealBoss();                                                              // Battle.markCleared 의 1.2초 뒤 해제 시도 포함
  expect(f.world.sealed).toBe(true);
  at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25); f.route.update(f.g, .25);
  expect(ring(f).phase).toBe('running');
  for (const i of [0, 1, 2]) { atMark(f, i); f.route.update(f.g, 1); }
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true); expect(f.counts.portal).toBe(0);
  expect(f.route.canUnseal()).toBe(false);
  f.messages.length = 0; atMark(f, 3); f.route.update(f.g, 1);
  expect(ring(f).phase).toBe('done'); expect(f.world.sealed).toBe(false); expect(f.counts.portal).toBe(1);
  // 마지막 성표는 완료 토스트 하나로만 알린다(같은 순간 '성표 정화 · 4/4' 를 따로 내지 않는다).
  expect(f.messages[0]).toBe('외곽 고리 정화 · 레비아탄의 봉인이 풀립니다');
  expect(f.messages).not.toContain('성표 정화 · 4/4');
  expect(f.messages).toContain('보스의 봉인이 풀렸다!');
  expect(f.route.canUnseal()).toBe(true); expect(f.route.hint()).toBe('별자리 4/4 복원 · 레비아탄 처치');
  // 완료 뒤에는 상태가 더 바뀌지 않는다.
  const snapshot = JSON.stringify([ring(f).clock, ring(f).elapsed, ring(f).shardHits, ring(f).collapses]);
  at(f, 7); run(f, 20, .5);
  expect(JSON.stringify([ring(f).clock, ring(f).elapsed, ring(f).shardHits, ring(f).collapses])).toBe(snapshot);
  expect(f.hurts).toHaveLength(0); expect(f.route.ownsHazards(roomOf(f, 7))).toBe(false); expect(f.route.autoGoal()).toBeNull();
});

test('ownsHazards: 고리가 열려 있거나 도는 동안만 고리 방, 성좌 방은 정리된 미복원일 때만', () => {
  const f = fixture(), seven = roomOf(f, 7);
  expect(f.route.ownsHazards(seven)).toBe(false);
  clearRoom(f, 3); expect(f.route.ownsHazards(roomOf(f, 3))).toBe(true);                   // 부모 규칙 그대로
  restore(f, 0); expect(f.route.ownsHazards(roomOf(f, 3))).toBe(false);
  const g = opened(); expect(g.route.ownsHazards(roomOf(g, 7))).toBe(true); expect(g.route.ownsHazards(roomOf(g, 6))).toBe(false);
  at(g, 7, SAFE[0], SAFE[1]); g.route.update(g.g, .25); expect(g.route.ownsHazards(roomOf(g, 7))).toBe(true);
  g.route.stop(); expect(g.route.ownsHazards(roomOf(g, 7))).toBe(false);
});

test('안내 문구: 열림·진행 중 문구가 바뀔 때만 목표창을 다시 그린다', () => {
  const f = opened(); at(f, 7, SAFE[0], SAFE[1]);
  f.route.update(f.g, .25);
  const before = f.counts.objective;
  expect(f.route.hint()).toBe('외곽 고리 정화 · 성표 0/4 · 파편이 모이면 중심 밖으로 · 20초');
  f.route.update(f.g, .25);                                                                // 19.5초 → 올림 20, 문구 변화 없음
  expect(f.counts.objective).toBe(before);
  f.route.update(f.g, .5); f.route.update(f.g, .5);                                        // 19.0초 → 19
  expect(f.route.hint()).toBe('외곽 고리 정화 · 성표 0/4 · 파편이 모이면 중심 밖으로 · 19초');
  expect(f.counts.objective).toBeGreaterThan(before);
});

test('AUTO 목표: 열린 뒤에는 가장 가까운 미정화 성표(같은 거리면 배열 순서 앞), 그 밖에는 null', () => {
  const f = opened();
  const marks = ring(f).marks;
  at(f, 6); f.route.update(f.g, .25);
  expect(f.route.autoGoal()).toBe(marks[0].pos);                                           // 서쪽 문 쪽에서 가장 가깝다
  at(f, 7); f.route.update(f.g, .25);                                                      // 중심: 네 성표가 같은 거리 → 첫 번째
  expect(ring(f).phase).toBe('running'); expect(f.route.autoGoal()).toBe(marks[0].pos);
  atMark(f, 0); f.route.update(f.g, 1);                                                    // 서쪽 정화: 북(1)과 남(3)이 같은 거리 → 북
  expect(f.route.autoGoal()).toBe(marks[1].pos);
  atMark(f, 1); f.route.update(f.g, 1); expect(f.route.autoGoal()).toBe(marks[2].pos);
  atMark(f, 2); f.route.update(f.g, 1); expect(f.route.autoGoal()).toBe(marks[3].pos);
  atMark(f, 3); f.route.update(f.g, 1); expect(f.route.autoGoal()).toBeNull();
  expect(fixture().route.autoGoal()).toBeNull();
  const g = running(); g.route.stop(); expect(g.route.autoGoal()).toBeNull();
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

test('보고: 완료한 런은 성좌 보고에 고리 결과가 더해지고, 한 번 만든 보고는 바뀌지 않는다', () => {
  const f = fixture(); untilRoomSeven(f); clearRoom(f, 7);
  at(f, 7, SAFE[0], SAFE[1]); f.route.update(f.g, .25); f.route.update(f.g, .25);
  atMark(f, 0); f.route.update(f.g, 1);
  at(f, 7, 0, 0);
  run(f, 2.5, .25);                                                                        // clock 3.0 이전의 터짐(2.5~3.0) 한 번 맞음
  expect(ring(f).shardHits).toBe(1);
  for (const i of [1, 2, 3]) { atMark(f, i); f.route.update(f.g, 1); }
  expect(ring(f).phase).toBe('done');
  f.world.bossRoom.cleared = true; f.g.bossDefeated = true; f.g.victory();
  const report = f.g.result.routeObjective;
  expect(report).toMatchObject({ id: 'astral_fallen_constellations_deep', complete: true, progress: 4, target: 4, mistakes: 0, rooms: [3, 2, 5, 6] });
  expect(report.constellations.map((c: any) => [c.stationId, c.roomId, c.choice])).toEqual([[1, 3, 'circle'], [2, 2, 'diamond'], [3, 5, 'triangle'], [4, 6, 'circle']]);
  expect(report.ring).toEqual({ purified: true, marks: 4, collapses: 0, shardHits: 1, seconds: report.ring.seconds });
  expect(report.ring.seconds).toBeGreaterThan(5);
  expect(Object.keys(report).sort()).toEqual(['complete', 'constellations', 'id', 'mistakes', 'progress', 'ring', 'rooms', 'target']);
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.ring)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  ring(f).collapses = 9; expect(f.route.finish(false)).toBe(report); expect(f.route.finish(true).ring.collapses).toBe(0);
});

test('패배 보고: 고리 도중 패배는 완료로 바뀌지 않고 실제 성표·붕괴·피격만 센다', () => {
  const f = running(), r = ring(f);
  atMark(f, 0); f.route.update(f.g, 1);
  at(f, 7, SAFE[0], SAFE[1]); run(f, 20, .25);                                             // 붕괴 1회로 성표 0/4
  atMark(f, 1); f.route.update(f.g, 1);
  expect(r.collapses).toBeGreaterThanOrEqual(1);
  f.g.defeat();
  const report = f.g.result.routeObjective;
  expect(report.complete).toBe(false); expect(report.progress).toBe(4);
  expect(report.ring).toEqual({ purified: false, marks: 1, collapses: r.collapses, shardHits: 0, seconds: report.ring.seconds });
  f.g.active = true; atMark(f, 2); for (let i = 0; i < 5; i++) f.route.update(f.g, 1);
  expect(f.route.finish(true)).toBe(report); expect(report.ring.marks).toBe(1);
  // 성좌 도중 패배: 고리는 시작도 하지 않았다.
  const g = fixture(); restore(g, 0); g.g.defeat();
  expect(g.g.result.routeObjective).toMatchObject({ complete: false, progress: 1, rooms: [3], ring: { purified: false, marks: 0, collapses: 0, shardHits: 0, seconds: 0 } });
});

test('뷰 연결: 뷰가 없어도 규칙은 돌고, 있으면 dt·같은 옵션 객체로 갱신하며 stop 에서 정리한다', async () => {
  // 성좌 뷰(부모)는 DOM 캔버스가 필요하므로 이 테스트에서는 부모 prepareView 만 비운다. 고리 뷰 불러오기는 실제 코드다.
  const parentPrepare = AstralConstellations.prototype.prepareView;
  AstralConstellations.prototype.prepareView = async function () {};
  try { await viewWiring(); } finally { AstralConstellations.prototype.prepareView = parentPrepare; }
});
async function viewWiring() {
  const f = fixture();
  await f.route.prepareView(f.g.scene);                                                    // 뷰 파일이 없거나 있어도 예외 없이 끝난다
  if (f.route.ringView) expect(typeof f.route.ringView.update).toBe('function');
  f.route.ringView?.dispose?.(); f.route.ringView = null;
  const calls: any[] = [], fake = { update: (...a: any[]) => calls.push(a), dispose: () => calls.push('dispose') };
  f.route.ringView = fake;
  untilRoomSeven(f); clearRoom(f, 7); calls.length = 0;                                       // Battle.enterRoom 이 부른 dt 0 맞춤은 지운다
  f.route.update(f.g, .5);                                                                 // 열림
  expect(calls).toHaveLength(1); expect(calls[0][0]).toBe(f.route); expect(calls[0][1]).toBe(.5); expect(calls[0][2]).toEqual({ reduced: false });
  at(f, 7, SAFE[0], SAFE[1]); f.g.app.reducedMotion.matches = true; f.route.update(f.g, .25);
  expect(calls[1][1]).toBe(.25); expect(calls[1][2].reduced).toBe(true); expect(calls[1][2]).toBe(calls[0][2]);
  f.route.syncView(f.g); expect(calls[2][1]).toBe(0);
  f.g.paused = true; f.route.update(f.g, .25); f.route.syncView(f.g); expect(calls).toHaveLength(3);   // 일시정지에는 갱신하지 않는다
  f.g.paused = false; f.route.stop();
  expect(calls[calls.length - 1]).toBe('dispose'); expect(f.route.ringView).toBeNull();
  const lateLoad = fixture(); const p = lateLoad.route.prepareView(lateLoad.g.scene); lateLoad.route.stop(); await p;   // 불러오는 중 종료돼도 뷰가 남지 않는다
  expect(lateLoad.route.ringView).toBeNull();
}

/* ------------------------------------------------------------------ AUTO 모의 ------------------------------------------------------------------ */

// 영웅 속도: src/data/heroes.js base.spd — mage 5.6(가장 느림), barbarian 5.8, knight 6.2, ranger 6.6, rogue 7.2(가장 빠름).
const SLOW = HEROES.mage.base.spd, FAST = HEROES.rogue.base.spd;
test('영웅 속도 값의 근거: 가장 느린 영웅 5.6, 가장 빠른 영웅 7.2', () => {
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

test('AUTO 모의(성좌): 가장 느린 영웅이 실제 Floor 에서 단서 → 정답 판 → 복원까지 해내고, 지나는 길의 대기 성좌 방에 걸리지 않는다', () => {
  const dt = .05;
  // [복원할 성좌 index, 출발 방들] — 방 3 은 방 2 를 지나, 방 2 는 방 3 에서 돌아와, 방 5 는 2·1·4 에서, 방 6 은 5 에서.
  const cases: [number, number[]][] = [[0, [1, 2]], [1, [3]], [2, [2, 1, 4]], [3, [5]]];
  for (const speed of [SLOW, FAST]) for (const [index, starts] of cases) for (const start of starts) {
    const f = fixture(); f.g.player.auto = true;
    for (let k = 0; k < index; k++) restore(f, k);
    // 모든 성좌 방이 정리돼 있고(대기 상태 포함) 적은 없다.
    for (const gate of f.route.gates) if (!gate.attuned) clearRoom(f, gate.room.id);
    expect(f.route.gates[index].ready).toBe(true);
    at(f, start); f.g.autoTarget = f.route.autoRoom();
    let t = 0;
    while (f.route.progress === index && t < 90) { autoStep(f, speed, dt); t += dt; }
    const label = 'gate ' + index + ' from room ' + start + ' @' + speed;
    expect([label, f.route.progress]).toEqual([label, index + 1]);
    expect(f.route.mistakes).toBe(0);
    expect(f.hurts).toHaveLength(0);
  }
});

/** 고리 한 판: 열림 순간 영웅 위치와 집결 위상(clock)을 정하고 AUTO 로 끝까지. */
function ringRun(where: [number, number, number], phase: number, speed: number, dt = .05) {
  const f = opened(where), r = ring(f);
  f.g.player.auto = true; r.clock = phase; f.route.update(f.g, dt / 1000);                  // 위상 적용(시간은 거의 흐르지 않는다)
  r.clock = phase;
  let t = 0;
  while (r.phase !== 'done' && t < 60) { autoStep(f, speed, dt); t += dt; }
  return { phase: r.phase, collapses: r.collapses, shardHits: r.shardHits, hurts: f.hurts.length, seconds: r.elapsed };
}
// 열림 순간 영웅 위치: 방 7 중심, 서쪽 문 안쪽(x -10), 방 6 중심, 방 7 동쪽 끝(x +9), 남쪽 끝(z +10).
const OPEN_AT: [string, [number, number, number]][] = [['center', [7, 0, 0]], ['west door', [7, -10, 0]], ['room 6', [6, 0, 0]], ['east end', [7, 9, 0]], ['south end', [7, 0, 10]]];

test('AUTO 모의(고리): 5 위치 × 위상 0~4.4초 × 속도 5.6·7.2 에서 모두 정화 완료, 붕괴 0, 피격 0 (중심은 피할 수 없는 구간만 제외)', () => {
  const failures: string[] = [], forced: string[] = [];
  for (const [name, where] of OPEN_AT) for (const speed of [SLOW, FAST]) for (let k = 0; k <= 44; k++) {
    const phase = k / 10, res = ringRun(where, phase, speed);
    // 중심에서 열린 고리는 예고 시작(1초) 뒤 터짐(2.5초)까지 중심 반경 3.4 를 벗어날 시간이 모자라면 어떤 AUTO 로도 한 번 맞는다:
    // 반경을 벗어나는 데 3.4 / 속도 초(5.6 이면 약 .61초)가 걸린다. 그 구간(터짐이 끝나는 3.0초 전까지)만 최대 1회 피격을 허용한다.
    const forcedHit = name === 'center' && phase > 2.5 - 3.4 / speed - .15 && phase < 3;
    if (res.phase !== 'done' || res.collapses !== 0) failures.push(name + ' @' + speed + ' phase ' + phase + ' ' + JSON.stringify(res));
    else if (forcedHit) { forced.push(name + ' @' + speed + ' phase ' + phase); if (res.shardHits > 1 || res.hurts !== res.shardHits) failures.push('forced ' + phase + ' ' + JSON.stringify(res)); }
    else if (res.shardHits !== 0 || res.hurts !== 0) failures.push(name + ' @' + speed + ' phase ' + phase + ' ' + JSON.stringify(res));
  }
  expect(failures).toEqual([]);
  // 허용 구간은 중심 위치뿐이고, 다른 네 위치는 모든 위상에서 한 번도 맞지 않는다.
  expect(forced.every(s => s.startsWith('center'))).toBe(true);
});

/* ------------------------------------------------------------------ 무할당 ------------------------------------------------------------------ */

test('무할당: 고리가 도는 동안 update 는 상태 객체를 바꿔 끼우지 않고, 토스트·목표창·피해 없이 도는 구간에서 메모리가 쌓이지 않는다', () => {
  const f = running(), r = ring(f);
  const snapshot = () => [f.route.ring, r.center, r.marks, r.shard, r.room, ...r.marks, ...r.marks.map((m: any) => m.pos)];
  const refs = snapshot();
  at(f, 7, SAFE[0], SAFE[1]);
  run(f, 1, .25);                                                                          // 시작 스텝의 토스트 등을 지난 뒤
  const toasts = f.messages.length, objective = f.counts.objective, hurts = f.hurts.length;
  // 20초 안에서 문구(올림 초)가 바뀌지 않는 구간만 센다: 같은 초 안에서 되풀이.
  f.g.app.reducedMotion.matches = false;
  const tiny = 1 / 4096;
  const states = new Set<string>();
  Bun.gc(true);
  const heap0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 60000; i++) {
    f.route.update(f.g, tiny);
    states.add(r.shard.state);
    if (r.left < 18.5) r.left = 18.99;                                                     // 안전한 자리에서 올림 초(19)가 바뀌지 않는 구간을 반복(붕괴·문구 변화 없음)
  }
  Bun.gc(true);
  const grown = process.memoryUsage().heapUsed - heap0;
  expect(f.messages.length).toBe(toasts); expect(f.counts.objective).toBe(objective); expect(f.hurts.length).toBe(hurts);
  snapshot().forEach((now, i) => expect(now).toBe(refs[i]));                                // 같은 객체(값이 같은 새 객체가 아니다)
  expect([...states].sort()).toEqual(['burst', 'calm', 'warning']);                         // 세 집결 상태를 모두 지나는 동안의 관찰이다
  expect(r.phase).toBe('running');
  // 가비지 수집 뒤에도 남는 증가(누수)가 없어야 한다. 한 스텝에 객체를 하나씩 쌓으면 6만 스텝에 수 MB 가 남는다.
  expect(grown).toBeLessThan(1_000_000);
});
