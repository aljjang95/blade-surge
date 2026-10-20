import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { BattleOcclusion, PlaneCutaway, SIGHTLINE } from '../src/engine/battle-occlusion.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';
import { CAMERA_PRESETS } from '../src/engine/renderer.js';
import { Arena } from '../src/game/arena.js';
import { Floor } from '../src/game/world.js';

const cameraFor = (player: THREE.Vector3, view: { yaw: number, pitch: number, zoom: number }, preset = CAMERA_PRESETS.top) => {
  const off = battleCameraOffset({ x: 0, y: preset.y, z: preset.z }, view);
  return new THREE.Vector3(off.x, off.y, off.z).add(player);
};

test('시선 원뿔은 영웅 앞 벽만 비우고 뒤 벽·바닥 경계·같은 깊이의 먼 옆벽은 원래 높이로 남긴다', () => {
  const sight = new BattleOcclusion(), player = new THREE.Vector3(93, 0, -61);
  sight.setTarget(player);
  for (const yaw of [0, -90, 90, 180, 37]) for (const pitch of [-18, 0, 20]) for (const zoom of [70, 100, 140]) {
    const camera = cameraFor(player, { yaw, pitch, zoom });
    sight.update(camera);
    const toward = new THREE.Vector3(camera.x - player.x, 0, camera.z - player.z).normalize();
    const side = new THREE.Vector3(-toward.z, 0, toward.x);
    // 영웅과 카메라 사이, 몸통~벽 윗부분 높이의 벽 조각은 거의 다 비운다.
    const front = player.clone().addScaledVector(toward, 1.6).setY(2.4);
    expect(sight.fadeAt(front)).toBeGreaterThan(SIGHTLINE.maxFade * .6);
    // 영웅 뒤쪽 벽, 바닥 경계(0.3m), 같은 깊이에서 화면 옆으로 9m 떨어진 벽은 그대로.
    expect(sight.fadeAt(player.clone().addScaledVector(toward, -2).setY(2.5))).toBe(0);
    expect(sight.fadeAt(player.clone().addScaledVector(toward, 1.6).setY(.3))).toBe(0);
    expect(sight.fadeAt(player.clone().addScaledVector(toward, 1.6).addScaledVector(side, 9).setY(2.4))).toBe(0);
    expect(sight.fadeAt(player.clone().addScaledVector(toward, 1.6).addScaledVector(side, -9).setY(2.4))).toBe(0);
  }
});

test('이전 평면 절단과 달리 영웅이 10cm씩 움직여도 벽 조각의 비움 정도가 연속으로 변한다(튐 없음)', () => {
  const sight = new BattleOcclusion(), plane = new PlaneCutaway();
  // 방의 동쪽 옆벽(z축 방향). 기존 평면은 영웅 깊이에서 이 벽을 가로로 잘라 단면이 걸음마다 미끄러졌다.
  const wall: THREE.Vector3[] = [];
  for (let z = -8; z <= 8; z += .5) for (const y of [.6, 1.5, 2.5, 3.5]) wall.push(new THREE.Vector3(6, y, z));
  let maxStep = 0, planeFlips = 0, prev: number[] | null = null, prevPlane: boolean[] | null = null;
  for (let z = -2; z <= 3.5; z += .1) {
    const player = new THREE.Vector3(1.3, 0, z), camera = cameraFor(player, { yaw: 0, pitch: 0, zoom: 100 });
    sight.setTarget(player); sight.update(camera); plane.setTarget(player); plane.update(camera);
    const fades = wall.map(p => sight.fadeAt(p));
    const cut = wall.map(p => plane.planes.every(pl => pl.distanceToPoint(p) < 0));
    if (prev) fades.forEach((f, i) => { maxStep = Math.max(maxStep, Math.abs(f - prev![i])); });
    if (prevPlane) cut.forEach((c, i) => { if (c !== prevPlane![i]) planeFlips++; });
    prev = fades; prevPlane = cut;
  }
  expect(maxStep).toBeLessThan(.25);
  // 근거 기록: 기존 평면은 같은 걸음 동안 옆벽 조각을 통째로 잘랐다 되살렸다(이진 전환).
  expect(planeFlips).toBeGreaterThan(30);
});

