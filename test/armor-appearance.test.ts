import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { disposeCharacter, prepareModel, spawnCharacter } from '../src/engine/assets.js';
import { applyLook } from '../src/game/look.js';
import { HEROES } from '../src/data/heroes.js';
import { armorStyle } from '../src/game/armor-appearance.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { Player } from '../src/game/player.js';
import { Actor } from '../src/game/actor.js';
import { audio } from '../src/engine/audio.js';

// Actual shipped node transforms/joints plus the actual casual GLB. Source GLB
// embedded textures are irrelevant to fitting and need no browser image decoder.
async function heroSource(name: string, style: 'casual-v2' | 'expedition-v3' = 'casual-v2') {
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
  const source = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  source.name = `${name}_Body`; scene.add(source); source.bind(skeleton);
  const gltf = { scene, animations: [] as THREE.AnimationClip[] };
  const fitting = readFileSync(new URL(style === 'expedition-v3'
    ? `../public/models/heroes-v3/${name.toLowerCase()}-v3.glb`
    : `../public/models/tll/${name.toLowerCase()}-casual-v2.glb`, import.meta.url));
  const authored = await new GLTFLoader().parseAsync(fitting.buffer.slice(fitting.byteOffset, fitting.byteOffset + fitting.byteLength), '');
  return prepareModel(assembleHeroIdentity(gltf, authored, name, style));
}

for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger'] as const) {
  test(`${id}: shipped expedition-v3 identity visibly wears eight distinct themed armors`, async () => {
    const def = HEROES[id], source = await heroSource(def.model, 'expedition-v3');
    const instance = spawnCharacter(source);
    const body = instance.root.getObjectByName(`TLL_${def.model}_0`) as THREE.SkinnedMesh;
    const bodyGeometry = body.geometry;
    const signatures = new Set<string>();
    for (const [set, itemId] of Object.entries({ storm: 'a_storm', blood: 'a_blood', gravity: 'a_gravity', phoenix: 'a_phoenix',
      frost: 'a_rime', plague: 'a_plague', rune: 'a_sigil', tether: 'a_bind' })) {
      applyLook(instance.root, def, { armor: { id: itemId, enh: 0 } });
      expect(body.geometry).toBe(bodyGeometry);
      expect(instance.root.userData.armorAppearance).toMatchObject({ itemId, identity: 'expedition-v3' });
      const meshes = attachments(instance.root), details = meshes.flatMap(mesh => mesh.userData.armorParts
        .filter((part: ArmorPart) => part.name.startsWith(`Armor_theme_${set}_`)).map((part: ArmorPart) => ({ mesh, part })));
      expect(details).toHaveLength(3);
      expect(meshes).toHaveLength(3);
      expect(meshes.every(m => m.skeleton === body.skeleton)).toBe(true);
      expect(meshes.every(m => m.userData.equippedArmor === itemId)).toBe(true);
      instance.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      for (const { mesh, part } of details) for (let i = part.start; i < part.start + part.count; i++) bounds.expandByPoint(skinnedPoint(mesh, i));
      expect(bounds.min.y).toBeGreaterThan(.85);
      expect(bounds.max.y).toBeLessThan(1.67);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(2.1);
      const { mesh: detail, part } = details.find(({ part }) => part.name.includes('_right_'))!, bone = detail.skeleton.bones.find((b: THREE.Bone) => b.name === part.bone)!;
      const before = skinnedPoint(detail, part.start), rotation = bone.quaternion.clone();
      bone.rotateZ(.3); instance.root.updateMatrixWorld(true);
      expect(skinnedPoint(detail, part.start).distanceTo(before)).toBeGreaterThan(.01);
      bone.quaternion.copy(rotation); instance.root.updateMatrixWorld(true);
      signatures.add(`${details.map(({ part }) => part.name).join('/')}:${details.map(({ part }) => part.count).join('/')}:${bounds.max.y.toFixed(3)}`);
      let disposed = 0;
      meshes.forEach(m => m.geometry.addEventListener('dispose', () => disposed++));
      applyLook(instance.root, def, {});
      expect(disposed).toBe(meshes.length);
      expect(attachments(instance.root)).toHaveLength(0);
    }
    expect(signatures.size).toBe(8);
    disposeCharacter(instance.root, instance.mixer);
  });
}
type ArmorPart = { name: string; bone: string; start: number; count: number };
function attachments(root: THREE.Object3D) {
  const result: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof THREE.SkinnedMesh && o.userData.equippedArmor) result.push(o); });
  return result;
}
function findPart(root: THREE.Object3D, name: string) {
  for (const mesh of attachments(root)) {
    const part = mesh.userData.armorParts.find((part: ArmorPart) => part.name === name) as ArmorPart | undefined;
    if (part) return { mesh, part };
  }
  throw new Error(`방어구 파츠 없음: ${name}`);
}
function skinnedPoint(mesh: THREE.SkinnedMesh, index: number) {
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position!, index);
  return mesh.applyBoneTransform(index, point).applyMatrix4(mesh.matrixWorld);
}

