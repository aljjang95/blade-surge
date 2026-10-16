import { expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, ashforgeChainResultLine } from '../src/expansion/hub.jsx';

// 규칙 코어(AshforgeChainBreak)는 쓰지 않는다. 실제 재벼림 심층 냉각 경로를 만들고, chains 정의(PLAN 3.1)와 컨트롤러 읽기 상태(PLAN 3.2)를 가짜로 끼운다.
const CHAINS = Object.freeze({ id: 'ashforge_deep_chains', boss: 'ash_colossus', signature: 'kiln_hammer', count: 3, window: 5, hold: 1.2, radius: 1.6,
  pillarOffset: 8.4, anchorMargin: 1.2, exposed: 5, exposedMult: 1.5 });

function fixture(routeId = 'ashforge_catacomb', withDef = true) {
  const stage = buildExpeditionStage('dungeon', routeId, null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage), route: any = createRouteObjectives(stage, world);
  if (withDef) route.def = { ...route.def, chains: CHAINS };
  const battle: any = { world, routeObjectives: route, curRoom: world.startRoom, conquest: null, boss: null };
  const set = (name: string, value: any) => Object.defineProperty(route, name, { configurable: true, value });
  return { stage, world, route, battle, setChains: (v: any) => set('chains', v), setRear: (v: any) => set('rear', v) };
}
const fake = (over: any = {}) => ({ state: 'chained', count: 3, chainsLeft: 3, pulling: false, hold: 0, holdTotal: CHAINS.hold, windowLeft: 0, windowTotal: CHAINS.window,
  exposedLeft: 0, exposedTotal: CHAINS.exposed, ...over });
const TITLE = '거수의 사슬';

test('정의 전제: 실제 재벼림 심층 경로는 냉각 정의이고 첫 밸브 단계를 보인다', () => {
  const f = fixture('ashforge_catacomb', false);
  expect(f.route.def.kind).toBe('cooling'); expect(f.route.def).toBe(ROUTE_OBJECTIVES.ashforge_deep);
  expect(battleObjectiveView(f.battle).title).not.toBe(TITLE);
});

test('chained(끌기 없음): 남은 사슬 수와 안내 문구를 보이고 hold 는 비운다', () => {
  const f = fixture(), chains: any = fake(); f.setChains(chains);
  const panel = () => battleObjectiveView(f.battle);
  expect(panel()).toMatchObject({ title: TITLE, action: '남은 사슬 3/3 · 망치가 끄는 반대편 기둥에서 버티기', progress: 0, total: 0, hold: 0, holdTotal: 0, roomId: null });
  chains.chainsLeft = 1; expect(panel().action).toBe('남은 사슬 1/3 · 망치가 끄는 반대편 기둥에서 버티기');
  // 총 사슬 수는 def 에서 계산한다.
  f.route.def = { ...f.route.def, chains: { ...CHAINS, count: 5 } }; chains.chainsLeft = 4;
  expect(panel().action).toBe('남은 사슬 4/5 · 망치가 끄는 반대편 기둥에서 버티기');
});

test('chained(끌기 중): 망치 쪽으로 끌린다는 문구다', () => {
  const f = fixture(); f.setChains(fake({ pulling: true, pullSide: 1 }));
  expect(battleObjectiveView(f.battle)).toMatchObject({ title: TITLE, action: '사슬이 망치 쪽으로 끌림 · 반대편 기둥으로', hold: 0, holdTotal: 0 });
});

test('open: 남은 시간은 0.1초 올림, 버틴 시간은 0.1초 내림이고 hold 막대는 hold/holdTotal 이다', () => {
  const f = fixture(), chains: any = fake({ state: 'open', windowLeft: 5, hold: 0 }); f.setChains(chains);
  const panel = () => battleObjectiveView(f.battle);
  expect(panel()).toMatchObject({ title: TITLE, action: '기둥 열림 5.0초 · 행동 없이 0.0/1.2초', hold: 0, holdTotal: 1.2 });
  chains.windowLeft = 3.31; chains.hold = .59; expect(panel()).toMatchObject({ action: '기둥 열림 3.4초 · 행동 없이 0.5/1.2초', hold: .5 });
  chains.windowLeft = 3.3; chains.hold = .6; expect(panel().action).toBe('기둥 열림 3.3초 · 행동 없이 0.6/1.2초');
  chains.windowLeft = .04; chains.hold = 1.19; expect(panel()).toMatchObject({ action: '기둥 열림 0.1초 · 행동 없이 1.1/1.2초', hold: 1.1 });
  chains.windowLeft = 1; chains.hold = 1.2; expect(panel()).toMatchObject({ action: '기둥 열림 1.0초 · 행동 없이 1.2/1.2초', hold: 1.2 });
  // 버틴 시간을 올림으로 보이면 안 된다: 0.01 은 0.0 이다.
  chains.hold = .01; expect(panel().action).toBe('기둥 열림 1.0초 · 행동 없이 0.0/1.2초');
  // 총 버티기 시간 문구는 def 에서 계산한다.
  f.route.def = { ...f.route.def, chains: { ...CHAINS, hold: 2 } }; chains.hold = 1; chains.holdTotal = 2;
  expect(panel()).toMatchObject({ action: '기둥 열림 1.0초 · 행동 없이 1.0/2.0초', holdTotal: 2 });
});

