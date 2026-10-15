import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Vector3 } from 'three';
import { audio } from '../src/engine/audio.js';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives, RouteObjectives } from '../src/game/route-objectives.js';
import { BellfallDeepBells } from '../src/game/bellfall-deep-bells.js';
import { Battle } from '../src/game/battle-base.js';
import { Player } from '../src/game/player.js';

const noop = () => {};
const DEF = ROUTE_OBJECTIVES.bellfall_deep;
const DT = 1 / 60;
// 소등 순서(방 id) 3 → 5 → 2, 정답은 그 역순 2 → 5 → 3. 테스트는 정의에 적힌 값을 독립 상수로 다시 적어 둔다.
const TOLL_ROOMS = [3, 5, 2];
const ANSWER_ROOMS = [2, 5, 3];

const sounds: Record<string, number[]> = { ting: [], magic: [], boom: [] };
let restores: Array<() => void> = [];
beforeEach(() => {
  for (const key of Object.keys(sounds)) sounds[key] = [];
  restores = (['ting', 'magic', 'boom'] as const).map(key => {
    const spy = spyOn(audio as any, key).mockImplementation((opts: any) => { sounds[key].push(opts?.freq ?? opts?.base ?? 0); });
    return () => spy.mockRestore();
  });
});
afterEach(() => { for (const restore of restores) restore(); });

function deepStage() { return buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' }); }

/** 실제 심층 월드와 컨트롤러에 가짜 game 을 붙인다. Battle.markCleared 의 combatPending·beforeClear 규칙만 흉내 낸다. */
function fixture(def: any = DEF) {
  const stage = deepStage();
  const world = buildExpeditionWorld(stage);
  const route = new BellfallDeepBells(def, world) as any;
  const toasts: string[] = [], hurts: Array<[number, any]> = [], cleared: number[] = [];
  let objectives = 0;
  const game: any = {
    world, active: true, paused: false, bossDefeated: false, enemies: [] as any[], pending: [] as any[], autoTarget: null,
    player: { alive: true, maxHp: 100, pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      hurt: (n: number, o: any) => { hurts.push([n, o]); return true; } },
    ui: { toast: (t: string) => toasts.push(t), setObjective: () => { objectives++; } },
    fx: { castCircle: noop },
    markCleared(room: any) {
      if (room.cleared) return;
      if (route.combatPending(game, room)) return;
      if (route.beforeClear(game, room)) return;
      room.cleared = true;
    },
  };
  // 정답 순서를 기록하려고 markCleared 호출 자체를 따로 센다.
  const rawMark = game.markCleared;
  game.markCleared = (room: any) => { cleared.push(room.id); rawMark(room); };
  return { stage, world, route, game, toasts, hurts, cleared, objectiveCount: () => objectives };
}
type F = ReturnType<typeof fixture>;
const room = (f: F, id: number) => f.world.rooms[id];
const gateOf = (f: F, id: number): any => f.route.gates.find((g: any) => g.room.id === id);
/** 방 안 적을 모두 처치한 상태로 만들고 Battle.markCleared 가 부르는 beforeClear 를 호출한다. */
function lightRoom(f: F, id: number) {
  const r = room(f, id);
  f.route.prepareRoom(r, 1); r.spawned = true; f.route.spawn(r);
  f.game.enemies.push({ alive: false, homeRoom: r });
  return f.route.beforeClear(f.game, r);
}
function lightAll(f: F, ids = [2, 3, 5]) { for (const id of ids) lightRoom(f, id); }
function stand(f: F, id: number, dx = 0) { f.game.player.pos.set(room(f, id).x + dx, 0, room(f, id).z); }
function run(f: F, seconds: number, dt = DT) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) f.route.update(f.game, dt);
}
/** 소등이 끝나 공명 단계가 될 때까지(영웅은 지금 위치 그대로) 1/60초로 진행한다. */
function toAnswer(f: F) { run(f, 4.8); expect(f.route.phase).toBe('answer'); }
function snapshot(f: F) {
  const r = f.route;
  return JSON.stringify({ phase: r.phase, progress: r.progress, lit: r.lit, discords: r.discords, tolls: r.tolls, tollIndex: r.tollIndex,
    clock: Math.round(r.tollClock * 1e6) / 1e6, hold: Math.round(r.hold * 1e6) / 1e6, holdRoom: r.holdGate?.room.id ?? null,
    phases: r.gates.map((g: any) => g.phase), hurts: f.hurts.map(h => h[0]), toasts: f.toasts, cleared: f.cleared });
}

// ---------------- 선택과 월드 ----------------

test('1. 심층 월드에서 방 2·3·5는 봉인 상태로 도달 가능하고 보스방은 닫혀 있다', () => {
  const f = fixture();
  const world: any = f.world;
  expect(world.sealed).toBe(true);
  expect(DEF.gates.map(g => g.roomId)).toEqual([2, 3, 5]);
  expect(world.rooms.map((r: any) => r.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'elite', 'treasure', 'normal', 'elite', 'boss']);
  const cell = (r: any) => Math.floor(r.z - world.minZ) * world.cols + Math.floor(r.x - world.minX);
  // 시작 방과 세 종문 어디에서 출발해도 나머지 종문 중심까지 걸어갈 수 있다.
  for (const from of [0, 2, 3, 5]) {
    const flow = world.buildFlow(world.rooms[from].x, world.rooms[from].z)!;
    for (const target of [2, 3, 5]) expect(flow[cell(world.rooms[target])]).toBeGreaterThanOrEqual(0);
    expect(flow[cell(world.bossRoom)]).toBe(-1);
  }
  for (const id of [2, 3, 5]) expect(world.walkable(world.rooms[id].x, world.rooms[id].z)).toBe(true);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 3, 5]);
  expect(f.route.gates.map((g: any) => [g.index, g.number, g.phase, g.label])).toEqual([
    [0, 1, 'locked', '1번 종문 · 북쪽 예배실'], [1, 2, 'locked', '2번 종문 · 북동쪽 종탑'], [2, 3, 'locked', '3번 종문 · 남쪽 납골실']]);
  for (const g of f.route.gates) {
    expect(g.room.label).toBe(g.label); expect(g.room.objectiveProp).toBe('bellfall-bell');
    expect(g.center.x).toBe(g.room.x); expect(g.center.z).toBe(g.room.z);
    expect(g).toMatchObject({ prepared: false, expected: 0, spawned: 0, purgePending: false });
  }
});

