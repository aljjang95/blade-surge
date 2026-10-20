// 실제 발 저작 패치의 독립 검증/패킹. 원본 GLB는 POSITION/영향 NORMAL 외 바이트를 보존한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

const requireValid = (ok, message) => { if (!ok) throw new Error(message); };
const argv = process.argv.slice(2);
requireValid(argv.length === 6 && argv[0] === '--repo' && argv[2] === '--profiles' && argv[4] === '--out-dir',
  '사용: node pack-foot-fit-v1.mjs --repo <repo> --profiles <실제 입력 JSON> --out-dir <author 산출물>');
const repo = resolve(argv[1]), profilesPath = resolve(argv[3]), out = resolve(argv[5]);
const within = (parent, child) => { const p = relative(parent, child); return p === '' || (!p.startsWith('..') && !isAbsolute(p)); };
requireValid(!within(repo, out) && !within(out, profilesPath), '입력/저장소 밖 산출물 필요');
const { Matrix4, Vector3, Vector4, Quaternion } = createRequire(join(repo, 'package.json'))('three');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileRecord = path => { const b = readFileSync(path); return { path, bytes: b.length, sha256: sha(b) }; };
const ASSETS = { hero_rogue_t2: 16299, hero_rogue_t3: 15728, avatar_rogue_crow: 14697 };
const REFERENCE = 'public/models/heroes-next/rogue-library-t1-v2.glb';
const REFERENCE_SHA = '19f7e1492d947c6055cbbd8b51f3ee355c5c72f8ec4ab6296be32fb9d1e1c846';
const LOWER_SHA = '64505e29fd7040b2fe774720f63064359e9cca84445f7bc60744103784bfd003';
const HELPER_SHA = '78ec15dfeb5e5908237586bc77f8b3e8a8e291efcc24fd35f35627088c5eaab1';
const PARAMS = { targetSole: .006, anchorMass: .30, shapeCeiling: .06, soleCeiling: .02,
  boundaryWidths: { hero_rogue_t2: .10, hero_rogue_t3: .20, avatar_rogue_crow: .15 }, heightFade: [.03, .22], maximumMove: .15,
  quantile: 'linear-(n-1)*p', xzScale: 'min(1,referenceP95P05/sourceP95P05)',
  frame: 'same-side-ankle-relative-world-axes', seamTolerance: .00002 };
