import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { projectSurfaceUV, applySurfaceDetail } from './surface-textures.js';

/** Geometry is authored in the original rig's rest-world coordinates. */
export function assembleEncounterIdentity(gltf, authored, name, config) {
  gltf.scene.updateMatrixWorld(true); authored.scene.updateMatrixWorld(true);
  let source;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh && !source) source = o.skeleton; });
  if (!source) throw Error(`Missing encounter rig: ${name}`);
  const normalize = s => s.replaceAll('.', '');
  const groups = new Map();
  authored.scene.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) throw Error(`Unbatched encounter surface: ${name}`);
    let bone;
    for (let p = o; p && !bone; p = p.parent) bone = p.userData.tllBone;
    const index = source.bones.findIndex(b => normalize(b.name) === normalize(bone || ''));
    if (index < 0) throw Error(`Missing encounter joint: ${name}:${bone}`);
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(key)) geometry.deleteAttribute(key);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    projectSurfaceUV(geometry);
    const n = geometry.attributes.position.count, indices = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const key = o.material.name;
    if (!groups.has(key)) groups.set(key, { material: o.material.clone(), geometries: [] });
    groups.get(key).geometries.push(geometry);
  });
  for (const part of config.remove || []) {
    const node = gltf.scene.getObjectByName(part);
    if (!node) throw Error(`Encounter source changed: ${name}:${part}`);
    node.removeFromParent();
  }
  const skeleton = new THREE.Skeleton(source.bones, source.bones.map(b => b.matrixWorld.clone().invert()));
  for (const [key, group] of groups) {
    const geometry = mergeGeometries(group.geometries);
    for (const part of group.geometries) part.dispose();
    if (!geometry) throw Error(`Incompatible encounter surface: ${name}:${key}`);
    const material = group.material; material.userData.tllAuthored = true;
    if (!material.emissive?.getHex()) {
      applySurfaceDetail(material, key.includes('cloth') ? 'cloth' : key.includes('stone') ? 'stone' : 'metal');
      // The shared albedo has dark texels; multiplying roughness by it creates mirrors.
      // Keep the Blender-authored roughness while retaining actual albedo/bump detail.
      material.roughnessMap = null;
    }
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = `TLL_${name}_${key}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    gltf.scene.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
  }
  const materials = new Set();
  authored.scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); materials.add(o.material); } });
  for (const material of materials) material.dispose();
  gltf.scene.userData.encounterIdentity = name;
  return gltf;
}
