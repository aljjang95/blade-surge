import { expect, test } from 'bun:test';
import { Floor, REGION_LAYOUTS } from '../src/game/world.js';

test('garden side chapels form walkable alternative loops without moving the terminal boss',()=>{
  const layout=REGION_LAYOUTS.garden;
  expect(layout.cells.length).toBe(13);
  expect(layout.cells[10]).toEqual([1,4]);
  expect(layout.cells.slice(11)).toEqual([[0,3],[2,3]]);
  for(const [a,b] of layout.edges) {
    expect(Math.abs(layout.cells[a][0]-layout.cells[b][0])+Math.abs(layout.cells[a][1]-layout.cells[b][1])).toBe(1);
  }
  for(let stage=1;stage<=10;stage++) {
    const floor=new Floor(stage,'garden');
    expect(floor.rooms.length).toBe(13);
    expect(floor.bossRoom.id).toBe(10);
    expect(floor.bossRoom.pathLen).toBe(Math.max(...floor.rooms.map(r=>r.pathLen)));
    expect(floor.bossRoom.links).toEqual([9]);
    expect(floor.rooms[11].links!.slice().sort((a:number,b:number)=>a-b)).toEqual([6,9]);
    expect(floor.rooms[12].links!.slice().sort((a:number,b:number)=>a-b)).toEqual([4,9]);
    expect(floor.rooms[11].type).not.toBe('start');expect(floor.rooms[12].type).not.toBe('start');
    const at=(r:any)=>Math.floor(r.z-floor.minZ!)*floor.cols!+Math.floor(r.x-floor.minX!);
    const flow=floor.buildFlow(floor.startRoom.x,floor.startRoom.z)!;
    for(const room of floor.rooms) expect(flow[at(room)]>=0).toBe(room.id!==10);
    expect(floor.sealed).toBe(true);expect(floor.gates!.length).toBe(1);
    floor.unseal();expect(floor.sealed).toBe(false);
    const open=floor.buildFlow(floor.bossRoom.x,floor.bossRoom.z)!;
    for(const room of floor.rooms) expect(open[at(room)]).toBeGreaterThanOrEqual(0);
    // Every corridor belongs to its two endpoints only; no shortcut tunnels through another room.
    layout.edges.forEach(([a,b],edgeIndex)=>{
      for(const corridor of floor.corridors.slice(edgeIndex*2,edgeIndex*2+2)) for(const room of floor.rooms) {
        if(room.id===a||room.id===b) continue;
        const overlaps=Math.abs(corridor.x-room.x)<(corridor.w+room.w)/2 && Math.abs(corridor.z-room.z)<(corridor.h+room.h)/2;
        expect(overlaps).toBe(false);
      }
    });
  }
});
