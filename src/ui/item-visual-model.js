// 장비 3D 모델 빌더 — 썸네일 스튜디오(tools/item-render-variants.html)와 선택 3D 미리보기(item-preview-3d.js)가 함께 쓴다.
// 같은 resolveItemForm 결과를 넣으면 목록 그림과 3D 보기가 같은 형상 · 같은 재질 · 같은 첫 시점에서 시작한다.
//  - 일반 무기: item-forge buildGearModel(item, 형태). 두 손에 같은 무기를 들면(쌍단검 · 쌍도끼) 두 자루를 교차해 놓는다.
//  - 병기고 무기 + 장식형 영웅(마도사 · 암살자 · 궁수): 실제 영웅 GLB 에 forgeHeroWeapons 를 적용한 기본 무기와,
//    실제 applyArmoryAppearance 가 손 소켓에 붙이는 병기고 원본 장식(소켓 기준 0.22배)을 같은 상대 크기로 합친다.
//    전투에서는 장식이 손잡이와 겹쳐 가려지므로, 그림과 3D 보기는 같은 크기 · 같은 방향으로 손잡이 옆에 세워 둔다.
//    장식이 다른 손에 붙는 영웅(궁수: 활은 왼손 · 장식은 오른손)도 같은 규칙으로 놓는다.
//  - 병기고 원본 / 방어구 리그 / 반지 · 신발은 기존 썸네일과 같은 원본을 그대로 쓴다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildGearModel } from '../engine/item-forge.js';
import { forgeHeroWeapons } from '../engine/forged-weapons.js';
import { applyArmoryAppearance, preloadArmory } from '../engine/armory-assets.js';
import { heroModelPaths } from '../engine/hero-model-paths.js';
import { assembleHeroIdentity } from '../engine/hero-identity.js';
import { applyArmorAppearance, removeArmorAppearance } from '../game/armor-appearance.js';
import { ITEM_BY_ID } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { itemRenderSource } from './item-presentation.js';
import { resolveItemForm } from './item-visual-forms.js';

/** 썸네일 · 미리보기 공통 무기 기울기(gear-icon-studio 와 같다). */
export const ITEM_WEAPON_ROLL = -Math.PI / 4;
const VIEW = Object.freeze({ weapon: [.28, .08, 1], ring: [.5, .42, 1], other: [.72, .42, 1] });
/** 부위별 3/4 시선 방향(gear-icon-studio · item-render-studio 와 같은 값). */
export function itemViewDirection(slot) {
  return new THREE.Vector3(...(VIEW[slot] || VIEW.other)).normalize();
}

// 대장간 맞춤(fitForgedWeapon)이 소켓 좌표로 돌린 축을 아이템 정면 좌표로 되돌린다.
const FIT_INVERSE = Object.freeze({ axe: new THREE.Matrix4().makeRotationY(-Math.PI), bow: new THREE.Matrix4().makeRotationX(-Math.PI / 2) });
const IDENTITY = new THREE.Matrix4();
// KayKit 오른손 무기 노드는 손 소켓에서 Y축으로 반 바퀴 돈 상태로 붙는다(1H_Sword · Knife · 2H_Staff 공통).
// 다른 손 장식은 이 방향으로 세워 무기와 나란히 놓는다.
const RIGHT_HAND_FACING = new THREE.Matrix4().makeRotationY(Math.PI);

let defaultLoader = null;
const loaderOf = (loader) => loader || (defaultLoader ||= (() => { const created = new GLTFLoader(); created.setMeshoptDecoder(MeshoptDecoder); return created; })());

function disposeTree(root) {
  const materials = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    for (const material of [node.material].flat()) if (material) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

/** 무기 두 자루를 칼날 중간에서 교차시킨다(기울기 적용 전 좌표). */
function crossPair(first, second, length) {
  const mid = length / 2;
  second.rotation.z = Math.PI / 2;
  second.position.set(mid, mid, -.06 * Math.max(.5, length));
}

let armorRigPromise = null;
async function armorModel(item, loader) {
  armorRigPromise ||= Promise.all([loader.loadAsync('/models/Knight.glb'), loader.loadAsync('/models/tll/knight-casual-v2.glb')])
    .then(([base, casual]) => assembleHeroIdentity(base, casual, 'Knight', 'casual-v2').scene)
    .catch((error) => { armorRigPromise = null; throw error; });
  const rig = await armorRigPromise;
  applyArmorAppearance(rig, { id: 'knight' }, item);
  rig.updateMatrixWorld(true);
  const group = new THREE.Group(), point = new THREE.Vector3();
  rig.traverse((node) => {
    if (!node.isMesh || !node.userData.equippedArmor) return;
    const geometry = node.geometry.clone(), position = geometry.attributes.position;
    if (node.isSkinnedMesh) for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i); node.applyBoneTransform(i, point); position.setXYZ(i, point.x, point.y, point.z); }
    geometry.applyMatrix4(node.matrixWorld); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, node.material.clone()); mesh.name = node.name;
    group.add(mesh);
  });
  removeArmorAppearance(rig);
  if (!group.children.length) throw Error('방어구 메시 없음: ' + item.id);
  return group;
}

