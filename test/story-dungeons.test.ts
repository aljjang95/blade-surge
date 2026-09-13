import { expect, test } from 'bun:test';
import { CHAPTERS, stageDef } from '../src/data/stages.js';
import { STORY_DUNGEONS } from '../src/data/story-dungeons.js';
import { Floor } from '../src/game/world.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { dungeonBriefHtml, resultStoryHtml, journalHtml } from '../src/ui/campaign.js';
const cell = (f: any, r: any) => Math.floor(r.z-f.minZ)*f.cols+Math.floor(r.x-f.minX);
for(const chapter of CHAPTERS) for(let st=1;st<=10;st++) {
  test(`${chapter.id}-${st}: authored route sealed exploration, boss unlock and all AUTO goals`, () => {
    const stage=stageDef(chapter.id,st), floor=new Floor(stage.idx,chapter.theme,undefined,stage.dungeon.layout);
    const repeat=new Floor(stage.idx,chapter.theme,undefined,stage.dungeon.layout);
    expect(repeat.rooms).toEqual(floor.rooms);
    expect(floor.rooms.length).toBe(stage.dungeon.layout.cells.length);
    expect(floor.bossRoom.id).toBe(floor.rooms.length-1);
    expect(floor.bossRoom.links.length).toBe(1);
    expect(floor.gates!.length).toBe(1);
    expect(floor.rooms.filter(r=>r.type==='treasure')).toHaveLength(1);
    const before=floor.buildFlow(floor.startRoom.x,floor.startRoom.z)!;
    for(const room of floor.rooms) {
      expect(room.label.length).toBeGreaterThan(0);
      expect(floor.walkable(room.x,room.z)).toBe(true);
      if(room===floor.bossRoom) expect(before[cell(floor,room)]).toBe(-1);
      else expect(before[cell(floor,room)]).toBeGreaterThanOrEqual(0);
    }
    floor.unseal();
    for(const target of floor.rooms) {
      const flow=floor.buildFlow(target.x,target.z)!;
      for(const room of floor.rooms) expect(flow[cell(floor,room)]).toBeGreaterThanOrEqual(0);
    }
  });
}
test('six routes have distinct graphs, geometry and story landmarks used by real campaign stages', () => {
  const maps=Object.values(STORY_DUNGEONS);
  expect(maps).toHaveLength(6);
  expect(new Set(maps.map(m=>JSON.stringify([m.layout.cells,m.layout.edges]))).size).toBe(6);
  expect(new Set(maps.map(m=>m.landmark)).size).toBe(6);
  const used=new Set(CHAPTERS.flatMap(c=>Array.from({length:10},(_,i)=>stageDef(c.id,i+1).dungeon.id)));
  expect(used.size).toBe(6);
  for(const map of maps) {
    const f=new Floor(51,'garden',undefined,map.layout as any), g=buildRegionArchitecture(f,'garden');
    expect(g.userData.landmarks.every((l:any)=>l.kind===map.landmark)).toBe(true);
    expect(g.userData.landmarks.map((l:any)=>l.label)).toEqual(f.rooms.map(r=>r.label));
    expect(g.children.length).toBeLessThanOrEqual(f.rooms.length*3);
    g.userData.dispose();
  }
});
test('briefing exposes route, journals preserve original ending and add earned epilogue', () => {
  const stage=stageDef(6,10);
  expect(dungeonBriefHtml(stage)).toContain(stage.dungeon.route);
  expect(resultStoryHtml(stage)).toContain('모두의 귀환');
  expect(journalHtml({stars:{'5-10':1}})).not.toContain('모두의 귀환');
  expect(journalHtml({stars:{'6-10':1}})).toContain('모두의 귀환');
});

for (const map of Object.values(STORY_DUNGEONS)) test(`${map.id}: AUTO radius collision simulation visits every room`, () => {
  const floor=new Floor(51,'garden',undefined,map.layout as any);
  let [x,z]=[floor.startRoom.x,floor.startRoom.z];
  const walkTo=(target:any) => {
    const flow=floor.buildFlow(target.x,target.z);
    let steps=0;
    while(Math.hypot(x-target.x,z-target.z)>1.3 && steps++<12000) {
      const dir=floor.flowDir(flow,x,z);
      expect(dir).not.toBeNull();
      if(!dir) break;
      [x,z]=floor.resolve(x,z,x+dir[0]*.13,z+dir[1]*.13,.56);
    }
    expect(Math.hypot(x-target.x,z-target.z)).toBeLessThanOrEqual(1.3);
  };
  for(const room of floor.rooms) if(room!==floor.bossRoom) walkTo(room);
  floor.unseal(); walkTo(floor.bossRoom);
});
