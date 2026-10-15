import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { BellfallDeepBellView } from '../src/game/bellfall-deep-bell-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult } from '../src/expansion/hub.jsx';

// rules lane 의 컨트롤러(src/game/bellfall-deep-bells.js)는 쓰지 않는다. BUNDLE-04 PLAN 3.1 의 읽기 API 를 흉내 낸 가짜 route 로 뷰·패널·결과를 검증한다.
const DEF = ROUTE_OBJECTIVES.bellfall_deep;
const GOLD = 0xffd060, DARK = 0x1c2a5c, TEAL = 0x88dfc3, VIOLET = 0xb06cff, LOCKED = 0x5f6f80;

function realWorld() {
  const stage = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
  return buildExpeditionWorld(stage);
}
function makeRoute(world: any = realWorld()) {
  const gates = DEF.gates.map((spec: any, index: number) => {
    const room = world.rooms.find((r: any) => r.id === spec.roomId);
    room.discovered = true;
    return { room, label: spec.label, index, number: index + 1, phase: 'locked', prepared: false, expected: 0, spawned: 0, purgePending: false,
      center: new Vector3(room.x, 0, room.z) };
  });
  const route: any = { def: DEF, world, gates, closed: false, phase: 'wake', hold: 0, holdGate: null, tollIndex: 0, lastToll: null, lastDiscord: null,
    discordT: Infinity, guide: null, discords: 0, progress: 0,
    get lit() { return gates.filter((g: any) => g.phase !== 'locked').length; } };
  return route;
}
function setPhases(route: any, ...phases: string[]) { phases.forEach((p, i) => { route.gates[i].phase = p; }); }
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0, instances = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; instances += o.isInstancedMesh ? o.count : 1; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes, instances };
}
const view$ = (v: BellfallDeepBellView) => v as any;
const hexOf = (mesh: any, i: number) => { const c = new THREE.Color(); mesh.getColorAt(i, c); return c.getHex(); };
/** 인스턴스 i 의 크기(0 이면 숨김). */
const scaleOf = (mesh: any, i: number) => { const m = new THREE.Matrix4(), s = new THREE.Vector3(); mesh.getMatrixAt(i, m); s.setFromMatrixScale(m); return s.x; };
const OPTS = { reduced: false };

test('상태별로 링과 종의 인스턴스 색이 정해진다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  view.update(route, 1 / 60, OPTS);
  for (let i = 0; i < 3; i++) { expect(hexOf(v.ring, i)).toBe(LOCKED); expect(hexOf(v.bell, i)).toBe(LOCKED); }
  setPhases(route, 'lit', 'dark', 'resonated'); view.update(route, 1 / 60, OPTS);
  expect([0, 1, 2].map(i => hexOf(v.bell, i))).toEqual([GOLD, DARK, TEAL]);
  expect([0, 1, 2].map(i => hexOf(v.ring, i))).toEqual([GOLD, DARK, TEAL]);
  view.dispose();
});

test('draw call 은 3 이하이고 링·종은 3인스턴스 InstancedMesh 다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  setPhases(route, 'dark', 'dark', 'dark'); route.holdGate = route.gates[1]; route.hold = 1; view.update(route, 1 / 60, OPTS);
  expect(v.ring.isInstancedMesh && v.ring.count === 3).toBe(true); expect(v.bell.isInstancedMesh && v.bell.count === 3).toBe(true);
  let drawn = 0; scene.traverse((o: any) => { if (o.isMesh && o.visible) drawn++; });
  expect(drawn).toBeLessThanOrEqual(3);
  view.dispose();
});

test('링 바깥 반경은 판정 반경 def.radius 와 같다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  for (const geometry of [v.ring.geometry, v.arcGeometry] as THREE.BufferGeometry[]) geometry.computeBoundingBox();
  expect(v.ring.geometry.boundingBox.max.x).toBeCloseTo(DEF.radius, 5);
  expect(v.ring.geometry.boundingBox.max.z).toBeCloseTo(DEF.radius, 5);
  // 유지 호는 링 안쪽에 들어간다.
  expect(v.arcGeometry.boundingBox.max.x).toBeLessThan(DEF.radius);
  view.dispose();
});

