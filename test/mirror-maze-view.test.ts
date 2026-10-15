import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { MirrorMazeView, mirrorState } from '../src/game/mirror-maze-view.js';

// rules lane 의 연결 없이, BUNDLE-09 PLAN 3.1 의 route.maze 모양만 가진 가짜 route 로 뷰를 검사한다.
const DEF = ROUTE_OBJECTIVES.sable_deep;
const ESC = DEF.escape;
const OPTS = { reduced: false }, STILL = { reduced: true };
const DT = 1 / 60;
const ROOM = { id: 4, x: 20, z: 30 };

function makeRoute(phase = 'running', trailN = 6, over: any = {}) {
  const trail = new Float32Array(ESC.trailCount * 2);
  for (let i = 0; i < trailN; i++) { trail[i * 2] = 8 + i * 1.6; trail[i * 2 + 1] = 40 - i * 1.6; }
  const maze: any = {
    room: ROOM, phase,
    real: new THREE.Vector3(ROOM.x + ESC.real[0], 0, ROOM.z + ESC.real[1]),
    illusion: new THREE.Vector3(ROOM.x + ESC.illusion[0], 0, ROOM.z + ESC.illusion[1]),
    limit: 20, left: 20, elapsed: 0, collapses: 0, illusions: 0, cooldown: 0, trail, trailN, trailT: ESC.trailEvery, ...over,
  };
  return { def: DEF, maze } as any;
}
const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
const readScale = (mesh: THREE.InstancedMesh, i: number) => { mesh.getMatrixAt(i, m4); const e = m4.elements; return Math.hypot(e[0], e[1], e[2]); };
const readPos = (mesh: THREE.InstancedMesh, i: number, x = 0, y = 0, z = 0) => { mesh.getMatrixAt(i, m4); return v3.set(x, y, z).applyMatrix4(m4).clone(); };
const color = new THREE.Color();
const hexOf = (mesh: THREE.InstancedMesh, i: number) => { mesh.getColorAt(i, color); return color.getHex(); };
const v$ = (v: MirrorMazeView) => v as any;
const step = (view: MirrorMazeView, route: any, seconds: number, opts = OPTS) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) view.update(route, DT, opts);
};
const arr = (mesh: THREE.InstancedMesh) => Array.from(mesh.instanceMatrix.array as Float32Array);
const countShown = (v: any) => (Array.from({ length: ESC.trailCount }, (_, i) => readScale(v.feet, i)).filter(s => s > 0).length);
const hourglassTop = (v: any, m: number) => readPos(v.cones, m * 2 + 1, 0, 0.3, 0);   // 위쪽 원뿔 밑면 중심(뒤집혀 위로 .62)

test('mirrorState 표: maze 없음·idle 은 hidden, running 은 진짜/환영, done 은 shattered', () => {
  expect([mirrorState({ maze: null }, 0), mirrorState({ maze: null }, 1)]).toEqual(['hidden', 'hidden']);
  expect([mirrorState({}, 0), mirrorState(null, 1)]).toEqual(['hidden', 'hidden']);
  expect([mirrorState(makeRoute('idle'), 0), mirrorState(makeRoute('idle'), 1)]).toEqual(['hidden', 'hidden']);
  expect([mirrorState(makeRoute('running'), 0), mirrorState(makeRoute('running'), 1)]).toEqual(['real', 'illusion']);
  expect([mirrorState(makeRoute('done'), 0), mirrorState(makeRoute('done'), 1)]).toEqual(['shattered', 'shattered']);
});

test('count = 2 + 2 + 4 + trailCount, 장면의 InstancedMesh 는 4개, 첫 update 전에는 보이지만 그릴 것이 없다', () => {
  const scene = new THREE.Scene(), route = makeRoute('idle'), view = new MirrorMazeView(scene, route);
  expect(view.count).toBe(2 + 2 + 4 + ESC.trailCount);
  expect(view.group.name).toBe('TLL_MirrorMaze'); expect(scene.children).toContain(view.group);
  let instanced = 0, instances = 0; scene.traverse(o => { if ((o as any).isInstancedMesh) { instanced++; instances += (o as any).count; } });
  expect(instanced).toBe(4); expect(instances).toBe(view.count);
  // 출격 준비 compile 용으로 메시가 보이고, 인스턴스는 모두 scale 0 이다.
  const v = v$(view);
  expect(view.drawCalls).toBe(4);
  for (const mesh of [v.frame, v.face, v.cones, v.feet]) for (let i = 0; i < mesh.count; i++) expect(readScale(mesh, i)).toBe(0);
  view.dispose();
});

