import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { VerdigrisDeepView, altarState, bandColor, bandState } from '../src/game/verdigris-deep-view.js';

// rules lane 의 컨트롤러(src/game/verdigris-deep-altars.js)는 쓰지 않는다. BUNDLE-11 PLAN 3.1 의 읽기 계약 모양만 가진 가짜 route 로 뷰를 검사한다.
const DEF = ROUTE_OBJECTIVES.verdigris_deep, CH = DEF.channel;
const OPTS = { reduced: false }, STILL = { reduced: true };
const DT = 1 / 60;
const GOLD = 0xffd060, GRAY = 0x8394ac;
const ROOM_CENTER = { x: 200, z: 40 };

function makeRoute(over: any = {}) {
  const gates = DEF.gates.map((g: any, i: number) => ({ room: { id: g.roomId, x: 20 + i * 30, z: -10 + i * 7, discovered: true }, label: g.label, ready: false, attuned: false }));
  const channel: any = {
    phase: 'idle', room: { id: 7, ...ROOM_CENTER, discovered: true },
    entry: new THREE.Vector3(ROOM_CENTER.x + CH.entry[0], 0, ROOM_CENTER.z + CH.entry[1]),
    exit: new THREE.Vector3(ROOM_CENTER.x + CH.exit[0], 0, ROOM_CENTER.z + CH.exit[1]),
    minX: ROOM_CENTER.x - 12, maxX: ROOM_CENTER.x + 12, minZ: ROOM_CENTER.z - 10, maxZ: ROOM_CENTER.z + 10,
    startX: ROOM_CENTER.x + CH.startLine, finishX: ROOM_CENTER.x + CH.finishLine,
    clock: 0, left: 0, limit: 0, elapsed: 0, floods: 0, sporeHits: 0,
    bands: CH.bands.map((dx: number) => ({ x: ROOM_CENTER.x + dx, half: CH.bandHalf, state: 'calm', age: 0, cycle: -1 })),
  };
  const route: any = { def: DEF, gates, progress: 0, litMoves: 0, litT: 0, channel,
    get lit() { return this.progress < this.gates.length ? this.gates[this.progress] : null; }, ...over };
  return route;
}
const openRoute = (state = 'calm', phase = 'open', age = 0) => {
  const route = makeRoute({ progress: 4, litMoves: 3 });
  for (const g of route.gates) { g.attuned = true; g.ready = true; }
  route.channel.phase = phase;
  for (const b of route.channel.bands) { b.state = state; b.age = age; }
  return route;
};

const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
const scaleOf = (mesh: any, i: number) => { mesh.getMatrixAt(i, m4); const e = m4.elements; return { x: e[0], y: e[5], z: e[10] }; };
const posOf = (mesh: any, i: number) => { mesh.getMatrixAt(i, m4); return v3.setFromMatrixPosition(m4).clone(); };
const shown = (mesh: any, i: number) => { const s = scaleOf(mesh, i); return s.x > 0 && s.y > 0 && s.z > 0; };
const color = new THREE.Color();
const hexOf = (mesh: any, i: number) => { mesh.getColorAt(i, color); return color.getHex(); };
const v$ = (v: VerdigrisDeepView) => v as any;
const step = (view: VerdigrisDeepView, route: any, seconds: number, opts = OPTS) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) view.update(route, DT, opts);
};
const deepFreeze = (o: any): any => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const BAND_COLORS = { calm: 0x2f5d3a, warning: 0xd6f06a, burst: CH.color };

test('altarState: 발견 안 된 제단은 hidden, 점등·정화·정화됐지만 비점등·그 밖은 서로 다르다', () => {
  const route = makeRoute();
  route.gates[1].ready = true; route.gates[3].room.discovered = false;
  expect([0, 1, 2, 3].map(i => altarState(route, i))).toEqual(['lit', 'danger', 'idle', 'hidden']);
  // 정화되면 금색 상태(점등 이동 뒤 앞선 제단), 점등은 다음 제단으로 옮겨 간다.
  route.gates[0].attuned = true; route.progress = 1;
  expect([0, 1, 2].map(i => altarState(route, i))).toEqual(['purified', 'lit', 'idle']);
  // 4/4 뒤에는 점등이 없다.
  for (const g of route.gates) { g.attuned = true; g.room.discovered = true; }
  route.progress = 4;
  expect([0, 1, 2, 3].map(i => altarState(route, i))).toEqual(['purified', 'purified', 'purified', 'purified']);
});