test('유지 호는 holdGate 위치로 옮겨지고 hold 만큼 drawRange 가 늘어난다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  setPhases(route, 'resonated', 'dark', 'dark');
  view.update(route, 1 / 60, OPTS); expect(v.arc.visible).toBe(false);
  route.holdGate = route.gates[1]; route.hold = 0.001; view.update(route, 1 / 60, OPTS);
  expect(v.arc.visible).toBe(true); expect(v.arc.position.x).toBe(route.gates[1].center.x); expect(v.arc.position.z).toBe(route.gates[1].center.z);
  expect(v.arcGeometry.drawRange.count).toBe(6); // 시작하면 최소 한 칸
  route.hold = 1; view.update(route, 1 / 60, OPTS); const half = v.arcGeometry.drawRange.count;
  route.hold = 2; view.update(route, 1 / 60, OPTS); const full = v.arcGeometry.drawRange.count;
  expect(full).toBe(48 * 6); expect(half).toBe(24 * 6);
  route.holdGate = route.gates[2]; route.hold = .5; view.update(route, 1 / 60, OPTS);
  expect(v.arc.position.x).toBe(route.gates[2].center.x);
  route.holdGate = null; route.hold = 0; view.update(route, 1 / 60, OPTS); expect(v.arc.visible).toBe(false);
  view.dispose();
});

test('불협 직후 0.6초 동안만 마지막 불협 종문이 보라색이다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  setPhases(route, 'lit', 'lit', 'lit'); route.lastDiscord = route.gates[2]; route.discords = 1;
  for (const [t, purple] of [[0, true], [.3, true], [.5999, true], [.6, false], [1, false], [Infinity, false]] as const) {
    route.discordT = t; view.update(route, 1 / 60, OPTS);
    expect(hexOf(v.bell, 2)).toBe(purple ? VIOLET : GOLD); expect(hexOf(v.ring, 2)).toBe(purple ? VIOLET : GOLD);
    expect(hexOf(v.bell, 0)).toBe(GOLD); expect(hexOf(v.bell, 1)).toBe(GOLD);
  }
  view.dispose();
});

test('guide 종문의 링만 흰색으로 맥동하고 reduced 면 멈춘다. guide 가 없으면 정답을 색으로 드러내지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  setPhases(route, 'dark', 'dark', 'dark');
  view.update(route, 1 / 60, OPTS);
  // guide 없음: 세 종문의 색이 완전히 같다.
  expect(new Set([0, 1, 2].map(i => hexOf(v.ring, i))).size).toBe(1);
  route.guide = route.gates[0];
  const samples = new Set<number>();
  for (let i = 0; i < 60; i++) { view.update(route, 1 / 60, OPTS); samples.add(hexOf(v.ring, 0)); }
  expect(samples.size).toBeGreaterThan(5);
  expect(hexOf(v.ring, 1)).toBe(DARK); expect(hexOf(v.ring, 2)).toBe(DARK);
  const bright = hexOf(v.ring, 0); expect(new THREE.Color(bright).r).toBeGreaterThan(new THREE.Color(DARK).r);
  expect(hexOf(v.bell, 0)).toBe(DARK); // 종 본체는 정답을 가리키지 않는다
  // reduced: 시간이 흘러도 같은 색.
  view.update(route, 1 / 60, { reduced: true }); const still = hexOf(v.ring, 0);
  for (let i = 0; i < 90; i++) { view.update(route, 1 / 60, { reduced: true }); expect(hexOf(v.ring, 0)).toBe(still); }
  // guide 가 사라지면 링이 원래 색으로 돌아온다.
  route.guide = null; view.update(route, 1 / 60, OPTS); expect(hexOf(v.ring, 0)).toBe(DARK);
  view.dispose();
});

test('미발견 방은 숨기고 closed route 는 그룹 전체를 숨긴다. dt 0 갱신은 화면을 유지한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  setPhases(route, 'lit', 'lit', 'lit'); route.gates[1].room.discovered = false;
  view.update(route, 1 / 60, OPTS);
  expect([0, 1, 2].map(i => scaleOf(v.ring, i) > 0)).toEqual([true, false, true]);
  expect([0, 1, 2].map(i => scaleOf(v.bell, i) > 0)).toEqual([true, false, true]);
  view.update(route, 0, OPTS);
  expect([0, 1, 2].map(i => scaleOf(v.ring, i) > 0)).toEqual([true, false, true]);
  route.gates[1].room.discovered = true; view.update(route, 1 / 60, OPTS);
  expect(scaleOf(v.ring, 1)).toBeGreaterThan(0);
  for (const g of route.gates) g.room.discovered = false;
  view.update(route, 1 / 60, OPTS); expect(v.ring.visible).toBe(false); expect(v.bell.visible).toBe(false);
  for (const g of route.gates) g.room.discovered = true;
  route.closed = true; view.update(route, 1 / 60, OPTS); expect(v.group.visible).toBe(false);
  route.closed = false; view.update(route, 1 / 60, OPTS); expect(v.group.visible).toBe(true);
  view.dispose();
});

