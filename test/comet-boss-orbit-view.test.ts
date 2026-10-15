import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { CometBossOrbitView } from '../src/game/comet-boss-orbit-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult, cometBossOrbitResultLine } from '../src/expansion/hub.jsx';

// rules lane 의 컨트롤러(src/game/comet-boss-orbit.js)는 쓰지 않는다. BUNDLE-06 PLAN 3.1 의 읽기 getter 를 흉내 낸 가짜 orbit 으로 뷰·목표창·결과 줄을 검증한다.
const BOSS = ROUTE_OBJECTIVES.comet_standard.boss;
const OPTS = { reduced: false };

function makeOrbit(over: any = {}) {
  return { def: BOSS, state: 'warn', kind: 'outer', warnLeft: BOSS.warning, warnTotal: BOSS.warning, center: new Vector3(12, 0, -7), ...over };
}
const view$ = (v: CometBossOrbitView) => v as any;
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes };
}
const drawn = (scene: THREE.Object3D) => { let n = 0; scene.traverse((o: any) => { if (o.isMesh && o.visible) n++; }); return n; };
const vis = (v: any) => [v.line.visible, v.outer.visible, v.center.visible];

test('상태별 메시 가시성: idle·armed·warn outer·warn center·ended', () => {
  const scene = new THREE.Scene(), orbit: any = makeOrbit({ state: 'idle', kind: null, warnLeft: 0 }), view = new CometBossOrbitView(scene, orbit), v = view$(view);
  view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([false, false, false]); expect(drawn(scene)).toBe(0);
  orbit.state = 'armed'; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([true, false, false]); expect(drawn(scene)).toBe(1);
  orbit.state = 'warn'; orbit.kind = 'outer'; orbit.warnLeft = 1; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([true, true, false]); expect(drawn(scene)).toBe(2);
  orbit.kind = 'center'; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([true, false, true]); expect(drawn(scene)).toBe(2);
  // 예고 종류가 비어 있으면 궤도선만 보인다.
  orbit.kind = null; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([true, false, false]);
  orbit.state = 'ended'; orbit.kind = null; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([false, false, false]);
  orbit.state = 'armed'; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([true, false, false]);
  // 중심 좌표가 없으면 그리지 않는다.
  orbit.center = null; view.update(orbit, 1 / 60, OPTS); expect(vis(v)).toEqual([false, false, false]);
  view.dispose();
});

test('위치는 orbit.center 를 따르고 바닥 표식 층(renderOrder 10~11 미만)에 그린다', () => {
  const scene = new THREE.Scene(), orbit: any = makeOrbit(), view = new CometBossOrbitView(scene, orbit), v = view$(view);
  view.update(orbit, 1 / 60, OPTS);
  expect([v.group.position.x, v.group.position.z]).toEqual([12, -7]);
  orbit.center.set(-3, 0, 20); view.update(orbit, 1 / 60, OPTS); expect([v.group.position.x, v.group.position.z]).toEqual([-3, 20]);
  for (const mesh of [v.line, v.outer, v.center]) {
    expect(mesh.renderOrder).toBeGreaterThanOrEqual(10); expect(mesh.renderOrder).toBeLessThan(11);
    expect(mesh.position.y).toBeGreaterThan(0); expect(mesh.position.y).toBeLessThan(.2);
    expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false);
  }
  // 궤도선이 붉은 예고 위에 그려진다.
  expect(v.line.renderOrder).toBeGreaterThan(v.outer.renderOrder); expect(v.line.renderOrder).toBeGreaterThan(v.center.renderOrder);
  expect(v.lineMat.color.getHex()).toBe(0x82bfff);
  expect(v.outerMat.color.getHex()).toBe(0xff4a3a); expect(v.centerMat.color.getHex()).toBe(0xff4a3a);
  view.dispose();
});

