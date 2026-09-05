import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEROES } from '../data/heroes.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();
/** @typedef {{materials: string, role: string, heroId?: string, scale: number, aliases: Record<string, string>, sockets?: Record<string, string>}} ModelContract */

export function requiredModelAliases(role, heroId) {
  if (role === 'companion') return ['Idle', 'Idle_Combat', 'Running_A', 'Spellcast_Raise', 'Spellcast_Shoot', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B'];
  const hero = role === 'hero' && HEROES[heroId];
  if (!hero) throw new Error('invalid model role');
  return [...new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', 'Cheer', 'Interact',
    ...hero.combo.map((step) => step.anim), ...hero.skills.map((skill) => skill.anim), ...(heroId === 'mage' ? ['Spellcasting'] : [])])];
}

export const HERO_MODELS = ['Knight', 'Barbarian', 'Mage', 'Rogue'];
export const MONSTER_MODELS = [
  'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage',
  'Big_Orc', 'Big_Orc_Skull', 'Big_Demon', 'Big_BlueDemon', 'Big_Yeti', 'Big_MushroomKing',
  'Big_Tribal', 'Big_Cactoro', 'Big_Alien', 'Big_Ninja',
  'Blob_GreenBlob', 'Blob_PinkBlob', 'Blob_GreenSpikyBlob', 'Blob_Mushnub', 'Blob_Mushnub_Evolved', 'Blob_Orc',
  'Flying_Ghost', 'Flying_Ghost_Skull', 'Flying_Dragon', 'Flying_Dragon_Evolved',
  'Flying_Armabee', 'Flying_Armabee_Evolved', 'Flying_Hywirl', 'Flying_Squidle', 'Flying_Glub', 'Flying_Goleling_Evolved',
];
export const MODEL_LIST = [...HERO_MODELS, ...MONSTER_MODELS, 'dungeon', 'skel_weapons'];

/** @param {string} name @param {ModelContract|null} contract */
export async function loadModel(name, contract = null) {
  const key = name + '|' + JSON.stringify(contract);
  if (cache.has(key)) return cache.get(key);
  const p = loader.loadAsync(`/models/${name}.glb`).then((gltf) => prepareModel(gltf, contract));
  cache.set(key, p);
  try { return await p; } catch (error) { cache.delete(key); throw error; }
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
      material.roughness = 0.85; material.metalness = 0;
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
    if (!o.isSkinnedMesh || Array.isArray(o.material) || Object.keys(o.geometry.morphAttributes).length) return;
    if (animated.has(o.name) || animated.has(o.uuid)) return;
    const movingParents = [];
    for (let p = o.parent; p; p = p.parent) if (animated.has(p.name) || animated.has(p.uuid)) movingParents.push(p.uuid);
    const key = [o.material.uuid, o.skeleton.uuid, movingParents.join(','), o.bindMode, o.bindMatrix.elements.join(','), o.matrixWorld.elements.join(',')].join('|');
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
  let done = 0;
  await Promise.all(MODEL_LIST.map(async (n) => { await loadModel(n); done++; onProgress?.(done / MODEL_LIST.length); }));
}

/** 애니메이션 포함 캐릭터 인스턴스 생성 */
export function spawnCharacter(gltf) {
  const rigRoot = skeletonClone(gltf.scene);
  const contract = rigRoot.userData.authoredContract;
  const root = contract ? new THREE.Group() : rigRoot;
  if (contract) {
    root.userData.authoredContract = structuredClone(contract);
    root.scale.setScalar(contract.scale); root.add(rigRoot);
  }
  const mixer = new THREE.AnimationMixer(rigRoot);
  /** @type {Record<string, THREE.AnimationClip>} */
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  for (const [alias, name] of Object.entries(contract?.aliases || {})) clips[alias] = clips[name];
  // 히트 플래시용: 재질을 개별 복제 (emissive 조절)
  root.traverse((o) => {
    if (!o.isMesh) return;
    const clone = (material) => {
      const next = material.clone();
      if (next.emissive) {
        if (!contract) next.emissive.setScalar(0);
        next.userData.authoredEmissive = next.emissive.clone();
        next.userData.baseEmissive = next.emissive.clone();
      }
      return next;
    };
    o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
  });
  return { root, mixer, clips };
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