test('hidden(idle·maze 없음): drawCalls 0 · footprints 0, states 도 hidden', () => {
  const scene = new THREE.Scene(), view = new MirrorMazeView(scene, makeRoute('idle'));
  const idle = makeRoute('idle', 6);
  view.update(idle, DT, OPTS);
  expect(view.states).toEqual(['hidden', 'hidden']); expect(view.drawCalls).toBe(0); expect(view.footprints).toBe(0);
  idle.maze = null; view.update(idle, DT, OPTS);
  expect(view.states).toEqual(['hidden', 'hidden']); expect(view.drawCalls).toBe(0); expect(view.footprints).toBe(0);
  view.dispose();
});

test('running: 거울 두 개가 real·illusion 위치에 솟고 색은 진짜 stillColor · 환영 spinColor', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  expect(view.states).toEqual(['real', 'illusion']);
  expect(view.drawCalls).toBeGreaterThan(0); expect(view.drawCalls).toBeLessThanOrEqual(4);
  for (const [m, p] of [[0, route.maze.real], [1, route.maze.illusion]] as const) {
    for (const mesh of [v.frame, v.face]) {
      expect(readScale(mesh, m)).toBeCloseTo(1, 5);
      const base = readPos(mesh, m);
      expect(base.x).toBeCloseTo(p.x, 4); expect(base.z).toBeCloseTo(p.z, 4); expect(base.y).toBeCloseTo(0, 4);
    }
    // 거울 틀은 바닥에서 위로 서 있다.
    expect(readPos(v.frame, m, 0, 3, 0).y).toBeGreaterThan(2.9);
    // 모래시계는 거울 위에 떠 있고 같은 x·z 에 있다.
    for (const k of [m * 2, m * 2 + 1]) {
      const c = readPos(v.cones, k);
      expect(c.x).toBeCloseTo(p.x, 4); expect(c.z).toBeCloseTo(p.z, 4); expect(c.y).toBeGreaterThan(3);
    }
  }
  expect(hexOf(v.face, 0)).toBe(DEF.stillColor); expect(hexOf(v.face, 1)).toBe(DEF.spinColor);
  expect([0, 1].map(k => hexOf(v.cones, k))).toEqual([DEF.stillColor, DEF.stillColor]);
  expect([2, 3].map(k => hexOf(v.cones, k))).toEqual([DEF.spinColor, DEF.spinColor]);
  // 두 원뿔은 위아래로 마주 보아 모래시계 모양이 된다: 한쪽의 밑면은 중심 위, 다른 쪽은 중심 아래에 있다.
  const baseUp = readPos(v.cones, 1, 0, -.62, 0).y, baseDown = readPos(v.cones, 0, 0, -.62, 0).y, mid = readPos(v.cones, 0).y;
  expect(baseUp).toBeGreaterThan(mid); expect(baseDown).toBeLessThan(mid);
  view.dispose();
});

test('거울은 0.4초 동안 바닥에서 솟는다(reduced 면 즉시)', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 0), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, 0, OPTS);
  expect(readScale(v.frame, 0)).toBe(0); expect(view.drawCalls).toBe(0);
  step(view, route, .2);
  const mid = readScale(v.frame, 0);
  expect(mid).toBeGreaterThan(.1); expect(mid).toBeLessThan(.9);
  step(view, route, .25);
  expect(readScale(v.frame, 0)).toBeCloseTo(1, 5);
  const fast = new MirrorMazeView(scene, route), fv = v$(fast);
  fast.update(route, 0, STILL);
  expect(readScale(fv.frame, 0)).toBeCloseTo(1, 5);
  view.dispose(); fast.dispose();
});

