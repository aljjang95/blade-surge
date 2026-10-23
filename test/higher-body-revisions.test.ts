import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';
import HIGHER_V1 from '../src/data/higher-body-revisions-v1.json';
import RANGER_T3_V2 from '../src/data/ranger-t3-body-revision-v2.json';
import {
  higherBodyRevisions, higherBodyRevisionHistory, supersedeHigherBodyRevisions, validateHigherBodyRevisions, revisedLibraryFile, resolveAssetSource,
  rangerLibraryRevision, rogueLibraryRevision, foxBodyRevision,
} from '../src/engine/library-assets.js';

type Revision = {
  id: string; asset: string; useInGame: boolean; status: string;
  source: { path: string; sha256: string };
  output: { path: string; sha256: string | null };
};
type RevisionSet = { schema: string; revisions: Revision[] };
// 게임이 쓰는 기록 = v1 번들 + 대신 쓰는 개정(3단계 궁수 body-fit-v2). v1 JSON 은 이력으로 그대로 둔다.
const HIGHER = higherBodyRevisions() as RevisionSet;
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
  expect(HIGHER.schema).toBe(HIGHER_V1.schema);
  expect(HIGHER.revisions.map(revision => revision.id)).toEqual(HIGHER_V1.revisions.map(revision => revision.id === 'ranger-t3-body-fit-v1' ? 'ranger-t3-body-fit-v2' : revision.id));
  expect(HIGHER.revisions.find(revision => revision.asset === 'hero_ranger_t3')).toBe(RANGER_T3_V2);
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

test('3단계 궁수 v2 는 같은 원본의 v1 기록을 대신하고 출처를 남기며, v1 기록·파일은 이력으로 남고 선택되지 않는다', () => {
  const asset = assetFor('hero_ranger_t3'), v1 = HIGHER_V1.revisions.find(revision => revision.asset === 'hero_ranger_t3')!;
  expect(RANGER_T3_V2.supersedes).toBe(v1.id);
  expect(RANGER_T3_V2.source).toEqual(v1.source);
  expect(higherBodyRevisionHistory()).toEqual([v1]);
  expect(revisedLibraryFile(asset)).toBe('/models/heroes-next/ranger-t3-body-fit-v2.glb');
  expect(resolveAssetSource(asset)).toBe('/models/heroes-next/ranger-t3-body-fit-v2.glb');
  expect(digest('public' + RANGER_T3_V2.output.path)).toBe(RANGER_T3_V2.output.sha256);
  // v1 파일은 지우거나 덮지 않는다. 대신 쓰는 개정이 생긴 v1 기록은 게임이 고르지 않는다.
  expect(digest('public' + v1.output.path)).toBe(v1.output.sha256);
  expect(() => revisedLibraryFile(asset, v1)).toThrow();
  // 출처: Tripo 작업·리그 원본·가중치 정리·재결합 도구와 base(v4) SHA 가 실제 파일과 맞는다.
  const a = RANGER_T3_V2.authoring;
  expect(a.tripo.taskId).toBe('55002756-663d-4a85-a02e-f91821a96846');
  expect(digest(a.tripo.riggedGlb.path)).toBe(a.tripo.riggedGlb.sha256);
  expect(a.base).toEqual({ path: rangerLibraryRevision().clipSource.path, sha256: rangerLibraryRevision().clipSource.sha256 });
  expect(digest('public' + a.base.path)).toBe(a.base.sha256);
  // 도구는 이후 옵션이 늘 수 있으므로 현재 파일이 아니라 기록의 커밋·SHA 가 출처다(형식만 검사).
  for (const tool of [a.weightClean, a.rebind]) { expect(tool.commit).toMatch(/^[a-f0-9]{40}$/); expect(tool.scriptSha256 ?? tool.toolSha256).toMatch(/^[a-f0-9]{64}$/); }
  expect(a.rebind.outputSha256).toBe(RANGER_T3_V2.output.sha256);
  // GLB 안의 재결합 기록이 개정 기록과 같다(base·정리 몸 SHA·들기·소켓·클립 없음).
  const bytes = readFileSync(new URL('../public' + RANGER_T3_V2.output.path, import.meta.url));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const { jointGapM: _gaps, ...extras } = doc.asset.extras.bodyRebind;
  expect(extras).toEqual(a.rebind.extras);
  expect(extras.bodySha256).toBe(a.weightClean.outputSha256);
  expect(doc.animations).toBeUndefined();
  // 재질 마감은 v1 과 같은 조건(v1 GLB 에 materialFinish 없음 → v2 도 굽지 않음, 런타임 마감이 담당).
  const v1Bytes = readFileSync(new URL('../public' + v1.output.path, import.meta.url));
  expect(JSON.parse(v1Bytes.subarray(20, 20 + v1Bytes.readUInt32LE(12)).toString()).asset.extras?.materialFinish).toBeUndefined();
  expect(RANGER_T3_V2.materialFinish.applied).toBe(false); expect(doc.asset.extras.materialFinish).toBeUndefined();
  // 대신 쓰는 개정은 같은 자산·같은 원본의 이력 기록 하나만 가리킬 수 있다.
  const bad = (patch: (value: any) => void) => { const next = structuredClone(RANGER_T3_V2) as any; patch(next); return () => supersedeHigherBodyRevisions(HIGHER_V1, [next]); };
  expect(bad(() => {})).not.toThrow();
  expect(bad(value => { value.supersedes = 'ranger-t2-body-fit-v1'; })).toThrow();
  expect(bad(value => { value.source.sha256 = 'f'.repeat(64); })).toThrow();
  expect(bad(value => { value.asset = 'hero_ranger_t2'; })).toThrow();
  expect(bad(value => { value.id = v1.id; })).toThrow();
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
