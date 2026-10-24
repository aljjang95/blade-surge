import * as THREE from 'three';
import { excludeFromBloom } from './character-bloom.js';
import { installCombatMotionClips } from './combat-motion-clips.js';
import { registerHeroBodyMotion, prepareHeroBodyMotion, commitHeroBodyMotion, selectedBodyMotionIdentity, disposeHeroBodyMotion } from './hero-body-motion.js';
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
import { isRemoteAsset, readRemoteBuffer } from '../platform/remote-assets.js';
import { tuneCharacterTextures } from './texture-sampling.js';
import { preloadSurfaceTextures, projectSurfaceUV, surfaceRole, applySurfaceDetail } from './surface-textures.js';
import { preloadDungeonSurface } from '../game/dungeon-surface.js';
import { libraryAssets, createDefaultLibraryLoader } from './library-assets.js';
import { refitHeroBoots, removeHeroBoots } from './hero-boots.js';
import { refitHeroGearParts, removeHeroGearParts } from './hero-gear-parts.js';
import { MONSTER_ROSTER, COMPANION_ASSET, monsterRosterEntry } from '../data/monster-roster.js';
import { heroIdForModel, heroModelContract, heroHandBones, heroGripRotation, librarySocketScale, resolveSharedHeroClips, LIBRARY_SOCKET_NAMES } from '../data/hero-library.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// 궁수 교정본(ranger-library-v1)의 저작 소켓. GLTFLoader 는 이름의 '_' 를 보존한다.
export const RANGER_BOW_GRIP = 'RangerBowGrip_L';
export const RANGER_DRAW_NOCK = 'RangerDrawNock_R';

const cache = new Map();
/**
 * 라이브러리 GLB 한 개를 읽는다. 스토어 네이티브 채널에서 APK 밖(remote)인 파일은 보관본 또는 정식 호스트에서 바이트를 받아 파싱한다
 * (실패하면 RemoteAssetError → 라이브러리 로더가 기존 폴백을 쓰고, 다음 요청에서 다시 시도한다). 그 밖의 경로는 평소대로 URL 로더다.
 */
export async function loadLibraryGltf(path) {
  if (!isRemoteAsset(path)) return loader.loadAsync(path);
  const buffer = await readRemoteBuffer(path);
  return loader.parseAsync(buffer, path.slice(0, path.lastIndexOf('/') + 1));
}
const libraryLoader = createDefaultLibraryLoader(loadLibraryGltf, (gltf) => prepareModel(gltf));
/** @typedef {{materials: string, role: string, heroId?: string, scale: number, aliases: Record<string, string>, sockets?: Record<string, string>}} ModelContract */

export function requiredModelAliases(role, heroId) {
  if (role === 'companion') return ['idle', 'run', 'cast', 'raise', 'hit', 'hitHeavy', 'death'];
  const hero = role === 'hero' && HEROES[heroId];
  if (!hero) throw new Error('invalid model role');
  return [...new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', 'Cheer', 'Interact',
    ...hero.combo.map((step) => step.anim), ...hero.skills.map((skill) => skill.anim), ...(heroId === 'mage' ? ['Spellcasting'] : [])])];
}

export const HERO_MODELS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Ranger'];
const MONSTER_LIBRARY_IDS = new Set(Object.values(MONSTER_ROSTER).flatMap((entry) => [entry.asset, entry.fallback]));
export const MONSTER_MODELS = libraryAssets().filter((asset) => asset.role !== 'hero' && MONSTER_LIBRARY_IDS.has(asset.id)).map((asset) => asset.id);
// 영웅 갑옷 단계 GLB 는 영웅 모델 이름과 장비 교체 경로에서만 받는다(부팅 시 전 단계 선로딩 금지).
export const MODEL_LIST = [...HERO_MODELS, ...MONSTER_MODELS, ...libraryAssets().filter((asset) => asset.role !== 'hero' && !MONSTER_LIBRARY_IDS.has(asset.id)).map((asset) => asset.id), 'dungeon', 'tllDungeonLandmarks'];
const SPECIAL_MODELS = Object.freeze({ tllDungeonLandmarks: '/models/tll/dungeons/dungeon-landmarks-v1.glb',
  tllCoolingValve: '/models/tll/props/cooling-valve-v1.glb',
  tllNightglassRecord: '/models/tll/props/nightglass-record-v1.glb' });

