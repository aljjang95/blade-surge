import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { EmberChainView, furnaceState } from '../src/game/ember-chain-view.js';

// rules lane 의 연결 없이, BUNDLE-08 PLAN 3.2 의 읽기 경로만 가진 가짜 route 로 뷰를 검사한다.
const DEF = ROUTE_OBJECTIVES.ashforge_deep;
const OPTS = { reduced: false }, STILL = { reduced: true };
const DT = 1 / 60;
const N = DEF.gates.length;

function makeRoute(over: any = {}) {
  const gates = DEF.gates.map((g: any, i: number) => ({
    room: { id: g.roomId, x: 20 + i * 30, z: -5 + i * 9, discovered: true },
    pos: new THREE.Vector3(20 + i * 30, 0, -5 + i * 9), ready: false, attuned: false,
  }));
  // 기본은 조작판이 닫힌 상태(충격파 대기). 테스트가 open 플래그로 연다.
  const route: any = { def: DEF, gates, progress: 0, open: false, padOpen(gate: any) { return route.open && gate.ready; }, ...over };
  return route;
}
const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
// 첫 열(폭 방향 축)의 길이. 사슬은 길이 축만 따로 늘어나므로 폭 배율로 보이는 정도를 읽는다.
function readScale(mesh: THREE.InstancedMesh, i: number) {
  mesh.getMatrixAt(i, m4); const e = m4.elements;
  return Math.hypot(e[0], e[1], e[2]);
}
function readPos(mesh: THREE.InstancedMesh, i: number, y = 0, x = 0, z = 0) {
  mesh.getMatrixAt(i, m4); return v3.set(x, y, z).applyMatrix4(m4).clone();
}
const color = new THREE.Color();
const hexOf = (mesh: THREE.InstancedMesh, i: number) => { mesh.getColorAt(i, color); return color.getHex(); };
const v$ = (v: EmberChainView) => v as any;
const chainsOf = (i: number) => [0, 1, 2, 3].map(k => i * 4 + k);
const embersOf = (i: number) => [0, 1, 2, 3, 4, 5].map(k => i * 6 + k);
const step = (view: EmberChainView, route: any, seconds: number, opts = OPTS) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) view.update(route, DT, opts);
};
const snapshot = (v: any) => [v.chain, v.ember].map(m => Array.from(m.instanceMatrix.array as Float32Array));

test('furnaceState 전이: hidden → bound → shock → open → releasing → released', () => {
  const route = makeRoute();
  route.gates.forEach((g: any) => { g.room.discovered = false; });
  expect([0, 1, 2, 3].map(i => furnaceState(route, i, 0))).toEqual(['hidden', 'hidden', 'hidden', 'hidden']);
  route.gates.forEach((g: any) => { g.room.discovered = true; });
  // 정리 중(ready 아님)이면 차례여도 bound 이다.
  expect([0, 1, 2, 3].map(i => furnaceState(route, i, 0))).toEqual(['bound', 'bound', 'bound', 'bound']);
  route.gates[0].ready = true;
  expect(furnaceState(route, 0, 0)).toBe('shock');
  route.open = true;
  expect(furnaceState(route, 0, 0)).toBe('open');
  // 차례가 아닌 심장로는 준비·개방 여부와 관계없이 bound 이다.
  route.gates[2].ready = true;
  expect(furnaceState(route, 2, 0)).toBe('bound');
  // 냉각되면 releaseSeconds(1.6) 전까지 releasing, 그 뒤 released.
  route.gates[0].attuned = true; route.progress = 1;
  expect(furnaceState(route, 0, 0)).toBe('releasing');
  expect(furnaceState(route, 0, DEF.releaseSeconds - .01)).toBe('releasing');
  expect(furnaceState(route, 0, DEF.releaseSeconds)).toBe('released');
  // 미발견이면 냉각 여부보다 hidden 이 먼저다.
  route.gates[0].room.discovered = false;
  expect(furnaceState(route, 0, 0)).toBe('hidden');
});

