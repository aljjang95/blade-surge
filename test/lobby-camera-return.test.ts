import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Renderer } from '../src/engine/renderer.js';
import { lobbyCameraPosition, normalizeLobbyCamera } from '../src/engine/lobby-camera.js';

// 전투 → 결과 → 로비 복귀 직후 카메라가 전투 좌표에서 광장을 가로질러 날아가며 나무를 지나던 결함(UX R9)의 회귀.
const noop = () => {};
function fixture() {
  return Object.assign(Object.create(Renderer.prototype), {
    camera: new THREE.PerspectiveCamera(46, 1440 / 900, .1, 200), _width: 1440, _height: 900, battleMinimumAspect: 0,
    rig: { target: new THREE.Vector3(2, 0, -4), pos: new THREE.Vector3(2, 8.7, 6.1), offset: new THREE.Vector3(0, 8.7, 10.1),
      lookOffset: new THREE.Vector3(0, .82, 0), side: 0, environmentSide: 0, mode: 'battle', fov: 46, lag: 6, trauma: 0, zoom: 0 },
    battleCamera: { yaw: 0, pitch: 0, zoom: 100 }, battleOcclusion: { update: noop }, lobbyCamera: normalizeLobbyCamera(null),
    lobbyNavigation: false, lobbyOccluders: [], time: 0, flash: 0, aberr: 0, radial: 0, desat: 0, postFxEnabled: false, quality: 'high',
    u: Object.fromEntries(['uFlash', 'uAberr', 'uRadial', 'uDesat', 'uTime'].map(key => [key, { value: 0 }])),
    _updateGrade: noop, _updateRim: noop,
  }) as any;
}
function withWindow(fn: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { innerWidth: 1440, innerHeight: 900 }, configurable: true });
  try { fn(); } finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete (globalThis as any).window; }
}
const lobbySeat = (r: any) => { const p = lobbyCameraPosition(r.lobbyCamera); return new THREE.Vector3(p.x, p.y, p.z).add(r.rig.target); };

test('the first lobby frame after battle seats the camera instead of flying across the plaza', () => withWindow(() => {
  const r = fixture();
  for (let i = 0; i < 5; i++) r.update(1 / 60, 1 / 60);            // 전투 프레임
  r.rig.pos.set(80, 14, -60);                                      // 먼 전투 좌표에 있던 카메라
  r.rig.mode = 'lobby'; r.rig.target.set(0, 0, 0);                 // toLobby/showcaseHero
  r.update(1 / 60, 1 / 60);
  expect(r.camera.position.distanceTo(lobbySeat(r))).toBeLessThan(1e-6);
}));

test('inside the lobby, orbit and walk changes still ease instead of snapping', () => withWindow(() => {
  const r = fixture();
  r.rig.mode = 'lobby'; r.rig.target.set(0, 0, 0);
  r.update(1 / 60, 1 / 60);
  const start = r.camera.position.clone();
  r.lobbyCamera = normalizeLobbyCamera({ yaw: 109, pitch: 16, zoom: 100 });
  r.update(1 / 60, 1 / 60);
  const goal = lobbySeat(r), moved = r.camera.position.distanceTo(start), remaining = r.camera.position.distanceTo(goal);
  expect(moved).toBeGreaterThan(0); expect(remaining).toBeGreaterThan(moved);
}));

