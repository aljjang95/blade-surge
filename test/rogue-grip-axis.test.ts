import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitRogueKnifeGripAxes, ROGUE_KNIFE_GRIP_AXIS_REVISION } from '../src/engine/rogue-grip-axis.js';
import { Actor } from '../src/game/actor.js';
import { loadHeroModel, loadHeroAsset, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { rogueLibraryRevision } from '../src/engine/library-assets.js';
import { installRangerRuntimeLoader, stripImages } from '../tools/art/ranger-runtime-loader.mjs';
import { applyLook } from '../src/game/look.js';
import { HEROES } from '../src/data/heroes.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import manifest from '../asset-library/manifest.json';

let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());

const v = () => new THREE.Vector3();
const trs = (node: THREE.Object3D) => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()];
const wp = (node: THREE.Object3D) => node.getWorldPosition(v());
const hash = (array: ArrayBufferView) => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const points = () => [v(), v()];

function fixture() {
  const scene = new THREE.Group();
  scene.position.set(.7, -.4, 1.1); scene.rotation.set(.23, -.51, .17); scene.scale.setScalar(1.27);
  scene.userData.authoredContract = { role: 'hero', heroId: 'rogue', sockets: { 'handslot.r': 'LibrarySocket_r', 'handslot.l': 'LibrarySocket_l' } };
  const hands: Record<string, string> = {}, entries: any[] = [];
  for (const [side, key, name] of [['Right', 'r', 'Knife'], ['Left', 'l', 'Knife_Offhand']]) {
    const hand = new THREE.Bone(); hand.name = 'mixamorig' + side + 'Hand';
    hand.position.set(key === 'r' ? -.45 : .45, 1.03, .07); hand.rotation.set(.41, key === 'r' ? .33 : -.62, -.21);
    hand.scale.setScalar(.9); scene.add(hand); hands[key!] = hand.name;
    for (const [suffix, position] of [['Index1', [.035, .09, .006]], ['Middle1', [0, .11, 0]], ['Pinky1', [-.03, .08, -.004]]] as const) {
      const bone = new THREE.Bone(); bone.name = hand.name + suffix; bone.position.fromArray(position); hand.add(bone);
    }
    const socket = new THREE.Group(); socket.name = 'LibrarySocket_' + key;
    socket.position.set(.02, .08, -.04); socket.rotation.set(.2, -.3, .15); socket.scale.setScalar(.8); hand.add(socket);
    const ornament = new THREE.Object3D(); ornament.name = 'Armory_weapon'; ornament.position.set(.01, .05, -.03); socket.add(ornament);
    const weapon = new THREE.Group(); weapon.name = name!; weapon.position.set(.01, .02, -.01); weapon.rotation.set(.6, .13, -.2);
    weapon.scale.set(.9, 1.05, .95); weapon.userData.forgedWeapon = 'dagger';
    weapon.userData.weaponForgeBounds = { min: [-.075, -.25, -.03], max: [.075, .95, .03] };
    const geometry = new THREE.BoxGeometry(.15, 1.2, .06).translate(.03, .35, .01);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); weapon.add(mesh); socket.add(weapon);
    entries.push({ hand, socket, ornament, weapon, mesh });
  }
  scene.updateMatrixWorld(true);
  return { scene, hands, entries };
}

function radii(mesh: THREE.Mesh, hand: THREE.Object3D) {
  const wrist = wp(hand), p = v(), out = [];
  const positions = mesh.geometry.attributes.position!;
  for (let i = 0; i < positions.count; i++) out.push(p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).distanceTo(wrist));
  return out;
}

function assertKnifeAxis(scene: THREE.Object3D, weapon: THREE.Object3D, side: string) {
  const index = scene.getObjectByName('mixamorig' + side + 'HandIndex1')!;
  const pinky = scene.getObjectByName('mixamorig' + side + 'HandPinky1')!;
  const across = wp(index).sub(wp(pinky)).normalize();
  const origin = weapon.localToWorld(v()), tip = weapon.localToWorld(new THREE.Vector3(0, 1, 0));
  expect(tip.sub(origin).normalize().dot(across)).toBeGreaterThan(.99999);
}

