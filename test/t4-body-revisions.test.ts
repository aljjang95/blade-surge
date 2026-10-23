import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';
import T4 from '../src/data/t4-body-revisions-v1.json';
import HIGHER_V1 from '../src/data/higher-body-revisions-v1.json';
import ROGUE_LIBRARY from '../src/data/rogue-library-revision-v2.json';
import {
  t4BodyRevisions, validateT4BodyRevisions, validateHigherBodyRevisions, higherBodyRevisions, revisedLibraryFile, resolveAssetSource,
} from '../src/engine/library-assets.js';
import { selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import { classify, loadSplit } from '../tools/optimize/asset-split.mjs';

// 등급 몸(S 1.5·U 2.5) 중 heroes-next 교정 몸을 쓰는 것(도적). 정규화본은 manifest 출처, 게임은 1단계 교정 골격에 재결합한 몸을 받는다.
const digest = (path: string) => createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex');
const assetFor = (id: string) => {
  const asset = manifest.assets.find(entry => entry.id === id);
  if (!asset) throw new Error('원본 자산 없음: ' + id);
  return asset as any;
};
const copy = () => structuredClone(T4) as any;

test('도적 S·U 교정 기록은 manifest 원본 SHA·실제 출력 SHA·1단계 교정 base 와 정확히 맞는다', () => {
  expect(t4BodyRevisions()).toBe(T4);
  const revisions = validateT4BodyRevisions(T4) as any[];
  expect(revisions.map(revision => revision.asset)).toEqual(['hero_rogue_t1s', 'hero_rogue_t2u']);
  for (const revision of revisions) {
    const asset = assetFor(revision.asset);
    expect(asset.heroId).toBe('rogue');
    expect(revision.source.path).toBe('asset-library/normalized/' + asset.id + '.glb');
    expect(revision.source.sha256).toBe(asset.sha256);
    expect(digest(revision.source.path)).toBe(asset.sha256);
    expect(revision.output.path).toBe('/models/heroes-next/' + revision.id + '.glb');
    expect(digest('public' + revision.output.path)).toBe(revision.output.sha256);
    expect(revision.authoring.base).toEqual(ROGUE_LIBRARY.output);
    expect(revisedLibraryFile(asset)).toBe(revision.output.path);
    expect(resolveAssetSource(asset)).toBe(revision.output.path);
    // 저작 동작 등록부에 없으므로 원본 클립을 쓰되, 실제 선택 파일의 개정 id·SHA 로 기록한다.
    expect(selectedBodyMotionIdentity(asset)).toMatchObject({ asset: asset.id, heroId: 'rogue', revisionId: revision.id, path: revision.output.path, sha256: revision.output.sha256 });
  }
});

test('다섯 상위 몸체 기록 계약(v1)은 그대로다', () => {
  expect(HIGHER_V1.revisions.length).toBe(5);
  expect(validateHigherBodyRevisions(higherBodyRevisions()).length).toBe(5);
  expect(HIGHER_V1.revisions.some(revision => /t1s|t2u/.test(revision.asset))).toBe(false);
});

test('목표 밖 기록·다른 경로·원본 SHA 위조·base 불일치·초안 SHA 를 거부한다', () => {
  const tamper: ((value: any) => void)[] = [
    value => { value.schema = 'blade-surge.higher-body-revisions.v1'; },
    value => { value.revisions.pop(); },
    value => { value.revisions.push(structuredClone(value.revisions[0])); },
    value => { value.revisions[0].output.path = '/models/heroes-next/rogue-t1s-body-fit-v1/../rogue-t2-body-fit-v1.glb'; },
    value => { value.revisions[0].output.path = '/models/heroes-next/rogue-t1s-body-fit-v1.glb?x=1'; },
    value => { value.revisions[1].source.sha256 = 'f'.repeat(64); },
    value => { value.revisions[1].source.path = 'asset-library/normalized/hero_rogue_t2.glb'; },
    value => { value.revisions[0].authoring.base.sha256 = 'e'.repeat(64); },
    value => { value.revisions[0].authoring.base.path = '/models/heroes-next/rogue-library-t1-axis-v1.glb'; },
    value => { delete value.revisions[0].authoring; },
    value => { value.revisions[0].status = 'DRAFT'; },
    value => { value.revisions[0].output.sha256 = 'not-a-sha'; },
    value => { value.revisions[0].id = 'rogue-t1s-body-fit-v2'; },
  ];
  for (const change of tamper) {
    const value = copy(); change(value);
    expect(() => validateT4BodyRevisions(value)).toThrow();
  }
  const draft = copy().revisions[0];
  draft.status = 'DRAFT'; draft.useInGame = false; draft.output.sha256 = null;
  expect(revisedLibraryFile(assetFor('hero_rogue_t1s'), draft)).toBeNull();
  // 다른 자산에 기록을 대어도 선택되지 않는다.
  expect(revisedLibraryFile(assetFor('hero_rogue_t2u'), copy().revisions[0])).toBeNull();
});

test('교정 몸은 2단계와 같은 heroes-t2 원격 묶음이다(초기 번들 증가 없음)', async () => {
  const split = await loadSplit();
  for (const revision of T4.revisions) expect(classify(revision.output.path.slice(1), split), revision.id).toMatchObject({ class: 'remote', group: 'heroes-t2' });
});
