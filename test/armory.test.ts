import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { ARMORY_ITEMS, ARMORY_SETS } from '../src/data/armory.js';
import { ITEM_BY_ID, ITEM_POOL, ITEMS_OF, THEMED_SETS, craftable, CRAFT_COST } from '../src/data/items.js';
import { Economy } from '../src/game/economy.js';
import { ArmoryProcs } from '../src/game/armory-procs.js';
import { contactProfile, contactBudget } from '../src/game/combat-contact.js';
import { HeroBeacon } from '../src/game/hero-beacon.js';
import { Actor } from '../src/game/actor.js';
import { FX } from '../src/engine/fx.js';
import { TimeCtl, Battle as BaseBattle } from '../src/game/battle-base.js';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';
import { bootHalf } from '../src/engine/armory-assets.js';
import { Group, Vector3, BoxGeometry, Bone, Skeleton, SkinnedMesh, MeshBasicMaterial, Uint16BufferAttribute, Float32BufferAttribute, AnimationMixer } from 'three';

test('24 unique obtainable items have rendered icons and GLB geometry', () => {
  expect(ARMORY_ITEMS).toHaveLength(24);
  expect(new Set(ARMORY_ITEMS.map(x=>x.id)).size).toBe(24);
  expect(new Set(ARMORY_ITEMS.map(x=>x.name)).size).toBe(24);
  for (const item of ARMORY_ITEMS as any[]) {
    expect((ITEM_BY_ID as any)[item.id].slot).toBe(item.slot);
    expect(ITEMS_OF('U',item.slot).some(x=>x.id===item.id)).toBe(true);
    expect(craftable(item.set,item.slot)?.id).toBe(item.id);
    expect(THEMED_SETS).toContain(item.set);
    const png=readFileSync(`public${item.icon}`); expect(png.readUInt32BE(16)).toBe(256); expect(png.readUInt32BE(20)).toBe(256);
    const glb=readFileSync(`public/models/armory-v1/${item.id}.glb`); expect(glb.toString('utf8',0,4)).toBe('glTF');
    const json=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
    expect(json.meshes.length).toBeGreaterThan(0);
  }
  expect(existsSync('tools/art/source/armory-v1.blend')).toBe(true);
});

test('all six sets craft, equip, upgrade, persist and unequip through existing economy', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v)}});
  try {
    for(const set of ARMORY_SETS as any[]) {
      const eco=new Economy(); eco.s.fragments=CRAFT_COST*4; eco.s.gold=12000;
      for(const slot of ['weapon','armor','ring','boots']) {
        const result=eco.craftSetItem(set.id,slot); expect(result.ok).toBe(true);
        eco.equip('knight',result.inst!.uid);
        expect(eco.enhance(result.inst!.uid).ok).toBe(true);expect(result.inst!.enh).toBe(1);
      }
      expect(eco.s.fragments).toBe(0);
      expect(eco.heroEquipBonus('knight').procs as string[]).toContain(`${set.id}_master`);
      const loaded=new Economy(); expect(loaded.heroEquipInsts('knight')).toEqual(eco.heroEquipInsts('knight'));
      expect(loaded.heroEquipBonus('knight').procs as string[]).toContain(set.id);
      loaded.unequip('knight','ring'); expect(loaded.heroEquipBonus('knight').procs).not.toContain(`${set.id}_master`);
      loaded.unequip('knight','boots'); loaded.unequip('knight','armor'); expect(loaded.heroEquipBonus('knight').procs).not.toContain(set.id);
    }
  } finally { if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage'); }
});

test('all 24 IDs can be selected by the actual item reward function without changing rarity rolls',()=>{
  const random=Math.random;
  try {
    const eco=new Economy();
    for(const item of ARMORY_ITEMS as any[]) {
      const pool=(ITEM_POOL as any)[item.slot].filter((x:any)=>x.rarity==='U');
      Math.random=()=> (pool.findIndex((x:any)=>x.id===item.id)+.5)/pool.length;
      expect(eco.addItem('U',item.slot).id).toBe(item.id);
    }
  }finally{Math.random=random;}
});

