import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { BackflowValveView, valveState } from '../src/game/backflow-valve-view.js';

// rules lane 의 연결 없이, BUNDLE-07 PLAN 3.2 의 읽기 경로만 가진 가짜 route 로 뷰를 검사한다.
const DEEP = ROUTE_OBJECTIVES.eclipse_deep, STANDARD = ROUTE_OBJECTIVES.eclipse_standard;
const OPTS = { reduced: false }, STILL = { reduced: true };
const DT = 1 / 60;

function makeRoute(def: any = DEEP, over: any = {}) {
  const gates = def.gates.map((g: any, i: number) => ({
    room: { id: g.roomId, x: 10 + i * 30, z: -5 + i * 7, discovered: true }, ready: false, attuned: false,
  }));
  return { def, gates, progress: 0, hold: 0, ...over };
}
const v$ = (v: BackflowValveView) => v as any;
// 인스턴스 행렬의 열 길이(= 축별 스케일)와 이동을 읽는다.
const m4 = new THREE.Matrix4();
function readScale(mesh: THREE.InstancedMesh, i: number) {
  mesh.getMatrixAt(i, m4); const e = m4.elements;
  return { x: Math.hypot(e[0], e[1], e[2]), y: Math.hypot(e[4], e[5], e[6]), z: Math.hypot(e[8], e[9], e[10]) };
}
function readPos(mesh: THREE.InstancedMesh, i: number) { mesh.getMatrixAt(i, m4); return { x: m4.elements[12], y: m4.elements[13], z: m4.elements[14] }; }
const color = new THREE.Color();
const ringHex = (v: any, i: number) => { v.ring.getColorAt(i, color); return color.getHex(); };
const streamHex = (v: any, i: number) => { v.stream.getColorAt(i, color); return color.getHex(); };
const snapshot = (v: any) => [v.pillar, v.stream, v.ring].map(m => Array.from(m.instanceMatrix.array as Float32Array));

test('valveState 전이: hidden → waiting/next → holding → sealed', () => {
  const route: any = makeRoute();
  route.gates.forEach((g: any) => { g.room.discovered = false; });
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['hidden', 'hidden', 'hidden', 'hidden']);
  route.gates.forEach((g: any) => { g.room.discovered = true; });
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['next', 'waiting', 'waiting', 'waiting']);
  route.hold = .5;
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['holding', 'waiting', 'waiting', 'waiting']);
  // 봉인되면 progress 가 넘어가고 hold 는 초기화된다.
  route.gates[0].attuned = true; route.progress = 1; route.hold = 0;
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['sealed', 'next', 'waiting', 'waiting']);
  // 방 5(index 3)를 먼저 정리해 ready 여도 차례가 아니면 대기다(순서 대기).
  route.gates[3].ready = true;
  expect(valveState(route, 3)).toBe('waiting');
  // 미발견이어도 봉인보다 hidden 이 먼저다(방을 보지 못했으면 그리지 않는다).
  route.gates[0].room.discovered = false;
  expect(valveState(route, 0)).toBe('hidden');
  route.gates[0].room.discovered = true;
  route.gates.forEach((g: any) => { g.attuned = true; }); route.progress = 4;
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['sealed', 'sealed', 'sealed', 'sealed']);
});

test('count 는 gates 수, drawCalls 는 보이는 InstancedMesh 수(≤ 3)', () => {
  for (const [def, n] of [[STANDARD, 3], [DEEP, 4]] as const) {
    const scene = new THREE.Scene(), route: any = makeRoute(def), view = new BackflowValveView(scene, route);
    expect(view.count).toBe(n);
    expect(v$(view).pillar.count).toBe(n);
    // 모두 미발견이면 그릴 것이 없다.
    route.gates.forEach((g: any) => { g.room.discovered = false; });
    view.update(route, DT, OPTS); expect(view.drawCalls).toBe(0);
    route.gates[0].room.discovered = true; view.update(route, DT, OPTS); expect(view.drawCalls).toBe(3);
    route.gates.forEach((g: any) => { g.room.discovered = true; g.attuned = true; }); route.progress = n; view.update(route, DT, OPTS);
    // 모두 봉인: 물줄기는 멈춰 안 보이고 기둥·고리 2 개만 남는다.
    expect(v$(view).stream.visible).toBe(false); expect(view.drawCalls).toBe(2);
    let instanced = 0; scene.traverse(o => { if ((o as any).isInstancedMesh) instanced++; });
    expect(instanced).toBe(3);
    view.dispose();
  }
});

