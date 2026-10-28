import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ITEM_POOL } from '../src/data/items.js';
import { betterItems, planBestEquip, applyBestEquip, applyBestEquipAll, junkItems, salvagePreview, salvageItems, autoSalvageNormal, gearScore } from '../src/game/gear-advice.js';
import { growthOptions } from '../src/game/growth-options.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

const make = () => { const eco: any = new Economy(); eco.s = eco.fresh(); return eco; };
const id = (slot: string, rarity: string, n = 0) => (ITEM_POOL as any)[slot].filter((it: any) => it.rarity === rarity)[n].id;
const give = (eco: any, itemId: string, enh = 0, extra: any = {}) => { const inst = { uid: eco.s.invSeq++, id: itemId, enh, ...extra }; eco.s.inventory.push(inst); return inst; };

test('더 좋은 장비 표시: 전투력이 오르는 후보만, 다른 영웅이 끼고 있는 장비는 제외', () => {
  const eco = make(), hero = eco.s.selected;
  const worn = give(eco, id('weapon', 'N')), good = give(eco, id('weapon', 'E')), weak = give(eco, id('weapon', 'N', 2), 0);
  eco.equip(hero, worn.uid);
  const better = betterItems(eco, hero);
  expect(better.has(good.uid)).toBe(true); expect(better.get(good.uid)).toBeGreaterThan(0);
  expect(better.has(weak.uid)).toBe(false); expect(better.has(worn.uid)).toBe(false);
});

test('후반 il 장비는 +5 노말 무기를 이긴다 (드랍이 실제 업그레이드)', () => {
  const eco = make(), hero = eco.s.selected;
  const worn = give(eco, id('weapon', 'N'), 5), drop = give(eco, id('weapon', 'E'), 0, { il: 34 }), plain = give(eco, id('weapon', 'E'), 0);
  eco.equip(hero, worn.uid);
  const better = betterItems(eco, hero);
  expect(better.has(drop.uid)).toBe(true); expect(better.has(plain.uid)).toBe(false);
  expect(gearScore(drop)).toBeGreaterThan(gearScore(worn));
});

test('최선 장착: 슬롯마다 가장 좋은 것으로 한 번에 교체하고 계획은 저장을 바꾸지 않는다', () => {
  const eco = make(), hero = eco.s.selected;
  for (const slot of ['weapon', 'armor', 'ring', 'boots']) { const w = give(eco, id(slot, 'N')); eco.equip(hero, w.uid); give(eco, id(slot, 'E')); give(eco, id(slot, 'L')); }
  const before = JSON.stringify(eco.s), plan = planBestEquip(eco, hero);
  expect(JSON.stringify(eco.s)).toBe(before);
  expect(plan.length).toBe(4);
  const done = applyBestEquip(eco, hero);
  expect(done.swaps.length).toBe(4); expect(done.powerAfter).toBeGreaterThan(done.powerBefore);
  for (const slot of ['weapon', 'armor', 'ring', 'boots']) expect(eco.s.inventory.find((x: any) => x.uid === eco.s.heroes[hero].equip[slot]).id).toBe(id(slot, 'L'));
  expect(planBestEquip(eco, hero)).toEqual([]);
});

test('가방 정리: 장착 중보다 약한 N/S만 후보, 장착·U/L·더 좋은 것은 보호, 분해는 economy.salvage 보상과 일치', () => {
  const eco = make(), hero = eco.s.selected;
  const worn = give(eco, id('weapon', 'S'), 5); eco.equip(hero, worn.uid);
  const junkN = give(eco, id('weapon', 'N')), junkS = give(eco, id('weapon', 'S', 1), 0), strongE = give(eco, id('weapon', 'E'), 8), uniq = give(eco, id('weapon', 'U'), 0), epicWeak = give(eco, id('weapon', 'E', 1), 0);
  const j = junkItems(eco).map((x: any) => x.uid);
  expect(j).toContain(junkN.uid); expect(j).toContain(junkS.uid);
  for (const keep of [worn, strongE, uniq, epicWeak]) expect(j).not.toContain(keep.uid);
  expect(junkItems(eco, { rarities: ['E'] }).every((x: any) => x.rarity === 'E')).toBe(true);
  const preview = salvagePreview(eco, junkItems(eco)), gold0 = eco.s.gold, stones0 = eco.s.stones;
  const out = salvageItems(eco, j);
  expect(out).toMatchObject({ ok: true, count: j.length });
  expect(eco.s.gold - gold0).toBe(preview.gold); expect(eco.s.stones - stones0).toBe(preview.stones);
  expect(eco.s.inventory.some((x: any) => j.includes(x.uid))).toBe(false);
  expect(eco.s.inventory.some((x: any) => x.uid === worn.uid)).toBe(true);
});

