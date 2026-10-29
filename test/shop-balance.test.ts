// 상점·경제 밸런스 계약(docs/balance-audit-2026-10-24.md): 1레벨 신규 저장은 전설·유니크·후반 재료를 재화로 살 수 없고,
// 가격 곡선은 등급 순으로 오르며 판매가보다 비싸고, 플레이로 얻는 길(드랍·재료 제작·조각 제작)은 남아 있다.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { TownService } from '../src/game/town-service.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { TOWN_SHOP } from '../src/data/towns.js';
import { SKUS } from '../src/data/shop.js';
import { RECIPES } from '../src/data/expansion.js';
import { ITEM_BY_ID, RARITY_INFO, THEMED_SETS, CRAFT_COST } from '../src/data/items.js';
import { lootTable } from '../src/data/loot-tables.js';
import { RARITY_BUY_LEVEL, SKU_BUY_LEVEL, accountLevel, levelGate, skuGate, stageForLevel } from '../src/data/shop-gates.js';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

const RANK = ['N', 'S', 'E', 'U', 'L'];
const gemSkus = SKUS.filter(s => s.kind === 'gem');

test('신규 저장 1레벨: 시작 보석(1,500 + 우편 500)으로 후반 재료·대량 골드를 살 수 없고 보석도 줄지 않는다', () => {
  const eco = new Economy();
  expect(accountLevel(eco.s)).toBe(1);
  expect([eco.s.gold, eco.s.gems, eco.s.mail[0].rewards.gems]).toEqual([12000, 1500, 500]);
  eco.s.gems += eco.s.mail[0].rewards.gems; // 우편 수령분까지 합친 실제 1레벨 보유량
  for (const id of ['stone_legend', 'stone_hi', 'tstone10', 'gold3', 'gold2']) {
    const before = JSON.stringify(eco.s);
    expect(eco.purchase(id)).toMatchObject({ ok: false, reason: 'level', need: SKU_BUY_LEVEL[id as keyof typeof SKU_BUY_LEVEL], have: 1 });
    expect(JSON.stringify(eco.s)).toBe(before);
  }
  // 게이트 없는 상품은 그대로 산다(무과금 보석 사용처는 남는다).
  expect(eco.purchase('gold1')).toMatchObject({ ok: true }); expect(eco.purchase('stone1')).toMatchObject({ ok: true });
  expect(eco.s.stones3).toBe(0); expect(eco.s.transcendStones).toBe(0);
});

test('보석 상품 게이트는 쓰임새 순서(강화석 단계·골드 금액)를 따르고 해금 레벨에서 열린다', () => {
  const need = (id: string) => skuGate({ id }, { heroes: {} }).need;
  expect(need('stone1')).toBeLessThan(need('stone_hi')); expect(need('stone_hi')).toBeLessThan(need('stone_legend'));
  expect(need('gold1')).toBeLessThan(need('gold2')); expect(need('gold2')).toBeLessThan(need('gold3'));
  for (const id of Object.keys(SKU_BUY_LEVEL)) expect(gemSkus.some(s => s.id === id)).toBe(true);
  const eco = new Economy(); eco.s.gems = 100_000;
  for (const [id, level] of Object.entries(SKU_BUY_LEVEL)) {
    eco.s.heroes.knight.level = level - 1; expect(eco.purchase(id)).toMatchObject({ ok: false, reason: 'level' });
    eco.s.heroes.mage.level = level; expect(eco.purchase(id)).toMatchObject({ ok: true }); // 계정 진행도 = 최고 레벨 영웅
    eco.s.heroes.mage.level = 1;
  }
  const gate = levelGate(30, { heroes: { knight: { level: 7 } } });
  expect(gate).toMatchObject({ ok: false, label: 'Lv.30 해금' }); expect(gate.text).toContain(stageForLevel(30)); expect(gate.text).toContain('현재 Lv.7');
  // 2026-10-29 입문 레벨 곡선에 맞춰 2·3장 권장 레벨이 9→21·22→34 로 내려가 Lv.20·30 이 처음 권장되는 관문도 뒤로 갔다(loot-tables.js CHAPTER_START_LEVEL).
  expect(stageForLevel(20)).toBe('2-10'); expect(stageForLevel(30)).toBe('3-8');
});

