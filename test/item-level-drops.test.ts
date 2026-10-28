import { expect, test } from 'bun:test';
import { ITEMS_OF } from '../src/data/items.js';
import { itemStats, itemLevelUnits } from '../src/data/item-tier.js';
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
  expect(itemLevelUnits(1, 'E', 0)).toBe(0);
});

test('후반 스테이지 드랍은 il 보너스로 초반 +8 장비를 넘고 등급 순서가 유지된다', () => {
  const il = dropItemLevel(stageDef(3, 10)) as number;
  const early = itemStats({ id: (ITEMS_OF as any)('N', 'weapon')[0].id, enh: 8 }).atk;
  const atk = (r: string) => itemStats({ id: (ITEMS_OF as any)(r, 'weapon')[0].id, enh: 0, il }).atk;
  expect(atk('E')).toBeGreaterThan(early);   // 에픽 이상은 새 드랍만으로 초반 +8 노말을 넘는다
  expect(atk('N')).toBeLessThan(early);       // 노말은 여전히 정리 대상
  expect(atk('N')).toBeLessThan(atk('S')); expect(atk('S')).toBeLessThan(atk('E')); expect(atk('E')).toBeLessThan(atk('U')); expect(atk('U')).toBeLessThan(atk('L'));
  // 스테이지가 깊을수록 같은 장비가 강하다
  for (let i = 2; i < 80; i++) expect(itemLevelUnits(i, 'E', 0)).toBeGreaterThanOrEqual(itemLevelUnits(i - 1, 'E', 0));
});

test('직접 강화가 쌓일수록 il 보너스는 줄어 고강화 장비(90일 곡선)는 거의 그대로이고, 강화는 언제나 능력치를 올린다', () => {
  const id = (ITEMS_OF as any)('E', 'weapon')[0].id, il = 34;
  for (const r of ['N', 'S', 'E', 'U', 'L']) for (const slot of ['weapon', 'armor', 'ring', 'boots']) for (const il of [2, 20, 34, 80]) {
    const item = (ITEMS_OF as any)(r, slot)[0].id; let prev = { atk: -1, hp: -1 };
    for (let enh = 0; enh <= 20; enh++) { const s = itemStats({ id: item, enh, il }); expect(s.atk + s.hp).toBeGreaterThan(prev.atk + prev.hp); prev = s; }
  }
  const gap = (enh: number) => itemStats({ id, enh, il }).atk - itemStats({ id, enh }).atk;
  expect(gap(0)).toBeGreaterThan(gap(8)); expect(gap(8)).toBeGreaterThan(gap(15));
  expect(gap(15) / itemStats({ id, enh: 15 }).atk).toBeLessThan(0.12);
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
