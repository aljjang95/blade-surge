// 일식 수문 심층 역류 밸브 4곳 봉인(BUNDLE-07): 방 2 → 4 → 7 → 5 순서, 정예방(4·7) 밸브는 증원 2회 뒤에만 조작된다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
const deepStage = (extra: any = {}) => ({ ...buildExpeditionStage('dungeon', 'eclipse_hydra_vault', null, { depth: 'deep' }), ...extra });

// 적 모델·렌더링은 필요 없다. 방 입장, 대기열, 증원, 목표, 정화·보상, 봉인, 결과는 실제 Battle 코드를 쓴다.
function fixture(stage: any = deepStage()) {
  const world = buildExpeditionWorld(stage);
  const hints: string[] = [], circles: any[] = [], labels: string[] = [], banners: string[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    enemies: [], pending: [], timers: [], projectiles: [], result: null, pauseReasons: new Set(),
    curRoom: world.startRoom, app: { eco: { s: {} } }, renderer: { desat: 0, shake: noop, flashScreen: noop },
    input: { enabled: true, clear: noop }, sp: { clear: noop },
    arena: { openSeal: noop }, openPortal: noop,
    ui: { toast: noop, waveBanner: (t: string) => banners.push(t), setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop,
      setObjective() { hints.push(g.routeObjectives?.hint() || ''); } },
    fx: { castCircle: (p: any, color: number, opts: any) => circles.push({ p, color, ...opts }),
      damage: (_p: any, _n: number, opts: any) => labels.push(opts.text), groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { clear: noop, spawn: noop }, rollDrop: () => null,
    player: { alive: true, hp: 100, maxHp: 100, pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      forward: (v: Vector3) => v.set(1, 0, 0), play: noop, dispose: noop },
    roomRoster: () => ['guard', 'guard'],
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room);
      g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  g.routeObjectives = createRouteObjectives(stage, world);
  g.autoTarget = g.routeObjectives?.autoRoom() || null;
  g.player.game = g;
  return { g, world, route: g.routeObjectives!, hints, circles, labels, banners };
}
type F = ReturnType<typeof fixture>;
const cell = (w: any, r: any) => Math.floor(r.z - w.minZ) * w.cols + Math.floor(r.x - w.minX);
function enter(f: F, id: number) {
  const room = f.world.rooms[id];
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  return room;
}
function killAll(f: F, room: any) { for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false; }
const gateOf = (f: F, id: number) => f.route.gates.find((x: any) => x.room.id === id);
/** 정예방이 아닌 방: 입장 → 처치 → 정화 시도. */
function clearCombat(f: F, id: number) {
  const room = enter(f, id); killAll(f, room); f.g.markCleared(room); return room;
}
/** 정예방: 증원 두 번을 실제 markCleared 경로로 모두 겪은 뒤 마지막 정화 시도까지. */
function clearElite(f: F, id: number) {
  const room: any = enter(f, id);
  for (let wave = 1; wave <= 2; wave++) {
    killAll(f, room); f.g.markCleared(room);
    expect(room.forgeWave).toBe(wave);
  }
  killAll(f, room); f.g.markCleared(room);
  return room;
}
function tickAt(f: F, id: number, dt: number) {
  const room = f.world.rooms[id]; f.g.player.pos.set(room.x, 0, room.z);
  f.g.updateExpedition(dt);
}
const clear = (f: F, id: number) => ([4, 7].includes(id) ? clearElite(f, id) : clearCombat(f, id));
function seal(f: F, id: number) { clear(f, id); tickAt(f, id, 2); }

test('심층 정의: 역류 밸브 4곳이 방 2·4·7·5 순서이고 번호 라벨이 방에 붙는다', () => {
  const stage = deepStage();
  const def = routeObjectiveForStage(stage);
  expect(def).toBe(ROUTE_OBJECTIVES.eclipse_deep);
  const f = fixture(stage);
  expect(f.route.def.id).toBe('eclipse_deep_backflow_seals');
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 4, 7, 5]);
  expect(f.world.rooms.map(r => r.type)).toEqual(['start', 'normal', 'treasure', 'normal', 'elite', 'treasure', 'normal', 'elite', 'boss']);
  expect(f.world.rooms[2].label).toBe('1번 역류 밸브 · 잠긴 저수조');
  expect(f.world.rooms[4].label).toBe('2번 역류 밸브 · 맹세의 갑문');
  expect(f.world.rooms[7].label).toBe('3번 역류 밸브 · 심연 수문');
  expect(f.world.rooms[5].label).toBe('4번 역류 밸브 · 되돌아온 물길');
  expect(f.route.noun).toBe('역류 밸브'); expect(f.route.verb).toBe('봉인');
  expect(f.route.autoRoom()?.id).toBe(2);
});

