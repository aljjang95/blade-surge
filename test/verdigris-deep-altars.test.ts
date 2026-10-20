// 녹청 성역 심층(BUNDLE-11): 생명 제단 4곳(방 2 → 5 → 3 → 6, 점등 이동·번호 숨김)과 4/4·모든 구역 정화 뒤 열리는 포자 수로 돌파.
// 방 입장·증원·정화·봉인·보물방 보상은 실제 Battle 코드를 쓰고, 영웅 위치와 시간만 테스트가 정한다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives, RouteObjectives } from '../src/game/route-objectives.js';
import { VerdigrisDeepAltars, defineVerdigrisDeepAltars } from '../src/game/verdigris-deep-altars.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';

const noop = () => {};
const DEEP = ROUTE_OBJECTIVES.verdigris_deep;
const CH = DEEP.channel;
const ALTAR_ORDER = [2, 5, 3, 6];

function fixture(depth = 'deep') {
  const stage = buildExpeditionStage('dungeon', 'verdigris_sanctum', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], banners: string[] = [], labels: string[] = [], hurts: any[] = [], spawns: any[] = [];
  const counts = { portal: 0 };
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, sp: { clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: (text: string) => banners.push(text), setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: () => { counts.portal++; },
    fx: { damage: (_p: any, _n: number, o: any) => labels.push(o.text), groundTex: noop, clearAll: noop, castCircle: noop, burst: noop, embers: noop },
    drops: { spawn: (_at: any, kind: string, value: any) => spawns.push({ kind, value }), clear: noop }, rollDrop: () => ({}),
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number, o: any = {}) => { hurts.push({ n, ...o }); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = createRouteObjectives(stage, world);
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, banners, labels, hurts, spawns, counts, stage };
}
type F = ReturnType<typeof fixture>;
const roomOf = (f: F, id: number): any => f.world.rooms[id];
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id);
const ch = (f: F) => f.route.channel;
const at = (f: F, id: number, dx = 0, dz = 0) => { const r = roomOf(f, id); f.g.player.pos.set(r.x + dx, 0, r.z + dz); };
const hurtsOf = (f: F) => f.hurts.map(h => h.n);
/** 실제 입장 → 처치 → 정화 시도를 되풀이해 방을 정화하거나(제단 방은 준비될 때까지) 증원 단계를 모두 겪는다. */
function clearRoom(f: F, id: number) {
  const room = roomOf(f, id);
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  const gate = gateOf(f, id);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
  return room;
}
/** 지금 켜진 제단 방을 정리하고 그 중심에서 2초 유지해 정화한다. */
function purifyLit(f: F) {
  const gate = f.route.lit, before = f.route.progress;
  clearRoom(f, gate.room.id); at(f, gate.room.id);
  for (let i = 0; i < 4; i++) f.route.update(f.g, .5);
  expect(f.route.progress).toBe(before + 1);
  return gate;
}
function finishAltars(f: F) { for (let i = 0; i < 4; i++) purifyLit(f); }
/** 제단 4곳과 남은 구역(1·4·7)을 모두 정화한다. 마지막 정화 뒤에는 route.update 를 부르지 않는다. */
function finishRooms(f: F, order = [1, 4, 7]) { finishAltars(f); for (const id of order) clearRoom(f, id); }
/** 수로를 연 상태(영웅은 방 6 중심). */
function openedChannel(room = 6) {
  const f = fixture(); finishRooms(f); at(f, room); f.route.update(f.g, 1 / 60);
  expect(ch(f).phase).toBe('open');
  return f;
}
/** 수로를 돌파 중으로 만든 상태: 출발선 안쪽 방 안으로 들어서 시작한다(영웅은 마지막으로 서 있던 자리). */
function runningChannel() {
  const f = openedChannel(); at(f, 7, CH.startLine - .5); f.route.update(f.g, 1 / 60);
  expect(ch(f).phase).toBe('running');
  return f;
}
const idx = (w: any, x: number, z: number) => Math.floor(z - w.minZ) * w.cols + Math.floor(x - w.minX);
const flowToExit = (f: F) => f.world.buildFlow(ch(f).exit.x, ch(f).exit.z)!;
/** 띠 안의 영웅이 아니도록 방 안 띠 사이(출발선과 첫 띠 사이)에 세운다. */
const park = (f: F) => at(f, 7, CH.startLine - .5);

test('정의: 생명 제단은 방 2 → 5 → 3 → 6 이고 정예방 4·7 안의 7 번 방에 포자 수로가 선다', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(DEEP);
  expect(f.route).toBeInstanceOf(VerdigrisDeepAltars);
  expect(f.route).toBeInstanceOf(RouteObjectives);
  expect(f.route.def.id).toBe('verdigris_root_heart_deep');
  expect(f.world.rooms.map(r => r.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'elite', 'treasure', 'normal', 'elite', 'boss']);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual(ALTAR_ORDER);
  expect(f.route.gates.map((g: any) => g.room.label)).toEqual(['뿌리 샘 제단', '이끼 못 제단', '덩굴 회랑 제단', '포자 정원 제단']);
  const start = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
  for (const gate of f.route.gates) expect(start[idx(f.world, gate.room.x, gate.room.z)]).toBeGreaterThanOrEqual(0);
  const c = ch(f), room = roomOf(f, 7);
  expect(c.room).toBe(room); expect(room.label).toBe('포자 수로');
  expect([room.w, room.h]).toEqual([24, 20]);
  expect(c).toMatchObject({ phase: 'idle', clock: 0, left: 0, limit: 0, elapsed: 0, floods: 0, sporeHits: 0,
    minX: room.x - 12, maxX: room.x + 12, minZ: room.z - 10, maxZ: room.z + 10, startX: room.x - 7.5, finishX: room.x + 7.5 });
  expect(c.entry.toArray()).toEqual([room.x - 9, 0, room.z]); expect(c.exit.toArray()).toEqual([room.x + 9, 0, room.z]);
  expect(c.bands.map((b: any) => b.x)).toEqual([-5.4, -1.8, 1.8, 5.4].map(x => room.x + x));
  expect(c.bands.every((b: any) => b.half === 1.1 && b.state === 'calm' && b.cycle === -1)).toBe(true);
  for (const p of [c.entry, c.exit]) { expect((f.world as any).inner[idx(f.world, p.x, p.z)]).toBe(1); expect(start[idx(f.world, p.x, p.z)]).toBeGreaterThanOrEqual(0); }
  // 읽기 상태의 처음 값
  expect(f.route.lit).toBe(f.route.gates[0]); expect(f.route.litMoves).toBe(0); expect(f.route.litT).toBe(0);
  expect(f.route.autoGoal()).toBeNull(); expect(f.route.canUnseal()).toBe(false);
  expect(f.route.allowsAttunement(roomOf(f, 2))).toBe(false); expect(f.route.coexistsAttunement).toBe(false);
  // 클래스는 route-objectives.js 를 먼저 가져와도 이 파일을 먼저 가져와도 같은 하나다.
  expect(defineVerdigrisDeepAltars()).toBe(VerdigrisDeepAltars);
});