test('altarState: 점등은 route.lit 이 가리키는 gate 만 따른다(길 순서와 다른 제단도 점등될 수 있다)', () => {
  const route = makeRoute();
  const lit = route.gates[2];
  Object.defineProperty(route, 'lit', { get: () => lit });
  expect([0, 1, 2, 3].map(i => altarState(route, i))).toEqual(['idle', 'idle', 'lit', 'idle']);
});

test('bandState·bandColor: 알 수 없는 상태는 calm 이고 burst 색은 정의의 channel.color 이다', () => {
  expect([bandState({ state: 'warning' }), bandState({ state: 'burst' }), bandState({ state: 'calm' }), bandState({ state: 'x' }), bandState(null)])
    .toEqual(['warning', 'burst', 'calm', 'calm', 'calm']);
  expect([bandColor('calm', DEF), bandColor('warning', DEF), bandColor('burst', DEF)]).toEqual([BAND_COLORS.calm, BAND_COLORS.warning, CH.color]);
  expect(bandColor('burst', { channel: { color: 0x123456 } })).toBe(0x123456);
});

test('첫 update 전에는 compile 을 위해 메시를 보이지만 그릴 것이 없고, 첫 update 뒤 숨길 것은 drawCalls 0', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  expect(view.group.name).toBe('TLL_VerdigrisDeep'); expect(scene.children).toContain(view.group);
  expect(view.drawCalls).toBe(7);
  let instanced = 0; scene.traverse(o => { if ((o as any).isInstancedMesh) instanced++; });
  expect(instanced).toBe(7);
  for (const mesh of v.meshes) for (let i = 0; i < mesh.count; i++) expect(shown(mesh, i)).toBe(false);
  for (const g of route.gates) g.room.discovered = false;
  view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('제단 고리: 발견된 방에만, 판정 반지름의 바깥 가장자리로, 바닥보다 위에, 상태 색으로 그린다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  route.gates[1].ready = true; route.gates[3].room.discovered = false;
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => shown(v.ring, i))).toEqual([true, true, true, false]);
  expect(hexOf(v.ring, 0)).toBe(DEF.cueColor); expect(hexOf(v.ring, 1)).toBe(DEF.wrongStep.color); expect(hexOf(v.ring, 2)).toBe(GRAY);
  for (let i = 0; i < 3; i++) {
    const p = posOf(v.ring, i), room = route.gates[i].room;
    expect(p.x).toBeCloseTo(room.x, 4); expect(p.z).toBeCloseTo(room.z, 4);
    expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
  }
  // 고리의 바깥 반지름은 def.radius(유지 판정 원)와 같고 두께는 화면에서 보일 만큼 두껍다.
  v.ring.geometry.computeBoundingBox();
  expect(v.ring.geometry.boundingBox.max.x).toBeCloseTo(DEF.radius, 4);
  const inner = (v.ring.geometry.getAttribute('position') as any);
  let minR = Infinity; for (let k = 0; k < inner.count; k++) minR = Math.min(minR, Math.hypot(inner.getX(k), inner.getZ(k)));
  expect(DEF.radius - minR).toBeGreaterThanOrEqual(.3);
  // 정화되면 금색, 그다음 제단이 점등색이 된다.
  route.gates[0].attuned = true; route.progress = 1; route.gates[3].room.discovered = true;
  view.update(route, DT, OPTS);
  expect([hexOf(v.ring, 0), hexOf(v.ring, 1), hexOf(v.ring, 2), hexOf(v.ring, 3)]).toEqual([GOLD, DEF.cueColor, GRAY, GRAY]);
  view.dispose();
});

