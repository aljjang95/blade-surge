import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Floor, REGION_LAYOUTS } from '../src/game/world.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { Arena } from '../src/game/arena.js';

const themes = ['garden', 'forge', 'frost', 'tide', 'crown'];
const cell = (floor: any, room: any) => Math.floor(room.z-floor.minZ)*floor.cols+Math.floor(room.x-floor.minX);
for (let chapter=0;chapter<5;chapter++) {
  for(let stage=1;stage<=10;stage++) {
    const index=chapter*10+stage, theme=themes[chapter];
    test(`${chapter+1}-${stage}: 시드 재현, 봉인 전 탐험, 해제 후 보스까지 AUTO 거리장 연결`, () => {
      const floor=new Floor(index,theme), repeat=new Floor(index,theme);
      expect(floor.rooms).toEqual(repeat.rooms);
      expect(floor.corridors).toEqual(repeat.corridors);
      expect(floor.rooms.length).toBeGreaterThanOrEqual(11);
      expect(floor.bossRoom.links.length).toBe(1);
      expect(floor.gates!.length).toBe(1);
      const before=floor.buildFlow(floor.startRoom.x,floor.startRoom.z);
      expect(before).not.toBeNull();
      for(const room of floor.rooms) {
        if(room===floor.bossRoom) expect(before![cell(floor,room)]).toBe(-1);
        else expect(before![cell(floor,room)]).toBeGreaterThanOrEqual(0);
      }
      floor.unseal();
      const after=floor.buildFlow(floor.bossRoom.x,floor.bossRoom.z);
      for(const room of floor.rooms) expect(after![cell(floor,room)]).toBeGreaterThanOrEqual(0);
    });
  }
}

test('다섯 지역은 서로 다른 배치와 방 비례를 사용한다', () => {
  const signatures = new Set(Object.values(REGION_LAYOUTS).map((layout: any) => JSON.stringify([layout.cells,layout.edges,layout.spacing,layout.size])));
  expect(signatures.size).toBe(5);
  const stageLayouts=new Set<string>();
  for(let chapter=0;chapter<5;chapter++) for(let stage=1;stage<=10;stage++) {
    const floor=new Floor(chapter*10+stage,themes[chapter]);
    stageLayouts.add(JSON.stringify(floor.rooms.map((r: any)=>[r.x,r.z,r.w,r.h])));
  }
  expect(stageLayouts.size).toBe(50);
});

for(const theme of themes) {
  test(`${theme}: 지역 건축은 방별 병합과 한 번의 자원 회수를 보장한다`, () => {
    const floor=new Floor(1,theme), group=buildRegionArchitecture(floor,theme);
    expect(group.userData.landmarks.length).toBe(floor.rooms.length);
    expect(group.children.length).toBeLessThanOrEqual(floor.rooms.length*3);
    expect(group.children.length).toBeGreaterThan(floor.rooms.length);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    group.traverse((node: THREE.Object3D) => {
      if(!(node instanceof THREE.Mesh)) return;
      geometries.add(node.geometry); materials.add(node.material as THREE.Material);
      expect(node.geometry.boundingSphere?.radius).toBeGreaterThan(0);
      expect(node.geometry.attributes.position.count).toBeGreaterThan(30);
    });
    let geometryDisposals=0, materialDisposals=0;
    geometries.forEach(g=>g.addEventListener('dispose',()=>geometryDisposals++));
    materials.forEach(m=>m.addEventListener('dispose',()=>materialDisposals++));
    const arena=new Arena(new THREE.Scene(),{scene:new THREE.Group()},{});
    arena.regionArchitecture=group; arena.group.add(group);
    arena.clear(); arena.clear();
    expect(geometryDisposals).toBe(geometries.size);
    expect(materialDisposals).toBe(materials.size);
    expect(group.parent).toBeNull();
  });
}
