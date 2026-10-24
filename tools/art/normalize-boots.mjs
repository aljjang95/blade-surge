// 등급 부츠 원본(PC Tripo 정적 메시, art/t5-pc-results 브랜치 art-src/t5-pc/boots_<n|e|l>/model.glb)을
// docs/art-plan-boots.md 3절 계약으로 정규화해 public/models/boots/<id>.glb 로 쓴다. Blender 없이 같은 결과를 재현하려고 Node 로 둔다.
//  · 축: Tripo 출력의 발끝 방향을 +Z 로 돌린다(id 별 yaw, 아래 TARGETS). 밑창 수평·+Y 위는 Tripo 출력 그대로다.
//  · 원점 = 발목 관절: 수평 위치는 부츠 목(윗단 15% 정점)의 bbox 중심 = 다리 축, 높이는 밑창 길이 ÷ ANKLE_LENGTH_RATIO.
//    런타임은 영웅 발목 높이 ÷ 이 깊이로 배율을 정하므로, 이 비율이 곧 "영웅 발목 높이 대비 부츠 길이"가 된다.
//  · 스케일: 발목 깊이를 SOLE_DEPTH(m)로 맞춘다(밑창 y = -SOLE_DEPTH, 계약 [-0.22, -0.03] 안).
//  · 삼각형: TRIANGLE_TARGET 초과면 meshoptimizer 로 줄인다(UV 이음매는 LockBorder 로 보존).
//  · 텍스처: 라이브러리 몸(blender_normalize.py)과 같은 관례 — 1024 WEBP 품질 82, 금속·거칠기 지도 유지.
// 사용: node tools/art/normalize-boots.mjs --src <art-src/t5-pc 폴더> [--out public/models/boots] [--only boots_e]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

export const SOLE_DEPTH = 0.14;
export const ANKLE_LENGTH_RATIO = 2.4;
export const TRIANGLE_TARGET = 3000;
/** src/engine/hero-boots.js BOOTS_TRIANGLE_LIMIT 과 같은 값. */
export const TRIANGLE_LIMIT = 3200;
export const TEXTURE_LIMIT = 1024;
export const TEXTURE_QUALITY = 82;
/** 원본(art/t5-pc-results 20087d6 의 model.glb)과 같은 파일만 받는다. yaw 는 발끝을 +Z 로 돌리는 Y축 회전(도). */
export const TARGETS = Object.freeze({
  boots_n: { sha256: '5bf444e912c0fca43ab72b7fe9983aa234c099a0a499416a839b94b17d44fa47', yaw: 90 },   // RESULT.md 표는 한 글자 오기(43aa…), 브랜치 파일(3,877,832 B) 실측값
  boots_e: { sha256: '71f2e0c62703a2a97f2bdd7d3dc775add82b358bb5f345aa7573030a3ff6e527', yaw: 90 },
  boots_l: { sha256: '44658ee2b81f8205ffa5fc795f1df9927444cc7951a4fdd05a43a605ad38b567', yaw: 0 },
});

const COMPONENT = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(file) {
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const binStart = 28 + jsonLength;
  return { json, bin: file.subarray(binStart, binStart + file.readUInt32LE(20 + jsonLength)) };
}

function readAccessor({ json, bin }, index) {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const [Type, bytes] = COMPONENT[accessor.componentType], size = SIZE[accessor.type];
  const stride = view.byteStride || bytes * size, base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new (Type === Float32Array ? Float32Array : Uint32Array)(accessor.count * size);
  const data = new DataView(bin.buffer, bin.byteOffset);
  const get = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType];
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = data[get](base + i * stride + k * bytes, true);
  return out;
}

function readImage({ json, bin }, index) {
  const view = json.bufferViews[json.images[index].bufferView];
  return bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
}

