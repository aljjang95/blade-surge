import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import PARTS_DATA from '../data/hero-gear-parts.json';
import { findBoneIndex, boneRestPosition, mirrorBootsGeometry } from './hero-boots.js';

/**
 * 갑옷 외형 파츠(투구·어깨·건틀릿) 런타임 부착 경로. 설계와 근거는 docs/GEAR_VISUAL_PIPELINE.md.
 *  · 갑옷 아이템 하나가 외형 세트(라이브러리 항목)를 고른다: 등급 → 세트 id(규칙), 세트 테마(storm·frost…) → 재질 틴트·발광.
 *    장비마다 모델을 만들지 않는다. 항목별 예외는 data.items 로만 둔다.
 *  · 세트 GLB 한 개에 파츠 메시(이름 helm·pauldron·gauntlet)가 들어 있다. 오른쪽 한 짝만 저작하고 왼쪽은 x 반전 복제.
 *  · 파츠마다 정해진 몸 관절 하나에 1본 강체 스킨으로 붙는다(부츠 hero-boots.js 와 같은 방식). 같은 재질(아틀라스)을 쓰는
 *    파츠는 SkinnedMesh 하나로 합쳐 영웅당 드로우콜을 재질 수만큼만 늘린다.
 *  · 크기는 영웅마다 자동: 슬롯별 몸 치수(머리 높이·어깨 폭·아래팔 길이) ÷ 저작 기준값(data.slots[slot].ref).
 *  · 방향은 관절 rest 방향(예: 위팔 → 아래팔)에 저작 축을 맞춘다. T·A 자세 몸이 섞여도 어깨·장갑이 팔을 따라간다.
 *  · 몸 단계가 이미 그 부위를 덮으면(data.bodyCovers, 예: 3단계 투구 달린 몸) 그 파츠는 만들지 않는다.
 *  · 항목이 없거나 N 등급·아바타면 아무것도 만들지 않는다(무동작).
 */
export const GEAR_PARTS_SCHEMA = 'blade-surge.hero-gear-parts.v1';
export const GEAR_PART_SLOTS = Object.freeze(['helm', 'pauldron', 'gauntlet']);
export const GEAR_PART_GRADES = Object.freeze(['N', 'S', 'E', 'U', 'L']);
export const GEAR_PARTS_TRIANGLE_LIMIT = 6000;
export const GEAR_PARTS_SCALE_RANGE = Object.freeze([0.3, 3]);
export const GEAR_PARTS_INFLATE_RATIO = 0.01;
const digest = /^[a-f0-9]{64}$/;
const hex = /^#[0-9a-f]{6}$/i;

/** 슬롯 규칙: 붙는 관절(오른쪽), 방향 관절 쌍, 저작 축(오른쪽 기준), 치수. 왼쪽은 이름의 Right → Left, 축 x 반전. */
export const SLOT_RIGS = Object.freeze({
  helm: { bone: 'Head', mirror: false, axis: ['Head', 'HeadTopEnd'], authored: [0, 1, 0], measure: 'headTop' },
  pauldron: { bone: 'RightArm', mirror: true, axis: ['RightArm', 'RightForeArm'], authored: [-1, 0, 0], measure: 'shoulderSpan' },
  gauntlet: { bone: 'RightHand', mirror: true, axis: ['RightForeArm', 'RightHand'], authored: [-1, 0, 0], measure: 'forearm' },
});
const leftOf = (name) => name.replace(/^Right/, 'Left');