test('환영 모래시계만 게임 dt 로 돌고, reduced 면 돌지 않는다', () => {
  const route = makeRoute('running', 0), scene = new THREE.Scene(), view = new MirrorMazeView(scene, route), v = v$(view);
  step(view, route, .5);
  const real = Array.from(v.cones.instanceMatrix.array.slice(0, 32)), ill = Array.from(v.cones.instanceMatrix.array.slice(32, 64));
  step(view, route, .1);
  expect(Array.from(v.cones.instanceMatrix.array.slice(0, 32))).toEqual(real);
  expect(Array.from(v.cones.instanceMatrix.array.slice(32, 64))).not.toEqual(ill);
  // 환영 모래시계가 돌면 위쪽 원뿔 밑면 점이 이동하고, 중심은 제자리다.
  const centerBefore = readPos(v.cones, 2), topBefore = hourglassTop(v, 1);
  step(view, route, .13);
  const centerAfter = readPos(v.cones, 2), topAfter = hourglassTop(v, 1);
  expect(centerAfter.distanceTo(centerBefore)).toBeLessThan(1e-4);
  expect(topAfter.distanceTo(topBefore)).toBeGreaterThan(.05);
  // reduced 에서는 시간이 흘러도 같은 행렬이다.
  const still = makeRoute('running', 0), sv = new MirrorMazeView(scene, still), s$ = v$(sv);
  step(sv, still, 1, STILL);
  const snap = arr(s$.cones), version = s$.cones.instanceMatrix.version;
  step(sv, still, 1, STILL);
  expect(arr(s$.cones)).toEqual(snap); expect(s$.cones.instanceMatrix.version).toBe(version);
  view.dispose(); sv.dispose();
});

test('dt 0(syncView)은 솟음·회전·발자국 시간을 진행하지 않지만 상태는 맞춘다', () => {
  const scene = new THREE.Scene(), route = makeRoute('idle'), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  route.maze.phase = 'running';
  view.update(route, 0, OPTS);
  expect(view.states).toEqual(mirrorStates(route));
  for (let k = 0; k < 300; k++) view.update(route, 0, OPTS);
  expect(readScale(v.frame, 0)).toBe(0);
  const before = arr(v.cones), feetBefore = arr(v.feet);
  view.update(route, -1, OPTS); view.update(route, NaN, OPTS);
  expect(arr(v.cones)).toEqual(before); expect(arr(v.feet)).toEqual(feetBefore);
  // 발자국도 dt 0 에서는 줄어들지 않는다.
  step(view, route, .5);
  const feet = countShown(v), shrunk = readScale(v.feet, 0);
  for (let k = 0; k < 120; k++) view.update(route, 0, OPTS);
  expect(countShown(v)).toBe(feet); expect(readScale(v.feet, 0)).toBe(shrunk);
  view.dispose();
});
function mirrorStates(route: any) { return [mirrorState(route, 0), mirrorState(route, 1)]; }

test('states 는 매 update 에서 mirrorState 와 같다', () => {
  const scene = new THREE.Scene(), route = makeRoute('idle'), view = new MirrorMazeView(scene, route);
  for (const phase of ['idle', 'running', 'done', 'idle', 'running']) {
    route.maze.phase = phase;
    view.update(route, 0, OPTS); expect(view.states).toEqual(mirrorStates(route));
    view.update(route, DT, OPTS); expect(view.states).toEqual(mirrorStates(route));
  }
  route.maze = null; view.update(route, DT, OPTS); expect(view.states).toEqual(['hidden', 'hidden']);
  view.dispose();
});

test('발자국: 앞 trailN 개가 trail 점에 놓이고 i ≥ trailN 은 scale 0', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 6), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  expect(view.footprints).toBe(6);
  for (let i = 0; i < ESC.trailCount; i++) {
    if (i < 6) {
      expect(readScale(v.feet, i)).toBeGreaterThan(0);
      const p = readPos(v.feet, i);
      expect(p.x).toBeCloseTo(route.maze.trail[i * 2], 3); expect(p.z).toBeCloseTo(route.maze.trail[i * 2 + 1], 3); expect(p.y).toBeCloseTo(.03, 4);
    } else expect(readScale(v.feet, i)).toBe(0);
  }
  // trail 이 짧아져 재계산되면 남는 칸은 다시 scale 0 이 된다.
  route.maze.trailN = 2; route.maze.trailT += ESC.trailEvery; view.update(route, DT, STILL);
  expect(view.footprints).toBe(2);
  for (let i = 2; i < ESC.trailCount; i++) expect(readScale(v.feet, i)).toBe(0);
  route.maze.trailN = 0; route.maze.trailT += ESC.trailEvery; view.update(route, DT, STILL);
  expect(view.footprints).toBe(0); expect(view.drawCalls).toBeLessThan(4);
  view.dispose();
});