test('furnaceState: padOpen 이 함수가 아니면 차례 심장로는 열림이다', () => {
  const route = makeRoute(); delete route.padOpen;
  expect(furnaceState(route, 0, 0)).toBe('open');
  expect(furnaceState(route, 1, 0)).toBe('bound');
  route.padOpen = 'nope';
  expect(furnaceState(route, 0, 0)).toBe('open');
});

test('count 40 · drawCalls ≤ 2 · 장면의 InstancedMesh 는 2개', () => {
  const scene = new THREE.Scene(), route = makeRoute();
  route.gates.forEach((g: any) => { g.room.discovered = false; });
  const view = new EmberChainView(scene, route);
  expect(view.count).toBe(N * 10); expect(view.count).toBe(40);
  expect(v$(view).chain.count).toBe(16); expect(v$(view).ember.count).toBe(24);
  expect(view.group.name).toBe('TLL_EmberChains');
  let instanced = 0; scene.traverse(o => { if ((o as any).isInstancedMesh) instanced++; });
  expect(instanced).toBe(2);
  // 첫 update 전에는 출격 준비 컴파일을 위해 둘 다 보이지만 그릴 인스턴스는 없다.
  expect(v$(view).chain.visible).toBe(true); expect(v$(view).ember.visible).toBe(true);
  expect(view.drawCalls).toBe(0);
  view.update(route, DT, OPTS); expect(view.drawCalls).toBe(0);
  route.gates[1].room.discovered = true; view.update(route, DT, OPTS); expect(view.drawCalls).toBe(2);
  route.gates.forEach((g: any) => { g.room.discovered = true; }); view.update(route, DT, OPTS);
  expect(view.drawCalls).toBeLessThanOrEqual(2);
  view.dispose();
});

test('hidden 은 scale 0, 보이는 상태의 사슬은 발이 모서리, 끝이 장치 위에 선다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  route.gates[2].room.discovered = false;
  view.update(route, DT, OPTS);
  expect(view.states).toEqual(['bound', 'bound', 'hidden', 'bound']);
  for (const i of chainsOf(2)) expect(readScale(v.chain, i)).toBe(0);
  for (const i of embersOf(2)) expect(readScale(v.ember, i)).toBe(0);
  // 보이는 심장로: 사슬 4가닥이 장치 위치 기준 (±1.6, ±1.6) 바닥에서 시작해 높이 2.2 로 올라간다.
  const pos = route.gates[1].pos, feet = new Set<string>();
  for (const i of chainsOf(1)) {
    expect(readScale(v.chain, i)).toBeGreaterThan(0);
    const foot = readPos(v.chain, i, 0), top = readPos(v.chain, i, 1);
    expect(foot.y).toBeCloseTo(0, 5); expect(top.y).toBeCloseTo(2.2, 3);
    expect(Math.abs(foot.x - pos.x)).toBeCloseTo(1.6, 5); expect(Math.abs(foot.z - pos.z)).toBeCloseTo(1.6, 5);
    // 끝은 장치 쪽(중심에 더 가까이)으로 모인다.
    expect(Math.hypot(top.x - pos.x, top.z - pos.z)).toBeLessThan(Math.hypot(foot.x - pos.x, foot.z - pos.z));
    feet.add(Math.sign(foot.x - pos.x) + ',' + Math.sign(foot.z - pos.z));
  }
  expect(feet.size).toBe(4);
  // 불씨는 장치 아래쪽에 모여 조작판(|dx| ≥ 1.9)과 겹치지 않는다.
  for (const i of embersOf(1)) {
    const p = readPos(v.ember, i);
    expect(readScale(v.ember, i)).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(1.5); expect(Math.hypot(p.x - pos.x, p.z - pos.z)).toBeLessThan(1.5);
  }
  view.dispose();
});

