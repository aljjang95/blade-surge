import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { materialsOf, mergeSkinned, prepareModel, requiredModelAliases, spawnCharacter } from '../src/engine/assets.js';
import { Actor } from '../src/game/actor.js';
import { applyLook } from '../src/game/look.js';

const aliases = () => Object.fromEntries(requiredModelAliases('hero', 'knight').map((name) => [name, name.startsWith('Death_') ? 'death' : 'idle']));

test('전용 모델의 PBR·재질 배열·발광은 장착/피격/다른 인스턴스와 분리해 보존한다', () => {
  const scene = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x663388, roughness: 0.2, metalness: 0.9, emissive: 0x123456, emissiveIntensity: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.95, emissive: 0x042010 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [metal, cloth]); scene.add(mesh);
  const hand = new THREE.Bone(); hand.name = 'RightHand'; scene.add(hand);
  const gltf = { scene, animations: [new THREE.AnimationClip('idle', 1, []), new THREE.AnimationClip('death', 1, [])] };
  const contract = { materials: 'authored', role: 'hero', heroId: 'knight', scale: 0.01, aliases: aliases(), sockets: { 'handslot.r': 'RightHand' } };
  prepareModel(gltf, contract);
  expect(metal.roughness).toBe(0.2); expect(metal.metalness).toBe(0.9);
  const game = { scene: new THREE.Scene() };
  const actor = new Actor(game, gltf, { tint: '#ff0000' });
  const clone = spawnCharacter(gltf);
  expect(actor.model.scale.x).toBe(0.01); expect(clone.root.scale.x).toBe(0.01);
  const base = actor.mats[0]!.emissive.clone();
  expect(actor.clips.Idle.name).toBe('idle');
  expect(actor.weaponPoints()).not.toBeNull();
  const points = actor.weaponPoints('handslot.r', 1.2)!;
  expect(points[0].distanceTo(points[1])).toBeCloseTo(1.2, 8);
  prepareModel(gltf, { ...contract, scale: 1 });
  const sameLengthActor = new Actor(game, gltf);
  const unitPoints = sameLengthActor.weaponPoints('handslot.r', 1.2)!;
  expect(unitPoints[0].distanceTo(unitPoints[1])).toBeCloseTo(1.2, 8);
  sameLengthActor.dispose();
  applyLook(actor.model, { id: 'knight', show: [], color: '#ffffff' }, {});
  expect(actor.mats[0]!.emissive.equals(base)).toBe(true);
  actor.flash(); actor.update(0.08); actor.update(0.1); actor.update(0.01);
  expect(actor.mats[0]!.emissive.equals(base)).toBe(true);
  expect(actor.mats[0]!.emissiveIntensity).toBe(0.7);
  const otherMesh = clone.root.getObjectByProperty('isMesh', true)!;
  expect(materialsOf(otherMesh)[0].emissive.equals(base)).toBe(true);
  expect(metal.color.getHex()).toBe(0x663388);
  actor.dispose();
});

test('전용 clip/socket 누락을 조용한 idle로 덮지 않는다', () => {
  const gltf = { scene: new THREE.Group(), animations: [new THREE.AnimationClip('idle', 1, []), new THREE.AnimationClip('death', 1, [])] };
  const contract = { materials: 'authored', role: 'hero', heroId: 'knight', scale: 1, aliases: aliases(), sockets: { 'handslot.r': 'RightHand' } };
  expect(() => prepareModel(gltf, { ...contract, aliases: { ...aliases(), Running_A: 'run' } })).toThrow('missing authored animation');
  expect(() => prepareModel(gltf, contract)).toThrow('missing authored socket');
  const incomplete = aliases(); delete incomplete.Running_A;
  expect(() => prepareModel(gltf, { ...contract, aliases: incomplete })).toThrow('missing required animation alias');
  expect(() => prepareModel(gltf, { ...contract, sockets: {} })).toThrow('missing required socket');
});

function mergeFixture(shared: boolean, translated = false) {
  const scene = new THREE.Group(), bone = new THREE.Bone(); scene.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  const material = new THREE.MeshStandardMaterial(); material.name = 'same-name';
  for (let i = 0; i < 2; i++) {
    const m = shared ? material : material.clone(); m.name = 'same-name';
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), m); mesh.bind(skeleton);
    if (translated && i === 1) mesh.position.x = 2;
    scene.add(mesh);
  }
  return scene;
}
test('재질 이름이 같아도 객체가 다르거나 변환이 다르면 병합하지 않는다', () => {
  for (const scene of [mergeFixture(false), mergeFixture(true, true)]) {
    mergeSkinned(scene);
    expect(scene.children.filter((node) => node instanceof THREE.SkinnedMesh).length).toBe(2);
  }
  const scene = mergeFixture(true); mergeSkinned(scene);
  expect(scene.children.filter((node) => node instanceof THREE.SkinnedMesh).length).toBe(1);
});

test('동일 변환의 정적 부모 아래 파츠는 병합하지만 따로 움직이는 부모는 보존한다', () => {
  for (const moving of [false, true]) {
    const scene = mergeFixture(true), meshes = scene.children.filter((node) => node instanceof THREE.SkinnedMesh);
    for (const [i, mesh] of meshes.entries()) { const group = new THREE.Group(); group.name = `part${i}`; scene.add(group); group.add(mesh); }
    const clips = moving ? [new THREE.AnimationClip('pose', 1, [new THREE.VectorKeyframeTrack('part0.position', [0, 1], [0, 0, 0, 1, 0, 0])])] : [];
    mergeSkinned(scene, clips);
    let count = 0; scene.traverse((node) => { if (node instanceof THREE.SkinnedMesh) count++; });
    expect(count).toBe(moving ? 2 : 1);
  }
});
