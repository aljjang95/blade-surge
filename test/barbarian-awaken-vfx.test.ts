import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, IMPACT_FRAME_BUDGET, MARK_STYLE } from '../src/engine/impact-vfx.js';
import { SKILL_SIGNATURES, SKILL_PRELUDES } from '../src/engine/skill-signatures.js';
import { SKILL_VFX } from '../src/engine/skill-vfx.js';
import { barbRushEnd } from '../src/engine/sig-barbarian.js';

// 광전사 각성 4종(슬롯 4~7) 서명·서곡 계약(강화 레인 2026-10-30).
const AWAKEN = ['bull_rush', 'magma_zone', 'bloodquake', 'cataclysm'] as const;
const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const ctxOf = (v: ImpactVfx, lite = false) => ({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(0, 0, 6), f: new THREE.Vector3(0, 0, 1), lite, scale: 1 }) as any;
const slots = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => ({
  kind: v.ring.a.aShape[i * 4], start: v.ring.a.aLife[i * 2], end: v.ring.a.aLife[i * 2 + 1], size: v.ring.a.aShape[i * 4 + 1], style: v.ring.a.aShape[i * 4 + 3],
  rgb: [v.ring.a.aColor[i * 3], v.ring.a.aColor[i * 3 + 1], v.ring.a.aColor[i * 3 + 2]],
}));

test('각성 서명은 한 번에 60칸 이하, lite 는 더 적게, 빨강 우세 색·흰 코어 없음', () => {
  for (const id of AWAKEN) {
    const v = make(), l = make();
    SKILL_SIGNATURES[id](ctxOf(v)); SKILL_SIGNATURES[id](ctxOf(l, true));
    expect(v.spawned).toBeGreaterThan(20); expect(v.spawned).toBeLessThanOrEqual(60);
    expect(l.spawned).toBeLessThan(v.spawned);
    for (const x of slots(v)) {
      expect(x.kind).not.toBe(IMPACT_KIND.core);
      expect(x.rgb[0]).toBeGreaterThan(x.rgb[1]); expect(x.rgb[0]).toBeGreaterThan(x.rgb[2]);
    }
    v.dispose(); l.dispose();
  }
});

test('각성 서곡(용암 분출·진·종말): 합본에 있고 칸 예산 안·lite 는 더 적게·Math.random 미사용', () => {
  for (const id of ['magma_zone', 'cataclysm']) {
    expect(typeof SKILL_PRELUDES[id]).toBe('function');
    const v = make(), l = make();
    const real = Math.random; let calls = 0; Math.random = () => { calls++; return real(); };
    try { SKILL_PRELUDES[id](ctxOf(v)); SKILL_PRELUDES[id](ctxOf(l, true)); } finally { Math.random = real; }
    expect(calls).toBe(0);
    expect(v.spawned).toBeGreaterThan(0); expect(v.spawned).toBeLessThanOrEqual(IMPACT_FRAME_BUDGET - 3);
    expect(l.spawned).toBeLessThan(v.spawned);
    v.dispose(); l.dispose();
  }
});

test('용암 분출·진 서곡: 기둥 여섯 자리(반경 4.6m)에 조준 원, 각자 제 기둥이 솟는 순간(.43+i×.11초) 직후 사라진다', () => {
  const v = make(); SKILL_PRELUDES.magma_zone(ctxOf(v));
  const marks = slots(v).filter((s) => s.kind === IMPACT_KIND.mark && s.style === MARK_STYLE.reticle);
  expect(marks).toHaveLength(6);
  const ends = marks.map((m) => m.end).sort((a, b) => a - b);
  ends.forEach((e, i) => expect(e).toBeCloseTo(.43 + i * .11 + .04, 3));
  v.dispose();
});

test('혈왕 흡인 팔은 판정 2차 붕괴(.2초) 전에 몸 쪽에 닿고, 종말 혜성은 분화(.3초)에 착탄점에 닿는다', () => {
  const v = make(); SKILL_SIGNATURES.bloodquake(ctxOf(v));
  expect(Math.max(...slots(v).map((s) => s.start))).toBeLessThanOrEqual(.2 + .06);
  v.dispose();
  const c = make(); SKILL_SIGNATURES.cataclysm(ctxOf(c));
  // 혜성 궤적: 도약 정점(7.5m)에서 출발한 시전 순간 광선 — 수명 = (길이 + 꼬리)/속도, 머리 도달 = .3초.
  const A = c.ring.a; let comets = 0;
  for (let i = 0; i < c.ring.high; i++) {
    if (A.aShape[i * 4] !== IMPACT_KIND.beam || Math.abs(A.aOrigin[i * 3 + 1] - 7.5) > 1e-4) continue;
    comets++;
    const L = Math.hypot(A.aVel[i * 3], A.aVel[i * 3 + 1], A.aVel[i * 3 + 2]);
    expect(L / A.aMotion[i * 2]).toBeCloseTo(.3, 3); // 머리가 착탄점에 닿는 시각 = 분화 판정 시각
    expect(A.aOrigin[i * 3 + 1] + A.aVel[i * 3 + 1]).toBeCloseTo(.3, 3); // 착탄점 바닥 높이에서 끝난다
  }
  expect(comets).toBeGreaterThanOrEqual(1);
  c.dispose();
});

test('돌진 끝 폭발은 칸 상한(36) 안이고 사방이 아니라 전방 부채로 균열을 낸다', () => {
  const v = make(); const g = { fx: { impact: v, lite: false }, app: { reducedMotion: { matches: false } } } as any;
  expect(barbRushEnd(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1))).toBeLessThanOrEqual(36);
  const A = v.ring.a; let back = 0;
  for (let i = 0; i < v.ring.high; i++) {
    if (A.aShape[i * 4] !== IMPACT_KIND.beam) continue;
    const y0 = A.aOrigin[i * 3 + 1], vz = A.aVel[i * 3 + 2], vy = A.aVel[i * 3 + 1];
    if (y0 < .1 && Math.abs(vy) < 1e-6 && vz < -1e-3) back++; // 지면 균열 중 뒤로 향하는 것
  }
  expect(back).toBe(0);
  v.dispose();
});

test('마그마·혈왕·종말은 영웅 둘레 원형 원화·공용 룬 대신 서명이 모양을 맡는다', () => {
  for (const id of ['magma_zone', 'bloodquake', 'cataclysm']) {
    const r = (SKILL_VFX as any)[id];
    expect(r.noRune).toBe(true); expect(r.sig).toBe(true); expect(r.mode).toBe('none');
  }
  expect((SKILL_VFX as any).cataclysm.noBurst).toBe(true);
});