test('시작 구역에서 네 밸브 모두 봉인 밖 경로로 닿고 보스 구역은 닫혀 있다', () => {
  const f = fixture();
  const flow = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
  for (const id of [2, 4, 7, 5]) expect(flow[cell(f.world, f.world.rooms[id])]).toBeGreaterThanOrEqual(0);
  expect(flow[cell(f.world, f.world.bossRoom)]).toBe(-1);
  // 두 번째 정예방(7)에서도 먼저 지나친 방 5로 되돌아갈 수 있다.
  const back = f.world.buildFlow(f.world.rooms[7].x, f.world.rooms[7].z)!;
  expect(back[cell(f.world, f.world.rooms[5])]).toBeGreaterThanOrEqual(0);
});

test('방 5를 먼저 정리해도 3번 밸브를 봉인하기 전에는 잠기지 않고 cleared 도 아니며, 안내는 다음 밸브를 가리킨다', () => {
  const f = fixture();
  clearCombat(f, 5);
  expect(gateOf(f, 5).ready).toBe(true);
  tickAt(f, 5, 10);
  expect(f.route.progress).toBe(0); expect(f.world.rooms[5].cleared).toBe(false);
  expect(f.route.hint()).toBe('역류 밸브 0/4 · 다음 1번 역류 밸브 · 잠긴 저수조 · 적 처치 후 중심 2초');
  seal(f, 2); expect(f.route.progress).toBe(1);
  tickAt(f, 5, 10); expect(f.route.progress).toBe(1); expect(f.world.rooms[5].cleared).toBe(false);
  expect(f.g.autoTarget.id).toBe(4);
  seal(f, 4); expect(f.route.progress).toBe(2);
  tickAt(f, 5, 10); expect(f.route.progress).toBe(2); expect(f.world.rooms[5].cleared).toBe(false);
  expect(f.route.hint()).toContain('다음 3번 역류 밸브 · 심연 수문');
  expect(f.g.autoTarget.id).toBe(7);
  // 3번을 봉인한 뒤에야 방 5가 차례가 되고, 이미 정리된 방이므로 2초 유지로 바로 봉인된다.
  seal(f, 7); expect(f.route.progress).toBe(3);
  expect(f.g.autoTarget.id).toBe(5); expect(f.world.rooms[5].cleared).toBe(false);
  tickAt(f, 5, 1.9); expect(f.route.progress).toBe(3);
  f.g.updateExpedition(.1); expect(f.route.progress).toBe(4);
  expect(f.world.rooms[5].cleared).toBe(true); expect(gateOf(f, 5).attuned).toBe(true);
});

test('정예방 4·7 밸브는 실제 markCleared 증원 2회가 끝나기 전에는 ready 가 아니다', () => {
  const f = fixture();
  seal(f, 2);
  for (const id of [4, 7]) {
    const room: any = enter(f, id), gate = gateOf(f, id);
    expect(f.route.autoRoom()!.id).toBe(id);
    for (let wave = 1; wave <= 2; wave++) {
      killAll(f, room); f.g.markCleared(room);
      expect(room.forgeWave).toBe(wave);
      expect(f.banners.at(-1)).toBe('금고 증원 ' + wave + '/2');
      // 증원 4명이 살아 있다: 밸브는 아직 잠겨 있고 중심에 머물러도 유지가 쌓이지 않는다.
      expect(gate.ready).toBe(false);
      expect(f.g.enemies.filter((e: any) => e.alive && e.homeRoom === room)).toHaveLength(4);
      tickAt(f, id, 5);
      expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(id === 4 ? 1 : 2);
    }
    killAll(f, room); f.g.markCleared(room);
    expect(gate.ready).toBe(true); expect(room.cleared).toBe(false);
    tickAt(f, id, 1.9); expect(f.route.progress).toBe(id === 4 ? 1 : 2);
    f.g.updateExpedition(.1); expect(f.route.progress).toBe(id === 4 ? 2 : 3);
    expect(room.forgeWave).toBe(2); expect(room.cleared).toBe(true);
  }
});

