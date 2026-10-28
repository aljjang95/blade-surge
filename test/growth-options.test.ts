import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { growthOptions, growthSummary } from '../src/game/growth-options.js';
import { HEROES, levelExp } from '../src/data/heroes.js';
import { canLearnSkill } from '../src/data/skill-tree.js';
import { normalizeMasterworks, unlockMastery } from '../src/game/masterworks-core.js';
import { ITEM_BY_ID, ENH_MAX, STONE_KEY, enhanceCost, enhanceStones, enhanceChance, destroyChance, enhanceStoneTier } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

function fixture() {
  const eco = grandfather(new Economy()), save: any = eco.s;
  save.selected = 'mage'; save.heroes.mage.level = 20;
  save.masterworks = normalizeMasterworks({ earnedRenown: 6, renown: 6 });
  const weapon = Object.values(ITEM_BY_ID).find(item => item.slot === 'weapon')!;
  save.inventory.push({ uid: 'growth-weapon', id: weapon.id, enh: 3 });
  save.heroes.mage.equip.weapon = 'growth-weapon';
  return eco;
}

test('viewing growth options does not mutate the save, and every quoted action uses the real economy', () => {
  const eco = fixture(), before = JSON.stringify(eco.s);
  const options: any[] = growthOptions(eco.s);
  expect(options.map(o => o.kind)).toEqual(['equipment', 'skill', 'mastery']);
  expect(JSON.stringify(eco.s)).toBe(before);
  for (const option of options) {
    eco.s = JSON.parse(before); const gold = eco.s.gold, stones = eco.s.stones;
    if (option.kind === 'equipment') {
      const r = eco.enhance(option.uid);
      expect(r.ok && r.success && !r.destroyed).toBe(true);
      expect(eco.s.gold).toBe(gold - option.gold); expect(eco.s.stones).toBe(stones - option.stones);
    } else if (option.kind === 'skill') {
      expect(eco.upgradeSkill(option.heroId, option.index)).toMatchObject({ ok: true });
      expect(eco.s.gold).toBe(gold);
    } else {
      const s: any = eco.s;
      expect(unlockMastery(s.masterworks, option.id).ok).toBe(true);
      expect(s.masterworks.renown).toBe(6 - option.renown);
    }
  }
});

test('equipment suggestions require the actual gold and the right-tier stone cost; +8 and above show the live odds (2026-10-28)', () => {
  const eco = fixture(); const save: any = eco.s, item = save.inventory[0];
  for (let level = 0; level < ENH_MAX; level++) {
    const key = STONE_KEY[enhanceStoneTier(level)];
    item.enh = level; save.gold = enhanceCost(level); for (const k of ['stones', 'stones2', 'stones3']) save[k] = 0; save[key] = enhanceStones(level);
    const option: any = growthOptions(save).find(o => o.kind === 'equipment');
    expect(!!option).toBe(true);
    // 100% 구간은 기존 그대로, +8 이후는 위험 구간 표시(성공률·파괴·하락을 규칙 함수에서 읽음)
    if (level < 8) expect(option.mode).toBeUndefined(); else { expect(option.mode).toBe('risk'); expect(option.chance).toBe(enhanceChance(level)); expect(option.destroy).toBe(destroyChance(level)); }
    save.gold--;
    expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
    save.gold++; if (enhanceStones(level)) save[key]--;
    if (enhanceStones(level)) expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  }
  item.enh = ENH_MAX; save.gold = 1e9; save.stones = save.stones2 = save.stones3 = 1e9;
  expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);   // 최대 강화는 더 안내하지 않는다
});

test('only the selected hero equipped item is suggested; removed items and foreign slots are ignored', () => {
  const eco = fixture(); const save: any = eco.s;
  save.selected = 'knight'; expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  save.selected = 'mage'; save.heroes.mage.equip.weapon = null; save.heroes.mage.equip.armor = 'growth-weapon';
  expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
  save.heroes.mage.equip.weapon = 'growth-weapon'; save.inventory.length = 0;
  expect(growthOptions(save).some(o => o.kind === 'equipment')).toBe(false);
});