test('종은 소등·공명 직후 흔들리고 reduced 에서는 흔들리지 않는다', () => {
  for (const reduced of [false, true]) {
    const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
    setPhases(route, 'lit', 'lit', 'lit'); view.update(route, 1 / 60, { reduced });
    route.gates[0].phase = 'dark'; view.update(route, .1, { reduced });
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(); v.bell.getMatrixAt(0, m); q.setFromRotationMatrix(m);
    if (reduced) expect(Math.abs(q.z)).toBeLessThan(1e-9); else expect(Math.abs(q.z)).toBeGreaterThan(1e-3);
    for (let i = 0; i < 120; i++) view.update(route, 1 / 60, { reduced });
    v.bell.getMatrixAt(0, m); q.setFromRotationMatrix(m); expect(Math.abs(q.z)).toBeLessThan(1e-9);
    view.dispose();
  }
});

test('상태를 오가며 300회 갱신해도 geometry·material·mesh 수가 변하지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route);
  const before = census(scene);
  expect(before.meshes).toBe(3); expect(before.instances).toBe(7);
  const phases = ['locked', 'lit', 'dark', 'resonated'];
  for (let i = 0; i < 300; i++) {
    setPhases(route, phases[i % 4], phases[(i + 1) % 4], phases[(i + 2) % 4]);
    route.guide = i % 5 === 0 ? route.gates[i % 3] : null;
    route.lastDiscord = i % 7 === 0 ? route.gates[0] : null; route.discordT = (i % 20) / 20;
    route.holdGate = i % 3 === 0 ? route.gates[1] : null; route.hold = (i % 40) / 20;
    view.update(route, 1 / 60, i % 11 === 0 ? { reduced: true } : OPTS);
    expect(census(scene)).toEqual(before);
  }
  view.dispose();
});

test('바닥 링과 호는 지면 VFX 뒤 빌보드 앞에서 그려지고 깊이 검사는 유지한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route), v = view$(view);
  for (const mesh of [v.ring, v.arc]) {
    expect(mesh.renderOrder).toBeGreaterThanOrEqual(10); expect(mesh.renderOrder).toBeLessThan(11);
    expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthTest).toBe(true); expect(mesh.material.depthWrite).toBe(false);
  }
  view.dispose();
});

test('dispose 는 scene 자식을 비우고 모든 geometry·material 을 한 번 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new BellfallDeepBellView(scene, route);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse((o: any) => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  expect(scene.children).toHaveLength(1);
  const disposed = new Map<any, number>();
  for (const item of [...geometries, ...materials]) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  setPhases(route, 'dark', 'dark', 'dark'); view.update(route, 1 / 60, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()].every(n => n === 1)).toBe(true);
  expect(disposed.size).toBe(geometries.size + materials.size);
  expect(() => view.update(route, 1 / 60, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0);
});

// ---- 목표창 ----
const panel = (route: any) => battleObjectiveView({ world: route.world, routeObjectives: route });
function panelRoute() {
  const route = makeRoute(); route.world.sealed = true;
  for (const room of route.world.rooms) room.discovered = true;
  return route;
}

test('목표창: 점등 단계는 다음 구역 찾기와 적 처치를 구분하고 lit/3 을 보인다', () => {
  const route = panelRoute();
  expect(panel(route)).toMatchObject({ title: '종문 점등', action: '이 구역의 적을 처치해 종 깨우기', progress: 0, total: 3, roomId: route.gates[0].room.id });
  route.gates[0].phase = 'lit';
  expect(panel(route)).toMatchObject({ progress: 1, total: 3, roomId: route.gates[1].room.id });
  route.gates[1].room.discovered = false;
  expect(panel(route)).toMatchObject({ action: '다음 구역을 찾아 이동', progress: 1, roomId: null, hold: 0 });
});

test('목표창: 소등 단계는 방금 꺼진 종문 이름과 tollIndex/3 만 알려준다', () => {
  const route = panelRoute(); route.phase = 'toll'; setPhases(route, 'lit', 'lit', 'lit');
  expect(panel(route)).toMatchObject({ title: '소등 순서 기억', action: '종소리를 듣는 중', progress: 0, total: 3, roomId: null });
  route.gates[1].phase = 'dark'; route.tollIndex = 1; route.lastToll = route.gates[1];
  expect(panel(route)).toMatchObject({ action: '2번 종문 · 북동쪽 종탑 소등', progress: 1, total: 3, roomId: null });
});