test('exposed: 휘청 남은 시간은 0.1초 올림, 배율은 def 에서 계산하고 막대는 exposedLeft/exposedTotal 이다', () => {
  const f = fixture(), chains: any = fake({ state: 'exposed', chainsLeft: 2, exposedLeft: 5 }); f.setChains(chains);
  const panel = () => battleObjectiveView(f.battle);
  expect(panel()).toMatchObject({ title: TITLE, action: '사슬 끊김 · 휘청 5.0초 · 받는 피해 150%', hold: 5, holdTotal: 5 });
  chains.exposedLeft = 2.21; expect(panel()).toMatchObject({ action: '사슬 끊김 · 휘청 2.3초 · 받는 피해 150%', hold: 2.2 });
  chains.exposedLeft = .04; expect(panel()).toMatchObject({ action: '사슬 끊김 · 휘청 0.1초 · 받는 피해 150%', hold: 0 });
  f.route.def = { ...f.route.def, chains: { ...CHAINS, exposedMult: 2 } }; chains.exposedLeft = 1;
  expect(panel().action).toBe('사슬 끊김 · 휘청 1.0초 · 받는 피해 200%');
});

test('값이 숫자가 아니면 0 으로 방어한다', () => {
  const f = fixture(), chains: any = fake({ state: 'open', windowLeft: NaN, hold: undefined, holdTotal: undefined }); f.setChains(chains);
  expect(battleObjectiveView(f.battle)).toMatchObject({ action: '기둥 열림 0.0초 · 행동 없이 0.0/1.2초', hold: 0, holdTotal: 1.2 });
  chains.state = 'exposed'; chains.exposedLeft = 'x'; chains.exposedTotal = null;
  expect(battleObjectiveView(f.battle)).toMatchObject({ action: '사슬 끊김 · 휘청 0.0초 · 받는 피해 150%', hold: 0, holdTotal: 0 });
  chains.state = 'chained'; chains.chainsLeft = undefined;
  expect(battleObjectiveView(f.battle).action).toBe('남은 사슬 0/3 · 망치가 끄는 반대편 기둥에서 버티기');
});

test('idle·unchained·ended·컨트롤러 없음·정의 없음이면 기존 밸브 단계 그대로다(밸브 진행 중 무영향)', () => {
  const base = fixture('ashforge_catacomb', false), baseline = battleObjectiveView(base.battle);
  expect(baseline.title).not.toBe(TITLE);
  for (const state of ['idle', 'unchained', 'ended']) {
    const f = fixture(); f.setChains(fake({ state, windowLeft: 3, exposedLeft: 3, hold: .5 }));
    expect(battleObjectiveView(f.battle)).toEqual(baseline);
  }
  const none = fixture(); none.setChains(null); expect(battleObjectiveView(none.battle)).toEqual(baseline);
  const absent = fixture(); expect(battleObjectiveView(absent.battle)).toEqual(baseline);
  const noDef = fixture('ashforge_catacomb', false); noDef.setChains(fake({ state: 'open', windowLeft: 3 }));
  expect(battleObjectiveView(noDef.battle)).toEqual(baseline);
});

test('chained·open·exposed 에서는 밸브가 남아 있어도 사슬 단계가 gate 단계보다 앞선다', () => {
  const f = fixture(); expect(f.route.gates[f.route.progress]).toBeTruthy();
  for (const state of ['chained', 'open', 'exposed']) {
    f.setChains(fake({ state, windowLeft: 2, exposedLeft: 2 })); expect(battleObjectiveView(f.battle).title).toBe(TITLE);
  }
});

test('다른 냉각 정의와 다른 종류의 경로는 사슬 단계가 없다', () => {
  // 일반 재벼림·잿불금고 심층(rear 단계가 있는 정의)에는 chains 정의가 없다.
  for (const id of ['ember_vault']) {
    const f = fixture(id, false); expect(f.route.def.chains).toBeUndefined();
    const baseline = battleObjectiveView(f.battle);
    f.setChains(fake({ state: 'open', windowLeft: 3 })); expect(battleObjectiveView(f.battle)).toEqual(baseline);
  }
  const standard = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'standard' });
  const world = buildExpeditionWorld(standard), route: any = createRouteObjectives(standard, world);
  expect(route.def.chains).toBeUndefined();
  // kind 가 cooling 이 아니면 chains 가 있어도 무시한다.
  const other = fixture(); other.setChains(fake({ state: 'open', windowLeft: 3 }));
  other.route.def = { ...other.route.def, kind: 'records' };
  expect(battleObjectiveView(other.battle).title).not.toBe(TITLE);
});

