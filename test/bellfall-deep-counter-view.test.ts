import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { BellfallDeepCounterView } from '../src/game/bellfall-deep-counter-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, bellfallDeepBellsResultLine } from '../src/expansion/hub.jsx';

// rules lane 의 컨트롤러(src/game/bellfall-deep-counter.js)는 쓰지 않는다. BUNDLE-05 PLAN 3.1 의 읽기 API 를 흉내 낸 가짜 counter 로 뷰·목표창·결과 줄을 검증한다.
const DEF = ROUTE_OBJECTIVES.bellfall_deep, COUNTER = DEF.counter;
const OPTS = { reduced: false };

function makeCounter(over: any = {}) {
  const boss: any = { pos: new Vector3(4, 0, -6), alive: true, def: { scale: 2.25 } };
  return { state: 'veiled', windowLeft: 0, windowTotal: COUNTER.window, windows: 0, boss, ...over };
}
const view$ = (v: BellfallDeepCounterView) => v as any;
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes };
}
const drawn = (scene: THREE.Object3D) => { let n = 0; scene.traverse((o: any) => { if (o.isMesh && o.visible) n++; }); return n; };

test('상태별로 껍질과 고리의 가시성이 정해진다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter({ state: 'idle' }), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  view.update(counter, 1 / 60, OPTS); expect([v.shell.visible, v.ring.visible]).toEqual([false, false]);
  counter.state = 'veiled'; view.update(counter, 1 / 60, OPTS);
  expect([v.shell.visible, v.ring.visible]).toEqual([true, false]); expect(drawn(scene)).toBe(1);
  counter.state = 'open'; counter.windowLeft = COUNTER.window; view.update(counter, 1 / 60, OPTS);
  expect([v.shell.visible, v.ring.visible]).toEqual([false, true]); expect(drawn(scene)).toBe(1);
  counter.state = 'ended'; view.update(counter, 1 / 60, OPTS); expect([v.shell.visible, v.ring.visible]).toEqual([false, false]);
  view.dispose();
});

test('보스가 없거나 죽었으면 veiled·open 이어도 모두 숨긴다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter(), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  view.update(counter, 1 / 60, OPTS); expect(v.shell.visible).toBe(true);
  counter.boss.alive = false; view.update(counter, 1 / 60, OPTS); expect([v.shell.visible, v.ring.visible]).toEqual([false, false]);
  counter.boss.alive = true; counter.state = 'open'; counter.windowLeft = 2; view.update(counter, 1 / 60, OPTS); expect(v.ring.visible).toBe(true);
  counter.boss = null; view.update(counter, 1 / 60, OPTS); expect([v.shell.visible, v.ring.visible]).toEqual([false, false]);
  view.dispose();
});

test('껍질과 고리는 보스 위치를 따라가고 보스 scale 로 크기가 정해진다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter(), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  view.update(counter, 1 / 60, { reduced: true });
  expect([v.shell.position.x, v.shell.position.z]).toEqual([4, -6]); expect(v.shell.position.y).toBeGreaterThan(0);
  const small = v.shell.scale.x;
  counter.boss.pos.set(-3, 0, 8); counter.boss.def.scale = 4.5; view.update(counter, 1 / 60, { reduced: true });
  expect([v.shell.position.x, v.shell.position.z]).toEqual([-3, 8]); expect(v.shell.scale.x).toBeCloseTo(small * 2, 5);
  counter.state = 'open'; counter.windowLeft = COUNTER.window; view.update(counter, 1 / 60, { reduced: true });
  expect([v.ring.position.x, v.ring.position.z]).toEqual([-3, 8]); expect(v.ring.position.y).toBeGreaterThan(0); expect(v.ring.position.y).toBeLessThan(.2);
  view.dispose();
});

test('반격 고리의 반지름과 불투명도가 windowLeft/windowTotal 로 줄어든다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter({ state: 'open' }), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  const radii: number[] = [], alphas: number[] = [];
  for (const left of [3.5, 2.6, 1.7, .8, .05]) {
    counter.windowLeft = left; view.update(counter, 1 / 60, { reduced: true });
    radii.push(v.ring.scale.x); alphas.push(v.ringMat.opacity);
  }
  for (let i = 1; i < radii.length; i++) { expect(radii[i]).toBeLessThan(radii[i - 1]); expect(alphas[i]).toBeLessThan(alphas[i - 1]); }
  expect(radii[radii.length - 1]).toBeGreaterThan(0); expect(alphas[alphas.length - 1]).toBeGreaterThan(0);
  expect(alphas[0]).toBeLessThanOrEqual(1);
  // 범위를 벗어난 값도 안전하다.
  counter.windowLeft = -1; view.update(counter, 1 / 60, { reduced: true }); expect(v.ring.scale.x).toBeGreaterThan(0);
  counter.windowLeft = 99; view.update(counter, 1 / 60, { reduced: true }); expect(v.ring.scale.x).toBeCloseTo(radii[0], 5);
  view.dispose();
});

