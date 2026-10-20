import manifest from '../../asset-library/manifest.json';
import { LIBRARY_SCHEMA, triangleLimit, validateManifest as validateManifestShape } from '../../tools/asset-library/manifest.mjs';
import { monsterRosterEntry } from '../data/monster-roster.js';
import RANGER_LIBRARY_REVISION from '../data/ranger-library-revision-v4.json';
import ROGUE_LIBRARY_REVISION from '../data/rogue-library-revision-v2.json';
import FOX_BODY_REVISION from '../data/fox-body-revision-v1.json';
import HIGHER_BODY_REVISIONS from '../data/higher-body-revisions-v1.json';

export { LIBRARY_SCHEMA, triangleLimit };
// v3: v2 저작(전신 rest 축 리타깃·실제 스킨 접지·활 사격·백스텝, art-src/ranger/author_ranger_library_v2.py)을 Blender 5.2.2 에서 다시 굽고
// 몸 재질 보정을 GLB 에 고정했다(tools/art/finish-library-materials.mjs).
// v4: 저작 v3(art-src/ranger/author_ranger_library_v3.py)가 사망 정착의 왼팔 IK 목표만 프레임별 실제 가슴 자세로 다시 풀어
// 실제 런타임 활이 바닥을 뚫던 결함(v3 사망 1.04초 -0.10m)을 고쳤다. 다른 클립·메시·재질 마감은 v3 와 같다. v1–v3 기록·파일은 그대로 둔다.
export const RANGER_LIBRARY_REVISION_ID = 'ranger-library-v4';
// 도적 1단계: 축 교정 클립(rogue-library-axis-v1, art-src/hero-axis/author_hero_axis_v1.py) 그대로 + 같은 재질 마감. axis-v1 기록·파일은 그대로 둔다.
export const ROGUE_LIBRARY_REVISION_ID = 'rogue-library-v2';
export const FOX_BODY_REVISION_ID = 'fox-body-fit-v1';
// 자산별 출력 이름을 코드에서 고정한다. 초안은 원본을 고르고 실제 생성·검증된 기록만 활성화한다.
const HIGHER_BODY_TARGETS = Object.freeze([
  Object.freeze({ asset: 'hero_ranger_t2', id: 'ranger-t2-body-fit-v1', prefix: '/models/heroes-next/ranger-t2-body-fit-v1' }),
  Object.freeze({ asset: 'hero_ranger_t3', id: 'ranger-t3-body-fit-v1', prefix: '/models/heroes-next/ranger-t3-body-fit-v1' }),
  Object.freeze({ asset: 'hero_rogue_t2', id: 'rogue-t2-body-fit-v1', prefix: '/models/heroes-next/rogue-t2-body-fit-v1' }),
  Object.freeze({ asset: 'hero_rogue_t3', id: 'rogue-t3-body-fit-v1', prefix: '/models/heroes-next/rogue-t3-body-fit-v1' }),
  Object.freeze({ asset: 'avatar_rogue_crow', id: 'rogue-crow-body-fit-v1', prefix: '/models/heroes-next/rogue-crow-body-fit-v1' }),
]);
const requireHigherBody = (condition) => { if (!condition) throw new Error('Higher body revision requires an exact unique asset/source/public output contract'); };

function validateHigherBodyRevision(revision, target) {
  const source = manifest.assets.find(asset => asset.id === target.asset);
  requireHigherBody(revision?.id === target.id && revision.asset === target.asset && typeof revision.useInGame === 'boolean');
  requireHigherBody(source && revision.source?.path === 'asset-library/normalized/' + target.asset + '.glb'
    && revision.source.sha256 === source.sha256);
  // 정해진 전체 경로만 받으므로 다른 몸체 이름·하위 경로·query·상위 폴더 탈출을 허용하지 않는다.
  requireHigherBody(revision.output?.path === target.prefix + '.glb');
  requireHigherBody(revision.status === 'DRAFT'
    ? revision.useInGame === false && revision.output.sha256 === null
    : revision.status === 'GENERATED' && /^[a-f0-9]{64}$/.test(revision.output.sha256 || ''));
  return revision;
}