test('잘못된 수로 정의는 생성 때 RangeError 로 거절된다', () => {
  const f = fixture();
  const make = (channel: any, world = buildExpeditionWorld(f.stage)) => new (defineVerdigrisDeepAltars())({ ...DEEP, channel: channel && { ...CH, ...channel } } as any, world);
  expect(() => make({})).not.toThrow();
  for (const roomId of [0, 8, 2, 99]) expect(() => make({ roomId })).toThrow(RangeError);
  expect(() => make(null)).toThrow(RangeError);
  expect(() => make({ exit: [30, 0] })).toThrow(RangeError);          // 방 밖 출구
  expect(() => make({ entry: [-9, 40] })).toThrow(RangeError);
  expect(() => make({ startLine: -3 })).toThrow(RangeError);          // 출발선이 첫 띠 안쪽
  expect(() => make({ finishLine: 4 })).toThrow(RangeError);          // 도착선이 마지막 띠 안쪽
  expect(() => make({ bands: [-1.8, -1.2] })).toThrow(RangeError);    // 띠끼리 겹침
});

test('차례가 아닌 제단: 먼저 정리해도 정화되지 않고 방도 정화되지 않으며, 1초 머물면 포자 폭발(8%, 2초 재발동 대기)', () => {
  const f = fixture();
  clearRoom(f, 5);
  expect(gateOf(f, 5).ready).toBe(true); expect(f.route.lit).toBe(gateOf(f, 2));
  at(f, 5);
  f.route.update(f.g, .9); expect(f.hurts.length).toBe(0);
  f.route.update(f.g, .1); expect(hurtsOf(f)).toEqual([8]);
  expect(f.route.bursts).toBe(1); expect(f.messages).toContain('이끼 못 제단 · 차례가 아닌 생명 제단 · 포자 폭발');
  f.route.update(f.g, 1.9); expect(f.hurts.length).toBe(1);          // 재발동 대기 2초
  f.route.update(f.g, 1.2); expect(f.hurts.length).toBe(2);
  expect(f.route.progress).toBe(0); expect(f.route.hold).toBe(0);
  expect(roomOf(f, 5).cleared).toBe(false); expect(gateOf(f, 5).attuned).toBe(false);
  // 아직 정리하지 않은 비점등 제단 방은 머물러도 폭발도 정화도 없다.
  at(f, 3); f.route.update(f.g, 3);
  expect(f.hurts.length).toBe(2); expect(f.route.progress).toBe(0); expect(roomOf(f, 3).cleared).toBe(false);
  // 켜진 제단(방 2)을 정화하면 빛이 방 5 로 옮겨 가고, 이미 정리된 방 5 는 중심 2초로 곧바로 정화된다.
  purifyLit(f);
  expect(f.route.lit).toBe(gateOf(f, 5));
  const burstsBefore = f.route.bursts;
  at(f, 5); for (let i = 0; i < 4; i++) f.route.update(f.g, .5);
  expect(f.route.progress).toBe(2); expect(f.route.bursts).toBe(burstsBefore);
  expect(roomOf(f, 5).cleared).toBe(true);
});

test('점등 이동: 정화마다 뿌리 빛이 길 순서와 다른 다음 제단으로 옮겨 가고 토스트는 한 번씩 나온다', () => {
  const f = fixture();
  const lits: number[] = [], moves: number[] = [];
  for (let i = 0; i < 4; i++) {
    lits.push(f.route.lit.room.id); expect(f.route.litMoves).toBe(i === 0 ? 0 : i);
    f.messages.length = 0;
    const gate = purifyLit(f);
    moves.push(f.route.litMoves);
    const next = f.route.gates[i + 1];
    const text = i < 3 ? gate.label + ' 정화 · ' + (i + 1) + '/4 · 뿌리 빛이 ' + next.label + '으로 옮겨 갑니다'
      : '포자 정원 제단 정화 · 4/4 · 모든 구역을 정화하면 포자 수로가 열립니다';
    expect(f.messages.filter(m => m === text)).toHaveLength(1);
    // 정화 알림은 점등 이동 토스트 하나뿐이다(부모의 '… 정화 완료 · n/4' 는 순서를 숨기는 정의에서 나오지 않는다).
    expect(f.messages.filter(m => m.startsWith(gate.label + ' 정화'))).toEqual([text]);
    expect(f.messages.filter(m => m.includes('옮겨 갑니다'))).toHaveLength(i < 3 ? 1 : 0);
  }
  expect(lits).toEqual(ALTAR_ORDER); expect(moves).toEqual([1, 2, 3, 3]);
  expect(f.route.lit).toBeNull(); expect(f.route.complete).toBe(true);
  // 정화 직후 litT 는 0 이고 그 뒤 게임 시간으로만 자란다.
  const g = fixture(); purifyLit(g);
  expect(g.route.litT).toBe(0);
  at(g, 5, 20); g.route.update(g.g, .25); g.route.update(g.g, .25);
  expect(g.route.litT).toBeCloseTo(.5, 9);
  g.g.paused = true; g.route.update(g.g, 5); expect(g.route.litT).toBeCloseTo(.5, 9);
});

