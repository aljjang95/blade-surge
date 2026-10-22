import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_KIND, HERO_COMBO, IMPACT_FRAME_BUDGET } from '../src/engine/impact-vfx.js';
import { bossSignatureFragmentShader } from '../src/game/boss-signatures.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = () => new ImpactVfx(new THREE.Scene(), { camera: camera() });
const at = new THREE.Vector3(0, 1.1, -3), dir = new THREE.Vector3(0, 0, -1);
const kinds = (v: ImpactVfx, from = 0, n = v.spawned) => Array.from({ length: n - from }, (_, i) => v.ring.a.aShape[(from + i) * 4]);
const sizes = (v: ImpactVfx, n: number) => Array.from({ length: n }, (_, i) => v.ring.a.aShape[i * 4 + 1]);
const HEROES = ['knight', 'ranger', 'mage', 'rogue', 'barbarian'];

test('평타 연계 층: 다섯 영웅 모두 모양이 다르고, 단계가 오를수록 크며, 마무리는 칸이 더 많다', () => {
  const shape = (hero: string, step: number, finisher = false) => { const v = make(); const n = v.combo(at, dir, { hero, step, steps: 5, finisher }); const k = kinds(v).join(','); const s = sizes(v, n); v.dispose(); return { n, k, s }; };
  const firsts = HEROES.map(h => shape(h, 0).k);
  expect(new Set(firsts).size).toBe(5);
  for (const hero of HEROES) {
    const a = shape(hero, 0), b = shape(hero, 3), fin = shape(hero, 4, true);
    expect(a.n).toBeGreaterThan(0);
    expect(b.s[0]).toBeGreaterThan(a.s[0]);
    expect(fin.n).toBeGreaterThan(b.n);
    expect(fin.n).toBeLessThanOrEqual(16);
  }
  // 영웅 색 언어와 일치: 첫 칸 색이 영웅 연계 색이다.
  for (const hero of HEROES) {
    const v = make(); v.combo(at, dir, { hero, step: 0, steps: 5 });
    const c = new THREE.Color((HERO_COMBO as any)[hero].color);
    expect(v.ring.a.aColor[0]).toBeCloseTo(c.r, 4); expect(v.ring.a.aColor[2]).toBeCloseTo(c.b, 4);
    v.dispose();
  }
});

test('연계 층은 Math.random 을 쓰지 않고, 동작 줄이기·모르는 영웅은 아무것도 내지 않으며, 낮은 화질은 칸이 적다', () => {
  const r = make(), random = Math.random; let calls = 0; Math.random = () => { calls++; return random(); };
  try { const v = r; for (const hero of HEROES) v.combo(at, dir, { hero, step: 4, steps: 5, finisher: true }); expect(calls).toBe(0); v.dispose(); } finally { Math.random = random; }
  const v = make();
  expect(v.combo(at, dir, { hero: 'knight', step: 2, steps: 5, reduced: true })).toBe(0);
  expect(v.combo(at, dir, { hero: 'slime', step: 2, steps: 5 })).toBe(0);
  for (const hero of HEROES) {
    const full = make(), lite = make(); lite.setQuality('low');
    expect(lite.combo(at, dir, { hero, step: 4, steps: 5, finisher: true })).toBeLessThan(full.combo(at, dir, { hero, step: 4, steps: 5, finisher: true }));
    full.dispose(); lite.dispose();
  }
  // 프레임 예산을 넘지 않는다.
  let total = 0; for (let i = 0; i < 30; i++) total += v.combo(at, dir, { hero: 'rogue', step: 4, steps: 5, finisher: true });
  expect(total).toBeLessThanOrEqual(IMPACT_FRAME_BUDGET);
  v.dispose();
});

test('치명타는 판정 뒤 .3초에도 금빛 잔광(파편 눈금)이 남고, 크림 코어 대신 금색 코어를 쓴다', () => {
  const v = make(); const n = v.hit(at, dir, { hero: 'mage', kind: 'magic', tier: 'light', crit: true });
  const k = kinds(v, 0, n);
  expect(k.filter(x => x === IMPACT_KIND.shard).length).toBe(4);
  v.update(.3); expect(v.live()).toBeGreaterThan(0);
  const gold = new THREE.Color(0xffd23a); expect(v.ring.a.aColor[0]).toBeCloseTo(gold.r, 4); expect(v.ring.a.aColor[2]).toBeCloseTo(gold.b, 4);
  v.dispose();
});

test('처치는 영웅색 파편과 위로 오르는 영혼 불꽃을 내고 .5초에도 남는다', () => {
  for (const hero of HEROES) {
    const v = make(); const n = v.kill(at, { hero });
    const k = kinds(v, 0, n);
    expect(k).toContain(IMPACT_KIND.shard); expect(k).toContain(IMPACT_KIND.flame);
    const flame = k.indexOf(IMPACT_KIND.flame);
    expect(v.ring.a.aMotion[flame * 2 + 1]).toBeLessThan(0); // 음의 중력 = 상승
    v.update(.5); expect(v.live()).toBeGreaterThan(0);
    v.dispose();
  }
});

test('보스 고유기 예고 셰이더는 같은 uniform 으로 미터 두께 경계·어두운 띠·적색 채움·임박 맥동을 그린다', () => {
  expect(bossSignatureFragmentShader).toContain('uniform float shape, safeRadius, opacity, fired, progress;');
  for (const token of ['band', 'urgent', 'pulse', 'front', 'danger']) expect(bossSignatureFragmentShader).toContain(token);
});
