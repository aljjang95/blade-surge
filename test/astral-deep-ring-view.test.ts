import { expect, test } from 'bun:test';
import { heapStats } from 'bun:jsc';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { AstralDeepRingView, markColor, markState } from '../src/game/astral-deep-ring-view.js';

// rules lane 의 컨트롤러(src/game/astral-deep-constellations.js)는 쓰지 않는다. BUNDLE-12 PLAN 3.1 의 읽기 계약 모양만 가진 가짜 route 로 뷰를 검사한다.
const DEF = ROUTE_OBJECTIVES.astral_deep, RING = DEF.ring;
const OPTS = { reduced: false }, STILL = { reduced: true };
const DT = 1 / 60;
const GOLD = 0xffd060, GRAY = 0x8394ac;
const CENTER = { x: 200, z: 40 };
const RADIUS = 6;

function makeRoute(phase = 'open', over: any = {}) {
  const ring: any = {
    phase, room: { id: RING.roomId, discovered: true }, center: new THREE.Vector3(CENTER.x, 0, CENTER.z),
    minX: CENTER.x - 11, maxX: CENTER.x + 11, minZ: CENTER.z - 12, maxZ: CENTER.z + 12,
    clock: 0, left: 20, limit: 20, elapsed: 0, collapses: 0, shardHits: 0, purified: 0, held: -1,
    marks: RING.marks.map(([dx, dz]: readonly number[]) => ({ pos: new THREE.Vector3(CENTER.x + dx, 0, CENTER.z + dz), hold: 0, done: false })),
    shard: { state: 'calm', age: 0, cycle: -1 },
    ...over,
  };
  return { def: DEF, ring } as any;
}

const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
const scaleOf = (mesh: any, i: number) => { mesh.getMatrixAt(i, m4); const e = m4.elements; return { x: e[0], y: e[5], z: e[10] }; };
const posOf = (mesh: any, i: number) => { mesh.getMatrixAt(i, m4); return v3.setFromMatrixPosition(m4).clone(); };
const shown = (mesh: any, i: number) => { const s = scaleOf(mesh, i); return s.x > 0 && s.y > 0 && s.z > 0; };
const color = new THREE.Color();
const hexOf = (mesh: any, i: number) => { mesh.getColorAt(i, color); return color.getHex(); };
const v$ = (view: AstralDeepRingView) => view as any;
const step = (view: AstralDeepRingView, route: any, seconds: number, opts = OPTS) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) view.update(route, DT, opts);
};
const radial = (p: THREE.Vector3) => Math.hypot(p.x - CENTER.x, p.z - CENTER.z);
const deepFreeze = (o: any): any => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const withShard = (state: string, age: number, phase = 'running') => { const r = makeRoute(phase); r.ring.shard = { state, age, cycle: 0 }; return r; };

test('markState·markColor: 정화가 유지보다 먼저, 색은 금색 · 정의의 ring.color · 회색', () => {
  const ring = makeRoute().ring;
  ring.held = 1; ring.marks[0].done = true;
  expect([0, 1, 2, 3].map(i => markState(ring, i))).toEqual(['purified', 'held', 'idle', 'idle']);
  ring.held = 0;   // 이미 정화한 성표 위에 서 있어도 정화 상태가 이긴다
  expect(markState(ring, 0)).toBe('purified');
  expect([markColor('purified', RING), markColor('held', RING), markColor('idle', RING)]).toEqual([GOLD, RING.color, GRAY]);
  expect(markColor('held', { color: 0x123456 })).toBe(0x123456);
});

