import { expect, test } from 'bun:test';
import { bossShortcutRule, bossShortcutShort } from '../src/game/boss-shortcut.js';

test('보스 직행 짧은 안내: 미충족은 조건, 충족은 가능 문구', () => {
  expect(bossShortcutShort(bossShortcutRule({ power: 3200, recPower: 3261, stars: 0 }))).toBe('보스 직행: ★3 또는 전투력 4,892');
  expect(bossShortcutShort(bossShortcutRule({ power: 5000, recPower: 3261, stars: 0 }))).toContain('보스 직행 가능');
  expect(bossShortcutShort(bossShortcutRule({ power: 0, recPower: 3261, stars: 3 }))).toContain('★3');
});
