import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..', 'public', 'img', 'materials-cc0');
const files = {
  'polyhaven-medieval-wall-02-diffuse-1k.jpg': '35394495938c916ea291e11e718c2a6d',
  'polyhaven-medieval-wall-02-normal-gl-1k.jpg': '9f90bd2c03ed28c69f4e2ca6e7435117',
  'polyhaven-medieval-wall-02-rough-1k.jpg': 'c8dcc8032e4a17fa80cc5b44f75d2e49',
};

test('Poly Haven Medieval Wall 02 CC0 source files retain published 1K hashes', () => {
  for (const [name, expected] of Object.entries(files)) {
    const bytes = readFileSync(path.join(root, name));
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(createHash('md5').update(bytes).digest('hex')).toBe(expected);
  }
});