test('빛 밖으로 나가면 유지가 0 으로 돌아가고, 일시정지 interrupt 뒤에도 0 부터 다시 센다', () => {
  const f = fixture(); clear(f, 2);
  tickAt(f, 2, 1.5); expect(f.route.hold).toBeCloseTo(1.5);
  f.g.player.pos.x += 3.01; f.g.updateExpedition(.01);
  expect(f.route.hold).toBe(0);
  tickAt(f, 2, 1.5); expect(f.route.hold).toBeCloseTo(1.5);
  // 일시정지(실제 setPaused → interrupt 경로)는 유지를 비운다. 재개 뒤 새로 2초가 필요하다.
  f.g.setPaused('manual', true);
  expect(f.route.hold).toBe(0);
  f.g.updateExpedition(100); expect(f.route.progress).toBe(0);
  f.g.setPaused('manual', false);
  tickAt(f, 2, 1.9); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.1); expect(f.route.progress).toBe(1);
});

test('4/4 전에는 모든 구역을 정화해도 봉인이 풀리지 않고, 4/4 + 모든 구역 정화 뒤에 풀린다', () => {
  const f = fixture();
  for (const id of [1, 3, 6]) clearCombat(f, id);
  for (const id of [2, 4, 7]) seal(f, id);
  expect(f.route.progress).toBe(3);
  clear(f, 5);
  expect(f.route.canUnseal()).toBe(false);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  tickAt(f, 5, 2);
  expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(true);
  expect(f.route.hint()).toBe('역류 밸브 4/4 봉인 완료 · 보스 처치');
  for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(f.world.sealed).toBe(false);

  // 모든 구역을 정화하지 못한 4/4 는 아직 열리지 않는다.
  const g = fixture();
  for (const id of [2, 4, 7, 5]) seal(g, id);
  expect(g.route.complete).toBe(true); expect(g.route.canUnseal()).toBe(false);
  clearCombat(g, 1); clearCombat(g, 3); expect(g.route.canUnseal()).toBe(false);
  clearCombat(g, 6); expect(g.route.canUnseal()).toBe(true);
});

test('finish 보고: 4개 모두 봉인한 승리만 complete 이고, 중도 보고는 실제 진행만 담는다', () => {
  const partial = fixture(); seal(partial, 2); seal(partial, 4);
  const report = partial.route.finish(false);
  expect(report).toMatchObject({ id: 'eclipse_deep_backflow_seals', label: '역류 밸브 봉인', complete: false, progress: 2, target: 4, rooms: [2, 4] });
  expect(Object.isFrozen(report)).toBe(true);
  expect(partial.route.finish(true)).toBe(report);

  const win = fixture();
  for (const id of [1, 3, 6]) clearCombat(win, id);
  for (const id of [2, 4, 7, 5]) seal(win, id);
  for (const timer of win.g.timers.splice(0)) timer.fn();
  win.g.bossDefeated = true; win.g.markCleared(win.world.bossRoom); win.g.victory();
  expect(win.g.result.win).toBe(true);
  expect(win.g.result.routeObjective).toMatchObject({ id: 'eclipse_deep_backflow_seals', label: '역류 밸브 봉인', complete: true, progress: 4, target: 4, rooms: [2, 4, 7, 5] });

  const lose = fixture(); seal(lose, 2); lose.g.defeat();
  expect(lose.g.result.routeObjective).toMatchObject({ complete: false, progress: 1, target: 4, rooms: [2] });
});

test('목표창은 역류 밸브 봉인 제목과 부분 유지량을 보여준다', () => {
  const f = fixture(); clear(f, 2); tickAt(f, 2, .5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '역류 밸브 봉인', progress: 0, total: 4, roomId: 2, hold: .5, holdTotal: 2 });
  expect(f.circles.some(c => c.radius === 3 && c.color === 0x63e7dd)).toBe(true);
  tickAt(f, 2, 1.5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '역류 밸브 봉인', progress: 1, total: 4, hold: 0 });
});

test('파티·균열·정복·결투 변형 심층 stage 는 역류 밸브 목표를 받지 않는다', () => {
  const base = deepStage();
  expect(routeObjectiveForStage(base)).toBe(ROUTE_OBJECTIVES.eclipse_deep);
  const variants = [
    { ...base, party: {} }, { ...base, riftId: 'iron' },
    { ...base, expedition: { ...base.expedition, riftId: 'iron' } },
    { ...base, expedition: { ...base.expedition, conquestId: 'fake' } },
    { ...base, expedition: { ...base.expedition, kind: 'arena' } },
    { ...base, expedition: { ...base.expedition, depth: 'unknown' } },
  ];
  for (const stage of variants) expect(routeObjectiveForStage(stage)).toBeNull();
  for (const stage of variants) expect(createRouteObjectives(stage, buildExpeditionWorld(base))).toBeNull();
});

