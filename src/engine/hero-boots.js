import * as THREE from 'three';
import BOOTS_DATA from '../data/hero-boots.json';

/**
 * 등급 부츠(N/E/L, 5영웅 공용) 런타임 부착 경로. 설계 요약은 docs/art-plan-boots.md.
 *  · 부츠 GLB 는 스킨드 메시 + Mixamo 하체 본(LeftUpLeg~LeftToeBase)만 쓴다. 소켓이 아니라 영웅 몸과 같은 스킨으로 움직인다.
 *  · 부츠 정점은 영웅 몸의 바인드 공간에 저작한다(art-src/boots/BRIEF.md). 런타임은 영웅 현재 몸 스킨의 본 노드와 역바인드를
 *    본 이름(mixamorig 접두 무시)으로 가져와 새 Skeleton 을 만든다. 그래서 몸이 바뀌어도(역바인드가 다른 개정) refitHeroBoots 로 다시 묶는다.
 *  · 몸 발 부분과의 겹침(z-fighting)은 부츠 정점을 법선 방향으로 키 높이의 일정 비율만큼 부풀리고 polygonOffset 으로 앞세워 막는다.
 *  · 데이터(src/data/hero-boots.json)에 항목이 없으면 아무것도 만들지 않는다(무동작).
 */
export const BOOTS_SCHEMA = 'blade-surge.hero-boots.v1';
export const BOOTS_TIERS = Object.freeze(['N', 'E', 'L']);
export const BOOTS_TRIANGLE_LIMIT = 3000;
/** 부풀림: 부츠 메시 키(bbox 높이)에 대한 비율. 0.35m 부츠 기준 약 4mm. */
export const BOOTS_INFLATE_RATIO = 0.012;
// 신발 장비 등급 → 부츠 단계. 몸 단계 규칙을 따른다(S 는 N 과, U 는 E 와 같은 외형을 공유, L 은 전용).
const RARITY_BOOTS_TIER = Object.freeze({ N: 'N', S: 'N', E: 'E', U: 'E', L: 'L' });
const digest = /^[a-f0-9]{64}$/;

export function bootsTierForRarity(rarity) {
  return RARITY_BOOTS_TIER[rarity] || null;
}

export function validateBootsData(value) {
  if (!value || value.schema !== BOOTS_SCHEMA || !Array.isArray(value.boots)) throw new Error('invalid hero boots schema');
  const ids = new Set(), tiers = new Set();
  for (const entry of value.boots) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error('invalid or duplicate boots id');
    ids.add(entry.id);
    if (!BOOTS_TIERS.includes(entry.tier) || tiers.has(entry.tier)) throw new Error('invalid or duplicate boots tier');
    tiers.add(entry.tier);
    if (entry.path !== `/models/boots/${entry.id}.glb`) throw new Error('invalid boots path');
    if (!Number.isInteger(entry.triangles) || entry.triangles <= 0 || entry.triangles > BOOTS_TRIANGLE_LIMIT) throw new Error('boots triangle budget exceeded');
    if (typeof entry.sha256 !== 'string' || !digest.test(entry.sha256)) throw new Error('invalid boots digest');
    if (entry.fit !== undefined) {
      if (!entry.fit || typeof entry.fit !== 'object') throw new Error('invalid boots fit');
      for (const fit of Object.values(entry.fit)) if (!Number.isFinite(fit?.scale) || fit.scale < 0.5 || fit.scale > 2) throw new Error('invalid boots fit scale');
    }
  }
  return value;
}
validateBootsData(BOOTS_DATA);

/**
 * 신발 등급에 맞는 부츠 항목. 그 단계 부츠가 없으면 한 단계씩 낮춘다(L→E→N). 없으면 null.
 * @param {string} rarity @param {any} [data]
 */
export function pickBootsEntry(rarity, data = BOOTS_DATA) {
  const tier = bootsTierForRarity(rarity);
  if (!tier) return null;
  for (let i = BOOTS_TIERS.indexOf(tier); i >= 0; i--) {
    const entry = data.boots.find((candidate) => candidate.tier === BOOTS_TIERS[i]);
    if (entry) return entry;
  }
  return null;
}

/** 'mixamorigLeftLeg' · 'mixamorig:LeftLeg' · 'LeftLeg' 를 같은 'LeftLeg' 로. */
export function normalizeBoneName(name) {
  return String(name || '').replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');
}

/**
 * 부츠 본 이름을 영웅 몸 스킨의 본·역바인드로 옮긴다. 하나라도 못 찾으면(다른 골격) null.
 * @returns {{ bones: THREE.Bone[], inverses: THREE.Matrix4[] } | null}
 */
export function mapBootsBones(bootsBones, heroSkeleton) {
  const byName = new Map();
  heroSkeleton.bones.forEach((bone, index) => {
    const key = normalizeBoneName(bone.name);
    if (key && !byName.has(key)) byName.set(key, index);
  });
  const bones = [], inverses = [];
  for (const bone of bootsBones) {
    const index = byName.get(normalizeBoneName(bone.name));
    if (index === undefined) return null;
    bones.push(heroSkeleton.bones[index]);
    inverses.push(heroSkeleton.boneInverses[index].clone());
  }
  return { bones, inverses };
}

/** 법선 방향으로 정점을 부풀린 새 지오메트리(원본은 공유 캐시라 건드리지 않는다). scale 은 영웅별 맞춤. */
export function fitBootsGeometry(source, { scale = 1, inflate = BOOTS_INFLATE_RATIO } = {}) {
  const geometry = source.clone();
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  geometry.computeBoundingBox();
  const height = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  const amount = Math.max(0, inflate) * height;
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i) * scale, y = position.getY(i) * scale, z = position.getZ(i) * scale;
    if (normal && amount > 0) {
      x += normal.getX(i) * amount; y += normal.getY(i) * amount; z += normal.getZ(i) * amount;
    }
    position.setXYZ(i, x, y, z);
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const bodySkin = (root) => {
  let found = null;
  root.traverse((node) => { if (!found && node.isSkinnedMesh && node.userData.libraryBody) found = node; });
  return found;
};

