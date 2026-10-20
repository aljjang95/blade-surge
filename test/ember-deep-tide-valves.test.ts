// 잿불금고 심층 냉각 밸브 3곳(BUNDLE-10): 방 2 → 3 → 4 순서, 정예방(2·3)은 증원 1회 뒤에만 준비되고,
// 조작판은 준비된 뒤 밀물(증기 분출)이 한 번 지나간 물 빠짐 구간에만 열린다. 규칙 코드는 재벼림 심층과 같은 냉각 장치 엔진이다.
// 재벼림 심층·일반 재벼림·재의 수문의 문구는 그대로여야 한다.
import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves, coolingVent } from '../src/game/cooling-valves.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
// 적 모델·렌더링은 필요 없다. 방 입장, 대기열, 증원, 목표, 정화·보상, 봉인, 결과는 실제 Battle 코드를 쓴다.
function fixture(depth = 'deep', routeId = 'ember_vault') {
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
/** 입장 → 모든 적 처치. 정예방은 실제 markCleared 증원(잿불금고 1회)을 모두 거쳐 마지막 처치에서 정화 시도까지 간다. */
function defend(f: F, id: number) {
  const room = enter(f, id);
  const waves = room.type === 'elite' ? f.stage.expedition.mechanics.reinforcements + 1 : 1;
  for (let i = 0; i < waves; i++) killWave(f, room);
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
/** 준비된 밸브(차례인 밸브)의 첫 밀물이 끝날 때까지 닫힌 조작판 위에서 기다린다. 기다리는 내내 유지는 0 이다. */
function tide(f: F, id: number) {
  const gate = gateOf(f, id);
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); return gate.shocks >= 1; });
  return gate;
}
function open(f: F, id: number) {
  const gate = gateOf(f, id);
  if (!gate.ready) defend(f, id);
  if (gate.shocks < 1) tide(f, id);
  run(f, () => gate.pad, () => gate.attuned);
  return gate;
}

test('심층 정의: 냉각 밸브 3곳이 방 2·3·4 순서이고 방 종류·번호 라벨이 붙으며 조작판 양쪽에 봉인 밖 경로가 닿는다', () => {
  const f = fixture();
  expect(routeObjectiveForStage(f.stage)).toBe(ROUTE_OBJECTIVES.ember_deep);
  expect(f.route).toBeInstanceOf(CoolingValves);
  expect(f.route.def.id).toBe('ember_tide_valves_deep');
  expect(f.route.def).toMatchObject({ kind: 'cooling', shockWindow: true, ventColor: 0x3d8cff,
    holdSeconds: 2, radius: 1.6, heatSeconds: 4, warningSeconds: 1.4, ventSeconds: .8, padOffset: 3.5 });
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 3, 4]);
  expect(f.world.rooms.map(r => r.type)).toEqual(['start', 'normal', 'elite', 'elite', 'normal', 'boss']);
  expect(f.route.gates.map((g: any) => g.room.type)).toEqual(['elite', 'elite', 'normal']);
  expect(f.world.rooms[2].label).toBe('1번 냉각 밸브 · 좌현 화물칸');
  expect(f.world.rooms[3].label).toBe('2번 냉각 밸브 · 우현 화물칸');
  expect(f.world.rooms[4].label).toBe('3번 냉각 밸브 · 기관실 격벽');
  expect(f.route.copy.title).toBe('냉각 밸브 개방');
  expect(f.route.autoRoom()?.id).toBe(2);
  const flow = f.world.buildFlow(f.world.startRoom.x, f.world.startRoom.z)!;
  const at = (x: number, z: number) => flow[Math.floor(z - f.world.minZ!) * f.world.cols! + Math.floor(x - f.world.minX!)];
  expect(at(f.world.bossRoom.x, f.world.bossRoom.z)).toBe(-1);   // 봉인된 보스방은 닿지 않는다
  for (const gate of f.route.gates) {
    expect(gate.room.objectiveProp).toBe('cooling-valve');
    for (const dx of [0, -3.5, 3.5]) expect(at(gate.room.x + dx, gate.room.z)).toBeGreaterThanOrEqual(0);
  }
});

