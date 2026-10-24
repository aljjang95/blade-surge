import manifest from '../../asset-library/manifest.json';
import { LIBRARY_SCHEMA, triangleLimit, validateManifest as validateManifestShape } from '../../tools/asset-library/manifest.mjs';
import { monsterRosterEntry } from '../data/monster-roster.js';
import RANGER_LIBRARY_REVISION from '../data/ranger-library-revision-v6.json';
import ROGUE_LIBRARY_REVISION from '../data/rogue-library-revision-v2.json';
import FOX_BODY_REVISION from '../data/fox-body-revision-v1.json';
import HIGHER_BODY_REVISIONS_V1 from '../data/higher-body-revisions-v1.json';
import RANGER_T2_BODY_REVISION_V2 from '../data/ranger-t2-body-revision-v2.json';
import RANGER_T3_BODY_REVISION_V2 from '../data/ranger-t3-body-revision-v2.json';
import T4_BODY_REVISIONS_V1 from '../data/t4-body-revisions-v1.json';
import T5_AVATAR_BODY_REVISIONS_V1 from '../data/t5-avatar-body-revisions-v1.json';
import ANIM_PACKS from '../data/anim-packs-v1.json';

export { LIBRARY_SCHEMA, triangleLimit };
// v3: v2 저작(전신 rest 축 리타깃·실제 스킨 접지·활 사격·백스텝, art-src/ranger/author_ranger_library_v2.py)을 Blender 5.2.2 에서 다시 굽고
// 몸 재질 보정을 GLB 에 고정했다(tools/art/finish-library-materials.mjs).
// v4: 저작 v3(art-src/ranger/author_ranger_library_v3.py)가 사망 정착의 왼팔 IK 목표만 프레임별 실제 가슴 자세로 다시 풀어
// 실제 런타임 활이 바닥을 뚫던 결함(v3 사망 1.04초 -0.10m)을 고쳤다. 다른 클립·메시·재질 마감은 v3 와 같다.
// v5: '애꾸' 얼굴(앞머리가 한쪽 눈을 덮음)을 고치려 Tripo 로 몸을 다시 만들어 v4 골격에 묶고 몸 메시·재질·텍스처만 바꿨다.
// 골격·역바인드·클립 바이트는 v4 와 같다(clipSource.motionSignature). v4 를 클립 원본으로 기록한 저작 계약(hero-body-motion.js 의 base 비교,
// 2·3단계·여우 동작 JSON)은 v4 기록을 그대로 쓰고, rangerClipSource() 가 그 원본이 v4 임을 v5 기록에서 확인한다.
// v5 는 A→T 로 몸을 굽혀 땋은 머리·망토를 잃어 철회했다(#243).
// v6: 같은 Tripo 몸을 메시 변형 없이 싣는다(장식 가중치 정리 → v4 골격을 회전만으로 Tripo 뼈 방향에 맞춘 자세에서 역바인드 재계산,
// tools/art/rebind-library-body.mjs). 골격 노드·클립 바이트는 v4 와 같고 역바인드·활 소켓 위치만 다르다. 클립 원본은 v4 다.
// 게임은 v6 하나만 내려받는다. v1–v5 기록·파일은 그대로 둔다.
export const RANGER_LIBRARY_REVISION_ID = 'ranger-library-v6';
// 도적 1단계: 축 교정 클립(rogue-library-axis-v1, art-src/hero-axis/author_hero_axis_v1.py) 그대로 + 같은 재질 마감. axis-v1 기록·파일은 그대로 둔다.
export const ROGUE_LIBRARY_REVISION_ID = 'rogue-library-v2';
export const FOX_BODY_REVISION_ID = 'fox-body-fit-v1';
// 자산별 출력 이름을 코드에서 고정한다. 초안은 원본을 고르고 실제 생성·검증된 기록만 활성화한다.
const HIGHER_BODY_TARGETS = Object.freeze([
  // 2·3단계 궁수는 v2(앞머리를 가른 Tripo 몸 재결합, ranger-t{2,3}-body-revision-v2.json)가 v1 을 대신한다. v1 기록·파일은 이력으로 남는다.
  Object.freeze({ asset: 'hero_ranger_t2', id: 'ranger-t2-body-fit-v2', prefix: '/models/heroes-next/ranger-t2-body-fit-v2' }),
  Object.freeze({ asset: 'hero_ranger_t3', id: 'ranger-t3-body-fit-v2', prefix: '/models/heroes-next/ranger-t3-body-fit-v2' }),
  Object.freeze({ asset: 'hero_rogue_t2', id: 'rogue-t2-body-fit-v1', prefix: '/models/heroes-next/rogue-t2-body-fit-v1' }),
  Object.freeze({ asset: 'hero_rogue_t3', id: 'rogue-t3-body-fit-v1', prefix: '/models/heroes-next/rogue-t3-body-fit-v1' }),
  Object.freeze({ asset: 'avatar_rogue_crow', id: 'rogue-crow-body-fit-v1', prefix: '/models/heroes-next/rogue-crow-body-fit-v1' }),
]);
// 대신 쓰는 개정이 가리키는 이전 기록(이력). 이력 기록도 자기 고정 경로 계약을 그대로 지켜야 한다.
const HIGHER_BODY_HISTORY = Object.freeze([
  Object.freeze({ asset: 'hero_ranger_t2', id: 'ranger-t2-body-fit-v1', prefix: '/models/heroes-next/ranger-t2-body-fit-v1' }),
  Object.freeze({ asset: 'hero_ranger_t3', id: 'ranger-t3-body-fit-v1', prefix: '/models/heroes-next/ranger-t3-body-fit-v1' }),
]);
const HIGHER_BODY_SUPERSEDING = Object.freeze([RANGER_T2_BODY_REVISION_V2, RANGER_T3_BODY_REVISION_V2]);
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

