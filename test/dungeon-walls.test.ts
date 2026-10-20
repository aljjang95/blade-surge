import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Floor, mulberry32, ROOM_TYPE } from '../src/game/world.js';
import { Arena } from '../src/game/arena.js';
import { collectDungeonTiles } from '../src/game/dungeon-surface.js';
import { collectDungeonWallRuns, collectDungeonWallSegments, fitDungeonWallSegments, DUNGEON_WALL_CLEARANCE } from '../src/game/dungeon-walls.js';

type BuiltFloor = Floor & {
  mask: Uint8Array; architectureMask: Uint8Array; inner: Uint8Array;
  cols: number; rows: number; minX: number; minZ: number;
};
function assertBuiltFloor(floor: Floor): asserts floor is BuiltFloor {
  if (!(floor.mask instanceof Uint8Array) || !(floor.architectureMask instanceof Uint8Array) || !(floor.inner instanceof Uint8Array)
    || typeof floor.cols !== 'number' || typeof floor.rows !== 'number' || typeof floor.minX !== 'number' || typeof floor.minZ !== 'number'
    || floor.mask.length !== floor.cols * floor.rows || floor.architectureMask.length !== floor.mask.length || floor.inner.length !== floor.mask.length) {
    throw new Error('테스트 층의 생성된 마스크가 없습니다.');
  }
}
function positionAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute)) throw new Error('이 테스트는 일반 정점 버퍼를 사용합니다.');
  return position;
}
type FittedWallSegment = {
  x: number; z: number; ry: number; length: number; normalX: number; normalZ: number; variant: string; clearance: number;
  boundary: { axis: string; at: number; a: number; b: number };
};

function openAt(floor: any, x: number, z: number) {
  const ix = Math.floor(x - floor.minX), iz = Math.floor(z - floor.minZ);
  return ix >= 0 && iz >= 0 && ix < floor.cols && iz < floor.rows && floor.architectureMask[iz * floor.cols + ix] === 1;
}

// 독립적인 셀별 경계 목록과 run을 비교해 합치거나 쪼개면서 빠진 면·중복 면을 찾는다.
function unitEdges(floor: any) {
  const edges = new Set<string>(), mask = floor.architectureMask;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < floor.cols && z < floor.rows && mask[z * floor.cols + x] === 1;
  for (let z = 0; z < floor.rows; z++) for (let x = 0; x < floor.cols; x++) {
    if (!open(x, z)) continue;
    for (const [dx, dz, side] of [[0,-1,0],[0,1,1],[-1,0,2],[1,0,3]]) {
      if (!open(x + dx, z + dz)) edges.add(side + ':' + x + ':' + z);
    }
  }
  return edges;
}
function segmentedEdges(floor: any) {
  const edges = new Set<string>();
  for (const segment of collectDungeonWallSegments(floor)) {
    expect(segment.length).toBeGreaterThan(0); expect(segment.length).toBeLessThanOrEqual(4);
    if (segment.length < 4) expect(segment.variant).toBe('wall');
    const side = segment.normalZ < 0 ? 0 : segment.normalZ > 0 ? 1 : segment.normalX < 0 ? 2 : 3;
    for (let offset = .5; offset < segment.length; offset++) {
      const along = segment.boundary.a + offset;
      const bx = segment.boundary.axis === 'x' ? along : segment.boundary.at;
      const bz = segment.boundary.axis === 'z' ? along : segment.boundary.at;
      const ix = bx - segment.normalX * .5, iz = bz - segment.normalZ * .5;
      expect(openAt(floor, ix, iz)).toBe(true);
      expect(openAt(floor, bx + segment.normalX * .5, bz + segment.normalZ * .5)).toBe(false);
      const key = side + ':' + Math.floor(ix - floor.minX) + ':' + Math.floor(iz - floor.minZ);
      expect(edges.has(key)).toBe(false); edges.add(key);
    }
  }
  return edges;
}

