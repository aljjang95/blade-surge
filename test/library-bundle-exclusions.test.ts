import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import manifest from '../asset-library/manifest.json';
import { libraryAssets, resolveAssetSource, revisedLibraryFile } from '../src/engine/library-assets.js';

// 전달 크기를 위해 빌드 번들에서 뺀 원본들. 교정본이 항상 대신 선택되므로 번들 URL 이 필요 없다는 것을 코드로 증명한다.
const EXCLUDED = ['hero_ranger_t1', 'hero_ranger_t2', 'hero_ranger_t3', 'hero_rogue_t1', 'hero_rogue_t2', 'hero_rogue_t3', 'avatar_ranger_fox', 'avatar_rogue_crow',
  // 도적 S·U 등급 몸은 heroes-next 교정 몸(t4-body-revisions-v1)이 대신 로드된다.
  'hero_rogue_t1s', 'hero_rogue_t2u',
  // 궁수 S·U 등급 몸도 같은 경로(1단계 클립 원본 v4 골격에 재결합).
  'hero_ranger_t1s', 'hero_ranger_t2u',
  // 할로윈 아바타(t5) 도적·궁수는 heroes-next 교정 몸(t5-avatar-body-revisions-v1)이 대신 로드된다.
  'avatar_rogue_vampire'];
const source = readFileSync(new URL('../src/engine/library-assets.js', import.meta.url), 'utf8');

test('번들에서 뺀 원본은 모두 교정본이 선택되어 원본 번들 경로를 쓰지 않는다', () => {
  for (const id of EXCLUDED) {
    const asset = manifest.assets.find(entry => entry.id === id);
    expect(asset, id).toBeTruthy();
    const revised = revisedLibraryFile(asset as any);
    expect(revised, id).toMatch(/^\/models\/heroes-next\/.+\.glb$/);
    expect(resolveAssetSource(asset as any), id).toBe(revised as string);
  }
});

test('import.meta.glob 제외 목록이 이 테스트의 목록과 정확히 같고 원본 파일은 asset-library 에 그대로 남는다', () => {
  const excluded = [...source.matchAll(/'!\.\.\/\.\.\/asset-library\/normalized\/([a-z0-9_]+)\.glb'/g)].map(match => match[1]).sort();
  expect(excluded).toEqual([...EXCLUDED].sort());
  for (const id of EXCLUDED) expect(() => readFileSync(new URL(`../asset-library/normalized/${id}.glb`, import.meta.url))).not.toThrow();
});

test('제외한 원본 말고도 교정본 없이 원본을 쓰는 라이브러리 자산은 번들에 남는다', () => {
  const keep = libraryAssets().filter(asset => !EXCLUDED.includes(asset.id));
  expect(keep.length).toBe(manifest.assets.length - EXCLUDED.length);
  for (const asset of keep) expect(revisedLibraryFile(asset as any), asset.id).toBeNull();
});
