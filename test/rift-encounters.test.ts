import {expect,test,spyOn,afterEach,mock} from 'bun:test';
import * as THREE from 'three';
import {DUNGEONS} from '../src/data/expansion.js';
import {riftForDay,applyRiftStage,applyRiftEnemy} from '../src/game/journey-rifts.js';
import {RiftEncounters,RIFT_REINFORCEMENT} from '../src/game/rift-encounters.js';
import {Battle} from '../src/game/masterworks-battle.js';
import {Battle as RpgBattle} from '../src/game/rpg-battle.js';
import {postureHit,tickPosture} from '../src/game/masterworks-combat.js';
afterEach(()=>mock.restore());
const noop=()=>{};
function fixture(rule:string){
 const room={x:0,z:0,type:'normal',spawned:true,cleared:false};
 const enemy:any={alive:true,spawning:false,homeRoom:room,pos:new THREE.Vector3(4,0,0),def:{ranged:true},hp:1000,maxHp:1000,stun:0,breakT:0,hurt(d:number){this.hp-=d;return d;}};
 const hurt=mock(()=>80),toast=mock(()=>{}),game:any={scene:new THREE.Scene(),stage:{riftId:rule,expedition:{kind:'dungeon',id:'glass_garden'},rosterFor:()=>({trash:['skel_minion']})},active:true,paused:false,run:{enabled:true,settled:false},world:{roomAt:()=>room},
 player:{alive:true,pos:new THREE.Vector3(),maxHp:1000,hurt},enemies:[enemy],pending:[],maxAlive:4,ui:{toast},spawnEnemy:mock(()=>{})};
 const runtime=new RiftEncounters(game);return {game,room,enemy,runtime,hurt,toast};
}
test('each nine-day window visits all nine dungeon/rule pairs; serialized ticket never rerolls',()=>{
 for(const start of [0,1,7,12345]){
  const pairs=new Set(Array.from({length:9},(_,i)=>`${DUNGEONS[(start+i)%3].id}:${riftForDay(start+i).id}`));expect(pairs.size).toBe(9);
 }
 const base:any={title:'정원',objective:'정화',expedition:{kind:'dungeon',id:'glass_garden'}};
 const ticket=JSON.parse(JSON.stringify({target:'glass_garden',riftId:riftForDay(0).id,journeyPeriod:{day:0}}));
 expect(riftForDay(3).id).not.toBe(ticket.riftId);
 expect(applyRiftStage(base,ticket).riftId).toBe('iron');
 expect(applyRiftStage(base,{...ticket,target:'ember_vault'})).toBe(base);
 expect(applyRiftStage({...base,party:{}},ticket)).not.toHaveProperty('riftId');
});
test('iron blocks hits until actual posture BREAK and reapplies after the window without stacking',()=>{
 const {game,enemy,runtime}=fixture('iron');applyRiftEnemy(enemy,game.stage);applyRiftEnemy(enemy,game.stage);
 expect(enemy.hurt(100)).toBeCloseTo(55);
 for(let i=0;i<3;i++)postureHit(enemy,enemy.hurt(10),{finisher:true});
 expect(enemy.breakT).toBeGreaterThan(0);expect(enemy.hurt(100)).toBe(100);
 tickPosture(enemy,3);expect(enemy.hurt(100)).toBeCloseTo(55);expect(enemy.maxHp).toBe(1000);runtime.dispose();
});
test('fury uses a fixed visible disk and exact hit boundary, one impact only',()=>{
 const {runtime,game,hurt}=fixture('fury');runtime.update(3);
 expect(runtime.warning).not.toBeNull();expect(runtime.disk.visible).toBe(true);
 expect(runtime.disk.geometry.parameters.radius).toBe(3);expect(runtime.warning!.radius).toBe(3);
 game.player.pos.x=3;runtime.update(1.39);expect(hurt).not.toHaveBeenCalled();runtime.update(.01);expect(hurt).toHaveBeenCalledTimes(1);
 expect(runtime.warning!.x).toBe(0);runtime.update(.2);expect(hurt).toHaveBeenCalledTimes(1);runtime.dispose();
});
test('fury avoidance opens caster counter window; pause, death, exit and teardown cancel safely',()=>{
 const {runtime,game,enemy,hurt,room}=fixture('fury');runtime.update(3);
 game.paused=true;runtime.update(10);expect(runtime.warning!.age).toBe(0);expect(hurt).not.toHaveBeenCalled();
 game.paused=false;game.player.pos.x=3.01;runtime.update(1.4);expect(hurt).not.toHaveBeenCalled();expect(enemy.breakT).toBe(2.5);
 runtime.update(.4);runtime.update(7);expect(runtime.warning).not.toBeNull();enemy.alive=false;runtime.update(.1);expect(runtime.warning).toBeNull();
 enemy.alive=true;runtime.update(7);room.cleared=true;runtime.update(2);expect(runtime.warning).toBeNull();
 let disposed=0;for(const mesh of [runtime.disk,runtime.edge,runtime.marker]){mesh.material.addEventListener('dispose',()=>disposed++);mesh.geometry.addEventListener('dispose',()=>disposed++);}
 runtime.dispose();runtime.dispose();expect(disposed).toBe(6);expect(game.scene.children).toHaveLength(0);
});
test('siege marks a priority target; killing it cancels reinforcements permanently for that room',()=>{
 const {runtime,enemy,game}=fixture('siege');runtime.update(.1);expect(runtime.marker.visible).toBe(true);expect(runtime.leader).toBe(enemy);
 enemy.alive=false;runtime.update(8);expect(runtime.called).toBe(0);expect(game.pending).toHaveLength(0);expect(game.spawnEnemy).not.toHaveBeenCalled();runtime.dispose();
});
test('siege queues only two reinforcements once, waits at maxAlive, and freezes while paused',()=>{
 const {runtime,game,room}=fixture('siege');game.maxAlive=1;runtime.update(.1);game.paused=true;runtime.update(100);expect(game.pending).toHaveLength(0);
 game.paused=false;runtime.update(5);expect(game.pending).toHaveLength(2);expect(game.pending.every((n:any)=>n.room===room&&n.t===RIFT_REINFORCEMENT+'skel_minion')).toBe(true);
 runtime.update(100);expect(game.pending).toHaveLength(2);expect(runtime.called).toBe(2);
 game.maxAlive=3;runtime.update(.1);expect(game.spawnEnemy).toHaveBeenCalledTimes(1);expect(game.pending).toHaveLength(1);runtime.dispose();
});
test('siege room reentry preserves its herald and remaining timer without another wave',()=>{
 const {runtime,game,room,enemy}=fixture('siege');game.maxAlive=1;runtime.update(2);
 game.world.roomAt=()=>null;runtime.update(10);expect(runtime.marker.visible).toBe(false);
 game.world.roomAt=()=>room;runtime.update(1);expect(runtime.leader).toBe(enemy);expect(runtime.countdown).toBe(2);
 runtime.update(2);expect(runtime.called).toBe(2);expect(game.pending).toHaveLength(2);
 game.world.roomAt=()=>null;runtime.update(1);game.world.roomAt=()=>room;runtime.update(10);
 expect(runtime.called).toBe(2);expect(game.pending).toHaveLength(2);runtime.dispose();
});

