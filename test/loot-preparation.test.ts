import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { DropSystem } from '../src/game/drops.js';
import { createLootVisual } from '../src/game/loot-visual.js';
import { ITEM_BY_ID, RARITY_COLOR, SLOTS } from '../src/data/items.js';
import { SURFACE_TEXTURES } from '../src/engine/surface-textures.js';

function withSurfaces(run: (cloth: THREE.DataTexture, metal: THREE.DataTexture) => void) {
  const keys = ['hero-weave', 'forged-metal'];
  const saved = keys.map(key => SURFACE_TEXTURES[key]);
  const textures = keys.map(() => new THREE.DataTexture(new Uint8Array([128,128,128,255]), 1, 1, THREE.RGBAFormat));
  textures.forEach((texture, i) => { texture.needsUpdate = true; SURFACE_TEXTURES[keys[i]] = texture; });
  try { run(textures[0], textures[1]); }
  finally {
    keys.forEach((key, i) => { if (saved[i]) SURFACE_TEXTURES[key] = saved[i]; else delete SURFACE_TEXTURES[key]; });
    textures.forEach(texture => texture.dispose());
  }
}

function featureKey(mesh: THREE.Mesh) {
  const material = mesh.material as THREE.MeshStandardMaterial;
  return JSON.stringify({
    map: !!material.map, bump: !!material.bumpMap, roughness: !!material.roughnessMap,
    normal: !!material.normalMap, metalness: !!material.metalnessMap, emissive: !!material.emissiveMap,
    alpha: !!material.alphaMap, transparent: material.transparent, vertexColors: material.vertexColors,
    attributes: Object.keys(mesh.geometry.attributes).sort(), morph: Object.keys(mesh.geometry.morphAttributes).sort(),
    skinned: !!(mesh as THREE.SkinnedMesh).isSkinnedMesh, instanced: !!(mesh as THREE.InstancedMesh).isInstancedMesh,
  });
}

function dropFixture() {
  const scene = new THREE.Scene();
  const system: any = Object.create(DropSystem.prototype);
  Object.assign(system, {
    game: { scene, stage: {}, rollDrop: () => { throw new Error('preparation rolled a reward'); } }, scene,
    items: [], gold: 19, stones: 3, stones2: 2, stones3: 1, fragments: 7, loot: [{ id: 'r_copper', rarity: 'N' }],
    _lootMaterials: new Map(), _preparationVisuals: null,
  });
  return system;
}

test('two detached preparation templates cover every catalogue slot and summon shader feature class', () => withSurfaces((cloth, metal) => {
  const system = dropFixture();
  const roots: THREE.Group[] = system.preparationVisuals();
  expect(roots).toHaveLength(2);
  expect(roots.map(root => root.name)).toEqual(['loot-boots-b_cloth', 'loot-weapon-w_iron']);
  expect(roots.flatMap(root => root.children)).toHaveLength(4);
  expect(roots.every(root => root.parent === null)).toBe(true);
  expect(system.scene.children).toHaveLength(0);
  expect(system._lootMaterials.size).toBe(2);
  const another: THREE.Group[] = system.preparationVisuals();
  expect(another).not.toBe(roots);
  another.forEach((root, i) => {
    expect(root).not.toBe(roots[i]);
    expect(root.parent).toBeNull();
    root.children.forEach((child, j) => {
      expect(child).not.toBe(roots[i].children[j]);
      expect((child as THREE.Mesh).geometry).toBe((roots[i].children[j] as THREE.Mesh).geometry);
      expect((child as THREE.Mesh).material).toBe((roots[i].children[j] as THREE.Mesh).material);
    });
  });
  expect(system._lootMaterials.size).toBe(2);
  const preparationFeatures = new Set(roots.flatMap(root => root.children.map(mesh => featureKey(mesh as THREE.Mesh))));
  expect(preparationFeatures.size).toBe(2);

  const catalogueMaterials = new Map();
  const slots = new Set(), summonShapes = new Set(), catalogueFeatures = new Set();
  for (const def of Object.values(ITEM_BY_ID) as any[]) {
    const root = createLootVisual(def, catalogueMaterials);
    expect(root.userData.lootSlot).toBe(def.slot);
    expect(root.children).toHaveLength(2);
    slots.add(def.slot);
    if (def.summonShape) summonShapes.add(def.summonShape);
    for (const [index, child] of root.children.entries()) {
      const mesh = child as THREE.Mesh, material = mesh.material as THREE.MeshStandardMaterial;
      const isCloth = index === 0 && def.slot === 'boots';
      expect(material.map).toBe(isCloth ? cloth : metal);
      expect(material.bumpMap).toBe(isCloth ? cloth : metal);
      expect(material.roughnessMap).toBe(isCloth ? null : metal);
      expect(material.bumpScale).toBe(isCloth ? .028 : .018);
      expect(material.roughness).toBe(index === 1 ? .46 : isCloth ? .88 : .55);
      expect(material.metalness).toBe(isCloth ? 0 : .35);
      expect(material.color.getHex()).toBe(new THREE.Color(index === 1 ? RARITY_COLOR[def.rarity as keyof typeof RARITY_COLOR] : isCloth ? 0x80654b : 0xd6e3e9).getHex());
      const position = mesh.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      for (const attribute of ['normal', 'uv']) {
        const data = mesh.geometry.getAttribute(attribute);
        expect(data.count).toBe(position.count);
        expect(Array.from(data.array).every(Number.isFinite)).toBe(true);
      }
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.isEmpty()).toBe(false);
      const features = featureKey(mesh);
      expect(preparationFeatures.has(features)).toBe(true);
      catalogueFeatures.add(features);
    }
  }
  expect([...slots].sort()).toEqual([...SLOTS].sort());
  expect([...summonShapes].sort()).toEqual(['aegis', 'grimoire', 'lantern', 'prism', 'treads']);
  expect(catalogueFeatures).toEqual(preparationFeatures);
  for (const materials of catalogueMaterials.values()) for (const material of materials) material.dispose();
}));

