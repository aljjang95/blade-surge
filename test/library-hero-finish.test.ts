import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { fitLibrarySocket, normalizeLibrarySkinMaterial, prepareModel, LIBRARY_SKIN_METALNESS_MAX } from '../src/engine/assets.js';

// 라이브러리 영웅 외형 보정 — 금속도·반투명과 손 소켓 정렬을 고정한다.
test('Tripo 몸체 재질은 금속도를 낮추고 불투명으로 그린다(지도는 유지)', () => {
  const map = new THREE.Texture(), metalnessMap = new THREE.Texture();
  const m = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 1, transparent: true, opacity: 1, map, metalnessMap });
  normalizeLibrarySkinMaterial(m);
  expect(m.metalness).toBe(LIBRARY_SKIN_METALNESS_MAX);
  expect(m.transparent).toBe(false);
  expect(m.depthWrite).toBe(true);
  expect(m.alphaTest).toBeGreaterThanOrEqual(.5);
  expect(m.map).toBe(map); expect(m.metalnessMap).toBe(metalnessMap);
  // 두 번 적용해도 값이 바뀌지 않는다.
  m.metalness = .1; normalizeLibrarySkinMaterial(m); expect(m.metalness).toBe(.1);
  // 실제로 반투명인 재질(opacity<1)은 건드리지 않는다.
  const glass = normalizeLibrarySkinMaterial(new THREE.MeshStandardMaterial({ transparent: true, opacity: .5 }));
  expect(glass.transparent).toBe(true);
});

test('라이브러리 몬스터·동행 몸체도 영웅과 같은 마감을 받는다(불투명 BLEND → 깊이 쓰기, 납작한 단색 실루엣 방지)', () => {
  const skinned = (material: THREE.Material) => {
    const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
    const scene = new THREE.Group(); scene.add(mesh); return { scene, mesh };
  };
  // GLTFLoader 가 alphaMode BLEND 를 읽은 상태(skeleton_mage·bone_knight·demon_lord·frost_yeti·goblin_brute)
  const blend = () => new THREE.MeshPhysicalMaterial({ metalness: 1, transparent: true, opacity: 1, depthWrite: false });
  const lib = skinned(blend()); lib.scene.userData.libraryAsset = { id: 'skeleton_mage' }; lib.mesh.material.userData.tllAuthored = true;   // 라이브러리 로더가 표시한다
  prepareModel({ scene: lib.scene, animations: [] } as any);
  const m = lib.mesh.material as THREE.MeshPhysicalMaterial;
  expect({ transparent: m.transparent, depthWrite: m.depthWrite, alphaTest: m.alphaTest, metalness: m.metalness })
    .toEqual({ transparent: false, depthWrite: true, alphaTest: .5, metalness: LIBRARY_SKIN_METALNESS_MAX });
  // 라이브러리가 아닌 모델은 이 마감을 받지 않는다.
  const legacy = skinned(blend());
  prepareModel({ scene: legacy.scene, animations: [] } as any);
  expect((legacy.mesh.material as THREE.Material).transparent).toBe(true);
});

test('손 소켓은 손 본 축과 무관하게 KayKit handslot 과 같은 월드 방향·키 비율 위치에 놓인다', () => {
  // KayKit: 손 본(축 정렬) 아래 handslot 이 Z+90° 회전, 손가락 쪽 0.096·손바닥 쪽 0.0575.
  const legacy = new THREE.Group(), hand = new THREE.Object3D(), slot = new THREE.Object3D();
  hand.position.set(.5, 1, 0); slot.position.set(0, .096, -.0575); slot.rotation.set(0, 0, Math.PI / 2);
  legacy.add(hand); hand.add(slot); legacy.updateMatrixWorld(true);
  // 라이브러리: 손 본이 임의로 돌아가 있고 키는 2배.
  const lib = new THREE.Group(), bone = new THREE.Bone();
  bone.position.set(1, 2, 0); bone.rotation.set(.7, -1.1, .4); lib.add(bone); lib.updateMatrixWorld(true);
  const socket = new THREE.Group(); bone.add(socket);
  fitLibrarySocket(socket, bone, slot, hand, 2);
  lib.updateMatrixWorld(true);
  const want = slot.getWorldQuaternion(new THREE.Quaternion()), got = socket.getWorldQuaternion(new THREE.Quaternion());
  expect(Math.abs(want.dot(got))).toBeCloseTo(1, 6);
  const offset = socket.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
  expect(offset.x).toBeCloseTo(0, 6); expect(offset.y).toBeCloseTo(.192, 6); expect(offset.z).toBeCloseTo(-.115, 6);
});

