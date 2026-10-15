import manifest from '../../asset-library/manifest.json';
import { LIBRARY_SCHEMA, triangleLimit, validateManifest as validateManifestShape } from '../../tools/asset-library/manifest.mjs';
import { monsterRosterEntry } from '../data/monster-roster.js';
import RANGER_LIBRARY_REVISION from '../data/ranger-library-revision-v1.json';

export { LIBRARY_SCHEMA, triangleLimit };
export const RANGER_LIBRARY_REVISION_ID = 'ranger-library-v1';
let bundledFiles = {};
try {
  bundledFiles = import.meta.glob('../../asset-library/normalized/*.glb', { eager: true, query: '?url', import: 'default' });
} catch {
  // Bun의 계약 테스트는 Vite URL 변환 없이 공개 경로를 사용한다.
}

export function validateManifest(value, { files = null } = {}) {
  validateManifestShape(value);
  if (files) for (const asset of value.assets) if (!files.has(asset.file)) throw new Error(`missing normalized asset: ${asset.id}`);
  return value;
}

export function resolveLibraryAsset(value, modelName) {
  validateManifest(value);
  return value.assets.find((asset) => asset.id === modelName) || null;
}

export function resolveAssetSource(asset, root = '') {
  if (!asset?.file) throw new Error('asset file is required');
  const revised = revisedLibraryFile(asset);
  if (revised) return root ? root.replace(/\/$/, '') + revised : revised;
  if (!root && bundledFiles[`../../asset-library/normalized/${asset.id}.glb`]) return bundledFiles[`../../asset-library/normalized/${asset.id}.glb`];
  return root ? `${root.replace(/\/$/, '')}/${asset.file.replace(/^\//, '')}` : asset.file;
}

/**
 * Blender 로 팔·활 클립을 다시 저작한 궁수 1단계 몸체. 원본 manifest 항목·원본 GLB 는 그대로 두고,
 * 같은 원본 SHA 에서 생성이 끝난 교정본만 대신 받는다. 2·3단계와 아바타는 이 1단계 클립을 공유한다.
 * @param {{id?: string, sha256?: string}|null} asset
 * @returns {string|null}
 */
export function revisedLibraryFile(asset, revision = RANGER_LIBRARY_REVISION) {
  if (!asset || asset.id !== revision.asset || !revision.useInGame) return null;
  if (revision.id !== RANGER_LIBRARY_REVISION_ID || revision.status !== 'GENERATED' || revision.source?.sha256 !== asset.sha256
    || !/^[a-f0-9]{64}$/.test(revision.output?.sha256 || '') || !String(revision.output?.path || '').startsWith('/models/heroes-next/ranger-')
    || !String(revision.output.path).endsWith('.glb')) {
    throw new Error('Ranger library revision requires the exact generated file for the shipped source');
  }
  return revision.output.path;
}

export const rangerLibraryRevision = () => RANGER_LIBRARY_REVISION;

export function validateLibraryModel(gltf, asset) {
  const names = new Set(gltf.animations.map((clip) => clip.name));
  for (const name of Object.values(asset.clips)) if (!names.has(name)) throw new Error(`missing authored animation: ${name}`);
  let triangles = 0, bones = 0, skinned = false;
  const materials = new Set();
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
    if (node.isSkinnedMesh) { skinned = true; bones = Math.max(bones, node.skeleton.bones.length); }
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  if (triangles > triangleLimit(asset)) throw new Error('triangle budget exceeded');
  if (bones > 80 || materials.size > 2 || (asset.kind === 'character' && !skinned) || (asset.kind === 'prop' && skinned)) throw new Error('invalid library skin/material budget');
  return gltf;
}

export function createLibraryLoader(value, load, prepare = (gltf) => gltf, warn = console.warn) {
  const assets = validateManifest(value).assets;
  const cache = new Map();
  return {
    assetFor(name) { return assets.find((asset) => asset.id === name) || null; },
    assetForHero(heroId, tier = 1) { return selectHeroLibraryAsset(value, heroId, tier); },
    assetForAvatar(avatarId) { return assetForAvatar(value, avatarId); },
    heroAssets(heroId) { return heroLibraryAssets(value, heroId); },
    load(asset, fallback, prepareAsset = prepare) {
      if (cache.has(asset.id)) return cache.get(asset.id);
      const promise = Promise.resolve().then(() => load(resolveAssetSource(asset))).then((gltf) => {
        validateLibraryModel(gltf, asset);
        gltf.scene.userData.libraryAsset = asset;
        gltf.scene.traverse((node) => {
          if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.userData.tllAuthored = true;
        });
        return prepareAsset(gltf, asset);
      }).catch((error) => {
        warn(`library asset failed, using configured library fallback: ${asset.id}`, error);
        // 폴백까지 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
        return Promise.resolve().then(fallback).catch((fallbackError) => { cache.delete(asset.id); throw fallbackError; });
      });
      cache.set(asset.id, promise);
      return promise;
    },
  };
}

export function createDefaultLibraryLoader(load, prepare) {
  return createLibraryLoader(manifest, load, prepare);
}

export function libraryAssets(kind = null) {
  validateManifest(manifest);
  return kind ? manifest.assets.filter((asset) => asset.kind === kind) : manifest.assets;
}

export function libraryAssetIds() {
  return libraryAssets().map((asset) => asset.id);
}

export function libraryAssetForModel(modelName) {
  const roster = monsterRosterEntry(modelName);
  return roster ? manifest.assets.find((asset) => asset.id === roster.asset) || manifest.assets.find((asset) => asset.id === roster.fallback) || null
    : resolveLibraryAsset(manifest, modelName);
}

export function libraryAssetForHero(heroId) {
  return selectHeroLibraryAsset(manifest, heroId, 1);
}

export function assetForAvatar(value, avatarId) {
  validateManifest(value);
  return value.assets.find((asset) => asset.id === avatarId && asset.avatar === true && asset.role === 'hero') || null;
}

export function libraryAssetForAvatar(avatarId) {
  return assetForAvatar(manifest, avatarId);
}

export function heroLibraryAssets(value, heroId) {
  validateManifest(value);
  return value.assets.filter((asset) => asset.kind === 'character' && asset.role === 'hero' && asset.avatar !== true && asset.heroId === heroId)
    .sort((a, b) => (a.armorTier || 1) - (b.armorTier || 1));
}

export function selectHeroLibraryAsset(value, heroId, requestedTier = 1) {
  const assets = heroLibraryAssets(value, heroId), tier = Math.min(3, Math.max(1, requestedTier));
  return [...assets].reverse().find((asset) => (asset.armorTier || 1) <= tier) || null;
}
