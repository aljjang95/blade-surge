import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Arena } from '../src/game/arena.js';
import { VFX_TEX } from '../src/engine/assets.js';
const textures = VFX_TEX as Record<string, THREE.Texture | undefined>;

for (const exit of ['open', 'clear', 'replace']) {
  test(`결계 ${exit}: 전용 geometry/material만 회수하고 공유 텍스처를 보존한다`, () => {
    const scene = new THREE.Scene(), arena = new Arena(scene, { scene: new THREE.Group() }, {});
    const previous = textures.circle_demon, texture = new THREE.Texture(); textures.circle_demon = texture;
    let textureDisposed = false, geometries = 0, materials = 0;
    texture.addEventListener('dispose', () => { textureDisposed = true; });
    try {
      arena.buildSeals({ sealed: true, gates: [{ x: 0, z: 1, axis: 'x' }, { x: 3, z: 2, axis: 'z' }] });
      for (const seal of arena.seals) seal.traverse((o: THREE.Object3D) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.addEventListener('dispose', () => geometries++);
        (o.material as THREE.Material).addEventListener('dispose', () => materials++);
      });
      if (exit === 'open') arena.openSeal(null);
      else if (exit === 'replace') arena.buildSeals({ sealed: false });
      else arena.clear();
      expect(geometries).toBe(6); expect(materials).toBe(6); expect(textureDisposed).toBe(false);
      expect(arena.seals.length).toBe(0); arena.clear(); expect(geometries).toBe(6);
    } finally { if (previous) textures.circle_demon = previous; else delete textures.circle_demon; texture.dispose(); }
  });
}

test('장면 전환은 소유 조명의 shadow target을 한 번 회수한다', () => {
  const scene = new THREE.Scene(), arena = new Arena(scene, { scene: new THREE.Group() }, {});
  const light = new THREE.DirectionalLight(); light.shadow.map = new THREE.WebGLRenderTarget(16, 16);
  let disposed = 0; light.shadow.map.addEventListener('dispose', () => disposed++);
  scene.add(light); arena.lights.push(light); arena.clear(); arena.clear();
  expect(disposed).toBe(1); expect(scene.children.includes(light)).toBe(false);
});
