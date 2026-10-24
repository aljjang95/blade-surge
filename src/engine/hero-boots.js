import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import BOOTS_DATA from '../data/hero-boots.json';
import { setGearFeetHidden } from '../game/gear-accents.js';

/**
 * 등급 부츠(S/E·U/L, 5영웅 공용) 런타임 부착 경로. 설계 요약은 docs/art-plan-boots.md.
 *  · 부츠 GLB 는 리그 없는 정적 메시 한 짝(오른발). 왼발은 x 반전 복제(감김 뒤집기 포함).
 *  · 영웅 몸 스킨의 발 관절(RightFoot/LeftFoot, mixamorig 접두 무시)에 1본 강체 스킨으로 붙인다: 두 짝을 한 지오메트리로 합친
 *    SkinnedMesh 하나(드로우콜 1), 본·역바인드·bindMatrix 는 영웅 현재 몸에서 가져온다. 그래서 달리기·구르기·사망 클립을 몸과 같이 따른다.
 *  · 크기는 영웅마다 자동: 영웅 발목 관절의 바닥 위 높이 ÷ 부츠 발목 높이(부츠 bbox 아래쪽 -y).
 *  · 몸의 원래 발은 gear-accents 몸 셰이더가 발 관절 가중치로 숨긴다(setGearFeetHidden). 숨김이 걸리지 않는 재질이면 남는 겹침은
 *    부츠를 법선 방향으로 부풀리고 polygonOffset 으로 앞세워 막는다.
 *  · 데이터(src/data/hero-boots.json)에 항목이 없거나 N 등급이면 아무것도 만들지 않는다(무동작).
 */
export const BOOTS_SCHEMA = 'blade-surge.hero-boots.v1';
/** 부츠가 있는 장비 등급. N 은 부츠 없음(몸의 원래 발). */
export const BOOTS_GRADES = Object.freeze(['S', 'E', 'U', 'L']);
export const BOOTS_TRIANGLE_LIMIT = 3200;
/** 부풀림: 부츠 메시 키(bbox 높이)에 대한 비율. */
export const BOOTS_INFLATE_RATIO = 0.01;
/** 맞춤 배율 한계(영웅 발목 높이가 비정상일 때 거절). */
export const BOOTS_SCALE_RANGE = Object.freeze([0.3, 3]);
/** 저작 계약(m, 발목 관절 원점): 밑창 y 범위, 윗단 최대 y, 발끝 +z 길이 범위. */
export const BOOTS_SOLE_Y = Object.freeze([-0.22, -0.03]);
export const BOOTS_TOP_MAX = 0.34;
const digest = /^[a-f0-9]{64}$/;

export function validateBootsData(value) {
  if (!value || value.schema !== BOOTS_SCHEMA || !Array.isArray(value.boots)) throw new Error('invalid hero boots schema');
  const ids = new Set(), grades = new Set();
  for (const entry of value.boots) {
    if (!entry || typeof entry.id !== 'string' || !/^boots_[a-z0-9_]{1,40}$/.test(entry.id) || ids.has(entry.id)) throw new Error('invalid or duplicate boots id');
    ids.add(entry.id);
    if (!Array.isArray(entry.grades) || !entry.grades.length || entry.grades.some((g) => !BOOTS_GRADES.includes(g) || grades.has(g))) throw new Error('invalid or duplicate boots grades');
    for (const g of entry.grades) grades.add(g);
    if (entry.path !== `/models/boots/${entry.id}.glb`) throw new Error('invalid boots path');
    if (!Number.isInteger(entry.triangles) || entry.triangles <= 0 || entry.triangles > BOOTS_TRIANGLE_LIMIT) throw new Error('boots triangle budget exceeded');
    if (typeof entry.sha256 !== 'string' || !digest.test(entry.sha256)) throw new Error('invalid boots digest');
  }
  return value;
}
validateBootsData(BOOTS_DATA);

/** 신발 등급 → 부츠 항목. N 이나 항목 없음은 null(원래 발). @param {string} rarity @param {any} [data] */
export function pickBootsEntry(rarity, data = BOOTS_DATA) {
  return data.boots.find((entry) => entry.grades.includes(rarity)) || null;
}

/** 'mixamorigLeftLeg' · 'mixamorig:LeftLeg' · 'LeftLeg' 를 같은 'LeftLeg' 로. */
export function normalizeBoneName(name) {
  return String(name || '').replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');
}

/** 본 이름으로 스켈레톤 인덱스. 없으면 -1. */
export function findBoneIndex(skeleton, name) {
  return skeleton.bones.findIndex((bone) => normalizeBoneName(bone.name) === name);
}

/** 몸 지오메트리 공간(메시 로컬)에서 본의 rest 위치. bindMatrix·boneInverse 로 계산한다. */
export function boneRestPosition(skin, index, target = new THREE.Vector3()) {
  const rest = new THREE.Matrix4().copy(skin.skeleton.boneInverses[index]).invert().premultiply(new THREE.Matrix4().copy(skin.bindMatrix).invert());
  return target.setFromMatrixPosition(rest);
}

