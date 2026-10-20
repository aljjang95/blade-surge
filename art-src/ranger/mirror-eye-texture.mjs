// 궁수 몸 텍스처의 눈 대칭 교정: 잘 그려진 눈을 3D 표면에서 X 거울 위치로 옮겨 다른 눈 자리에 다시 칠한다.
// node art-src/ranger/mirror-eye-texture.mjs <in.glb> <out.glb> <goodEyeU> <goodEyeV> [radiusPx] [--probe]
import fs from 'node:fs';
import sharp from 'sharp';
const [inFile, outFile, gu, gv, radiusArg] = process.argv.slice(2);
const probe = process.argv.includes('--probe');
const buf = fs.readFileSync(inFile);
const jl = buf.readUInt32LE(12); const json = JSON.parse(buf.slice(20, 20 + jl).toString()); const bin = 20 + jl + 8;
const acc = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]; const off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0); const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType]; const stride = bv.byteStride ? bv.byteStride / T.BYTES_PER_ELEMENT : comps; const copy = Buffer.from(buf.subarray(off, off + ((a.count - 1) * stride + comps) * T.BYTES_PER_ELEMENT)); const raw = new T(copy.buffer, copy.byteOffset, (a.count - 1) * stride + comps); const out = new Float64Array(a.count * comps); for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) out[k * comps + c] = raw[k * stride + c]; return out; };
const prim = json.meshes[0].primitives[0];
const P = acc(prim.attributes.POSITION), U = acc(prim.attributes.TEXCOORD_0), I = acc(prim.indices);
const mat = json.materials[0]; const texIndex = mat.pbrMetallicRoughness.baseColorTexture.index;
const imageIndex = json.textures[texIndex].extensions?.EXT_texture_webp?.source ?? json.textures[texIndex].source;
const imgView = json.images[imageIndex].bufferView, iv = json.bufferViews[imgView];
const imgBytes = buf.subarray(bin + (iv.byteOffset || 0), bin + (iv.byteOffset || 0) + iv.byteLength);
const { data: src, info } = await sharp(imgBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const Wt = info.width, Ht = info.height; const dst = Buffer.from(src);
const T = I.length / 3;
const v3 = k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], uv = k => [U[k * 2] * Wt, U[k * 2 + 1] * Ht];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
function bary2(p, a, b, c) { const v0 = [b[0] - a[0], b[1] - a[1]], v1 = [c[0] - a[0], c[1] - a[1]], v2 = [p[0] - a[0], p[1] - a[1]]; const d = v0[0] * v1[1] - v1[0] * v0[1]; if (Math.abs(d) < 1e-12) return null; const v = (v2[0] * v1[1] - v1[0] * v2[1]) / d, w = (v0[0] * v2[1] - v2[0] * v0[1]) / d; return [1 - v - w, v, w]; }
const tri = t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
const lerp3 = (bc, a, b, c) => [0, 1, 2].map(i => bc[0] * a[i] + bc[1] * b[i] + bc[2] * c[i]);
function surfaceAtUv(px) { for (let t = 0; t < T; t++) { const [a, b, c] = tri(t); const bc = bary2(px, uv(a), uv(b), uv(c)); if (bc && bc.every(x => x >= -1e-6)) return { t, pos: lerp3(bc, v3(a), v3(b), v3(c)), scale: len(sub(v3(b), v3(a))) / Math.hypot(uv(b)[0] - uv(a)[0], uv(b)[1] - uv(a)[1]) }; } return null; }
// Ericson 최근접점
function closest(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a); const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; return [1 - v - w, v, w];
}
const good = surfaceAtUv([+gu * Wt, +gv * Ht]); if (!good) throw new Error('good eye uv not on surface');
const target = [-good.pos[0], good.pos[1], good.pos[2]];
// 반경은 미터로 받는다(삼각형 한 변의 UV 배율은 늘어난 조각에서 크게 틀린다).
const R = +radiusArg || 0.05;
const otherUv = process.env.OTHER_EYE_UV?.split(',').map(Number);
if (otherUv) { const o = surfaceAtUv([otherUv[0] * Wt, otherUv[1] * Ht]); console.log(JSON.stringify({ otherEye: o?.pos.map(x => +x.toFixed(4)), offsetFromMirror: o ? +len(sub(o.pos, [-good.pos[0], good.pos[1], good.pos[2]])).toFixed(4) : null })); }
const centroid = t => { const [a, b, c] = tri(t); return [0, 1, 2].map(i => (P[a * 3 + i] + P[b * 3 + i] + P[c * 3 + i]) / 3); };
const near = (center, r) => { const out = []; for (let t = 0; t < T; t++) if (len(sub(centroid(t), center)) < r) out.push(t); return out; };
const srcTris = near(good.pos, R * 1.8), dstTris = near(target, R * 1.25);
// 대상 쪽 원래 눈(작은 점)이 대칭 위치에서 얼마나 벗어나 있는지 기록한다.
console.log(JSON.stringify({ good: { t: good.t, pos: good.pos.map(x => +x.toFixed(4)), mmPerPx: +(good.scale * 1000).toFixed(3) }, target: target.map(x => +x.toFixed(4)), R: +R.toFixed(4), srcTris: srcTris.length, dstTris: dstTris.length, dstUvBoxes: [...new Set(dstTris.map(t => tri(t).map(k => uv(k).map(Math.round).join(':')).join(' ')))].slice(0, 3) }));
if (probe) process.exit(0);
if (process.env.DIAG) { for (const [name, c] of [['good', good.pos], ['target', target]]) { const ts = near(c, +process.env.DIAG); console.log(name, JSON.stringify(ts.map(t => { const [a, b, cc] = tri(t); const u = [0, 1].map(i => Math.round((uv(a)[i] + uv(b)[i] + uv(cc)[i]) / 3)); const n = centroid(t); return u.join(':') + '@' + n.map(x => x.toFixed(3)).join(','); }))); } process.exit(0); }
function sample(x, y) { x = Math.min(Wt - 1.001, Math.max(0, x - .5)); y = Math.min(Ht - 1.001, Math.max(0, y - .5)); const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; const o = []; for (let c = 0; c < 4; c++) { const g = (xx, yy) => src[(yy * Wt + xx) * 4 + c]; o.push((g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy); } return o; }
let painted = 0;
for (const t of dstTris) {
  const [a, b, c] = tri(t); const A = uv(a), B = uv(b), C = uv(c);
  const x0 = Math.floor(Math.min(A[0], B[0], C[0])), x1 = Math.ceil(Math.max(A[0], B[0], C[0])), y0 = Math.floor(Math.min(A[1], B[1], C[1])), y1 = Math.ceil(Math.max(A[1], B[1], C[1]));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= Wt || y >= Ht) continue;
    // 경계 이음매가 비지 않게 삼각형 바깥 1.5px까지 칠한다.
    const bc = bary2([x + .5, y + .5], A, B, C); if (!bc || bc.some(v => v < -0.04)) continue;
    const bcc = bc.map(v => Math.max(0, v)); const s = bcc[0] + bcc[1] + bcc[2]; const bn = bcc.map(v => v / s);
    const p3 = lerp3(bn, v3(a), v3(b), v3(c)); const d = len(sub(p3, target)); if (d > R) continue;
    const m = [-p3[0], p3[1], p3[2]]; let best = null;
    for (const st of srcTris) { const [sa, sb, sc] = tri(st); const q = closest(m, v3(sa), v3(sb), v3(sc)); const qp = lerp3(q, v3(sa), v3(sb), v3(sc)); const dd = len(sub(qp, m)); if (!best || dd < best.dd) best = { dd, q, st }; }
    if (!best || best.dd > R * .25) continue;
    const [sa, sb, sc] = tri(best.st); const suv = lerp3(best.q.concat(), [...uv(sa), 0], [...uv(sb), 0], [...uv(sc), 0]);
    const col = sample(suv[0], suv[1]);
    const w = 1 - Math.min(1, Math.max(0, (d - R * .72) / (R * .28))); const k = (y * Wt + x) * 4;
    for (let ch = 0; ch < 3; ch++) dst[k + ch] = Math.round(dst[k + ch] * (1 - w) + col[ch] * w);
    painted++;
  }
}
const webp = await sharp(dst, { raw: { width: Wt, height: Ht, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toBuffer();
fs.writeFileSync(outFile.replace(/\.glb$/, '-basecolor.png'), await sharp(dst, { raw: { width: Wt, height: Ht, channels: 4 } }).png().toBuffer());
// GLB 재조립: 바뀐 이미지 bufferView만 교체하고 나머지 바이트는 그대로 옮긴다.
const views = json.bufferViews.map((v, i) => i === imgView ? webp : buf.subarray(bin + (v.byteOffset || 0), bin + (v.byteOffset || 0) + v.byteLength));
let off = 0; const parts = [];
json.bufferViews.forEach((v, i) => { const pad = (4 - off % 4) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; } v.byteOffset = off; v.byteLength = views[i].length; parts.push(views[i]); off += views[i].length; });
const tail = (4 - off % 4) % 4; if (tail) parts.push(Buffer.alloc(tail));
const binChunk = Buffer.concat(parts); json.buffers[0].byteLength = binChunk.length;
json.asset.extras = { ...(json.asset.extras || {}), eyeSymmetryFix: { tool: 'art-src/ranger/mirror-eye-texture.mjs', goodEyeUv: [+gu, +gv], radiusM: R, painted } };
let js = Buffer.from(JSON.stringify(json)); const jp = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + binChunk.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(outFile, Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(binChunk.length, 0x004e4942), binChunk]));
console.log(JSON.stringify({ painted, webpBytes: webp.length, out: outFile }));

