import {expect,test,spyOn} from 'bun:test';
import * as THREE from 'three';
import {BOSS_ENCOUNTERS,BOSS_SIGNATURES} from '../src/data/boss-encounters.js';
import {BossSignatures,planBossSignature,BOSS_SIGNATURE_CAPACITY} from '../src/game/boss-signatures.js';
import {hazardContains,RegionHazards} from '../src/game/region-hazards.js';
import {Enemy,nextBossPattern} from '../src/game/enemies.js';
import {isRecoveryOpportunity} from '../src/game/apex-combat.js';
import {validPartyWarning,PartyCombatEffects} from '../src/party/combat-effects.js';
import {ENEMIES,stageDef,CHAPTERS} from '../src/data/stages.js';
import {Battle} from '../src/game/battle-base.js';
import {Actor} from '../src/game/actor.js';

const room={x:40,z:-30,w:26,h:24,type:'boss',spawned:true,cleared:false};
function fixture(party=false){
  const damage:any[]=[];
  const player:any={alive:true,pos:new THREE.Vector3(40,0,-25),hurt:(d:number)=>{damage.push(d);return d;}};
  const game:any={scene:new THREE.Scene(),player,active:true,paused:false,stage:{party,chapter:{theme:'garden'}},fx:{},ui:{toast:()=>{}},world:{roomAt:()=>room}};
  game.app={party:{livingPlayers:()=>[player,player]}};
  const enemy:any=Object.create(Enemy.prototype);
  Object.assign(enemy,{game,def:(ENEMIES as any).garden_finalboss,pos:new THREE.Vector3(40,0,-30),homeRoom:room,alive:true,spawning:false,state:'attack',stateT:0,phase:0,patternTurn:0,attackSequence:1,atk:100,yaw:0,isBoss:true,stun:0,A:(s:string)=>s,playTimed:()=>{}});
  const caster=new BossSignatures(enemy);enemy.signatures=caster;
  return {game,enemy,caster,player,damage};
}

test('each campaign finale has two exclusive techniques and three authored phase orders',()=>{
  const used=new Set();
  for(const [id,config] of Object.entries(BOSS_ENCOUNTERS)){
    const def=(ENEMIES as any)[id];expect(def.signatureBoss).toBe(true);
    expect(config.phases.length).toBe(3);
    const techniques=[...new Set(config.phases.flat().filter(k=>k in BOSS_SIGNATURES))];expect(techniques.length).toBe(2);
    for(const key of techniques){expect(used.has(key)).toBe(false);used.add(key);}
    for(let phase=0;phase<3;phase++)expect(config.phases[phase].map((_,i)=>nextBossPattern(def,i,phase))).toEqual(config.phases[phase]);
  }
  expect(used.size).toBe(12);
  expect(nextBossPattern({pattern:['spin','slam']},0,1)).toBe('slam');
});

test('all plans preserve warning time, recovery, bounded geometry and a reachable safe path',()=>{
  // Independent grid reachability over strike times, with 5 units/second movement.
  // Uses normal and offset rooms, target positions near centre/edge and all phases.
  for(const offset of [0,40])for(const phase of [0,1,2])for(const key of Object.keys(BOSS_SIGNATURES))for(const edge of [0,7]){
    const r={x:offset,z:-offset,w:26,h:24};const target={x:r.x+edge,z:r.z+5};
    const plan=planBossSignature(key,{room:r,origin:r,target,history:[{x:r.x-3,z:r.z+5},{x:r.x,z:r.z+7},{x:r.x+3,z:r.z+5}],phase,turn:1})!;
    expect(plan.events.length).toBeLessThanOrEqual(BOSS_SIGNATURE_CAPACITY);
    expect(plan.duration-plan.lastStrike).toBeGreaterThanOrEqual(1);
    for(const h of plan.events){expect(h.at-h.warnAt).toBeGreaterThanOrEqual(1.2);expect(h.radius+h.width+h.length).toBeGreaterThan(0);}
    let candidates=[target],at=0;
    const times=[...new Set(plan.events.map(h=>h.at))].sort((a,b)=>a-b);
    for(const time of times){const hazards=plan.events.filter(h=>h.at===time),next:any[]=[];
      for(let x=r.x-r.w/2+1;x<=r.x+r.w/2-1;x++)for(let z=r.z-r.h/2+1;z<=r.z+r.h/2-1;z++){
        if(hazards.some(h=>hazardContains(h,x,z)))continue;
        if(candidates.some(p=>Math.hypot(p.x-x,p.z-z)<=5*(time-at)))next.push({x,z});
      }
      expect(next.length,`${key} phase ${phase} strike ${time}`).toBeGreaterThan(0);candidates=next;at=time;
    }
  }
});

