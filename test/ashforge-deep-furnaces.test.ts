// 재벼림 제련소 심층 심장로 4곳 냉각(BUNDLE-08): 방 2 → 4 → 5 → 7 순서, 정예방(2·5)은 증원 2회 뒤에만 준비되고,
// 조작판은 준비된 뒤 망치 충격파가 한 번 지나간 가열 구간에만 열린다. 일반 재벼림·재의 수문은 예고 중 유지 허용까지 그대로다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves, coolingVent } from '../src/game/cooling-valves.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
// 적 모델·렌더링은 필요 없다. 방 입장, 대기열, 증원, 목표, 정화·보상, 봉인, 결과는 실제 Battle 코드를 쓴다.
function fixture(depth = 'deep', routeId = 'ashforge_catacomb') {
  const stage = buildExpeditionStage('dungeon', routeId, null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hits: number[] = [], labels: string[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34, curRoom: world.startRoom,
    timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} } }, sp: { clear: noop },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: (_p: any, _n: number, opts: any) => labels.push(opts.text), castCircle: noop, groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number) => { hits.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as CoolingValves;
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages, hits, labels, stage };
}
type F = ReturnType<typeof fixture>;
const gateOf = (f: F, id: number): any => f.route.gates.find((g: any) => g.room.id === id)!;

function enter(f: F, id: number) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  return room;
}
function killWave(f: F, room: any) {
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
}
/** 입장 → 모든 적 처치. 정예방은 실제 markCleared 증원 2회를 거쳐 세 번째 처치에서 정화 시도까지 간다. */
function defend(f: F, id: number) {
  const room = enter(f, id);
  for (let i = 0; i < (room.type === 'elite' ? 3 : 1); i++) killWave(f, room);
  return room;
}
/** 1/30초 하위 스텝으로 조건이 될 때까지 진행한다. pos 가 위치를 돌려주면 매 스텝 그 자리로 옮긴다. */
function run(f: F, pos: () => Vector3 | null, until: () => boolean, max = 900) {
  for (let i = 0; i < max; i++) {
    if (until()) return i;
    const p = pos(); if (p) f.g.player.pos.copy(p);
    f.g.updateExpedition(1 / 30);
  }
  throw new Error('조건에 도달하지 못했다');
}
/** 준비된 심장로의 첫 충격파가 끝날 때까지 닫힌 조작판 위에서 기다린다. 기다리는 내내 유지는 0 이다. */
function shock(f: F, id: number) {
  const gate = gateOf(f, id);
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); return gate.shocks >= 1; });
  return gate;
}
function cool(f: F, id: number) {
  const gate = gateOf(f, id);
  if (!gate.ready) defend(f, id);
  if (gate.shocks < 1) shock(f, id);
  run(f, () => gate.pad, () => gate.attuned);
  return gate;
}

test('심층 정의: 심장로 4곳이 방 2·4·5·7 순서이고 방 종류·번호 라벨이 붙으며 조작판 양쪽에 봉인 밖 경로가 닿는다', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(ROUTE_OBJECTIVES.ashforge_deep);
  expect(f.route).toBeInstanceOf(CoolingValves);
  expect(f.route.def.id).toBe('ashforge_heart_furnaces_deep');
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 4, 5, 7]);
  expect(f.world.rooms.map(r => r.type)).toEqual(['start', 'normal', 'elite', 'normal', 'treasure', 'elite', 'treasure', 'normal', 'boss']);
  expect(f.route.gates.map((g: any) => g.room.type)).toEqual(['elite', 'treasure', 'elite', 'normal']);
  expect(f.world.rooms[2].label).toBe('1번 심장로 · 사슬 단조장');
  expect(f.world.rooms[4].label).toBe('2번 심장로 · 북쪽 불씨 저장고');
  expect(f.world.rooms[5].label).toBe('3번 심장로 · 남쪽 주조로');
  expect(f.world.rooms[7].label).toBe('4번 심장로 · 거수의 관문');
  expect(f.route.copy.title).toBe('심장로 냉각');
  expect(f.route.autoRoom()?.id).toBe(2);
  const flow = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
  expect(flow[Math.floor(f.world.bossRoom.z - f.world.minZ!) * f.world.cols! + Math.floor(f.world.bossRoom.x - f.world.minX!)]).toBe(-1);
  for (const gate of f.route.gates) {
    expect(gate.room.objectiveProp).toBe('cooling-valve');
    for (const dx of [0, -3.5, 3.5]) {
      expect(flow[Math.floor(gate.room.z - f.world.minZ!) * f.world.cols! + Math.floor(gate.room.x + dx - f.world.minX!)]).toBeGreaterThanOrEqual(0);
    }
  }
});