for (const theme of ['garden', 'forge', 'frost', 'tide', 'crown', 'crypt', 'throne', 'abyss']) {
  for (const seed of [7932, 20261017]) test(theme + ' seed ' + seed + ': 실제 셀 경계·봉인·난수를 보존한다', () => {
    const floor = new Floor(1, theme, seed), control = new Floor(1, theme, seed);
    assertBuiltFloor(floor); assertBuiltFloor(control);
    const before = JSON.stringify([floor.rooms, floor.corridors, floor.mask, floor.inner, floor.gates]);
    const architecture = Array.from(floor.architectureMask);
    expect(floor.architectureMask).not.toBe(floor.mask);
    const segments = collectDungeonWallSegments(floor);
    expect(segments.length).toBeGreaterThan(0);
    expect([...segmentedEdges(floor)].sort()).toEqual([...unitEdges(floor)].sort());
    expect(collectDungeonWallSegments(floor)).toEqual(segments);
    expect(JSON.stringify([floor.rooms, floor.corridors, floor.mask, floor.inner, floor.gates])).toBe(before);
    expect(floor.rand()).toBe(control.rand());
    for (const room of floor.rooms) for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      expect(floor.resolve(room.x, room.z, room.x + dx * room.w, room.z + dz * room.h))
        .toEqual(control.resolve(room.x, room.z, room.x + dx * room.w, room.z + dz * room.h));
    }
    const sealedDifference = floor.mask.some((value: number, index: number) => value !== floor.architectureMask[index]);
    if (floor.sealed) expect(sealedDifference).toBe(true);
    floor.unseal(); control.unseal();
    expect(Array.from(floor.mask)).toEqual(Array.from(control.mask));
    expect(Array.from(floor.inner)).toEqual(Array.from(control.inner));
    expect(Array.from(floor.architectureMask)).toEqual(architecture);
    expect(floor.mask.every((value: number, index: number) => !value || floor.architectureMask[index] === 1)).toBe(true);
    expect(collectDungeonWallSegments(floor)).toEqual(segments);
  });
}

test('계단 모서리·1/2/3m 끝조각·마스크 바깥쪽도 빠짐없이 경계를 만든다', () => {
  const floor = { minX: -3.37, minZ: -8.21, cols: 7, rows: 5, seed: 53,
    architectureMask: new Uint8Array([
      1,1,1,1,1,1,1,
      1,1,1,1,1,1,1,
      1,1,1,1,0,0,0,
      1,1,0,0,0,0,0,
      1,0,0,0,0,0,0,
    ]) };
  expect([...segmentedEdges(floor)].sort()).toEqual([...unitEdges(floor)].sort());
  const lengths = new Set(collectDungeonWallSegments(floor).map(segment => segment.length));
  for (const length of [1,2,3,4]) expect(lengths.has(length)).toBe(true);
  expect(collectDungeonWallRuns({ ...floor, architectureMask: new Uint8Array(35) })).toEqual([]);
  expect(() => collectDungeonWallRuns({ ...floor, architectureMask: null })).toThrow();
});

function wallAsset() {
  const source = new THREE.Group(), part = new THREE.Group();
  part.name = 'wall'; part.position.set(17, 4, -31); part.rotation.y = .27; source.add(part);
  // 실제 양자화된 벽과 같은 좌표 범위와 해독 배율. 파트 원점은 바닥 중앙과 다르다.
  const geometry = new THREE.BoxGeometry(8062, 8062, 2015).translate(8200, 6046, 4030.5);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(-4.06885528564453, -1, -2); mesh.scale.setScalar(.0004962017992511392); part.add(mesh);
  return { source, geometry, material };
}