const SIDES = ['Left', 'Right'];
const canon = s => s.replaceAll(':', '').replaceAll('_', '');
const vec = a => new Vector3().fromArray(a);
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const near = (a, b, eps = 0) => finite(a, b.length) && a.every((v, i) => Math.abs(v-b[i]) <= eps);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
function rounded(x, digits) {
  const scale = 10**digits, value = x*scale, low = Math.floor(value), f = value-low;
  return (f === .5 ? low+(low%2 ? 1 : 0) : Math.round(value))/scale;
}
function parse(raw) {
  requireValid(raw.length >= 20 && raw.toString('ascii', 0, 4) === 'glTF' && raw.readUInt32LE(4) === 2 && raw.readUInt32LE(8) === raw.length, 'GLB 헤더 오류');
  const chunks = [];
  for (let at = 12; at < raw.length;) {
    requireValid(at+8 <= raw.length, 'GLB chunk 헤더 범위 오류');
    const n = raw.readUInt32LE(at), type = raw.readUInt32LE(at+4);
    requireValid(at+8+n <= raw.length, 'GLB chunk 범위 오류');
    chunks.push({ type, data: raw.subarray(at+8, at+8+n) }); at += 8+n;
  }
  requireValid(chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942, 'JSON+BIN만 지원합니다.');
  return { doc: JSON.parse(chunks[0].data.toString()), bin: chunks[1].data };
}
function access(doc, bin, index) {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
  requireValid(!a.sparse && v && !(v.buffer || 0) && !v.extensions?.EXT_meshopt_compression, '지원하지 않는 accessor');
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType], width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const start = (v.byteOffset || 0)+(a.byteOffset || 0), stride = v.byteStride || width*size;
  requireValid(size && width && a.count > 0 && stride >= width*size && start+(a.count-1)*stride+width*size <= bin.length, 'accessor 범위 오류');
  const offset = (i, k) => start+i*stride+k*size;
  const read = (bytes, i) => Array.from({ length: width }, (_, k) => {
    const p = offset(i, k), x = a.componentType === 5126 ? bytes.readFloatLE(p) : a.componentType === 5121 ? bytes.readUInt8(p) : a.componentType === 5123 ? bytes.readUInt16LE(p) : bytes.readUInt32LE(p);
    requireValid(!a.normalized || [5121, 5123].includes(a.componentType), 'normalized 표현 오류');
    return a.normalized ? x/(a.componentType === 5121 ? 255 : 65535) : x;
  });
  return { a, width, size, offset, read, rows: Array.from({ length: a.count }, (_, i) => read(bin, i)) };
}
function worldNodes(doc) {
  const parents = new Map(), cache = new Map(), visiting = new Set();
  doc.nodes.forEach((n, i) => (n.children || []).forEach(child => { requireValid(!parents.has(child), '중복 부모'); parents.set(child, i); }));
  function world(i) {
    if (cache.has(i)) return cache.get(i);
    requireValid(!visiting.has(i), '본 계층 순환'); visiting.add(i);
    const n = doc.nodes[i], m = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(vec(n.translation || [0, 0, 0]), new Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), vec(n.scale || [1, 1, 1]));
    if (parents.has(i)) m.premultiply(world(parents.get(i)));
    visiting.delete(i); cache.set(i, m); return m;
  }
  return doc.nodes.map((_, i) => world(i));
}
function weighted(js, ws, matrices) {
  const m = new Matrix4(); m.elements.fill(0);
  js.forEach((j, k) => { for (let c = 0; c < 16; c++) m.elements[c] += matrices[j].elements[c]*ws[k]; });
  return m;
}
function skinned(p, matrix) { const v = new Vector4(...p, 1).applyMatrix4(matrix); return new Vector3(v.x, v.y, v.z); }
function dataFor(path, exactSha, count = null) {
  const raw = readFileSync(path); requireValid(sha(raw) === exactSha, '실제 입력 SHA 불일치: '+path);
  const { doc, bin } = parse(raw), nodes = doc.nodes.map((n, i) => ({ ...n, index: i })).filter(n => n.mesh !== undefined);
  requireValid(nodes.length === 1 && nodes[0].skin !== undefined, '단일 skin mesh 필요');
  const node = nodes[0], primitives = doc.meshes[node.mesh].primitives;
  requireValid(primitives.length === 1 && (primitives[0].mode ?? 4) === 4 && !primitives[0].targets && !primitives[0].extensions, '지원하지 않는 primitive');
  const p = primitives[0], a = p.attributes;
  requireValid(!['JOINTS_1', 'WEIGHTS_1', 'TANGENT'].some(k => k in a), '추가 속성 계약 없음');
  const [position, normal, joints, weights] = ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].map(k => access(doc, bin, a[k]));
  requireValid([position, normal, weights].every(v => v.a.componentType === 5126 && !v.a.normalized && v.rows.every(r => r.every(Number.isFinite))), '유한 F32 속성 필요');
  requireValid(position.width === 3 && normal.width === 3 && joints.width === 4 && weights.width === 4 && [normal, joints, weights].every(v => v.a.count === position.a.count), '속성 수/폭 오류');
  requireValid(count === null || position.a.count === count, 'asset vertex count 불일치');
  requireValid(weights.rows.every(r => r.every(w => w >= 0 && w <= 1.000001) && Math.abs(r.reduce((s, w) => s+w, 0)-1) <= .000001), '가중치 합/범위 오류');
  const skin = doc.skins[node.skin], names = skin.joints.map(i => canon(doc.nodes[i].name)), world = worldNodes(doc), ibms = access(doc, bin, skin.inverseBindMatrices).rows;
  requireValid(names.length === 65 && ibms.length === 65 && new Set(names).size === 65, '원본 bone 수/이름 오류');
  requireValid(joints.rows.every(r => r.every(j => Number.isInteger(j) && j >= 0 && j < 65)), 'joint 인덱스 범위 오류');
  const matrices = skin.joints.map((i, k) => world[i].clone().multiply(new Matrix4().fromArray(ibms[k])));
  const vertexMatrices = joints.rows.map((js, i) => weighted(js, weights.rows[i], matrices));
  const points = position.rows.map((p, i) => skinned(p, vertexMatrices[i]));
  requireValid(points.every(p => p.toArray().every(Number.isFinite)), '유한 REST 필요');
  const ids = access(doc, bin, p.indices).rows.flat();
  requireValid(ids.length%3 === 0 && ids.every(i => Number.isInteger(i) && i >= 0 && i < points.length), '삼각형 indices 오류');
  const faces = []; for (let i = 0; i < ids.length; i += 3) faces.push(ids.slice(i, i+3));
  return { raw, doc, bin, node, a, position, normal, joints, weights, names, skin, world, matrices, vertexMatrices, points, faces };
}
function bone(data, side) { return new Vector3().setFromMatrixPosition(data.world[data.skin.joints[data.names.indexOf('mixamorig'+side+'Foot')]]).toArray(); }
function footMass(data, i, side) {
  return data.joints.rows[i].reduce((s, j, k) => s+(['Foot', 'ToeBase', 'ToeEnd'].some(part => data.names[j] === 'mixamorig'+side+part) ? data.weights.rows[i][k] : 0), 0);
}
function semanticSide(data, i) {
  const allowed = new Set(['mixamorigHips', ...SIDES.flatMap(s => ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'ToeEnd'].map(p => 'mixamorig'+s+p))]);
  if (data.joints.rows[i].some((j, k) => data.weights.rows[i][k] > 1e-8 && !allowed.has(data.names[j]))) return null;
  const a = footMass(data, i, 'Left'), b = footMass(data, i, 'Right');
  if ((a > 1e-8) === (b > 1e-8)) return null;
  return a > 1e-8 ? 'Left' : 'Right';
}
function quantile(values, fraction) {
  values.sort((a, b) => a-b); const at = (values.length-1)*fraction, lo = Math.floor(at);
  return values[lo]+(values[Math.min(lo+1, values.length-1)]-values[lo])*(at-lo);
}
function sideStats(data, side) {
  const ankle = bone(data, side), ids = data.points.flatMap((p, i) => semanticSide(data, i) === side && footMass(data, i, side) >= .30 && p.y < ankle[1]+.06 ? [i] : []);
  requireValid(ids.length >= 3, 'foot shape 표본 부족');
  const axes = [0, 1, 2].map(k => {
    const v = ids.map(i => data.points[i].getComponent(k)-ankle[k]);
    return { min: Math.min(...v), p05: quantile(v.slice(), .05), median: quantile(v.slice(), .5), p95: quantile(v.slice(), .95), max: Math.max(...v) };
  });
  const soleVertices = ids.filter(i => data.points[i].y < ankle[1]+.02);
  requireValid(soleVertices.length, 'QA sole 표본 없음');
  return { ankle, shapeVertices: ids, soleVertices, axes };
}
function profile(data, reference) {
  requireValid(equal(data.names, reference.names), 'canonical bone 이름/순서 불일치');
  const records = {};
  for (const side of SIDES) {
    const source = sideStats(data, side), ref = sideStats(reference, side);
    requireValid(vec(source.ankle).distanceTo(vec(ref.ankle)) <= .0001, 'canonical Foot REST 불일치');
    const scale = [], offset = [];
    for (let k = 0; k < 3; k++) {
      const s = source.axes[k], r = ref.axes[k], width = k === 1 ? s.p95-s.min : s.p95-s.p05, rw = k === 1 ? r.p95-r.min : r.p95-r.p05;
      requireValid(width > 1e-7 && rw > 1e-7, '퇴화한 quantile 범위');
      const gain = k === 1 ? rw/width : Math.min(1, rw/width);
      requireValid(Number.isFinite(gain) && gain > 0, '비양수 affine scale');
      scale.push(gain); offset.push(k === 1 ? .006-source.ankle[1]-gain*s.min : r.median-gain*s.median);
    }
    records[side] = { source, reference: ref, scale, offset };
  }
  return records;
}
function spatialGraph(data, records) {
 const groups=[], lookup=new Map(), ids=data.position.rows.map((p,i)=>{
  const key=p.map(v=>rounded(v,6)).join(',');
  if(!lookup.has(key)){lookup.set(key,groups.length);groups.push({members:[],point:data.points[i],side:null,edges:new Map()});}
  const g=lookup.get(key);groups[g].members.push(i);return g;
 });
 for(const g of groups){
  const sides=g.members.map(i=>semanticSide(data,i));
  g.side=sides[0]&&sides.every(s=>s===sides[0])&&g.members.every(i=>data.points[i].y<records[sides[0]].source.ankle[1]+.22)?sides[0]:null;
 }
 for(const face of data.faces)for(let k=0;k<3;k++){
  const a=ids[face[k]],b=ids[face[(k+1)%3]];if(a===b)continue;
  const d=groups[a].point.distanceTo(groups[b].point);
  const old=groups[a].edges.get(b);if(old===undefined||d<old){groups[a].edges.set(b,d);groups[b].edges.set(a,d);}
 }
 const heap=[],dist=new Float64Array(groups.length).fill(Infinity);
 const push=(id,d)=>{let k=heap.length;heap.push([id,d]);while(k){const par=(k-1)>>1;if(heap[par][1]<=d)break;heap[k]=heap[par];k=par;}heap[k]=[id,d];};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let k=0;while(2*k+1<heap.length){let c=2*k+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[k]=heap[c];k=c;}heap[k]=last;}return top;};
 // 고정 영역에 연결되는 간선 길이에서 시작한다. 반대쪽/혼합 seam은 고정 경계다.
 groups.forEach((g,i)=>{if(!g.side)return;for(const[j,d]of g.edges)if(groups[j].side!==g.side&&d<dist[i])dist[i]=d;if(Number.isFinite(dist[i]))push(i,dist[i]);});
 while(heap.length){const[i,d]=pop();if(d!==dist[i])continue;for(const[j,w]of groups[i].edges){if(groups[j].side!==groups[i].side)continue;const nd=d+w;if(nd<dist[j]){dist[j]=nd;push(j,nd);}}}
 return {groups,ids,dist};
}
function field(data, records, asset) {
  const graph=spatialGraph(data, records), width=PARAMS.boundaryWidths[asset];
  const mask=new Map(), points=data.points.map(p=>p.clone()), normalIds=[], unreachable=[];
  graph.groups.forEach((group,g)=>{
    const side=group.side;if(!side)return;
    if(!Number.isFinite(graph.dist[g])){unreachable.push(...group.members);return;}
    normalIds.push(...group.members);
    const r=records[side],p=group.point,a=r.source.ankle,distance=graph.dist[g];
    const factors=[smooth(distance/width),1-smooth((p.y-a[1]-.03)/.19)],alpha=factors[0]*factors[1];
    if(alpha<=1e-10)return;
    const delta=vec(a.map((v,k)=>v+r.scale[k]*(p.getComponent(k)-v)+r.offset[k])).sub(p).multiplyScalar(alpha);
    requireValid(delta.length()<=.15,'foot 최대 이동 .15m 초과');
    for(const i of group.members){points[i].add(delta);mask.set(i,{vertex:i,side,mass:footMass(data,i,side),distance,factors,alpha,delta:delta.toArray()});}
  });
  requireValid(mask.size,'발 편집 mask 없음');
  for(const group of graph.groups)for(const i of group.members.slice(1)){
    const j=group.members[0],a=points[i].clone().sub(data.points[i]),b=points[j].clone().sub(data.points[j]);
    requireValid(a.distanceTo(b)<=.00002,'같은 raw seam delta 불일치');
  }
  return {mask,points,normals:new Set(normalIds.sort((a,b)=>a-b)),domain:{width,groups:graph.groups.length,eligibleGroups:graph.groups.filter(g=>g.side).length,unreachableVertices:unreachable.sort((a,b)=>a-b)}};
}
function verifyProfile(actual, expected) {
  for (const side of SIDES) {
    const a = actual?.[side], e = expected[side];
    requireValid(a && near(a.scale, e.scale, 1e-8) && near(a.offset, e.offset, 1e-8), '실제 affine profile 불일치');
    for (const kind of ['source', 'reference']) {
      requireValid(near(a[kind]?.ankle, e[kind].ankle, 1e-8) && equal(a[kind].shapeVertices, e[kind].shapeVertices) && equal(a[kind].soleVertices, e[kind].soleVertices), '실제 shape/sole anchor 집합 불일치');
      for (let k = 0; k < 3; k++) for (const key of ['min', 'p05', 'median', 'p95', 'max'])
        requireValid(Number.isFinite(a[kind].axes[k][key]) && Math.abs(a[kind].axes[k][key]-e[kind].axes[k][key]) <= 1e-8, '실제 quantile 불일치');
    }
  }
}
function triangleGate(before, after, faces, changed) {
  let minimumAreaRatio = 1, minimumNormalDot = 1, count = 0;
  faces.forEach((face, t) => {
    if (!face.some(i => changed.has(i))) return;
    count++;
    const [a, b, c] = face.map(i => vec(before[i])), [aa, bb, cc] = face.map(i => vec(after[i]));
    const old = b.sub(a).cross(c.sub(a)), next = bb.sub(aa).cross(cc.sub(aa));
    if (old.length() > 1e-10) {
      const ratio = next.length()/old.length(), dot = old.clone().normalize().dot(next.clone().normalize());
      requireValid(ratio > .03 && ratio < 25 && dot > 0, '삼각형 붕괴/뒤집힘: '+t);
      minimumAreaRatio = Math.min(minimumAreaRatio, ratio); minimumNormalDot = Math.min(minimumNormalDot, dot);
    }
  });
  return { count, minimumAreaRatio, minimumNormalDot };
}
function checkNormals(data, positions, bin, changed, normalChanged, eligible) {
  const keys = data.position.rows.map((p, i) => [...p, ...data.normal.rows[i]].map(v => rounded(v, 7)).join(',')), groups = new Map(), touched = new Set();
  data.faces.forEach(face => {
    const [a, b, c] = face.map(i => vec(data.position.rows[i])), [aa, bb, cc] = face.map(i => vec(positions[i]));
    const old = b.sub(a).cross(c.sub(a)), next = bb.sub(aa).cross(cc.sub(aa));
    if (face.some(i => changed.has(i))) face.forEach(i => touched.add(keys[i]));
    for (const i of face) { if (!groups.has(keys[i])) groups.set(keys[i], { old: new Vector3(), next: new Vector3() }); const g = groups.get(keys[i]); g.old.add(old); g.next.add(next); }
  });
  data.points.forEach((_, i) => {
    const g = groups.get(keys[i]);
    if (!touched.has(keys[i]) || !eligible.has(i) || !g || Math.min(g.old.length(), g.next.length()) <= 1e-10) {
      requireValid(!normalChanged.has(i), '영향 없는 NORMAL 변경'); return;
    }
    const expected = vec(data.normal.rows[i]).applyQuaternion(new Quaternion().setFromUnitVectors(g.old.clone().normalize(), g.next.clone().normalize())).normalize();
    const actual = vec(data.normal.read(bin, i));
    requireValid(expected.distanceTo(actual) <= 2e-5 && Math.abs(actual.length()-1) <= 2e-5, '영향 seam NORMAL 회전 불일치: '+i);
  });
}
function serialize(doc, bin) {
  const json = Buffer.from(JSON.stringify(doc)), jn = (json.length+3)&~3, bn = (bin.length+3)&~3;
  const result = Buffer.alloc(12+8+jn+8+bn);
  result.write('glTF'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jn, 12); result.writeUInt32LE(0x4e4f534a, 16); result.fill(32, 20, 20+jn); json.copy(result, 20);
  result.writeUInt32LE(bn, 20+jn); result.writeUInt32LE(0x004e4942, 24+jn); bin.copy(result, 28+jn);
  return result;
}

