import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, IMPACT_FRAME_BUDGET } from '../src/engine/impact-vfx.js';
import { SIGNATURES, KNIGHT_SIG_TIMING, KNIGHT_SIG_MAX_SLOTS, KNIGHT_SIG_COLOR, KNIGHT_MARK_MAX_RADIUS } from '../src/engine/sig-knight.js';
import { SKILL_VFX } from '../src/engine/skill-vfx.js';
import { HERO_SKILLS } from '../src/engine/combat-sound-library.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const ctxOf = (impact: ImpactVfx, lite = false) => ({ fx: null, impact, player: { pos: new THREE.Vector3(1, 0, 2) }, at: new THREE.Vector3(1, 0, 9), f: new THREE.Vector3(0, 0, 1), lite, scale: 1 } as any);
/** 쓴 칸 목록: 종류, 크기, 시작 시각(지연), 표식 모양. */
const slots = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => ({
  kind: v.ring.a.aShape[i * 4], size: v.ring.a.aShape[i * 4 + 1], style: v.ring.a.aShape[i * 4 + 3],
  start: v.ring.a.aLife[i * 2], color: [v.ring.a.aColor[i * 3], v.ring.a.aColor[i * 3 + 1], v.ring.a.aColor[i * 3 + 2]],
}));

test('검성 스킬 8개 모두 서명이 있고, 레시피는 크림 원화(flash/ground) 대신 서명을 쓴다', () => {
  for (const id of HERO_SKILLS.knight) {
    expect(typeof SIGNATURES[id]).toBe('function');
    const r = (SKILL_VFX as any)[id];
    expect(r.sig).toBe(true);
    expect(r.mode).toBe('none');
  }
});

test('서명은 예외 없이 칸 상한 안에서 그리고, 스킬마다 모양 구성이 다르다(lite 는 더 적게)', () => {
  const shapes = HERO_SKILLS.knight.map((id: string) => {
    const v = make();
    const nativeRandom = Math.random; let calls = 0;
    Math.random = () => { calls++; return nativeRandom(); };
    try { SIGNATURES[id](ctxOf(v)); } finally { Math.random = nativeRandom; }
    expect(calls).toBe(0);
    const s = slots(v);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(KNIGHT_SIG_MAX_SLOTS);
    expect(s.length).toBeLessThan(IMPACT_FRAME_BUDGET);
    const lite = make(); SIGNATURES[id](ctxOf(lite, true));
    expect(lite.ring.high).toBeLessThanOrEqual(s.length);
    lite.dispose(); v.dispose();
    return s.map(x => x.kind === IMPACT_KIND.mark ? 'm' + x.style : String(x.kind)).sort().join(',');
  });
  expect(new Set(shapes).size).toBe(HERO_SKILLS.knight.length);
});

test('화면을 가로지르는 큰 빌보드 고리(지름 3.5m 초과)·굵은 바퀴가 되는 큰 지면 표식(반경 2m 초과)을 쓰지 않는다', () => {
  const wide = new THREE.Color(KNIGHT_SIG_COLOR.wide), wideGold = new THREE.Color(KNIGHT_SIG_COLOR.wideGold);
  void wide; void wideGold;
  for (const id of HERO_SKILLS.knight) {
    const v = make(); SIGNATURES[id](ctxOf(v));
    for (const s of slots(v)) {
      if (s.kind === IMPACT_KIND.ring) expect(s.size).toBeLessThanOrEqual(3.5);
      if (s.kind === IMPACT_KIND.mark) expect(s.size).toBeLessThanOrEqual(KNIGHT_MARK_MAX_RADIUS);
    }
    v.dispose();
  }
});