test('실제 압축 자산형 변환은 높이·두께·공유 버퍼를 보존하며 네 방향 안쪽 면을 경계 밖에 맞춘다', () => {
  const { source, geometry, material } = wallAsset(), scene = new THREE.Scene();
  const arena = new Arena(scene, { scene: source }, {});
  const positions = Array.from(geometry.getAttribute('position').array), indices = Array.from(geometry.index!.array);
  const floor = { minX:-91.61100243590772,minZ:-88.47213684301823,cols:7,rows:3,seed:7932,
    architectureMask:new Uint8Array(21).fill(1) };
  const segments = collectDungeonWallSegments(floor);
  arena.instanced('wall', segments, undefined, { cutaway:true, alignedWall:true, chunk:4 });
  let sourceDisposed=0, ownedDisposed=0;
  geometry.addEventListener('dispose',()=>sourceDisposed++); material.addEventListener('dispose',()=>sourceDisposed++);
  for(const mat of arena.ownedMaterials) mat.addEventListener('dispose',()=>ownedDisposed++);
  expect(arena.ownedGeometry.size).toBe(0); expect(arena.ownedMaterials.size).toBe(1);
  let count=0;
  for(const mesh of arena.group.children as THREE.InstancedMesh[]) {
    expect(mesh.geometry).toBe(geometry);
    expect(arena.occlusion.isBound(mesh.material)).toBe(true);
    const data=mesh.userData.dungeonWall;
    expect(data.instances.length).toBe(mesh.count);
    for(const entry of data.instances) {
      const matrix=new THREE.Matrix4(); mesh.getMatrixAt(entry.index,matrix);
      const bounds=new THREE.Box3().setFromBufferAttribute(positionAttribute(geometry)).applyMatrix4(matrix);
      const size=bounds.getSize(new THREE.Vector3()), horizontal=entry.boundary.axis==='x';
      expect(bounds.min.y).toBeCloseTo(0,4);
      expect(size.y).toBeCloseTo(8062*.0004962017992511392,4);
      expect(horizontal ? size.x : size.z).toBeCloseTo(entry.length,4);
      expect(horizontal ? size.z : size.x).toBeCloseTo(2015*.0004962017992511392,4);
      expect(horizontal ? bounds.min.x : bounds.min.z).toBeCloseTo(entry.boundary.a,4);
      expect(horizontal ? bounds.max.x : bounds.max.z).toBeCloseTo(entry.boundary.b,4);
      const direction=horizontal?entry.normal.z:entry.normal.x;
      const face=horizontal?(direction>0?bounds.min.z:bounds.max.z):(direction>0?bounds.min.x:bounds.max.x);
      expect(direction*(face-entry.boundary.at)).toBeCloseTo(DUNGEON_WALL_CLEARANCE,4);
      count++;
    }
  }
  expect(count).toBe(segments.length);
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions);
  expect(Array.from(geometry.index!.array)).toEqual(indices);
  expect(material.userData.battleSightline).toBeUndefined();
  arena.clear(); arena.clear();
  expect(ownedDisposed).toBe(1); expect(sourceDisposed).toBe(0);
  arena.instanced('wall', segments, undefined, { cutaway:true, alignedWall:true });
  const nextMaterial=[...arena.ownedMaterials][0]; nextMaterial.addEventListener('dispose',()=>ownedDisposed++);
  arena.clear(); expect(ownedDisposed).toBe(2); expect(sourceDisposed).toBe(0);
  geometry.dispose(); material.dispose();
});

// 예전 벽 루프를 독립적으로 따라 소비한 뒤, 방 장식의 실제 좌표와 회전을 비교한다.
function legacyDecor(floor: Floor) {
  const random=mulberry32((floor.seed || floor.floor*7919)^0x51a7), seen=new Set<string>();
  const rnd=(a:number,b:number)=>a+random()*(b-a);
  collectDungeonTiles(floor,random,4);
  let draws=0;
  for(const rect of [...floor.rooms,...floor.corridors]) {
    for(let x=Math.floor((rect.x-rect.w/2)/4)*4;x<Math.ceil((rect.x+rect.w/2)/4)*4;x+=4)
      for(let z=Math.floor((rect.z-rect.h/2)/4)*4;z<Math.ceil((rect.z+rect.h/2)/4)*4;z+=4)
        for(const [dx,dz] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const cx=x+2,cz=z+2;
          if(floor.walkable(cx+dx*4,cz+dz*4)) continue;
          const key=Math.round(cx)+'_'+Math.round(cz)+'_'+dx+'_'+dz;
          if(seen.has(key)) continue; seen.add(key); random(); draws++;
        }
  }
  const props=['barrel_large','barrel_small_stack','crates_stacked','box_stacked','rubble_half','keg','trunk_large_A','table_medium_broken','candle_triple','sword_shield_broken'];
  const placements:any[]=[];
  for(const room of floor.rooms) {
    if(room.type===ROOM_TYPE.TREASURE && !room.objectiveProp) placements.push(['chest_gold',room.x,room.z,rnd(0,6.28),1.2]);
    const count=floor.layout?0:2+Math.floor(random()*3);
    for(let i=0;i<count;i++) {
      const x=room.x+rnd(-1,1)*(room.w/2-2.2),z=room.z+rnd(-1,1)*(room.h/2-2.2);
      if(Math.hypot(x-room.x,z-room.z)<3.5) continue;
      placements.push([props[Math.floor(random()*props.length)],x,z,rnd(0,6.28),rnd(.9,1.1)]);
    }
  }
  return {draws,placements,propNames:new Set([...props,'chest_gold'])};
}