test('발자국은 i × .04초 뒤에 나타나 trailEvery 동안 줄어들어 사라진다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 8), view = new MirrorMazeView(scene, route), v = v$(view);
  step(view, route, .5);   // 솟음이 끝날 때까지(발자국 시간도 흘렀다)
  route.maze.trailT = ESC.trailEvery;   // 방금 trail 이 다시 채워진 것처럼 보이게 한다(바로 앞 값은 .5 라 같다 → 첫 점을 바꿔 알린다)
  route.maze.trail[0] += .5;
  view.update(route, 1e-9, OPTS);
  // 직후에는 앞쪽 발자국만 보인다(뒤쪽은 지연 중).
  expect(readScale(v.feet, 0)).toBeGreaterThan(.9);
  expect(readScale(v.feet, 7)).toBe(0);
  step(view, route, .2);
  const early = readScale(v.feet, 0), late = readScale(v.feet, 3);
  expect(early).toBeLessThan(.7); expect(late).toBeGreaterThan(early);   // 먼저 찍힌 발자국이 더 많이 줄었다
  expect(readScale(v.feet, 7)).toBe(0);                                  // 마지막 발자국(지연 .28초)은 아직이다
  step(view, route, .1);
  expect(readScale(v.feet, 7)).toBeGreaterThan(0);                       // 이제 나타났다
  // trailEvery 가 지나면 앞쪽은 사라진다(뒤쪽은 지연만큼 늦게 사라진다).
  step(view, route, .25);
  expect(readScale(v.feet, 0)).toBe(0);
  step(view, route, .3);
  expect(view.footprints).toBe(0); expect(view.drawCalls).toBeLessThan(4);
  view.dispose();
});

test('trailT 가 커지거나 첫 점이 바뀌면 발자국이 다시 찍히고, 그대로면 계속 줄어든다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 5), view = new MirrorMazeView(scene, route), v = v$(view);
  step(view, route, .8);   // 마지막 발자국(지연 .16초)까지 .5초 동안 줄어 사라진다
  expect(view.footprints).toBe(0);
  // 게임이 하듯 trailT 를 줄이다가 재계산 뒤 trailEvery 로 올린다.
  route.maze.trailT = .02; view.update(route, DT, OPTS); expect(view.footprints).toBe(0);
  route.maze.trailT = ESC.trailEvery; view.update(route, DT, OPTS);
  expect(readScale(v.feet, 0)).toBeGreaterThan(.9);
  step(view, route, .2); expect(view.footprints).toBe(5);
  step(view, route, .8); expect(view.footprints).toBe(0);
  // trailT 는 그대로이고 첫 점만 바뀌어도 다시 찍힌다(영웅이 움직여 새 길이 계산된 경우).
  route.maze.trail[0] += 1; view.update(route, DT, OPTS);
  expect(readScale(v.feet, 0)).toBeGreaterThan(.9);
  step(view, route, .2); expect(view.footprints).toBe(5);
  const p = readPos(v.feet, 0); expect(p.x).toBeCloseTo(route.maze.trail[0], 3);
  view.dispose();
});

test('reduced 면 발자국이 줄어들지 않고 그대로 유지된다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 7), view = new MirrorMazeView(scene, route);
  view.update(route, DT, STILL);
  step(view, route, 3, STILL);
  expect(view.footprints).toBe(7);
  expect(readScale(v$(view).feet, 6)).toBeCloseTo(1, 5);
  view.dispose();
});

