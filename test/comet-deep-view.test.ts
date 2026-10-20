import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { CometDeepOrbitView } from '../src/game/comet-deep-orbit-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { ExpeditionResult } from '../src/expansion/hub.jsx';

// rules lane 의 컨트롤러(src/game/comet-deep-orbits.js)는 쓰지 않는다. TASK-DESIGN 9절의 읽기 API 를 흉내 낸 가짜 route 로 뷰·패널·결과를 검증한다.
const DEF = Object.freeze({ id: 'comet_deep_orbits', kind: 'deep-orbits', track: 4, band: 1.5, contact: 1.3, tolerance: .14, lockSeconds: .4,
  collapseSeconds: 9, shelterRadius: 2.2, connectSeconds: .5,
  storm: Object.freeze({ warning: 1.4, gap: .6, tail: .4, damage: .08, radius: 12, shelters: Object.freeze(['center', 'star', 'side']) }) });
const ROOMS = [1, 2, 3, 5, 7], TARGETS = [Math.PI / 2, 0, Math.PI / 2, Math.PI / 2, Math.PI];
const PHASES = ['locked', 'ready', 'collapse', 'shelter', 'storm', 'connected'] as const;

function realWorld() {
  const stage = buildExpeditionStage('dungeon', 'comet_bastion', null, { depth: 'deep' });
  return buildExpeditionWorld(stage);
}
function makeRoute(world: any = realWorld()) {
  const gates = ROOMS.map((id, index) => {
    const room = world.rooms.find((r: any) => r.id === id);
    room.discovered = true;
    const target = TARGETS[index];
    return { room, label: (index + 1) + '번 궤도 고리', index, phase: 'locked', present: false, angle: target - 2.2, target, start: target - 2.2,
      stone: new Vector3(room.x + Math.sin(target - 2.2) * 4, 0, room.z + Math.cos(target - 2.2) * 4), center: new Vector3(room.x, 0, room.z),
      clock: 0, connectT: 0, slack: null as number | null, lockT: 0, failures: 0, hits: 0, stormIndex: 0, stormWarn: false, stormWarnT: 0,
      stormShelter: new Vector3(room.x, 0, room.z) };
  });
  const route: any = { def: DEF, world, gates, closed: false, collapseFailures: 0, stormHits: 0,
    get progress() { return gates.filter(g => g.phase === 'connected').length; },
    get current() { return gates.find(g => g.phase !== 'connected') || null; },
    offBy: (g: any) => Math.round(Math.abs(g.target - g.angle) * 180 / Math.PI) };
  return route;
}
/** phase 하나를 모든 고리에 적용하고 그 phase 가 요구하는 값을 채운다. */
function setPhase(route: any, phase: string, extra: any = {}) {
  for (const g of route.gates) {
    Object.assign(g, { phase, clock: phase === 'collapse' || phase === 'shelter' ? 6.3 : 0, connectT: phase === 'shelter' ? .2 : 0, lockT: 0,
      stormWarn: false, stormIndex: 0, stormWarnT: 0, ...extra });
    if (phase === 'shelter' || phase === 'storm' || phase === 'connected') { g.angle = g.target; g.stone.set(g.room.x + Math.sin(g.target) * 4, 0, g.room.z + Math.cos(g.target) * 4); }
  }
}
function census(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); let meshes = 0;
  scene.traverse((o: any) => { if (!o.isMesh) return; meshes++; geometries.add(o.geometry); materials.add(o.material); });
  return { geometries: geometries.size, materials: materials.size, meshes };
}
/** 부모 체인이 모두 visible 인 메시만 센다(= 실제 그려지는 draw call). */
function visibleMeshes(view: CometDeepOrbitView, gateIndex: number) {
  const root = (view as any).entries[gateIndex].root; let n = 0;
  if (!(view as any).group.visible || !root.visible) return 0;
  root.traverse((o: any) => { if (o.isMesh && o.visible) n++; });
  return n;
}
const OPTS = { reduced: false };