test('파티·균열·정복·결투·알 수 없는 깊이 변형은 심장로 목표를 받지 않고, 일반 재벼림은 충격파 창이 없는 정의를 받는다', () => {
  const base = fixture().stage, world = buildExpeditionWorld(base);
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    { ...base, expedition: { ...base.expedition, riftId: 'x' } },
    { ...base, expedition: { ...base.expedition, conquestId: 'x' } },
    { ...base, expedition: { ...base.expedition, kind: 'arena' } },
    { ...base, expedition: { ...base.expedition, depth: 'unknown' } }]) {
    expect(routeObjectiveForStage(stage)).toBeNull();
    expect(createRouteObjectives(stage, world)).toBeNull();
  }
  const standard = fixture('standard');
  expect(standard.route.def.id).toBe('ashforge_furnaces_standard');
  expect((standard.route.def as any).shockWindow).toBeUndefined();
  expect((standard.route.def as any).release).toBeUndefined();
});

test('다른 심장로를 먼저 정리해도 차례 전에는 냉각되지 않고 cleared 도 아니며, 정리해 둔 심장로도 차례에 충격파를 겪어야 한다', () => {
  const f = fixture();
  defend(f, 7); defend(f, 5);
  expect(gateOf(f, 7).ready).toBe(true); expect(gateOf(f, 5).ready).toBe(true);
  for (const id of [7, 5]) {
    f.g.player.pos.copy(gateOf(f, id).pad); f.g.updateExpedition(10);
    expect(f.route.progress).toBe(0); expect(f.route.hold).toBe(0);
    expect(f.world.rooms[id].cleared).toBe(false); expect(gateOf(f, id).attuned).toBe(false);
  }
  expect(f.route.hint()).toContain('1번 심장로 · 사슬 단조장');
  expect(f.route.hint()).not.toContain('4번 심장로');
  expect(f.g.autoTarget.id).toBe(2);

  cool(f, 2); expect(f.route.progress).toBe(1); expect(f.g.autoTarget.id).toBe(4);
  expect(f.world.rooms[7].cleared).toBe(false);
  cool(f, 4); expect(f.route.progress).toBe(2); expect(f.g.autoTarget.id).toBe(5);
  // 방 5 는 이미 정리돼 있지만, 차례가 된 뒤 충격파가 지나가기 전에는 닫혀 있다.
  const third = gateOf(f, 5);
  expect(third.ready).toBe(true); expect(third.shocks).toBe(0); expect(f.route.padOpen(third)).toBe(false);
  f.g.player.pos.copy(third.pad); f.g.updateExpedition(1);
  expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(2);
  expect(f.route.hint()).toContain('3번 심장로 · 남쪽 주조로');
  cool(f, 5); expect(f.route.progress).toBe(3); expect(f.g.autoTarget.id).toBe(7);
  cool(f, 7); expect(f.route.progress).toBe(4);
  expect(f.world.rooms[7].cleared).toBe(true); expect(f.world.rooms[5].cleared).toBe(true);
});

test('정예방 심장로는 실제 markCleared 증원 2회가 끝나기 전에는 ready 가 아니고, 준비 전에는 충격파를 세지 않는다', () => {
  const f = fixture(); const gate = gateOf(f, 2);
  const room: any = enter(f, 2);
  for (let wave = 1; wave <= 2; wave++) {
    killWave(f, room);
    expect(room.forgeWave).toBe(wave); expect(gate.ready).toBe(false);
    expect(f.g.enemies.filter((e: any) => e.alive && e.homeRoom === room)).toHaveLength(4);
    // 증원이 살아 있는 동안 조작판 위에 있어도 유지는 쌓이지 않고, 분출이 지나가도 충격파는 세지 않는다.
    f.g.player.pos.copy(gate.pad); f.g.updateExpedition(7);
    expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0); expect(gate.shocks).toBe(0);
  }
  expect(gate.cycles).toBeGreaterThanOrEqual(1);
  expect(f.messages.some(m => m.includes('방어 완료'))).toBe(false);
  killWave(f, room);
  expect(gate.ready).toBe(true); expect(room.cleared).toBe(false); expect(gate.shocks).toBe(0);
  expect(f.messages).toContain('1번 심장로 · 사슬 단조장 방어 완료 · 망치 충격파 뒤 청록 조작판에서 2초 유지');
});

