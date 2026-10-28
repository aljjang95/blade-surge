import { expect, test } from 'bun:test';
import { ITEMS_OF } from '../src/data/items.js';
import { itemStats, itemLevelMul } from '../src/data/item-tier.js';
import { dropItemLevel } from '../src/data/loot-tables.js';
import { stageDef } from '../src/data/stages.js';
import { killDrops, grantLootItem } from '../src/shared/settlement.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const newEco = () => new Economy({ now: () => 1_800_000_000_000, storage: memory(), rng: () => .5 });
const weapon = () => (ITEMS_OF as any)('S', 'weapon')[0].id;

test('il 이 없거나 1 이하면 능력치가 그대로다(기존 저장·가챠·제작 장비 보존)', () => {
  const base = itemStats({ id: weapon(), enh: 5 });
  for (const il of [undefined, 0, 1, -4, 2.5, NaN]) expect(itemStats({ id: weapon(), enh: 5, il } as any)).toEqual(base);
  expect(itemLevelMul(1)).toBe(1);
});

test('후반 스테이지 드랍은 il 배율로 초반 +8 장비를 넘는다', () => {
  const early = itemStats({ id: (ITEMS_OF as any)('N', 'weapon')[0].id, enh: 8 }).atk;
  const late = itemStats({ id: (ITEMS_OF as any)('E', 'weapon')[0].id, enh: 0, il: dropItemLevel(stageDef(3, 10)) as number }).atk;
  expect(late).toBeGreaterThan(early);
  for (let il = 2; il < 80; il++) expect(itemLevelMul(il)).toBeGreaterThanOrEqual(itemLevelMul(il - 1));
});

test('1-1 은 il 이 붙지 않아 균형이 그대로이고 원정·고통 단계도 붙지 않는다', () => {
  expect(dropItemLevel(stageDef(1, 1))).toBe(0);
  expect(dropItemLevel(stageDef(3, 10))).toBeGreaterThan(30);
  expect(dropItemLevel({ ...(stageDef(3, 10) as any), expedition: { kind: 'x' } })).toBe(0);
  expect(dropItemLevel({ ...(stageDef(3, 10) as any), difficultyId: 'torment-5' })).toBe(0);
  expect(dropItemLevel(null)).toBe(0);
});

test('같은 lootSeed 의 드랍은 il 만 더해질 뿐 장비 id·등급·순서가 il 없이도 같다(서버 정산 == 미리보기)', () => {
  const stage: any = stageDef(3, 10), seed = 12345;
  const a = killDrops(stage, seed, 'boss', 0), b = killDrops(stage, seed, 'boss', 0);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  const items = a.filter((d: any) => d.kind === 'item');
  expect(items.length).toBeGreaterThan(0);
  const eco = newEco();
  for (const d of items) {
    expect(d.il).toBe(dropItemLevel(stage));
    expect(grantLootItem(eco, d).il).toBe(d.il);
    expect(grantLootItem(eco, d, 7).il).toBeUndefined();   // 고통 단계 장비에는 il 을 달지 않는다
  }
  // il 이 없는 1-1 드랍은 필드를 두지 않는다
  const first: any[] = killDrops(stageDef(1, 1) as any, seed, 'boss', 0).filter((d: any) => d.kind === 'item');
  expect(first.every((d) => d.il === undefined)).toBe(true);
});

test('economy.addItem 과 저장 정화가 il 을 지키고 범위 밖은 버린다', () => {
  const eco = newEco();
  const inst = eco.addItem('S', 'weapon', () => .1, 0, 30) as any;
  expect(inst.il).toBe(30);
  expect((eco.addItem('S', 'weapon', () => .1, 0, 0) as any).il).toBeUndefined();
  expect((eco.addItem('S', 'weapon', () => .1, 5, 30) as any).il).toBeUndefined();
  const raw: any = { inventory: [{ uid: 1, id: weapon(), enh: 1, il: 30 }, { uid: 2, id: weapon(), enh: 1, il: 999 }, { uid: 3, id: weapon(), enh: 1, il: 'x' }, { uid: 4, id: weapon(), enh: 1, il: 1 }, { uid: 5, id: weapon(), enh: 1, tp: 3, il: 30 }] };
  const s = normalizeSave(raw, eco.fresh()) as any;
  expect(s.inventory.map((x: any) => x.il)).toEqual([30, 80, undefined, undefined, undefined]);
  expect(normalizeSave(JSON.parse(JSON.stringify(s)), eco.fresh()).inventory).toEqual(s.inventory);
});