test('첫 update 전에는 compile 을 위해 메시를 보이지만 그릴 것이 없고, 첫 update 뒤 숨길 것은 drawCalls 0', () => {
  const scene = new THREE.Scene(), route = makeRoute('idle'), view = new AstralDeepRingView(scene, route), v = v$(view);
  expect(view.group.name).toBe('TLL_AstralDeepRing'); expect(scene.children).toContain(view.group);
  expect(view.drawCalls).toBe(6);
  let instanced = 0; scene.traverse(o => { if ((o as any).isInstancedMesh) instanced++; });
  expect(instanced).toBe(6);
  for (const mesh of v.meshes) for (let i = 0; i < mesh.count; i++) expect(shown(mesh, i)).toBe(false);
  view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('open·running 일 때만 보이고 idle 은 숨긴다', () => {
  const scene = new THREE.Scene(), view = new AstralDeepRingView(scene, makeRoute('idle')), v = v$(view);
  view.update(makeRoute('idle'), DT, OPTS); expect(view.drawCalls).toBe(0);
  for (const phase of ['open', 'running']) {
    view.update(makeRoute(phase), DT, OPTS);
    expect(shown(v.line, 0)).toBe(true);
    expect([0, 1, 2, 3].map(i => shown(v.marks, i))).toEqual([true, true, true, true]);
    expect(view.drawCalls).toBeGreaterThan(0);
  }
  view.update(makeRoute('idle'), DT, OPTS);
  expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('바닥 연출은 높이 .08~.12 이고 위치는 route 의 중심·성표 좌표를 따른다', () => {
  const scene = new THREE.Scene(), route = withShard('warning', .5), view = new AstralDeepRingView(scene, route), v = v$(view);
  route.ring.marks[0].hold = .5; route.ring.held = 0;
  view.update(route, DT, OPTS);
  const line = posOf(v.line, 0);
  expect(line.x).toBeCloseTo(CENTER.x, 4); expect(line.z).toBeCloseTo(CENTER.z, 4);
  for (const mesh of [v.line, v.marks, v.fills, v.border]) {
    for (let i = 0; i < mesh.count; i++) {
      if (!shown(mesh, i)) continue;
      const p = posOf(mesh, i);
      expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
    }
  }
  for (let i = 0; i < 4; i++) {
    const p = posOf(v.marks, i), q = posOf(v.fills, i), want = route.ring.marks[i].pos;
    expect(p.x).toBeCloseTo(want.x, 4); expect(p.z).toBeCloseTo(want.z, 4);
    expect(q.x).toBeCloseTo(want.x, 4); expect(q.z).toBeCloseTo(want.z, 4);
  }
  // 고리 선은 성표를 지나는 반지름 6 위에 있고, 성표 고리의 바깥 반지름은 판정 반지름이다.
  const lp = v.line.geometry.getAttribute('position'); let lo = Infinity, hi = 0;
  for (let k = 0; k < lp.count; k++) { const r = Math.hypot(lp.getX(k), lp.getZ(k)); lo = Math.min(lo, r); hi = Math.max(hi, r); }
  expect(lo).toBeLessThan(RADIUS); expect(hi).toBeGreaterThan(RADIUS); expect(hi - lo).toBeGreaterThanOrEqual(.3);
  v.marks.geometry.computeBoundingBox();
  expect(v.marks.geometry.boundingBox.max.x).toBeCloseTo(RING.markRadius, 4);
  expect(hexOf(v.line, 0)).toBe(RING.color);
  view.dispose();
});

test('성표 색: 정화 금색 · 유지 중 ring.color · 그 밖 회색, 성표마다 따로 바뀐다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running'), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => hexOf(v.marks, i))).toEqual([GRAY, GRAY, GRAY, GRAY]);
  route.ring.held = 2; route.ring.marks[2].hold = .3; route.ring.marks[1].done = true; route.ring.purified = 1;
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => hexOf(v.marks, i))).toEqual([GRAY, GOLD, RING.color, GRAY]);
  // 유지를 놓치면 색이 돌아온다(붕괴로 초기화되면 정화 색도 사라진다).
  route.ring.held = -1; route.ring.marks[2].hold = 0; route.ring.marks[1].done = false; route.ring.purified = 0;
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => hexOf(v.marks, i))).toEqual([GRAY, GRAY, GRAY, GRAY]);
  view.dispose();
});