test('준비 직후 첫 충격파 전에는 조작판 위에서 2초를 넘겨도 유지 0·냉각 안 됨이고, 안내가 충격파 대기를 알린다', () => {
  const f = fixture(); defend(f, 2); const gate = gateOf(f, 2);
  expect(f.route.padOpen(gate)).toBe(false);
  expect(gate.phase).toBe('heat');
  // 가열 3.9초 동안 조작판 위에 머문다.
  f.g.player.pos.copy(gate.pad);
  for (let i = 0; i < 39; i++) { f.g.updateExpedition(.1); expect(f.route.hold).toBe(0); }
  expect(gate.phase).toBe('heat'); expect(f.route.progress).toBe(0);
  expect(f.route.hint()).toBe('심장로 0/4 · 1번 심장로 · 사슬 단조장 · 가열 중 · 충격파 대기');
  // 망치 예고·충격파 중에도 같은 자리(분출 띠 밖)에 머물며 합쳐서 2초를 훌쩍 넘긴다.
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
    if (gate.phase === 'warning') expect(f.route.hint()).toContain('망치 예고 · 충격파 대기');
    if (gate.phase === 'vent') expect(f.route.hint()).toContain('망치 충격파 · 충격파 대기');
    return gate.shocks >= 1; });
  expect(gate.phase).toBe('heat'); expect(gate.attuned).toBe(false); expect(f.hits).toEqual([]);
  expect(f.route.padOpen(gate)).toBe(true);
});

test('충격파 뒤 옮겨 간 조작판에서 가열 중 2초 유지하면 냉각되고 토스트·결과 문구가 불씨 해방을 알린다', () => {
  const f = fixture(); defend(f, 2); const gate = shock(f, 2);
  const oldPad = f.g.player.pos.clone();           // 충격파 직전에 서 있던 조작판 자리
  expect(gate.pad.distanceTo(oldPad)).toBeGreaterThan(6);
  expect(gate.shocks).toBe(1); expect(gate.side).toBe(-1);
  // 충격파 직전 조작판 자리에 그대로 서 있으면 유지가 쌓이지 않는다(조작판은 반대편으로 옮겨 갔다).
  f.g.player.pos.copy(oldPad); f.g.updateExpedition(.5);
  expect(f.route.hold).toBe(0);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(1.4);
  expect(f.route.hold).toBeCloseTo(1.4, 1); expect(f.route.progress).toBe(0);
  expect(f.route.hint()).toContain('가열 중 · 청록판 2초 (1.4/2)');
  f.g.updateExpedition(.2);
  expect(f.route.hold).toBeCloseTo(1.6, 1); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.4);
  expect(gate.attuned).toBe(true); expect(f.route.progress).toBe(1); expect(f.route.hold).toBe(0);
  expect(f.world.rooms[2].cleared).toBe(true);
  expect(f.messages).toContain('1번 심장로 · 사슬 단조장 냉각 · 불씨 해방 · 심장로 1/4 냉각');
  expect(f.route.hint()).toContain('심장로 1/4 · 2번 심장로 · 북쪽 불씨 저장고');
});

test('열린 유지 중 망치 예고가 시작되면 유지가 0 이 되고 예고·충격파 동안 쌓이지 않으며, 다음 충격파 뒤 다시 열린다', () => {
  const f = fixture(); defend(f, 2); const gate = shock(f, 2);
  // 가열 3초째까지 조작판 밖(방 중심)에서 기다렸다가 조작판에 올라선다.
  run(f, () => gate.pos, () => gate.age >= 3);
  expect(gate.phase).toBe('heat');
  let before = 0;
  run(f, () => gate.pad, () => { if (gate.phase === 'heat') before = f.route.hold; return gate.phase === 'warning'; });
  expect(before).toBeGreaterThan(.5);
  expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
  expect(f.route.padOpen(gate)).toBe(false);
  // 예고·충격파 동안 계속 올라서 있어도 유지가 쌓이지 않고, 충격파가 끝나면 조작판이 옮겨 가 다시 열린다.
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0); return gate.phase === 'heat'; });
  expect(gate.shocks).toBe(2); expect(f.route.padOpen(gate)).toBe(true);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(2);
  expect(gate.attuned).toBe(true);
});