test('링·원판 반지름은 판정 영역(def 값)과 같고 궤도선 두께는 safe 를 넘지 않는다', () => {
  const scene = new THREE.Scene(), view = new CometBossOrbitView(scene, makeOrbit()), v = view$(view);
  const radii = (geometry: THREE.BufferGeometry) => {
    const p = geometry.getAttribute('position'); let min = Infinity, max = 0;
    for (let i = 0; i < p.count; i++) {
      // 바닥에 눕힌 geometry 라 y 는 0 이다. 중심 정점(반지름 0)은 최솟값에서 제외하지 않고 그대로 센다.
      expect(Math.abs(p.getY(i))).toBeLessThan(1e-6);
      const r = Math.hypot(p.getX(i), p.getZ(i)); min = Math.min(min, r); max = Math.max(max, r);
    }
    return { min, max };
  };
  const line = radii(v.line.geometry), outer = radii(v.outer.geometry), center = radii(v.center.geometry);
  expect(line.max).toBeCloseTo(BOSS.safe, 5); expect(line.min).toBeLessThan(BOSS.safe); expect(line.min).toBeGreaterThanOrEqual(BOSS.safe - .12 - 1e-6);
  expect(line.max).toBeLessThanOrEqual(BOSS.safe + 1e-6);
  expect(outer.min).toBeCloseTo(BOSS.outerMin, 5); expect(outer.max).toBeCloseTo(BOSS.outerMax, 5);
  expect(center.min).toBeCloseTo(0, 5); expect(center.max).toBeCloseTo(BOSS.safe, 5);
  view.dispose();
  // def 를 바꾸면 모양도 따라간다(하드코딩 아님).
  const view2 = new CometBossOrbitView(new THREE.Scene(), makeOrbit({ def: { ...BOSS, safe: 4, outerMin: 4.6, outerMax: 7 } })), w = view$(view2);
  expect(radii(w.line.geometry).max).toBeCloseTo(4, 5); expect(radii(w.outer.geometry)).toEqual({ min: expect.closeTo(4.6, 5), max: expect.closeTo(7, 5) });
  expect(radii(w.center.geometry).max).toBeCloseTo(4, 5);
  view2.dispose();
});

test('예고 불투명도는 warnLeft 가 줄수록 단조 증가하고 시작 순간에도 보이며 1 을 넘지 않는다', () => {
  for (const [kind, matKey] of [['outer', 'outerMat'], ['center', 'centerMat']] as const) {
    for (const reduced of [true, false]) {
      const scene = new THREE.Scene(), orbit: any = makeOrbit({ kind }), view = new CometBossOrbitView(scene, orbit), v = view$(view);
      const alphas: number[] = [];
      for (const left of [1.4, 1.1, .8, .5, .2, .01]) { orbit.warnLeft = left; view.update(orbit, 1 / 60, { reduced }); alphas.push(v[matKey].opacity); }
      for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
      expect(alphas[0]).toBeGreaterThanOrEqual(.15); expect(alphas[alphas.length - 1]).toBeLessThanOrEqual(1);
      // 범위 밖·비정상 값도 안전하다.
      for (const left of [-1, 99, NaN]) { orbit.warnLeft = left; view.update(orbit, 1 / 60, { reduced }); expect(v[matKey].opacity).toBeGreaterThan(0); expect(v[matKey].opacity).toBeLessThanOrEqual(1); }
      orbit.warnLeft = 99; orbit.warnTotal = 0; view.update(orbit, 1 / 60, { reduced }); expect(Number.isFinite(v[matKey].opacity)).toBe(true);
      view.dispose();
    }
  }
});

test('reduced 면 맥동이 없고 일반 모드에서는 궤도선 불투명도가 시간에 따라 변한다', () => {
  const orbit: any = makeOrbit({ state: 'armed', kind: null, warnLeft: 0 });
  const still = new CometBossOrbitView(new THREE.Scene(), orbit), s = view$(still);
  still.update(orbit, 1 / 60, { reduced: true }); const first = s.lineMat.opacity;
  for (let i = 0; i < 90; i++) { still.update(orbit, 1 / 60, { reduced: true }); expect(s.lineMat.opacity).toBe(first); }
  const live = new CometBossOrbitView(new THREE.Scene(), orbit), l = view$(live), seen = new Set<number>();
  for (let i = 0; i < 60; i++) { live.update(orbit, 1 / 60, OPTS); seen.add(l.lineMat.opacity); expect(l.lineMat.opacity).toBeLessThanOrEqual(1); }
  expect(seen.size).toBeGreaterThan(5);
  still.dispose(); live.dispose();
});