async function armoryModel(item, loader) {
  const gltf = await loader.loadAsync('/models/armory-v1/' + item.modelNode + '.glb');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/** 실제 병기고 장착 함수로 장식 메시를 만든다. 손 소켓 두 개짜리 탐침 골격에 붙여 어느 손 · 어떤 크기인지 그대로 받는다. */
function armoryOrnaments(item, heroId) {
  const bones = { r: new THREE.Bone(), l: new THREE.Bone() };
  bones.r.name = 'handslot.r'; bones.l.name = 'handslot.l';
  const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  skin.name = 'TLL_item_visual_probe';
  const probe = new THREE.Group(); probe.add(skin, bones.r, bones.l);
  skin.bind(new THREE.Skeleton([bones.r, bones.l]));
  applyArmoryAppearance(probe, { weapon: { id: item.id, enh: 0 } }, ITEM_BY_ID, { id: heroId });
  const ornaments = [];
  for (const side of /** @type {const} */ (['r', 'l'])) for (const mesh of [...bones[side].children]) {
    if (!mesh.userData.armoryItem) continue;
    mesh.removeFromParent(); ornaments.push({ side, mesh });
  }
  skin.geometry.dispose(); skin.material.dispose();
  if (!ornaments.length) throw Error('병기고 장식이 붙지 않음: ' + item.id + ' · ' + heroId);
  return ornaments;
}

// GLTFLoader 는 노드 이름의 '.' 을 지운다(handslot.r → handslotr). 두 표기를 모두 받는다.
const handSocketOf = (node) => { for (let parent = node.parent; parent; parent = parent.parent) if (/^handslot\.?[rl]$/.test(parent.name)) return parent; return null; };
const handOf = (node) => { const socket = handSocketOf(node); return socket ? /** @type {'r'|'l'} */ (socket.name.slice(-1)) : null; };

/** 병기고 무기를 장식으로 착용하는 영웅: 실제 기본 무기(대장간 v2 맞춤 결과) + 실제 장식. */
async function armoryOrnamentParts(item, form, loader) {
  const hero = HEROES[form.heroId];
  if (!hero) throw Error('영웅 없음: ' + form.heroId);
  const [gltf] = await Promise.all([loader.loadAsync(heroModelPaths(hero.model).base), preloadArmory()]);
  await forgeHeroWeapons(gltf, hero.model);
  gltf.scene.updateMatrixWorld(true);
  const fit = FIT_INVERSE[form.form] || IDENTITY;
  const parts = form.nodes.map((name) => {
    const node = gltf.scene.getObjectByName(name);
    if (!node) throw Error('기본 무기 노드 없음: ' + hero.model + ':' + name);
    const socket = handSocketOf(node);
    if (!socket) throw Error('손 소켓 없음: ' + hero.model + ':' + name);
    const toNode = node.matrixWorld.clone().invert();
    const group = new THREE.Group(); group.name = 'Held_' + name;
    node.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toNode, mesh.matrixWorld)).applyMatrix4(fit);
      const held = new THREE.Mesh(geometry, [mesh.material].flat().length > 1 ? [mesh.material].flat().map((m) => m.clone()) : mesh.material.clone());
      held.name = 'Held_' + (mesh.name || name);
      group.add(held);
    });
    if (!group.children.length) throw Error('기본 무기 메시 없음: ' + hero.model + ':' + name);
    // 손 소켓 좌표 → 이 무기 노드 좌표 → 아이템 정면 좌표
    const handToItem = new THREE.Matrix4().multiplyMatrices(fit, new THREE.Matrix4().multiplyMatrices(toNode, socket.matrixWorld));
    return { name, hand: handOf(node), group, handToItem };
  });
  const box = new THREE.Box3().setFromObject(parts[0].group);
  const weapon = box.clone(), length = box.max.y - Math.max(0, box.min.y);
  if (parts.length > 1) crossPair(parts[0].group, parts[1].group, length);
  // 장식 메시 여러 개를 한 덩어리로 옮긴다(조각별로 옮기면 흩어진다).
  const host = parts[0], ornament = new THREE.Group(), ornamentBox = new THREE.Box3();
  ornament.name = 'Ornament_' + item.id;
  for (const { side, mesh } of armoryOrnaments(item, form.heroId)) {
    const same = parts.find((part) => part.hand === side);
    // 같은 손이면 그 무기 노드 좌표로, 다른 손이면 같은 축척의 오른손 방향으로 세운다.
    const scale = new THREE.Vector3(); host.handToItem.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const toItem = same ? new THREE.Matrix4().copy(same.handToItem).setPosition(0, 0, 0) : new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z).premultiply(RIGHT_HAND_FACING);
    mesh.geometry.applyMatrix4(toItem);
    mesh.geometry.computeBoundingBox(); ornamentBox.union(mesh.geometry.boundingBox);
    mesh.name = 'Ornament_' + item.id;
    ornament.add(mesh);
  }
  const size = ornamentBox.getSize(new THREE.Vector3()), center = ornamentBox.getCenter(new THREE.Vector3());
  const gap = Math.max(.03, length * .04);
  // 손잡이(원점) 높이에서 시작해 무기 오른쪽에 세운다.
  ornament.position.set(weapon.max.x + gap + size.x / 2 - center.x, size.y / 2 - center.y, -center.z);
  host.group.add(ornament);
  return parts.map((part) => part.group);
}

