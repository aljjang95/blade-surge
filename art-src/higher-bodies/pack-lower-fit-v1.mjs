// 하체 전용 첫 후보의 독립 검증/패커. 원본 rig·가중치·토폴로지·재질 바이트를 보존한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const requireValid = (ok, message) => { if (!ok) throw new Error(message); };
requireValid(argv.length === 4 && argv[0] === '--repo' && argv[2] === '--out-dir', '사용: node pack-lower-fit-v1.mjs --repo <repo> --out-dir <새 저작 디렉터리>');
const repo = resolve(argv[1]), out = resolve(argv[3]);
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

function pack(contract) {
  const [asset, hero, sourceSha, vertexCount, expectedSole] = contract;
  const sourcePath = join(repo, 'asset-library/normalized', asset+'.glb');
  const patchPath = join(out, asset+'.patch.json'), destination = join(out, asset+'.glb');
  const raw = readFileSync(sourcePath), patch = JSON.parse(readFileSync(patchPath));
  requireValid(sha(raw) === sourceSha && patch.source?.sha256 === sourceSha && patch.source.bytes === raw.length, '원본 identity 불일치');
  requireValid(patch.schema === 'blade-surge.higher-lower-patch.v1' && patch.asset === asset && patch.ok && patch.stage === 'lower-only', '하체 전용 계약 불일치');
  const [refId, refSha] = REFERENCES[hero];
  requireValid(sha(readFileSync(join(repo, 'asset-library/normalized', refId+'.glb'))) === refSha && patch.reference?.sha256 === refSha, 'reference SHA 불일치');
  requireValid(patch.helperSha256 === HELPER_SHA && sha(readFileSync(join(repo, 'art-src/avatar-fox/author_body_contact_v3.py'))) === HELPER_SHA, '원본 helper 불일치');
  requireValid(patch.author?.sha256 === sha(readFileSync(join(repo, 'art-src/higher-bodies/author_lower_fit_v1.py'))), '실제 author source 불일치');
  requireValid(patch.blend?.sha256 === sha(readFileSync(join(out, asset+'.blend'))), '실제 blend SHA 불일치');
  for (const validation of [patch.restValidation, patch.blendValidation]) for (const direction of ['sourceToBlender', 'blenderToSource']) {
    const max = validation?.[direction]?.maximum;
    requireValid(Number.isFinite(max) && max >= 0 && max <= .0001 && validation.tolerance === .0001, '실제 Blender REST 검증 누락');
  }
  const { doc, bin: beforeBin } = parse(raw), originalDoc = structuredClone(doc), bin = Buffer.from(beforeBin);
  requireValid(!doc.animations?.length, '원래 mesh-only가 아닙니다.');
  const nodes = doc.nodes.map((n, i) => ({ ...n, index: i })).filter(n => n.mesh !== undefined);
  requireValid(nodes.length === 1 && nodes[0].skin !== undefined, '단일 스킨 메시가 필요합니다.');
  const node = nodes[0], primitives = doc.meshes[node.mesh].primitives;
  requireValid(primitives.length === 1 && (primitives[0].mode ?? 4) === 4 && !primitives[0].targets && !primitives[0].extensions, 'primitive 구조 불일치');
  const p = primitives[0], a = p.attributes;
  requireValid(!['JOINTS_1', 'WEIGHTS_1', 'TANGENT'].some(k => k in a), '추가 영향/탄젠트는 허용하지 않습니다.');
  requireValid(patch.primitive?.node === node.index && patch.primitive.mesh === node.mesh && patch.primitive.primitive === 0
    && patch.primitive.vertexCount === vertexCount && patch.primitive.positionAccessor === a.POSITION && patch.primitive.normalAccessor === a.NORMAL, '원본 accessor 식별 불일치');
  const position = access(doc, beforeBin, a.POSITION), normal = access(doc, beforeBin, a.NORMAL), joints = access(doc, beforeBin, a.JOINTS_0), weights = access(doc, beforeBin, a.WEIGHTS_0);
  requireValid(position.a.componentType === 5126 && normal.a.componentType === 5126 && !position.a.normalized && !normal.a.normalized, '위치/법선 float32 계약');
  requireValid([position, normal, joints, weights].every(v => v.a.count === vertexCount) && position.width === 3 && normal.width === 3 && joints.width === 4 && weights.width === 4, '속성 count/width 불일치');
  requireValid(weights.rows.every(w => w.every(Number.isFinite) && Math.abs(w.reduce((x, y) => x+y, 0)-1) < .001), '원본 가중치 오류');
  const skin = doc.skins[node.skin], names = skin.joints.map(i => canonical(doc.nodes[i].name)), world = worldNodes(doc);
  requireValid(names.length === 65, '본 수 불일치');
  const ibms = access(doc, beforeBin, skin.inverseBindMatrices).rows;
  const matrices = skin.joints.map((i, k) => world[i].clone().multiply(new Matrix4().fromArray(ibms[k])));
  const vertexMatrices = joints.rows.map((js, i) => {
    const m = new Matrix4(); m.elements.fill(0);
    js.forEach((j, k) => { requireValid(matrices[j], '본 인덱스 범위 초과'); for (let c = 0; c < 16; c++) m.elements[c] += matrices[j].elements[c]*weights.rows[i][k]; });
    return m;
  });
  const oldRest = position.rows.map((v, i) => skinned(v, vertexMatrices[i]));
  const hipsY = new Vector3().setFromMatrixPosition(world[skin.joints[names.indexOf('mixamorigHips')]]).y;
  const ankleY = Math.max(...['Left', 'Right'].map(side => new Vector3().setFromMatrixPosition(world[skin.joints[names.indexOf('mixamorig'+side+'Foot')]]).y));
  const protectedIds = new Set(joints.rows.flatMap((js, i) => js.some((j, k) => weights.rows[i][k] > 1e-8 && /Head|Neck|Spine/.test(names[j])) ? [i] : []));
  requireValid(protectedIds.size > 0, '보호 정점 집합 없음');
  const protectedMinY = Math.min(...[...protectedIds].map(i => oldRest[i].y));
  const fitStopY = Math.min(hipsY, protectedMinY);
  const eligible = new Set(oldRest.flatMap((v, i) => !protectedIds.has(i) && v.y < fitStopY ? [i] : []));
  const normalEligible = new Set(oldRest.flatMap((v, i) => !protectedIds.has(i) && v.y < hipsY ? [i] : []));
  const footIds = [...eligible].filter(i => oldRest[i].y < ankleY+.02 && joints.rows[i].reduce((sum, j, k) => sum+(/^mixamorig(Left|Right)(Foot|ToeBase|ToeEnd|ToeBaseEnd)$/.test(names[j]) ? weights.rows[i][k] : 0), 0) >= .30);
  requireValid(footIds.length, '발바닥 범위 없음');
  const sole = Math.min(...footIds.map(i => oldRest[i].y));
  requireValid(Math.abs(sole-expectedSole) < .001 && Math.abs(hipsY-(hero === 'ranger' ? .840235 : .798047)) < .0001, 'asset 원본 landmarks 오류');
  const minimumYDerivative = Math.min(1, 1-1.5*(.012-sole)/(fitStopY-sole));
  requireValid(fitStopY > sole && minimumYDerivative > .05, '보호 cutoff 공간 곡선 단조성 실패');
  requireValid(patch.fit?.profile === 'protected-cutoff-c1-v3' && Math.abs(patch.fit.fitStopY-fitStopY) <= 3e-6
    && Math.abs(patch.fit.protectedMinY-protectedMinY) <= 3e-6 && Math.abs(patch.fit.minimumYDerivative-minimumYDerivative) <= 3e-6, '보호 cutoff 기준 불일치');
  requireValid(patch.fit?.targetSole === .012 && patch.fit.maxDisplacementMeters === .20 && Math.abs(patch.fit.sourceSole-sole) <= 3e-6 && Math.abs(patch.fit.hipsY-hipsY) <= 3e-6, '피팅 기준 변경');
  requireValid(JSON.stringify(patch.fit.protectedVertices) === JSON.stringify([...protectedIds]), '보호 mask 불일치');
  requireValid(patch.fit.normalEligibility === '!protected && restY<hipsY; only changed face/seam area-normal rotation'
    && JSON.stringify(patch.fit.normalEligibleVertices) === JSON.stringify([...normalEligible]), '법선 허용 집합 불일치');
  requireValid(Array.isArray(patch.changes?.weights) && patch.changes.weights.length === 0, '가중치 편집 금지');
  const allowed = new Set(), changed = new Set(), normalChanged = new Set();
  function applyRows(rows, view, ids, field, permitted) {
    requireValid(Array.isArray(rows), '변경 배열 누락');
    for (const row of rows) {
      const i = row.vertex;
      requireValid(Number.isInteger(i) && i >= 0 && i < vertexCount && !ids.has(i) && permitted.has(i) && !protectedIds.has(i), '정점 범위/중복/보호 오류: '+field+' vertex='+i);
      requireValid(finiteRow(row.old) && finiteRow(row.new) && near(row.old, view.rows[i], 0), '원본 성분 불일치');
      ids.add(i);
      for (let k = 0; k < 3; k++) { const at = view.offset(i, k); bin.writeFloatLE(row.new[k], at); for (let b = 0; b < 4; b++) allowed.add(at+b); }
    }
  }
  applyRows(patch.changes.positions, position, changed, 'POSITION', eligible);
  applyRows(patch.changes.normals, normal, normalChanged, 'NORMAL', normalEligible);
  requireValid(changed.size > 0, '위치 변경 없음');
  const finalPositions = position.rows.map((_, i) => position.read(bin, i));
  let maxMove = 0;
  for (let i = 0; i < vertexCount; i++) {
    const wanted = oldRest[i].clone();
    if (eligible.has(i)) { const u = Math.max(0, Math.min(1, (wanted.y-sole)/(fitStopY-sole))); wanted.y += (.012-sole)*(1-u*u*(3-2*u)); }
    const actual = skinned(finalPositions[i], vertexMatrices[i]), move = actual.distanceTo(oldRest[i]);
    requireValid(actual.distanceTo(wanted) <= 3e-6, '하체 C1 수식/빠진 정점 불일치: '+i);
    requireValid(move <= .20, '정점 변위 .20m 초과'); maxMove = Math.max(maxMove, move);
    if (!eligible.has(i)) requireValid(near(finalPositions[i], position.rows[i], 0), '위치 허용 집합 밖 변경');
    if (!normalEligible.has(i)) requireValid(near(normal.read(bin, i), normal.rows[i], 0), '보호/상체 법선 변경');
  }
  // 패치의 triangle 요약을 신뢰하지 않고 실제 float32 출력으로 다시 계산한다.
  const indices = access(doc, beforeBin, p.indices).rows.flat();
  requireValid(indices.length % 3 === 0, '삼각형 인덱스 오류');
  const keys = position.rows.map((p, i) => [...p, ...normal.rows[i]].map(roundSeven).join(','));
  const groups = new Map(), touched = new Set(); let minRatio = Infinity, minDot = 1, changedFaces = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const face = indices.slice(t, t+3); requireValid(face.every(i => i >= 0 && i < vertexCount), '인덱스 범위 오류');
    const [a, b, c] = face.map(i => vec(position.rows[i])), [aa, bb, cc] = face.map(i => vec(finalPositions[i]));
    const old = b.sub(a).cross(c.sub(a)), next = bb.sub(aa).cross(cc.sub(aa));
    if (face.some(i => changed.has(i))) {
      changedFaces++; face.forEach(i => touched.add(keys[i]));
      if (old.length() > 1e-10) {
        const ratio = next.length()/old.length(), dot = old.clone().normalize().dot(next.clone().normalize());
        requireValid(ratio > .03 && ratio < 25 && dot > 0, '실제 출력 삼각형 붕괴/뒤집힘: '+t/3);
        minRatio = Math.min(minRatio, ratio); minDot = Math.min(minDot, dot);
      }
    }
    for (const i of face) { if (!groups.has(keys[i])) groups.set(keys[i], { old: new Vector3(), next: new Vector3() }); const g = groups.get(keys[i]); g.old.add(old); g.next.add(next); }
  }
  for (let i = 0; i < vertexCount; i++) {
    const actual = vec(normal.read(bin, i)), old = vec(normal.rows[i]), g = groups.get(keys[i]);
    if (!touched.has(keys[i]) || !normalEligible.has(i) || !g || Math.min(g.old.length(), g.next.length()) <= 1e-10) {
      requireValid(!normalChanged.has(i), '영향 없는 법선 변경'); continue;
    }
    const rotation = new Quaternion().setFromUnitVectors(g.old.clone().normalize(), g.next.clone().normalize());
    const expected = old.clone().applyQuaternion(rotation).normalize();
    requireValid(actual.distanceTo(expected) <= 2e-5, 'seam 법선 회전 불일치: '+i);
    requireValid(Math.abs(actual.length()-1) <= 2e-5, '법선 길이 오류');
  }
  for (let i = 0; i < bin.length; i++) requireValid(allowed.has(i) || bin[i] === beforeBin[i], '허용 성분 밖 BIN 변경: '+i);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  finalPositions.forEach(p => p.forEach((v, k) => { bounds.min[k] = Math.min(bounds.min[k], v); bounds.max[k] = Math.max(bounds.max[k], v); }));
  doc.accessors[a.POSITION].min = bounds.min; doc.accessors[a.POSITION].max = bounds.max;
  const comparable = structuredClone(doc); comparable.accessors[a.POSITION] = originalDoc.accessors[a.POSITION];
  requireValid(JSON.stringify(comparable) === JSON.stringify(originalDoc), 'POSITION bounds 밖 JSON 변경');
  const json = Buffer.from(JSON.stringify(doc)), jsonSize = (json.length+3)&~3, binSize = (bin.length+3)&~3;
  const result = Buffer.alloc(12+8+jsonSize+8+binSize); result.write('glTF'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16); result.fill(32, 20, 20+jsonSize); json.copy(result, 20);
  result.writeUInt32LE(binSize, 20+jsonSize); result.writeUInt32LE(0x004e4942, 24+jsonSize); bin.copy(result, 28+jsonSize);
  writeFileSync(destination, result, { flag: 'wx' });
  const report = { ok: true, asset, source: fileRecord(sourcePath), patch: fileRecord(patchPath), output: fileRecord(destination),
    positionChanges: changed.size, normalChanges: normalChanged.size, weightChanges: 0, maxWorldMove: maxMove,
    triangles: { changedFaces, minimumAreaRatio: minRatio, minimumNormalDot: minDot }, protectedCount: protectedIds.size,
    normalEligibility: '!protected && restY<hipsY; only changed face/seam area-normal rotation', normalEligibleCount: normalEligible.size,
    fitStopY, protectedMinY, minimumYDerivative, profile: 'protected-cutoff-c1-v3',
    untouchedBinExact: true, jsonOutsidePositionBoundsExact: true, restFormulaMaximumTolerance: 3e-6,
    limitation: '새 GLB의 실제 301+모든키 direct/swap·GPU/시각 검증은 root가 별도로 실행한다.' };
  writeFileSync(destination+'.report.json', JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}

// 다섯 결과 중 하나라도 이미 있으면 앞선 자산도 새로 쓰지 않는다.
for (const [id] of ASSETS) for (const suffix of ['.glb', '.glb.report.json']) requireValid(!existsSync(join(out, id+suffix)), '출력이 이미 존재합니다: '+id+suffix);
requireValid(!existsSync(join(out, 'pack-report.json')), 'batch pack report가 이미 존재합니다.');
const reports = [];
try {
  for (const contract of ASSETS) reports.push(pack(contract));
  writeFileSync(join(out, 'pack-report.json'), JSON.stringify({ ok: true, assets: reports }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, assets: reports.map(r => ({ asset: r.asset, output: r.output, maxWorldMove: r.maxWorldMove })) }));
} catch (error) {
  writeFileSync(join(out, 'pack-report.json'), JSON.stringify({ ok: false, error: String(error.stack || error), completedAssets: reports }, null, 2), { flag: 'wx' });
  throw error;
}
