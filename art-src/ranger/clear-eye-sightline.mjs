// 궁수 전투 시점(카메라 고도 35~60°)에서 앞머리·후드 끝이 눈을 가리는 정점만 위로 들어 올린다.
// 메시 위치(POSITION)만 바꾸고 스킨·UV·텍스처·클립 바이트는 그대로 둔다.
// node art-src/ranger/clear-eye-sightline.mjs <in.glb> <out.glb> [--report]
import fs from 'node:fs';
import sharp from 'sharp';
const [inFile, outFile] = process.argv.slice(2);
const buf = Buffer.from(fs.readFileSync(inFile));
const jl = buf.readUInt32LE(12); const json = JSON.parse(buf.slice(20, 20 + jl).toString()); const bin = 20 + jl + 8;
const view = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; return { a, off: bin + (bv.byteOffset || 0) + (a.byteOffset || 0), stride: bv.byteStride || 0 }; };
const prim = json.meshes[0].primitives[0];
const pv = view(prim.attributes.POSITION); if (pv.stride && pv.stride !== 12) throw new Error('interleaved positions');
const N = pv.a.count;
const P = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) P[i] = buf.readFloatLE(pv.off + i * 4);
const P0 = Float32Array.from(P);
const uvv = view(prim.attributes.TEXCOORD_0); const U = new Float32Array(N * 2); for (let i = 0; i < N * 2; i++) U[i] = buf.readFloatLE(uvv.off + i * 4);
const iv = view(prim.indices); const T = iv.a.count / 3; const I = new Uint32Array(iv.a.count);
for (let i = 0; i < iv.a.count; i++) I[i] = iv.a.componentType === 5125 ? buf.readUInt32LE(iv.off + i * 4) : buf.readUInt16LE(iv.off + i * 2);
// 기본색 텍스처로 머리카락(초록)과 피부·눈을 나눈다.
const tex = json.textures[json.materials[0].pbrMetallicRoughness.baseColorTexture.index];
const img = json.images[tex.extensions?.EXT_texture_webp?.source ?? tex.source], ibv = json.bufferViews[img.bufferView];
const { data: px, info } = await sharp(buf.subarray(bin + (ibv.byteOffset || 0), bin + (ibv.byteOffset || 0) + ibv.byteLength)).raw().toBuffer({ resolveWithObject: true });
const color = k => { const x = Math.min(info.width - 1, Math.max(0, Math.floor(U[k * 2] * info.width))), y = Math.min(info.height - 1, Math.max(0, Math.floor(U[k * 2 + 1] * info.height))); const o = (y * info.width + x) * info.channels; return [px[o], px[o + 1], px[o + 2]]; };
const isHair = k => { const [r, g, b] = color(k); return g > r + 12 && g > b + 8; };
// 같은 위치의 이음매 정점은 함께 움직인다.
const key = k => [0, 1, 2].map(c => Math.round(P0[k * 3 + c] * 1e5)).join(',');
const groups = new Map(); for (let k = 0; k < N; k++) { const kk = key(k); if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(k); }
const groupOf = new Int32Array(N); const groupList = [...groups.values()]; groupList.forEach((g, gi) => g.forEach(k => { groupOf[k] = gi; }));
const hairGroup = groupList.map(g => g.some(isHair));
// 눈: 텍스처 눈 위치를 표면으로 옮긴 값(mirror-eye-texture --probe 실측). 각 눈 주변 5점을 본다.
const EYES = [[-0.0883, 1.4164, 0.2512], [0.0991, 1.4036, 0.2479]];
const samples = []; for (const [x, y, z] of EYES) for (const [dx, dy] of [[0, 0], [-.012, 0], [.012, 0], [0, .008], [0, -.006]]) samples.push([x + dx, y + dy, z + .004]);
const dirs = []; for (const el of [35, 42, 50, 58]) for (const az of [-40, -20, 0, 20, 40]) { const e = el * Math.PI / 180, a = az * Math.PI / 180; dirs.push([Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]); }
function hit(o, d, a, b, c) { const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]; const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) return -1; const inv = 1 / det; const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]; const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv; if (u < 0 || u > 1) return -1; const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]; const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 0 || u + v > 1) return -1; return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv; }
const vtx = k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
const gpos0 = k => [P0[k * 3], P0[k * 3 + 1], P0[k * 3 + 2]].map(x => +x.toFixed(3));
// 얼굴 앞 머리 부근 삼각형만 후보로 둔다.
const cand = []; for (let t = 0; t < T; t++) { const c = [0, 1, 2].map(i => (P0[I[t * 3] * 3 + i] + P0[I[t * 3 + 1] * 3 + i] + P0[I[t * 3 + 2] * 3 + i]) / 3); if (c[1] > 1.36 && c[1] < 1.75 && Math.abs(c[0]) < .3 && c[2] > .05) cand.push(t); }
function occluders() { const out = new Map(); let blocked = 0; for (const o of samples) for (const d of dirs) { let any = false; for (const t of cand) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; const tt = hit(o, d, vtx(a), vtx(b), vtx(c)); if (tt > .006 && tt < .5) { any = true; for (const k of [a, b, c]) out.set(groupOf[k], (out.get(groupOf[k]) || 0) + 1); } } if (any) blocked++; } return { out, blocked, total: samples.length * dirs.length }; }
const before = occluders(); console.log(JSON.stringify({ before: { blocked: before.blocked, total: before.total, groups: before.out.size, hairGroups: [...before.out.keys()].filter(g => hairGroup[g]).length } }));
if (process.argv.includes('--diag')) { const rows = [...before.out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([gi, n]) => { const k = groupList[gi][0]; return { n, hair: hairGroup[gi], rgb: color(k), p: gpos0(k) }; }); console.log(JSON.stringify(rows)); process.exit(0); }
if (process.argv.includes('--report')) process.exit(0);
if (process.env.PART_MODE) {
  // 가르마 방식: 오른쪽 눈 위 앞머리를 매끄러운 변위장으로 바깥(-x)·약간 위로 넘긴다. 머리카락 정점만 움직이고 같은 위치 이음매는 함께 옮긴다.
  const C = [-0.085, 1.45, 0.29], RAD = +(process.env.PART_RAD || .055), AMP = (process.env.PART_AMP || '-0.022,0.006,0.004').split(',').map(Number);
  const smooth = r => { const t = Math.min(1, Math.max(0, 1 - r / RAD)); return t * t * (3 - 2 * t); };
  let mixed = 0, movedG = 0;
  groupList.forEach((g, gi) => { if (!hairGroup[gi]) return; const p = gpos0(g[0]); if (p[2] < .2) return; const w = smooth(Math.hypot(p[0] - C[0], (p[1] - C[1]) * 1.2, p[2] - C[2])); if (w <= 0) return; movedG++; for (const k of g) for (let c = 0; c < 3; c++) P[k * 3 + c] = P0[k * 3 + c] + AMP[c] * w; });
  for (let t = 0; t < T; t++) { const h = [0, 1, 2].map(i => hairGroup[groupOf[I[t * 3 + i]]]); const mv = [0, 1, 2].map(i => { const k = I[t * 3 + i]; return P[k * 3] !== P0[k * 3] || P[k * 3 + 1] !== P0[k * 3 + 1]; }); if (mv.some(Boolean) && !mv.every(Boolean) && h.some(x => !x)) mixed++; }
  const st = occluders(); console.log(JSON.stringify({ part: { movedGroups: movedG, mixedHairSkinTris: mixed, blocked: st.blocked, total: st.total } }));
  var state = st, moved = new Float32Array(groupList.length).fill(0); moved[0] = Math.hypot(...AMP);
} else {
// 반복: 가리는 머리카락 정점 묶음을 눈에서 멀어지는 위쪽·바깥쪽으로 2mm씩, 주변 2.5cm 안의 머리카락은 거리 감쇠로 함께 민다.
var moved = new Float32Array(groupList.length);
const gpos = gi => { const k = groupList[gi][0]; return [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]; };
const hairIdx = groupList.map((_, gi) => gi).filter(gi => hairGroup[gi] && gpos(gi)[1] > 1.36 && gpos(gi)[2] > 0);
var iter = 0, state = before;
const MAX_LIFT = +(process.env.MAX_LIFT || .03);
while (state.blocked > 0 && iter < 40) {
  iter++;
  const push = new Map();
  for (const gi of state.out.keys()) {
    if (!hairGroup[gi] || moved[gi] >= MAX_LIFT) continue;
    const p = gpos(gi);
    for (const hj of hairIdx) { if (moved[hj] >= MAX_LIFT) continue; const q = gpos(hj); const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); if (d > .025) continue; const w = 1 - d / .025; push.set(hj, Math.max(push.get(hj) || 0, w)); }
  }
  if (!push.size) break;
  for (const [gi, w] of push) { const step = .002 * w; const p = gpos(gi); const eye = EYES[p[0] < 0 ? 0 : 1]; const sx = Math.sign(p[0] - eye[0]) * .35; for (const k of groupList[gi]) { P[k * 3 + 1] += step; P[k * 3] += step * sx; P[k * 3 + 2] += step * .25; } moved[gi] += step; }
  state = occluders();
}
}
const changed = [...moved].filter(m => m > 0).length;
console.log(JSON.stringify({ after: { blocked: state.blocked, total: state.total, iter, changedGroups: changed, maxLiftMm: +(Math.max(...moved) * 1000).toFixed(1) } }));
for (let i = 0; i < N * 3; i++) buf.writeFloatLE(P[i], pv.off + i * 4);
// 바운딩 박스 갱신
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], P[k * 3 + c]); mx[c] = Math.max(mx[c], P[k * 3 + c]); }
pv.a.min = mn; pv.a.max = mx;
json.asset.extras = { ...(json.asset.extras || {}), eyeSightlineFix: { tool: 'art-src/ranger/clear-eye-sightline.mjs', blockedBefore: before.blocked, blockedAfter: state.blocked, rays: state.total, changedGroups: changed, maxLiftMm: +(Math.max(...moved) * 1000).toFixed(1) } };
let js = Buffer.from(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const binLen = buf.readUInt32LE(20 + jl); const binChunk = buf.subarray(20 + jl + 8, 20 + jl + 8 + binLen);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + binChunk.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(outFile, Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(binChunk.length, 0x004e4942), binChunk]));
console.log(JSON.stringify({ out: outFile }));