/**
 * 장비 하나의 3D 모델을 만든다. 무기는 썸네일과 같은 기울기를 적용한 상태로 돌려준다.
 * 반환 객체의 userData.dispose() 가 자신이 만든 형상 · 재질만 해제한다(공유 원본 텍스처는 남긴다).
 * @param {any} item ITEM_BY_ID 항목
 * @param {import('./item-visual-forms.js').ItemFormResolution} [form] resolveItemForm 결과(없으면 기본 형태)
 * @param {{ loader?: GLTFLoader }} [options]
 * @returns {Promise<THREE.Group>}
 */
export async function buildItemVisualModel(item, form = resolveItemForm(item), options = {}) {
  const loader = loaderOf(options.loader);
  const source = itemRenderSource(item);
  const root = new THREE.Group();
  root.name = 'ItemVisual_' + item.id + '@' + form.formKey;
  root.userData.itemVisual = { itemId: item.id, heroId: form.heroId, variant: form.variant, formKey: form.formKey, renderKey: form.renderKey, source };
  const holder = new THREE.Group();
  if (item.slot === 'weapon') holder.rotation.z = ITEM_WEAPON_ROLL;
  root.add(holder);
  /** @type {Array<() => void>} */
  const disposers = [];
  /** @template {THREE.Object3D} T @param {T} object @returns {T} */
  const add = (object) => { holder.add(object); return object; };
  try {
    if (item.slot === 'weapon' && form.variant === 'armory-ornament') {
      for (const group of await armoryOrnamentParts(item, form, loader)) add(group);
      disposers.push(() => disposeTree(holder));
    } else if (source === 'armory-glb') {
      add(await armoryModel(item, loader));
      disposers.push(() => disposeTree(holder));
    } else if (source === 'armor-rig') {
      add(await armorModel(item, loader));
      disposers.push(() => disposeTree(holder));
    } else if (item.slot === 'weapon') {
      const count = Math.max(1, form.count || 1), shape = form.variant === 'armory-own' || form.form === 'armory' ? 'sword' : form.form;
      const meshes = Array.from({ length: count }, () => add(buildGearModel(item, shape)));
      if (meshes.length > 1) {
        const box = new THREE.Box3().setFromObject(meshes[0]);
        crossPair(meshes[0], meshes[1], box.max.y - Math.max(0, box.min.y));
      }
      // 대장간 형상은 캐시 임대를 쓰므로 mesh 자신의 dispose 로 반환한다.
      for (const mesh of meshes) disposers.push(() => mesh.userData.dispose());
    } else {
      const mesh = add(buildGearModel(item, item.slot));
      disposers.push(() => mesh.userData.dispose());
    }
  } catch (error) {
    for (const dispose of disposers) dispose();
    throw error;
  }
  let disposed = false;
  root.userData.dispose = () => {
    if (disposed) return; disposed = true;
    root.removeFromParent();
    for (const dispose of disposers) dispose();
  };
  root.updateMatrixWorld(true);
  return root;
}
