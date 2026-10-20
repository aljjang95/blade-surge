import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyArmorAppearance, armorStyle, removeArmorAppearance } from '../src/game/armor-appearance.js';
import { disposeCharacter, prepareModel, spawnCharacter } from '../src/engine/assets.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { GEAR_ITEMS } from '../src/data/gear-catalog.js';
import { HEROES } from '../src/data/heroes.js';

type Part = { name: string; bone: string; start: number; count: number };
type Item = { id: string; rarity: string; set?: string | null; look?: { armor: Record<string, unknown> } };
const items = ITEM_BY_ID as Record<string, Item>;
const plateIds = ['a_scrap', 'a_bronze', 'a_knight', 'a_paladin', 'a_void', 'a_titan', 'a_sun', 'a_king', 'sg_abyss_husk'];
const ordinaryIds = ['a_leather', 'a_cloth', 'a_padded', 'a_scrap', 'a_chain', 'a_scale', 'a_ranger', 'a_bronze',
  'a_knight', 'a_mithril', 'a_wyvern', 'a_paladin', 'a_void', 'a_titan', 'a_sun', 'a_king'];

// 배포된 KayKit 본과 바인드 변환을 그대로 사용한다. 텍스처 로더는 필요 없다.
function fixture(identity = 'casual-v2') {
  const bytes = readFileSync(new URL('../public/models/Knight.glb', import.meta.url));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const joints = new Set<number>(doc.skins[0].joints);
  const nodes: THREE.Object3D[] = doc.nodes.map((node: any, index: number) => {
    const object = joints.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = (node.name || '').replaceAll('.', '');
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  doc.nodes.forEach((node: any, index: number) => node.children?.forEach((child: number) => nodes[index]!.add(nodes[child]!)));
  const root = new THREE.Group();
  doc.scenes[0].nodes.forEach((index: number) => root.add(nodes[index]!));
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = doc.skins[0].joints.map((index: number) => nodes[index]);
  const skeleton = new THREE.Skeleton(bones, bones.map(bone => bone.matrixWorld.clone().invert()));
  const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  skin.name = 'TLL_Knight_0'; root.add(skin); skin.bind(skeleton, new THREE.Matrix4());
  const face = new THREE.Mesh(new THREE.SphereGeometry(.1), new THREE.MeshStandardMaterial({ color: 0xf1c1a0 }));
  face.name = 'identity_face'; root.add(face);
  root.userData.tllIdentity = identity;
  return { root, skin, face };
}

function meshes(root: THREE.Object3D) {
  const result: THREE.SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh && object.userData.equippedArmor) result.push(object); });
  return result;
}
function parts(root: THREE.Object3D): Part[] {
  return meshes(root).flatMap(mesh => mesh.userData.armorParts as Part[]);
}
function signature(root: THREE.Object3D) {
  return parts(root).map(part => `${part.name}:${part.count}`).sort().join('|');
}
const hero = { id: 'knight' };
function item(armor: Record<string, unknown>): Item {
  return { id: 'fixture_custom_armor', rarity: 'E', look: { armor: {
    cut: 'plate', pauldron: 'round', collar: 'ring', cape: 'none', belt: 'plain', emblem: 'sphere',
    palette: { body: 0x234567, trim: '#abcdef', accent: 0x987654 }, ...armor,
  } } };
}

test('일반 16종 조합과 판금 9종 파츠 집합이 각각 고유하다', () => {
  const { root } = fixture();
  const combinations = new Set<string>();
  for (const id of ordinaryIds) {
    const style = armorStyle(items[id], 'knight');
    combinations.add([style.cut, style.pauldron, style.collar, style.cape, style.belt, style.emblem].join('/'));
  }
  expect(combinations.size).toBe(16);
  const names = new Set<string>(), vertices = new Set<number>();
  for (const id of plateIds) {
    expect(armorStyle(items[id], 'knight').cut).toBe('plate');
    applyArmorAppearance(root, hero, items[id]);
    expect(meshes(root)).toHaveLength(3);
    names.add(parts(root).map(part => part.name).sort().join('|'));
    vertices.add(meshes(root).reduce((sum, mesh) => sum + mesh.geometry.attributes.position!.count, 0));
  }
  expect(names.size).toBe(9);
  expect(vertices.size).toBe(9);
  removeArmorAppearance(root);
});

