import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { DropSystem } from '../src/game/drops.js';
import { ITEM_BY_ID, SLOTS } from '../src/data/items.js';
import { SURFACE_TEXTURES } from '../src/engine/surface-textures.js';
import { itemFormHeroIds } from '../src/ui/item-visual-forms.js';

function withSurfaces(run: () => void) {
  const keys = ['hero-weave', 'forged-metal'];
  const saved = keys.map(key => SURFACE_TEXTURES[key]);
  const textures = keys.map(() => new THREE.DataTexture(new Uint8Array([128,128,128,255]), 1, 1, THREE.RGBAFormat));
  textures.forEach((texture, i) => { texture.needsUpdate = true; SURFACE_TEXTURES[keys[i]] = texture; });
  try { run(); }
  finally {
    keys.forEach((key, i) => { if (saved[i]) SURFACE_TEXTURES[key] = saved[i]; else delete SURFACE_TEXTURES[key]; });
    textures.forEach(texture => texture.dispose());
  }
}

const meshesOf = (root: THREE.Object3D) => { const list: THREE.Mesh[] = []; root.traverse((o: any) => { if (o.isMesh) list.push(o); }); return list; };
// 셰이더 프로그램을 가르는 성질(맵 유무 · 정점 속성 · 인스턴싱 · 셰이더 훅 키). 색 · 세기 같은 유니폼은 넣지 않는다.
function featureKey(mesh: THREE.Mesh) {
  return [mesh.material].flat().map((material: any) => JSON.stringify({
    type: material.type, program: material.customProgramCacheKey(), vertexShader: material.vertexShader?.length ?? 0,
    map: !!material.map, bump: !!material.bumpMap, roughness: !!material.roughnessMap,
    normal: !!material.normalMap, metalness: !!material.metalnessMap, emissive: !!material.emissiveMap,
    alpha: !!material.alphaMap, transparent: material.transparent, vertexColors: material.vertexColors, side: material.side, blending: material.blending,
    attributes: Object.keys(mesh.geometry.attributes).sort(), morph: Object.keys(mesh.geometry.morphAttributes).sort(),
    skinned: !!(mesh as THREE.SkinnedMesh).isSkinnedMesh, instanced: !!(mesh as THREE.InstancedMesh).isInstancedMesh,
  })).join('+');
}

function dropFixture() {
  const scene = new THREE.Scene();
  const system: any = Object.create(DropSystem.prototype);
  Object.assign(system, {
    game: { scene, stage: {}, heroId: 'knight', player: { alive: true, pos: new THREE.Vector3(50, 0, 50) }, fx: { groundTex() {}, holyBurst() {}, burst() {} },
      renderer: { camera: new THREE.PerspectiveCamera(), flashScreen() {} }, rollDrop: () => { throw new Error('preparation rolled a reward'); } }, scene,
    items: [], gold: 19, stones: 3, stones2: 2, stones3: 1, fragments: 7, loot: [{ id: 'r_copper', rarity: 'N' }],
    _matCache: {}, _preparationVisuals: null,
  });
  return system;
}

