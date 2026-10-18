import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { DropSystem } from '../src/game/drops.js';
import { CHAPTERS as CHAPTER_DATA, stageDef } from '../src/data/stages.js';
import { lootTable, levelExperienceMultiplier, pickLootRarity } from '../src/data/loot-tables.js';
import { HEROES, heroStats, levelExp } from '../src/data/heroes.js';
const CHAPTERS: any[] = CHAPTER_DATA;

const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('모든 적 등급에서 장이 오를수록 골드·경험치·강화석·장비 누적 상위확률이 증가한다', () => {
  for (const rank of ['normal', 'elite', 'boss']) for (let ch = 1; ch <= CHAPTERS.length; ch++) {
    const t = lootTable(ch, rank), prev = lootTable(Math.max(1, ch - 1), rank);
    expect((Object.values(t.gearWeights) as number[]).reduce((sum, n) => sum + n, 0)).toBeCloseTo(100, 8);
    expect(t.goldMultiplier).toBeGreaterThanOrEqual(prev.goldMultiplier); expect(t.expMultiplier).toBeGreaterThanOrEqual(prev.expMultiplier);
    for (const key of ['stones', 'stones2', 'stones3'] as const) expect(t[key]).toBeGreaterThanOrEqual(prev[key]);
    for (const threshold of [1, 2, 3, 4]) {
      const rarities = ['N', 'S', 'E', 'U', 'L'].slice(threshold);
      expect(rarities.reduce((s, r) => s + (t.gearWeights as any)[r], 0)).toBeGreaterThanOrEqual(rarities.reduce((s, r) => s + (prev.gearWeights as any)[r], 0));
    }
    if (rank === 'boss') { expect(t.gearChance).toBe(1); expect(t.stoneChance).toBe(1); expect(t.material.chance).toBe(1); expect(t.gearRolls).toBe(3); }
    expect(CHAPTERS[ch - 1].representativeDrops.material).toBe(t.material.id);
    for (let st = 1; st <= 10; st++) {
      const stage: any = stageDef(ch, st);
      expect(stage.recommendedLevel).toBeGreaterThanOrEqual(CHAPTERS[ch - 1].recommendedLevel);
      expect(stage.representativeDrops).toEqual(CHAPTERS[ch - 1].representativeDrops);
    }
  }
  expect(pickLootRarity(lootTable(1, 'boss').gearWeights, () => 0)).toBe('S');
  expect(levelExperienceMultiplier(1, 80)).toBe(1.5); expect(levelExperienceMultiplier(80, 1)).toBe(.5); expect(levelExperienceMultiplier(10, 10)).toBe(1);
});

test('수집과 처치 장부는 영웅/재화를 즉시 바꾸지 않고 캠페인 정산 한 경로로 합산된다', () => {
  const eco = new Economy(), stage = stageDef(1, 1), before = structuredClone(eco.s);
  const ledger = eco.beginFieldRewards(stage)!;
  const system: any = Object.create(DropSystem.prototype);
  Object.assign(system, { game: { stage, app: { eco }, player: { pos: new THREE.Vector3() }, ui: { flyReward() {} }, renderer: {}, fx: { burst() {} } } });
  system.collect({ kind: 'heroShard', payload: 1 }); system.collect({ kind: 'transcendStone', payload: 1 }); system.collect({ kind: 'material', payload: { id: 'glass_leaf', n: 2 } });
  expect(eco.queueCombatXp(stage, 'knight', 40).gained).toBe(40);
  expect(eco.s).toEqual(before);
  const receipt = eco.completeStage(stage, 3);
  expect(receipt.combatExp).toBe(40); expect(receipt.totalExp).toBe(stage.rewards.exp + 40);
  expect(eco.hero().level).toBe(2); expect(eco.hero().exp).toBe(50);
  expect(eco.hero().shards).toBe(1); expect(eco.s.transcendStones).toBe(1); expect((eco.s.expedition.materials as any).glass_leaf).toBe(2);
  expect(ledger.settled).toBe(true); expect(eco.queueCombatXp(stage, 'knight', 50).gained).toBe(0);
  const after = structuredClone(eco.s);
  eco.completeStage(stage, 3);
  expect(eco.s.transcendStones).toBe(after.transcendStones); expect(eco.hero().shards).toBe(after.heroes.knight.shards);
  expect((eco.s.expedition.materials as any).glass_leaf).toBe(2);
});

