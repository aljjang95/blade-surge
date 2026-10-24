import { expect, test } from 'bun:test';
import * as THREE from 'three';
import BOOTS_DATA from '../src/data/hero-boots.json';
import {
  bootsTierForRarity, pickBootsEntry, normalizeBoneName, mapBootsBones, fitBootsGeometry, buildHeroBootsMeshes,
  syncHeroBoots, refitHeroBoots, removeHeroBoots, validateBootsData, BOOTS_SCHEMA,
} from '../src/engine/hero-boots.js';

const entry = (tier: string) => ({ id: `boots_${tier.toLowerCase()}`, tier, path: `/models/boots/boots_${tier.toLowerCase()}.glb`, triangles: 1500, sha256: 'a'.repeat(64) });
const data = (...tiers: string[]) => ({ schema: BOOTS_SCHEMA, boots: tiers.map(entry) });
const NAMES = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'];

/** 영웅 몸: Mixamo 본 체인 + 스킨드 박스. prefix 로 본 이름 규칙을 바꾼다. */
function hero(prefix = 'mixamorig', offset = 0) {
  const bones = NAMES.map((name) => Object.assign(new THREE.Bone(), { name: prefix + name }));
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
  bones.forEach((bone, i) => bone.position.set(0, i ? 0.3 : 1, 0));
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  skin.userData.libraryBody = 1; skin.name = 'TLL_Library_test';
  const root = new THREE.Group();
  root.userData.authoredContract = { role: 'hero', heroId: 'knight' };
  root.add(bones[0], skin); root.updateMatrixWorld(true);
  skin.bind(new THREE.Skeleton(bones, bones.map((bone, i) => new THREE.Matrix4().makeTranslation(0, -(i ? 0.3 * i : 0) - offset, 0))));
  return { root, skin, bones };
}

/** 부츠 GLB 대용: 'mixamorig' 접두 + 같은 본 이름의 작은 스킨드 메시. */
function bootsScene(names = NAMES, prefix = 'mixamorig:') {
  const bones = names.map((name) => Object.assign(new THREE.Bone(), { name: prefix + name }));
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
  const geometry = new THREE.BoxGeometry(.4, .3, .6);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).fill(3), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const scene = new THREE.Group(); scene.add(bones[0], mesh); mesh.bind(new THREE.Skeleton(bones));
  return { scene };
}

test('신발 등급은 몸 단계 규칙대로 N/E/L 부츠에 매핑한다(S=N, U=E)', () => {
  expect(['N', 'S', 'E', 'U', 'L'].map(bootsTierForRarity)).toEqual(['N', 'N', 'E', 'E', 'L']);
  expect(bootsTierForRarity('X')).toBeNull();
  expect(pickBootsEntry('L', data('N', 'E', 'L'))?.tier).toBe('L');
  expect(pickBootsEntry('U', data('N', 'E', 'L'))?.tier).toBe('E');
  expect(pickBootsEntry('S', data('N', 'E', 'L'))?.tier).toBe('N');
});

test('없는 단계는 한 단계씩 낮춘다. 항목이 없으면 null', () => {
  expect(pickBootsEntry('L', data('N', 'E'))?.tier).toBe('E');
  expect(pickBootsEntry('E', data('L'))).toBeNull();
  expect(pickBootsEntry('L', data())).toBeNull();
  expect(pickBootsEntry('L', BOOTS_DATA)).toBeNull();   // 출하 데이터는 아트 전까지 비어 있다
});

test('데이터 검증: 경로·삼각형 예산·중복 단계를 거절한다', () => {
  expect(() => validateBootsData(data('N', 'E', 'L'))).not.toThrow();
  expect(() => validateBootsData({ ...data('N'), boots: [{ ...entry('N'), path: '/x.glb' }] })).toThrow();
  expect(() => validateBootsData({ ...data('N'), boots: [{ ...entry('N'), triangles: 99999 }] })).toThrow();
  expect(() => validateBootsData({ ...data('N'), boots: [entry('N'), { ...entry('N'), id: 'boots_n2' }] })).toThrow();
});

test('본 이름은 접두·기호를 무시하고 짝짓는다', () => {
  expect(['mixamorigLeftLeg', 'mixamorig:LeftLeg', 'LeftLeg'].map(normalizeBoneName)).toEqual(['LeftLeg', 'LeftLeg', 'LeftLeg']);
  const { skin, bones } = hero('mixamorig');
  const mapped = mapBootsBones(bootsScene().scene.children.slice(0, 1).flatMap((b: any) => { const out: any[] = []; b.traverse((o: any) => out.push(o)); return out; }), skin.skeleton)!;
  expect(mapped.bones).toEqual(bones);
  expect(mapped.inverses[3]).not.toBe(skin.skeleton.boneInverses[3]);   // 복제본
  expect(mapped.inverses[3].equals(skin.skeleton.boneInverses[3])).toBe(true);
});

test('재결합한 부츠 스킨의 본은 영웅 본 노드 자신이다', () => {
  const { skin, bones } = hero();
  const meshes = buildHeroBootsMeshes(bootsScene().scene, skin, entry('E'), 'knight')!;
  expect(meshes).toHaveLength(1);
  expect(meshes[0].skeleton.bones).toEqual(bones);
  expect(meshes[0].skeleton.bones.every((bone: any) => bones.includes(bone))).toBe(true);
  expect(meshes[0].userData.libraryBody).toBeUndefined();
  expect(meshes[0].material.polygonOffset).toBe(true);
});