/** 다섯 원본 자산과 기록이 일대일인지 번들 로드 시 검사한다. 생성 전 SHA를 만들어 넣지 않는다. */
export function validateHigherBodyRevisions(value) {
  requireHigherBody(value?.schema === 'blade-surge.higher-body-revisions.v1'
    && Array.isArray(value.revisions) && value.revisions.length === HIGHER_BODY_TARGETS.length);
  requireHigherBody(new Set(value.revisions.map(revision => revision?.id)).size === HIGHER_BODY_TARGETS.length
    && new Set(value.revisions.map(revision => revision?.asset)).size === HIGHER_BODY_TARGETS.length
    && new Set(value.revisions.map(revision => revision?.output?.path)).size === HIGHER_BODY_TARGETS.length);
  return value.revisions.map(revision => {
    const target = HIGHER_BODY_TARGETS.find(entry => entry.id === revision?.id);
    requireHigherBody(target);
    return validateHigherBodyRevision(revision, target);
  });
}

const higherRevisions = validateHigherBodyRevisions(HIGHER_BODY_REVISIONS);
const LIBRARY_REVISIONS = Object.freeze([
  ...HIGHER_BODY_TARGETS.map(target => Object.freeze({ ...target, revision: higherRevisions.find(revision => revision.id === target.id) })),
  Object.freeze({ id: FOX_BODY_REVISION_ID, prefix: '/models/heroes-next/ranger-fox-', revision: FOX_BODY_REVISION }),
  Object.freeze({ id: RANGER_LIBRARY_REVISION_ID, prefix: '/models/heroes-next/ranger-', revision: RANGER_LIBRARY_REVISION }),
  Object.freeze({ id: ROGUE_LIBRARY_REVISION_ID, prefix: '/models/heroes-next/rogue-', revision: ROGUE_LIBRARY_REVISION }),
]);
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
 * Blender 로 전신 리타깃(궁수는 활 클립 포함)을 다시 저작한 1단계 몸체(궁수·도적). 원본 manifest 항목·원본 GLB 는 그대로 두고,
 * 같은 원본 SHA 에서 생성이 끝난 교정본만 대신 받는다. 2·3단계와 아바타는 이 1단계 클립을 공유한다.
 * @param {{id?: string, sha256?: string}|null} asset
 * @param {{id: string, asset: string, useInGame: boolean, status: string, source: {path: string, sha256: string}, output: {path: string, sha256: string|null}}|null} [revision=null]
 * @returns {string|null}
 */
export function revisedLibraryFile(asset, revision = null) {
  if (!asset) return null;
  const entry = revision ? LIBRARY_REVISIONS.find((e) => e.id === revision.id) : LIBRARY_REVISIONS.find((e) => e.revision.asset === asset.id);
  revision = revision || entry?.revision;
  if (!revision || asset.id !== revision.asset) return null;
  const higherTarget = HIGHER_BODY_TARGETS.find(target => target.id === revision.id);
  if (higherTarget) validateHigherBodyRevision(revision, higherTarget);
  if (!revision.useInGame) return null;
  if (!entry || revision.status !== 'GENERATED' || revision.source?.sha256 !== asset.sha256
    || !/^[a-f0-9]{64}$/.test(revision.output?.sha256 || '') || !String(revision.output?.path || '').startsWith(entry.prefix)
    || !String(revision.output.path).endsWith('.glb')) {
    throw new Error('Library revision requires the exact generated file for the shipped source');
  }
  return revision.output.path;
}

export const higherBodyRevisions = () => HIGHER_BODY_REVISIONS;
export const foxBodyRevision = () => FOX_BODY_REVISION;
export const rangerLibraryRevision = () => RANGER_LIBRARY_REVISION;
export const rogueLibraryRevision = () => ROGUE_LIBRARY_REVISION;

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