test('지연 칸은 skills.js 판정 시각과 맞는다: 태양파쇄 2타 .18, 신벌 .28 착탄, 결박 파열 1.75', () => {
  const starts = (id: string, kind: number) => { const v = make(); SIGNATURES[id](ctxOf(v)); const s = slots(v).filter(x => x.kind === kind).map(x => x.start); v.dispose(); return s; };
  expect(KNIGHT_SIG_TIMING).toEqual({ sunbreakerSecond: .18, heavenfallHit: .28, chainBurst: 1.75 });
  expect(starts('sunbreaker', IMPACT_KIND.beam)).toContainEqual(expect.closeTo(.18, 5));
  expect(starts('sunbreaker', IMPACT_KIND.ring)).toContainEqual(expect.closeTo(.18, 5));
  expect(starts('heavenfall', IMPACT_KIND.ring)).toContainEqual(expect.closeTo(.28, 5));
  expect(starts('chain_bind', IMPACT_KIND.beam)).toContainEqual(expect.closeTo(1.75, 5));
  expect(starts('chain_bind', IMPACT_KIND.ring)).toContainEqual(expect.closeTo(1.75, 5));
  // 신벌 낙하 기둥: 하늘(14m)에서 110m/s 로 떨어져 정확히 .28초에 바닥에 닿도록 출발한다(세로 광선만).
  const v = make(); SIGNATURES.heavenfall(ctxOf(v));
  const beams = Array.from({ length: v.ring.high }, (_, i) => i).filter(i => v.ring.a.aShape[i * 4] === IMPACT_KIND.beam && v.ring.a.aVel[i * 3 + 1] < -5);
  expect(beams.length).toBeGreaterThanOrEqual(4);
  for (const i of beams) {
    const len = Math.hypot(v.ring.a.aVel[i * 3], v.ring.a.aVel[i * 3 + 1], v.ring.a.aVel[i * 3 + 2]);
    const speed = v.ring.a.aMotion[i * 2];
    expect(v.ring.a.aLife[i * 2] + len / speed).toBeCloseTo(.28, 4);
  }
  v.dispose();
});

test('궁극기 용살검이 가장 장대하다: 수직 참격 + 부채 균열 + 부채꼴 표식', () => {
  const v = make(); SIGNATURES.dragon_slash(ctxOf(v));
  const s = slots(v);
  const vertical = Array.from({ length: v.ring.high }, (_, i) => i).filter(i => v.ring.a.aShape[i * 4] === IMPACT_KIND.beam && v.ring.a.aVel[i * 3 + 1] < -5);
  expect(vertical.length).toBeGreaterThanOrEqual(3);
  expect(s.filter(x => x.kind === IMPACT_KIND.cut).length).toBeGreaterThanOrEqual(2);
  const counts = HERO_SKILLS.knight.map((id: string) => { const w = make(); SIGNATURES[id](ctxOf(w)); const n = w.ring.high; w.dispose(); return n; });
  expect(s.length).toBe(Math.max(...counts));
  v.dispose();
});

test('성역 기둥 지오메트리는 기둥 수별로 캐시돼 lite↔정상 전환에도 새로 만들거나 버리지 않는다', async () => {
  const { sanctumPillarGeometry } = await import('../src/engine/sanctum-vfx.js');
  const a8 = sanctumPillarGeometry(8), a4 = sanctumPillarGeometry(4);
  expect(sanctumPillarGeometry(8)).toBe(a8);
  expect(sanctumPillarGeometry(4)).toBe(a4);
  expect(a4).not.toBe(a8);
  expect(a4.getIndex()!.count).toBe(4 * 6);
});

test('검성 예비 표식(PRELUDES): 기본 3 + 궁극기 모두 있고, 결정적이며 칸 상한·지면 표식 반경 안에서 그린다', async () => {
  const { PRELUDES } = await import('../src/engine/sig-knight.js');
  const { SKILL_PRELUDES } = await import('../src/engine/skill-signatures.js');
  for (const id of ['holy_slash', 'shield_bash', 'judgment', 'dragon_slash']) {
    expect(typeof (PRELUDES as any)[id]).toBe('function');
    expect((SKILL_PRELUDES as any)[id]).toBe((PRELUDES as any)[id]);
    const v = make(), l = make(); const real = Math.random; let calls = 0;
    Math.random = () => { calls++; return real(); };
    try { (PRELUDES as any)[id](ctxOf(v)); (PRELUDES as any)[id](ctxOf(l, true)); } finally { Math.random = real; }
    expect(calls).toBe(0);
    expect(v.ring.high).toBeGreaterThan(0);
    expect(v.ring.high).toBeLessThanOrEqual(KNIGHT_SIG_MAX_SLOTS);
    expect(l.ring.high).toBeLessThanOrEqual(v.ring.high);
    for (const s of slots(v)) if (s.kind === IMPACT_KIND.mark) expect(s.size).toBeLessThanOrEqual(KNIGHT_MARK_MAX_RADIUS);
    v.dispose(); l.dispose();
  }
});

