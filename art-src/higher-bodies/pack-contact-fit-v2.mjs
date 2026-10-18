// 접촉 v2 독립 패커. 정확 lower03에서 승인된 팔/뒤자락 성분만 새 파일에 기록한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const requireValid = (ok, message) => { if (!ok) throw new Error(message); };
requireValid(argv.length === 6 && argv[0] === '--repo' && argv[2] === '--lower-dir' && argv[4] === '--out-dir', '사용: node pack-contact-fit-v2.mjs --repo <repo> --lower-dir <정확 lower03> --out-dir <새 contact 디렉터리>');
const repo = resolve(argv[1]), lowerDir = resolve(argv[3]), out = resolve(argv[5]);
const requireRepo = createRequire(join(repo, 'package.json'));
const THREE = requireRepo('three');
const { Matrix4, Vector3, Vector4, Quaternion } = THREE;
const sha = data => createHash('sha256').update(data).digest('hex');
const fileRecord = path => { const b = readFileSync(path); return { path, bytes: b.length, sha256: sha(b) }; };
const ASSETS = [
  ['hero_ranger_t2', 'ranger', 'e90f6b9c23458d26b47f9718803430c8efbd537740765f472fa48b80c79429db', 16675, -.0224214],
  ['hero_ranger_t3', 'ranger', '41a3a8cd9310ed8620f5a30cab45df1b20a29cb2055f7d35c1c3caaa12d4ad72', 17408, .0304797],
  ['hero_rogue_t2', 'rogue', '73459cf328b31d53a8068ef6ed7e81b5d8a6da515fdb03a14e7e63344e22a48a', 16299, -.1173232],
  ['hero_rogue_t3', 'rogue', '78fad9b7e5386e0d35fc0ea96214c7bc46aa7528771d1aa0c6885c6c69664c08', 15728, -.1002497],
  ['avatar_rogue_crow', 'rogue', 'a5d5e919156669f243c93e483543ecc00b21f1a82a3a88efbe6772f0bb5a259b', 14697, -.1660811],
];
const REFERENCES = {
  ranger: ['hero_ranger_t1', '2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23'],
  rogue: ['hero_rogue_t1', '9d2dab5e01dd9df6b80f6343a1d32820772ca21080468011473893a009ea0539'],
};
const HELPER_SHA = '78ec15dfeb5e5908237586bc77f8b3e8a8e291efcc24fd35f35627088c5eaab1';
const canonical = s => s.replaceAll(':', '').replaceAll('_', '');
const vec = a => new Vector3().fromArray(a);
const near = (a, b, eps) => a.length === b.length && a.every((x, i) => Math.abs(x-b[i]) <= eps);
const finiteRow = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const skinned = (p, matrix) => { const v = new Vector4(...p, 1).applyMatrix4(matrix); return new Vector3(v.x, v.y, v.z); };

function parse(raw) {
  requireValid(raw.toString('ascii', 0, 4) === 'glTF' && raw.readUInt32LE(4) === 2 && raw.readUInt32LE(8) === raw.length, 'GLB 헤더 오류');
  const chunks = [];
  for (let at = 12; at < raw.length;) {
    const n = raw.readUInt32LE(at), type = raw.readUInt32LE(at+4);
    requireValid(at+8+n <= raw.length, 'GLB chunk 범위 오류');
    chunks.push({ type, data: raw.subarray(at+8, at+8+n) }); at += 8+n;
  }
  requireValid(chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942, 'JSON+BIN만 지원합니다.');
  return { doc: JSON.parse(chunks[0].data.toString()), bin: chunks[1].data };
}

function access(doc, bin, index) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  requireValid(!a.sparse && view && !(view.buffer || 0) && !view.extensions?.EXT_meshopt_compression, '지원하지 않는 accessor');
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const start = (view.byteOffset || 0)+(a.byteOffset || 0), stride = view.byteStride || width*size;
  requireValid(size && width && stride >= width*size && start+(a.count-1)*stride+width*size <= bin.length, 'accessor 범위 오류');
  const offset = (i, k) => start+i*stride+k*size;
  function read(bytes, i) {
    return Array.from({ length: width }, (_, k) => {
      const at = offset(i, k);
      const v = a.componentType === 5126 ? bytes.readFloatLE(at) : a.componentType === 5121 ? bytes.readUInt8(at)
        : a.componentType === 5123 ? bytes.readUInt16LE(at) : bytes.readUInt32LE(at);
      requireValid(!a.normalized || [5121, 5123].includes(a.componentType), '정규화 표현 오류');
      return a.normalized ? v/(a.componentType === 5121 ? 255 : 65535) : v;
    });
  }
  return { a, width, size, offset, read, rows: Array.from({ length: a.count }, (_, i) => read(bin, i)) };
}

function worldNodes(doc) {
  const parents = new Map(), cache = new Map(), visiting = new Set();
  doc.nodes.forEach((n, i) => (n.children || []).forEach(c => { requireValid(!parents.has(c), '중복 부모'); parents.set(c, i); }));
  function world(i) {
    if (cache.has(i)) return cache.get(i);
    requireValid(!visiting.has(i), '본 계층 순환'); visiting.add(i);
    const n = doc.nodes[i];
    const m = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(vec(n.translation || [0, 0, 0]), new Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), vec(n.scale || [1, 1, 1]));
    if (parents.has(i)) m.premultiply(world(parents.get(i)));
    cache.set(i, m); visiting.delete(i); return m;
  }
  return doc.nodes.map((_, i) => world(i));
}

function roundSeven(x) {
  const value = x*1e7, low = Math.floor(value), fraction = value-low;
  return (fraction === .5 ? low+(low%2 ? 1 : 0) : Math.round(value))/1e7;
}