test('빛 기둥: 점등된 제단 위에만 서고, 정화하거나 4/4 가 되면 사라진다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => shown(v.beam, i))).toEqual([true, false, false, false]);
  const s = scaleOf(v.beam, 0), p = posOf(v.beam, 0);
  expect(s.y).toBeGreaterThan(4); expect(s.y).toBeLessThan(9);
  expect(p.x).toBeCloseTo(route.gates[0].room.x, 4); expect(p.z).toBeCloseTo(route.gates[0].room.z, 4);
  expect(hexOf(v.ring, 0)).toBe(DEF.cueColor);
  expect(v.beamMat.color.getHex()).toBe(DEF.cueColor);
  // 점등이 발견되지 않은 방이면 기둥도 숨는다.
  route.gates[0].room.discovered = false; view.update(route, DT, OPTS);
  expect(shown(v.beam, 0)).toBe(false);
  route.gates[0].room.discovered = true;
  const done = openRoute(); view.update(done, DT, OPTS);
  expect([0, 1, 2, 3].map(i => shown(v.beam, i))).toEqual([false, false, false, false]);
  view.dispose();
});

test('litMoves 가 바뀌면 새 점등 제단 기둥이 .6초 동안 솟고 옛 기둥은 사라진다(dt 0 은 시간을 진행하지 않는다)', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  const full = scaleOf(v.beam, 0).y;
  route.gates[0].attuned = true; route.progress = 1; route.litMoves = 1;
  view.update(route, 0, OPTS);
  expect(shown(v.beam, 0)).toBe(false);
  expect(shown(v.beam, 1)).toBe(false);   // 막 시작한 솟음은 아직 높이 0
  for (let k = 0; k < 120; k++) view.update(route, 0, OPTS);
  expect(shown(v.beam, 1)).toBe(false);
  step(view, route, .3);
  const mid = scaleOf(v.beam, 1).y;
  expect(mid).toBeGreaterThan(full * .2); expect(mid).toBeLessThan(full * .8);
  step(view, route, .1);
  expect(scaleOf(v.beam, 1).y).toBeGreaterThan(mid);
  step(view, route, .3);
  expect(scaleOf(v.beam, 1).y).toBeCloseTo(full, 4);
  const p = posOf(v.beam, 1);
  expect(p.x).toBeCloseTo(route.gates[1].room.x, 4); expect(p.z).toBeCloseTo(route.gates[1].room.z, 4);
  view.dispose();
});

test('litMoves 가 바뀌어도 reduced 면 기둥이 즉시 선다, 바뀌지 않으면 솟지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, STILL);
  const full = scaleOf(v.beam, 0).y;
  route.gates[0].attuned = true; route.progress = 1; route.litMoves = 1;
  view.update(route, 0, STILL);
  expect(scaleOf(v.beam, 1).y).toBeCloseTo(full, 4);
  // litMoves 가 같은 채 점등 제단만 달라졌다면(예: 뷰가 늦게 만들어진 경우) 솟음 없이 바로 그린다.
  const other = makeRoute({ progress: 2, litMoves: 0 }), ov = new VerdigrisDeepView(scene, other);
  ov.update(other, DT, OPTS);
  expect(scaleOf(v$(ov).beam, 2).y).toBeCloseTo(full, 4);
  view.dispose(); ov.dispose();
});

