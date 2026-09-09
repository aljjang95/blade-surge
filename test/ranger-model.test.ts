import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareModel, spawnCharacter, disposeCharacter, requiredModelAliases } from '../src/engine/assets.js';
import { applyLook } from '../src/game/look.js';
import { HEROES } from '../src/data/heroes.js';
import { createArrowVisual, releaseProjectileVisual } from '../src/engine/arrow-visual.js';
import { Battle } from '../src/game/battle.js';
import { heroVoiceName } from '../src/engine/hero-voice.js';

test('ranger portrait, all skill icons and neutral narration exist in the shipped assets',()=>{
  for(const path of [HEROES.ranger.portrait,...HEROES.ranger.skills.map(s=>s.icon)]) expect(existsSync(new URL('../public'+path,import.meta.url))).toBe(true);
  for(const event of ['select','revive','death','win','low_hp']) expect(existsSync(new URL('../public/sfx/voice/'+heroVoiceName('ranger',event)+'.mp3',import.meta.url))).toBe(true);
});

// Preserve the actual geometry, inverse binds and 41 animation tracks. Only
// browser image decoding is removed from the head material for this Node test.
async function loadRanger() {
  const bytes=readFileSync(new URL('../public/models/Ranger.glb',import.meta.url));
  const oldLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+oldLength).toString());
  for(const m of doc.materials) if(m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  const json=Buffer.from(JSON.stringify(doc)),pad=Buffer.alloc((4-json.length%4)%4,32),tail=bytes.subarray(20+oldLength);
  const header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(20+json.length+pad.length+tail.length,8);header.writeUInt32LE(json.length+pad.length,12);
  const packed=Buffer.concat([header,json,pad,tail]);
  const gltf=await new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
  return prepareModel(gltf);
}

test('Ranger ships a real bow action, required clips, original head and equipment-fitting skeleton',async()=>{
  const source=await loadRanger();
  for(const name of requiredModelAliases('hero','ranger')) expect(source.animations.some(c=>c.name===name)).toBe(true);
  expect(source.animations).toHaveLength(41);
  expect(source.scene.userData.tllIdentity).toBe('casual-v2');
  const instance=spawnCharacter(source);
  expect(instance.root.getObjectByName('Bow')).toBeDefined();
  expect(instance.root.getObjectByName('Ranger_Head')).toBeDefined();
  const arm=instance.root.getObjectByName('handslotl')!;
  const clip=instance.mixer.clipAction(instance.clips.Bow_Shoot!);clip.play();
  instance.mixer.update(.1);instance.root.updateMatrixWorld(true);const before=arm.getWorldPosition(new THREE.Vector3());
  instance.mixer.update(.25);instance.root.updateMatrixWorld(true);const after=arm.getWorldPosition(new THREE.Vector3());
  expect(before.distanceTo(after)).toBeGreaterThan(.005);
  instance.mixer.stopAllAction();
  for(const id of ['a_leather','a_chain','a_scale','exp_glasswarden_armor','exp_emberknight_armor','exp_starreader_armor']){
    applyLook(instance.root,HEROES.ranger,{armor:{id,enh:3}});
    const meshes:THREE.Mesh[]=[];instance.root.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.equippedArmor)meshes.push(o);});
    expect(meshes.length).toBeGreaterThanOrEqual(10);
    expect(meshes.every(o=>o.parent instanceof THREE.Bone)).toBe(true);
    for(const name of ['Idle','Bow_Shoot','Running_A','Death_A']){
      instance.mixer.stopAllAction();instance.mixer.clipAction(instance.clips[name]!).play();instance.mixer.update(.2);instance.root.updateMatrixWorld(true);
      for(const mesh of meshes) expect(mesh.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      const box=new THREE.Box3().setFromObject(instance.root);expect(box.getSize(new THREE.Vector3()).length()).toBeLessThan(6);
    }
  }
  applyLook(instance.root,HEROES.ranger,{});expect(instance.root.userData.armorAppearance).toBeUndefined();
  disposeCharacter(instance.root,instance.mixer);
});

test('arrows point along flight, share geometry and free only their own material',()=>{
  const a=createArrowVisual(0xaaffaa,.4,new THREE.Vector3(1,0,0)),b=createArrowVisual(0xaaffaa,.4,new THREE.Vector3(0,0,1));
  expect(a.geometry).toBe(b.geometry);
  expect(new THREE.Vector3(0,0,1).applyQuaternion(a.quaternion).distanceTo(new THREE.Vector3(1,0,0))).toBeLessThan(.001);
  let disposed=0,geoDisposed=0;a.material.addEventListener('dispose',()=>disposed++);a.geometry.addEventListener('dispose',()=>geoDisposed++);
  releaseProjectileVisual(a);expect(disposed).toBe(1);expect(geoDisposed).toBe(0);releaseProjectileVisual(b);
});

test('actual projectile collision retains ranger finisher feedback and removes the arrow',()=>{
  const hits:any[]=[];const enemy={alive:true,spawning:false,radius:.5,pos:new THREE.Vector3(0,0,1)};
  const game:any={scene:new THREE.Scene(),projectiles:[],enemies:[enemy],fx:{burst(){}},damageEnemy:(e:any,dmg:number,opts:any)=>hits.push({e,dmg,opts})};
  game.spawnProjectile=Battle.prototype.spawnProjectile;
  game.spawnProjectile({pos:new THREE.Vector3(0,1,0),dir:new THREE.Vector3(0,0,1),speed:10,radius:.4,dmg:120,color:0xffaa44,owner:{},kind:'slash',visual:'arrow',finisher:true});
  const mesh=game.projectiles[0].mesh;let disposed=0;mesh.material.addEventListener('dispose',()=>disposed++);
  Battle.prototype.updateProjectiles.call(game,.1);
  expect(hits).toHaveLength(1);expect(hits[0].opts.finisher).toBe(true);expect(hits[0].opts.kind).toBe('slash');
  expect(game.projectiles).toHaveLength(0);expect(game.scene.children).toHaveLength(0);expect(disposed).toBe(1);
});
