import { expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildEnvironmentInstances } from '../src/engine/environment-kit-asset.js';
import { buildCitadelHubScene } from '../src/game/citadel-hub-scene.js';
import { CanopySightline } from '../src/engine/canopy-sightline.js';

test('authored courtyard trees instance at the ground pivot and preserve shared source buffers on disposal', async () => {
  const bytes = await Bun.file('public/models/environment/studio-kit/broadleaf-tree.glb').arrayBuffer();
  const source = (await new GLTFLoader().parseAsync(bytes, '')).scene;
  const templates = new Map([['broadleaf-tree', source]]);
  let sourceDisposed = 0, materialsDisposed = 0, buffersDisposed = 0;
  source.traverse((node: any) => {
    if (!node.isMesh) return;
    node.geometry.addEventListener('dispose', () => sourceDisposed++);
  });
  const root = buildEnvironmentInstances([
    { asset: 'broadleaf-tree', x: -6, y: .47, z: -4.8, scale: .57 },
    { asset: 'broadleaf-tree', x: 6, y: .47, z: -4.8, scale: .57 },
  ], { assets: templates });
  expect(root.userData.instanceCount).toBe(2);
  expect(root.userData.batchCount).toBe(1);
  const tree = root.children[0] as THREE.InstancedMesh;
  expect(tree.count).toBe(2);
  const bounds = new THREE.Box3().setFromObject(root);
  expect(bounds.min.y).toBeCloseTo(.47, 2);
  expect(bounds.max.y).toBeLessThan(4.5);
  expect(bounds.max.y).toBeGreaterThan(4);
  tree.addEventListener('dispose', () => buffersDisposed++);
  (tree.material as THREE.Material).addEventListener('dispose', () => materialsDisposed++);
  root.userData.dispose(); root.userData.dispose();
  expect(buffersDisposed).toBe(1);
  expect(materialsDisposed).toBe(1);
  expect(sourceDisposed).toBe(0);
  const next = buildEnvironmentInstances([{ asset: 'broadleaf-tree', x: 0, z: 0 }], { assets: templates });
  expect(next.userData.instanceCount).toBe(1);
  expect((next.children[0] as THREE.Mesh).geometry).toBe(tree.geometry);
  next.userData.dispose();
});

test('missing optional environment sources keep a disposable empty group', () => {
  const root = buildEnvironmentInstances([{ asset: 'broadleaf-tree', x: 0, z: 0 }], { assets: new Map() });
  expect(root.children).toHaveLength(0);
  expect(root.userData.instanceCount).toBe(0);
  root.userData.dispose(); root.userData.dispose();
});

test('plaza fallback still builds every static garden batch when authored assets are unavailable', () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const root = buildCitadelHubScene({ assets: new Map() });
    expect(errors).not.toHaveBeenCalled();
    root.traverse((node: any) => {
      if (node.isMesh) expect(node.geometry?.attributes.position.count).toBeGreaterThan(0);
    });
    root.userData.dispose(); root.userData.dispose();
  } finally { errors.mockRestore(); }
});

test('courtyard cutaway clears only the foreground crown corridor and reuses planes', () => {
  const sightline = new CanopySightline(), planes = [...sightline.planes];
  const clipped = (point: THREE.Vector3) => sightline.planes.every(plane => plane.distanceToPoint(point) < 0);
  sightline.setTarget(new THREE.Vector3(-6.075, 0, -6.228));
  sightline.update(new THREE.Vector3(-6.075, 9.7, 6.1));
  expect(clipped(new THREE.Vector3(-6, 3, -4.8))).toBe(true);
  expect(clipped(new THREE.Vector3(-6, 1.5, -4.8))).toBe(false);
  expect(clipped(new THREE.Vector3(6, 3, -4.8))).toBe(false);
  expect(clipped(new THREE.Vector3(-6, 3, -8))).toBe(false);
  sightline.setTarget(new THREE.Vector3(0, 0, 3.6));
  sightline.update(new THREE.Vector3(0, 9.7, 15.9));
  expect(clipped(new THREE.Vector3(-6, 3, -4.8))).toBe(false);
  expect(sightline.planes.every((plane, index) => plane === planes[index])).toBe(true);
  sightline.reset();
  expect(clipped(new THREE.Vector3(0, 3, 10))).toBe(false);
});