test('phase 를 오가며 300회 갱신해도 geometry·material·mesh 수가 변하지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const before = census(scene);
  expect(before.meshes).toBeGreaterThan(0);
  for (let i = 0; i < 300; i++) {
    const phase = PHASES[i % PHASES.length];
    setPhase(route, phase, { stormWarn: phase === 'storm' && i % 2 === 0, stormWarnT: .7, stormIndex: i % 3, clock: (i % 90) / 10 + .05 });
    for (const g of route.gates) g.stormShelter.set(g.center.x + (i % 5), 0, g.center.z - (i % 3));
    view.update(route, 1 / 60, i % 7 === 0 ? { reduced: true } : OPTS);
    expect(census(scene)).toEqual(before);
  }
  view.dispose();
});

test('고리 하나가 보이는 메시 수는 활성 6 이하, 잠김·연결 2 이하이고 폭풍 예고 요소는 stormWarn 일 때만 보인다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const counts: Record<string, number> = {};
  for (const phase of PHASES) {
    setPhase(route, phase);
    view.update(route, 1 / 60, OPTS);
    counts[phase] = Math.max(...route.gates.map((_: any, i: number) => visibleMeshes(view, i)));
    if (phase === 'locked' || phase === 'connected') expect(counts[phase]).toBeLessThanOrEqual(2);
    else expect(counts[phase]).toBeLessThanOrEqual(6);
  }
  const e = (view as any).entries[0];
  expect(e.red.visible).toBe(false); expect(e.fill.visible).toBe(false);
  setPhase(route, 'storm', { stormWarn: true, stormWarnT: 1.4, stormIndex: 1 });
  view.update(route, 1 / 60, OPTS);
  expect(e.red.visible).toBe(true); expect(e.fill.visible).toBe(true); expect(visibleMeshes(view, 0)).toBeLessThanOrEqual(6);
  // 예고가 끝나면 붉은 영역과 빈 원 채움이 사라지고 안전한 쉼터 원만 남는다.
  setPhase(route, 'storm', { stormWarn: false, stormIndex: 1 });
  view.update(route, 1 / 60, OPTS);
  expect(e.red.visible).toBe(false); expect(e.fill.visible).toBe(false); expect(e.ring.visible).toBe(true);
  // 붕괴 단계의 카운트다운 호는 clock 이 남아 있는 한 한 칸 이상 그려진다.
  setPhase(route, 'collapse', { clock: .01 });
  view.update(route, 1 / 60, OPTS);
  expect(e.arc.visible).toBe(true); expect(e.arcGeometry.drawRange.count).toBeGreaterThanOrEqual(6);
  view.dispose();
});

test('미발견 구역과 closed route 는 숨기고, 일시정지처럼 dt 0 갱신은 마지막 화면을 유지한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  setPhase(route, 'storm', { stormWarn: true, stormWarnT: .5 });
  route.gates[2].room.discovered = false;
  view.update(route, 1 / 60, OPTS);
  expect(visibleMeshes(view, 2)).toBe(0); expect(visibleMeshes(view, 0)).toBeGreaterThan(0);
  view.update(route, 0, OPTS);
  expect(visibleMeshes(view, 0)).toBeGreaterThan(0); expect((view as any).entries[0].red.visible).toBe(true);
  route.closed = true;
  view.update(route, 1 / 60, OPTS);
  expect((view as any).group.visible).toBe(false);
  for (let i = 0; i < 5; i++) expect(visibleMeshes(view, i)).toBe(0);
  view.dispose();
});

test('reduced 옵션에서는 룬석 회전과 쉼터 맥동이 멈춘다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  setPhase(route, 'shelter');
  const e = (view as any).entries[0];
  view.update(route, 1 / 60, { reduced: true }); const spin = e.stone.rotation.y, scale = e.ring.scale.x;
  for (let i = 0; i < 30; i++) view.update(route, 1 / 60, { reduced: true });
  expect(e.stone.rotation.y).toBe(spin); expect(e.ring.scale.x).toBe(scale);
  for (let i = 0; i < 30; i++) view.update(route, 1 / 60, OPTS);
  expect(e.stone.rotation.y).toBeGreaterThan(spin);
  view.dispose();
});