test('hidden 은 세 인스턴스 모두 scale 0, sealed 는 물줄기 scale 0 · 기둥과 고리는 보인다', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  route.gates[1].room.discovered = false;
  route.gates[0].attuned = true; route.progress = 1;
  view.update(route, DT, OPTS);
  for (const mesh of [v.pillar, v.stream, v.ring]) expect(readScale(mesh, 1)).toEqual({ x: 0, y: 0, z: 0 });
  // 방 1 이 미발견이라 진행 중이어도 hidden 으로 남는다.
  expect(valveState(route, 1)).toBe('hidden');
  expect(readScale(v.stream, 0)).toEqual({ x: 0, y: 0, z: 0 });
  expect(readScale(v.pillar, 0).y).toBeCloseTo(1, 5); expect(readScale(v.ring, 0).y).toBeCloseTo(1, 5);
  view.dispose();
});

test('배치: 기둥·물줄기는 방 중심 +x (radius + .8), 고리는 방 중심, 고리 바깥 반지름 = def.radius', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  route.gates.forEach((g: any, i: number) => {
    expect(readPos(v.pillar, i).x).toBeCloseTo(g.room.x + DEEP.radius + .8, 4); expect(readPos(v.pillar, i).z).toBeCloseTo(g.room.z, 4);
    expect(readPos(v.stream, i).x).toBeCloseTo(g.room.x + DEEP.radius + .8, 4);
    expect(readPos(v.ring, i).x).toBeCloseTo(g.room.x, 4); expect(readPos(v.ring, i).z).toBeCloseTo(g.room.z, 4);
  });
  const p = v.ring.geometry.getAttribute('position'); let max = 0;
  for (let k = 0; k < p.count; k++) { expect(Math.abs(p.getY(k))).toBeLessThan(1e-6); max = Math.max(max, Math.hypot(p.getX(k), p.getZ(k))); }
  expect(max).toBeCloseTo(DEEP.radius, 5);
  // 바닥 표식 층(10 이상 11 미만), 투명 물체는 depthWrite 를 쓰지 않는다.
  for (const mesh of [v.stream, v.ring]) {
    expect(mesh.renderOrder).toBeGreaterThanOrEqual(10); expect(mesh.renderOrder).toBeLessThan(11);
    expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false);
  }
  expect(v.stream.material.color.getHex()).toBe(0xffffff);
  view.dispose();
});

test('물줄기 높이: next 1, waiting .5, holding 은 1 − hold/holdSeconds(최소 .15)', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  const full = readScale(v.stream, 0).y;
  expect(full).toBeGreaterThan(0);
  expect(readScale(v.stream, 1).y / full).toBeCloseTo(.5, 5);
  const hs = DEEP.holdSeconds;
  for (const hold of [.2, .5, 1, 1.5]) {
    route.hold = hold; view.update(route, DT, STILL);
    expect(valveState(route, 0)).toBe('holding');
    expect(readScale(v.stream, 0).y / full).toBeCloseTo(Math.max(.15, 1 - hold / hs), 5);
  }
  // 거의 다 유지하면 최소 높이에서 멈춘다(사라지지 않는다).
  route.hold = hs - .01; view.update(route, DT, STILL);
  expect(readScale(v.stream, 0).y / full).toBeCloseTo(.15, 5);
  // 단조 감소.
  let last = Infinity;
  for (let hold = .05; hold < hs; hold += .05) { route.hold = hold; view.update(route, DT, STILL); const y = readScale(v.stream, 0).y; expect(y).toBeLessThanOrEqual(last + 1e-6); last = y; }
  // 유지가 풀리면 전체 높이로 돌아간다.
  route.hold = 0; view.update(route, DT, STILL); expect(readScale(v.stream, 0).y / full).toBeCloseTo(1, 5);
  // 봉인되면 0.
  route.gates[0].attuned = true; route.progress = 1; view.update(route, DT, STILL); expect(readScale(v.stream, 0).y).toBe(0);
  view.dispose();
});