/** @param {string} name @param {ModelContract|null} contract */
export async function loadModel(name, contract = null, allowLibrary = true) {
  const heroId = !contract && allowLibrary ? heroIdForModel(name) : null;
  if (heroId && libraryLoader.assetForHero(heroId, 1)) return loadHeroModel(heroId, 1);
  const roster = !contract && allowLibrary ? monsterRosterEntry(name) : null;
  const requestedAsset = roster?.asset || (name === COMPANION_ASSET ? COMPANION_ASSET : null);
  const fallbackAsset = roster?.fallback || requestedAsset;
  const libraryAsset = !contract && allowLibrary && !heroId
    ? libraryLoader.assetFor(requestedAsset || name) || (roster ? libraryLoader.assetFor(fallbackAsset) : null)
    : null;
  if (libraryAsset?.role === 'hero') return libraryAsset.avatar ? loadHeroAsset(libraryAsset) : loadHeroModel(libraryAsset.heroId, { tier: libraryAsset.armorTier || 1, theme: libraryAsset.armorTheme || null });
  const key = name + '|' + JSON.stringify(contract) + '|' + (libraryAsset?.id || 'legacy');
  if (cache.has(key)) return cache.get(key);
  if (libraryAsset) {
    const p = libraryLoader.load(libraryAsset, async () => {
      const fallback = fallbackAsset && fallbackAsset !== libraryAsset.id ? libraryLoader.assetFor(fallbackAsset) : null;
      if (fallback) return libraryLoader.load(fallback, () => { throw new Error(`library fallback failed: ${fallback.id}`); }).then((gltf) => {
        gltf.scene.userData.libraryRoster = roster ? { ...roster, asset: fallback.id } : null;
        return gltf;
      });
      throw new Error(`library asset unavailable: ${libraryAsset.id}`);
    }, (gltf, asset) => {
      gltf.scene.userData.libraryRoster = roster ? { ...roster, asset: asset?.id || libraryAsset.id } : null;
      return prepareModel(gltf);
    });
    cache.set(key, p);
    try { return await p; } catch (error) { cache.delete(key); throw error; }
  }
  const heroPaths = !contract && HERO_MODELS.includes(name) ? heroModelPaths(name) : null;
  const p = loader.loadAsync(heroPaths?.base || SPECIAL_MODELS[name] || `/models/${name}.glb`).then(async (gltf) => {
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
/** @param {string} heroId @param {number|{ tier: number, theme?: string|null }} [tier] @param {string|null} [avatarId] */
export function preloadHeroBody(heroId, tier = 1, avatarId = null) {
  const avatar = (avatarId || HEROES[heroId]?.bodyAvatar) ? libraryLoader.assetForAvatar(avatarId || HEROES[heroId].bodyAvatar) : null;
  return preloadLibraryBody(avatar || libraryLoader.assetForHero(heroId, tier));
}

function preloadLibraryBody(asset) {
  if (!asset) return Promise.resolve(false);
  return loadHeroAsset(asset).then((gltf) => gltf.scene.userData.libraryAsset?.id === asset.id, (error) => { console.warn('hero body preload failed: ' + asset.id, error); return false; });
}

export function loadHeroAsset(asset) {
  if (asset?.role !== 'hero' || !asset.heroId || !HEROES[asset.heroId]) return Promise.reject(new Error('invalid hero asset'));
  const identity = selectedBodyMotionIdentity(asset);
  return libraryLoader.load(asset, () => loadModel(HEROES[asset.heroId].model, null, false), (gltf, entry) => {
    gltf.scene.userData.libraryBodyMotionIdentity = identity;
    return prepareLibraryHero(gltf, entry);
  });
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
  // 메시 전용 단계·아바타는 1단계(클립 원본)의 활 그립·노크 소켓을 같은 이름의 본에 이어받는다.
  if (heroId === 'ranger') adoptRangerSockets(gltf.scene, heroBodies.get(clipAsset.id)?.scene || null);
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
  if (heroId === 'ranger') rigRangerBowString(gltf.scene);
  prepareModel(gltf, heroModelContract(asset, gltf.scene, clipAsset, gltf.animations));
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
    const grip = side === 'l' && heroId === 'ranger' ? scene.getObjectByName(RANGER_BOW_GRIP) : null;
    const bow = grip ? slot.children.find((child) => child.name === 'Bow') : null;
    if (grip && bow && grip.parent === bone) fitAuthoredGrip(socket, grip, bow);
    bone.add(socket);
    for (const child of [...slot.children]) socket.add(child.clone(true));
  }
}

/**
 * Blender 에서 저작한 활 그립(활 로컬 축 = 그립 축)을 소켓에 옮긴다. 소켓 아래 KayKit 활 노드의 고유 회전·위치를
 * 상쇄해 활이 그립 노드와 같은 자리·방향에 놓인다. 배율은 기존 손 높이 비율을 그대로 쓴다.
 */
export function fitAuthoredGrip(socket, grip, bow) {
  socket.quaternion.copy(grip.quaternion).multiply(_gripQuat.copy(bow.quaternion).invert());
  _gripOffset.copy(bow.position).multiply(socket.scale).applyQuaternion(socket.quaternion);
  socket.position.copy(grip.position).sub(_gripOffset);
  return socket;
}
const _gripQuat = new THREE.Quaternion(), _gripOffset = new THREE.Vector3();

/** 1단계 몸체의 저작 소켓을 같은 골격의 다른 몸체에 복제한다(이미 있으면 유지). */
export function adoptRangerSockets(scene, source) {
  if (!source) return 0;
  let adopted = 0;
  for (const name of [RANGER_BOW_GRIP, RANGER_DRAW_NOCK]) {
    const from = source.getObjectByName(name);
    if (!from || scene.getObjectByName(name) || !from.parent) continue;
    const bone = scene.getObjectByName(from.parent.name);
    if (!bone?.isBone) continue;
    const node = new THREE.Object3D(); node.name = name;
    node.position.copy(from.position); node.quaternion.copy(from.quaternion); node.scale.copy(from.scale);
    bone.add(node); adopted++;
  }
  return adopted;
}

// ---------- 궁수 시위 ----------
// forge-bow-v2 의 정적 시위 형상은 손을 따라가지 못한다. 시위 성분만 떼어 내고 두 마디의 얇은 원기둥으로
// 끝(활 로컬 tips)과 노크점을 잇는다. 당기는 동안에는 실제 오른손 노크 소켓을, 아니면 쉼 노크점을 쓴다.
const STRING_RADIUS = 0.0075;
const STRING_REST_NOCK = Object.freeze([0.177, 0, 0]);
let stringGeometry = null;
const stringSegmentGeometry = () => stringGeometry || (stringGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, .5, 0));

/** 활 형상에서 시위 성분(얇고 길며 사수 쪽 +x 에 있는 연결 성분)을 찾는다. */
export function bowStringTriangles(geometry) {
  const p = geometry.attributes.position, index = geometry.index;
  if (!p || !index) return null;
  const ids = new Map(), parent = [], vertex = new Int32Array(p.count);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4);
    if (!ids.has(key)) { ids.set(key, parent.length); parent.push(parent.length); }
    vertex[i] = ids.get(key);
  }
  for (let t = 0; t < index.count; t += 3) {
    const a = find(vertex[index.getX(t)]);
    parent[find(vertex[index.getX(t + 1)])] = a; parent[find(vertex[index.getX(t + 2)])] = a;
  }
  const boxes = new Map();
  for (let t = 0; t < index.count; t += 3) {
    const root = find(vertex[index.getX(t)]);
    const box = boxes.get(root) || { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    box.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = index.getX(t + k), v = [p.getX(i), p.getY(i), p.getZ(i)];
      for (let a = 0; a < 3; a++) { box.min[a] = Math.min(box.min[a], v[a]); box.max[a] = Math.max(box.max[a], v[a]); }
    }
    boxes.set(root, box);
  }
  const strings = [...boxes.values()].filter((b) => b.max[1] - b.min[1] < .03 && b.max[2] - b.min[2] > 1.5 && b.min[0] > 0);
  return strings.length === 1 ? strings[0] : null;
}