for(const theme of ['garden','crypt']) test(theme+': 실제 Arena의 후속 장식 난수 순서와 재건 자원 소유권을 보존한다',()=>{
  const floor=new Floor(3,theme,7932), expected=legacyDecor(floor), {source,geometry,material}=wallAsset();
  const scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0x111111);
  const arena=new Arena(scene,{scene:source},{});
  const placements:any[]=[];
  arena.place=(name:any,x:any,z:any,ry=0,s=1)=>{if(expected.propNames.has(name))placements.push([name,x,z,ry,s]);return new THREE.Group();};
  const before=JSON.stringify([floor.mask,floor.inner,floor.rooms,floor.corridors,floor.gates]);
  let sourceDisposed=0; geometry.addEventListener('dispose',()=>sourceDisposed++); material.addEventListener('dispose',()=>sourceDisposed++);
  arena.buildFloor(floor,theme);
  expect(arena.group.userData.dungeonWalls.legacyVariantDraws).toBe(expected.draws);
  expect(placements).toEqual(expected.placements);
  expect(JSON.stringify([floor.mask,floor.inner,floor.rooms,floor.corridors,floor.gates])).toBe(before);
  expect(arena.group.children.some(child=>child.userData.dungeonWall)).toBe(true);
  placements.length=0; arena.buildFloor(floor,theme);
  expect(placements).toEqual(expected.placements);
  arena.clear(); arena.clear(); expect(sourceDisposed).toBe(0);
  expect(arena.group.userData.dungeonWalls).toBeUndefined();
  geometry.dispose(); material.dispose();
});

function openCellOverlaps(arena: Arena, floor: any, mask = floor.architectureMask) {
  const overlaps: any[] = [], matrix = new THREE.Matrix4();
  arena.group.updateMatrixWorld(true);
  for (const mesh of arena.group.children as THREE.InstancedMesh[]) {
    if (!mesh.userData.dungeonWall) continue;
    for (const entry of mesh.userData.dungeonWall.instances) {
      mesh.getMatrixAt(entry.index, matrix); matrix.premultiply(mesh.matrixWorld);
      const box = new THREE.Box3().setFromBufferAttribute(positionAttribute(mesh.geometry)).applyMatrix4(matrix);
      // 구현의 바깥 방향 탐색과 독립적으로 모든 open 셀을 대조한다.
      for (let z = 0; z < floor.rows; z++) for (let x = 0; x < floor.cols; x++) {
        if (!mask[z * floor.cols + x]) continue;
        const left = floor.minX + x, top = floor.minZ + z;
        const dx = Math.min(box.max.x, left + 1) - Math.max(box.min.x, left);
        const dz = Math.min(box.max.z, top + 1) - Math.max(box.min.z, top);
        if (dx > 1e-5 && dz > 1e-5) overlaps.push({ x, z, variant: mesh.userData.dungeonWall.sourceName, dx, dz });
      }
    }
  }
  return overlaps;
}

const measuredDepths = { wall: .9998466249850002, wall_cracked: 1.2593601658620002,
  wall_arched: .9998466249850002, wall_window_open: .9998466249850002, wall_broken: .9998466249850002 };
function measuredWallAssets() {
  const source = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (const [name, depth] of Object.entries(measuredDepths)) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.000378903538, 4.000378903538, depth), material);
    mesh.name = name; source.add(mesh);
  }
  return { source, material };
}