test('dispose 는 scene 자식을 비우고 모든 geometry·material 을 정확히 한 번 해제하며 반복 호출과 이후 갱신에도 안전하다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse((o: any) => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  expect(scene.children).toHaveLength(1);
  const disposed = new Map<any, number>();
  for (const item of [...geometries, ...materials]) { disposed.set(item, 0); item.addEventListener('dispose', () => disposed.set(item, disposed.get(item)! + 1)); }
  setPhase(route, 'collapse'); view.update(route, 1 / 60, OPTS);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect([...disposed.values()].every(n => n === 1)).toBe(true);
  expect(disposed.size).toBe(geometries.size + materials.size);
  expect(() => view.update(route, 1 / 60, OPTS)).not.toThrow();
  expect(scene.children).toHaveLength(0);
});

// 붉은 영역 정점이 방 직사각형 밖으로 나가지 않고, 판정 영역(원 ∩ 방)을 빈틈없이 덮는지 실제 심층 월드의 다섯 방으로 확인한다.
test('폭풍 붉은 영역은 반경 12 원과 방 직사각형의 교집합이며 방 밖으로 나가지 않는다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const R = DEF.storm.radius;
  route.gates.forEach((g: any, i: number) => {
    const room = g.room, hw = room.w / 2, hh = room.h / 2, geometry = (view as any).entries[i].red.geometry as THREE.BufferGeometry;
    const pos = geometry.getAttribute('position'), index = geometry.getIndex()!;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      expect(Math.abs(x)).toBeLessThanOrEqual(hw + 1e-6); expect(Math.abs(z)).toBeLessThanOrEqual(hh + 1e-6);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(R + 1e-6);
      // 중심 정점을 뺀 모든 정점은 원 둘레 또는 방 변 위에 있다(안쪽으로 깎인 정점이 없다).
      if (k > 0) expect(Math.abs(Math.hypot(x, z) - R) < 1e-5 || Math.abs(Math.abs(x) - hw) < 1e-5 || Math.abs(Math.abs(z) - hh) < 1e-5).toBe(true);
    }
    // 모든 삼각형은 위를 보고(법선 +y), 면적 합이 격자로 센 교집합 면적과 1% 안에서 같다.
    let area = 0;
    for (let k = 0; k < index.count; k += 3) {
      const a = index.getX(k), b = index.getX(k + 1), c = index.getX(k + 2);
      const cross = (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) - (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a));
      expect(cross).toBeGreaterThanOrEqual(-1e-9); area += cross / 2;
    }
    let grid = 0; const step = .1;
    for (let x = -R + step / 2; x < R; x += step) for (let z = -R + step / 2; z < R; z += step) {
      if (Math.hypot(x, z) <= R && Math.abs(x) < hw && Math.abs(z) < hh) grid += step * step;
    }
    expect(Math.abs(area - grid) / grid).toBeLessThan(.01);
  });
  view.dispose();
});

test('청록 빈 원은 gate.stormShelter 위치와 def.shelterRadius 를 그대로 그린다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const g = route.gates[1], e = (view as any).entries[1];
  setPhase(route, 'storm', { stormWarn: true, stormWarnT: .9, stormIndex: 1 });
  g.stormShelter.set(g.center.x + 3.46, 0, g.center.z - 2);
  view.update(route, 1 / 60, OPTS);
  expect(e.ring.position.x).toBeCloseTo(3.46, 6); expect(e.ring.position.z).toBeCloseTo(-2, 6);
  e.ring.geometry.computeBoundingBox();
  expect(e.ring.geometry.boundingBox.max.x).toBeCloseTo(DEF.shelterRadius, 5);
  view.dispose();
});

