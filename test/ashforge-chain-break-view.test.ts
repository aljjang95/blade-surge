import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { AshforgeChainBreakView } from '../src/game/ashforge-chain-break-view.js';

// 규칙 코어(AshforgeChainBreak)는 쓰지 않는다. BUNDLE-15 PLAN 3.2 의 읽기 상태만 가진 가짜 컨트롤러로 뷰만 검증한다.
// 정의는 PLAN 3.1 의 ashforge_deep.chains 값이다.
const DEF = { id: 'ashforge_deep_chains', boss: 'ash_colossus', signature: 'kiln_hammer', count: 3, window: 5, hold: 1.2, radius: 1.6,
  pillarOffset: 8.4, anchorMargin: 1.2, exposed: 5, exposedMult: 1.5 };
const OPTS = { reduced: false }, REDUCED = { reduced: true };
const DT = 1 / 60;
const SCALE = 2.2, BODY = .7 * SCALE + .4;

function makeChains(over: any = {}) {
  const boss: any = { pos: new Vector3(4, 0, -2), alive: true, def: { scale: SCALE } };
  return { def: DEF, state: 'chained', boss, count: 3, chainsLeft: 3, pulling: false, pullSide: 0,
    pillar: new Vector3(-4.4, 0, -2), anchor: new Vector3(14, 0, -2), hold: 0, holdTotal: DEF.hold, windowLeft: 0, windowTotal: DEF.window,
    exposedLeft: 0, exposedTotal: DEF.exposed, lastCutT: Infinity, ...over };
}
const pulling = (over: any = {}) => makeChains({ pulling: true, pullSide: 1, ...over });
const open = (over: any = {}) => makeChains({ state: 'open', pullSide: 1, windowLeft: 4, hold: .6, ...over });
const v$ = (v: AshforgeChainBreakView) => v as any;
const drawn = (scene: THREE.Object3D) => { let n = 0; scene.traverse((o: any) => { if (o.isMesh && o.visible) n++; }); return n; };
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes };
}
/** 보이는 마디(폭 배율 > 0)의 위치·크기·색. */
function links(view: AshforgeChainBreakView) {
  const mesh = v$(view).links as THREE.InstancedMesh, a = mesh.instanceMatrix.array, out: { i: number, x: number, y: number, z: number, s: number, hex: number }[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16, s = Math.hypot(a[o], a[o + 1], a[o + 2]);
    if (s <= 0) continue;
    mesh.getColorAt(i, color);
    out.push({ i, x: a[o + 12], y: a[o + 13], z: a[o + 14], s, hex: color.getHex() });
  }
  return out;
}
const fresh = (c: any = makeChains()) => { const scene = new THREE.Scene(); return { scene, chains: c, view: new AshforgeChainBreakView(scene, c) }; };
const step = (view: AshforgeChainBreakView, c: any, seconds: number, opts = OPTS) => { for (let t = 0; t < seconds - 1e-9; t += DT) view.update(c, DT, opts); };

test('메시 이름·개수·draw call 예산(≤ 3)이 계약대로다', () => {
  const { scene, chains, view } = fresh(open());
  const v = v$(view);
  expect(v.links.name).toBe('TLL_AshforgeChainLinks'); expect(v.links.isInstancedMesh).toBe(true);
  expect(v.ring.name).toBe('TLL_AshforgeChainPillar'); expect(v.fill.name).toBe('TLL_AshforgeChainPillarFill');
  expect(census(scene).meshes).toBe(3); expect(view.count).toBe(36); expect(v.links.count).toBe(36);
  const seen = new Set<number>();
  for (const c of [makeChains(), pulling(), open(), open({ hold: 0 }), makeChains({ state: 'exposed', lastCutT: .1, chainsLeft: 2 }), makeChains({ state: 'idle' })]) {
    view.update(c, DT, OPTS); seen.add(view.drawCalls); expect(view.drawCalls).toBeLessThanOrEqual(3);
    expect(drawn(scene)).toBe(view.drawCalls);
  }
  expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  void chains; view.dispose();
});

