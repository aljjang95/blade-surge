import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, MARK_STYLE, IMPACT_FRAME_BUDGET } from '../src/engine/impact-vfx.js';
import { SIGNATURES } from '../src/engine/sig-rogue.js';
import { SKILL_SIGNATURES } from '../src/engine/skill-signatures.js';
import { SKILL_VFX } from '../src/engine/skill-vfx.js';
import { HERO_SKILLS } from '../src/engine/combat-sound-library.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const ctxOf = (impact: ImpactVfx, lite = false) => ({ fx: null, impact, player: { pos: new THREE.Vector3(1, 0, 2) }, at: new THREE.Vector3(1, 0, 9), f: new THREE.Vector3(0, 0, 1), lite, scale: 1 } as any);
const slots = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => ({
  kind: v.ring.a.aShape[i * 4], size: v.ring.a.aShape[i * 4 + 1], style: v.ring.a.aShape[i * 4 + 3], start: v.ring.a.aLife[i * 2],
  color: new THREE.Color(v.ring.a.aColor[i * 3], v.ring.a.aColor[i * 3 + 1], v.ring.a.aColor[i * 3 + 2]),
}));
/** 시전 프레임에 같이 쓰는 칸(레시피 burst 3 + 투사체 궤적)을 남겨 둘 여유. */
const SIG_MAX = IMPACT_FRAME_BUDGET - 20;

test('암살자·궁수 스킬 16개 모두 서명이 있고 합본에 들어 있다', () => {
  for (const id of [...HERO_SKILLS.rogue, ...HERO_SKILLS.ranger]) expect(typeof SKILL_SIGNATURES[id]).toBe('function');
  for (const id of HERO_SKILLS.rogue) expect(SKILL_SIGNATURES[id]).toBe(SIGNATURES[id]);
});

test('암살자 서명: 예외 없음, Math.random 미사용, 칸 상한, lite 는 더 적게, 스킬마다 모양 구성이 다르다', () => {
  const shapes = HERO_SKILLS.rogue.map((id: string) => {
    const v = make(); const nativeRandom = Math.random; let calls = 0;
    Math.random = () => { calls++; return nativeRandom(); };
    try { SIGNATURES[id](ctxOf(v)); } finally { Math.random = nativeRandom; }
    expect(calls).toBe(0);
    const s = slots(v);
    expect(s.length).toBeGreaterThan(3);
    expect(s.length).toBeLessThanOrEqual(SIG_MAX);
    const lite = make(); SIGNATURES[id](ctxOf(lite, true));
    expect(lite.ring.high).toBeLessThanOrEqual(s.length);
    lite.dispose(); v.dispose();
    return s.map(x => x.kind === IMPACT_KIND.mark ? 'm' + x.style : String(x.kind)).sort().join(',');
  });
  expect(new Set(shapes).size).toBe(HERO_SKILLS.rogue.length);
});

test('암살자 서명은 보라 계열이고(독무만 독 초록 허용), 큰 빌보드 고리를 쓰지 않는다', () => {
  for (const id of HERO_SKILLS.rogue) {
    const v = make(); SIGNATURES[id](ctxOf(v));
    for (const s of slots(v)) {
      if (s.kind === IMPACT_KIND.ring) expect(s.size).toBeLessThanOrEqual(3.5);
      const hsl = { h: 0, s: 0, l: 0 }; s.color.getHSL(hsl);
      expect(hsl.s).toBeGreaterThan(.5); // 회색·흰색으로 죽지 않는다
      const violet = hsl.h > .68 && hsl.h < .86, poison = id === 'poison_bomb' && hsl.h > .25 && hsl.h < .4;
      expect(violet || poison).toBe(true);
    }
    v.dispose();
  }
});

