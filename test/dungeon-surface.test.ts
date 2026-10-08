import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Arena } from '../src/game/arena.js';
import { Floor, mulberry32 } from '../src/game/world.js';
import { collectDungeonTiles, DUNGEON_SURFACE, projectDungeonSurface } from '../src/game/dungeon-surface.js';

type Tile = { x: number; z: number; ry: number; name: string };

// 변경 전 배치 순서의 독립 참조로 난수 소비와 실제 지면 범위를 대조한다.
function previousTiles(floor: Floor, random: () => number) {
  const result: Tile[] = [];
  for (const rect of [...floor.rooms, ...floor.corridors]) {
    const x0 = Math.floor((rect.x - rect.w / 2) / 4), x1 = Math.ceil((rect.x + rect.w / 2) / 4);
    const z0 = Math.floor((rect.z - rect.h / 2) / 4), z1 = Math.ceil((rect.z + rect.h / 2) / 4);
    for (let i = x0; i < x1; i++) for (let j = z0; j < z1; j++) {
      const k = random();
      const name = ('type' in rect && rect.type === 'boss') || floor.layout ? 'floor_tile_large'
        : k < .75 ? 'floor_tile_large' : k < .9 ? 'floor_tile_large_rocks' : 'floor_dirt_large';
      result.push({ x: i * 4 + 2, z: j * 4 + 2, ry: Math.floor(random() * 4) * Math.PI / 2, name });
    }
  }
  return result;
}

for (const theme of ['garden', 'forge', 'frost', 'tide', 'crown', 'crypt', 'throne', 'abyss']) {
  test(`${theme}: 중복 바닥만 제거하고 지면 범위·난수·충돌 데이터를 보존한다`, () => {
    const floor = new Floor(1, theme, 20260905), control = new Floor(1, theme, 20260905);
    const before = JSON.stringify([floor.rooms, floor.corridors, floor.gates, floor.mask, floor.inner]);
    const firstRandom = mulberry32(20260905 ^ 0x51a7), secondRandom = mulberry32(20260905 ^ 0x51a7);
    const previous = previousTiles(floor, firstRandom), next = collectDungeonTiles(floor, secondRandom);
    const expected = new Map<string, Tile>();
    for (const tile of previous) if (!expected.has(`${tile.x},${tile.z}`)) expected.set(`${tile.x},${tile.z}`, tile);
    const actual = Object.entries(next.transforms).flatMap(([name, tiles]) => tiles.map(tile => ({ ...tile, name })));
    expect(next.sampledTiles).toBe(previous.length); expect(next.uniqueTiles).toBe(expected.size);
    expect(actual.length).toBe(expected.size); expect(actual.length).toBeLessThan(previous.length);
    for (const tile of actual) expect(tile).toEqual(expected.get(`${tile.x},${tile.z}`)!);
    for (let i = 0; i < 32; i++) expect(secondRandom()).toBe(firstRandom());
    expect(JSON.stringify([floor.rooms, floor.corridors, floor.gates, floor.mask, floor.inner])).toBe(before);
    expect(floor.rand()).toBe(control.rand());
    for (const room of floor.rooms) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(floor.resolve(room.x, room.z, room.x + dx * room.w, room.z + dz * room.h)).toEqual(
        control.resolve(room.x, room.z, room.x + dx * room.w, room.z + dz * room.h));
    }
  });
}

test('압축 정점의 GLB 변환을 적용해 UV만 만들고 원본 정점·법선·인덱스를 보존한다', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Uint16BufferAttribute([100, 0, 200, 500, 0, 200, 100, 0, 600], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([.1, .1, .1, .1, .1, .1], 2));
  geometry.setIndex([0, 1, 2]);
  const local = new THREE.Matrix4().makeScale(.01, .01, .01).setPosition(-3, 0, -4);
  const next = projectDungeonSurface(geometry, local);
  expect(next).not.toBe(geometry); expect(next.getAttribute('position').array).toEqual(geometry.getAttribute('position').array);
  expect(next.getAttribute('normal').array).toEqual(geometry.getAttribute('normal').array);
  expect(next.index!.array).toEqual(geometry.index!.array);
  expect([...next.getAttribute('uv').array]).toEqual([0, 0, 1, 0, 0, 1]);
  expect([...geometry.getAttribute('uv').array]).toEqual(Array(6).fill(Math.fround(.1)));
  next.dispose(); geometry.dispose();
});

test('공간 청크는 재투영한 지면을 공유하며 전환 때 전용 자원만 한 번 회수한다', () => {
  const source = new THREE.Group(), scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(4, .1, 4), material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const part = new THREE.Mesh(geometry, material); part.name = 'floor_tile_large'; source.add(part);
  const shared = new THREE.Texture(), previous = DUNGEON_SURFACE.texture;
  DUNGEON_SURFACE.texture = shared;
  const arena = new Arena(scene, { scene: source }, {});
  let sourceDisposed = 0, ownedDisposed = 0;
  geometry.addEventListener('dispose', () => sourceDisposed++);
  material.addEventListener('dispose', () => sourceDisposed++);
  shared.addEventListener('dispose', () => sourceDisposed++);
  try {
    arena.instanced(part.name, [{ x: 0, z: 0 }, { x: 100, z: 100 }, { x: -100, z: 0 }], 0xbbc9c0,
      { castShadow: false, dungeonSurface: true });
    const meshes = arena.group.children as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(3); expect(arena.ownedGeometry.size).toBe(1); expect(arena.ownedMaterials.size).toBe(1);
    const owned = meshes[0].geometry, surface = meshes[0].material as THREE.MeshStandardMaterial;
    owned.addEventListener('dispose', () => ownedDisposed++); surface.addEventListener('dispose', () => ownedDisposed++);
    expect(owned).not.toBe(geometry); expect(material.map).toBeNull(); expect(surface.map).toBe(shared);
    expect(surface.userData.surfaceTexture).toBe('gpt-dungeon-stone-v1');
    expect(surface.transparent).toBe(false); expect(surface.depthWrite).toBe(true); expect(surface.clippingPlanes).toBeNull();
    for (const mesh of meshes) {
      expect(mesh.geometry).toBe(owned); expect(mesh.material).toBe(surface);
      expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(true); expect(mesh.frustumCulled).toBe(true);
      expect(mesh.geometry.boundingSphere).not.toBeNull();
    }
    arena.clear(); arena.clear(); expect(ownedDisposed).toBe(2); expect(sourceDisposed).toBe(0);
  } finally {
    arena.clear(); DUNGEON_SURFACE.texture = previous; shared.dispose(); geometry.dispose(); material.dispose();
  }
});
