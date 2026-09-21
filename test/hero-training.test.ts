import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { heroTrainingQuote } from '../src/game/hero-training.js';
import { heroProgressionHtml, trainingButtonLabel } from '../src/ui/hero-progression.js';
import { HEROES, levelExp, levelGold } from '../src/data/heroes.js';

const key = 'bladesurge_save_v1';
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>, writes: string[], blocked: boolean;
beforeEach(() => {
  values = new Map(); writes = []; blocked = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, value: string) => { if (blocked) throw new Error('quota'); values.set(k, value); writes.push(k); },
    removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('시작 골드로 사냥 없는 레벨 구매가 불가능하며 실패는 상태를 바꾸지 않는다', () => {
  const eco = new Economy(), before = JSON.stringify(eco.s);
  for (let i = 0; i < 20; i++) expect(eco.levelUpHero('knight')).toBe(false);
  expect(eco.lastTrainingError).toBe('hunt'); expect(JSON.stringify(eco.s)).toBe(before);
});

test('전체 훈련 레벨에서 50% 경계와 남은 경험치 비례 비용을 지킨다', () => {
  for (let level = 1; level < 80; level++) {
    const need = levelExp(level), half = Math.ceil(need / 2);
    expect(heroTrainingQuote({ level, exp: half - 1 }, Number.MAX_SAFE_INTEGER).reason).toBe('hunt');
    const q = heroTrainingQuote({ level, exp: half }, Number.MAX_SAFE_INTEGER);
    expect(q.ok).toBe(true); expect(q.cost).toBe(Math.ceil(levelGold(level) * (need - half) / need));
    expect(heroTrainingQuote({ level, exp: half }, q.cost! - 1).reason).toBe('gold');
    expect(heroTrainingQuote({ level, exp: half }, q.cost).ok).toBe(true);
    expect(heroTrainingQuote({ level, exp: need - 1 }, Number.MAX_SAFE_INTEGER).cost).toBeLessThanOrEqual(q.cost!);
  }
});

test('훈련은 정확한 골드만 차감하고 남은 EXP를 채운 뒤 연속 클릭을 거절한다', () => {
  const eco = new Economy(), hero = eco.hero(); hero.exp = 70;
  const gold = eco.s.gold, quote = eco.trainingQuote('knight');
  expect(quote.cost).toBe(60); expect(eco.levelUpHero('knight')).toBe(true);
  expect(hero.level).toBe(2); expect(hero.exp).toBe(0); expect(eco.s.gold).toBe(gold - 60);
  expect(eco.levelUpHero('knight')).toBe(false); expect(eco.s.gold).toBe(gold - 60);
  const reload = new Economy(); expect(reload.hero().level).toBe(2); expect(reload.hero().exp).toBe(0);
});

test('저장 실패 시 훈련을 원복하고 복구 뒤 한 번만 결제한다', () => {
  const eco = new Economy(); eco.hero().exp = 50; eco.save();
  const before = JSON.stringify(eco.s), disk = values.get(key), lastGood = eco._lastGoodSave;
  let notifications = 0; eco.onChange(() => notifications++); blocked = true;
  expect(eco.levelUpHero('knight')).toBe(false); expect(eco.lastTrainingError).toBe('storage');
  expect(JSON.stringify(eco.s)).toBe(before); expect(values.get(key)).toBe(disk); expect(eco._lastGoodSave).toBe(lastGood);
  expect(notifications).toBe(0); blocked = false;
  expect(eco.levelUpHero('knight')).toBe(true); expect(notifications).toBe(1);
  expect(new Economy().s.gold).toBe(JSON.parse(before).gold - 100);
});

test('이미 보유한 레벨과 경험치·재화는 업데이트 후에도 보존한다', () => {
  const eco = new Economy(); eco.hero().level = 17; eco.hero().exp = 87; eco.s.gold = 45678; eco.save();
  const reload = new Economy(); expect(reload.hero().level).toBe(17); expect(reload.hero().exp).toBe(87); expect(reload.s.gold).toBe(45678);
});

test('각성 Lv10 경계를 실제 스킬 정의와 연결하고 훈련 후 다음 Lv20을 안내한다', () => {
  const eco = new Economy(), hero = eco.hero(); hero.level = 9; hero.exp = Math.ceil(levelExp(9) / 2);
  const first = HEROES.knight.skills.find(s => s.unlock === 10)!;
  expect(heroProgressionHtml(hero, HEROES.knight, eco.s.gold)).toContain(first.name);
  expect(eco.levelUpHero('knight')).toBe(true);
  expect(heroProgressionHtml(hero, HEROES.knight, eco.s.gold)).toContain('다음 각성 · Lv.20');
  expect(heroProgressionHtml(hero, HEROES.knight, eco.s.gold)).not.toContain('다음 각성 · Lv.10');
});

test('상한·잘못된 영웅과 수치는 차감하지 않으며 패널도 NaN을 만들지 않는다', () => {
  const eco = new Economy(); expect(eco.levelUpHero('missing')).toBe(false);
  for (const hero of [{level: 0, exp: 0}, {level: 1, exp: -1}, {level: 1, exp: NaN}, {level: 1, exp: 100}]) {
    const q = heroTrainingQuote(hero, 1000); expect(q.ok).toBe(false);
    expect(trainingButtonLabel(q)).toBe('성장 정보 확인 필요');
    expect(heroProgressionHtml(hero, HEROES.knight, 1000)).not.toMatch(/NaN|undefined/);
  }
  eco.hero().level = 80; const before = JSON.stringify(eco.s);
  expect(eco.levelUpHero('knight')).toBe(false); expect(JSON.stringify(eco.s)).toBe(before);
  expect(heroProgressionHtml(eco.hero(), HEROES.knight, eco.s.gold)).toContain('MAX');
});

test('정산은 완료 XP와 퀘스트까지 한 번에 저장하고 저장 결과를 receipt로 반환한다', () => {
  const eco = new Economy(); writes = [];
  const receipt = eco.completeStage(eco.nextStage(), 3);
  expect(receipt.ok).toBe(true); expect(receipt.saveError).toBe(false);
  expect(writes.filter(k => k === key)).toHaveLength(1);
  const saved = JSON.parse(values.get(key)!);
  expect(saved.heroes.knight).toEqual(eco.hero()); expect(saved.quests.stages).toBe(1);
});

test('정산 저장 실패는 노출되고 저장만 재시도하면 보상이 중복 지급되지 않는다', () => {
  const eco = new Economy(); blocked = true;
  const receipt = eco.completeStage(eco.nextStage(), 3);
  expect(receipt.ok).toBe(false); expect(receipt.saveError).toBe(true);
  const granted = JSON.stringify(eco.s); blocked = false;
  expect(eco.save()).toBe(true); expect(JSON.stringify(eco.s)).toBe(granted);
  expect(JSON.parse(values.get(key)!).quests.stages).toBe(1);
});