test('real reinforcement spawn hook preserves capacity and marks XP-free enemies',()=>{
 const {game,room,runtime}=fixture('siege');const created:any={maxHp:100,hp:100,atk:10};
 const spawn=spyOn(RpgBattle.prototype,'spawnEnemy').mockReturnValue(created);
 game.maxAlive=1;Battle.prototype.spawnEnemy.call(game,RIFT_REINFORCEMENT+'skel_minion',null,room);expect(spawn).not.toHaveBeenCalled();expect(game.pending).toHaveLength(1);
 game.maxAlive=2;expect(Battle.prototype.spawnEnemy.call(game,RIFT_REINFORCEMENT+'skel_minion',null,room)).toBe(created);expect(created.riftReinforcement).toBe(true);expect(created.xpReward).toBe(0);expect(created.summoned).toBe(true);runtime.dispose();
});
test('real death hook gives reinforcement no rewards and clears room once after all pending finish',()=>{
 const {game,enemy,room,runtime}=fixture('siege');enemy.alive=false;enemy.riftReinforcement=true;
 const baseDeath=spyOn(RpgBattle.prototype,'onEnemyDeath').mockImplementation(noop);
 game.runKills=new WeakSet();game.after=mock(noop);game.markCleared=mock((r:any)=>{r.cleared=true;});game.pending=[{t:'skel_minion',room}];
 Battle.prototype.onEnemyDeath.call(game,enemy);expect(baseDeath).not.toHaveBeenCalled();expect(game.markCleared).not.toHaveBeenCalled();
 game.pending=[];const second={...enemy};game.enemies=[second];Battle.prototype.onEnemyDeath.call(game,second);Battle.prototype.onEnemyDeath.call(game,second);
 expect(baseDeath).not.toHaveBeenCalled();expect(game.markCleared).toHaveBeenCalledTimes(1);runtime.dispose();
});
test('a stale reinforcement death from an old battle cannot clear a room in the new run',()=>{
 const {game,enemy,runtime}=fixture('siege');enemy.alive=false;enemy.riftReinforcement=true;game.enemies=[];game.runKills=new WeakSet();game.markCleared=mock(noop);game.after=mock(noop);
 Battle.prototype.onEnemyDeath.call(game,enemy);expect(game.markCleared).not.toHaveBeenCalled();expect(game.after).not.toHaveBeenCalled();runtime.dispose();
});
test('party and arena enemies keep original damage and have no encounter behavior',()=>{
 for(const stage of [{riftId:'iron',party:{},expedition:{kind:'dungeon'}},{riftId:'iron',expedition:{kind:'arena'}}]){
  const enemy={hurt:(d:number)=>d};applyRiftEnemy(enemy,stage);expect(enemy.hurt(100)).toBe(100);
  const {game,runtime}=fixture('siege');runtime.dispose();game.stage=stage;const off=new RiftEncounters(game);off.update(100);expect(off.called).toBe(0);expect(off.warning).toBeNull();off.dispose();
 }
});