test('reduced 면 맥동이 없고 일반 모드에서는 시간에 따라 변한다', () => {
  for (const state of ['veiled', 'open']) {
    const scene = new THREE.Scene(), counter: any = makeCounter({ state, windowLeft: 2 }), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
    const sample = () => state === 'veiled' ? [v.shell.scale.x, v.shellMat.opacity] : [v.ring.scale.x, v.ringMat.opacity];
    view.update(counter, 1 / 60, { reduced: true }); const still = sample();
    for (let i = 0; i < 90; i++) { view.update(counter, 1 / 60, { reduced: true }); expect(sample()).toEqual(still); }
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) { view.update(counter, 1 / 60, OPTS); seen.add(sample()[0]); }
    expect(seen.size).toBeGreaterThan(5);
    view.dispose();
  }
});

test('껍질은 영웅을 가리지 않도록 낮은 불투명도·depthWrite false 이고 draw call 은 2 이하다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter(), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  for (let i = 0; i < 120; i++) { counter.state = i % 2 ? 'open' : 'veiled'; counter.windowLeft = 2; view.update(counter, 1 / 60, OPTS); expect(v.shellMat.opacity).toBeLessThanOrEqual(.25); }
  for (const mesh of [v.shell, v.ring]) { expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false); expect(mesh.renderOrder).toBeLessThan(11); }
  expect(census(scene).meshes).toBeLessThanOrEqual(2);
  view.dispose();
});

test('update 는 새 객체를 만들지 않고 geometry·material·mesh 와 위치·크기 객체 참조를 유지한다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter(), view = new BellfallDeepCounterView(scene, counter), v = view$(view);
  const before = census(scene), refs = [v.shell, v.ring, v.shell.position, v.shell.scale, v.ring.position, v.ring.scale, v.shell.geometry, v.ring.geometry, v.shellMat, v.ringMat];
  const children = scene.children.length;
  for (let i = 0; i < 300; i++) {
    counter.state = ['idle', 'veiled', 'open', 'ended'][i % 4]; counter.windowLeft = (i % 36) / 10; counter.boss.pos.x = i * .1;
    counter.boss.alive = i % 9 !== 0;
    view.update(counter, 1 / 60, i % 11 === 0 ? { reduced: true } : OPTS);
    expect(census(scene)).toEqual(before); expect(scene.children.length).toBe(children);
  }
  expect([v.shell, v.ring, v.shell.position, v.shell.scale, v.ring.position, v.ring.scale, v.shell.geometry, v.ring.geometry, v.shellMat, v.ringMat].every((o, i) => o === refs[i])).toBe(true);
  view.dispose();
});

test('dispose 는 scene 에서 제거하고 geometry·material 을 한 번씩 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const scene = new THREE.Scene(), counter: any = makeCounter(), view = new BellfallDeepCounterView(scene, counter);
  const items: any[] = [];
  scene.traverse((o: any) => { if (o.isMesh) { items.push(o.geometry, o.material); } });
  expect(scene.children).toHaveLength(1); expect(items).toHaveLength(4);
  const disposed = new Map<any, number>();
  for (const item of items) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  view.update(counter, 1 / 60, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()]).toEqual([1, 1, 1, 1]);
  expect(() => view.update(counter, 1 / 60, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0);
});