test('수로: idle 은 숨기고 open·running 에서 띠 4줄·출발선·도착선·출구 고리가 보인다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new VerdigrisDeepView(scene, route), v = v$(view);
  for (const g of route.gates) g.room.discovered = false;
  view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(0);
  for (const phase of ['open', 'running'] as const) {
    const r = openRoute('calm', phase);
    view.update(r, DT, OPTS);
    for (let i = 0; i < 4; i++) expect(shown(v.bands, i)).toBe(true);
    expect(shown(v.lines, 0)).toBe(true); expect(shown(v.lines, 1)).toBe(true); expect(shown(v.exit, 0)).toBe(true);
    // 띠: 폭 2·half, 길이 = 방 maxZ − minZ, 중심 x = band.x, 중심 z = 방 중심, 바닥 위.
    for (let i = 0; i < 4; i++) {
      const s = scaleOf(v.bands, i), p = posOf(v.bands, i);
      expect(s.x).toBeCloseTo(CH.bandHalf * 2, 4); expect(s.z).toBeCloseTo(r.channel.maxZ - r.channel.minZ, 4);
      expect(p.x).toBeCloseTo(r.channel.bands[i].x, 4); expect(p.z).toBeCloseTo(ROOM_CENTER.z, 4);
      expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
    }
    // 출발선·도착선은 방 길이만큼 길고 화면에서 보일 만큼 굵다. 출구 고리는 channel.exit 에 있다.
    for (const [k, x] of [[0, r.channel.startX], [1, r.channel.finishX]] as const) {
      const s = scaleOf(v.lines, k), p = posOf(v.lines, k);
      expect(p.x).toBeCloseTo(x, 4); expect(p.z).toBeCloseTo(ROOM_CENTER.z, 4);
      expect(s.z).toBeCloseTo(r.channel.maxZ - r.channel.minZ, 4); expect(s.x).toBeGreaterThanOrEqual(.4);
      expect(p.y).toBeGreaterThanOrEqual(.08); expect(p.y).toBeLessThanOrEqual(.12);
    }
    const e = posOf(v.exit, 0);
    expect(e.x).toBeCloseTo(r.channel.exit.x, 4); expect(e.z).toBeCloseTo(r.channel.exit.z, 4);
    expect(e.y).toBeGreaterThanOrEqual(.08); expect(e.y).toBeLessThanOrEqual(.12);
    expect(view.drawCalls).toBeGreaterThan(0);
  }
  // 수로가 idle 로 돌아가면 다시 숨는다.
  const idle = openRoute('calm', 'idle'); view.update(idle, DT, OPTS);
  for (let i = 0; i < 4; i++) expect(shown(v.bands, i)).toBe(false);
  expect(shown(v.lines, 0)).toBe(false); expect(shown(v.exit, 0)).toBe(false);
  view.dispose();
});

test('띠 색: calm 어두운 초록 · warning 연노랑 · burst 정의 색, 띠마다 따로 바뀐다', () => {
  const scene = new THREE.Scene(), route = openRoute('calm', 'running'), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => hexOf(v.bands, i))).toEqual([BAND_COLORS.calm, BAND_COLORS.calm, BAND_COLORS.calm, BAND_COLORS.calm]);
  route.channel.bands[0].state = 'burst'; route.channel.bands[1].state = 'warning';
  view.update(route, DT, OPTS);
  expect([0, 1, 2, 3].map(i => hexOf(v.bands, i))).toEqual([BAND_COLORS.burst, BAND_COLORS.warning, BAND_COLORS.calm, BAND_COLORS.calm]);
  view.dispose();
});

