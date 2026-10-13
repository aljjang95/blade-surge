import * as THREE from 'three';
import { preloadArmory } from './armory-assets.js';
import { forgeHeroWeapons } from './forged-weapons.js';
import { finishOathKnightMaterial } from './hero-surface-finish.js';
import { heroModelPaths, KNIGHT_HEAD_BALANCE_REVISION_ID } from './hero-model-paths.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEROES } from '../data/heroes.js';
import { assembleHeroIdentity } from './hero-identity.js';
import { assembleEncounterIdentity } from './encounter-identity.js';
import { ENCOUNTER_MODELS } from '../data/encounter-models.js';
import { preloadSurfaceTextures, projectSurfaceUV, surfaceRole, applySurfaceDetail } from './surface-textures.js';
import { preloadDungeonSurface } from '../game/dungeon-surface.js';
import { libraryAssets, createDefaultLibraryLoader } from './library-assets.js';
import { heroIdForModel, heroModelContract, heroHandBones, heroGripRotation, librarySocketScale, resolveSharedHeroClips, LIBRARY_SOCKET_NAMES } from '../data/hero-library.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();
const libraryLoader = createDefaultLibraryLoader((path) => loader.loadAsync(path), (gltf) => prepareModel(gltf));
/** @typedef {{materials: string, role: string, heroId?: string, scale: number, aliases: Record<string, string>, sockets?: Record<string, string>}} ModelContract */

export function requiredModelAliases(role, heroId) {
  if (role === 'companion') return ['Idle', 'Idle_Combat', 'Running_A', 'Spellcast_Raise', 'Spellcast_Shoot', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B'];
  const hero = role === 'hero' && HEROES[heroId];
  if (!hero) throw new Error('invalid model role');
  return [...new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', 'Cheer', 'Interact',
    ...hero.combo.map((step) => step.anim), ...hero.skills.map((skill) => skill.anim), ...(heroId === 'mage' ? ['Spellcasting'] : [])])];
}

export const HERO_MODELS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Ranger'];
export const MONSTER_MODELS = [
  'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage',
  'Big_Orc', 'Big_Orc_Skull', 'Big_Demon', 'Big_BlueDemon', 'Big_Yeti', 'Big_MushroomKing',
  'Big_Tribal', 'Big_Cactoro', 'Big_Alien', 'Big_Ninja',
  'Blob_GreenBlob', 'Blob_PinkBlob', 'Blob_GreenSpikyBlob', 'Blob_Mushnub', 'Blob_Mushnub_Evolved', 'Blob_Orc',
  'Flying_Ghost', 'Flying_Ghost_Skull', 'Flying_Dragon', 'Flying_Dragon_Evolved',
  'Flying_Armabee', 'Flying_Armabee_Evolved', 'Flying_Hywirl', 'Flying_Squidle', 'Flying_Glub', 'Flying_Goleling_Evolved',
];
// 영웅 갑옷 단계 GLB 는 영웅 모델 이름과 장비 교체 경로에서만 받는다(부팅 시 전 단계 선로딩 금지).
export const MODEL_LIST = [...HERO_MODELS, ...MONSTER_MODELS, ...Object.keys(ENCOUNTER_MODELS),
  ...libraryAssets().filter((asset) => asset.role !== 'hero').map((asset) => asset.id), 'dungeon', 'tllDungeonLandmarks', 'skel_weapons'];
const SPECIAL_MODELS = Object.freeze({ tllDungeonLandmarks: '/models/tll/dungeons/dungeon-landmarks-v1.glb',
  tllCoolingValve: '/models/tll/props/cooling-valve-v1.glb',
  tllNightglassRecord: '/models/tll/props/nightglass-record-v1.glb' });