test('idle·unchained·ended·보스 없음·보스 사망이면 전부 숨기고 마디 scale 은 0 이다', () => {
  const { scene, view } = fresh();
  view.update(open(), DT, OPTS); expect(links(view).length).toBeGreaterThan(0); expect(drawn(scene)).toBe(3);
  for (const state of ['idle', 'unchained', 'ended']) {
    view.update(open(), DT, OPTS);
    view.update(makeChains({ state }), DT, OPTS);
    expect(drawn(scene)).toBe(0); expect(links(view)).toHaveLength(0);
  }
  const dead = open(); dead.boss.alive = false; view.update(dead, DT, OPTS); expect(drawn(scene)).toBe(0); expect(links(view)).toHaveLength(0);
  view.update(open(), DT, OPTS); expect(drawn(scene)).toBe(3);
  view.update(open({ boss: null }), DT, OPTS); expect(drawn(scene)).toBe(0);
  view.update(open({ boss: { alive: true, def: { scale: 2 } } }), DT, OPTS); expect(drawn(scene)).toBe(0);
  expect(() => view.update(null, DT, OPTS)).not.toThrow(); expect(drawn(scene)).toBe(0);
  view.dispose();
});

test('chained(끌기 없음): 남은 사슬이 보스 둘레 바닥에서 방사로 짧게 늘어지고 철색이다', () => {
  const { view, chains } = fresh(makeChains({ chainsLeft: 3 }));
  view.update(chains, DT, REDUCED);
  const list = links(view), boss = chains.boss.pos;
  expect(list).toHaveLength(15);
  for (const l of list) {
    const r = Math.hypot(l.x - boss.x, l.z - boss.z);
    expect(r).toBeGreaterThanOrEqual(BODY - 1e-6); expect(r).toBeLessThan(BODY + 3.2);
    expect(l.hex).toBe(0x5a5048); expect(l.y).toBeGreaterThanOrEqual(.08);
  }
  // 사슬 3가닥이 서로 다른 방향으로 놓인다.
  const angles = new Set<number>();
  for (let k = 0; k < 3; k++) { const l = list[k * 5]; angles.add(Math.round(Math.atan2(l.z - boss.z, l.x - boss.x) * 10)); }
  expect(angles.size).toBe(3);
  // 남은 사슬 수만큼만 보인다.
  chains.chainsLeft = 2; view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(10);
  chains.chainsLeft = 1; view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(5);
  chains.chainsLeft = 0; view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(0); expect(view.drawCalls).toBe(0);
  view.dispose();
});

test('늘어진 사슬 반지름은 보스 크기(0.7×scale + .4)를 따라간다', () => {
  const { view, chains } = fresh(makeChains({ chainsLeft: 1 }));
  view.update(chains, DT, REDUCED);
  const near = Math.min(...links(view).map(l => Math.hypot(l.x - chains.boss.pos.x, l.z - chains.boss.pos.z)));
  chains.boss.def.scale = 3; view.update(chains, DT, REDUCED);
  const far = Math.min(...links(view).map(l => Math.hypot(l.x - chains.boss.pos.x, l.z - chains.boss.pos.z)));
  expect(far - near).toBeGreaterThan(.7 * .8 - .3);
  expect(far).toBeGreaterThanOrEqual(.7 * 3 + .4 - 1e-6);
  chains.boss.def = undefined; view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(5);
  view.dispose();
});