test('ember_deep 의 rear 단계는 그대로이고, 두 컨트롤러가 함께 있어도 서로의 문구를 바꾸지 않는다', () => {
  const rearOnly = fixture('ember_vault', false);
  rearOnly.setRear({ state: 'exposed', windowLeft: 3, windowTotal: 4 });
  const rearView = battleObjectiveView(rearOnly.battle);
  expect(rearView.title).toBe('사슬 집행자 후방');
  // 사슬 정의도 컨트롤러도 없는 경로의 rear 단계는 사슬 컨트롤러가 붙어도 그대로다.
  rearOnly.setChains(fake({ state: 'idle' })); expect(battleObjectiveView(rearOnly.battle)).toEqual(rearView);
  // 같은 route 에 둘 다 있을 때: rear 가 쉬면 사슬 단계, 사슬이 쉬면 rear 단계다. 둘 다 활성이면 rear 를 먼저 보인다.
  const both = fixture('ember_vault'); const rear: any = { state: 'idle', windowLeft: 0, windowTotal: 4 }, chains: any = fake({ state: 'open', windowLeft: 3 });
  both.route.def = { ...both.route.def, rear: ROUTE_OBJECTIVES.ember_deep.rear };
  both.setRear(rear); both.setChains(chains);
  expect(battleObjectiveView(both.battle).title).toBe(TITLE);
  rear.state = 'exposed'; chains.state = 'idle'; expect(battleObjectiveView(both.battle).title).toBe('사슬 집행자 후방');
  rear.state = 'exposed'; chains.state = 'open'; expect(battleObjectiveView(both.battle).title).toBe('사슬 집행자 후방');
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
  const result: any = { win: true, kind: 'dungeon', id: 'ashforge_catacomb', name: '재벼림 제련소', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  return expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0];
}
const labelsOf = (view: any) => all(view).filter(n => n.type === 'p' && n.props['aria-label']);
const valves = { id: 'ashforge_heart_furnaces_deep', label: '심장로 냉각', complete: true, progress: 4, target: 4, rooms: [2, 4, 5, 7] };
const report = { id: 'ashforge_deep_chains', count: 3, windows: 4, cuts: 2, misses: 1, exposedDamage: 1200, broken: 0 };

test('결과 줄 문구', () => {
  expect(ashforgeChainResultLine(report)).toBe('거수의 사슬 끊음 2/3 · 기둥 창 4번 · 놓침 1번');
  expect(ashforgeChainResultLine({ ...report, cuts: 3, windows: 3, misses: 0 })).toBe('거수의 사슬 끊음 3/3 · 기둥 창 3번 · 놓침 0번');
  expect(ashforgeChainResultLine({ ...report, cuts: 0, windows: 0, misses: 0 })).toBe('거수의 사슬 끊음 0/3 · 기둥 창 0번 · 놓침 0번');
  expect(ashforgeChainResultLine({ cuts: NaN, count: undefined, windows: '2', misses: null } as any)).toBe('거수의 사슬 끊음 0/0 · 기둥 창 0번 · 놓침 0번');
});

test('결과 화면: chains 가 있으면 냉각 결과 줄 바로 뒤에 한 줄을 그리고, 없으면 그리지 않는다', () => {
  const lines = labelsOf(resultView({ ...valves, chains: report })), labels = lines.map(n => n.props['aria-label']);
  const at = labels.findIndex(l => l.includes('결과') && l !== '거수의 사슬 결과' && textOf(lines[labels.indexOf(l)]).includes(valves.label));
  expect(at).toBeGreaterThanOrEqual(0); expect(labels[at + 1]).toBe('거수의 사슬 결과');
  expect(textOf(lines[at + 1])).toBe('거수의 사슬 끊음 2/3 · 기둥 창 4번 · 놓침 1번');
  expect(labels.filter(l => l === '거수의 사슬 결과')).toHaveLength(1);

  const without = resultView(valves);
  expect(labelsOf(without).map(n => n.props['aria-label'])).not.toContain('거수의 사슬 결과');
  expect(textOf(without)).not.toContain('거수의 사슬');
  expect(textOf(resultView(null))).not.toContain('거수의 사슬');
  // 다른 보고(rear 만 있음)에도 사슬 줄은 없다.
  const rearOnly = resultView({ ...valves, rear: { id: 'ember_deep_rear', windows: 1, rearHits: 2, frontHits: 0, sideHits: 0, rearDamage: 1, frontDamage: 0, broken: 0 } });
  expect(textOf(rearOnly)).not.toContain('거수의 사슬');
});