test('원정 XP·재료는 저장 실패 시 장부를 유지하고 재시도 성공 뒤 중복 지급을 막는다', () => {
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco), ticket = expedition.begin('dungeon', 'glass_garden').ticket!;
  const stage = { ch: 1, recommendedLevel: 1, expedition: { kind: 'dungeon' } };
  const ledger: any = eco.beginFieldRewards(stage)!; ledger.transcendStones = 1; ledger.materials.glass_leaf = 2; ledger.heroShards = 1;
  eco.queueCombatXp(stage, 'knight', 40);
  const before = structuredClone(eco.s), save = eco.save; eco.save = () => false;
  expect(expedition.settle(ticket, { win: true }).ok).toBe(false); expect(eco.s).toEqual(before); expect(ledger.settled).toBe(false);
  eco.save = save;
  const receipt = expedition.settle(ticket, { win: true });
  expect(receipt.ok).toBe(true); expect(receipt.rewards?.heroExp).toBe(140); expect(ledger.settled).toBe(true);
  expect(eco.hero().shards).toBe(1); expect(eco.s.transcendStones).toBe(1);
  const paid = structuredClone(eco.s); expect(expedition.settle(ticket, { win: true }).ok).toBe(false); expect(eco.s).toEqual(paid);
});

test('무료 연습·협동·레벨 상한·음수·소수 XP는 새 처치 보상을 만들지 않는다', () => {
  const eco = new Economy(); const before = structuredClone(eco.s);
  for (const stage of [{ party: {} }, { expedition: { kind: 'arena' } }]) {
    expect(eco.beginFieldRewards(stage)).toBeNull(); expect(eco.queueCombatXp(stage, 'knight', 100).gained).toBe(0);
  }
  for (const amount of [-1, .5, NaN, Infinity]) expect(eco.queueCombatXp(stageDef(1, 1), 'knight', amount).gained).toBe(0);
  expect(eco.s).toEqual(before); eco.hero().level = 80;
  expect(eco.queueCombatXp(stageDef(6, 10), 'knight', 100).gained).toBe(0);
});

test('드롭은 지역 장비 표를 사용하고 소환수는 새 성장 재료를, 무리 졸개는 어떤 보상도 추가하지 않는다', () => {
  const eco = new Economy(), stage = stageDef(6, 1), spawned: any[] = [];
  const game: any = { stage, heroId: 'knight', app: { eco } };
  const system: any = Object.create(DropSystem.prototype);
  Object.assign(system, { game, spawn: (...args: any[]) => spawned.push(args) });
  const enemy = { def: { gold: 20 }, pos: new THREE.Vector3(), isBoss: true };
  const rng = Math.random; Math.random = () => .99;
  try { system.onKill(enemy, stage); } finally { Math.random = rng; }
  expect(spawned.filter(x => x[1] === 'item')).toHaveLength(3);
  expect(spawned.filter(x => x[1] === 'item').every(x => x[2].rarity === 'L')).toBe(true);
  expect(spawned.find(x => x[1] === 'material')[2]).toEqual({ id: 'star_dust', n: 7 });
  const count = spawned.length;
  system.onKill({ ...enemy, packFollower: true }, stage);
  expect(spawned).toHaveLength(count);
  system.onKill({ ...enemy, summoned: true }, stage);
  const summoned = spawned.slice(count).map(x => x[1]);
  expect(summoned).toContain('gold');
  for (const kind of ['heroShard', 'transcendStone', 'material']) expect(summoned).not.toContain(kind);
});