export function validateGearPartsData(value) {
  if (!value || value.schema !== GEAR_PARTS_SCHEMA || !Array.isArray(value.sets) || !value.slots || !value.grades) throw new Error('invalid hero gear parts schema');
  for (const slot of GEAR_PART_SLOTS) {
    const ref = value.slots[slot]?.ref;
    if (!(Number.isFinite(ref) && ref > 0)) throw new Error(`invalid gear part slot ref: ${slot}`);
  }
  const ids = new Set();
  for (const set of value.sets) {
    if (!set || typeof set.id !== 'string' || !/^parts_[a-z0-9_]{1,40}$/.test(set.id) || ids.has(set.id)) throw new Error('invalid or duplicate gear parts id');
    ids.add(set.id);
    if (set.path !== `/models/gear-parts/${set.id}.glb`) throw new Error('invalid gear parts path');
    if (!Array.isArray(set.parts) || !set.parts.length || set.parts.some((p) => !GEAR_PART_SLOTS.includes(p))) throw new Error('invalid gear parts list');
    if (!Number.isInteger(set.triangles) || set.triangles <= 0 || set.triangles > GEAR_PARTS_TRIANGLE_LIMIT) throw new Error('gear parts triangle budget exceeded');
    if (typeof set.sha256 !== 'string' || !digest.test(set.sha256)) throw new Error('invalid gear parts digest');
  }
  for (const [grade, id] of Object.entries(value.grades)) {
    if (!GEAR_PART_GRADES.includes(grade) || (id !== null && !ids.has(id))) throw new Error(`invalid gear parts grade mapping: ${grade}`);
  }
  for (const [id, rule] of Object.entries(value.items || {})) {
    if (!rule || (rule.set !== undefined && rule.set !== null && !ids.has(rule.set)) || (rule.hide && !rule.hide.every((p) => GEAR_PART_SLOTS.includes(p)))) throw new Error(`invalid gear parts item rule: ${id}`);
  }
  for (const [asset, covers] of Object.entries(value.bodyCovers || {})) {
    if (!Array.isArray(covers) || covers.some((p) => !GEAR_PART_SLOTS.includes(p))) throw new Error(`invalid body covers: ${asset}`);
  }
  const fitOk = (fit) => !fit || Object.entries(fit).every(([slot, f]) => GEAR_PART_SLOTS.includes(slot) && (f.scale === undefined || (f.scale > 0.5 && f.scale < 2))
    && (f.offset === undefined || (Array.isArray(f.offset) && f.offset.length === 3 && f.offset.every((n) => Math.abs(n) <= 0.5))));
  for (const set of value.sets) if (!fitOk(set.fit)) throw new Error(`invalid gear parts fit: ${set.id}`);
  for (const [hero, fit] of Object.entries(value.heroFit || {})) if (!fitOk(fit)) throw new Error(`invalid gear parts hero fit: ${hero}`);
  for (const [grade, tint] of Object.entries(value.tint || {})) {
    if (!GEAR_PART_GRADES.includes(grade) || !(tint.color >= 0 && tint.color <= 1) || !(tint.glow >= 0 && tint.glow <= 1)) throw new Error(`invalid gear parts tint: ${grade}`);
  }
  return value;
}
validateGearPartsData(PARTS_DATA);

/**
 * 갑옷 아이템 → 외형 요청 { set, parts, theme }. 파츠가 없으면 null.
 * @param {{id?: string, rarity?: string, set?: string}|null} armor 갑옷 정의
 * @param {{ bodyAssetId?: string, hide?: string[], heroId?: string|null, data?: any }} [options]
 */
export function pickGearParts(armor, { bodyAssetId = '', hide = [], heroId = null, data = PARTS_DATA } = {}) {
  if (!armor || (armor.slot && armor.slot !== 'armor')) return null;
  const rule = data.items?.[armor.id] || {};
  const setId = rule.set !== undefined ? rule.set : data.grades[armor.rarity] ?? null;
  const set = setId && data.sets.find((entry) => entry.id === setId);
  if (!set) return null;
  const skip = new Set([...(rule.hide || []), ...hide, ...(data.bodyCovers?.[bodyAssetId] || [])]);
  const parts = set.parts.filter((part) => !skip.has(part));
  if (!parts.length) return null;
  return { set, parts, theme: armor.set || null, grade: armor.rarity, heroId: heroId || null };
}