test('2. 개인 기본 원정의 심층만 BellfallDeepBells 를 고르고 일반판·파티·균열·정복은 그대로다', () => {
  const stage: any = deepStage();
  const world = buildExpeditionWorld(stage);
  expect(routeObjectiveForStage(stage)).toBe(DEF);
  expect(createRouteObjectives(stage, world)).toBeInstanceOf(BellfallDeepBells);
  const standard: any = buildExpeditionStage('dungeon', 'bellfall_crypt', null);
  const standardRoute = createRouteObjectives(standard, buildExpeditionWorld(standard));
  expect(standardRoute).toBeInstanceOf(RouteObjectives);
  expect(standardRoute).not.toBeInstanceOf(BellfallDeepBells);
  for (const change of [{ party: {} }, { riftId: 'iron' }, { expedition: { ...stage.expedition, conquestId: 'fake' } },
    { expedition: { ...stage.expedition, riftId: 'iron' } }, { expedition: { ...stage.expedition, kind: 'arena' } },
    { expedition: { ...stage.expedition, depth: 'unknown' } }, { expedition: undefined }]) {
    expect(createRouteObjectives({ ...stage, ...change }, world)).toBeNull();
  }
  // 다른 심층 원정의 선택은 바뀌지 않는다.
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'nightglass_observatory', null, { depth: 'deep' }))?.id).toBe('nightglass_records_deep');
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth: 'deep' }))?.id).toBe('sable_mirror_thrones_deep');
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'verdigris_sanctum', null, { depth: 'deep' }))?.id).toBe('verdigris_root_heart_deep');
});

test('3. 생성자는 소등 순서가 종문 방의 순열이 아니면 RangeError, 시작·보스방과 지도 없는 월드도 거부한다', () => {
  const world = buildExpeditionWorld(deepStage());
  for (const tollOrder of [[3, 5], [3, 5, 2, 2], [3, 3, 2], [3, 5, 4], [1, 5, 2], [0, 5, 2], undefined, 'ab']) {
    expect(() => new BellfallDeepBells({ ...DEF, tollOrder } as any, world)).toThrow(RangeError);
  }
  // 순열이면 어떤 순서든 받아들이고, 정답은 그 역순이다.
  expect(() => new BellfallDeepBells({ ...DEF, tollOrder: [2, 3, 5] } as any, buildExpeditionWorld(deepStage()))).not.toThrow();
  for (const roomId of [0, 8, 99]) {
    const gates = [{ ...DEF.gates[0], roomId }, DEF.gates[1], DEF.gates[2]];
    expect(() => new BellfallDeepBells({ ...DEF, gates, tollOrder: [3, 5, roomId] } as any, world)).toThrow(RangeError);
  }
  expect(() => new BellfallDeepBells(DEF as any, { ...world, minX: undefined } as any)).toThrow(RangeError);
});

// ---------------- 점등 ----------------

test('4. 적·대기 증원이 남아 있거나 아직 소환 전이면 켜지지 않고, 모두 정리된 첫 시점에 켜진다', () => {
  const f = fixture(), r2 = room(f, 2);
  expect(f.route.beforeClear(f.game, r2)).toBe(true);
  expect(f.route.combatPending(f.game, r2)).toBe(true);
  expect(gateOf(f, 2).phase).toBe('locked');
  f.route.prepareRoom(r2, 2); (r2 as any).spawned = true; f.route.spawn(r2);
  expect(f.route.combatPending(f.game, r2)).toBe(true);        // 두 마리 중 한 마리만 소환됨
  f.route.spawn(r2);
  const alive = { alive: true, homeRoom: r2 };
  f.game.enemies.push(alive); f.game.pending.push({ room: r2 });
  f.route.beforeClear(f.game, r2); expect(gateOf(f, 2).phase).toBe('locked');
  alive.alive = false; f.route.beforeClear(f.game, r2); expect(gateOf(f, 2).phase).toBe('locked');   // 대기 증원
  f.game.pending.length = 0;
  f.game.paused = true; f.route.beforeClear(f.game, r2); expect(gateOf(f, 2).phase).toBe('locked');  // 일시정지 중에는 켜지지 않는다
  f.game.paused = false;
  expect(f.route.beforeClear(f.game, r2)).toBe(true);
  expect(gateOf(f, 2).phase).toBe('lit');
  expect(f.toasts).toEqual(['1번 종문 · 북쪽 예배실 점등 · 종 1/3']);
  expect(f.route.lit).toBe(1); expect(f.route.phase).toBe('wake'); expect(f.route.tolls).toBe(0);
  expect(f.route.beforeClear(f.game, room(f, 1))).toBe(false);   // 종문이 아닌 방은 그대로 통과
});