test('split greaves preserve triangle count and material groups without mutating source geometry',()=>{
  const original=new BoxGeometry(), count=original.index!.count, left=bootHalf(original,-1), right=bootHalf(original,1);
  expect(left.index!.count+right.index!.count).toBe(count);expect(original.index!.count).toBe(count);
  expect(left.groups.reduce((n:number,g:{count:number})=>n+g.count,0)).toBe(left.index!.count);
  left.dispose();right.dispose();original.dispose();
});

test('rejected damage, quiet and noProc hits never create direct contact feedback',()=>{
  let flashes=0,stops=0;
  const p:any={stats:{crit:0,critDmg:1,ultGain:1},addUlt(){}}, e:any={hurt:()=>0,pos:new Vector3(),def:{scale:1}};
  const game:any={player:p,app:{reducedMotion:{matches:false}},elapsed:1,dmgDealt:0,combo:0,maxCombo:0,
    ui:{setCombo(){}},timeCtl:{hitstop(){stops++;}},fx:{dmgLayer:{children:[]},damage(){},flash(){flashes++;},directional(){}}};
  BaseBattle.prototype.damageEnemy.call(game,e,100,{});expect(flashes).toBe(0);expect(game.dmgDealt).toBe(0);
  e.hurt=()=>10;
  for(const opts of [{quiet:true},{noProc:true}])BaseBattle.prototype.damageEnemy.call(game,e,100,opts);
  expect(flashes).toBe(0);expect(stops).toBe(0);expect(game.dmgDealt).toBe(20);
});

test('live RPG damage override forwards quiet/source flags and respects reduced motion and pause',()=>{
  let contacts=0, stops=0;
  const f=fixture('arm_mercy'), g=f.g;
  Object.assign(g.player,{stats:{crit:0,critDmg:1,ultGain:1}});
  Object.assign(f.e,{hurt:()=>10,def:{scale:1},receiveImpact(){}});
  Object.assign(g,{app:{reducedMotion:{matches:true}},dmgDealt:0,combo:0,maxCombo:0,feedbackCount:0,feedbackSound:false,
    ui:{setCombo(){}},timeCtl:{hitstop(){stops++;}},
    sp:{onHit:(e:any,opts:any)=>f.sp.onHit(e,opts),dmgMul:()=>1},
    fx:{dmgLayer:{children:[]},damage(){},contact(_p:any,_d:any,_c:any,opts:any){expect(opts.light).toBe(false);expect(opts.particles).toBe(0);contacts++;}}});
  RpgBattle.prototype.damageEnemy.call(g,f.e,100,{quiet:true});
  RpgBattle.prototype.damageEnemy.call(g,f.e,100,{noProc:true});
  expect(f.sp.light).toBe(0);expect(contacts).toBe(0);
  RpgBattle.prototype.damageEnemy.call(g,f.e,100,{});
  expect(f.sp.light).toBe(1);expect(contacts).toBe(1);expect(stops).toBe(0);
  g.paused=true;g.elapsed+=1;RpgBattle.prototype.damageEnemy.call(g,f.e,100,{});
  expect(f.sp.light).toBe(1);expect(contacts).toBe(1);
});

