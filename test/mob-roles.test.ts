import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {MobRole,sweptRoleHit} from '../src/game/mob-roles.js';
import {MOB_ROLES,MOB_ROLE_ENEMIES,MAX_MOB_ROLE_ATTACKS} from '../src/data/mob-roles.js';
import {ENEMIES} from '../src/data/stages.js';
import {Enemy} from '../src/game/enemies.js';
import {validPartyWarning} from '../src/party/combat-effects.js';

function fixture(key='charger',party=false){
  const damage:number[]=[],p:any={alive:true,pos:new THREE.Vector3(0,0,5),hurt:(n:number)=>{damage.push(n);return n;}};
  const g:any={active:true,paused:false,scene:new THREE.Scene(),player:p,enemies:[],stage:{party},fx:{shockTex:()=>{}},app:{party:{livingPlayers:()=>[p,p]}}};
  const e:any={game:g,def:{meleeRole:key,atkTime:1.3},player:p,pos:new THREE.Vector3(),vel:new THREE.Vector3(),alive:true,stun:0,state:'chase',stateT:0,atkCd:0,atk:100,partyId:'e1',attackSequence:0,A:(x:string)=>x,play:()=>{},playTimed:()=>{},faceDir:(x:number,z:number)=>{e.yaw=Math.atan2(x,z);}};
  const role=new MobRole(e);e.mobRole=role;g.enemies=[e];
  const step=(dt:number,resolve?:(x:number,z:number)=>[number,number])=>{
    g.world=resolve?{resolve:(_x:number,_z:number,x:number,z:number)=>resolve(x,z)}:null;
    role.beforeStep(dt);if(g.paused)return;
    e.pos.addScaledVector(e.vel,dt);if(resolve){const [x,z]=resolve(e.pos.x,e.pos.z);e.pos.set(x,0,z);}e.stateT+=dt;role.update();
  };
  return {e,g,p,role,damage,step};
}