test('표지: 켜진 제단만 밝히고 번호를 쓰지 않으며, 일반 녹청의 표지는 그대로다', () => {
  // 표지는 영웅이 22 안에 있는 발견된 제단에만 뜨므로 제단 중심마다 서서 그 제단의 표지를 읽는다.
  const cueAt = (f: F, id: number) => { f.labels.length = 0; at(f, id); f.route.update(f.g, 1.9); return [...f.labels]; };   // 1.9초: 표지 주기(1.8초)는 지나고 유지 2초는 채우지 않는다
  const f = fixture();
  for (const r of f.world.rooms) r.discovered = true;
  expect(cueAt(f, 2)).toEqual(['뿌리 빛 · 적 정화']);
  for (const id of [5, 3, 6]) expect(cueAt(f, id)).toEqual(['빛 없음']);
  clearRoom(f, 2); clearRoom(f, 5);
  expect(cueAt(f, 2)).toEqual(['뿌리 빛 · 중심 2초']);
  expect(cueAt(f, 5)).toEqual(['빛 없음 · 밟으면 포자 폭발']);
  expect(cueAt(f, 3)).toEqual(['빛 없음']);
  // 일반 녹청은 번호와 기존 문구를 그대로 쓴다(제단 방 3·2·6).
  const s = fixture('standard');
  for (const r of s.world.rooms) r.discovered = true;
  expect(cueAt(s, 3)).toEqual(['1번 생명 제단 · 적 정화']);
  expect(cueAt(s, 2)).toEqual(['2번 생명 제단 · 순서 대기']);
  clearRoom(s, 6);
  expect(cueAt(s, 6)).toEqual(['3번 생명 제단 · 차례 아님 · 밟으면 포자 폭발']);
});

test('수로는 4/4 와 시작·보스방을 뺀 모든 구역이 정화된 뒤 다음 update 에서 열리고, 열리는 스텝에는 시간이 흐르지 않는다', () => {
  for (const missing of [1, 4, 7]) {
    const f = fixture(); finishAltars(f);
    for (const id of [1, 4, 7]) if (id !== missing) clearRoom(f, id);
    at(f, 6); f.route.update(f.g, 1);
    expect(ch(f).phase).toBe('idle');
    expect(f.route.hint()).toBe('생명 제단 4/4 정화 완료 · 남은 구역 정화');
    clearRoom(f, missing);
    expect(ch(f).phase).toBe('idle');                  // 정화 자체는 수로를 열지 않는다
    f.messages.length = 0;
    f.route.update(f.g, .5);
    expect(ch(f)).toMatchObject({ phase: 'open', clock: 0 });
    expect(ch(f).bands.every((b: any) => b.state === 'calm')).toBe(true);
    expect(f.messages).toContain('포자 수로 개방 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로');
    f.route.update(f.g, .25); expect(ch(f).clock).toBeCloseTo(.25, 9);
  }
  // 제단이 3곳뿐이면 모든 구역이 정화돼도 열리지 않는다(정예방 증원도 모두 마친 상태).
  const g = fixture();
  for (let i = 0; i < 3; i++) purifyLit(g);
  for (const id of [1, 4, 7]) clearRoom(g, id);
  g.route.update(g.g, 1);
  expect(ch(g).phase).toBe('idle'); expect(g.route.complete).toBe(false);
  expect(g.route.autoGoal()).toBeNull();
});

test('수로가 열린 안내와 AUTO 목적지: 열리면 서쪽 입구, 시작 뒤에는 동쪽 출구', () => {
  const f = openedChannel();
  expect(f.route.hint()).toBe('포자 수로 돌파 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로');
  expect(f.route.autoGoal()).toBe(ch(f).entry);
  expect(f.route.canUnseal()).toBe(false);
  expect(f.route.ownsHazards(roomOf(f, 7))).toBe(true); expect(f.route.ownsHazards(roomOf(f, 6))).toBe(false);
  park(f); f.route.update(f.g, 1 / 60);
  expect(ch(f).phase).toBe('running');
  expect(f.route.autoGoal()).toBe(ch(f).exit);
  expect(f.route.hint()).toBe('포자 수로 돌파 · 포자 물결이 지나간 뒤 동쪽 출구로 · ' + ch(f).limit + '초');
  expect(f.route.ownsHazards(roomOf(f, 7))).toBe(true);
});

test('출발선 서쪽 방 안에 들어서야 돌파가 시작되고 제한 시간은 시작 칸의 거리장으로 정해진다', () => {
  const f = openedChannel(), c = ch(f);
  // 방 밖(서쪽 복도), 출발선 동쪽, 방 안이지만 z 가 방 밖인 위치에서는 시작하지 않는다.
  at(f, 7, -14); f.route.update(f.g, .1); expect(c.phase).toBe('open');
  at(f, 7, CH.startLine + .05); f.route.update(f.g, .1); expect(c.phase).toBe('open');
  at(f, 7, CH.startLine - .5, 11); f.route.update(f.g, .1); expect(c.phase).toBe('open');
  expect(c.limit).toBe(0);
  f.messages.length = 0;
  at(f, 7, CH.startLine - 2);
  f.route.update(f.g, .1);
  const dist = flowToExit(f)[idx(f.world, f.g.player.pos.x, f.g.player.pos.z)];
  expect(dist).toBeGreaterThan(0);
  expect(c.phase).toBe('running');
  expect(c.limit).toBe(Math.ceil(dist / CH.pace + CH.grace)); expect(c.left).toBe(c.limit); expect(c.elapsed).toBe(0);
  expect(f.messages).toContain('포자 수로 돌파 시작 · ' + c.limit + '초');
  // 더 서쪽에서 시작하면 거리가 길어 제한 시간이 같거나 늘어난다.
  const g = openedChannel(); at(g, 7, -11.8); g.route.update(g.g, .1);
  expect(ch(g).limit).toBeGreaterThanOrEqual(c.limit);
  // 시작 뒤에는 시계가 흐른다.
  f.route.update(f.g, .5); expect(c.elapsed).toBeCloseTo(.5, 9); expect(c.left).toBeCloseTo(c.limit - .5, 9);
});

