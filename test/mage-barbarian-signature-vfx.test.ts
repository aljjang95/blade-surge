import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, IMPACT_FRAME_BUDGET, MARK_STYLE } from '../src/engine/impact-vfx.js';
import { SKILL_SIGNATURES } from '../src/engine/skill-signatures.js';
import { HERO_SKILLS } from '../src/engine/combat-sound-library.js';
import { SIGNATURES as MAGE, mageBolt, mageMeteorFall, mageFrostTick, magePrismBounce, magePrismTrail } from '../src/engine/sig-mage.js';
import { SIGNATURES as BARB, barbWhirlTick, barbRushEnd } from '../src/engine/sig-barbarian.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const ctxOf = (v: ImpactVfx, lite = false) => ({ fx: null, impact: v, player: { pos: new THREE.Vector3() }, at: new THREE.Vector3(0, 0, 6), f: new THREE.Vector3(0, 0, 1), lite, scale: 1 }) as any;
const slots = (v: ImpactVfx) => Array.from({ length: v.ring.high }, (_, i) => ({
  kind: v.ring.a.aShape[i * 4], start: v.ring.a.aLife[i * 2], size: v.ring.a.aShape[i * 4 + 1], style: v.ring.a.aShape[i * 4 + 3],
  rgb: [v.ring.a.aColor[i * 3], v.ring.a.aColor[i * 3 + 1], v.ring.a.aColor[i * 3 + 2]],
}));
const gameOf = (v: ImpactVfx, lite = false, reduced = false) => ({ fx: { impact: v, lite }, app: { reducedMotion: { matches: reduced } } }) as any;

for (const hero of ['mage', 'barbarian'] as const) {
  test(`${hero} 스킬 8개 모두 서명이 있고, 예외 없이 프레임 예산 안에서 서로 다른 모양을 낸다`, () => {
    const ids: readonly string[] = HERO_SKILLS[hero];
    const own = hero === 'mage' ? MAGE : BARB;
    const shapes = ids.map((id) => {
      expect(typeof own[id]).toBe('function');
      expect(SKILL_SIGNATURES[id]).toBe(own[id]);
      const v = make();
      expect(() => SKILL_SIGNATURES[id](ctxOf(v))).not.toThrow();
      // 시전 프레임의 레시피 임팩트(3칸)와 함께 써도 프레임 예산(72칸)을 넘지 않는다.
      expect(v.spawned).toBeGreaterThan(0); expect(v.spawned).toBeLessThanOrEqual(IMPACT_FRAME_BUDGET - 3);
      const lite = make(); SKILL_SIGNATURES[id](ctxOf(lite, true));
      expect(lite.spawned).toBeLessThanOrEqual(v.spawned);
      const s = slots(v); v.dispose(); lite.dispose();
      return s.map((x) => x.kind + ':' + (x.kind === IMPACT_KIND.mark ? x.style : '')).sort().join(',');
    });
    expect(new Set(shapes).size).toBe(ids.length);
  });
}

test('판정 시각에 맞춘 지연 칸: 지옥의 도끼 .5초·혈왕 붕괴 .2초·종말 .3초·별감옥 .24초·절대영도 .35초', () => {
  const cases: [string, number][] = [['hell_axe', .5], ['bloodquake', .2], ['cataclysm', .3], ['star_prison', .24], ['absolute_zero', .35], ['magma_zone', .75]];
  for (const [id, t] of cases) {
    const v = make(); SKILL_SIGNATURES[id](ctxOf(v));
    const starts = slots(v).map((s) => +s.start.toFixed(3));
    expect(starts.filter((s) => Math.abs(s - t) < .001).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...starts)).toBeLessThan(t + .2);
    v.dispose();
  }
});

