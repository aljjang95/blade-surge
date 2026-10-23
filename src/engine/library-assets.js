import manifest from '../../asset-library/manifest.json';
import { LIBRARY_SCHEMA, triangleLimit, validateManifest as validateManifestShape } from '../../tools/asset-library/manifest.mjs';
import { monsterRosterEntry } from '../data/monster-roster.js';
import RANGER_LIBRARY_REVISION from '../data/ranger-library-revision-v5.json';
import ROGUE_LIBRARY_REVISION from '../data/rogue-library-revision-v2.json';
import FOX_BODY_REVISION from '../data/fox-body-revision-v1.json';
import HIGHER_BODY_REVISIONS from '../data/higher-body-revisions-v1.json';
import ANIM_PACKS from '../data/anim-packs-v1.json';

export { LIBRARY_SCHEMA, triangleLimit };
// v3: v2 저작(전신 rest 축 리타깃·실제 스킨 접지·활 사격·백스텝, art-src/ranger/author_ranger_library_v2.py)을 Blender 5.2.2 에서 다시 굽고
// 몸 재질 보정을 GLB 에 고정했다(tools/art/finish-library-materials.mjs).
// v4: 저작 v3(art-src/ranger/author_ranger_library_v3.py)가 사망 정착의 왼팔 IK 목표만 프레임별 실제 가슴 자세로 다시 풀어
// 실제 런타임 활이 바닥을 뚫던 결함(v3 사망 1.04초 -0.10m)을 고쳤다. 다른 클립·메시·재질 마감은 v3 와 같다.
// v5: '애꾸' 얼굴(앞머리가 한쪽 눈을 덮음)을 고치려 Tripo 로 몸을 다시 만들어 v4 골격에 묶고 몸 메시·재질·텍스처만 바꿨다.
// 골격·역바인드·클립 바이트는 v4 와 같다(clipSource.motionSignature). v4 를 클립 원본으로 기록한 저작 계약(hero-body-motion.js 의 base 비교,
// 2·3단계·여우 동작 JSON)은 v4 기록을 그대로 쓰고, rangerClipSource() 가 그 원본이 v4 임을 v5 기록에서 확인한다.
// 게임은 v5 하나만 내려받는다. v1–v4 기록·파일은 그대로 둔다.
export const RANGER_LIBRARY_REVISION_ID = 'ranger-library-v5';
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
  // 아래 여덟 원본은 useInGame 교정본(heroes-next)이 대신 로드되어 번들 URL 이 쓰이지 않는다(revisedLibraryFile 이 항상 교정 경로를 돌려줌).
  // 전달 크기를 위해 빌드 산출물에서 뺀다. 원본 파일·해시 계약은 asset-library/normalized 에 그대로 있다(test/library-bundle-exclusions.test.ts 가 검증).
  bundledFiles = import.meta.glob([
    '../../asset-library/normalized/*.glb',
    '!../../asset-library/normalized/hero_ranger_t1.glb', '!../../asset-library/normalized/hero_ranger_t2.glb', '!../../asset-library/normalized/hero_ranger_t3.glb',
    '!../../asset-library/normalized/hero_rogue_t1.glb', '!../../asset-library/normalized/hero_rogue_t2.glb', '!../../asset-library/normalized/hero_rogue_t3.glb',
    '!../../asset-library/normalized/avatar_ranger_fox.glb', '!../../asset-library/normalized/avatar_rogue_crow.glb',
  ], { eager: true, query: '?url', import: 'default' });
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
/**
 * 궁수 1단계 클립의 원본 GLB 기록. 몸만 바꾼 개정(v5)은 동작 서명이 같은 이전 개정(v4)을 클립 원본으로 남기고,
 * 그렇지 않은 개정은 자기 출력이 곧 클립 원본이다. 경로는 기록일 뿐 게임이 내려받지 않는다.
 * @returns {{revision: string, path: string, sha256: string}}
 */