test('색: bound · shock · open 에서 사슬과 불씨 색이 달라진다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  for (const i of chainsOf(0)) expect(hexOf(v.chain, i)).toBe(0x5a5048);
  for (const i of embersOf(0)) expect(hexOf(v.ember, i)).toBe(0xa04018);
  route.gates[0].ready = true; view.update(route, DT, OPTS);
  expect(view.states[0]).toBe('shock');
  for (const i of chainsOf(0)) expect(hexOf(v.chain, i)).toBe(0xc0452a);
  for (const i of embersOf(0)) expect(hexOf(v.ember, i)).toBe(0xff8030);
  route.open = true; view.update(route, DT, OPTS);
  expect(view.states[0]).toBe('open');
  for (const i of chainsOf(0)) expect(hexOf(v.chain, i)).toBe(0xffb060);
  for (const i of embersOf(0)) expect(hexOf(v.ember, i)).toBe(0xffd080);
  // 차례가 아닌 심장로 색은 영향을 받지 않는다.
  for (const i of chainsOf(1)) expect(hexOf(v.chain, i)).toBe(0x5a5048);
  // 충격파가 다시 오면 닫힘(shock)으로 돌아간다.
  route.open = false; view.update(route, DT, OPTS);
  expect(view.states[0]).toBe('shock');
  view.dispose();
});

test('해방: 사슬은 0.6초 안에 떨어지며 사라지고 불씨는 떠오르며 사라진 뒤 released', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  route.gates[0].ready = true; route.open = true; view.update(route, DT, OPTS);
  const topBefore = readPos(v.chain, 0, 1).y, emberY0 = embersOf(0).map(i => readPos(v.ember, i).y);
  route.gates[0].attuned = true; route.progress = 1;
  view.update(route, DT, OPTS);
  expect(view.states[0]).toBe('releasing');
  // 첫 해방 프레임에는 사슬이 거의 그대로이고, 색은 철색으로 돌아간다.
  expect(readScale(v.chain, 0)).toBeGreaterThan(.95);
  expect(hexOf(v.chain, 0)).toBe(0x5a5048);
  step(view, route, .3);
  const midScale = readScale(v.chain, 0);
  expect(midScale).toBeGreaterThan(0); expect(midScale).toBeLessThan(.8);
  expect(readPos(v.chain, 0, 1).y).toBeLessThan(topBefore - .5);       // 아래로 떨어진다
  const emberMid = embersOf(0).map(i => readPos(v.ember, i).y);
  emberMid.forEach((y, k) => expect(y).toBeGreaterThan(emberY0[k] + .4)); // 불씨는 위로 뜬다
  step(view, route, .35);
  for (const i of chainsOf(0)) expect(readScale(v.chain, i)).toBe(0);
  expect(view.states[0]).toBe('releasing');
  for (const i of embersOf(0)) expect(readScale(v.ember, i)).toBeGreaterThan(0);
  // 끝으로 갈수록 불씨가 높이 뜨고 작아진다.
  const emberLate = embersOf(0).map(i => readPos(v.ember, i).y);
  emberLate.forEach((y, k) => expect(y).toBeGreaterThan(emberMid[k]));
  step(view, route, DEF.releaseSeconds + .1);
  expect(view.states[0]).toBe('released');
  for (const i of [...chainsOf(0)]) expect(readScale(v.chain, i)).toBe(0);
  for (const i of embersOf(0)) expect(readScale(v.ember, i)).toBe(0);
  // 다른 심장로는 그대로 보인다.
  expect(readScale(v.chain, 4)).toBeGreaterThan(0);
  expect(view.drawCalls).toBe(2);
  view.dispose();
});

test('dt 0(syncView)은 해방 경과를 진행하지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  route.gates[0].attuned = true; route.progress = 1;
  for (let k = 0; k < 400; k++) view.update(route, 0, OPTS);
  expect(view.states[0]).toBe('releasing');
  expect(readScale(v.chain, 0)).toBeGreaterThan(.99);
  // 음수·NaN dt 도 진행하지 않는다.
  view.update(route, -1, OPTS); view.update(route, NaN, OPTS);
  expect(readScale(v.chain, 0)).toBeGreaterThan(.99);
  // 같은 사슬이 실제 게임 시간 .3초 뒤에야 절반으로 줄어든다.
  step(view, route, .3);
  expect(readScale(v.chain, 0)).toBeCloseTo(.5, 1);
  view.dispose();
});