function fixture(...ids:string[]) {
  const hits:any[]=[], pulls:any[]=[];
  const enemy=(x=1)=>({alive:true,spawning:false,isBoss:false,pos:new Vector3(x,0,0),slow:0,slowT:0,pull:(...v:any[])=>pulls.push(v)});
  const g:any={active:true,paused:false,elapsed:1,hasProc:(id:string)=>ids.includes(id),enemies:[],
    player:{alive:true,pos:new Vector3(),atk:100,hp:500,maxHp:1000,dr:0,drT:0,ult:0,addUlt(n:number){this.ult+=n;}},
    fx:{groundTex(){}},damageEnemy:(e:any,n:number,o:any)=>hits.push({e,n,o})};
  const sp=new ArmoryProcs(g),e=enemy();g.enemies.push(e);
  const hit=(target=e,opts={})=>{g.elapsed+=.2;sp.onHit(target,opts);};
  return {g,sp,e,hit,enemy,hits,pulls};
}
test('anchor resolves once after dodge, excludes bosses, caps twelve and clears on reset',()=>{
  const f=fixture('arm_anchor'); f.g.enemies=Array.from({length:20},()=>f.enemy()); f.sp.onDodge();
  f.sp.update();expect(f.pulls).toHaveLength(0);f.g.elapsed+=.7;f.sp.update();expect(f.pulls).toHaveLength(12);
  f.sp.update();expect(f.pulls).toHaveLength(12);f.sp.clear();expect(f.sp.anchor).toBeNull();
});
test('echo requires three hits and spends its mark once without recursive procs',()=>{
  const f=fixture('arm_echo','arm_echo_master'); f.hit();f.hit();f.sp.onDodge();expect(f.hits).toHaveLength(0);
  f.hit();f.sp.onDodge();expect(f.hits).toHaveLength(1);expect(f.hits[0]).toMatchObject({n:100,o:{noProc:true,quiet:true,quietStop:true}});
  f.sp.onDodge();expect(f.hits).toHaveLength(1);
});
test('mercy banks five hits, heals on normal skill only and respects max health',()=>{
  const f=fixture('arm_mercy','arm_mercy_master');for(let i=0;i<5;i++)f.hit();f.sp.onSkill({ult:true});expect(f.g.player.hp).toBe(500);
  f.sp.onSkill({ult:false});expect(f.g.player.hp).toBe(540);f.sp.onSkill({ult:false});expect(f.g.player.hp).toBe(540);
});
test('lance requires ranged contact and has a shorter boss duration and cooldown',()=>{
  const f=fixture('arm_lance','arm_lance_master');f.hit();expect(f.e.slowT).toBe(0);
  f.e.pos.x=5;f.e.isBoss=true;f.hit();expect(f.e.slowT).toBe(.4);f.e.slowT=0;f.hit();expect(f.e.slowT).toBe(0);
});
test('relay requires target changes; aegis requires a skill before dodge',()=>{
  const f=fixture('arm_relay','arm_aegis');f.hit();f.hit();f.hit();expect(f.g.player.ult).toBe(0);
  f.hit(f.enemy());f.hit(f.enemy());expect(f.g.player.ult).toBe(3);
  f.sp.onDodge();expect(f.g.player.dr).toBe(0);f.sp.onSkill({ult:false});f.sp.onDodge();expect(f.sp.aegis).toBe(.15);expect(f.g.player.dr).toBe(0);
});
test('quiet/noProc/other-source/pause/death do not accumulate and area hits are bounded',()=>{
  const f=fixture('arm_mercy');for(const opts of [{quiet:true},{noProc:true},{source:{}}])f.hit(f.e,opts);
  f.g.paused=true;f.hit();f.g.paused=false;f.g.player.alive=false;f.hit();expect(f.sp.light).toBe(0);
  f.g.player.alive=true;f.hit();for(let i=0;i<30;i++)f.sp.onHit(f.e);expect(f.sp.light).toBe(1);
  f.sp.clear();expect(f.sp.light).toBe(0);
});
test('contact tiers, reduced motion, quiet/noProc and stop recovery are bounded',()=>{
  expect(contactProfile({quiet:true},true,true,false)).toBeNull();expect(contactProfile({noProc:true},true,true,false)).toBeNull();
  const profiles=[contactProfile({},false,false,false),contactProfile({kb:8},false,false,false),contactProfile({},false,true,false),contactProfile({finisher:true},true,false,false)];
  expect(new Set(profiles.map(p=>p?.tier)).size).toBe(4);
  expect(contactProfile({finisher:true},true,false,true)).toMatchObject({stop:0,particles:0});
  expect(contactProfile({quietStop:true},false,false,false)?.stop).toBe(0);
  const time=new TimeCtl();let advanced=0;
  for(let i=0;i<120;i++){time.hitstop(10);advanced+=time.step(1/60);expect(time.stop).toBeLessThanOrEqual(.12);}
  expect(advanced).toBeGreaterThan(.4);expect(new TimeCtl()._rearm).toBe(0);
});
test('beacon persists through occlusion without animation and disposes each resource once',()=>{
  const root=new Group(),b=new HeroBeacon(root);let released=0;
  let locatorMaterials=0,locatorTextures=0;
  b.locator.material.addEventListener('dispose',()=>locatorMaterials++);
  b.locatorTexture.addEventListener('dispose',()=>locatorTextures++);
  expect(b.locator.material.sizeAttenuation).toBe(false);
  b.root.traverse((o:any)=>{if(o.isMesh){expect(o.material.depthTest).toBe(false);o.geometry.addEventListener('dispose',()=>released++);o.material.addEventListener('dispose',()=>released++);}});
  b.update(true,1,{state:'attack',color:0xff8844});expect(b.root.rotation.y).toBe(1);expect(b.root.children).toHaveLength(5);
  expect(b.focusRing.visible).toBe(true);expect(b.primaryRing.material.color.getHex()).toBe(0xffffff);
  b.setFocus(true,0x8844ff);b.update(true,1,{state:'idle',color:0xff8844});expect(b.focusRing.visible).toBe(true);expect(b.focusRing.material.color.getHex()).toBe(0x8844ff);
  b.setFocus(false);b.update(true,1,{state:'idle'});expect(b.focusRing.visible).toBe(false);
  b.update(false,1);expect(b.root.visible).toBe(false);b.dispose();b.dispose();expect(root.children).toHaveLength(0);expect(released).toBe(8);
  expect(locatorMaterials).toBe(1);expect(locatorTextures).toBe(1);
});

