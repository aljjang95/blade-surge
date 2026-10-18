import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cardThumb } from '../src/ui/citadel-command.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';

// 로비 카드는 작은 썸네일을, 상세 패널은 원화를 쓴다(2026-10-18 카드 디코드 지연·용량 낭비).
test('expansion card art maps to an existing 320px thumbnail', () => {
  const arts = [...new Set(ALL_DUNGEONS.map(d => d.art).filter(a => typeof a === 'string' && a.startsWith('/img/expansion/')))];
  expect(arts.length).toBeGreaterThan(0);
  for (const art of arts) {
    const thumb = cardThumb(art);
    expect(thumb).toBe(art.replace('/img/expansion/', '/img/expansion/thumb/'));
    expect(existsSync('public' + thumb)).toBe(true);
    expect(existsSync('public' + art)).toBe(true);
  }
});

test('non-expansion art and missing values pass through unchanged', () => {
  expect(cardThumb('/img/encounters/boss_ash_colossus.webp')).toBe('/img/encounters/boss_ash_colossus.webp');
  expect(cardThumb(undefined)).toBe(undefined);
  expect(cardThumb('/img/expansion/thumb/star_archive.webp')).toBe('/img/expansion/thumb/star_archive.webp');
});
