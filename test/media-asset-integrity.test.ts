import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { HEROES } from '../src/data/heroes.js';
import { ITEM_BY_ID } from '../src/data/items.js';

const refs = [...Object.values(HEROES).flatMap(hero => [hero.portrait, ...hero.skills.map(skill => skill.icon)]), ...Object.values(ITEM_BY_ID).map(item => item.icon)]
  .filter((path): path is string => typeof path === 'string');
const unique = [...new Set(refs)];
const isImage = (bytes: Buffer) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

test('hero skill and dropped-gear portraits are shipped, decodable image files', () => {
  expect(unique.length).toBeGreaterThanOrEqual(60);
  for (const path of unique) {
    const file = `public${path}`;
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(isImage(bytes)).toBe(true);
  }
});
