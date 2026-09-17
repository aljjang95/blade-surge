import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { HEROES } from '../src/data/heroes.js';
import { MP_BASE, MP_REGEN_PER_SEC, DODGE_COOLDOWN_SEC, skillIndexForCombatSlot } from '../src/game/progression.js';

function ranger(overrides:any={}) {
  const p:any=Object.create(Player.prototype);
  Object.assign(p,{def:HEROES.ranger,heroLevel:50,skillLoadout:[6,7],skillLevels:Array(8).fill(1),cds:Array(8).fill(0),
    state:'idle',stun:0,ult:0,ultMax:100,ultGainLock:0,mp:MP_BASE,maxMp:MP_BASE,stats:{atk:100,ultGain:1},buffs:{atk:1,spd:1,atkSpd:1,t:0},hp:100,maxHp:100,vel:new THREE.Vector3(),pos:new THREE.Vector3(),model:new THREE.Group(),mats:[],
    game:{ui:{toast(){}},skillCooldown:(v:number)=>v,hasProc:()=>false,sp:null,ultCinematic(){},fx:{dust(){}},after(){}},
    stopTrail(){},autoAim(){},playTimed(){},faceDir(){},play(){},forward:(v:THREE.Vector3)=>v.set(0,0,1),...overrides});
  return p;
}

test('player Q and E combat slots resolve stored underlying skill indexes',()=>{
  const p=ranger(); expect(p.combatSkillIndex(4)).toBe(6); expect(p.combatSkillIndex(5)).toBe(7);
});

test('no hidden combat slot can address skill index six or seven directly',()=>{
  expect(skillIndexForCombatSlot([6,7],6)).toBe(-1); expect(skillIndexForCombatSlot([6,7],99)).toBe(-1);
});

test('high active refuses to cast when MP is below its exact cost',()=>{
  const p=ranger({mp:37});
  expect(Player.prototype.tryCastSkill.call(p,6)).toBe(false);
  expect(p.mp).toBe(37); expect(p.cds[6]).toBe(0); expect(p.state).toBe('idle');
});

test('Q cast spends MP and starts cooldown on underlying skill index',()=>{
  const p=ranger();
  expect(Player.prototype.tryCastCombatSkill.call(p,4)).toBe(true);
  expect(p.mp).toBe(62); expect(p.cds[6]).toBe(18); expect(p.state).toBe('skill');
});

test('ultimate still consumes gauge instead of MP',()=>{
  const p=ranger({ult:100,mp:7,skillLoadout:[4,5]});
  expect(Player.prototype.tryCastSkill.call(p,3)).toBe(true);
  expect(p.ult).toBe(0); expect(p.mp).toBe(7); expect(p.state).toBe('ult'); expect(p.ultGainLock).toBeGreaterThan(1);
});

test('MP pool uses base 100, slower passive regen, and clamps gain',()=>{
  const p:any={mp:98,maxMp:MP_BASE};
  expect(MP_REGEN_PER_SEC).toBe(2); expect(Player.prototype.addMp.call(p,MP_REGEN_PER_SEC)).toBe(100);
  expect(Player.prototype.addMp.call(p,-150)).toBe(0);
});

test('dodge starts the exact 1.35 second cooldown',()=>{
  const p=ranger({def:{...HEROES.ranger,jobId:null},game:{fx:{dust(){}},sp:null,hasProc:()=>false}});
  Player.prototype.dodge.call(p,new THREE.Vector3(1,0,0));
  expect(DODGE_COOLDOWN_SEC).toBe(1.35); expect(p.dodgeCd).toBe(1.35); expect(p.state).toBe('dodge');
});

test('enemy death grants exactly two MP without changing the existing ultimate grant',()=>{
  let ult=0,mp=0; const e:any={isBoss:false,isElite:false,homeRoom:null,pos:new THREE.Vector3(),alive:false};
  const g:any={conquest:null,kills:0,waveKilled:0,player:{alive:true,addUlt:(n:number)=>ult+=n,addMp:(n:number)=>mp+=n},sp:null,
    hasProc:()=>false,stage:{party:true},drops:{onKill(){}},fx:{burst(){},dustPuff(){},explosion(){}},renderer:{shake(){}},pending:[],active:true,enemies:[e],after(){}};
  Battle.prototype.onEnemyDeath.call(g,e);
  expect(mp).toBe(2); expect(ult).toBe(1); expect(g.kills).toBe(1);
});

test('perfect dodge grants the control-first MP and ultimate reward',()=>{
  let mp=0,ult=0; const p:any={pos:new THREE.Vector3(),model:new THREE.Group(),stats:{ultGain:1},buffs:{atk:1,atkSpd:1,t:0},addUlt:(n:number)=>ult+=n,addMp:(n:number)=>mp+=n};
  const g:any={timeCtl:{slowmo(){}},renderer:{punch(){},aberr:0,flashScreen(){}},fx:{shockTex(){},ghost(){},burst(){}},ui:{perfectDodge(){}},player:{def:{voiceId:'ranger'}},heroId:'ranger'};
  Battle.prototype.onPerfectDodge.call(g,p); expect(mp).toBe(12); expect(ult).toBe(18);
});

test('campaign boss shortcut only unseals and opens portal, preserving optional flags and excluding other modes',()=>{
  const rooms=[{cleared:false,discovered:false},{cleared:false,discovered:true}], before=JSON.stringify(rooms); let opened=0,sealFx=0;
  const g:any={active:true,stage:{},conquest:null,enemies:[],pending:[],world:{sealed:true,bossRoom:{cleared:false},rooms,unseal(){this.sealed=false;}},arena:{openSeal(){sealFx++;}},fx:{},ui:{setObjective(){},toast(){}},openPortal(){opened++;},canBossShortcut:Battle.prototype.canBossShortcut};
  expect(Battle.prototype.canBossShortcut.call(g)).toBe(true); expect(Battle.prototype.shortcutBoss.call(g)).toBe(true);
  expect(JSON.stringify(rooms)).toBe(before); expect(opened).toBe(1); expect(sealFx).toBe(1);
  g.world.sealed=true; g.enemies=[{alive:true}]; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false); g.enemies=[]; g.pending=[{t:'queued'}]; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false); g.pending=[];
  for(const blocked of [{stage:{expedition:{}},conquest:null},{stage:{party:{}},conquest:null},{stage:{},conquest:{}}]) {
    Object.assign(g,blocked,{active:true}); g.world.sealed=true; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false);
  }
});
