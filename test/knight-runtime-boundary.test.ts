import { expect, test } from 'bun:test';
import * as THREE from 'three';
import '../src/game/progression.js';
import { SKILLS } from '../src/game/skills.js';
import { applyKnightSlashVariant } from '../src/game/knight-builds.js';
function fixture() {
 const shots:any[]=[],timers:(()=>void)[]=[],hits:any[]=[];
 const p:any={alive:true,def:{id:'knight'},pos:new THREE.Vector3(),forward:(v:THREE.Vector3)=>v.set(0,0,1)};
 const g:any={active:true,paused:false,player:p,world:{},procs:new Set(['arm_aegis_master']),stage:{},
  app:{eco:{heroEquipBonus:()=>({procs:['arm_echo_master']})}},after:(_t:number,fn:()=>void)=>timers.push(fn),
  spawnProjectile:(s:any)=>shots.push(s),hitRadius:(...x:any[])=>hits.push(x),vacuum(){},renderer:{shake(){}},
  fx:{castCircle(){},slashSprite(){},holyBurst(){},light(){},groundTex(){},shockTex(){}}};
 return {g,p,shots,timers,hits,c:{sk:{id:'holy_slash'},dmg:100}};
}
test('actual skill uses the run-bound set, never changed lobby equipment',()=>{
 const f=fixture();SKILLS.holy_slash.cast(f.g,f.p,f.c as any);
 expect(f.shots).toHaveLength(1);expect(f.shots[0].radius).toBe(.72);expect(f.timers).toHaveLength(0);
});
test('queued variant cannot hit a replacement battle or disposed player',()=>{
 for(const variant of ['return','fissure']){
  const f=fixture();applyKnightSlashVariant(f.g,f.p,f.c,variant);f.g.player={alive:true};f.g.world={};
  for(const fn of f.timers)fn();expect(f.shots).toHaveLength(0);expect(f.hits).toHaveLength(0);
 }
});
test('paused and party casts never create variant projectiles or timers',()=>{
 for(const blocked of [{paused:true},{stage:{party:{}}}]){const f=fixture();Object.assign(f.g,blocked);expect(applyKnightSlashVariant(f.g,f.p,f.c,'return')).toBe(false);expect(f.timers).toHaveLength(0);}
});
test('death then revival invalidates delayed attacks from the earlier life',async()=>{
 const {Player}=await import('../src/game/player.js');
 for(const variant of ['return','fissure']){
  const f=fixture();Object.assign(f.p,{vel:new THREE.Vector3(),mats:[],play(){},hp:100,maxHp:100});
  applyKnightSlashVariant(f.g,f.p,f.c,variant);
  Player.prototype.die.call(f.p);Player.prototype.revive.call(f.p);
  for(const fn of f.timers)fn();expect(f.shots).toHaveLength(0);expect(f.hits).toHaveLength(0);
 }
});
test('party dispatch and absent complete set keep the original projectile',()=>{
 for(const mode of ['party','legacy']){
  const f=fixture();if(mode==='party')f.g.stage={party:{}};else f.g.procs=new Set();
  SKILLS.holy_slash.cast(f.g,f.p,f.c as any);expect(f.shots).toHaveLength(1);expect(f.shots[0].radius).toBe(2);expect(f.timers).toHaveLength(0);
 }
});
test('fresh hero can use a new cast after dying without restoring the old cast',async()=>{
 const {Player}=await import('../src/game/player.js'),f=fixture();Object.assign(f.p,{vel:new THREE.Vector3(),mats:[],play(){},hp:100,maxHp:100});
 applyKnightSlashVariant(f.g,f.p,f.c,'return');Player.prototype.die.call(f.p);Player.prototype.revive.call(f.p);
 applyKnightSlashVariant(f.g,f.p,f.c,'return');for(const fn of f.timers)fn();expect(f.shots).toHaveLength(1);
});
