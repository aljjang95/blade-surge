import { expect, test } from 'bun:test';
import { hasFinalConsonant, withTopic } from '../src/ui/korean.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';

// 받침 없는 던전 이름(잿불 금고 등)에 "은"을 붙이던 착지 안내 조사 오류의 회귀.
test('topic particle follows the final consonant of every dungeon name', () => {
  expect(withTopic('유리 정원')).toBe('유리 정원은'); expect(withTopic('잿불 금고')).toBe('잿불 금고는');
  expect(withTopic('별빛 서고 심층')).toBe('별빛 서고 심층은'); expect(hasFinalConsonant('Glass')).toBe(false);
  for (const d of ALL_DUNGEONS) expect(withTopic(d.name).endsWith(hasFinalConsonant(d.name) ? '은' : '는')).toBe(true);
  expect(ALL_DUNGEONS.some(d => !hasFinalConsonant(d.name))).toBe(true);
});