test('띠 상태: 서쪽부터 0.8초 간격으로 1초 경고 → 0.7초 분출 → 대기를 4초 주기로 되풀이한다', () => {
  const f = openedChannel(), c = ch(f);
  at(f, 7, 0);            // 띠 사이 안전한 중심에 서서 시간만 흘린다
  const states = () => c.bands.map((b: any) => b.state[0]).join('');
  // 손으로 계산한 표: 띠 i 의 첫 경고는 1+.8i 초, 분출은 2+.8i 초부터 0.7초.
  const timeline: [number, string][] = [[0, 'cccc'], [.9, 'cccc'], [1, 'wccc'], [1.7, 'wccc'], [1.8, 'wwcc'], [2, 'bwcc'], [2.6, 'bwwc'], [2.7, 'cwwc'],
    [2.8, 'cbwc'], [3.4, 'cbww'], [3.5, 'ccww'], [3.6, 'ccbw'], [4.3, 'cccw'], [4.4, 'cccb'], [5, 'wccb'], [5.1, 'wccc'], [6, 'bwcc'], [9.9, 'wwcc']];
  let t = 0;
  for (const [time, expected] of timeline) {
    while (t < time - 1e-6) { f.route.update(f.g, .1); t += .1; }
    expect(c.clock).toBeCloseTo(time, 6);
    expect([time, states()]).toEqual([time, expected]);
  }
  // 분출 번호와 상태 안 경과 시간
  f.route.update(f.g, .1);                       // 10.0초: 띠 0 의 세 번째 분출(2·6·10초)이 막 시작된다
  expect(c.bands[0]).toMatchObject({ state: 'burst', cycle: 2 });
  const g = openedChannel(); at(g, 7, 0);
  for (let i = 0; i < 12; i++) g.route.update(g.g, .1);   // 1.2초: 띠 0 경고 0.2초째
  expect(ch(g).bands[0]).toMatchObject({ state: 'warning', cycle: 0 }); expect(ch(g).bands[0].age).toBeCloseTo(.2, 6);
  expect(ch(g).bands[3]).toMatchObject({ state: 'calm', cycle: -1 });
});

test('분출 중인 띠 안(경계 포함)의 영웅만 분출당 한 번 6% 피해를 받는다', () => {
  const f = openedChannel(), c = ch(f);
  const hero = (dx: number, dz = 0) => at(f, 7, dx, dz);
  const run = (seconds: number, dt = .05) => { for (let i = 0; i < Math.round(seconds / dt); i++) f.route.update(f.g, dt); };
  hero(-1.8);                     // 띠 1 한가운데: 분출은 2.8초
  run(2.7); expect(f.hurts.length).toBe(0);          // 경고 중에는 피해 없음
  run(.15); expect(hurtsOf(f)).toEqual([6]);         // 분출 시작(2.8) 직후 한 번
  expect(c.sporeHits).toBe(1); expect(f.messages).toContain('포자 물결 피격 · 물결이 지나간 뒤 건너기');
  run(.6); expect(f.hurts.length).toBe(1);           // 같은 분출의 나머지 0.7초 동안 다시 맞지 않는다
  run(3.2); expect(f.hurts.length).toBe(1);          // 다음 분출(6.8초) 전
  run(.5); expect(f.hurts.length).toBe(2);           // 다음 주기에는 다시 한 번
  expect(c.sporeHits).toBe(2);
  // 경계 +1.1 은 맞고 +1.15 와 z 가 방 밖이면 맞지 않는다.
  const g = openedChannel(); const gc = ch(g);
  const edge = (dx: number, dz = 0) => { at(g, 7, dx, dz); };
  edge(-1.8 + 1.1); for (let i = 0; i < 60; i++) g.route.update(g.g, .05);
  expect(gc.sporeHits).toBe(1);
  const h = openedChannel();
  at(h, 7, -1.8 + 1.15); for (let i = 0; i < 80; i++) h.route.update(h.g, .05);
  expect(ch(h).sporeHits).toBe(0);
  const k = openedChannel();
  at(k, 7, -1.8, 10.5); for (let i = 0; i < 80; i++) k.route.update(k.g, .05);
  expect(ch(k).sporeHits).toBe(0);
});

test('제한 시간이 다 되면 수로가 범람해 6% 피해를 주고 지금 위치에서 시간을 다시 계산하며 진행은 막지 않는다', () => {
  const f = runningChannel(), c = ch(f);
  const first = c.limit;
  park(f);
  f.messages.length = 0;
  for (let i = 0; i < first * 10 - 1; i++) f.route.update(f.g, .1);
  expect(c.floods).toBe(0);
  f.route.update(f.g, .1);
  expect(c.floods).toBe(1); expect(hurtsOf(f)).toEqual([6]);
  const dist = flowToExit(f)[idx(f.world, f.g.player.pos.x, f.g.player.pos.z)];
  expect(c.limit).toBe(Math.ceil(dist / CH.pace + CH.grace)); expect(c.left).toBe(c.limit);
  expect(f.messages).toContain('포자 수로 범람 · 다시 ' + c.limit + '초');
  expect(c.phase).toBe('running');
  // 더 앞(동쪽)으로 옮긴 위치에서 다시 범람하면 제한 시간이 줄어든다.
  at(f, 7, 0);
  for (let i = 0; i < c.limit * 10; i++) f.route.update(f.g, .1);
  expect(c.floods).toBe(2);
  expect(c.limit).toBeLessThan(first);
  // 범람 뒤에도 도착하면 돌파한다.
  at(f, 7, CH.finishLine + .1); f.route.update(f.g, .05);
  expect(c.phase).toBe('done');
});

