import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Floor } from '../src/game/world.js';
import { stageDef } from '../src/data/stages.js';
import { STORY_DUNGEONS } from '../src/data/story-dungeons.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { GARDEN_MASTERY } from '../src/data/garden-mastery.js';
import { SURFACE_TEXTURES } from '../src/engine/surface-textures.js';
import { BattleOcclusion } from '../src/engine/battle-occlusion.js';
import baseline from './fixtures/region-architecture-ae2260e.json';

type Range = { roomId: number; materialRole: number; batchId: number; start: number; count: number };
type Landmark = { roomId: number; theme: string; kind: string; label: string; role: string; x: number; z: number };
type MasteryRoom = { label: string; gardenMastery?: { version: string; diagonals: readonly {
  fromX: number; fromZ: number; toX: number; toZ: number;
}[] } };
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

// 역사 원본 hash는 그대로 검사하고 현재 소스의 추가분을 한 방·한 재질의 정확한 꼬리로 한정한다.
function expectGardenMasteryAddition(current: THREE.Group, legacy: THREE.Group, floor: Floor) {
  const entries = (group: THREE.Group) => (group.children as THREE.Mesh[]).flatMap(mesh =>
    (mesh.userData.roomRanges as Range[]).map(range => ({ mesh, range })));
  const actual = entries(current), original = entries(legacy);
  const authored = (floor.rooms[3] as MasteryRoom).gardenMastery!;
  expect(authored.version).toBe(GARDEN_MASTERY.version); expect(authored.diagonals).toHaveLength(2);
  expect(current.children.map(mesh => mesh.name)).toEqual(legacy.children.map(mesh => mesh.name));
  expect(current.userData.architectureBatches).toEqual(legacy.userData.architectureBatches);
  const legacyLandmarks = legacy.userData.landmarks as Landmark[];
  const legacyRoom = legacyLandmarks.filter(landmark => landmark.roomId === 3);
  expect(legacyRoom).toHaveLength(1); expect(legacyRoom[0].label).toBe('');
  expect((floor.rooms[3] as MasteryRoom).label).toBe(GARDEN_MASTERY.label);
  expect(current.userData.roomDetails).toEqual(legacy.userData.roomDetails);
  expect(current.userData.landmarks).toEqual(legacyLandmarks.map(landmark => landmark.roomId === 3
    ? { ...landmark, label: GARDEN_MASTERY.label } : landmark));
  expect(actual.map(({ range }) => [range.roomId, range.materialRole, range.batchId])).toEqual(
    original.map(({ range }) => [range.roomId, range.materialRole, range.batchId]));
  const changed = original.filter(({ range }) => range.roomId === 3 && range.materialRole === 0);
  expect(changed).toHaveLength(1); const added = changed[0];
  const byRoom = (a: Range, b: Range) => a.roomId - b.roomId || a.materialRole - b.materialRole;
  expect([...current.userData.roomGeometry].sort(byRoom)).toEqual(actual.map(({ range }) => range).sort(byRoom));
  for (let m = 0; m < current.children.length; m++) {
    const mesh = current.children[m] as THREE.Mesh, previous = legacy.children[m] as THREE.Mesh;
    expect(materialShape(mesh.material as THREE.MeshStandardMaterial)).toEqual(materialShape(previous.material as THREE.MeshStandardMaterial));
    expect([mesh.castShadow, mesh.receiveShadow, mesh.frustumCulled, mesh.visible, mesh.position.toArray(), mesh.scale.toArray(), mesh.quaternion.toArray()]).toEqual(
      [previous.castShadow, previous.receiveShadow, previous.frustumCulled, previous.visible, previous.position.toArray(), previous.scale.toArray(), previous.quaternion.toArray()]);
    expect(mesh.geometry.index).toBeNull(); expect(mesh.geometry.groups).toEqual(previous.geometry.groups);
    expect(mesh.geometry.drawRange).toEqual(previous.geometry.drawRange);
    const extra = previous === added.mesh ? 24 : 0;
    for (const name of Object.keys(mesh.geometry.attributes)) {
      const attr = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      const old = previous.geometry.getAttribute(name) as THREE.BufferAttribute;
      expect(attr.count).toBe(old.count + extra);
      expect(attr.array.length).toBe(old.array.length + extra * old.itemSize);
    }
    const positions = mesh.geometry.getAttribute('position'), union = new THREE.Box3(), point = new THREE.Vector3();
    let next = 0;
    for (const range of mesh.userData.roomRanges as Range[]) {
      expect(range.start).toBe(next); next += range.count;
    }
    expect(next).toBe(positions.count);
    let farthest = 0;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i); union.expandByPoint(point);
      farthest = Math.max(farthest, point.distanceToSquared(mesh.geometry.boundingSphere!.center));
    }
    expect(mesh.geometry.boundingBox!.min.toArray()).toEqual(union.min.toArray());
    expect(mesh.geometry.boundingBox!.max.toArray()).toEqual(union.max.toArray());
    expect(farthest).toBeLessThanOrEqual((mesh.geometry.boundingSphere!.radius + 1e-5) ** 2);
  }
  for (let i = 0; i < actual.length; i++) {
    const { mesh, range } = actual[i], previous = original[i];
    const tail = range.roomId === 3 && range.materialRole === 0 ? 24 : 0;
    const shift = range.batchId === added.range.batchId && range.materialRole === 0 && previous.range.start > added.range.start ? 24 : 0;
    expect(range.count).toBe(previous.range.count + tail); expect(range.start).toBe(previous.range.start + shift);
    expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(Object.keys(previous.mesh.geometry.attributes).sort());
    for (const name of Object.keys(mesh.geometry.attributes)) {
      const attr = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      const old = previous.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      expect([attr.itemSize, attr.normalized, attr.array.constructor.name]).toEqual([old.itemSize, old.normalized, old.array.constructor.name]);
      const size = attr.array.BYTES_PER_ELEMENT * attr.itemSize;
      expect(new Uint8Array(attr.array.buffer, attr.array.byteOffset + range.start * size, previous.range.count * size)).toEqual(
        new Uint8Array(old.array.buffer, old.array.byteOffset + previous.range.start * size, previous.range.count * size));
    }
    if (!tail) continue;
    const start = range.start + previous.range.count;
    const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
    const colors = mesh.geometry.getAttribute('color'), uv = mesh.geometry.getAttribute('uv');
    const uvCorners = [[0, 1], [0, 0], [1, 1], [0, 0], [1, 0], [1, 1]];
    for (let quad = 0; quad < 4; quad++) {
      const path = authored.diagonals[Math.floor(quad / 2)], cap = quad % 2 === 1;
      const dx = path.toX - path.fromX, dz = path.toZ - path.fromZ, length = Math.hypot(dx, dz);
      const cx = cap ? path.toX : (path.fromX + path.toX) / 2, cz = cap ? path.toZ : (path.fromZ + path.toZ) / 2;
      const color = new THREE.Color(cap ? 0xc5c5a9 : 0x9aab9d), first = start + quad * 6;
      for (let vertex = 0; vertex < 6; vertex++) {
        const index = first + vertex, x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
        const along = ((x - cx) * dx + (z - cz) * dz) / length, across = (-(x - cx) * dz + (z - cz) * dx) / length;
        const [u, v] = uvCorners[vertex];
        expect(Math.abs(along - (cap ? (.5 - v) * .12 : (u - .5) * length))).toBeLessThan(1e-5);
        expect(Math.abs(across - (cap ? (.5 - u) * .65 : (.5 - v) * .12))).toBeLessThan(1e-5);
        expect(y).toBe(positions.getY(first)); expect(y).toBeGreaterThan(.04997); expect(y).toBeLessThan(.11);
        expect(floor.walkable(x, z)).toBe(true);
        expect(normals.getX(index)).toBeCloseTo(0, 12); expect(normals.getY(index)).toBe(1); expect(normals.getZ(index)).toBeCloseTo(0, 12);
        expect([colors.getX(index), colors.getY(index), colors.getZ(index)]).toEqual([Math.fround(color.r), Math.fround(color.g), Math.fround(color.b)]);
        expect([uv.getX(index), uv.getY(index)]).toEqual(uvCorners[vertex]);
      }
    }
  }
  expect(actual.reduce((sum, { range }) => sum + range.count, 0)).toBe(original.reduce((sum, { range }) => sum + range.count, 0) + 24);
}

