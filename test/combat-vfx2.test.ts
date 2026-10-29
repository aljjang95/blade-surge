import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, MARK_STYLE } from '../src/engine/impact-vfx.js';
import { screenSweep, cameraGroundForward } from '../src/engine/sig-screen.js';
import { sigTargets } from '../src/engine/skill-vfx.js';
import { SIGNATURES as ROGUE } from '../src/engine/sig-rogue.js';

// 정면 카메라: 영웅 뒤 위에서 +z(화면 안쪽)를 본다.
const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(0, 12, -10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const counting = (run: () => void) => { const real = Math.random; let n = 0; Math.random = () => { n++; return real(); }; try { run(); } finally { Math.random = real; } return n; };
const slots = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => ({ kind: v.ring.a.aShape[i * 4], style: v.ring.a.aShape[i * 4 + 3], start: v.ring.a.aLife[i * 2] }));

test('screenSweep: 화면 가로축 빗장을 n 개 켜고, 화면 안쪽 경로일수록 넓으며, Math.random 을 쓰지 않는다', () => {
  const cam = camera(), cf = cameraGroundForward(cam, new THREE.Vector3())!;
  expect(cf.z).toBeGreaterThan(.99);
  const into = make(), side = make();
  const n = counting(() => screenSweep(into, cam, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 2, 9, { n: 5 }));
  expect(n).toBe(0);
  expect(into.spawned).toBe(5);
  screenSweep(side, cam, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 2, 9, { n: 5 });
  expect(side.spawned).toBe(5);
  // 카메라 없음(테스트·미초기화): 경로 수직축으로 그린다.
  const none = make(); expect(screenSweep(none, null, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 2, 9, { n: 3 })).toBe(3);
  expect(screenSweep({}, cam, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 2, 9)).toBe(0);
});

test('sigTargets: skills.js targets 와 같은 규칙(살아 있고 출현 중 아님, range 안, 가까운 순 max 명), sorted=false 는 배열 순서', () => {
  const player = { pos: new THREE.Vector3(), distTo(o: any) { return Math.hypot(o.pos.x, o.pos.z); } };
  const e = (x: number, z: number, extra = {}) => ({ alive: true, spawning: false, pos: new THREE.Vector3(x, 0, z), ...extra });
  const enemies = [e(9, 0), e(2, 0), e(0, 20), e(4, 0, { alive: false }), e(5, 0, { spawning: true }), e(6, 0)];
  const game = { enemies };
  expect(sigTargets(game, player, 8, 13).map((t) => t.pos.x)).toEqual([2, 6, 9]);
  expect(sigTargets(game, player, 2, 13).map((t) => t.pos.x)).toEqual([2, 6]);
  expect(sigTargets(game, player, 8, 13, false).map((t) => t.pos.x)).toEqual([9, 2, 6]);
  expect(sigTargets({}, player)).toEqual([]);
});

test('그림자 표식·공허 보법 서명은 ctx.targets 가 주는 실제 표적 위에 표식을 찍는다', () => {
  const ts = [{ pos: new THREE.Vector3(7, 0, 3) }, { pos: new THREE.Vector3(-5, 0, 6) }];
  const base = { fx: null, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(0, 0, 5), f: new THREE.Vector3(0, 0, 1), lite: false, scale: 1 };
  const v = make();
  ROGUE.shadow_mark({ ...base, impact: v, targets: () => ts } as any);
  const reticles = Array.from({ length: v.ring.high }, (_, i) => i).filter((i) => v.ring.a.aShape[i * 4] === IMPACT_KIND.mark && v.ring.a.aShape[i * 4 + 3] === MARK_STYLE.reticle);
  expect(reticles.length).toBe(2);
  // 표적이 없으면 예전 부채 자리(6개)로 그린다.
  const w = make(); ROGUE.shadow_mark({ ...base, impact: w, targets: () => [] } as any);
  expect(slots(w).filter((s) => s.kind === IMPACT_KIND.mark && s.style === MARK_STYLE.reticle).length).toBe(6);
  // 공허 보법: 표적이 있으면 예외 없이 그리고 Math.random 을 쓰지 않는다(표적 하나면 같은 자리 획은 건너뛴다).
  for (const list of [ts, [ts[0]], []]) {
    const u = make();
    expect(counting(() => ROGUE.void_step({ ...base, impact: u, targets: () => list } as any))).toBe(0);
    expect(u.spawned).toBeGreaterThan(0);
  }
});
