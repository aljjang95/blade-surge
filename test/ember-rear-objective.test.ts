import { expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, emberRearResultLine } from '../src/expansion/hub.jsx';

const REAR = ROUTE_OBJECTIVES.ember_deep.rear;

// 실제 냉각 밸브 경로를 만들고, 후방 컨트롤러만 읽기 계약대로 만든 가짜로 바꿔 끼운다(규칙 코어는 쓰지 않는다).
function fixture(routeId = 'ember_vault') {
  const stage = buildExpeditionStage('dungeon', routeId, null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage), route: any = createRouteObjectives(stage, world);
  const battle: any = { world, routeObjectives: route, curRoom: world.startRoom, conquest: null, boss: null };
  const setRear = (rear: any) => Object.defineProperty(route, 'rear', { configurable: true, value: rear });
  return { stage, world, route, battle, setRear };
}
const fakeRear = (over: any = {}) => ({ state: 'armored', windowLeft: 0, windowTotal: REAR.window, ...over });

test('armored: 제목과 문구를 보이고 hold 는 비운다', () => {
  const f = fixture(); f.setRear(fakeRear());
  expect(battleObjectiveView(f.battle)).toMatchObject({ title: '사슬 집행자 후방', action: '용재 망치가 박히면 등 뒤로 · 정면은 사슬 갑주',
    progress: 0, total: 0, hold: 0, holdTotal: 0, roomId: null });
});

test('exposed: 남은 시간은 0.1초 올림이고 % 는 def 에서 계산하며 hold 는 0.1 내림, holdTotal 은 창 길이다', () => {
  const f = fixture(), rear: any = fakeRear({ state: 'exposed', windowLeft: 4 }); f.setRear(rear);
  const panel = () => battleObjectiveView(f.battle);
  expect(panel()).toMatchObject({ title: '사슬 집행자 후방', action: '후방 노출 4.0초 · 등 뒤 200% · 정면 50%', hold: 4, holdTotal: 4 });
  rear.windowLeft = 3.31; expect(panel()).toMatchObject({ action: '후방 노출 3.4초 · 등 뒤 200% · 정면 50%', hold: 3.3 });
  rear.windowLeft = 1.0; expect(panel().action).toBe('후방 노출 1.0초 · 등 뒤 200% · 정면 50%');
  rear.windowLeft = .04; expect(panel()).toMatchObject({ action: '후방 노출 0.1초 · 등 뒤 200% · 정면 50%', hold: 0 });
  // 창이 닫혀 armored 로 돌아가면 문구와 hold 도 따라간다.
  rear.windowLeft = 0; rear.state = 'armored'; expect(panel()).toMatchObject({ action: '용재 망치가 박히면 등 뒤로 · 정면은 사슬 갑주', hold: 0, holdTotal: 0 });
});

test('배율 문구는 def 값에서 계산한다', () => {
  const f = fixture(); f.setRear(fakeRear({ state: 'exposed', windowLeft: 2 }));
  f.route.def = { ...f.route.def, rear: { ...REAR, rear: 1.5, front: .25 } };
  expect(battleObjectiveView(f.battle).action).toBe('후방 노출 2.0초 · 등 뒤 150% · 정면 25%');
});

test('idle·ended·컨트롤러 없음이면 기존 밸브 단계 그대로다(밸브 진행 중 무영향)', () => {
  const real = fixture(), baseline = battleObjectiveView(real.battle);
  expect(real.route.rear).not.toBeNull(); expect(real.route.rear.state).toBe('idle');
  expect(baseline.title).toBe('냉각 밸브 개방');
  for (const state of ['idle', 'ended']) {
    const f = fixture(); f.setRear(fakeRear({ state, windowLeft: 3 }));
    expect(battleObjectiveView(f.battle)).toEqual(baseline);
  }
  const none = fixture(); none.setRear(null); expect(battleObjectiveView(none.battle)).toEqual(baseline);
  const noDef = fixture(); noDef.setRear(fakeRear({ state: 'exposed', windowLeft: 3 })); noDef.route.def = { ...noDef.route.def, rear: undefined };
  expect(battleObjectiveView(noDef.battle)).toEqual(baseline);
});

