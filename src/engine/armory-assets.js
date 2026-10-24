import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARMORY_ITEMS } from '../data/armory.js';

const templates = new Map();
let pending;
export function preloadArmory() {
  if (!pending) pending = Promise.all(ARMORY_ITEMS.map(async item => {
    const gltf = await new GLTFLoader().loadAsync(`/models/armory-v1/${item.modelNode}.glb`);
    gltf.scene.updateMatrixWorld(true); templates.set(item.id, gltf.scene);
  })).catch(error => { pending = null; throw error; });
  return pending;
}

export function removeArmoryAppearance(model) {
  const owned = [];
  model.traverse(o => { if (o.userData.armoryItem) owned.push(o); });
  for (const o of owned) { o.removeFromParent(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); }
  delete model.userData.armoryAppearance;
}

export function bootHalf(geometry, side) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const groups = result.groups.length ? [...result.groups] : [{ start: 0, count: result.attributes.position.count, materialIndex: 0 }];
  const positions = result.attributes.position, indices = [];
  result.clearGroups();
  for (const group of groups) {
    const start = indices.length;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const center = positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2);
      if (side < 0 ? center < 0 : center >= 0) indices.push(i, i + 1, i + 2);
    }
    if (indices.length > start) result.addGroup(start, indices.length - start, group.materialIndex);
  }
  result.setIndex(indices); return result;
}

// Fit accessories in the authored bind pose. Weapon ornament preserves every
// class's original weapon and combat silhouette, including the ranger's bow.
export function applyArmoryAppearance(model, equip, definitions, hero = {}) {
  removeArmoryAppearance(model);
  let skin;
  model.traverse(o => { if (o.isSkinnedMesh && o.name.startsWith('TLL_') && !skin) skin = o; });
  if (!skin) return;
  const attachments = [];
  const fit = {
    weapon: ['handslot.r', [0, 0, 0], ['knight', 'barbarian'].includes(hero.id) ? .85 : .22],
    armor: ['chest', [0, 1.07, .23], .8],
    ring: ['wrist.l', [.55, .87, .06], .27],
    boots: ['hips', [0, .29, .06], .75],
  };
  for (const slot of Object.keys(fit)) {
    const item = definitions[equip[slot]?.id], template = templates.get(item?.id); if (!template) continue;
    let [boneName, position, scale] = fit[slot];
    // Rings sit on the left forearm; each greave follows its own foot bone.
    let index = skin.skeleton.bones.findIndex(b => b.name.replaceAll('.', '') === boneName.replaceAll('.', ''));
    if (index < 0 && slot === 'ring') index = skin.skeleton.bones.findIndex(b => /lowerarm\.?l$/.test(b.name));
    if (index < 0) continue;
    const bindings = slot === 'boots' ? [-1, 1].map(side => ({ side, index: skin.skeleton.bones.findIndex(b => b.name.replaceAll('.', '') === (side < 0 ? 'footr' : 'footl')) })) : [{ side: 0, index }];
    for (const binding of bindings) {
     if (binding.index < 0) continue;
     const transform = new THREE.Matrix4().makeScale(scale, scale, scale);
     transform.setPosition(...position);
     if (slot !== 'weapon') transform.premultiply(skin.skeleton.boneInverses[binding.index]);
     template.traverse(source => {
      if (!source.isMesh) return;
      const geometry = (binding.side ? bootHalf(source.geometry, binding.side) : source.geometry.clone()).applyMatrix4(source.matrixWorld).applyMatrix4(transform);
      const materials = (Array.isArray(source.material) ? source.material : [source.material]).map(m => m.clone());
      let disposed = false;
      for (const m of materials) m.addEventListener('dispose', () => { if (!disposed) { geometry.dispose(); disposed = true; } });
      const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
      mesh.name = `Armory_${slot}`; mesh.userData.armoryItem = item.id;
      mesh.castShadow = true; mesh.frustumCulled = false;
      skin.skeleton.bones[binding.index].add(mesh);
     });
    }
    attachments.push(item.id);
  }
  model.userData.armoryAppearance = attachments;
}
