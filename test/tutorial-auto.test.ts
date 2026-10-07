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

test('explicit AUTO retry skips the tutorial for one run without marking it complete', () => {
  const save = { tutorial: { completed: false } };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    app: { eco: { s: save } }, root: { hidden: false }, phase: 'clear', battle: {},
    completedSteps: new Set(['attack']), skipOnceForAutoRetry: true,
  });
  expect(tutorial.begin({ code: '1-1', difficultyId: 'story' })).toBe(false);
  expect(tutorial.root.hidden).toBe(true);
  expect(tutorial.phase).toBeNull();
  expect(tutorial.skipOnceForAutoRetry).toBe(false);
  expect(save.tutorial.completed).toBe(false);
  expect(tutorial.completedSteps.size).toBe(0);
});

for (const savedAuto of [true, false]) test(`tutorial exit preserves actual AUTO and saved preference ${savedAuto} without rewriting its button`, () => {
  const battle = { player: { auto: !savedAuto }, setPaused() {} };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    phase: 'clear', beforeAuto: !savedAuto, battle, root: { hidden: false },
    app: { journey: { s: { autoBattle: savedAuto } }, eco: { s: {}, emit() {} }, ui: { toast() {} } },
  });
  tutorial.finish(false);
  expect(battle.player.auto).toBe(!savedAuto); expect(buttonOn).toBe(false);
  expect(tutorial.app.journey.s.autoBattle).toBe(savedAuto);
  expect(tutorial.app.eco.s.tutorial.completed).toBe(true); expect(tutorial.phase).toBeNull();
});

test('without a journey service tutorial leaves actual AUTO authority unchanged', () => {
  const battle = { player: { auto: false }, setPaused() {} };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    phase: 'attack', beforeAuto: true, battle, root: { hidden: false },
    app: { eco: { s: {}, emit() {} }, ui: { toast() {} } },
  });
  tutorial.finish(true); expect(battle.player.auto).toBe(false); expect(buttonOn).toBe(false);
});

function healHintFixture(hp: number, shownTier = 0) {
  const queries: string[] = [], classes = new Set<string>(), attributes = new Map<string, string>(), listeners = new Map<string, Function>();
  const potion = { disabled: false, parentElement: { dataset: {} as Record<string, string> },
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    querySelector: (selector: string) => selector === 'b' ? { textContent: '3' } : null,
    setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name),
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: (name: string, fn: Function) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const blocked = { value: false }, events: unknown[] = [];
  (document as any).querySelector = (selector: string) => {
    queries.push(selector);
    if (selector === '#modal.show, #masterworks[open]') return blocked.value ? {} : null;
    if (selector === '.exp-potions [data-potion="hp_tonic"]') return potion;
    throw Error(`unexpected heal hint selector: ${selector}`);
  };
  const battle = { active: true, paused: false, stage: { code: '1-1', difficultyId: 'story' }, player: { alive: true, hp, maxHp: 100 } };
  const tutorial: any = Object.assign(Object.create(BattleTutorial.prototype), {
    app: { battle, funnel: { track: (name: string, details: unknown) => events.push({ name, details }) } },
    phase: null, healTipLevel: shownTier, healTipUntil: 0, healTipButton: null, healTipPotionCount: null,
    healHintStatus: { textContent: '' }, healHintAlert: { textContent: '' },
  });
  tutorial.onHealPotionClick = () => tutorial.clearHealTip();
  return { tutorial, battle, blocked, queries, potion, classes, attributes, listeners, events };
}

for (const [hp, shownTier] of [[100, 0], [40, 1], [20, 2]]) test(`eligible stage with HP ${hp} and shown tier ${shownTier} skips irrelevant modal/potion lookup`, () => {
  const f = healHintFixture(hp, shownTier);
  for (let i = 0; i < 100; i++) f.tutorial.updateHealTip();
  expect(f.queries).toEqual([]); expect(f.events).toEqual([]);
  expect(f.tutorial.healTipLevel).toBe(shownTier); expect(f.tutorial.healTipUntil).toBe(0);
});

for (const [hp, tier] of [[50, 1], [30, 2]]) test(`open modal blocks HP ${hp} candidate without consuming tier ${tier}; closing admits that same hint`, () => {
  const f = healHintFixture(hp); f.blocked.value = true;
  f.tutorial.updateHealTip();
  expect(f.queries).toEqual(['#modal.show, #masterworks[open]']); expect(f.events).toEqual([]);
  expect(f.tutorial.healTipLevel).toBe(0); expect(f.tutorial.healTipUntil).toBe(0); expect(f.tutorial.healTipButton).toBeNull();
  f.blocked.value = false; f.tutorial.updateHealTip();
  expect(f.tutorial.healTipLevel).toBe(tier); expect(f.tutorial.healTipUntil).toBeGreaterThan(0);
  expect(f.tutorial.healTipButton).toBe(f.potion); expect(f.classes.has('tutorial-focus')).toBe(true);
  expect(f.listeners.get('click')).toBe(f.tutorial.onHealPotionClick); expect(f.attributes.has('aria-description')).toBe(true);
  expect(f.potion.parentElement.dataset.healTier).toBe(tier === 2 ? 'critical' : 'early');
  expect(f.events).toEqual([{ name: 'heal_hint_shown', details: { tier: tier === 2 ? 'critical' : 'early' } }]);
});

test('an open modal still cancels an active hint before the already-shown tier early return', () => {
  const f = healHintFixture(50); f.tutorial.updateHealTip();
  expect(f.tutorial.healTipLevel).toBe(1); expect(f.tutorial.healTipUntil).toBeGreaterThan(0);
  f.queries.length = 0; f.blocked.value = true; f.tutorial.updateHealTip();
  expect(f.queries).toEqual(['#modal.show, #masterworks[open]']);
  expect(f.tutorial.healTipLevel).toBe(1); expect(f.tutorial.healTipUntil).toBe(0); expect(f.tutorial.healTipButton).toBeNull();
  expect(f.classes.has('tutorial-focus')).toBe(false); expect(f.listeners.has('click')).toBe(false);
  expect(f.attributes.has('aria-description')).toBe(false); expect(f.potion.parentElement.dataset).toEqual({});
  expect(f.tutorial.healHintStatus.textContent).toBe(''); expect(f.tutorial.healHintAlert.textContent).toBe('');
  expect(f.events).toHaveLength(1);
});
