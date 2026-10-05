import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import DATA from '../src/data/jade-tactics-geometry-v1.json';
import { MapTacticsView } from '../src/game/map-tactics-view.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createMapTactics } from '../src/game/map-tactics.js';
import { Floor } from '../src/game/world.js';

const nodes = [-1,1].map((side,i) => ({ id:i ? 'release' : 'gather', side,
  operator:{ x:side * 4.5,y:0,z:-2.5 }, anchor:{ x:side * 4.5,y:0,z:-.5 },
  operatorRadius:1.4,effectRadius:6 }));
const room = { id:3,x:0,z:0,w:22,h:26 };
const View = MapTacticsView as unknown as new (scene:THREE.Scene,authoredNodes:typeof nodes,
  ownerRoom:typeof room,floor:{walkable:(x:number,z:number)=>boolean}) => MapTacticsView;
const meshes = (view:MapTacticsView) => view.group.children.filter(child => child instanceof THREE.Mesh) as THREE.Mesh[];
const triangles = (view:MapTacticsView) => meshes(view).reduce((sum,mesh) => sum +
  (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,0);
const hash = (value:string | Buffer) => createHash('sha256').update(value).digest('hex');

test('original Blender backing data binds its reproducible source and finite RGB geometry to three roles', () => {
  expect(hash(readFileSync(new URL('../tools/art/build-jade-tactics-v1.py',import.meta.url))))
    .toBe(DATA.provenance.sourceSha256);
  expect(DATA.provenance.thirdPartyMeshesOrTextures).toBe(false);
  expect(DATA.provenance.trellisUsed).toBe(false);
  expect(DATA.backingTriangleTotal).toBe(796);
  for (const [id,model] of Object.entries(DATA.models)) {
    expect(model.triangles).toBe(id === 'gather' ? 508 : 288);
    expect(model.surfaces.map(surface => surface.role)).toEqual([0,1,2]);
    expect(model.bounds.max[0] - model.bounds.min[0]).toBeLessThanOrEqual(2.2);
    expect(model.bounds.max[2] - model.bounds.min[2]).toBeLessThanOrEqual(1.1);
    expect(model.bounds.min[1]).toBe(0);
    expect(model.bounds.max[1]).toBeLessThanOrEqual(2.901);
    let total = 0;
    for (const surface of model.surfaces) {
      const vertices = surface.position.length / 3;
      expect(surface.normal.length).toBe(surface.position.length);
      expect(surface.color.length).toBe(surface.position.length);
      expect([...surface.position,...surface.normal,...surface.color].every(Number.isFinite)).toBe(true);
      expect(surface.color.every(value => value >= 0 && value <= 1)).toBe(true);
      expect(surface.index.every(value => Number.isInteger(value) && value >= 0 && value < vertices)).toBe(true);
      expect(surface.index.length % 3).toBe(0);
      total += surface.index.length / 3;
    }
    expect(total).toBe(model.triangles);
  }
});

test('actual models merge into six existing view submissions without additional material features or authority changes', () => {
  const scene = new THREE.Scene(), originalNodes = JSON.stringify(nodes), originalData = hash(JSON.stringify(DATA));
  const floor = { walkable:(x:number,z:number) => Math.abs(x) <= 11 && Math.abs(z) <= 13 };
  const view = new View(scene,nodes,room,floor);
  expect(view.group.userData.artContract.sourceSha256).toBe(DATA.provenance.sourceSha256);
  expect(meshes(view)).toHaveLength(6);
  expect(triangles(view)).toBe(1126);
  expect(triangles(view)).toBeLessThanOrEqual(1600); // 이 두 원본 조형의 국소 예산이다. 전역 성능 기준은 별도다.
  const authored = meshes(view).filter(mesh => mesh.material instanceof THREE.MeshStandardMaterial);
  expect(authored).toHaveLength(3);
  for (const mesh of authored) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true); expect(material.side).toBe(THREE.FrontSide);
    expect(material.transparent).toBe(false); expect(material.opacity).toBe(1);
    expect([material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.emissiveMap]).toEqual([null,null,null,null,null]);
    expect(mesh.geometry.getAttribute('color').itemSize).toBe(3);
    expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(true);
    expect(mesh.geometry.morphAttributes).toEqual({});
  }
  for (const backing of view.group.userData.artContract.backingFootprints) {
    expect(backing.maskChecked).toBe(true); expect(backing.location).not.toBeNull();
    const model = DATA.models[backing.id as keyof typeof DATA.models];
    for (const surface of model.surfaces) {
      expect(surface.position.every((value,index,array) => index % 3 !== 0 ||
        !floor.walkable(value + backing.location.x,array[index + 2] + backing.location.z))).toBe(true);
    }
  }
  view.update({ roomDiscovered:true,phase:'ready',selectedId:null,nearbyId:'gather',used:false,actionable:true });
  expect(view.boundary.visible).toBe(true);
  expect(view.boundary.position.x).toBe(nodes[0].anchor.x);
  expect(view.boundary.position.z).toBe(nodes[0].anchor.z);
  expect(JSON.stringify(nodes)).toBe(originalNodes);
  const geometryDisposals = new Map<THREE.BufferGeometry,number>(), materialDisposals = new Map<THREE.Material,number>();
  for (const geometry of view.geometries) geometry.addEventListener('dispose',() => geometryDisposals.set(geometry,(geometryDisposals.get(geometry) ?? 0) + 1));
  for (const material of view.materials) material.addEventListener('dispose',() => materialDisposals.set(material,(materialDisposals.get(material) ?? 0) + 1));
  view.dispose(); view.dispose();
  expect([...geometryDisposals.values()]).toEqual([1,1,1,1,1]);
  expect([...materialDisposals.values()]).toEqual([1,1,1,1,1,1]);
  expect(scene.children).toHaveLength(0); expect(hash(JSON.stringify(DATA))).toBe(originalData);
});