/** @param {string} name @param {ModelContract|null} contract */
export async function loadModel(name, contract = null, allowLibrary = true) {
  const heroId = !contract && allowLibrary ? heroIdForModel(name) : null;
  if (heroId && libraryLoader.assetForHero(heroId, 1)) return loadHeroModel(heroId, 1);
  const libraryAsset = !contract && allowLibrary && !heroId ? libraryLoader.assetFor(name) : null;
  if (libraryAsset?.role === 'hero') return libraryAsset.avatar ? loadHeroAsset(libraryAsset) : loadHeroModel(libraryAsset.heroId, libraryAsset.armorTier || 1);
  const key = name + '|' + JSON.stringify(contract) + '|' + (libraryAsset?.id || 'legacy');
  if (cache.has(key)) return cache.get(key);
  if (libraryAsset) {
    const p = libraryLoader.load(libraryAsset, () => {
      // 교체 대상이 기본 몬스터든 변형(encounter) 몬스터든 원래 모델로 되돌린다.
      if (libraryAsset.kind === 'character' && libraryAsset.replaces) return loadModel(libraryAsset.replaces, contract, false);
      return { scene: new THREE.Group(), animations: [] };
    });
    cache.set(key, p);
    try { return await p; } catch (error) { cache.delete(key); throw error; }
  }
  const variant = !contract && ENCOUNTER_MODELS[name];
  const heroPaths = !contract && HERO_MODELS.includes(name) ? heroModelPaths(name) : null;
  // 변형 장식은 KayKit 본에 붙으므로 베이스는 라이브러리 교체 없이 원본 리그를 쓴다.
  const p = (variant ? Promise.all([loadModel(variant.base, null, false), loader.loadAsync(`/models/tll/encounters/${variant.file}.glb`)]).then(([base, authored]) => {
    // Skeleton clone keeps the cached original unchanged. Immutable base buffers/textures are shared.
    return assembleEncounterIdentity({ scene: skeletonClone(base.scene), animations: base.animations }, authored, name, variant);
  }) : loader.loadAsync(heroPaths?.base || SPECIAL_MODELS[name] || `/models/${name}.glb`)).then(async (gltf) => {
    if (!contract && name === 'Ranger') {
      // Silva ships as one Blender-authored skin on the same KayKit medium rig.
      gltf.scene.userData.tllIdentity = 'casual-v2';
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.name.startsWith('TLL_')) for (const m of materialsOf(o)) m.userData.tllAuthored = true;
      });
      const fitting = await loader.loadAsync('/models/heroes-v3/ranger-v3.glb').catch(() => null);
      if (fitting) assembleHeroIdentity(gltf, fitting, name, 'expedition-v3');
      else gltf.scene.userData.identityFallback = 'ranger-casual-v2';
    } else if (!contract && HERO_MODELS.includes(name)) {
      let style = 'expedition-v3';
      const authored = await loader.loadAsync(heroPaths?.fitting || `/models/heroes-v3/${name.toLowerCase()}-v3.glb`).catch(async (error) => {
        if (heroPaths?.proportionRevision === KNIGHT_HEAD_BALANCE_REVISION_ID) throw error;
        style = 'casual-v2';
        gltf.scene.userData.identityFallback = style;
        return loader.loadAsync(`/models/tll/${name.toLowerCase()}-casual-v2.glb`);
      });
      assembleHeroIdentity(gltf, authored, name, style);
    }
    if (name === 'tllCoolingValve' || name === 'tllNightglassRecord') gltf.scene.traverse(o => {
      if (o.isMesh) for (const m of materialsOf(o)) {
        m.userData.tllAuthored = true;
        if (/iron|brass/i.test(m.name)) {
          applySurfaceDetail(m, 'metal');
          // This room has a warm key, not the bright lobby environment. Keep
          // authored albedo/roughness while reusing the GUI metal bump detail.
          m.map = null; m.roughnessMap = null;
        }
      }
    });
    if (!contract && HERO_MODELS.includes(name)) await forgeHeroWeapons(gltf, name);
    return prepareModel(gltf, contract);
  });
  cache.set(key, p);
  try { return await p; } catch (error) { cache.delete(key); throw error; }
}

// ---------- 라이브러리 영웅(갑옷 3단계) ----------
const heroClipCache = new Map();
const heroBodies = new Map();