test('조작판 이탈·공격 상태·일시정지 interrupt 뒤에는 유지가 0 부터 다시 시작한다', () => {
  const f = fixture(); defend(f, 2); const gate = shock(f, 2);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.4);
  expect(f.route.hold).toBeCloseTo(.4, 1);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(.01); expect(f.route.hold).toBe(0);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.4); expect(f.route.hold).toBeCloseTo(.4, 1);
  for (const state of ['attack', 'skill', 'ult', 'dodge', 'hurt']) {
    f.g.player.state = state; f.g.updateExpedition(.02); expect(f.route.hold).toBe(0);
  }
  f.g.player.state = 'idle'; f.g.updateExpedition(.4); expect(f.route.hold).toBeCloseTo(.4, 1);
  // 일시정지(실제 setPaused → interrupt 경로)는 유지를 비우고, 정지 중 시간은 흐르지 않는다.
  f.g.setPaused('manual', true);
  expect(f.route.hold).toBe(0);
  f.g.updateExpedition(100); expect(f.route.progress).toBe(0); expect(gate.phase).toBe('heat');
  f.g.setPaused('manual', false);
  f.g.updateExpedition(1.9); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.1); expect(f.route.progress).toBe(1);
});

test('안내 문구: 예고·충격파는 심장로 문구를 쓰고, 표식 문구는 닫힘일 때 충격파 뒤 조작판이다', () => {
  const f = fixture(); const gate = gateOf(f, 2);
  enter(f, 2); f.g.player.pos.copy(gate.pos);
  expect(f.route.hint()).toBe('심장로 0/4 · 1번 심장로 · 사슬 단조장 · 가열 중 · 적과 증원 처치');
  defend(f, 2);
  f.g.updateExpedition(.05);
  expect(f.labels.at(-1)).toBe('충격파 뒤 조작판');
  const seen = new Set<string>();
  run(f, () => gate.pad, () => { seen.add(f.route.hint().split(' · ')[3]); return gate.shocks >= 1; });
  expect([...seen]).toEqual(['가열 중', '망치 예고', '망치 충격파']);
  // 열린 가열 구간의 표식은 조작 안내로 바뀐다(표식은 1.8초마다 갱신).
  f.labels.length = 0;
  run(f, () => gate.pos, () => f.labels.length > 0, 120);
  expect(f.labels.at(-1)).toBe('청록 조작판 · 2초');
});

test('목표창: 제목 심장로 냉각, 닫힘·예고·열림 action 이 상황에 따라 바뀐다', () => {
  const f = fixture();
  enter(f, 2);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '심장로 냉각', action: '이 구역의 적과 증원 처치', progress: 0, total: 4, roomId: 2 });
  defend(f, 2); const gate = gateOf(f, 2);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '심장로 냉각', action: '망치 충격파 뒤 옮겨 간 조작판으로 이동', progress: 0, total: 4, roomId: 2, hold: 0, holdTotal: 2 });
  run(f, () => gate.pad, () => gate.phase === 'warning');
  expect(battleObjectiveView(f.g).action).toBe('망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동');
  run(f, () => gate.pad, () => gate.phase === 'vent');
  expect(battleObjectiveView(f.g).action).toBe('망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동');
  run(f, () => gate.pad, () => gate.phase === 'heat');
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '심장로 냉각', action: '청록 조작판에서 2초 유지', holdTotal: 2 });
  expect(battleObjectiveView(f.g).hold).toBeGreaterThanOrEqual(.4);
  f.g.updateExpedition(1.5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '심장로 냉각', action: '다음 구역을 찾아 이동', progress: 1, total: 4, roomId: null });
});