// ---- 화면 가독성(BUNDLE-02 U1·U2) ----
/** src/engine/fx.js 에서 메서드 본문의 첫 renderOrder 대입값을 읽는다. 지면·빌보드 VFX 순서 기준이 바뀌면 이 테스트가 알려 준다. */
function fxRenderOrder(method: string): number {
  const source = readFileSync(new URL('../src/engine/fx.js', import.meta.url), 'utf8');
  const start = source.search(new RegExp('\\n  ' + method + '\\('));
  expect(start).toBeGreaterThan(-1);
  const match = /renderOrder = (\d+)/.exec(source.slice(start, start + 1500));
  expect(match).not.toBeNull();
  return Number(match![1]);
}
const FLOOR_MARKS = ['track', 'notch', 'arc', 'ring', 'fill', 'red'] as const;

test('폭풍 예고 붉은 영역은 첫 프레임부터 바닥과 구분되고 청록 빈 원이 항상 더 강한 신호다(일반·reduced 동일)', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const e = (view as any).entries[0], warning = DEF.storm.warning;
  const red = (progress: number, opts: any) => {
    setPhase(route, 'storm', { stormWarn: true, stormWarnT: warning * (1 - progress), stormIndex: 0 });
    view.update(route, 1 / 60, opts);
    return { red: e.redMat.opacity as number, ring: e.ringMat.opacity as number, fill: e.fillMat.opacity as number };
  };
  for (const opts of [OPTS, { reduced: true }]) {
    let previous = 0;
    for (const progress of [0, .25, .5, .75, 1]) {
      const now = red(progress, opts);
      // 결함 값(.12)은 바닥과 구분되지 않는다. 시작값 하한은 .25 로 둔다.
      expect(now.red).toBeGreaterThanOrEqual(.25);
      // 쉼터 대비: 청록 테두리가 붉은 영역보다 .3 이상 진하고, 붉은 영역은 항상 반투명이다.
      expect(now.ring - now.red).toBeGreaterThanOrEqual(.3);
      expect(now.red).toBeLessThanOrEqual(.6);
      expect(now.red).toBeGreaterThanOrEqual(previous - 1e-9); previous = now.red;
    }
    // 쉼터 채움은 시작부터 보이고 시간이 갈수록 진해진다.
    expect(red(0, opts).fill).toBeGreaterThanOrEqual(.15);
    expect(red(1, opts).fill).toBeGreaterThan(red(0, opts).fill);
  }
  // 청록 빈 원(채움·테두리)은 붉은 영역 위에 그려야 쉼터가 붉은 막에 묻히지 않는다.
  expect(e.fill.renderOrder).toBeGreaterThan(e.red.renderOrder);
  expect(e.ring.renderOrder).toBeGreaterThan(e.fill.renderOrder);
  view.dispose();
});

test('룬석 표식·카운트다운 호·쉼터 원은 지면 VFX(기사 성역) 뒤에 그려지고 깊이 검사는 유지한다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  // 기사 성역(castCircle 포함)은 fx.groundTex(8), 충격파 링은 fx.ring(9)이다. 표식이 이보다 앞서 그려지면 가산 합성에 덮인다.
  const floorFx = Math.max(fxRenderOrder('groundTex'), fxRenderOrder('ring'));
  // 빌보드 플래시(texFlash)와 플립북은 표식 위에 그대로 보여야 한다.
  const billboardFx = Math.min(fxRenderOrder('texFlash'), fxRenderOrder('flipbook'));
  expect(floorFx).toBeGreaterThan(0); expect(billboardFx).toBeGreaterThan(floorFx);
  const check = () => {
    for (const e of (view as any).entries) for (const key of FLOOR_MARKS) {
      const mesh = e[key] as THREE.Mesh, material = mesh.material as THREE.MeshBasicMaterial;
      expect(mesh.renderOrder).toBeGreaterThan(floorFx);
      expect(mesh.renderOrder).toBeLessThan(billboardFx);
      // 깊이 검사를 끄면 표식이 기사 모델과 룬석 위로 비치고, 깊이 쓰기를 켜면 뒤 VFX 가 잘린다.
      expect(material.transparent).toBe(true); expect(material.depthTest).toBe(true); expect(material.depthWrite).toBe(false);
    }
  };
  check();
  // 갱신을 거쳐도 순서가 바뀌지 않는다(붕괴·쉼터·폭풍 예고).
  for (const [phase, extra] of [['collapse', {}], ['shelter', {}], ['storm', { stormWarn: true, stormWarnT: 1 }]] as const) {
    setPhase(route, phase, extra); view.update(route, 1 / 60, OPTS); check();
  }
  view.dispose();
});

