import { expect, test } from 'bun:test';
import { Battle } from '../src/game/battle.js';
import { Floor } from '../src/game/world.js';
import { ENEMIES, CHAPTERS, stageDef } from '../src/data/stages.js';
import { levelExp } from '../src/data/heroes.js';
import { grantCombatXp, monsterXp } from '../src/game/rpg-core.js';

test('첫 원정 2000개 로스터의 성장은 각성 구간을 건너뛰지 않는다', () => {
  const originalRandom = Math.random, stage = stageDef(1, 1);
  const game = { stage, rosterSize: Battle.prototype.rosterSize };
  const defs = ENEMIES as unknown as Record<string, { exp: number; hp: number }>;
  let minimum = 80, maximum = 1;
  try {
    for (let seed = 1; seed <= 2000; seed++) {
      let state = seed;
      Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
      const floor = new Floor(1, 'garden', seed), hero = { level: 1, exp: 0 };
      for (const room of floor.rooms) for (const id of Battle.prototype.roomRoster.call(game, room)) {
        grantCombatXp(hero, monsterXp(defs[id], stage.scale), levelExp);
      }
      minimum = Math.min(minimum, hero.level); maximum = Math.max(maximum, hero.level);
      expect(hero.level).toBeGreaterThanOrEqual(3);
      expect(hero.level).toBeLessThanOrEqual(5);
    }
  } finally { Math.random = originalRandom; }
  expect(minimum).toBeGreaterThanOrEqual(3); expect(maximum).toBeLessThanOrEqual(5);
});

test('관문 보스는 기존 첫 보스의 체력 기준과 계급별 증가를 유지한다', () => {
  const defs = ENEMIES as unknown as Record<string, { hp: number; atk: number }>;
  for (const chapter of CHAPTERS) {
    const ranks = ['captain', 'warden', 'midboss', 'finalboss'].map(rank => defs[`${chapter.theme}_${rank}`]);
    expect(ranks[0].hp).toBeGreaterThanOrEqual(defs.boss_warlord.hp);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i].hp).toBeGreaterThan(ranks[i - 1].hp);
      expect(ranks[i].atk).toBeGreaterThan(ranks[i - 1].atk);
    }
  }
});
