import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FrameGovernor, PERF_TIER_KEY, canRenderFrame } from '../src/engine/frame-governor.js';
import { Renderer } from '../src/engine/renderer.js';
import { renderPixelRatio, thermalRenderProfile } from '../src/platform/mobile-display.js';

function storageFor(tier?: number) {
  const data = new Map<string, string>();
  if (tier != null) data.set(PERF_TIER_KEY, JSON.stringify({ version: 1, tier }));
  let writes = 0;
  return { data, get writes() { return writes; }, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; data.set(key, value); } };
}

function drive(g: FrameGovernor, start: number, duration: number, rafMs: number, mode = 'battle', render = true) {
  let steps = 0, elapsed = 0;
  const end = start + duration;
  for (let t = start + rafMs; t <= end + 0.00001; t += rafMs) {
    const dt = g.advance(t, mode, render);
    if (!dt) continue;
    steps++; elapsed += dt;
    if (render) g.recordFrame(t, 2);
  }
  return { steps, elapsed, end };
}

test('60·90·120·144Hz에서도 전투는 초당 60회 이하이며 건너뛴 시간이 dt에 포함된다', () => {
  for (const hz of [60, 90, 120, 144]) {
    const g = new FrameGovernor(); g.reset(0);
    const result = drive(g, 0, 10000, 1000 / hz);
    expect(result.steps).toBeLessThanOrEqual(600);
    expect(result.steps).toBeGreaterThanOrEqual(599);
    expect(result.elapsed).toBeCloseTo(g.lastStepAt / 1000, 8);
    expect(result.elapsed).toBeGreaterThan(9.97);
    expect(g.tier).toBe(0);
    expect(g.snapshot().targetFps).toBe(60);
    expect(g.snapshot().renderedFps).toBeCloseTo(60, 0);
  }
});

test('로비·마을은 30fps, 전투 복귀는 60fps이며 게임 시간이 누락되지 않는다', () => {
  const g = new FrameGovernor(); g.reset(0);
  const lobby = drive(g, 0, 10000, 1000 / 120, 'lobby');
  expect(lobby.steps).toBe(300);
  expect(lobby.elapsed).toBeCloseTo(g.lastStepAt / 1000, 8);
  expect(g.snapshot().targetFps).toBe(30);
  expect(g.snapshot().renderedFps).toBeCloseTo(30, 0);
  expect(drive(g, 10000, 10000, 1000 / 120).steps).toBe(600);
  expect(g.snapshot().targetFps).toBe(60);
});

test('화면을 가려도 기존 시뮬레이션은 진행하고 숨은 탭·testPause에는 시간 누적을 버린다', () => {
  const g = new FrameGovernor(); g.reset(0);
  drive(g, 0, 3000, 1000 / 120);
  expect(drive(g, 3000, 5000, 1000 / 120, 'battle', false).steps).toBe(300);
  expect(g.snapshot()).toEqual({ tier: 0, targetFps: 0, renderedFps: 0, p95FrameMs: 0, missRatio: 0 });
  expect(g.advance(9000, 'battle', false, true)).toBe(0);
  expect(g.advance(10000, 'battle', false, true)).toBe(0);
  const dt = g.advance(10008, 'battle', true);
  expect(dt).toBeCloseTo(0.008, 8);
  g.recordFrame(10008);
  expect(g.snapshot().p95FrameMs).toBe(0);
  expect(g.tier).toBe(0);
});

test('지속적인 25fps 부하는 약 5초 뒤 한 단계씩 낮추고 마지막에는 45fps를 목표로 한다', () => {
  const g = new FrameGovernor(); g.reset(0);
  drive(g, 0, 4000, 40);
  expect(g.tier).toBe(0);
  drive(g, 4000, 3000, 40);
  expect(g.tier).toBe(1);
  expect(g.snapshot().p95FrameMs).toBeCloseTo(40, 5);
  expect(g.snapshot().missRatio).toBeCloseTo(1 - 25 / 60, 5);
  drive(g, 7000, 23000, 40);
  expect(g.tier).toBe(4);
  expect(g.snapshot().targetFps).toBe(45);
});

test('단발 지연은 단계를 낮추지 않으며 회복은 60초 여유 뒤 한 단계만 허용한다', () => {
  const g = new FrameGovernor(); g.reset(0);
  drive(g, 0, 3000, 1000 / 60);
  g.advance(3300); g.recordFrame(3300, 300);
  drive(g, 3300, 10000, 1000 / 60);
  expect(g.tier).toBe(0);
  for (const hz of [60, 120, 144]) {
    const recovering = new FrameGovernor({ storage: storageFor(4) }); recovering.reset(0);
    drive(recovering, 0, 59000, 1000 / hz);
    expect(recovering.tier).toBe(4);
    drive(recovering, 59000, 4000, 1000 / hz);
    expect(recovering.tier).toBe(3);
    expect(recovering.snapshot().targetFps).toBe(60);
  }
});

