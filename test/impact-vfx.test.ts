import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactVfx, IMPACT_CAPACITY, IMPACT_FRAME_BUDGET, IMPACT_KIND, HERO_IMPACT_PALETTE } from '../src/engine/impact-vfx.js';

const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(6, 12, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; };
const make = (seed?: number) => new ImpactVfx(new THREE.Scene(), { camera: camera(), seed });
const at = new THREE.Vector3(1, 1.1, -2), dir = new THREE.Vector3(0, 0, 1);
const kinds = (v: ImpactVfx, n: number) => Array.from({ length: n }, (_, i) => v.ring.a.aShape[i * 4]);

test('타격 임팩트는 인스턴스 한 장에 고정 배열로 쌓고 Math.random 을 쓰지 않는다', () => {
  const v = make(), arrays = Object.values(v.ring.a), random = Math.random;
  let calls = 0; Math.random = () => { calls++; return random(); };
  try {
    const n = v.hit(at, dir, { hero: 'knight', kind: 'slash', tier: 'light' });
    expect(n).toBeGreaterThanOrEqual(5);
    expect(calls).toBe(0);
  } finally { Math.random = random; }
  expect(v.mesh.isInstancedMesh).toBe(true); expect(v.ring.capacity).toBe(IMPACT_CAPACITY);
  v.update(1 / 60);
  expect(v.mesh.visible).toBe(true); expect(Object.values(v.ring.a)).toEqual(arrays);
  // 0.3초 안에 모두 사라지고 메시를 숨긴다.
  v.update(.5); expect(v.live()).toBe(0); expect(v.mesh.visible).toBe(false);
  v.dispose();
});

test('종류마다 실루엣이 다르다: 베기=자국, 둔기=고리, 마법=별빛, 치명타=금빛 별빛·고리 추가', () => {
  const shapes = (opts: any) => { const v = make(); const n = v.hit(at, dir, opts); const k = kinds(v, n); v.dispose(); return k; };
  const slash = shapes({ kind: 'slash', tier: 'light' });
  expect(slash[0]).toBe(IMPACT_KIND.core); expect(slash).toContain(IMPACT_KIND.cut); expect(slash).not.toContain(IMPACT_KIND.star);
  expect(shapes({ kind: 'blunt', tier: 'light' })).toContain(IMPACT_KIND.ring);
  expect(shapes({ kind: 'magic', tier: 'light' })).toContain(IMPACT_KIND.star);
  const crit = shapes({ kind: 'slash', tier: 'light', crit: true });
  expect(crit.filter(k => k === IMPACT_KIND.star)).toHaveLength(1);
  expect(crit.length).toBeGreaterThan(slash.length + 3);
});

test('영웅마다 고유 강조색을 쓴다', () => {
  const accents = Object.entries(HERO_IMPACT_PALETTE).filter(([id]) => id !== 'default').map(([, p]) => p.accent);
  expect(new Set(accents).size).toBe(accents.length);
  const color = (hero: string) => { const v = make(); v.hit(at, dir, { hero, kind: 'slash' }); const i = 1 * 3; const c = [v.ring.a.aColor[i], v.ring.a.aColor[i + 1], v.ring.a.aColor[i + 2]]; v.dispose(); return c; };
  expect(color('knight')).not.toEqual(color('rogue'));
});

test('프레임 예산·낮은 화질·동작 줄이기가 칸 수를 묶는다', () => {
  const v = make(); let total = 0;
  for (let i = 0; i < 40; i++) total += v.hit(at, dir, { tier: 'finisher', crit: true });
  expect(total).toBe(IMPACT_FRAME_BUDGET);
  v.update(.016); expect(v.hit(at, dir, {})).toBeGreaterThan(0);
  const full = make(), lite = make(); lite.setQuality('low');
  expect(lite.hit(at, dir, { tier: 'heavy' })).toBeLessThan(full.hit(at, dir, { tier: 'heavy' }));
  const reduced = make();
  expect(reduced.hit(at, dir, { tier: 'finisher', crit: true, reduced: true })).toBe(1);
  expect(reduced.kill(at, { boss: true, reduced: true })).toBe(1);
  for (const x of [v, full, lite, reduced]) x.dispose();
});

test('같은 시드·같은 입력이면 같은 모양, clear 뒤 처음 상태로 돌아온다', () => {
  const run = (v: ImpactVfx) => { v.hit(at, dir, { tier: 'heavy', crit: true }); v.kill(at, { elite: true }); return Array.from(v.ring.a.aVel.slice(0, 60)); };
  const a = make(7), b = make(7);
  expect(run(a)).toEqual(run(b));
  a.clear(); expect(a.clock).toBe(0); expect(run(a)).toEqual(run(b.clear() ?? b));
  a.dispose(); b.dispose();
});

test('히트스톱(dt 0)에는 시계가 멈춰 임팩트 프레임이 그대로 남는다', () => {
  const v = make(); v.hit(at, dir, { tier: 'heavy' }); v.update(.03);
  const t = v.uTime.value; v.update(0); v.update(0);
  expect(v.uTime.value).toBe(t); expect(v.live()).toBeGreaterThan(0);
  v.dispose();
});

test('서 있는 큰 빛과 광선 면적은 블룸 부하(load)로 쌓이고, 지면 표식은 세지 않으며 clear 가 비운다', () => {
  const v = make();
  v._emit(IMPACT_KIND.mark, 0, 0, 0, 6, 0xffaa00, .5);
  expect(v.load).toBe(0);
  v._emit(IMPACT_KIND.ring, 0, 1, 0, 3, 0xffaa00, .3);
  expect(v.load).toBeCloseTo(9, 5);
  v.beam(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0), 10, 0xffaa00, { width: .25 });
  expect(v.load).toBeCloseTo(9 + 5, 5);
  v.clear(); expect(v.load).toBe(0);
  v.dispose();
});