test('done: 0.5초 안에 거울과 발자국이 모두 사라지고 drawCalls 0 (reduced 는 즉시)', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 6), view = new MirrorMazeView(scene, route), v = v$(view);
  step(view, route, .6);
  expect(view.drawCalls).toBeGreaterThan(0);
  route.maze.phase = 'done';
  view.update(route, DT, OPTS);
  expect(view.states).toEqual(['shattered', 'shattered']);
  expect(readScale(v.frame, 0)).toBeGreaterThan(.9);    // 깨지는 중에는 아직 보인다
  expect(view.drawCalls).toBeGreaterThan(0);
  step(view, route, .2);
  const mid = readScale(v.frame, 0); expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(.9);
  step(view, route, .3);
  expect(view.drawCalls).toBe(0); expect(view.footprints).toBe(0);
  for (const mesh of [v.frame, v.face, v.cones, v.feet]) expect(mesh.visible).toBe(false);
  const instant = makeRoute('running', 6), iv = new MirrorMazeView(scene, instant);
  iv.update(instant, DT, STILL); expect(iv.drawCalls).toBeGreaterThan(0);
  instant.maze.phase = 'done'; iv.update(instant, DT, STILL);
  expect(iv.drawCalls).toBe(0);
  view.dispose(); iv.dispose();
});

test('drawCalls 는 실제로 보이는 메시 수이고 running 에서 4 이하', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 6), view = new MirrorMazeView(scene, route);
  const visible = () => { let n = 0; view.group.traverse(o => { if ((o as any).isInstancedMesh && o.visible) n++; }); return n; };
  for (const phase of ['idle', 'running', 'running', 'done']) {
    route.maze.phase = phase; step(view, route, .3);
    expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBeLessThanOrEqual(4);
  }
  route.maze.phase = 'running'; view.update(route, DT, OPTS); expect(view.drawCalls).toBe(visible());
  view.group.visible = false; expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('바뀌지 않은 스텝은 행렬·색 업로드 플래그를 올리지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running', 5), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  const meshes = [v.frame, v.face, v.cones, v.feet];
  const versions = () => meshes.map(m => m.instanceMatrix.version);
  const before = versions(), colors = [v.face.instanceColor.version, v.cones.instanceColor.version];
  step(view, route, 2, STILL); route.maze.trailT -= .01;   // trailT 가 줄어드는 것은 갱신이 아니다
  view.update(route, DT, STILL);
  expect(versions()).toEqual(before);
  expect([v.face.instanceColor.version, v.cones.instanceColor.version]).toEqual(colors);
  // 반대로 시간이 흐르는 환영 모래시계는 올린다(위 검사가 의미 있는지 확인).
  view.update(route, DT, OPTS); view.update(route, DT, OPTS);
  expect(v.cones.instanceMatrix.version).toBeGreaterThan(before[2]);
  view.dispose();
});

test('update 는 새 배열·행렬 버퍼를 만들지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute('idle'), view = new MirrorMazeView(scene, route), v = v$(view);
  const refs = [view.states, v.frame.instanceMatrix.array, v.cones.instanceMatrix.array, v.feet.instanceMatrix.array, v.face.instanceColor, v.cones.instanceColor, v.group.children.length];
  view.update(route, DT, OPTS);
  route.maze.phase = 'running'; step(view, route, 1);
  route.maze.trailN = 3; route.maze.trailT += .5; step(view, route, .6);
  route.maze.phase = 'done'; step(view, route, .6);
  const after = [view.states, v.frame.instanceMatrix.array, v.cones.instanceMatrix.array, v.feet.instanceMatrix.array, v.face.instanceColor, v.cones.instanceColor, v.group.children.length];
  refs.forEach((r, k) => expect(after[k]).toBe(r));
  view.dispose();
});

test('dispose 는 반복해도 안전하고 scene·geometry·material 을 해제한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new MirrorMazeView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  let geoDisposed = 0, matDisposed = 0, meshDisposed = 0;
  for (const g of v.geometries) g.addEventListener('dispose', () => { geoDisposed++; });
  for (const m of v.materials) m.addEventListener('dispose', () => { matDisposed++; });
  for (const m of [v.frame, v.face, v.cones, v.feet]) m.addEventListener('dispose', () => { meshDisposed++; });
  expect(scene.children).toContain(view.group);
  view.dispose(); view.dispose();
  expect(geoDisposed).toBe(4); expect(matDisposed).toBe(4); expect(meshDisposed).toBe(4);
  expect(scene.children).not.toContain(view.group);
  expect(view.count).toBe(0); expect(view.drawCalls).toBe(0); expect(view.footprints).toBe(0);
  expect(() => view.update(route, DT, OPTS)).not.toThrow();
});