test('한 분 이상 실제 렌더한 안정 단계만 별도 키에 저장·복원한다', () => {
  const storage = storageFor(); storage.data.set('bladesurge_save', '보존할 게임 저장');
  const g = new FrameGovernor({ storage }); g.reset(0);
  drive(g, 0, 28000, 40);
  expect(g.tier).toBe(4);
  expect(storage.writes).toBe(0);
  drive(g, 28000, 61000, 40);
  expect(storage.writes).toBe(1);
  expect(JSON.parse(storage.getItem(PERF_TIER_KEY)!)).toEqual({ version: 1, tier: 4 });
  expect(storage.getItem('bladesurge_save')).toBe('보존할 게임 저장');
  expect(new FrameGovernor({ storage }).tier).toBe(4);
  drive(g, 89000, 120000, 40, 'battle', false);
  expect(storage.writes).toBe(1);
});

test('저장소 차단·손상·범위 밖 단계는 안전하게 기본값을 쓰고 쓰기 실패도 허용한다', () => {
  for (const raw of ['손상', 'null', '{"version":2,"tier":3}', '{"version":1,"tier":5}', '{"version":1,"tier":-1}', '{"version":1,"tier":1.5}']) {
    expect(new FrameGovernor({ storage: { getItem: () => raw } as any }).tier).toBe(0);
  }
  const blocked = { getItem() { throw new Error('차단'); }, setItem() { throw new Error('용량 초과'); } };
  const g = new FrameGovernor({ storage: blocked }); g.reset(0);
  expect(() => drive(g, 0, 65000, 1000 / 60)).not.toThrow();
  expect(g.tier).toBe(0);
});

test('메뉴·모달·동행 대화·정산 화면을 덮으면 렌더를 막고 일반 전투·로비는 허용한다', () => {
  const app: any = { mode: 'battle', meta: { tab: 'home' }, lobbyVisible: true };
  let overlay = '';
  const doc: any = { hidden: false, querySelector: (selector: string) => overlay && selector.includes(overlay) ? {} : null };
  expect(canRenderFrame(app, doc)).toBe(true);
  for (overlay of ['dialog:modal', '#modal.show', '#pause-overlay.show', '#result.show', '#reveal.show']) expect(canRenderFrame(app, doc)).toBe(false);
  overlay = ''; app.mode = 'lobby';
  expect(canRenderFrame(app, doc)).toBe(true);
  // 영웅 탭의 3D 미리보기(쇼케이스가 보이는 동안)는 계속 그린다. 쇼케이스도 홈 탭도 아니면 멈춘다.
  app.meta.tab = 'heroes'; expect(canRenderFrame(app, doc)).toBe(true);
  app.meta.tab = 'home'; app.lobbyVisible = false; expect(canRenderFrame(app, doc)).toBe(true);
  app.meta.tab = 'heroes'; expect(canRenderFrame(app, doc)).toBe(false);
  app.lobbyVisible = true; app.expeditionUI = { opened: true }; expect(canRenderFrame(app, doc)).toBe(false);
  app.expeditionUI.opened = false; doc.hidden = true; expect(canRenderFrame(app, doc)).toBe(false);
});

test('모바일 mid 기본 부하와 단계별 완화를 제한하고 데스크톱 high 기본값을 보존한다', () => {
  expect(thermalRenderProfile('high', false)).toEqual({ softShadow: true, shadowScale: 1, bloomEnabled: true, bloomDivisor: 3, bloomLimit: 320 });
  expect(thermalRenderProfile('mid', true).softShadow).toBe(false);
  expect(thermalRenderProfile('mid', true).shadowScale).toBe(0.5);
  expect(thermalRenderProfile('mid', true, 1).shadowScale).toBe(0.25);
  expect(thermalRenderProfile('mid', true, 1).bloomEnabled).toBe(true);
  expect(thermalRenderProfile('mid', true, 2).bloomEnabled).toBe(false);
  expect(thermalRenderProfile('low', true, 0).bloomEnabled).toBe(false);
  const size = { width: 747, height: 298, dpr: 3.75, quality: 'mid', touch: true };
  // 동적 해상도 도입 뒤 mid 출발점은 DPR 상한 2·예산 1.6M 이다(이전 1.5·1.0M). 3단계는 그 값의 80%.
  expect(renderPixelRatio(size)).toBe(2);
  expect(renderPixelRatio({ ...size, thermalTier: 2 })).toBe(2);
  expect(renderPixelRatio({ ...size, thermalTier: 3 })).toBeCloseTo(1.6, 8);
  // 기본값이 1 아래인 고해상도 태블릿도 3단계에서 실제로 줄어들고, 0.6 아래로는 내려가지 않는다.
  expect(renderPixelRatio({ ...size, dpr: 1, thermalTier: 4 })).toBeCloseTo(0.8, 8);
  const tablet = { width: 1493, height: 766, dpr: 1.875, quality: 'mid', touch: true };
  expect(renderPixelRatio({ ...tablet, thermalTier: 3 })).toBeCloseTo(renderPixelRatio(tablet) * 0.8, 8);
  // 픽셀 예산 때문에 기본값이 이미 0.6 아래면 더 낮추지 않는다.
  const huge = { width: 4000, height: 3000, dpr: 3, quality: 'low', touch: true };
  expect(renderPixelRatio({ ...huge, thermalTier: 3 })).toBe(renderPixelRatio(huge));
  expect(renderPixelRatio({ width: 1000, height: 500, dpr: 1, quality: 'mid', touch: true, thermalTier: 3 })).toBe(0.8);
  const large = { ...size, width: 2732, height: 2048 };
  expect(renderPixelRatio({ ...large, thermalTier: 3 })).toBeLessThanOrEqual(renderPixelRatio(large));
});