for (const [name, theme, makeFloor] of cases) test(`${name}: AE 방의 모든 삼각형·재질·정보를 보존하는 제한 배치`, () => {
  const floor = makeFloor(), control = makeFloor(), rng = floor.rand;
  const before = hash([floor.rooms, floor.corridors, Array.from(floor.mask!), Array.from(floor.inner!), floor.gates, floor.sealed]);
  const mastery = name === 'garden-loop';
  if (mastery) {
    const currentRoom = floor.rooms[3] as MasteryRoom, historicalRoom = control.rooms[3] as MasteryRoom;
    expect(currentRoom.label).toBe(GARDEN_MASTERY.label);
    expect(currentRoom.gardenMastery?.version).toBe(GARDEN_MASTERY.version);
    delete historicalRoom.gardenMastery;
    // 정확한 부모 layout에는 labels가 없어 room3의 역사 이름은 빈 문자열이다.
    historicalRoom.label = '';
  }
  const controlBefore = hash([control.rooms, control.corridors, Array.from(control.mask!), Array.from(control.inner!), control.gates, control.sealed]);
  const current = mastery ? buildRegionArchitecture(floor, theme) : null;
  const group = buildRegionArchitecture(mastery ? control : floor, theme);
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
  if (current) {
    expectGardenMasteryAddition(current, group, floor);
    expect(hash([floor.rooms, floor.corridors, Array.from(floor.mask!), Array.from(floor.inner!), floor.gates, floor.sealed])).toBe(before);
    expect(hash([control.rooms, control.corridors, Array.from(control.mask!), Array.from(control.inner!), control.gates, control.sealed])).toBe(controlBefore);
    current.userData.dispose();
  }
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
