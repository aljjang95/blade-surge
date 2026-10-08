import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const WEAPON_FORGE_REVISION = 'dungeon-forge-v2';
// 부모 노드 이름과 손 소켓은 기존 장착·애니메이션 계약을 그대로 사용한다.
export const FORGED_WEAPON_FORMS = Object.freeze({
  Knight: { '1H_Sword': 'sword', '2H_Sword': 'greatsword', '1H_Sword_Offhand': 'sword' },
  Barbarian: { '1H_Axe': 'axe', '2H_Axe': 'greataxe', '1H_Axe_Offhand': 'axe' },
  Mage: { '1H_Wand': 'wand', '2H_Staff': 'staff' },
  Rogue: { Knife: 'dagger', Knife_Offhand: 'dagger' },
  Ranger: { Bow: 'bow' },
});
const templates = new Map();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

async function weaponTemplate(form) {
  if (!templates.has(form)) templates.set(form, loader.loadAsync(`/models/dungeon-forge-v2/forge-${form}-v2.glb`).then(gltf => {
    let mesh;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh) { if (mesh) throw Error(`무기 배치가 하나가 아님: ${form}`); mesh = o; } });
    if (!mesh || Array.isArray(mesh.material)) throw Error(`무기 단일 재질 계약 실패: ${form}`);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.material.userData.tllAuthored = true;
    return { geometry, material: mesh.material };
  }).catch(error => { templates.delete(form); throw error; }));
  return templates.get(form);
}

/** 새 형상의 손잡이 원점과 원본 소켓 원점을 일치시킨다. */
export function fitForgedWeapon(geometry, bounds, form = 'sword') {
  const axis = form === 'bow' ? 'z' : 'y';
  const fitted = geometry.clone();
  // 한손 도끼는 원본의 날이 -X를 향한다. 정규 회전으로 면의 감김도 보존한다.
  if (form === 'axe') fitted.rotateY(Math.PI);
  if (form === 'bow') fitted.rotateX(Math.PI / 2);
  fitted.computeBoundingBox();
  const authored = fitted.boundingBox.clone();
  const scale = bounds.getSize(new THREE.Vector3())[axis] / authored.getSize(new THREE.Vector3())[axis];
  if (!Number.isFinite(scale) || scale <= 0 || scale > 20 || bounds.min[axis] >= 0 || bounds.max[axis] <= 0
    || authored.min[axis] >= 0 || authored.max[axis] <= 0) throw Error('무기 손잡이 원점이 점유 범위 안에 없음');
  const positive = bounds.max[axis] / authored.max[axis], negative = bounds.min[axis] / authored.min[axis];
  const positions = fitted.attributes.position, point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    const longitudinal = point[axis];
    point.multiplyScalar(scale);
    // 손잡이에서 날 끝과 손잡이 끝으로 따로 맞춘다. AABB 중심으로 손잡이를 이동하지 않는다.
    point[axis] = longitudinal * (longitudinal >= 0 ? positive : negative);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  fitted.computeVertexNormals(); fitted.computeBoundingBox(); fitted.computeBoundingSphere();
  return fitted;
}

/** 로딩할 때 한 번만 실행한다. 전투 프레임과 캐릭터 생성에서는 버퍼를 공유한다. */
export async function forgeHeroWeapons(gltf, heroName) {
  const forms = FORGED_WEAPON_FORMS[heroName];
  if (!forms || gltf.scene.userData.weaponForge) return gltf;
  gltf.scene.updateMatrixWorld(true);
  const oldGeometries = new Set(), oldMaterials = new Set();
  await Promise.all(Object.entries(forms).map(async ([nodeName, form]) => {
    const node = gltf.scene.getObjectByName(nodeName);
    if (!node) throw Error(`무기 소켓 노드 누락: ${heroName}:${nodeName}`);
    const template = await weaponTemplate(form);
    const inverse = node.matrixWorld.clone().invert(), bounds = new THREE.Box3();
    const sourceMeshes = [];
    node.traverse(o => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) throw Error(`무기 노드에 예상하지 않은 스킨: ${heroName}:${nodeName}`);
      o.geometry.computeBoundingBox();
      bounds.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
      sourceMeshes.push(o); oldGeometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) oldMaterials.add(m);
    });
    if (!sourceMeshes.length || bounds.isEmpty()) throw Error(`기존 무기 형상 누락: ${heroName}:${nodeName}`);
    const geometry = fitForgedWeapon(template.geometry, bounds, form), material = template.material.clone();
    material.userData.tllAuthored = true;
    if (node.isMesh) {
      node.geometry = geometry; node.material = material;
      for (const source of sourceMeshes) if (source !== node) source.removeFromParent();
    } else {
      for (const source of sourceMeshes) source.removeFromParent();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `Forge_${form}`;
      mesh.castShadow = true; mesh.receiveShadow = true; node.add(mesh);
    }
    node.userData.forgedWeapon = form;
    node.userData.weaponForgeBounds = { min: bounds.min.toArray(), max: bounds.max.toArray() };
  }));
  // 공유 원본 텍스처는 남기고, 더 이상 참조되지 않는 교체 대상 버퍼만 회수한다.
  gltf.scene.traverse(o => { if (o.isMesh) { oldGeometries.delete(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) oldMaterials.delete(m); } });
  for (const geometry of oldGeometries) geometry.dispose();
  for (const material of oldMaterials) material.dispose();
  gltf.scene.userData.weaponForge = WEAPON_FORGE_REVISION;
  return gltf;
}