/** 요청 단계 이하의 가장 높은 영웅 GLB 를 받는다. 없거나 실패하면 기존 KayKit 영웅으로 폴백한다. */
export function loadHeroModel(heroId, tier = 1) {
  const hero = HEROES[heroId];
  if (!hero) return Promise.reject(new Error(`invalid hero id: ${heroId}`));
  const asset = libraryLoader.assetForHero(heroId, tier);
  if (!asset) return loadModel(hero.model, null, false);
  return loadHeroAsset(asset);
}

/** 아바타 몸체를 미리 받아 둔다. 렌더 준비 중 비동기 몸체 교체로 재질이 바뀌지 않게 Player 생성 전에 기다린다. */
export function preloadAvatarBody(avatarId) {
  const asset = avatarId ? libraryLoader.assetForAvatar(avatarId) : null;
  return preloadLibraryBody(asset);
}

/**
 * 전투 영웅이 실제로 입을 몸체(아바타 → 갑옷 단계)를 Player 생성 전에 받아 둔다.
 * 받지 않은 2·3단계 몸체가 렌더 준비 도중 비동기로 교체되면 준비가 "cached material ... replaced"로 실패해 출격이 막혔다.
 */
export function preloadHeroBody(heroId, tier = 1, avatarId = null) {
  const avatar = avatarId ? libraryLoader.assetForAvatar(avatarId) : null;
  return preloadLibraryBody(avatar || libraryLoader.assetForHero(heroId, tier));
}

function preloadLibraryBody(asset) {
  if (!asset) return Promise.resolve(false);
  return loadHeroAsset(asset).then((gltf) => gltf.scene.userData.libraryAsset?.id === asset.id, (error) => { console.warn('hero body preload failed: ' + asset.id, error); return false; });
}

export function loadHeroAsset(asset) {
  if (asset?.role !== 'hero' || !asset.heroId || !HEROES[asset.heroId]) return Promise.reject(new Error('invalid hero asset'));
  return libraryLoader.load(asset, () => loadModel(HEROES[asset.heroId].model, null, false), (gltf, entry) => prepareLibraryHero(gltf, entry));
}

async function prepareLibraryHero(gltf, asset) {
  const heroId = asset.heroId, hero = HEROES[heroId];
  if (!gltf.animations.length && !heroClipCache.has(heroId)) {
    // 메시만 있는 단계는 클립을 가진 가장 낮은 단계를 먼저 받아 같은 클립을 쓴다.
    const source = libraryLoader.heroAssets(heroId).find((entry) => entry.id !== asset.id && Object.keys(entry.clips).length);
    if (source) await loadHeroModel(heroId, source.armorTier || 1);
  }
  const { animations, clipAsset } = resolveSharedHeroClips(heroClipCache, heroId, asset, gltf.animations);
  gltf.animations = animations;
  const handBones = heroHandBones(gltf.scene);
  const legacy = await loader.loadAsync(heroModelPaths(hero.model).base);
  attachLegacyWeapons(gltf.scene, legacy.scene, heroId, handBones);
  gltf.scene.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    for (const material of materialsOf(node)) normalizeLibrarySkinMaterial(material);
    node.userData.libraryBody = asset.armorTier || 1;
    // 병기고 장식은 TLL_ 스킨에만 붙는다.
    if (!node.name.startsWith('TLL_')) node.name = `TLL_Library_${heroId}`;
  });
  await forgeHeroWeapons(gltf, hero.model);
  prepareModel(gltf, heroModelContract(asset, gltf.scene, clipAsset));
  heroBodies.set(asset.id, gltf);
  return gltf;
}

/**
 * Tripo PBR 몸체는 금속도 1·반투명 블렌드로 나온다. 이 게임에는 금속이 비출 환경 맵이 없어 금속 부위가 검게 뭉개지고,
 * 반투명 정렬 때문에 몸 일부가 비쳐 보였다(2026-10-13 대표님 '뿌옇다·어둡다' 제보). 금속 지도는 살리고 세기만 낮춘다.
 */
