import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';
import T5 from '../src/data/t5-avatar-body-revisions-v1.json';
import T4 from '../src/data/t4-body-revisions-v1.json';
import HIGHER_V1 from '../src/data/higher-body-revisions-v1.json';
import ROGUE_LIBRARY from '../src/data/rogue-library-revision-v2.json';
import RANGER_V4 from '../src/data/ranger-library-revision-v4.json';
import {
  t5AvatarBodyRevisions, validateT5AvatarBodyRevisions, validateT4BodyRevisions, t4BodyRevisions, tierRebindBodyRevisions,
  revisedLibraryFile, resolveAssetSource,
} from '../src/engine/library-assets.js';
import { selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import { AVATAR_BY_ID } from '../src/data/avatars.js';
import { classify, loadSplit } from '../tools/optimize/asset-split.mjs';

// 할로윈 아바타(t5) 도적·궁수: 정규화본은 manifest 원본, 게임은 1단계 클립 원본 골격에 재결합한 heroes-next 교정 몸을 받는다.
const digest = (path: string) => createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex');
const assetFor = (id: string) => {
  const asset = manifest.assets.find(entry => entry.id === id);
  if (!asset) throw new Error('원본 자산 없음: ' + id);
  return asset as any;
};
const copy = () => structuredClone(T5) as any;
const BASES: Record<string, { path: string, sha256: string }> = { rogue: ROGUE_LIBRARY.output, ranger: RANGER_V4.output };
const ASSETS = ['avatar_rogue_vampire', 'avatar_ranger_blackcat'];

test('할로윈 아바타 교정 기록은 manifest 원본 SHA·실제 출력 SHA·1단계 클립 원본 base 와 정확히 맞는다', () => {
  expect(t5AvatarBodyRevisions()).toBe(T5);
  const revisions = validateT5AvatarBodyRevisions(T5) as any[];
  expect(revisions.map(revision => revision.asset)).toEqual(ASSETS);
  for (const revision of revisions) {
    const asset = assetFor(revision.asset);
    expect(asset.avatar).toBe(true);
    expect(AVATAR_BY_ID[asset.id]?.heroId).toBe(asset.heroId);
    expect(['rogue', 'ranger']).toContain(asset.heroId);
    expect(revision.source.path).toBe('asset-library/normalized/' + asset.id + '.glb');
    expect(revision.source.sha256).toBe(asset.sha256);
    expect(digest(revision.source.path)).toBe(asset.sha256);
    expect(revision.output.path).toBe('/models/heroes-next/' + revision.id + '.glb');
    expect(digest('public' + revision.output.path)).toBe(revision.output.sha256);
    expect(revision.authoring.base).toEqual(BASES[asset.heroId]);
    expect(revisedLibraryFile(asset)).toBe(revision.output.path);
    expect(resolveAssetSource(asset)).toBe(revision.output.path);
    expect(selectedBodyMotionIdentity(asset)).toMatchObject({ asset: asset.id, heroId: asset.heroId, revisionId: revision.id, path: revision.output.path, sha256: revision.output.sha256 });
  }
  expect(tierRebindBodyRevisions().map((revision: any) => revision.asset)).toEqual([...T4.revisions.map(revision => revision.asset), ...ASSETS]);
});

test('다섯 상위 몸체·네 등급 몸 기록 계약은 그대로다', () => {
  expect(HIGHER_V1.revisions.length).toBe(5);
  expect(t4BodyRevisions()).toBe(T4);
  expect(validateT4BodyRevisions(T4).length).toBe(4);
  expect([...HIGHER_V1.revisions, ...T4.revisions].some(revision => ASSETS.includes(revision.asset))).toBe(false);
  // 등급 몸 기록 묶음에 아바타 기록을 섞으면(또는 그 반대) 거절한다.
  expect(() => validateT4BodyRevisions({ ...T4, revisions: [...T4.revisions, ...T5.revisions] })).toThrow();
  expect(() => validateT5AvatarBodyRevisions({ ...T5, revisions: [...T5.revisions, T4.revisions[0]] })).toThrow();
});

test('목표 밖 기록·다른 경로·원본 SHA 위조·base 불일치·초안 SHA 를 거부한다', () => {
  const tamper: ((value: any) => void)[] = [
    value => { value.schema = 'blade-surge.t4-body-revisions.v1'; },
    value => { value.revisions.pop(); },
    value => { value.revisions.push(structuredClone(value.revisions[0])); },
    value => { value.revisions[0].output.path = '/models/heroes-next/rogue-vampire-body-fit-v1/../rogue-crow-body-fit-v1.glb'; },
    value => { value.revisions[0].output.path = '/models/heroes-next/rogue-vampire-body-fit-v1.glb?x=1'; },
    value => { value.revisions[0].source.sha256 = 'f'.repeat(64); },
    value => { value.revisions[0].source.path = 'asset-library/normalized/avatar_rogue_crow.glb'; },
    value => { value.revisions[0].authoring.base.sha256 = 'e'.repeat(64); },
    value => { value.revisions[0].authoring.base = { ...BASES.ranger }; },
    value => { delete value.revisions[0].authoring; },
    value => { value.revisions[0].status = 'DRAFT'; },
    value => { value.revisions[0].output.sha256 = 'not-a-sha'; },
    value => { value.revisions[0].id = 'rogue-vampire-body-fit-v2'; },
    value => { value.revisions[0].asset = 'avatar_rogue_crow'; },
    // 궁수 base 는 v6 출력(재결합 결과라 바인드 자세 아님)도, 도적 base 도 아니다.
    value => { value.revisions[1].authoring.base = { path: '/models/heroes-next/ranger-library-t1-v6.glb', sha256: value.revisions[1].authoring.base.sha256 }; },
    value => { value.revisions[1].authoring.base = structuredClone(value.revisions[0].authoring.base); },
    value => { value.revisions[1].asset = 'avatar_ranger_fox'; },
  ];
  for (const change of tamper) {
    const value = copy(); change(value);
    expect(() => validateT5AvatarBodyRevisions(value)).toThrow();
  }
  const draft = copy().revisions[0];
  draft.status = 'DRAFT'; draft.useInGame = false; draft.output.sha256 = null;
  expect(revisedLibraryFile(assetFor('avatar_rogue_vampire'), draft)).toBeNull();
  expect(revisedLibraryFile(assetFor('avatar_rogue_crow'), copy().revisions[0])).toBeNull();
});

test('교정 몸은 1차 아바타와 같은 avatars 원격 묶음이다(초기 번들 증가 없음)', async () => {
  const split = await loadSplit();
  for (const revision of T5.revisions) expect(classify(revision.output.path.slice(1), split), revision.id).toMatchObject({ class: 'remote', group: 'avatars' });
});
