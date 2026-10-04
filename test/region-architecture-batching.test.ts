import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Floor } from '../src/game/world.js';
import { stageDef } from '../src/data/stages.js';
import { STORY_DUNGEONS } from '../src/data/story-dungeons.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { SURFACE_TEXTURES } from '../src/engine/surface-textures.js';
import { BattleOcclusion } from '../src/engine/battle-occlusion.js';
import baseline from './fixtures/region-architecture-ae2260e.json';

type Range = { roomId: number; materialRole: number; batchId: number; start: number; count: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const themes = ['crypt', 'throne', 'abyss', 'garden', 'forge', 'frost', 'tide', 'crown'];
const cases: [string, string, () => Floor][] = themes.map(theme => [`floor4-${theme}`, theme, () => new Floor(4, theme)]);
cases.push(['campaign-1-1', 'garden', () => {
  const stage = stageDef(1, 1);
  return new Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon.layout as any);
}]);
cases.push(['garden-loop', 'garden', () => buildExpeditionWorld(buildExpeditionStage('dungeon', 'glass_garden', null))]);
const storyMarks = new Set<string>();
for (const map of Object.values(STORY_DUNGEONS)) {
  if (storyMarks.has(map.landmark)) continue;
  storyMarks.add(map.landmark);
  cases.push([`story-${map.landmark}`, 'garden', () => new Floor(51, 'garden', undefined, map.layout as any)]);
}

function materialShape(material: THREE.MeshStandardMaterial) {
  return {
    type: material.type, color: material.color.toArray(), emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity, roughness: material.roughness, metalness: material.metalness,
    vertexColors: material.vertexColors, transparent: material.transparent, opacity: material.opacity,
    side: material.side, depthTest: material.depthTest, depthWrite: material.depthWrite,
    map: material.map?.name || null, normalMap: material.normalMap?.name || null,
    roughnessMap: material.roughnessMap?.name || null, bumpMap: material.bumpMap?.name || null,
    bumpScale: material.bumpScale, normalScale: material.normalScale.toArray(),
    shader: material.onBeforeCompile.toString(), cacheKey: material.customProgramCacheKey(),
  };
}

// AE 원본의 방별 메시에서 기록한 순서 있는 바이트와 대조한다. 정점을 정렬하지 않는다.
function geometryFingerprint(group: THREE.Group) {
  const records = (group.children as THREE.Mesh[]).flatMap(mesh =>
    (mesh.userData.roomRanges as Range[]).map(range => ({ mesh, range })));
  records.sort((a, b) => a.range.roomId - b.range.roomId || a.range.materialRole - b.range.materialRole);
  const digest = createHash('sha256');
  for (const { mesh, range } of records) {
    digest.update(JSON.stringify([range.roomId, range.materialRole, range.count]));
    for (const name of Object.keys(mesh.geometry.attributes).sort()) {
      const attr = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      digest.update(JSON.stringify([name, attr.itemSize, attr.normalized, attr.array.constructor.name]));
      const bytes = attr.array.BYTES_PER_ELEMENT;
      digest.update(new Uint8Array(attr.array.buffer, attr.array.byteOffset + range.start * attr.itemSize * bytes,
        range.count * attr.itemSize * bytes));
    }
  }
  return digest.digest('hex');
}

