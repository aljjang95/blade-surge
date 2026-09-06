import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { disposeCharacter, prepareModel, spawnCharacter } from '../src/engine/assets.js';
import { buildOathHall } from '../src/game/lobby-hall.js';

function sourceRig(name: string) {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const joints = new Set<number>(doc.skins[0].joints);
  const nodes = doc.nodes.map((n: any, i: number) => {
    const node = joints.has(i) ? new THREE.Bone() : new THREE.Group();
    node.name = (n.name || '').replaceAll('.', '');
    if (n.translation) node.position.fromArray(n.translation);
    if (n.rotation) node.quaternion.fromArray(n.rotation);
    if (n.scale) node.scale.fromArray(n.scale);
    return node;
  });
  doc.nodes.forEach((n: any, i: number) => n.children?.forEach((c: number) => nodes[i].add(nodes[c])));
  const scene = new THREE.Group(); doc.scenes[0].nodes.forEach((i: number) => scene.add(nodes[i]));
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(doc.skins[0].joints.map((i: number) => nodes[i]));
  const dummy = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  scene.add(dummy); dummy.bind(skeleton);
  return { scene, animations: [] as THREE.AnimationClip[] };
}

for (const name of ['Knight', 'Barbarian', 'Mage', 'Rogue']) for (const style of ['oath-v1', 'casual-v2']) {
  test(`${name}/${style}: 실제 authored GLB가 기존 관절에 연결되고 복제·정리 뒤 원본을 보존한다`, async () => {
    const bytes = readFileSync(new URL(`../public/models/tll/${name.toLowerCase()}-${style}.glb`, import.meta.url));
    const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const authored = await new GLTFLoader().parseAsync(array, '');
    const gltf = sourceRig(name);
    assembleHeroIdentity(gltf, authored, name, style); prepareModel(gltf);
    const skins: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { if (o instanceof THREE.SkinnedMesh && o.name.startsWith('TLL_')) skins.push(o); });
    expect(skins.length).toBe(style === 'casual-v2' ? 1 : 2);
    for (const skin of skins) {
      expect(skin.geometry.attributes.position.count).toBeLessThan(25000);
      expect(skin.geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
      const p = new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, 0);
      const bound = skin.applyBoneTransform(0, p.clone());
      expect(bound.distanceTo(p)).toBeLessThan(.0001);
      const material = skin.material as THREE.MeshStandardMaterial;
      expect(material.userData.tllAuthored).toBe(true);
      expect(material.metalness).toBe(style === 'casual-v2' ? 0 : skin.name.endsWith('_1') ? .64 : 0);
      if (style === 'casual-v2') expect(material.roughness).toBe(.85);
    }
    const clone = spawnCharacter(gltf); const cloneSkin = clone.root.getObjectByName(skins[0]!.name) as THREE.SkinnedMesh;
    expect(cloneSkin.skeleton.bones[0]).not.toBe(skins[0]!.skeleton.bones[0]);
    expect(cloneSkin.geometry).toBe(skins[0]!.geometry);
    let disposed = false; skins[0]!.geometry.addEventListener('dispose', () => { disposed = true; });
    disposeCharacter(clone.root, clone.mixer);
    expect(disposed).toBe(false);
  });
}

test('로비 건축은 5개 배치이고 정리 시 각 geometry와 material을 한 번 회수한다', () => {
  const hall = buildOathHall(); expect(hall.children.length).toBe(5);
  let geometries = 0, materials = 0;
  for (const child of hall.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.addEventListener('dispose', () => geometries++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => materials++);
  }
  hall.userData.dispose(); expect(geometries).toBe(5); expect(materials).toBe(5);
});
