import { expect, test } from 'bun:test';
import { EXPEDITION_DEPTHS, campaignFinished } from '../src/data/expedition-depths.js';
import { ENEMIES } from '../src/data/stages.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { Floor } from '../src/game/world.js';
import { Battle } from '../src/game/battle.js';

const cell = (w:any,r:any) => Math.floor(r.z-w.minZ)*w.cols+Math.floor(r.x-w.minX);
for (const d of EXPEDITION_DEPTHS) test(`${d.id}: deep routes preserve every objective and the boss seal`, () => {
  const stage = buildExpeditionStage('dungeon',d.id,{}, {depth:'deep'});
  const base = buildExpeditionStage('dungeon',d.id,{});
  expect(stage.expeditionEnemy.hp).toBe(d.bossHp);
  expect(stage.encounter.enemyId).not.toBe(base.encounter.enemyId);
  expect(stage.expeditionEnemy.pattern).not.toEqual(base.expeditionEnemy.pattern);
  expect(stage.finale).toBe(false); expect(stage.epilogueFinale).toBe(false); expect(stage.story).toBeNull();
  expect(buildExpeditionWorld(stage).rooms).toHaveLength(d.layout.cells.length);
  for (let seed=1;seed<=24;seed++) {
    const w=new Floor(stage.idx,stage.chapter.theme,seed*701,d.layout as any);
    const closed=w.buildFlow(w.startRoom.x,w.startRoom.z)!;
    for (const r of w.rooms) {
      expect(closed[cell(w,r)]>=0).toBe(r!==w.bossRoom);
      for (const id of expeditionRoster(stage,r)) expect((ENEMIES as Record<string,unknown>)[id]).toBeDefined();
    }
    w.unseal(); const open=w.buildFlow(w.bossRoom.x,w.bossRoom.z)!;
    for (const r of w.rooms) expect(open[cell(w,r)]).toBeGreaterThanOrEqual(0);
  }
});
test('only catalogued dungeon depths build and completed campaign uses the durable star record',()=>{
  expect(()=>buildExpeditionStage('dungeon','glass_garden',{}, {depth:'forged'})).toThrow();
  expect(()=>buildExpeditionStage('arena','rookie',{}, {depth:'deep'})).toThrow();
  expect(campaignFinished({stars:{'6-10':1}})).toBe(true);
  expect(campaignFinished({stars:{'6-10':0,'5-10':3}})).toBe(false);
  expect(campaignFinished({'6-10':3})).toBe(false);
});
test('deep cargo reinforcements queue overflow without clearing the room or losing enemies',()=>{
  const room:any={type:'elite',cleared:false}, enemies=Array.from({length:15},()=>({alive:true}));
  const g:any={stage:buildExpeditionStage('dungeon','ember_vault',{}, {depth:'deep'}),enemies,maxAlive:16,pending:[],ui:{waveBanner(){}},
    spawnEnemy(_id:string,_at:any,r:any){expect(r).toBe(room);enemies.push({alive:true});}};
  Battle.prototype.markCleared.call(g,room);
  expect(enemies).toHaveLength(16); expect(g.pending).toHaveLength(3);
  expect(g.pending.every((entry:any)=>entry.room===room&&(ENEMIES as Record<string,unknown>)[entry.t])).toBe(true);
  expect(room.forgeWave).toBe(1); expect(room.cleared).toBe(false);
});