test('4/4 전에는 모든 구역을 정화해도 봉인이 풀리지 않고, 4/4 + 모든 구역 정화 뒤에 풀린다', () => {
  const f = fixture();
  for (const id of [1, 3, 6]) defend(f, id);
  for (const id of [2, 4, 5]) cool(f, id);
  expect(f.route.progress).toBe(3);
  expect(f.route.canUnseal()).toBe(false);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  cool(f, 7);
  expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(true);
  expect(f.route.hint()).toBe('심장로 4/4 냉각 · 보스 처치');
  f.g.unsealBoss(); expect(f.world.sealed).toBe(false);

  // 심장로 4곳을 식혀도 모든 구역을 정화하지 못하면 열리지 않는다.
  const g = fixture();
  for (const id of [2, 4, 5, 7]) cool(g, id);
  expect(g.route.complete).toBe(true); expect(g.route.canUnseal()).toBe(false);
  expect(g.route.hint()).toBe('심장로 4/4 냉각 · 남은 구역 정화');
  defend(g, 1); defend(g, 3); expect(g.route.canUnseal()).toBe(false);
  defend(g, 6); expect(g.route.canUnseal()).toBe(true);
});

test('finish 보고: 4곳을 모두 식힌 승리만 complete 이고, 중도 보고는 실제 진행만 담는다', () => {
  const partial = fixture(); cool(partial, 2); cool(partial, 4);
  const report: any = partial.route.finish(false);
  expect(report).toMatchObject({ id: 'ashforge_heart_furnaces_deep', label: '심장로 냉각', complete: false, progress: 2, target: 4, rooms: [2, 4], overheatHits: 0 });
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  expect(partial.route.finish(true)).toBe(report);

  const win = fixture();
  for (const id of [1, 3, 6]) defend(win, id);
  for (const id of [2, 4, 5, 7]) cool(win, id);
  win.g.unsealBoss(); expect(win.world.sealed).toBe(false);
  win.world.bossRoom.cleared = true;
  const done: any = win.route.finish(true);
  expect(done).toMatchObject({ id: 'ashforge_heart_furnaces_deep', label: '심장로 냉각', complete: true, progress: 4, target: 4, rooms: [2, 4, 5, 7] });
  expect(win.route.finish(false)).toBe(done);

  // 4곳을 식히기 전의 승리 보고는 완료로 바뀌지 않는다.
  const early = fixture(); cool(early, 2);
  early.world.bossRoom.cleared = true;
  expect(early.route.finish(true)).toMatchObject({ complete: false, progress: 1, rooms: [2] });
});

test.each([
  ['cinder_tide_lock', 'standard'], ['cinder_tide_lock', 'deep'], ['ashforge_catacomb', 'standard'],
])('%s/%s: 충격파 창이 없는 정의는 조작판이 늘 열려 있고 예고 중에도 유지가 이어진다(기존과 같음)', (routeId, depth) => {
  const f = fixture(depth, routeId);
  const first = f.route.gates[0] as any;
  expect(f.route.def.shockWindow).toBeUndefined();
  expect(f.route.padOpen(first)).toBe(true);
  defend(f, first.room.id);
  expect(f.route.padOpen(first)).toBe(true);
  expect(f.messages.at(-1)).toBe(first.label + ' 방어 완료 · 청록 조작판에서 2초 유지');
  expect(f.route.hint()).toMatch(/가열 중 · 청록판 2초 \(0\.0\/2\)$/);
  run(f, () => first.pos, () => first.age >= 3);
  let before = 0;
  run(f, () => first.pad, () => { expect(f.route.padOpen(first)).toBe(true); if (first.phase === 'heat') before = f.route.hold; return first.phase === 'warning'; });
  expect(before).toBeGreaterThan(.5);
  expect(f.route.hold).toBeGreaterThan(.5);                        // 예고가 시작돼도 유지가 이어진다
  expect(f.route.hint()).toContain('과열 예고');
  f.g.updateExpedition(.2); expect(f.route.hold).toBeGreaterThan(before);
  f.g.updateExpedition(1);
  expect(first.attuned).toBe(true); expect(first.cycles).toBe(0); // 분출을 지나기 전, 예고 중에 냉각된다
  expect(f.route.progress).toBe(1);
});

test('분출 띠 안에서는 심층에서도 피해를 받고 유지가 끊긴다(규칙 수치는 일반판과 같다)', () => {
  const f = fixture(); defend(f, 2); const gate = gateOf(f, 2);
  expect(f.route.def).toMatchObject({ holdSeconds: 2, radius: 1.6, heatSeconds: 4, warningSeconds: 1.4, ventSeconds: .8 });
  const vent = coolingVent(gate);
  f.g.player.pos.set(vent.x, 0, vent.z);
  f.g.updateExpedition(4 + 1.4 + .1);
  expect(f.hits).toEqual([6]); expect(gate.phase).toBe('vent');
  expect(f.route.hold).toBe(0);
});