test('고리 색: sealed 금색, waiting 회색, holding 청록(def.cueColor), next 는 더 밝은 청록', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  expect(ringHex(v, 0)).not.toBe(DEEP.cueColor);          // next: 밝은 청록
  const next = new THREE.Color(ringHex(v, 0));
  for (const i of [1, 2, 3]) expect(ringHex(v, i)).toBe(0x8394ac);
  route.hold = 1; view.update(route, DT, STILL);
  expect(ringHex(v, 0)).toBe(DEEP.cueColor);
  const holding = new THREE.Color(ringHex(v, 0));
  expect(next.r + next.g + next.b).toBeGreaterThan(holding.r + holding.g + holding.b);
  route.gates[0].attuned = true; route.progress = 1; route.hold = 0; view.update(route, DT, STILL);
  expect(ringHex(v, 0)).toBe(0xffd060);
  expect(ringHex(v, 1)).not.toBe(0x8394ac);               // 이제 1번이 차례
  expect(ringHex(v, 2)).toBe(0x8394ac);
  // 봉인 상태가 유지되는 동안 색이 바뀌지 않는다.
  for (let k = 0; k < 30; k++) view.update(route, DT, OPTS);
  expect(ringHex(v, 0)).toBe(0xffd060);
  expect(streamHex(v, 1)).not.toBe(0xffd060);
  view.dispose();
});

test('reduced 면 같은 상태에서 dt 를 흘려도 행렬이 변하지 않고, 아니면 물줄기 폭이 맥동한다', () => {
  const route: any = makeRoute();
  const still = new BackflowValveView(new THREE.Scene(), route);
  still.update(route, DT, STILL); const base = snapshot(still);
  for (let k = 0; k < 120; k++) still.update(route, DT, STILL);
  expect(snapshot(still)).toEqual(base);
  const live = new BackflowValveView(new THREE.Scene(), route), l = v$(live), widths = new Set<number>();
  for (let k = 0; k < 60; k++) {
    live.update(route, DT, OPTS); const s = readScale(l.stream, 0); widths.add(Math.round(s.x * 1e4)); expect(s.x).toBeGreaterThan(.9); expect(s.x).toBeLessThan(1.1);
    expect(s.x).toBeCloseTo(s.z, 5); expect(s.y).toBeCloseTo(readScale(l.stream, 0).y, 5);
  }
  expect(widths.size).toBeGreaterThan(5);
  // 맥동은 높이와 무관하다(next 전체 높이는 유지).
  const full = readScale(l.stream, 0).y; live.update(route, DT, OPTS); expect(readScale(l.stream, 0).y).toBeCloseTo(full, 5);
  // 맥동 중 reduced 로 바뀌면 폭이 1 로 돌아와 정지한다.
  live.update(route, DT, STILL); const frozen = snapshot(live);
  for (let k = 0; k < 30; k++) live.update(route, DT, STILL);
  expect(snapshot(live)).toEqual(frozen); expect(readScale(l.stream, 0).x).toBeCloseTo(1, 5);
  // 맥동은 게임 dt 에만 의존한다(같은 dt 열 → 같은 결과).
  const a = new BackflowValveView(new THREE.Scene(), makeRoute()), b = new BackflowValveView(new THREE.Scene(), makeRoute());
  for (let k = 0; k < 50; k++) { a.update(route, DT, OPTS); b.update(route, DT, OPTS); }
  expect(snapshot(a)).toEqual(snapshot(b));
  // dt 가 0·NaN·음수면 시계가 움직이지 않는다.
  const before = snapshot(a); a.update(route, 0, OPTS); a.update(route, NaN, OPTS); a.update(route, -1, OPTS); expect(snapshot(a)).toEqual(before);
  for (const x of [still, live, a, b]) x.dispose();
});

