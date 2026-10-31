import { expect, test } from 'bun:test';
import { Battle } from '../src/game/battle.js';
import { Floor } from '../src/game/world.js';
import { ENEMIES, CHAPTERS, stageDef } from '../src/data/stages.js';
import { levelExp } from '../src/data/heroes.js';
import { grantCombatXp, monsterXp } from '../src/game/rpg-core.js';
import { levelExperienceMultiplier, stageRecommendedLevel } from '../src/data/loot-tables.js';

// 2026-10-29 입문 레벨 곡선(heroes.js EARLY_LEVEL_EXP): 1-1 첫 클리어는 Lv3 에서 끝난다(예전 곡선은 Lv3~5, 대표님 실기기 Lv1→5).
// 판 안의 처치 EXP 만으로는 Lv2~3 이라 첫 판에 쓰는 기본 스킬은 둘까지다(skill-tree.js BASIC_SKILL_GATES 1·2·5).
test('첫 원정 2000개 로스터: 처치 EXP 는 Lv2~3, 클리어 EXP 까지 받으면 정확히 Lv3', () => {
  const originalRandom = Math.random, stage = stageDef(1, 1);
  const game = { stage, rosterSize: Battle.prototype.rosterSize };
  const defs = ENEMIES as unknown as Record<string, { exp: number; hp: number }>;
  const clearExp = (fullClear: boolean) => Math.floor((stage.rewards.exp + (fullClear ? Math.floor(stage.rewards.exp * .5) : 0))
    * levelExperienceMultiplier(1, stageRecommendedLevel(stage, 1)));
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
      expect(hero.level).toBeGreaterThanOrEqual(2);
      expect(hero.level).toBeLessThanOrEqual(3);
      for (const fullClear of [false, true]) {
        const settled = { ...hero };
        grantCombatXp(settled, clearExp(fullClear), levelExp);
        expect(settled.level).toBe(3);
      }
    }
  } finally { Math.random = originalRandom; }
  expect(minimum).toBeGreaterThanOrEqual(2); expect(maximum).toBeLessThanOrEqual(3);
});

test('관문 보스는 기존 첫 보스의 체력 기준과 계급별 증가를 유지한다', () => {
  const defs = ENEMIES as unknown as Record<string, { hp: number; atk: number }>;
  for (const chapter of CHAPTERS) {
    const ranks = ['captain', 'warden', 'midboss', 'finalboss'].map(rank => defs[`${(chapter as any).encounterPrefix || chapter.theme}_${rank}`]);
    expect(ranks[0].hp).toBeGreaterThanOrEqual(defs.boss_warlord.hp);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i].hp).toBeGreaterThan(ranks[i - 1].hp);
      expect(ranks[i].atk).toBeGreaterThan(ranks[i - 1].atk);
    }
  }
});