test('실제 Renderer 메서드는 그림자 타깃을 한 번만 교체하고 단계 복구·설정 변경을 보존한다', () => {
  const renderer: any = Object.assign(Object.create(Renderer.prototype), {
    scene: new THREE.Scene(), r: { shadowMap: { type: THREE.PCFSoftShadowMap } },
    bloom: { enabled: true }, thermalTier: 0, touch: true, quality: 'mid',
    _shadowSizes: new WeakMap(), resize() { this.resizes++; }, resizes: 0,
  });
  renderer._syncShadow = (object: any) => renderer._applyShadowSize(object);
  const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  renderer.scene.add(sun);
  let disposed = 0;
  sun.shadow.map = { dispose: () => disposed++ } as any;
  renderer.setQuality('mid');
  expect(renderer.r.shadowMap.type).toBe(THREE.PCFShadowMap);
  expect(sun.shadow.mapSize.x).toBe(512);
  expect(sun.shadow.map).toBeNull(); expect(disposed).toBe(1);
  renderer.setThermalTier(1); expect(sun.shadow.mapSize.x).toBe(256);
  renderer.setThermalTier(1); expect(sun.shadow.mapSize.x).toBe(256);
  renderer.setThermalTier(2); expect(renderer.bloom.enabled).toBe(false);
  renderer.setQuality('mid'); expect(renderer.bloom.enabled).toBe(false);
  renderer.setThermalTier(3); expect(renderer.resizes).toBe(3);
  renderer.setThermalTier(4); expect(renderer.resizes).toBe(3);
  renderer.setThermalTier(0); expect(sun.shadow.mapSize.x).toBe(512);
  expect(renderer.r.shadowMap.type).toBe(THREE.PCFShadowMap);
  expect(renderer.bloom.enabled).toBe(true);
  renderer.touch = false; renderer.setQuality('high');
  expect(sun.shadow.mapSize.x).toBe(1024);
  expect(renderer.r.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
});

// 다른 레인의 파일을 실행하거나 서버를 띄우지 않고 실제 App 메서드를 독립 고정물로 호출한다.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function appMethod(name: 'loop' | 'step', bindings: Record<string, unknown>) {
  const method = source.match(new RegExp(`  ${name}\\([^]*?\\n  \\}`))?.[0];
  if (!method) throw new Error(`App.${name} 메서드 없음`);
  return new Function(...Object.keys(bindings), `return ({${method}}).${name};`)(...Object.values(bindings));
}

test('실제 App.loop는 120Hz에서 60회만 step하고 testPause·렌더 중단을 연결한다', () => {
  const doc = { hidden: false, querySelector: () => null };
  const loop = appMethod('loop', { canRenderFrame, document: doc, requestAnimationFrame: () => {}, performance: { now: () => 0 } });
  const app: any = { frameGovernor: new FrameGovernor(), mode: 'battle', meta: { tab: 'home' },
    renderer: { renderCount: 0, setThermalTier() {}, setResolutionScale() {} }, steps: 0, elapsed: 0,
    step(dt: number, render: boolean) { this.steps++; this.elapsed += dt; if (render) this.renderer.renderCount++; } };
  app.frameGovernor.reset(0);
  for (let i = 1; i <= 120; i++) loop.call(app, i * 1000 / 120);
  expect(app.steps).toBe(60); expect(app.renderer.renderCount).toBe(60);
  expect(app.elapsed).toBeCloseTo(app.last / 1000, 8);
  app.testPause = true; loop.call(app, 2000); expect(app.steps).toBe(60);
  app.testPause = false; doc.hidden = true; loop.call(app, 3000); expect(app.steps).toBe(60);
  doc.hidden = false; loop.call(app, 3008); expect(app.steps).toBe(61);
  expect(app.frameGovernor.snapshot().p95FrameMs).toBe(0);
});

test('실제 app.step 고정 dt 경로는 프레임 제한과 별개이며 render=false를 지킨다', () => {
  const step = appMethod('step', { audio: { updateCombatMix() {} }, canRenderFrame, document: { hidden: false, querySelector: () => null } });
  const deltas: number[] = [];
  const app: any = { mode: 'battle', syncHub() {}, tutorial: { update() {} }, fx: { update() {} },
    battle: { active: true, enemies: [], timeCtl: { scale: 1 }, update: (dt: number) => deltas.push(dt) },
    renderer: { frames: 0, update() {}, render() { this.frames++; } } };
  for (let i = 0; i < 120; i++) step.call(app, 1 / 120, false);
  expect(deltas).toHaveLength(120); expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  expect(app.renderer.frames).toBe(0);
  step.call(app, 1 / 60, true); expect(app.renderer.frames).toBe(1);
});



