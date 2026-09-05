import { expect, test } from 'bun:test';
import { checkRelease } from '../tools/deploy-guard.mjs';

const head = 'a'.repeat(40), sha = 'b'.repeat(40);
const valid = () => ({ head, dirty: false, live: { sha, dirty: false }, expectedLive: sha,
  known: () => true, isAncestor: () => true });
test('clean하고 알려진 live의 후속 커밋만 배포한다', () => {
  expect(checkRelease(valid()).head).toBe(head);
  expect(() => checkRelease({ ...valid(), dirty: true })).toThrow();
  expect(() => checkRelease({ ...valid(), live: null })).toThrow();
  expect(() => checkRelease({ ...valid(), live: { sha, dirty: true } })).toThrow();
  expect(() => checkRelease({ ...valid(), live: { sha: 'HEAD', dirty: false } })).toThrow();
  expect(() => checkRelease({ ...valid(), expectedLive: 'c'.repeat(40) })).toThrow();
  expect(() => checkRelease({ ...valid(), known: () => false })).toThrow();
  expect(() => checkRelease({ ...valid(), isAncestor: () => false })).toThrow();
});
