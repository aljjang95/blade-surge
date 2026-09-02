import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();

export const MODEL_LIST = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage', 'dungeon', 'skel_weapons'];

export async function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const p = new Promise((res, rej) => loader.load(`/models/${name}.glb`, (g) => {
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material;
        if (m && m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
        if (m) { m.roughness = 0.85; m.metalness = 0.0; }
      }
    });
    mergeSkinned(g.scene);
    res(g);
  }, undefined, rej));
  cache.set(name, p);
  return p;
}

/** 같은 스켈레톤·재질을 쓰는 스킨드 메시 파츠를 하나로 병합 → 드로우콜 1/8 (다수 몬스터용) */
function mergeSkinned(scene) {
  const groups = new Map();
  scene.traverse((o) => { if (o.isSkinnedMesh) { const key = o.material.name + '|' + (o.skeleton.uuid); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o); } });
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const base = list[0];
    const geos = list.map((m) => { const g = m.geometry.clone(); for (const k of Object.keys(g.attributes)) { if (!base.geometry.attributes[k]) g.deleteAttribute(k); } for (const k of Object.keys(base.geometry.attributes)) { if (!g.attributes[k]) return null; } return g; });
    if (geos.some((g) => !g)) continue;
    let merged; try { merged = mergeGeometries(geos, false); } catch (e) { console.warn('merge fail', key, e); continue; }
    if (!merged) continue;
    const sm = new THREE.SkinnedMesh(merged, base.material); sm.name = base.name.replace(/_[A-Za-z]+$/, '') + '_Merged';
    sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
    sm.bind(base.skeleton, base.bindMatrix);
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
  const root = skeletonClone(gltf.scene);
  const mixer = new THREE.AnimationMixer(root);
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  // 히트 플래시용: 재질을 개별 복제 (emissive 조절)
  root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0); } });
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
export const VFX_LIST = ['circle_gold', 'circle_demon', 'slash', 'shockwave', 'lightning', 'fire_pillar', 'ice', 'holy_burst', 'explosion', 'dust'];
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