/**
 * v1 번들 기록 위에 대신 쓰는 개정(supersedes)을 얹은 실제 사용 기록을 만든다. 원본 v1 JSON 은 바꾸지 않는다.
 * 대신 쓰는 개정은 같은 자산·같은 원본 SHA 의 이력 기록 하나를 정확히 가리켜야 하고, 이력 기록은 자기 고정 경로 계약을 지켜야 한다.
 */
export function supersedeHigherBodyRevisions(value, superseding = HIGHER_BODY_SUPERSEDING) {
  requireHigherBody(Array.isArray(value?.revisions) && Array.isArray(superseding));
  // 같은 이력 기록을 두 개정이 대신하면 뒤의 것이 조용히 무시되므로 거절한다.
  requireHigherBody(new Set(superseding.map(next => next?.supersedes)).size === superseding.length);
  for (const next of superseding) {
    const previous = value.revisions.filter(revision => revision?.id === next?.supersedes);
    const history = HIGHER_BODY_HISTORY.find(entry => entry.id === next?.supersedes);
    requireHigherBody(previous.length === 1 && history && next.id !== previous[0].id && next.asset === previous[0].asset
      && next.source?.path === previous[0].source?.path && next.source?.sha256 === previous[0].source?.sha256);
    validateHigherBodyRevision(previous[0], history);
  }
  return { ...value, revisions: value.revisions.map(revision => superseding.find(next => next.supersedes === revision?.id) || revision) };
}

const HIGHER_BODY_REVISIONS = Object.freeze(supersedeHigherBodyRevisions(HIGHER_BODY_REVISIONS_V1));
const higherRevisions = validateHigherBodyRevisions(HIGHER_BODY_REVISIONS);

