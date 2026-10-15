import { expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, astralDeepRingResultLine } from '../src/expansion/hub.jsx';
import { UI } from '../src/ui/ui.js';

// rules lane 의 컨트롤러(src/game/astral-deep-constellations.js)는 쓰지 않는다. BUNDLE-12 PLAN 3.1 의 읽기 계약 모양만 가진 가짜 route 로 목표창 분기와 결과 줄을 검증한다.
const DEEP = ROUTE_OBJECTIVES.astral_deep, STANDARD = ROUTE_OBJECTIVES.astral_standard, RING = DEEP.ring;
const GATE_TITLE = '별자리 복원';

function makeBattle(def: any = DEEP, over: any = {}) {
  const rooms: any[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id, discovered: true, cleared: false,
    type: id === 0 ? 'start' : id === 8 ? 'boss' : 'normal' }));
  const world: any = { rooms, sealed: true, bossRoom: rooms[8] };
  const gates = def.gates.map((g: any) => ({ room: rooms[g.roomId], label: g.label, ready: false, available: false, attuned: false }));
  const ring: any = def.ring ? { phase: 'idle', room: rooms[RING.roomId], left: 0, purified: 0, held: -1,
    marks: RING.marks.map(() => ({ hold: 0, done: false })) } : undefined;
  const route: any = { world, def, gates, progress: 0, read: 0, hold: 0, closed: false, phase: 'combat', ring, ...over,
    get complete() { return this.progress === this.gates.length; } };
  return { world, route, rooms, battle: { world, routeObjectives: route } as any };
}
const panel = (f: any) => battleObjectiveView(f.battle);
const finish = (f: any, ring: any) => {
  f.route.progress = 4; f.route.gates.forEach((g: any) => { g.attuned = true; });
  f.world.rooms.forEach((r: any) => { if (r.type === 'normal') r.cleared = true; });
  Object.assign(f.route.ring, ring);
};

// ---- 성좌 단계: 일반판과 같은 제목·행동 문구 ----
test('성좌 단계: 발견하지 못한 방은 이동 안내만 하고 roomId 를 숨긴다', () => {
  const f = makeBattle(); f.rooms[3].discovered = false;
  expect(panel(f)).toMatchObject({ title: GATE_TITLE, action: '다음 구역을 찾아 이동', roomId: null, progress: 0, total: 4 });
});

test('성좌 단계: 방 3 → 2 → 5 → 6 순서의 방을 가리키며 정의의 순서가 목표창에도 나온다', () => {
  const f = makeBattle(); f.route.gates[0].ready = true;
  const rooms: number[] = [];
  for (let i = 0; i < 4; i++) {
    f.route.progress = i; f.route.gates[i].ready = true;
    rooms.push((panel(f) as any).roomId);
  }
  expect(rooms).toEqual([3, 2, 5, 6]);
});

test('성좌 단계의 문구는 일반 성운(constellations)과 한 글자도 다르지 않다', () => {
  const states: any[] = [
    { ready: false, phase: 'combat', read: 0, hold: 0 },
    { ready: true, phase: 'combat', read: 0, hold: 0 },
    { ready: true, phase: 'read', read: .439, hold: 0 },
    { ready: true, phase: 'select', read: 1, hold: .72 },
    { ready: true, phase: 'retry', read: 1, hold: .3 },
  ];
  for (const state of states) {
    const d = makeBattle(DEEP), s = makeBattle(STANDARD);
    for (const f of [d, s]) { f.route.gates[0].ready = state.ready; Object.assign(f.route, { phase: state.phase, read: state.read, hold: state.hold }); }
    const a: any = panel(d), b: any = panel(s);
    expect({ ...a, roomId: 0 }).toEqual({ ...b, roomId: 0 });
  }
  const d = makeBattle(DEEP); d.route.gates[0].ready = true; d.route.phase = 'read'; d.route.read = .439;
  expect(panel(d)).toMatchObject({ title: GATE_TITLE, action: '모래시계 단서 1초 읽기', hold: .4, holdTotal: 1, roomId: 3 });
  d.route.phase = 'select'; d.route.hold = .72;
  expect(panel(d)).toMatchObject({ action: '월드 단서와 같은 판에서 1초 유지', hold: .7, holdTotal: 1 });
  d.route.phase = 'retry';
  expect(panel(d).action).toBe('판 밖으로 나와 다시 읽기');
  d.route.phase = 'combat';
  expect(panel(d).action).toBe('전투를 마치고 모래시계로 이동');
});