test('도착선을 동쪽으로 넘으면 돌파하고 그 자리에서 실제 unsealBoss 가 봉인을 풀며 포탈이 열린다', () => {
  const f = runningChannel(), c = ch(f);
  // 모든 구역이 정화됐어도 돌파 전에는 봉인이 풀리지 않는다(마지막 정화에 붙은 1.2초 타이머 포함).
  for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(f.world.sealed).toBe(true); expect(f.counts.portal).toBe(0); expect(f.route.canUnseal()).toBe(false);
  const phases: string[] = [], unseal = f.g.unsealBoss;
  f.g.unsealBoss = function (this: any) { phases.push(c.phase); return unseal.call(this); };   // 실제 unsealBoss 를 부르되 호출 시점의 phase 를 기록한다
  at(f, 7, CH.finishLine - .05); f.route.update(f.g, 1 / 60);
  expect(c.phase).toBe('running'); expect(f.world.sealed).toBe(true);     // 도착선 바로 앞
  at(f, 7, CH.finishLine + 2, 11); f.route.update(f.g, 1 / 60);
  expect(c.phase).toBe('running');                                          // 방 밖은 도착이 아니다
  f.messages.length = 0;
  at(f, 7, CH.finishLine);
  f.route.update(f.g, 1 / 60);
  expect(c.phase).toBe('done'); expect(phases).toEqual(['done']);
  expect(f.world.sealed).toBe(false); expect(f.counts.portal).toBe(1);
  expect(f.route.canUnseal()).toBe(true); expect(f.route.autoGoal()).toBeNull(); expect(f.route.ownsHazards(roomOf(f, 7))).toBe(false);
  expect(f.messages).toContain('포자 수로 돌파 · 녹청 거수의 봉인이 풀립니다');
  expect(f.route.hint()).toBe('생명 제단 4/4 정화 완료 · 보스 처치');
  // 돌파 뒤에는 시계도 띠도 멈춘다.
  const snap = () => [c.clock, c.left, c.elapsed, c.sporeHits, c.floods].join();
  const before = snap();
  at(f, 7, -5.4); for (let i = 0; i < 80; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before); expect(f.hurts.length).toBe(0);
});

test('같은 스텝에서는 도착이 범람보다 먼저이고, 피격과 범람이 같은 스텝이면 둘 다 적용된다', () => {
  const f = runningChannel(), c = ch(f);
  park(f); c.left = .02;
  at(f, 7, CH.finishLine + .5);
  f.route.update(f.g, .05);
  expect(c.phase).toBe('done'); expect(c.floods).toBe(0); expect(f.hurts.length).toBe(0);
  // 범람이 나는 스텝에 띠 위에 서 있으면 피격(띠 먼저)과 범람이 함께 일어난다.
  const g = runningChannel(), gc = ch(g);
  at(g, 7, -5.4);
  while (gc.bands[0].state !== 'warning') g.route.update(g.g, .05);
  gc.left = 1.1;   // 분출이 시작되는 스텝에서 시간이 다 되도록
  for (let i = 0; i < 200 && gc.floods === 0; i++) g.route.update(g.g, .05);
  expect(gc.floods).toBe(1);
  expect(gc.sporeHits).toBe(1); expect(hurtsOf(g)).toEqual([6, 6]);
});