// ---- 등급 몸(S 1.5 · U 2.5)의 heroes-next 교정본 ----
// 1단계 클립을 교정본(heroes-next)에서 받는 영웅(도적·궁수)은 등급 몸도 정규화본이 아니라 그 1단계 교정본 골격에 재결합한 몸을 쓴다
// (기사 등 다른 영웅의 S·U 몸은 정규화본 그대로). 다섯 기록 계약(higher-body-revisions-v1)은 바꾸지 않고 별도 기록·목표로 얹는다.
// 검사는 상위 몸체와 같다(원본 SHA = manifest, 고정 출력 경로, GENERATED 는 실제 SHA). 여기에 더해 재결합 base 가 그 영웅의
// 현재 1단계 클립 원본(경로·SHA)과 같아야 한다. 도적은 1단계 교정본 출력(v2)이 곧 클립 원본이다. 궁수 1단계 v6 은 몸만 바꾼 개정이라
// 출력의 역바인드가 바인드 자세가 아니어서(재결합 결과) 재결합 base 로 쓸 수 없고, 골격·클립 바이트가 같은 클립 원본(v4,
// rangerClipSource)에 재결합한다(궁수 2·3단계 v2 몸과 같은 base).
const T4_BODY_BASES = Object.freeze({
  rogue: Object.freeze({ path: ROGUE_LIBRARY_REVISION.output.path, sha256: ROGUE_LIBRARY_REVISION.output.sha256 }),
  ranger: Object.freeze((({ path, sha256 }) => ({ path, sha256 }))(rangerClipSource(RANGER_LIBRARY_REVISION))),
});
const T4_BODY_TARGETS = Object.freeze([
  Object.freeze({ asset: 'hero_rogue_t1s', id: 'rogue-t1s-body-fit-v1', prefix: '/models/heroes-next/rogue-t1s-body-fit-v1' }),
  Object.freeze({ asset: 'hero_rogue_t2u', id: 'rogue-t2u-body-fit-v1', prefix: '/models/heroes-next/rogue-t2u-body-fit-v1' }),
  Object.freeze({ asset: 'hero_ranger_t1s', id: 'ranger-t1s-body-fit-v1', prefix: '/models/heroes-next/ranger-t1s-body-fit-v1' }),
  Object.freeze({ asset: 'hero_ranger_t2u', id: 'ranger-t2u-body-fit-v1', prefix: '/models/heroes-next/ranger-t2u-body-fit-v1' }),
]);
/** 등급 몸 재결합 base(영웅별 1단계 클립 원본 경로·SHA). */
export const t4BodyBase = (heroId) => T4_BODY_BASES[heroId] || null;

function validateT4BodyRevision(revision, target) {
  validateHigherBodyRevision(revision, target);
  const heroId = manifest.assets.find(asset => asset.id === target.asset)?.heroId, base = T4_BODY_BASES[heroId];
  requireHigherBody(base && revision.authoring?.kind === 'body-rebind'
    && revision.authoring.base?.path === base.path && revision.authoring.base.sha256 === base.sha256);
  return revision;
}

// 기록 묶음(schema)이 목표와 일대일인지 검사한다(등급 몸 t4 와 할로윈 아바타 t5 공통).
function validateRebindRevisionSet(value, schema, targets) {
  requireHigherBody(value?.schema === schema && Array.isArray(value.revisions) && value.revisions.length === targets.length);
  requireHigherBody(new Set(value.revisions.map(revision => revision?.id)).size === targets.length
    && new Set(value.revisions.map(revision => revision?.asset)).size === targets.length
    && new Set(value.revisions.map(revision => revision?.output?.path)).size === targets.length);
  return value.revisions.map(revision => {
    const target = targets.find(entry => entry.id === revision?.id);
    requireHigherBody(target);
    return validateT4BodyRevision(revision, target);
  });
}

/** 등급 몸 교정 기록이 목표와 일대일인지 번들 로드 시 검사한다. */
export function validateT4BodyRevisions(value) {
  return validateRebindRevisionSet(value, 'blade-surge.t4-body-revisions.v1', T4_BODY_TARGETS);
}

