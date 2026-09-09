import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Battle } from '../src/game/battle.js';
import { DropSystem } from '../src/game/drops.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { stageDef } from '../src/data/stages.js';

function fixture(stage:any) {
  const inventory:any[]=[], drops:any[]=[], timers:any[]=[];
  const game:any=Object.create(Battle.prototype);
  Object.assign(game,{stage,app:{eco:{fieldDrop(rarity:string){const item={uid:`${inventory.length}`,id:'test',rarity};inventory.push(item);return item;}}},
    enemies:[],pending:[],maxAlive:16,curRoom:null,roomsCleared:0,world:{remaining:2},player:{pos:new THREE.Vector3(),forward(v:THREE.Vector3){return v.set(0,0,1);}},
    ui:{toast(){},waveBanner(){},setObjective(){},setFloorLabel(){}},fx:{groundTex(){},burst(){}},renderer:{shake(){}},
    after(t:number,fn:()=>void){timers.push({t,fn});},spawnEnemy(){},
  });
  const system:any=Object.create(DropSystem.prototype);
  Object.assign(system,{game,spawn(...args:any[]){drops.push(args);},gold:0,stones:0,stones2:0,stones3:0,fragments:0,loot:[],items:[]});
  game.drops=system;
  return {game,system,inventory,drops,timers};
}

for(const id of ['rookie','duelist','champion']) test(`${id}: entry, HP shedding, kills and every room reward create no arena inventory or drops`,()=>{
  const f=fixture(buildExpeditionStage('arena',id,{}));
  const room:any={id:1,type:'boss',x:32,z:0};
  f.game.enterRoom(room);
  for(const t of f.timers.splice(0)) t.fn();
  const enemy:any={pos:new THREE.Vector3(),def:{gold:100},isBoss:true,isElite:false};
  for(let i=0;i<4;i++) f.game.bossShed(enemy);
  f.system.onKill(enemy,f.game.stage);
  for(const type of ['normal','elite','treasure','boss']) f.game.markCleared({id:2,type,x:0,z:0});
  for(const table of ['normal','elite','boss']) expect(f.game.rollDrop(table)).toBeNull();
  expect(f.inventory).toHaveLength(0); expect(f.drops).toHaveLength(0);
});

test('arena drop boundary rejects every visual spawn and stale collection before allocation or counter changes',()=>{
  const f=fixture(buildExpeditionStage('arena','rookie',{}));
  // No rendering fixture needed: rejecting here must precede geometry allocation.
  for(const kind of ['gold','stone','stone2','stone3','frag','item']) {
    DropSystem.prototype.spawn.call(f.system,undefined as any,kind,{id:'test'} as any);
    DropSystem.prototype.collect.call(f.system,{kind,payload:100});
  }
  expect(f.system.items).toHaveLength(0); expect(f.system.loot).toHaveLength(0);
  expect([f.system.gold,f.system.stones,f.system.stones2,f.system.stones3,f.system.fragments]).toEqual([0,0,0,0,0]);
});

for(const stage of [stageDef(1,1),buildExpeditionStage('dungeon','glass_garden',{}),buildExpeditionStage('dungeon','ember_vault',{}),buildExpeditionStage('dungeon','star_archive',{})]) test(`${stage.code}: paid exploration retains actual inventory rolls and all boss drop categories`,()=>{
  const f=fixture(stage), enemy:any={pos:new THREE.Vector3(),def:{gold:20},isBoss:true,isElite:false};
  f.game.bossShed(enemy); f.system.onKill(enemy,stage);
  expect(f.inventory).toHaveLength(4);
  for(const kind of ['gold','stone','stone2','stone3','frag','item']) expect(f.drops.some(d=>d[1]===kind)).toBe(true);
});
