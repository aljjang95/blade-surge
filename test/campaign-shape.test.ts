import { expect, test } from 'bun:test';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import { CHAPTER_COUNT, CAMPAIGN_STAGE_COUNT, STAGES_PER_CHAPTER as SHAPE_STAGES } from '../src/data/campaign-shape.js';
import { lootTable, recommendedLevel } from '../src/data/loot-tables.js';

test('캠페인 모양 상수는 CHAPTERS 데이터와 일치한다', () => {
  expect(CHAPTERS.length).toBe(CHAPTER_COUNT);
  expect(STAGES_PER_CHAPTER).toBe(SHAPE_STAGES);
  expect(CAMPAIGN_STAGE_COUNT).toBe(CHAPTERS.length * STAGES_PER_CHAPTER);
  CHAPTERS.forEach((chapter, i) => expect(chapter.id).toBe(i + 1));
});

test('드랍 표와 권장 레벨은 지역 수만큼 있고 범위 밖은 마지막 지역으로 모인다', () => {
  for (let ch = 1; ch <= CHAPTER_COUNT; ch++) expect(lootTable(ch, 'boss').chapter).toBe(ch);
  expect(lootTable(CHAPTER_COUNT + 5, 'boss').chapter).toBe(CHAPTER_COUNT);
  expect(recommendedLevel(CHAPTER_COUNT + 5, 99)).toBe(recommendedLevel(CHAPTER_COUNT, STAGES_PER_CHAPTER));
});

test('권장 레벨은 관문 순서대로 줄어들지 않는다', () => {
  let previous = 0;
  for (let idx = 1; idx <= CAMPAIGN_STAGE_COUNT; idx++) {
    const level = (stageDef(Math.ceil(idx / STAGES_PER_CHAPTER), ((idx - 1) % STAGES_PER_CHAPTER) + 1) as any).recommendedLevel as number;
    expect(level).toBeGreaterThanOrEqual(previous);
    previous = level;
  }
});

test('지역 의미 분기는 열거되지 않는 데이터 플래그로 읽는다', () => {
  expect((CHAPTERS as any[]).filter(c => c.homecoming).map(c => c.id)).toEqual([6]);
  expect((CHAPTERS as any[]).filter(c => c.finale).map(c => c.id)).toEqual([5]);
  expect(Object.keys(CHAPTERS[0])).not.toContain('finale');
  expect(stageDef(5, 10).finale).toBe(true);
  expect(stageDef(6, 10).epilogueFinale).toBe(true);
  expect(stageDef(6, 9).epilogueFinale).toBe(false);
});