test('도적 양쪽 단검은 모든 정점의 손목 거리를 유지하며 실제 손바닥 축을 따른다', () => {
  const { scene, hands, entries } = fixture();
  const retained = entries.map(entry => ({
    geometry: entry.mesh.geometry, positions: hash(entry.mesh.geometry.attributes.position.array),
    indices: hash(entry.mesh.geometry.index.array), scale: entry.weapon.scale.toArray(),
    socket: trs(entry.socket), ornament: trs(entry.ornament), hand: trs(entry.hand), radii: radii(entry.mesh, entry.hand),
    bounds: structuredClone(entry.weapon.userData.weaponForgeBounds),
  }));
  expect(fitRogueKnifeGripAxes(scene, 'rogue', hands)).toBe(2);
  entries.forEach((entry, index) => {
    const before = retained[index]!;
    expect(entry.mesh.geometry).toBe(before.geometry);
    expect(hash(entry.mesh.geometry.attributes.position.array)).toBe(before.positions);
    expect(hash(entry.mesh.geometry.index.array)).toBe(before.indices);
    expect(entry.weapon.scale.toArray()).toEqual(before.scale);
    expect(trs(entry.socket)).toEqual(before.socket); expect(trs(entry.ornament)).toEqual(before.ornament); expect(trs(entry.hand)).toEqual(before.hand);
    expect(entry.weapon.userData.weaponForgeBounds).toEqual(before.bounds);
    radii(entry.mesh, entry.hand).forEach((radius, vertex) => expect(Math.abs(radius - before.radii[vertex]!)).toBeLessThanOrEqual(1e-6));
    assertKnifeAxis(scene, entry.weapon, index === 0 ? 'Right' : 'Left');
  });
  const corrected = entries.map(entry => trs(entry.weapon));
  expect(fitRogueKnifeGripAxes(scene, 'rogue', hands)).toBe(0);
  expect(entries.map(entry => trs(entry.weapon))).toEqual(corrected);
});

test('다른 영웅은 손가락이 없어도 그대로이며 잘못된 도적 랜드마크는 양쪽 교정 전에 거절한다', () => {
  for (const heroId of ['knight', 'barbarian', 'mage', 'ranger']) expect(fitRogueKnifeGripAxes(new THREE.Group(), heroId, {})).toBe(0);
  for (const defect of ['missing', 'duplicate', 'nonuniform']) {
    const { scene, hands, entries } = fixture();
    if (defect === 'missing') scene.getObjectByName('mixamorigLeftHandPinky1')!.removeFromParent();
    if (defect === 'duplicate') entries[1]!.hand.add(scene.getObjectByName('mixamorigLeftHandIndex1')!.clone());
    if (defect === 'nonuniform') entries[1]!.socket.scale.y *= 2;
    const original = entries.map(entry => trs(entry.weapon));
    expect(() => fitRogueKnifeGripAxes(scene, 'rogue', hands)).toThrow();
    expect(entries.map(entry => trs(entry.weapon))).toEqual(original);
    expect(entries.every(entry => !entry.weapon.userData.rogueKnifeGripAxis)).toBe(true);
  }
});

test('도적 궤적은 교정 단검의 실제 루트·긴 축과 이동을 따르고 출력 점을 재사용한다', () => {
  const { scene, hands, entries } = fixture();
  fitRogueKnifeGripAxes(scene, 'rogue', hands);
  const actor: any = Object.create(Actor.prototype); actor.model = scene; actor.scale = .8;
  const output = points(), first = output[0], second = output[1];
  for (const [index, slot] of ['handslot.r', 'handslot.l'].entries()) {
    const entry = entries[index]!;
    for (const yaw of [0, .57]) {
      entry.hand.rotation.y += yaw; scene.updateMatrixWorld(true);
      expect(actor.weaponPoints(slot, .95, output)).toBe(output);
      expect(output[0]).toBe(first); expect(output[1]).toBe(second);
      expect(output[0]!.distanceTo(wp(entry.weapon))).toBeLessThan(1e-10);
      const axis = entry.weapon.localToWorld(new THREE.Vector3(0, 1, 0)).sub(wp(entry.weapon)).normalize();
      expect(output[1]!.clone().sub(output[0]!).normalize().dot(axis)).toBeGreaterThan(1 - 1e-10);
      expect(output[0]!.distanceTo(output[1]!)).toBeCloseTo(.95 * .8, 10);
    }
  }
});

test('숨김·미교정·다른 영웅의 궤적은 기존 소켓 경로를 유지한다', () => {
  for (const variant of ['unmarked', 'hidden', 'other-hero']) {
    const { scene, hands, entries } = fixture();
    if (variant !== 'unmarked') fitRogueKnifeGripAxes(scene, 'rogue', hands);
    if (variant === 'hidden') entries[0]!.weapon.visible = false;
    if (variant === 'other-hero') scene.userData.authoredContract.heroId = 'knight';
    const actor: any = Object.create(Actor.prototype); actor.model = scene; actor.scale = 1;
    const output = points(); actor.weaponPoints('handslot.r', 1.2, output);
    expect(output[0]!.distanceTo(wp(entries[0]!.socket))).toBeLessThan(1e-10);
    const expected = entries[0]!.socket.localToWorld(new THREE.Vector3(0, 1, 0)).sub(wp(entries[0]!.socket)).normalize();
    expect(output[1]!.clone().sub(output[0]!).normalize().dot(expected)).toBeGreaterThan(1 - 1e-10);
  }
});

