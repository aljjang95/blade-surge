import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { CombatNoticeQueue } from '../src/ui/combat-notices.js';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
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

test('kill achievements remain queued behind danger with the same payload, rewards and streak counters',()=>{
  for (const milestone of [5, 10, 20, 30]) {
    let ult=0,mp=0; const visible:string[]=[], messages:any[][]=[], drops:any[][]=[], streaks:any[][]=[];
    const queue=new CombatNoticeQueue({show:({message}:{message:string})=>{
      visible.push(message); return ()=>{visible.splice(visible.indexOf(message),1);};
    },schedule:(()=>1) as any,cancel:(()=>{}) as any});
    queue.push('증원이 몰려온다!','red');
    const e:any={isBoss:false,isElite:false,homeRoom:null,pos:new THREE.Vector3(),alive:false};
    const stage={party:true};
    const g:any={conquest:null,kills:7,waveKilled:3,killStreak:milestone-1,killStreakT:0,
      player:{alive:true,addUlt:(n:number)=>ult+=n,addMp:(n:number)=>mp+=n},sp:null,hasProc:()=>false,stage,
      ui:{setKillStreak:(...args:any[])=>streaks.push(args),toast:(message:string,tone:string,options:any)=>{
        messages.push([message,tone,options]);queue.push(message,tone,options);
      }},drops:{onKill:(...args:any[])=>drops.push(args)},fx:{burst(){},dustPuff(){},explosion(){}},renderer:{shake(){}},
      pending:[],active:true,enemies:[e],after(){}};
    Battle.prototype.onEnemyDeath.call(g,e);
    const tier=milestone>=20?'전장의 지배자':milestone>=10?'광란':'사냥 본능';
    expect(messages).toEqual([[`${milestone}연속 처치 · ${tier}`,milestone>=20?'red':'gold',{urgent:false}]]);
    expect(visible).toEqual(['증원이 몰려온다!']);
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]).toMatchObject({message:messages[0][0],tone:messages[0][1],urgent:false});
    expect(streaks).toEqual([[milestone,tier]]);expect(g.killStreak).toBe(milestone);expect(g.killStreakT).toBe(3.4);
    expect(g.kills).toBe(8);expect(g.waveKilled).toBe(4);expect(mp).toBe(2);expect(ult).toBe(1);
    expect(drops).toEqual([[e,stage]]);queue.clear();
  }
});

test('actual boss phase warnings keep their red danger priority over red achievements',()=>{
  const visible:string[]=[], calls:any[][]=[];
  const queue=new CombatNoticeQueue({show:({message}:{message:string})=>{
    visible.push(message);return ()=>{visible.splice(visible.indexOf(message),1);};
  },schedule:(()=>1) as any,cancel:(()=>{}) as any});
  queue.push('20연속 처치 · 전장의 지배자','red',{urgent:false});
  const g:any={bossKey:'glass_warden',ui:{toast:(...args:any[])=>{calls.push(args);queue.push(args[0],args[1],args[2]);}},
    fx:{shockTex(){},firePillar(){}},renderer:{flashScreen(){},shake(){}}};
  const boss:any={pos:new THREE.Vector3(),def:{name:'유리 감시자'}};
  Battle.prototype.bossPhase.call(g,boss,1);
  expect(calls).toEqual([['보스 2페이즈!','red']]);expect(visible).toEqual(['보스 2페이즈!']);
  expect(queue.current?.urgent).toBe(true);expect(queue.pending[0].message).toBe('20연속 처치 · 전장의 지배자');
  Battle.prototype.bossPhase.call(g,boss,2);
  expect(calls[1]).toEqual(['유리 감시자 광폭화!','red']);
  expect(queue.pending.some(item=>item.message==='유리 감시자 광폭화!'&&item.urgent)).toBe(true);
  queue.clear();
});

