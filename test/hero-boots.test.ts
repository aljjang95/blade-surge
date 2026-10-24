import { expect, test } from 'bun:test';
import * as THREE from 'three';
import BOOTS_DATA from '../src/data/hero-boots.json';
import {
  pickBootsEntry, normalizeBoneName, findBoneIndex, boneRestPosition, heroAnkleHeight, bootsGeometryContract, mirrorBootsGeometry,
  buildHeroBootsMesh, syncHeroBoots, refitHeroBoots, removeHeroBoots, validateBootsData, BOOTS_SCHEMA,
} from '../src/engine/hero-boots.js';
import { applyGearAccents } from '../src/game/gear-accents.js';

const entry = (id: string, grades: string[]) => ({ id, grades, path: `/models/boots/${id}.glb`, triangles: 3000, sha256: 'a'.repeat(64) });
const full = () => ({ schema: BOOTS_SCHEMA, boots: [entry('boots_n', ['S']), entry('boots_e', ['E', 'U']), entry('boots_l', ['L'])] });

/** 영웅 몸: 발 관절이 바닥 위 ankle 높이에 있는 Mixamo 본 체인 + 스킨드 박스(바닥 y=0). */
function hero(prefix = 'mixamorig', ankle = 0.1, footName = 'RightFoot') {
  const hips = Object.assign(new THREE.Bone(), { name: prefix + 'Hips' });
  const rf = Object.assign(new THREE.Bone(), { name: prefix + footName });
  const lf = Object.assign(new THREE.Bone(), { name: prefix + 'LeftFoot' });
  hips.position.set(0, 1, 0); rf.position.set(-0.2, ankle - 1, 0); lf.position.set(0.2, ankle - 1, 0); hips.add(rf, lf);
  const geometry = new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  skin.userData.libraryBody = 1; skin.name = 'TLL_Library_test';
  const root = new THREE.Group();
  root.userData.authoredContract = { role: 'hero', heroId: 'knight' };
  root.add(hips, skin); root.updateMatrixWorld(true);
  skin.bind(new THREE.Skeleton([hips, rf, lf]));
  return { root, skin, rf, lf };
}

/** 부츠 GLB 대용: 발목 원점, 밑창 y=-0.1, 윗단 y=0.2 인 비대칭 정적 메시 한 개(+x 쪽으로 치우침). */
function bootsScene(bottom = -0.1) {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 0.5).translate(0.05, bottom + 0.15, 0.1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const scene = new THREE.Group(); scene.add(mesh);
  return { scene };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('등급 매핑: N 없음, S=boots_n, E·U=boots_e, L=boots_l', () => {
  const data = full();
  expect(['N', 'S', 'E', 'U', 'L'].map((r) => pickBootsEntry(r, data)?.id ?? null)).toEqual([null, 'boots_n', 'boots_e', 'boots_e', 'boots_l']);
  expect(pickBootsEntry('X', data)).toBeNull();
  expect(pickBootsEntry('L', { schema: BOOTS_SCHEMA, boots: [entry('boots_e', ['E'])] })).toBeNull();   // 없는 등급은 원래 발
  for (const r of ['N', 'S', 'E', 'U', 'L']) expect(pickBootsEntry(r, BOOTS_DATA)).toBeNull();          // 출하 데이터는 아트 전까지 비어 있다
});

test('데이터 검증: 경로·삼각형 예산·등급 중복을 거절한다', () => {
  expect(() => validateBootsData(full())).not.toThrow();
  expect(() => validateBootsData({ schema: BOOTS_SCHEMA, boots: [{ ...entry('boots_n', ['S']), path: '/x.glb' }] })).toThrow();
  expect(() => validateBootsData({ schema: BOOTS_SCHEMA, boots: [{ ...entry('boots_n', ['S']), triangles: 99999 }] })).toThrow();
  expect(() => validateBootsData({ schema: BOOTS_SCHEMA, boots: [entry('boots_n', ['S']), entry('boots_e', ['S'])] })).toThrow();
  expect(() => validateBootsData({ schema: BOOTS_SCHEMA, boots: [entry('boots_n', ['N'])] })).toThrow();   // N 은 부츠가 없다
});

test('발 관절 이름은 접두·기호를 무시하고 찾는다', () => {
  expect(['mixamorigRightFoot', 'mixamorig:RightFoot', 'RightFoot'].map(normalizeBoneName)).toEqual(['RightFoot', 'RightFoot', 'RightFoot']);
  const a = hero('mixamorig'), b = hero('mixamorig:');
  expect(findBoneIndex(a.skin.skeleton, 'RightFoot')).toBe(1);
  expect(findBoneIndex(b.skin.skeleton, 'LeftFoot')).toBe(2);
  expect(findBoneIndex(a.skin.skeleton, 'Tail')).toBe(-1);
});

test('발목 높이와 본 rest 위치는 몸 지오메트리 공간 기준이다', () => {
  const { skin } = hero('mixamorig', 0.12);
  expect(boneRestPosition(skin, 1).toArray().map((v) => +v.toFixed(5))).toEqual([-0.2, 0.12, 0]);
  expect(heroAnkleHeight(skin)).toBeCloseTo(0.12, 5);
  expect(heroAnkleHeight(hero('mixamorig', 0.1, 'RightFootX').skin)).toBeNull();
});

test('저작 계약: 밑창 y·윗단 범위 밖은 거절', () => {
  expect(bootsGeometryContract((bootsScene().scene.children[0] as THREE.Mesh).geometry)).toBe(true);
  expect(bootsGeometryContract((bootsScene(0.2).scene.children[0] as THREE.Mesh).geometry)).toBe(false);   // 밑창이 발목 위
  expect(bootsGeometryContract((bootsScene(-1).scene.children[0] as THREE.Mesh).geometry)).toBe(false);    // 너무 아래(미터 아님)
});

test('왼발은 x 반전 + 감김 뒤집기 + 법선 반전, 원본은 그대로', () => {
  const src = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0);
  const before = src.attributes.position.array.slice(), idx = src.index!.array.slice();
  const m = mirrorBootsGeometry(src);
  expect([...src.attributes.position.array]).toEqual([...before]); expect([...src.index!.array]).toEqual([...idx]);
  m.computeBoundingBox(); expect(m.boundingBox!.max.x).toBeCloseTo(0, 5); expect(m.boundingBox!.min.x).toBeCloseTo(-1, 5);
  expect(m.index!.getX(1)).toBe(idx[2]); expect(m.index!.getX(2)).toBe(idx[1]);
  const i = 0; expect(m.attributes.normal.getX(i)).toBeCloseTo(-src.attributes.normal.getX(i), 5);
});