test('끌기: 사슬이 보스 → anchor 직선을 따라 anchor 쪽으로 뻗고 달군 붉은색이며 회색 기둥이 pillar 에 선다', () => {
  const { scene, view, chains } = fresh(pulling());
  view.update(chains, DT, REDUCED);
  const list = links(view), boss = chains.boss.pos, anchor = chains.anchor, v = v$(view);
  const len = Math.hypot(anchor.x - boss.x, anchor.z - boss.z);
  expect(list.length).toBeGreaterThan(15);
  for (const l of list) {
    const along = (l.x - boss.x) * 1 + (l.z - boss.z) * 0;   // anchor 가 +x 쪽
    expect(along).toBeGreaterThan(BODY - .8); expect(along).toBeLessThan(len);
    expect(l.hex).toBe(0xc0452a); expect(l.y).toBeGreaterThanOrEqual(.08);
  }
  // 세 가닥은 나란한 세 줄(z 간격 1.1)이다.
  const lanes = new Set(list.map(l => Math.round((l.z - boss.z) * 10)));
  expect([...lanes].sort((a, b) => a - b)).toEqual([-11, 0, 11]);
  // 가장 먼 마디는 anchor 쪽 끝 가까이에 있다.
  expect(Math.max(...list.map(l => l.x))).toBeGreaterThan(anchor.x - 1.5);
  expect(v.ring.visible).toBe(true); expect(v.fill.visible).toBe(false);
  expect([v.ring.position.x, v.ring.position.z]).toEqual([chains.pillar.x, chains.pillar.z]);
  expect(v.ringMat.color.getHex()).toBe(0x6d7a86);
  expect(drawn(scene)).toBe(2);
  // anchor 가 반대편(−x)이면 선도 −x 쪽으로 뻗는다.
  chains.pullSide = -1; chains.anchor.set(-9, 0, -2); view.update(chains, DT, REDUCED);
  expect(Math.max(...links(view).map(l => l.x))).toBeLessThanOrEqual(boss.x);
  expect(Math.min(...links(view).map(l => l.x))).toBeLessThan(-6);
  view.dispose();
});

test('끌기·열림 선의 마디 수는 길이에 비례하고 사슬당 최대 12 이다', () => {
  const { view, chains } = fresh(pulling());
  const total = (x: number) => { chains.anchor.set(x, 0, -2); view.update(chains, DT, REDUCED); return links(view).length; };
  const near = total(7), mid = total(9), far = total(13), huge = total(60);
  expect(near).toBeLessThan(mid); expect(mid).toBeLessThan(far);
  expect(near % 3).toBe(0); expect(far).toBeLessThanOrEqual(36); expect(huge).toBe(36);
  chains.chainsLeft = 1; chains.anchor.set(60, 0, -2); view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(12);
  // anchor 가 보스 위치와 겹쳐도 깨지지 않는다.
  chains.anchor.copy(chains.boss.pos); expect(() => view.update(chains, DT, REDUCED)).not.toThrow();
  for (const l of links(view)) expect(Number.isFinite(l.x + l.y + l.z + l.s)).toBe(true);
  view.dispose();
});

test('끌기 중이어도 anchor·pillar 가 없으면 늘어진 사슬로 그리고 기둥은 숨긴다', () => {
  const { view, chains } = fresh(pulling({ anchor: null }));
  view.update(chains, DT, REDUCED);
  expect(links(view)).toHaveLength(15); expect(links(view)[0].hex).toBe(0x5a5048); expect(v$(view).ring.visible).toBe(false);
  view.dispose();
});

test('열림: 같은 선이 금빛이 되고 기둥은 청록으로 열린다', () => {
  const { view, chains } = fresh(pulling());
  view.update(chains, DT, REDUCED); const before = links(view).map(l => [l.x, l.z]);
  const o = open(); o.anchor = chains.anchor; o.pillar = chains.pillar; o.boss = chains.boss;
  view.update(o, DT, REDUCED);
  const after = links(view);
  expect(after.map(l => [l.x, l.z])).toEqual(before);
  for (const l of after) expect(l.hex).toBe(0xffb060);
  const v = v$(view);
  expect(v.ringMat.color.getHex()).toBe(0x5ff0d0); expect(v.fill.visible).toBe(true);
  view.update(pulling({ anchor: chains.anchor, pillar: chains.pillar, boss: chains.boss }), DT, REDUCED);
  for (const l of links(view)) expect(l.hex).toBe(0xc0452a);
  expect(v.ringMat.color.getHex()).toBe(0x6d7a86); expect(v.fill.visible).toBe(false);
  view.dispose();
});

