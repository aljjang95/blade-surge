import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {resolveCrowdContacts} from '../src/game/crowd-contact.js';
import {buildLobbyWorld} from '../src/game/lobby-world.js';
import {LobbySightline} from '../src/engine/lobby-sightline.js';
import {LOBBY_VIEWS} from '../src/engine/lobby-camera.js';
import {Actor} from '../src/game/actor.js';
import {Player} from '../src/game/player.js';
import {AudioSys} from '../src/engine/audio.js';
import {contactProfile} from '../src/game/combat-contact.js';
const actor=(x=0,z=0,more:any={})=>({pos:new THREE.Vector3(x,0,z),radius:.7,alive:true,state:'hurt',...more});
test('coincident hurt and stunned enemies separate without moving the player or changing HP',()=>{
 const a=actor(0,0,{hp:100,stun:2}),b=actor(0,0,{hp:80}),p=actor();
 for(let i=0;i<40;i++)resolveCrowdContacts([a,b],p,null,1/60);
 expect(a.pos.distanceTo(b.pos)).toBeGreaterThan(1.05);expect(p.pos.length()).toBe(0);expect(a.hp).toBe(100);expect(b.hp).toBe(80);
});
test('boss, telegraph and role attack origins remain fixed; pause is inert',()=>{
 for(const frozen of [{isBoss:true},{telegraph:.2},{state:'attack'},{mobRole:{plan:{}}}]){
  const a=actor(0,0,frozen),b=actor();resolveCrowdContacts([a,b],null,null,1/60);expect(a.pos.length()).toBe(0);expect(b.pos.length()).toBeGreaterThan(0);
 }
 const a=actor(),b=actor();for(const dt of [0,-1,NaN])expect(resolveCrowdContacts([a,b],null,null,dt)).toBe(0);expect(a.pos.length()).toBe(0);
});
test('crowd correction obeys world collision and ignores dead/spawning instances',()=>{
 let n=0;const w={resolve(x:number,z:number){n++;return [x,z];}};const a=actor(),b=actor();resolveCrowdContacts([a,b],null,w,1/60);expect(n).toBe(2);expect(a.pos.length()).toBe(0);
 expect(resolveCrowdContacts([a,actor(0,0,{alive:false}),actor(0,0,{spawning:true})],null,null,1/60)).toBe(0);
});
test('citadel has bounded actual 360 geometry and each resource disposes once',()=>{
 const g=buildLobbyWorld();expect(g.children).toHaveLength(6);let triangles=0,disposed=0;
 g.traverse((o:any)=>{if(!o.isMesh)return;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;o.geometry.addEventListener('dispose',()=>disposed++);o.material.addEventListener('dispose',()=>disposed++);});
 expect(triangles).toBeLessThan(16000);const box=new THREE.Box3().setFromObject(g.children[0]);expect(box.max.z).toBeGreaterThan(30);expect(box.min.z).toBeLessThan(-20);expect(box.max.x).toBeGreaterThan(20);expect(box.min.x).toBeLessThan(-20);
 g.userData.dispose();g.userData.dispose();expect(disposed).toBe(12);
});
test('lobby sightline raises camera over a blocker without moving geometry or hero',()=>{
 const wall=new THREE.Mesh(new THREE.BoxGeometry(3,1,1),new THREE.MeshBasicMaterial());wall.position.set(0,1.3,3);wall.updateMatrixWorld();
 const s=new LobbySightline(),cam=new THREE.Vector3(0,2,5),at=new THREE.Vector3();expect(s.solve(cam,at,[wall])).toBeGreaterThan(0);expect(cam.y).toBe(2);expect(at.length()).toBe(0);expect(s.clear).toBe(true);wall.geometry.dispose();(wall.material as THREE.Material).dispose();
});
test('citadel preset exposes the outward world instead of hiding it behind free orbit only',()=>{
 expect(LOBBY_VIEWS.city).toMatchObject({yaw:180,pitch:12,zoom:78});expect(LOBBY_VIEWS.front.zoom).toBeLessThan(96);
});
test('actual local strike pose is bounded, resets, and respects reduced motion',()=>{
 const a:any={motionRoot:new THREE.Group(),game:{app:{reducedMotion:{matches:false}}}};
 Actor.prototype.receiveStrikeRecoil.call(a,1);Actor.prototype.updateCombatPose.call(a,.016);expect(a.motionRoot.position.z).toBeLessThan(-.05);
 Actor.prototype.updateCombatPose.call(a,.2);expect(a.motionRoot.position.length()).toBe(0);
 a.game.app.reducedMotion.matches=true;Actor.prototype.receiveStrikeRecoil.call(a,1);expect(a._strikeRecoil).toBeNull();
});
test('ordinary basic contact requests haptics without making misses into hits',()=>{
 expect(contactProfile({basic:true},false,false,false)?.haptic).toBe(14);
 expect(contactProfile({basic:true,crit:true},true,false,false)?.haptic).toBe(22);
 expect(contactProfile({basic:true,finisher:true},false,false,false)?.haptic).toEqual([18,12,36]);
 expect(contactProfile({quiet:true,basic:true},false,false,false)).toBeNull();expect(contactProfile({basic:true},false,false,true)?.stop).toBe(0);
});
test('motor requests coalesce a crowd, respect OFF, cancellation, rejection and invalid data',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator'),calls:any[]=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{vibrate:(p:any)=>{calls.push(p);return true;}}});
 try{const a=new AudioSys();expect(a.vibe(12)).toBe(true);expect(a.vibe(12)).toBe(false);a.haptics=false;expect(a.vibe(28)).toBe(false);expect(a.vibe(0)).toBe(true);expect(a.vibe(NaN)).toBe(false);expect(calls).toEqual([12,0]);}
 finally{if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}
});
test('dodge preserves next earned combo step but cancelled windup cannot skip a step',()=>{
 for(const hitDone of [false,true]){const p:any={state:'attack',current:{},comboIdx:2,hitDone,def:{combo:Array(6),color:0,jobId:null},stopTrail(){},vel:new THREE.Vector3(),faceDir(){},play(){},game:{fx:{dust(){}},hasProc:()=>false}};
 Player.prototype.dodge.call(p,new THREE.Vector3(1,0,0));expect(p.comboResume.idx).toBe(hitDone?3:2);expect(p.state).toBe('dodge');}
});