test('문구의 숫자는 실제 레이아웃·mechanics 와 같다: 정예방 2곳 × 증원 1회, 밸브 3곳, 유지 2초', () => {
  const f = fixture();
  const depth = EXPEDITION_DEPTHS.find(d => d.id === 'ember_vault')!;
  const elites = depth.layout.types.filter((t: string) => t === 'elite').length;
  expect(elites).toBe(f.world.rooms.filter(r => r.type === 'elite').length);
  expect(f.stage.expedition.mechanics.reinforcements).toBe(1);
  expect(f.stage.objective).toBe('냉각 밸브 ' + f.route.gates.length + '곳을 밀물 뒤 순서대로 개방하고 정예방 ' + elites + '곳의 증원 각 '
    + f.stage.expedition.mechanics.reinforcements + '회 격파 → 모든 구역 정화 → 선단 압류관 처치');
  expect(f.stage.objective).toBe(depth.objective);
  expect(f.stage.encounter.tactic).toContain('행동 없이 ' + f.route.def.holdSeconds + '초 유지');
});

test('파티·균열·정복·결투·알 수 없는 깊이·일반 잿불금고는 냉각 밸브 목표를 받지 않는다', () => {
  const base = fixture().stage, world = buildExpeditionWorld(base);
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' },
    { ...base, expedition: { ...base.expedition, riftId: 'x' } },
    { ...base, expedition: { ...base.expedition, conquestId: 'x' } },
    { ...base, expedition: { ...base.expedition, kind: 'arena' } },
    { ...base, expedition: { ...base.expedition, depth: 'unknown' } }]) {
    expect(routeObjectiveForStage(stage)).toBeNull();
    expect(createRouteObjectives(stage, world)).toBeNull();
  }
  const standard = buildExpeditionStage('dungeon', 'ember_vault', null);
  expect(routeObjectiveForStage(standard)).toBeNull();
  expect(createRouteObjectives(standard, buildExpeditionWorld(standard))).toBeNull();
  // 정복(전술) 공략이 걸린 실제 심층 빌드(끊어진 신호·운반책의 행선지)도 밸브를 받지 않는다.
  for (const conquestId of ['vault_signal', 'vault_manifest']) {
    const conquest = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep', conquestId });
    expect(conquest.expedition.conquestId).toBe(conquestId);
    expect(routeObjectiveForStage(conquest)).toBeNull();
  }
});

test('다른 밸브를 먼저 정리해도 차례 전에는 열리지 않고 cleared 도 아니며, 정리해 둔 밸브도 차례에 밀물을 겪어야 한다', () => {
  const f = fixture();
  defend(f, 4); defend(f, 3);
  expect(gateOf(f, 4).ready).toBe(true); expect(gateOf(f, 3).ready).toBe(true);
  for (const id of [4, 3]) {
    f.g.player.pos.copy(gateOf(f, id).pad); f.g.updateExpedition(10);
    expect(f.route.progress).toBe(0); expect(f.route.hold).toBe(0);
    expect(f.world.rooms[id].cleared).toBe(false); expect(gateOf(f, id).attuned).toBe(false);
  }
  expect(f.route.hint()).toContain('1번 냉각 밸브 · 좌현 화물칸');
  expect(f.route.hint()).not.toContain('3번 냉각 밸브');
  expect(f.g.autoTarget.id).toBe(2);

  open(f, 2); expect(f.route.progress).toBe(1); expect(f.g.autoTarget.id).toBe(3);
  expect(f.world.rooms[4].cleared).toBe(false);
  // 방 3 은 이미 정리돼 있지만, 차례가 된 뒤 밀물이 지나가기 전에는 닫혀 있다.
  const second = gateOf(f, 3);
  expect(second.ready).toBe(true); expect(second.shocks).toBe(0); expect(f.route.padOpen(second)).toBe(false);
  f.g.player.pos.copy(second.pad); f.g.updateExpedition(1);
  expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(1);
  open(f, 3); expect(f.route.progress).toBe(2); expect(f.g.autoTarget.id).toBe(4);
  expect(f.world.rooms[4].cleared).toBe(false);
  const third = gateOf(f, 4);
  expect(third.ready).toBe(true); expect(third.shocks).toBe(0); expect(f.route.padOpen(third)).toBe(false);
  open(f, 4); expect(f.route.progress).toBe(3);
  expect(f.world.rooms.slice(2, 5).every(r => r.cleared)).toBe(true);
});