test('complete blocked footprints omit tall backings while control surfaces and exact effect anchor survive', () => {
  const view = new View(new THREE.Scene(),nodes,room,{ walkable:() => true });
  expect(view.group.userData.artContract.backingFootprints.every((entry:{location:unknown}) => entry.location === null)).toBe(true);
  expect(meshes(view)).toHaveLength(5); expect(triangles(view)).toBe(326);
  view.update({ roomDiscovered:true,phase:'active',selectedId:'release',nearbyId:null,used:true,actionable:false });
  expect(view.boundary.position.x).toBe(nodes[1].anchor.x);
  expect(view.boundary.position.z).toBe(nodes[1].anchor.z);
  expect(view.boundary.visible).toBe(true);
  view.dispose();
});


test('farther fallback preserves the original first safe rear placement', () => {
  const floor = { walkable:(x:number,z:number) => Math.abs(x) <= 11 && Math.abs(z) <= 13 };
  const view = new View(new THREE.Scene(),nodes,room,floor);
  expect(view.group.userData.artContract.backingFootprints.map((backing:{id:string,location:{x:number,z:number}}) =>
    ({ id:backing.id,location:backing.location }))).toEqual(nodes.map(node => ({
      id:node.id,location:{ x:node.operator.x,z:room.z - room.h / 2 - 1.25 },
    })));
  expect(triangles(view)).toBe(1126);
  view.dispose();
});

