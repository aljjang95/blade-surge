import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { projectSurfaceUV, surfaceRole, applySurfaceDetail } from './surface-textures.js';

/** Bind separately authored Blender surfaces to the shipped combat rig. */
export function assembleHeroIdentity(gltf, authored, modelName, style = 'oath-v1') {
  gltf.scene.updateMatrixWorld(true); authored.scene.updateMatrixWorld(true);
  let sourceSkeleton;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !sourceSkeleton) sourceSkeleton = o.skeleton; });
  if (!sourceSkeleton) throw new Error(`Missing hero skeleton: ${modelName}`);
  const bones = sourceSkeleton.bones;
  const normalized = (s) => s.replaceAll('.', '');
  const casualStyle = style === 'casual-v2';
  const groups = casualStyle ? [[], [], []] : [[], []];
  authored.scene.traverse((o) => {
    if (!o.isMesh) return;
    let boneName;
    for (let p = o; p && !boneName; p = p.parent) boneName = p.userData.tllBone;
    const boneIndex = bones.findIndex((b) => normalized(b.name) === normalized(boneName || ''));
    if (boneIndex < 0) throw new Error(`Missing identity bone: ${boneName}`);
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    projectSurfaceUV(geo);
    const n = geo.attributes.position.count;
    const indices = new Uint16Array(n * 4), weights = new Float32Array(n * 4), colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      indices[i * 4] = boneIndex; weights[i * 4] = 1;
      o.material.color.toArray(colors, i * 3);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const role = surfaceRole(o.material.name);
    groups[casualStyle ? (role === 'skin' ? 2 : role === 'metal' ? 1 : 0) : o.material.metalness > .3 ? 1 : 0].push(geo);
  });
  const remove = ['Body', 'Helmet', 'Hat', 'Cape', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight'].map((part) => `${modelName}_${part}`);
  for (const name of remove) {
    const part = gltf.scene.getObjectByName(name);
    if (part) part.removeFromParent();
  }
  // Share the bone animation authority, with inverse matrices for authored world coordinates.
  const skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].length) continue;
    const geometry = mergeGeometries(groups[i]);
    for (const part of groups[i]) part.dispose();
    const casual = style === 'casual-v2';
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: casual ? 0 : i ? .64 : 0, roughness: casual ? .85 : i ? .36 : .73 });
    material.name = `TLL_${i ? 'forged' : 'skin-cloth'}`; material.userData.tllAuthored = true;
    if (casualStyle) {
      material.name = `TLL_${['woven-cloth', 'forged-metal', 'skin'][i]}`;
      applySurfaceDetail(material, ['cloth', 'metal', 'skin'][i]);
    }
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = `TLL_${modelName}_${i}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    gltf.scene.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
  }
  // Temporary imported fitting buffers are no longer used after batching.
  const materials = new Set();
  authored.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); materials.add(o.material); } });
  for (const material of materials) material.dispose();
  gltf.scene.userData.tllIdentity = style;
  return gltf;
}
