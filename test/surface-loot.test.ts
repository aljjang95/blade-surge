import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { createLootVisual } from '../src/game/loot-visual.js';
import { projectSurfaceUV, surfaceRole, applySurfaceDetail, SURFACE_TEXTURES } from '../src/engine/surface-textures.js';
import { mergeSkinned } from '../src/engine/assets.js';

test('all four field equipment slots have distinct readable geometry and share resources per slot', () => {
  const materials = new Map(); const counts = new Set();
  for (const [id,slot] of [['w_iron','weapon'],['a_leather','armor'],['b_worn','boots'],['r_copper','ring']]) {
    // Catalogue IDs are asserted below; typo fallback must not hide a bad test.
    const a = createLootVisual({id,rarity:'N'},materials), b = createLootVisual({id,rarity:'N'},materials);
    expect(a.userData.lootSlot).toBe(slot);
    expect(a.children).toHaveLength(2);
    const m = a.children[0] as THREE.Mesh, n = b.children[0] as THREE.Mesh;
    expect(m.geometry).toBe(n.geometry); expect(m.material).toBe(n.material);
    expect(m.geometry.getAttribute('uv').count).toBe(m.geometry.getAttribute('position').count);
    const size = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
    expect(size.length()).toBeGreaterThan(.5); expect(size.length()).toBeLessThan(2);
    counts.add(m.geometry.getAttribute('position').count);
  }
  expect(counts.size).toBe(4); expect(materials.size).toBe(4);
});

test('bind-pose UV and GUI material maps preserve face/skin colors and texture ownership', () => {
  const geometry = projectSurfaceUV(new THREE.BoxGeometry(1,2,1));
  expect(Array.from(geometry.attributes.uv.array).every(Number.isFinite)).toBe(true);
  expect(surfaceRole('Warm porcelain')).toBe('skin'); expect(surfaceRole('Woven mantle')).toBe('cloth');
  const texture = new THREE.Texture(); SURFACE_TEXTURES['hero-weave'] = texture;
  const cloth = new THREE.MeshStandardMaterial({color:0x337788}); const original = cloth.color.getHex();
  applySurfaceDetail(cloth, 'cloth'); expect(cloth.bumpMap).toBe(texture); expect(cloth.map).toBe(texture);
  expect(cloth.roughnessMap).toBeNull();
  expect(cloth.color.getHex()).toBe(original);
  const skin = new THREE.MeshStandardMaterial(); applySurfaceDetail(skin,'skin'); expect(skin.bumpMap).toBeNull();
  let disposed = false; texture.addEventListener('dispose',()=>{disposed=true;}); cloth.dispose(); expect(disposed).toBe(false);
  delete SURFACE_TEXTURES['hero-weave']; geometry.dispose(); skin.dispose(); texture.dispose();
});

test('mixed imported UV/tangent layouts are never sent to an incompatible skin merge', () => {
  const scene = new THREE.Group(), bone = new THREE.Bone(); scene.add(bone);
  const skeleton = new THREE.Skeleton([bone]), material = new THREE.MeshStandardMaterial();
  for (let i=0;i<3;i++) {
    const geometry = new THREE.BoxGeometry();
    if(i===2) geometry.deleteAttribute('uv');
    const mesh = new THREE.SkinnedMesh(geometry,material); mesh.name=`Part_${i}`;
    mesh.bind(skeleton); scene.add(mesh);
  }
  mergeSkinned(scene);
  const meshes = scene.children.filter(o=>o instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh[];
  expect(meshes).toHaveLength(2);
  expect(meshes.map(m=>m.geometry.attributes.position.count).sort((a,b)=>a-b)).toEqual([24,48]);
  for(const mesh of meshes) mesh.geometry.dispose(); material.dispose(); skeleton.dispose();
});
