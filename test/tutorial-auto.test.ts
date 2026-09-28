import { afterEach, beforeEach, expect, test } from 'bun:test';
import { BattleTutorial, nextHealHintTier } from '../src/ui/tutorial.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
let buttonOn: boolean;
beforeEach(() => {
  buttonOn = false;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelectorAll: () => [],
    getElementById: (id: string) => id === 'btn-auto' ? { classList: { toggle: (_: string, on: boolean) => buttonOn = on } } : null,
  } });
});
afterEach(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });

test('first-stage heal reminder advances once at 55% and once at 30%', () => {
  expect(nextHealHintTier(56, 100, 0)).toBe(0);
  expect(nextHealHintTier(55, 100, 0)).toBe(1);
  expect(nextHealHintTier(54, 100, 1)).toBe(0);
  expect(nextHealHintTier(30, 100, 1)).toBe(2);
  expect(nextHealHintTier(5, 100, 2)).toBe(0);
  expect(nextHealHintTier(25, 100, 0)).toBe(2);
  expect(nextHealHintTier(50, 0, 0)).toBe(0);
});

for (const savedAuto of [true, false]) test(`tutorial exit respects latest saved AUTO ${savedAuto} and its button`, () => {
  const battle = { player: { auto: !savedAuto }, setPaused() {} };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    phase: 'clear', beforeAuto: !savedAuto, battle, root: { hidden: false },
    app: { journey: { s: { autoBattle: savedAuto } }, eco: { s: {}, emit() {} }, ui: { toast() {} } },
  });
  tutorial.finish(false);
  expect(battle.player.auto).toBe(savedAuto); expect(buttonOn).toBe(savedAuto);
  expect(tutorial.app.eco.s.tutorial.completed).toBe(true); expect(tutorial.phase).toBeNull();
});

test('without a journey service tutorial keeps the original AUTO preference', () => {
  const battle = { player: { auto: false }, setPaused() {} };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    phase: 'attack', beforeAuto: true, battle, root: { hidden: false },
    app: { eco: { s: {}, emit() {} }, ui: { toast() {} } },
  });
  tutorial.finish(true); expect(battle.player.auto).toBe(true); expect(buttonOn).toBe(true);
});