test('update 는 새 객체를 만들지 않고 geometry·material·mesh 참조와 scene 구성을 유지한다', () => {
  const scene = new THREE.Scene(), orbit: any = makeOrbit(), view = new CometBossOrbitView(scene, orbit), v = view$(view);
  const before = census(scene), children = scene.children.length;
  const refs = [v.group, v.line, v.outer, v.center, v.group.position, v.line.geometry, v.outer.geometry, v.center.geometry, v.lineMat, v.outerMat, v.centerMat];
  for (let i = 0; i < 400; i++) {
    orbit.state = ['idle', 'armed', 'warn', 'warn', 'ended'][i % 5]; orbit.kind = i % 2 ? 'outer' : 'center'; orbit.warnLeft = (i % 15) / 10;
    view.update(orbit, 1 / 60, i % 7 === 0 ? { reduced: true } : OPTS);
    expect(census(scene)).toEqual(before); expect(scene.children.length).toBe(children);
    expect(drawn(scene)).toBeLessThanOrEqual(2);
  }
  expect([v.group, v.line, v.outer, v.center, v.group.position, v.line.geometry, v.outer.geometry, v.center.geometry, v.lineMat, v.outerMat, v.centerMat].every((o, i) => o === refs[i])).toBe(true);
  expect(before.meshes).toBe(3);
  view.dispose();
});

test('dispose 는 scene 에서 제거하고 geometry·material 을 한 번씩 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const scene = new THREE.Scene(), orbit: any = makeOrbit(), view = new CometBossOrbitView(scene, orbit);
  const items: any[] = [];
  scene.traverse((o: any) => { if (o.isMesh) items.push(o.geometry, o.material); });
  expect(scene.children).toHaveLength(1); expect(items).toHaveLength(6);
  const disposed = new Map<any, number>();
  for (const item of items) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  view.update(orbit, 1 / 60, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()]).toEqual([1, 1, 1, 1, 1, 1]);
  expect(() => view.update(orbit, 1 / 60, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0);
});

// ---- 목표창 ----
function realWorld(depth: 'standard' | 'deep') {
  return buildExpeditionWorld(buildExpeditionStage('dungeon', 'comet_bastion', null, { depth }));
}
function makeRoute(kind: 'orbits' | 'deep-orbits', orbit: any, over: any = {}) {
  const def = kind === 'orbits' ? ROUTE_OBJECTIVES.comet_standard : ROUTE_OBJECTIVES.comet_deep;
  const world: any = realWorld(kind === 'orbits' ? 'standard' : 'deep'); world.sealed = true;
  const gates = def.gates.map((spec: any, index: number) => {
    const room = world.rooms.find((r: any) => r.id === spec.roomId); room.discovered = true;
    return { room, label: spec.label, index, phase: 'locked', ready: false, warn: null, center: new Vector3(room.x, 0, room.z) };
  });
  return { def, world, gates, closed: false, progress: 1, current: null, offBy: () => 12, bossOrbit: orbit, ...over } as any;
}
const panel = (route: any) => battleObjectiveView({ world: route.world, routeObjectives: route });
const KINDS = ['orbits', 'deep-orbits'] as const;

test('목표창: armed 는 푸른 궤도선 단계와 안내 문구를 보이고 hold 를 비운다', () => {
  for (const kind of KINDS) {
    const route = makeRoute(kind, makeOrbit({ state: 'armed', kind: null, warnLeft: 0 }));
    expect(panel(route)).toMatchObject({ title: '푸른 궤도선', action: '평소 유성은 푸른 선 바깥 · 중심 유성 예고 땐 선 밖으로',
      hold: 0, holdTotal: 0, progress: 0, total: 0, roomId: route.world.bossRoom.id });
  }
});