test('목표창: 공명 단계는 guide 가 없으면 방 id 를 내지 않고 정답 종문 이름도 쓰지 않는다', () => {
  const route = panelRoute(); route.phase = 'answer'; setPhases(route, 'dark', 'dark', 'dark');
  const idle = panel(route);
  expect(idle).toMatchObject({ title: '종문 역순 공명', action: '마지막에 꺼진 종부터 중심 2초', progress: 0, total: 3, roomId: null, hold: 0, holdTotal: 0 });
  // 정답 방(DEF.tollOrder 의 마지막 = 첫 공명 방)과 어떤 종문 이름·방 번호도 패널 어디에도 없다.
  for (const gate of route.gates) { expect(JSON.stringify(idle)).not.toContain(gate.label); }
  expect(Object.values(idle).includes(DEF.tollOrder[DEF.tollOrder.length - 1])).toBe(false);
  // 유지 중이면 hold/holdTotal 만 채운다(roomId 는 계속 null).
  route.holdGate = route.gates[2]; route.hold = 1.27;
  expect(panel(route)).toMatchObject({ hold: 1.2, holdTotal: 2, roomId: null, progress: 0 });
  route.gates[0].phase = 'resonated'; route.progress = 1; route.holdGate = null; route.hold = 0;
  expect(panel(route)).toMatchObject({ progress: 1, hold: 0, holdTotal: 0, roomId: null });
});

test('목표창: guide 가 있으면 그 종문 이름과 방 id 를 알려주고, 미발견이면 roomId 를 숨긴다', () => {
  const route = panelRoute(); route.phase = 'answer'; setPhases(route, 'dark', 'dark', 'dark'); route.discords = 2;
  route.guide = route.gates[1];
  expect(panel(route)).toMatchObject({ action: '다음 2번 종문 · 북동쪽 종탑 · 중심 2초', roomId: route.gates[1].room.id, progress: 0, total: 3 });
  route.gates[1].room.discovered = false;
  expect(panel(route).roomId).toBeNull();
});

test('목표창: 완료(done) 뒤에는 종문 문구를 쓰지 않고 기존 봉인 규칙으로 돌아간다', () => {
  const route = panelRoute(); route.phase = 'done'; route.progress = 3; setPhases(route, 'resonated', 'resonated', 'resonated');
  expect(panel(route).title).toBe('보스 봉인 해제');
  route.closed = true; route.phase = 'answer';
  expect(panel(route).title).not.toBe('종문 역순 공명');
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
const flat = (node: any): any[] => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(flat)];
const textOf = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(textOf).join('');
function resultView(win: boolean, routeObjective: any) {
  const result: any = { win, kind: 'dungeon', id: 'bellfall_crypt', name: '종락 회랑', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  const view = expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0];
  return { view, nodes: flat(view), text: textOf(view) };
}
const report = (over: any) => Object.freeze({ id: 'bellfall_deep_bells', label: '종문 역순 공명', complete: false, progress: 2, target: 3, rooms: Object.freeze([2, 5]),
  discords: 3, tolls: 4, ...over });

test('결과 줄은 공명 수와 불협 횟수를 한 줄로 보이고 일반 label 줄과 중복되지 않는다', () => {
  const win = resultView(true, report({ complete: true, progress: 3, discords: 0, rooms: [2, 5, 3] }));
  expect(win.text).toContain('종문 역순 공명 3/3 · 불협 0회 · 완료');
  expect(win.text.split('종문 역순 공명').length - 1).toBe(1);
  const lines = win.nodes.filter(n => n.type === 'p' && n.props['aria-label']?.includes('종문 역순 공명'));
  expect(lines).toHaveLength(1); expect(lines[0].props['aria-label']).toBe('종문 역순 공명 결과');
});

test('패배한 결과에는 완료 표시가 없고 실제 진행만 남는다', () => {
  const lost = resultView(false, report({}));
  expect(lost.text).toContain('종문 역순 공명 2/3 · 불협 3회');
  expect(lost.text).not.toContain('불협 3회 · 완료');
  expect(resultView(true, report({ complete: false })).text).not.toContain('· 완료');
});

test('다른 원정의 결과 줄은 기존 형식을 유지한다', () => {
  const standard = resultView(true, Object.freeze({ id: 'bellfall_bell_gates', label: '종문 공명', complete: true, progress: 3, target: 3, rooms: [2, 3, 5] }));
  expect(standard.text).toContain('종문 공명 3/3 · 완료'); expect(standard.text).not.toContain('불협');
  expect(resultView(true, undefined).text).not.toContain('종문');
});