test('폭풍 예고 프레임의 draw call 은 같은 방 진입 직후 대비 고리당 +12 이하다', () => {
  const scene = new THREE.Scene(), route = makeRoute(), view = new CometDeepOrbitView(scene, route);
  const total = () => route.gates.reduce((sum: number, _: any, i: number) => sum + visibleMeshes(view, i), 0);
  setPhase(route, 'locked'); view.update(route, 1 / 60, OPTS);
  const entry = total();
  setPhase(route, 'storm', { stormWarn: true, stormWarnT: 1.4 }); view.update(route, 1 / 60, OPTS);
  const warn = total();
  expect(warn).toBeGreaterThan(entry);
  expect(warn - entry).toBeLessThanOrEqual(12 * route.gates.length);
  view.dispose();
});

// ---- 목표 패널 ----
const panel = (route: any) => battleObjectiveView({ world: route.world, routeObjectives: route });
function panelRoute() {
  const route = makeRoute(); route.world.sealed = true;
  for (const room of route.world.rooms) room.discovered = true;
  return route;
}

test('목표 패널은 모든 phase 에서 계약 문장을 쓰고 일반 고리 문구와 섞이지 않는다', () => {
  const route = panelRoute(), g = route.current;
  g.angle = g.target - 1.0; // 약 57°
  const off = route.offBy(g);
  expect(panel(route)).toMatchObject({ title: '궤도 고리 연결', progress: 0, total: 5, roomId: g.room.id, action: '이 구역의 적을 먼저 처치' });
  g.phase = 'ready';
  expect(panel(route).action).toBe('룬석을 밀면 붕괴 9초 시작 · 별까지 ' + off + '°');
  g.phase = 'collapse'; g.clock = 6.31;
  expect(panel(route).action).toBe('붕괴 6.4초 · 룬석을 별에 맞추기 · ' + off + '°');
  g.phase = 'shelter'; g.clock = 3.0; g.connectT = .27;
  expect(panel(route)).toMatchObject({ action: '붕괴 3.0초 · 중심 쉼터 연결', hold: .2, holdTotal: .5 });
  g.phase = 'storm'; g.clock = 0; g.present = false; g.stormIndex = 1;
  expect(panel(route).action).toBe('유성 폭풍 중단 · 고리 구역으로 돌아가기');
  g.present = true; g.stormWarn = true;
  expect(panel(route).action).toBe('유성 폭풍 2/3 · 빈 원으로 이동');
  g.stormWarn = false;
  expect(panel(route).action).toBe('유성 폭풍 2/3 · 빈 원 안에서 대기');
  g.stormIndex = 3;
  expect(panel(route).action).toBe('유성 폭풍 3/3 · 빈 원 안에서 대기');
  g.room.discovered = false;
  expect(panel(route)).toMatchObject({ roomId: null, action: '다음 구역을 찾아 이동', hold: 0 });
  for (const action of ['궤도 고리 정렬', '푸른 선', '유성 · ']) expect(panel(route).title + panel(route).action).not.toContain(action);
});