test('정예방 밸브는 실제 markCleared 증원 1회가 끝나기 전에는 ready 가 아니고, 준비 전에는 밀물을 세지 않는다', () => {
  for (const id of [2, 3]) {
    // 방 3 의 증원 검사는 2번 차례에 맞추기 위해 1번을 먼저 연다.
    const f = fixture(); if (id === 3) open(f, 2);
    const gate = gateOf(f, id);
    const room: any = enter(f, id);
    killWave(f, room);
    expect(room.forgeWave).toBe(1); expect(gate.ready).toBe(false);
    expect(f.g.enemies.filter((e: any) => e.alive && e.homeRoom === room)).toHaveLength(4);
    // 증원이 살아 있는 동안 조작판 위에 있어도 유지는 쌓이지 않고, 분출이 지나가도 밀물은 세지 않는다.
    f.g.player.pos.copy(gate.pad); f.g.updateExpedition(7);
    expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(id - 2); expect(gate.shocks).toBe(0);
    expect(gate.cycles).toBeGreaterThanOrEqual(1);
    expect(f.messages.some(m => m.includes(gate.label + ' 방어 완료'))).toBe(false);
    killWave(f, room);
    expect(gate.ready).toBe(true); expect(room.cleared).toBe(false); expect(gate.shocks).toBe(0);
    expect(f.messages).toContain(gate.label + ' 방어 완료 · 밀물이 빠진 뒤 청록 조작판에서 2초 유지');
    // 증원은 한 번뿐이다: 더 이상 증원이 오지 않는다.
    expect(room.forgeWave).toBe(1);
  }
  // 일반방(방 4)은 증원이 없다: 처치 한 번으로 준비된다.
  const g = fixture(); const room: any = defend(g, 4);
  expect(gateOf(g, 4).ready).toBe(true); expect(room.forgeWave).toBeUndefined();
});

test('준비 직후 첫 밀물 전에는 조작판 위에서 2초를 넘겨도 유지 0·열리지 않고, 안내가 밀물 대기를 알린다', () => {
  const f = fixture(); defend(f, 2); const gate = gateOf(f, 2);
  expect(f.route.padOpen(gate)).toBe(false);
  expect(gate.phase).toBe('heat');
  f.g.player.pos.copy(gate.pad);
  for (let i = 0; i < 39; i++) { f.g.updateExpedition(.1); expect(f.route.hold).toBe(0); }
  expect(gate.phase).toBe('heat'); expect(f.route.progress).toBe(0);
  expect(f.route.hint()).toBe('냉각 밸브 0/3 · 1번 냉각 밸브 · 좌현 화물칸 · 물 빠짐 · 밀물 대기');
  // 밀물 경고·밀물 중에도 같은 자리(분출 띠 밖)에 머물며 합쳐서 2초를 훌쩍 넘긴다.
  const seen = new Set<string>();
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
    if (gate.shocks >= 1) return true;
    seen.add(f.route.hint().split(' · ').slice(3).join(' · '));
    return false; });
  expect([...seen]).toEqual(['물 빠짐 · 밀물 대기', '밀물 경고 · 밀물 대기', '밀물 · 밀물 대기']);
  expect(gate.phase).toBe('heat'); expect(gate.attuned).toBe(false); expect(f.hits).toEqual([]);
  expect(f.route.padOpen(gate)).toBe(true);
});

