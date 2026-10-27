import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { weaponGlowTier, weaponLook, ENHANCE_STEPS } from '../src/data/weapon-looks.js';
import { ITEMS_OF } from '../src/data/items.js';
import { syncWeaponHalo, emitWeaponSparks, removeWeaponHalo } from '../src/game/weapon-glow.js';
import { heroBodyAppearance, heroAppearance } from '../src/data/hero-library.js';
import { ITEM_BY_ID } from '../src/data/items.js';

test('강화 빛 단계: +0~5 없음, +6 은은, +10 발광, +13 잔광, +15 고유 오라, +20 신화', () => {
  const ids = [0, 5, 6, 9, 10, 12, 13, 14, 15, 19, 20, 99].map((n) => weaponGlowTier(n).id);
  expect(ids).toEqual(['none', 'none', 'soft', 'soft', 'glow', 'glow', 'blaze', 'blaze', 'aura', 'aura', 'myth', 'myth']);
  // 단계가 오를수록 광륜·불씨·궤적이 줄지 않는다.
  const tiers = [0, 6, 10, 13, 15, 20].map(weaponGlowTier);
  for (let i = 1; i < tiers.length; i++) {
    expect(tiers[i]!.halo).toBeGreaterThan(tiers[i - 1]!.halo);
    expect(tiers[i]!.spark).toBeGreaterThanOrEqual(tiers[i - 1]!.spark);
    expect(tiers[i]!.trail).toBeGreaterThanOrEqual(tiers[i - 1]!.trail);
  }
  expect(ENHANCE_STEPS).toEqual([0, 6, 10, 13, 15, 20]);
});

test('weaponLook: 발밑 오라는 +15 부터, 강화 발광은 +6 부터 더해진다', () => {
  const weapon = (ITEMS_OF as any)('E', 'weapon')[0]!;
  const at = (enh: number) => weaponLook('barbarian', { id: weapon.id, enh }, {});
  expect(at(5)!.glow).toBe(at(0)!.glow);
  expect(at(6)!.glow).toBeGreaterThan(at(5)!.glow);
  expect(at(14)!.aura).toBeNull();
  expect(at(15)!.aura).toBe('#ffd060');
  expect(at(20)!.aura).toBe('#ff8af0');
  expect(at(13)!.glowTier.id).toBe('blaze');
});

test('방어구는 몸체 단계를 바꾸지 않는다', () => {
  const armor = (ITEMS_OF as any)('L', 'armor')[0]!;
  expect(heroAppearance({ armor: { id: armor.id } }, ITEM_BY_ID).tier).toBeGreaterThan(1);
  expect(heroBodyAppearance({ armor: { id: armor.id } }, ITEM_BY_ID)).toEqual({ tier: 1, theme: null });
});

function fakeHero() {
  const model = new THREE.Group();
  const hand = new THREE.Group(); hand.name = 'hand'; hand.position.set(.4, 1, 0); model.add(hand);
  const axe = new THREE.Group(); axe.name = '1H_Axe'; hand.add(axe);
  axe.add(new THREE.Mesh(new THREE.BoxGeometry(.1, 1, .1), new THREE.MeshStandardMaterial()));
  return { model, axe };
}

test('광륜: 단계가 있으면 보이는 무기 노드에 한 장 붙고, 단계가 없으면 뗀다', () => {
  const { model, axe } = fakeHero();
  syncWeaponHalo(model, weaponGlowTier(10), 0xff5500, ['1H_Axe']);
  const halo = model.userData.weaponHalo as THREE.Sprite;
  expect(halo.parent).toBe(axe);
  expect(halo.scale.y).toBeGreaterThan(.9);
  // 다시 맞춰도 광륜은 하나다.
  syncWeaponHalo(model, weaponGlowTier(15), 0xff5500, ['1H_Axe']);
  let count = 0; model.traverse((o) => { if (o.name === 'WeaponHalo') count++; });
  expect(count).toBe(1);
  syncWeaponHalo(model, weaponGlowTier(3), 0xff5500, ['1H_Axe']);
  expect(model.userData.weaponHalo).toBeUndefined();
  count = 0; model.traverse((o) => { if (o.name === 'WeaponHalo') count++; });
  expect(count).toBe(0);
  removeWeaponHalo(model);
});

test('칼날 불씨: +10 이상만 기존 파티클 풀로 뿌린다', () => {
  const { model } = fakeHero();
  const emitted: number[] = [];
  const fx = { glow: { emit: () => emitted.push(1) }, lite: false };
  const look = (enh: number) => ({ weapon: { glowTier: weaponGlowTier(enh), color: '#ff5500' } });
  syncWeaponHalo(model, weaponGlowTier(6), 0xff5500, ['1H_Axe']);
  expect(emitWeaponSparks(fx, model, look(6), 1, { t: 0 })).toBe(0);
  syncWeaponHalo(model, weaponGlowTier(13), 0xff5500, ['1H_Axe']);
  const state = { t: 0 };
  let total = 0; for (let i = 0; i < 60; i++) total += emitWeaponSparks(fx, model, look(13), 1 / 60, state);
  expect(total).toBeGreaterThanOrEqual(6);
  expect(total).toBeLessThanOrEqual(9);
});
