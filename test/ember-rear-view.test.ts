import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { EmberRearView } from '../src/game/ember-rear-view.js';

// 규칙 코어(EmberRearExposure)는 쓰지 않는다. PLAN 3절의 읽기 계약을 흉내 낸 가짜 rear 로 뷰만 검증한다.
const DEF = ROUTE_OBJECTIVES.ember_deep.rear;
const OPTS = { reduced: false }, REDUCED = { reduced: true };

function makeRear(over: any = {}) {
  const boss: any = { pos: new Vector3(4, 0, -6), yaw: 0, alive: true, def: { scale: 2.2 } };
  return { def: DEF, state: 'exposed', windowLeft: DEF.window, windowTotal: DEF.window, boss, lastSide: '', lastSideT: Infinity, ...over };
}
const view$ = (v: EmberRearView) => v as any;
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes };
}
const drawn = (scene: THREE.Object3D) => { let n = 0; scene.traverse((o: any) => { if (o.isMesh && o.visible) n++; }); return n; };
/** 메시의 월드 정점(보스 기준 상대 x, z 와 y)을 돌려준다. */
function worldVertices(mesh: THREE.Mesh, boss: any) {
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position'), out: { x: number, y: number, z: number, r: number, dot: number }[] = [];
  const fx = Math.sin(boss.yaw), fz = Math.cos(boss.yaw);
  for (let i = 0; i < position.count; i++) {
    const v = new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    const x = v.x - boss.pos.x, z = v.z - boss.pos.z, r = Math.hypot(x, z);
    out.push({ x, y: v.y, z, r, dot: r > 0 ? (x * fx + z * fz) / r : 0 });
  }
  return out;
}

test('exposed 에서만 부채꼴과 정면 호가 보이고 이름·색·draw call 이 계약대로다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear({ state: 'idle' }), view = new EmberRearView(scene, rear), v = view$(view);
  expect(v.wedge.name).toBe('TLL_EmberRearWedge'); expect(v.guard.name).toBe('TLL_EmberRearGuard');
  expect(v.wedgeMat.color.getHex()).toBe(0x5ff0d0); expect(v.guardMat.color.getHex()).toBe(0xd8a070);
  for (const state of ['idle', 'armored', 'ended']) { rear.state = state; view.update(rear, 1 / 60, OPTS); expect([v.wedge.visible, v.guard.visible]).toEqual([false, false]); }
  rear.state = 'exposed'; view.update(rear, 1 / 60, OPTS);
  expect([v.wedge.visible, v.guard.visible]).toEqual([true, true]); expect(drawn(scene)).toBe(2);
  expect(census(scene).meshes).toBe(2);
  rear.state = 'armored'; view.update(rear, 1 / 60, OPTS); expect(drawn(scene)).toBe(0);
  view.dispose();
});

test('보스가 없거나 죽었으면 exposed 여도 숨긴다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  view.update(rear, 1 / 60, OPTS); expect(v.wedge.visible).toBe(true);
  rear.boss.alive = false; view.update(rear, 1 / 60, OPTS); expect([v.wedge.visible, v.guard.visible]).toEqual([false, false]);
  rear.boss.alive = true; view.update(rear, 1 / 60, OPTS); expect(v.wedge.visible).toBe(true);
  const boss = rear.boss; rear.boss = null; view.update(rear, 1 / 60, OPTS); expect([v.wedge.visible, v.guard.visible]).toEqual([false, false]);
  rear.boss = boss; expect(() => view.update(null, 1 / 60, OPTS)).not.toThrow(); expect(drawn(scene)).toBe(0);
  view.dispose();
});

test('방향 부호: 정면이 +z(yaw 0)이면 부채꼴 중심은 -z, 갑주 호 중심은 +z 다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  rear.boss.yaw = 0; view.update(rear, 1 / 60, REDUCED);
  const wedge = worldVertices(v.wedge, rear.boss), guard = worldVertices(v.guard, rear.boss);
  const mean = (list: any[], key: 'x' | 'z') => list.reduce((s, p) => s + p[key], 0) / list.length;
  expect(mean(wedge, 'z')).toBeLessThan(-1); expect(Math.abs(mean(wedge, 'x'))).toBeLessThan(1e-4);
  expect(mean(guard, 'z')).toBeGreaterThan(1); expect(Math.abs(mean(guard, 'x'))).toBeLessThan(1e-4);
  view.dispose();
});