export function rigRangerBowString(scene) {
  const bow = scene.getObjectByName('Bow');
  if (!bow?.isMesh || bow.getObjectByName('Bow_String_Upper')) return false;
  const string = bowStringTriangles(bow.geometry);
  if (!string) return false;
  const drop = new Set(string.tris), source = bow.geometry.index, kept = [];
  for (let t = 0; t < source.count; t += 3) if (!drop.has(t)) kept.push(source.getX(t), source.getX(t + 1), source.getX(t + 2));
  const geometry = bow.geometry.clone(); geometry.setIndex(kept);
  bow.geometry = geometry;
  const tipZ = Math.max(Math.abs(string.min[2]), Math.abs(string.max[2]));
  bow.userData.rangerString = { top: [string.min[0], 0, tipZ], bottom: [string.min[0], 0, -tipZ], nock: [...STRING_REST_NOCK] };
  const material = new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: .72, metalness: 0 });
  material.name = 'Ranger_Bow_String'; material.userData.tllAuthored = true;
  for (const name of ['Bow_String_Upper', 'Bow_String_Lower']) {
    const mesh = new THREE.Mesh(stringSegmentGeometry(), material); mesh.name = name; mesh.frustumCulled = false;
    bow.add(mesh);
  }
  poseRangerBowString(scene, false);
  return true;
}