/**
 * 부츠 소스 장면의 스킨드 메시들을 영웅 몸 스킨에 재결합한 메시 목록. 골격이 맞지 않거나 스킨드 메시가 없으면 null.
 * @param {THREE.Object3D} bootsScene @param {THREE.SkinnedMesh} skin 영웅 현재 몸 @param {{id: string, fit?: Record<string, {scale: number}>}} entry
 */
export function buildHeroBootsMeshes(bootsScene, skin, entry, heroId, makeMaterial = (material) => material.clone()) {
  const sources = [];
  bootsScene.traverse((node) => { if (node.isSkinnedMesh) sources.push(node); });
  if (!sources.length || !skin) return null;
  const meshes = [];
  const fail = () => { for (const mesh of meshes) disposeMesh(mesh); return null; };
  for (const source of sources) {
    const mapped = mapBootsBones(source.skeleton.bones, skin.skeleton);
    if (!mapped) return fail();
    const material = Array.isArray(source.material) ? source.material.map(makeMaterial) : makeMaterial(source.material);
    for (const m of Array.isArray(material) ? material : [material]) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
    const mesh = new THREE.SkinnedMesh(fitBootsGeometry(source.geometry, { scale: entry.fit?.[heroId]?.scale ?? 1 }), material);
    mesh.name = `HeroBoots_${entry.id}`;
    mesh.userData.heroBoots = entry.id;
    mesh.position.copy(skin.position); mesh.quaternion.copy(skin.quaternion); mesh.scale.copy(skin.scale);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.bindMode = skin.bindMode;
    mesh.bind(new THREE.Skeleton(mapped.bones, mapped.inverses), skin.bindMatrix);
    meshes.push(mesh);
  }
  return meshes;
}

function disposeMesh(mesh) {
  mesh.removeFromParent();
  mesh.geometry.dispose(); mesh.skeleton.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
}

/** 부착된 부츠를 모두 치운다. 부츠 상태가 없으면 아무것도 하지 않는다. */
export function removeHeroBoots(root) {
  const state = root.userData.heroBoots;
  root.userData.bootsTargetId = null;
  if (!state) return false;
  for (const mesh of state.meshes) disposeMesh(mesh);
  delete root.userData.heroBoots;
  return true;
}

function mount(root, meshes, parent) {
  for (const mesh of meshes) parent.add(mesh);
}

/**
 * 영웅 현재 몸에 맞춰 부츠를 다시 묶는다(몸 교체 직후). 맞지 않으면 부츠를 치운다.
 * @returns {boolean} 부츠가 붙어 있으면 true
 */
export function refitHeroBoots(root, makeMaterial) {
  const state = root.userData.heroBoots;
  if (!state) return false;
  const skin = bodySkin(root), heroId = root.userData.authoredContract?.heroId;
  const meshes = skin && buildHeroBootsMeshes(state.source, skin, state.entry, heroId, makeMaterial || state.makeMaterial);
  if (!meshes) { removeHeroBoots(root); return false; }
  for (const mesh of state.meshes) disposeMesh(mesh);
  mount(root, meshes, skin.parent);
  root.userData.heroBoots = { ...state, meshes };
  return true;
}

/**
 * 장착한 신발 등급에 맞는 부츠를 붙이거나 바꾸거나 치운다. applyLook 마다 불러도 같은 부츠면 즉시 끝난다.
 * @param {THREE.Object3D} root 라이브러리 영웅 root
 * @param {{rarity?: string}|null} boots 신발 아이템 정의(없으면 null) — 아바타·신발 없음이면 null 을 넘긴다
 * @param {{ data?: any, load: (path: string) => Promise<{scene: THREE.Object3D}>, makeMaterial?: Function, onChange?: Function, warn?: Function }} options
 * @returns {boolean} 지금 이 호출에서 비동기 부착을 시작했거나 이미 붙어 있으면 true
 */
export function syncHeroBoots(root, boots, { data = BOOTS_DATA, load, makeMaterial, onChange, warn = console.warn } = {}) {
  const entry = root.userData.authoredContract?.role === 'hero' && boots ? pickBootsEntry(boots.rarity, data) : null;
  if (!entry) { removeHeroBoots(root); return false; }
  const current = root.userData.heroBoots;
  if (current?.entry.id === entry.id) return true;
  if (root.userData.bootsTargetId === entry.id) return true;
  root.userData.bootsTargetId = entry.id;
  Promise.resolve().then(() => load(entry.path)).then((gltf) => {
    if (root.userData.libraryDisposed || root.userData.bootsTargetId !== entry.id) return;
    const skin = bodySkin(root), heroId = root.userData.authoredContract?.heroId;
    const meshes = skin && buildHeroBootsMeshes(gltf.scene, skin, entry, heroId, makeMaterial);
    if (!meshes) { warn(`hero boots rejected (skeleton mismatch): ${entry.id}`); root.userData.bootsTargetId = null; return; }
    const previous = root.userData.heroBoots;
    if (previous) for (const mesh of previous.meshes) disposeMesh(mesh);
    mount(root, meshes, skin.parent);
    root.userData.heroBoots = { id: entry.id, entry, source: gltf.scene, meshes, makeMaterial };
    onChange?.();
  }).catch((error) => { root.userData.bootsTargetId = null; warn(`hero boots failed: ${entry.id}`, error); });
  return true;
}
