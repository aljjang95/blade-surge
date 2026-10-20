import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { spEarned, spSpent } from '../src/data/skill-tree.js';

// SP 도입 전 저장(영웅에 grade 없음, 스킬을 골드로 올림)을 실제 localStorage 경로로 불러온다.
const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values = new Map<string, string>();
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

function legacyEconomy(level: number, skills: number[]) {
  const seed = new Economy();
  const raw = JSON.parse(JSON.stringify(seed.s));
  for (const h of Object.values(raw.heroes) as any[]) { delete h.grade; delete h.spBonus; }
  raw.heroes.knight.level = level; raw.heroes.knight.skills = skills;
  values.clear(); values.set('bladesurge_save_v1', JSON.stringify(raw));
  return new Economy();
}

test('SP 이전 저장: 골드로 올린 스킬은 유지되고, 초과분은 보상 SP가 되어 다음 레벨업부터 바로 SP를 받는다', () => {
  const skills = [8, 7, 6, 5, 3, 3, 1, 1];
  const eco = legacyEconomy(12, skills), h = eco.hero('knight');
  expect(h.skills).toEqual(skills);
  const over = spSpent(HEROES.knight, skills) - spEarned(12);
  expect(over).toBeGreaterThan(0); // 이 저장은 예전 규칙에서 '가능 SP 0, 레벨업해도 0'에 묶이던 상태다.
  expect(h.spBonus).toBe(over);
  expect(eco.skillPoints('knight')).toMatchObject({ bonus: over, available: 0 });
  h.level = 13;
  expect(eco.skillPoints('knight').available).toBe(1);
  // 초기화하면 쓴 SP를 전부 돌려받고 보상 SP는 예산으로 남는다.
  h.level = 12; eco.s.skillResets = 1;
  expect(eco.resetSkills('knight')).toMatchObject({ ok: true });
  expect(eco.skillPoints('knight').available).toBe(spEarned(12) + over);
});

test('SP 이전 저장이라도 번 SP 안에서 올렸으면 보상 SP는 0이고, 새 저장의 보상 SP는 불러와도 그대로다', () => {
  const eco = legacyEconomy(30, [2, 2, 1, 1, 1, 1, 0, 0]);
  expect(eco.hero('knight').spBonus).toBe(0);
  eco.hero('knight').spBonus = 7; eco.save();
  expect(new Economy().hero('knight').spBonus).toBe(7);
});