test('광전사는 흰 코어 섬광 없이 불씨 색(빨강 우세)만, 대마도사는 학파마다 주색이 다르다', () => {
  for (const id of HERO_SKILLS.barbarian) {
    const v = make(); SKILL_SIGNATURES[id](ctxOf(v));
    const s = slots(v);
    expect(s.some((x) => x.kind === IMPACT_KIND.core)).toBe(false);
    for (const x of s) { expect(x.rgb[0]).toBeGreaterThan(x.rgb[1]); expect(x.rgb[0]).toBeGreaterThan(x.rgb[2]); }
    v.dispose();
  }
  const dominant = (id: string) => {
    const v = make(); SKILL_SIGNATURES[id](ctxOf(v));
    const sum = [0, 0, 0]; for (const x of slots(v)) for (let i = 0; i < 3; i++) sum[i] += x.rgb[i];
    v.dispose(); return sum.indexOf(Math.max(...sum));
  };
  expect(dominant('fireball')).toBe(0); // 화염 = 빨강 우세
  expect(dominant('blizzard')).toBe(2); // 냉기 = 파랑 우세
  expect(dominant('absolute_zero')).toBe(2);
  expect(dominant('chrono_seal')).toBe(2); // 비전 보라
});

test('큰 가시 고리는 4.5m 상한, 빌보드 고리는 6m 이하(화면을 덮는 옅은 돔·바퀴 방지)', () => {
  for (const id of [...HERO_SKILLS.mage, ...HERO_SKILLS.barbarian]) {
    const v = make(); SKILL_SIGNATURES[id](ctxOf(v));
    for (const x of slots(v)) {
      if (x.kind === IMPACT_KIND.mark && x.style === MARK_STYLE.thorn) expect(x.size).toBeLessThanOrEqual(4.5);
      if (x.kind === IMPACT_KIND.ring) expect(x.size).toBeLessThanOrEqual(6);
    }
    v.dispose();
  }
});

test('실행 중 도우미: 칸 상한·지연 판정 시각, 동작 줄이기·대역 임팩트에서는 아무것도 안 낸다', () => {
  const at = new THREE.Vector3(0, 1.2, 4), from = new THREE.Vector3(0, 1.6, 0);
  const v = make(), g = gameOf(v);
  expect(barbWhirlTick(g, new THREE.Vector3(), 3)).toBeLessThanOrEqual(12);
  expect(barbRushEnd(g, at, new THREE.Vector3(0, 0, 1))).toBeLessThanOrEqual(36);
  expect(mageBolt(g, from, at, 0)).toBeLessThanOrEqual(22);
  expect(mageFrostTick(g, new THREE.Vector3(), 2)).toBeLessThanOrEqual(24);
  expect(magePrismBounce(g, at, new THREE.Vector3(1, 0, 0), 4)).toBeLessThanOrEqual(8);
  v.update(0); // 새 프레임(칸 예산 초기화, 시계는 그대로)
  const before = v.spawned;
  expect(mageMeteorFall(g, new THREE.Vector3(6, 18, 4), new THREE.Vector3(), .4)).toBeLessThanOrEqual(16);
  const blast = slots(v).slice(before).filter((s) => s.kind === IMPACT_KIND.core);
  expect(blast.length).toBe(1); expect(blast[0].start).toBeCloseTo(.4, 5);
  v.dispose();
  const r = make();
  expect(barbWhirlTick(gameOf(r, false, true), new THREE.Vector3(), 1)).toBe(0);
  expect(mageBolt(gameOf(r, false, true), from, at)).toBe(0);
  expect(r.spawned).toBe(0); r.dispose();
  // 테스트 대역(메서드 없는 임팩트)에서도 전투 루프를 깨지 않는다.
  const stub = { fx: { impact: {} }, app: {} } as any;
  expect(barbWhirlTick(stub, new THREE.Vector3(), 1)).toBe(0);
  expect(mageMeteorFall(stub, from, at)).toBe(0);
  const lite = make();
  expect(barbWhirlTick(gameOf(lite, true), new THREE.Vector3(), 1)).toBeLessThan(barbWhirlTick(gameOf(make()), new THREE.Vector3(), 1));
  lite.dispose();
});