test('성좌 단계: 단서 정답·오답 정보는 목표창 값에 들어가지 않는다', () => {
  const f = makeBattle(); f.route.gates[0].ready = true; f.route.phase = 'select'; f.route.read = 1;
  const text = JSON.stringify(panel(f));
  for (const word of ['circle', 'diamond', 'triangle', '정답', '오답']) expect(text).not.toContain(word);
});

// ---- 4/4 뒤 외곽 고리 ----
test('4/4 뒤 고리가 idle 이면 별자리 복원 · 남은 구역 정화', () => {
  const f = makeBattle(); finish(f, { phase: 'idle' });
  expect(panel(f)).toMatchObject({ title: GATE_TITLE, action: '남은 구역 정화', progress: 4, total: 4, roomId: null });
  f.route.ring = null;
  expect(panel(f)).toMatchObject({ title: GATE_TITLE, action: '남은 구역 정화' });
});

test('고리 open 은 외곽 고리 이동(roomId 7), 방을 발견하지 못했으면 roomId 를 숨긴다', () => {
  const f = makeBattle(); finish(f, { phase: 'open' });
  expect(panel(f)).toMatchObject({ title: '외곽 고리 정화', action: '성좌 외곽 고리로 이동', roomId: 7, total: 4 });
  f.rooms[7].discovered = false;
  expect(panel(f)).toMatchObject({ title: '외곽 고리 정화', roomId: null });
});

test('고리 running 은 남은 시간을 올림해 보이고 정화한 성표 수와 유지 중 성표의 유지량을 준다', () => {
  const f = makeBattle(); finish(f, { phase: 'running', left: 12.3, purified: 1, held: 2 });
  f.route.ring.marks[0].done = true; f.route.ring.marks[2].hold = .439;
  expect(panel(f)).toMatchObject({ title: '외곽 고리 정화', action: '파편이 모이면 중심 밖으로 · 13초', roomId: 7,
    progress: 1, total: 4, hold: .4, holdTotal: 1 });
  f.route.ring.left = 12;
  expect((panel(f) as any).action).toBe('파편이 모이면 중심 밖으로 · 12초');
  f.route.ring.left = .01;
  expect((panel(f) as any).action).toBe('파편이 모이면 중심 밖으로 · 1초');
  // 유지 중인 성표가 없으면 유지량 0.
  f.route.ring.held = -1; f.route.ring.marks[2].hold = 0;
  expect(panel(f)).toMatchObject({ hold: 0, holdTotal: 1, progress: 1 });
});

test('고리 done 이면 기존 보스 흐름으로 이어진다', () => {
  const f = makeBattle(); finish(f, { phase: 'done', purified: 4 });
  expect(panel(f).title).toBe('보스 봉인 해제');   // 아직 봉인이 남은 동안
  f.world.sealed = false;
  expect(panel(f)).toMatchObject({ title: '보스 처치', roomId: 8 });
  f.world.rooms[8].cleared = true;
  expect(panel(f).title).toBe('정화 완료');
  expect(JSON.stringify(panel(f))).not.toContain('외곽');
});

test('고리 단계는 성좌가 4/4 가 되기 전에는 나오지 않는다', () => {
  const f = makeBattle(); f.route.ring.phase = 'running'; f.route.ring.left = 9; f.route.progress = 3;
  f.route.gates.slice(0, 3).forEach((g: any) => { g.attuned = true; });
  expect(panel(f).title).toBe(GATE_TITLE);
  expect(panel(f).action).not.toContain('파편');
});

test('route 가 닫혔거나 다른 월드의 것이면 이 분기를 타지 않는다', () => {
  const f = makeBattle(); finish(f, { phase: 'running', left: 9 }); f.route.closed = true;
  expect(panel(f).title).not.toBe('외곽 고리 정화');
  const g = makeBattle(); finish(g, { phase: 'running', left: 9 }); g.route.world = { rooms: [], sealed: true };
  expect(panel(g).title).not.toBe('외곽 고리 정화');
});

