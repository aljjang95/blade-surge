import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { BattleOcclusion } from '../src/engine/battle-occlusion.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';
import { Arena } from '../src/game/arena.js';
import { Floor } from '../src/game/world.js';

const clipped = (cut: BattleOcclusion, point: THREE.Vector3) => cut.planes.every(p => p.distanceToPoint(point) < 0);

test('cutaway preserves rear architecture and ground for every camera yaw/pitch/zoom boundary', () => {
  const cut = new BattleOcclusion(), player = new THREE.Vector3(93, 0, -61);
  cut.setTarget(player);
  for (const yaw of [0, -90, 90, 180]) for (const pitch of [-18, 20]) for (const zoom of [70, 140]) {
    const off = battleCameraOffset({ x: 0, y: 8.2, z: 7.4 }, { yaw, pitch, zoom });
    const camera = new THREE.Vector3(off.x, off.y, off.z).add(player);
    cut.update(camera);
    const toward = new THREE.Vector3(off.x, 0, off.z).normalize();
    expect(clipped(cut, player.clone().addScaledVector(toward, 2).setY(2))).toBe(true);
    expect(clipped(cut, player.clone().addScaledVector(toward, -2).setY(2))).toBe(false);
    expect(clipped(cut, player.clone().addScaledVector(toward, 2).setY(.2))).toBe(false);
    expect(clipped(cut, player.clone().addScaledVector(toward, -.5).setY(1))).toBe(true);
  }
});

test('actual copied hero position controls clipping despite camera follow lag; lobby/reset disables it', () => {
  const cut = new BattleOcclusion(), player = new THREE.Vector3(0, 0, 20);
  cut.setTarget(player); player.z = 500;
  const camera = new THREE.Vector3(0, 8, 12);
  cut.update(camera);
  expect(clipped(cut, new THREE.Vector3(0, 2, 18))).toBe(true);
  expect(clipped(cut, new THREE.Vector3(0, 2, 22))).toBe(false);
  cut.update(camera, false);
  expect(clipped(cut, new THREE.Vector3(0, 2, 18))).toBe(false);
  cut.update(camera);
  expect(clipped(cut, new THREE.Vector3(0, 2, 18))).toBe(true);
  cut.reset(); cut.reset(); cut.update(camera);
  expect(clipped(cut, new THREE.Vector3(0, 2, 18))).toBe(false);
  cut.setTarget(new THREE.Vector3(NaN, 0, 1)); cut.update(camera);
  expect(cut.hasTarget).toBe(false);
  cut.setTarget(new THREE.Vector3(0, 0, 12)); cut.update(camera);
  expect(cut.planes.every(p => Number.isFinite(p.constant))).toBe(true);
  expect(clipped(cut, new THREE.Vector3(0, 2, 12))).toBe(false);
});

test('all wall chunks share clipping without cloning source assets or touching floor material', () => {
  const scene = new THREE.Scene(), source = new THREE.Group();
  const geometry = new THREE.BoxGeometry(4, 4, .4), material = new THREE.MeshStandardMaterial();
  const wall = new THREE.Mesh(geometry, material); wall.name = 'wall'; source.add(wall);
  const floor = new THREE.Mesh(geometry, material); floor.name = 'floor'; source.add(floor);
  const arena = new Arena(scene, { scene: source }, {});
  const points = [{ x: 0, z: 0 }, { x: 100, z: 100 }, { x: -100, z: 0 }];
  arena.instanced('wall', points, undefined, { cutaway: true });
  arena.instanced('floor', points, undefined, { castShadow: false });
  const meshes = arena.group.children as THREE.InstancedMesh[];
  expect(meshes.length).toBe(6); expect(arena.ownedMaterials.size).toBe(2);
  for (const mesh of meshes.slice(0, 3)) {
    const mat = mesh.material as THREE.Material;
    expect(mat.clippingPlanes).toBe(arena.occlusion.planes);
    expect(mat.clipIntersection).toBe(true);
    expect(mat.transparent).toBe(false); expect(mat.opacity).toBe(1);
    expect(mesh.geometry).toBe(geometry);
  }
  for (const mesh of meshes.slice(3)) expect((mesh.material as THREE.Material).clippingPlanes).toBeNull();
  expect(material.clippingPlanes).toBeNull();
  let disposed = 0, sourceDisposed = 0;
  for (const mat of arena.ownedMaterials) mat.addEventListener('dispose', () => disposed++);
  material.addEventListener('dispose', () => sourceDisposed++);
  geometry.addEventListener('dispose', () => sourceDisposed++);
  arena.clear(); arena.clear();
  expect(disposed).toBe(2); expect(sourceDisposed).toBe(0);
  geometry.dispose(); material.dispose();
});

test('real floor architecture uses existing batches and collision mask; rebuild resets target', () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x111111);
  const arena = new Arena(scene, { scene: new THREE.Group() }, {});
  const floor = new Floor(3, 'garden'), mask = Array.from(floor.mask!);
  arena.buildFloor(floor, 'garden');
  expect(arena.regionArchitecture!.children.length).toBeLessThanOrEqual(floor.rooms.length * 3);
  arena.regionArchitecture!.traverse((node: THREE.Object3D) => {
    if (node instanceof THREE.Mesh) expect((node.material as THREE.Material).clippingPlanes).toBe(arena.occlusion.planes);
  });
  for (const seal of arena.seals) expect(seal.material.clippingPlanes).toBeNull();
  const pos = new THREE.Vector3(floor.startRoom.x, 0, floor.startRoom.z);
  arena.update(0, null, pos); expect(arena.occlusion.hasTarget).toBe(true);
  expect(Array.from(floor.mask!)).toEqual(mask);
  arena.buildFloor(floor, 'garden'); expect(arena.occlusion.hasTarget).toBe(false);
  arena.clear(); expect(arena.occlusion.hasTarget).toBe(false);
});
