import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { applyDifficulty, availableDifficulties, resolveDifficulty } from '../src/game/difficulty.js';

test('campaign difficulty unlocks in a readable progression', () => {
  const eco = new Economy();
  expect(availableDifficulties(eco.s, 1, 1).map((d) => d.unlocked)).toEqual([true, false, false]);
  eco.s.progress.unlocked = 2;
  expect(availableDifficulties(eco.s, 1, 1).map((d) => d.unlocked)).toEqual([true, true, false]);
  eco.s.progress.stars['1-1'] = 3;
  expect(resolveDifficulty(eco.s, 1, 1, 'nightmare').id).toBe('nightmare');
});

test('locked difficulty requests fall back without mutating the save', () => {
  const eco = new Economy();
  expect(eco.setDifficulty('nightmare', 1, 1).id).toBe('story');
  expect(eco.s.progress.difficulty).toBe('story');
  eco.s.progress.unlocked = 2;
  expect(eco.setDifficulty('adept', 1, 1).id).toBe('adept');
  expect(eco.s.progress.difficulty).toBe('adept');
});

test('difficulty snapshot scales reward and leaves the stage definition untouched', () => {
  const stage:any = { rewards: { gold: 100, exp: 80, bp: 10, dropChance: .5 } };
  const scaled = applyDifficulty(stage, resolveDifficulty({ progress: { unlocked: 2, stars: {} } } as any, 1, 1, 'adept'));
  expect(stage.rewards.gold).toBe(100);
  expect(scaled.rewards.gold).toBe(132);
  expect(scaled.rewards.exp).toBe(100);
  expect(scaled.difficultyId).toBe('adept');
});