const dimensions = {
  cut: ['leather', 'robe', 'padded', 'plate', 'chain', 'scale', 'crystal', 'brigandine'],
  pauldron: ['round', 'spiked', 'layered', 'wing', 'fur', 'none'],
  collar: ['high', 'fur', 'ring', 'hood', 'none'],
  cape: ['none', 'short', 'long', 'tattered'],
  belt: ['plain', 'plates', 'sash', 'chain'],
  emblem: ['sphere', 'star', 'diamond', 'crest', 'skull', 'none'],
};
for (const [field, values] of Object.entries(dimensions)) {
  test(`${field}: 모든 스키마 값이 실제 정점 파츠에 반영된다`, () => {
    const { root, skin } = fixture();
    const signatures = new Set<string>();
    for (const value of values) {
      applyArmorAppearance(root, hero, item({ [field]: value }));
      const rendered = meshes(root);
      expect(rendered.length).toBeLessThanOrEqual(3);
      expect(rendered.every(mesh => mesh.skeleton === skin.skeleton)).toBe(true);
      const prefix = `Armor_${field}_`;
      const matching = parts(root).filter(part => part.name.startsWith(prefix));
      if (value === 'none') expect(matching).toHaveLength(0);
      else {
        expect(matching.length).toBeGreaterThan(0);
        expect(matching.every(part => part.name.startsWith(`${prefix}${value}`))).toBe(true);
      }
      root.updateMatrixWorld(true);
      for (const mesh of rendered) {
        const geometry = mesh.geometry;
        for (const part of mesh.userData.armorParts as Part[]) {
          expect(part.count).toBeGreaterThan(0);
          expect(part.start + part.count).toBeLessThanOrEqual(geometry.attributes.position!.count);
          const bounds = new THREE.Box3();
          let validSkin = true;
          for (let index = part.start; index < part.start + part.count; index++) {
            const boneIndex = geometry.attributes.skinIndex!.getX(index);
            validSkin &&= mesh.skeleton.bones[boneIndex]!.name === part.bone && geometry.attributes.skinWeight!.getX(index) === 1;
            const point = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position!, index);
            bounds.expandByPoint(mesh.applyBoneTransform(index, point).applyMatrix4(mesh.matrixWorld));
          }
          expect(validSkin).toBe(true);
          const size = bounds.getSize(new THREE.Vector3());
          expect(size.x * size.y * size.z).toBeGreaterThan(0);
          expect(bounds.min.y).toBeGreaterThan(.35);
          expect(bounds.max.y).toBeLessThan(1.46);
          expect(bounds.max.x - bounds.min.x).toBeLessThan(1.3);
        }
      }
      signatures.add(signature(root));
    }
    expect(signatures.size).toBe(values.length);
    removeArmorAppearance(root);
  });
}

test('신규 look 우선순위·팔레트·직업 무관 해석과 기존 폴백', () => {
  const custom = item({ cut: 'brigandine', pauldron: 'wing', collar: 'high', cape: 'long', belt: 'chain', emblem: 'crest' });
  custom.id = 'a_leather';
  for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) expect(armorStyle(custom, id)).toMatchObject({
    cut: 'brigandine', pauldron: 'wing', collar: 'high', cape: 'long', belt: 'chain', emblem: 'crest',
    body: 0x234567, trim: '#abcdef', accent: 0x987654,
  });
  const { root } = fixture();
  applyArmorAppearance(root, hero, custom);
  const materials = meshes(root).map(mesh => (mesh.material as THREE.MeshStandardMaterial).color.getHex());
  expect(materials).toEqual([0x234567, 0xabcdef, 0x987654]);
  expect(armorStyle(items.a_leather, 'mage')).toMatchObject({ cut: 'leather', body: 0x714932 });
  expect(armorStyle({ id: 'unknown_armor', rarity: 'N' }, 'knight').cut).toBe('plate');
  removeArmorAppearance(root);
});

test('등록된 신규 방어구 12종은 카탈로그 외형을 입고 메시 3개로 서로 구분된다', () => {
  const { root, skin } = fixture();
  const armors = GEAR_ITEMS.filter(item => item.slot === 'armor');
  expect(armors).toHaveLength(12);
  const signatures = new Set<string>();
  for (const armor of armors) {
    const registered = items[armor.id]!;
    expect(registered).toBeDefined();
    const expected = registered.look!.armor as Record<string, any>;
    applyArmorAppearance(root, hero, registered);
    expect(meshes(root)).toHaveLength(3);
    expect(meshes(root).every(mesh => mesh.skeleton === skin.skeleton)).toBe(true);
    expect(root.userData.armorAppearance).toMatchObject({ cut: expected.cut, pauldron: expected.pauldron,
      collar: expected.collar, cape: expected.cape, belt: expected.belt, emblem: expected.emblem });
    const colors = meshes(root).map(mesh => (mesh.material as THREE.MeshStandardMaterial).color.getHex());
    expect(colors).toEqual([expected.palette.body, expected.palette.trim, expected.palette.accent].map(value => new THREE.Color(value).getHex()));
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const mesh of meshes(root)) bounds.union(new THREE.Box3().setFromObject(mesh));
    expect(bounds.min.y).toBeGreaterThan(.35);
    expect(bounds.max.y).toBeLessThan(1.46);
    signatures.add(signature(root));
  }
  expect(signatures.size).toBe(12);
  removeArmorAppearance(root);
});