test('채움 원: 유지 비율만큼 안쪽 원 scale 이 커지고, 정화되면 가득 차며, 유지하지 않으면 없다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running'), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => shown(v.fills, i))).toEqual([false, false, false, false]);
  route.ring.held = 0;
  const seen: number[] = [];
  for (const h of [.25, .5, .75]) { route.ring.marks[0].hold = h * RING.holdSeconds; view.update(route, DT, OPTS); seen.push(scaleOf(v.fills, 0).x); }
  expect(seen[0]).toBeGreaterThan(0);
  expect(seen[1] / seen[0]).toBeCloseTo(2, 5); expect(seen[2] / seen[0]).toBeCloseTo(3, 5);
  // 채움은 성표 고리 안쪽에 들어간다.
  v.fills.geometry.computeBoundingBox();
  expect(v.fills.geometry.boundingBox.max.x).toBeLessThan(RING.markRadius);
  expect(hexOf(v.fills, 0)).toBe(RING.color);
  route.ring.marks[0].hold = 0; route.ring.marks[0].done = true; route.ring.purified = 1; route.ring.held = -1;
  view.update(route, DT, OPTS);
  expect(scaleOf(v.fills, 0).x).toBeCloseTo(1, 5); expect(hexOf(v.fills, 0)).toBe(GOLD);
  // 정의의 유지 시간을 넘는 값도 가득 찬 것 이상으로 커지지 않는다.
  route.ring.marks[2].hold = RING.holdSeconds * 3; route.ring.held = 2; view.update(route, DT, OPTS);
  expect(scaleOf(v.fills, 2).x).toBeLessThanOrEqual(1);
  view.dispose();
});

test('파편 calm: 고리(반지름 6) 위 높이 1.2 근처에 shards 개가 서로 다른 방향으로 떠 있고 성표 위에 겹치지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running'), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  expect(v.shards.count).toBe(RING.shards);
  const angles = new Set<string>();
  for (let k = 0; k < RING.shards; k++) {
    expect(shown(v.shards, k)).toBe(true);
    const p = posOf(v.shards, k);
    expect(radial(p)).toBeCloseTo(RADIUS, 4); expect(p.y).toBeCloseTo(1.2, 4);
    angles.add(Math.atan2(p.z - CENTER.z, p.x - CENTER.x).toFixed(3));
    for (const mark of route.ring.marks) expect(Math.hypot(p.x - mark.pos.x, p.z - mark.pos.z)).toBeGreaterThan(.5);
  }
  expect(angles.size).toBe(RING.shards);
  expect(shown(v.border, 0)).toBe(false); expect(shown(v.flash, 0)).toBe(false);
  view.dispose();
});

test('파편 warning: age / warning 비율로 고리에서 중심까지 모이고, reduced 여도 위치는 같다', () => {
  const scene = new THREE.Scene(), still = new AstralDeepRingView(scene, makeRoute()), s$ = v$(still);
  const radii: number[] = [];
  for (const f of [0, .25, .5, .75, 1]) {
    const r = withShard('warning', f * RING.warning);
    still.update(r, DT, STILL);
    const expected = RADIUS * (1 - f);
    for (let k = 0; k < RING.shards; k++) expect(radial(posOf(s$.shards, k))).toBeCloseTo(expected, 4);
    radii.push(radial(posOf(s$.shards, 0)));
  }
  for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
  // 같은 age 에서 reduced 가 아니어도 수평 위치는 같고, 흔들림은 높이에만 나타난다.
  const r = withShard('warning', RING.warning * .4); r.ring.clock = 3.3;
  const live = new AstralDeepRingView(scene, r), l$ = v$(live), calm = new AstralDeepRingView(scene, r), c$ = v$(calm);
  live.update(r, DT, OPTS); calm.update(r, DT, STILL);
  let bobbed = false;
  for (let k = 0; k < RING.shards; k++) {
    const a = posOf(l$.shards, k), b = posOf(c$.shards, k);
    expect(a.x).toBeCloseTo(b.x, 6); expect(a.z).toBeCloseTo(b.z, 6);
    if (Math.abs(a.y - b.y) > 1e-3) bobbed = true;
  }
  expect(bobbed).toBe(true);
  // 흔들림은 route 시계로만 정해져 시간이 흐르지 않으면 반복해도 같다.
  const y0 = posOf(l$.shards, 0).y; step(live, r, 1);
  expect(posOf(l$.shards, 0).y).toBe(y0);
  still.dispose(); live.dispose(); calm.dispose();
});

