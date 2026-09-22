import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { spawnCharacter, disposeCharacter, requiredModelAliases } from '../src/engine/assets.js';
import { applyEquipmentAppearance, removeEquipmentAppearance, compileEquipmentAppearance } from '../src/engine/equipment-appearance.js';
import { ARMOR_VISUALS } from '../src/data/armor-visuals.js';

async function load(file: string) {
  const bytes = readFileSync(new URL('../public/models/' + file, import.meta.url));
  const n = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + n).toString());
  const strip = (value: any) => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key.endsWith('Texture') && value[key]?.index !== undefined) delete value[key];
      else strip(value[key]);
    }
  };
  for (const material of doc.materials || []) strip(material);
  const json = Buffer.from(JSON.stringify(doc)), pad = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const head = Buffer.from(bytes.subarray(0, 20)), tail = bytes.subarray(20 + n);
  head.writeUInt32LE(20 + json.length + pad.length + tail.length, 8); head.writeUInt32LE(json.length + pad.length, 12);
  const packed = Buffer.concat([head, json, pad, tail]);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.length), '');
}
async function character() {
  const source = await load('Knight.glb'), fitting = await load('heroes-v3/knight-v3.glb');
  assembleHeroIdentity(source, fitting, 'Knight', 'expedition-v3');
  return spawnCharacter(source);
}
function equipment(root: THREE.Object3D) {
  const result: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof THREE.SkinnedMesh && o.userData.equipmentItem) result.push(o); });
  return result;
}
for (const id of Object.keys(ARMOR_VISUALS)) test(id + ': authored material, UV, face and actual equip rig', async () => {
  const actor = await character(), gltf = await load('armor-pilot/v1/' + id + '.glb');
  const face = actor.root.getObjectByName('Knight_Head'), clips = Object.keys(actor.clips);
  const library = new Map([[id, gltf.scene]]);
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id }, library)).toBe(true);
  const meshes = equipment(actor.root); expect(meshes.length).toBeGreaterThan(0); expect(meshes.length).toBeLessThanOrEqual(8);
  expect(actor.root.getObjectByName('Knight_Head')).toBe(face); expect(Object.keys(actor.clips)).toEqual(clips);
  const parts = compileEquipmentAppearance(gltf.scene, meshes[0]!.skeleton);
  for (const { geometry, material } of parts) {
    const expected: number[] = [];
    gltf.scene.traverse(o => {
      if (o instanceof THREE.Mesh && o.material === material) {
        const uv = o.geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) expected.push(uv.getX(i), uv.getY(i));
      }
    });
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(expected);
    expect(meshes.some(m => m.material !== material && (m.material as THREE.MeshStandardMaterial).name === material.name)).toBe(true);
  }
  const point = new THREE.Vector3(); let poses = 0;
  for (const name of requiredModelAliases('hero', 'knight')) {
    const clip = actor.clips[name]!; expect(clip).toBeDefined();
    for (let phase = 0; phase < 12; phase++) {
      actor.mixer.stopAllAction(); const action = actor.mixer.clipAction(clip).reset().play();
      action.time = clip.duration * phase / 12; actor.mixer.update(0); actor.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      for (const mesh of meshes) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          mesh.applyBoneTransform(i, point.fromBufferAttribute(positions, i)).applyMatrix4(mesh.matrixWorld);
          if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Nonfinite dressed vertex');
          bounds.expandByPoint(point);
        }
      }
      expect(bounds.getSize(point).length()).toBeLessThan(8); expect(bounds.getCenter(point).length()).toBeLessThan(10); poses++;
    }
  }
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id }, library)).toBe(true);
  expect(equipment(actor.root)[0]).toBe(meshes[0]);
  let sharedDisposals = 0, materialDisposals = 0;
  for (const mesh of meshes) {
    mesh.geometry.addEventListener('dispose', () => sharedDisposals++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => materialDisposals++);
  }
  disposeCharacter(actor.root, actor.mixer);
  expect(sharedDisposals).toBe(0); expect(materialDisposals).toBe(meshes.length);
  console.info('DRESSED_RUNTIME_PROOF ' + JSON.stringify({ id, poses, materials: meshes.length, authoredUvPreserved: true }));
}, 60000);
test('switch, unsupported item and broken input restore the base without losing face', async () => {
  const actor = await character(), a = await load('armor-pilot/v1/a_leather.glb'), b = await load('armor-pilot/v1/a_king.glb');
  const library = new Map([['a_leather', a.scene], ['a_king', b.scene]]);
  const base: THREE.Object3D[] = []; actor.root.traverse(o => { if (/^TLL_Knight_/.test(o.name)) base.push(o); });
  expect(base.every(o => o.visible)).toBe(true);
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id: 'a_leather' }, library)).toBe(true);
  const first = equipment(actor.root); expect(base.every(o => !o.visible)).toBe(true);
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id: 'a_king' }, library)).toBe(true);
  expect(first.every(o => !o.parent)).toBe(true); expect(equipment(actor.root).every(o => o.userData.equipmentItem === 'a_king')).toBe(true);
  expect(applyEquipmentAppearance(actor.root, { id: 'mage' }, { id: 'a_king' }, library)).toBe(false);
  expect(equipment(actor.root).length).toBe(0); expect(base.every(o => o.visible)).toBe(true);
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id: 'a_rime' }, library)).toBe(false);
  expect(actor.root.userData.equipmentAppearanceError).toBe('a_rime');
  const broken = new THREE.Group(); broken.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  library.set('a_king', broken);
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id: 'a_king' }, library)).toBe(false);
  expect(base.every(o => o.visible)).toBe(true); expect(equipment(actor.root).length).toBe(0);
  removeEquipmentAppearance(actor.root); disposeCharacter(actor.root, actor.mixer);
});

test('material map references survive instance cloning', async () => {
  const actor = await character(), model = await load('armor-pilot/v1/a_rime.glb'), texture = new THREE.Texture();
  model.scene.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).map = texture; });
  expect(applyEquipmentAppearance(actor.root, { id: 'knight' }, { id: 'a_rime' }, new Map([['a_rime', model.scene]]))).toBe(true);
  expect(equipment(actor.root).every(o => (o.material as THREE.MeshStandardMaterial).map === texture)).toBe(true);
  disposeCharacter(actor.root, actor.mixer); texture.dispose();
});
