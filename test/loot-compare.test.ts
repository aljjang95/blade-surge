import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ITEM_POOL, RARITY_INFO } from '../src/data/items.js';
import { buildInventoryModel } from '../src/ui/maple-inventory.js';
import { compareLoot, compareText, markFresh, isFresh, clearFresh, resetFresh, freshCount } from '../src/ui/loot-compare.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  resetFresh();
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

const make = () => { const eco: any = new Economy(); eco.s = eco.fresh(); return eco; };
const give = (eco: any, id: string, enh = 0) => { const inst = { uid: eco.s.invSeq++, id, enh }; eco.s.inventory.push(inst); return inst; };
const poolId = (slot: string, rarity: string) => (ITEM_POOL as any)[slot].find((it: any) => it.rarity === rarity).id;

test('빈 슬롯이나 더 약한 장비 대비: 높은 등급은 장착 추천, 낮은 등급은 판매가 표시', () => {
  const eco = make(), hero = eco.s.selected;
  const low = give(eco, poolId('weapon', 'N')), high = give(eco, poolId('weapon', 'E'));
  eco.equip(hero, low.uid);
  const up = compareLoot(eco, hero, high.uid)!;
  expect(up.verdict).toBe('better'); expect(up.powerDelta).toBeGreaterThan(0);
  expect(compareText(up).short).toBe('▲ 장착 추천');
  expect(compareText(up).long).toContain('전투력 +');
  eco.equip(hero, high.uid);
  expect(compareLoot(eco, hero, high.uid)!.verdict).toBe('equipped');
  const down = compareLoot(eco, hero, low.uid)!;
  expect(down.verdict).toBe('worse'); expect(down.sell).toBe(RARITY_INFO.N.sell);
  expect(compareText(down).short).toBe('판매 ' + RARITY_INFO.N.sell.toLocaleString('ko-KR'));
});

test('없는 장비는 null', () => {
  expect(compareLoot(make(), make().s.selected, 99999)).toBeNull();
  expect(compareText(null)).toEqual({ short: '', long: '' });
});

test('NEW 표시는 세션 메모리에만 있고 열어 보면 꺼지며 가방 모델에 반영된다', () => {
  const eco = make();
  const a = give(eco, poolId('weapon', 'E')), b = give(eco, poolId('ring', 'N'));
  const before = JSON.stringify(eco.s);
  markFresh([a.uid]);
  expect(JSON.stringify(eco.s)).toBe(before); // 저장 스키마·값 불변
  const cells = () => buildInventoryModel(eco, { tab: 'gear' }).cells;
  expect(cells().find((c: any) => c.uid === a.uid).fresh).toBe(true);
  expect(cells().find((c: any) => c.uid === b.uid).fresh).toBe(false);
  clearFresh(a.uid);
  expect(isFresh(a.uid)).toBe(false); expect(freshCount()).toBe(0);
  markFresh([undefined as any, 'x' as any, b.uid]);
  expect(freshCount()).toBe(1);
});