/** 발끝 +Z 로 돌린 뒤 발목 원점·배율을 정한다. 순수 함수(테스트용). */
export function bootsFrame(positions, { yaw, soleDepth = SOLE_DEPTH, ratio = ANKLE_LENGTH_RATIO }) {
  const c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180);
  const rotated = new Float32Array(positions.length);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    rotated[i] = x * c + z * s; rotated[i + 1] = y; rotated[i + 2] = -x * s + z * c;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], rotated[i + k]); max[k] = Math.max(max[k], rotated[i + k]); }
  }
  // 부츠 목(윗단 15%) bbox 중심 = 다리 축.
  const shaftY = max[1] - (max[1] - min[1]) * 0.15, shaftMin = [Infinity, Infinity], shaftMax = [-Infinity, -Infinity];
  for (let i = 0; i < rotated.length; i += 3) {
    if (rotated[i + 1] < shaftY) continue;
    shaftMin[0] = Math.min(shaftMin[0], rotated[i]); shaftMax[0] = Math.max(shaftMax[0], rotated[i]);
    shaftMin[1] = Math.min(shaftMin[1], rotated[i + 2]); shaftMax[1] = Math.max(shaftMax[1], rotated[i + 2]);
  }
  const length = max[2] - min[2], depth = length / ratio;
  const origin = [(shaftMin[0] + shaftMax[0]) / 2, min[1] + depth, (shaftMin[1] + shaftMax[1]) / 2];
  // 발끝이 +Z 인지: 다리 축(목 중심)이 발 길이의 뒤쪽 절반에 있어야 한다.
  const heelSide = (origin[2] - min[2]) / length;
  return { rotated, origin, scale: soleDepth / depth, cos: c, sin: s, min, max, heelSide };
}

function pad4(buffer, fill = 0) { const extra = (4 - buffer.length % 4) % 4; return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer; }

export function writeGlb(json, chunks) {
  const views = [], parts = []; let offset = 0;
  for (const { data, target } of chunks) {
    const bytes = pad4(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, ...(target ? { target } : {}) });
    parts.push(bytes); offset += bytes.length;
  }
  json.bufferViews = views; json.buffers = [{ byteLength: offset }];
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 32), binChunk = Buffer.concat(parts);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.write('JSON', 16);
  binHeader.writeUInt32LE(binChunk.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}