test('preparation leaves field and reward authority intact and shared resources survive cleanup', () => withSurfaces(() => {
  const system = dropFixture();
  const authority = { items: system.items, loot: system.loot, gold: system.gold, stones: system.stones, stones2: system.stones2, stones3: system.stones3, fragments: system.fragments };
  const originalSpawn = system.spawn;
  for (const method of ['spawn', 'collect', 'onKill']) system[method] = () => { throw new Error(`preparation called ${method}`); };
  const roots: THREE.Group[] = system.preparationVisuals();
  for (const [key, value] of Object.entries(authority)) expect(system[key]).toBe(value);
  system.spawn = originalSpawn;

  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const root of roots) for (const child of root.children) {
    const mesh = child as THREE.Mesh;
    resources.add(mesh.geometry); resources.add(mesh.material as THREE.Material);
  }
  let disposed = 0;
  const onDispose = () => disposed++;
  resources.forEach(resource => resource.addEventListener('dispose', onDispose));
  try {
    system.spawn(new THREE.Vector3(2, 0, 3), 'item', { id: 'b_cloth', rarity: 'N' });
    const field = system.items[0].mesh as THREE.Group;
    expect(field.parent).toBe(system.scene);
    expect(field.children).toHaveLength(2);
    field.children.forEach((child, i) => {
      expect((child as THREE.Mesh).geometry).toBe((roots[0].children[i] as THREE.Mesh).geometry);
      expect((child as THREE.Mesh).material).toBe((roots[0].children[i] as THREE.Mesh).material);
    });
    system.clear();
    expect(system.items).toHaveLength(0);
    expect(system.scene.children).toHaveLength(0);
    expect(disposed).toBe(0);
    const preparationScene = new THREE.Scene();
    preparationScene.add(...roots);
    const secondRoots: THREE.Group[] = system.preparationVisuals();
    expect(secondRoots).not.toBe(roots);
    secondRoots.forEach((root, i) => {
      expect(root).not.toBe(roots[i]);
      expect(root.parent).toBeNull();
      expect(roots[i].parent).toBe(preparationScene);
      root.children.forEach((child, j) => {
        expect((child as THREE.Mesh).geometry).toBe((roots[i].children[j] as THREE.Mesh).geometry);
        expect((child as THREE.Mesh).material).toBe((roots[i].children[j] as THREE.Mesh).material);
      });
    });
    const secondScene = new THREE.Scene();
    secondScene.add(...secondRoots);
    preparationScene.clear();
    expect(roots.every(root => root.parent === null)).toBe(true);
    expect(secondRoots.every(root => root.parent === secondScene)).toBe(true);
    secondScene.clear();
    expect(secondRoots.every(root => root.parent === null)).toBe(true);
    expect(disposed).toBe(0);
    expect(system._lootMaterials.size).toBe(2);
    for (const root of roots) for (const child of root.children) expect((child as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0);
  } finally {
    resources.forEach(resource => resource.removeEventListener('dispose', onDispose));
    for (const materials of system._lootMaterials.values()) for (const material of materials) material.dispose();
  }
}));