test('파편 warning 동안 중심 경계 고리가 core 반지름으로 보이고, 위험하지 않은 동안은 없다', () => {
  const scene = new THREE.Scene(), view = new AstralDeepRingView(scene, makeRoute()), v = v$(view);
  view.update(withShard('calm', 0), DT, OPTS);
  expect(shown(v.border, 0)).toBe(false); expect(v.border.visible).toBe(false);
  view.update(withShard('warning', .1), DT, OPTS);
  expect(shown(v.border, 0)).toBe(true); expect(v.border.visible).toBe(true);
  const p = posOf(v.border, 0);
  expect(p.x).toBeCloseTo(CENTER.x, 4); expect(p.z).toBeCloseTo(CENTER.z, 4);
  expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
  v.border.geometry.computeBoundingBox();
  expect(v.border.geometry.boundingBox.max.x).toBeCloseTo(RING.core, 4);
  expect(scaleOf(v.border, 0).x).toBe(1);
  view.update(withShard('burst', .1), DT, OPTS);
  expect(shown(v.border, 0)).toBe(false);
  view.dispose();
});

test('파편 burst: 중심 core 원 섬광이 켜지고 파편은 숨으며, 끝나면 섬광이 꺼진다', () => {
  const scene = new THREE.Scene(), view = new AstralDeepRingView(scene, makeRoute()), v = v$(view);
  view.update(withShard('burst', .1), DT, OPTS);
  expect(shown(v.flash, 0)).toBe(true); expect(v.flash.visible).toBe(true);
  const p = posOf(v.flash, 0);
  expect(p.x).toBeCloseTo(CENTER.x, 4); expect(p.z).toBeCloseTo(CENTER.z, 4);
  expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
  v.flash.geometry.computeBoundingBox();
  expect(v.flash.geometry.boundingBox.max.x).toBeCloseTo(RING.core, 4);
  expect(scaleOf(v.flash, 0).x).toBe(1);
  expect(hexOf(v.flash, 0)).toBe(0xff6a3d);
  for (let k = 0; k < RING.shards; k++) expect(shown(v.shards, k)).toBe(false);
  expect(v.shards.visible).toBe(false);
  view.update(withShard('calm', 0), DT, OPTS);
  expect(shown(v.flash, 0)).toBe(false);
  for (let k = 0; k < RING.shards; k++) expect(shown(v.shards, k)).toBe(true);
  view.dispose();
});

test('route 의 중심이 바뀌면 모든 요소가 새 중심을 따른다', () => {
  const scene = new THREE.Scene(), route = withShard('warning', .6), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  route.ring.center.set(-30, 0, 55); route.ring.marks.forEach((m: any, i: number) => m.pos.set(-30 + RING.marks[i][0], 0, 55 + RING.marks[i][1]));
  view.update(route, DT, OPTS);
  for (const mesh of [v.line, v.border]) { const p = posOf(mesh, 0); expect(p.x).toBeCloseTo(-30, 4); expect(p.z).toBeCloseTo(55, 4); }
  for (let k = 0; k < RING.shards; k++) {
    const p = posOf(v.shards, k);
    expect(Math.hypot(p.x + 30, p.z - 55)).toBeCloseTo(RADIUS * (1 - .6 / RING.warning), 4);
  }
  view.dispose();
});