test('채움 원판은 hold/holdTotal 에 비례해 커지고 0 이면 숨겨 테두리만 남는다', () => {
  const { view, chains } = fresh(open({ hold: 0 }));
  const v = v$(view);
  view.update(chains, DT, REDUCED);
  expect(v.fill.visible).toBe(false); expect(v.ring.visible).toBe(true);
  const sizes: number[] = [], alphas: number[] = [];
  for (const h of [.3, .6, .9, 1.2]) { chains.hold = h; view.update(chains, DT, REDUCED); sizes.push(v.fill.scale.x); alphas.push(v.fillMat.opacity); expect(v.fill.visible).toBe(true); }
  for (let i = 1; i < 4; i++) { expect(sizes[i]).toBeGreaterThan(sizes[i - 1]); expect(alphas[i]).toBeGreaterThan(alphas[i - 1]); }
  expect(sizes[3]).toBeCloseTo(1, 6); expect(sizes[1] / sizes[3]).toBeCloseTo(.5, 6); expect(v.fill.scale.z).toBe(v.fill.scale.x);
  chains.hold = 5; view.update(chains, DT, REDUCED); expect(v.fill.scale.x).toBe(1);
  chains.hold = -1; view.update(chains, DT, REDUCED); expect(v.fill.visible).toBe(false);
  chains.hold = NaN; expect(() => view.update(chains, DT, REDUCED)).not.toThrow(); expect(v.fill.visible).toBe(false);
  // 가득 찬 원판도 고리 안쪽에 들어가고 같은 중심이다.
  chains.hold = 1.2; view.update(chains, DT, REDUCED);
  v.fill.updateMatrixWorld(true); v.ring.updateMatrixWorld(true);
  const fillMax = (() => { const p = v.fill.geometry.getAttribute('position'); let m = 0; for (let i = 0; i < p.count; i++) m = Math.max(m, Math.hypot(p.getX(i), p.getZ(i))); return m * v.fill.scale.x; })();
  expect(fillMax).toBeLessThan(DEF.radius); expect([v.fill.position.x, v.fill.position.z]).toEqual([v.ring.position.x, v.ring.position.z]);
  view.dispose();
});

test('기둥 고리의 바깥 반지름은 def.radius 이고 높이는 .08 이상이다', () => {
  const { view, chains } = fresh(open());
  const v = v$(view); view.update(chains, DT, REDUCED);
  const p = v.ring.geometry.getAttribute('position'); let outer = 0, inner = Infinity, maxY = 0;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); outer = Math.max(outer, r); inner = Math.min(inner, r); maxY = Math.max(maxY, Math.abs(p.getY(i))); }
  expect(outer).toBeCloseTo(DEF.radius, 5); expect(inner).toBeLessThan(outer); expect(maxY).toBeLessThan(1e-9);
  expect(v.ring.position.y).toBeGreaterThanOrEqual(.08); expect(v.fill.position.y).toBeGreaterThanOrEqual(.08);
  const wide = fresh(open({ def: { ...DEF, radius: 2.4 } })); wide.view.update(wide.chains, DT, REDUCED);
  const q = v$(wide.view).ring.geometry.getAttribute('position'); let o2 = 0; for (let i = 0; i < q.count; i++) o2 = Math.max(o2, Math.hypot(q.getX(i), q.getZ(i)));
  expect(o2).toBeCloseTo(2.4, 5);
  const none = fresh(open({ def: undefined })); none.view.update(none.chains, DT, REDUCED); expect(drawn(none.scene)).toBe(3);
  for (const l of links(view)) expect(l.y).toBeGreaterThanOrEqual(.08);
  view.dispose(); wide.view.dispose(); none.view.dispose();
});