test('목표창: warn 은 바깥·중심 문구에 남은 시간을 0.1초 올림으로 보이고 hold/holdTotal 을 채운다', () => {
  for (const kind of KINDS) {
    const orbit: any = makeOrbit({ state: 'warn', kind: 'outer', warnLeft: 1.4 });
    const route = makeRoute(kind, orbit), roomId = route.world.bossRoom.id;
    expect(panel(route)).toMatchObject({ title: '푸른 궤도선', action: '바깥 유성 1.4초 · 푸른 선 안쪽으로', hold: 1.4, holdTotal: BOSS.warning, roomId });
    orbit.warnLeft = 1.25; expect(panel(route)).toMatchObject({ action: '바깥 유성 1.3초 · 푸른 선 안쪽으로', hold: 1.25, holdTotal: 1.4 });
    orbit.warnLeft = .01; expect(panel(route).action).toBe('바깥 유성 0.1초 · 푸른 선 안쪽으로');
    orbit.warnLeft = 1; expect(panel(route).action).toBe('바깥 유성 1.0초 · 푸른 선 안쪽으로');
    orbit.kind = 'center'; orbit.warnLeft = 1.25;
    expect(panel(route)).toMatchObject({ title: '푸른 궤도선', action: '중심 유성 1.3초 · 푸른 선 밖으로', hold: 1.25, holdTotal: 1.4, roomId });
    orbit.warnLeft = 0.7; expect(panel(route).action).toBe('중심 유성 0.7초 · 푸른 선 밖으로');
  }
});

test('목표창: 모든 고리가 끝나 route 가 닫혀도 보스 궤도가 armed·warn 이면 푸른 궤도선을 보인다', () => {
  for (const kind of KINDS) {
    const route = makeRoute(kind, makeOrbit({ state: 'warn', kind: 'center', warnLeft: .5 }), { closed: true, progress: 99 });
    route.progress = route.gates.length;
    expect(panel(route)).toMatchObject({ title: '푸른 궤도선', action: '중심 유성 0.5초 · 푸른 선 밖으로' });
  }
});

test('목표창: idle·ended·보스 궤도 없음이면 기존 고리 단계 문구 그대로다', () => {
  for (const kind of KINDS) {
    const base = panel(makeRoute(kind, undefined));
    expect(base.title).toBe(kind === 'orbits' ? '궤도 고리 정렬' : '궤도 고리 연결');
    for (const state of ['idle', 'ended']) expect(panel(makeRoute(kind, makeOrbit({ state })))).toEqual(base);
    expect(panel(makeRoute(kind, null))).toEqual(base);
  }
  // 고리를 모두 끝냈으면 보스 단계 문구로 돌아간다.
  const done = makeRoute('orbits', makeOrbit({ state: 'ended' })); done.closed = true;
  expect(panel(done).title).toBe('보스 봉인 해제');
});

test('목표창 회귀: 기존 orbits·deep-orbits 단계 문구가 바뀌지 않는다', () => {
  const idle = makeOrbit({ state: 'idle' });
  const orbits = makeRoute('orbits', idle), g = orbits.gates[1];
  orbits.progress = 1; orbits.current = g;
  expect(panel(orbits)).toMatchObject({ title: '궤도 고리 정렬', action: '이 구역의 적을 먼저 처치', progress: 1, total: 4, roomId: g.room.id });
  g.ready = true; expect(panel(orbits).action).toBe('룬석을 밀어 별에 맞추기 · 12°');
  g.warn = 'center'; expect(panel(orbits).action).toBe('중심 유성 · 푸른 선 밖으로');
  g.room.discovered = false; expect(panel(orbits).action).toBe('다음 구역을 찾아 이동');

  const deep = makeRoute('deep-orbits', idle), d = deep.gates[1];
  deep.progress = 1; deep.current = d; d.clock = 4.21;
  d.phase = 'collapse'; expect(panel(deep)).toMatchObject({ title: '궤도 고리 연결', action: '붕괴 4.3초 · 룬석을 별에 맞추기 · 12°' });
  d.phase = 'storm'; d.present = true; d.stormWarn = true; d.stormIndex = 0;
  expect(panel(deep).action).toBe('유성 폭풍 1/3 · 빈 원으로 이동');
  d.stormWarn = false; expect(panel(deep).action).toBe('유성 폭풍 1/3 · 빈 원 안에서 대기');
});