const _stringNock = new THREE.Vector3(), _stringTip = new THREE.Vector3(), _stringDir = new THREE.Vector3(), _stringUp = new THREE.Vector3(0, 1, 0);
const stringRigs = new WeakMap();
function stringRig(model) {
  let rig = stringRigs.get(model);
  if (rig === undefined) {
    const bow = model.getObjectByName('Bow');
    const data = bow?.userData.rangerString;
    rig = data ? { bow, data, upper: bow.getObjectByName('Bow_String_Upper'), lower: bow.getObjectByName('Bow_String_Lower'),
      hand: model.getObjectByName(RANGER_DRAW_NOCK) } : null;
    stringRigs.set(model, rig);
  }
  return rig;
}
function placeSegment(mesh, tip, nock) {
  _stringDir.subVectors(nock, tip); const length = _stringDir.length();
  mesh.position.copy(tip); mesh.quaternion.setFromUnitVectors(_stringUp, _stringDir.multiplyScalar(1 / Math.max(1e-6, length)));
  mesh.scale.set(STRING_RADIUS, length, STRING_RADIUS);
}

/**
 * 시위를 매 프레임 실제 손 위치로 맞춘다. drawing 은 시뮬레이션의 발사 전 상태(콤보 타격 전·스킬 시전 전)이며,
 * 그때도 오른손 노크 소켓이 활 뒤쪽 당김 통로 안에 있을 때만 손을 따라간다. 할당하지 않는다.
 * @returns {boolean} 시위가 손에 걸렸는가
 */
export function poseRangerBowString(model, drawing) {
  const rig = stringRig(model);
  if (!rig?.upper || !rig.lower) return false;
  const { bow, data } = rig;
  let held = false;
  if (drawing && rig.hand) {
    rig.hand.updateWorldMatrix(true, false); bow.updateWorldMatrix(true, false);
    rig.hand.getWorldPosition(_stringNock); bow.worldToLocal(_stringNock);
    held = _stringNock.x > .12 && _stringNock.x < 1.4 && Math.abs(_stringNock.y) < .3 && Math.abs(_stringNock.z) < .45;
  }
  if (!held) _stringNock.fromArray(data.nock);
  placeSegment(rig.upper, _stringTip.fromArray(data.top), _stringNock);
  placeSegment(rig.lower, _stringTip.fromArray(data.bottom), _stringNock);
  return held;
}