test('reduced: 같은 상태에서 dt 를 흘려도 행렬이 변하지 않고, 해방 때 사슬은 즉시 사라진다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  route.gates[0].ready = true;
  view.update(route, DT, STILL);
  const before = snapshot(v), versions = [v.chain.instanceMatrix.version, v.ember.instanceMatrix.version];
  step(view, route, 2, STILL);
  expect(snapshot(v)).toEqual(before);
  // 바뀐 것이 없으면 업로드 플래그도 올리지 않는다.
  expect([v.chain.instanceMatrix.version, v.ember.instanceMatrix.version]).toEqual(versions);
  // 같은 조건에서 reduced 가 아니면 불씨가 흔들린다(위 검사가 의미 있는지 확인).
  step(view, route, .5, OPTS);
  expect(snapshot(v)[1]).not.toEqual(before[1]);
  // 해방: 사슬은 첫 프레임에 scale 0, 불씨는 제자리에서 줄어든다.
  const still = makeRoute(), view2 = new EmberChainView(scene, still), v2 = v$(view2);
  view2.update(still, DT, STILL);
  const emberPos = embersOf(0).map(i => readPos(v2.ember, i));
  still.gates[0].attuned = true; still.progress = 1;
  view2.update(still, DT, STILL);
  expect(view2.states[0]).toBe('releasing');
  for (const i of chainsOf(0)) expect(readScale(v2.chain, i)).toBe(0);
  const s1 = readScale(v2.ember, 0);
  step(view2, still, .8, STILL);
  const s2 = readScale(v2.ember, 0);
  expect(s2).toBeGreaterThan(0); expect(s2).toBeLessThan(s1);
  embersOf(0).forEach((i, k) => {
    const p = readPos(v2.ember, i);
    expect(p.x).toBeCloseTo(emberPos[k].x, 6); expect(p.y).toBeCloseTo(emberPos[k].y, 6); expect(p.z).toBeCloseTo(emberPos[k].z, 6);
  });
  step(view2, still, DEF.releaseSeconds, STILL);
  expect(view2.states[0]).toBe('released');
  for (const i of embersOf(0)) expect(readScale(v2.ember, i)).toBe(0);
  view.dispose(); view2.dispose();
});

test('update 는 새 배열·행렬 버퍼를 만들지 않고 값만 바꾼다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route), v = v$(view);
  const refs = [view.states, v.chain.instanceMatrix.array, v.ember.instanceMatrix.array, v.chain.instanceColor, v.ember.instanceColor, v.chain.instanceMatrix, v.group.children.length];
  view.update(route, DT, OPTS);
  route.gates[0].ready = true; route.open = true; step(view, route, .5);
  route.gates[0].attuned = true; route.progress = 1; step(view, route, 2);
  route.gates.forEach((g: any) => { g.room.discovered = false; }); view.update(route, DT, STILL);
  const after = [view.states, v.chain.instanceMatrix.array, v.ember.instanceMatrix.array, v.chain.instanceColor, v.ember.instanceColor, v.chain.instanceMatrix, v.group.children.length];
  refs.forEach((r, k) => expect(after[k]).toBe(r));
  expect(view.states.length).toBe(N);
  view.dispose();
});

test('dispose 는 반복 호출해도 안전하고 scene 에서 제거한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new EmberChainView(scene, route);
  view.update(route, DT, OPTS);
  expect(scene.children).toContain(view.group);
  view.dispose(); view.dispose();
  expect(scene.children).not.toContain(view.group);
  expect(view.count).toBe(0); expect(view.drawCalls).toBe(0);
  expect(() => view.update(route, DT, OPTS)).not.toThrow();
});