test('양발 부츠 메시: 발 관절 두 본(영웅 노드)에 묶이고 영웅 발목 높이에 맞춰 크기가 자동으로 정해진다', () => {
  const small = hero('mixamorig', 0.1), tall = hero('mixamorig', 0.2);
  const mesh = buildHeroBootsMesh(bootsScene().scene, small.skin, { id: 'boots_e' })!;
  expect(mesh.skeleton.bones).toEqual([small.rf, small.lf]);
  expect(mesh.userData.libraryBody).toBeUndefined();
  expect(mesh.material.polygonOffset).toBe(true);
  mesh.geometry.computeBoundingBox();
  expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0, 1);   // 밑창이 몸 바닥(y=0)에 닿는다(부풀림 오차 안)
  const big = buildHeroBootsMesh(bootsScene().scene, tall.skin, { id: 'boots_e' })!;
  big.geometry.computeBoundingBox();
  const h = (m: any) => m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y;
  expect(h(big) / h(mesh)).toBeCloseTo(2, 1);   // 발목이 2배 높은 영웅은 부츠도 2배
  // 오른발 짝은 오른발 본 쪽(-x), 왼발 짝은 왼발 본 쪽(+x)에 놓인다(부츠가 +x 로 치우친 비대칭 메시여도 반전 복제로 좌우가 대칭)
  const pos = mesh.geometry.attributes.position, slot = mesh.geometry.attributes.skinIndex;
  const xs: number[][] = [[], []];
  for (let i = 0; i < pos.count; i++) xs[slot.getX(i)].push(pos.getX(i));
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  expect(mean(xs[0])).toBeLessThan(0); expect(mean(xs[1])).toBeGreaterThan(0);
  expect(mesh.geometry.attributes.skinWeight.getX(0)).toBe(1);
});

test('계약 위반·골격 불일치는 null', () => {
  const { skin } = hero();
  expect(buildHeroBootsMesh(bootsScene(0.2).scene, skin, { id: 'boots_e' })).toBeNull();
  expect(buildHeroBootsMesh(new THREE.Group(), skin, { id: 'boots_e' })).toBeNull();
  expect(buildHeroBootsMesh(bootsScene().scene, hero('mixamorig', 0.1, 'RightFootX').skin, { id: 'boots_e' })).toBeNull();
});

test('항목이 없으면 무동작: 로더를 부르지 않고 아무것도 붙이지 않는다', () => {
  const { root } = hero(); let loads = 0;
  const load = () => { loads++; return Promise.reject(new Error('no')); };
  expect(syncHeroBoots(root, { rarity: 'L' }, { data: { schema: BOOTS_SCHEMA, boots: [] }, load })).toBe(false);
  expect(syncHeroBoots(root, { rarity: 'N' }, { data: full(), load })).toBe(false);   // N 은 원래 발
  expect(syncHeroBoots(root, null, { data: full(), load })).toBe(false);
  expect(loads).toBe(0);
  expect(root.userData.heroBoots).toBeUndefined();
  expect(root.userData.gearFeetHidden).toBeFalsy();
  expect(root.children.filter((c: any) => c.isSkinnedMesh)).toHaveLength(1);
});