test('밀물 뒤 옮겨 간 조작판에서 물 빠짐 구간에 2초 유지하면 열리고 토스트·안내가 개방을 알린다', () => {
  const f = fixture(); defend(f, 2); const gate = tide(f, 2);
  const oldPad = f.g.player.pos.clone();           // 밀물 직전에 서 있던 조작판 자리
  expect(gate.pad.distanceTo(oldPad)).toBeGreaterThan(6);
  expect(gate.shocks).toBe(1); expect(gate.side).toBe(-1);
  f.g.player.pos.copy(oldPad); f.g.updateExpedition(.5);
  expect(f.route.hold).toBe(0);                     // 조작판은 반대편으로 옮겨 갔다
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(1.4);
  expect(f.route.hold).toBeCloseTo(1.4, 1); expect(f.route.progress).toBe(0);
  expect(f.route.hint()).toContain('물 빠짐 · 청록판 2초 (1.4/2)');
  f.g.updateExpedition(.2); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.4);
  expect(gate.attuned).toBe(true); expect(f.route.progress).toBe(1); expect(f.route.hold).toBe(0);
  expect(f.world.rooms[2].cleared).toBe(true);
  expect(f.messages).toContain('1번 냉각 밸브 · 좌현 화물칸 개방 · 냉각 밸브 1/3 개방');
  expect(f.route.hint()).toContain('냉각 밸브 1/3 · 2번 냉각 밸브 · 우현 화물칸');
});

test('열린 유지 중 밀물 경고가 시작되면 유지가 0 이 되고 경고·밀물 동안 쌓이지 않으며, 다음 밀물 뒤 다시 열린다', () => {
  const f = fixture(); defend(f, 2); const gate = tide(f, 2);
  run(f, () => gate.pos, () => gate.age >= 3);
  expect(gate.phase).toBe('heat');
  let before = 0;
  run(f, () => gate.pad, () => { if (gate.phase === 'heat') before = f.route.hold; return gate.phase === 'warning'; });
  expect(before).toBeGreaterThan(.5);
  expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0);
  expect(f.route.padOpen(gate)).toBe(false);
  run(f, () => gate.pad, () => { expect(f.route.hold).toBe(0); expect(f.route.progress).toBe(0); return gate.phase === 'heat'; });
  expect(gate.shocks).toBe(2); expect(f.route.padOpen(gate)).toBe(true);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(2);
  expect(gate.attuned).toBe(true);
});

test('조작판 이탈·공격 상태·일시정지 뒤에는 유지가 0 부터 다시 시작한다', () => {
  const f = fixture(); defend(f, 2); const gate = tide(f, 2);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.4);
  expect(f.route.hold).toBeCloseTo(.4, 1);
  f.g.player.pos.copy(gate.pos); f.g.updateExpedition(.01); expect(f.route.hold).toBe(0);
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.4); expect(f.route.hold).toBeCloseTo(.4, 1);
  for (const state of ['attack', 'skill', 'ult', 'dodge', 'hurt']) {
    f.g.player.state = state; f.g.updateExpedition(.02); expect(f.route.hold).toBe(0);
  }
  f.g.player.state = 'idle'; f.g.updateExpedition(.4); expect(f.route.hold).toBeCloseTo(.4, 1);
  f.g.setPaused('manual', true);
  expect(f.route.hold).toBe(0);
  f.g.updateExpedition(100); expect(f.route.progress).toBe(0); expect(gate.phase).toBe('heat');
  f.g.setPaused('manual', false);
  f.g.updateExpedition(1.9); expect(f.route.progress).toBe(0);
  f.g.updateExpedition(.1); expect(f.route.progress).toBe(1);
});

test('밀물 띠: 경고만으로는 피해가 없고, 밀물이 시작되면 최대 체력 6% 가 밀물당 한 번 들어오며, 문구가 밀물이다', () => {
  const f = fixture(); defend(f, 2); const gate = gateOf(f, 2);
  const first = coolingVent(gate);
  expect(first).toEqual({ x: gate.room.x + 3.5, z: gate.room.z, width: 4, length: 12 });
  const onFirst = () => new Vector3(first.x, 0, first.z);
  run(f, onFirst, () => gate.phase === 'warning');
  expect(f.hits).toEqual([]);                      // 띠 위에 서 있어도 경고 중에는 맞지 않는다
  run(f, onFirst, () => gate.phase === 'vent');
  expect(f.hits).toEqual([6]);                     // 밀물이 시작된 스텝에 최대 체력 100 의 6%
  run(f, onFirst, () => gate.phase === 'heat');
  expect(f.hits).toEqual([6]);                     // 0.8초 동안 띠 안에 있어도 한 번뿐
  expect(gate.hits).toBe(1);
  expect(f.messages.filter(m => m.includes('피해'))).toEqual(['밀물 피해 · 밀물 뒤 옮겨 간 조작판으로 이동']);
  // 다음 밀물의 띠는 반대편이다. 거기에 서면 다시 한 번 맞는다.
  const second = coolingVent(gate);
  expect(second.x).toBe(gate.room.x - 3.5);
  const onSecond = () => new Vector3(second.x, 0, second.z);
  run(f, onSecond, () => gate.phase === 'vent');
  run(f, onSecond, () => gate.phase === 'heat');
  expect(f.hits).toEqual([6, 6]);
  // 피해 수는 결과 보고의 overheatHits 와 같다.
  expect((f.route.finish(false) as any).overheatHits).toBe(2);
});

