import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import CONTRACT from '../src/data/knight-head-balance-v1.json';
import { heroModelPaths } from '../src/engine/hero-model-paths.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { prepareModel, spawnCharacter, disposeCharacter, materialsOf } from '../src/engine/assets.js';
import { decodeKnightHeadInput, unpackGlb, packGlb } from '../tools/art/decode-knight-head-balance-v1.mjs';

const root=path.resolve(import.meta.dirname,'..'),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const originalBase=readFileSync(path.join(root,CONTRACT.sources.base.path));
const originalFit=readFileSync(path.join(root,CONTRACT.sources.fitting.path));
// 기본값은 활성 public 쌍이다. 별도 생성물 경로 검사는 public 선택·해시 검사와 분리한다.
const artifactDir=process.env.KNIGHT_HEAD_BALANCE_ARTIFACT_DIR || path.join(root,'public/models/heroes-next');
const basePath=path.join(artifactDir,'knight-head-balance-v1.glb'),fitPath=path.join(artifactDir,'knight-fitting-head-balance-v1.glb');
const generated=existsSync(basePath)&&existsSync(fitPath);

test('활성 Knight는 실제 선언 쌍을 선택하고 비활성·다른 네 영웅·잘못된 쌍을 구분한다',()=>{
  const inactive={...CONTRACT,status:'SOURCE_RECIPE_NOT_GENERATED',useInGame:false};
  for(const name of ['Knight','Barbarian','Mage','Rogue','Ranger']){
    expect(heroModelPaths(name,inactive)).toEqual({base:`/models/${name}.glb`,fitting:`/models/heroes-v3/${name.toLowerCase()}-v3.glb`,proportionRevision:null});
  }
  const pair=CONTRACT;
  expect(pair.useInGame).toBe(true);expect(pair.status).toBe('GENERATED');
  expect(heroModelPaths('Knight',pair)).toEqual({base:CONTRACT.assets.base.path,fitting:CONTRACT.assets.fitting.path,proportionRevision:'knight-head-balance-v1'});
  for(const name of ['Barbarian','Mage','Rogue','Ranger'])expect(heroModelPaths(name,pair)).toEqual({base:`/models/${name}.glb`,fitting:`/models/heroes-v3/${name.toLowerCase()}-v3.glb`,proportionRevision:null});
  expect(()=>heroModelPaths('Knight',{...pair,id:''})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,id:'unrecognized-revision'})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,status:'SOURCE_RECIPE_NOT_GENERATED'})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,assets:{...pair.assets,fitting:{...pair.assets.fitting,sha256:null}}})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,assets:{...pair.assets,base:{...pair.assets.base,sha256:null}}})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,assets:{...pair.assets,base:{...pair.assets.base,sha256:'invalid'}}})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,assets:{...pair.assets,base:{...pair.assets.base,path:'/models/Barbarian.glb'}}})).toThrow();
  expect(()=>heroModelPaths('Knight',{...pair,assets:{...pair.assets,fitting:{...pair.assets.fitting,path:'/models/heroes-v3/knight-v3.glb'}}})).toThrow();
});

test('활성 기본 selector의 public 쌍은 두 실제 생성물 해시와 모두 일치해야 한다',()=>{
  expect(CONTRACT.useInGame).toBe(true);
  expect(CONTRACT.status).toBe('GENERATED');
  expect(heroModelPaths('Knight')).toEqual({base:CONTRACT.assets.base.path,fitting:CONTRACT.assets.fitting.path,proportionRevision:CONTRACT.id});
  expect(CONTRACT.assets.base.sha256).toBe('694064b1774f4f012fcef68da380175ea432cc5e86ed9280894b7af3af0ad633');
  expect(CONTRACT.assets.fitting.sha256).toBe('f59bea70236f0c2abc6c70a7d75ae61c50d3651586a21c2bd946230c96793685');
  for(const asset of [CONTRACT.assets.base,CONTRACT.assets.fitting]){
    const expectedHash=asset.sha256;
    if(expectedHash===null)throw new Error('Enabled head-balance asset requires a generated SHA-256');
    const file=path.join(root,'public',asset.path.slice(1));expect(existsSync(file)).toBe(true);expect(hash(readFileSync(file))).toBe(expectedHash);
  }
});