// ---- 목표창 ----
function realWorld() {
  return buildExpeditionWorld(buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' }));
}
function makeRoute(counter: any, phase = 'done') {
  const world: any = realWorld(); world.sealed = true;
  const gates = DEF.gates.map((spec: any, index: number) => {
    const room = world.rooms.find((r: any) => r.id === spec.roomId); room.discovered = true;
    return { room, label: spec.label, index, number: index + 1, phase: 'resonated', center: new Vector3(room.x, 0, room.z) };
  });
  return { def: DEF, world, gates, closed: false, phase, hold: 0, holdGate: null, tollIndex: 3, lastToll: null, lastDiscord: null, discordT: Infinity,
    guide: null, discords: 0, progress: 3, lit: 3, counter } as any;
}
const panel = (route: any) => battleObjectiveView({ world: route.world, routeObjectives: route });

test('목표창: 장막 상태는 피해 감소율을 def 에서 계산해 보이고 hold 를 비운다', () => {
  const route = makeRoute(makeCounter({ state: 'veiled' }));
  expect(panel(route)).toMatchObject({ title: '합창 장막', action: '마지막 울림 직후에만 장막이 걷힘 · 받는 피해 70% 감소', hold: 0, holdTotal: 0, progress: 0, total: 0, roomId: null });
  // veil 값을 바꾸면 문구도 따라간다(하드코딩 아님).
  route.def = { ...DEF, counter: { ...COUNTER, veil: .5 } };
  expect(panel(route).action).toContain('받는 피해 50% 감소');
});

test('목표창: 반격 창은 남은 시간을 0.1초 올림으로 보이고 받는 피해 130%와 hold/holdTotal 을 채운다', () => {
  const counter: any = makeCounter({ state: 'open', windowLeft: 3.5 });
  const route = makeRoute(counter);
  expect(panel(route)).toMatchObject({ title: '합창 장막', action: '반격 창 3.5초 · 받는 피해 130%', hold: 3.5, holdTotal: 3.5 });
  counter.windowLeft = 2.31; expect(panel(route)).toMatchObject({ action: '반격 창 2.4초 · 받는 피해 130%', hold: 2.3, holdTotal: 3.5 });
  counter.windowLeft = .01; expect(panel(route).action).toBe('반격 창 0.1초 · 받는 피해 130%');
  counter.windowLeft = 1; expect(panel(route).action).toBe('반격 창 1.0초 · 받는 피해 130%');
  route.def = { ...DEF, counter: { ...COUNTER, open: 1.5 } };
  expect(panel(route).action).toContain('받는 피해 150%');
});

test('목표창: 단계가 done 이 아니면 기존 종문 문구를 쓴다', () => {
  const counter: any = makeCounter({ state: 'open', windowLeft: 2 });
  for (const [phase, title] of [['wake', '종문 점등'], ['toll', '소등 순서 기억'], ['answer', '종문 역순 공명']] as const) {
    const route = makeRoute(counter, phase); route.progress = 0; route.lit = 0; for (const g of route.gates) g.phase = 'locked';
    expect(panel(route).title).toBe(title);
  }
});

test('목표창: 카운터가 없거나 idle·ended 이면 기존 결과 그대로다', () => {
  const baseline = panel(makeRoute(undefined));
  expect(baseline.title).toBe('보스 봉인 해제');
  for (const state of ['idle', 'ended']) expect(panel(makeRoute(makeCounter({ state })))).toEqual(baseline);
  expect(panel(makeRoute(null))).toEqual(baseline);
  // 카운터 정의가 없는 route 도 안전하다.
  const route = makeRoute(makeCounter({ state: 'veiled' })); route.def = { ...DEF, counter: undefined };
  expect(panel(route)).toEqual(baseline);
  // 다른 종류의 route 는 counter 필드가 있어도 영향받지 않는다.
  const other = makeRoute(makeCounter({ state: 'veiled' })); other.def = { ...DEF, kind: 'records' };
  expect(panel(other).title).not.toBe('합창 장막');
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
const textOf = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(textOf).join('');
function resultText(win: boolean, routeObjective: any) {
  const result: any = { win, kind: 'dungeon', id: 'bellfall_crypt', name: '종락 회랑', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  return textOf(expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0]);
}
const report = (over: any) => Object.freeze({ id: 'bellfall_deep_bells', label: '종문 역순 공명', complete: true, progress: 3, target: 3, rooms: Object.freeze([2, 5, 3]), discords: 1, tolls: 4, ...over });

test('결과 줄: counterWindows 가 숫자일 때만 불협 뒤, 완료 앞에 반격 창 횟수를 넣는다', () => {
  expect(bellfallDeepBellsResultLine(report({ counterWindows: 2 }))).toBe('종문 역순 공명 3/3 · 불협 1회 · 반격 창 2회 · 완료');
  expect(bellfallDeepBellsResultLine(report({ counterWindows: 0 }))).toBe('종문 역순 공명 3/3 · 불협 1회 · 반격 창 0회 · 완료');
  expect(bellfallDeepBellsResultLine(report({ counterWindows: 1, complete: false, progress: 2 }))).toBe('종문 역순 공명 2/3 · 불협 1회 · 반격 창 1회');
  // B04 형식 유지: 필드가 없거나 숫자가 아니면 줄을 바꾸지 않는다.
  expect(bellfallDeepBellsResultLine(report({}))).toBe('종문 역순 공명 3/3 · 불협 1회 · 완료');
  expect(bellfallDeepBellsResultLine(report({ counterWindows: undefined, complete: false }))).toBe('종문 역순 공명 3/3 · 불협 1회');
  for (const bad of [null, '2', NaN]) expect(bellfallDeepBellsResultLine(report({ counterWindows: bad }))).not.toContain('반격 창');
});

test('결과 화면은 같은 줄을 한 번만 보이고 일반 label 줄과 중복되지 않는다', () => {
  const text = resultText(true, report({ counterWindows: 3 }));
  expect(text).toContain('종문 역순 공명 3/3 · 불협 1회 · 반격 창 3회 · 완료');
  expect(text.split('종문 역순 공명').length - 1).toBe(1);
  expect(resultText(true, report({}))).toContain('종문 역순 공명 3/3 · 불협 1회 · 완료');
  expect(resultText(true, report({}))).not.toContain('반격 창');
  const std = resultText(true, Object.freeze({ id: 'bellfall_bell_gates', label: '종문 공명', complete: true, progress: 3, target: 3, rooms: [2, 3, 5], counterWindows: 2 }));
  expect(std).toContain('종문 공명 3/3 · 완료'); expect(std).not.toContain('반격 창');
});