/**
 * 장비 갑옷 단계에 맞는 몸체로 같은 인스턴스 안에서 교체한다. 믹서·재생 중 액션·무기 소켓은 보존한다.
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
  if (contract?.role !== 'hero' || !target || target.role !== 'hero' || target.heroId !== contract.heroId) return false;
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
  const identity = gltf.scene.userData.libraryBodyMotionIdentity;
  if (gltf.scene.userData.libraryAsset?.id !== target.id || identity?.asset !== target.id
    || identity.heroId !== root.userData.authoredContract?.heroId || root.userData.libraryDisposed
    || root.userData.libraryTargetId !== target.id) return false;
  let motionPlan;
  try { motionPlan = prepareHeroBodyMotion(root, identity); }
  catch (error) { console.warn('hero body motion rejected: ' + target.id, error); return false; }
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
  if (built.some(entry => !entry.parent) || root.userData.libraryDisposed || root.userData.libraryTargetId !== target.id) {
    for (const entry of built) release(entry.mesh); return false;
  }
  for (const { mesh, parent } of built) parent.add(mesh);
  // 모든 저작 검증은 기존 메시 제거 전에 끝낸다. stale 계획이면 새 메시만 정리한다.
  if (!commitHeroBodyMotion(root, motionPlan)) {
    for (const { mesh } of built) { mesh.removeFromParent(); release(mesh); } return false;
  }
  root.userData.libraryBodyAssetId = target.id; root.userData.libraryHeroTier = target.armorTier || 1;
  root.userData.libraryBodyMotionIdentity = identity;
  for (const mesh of old) { mesh.removeFromParent(); release(mesh); }
  // 등급 부츠는 새 몸의 본·역바인드로 다시 묶는다(부츠가 없으면 무동작).
  refitHeroBoots(root, createBootsMaterial);
  refitHeroGearParts(root, createBootsMaterial);   // 갑옷 외형 파츠도 같은 방식(파츠가 없으면 무동작)
  return true;
}

// ---------- 등급 부츠(hero-boots.js) ----------
const bootsFiles = new Map();
/** 부츠 GLB 를 한 번만 받아 나눠 쓴다(실패하면 캐시를 비워 다음 요청에서 다시 시도). */
export function loadBootsModel(path) {
  if (!bootsFiles.has(path)) bootsFiles.set(path, loadLibraryGltf(path).catch((error) => { bootsFiles.delete(path); throw error; }));
  return bootsFiles.get(path);
}
/** 부츠 재질은 영웅 몸과 같은 마감을 거친 인스턴스별 복제본이다. */
export function createBootsMaterial(material) {
  const next = cloneCharacterMaterial(material, true);
  normalizeLibrarySkinMaterial(next); tuneCharacterTextures(next);
  return next;
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
    // 저작 모델(contract)도 포함해 모든 캐릭터 텍스처에 밉맵 + 이방성 8(기기 최대치 이하)을 건다.
    for (const material of materialsOf(o)) tuneCharacterTextures(material);
    if (contract) return;
    // 라이브러리 몬스터·동행(Tripo 몸체)도 영웅과 같은 몸 재질 마감을 거친다. 원본의 불투명 BLEND 는 GLTFLoader 가
    // depthWrite=false 로 읽어 한 메시 안의 삼각형 순서대로 덮이므로, 후드 안쪽이 얼굴·장식 위에 칠해져 납작한 단색 실루엣이 된다.
    if (o.isSkinnedMesh && gltf.scene.userData.libraryAsset) for (const material of materialsOf(o)) normalizeLibrarySkinMaterial(material);
    for (const material of materialsOf(o)) {
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
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
    if (contract.role === 'hero') {
      root.userData.libraryBodyAssetId = rigRoot.userData.libraryAsset?.id || null;
      root.userData.libraryBodyMotionIdentity = rigRoot.userData.libraryBodyMotionIdentity;
    }
  }
  const mixer = new THREE.AnimationMixer(rigRoot);
  /** @type {Record<string, THREE.AnimationClip>} */
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  for (const [alias, name] of Object.entries(contract?.aliases || {})) clips[alias] = clips[name];
  try { registerHeroBodyMotion(root, clips); installCombatMotionClips(clips, contract?.heroId); }
  catch (error) {
    // 아직 공유 재질을 쓰므로 실패한 clone의 skeleton·mixer만 정리한다.
    rigRoot.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    mixer.stopAllAction(); mixer.uncacheRoot(rigRoot); root.removeFromParent(); throw error;
  }
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
  // 캐릭터 몸은 조명 받은 알베도로 블룸을 만들지 않는다(발광 성분만 번진다). character-bloom.js 참고.
  return excludeFromBloom(next);
}

/** Release instance-owned skin textures/materials; preserve shared source geometry. */
export function disposeCharacter(root, mixer) {
  root.userData.libraryDisposed = true;
  disposeHeroBodyMotion(root);
  removeHeroBoots(root);   // 부츠 지오메트리는 인스턴스 소유
  removeHeroGearParts(root);
  root.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot());
  const skeletons = new Set(), materials = new Set();
  root.traverse((o) => {
    if (o.isSkinnedMesh) skeletons.add(o.skeleton);
    if (o.isMesh) for (const material of materialsOf(o)) materials.add(material);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
}

/** 합본 GLB에서 이름으로 파트를 추출한다. */
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
