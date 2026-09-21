import { expect, test } from 'bun:test';
import { Group } from 'three';
import { AudioSys } from '../src/engine/audio.js';
import { HeroBeacon } from '../src/game/hero-beacon.js';
import { enemySkillLabel } from '../src/game/enemies.js';

test('action beacon increases the hero silhouette signal only during committed combat states', () => {
  const root = new Group();
  const beacon = new HeroBeacon(root);
  try {
    beacon.update(true, 0, { state: 'idle', color: 0x9ffff0 });
    const idleLocator = beacon.locator.scale.y;
    beacon.update(true, 0, { state: 'attack', color: 0xffc45c });
    expect(beacon.focusRing.visible).toBe(true);
    expect(beacon.primaryRing.scale.x).toBeGreaterThan(1);
    expect(beacon.locator.scale.y).toBeGreaterThan(idleLocator);
    expect(beacon.focusRing.material.color.getHex()).toBe(0xffc45c);
  } finally {
    beacon.dispose();
  }
});

test('enemy skill labels keep mob roles and boss signatures visually distinct', () => {
  expect(enemySkillLabel({ special: 'slam' })).toBe('지면 강타');
  expect(enemySkillLabel({ mobRole: { key: 'crusher' } })).toBe('분쇄 강타');
  expect(enemySkillLabel({ def: { ranged: true } })).toBe('적의 주문');
});

test('combat audio requests distinct haptic timings for telegraph, attack release, and ultimate release', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (pattern: unknown) => { calls.push(pattern); return true; } } });
  try {
    new AudioSys().enemyTelegraph({ kind: 'slam', boss: true });
    new AudioSys().attackRelease({ finisher: true });
    new AudioSys().skillRelease({ ult: true });
    expect(calls).toEqual([[10, 14, 24], [16, 12, 34], [20, 16, 42]]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