/** 영웅 발목 높이: 발 관절 rest y − 몸 지오메트리 바닥 y. 못 구하면 null. */
export function heroAnkleHeight(skin) {
  const index = findBoneIndex(skin.skeleton, 'RightFoot');
  if (index < 0) return null;
  skin.geometry.computeBoundingBox();
  const height = boneRestPosition(skin, index).y - skin.geometry.boundingBox.min.y;
  return Number.isFinite(height) && height > 0 ? height : null;
}

/** 저작 계약 검사(원점 = 발목 관절, 밑창 y 범위, 윗단). @returns {boolean} */
export function bootsGeometryContract(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return min.y >= BOOTS_SOLE_Y[0] && min.y <= BOOTS_SOLE_Y[1] && max.y > 0 && max.y <= BOOTS_TOP_MAX;
}

/** x 반전 + 감김 뒤집기 + 법선 x 반전한 새 지오메트리(왼발). */
export function mirrorBootsGeometry(source) {
  const geometry = source.clone();
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  for (let i = 0; i < position.count; i++) position.setX(i, -position.getX(i));
  if (normal) for (let i = 0; i < normal.count; i++) normal.setX(i, -normal.getX(i));
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) { const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b); }
    index.needsUpdate = true;
  } else {
    // 비색인: 삼각형마다 2·3번째 정점을 모든 attribute 에서 맞바꾼다.
    for (const attribute of Object.values(geometry.attributes)) {
      const size = attribute.itemSize;
      for (let t = 0; t + 2 < attribute.count; t += 3) {
        for (let k = 0; k < size; k++) {
          const a = attribute.getComponent(t + 1, k), b = attribute.getComponent(t + 2, k);
          attribute.setComponent(t + 1, k, b); attribute.setComponent(t + 2, k, a);
        }
      }
      attribute.needsUpdate = true;
    }
  }
  position.needsUpdate = true; if (normal) normal.needsUpdate = true;
  return geometry;
}

/**
 * 한 짝 지오메트리를 배율·부풀림·이동한 새 지오메트리로. 1본 강체 스킨 속성(skinIndex=boneSlot, weight=1)을 넣는다.
 * 원본(공유 캐시)은 건드리지 않는다.
 */
export function placeBootsGeometry(source, { scale, inflate = BOOTS_INFLATE_RATIO, offset, boneSlot }) {
  const geometry = new THREE.BufferGeometry();
  const position = source.attributes.position, normal = source.attributes.normal;
  source.computeBoundingBox();
  const amount = Math.max(0, inflate) * (source.boundingBox.max.y - source.boundingBox.min.y);
  const out = new Float32Array(position.count * 3), outNormal = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const nx = normal ? normal.getX(i) : 0, ny = normal ? normal.getY(i) : 0, nz = normal ? normal.getZ(i) : 0;
    out[i * 3] = position.getX(i) * scale + nx * amount * scale + offset.x;
    out[i * 3 + 1] = position.getY(i) * scale + ny * amount * scale + offset.y;
    out[i * 3 + 2] = position.getZ(i) * scale + nz * amount * scale + offset.z;
    outNormal[i * 3] = nx; outNormal[i * 3 + 1] = ny; outNormal[i * 3 + 2] = nz;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(outNormal, 3));
  if (source.attributes.uv) geometry.setAttribute('uv', source.attributes.uv.clone());
  const skinIndex = new Uint16Array(position.count * 4), skinWeight = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) { skinIndex[i * 4] = boneSlot; skinWeight[i * 4] = 1; }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  if (source.index) geometry.setIndex(source.index.clone());
  return geometry;
}

const bodySkin = (root) => {
  let found = null;
  root.traverse((node) => { if (!found && node.isSkinnedMesh && node.userData.libraryBody) found = node; });
  return found;
};

function disposeMesh(mesh) {
  mesh.removeFromParent();
  mesh.geometry.dispose(); mesh.skeleton.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
}

/**
 * 정적 부츠 한 짝(오른발)을 영웅 몸에 맞춰 양발 SkinnedMesh 하나로 만든다. 계약·골격이 맞지 않으면 null.
 * @param {THREE.Object3D} bootsScene @param {THREE.SkinnedMesh} skin 영웅 현재 몸 @param {{id: string}} entry
 */