test('exposed: 남은 사슬은 늘어지고 기둥은 숨긴다. 끊긴 사슬 하나가 .6초 동안 떨어지며 작아진다', () => {
  const { scene, view, chains } = fresh(makeChains({ state: 'exposed', chainsLeft: 2, lastCutT: 0, exposedLeft: 5 }));
  const v = v$(view);
  view.update(chains, DT, OPTS);
  expect(links(view)).toHaveLength(15); expect(v.ring.visible).toBe(false); expect(v.fill.visible).toBe(false); expect(drawn(scene)).toBe(1);
  const sizeAt = (t: number) => { chains.lastCutT = t; view.update(chains, DT, OPTS); return links(view).filter(l => l.i >= 10); };
  const a = sizeAt(0), b = sizeAt(.3), c = sizeAt(.55);
  expect(a).toHaveLength(5); expect(b).toHaveLength(5); expect(c).toHaveLength(5);
  expect(b[0].s).toBeLessThan(a[0].s); expect(c[0].s).toBeLessThan(b[0].s);
  expect(b[0].y).toBeLessThan(a[0].y); expect(c[0].y).toBeLessThan(b[0].y);
  for (const l of [...a, ...b, ...c]) expect(l.y).toBeGreaterThanOrEqual(.08);
  // .6초가 지나면 사라지고 남은 두 가닥만 보인다.
  chains.lastCutT = .6; view.update(chains, DT, OPTS); expect(links(view)).toHaveLength(10);
  chains.lastCutT = 3; view.update(chains, DT, OPTS); expect(links(view)).toHaveLength(10);
  chains.lastCutT = Infinity; view.update(chains, DT, OPTS); expect(links(view)).toHaveLength(10);
  // 남은 사슬이 없는 마지막 끊김에서도 떨어지는 사슬만 보인다.
  chains.chainsLeft = 0; chains.lastCutT = .2; view.update(chains, DT, OPTS); expect(links(view)).toHaveLength(5);
  chains.chainsLeft = 3; chains.lastCutT = .2; view.update(chains, DT, OPTS); expect(links(view)).toHaveLength(15);
  view.dispose();
});

test('reduced 면 끊김 연출 없이 즉시 숨기고 흔들림도 없다', () => {
  const { view, chains } = fresh(makeChains({ state: 'exposed', chainsLeft: 2, lastCutT: .1, exposedLeft: 5 }));
  view.update(chains, DT, REDUCED); expect(links(view)).toHaveLength(10);
  const snap = Array.from(v$(view).links.instanceMatrix.array as Float32Array);
  for (let i = 0; i < 120; i++) view.update(chains, DT, REDUCED);
  expect(Array.from(v$(view).links.instanceMatrix.array as Float32Array)).toEqual(snap);
  const p = pulling(); view.update(p, DT, REDUCED); const taut = Array.from(v$(view).links.instanceMatrix.array as Float32Array);
  for (let i = 0; i < 60; i++) view.update(p, DT, REDUCED);
  expect(Array.from(v$(view).links.instanceMatrix.array as Float32Array)).toEqual(taut);
  const o = open(); view.update(o, DT, REDUCED); const opac = v$(view).ringMat.opacity;
  for (let i = 0; i < 60; i++) { view.update(o, DT, REDUCED); expect(v$(view).ringMat.opacity).toBe(opac); }
  view.dispose();
});

test('일반 모드의 흔들림은 게임 dt 로만 진행하고 dt 0 이면 멈춘다', () => {
  const { view, chains } = fresh(pulling());
  const snap = () => Array.from(v$(view).links.instanceMatrix.array as Float32Array);
  view.update(chains, 0, OPTS); const first = snap();
  view.update(chains, 0, OPTS); view.update(chains, -1, OPTS); view.update(chains, NaN, OPTS);
  expect(snap()).toEqual(first);
  view.update(chains, DT, OPTS); const moved = snap(); expect(moved).not.toEqual(first);
  view.update(chains, 0, OPTS); expect(snap()).toEqual(moved);
  // 같은 dt 열은 같은 결과(결정적)다.
  const twin = fresh(pulling()); twin.view.update(twin.chains, 0, OPTS); twin.view.update(twin.chains, DT, OPTS);
  expect(Array.from(v$(twin.view).links.instanceMatrix.array as Float32Array)).toEqual(moved);
  // 늘어진 사슬도 시간에 따라 조금 움직인다.
  const slack = fresh(makeChains()); slack.view.update(slack.chains, DT, OPTS); const s1 = Array.from(v$(slack.view).links.instanceMatrix.array as Float32Array);
  step(slack.view, slack.chains, 1); expect(Array.from(v$(slack.view).links.instanceMatrix.array as Float32Array)).not.toEqual(s1);
  view.dispose(); twin.view.dispose(); slack.view.dispose();
});

