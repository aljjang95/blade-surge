import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy, gachaRates, gachaContents } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { baselineSkillLevels } from '../src/data/skill-tree.js';
import { SKUS, DAILY_REWARDS, PASS_TRACK, GACHA } from '../src/data/shop.js';
import { gradeUpCost } from '../src/data/hero-grades.js';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let fail = false;
beforeEach(() => {
  fail = false;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { if (fail) throw new Error('저장 실패'); values.set(k, v); },
    removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('SP 시작값·10/20레벨 마일스톤·각성 첫 습득 2SP와 읽기 전용 견적', () => {
  const eco = new Economy(), h = eco.hero();
  for (const [level, earned] of [[1, 3], [9, 11], [10, 14], [19, 23], [20, 26]]) {
    h.level = level;
    const before = JSON.stringify(eco.s);
    expect(eco.skillPoints('knight')).toEqual({ earned, spent: 0, available: earned });
    expect(JSON.stringify(eco.s)).toBe(before);
  }
  const i = HEROES.knight.skills.findIndex(sk => !!sk.unlock);
  const before = eco.skillPoints('knight').available;
  expect(eco.learnSkill('knight', i)).toEqual({ ok: true, level: 1 });
  expect(eco.skillPoints('knight').available).toBe(before - 2);
  expect(eco.learnSkill('knight', i)).toEqual({ ok: true, level: 2 });
  expect(eco.skillPoints('knight').available).toBe(before - 3);
  expect(new Economy().hero().skills[i]).toBe(2);
});

test('습득 오류·SP 부족·최대 레벨·저장 실패는 화폐/스킬/알림을 바꾸지 않는다', () => {
  const eco = new Economy(), h = eco.hero(); let changes = 0; eco.onChange(() => changes++);
  expect(eco.learnSkill('missing', 0)).toEqual({ ok: false, reason: 'skill' });
  for (const i of [-1, .5, 99]) expect(eco.learnSkill('knight', i)).toEqual({ ok: false, reason: 'skill' });
  expect(eco.learnSkill('knight', 4)).toMatchObject({ ok: false, reason: 'level', need: 10 });
  h.skills[0] = 10;
  expect(eco.learnSkill('knight', 0)).toEqual({ ok: false, reason: 'max' });
  expect(eco.learnSkill('knight', 1)).toMatchObject({ ok: false, reason: 'sp' });
  h.skills = baselineSkillLevels(HEROES.knight);
  const before = structuredClone(eco.s); fail = true;
  expect(eco.upgradeSkill('knight', 0)).toEqual({ ok: false, reason: 'storage' });
  expect(eco.s).toEqual(before); expect(changes).toBe(0);
  fail = false;
  expect(eco.upgradeSkill('knight', 0)).toEqual({ ok: true, level: 2 });
  expect(eco.s.gold).toBe(before.gold); expect(changes).toBe(1);
});

for (const route of ['free', 'scroll', 'gems'] as const) test(`초기화 ${route} 경로·습득 장착 정리·저장 롤백`, () => {
  const eco = new Economy(), h = eco.hero();
  h.level = route === 'free' ? 19 : 20; h.skills[0] = 4; h.skills[4] = 2; h.skillLoadout = [4, 5];
  eco.s.skillResets = route === 'gems' ? 0 : 1;
  const points = eco.skillPoints('knight'), before = structuredClone(eco.s), quote = eco.skillResetQuote('knight');
  expect(quote).toEqual({ free: route === 'free', scrolls: before.skillResets, gemPrice: 300, refund: points.spent });
  fail = true;
  expect(eco.resetSkills('knight', { useGems: true })).toEqual({ ok: false, reason: 'storage' });
  expect(eco.s).toEqual(before); fail = false;
  expect(eco.resetSkills('knight', { useGems: true })).toEqual({ ok: true, refunded: points.spent, free: route === 'free', used: route });
  expect(h.skills).toEqual(baselineSkillLevels(HEROES.knight)); expect(h.skillLoadout).toEqual([-1, -1]);
  expect(eco.skillPoints('knight').available).toBe(points.earned);
  expect(eco.s.skillResets).toBe(before.skillResets - (route === 'scroll' ? 1 : 0));
  expect(eco.s.gems).toBe(before.gems - (route === 'gems' ? 300 : 0));
});

test('초기화는 초기화서 없을 때만 명시적으로 보석을 쓰며 부족하면 무변경', () => {
  const eco = new Economy(); eco.hero().level = 20; eco.s.skillResets = 0; eco.s.gems = 299;
  const before = structuredClone(eco.s);
  expect(eco.resetSkills('knight')).toEqual({ ok: false, reason: 'scroll' });
  expect(eco.resetSkills('knight', { useGems: true })).toEqual({ ok: false, reason: 'gems' });
  expect(eco.s).toEqual(before);
});

for (const grade of ['SR', 'SSR'] as const) test(`${grade} 초월 견적·부족 재료 각각·정확 차감·저장 실패 롤백`, () => {
  const eco = new Economy(), id = Object.keys(HEROES).find(id => HEROES[id as keyof typeof HEROES].rarity === 'SR')!;
  const h = eco.hero(id); h.grade = grade;
  const cost = gradeUpCost(grade)!;
  h.shards = cost.shards; eco.s.transcendStones = cost.transcendStones; eco.s.gold = cost.gold;
  const before = structuredClone(eco.s), quote = eco.transcendQuote(id);
  expect(quote.ok).toBe(true); expect(quote.after!.power).toBeGreaterThan(quote.before!.power);
  quote.cost!.gold = 1; expect(eco.transcendQuote(id).cost!.gold).toBe(cost.gold);
  for (const reason of ['shards', 'stones', 'gold']) {
    if (reason === 'shards') h.shards--; else if (reason === 'stones') eco.s.transcendStones--; else eco.s.gold--;
    expect(eco.transcend(id)).toEqual({ ok: false, reason });
    if (reason === 'shards') h.shards++; else if (reason === 'stones') eco.s.transcendStones++; else eco.s.gold++;
  }
  fail = true; expect(eco.transcend(id)).toEqual({ ok: false, reason: 'storage' }); expect(eco.s).toEqual(before);
  fail = false; expect(eco.transcend(id)).toEqual({ ok: true, grade: grade === 'SR' ? 'SSR' : 'SSSR' });
  expect([h.shards, eco.s.transcendStones, eco.s.gold]).toEqual([0, 0, 0]);
  expect(eco.transcendQuote(id).before).toEqual(quote.after);
  if (grade === 'SSR') { expect(eco.transcend(id)).toEqual({ ok: false, reason: 'max' }); expect(eco.transcendQuote(id).after).toBeNull(); }
});

test('신규 보석 SKU는 정확 지급·부족/저장 실패 롤백, 모든 현금 SKU는 무지급', () => {
  const eco = new Economy(); eco.s.gems = 10000;
  for (const [id, key, n, price] of [['skill_reset1', 'skillResets', 1, 300], ['skill_reset5', 'skillResets', 5, 1250], ['tstone10', 'transcendStones', 10, 900]] as const) {
    const before = structuredClone(eco.s);
    fail = true; expect(eco.purchase(id)).toEqual({ ok: false, reason: 'storage' }); expect(eco.s).toEqual(before); fail = false;
    expect(eco.purchase(id)).toMatchObject({ ok: true, got: [{ k: key, n }] });
    expect(eco.s[key]).toBe(before[key] + n); expect(eco.s.gems).toBe(before.gems - price);
  }
  const before = JSON.stringify(eco.s);
  for (const sku of SKUS.filter(x => x.kind === 'cash')) expect(eco.purchase(sku.id)).toEqual({ ok: false, reason: 'payment-unavailable' });
  expect(eco.paymentAvailable()).toBe(false); expect(JSON.stringify(eco.s)).toBe(before);
  eco.s.gems = 0; expect(eco.purchase('tstone10')).toEqual({ ok: false, reason: 'gems' });
  expect(DAILY_REWARDS.filter((r, i) => i !== 6 && 'skillResets' in r)).toHaveLength(1);
  expect(PASS_TRACK.some(r => 'transcendStones' in r.prem)).toBe(true);
  expect(PASS_TRACK.some(r => 'skillResets' in r.prem)).toBe(true);
});

test('SR·SSR의 모든 분배 구간이 공개 확률표와 실지급에 일치한다', () => {
  const rates = gachaRates(); expect(rates.base).toEqual({ R: .86, SR: .12, SSR: .02 }); expect(rates.hardPity).toBe(80);
  const table = gachaContents();
  for (const grade of ['SR', 'SSR'] as const) {
    const split = grade === 'SR' ? GACHA.srSplit.hero + GACHA.srSplit.gear : GACHA.ssrSplit.featured + GACHA.ssrSplit.pool + GACHA.ssrSplit.gear;
    let edge = split;
    for (const material of GACHA.materials[grade]) {
      for (const r of [edge + .000001, edge + material.w - .000001]) {
        const eco = new Economy({ gachaRng: () => r }), before = (eco.s as any)[material.k];
        expect(eco.rollResult(grade)).toMatchObject({ type: 'material', k: material.k, n: material.n });
        expect((eco.s as any)[material.k]).toBe(before + material.n);
      }
      expect(table.find(x => x.grade === grade && x.kind === 'material' && x.id === material.k)!.p).toBeCloseTo(rates.base[grade] * material.w, 10);
      edge += material.w;
    }
    expect(edge).toBeCloseTo(1, 10);
  }
});
