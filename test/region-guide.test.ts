import { describe, expect, test } from 'bun:test';
import { nextGuide, levelStatus, levelStatusLabel, lootGuide, bossLootSummary, epicOrBetterChance, NEAR_GAP, OVER_GAP } from '../src/data/region-guide.js';
import { recommendedLevel, lootTable, levelExperienceMultiplier } from '../src/data/loot-tables.js';
import { CHAPTERS, stageDef } from '../src/data/stages.js';

const LAST = CHAPTERS.length, LAST_CODE = `${LAST}-10`;

describe('권장 레벨 대비 상태', () => {
  test('권장 이상은 ready, 미만은 under, 크게 높으면 over', () => {
    expect(levelStatus(20, 20).status).toBe('ready');
    expect(levelStatus(25, 20).status).toBe('ready');
    expect(levelStatus(20 + OVER_GAP, 20).status).toBe('over');
    expect(levelStatus(19, 20)).toMatchObject({ status: 'under', levelGap: 1, near: true });
    expect(levelStatus(20 - NEAR_GAP, 20).near).toBe(true);
    expect(levelStatus(20 - NEAR_GAP - 1, 20)).toMatchObject({ status: 'under', near: false });
  });
  test('over 경계는 경험치 보정이 최저에 닿는 지점과 같다', () => {
    expect(levelExperienceMultiplier(20 + OVER_GAP, 20)).toBe(.5);
    expect(levelExperienceMultiplier(20 + OVER_GAP - 1, 20)).toBeGreaterThan(.5);
    expect(levelStatus(20 + OVER_GAP - 1, 20).status).toBe('ready');
  });
  test('문구: 도전 가능·레벨 부족·준비 완료·너무 쉬움', () => {
    expect(levelStatusLabel(18, 20)).toMatchObject({ tone: 'warn', text: '도전 가능' });
    expect(levelStatusLabel(10, 20)).toMatchObject({ tone: 'bad', text: '레벨 부족' });
    expect(levelStatusLabel(20, 20)).toMatchObject({ tone: 'good', text: '준비 완료' });
    expect(levelStatusLabel(40, 20)).toMatchObject({ tone: 'muted', text: '너무 쉬움' });
    expect(levelStatusLabel(18, 20).detail).toContain('경험치 ×1.10');
  });
});

describe('다음 출격 안내', () => {
  test('진행도 1 → 1-1, 새 지역 아님, 권장 레벨은 loot-tables 값', () => {
    const g = nextGuide({ unlocked: 1, stars: {} }, 1);
    expect(g.stage).toMatchObject({ ch: 1, st: 1, code: '1-1' });
    expect(g.newRegion).toBe(false);
    expect(g.recommendedLevel).toBe(recommendedLevel(1, 1));
    expect(g.status).toBe('ready');
  });
  test('1-10 클리어(unlocked 11) → 2-1 새 지역, 권장 레벨 부족이면 under', () => {
    const g = nextGuide({ unlocked: 11, stars: { '1-10': 3 } }, recommendedLevel(2, 1) - 4);
    expect(g.stage.code).toBe('2-1');
    expect(g.stage.title).toBe(stageDef(2, 1).title);
    expect(g.newRegion).toBe(true);
    expect(g.chapterName).toBe(stageDef(2, 1).chapter.name);
    expect(g.recommendedLevel).toBe(recommendedLevel(2, 1));
    expect(g.status).toBe('under');
    expect(g.levelGap).toBe(4);
  });
  test('장 중간 스테이지는 새 지역이 아니다', () => {
    expect(nextGuide({ unlocked: 15 }, 30).newRegion).toBe(false);
  });
  test('모든 장 클리어 뒤에는 마지막 스테이지에 머물고 allCleared', () => {
    const g = nextGuide({ unlocked: LAST * 10, stars: { [LAST_CODE]: 3 } }, 80);
    expect(g.stage.code).toBe(LAST_CODE);
    expect(g.allCleared).toBe(true);
    expect(nextGuide({ unlocked: LAST * 10, stars: {} }, 80).allCleared).toBe(false);
  });
  test('범위 밖·누락 진행도는 1-1로 안전하게', () => {
    expect(nextGuide(undefined, undefined).stage.code).toBe('1-1');
    expect(nextGuide({ unlocked: 999 }, 5).stage.code).toBe(LAST_CODE);
    expect(nextGuide({ unlocked: -4 }, 5).stage.code).toBe('1-1');
  });
  test('대표 보상은 선택한 난이도의 보스 표에서 계산한다', () => {
    const story = nextGuide({ unlocked: 11, difficulty: 'story' }, 20).representativeDrops;
    const night = nextGuide({ unlocked: 11, difficulty: 'nightmare' }, 20).representativeDrops;
    expect(story.materials[0].n).toBe(lootTable(2, 'boss', 'story').materials[0].n);
    expect(night.materials[0].n).toBeGreaterThan(story.materials[0].n);
    expect(night.epicChance).toBeGreaterThan(story.epicChance);
    expect(story.materials[0].name).toBe('잿불 핵');
  });
});

describe('전리품 안내', () => {
  test('난이도를 바꾸면 문구가 바뀐다', () => {
    const lines = ['story', 'adept', 'nightmare'].map((d) => lootGuide(3, d).lines.join('|'));
    expect(new Set(lines).size).toBe(3);
  });
  test('보스·정예 확정 개수와 확률이 표와 같다', () => {
    const g = lootGuide(1, 'story');
    expect(g.boss.gearRolls).toBe(lootTable(1, 'boss').gearRolls);
    expect(g.normal.gearChance).toBe(lootTable(1, 'normal').gearChance);
    expect(g.boss.epicChance).toBeCloseTo(epicOrBetterChance(lootTable(1, 'boss').gearWeights), 10);
    expect(g.lines[0]).toContain('보스 장비 3개');
    expect(g.lines[2]).toContain('8%');
  });
  test('장이 오르면 에픽 이상 확률도 오른다(UI에 보이는 값 단조)', () => {
    for (const d of ['story', 'adept', 'nightmare']) {
      for (let ch = 2; ch <= LAST; ch++) expect(bossLootSummary(ch, d).epicChance).toBeGreaterThanOrEqual(bossLootSummary(ch - 1, d).epicChance);
    }
  });
  test('알 수 없는 난이도는 story와 같다', () => {
    expect(lootGuide(2, 'nope').lines).toEqual(lootGuide(2, 'story').lines);
  });
});
