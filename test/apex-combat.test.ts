import {test,expect} from 'bun:test';
import {isRecoveryOpportunity,longestRegularCooldown} from '../src/game/apex-combat.js';
import {Enemy} from '../src/game/enemies.js';
import * as THREE from 'three';
test('recovery requires the completed heavy attack sequence, not an interrupted telegraph',()=>{
  const e={alive:true,isBoss:true,state:'attack',attackDone:true,special:'slam',attackSequence:2,completedAttackSequence:2,stateT:.7,attackDur:1,hitAt:.52};
  expect(isRecoveryOpportunity(e)).toBe(true);
  for(const change of [{state:'hurt'},{attackDone:false},{telegraph:.1},{stateT:1},{stateT:.4},{completedAttackSequence:1},{special:'summon'},{stun:1},{breakT:1},{alive:false},{spawning:true}])expect(isRecoveryOpportunity({...e,...change})).toBe(false);
});
test('real enemy attack records sequence only when execution reaches doAttack',()=>{
  const noop=()=>{};const e:any=Object.create(Enemy.prototype);
  Object.assign(e,{def:{atkTime:1,pattern:['spin']},isBoss:true,phase:0,patternTurn:0,atk:10,pos:new THREE.Vector3(),yaw:0,A:(x:string)=>x,forward:(v:any)=>v.set(0,0,1),playTimed:noop,
    game:{player:{distTo:()=>20},fx:{ring:noop,slashArc:noop,dust:noop},renderer:{shake:noop}}});
  e.startAttack(3);expect(e.attackSequence).toBe(1);expect(e.completedAttackSequence).toBeUndefined();
  e.doAttack();expect(e.completedAttackSequence).toBe(1);
  e.startAttack(3);expect(e.attackSequence).toBe(2);expect(e.completedAttackSequence).toBe(1);expect(isRecoveryOpportunity(e)).toBe(false);
});
test('cooldown selection excludes ultimate and awakening and resolves ties stably',()=>{
  expect(longestRegularCooldown({def:{skills:[{}, {},{ult:true},{awaken:1},{unlock:10}]},cds:[4,4,99,99,99]})).toBe(0);
  expect(longestRegularCooldown({def:{skills:[{}]},cds:[0]})).toBe(-1);
});