const profilesBytes = readFileSync(profilesPath), profilesSha = sha(profilesBytes), packet = JSON.parse(profilesBytes);
requireValid(packet.schema === 'blade-surge.foot-fit-inputs.v1' && Array.isArray(packet.inputs) && packet.inputs.length === 3, '실제 3몸체 입력 필요');
requireValid(new Set(packet.inputs.map(r => r.asset)).size === 3 && packet.inputs.every(r => Object.hasOwn(ASSETS, r.asset)), '중복/범위 밖 입력');
const inputPaths = new Set();
for (const row of packet.inputs) {
  requireValid(typeof row.path === 'string' && row.path && /^[a-f0-9]{64}$/.test(row.sha256), '실제 입력 경로/SHA 누락');
  const path = resolve(row.path); requireValid(!inputPaths.has(path) && !within(out, path) && sha(readFileSync(path)) === row.sha256, '실제 입력 충돌/SHA 불일치'); inputPaths.add(path);
  for (const suffix of ['.glb', '.glb.report.json']) requireValid(!existsSync(join(out, row.asset+suffix)), '출력 덮어쓰기 금지');
}
requireValid(!existsSync(join(out, 'foot-pack-report.json')), 'batch report 덮어쓰기 금지');
for (const [file, expected] of [['art-src/higher-bodies/author_lower_fit_v1.py', LOWER_SHA], ['art-src/avatar-fox/author_body_contact_v3.py', HELPER_SHA]])
  requireValid(sha(readFileSync(join(repo, file))) === expected, '읽기 전용 helper 변경');