for (const id of ['knight', 'barbarian', 'mage', 'rogue'] as const) {
  test(`${id}: casual identity retained; armor is fitted, bone driven, replaceable and safely disposed`, async () => {
    const def = HEROES[id];
    const gltf = await heroSource(def.model);
    const instance = spawnCharacter(gltf);
    const identity = instance.root.getObjectByName(`TLL_${def.model}_0`) as THREE.SkinnedMesh;
    const originalGeometry = identity.geometry;
    let sourceDisposed = 0; originalGeometry.addEventListener('dispose', () => sourceDisposed++);
    const cuts = new Set();
    const fingerprints = new Set();
    for (const itemId of ['a_leather', 'a_cloth', 'a_knight', 'a_scale', 'a_chain', 'a_padded', 'exp_glasswarden_armor', 'exp_emberknight_armor', 'exp_starreader_armor']) {
      applyLook(instance.root, def, { armor: { id: itemId, enh: 0 } });
      expect(identity.geometry).toBe(originalGeometry);
      expect(identity.visible).toBe(true);
      const meshes = attachments(instance.root);
      expect(meshes).toHaveLength(3);
      expect(meshes.every(m => m.skeleton === identity.skeleton)).toBe(true);
      expect(meshes.every(m => m.userData.equippedArmor === itemId)).toBe(true);
      const material = identity.material as THREE.MeshStandardMaterial;
      expect(material.emissive.getHex()).toBe(0);
      instance.root.updateMatrixWorld(true);
      const fitted = new THREE.Box3();
      for (const mesh of meshes) fitted.union(new THREE.Box3().setFromObject(mesh));
      expect(fitted.min.y).toBeGreaterThan(.35);
      expect(fitted.max.y).toBeLessThan(1.46); // never replaces or covers the face
      expect(fitted.max.x - fitted.min.x).toBeLessThan(1.3);
      const appearance = instance.root.userData.armorAppearance;
      if (['a_scale', 'a_chain', 'a_padded'].includes(itemId)) {
        const { part } = findPart(instance.root, `Armor_${appearance.cut}_surface`);
        expect(part.bone).toBe('chest');
        expect(part.count).toBeGreaterThan(100);
      }
      cuts.add(appearance.cut);
      fingerprints.add(`${appearance.cut}/${(meshes[0]!.material as THREE.MeshStandardMaterial).color.getHex()}`);
      const shoulder = meshes.flatMap(mesh => mesh.userData.armorParts
        .filter((part: ArmorPart) => part.bone.replaceAll('.', '') === 'upperarml').map((part: ArmorPart) => ({ mesh, part })))[0]
        || findPart(instance.root, `Armor_cut_${appearance.cut}_cuirass`);
      const bone = shoulder.mesh.skeleton.bones.find((b: THREE.Bone) => b.name === shoulder.part.bone)!;
      const before = skinnedPoint(shoulder.mesh, shoulder.part.start);
      const rotation = bone.quaternion.clone();
      bone.rotateZ(.6); instance.root.updateMatrixWorld(true);
      const after = skinnedPoint(shoulder.mesh, shoulder.part.start);
      expect(after.distanceTo(before)).toBeGreaterThan(.01);
      bone.quaternion.copy(rotation); instance.root.updateMatrixWorld(true);
      let freed = 0;
      meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => freed++));
      applyLook(instance.root, def, { armor: { id: itemId, enh: 3 } });
      expect(freed).toBe(meshes.length);
      expect(attachments(instance.root).length).toBe(meshes.length);
    }
    expect(cuts.size).toBeGreaterThanOrEqual(3);
    expect(fingerprints.size).toBeGreaterThanOrEqual(5);
    applyLook(instance.root, def, {});
    expect(attachments(instance.root)).toHaveLength(0);
    expect(instance.root.userData.armorAppearance).toBeUndefined();
    applyLook(instance.root, def, { armor: { id: 'exp_glasswarden_armor', enh: 0 } });
    const finalMeshes = attachments(instance.root); let finalFreed = 0;
    finalMeshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => finalFreed++));
    disposeCharacter(instance.root, instance.mixer);
    expect(finalFreed).toBe(finalMeshes.length);
    expect(sourceDisposed).toBe(0);
  });
}