export const LIBRARY_SKIN_METALNESS_MAX = 0.22;
export function normalizeLibrarySkinMaterial(material) {
  if (!material || material.userData.librarySkinFinish) return material;
  if (material.metalness > LIBRARY_SKIN_METALNESS_MAX) material.metalness = LIBRARY_SKIN_METALNESS_MAX;
  if (material.transparent && material.opacity >= 1) {
    // 머리카락 끝 같은 알파 가장자리는 잘라 내고 몸 전체는 불투명으로 그린다.
    material.transparent = false; material.depthWrite = true; material.alphaTest = Math.max(material.alphaTest || 0, .5);
  }
  material.userData.librarySkinFinish = true; material.needsUpdate = true;
  return material;
}

/**
 * 라이브러리 손 소켓을 KayKit handslot 과 같은 자리·방향에 둔다. 두 모델 모두 정지(T) 자세에서 정면이 +Z 이므로,
 * KayKit handslot 의 월드 방향과 손목→handslot 거리(키 비율로 환산)를 라이브러리 손 본의 로컬 값으로 옮긴다.
 * 예전에는 모든 리그에 같은 회전 상수(Z±90°)를 쓰고 소켓을 손목에 붙여, 리그마다 손 본 축이 다른 Tripo 리그(도적·레인저·마법사)에서
 * 무기가 머리 위로 눕거나 손목에 매달려 보였다(2026-10-13 대표님 제보).
 */
export function fitLibrarySocket(socket, bone, slot, slotHand, heightRatio) {
  const boneQuat = bone.getWorldQuaternion(new THREE.Quaternion()), slotQuat = slot.getWorldQuaternion(new THREE.Quaternion());
  socket.quaternion.copy(boneQuat.invert().multiply(slotQuat));
  const reach = slot.getWorldPosition(new THREE.Vector3()).sub(slotHand.getWorldPosition(new THREE.Vector3())).multiplyScalar(heightRatio);
  const target = bone.getWorldPosition(new THREE.Vector3()).add(reach);
  socket.position.copy(bone.worldToLocal(target));
  return socket;
}

/** KayKit handslot 의 무기·방패 노드를 축 보정 소켓 아래로 옮긴다. 기존 단조 무기·장비 표시가 그대로 동작한다. */
function attachLegacyWeapons(scene, legacyScene, heroId, handBones) {
  scene.updateMatrixWorld(true);
  legacyScene.updateMatrixWorld(true);
  const scale = new THREE.Vector3(), position = new THREE.Vector3();
  for (const side of ['r', 'l']) {
    const bone = scene.getObjectByName(handBones[side]);
    const slot = legacyScene.getObjectByName(`handslot${side}`) || legacyScene.getObjectByName(`handslot.${side}`);
    if (!bone || !slot) throw new Error(`hero weapon socket missing: ${heroId}:${side}`);
    const socket = new THREE.Group(); socket.name = LIBRARY_SOCKET_NAMES[`handslot.${side}`];
    bone.getWorldScale(scale); bone.getWorldPosition(position);
    socket.scale.setScalar(librarySocketScale(scale.x, position.y));
    const slotHand = slot.parent;
    const heightRatio = position.y / Math.max(1e-6, slotHand.getWorldPosition(new THREE.Vector3()).y);
    if (slotHand) fitLibrarySocket(socket, bone, slot, slotHand, heightRatio);
    else socket.rotation.fromArray(heroGripRotation(heroId, side));
    bone.add(socket);
    for (const child of [...slot.children]) socket.add(child.clone(true));
  }
}

/**
 * 장비 갑옷 단계에 맞는 몸체로 같은 인스턴스 안에서 교체한다. 믹서·클립·무기 소켓은 그대로 둔다.
 * 캐시된 몸체면 즉시 교체해 true, 비동기 로드가 필요하면 false 를 돌려주고 완료 시 onAsyncSwap 을 부른다.
 */
