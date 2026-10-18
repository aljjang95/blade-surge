import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { existsSync } from 'node:fs';
import { isStarArchive } from '../src/game/world.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { Arena, STAR_ARCHIVE_ATMOSPHERE } from '../src/game/arena.js';
import { STAR_ARCHIVE_TEXTURE_PATHS, STAR_ARCHIVE_TEXTURES } from '../src/engine/surface-textures.js';
import { buildHistoricalArchitecture, geometryFingerprint, materialShape } from './helpers/region-architecture-reference.mjs';

const makeWorld = (id: string, depth = 'standard') =>
  buildExpeditionWorld(buildExpeditionStage('dungeon', id, null, { depth }));

test('별빛 서고는 원정 ID로만 선택하고 테마·랜드마크·시드의 우연한 일치는 무시한다', () => {
  const world = makeWorld('star_archive');
  expect(isStarArchive(world)).toBe(true);
  expect(isStarArchive({ ...world, expeditionRouteId: 'nightglass_observatory' })).toBe(false);
  expect(isStarArchive({ ...world, expeditionRouteId: undefined })).toBe(false);
  expect(isStarArchive(makeWorld('star_archive', 'deep'))).toBe(true);
});

for (const id of ['aurora_icewell', 'crownfall_glacier', 'nightglass_observatory']) {
  test(id + ': 다른 frost 건축의 정점·재질·랜드마크는 역사 원본과 같다', () => {
    const world = makeWorld(id);
    const before = JSON.stringify([world.rooms, world.corridors, world.mask, world.gates]);
    const current = buildRegionArchitecture(world, 'frost');
    const original = buildHistoricalArchitecture(world, 'frost');
    try {
      expect(geometryFingerprint(current)).toBe(geometryFingerprint(original));
      expect(current.userData.landmarks).toEqual(original.userData.landmarks);
      const materials = (g: THREE.Group) => [...new Set((g.children as THREE.Mesh[]).map(m => m.material))]
        .map(m => materialShape(m as THREE.MeshStandardMaterial));
      expect(materials(current)).toEqual(materials(original));
      expect(JSON.stringify([world.rooms, world.corridors, world.mask, world.gates])).toBe(before);
    } finally { current.userData.dispose(); original.userData.dispose(); }
  });
}

test('네 공유 자산 경로는 실제 WebP 파일을 가리킨다', () => {
  expect(Object.keys(STAR_ARCHIVE_TEXTURE_PATHS).sort()).toEqual(['books', 'crystal', 'floor', 'rosette']);
  for (const path of Object.values(STAR_ARCHIVE_TEXTURE_PATHS)) {
    expect(path.startsWith('/textures/star-archive/')).toBe(true);
    expect(existsSync(new URL('../public' + path, import.meta.url))).toBe(true);
  }
});

