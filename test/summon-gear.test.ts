import { expect, test } from 'bun:test';
import { SUMMON_GEAR } from '../src/data/summon-gear.js';
import { ITEM_BY_ID, RARITY_COLOR } from '../src/data/items.js';
import { Economy } from '../src/game/economy.js';
import { createLootVisual } from '../src/game/loot-visual.js';

const itemById: Record<string, any> = ITEM_BY_ID;
const rarityColor: Record<string, string> = RARITY_COLOR;

test('summon gear ships a distinct, rarity-coloured drop for every equipment slot', () => {
  expect(SUMMON_GEAR).toHaveLength(8);
  expect(new Set(SUMMON_GEAR.map((item) => item.id)).size).toBe(SUMMON_GEAR.length);
  expect(new Set(SUMMON_GEAR.map((item) => item.slot))).toEqual(new Set(['weapon', 'armor', 'ring', 'boots']));
  for (const item of SUMMON_GEAR) {
    expect(itemById[item.id]).toMatchObject({ slot: item.slot, rarity: item.rarity, summonShape: item.summonShape });
    expect(rarityColor[item.rarity]).toMatch(/^#/);
    expect(item.summon).toMatchObject({ id: expect.any(String), name: expect.any(String), flash: expect.any(String) });
    expect(item.summon.interval).toBeGreaterThan(2);
    expect(item.summon.ratio).toBeGreaterThan(0);
  }
});

test('equipping four summon pieces exposes four independent combat familiars', () => {
  const eco = new Economy();
  const equip: Record<string, number | null> = { weapon: null, armor: null, ring: null, boots: null };
  for (const item of SUMMON_GEAR.filter((item) => item.rarity === 'U')) {
    const inst = { uid: eco.s.invSeq++, id: item.id, enh: 0 };
    eco.s.inventory.push(inst); equip[item.slot] = inst.uid;
  }
  const bonus = eco.heroEquipBonus('knight', equip);
  expect(bonus.summons).toHaveLength(4);
  expect(new Set((bonus.summons as any[]).map((summon) => summon.id)).size).toBe(4);
});

test('summon gear gets a separate 3D field silhouette while retaining the rarity material', () => {
  const cache = new Map();
  const normal: any = createLootVisual({ id: 'w_iron', rarity: 'N' }, cache);
  const summon: any = createLootVisual({ id: 'sg_ember_lantern', rarity: 'U' }, cache);
  expect(summon.userData.lootSummon).toEqual('ember_fox');
  expect(summon.children).toHaveLength(2);
  expect(summon.children[0].geometry).not.toBe(normal.children[0].geometry);
  expect(summon.children[1].material).not.toBe(normal.children[1].material);
  normal.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); });
  summon.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); });
  for (const value of cache.values()) for (const material of value) material.dispose();
});
