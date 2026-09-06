import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Actor } from '../src/game/actor.js';

test('액터 제거는 복제된 뼈 텍스처만 한 번 해제하고 모델 원본·공유 지오메트리를 보존한다', () => {
  const source = new THREE.Group(), bone = new THREE.Bone(), geo = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.SkinnedMesh(geo, material);
  source.add(bone, mesh); mesh.bind(new THREE.Skeleton([bone])); mesh.skeleton.computeBoneTexture();
  let sourceDisposed = 0, geometryDisposed = 0, instanceDisposed = 0;
  mesh.skeleton.boneTexture!.addEventListener('dispose', () => sourceDisposed++);
  geo.addEventListener('dispose', () => geometryDisposed++);
  const actor = new Actor({ scene: new THREE.Scene() }, { scene: source, animations: [] }, {});
  let owned: THREE.Skeleton | undefined;
  actor.model.traverse((o: THREE.Object3D) => { if (o instanceof THREE.SkinnedMesh) owned = o.skeleton; });
  expect(owned).not.toBe(mesh.skeleton); owned!.computeBoneTexture();
  owned!.boneTexture!.addEventListener('dispose', () => instanceDisposed++);
  actor.dispose(); actor.dispose();
  expect(instanceDisposed).toBe(1); expect(sourceDisposed).toBe(0); expect(geometryDisposed).toBe(0);
  expect(owned!.boneTexture).toBeNull(); expect(actor.root.parent).toBeNull();
  mesh.skeleton.dispose(); geo.dispose(); material.dispose();
});