test('hero beacon never adds a translucent body duplicate through occluders',()=>{
  const root=new Group(),model=new Group(),head=new Group(),bone=new Bone();
  head.name='Knight_Head';root.add(model);model.add(head,bone);
  const geometry=new BoxGeometry(),n=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(n*4),4));
  const weights=new Float32Array(n*4);for(let i=0;i<n;i++)weights[i*4]=1;
  geometry.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
  const source=new SkinnedMesh(geometry,new MeshBasicMaterial({transparent:false,opacity:1}));head.add(source);source.bind(new Skeleton([bone]));
  const b=new HeroBeacon(root,model as any);
  expect(b.occluded).toHaveLength(0); b.update(true,0);
  expect(source.material.transparent).toBe(false); expect(source.material.opacity).toBe(1);
  b.dispose();geometry.dispose();source.material.dispose();source.skeleton.dispose();
});

test('beacon arrow follows Actor.forward in world space for both rig orientations',()=>{
  const root=new Group(), b=new HeroBeacon(root);
  try {
    for(const faceFlip of [false,true]) for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
      root.rotation.y=yaw+(faceFlip?Math.PI:0);
      const parentYaw=root.rotation.y;
      b.update(true,yaw);root.updateMatrixWorld(true);
      const expected=Actor.prototype.forward.call({yaw} as any);
      const markerForward=new Vector3(0,0,1).transformDirection(b.root.matrixWorld);
      // The authored arrow points along -Y before its ground-plane rotation.
      const arrowForward=new Vector3(0,-1,0).transformDirection(b.arrow.matrixWorld);
      expect(markerForward.distanceTo(expected)).toBeLessThan(1e-10);
      expect(arrowForward.distanceTo(expected)).toBeLessThan(1e-10);
      expect(root.rotation.y).toBe(parentYaw);
    }
  } finally {b.dispose();}
});