test('done: 0.5초 안에 줄어들어 숨고(reduced 는 즉시), 고리를 보지 못한 채 done 이면 바로 숨긴다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running'), view = new AstralDeepRingView(scene, route), v = v$(view);
  route.ring.marks.forEach((m: any) => { m.done = true; });
  step(view, route, .2);
  expect(scaleOf(v.line, 0).x).toBe(1);
  route.ring.phase = 'done'; view.update(route, DT, OPTS);
  expect(scaleOf(v.line, 0).x).toBeGreaterThan(.9);   // 막 끝났으니 아직 보인다
  step(view, route, .2);
  const mid = scaleOf(v.line, 0).x; expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(.9);
  expect(scaleOf(v.marks, 0).x).toBeCloseTo(mid, 5);
  step(view, route, .4);
  expect(view.drawCalls).toBe(0);
  const fast = new AstralDeepRingView(scene, makeRoute('running')), f$ = v$(fast);
  const fr = makeRoute('running');
  fast.update(fr, DT, STILL); expect(shown(f$.line, 0)).toBe(true);
  fr.ring.phase = 'done'; fast.update(fr, DT, STILL);
  expect(shown(f$.line, 0)).toBe(false); expect(fast.drawCalls).toBe(0);
  const late = new AstralDeepRingView(scene, makeRoute('done')), l$ = v$(late);
  late.update(makeRoute('done'), DT, OPTS);
  expect(shown(l$.line, 0)).toBe(false); expect(late.drawCalls).toBe(0);
  // 줄어드는 동안에도 파편은 더 보이지 않는다.
  const sh = new AstralDeepRingView(scene, route);
  sh.update(makeRoute('running'), DT, OPTS);
  const dr = makeRoute('done'); dr.ring.shard = { state: 'calm', age: 0, cycle: 0 };
  sh.update(dr, DT, OPTS);
  for (let k = 0; k < RING.shards; k++) expect(shown(v$(sh).shards, k)).toBe(false);
  view.dispose(); fast.dispose(); late.dispose(); sh.dispose();
});

test('dt 0(syncView)과 음수·NaN dt 는 줄어듦 시간을 진행하지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute('running'), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  route.ring.phase = 'done';
  view.update(route, 0, OPTS);
  const s = scaleOf(v.line, 0).x;
  for (let k = 0; k < 300; k++) view.update(route, 0, OPTS);
  view.update(route, -1, OPTS); view.update(route, NaN, OPTS);
  expect(scaleOf(v.line, 0).x).toBe(s);
  expect(s).toBeGreaterThan(0);
  view.dispose();
});

test('같은 상태를 반복해 update 해도 행렬·색 업로드 플래그를 올리지 않고 새 버퍼·객체를 만들지 않는다', () => {
  const scene = new THREE.Scene(), route = withShard('warning', .6), view = new AstralDeepRingView(scene, route), v = v$(view);
  route.ring.held = 1; route.ring.marks[1].hold = .4; route.ring.marks[3].done = true; route.ring.clock = 2.5;
  view.update(route, DT, OPTS);
  const versions = () => v.meshes.map((m: any) => m.instanceMatrix.version + (m.instanceColor ? m.instanceColor.version : 0));
  const before = versions();
  const refs = [v.meshes.map((m: any) => m.instanceMatrix.array), v.meshes.map((m: any) => m.instanceColor), v.group.children.length];
  step(view, route, 3);
  view.update(route, 0, OPTS);
  expect(versions()).toEqual(before);
  v.meshes.forEach((m: any, k: number) => { expect(m.instanceMatrix.array).toBe(refs[0][k]); expect(m.instanceColor).toBe(refs[1][k]); });
  expect(v.group.children.length).toBe(refs[2]);
  // 같은 상태를 수천 번 되풀이하는 동안 THREE 값 객체를 만들거나 채우지 않는다(set 호출 관찰 + 힙 개수 증가).
  const created = new Map<string, number>();
  const wrap = (cls: any, name: string) => {
    const real = cls.prototype.set, spy = function (this: any, ...a: any[]) { created.set(name, (created.get(name) || 0) + 1); return real.apply(this, a); };
    cls.prototype.set = spy; return () => { cls.prototype.set = real; };
  };
  const restore = [wrap(THREE.Matrix4, 'Matrix4'), wrap(THREE.Color, 'Color'), wrap(THREE.Vector3, 'Vector3')];
  const counts = () => { const t: any = heapStats().objectTypeCounts; return (t.Object || 0) + (t.Array || 0) + (t.Float32Array || 0) + (t.Float64Array || 0) + (t.Function || 0); };
  const heapBefore = counts();
  try { for (let k = 0; k < 4000; k++) view.update(route, DT, OPTS); } finally { restore.forEach(r => r()); }
  expect(created.size).toBe(0);
  expect(counts() - heapBefore).toBeLessThan(400);
  expect(versions()).toEqual(before);
  // 반대로 상태가 바뀌면 올린다(위 검사가 의미 있는지 확인).
  route.ring.shard.age = .9; view.update(route, DT, OPTS);
  expect(versions()).not.toEqual(before);
  view.dispose();
});