// ---- 할로윈 아바타(t5) 중 도적·궁수의 heroes-next 교정 몸 ----
// 1차 까마귀·여우처럼 정규화본(asset-library/normalized)은 manifest 원본으로 남고, 게임은 그 영웅의 1단계 클립 원본(T4_BODY_BASES:
// 도적 rogue-library-t1-v2, 궁수 v4 = rangerClipSource)에 재결합한 몸을 받는다. 다섯 기록(higher-body-revisions-v1)·등급 몸 네 기록
// (t4-body-revisions-v1) 계약은 그대로 두고, 같은 검사(원본 SHA = manifest, 고정 출력 경로, GENERATED 실제 SHA, 재결합 base = 1단계
// 클립 원본)를 별도 기록·목표로 얹는다.
const T5_AVATAR_BODY_TARGETS = Object.freeze([
  Object.freeze({ asset: 'avatar_rogue_vampire', id: 'rogue-vampire-body-fit-v1', prefix: '/models/heroes-next/rogue-vampire-body-fit-v1' }),
]);

/** 할로윈 아바타(t5) 교정 기록이 목표와 일대일인지 번들 로드 시 검사한다. */
export function validateT5AvatarBodyRevisions(value) {
  return validateRebindRevisionSet(value, 'blade-surge.t5-avatar-body-revisions.v1', T5_AVATAR_BODY_TARGETS);
}