test('서명은 Math.random 을 쓰지 않는다(전투 난수 순서 보존)', () => {
  const ids = [...HERO_SKILLS.mage, ...HERO_SKILLS.barbarian];
  // 임팩트 층 생성(재질 UUID)은 Math.random 을 쓰므로 미리 만든다.
  const pool = ids.map(() => make()), v = make(), g = gameOf(v);
  const real = Math.random; let calls = 0;
  Math.random = () => { calls++; return real(); };
  try {
    ids.forEach((id, i) => SKILL_SIGNATURES[id](ctxOf(pool[i])));
    barbWhirlTick(g, new THREE.Vector3(), 1); barbRushEnd(g, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    mageBolt(g, new THREE.Vector3(), new THREE.Vector3(3, 1, 3)); mageMeteorFall(g, new THREE.Vector3(6, 18, 4), new THREE.Vector3());
    mageFrostTick(g, new THREE.Vector3(), 1); magePrismBounce(g, new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
  } finally { Math.random = real; }
  expect(calls).toBe(0);
  pool.forEach((p) => p.dispose()); v.dispose();
});

test('궁극기 예비 표식(메테오·지옥의 도끼): 합본에 있고, 칸 예산 안·lite 는 더 적게·Math.random 미사용', async () => {
  const { SKILL_PRELUDES } = await import('../src/engine/skill-signatures.js');
  for (const id of ['meteor', 'hell_axe']) {
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

test('h1b 대마도사: 눈보라 틱 소용돌이 팔·프리즘 궤적·굴절 표식은 바닥 모양으로 남고 칸 상한을 지킨다', () => {
  const v = make(), g = gameOf(v);
  const n = mageFrostTick(g, new THREE.Vector3(), 3, 6.8);
  const frost = slots(v);
  // 세 갈래 × 세 마디 소용돌이(지면 광선) + 얼음 가시(광선)
  expect(frost.filter((s) => s.kind === IMPACT_KIND.beam).length).toBeGreaterThanOrEqual(9 + 6);
  expect(n).toBeLessThanOrEqual(24);
  v.update(0);
  const before = v.spawned;
  expect(magePrismTrail(g, new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(0, 1.3, .5))).toBe(2);
  expect(magePrismTrail(gameOf(make(), true), new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(0, 1.3, .5))).toBe(1);
  expect(magePrismTrail(g, new THREE.Vector3(), new THREE.Vector3())).toBe(0);
  v.update(0);
  magePrismBounce(g, new THREE.Vector3(0, 1.2, 4), new THREE.Vector3(1, 0, 0), 2);
  const bounce = slots(v).slice(before + 2);
  expect(bounce.some((s) => s.kind === IMPACT_KIND.mark && s.style === MARK_STYLE.compass)).toBe(true);
  expect(bounce.filter((s) => s.kind === IMPACT_KIND.beam).length).toBe(5);
  v.dispose();
});

test('h1b 대마도사 평타 마무리: 넓은 옅은 원판 대신 바닥 작은 진한 표식 + 수평 비전 가시', () => {
  const v = make();
  const pos = new THREE.Vector3(0, 1.1, 4);
  const n = v.combo(pos, new THREE.Vector3(0, 0, 1), { hero: 'mage', step: 4, steps: 5, finisher: true });
  expect(n).toBeLessThanOrEqual(14);
  const all = slots(v), marks = all.filter((s) => s.kind === IMPACT_KIND.mark);
  expect(marks.length).toBe(1);
  expect(marks[0].size).toBeLessThan(2.4); // 예전 2 × 1.77 = 3.5m
  // 표식은 타격 높이(1.1m)가 아니라 바닥에 눕는다.
  const mi = all.findIndex((s) => s.kind === IMPACT_KIND.mark);
  expect(v.ring.a.aOrigin[mi * 3 + 1]).toBeLessThan(.1);
  expect(all.filter((s) => s.kind === IMPACT_KIND.beam).length).toBe(6);
  v.dispose();
});