test('조작판 쪽(밀물 띠 반대편)에 서 있으면 경고·밀물을 지나도 피해가 없다', () => {
  const f = fixture(); open(f, 2); defend(f, 3); const gate = tide(f, 3);
  expect(f.hits).toEqual([]); expect(gate.hits).toBe(0);
  expect(gate.cycles).toBeGreaterThanOrEqual(1);
});

test('안내 문구: 표식은 닫힘일 때 밀물 뒤 조작판, 열림일 때 청록 조작판 · 2초이고 차례 아닌 밸브는 순서 대기다', () => {
  const f = fixture(); const gate = gateOf(f, 2);
  enter(f, 2); f.g.player.pos.copy(gate.pos);
  expect(f.route.hint()).toBe('냉각 밸브 0/3 · 1번 냉각 밸브 · 좌현 화물칸 · 물 빠짐 · 적과 증원 처치');
  defend(f, 2);
  f.g.updateExpedition(.05);
  expect(f.labels.at(-1)).toBe('밀물 뒤 조작판');
  run(f, () => gate.pad, () => gate.shocks >= 1);
  f.labels.length = 0;
  run(f, () => gate.pos, () => f.labels.length > 0, 120);
  expect(f.labels.at(-1)).toBe('청록 조작판 · 2초');
  f.world.rooms[3].discovered = true; f.g.player.pos.set(f.world.rooms[3].x, 0, f.world.rooms[3].z);
  f.labels.length = 0;
  f.g.updateExpedition(2);
  expect(f.labels).toContain('2번 냉각 밸브 · 순서 대기');
});

test('목표창: 제목 냉각 밸브 개방, 닫힘·경고·밀물·열림 action 이 상황에 따라 바뀐다', () => {
  const f = fixture();
  enter(f, 2);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '이 구역의 적과 증원 처치', progress: 0, total: 3, roomId: 2 });
  defend(f, 2); const gate = gateOf(f, 2);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '밀물이 빠진 뒤 옮겨 간 조작판으로 이동', progress: 0, total: 3, roomId: 2, hold: 0, holdTotal: 2 });
  run(f, () => gate.pad, () => gate.phase === 'warning');
  expect(battleObjectiveView(f.g).action).toBe('밀물을 피한 뒤 옮겨 간 조작판으로 이동');
  run(f, () => gate.pad, () => gate.phase === 'vent');
  expect(battleObjectiveView(f.g).action).toBe('밀물을 피한 뒤 옮겨 간 조작판으로 이동');
  run(f, () => gate.pad, () => gate.phase === 'heat');
  f.g.player.pos.copy(gate.pad); f.g.updateExpedition(.5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '청록 조작판에서 2초 유지', holdTotal: 2 });
  expect(battleObjectiveView(f.g).hold).toBeGreaterThanOrEqual(.4);
  f.g.updateExpedition(1.5);
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '다음 구역을 찾아 이동', progress: 1, total: 3, roomId: null });
});

test('3/3 전에는 모든 구역을 정화해도 봉인이 풀리지 않고, 3/3 + 모든 구역 정화 뒤에 풀린다', () => {
  const f = fixture();
  defend(f, 1);
  for (const id of [2, 3]) open(f, id);
  expect(f.route.progress).toBe(2);
  expect(f.route.canUnseal()).toBe(false);
  f.g.unsealBoss(); expect(f.world.sealed).toBe(true);
  open(f, 4);
  expect(f.route.complete).toBe(true); expect(f.route.canUnseal()).toBe(true);
  expect(f.route.hint()).toBe('냉각 밸브 3/3 개방 · 보스 처치');
  f.g.unsealBoss(); expect(f.world.sealed).toBe(false);

  // 밸브 3곳을 열어도 모든 구역을 정화하지 못하면 열리지 않는다.
  const g = fixture();
  for (const id of [2, 3, 4]) open(g, id);
  expect(g.route.complete).toBe(true); expect(g.route.canUnseal()).toBe(false);
  expect(g.route.hint()).toBe('냉각 밸브 3/3 개방 · 남은 구역 정화');
  g.g.unsealBoss(); expect(g.world.sealed).toBe(true);
  defend(g, 1); expect(g.route.canUnseal()).toBe(true);
});

