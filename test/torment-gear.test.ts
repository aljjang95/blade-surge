import { expect, test } from 'bun:test';
import { TORMENT, SEASON } from '../src/data/content-90d.js';
import { ITEMS_OF } from '../src/data/items.js';
import { itemStats, itemTierMul, itemTierPrefix } from '../src/data/item-tier.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { applyDifficulty, resolveDifficulty } from '../src/game/difficulty.js';
import { stageDef } from '../src/data/stages.js';
import { grantLootItem } from '../src/shared/settlement.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const newEco = (storage = memory()) => new Economy({ now: () => SEASON.startMs + 3 * 86400000, storage, rng: () => .5 });
const hellCleared = (eco: any) => { eco.s.progress.unlocked = 60; for (let st = 1; st <= 10; st++) eco.s.endgame.peak[`1-${st}`] = 3; return eco; };
const tormentStage = (eco: any, tier: number) => applyDifficulty(stageDef(1, 5), resolveDifficulty(eco.s, 1, 5, `torment-${tier}`)) as any;
const weapon = () => (ITEMS_OF as any)('L', 'weapon')[0].id;

test('장비 파워 배율: tp 가 없으면 1(기존 장비 그대로), 있으면 1 + step×tp', () => {
  expect(itemTierMul(undefined)).toBe(1); expect(itemTierMul(0)).toBe(1); expect(itemTierMul(-3)).toBe(1); expect(itemTierMul(1.5)).toBe(1); expect(itemTierMul(NaN)).toBe(1);
  expect(itemTierMul(10)).toBeCloseTo(1 + TORMENT.itemPowerStep * 10, 10);
  expect(itemTierMul(999)).toBeCloseTo(1 + TORMENT.itemPowerStep * TORMENT.maxTier, 10);
  for (const enh of [0, 8, 17, 20]) {
    const base = itemStats({ id: weapon(), enh }), withTp = itemStats({ id: weapon(), enh, tp: 20 });
    expect(itemStats({ id: weapon(), enh, tp: 0 })).toEqual(base);
    expect(withTp.atk).toBeGreaterThan(base.atk * 1.5);
    expect(withTp.crit).toBe(base.crit);                       // 치명은 장비 고유값이라 배율이 없다
  }
  // 단계가 높을수록 강하다
  for (let tp = 1; tp <= 50; tp++) expect(itemStats({ id: weapon(), enh: 10, tp }).atk).toBeGreaterThanOrEqual(itemStats({ id: weapon(), enh: 10, tp: tp - 1 }).atk);
});

test('고대·태고 접두는 단계 구간으로만 정해진다', () => {
  expect(itemTierPrefix(undefined)).toBe(''); expect(itemTierPrefix(9)).toBe('');
  expect(itemTierPrefix(10)).toBe('고대'); expect(itemTierPrefix(24)).toBe('고대');
  expect(itemTierPrefix(25)).toBe('태고'); expect(itemTierPrefix(50)).toBe('태고');
});

test('저장 정화: tp 는 1~50 정수만 남고 기존 장비는 필드가 늘지 않으며 두 번 정화해도 같다', () => {
  const eco = newEco();
  const raw: any = { inventory: [{ uid: 1, id: weapon(), enh: 3 }, { uid: 2, id: weapon(), enh: 4, tp: 12 }, { uid: 3, id: weapon(), enh: 1, tp: 999 }, { uid: 4, id: weapon(), enh: 1, tp: -4 }, { uid: 5, id: weapon(), enh: 1, tp: 'x' }, { uid: 6, id: weapon(), enh: 1, tp: 2.5 }] };
  const once = normalizeSave(raw, eco.fresh());
  // 귀속 이전 저장이라 지금 고른 영웅 소유 + 첫 이동 무료(legacy) 표시가 붙는다(docs/GEAR_OWNERSHIP_VAULT.md 4절).
  expect(once.inventory.find((i: any) => i.uid === 1)).toEqual({ uid: 1, id: weapon(), enh: 3, owner: 'knight', legacy: 1 });
  expect(once.inventory.find((i: any) => i.uid === 2)).toEqual({ uid: 2, id: weapon(), enh: 4, tp: 12, owner: 'knight', legacy: 1 });
  expect(once.inventory.find((i: any) => i.uid === 3).tp).toBe(50);
  for (const uid of [4, 5, 6]) expect(Object.hasOwn(once.inventory.find((i: any) => i.uid === uid), 'tp')).toBe(false);
  expect(normalizeSave(once, eco.fresh()).inventory).toEqual(once.inventory);
});

test('고통 단계 판의 필드 드랍 장비는 그 단계의 tp 를 달고 나오고, 일반 판·정산 뒤에는 달지 않는다', () => {
  const eco = hellCleared(newEco());
  const normalStage = applyDifficulty(stageDef(1, 5), resolveDifficulty(eco.s, 1, 5, 'hell')) as any;
  eco.beginFieldRewards(normalStage);
  expect(Object.hasOwn(eco.fieldDrop('L'), 'tp')).toBe(false);
  eco.discardFieldRewards(eco._fieldRewards);
  const stage = tormentStage(eco, 1);
  const ledger = eco.beginFieldRewards(stage);
  expect(eco.fieldDrop('L').tp).toBe(1);
  expect(eco.fieldDrop('E').tp).toBe(1);
  ledger.settled = true;
  expect(Object.hasOwn(eco.fieldDrop('L'), 'tp')).toBe(false);   // 정산이 끝난 장부는 장비에 영향을 주지 않는다
  expect(Object.hasOwn(eco.addItem('L'), 'tp')).toBe(false);     // 가챠 등 다른 경로도 그대로
  // 저장·다시 불러오기 뒤에도 tp 가 남는다
  const storage = memory(); const a = newEco(storage); hellCleared(a);
  a.beginFieldRewards(tormentStage(a, 1)); const dropped = a.fieldDrop('L'); a.save();
  const b = newEco(storage);
  expect(b.s.inventory.find((i: any) => i.uid === dropped.uid).tp).toBe(1);
});

test('정산 보너스 장비(풀 클리어·더블)도 tp 를 단다', () => {
  const eco = hellCleared(newEco()); eco.s.endgame.torment.best = 5;
  const stage = tormentStage(eco, 4);
  eco.beginFieldRewards(stage);
  const receipt = eco.completeStage(stage, 3, { fullClear: true });
  expect(receipt.loot.length).toBeGreaterThan(0);
  for (const item of receipt.loot) expect(item.tp).toBe(4);
});

test('서버 정산 grantLootItem 은 같은 tp 를 단다(없으면 필드도 없다)', () => {
  const eco = newEco();
  expect(grantLootItem(eco, { id: weapon() } as any)).toEqual({ uid: 1, id: weapon(), enh: 0, owner: eco.s.selected });
  expect(grantLootItem(eco, { id: weapon() } as any, 7)).toEqual({ uid: 2, id: weapon(), enh: 0, tp: 7, owner: eco.s.selected });
  expect(eco.s.inventory.map((i: any) => i.tp)).toEqual([undefined, 7]);
});

test('tp 장비를 끼면 영웅 전투력이 같은 장비의 tp 없는 것보다 크다(heroEquipBonus 경유)', () => {
  const eco = newEco();
  const plain = eco.addItem('L', 'weapon'), strong = eco.addItem('L', 'weapon', () => .5, 30);
  expect(strong.tp).toBe(30);
  eco.hero('knight').equip.weapon = plain.uid;
  const before = eco.heroPower('knight');
  eco.hero('knight').equip.weapon = strong.uid;
  expect(eco.heroPower('knight')).toBeGreaterThan(before);
});
