import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { growthOptions } from '../src/game/growth-options.js';
import { normalizeMasterworks, unlockMastery } from '../src/game/masterworks-core.js';
import { ITEM_BY_ID, enhanceCost, enhanceStones } from '../src/data/items.js';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

function fixture() {
  const eco = new Economy(), save: any = eco.s;
  save.selected = 'mage'; save.heroes.mage.level = 20;
  save.masterworks = normalizeMasterworks({ earnedRenown: 6, renown: 6 });
  const weapon = Object.values(ITEM_BY_ID).find(item => item.slot === 'weapon')!;
  save.inventory.push({ uid: 'growth-weapon', id: weapon.id, enh: 3 });
  save.heroes.mage.equip.weapon = 'growth-weapon';
  return eco;
}

test('viewing growth options does not mutate the save, and every quoted action uses the real economy', () => {
  const eco = fixture(), before = JSON.stringify(eco.s);
  const options: any[] = growthOptions(eco.s);
  expect(options.map(o => o.kind)).toEqual(['equipment', 'skill', 'mastery']);
  expect(JSON.stringify(eco.s)).toBe(before);
  for (const option of options) {
    eco.s = JSON.parse(before); const gold = eco.s.gold, stones = eco.s.stones;
    if (option.kind === 'equipment') {
      const r = eco.enhance(option.uid);
      expect(r.ok && r.success && !r.destroyed).toBe(true);
      expect(eco.s.gold).toBe(gold - option.gold); expect(eco.s.stones).toBe(stones - option.stones);
    } else if (option.kind === 'skill') {
      expect(eco.upgradeSkill(option.heroId, option.index)).toBe(true);
      expect(eco.s.gold).toBe(gold - option.gold);
    } else {
      const s: any = eco.s;
      expect(unlockMastery(s.masterworks, option.id).ok).toBe(true);
      expect(s.masterworks.renown).toBe(6 - option.renown);
    }
  }
});

test('equipment suggestions require the actual gold and stone cost and never enter a chance-based step', () => {
  const eco = fixture(); const save: any = eco.s, item = save.inventory[0];
  for (let level = 0; level <= 20; level++) {
    item.enh = level; save.gold = enhanceCost(level); save.stones = enhanceStones(level);
    expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(level < 8);
    save.gold--;
    expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
    save.gold++; if (enhanceStones(level)) save.stones--;
    if (enhanceStones(level)) expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  }
});

test('only the selected hero equipped item is suggested; removed items and foreign slots are ignored', () => {
  const eco = fixture(); const save: any = eco.s;
  save.selected = 'knight'; expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  save.selected = 'mage'; save.heroes.mage.equip.weapon = null; save.heroes.mage.equip.armor = 'growth-weapon';
  expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  save.heroes.mage.equip.weapon = 'growth-weapon'; save.inventory.length = 0;
  expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
});

test('locked or maxed skills are not advertised, and an exact affordable gold balance is honored', () => {
  const eco = fixture(); const save: any = eco.s, hero = save.heroes.mage;
  hero.level = 1; hero.skills = [10, 10, 10, 10, 1, 1];
  expect(growthOptions(save).some(o => o.kind === 'skill')).toBe(false);
  hero.level = 20;
  const skill: any = growthOptions(save).find(o => o.kind === 'skill');
  expect(skill.index).toBe(4); save.gold = skill.gold - 1;
  expect(growthOptions(save).some(o => o.kind === 'skill')).toBe(false);
  save.gold++;
  expect(growthOptions(save).find(o => o.kind === 'skill')).toEqual(skill);
});

test('mastery offers respect prerequisites and exclude owned nodes with insufficient remaining renown', () => {
  const eco = fixture(); const save: any = eco.s;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'assault_1', renown: 6 });
  save.masterworks.unlocked = ['assault_1']; save.masterworks.renown = 9;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'survival_1', renown: 6 });
  save.masterworks.renown = 10;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'assault_2', renown: 10 });
  save.masterworks.renown = 5;
  expect(growthOptions(save).some(o => o.kind === 'mastery')).toBe(false);
});

test('an empty or invalid current context cannot advertise a purchase', () => {
  const eco = fixture(); const save: any = eco.s;
  save.gold = 0; save.stones = 0; save.masterworks.renown = 0;
  expect(growthOptions(save)).toEqual([]);
  expect(growthOptions(null)).toEqual([]);
  save.selected = 'missing'; expect(growthOptions(save)).toEqual([]);
});