test('일시정지·사망·보스 처치 동안 시계와 피해는 변하지 않고, 유한하지 않은 dt 는 시간을 진행하지 않는다', () => {
  const f = runningChannel(), c = ch(f);
  at(f, 7, -5.4);
  for (let i = 0; i < 5; i++) f.route.update(f.g, .1);
  const snap = () => [c.clock, c.left, c.elapsed, c.sporeHits, c.floods, f.hurts.length, ...c.bands.map((b: any) => b.state + b.cycle)].join('|');
  const before = snap();
  f.g.paused = true; for (let i = 0; i < 100; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.paused = false; f.g.player.alive = false; for (let i = 0; i < 100; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.player.alive = true; f.g.bossDefeated = true; for (let i = 0; i < 100; i++) f.route.update(f.g, .1);
  expect(snap()).toBe(before);
  f.g.bossDefeated = false;
  for (const dt of [0, -1, NaN, Infinity]) f.route.update(f.g, dt);
  expect(snap()).toBe(before);
  f.route.update(f.g, .1);
  expect(c.clock).toBeCloseTo(before.split('|').map(Number)[0] + .1, 9);
});

test('결과 보고: 제단 보고에 수로 기록이 더해지고 패배·미돌파는 완료가 아니며 한 번 만든 보고는 바뀌지 않는다', () => {
  const lost = runningChannel();
  const loss = lost.route.finish(false);
  expect(loss).toEqual({ id: 'verdigris_root_heart_deep', label: '생명 제단 정화', complete: false, sporeBursts: 0, progress: 4, target: 4,
    rooms: [2, 5, 3, 6], channel: { crossed: false, floods: 0, sporeHits: 0, seconds: 0 } });
  expect(Object.isFrozen(loss)).toBe(true); expect(Object.isFrozen(loss.channel)).toBe(true); expect(Object.isFrozen(loss.rooms)).toBe(true);
  expect(lost.route.finish(true)).toBe(loss);

  // 미돌파인데 보스방이 정화된 것처럼 보여도 승리 완료로 세지 않는다.
  const skip = runningChannel(); skip.world.bossRoom.cleared = true;
  expect(skip.route.canWin()).toBe(false); expect(skip.route.finish(true).complete).toBe(false);

  // 폭발 1회, 피격 1회, 범람 1회를 겪고 돌파하면 실제 값이 기록된다.
  const f = fixture();
  clearRoom(f, 5); at(f, 5); f.route.update(f.g, 1);                        // 차례가 아닌 제단 폭발 1회
  finishAltars(f); for (const id of [1, 4, 7]) clearRoom(f, id);
  at(f, 6); f.route.update(f.g, 1 / 60);
  at(f, 7, -1.8);
  while (ch(f).sporeHits === 0) f.route.update(f.g, .05);
  at(f, 7, CH.startLine - .5);
  f.route.update(f.g, 1 / 60);
  const c = ch(f);
  expect(c.phase).toBe('running');
  c.left = .05; f.route.update(f.g, .1); expect(c.floods).toBe(1);
  at(f, 7, CH.finishLine); f.route.update(f.g, 1 / 60);
  f.world.bossRoom.cleared = true;
  const win = f.route.finish(true);
  expect(win).toEqual({ id: 'verdigris_root_heart_deep', label: '생명 제단 정화', complete: true, sporeBursts: 1, progress: 4, target: 4,
    rooms: [2, 5, 3, 6], channel: { crossed: true, floods: 1, sporeHits: 1, seconds: Math.round(c.elapsed * 100) / 100 } });
  expect(win.channel.seconds).toBeGreaterThan(0);
  expect(f.route.finish(false)).toBe(win);
  // 돌파했어도 패배 보고는 완료가 아니다.
  const g = runningChannel(); at(g, 7, CH.finishLine); g.route.update(g.g, 1 / 60);
  const defeat = g.route.finish(false);
  expect(defeat.complete).toBe(false); expect(defeat.channel.crossed).toBe(true);
  // 정지된 목표는 완료가 아니다.
  const h = runningChannel(); at(h, 7, CH.finishLine); h.route.update(h.g, 1 / 60); h.world.bossRoom.cleared = true;
  h.route.stop();
  expect(h.route.finish(true).complete).toBe(false);
});

test('보물방 2곳(방 2·5)은 공명 대신 제단 정화로 같은 보상을 한 번씩 낸다', () => {
  const f = fixture();
  expect(f.g.stage.expedition.mechanics.attunement).toBe(true);   // 공명 규칙 자체는 켜져 있어도 이 목표가 교체한다
  clearRoom(f, 2);
  expect(f.messages.some(m => m.includes('2초 머물러'))).toBe(false);
  expect(roomOf(f, 2).attunementPending).toBeFalsy(); expect(roomOf(f, 2).cleared).toBe(false); expect(f.g.treasureRooms).toBe(0);
  purifyLit(f);
  expect(roomOf(f, 2).cleared).toBe(true); expect(f.g.treasureRooms).toBe(1);
  expect(f.spawns.filter(s => s.kind === 'stone').map(s => s.value)).toEqual([8]);
  expect(f.spawns.filter(s => s.kind === 'item')).toHaveLength(3);
  purifyLit(f);
  expect(roomOf(f, 5).cleared).toBe(true); expect(f.g.treasureRooms).toBe(2);
  expect(f.spawns.filter(s => s.kind === 'stone').map(s => s.value)).toEqual([8, 8]);
  expect(f.spawns.filter(s => s.kind === 'item')).toHaveLength(6);
  expect(f.messages.filter(m => m === '보물방 클리어!')).toHaveLength(2);
  // 일반방 제단(3·6)도 구역 정화 보상(장비 1개·금화)을 한 번씩 받는다.
  const items = f.spawns.filter(s => s.kind === 'item').length, golds = f.spawns.filter(s => s.kind === 'gold').length;
  purifyLit(f); purifyLit(f);
  expect(f.spawns.filter(s => s.kind === 'item').length - items).toBe(2);
  expect(f.spawns.filter(s => s.kind === 'gold').length - golds).toBe(2);
  expect(f.g.treasureRooms).toBe(2);
});

test('정예방 4·7 은 증원 2회를 겪고, 증원이 남은 방이 있으면 수로는 열리지 않는다', () => {
  const f = fixture(); finishAltars(f);
  clearRoom(f, 1);
  f.g.enterRoom(roomOf(f, 7)); for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === roomOf(f, 7)) e.alive = false;
  f.g.markCleared(roomOf(f, 7));                       // 증원 1회만 겪은 상태
  clearRoom(f, 4);
  expect(roomOf(f, 4).forgeWave).toBe(2); expect(roomOf(f, 4).cleared).toBe(true);
  expect(roomOf(f, 7).forgeWave).toBe(1); expect(roomOf(f, 7).cleared).toBe(false);
  f.route.update(f.g, 1); expect(ch(f).phase).toBe('idle');
  clearRoom(f, 7);
  expect(roomOf(f, 7).forgeWave).toBe(2);
  expect(f.banners.filter(b => b.startsWith('금고 증원')).sort()).toEqual(['금고 증원 1/2', '금고 증원 1/2', '금고 증원 2/2', '금고 증원 2/2']);   // 방 4·7 이 각각 1/2, 2/2
  for (const id of [2, 5, 3, 6]) expect(roomOf(f, id).forgeWave).toBeUndefined();
  f.route.update(f.g, 1); expect(ch(f).phase).toBe('open');
});

test('일반 녹청과 파티·균열·전술 공략 심층은 포자 수로 없이 기존 규칙 그대로다', () => {
  const s = fixture('standard');
  expect(s.route.constructor).toBe(RouteObjectives);
  expect(s.route.def.id).toBe('verdigris_life_altars');
  expect('channel' in s.route).toBe(false); expect(s.route.autoGoal).toBeUndefined();
  expect(s.route.hint()).toBe('생명 제단 0/3 · 다음 포자 둥지 제단 · 적 처치 후 중심 2초'.replace('포자 둥지 제단', s.route.gates[0].label));
  expect(s.route.finish(false)).not.toHaveProperty('channel');
  const base: any = fixture().stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    { ...base, expedition: { ...base.expedition, riftId: 'x' } }, { ...base, expedition: { ...base.expedition, conquestId: 'x' } },
    { ...base, expedition: { ...base.expedition, depth: 'unknown' } }]) {
    expect(routeObjectiveForStage(stage)).toBeNull();
    expect(createRouteObjectives(stage, s.world)).toBeNull();
  }
  // 다른 심층의 목표는 바뀌지 않는다.
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth: 'deep' }))?.id).toBe('sable_mirror_thrones_deep');
});