for (const [name, theme, makeFloor] of cases) test(`${name}: AE 방의 모든 삼각형·재질·정보를 보존하는 제한 배치`, () => {
  const floor = makeFloor(), control = makeFloor(), rng = floor.rand;
  const before = hash([floor.rooms, floor.corridors, Array.from(floor.mask!), Array.from(floor.inner!), floor.gates, floor.sealed]);
  const group = buildRegionArchitecture(floor, theme);
  const original = baseline.cases[name as keyof typeof baseline.cases];
  expect(original).toBeDefined();
  expect(geometryFingerprint(group)).toBe(original.geometrySha256);
  expect(hash([group.userData.roomDetails, group.userData.landmarks])).toBe(original.metadataSha256);
  expect(group.children.length).toBeLessThan(original.meshes);
  let vertices = 0;
  const materials = new Map<number, THREE.MeshStandardMaterial>(), seen = new Set<string>();
  for (const mesh of group.children as THREE.Mesh[]) {
    const geometry = mesh.geometry, role = mesh.userData.materialRole as number;
    expect(mesh.isMesh).toBe(true); expect(mesh.children).toHaveLength(0);
    expect(mesh.material).not.toBeInstanceOf(Array);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    if (materials.has(role)) expect(mesh.material).toBe(materials.get(role)!);
    else materials.set(role, mesh.material as THREE.MeshStandardMaterial);
    expect(mesh.castShadow).toBe(role !== 2); expect(mesh.receiveShadow).toBe(true);
    expect(mesh.frustumCulled).toBe(true); expect(mesh.visible).toBe(true);
    expect(mesh.position.toArray()).toEqual([0, 0, 0]); expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(geometry.index).toBeNull(); expect(geometry.groups).toHaveLength(0);
    expect(geometry.drawRange).toEqual({ start: 0, count: Infinity });
    expect(Object.keys(geometry.attributes).sort()).toEqual(role === 0 ? ['color', 'normal', 'position', 'uv'] : ['normal', 'position', 'uv']);
    const position = geometry.getAttribute('position'), union = new THREE.Box3(), point = new THREE.Vector3();
    let next = 0, farthest = 0;
    for (const range of mesh.userData.roomRanges as Range[]) {
      expect(range.batchId).toBe(mesh.userData.batchId); expect(range.materialRole).toBe(role);
      expect(range.start).toBe(next); expect(range.count % 3).toBe(0); expect(range.count).toBeGreaterThan(0);
      const key = `${range.roomId}:${role}`; expect(seen.has(key)).toBe(false); seen.add(key);
      next += range.count;
      for (let i = range.start; i < next; i++) {
        point.fromBufferAttribute(position, i); union.expandByPoint(point);
        // 합쳐진 구는 실제 정점을 모두 포함하므로 방의 보이는 삼각형을 조기에 컬링하지 않는다.
        farthest = Math.max(farthest, point.distanceToSquared(geometry.boundingSphere!.center));
      }
    }
    expect(next).toBe(position.count); vertices += next;
    expect(farthest).toBeLessThanOrEqual((geometry.boundingSphere!.radius + 1e-5) ** 2);
    expect(geometry.boundingBox!.min.toArray()).toEqual(union.min.toArray());
    expect(geometry.boundingBox!.max.toArray()).toEqual(union.max.toArray());
  }
  expect([...materials.keys()].sort()).toEqual(original.materialRoles); expect(vertices).toBe(original.vertices);
  expect(seen.size).toBe(original.meshes);
  expect(hash([...materials.entries()].sort(([a], [b]) => a - b).map(([role, material]) => [role, materialShape(material)]))).toBe(original.materialsSha256);
  expect(group.userData.roomGeometry.length).toBe(original.meshes);
  const byRoom = (a: Range, b: Range) => a.roomId - b.roomId || a.materialRole - b.materialRole;
  expect([...group.userData.roomGeometry].sort(byRoom)).toEqual(
    (group.children as THREE.Mesh[]).flatMap(mesh => mesh.userData.roomRanges as Range[]).sort(byRoom));
  const membership = new Set<number>(), [spacingX, spacingZ] = floor.layout?.spacing || [34, 34];
  for (const batch of group.userData.architectureBatches as { batchId: number; roomIds: number[] }[]) {
    expect(batch.roomIds.length).toBeGreaterThan(0); expect(batch.roomIds.length).toBeLessThanOrEqual(3);
    const rooms = batch.roomIds.map(id => floor.rooms.find(room => room.id === id)!);
    const connected = new Set([rooms[0].id]);
    for (let i = 0; i < rooms.length; i++) for (const room of rooms) {
      if (rooms.some(other => connected.has(other.id) && (other.links.includes(room.id) || room.links.includes(other.id))
        && Math.abs(other.gx - room.gx) + Math.abs(other.gy - room.gy) === 1)) connected.add(room.id);
    }
    expect(connected.size).toBe(rooms.length);
    for (const [key, limit] of [['gx', 1], ['gy', 1], ['x', spacingX + 6], ['z', spacingZ + 6]] as const) {
      const values = rooms.map(room => room[key]);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(limit);
    }
    for (const room of rooms) { expect(membership.has(room.id)).toBe(false); membership.add(room.id); }
    const meshes = (group.children as THREE.Mesh[]).filter(mesh => mesh.userData.batchId === batch.batchId);
    expect(meshes.length).toBeGreaterThan(0); expect(meshes.length).toBeLessThanOrEqual(3);
    expect(new Set(meshes.flatMap(mesh => mesh.userData.roomRanges.map((range: Range) => range.roomId)))).toEqual(new Set(batch.roomIds));
  }
  expect(membership).toEqual(new Set(floor.rooms.map(room => room.id)));
  expect(hash([floor.rooms, floor.corridors, Array.from(floor.mask!), Array.from(floor.inner!), floor.gates, floor.sealed])).toBe(before);
  expect(floor.rand).toBe(rng);
  expect(Array.from({ length: 16 }, () => floor.rand())).toEqual(Array.from({ length: 16 }, () => control.rand()));
  group.userData.dispose();
});