test('장비는 영웅 소유: 다른 영웅·금고 장비는 후보도 정리 대상도 아니다', () => {
  const eco = make(), hero = eco.s.selected, other = eco.ownedHeroIds().find((h: string) => h !== hero);
  const worn = give(eco, id('weapon', 'S'), 5); eco.equip(hero, worn.uid);
  const mine = give(eco, id('weapon', 'N'), 0, { owner: hero }), vaulted = give(eco, id('weapon', 'N', 1), 0, { owner: 'vault', from: hero }), strongVault = give(eco, id('weapon', 'L'), 0, { owner: 'vault', from: hero });
  expect(junkItems(eco).map((x: any) => x.uid)).toEqual([mine.uid]);
  expect(betterItems(eco, hero).has(strongVault.uid)).toBe(false);
  expect(planBestEquip(eco, hero)).toEqual([]);
  if (other) {
    const theirs = give(eco, id('weapon', 'L'), 0, { owner: other });
    expect(betterItems(eco, hero).has(theirs.uid)).toBe(false);
    expect(junkItems(eco).map((x: any) => x.uid)).not.toContain(theirs.uid);
    expect(applyBestEquipAll(eco).some((r: any) => r.heroId === other)).toBe(true);   // 소유 영웅은 자기 장비를 끼운다
    expect(eco.s.heroes[other].equip.weapon).toBe(theirs.uid);
  }
});

test('자동 분해는 설정이 켜졌을 때만, 노말만', () => {
  const eco = make(), hero = eco.s.selected;
  const worn = give(eco, id('weapon', 'S'), 5); eco.equip(hero, worn.uid);
  const n = give(eco, id('weapon', 'N')), s = give(eco, id('weapon', 'S', 1));
  expect(autoSalvageNormal(eco)).toBeNull();
  eco.s.settings.autoSalvageN = true;
  const r = autoSalvageNormal(eco)!;
  expect(r.count).toBe(1);
  expect(eco.s.inventory.some((x: any) => x.uid === n.uid)).toBe(false); expect(eco.s.inventory.some((x: any) => x.uid === s.uid)).toBe(true);
});

test('성장 안내(eco 전달)는 장비 교체·가방 정리 항목을 추가하고 저장을 바꾸지 않는다', () => {
  const eco = make(), hero = eco.s.selected;
  const worn = give(eco, id('weapon', 'N')); eco.equip(hero, worn.uid);
  give(eco, id('weapon', 'L'));
  for (let i = 0; i < 6; i++) give(eco, id('armor', 'N', i % 4));
  const before = JSON.stringify(eco.s), options: any[] = growthOptions(eco.s, eco);
  expect(JSON.stringify(eco.s)).toBe(before);
  expect(options.find((o) => o.kind === 'gear' && o.mode === 'equipBest')).toBeTruthy();
  expect(growthOptions(eco.s).some((o: any) => o.kind === 'gear')).toBe(false);   // eco 없이는 기존 항목만
});

test('가방 정리: 단독 점수는 낮아도 세트를 완성해 빌드가 오르는 장비는 정리·자동 분해 후보가 아니다', () => {
  const eco = make(), hero = eco.s.selected;
  for (const itemId of ['w_steel', 'a_leather', 'r_copper', 'b_cloth']) eco.equip(hero, give(eco, itemId).uid);
  const iron = give(eco, 'w_iron');
  expect(eco.isUpgrade(hero, iron)).toBe(true);   // 신병 세트 완성
  expect(junkItems(eco, { heroId: hero }).some((j: any) => j.uid === iron.uid)).toBe(false);
});