test('5. update 만으로도 적이 정리된 방의 종이 켜지고, 세 번째 점등에서 소등 재생이 시작된다', () => {
  const f = fixture();
  for (const id of [5, 3]) {
    const r = room(f, id); f.route.prepareRoom(r, 1); (r as any).spawned = true; f.route.spawn(r);
    f.game.enemies.push({ alive: true, homeRoom: r });
  }
  f.route.update(f.game, DT);
  expect(f.route.lit).toBe(0);
  for (const e of f.game.enemies) e.alive = false;
  f.route.update(f.game, DT);
  expect(gateOf(f, 3).phase).toBe('lit'); expect(gateOf(f, 5).phase).toBe('lit'); expect(gateOf(f, 2).phase).toBe('locked');
  expect(f.route.phase).toBe('wake');
  lightRoom(f, 2);
  expect(f.route.phase).toBe('toll'); expect(f.route.tolls).toBe(1); expect(f.route.lit).toBe(3);
  expect(f.toasts.filter(t => t.includes('점등'))).toHaveLength(3);
  expect(f.toasts.filter(t => t.includes('점등')).at(-1)).toContain('종 3/3');
  expect(f.route.tollIndex).toBe(0); expect(f.route.lastToll).toBeNull();
});

// ---------------- 소등 ----------------

test('6. 소등은 1.0·2.4·3.8초에 3 → 5 → 2번 방 순서로 일어나고 4.8초에 공명 단계가 된다', () => {
  const f = fixture(); lightAll(f);
  const seen: Array<{ clock: number; room: number; index: number }> = [];
  let answerAt = -1, last = 0;
  for (let step = 1; step <= 300; step++) {
    f.route.update(f.game, DT);
    if (f.route.tollIndex > last) { last = f.route.tollIndex; seen.push({ clock: f.route.tollClock, room: f.route.lastToll.room.id, index: f.route.tollIndex }); }
    if (answerAt < 0 && f.route.phase === 'answer') answerAt = f.route.tollClock;
    // 소등 전에는 켜진 종이 그대로이고, 소등된 종만 dark 다.
    expect(f.route.gates.filter((g: any) => g.phase === 'dark').length).toBe(f.route.tollIndex);
  }
  expect(seen.map(s => s.room)).toEqual(TOLL_ROOMS);
  expect(seen.map(s => s.index)).toEqual([1, 2, 3]);
  [1.0, 2.4, 3.8].forEach((t, i) => expect(seen[i].clock).toBeCloseTo(t, 6));
  expect(answerAt).toBeCloseTo(4.8, 6);
  expect(f.route.tolls).toBe(1);
  expect(f.route.lastToll).toBeNull();          // 소등 재생 밖에서는 null
  expect(f.route.tollClock).toBeCloseTo(4.8, 6); // 공명 단계에서는 시계가 더 흐르지 않는다
  // 첫 소등 직전 프레임에는 아무것도 꺼지지 않았다.
  const g = fixture(); lightAll(g); run(g, 59 / 60);
  expect(g.route.tollIndex).toBe(0); expect(g.route.lastToll).toBeNull();
});

test('7. 1/60초 스텝과 dt=5 한 번은 같은 사건 순서와 같은 상태를 만든다(영웅이 첫 정답 종 위에 선 경우)', () => {
  const a = fixture(); lightAll(a); stand(a, 2);
  const b = fixture(); lightAll(b); stand(b, 2);
  sounds.ting = [];
  run(a, 5);
  const stepped = sounds.ting.slice(); sounds.ting = [];
  b.route.update(b.game, 5);
  const bulk = sounds.ting.slice();
  expect(bulk).toEqual(stepped);
  expect(bulk).toHaveLength(3);                       // 소등 종소리 세 번
  expect(new Set(bulk).size).toBe(3);                 // 종마다 높이가 달라 소리로 순서를 기억할 수 있다
  expect(snapshot(b)).toBe(snapshot(a));
  expect(b.route.phase).toBe('answer'); expect(b.route.tollIndex).toBe(3);
  // 4.8초에 공명 단계가 되고 남은 0.2초가 바로 유지로 쌓인다.
  expect(b.route.hold).toBeCloseTo(0.2, 6); expect(b.route.holdGate.room.id).toBe(2);
  b.route.update(b.game, 1.79); expect(b.route.progress).toBe(0);
  b.route.update(b.game, 0.02); expect(b.route.progress).toBe(1);
});

test('8. 불협을 거쳐 dt=10 한 번을 넘겨도 1/60초 스텝과 같은 결과다', () => {
  const a = fixture(); lightAll(a); stand(a, 3);
  const b = fixture(); lightAll(b); stand(b, 3);
  run(a, 10);
  b.route.update(b.game, 10);
  expect(snapshot(b)).toBe(snapshot(a));
  // 4.8초 소등 + 2초 유지(오답) = 6.8초에 불협, 남은 3.2초로 소등을 다시 재생하는 중이다.
  expect(b.route.discords).toBe(1); expect(b.route.tolls).toBe(2);
  expect(b.route.phase).toBe('toll'); expect(b.route.tollIndex).toBe(2);
  expect(b.route.tollClock).toBeCloseTo(3.2, 6);
  expect(b.route.discordT).toBeCloseTo(3.2, 6);
});

test('9. 같은 시나리오를 1/60, 1/30, 0.05, 0.25 스텝으로 돌려도 사건 순서가 같다', () => {
  const results = [DT, 1 / 30, 0.05, 0.25].map(dt => {
    const f = fixture(); lightAll(f, [5, 2, 3]);
    stand(f, 3); run(f, 7, dt);       // 소등 4.8초 + 오답 유지 2초(6.8초에 불협) + 다시 소등 0.2초
    stand(f, 2); run(f, 6.75, dt);    // 소등을 마저 듣고(11.6초) 2번 방에서 2초(13.6초에 공명)
    stand(f, 5); run(f, 2, dt);
    stand(f, 3); run(f, 2, dt);
    return f;
  });
  const first = snapshot(results[0]);
  expect(results[0].route.complete).toBe(true);
  expect(results[0].cleared).toEqual(ANSWER_ROOMS);
  for (const f of results) {
    expect(f.route.complete).toBe(true);
    expect(f.route.discords).toBe(1);
    expect(f.cleared).toEqual(ANSWER_ROOMS);
    expect(f.toasts).toEqual(results[0].toasts);
  }
  expect(first).toContain('"discords":1');
});