test('다른 냉각 정의와 다른 종류의 경로는 후방 단계가 없다', () => {
  const forge = fixture('ashforge_catacomb');
  expect(forge.route.def.rear).toBeUndefined(); expect(forge.route.rear).toBeNull();
  const baseline = battleObjectiveView(forge.battle);
  forge.setRear(fakeRear({ state: 'exposed', windowLeft: 3 }));
  expect(battleObjectiveView(forge.battle)).toEqual(baseline);
  // kind 가 cooling 이 아니면 rear 가 있어도 무시한다.
  const other = fixture(); other.setRear(fakeRear({ state: 'exposed', windowLeft: 3 }));
  other.route.def = { ...other.route.def, kind: 'records' };
  expect(battleObjectiveView(other.battle).title).not.toBe('사슬 집행자 후방');
});

// ---- 결과 줄 ----
function expand(node: any): any[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (typeof node.type === 'symbol') return expand(node.props.children);
  return [{ type: node.type, props: node.props, children: expand(node.props.children) }];
}
const all = (node: any): any[] => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(all)];
const textOf = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(textOf).join('');
function resultView(routeObjective: any) {
  const result: any = { win: true, kind: 'dungeon', id: 'ember_vault', name: '잿불금고', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  return expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0];
}
const valves = { id: 'ember_tide_valves_deep', label: '냉각 밸브 개방', complete: true, progress: 3, target: 3, rooms: [2, 3, 4] };
const rearReport = { id: 'ember_deep_rear', windows: 2, rearHits: 7, frontHits: 3, sideHits: 1, rearDamage: 900, frontDamage: 120, broken: 0 };

test('결과 줄 문구', () => {
  expect(emberRearResultLine(rearReport)).toBe('사슬 집행자 후방 공격 7회 · 노출 2번 · 정면 막힘 3회');
  expect(emberRearResultLine({ ...rearReport, windows: 0, rearHits: 0, frontHits: 0 })).toBe('사슬 집행자 후방 공격 0회 · 노출 0번 · 정면 막힘 0회');
  expect(emberRearResultLine({ rearHits: NaN, windows: undefined, frontHits: '3' } as any)).toBe('사슬 집행자 후방 공격 0회 · 노출 0번 · 정면 막힘 0회');
});

test('결과 화면: rear 가 있으면 냉각 밸브 결과 줄 바로 뒤에 한 줄을 그리고, 없으면 그리지 않는다', () => {
  const view = resultView({ ...valves, rear: rearReport });
  const lines = all(view).filter(n => n.type === 'p' && n.props['aria-label']);
  const labels = lines.map(n => n.props['aria-label']);
  const at = labels.indexOf('냉각 밸브 개방 결과');
  expect(at).toBeGreaterThanOrEqual(0); expect(labels[at + 1]).toBe('사슬 집행자 후방 결과');
  expect(textOf(lines[at + 1])).toBe('사슬 집행자 후방 공격 7회 · 노출 2번 · 정면 막힘 3회');
  expect(labels.filter(l => l === '사슬 집행자 후방 결과')).toHaveLength(1);
  expect(textOf(lines[at])).toBe('냉각 밸브 개방 3/3 · 완료');

  const without = resultView(valves), withoutLabels = all(without).filter(n => n.type === 'p' && n.props['aria-label']).map(n => n.props['aria-label']);
  expect(withoutLabels).toContain('냉각 밸브 개방 결과'); expect(withoutLabels).not.toContain('사슬 집행자 후방 결과');
  expect(textOf(without)).not.toContain('사슬 집행자');
  expect(textOf(resultView(null))).not.toContain('사슬 집행자');
});