test('frost stores the travelled path before the cast; target movement cannot retarget it',()=>{
  const f=fixture();for(const x of [36,39,42]){f.player.pos.x=x;f.caster.remember(.6);}
  f.player.pos.x=45;const plan=f.caster.start('archive_retrace');
  expect(plan.events.map(h=>h.x)).toEqual([45,42,39]);
  f.player.pos.x=31;expect(plan.events.map(h=>h.x)).toEqual([45,42,39]);
  f.caster.dispose();
});

test('successive shelter safe areas do not overlap, including casts beside walls',()=>{
  for(const w of [18,24,30])for(const x of [-w/2+1,0,w/2-1])for(const z of [-8,0,8]){
    const plan=planBossSignature('oath_shelter',{room:{x:0,z:0,w,h:24},origin:{x:0,z:0},target:{x,z},phase:2})!;
    for(let i=1;i<plan.events.length;i++){const a=plan.events[i-1],b=plan.events[i];expect(Math.hypot(b.x-a.x,b.z-a.z)).toBeGreaterThan(a.safeRadius+b.safeRadius);}
  }
});

test('real Enemy startAttack schedules signatures and advertises recovery only after last strike',()=>{
  const f=fixture();f.enemy.startAttack(5);expect(f.enemy.special).toBe('bell_toll');expect(f.damage).toHaveLength(0);
  const plan=f.caster.plan!;f.enemy.stateT=plan.lastStrike-.01;f.caster.update(f.enemy.stateT);expect(isRecoveryOpportunity(f.enemy)).toBe(false);
  f.enemy.stateT=plan.lastStrike+.01;f.caster.update(f.enemy.stateT);expect(isRecoveryOpportunity(f.enemy)).toBe(true);
  f.enemy.stateT=plan.duration;expect(isRecoveryOpportunity(f.enemy)).toBe(false);f.caster.dispose();
});

test('pause freezes cast, invulnerability rejects hit/slow, repeated updates do not strike twice',()=>{
  const f=fixture();f.caster.start('archive_retrace');f.game.paused=true;f.caster.update(2);expect(f.damage).toHaveLength(0);expect(f.caster.age).toBe(0);
  f.game.paused=false;f.player.hurt=()=>0;f.caster.update(1.36);expect(f.caster.fired).toBe(1);expect(f.caster.hits).toBe(0);expect(f.player.slowT).toBeUndefined();
  f.caster.update(1.36);expect(f.caster.fired).toBe(1);
  f.caster.update(NaN);f.caster.update(.5);expect(f.caster.age).toBe(1.36);f.caster.dispose();
});

test('cancellation and fixed pool reclamation prevent late damage or per-cast GPU growth',()=>{
  for(const cancel of ['death','stun','hurt','stop','bossDefeated']){
    const f=fixture();f.caster.start('archive_retrace');
    if(cancel==='death')f.enemy.alive=false;if(cancel==='stun')f.enemy.stun=2;if(cancel==='hurt')f.enemy.state='hurt';if(cancel==='stop')f.game.active=false;if(cancel==='bossDefeated')f.game.bossDefeated=true;
    f.caster.update(3);expect(f.damage).toHaveLength(0);expect(f.caster.warnings()).toHaveLength(0);f.caster.dispose();
  }
  const f=fixture(),meshes=f.caster.slots.map(s=>s.mesh),geometry=f.caster.geometry;
  for(let i=0;i<100;i++){f.caster.start('crown_verdict');f.caster.clear();}
  expect(f.caster.slots.map(s=>s.mesh)).toEqual(meshes);expect(f.caster.geometry).toBe(geometry);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);for(const s of f.caster.slots)s.mesh.material.addEventListener('dispose',()=>disposed++);
  f.caster.dispose();f.caster.dispose();expect(disposed).toBe(BOSS_SIGNATURE_CAPACITY+1);expect(f.game.scene.children).toHaveLength(0);
});