test('named armor uses its material identity across classes; expedition styles remain distinct', () => {
  const items = ITEM_BY_ID as Record<string, { id: string; rarity: string; set: string | null }>;
  for (const hero of ['knight', 'barbarian', 'mage', 'rogue']) {
    const scale = armorStyle(items.a_scale, hero);
    expect(scale).toMatchObject({ body: 0x294e3c, trim: 0xb09048, cut: 'scale' });
    expect(armorStyle(items.a_bronze, hero).body).not.toBe(scale.body);
    expect(armorStyle(items.a_chain, hero).cut).toBe('chain');
    expect(armorStyle(items.a_cloth, hero).cut).toBe('robe');
    expect(armorStyle(items.a_leather, hero).cut).toBe('leather');
    expect(armorStyle(items.exp_glasswarden_armor, hero).cut).toBe('crystal');
    expect(armorStyle(items.exp_emberknight_armor, hero).cut).toBe('plate');
    expect(armorStyle(items.exp_starreader_armor, hero).cut).toBe('robe');
    expect(armorStyle(items.sg_moonward_aegis, hero)).toMatchObject({ body: 0x233c5c, trim: 0x8fd8e8, cut: 'crystal' });
    expect(armorStyle(items.sg_abyss_husk, hero)).toMatchObject({ body: 0x2b1644, trim: 0xb26bff, cut: 'plate' });
  }
});

test('Player outfit materials participate in hit flash, death and revive', async () => {
  // No AudioContext means preloadBarks exits without fetching any sound files.
  expect(audio.ctx).toBeNull();
  const gltf = await heroSource('Knight');
  const player = new Player({ scene: new THREE.Scene() }, gltf, HEROES.knight,
    { hp: 100, atk: 10 }, undefined, { armor: { id: 'a_scale', enh: 0 } });
  const meshes = attachments(player.model);
  const outfitMaterials = new Set(meshes.map(mesh => mesh.material as THREE.MeshStandardMaterial));
  expect(outfitMaterials.size).toBe(3);
  expect(new Set(player.mats).size).toBe(player.mats.length);
  for (const material of outfitMaterials) {
    expect(player.mats).toContain(material);
    expect(material.transparent).toBe(false);
  }
  player.flash(0xffffff);
  Actor.prototype.update.call(player, .016);
  // 피격 신호는 남기면서 새 판독 계약의 제한 발광을 의상에도 적용한다.
  for (const material of outfitMaterials) {
    expect(material.emissive.r).toBeGreaterThan(.05);
    expect(material.emissive.r).toBeLessThanOrEqual(.4);
  }
  player.die();
  expect(player.alive).toBe(false);
  for (const material of outfitMaterials) expect(material.transparent).toBe(true);
  player.revive();
  expect(player.alive).toBe(true);
  for (const material of outfitMaterials) expect(material.transparent).toBe(false);
  let disposed = 0;
  meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => disposed++));
  player.dispose();
  expect(disposed).toBe(meshes.length);
});