test('actual projectile spawn keeps the original mesh and halo while excluding stronger cosmetic masking',()=>{
  for (const hostile of [false,true]) {
    const focus=new HeroEffectFocus(), mesh=new THREE.Group();
    const core=new THREE.Mesh(new THREE.SphereGeometry(.2),new THREE.MeshBasicMaterial({color:0xffffff}));
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({color:0x80ff90,transparent:true,blending:THREE.AdditiveBlending}));
    halo.scale.setScalar(1.6);focus.bind(halo.material);mesh.add(core,halo);mesh.userData.halo=halo;mesh.userData.core=core;
    const visuals:any[][]=[], scene=new THREE.Scene(), projectiles:any[]=[];
    const g:any={stage:{},scene,projectiles,fx:{orb:(...args:any[])=>{visuals.push(args);return mesh;}}};
    const pos=new THREE.Vector3(1,1,2),dir=new THREE.Vector3(0,0,2),owner={};
    Battle.prototype.spawnProjectile.call(g,{pos,dir,speed:12,radius:.4,dmg:37,color:0x80ff90,owner,life:1.4,hostile});
    expect(visuals).toEqual([[0x80ff90,.4]]);expect(scene.children).toEqual([mesh]);expect(mesh.children).toEqual([core,halo]);
    expect(mesh.position.toArray()).toEqual(pos.toArray());expect(halo.scale.toArray()).toEqual([1.6,1.6,1.6]);
    expect(halo.material.color.getHex()).toBe(0x80ff90);expect(halo.material.userData.heroCosmeticMask).toBe(false);
    expect(core.material.color.getHex()).toBe(0xffffff);expect(core.material.userData).not.toHaveProperty('heroCosmeticMask');
    expect(projectiles).toHaveLength(1);expect(projectiles[0]).toMatchObject({speed:12,radius:.4,dmg:37,owner,life:1.4,hostile,mesh});
    expect(projectiles[0].pos).not.toBe(pos);expect(projectiles[0].pos.toArray()).toEqual([1,1,2]);
    expect(projectiles[0].dir.toArray()).toEqual([0,0,1]);expect(dir.toArray()).toEqual([0,0,2]);
    expect(projectiles[0].trail).toBe(hostile?null:0x80ff90);
    const compiled:any={uniforms:{},fragmentShader:'void main() { gl_FragColor = vec4(1.0); }'};
    halo.material.onBeforeCompile(compiled,{} as THREE.WebGLRenderer);
    expect(compiled.uniforms.heroCosmeticMaskAllowed.value).toBe(0);
    mesh.removeFromParent();core.geometry.dispose();core.material.dispose();halo.material.dispose();
  }
});

test('perfect dodge grants the control-first MP and ultimate reward',()=>{
  let mp=0,ult=0; const p:any={pos:new THREE.Vector3(),model:new THREE.Group(),stats:{ultGain:1},buffs:{atk:1,atkSpd:1,t:0},addUlt:(n:number)=>ult+=n,addMp:(n:number)=>mp+=n};
  const g:any={timeCtl:{slowmo(){}},renderer:{punch(){},aberr:0,flashScreen(){}},fx:{shockTex(){},ghost(){},burst(){}},ui:{perfectDodge(){}},player:{def:{voiceId:'ranger'}},heroId:'ranger'};
  Battle.prototype.onPerfectDodge.call(g,p); expect(mp).toBe(12); expect(ult).toBe(18); expect(p.counterWindow).toBe(2.4);
});

test('campaign boss shortcut only unseals and opens portal, preserving optional flags and excluding other modes',()=>{
  const rooms=[{cleared:false,discovered:false},{cleared:false,discovered:true}], before=JSON.stringify(rooms); let opened=0,sealFx=0;
  const g:any={active:true,stage:{},conquest:null,enemies:[],pending:[],world:{sealed:true,bossRoom:{cleared:false},rooms,unseal(){this.sealed=false;}},arena:{openSeal(){sealFx++;}},fx:{},ui:{setObjective(){},toast(){}},openPortal(){opened++;},canBossShortcut:Battle.prototype.canBossShortcut};
  expect(Battle.prototype.canBossShortcut.call(g)).toBe(true); expect(Battle.prototype.shortcutBoss.call(g)).toBe(true);
  expect(JSON.stringify(rooms)).toBe(before); expect(opened).toBe(1); expect(sealFx).toBe(1);
  expect(g.bossRush).toBe(true); expect(g.autoTarget).toBe(g.world.bossRoom); expect(g.world.bossRoom.discovered).toBe(true);
  g.world.sealed=true; g.enemies=[{alive:true}]; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false); g.enemies=[]; g.pending=[{t:'queued'}]; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false); g.pending=[];
  for(const blocked of [{stage:{expedition:{}},conquest:null},{stage:{party:{}},conquest:null},{stage:{},conquest:{}}]) {
    Object.assign(g,blocked,{active:true}); g.world.sealed=true; expect(Battle.prototype.canBossShortcut.call(g)).toBe(false);
  }
});