export async function normalizeBoots(id, source) {
  const target = TARGETS[id];
  if (!target) throw new Error(`unknown boots id: ${id}`);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== target.sha256) throw new Error(`${id}: source sha256 mismatch ${digest}`);
  const glb = parseGlb(source), { json } = glb;
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1 || json.skins?.length) throw new Error(`${id}: expected one static mesh/material`);
  const node = json.nodes.find((n) => n.mesh === 0);
  if (node.rotation || node.scale || node.matrix) throw new Error(`${id}: unexpected node transform`);
  const primitive = json.meshes[0].primitives[0];
  const positions = readAccessor(glb, primitive.attributes.POSITION), normals = readAccessor(glb, primitive.attributes.NORMAL), uvs = readAccessor(glb, primitive.attributes.TEXCOORD_0);
  const translation = node.translation || [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) positions[i + k] += translation[k];
  let indices = primitive.indices != null ? readAccessor(glb, primitive.indices) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const sourceTriangles = indices.length / 3;
  if (sourceTriangles > TRIANGLE_TARGET) {
    await MeshoptSimplifier.ready;
    // 오차 한계를 조금씩 올려 목표에 닿을 때까지 줄인다. 이음매 고정 때문에 못 닿으면 데이터 상한(3,200)까지는 받는다.
    let simplified = indices;
    for (const error of [0.01, 0.02, 0.04]) {
      [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, TRIANGLE_TARGET * 3, error, ['LockBorder']);
      if (simplified.length / 3 <= TRIANGLE_TARGET) break;
    }
    if (simplified.length / 3 > TRIANGLE_LIMIT) throw new Error(`${id}: simplify stalled at ${simplified.length / 3}`);
    indices = simplified;
  }
  // 쓰는 정점만 남긴다.
  const remap = new Int32Array(positions.length / 3).fill(-1); let count = 0;
  for (const index of indices) if (remap[index] < 0) remap[index] = count++;
  const frame = bootsFrame(positions, { yaw: target.yaw });
  if (!(frame.heelSide > 0.1 && frame.heelSide < 0.5)) throw new Error(`${id}: toe axis check failed (heelSide ${frame.heelSide.toFixed(3)})`);
  const outPosition = new Float32Array(count * 3), outNormal = new Float32Array(count * 3), outUv = new Float32Array(count * 2);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i]; if (j < 0) continue;
    for (let k = 0; k < 3; k++) outPosition[j * 3 + k] = (frame.rotated[i * 3 + k] - frame.origin[k]) * frame.scale;
    const nx = normals[i * 3], nz = normals[i * 3 + 2];
    outNormal[j * 3] = nx * frame.cos + nz * frame.sin; outNormal[j * 3 + 1] = normals[i * 3 + 1]; outNormal[j * 3 + 2] = -nx * frame.sin + nz * frame.cos;
    outUv[j * 2] = uvs[i * 2]; outUv[j * 2 + 1] = uvs[i * 2 + 1];
  }
  const outIndex = count < 65536 ? Uint16Array.from(indices, (i) => remap[i]) : Uint32Array.from(indices, (i) => remap[i]);
  const bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outPosition.length; i += 3) for (let k = 0; k < 3; k++) { bbMin[k] = Math.min(bbMin[k], outPosition[i + k]); bbMax[k] = Math.max(bbMax[k], outPosition[i + k]); }

  const material = json.materials[0], slots = [];
  const remapTexture = (info) => { if (!info) return; slots.push(info); };
  remapTexture(material.pbrMetallicRoughness?.baseColorTexture); remapTexture(material.normalTexture); remapTexture(material.pbrMetallicRoughness?.metallicRoughnessTexture);
  const { default: sharp } = await import('sharp');   // 테스트가 순수 함수만 가져갈 때 네이티브 모듈을 읽지 않게
  const images = [], imageBySource = new Map();
  for (const info of slots) {
    const sourceImage = json.textures[info.index].source;
    if (!imageBySource.has(sourceImage)) {
      const webp = await sharp(readImage(glb, sourceImage)).resize(TEXTURE_LIMIT, TEXTURE_LIMIT, { fit: 'inside', withoutEnlargement: true }).webp({ quality: TEXTURE_QUALITY }).toBuffer();
      imageBySource.set(sourceImage, images.length); images.push(webp);
    }
    info.index = imageBySource.get(sourceImage);
  }
  const chunks = [
    { data: outPosition, target: 34962 }, { data: outNormal, target: 34962 }, { data: outUv, target: 34962 }, { data: outIndex, target: 34963 },
    ...images.map((data) => ({ data })),
  ];
  const out = {
    asset: { version: '2.0', generator: 'blade-surge tools/art/normalize-boots.mjs' },
    extensionsUsed: ['EXT_texture_webp'], extensionsRequired: ['EXT_texture_webp'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: id, mesh: 0 }],
    meshes: [{ name: id, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: bbMin, max: bbMax },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: outIndex instanceof Uint16Array ? 5123 : 5125, count: outIndex.length, type: 'SCALAR' },
    ],
    materials: [{ ...material, name: id }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    textures: images.map((_, i) => ({ sampler: 0, extensions: { EXT_texture_webp: { source: i } } })),
    images: images.map((_, i) => ({ bufferView: 4 + i, mimeType: 'image/webp' })),
  };
  const file = writeGlb(out, chunks);
  return {
    file,
    report: {
      id, sourceBytes: source.length, bytes: file.length, sourceTriangles, triangles: outIndex.length / 3, vertices: count,
      yaw: target.yaw, origin: frame.origin.map((v) => +v.toFixed(4)), scale: +frame.scale.toFixed(4), heelSide: +frame.heelSide.toFixed(3),
      min: bbMin.map((v) => +v.toFixed(4)), max: bbMax.map((v) => +v.toFixed(4)), textures: images.map((b) => b.length),
      sha256: createHash('sha256').update(file).digest('hex'),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const src = arg('--src'), outDir = arg('--out', 'public/models/boots'), only = arg('--only');
  if (!src) throw new Error('--src <art-src/t5-pc 폴더> 가 필요하다');
  await mkdir(outDir, { recursive: true });
  for (const id of Object.keys(TARGETS).filter((key) => !only || key === only)) {
    const { file, report } = await normalizeBoots(id, await readFile(join(src, id, 'model.glb')));
    await writeFile(join(outDir, `${id}.glb`), file);
    console.log(JSON.stringify(report));
  }
}