test('지연 칸이 skills.js 판정 시각과 맞는다: 독무 착탄 .5, 일식 .3, 야행 0/.1/.2, 천 개의 칼날 박자 +.13', () => {
  const starts = (id: string, pred: (x: any) => boolean) => { const v = make(); SIGNATURES[id](ctxOf(v)); const s = slots(v).filter(pred).map(x => x.start); v.dispose(); return s; };
  expect(starts('poison_bomb', x => x.kind === IMPACT_KIND.mark && x.style === MARK_STYLE.thorn)).toEqual([expect.closeTo(.5, 5), expect.closeTo(.5, 5)]);
  expect(starts('eclipse_edge', x => x.kind === IMPACT_KIND.mark && x.style === MARK_STYLE.clock)).toEqual([expect.closeTo(.3, 5)]);
  expect([...new Set(starts('night_parade', x => x.kind === IMPACT_KIND.cut).map(t => +t.toFixed(3)))].sort()).toEqual([0, .1, .2]);
  // 독무: 독 기둥(위로 솟는 광선)은 착탄(.5초) 뒤에만 피어오르고, 바깥 웅덩이 테는 적 무리(반경 4.2)보다 넓다.
  { const v = make(); SIGNATURES.poison_bomb(ctxOf(v)); const A = v.ring.a; let cols = 0;
    for (let i = 0; i < v.ring.high; i++) if (A.aShape[i * 4] === IMPACT_KIND.beam && A.aVel[i * 3 + 1] > 0 && Math.abs(A.aVel[i * 3]) < 1e-6 && Math.abs(A.aVel[i * 3 + 2]) < 1e-6) { cols++; expect(A.aLife[i * 2]).toBeGreaterThanOrEqual(.5); }
    expect(cols).toBe(8);
    expect(Math.max(...slots(v).filter(x => x.kind === IMPACT_KIND.mark && x.style === MARK_STYLE.thorn).map(x => x.size))).toBeGreaterThan(5);
    v.dispose(); }
  // 천 개의 칼날: 하늘 칼날 광선이 박자(.15×n + .13)에 정확히 바닥에 닿는다.
  const v = make(); SIGNATURES.thousand(ctxOf(v));
  const A = v.ring.a; let n = 0;
  for (let i = 0; i < v.ring.high; i++) {
    if (A.aShape[i * 4] !== IMPACT_KIND.beam) continue; n++;
    const hit = A.aLife[i * 2] + Math.hypot(A.aVel[i * 3], A.aVel[i * 3 + 1], A.aVel[i * 3 + 2]) / A.aMotion[i * 2];
    const wave = (hit - .13) / .15;
    expect(Math.abs(wave - Math.round(wave))).toBeLessThan(1e-3);
  }
  expect(n).toBeGreaterThanOrEqual(6);
  v.dispose();
});

test('암살자 레시피는 원화를 나눠 쓴다(전부 같은 그림자 참격 원화 금지)', () => {
  const tex = HERO_SKILLS.rogue.map((id: string) => { const r = (SKILL_VFX as any)[id]; return r.mode === 'none' ? 'none' : r.tex; });
  expect(new Set(tex).size).toBeGreaterThanOrEqual(4);
});

test('궁극기 예비 표식(시전 연출 중): 폭풍·천 개의 칼날 둘 다 있고, Math.random 미사용·칸 상한·lite 는 더 적게', async () => {
  const { SKILL_PRELUDES } = await import('../src/engine/skill-signatures.js');
  // 검성 기본 3 + 궁극기 예비 표식(sig-knight PRELUDES)도 같은 합본에 든다.
  expect(Object.keys(SKILL_PRELUDES).sort()).toEqual(['absolute_zero', 'cataclysm', 'chain_bind', 'dragon_slash', 'gale_hunt', 'heavenfall', 'hell_axe', 'holy_slash', 'judgment', 'magma_zone', 'meteor', 'moonlit_hunt', 'nine_lives', 'ranger_binding', 'ranger_quickshot', 'ranger_tempest', 'sanctuary', 'shield_bash', 'skyfall_arrows', 'star_prison', 'sunbreaker', 'thousand']);
  for (const id of Object.keys(SKILL_PRELUDES)) {
    const v = make(); const nativeRandom = Math.random; let calls = 0;
    Math.random = () => { calls++; return nativeRandom(); };
    try { SKILL_PRELUDES[id](ctxOf(v)); } finally { Math.random = nativeRandom; }
    expect(calls).toBe(0);
    expect(v.ring.high).toBeGreaterThan(3);
    expect(v.ring.high).toBeLessThanOrEqual(SIG_MAX);
    // 시전 전 표식은 바로(지연 .5초 안) 보인다.
    expect(Math.min(...slots(v).map(x => x.start))).toBe(0);
    const lite = make(); SKILL_PRELUDES[id](ctxOf(lite, true));
    expect(lite.ring.high).toBeLessThanOrEqual(v.ring.high);
    lite.dispose(); v.dispose();
  }
});

