import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Floor } from '../src/game/world.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';

for(const theme of ['crypt','throne','abyss']) test(`${theme} tower has deterministic, navigationally inert authored rooms within draw budget`, () => {
  const floor = new Floor(4,theme), before = Array.from(floor.mask!);
  const rooms = JSON.stringify(floor.rooms), rng = floor.rand;
  const group=buildRegionArchitecture(floor,theme), repeat=buildRegionArchitecture(floor,theme);
  expect(group.children.length).toBeLessThanOrEqual(floor.rooms.length*3);
  expect(group.children.length).toBeGreaterThanOrEqual(floor.rooms.length*2);
  expect(group.userData.roomDetails.length).toBe(floor.rooms.length);
  expect(new Set(group.userData.roomDetails.map((d:any)=>d.role)).size).toBe(5);
  expect(group.userData.roomDetails.some((d:any)=>d.thresholds>0)).toBe(true);
  expect(group.userData.roomDetails.some((d:any)=>d.landmark)).toBe(true);
  let vertices=0;
  group.children.forEach((node,index) => {
    const mesh=node as THREE.Mesh, other=repeat.children[index] as THREE.Mesh;
    const p=mesh.geometry.attributes.position;
    vertices+=p.count;
    expect(Array.from(p.array)).toEqual(Array.from(other.geometry.attributes.position.array));
    expect(mesh.geometry.boundingSphere?.radius).toBeGreaterThan(0);
  });
  expect(vertices).toBeLessThan(floor.rooms.length*14000);
  expect(Array.from(floor.mask!)).toEqual(before);
  expect(JSON.stringify(floor.rooms)).toBe(rooms);
  expect(floor.rand).toBe(rng);
  const geometries = group.children.map(n=>(n as THREE.Mesh).geometry);
  let disposed=0;
  for(const geometry of geometries) geometry.addEventListener('dispose',()=>disposed++);
  group.userData.dispose(); group.userData.dispose(); repeat.userData.dispose();
  expect(disposed).toBe(geometries.length);
});

test('fully connected tower room has ground detail and no central tall obstruction', () => {
  const room={id:0,x:0,z:0,w:20,h:20,gx:0,gy:0,type:'normal',links:[1,2,3,4]};
  const neighbors=[[1,0],[-1,0],[0,1],[0,-1]].map(([gx,gy],i)=>({...room,id:i+1,gx,gy,x:gx*34,z:gy*34,links:[0]}));
  const group=buildRegionArchitecture({rooms:[room,...neighbors],corridors:[]},'crypt');
  const first=group.children.filter(n=>n.name.startsWith('crypt-room-0-')) as THREE.Mesh[];
  for(const mesh of first) {
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++) expect(p.getY(i)).toBeLessThan(.11);
  }
  expect(group.userData.roomDetails[0].landmark).toBe(false);
  group.userData.dispose();
});
