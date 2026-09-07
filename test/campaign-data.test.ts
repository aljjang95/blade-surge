import { describe, expect, test } from 'bun:test';
import { CHAPTERS, ENEMIES, stageDef } from '../src/data/stages.js';
import { CAMPAIGN, CHAPTER_SCENES, journalEntries } from '../src/data/campaign-story.js';

const stages = CHAPTERS.flatMap(ch => Array.from({ length: 10 }, (_, i) => stageDef(ch.id, i + 1)));
const enemies = ENEMIES as Record<string, any>;
describe('다섯 맹세 캠페인 데이터', () => {
  test('50개 관문과 고유 장면은 빠짐없이 이어지고 마지막만 결말이다', () => {
    expect(stages).toHaveLength(50);
    expect(stages.map(s => s.idx)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(stages.map(s => s.code)).size).toBe(50);
    expect(new Set(stages.map(s => s.title)).size).toBe(50);
    for (const field of ['opening', 'revelation', 'aftermath'] as const) {
      expect(new Set(stages.map(s => s.story[field])).size).toBe(50);
      expect(stages.every(s => s.story[field].length > 15)).toBe(true);
    }
    expect(CHAPTER_SCENES.map(s => s.length)).toEqual([10, 10, 10, 10, 10]);
    expect(stages.filter(s => s.finale).map(s => s.code)).toEqual(['5-10']);
    expect(CAMPAIGN.ending).toContain('네브 한 사람에게');
  });
  test('없는 관문과 소수·문자열 인수는 전투 데이터가 되지 않는다', () => {
    for (const [ch, st] of [[0, 1], [6, 1], [1, 0], [1, 11], [1.5, 1], [1, NaN], [Infinity, 1]]) {
      expect(() => stageDef(ch, st)).toThrow(RangeError);
    }
    expect(() => stageDef('1' as any, 1)).toThrow(RangeError);
  });
  test('수문장 3·7, 중간 5, 최종 10은 실제 서로 다른 적 계약이다', () => {
    for (const chapter of CHAPTERS) {
      const ranks = Array.from({ length: 10 }, (_, i) => stageDef(chapter.id, i + 1).encounter.rank);
      expect(ranks).toEqual(['captain', 'captain', 'warden', 'captain', 'midboss', 'captain', 'warden', 'captain', 'captain', 'finalboss']);
      const ids = new Set(Array.from({ length: 10 }, (_, i) => stageDef(chapter.id, i + 1).encounter.enemyId));
      expect(ids.size).toBe(4);
      expect(chapter.boss).toBe(stageDef(chapter.id, 10).encounter.enemyId);
      const hp = ['captain', 'warden', 'midboss', 'finalboss'].map(rank => enemies[chapter.theme + '_' + rank].hp);
      expect(hp).toEqual([...hp].sort((a, b) => a - b));
      expect(new Set(hp).size).toBe(4);
    }
  });
  test('모든 웨이브·로스터·소환·패턴은 존재하는 런타임 자산을 가리킨다', () => {
    const oldModels = new Set(Object.entries(enemies).filter(([id]) => !/^(garden|forge|frost|tide|crown)_/.test(id)).map(([, e]) => e.model));
    const patterns = new Set(['spin', 'slam', 'summon', 'fan', 'soulrain', 'dash']);
    for (const stage of stages) {
      const enemy = enemies[stage.encounter.enemyId];
      expect(enemy.boss).toBe(true);
      expect(oldModels.has(enemy.model)).toBe(true);
      expect(enemies[enemy.summon]).toBeDefined();
      expect(enemy.pattern.every((key: string) => patterns.has(key))).toBe(true);
      expect(['boss_warlord', 'boss_demon', 'boss_dragon']).toContain(enemy.voiceKey);
      const roster = stage.rosterFor();
      for (const id of [...stage.waves.flat(), ...roster.trash, ...roster.ranged, ...roster.elite]) expect(enemies[id]).toBeDefined();
    }
  });
  test('50층까지 난이도는 상승하되 종전 30층 지수보다 폭주하지 않는다', () => {
    expect(stages[0].scale).toBe(1);
    expect(stages[49].scale).toBeLessThan(Math.pow(1.12, 29));
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].scale).toBeGreaterThan(stages[i - 1].scale);
      expect(stages[i].scale / stages[i - 1].scale).toBeLessThanOrEqual(1.120001);
    }
  });
  test('기록은 실제 클리어한 장면만 열리며 해금 수치로 결말을 노출하지 않는다', () => {
    expect(journalEntries({ unlocked: 50 } as any)).toEqual([]);
    const entries = journalEntries({ stars: { '1-1': 1, '3-5': 3, '5-10': 0, '2-1': NaN, '2-2': '3', '6-1': 3 } });
    expect(entries.map(e => e.code)).toEqual(['1-1', '3-5']);
    expect(entries[1].aftermath).toBe(stageDef(3, 5).story.aftermath);
    expect(journalEntries({ stars: { '5-10': 1 } })[0].code).toBe('5-10');
  });
});