export function applyLibraryHeroTier(root, tier, onAsyncSwap = null) {
  const contract = root.userData.authoredContract;
  if (contract?.role !== 'hero') return false;
  const target = libraryLoader.assetForHero(contract.heroId, tier);
  return applyLibraryHeroBody(root, target, onAsyncSwap);
}

/** 아바타와 갑옷 단계가 공유하는 영웅 몸체 교체 경로. 골격이 맞지 않으면 기존 몸체를 유지한다. */
export function applyLibraryHeroBody(root, target, onAsyncSwap = null) {
  const contract = root.userData.authoredContract;
  if (contract?.role !== 'hero' || !target || target.role !== 'hero') return false;
  const current = root.userData.libraryBodyAssetId;
  if (!target || !current || target.id === current) { root.userData.libraryTargetId = current; return false; }
  root.userData.libraryTargetId = target.id;
  const ready = heroBodies.get(target.id);
  if (ready) return swapLibraryHeroBody(root, ready, target);
  loadHeroAsset(target).then((gltf) => {
    // 폴백(KayKit) 결과나 그 사이 바뀐 요청·해제된 인스턴스는 교체하지 않는다.
    if (gltf.scene.userData.libraryAsset?.id !== target.id || root.userData.libraryDisposed || root.userData.libraryTargetId !== target.id) return;
    if (swapLibraryHeroBody(root, gltf, target)) onAsyncSwap?.();
  }).catch((error) => console.warn(`hero body failed: ${target.id}`, error));
  return false;
}

function swapLibraryHeroBody(root, gltf, target) {
  const sources = [], old = [], built = [];
  gltf.scene.traverse((node) => { if (node.isSkinnedMesh && node.userData.libraryBody) sources.push(node); });
  root.traverse((node) => { if (node.isSkinnedMesh && node.userData.libraryBody) old.push(node); });
  if (!sources.length || !old.length) return false;
  const release = (mesh) => { mesh.skeleton.dispose(); for (const material of materialsOf(mesh)) material.dispose(); };
  for (const source of sources) {
    const bones = source.skeleton.bones.map((bone) => root.getObjectByName(bone.name));
    if (bones.some((bone) => !bone?.isBone)) { for (const entry of built) release(entry.mesh); return false; }   // 같은 스켈레톤이 아니면 유지
    const material = Array.isArray(source.material) ? source.material.map((m) => cloneCharacterMaterial(m, true)) : cloneCharacterMaterial(source.material, true);
    const mesh = new THREE.SkinnedMesh(source.geometry, material);
    mesh.name = source.name; mesh.userData.libraryBody = source.userData.libraryBody;
    mesh.position.copy(source.position); mesh.quaternion.copy(source.quaternion); mesh.scale.copy(source.scale);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.bindMode = source.bindMode;
    mesh.bind(new THREE.Skeleton(bones, source.skeleton.boneInverses.map((matrix) => matrix.clone())), source.bindMatrix);
    built.push({ mesh, parent: (source.parent && root.getObjectByName(source.parent.name)) || old[0].parent });
  }
  for (const { mesh, parent } of built) parent.add(mesh);
  for (const mesh of old) { mesh.removeFromParent(); release(mesh); }
  root.userData.libraryBodyAssetId = target.id; root.userData.libraryHeroTier = target.armorTier || 1;
  return true;
}

export const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);

