import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';
import HIGHER from '../src/data/higher-body-revisions-v1.json';
import {
  higherBodyRevisions, validateHigherBodyRevisions, revisedLibraryFile, resolveAssetSource,
  rangerLibraryRevision, rogueLibraryRevision, foxBodyRevision,
} from '../src/engine/library-assets.js';

type Revision = {
  id: string; asset: string; useInGame: boolean; status: string;
  source: { path: string; sha256: string };
  output: { path: string; sha256: string | null };
};
type RevisionSet = { schema: string; revisions: Revision[] };
const copy = (): RevisionSet => structuredClone(HIGHER);
const assetFor = (id: string) => {
  const asset = manifest.assets.find(entry => entry.id === id);
  if (!asset) throw new Error('테스트 원본 자산 없음: ' + id);
  return asset;
};
const digest = (path: string) => createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex');
// 선택 함수만 검사하는 합성 기록이다. 실제 생성 파일·아트 수용 증거로 사용하지 않는다.
const generated = (revision: Revision): Revision => ({
  ...structuredClone(revision), status: 'GENERATED', useInGame: true,
  output: { ...revision.output, sha256: 'a'.repeat(64) },
});

test('다섯 revision은 정확한 원본 SHA와 개별 출력 경로를 가지며 비활성 초안은 원본을 선택한다', () => {
  const expected = ['hero_ranger_t2', 'hero_ranger_t3', 'hero_rogue_t2', 'hero_rogue_t3', 'avatar_rogue_crow'];
  expect(higherBodyRevisions()).toBe(HIGHER);
  const revisions = validateHigherBodyRevisions(HIGHER);
  expect(revisions.map((entry: Revision) => entry.asset)).toEqual(expected);
  for (const revision of revisions as Revision[]) {
    const asset = assetFor(revision.asset);
    expect(revision.source.sha256).toBe(asset.sha256);
    expect(digest(revision.source.path)).toBe(asset.sha256);
    expect(revision.output.path).toBe('/models/heroes-next/' + revision.id + '.glb');
    if (revision.status === 'DRAFT') {
      expect(revision.useInGame).toBe(false); expect(revision.output.sha256).toBeNull();
      expect(revisedLibraryFile(asset)).toBeNull();
      expect(resolveAssetSource(asset)).toBe(asset.file);
    } else {
      if (revision.status !== 'GENERATED' || typeof revision.output.sha256 !== 'string') throw new Error('생성 기록에는 실제 출력 SHA가 필요합니다.');
      expect(digest('public' + revision.output.path)).toBe(revision.output.sha256);
      expect(revisedLibraryFile(asset)).toBe(revision.useInGame ? revision.output.path : null);
    }
  }
});

test('생성 완료한 명시적 revision만 해당 몸체에서 선택하고 비활성 생성본은 원본을 유지한다', () => {
  const before = JSON.stringify(HIGHER);
  for (const draft of copy().revisions) {
    const revision = generated(draft), asset = assetFor(draft.asset);
    expect(revisedLibraryFile(asset, revision)).toBe(revision.output.path);
    expect(revisedLibraryFile(asset, { ...revision, useInGame: false })).toBeNull();
    expect(() => revisedLibraryFile({ ...asset, sha256: 'f'.repeat(64) }, revision)).toThrow();
    for (const other of copy().revisions.filter(entry => entry.asset !== draft.asset)) {
      expect(revisedLibraryFile(assetFor(other.asset), revision)).toBeNull();
      expect(() => revisedLibraryFile(assetFor(other.asset), { ...revision, asset: other.asset })).toThrow();
    }
  }
  expect(JSON.stringify(HIGHER)).toBe(before);
});

test('활성화 시 다른 prefix·경로 탈출·query·해시 위조 형식·잘못된 상태를 거부한다', () => {
  const revision = generated(copy().revisions[0]), asset = assetFor(revision.asset);
  const invalidPaths = [
    '/models/heroes-next/ranger-t3-body-fit-v1.glb',
    '/models/heroes-next/ranger-t2-body-fit-v1/../rogue-crow-body-fit-v1.glb',
    '/models/heroes-next/ranger-t2-body-fit-v1.glb?candidate=1',
    '/models/library/ranger-t2-body-fit-v1.glb',
    'https://example.com/models/heroes-next/ranger-t2-body-fit-v1.glb',
  ];
  for (const path of invalidPaths) expect(() => revisedLibraryFile(asset, { ...revision, output: { ...revision.output, path } })).toThrow();
  for (const sha256 of [null, '', 'wrong', 'A'.repeat(64)]) expect(() => revisedLibraryFile(asset, { ...revision, output: { ...revision.output, sha256 } })).toThrow();
  expect(() => revisedLibraryFile(asset, { ...revision, status: 'DRAFT' })).toThrow();
  expect(() => revisedLibraryFile(asset, { ...revision, status: 'VALIDATED' })).toThrow();
  expect(() => revisedLibraryFile(asset, { ...revision, source: { ...revision.source, sha256: 'b'.repeat(64) } })).toThrow();
  expect(() => revisedLibraryFile(asset, { ...revision, source: { ...revision.source, path: 'asset-library/normalized/hero_ranger_t3.glb' } })).toThrow();
});

test('번들 기록의 누락·중복·알 수 없는 자산과 초안의 가짜 생성 정보를 거부한다', () => {
  const mutations: Array<(value: RevisionSet) => void> = [
    value => { value.schema = 'wrong'; },
    value => { value.revisions.pop(); },
    value => { value.revisions.push(structuredClone(value.revisions[0])); },
    value => { value.revisions[1].id = value.revisions[0].id; },
    value => { value.revisions[1].asset = value.revisions[0].asset; },
    value => { value.revisions[1].output.path = value.revisions[0].output.path; },
    value => { value.revisions[0].id = 'unknown-body-fit-v1'; },
    value => { value.revisions[0].asset = 'hero_knight_t1'; },
    value => { value.revisions[0].useInGame = true; value.revisions[0].status = 'DRAFT'; },
    value => { value.revisions[0].status = 'DRAFT'; value.revisions[0].useInGame = false; value.revisions[0].output.sha256 = 'a'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const invalid = copy(); mutate(invalid);
    expect(() => validateHigherBodyRevisions(invalid)).toThrow();
  }
});

test('기존 궁수·도적·여우 선택과 명시적 revision 계약은 그대로다', () => {
  for (const revision of [rangerLibraryRevision(), rogueLibraryRevision(), foxBodyRevision()]) {
    const asset = assetFor(revision.asset), before = JSON.stringify(revision);
    expect(revisedLibraryFile(asset)).toBe(revision.output.path);
    expect(revisedLibraryFile(asset, revision)).toBe(revision.output.path);
    expect(resolveAssetSource(asset)).toBe(revision.output.path);
    expect(() => revisedLibraryFile({ ...asset, sha256: 'f'.repeat(64) }, revision)).toThrow();
    expect(() => revisedLibraryFile(asset, { ...revision, output: { ...revision.output, path: '/wrong.glb' } })).toThrow();
    expect(revisedLibraryFile(asset, { ...revision, useInGame: false })).toBeNull();
    expect(JSON.stringify(revision)).toBe(before);
  }
  expect(revisedLibraryFile(assetFor('hero_knight_t1'))).toBeNull();
  expect(revisedLibraryFile(null)).toBeNull();
});
