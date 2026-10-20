import { afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { GradeAura } from '../src/engine/grade-aura.js';
import { resolveHeroGrade, skillVfxKey } from '../src/engine/skill-vfx.js';
import { VFX_TEX as VFX_TEX_RAW } from '../src/engine/assets.js';
import { Player } from '../src/game/player.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const VFX_TEX = VFX_TEX_RAW as Record<string, any>;
const RING = skillVfxKey('skill-rune-circle-gold'), AURA = skillVfxKey('aura-sssr');
const saved = { ring: VFX_TEX[RING], aura: VFX_TEX[AURA] };
const fake = () => Object.assign(new THREE.Texture(), { isFake: true });
VFX_TEX[RING] = fake(); VFX_TEX[AURA] = fake();
afterEach(() => { VFX_TEX[RING] = VFX_TEX[RING] || fake(); VFX_TEX[AURA] = VFX_TEX[AURA] || fake(); });

const count = (o: THREE.Object3D) => { let n = 0; o.traverse(() => n++); return n; };

test('SR은 오라 자원을 만들지 않고 SSR은 금색 링, SSSR은 무지개 링과 aura-sssr를 쓴다', () => {
  const root = new THREE.Group(), aura = new GradeAura(root);
  aura.update(0.016, 'SR'); expect(root.children).toHaveLength(0);
  aura.update(0.016, 'SSR');
  expect(root.children).toHaveLength(1);
  const g: any = aura; expect(g.ring.visible).toBe(true); expect(g.aura.visible).toBe(false);
  expect(g.ring.material.color.getHex()).toBe(0xffd060); expect(g.ring.material.opacity).toBeLessThan(0.3);
  aura.update(0.5, 'SSSR');
  expect(g.aura.visible).toBe(true); expect(g.aura.material.map).toBe(VFX_TEX[AURA]);
  const c1 = g.ring.material.color.getHex(); aura.update(1, 'SSSR');
  expect(g.ring.material.color.getHex()).not.toBe(c1); // 무지개: 색이 돈다
  aura.update(0.016, 'SR'); expect(g.group.visible).toBe(false); // 강등·SR 에서는 숨긴다
  aura.dispose();
});

test('반복 갱신·등급 전환·사망·저사양에서도 노드 수가 늘지 않고 dispose가 모두 정리한다', () => {
  const root = new THREE.Group(), aura = new GradeAura(root);
  aura.update(0.016, 'SSSR'); const nodes = count(root);
  const g: any = aura; let disposed = 0;
  for (const m of [g.ring.material, g.aura.material]) m.addEventListener('dispose', () => disposed++);
  const geo = g.ring.geometry; let geoDisposed = 0; geo.addEventListener('dispose', () => geoDisposed++);
  for (let i = 0; i < 300; i++) aura.update(0.016, i % 7 === 0 ? 'SSR' : 'SSSR', { alive: i % 11 !== 0, lite: i % 5 === 0, reduced: i % 13 === 0 });
  expect(count(root)).toBe(nodes);
  aura.dispose();
  expect(root.children).toHaveLength(0); expect(disposed).toBe(2); expect(geoDisposed).toBe(1);
  aura.update(0.016, 'SSSR'); expect(root.children).toHaveLength(0); // 해제 뒤에는 다시 만들지 않는다
  aura.dispose(); expect(disposed).toBe(2);
});

test('텍스처가 아직 로드되지 않았으면 링을 켜지 않는다(흰 사각형 방지)', () => {
  const ring = VFX_TEX[RING]; delete VFX_TEX[RING];
  try {
    const root = new THREE.Group(), aura = new GradeAura(root); aura.update(0.016, 'SSSR');
    expect((aura as any).ring.visible).toBe(false);
  } finally { VFX_TEX[RING] = ring; }
});

test('실제 Player가 등급에서 오라를 연결하고 등급이 없으면 def.rarity로 폴백하며 dispose가 제거한다', async () => {
  const runtime = await loadCombatFlowRuntime();
  const f = createCombatFlowFixture(runtime, 'knight'); f.game.fx.aura = () => {}; f.game.scene.remove(f.player.root);
  const def = f.player.def, names = new Set(['Idle', 'Running_A', ...def.combo.map((c: any) => c.anim), ...def.skills.map((s: any) => s.anim).filter(Boolean)]);
  const gltf = { scene: new THREE.Group(), animations: [...names].map(name => new THREE.AnimationClip(name, 1, [])) };
  const p: any = f.player = f.game.player = new Player(f.game, gltf, def, f.player.stats);
  expect(p.gradeAura).toBeInstanceOf(GradeAura);
  const auraNode = () => p.root.children.find((c: any) => c.name === 'GradeAura');
  p.stats = { ...p.stats, grade: undefined }; p.def = { ...p.def, rarity: 'SSR' };
  expect(resolveHeroGrade(p)).toBe('SSR');
  stepCombatFlow(f, 1 / 60); expect(auraNode()?.visible).toBe(true);
  p.def = { ...p.def, rarity: undefined }; stepCombatFlow(f, 1 / 60);
  expect(resolveHeroGrade(p)).toBe('SR'); expect(auraNode()?.visible).toBe(false);
  p.stats = { ...p.stats, grade: 'SSSR' }; stepCombatFlow(f, 1 / 60); expect(auraNode()?.visible).toBe(true);
  const before = count(p.root); for (let i = 0; i < 120; i++) stepCombatFlow(f, 1 / 60);
  expect(count(p.root)).toBe(before);
  p.dispose(); expect(p.gradeAura.disposed).toBe(true);
});