// 원본 GLB의 POSITION/WEIGHTS_0/NORMAL 성분만 패치한다. 기타 BIN 바이트와 JSON 의미를 보존한다.
// 사용: node pack-body-contact-v3.mjs <original.glb> <patch.json> <candidate.glb>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const [inputArg, patchArg, outputArg, ...extra] = process.argv.slice(2);
if (!inputArg || !patchArg || !outputArg || extra.length) throw new Error('usage: node pack-body-contact-v3.mjs <original.glb> <patch.json> <candidate.glb>');
const input = resolve(inputArg), patchPath = resolve(patchArg), output = resolve(outputArg);
const FOX_SHA = 'ec4858d8ad8ae69ef8bb0729b613891120eee33b1d95bb6fef824ece0eb47903';
const require = (ok, message) => { if (!ok) throw new Error(message); };
const sha = data => createHash('sha256').update(data).digest('hex');
require(input !== output && patchPath !== output, 'output overlaps input');
require(!existsSync(output) && !existsSync(output + '.report.json'), 'output or output report exists');
const raw = readFileSync(input), patchBytes = readFileSync(patchPath), patch = JSON.parse(patchBytes.toString('utf8'));
require(sha(raw) === FOX_SHA && patch.source?.sha256 === FOX_SHA && patch.source.bytes === raw.length, 'original fox SHA/size mismatch');
require(patch.schema === 'blade-surge.body-contact-patch.v3' && patch.ok === true && patch.asset === 'avatar_ranger_fox', 'invalid patch identity');
require(patch.stage === 'fit-arms-leg', 'unsupported patch stage');
require(patch.restValidation?.sourceToBlender?.maximum <= .0001 && patch.restValidation?.blenderToSource?.maximum <= .0001, 'missing Blender REST agreement');
require(patch.reference?.sha256 === '2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23', 'canonical reference SHA mismatch');
require(patch.blendValidation?.sourceToBlend?.maximum <= .0001 && patch.blendValidation?.blendToSource?.maximum <= .0001, 'missing authored blend REST parity');
require(patch.restValidation.canonicalIndexAttribute === 'source_vertex_id', 'missing canonical vertex identity');
require(raw.subarray(0, 4).toString() === 'glTF' && raw.readUInt32LE(4) === 2 && raw.readUInt32LE(8) === raw.length, 'invalid original GLB header');
const chunks = [];
for (let offset = 12; offset < raw.length;) {
  const size = raw.readUInt32LE(offset), kind = raw.readUInt32LE(offset + 4);
  require(offset + 8 + size <= raw.length, 'truncated chunk');
  chunks.push({ kind, bytes: raw.subarray(offset + 8, offset + 8 + size) }); offset += 8 + size;
}
require(chunks.length === 2 && chunks[0].kind === 0x4e4f534a && chunks[1].kind === 0x004e4942, 'requires JSON+BIN GLB');
const doc = JSON.parse(chunks[0].bytes.toString()), originalDoc = structuredClone(doc);
const originalBin = chunks[1].bytes, bin = Buffer.from(originalBin);
require(!doc.animations?.length, 'mesh-only source expected');
const specification = patch.primitive;
const meshNode = doc.nodes[specification.node];
require(meshNode?.mesh === specification.mesh && specification.primitive === 0, 'mesh reference mismatch');
require(doc.meshes[specification.mesh].primitives.length === 1, 'multiple primitives unsupported');
const primitive = doc.meshes[specification.mesh].primitives[0];
const attr = primitive.attributes;
require(attr.POSITION === specification.positionAccessor && attr.WEIGHTS_0 === specification.weightsAccessor && attr.JOINTS_0 === specification.jointsAccessor, 'accessor identity mismatch');
const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, widths = { SCALAR: 1, VEC3: 3, VEC4: 4 };
function accessor(index) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  require(!a.sparse && view && (view.buffer || 0) === 0 && !view.extensions?.EXT_meshopt_compression, 'unsupported accessor');
  const size = sizes[a.componentType], width = widths[a.type];
  require(size && width, 'unsupported component/type');
  const start = (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || width * size;
  require(stride >= width * size && start + (a.count - 1) * stride + width * size <= bin.length, 'accessor range invalid');
  const component = (vertex, k) => start + stride * vertex + k * size;
  const denominator = a.normalized ? a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : null : 1;
  require(denominator, 'unsupported normalization');
  const read = (bytes, vertex) => Array.from({ length: width }, (_, k) => {
    const offset = component(vertex, k);
    const value = a.componentType === 5126 ? bytes.readFloatLE(offset) : a.componentType === 5121 ? bytes.readUInt8(offset)
      : a.componentType === 5123 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset);
    return value / denominator;
  });
  return { a, size, width, start, stride, component, denominator, read };
}
require(attr.NORMAL === specification.normalAccessor && attr.TANGENT === undefined, 'NORMAL identity / stored TANGENT unsupported');
const normal = accessor(attr.NORMAL);
require(normal.a.componentType === 5126 && normal.width === 3 && !normal.a.normalized, 'NORMAL must be float32 VEC3');
const position = accessor(attr.POSITION), weights = accessor(attr.WEIGHTS_0), joints = accessor(attr.JOINTS_0);
require(position.a.componentType === 5126 && position.width === 3 && !position.a.normalized, 'POSITION must be float32 VEC3');
require(weights.width === 4 && joints.width === 4, 'four skin influences required');
require(weights.a.componentType === 5126 || (weights.a.normalized && [5121, 5123].includes(weights.a.componentType)), 'weight representation unsupported');
require(position.a.count === specification.vertexCount && weights.a.count === position.a.count && joints.a.count === position.a.count, 'vertex count mismatch');
const skin = doc.skins[meshNode.skin], boneNames = skin.joints.map(i => doc.nodes[i].name);
const positionRows = patch.changes?.positions, weightRows = patch.changes?.weights, normalRows = patch.changes?.normals;
require(Array.isArray(positionRows) && positionRows.length > 0 && Array.isArray(weightRows), 'missing patch arrays');
require(weightRows.length > 0 && Array.isArray(normalRows) && normalRows.length > 0, 'v3 requires bounded leg weights and explicit normals');
const finite = values => Array.isArray(values) && values.every(Number.isFinite);
const near = (a, b, epsilon = 1e-8) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= epsilon);
const allowedBytes = new Set(), touched = { positions: new Set(), weights: new Set(), normals: new Set() };
function validateRow(row, view, field) {
  require(Number.isInteger(row.vertex) && row.vertex >= 0 && row.vertex < view.a.count, 'invalid vertex ID');
  require(!touched[field].has(row.vertex), 'duplicate patch vertex');
  touched[field].add(row.vertex);
  require(finite(row.old) && finite(row.new) && row.old.length === view.width && row.new.length === view.width, 'invalid component row');
  require(near(view.read(originalBin, row.vertex), row.old), 'old component mismatch: ' + field + ':' + row.vertex);
}
function mark(view, vertex) {
  for (let k = 0; k < view.width; k++) for (let byte = 0; byte < view.size; byte++) allowedBytes.add(view.component(vertex, k) + byte);
}
// 실제 원본 JOINTS/WEIGHTS와 고정본 이름으로 팔 범위를 다시 판정한다.
const canonicalName = name => name.replaceAll(':', '').replaceAll('_', '');
function armRegion(vertex, point) {
  const side = point[0] > 0 ? 'Left' : 'Right';
  const js = joints.read(originalBin, vertex), ws = weights.read(originalBin, vertex);
  let mass = 0, protectedMass = 0;
  js.forEach((j, k) => {
    const name = canonicalName(boneNames[j]);
    if (['Spine', 'Neck', 'Head'].some(part => name.includes(part))) protectedMass += ws[k];
    const prefix = 'mixamorig' + side;
    const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : '';
    if (['Arm', 'ForeArm'].includes(suffix) || suffix.startsWith('Hand')) mass += ws[k];
  });
  const start = patch.armFit?.anchors?.[side]?.protectedFadeStart;
  require(Number.isFinite(start) && start > .1 && start < .50, 'invalid protected shoulder fade anchor');
  return { side, mass, protectedMass, allowed: mass > .5 && protectedMass <= 1e-8 && Math.abs(point[0]) > start && point[1] >= .86 };
}
// accessor의 raw 좌표와 REST 증거를 독립적으로 대조한다(칼럼 우선 행렬).
function mul(a,b) { const r=Array(16).fill(0); for(let c=0;c<4;c++)for(let y=0;y<4;y++)for(let k=0;k<4;k++)r[c*4+y]+=a[k*4+y]*b[c*4+k];return r; }
const identity = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function local(n) {
  if(n.matrix)return n.matrix;
  const [x,y,z,w]=n.rotation||[0,0,0,1], [sx,sy,sz]=n.scale||[1,1,1], [tx,ty,tz]=n.translation||[0,0,0];
  return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,tx,ty,tz,1];
}
const parent=new Map(), worldCache=new Map();
doc.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>{require(!parent.has(c),'multiple parents');parent.set(c,i);}));
function world(i) { if(worldCache.has(i))return worldCache.get(i);const m=mul(parent.has(i)?world(parent.get(i)):identity(),local(doc.nodes[i]));worldCache.set(i,m);return m; }
const ibmAccessor=doc.accessors[skin.inverseBindMatrices], ibmView=doc.bufferViews[ibmAccessor.bufferView];
require(ibmAccessor.componentType===5126 && ibmAccessor.type==='MAT4' && ibmAccessor.count===skin.joints.length && !ibmAccessor.sparse,'invalid inverse bind');
const ibmStart=(ibmView.byteOffset||0)+(ibmAccessor.byteOffset||0), ibmStride=ibmView.byteStride||64;
const restMatrices=skin.joints.map((node,i)=>mul(world(node),Array.from({length:16},(_,k)=>originalBin.readFloatLE(ibmStart+i*ibmStride+k*4))));
function restPoint(vertex, rawPoint, weightBytes=originalBin) {
  const js=joints.read(originalBin,vertex),ws=weights.read(weightBytes,vertex),r=[0,0,0];
  js.forEach((joint,k)=>{const m=restMatrices[joint];for(let a=0;a<3;a++)r[a]+=ws[k]*(m[a]*rawPoint[0]+m[4+a]*rawPoint[1]+m[8+a]*rawPoint[2]+m[12+a]);});return r;
}
require(patch.fit.hips>.8 && patch.fit.hips<.88 && patch.fit.targetSole>=0 && patch.fit.targetSole<=.02,'invalid lower fit bounds');
const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
let maximumWeightQuantization=0;
for(const row of weightRows) {
  validateRow(row,weights,'weights');
  require(row.region==='leg-cross' && ['Left','Right'].includes(row.side),'unauthorized weight region');
  const point=restPoint(row.vertex,position.read(originalBin,row.vertex));
  require(near(point,row.restWorldBefore,2e-6),'leg original rest evidence mismatch');
  const side=point[0]>0?'Left':'Right',opposite=side==='Left'?'Right':'Left';
  require(side===row.side,'leg side mismatch');
  const names=joints.read(originalBin,row.vertex).map(j=>boneNames[j]);
  require(JSON.stringify(names)===JSON.stringify(row.jointNames),'leg joint names mismatch');
  const own=names.map(n=>['mixamorig'+side+'UpLeg','mixamorig'+side+'Leg'].includes(canonicalName(n)));
  const other=names.map(n=>['mixamorig'+opposite+'UpLeg','mixamorig'+opposite+'Leg'].includes(canonicalName(n)));
  require(row.old.every((w,i)=>w<=1e-8 || own[i] || other[i]),'weight outside pure leg chains');
  const same=row.old.reduce((s,w,i)=>s+(own[i]?w:0),0),opp=row.old.reduce((s,w,i)=>s+(other[i]?w:0),0);
  require(same>.5 && opp>1e-8,'leg dominance/opposite influence invalid');
  const ankle=patch.weightFit?.ankleY,hips=patch.weightFit?.hipsY;
  require(Number.isFinite(ankle) && ankle>-.05 && ankle<.25 && hips===patch.fit.hips,'leg anatomical bounds invalid');
  const yStart=ankle+.06,yFull=ankle+.18,yFade=hips-.20,yEnd=hips-.06;
  const mask=smooth((Math.abs(point[0])-.04)/.08)*smooth((point[1]-yStart)/(yFull-yStart))*smooth((yEnd-point[1])/(yEnd-yFade))*smooth((same-.5)/.1);
  require(mask>1e-8 && Math.abs(mask-row.mask)<2e-5,'leg spatial mask mismatch');
  const proposed=row.old.map((w,i)=>other[i]?w*(1-mask):w),total=proposed.reduce((a,b)=>a+b,0);
  require(total>.5 && near(proposed.map(w=>w/total),row.new,2e-5),'leg weight formula mismatch');
  require(row.new.every((w,i)=>w>=0 && w<=1 && (row.old[i]>0 || w===0)),'new/unbounded leg influence');
  mark(weights,row.vertex);
  let values=row.new;
  if(weights.a.componentType!==5126) {
    const scaled=row.new.map(w=>w*weights.denominator);values=scaled.map(Math.floor);
    const remainder=weights.denominator-values.reduce((a,b)=>a+b,0);
    const order=scaled.map((v,i)=>({i,f:v-values[i]})).sort((a,b)=>b.f-a.f);
    require(remainder>=0 && remainder<=4,'bad quantization remainder');for(let i=0;i<remainder;i++)values[order[i].i]++;
  }
  values.forEach((v,k)=>{const o=weights.component(row.vertex,k);if(weights.a.componentType===5126)bin.writeFloatLE(v,o);else if(weights.a.componentType===5121)bin.writeUInt8(v,o);else bin.writeUInt16LE(v,o);});
  const quantized=weights.read(bin,row.vertex);require(Math.abs(quantized.reduce((a,b)=>a+b,0)-1)<1e-6,'quantized leg sum invalid');
  maximumWeightQuantization=Math.max(maximumWeightQuantization,...quantized.map((w,i)=>Math.abs(w-row.new[i])));
}
const regionCounts={lower:0,armHand:0};
for (const row of positionRows) {
  validateRow(row, position, 'positions');
  require(finite(row.restWorldBefore) && finite(row.restWorldAfter) && row.restWorldBefore.length === 3 && row.restWorldAfter.length === 3, 'missing rest-space position evidence');
  require(near(restPoint(row.vertex,row.old),row.restWorldBefore,2e-6) && near(restPoint(row.vertex,row.new,bin),row.restWorldAfter,2e-6),'raw/rest position evidence mismatch');
  if(row.region==='lower') {
    require(row.restWorldBefore[1] < patch.fit.hips, 'lower position outside hips');
    require(Math.abs(row.restWorldBefore[0]-row.restWorldAfter[0]) <= 1e-7 && Math.abs(row.restWorldBefore[2]-row.restWorldAfter[2]) <= 1e-7, 'lower horizontal position changed');
    require(row.restWorldAfter[1] >= row.restWorldBefore[1]-1e-7 && row.restWorldAfter[1]-row.restWorldBefore[1]<.33,'lower displacement outside fit');
    regionCounts.lower++;
  } else {
    require(row.region==='arm-hand','unknown position region');
    const region=armRegion(row.vertex,row.restWorldBefore);
    require(region.allowed && region.side===row.side && Math.abs(region.mass-row.armMass)<1e-7 && row.protectedMass===0,'arm position outside explicit original-weight mask');
    require(JSON.stringify(joints.read(originalBin,row.vertex).map(j=>boneNames[j]))===JSON.stringify(row.jointNames),'arm joint evidence mismatch');
    require(Math.hypot(...row.restWorldAfter.map((v,k)=>v-row.restWorldBefore[k])) < .30,'arm displacement exceeds .30m');
    regionCounts.armHand++;
  }
  require(Math.hypot(...row.new.map((value,i)=>value-row.old[i])) < .34,'raw displacement outside bounded fit');
  mark(position,row.vertex);
  row.new.forEach((value,k)=>bin.writeFloatLE(value,position.component(row.vertex,k)));
}
require(regionCounts.lower>0 && regionCounts.armHand>0,'v2 requires lower and arm patches');
const indices=primitive.indices===undefined?null:accessor(primitive.indices);
const flat=indices?Array.from({length:indices.a.count},(_,i)=>indices.read(originalBin,i)[0]):Array.from({length:position.a.count},(_,i)=>i);
require(flat.length%3===0,'invalid triangles');
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const faceNormal=(ids,bytes)=>{const [a,b,c]=ids.map(i=>position.read(bytes,i));return cross(sub(b,a),sub(c,a));};
const seamKey=i=>[...position.read(originalBin,i),...normal.read(originalBin,i)].map(v=>v.toFixed(7)).join(',');
const affectedKeys=new Set(),affectedTriangles=[];
for(let offset=0;offset<flat.length;offset+=3) {
  const ids=flat.slice(offset,offset+3);
  require(ids.every(i=>Number.isInteger(i)&&i>=0&&i<position.a.count),'index out of range');
  if(!ids.some(i=>touched.positions.has(i)))continue;
  affectedTriangles.push(offset/3);ids.forEach(i=>affectedKeys.add(seamKey(i)));
  const a=faceNormal(ids,originalBin),b=faceNormal(ids,bin),la=Math.hypot(...a),lb=Math.hypot(...b);
  if(la>1e-10)require(lb/la>.03 && lb/la<25 && a.reduce((sum,v,i)=>sum+v*b[i],0)>0,'packed triangle collapse/flip: '+offset/3);
}
require(JSON.stringify(affectedTriangles)===JSON.stringify(patch.normalFit?.affectedTriangles),'affected triangle evidence mismatch');
for(const row of normalRows) {
  validateRow(row,normal,'normals');
  const before=restPoint(row.vertex,position.read(originalBin,row.vertex));
  require(affectedKeys.has(seamKey(row.vertex)) && (before[1]<patch.fit.hips || armRegion(row.vertex,before).allowed),'normal patch outside affected seam/allowed anatomy');
  require(Math.abs(Math.hypot(...row.old)-1)<.001 && Math.abs(Math.hypot(...row.new)-1)<1e-6,'nonunit normal');
  require(row.method==='original-normal rotated by old/new area-weighted seam-group geometric normal','unknown normal method');
  mark(normal,row.vertex);row.new.forEach((v,k)=>bin.writeFloatLE(v,normal.component(row.vertex,k)));
  require(Math.abs(Math.hypot(...normal.read(bin,row.vertex))-1)<1e-6,'quantized normal not unit');
}