test('일반 성운(조율판)은 고리 문구 없이 기존 문구 그대로다', () => {
  const f = makeBattle(STANDARD);
  expect(panel(f)).toMatchObject({ title: GATE_TITLE, action: '이 구역의 적과 증원 처치' });
  f.route.progress = 3; f.route.gates.slice(0, 3).forEach((g: any) => { g.attuned = true; });
  // 일반판에는 ring 이 없고 4/4 뒤에는 기존 보스 봉인 흐름이다.
  f.route.progress = 3 + 1; f.world.rooms.forEach((r: any) => { if (r.type === 'normal') r.cleared = true; });
  expect(panel(f)).toMatchObject({ title: '보스 봉인 해제' });
  expect(JSON.stringify(panel(f))).not.toContain('외곽');
});

// ---- 결과 줄 ----
test('결과 줄 문구: 완료·미완료와 성표·파편 피격·붕괴 횟수', () => {
  expect(astralDeepRingResultLine({ purified: true, marks: 4, shardHits: 2, collapses: 1, seconds: 31 })).toBe('외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 2회 · 붕괴 1회');
  expect(astralDeepRingResultLine({ purified: false, marks: 2, shardHits: 0, collapses: 0, seconds: 0 })).toBe('외곽 고리 정화 미완료 · 성표 2/4 · 파편 피격 0회 · 붕괴 0회');
  // 횟수가 숫자가 아니면 0 으로 둔다.
  expect(astralDeepRingResultLine({ purified: true, marks: undefined, shardHits: NaN })).toBe('외곽 고리 정화 완료 · 성표 0/4 · 파편 피격 0회 · 붕괴 0회');
});

function expand(node: any): any[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (typeof node.type === 'symbol') return expand(node.props.children);
  return [{ type: node.type, props: node.props, children: expand(node.props.children) }];
}
const flatten = (node: any): any[] => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(flatten)];
const textOf = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(textOf).join('');
function resultLines(routeObjective: any, win = true) {
  const result: any = { win, kind: 'dungeon', id: 'astral_leviathan_spire', name: '성운 첨탑', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  const lines = flatten(expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0]);
  return lines.filter(n => n.type === 'p' && n.props['aria-label']).map(n => ({ label: n.props['aria-label'], text: textOf(n) }));
}
const stations = DEEP.gates.map((g: any) => Object.freeze({ stationId: g.stationId, roomId: g.roomId, label: g.label, choice: g.answer }));
const report = (ring: any, extra: any = {}) => Object.freeze({ id: DEEP.id, complete: true, progress: 4, target: 4, mistakes: 1,
  rooms: Object.freeze(DEEP.gates.map((g: any) => g.roomId)), constellations: Object.freeze(stations),
  ...(ring ? { ring: Object.freeze(ring) } : {}), ...extra });

test('결과 화면: 별자리 줄과 외곽 고리 줄이 각각 한 번씩 나오고 일반 label 줄은 중복되지 않는다', () => {
  const lines = resultLines(report({ purified: true, marks: 4, collapses: 1, shardHits: 2, seconds: 30 }));
  const first = stations.map((s: any) => s.label).join(' → ');
  expect(lines.filter(l => l.label === '별자리 복원 결과')).toEqual([{ label: '별자리 복원 결과', text: '별자리 복원 4/4 · ' + first + ' · 오답 1회' }]);
  expect(lines.filter(l => l.label === '외곽 고리 정화 결과')).toEqual([{ label: '외곽 고리 정화 결과', text: '외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 2회 · 붕괴 1회' }]);
  expect(lines.filter(l => l.label.includes('결과')).length).toBe(2);
});