/** 전용 모델의 PBR·스킨 구조를 보존하며 필수 클립·소켓은 생성 전에 확인한다. */
/** @param {{scene: THREE.Group, animations: THREE.AnimationClip[]}} gltf @param {ModelContract|null} contract */
export function prepareModel(gltf, contract = null) {
  if (contract) {
    if (contract.materials !== 'authored' || !contract.aliases || !Number.isFinite(contract.scale) || contract.scale <= 0) throw new Error('invalid model contract');
    for (const alias of requiredModelAliases(contract.role, contract.heroId)) {
      if (!Object.hasOwn(contract.aliases, alias)) throw new Error(`missing required animation alias: ${alias}`);
    }
    if (contract.role === 'hero' && !contract.sockets?.['handslot.r']) throw new Error('missing required socket: handslot.r');
    const names = new Set(gltf.animations.map((clip) => clip.name));
    for (const [alias, name] of Object.entries(contract.aliases)) {
      if (!alias || !names.has(name)) throw new Error(`missing authored animation: ${alias}`);
    }
    for (const name of Object.values(contract.sockets || {})) {
      if (!gltf.scene.getObjectByName(name)) throw new Error(`missing authored socket: ${name}`);
    }
    gltf.scene.userData.authoredContract = structuredClone(contract);
  }
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (contract) return;
    for (const material of materialsOf(o)) {
      if (material.map) { material.map.colorSpace = THREE.SRGBColorSpace; material.map.anisotropy = 4; }
      if (!material.userData.tllAuthored) { material.roughness = 0.85; material.metalness = 0; }
    }
    if (o.name.startsWith('TLL_Silva_') && materialsOf(o).every((m) => !m.map)) {
      projectSurfaceUV(o.geometry);
      for (const material of materialsOf(o)) applySurfaceDetail(material, surfaceRole(material.name));
    }
  });
  if (!contract) mergeSkinned(gltf.scene, gltf.animations);
  return gltf;
}