test('결과 보고: 3곳을 모두 연 승리만 complete 이고, 중도 보고는 실제 진행만 담는다', () => {
  const partial = fixture(); open(partial, 2); open(partial, 3);
  const report: any = partial.route.finish(false);
  expect(report).toMatchObject({ id: 'ember_tide_valves_deep', label: '냉각 밸브 개방', complete: false, progress: 2, target: 3, rooms: [2, 3], overheatHits: 0 });
  expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.rooms)).toBe(true);
  expect(partial.route.finish(true)).toBe(report);

  const win = fixture();
  defend(win, 1);
  for (const id of [2, 3, 4]) open(win, id);
  win.g.unsealBoss(); expect(win.world.sealed).toBe(false);
  win.world.bossRoom.cleared = true;
  const done: any = win.route.finish(true);
  expect(done).toMatchObject({ id: 'ember_tide_valves_deep', label: '냉각 밸브 개방', complete: true, progress: 3, target: 3, rooms: [2, 3, 4] });
  expect(win.route.finish(false)).toBe(done);

  const early = fixture(); open(early, 2);
  early.world.bossRoom.cleared = true;
  expect(early.route.finish(true)).toMatchObject({ complete: false, progress: 1, rooms: [2] });
});

test('재벼림 심층·일반 재벼림·재의 수문의 문구는 그대로다(망치 충격파 문구는 정의에 밀물 키가 없을 때의 기본값)', () => {
  // 재벼림 심층: 토스트·안내·표식·피격 토스트·목표창이 '망치 충격파' 문구 그대로.
  const a = fixture('deep', 'ashforge_catacomb'); const first = gateOf(a, 2);
  expect(a.route.words).toEqual({ calm: '가열 중', afterShort: '충격파 뒤', afterLong: '망치 충격파 뒤',
    avoidLong: '망치 충격파를 피한 뒤', waitShort: '충격파 대기' });
  defend(a, 2);
  expect(a.messages.at(-1)).toBe('1번 심장로 · 사슬 단조장 방어 완료 · 망치 충격파 뒤 청록 조작판에서 2초 유지');
  expect(a.route.hint()).toBe('심장로 0/4 · 1번 심장로 · 사슬 단조장 · 가열 중 · 충격파 대기');
  a.g.player.pos.copy(first.pos); a.g.updateExpedition(.05);
  expect(a.labels.at(-1)).toBe('충격파 뒤 조작판');
  expect(battleObjectiveView(a.g).action).toBe('망치 충격파 뒤 옮겨 간 조작판으로 이동');
  const vent = coolingVent(first);
  run(a, () => new Vector3(vent.x, 0, vent.z), () => first.phase === 'vent');
  expect(a.messages.at(-1)).toBe('망치 충격파 피해 · 충격파 뒤 옮겨 간 조작판으로 이동');
  expect(battleObjectiveView(a.g).action).toBe('망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동');
  expect(a.route.hint()).toContain('망치 충격파 · 충격파 대기');

  // 충격파 창이 없는 정의(재의 수문 일반·심층, 일반 재벼림)는 기본 문구.
  for (const [routeId, depth, label, unit] of [['cinder_tide_lock', 'standard', '1번 밸브 · 서쪽 수문', '밸브 0/2'],
    ['cinder_tide_lock', 'deep', '1번 밸브 · 상류 냉각선', '밸브 0/3'], ['ashforge_catacomb', 'standard', '1번 용광로 · 입구 송풍로', '용광로 0/4']]) {
    const f = fixture(depth, routeId); const gate = f.route.gates[0] as any;
    defend(f, gate.room.id);
    expect(f.messages.at(-1)).toBe(label + ' 방어 완료 · 청록 조작판에서 2초 유지');
    expect(f.route.hint()).toBe(unit + ' · ' + label + ' · 가열 중 · 청록판 2초 (0.0/2)');
    const strip = coolingVent(gate);
    run(f, () => new Vector3(strip.x, 0, strip.z), () => gate.phase === 'vent');
    expect(f.messages.at(-1)).toBe('과열 피해 · 반대편 청록 조작판으로 이동');
    expect(battleObjectiveView(f.g).action).toBe('분출을 피하고 청록 조작판으로 이동');
  }
});

