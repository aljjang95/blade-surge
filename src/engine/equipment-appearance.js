import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARMOR_VISUALS, ARMOR_VISUAL_BASE, armorVisualFor } from '../data/armor-visuals.js';

const templates = new Map(), compiled = new WeakMap(), instances = new WeakMap();
let loading;
const normalized = name => String(name || '').replaceAll('.', '');

/** Optional appearance files never prevent the rest of the game from starting. */
export function preloadEquipmentAppearances() {
  if (!loading) loading = Promise.all(Object.entries(ARMOR_VISUALS).map(async ([id, spec]) => {
    try {
      const response = await fetch(ARMOR_VISUAL_BASE + spec.file, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Armor download failed');
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), ARMOR_VISUAL_BASE);
      templates.set(id, gltf.scene);
      return { id, ready: true };
    } catch {
      console.warn('Armor appearance unavailable:', id);
      return { id, ready: false };
    }
  }));
  return loading;
}

/** Keep authored UVs, PBR materials and bind-pose positions; batch by material. */
export function compileEquipmentAppearance(source, skeleton) {
  const key = skeleton.bones.map(b => b.name).join('|');
  const previous = compiled.get(source)?.get(key);
  if (previous) return previous;
  source.updateMatrixWorld(true);
  const entries = [];
  source.traverse(object => {
    if (!object.isMesh) return;
    let bone;
    for (let p = object; p && !bone; p = p.parent) bone = p.userData.tllBone;
    const index = skeleton.bones.findIndex(b => normalized(b.name) === normalized(bone));
    if (index < 0 || Array.isArray(object.material)) throw new Error('Invalid armor binding');
    const geometry = object.geometry;
    if (!geometry.index || !geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv)
      throw new Error('Armor requires indexed positions, normals and authored UV');
    entries.push({ object, index });
  });
  if (!entries.length || entries.length > 160) throw new Error('Invalid armor mesh count');
  const groups = new Map(), result = [];
  try {
    for (const { object, index } of entries) {
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const count = geometry.attributes.position.count;
      const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      if (!groups.has(object.material)) groups.set(object.material, []);
      groups.get(object.material).push(geometry);
    }
    for (const [material, parts] of groups) {
      const geometry = mergeGeometries(parts);
      if (!geometry) throw new Error('Armor batching failed');
      result.push({ geometry, material });
    }
    if (result.length > 8) throw new Error('Armor material budget exceeded');
  } catch (error) {
    for (const entry of result) entry.geometry.dispose();
    throw error;
  } finally {
    for (const parts of groups.values()) for (const geometry of parts) geometry.dispose();
  }
  if (!compiled.has(source)) compiled.set(source, new Map());
  compiled.get(source).set(key, result);
  return result;
}

/** Dispose only instance materials; shared geometries, textures and rig remain owned by their caches. */
export function removeEquipmentAppearance(model) {
  const state = instances.get(model);
  if (!state) return;
  for (const mesh of state.meshes) { mesh.removeFromParent(); mesh.material.dispose(); }
  for (const [mesh, visible] of state.base) mesh.visible = visible;
  instances.delete(model);
  delete model.userData.equipmentAppearance;
}

export function applyEquipmentAppearance(model, hero, item, library = templates) {
  const spec = armorVisualFor(item?.id, hero?.id);
  if (!spec || model.userData.tllIdentity !== 'expedition-v3') {
    removeEquipmentAppearance(model);
    delete model.userData.equipmentAppearanceError;
    return false;
  }
  if (instances.get(model)?.id === item.id) return true;
  const source = library.get(item.id);
  let skin;
  model.traverse(o => { if (!skin && o.isSkinnedMesh && /^TLL_Knight_/.test(o.name)) skin = o; });
  if (!source || !skin) {
    removeEquipmentAppearance(model);
    model.userData.equipmentAppearanceError = item.id;
    return false;
  }
  let parts;
  try { parts = compileEquipmentAppearance(source, skin.skeleton); }
  catch {
    removeEquipmentAppearance(model);
    model.userData.equipmentAppearanceError = item.id;
    return false;
  }
  const meshes = parts.map(({ geometry, material }) => {
    const owned = material.clone();
    owned.userData.equipmentAuthored = true;
    owned.userData.authoredEmissive = owned.emissive?.clone() || new THREE.Color(0);
    owned.userData.baseEmissive = owned.userData.authoredEmissive.clone();
    owned.envMapIntensity = Math.min(owned.envMapIntensity, .75);
    const mesh = new THREE.SkinnedMesh(geometry, owned);
    mesh.name = 'Equipment_' + item.id + '_' + material.name;
    mesh.userData.equipmentItem = item.id;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.bind(skin.skeleton, skin.bindMatrix);
    return mesh;
  });
  removeEquipmentAppearance(model);
  const base = [];
  model.traverse(o => { if (o.isSkinnedMesh && /^TLL_Knight_/.test(o.name)) base.push([o, o.visible]); });
  for (const [mesh] of base) mesh.visible = false;
  for (const mesh of meshes) model.add(mesh);
  instances.set(model, { id: item.id, meshes, base });
  model.userData.equipmentAppearance = { id: item.id, materials: meshes.length, authoredUv: true };
  delete model.userData.equipmentAppearanceError;
  return true;
}
