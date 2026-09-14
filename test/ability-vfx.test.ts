import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ABILITY_VFX_PROFILES, FX } from '../src/engine/fx.js';
import { SKILLS } from '../src/game/skills.js';

test('ability signatures keep six authored schools visually distinct and immutable', () => {
  const entries = Object.entries(ABILITY_VFX_PROFILES);
  expect(entries).toHaveLength(6);
  expect(new Set(entries.map(([, profile]) => profile.color)).size).toBe(6);
  expect(new Set(entries.map(([, profile]) => profile.radius)).size).toBe(6);
  expect(new Set(entries.map(([, profile]) => profile.flash)).size).toBe(6);
  expect(new Set(entries.map(([, profile]) => profile.secondary)).size).toBe(6);
  for (const [, profile] of entries) {
    expect(profile.radius).toBeGreaterThan(2);
    expect(profile.burst).toBeGreaterThan(10);
    expect(profile.secondary).toBeTruthy();
    expect(() => ((profile as any).color = 0)).toThrow();
  }
});

test('abilitySignature clamps scale/lifetime, composes bounded cues and preserves the anchor', () => {
  const calls: any[] = [];
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, {
    groundTex: (...args: any[]) => calls.push(['ground', args]),
    ring: (...args: any[]) => calls.push(['ring', args]),
    texFlash: (...args: any[]) => calls.push(['flash', args]),
    burst: (...args: any[]) => calls.push(['burst', args]),
    firePillar: (...args: any[]) => calls.push(['pillar', args]),
    light: (...args: any[]) => calls.push(['light', args]),
  });
  Object.defineProperty(fx, 'lite', { value: false });
  const anchor = new THREE.Vector3(2, 0, -3);
  const returned = fx.abilitySignature(anchor, 'fire', { scale: 99, life: 99, heavy: true });
  expect(returned).toBe(ABILITY_VFX_PROFILES.fire);
  expect(anchor.toArray()).toEqual([2, 0, -3]);
  expect(calls.map(([kind]) => kind)).toEqual(['ground', 'ring', 'flash', 'flash', 'burst', 'pillar', 'light']);
  const ground = calls[0][1][3];
  const flash = calls[2][1][3];
  const burst = calls[4][1][2];
  expect(ground.r1).toBeCloseTo(8.64);
  expect(ground.life).toBe(2.2);
  expect(flash.size).toBeCloseTo(12.528);
  expect(burst.n).toBe(27);
  expect(burst.life).toBeCloseTo(0.72);
});

test('mobile quality skips the fire pillar while retaining the signature silhouette', () => {
  const calls: any[] = [];
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, {
    groundTex: (...args: any[]) => calls.push(['ground', args]),
    ring: (...args: any[]) => calls.push(['ring', args]),
    texFlash: (...args: any[]) => calls.push(['flash', args]),
    burst: (...args: any[]) => calls.push(['burst', args]),
    firePillar: (...args: any[]) => calls.push(['pillar', args]),
    light: (...args: any[]) => calls.push(['light', args]),
  });
  Object.defineProperty(fx, 'lite', { value: true });
  fx.abilitySignature(new THREE.Vector3(), 'fire', { scale: 1, life: 0.5 });
  expect(calls.some(([kind]) => kind === 'pillar')).toBe(false);
  expect(calls.filter(([kind]) => kind === 'burst')).toHaveLength(1);
  expect(calls.filter(([kind]) => kind === 'flash')).toHaveLength(2);
});

test('fireball carries its fire signature into the projectile impact contract', () => {
  const shots: any[] = [];
  const game: any = { spawnProjectile: (shot: any) => shots.push(shot), fx: { flash() {} } };
  const p: any = { pos: new THREE.Vector3(), forward: (out: THREE.Vector3) => out.set(0, 0, 1) };
  SKILLS.fireball.cast(game, p, { dmg: 120 });
  expect(shots).toHaveLength(1);
  expect(shots[0].explode).toMatchObject({ radius: 4.2, profile: 'fire' });
});