test('10. 소등 재생 중에는 소등된 종 위에 서 있어도 유지 시간이 쌓이지 않는다', () => {
  const f = fixture(); lightAll(f); stand(f, 3);
  for (let i = 0; i < 280; i++) {                 // 4.67초: 아직 소등 재생 중
    f.route.update(f.game, DT);
    expect(f.route.phase).toBe('toll');
    expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull();
  }
  expect(gateOf(f, 3).phase).toBe('dark');
});

// ---------------- 역순 공명 ----------------

test('11. 정답은 소등의 역순인 방 2 → 5 → 3 이고, 매번 2초 유지가 필요하다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f);
  f.route.interrupt();
  run(f, 1.9); expect(f.route.progress).toBe(0); expect(f.route.hold).toBeCloseTo(1.9, 6); expect(f.route.holdGate).toBe(gateOf(f, 2));
  run(f, 0.1); expect(f.route.progress).toBe(1);
  expect(gateOf(f, 2).phase).toBe('resonated'); expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull();
  expect(f.toasts.at(-1)).toBe('1번 종문 · 북쪽 예배실 공명 · 1/3');
  stand(f, 5); run(f, 1.95); expect(f.route.progress).toBe(1); run(f, 0.05); expect(f.route.progress).toBe(2);
  expect(f.cleared).toEqual([]);                   // 3/3 전에는 방을 정화하지 않는다
  stand(f, 3); run(f, 2);
  expect(f.route.progress).toBe(3); expect(f.route.phase).toBe('done'); expect(f.route.complete).toBe(true);
  expect(f.route.discords).toBe(0); expect(f.hurts).toHaveLength(0);
});

test('12. 1.9초 머물다 반경 밖으로 나가면 오답이 아니라 유지만 0이 되고, 다시 2초를 채워야 한다', () => {
  const f = fixture(); lightAll(f); stand(f, 3); toAnswer(f);
  run(f, 1.9);                                     // 오답 종(3번 방)에 1.9초
  expect(f.route.holdGate).toBe(gateOf(f, 3));
  stand(f, 3, DEF.radius + 0.01); f.route.update(f.game, DT);
  expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull();
  expect(f.route.discords).toBe(0); expect(f.hurts).toHaveLength(0); expect(f.route.phase).toBe('answer');
  // 경계(반경 3)는 안쪽이다.
  stand(f, 3, DEF.radius); f.route.update(f.game, DT); expect(f.route.holdGate).toBe(gateOf(f, 3));
  stand(f, 3, DEF.radius - 0.01); run(f, 1.9); expect(f.route.discords).toBe(0);
  // 다른 종으로 옮기면 유지가 새로 시작되고, 그 종이 정답이면 2초 뒤 공명한다.
  stand(f, 2); f.route.update(f.game, DT);
  expect(f.route.holdGate).toBe(gateOf(f, 2)); expect(f.route.hold).toBeCloseTo(DT, 6);
  run(f, 1.95); expect(f.route.progress).toBe(0); run(f, 0.05); expect(f.route.progress).toBe(1);
  expect(f.route.discords).toBe(0);
});

test('13. 오답 2초는 불협: 최대 체력 6% 피해·넉백, 모든 종 점등, 진행 0, 소등을 다시 재생한다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f);
  run(f, 2); expect(f.route.progress).toBe(1);     // 2번 방 정답
  stand(f, 3, 1);                                  // 다음 정답은 5번 방인데 3번 방에 선다
  run(f, 1.95); expect(f.hurts).toHaveLength(0);
  run(f, 0.05);
  expect(f.hurts).toHaveLength(1);
  const [amount, opts] = f.hurts[0];
  expect(amount).toBeCloseTo(100 * 0.06, 9);
  expect(opts).toMatchObject({ kb: 2, kind: 'magic' });
  expect(Math.hypot(opts.dirx, opts.dirz)).toBeCloseTo(1, 9);
  expect(opts.dirx).toBeGreaterThan(0);            // 종 중심에서 영웅 쪽으로 밀어낸다
  expect(f.route.discords).toBe(1); expect(f.route.lastDiscord).toBe(gateOf(f, 3));
  expect(f.route.progress).toBe(0); expect(f.route.tolls).toBe(2);
  expect(f.route.phase).toBe('toll'); expect(f.route.tollIndex).toBe(0); expect(f.route.tollClock).toBe(0);
  expect(f.route.gates.map((g: any) => g.phase)).toEqual(['lit', 'lit', 'lit']);   // 공명했던 2번 방 종도 다시 켜진다
  expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull();
  expect(f.route.discordT).toBe(0);
  expect(f.route.lastToll).toBeNull();
  expect(f.toasts.some(t => t.includes('불협'))).toBe(true);
  // 처음부터 다시 소등되고(3 → 5 → 2), 같은 정답으로 완주할 수 있다.
  f.route.update(f.game, DT); expect(f.route.discordT).toBeCloseTo(DT, 9);
  stand(f, 2); run(f, 4.8 - DT); expect(f.route.phase).toBe('answer');
  expect(f.route.gates.every((g: any) => g.phase === 'dark')).toBe(true);
  expect(f.route.progress).toBe(0);
  run(f, 2); stand(f, 5); run(f, 2); stand(f, 3); run(f, 2);
  expect(f.route.complete).toBe(true); expect(f.route.discords).toBe(1); expect(f.route.tolls).toBe(2);
  expect(f.cleared).toEqual(ANSWER_ROOMS);
});