test('교체·해제·영웅 폐기는 소유 자원을 한 번만 해제하고 얼굴과 스켈레톤을 보존한다', () => {
  const { root, skin, face } = fixture();
  const originalGeometry = skin.geometry, originalFace = face.geometry, originalSkeleton = skin.skeleton;
  let sourceFreed = 0;
  originalGeometry.addEventListener('dispose', () => sourceFreed++);
  originalFace.addEventListener('dispose', () => sourceFreed++);
  const watch = () => meshes(root).map(mesh => {
    const counts = { geometry: 0, material: 0 };
    mesh.geometry.addEventListener('dispose', () => counts.geometry++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => counts.material++);
    return counts;
  });
  applyArmorAppearance(root, hero, items.a_knight);
  const first = watch();
  applyArmorAppearance(root, hero, items.a_king);
  first.forEach(counts => expect(counts).toEqual({ geometry: 1, material: 1 }));
  expect(skin.geometry).toBe(originalGeometry);
  expect(face.geometry).toBe(originalFace);
  expect(skin.skeleton).toBe(originalSkeleton);
  const second = watch();
  removeArmorAppearance(root); removeArmorAppearance(root);
  second.forEach(counts => expect(counts).toEqual({ geometry: 1, material: 1 }));
  expect(meshes(root)).toHaveLength(0);
  expect(root.userData.armorAppearance).toBeUndefined();
  applyArmorAppearance(root, hero, items.a_paladin);
  const final = watch();
  const mixer = new THREE.AnimationMixer(root);
  disposeCharacter(root, mixer);
  removeArmorAppearance(root);
  final.forEach(counts => expect(counts).toEqual({ geometry: 1, material: 1 }));
  expect(sourceFreed).toBe(0);
});

test('애니메이션 중 장착해도 본 포즈와 원본 바인드 행렬을 재설정하지 않는다', () => {
  const { root, skin } = fixture();
  const bone = skin.skeleton.bones.find(bone => bone.name === 'chest')!;
  bone.rotateZ(.3);
  const rotation = bone.quaternion.clone(), inverse = skin.skeleton.boneInverses.map(matrix => matrix.clone());
  applyArmorAppearance(root, hero, items.a_knight);
  expect(bone.quaternion.equals(rotation)).toBe(true);
  expect(skin.skeleton.boneInverses.every((matrix, index) => matrix.equals(inverse[index]!))).toBe(true);
  root.updateMatrixWorld(true);
  const before = signature(root);
  applyArmorAppearance(root, hero, items.a_knight);
  expect(signature(root)).toBe(before);
  removeArmorAppearance(root);
});

test('배포된 Ranger 실제 활·달리기·죽음 애니메이션에 병합 방어구가 연결된다', async () => {
  const bytes = readFileSync(new URL('../public/models/Ranger.glb', import.meta.url));
  const oldLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + oldLength).toString());
  // Node 환경의 이미지 디코딩만 제외하고 지오메트리·역행렬·클립을 보존한다.
  for (const material of doc.materials) if (material.pbrMetallicRoughness) delete material.pbrMetallicRoughness.baseColorTexture;
  const json = Buffer.from(JSON.stringify(doc)), pad = Buffer.alloc((4 - json.length % 4) % 4, 32), tail = bytes.subarray(20 + oldLength);
  const header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + json.length + pad.length + tail.length, 8); header.writeUInt32LE(json.length + pad.length, 12);
  const packed = Buffer.concat([header, json, pad, tail]);
  const source = prepareModel(await new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), ''));
  const instance = spawnCharacter(source), head = instance.root.getObjectByName('Ranger_Head')!;
  for (const id of ['a_knight', 'a_king', 'exp_glasswarden_armor', 'exp_starreader_armor', 'gear_armor_l_3']) {
    applyArmorAppearance(instance.root, HEROES.ranger, items[id]);
    expect(meshes(instance.root)).toHaveLength(3);
    expect(instance.root.getObjectByName('Ranger_Head')).toBe(head);
    for (const name of ['Idle', 'Bow_Shoot', 'Running_A', 'Death_A']) {
      instance.mixer.stopAllAction();
      instance.mixer.clipAction(instance.clips[name]!).play();
      instance.mixer.update(.2); instance.root.updateMatrixWorld(true);
      for (const mesh of meshes(instance.root)) {
        const point = new THREE.Vector3();
        for (const part of mesh.userData.armorParts as Part[]) {
          mesh.getVertexPosition(part.start, point);
          expect(point.toArray().every(Number.isFinite)).toBe(true);
        }
        mesh.computeBoundingBox();
        expect(mesh.boundingBox!.getSize(new THREE.Vector3()).length()).toBeLessThan(6);
      }
    }
  }
  disposeCharacter(instance.root, instance.mixer);
});
