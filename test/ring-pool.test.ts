import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { RingPool } from '../src/engine/ring-pool.js';

test('overlapping rings keep independent colour, elapsed-time fade and fixed world positions in one node', () => {
  const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2, 2), texture = new THREE.Texture();
  const pool = new RingPool(scene, plane, texture, 8), camera = new THREE.PerspectiveCamera();
  try {
    pool.emit(new THREE.Vector3(2, 0, 3), 0xff0000, { r0: 1, r1: 3, life: 1 }, camera);
    pool.emit(new THREE.Vector3(-5, 0, 8), 0x00ff00, { r0: 2, r1: 4, life: 2 }, camera);
    pool.update(.5);
    (scene.onBeforeRender as any)();
    expect(scene.children).toEqual([pool.mesh]); expect(pool.mesh.count).toBe(2);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    pool.mesh.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
    expect(position.x).toBe(2); expect(position.z).toBe(3); expect(position.y).toBeCloseTo(.08, 6); expect(scale.x).toBeCloseTo(2.75);
    expect(pool.alpha.getX(0)).toBeCloseTo(.6); expect(pool.alpha.getX(1)).toBeCloseTo(.9);
    const c = new THREE.Color(); pool.mesh.getColorAt(0, c); expect(c.getHex()).toBe(0xff0000);
    pool.mesh.getColorAt(1, c); expect(c.getHex()).toBe(0x00ff00);
    expect(plane.getAttribute('ringAlpha')).toBeUndefined();
    pool.update(.6); (scene.onBeforeRender as any)(); expect(pool.mesh.count).toBe(1); pool.mesh.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
    expect(position.x).toBe(-5); expect(position.z).toBe(8); pool.mesh.getColorAt(0, c); expect(c.getHex()).toBe(0x00ff00);
    pool.clear(); pool.clear(); expect(pool.mesh.count).toBe(0); expect(pool.mesh.visible).toBe(false);
    pool.emit(new THREE.Vector3(), 0xffffff, {}, camera); expect(pool.mesh.count).toBe(1);
    pool.update(1); expect(pool.mesh.visible).toBe(false);
  } finally { pool.dispose(); plane.dispose(); texture.dispose(); }
});

test('ring clocks agree at 30/60/120Hz and vertical orientation remains the cast orientation', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(3, 5, 8);
  for (const hz of [30, 60, 120]) {
    const plane = new THREE.PlaneGeometry(2, 2), texture = new THREE.Texture(), pool = new RingPool(new THREE.Scene(), plane, texture);
    try {
      pool.emit(new THREE.Vector3(1, 0, 2), 0x90ffff, { r0: 1, r1: 5, life: 2, vertical: true }, camera);
      const orientation = pool.items[0].rotation.clone(); camera.position.x += 1;
      for (let i = 0; i < hz; i++) pool.update(1 / hz);
      (pool.scene.onBeforeRender as any)();
      expect(pool.items[0].age).toBeCloseTo(1, 7); expect(pool.alpha.getX(0)).toBeCloseTo(.6, 6);
      expect(pool.items[0].rotation.equals(orientation)).toBe(true);
      const size = new THREE.Vector3().setFromMatrixScale(pool.mesh.instanceMatrix.array.length ? new THREE.Matrix4().fromArray(pool.mesh.instanceMatrix.array) : new THREE.Matrix4());
      expect(size.x).toBeCloseTo(4.5, 6);
    } finally { pool.dispose(); plane.dispose(); texture.dispose(); }
  }
});

test('ring saturation has a fixed budget and disposal leaves shared assets alive', () => {
  const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2, 2), texture = new THREE.Texture();
  const pool = new RingPool(scene, plane, texture, 8), camera = new THREE.PerspectiveCamera();
  let planeDisposed = 0, textureDisposed = 0, instanceDisposed = 0, ownedDisposed = 0;
  plane.addEventListener('dispose', () => planeDisposed++); texture.addEventListener('dispose', () => textureDisposed++);
  pool.mesh.addEventListener('dispose', () => instanceDisposed++); pool.geometry.addEventListener('dispose', () => ownedDisposed++);
  for (let i = 0; i < 500; i++) pool.emit(new THREE.Vector3(i, 0, 0), 0xffffff, {}, camera);
  (scene.onBeforeRender as any)();
  expect(pool.items).toHaveLength(8); expect(scene.children).toHaveLength(1); expect(pool.items[0].position.x).toBe(492);
  expect(pool.mesh.instanceMatrix.array.every(Number.isFinite)).toBe(true);
  pool.dispose(); pool.dispose(); expect(scene.children).toHaveLength(0);
  expect(instanceDisposed).toBe(1); expect(ownedDisposed).toBe(1); expect(planeDisposed).toBe(0); expect(textureDisposed).toBe(0);
  pool.emit(new THREE.Vector3(), 0xffffff, {}, camera); expect(pool.mesh.count).toBe(0);
  plane.dispose(); texture.dispose();
});

test('화면을 그리지 않은 스텝은 GPU 전송을 만들지 않고 다음 장면에서 최신 상태를 한 번 반영한다', () => {
  const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2, 2), texture = new THREE.Texture();
  let previousCalls = 0;
  const previous = scene.onBeforeRender = () => { previousCalls++; };
  const pool = new RingPool(scene, plane, texture), camera = new THREE.PerspectiveCamera();
  try {
    const version = pool.alpha.version;
    pool.emit(new THREE.Vector3(), 0xffffff, { life: 2 }, camera);
    for (let i = 0; i < 60; i++) pool.update(1 / 60);
    expect(pool.alpha.version).toBe(version);
    (scene.onBeforeRender as any)();
    expect(pool.alpha.version).toBe(version + 1); expect(pool.alpha.getX(0)).toBeCloseTo(.6);
    expect(pool.alpha.updateRanges).toEqual([{ start: 0, count: 1 }]);
    const range = pool.alpha.updateRanges[0];
    (scene.onBeforeRender as any)(); expect(pool.alpha.version).toBe(version + 1);
    pool.update(.1); (scene.onBeforeRender as any)();
    expect(pool.alpha.version).toBe(version + 2); expect(pool.alpha.updateRanges[0]).toBe(range);
    expect(previousCalls).toBe(3);
  } finally { pool.dispose(); plane.dispose(); texture.dispose(); }
  expect(scene.onBeforeRender).toBe(previous);
});