test('actual quantized Garden Floor recovers both backings outside every walkable footprint cell', () => {
  const stage = buildExpeditionStage('dungeon','glass_garden',null), world = buildExpeditionWorld(stage);
  expect(world).toBeInstanceOf(Floor);
  expect(world.seed).toBe(3944785920);
  expect(world.rooms).toHaveLength(5); expect(world.corridors).toHaveLength(10);
  const tactics = createMapTactics(stage,world)!, ownerRoom = tactics.room;
  // 원래 actual FAIL은 이 좌표의 셀 확장 때문에 첫 세 후보를 모두 거부했다.
  expect([ownerRoom.id,ownerRoom.x,ownerRoom.z,ownerRoom.w,ownerRoom.h]).toEqual([
    3,-1.8001625938341022,-61.745415890589356,16,24,
  ]);
  expect([world.minX,world.minZ]).toEqual([-75.40300032775849,-103.71773242298514]);
  const gather = tactics.nodes[0], release = tactics.nodes[1], rear = ownerRoom.z - ownerRoom.h / 2 - 1.25;
  const dxs = [-1.1,-.825,-.55,-.275,0,.275,.55,.825,1.1], dzs = [-.55,-.275,0,.275,.55];
  const footprintOutside = (location:{x:number,z:number}) => dxs.every(dx =>
    dzs.every(dz => !world.walkable(location.x + dx,location.z + dz)));
  const originalCandidates = [
    { x:gather.operator.x,z:rear },
    { x:ownerRoom.x + gather.side * (ownerRoom.w / 2 + 1.6),z:gather.operator.z },
    { x:ownerRoom.x + gather.side * (ownerRoom.w / 2 + 1.6),z:rear },
  ];
  expect(originalCandidates.map(footprintOutside)).toEqual([false,false,false]);
  // 해석적 방 사각형 밖의 표본도 실제 fillRect 셀에서는 이동 가능하다.
  const quantizedWitness = { x:-10.300162593834102,z:-64.79541589058935 };
  expect(quantizedWitness.x).toBeLessThan(ownerRoom.x - ownerRoom.w / 2);
  expect(world.walkable(quantizedWitness.x,quantizedWitness.z)).toBe(true);
  const fallback = { x:ownerRoom.x + gather.side * (ownerRoom.w / 2 + 2.6),z:gather.operator.z };
  expect(footprintOutside(fallback)).toBe(true);
  if (!world.mask || !world.inner) throw new Error('실제 정원의 이동·내부 마스크가 생성되어야 한다.');
  const originalNodes = JSON.stringify(tactics.nodes), originalMask = hash(Buffer.from(world.mask)), originalInner = hash(Buffer.from(world.inner));
  const originalWorld = JSON.stringify({ rooms:world.rooms,corridors:world.corridors,gates:world.gates,sealed:world.sealed });
  const scene = new THREE.Scene(), view = new View(scene,[...tactics.nodes],ownerRoom,world);
  type Backing = {id:'gather'|'release',location:{x:number,z:number}|null,maskChecked:boolean};
  const backings:Backing[] = view.group.userData.artContract.backingFootprints;
  expect(backings).toEqual([
    { id:'gather',location:fallback,maskChecked:true },
    { id:'release',location:{ x:ownerRoom.x + release.side * (ownerRoom.w / 2 + 1.6),z:rear },maskChecked:true },
  ]);
  expect(meshes(view)).toHaveLength(6); expect(triangles(view)).toBe(1126);
  expect(triangles(view)).toBeLessThanOrEqual(1600);
  expect(view.group.userData.artContract.maximumDraws).toBe(6);
  expect(view.group.userData.artContract.maximumBackingTriangles).toBe(796);
  expect(view.group.userData.artContract.operatorRadius).toBe(1.4);
  expect(view.group.userData.artContract.effectRadius).toBe(6);
  for (const backing of backings) {
    expect(backing.location).not.toBeNull();
    const location = backing.location!;
    expect(footprintOutside(location)).toBe(true);
    for (const surface of DATA.models[backing.id].surfaces) {
      expect(surface.position.every((value,index,array) => index % 3 !== 0 ||
        !world.walkable(value + location.x,array[index + 2] + location.z))).toBe(true);
    }
  }
  for (const entry of view.entries) {
    expect(entry.pad.position.toArray()).toEqual([entry.node.operator.x,.095,entry.node.operator.z]);
    expect(entry.pad.geometry).toBeInstanceOf(THREE.RingGeometry);
    const pad = entry.pad.geometry as THREE.RingGeometry;
    expect([pad.parameters.innerRadius,pad.parameters.outerRadius]).toEqual([entry.node.operatorRadius - .09,entry.node.operatorRadius]);
  }
  expect(view.boundary.geometry).toBeInstanceOf(THREE.RingGeometry);
  const boundary = view.boundary.geometry as THREE.RingGeometry;
  expect([boundary.parameters.innerRadius,boundary.parameters.outerRadius]).toEqual([6 - .055,6]);
  view.update({ roomDiscovered:true,phase:'ready',selectedId:null,nearbyId:'gather',used:false,actionable:true });
  expect(view.group.visible).toBe(true);
  expect(meshes(view).filter(mesh => mesh.material instanceof THREE.MeshStandardMaterial)).toHaveLength(3);
  expect(meshes(view).filter(mesh => mesh.material instanceof THREE.MeshStandardMaterial).every(mesh => mesh.visible)).toBe(true);
  expect(view.boundary.position.x).toBe(gather.anchor.x); expect(view.boundary.position.z).toBe(gather.anchor.z);
  view.dispose(); view.dispose();
  expect(scene.children).toHaveLength(0);
  expect(JSON.stringify(tactics.nodes)).toBe(originalNodes);
  expect(hash(Buffer.from(world.mask))).toBe(originalMask); expect(hash(Buffer.from(world.inner))).toBe(originalInner);
  expect(JSON.stringify({ rooms:world.rooms,corridors:world.corridors,gates:world.gates,sealed:world.sealed })).toBe(originalWorld);
});
