import { expect, test } from 'bun:test';
import { ENH_MAX, ENH_SAFE_MAX, enhanceChance, enhanceCost, enhanceStones, enhanceDown, destroyChance } from '../src/data/items.js';
import * as table from '../src/data/enhance.js';

// 던파식 긴장 곡선(대표님 2026-10-28): +3까지 확정, 그 뒤 단계마다 확률이 떨어진다.
test('+1~+3 은 확정, +4 부터는 단계마다 확률이 줄거나 같다', () => {
  for (let lv = 0; lv < ENH_SAFE_MAX; lv++) expect(enhanceChance(lv)).toBe(1);
  expect(enhanceChance(ENH_SAFE_MAX)).toBeLessThan(1);
  for (let lv = 1; lv < ENH_MAX; lv++) expect(enhanceChance(lv)).toBeLessThanOrEqual(enhanceChance(lv - 1));
  expect(enhanceChance(3)).toBe(0.9); expect(enhanceChance(7)).toBe(0.6); expect(enhanceChance(9)).toBe(0.5);
});

test('+13 이상(현재 +12 이상) 확률·하락·파괴 구간은 예전과 같다', () => {
  const before: Record<number, number> = { 12: 0.4, 13: 0.3, 14: 0.25, 15: 0.2, 16: 0.15, 17: 0.13, 18: 0.11, 19: 0.09 };
  for (const [lv, p] of Object.entries(before)) expect(enhanceChance(+lv)).toBe(p);
  for (let lv = 0; lv < 10; lv++) expect(enhanceDown(lv)).toBe(0);
  for (let lv = 10; lv < ENH_MAX; lv++) expect(enhanceDown(lv)).toBe(1);
  for (let lv = 0; lv < 12; lv++) expect(destroyChance(lv)).toBe(0);
  expect(destroyChance(12)).toBe(0.1); expect(destroyChance(15)).toBe(0.2);
});

test('비용은 단계마다 오르고, 강화석은 확정 구간 0 · +6~+12 2개', () => {
  for (let lv = 1; lv < ENH_MAX; lv++) expect(enhanceCost(lv)).toBeGreaterThan(enhanceCost(lv - 1));
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 16].map(enhanceStones)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 3, 5]);
});

test('items.js 는 enhance.js 의 같은 함수를 다시 내보낸다(클라이언트·서버·시뮬 공용 표)', () => {
  expect(enhanceChance).toBe(table.enhanceChance); expect(enhanceCost).toBe(table.enhanceCost); expect(enhanceStones).toBe(table.enhanceStones);
});