let changedBytes = 0;
for (let i = 0; i < bin.length; i++) {
  if (bin[i] === originalBin[i]) continue;
  require(allowedBytes.has(i), 'unauthorized BIN modification at ' + i);
  changedBytes++;
}
// POSITION accessor의 경계만 갱신하며 나머지 JSON 값은 동일하다.
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < position.a.count; i++) {
  const values = position.read(bin, i);
  require(values.every(Number.isFinite), 'nonfinite position');
  values.forEach((value, k) => { min[k] = Math.min(min[k], value); max[k] = Math.max(max[k], value); });
}
position.a.min = min; position.a.max = max;
const strippedOriginal = structuredClone(originalDoc), strippedNext = structuredClone(doc);
for (const value of [strippedOriginal, strippedNext]) {
  delete value.accessors[attr.POSITION].min;
  delete value.accessors[attr.POSITION].max;
}
require(JSON.stringify(strippedOriginal) === JSON.stringify(strippedNext), 'unexpected JSON semantic change');
const jsonBytes = Buffer.from(JSON.stringify(doc));
const jsonPadding = Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20);
const jsonChunk = Buffer.concat([jsonBytes, jsonPadding]);
const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
jsonHeader.writeUInt32LE(jsonChunk.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
const candidate = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
const receipt = {
  schema: 'blade-surge.body-contact-pack.v3', ok: true, asset: patch.asset, stage: patch.stage,
  source: { path: input, sha256: sha(raw), bytes: raw.length },
  patch: { path: patchPath, sha256: sha(patchBytes), authoring: patch.authoring },
  output: { path: output, sha256: sha(candidate), bytes: candidate.length },
  changedVertices: { positions: positionRows.length, weights: weightRows.length, normals: normalRows.length, regions: regionCounts },
  changedBinBytes: changedBytes, allowedBinBytes: allowedBytes.size,
  maximumWeightQuantization, positionBounds: { min, max },
  preserved: ['all BIN bytes outside patched POSITION/WEIGHTS_0/NORMAL components', 'JOINTS_0', 'WEIGHTS_0 outside explicit pure-leg correction', 'indices', 'TANGENT', 'UV', 'image bytes', 'materials', 'nodes', 'skins', 'animations'],
  jsonChanges: ['POSITION accessor min/max only; JSON text serialization and GLB chunk lengths can change'],
  limitation: 'Candidate only. No runtime numeric validation or visual approval is claimed.',
};
writeFileSync(output, candidate, { flag: 'wx' });
writeFileSync(output + '.report.json', JSON.stringify(receipt, null, 2), { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