test('복사된 원정 스테이지는 권장 레벨 보정이 없고 캠페인 복사본은 장·스테이지 번호로 계산한다', () => {
  const eco = new Economy(); eco.hero().level = 30;
  const campaignCopy = { ...stageDef(1, 1) };
  expect(JSON.stringify(stageDef(1, 1))).not.toContain('recommendedLevel');
  expect(eco.queueCombatXp(campaignCopy, 'knight', 100).gained).toBe(50);
  const other = new Economy(); other.hero().level = 30;
  expect(other.queueCombatXp({ expedition: { kind: 'dungeon' } }, 'knight', 100).gained).toBe(100);
});

test('장비 비교는 강화·세트 포함 실전 능력치 기준이며 가방 밖 드롭도 저장 없이 비교한다', () => {
  const eco = new Economy(), current = eco.addItem('N', 'weapon'), incoming = eco.addItem('S', 'weapon');
  current.enh = 20; eco.equip('knight', current.uid);
  const before = structuredClone(eco.s);
  expect(eco.isUpgrade('knight', incoming)).toBe(false);
  expect(eco.isUpgrade('knight', { ...incoming })).toBe(false);
  const best = { uid: 99999, id: 'w_dragon', enh: 20 };
  expect(eco.isUpgrade('knight', best)).toBe(true);
  const inBag = { ...best, uid: eco.s.invSeq++ }; eco.s.inventory.push(inBag);
  const preview = eco.previewItem('knight', inBag.uid)!;
  expect(eco.isUpgrade('knight', inBag)).toBe(preview.after.power > preview.before.power);
  expect(eco.isUpgrade('missing', best)).toBe(false);
  eco.s.inventory.pop(); eco.s.invSeq--;
  expect(eco.s).toEqual(before);
});

test('분해는 중복 UID를 한 번만 처리하고 장착·희귀 장비를 보호하며 저장 실패 시 원복한다', () => {
  const eco = new Economy(), n = eco.addItem('N', 'weapon'), s = eco.addItem('S', 'armor'), e = eco.addItem('E', 'boots'), rare = eco.addItem('U', 'ring');
  eco.equip('mage', n.uid);
  expect(eco.salvage([n.uid])).toEqual({ ok: false, reason: 'equipped' });
  for (const uids of [[], [-1], [s.uid, -1], [rare.uid]]) expect(eco.salvage(uids)).toEqual({ ok: false, reason: 'items' });
  eco.unequip('mage', 'weapon'); const before = structuredClone(eco.s); const save = eco.save; eco.save = () => false;
  expect(eco.salvage([n.uid, s.uid, e.uid])).toEqual({ ok: false, reason: 'storage' }); expect(eco.s).toEqual(before); eco.save = save;
  expect(eco.salvage([n.uid, s.uid, s.uid, e.uid])).toEqual({ ok: true, count: 3, got: [{ k: 'gold', n: 2550 }, { k: 'stones', n: 4 }, { k: 'stones2', n: 2 }] });
  expect(eco.s.inventory).toEqual([rare]); expect(new Economy().s.inventory).toEqual([rare]);
});

test('경험치 보정은 기존 저장 레벨과 곡선을 바꾸지 않고 ±50% 안에서만 적용된다', () => {
  const eco = new Economy(); eco.hero().level = 20; eco.hero().exp = 10;
  const h = structuredClone(eco.hero()); const migrated = eco.migrate(structuredClone(eco.s)); expect(migrated.heroes.knight.level).toBe(20);
  const stage = stageDef(1, 1); expect(eco.queueCombatXp(stage, 'knight', 100).gained).toBe(50); expect(eco.hero()).toEqual(h);
  expect(levelExp(20)).toBe(2321); expect(heroStats(HEROES.knight, h, eco.heroEquipBonus('knight')).power).toBeGreaterThan(0);
});