test('14. 공명이 끝난 종 위에서는 아무 일도 일어나지 않는다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f);
  run(f, 2); expect(f.route.progress).toBe(1);
  run(f, 10);                                      // 공명한 2번 종 위에 계속 머문다
  expect(f.route.progress).toBe(1); expect(f.route.discords).toBe(0); expect(f.hurts).toHaveLength(0);
  expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull();
});

test('15. 불협 1회는 guide 가 없고 2회부터 공명 단계에서 다음 정답 종을 알려준다', () => {
  const f = fixture(); lightAll(f);
  expect(f.route.guide).toBeNull();
  stand(f, 3);
  // 1회차 불협: guide 는 여전히 없다.
  toAnswer(f); expect(f.route.guide).toBeNull(); run(f, 2); expect(f.route.discords).toBe(1);
  expect(f.route.phase).toBe('toll'); expect(f.route.guide).toBeNull();
  toAnswer(f); expect(f.route.discords).toBe(1); expect(f.route.guide).toBeNull();
  // 2회차 불협 직후에는 소등 재생 중이라 guide 가 없고, 공명 단계에 들어서면 켜진다.
  run(f, 2); expect(f.route.discords).toBe(2);
  expect(f.route.phase).toBe('toll'); expect(f.route.guide).toBeNull();
  run(f, 4.8); expect(f.route.phase).toBe('answer');
  expect(f.route.guide).toBe(gateOf(f, 2));
  expect(f.route.hint()).toContain('1번 종문 · 북쪽 예배실');
  stand(f, 2); run(f, 2);
  expect(f.route.progress).toBe(1); expect(f.route.guide).toBe(gateOf(f, 5));
  stand(f, 5); run(f, 2);
  expect(f.route.guide).toBe(gateOf(f, 3));
  stand(f, 3); run(f, 2);
  expect(f.route.complete).toBe(true); expect(f.route.guide).toBeNull();
});

test('16. 목표창 문구는 guide 가 없는 동안 정답 순서를 밝히지 않는다', () => {
  const f = fixture(); lightAll(f);
  const labels = DEF.gates.map(g => g.label);
  const names = Object.getOwnPropertyNames(BellfallDeepBells.prototype);
  expect(names.filter(n => /order|answer|solution/i.test(n))).toEqual([]);
  expect(Object.keys(f.route).filter(n => /order|answer|solution/i.test(n))).toEqual([]);
  const hints = new Set<string>();
  for (let i = 0; i < 300; i++) { f.route.update(f.game, DT); hints.add(f.route.hint()); }
  for (const hint of hints) for (const label of labels) expect(hint).not.toContain(label);
  expect([...hints].some(h => h.includes('소등'))).toBe(true);
  expect([...hints].some(h => h.includes('역순 공명 0/3'))).toBe(true);
});

// ---------------- 완료와 정화 ----------------

test('17. 3/3 공명 순간 정답 순서로 방마다 markCleared 가 한 번, 이후 update 는 더 부르지 않는다', () => {
  const f = fixture(); lightAll(f);
  for (const id of [2, 3, 5]) expect(f.route.beforeClear(f.game, room(f, id))).toBe(true);
  stand(f, 2); toAnswer(f); run(f, 2); stand(f, 5); run(f, 2);
  expect(f.cleared).toEqual([]);
  expect(f.route.autoRoom()).toBe(room(f, 3));
  stand(f, 3); run(f, 2);
  expect(f.cleared).toEqual(ANSWER_ROOMS);
  expect(ANSWER_ROOMS.map(id => room(f, id).cleared)).toEqual([true, true, true]);
  expect(f.route.phase).toBe('done'); expect(f.game.autoTarget).toBeNull(); expect(f.route.autoRoom()).toBeNull();
  for (const id of [2, 3, 5]) expect(f.route.beforeClear(f.game, room(f, id))).toBe(false);
  expect(gateOf(f, 2).purgePending).toBe(false);
  f.game.autoTarget = room(f, 1);                  // Battle 이 정한 다음 목표는 덮어쓰지 않는다
  run(f, 3);
  expect(f.cleared).toEqual(ANSWER_ROOMS); expect(f.game.autoTarget).toBe(room(f, 1));
  expect(f.toasts.at(-1)).toContain('봉인이 흔들립니다');
});

test('18. 완료 순간 방에 적이 남아 markCleared 가 거부되면 purgePending 으로 기억했다가 정리된 첫 프레임에 한 번 더 넘긴다', () => {
  const f = fixture(); lightAll(f);
  const straggler = { alive: true, homeRoom: room(f, 5) };   // 점등 뒤 다시 나타난 적
  f.game.enemies.push(straggler);
  stand(f, 2); toAnswer(f); run(f, 2); stand(f, 5); run(f, 2); stand(f, 3); run(f, 2);
  expect(f.route.complete).toBe(true);
  expect(f.cleared).toEqual(ANSWER_ROOMS);
  expect(room(f, 2).cleared).toBe(true); expect(room(f, 3).cleared).toBe(true); expect(room(f, 5).cleared).toBe(false);
  expect(gateOf(f, 5).purgePending).toBe(true);
  expect(gateOf(f, 2).purgePending).toBe(false);
  run(f, 2);                                       // 적이 살아 있는 동안은 재시도하지 않는다
  expect(f.cleared).toEqual(ANSWER_ROOMS);
  straggler.alive = false;
  f.route.update(f.game, DT);
  expect(f.cleared).toEqual([...ANSWER_ROOMS, 5]);
  expect(room(f, 5).cleared).toBe(true); expect(gateOf(f, 5).purgePending).toBe(false);
  run(f, 2);
  expect(f.cleared).toEqual([...ANSWER_ROOMS, 5]);  // 재시도는 한 번뿐이다
});