test('갱신은 난수·시계를 쓰지 않고 수로 객체와 띠 배열을 재사용한다', () => {
  const f = openedChannel(); const c = ch(f), bands = c.bands, first = bands[0];
  const random = Math.random, now = Date.now, perf = performance.now;
  Math.random = () => { throw new Error('난수 사용'); }; Date.now = () => { throw new Error('시계 사용'); }; performance.now = () => { throw new Error('시계 사용'); };
  try {
    at(f, 7, 0);
    for (let i = 0; i < 600; i++) f.route.update(f.g, 1 / 60);
    park(f); for (let i = 0; i < 60; i++) f.route.update(f.g, 1 / 60);
  } finally { Math.random = random; Date.now = now; performance.now = perf; }
  expect(f.route.channel).toBe(c); expect(c.bands).toBe(bands); expect(c.bands[0]).toBe(first);
});

function fakeView(f: F) {
  const calls: [string, number, boolean][] = [];
  const view = { update: (_r: any, dt: number, o: any) => calls.push(['view', dt, o.reduced]), disposed: 0, dispose() { this.disposed++; } };
  f.route.view = view;
  return { calls, view };
}

test('뷰 연결: 부모가 그린 뒤 바뀐 상태만 dt 0 으로 한 번 더 맞추고, 일시정지에는 갱신하지 않으며, stop 이 한 번 해제한다', () => {
  const f = fixture(), v = fakeView(f);
  f.g.app.reducedMotion = { matches: true };
  at(f, 3); f.route.update(f.g, .1);
  expect(v.calls).toEqual([['view', .1, true]]);                       // 변화 없는 스텝은 부모의 한 번만
  v.calls.length = 0;
  const room2 = roomOf(f, 2);
  f.g.enterRoom(room2); for (const timer of f.g.timers.splice(0)) timer.fn();   // 방 발견은 Battle 이 부르는 기존 syncView
  v.calls.length = 0;
  for (const e of f.g.enemies) if (e.homeRoom === room2) e.alive = false;
  f.g.markCleared(room2);                                              // 제단 방 준비는 update 밖(Battle.markCleared)에서 일어난다
  expect(gateOf(f, 2).ready).toBe(true);
  expect(v.calls).toEqual([['view', 0, true]]);
  v.calls.length = 0;
  at(f, 2); for (let i = 0; i < 3; i++) f.route.update(f.g, .5);
  expect(v.calls.map(c => c[1])).toEqual([.5, .5, .5]);
  f.route.update(f.g, .5);                                             // 정화 스텝: 점등 이동이 보이도록 dt 0 갱신이 이어진다
  expect(v.calls.map(c => c[1])).toEqual([.5, .5, .5, .5, 0]);
  // 일시정지
  f.g.paused = true; v.calls.length = 0;
  f.route.update(f.g, .5); f.route.syncView(f.g);
  expect(v.calls).toEqual([]);
  f.g.paused = false;
  f.route.stop(); f.route.stop();
  expect(v.view.disposed).toBe(1); expect(f.route.view).toBeNull();
  expect(f.route.closed).toBe(true); expect(f.route.lit).toBeNull();
});

test('수로 상태가 바뀌는 스텝(열림·시작·띠 전환)에도 뷰를 dt 0 으로 다시 맞춘다', () => {
  const f = fixture(); finishRooms(f);
  const v = fakeView(f);
  at(f, 6); f.route.update(f.g, 1 / 60);
  expect(ch(f).phase).toBe('open'); expect(v.calls.map(c => c[1])).toEqual([1 / 60, 0]);
  v.calls.length = 0;
  at(f, 7, 0); f.route.update(f.g, .5);
  expect(v.calls.map(c => c[1])).toEqual([.5]);                        // 변화 없음
  v.calls.length = 0;
  f.route.update(f.g, .5);                                             // 0.5 → 1.0: 첫 띠가 경고로 바뀐다
  expect(ch(f).bands[0].state).toBe('warning'); expect(v.calls.map(c => c[1])).toEqual([.5, 0]);
});

test('prepareView 는 뷰 파일이 없거나 실패해도 던지지 않고, 만들어진 뷰는 stop 이 해제하며, 정지된 목표에는 붙이지 않는다', async () => {
  const f = fixture();
  await expect(f.route.prepareView(new Scene())).resolves.toBeUndefined();
  // 뷰 파일이 있는 통합 빌드에서는 update 가능한 뷰, 없는 브랜치에서는 null. 어느 쪽이든 규칙은 그대로 돈다.
  if (f.route.view) expect(typeof f.route.view.update).toBe('function');
  f.route.update(f.g, .1);
  f.route.stop();
  expect(f.route.view).toBeNull();
  await f.route.prepareView(new Scene());
  expect(f.route.view).toBeNull();
  const g = fixture(); await expect(g.route.prepareView(null)).resolves.toBeUndefined();
  g.route.stop();
});

// ---------------- AUTO 모의 ----------------
// 영웅 속도 근거(src/data/heroes.js base.spd): 마법사 5.6(가장 느림), 야만전사 5.8, 기사 6.2, 궁수 6.6, 도적 7.2(가장 빠름).
// 실제 달리기는 0.7초 넘게 달리면 최대 1.45배 가속하므로 여기 두 값은 가속 전 하한과 상한이다.
// 이동은 실제 Player.autoExplore 의 방향 + 실제 벽 충돌(world.resolve), 판정은 실제 규칙 update 를 쓴다.
const DT = 1 / 60;
function walk(f: F, speed: number, until: () => boolean, maxSeconds: number) {
  const ctx: any = { game: f.g, pos: f.g.player.pos };
  const random = Math.random;
  Math.random = () => { throw new Error('AUTO 이동이 난수를 소비했다'); };
  try {
    for (let i = 0; i < maxSeconds / DT && !until(); i++) {
      const dir = Player.prototype.autoExplore.call(ctx, DT);
      const p = f.g.player.pos, next = f.world.resolve(p.x, p.z, p.x + dir.x * speed * DT, p.z + dir.y * speed * DT, .55);
      p.set(next[0], 0, next[1]);
      f.route.update(f.g, DT);
    }
  } finally { Math.random = random; }
}