test('방향 부호: 어떤 yaw 에서도 부채꼴 정점은 정면 내적 -rearDot 이하, 갑주 호는 frontDot 이상이다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1.1, -2.4]) {
    rear.boss.yaw = yaw; view.update(rear, 1 / 60, REDUCED);
    for (const p of worldVertices(v.wedge, rear.boss)) expect(p.dot).toBeLessThanOrEqual(-DEF.rearDot + 1e-4);
    for (const p of worldVertices(v.guard, rear.boss)) expect(p.dot).toBeGreaterThanOrEqual(DEF.frontDot - 1e-4);
  }
  // 정면이 +x(yaw π/2)이면 부채꼴은 -x 쪽이다.
  rear.boss.yaw = Math.PI / 2; view.update(rear, 1 / 60, REDUCED);
  const wedge = worldVertices(v.wedge, rear.boss);
  expect(wedge.reduce((s, p) => s + p.x, 0) / wedge.length).toBeLessThan(-1);
  view.dispose();
});

test('반각은 acos(rearDot)·acos(frontDot), 반지름은 안쪽 0.7×scale·바깥 rangedReach, y 는 .08 이상이다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  view.update(rear, 1 / 60, REDUCED);
  const wedge = worldVertices(v.wedge, rear.boss), guard = worldVertices(v.guard, rear.boss);
  // 부채꼴: 중심(-정면)에서 가장 먼 정점의 각도는 rear 반각이고 그 정점의 정면 내적이 -rearDot 이다.
  expect(Math.min(...wedge.map(p => p.dot))).toBeCloseTo(-1, 4);
  expect(Math.max(...wedge.map(p => p.dot))).toBeCloseTo(-DEF.rearDot, 4);
  expect(Math.max(...guard.map(p => p.dot))).toBeCloseTo(1, 4);
  expect(Math.min(...guard.map(p => p.dot))).toBeCloseTo(DEF.frontDot, 4);
  expect(Math.min(...wedge.map(p => p.r))).toBeCloseTo(.7 * 2.2, 4); expect(Math.max(...wedge.map(p => p.r))).toBeCloseTo(DEF.rangedReach, 4);
  for (const p of [...wedge, ...guard]) expect(p.y).toBeGreaterThanOrEqual(.08);
  // 보스 크기가 바뀌면 같은 정점 배열의 안쪽 반지름이 따라간다.
  const array = v.wedge.geometry.getAttribute('position').array;
  rear.boss.def.scale = 3; view.update(rear, 1 / 60, REDUCED);
  expect(v.wedge.geometry.getAttribute('position').array).toBe(array);
  expect(Math.min(...worldVertices(v.wedge, rear.boss).map(p => p.r))).toBeCloseTo(2.1, 4);
  view.dispose();
});

test('뷰는 보스 위치와 yaw 를 따라간다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  rear.boss.pos.set(-3, 0, 8); rear.boss.yaw = 1.2; view.update(rear, 1 / 60, REDUCED);
  for (const mesh of [v.wedge, v.guard]) { expect([mesh.position.x, mesh.position.z]).toEqual([-3, 8]); expect(mesh.rotation.y).toBeCloseTo(1.2, 6); }
  view.dispose();
});

test('부채꼴 불투명도는 windowLeft/windowTotal 로 줄지만 0 이 되지 않는다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  const alphas: number[] = [];
  for (const left of [4, 3, 2, 1, .05, 0]) { rear.windowLeft = left; view.update(rear, 1 / 60, REDUCED); alphas.push(v.wedgeMat.opacity); }
  for (let i = 1; i < 5; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1]);
  expect(alphas[5]).toBeGreaterThan(.1); expect(alphas[0]).toBeLessThanOrEqual(1);
  rear.windowLeft = -3; view.update(rear, 1 / 60, REDUCED); expect(v.wedgeMat.opacity).toBeGreaterThan(.1);
  rear.windowLeft = 99; view.update(rear, 1 / 60, REDUCED); expect(v.wedgeMat.opacity).toBeCloseTo(alphas[0], 6);
  rear.windowTotal = 0; rear.windowLeft = 2; expect(() => view.update(rear, 1 / 60, REDUCED)).not.toThrow();
  view.dispose();
});