test('ghost cleanup and Actor disposal preserve source skins and release beacon geometry once',()=>{
  for(const ghostFirst of [true,false]) {
    const scene=new Group(), root=new Group(), model=new Group(), bone=new Bone();
    scene.add(root);root.add(model);model.add(bone);
    const geometry=new BoxGeometry(), count=geometry.attributes.position.count;
    geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(count*4),4));
    const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
    geometry.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
    const skeleton=new Skeleton([bone]), source=new SkinnedMesh(geometry,new MeshBasicMaterial());
    source.name='TLL_fixture';model.add(source);source.bind(skeleton);
    const b=new HeroBeacon(root,model as any);expect(b.occluded).toHaveLength(0);
    const originalPositions=Array.from(geometry.attributes.position.array);
    let sourceDisposals=0,ghostDisposals=0;
    geometry.addEventListener('dispose',()=>sourceDisposals++);
    const fx:any={lite:false,items:[],scene,_keep:(m:any)=>m,
      add(obj:any,life:number,update:any,onEnd:any){scene.add(obj);this.items.push({obj,onEnd});}};
    FX.prototype.ghost.call(fx,model,0xffffff);
    const ghost=fx.items[0].obj;expect(ghost.children).toHaveLength(1);
    ghost.traverse((o:any)=>{if(o.isMesh){expect(o.geometry).not.toBe(geometry);o.geometry.addEventListener('dispose',()=>ghostDisposals++);}});
    const actor:any={game:{scene},root,model,mixer:new AnimationMixer(model)};
    if(ghostFirst)FX.prototype._finishItem.call(fx,0);
    b.dispose();b.dispose();Actor.prototype.dispose.call(actor);Actor.prototype.dispose.call(actor);
    if(!ghostFirst)FX.prototype._finishItem.call(fx,0);
    expect(sourceDisposals).toBe(0);expect(ghostDisposals).toBe(1);
    expect(Array.from(geometry.attributes.position.array)).toEqual(originalPositions);
    expect(model.children).toContain(source);expect(b.occluded).toHaveLength(0);
    geometry.dispose();
  }
});

