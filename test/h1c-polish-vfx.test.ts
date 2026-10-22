import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, BEAM_STYLE } from '../src/engine/impact-vfx.js';
import { SKILL_SIGNATURES, screenReach, SCREEN_REACH } from '../src/engine/skill-signatures.js';
import { SKILL_VFX, castSkillVfx } from '../src/engine/skill-vfx.js';

// h1c 다듬기: 얼음 가시·분광 선 모양, 화염구·프리즘 시전 덩어리 생략, 궁수 관통 끝점 화면 클램프.
const make = () => new ImpactVfx(new THREE.Scene());
const beams = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => i).filter(i => v.ring.a.aShape[i * 4] === IMPACT_KIND.beam);

test('눈보라 얼음 가시·소용돌이는 흰 심 없는 얼음 광선(BEAM_STYLE.ice)으로 그린다', () => {
  const v = make();
  SKILL_SIGNATURES.blizzard({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(), f: new THREE.Vector3(0, 0, 1), lite: false, scale: 1 } as any);
  const b = beams(v);
  expect(b.length).toBeGreaterThan(10);
  for (const i of b) expect(v.ring.a.aShape[i * 4 + 2]).toBe(BEAM_STYLE.ice);
  v.dispose();
});

test('프리즘 시전은 삼각 프리즘 윤곽 + 스펙트럼 다섯 갈래를 분광 선으로 그리고 고리(옅은 원)를 내지 않는다', () => {
  const v = make();
  SKILL_SIGNATURES.arc_reflect({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(), f: new THREE.Vector3(0, 0, 1), lite: false, scale: 1 } as any);
  const b = beams(v);
  expect(b).toHaveLength(3 + 5);
  for (const i of b) expect(v.ring.a.aShape[i * 4 + 2]).toBe(BEAM_STYLE.prism);
  const kinds = Array.from({ length: v.ring.high }, (_, i) => v.ring.a.aShape[i * 4]);
  expect(kinds).not.toContain(IMPACT_KIND.ring);
  expect(kinds).not.toContain(IMPACT_KIND.core);
  v.dispose();
});

test('화염구·프리즘 레시피는 시전 순간 전방 원화·섬광·임팩트 코어를 생략한다(noBurst)', () => {
  for (const id of ['fireball', 'arc_reflect']) {
    expect((SKILL_VFX as any)[id].noBurst).toBe(true);
    expect((SKILL_VFX as any)[id].mode).toBe('none');
    const calls: any[] = []; const rec = (k: string) => (...a: any[]) => calls.push([k, ...a]);
    const impact = make(); let bursts = 0; impact.burst = (() => { bursts++; return 0; }) as any;
    const fx: any = { items: [], lite: false, groundTex: rec('ground'), texFlash: rec('flash'), flash: rec('light'), burst: rec('burst'), impact };
    const game: any = { fx, app: { reducedMotion: { matches: false } }, renderer: { shake() {} } };
    const player: any = { pos: new THREE.Vector3(), forward: (o: THREE.Vector3) => o.set(0, 0, 1), def: {}, stats: {} };
    expect(castSkillVfx(game, id, player)).toBe(true);
    expect(calls.filter(c => c[0] === 'flash' || c[0] === 'light' || c[0] === 'burst')).toEqual([]);
    expect(bursts).toBe(0);
    impact.dispose();
  }
});

test('관통 끝점은 카메라 시야 안으로 표시만 당기고 관통점 지연은 화살 통과 시각과 같다', () => {
  // 844x390 가로 화면, 영웅 뒤 위에서 진행 방향(-z)을 내려다보는 카메라.
  const cam = new THREE.PerspectiveCamera(42, 844 / 390, .1, 200);
  cam.position.set(0, 13, 9); cam.lookAt(0, 0, -3); cam.updateMatrixWorld(true);
  const f = new THREE.Vector3(0, 0, -1), o = new THREE.Vector3();
  const end = screenReach(cam, o, f, 11, 2.2);
  expect(end).toBeLessThan(11);
  expect(end).toBeGreaterThanOrEqual(SCREEN_REACH.min);
  // 끝점 표식 바깥 가장자리가 화면 안이다.
  const p = new THREE.Vector3(0, 0, -(end + 2.2)).project(cam);
  expect(p.y).toBeLessThanOrEqual(SCREEN_REACH.y); expect(Math.abs(p.x)).toBeLessThanOrEqual(SCREEN_REACH.x);
  // 카메라가 없으면 원래 거리.
  expect(screenReach(null, o, f, 11, 2.2)).toBe(11);
  const v = make();
  SKILL_SIGNATURES.ranger_pierce({ fx: { camera: cam }, impact: v, player: { pos: o }, at: new THREE.Vector3(), f, lite: false, scale: 1 } as any);
  const stars = Array.from({ length: v.ring.high }, (_, i) => i).filter(i => v.ring.a.aShape[i * 4] === IMPACT_KIND.star && v.ring.a.aLife[i * 2] > 0);
  const k = end / 11;
  expect(stars.map(i => +v.ring.a.aLife[i * 2].toFixed(4))).toEqual([3.5 * k, 6.5 * k, 9.5 * k, end].map(d => +(d / 27).toFixed(4)));
  // 끝점 별빛의 월드 위치가 화면 안이다.
  const last = stars[stars.length - 1], q = new THREE.Vector3(v.ring.a.aOrigin[last * 3], v.ring.a.aOrigin[last * 3 + 1], v.ring.a.aOrigin[last * 3 + 2]).project(cam);
  expect(q.y).toBeLessThan(1); expect(Math.abs(q.x)).toBeLessThan(1);
  v.dispose();
});