test('19. 종문 방은 공명 제단을 쓰지 않는다(allowsAttunement·coexistsAttunement 가 false)', () => {
  const f = fixture();
  for (const r of f.world.rooms) expect(f.route.allowsAttunement(r)).toBe(false);
  expect(f.route.allowsAttunement()).toBe(false);
  expect(f.route.coexistsAttunement).toBe(false);
});

// ---------------- AUTO ----------------

test('20. autoRoom 은 단계별로 첫 미점등 방 → 다음 정답 방 → null 을 돌려주고 update 가 game.autoTarget 에 싣는다', () => {
  const f = fixture();
  expect(f.route.autoRoom()).toBe(room(f, 2));
  lightRoom(f, 2); expect(f.route.autoRoom()).toBe(room(f, 3));
  lightRoom(f, 5); expect(f.route.autoRoom()).toBe(room(f, 3));
  lightRoom(f, 3);
  expect(f.route.phase).toBe('toll'); expect(f.route.autoRoom()).toBe(room(f, 2));   // 소등 중에도 정답 방
  f.route.update(f.game, DT); expect(f.game.autoTarget).toBe(room(f, 2));
  stand(f, 2); toAnswer(f); expect(f.route.autoRoom()).toBe(room(f, 2));
  run(f, 2); expect(f.route.autoRoom()).toBe(room(f, 5)); expect(f.game.autoTarget).toBe(room(f, 5));
  // 다음 정답은 5번 방인데 3번 방에서 불협을 내면 진행이 0이라 다시 첫 정답 방이다.
  stand(f, 3, 1); run(f, 2); expect(f.route.discords).toBe(1); expect(f.route.autoRoom()).toBe(room(f, 2));
  stand(f, 2); run(f, 4.8 + 2); stand(f, 5); run(f, 2); stand(f, 3); run(f, 2);
  expect(f.route.complete).toBe(true);
  expect(f.route.autoRoom()).toBeNull(); expect(f.game.autoTarget).toBeNull();
  const g = fixture(); g.route.stop(); expect(g.route.autoRoom()).toBeNull();
});

// ---------------- 중단 ----------------

test('21. 일시정지·사망·비활성·보스 처치·다른 월드에서는 소등 시계가 멈추고 유지 시간이 0이 된다', () => {
  const stops: Array<[string, (f: F) => void]> = [
    ['pause', f => { f.game.paused = true; }], ['dead', f => { f.game.player.alive = false; }],
    ['inactive', f => { f.game.active = false; }], ['boss', f => { f.game.bossDefeated = true; }],
    ['world', f => { f.game.world = {}; }],
  ];
  for (const [name, stop] of stops) {
    // 소등 재생 도중: 시계는 그대로
    const t = fixture(); lightAll(t); run(t, 2.0);
    const clock = t.route.tollClock, index = t.route.tollIndex;
    stop(t); t.route.update(t.game, 100);
    expect([name, t.route.tollClock, t.route.tollIndex, t.route.phase]).toEqual([name, clock, index, 'toll']);
    // 공명 단계 유지 도중: 유지는 0, 진행은 그대로
    const h = fixture(); lightAll(h); stand(h, 2); toAnswer(h); run(h, 1.5);
    expect(h.route.hold).toBeCloseTo(1.5, 6);
    stop(h); h.route.update(h.game, 100);
    expect([name, h.route.hold, h.route.holdGate, h.route.progress, h.route.discords]).toEqual([name, 0, null, 0, 0]);
  }
  // 일시정지가 풀리면 이어서 진행한다. 정지 중에는 유지 시간이 이어지지 않는다.
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f); run(f, 1.5);
  f.game.paused = true; f.route.update(f.game, 30); f.route.interrupt(); f.game.paused = false;
  run(f, 0.5); expect(f.route.progress).toBe(0); run(f, 1.5); expect(f.route.progress).toBe(1);
  // 사망 중 소등 시계가 빠져도 패배가 완료로 바뀌지 않는다.
  const d = fixture(); lightAll(d); d.game.player.alive = false; d.route.update(d.game, 100);
  expect(d.route.complete).toBe(false); expect(d.route.finish(false).complete).toBe(false);
});

test('22. 유효하지 않은 dt(0·음수·NaN)는 상태를 바꾸지 않는다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); run(f, 1);
  const before = snapshot(f);
  for (const dt of [0, -1, NaN, Infinity * 0]) f.route.update(f.game, dt);
  expect(snapshot(f)).toBe(before);
});

test('23. stop 은 닫고, 뷰를 한 번만 dispose 하며, 이후 update·결과가 완료를 만들지 않는다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f); run(f, 1.5);
  let disposed = 0;
  f.route.view = { update: noop, dispose: () => { disposed++; } };
  f.route.stop();
  expect(f.route.closed).toBe(true); expect(f.route.hold).toBe(0); expect(f.route.holdGate).toBeNull(); expect(f.route.view).toBeNull();
  expect(disposed).toBe(1);
  f.route.stop(); expect(disposed).toBe(1);
  const clock = f.route.tollClock;
  f.route.update(f.game, 10);
  expect(f.route.tollClock).toBe(clock); expect(f.route.progress).toBe(0); expect(f.cleared).toEqual([]);
  expect(f.route.autoRoom()).toBeNull();
  expect(f.route.beforeClear(f.game, room(f, 2))).toBe(true);   // 닫혀도 종문 방을 몰래 정화하지 않는다
  expect(f.route.finish(true).complete).toBe(false);
});

