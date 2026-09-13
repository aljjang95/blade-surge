import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Enemy } from '../src/game/enemies.js';
function fixture(special:string|null, party=true) {
  const calls=[0,0,0,0];
  const players=calls.map((_,i)=>({alive:i!==3,pos:new THREE.Vector3(i===2?30:i*.3,0,1),distTo(e:any){return this.pos.distanceTo(e.pos);},hurt(){calls[i]++;return true;}}));
  const enemy=Object.create(Enemy.prototype);
  const fx=new Proxy({}, {get:()=>()=>{}});
  const game:any={stage:party?{party:{}}:{},app:{party:{livingPlayers:()=>[...players,players[0]]}},player:players[0],enemies:[],fx,renderer:{shake:()=>{}},spawnProjectile:()=>{}};
  Object.assign(enemy,{game,pos:new THREE.Vector3(),yaw:0,special,atk:40,attackSequence:1,def:{range:3,scale:1},alive:true,rainPts:[new THREE.Vector3(0,0,1),new THREE.Vector3(.1,0,1)],kill:()=>{enemy.alive=false;}});
  return {enemy,players,calls};
}
for(const pattern of ['spin','slam','soulrain','explode']) test(`${pattern}: host area strikes each exposed party actor once and excludes dead/outside actors`,()=>{
  const {enemy,calls}=fixture(pattern);
  if(pattern==='explode')enemy.explode();else enemy.doAttack();
  expect(calls).toEqual([1,1,0,0]);
});
test('overlapping rain uses fixed centers and still hits guest when nearest target moves outside',()=>{
  const {enemy,players,calls}=fixture('soulrain');players[0].pos.set(40,0,40);
  enemy.doAttack();expect(calls).toEqual([0,1,0,0]);
});
test('solo area damage stays local and basic melee remains selected-target only in party',()=>{
  const solo=fixture('slam',false);solo.enemy.doAttack();expect(solo.calls).toEqual([1,0,0,0]);
  const melee=fixture(null);melee.enemy.doAttack();expect(melee.calls).toEqual([1,0,0,0]);
});
test('one bomber area applies once per player and preserves enemy chain reaction once',()=>{
  const f=fixture('explode');let chainCalls=0;
  const chain={alive:true,spawning:false,pos:new THREE.Vector3(1,0,0),behavior:'bomber',fuse:-1,hurt:()=>{chainCalls++;}};
  f.enemy.game.enemies=[f.enemy,chain];f.enemy.explode();
  expect(f.calls).toEqual([1,1,0,0]);expect(chainCalls).toBe(1);expect(chain.fuse).toBe(.5);
});