test('밀물은 준비된 뒤 시작된 분출만 센다: 분출 도중 준비되면 그 분출 끝은 세지 않고, 경고 중 준비되면 센다', () => {
  for (const readyIn of ['vent', 'warning'] as const) {
    const f = fixture(); const gate = gateOf(f, 2);
    const room = enter(f, 2);
    // 영웅을 방 중심(분출 띠 |x| 1.5~5.5 밖)에 두고, 첫 경고(또는 분출)가 시작될 때까지 전투 중 시간을 흘린다.
    run(f, () => new Vector3(room.x, 0, room.z), () => gate.phase === readyIn);
    for (let i = 0; i < 2; i++) killWave(f, room);
    expect(gate.ready).toBe(true); expect(gate.shocks).toBe(0); expect(gate.phase).toBe(readyIn);
    run(f, () => new Vector3(room.x, 0, room.z), () => gate.phase === 'heat');
    if (readyIn === 'vent') {
      expect(gate.shocks).toBe(0); expect(f.route.padOpen(gate)).toBe(false);
      run(f, () => new Vector3(room.x, 0, room.z), () => gate.shocks >= 1);
      expect(gate.phase).toBe('heat'); expect(f.route.padOpen(gate)).toBe(true);
    } else {
      expect(gate.shocks).toBe(1); expect(f.route.padOpen(gate)).toBe(true);
    }
  }
});

// ---------------- AUTO 진입 방향 모의(PLAN 3.5) ----------------
/** 엔진의 autoTarget·autoPoint 와 월드 거리장(buildFlow/flowDir)으로 영웅을 움직이는 AUTO 모의.
 * 방에 들어서면 enterRoom, 방 안의 적은 그 자리에서 모두 처치한다(전투 시간은 모의하지 않는다).
 * 무적·HP 주입은 없고 밀물 띠에서 맞은 횟수만 센다. 영웅은 밀물 띠를 피하지 않는다. */
function autoWalk(f: F, until: () => boolean, { speed = 6, max = 30 * 240 } = {}) {
  const g = f.g, W = f.world, route = f.route;
  const trail: number[] = [];                      // 지나간 방(연속 중복 제외)
  const runTimers = () => { for (const t of g.timers.splice(0)) t.fn(); };
  let steps = 0;
  for (; steps < max && !until(); steps++) {
    const pos = g.player.pos as Vector3;
    const room = W.roomAt(pos.x, pos.z);
    if (room && room !== g.curRoom) { g.enterRoom(room); runTimers(); }
    if (room && trail.at(-1) !== room.id) trail.push(room.id);
    if (room) {
      for (let i = 0; i < 6 && (g.enemies.some((e: any) => e.alive && e.homeRoom === room) || g.pending.some((n: any) => n.room === room)); i++) {
        killWave(f, room); runTimers();
      }
    }
    // Player.autoExplore 와 같은 목표 선택: 경로 목표 → (정리됐으면) 가장 가까운 미정화 방
    let target = g.autoTarget;
    if (!target || target.cleared || !W.rooms.includes(target)) {
      const cands = W.rooms.filter((r: any) => !r.cleared && !(W.sealed && r === W.bossRoom));
      if (!cands.length) break;
      target = g.autoTarget = cands.sort((a: any, b: any) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))[0];
    }
    const point = route.autoPoint(target) || target;
    if (!(point !== target && Math.hypot(point.x - pos.x, point.z - pos.z) < .65)) {
      const dir = W.flowDir(W.buildFlow(point.x, point.z), pos.x, pos.z);
      const dx = dir ? dir[0] : point.x - pos.x, dz = dir ? dir[1] : point.z - pos.z, l = Math.hypot(dx, dz) || 1;
      pos.x += dx / l * speed / 30; pos.z += dz / l * speed / 30;
    }
    g.updateExpedition(1 / 30); runTimers();
    // 불변식: 밸브 방이 정화되려면 그 밸브가 열려 있어야 한다. 순서가 앞선 밸브부터 열린다.
    route.gates.forEach((gate: any, i: number) => {
      if (gate.room.cleared) expect(gate.attuned).toBe(true);
      if (gate.attuned) expect(route.progress).toBeGreaterThan(i);
    });
  }
  return { steps, trail, seconds: steps / 30 };
}
/** 밸브 1 을 열어 둔 상태로 영웅을 방 start 의 중심에 세운다. */
function afterFirst(start: number) {
  const f = fixture(); open(f, 2);
  expect(f.route.progress).toBe(1); expect(f.g.autoTarget.id).toBe(3);
  const room = f.world.rooms[start];
  f.g.player.pos.set(room.x, 0, room.z);
  return f;
}