export function buildHeroBootsMesh(bootsScene, skin, entry, makeMaterial = (material) => material.clone()) {
  const sources = [];
  bootsScene.traverse((node) => { if (node.isMesh && !node.isSkinnedMesh) sources.push(node); });
  if (sources.length !== 1 || !skin || Array.isArray(sources[0].material)) return null;
  const source = sources[0];
  if (!bootsGeometryContract(source.geometry)) return null;
  const right = findBoneIndex(skin.skeleton, 'RightFoot'), left = findBoneIndex(skin.skeleton, 'LeftFoot');
  const ankle = heroAnkleHeight(skin);
  if (right < 0 || left < 0 || !ankle) return null;
  const scale = ankle / -source.geometry.boundingBox.min.y;
  if (!(scale >= BOOTS_SCALE_RANGE[0] && scale <= BOOTS_SCALE_RANGE[1])) return null;
  const mirrored = mirrorBootsGeometry(source.geometry);
  const parts = [
    placeBootsGeometry(source.geometry, { scale, offset: boneRestPosition(skin, right), boneSlot: 0 }),
    placeBootsGeometry(mirrored, { scale, offset: boneRestPosition(skin, left), boneSlot: 1 }),
  ];
  mirrored.dispose();
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) return null;
  const material = makeMaterial(source.material);
  material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `HeroBoots_${entry.id}`;
  mesh.userData.heroBoots = entry.id;
  mesh.position.copy(skin.position); mesh.quaternion.copy(skin.quaternion); mesh.scale.copy(skin.scale);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.bindMode = skin.bindMode;
  const bones = [skin.skeleton.bones[right], skin.skeleton.bones[left]];
  const inverses = [skin.skeleton.boneInverses[right].clone(), skin.skeleton.boneInverses[left].clone()];
  mesh.bind(new THREE.Skeleton(bones, inverses), skin.bindMatrix);
  return mesh;
}

/** 부착된 부츠를 치우고 몸의 원래 발을 다시 보인다. 부츠 상태가 없으면 아무것도 하지 않는다. */
export function removeHeroBoots(root) {
  const state = root.userData.heroBoots;
  root.userData.bootsTargetId = null;
  if (!state) return false;
  disposeMesh(state.mesh);
  delete root.userData.heroBoots;
  setGearFeetHidden(root, false);
  return true;
}

/**
 * 영웅 현재 몸에 맞춰 부츠를 다시 만든다(몸 교체 직후: 역바인드·발목 높이가 다르다). 맞지 않으면 부츠를 치운다.
 * @returns {boolean} 부츠가 붙어 있으면 true
 */
export function refitHeroBoots(root, makeMaterial) {
  const state = root.userData.heroBoots;
  if (!state) return false;
  const skin = bodySkin(root);
  const mesh = skin && buildHeroBootsMesh(state.source, skin, state.entry, makeMaterial || state.makeMaterial);
  if (!mesh) { removeHeroBoots(root); return false; }
  disposeMesh(state.mesh);
  skin.parent.add(mesh);
  root.userData.heroBoots = { ...state, mesh };
  setGearFeetHidden(root, true);
  return true;
}

/**
 * 장착한 신발 등급에 맞는 부츠를 붙이거나 바꾸거나 치운다. applyLook 마다 불러도 같은 부츠면 즉시 끝난다.
 * @param {THREE.Object3D} root 라이브러리 영웅 root
 * @param {{rarity?: string}|null} boots 신발 아이템 정의(없으면 null) — 아바타·신발 없음이면 null 을 넘긴다
 * @param {{ data?: any, load: (path: string) => Promise<{scene: THREE.Object3D}>, makeMaterial?: Function, onChange?: Function, warn?: Function }} options
 * @returns {boolean} 부츠가 붙어 있거나 붙이는 중이면 true
 */
export function syncHeroBoots(root, boots, { data = BOOTS_DATA, load, makeMaterial, onChange, warn = console.warn } = {}) {
  const entry = root.userData.authoredContract?.role === 'hero' && boots ? pickBootsEntry(boots.rarity, data) : null;
  if (!entry) { removeHeroBoots(root); return false; }
  if (root.userData.heroBoots?.entry.id === entry.id) { root.userData.bootsTargetId = entry.id; return true; }   // 대기 중인 다른 목표는 무효화
  if (root.userData.bootsTargetId === entry.id) return true;
  root.userData.bootsTargetId = entry.id;
  Promise.resolve().then(() => load(entry.path)).then((gltf) => {
    if (root.userData.libraryDisposed || root.userData.bootsTargetId !== entry.id) return;
    const skin = bodySkin(root);
    const mesh = skin && buildHeroBootsMesh(gltf.scene, skin, entry, makeMaterial);
    if (!mesh) { warn(`hero boots rejected (art contract or skeleton mismatch): ${entry.id}`); root.userData.bootsTargetId = null; return; }
    if (root.userData.heroBoots) disposeMesh(root.userData.heroBoots.mesh);
    skin.parent.add(mesh);
    root.userData.heroBoots = { id: entry.id, entry, source: gltf.scene, mesh, makeMaterial };
    setGearFeetHidden(root, true);
    onChange?.();
  }).catch((error) => {
    if (root.userData.bootsTargetId === entry.id) root.userData.bootsTargetId = null;   // 지난 요청의 실패가 최신 목표를 지우지 않게
    warn(`hero boots failed: ${entry.id}`, error);
  });
  return true;
}
