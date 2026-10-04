import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import DATA from '../src/data/jade-tactics-geometry-v1.json';
import { MapTacticsView } from '../src/game/map-tactics-view.js';

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