test('환영 난무 서명은 시전 시각(.28초) 뒤에 불리므로 마무리 X 가 마지막 베기 틱(9×.115초)에 맞춰 당겨져 있다', () => {
  const v = make(); SIGNATURES.flurry(ctxOf(v));
  const starts = slots(v).map(s => s.start);
  const lastHit = 9 * .115 - .28;
  expect(Math.max(...starts)).toBeLessThan(lastHit + .1);
  expect(Math.max(...starts)).toBeGreaterThan(lastHit - .01);
  expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
});

test('암살자 각성 서명 박자: 공허 보법은 시전 시각(.045초)만큼 당겨 0 이상, 표식 끌어당김 실·일식 하늘 일섬·사슬은 판정 순간에 닿는다', () => {
  const beams = (id: string) => {
    const v = make(); SIGNATURES[id](ctxOf(v)); const A = v.ring.a, out: { start: number, arrive: number, vy: number }[] = [];
    for (let i = 0; i < v.ring.high; i++) {
      if (A.aShape[i * 4] !== IMPACT_KIND.beam || !(A.aMotion[i * 2] > 0)) continue;
      out.push({ start: A.aLife[i * 2], arrive: A.aLife[i * 2] + Math.hypot(A.aVel[i * 3], A.aVel[i * 3 + 1], A.aVel[i * 3 + 2]) / A.aMotion[i * 2], vy: A.aVel[i * 3 + 1] });
    }
    v.dispose(); return out;
  };
  // 공허 보법: 모든 칸이 0초 이후, 마지막 닫힘 선은 total 2초 - 시전 .045초에 시작점에 닿는다.
  { const v = make(); SIGNATURES.void_step(ctxOf(v)); expect(Math.min(...slots(v).map(s => s.start))).toBeGreaterThanOrEqual(0); v.dispose(); }
  expect(Math.max(...beams('void_step').map(b => b.arrive))).toBeCloseTo(2 - .045, 3);
  // 그림자 표식: 끌어당김 실(표식 6개 기준)은 HUB(.18+6×.09+.43초)에 중심에 닿는다.
  const HUB = .18 + 6 * .09 + .43;
  expect(beams('shadow_mark').filter(b => b.arrive > HUB - .01).length).toBe(6);
  for (const b of beams('shadow_mark').filter(b => b.arrive > HUB - .01)) expect(b.arrive).toBeCloseTo(HUB, 3);
  // 일식: 하늘 일섬(아래로 내리꽂는 광선 2)은 .3초에 바닥에 닿고, 지그재그 사슬은 그 전에 착탄점에 닿는다.
  const ecl = beams('eclipse_edge');
  const sky = ecl.filter(b => b.vy < -5); expect(sky.length).toBe(2);
  for (const b of sky) expect(b.arrive).toBeCloseTo(.3, 3);
  const chain = ecl.filter(b => b.start < .3 && b.vy === 0 && b.arrive <= .3);
  expect(chain.length).toBe(5);
  expect(Math.max(...chain.map(b => b.arrive))).toBeCloseTo(.24, 3);
});