test('부착 → 같은 부츠 재호출 무동작 → 등급 변경 교체 → 신발 해제 제거 + 발 숨김 연동', async () => {
  const { root } = hero(); const loads: string[] = []; let changes = 0;
  const options = { data: full(), load: (path: string) => { loads.push(path); return Promise.resolve(bootsScene()); }, onChange: () => { changes++; } };
  expect(syncHeroBoots(root, { rarity: 'E' }, options)).toBe(true);
  await tick();
  expect(root.userData.heroBoots.id).toBe('boots_e'); expect(changes).toBe(1);
  expect(root.userData.gearFeetHidden).toBe(true);
  expect(syncHeroBoots(root, { rarity: 'U' }, options)).toBe(true);   // U 도 같은 boots_e
  await tick();
  expect(loads).toEqual(['/models/boots/boots_e.glb']);
  const first = root.userData.heroBoots.mesh;
  syncHeroBoots(root, { rarity: 'L' }, options); await tick();
  expect(root.userData.heroBoots.id).toBe('boots_l'); expect(first.parent).toBeNull();
  expect(root.children.filter((c: any) => c.userData.heroBoots)).toHaveLength(1);
  syncHeroBoots(root, null, options);
  expect(root.userData.heroBoots).toBeUndefined();
  expect(root.userData.gearFeetHidden).toBe(false);
  expect(root.children.filter((c: any) => c.userData.heroBoots)).toHaveLength(0);
});

test('윤곽광 상태가 있으면 발 숨김 유니폼이 켜지고 꺼진다', async () => {
  const { root } = hero();
  applyGearAccents(root, {}, {});
  const state = root.userData.gearRim;
  expect(state.hideFeet.value).toBe(0);
  const options = { data: full(), load: () => Promise.resolve(bootsScene()) };
  syncHeroBoots(root, { rarity: 'S' }, options); await tick();
  expect(state.hideFeet.value).toBe(1);
  removeHeroBoots(root);
  expect(state.hideFeet.value).toBe(0);
  expect([...state.footBones.value.slice(0, 3)]).toEqual([2, 1, -1]);   // LeftFoot, RightFoot 인덱스
});

test('몸이 교체되면 새 몸의 역바인드·발목 높이로 다시 맞추고, 맞지 않으면 치운다', async () => {
  const { root, skin, rf, lf } = hero();
  syncHeroBoots(root, { rarity: 'E' }, { data: full(), load: () => Promise.resolve(bootsScene()) }); await tick();
  const old = root.userData.heroBoots.mesh;
  old.geometry.computeBoundingBox(); const oldHeight = old.geometry.boundingBox.max.y;
  // 몸 교체 흉내: 같은 본, 더 큰 발목 높이(bone 위치를 올리고 새 스킨을 묶는다)
  rf.position.y += 0.1; lf.position.y += 0.1; root.updateMatrixWorld(true);
  const next = new THREE.SkinnedMesh(skin.geometry, skin.material); next.userData.libraryBody = 2;
  next.bind(new THREE.Skeleton(skin.skeleton.bones));
  skin.removeFromParent(); root.add(next);
  expect(refitHeroBoots(root)).toBe(true);
  const fresh = root.userData.heroBoots.mesh;
  expect(fresh).not.toBe(old); expect(old.parent).toBeNull();
  fresh.geometry.computeBoundingBox(); expect(fresh.geometry.boundingBox.max.y).toBeGreaterThan(oldHeight);
  expect(fresh.skeleton.boneInverses[0].equals(next.skeleton.boneInverses[1])).toBe(true);
  // 발 관절이 없는 몸이면 치운다
  next.removeFromParent();
  const other = hero('mixamorig', 0.1, 'RightFootX'); root.add(other.skin);
  expect(refitHeroBoots(root)).toBe(false);
  expect(root.userData.heroBoots).toBeUndefined();
  expect(root.userData.gearFeetHidden).toBe(false);
});

test('해제된 인스턴스에는 늦게 도착한 부츠를 붙이지 않는다', async () => {
  const { root } = hero(); let release: (v: any) => void = () => {};
  syncHeroBoots(root, { rarity: 'S' }, { data: full(), load: () => new Promise((r) => { release = r; }) });
  root.userData.libraryDisposed = true; release(bootsScene());
  await tick();
  expect(root.userData.heroBoots).toBeUndefined();
});

test('계약을 어긴 GLB 는 경고 후 원래 발을 유지한다', async () => {
  const { root } = hero(); const warns: string[] = [];
  syncHeroBoots(root, { rarity: 'S' }, { data: full(), load: () => Promise.resolve(bootsScene(0.3)), warn: (m: string) => warns.push(m) }); await tick();
  expect(root.userData.heroBoots).toBeUndefined(); expect(warns).toHaveLength(1);
  expect(root.userData.gearFeetHidden).toBeFalsy();
});
