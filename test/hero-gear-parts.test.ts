import { expect, test } from 'bun:test';
import * as THREE from 'three';
import PARTS_DATA from '../src/data/hero-gear-parts.json';
import {
  GEAR_PARTS_SCHEMA, validateGearPartsData, pickGearParts, heroSlotMeasure, slotRestRotation,
  buildHeroGearPartMeshes, syncHeroGearParts, refitHeroGearParts, removeHeroGearParts, SLOT_RIGS,
} from '../src/engine/hero-gear-parts.js';

const set = (id: string, parts = ['helm', 'pauldron', 'gauntlet']) => ({ id, path: `/models/gear-parts/${id}.glb`, parts, triangles: 3000, sha256: 'a'.repeat(64) });
const fixtureData = (): any => ({
  schema: GEAR_PARTS_SCHEMA,
  slots: { helm: { ref: 0.2 }, pauldron: { ref: 0.18 }, gauntlet: { ref: 0.25 } },
  grades: { N: null, S: 'parts_a', E: 'parts_b', U: 'parts_b', L: 'parts_a' },
  tint: { S: { color: 0.08, glow: 0 }, U: { color: 0.35, glow: 0.22 } },
  sets: [set('parts_a'), set('parts_b')],
  items: { sword_set: { set: 'parts_b' }, no_helm: { hide: ['helm'] }, plain: { set: null } },
  bodyCovers: { body_helm: ['helm'], body_all: ['helm', 'pauldron', 'gauntlet'] },
});

/** 영웅 몸: Mixamo 본 체인(머리·팔·손), 몸 박스 y 0~2, 머리 관절 y 1.8. 오른쪽은 -x. armDrop 이 0 이면 T자세, 양수면 A자세. */
function hero(armDrop = 0, prefix = 'mixamorig', headY = 1.8) {
  const mk = (name: string, x: number, y: number) => { const b = Object.assign(new THREE.Bone(), { name: prefix + name }); b.position.set(x, y - 1, 0); return b; };
  const hips = Object.assign(new THREE.Bone(), { name: prefix + 'Hips' }); hips.position.set(0, 1, 0);
  const head = mk('Head', 0, headY), headTop = mk('HeadTopEnd', 0, headY + 0.2);
  const rArm = mk('RightArm', -0.2, 1.5), rFore = mk('RightForeArm', -0.2 - 0.3, 1.5 - armDrop), rHand = mk('RightHand', -0.2 - 0.3 - 0.25, 1.5 - 2 * armDrop);
  const lArm = mk('LeftArm', 0.2, 1.5), lFore = mk('LeftForeArm', 0.5, 1.5 - armDrop), lHand = mk('LeftHand', 0.75, 1.5 - 2 * armDrop);
  // forearm 길이 = 0.25 (T자세) 가 되도록 손 위치는 팔꿈치에서 0.25
  rHand.position.set(-0.75, 1.5 - armDrop - 1, 0); lHand.position.set(0.75, 1.5 - armDrop - 1, 0);
  const bones = [hips, head, headTop, rArm, rFore, rHand, lArm, lFore, lHand];
  hips.add(head, headTop, rArm, rFore, rHand, lArm, lFore, lHand);
  const geometry = new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(0.25), 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  skin.userData.libraryBody = 1; skin.name = 'TLL_Library_test';
  const root = new THREE.Group();
  root.userData.authoredContract = { role: 'hero', heroId: 'knight' };
  root.add(hips, skin); root.updateMatrixWorld(true);
  skin.bind(new THREE.Skeleton(bones));
  return { root, skin, bones: { head, rArm, rHand, lArm, lHand, rFore, lFore } };
}