// ---------------- 연출 연결(BUNDLE-07 PLAN 3.1) ----------------
test('prepareView 는 def.view 가 없는 정의(종문·녹청)에서 뷰를 만들지 않는다', async () => {
  for (const id of ['bellfall_crypt', 'verdigris_sanctum']) {
    const f = fixture(buildExpeditionStage('dungeon', id, null));
    expect((f.route.def as any).view).toBeUndefined();
    await f.route.prepareView(new Scene());
    expect(f.route.view).toBeNull();
  }
});

test('prepareView 는 뷰 가져오기·생성이 실패해도 던지지 않고, 이미 정지된 목표에는 뷰를 붙이지 않는다', async () => {
  for (const depth of ['standard', 'deep']) {
    const f = fixture(buildExpeditionStage('dungeon', 'eclipse_hydra_vault', null, { depth }));
    expect((f.route.def as any).view).toBe('backflow-valves');
    // 장면이 올바르지 않으면 뷰 생성이 실패하고 view 는 null 로 남는다(뷰 파일이 있는 통합 빌드에서도 같다).
    await expect(f.route.prepareView(null)).resolves.toBeUndefined();
    expect(f.route.view).toBeNull();
    // 정상 장면: 뷰 파일이 없는 브랜치에서는 null, 있는 빌드에서는 dispose 가능한 뷰. 어느 쪽이든 던지지 않는다.
    await expect(f.route.prepareView(new Scene())).resolves.toBeUndefined();
    if (f.route.view) expect(typeof f.route.view.dispose).toBe('function');
    f.route.stop(); expect(f.route.view).toBeNull();
    // 정지 뒤 준비가 끝난 뒤늦은 뷰는 만들지 않는다.
    await f.route.prepareView(new Scene());
    expect(f.route.view).toBeNull();
  }
});

function fakeView() {
  const calls: any[][] = [];
  return { calls, disposed: 0, update(...args: any[]) { calls.push(args); }, dispose() { this.disposed++; } };
}

test('update 는 일시정지에는 view.update 를 부르지 않고, 그 밖에는 (route, dt, opts) 로 같은 opts 참조를 넘긴다', () => {
  const f = fixture(); const view: any = fakeView(); f.route.view = view;
  clear(f, 2);
  f.g.updateExpedition(1 / 60);
  expect(view.calls).toHaveLength(1);
  expect(view.calls[0][0]).toBe(f.route); expect(view.calls[0][1]).toBe(1 / 60);
  expect(view.calls[0][2]).toEqual({ reduced: false });

  f.g.app.reducedMotion = { matches: true };
  f.g.updateExpedition(.05);
  expect(view.calls).toHaveLength(2);
  expect(view.calls[1][2]).toBe(view.calls[0][2]);          // 매 프레임 같은 객체(무할당)
  expect(view.calls[1][2].reduced).toBe(true);

  f.g.setPaused('manual', true);
  f.g.updateExpedition(.05); f.g.updateExpedition(.05);
  expect(view.calls).toHaveLength(2);
  f.g.setPaused('manual', false);
  f.g.updateExpedition(.05);
  expect(view.calls).toHaveLength(3);
  expect(view.calls[2][2]).toBe(view.calls[0][2]);

  // 정상이 아닌 dt 는 뷰를 갱신하지 않는다.
  for (const dt of [0, -1, NaN, Infinity]) f.g.updateExpedition(dt);
  expect(view.calls).toHaveLength(3);
});

test('보스 처치·결과 뒤에도 뷰는 마지막 상태를 이어서 그리고, stop 에서만 dispose 되며 반복 stop 은 안전하다', () => {
  const f = fixture(); const view: any = fakeView(); f.route.view = view;
  f.g.updateExpedition(.1); expect(view.calls).toHaveLength(1);
  f.g.bossDefeated = true; f.g.updateExpedition(.1);
  expect(view.calls).toHaveLength(2); expect(view.disposed).toBe(0);
  f.route.finish(false); f.g.updateExpedition(.1);
  expect(view.calls).toHaveLength(3); expect(view.disposed).toBe(0);
  f.route.stop();
  expect(view.disposed).toBe(1); expect(f.route.view).toBeNull();
  f.route.stop(); f.g.stop();
  expect(view.disposed).toBe(1);
  f.route.update(f.g, .1);
  expect(view.calls).toHaveLength(3);
});

test('Battle.stop 은 실제 정지 경로에서 뷰를 한 번 dispose 한다', () => {
  const f = fixture(); const view: any = fakeView(); f.route.view = view;
  f.g.stop();
  expect(view.disposed).toBe(1); expect(f.g.routeObjectives).toBeNull();
  f.g.stop(); expect(view.disposed).toBe(1);
});
