import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, MARK_STYLE, ARROW_STREAKS, IMPACT_STACK } from '../src/engine/impact-vfx.js';
import { SKILL_SIGNATURES } from '../src/engine/skill-signatures.js';
import { SKILL_VFX, castSkillVfx } from '../src/engine/skill-vfx.js';
import { HERO_SKILLS } from '../src/engine/combat-sound-library.js';
import { FX } from '../src/engine/fx.js';
import { SANCTUM, sanctumPillarGeometry } from '../src/engine/sanctum-vfx.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const kindsOf = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => v.ring.a.aShape[i * 4]);

test('광선은 화살 속도·길이를 칸에 담고, 명중하면 과녁 거리에서 멈춰 수명이 줄어든다', () => {
  const v = make(), from = new THREE.Vector3(0, 1.2, 0), dir = new THREE.Vector3(0, 0, 1);
  const h = v.beam(from, dir, 20, 0x3fe0a0, { speed: 25, tail: 5 });
  expect(h).toBeTruthy();
  const A = v.ring.a, s = h!.slot;
  expect(A.aShape[s * 4]).toBe(IMPACT_KIND.beam);
  expect(Math.hypot(A.aVel[s * 3], A.aVel[s * 3 + 1], A.aVel[s * 3 + 2])).toBeCloseTo(20, 4);
  expect(A.aMotion[s * 2]).toBe(25);
  expect(A.aLife[s * 2 + 1]).toBeCloseTo((20 + 5) / 25, 5);
  expect(v.stopBeam(h, 6)).toBe(true);
  expect(Math.hypot(A.aVel[s * 3], A.aVel[s * 3 + 1], A.aVel[s * 3 + 2])).toBeCloseTo(6, 4);
  expect(A.aLife[s * 2 + 1]).toBeCloseTo((6 + 5) / 25, 5);
  // 재활용된 칸은 건드리지 않는다.
  expect(v.stopBeam({ slot: s, start: -99 }, 2)).toBe(false);
  v.dispose();
});

test('지연 칸은 미래 시각에 시작하고, 지면 표식은 모양 번호를 담는다', () => {
  const v = make();
  v.mark(new THREE.Vector3(1, 0, 1), 0xffffff, { radius: 2, life: .5, style: MARK_STYLE.compass, delay: .3 });
  expect(v.ring.a.aLife[0]).toBeCloseTo(.3, 5);
  expect(v.ring.a.aShape[3]).toBe(MARK_STYLE.compass);
  expect(v.ring.expiry[0]).toBeCloseTo(.8, 5);
  v.update(.2); expect(v.mesh.visible).toBe(true);
  v.update(.7); expect(v.live()).toBe(0);
  v.dispose();
});

test('같은 자리를 연달아 치면 코어·자국을 다시 쌓지 않고 불똥만 낸다(치명타는 예외)', () => {
  const v = make(), at = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(1, 0, 0);
  const first = v.hit(at, dir, { hero: 'ranger', tier: 'light' });
  const second = v.hit(at, dir, { hero: 'ranger', tier: 'light' });
  expect(second).toBeLessThan(first);
  const k = kindsOf(v).slice(first);
  expect(k).not.toContain(IMPACT_KIND.core); expect(k).not.toContain(IMPACT_KIND.cut);
  v.update(IMPACT_STACK.sec + .01);
  expect(v.hit(at, dir, { hero: 'ranger', tier: 'light' })).toBe(first);
  expect(v.hit(at, dir, { hero: 'ranger', tier: 'light', crit: true })).toBeGreaterThan(first);
  v.dispose();
});

test('영웅마다 타격·처치 결이 다르다', () => {
  const at = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(1, 0, 0);
  const shape = (hero: string, tier = 'heavy') => { const v = make(); v.hit(at, dir, { hero, tier }); v.kill(at, { hero }); const k = kindsOf(v).join(','); v.dispose(); return k; };
  const sets = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'].map(h => shape(h));
  expect(new Set(sets).size).toBe(5);
  // 암살자는 X 자 두 번째 자국, 궁수는 관통 선, 검성 처치는 하늘로 오르는 광선
  expect(shape('rogue').split(',').filter(k => +k === IMPACT_KIND.cut).length).toBe(2);
  expect(shape('ranger').split(',').map(Number)).toContain(IMPACT_KIND.beam);
  expect(shape('knight').split(',').map(Number)).toContain(IMPACT_KIND.beam);
});