/** 몸 지오메트리 공간에서 슬롯 치수. 못 구하면 null. */
export function heroSlotMeasure(skin, measure) {
  const at = (name) => { const index = findBoneIndex(skin.skeleton, name); return index < 0 ? null : boneRestPosition(skin, index); };
  let value = null;
  if (measure === 'headTop') {
    const head = at('Head');
    if (head) { skin.geometry.computeBoundingBox(); value = skin.geometry.boundingBox.max.y - head.y; }
  } else if (measure === 'shoulderSpan') {
    const right = at('RightArm'), left = at('LeftArm');
    if (right && left) value = right.distanceTo(left) / 2;
  } else if (measure === 'forearm') {
    const elbow = at('RightForeArm'), hand = at('RightHand');
    if (elbow && hand) value = elbow.distanceTo(hand);
  }
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 저작 축 → 관절 rest 방향 회전. 방향 관절이 없거나 겹치면 회전 없음. */
export function slotRestRotation(skin, [from, to], authored, mirrored = false) {
  const a = findBoneIndex(skin.skeleton, mirrored ? leftOf(from) : from), b = findBoneIndex(skin.skeleton, mirrored ? leftOf(to) : to);
  const quaternion = new THREE.Quaternion();
  if (a < 0 || b < 0) return quaternion;
  const direction = boneRestPosition(skin, b).sub(boneRestPosition(skin, a));
  if (direction.lengthSq() < 1e-10) return quaternion;
  const axis = new THREE.Vector3(mirrored ? -authored[0] : authored[0], authored[1], authored[2]).normalize();
  return quaternion.setFromUnitVectors(axis, direction.normalize());
}

/** 파츠 한 짝을 배율·부풀림·회전·이동한 새 지오메트리로(1본 강체 스킨 속성 포함). 원본은 건드리지 않는다. */
export function placePartGeometry(source, { scale, rotation, offset, boneSlot, inflate = GEAR_PARTS_INFLATE_RATIO }) {
  const position = source.attributes.position, normal = source.attributes.normal;
  source.computeBoundingBox();
  const size = source.boundingBox.getSize(new THREE.Vector3());
  const amount = Math.max(0, inflate) * Math.max(size.x, size.y, size.z);
  const out = new Float32Array(position.count * 3), outNormal = new Float32Array(position.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    if (normal) n.fromBufferAttribute(normal, i); else n.set(0, 0, 0);
    v.fromBufferAttribute(position, i).addScaledVector(n, amount).multiplyScalar(scale).applyQuaternion(rotation).add(offset);
    n.applyQuaternion(rotation);
    out.set([v.x, v.y, v.z], i * 3); outNormal.set([n.x, n.y, n.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
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

/** 세트 GLB 에서 슬롯 이름의 정적 메시(재질 하나)를 찾는다. */
function partSource(scene, slot) {
  let found = null;
  scene.traverse((node) => { if (!found && node.isMesh && !node.isSkinnedMesh && node.name.toLowerCase().startsWith(slot) && !Array.isArray(node.material)) found = node; });
  return found;
}

/** 테마 틴트: 기본색을 테마색 쪽으로 color 만큼, 발광을 테마색 × glow 로. */
export function applyPartTint(material, themeColor, tint) {
  if (themeColor === null || themeColor === undefined || !tint) return material;
  const color = new THREE.Color(themeColor);
  if (material.color) material.color.lerp(color, tint.color);
  if (material.emissive) {
    // 세기는 색에 굽는다: 피격 번쩍임(Actor)·applyLook 이 emissive 를 authoredEmissive/baseEmissive 로 되돌리므로 그 기준값도 같이 바꾼다.
    material.emissive.copy(color).multiplyScalar(tint.glow);
    material.userData.authoredEmissive = material.emissive.clone();
    material.userData.baseEmissive = material.emissive.clone();
  }
  return material;
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
 * 세트 GLB 를 영웅 몸에 맞춰 SkinnedMesh 목록(재질별 하나)으로. 맞는 파츠가 하나도 없으면 null.
 * @param {THREE.Object3D} scene 세트 GLB scene @param {THREE.SkinnedMesh} skin 영웅 현재 몸
 * @param {{set: any, parts: string[], theme: string|null, grade: string}} pick
 */
export function buildHeroGearPartMeshes(scene, skin, pick, { data = PARTS_DATA, makeMaterial = (m) => m.clone(), themeColor = null } = {}) {
  if (!skin) return null;
  const groups = new Map();   // 원본 재질 → { pieces, bones }
  for (const slot of pick.parts) {
    const rig = SLOT_RIGS[slot], source = partSource(scene, slot);
    const measure = heroSlotMeasure(skin, rig.measure);
    if (!source || !measure) continue;
    // 맞춤 보정(선택): 세트별 fit[slot] · 영웅별 heroFit[heroId][slot] = { scale 배수, offset [x,y,z] 저작 단위(오른쪽 기준) }.
    const fits = [pick.set.fit?.[slot], data.heroFit?.[pick.heroId]?.[slot]].filter(Boolean);
    const scale = measure / data.slots[slot].ref * fits.reduce((k, f) => k * (f.scale ?? 1), 1);
    const shift = fits.reduce((v, f) => v.add(new THREE.Vector3().fromArray(f.offset || [0, 0, 0])), new THREE.Vector3());
    if (!(scale >= GEAR_PARTS_SCALE_RANGE[0] && scale <= GEAR_PARTS_SCALE_RANGE[1])) continue;
    const sides = rig.mirror ? [false, true] : [false];
    const indices = sides.map((m) => findBoneIndex(skin.skeleton, m ? leftOf(rig.bone) : rig.bone));
    if (indices.some((i) => i < 0)) continue;
    const group = groups.get(source.material) || { pieces: [], bones: [] };
    groups.set(source.material, group);
    sides.forEach((mirrored, k) => {
      const geometry = mirrored ? mirrorBootsGeometry(source.geometry) : source.geometry;
      let boneSlot = group.bones.indexOf(indices[k]);
      if (boneSlot < 0) boneSlot = group.bones.push(indices[k]) - 1;
      const rotation = slotRestRotation(skin, rig.axis, rig.authored, mirrored);
      const local = shift.clone().multiplyScalar(scale); if (mirrored) local.x = -local.x;
      group.pieces.push(placePartGeometry(geometry, { scale, rotation, offset: boneRestPosition(skin, indices[k]).add(local.applyQuaternion(rotation)), boneSlot }));
      if (mirrored) geometry.dispose();
    });
  }
  const meshes = [];
  for (const [sourceMaterial, group] of groups) {
    const geometry = mergeGeometries(group.pieces);
    for (const piece of group.pieces) piece.dispose();
    if (!geometry) continue;
    const material = applyPartTint(makeMaterial(sourceMaterial), themeColor, data.tint?.[pick.grade]);
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `HeroGearParts_${pick.set.id}`;
    mesh.userData.heroGearParts = pick.set.id;
    mesh.position.copy(skin.position); mesh.quaternion.copy(skin.quaternion); mesh.scale.copy(skin.scale);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.bindMode = skin.bindMode;
    mesh.bind(new THREE.Skeleton(group.bones.map((i) => skin.skeleton.bones[i]), group.bones.map((i) => skin.skeleton.boneInverses[i].clone())), skin.bindMatrix);
    meshes.push(mesh);
  }
  return meshes.length ? meshes : null;
}

const pickKey = (pick, themeColor) => `${pick.set.id}|${pick.parts.join(',')}|${pick.grade}|${themeColor ?? ''}`;

/** 붙은 파츠를 치운다. 상태가 없으면 아무것도 하지 않는다. */
export function removeHeroGearParts(root) {
  const state = root.userData.heroGearParts;
  root.userData.gearPartsTarget = null;
  if (!state) return false;
  for (const mesh of state.meshes) disposeMesh(mesh);
  delete root.userData.heroGearParts;
  return true;
}

/**
 * 몸 교체 직후 새 몸의 본·역바인드·치수로 다시 만든다. 새 몸이 그 부위를 덮으면(bodyCovers) 그 파츠는 빠진다.
 * @returns {boolean} 파츠가 붙어 있으면 true
 */
export function refitHeroGearParts(root, makeMaterial) {
  const state = root.userData.heroGearParts;
  if (!state) return false;
  const skin = bodySkin(root);
  const covers = new Set(state.data.bodyCovers?.[root.userData.libraryBodyAssetId] || []);
  const pick = { ...state.pick, parts: state.pick.parts.filter((p) => !covers.has(p)) };
  const meshes = skin && pick.parts.length && buildHeroGearPartMeshes(state.source, skin, pick, { data: state.data, makeMaterial: makeMaterial || state.makeMaterial, themeColor: state.themeColor });
  if (!meshes) { removeHeroGearParts(root); return false; }
  for (const mesh of state.meshes) disposeMesh(mesh);
  for (const mesh of meshes) skin.parent.add(mesh);
  root.userData.heroGearParts = { ...state, meshes };
  return true;
}

/**
 * 장착 갑옷에 맞는 파츠를 붙이거나 바꾸거나 치운다. applyLook 마다 불러도 같은 요청이면 즉시 끝난다.
 * @param {THREE.Object3D} root 라이브러리 영웅 root
 * @param {any|null} armor 갑옷 정의(아바타·갑옷 없음이면 null)
 * @param {{ data?: any, load: (path: string) => Promise<{scene: THREE.Object3D}>, makeMaterial?: Function, themeColor?: number|null, hide?: string[], onChange?: Function, warn?: Function }} options
 * @returns {boolean} 파츠가 붙어 있거나 붙이는 중이면 true
 */
export function syncHeroGearParts(root, armor, { data = PARTS_DATA, load, makeMaterial, themeColor = null, hide = [], onChange, warn = console.warn } = {}) {
  const pick = root.userData.authoredContract?.role === 'hero' ? pickGearParts(armor, { bodyAssetId: root.userData.libraryBodyAssetId, hide, heroId: root.userData.authoredContract.heroId, data }) : null;
  if (!pick) { removeHeroGearParts(root); return false; }
  const key = pickKey(pick, themeColor);
  if (root.userData.heroGearParts?.key === key) { root.userData.gearPartsTarget = key; return true; }   // 대기 중인 다른 목표는 무효화
  if (root.userData.gearPartsTarget === key) return true;
  root.userData.gearPartsTarget = key;
  Promise.resolve().then(() => load(pick.set.path)).then((gltf) => {
    if (root.userData.libraryDisposed || root.userData.gearPartsTarget !== key) return;
    const skin = bodySkin(root);
    const meshes = skin && buildHeroGearPartMeshes(gltf.scene, skin, pick, { data, makeMaterial, themeColor });
    if (!meshes) { warn(`hero gear parts rejected (art contract or skeleton mismatch): ${pick.set.id}`); root.userData.gearPartsTarget = null; return; }
    if (root.userData.heroGearParts) for (const mesh of root.userData.heroGearParts.meshes) disposeMesh(mesh);
    for (const mesh of meshes) skin.parent.add(mesh);
    root.userData.heroGearParts = { key, pick, source: gltf.scene, meshes, makeMaterial, themeColor, data };
    onChange?.();
  }).catch((error) => {
    if (root.userData.gearPartsTarget === key) root.userData.gearPartsTarget = null;   // 지난 요청의 실패가 최신 목표를 지우지 않게
    warn(`hero gear parts failed: ${pick.set.id}`, error);
  });
  return true;
}