test('영웅을 덮는 바로 앞 벽은 바로 비우고, 옆벽을 따라 달릴 때(0.1초=0.7m) 비움 변화는 절반 미만이다', () => {
  const sight = new BattleOcclusion();
  // 남쪽 벽에 붙어 선 영웅: 벽 중심선은 몸 반경+벽 반두께 1.05m 앞.
  const hero = new THREE.Vector3(0, 0, 0); sight.setTarget(hero); sight.update(cameraFor(hero, { yaw: 0, pitch: 0, zoom: 100 }));
  expect(sight.fadeAt(new THREE.Vector3(0, 2.2, 1.05))).toBeGreaterThan(.85);
  // 동쪽 옆벽(영웅에서 1.5m) 표본을 영웅이 북쪽으로 0.7m씩 지나간다. 영웅 앞뒤 3m 안의 표본만 본다
  // (카메라 바로 앞 조각은 시차로 화면에서 빠르게 움직이므로 비움도 그만큼 빨리 바뀐다).
  const wall: THREE.Vector3[] = [];
  for (let z = -10; z <= 10; z += .5) for (const y of [1.5, 2.5, 3.5]) wall.push(new THREE.Vector3(1.5, y, z));
  let worst = 0, prev: number[] | null = null, prevZ = 0;
  for (let z = 6; z >= -6; z -= .7) {
    const p = new THREE.Vector3(0, 0, z); sight.setTarget(p); sight.update(cameraFor(p, { yaw: 0, pitch: 0, zoom: 100 }));
    const now = wall.map(q => sight.fadeAt(q));
    if (prev) now.forEach((f, i) => { if (Math.abs(wall[i].z - z) <= 3 && Math.abs(wall[i].z - prevZ) <= 3) worst = Math.max(worst, Math.abs(f - prev![i])); });
    prev = now; prevZ = z;
  }
  expect(worst).toBeLessThan(.5);
});

test('카메라가 벽 속으로 들어가는 근접 시점에서는 카메라 앞 면을 비운다', () => {
  const sight = new BattleOcclusion(), player = new THREE.Vector3(0, 0, 0);
  sight.setTarget(player);
  const camera = cameraFor(player, { yaw: 0, pitch: -18, zoom: 140 });
  sight.update(camera);
  expect(camera.y).toBeLessThan(4.2);
  const near = camera.clone().add(new THREE.Vector3(.6, -.3, -.4));
  expect(sight.fadeAt(near)).toBeGreaterThan(SIGHTLINE.maxFade * .9);
});

test('실제 영웅 좌표를 쓰고 로비·초기화·잘못된 좌표에서는 꺼진다', () => {
  const sight = new BattleOcclusion(), player = new THREE.Vector3(0, 0, 20);
  sight.setTarget(player); player.z = 500;
  const camera = new THREE.Vector3(0, 8, 28);
  sight.update(camera);
  expect(sight.active).toBe(true);
  expect(sight.fadeAt(new THREE.Vector3(0, 3, 22.5))).toBeGreaterThan(.5);
  sight.update(camera, false); expect(sight.active).toBe(false);
  expect(sight.fadeAt(new THREE.Vector3(0, 3, 22.5))).toBe(0);
  sight.update(camera); expect(sight.active).toBe(true);
  sight.reset(); sight.update(camera); expect(sight.active).toBe(false);
  sight.setTarget(new THREE.Vector3(NaN, 0, 1)); sight.update(camera);
  expect(sight.hasTarget).toBe(false); expect(sight.active).toBe(false);
});