// ---------------- 불씨 해방 뷰 연결(가짜 뷰로 호출 계약만 검사) ----------------
function fakeView() {
  const calls: any[][] = [];
  return { calls, disposed: 0, update(...args: any[]) { calls.push(args); }, dispose() { this.disposed++; } };
}

test('releaseView: update 는 일시정지에는 부르지 않고 그 밖에는 (route, dt, opts) 로 같은 opts 참조를 넘긴다', () => {
  const f = fixture(); const rv: any = fakeView(); f.route.releaseView = rv;
  f.g.updateExpedition(1 / 60);
  expect(rv.calls).toHaveLength(1);
  expect(rv.calls[0][0]).toBe(f.route); expect(rv.calls[0][1]).toBe(1 / 60);
  expect(rv.calls[0][2]).toEqual({ reduced: false });
  f.g.app.reducedMotion = { matches: true };
  f.g.updateExpedition(.05);
  expect(rv.calls).toHaveLength(2);
  expect(rv.calls[1][2]).toBe(rv.calls[0][2]); expect(rv.calls[1][2].reduced).toBe(true);

  f.g.setPaused('manual', true);
  f.g.updateExpedition(.05); f.g.updateExpedition(.05);
  expect(rv.calls).toHaveLength(2);
  f.g.setPaused('manual', false);
  f.g.updateExpedition(.05);
  expect(rv.calls).toHaveLength(3); expect(rv.calls[2][2]).toBe(rv.calls[0][2]);
  // 정상이 아닌 dt 는 부르지 않는다.
  for (const dt of [0, -1, NaN, Infinity]) f.g.updateExpedition(dt);
  expect(rv.calls).toHaveLength(3);
});

test('releaseView: 규칙이 조기 반환하는 보스 처치·결과 뒤에도 일시정지가 아니면 이어서 갱신해 해방 연출을 끝낸다', () => {
  const f = fixture(); const rv: any = fakeView(); f.route.releaseView = rv;
  f.g.bossDefeated = true; f.g.updateExpedition(.1);
  expect(rv.calls).toHaveLength(1); expect(rv.disposed).toBe(0);
  f.route.finish(false); expect(f.route.closed).toBe(true);
  f.g.updateExpedition(.1);
  expect(rv.calls).toHaveLength(2);
  f.g.setPaused('manual', true); f.g.updateExpedition(.1);
  expect(rv.calls).toHaveLength(2);
});

test('syncView: 시간 진행 없이(dt 0) 냉각 장치 뷰는 (route), 해방 뷰는 (route, 0, opts) 로 갱신하고 일시정지에는 아무것도 하지 않는다', () => {
  const f = fixture(); const rv: any = fakeView(), view: any = fakeView();
  f.route.releaseView = rv; f.route.view = view;
  f.route.syncView(f.g);
  expect(view.calls).toEqual([[f.route]]);
  expect(rv.calls).toHaveLength(1);
  expect(rv.calls[0][0]).toBe(f.route); expect(rv.calls[0][1]).toBe(0); expect(rv.calls[0][2]).toEqual({ reduced: false });
  // 실제 방 입장 경로(enterRoom)도 같은 프레임에 두 뷰를 맞춘다.
  f.g.enterRoom(f.world.rooms[2]);
  expect(view.calls).toHaveLength(2); expect(rv.calls).toHaveLength(2);
  expect(rv.calls[1][1]).toBe(0); expect(rv.calls[1][2]).toBe(rv.calls[0][2]);
  f.g.setPaused('manual', true);
  f.route.syncView(f.g); f.g.enterRoom(f.world.rooms[4]);
  expect(view.calls).toHaveLength(2); expect(rv.calls).toHaveLength(2);
  f.g.setPaused('manual', false);
  f.g.app.reducedMotion = { matches: true };
  f.route.syncView(f.g);
  expect(rv.calls.at(-1)[2].reduced).toBe(true);
});