const reference = dataFor(join(repo, REFERENCE), REFERENCE_SHA);
const authorSha = sha(readFileSync(join(repo, 'art-src/higher-bodies/author_foot_fit_v1.py')));
function prepare(row) {
  const data = dataFor(resolve(row.path), row.sha256, ASSETS[row.asset]);
  requireValid(!data.doc.animations?.length, '입력 mesh-only 계약 오류');
  const patchPath = join(out, row.asset+'.patch.json'), patch = JSON.parse(readFileSync(patchPath));
  requireValid(patch.schema === 'blade-surge.foot-fit-patch.v1' && patch.ok === true && patch.candidateOnly === true && patch.asset === row.asset, '패치 identity 오류');
  requireValid(patch.source?.sha256 === row.sha256 && resolve(patch.source.path) === resolve(row.path) && patch.reference?.sha256 === REFERENCE_SHA
    && resolve(patch.reference.path) === resolve(repo, REFERENCE) && patch.profiles?.sha256 === profilesSha && patch.author?.sha256 === authorSha
    && patch.lowerAuthorSha256 === LOWER_SHA && patch.helperSha256 === HELPER_SHA, '실제 패치 입력/author 출처 불일치');
  const blend = join(out, row.asset+'.blend');
  requireValid(patch.blend?.sha256 === sha(readFileSync(blend)) && resolve(patch.blend.path) === resolve(blend), '실제 blend 출처 불일치');
  for (const v of [patch.restValidation, patch.blendValidation]) for (const key of ['sourceToBlender', 'blenderToSource'])
    requireValid(v?.tolerance === .0001 && Number.isFinite(v?.[key]?.maximum) && v[key].maximum >= 0 && v[key].maximum <= .0001, '실제 Bpy REST 검증 누락');
  requireValid(patch.primitive?.node === data.node.index && patch.primitive.mesh === data.node.mesh && patch.primitive.primitive === 0 && patch.primitive.vertexCount === ASSETS[row.asset], 'primitive identity 오류');
  const records = profile(data, reference), f = field(data, records, row.asset);
  requireValid(equal(patch.profile?.parameters, PARAMS), '승인된 고정 profile 변경'); verifyProfile(patch.profile.sides, records);
  requireValid(equal(patch.profile.domain, f.domain), '공간 경계/제외 영역 불일치');
  requireValid(equal(patch.normalEligibleVertices, [...f.normals]) && Array.isArray(patch.profile.mask) && patch.profile.mask.length === f.mask.size, 'normal/mask 집합 누락');
  const seen = new Set();
  for (const r of patch.profile.mask) {
    const e = f.mask.get(r.vertex);
    requireValid(e && !seen.has(r.vertex) && r.side === e.side && Math.abs(r.mass-e.mass) <= 1e-8 && Math.abs(r.distance-e.distance) <= 1e-8 && Math.abs(r.alpha-e.alpha) <= 1e-8
      && near(r.factors, e.factors, 1e-8) && near(r.delta, e.delta, 1e-8), '실제 field 수식 불일치'); seen.add(r.vertex);
  }
  const bin = Buffer.from(data.bin), allowed = new Uint8Array(bin.length), changed = new Set(), normalChanged = new Set();
  function apply(rows, view, set, permitted) {
    requireValid(Array.isArray(rows), '수정 배열 누락');
    for (const r of rows) {
      requireValid(Number.isInteger(r.vertex) && permitted.has(r.vertex) && !set.has(r.vertex) && finite(r.new, 3) && near(r.old, view.rows[r.vertex], 0), '허용 밖/중복/원본 불일치 patch');
      set.add(r.vertex);
      for (let k = 0; k < 3; k++) { const at = view.offset(r.vertex, k); bin.writeFloatLE(r.new[k], at); for (let b = 0; b < 4; b++) allowed[at+b] = 1; }
    }
  }
  requireValid(equal(Object.keys(patch.changes).sort(), ['normals', 'positions']), 'POSITION/NORMAL 외 patch 금지');
  apply(patch.changes.positions, data.position, changed, new Set(f.mask.keys())); apply(patch.changes.normals, data.normal, normalChanged, f.normals);
  requireValid(changed.size > 0, '실제 위치 변화 없음');
  const positions = data.position.rows.map((_, i) => data.position.read(bin, i)), actual = positions.map((p, i) => skinned(p, data.vertexMatrices[i]));
  let maxMove = 0, maxRestError = 0;
  actual.forEach((p, i) => {
    const move = p.distanceTo(data.points[i]), error = p.distanceTo(f.points[i]);
    requireValid(p.toArray().every(Number.isFinite) && move <= .15 && error <= 3e-6, '정적 field/F32 REST/최대변위 불일치: '+i);
    if (!f.mask.has(i)) requireValid(near(positions[i], data.position.rows[i], 0), '허용 밖 POSITION 변경');
    if (!f.normals.has(i)) requireValid(near(data.normal.read(bin, i), data.normal.rows[i], 0), '허용 밖 NORMAL 변경');
    requireValid(near(data.joints.read(bin, i), data.joints.rows[i], 0) && near(data.weights.read(bin, i), data.weights.rows[i], 0), '원본 joints/weights 변경');
    maxMove = Math.max(maxMove, move); maxRestError = Math.max(maxRestError, error);
  });
  const rawTriangles = triangleGate(data.position.rows, positions, data.faces, changed), restTriangles = triangleGate(data.points.map(p => p.toArray()), actual.map(p => p.toArray()), data.faces, changed);
  checkNormals(data, positions, bin, changed, normalChanged, f.normals);
  for (let i = 0; i < bin.length; i++) requireValid(allowed[i] || bin[i] === data.bin[i], '허용 POSITION/NORMAL 밖 BIN 변경');
  const sole = Object.fromEntries(SIDES.map(side => [side, Math.min(...records[side].source.soleVertices.map(i => actual[i].y))]));
  for (const side of SIDES) requireValid(Number.isFinite(patch.actualRestSole?.[side]) && Math.abs(patch.actualRestSole[side]-sole[side]) <= 1e-8, '실제 REST sole 보고 불일치');
  const doc = structuredClone(data.doc), old = doc.accessors[data.a.POSITION];
  old.min = [0, 1, 2].map(k => Math.min(...positions.map(p => p[k]))); old.max = [0, 1, 2].map(k => Math.max(...positions.map(p => p[k])));
  const compare = structuredClone(doc);
  for (const key of ['min', 'max']) { if (key in data.doc.accessors[data.a.POSITION]) compare.accessors[data.a.POSITION][key] = data.doc.accessors[data.a.POSITION][key]; else delete compare.accessors[data.a.POSITION][key]; }
  requireValid(equal(compare, data.doc), 'POSITION bounds 외 JSON 변경');
  const bytes = serialize(doc, bin), decoded = parse(bytes);
  requireValid(decoded.bin.equals(bin) && equal(decoded.doc, doc), '직렬화 후 GLB 불일치');
  return { row, bytes, report: { ok: true, candidateOnly: true, asset: row.asset, source: fileRecord(resolve(row.path)), reference: fileRecord(join(repo, REFERENCE)),
    profiles: fileRecord(profilesPath), author: fileRecord(join(repo, 'art-src/higher-bodies/author_foot_fit_v1.py')), packer: fileRecord(new URL(import.meta.url)), patch: fileRecord(patchPath), blend: fileRecord(blend),
    positionChanges: changed.size, normalChanges: normalChanged.size, maxMove, maxRestError, rawTriangles, restTriangles, actualRestSole: sole,
    jointsWeightsExact: true, binOutsidePositionNormalExact: true, jsonOutsidePositionBoundsExact: true,
    limitations: ['candidate only; actual direct/swap dense and GPU pending', 'affine .006 target is not a contact acceptance guarantee', 'body motion packet requires new actual body SHA validation'] } };
}
const completed = [];
try {
  // 세 패킷 모두 검증한 뒤 처음으로 GLB를 생성한다. 출력은 create-once다.
  const prepared = packet.inputs.map(prepare);
  requireValid(sha(readFileSync(profilesPath)) === profilesSha && sha(readFileSync(join(repo, REFERENCE))) === REFERENCE_SHA, '검증 중 입력 변경');
  for (const row of packet.inputs) requireValid(sha(readFileSync(resolve(row.path))) === row.sha256, '검증 중 몸체 입력 변경');
  for (const item of prepared) {
    const path = join(out, item.row.asset+'.glb'); writeFileSync(path, item.bytes, { flag: 'wx' });
    item.report.output = fileRecord(path); writeFileSync(path+'.report.json', JSON.stringify(item.report, null, 2), { flag: 'wx' }); completed.push(item.report);
  }
  writeFileSync(join(out, 'foot-pack-report.json'), JSON.stringify({ ok: true, candidateOnly: true, assets: completed }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, assets: completed }));
} catch (error) {
  writeFileSync(join(out, 'foot-pack-report.json'), JSON.stringify({ ok: false, error: String(error.stack || error), completedAssets: completed }, null, 2), { flag: 'wx' });
  throw error;
}