test.each([[2], [4], [1]])('AUTO 모의: 방 %i 에서 출발해도 2번 밸브(방 3)를 밀물 뒤 열린 조작판에서 개방하고 3번 밸브까지 이어 마친다', (start) => {
  const f = afterFirst(start);
  const second = gateOf(f, 3), third = gateOf(f, 4);
  let thirdReadyEarly = false;
  const walk = autoWalk(f, () => {
    if (second.attuned) return true;
    thirdReadyEarly ||= third.ready;
    // 조작판이 열리기 전에는 유지가 쌓이지 않는다(2번이 차례인 동안 유지는 2번 것이다).
    if (!f.route.padOpen(second)) expect(f.route.hold).toBe(0);
    return false;
  });
  expect(second.attuned).toBe(true);
  expect(second.shocks).toBeGreaterThanOrEqual(1);   // 밀물을 겪은 뒤에만 열렸다
  expect(f.route.progress).toBe(2);
  expect(f.world.rooms[3].cleared).toBe(true);
  expect(walk.trail).toContain(3);
  expect(walk.seconds).toBeLessThan(120);
  // 방 4 에서 출발하면 3번 밸브 방을 먼저 정리했지만 차례를 기다린다: 준비는 됐고 열리지도 정화되지도 않았다.
  if (start === 4) { expect(thirdReadyEarly).toBe(true); expect(third.attuned).toBe(false); expect(f.world.rooms[4].cleared).toBe(false); }
  // 이어서 3번 밸브: 차례가 된 뒤 밀물을 겪고 열린다.
  autoWalk(f, () => third.attuned);
  expect(third.attuned).toBe(true); expect(third.shocks).toBeGreaterThanOrEqual(1);
  expect(f.route.progress).toBe(3);
  // 모의는 무적이 아니다: 들어간 피해는 모두 최대 체력의 6% 한 단위다.
  expect(f.hits.every(h => h === 6)).toBe(true);
  expect(f.hits.length).toBe(f.route.gates.reduce((n: number, g: any) => n + g.hits, 0));
});

test('AUTO 모의: 시작방에서 끝까지 — 밸브 3곳 개방 → 모든 구역 정화 → 봉인 해제, 차례 아닌 밸브 방은 먼저 정화되지 않는다', () => {
  const f = fixture();
  f.g.player.pos.set(f.world.startRoom.x, 0, f.world.startRoom.z);
  const walk = autoWalk(f, () => !f.world.sealed, { max: 30 * 600 });
  expect(f.route.progress).toBe(3);
  expect(f.route.complete).toBe(true);
  expect(f.world.sealed).toBe(false);
  expect(f.world.rooms.every((r: any) => ['start', 'boss'].includes(r.type) || r.cleared)).toBe(true);
  expect(walk.seconds).toBeLessThan(500);
  expect(f.route.finish(false)).toMatchObject({ progress: 3, rooms: [2, 3, 4] });
  expect(walk.trail.slice(0, 3)).toEqual([0, 1, 2]);   // 1번 밸브(방 2)가 가장 먼저 목표다
});

