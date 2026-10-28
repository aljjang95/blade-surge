import { expect, test } from 'bun:test';
import { TOWN_LINES, TOWN_LINE_MAX, townLine } from '../src/data/town-lines.js';
import { CAMPAIGN_TOWNS } from '../src/data/campaign-towns.js';

test('마을 한 줄 대사는 18자 이하이고 모든 지역 마을에 상인·교관·대장장이·이동석 대사가 있다', () => {
  for (const town of CAMPAIGN_TOWNS) for (const kind of ['merchant', 'trainer', 'steward', 'smith', 'waystone']) {
    const line = townLine(town.chapter, kind);
    expect(typeof line).toBe('string');
  }
  for (const lines of Object.values(TOWN_LINES)) for (const line of Object.values(lines)) expect([...line].length).toBeLessThanOrEqual(TOWN_LINE_MAX);
  expect(townLine(2, 'dungeon')).toBeNull();
});

test('마을 이야기 장마다 18자 이하 한 줄이 있다', async () => {
  const { TOWN_STORY } = await import('../src/data/towns.js');
  for (const chapters of Object.values(TOWN_STORY) as any[]) for (const chapter of chapters) {
    expect(typeof chapter.text).toBe('string');
    expect([...chapter.text].length).toBeLessThanOrEqual(TOWN_LINE_MAX);
  }
});