test('포자 구슬: burst 띠만 높이 솟고, warning 은 낮은 새싹, calm 은 없다(reduced 도 burst 는 솟은 채 멈춘다)', () => {
  const scene = new THREE.Scene(), route = openRoute('calm', 'running'), view = new VerdigrisDeepView(scene, route), v = v$(view);
  const orbsOf = (band: number) => Array.from({ length: 6 }, (_, k) => band * 6 + k);
  route.channel.bands[0].state = 'burst'; route.channel.bands[0].age = .1;
  route.channel.bands[1].state = 'warning';
  view.update(route, DT, OPTS);
  expect(orbsOf(0).every(i => shown(v.orbs, i))).toBe(true);
  expect(orbsOf(1).every(i => shown(v.orbs, i))).toBe(true);
  expect(orbsOf(2).some(i => shown(v.orbs, i))).toBe(false);
  // 구슬은 자기 띠 폭 안, 방 길이 안에 있다.
  for (const i of orbsOf(0)) {
    const p = posOf(v.orbs, i);
    expect(Math.abs(p.x - route.channel.bands[0].x)).toBeLessThanOrEqual(CH.bandHalf);
    expect(p.z).toBeGreaterThanOrEqual(route.channel.minZ); expect(p.z).toBeLessThanOrEqual(route.channel.maxZ);
  }
  const lowBurst = Math.max(...orbsOf(0).map(i => posOf(v.orbs, i).y));
  const sprout = Math.max(...orbsOf(1).map(i => posOf(v.orbs, i).y));
  route.channel.bands[0].age = .5; view.update(route, DT, OPTS);
  const highBurst = Math.max(...orbsOf(0).map(i => posOf(v.orbs, i).y));
  expect(highBurst).toBeGreaterThan(lowBurst + .5);          // 시간이 갈수록 솟는다
  expect(highBurst).toBeGreaterThan(sprout + 1);              // 새싹과 모양이 뚜렷이 다르다
  // 분출이 끝나 calm 이 되면 구슬이 사라진다.
  route.channel.bands[0].state = 'calm'; view.update(route, DT, OPTS);
  expect(orbsOf(0).some(i => shown(v.orbs, i))).toBe(false);
  // reduced: 시간(age)이 달라도 같은 높이에서 멈춘다.
  const sv = new VerdigrisDeepView(scene, route), s$ = v$(sv);
  route.channel.bands[0].state = 'burst'; route.channel.bands[0].age = .1; sv.update(route, DT, STILL);
  const a = orbsOf(0).map(i => posOf(s$.orbs, i).y);
  route.channel.bands[0].age = .5; sv.update(route, DT, STILL);
  expect(orbsOf(0).map(i => posOf(s$.orbs, i).y)).toEqual(a);
  expect(a.every(y => y > .5)).toBe(true);
  view.dispose(); sv.dispose();
});

test('done: 0.5초 안에 줄어들어 숨고(reduced 는 즉시), 수로를 보지 못한 채 done 이면 바로 숨긴다', () => {
  const scene = new THREE.Scene(), route = openRoute('calm', 'running'), view = new VerdigrisDeepView(scene, route), v = v$(view);
  step(view, route, .2);
  expect(scaleOf(v.bands, 0).z).toBeCloseTo(20, 4);
  route.channel.phase = 'done'; view.update(route, DT, OPTS);
  expect(scaleOf(v.bands, 0).z).toBeGreaterThan(18);          // 막 끝났으니 아직 보인다
  step(view, route, .2);
  const mid = scaleOf(v.bands, 0).z; expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(18);
  step(view, route, .4);
  // 수로 메시는 모두 숨고 제단 고리·받침(4/4 정화 금색)만 남는다.
  for (const mesh of [v.bands, v.orbs, v.lines, v.exit]) expect(mesh.visible).toBe(false);
  expect(view.drawCalls).toBe(2);
  const fast = new VerdigrisDeepView(scene, openRoute('calm', 'running')), f$ = v$(fast);
  const fr = openRoute('calm', 'running');
  fast.update(fr, DT, STILL); expect(shown(f$.bands, 0)).toBe(true);
  fr.channel.phase = 'done'; fast.update(fr, DT, STILL);
  expect(shown(f$.bands, 0)).toBe(false); expect(shown(f$.exit, 0)).toBe(false);
  // 수로를 한 번도 보지 못한 채 done 이면 줄어드는 연출 없이 숨긴다.
  const late = new VerdigrisDeepView(scene, openRoute('calm', 'done')), l$ = v$(late);
  late.update(openRoute('calm', 'done'), DT, OPTS);
  expect(shown(l$.bands, 0)).toBe(false);
  view.dispose(); fast.dispose(); late.dispose();
});

test('dt 0(syncView)과 음수·NaN dt 는 줄어듦 시간을 진행하지 않는다', () => {
  const scene = new THREE.Scene(), route = openRoute('calm', 'running'), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  route.channel.phase = 'done';
  view.update(route, 0, OPTS);
  const z = scaleOf(v.bands, 0).z;
  for (let k = 0; k < 300; k++) view.update(route, 0, OPTS);
  view.update(route, -1, OPTS); view.update(route, NaN, OPTS);
  expect(scaleOf(v.bands, 0).z).toBe(z);
  expect(z).toBeGreaterThan(0);
  view.dispose();
});