test('actual frozen Knight streams match the recipe and use the original head/hand rig',async()=>{
  expect(hash(originalBase)).toBe(CONTRACT.sources.base.sha256);expect(hash(originalFit)).toBe(CONTRACT.sources.fitting.sha256);
  const {headInput}=await decodeKnightHeadInput(originalBase,CONTRACT);
  expect(headInput.streams.POSITION.rows).toHaveLength(727);
  expect(headInput.streams.INDICES.rows).toHaveLength(2868);
  const {doc}=unpackGlb(originalBase);
  expect(doc.nodes[doc.skins[0].joints[14]].name).toBe('head');
  expect(doc.skins[0].joints).toHaveLength(41);expect(doc.animations).toHaveLength(40);
  expect(doc.nodes.some((n:any)=>n.name==='handslot.r')).toBe(true);
  expect(doc.nodes.some((n:any)=>n.name==='handslot.l')).toBe(true);
  let anchored=0;
  for(const row of headInput.streams.POSITION.rows){if(row[1]*headInput.node.scale[1]+headInput.node.translation[1]<=1.30)anchored++;}
  expect(anchored).toBe(81);
  expect(hash(readFileSync(path.join(root,CONTRACT.sources.base.path)))).toBe(CONTRACT.sources.base.sha256);
},30000);

function rows(doc:any,bin:Buffer,index:number):number[][]{
  const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  const formats:Record<number,[string,number]>={5120:['readInt8',1],5123:['readUInt16LE',2],5126:['readFloatLE',4]};
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],width=widths[a.type]!,fmt=formats[a.componentType]!;
  expect(v.buffer).toBe(0);expect(v.extensions).toBeUndefined();
  const start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||width*fmt[1];
  return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,k)=>(bin as any)[fmt[0]](start+i*stride+k*fmt[1])));
}
function triangles(doc:any){return doc.meshes.reduce((sum:number,m:any)=>sum+m.primitives.reduce((n:number,p:any)=>n+doc.accessors[p.indices].count/3,0),0);}

