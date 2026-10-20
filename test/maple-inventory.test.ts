import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { buildInventoryModel, slotCapacity, GRID_COLUMNS, MIN_SLOTS, INVENTORY_TABS } from '../src/ui/maple-inventory.js';
import { buildEquipmentModel } from '../src/ui/maple-equipment.js';
import { ITEM_POOL, SLOTS } from '../src/data/items.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

const make = () => { const eco: any = new Economy(); eco.s = eco.fresh(); return eco; };
const give = (eco: any, id: string, enh = 0) => { const inst = { uid: eco.s.invSeq++, id, enh }; eco.s.inventory.push(inst); return inst; };
const poolId = (slot: string, rarity: string) => (ITEM_POOL as any)[slot].find((it: any) => it.rarity === rarity).id;

test('칸 수는 24칸 이상이며 한 줄 6칸의 배수로 늘어난다', () => {
  expect(GRID_COLUMNS).toBe(6);
  expect(slotCapacity(0)).toBe(MIN_SLOTS);
  expect(slotCapacity(24)).toBe(24);
  expect(slotCapacity(25)).toBe(30);
});

test('새 저장에서는 소비 탭에 이미 저장된 값만 보이고 장비 · 기타 · 캐시는 비어 있다', () => {
  const eco = make();
  expect(buildInventoryModel(eco, { tab: 'gear' }).used).toBe(0);
  const use = buildInventoryModel(eco, { tab: 'use' });
  const byId = Object.fromEntries(use.cells.map((c: any) => [c.id, c.qty]));
  expect(byId.stones).toBe(12); expect(byId.tickets).toBe(5); expect(byId.bless).toBe(1); expect(byId.protect).toBe(1); expect(byId.hp_tonic).toBe(3);
  expect(byId.stones2).toBeUndefined();
  expect(buildInventoryModel(eco, { tab: 'etc' }).empty).toBe(true);
  expect(buildInventoryModel(eco, { tab: 'cash' }).empty).toBe(true);
  for (const tab of INVENTORY_TABS) expect(buildInventoryModel(eco, { tab: tab.id }).capacity).toBeGreaterThanOrEqual(24);
});

test('기타 탭은 제작 재료와 세트 조각만, 캐시 탭은 보유 아바타만 보여 준다', () => {
  const eco = make();
  eco.s.fragments = 7; eco.s.expedition.materials.glass_leaf = 4; eco.s.avatars.owned.push('avatar_knight_sakura');
  expect(buildInventoryModel(eco, { tab: 'etc' }).cells.map((c: any) => [c.id, c.qty])).toEqual([['glass_leaf', 4], ['fragments', 7]]);
  const cash = buildInventoryModel(eco, { tab: 'cash' }).cells;
  expect(cash.length).toBe(1); expect(cash[0].type).toBe('avatar'); expect(cash[0].worn).toBe(false);
});

test('장비 탭은 기존 가방과 같은 원천이며 등급 → 강화 순으로 정렬하고 착용 영웅을 표시한다', () => {
  const eco = make();
  const low = give(eco, poolId('weapon', 'N')), high = give(eco, poolId('weapon', 'E'), 3), ring = give(eco, poolId('ring', 'N'));
  eco.equip(eco.s.selected, high.uid);
  const model = buildInventoryModel(eco, { tab: 'gear' });
  expect(model.used).toBe(eco.s.inventory.length);
  expect(model.cells.map((c: any) => c.uid)).toEqual([high.uid, ...[low.uid, ring.uid].sort((a, b) => b - a)].slice(0, 3));
  expect(model.cells[0].owner).toBe(eco.s.selected); expect(model.cells[0].enh).toBe(3); expect(model.cells[1].owner).toBeNull();
  const weaponsOnly = buildInventoryModel(eco, { tab: 'gear', slot: 'weapon' });
  expect(weaponsOnly.cells.every((c: any) => c.slot === 'weapon')).toBe(true); expect(weaponsOnly.used).toBe(2);
});

test('장비가 25개를 넘으면 한 줄(6칸)씩 칸이 늘어난다', () => {
  const eco = make();
  for (let i = 0; i < 25; i++) give(eco, poolId('weapon', 'N'));
  const model = buildInventoryModel(eco, { tab: 'gear' });
  expect(model.used).toBe(25); expect(model.capacity).toBe(30);
});

test('모델을 만드는 일은 저장 데이터를 바꾸지 않고 알 수 없는 탭 · 부위는 기본값으로 돌린다', () => {
  const eco = make(); give(eco, poolId('weapon', 'N'));
  const before = JSON.stringify(eco.s);
  const model = buildInventoryModel(eco, { tab: 'nope', slot: 'nope' });
  expect(model.tab).toBe('gear'); expect(model.slot).toBe('all');
  buildEquipmentModel(eco);
  expect(JSON.stringify(eco.s)).toBe(before);
});

test('장비 창 모델은 4개 부위를 모두 돌려주고 착용한 칸에만 장비를 채운다', () => {
  const eco = make(), weapon = give(eco, poolId('weapon', 'N'), 2);
  eco.equip(eco.s.selected, weapon.uid);
  const model = buildEquipmentModel(eco);
  expect(model.slots.map((s: any) => s.slot)).toEqual(SLOTS);
  const filled = model.slots.filter((s: any) => !s.empty);
  expect(filled.length).toBe(1); expect(filled[0].slot).toBe('weapon'); expect(filled[0].uid).toBe(weapon.uid); expect(filled[0].enh).toBe(2);
  expect(model.slots.filter((s: any) => s.empty).every((s: any) => typeof s.art === 'string')).toBe(true);
  expect(model.power).toBeGreaterThan(0);
});