// ---------------- 결과 ----------------

test('24. finish 는 처음 만든 결과를 동결해 돌려주고 패배·보스 미처치는 complete false 다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f); run(f, 2);
  const mid = f.route.finish(true);
  expect(Object.isFrozen(mid)).toBe(true);
  expect(mid).toMatchObject({ id: 'bellfall_deep_bells', label: '종문 역순 공명', complete: false, progress: 1, target: 3, rooms: [2], discords: 0, tolls: 1 });
  expect(Object.isFrozen(mid.rooms)).toBe(true);
  expect(f.route.finish(false)).toBe(mid);
  expect(f.route.closed).toBe(true);

  // 3/3 이고 승리여도 보스가 처치되지 않았거나 다른 구역이 남았으면 complete 는 false 다.
  const g = fixture(); lightAll(g); stand(g, 2); toAnswer(g); run(g, 2); stand(g, 5); run(g, 2); stand(g, 3); run(g, 2);
  expect(g.route.canUnseal()).toBe(false);
  expect(g.route.finish(true)).toMatchObject({ complete: false, progress: 3, rooms: ANSWER_ROOMS });

  // 패배는 3/3 이어도 완료로 바꾸지 않는다.
  const h = fixture(); lightAll(h); stand(h, 2); toAnswer(h); run(h, 2); stand(h, 5); run(h, 2); stand(h, 3); run(h, 2);
  for (const r of h.world.rooms) if (r.type !== 'start' && r.type !== 'boss') (r as any).cleared = true;
  expect(h.route.canUnseal()).toBe(true);
  (h.world as any).unseal(); (h.world.bossRoom as any).cleared = true;
  expect(h.route.canWin()).toBe(true);
  expect(h.route.finish(false)).toMatchObject({ complete: false, progress: 3 });

  // 정상 완주 + 승리는 complete true 이고 불협·재생 횟수를 담는다.
  const w = fixture(); lightAll(w); stand(w, 3); toAnswer(w); run(w, 2);   // 불협 1회
  expect(w.route.discords).toBe(1);
  stand(w, 2); run(w, 4.8 + 2); stand(w, 5); run(w, 2); stand(w, 3); run(w, 2);
  for (const r of w.world.rooms) if (r.type !== 'start' && r.type !== 'boss') (r as any).cleared = true;
  (w.world as any).unseal(); (w.world.bossRoom as any).cleared = true;
  expect(w.route.finish(true)).toMatchObject({ complete: true, progress: 3, target: 3, rooms: ANSWER_ROOMS, discords: 1, tolls: 2 });
});

test('25. 불협 직후 결과의 진행은 이번 시도 기준으로 0이고 공명 방 목록도 비어 있다', () => {
  const f = fixture(); lightAll(f); stand(f, 2); toAnswer(f); run(f, 2); stand(f, 3); run(f, 2);
  expect(f.route.discords).toBe(1);
  expect(f.route.finish(false)).toMatchObject({ progress: 0, rooms: [], discords: 1, tolls: 2, complete: false });
});

// ---------------- 할당·참조 ----------------

test('26. update 는 같은 객체를 돌려 쓴다: gate·center·뷰 옵션 참조가 프레임 사이에 바뀌지 않고, 문구는 상태가 바뀔 때만 새로 만든다', () => {
  const f = fixture(); lightAll(f); stand(f, 2);
  const gates = f.route.gates.slice(), centers = gates.map((g: any) => g.center);
  const optsSeen: any[] = [];
  f.route.view = { update: (_r: any, _dt: number, opts: any) => optsSeen.push(opts), dispose: noop };
  const objectivesBefore = f.objectiveCount();
  run(f, 0.9);                                     // 첫 소등(1.0초) 직전까지는 상태 서명이 같다
  const hint = f.route.hint();
  expect(f.route.hint()).toBe(hint);
  const afterFirst = f.objectiveCount();
  run(f, 0.05);
  expect(f.objectiveCount()).toBe(afterFirst);     // 서명이 같으면 setObjective 도 부르지 않는다
  expect(f.route.hint()).toBe(hint);
  run(f, 4);
  expect(f.objectiveCount()).toBeGreaterThan(objectivesBefore);
  f.route.gates.forEach((g: any, i: number) => { expect(g).toBe(gates[i]); expect(g.center).toBe(centers[i]); });
  expect(f.route.holdGate).toBe(gates[0]);
  expect(optsSeen.length).toBeGreaterThan(100);
  expect(new Set(optsSeen).size).toBe(1);
  expect(optsSeen[0]).toMatchObject({ reduced: false });
  // 뷰는 매 update 끝에서 route 와 dt 를 받는다.
  const g = fixture(); lightAll(g); const calls: Array<[any, number]> = [];
  g.route.view = { update: (r: any, dt: number) => calls.push([r, dt]), dispose: noop };
  g.route.update(g.game, 0.25); expect(calls).toEqual([[g.route, 0.25]]);
});

// ---------------- 실제 Battle 연동 ----------------

