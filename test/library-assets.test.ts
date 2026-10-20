import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibraryLoader, libraryAssetForModel, resolveAssetSource, validateManifest } from '../src/engine/library-assets.js';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';

const asset = {
  id: 'bone-knight-test', kind: 'character', body: 'biped', replaces: null, file: '/models/library/bone-knight-test.glb',
  heightM: 1.6, triangles: 1, bytes: 1, sha256: 'a'.repeat(64), clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', attackHeavy: 'attackHeavy', hit: 'hit', death: 'death' },
  provenance: { tool: 'Blender 5.2', account: 'owner subscription', taskId: '', prompt: '', createdAt: '2026-10-12T00:00:00.000Z', rawSha256: 'b'.repeat(64) }, license: 'owner-generated', shared: true,
};

test('manifest asset resolves to the game loader path and roster model', () => {
  const manifest = { schema: 'tll.game-asset-library.v1', assets: [asset] };
  expect(validateManifest(manifest).assets[0].id).toBe('bone-knight-test');
  expect(resolveAssetSource(asset, '/')).toBe('/models/library/bone-knight-test.glb');
  // 적 모델은 manifest의 replaces가 아니라 로스터가 직접 자산을 선택한다.
  expect(libraryAssetForModel('Skeleton_Vanguard')?.id).toBe('bone_knight');
  expect(MONSTER_ROSTER.Skeleton_Vanguard.asset).toBe('bone_knight');
});

test('missing logical clip key is rejected', () => {
  expect(() => validateManifest({ schema: 'tll.game-asset-library.v1', assets: [{ ...asset, clips: { idle: 'idle' } }] })).toThrow('missing required clip key');
});

test('invalid logical clip names are rejected', () => {
  expect(() => validateManifest({ schema: 'tll.game-asset-library.v1', assets: [{ ...asset, clips: { ...asset.clips, idle: 'Idle' } }] })).toThrow('missing required clip key: idle');
});

test('triangle budget is rejected', () => {
  expect(() => validateManifest({ schema: 'tll.game-asset-library.v1', assets: [{ ...asset, triangles: 12001 }] })).toThrow('triangle budget exceeded');
});

test('로스터 선택은 manifest 교체 별칭에 의존하지 않는다', () => {
  const manifest = { schema: 'tll.game-asset-library.v1', assets: [asset] };
  expect(MONSTER_ROSTER.Skeleton_Warrior.fallback).toBe('bone_knight');
});

test('replacement loader falls back when the library artifact fails to load', async () => {
  const loader = createLibraryLoader({ schema: 'tll.game-asset-library.v1', assets: [asset] }, () => Promise.reject(new Error('missing test artifact')), undefined, () => {});
  const fallback = { scene: { userData: {} }, animations: [] };
  await expect(loader.load(asset, () => fallback)).resolves.toBe(fallback);
});

test('every manifest asset has a matching normalized GLB with its logical clips', () => {
  const current = JSON.parse(readFileSync(new URL('../asset-library/manifest.json', import.meta.url), 'utf8'));
  expect(current.assets.length).toBeGreaterThan(0);
  for (const entry of current.assets) {
    const bytes = readFileSync(new URL(`../asset-library/normalized/${entry.id}.glb`, import.meta.url));
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    if (entry.kind === 'character') {
      for (const clip of Object.keys(entry.clips)) expect(json.animations.map((value: { name: string }) => value.name)).toContain(clip);
    }
  }
});