/** 같은 스켈레톤·재질을 쓰는 스킨드 메시 파츠를 하나로 병합 → 드로우콜 1/8 (다수 몬스터용) */
export function mergeSkinned(scene, animations = []) {
  const groups = new Map();
  const animated = new Set(animations.flatMap((clip) => clip.tracks.map((track) => THREE.PropertyBinding.parseTrackName(track.name).nodeName)));
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.userData.characterFace || Array.isArray(o.material) || Object.keys(o.geometry.morphAttributes).length) return;
    if (animated.has(o.name) || animated.has(o.uuid)) return;
    const movingParents = [];
    for (let p = o.parent; p; p = p.parent) if (animated.has(p.name) || animated.has(p.uuid)) movingParents.push(p.uuid);
    const layout = Object.entries(o.geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`).join(',');
    const key = [o.material.uuid, o.skeleton.uuid, layout, !!o.geometry.index, movingParents.join(','), o.bindMode, o.bindMatrix.elements.join(','), o.matrixWorld.elements.join(',')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const base = list[0];
    const geos = list.map((m) => m.geometry.clone());
    let merged;
    try { merged = mergeGeometries(geos, false); }
    catch (e) { console.warn('merge fail', key, e); }
    finally { for (const geometry of geos) geometry.dispose(); }
    if (!merged) continue;
    const sm = new THREE.SkinnedMesh(merged, base.material); sm.name = base.name.replace(/_[A-Za-z]+$/, '') + '_Merged';
    sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
    sm.bind(base.skeleton, base.bindMatrix);
    sm.position.copy(base.position); sm.quaternion.copy(base.quaternion); sm.scale.copy(base.scale);
    sm.bindMode = base.bindMode;
    base.parent.add(sm);
    for (const m of list) { m.parent.remove(m); m.geometry.dispose(); }
  }
}

export async function preloadAll(onProgress) {
  await preloadSurfaceTextures();
  await preloadDungeonSurface();
  await preloadArmory();
  let done = 0;
  await Promise.all(MODEL_LIST.map(async (n) => { await loadModel(n); done++; onProgress?.(done / MODEL_LIST.length); }));
}

/** 애니메이션 포함 캐릭터 인스턴스 생성 */
export function spawnCharacter(gltf) {
  const rigRoot = skeletonClone(gltf.scene);
  const oathKnight = !!rigRoot.getObjectByName('TLL_Knight_0');
  const contract = rigRoot.userData.authoredContract;
  const root = contract ? new THREE.Group() : rigRoot;
  if (contract) {
    root.userData.authoredContract = structuredClone(contract);
    root.scale.setScalar(contract.scale); root.add(rigRoot);
    if (contract.role === 'hero') root.userData.libraryBodyAssetId = rigRoot.userData.libraryAsset?.id || null;
  }
  const mixer = new THREE.AnimationMixer(rigRoot);
  /** @type {Record<string, THREE.AnimationClip>} */
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  for (const [alias, name] of Object.entries(contract?.aliases || {})) clips[alias] = clips[name];
  // 히트 플래시용: 재질을 개별 복제 (emissive 조절)
  root.traverse((o) => {
    if (!o.isMesh) return;
    const clone = (material) => cloneCharacterMaterial(material, !!contract, oathKnight);
    o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
  });
  return { root, mixer, clips };
}

/** 인스턴스 전용 재질: 피격 발광 기준값(authored/base emissive)을 함께 둔다. */
function cloneCharacterMaterial(material, authored, oathKnight = false) {
  const next = material.clone();
  if (oathKnight) finishOathKnightMaterial(next);
  if (next.emissive) {
    if (!authored && !next.userData.tllAuthored) next.emissive.setScalar(0);
    next.userData.authoredEmissive = next.emissive.clone();
    next.userData.baseEmissive = next.emissive.clone();
  }
  return next;
}

/** Release instance-owned skin textures/materials; preserve shared source geometry. */
export function disposeCharacter(root, mixer) {
  root.userData.libraryDisposed = true;
  root.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot());
  const skeletons = new Set(), materials = new Set();
  root.traverse((o) => {
    if (o.isSkinnedMesh) skeletons.add(o.skeleton);
    if (o.isMesh) for (const material of materialsOf(o)) materials.add(material);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
}

/** dungeon.glb / skel_weapons.glb 등 합본에서 이름으로 파트 추출 (복제) */
export function getPart(gltf, name) {
  const n = gltf.scene.getObjectByName(name);
  if (!n) { console.warn('part not found', name); return new THREE.Group(); }
  const c = n.clone(true);
  c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
  return c;
}

// ---------- 이미지 텍스처 (GPT 생성 VFX) ----------
const texLoader = new THREE.TextureLoader();
export const VFX_TEX = {};
export const VFX_LIST = ['circle_gold', 'circle_demon', 'slash', 'shockwave', 'lightning', 'fire_pillar', 'ice', 'holy_burst', 'explosion', 'dust', 'lightning_chain', 'blood_burst', 'singularity', 'phoenix'];
export async function preloadVfx() {
  await Promise.all(VFX_LIST.map((n) => new Promise((res) => texLoader.load(`/img/vfx/${n}.webp`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; VFX_TEX[n] = t; res(); }, undefined, () => { console.warn('vfx tex fail', n); res(); }))));
}

// ---------- 프로시저럴 텍스처 ----------
const texCache = {};
export function softCircleTex() {
  if (texCache.soft) return texCache.soft;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); texCache.soft = t; return t;
}
export function sparkTex() {
  if (texCache.spark) return texCache.spark;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  // 십자 광채
  g.globalCompositeOperation = 'lighter';
  const lin = g.createLinearGradient(0, 32, 64, 32); lin.addColorStop(0, 'rgba(255,255,255,0)'); lin.addColorStop(0.5, 'rgba(255,255,255,1)'); lin.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lin; g.fillRect(0, 30, 64, 4);
  const lin2 = g.createLinearGradient(32, 0, 32, 64); lin2.addColorStop(0, 'rgba(255,255,255,0)'); lin2.addColorStop(0.5, 'rgba(255,255,255,1)'); lin2.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lin2; g.fillRect(30, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); texCache.spark = t; return t;
}
export function ringTex() {
  if (texCache.ring) return texCache.ring;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); texCache.ring = t; return t;
}
export function slashTex() {
  if (texCache.slash) return texCache.slash;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
  const v = g.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = v; g.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c); texCache.slash = t; return t;
}
export function smokeTex() {
  if (texCache.smoke) return texCache.smoke;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = 64 + (Math.random() - 0.5) * 70, y = 64 + (Math.random() - 0.5) * 70, r = 12 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); texCache.smoke = t; return t;
}