test('다른 골격이면 거절한다(null)', () => {
  const { skin } = hero();
  expect(buildHeroBootsMeshes(bootsScene(['Hips', 'LeftUpLeg', 'Tail']).scene, skin, entry('N'), 'knight')).toBeNull();
  expect(buildHeroBootsMeshes(new THREE.Group(), skin, entry('N'), 'knight')).toBeNull();
});

test('부풀림은 원본 지오메트리를 건드리지 않고 법선 쪽으로 키운다', () => {
  const geometry = new THREE.BoxGeometry(.4, .3, .6);
  const before = geometry.attributes.position.array.slice();
  const fitted = fitBootsGeometry(geometry, { scale: 1, inflate: .1 });
  expect([...geometry.attributes.position.array]).toEqual([...before]);
  fitted.computeBoundingBox();
  expect(fitted.boundingBox!.max.y).toBeGreaterThan(.15);
  const scaled = fitBootsGeometry(geometry, { scale: 2, inflate: 0 });
  expect(scaled.boundingBox!.max.x).toBeCloseTo(.4, 5);
});

test('항목이 없으면 무동작: 로더를 부르지 않고 아무것도 붙이지 않는다', () => {
  const { root } = hero(); let loads = 0;
  expect(syncHeroBoots(root, { rarity: 'L' }, { data: data(), load: () => { loads++; return Promise.reject(new Error('no')); } })).toBe(false);
  expect(syncHeroBoots(root, null, { data: data('N', 'E', 'L'), load: () => { loads++; return Promise.reject(new Error('no')); } })).toBe(false);
  expect(loads).toBe(0);
  expect(root.userData.heroBoots).toBeUndefined();
  expect(root.children.filter((c: any) => c.isSkinnedMesh)).toHaveLength(1);
});

test('부착 → 같은 등급 재호출 무동작 → 등급 변경 교체 → 신발 해제 제거', async () => {
  const { root } = hero(); const loads: string[] = []; let changes = 0;
  const options = { data: data('N', 'E', 'L'), load: (path: string) => { loads.push(path); return Promise.resolve(bootsScene()); }, onChange: () => { changes++; } };
  expect(syncHeroBoots(root, { rarity: 'E' }, options)).toBe(true);
  await new Promise((r) => setTimeout(r, 0));
  expect(root.userData.heroBoots.id).toBe('boots_e'); expect(changes).toBe(1);
  expect(syncHeroBoots(root, { rarity: 'U' }, options)).toBe(true);   // U 도 E 부츠
  await new Promise((r) => setTimeout(r, 0));
  expect(loads).toEqual(['/models/boots/boots_e.glb']);
  const first = root.userData.heroBoots.meshes[0];
  syncHeroBoots(root, { rarity: 'L' }, options);
  await new Promise((r) => setTimeout(r, 0));
  expect(root.userData.heroBoots.id).toBe('boots_l'); expect(first.parent).toBeNull();
  expect(root.children.filter((c: any) => c.userData.heroBoots)).toHaveLength(1);
  syncHeroBoots(root, null, options);
  expect(root.userData.heroBoots).toBeUndefined();
  expect(root.children.filter((c: any) => c.userData.heroBoots)).toHaveLength(0);
});

test('몸이 교체되면 새 몸의 본·역바인드로 다시 묶고, 맞지 않으면 치운다', async () => {
  const { root, skin } = hero();
  const options = { data: data('E'), load: () => Promise.resolve(bootsScene()) };
  syncHeroBoots(root, { rarity: 'E' }, options); await new Promise((r) => setTimeout(r, 0));
  const old = root.userData.heroBoots.meshes[0];
  // 몸 교체 흉내: 같은 본을 쓰되 역바인드가 다른 새 스킨
  const next = new THREE.SkinnedMesh(skin.geometry, skin.material); next.userData.libraryBody = 2;
  next.bind(new THREE.Skeleton(skin.skeleton.bones, skin.skeleton.boneInverses.map((m: THREE.Matrix4) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, .05, 0)))));
  skin.removeFromParent(); root.add(next);
  expect(refitHeroBoots(root)).toBe(true);
  const fresh = root.userData.heroBoots.meshes[0];
  expect(fresh).not.toBe(old); expect(old.parent).toBeNull();
  expect(fresh.skeleton.boneInverses[3].equals(next.skeleton.boneInverses[3])).toBe(true);
  // 골격이 다른 몸이면 치운다
  next.removeFromParent();
  const other = hero('mixamorig'); other.bones[4].name = 'mixamorigTail'; other.skin.skeleton.bones[4].name = 'mixamorigTail';
  root.add(other.skin);
  expect(refitHeroBoots(root)).toBe(false);
  expect(root.userData.heroBoots).toBeUndefined();
});

test('사망·해제된 인스턴스에는 늦게 도착한 부츠를 붙이지 않는다', async () => {
  const { root } = hero(); let release: (v: any) => void = () => {};
  syncHeroBoots(root, { rarity: 'N' }, { data: data('N'), load: () => new Promise((r) => { release = r; }) });
  root.userData.libraryDisposed = true; release(bootsScene());
  await new Promise((r) => setTimeout(r, 0));
  expect(root.userData.heroBoots).toBeUndefined();
  removeHeroBoots(root);
});
