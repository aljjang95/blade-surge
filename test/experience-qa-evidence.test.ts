import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Enemy } from '../src/game/enemies.js';
import { validateRuptureEvidence } from '../tools/experience-qa-evidence.mjs';
const hit = {targetId:1,before:100,after:90,delta:10,quiet:true,noProc:true,apexProc:true,isLinkPrimary:false};
test('rupture QA requires bounded unique actual HP loss, not a proc counter',()=>{
  expect(validateRuptureEvidence([hit])).toBe(true);
  for(const rows of [[],[hit,hit],[hit,{...hit,targetId:2},{...hit,targetId:3}],
    [{...hit,after:100,delta:0}],[{...hit,noProc:false}],[{...hit,delta:999}],[{...hit,isLinkPrimary:true}],[{...hit,isLinkPrimary:undefined}]])
    expect(validateRuptureEvidence(rows)).toBe(false);
});
test('real Enemy.hurt can produce MISS without HP loss; QA distinguishes it from missing damage',()=>{
  let missObserved=false;
  const enemy:any=Object.assign(Object.create(Enemy.prototype),{alive:true,spawning:false,
    hp:100,def:{dodge:1},state:'chase',stun:0,pos:new THREE.Vector3(),kb:new THREE.Vector3(),
    model:{},A:()=> 'Dodge',play:()=>{},game:{fx:{ghost:()=>{},damage:(_p:any,_n:any,o:any)=>{missObserved=o?.text==='MISS';}}}});
  const beforeState=enemy.state, before=enemy.hp;
  expect(enemy.hurt(25)).toBe(0);
  const miss={...hit,targetId:2,before,after:enemy.hp,delta:before-enemy.hp,beforeState,
    afterState:enemy.state,beforeStun:0,dodgeChance:1,missObserved};
  expect(missObserved).toBe(true);
  expect(validateRuptureEvidence([hit,miss])).toBe(true);
  expect(validateRuptureEvidence([miss])).toBe(false);
  expect(validateRuptureEvidence([hit,{...miss,missObserved:false}])).toBe(false);
  expect(validateRuptureEvidence([hit,{...miss,afterState:'chase'}])).toBe(false);
});