test('남은 시간은 올림이라 clock 이 0보다 크면 0.0 을 표시하지 않는다', () => {
  const route = panelRoute(), g = route.current;
  g.angle = g.target - .5;
  for (const phase of ['collapse', 'shelter']) {
    g.phase = phase;
    for (const clock of [9, 8.95, 4.0, 1.0000001, .9999, .1, .0999, .05, .01, 1e-4, 1e-6, 2e-9]) {
      g.clock = clock; g.connectT = .1;
      const action = panel(route).action;
      expect(action).not.toContain('0.0초');
      expect(action).toContain('붕괴 ' + (Math.ceil(clock * 10 - 1e-9) / 10).toFixed(1) + '초');
    }
    // 수동으로 센 값: 0.01 → 0.1, 1.0000001 → 1.1, 0.9999 → 1.0
    g.clock = .01; expect(panel(route).action).toContain('붕괴 0.1초');
    g.clock = 1.0000001; expect(panel(route).action).toContain('붕괴 1.1초');
    g.clock = .9999; expect(panel(route).action).toContain('붕괴 1.0초');
  }
});

test('연결된 고리는 진행도만 올리고 아직 남은 고리의 상태를 목표로 보여 준다', () => {
  const route = panelRoute();
  route.gates[0].phase = 'connected'; route.gates[1].phase = 'connected';
  const view = panel(route), next = route.current;
  expect(next.index).toBe(2);
  expect(view).toMatchObject({ progress: 2, total: 5, roomId: next.room.id });
  for (const g of route.gates) g.phase = 'connected';
  expect(panel(route).title).not.toBe('궤도 고리 연결');
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
  const result: any = { win, kind: 'dungeon', id: 'comet_bastion', name: '혜성 요새', depth: 'deep', kills: 10, combo: 3, time: 90, saveError: null, rewards: {}, routeObjective };
  const app: any = { stageStarting: false, battle: { result: {} }, toLobby() {} };
  const controller: any = { app, result, close() {}, open() {}, showResult() {} };
  const view = expand(ExpeditionResult({ controller, launch() {}, message: '', focusRef: { current: null } }))[0];
  return { view, nodes: flat(view), text: textOf(view) };
}
const report = (over: any) => Object.freeze({ id: 'comet_deep_orbits', label: '궤도 고리 연결', complete: false, progress: 3, target: 5, rooms: Object.freeze([2, 1, 5]),
  collapseFailures: 2, stormHits: 1, ...over });

test('심층 결과 줄은 연결·실패·피격을 한 줄로 보이고 일반 label 줄과 중복되지 않는다', () => {
  const win = resultView(true, report({ complete: true, progress: 5, collapseFailures: 0, stormHits: 0, rooms: [1, 2, 3, 5, 7] }));
  expect(win.text).toContain('궤도 고리 연결 5/5 · 붕괴 실패 0회 · 유성 피격 0회 · 완료');
  expect(win.text.split('궤도 고리 연결').length - 1).toBe(1);
  expect(win.nodes.filter(n => n.type === 'p' && n.props['aria-label']?.includes('궤도 고리 연결'))).toHaveLength(1);
});

test('패배한 심층 결과에는 완료 표시가 없고 실제 진행만 남는다', () => {
  const lost = resultView(false, report({}));
  expect(lost.text).toContain('궤도 고리 연결 3/5 · 붕괴 실패 2회 · 유성 피격 1회');
  expect(lost.text).not.toContain('연결 3/5 · 붕괴 실패 2회 · 유성 피격 1회 · 완료');
  expect(lost.text).not.toContain('궤도 고리 연결 5/5');
  // complete 가 거짓이면 이긴 결과에서도 완료를 붙이지 않는다.
  expect(resultView(true, report({ complete: false })).text).not.toContain('· 완료');
});

test('일반 혜성 고리와 다른 원정의 결과 줄은 기존 형식을 유지한다', () => {
  const standard = resultView(true, Object.freeze({ id: 'comet_orbit_rings', label: '궤도 고리 정렬', complete: true, progress: 4, target: 4, rooms: [1, 3, 5, 7], meteorHits: 2 }));
  expect(standard.text).toContain('궤도 고리 정렬 4/4 · 완료');
  expect(standard.text).not.toContain('붕괴 실패');
  expect(resultView(true, undefined).text).not.toContain('궤도 고리');
});