test('결과 화면: 보고에 label 필드가 있어도 일반 label 줄이 따로 나오지 않는다', () => {
  const lines = resultLines(report({ purified: true, marks: 4, collapses: 0, shardHits: 0, seconds: 25 }, { label: '별자리 복원' }));
  expect(lines.filter(l => l.label === '별자리 복원 결과')).toHaveLength(1);
  expect(lines.some(l => l.text.startsWith('별자리 복원 4/4 · 완료'))).toBe(false);
  // constellations 배열이 비어 있는 패배 보고도 일반 줄이 대신 나오지 않는다.
  const empty = resultLines(report({ purified: false, marks: 0, collapses: 0, shardHits: 0, seconds: 0 }, { label: '별자리 복원', constellations: Object.freeze([]), progress: 0, complete: false }), false);
  expect(empty.find(l => l.label === '별자리 복원 결과')?.text).toBe('별자리 복원 0/4 · 복원한 별자리 없음 · 오답 1회');
  expect(empty.filter(l => l.label === '별자리 복원 결과')).toHaveLength(1);
  expect(empty.find(l => l.label === '외곽 고리 정화 결과')?.text).toBe('외곽 고리 정화 미완료 · 성표 0/4 · 파편 피격 0회 · 붕괴 0회');
});

test('결과 화면: 고리 정화 전에 끝난 패배 보고는 미완료 줄을 낸다', () => {
  const lines = resultLines(report({ purified: false, marks: 2, collapses: 2, shardHits: 3, seconds: 41 }, { complete: false }), false);
  expect(lines.find(l => l.label === '외곽 고리 정화 결과')?.text).toBe('외곽 고리 정화 미완료 · 성표 2/4 · 파편 피격 3회 · 붕괴 2회');
});

test('결과 화면: 일반 성운 보고(ring 없음)에는 외곽 고리 줄이 없고 별자리 줄은 그대로다', () => {
  const standardStations = STANDARD.gates.map((g: any) => ({ stationId: g.stationId, roomId: g.roomId, label: g.label, choice: g.answer }));
  const lines = resultLines(Object.freeze({ id: STANDARD.id, complete: true, progress: 3, target: 3, mistakes: 0,
    rooms: Object.freeze(STANDARD.gates.map((g: any) => g.roomId)), constellations: Object.freeze(standardStations) }));
  expect(lines.some(l => l.label === '외곽 고리 정화 결과')).toBe(false);
  expect(lines.find(l => l.label === '별자리 복원 결과')?.text).toBe('별자리 복원 3/3 · ' + standardStations.map((s: any) => s.label).join(' → ') + ' · 오답 0회');
  // 다른 경로의 label 줄은 영향받지 않는다.
  const other = resultLines(Object.freeze({ id: 'bellfall_bell_gates', label: '종문 조율', complete: true, progress: 3, target: 3 }));
  expect(other.find(l => l.label === '종문 조율 결과')?.text).toBe('종문 조율 3/3 · 완료');
});

// ---- 조율판 HUD 배치 ----
function hudFixture() {
  const ops: boolean[] = [];
  const hud = { classList: { toggle: (_name: string, on: boolean) => { ops.push(on); } } };
  const ui: any = Object.assign(Object.create(UI.prototype), { _astralChoiceHud: false, el: { hud },
    refreshComboFeedback() {}, refreshSkillFeedback() {}, refreshDodgeFeedback() {}, readability: null });
  const update = (battle: any) => ui.updateHud(battle, .016);
  return { ui, ops, update };
}

test('astral-choice-hud: 일반 성운과 심층 성좌에서만 켜지고 다른 경로·비활성 전투·경로 없음에서는 꺼진다', () => {
  for (const [id, expected] of [['astral_constellations_standard', true], ['astral_fallen_constellations_deep', true],
    ['bellfall_bell_gates', false], ['verdigris_root_heart_deep', false], ['astral_something_else', false], [undefined, false]] as const) {
    const f = hudFixture();
    f.update({ active: true, routeObjectives: id ? { def: { id } } : null, player: null });
    f.update({ active: true, routeObjectives: id ? { def: { id } } : null, player: null });
    expect(f.ops).toEqual(expected ? [true] : []);
  }
  // 전투가 끝나면 한 번만 꺼진다.
  const f = hudFixture(), live = { active: true, routeObjectives: { def: { id: 'astral_fallen_constellations_deep' } }, player: null };
  f.update(live); f.update({ ...live, active: false }); f.update({ ...live, active: false });
  expect(f.ops).toEqual([true, false]);
});