test('궁수 스킬 8개 모두 서명이 있고, 서명마다 모양 구성이 다르다', () => {
  const ids = HERO_SKILLS.ranger;
  const shapes = ids.map((id: string) => {
    expect(typeof SKILL_SIGNATURES[id]).toBe('function');
    expect((SKILL_VFX as any)[id].sig).toBe(true);
    const v = make();
    SKILL_SIGNATURES[id]({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(0, 0, 7), f: new THREE.Vector3(0, 0, 1), lite: false, scale: 1 } as any);
    const k = kindsOf(v); const styles = k.map((kind, i) => kind === IMPACT_KIND.mark ? v.ring.a.aShape[i * 4 + 3] : -1);
    v.dispose(); expect(k.length).toBeGreaterThan(0);
    return k.join(',') + '|' + styles.join(',');
  });
  expect(new Set(shapes).size).toBe(ids.length);
  // 화살 궤적 언어도 스킬마다 구분된다.
  const sig = (s: string) => JSON.stringify((ARROW_STREAKS as any)[s]);
  expect(new Set(['pierce', 'volley', 'retreat', 'storm', 'quick', 'bind', 'gale'].map(sig)).size).toBe(7);
});

test('궁수 서명: Math.random 미사용, 시전 프레임 칸 상한(투사체 궤적 몫 남김), lite 는 더 적게, 큰 빌보드 고리 없음', () => {
  const ctx = (v: ImpactVfx, lite = false) => ({ fx: null, impact: v, player: { pos: new THREE.Vector3(1, 0, 2) }, at: new THREE.Vector3(1, 0, 9), f: new THREE.Vector3(0, 0, 1), lite, scale: 1 } as any);
  // 궁극기는 일곱 발 × 3칸(궤적·번짐·활 끝 고리) + 레시피 burst 3 을 같은 프레임에 쓴다.
  const arrows: Record<string, number> = { ranger_tempest: 7, ranger_binding: 5, ranger_volley: 3, gale_hunt: 3 };
  for (const id of HERO_SKILLS.ranger) {
    const v = make(); const nativeRandom = Math.random; let calls = 0;
    Math.random = () => { calls++; return nativeRandom(); };
    try { SKILL_SIGNATURES[id](ctx(v)); } finally { Math.random = nativeRandom; }
    expect(calls).toBe(0);
    expect(v.ring.high + 3 + (arrows[id] ?? 1) * 3).toBeLessThanOrEqual(72);
    for (let i = 0; i < v.ring.high; i++) if (v.ring.a.aShape[i * 4] === IMPACT_KIND.ring) expect(v.ring.a.aShape[i * 4 + 1]).toBeLessThanOrEqual(3.5);
    const lite = make(); SKILL_SIGNATURES[id](ctx(lite, true));
    expect(lite.ring.high).toBeLessThanOrEqual(v.ring.high);
    lite.dispose(); v.dispose();
  }
});