test('update 는 새 객체를 만들지 않고 행렬·색 버퍼와 메시 참조를 유지하며 안 바뀐 인스턴스는 needsUpdate 를 올리지 않는다', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  const refs = [v.pillar, v.stream, v.ring, v.pillar.instanceMatrix, v.stream.instanceMatrix, v.ring.instanceMatrix,
    v.pillar.instanceMatrix.array, v.stream.instanceMatrix.array, v.ring.instanceMatrix.array,
    v.ring.instanceColor, v.stream.instanceColor, v.ring.instanceColor.array, v.stream.instanceColor.array,
    v.pillar.geometry, v.stream.geometry, v.ring.geometry, v.pillarMat, v.streamMat, v.ringMat];
  const children = scene.children.length, group = v.group.children.length;
  for (let k = 0; k < 400; k++) {
    route.progress = k % 5 === 4 ? 4 : (k >> 2) % 4; route.hold = k % 3 === 0 ? (k % 20) / 10 : 0;
    route.gates.forEach((g: any, i: number) => { g.attuned = i < route.progress; g.room.discovered = (k + i) % 9 !== 0; });
    view.update(route, DT, k % 7 === 0 ? STILL : OPTS);
    expect(v.group.children.length).toBe(group); expect(scene.children.length).toBe(children);
    expect(view.drawCalls).toBeLessThanOrEqual(3);
  }
  const after = [v.pillar, v.stream, v.ring, v.pillar.instanceMatrix, v.stream.instanceMatrix, v.ring.instanceMatrix,
    v.pillar.instanceMatrix.array, v.stream.instanceMatrix.array, v.ring.instanceMatrix.array,
    v.ring.instanceColor, v.stream.instanceColor, v.ring.instanceColor.array, v.stream.instanceColor.array,
    v.pillar.geometry, v.stream.geometry, v.ring.geometry, v.pillarMat, v.streamMat, v.ringMat];
  expect(after.every((o, i) => o === refs[i])).toBe(true);
  // reduced 로 상태가 안정되면 needsUpdate 가 올라가지 않는다.
  route.progress = 1; route.hold = 0; route.gates.forEach((g: any, i: number) => { g.attuned = i < 1; g.room.discovered = true; });
  view.update(route, DT, STILL);
  const versions = () => [v.pillar.instanceMatrix.version, v.stream.instanceMatrix.version, v.ring.instanceMatrix.version, v.ring.instanceColor.version, v.stream.instanceColor.version];
  const before = versions();
  for (let k = 0; k < 20; k++) view.update(route, DT, STILL);
  expect(versions()).toEqual(before);
  // 상태가 바뀐 프레임에는 올라간다.
  route.hold = .5; view.update(route, DT, STILL);
  expect(v.stream.instanceMatrix.version).toBeGreaterThan(before[1]);
  view.dispose();
});

test('dispose 는 반복 안전하며 scene 에서 제거하고 geometry·material·InstancedMesh 를 해제한다', () => {
  const scene = new THREE.Scene(), route: any = makeRoute(), view = new BackflowValveView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  expect(scene.children.length).toBe(1);
  const disposed = { geometry: 0, material: 0, mesh: 0 };
  for (const g of v.geometries) g.addEventListener('dispose', () => disposed.geometry++);
  for (const m of v.materials) m.addEventListener('dispose', () => disposed.material++);
  for (const m of [v.pillar, v.stream, v.ring]) m.addEventListener('dispose', () => disposed.mesh++);
  view.dispose(); view.dispose();
  expect(scene.children.length).toBe(0);
  expect(disposed).toEqual({ geometry: 3, material: 3, mesh: 3 });
  // 해제 뒤 update 는 아무것도 하지 않는다.
  expect(() => view.update(route, DT, OPTS)).not.toThrow();
  expect(view.count).toBe(0); expect(view.drawCalls).toBe(0);
});