test('마을 상인 장비 가격 곡선: 등급 순으로 단조 증가, 모두 판매가보다 비싸 차익이 없다', () => {
  const gear = TOWN_SHOP.filter((o: any) => o.itemId) as any[];
  for (const o of gear) {
    expect((ITEM_BY_ID as any)[o.itemId].rarity).toBe(o.rarity);
    expect(o.price.gold).toBeGreaterThan(RARITY_INFO[o.rarity as keyof typeof RARITY_INFO].sell);
    expect(o.requires?.level ?? 1).toBe(RARITY_BUY_LEVEL[o.rarity as keyof typeof RARITY_BUY_LEVEL]);
  }
  const ranks = [...new Set(gear.map(o => o.rarity))].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b));
  for (let i = 1; i < ranks.length; i++) {
    const lowMax = Math.max(...gear.filter(o => o.rarity === ranks[i - 1]).map(o => o.price.gold));
    const highMin = Math.min(...gear.filter(o => o.rarity === ranks[i]).map(o => o.price.gold));
    expect(highMin).toBeGreaterThan(lowMax);
  }
  // 제작(골드+재료) 장비도 골드만으로 판매가를 넘는다.
  for (const r of RECIPES.filter((r: any) => r.itemId) as any[]) expect(r.gold).toBeGreaterThan(RARITY_INFO[(ITEM_BY_ID as any)[r.itemId].rarity as keyof typeof RARITY_INFO].sell);
  // 최소 레벨도 등급 순.
  for (let i = 1; i < RANK.length; i++) expect(RARITY_BUY_LEVEL[RANK[i] as keyof typeof RARITY_BUY_LEVEL]).toBeGreaterThanOrEqual(RARITY_BUY_LEVEL[RANK[i - 1] as keyof typeof RARITY_BUY_LEVEL]);
});

test('마을 상인: 1레벨은 유니크·레전드리를 살 수 없고 마을이 열려도 레벨 전에는 level로 거절, 재화는 그대로', () => {
  const eco = new Economy(); eco.s.gold = 1_000_000; eco.s.expedition.materials = { glass_leaf: 99, ember_core: 99, star_dust: 99 };
  const service = new TownService(eco);
  for (const o of TOWN_SHOP.filter((o: any) => ['U', 'L'].includes(o.rarity)) as any[]) expect(service.buy(o.townId, o.id).ok).toBe(false);
  // 마을 해금만 강제로 열어도(진행도 우회) 레벨 게이트가 남는다.
  eco.s.towns.unlockedTownIds = ['oathhold', 'emberport', 'starcrest'];
  eco.s.heroes.knight.level = 15;
  const before = JSON.stringify(eco.s);
  expect(service.buy('starcrest', 'starcrest_mail')).toMatchObject({ ok: false, reason: 'level', need: 20, have: 15 });
  expect(JSON.stringify(eco.s)).toBe(before);
  const offer: any = service.shop('starcrest').find((o: any) => o.id === 'starcrest_mail');
  expect(offer).toMatchObject({ levelLocked: true, requires: { level: 20 } }); expect(offer.lockText).toContain('Lv.20');
  eco.s.heroes.knight.level = 9; expect(service.buy('emberport', 'emberport_bloodstep')).toMatchObject({ ok: false, reason: 'level', need: 10 });
  eco.s.heroes.knight.level = 20;
  expect(service.buy('starcrest', 'starcrest_mail')).toMatchObject({ ok: true });
  expect(eco.s.gold).toBe(1_000_000 - 52_000);
  expect((service.shop('starcrest').find((o: any) => o.id === 'starcrest_blade') as any)?.levelLocked).toBeUndefined();
});

test('무과금 경로는 남는다: 1장 보스 드랍에 U·L, 재료 제작 유니크, 테마 세트 조각 제작(레전드리 세트는 불가)', () => {
  const boss = lootTable(1, 'boss', 'story');
  expect(boss.gearWeights.U).toBeGreaterThan(0); expect(boss.gearWeights.L).toBeGreaterThan(0);
  const eco = new Economy();
  // 원정 재료(유리 정원 3회분)로 1레벨 제작 공방 유니크 — 플레이로 얻는 길이라 레벨 게이트를 두지 않는다.
  const recipe: any = RECIPES.find((r: any) => r.itemId === 'exp_glasswarden_weapon');
  eco.s.gold = recipe.gold; eco.s.expedition.materials.glass_leaf = 9;
  const crafted = new ExpeditionEconomy(eco).craft(recipe.id);
  expect(crafted.ok).toBe(true); expect((ITEM_BY_ID as any)[crafted.item.id].rarity).toBe('U');
  // 세트 조각 제작: 테마 세트(유니크)만, 등급 세트 dragon(레전드리)은 조각으로 만들 수 없다.
  eco.s.fragments = CRAFT_COST * 2;
  expect(eco.craftSetItem('dragon', 'weapon')).toEqual({ ok: false, reason: 'none' });
  expect(eco.s.fragments).toBe(CRAFT_COST * 2);
  const set = eco.craftSetItem(THEMED_SETS[0], 'weapon');
  expect(set.ok).toBe(true); expect((ITEM_BY_ID as any)[(set as any).inst.id].rarity).toBe('U');
});

test('장비 순번은 줄지 않는다: 가장 큰 uid를 팔고 다시 불러와도 같은 uid를 재사용하지 않는다', () => {
  const eco = new Economy();
  const a = eco.addItem('N'), b = eco.addItem('N');
  eco.sellItem(b.uid);
  const migrated = eco.migrate(structuredClone(eco.s));
  expect(migrated.invSeq).toBe(b.uid + 1);
  expect(migrated.inventory.map((x: any) => x.uid)).toEqual([a.uid]);
});
