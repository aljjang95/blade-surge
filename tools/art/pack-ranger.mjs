// Copy CC0 medium-rig motion by joint name. The Blender-authored bow action
// remains untouched. Control/IK helpers absent from the runtime skin are omitted.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const [authoredPath, donorPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node pack-ranger.mjs authored.glb donor.glb output.glb');
function read(path) {
  const bytes=fs.readFileSync(path), length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+length));
  const offset=20+length;
  return {json,bin:bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset))};
}
const target=read(authoredPath), source=read(donorPath), j=target.json, s=source.json;
await MeshoptDecoder.ready;
const parts=[target.bin]; let length=target.bin.length;
const views=new Map(), accessors=new Map();
function copyView(index) {
  if(views.has(index)) return views.get(index);
  const src=s.bufferViews[index], ext=src.extensions?.EXT_meshopt_compression;
  let data;
  if(ext) { data=new Uint8Array(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(data,ext.count,ext.byteStride,source.bin.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter); }
  else data=source.bin.subarray(src.byteOffset||0,(src.byteOffset||0)+src.byteLength);
  const padding=(4-length%4)%4; if(padding){parts.push(Buffer.alloc(padding));length+=padding;}
  const view={buffer:0,byteOffset:length,byteLength:data.length};
  if(src.byteStride) view.byteStride=src.byteStride;
  const id=j.bufferViews.length;j.bufferViews.push(view);views.set(index,id);
  parts.push(Buffer.from(data));length+=data.length;return id;
}
function copyAccessor(index) {
  if(accessors.has(index))return accessors.get(index);
  const src=s.accessors[index];if(src.sparse)throw new Error('Sparse animation not supported');
  const acc={...structuredClone(src),bufferView:copyView(src.bufferView)};delete acc.extensions;
  const id=j.accessors.length;j.accessors.push(acc);accessors.set(index,id);return id;
}
const names=new Map(j.nodes.map((n,i)=>[n.name,i]));
const required=new Set(s.skins.flatMap(skin=>skin.joints).map(i=>s.nodes[i].name));
for(const a of s.animations){
  const channels=[];const samplers=[];const samplerMap=new Map();
  for(const channel of a.channels){
    const name=s.nodes[channel.target.node].name,node=names.get(name);
    if(node===undefined){if(required.has(name)&&! /^(kneeIK|heelIK|elbowIK|handIK|control-)/.test(name))throw new Error(`Missing deform joint: ${name}`);continue;}
    if(!samplerMap.has(channel.sampler)){
      const sm=a.samplers[channel.sampler];samplerMap.set(channel.sampler,samplers.length);
      samplers.push({...sm,input:copyAccessor(sm.input),output:copyAccessor(sm.output)});
    }
    channels.push({sampler:samplerMap.get(channel.sampler),target:{node,path:channel.target.path}});
  }
  j.animations.push({name:a.name,channels,samplers});
}
// Stable mesh names and identity metadata are consumed by equipment fitting.
for(const n of j.nodes)if(n.name?.startsWith('Ranger_Head')){n.name='Ranger_Head';n.extras={...n.extras,characterFace:true};}
j.scenes[0].extras={...j.scenes[0].extras,tllIdentity:'casual-v2',source:'KayKit Adventurers 2.0 FREE / CC0',authoring:'Blender MCP / Silva forest outfit and Bow_Shoot'};
j.buffers=[{byteLength:length}];
const json=Buffer.from(JSON.stringify(j));const jp=Buffer.alloc((4-json.length%4)%4,0x20), bin=Buffer.concat(parts),bp=Buffer.alloc((4-bin.length%4)%4);
const header=Buffer.alloc(12);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+jp.length+8+bin.length+bp.length,8);
const jh=Buffer.alloc(8);jh.writeUInt32LE(json.length+jp.length);jh.writeUInt32LE(0x4e4f534a,4);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length+bp.length);bh.writeUInt32LE(0x004e4942,4);
const out=Buffer.concat([header,jh,json,jp,bh,bin,bp]);fs.writeFileSync(outputPath,out);
console.log(JSON.stringify({output:outputPath,bytes:out.length,sha256:createHash('sha256').update(out).digest('hex'),clips:j.animations.length,joints:j.skins[0].joints.length}));
