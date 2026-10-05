// 소스 준비 전용이며, 실제 실행은 ROOT의 별도 에셋 제작 승인이 필요하다.
// 원본 배포물은 보존하고 Blender 참조 모델과 머리 입력 데이터만 출력한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const root = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const widths = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 };
const formats = { 5120:['readInt8','writeInt8',1], 5121:['readUInt8','writeUInt8',1],
  5122:['readInt16LE','writeInt16LE',2], 5123:['readUInt16LE','writeUInt16LE',2],
  5125:['readUInt32LE','writeUInt32LE',4], 5126:['readFloatLE','writeFloatLE',4] };

export function unpackGlb(bytes) {
  check(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Expected complete GLB2');
  const jsonLength=bytes.readUInt32LE(12);
  check(bytes.readUInt32LE(16)===0x4e4f534a && bytes.readUInt32LE(24+jsonLength)===0x004e4942, 'Expected JSON then BIN');
  const doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  const bin=bytes.subarray(28+jsonLength,28+jsonLength+bytes.readUInt32LE(20+jsonLength));
  check(doc.buffers[0].byteLength <= bin.length, 'Truncated binary payload');
  return {doc, bin};
}

export function packGlb(doc, bin) {
  const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const binary=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),header=Buffer.alloc(20),tail=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);
  header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  tail.writeUInt32LE(binary.length,0);tail.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,tail,binary]);
}

async function decodedViews(doc, bin) {
  await MeshoptDecoder.ready;
  return doc.bufferViews.map(view=>{
    const ext=view.extensions?.EXT_meshopt_compression;
    if(ext){
      check(ext.buffer===0,'Unsupported source compression buffer');
      const bytes=new Uint8Array(ext.count*ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,bin.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter);
      return Buffer.from(bytes);
    }
    check(view.buffer===0,'Undecoded fallback buffer is not an actual source stream');
    return Buffer.from(bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));
  });
}

function accessorRows(doc, views, id) {
  const accessor=doc.accessors[id],view=doc.bufferViews[accessor.bufferView],format=formats[accessor.componentType],width=widths[accessor.type];
  check(!accessor.sparse && format && width, 'Unsupported source accessor');
  const offset=accessor.byteOffset||0,stride=view.byteStride||width*format[2],rows=[],packed=Buffer.alloc(accessor.count*width*format[2]);
  for(let i=0;i<accessor.count;i++){
    const row=[];
    for(let k=0;k<width;k++){
      const value=views[accessor.bufferView][format[0]](offset+i*stride+k*format[2]);
      packed[format[1]](value,(i*width+k)*format[2]);row.push(value);
    }
    rows.push(row);
  }
  return {accessorId:id,accessor:structuredClone(accessor),sha256:sha(packed),rows};
}

/** 동결된 실제 원본만 디코딩하며 새 형상·리그·재질·애니메이션은 생성하지 않는다. */
export async function decodeKnightHeadInput(bytes, contract) {
  check(sha(bytes)===contract.sources.base.sha256,'Original Knight source hash differs');
  const {doc,bin}=unpackGlb(bytes),views=await decodedViews(doc,bin);
  const parentIndex=doc.nodes.findIndex(node=>node.name==='Knight_Head'),parent=doc.nodes[parentIndex];
  const nodeIndex=parent.children.find(index=>doc.nodes[index].mesh!==undefined),node=doc.nodes[nodeIndex];
  check(nodeIndex===12 && node.mesh===11 && node.skin===0 && !node.rotation && !node.matrix,'Unexpected retained-head bind structure');
  check(doc.skins[0].joints.length===41 && doc.animations.length===40,'Original rig/clip contract changed');
  const primitive=doc.meshes[node.mesh].primitives[0];
  /** @type {Record<string,{accessorId:number,accessor:any,sha256:string,rows:number[][]}>} */
  const streams={};
  for(const [name,index]of Object.entries({...primitive.attributes,INDICES:primitive.indices})){
    streams[name]=accessorRows(doc,views,index);
    check(streams[name].sha256===contract.headStreams[name], 'Actual original head stream differs: '+name);
  }
  check(streams.POSITION.rows.length===727 && streams.INDICES.rows.length===2868,'Original head topology differs');
  check(streams.JOINTS_0.rows.every((row,i)=>row[0]===14 && streams.WEIGHTS_0.rows[i][0]===255 && streams.WEIGHTS_0.rows[i].slice(1).every(v=>v===0)), 'Head weights are not original rigid joint14');
  const headInput={schema:1,sourceSha256:sha(bytes),nodeIndex,parentIndex,meshIndex:node.mesh,primitiveIndex:0,
    node:structuredClone(node),streams,scope:'Decoded original CC0 source only; shape production has not run.'};
  const reference=structuredClone(doc),parts=[];let length=0;
  reference.bufferViews=reference.bufferViews.map((view,i)=>{
    const pad=Buffer.alloc((4-length%4)%4);parts.push(pad);length+=pad.length;
    const result={...view,buffer:0,byteOffset:length,byteLength:views[i].length};delete result.extensions;
    parts.push(views[i]);length+=views[i].length;return result;
  });
  reference.buffers=[{byteLength:length}];
  for(const key of ['extensionsUsed','extensionsRequired']) if(reference[key]) reference[key]=reference[key].filter(name=>name!=='EXT_meshopt_compression');
  // Blender가 메시 이름을 가져온 객체에 쓰므로 원본 머리·무기 식별자를 유지한다.
  const nameMesh=(index,inherited='')=>{const node=reference.nodes[index],name=node.name||inherited;
    if(node.mesh!==undefined&&name)reference.meshes[node.mesh].name=name;
    for(const child of node.children||[])nameMesh(child,name);};
  for(const scene of reference.scenes)for(const index of scene.nodes)nameMesh(index);
  return {headInput,decodedReference:packGlb(reference,Buffer.concat(parts))};
}

async function main(){
  const output=process.argv.find(value=>value.startsWith('--output='))?.slice(9);
  check(output,'Explicit new ignored output directory required');
  const directory=path.resolve(output),work=path.join(root,'work')+path.sep;
  check(directory.startsWith(work),'Decoded references belong in this checkout ignored work directory');
  await fs.mkdir(directory); // Deliberately fails on reuse; no overwrite of previous evidence.
  const contract=JSON.parse(await fs.readFile(path.join(root,'src/data/knight-head-balance-v1.json'),'utf8'));
  const bytes=await fs.readFile(path.join(root,contract.sources.base.path)),{headInput,decodedReference}=await decodeKnightHeadInput(bytes,contract);
  const input=Buffer.from(JSON.stringify(headInput,null,2)+'\n');
  await fs.writeFile(path.join(directory,'head-input.json'),input,{flag:'wx'});
  await fs.writeFile(path.join(directory,'Knight-reference-decoded.glb'),decodedReference,{flag:'wx'});
  await fs.writeFile(path.join(directory,'decode-receipt.json'),JSON.stringify({status:'DECODED_SOURCE_ONLY_NOT_PRODUCED',
    sourceSha256:sha(bytes),headInputSha256:sha(input),decodedReferenceSha256:sha(decodedReference),shapeChanged:false,
    assetsGenerated:false,originalSourceUnchanged:sha(await fs.readFile(path.join(root,contract.sources.base.path)))===sha(bytes)},null,2)+'\n',{flag:'wx'});
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