// 제단 모의(PLAN 3.5): 네 제단 방을 미리 정리해 두고(전투는 모의하지 않는다) 켜진 제단까지 걸어가 정화한다. 지나가는 비점등 제단의 폭발 수를 기록한다.
const ALTAR_CASES: [number, number[]][] = [[1, [2, 1, 3]], [2, [5, 4, 6]], [3, [3, 4, 2]]];   // [이미 정화한 제단 수, 영웅이 출발하는 방]
for (const [done, starts] of ALTAR_CASES) for (const start of starts) test('AUTO 제단 모의: 제단 ' + done + '곳 정화 뒤 방 ' + start + '에서 출발해 방 ' + ALTAR_ORDER[done] + ' 제단을 정화한다', () => {
  const f = fixture();
  for (const id of ALTAR_ORDER) clearRoom(f, id);
  for (let i = 0; i < done; i++) { at(f, f.route.lit.room.id); for (let k = 0; k < 4; k++) f.route.update(f.g, .5); }
  expect(f.route.progress).toBe(done);
  const bursts = f.route.bursts;
  at(f, start);
  walk(f, 5.6, () => f.route.progress > done, 120);
  expect(f.route.progress).toBe(done + 1);
  expect(f.route.litMoves).toBe(Math.min(done + 1, 3));
  expect(roomOf(f, ALTAR_ORDER[done]).cleared).toBe(true);
  // 지나가는 비점등 제단에서 포자 폭발이 한 번도 터지지 않는다(9개 출발 조합 모두 실측 0회).
  expect(f.route.bursts - bursts).toBe(0);
});

// 수로 모의(PLAN 3.5): 열리는 순간의 영웅 위치 4곳 × 열린 뒤 AUTO 가 움직이기 시작하는 위상 0~3.9초(0.1초 간격) × 속도 2가지.
const CHANNEL_STARTS: [string, (f: F) => void][] = [
  ['방 6 중심', f => at(f, 6)],
  ['방 7 중심(서쪽으로 되돌아가야 함)', f => at(f, 7)],
  ['방 7 의 x +8(도착선 근처, 서쪽으로 되돌아가야 함)', f => at(f, 7, 8)],
  ['방 1 중심', f => at(f, 1)],
];
for (const speed of [5.6, 7.2]) for (const [name, place] of CHANNEL_STARTS) test('AUTO 수로 모의: ' + name + ' · 속도 ' + speed + ' 에서 모든 시작 위상에 범람 0·포자 피격 0 으로 돌파한다', () => {
  let longest = 0;
  for (let phase = 0; phase < 40; phase++) {
    const f = fixture(); finishRooms(f);
    place(f); f.route.update(f.g, DT);
    const c = ch(f);
    expect(c.phase).toBe('open');
    for (let i = 0; i < Math.round(phase * 0.1 / DT); i++) f.route.update(f.g, DT);   // AUTO 가 움직이기 전 흐른 시간(영웅은 제자리)
    walk(f, speed, () => c.phase === 'done', 60);
    const label = name + ' 속도 ' + speed + ' 위상 ' + (phase / 10).toFixed(1);
    expect([label, c.phase, c.floods, c.sporeHits, f.hurts.length]).toEqual([label, 'done', 0, 0, 0]);
    expect(f.world.sealed).toBe(false);
    longest = Math.max(longest, c.elapsed / c.limit);
  }
  // 가장 오래 걸린 돌파도 제한 시간의 일부만 쓴다(여유 확인).
  expect(longest).toBeLessThan(.85);
}, 60000);

test('AUTO 대기: 진행 방향 앞 띠를 지금 건너면 위험할 때만 제자리에 서고, 띠 안에서는 앞으로 빠진다', () => {
  const f = runningChannel(), c = ch(f);
  const first = c.bands[0];
  const state = (s: string, age: number) => { first.state = s; first.age = age; first.cycle = s === 'calm' ? 0 : 1; };
  const wait = (x: number, z = 0) => { at(f, 7, x, z); return f.route.autoGoal() === f.g.player.pos; };
  // 첫 띠 서쪽 가장자리는 -6.5. 접근 거리(1) 안에서 분출 중이면 선다.
  state('burst', .3); expect(wait(-7.2)).toBe(true);
  state('warning', .1); expect(wait(-7.2)).toBe(false);       // 분출까지 0.9초: 접근과 건너는 시간(약 0.6초)보다 여유가 있어 건넌다
  state('warning', .3); expect(wait(-7.2)).toBe(true);        // 분출까지 0.7초는 기다린다
  state('warning', .9); expect(wait(-7.2)).toBe(true);
  state('calm', 0); expect(wait(-7.2)).toBe(false);            // 분출이 막 끝난 대기
  state('calm', 2.2); expect(wait(-7.2)).toBe(false);          // 다음 경고 직전의 대기(분출까지 1.1초)
  state('burst', .3);
  expect(wait(-8.2)).toBe(false);                             // 접근 거리 밖은 계속 걷는다
  expect(wait(-5.4)).toBe(false);                             // 띠 안에서는 앞으로 빠진다
  expect(wait(-6.5)).toBe(false);                             // 가장자리 위(gap 0)는 이미 띠에 들어선 것으로 본다
  expect(wait(-7.2, 11)).toBe(false);                         // 방 밖 z 는 띠와 무관
  expect(f.route.autoGoal()).toBe(c.exit);
  // 서쪽으로 돌아가는 영웅(열림 단계)은 띠 동쪽 가장자리 앞에서 같은 규칙으로 선다.
  const g = openedChannel(), gc = ch(g), b0 = gc.bands[0];
  b0.state = 'burst'; b0.age = .3; b0.cycle = 1;
  at(g, 7, -5.4 + 1.1 + .5);                                  // 첫 띠 동쪽 0.5m
  g.route.update(g.g, 0);                                     // dt 0 은 시간을 진행하지 않지만 영웅 위치는 기억한다
  expect(g.route.autoGoal()).toBe(g.g.player.pos);
  expect(gc.phase).toBe('open');
});