test('셰이더 결합은 기존 onBeforeCompile·캐시 키를 이어 받고 불투명·클리핑 없음 상태를 유지한다', () => {
  const sight = new BattleOcclusion(), material = new THREE.MeshStandardMaterial();
  let earlier = 0;
  material.onBeforeCompile = () => { earlier++; };
  material.customProgramCacheKey = () => 'stone-detail';
  sight.bind(material); sight.bind(material); sight.bind([material]);
  expect(sight.isBound(material)).toBe(true);
  expect(material.customProgramCacheKey()).toBe('stone-detail|battle-sightline-v2');
  const lib = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as any;
  material.onBeforeCompile(shader, null as any);
  expect(earlier).toBe(1);
  expect(shader.vertexShader).toContain('vSightWorld = ( modelMatrix * sightWorld ).xyz;');
  expect(shader.fragmentShader).toContain('discard;');
  expect(shader.uniforms.uSightCamera).toBe(sight.uniforms.uSightCamera);
  expect(material.clippingPlanes).toBeNull(); expect(material.transparent).toBe(false); expect(material.opacity).toBe(1);
  // 렌더러 재생성 등으로 새 시선 객체가 같은 재질을 다시 묶어도 삽입은 한 번, 원래 훅도 한 번만 돈다.
  const next = new BattleOcclusion(); next.bind(material);
  expect(next.isBound(material)).toBe(true); expect(sight.isBound(material)).toBe(false);
  expect(material.customProgramCacheKey()).toBe('stone-detail|battle-sightline-v2');
  const again = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as any;
  material.onBeforeCompile(again, null as any);
  expect(earlier).toBe(2);
  expect(again.vertexShader.split('varying vec3 vSightWorld;').length).toBe(2);
  expect(again.fragmentShader.split('discard;').length - 1).toBe(shader.fragmentShader.split('discard;').length - 1);
  expect(again.uniforms.uSightCamera).toBe(next.uniforms.uSightCamera);
});

test('모든 벽 청크는 원본 자산을 복제하지 않고 시선 셰이더를 공유하며 바닥 재질은 건드리지 않는다', () => {
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
    expect(arena.occlusion.isBound(mat)).toBe(true); expect(mat.clippingPlanes).toBeNull();
    expect(mat.transparent).toBe(false); expect(mat.opacity).toBe(1);
    expect(mesh.geometry).toBe(geometry);
  }
  for (const mesh of meshes.slice(3)) expect(arena.occlusion.isBound(mesh.material as THREE.Material)).toBe(false);
  expect(arena.occlusion.isBound(material)).toBe(false);
  let disposed = 0, sourceDisposed = 0;
  for (const mat of arena.ownedMaterials) mat.addEventListener('dispose', () => disposed++);
  material.addEventListener('dispose', () => sourceDisposed++);
  geometry.addEventListener('dispose', () => sourceDisposed++);
  arena.clear(); arena.clear();
  expect(disposed).toBe(2); expect(sourceDisposed).toBe(0);
  geometry.dispose(); material.dispose();
});

test('실제 층 건축은 기존 배치와 충돌 마스크를 쓰고 다시 짓기는 대상을 초기화한다', () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x111111);
  const arena = new Arena(scene, { scene: new THREE.Group() }, {});
  const floor = new Floor(3, 'garden'), mask = Array.from(floor.mask!);
  arena.buildFloor(floor, 'garden');
  expect(arena.regionArchitecture!.children.length).toBeLessThanOrEqual(floor.rooms.length * 3);
  arena.regionArchitecture!.traverse((node: THREE.Object3D) => {
    if (node instanceof THREE.Mesh) expect(arena.occlusion.isBound(node.material as THREE.Material)).toBe(true);
  });
  for (const seal of arena.seals) expect(arena.occlusion.isBound(seal.material)).toBe(false);
  const pos = new THREE.Vector3(floor.startRoom.x, 0, floor.startRoom.z);
  arena.update(0, null, pos); expect(arena.occlusion.hasTarget).toBe(true);
  expect(Array.from(floor.mask!)).toEqual(mask);
  expect(arena.group.userData.dungeonWalls.segments).toBeGreaterThan(0);
  expect(arena.group.userData.dungeonWalls.legacyVariantDraws).toBeGreaterThan(0);
  expect(floor.architectureMask).not.toBe(floor.mask);
  arena.buildFloor(floor, 'garden'); expect(arena.occlusion.hasTarget).toBe(false);
  arena.clear(); expect(arena.occlusion.hasTarget).toBe(false);
});
