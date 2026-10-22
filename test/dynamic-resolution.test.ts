import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FrameGovernor, PERF_SCALE_KEY } from '../src/engine/frame-governor.js';
import { Renderer } from '../src/engine/renderer.js';
import { decideResolutionStep, renderPixelRatio, sharpenStrength, battleNeedsFxaa, snapResolutionScale, RESOLUTION_SCALE } from '../src/platform/mobile-display.js';
import { characterAnisotropy, tuneCharacterTextures, CHARACTER_ANISOTROPY } from '../src/engine/texture-sampling.js';

function drive(g: FrameGovernor, start: number, duration: number, rafMs: number, mode = 'battle') {
  const end = start + duration;
  for (let t = start + rafMs; t <= end + 0.00001; t += rafMs) {
    if (g.advance(t, mode, true)) g.recordFrame(t, 2);
  }
  return end;
}
const memoryStorage = (initial?: string) => {
  const data = new Map<string, string>(); if (initial) data.set(PERF_SCALE_KEY, initial);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('배율은 0.7~1.0의 10% 격자에 맞춰지고 잘못된 값은 최대로 돌아간다', () => {
  expect(snapResolutionScale(0.73)).toBe(0.7);
  expect(snapResolutionScale(0.2)).toBe(RESOLUTION_SCALE.min);
  expect(snapResolutionScale(3)).toBe(1);
  expect(snapResolutionScale(NaN)).toBe(1);
  expect(snapResolutionScale(0.8 + 0.1)).toBe(0.9);
});

test('decideResolutionStep: 과부하 지속이면 한 단계 낮추고 여유 지속이면 한 단계 올린다', () => {
  expect(decideResolutionStep({ scale: 1, overloadMs: 2000 })).toBe(-1);
  expect(decideResolutionStep({ scale: 1, overloadMs: 1999 })).toBe(0);
  expect(decideResolutionStep({ scale: 0.8, headroomMs: 10000 })).toBe(1);
  expect(decideResolutionStep({ scale: 0.8, headroomMs: 9999 })).toBe(0);
  // 최소·최대에서는 더 움직이지 않는다.
  expect(decideResolutionStep({ scale: 0.7, overloadMs: 99999 })).toBe(0);
  expect(decideResolutionStep({ scale: 1, headroomMs: 99999 })).toBe(0);
  // 직전 변경 뒤 쿨다운 안에서는 멈춘다. 낮춤과 올림이 동시에 성립해도 낮춤이 이긴다.
  expect(decideResolutionStep({ scale: 1, overloadMs: 5000, sinceChangeMs: 2499 })).toBe(0);
  expect(decideResolutionStep({ scale: 0.8, overloadMs: 5000, headroomMs: 99999, sinceChangeMs: 2500 })).toBe(-1);
  expect(decideResolutionStep({ scale: 0.8, overloadMs: 0, headroomMs: 20000, upMs: 40000 })).toBe(0);
});

test('배율은 픽셀 비율에 곱해지지만 0.6 아래로 내려가지 않고 열 단계 바닥과 함께 쓴다', () => {
  const s26 = { width: 915, height: 412, dpr: 3.5, quality: 'mid', touch: true };
  expect(renderPixelRatio(s26)).toBe(2);
  expect(renderPixelRatio({ ...s26, resolutionScale: 0.8 })).toBeCloseTo(1.6, 8);
  // 최소 배율(0.7)에서도 S26 급 바닥은 1.4로 예전 고정값(1.5)에 가깝다. 범위 밖 배율은 격자에 맞춰진다.
  expect(renderPixelRatio({ ...s26, resolutionScale: 0.7 })).toBeCloseTo(1.4, 8);
  expect(renderPixelRatio({ ...s26, resolutionScale: 0.3 })).toBeCloseTo(1.4, 8);
  expect(renderPixelRatio({ ...s26, resolutionScale: 0.7, thermalTier: 3 })).toBeCloseTo(1.12, 8);
  // 열 단계 3 + 최소 배율이 겹쳐도 기본값이 1 근처인 기기는 0.6 아래로 가지 않는다(열 단계가 이미 더 낮으면 그 값).
  expect(renderPixelRatio({ width: 1000, height: 500, dpr: 1, quality: 'mid', touch: true, resolutionScale: 0.7, thermalTier: 3 })).toBe(0.6);
  expect(renderPixelRatio({ width: 1000, height: 500, dpr: 1, quality: 'mid', touch: true, resolutionScale: 0.7 })).toBeCloseTo(0.7, 8);
  expect(renderPixelRatio({ width: 1000, height: 500, dpr: 0.5, quality: 'mid', touch: true, resolutionScale: 0.7 })).toBeCloseTo(0.5, 8);
  // 이전 정책(고정 예산)보다 항상 같거나 선명하다: 모든 기기에서 새 출발점 >= 옛 값(mid 1.5·1.0M).
  for (const [w, h, d] of [[915, 412, 3.5], [1280, 800, 2], [800, 360, 2.75], [390, 844, 3]]) {
    const old = Math.min(Math.min(d, 1.5), Math.sqrt(1000000 / (w * h)));
    expect(renderPixelRatio({ width: w, height: h, dpr: d, quality: 'mid', touch: true })).toBeGreaterThanOrEqual(old);
  }
  // 데스크톱은 터치 예산이 없으므로 high 라도 DPR 2를 넘지 않는다(터치만 2.5).
  expect(renderPixelRatio({ width: 1920, height: 1080, dpr: 3, quality: 'high', touch: false })).toBe(2);
  expect(renderPixelRatio({ width: 915, height: 412, dpr: 3.5, quality: 'high', touch: true })).toBeGreaterThan(2.3);
});

test('선명화 강도는 확대될수록 조금 세지고 상한을 넘지 않으며 FXAA 는 기기 해상도 아래에서만 켠다', () => {
  expect(sharpenStrength(3.5, 3.5)).toBeCloseTo(0.4, 8);
  expect(sharpenStrength(2, 3.5)).toBeGreaterThan(0.4);
  expect(sharpenStrength(2, 3.5)).toBeLessThan(0.75);
  expect(sharpenStrength(0.1, 3)).toBeLessThanOrEqual(0.75);
  expect(sharpenStrength(NaN, NaN)).toBeCloseTo(0.4, 8);
  expect(battleNeedsFxaa(2, 3.5, 'mid')).toBe(true);
  expect(battleNeedsFxaa(1, 1, 'high')).toBe(false);
  expect(battleNeedsFxaa(2, 3.5, 'low')).toBe(false);
  expect(battleNeedsFxaa(2, 2, 'mid')).toBe(false);
});

test('거버너: 지속 과부하는 2초마다 한 단계씩 해상도를 낮추고 최저에서 멈춘다', () => {
  const g = new FrameGovernor(); g.reset(0);
  expect(g.resolutionScale).toBe(1);
  // 25fps(40ms) 부하 — 렌더 타깃을 매 프레임이 아니라 단계가 바뀔 때만 바꾸므로 변화 횟수를 센다.
  let last = g.resolutionScale, changes = 0;
  for (let t = 40; t <= 40000; t += 40) {
    if (g.advance(t, 'battle', true)) g.recordFrame(t, 2);
    if (g.resolutionScale !== last) { changes++; expect(last - g.resolutionScale).toBeCloseTo(0.1, 8); last = g.resolutionScale; }
  }
  expect(g.resolutionScale).toBe(0.7);
  expect(changes).toBe(3);
});

test('거버너: 단발 끊김은 해상도를 바꾸지 않고 안정적이면 올림 대기(10초) 뒤 한 단계 올린다', () => {
  const g = new FrameGovernor({ scaleStorage: memoryStorage(JSON.stringify({ version: 1, scale: 0.7 })) }); g.reset(0);
  expect(g.resolutionScale).toBe(0.7);
  drive(g, 0, 3000, 1000 / 60);
  g.advance(3300); g.recordFrame(3300, 300);
  drive(g, 3300, 6000, 1000 / 60);
  expect(g.resolutionScale).toBe(0.7);
  drive(g, 9300, 8000, 1000 / 60);
  expect(g.resolutionScale).toBeCloseTo(0.8, 8);
  // 올린 뒤에도 쿨다운 안에서는 연달아 올리지 않는다.
  drive(g, 17300, 5000, 1000 / 60);
  expect(g.resolutionScale).toBeCloseTo(0.8, 8);
});

test('거버너: 올림 직후 곧바로 내려가면 다음 올림 대기가 두 배로 늘어 같은 단계를 두드리지 않는다', () => {
  const g = new FrameGovernor({ scaleStorage: memoryStorage(JSON.stringify({ version: 1, scale: 0.7 })) }); g.reset(0);
  let t = 0, ups = 0, downs = 0, last = g.resolutionScale;
  // 해상도가 0.8 이상이면 무겁고(40ms) 0.7 이하이면 가벼운(16.7ms) 기기.
  for (; t < 120000; ) {
    const ms = g.resolutionScale >= 0.79 ? 40 : 1000 / 60;
    t += ms;
    if (g.advance(t, 'battle', true)) g.recordFrame(t, 2);
    if (g.resolutionScale > last + 1e-9) ups++; else if (g.resolutionScale < last - 1e-9) downs++;
    last = g.resolutionScale;
  }
  // 대기 10초 고정이면 120초 동안 약 9번 올렸을 것. 백오프(10→20→40→80초)로 훨씬 적다.
  expect(ups).toBeLessThanOrEqual(5);
  expect(downs).toBeLessThanOrEqual(ups);
});

test('거버너: 중간 과부하는 해상도가 먼저 흡수하고, 최저에 닿거나 심한 과부하일 때만 열 단계가 오른다', () => {
  const g = new FrameGovernor(); g.reset(0);
  // 약 45fps(22ms 간격) 지속 — 목표 60 대비 90% 미만이지만 끊김이 심하지는 않다.
  let t = 0;
  while (t < 20000) { t += 22.2; if (g.advance(t, 'battle', true)) g.recordFrame(t, 2); }
  expect(g.resolutionScale).toBeLessThan(1);
  expect(g.tier).toBeLessThanOrEqual(1);
});

test('거버너: lockResolution 은 자동 조절을 멈추고 이전 실행 배율은 저장·복원하며 손상된 값은 무시한다', () => {
  const locked = new FrameGovernor(); locked.reset(0); locked.lockResolution(1);
  drive(locked, 0, 30000, 40);
  expect(locked.resolutionScale).toBe(1);

  // 0.8 이상이면 무겁고 0.7 이하이면 가벼운 기기: 0.7 에서 안정되고, 한 분 넘게 유지된 값만 저장된다.
  const storage = memoryStorage();
  const g = new FrameGovernor({ scaleStorage: storage }); g.reset(0);
  let t = 0;
  while (t < 50000) { t += g.resolutionScale >= 0.79 ? 40 : 1000 / 60; if (g.advance(t, 'battle', true)) g.recordFrame(t, 2); }
  expect(g.resolutionScale).toBeGreaterThanOrEqual(0.7 - 1e-9);   // 0.7 에서 안정되고 가끔 0.8 을 시험한다
  expect(g.resolutionScale).toBeLessThanOrEqual(0.8 + 1e-9);
  expect(storage.data.has(PERF_SCALE_KEY)).toBe(false);
  while (t < 400000 && !storage.data.has(PERF_SCALE_KEY)) { t += g.resolutionScale >= 0.79 ? 40 : 1000 / 60; if (g.advance(t, 'battle', true)) g.recordFrame(t, 2); }
  const lowered = JSON.parse(storage.getItem(PERF_SCALE_KEY)!).scale;
  expect(lowered).toBeGreaterThanOrEqual(0.7 - 1e-9); expect(lowered).toBeLessThanOrEqual(0.8 + 1e-9);
  expect(JSON.parse(storage.getItem(PERF_SCALE_KEY)!)).toEqual({ version: 1, scale: lowered });
  expect(new FrameGovernor({ scaleStorage: storage }).resolutionScale).toBe(lowered);
  for (const raw of ['손상', 'null', '{"version":2,"scale":0.7}', '{"version":1,"scale":"x"}']) {
    expect(new FrameGovernor({ scaleStorage: memoryStorage(raw) }).resolutionScale).toBe(1);
  }
  const blocked = { getItem() { throw new Error('차단'); }, setItem() { throw new Error('용량 초과'); } };
  expect(new FrameGovernor({ scaleStorage: blocked as any }).resolutionScale).toBe(1);
});

test('Renderer.setResolutionScale 은 단계가 바뀔 때만 렌더 타깃을 다시 잡는다', () => {
  let resizes = 0;
  const renderer: any = Object.assign(Object.create(Renderer.prototype), { resolutionScale: 1, resize() { resizes++; } });
  renderer.setResolutionScale(1); expect(resizes).toBe(0);
  renderer.setResolutionScale(0.9); expect(resizes).toBe(1);
  renderer.setResolutionScale(0.9); renderer.setResolutionScale(0.91); expect(resizes).toBe(1);
  renderer.setResolutionScale(0.7); expect(resizes).toBe(2);
  renderer.setResolutionScale(0.2); expect(resizes).toBe(2);
  expect(renderer.resolutionScale).toBe(0.7);
});

test('캐릭터 텍스처: 밉맵 + LinearMipmapLinear + 이방성 min(8, 기기 최대)', () => {
  expect(characterAnisotropy(16)).toBe(8);
  expect(characterAnisotropy(4)).toBe(4);
  expect(characterAnisotropy(1)).toBe(1);
  expect(characterAnisotropy(NaN)).toBe(1);
  expect(CHARACTER_ANISOTROPY).toBe(8);
  const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].map(() => {
    const t = new THREE.Texture(); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.anisotropy = 1; return t;
  });
  const material: any = new THREE.MeshStandardMaterial();
  [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap] = maps;
  expect(tuneCharacterTextures(material, 8)).toBe(6);
  for (const t of maps) {
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.generateMipmaps).toBe(true);
    expect(t.anisotropy).toBe(8);
  }
  expect(tuneCharacterTextures(new THREE.MeshStandardMaterial(), 8)).toBe(0);
  expect(tuneCharacterTextures(null as any)).toBe(0);
});