test('궁수 관통 관통점·폭풍 일곱 갈래·화살비 낙하가 판정 시각과 맞는다', () => {
  const ctx = (v: ImpactVfx) => ({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(0, 0, 7), f: new THREE.Vector3(0, 0, 1), lite: false, scale: 1 } as any);
  // 관통: 화살(27m/s)이 4·8·12m 를 지나는 순간 별빛.
  let v = make(); SKILL_SIGNATURES.ranger_pierce(ctx(v));
  const stars = Array.from({ length: v.ring.high }, (_, i) => i).filter(i => v.ring.a.aShape[i * 4] === IMPACT_KIND.star && v.ring.a.aLife[i * 2] > 0).map(i => v.ring.a.aLife[i * 2]);
  expect(stars.map(t => +t.toFixed(4))).toEqual([4 / 27, 8 / 27, 12 / 27].map(t => +t.toFixed(4)));
  v.dispose();
  // 폭풍: 바닥 갈래 방향이 일곱 개(실제 화살 ±3×0.18rad).
  v = make(); SKILL_SIGNATURES.ranger_tempest(ctx(v));
  const dirs = new Set<number>();
  for (let i = 0; i < v.ring.high; i++) if (v.ring.a.aShape[i * 4] === IMPACT_KIND.beam) dirs.add(+Math.atan2(v.ring.a.aVel[i * 3], v.ring.a.aVel[i * 3 + 2]).toFixed(3));
  expect(dirs.size).toBe(7);
  v.dispose();
  // 화살비: 하늘 광선 머리가 .16 + i×.09 초에 바닥에 닿는다.
  v = make(); SKILL_SIGNATURES.skyfall_arrows(ctx(v));
  const hits: number[] = [];
  for (let i = 0; i < v.ring.high; i++) {
    const A = v.ring.a; if (A.aShape[i * 4] !== IMPACT_KIND.beam || A.aShape[i * 4 + 1] > .2) continue;
    hits.push(+(A.aLife[i * 2] + Math.hypot(A.aVel[i * 3], A.aVel[i * 3 + 1], A.aVel[i * 3 + 2]) / A.aMotion[i * 2]).toFixed(3));
  }
  expect(hits).toEqual([.16, .25, .34, .43, .52]);
  v.dispose();
});

test('궁수 레시피는 전방 흰 바람 섬광을 쓰지 않고, 동작 줄이기에서는 서명을 생략한다', () => {
  for (const id of HERO_SKILLS.ranger) {
    const calls: any[] = []; const rec = (k: string) => (...a: any[]) => calls.push([k, ...a]);
    const marks: any[] = [];
    const impact: any = new Proxy({}, { get: (_t, p) => (...a: any[]) => { marks.push(p); return null; } });
    const fx: any = { items: [], lite: false, groundTex: rec('ground'), texFlash: rec('flash'), flash: rec('light'), burst: rec('burst'), ghost: rec('ghost'), impact };
    const game: any = { fx, renderer: { shake() {} }, app: { reducedMotion: { matches: false } }, enemies: [] };
    const player: any = { pos: new THREE.Vector3(), forward: (o: THREE.Vector3) => o.set(0, 0, 1), def: { rarity: 'SR' }, stats: {}, model: {}, distTo: () => 1 };
    castSkillVfx(game, id, player);
    expect(calls.filter(c => c[0] === 'flash')).toHaveLength(0);
    expect(marks.length).toBeGreaterThan(1);
    marks.length = 0; game.app.reducedMotion.matches = true; castSkillVfx(game, id, player);
    expect(marks).toHaveLength(0);
  }
});

test('성역은 경계 원 + 병합 기둥 2드로우로 그리고, 낮은 화질은 기둥 4개', () => {
  const g = sanctumPillarGeometry(8);
  expect(g.index!.count).toBe(8 * 6);
  const order = new Set<number>(); for (let i = 0; i < 8; i++) order.add(g.attributes.aPillar.getY(i * 4));
  expect(order.size).toBe(8);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }) } });
  const cam = camera(), fx = new FX(new THREE.Scene(), cam);
  try {
  const before = fx.items.length;
  const group: any = fx.sanctum(new THREE.Vector3(3, 0, 4), { radius: 8, life: 7 });
  expect(fx.items.length).toBe(before + 1);
  expect(group.children).toHaveLength(2);
  const pillarMat = group.children[1].material;
  expect(pillarMat.uniforms.uPeak.value).toBeLessThanOrEqual(SANCTUM.pillarPeak);
  fx.update(.1); expect(group.children[0].material.uniforms.uAlpha.value).toBeCloseTo(.1 / SANCTUM.fadeIn, 5);
  fx.update(7); expect(fx.items.some((i: any) => i.obj === group)).toBe(false);
  fx.setQuality('low');
  const lite: any = fx.sanctum(new THREE.Vector3(), {});
  expect(lite.children[1].geometry.index.count).toBe(4 * 6);
  } finally {
    fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
});