test('등 뒤 타격 직후 .25초 동안만 부채꼴이 밝아지고 정면·옆 타격은 영향이 없다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear({ windowLeft: 2 }), view = new EmberRearView(scene, rear), v = view$(view);
  view.update(rear, 1 / 60, REDUCED); const base = v.wedgeMat.opacity;
  rear.lastSide = 'rear'; rear.lastSideT = 0; view.update(rear, 1 / 60, REDUCED); const flash = v.wedgeMat.opacity;
  expect(flash).toBeGreaterThan(base + .1); expect(flash).toBeLessThanOrEqual(1);
  rear.lastSideT = .24; view.update(rear, 1 / 60, REDUCED); expect(v.wedgeMat.opacity).toBe(flash);
  rear.lastSideT = .25; view.update(rear, 1 / 60, REDUCED); expect(v.wedgeMat.opacity).toBe(base);
  for (const side of ['front', 'side', '']) { rear.lastSide = side; rear.lastSideT = 0; view.update(rear, 1 / 60, REDUCED); expect(v.wedgeMat.opacity).toBe(base); }
  // 창이 거의 끝나도 밝기는 1 을 넘지 않는다.
  rear.lastSide = 'rear'; rear.windowLeft = 4; rear.lastSideT = 0; view.update(rear, 1 / 60, OPTS); expect(v.wedgeMat.opacity).toBeLessThanOrEqual(1);
  view.dispose();
});

test('reduced 면 맥동이 없고 일반 모드에서는 시간에 따라 변한다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear({ windowLeft: 2 }), view = new EmberRearView(scene, rear), v = view$(view);
  view.update(rear, 1 / 60, REDUCED); const still = [v.wedgeMat.opacity, v.guardMat.opacity];
  for (let i = 0; i < 90; i++) { view.update(rear, 1 / 60, REDUCED); expect([v.wedgeMat.opacity, v.guardMat.opacity]).toEqual(still); }
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) { view.update(rear, 1 / 60, OPTS); seen.add(v.wedgeMat.opacity); }
  expect(seen.size).toBeGreaterThan(5);
  view.dispose();
});

test('재질은 투명·depthWrite false 이고 그리기 순서가 빌보드(11)보다 앞이다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  for (const mesh of [v.wedge, v.guard]) {
    expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBeGreaterThan(9); expect(mesh.renderOrder).toBeLessThan(11);
  }
  view.dispose();
});

test('update 는 새 객체를 만들지 않고 geometry·material·mesh 와 위치·정점 배열 참조를 유지한다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear), v = view$(view);
  const before = census(scene), children = scene.children.length;
  const pick = () => [v.wedge, v.guard, v.wedge.position, v.guard.position, v.wedge.rotation, v.guard.rotation, v.wedge.geometry, v.guard.geometry,
    v.wedgeMat, v.guardMat, v.wedge.geometry.getAttribute('position'), v.guard.geometry.getAttribute('position'),
    v.wedge.geometry.getAttribute('position').array, v.guard.geometry.getAttribute('position').array];
  const refs = pick();
  for (let i = 0; i < 300; i++) {
    rear.state = ['idle', 'armored', 'exposed', 'exposed', 'ended'][i % 5]; rear.windowLeft = (i % 41) / 10; rear.boss.pos.x = i * .1; rear.boss.yaw = i * .07;
    rear.boss.alive = i % 9 !== 0; rear.boss.def.scale = i % 50 === 0 ? 2 + (i % 3) : rear.boss.def.scale;
    rear.lastSide = i % 3 ? 'rear' : 'front'; rear.lastSideT = (i % 7) / 20;
    view.update(rear, 1 / 60, i % 11 === 0 ? REDUCED : OPTS);
    expect(census(scene)).toEqual(before); expect(scene.children.length).toBe(children);
  }
  expect(pick().every((o, i) => o === refs[i])).toBe(true);
  view.dispose();
});

test('dispose 는 scene 에서 제거하고 geometry·material 을 한 번씩 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const scene = new THREE.Scene(), rear: any = makeRear(), view = new EmberRearView(scene, rear);
  const items: any[] = [];
  scene.traverse((o: any) => { if (o.isMesh) items.push(o.geometry, o.material); });
  expect(scene.children).toHaveLength(1); expect(items).toHaveLength(4);
  const disposed = new Map<any, number>();
  for (const item of items) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  view.update(rear, 1 / 60, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()]).toEqual([1, 1, 1, 1]);
  expect(() => view.update(rear, 1 / 60, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0);
});