// Three-finding repair regressions: real Player and battle handlers with explicit fakes.
import { Player } from '../src/game/player.js';
import { audio } from '../src/engine/audio.js';
test('Aegis outside Sanctuary after invulnerability and independent expiration',()=>{
 const f=fixture('arm_aegis'),p=f.g.player;p.game=f.g;
 p.dr=.4;p.drT=5;p.sanctum={pos:new Vector3(20,0,0),r:3};
 Object.assign(p,{stats:{def:0},def:{},invuln:0,state:'skill',flash(){},knockback(){}});
 Object.assign(f.g,{sp:{armory:f.sp},fx:{...f.g.fx,holyBurst(){},damage(){},burst(){}},renderer:{shake(){},flashScreen(){}},ui:{hurtVignette(){}}});
 f.sp.onSkill({ult:false});f.sp.onDodge();f.g.elapsed+=.41;
 Player.prototype.hurt.call(p,100);expect(p.hp).toBe(415);expect(p.dr).toBe(.4);expect(p.drT).toBe(5);
 f.g.elapsed+=.60;Player.prototype.hurt.call(p,100);expect(p.hp).toBe(315);
 p.pos.x=20;Player.prototype.hurt.call(p,100);expect(p.hp).toBe(255);
 f.sp.onSkill({ult:false});f.sp.onDodge();p.drT=5;
 Player.prototype.hurt.call(p,100);expect(p.hp).toBe(195);p.hp=255;p.drT=0;
 Player.prototype.hurt.call(p,100);expect(p.hp).toBe(170);
 f.g.elapsed+=1.01;Player.prototype.hurt.call(p,100);expect(p.hp).toBe(70);
});
test('death synchronously cancels anchor and counters before any revive branch; fresh revive dodge works',()=>{
 const f=fixture('arm_anchor','arm_echo','arm_aegis'),g=f.g,p=g.player;
 f.sp.onSkill({ult:false});f.sp.onDodge();f.sp.mark=f.e;f.sp.markHits=3;f.sp.markUntil=20;f.sp.light=5;
 const legacy={summon:42,armory:f.sp};g.sp=legacy;g.input={clear(){throw new Error('death entry observed');}};
 p.alive=false;g.elapsed+=.5;
 expect(()=>BaseBattle.prototype.onPlayerDeath.call(g)).toThrow('death entry observed');
 expect(f.sp.anchor).toBeNull();expect(f.sp.markHits).toBe(0);expect(f.sp.light).toBe(0);expect((f.sp as any).aegis).toBe(0);expect(legacy.summon).toBe(42);
 Object.assign(p,{mats:[],play(){}});Player.prototype.revive.call(p);g.elapsed+=2;f.sp.update();f.sp.onDodge();expect(f.pulls).toHaveLength(0);expect(f.hits).toHaveLength(0);
 g.elapsed+=.7;f.sp.update();expect(f.pulls).toHaveLength(1);
});
for(const Battle of [BaseBattle,RpgBattle])test(Battle===BaseBattle?'base contact upgrade bounded':'RPG contact upgrade bounded',()=>{
 let emissions=0,particles=0,bodies=0,sounds=0;const original=audio.hit;audio.hit=()=>{sounds++;};
 try{
 const g:any={active:true,elapsed:1,paused:false,player:{stats:{crit:0,ultGain:1},addUlt(){}},app:{reducedMotion:{matches:false}},dmgDealt:0,combo:0,maxCombo:0,feedbackCount:0,feedbackSound:false,ui:{setCombo(){}},timeCtl:new TimeCtl(),fx:{dmgLayer:{children:[]},damage(){},flash(){emissions++;},directional(){particles++;},contact(_p:any,_d:any,_c:any,o:any){emissions++;if(o.particles)particles++;}}};
 const e:any={alive:true,pos:new Vector3(),def:{scale:1},hurt:()=>10,receiveImpact(){bodies++;}};
 Battle.prototype.damageEnemy.call(g,e,10,{quietStop:true});
 for(let i=0;i<30;i++)Battle.prototype.damageEnemy.call(g,e,10,{finisher:true});
 expect(emissions).toBe(1);expect(particles).toBe(1);expect(sounds).toBe(2);expect(g.timeCtl.stop).toBe(.065);expect(g.combo).toBe(31);
 if(Battle===RpgBattle)expect(bodies).toBe(31);
 g.elapsed+=.061;g.app.reducedMotion.matches=true;g.timeCtl=new TimeCtl();
 Battle.prototype.damageEnemy.call(g,e,10,{quietStop:true});Battle.prototype.damageEnemy.call(g,e,10,{finisher:true});expect(particles).toBe(1);expect(g.timeCtl.stop).toBe(0);
 const prior=emissions,priorSounds=sounds;
 for(const opts of [{quiet:true},{noProc:true}])Battle.prototype.damageEnemy.call(g,e,10,opts);
 g.paused=true;g.elapsed+=1;Battle.prototype.damageEnemy.call(g,e,10,{finisher:true});expect(emissions).toBe(prior);expect(sounds).toBe(priorSounds);
 }finally{audio.hit=original;}
});

test('pure contact budget allows only one upgrade without moving the ordinary emission boundary',()=>{
 const light=contactProfile({quietStop:true},false,false,false),fin=contactProfile({finisher:true},false,false,false);
 const first=contactBudget(null,0,light);expect(first).toMatchObject({at:0,emit:true,finisher:false});
 const upgrade=contactBudget(first,.01,fin);expect(upgrade).toMatchObject({at:0,emit:false,finisher:true});
 expect(first?.finisher).toBe(false);
 expect(contactBudget(upgrade,.02,fin)).toBeNull();expect(contactBudget(upgrade,.059,light)).toBeNull();
 expect(contactBudget(upgrade,.06,light)).toMatchObject({at:.06,emit:true});expect(contactBudget(first,0,null)).toBeNull();
});