test('뺀 텍스처 연출의 난수 소비(KNIGHT_RETIRED_DRAWS)는 실제 FX 호출의 캐시 뒤 횟수와 같고, 가짜 fx 에서는 소비하지 않는다', async () => {
  const { FX } = await import('../src/engine/fx.js');
  const { KNIGHT_RETIRED_DRAWS, knightRetiredDraws } = await import('../src/engine/sig-knight.js');
  // 실제 게임처럼 원화가 로드된 경로로 잰다(원화가 없으면 firePillar 가 pillar 대체 경로로 빠져 횟수가 달라진다).
  const { VFX_TEX: tex, VFX_LIST } = await import('../src/engine/assets.js');
  const VFX_TEX = tex as Record<string, unknown>;
  const savedTex = { ...VFX_TEX };
  for (const n of VFX_LIST) VFX_TEX[n] ||= new THREE.Texture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }) } });
  const fx: any = new FX(new THREE.Scene(), new THREE.PerspectiveCamera());
  try {
    const p = new THREE.Vector3();
    const calls: Record<string, () => void> = {
      rune: () => fx.groundTex(p, 'circle_gold', 0xffa018, { r0: 1, r1: 2.4, life: 1, spin: 1.6, y: .07, fadeIn: .2, hold: .35, gain: .45 }),
      castCircle: () => fx.castCircle(p, 0xff9a18, { radius: 5, life: .25 }),
      firePillar: () => fx.firePillar(p, { height: 10, width: 1.6, life: 1, color: 0xff9a18 }),
      holyBurst: () => fx.holyBurst(p, { size: 1.6, life: .24, color: 0xff9a18 }),
      shockTex: () => fx.shockTex(p, 0xff9a20, { r1: 6, life: .5 }),
    };
    const count = (run: () => void) => { const real = Math.random; let n = 0; Math.random = () => { n++; return real(); }; try { run(); } finally { Math.random = real; } return n; };
    for (const [k, run] of Object.entries(calls)) { run(); expect(count(run)).toBe((KNIGHT_RETIRED_DRAWS as any)[k]); }
    expect(count(() => knightRetiredDraws(fx, 8))).toBe(8);
    expect(count(() => knightRetiredDraws({ castCircle() {} }, 8))).toBe(0);
  } finally {
    fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document;
    for (const n of Object.keys(VFX_TEX)) if (!(n in savedTex)) delete VFX_TEX[n];
  }
});

test('심판 표적 박자(knightJudgmentStrike): 하늘 별빛은 판정 .1초 전, 바닥 별빛·균열은 판정 순간에 켜진다', async () => {
  const { knightJudgmentStrike } = await import('../src/engine/sig-knight.js');
  const v = make(); const n = knightJudgmentStrike(v, new THREE.Vector3(2, 0, 3), .21, 3);
  const s = slots(v);
  expect(n).toBe(s.length);
  expect(s.filter(x => x.kind === IMPACT_KIND.star).map(x => x.start).sort()).toEqual([expect.closeTo(.11, 5), expect.closeTo(.21, 5)]);
  for (const b of s.filter(x => x.kind === IMPACT_KIND.beam)) expect(b.start).toBeCloseTo(.21, 5);
  const lite = make(); expect(knightJudgmentStrike(lite, new THREE.Vector3(), 0, 0, true)).toBeLessThan(n);
  v.dispose(); lite.dispose();
});
