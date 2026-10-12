import manifest from '../../asset-library/manifest.json';
import { LIBRARY_SCHEMA, triangleLimit, validateManifest as validateManifestShape } from '../../tools/asset-library/manifest.mjs';

export { LIBRARY_SCHEMA, triangleLimit };
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
  return value.assets.find((asset) => asset.id === modelName || asset.replaces === modelName) || null;
}

export function resolveAssetSource(asset, root = '') {
  if (!asset?.file) throw new Error('asset file is required');
  if (!root && bundledFiles[`../../asset-library/normalized/${asset.id}.glb`]) return bundledFiles[`../../asset-library/normalized/${asset.id}.glb`];
  return root ? `${root.replace(/\/$/, '')}/${asset.file.replace(/^\//, '')}` : asset.file;
}

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
    assetFor(name) { return assets.find((asset) => asset.id === name || (asset.kind === 'character' && asset.replaces === name)) || null; },
    load(asset, fallback) {
      if (cache.has(asset.id)) return cache.get(asset.id);
      const promise = Promise.resolve().then(() => load(resolveAssetSource(asset))).then((gltf) => {
        validateLibraryModel(gltf, asset);
        gltf.scene.userData.libraryAsset = asset;
        gltf.scene.traverse((node) => {
          if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.userData.tllAuthored = true;
        });
        return prepare(gltf);
      }).catch((error) => {
        warn(`library asset failed, using legacy model: ${asset.id}`, error);
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
  return resolveLibraryAsset(manifest, modelName);
}