const LOWER_AUTHOR_SHA = '64505e29fd7040b2fe774720f63064359e9cca84445f7bc60744103784bfd003';
const LOWER_SHA = {
  hero_ranger_t2: '391a51e693835244e05976c401c2372995a888199124ed4ff56f7f403dbaaafa',
  hero_ranger_t3: '4d5e67cf27ba378ca41611ff21bf74b52114c88a86748fab1c10516765ee6e10',
  hero_rogue_t2: '5410f6ab88abb42c452ad1314585eb417e39e413fe1aff364edc743cb749e81c',
  hero_rogue_t3: 'c48e61c7a55a67ccb33061691d534b63ef8ea77143cb7e4acd46b5c042da34f7',
  avatar_rogue_crow: 'd4385d9dde29808ea142cbc74efe1680e3d7503a624177d6d65ebf8ad5acbc85',
};
const ARM_ASSETS = ['avatar_rogue_crow', 'hero_ranger_t2'];
const COAT_ASSETS = ['hero_rogue_t2', 'hero_rogue_t3'];
const COAT_PARAMS = { posteriorStart: .30, posteriorWidth: .12, lowFromAnkle: .04, lowWidth: .06, highFromHips: -.20, highWidth: .12, boundaryWidth: .10 };
const ARM_PARAMS = { minimumMass: .5, lowFromHips: .10, lowWidth: .08, zInner: .12, zWidth: .08, protectedMargin: .005, minimumFadeWidth: .08 };
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const smooth = v => { v = Math.max(0, Math.min(1, v)); return v*v*(3-2*v); };
const finiteWidth = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const product = a => a.reduce((v, x) => v*x, 1);
const armSuffix = (name, side) => name.startsWith('mixamorig'+side) ? name.slice(('mixamorig'+side).length) : '';
const protectedAt = (data, i) => data.joints.rows[i].some((j, k) => data.weights.rows[i][k] > 1e-8 && /Head|Neck|Spine/.test(data.names[j]));
function armMass(data, i, side) { return data.joints.rows[i].reduce((s, j, k) => { const suffix = armSuffix(data.names[j], side); return s+(['Arm', 'ForeArm'].includes(suffix) || suffix.startsWith('Hand') ? data.weights.rows[i][k] : 0); }, 0); }
function bone(data, suffix) { const k = data.names.indexOf('mixamorig'+suffix); requireValid(k >= 0, '본 없음: '+suffix); return new Vector3().setFromMatrixPosition(data.world[data.skin.joints[k]]); }
function weighted(js, ws, matrices) { const m = new Matrix4(); m.elements.fill(0); js.forEach((j, k) => { for (let c = 0; c < 16; c++) m.elements[c] += matrices[j].elements[c]*ws[k]; }); return m; }
function dataFor(path, exactSha) {
  const raw = readFileSync(path); requireValid(sha(raw) === exactSha, '정확 input SHA 불일치: '+path);
  const { doc, bin } = parse(raw), meshNodes = doc.nodes.map((n, i) => ({...n, index: i})).filter(n => n.mesh !== undefined);
  requireValid(meshNodes.length === 1 && meshNodes[0].skin !== undefined, '단일 스킨 메시 필요');
  const node = meshNodes[0], primitives = doc.meshes[node.mesh].primitives;
  requireValid(primitives.length === 1 && (primitives[0].mode ?? 4) === 4 && !primitives[0].targets && !primitives[0].extensions, 'primitive 형식 오류');
  const p = primitives[0], a = p.attributes;
  requireValid(!['JOINTS_1', 'WEIGHTS_1', 'TANGENT'].some(k => k in a), '추가 성분 계약 없음');
  const [position, normal, joints, weights] = ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].map(k => access(doc, bin, a[k]));
  requireValid([position, normal, weights].every(v => v.a.componentType === 5126 && !v.a.normalized), 'float32 위치/법선/가중치 필요');
  requireValid(position.width === 3 && normal.width === 3 && joints.width === 4 && weights.width === 4 && [normal, joints, weights].every(v => v.a.count === position.a.count), '속성 범위 오류');
  const skin = doc.skins[node.skin], names = skin.joints.map(i => canonical(doc.nodes[i].name)), world = worldNodes(doc), ibms = access(doc, bin, skin.inverseBindMatrices).rows;
  requireValid(names.length === 65 && ibms.length === 65, '원본 본 수 오류');
  const matrices = skin.joints.map((i, k) => world[i].clone().multiply(new Matrix4().fromArray(ibms[k])));
  const vertexMatrices = joints.rows.map((js, i) => weighted(js, weights.rows[i], matrices));
  const points = position.rows.map((p, i) => skinned(p, vertexMatrices[i]));
  const indices = access(doc, bin, p.indices).rows.flat(); requireValid(indices.length%3 === 0, '삼각형 인덱스 오류');
  const faces = []; for (let i=0; i<indices.length; i+=3) faces.push(indices.slice(i,i+3));
  return {raw, doc, bin, node, p, a, position, normal, joints, weights, skin, names, world, matrices, points, faces};
}
function sameExceptBounds(a, b, positionId) {
  const copy = structuredClone(b), old = a.accessors[positionId], next = copy.accessors[positionId];
  for (const field of ['min', 'max']) { if (field in old) next[field] = old[field]; else delete next[field]; }
  return JSON.stringify(copy) === JSON.stringify(a);
}
function verifyLower(original, lower) {
  requireValid(sameExceptBounds(original.doc, lower.doc, original.a.POSITION), 'lower03 POSITION bounds 밖 JSON 변경');
  requireValid(original.bin.length === lower.bin.length, 'lower03 BIN 길이 변경');
  const allowed = new Uint8Array(original.bin.length);
  for (const view of [original.position, original.normal]) for (let i=0; i<view.a.count; i++) for (let k=0; k<3; k++) for(let b=0;b<4;b++) allowed[view.offset(i,k)+b]=1;
  for(let i=0;i<allowed.length;i++) requireValid(allowed[i] || original.bin[i] === lower.bin[i], 'lower03 범위 밖 BIN 변경');
  for(let i=0;i<original.position.a.count;i++) if(protectedAt(original,i)) requireValid(near(original.position.rows[i], lower.position.rows[i],0) && near(original.normal.rows[i],lower.normal.rows[i],0),'lower03 보호 geometry 변경');
}
class Heap {
  values=[];
  push(row) { const a=this.values; a.push(row); let i=a.length-1; while(i>0){const p=(i-1)>>1;if(a[p][0]<=row[0])break;a[i]=a[p];i=p;}a[i]=row; }
  pop() { const a=this.values, result=a[0], last=a.pop(); if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length && a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return result; }
}
function coatMask(original) {
  const hips=bone(original,'Hips'), ankleY=Math.max(bone(original,'LeftFoot').y,bone(original,'RightFoot').y);
  const allowedNames = new Set(['mixamorigHips','mixamorigLeftUpLeg','mixamorigRightUpLeg','mixamorigLeftLeg','mixamorigRightLeg']);
  const count=original.points.length, permitted=new Set(), hipSlots=new Map();
  for(let i=0;i<count;i++){
    const js=original.joints.rows[i], ws=original.weights.rows[i];
    const slot=js.findIndex((j,k)=>ws[k]>1e-8 && original.names[j]==='mixamorigHips');
    if(slot>=0 && js.every((j,k)=>ws[k]<=1e-8 || allowedNames.has(original.names[j]))){permitted.add(i);hipSlots.set(i,slot);}
  }
  const edges=Array.from({length:count},()=>new Map());
  const edge=(a,b,d)=>{edges[a].set(b,Math.min(edges[a].get(b)??Infinity,d));edges[b].set(a,Math.min(edges[b].get(a)??Infinity,d));};
  for(const [a,b,c] of original.faces)for(const [i,j]of[[a,b],[b,c],[c,a]])edge(i,j,original.points[i].distanceTo(original.points[j]));
  const seams=new Map();
  for(let i=0;i<count;i++){const key=original.position.rows[i].map(v=>{const scaled=v*1e6,low=Math.floor(scaled),fraction=scaled-low;return (fraction===.5?low+(low%2?1:0):Math.round(scaled))/1e6;}).join(',');if(seams.has(key))edge(i,seams.get(key),0);else seams.set(key,i);}
  const distances=new Float64Array(count);distances.fill(Infinity);const heap=new Heap();
  for(let i=0;i<count;i++)if(!permitted.has(i)){distances[i]=0;heap.push([0,i]);}
  while(heap.values.length){const [d,i]=heap.pop();if(d!==distances[i] || d>=.10)continue;for(const[j,length]of edges[i]){const next=d+length;if(next<distances[j]){distances[j]=next;heap.push([next,j]);}}}
  const result=new Map();
  for(const i of permitted){const p=original.points[i],factors=[smooth((hips.z-p.z-.30)/.12),smooth((p.y-ankleY-.04)/.06),1-smooth((p.y-hips.y+.20)/.12),smooth(distances[i]/.10)],alpha=product(factors);if(alpha>1e-10)result.set(i,{vertex:i,alpha,factors,boundaryDistance:Number.isFinite(distances[i])?distances[i]:null,hipSlot:hipSlots.get(i)});}
  return result;
}
function anchors(data,side) {
  const mass=(i,g)=>data.joints.rows[i].reduce((s,j,k)=>{const suffix=armSuffix(data.names[j],side);return s+(suffix===g || (g==='Hand'&&suffix.startsWith('Hand')) ? data.weights.rows[i][k] :0);},0);
  const result={}, sign=side==='Left'?1:-1;
  for(const[label,a,b]of[['elbow','Arm','ForeArm'],['wrist','ForeArm','Hand']]){
    const ids=[];const p=new Vector3();let total=0;
    for(let i=0;i<data.points.length;i++){const wa=mass(i,a),wb=mass(i,b);if(wa>=.15&&wb>=.15){ids.push(i);const w=wa*wb;p.addScaledVector(data.points[i],w);total+=w;}}
    requireValid(ids.length>=8,'인접 arm anchor 표본 부족'); result[label]={point:p.multiplyScalar(1/total).toArray(),vertices:ids};
  }
  const median=values=>{values.sort((a,b)=>a-b);const i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2;};
  for(const finger of FINGERS){const ids=[];for(let i=0;i<data.points.length;i++){const m=data.joints.rows[i].reduce((s,j,k)=>s+(armSuffix(data.names[j],side).startsWith('Hand'+finger)?data.weights.rows[i][k]:0),0);if(m>=.5)ids.push(i);}
    requireValid(ids.length>=3,'손가락 anchor 표본 부족');ids.sort((a,b)=>roundSeven(sign*data.points[a].x)-roundSeven(sign*data.points[b].x)||a-b);const tips=ids.slice(Math.floor(ids.length*.95));let maximum=ids[0];for(const i of ids)if(sign*data.points[i].x>sign*data.points[maximum].x||(data.points[i].x===data.points[maximum].x&&i>maximum))maximum=i;result[finger]={point:[data.points[maximum].x,median(tips.map(i=>data.points[i].y)),median(tips.map(i=>data.points[i].z))],vertices:tips};}
  return result;
}
function slopes(xs,ys) {
  const h=xs.slice(1).map((x,i)=>x-xs[i]);requireValid(h.every(v=>v>1e-5),'anchor 순서 오류');const d=h.map((v,i)=>(ys[i+1]-ys[i])/v),r=[d[0]];
  for(let i=1;i<xs.length-1;i++){if(d[i-1]*d[i]<=0)r.push(0);else{const a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];r.push((a+b)/(a/d[i-1]+b/d[i]));}}r.push(d.at(-1));return r;
}
function hermite([xs,ys,ds],x){if(x<=xs[0])return ys[0]+ds[0]*(x-xs[0]);if(x>=xs.at(-1))return ys.at(-1)+ds.at(-1)*(x-xs.at(-1));const i=xs.findIndex((v,k)=>k>0&&x<=v)-1,h=xs[i+1]-xs[i],t=(x-xs[i])/h;return(2*t**3-3*t*t+1)*ys[i]+(t**3-2*t*t+t)*h*ds[i]+(-2*t**3+3*t*t)*ys[i+1]+(t**3-t*t)*h*ds[i+1];}
function armsProfile(data,reference) {
  const hips=bone(data,'Hips'), refHips=bone(reference,'Hips'), records={};
  for(const side of ['Left','Right']){
    const sign=side==='Left'?1:-1,source=anchors(data,side),target=anchors(reference,side),start=sign*(bone(data,side+'Arm').x-hips.x),handZ=bone(data,side+'Hand').z;
    const commonX=[start,...['elbow','wrist'].map(k=>sign*(source[k].point[0]-hips.x))],commonY=[start,...['elbow','wrist'].map(k=>sign*(target[k].point[0]-refHips.x))];
    const baseX=[...commonX,sign*(source.Middle.point[0]-hips.x)],baseY=[...commonY,sign*(target.Middle.point[0]-refHips.x)],shared=slopes(baseX,baseY);shared[0]=1;
    const transverse={};for(const axis of[1,2]){const vals=[0,...['elbow','wrist','Middle'].map(k=>target[k].point[axis]-source[k].point[axis])],ds=slopes(baseX,vals);ds[0]=0;transverse[axis]=[vals,ds];}
    let protectedStop=start;for(let i=0;i<data.points.length;i++){const p=data.points[i];if(p.y>hips.y+.10&&Math.abs(p.z-handZ)<.20&&armMass(data,i,side)>.5&&protectedAt(data,i))protectedStop=Math.max(protectedStop,sign*(p.x-hips.x));}protectedStop+=.005;
    requireValid(commonX[2]-protectedStop>=.08,'보호 arm fade 부족');const curves={};
    for(const finger of FINGERS){const xs=[...commonX,sign*(source[finger].point[0]-hips.x)],ys=[...commonY,sign*(target[finger].point[0]-refHips.x)];requireValid(xs.slice(1).every((x,i)=>x-xs[i]>1e-5),'손가락 순서 오류');const secant=(ys[3]-ys[2])/(xs[3]-xs[2]),ds=[...shared.slice(0,3),secant];requireValid(secant>.05&&ds[2]>0&&ds[2]<3*secant,'손가락 단조성 오류');const channels=[[xs,ys,ds]];for(const axis of[1,2]){const[v,d]=transverse[axis];channels.push([xs,[...v.slice(0,3),target[finger].point[axis]-source[finger].point[axis]],[...d.slice(0,3),0]]);}for(let j=0;j<=300;j++){const x=start+(xs[3]-start)*j/300;requireValid((hermite(channels[0],x+1e-5)-hermite(channels[0],x-1e-5))/2e-5>.05,'arm 곡선 단조성 오류');}curves[finger]=channels;}
    records[side]={source,target,curves,shoulderStart:start,protectedFadeStart:protectedStop,protectedFadeEnd:commonX[2],handZ,sourceHipsX:hips.x,referenceHipsX:refHips.x};
  }
  function deform(i){const before=data.points[i];if(protectedAt(data,i))return {point:before.clone(),mask:null};const side=before.x>=hips.x?'Left':'Right',sign=side==='Left'?1:-1,mass=armMass(data,i,side),r=records[side];const factors=[smooth((mass-.5)/.5),smooth((sign*(before.x-hips.x)-r.protectedFadeStart)/(r.protectedFadeEnd-r.protectedFadeStart)),smooth((before.y-hips.y-.10)/.08),1-smooth((Math.abs(before.z-r.handZ)-.12)/.08)],alpha=product(factors);if(alpha<=1e-10)return{point:before.clone(),mask:null};const fw={};for(const finger of FINGERS)fw[finger]=data.joints.rows[i].reduce((s,j,k)=>s+(armSuffix(data.names[j],side).startsWith('Hand'+finger)?data.weights.rows[i][k]:0),0);const sum=Object.values(fw).reduce((a,b)=>a+b,0);requireValid(sum<=1.000001,'손가락 가중치 합 초과');fw.Middle+=Math.max(0,1-sum);const mapped=new Vector3(),x=sign*(before.x-hips.x);for(const finger of FINGERS){const[cx,cy,cz]=r.curves[finger];mapped.addScaledVector(new Vector3(hips.x+sign*hermite(cx,x),before.y+hermite(cy,x),before.z+hermite(cz,x)),fw[finger]);}return {point:before.clone().lerp(mapped,alpha),mask:{vertex:i,side,alpha,factors,armMass:mass}};}
  return {records,deform};
}
function verifyCurves(actual, expected) {
  for(const side of ['Left','Right']){
    const a=actual[side],e=expected[side];requireValid(a,'arm profile 누락');
    for(const field of ['shoulderStart','protectedFadeStart','protectedFadeEnd','handZ','sourceHipsX','referenceHipsX'])requireValid(Math.abs(a[field]-e[field])<=5e-6,'arm landmark 불일치: '+field);
    for(const kind of ['source','target'])for(const key of ['elbow','wrist',...FINGERS]){requireValid(near(a[kind][key].point,e[kind][key].point,5e-6),'arm anchor 불일치: '+side+' '+kind+' '+key);requireValid(JSON.stringify(a[kind][key].vertices)===JSON.stringify(e[kind][key].vertices),'arm anchor 표본 ID 불일치: '+side+' '+kind+' '+key);}
    for(const finger of FINGERS)for(let axis=0;axis<3;axis++)for(let field=0;field<3;field++)requireValid(near(a.curves[finger][axis][field],e.curves[finger][axis][field],5e-5),'arm curve 불일치');
  }
}
function boundaryDistances(data,permitted,width) {
  const count=data.points.length,edges=Array.from({length:count},()=>new Map());
  const edge=(a,b,d)=>{edges[a].set(b,Math.min(edges[a].get(b)??Infinity,d));edges[b].set(a,Math.min(edges[b].get(a)??Infinity,d));};
  for(const[a,b,c]of data.faces)for(const[i,j]of[[a,b],[b,c],[c,a]])edge(i,j,data.points[i].distanceTo(data.points[j]));
  const seams=new Map();for(let i=0;i<count;i++){const key=data.position.rows[i].map(v=>{const s=v*1e6,l=Math.floor(s),f=s-l;return(f===.5?l+(l%2?1:0):Math.round(s))/1e6;}).join(',');if(seams.has(key))edge(i,seams.get(key),0);else seams.set(key,i);}
  const distances=new Float64Array(count);distances.fill(Infinity);const heap=new Heap();for(let i=0;i<count;i++)if(!permitted.has(i)){distances[i]=0;heap.push([0,i]);}
  while(heap.values.length){const[d,i]=heap.pop();if(d!==distances[i]||d>=width)continue;for(const[j,length]of edges[i]){const next=d+length;if(next<distances[j]){distances[j]=next;heap.push([next,j]);}}}return distances;
}
function forearmMask(original,reference) {
  const allowed=new Set(['mixamorigLeftArm','mixamorigLeftForeArm','mixamorigLeftHand','mixamorigLeftHandThumb1']);
  const permitted=new Set(),slots=new Map(),nearest=new Map(),refIndex=reference.names.indexOf('mixamorigLeftForeArm');
  requireValid(refIndex>=0,'reference forearm 없음');
  for(let i=0;i<original.points.length;i++){
    const js=original.joints.rows[i],ws=original.weights.rows[i],slot=js.findIndex((j,k)=>ws[k]>1e-8&&original.names[j]==='mixamorigLeftForeArm');
    if(slot<0||!js.every((j,k)=>ws[k]<=1e-8||allowed.has(original.names[j])))continue;
    let distance=Infinity,rid=-1;for(let j=0;j<reference.points.length;j++){const d=original.points[i].distanceTo(reference.points[j]);if(d<distance){distance=d;rid=j;}}
    const mass=reference.joints.rows[rid].reduce((s,j,k)=>s+(j===refIndex?reference.weights.rows[rid][k]:0),0);
    if(distance>=.06||mass<.95)continue;permitted.add(i);slots.set(i,slot);nearest.set(i,{referenceVertex:rid,referenceDistance:distance,referenceForeArmMass:mass});
  }
  const distances=boundaryDistances(original,permitted,.04),elbow=bone(original,'LeftForeArm'),wrist=bone(original,'LeftHand'),segment=wrist.clone().sub(elbow),denominator=segment.lengthSq(),result=new Map();
  for(const i of permitted){const p=original.points[i],t=Math.max(0,Math.min(1,p.clone().sub(elbow).dot(segment)/denominator)),radial=p.distanceTo(elbow.clone().addScaledVector(segment,t)),ref=nearest.get(i);
    const factors=[smooth((p.x-elbow.x-.02)/.04),1-smooth((p.x-wrist.x+.10)/.06),1-smooth((radial-.08)/.05),1-smooth((ref.referenceDistance-.03)/.03),smooth(distances[i]/.04)],alpha=.6*product(factors);
    if(alpha>1e-10)result.set(i,{vertex:i,alpha,factors,boundaryDistance:Number.isFinite(distances[i])?distances[i]:null,targetSlot:slots.get(i),radialDistance:radial,region:'left-forearm',...ref});
  }return result;
}
function verifyMask(actual,expected,kind){
  requireValid(Array.isArray(actual)&&actual.length===expected.size,'mask 크기 불일치: '+kind);const seen=new Set();
  for(const row of actual){const e=expected.get(row.vertex);requireValid(e&&!seen.has(row.vertex),'mask 허용 정점/중복 오류: '+kind);seen.add(row.vertex);
    requireValid(Number.isFinite(row.alpha)&&Math.abs(row.alpha-e.alpha)<=2e-7&&near(row.factors,e.factors,2e-7),'mask 수식 불일치: '+kind+' '+row.vertex);
    for(const field of['hipSlot','targetSlot'])if(field in e)requireValid(row[field]===e[field],'영향 target 슬롯 변경');
    if(kind==='forearm'){requireValid(row.referenceVertex===e.referenceVertex&&Math.abs(row.referenceDistance-e.referenceDistance)<=1e-8&&Math.abs(row.referenceForeArmMass-e.referenceForeArmMass)<=1e-8&&Math.abs(row.radialDistance-e.radialDistance)<=1e-8,'canonical 전완 근거 불일치');}
    if('boundaryDistance'in e)requireValid(row.boundaryDistance===null?e.boundaryDistance===null:Number.isFinite(row.boundaryDistance)&&e.boundaryDistance!==null&&Math.abs(row.boundaryDistance-e.boundaryDistance)<=1e-8,'surface 거리 불일치');
  }
}
function checkNormals(lower,positions,bin,changed,normalChanged,eligible){
  const keys=lower.position.rows.map((p,i)=>[...p,...lower.normal.rows[i]].map(roundSeven).join(',')),groups=new Map(),touched=new Set();let minRatio=1,minDot=1,changedFaces=0;
  for(let t=0;t<lower.faces.length;t++){
    const face=lower.faces[t],[a,b,c]=face.map(i=>vec(lower.position.rows[i])),[aa,bb,cc]=face.map(i=>vec(positions[i]));const old=b.sub(a).cross(c.sub(a)),next=bb.sub(aa).cross(cc.sub(aa));
    if(face.some(i=>changed.has(i))){changedFaces++;face.forEach(i=>touched.add(keys[i]));if(old.length()>1e-10){const ratio=next.length()/old.length(),dot=old.clone().normalize().dot(next.clone().normalize());requireValid(ratio>.03&&ratio<25&&dot>0,'삼각형 붕괴/뒤집힘: '+t);minRatio=Math.min(minRatio,ratio);minDot=Math.min(minDot,dot);}}
    for(const i of face){if(!groups.has(keys[i]))groups.set(keys[i],{old:new Vector3(),next:new Vector3()});const g=groups.get(keys[i]);g.old.add(old);g.next.add(next);}
  }
  for(let i=0;i<lower.points.length;i++){const g=groups.get(keys[i]);if(!touched.has(keys[i])||!eligible.has(i)||!g||Math.min(g.old.length(),g.next.length())<=1e-10){requireValid(!normalChanged.has(i),'영향 없는 법선 변경: '+i);continue;}
    const expected=vec(lower.normal.rows[i]).applyQuaternion(new Quaternion().setFromUnitVectors(g.old.clone().normalize(),g.next.clone().normalize())).normalize(),actual=vec(lower.normal.read(bin,i));
    requireValid(actual.distanceTo(expected)<=2e-5&&Math.abs(actual.length()-1)<=2e-5,'seam 회전/정규화 불일치: '+i);
  }return {changedFaces,minimumAreaRatio:minRatio,minimumNormalDot:minDot};
}
function pack(contract) {
  const[asset,hero,sourceSha,count]=contract,sourcePath=join(repo,'asset-library/normalized',asset+'.glb'),lowerPath=join(lowerDir,asset+'.glb'),patchPath=join(out,asset+'.patch.json');
  const original=dataFor(sourcePath,sourceSha),lower=dataFor(lowerPath,LOWER_SHA[asset]);verifyLower(original,lower);
  requireValid(!lower.doc.animations?.length&&lower.position.a.count===count,'lower03 mesh-only/count 오류');
  const[refId,refSha]=REFERENCES[hero],reference=dataFor(join(repo,'asset-library/normalized',refId+'.glb'),refSha),patch=JSON.parse(readFileSync(patchPath));
  requireValid(patch.schema==='blade-surge.higher-contact-patch.v2'&&patch.ok===true&&patch.asset===asset,'패치 identity 오류');
  requireValid(patch.source?.sha256===sourceSha&&patch.lowerInput?.sha256===LOWER_SHA[asset]&&patch.reference?.sha256===refSha,'패치 원본 SHA 오류');
  requireValid(patch.lowerAuthorSha256===LOWER_AUTHOR_SHA&&sha(readFileSync(join(repo,'art-src/higher-bodies/author_lower_fit_v1.py')))===LOWER_AUTHOR_SHA,'lower03 source 변경');
  requireValid(patch.helperSha256===HELPER_SHA&&sha(readFileSync(join(repo,'art-src/avatar-fox/author_body_contact_v3.py')))===HELPER_SHA,'원본 helper 변경');
  requireValid(patch.author?.sha256===sha(readFileSync(join(repo,'art-src/higher-bodies/author_contact_fit_v2.py'))),'actual contact author SHA 불일치');
  requireValid(patch.blend?.sha256===sha(readFileSync(join(out,asset+'.blend'))),'actual blend SHA 불일치');
  for(const value of[patch.restValidation,patch.blendValidation])for(const key of['sourceToBlender','blenderToSource'])requireValid(value?.tolerance===.0001&&Number.isFinite(value?.[key]?.maximum)&&value[key].maximum>=0&&value[key].maximum<=.0001,'실제 Bpy REST 검증 누락');
  requireValid(patch.primitive?.node===lower.node.index&&patch.primitive.mesh===lower.node.mesh&&patch.primitive.primitive===0&&patch.primitive.vertexCount===count,'primitive 원본 식별 오류');
  const profile=patch.profile;
  requireValid(JSON.stringify(profile?.armAssets)===JSON.stringify(ARM_ASSETS)&&JSON.stringify(profile.coatAssets)===JSON.stringify(COAT_ASSETS)&&JSON.stringify(profile.armParameters)===JSON.stringify(ARM_PARAMS)&&JSON.stringify(profile.coatParameters)===JSON.stringify(COAT_PARAMS),'저작 profile 변경');
  requireValid(profile.weightMaskCoordinates==='decodedGLTF_float64_weightedREST'&&profile.armAnchorCoordinates==='decodedGLTF_float64_weightedREST'&&profile.armDistalOrder==='round(signedWorldX*1e7),vertexId; top5%; unquantized maximum signedX','weight/anchor 좌표·순서 계약 변경');
  requireValid(JSON.stringify(profile.forearmParameters)===JSON.stringify({maximumAlpha:.6,referenceDistanceInner:.03,referenceDistanceOuter:.06,minimumReferenceForeArmMass:.95,boundaryWidth:.04}),'forearm profile 변경');
  const coat=COAT_ASSETS.includes(asset)?coatMask(original):new Map(),forearm=asset==='hero_ranger_t3'?forearmMask(original,reference):new Map();
  verifyMask(profile.garmentMask,coat,'coat');verifyMask(profile.forearmMask,forearm,'forearm');
  const weightMask=new Map([...coat,...forearm]),arm=ARM_ASSETS.includes(asset)?armsProfile(lower,reference):null;
  if(arm)verifyCurves(profile.armAnchors,arm.records);else requireValid(Object.keys(profile.armAnchors).length===0,'허용하지 않은 arm profile');
  let footProfile=null;const footEligible=new Set(),footNormal=new Set();
  if(asset==='avatar_rogue_crow'){
    const protectedY=lower.points.filter((_,i)=>protectedAt(lower,i)).map(p=>p.y),hipsY=bone(original,'Hips').y,fitStopY=Math.min(hipsY,...protectedY),ankleY=Math.max(bone(original,'LeftFoot').y,bone(original,'RightFoot').y);
    for(let i=0;i<count;i++)if(!protectedAt(lower,i)){if(lower.points[i].y<fitStopY)footEligible.add(i);if(lower.points[i].y<hipsY)footNormal.add(i);}
    const soles=[...footEligible].filter(i=>lower.points[i].y<ankleY+.02&&lower.joints.rows[i].reduce((sum,j,k)=>sum+(/^mixamorig(Left|Right)(Foot|ToeBase|ToeEnd|ToeBaseEnd)$/.test(lower.names[j])?lower.weights.rows[i][k]:0),0)>=.30);
    requireValid(soles.length,'crow03 sole 없음');const sourceSole=Math.min(...soles.map(i=>lower.points[i].y));requireValid(Math.abs(sourceSole-.012)<=3e-6&&fitStopY>sourceSole&&1-1.5*(.018-sourceSole)/(fitStopY-sourceSole)>.05,'crow03 추가 sole 계약 오류');
    footProfile={targetSole:.018,sourceSole,fitStopY};const actual=profile.footAdjustment;requireValid(actual?.targetSole===.018&&Math.abs(actual.sourceSole-sourceSole)<=3e-6&&Math.abs(actual.fitStopY-fitStopY)<=3e-6,'crow 추가 sole landmark 오류');requireValid(JSON.stringify(actual.footVertices)===JSON.stringify(soles)&&JSON.stringify(actual.normalEligibleVertices)===JSON.stringify([...footNormal]),'crow sole/normal 집합 불일치');
    requireValid(JSON.stringify(actual.positionEligibleVertices)===JSON.stringify([...footEligible]),'crow 위치 허용 집합 불일치');
  }else requireValid(profile.footAdjustment===null,'허용하지 않은 추가 sole');
  const armExpected=lower.points.map((point,i)=>arm?arm.deform(i):{point:point.clone(),mask:null});
  if(footProfile)for(const i of footEligible){const p=lower.points[i];armExpected[i].point.y+=(.018-footProfile.sourceSole)*(1-smooth((p.y-footProfile.sourceSole)/(footProfile.fitStopY-footProfile.sourceSole)));}
  const armMask=new Map(armExpected.filter(r=>r.mask).map(r=>[r.mask.vertex,r.mask]));
  // 팔 anchor 누적은 Bpy float32여서 위치/곡선 오차와 별도로 5e-6 mask 차이를 제한한다.
  requireValid(profile.armMask.length===armMask.size,'arm mask 개수 불일치');
  for(const row of profile.armMask){const expected=armMask.get(row.vertex);requireValid(expected&&row.side===expected.side&&Math.abs(row.alpha-expected.alpha)<=5e-6&&near(row.factors,expected.factors,5e-6),'arm mask 불일치');}
  const protectedIds=new Set(lower.points.flatMap((_,i)=>protectedAt(lower,i)?[i]:[])),hips=bone(original,'Hips');
  requireValid(JSON.stringify(patch.protectedVertices)===JSON.stringify([...protectedIds]),'보호 집합 변경');
  const normalEligible=ARM_ASSETS.includes(asset)?new Set(lower.points.flatMap((p,i)=>!protectedIds.has(i)&&p.y>hips.y+.10&&Math.max(armMass(lower,i,'Left'),armMass(lower,i,'Right'))>.5?[i]:[])):new Set();
  for(const i of footNormal)normalEligible.add(i);
  requireValid(JSON.stringify(patch.normalEligibleVertices)===JSON.stringify([...normalEligible].sort((a,b)=>a-b)),'법선 허용 집합 변경');
  const positionPermitted=new Set([...weightMask.keys(),...armMask.keys(),...footEligible]);
  const bin=Buffer.from(lower.bin),allowed=new Uint8Array(bin.length),changed=new Set(),normalChanged=new Set(),weightChanged=new Set();
  function apply(rows,view,seen,permitted,width,field){requireValid(Array.isArray(rows),'성분 변경 배열 없음: '+field);for(const row of rows){const i=row.vertex;requireValid(Number.isInteger(i)&&permitted.has(i)&&!seen.has(i)&&!protectedIds.has(i),'정점 범위/중복/보호 오류 '+field+' '+i);requireValid(finiteWidth(row.old,width)&&finiteWidth(row.new,width)&&near(row.old,view.rows[i],0),'원본 성분 불일치 '+field+' '+i);seen.add(i);for(let k=0;k<width;k++){const at=view.offset(i,k);bin.writeFloatLE(row.new[k],at);for(let b=0;b<4;b++)allowed[at+b]=1;}}}
  apply(patch.changes.positions,lower.position,changed,positionPermitted,3,'POSITION');
  apply(patch.changes.normals,lower.normal,normalChanged,normalEligible,3,'NORMAL');
  apply(patch.changes.weights,lower.weights,weightChanged,new Set(weightMask.keys()),4,'WEIGHTS');
  const positions=lower.position.rows.map((_,i)=>lower.position.read(bin,i));let maxMove=0,maxRestError=0,maxRawWeightCorrection=0,maxWeightL1=0;
  for(let i=0;i<count;i++){
    const before=lower.weights.rows[i],after=lower.weights.read(bin,i),mask=weightMask.get(i),expected=before.slice();
    if(mask){const targetName=coat.has(i)?'mixamorigHips':'mixamorigLeftForeArm',slot=mask.hipSlot??mask.targetSlot;let removed=0;lower.joints.rows[i].forEach((j,k)=>{if(lower.names[j]!==targetName){expected[k]=before[k]*(1-mask.alpha);removed+=before[k]-expected[k];}});expected[slot]+=removed;for(let k=0;k<4;k++)expected[k]=Math.fround(expected[k]);}
    requireValid(after.every(w=>w>=0&&w<=1.000001)&&Math.abs(after.reduce((a,b)=>a+b,0)-before.reduce((a,b)=>a+b,0))<=2e-7,'가중치 합/범위 오류: '+i);
    requireValid(near(after,expected,2e-7),'국소 가중치 수식 불일치: '+i);
    if(!mask)requireValid(near(after,before,0),'허용 범위 밖 가중치 변경');
    maxWeightL1=Math.max(maxWeightL1,after.reduce((s,w,k)=>s+Math.abs(w-before[k]),0));
    const current=skinned(positions[i],weighted(lower.joints.rows[i],after,lower.matrices)),wanted=armExpected[i].point,error=current.distanceTo(wanted),move=current.distanceTo(lower.points[i]);
    requireValid(error<=3e-6,'팔 수식/가중치 REST 보존 불일치: '+i);requireValid(move<=.20,'정점 이동 .20m 초과');
    maxRestError=Math.max(maxRestError,error);maxMove=Math.max(maxMove,move);
    if(mask){const rawMove=vec(positions[i]).distanceTo(vec(lower.position.rows[i]));requireValid(rawMove<=.001,'가중치 REST 재표현 .001m 초과');maxRawWeightCorrection=Math.max(maxRawWeightCorrection,rawMove);}
    if(!positionPermitted.has(i))requireValid(near(positions[i],lower.position.rows[i],0),'허용 범위 밖 POSITION 변경');
    if(!normalEligible.has(i))requireValid(near(lower.normal.read(bin,i),lower.normal.rows[i],0),'보호/범위 밖 NORMAL 변경');
  }
  const triangles=checkNormals(lower,positions,bin,changed,normalChanged,normalEligible);
  for(let i=0;i<bin.length;i++)requireValid(allowed[i]||bin[i]===lower.bin[i],'허용 성분 밖 BIN 변경');
  const doc=structuredClone(lower.doc),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};positions.forEach(p=>p.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);}));doc.accessors[lower.a.POSITION].min=bounds.min;doc.accessors[lower.a.POSITION].max=bounds.max;
  requireValid(sameExceptBounds(lower.doc,doc,lower.a.POSITION),'POSITION bounds 밖 JSON 변경');
  const json=Buffer.from(JSON.stringify(doc)),jsonSize=(json.length+3)&~3,binSize=(bin.length+3)&~3,result=Buffer.alloc(12+8+jsonSize+8+binSize);result.write('glTF');result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(jsonSize,12);result.writeUInt32LE(0x4e4f534a,16);result.fill(32,20,20+jsonSize);json.copy(result,20);result.writeUInt32LE(binSize,20+jsonSize);result.writeUInt32LE(0x004e4942,24+jsonSize);bin.copy(result,28+jsonSize);
  const destination=join(out,asset+'.glb');writeFileSync(destination,result,{flag:'wx'});
  const report={ok:true,asset,source:fileRecord(sourcePath),lowerInput:fileRecord(lowerPath),output:fileRecord(destination),patch:fileRecord(patchPath),positionChanges:changed.size,normalChanges:normalChanged.size,weightChanges:weightChanged.size,maxMove,maxRestError,maxRawWeightCorrection,maxWeightL1,triangles,protectedCount:protectedIds.size,binOutsideDeclaredComponentsExact:true,jsonOutsidePositionBoundsExact:true,limitations:['candidate only; root actual dense/visual validation pending','blend imported normals and GLB corrected arm normals are not identical']};
  writeFileSync(destination+'.report.json',JSON.stringify(report,null,2),{flag:'wx'});return report;
}
for(const[id]of ASSETS)for(const suffix of['.glb','.glb.report.json'])requireValid(!existsSync(join(out,id+suffix)),'출력이 이미 존재합니다: '+id+suffix);
requireValid(!existsSync(join(out,'pack-report.json')),'batch pack report가 이미 존재합니다.');
const reports=[];
try{for(const contract of ASSETS)reports.push(pack(contract));writeFileSync(join(out,'pack-report.json'),JSON.stringify({ok:true,assets:reports},null,2),{flag:'wx'});console.log(JSON.stringify({ok:true,assets:reports}));}
catch(error){writeFileSync(join(out,'pack-report.json'),JSON.stringify({ok:false,error:String(error.stack||error),completedAssets:reports},null,2),{flag:'wx'});throw error;}