test('같은 상태를 반복해 update 해도 행렬·색 업로드 플래그를 올리지 않고 새 버퍼를 만들지 않는다', () => {
  const scene = new THREE.Scene(), route = openRoute('warning', 'running'), view = new VerdigrisDeepView(scene, route), v = v$(view);
  route.channel.bands[2].state = 'burst'; route.channel.bands[2].age = .3;
  view.update(route, DT, OPTS);
  const versions = () => v.meshes.map((m: any) => m.instanceMatrix.version + (m.instanceColor ? m.instanceColor.version : 0));
  const before = versions();
  const refs = [v.meshes.map((m: any) => m.instanceMatrix.array), v.meshes.map((m: any) => m.instanceColor), v.group.children.length];
  step(view, route, 3);
  view.update(route, 0, OPTS);
  expect(versions()).toEqual(before);
  expect(v.meshes.map((m: any) => m.instanceMatrix.array)).toEqual(refs[0]);
  v.meshes.forEach((m: any, k: number) => { expect(m.instanceMatrix.array).toBe(refs[0][k]); expect(m.instanceColor).toBe(refs[1][k]); });
  expect(v.group.children.length).toBe(refs[2]);
  // 반대로 상태가 바뀌면 올린다(위 검사가 의미 있는지 확인).
  route.channel.bands[2].age = .6; view.update(route, DT, OPTS);
  expect(versions()).not.toEqual(before);
  view.dispose();
});

test('뷰는 route 를 읽기만 한다(깊게 얼린 route 로 모든 단계를 update)', () => {
  const scene = new THREE.Scene(), view = new VerdigrisDeepView(scene, makeRoute());
  const base = deepFreeze(makeRoute({ progress: 1, litMoves: 1 }));
  expect(() => step(view, base, .8)).not.toThrow();
  for (const [state, phase] of [['calm', 'open'], ['warning', 'running'], ['burst', 'running'], ['burst', 'done']] as const) {
    const r = deepFreeze(openRoute(state, phase));
    expect(() => step(view, r, .8)).not.toThrow();
  }
  view.dispose();
});

test('drawCalls 는 실제로 보이는 메시 수이고 7 이하이다', () => {
  const scene = new THREE.Scene(), route = openRoute('burst', 'running', .3), view = new VerdigrisDeepView(scene, route);
  const visible = () => { let n = 0; view.group.traverse(o => { if ((o as any).isInstancedMesh && o.visible) n++; }); return n; };
  view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBeGreaterThan(0); expect(view.drawCalls).toBeLessThanOrEqual(7);
  // 제단 고리·받침·구슬·띠·줄·출구는 점등 기둥 없이도 보인다(4/4 뒤 기둥만 빠진다).
  expect(view.drawCalls).toBe(6);
  route.channel.phase = 'idle'; view.update(route, DT, OPTS);
  expect(view.drawCalls).toBe(visible()); expect(view.drawCalls).toBe(2);
  view.group.visible = false; expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('dispose 는 반복해도 안전하고 scene·geometry·material·mesh 를 해제한다', () => {
  const scene = new THREE.Scene(), route = openRoute('burst', 'running', .2), view = new VerdigrisDeepView(scene, route), v = v$(view);
  view.update(route, DT, OPTS);
  let geo = 0, mat = 0, mesh = 0;
  for (const g of v.geometries) g.addEventListener('dispose', () => { geo++; });
  for (const m of v.materials) m.addEventListener('dispose', () => { mat++; });
  for (const m of v.meshes) m.addEventListener('dispose', () => { mesh++; });
  const geometryCount = v.geometries.length, materialCount = v.materials.length;
  expect(scene.children).toContain(view.group);
  view.dispose(); view.dispose();
  expect(mesh).toBe(7); expect(geo).toBe(geometryCount); expect(mat).toBe(materialCount);
  expect(scene.children).not.toContain(view.group);
  expect(view.drawCalls).toBe(0);
  expect(() => view.update(route, DT, OPTS)).not.toThrow();
});