test('연결이 없거나 실제 월드 거리가 먼 방은 같은 배치로 합치지 않는다', () => {
  const rooms = [0, 1, 2].map(id => ({ id, gx: id === 1 ? 1 : 0, gy: id === 2 ? 1 : 0,
    x: id === 1 ? 1000 : 0, z: id === 2 ? 34 : 0,
    w: 20, h: 20, type: 'normal', links: id < 2 ? [1 - id] : [] }));
  const group = buildRegionArchitecture({ rooms, corridors: [] }, 'crypt');
  expect(group.userData.architectureBatches.map((batch: { roomIds: number[] }) => batch.roomIds)).toEqual([[0], [1], [2]]);
  expect(group.children.every(mesh => /^crypt-room-\d-\d$/.test(mesh.name))).toBe(true);
  group.userData.dispose();
});

test('기존 세 표면과 컷어웨이 재질을 공유하며 소유 지오메트리·재질만 한 번 회수한다', () => {
  const keys = ['dungeon-stone-diffuse', 'dungeon-stone-normal', 'dungeon-stone-roughness', 'forged-metal'];
  const previous = keys.map(key => SURFACE_TEXTURES[key]);
  const textures = keys.map(key => { const texture = new THREE.Texture(); texture.name = key; SURFACE_TEXTURES[key] = texture; return texture; });
  let textureDisposals = 0;
  textures.forEach(texture => texture.addEventListener('dispose', () => textureDisposals++));
  try {
    const group = buildRegionArchitecture(new Floor(4, 'garden'), 'garden'), occlusion = new BattleOcclusion();
    const meshes = group.children as THREE.Mesh[];
    const materials = new Set(meshes.map(mesh => mesh.material as THREE.MeshStandardMaterial));
    expect(materials.size).toBe(3);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial; occlusion.bind(material);
      expect(material.clippingPlanes).toBe(occlusion.planes); expect(material.clipIntersection).toBe(true);
      if (mesh.userData.materialRole === 0) {
        expect(material.map).toBe(textures[0]); expect(material.normalMap).toBe(textures[1]);
        expect(material.roughnessMap).toBe(textures[2]); expect(material.normalScale.toArray()).toEqual([.45, .45]);
        expect(material.roughness).toBe(.88); expect(material.metalness).toBe(.02);
      } else if (mesh.userData.materialRole === 1) {
        expect(material.map).toBe(textures[3]); expect(material.bumpMap).toBe(textures[3]); expect(material.roughnessMap).toBe(textures[3]);
        expect(material.bumpScale).toBe(.018);
      } else expect(material.map).toBeNull();
    }
    let geometryDisposals = 0, materialDisposals = 0;
    meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => geometryDisposals++));
    materials.forEach(material => material.addEventListener('dispose', () => materialDisposals++));
    const scene = new THREE.Scene(); scene.add(group);
    group.userData.dispose(); group.userData.dispose();
    expect(group.parent).toBeNull(); expect(geometryDisposals).toBe(meshes.length);
    expect(materialDisposals).toBe(3); expect(textureDisposals).toBe(0);
  } finally {
    keys.forEach((key, i) => { if (previous[i]) SURFACE_TEXTURES[key] = previous[i]; else delete SURFACE_TEXTURES[key]; });
    textures.forEach(texture => texture.dispose());
  }
});

test('메시에 쓰이지 않은 셋째 재질도 소유자가 한 번만 회수한다', () => {
  const group = buildRegionArchitecture(new Floor(4, 'throne'), 'throne');
  const used = new Set((group.children as THREE.Mesh[]).map(mesh => mesh.material));
  expect(used.size).toBe(2);
  const originalDispose = THREE.Material.prototype.dispose, disposed: THREE.Material[] = [];
  THREE.Material.prototype.dispose = function() { disposed.push(this); originalDispose.call(this); };
  try { group.userData.dispose(); group.userData.dispose(); }
  finally { THREE.Material.prototype.dispose = originalDispose; }
  expect(disposed.length).toBe(3); expect(new Set(disposed).size).toBe(3);
  for (const material of used) expect(disposed).toContain(material as THREE.Material);
});
