import { expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, sporeChannelResultLine } from '../src/expansion/hub.jsx';

// rules lane 의 컨트롤러(src/game/verdigris-deep-altars.js)는 쓰지 않는다. BUNDLE-11 PLAN 3.1 의 읽기 계약 모양만 가진 가짜 route 로 목표창 분기와 결과 줄을 검증한다.
const DEF = ROUTE_OBJECTIVES.verdigris_deep, STANDARD = ROUTE_OBJECTIVES.verdigris_standard;

function makeBattle(over: any = {}, channel: any = { phase: 'idle', room: { id: 7, discovered: true }, left: 0 }) {
  const rooms: any[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id, discovered: true, cleared: false,
    type: id === 0 ? 'start' : id === 8 ? 'boss' : 'normal' }));
  const world: any = { rooms, sealed: true, bossRoom: rooms[8] };
  const gates = DEF.gates.map((g: any) => ({ room: rooms[g.roomId], label: g.label, ready: false, attuned: false }));
  const route: any = { world, def: DEF, gates, progress: 0, hold: 0, closed: false, litMoves: 0, channel,
    get complete() { return this.progress === this.gates.length; },
    get lit() { return this.progress < this.gates.length ? this.gates[this.progress] : null; }, ...over };
  return { world, route, rooms, battle: { world, routeObjectives: route } as any };
}
const panel = (f: any) => battleObjectiveView(f.battle);
const finish = (f: any, channel: any) => { f.route.progress = 4; f.route.channel = channel; f.world.rooms.forEach((r: any) => { if (r.type === 'normal') r.cleared = true; }); };

test('제단 단계: 발견하지 못한 방은 이동 안내만 하고 roomId 를 숨긴다', () => {
  const f = makeBattle(); f.rooms[2].discovered = false;
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '다음 구역을 찾아 이동', roomId: null, progress: 0, total: 4, hold: 0 });
});

test('제단 단계: 발견했지만 적이 남았으면 적 처치, 준비되면 중심 2초 유지와 유지량', () => {
  const f = makeBattle();
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '뿌리 빛 제단 · 이 구역의 적 처치', roomId: 2, progress: 0, total: 4, hold: 0, holdTotal: 0 });
  f.route.gates[0].ready = true; f.route.hold = .439;
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '뿌리 빛 제단 중심에서 2초 유지', roomId: 2, hold: .4, holdTotal: 2 });
  f.route.hold = 1.99;
  expect((panel(f) as any).hold).toBe(1.9);
});

test('제단 단계: 점등이 옮겨 가면 길 순서와 상관없이 지금 켜진 제단의 방을 가리킨다', () => {
  const f = makeBattle({ progress: 1, litMoves: 1 }); f.route.gates[0].attuned = true;
  expect(panel(f)).toMatchObject({ roomId: 5, progress: 1, total: 4, action: '뿌리 빛 제단 · 이 구역의 적 처치' });
  f.route.progress = 2; f.route.litMoves = 2; f.route.gates[1].attuned = true;
  expect(panel(f)).toMatchObject({ roomId: 3, progress: 2 });
  f.route.progress = 3; f.route.litMoves = 3; f.rooms[6].discovered = false;
  expect(panel(f)).toMatchObject({ roomId: null, action: '다음 구역을 찾아 이동', progress: 3 });
});

test('제단 단계: 점등되지 않은 제단의 순서나 준비 상태는 목표창에 나오지 않는다', () => {
  const f = makeBattle();
  const before = panel(f);
  for (const g of f.route.gates.slice(1)) g.ready = true;   // 차례가 아닌 제단을 먼저 정리해도
  expect(panel(f)).toEqual(before);
  expect(JSON.stringify(before)).not.toContain('5번');
});

test('4/4 뒤 수로가 idle 이면 남은 구역 정화', () => {
  const f = makeBattle(); finish(f, { phase: 'idle', room: { id: 7, discovered: true }, left: 0 });
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '남은 구역 정화', progress: 4, total: 4, roomId: null });
  f.route.channel = null;
  expect(panel(f).action).toBe('남은 구역 정화');
});

test('수로 open 은 서쪽 입구 이동(roomId 7), running 은 남은 시간을 올림해 보인다', () => {
  const f = makeBattle(); finish(f, { phase: 'open', room: { id: 7, discovered: true }, left: 0 });
  expect(panel(f)).toMatchObject({ title: '포자 수로 돌파', action: '서쪽 수로 입구로 이동', roomId: 7, progress: 4, total: 4 });
  f.route.channel = { phase: 'running', room: { id: 7, discovered: true }, left: 12.3 };
  expect(panel(f)).toMatchObject({ title: '포자 수로 돌파', action: '포자 물결이 지나간 뒤 동쪽 출구로 · 13초', roomId: 7 });
  f.route.channel.left = 12;
  expect(panel(f).action).toBe('포자 물결이 지나간 뒤 동쪽 출구로 · 12초');
  f.route.channel.left = .01;
  expect(panel(f).action).toBe('포자 물결이 지나간 뒤 동쪽 출구로 · 1초');
  // 발견하지 못한 방이면 roomId 를 숨긴다.
  f.route.channel = { phase: 'open', room: { id: 7, discovered: false }, left: 0 };
  expect(panel(f).roomId).toBeNull();
});