// 스킬은 골드가 아니라 스킬 포인트(SP)로 배운다(2026-10-19 SP 스킬 트리). 같은 의도를 SP 기준으로 검사한다.
test('locked or maxed skills are not advertised, and the exact remaining skill points are honored', () => {
  const eco = fixture(); const save: any = eco.s, hero = save.heroes.mage;
  hero.level = 1; hero.skills = [10, 10, 10, 10, 0, 0, 0, 0];
  expect(growthOptions(save).some(o => o.kind === 'skill')).toBe(false);
  hero.level = 20; hero.skills = [1, 1, 1, 1, 0, 0, 0, 0];
  const skill: any = growthOptions(save).find(o => o.kind === 'skill');
  expect(skill).toMatchObject({ index: 4, from: 0, to: 1, sp: 2, gold: 0 });
  // 기본 스킬에 SP를 써서 정확히 2만 남기면 여전히 같은 안내, 1만 남기면 SP 2짜리 각성 습득은 안내하지 않는다.
  // 기본 스킬(0~2)에 SP를 써서 남은 SP를 정확히 2로 맞춘다. 비용이 남길 몫을 넘으면 다른 스킬로 넘어간다.
  const spendDownTo = (target: number) => { for (let guard = 0; guard < 200 && eco.skillPoints('mage').available > target; guard++) {
    const pick = [0, 1, 2].find(i => { const c = canLearnSkill(HEROES.mage, hero, i); return c.ok && eco.skillPoints('mage').available - c.cost! >= target; });
    if (pick === undefined) break; expect(eco.learnSkill('mage', pick).ok).toBe(true); } };
  spendDownTo(2); expect(eco.skillPoints('mage').available).toBe(2);
  expect(growthOptions(save).find(o => o.kind === 'skill')).toEqual(skill);
  expect(eco.learnSkill('mage', 1).ok).toBe(true);
  const left = eco.skillPoints('mage').available, next: any = growthOptions(save).find(o => o.kind === 'skill');
  expect(left).toBeLessThan(2);
  if (next) { expect(next.index).not.toBe(4); expect(next.sp).toBeLessThanOrEqual(left); }
});

test('mastery offers respect prerequisites and exclude owned nodes with insufficient remaining renown', () => {
  const eco = fixture(); const save: any = eco.s;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'assault_1', renown: 6 });
  save.masterworks.unlocked = ['assault_1']; save.masterworks.renown = 9;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'survival_1', renown: 6 });
  save.masterworks.renown = 10;
  expect(growthOptions(save).find(o => o.kind === 'mastery')).toMatchObject({ id: 'assault_2', renown: 10 });
  save.masterworks.renown = 5;
  expect(growthOptions(save).some(o => o.kind === 'mastery')).toBe(false);
});

test('an empty or invalid current context cannot advertise a purchase', () => {
  const eco = fixture(); const save: any = eco.s;
  // SP 가 남아 있지 않은 상태(모든 스킬 최대)로 둔다. 남은 SP 로 배우는 스킬은 구매가 아니므로 이 조건에서만 빈 목록이다.
  save.gold = 0; save.stones = 0; save.masterworks.renown = 0; save.heroes.mage.skills = HEROES.mage.skills.map(() => 10);
  expect(growthOptions(save)).toEqual([]);
  expect(growthOptions(null)).toEqual([]);
  save.selected = 'missing'; expect(growthOptions(save)).toEqual([]);
});

test('a first unclaimed drop offers free comparison for an empty slot even with no gold', () => {
  const eco = new Economy(); eco.s.gold = 0;
  const low = eco.addItem('N', 'weapon'), high = eco.addItem('R', 'weapon');
  const before = JSON.stringify(eco.s);
  const option = growthOptions(eco.s).find(o => o.kind === 'equipment');
  expect(option).toMatchObject({ mode: 'equip', uid: high.uid, slot: 'weapon', gold: 0, stones: 0 });
  expect(JSON.stringify(eco.s)).toBe(before);
  eco.hero('mage').equip.weapon = high.uid;
  expect(growthOptions(eco.s).find(o => o.kind === 'equipment')).toMatchObject({ uid: low.uid, mode: 'equip' });
  eco.hero().equip.weapon = low.uid;
  expect(growthOptions(eco.s).some(o => o.kind === 'equipment')).toBe(false);
});

test('hunt summary uses observed levels and XP, including crossed unlocks and the exact next milestone', () => {
  const summary: any = growthSummary({ heroId: 'mage', before: { heroId: 'mage', level: 9, exp: 42 },
    after: { level: 11, exp: 25 }, combatXp: 700, clearXp: 310 });
  expect(summary).toMatchObject({ beforeLevel: 9, level: 11, levels: 2, combatXp: 700, clearXp: 310 });
  expect(summary.unlocked.map((skill: any) => skill.name)).toEqual(HEROES.mage.skills.filter(skill => skill.unlock === 10).map(skill => skill.name));
  expect(summary.next).toMatchObject({ level: 20, remaining: Array.from({ length: 9 }, (_, i) => levelExp(11 + i)).reduce((a, b) => a + b, 0) - 25 });
});

test('summary never invents gains for missing or foreign snapshots, unknown XP or max-level overflow', () => {
  const input: any = { heroId: 'mage', before: { heroId: 'knight', level: 1 }, after: { level: 80, exp: 123 }, combatXp: undefined, clearXp: -1 };
  expect(growthSummary(input)).toMatchObject({ levels: null, beforeLevel: null, combatXp: null, clearXp: null, unlocked: [], need: null, next: null });
  input.after = { level: NaN, exp: 0 }; expect(growthSummary(input)).toBeNull();
  input.after = { level: 1, exp: 0 }; input.before = { heroId: 'mage', level: 1 }; input.combatXp = 0;
  expect(growthSummary(input)).toMatchObject({ levels: 0, combatXp: 0, unlocked: [] });
});