test('six normal enemies get three explicit roles without overriding specialist/boss behavior',()=>{
  expect(Object.keys(MOB_ROLE_ENEMIES)).toHaveLength(6);expect(new Set(Object.values(MOB_ROLE_ENEMIES)).size).toBe(3);
  for(const [id,role] of Object.entries(MOB_ROLE_ENEMIES)){
    const e=(ENEMIES as any)[id];expect(e.meleeRole).toBe(role);expect(e.boss||e.elite||e.ranged||e.behavior).toBeFalsy();expect(e.gold).toBeGreaterThan(0);
  }
  for(const e of Object.values(ENEMIES) as any[])if(e.boss||e.elite||e.behavior)expect(e.meleeRole).toBeUndefined();
});
for(const key of Object.keys(MOB_ROLES)){
  test(`${key}: frozen warning, actual hit, one hit per actor and recovery`,()=>{
    const f=fixture(key,true),{e,role,p,damage,step}=f;role.start();
    if(key==='flanker')for(let i=0;i<10;i++)step(.05);
    if(role.plan!.flanking)step(.05);
    const h={...role.plan!.shape!},strike=role.plan!.strikeAt,end=role.plan!.endAt;
    p.pos.set(h.x,0,h.z);const shapeBefore=JSON.stringify(role.plan!.shape);
    while(e.stateT<strike-.051)step(.05);
    expect(damage).toHaveLength(0);expect(JSON.stringify(role.plan!.shape)).toBe(shapeBefore);
    while(e.stateT<strike+.5)step(.05);
    expect(damage).toHaveLength(1);expect(role.hits).toBe(1);expect(e.state).toBe('attack');
    while(role.plan)step(.05);
    expect(e.stateT).toBeGreaterThanOrEqual(end);expect(e.state).toBe('chase');expect(e.vel.length()).toBe(0);expect(role.mesh.visible).toBe(false);role.dispose();
  });
  test(`${key}: out-of-warning player is safe, warning DTO is valid and commits direction`,()=>{
    const {e,role,p,damage,step}=fixture(key);role.start();
    while(role.plan!.flanking)step(.05);
    const h={...role.plan!.shape!},yaw=e.yaw;expect(validPartyWarning(role.warnings()[0])).toBe(true);
    p.pos.set(h.x+20,0,h.z+20);while(role.plan)step(.05);
    expect(damage).toHaveLength(0);expect(e.yaw).toBe(yaw);role.dispose();
  });
  test(`${key}: pause freezes motion, interruption cancels without a generic attack`,()=>{
    const {e,g,role,p,damage,step}=fixture(key);role.start();step(.15);const t=e.stateT,pos=e.pos.clone();g.paused=true;step(2);
    expect(e.stateT).toBe(t);expect(e.pos.equals(pos)).toBe(true);expect(role.plan).not.toBeNull();g.paused=false;e.stun=.3;step(.05);
    expect(role.plan).toBeNull();expect(role.mesh.visible).toBe(false);expect(e.vel.length()).toBe(0);expect(e.state).toBe('chase');
    Enemy.prototype.doAttack.call(e);expect(damage).toHaveLength(0);expect(role.warnings()).toHaveLength(0);role.dispose();
  });
}
test('charge stays still during warning and does not hurt untraversed or wall-blocked path',()=>{
  const {e,role,p,damage,step}=fixture();role.start();for(let i=0;i<17;i++)step(.05);
  expect(e.pos.length()).toBe(0);expect(damage).toHaveLength(0);
  while(role.plan)step(.05,(x,z)=>[x,Math.min(z,2)]);
  expect(e.pos.z).toBe(2);expect(damage).toHaveLength(0);expect(p.pos.z).toBe(5);role.dispose();
});
test('last partial charge interval damages across the 1.3-second boundary and guest activates at 0.9',()=>{
  const {e,role,p,damage,step}=fixture();p.pos.z=8;role.start();p.pos.z=9.4;
  step(.9);expect(role.warnings()[0].remaining).toBe(0);expect(role.material.uniforms.fired.value).toBe(1);
  step(.38);expect(e.stateT).toBeCloseTo(1.28);expect(damage).toHaveLength(0);
  step(.05);expect(e.pos.z).toBeCloseTo(8.5);expect(damage).toHaveLength(1);role.dispose();
});
test('charge sweep is restricted to the declared lane, including diagonal paths',()=>{
  const h={type:'lane',x:3,z:3,length:10,width:2,angle:Math.PI/4,safeRadius:0};
  expect(sweptRoleHit(h,{x:0,z:0},{x:4,z:4},3,3)).toBe(true);
  expect(sweptRoleHit(h,{x:0,z:0},{x:1,z:1},4,4)).toBe(false);
  expect(sweptRoleHit(h,{x:0,z:0},{x:4,z:4},1,4)).toBe(false);
});
test('a long frame sweeps through a thin wall instead of accepting its far endpoint',()=>{
  const {e,role,p,damage,step}=fixture();p.pos.z=7;role.start();step(.9);
  const thinWall=(x:number,z:number):[number,number]=>[x,z>2&&z<3?2:z];
  step(.4,thinWall);expect(e.pos.z).toBe(2);expect(damage).toHaveLength(0);role.dispose();
});
test('only three role attacks can be active; no extra hidden basic attack is permitted',()=>{
  const {e,g,role,damage}=fixture();g.enemies=Array.from({length:MAX_MOB_ROLE_ATTACKS},()=>({alive:true,mobRole:{plan:{}}}));
  expect(role.available(3)).toBe(false);Enemy.prototype.startAttack.call(e,3);expect(role.plan).toBeNull();expect(damage).toHaveLength(0);role.dispose();
});
test('death and inactive battle clean the warning and owned GPU objects idempotently',()=>{
  for(const reason of ['death','inactive']){const {e,g,role,step}=fixture();role.start();if(reason==='death')e.alive=false;else g.active=false;step(.05);expect(role.plan).toBeNull();expect(role.mesh.visible).toBe(false);role.dispose();role.dispose();expect(g.scene.children).toHaveLength(0);}
});