test('수로 done 이면 기존 보스 흐름으로 이어진다', () => {
  const f = makeBattle(); finish(f, { phase: 'done', room: { id: 7, discovered: true }, left: 0 });
  expect(panel(f).title).toBe('보스 봉인 해제');   // 아직 봉인이 남은 동안
  f.world.sealed = false;
  expect(panel(f)).toMatchObject({ title: '보스 처치', roomId: 8 });
  f.world.rooms[8].cleared = true;
  expect(panel(f).title).toBe('정화 완료');
  expect(JSON.stringify(panel(f))).not.toContain('포자');
});

test('route 가 닫혔거나 다른 월드의 것이면 이 분기를 타지 않는다', () => {
  const f = makeBattle(); f.route.closed = true;
  expect(panel(f).title).not.toBe('생명 제단 정화');
  const g = makeBattle(); g.route.world = { rooms: [], sealed: true };
  expect(panel(g).title).not.toBe('생명 제단 정화');
});

test('일반 녹청(kind 없음)은 기존 문구 그대로다', () => {
  const f = makeBattle();
  const route: any = { world: f.world, def: STANDARD, gates: f.route.gates, progress: 0, hold: .5, closed: false, noun: STANDARD.noun, verb: STANDARD.verb };
  const battle: any = { world: f.world, routeObjectives: route };
  expect(battleObjectiveView(battle)).toMatchObject({ title: '생명 제단 정화', action: '이 구역의 적과 증원 처치', roomId: 2, progress: 0, total: 4 });
  route.gates[0].ready = true;
  expect(battleObjectiveView(battle)).toMatchObject({ title: '생명 제단 정화', action: '중심에서 2초 유지', roomId: 2, hold: .5, holdTotal: 2 });
  route.gates[0].room.discovered = false;
  expect(battleObjectiveView(battle)).toMatchObject({ action: '다음 구역을 찾아 이동', roomId: null });
});

// ---- 결과 줄 ----
test('결과 줄: 돌파 완료·미완료와 포자 피격·범람 횟수', () => {
  expect(sporeChannelResultLine({ crossed: true, floods: 1, sporeHits: 2, seconds: 14.5 })).toBe('포자 수로 돌파 완료 · 포자 피격 2회 · 범람 1회');
  expect(sporeChannelResultLine({ crossed: false, floods: 0, sporeHits: 0, seconds: 0 })).toBe('포자 수로 돌파 미완료 · 포자 피격 0회 · 범람 0회');
  // 횟수가 숫자가 아니면 0회로 둔다.
  expect(sporeChannelResultLine({ crossed: true, floods: undefined, sporeHits: NaN })).toBe('포자 수로 돌파 완료 · 포자 피격 0회 · 범람 0회');
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
function resultLines(routeObjective: any) {
  const result: any = { win: true, kind: 'dungeon', id: 'verdigris_sanctum', name: '녹청 성역', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  const lines = flatten(expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0]);
  return lines.filter(n => n.type === 'p' && n.props['aria-label']).map(n => ({ label: n.props['aria-label'], text: textOf(n) }));
}
const report = (channel: any) => Object.freeze({ id: 'verdigris_root_heart_deep', label: '생명 제단 정화', complete: true, progress: 4, target: 4,
  rooms: Object.freeze([2, 5, 3, 6]), sporeBursts: 0, ...(channel ? { channel: Object.freeze(channel) } : {}) });

test('결과 화면: 기존 일반 줄과 포자 수로 줄이 각각 한 번씩 나온다', () => {
  const lines = resultLines(report({ crossed: true, floods: 1, sporeHits: 2, seconds: 12 }));
  expect(lines.find(l => l.label === '생명 제단 정화 결과')?.text).toBe('생명 제단 정화 4/4 · 완료');
  expect(lines.filter(l => l.label === '포자 수로 돌파 결과')).toEqual([{ label: '포자 수로 돌파 결과', text: '포자 수로 돌파 완료 · 포자 피격 2회 · 범람 1회' }]);
  const lost = resultLines(report({ crossed: false, floods: 0, sporeHits: 0, seconds: 0 }));
  expect(lost.find(l => l.label === '포자 수로 돌파 결과')?.text).toBe('포자 수로 돌파 미완료 · 포자 피격 0회 · 범람 0회');
});

test('결과 화면: channel 이 없는 일반 녹청 보고에는 포자 수로 줄이 없다', () => {
  const lines = resultLines(report(null));
  expect(lines.some(l => l.label === '포자 수로 돌파 결과')).toBe(false);
  expect(lines.find(l => l.label === '생명 제단 정화 결과')?.text).toBe('생명 제단 정화 4/4 · 완료');
  const std = resultLines(Object.freeze({ id: 'verdigris_life_altars', label: '생명 제단 정화', complete: true, progress: 3, target: 3, rooms: [2, 5, 6] }));
  expect(std.some(l => l.label === '포자 수로 돌파 결과')).toBe(false);
  expect(std.find(l => l.label === '생명 제단 정화 결과')?.text).toBe('생명 제단 정화 3/3 · 완료');
});