test('detached preparation shells cover every catalogue drop shader and the instanced rarity auras', () => withSurfaces(() => {
  const system = dropFixture();
  const objects: THREE.Object3D[] = system.preparationVisuals();
  expect(objects.every(object => object.parent === null)).toBe(true);
  expect(system.scene.children).toHaveLength(0);
  const auras = objects.filter((object: any) => object.isInstancedMesh) as THREE.InstancedMesh[];
  expect(auras.map(mesh => mesh.material)).toEqual([system.auras.groundMaterial, system.auras.beamMaterial]);
  expect(auras.map(mesh => mesh.geometry)).toEqual([system.auras.ground.geometry, system.auras.beam.geometry]);
  const roots = objects.filter((object: any) => !object.isInstancedMesh);
  // 다시 부르면 새 껍데기지만 형상 · 재질은 같다.
  const again: THREE.Object3D[] = system.preparationVisuals();
  again.filter((object: any) => !object.isInstancedMesh).forEach((root, i) => {
    expect(root).not.toBe(roots[i]);
    meshesOf(root).forEach((mesh, j) => { expect(mesh.geometry).toBe(meshesOf(roots[i])[j].geometry); expect(mesh.material).toBe(meshesOf(roots[i])[j].material); });
  });
  const prepared = new Set(objects.flatMap(object => (object as any).isInstancedMesh ? [featureKey(object as THREE.Mesh)] : meshesOf(object).map(featureKey)));

  // 모든 장비 × 영웅 문맥의 실제 드랍 모델(병기고 GLB 는 비동기 교체 전 폴백)의 셰이더 성질이 준비 집합 안에 있어야 한다.
  const slots = new Set(), sources = new Set(), catalogue = new Set();
  for (const def of Object.values(ITEM_BY_ID) as any[]) for (const heroId of [null, ...itemFormHeroIds()]) {
    const root = system.lootModels.build({ id: def.id, rarity: def.rarity }, { heroId });
    slots.add(root.userData.lootSlot); sources.add(root.userData.lootSource);
    for (const mesh of meshesOf(root)) {
      const position = mesh.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      expect(Array.from(position.array as ArrayLike<number>).every(Number.isFinite)).toBe(true);
      const key = featureKey(mesh); catalogue.add(key);
      if (!prepared.has(key)) throw new Error(`unprepared drop shader: ${def.id}@${heroId} ${key}`);
    }
  }
  expect([...slots].sort()).toEqual([...SLOTS].sort());
  expect([...sources].sort()).toEqual(['armor-rig', 'fallback', 'forge']);
  expect(catalogue.size).toBeGreaterThanOrEqual(4);
  system.lootModels.dispose();
}));

test('preparation leaves field and reward authority intact and shared resources survive cleanup', () => withSurfaces(() => {
  const system = dropFixture();
  const authority = { items: system.items, loot: system.loot, gold: system.gold, stones: system.stones, stones2: system.stones2, stones3: system.stones3, fragments: system.fragments };
  const originalSpawn = system.spawn;
  for (const method of ['spawn', 'collect', 'onKill']) system[method] = () => { throw new Error(`preparation called ${method}`); };
  const objects: THREE.Object3D[] = system.preparationVisuals();
  for (const [key, value] of Object.entries(authority)) expect(system[key]).toBe(value);
  system.spawn = originalSpawn;

  const resources = new Set<any>();
  for (const object of objects) for (const mesh of meshesOf(object)) { resources.add(mesh.geometry); for (const material of [mesh.material].flat()) resources.add(material); }
  resources.add(system.auras.texture);
  let disposed = 0;
  const onDispose = () => disposed++;
  resources.forEach(resource => resource.addEventListener('dispose', onDispose));
  try {
    system.spawn(new THREE.Vector3(2, 0, 3), 'item', { id: 'w_iron', rarity: 'N' });
    system.spawn(new THREE.Vector3(4, 0, 3), 'item', { id: 'r_ruby', rarity: 'E' });
    const field = system.items.map((it: any) => it.mesh as THREE.Group);
    expect(field.every((root: THREE.Group) => root.parent === system.scene)).toBe(true);
    const shell = (name: string) => objects.find(object => object.name === name)!;
    for (const root of field) meshesOf(root).forEach((mesh, i) => {
      const source = meshesOf(shell(root.name))[i];
      expect(mesh.geometry).toBe(source.geometry); expect(mesh.material).toBe(source.material);
    });
    for (let frame = 0; frame < 90; frame++) system.update(1 / 60);
    expect(system.scene.children).toContain(system.auras.ground);
    system.clear();
    expect(system.items).toHaveLength(0);
    expect(system.scene.children).toHaveLength(0);
    expect(system.auras.used).toBe(0);
    expect(disposed).toBe(0);
    const preparationScene = new THREE.Scene();
    preparationScene.add(...objects);
    preparationScene.clear();
    expect(disposed).toBe(0);
  } finally {
    resources.forEach(resource => resource.removeEventListener('dispose', onDispose));
    system.lootModels.dispose();
  }
}));