test('뷰는 route 를 읽기만 한다(깊게 얼린 route 로 모든 단계를 update)', () => {
  const scene = new THREE.Scene(), view = new AstralDeepRingView(scene, makeRoute());
  for (const [state, phase] of [['calm', 'open'], ['warning', 'running'], ['burst', 'running'], ['calm', 'done']] as const) {
    const r = makeRoute(phase); r.ring.shard.state = state; r.ring.shard.age = .4; r.ring.held = 0; r.ring.marks[0].hold = .5;
    deepFreeze(r);
    expect(() => step(view, r, .8)).not.toThrow();
  }
  view.dispose();
});

test('drawCalls 는 실제로 보이는 메시 수이고 6 이하이다', () => {
  const scene = new THREE.Scene(), route = withShard('warning', .5), view = new AstralDeepRingView(scene, route);
  route.ring.held = 0; route.ring.marks[0].hold = .5;
  const visible = () => { let n = 0; view.group.traverse(o => { if ((o as any).isInstancedMesh && o.visible) n++; }); return n; };
  view.update(route, DT, OPTS);
  // 고리 선 · 성표 · 채움 · 파편 · 중심 경계 = 5(섬광은 burst 에만).
  expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBe(5);
  route.ring.shard.state = 'burst'; view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBe(4);   // 선 · 성표 · 채움 · 섬광
  route.ring.shard.state = 'calm'; route.ring.held = -1; route.ring.marks[0].hold = 0; view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBe(3);   // 선 · 성표 · 파편
  view.group.visible = false; expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('모든 재질은 불투명하고 정렬되는 별도 패스가 없다', () => {
  const scene = new THREE.Scene(), view = new AstralDeepRingView(scene, makeRoute()), v = v$(view);
  for (const m of v.materials) { expect(m.transparent).toBe(false); expect(m.opacity).toBe(1); expect(m.side).toBe(THREE.FrontSide); }
  view.dispose();
});

test('dispose 는 반복해도 안전하고 scene·geometry·material·mesh 를 해제한다', () => {
  const scene = new THREE.Scene(), route = withShard('burst', .2), view = new AstralDeepRingView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  let geo = 0, mat = 0, mesh = 0;
  for (const g of v.geometries) g.addEventListener('dispose', () => { geo++; });
  for (const m of v.materials) m.addEventListener('dispose', () => { mat++; });
  for (const m of v.meshes) m.addEventListener('dispose', () => { mesh++; });
  const geometryCount = v.geometries.length, materialCount = v.materials.length;
  expect(scene.children).toContain(view.group);
  view.dispose(); view.dispose();
  expect(mesh).toBe(6); expect(geo).toBe(geometryCount); expect(mat).toBe(materialCount);
  expect(scene.children).not.toContain(view.group);
  expect(view.drawCalls).toBe(0);
  expect(() => view.update(route, DT, OPTS)).not.toThrow();
});


// ---- 일반 성운 기록 외곽 고리(BUNDLE-13): 같은 뷰가 정의(표지 3·기록 파편 6·core 3.2·색)만으로 그려진다 ----
const STD = ROUTE_OBJECTIVES.astral_standard, STD_RING = STD.ring as any;
function makeStandardRoute(phase = 'running', shard: any = { state: 'calm', age: 0, cycle: -1 }) {
  const route = makeRoute(phase, {
    room: { id: STD_RING.roomId, discovered: true }, left: STD_RING.limit, limit: STD_RING.limit, shard,
    marks: STD_RING.marks.map(([dx, dz]: readonly number[]) => ({ pos: new THREE.Vector3(CENTER.x + dx, 0, CENTER.z + dz), hold: 0, done: false })),
  });
  route.def = STD;
  return route;
}

test('일반 고리: 표지 3개·기록 파편 6개·core 3.2 경계·섬광, 유지 중 색은 일반 정의 색이고 그 밖은 심층과 같다', () => {
  const scene = new THREE.Scene(), route = makeStandardRoute(), view = new AstralDeepRingView(scene, route), v = v$(view);
  expect(STD_RING.marks.length).toBe(3); expect(STD_RING.shards).toBe(6); expect(STD_RING.core).toBe(3.2);
  route.ring.held = 1; route.ring.marks[1].hold = .5; route.ring.marks[0].done = true;
  view.update(route, DT, STILL);
  expect(v.marks.count).toBe(3); expect(v.shards.count).toBe(6);
  expect([0, 1, 2].map(i => shown(v.marks, i))).toEqual([true, true, true]);
  expect([0, 1, 2].map(i => radial(posOf(v.marks, i)))).toEqual([RADIUS, RADIUS, RADIUS].map(r => expect.closeTo(r, 4)) as any);
  expect([hexOf(v.marks, 0), hexOf(v.marks, 1), hexOf(v.marks, 2)]).toEqual([GOLD, STD_RING.color, GRAY]);
  for (let k = 0; k < 6; k++) {
    const p = posOf(v.shards, k);
    expect(radial(p)).toBeCloseTo(RADIUS, 4);
    for (const mark of route.ring.marks) expect(Math.hypot(p.x - mark.pos.x, p.z - mark.pos.z)).toBeGreaterThan(.5);
  }
  view.update(makeStandardRoute('running', { state: 'warning', age: STD_RING.warning / 2, cycle: 0 }), DT, STILL);
  expect(shown(v.border, 0)).toBe(true);
  v.border.geometry.computeBoundingBox();
  expect(v.border.geometry.boundingBox.max.x).toBeCloseTo(STD_RING.core, 4);
  // 예고 2초의 절반이면 파편은 반지름의 절반까지 모였다.
  for (let k = 0; k < 6; k++) expect(radial(posOf(v.shards, k))).toBeCloseTo(RADIUS / 2, 4);
  view.update(makeStandardRoute('running', { state: 'burst', age: .1, cycle: 0 }), DT, STILL);
  expect(shown(v.flash, 0)).toBe(true);
  v.flash.geometry.computeBoundingBox();
  expect(v.flash.geometry.boundingBox.max.x).toBeCloseTo(STD_RING.core, 4);
  expect(view.drawCalls).toBeLessThanOrEqual(6);
  view.update(makeStandardRoute('idle'), DT, STILL);
  expect(view.drawCalls).toBe(0);
  view.dispose();
});


test('파편 시작 위상: 심층은 기존 22.5°(.5) 그대로, 일반은 표지에서 15° 떨어진 위상을 고른다', () => {
  const scene = new THREE.Scene();
  const deep = new AstralDeepRingView(scene, makeRoute()), std = new AstralDeepRingView(scene, makeStandardRoute());
  expect(v$(deep).shardPhase).toBe(.5);
  const sp = v$(std).shardPhase;
  expect(sp === .25 || sp === .75).toBe(true);
  std.update(makeStandardRoute(), DT, STILL);
  let min = Infinity;
  for (let k = 0; k < 6; k++) for (const [dx, dz] of STD_RING.marks) {
    const p = posOf(v$(std).shards, k); min = Math.min(min, Math.hypot(p.x - (CENTER.x + dx), p.z - (CENTER.z + dz)));
  }
  // 반지름 6 에서 15° 떨어진 현의 길이 ≈ 1.566 이고 표지 판정 반지름 1.4 밖이다.
  expect(min).toBeCloseTo(2 * RADIUS * Math.sin(Math.PI / 24), 3);
  expect(min).toBeGreaterThan(STD_RING.markRadius);
  deep.dispose(); std.dispose();
});

