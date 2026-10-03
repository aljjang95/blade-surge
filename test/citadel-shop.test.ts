import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CITADEL_POTIONS } from '../src/data/citadel-shop.js';
import { CONSUMABLES } from '../src/data/expansion.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';

const key = 'bladesurge_save_v1';
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
let rejectPrimary: boolean;
let rejectBackup: boolean;
beforeEach(() => {
  values = new Map(); rejectPrimary = false; rejectBackup = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (id: string) => values.get(id) ?? null,
    setItem: (id: string, raw: string) => {
      if ((id === key && rejectPrimary) || (id === key + '_backup' && rejectBackup)) throw new Error('quota');
      values.set(id, raw);
    },
    removeItem: (id: string) => values.delete(id),
  } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
const make = () => { const eco = new Economy(); return { eco, expedition: new ExpeditionEconomy(eco) }; };

describe('citadel merchant uses existing saved potion inventory', () => {
  test('each purchase spends the canonical gold price and grants exactly one combat consumable', () => {
    const { eco, expedition } = make();
    const before = structuredClone(eco.s);
    let notifications = 0;
    eco.onChange(() => notifications++);
    for (const stock of CITADEL_POTIONS) {
      const gold = eco.s.gold, owned = expedition.s.consumables[stock.id];
      expect(CONSUMABLES.some(potion => potion.id === stock.id)).toBe(true);
      expect(expedition.buyPotion(stock.id)).toMatchObject({ ok: true, potionId: stock.id, goldSpent: stock.gold, count: 1 });
      expect(eco.s.gold).toBe(gold - stock.gold);
      expect(expedition.s.consumables[stock.id]).toBe(owned + 1);
    }
    expect(CITADEL_POTIONS.map(stock => stock.gold)).toEqual([120, 180, 180]);
    expect(eco.s.gems).toBe(before.gems);
    expect(eco.s.spentKRW).toBe(before.spentKRW);
    expect(eco.s.purchases).toEqual(before.purchases);
    expect(eco.s.inventory).toEqual(before.inventory);
    expect(expedition.s.stats).toEqual(before.expedition.stats);
    expect(notifications).toBe(3);
    const reloaded = make();
    expect(reloaded.eco.s.gold).toBe(before.gold - 480);
    expect(reloaded.expedition.s.consumables).toEqual(expedition.s.consumables);
    expect(reloaded.expedition.consume('hp_tonic')).toMatchObject({ ok: true, effect: { heal: .35 } });
    expect(reloaded.expedition.s.consumables.hp_tonic).toBe(before.expedition.consumables.hp_tonic);
  });

  test('spending an exact balance allows one purchase; zero gold cannot duplicate it', () => {
    const { eco, expedition } = make();
    eco.s.gold = 120;
    const owned = expedition.s.consumables.hp_tonic;
    expect(expedition.buyPotion('hp_tonic').ok).toBe(true);
    expect(eco.s.gold).toBe(0);
    expect(expedition.s.consumables.hp_tonic).toBe(owned + 1);
    const paid = structuredClone(eco.s), stored = values.get(key);
    expect(expedition.buyPotion('hp_tonic').ok).toBe(false);
    expect(eco.s).toEqual(paid);
    expect(values.get(key)).toBe(stored);
    expect(make().eco.s.gold).toBe(0);
    expect(make().expedition.s.consumables.hp_tonic).toBe(owned + 1);
  });

  test('unknown IDs and caller-supplied prices or rewards do not change any currency or inventory', () => {
    const { eco, expedition } = make();
    const before = structuredClone(eco.s);
    for (const id of ['unknown', '__proto__', '', { id: 'hp_tonic', gold: 0, count: 999 }] as any[]) {
      expect(expedition.buyPotion(id).ok).toBe(false);
      expect(eco.s).toEqual(before);
    }
    expect(values.size).toBe(0);
  });

  test('a pending dungeon or arena blocks purchases without mutating its ticket', () => {
    for (const [kind, id] of [['dungeon', 'glass_garden'], ['arena', 'rookie']]) {
      values.clear();
      const { eco, expedition } = make();
      const start = expedition.begin(kind, id);
      expect(start.ok).toBe(true);
      const before = structuredClone(eco.s), stored = values.get(key);
      expect(expedition.buyPotion('hp_tonic').ok).toBe(false);
      expect(eco.s).toEqual(before);
      expect(values.get(key)).toBe(stored);
      expect(expedition.abandon(start.ticket).ok).toBe(true);
      expect(expedition.buyPotion('hp_tonic').ok).toBe(true);
    }
  });

  test('failed primary storage rolls back gold and stock; one retry commits once and survives reload', () => {
    const { eco, expedition } = make();
    eco.save();
    const before = structuredClone(eco.s), primary = values.get(key), backup = values.get(key + '_backup');
    let notifications = 0;
    eco.onChange(() => notifications++);
    rejectPrimary = true;
    expect(expedition.buyPotion('overdrive')).toMatchObject({ ok: false, error: '저장 공간을 확인해 주세요.' });
    expect(eco.s).toEqual(before);
    expect(values.get(key)).toBe(primary);
    expect(values.get(key + '_backup')).toBe(backup);
    expect(notifications).toBe(0);
    rejectPrimary = false;
    expect(expedition.buyPotion('overdrive').ok).toBe(true);
    expect(notifications).toBe(1);
    const reloaded = make();
    expect(reloaded.eco.s.gold).toBe(before.gold - 180);
    expect(reloaded.expedition.s.consumables.overdrive).toBe(before.expedition.consumables.overdrive + 1);
  });

  test('corrupt-primary recovery retains the purchased bottle and the matching deduction', () => {
    const { eco, expedition } = make();
    const gold = eco.s.gold, owned = expedition.s.consumables.aegis;
    expect(expedition.buyPotion('aegis').ok).toBe(true);
    values.set(key, '{broken');
    const reloaded = make();
    expect(reloaded.eco.storageStatus).toBe('recovered');
    expect(reloaded.eco.s.gold).toBe(gold - 180);
    expect(reloaded.expedition.s.consumables.aegis).toBe(owned + 1);
  });

  test('backup exhaustion reports a warning while preserving the primary purchase on reload', () => {
    const { eco, expedition } = make();
    eco.save();
    const before = structuredClone(eco.s);
    rejectBackup = true;
    const receipt = expedition.buyPotion('hp_tonic');
    expect(receipt.ok).toBe(true);
    expect(receipt.storageWarning).toBeTruthy();
    expect(values.has(key + '_backup')).toBe(false);
    const reloaded = make();
    expect(reloaded.eco.s.gold).toBe(before.gold - 120);
    expect(reloaded.expedition.s.consumables.hp_tonic).toBe(before.expedition.consumables.hp_tonic + 1);
  });

  test('inventory and malformed balance boundaries cannot spend gold on stock lost by save normalization', () => {
    const { eco, expedition } = make();
    expedition.s.consumables.hp_tonic = 100000000;
    const full = structuredClone(eco.s);
    expect(expedition.buyPotion('hp_tonic').ok).toBe(false);
    expect(eco.s).toEqual(full);
    for (const gold of [NaN, Infinity, -1, 120.5]) {
      eco.s.gold = gold;
      const before = structuredClone(eco.s);
      expect(expedition.buyPotion('aegis').ok).toBe(false);
      expect(eco.s).toEqual(before);
    }
    expect(values.size).toBe(0);
  });
});