test('방별 병합·60% 데칼·렌더 회전·자원 회수는 월드와 공유 텍스처를 보존한다', () => {
  const world = makeWorld('star_archive'), control = makeWorld('star_archive');
  const state = JSON.stringify([world.rooms, world.corridors, world.mask, world.gates]);
  const previous = { ...STAR_ARCHIVE_TEXTURES };
  const shared = new THREE.Texture(); let textureDisposals = 0;
  shared.addEventListener('dispose', () => textureDisposals++);
  for (const key of Object.keys(STAR_ARCHIVE_TEXTURE_PATHS)) STAR_ARCHIVE_TEXTURES[key] = shared;
  const group = buildRegionArchitecture(world, 'frost');
  try {
    const meshes = group.children as THREE.Mesh[];
    expect(meshes.length).toBeLessThanOrEqual(world.rooms.length * 8);
    const rotors = meshes.filter(mesh => mesh.name.startsWith('star-archive-armillary-'));
    expect(rotors.length).toBeGreaterThan(0);
    for (const room of world.rooms) {
      const decal = meshes.find(mesh => mesh.name === 'star-archive-room-' + room.id + '-3')!;
      const material = decal.material as THREE.MeshStandardMaterial;
      expect(material.map).toBe(shared); expect(material.depthWrite).toBe(false);
      expect(decal.renderOrder).toBeLessThan(new THREE.Mesh().renderOrder);
      expect(decal.userData.surface).toBe(true); expect(decal.castShadow).toBe(false);
      decal.geometry.computeBoundingBox();
      const bounds = decal.geometry.boundingBox!;
      expect(bounds.max.y).toBeCloseTo(.075);
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(Math.min(room.w, room.h) * .6, 4);
    }
    group.userData.update(1 / 60); group.userData.update(1 / 60);
    for (const rotor of rotors) expect(rotor.rotation.y).toBeCloseTo(.003);
    expect(JSON.stringify([world.rooms, world.corridors, world.mask, world.gates])).toBe(state);
    for (let i = 0; i < 20; i++) expect(world.rand()).toBe(control.rand());
    const geometries = new Set(meshes.map(mesh => mesh.geometry));
    const materials = new Set(meshes.map(mesh => mesh.material as THREE.Material));
    let disposed = 0;
    for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => disposed++);
    group.userData.dispose(); group.userData.dispose();
    expect(disposed).toBe(geometries.size + materials.size); expect(textureDisposals).toBe(0);
  } finally {
    group.userData.dispose();
    for (const key of Object.keys(STAR_ARCHIVE_TEXTURE_PATHS)) {
      if (previous[key]) STAR_ARCHIVE_TEXTURES[key] = previous[key]; else delete STAR_ARCHIVE_TEXTURES[key];
    }
    shared.dispose();
  }
});

function makeArena() {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x172535);
  const source = new THREE.Group();
  for (const name of ['floor_tile_large', 'wall', 'wall_cracked', 'wall_broken', 'wall_arched', 'wall_window_open', 'pillar_decorated']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, name === 'floor_tile_large' ? .1 : 4, 1), new THREE.MeshStandardMaterial());
    mesh.name = name; source.add(mesh);
  }
  const arena = new Arena(scene, { scene: source }, {});
  arena.buildSky = () => {};
  arena.place = () => new THREE.Group();
  arena.mountLandmarks = () => {};
  return { arena, source, scene, dispose() {
    arena.clear(); source.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); node.material.dispose(); }
    });
  } };
}

test('별빛 서고를 나온 뒤 다른 frost의 조명·돌바닥·횃불 설정이 복원된다', () => {
  const fixture = makeArena(), { arena, scene } = fixture;
  try {
    const star = makeWorld('star_archive'), other = makeWorld('nightglass_observatory');
    star.layout = { ...star.layout, landmark: 'archive' };
    other.layout = { ...other.layout, landmark: 'archive' };
    arena.buildFloor(star, 'frost');
    expect((scene.fog as THREE.FogExp2).density).toBe(.014);
    expect(arena.sun!.intensity).toBe(STAR_ARCHIVE_ATMOSPHERE.sunI);
    expect(arena.torchPos).toHaveLength(0);
    expect(arena.regionArchitecture!.name).toBe('region-star-archive');
    const floors = arena.group.children.filter(m => m.name.startsWith('dungeon-surface-')) as THREE.Mesh[];
    expect(floors.length).toBeGreaterThan(0);
    for (const mesh of floors) expect((mesh.material as THREE.Material).userData.surfaceTexture).toBe('star-archive-floor');
    arena.buildFloor(other, 'frost');
    expect((scene.fog as THREE.FogExp2).density).toBe(.026); expect(arena.sun!.intensity).toBe(2.5);
    expect(arena.torchPos.length).toBeGreaterThan(0);
    expect(arena.regionArchitecture!.name).toBe('region-frost');
    for (const material of arena.ownedMaterials) expect(material.userData.surfaceTexture).not.toBe('star-archive-floor');
  } finally { fixture.dispose(); }
});