test('party warning meshes and authoritative hit geometry agree, including moving safe centres',()=>{
  const f=fixture(true),remote=new PartyCombatEffects(new THREE.Scene());
  for(const key of Object.keys(BOSS_SIGNATURES)){
    f.caster.start(key);
    for(const at of [0,1,2,3,4]){f.caster.update(at);const warnings=f.enemy.getPartyWarnings();expect(warnings.every(validPartyWarning)).toBe(true);remote.update(warnings);
      const visible=remote.slots.filter(s=>s.mesh.visible);expect(visible.length).toBe(warnings.length);
      for(let i=0;i<warnings.length;i++){const w=warnings[i],m=visible[i].mesh;expect(m.position.x).toBe(w.x);expect(m.position.z).toBe(w.z);expect(m.material.uniforms.safeRadius.value).toBe(w.safeRadius);}
    }
  }
  remote.dispose();f.caster.dispose();
});

test('overlapping simultaneous marks cannot hit the same party actor twice',()=>{
  const f=fixture(true);f.player.pos.set(room.x,0,room.z);f.caster.start('bell_clap');
  // Both mark centres coincide at a wall in this controlled overlap case.
  for(const s of f.caster.slots)if(s.event?.at===1.4){s.event.x=room.x;s.event.z=room.z;}
  f.caster.update(1.41);expect(f.damage).toHaveLength(1);f.caster.update(1.5);expect(f.damage).toHaveLength(1);f.caster.dispose();
});

test('cancelled signatures never fall back to a generic strike on later enemy frames',()=>{
  // Isolate the attack state machine from the unrelated skeletal mixer.
  const actorUpdate=spyOn(Actor.prototype,'update').mockImplementation(()=>{});
  try {
    for(const reason of ['inactive','bossDefeated']){
      const f=fixture();let genericCalls=0;
      Object.assign(f.enemy,{special:'bell_toll',hp:100,maxHp:100,vel:new THREE.Vector3(),attackDone:false,attackDur:4.1,hitAt:3.05/4.1,stateT:.8,doAttack:()=>genericCalls++});
      f.game.enemies=[f.enemy];f.caster.start('bell_toll');
      if(reason==='inactive')f.game.active=false;else f.game.bossDefeated=true;
      f.enemy.update(.1);expect(f.caster.plan).toBeNull();
      f.enemy.update(2.5);expect(genericCalls).toBe(0);expect(f.damage).toHaveLength(0);expect(f.enemy.getPartyWarnings()).toEqual([]);
      expect(f.enemy.attackDone).toBe(false);expect(isRecoveryOpportunity(f.enemy)).toBe(false);
      Enemy.prototype.doAttack.call(f.enemy);expect(f.damage).toHaveLength(0);expect(f.enemy.completedAttackSequence).toBeUndefined();
      f.caster.dispose();
    }
  } finally {actorUpdate.mockRestore();}
});

test('finale ambient hazards yield to the boss schedule but regular rooms retain their hazards',()=>{
  const f=fixture();f.game.enemies=[f.enemy];const h=new RegionHazards(f.game);h.room=room;h.cooldown=0;h.update(.1);expect(h.triggered).toBe(0);
  f.enemy.def={};h.cooldown=0;h.update(.1);expect(h.triggered).toBe(1);h.dispose();f.caster.dispose();
});

test('campaign rooms cycle all six melee and three ranged species without altering capacity',()=>{
  for(const chapter of CHAPTERS){const stage=stageDef(chapter.id,4),roster=stage.rosterFor();
    const room={id:5,type:'test',reinforced:0};
    const list=Battle.prototype.roomRoster.call({stage,rosterSize:()=>18},room);
    expect(list.length).toBe(18);expect(new Set(list.filter(id=>roster.trash.includes(id))).size).toBe(6);expect(new Set(list.filter(id=>roster.ranged.includes(id))).size).toBe(3);
    room.reinforced=4;expect(Battle.prototype.roomRoster.call({stage,rosterSize:()=>18},room).length).toBe(14);
    expect(list).toEqual(Battle.prototype.roomRoster.call({stage,rosterSize:()=>18},{...room,reinforced:0}));
  }
});