for (const axis of ['x', 'z']) test(axis + ': 1m 홈은 네 방향의 반대 open 셀도 보호하고 실제 원본 두께를 유지한다', () => {
  const floor = { minX: -3.37, minZ: -8.21, cols: 7, rows: 7, seed: 1, architectureMask: new Uint8Array(49).fill(1) };
  for (let i = 0; i < 7; i++) floor.architectureMask[axis === 'x' ? i * 7 + 3 : 3 * 7 + i] = 0;
  const before = Array.from(floor.architectureMask);
  const { source, material } = measuredWallAssets(), arena = new Arena(new THREE.Scene(), { scene: source }, {});
  const segments = collectDungeonWallSegments(floor).map(s => ({ ...s, variant: 'wall_cracked' }));
  const positions = source.children.map((m: any) => Array.from(m.geometry.attributes.position.array));
  // 음성 대조: 안쪽 면만 맞추던 기존 배치는 일반 벽도 5mm, 돌출 벽은 약26cm 침범한다.
  for (const name of ['wall', 'wall_cracked']) {
    arena.instanced(name, segments, undefined, { alignedWall: true });
    expect(openCellOverlaps(arena, floor).length).toBeGreaterThan(0); arena.clear();
  }
  const fitted: FittedWallSegment[] = fitDungeonWallSegments(floor, segments, measuredDepths);
  for (const name of Object.keys(measuredDepths)) arena.instanced(name, fitted.filter(s => s.variant === name), undefined, { alignedWall: true });
  expect(openCellOverlaps(arena, floor)).toEqual([]);
  const changed = fitted.filter(s => s.variant === 'wall');
  expect(changed.length).toBeGreaterThan(0);
  expect(new Set(changed.map(s => axis === 'x' ? s.normalX : s.normalZ))).toEqual(new Set([-1, 1]));
  expect(changed.every(s => s.clearance > 0 && s.clearance < .0001)).toBe(true);
  expect(fitted.some(s => s.variant === 'wall_cracked' && s.clearance === DUNGEON_WALL_CLEARANCE)).toBe(true);
  for (const mesh of arena.group.children as THREE.InstancedMesh[]) {
    const data = mesh.userData.dungeonWall;
    const sourceMesh = source.getObjectByName(data.sourceName) as THREE.Mesh;
    expect(mesh.geometry).toBe(sourceMesh.geometry);
    expect(data.sourceDimensions.depth).toBeCloseTo(measuredDepths[data.sourceName as keyof typeof measuredDepths], 6);
    expect(data.sourceDimensions.height).toBeCloseTo(4.000378903538, 6);
  }
  expect(source.children.map((m: any) => Array.from(m.geometry.attributes.position.array))).toEqual(positions);
  expect(Array.from(floor.architectureMask)).toEqual(before);
  expect(() => fitDungeonWallSegments(floor, segments, { wall: 1.3, wall_cracked: 1.3 })).toThrow();
  arena.clear(); for (const m of source.children as THREE.Mesh[]) m.geometry.dispose(); material.dispose();
});

for (const [theme, seed] of [['garden', 19], ['crypt', 182]] as const) test(theme + ' seed ' + seed + ': 실제 생성 1m 홈은 전 open 셀과 겹치지 않는다', () => {
  const floor = new Floor(1, theme, seed), { source, material } = measuredWallAssets();
  assertBuiltFloor(floor);
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x111111);
  const arena = new Arena(scene, { scene: source }, {});
  arena.buildFloor(floor, theme);
  expect(openCellOverlaps(arena, floor)).toEqual([]);
  const bounded = arena.group.children.some(mesh => mesh.userData.dungeonWall?.instances.some((entry: any) => entry.clearance < DUNGEON_WALL_CLEARANCE));
  // garden의 홈은 남지만 crypt182의 기존 1m 홈은 봉인 해제 때 문 영역으로 열린다.
  const recess = 16 * floor.cols + 69;
  if (theme === 'crypt') {
    const terrain = new Uint8Array(floor.mask.length);
    for (const rect of [...floor.rooms, ...floor.corridors]) floor.fillRect(rect, 1, terrain);
    expect(terrain[recess]).toBe(0);
    expect(terrain[recess - 1]).toBe(1); expect(terrain[recess + 1]).toBe(1);
    expect(floor.mask[recess]).toBe(0);
    expect(floor.architectureMask[recess]).toBe(1);
    expect(bounded).toBe(false);
  } else expect(bounded).toBe(true);
  floor.unseal();
  expect(openCellOverlaps(arena, floor, floor.mask)).toEqual([]);
  if (theme === 'crypt') expect(floor.mask[recess]).toBe(1);
  arena.clear(); for (const m of source.children as THREE.Mesh[]) m.geometry.dispose(); material.dispose();
});

test('컨셉 봉인은 문 사각형의 바깥 셀을 건축·이동 영역에 추가하지 않는다', () => {
  const floor = new Floor(1, 'garden', 19);
  floor.layout = { ...floor.layout, concept: true };
  floor.buildMask();
  assertBuiltFloor(floor);
  const architecture = Array.from(floor.architectureMask);
  floor.unseal();
  expect(Array.from(floor.mask)).toEqual(architecture);
  expect(Array.from(floor.architectureMask)).toEqual(architecture);
});
