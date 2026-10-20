// 접촉 v3 독립 패커. 정확 contact05에서 의상 의미영역 형상과 승인된 국소 다리 paint만 검증한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const requireValid = (ok, message) => { if (!ok) throw new Error(message); };
requireValid(argv.length === 6 && argv[0] === '--repo' && argv[2] === '--contact-dir' && argv[4] === '--out-dir', '사용: node pack-contact-fit-v3.mjs --repo <repo> --contact-dir <정확 contact05> --out-dir <새 contact 디렉터리>');
const repo = resolve(argv[1]), contactDir = resolve(argv[3]), out = resolve(argv[5]);
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

const CONTACT_AUTHOR_SHA='55f1f5b2adf6690718141bb7ab3a7c96d2e584b8168759f7f92d61c9e1813a43';
const LOWER_AUTHOR_SHA='64505e29fd7040b2fe774720f63064359e9cca84445f7bc60744103784bfd003';
const CONTACT_SHA={"hero_ranger_t2": "539963fe3681d219e7ad9408d0aaf366dc2d32a83909fc5c03f465f15cfea915", "hero_ranger_t3": "3c63985a59460b7268c06e46b4887d743fe604f39e8895987af7a0ff2173c9bf", "hero_rogue_t2": "27b9d3f49467a99850a895d092e1379fec499f2641d70b41c55188444228962c", "hero_rogue_t3": "b06f84493ee72001d0263f072b9dd8d6860979a5bb7d89d498f12508bcada66e", "avatar_rogue_crow": "4634829667eb76feea482dc7012dfdb3fcbe65ab12d36220177a93fa99853d5f"};
const SEEDS={"hero_rogue_t2":{"rearcoat":[15937,15792,14622,16295,8351,13580],"scarf":[1961]},"hero_rogue_t3":{"rearcoat":[14666,14140,15724,443,6455],"scarf":[15274]}};
const PARAMS={"coatBoundaryWidth":{"hero_rogue_t2":0.2,"hero_rogue_t3":0.2},"scarfBoundaryWidth":0.1,"coatHem":0.17,"coatXScale":0.82,"coatPosteriorScale":0.78,"coatLateralFade":{"hero_rogue_t2":[0.1,0.24],"hero_rogue_t3":[0.12,0.26]},"coatFrontXZScale":0.5,"coatYCutoff":0.7,"coatTopStart":0.3,"coatPosteriorStart":0.1,"coatPosteriorWidth":0.3,"scarfXCutoff":0.5,"scarfXFull":0.65,"scarfYFull":{"hero_rogue_t2":0.65,"hero_rogue_t3":0.55},"scarfYCutoff":0.95,"scarfAnchors":{"hero_rogue_t2":[1961,7263],"hero_rogue_t3":[15274,8040]},"coatMaximumMove":0.25,"scarfMaximumMove":0.3,"maximumCoatXZMove":0.12,"softSaturation":{"linearEnd":0.1,"constantStart":0.14,"maximum":0.12},"localStroke":{"asset":"hero_rogue_t2","seed":9535,"peak":0.035,"radius":0.25,"boundaryWidth":0.1},"weightRepair":{"minimumOwnMass":0.5,"oppositeLimit":0.14,"formula":"transfer (opposite-.14)*semanticAlpha to existing own leg slots proportionally; Hips exact"}};
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
class Heap {
  values=[];
  push(row) { const a=this.values; a.push(row); let i=a.length-1; while(i>0){const p=(i-1)>>1;if(a[p][0]<=row[0])break;a[i]=a[p];i=p;}a[i]=row; }
  pop() { const a=this.values, result=a[0], last=a.pop(); if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length && a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return result; }
}
function boundaryDistances(data,permitted,width) {
  const count=data.points.length,edges=Array.from({length:count},()=>new Map());
  const edge=(a,b,d)=>{edges[a].set(b,Math.min(edges[a].get(b)??Infinity,d));edges[b].set(a,Math.min(edges[b].get(a)??Infinity,d));};
  for(const[a,b,c]of data.faces)for(const[i,j]of[[a,b],[b,c],[c,a]])edge(i,j,data.points[i].distanceTo(data.points[j]));
  const seams=new Map();for(let i=0;i<count;i++){const key=data.position.rows[i].map(v=>{const s=v*1e6,l=Math.floor(s),f=s-l;return(f===.5?l+(l%2?1:0):Math.round(s))/1e6;}).join(',');if(seams.has(key))edge(i,seams.get(key),0);else seams.set(key,i);}
  const distances=new Float64Array(count);distances.fill(Infinity);const heap=new Heap();for(let i=0;i<count;i++)if(!permitted.has(i)){distances[i]=0;heap.push([0,i]);}
  while(heap.values.length){const[d,i]=heap.pop();if(d!==distances[i]||d>=width)continue;for(const[j,length]of edges[i]){const next=d+length;if(next<distances[j]){distances[j]=next;heap.push([next,j]);}}}return distances;
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

function verifyContact(original,data){
  requireValid(sameExceptBounds(original.doc,data.doc,original.a.POSITION),'contact05 POSITION bounds 밖 JSON 변경');
  requireValid(original.bin.length===data.bin.length,'contact05 BIN 길이 변경');
  const allowed=new Uint8Array(original.bin.length);
  for(const view of[original.position,original.normal,original.weights])for(let i=0;i<view.a.count;i++)for(let k=0;k<view.width;k++)for(let b=0;b<4;b++)allowed[view.offset(i,k)+b]=1;
  for(let i=0;i<allowed.length;i++)requireValid(allowed[i]||original.bin[i]===data.bin[i],'contact05 원본 허용 성분 밖 BIN 변경');
  for(let i=0;i<data.points.length;i++)if(protectedAt(original,i))requireValid(near(original.position.rows[i],data.position.rows[i],0)&&near(original.normal.rows[i],data.normal.rows[i],0)&&near(original.weights.rows[i],data.weights.rows[i],0),'contact05 원본 보호 변경');
}
const FINGERS=['Thumb','Index','Middle','Ring','Pinky'];
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
  function deform(i){const before=data.points[i];if(protectedAt(data,i))return {point:before.clone(),mask:null};const side=before.x>=hips.x?'Left':'Right',sign=side==='Left'?1:-1,mass=armMass(data,i,side),r=records[side];const factors=[smooth((mass-.5)/.5),smooth((sign*(before.x-hips.x)-r.protectedFadeStart)/(r.protectedFadeEnd-r.protectedFadeStart)),smooth((before.y-hips.y-.10)/.08),1-smooth((Math.abs(before.z-r.handZ)-.12)/.08)],alpha=product(factors);if(alpha<=1e-10)return{point:before.clone(),mask:null};const fw={};for(const finger of FINGERS)fw[finger]=data.joints.rows[i].reduce((s,j,k)=>s+(armSuffix(data.names[j],side).startsWith('Hand'+finger)?data.weights.rows[i][k]:0),0);const sum=Object.values(fw).reduce((a,b)=>a+b,0);requireValid(sum<=1.000001,'손가락 가중치 합 초과');fw.Middle+=Math.max(0,1-sum);const mapped=new Vector3(),x=sign*(before.x-hips.x);for(const finger of FINGERS){const[cx,cy,cz]=r.curves[finger];mapped.addScaledVector(new Vector3(hips.x+sign*hermite(cx,x),before.y+hermite(r.curves.Middle[1],x),before.z+hermite(r.curves.Middle[2],x)),fw[finger]);}return {point:before.clone().lerp(mapped,alpha),mask:{vertex:i,side,alpha,factors,armMass:mass}};}
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
function coatEnvelope(original,asset,p){
  const centers={};for(const side of ['Left','Right']){const foot=bone(original,side+'Foot'),knee=bone(original,side+'Leg'),hip=bone(original,side+'UpLeg');requireValid(foot.y<knee.y&&knee.y<hip.y,'다리 축 Y 순서 오류');centers[side]=foot.x+(knee.x-foot.x)*smooth((p.y-foot.y)/(knee.y-foot.y))+(hip.x-knee.x)*smooth((p.y-knee.y)/(hip.y-knee.y));}
  const distance=Math.max(0,p.x-centers.Left,centers.Right-p.x),[inner,outer]=PARAMS.coatLateralFade[asset],lateral=smooth((distance-inner)/(outer-inner)),posterior=smooth((bone(original,'Hips').z-p.z-.10)/.30);
  return {lateralDistance:distance,lateral,posterior,outside:1-(1-lateral)*(1-posterior),xzScale:.5+.5*posterior};
}
function semanticMask(original,asset){
  const regions={rearcoat:[],scarf:[]},mask=new Map();if(!SEEDS[asset])return {regions,mask};
  const count=original.points.length,graph=Array.from({length:count},()=>new Set());
  const edge=(i,j)=>{graph[i].add(j);graph[j].add(i);};
  for(const[a,b,c]of original.faces)for(const[i,j]of[[a,b],[b,c],[c,a]])edge(i,j);
  const seams=new Map();for(let i=0;i<count;i++){const key=original.position.rows[i].map(v=>{const s=v*1e6,l=Math.floor(s),f=s-l;return(f===.5?l+(l%2?1:0):Math.round(s))/1e6;}).join(',');if(seams.has(key))edge(i,seams.get(key));else seams.set(key,i);}
  const lowerNames=new Set(['mixamorigHips','mixamorigLeftUpLeg','mixamorigRightUpLeg','mixamorigLeftLeg','mixamorigRightLeg']),scarfNames=new Set(['mixamorigHead','mixamorigNeck','mixamorigLeftShoulder','mixamorigLeftArm']);
  const allowed={rearcoat:new Set(),scarf:new Set()},hips=bone(original,'Hips');
  for(let i=0;i<count;i++){const p=original.points[i],names=original.joints.rows[i].flatMap((j,k)=>original.weights.rows[i][k]>1e-8?[original.names[j]]:[]);
    if(names.every(n=>lowerNames.has(n))&&p.y<.70)allowed.rearcoat.add(i);
    if(names.every(n=>scarfNames.has(n))&&names.some(n=>n==='mixamorigHead'||n==='mixamorigNeck')&&p.x>.50&&p.y<.95)allowed.scarf.add(i);
  }
  for(const region of['rearcoat','scarf']){
    const permitted=allowed[region],seeds=SEEDS[asset][region];requireValid(seeds.every(i=>permitted.has(i)),'semantic seed 허용 영역 밖: '+region);
    const connected=new Set(seeds),pending=seeds.slice();while(pending.length){const i=pending.pop();for(const j of graph[i])if(permitted.has(j)&&!connected.has(j)){connected.add(j);pending.push(j);}}
    regions[region]=[...connected].sort((a,b)=>a-b);const width=region==='rearcoat'?PARAMS.coatBoundaryWidth[asset]:.10,scarfY=PARAMS.scarfYFull[asset],distances=boundaryDistances(original,connected,width);
    for(const i of regions[region]){const p=original.points[i],boundary=smooth(distances[i]/width),envelope=region==='rearcoat'?coatEnvelope(original,asset,p):null,factors=region==='rearcoat'?[boundary,1-smooth((p.y-.30)/.40),envelope.outside]:[boundary,smooth((p.x-.50)/.15),1-smooth((p.y-scarfY)/(.95-scarfY))],alpha=product(factors);
      if(alpha>1e-10){requireValid(!mask.has(i),'semantic 영역 중복');mask.set(i,{vertex:i,region,alpha,factors,boundaryDistance:Number.isFinite(distances[i])?distances[i]:null,envelope});}}
  }return {regions,mask};
}
function softSaturate(value){const q=Math.abs(value);if(q<=.10)return value;if(q>=.14)return Math.sign(value)*.12;const u=(q-.10)/.04;return Math.sign(value)*(.10+.04*(u-.5*u*u));}
function coatWeights(data,original,mask){
  const records=new Map(),expected=data.weights.rows.map(r=>r.slice()),hips=bone(original,'Hips'),allowed=new Set(['mixamorigHips','mixamorigLeftUpLeg','mixamorigLeftLeg','mixamorigRightUpLeg','mixamorigRightLeg']);
  for(const[i,row]of mask){if(row.region!=='rearcoat')continue;const old=data.weights.rows[i],names=data.joints.rows[i].map(j=>data.names[j]),side=original.points[i].x>hips.x?'Left':'Right',other=side==='Left'?'Right':'Left',own=names.map(n=>['mixamorig'+side+'UpLeg','mixamorig'+side+'Leg'].includes(n)),opp=names.map(n=>['mixamorig'+other+'UpLeg','mixamorig'+other+'Leg'].includes(n));
    const ownMass=old.reduce((v,w,k)=>v+(own[k]?w:0),0),oppositeMass=old.reduce((v,w,k)=>v+(opp[k]?w:0),0),hipMass=old.reduce((v,w,k)=>v+(names[k]==='mixamorigHips'?w:0),0);
    if(ownMass<=.5||oppositeMass<=.14||hipMass<=1e-8)continue;
    requireValid(names.every((n,k)=>old[k]<=1e-8||allowed.has(n)),'coat weight 허용 본 밖');const removed=(oppositeMass-.14)*row.alpha,next=old.map((w,k)=>Math.fround(opp[k]?w-removed*w/oppositeMass:own[k]?w+removed*w/ownMass:w));
    requireValid(next.every(w=>w>=0&&w<=1.000001)&&Math.abs(next.reduce((v,w)=>v+w,0)-old.reduce((v,w)=>v+w,0))<=2e-7,'coat 가중치 합/범위');
    requireValid(names.every((n,k)=>n!=='mixamorigHips'||old[k]===next[k]),'Hips 가중치 변경');
    if(near(next,old,0))continue;expected[i]=next;records.set(i,{vertex:i,region:'rearcoat-own-leg',side,alpha:row.alpha,ownMass,oppositeMass,removed,old,new:next,jointNames:names});
  }return {records,expected};
}
function localStroke(original,asset,regions){
  const rows=new Map(),config=PARAMS.localStroke;if(asset!==config.asset)return rows;
  const allowed=new Set(regions.rearcoat),count=original.points.length,edges=Array.from({length:count},()=>new Map());requireValid(allowed.has(config.seed),'국소 stroke seed가 의상 영역 밖');
  const edge=(a,b,length)=>{edges[a].set(b,Math.min(edges[a].get(b)??Infinity,length));edges[b].set(a,Math.min(edges[b].get(a)??Infinity,length));};
  for(const[a,b,c]of original.faces)for(const[i,j]of[[a,b],[b,c],[c,a]])edge(i,j,original.points[i].distanceTo(original.points[j]));
  const seams=new Map();for(let i=0;i<count;i++){const key=original.position.rows[i].map(v=>{const s=v*1e6,l=Math.floor(s),f=s-l;return(f===.5?l+(l%2?1:0):Math.round(s))/1e6;}).join(',');if(seams.has(key))edge(i,seams.get(key),0);else seams.set(key,i);}
  const distance=new Float64Array(count);distance.fill(Infinity);distance[config.seed]=0;const heap=new Heap();heap.push([0,config.seed]);
  while(heap.values.length){const[length,i]=heap.pop();if(length!==distance[i]||length>=config.radius)continue;for(const[j,step]of edges[i]){if(!allowed.has(j))continue;const candidate=length+step;if(candidate<distance[j]){distance[j]=candidate;heap.push([candidate,j]);}}}
  const boundary=boundaryDistances(original,allowed,config.boundaryWidth);
  for(const i of regions.rearcoat){const factors=[smooth(1-distance[i]/config.radius),smooth(boundary[i]/config.boundaryWidth)],alpha=product(factors);if(alpha>1e-10)rows.set(i,{vertex:i,alpha,factors,geodesicDistance:distance[i],boundaryDistance:Number.isFinite(boundary[i])?boundary[i]:null,deltaY:config.peak*alpha});}
  requireValid(rows.has(config.seed)&&Math.abs(rows.get(config.seed).deltaY-config.peak)<1e-10,'stroke seed peak 불일치');return rows;
}
function pack(contract){
  const[asset,hero,sourceSha,count]=contract,sourcePath=join(repo,'asset-library/normalized',asset+'.glb'),contactPath=join(contactDir,asset+'.glb'),patchPath=join(out,asset+'.patch.json');
  const original=dataFor(sourcePath,sourceSha),data=dataFor(contactPath,CONTACT_SHA[asset]);verifyContact(original,data);
  requireValid(!data.doc.animations?.length&&data.position.a.count===count,'contact05 mesh-only/count 오류');
  const[refId,refSha]=REFERENCES[hero],reference=dataFor(join(repo,'asset-library/normalized',refId+'.glb'),refSha);
  const patch=JSON.parse(readFileSync(patchPath));
  requireValid(patch.schema==='blade-surge.higher-contact-patch.v3'&&patch.ok===true&&patch.asset===asset,'패치 identity 오류');
  requireValid(patch.source?.sha256===sourceSha&&patch.contactInput?.sha256===CONTACT_SHA[asset]&&patch.reference?.sha256===refSha,'패치 원본 SHA 오류');
  for(const[field,file,expected]of[['contactAuthorSha256','art-src/higher-bodies/author_contact_fit_v2.py',CONTACT_AUTHOR_SHA],['lowerAuthorSha256','art-src/higher-bodies/author_lower_fit_v1.py',LOWER_AUTHOR_SHA],['helperSha256','art-src/avatar-fox/author_body_contact_v3.py',HELPER_SHA]])requireValid(patch[field]===expected&&sha(readFileSync(join(repo,file)))===expected,'원본 helper SHA 변경: '+field);
  requireValid(patch.author?.sha256===sha(readFileSync(join(repo,'art-src/higher-bodies/author_contact_fit_v3.py'))),'actual v3 author SHA 불일치');
  requireValid(patch.blend?.sha256===sha(readFileSync(join(out,asset+'.blend'))),'actual blend SHA 불일치');
  for(const value of[patch.restValidation,patch.blendValidation])for(const key of['sourceToBlender','blenderToSource'])requireValid(value?.tolerance===.0001&&Number.isFinite(value?.[key]?.maximum)&&value[key].maximum>=0&&value[key].maximum<=.0001,'실제 Bpy REST 검증 누락');
  requireValid(patch.primitive?.node===data.node.index&&patch.primitive.mesh===data.node.mesh&&patch.primitive.primitive===0&&patch.primitive.vertexCount===count,'primitive 식별 오류');
  const armProfile=SEEDS[asset]?armsProfile(data,reference):null,armMask=new Map(),armPoints=new Map(),armNormals=new Set(),armHips=bone(data,'Hips');
  if(armProfile)for(let i=0;i<count;i++){const result=armProfile.deform(i);if(result.mask){armMask.set(i,{...result.mask,region:'arm'});armPoints.set(i,result.point);}if(!protectedAt(data,i)&&data.points[i].y>armHips.y+.10&&Math.max(armMass(data,i,'Left'),armMass(data,i,'Right'))>.5)armNormals.add(i);}
  const{regions,mask}=semanticMask(original,asset),exception=new Set(regions.scarf),eligible=new Set([...regions.rearcoat,...regions.scarf,...armNormals]),protectedIds=new Set(original.points.flatMap((_,i)=>protectedAt(original,i)&&!exception.has(i)?[i]:[]));
  const strokeMask=localStroke(original,asset,regions);
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),profile=patch.profile;
  requireValid([...armMask.keys()].every(i=>!mask.has(i)),'팔/의상 영역 중복');
  requireValid(profile?.armProfile?.enabled===Boolean(SEEDS[asset])&&profile.armProfile.coordinates==='decodedGLTF-Float64-rest-and-bone-landmarks'&&profile.armProfile.transverse==='shared-Middle-YZ'&&profile.armProfile.maximumMove===.20&&equal(profile.armProfile.normalEligibleVertices,[...armNormals]),'팔 명시 계약/법선 허용 오류');
  requireValid(Array.isArray(profile.armProfile.mask)&&profile.armProfile.mask.length===armMask.size,'팔 mask 전수 누락');const armSeen=new Set();
  for(const r of profile.armProfile.mask){const e=armMask.get(r.vertex);requireValid(e&&!armSeen.has(r.vertex)&&r.region==='arm'&&r.side===e.side&&Math.abs(r.alpha-e.alpha)<=2e-7&&Math.abs(r.armMass-e.armMass)<=2e-7&&near(r.factors,e.factors,2e-7),'팔 mask 수식 불일치');armSeen.add(r.vertex);}
  if(armProfile)verifyCurves(profile.armProfile.records,armProfile.records);else requireValid(equal(profile.armProfile.records,{}),'비도적 팔 profile 금지');
  requireValid(equal(profile?.parameters,PARAMS)&&equal(profile.seeds,SEEDS[asset]||{})&&equal(profile.regions,regions),'고정 artist profile/semantic 영역 변경');
  const anchorPairs={hero_rogue_t2:[[15937,8065],[15792,7944],[14622,7944],[16295,8642],[1961,7263]],hero_rogue_t3:[[14666,8065],[14140,7945],[15724,8846],[15274,8040]]}[asset]||[];
  requireValid(Array.isArray(profile.referenceEvidence)&&profile.referenceEvidence.length===anchorPairs.length,'의상 참조 근거 누락');
  for(let k=0;k<anchorPairs.length;k++){const[a,b]=anchorPairs[k],r=profile.referenceEvidence[k];requireValid(r.sourceVertex===a&&r.referenceVertex===b&&near(r.sourceWorld,original.points[a].toArray(),1e-8)&&near(r.referenceWorld,reference.points[b].toArray(),1e-8)&&Math.abs(r.distance-original.points[a].distanceTo(reference.points[b]))<=1e-8,'의상 원본/t1 참조 anchor 불일치');}
  requireValid(profile.coordinates==='original decodedGLTF Float64 weightedREST masks; contact05 weightedREST fixed field','mask 좌표 계약 변경');
  requireValid(equal(patch.protectedVertices,[...protectedIds])&&equal(patch.scarfExceptionVertices,[...exception])&&equal(patch.normalEligibleVertices,[...eligible].sort((a,b)=>a-b)),'보호/예외/법선 허용집합 변경');
  requireValid(Array.isArray(profile.mask)&&profile.mask.length===mask.size,'mask 크기 불일치');const maskSeen=new Set();
  for(const r of profile.mask){const e=mask.get(r.vertex);requireValid(e&&!maskSeen.has(r.vertex)&&r.region===e.region&&Number.isFinite(r.alpha)&&Math.abs(r.alpha-e.alpha)<=2e-7&&near(r.factors,e.factors,2e-7),'semantic mask 수식 불일치');maskSeen.add(r.vertex);requireValid(e.envelope===null?r.envelope===null:r.envelope&&Object.keys(e.envelope).every(k=>Number.isFinite(r.envelope[k])&&Math.abs(r.envelope[k]-e.envelope[k])<=2e-7),'coat envelope 수식 불일치');requireValid(r.boundaryDistance===null?e.boundaryDistance===null:Number.isFinite(r.boundaryDistance)&&e.boundaryDistance!==null&&Math.abs(r.boundaryDistance-e.boundaryDistance)<=1e-8,'semantic geodesic 불일치');}
  requireValid(Array.isArray(profile.localStrokeMask)&&profile.localStrokeMask.length===strokeMask.size,'stroke 전수 누락');const strokeSeen=new Set();
  for(const r of profile.localStrokeMask){const e=strokeMask.get(r.vertex);requireValid(e&&!strokeSeen.has(r.vertex)&&Number.isFinite(r.alpha)&&Math.abs(r.alpha-e.alpha)<=2e-7&&Number.isFinite(r.deltaY)&&Math.abs(r.deltaY-e.deltaY)<=1e-8&&near(r.factors,e.factors,2e-7)&&Number.isFinite(r.geodesicDistance)&&Math.abs(r.geodesicDistance-e.geodesicDistance)<=1e-8,'stroke 정점/고정 수식 불일치');strokeSeen.add(r.vertex);requireValid(r.boundaryDistance===null?e.boundaryDistance===null:Number.isFinite(r.boundaryDistance)&&e.boundaryDistance!==null&&Math.abs(r.boundaryDistance-e.boundaryDistance)<=1e-8,'stroke 경계 거리 불일치');}
  let scarfDelta=null;if(SEEDS[asset]){const[sid,rid]=PARAMS.scarfAnchors[asset];scarfDelta=reference.points[rid].clone().sub(data.points[sid]).toArray();}
  requireValid(scarfDelta===null?profile.scarfDelta===null:near(profile.scarfDelta,scarfDelta,1e-8),'canonical 의상 seed 고정 이동 불일치');
  const weightRepair=coatWeights(data,original,mask);
  requireValid(Array.isArray(patch.changes.weights)&&patch.changes.weights.length===weightRepair.records.size,'가중치 repair 전수 누락');
  for(const r of patch.changes.weights){const e=weightRepair.records.get(r.vertex);requireValid(e&&r.region===e.region&&r.side===e.side&&equal(r.jointNames,e.jointNames),'가중치 허용 의미영역 오류');for(const k of['alpha','ownMass','oppositeMass','removed'])requireValid(Number.isFinite(r[k])&&Math.abs(r[k]-e[k])<=2e-7,'가중치 수식 보고 불일치');}

  const bin=Buffer.from(data.bin),allowed=new Uint8Array(bin.length),changed=new Set(),normalChanged=new Set(),weightChanged=new Set();
  function apply(rows,view,seen,permitted,field){requireValid(Array.isArray(rows),'변경 배열 없음: '+field);for(const row of rows){const i=row.vertex;requireValid(Number.isInteger(i)&&permitted.has(i)&&!seen.has(i)&&!protectedIds.has(i),'정점 범위/중복/보호 오류 '+field+' '+i);requireValid(finiteWidth(row.old,view.width)&&finiteWidth(row.new,view.width)&&near(row.old,view.rows[i],0),'원본 성분 불일치 '+field+' '+i);seen.add(i);for(let k=0;k<view.width;k++){const at=view.offset(i,k);bin.writeFloatLE(row.new[k],at);for(let b=0;b<4;b++)allowed[at+b]=1;}}}
  apply(patch.changes.positions,data.position,changed,new Set([...mask.keys(),...armMask.keys(),...strokeMask.keys()]),'POSITION');apply(patch.changes.normals,data.normal,normalChanged,eligible,'NORMAL');apply(patch.changes.weights,data.weights,weightChanged,new Set(weightRepair.records.keys()),'WEIGHTS');
  const positions=data.position.rows.map((_,i)=>data.position.read(bin,i)),hips=bone(original,'Hips');let maxMove=0,maxRestError=0;
  for(let i=0;i<count;i++){
    const row=mask.get(i),before=data.points[i],delta=row?(row.region==='rearcoat'?new Vector3(softSaturate((before.x-hips.x)*(.82-1)),.17,softSaturate((before.z-hips.z)*(.78-1))):vec(scarfDelta)).multiplyScalar(row.alpha):new Vector3();
    if(row?.region==='rearcoat'){delta.x*=row.envelope.xzScale;delta.z*=row.envelope.xzScale;}
    const isArm=armPoints.has(i);if(isArm)delta.copy(armPoints.get(i)).sub(before);if(strokeMask.has(i))delta.y+=strokeMask.get(i).deltaY;
    requireValid(delta.length()<=(isArm?.20:row?.region==='scarf'?.30:.25),'승인된 의상 최대 목표 이동 초과');if(row?.region==='rearcoat')requireValid(Math.max(Math.abs(delta.x),Math.abs(delta.z))<=.12,'뒤자락 XZ 목표 이동 .12m 초과');
    const after=skinned(positions[i],weighted(data.joints.rows[i],data.weights.read(bin,i),data.matrices)),wanted=before.clone().add(delta),error=after.distanceTo(wanted),move=after.distanceTo(before);
    requireValid(error<=3e-6&&move<=(isArm?.20:row?.region==='scarf'?.30:.25),'정적 의상 수식/REST/이동 불일치: '+i);maxMove=Math.max(maxMove,move);maxRestError=Math.max(maxRestError,error);
    if(!row&&!isArm&&!strokeMask.has(i))requireValid(near(positions[i],data.position.rows[i],0),'허용 밖 POSITION 변경');
    if(!eligible.has(i))requireValid(near(data.normal.read(bin,i),data.normal.rows[i],0),'허용 밖 NORMAL 변경');
    requireValid(near(data.weights.read(bin,i),weightRepair.expected[i],0)&&near(data.joints.read(bin,i),data.joints.rows[i],0),'v3 WEIGHTS 수식/JOINTS 불일치');
  }
  const triangles=checkNormals(data,positions,bin,changed,normalChanged,eligible);
  for(let i=0;i<bin.length;i++)requireValid(allowed[i]||bin[i]===data.bin[i],'허용 성분 밖 BIN 변경');
  const doc=structuredClone(data.doc),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};positions.forEach(p=>p.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);}));doc.accessors[data.a.POSITION].min=bounds.min;doc.accessors[data.a.POSITION].max=bounds.max;
  requireValid(sameExceptBounds(data.doc,doc,data.a.POSITION),'POSITION bounds 밖 JSON 변경');
  const json=Buffer.from(JSON.stringify(doc)),jsonSize=(json.length+3)&~3,binSize=(bin.length+3)&~3;let result=Buffer.alloc(12+8+jsonSize+8+binSize);result.write('glTF');result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(jsonSize,12);result.writeUInt32LE(0x4e4f534a,16);result.fill(32,20,20+jsonSize);json.copy(result,20);result.writeUInt32LE(binSize,20+jsonSize);result.writeUInt32LE(0x004e4942,24+jsonSize);bin.copy(result,28+jsonSize);
  // 도적 이외 세 몸체는 JSON 재직렬화도 하지 않고 정확05 바이트를 전달한다.
  if(!SEEDS[asset]){requireValid(changed.size===0&&normalChanged.size===0&&weightChanged.size===0&&mask.size===0,'비도적 변경 금지');result=data.raw;}
  const destination=join(out,asset+'.glb');writeFileSync(destination,result,{flag:'wx'});
  const report={ok:true,asset,source:fileRecord(sourcePath),contactInput:fileRecord(contactPath),output:fileRecord(destination),patch:fileRecord(patchPath),positionChanges:changed.size,normalChanges:normalChanged.size,weightChanges:weightChanged.size,maxMove,maxRestError,triangles,scarfExceptionCount:exception.size,protectedCount:protectedIds.size,binOutsideDeclaredPositionNormalWeightsExact:true,jointsExact:true,weightsOutsideCoatRepairExact:true,hipsFootScarfWeightsExact:true,jsonOutsidePositionBoundsExact:true,passThroughExact:!SEEDS[asset],limitations:['candidate only; actual dense/visual pending','blend imported corner normals differ from GLB corrected seam normals']};
  writeFileSync(destination+'.report.json',JSON.stringify(report,null,2),{flag:'wx'});return report;
}
requireValid(Object.keys(CONTACT_SHA).length===5,'실제05 SHA 계약 미확정');
for(const[id]of ASSETS)for(const suffix of['.glb','.glb.report.json'])requireValid(!existsSync(join(out,id+suffix)),'출력이 이미 존재합니다: '+id+suffix);
requireValid(!existsSync(join(out,'pack-report.json')),'batch pack report가 이미 존재합니다.');
const reports=[];
try{for(const contract of ASSETS)reports.push(pack(contract));writeFileSync(join(out,'pack-report.json'),JSON.stringify({ok:true,assets:reports},null,2),{flag:'wx'});console.log(JSON.stringify({ok:true,assets:reports}));}
catch(error){writeFileSync(join(out,'pack-report.json'),JSON.stringify({ok:false,error:String(error.stack||error),completedAssets:reports},null,2),{flag:'wx'});throw error;}
