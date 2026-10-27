import { expect, test } from 'bun:test';
import { CHAPTER_OPEN, SEASON_START_MS, chapterOpenLabel, chapterOpenWeek, chapterOpensAt, ecoClock, isChapterOpen } from '../src/data/chapter-open.js';
import { SEASON } from '../src/data/content-90d.js';
import { applySettlement } from '../src/shared/settlement.js';

const MIN = 60 * 1000;

test('개방표의 시즌 시작은 content-90d 시즌 1 시작(2026-10-26 05:00 KST)과 같다', () => {
  expect(SEASON_START_MS).toBe(SEASON.startMs);
  expect(new Date(SEASON_START_MS).toISOString()).toBe('2026-10-25T20:00:00.000Z');
});

test('7장은 시즌 W1 시작 시각부터 열리고 그 전 1ms 는 닫혀 있다', () => {
  expect(CHAPTER_OPEN[7]).toBe(SEASON_START_MS);
  expect(chapterOpenWeek(7)).toBe(1);
  expect(isChapterOpen(7, SEASON_START_MS - 1)).toBe(false);
  expect(isChapterOpen(7, SEASON_START_MS)).toBe(true);
  expect(isChapterOpen(7, SEASON_START_MS + 90 * 24 * 60 * MIN)).toBe(true);
  expect(chapterOpenLabel(7)).toBe('10월 26일 05:00');
});

test('개방표에 없는 장은 시각과 무관하게 열려 있고, 잘못된 번호·시각은 닫힌다', () => {
  for (const ch of [1, 2, 3, 4, 5, 6]) { expect(chapterOpensAt(ch)).toBe(0); expect(isChapterOpen(ch, 0)).toBe(true); expect(chapterOpenLabel(ch)).toBe(''); }
  expect(isChapterOpen(0, SEASON_START_MS)).toBe(false);
  expect(isChapterOpen(1.5, SEASON_START_MS)).toBe(false);
  expect(isChapterOpen(7, NaN)).toBe(false);
  expect(isChapterOpen(7, undefined as any)).toBe(false);
});

test('규칙 시계는 신뢰 시계 → eco.now → 기기 시계 순이다', () => {
  expect(ecoClock({ trustedClock: () => 11, now: () => 22 })).toBe(11);
  expect(ecoClock({ now: () => 22 })).toBe(22);
  const before = Date.now(), at = ecoClock({}), after = Date.now();
  expect(at).toBeGreaterThanOrEqual(before); expect(at).toBeLessThanOrEqual(after);
});

test('정산은 닫힌 지역의 판을 보상 없이 거부하고 eco 를 건드리지 않는다', () => {
  const eco = { trustedClock: () => SEASON_START_MS - 1 };
  const out = applySettlement(eco, { ch: 7, st: 1 }, { heroId: 'knight', lootSeed: 1 }, { win: true, kills: {} }, 'ok');
  expect(out).toMatchObject({ got: [], loot: [], ups: 0, first: false, exp: 0, closed: true });
});