/** route-objectives.test.ts 와 같은 방식으로 실제 Battle 메서드(enterRoom·markCleared·updateExpedition·AUTO)를 쓰고 렌더만 대체한다. */
function battleFixture() {
  const stage = deepStage();
  const world: any = buildExpeditionWorld(stage);
  const hurts: number[] = [], toasts: string[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    enemies: [], pending: [], timers: [], projectiles: [], result: null, pauseReasons: new Set(),
    curRoom: world.startRoom, app: { eco: { s: {} } }, renderer: { desat: 0, shake: noop, flashScreen: noop },
    input: { enabled: true, clear: noop }, sp: { clear: noop }, arena: { openSeal: noop }, openPortal: noop,
    ui: { toast: (t: string) => toasts.push(t), waveBanner: noop, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop, setObjective: noop },
    fx: { castCircle: noop, damage: noop, groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { clear: noop, spawn: noop }, rollDrop: () => null,
    player: { alive: true, hp: 100, maxHp: 100, pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      forward: (v: Vector3) => v.set(1, 0, 0), play: noop, dispose: noop, hurt: (n: number) => { hurts.push(n); return true; } },
    roomRoster: () => ['guard', 'guard'],
    spawnEnemy(_id: string, _near: any, r: any) { g.routeObjectives?.spawn(r); g.enemies.push({ alive: true, homeRoom: r, dispose: noop }); },
  });
  g.routeObjectives = createRouteObjectives(stage, world);
  g.autoTarget = g.routeObjectives?.autoRoom() || null;
  g.player.game = g;
  return { g, world, route: g.routeObjectives as any, hurts, toasts };
}
type B = ReturnType<typeof battleFixture>;
function clearCombat(b: B, id: number) {
  const r = b.world.rooms[id];
  b.g.enterRoom(r);
  for (const timer of b.g.timers.splice(0)) timer.fn();
  // 엘리트 방은 증원 1회가 이어지므로 정화될 때까지(종문 방은 점등까지) 처치와 markCleared 를 반복한다.
  for (let i = 0; i < 4 && !r.cleared; i++) {
    for (const e of b.g.enemies) if (e.homeRoom === r) e.alive = false;
    b.g.markCleared(r);
    for (const timer of b.g.timers.splice(0)) timer.fn();
  }
  return r;
}

test('27. 실제 Battle: 보물방 2·5도 공명 제단 없이 종으로만 열리고, 3/3 공명에 보상이 방마다 한 번 나간다', () => {
  const b = battleFixture();
  expect(b.route).toBeInstanceOf(BellfallDeepBells);
  clearCombat(b, 2);
  expect(b.world.rooms[2].type).toBe('treasure');
  expect(b.world.rooms[2].attunementPending).toBeFalsy();     // 제단이 생기지 않는다
  expect(b.world.rooms[2].cleared).toBe(false);
  expect(b.route.gates[0].phase).toBe('lit');
  clearCombat(b, 5); clearCombat(b, 3);
  expect(b.route.phase).toBe('toll');
  expect(b.world.rooms[5].attunementPending).toBeFalsy();
  expect(b.g.treasureRooms).toBe(0); expect(b.g.roomsCleared).toBe(0);
  const at = (id: number) => b.g.player.pos.set(b.world.rooms[id].x, 0, b.world.rooms[id].z);
  at(2); for (let i = 0; i < 288; i++) b.g.updateExpedition(DT);
  expect(b.route.phase).toBe('answer');
  for (const id of ANSWER_ROOMS) { at(id); for (let i = 0; i < 120; i++) b.g.updateExpedition(DT); }
  expect(b.route.complete).toBe(true);
  expect([2, 3, 5].map(id => b.world.rooms[id].cleared)).toEqual([true, true, true]);
  expect(b.g.treasureRooms).toBe(2); expect(b.g.roomsCleared).toBe(3);
  for (const id of [2, 3, 5]) b.g.markCleared(b.world.rooms[id]);
  for (let i = 0; i < 300; i++) b.g.updateExpedition(DT);
  expect(b.g.treasureRooms).toBe(2); expect(b.g.roomsCleared).toBe(3);   // 다시 정화해도 보상은 중복되지 않는다
  expect(b.hurts).toHaveLength(0);
  // 나머지 구역을 정화하면 봉인 조건이 열린다.
  expect(b.route.canUnseal()).toBe(false);
  for (const id of [1, 4, 6, 7]) clearCombat(b, id);
  expect(b.route.canUnseal()).toBe(true);
});

test('28. 실제 AUTO(autoExplore)는 소등을 듣고 2 → 5 → 3 순서로 걸어 불협 없이 3/3 을 완주한다', () => {
  const b = battleFixture();
  // 전투는 일반 autoMove 가 맡으므로 종문 방을 먼저 정화해 AUTO 이동과 실제 충돌만 분리한다.
  for (const id of [5, 3, 2]) clearCombat(b, id);
  b.g.player.pos.set(b.world.rooms[2].x, 0, b.world.rooms[2].z);
  b.g.player.pos.set(b.world.rooms[5].x, 0, b.world.rooms[5].z);
  const visited: number[] = [];
  let last = 0;
  for (let frame = 0; frame < 6000 && !b.route.complete; frame++) {
    b.g.updateExpedition(.05);
    if (b.route.progress > last) { visited.push(ANSWER_ROOMS[last]); last = b.route.progress; }
    if (b.route.complete) break;
    expect(b.g.autoTarget?.id).toBe(ANSWER_ROOMS[b.route.progress]);
    const pos = b.g.player.pos;
    const dir = Player.prototype.autoExplore.call(b.g.player, .05);
    const next = b.world.resolve(pos.x, pos.z, pos.x + dir.x * .3, pos.z + dir.y * .3, .55);
    expect(b.world.walkable(next[0], next[1])).toBe(true);
    pos.set(next[0], 0, next[1]);
  }
  expect(b.route.complete).toBe(true);
  expect(visited).toEqual(ANSWER_ROOMS);
  expect(b.route.discords).toBe(0); expect(b.hurts).toHaveLength(0);
  expect(b.route.tolls).toBe(1);
});