test('실제 도적 로더는 폴백 없이 그립만 고치고 원본 몸·뼈·클립 바이트를 보존한다', async () => {
  const bytes = readFileSync(new URL('../public' + rogueLibraryRevision().output.path, import.meta.url));
  const raw = await new GLTFLoader().parseAsync(stripImages(bytes), '');
  const loaded = await loadHeroModel('rogue', 1);
  expect(loaded.scene.userData.libraryAsset?.id).toBe('hero_rogue_t1');
  expect(loaded.scene.userData.authoredContract?.heroId).toBe('rogue');
  raw.scene.traverse((node: any) => {
    if (node.isBone) expect(trs(loaded.scene.getObjectByName(node.name)!)).toEqual(trs(node));
    if (!node.isSkinnedMesh) return;
    let body: any;
    loaded.scene.traverse((candidate: any) => { if (candidate.isSkinnedMesh && !body) body = candidate; });
    for (const [name, attribute] of Object.entries(node.geometry.attributes) as [string, THREE.BufferAttribute][]) {
      expect(hash(body.geometry.attributes[name].array)).toBe(hash(attribute.array));
    }
    expect(hash(body.geometry.index.array)).toBe(hash(node.geometry.index.array));
  });
  const fingerprint = (clips: THREE.AnimationClip[]) => clips.map(clip => ({ name: clip.name, duration: clip.duration,
    tracks: clip.tracks.map(track => ({ name: track.name, times: hash(track.times), values: hash(track.values) })) }));
  expect(fingerprint(loaded.animations)).toEqual(fingerprint(raw.animations));
  const corrected = spawnCharacter(loaded), original = spawnCharacter(loaded);
  try {
    for (const name of ['Knife', 'Knife_Offhand']) {
      const node = original.root.getObjectByName(name)!;
      const record = node.userData.rogueKnifeGripAxis;
      expect(record.revision).toBe(ROGUE_KNIFE_GRIP_AXIS_REVISION);
      node.position.fromArray(record.originalLocalPosition); node.quaternion.fromArray(record.originalLocalQuaternionXYZW);
    }
    for (const fraction of [0, .33, .67]) {
      for (const instance of [corrected, original]) {
        instance.mixer.stopAllAction(); const clip = instance.clips.Running_A;
        const action = instance.mixer.clipAction(clip); action.reset().play(); action.time = clip.duration * fraction;
        instance.mixer.update(0); instance.root.updateMatrixWorld(true);
      }
      corrected.root.traverse((node: any) => { if (node.isBone) expect(trs(node)).toEqual(trs(original.root.getObjectByName(node.name)!)); });
      for (const [name, side] of [['Knife', 'Right'], ['Knife_Offhand', 'Left']]) {
        const weapon = corrected.root.getObjectByName(name!)!, before = original.root.getObjectByName(name!)!;
        assertKnifeAxis(corrected.root, weapon, side!);
        const meshes: THREE.Mesh[] = [], originalMeshes: THREE.Mesh[] = [];
        weapon.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
        before.traverse((node: any) => { if (node.isMesh) originalMeshes.push(node); });
        meshes.forEach((mesh, index) => {
          const retained = radii(originalMeshes[index]!, original.root.getObjectByName('mixamorig' + side + 'Hand')!);
          radii(mesh, corrected.root.getObjectByName('mixamorig' + side + 'Hand')!).forEach((radius, vertex) => expect(Math.abs(radius - retained[vertex]!)).toBeLessThanOrEqual(1e-6));
        });
      }
    }
  } finally {
    disposeCharacter(corrected.root, corrected.mixer); disposeCharacter(original.root, original.mixer);
  }
});

test('실제 아이템 교체·단일/쌍수 전환·상위 몸체 교체는 교정 루트와 공용 소켓을 유지한다', async () => {
  const loaded = await loadHeroModel('rogue', 1), instance = spawnCharacter(loaded);
  const retained = ['Knife', 'Knife_Offhand', 'LibrarySocket_r', 'LibrarySocket_l'].map(name => ({ name, node: instance.root.getObjectByName(name)!, transform: trs(instance.root.getObjectByName(name)!) }));
  try {
    const items = Object.values(ITEM_BY_ID) as any[];
    const single = items.find(item => item.slot === 'weapon' && !item.modelNode && item.rarity === 'N');
    const dual = items.find(item => item.slot === 'weapon' && !item.modelNode && item.rarity === 'S');
    expect(single).toBeDefined(); expect(dual).toBeDefined();
    for (const item of [single, dual, null, dual]) {
      applyLook(instance.root, HEROES.rogue, item ? { weapon: { id: item.id, enh: 0 } } : {});
      for (const record of retained) { expect(instance.root.getObjectByName(record.name)).toBe(record.node); expect(trs(record.node)).toEqual(record.transform); }
      if (item) expect(instance.root.getObjectByName('Knife_Offhand')!.visible).toBe(item.rarity !== 'N');
    }
    for (const id of ['hero_rogue_t2', 'hero_rogue_t3', 'avatar_rogue_crow']) {
      const asset = manifest.assets.find(entry => entry.id === id)!;
      await loadHeroAsset(asset);
      expect(applyLibraryHeroBody(instance.root, asset)).toBe(true);
      expect(instance.root.userData.libraryBodyAssetId).toBe(id);
      for (const record of retained) { expect(instance.root.getObjectByName(record.name)).toBe(record.node); expect(trs(record.node)).toEqual(record.transform); }
    }
  } finally { disposeCharacter(instance.root, instance.mixer); }
});