export function rangerClipSource(revision = RANGER_LIBRARY_REVISION) {
  const source = revision.clipSource;
  if (!source) return { revision: revision.id, path: revision.output.path, sha256: revision.output.sha256 };
  if (source.revision !== revision.supersedes || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !/^[a-f0-9]{64}$/.test(source.motionSignature || '')
    || !/^\/models\/heroes-next\/ranger-library-t1-v\d+\.glb$/.test(source.path || '') || source.path === revision.output.path) {
    throw new Error('Ranger clip source must be the superseded revision with a recorded motion signature');
  }
  return { revision: source.revision, path: source.path, sha256: source.sha256 };
}
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

// ---- 애니메이션 팩(h4-anim) ----
// tools/blender/build-anim-packs.mjs 가 원본 GLB 에서 절차적으로 만든 새 클립(뼈대 전용 GLB). 원본 파일·해시 계약은 그대로 두고
// 원본을 읽은 뒤 팩의 클립만 덧붙인다. 팩이 만들어진 원본 SHA 가 지금 게임이 읽는 원본과 다르면 붙이지 않는다(오래된 팩 방지).
const ANIM_PACK_BY_ASSET = new Map((ANIM_PACKS.packs || []).map((pack) => [pack.asset, pack]));
export const animPacks = () => ANIM_PACKS;
export function animPackFor(assetId) { return ANIM_PACK_BY_ASSET.get(assetId) || null; }

/** 게임이 이 자산에 대해 실제로 읽는 원본(교정본 포함)의 SHA. */
export function shippedSourceSha(asset) {
  const entry = LIBRARY_REVISIONS.find((e) => e.revision.asset === asset?.id);
  if (entry?.revision?.useInGame && entry.revision.status === 'GENERATED') return entry.revision.output.sha256;
  return asset?.sha256 || null;
}

/** 팩 클립을 원본 glTF 의 animations 끝에 덧붙인다. 같은 이름 클립은 원본을 우선한다. 덧붙인 이름 목록을 돌려준다. */
export function mergeAnimPack(gltf, pack, packGltf) {
  const names = new Set(gltf.animations.map((clip) => clip.name)), added = [];
  for (const clip of packGltf?.animations || []) {
    if (!Object.hasOwn(pack.clips, clip.name) || names.has(clip.name)) continue;
    gltf.animations.push(clip); names.add(clip.name); added.push(clip.name);
  }
  return added;
}

export function attachAnimPack(gltf, asset, load, warn) {
  const pack = animPackFor(asset.id);
  if (!pack) return gltf;
  if (pack.source?.sha256 !== shippedSourceSha(asset)) { warn(`anim pack skipped (source changed): ${asset.id}`); return gltf; }
  return Promise.resolve().then(() => load(pack.path)).then((packGltf) => {
    // 병합 중 예외도 팩만 버리고 원본 클립으로 계속한다(몸체 전체가 대체 경로로 떨어지지 않게). 덧붙이던 클립은 되돌린다.
    const count = gltf.animations.length;
    try { gltf.scene.userData.animPack = { asset: pack.asset, clips: mergeAnimPack(gltf, pack, packGltf) }; }
    catch (error) { gltf.animations.length = count; warn(`anim pack merge failed, using source clips only: ${asset.id}`, error); }
    return gltf;
  }, (error) => { warn(`anim pack failed, using source clips only: ${asset.id}`, error); return gltf; });
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
      let promise;
      promise = Promise.resolve().then(() => load(resolveAssetSource(asset))).then((gltf) => attachAnimPack(gltf, asset, load, warn)).then((gltf) => {
        validateLibraryModel(gltf, asset);
        gltf.scene.userData.libraryAsset = asset;
        gltf.scene.traverse((node) => {
          if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.userData.tllAuthored = true;
        });
        return prepareAsset(gltf, asset);
      }).catch((error) => {
        warn(`library asset failed, using configured library fallback: ${asset.id}`, error);
        // 폴백까지 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
        const result = Promise.resolve().then(fallback).catch((fallbackError) => { cache.delete(asset.id); throw fallbackError; });
        // 스트리밍 자산을 받지 못한 일시 실패(오프라인 등)는 이번 폴백만 쓰고 결과를 캐시에 남기지 않아 다음 요청에서 다시 받는다.
        if (error?.remoteAssetUnavailable) result.finally(() => { if (cache.get(asset.id) === promise) cache.delete(asset.id); }).catch(() => {});
        return result;
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
