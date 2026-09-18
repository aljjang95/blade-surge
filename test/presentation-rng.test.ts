import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { makeRng, prand } from '../src/engine/prng.js';

test('연출 난수는 시드가 같으면 같은 열이고 [0,1) 안이다', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const seqA = Array.from({ length: 64 }, () => a()), seqB = Array.from({ length: 64 }, () => b()), seqC = Array.from({ length: 64 }, () => c());
  expect(seqA).toEqual(seqB); expect(seqA).not.toEqual(seqC);
  for (const v of [...seqA, ...Array.from({ length: 256 }, () => prand())]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  expect(new Set(seqA).size).toBeGreaterThan(60);
});

// 오디오와 FX 는 벽시계 게이트(AudioContext 시각·animationend DOM 개수) 뒤에서 난수를 뽑는다.
// 게임 Math.random 을 쓰면 같은 시드·같은 dt 에서도 층 클리어가 140~183초로 흔들린다 — 연출 계층은 게임 난수를 소비하지 않는다.
for (const file of ['src/engine/fx.js', 'src/engine/audio.js']) test(`${file} 은 게임 난수(Math.random)를 쓰지 않는다`, () => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  expect(source.includes('Math.random(')).toBe(false);
  expect(source.includes("from './prng.js'")).toBe(true);
});