async function parsed(bytes:Buffer){
  const {doc,bin}=unpackGlb(bytes),copy=structuredClone(doc);
  const strip=(v:any)=>{if(!v||typeof v!=='object')return;for(const key of Object.keys(v)){if(key.endsWith('Texture')&&v[key]?.index!==undefined)delete v[key];else strip(v[key]);}};
  for(const material of copy.materials||[])strip(material);
  const packed=packGlb(copy,bin),loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
}
function headSkin(root:THREE.Object3D){let result:THREE.SkinnedMesh|undefined;root.getObjectByName('Knight_Head')?.traverse(o=>{if(o instanceof THREE.SkinnedMesh)result=o;});expect(result).toBeDefined();return result!;}
function deform(skin:THREE.SkinnedMesh,index:number){return skin.applyBoneTransform(index,new THREE.Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'),index)).applyMatrix4(skin.matrixWorld);}
function bounds(skin:THREE.SkinnedMesh){const box=new THREE.Box3();for(let i=0;i<skin.geometry.getAttribute('position').count;i++)box.expandByPoint(deform(skin,i));return box;}

describe.skipIf(!generated)('generated actual Knight pair: required asset gates, never inferred from source readiness',()=>{
  test('base preserves every original binary byte, rig/clip/weapon/UV/weight stream and neck anchor',async()=>{
    const bytes=readFileSync(basePath),before=unpackGlb(originalBase),after=unpackGlb(bytes);
    expect(after.bin.subarray(0,before.bin.length).equals(before.bin)).toBe(true);
    for(const key of ['nodes','skins','animations','materials','textures','images','scenes'])expect(after.doc[key]).toEqual(before.doc[key]);
    expect(after.doc.accessors.slice(0,before.doc.accessors.length)).toEqual(before.doc.accessors);
    expect(after.doc.bufferViews.slice(0,before.doc.bufferViews.length)).toEqual(before.doc.bufferViews);
    for(let i=0;i<before.doc.meshes.length;i++)if(i!==11)expect(after.doc.meshes[i]).toEqual(before.doc.meshes[i]);
    const a=after.doc.meshes[11].primitives[0],b=before.doc.meshes[11].primitives[0];
    expect(a.indices).toBe(b.indices);expect(a.material).toBe(b.material);
    for(const key of ['TEXCOORD_0','JOINTS_0','WEIGHTS_0'])expect(a.attributes[key]).toBe(b.attributes[key]);
    const {headInput}=await decodeKnightHeadInput(originalBase,CONTRACT),encoded=rows(after.doc,after.bin,a.attributes.POSITION),normal=rows(after.doc,after.bin,a.attributes.NORMAL);
    expect(encoded).toHaveLength(727);expect(normal).toHaveLength(727);
    let anchors=0;const box=new THREE.Box3();
    for(let i=0;i<encoded.length;i++){
      const old=headInput.streams.POSITION.rows[i],node=headInput.node;
      if(old[1]*node.scale[1]+node.translation[1]<=1.30){expect(encoded[i]).toEqual(old);expect(normal[i]).toEqual(headInput.streams.NORMAL.rows[i]);anchors++;}
      const p=new THREE.Vector3(...(encoded[i] as [number,number,number])).multiply(new THREE.Vector3(node.scale[0],node.scale[1],node.scale[2])).add(new THREE.Vector3(node.translation[0],node.translation[1],node.translation[2]));box.expandByPoint(p);
      expect(normal[i]!.every(Number.isFinite)).toBe(true);const length=new THREE.Vector3(...(normal[i] as [number,number,number])).divideScalar(127).length();expect(length).toBeGreaterThan(.98);expect(length).toBeLessThan(1.02);
    }
    expect(anchors).toBe(81);expect(Array.from(box.min.toArray())).toEqual(CONTRACT.predictedQuantizedHeadBounds.min);expect(Array.from(box.max.toArray())).toEqual(CONTRACT.predictedQuantizedHeadBounds.max);
    expect(bytes.length-originalBase.length).toBeLessThan(16000);expect(triangles(after.doc)).toBe(triangles(before.doc));
  },30000);

  test('220tri coronet replaces the existing head mesh, leaves all other fitting surfaces/material roles exact',()=>{
    const before=unpackGlb(originalFit),after=unpackGlb(readFileSync(fitPath));
    expect(after.bin.subarray(0,before.bin.length).equals(before.bin)).toBe(true);
    expect(after.doc.nodes).toEqual(before.doc.nodes);expect(after.doc.materials).toEqual(before.doc.materials);
    expect(after.doc.meshes.length).toBe(before.doc.meshes.length);
    for(let i=0;i<before.doc.meshes.length;i++)if(i!==20)expect(after.doc.meshes[i]).toEqual(before.doc.meshes[i]);
    const primitive=after.doc.meshes[20].primitives[0];expect(after.doc.meshes[20].primitives).toHaveLength(1);expect(primitive.material).toBe(1);
    expect(after.doc.accessors[primitive.indices].count).toBe(660);expect(after.doc.accessors[primitive.attributes.POSITION].count).toBe(660);
    expect(triangles(before.doc)-triangles(after.doc)).toBe(2764);
    expect(after.doc.skins).toBeUndefined();expect(after.doc.animations).toBeUndefined();expect(after.doc.textures).toEqual(before.doc.textures);
    const positions=rows(after.doc,after.bin,primitive.attributes.POSITION);expect(Math.max(...positions.map(p=>p[1]!))).toBeLessThanOrEqual(2.20);
  });

  test('all40 real clips preserve bone/hand motion and81 neck vertices; actual head bounds do not expand beyond.02m',async()=>{
    const original=spawnCharacter(await parsed(originalBase)),candidate=spawnCharacter(await parsed(readFileSync(basePath)));
    const oldHead=headSkin(original.root),newHead=headSkin(candidate.root),{headInput}=await decodeKnightHeadInput(originalBase,CONTRACT);
    const anchored=headInput.streams.POSITION.rows.map((p:number[],i:number)=>p[1]!*headInput.node.scale[1]+headInput.node.translation[1]<=1.30?i:-1).filter((i:number)=>i>=0);
    expect(Object.keys(candidate.clips)).toEqual(Object.keys(original.clips));let samples=0;
    for(const name of Object.keys(original.clips))for(const fraction of [0,.25,.5,.75,.95]){
      for(const character of [original,candidate]){character.mixer.stopAllAction();const action=character.mixer.clipAction(character.clips[name]!);action.reset().play();action.time=character.clips[name]!.duration*fraction;character.mixer.update(0);character.root.updateMatrixWorld(true);}
      for(const name of ['head','handslotr','handslotl']){
        const oldNode=original.root.getObjectByName(name),newNode=candidate.root.getObjectByName(name);
        expect(oldNode).toBeDefined();expect(newNode).toBeDefined();
        expect(newNode!.matrixWorld.elements).toEqual(oldNode!.matrixWorld.elements);
      }
      for(const i of anchored)expect(deform(oldHead,i).distanceTo(deform(newHead,i))).toBeLessThan(.0002);
      const a=bounds(oldHead),b=bounds(newHead);expect([...b.min.toArray(),...b.max.toArray()].every(Number.isFinite)).toBe(true);
      for(const axis of ['x','y','z'] as const){expect(a.min[axis]-b.min[axis]).toBeLessThan(.02);expect(b.max[axis]-a.max[axis]).toBeLessThan(.02);}samples++;
    }
    expect(samples).toBe(200);disposeCharacter(original.root,original.mixer);disposeCharacter(candidate.root,candidate.mixer);
  },30000);

  test('actual assembled pair keeps three fitting roles and cloned instance cleanup preserves cache geometry',async()=>{
    const source=await parsed(readFileSync(basePath)),fitting=await parsed(readFileSync(fitPath));
    assembleHeroIdentity(source,fitting,'Knight','expedition-v3');prepareModel(source);
    const fittingMeshes:THREE.SkinnedMesh[]=[];source.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh&&o.name.startsWith('TLL_Knight_'))fittingMeshes.push(o);});
    expect(fittingMeshes).toHaveLength(3);const geometries=new Set<THREE.BufferGeometry>();source.scene.traverse(o=>{if(o instanceof THREE.Mesh)geometries.add(o.geometry);});
    let sourceDisposals=0;for(const geometry of geometries)geometry.addEventListener('dispose',()=>sourceDisposals++);
    const clone=spawnCharacter(source),materials=new Set<THREE.Material>();clone.root.traverse(o=>{if(o instanceof THREE.Mesh){expect(geometries.has(o.geometry)).toBe(true);for(const material of materialsOf(o))materials.add(material);}});
    let materialDisposals=0;for(const material of materials)material.addEventListener('dispose',()=>materialDisposals++);
    disposeCharacter(clone.root,clone.mixer);expect(sourceDisposals).toBe(0);expect(materialDisposals).toBe(materials.size);
    expect(hash(readFileSync(path.join(root,CONTRACT.sources.base.path)))).toBe(CONTRACT.sources.base.sha256);expect(hash(readFileSync(path.join(root,CONTRACT.sources.fitting.path)))).toBe(CONTRACT.sources.fitting.sha256);
  },30000);
});