test('syncView: 해방 뷰가 없는 일반 재벼림도 냉각 장치 뷰를 같은 프레임에 맞춘다', () => {
  const f = fixture('standard'); const view: any = fakeView(); f.route.view = view;
  expect(f.route.releaseView).toBeNull();
  f.g.enterRoom(f.world.rooms[1]);
  expect(view.calls).toEqual([[f.route]]);
  f.route.syncView({ paused: true }); expect(view.calls).toHaveLength(1);
});

test('releaseView: stop 은 두 뷰를 한 번씩 dispose 하고 반복 stop·Battle.stop 은 안전하며 정지 뒤에는 갱신하지 않는다', () => {
  const f = fixture(); const rv: any = fakeView(), view: any = fakeView();
  f.route.releaseView = rv; f.route.view = view;
  f.route.stop();
  expect(rv.disposed).toBe(1); expect(view.disposed).toBe(1);
  expect(f.route.releaseView).toBeNull(); expect(f.route.view).toBeNull();
  f.route.stop();
  expect(rv.disposed).toBe(1); expect(view.disposed).toBe(1);
  f.route.update(f.g, .1); f.route.syncView(f.g);
  expect(rv.calls).toHaveLength(0);

  const g = fixture(); const rv2: any = fakeView(); g.route.releaseView = rv2;
  g.g.stop();                                    // 실제 정지 경로
  expect(rv2.disposed).toBe(1); expect(g.g.routeObjectives).toBeNull();
  g.g.stop(); expect(rv2.disposed).toBe(1);
});

test('prepareReleaseView: 해방 정의가 아니면 releaseView 를 만들지 않고, 만들 수 없어도 던지지 않으며, 정지된 뒤에는 붙이지 않는다', async () => {
  // prepareView 는 냉각 장치 GLB 로드를 거치므로 단위 테스트에서는 해방 뷰 준비 단계만 직접 부른다.
  const standard = fixture('standard');
  await standard.route.prepareReleaseView(new Scene());
  expect(standard.route.releaseView).toBeNull();

  const deep = fixture();
  await expect(deep.route.prepareReleaseView(null)).resolves.toBeUndefined();
  expect(deep.route.releaseView).toBeNull();      // 장면이 없으면 만들 수 없다
  // 뷰 파일이 있는 통합 빌드에서는 dispose 가능한 뷰가 붙고, 파일이 없는 브랜치에서는 null 이다. 어느 쪽이든 던지지 않는다.
  await expect(deep.route.prepareReleaseView(new Scene())).resolves.toBeUndefined();
  if (deep.route.releaseView) expect(typeof (deep.route.releaseView as any).dispose).toBe('function');
  deep.route.stop(); expect(deep.route.releaseView).toBeNull();
  await deep.route.prepareReleaseView(new Scene());
  expect(deep.route.releaseView).toBeNull();
});

test('충격파는 준비된 뒤 시작된 분출만 센다: 분출 도중 준비되면 그 분출 끝은 세지 않고, 예고 중 준비되면 센다(리뷰 P2-1)', () => {
  for (const readyIn of ['vent', 'warning'] as const) {
    const f = fixture(); const gate = gateOf(f, 2);
    const room = enter(f, 2);
    // 영웅을 방 중심(분출 띠 |x| 1.5~5.5 밖)에 두고, 첫 분출(또는 예고)이 시작될 때까지 전투 중 시간을 흘린다.
    run(f, () => new Vector3(room.x, 0, room.z), () => gate.phase === readyIn);
    for (let i = 0; i < 3; i++) killWave(f, room);
    expect(gate.ready).toBe(true); expect(gate.shocks).toBe(0); expect(gate.phase).toBe(readyIn);
    // 지금 주기의 분출이 끝나 가열로 돌아간 첫 스텝.
    run(f, () => new Vector3(room.x, 0, room.z), () => gate.phase === 'heat');
    if (readyIn === 'vent') {
      expect(gate.shocks).toBe(0); expect(f.route.padOpen(gate)).toBe(false);
      // 다음 주기의 분출(준비된 뒤 시작)이 끝나야 열린다.
      run(f, () => new Vector3(room.x, 0, room.z), () => gate.shocks >= 1);
      expect(gate.phase).toBe('heat'); expect(f.route.padOpen(gate)).toBe(true);
    } else {
      expect(gate.shocks).toBe(1); expect(f.route.padOpen(gate)).toBe(true);
    }
  }
});

