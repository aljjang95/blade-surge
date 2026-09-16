import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { prepareModel, spawnCharacter, disposeCharacter, requiredModelAliases, materialsOf } from '../src/engine/assets.js';

// Numerical CPU skinning proof using the delivery GLBs, not a synthetic skeleton.
// Only image references in an in-memory JSON copy are omitted. Original geometry,
// inverse binds, node transforms, materials' scalar values and animation bytes stay intact.
async function readModel(path:string) {
  const url = new URL('../public/'+path,import.meta.url), bytes = readFileSync(url);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length).toString());
  const stripImages = (value:any) => {
    if (!value || typeof value !== 'object') return;
    for(const key of Object.keys(value)) {
      if(key.endsWith('Texture') && value[key]?.index !== undefined) delete value[key];
      else stripImages(value[key]);
    }
  };
  for(const material of doc.materials||[]) stripImages(material);
  const json=Buffer.from(JSON.stringify(doc)),pad=Buffer.alloc((4-json.length%4)%4,32),tail=bytes.subarray(20+length);
  const header=Buffer.from(bytes.subarray(0,20));
  header.writeUInt32LE(20+json.length+pad.length+tail.length,8); header.writeUInt32LE(json.length+pad.length,12);
  const packed=Buffer.concat([header,json,pad,tail]);
  const loader=new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf=await loader.parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
  return {gltf,url,hash};
}
function skins(root:THREE.Object3D) {
  const list:THREE.SkinnedMesh[]=[];
  root.traverse(o=>{if(o instanceof THREE.SkinnedMesh) list.push(o);}); return list;
}
function skinBounds(list:THREE.SkinnedMesh[]) {
  const box=new THREE.Box3(),point=new THREE.Vector3();
  for(const skin of list) {
    const position=skin.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++) {
      skin.applyBoneTransform(i,point.fromBufferAttribute(position,i)).applyMatrix4(skin.matrixWorld);
      if(![point.x,point.y,point.z].every(Number.isFinite)) throw new Error(`Nonfinite animated vertex: ${skin.name}:${i}`);
      box.expandByPoint(point);
    }
  }
  return box;
}

for(const name of ['Knight','Barbarian','Mage','Rogue','Ranger']) test(`${name} V3: real rig/required clips/rest skin/clone disposal`,async()=>{
  const source=await readModel(`models/${name}.glb`),fitting=await readModel(`models/heroes-v3/${name.toLowerCase()}-v3.glb`);
  const originalClips=[...source.gltf.animations];
  const head=source.gltf.scene.getObjectByName(name+'_Head'); expect(head).toBeDefined();
  const retainedRanger=skins(source.gltf.scene).filter(s=>s.name.startsWith('TLL_'));
  assembleHeroIdentity(source.gltf,fitting.gltf,name,'expedition-v3');
  // prepareModel subsequently batches compatible retained parts into merged skins.
  if(name==='Ranger') for(const skin of retainedRanger) expect(skin.parent).not.toBeNull();
  prepareModel(source.gltf);
  expect(source.gltf.animations).toEqual(originalClips);
  expect(source.gltf.scene.getObjectByName(name+'_Head')).toBe(head);
  const authored=skins(source.gltf.scene).filter(s=>materialsOf(s).some((m:THREE.Material)=>m.userData.expeditionFinish==='v3'));
  expect(authored.length).toBeGreaterThanOrEqual(2);
  source.gltf.scene.updateMatrixWorld(true);
  let maxRestError=0;
  const vertex=new THREE.Vector3();
  for(const skin of authored) {
    const positions=skin.geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++) {
      vertex.fromBufferAttribute(positions,i);
      maxRestError=Math.max(maxRestError,skin.applyBoneTransform(i,vertex.clone()).distanceTo(vertex));
    }
  }
  expect(maxRestError).toBeLessThan(.0001);

  const sourceSkins=skins(source.gltf.scene),originalBones=sourceSkins.flatMap(s=>s.skeleton.bones);
  const restBones=originalBones.map(b=>b.matrixWorld.clone());
  const instance=spawnCharacter(source.gltf),instanceSkins=skins(instance.root);
  const originalGeometry=new Set(sourceSkins.map(s=>s.geometry));
  for(const skin of instanceSkins) {
    expect(originalGeometry.has(skin.geometry)).toBe(true);
    expect(originalBones.includes(skin.skeleton.bones[0]!)).toBe(false);
  }
  instance.root.updateMatrixWorld(true);
  const rest=skinBounds(instanceSkins),required=requiredModelAliases('hero',name.toLowerCase());
  let sampled=0,maxSpan=0,animatedMotion=0;
  for(const alias of required) {
    const clip=instance.clips[alias]; expect(clip).toBeDefined();
    expect(clip!.tracks.length).toBeGreaterThan(0);
    for(const fraction of [0,.5,.95]) {
      instance.mixer.stopAllAction(); const action=instance.mixer.clipAction(clip!);
      action.reset().play(); action.time=clip!.duration*fraction; instance.mixer.update(0);
      instance.root.updateMatrixWorld(true);
      const bounds=skinBounds(instanceSkins),span=bounds.getSize(new THREE.Vector3()).length();
      expect(span).toBeGreaterThan(.2); expect(span).toBeLessThan(8);
      expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(10);
      maxSpan=Math.max(maxSpan,span); animatedMotion=Math.max(animatedMotion,bounds.min.distanceTo(rest.min),bounds.max.distanceTo(rest.max)); sampled++;
    }
  }
  expect(animatedMotion).toBeGreaterThan(.05);
  for(let i=0;i<originalBones.length;i++) expect(originalBones[i]!.matrixWorld.equals(restBones[i]!)).toBe(true);
  let sourceDisposed=0,instanceDisposed=0,boneTexturesDisposed=0;
  for(const geometry of originalGeometry) geometry.addEventListener('dispose',()=>sourceDisposed++);
  const sourceMaterials=new Set(sourceSkins.flatMap(s=>materialsOf(s)));
  for(const material of sourceMaterials) material.addEventListener('dispose',()=>sourceDisposed++);
  const instanceMaterials=new Set(instanceSkins.flatMap(s=>materialsOf(s)));
  for(const material of instanceMaterials) { expect(sourceMaterials.has(material)).toBe(false); material.addEventListener('dispose',()=>instanceDisposed++); }
  const skeletons=new Set(instanceSkins.map(s=>s.skeleton));
  for(const skeleton of skeletons) { skeleton.computeBoneTexture(); skeleton.boneTexture!.addEventListener('dispose',()=>boneTexturesDisposed++); }
  disposeCharacter(instance.root,instance.mixer);
  expect(sourceDisposed).toBe(0); expect(instanceDisposed).toBe(instanceMaterials.size); expect(boneTexturesDisposed).toBe(skeletons.size);
  for(const asset of [source,fitting]) expect(createHash('sha256').update(readFileSync(asset.url)).digest('hex')).toBe(asset.hash);
  console.info(`V3_CPU_PROOF ${name}: ${required.length} required clips, ${sampled} poses, max span ${maxSpan.toFixed(3)}u, rest error ${maxRestError.toExponential(2)}; image/render QA excluded`);
},30000);