test('재질은 사슬만 불투명이고 기둥은 투명·depthWrite false, 그리기 순서가 빌보드(11)보다 앞이다', () => {
  const { view } = fresh(open()), v = v$(view);
  expect(v.links.material.transparent).toBe(false);
  for (const mesh of [v.ring, v.fill]) {
    expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBeGreaterThan(9); expect(mesh.renderOrder).toBeLessThan(11);
  }
  expect(v.ring.renderOrder).toBeGreaterThan(v.fill.renderOrder);
  view.dispose();
});

test('첫 update 전에는 사슬 메시가 컴파일용으로 보이지만 그릴 마디는 없고 첫 update 가 숨긴다', () => {
  const { scene, view } = fresh(makeChains({ state: 'idle' }));
  expect(v$(view).links.visible).toBe(true); expect(view.drawCalls).toBe(0); expect(links(view)).toHaveLength(0);
  view.update(makeChains({ state: 'idle' }), DT, OPTS); expect(drawn(scene)).toBe(0);
  view.dispose();
});

test('update 는 새 객체를 만들지 않고 geometry·material·mesh·버퍼 참조를 유지한다', () => {
  const { scene, view, chains } = fresh(open()), v = v$(view);
  const before = census(scene), children = scene.children.length + v.group.children.length;
  const pick = () => [v.links, v.ring, v.fill, v.ring.position, v.fill.position, v.fill.scale, v.links.geometry, v.ring.geometry, v.fill.geometry,
    v.linkMat, v.ringMat, v.fillMat, v.ringMat.color, v.fillMat.color, v.links.instanceMatrix, v.links.instanceMatrix.array, v.links.instanceColor, v.links.instanceColor.array,
    v.group, ...v.linkColors, ...v.pillarColors];
  const refs = pick();
  const states = ['chained', 'chained', 'open', 'exposed', 'unchained', 'idle', 'ended', 'open'];
  for (let i = 0; i < 400; i++) {
    chains.state = states[i % states.length]; chains.pulling = i % 3 === 0; chains.chainsLeft = i % 4; chains.hold = (i % 13) / 10;
    chains.lastCutT = i % 5 === 0 ? (i % 7) / 10 : Infinity; chains.boss.pos.x = i * .1; chains.boss.alive = i % 9 !== 0;
    chains.boss.def.scale = 1 + (i % 4); chains.anchor.x = 3 + (i % 17);
    view.update(chains, i % 6 === 0 ? 0 : DT, i % 11 === 0 ? REDUCED : OPTS);
    expect(census(scene)).toEqual(before); expect(scene.children.length + v.group.children.length).toBe(children);
    expect(view.drawCalls).toBeLessThanOrEqual(3);
  }
  expect(pick().every((o, i) => o === refs[i])).toBe(true);
  view.dispose();
});

test('dispose 는 scene 에서 제거하고 geometry·material 을 한 번씩 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const { scene, view, chains } = fresh(open());
  const items: any[] = [];
  scene.traverse((o: any) => { if (o.isMesh) items.push(o.geometry, o.material); });
  expect(scene.children).toHaveLength(1); expect(items).toHaveLength(6);
  const disposed = new Map<any, number>();
  for (const item of items) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  view.update(chains, DT, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()]).toEqual([1, 1, 1, 1, 1, 1]);
  expect(() => view.update(chains, DT, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0); expect(view.drawCalls).toBe(0); expect(view.count).toBe(0);
});