const T4_BODY_REVISIONS = Object.freeze(T4_BODY_REVISIONS_V1);
const t4Revisions = validateT4BodyRevisions(T4_BODY_REVISIONS);
const T5_AVATAR_BODY_REVISIONS = Object.freeze(T5_AVATAR_BODY_REVISIONS_V1);
const t5Revisions = validateT5AvatarBodyRevisions(T5_AVATAR_BODY_REVISIONS);
const LIBRARY_REVISIONS = Object.freeze([
  ...HIGHER_BODY_TARGETS.map(target => Object.freeze({ ...target, revision: higherRevisions.find(revision => revision.id === target.id) })),
  ...T4_BODY_TARGETS.map(target => Object.freeze({ ...target, revision: t4Revisions.find(revision => revision.id === target.id) })),
  ...T5_AVATAR_BODY_TARGETS.map(target => Object.freeze({ ...target, revision: t5Revisions.find(revision => revision.id === target.id) })),
  Object.freeze({ id: FOX_BODY_REVISION_ID, prefix: '/models/heroes-next/ranger-fox-', revision: FOX_BODY_REVISION }),
  Object.freeze({ id: RANGER_LIBRARY_REVISION_ID, prefix: '/models/heroes-next/ranger-', revision: RANGER_LIBRARY_REVISION }),
  Object.freeze({ id: ROGUE_LIBRARY_REVISION_ID, prefix: '/models/heroes-next/rogue-', revision: ROGUE_LIBRARY_REVISION }),
]);
let bundledFiles = {};
try {
  // 아래 원본들은 useInGame 교정본(heroes-next)이 대신 로드되어 번들 URL 이 쓰이지 않는다(revisedLibraryFile 이 항상 교정 경로를 돌려줌).
  // 전달 크기를 위해 빌드 산출물에서 뺀다. 원본 파일·해시 계약은 asset-library/normalized 에 그대로 있다(test/library-bundle-exclusions.test.ts 가 검증).
  bundledFiles = import.meta.glob([
    '../../asset-library/normalized/*.glb',
    '!../../asset-library/normalized/hero_ranger_t1.glb', '!../../asset-library/normalized/hero_ranger_t2.glb', '!../../asset-library/normalized/hero_ranger_t3.glb',
    '!../../asset-library/normalized/hero_rogue_t1.glb', '!../../asset-library/normalized/hero_rogue_t2.glb', '!../../asset-library/normalized/hero_rogue_t3.glb',
    '!../../asset-library/normalized/avatar_ranger_fox.glb', '!../../asset-library/normalized/avatar_rogue_crow.glb',
    '!../../asset-library/normalized/hero_rogue_t1s.glb', '!../../asset-library/normalized/hero_rogue_t2u.glb',
    '!../../asset-library/normalized/hero_ranger_t1s.glb', '!../../asset-library/normalized/hero_ranger_t2u.glb',
    '!../../asset-library/normalized/avatar_rogue_vampire.glb',
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
  const t4Target = T4_BODY_TARGETS.find(target => target.id === revision.id) || T5_AVATAR_BODY_TARGETS.find(target => target.id === revision.id);
  if (t4Target) validateT4BodyRevision(revision, t4Target);
  if (!revision.useInGame) return null;
  if (!entry || revision.status !== 'GENERATED' || revision.source?.sha256 !== asset.sha256
    || !/^[a-f0-9]{64}$/.test(revision.output?.sha256 || '') || !String(revision.output?.path || '').startsWith(entry.prefix)
    || !String(revision.output.path).endsWith('.glb')) {
    throw new Error('Library revision requires the exact generated file for the shipped source');
  }
  return revision.output.path;
}

/** 게임이 쓰는 상위 몸체 기록(v1 번들 + 대신 쓰는 개정). */
export const higherBodyRevisions = () => HIGHER_BODY_REVISIONS;
/** 대신 쓰는 개정에 밀려난 이력 기록(게임이 고르지 않는다). */
export const higherBodyRevisionHistory = () => HIGHER_BODY_REVISIONS_V1.revisions.filter(revision => HIGHER_BODY_SUPERSEDING.some(next => next.supersedes === revision.id));
/** 게임이 쓰는 등급 몸(S·U) 교정 기록. */
export const t4BodyRevisions = () => T4_BODY_REVISIONS;
/** 게임이 쓰는 할로윈 아바타(t5) 도적·궁수 교정 기록. */
export const t5AvatarBodyRevisions = () => T5_AVATAR_BODY_REVISIONS;
/** 회피·사망 띠 곡선을 받을 수 있는 1단계 클립 원본 재결합 몸 기록(등급 몸 t4 + 할로윈 아바타 t5). */
export const tierRebindBodyRevisions = () => [...T4_BODY_REVISIONS.revisions, ...T5_AVATAR_BODY_REVISIONS.revisions];
export const foxBodyRevision = () => FOX_BODY_REVISION;
export const rangerLibraryRevision = () => RANGER_LIBRARY_REVISION;
/**
 * 궁수 1단계 클립의 원본 GLB 기록. 몸만 바꾼 개정(v6)은 클립 바이트가 같은 이전 개정(v4)을 클립 원본으로 남기고,
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
    assetForHero(heroId, /** @type {HeroBodyRequest} */ tier = 1) { return selectHeroLibraryAsset(value, heroId, tier); },
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

/** @typedef {number | { tier: number, theme?: string | null }} HeroBodyRequest */

/**
 * requested 는 단계 숫자 또는 heroAppearance() 의 { tier, theme }. 테마 몸은 세트가 같을 때만 후보가 된다.
 * @param {any[]} assets @param {HeroBodyRequest} [requested]
 */
export function pickHeroLibraryAsset(assets, requested = 1) {
  const { tier: raw, theme = null } = requested && typeof requested === 'object' ? requested : { tier: requested };
  const tier = Math.min(3, Math.max(1, Number(raw) || 1));
  return [...assets].sort((a, b) => (b.armorTier || 1) - (a.armorTier || 1))
    .find((asset) => (asset.armorTier || 1) <= tier && (!asset.armorTheme || asset.armorTheme === theme)) || null;
}

/** @param {any} value @param {string} heroId @param {HeroBodyRequest} [requested] */
export function selectHeroLibraryAsset(value, heroId, requested = 1) {
  return pickHeroLibraryAsset(heroLibraryAssets(value, heroId), requested);
}
