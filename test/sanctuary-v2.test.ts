import {test,expect} from 'bun:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {cloneOathHall} from '../src/engine/oathhall-asset.js';
const bytes=readFileSync(new URL('../public/models/sanctuary-v2/sanctuary-v2.glb',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../public/models/sanctuary-v2/manifest.json',import.meta.url),'utf8'));
const data=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
test('sanctuary has original editable geometry, exported shading and bounded actual bytes',()=>{
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);expect(manifest.bytes).toBe(bytes.length);expect(bytes.length).toBeLessThan(4000000);expect(manifest.triangles).toBeLessThan(40000);
 expect(data.meshes.length).toBe(8);expect(data.materials.length).toBe(8);expect(data.meshes.filter((m:any)=>m.primitives[0].attributes.COLOR_0!==undefined).length).toBeGreaterThanOrEqual(6);
 expect(data.cameras||[]).toHaveLength(0);expect(data.animations||[]).toHaveLength(0);expect(data.skins||[]).toHaveLength(0);expect(data.extensions?.KHR_lights_punctual).toBeUndefined();expect(manifest.hero_modified).toBe(false);
});
test('actual sanctuary loader preserves source and reclaims all instance materials once',async()=>{
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');let original=0,count=0;
 gltf.scene.traverse((n:any)=>{if(n.isMesh){n.geometry.addEventListener('dispose',()=>original++);n.material.addEventListener('dispose',()=>original++);}});
 const instance=cloneOathHall(gltf.scene)!;expect(instance.name).toBe('TLL_SanctuaryV2');expect(instance.userData.visualVersion).toBe('sanctuary-v2');
 instance.traverse((n:any)=>{if(n.isMesh){n.geometry.addEventListener('dispose',()=>count++);n.material.addEventListener('dispose',()=>count++);if(/limestone|carved stone|shadow stone/.test(n.material.name))expect(n.material.vertexColors).toBe(true);}});
 instance.userData.dispose();instance.userData.dispose();expect(count).toBe(16);expect(original).toBe(0);
});
