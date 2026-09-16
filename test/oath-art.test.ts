import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneOathHall,preloadOathHall} from '../src/engine/oathhall-asset.js';
import {finishOathKnightMaterial} from '../src/engine/hero-surface-finish.js';
const bytes=readFileSync(new URL('../public/models/oathhall-v2/oathhall-v2.glb',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../public/models/oathhall-v2/manifest.json',import.meta.url),'utf8'));
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const parse=()=>new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
test('real Blender export matches its manifest and fits eight material / 40k triangle budget',()=>{
 expect(bytes.toString('utf8',0,4)).toBe('glTF');expect(bytes.readUInt32LE(4)).toBe(2);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
 expect(bytes.length).toBe(manifest.bytes);expect(bytes.length).toBeLessThan(2000000);
 expect(doc.materials.length).toBeLessThanOrEqual(8);expect(manifest.triangles).toBeLessThan(40000);
 expect(doc.meshes.reduce((n:number,m:any)=>n+m.primitives.length,0)).toBeLessThanOrEqual(8);
 expect(doc.animations||[]).toHaveLength(0);expect(doc.skins||[]).toHaveLength(0);expect(doc.cameras||[]).toHaveLength(0);
 expect(doc.extensions?.KHR_lights_punctual).toBeUndefined();expect(manifest.hero_modified).toBe(false);
});
test('actual GLB clones own resources and repeated disposal leaves cached template intact',async()=>{
 const source=(await parse()).scene;let sourceDisposals=0;
 source.traverse((o:any)=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>sourceDisposals++);o.material.addEventListener('dispose',()=>sourceDisposals++);}});
 const first=cloneOathHall(source)!,second=cloneOathHall(source)!;let disposed=0;
 first.traverse((o:any)=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>disposed++);o.material.addEventListener('dispose',()=>disposed++);}});
 first.userData.dispose();first.userData.dispose();expect(disposed).toBe(doc.meshes.length*2);expect(sourceDisposals).toBe(0);
 expect(second.children).toHaveLength(source.children.length);second.userData.dispose();expect(sourceDisposals).toBe(0);
});
test('optional hall network failure returns fallback state rather than trapping boot',async()=>{
 let calls=0;const fetcher:any=async()=>{calls++;throw Error('offline');};
 expect(await preloadOathHall(fetcher)).toBe(false);expect(await preloadOathHall(fetcher)).toBe(false);expect(calls).toBe(1);
 expect(cloneOathHall()).toBeNull();
});
for(const [name,roughness,metalness] of [['TLL_skin',.9,0],['TLL_woven-cloth',.94,0],['TLL_forged-metal',.48,.42]] as const)test(`${name}: finish changes only cloned material response`,()=>{
 const source=new THREE.MeshStandardMaterial({color:0xbb9988,roughness:.85,metalness:0});source.name=name;source.userData.tllAuthored=true;
 const map=new THREE.Texture();source.map=map;const clone=source.clone(),before=source.color.clone();finishOathKnightMaterial(clone);
 expect(clone.color.equals(before)).toBe(true);expect(clone.map).toBe(map);expect(clone.roughness).toBe(roughness);expect(clone.metalness).toBe(metalness);
 expect(source.roughness).toBe(.85);expect(source.metalness).toBe(0);expect(source.userData.oathFinish).toBeUndefined();
});
test('unrelated source materials never receive knight treatment',()=>{
 const m=new THREE.MeshStandardMaterial({roughness:.6,metalness:.2});m.name='unknown';finishOathKnightMaterial(m);expect(m.roughness).toBe(.6);expect(m.metalness).toBe(.2);
});

test('distant colour planes skip dynamic shadows while source materials remain unchanged',async()=>{
 const source=(await parse()).scene,copy=cloneOathHall(source)!;
 source.traverse((o:any)=>{if(o.isMesh)expect(o.material.isMeshStandardMaterial).toBe(true);});
 let distant=0,stone=0;
 copy.traverse((o:any)=>{if(!o.isMesh)return;
  if(/^08 /.test(o.material.name)){distant++;expect(o.material.isMeshBasicMaterial).toBe(true);expect(o.castShadow).toBe(false);expect(o.receiveShadow).toBe(false);}
  if(/^(01|02|05|06) /.test(o.material.name)){stone++;expect(o.material.side).toBe(THREE.FrontSide);}
 });
 expect(distant).toBe(1);expect(stone).toBe(4);copy.userData.dispose();
});