test('목표창: 보스 궤도가 armed 여도 다른 종류의 route 는 영향받지 않는다', () => {
  const route = makeRoute('orbits', makeOrbit({ state: 'armed' })); route.def = { ...route.def, kind: 'records', holdSeconds: 2 };
  route.hold = 0; route.progress = 0;
  expect(panel(route).title).not.toBe('푸른 궤도선');
  // route 가 다른 월드의 것이면 쓰지 않는다.
  const stale = makeRoute('orbits', makeOrbit({ state: 'armed' }));
  expect(battleObjectiveView({ world: realWorld('standard'), routeObjectives: stale }).title).not.toBe('푸른 궤도선');
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
function resultTree(routeObjective: any) {
  const result: any = { win: true, kind: 'dungeon', id: 'comet_bastion', name: '혜성 요새', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  return expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0];
}
const lines = (tree: any) => {
  const out: { label: string; text: string }[] = [];
  const walk = (n: any) => { if (typeof n !== 'object') return; if (n.type === 'p' && n.props['aria-label']) out.push({ label: n.props['aria-label'], text: textOf(n) }); n.children.forEach(walk); };
  walk(tree); return out;
};
const standard = (over: any = {}) => Object.freeze({ id: 'comet_orbit_rings', label: '궤도 고리 정렬', complete: true, progress: 4, target: 4, ...over });
const deep = (over: any = {}) => Object.freeze({ id: 'comet_deep_orbits', label: '궤도 고리 연결', complete: true, progress: 5, target: 5, collapseFailures: 1, stormHits: 2, ...over });

test('결과 줄 함수: 유성 횟수와 피격 횟수를 한 줄로 만든다', () => {
  expect(cometBossOrbitResultLine({ bossMeteors: 7, bossMeteorHits: 2 })).toBe('푸른 궤도선 유성 7회 · 피격 2회');
  expect(cometBossOrbitResultLine({ bossMeteors: 0, bossMeteorHits: 0 })).toBe('푸른 궤도선 유성 0회 · 피격 0회');
  expect(cometBossOrbitResultLine({ bossMeteors: 3, bossMeteorHits: undefined })).toBe('푸른 궤도선 유성 3회 · 피격 0회');
});

test('결과 화면: 일반·심층 혜성 보고에 bossMeteors 가 숫자일 때만 기존 줄 다음에 한 줄을 더한다', () => {
  const std = lines(resultTree(standard({ bossMeteors: 5, bossMeteorHits: 1 })));
  expect(std.map(l => l.label)).toEqual(['궤도 고리 정렬 결과', '푸른 궤도선 결과']);
  expect(std[0].text).toBe('궤도 고리 정렬 4/4 · 완료');
  expect(std[1].text).toBe('푸른 궤도선 유성 5회 · 피격 1회');
  const dp = lines(resultTree(deep({ bossMeteors: 0, bossMeteorHits: 0 })));
  expect(dp.map(l => l.label)).toEqual(['궤도 고리 연결 결과', '푸른 궤도선 결과']);
  expect(dp[0].text).toBe('궤도 고리 연결 5/5 · 붕괴 실패 1회 · 유성 피격 2회 · 완료');
  expect(dp[1].text).toBe('푸른 궤도선 유성 0회 · 피격 0회');
  // 필드가 없거나 숫자가 아니면 줄을 더하지 않고 기존 줄은 그대로다.
  for (const bad of [undefined, null, '3', NaN]) {
    expect(lines(resultTree(standard({ bossMeteors: bad }))).map(l => l.label)).toEqual(['궤도 고리 정렬 결과']);
    expect(lines(resultTree(deep({ bossMeteors: bad }))).map(l => l.label)).toEqual(['궤도 고리 연결 결과']);
  }
  // 다른 원정에는 붙지 않는다.
  const other = lines(resultTree(Object.freeze({ id: 'bellfall_bell_gates', label: '종문 공명', complete: true, progress: 3, target: 3, bossMeteors: 4 })));
  expect(other.map(l => l.label)).toEqual(['종문 공명 결과']);
});