/** 세트 GLB 대용: 이름이 helm/pauldron/gauntlet 인 정적 메시. 재질을 넘기면 파츠별로 쓴다. */
function partsScene(materials?: Record<string, THREE.Material>) {
  const shared = new THREE.MeshStandardMaterial();
  const make = (name: string, geometry: THREE.BufferGeometry) => { const m = new THREE.Mesh(geometry, materials?.[name] ?? shared); m.name = name; return m; };
  const scene = new THREE.Group();
  scene.add(
    make('helm', new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.1, 0)),
    make('pauldron', new THREE.BoxGeometry(0.2, 0.1, 0.2, 2, 1, 1).translate(-0.1, 0, 0)),
    make('gauntlet', new THREE.BoxGeometry(0.2, 0.1, 0.1, 1, 2, 1).translate(-0.1, 0, 0)),
  );
  return { scene };
}
const triangles = (scene: THREE.Object3D, names: string[]) => { let n = 0; scene.traverse((o: any) => { if (o.isMesh && names.includes(o.name)) n += o.geometry.index.count / 3; }); return n; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const armor = (extra: any = {}) => ({ id: 'a1', slot: 'armor', rarity: 'S', ...extra });

test('데이터 검증: 현재 데이터 통과, 잘못된 값은 거절', () => {
  expect(() => validateGearPartsData(PARTS_DATA)).not.toThrow();
  expect(() => validateGearPartsData(fixtureData())).not.toThrow();
  const bad = (mutate: (d: any) => void) => { const d = fixtureData(); mutate(d); expect(() => validateGearPartsData(d)).toThrow(); };
  bad((d) => { d.schema = 'x'; });
  bad((d) => { d.slots.helm.ref = 0; });
  bad((d) => { d.sets[0].path = '/x.glb'; });
  bad((d) => { d.sets[0].id = 'Bad-Id'; d.sets[0].path = '/models/gear-parts/Bad-Id.glb'; });
  bad((d) => { d.sets[1].id = 'parts_a'; d.sets[1].path = '/models/gear-parts/parts_a.glb'; });
  bad((d) => { d.sets[0].triangles = 6001; });
  bad((d) => { d.sets[0].parts = ['wing']; });
  bad((d) => { d.sets[0].sha256 = 'zz'; });
  bad((d) => { d.grades.S = 'parts_missing'; });
  bad((d) => { d.grades.X = null; });
  bad((d) => { d.items.i = { set: 'parts_missing' }; });
  bad((d) => { d.items.i = { hide: ['wing'] }; });
  bad((d) => { d.bodyCovers.b = ['wing']; });
  bad((d) => { d.bodyCovers.b = 'helm'; });
  bad((d) => { d.tint.S.color = 1.5; });
  bad((d) => { d.tint.S.glow = -0.1; });
  bad((d) => { d.tint.Q = { color: 0, glow: 0 }; });
});

test('pickGearParts: 등급 → 세트, N 은 null, items 예외·bodyCovers·opts.hide', () => {
  const data = fixtureData();
  expect(['N', 'S', 'E', 'U', 'L'].map((r) => pickGearParts(armor({ rarity: r }), { data })?.set.id ?? null)).toEqual([null, 'parts_a', 'parts_b', 'parts_b', 'parts_a']);
  expect(pickGearParts(armor({ rarity: 'X' }), { data })).toBeNull();
  const p = pickGearParts(armor({ rarity: 'E', set: 'storm' }), { data })!;
  expect(p.parts).toEqual(['helm', 'pauldron', 'gauntlet']); expect(p.theme).toBe('storm'); expect(p.grade).toBe('E');
  expect(pickGearParts(armor({ id: 'sword_set', rarity: 'S' }), { data })!.set.id).toBe('parts_b');   // set 바꾸기
  expect(pickGearParts(armor({ id: 'plain', rarity: 'L' }), { data })).toBeNull();                       // set null → 파츠 없음
  expect(pickGearParts(armor({ id: 'no_helm' }), { data })!.parts).toEqual(['pauldron', 'gauntlet']);    // hide
  expect(pickGearParts(armor(), { data, bodyAssetId: 'body_helm' })!.parts).toEqual(['pauldron', 'gauntlet']);
  expect(pickGearParts(armor(), { data, hide: ['helm'] })!.parts).toEqual(['pauldron', 'gauntlet']);
  expect(pickGearParts(armor(), { data, bodyAssetId: 'body_all' })).toBeNull();                          // 모두 빠지면 null
  expect(pickGearParts(armor({ slot: 'weapon' }), { data })).toBeNull();
  expect(pickGearParts(null, { data })).toBeNull();
  expect(pickGearParts(armor({ slot: undefined }), { data })!.set.id).toBe('parts_a');                   // slot 생략은 갑옷으로 취급
});

test('heroSlotMeasure: 머리 위 높이·어깨 반폭·아래팔 길이', () => {
  const { skin } = hero();
  expect(heroSlotMeasure(skin, 'headTop')).toBeCloseTo(0.2, 5);       // 몸 박스 max y 2 − 머리 1.8
  expect(heroSlotMeasure(skin, 'shoulderSpan')).toBeCloseTo(0.2, 5);  // 어깨 간격 0.4 / 2
  expect(heroSlotMeasure(skin, 'forearm')).toBeCloseTo(0.25, 5);
  expect(heroSlotMeasure(hero(0, 'mixamorig', 2.5).skin, 'headTop')).toBeNull();   // 머리가 몸 위(음수)
  const noArm = hero(); noArm.bones.rArm.name = 'Tail'; noArm.root.updateMatrixWorld(true);
  expect(heroSlotMeasure(noArm.skin, 'shoulderSpan')).toBeNull();
});

test('slotRestRotation: T자세 무회전, A자세는 저작 축이 팔 방향으로, 왼쪽은 반전 축', () => {
  const t = hero(0);
  const [from, to] = SLOT_RIGS.pauldron.axis as [string, string];
  expect(slotRestRotation(t.skin, [from, to], [-1, 0, 0], false).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  expect(slotRestRotation(t.skin, [from, to], [-1, 0, 0], true).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  const a = hero(0.2);
  const dirR = new THREE.Vector3(-0.3, -0.2, 0).normalize(), dirL = new THREE.Vector3(0.3, -0.2, 0).normalize();
  const r = new THREE.Vector3(-1, 0, 0).applyQuaternion(slotRestRotation(a.skin, [from, to], [-1, 0, 0], false));
  const l = new THREE.Vector3(1, 0, 0).applyQuaternion(slotRestRotation(a.skin, [from, to], [-1, 0, 0], true));
  expect(r.distanceTo(dirR)).toBeLessThan(1e-5); expect(l.distanceTo(dirL)).toBeLessThan(1e-5);
  expect(slotRestRotation(a.skin, ['Nope', 'RightForeArm'], [-1, 0, 0]).angleTo(new THREE.Quaternion())).toBe(0);   // 관절 없음
});

const pickAll = (data: any, grade = 'S', id = 'parts_a'): any => ({ set: data.sets.find((s: any) => s.id === id), parts: ['helm', 'pauldron', 'gauntlet'], theme: null, grade });

test('buildHeroGearPartMeshes: 같은 재질이면 SkinnedMesh 하나로 병합, 삼각형 = 투구 + 어깨×2 + 장갑×2', () => {
  const data = fixtureData(), { skin, bones } = hero(), { scene } = partsScene();
  const meshes = buildHeroGearPartMeshes(scene, skin, pickAll(data), { data })!;
  expect(meshes).toHaveLength(1);
  const m = meshes[0];
  expect(m.isSkinnedMesh).toBe(true); expect(m.name).toBe('HeroGearParts_parts_a'); expect(m.material.polygonOffset).toBe(true);
  expect(m.geometry.index!.count / 3).toBe(triangles(scene, ['helm']) + 2 * triangles(scene, ['pauldron']) + 2 * triangles(scene, ['gauntlet']));
  expect(m.skeleton.bones).toEqual([bones.head, bones.rArm, bones.lArm, bones.rHand, bones.lHand]);
  expect(m.userData.libraryBody).toBeUndefined();
  expect(m.geometry.attributes.skinWeight.getX(0)).toBe(1);
  // 원본 세트 지오메트리는 건드리지 않는다
  expect((scene.children[0] as THREE.Mesh).geometry.attributes.position.count).toBe(24);
});

test('buildHeroGearPartMeshes: 재질이 다르면 재질 수만큼 메시, 본 슬롯은 각 메시 안에서 올바른 본', () => {
  const data = fixtureData(), { skin, bones } = hero();
  const metal = new THREE.MeshStandardMaterial(), cloth = new THREE.MeshStandardMaterial();
  const meshes = buildHeroGearPartMeshes(partsScene({ helm: metal, pauldron: metal, gauntlet: cloth }).scene, skin, pickAll(data), { data })!;
  expect(meshes).toHaveLength(2);
  expect(meshes[0].skeleton.bones).toEqual([bones.head, bones.rArm, bones.lArm]);
  expect(meshes[1].skeleton.bones).toEqual([bones.rHand, bones.lHand]);
  expect(meshes[0].material).not.toBe(metal);   // 기본 makeMaterial 은 복제
  expect(buildHeroGearPartMeshes(partsScene().scene, null as any, pickAll(data), { data })).toBeNull();
  expect(buildHeroGearPartMeshes(new THREE.Group(), skin, pickAll(data), { data })).toBeNull();   // 파츠 메시 없음
});

test('buildHeroGearPartMeshes: 배율 = 치수/ref, 범위 밖 배율 파츠는 빠진다', () => {
  const data = fixtureData(), { skin } = hero();
  const bounds = (parts: string[], d = data) => {
    const [m] = buildHeroGearPartMeshes(partsScene().scene, skin, { ...pickAll(d), parts }, { data: d })!;
    m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.getSize(new THREE.Vector3());
  };
  const base = bounds(['helm']);            // 치수 0.2 / ref 0.2 = 1
  data.slots.helm.ref = 0.1;                // 배율 2
  expect(bounds(['helm']).y / base.y).toBeCloseTo(2, 1);
  data.slots.helm.ref = 0.2;
  const big = fixtureData(); big.slots.helm.ref = 0.01;   // 배율 20: 범위 밖
  const [m] = buildHeroGearPartMeshes(partsScene().scene, skin, pickAll(big), { data: big })!;
  expect(m.skeleton.bones.map((b) => b.name)).not.toContain('mixamorigHead');   // 투구만 빠지고 어깨·장갑은 남음
  const onlyHelm = { ...pickAll(big), parts: ['helm'] };
  expect(buildHeroGearPartMeshes(partsScene().scene, skin, onlyHelm, { data: big })).toBeNull();
});

test('buildHeroGearPartMeshes: 양쪽 짝 법선이 모두 파츠 바깥을 향하고, 왼쪽 짝은 +x 쪽에 놓인다', () => {
  const data = fixtureData(), { skin } = hero();
  const [m] = buildHeroGearPartMeshes(partsScene().scene, skin, { ...pickAll(data), parts: ['pauldron'] }, { data })!;
  const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, slot = m.geometry.attributes.skinIndex;
  const side = [0, 0], center = [0, 0], count = [0, 0];
  for (let i = 0; i < pos.count; i++) { center[slot.getX(i)] += pos.getX(i); count[slot.getX(i)]++; }
  for (let i = 0; i < pos.count; i++) { const s = slot.getX(i); side[s] += nor.getX(i) * (pos.getX(i) - center[s] / count[s]); }
  expect(side[0]).toBeGreaterThan(0);   // 법선·(정점 − 파츠 중심 x) > 0 = 바깥(x 반전 복제 후에도 뒤집히지 않음)
  expect(side[1]).toBeGreaterThan(0);
  expect(center[0] / count[0]).toBeLessThan(0); expect(center[1] / count[1]).toBeGreaterThan(0);
});

test('buildHeroGearPartMeshes: 테마 틴트(color lerp, emissive)와 틴트 없는 등급', () => {
  const data = fixtureData(), { skin } = hero();
  const [m] = buildHeroGearPartMeshes(partsScene().scene, skin, pickAll(data, 'U', 'parts_b'), { data, themeColor: 0xff0000 } as any)!;
  const mat = m.material as THREE.MeshStandardMaterial;
  expect(mat.color.r).toBeCloseTo(1, 5); expect(mat.color.g).toBeCloseTo(0.65, 2);
  expect(mat.emissive.r).toBeCloseTo(0.22, 5); expect(mat.emissive.g).toBe(0);
  // 피격 번쩍임·applyLook 이 되돌리는 기준값도 틴트 결과여야 테마 발광이 유지된다.
  expect(mat.userData.baseEmissive.r).toBeCloseTo(0.22, 5); expect(mat.userData.authoredEmissive.r).toBeCloseTo(0.22, 5);
  const [none] = buildHeroGearPartMeshes(partsScene().scene, skin, pickAll(data, 'E', 'parts_b'), { data, themeColor: 0xff0000 } as any)!;   // E 틴트 없음
  expect((none.material as THREE.MeshStandardMaterial).color.g).toBeCloseTo(1, 5);
  const [plain] = buildHeroGearPartMeshes(partsScene().scene, skin, pickAll(data, 'U', 'parts_b'), { data })!;   // 테마 없음
  expect((plain.material as THREE.MeshStandardMaterial).color.g).toBeCloseTo(1, 5);
});

const gearMeshes = (root: THREE.Object3D) => root.children.filter((c: any) => c.userData.heroGearParts);

test('항목이 없으면 무동작: 로더를 부르지 않는다', () => {
  const { root } = hero(); let loads = 0;
  const load = () => { loads++; return Promise.reject(new Error('no')); };
  const data = fixtureData();
  expect(syncHeroGearParts(root, armor({ rarity: 'N' }), { data, load })).toBe(false);
  expect(syncHeroGearParts(root, null, { data, load })).toBe(false);
  expect(syncHeroGearParts(root, armor({ id: 'plain' }), { data, load })).toBe(false);
  const avatar = hero().root; avatar.userData.authoredContract = { role: 'avatar' };
  expect(syncHeroGearParts(avatar, armor(), { data, load })).toBe(false);
  expect(loads).toBe(0); expect(root.userData.heroGearParts).toBeUndefined();
});

test('부착 → 같은 요청 재호출 무동작 → 등급 변경 교체 → 갑옷 해제 제거', async () => {
  const { root } = hero(); const loads: string[] = []; let changes = 0;
  const options = { data: fixtureData(), load: (path: string) => { loads.push(path); return Promise.resolve(partsScene()); }, onChange: () => { changes++; } };
  expect(syncHeroGearParts(root, armor(), options)).toBe(true);
  await tick();
  expect(root.userData.heroGearParts.pick.set.id).toBe('parts_a'); expect(changes).toBe(1);
  expect(gearMeshes(root)).toHaveLength(1);
  expect(syncHeroGearParts(root, armor(), options)).toBe(true); await tick();
  expect(loads).toEqual(['/models/gear-parts/parts_a.glb']); expect(changes).toBe(1);
  const first = root.userData.heroGearParts.meshes[0]; let disposed = 0;
  first.geometry.addEventListener('dispose', () => disposed++);
  syncHeroGearParts(root, armor({ rarity: 'E' }), options); await tick();
  expect(root.userData.heroGearParts.pick.set.id).toBe('parts_b');
  expect(disposed).toBe(1); expect(first.parent).toBeNull(); expect(gearMeshes(root)).toHaveLength(1);
  const second = root.userData.heroGearParts.meshes[0];
  syncHeroGearParts(root, null, options);
  expect(root.userData.heroGearParts).toBeUndefined(); expect(second.parent).toBeNull(); expect(gearMeshes(root)).toHaveLength(0);
});

test('로드 경쟁: 늦게 도착한 이전 로드가 최신 목표를 덮지 않는다', async () => {
  const { root } = hero(); const releases: Record<string, (v: any) => void> = {};
  const load = (path: string): Promise<any> => new Promise((r) => { releases[path.includes('parts_a') ? 'a' : 'b'] = r; });
  const options = { data: fixtureData(), load };
  syncHeroGearParts(root, armor({ rarity: 'S' }), options); await tick();
  syncHeroGearParts(root, armor({ rarity: 'E' }), options); await tick();
  releases.b(partsScene()); await tick(); await tick();
  expect(root.userData.heroGearParts.pick.set.id).toBe('parts_b');
  releases.a(partsScene()); await tick(); await tick();
  expect(root.userData.heroGearParts.pick.set.id).toBe('parts_b'); expect(gearMeshes(root)).toHaveLength(1);
});

test('해제된 인스턴스에는 늦게 도착한 파츠를 붙이지 않는다', async () => {
  const { root } = hero(); let release: (v: any) => void = () => {};
  syncHeroGearParts(root, armor(), { data: fixtureData(), load: () => new Promise((r) => { release = r; }) });
  root.userData.libraryDisposed = true; release(partsScene()); await tick();
  expect(root.userData.heroGearParts).toBeUndefined(); expect(gearMeshes(root)).toHaveLength(0);
});

test('로드 실패: 경고하고 목표만 비우되, 다른 최신 목표는 유지한다', async () => {
  const { root } = hero(); const warns: any[][] = [];
  const bad = { data: fixtureData(), load: () => Promise.reject(new Error('network')), warn: (...a: any[]) => warns.push(a) };
  syncHeroGearParts(root, armor(), bad); await tick(); await tick();
  expect(warns).toHaveLength(1); expect(root.userData.gearPartsTarget).toBeNull(); expect(root.userData.heroGearParts).toBeUndefined();
  // 지난 요청(S) 실패가 최신 요청(E) 목표를 지우지 않는다
  const pending: Record<string, { ok: (v: any) => void; fail: (e: any) => void }> = {};
  const load = (path: string): Promise<any> => new Promise((ok, fail) => { pending[path.includes('parts_a') ? 'a' : 'b'] = { ok, fail }; });
  const options = { data: fixtureData(), load, warn: () => {} };
  syncHeroGearParts(root, armor({ rarity: 'S' }), options); await tick();
  syncHeroGearParts(root, armor({ rarity: 'E' }), options); await tick();
  const target = root.userData.gearPartsTarget;
  pending.a.fail(new Error('late')); await tick(); await tick();
  expect(root.userData.gearPartsTarget).toBe(target);
  pending.b.ok(partsScene()); await tick(); await tick();
  expect(root.userData.heroGearParts.pick.set.id).toBe('parts_b');
});

test('계약 불일치 GLB(파츠 메시 없음)는 경고하고 아무것도 붙이지 않는다', async () => {
  const { root } = hero(); const warns: string[] = [];
  syncHeroGearParts(root, armor(), { data: fixtureData(), load: () => Promise.resolve({ scene: new THREE.Group() }), warn: (m: string) => warns.push(m) }); await tick();
  expect(warns).toHaveLength(1); expect(root.userData.heroGearParts).toBeUndefined(); expect(root.userData.gearPartsTarget).toBeNull();
});

test('몸 교체 후 refit: 새 본으로 다시 묶이고, bodyCovers 로 투구가 빠지고, 맞는 게 없으면 제거', async () => {
  const { root, skin, bones } = hero();
  root.userData.libraryBodyAssetId = 'body_plain';
  const data = fixtureData();
  syncHeroGearParts(root, armor(), { data, load: () => Promise.resolve(partsScene()) }); await tick();
  const old = root.userData.heroGearParts.meshes[0];
  expect(old.skeleton.bones).toContain(bones.head);
  const swapBody = () => {   // 몸 교체 흉내: 같은 본에 새 스킨을 묶는다
    const next = new THREE.SkinnedMesh(skin.geometry, skin.material); next.userData.libraryBody = 2;
    root.updateMatrixWorld(true); next.bind(new THREE.Skeleton(skin.skeleton.bones));
    root.children.filter((c: any) => c.userData.libraryBody).forEach((c) => c.removeFromParent()); root.add(next); return next;
  };
  const next = swapBody();
  expect(refitHeroGearParts(root)).toBe(true);
  const fresh = root.userData.heroGearParts.meshes[0];
  expect(fresh).not.toBe(old); expect(old.parent).toBeNull(); expect(fresh.parent).toBe(root);
  expect(fresh.skeleton.boneInverses[0].equals(next.skeleton.boneInverses[1])).toBe(true);   // Head 는 skeleton index 1
  // 새 몸이 투구를 덮는다
  root.userData.libraryBodyAssetId = 'body_helm'; swapBody();
  expect(refitHeroGearParts(root)).toBe(true);
  expect(root.userData.heroGearParts.meshes[0].skeleton.bones).not.toContain(bones.head);
  expect(root.userData.heroGearParts.meshes[0].skeleton.bones).toContain(bones.rArm);
  // 전부 덮거나 맞는 게 없으면 제거
  root.userData.libraryBodyAssetId = 'body_all'; swapBody();
  expect(refitHeroGearParts(root)).toBe(false);
  expect(root.userData.heroGearParts).toBeUndefined(); expect(gearMeshes(root)).toHaveLength(0);
  expect(refitHeroGearParts(root)).toBe(false);   // 상태 없으면 무동작
});

test('removeHeroGearParts·disposeCharacter·Actor 해제 시 파츠 지오메트리는 dispose, 공유 몸 지오메트리는 보존', async () => {
  const { disposeCharacter } = await import('../src/engine/assets.js');
  const { Actor } = await import('../src/game/actor.js');
  const options = { data: fixtureData(), load: () => Promise.resolve(partsScene()) };
  for (const kind of ['remove', 'character', 'actor']) {
    const h = hero();
    let target: THREE.Object3D = h.root, actor: any = null;
    if (kind === 'actor') { actor = new Actor({ scene: new THREE.Scene() }, { scene: h.root, animations: [] }, {}); target = actor.model; }
    syncHeroGearParts(target, armor(), options); await tick();
    const mesh = target.userData.heroGearParts.meshes[0] as THREE.SkinnedMesh;
    let partsDisposed = 0, bodyDisposed = 0;
    mesh.geometry.addEventListener('dispose', () => partsDisposed++);
    h.skin.geometry.addEventListener('dispose', () => bodyDisposed++);
    if (kind === 'remove') expect(removeHeroGearParts(target)).toBe(true);
    else if (actor) actor.dispose(); else disposeCharacter(target, new THREE.AnimationMixer(target));
    expect(partsDisposed).toBe(1); expect(bodyDisposed).toBe(0);
    expect(mesh.parent).toBeNull(); expect(target.userData.heroGearParts).toBeUndefined();
  }
  expect(removeHeroGearParts(hero().root)).toBe(false);
});

/** 슬롯 파츠 한 쪽(skinIndex 슬롯)의 지오메트리 중심과 크기. */
function pieceBox(mesh: THREE.SkinnedMesh, boneSlot: number) {
  const pos = mesh.geometry.attributes.position, slot = mesh.geometry.attributes.skinIndex, box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) if (slot.getX(i) === boneSlot) box.expandByPoint(v.fromBufferAttribute(pos, i));
  return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
}
const gauntletBoxes = (h: ReturnType<typeof hero>, data: any, heroId: string | null = 'knight', slot = 'gauntlet') => {
  const [m] = buildHeroGearPartMeshes(partsScene().scene, h.skin, { ...pickAll(data), parts: [slot], heroId }, { data })!;
  return [pieceBox(m, 0), pieceBox(m, 1)];   // 0 = 오른손, 1 = 왼손
};

test('맞춤 보정: pickGearParts 가 heroId 를 반환에 싣는다', () => {
  const data = fixtureData();
  expect(pickGearParts(armor(), { data, heroId: 'knight' })!.heroId).toBe('knight');
  expect(pickGearParts(armor(), { data })!.heroId).toBeNull();
});

test('맞춤 보정: 세트 fit × 영웅 heroFit 배율이 곱해지고, 없는 영웅·다른 슬롯에는 영향 없음', () => {
  const data = fixtureData(), h = hero();
  const base = gauntletBoxes(h, data)[0];
  data.sets[0].fit = { gauntlet: { scale: 1.5 } };
  data.heroFit = { knight: { gauntlet: { scale: 1.2 } } };
  expect(() => validateGearPartsData(data)).not.toThrow();
  expect(gauntletBoxes(h, data)[0].size.y / base.size.y).toBeCloseTo(1.8, 2);
  expect(gauntletBoxes(h, data, 'mage')[0].size.y / base.size.y).toBeCloseTo(1.5, 2);   // heroFit 은 해당 영웅만
  expect(gauntletBoxes(h, data, null)[0].size.y / base.size.y).toBeCloseTo(1.5, 2);
  // 보정 후 배율이 범위(3) 밖이면 파츠가 빠진다
  data.heroFit.knight.gauntlet.scale = 1.9; data.sets[0].fit.gauntlet.scale = 1.9;   // 1.9 × 1.9 = 3.61 > 3
  expect(buildHeroGearPartMeshes(partsScene().scene, h.skin, { ...pickAll(data), parts: ['gauntlet'], heroId: 'knight' }, { data })).toBeNull();
});

test('맞춤 보정: 오프셋은 배율·회전 뒤 적용되고 왼쪽은 x 반전', () => {
  const data = fixtureData(), h = hero();
  const base = gauntletBoxes(h, data);
  data.heroFit = { knight: { gauntlet: { offset: [0.1, 0.05, 0] } } };
  const moved = gauntletBoxes(h, data);
  const dr = moved[0].center.clone().sub(base[0].center), dl = moved[1].center.clone().sub(base[1].center);
  expect(dr.distanceTo(new THREE.Vector3(0.1, 0.05, 0))).toBeLessThan(1e-5);     // T자세: 회전 없음, 배율 1
  expect(dl.distanceTo(new THREE.Vector3(-0.1, 0.05, 0))).toBeLessThan(1e-5);   // 왼쪽 x 반전
  // 배율 1.5: 저작 단위 오프셋이 배율만큼 늘어난다
  data.sets[0].fit = { gauntlet: { scale: 1.5 } };
  const scaled = gauntletBoxes(h, data);
  const scaledBase = (() => { const d = fixtureData(); d.sets[0].fit = { gauntlet: { scale: 1.5 } }; return gauntletBoxes(h, d); })();
  expect(scaled[0].center.clone().sub(scaledBase[0].center).distanceTo(new THREE.Vector3(0.15, 0.075, 0))).toBeLessThan(1e-5);
  // A자세: 오프셋이 슬롯 rest 회전을 따라 돈다(오른쪽 어깨, 배율 0.2/0.18)
  const a = hero(0.2), plain = fixtureData(), fit = fixtureData();
  fit.heroFit = { knight: { pauldron: { offset: [0, 0.1, 0] } } };
  const rot = slotRestRotation(a.skin, SLOT_RIGS.pauldron.axis as [string, string], SLOT_RIGS.pauldron.authored, false);
  const expected = new THREE.Vector3(0, 0.1, 0).multiplyScalar(0.2 / 0.18).applyQuaternion(rot);
  expect(gauntletBoxes(a, fit, 'knight', 'pauldron')[0].center.clone().sub(gauntletBoxes(a, plain, 'knight', 'pauldron')[0].center).distanceTo(expected)).toBeLessThan(1e-5);
  expect(expected.x).not.toBeCloseTo(0, 3);   // 실제로 회전이 있었다
});

test('맞춤 보정: 잘못된 fit·heroFit 은 검증에서 거절', () => {
  const bad = (mutate: (d: any) => void) => { const d = fixtureData(); mutate(d); expect(() => validateGearPartsData(d)).toThrow(); };
  bad((d) => { d.sets[0].fit = { wing: { scale: 1 } }; });
  bad((d) => { d.sets[0].fit = { helm: { scale: 0.5 } }; });
  bad((d) => { d.sets[0].fit = { helm: { scale: 2 } }; });
  bad((d) => { d.sets[0].fit = { helm: { offset: [0, 0] } }; });
  bad((d) => { d.sets[0].fit = { helm: { offset: [0, 0.6, 0] } }; });
  bad((d) => { d.heroFit = { knight: { helm: { scale: 3 } } }; });
  bad((d) => { d.heroFit = { knight: { tail: { scale: 1 } } }; });
  const ok = fixtureData(); ok.sets[0].fit = { helm: { scale: 1.9, offset: [0.5, -0.5, 0] } }; ok.heroFit = { knight: { pauldron: { scale: 0.6 } } };
  expect(() => validateGearPartsData(ok)).not.toThrow();
});

test('맞춤 보정: 영웅×세트 heroSetFit 은 그 영웅·그 세트에만 곱해지고, 없는 세트·잘못된 값은 거절', () => {
  const data = fixtureData(), h = hero(), id = data.sets[0].id;
  const base = gauntletBoxes(h, data)[0];
  data.heroFit = { knight: { gauntlet: { scale: 1.2 } } };
  data.heroSetFit = { knight: { [id]: { gauntlet: { scale: 1.5 } } } };
  expect(() => validateGearPartsData(data)).not.toThrow();
  expect(gauntletBoxes(h, data)[0].size.y / base.size.y).toBeCloseTo(1.8, 2);
  expect(gauntletBoxes(h, data, 'mage')[0].size.y / base.size.y).toBeCloseTo(1, 2);
  const bad = (mutate: (d: any) => void) => { const d = fixtureData(); mutate(d); expect(() => validateGearPartsData(d)).toThrow(); };
  bad((d) => { d.heroSetFit = { knight: { parts_missing: { helm: { scale: 1 } } } }; });
  bad((d) => { d.heroSetFit = { knight: { [d.sets[0].id]: { helm: { scale: 3 } } } }; });
  bad((d) => { d.heroSetFit = { knight: { [d.sets[0].id]: { tail: { scale: 1 } } } }; });
});
