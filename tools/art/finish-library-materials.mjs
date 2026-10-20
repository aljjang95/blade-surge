// 라이브러리 몸체 GLB 재질 마감기(library-skin-finish-v1). Blender/Node 어느 PC 에서나 같은 입력이면 같은 바이트를 낸다.
// 게임 로더 normalizeLibrarySkinMaterial(src/engine/assets.js)이 매 로드마다 하던 보정을 GLB 재질 자체에 고정한다:
//   금속도 상한 0.22(없으면 glTF 기본 1 → 0.22), 불투명(baseColorFactor 알파 ≥ 1) BLEND → MASK·cutoff ≥ 0.5.
// 바뀌는 것은 materials 의 위 세 필드와 asset.extras.materialFinish(입력 SHA·레시피·도구·revision) 뿐이다.
// BIN 청크(메시·스킨·텍스처·클립 바이트)는 그대로 복사하고, 그 외 JSON 도 같은지 쓰기 전에 다시 검사한다.
// 출력 파일이 이미 있으면 덮어쓰지 않는다. 이미 마감된 입력·GLB 가 아닌 입력·청크 길이가 어긋난 입력은 거절한다.
//   node tools/art/finish-library-materials.mjs <입력.glb> <출력.glb> <revision-id>
// 모든 재질을 몸 스킨 재질로 다루므로 Tripo 라이브러리 영웅 몸체(재질 1개)용이다. 소품·무기 GLB 에는 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FINISH_RECIPE = 'library-skin-finish-v1';
export const FINISH_TOOL = 'tools/art/finish-library-materials.mjs';
export const FINISH_METALNESS_MAX = 0.22;
export const FINISH_ALPHA_CUTOFF = 0.5;
const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** 단일 버퍼 GLB(JSON + BIN 두 청크)만 받는다. 어긋나면 이유를 담아 던진다. */
export function validateGLB(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 28) throw new Error('invalid GLB: too short');
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('invalid GLB: bad magic');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('invalid GLB: version must be 2');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('invalid GLB: header length ' + bytes.readUInt32LE(8) + ' != file ' + bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== JSON_CHUNK) throw new Error('invalid GLB: first chunk is not JSON');
  if (jsonLength % 4 || 20 + jsonLength + 8 > bytes.length) throw new Error('invalid GLB: JSON chunk length');
  let json;
  try { json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')); } catch (error) { throw new Error('invalid GLB: JSON chunk does not parse (' + error.message + ')'); }
  if (!json || typeof json !== 'object' || json.asset?.version !== '2.0') throw new Error('invalid GLB: asset.version must be 2.0');
  const binOffset = 20 + jsonLength, binLength = bytes.readUInt32LE(binOffset);
  if (bytes.readUInt32LE(binOffset + 4) !== BIN_CHUNK) throw new Error('invalid GLB: second chunk is not BIN');
  if (binLength % 4 || binOffset + 8 + binLength !== bytes.length) throw new Error('invalid GLB: BIN chunk must end the file');
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || json.buffers[0].uri !== undefined
    || json.buffers[0].byteLength > binLength || binLength - json.buffers[0].byteLength >= 4) throw new Error('invalid GLB: expected one embedded buffer matching BIN');
  if (!Array.isArray(json.materials) || !json.materials.length) throw new Error('invalid GLB: no materials to finish');
  return { json, binChunk: bytes.subarray(binOffset) };
}

/** 재질 하나에 마감 규칙을 적용한다. 바뀐 필드 경로를 돌려준다(원본 객체는 그대로). */
export function finishMaterial(source) {
  const material = structuredClone(source), changed = [];
  const pbr = material.pbrMetallicRoughness || (material.pbrMetallicRoughness = {});
  if ((pbr.metallicFactor ?? 1) > FINISH_METALNESS_MAX) { pbr.metallicFactor = FINISH_METALNESS_MAX; changed.push('pbrMetallicRoughness.metallicFactor'); }
  if ((material.alphaMode ?? 'OPAQUE') === 'BLEND' && (pbr.baseColorFactor?.[3] ?? 1) >= 1) {
    material.alphaMode = 'MASK'; changed.push('alphaMode');
    const cutoff = Math.max(material.alphaCutoff ?? FINISH_ALPHA_CUTOFF, FINISH_ALPHA_CUTOFF);
    if (material.alphaCutoff !== cutoff) { material.alphaCutoff = cutoff; changed.push('alphaCutoff'); }
  }
  if (!source.pbrMetallicRoughness && !changed.length) delete material.pbrMetallicRoughness;
  return { material, changed };
}

/** 마감 결과를 계산한다(파일 쓰기 없음). 같은 입력·revision 이면 같은 바이트다. */
export function finishLibraryGLB(bytes, revision) {
  if (!/^[a-z][a-z0-9-]*-v[0-9]+$/.test(String(revision || ''))) throw new Error('revision id must look like ranger-library-v3');
  const { json, binChunk } = validateGLB(bytes);
  if (json.asset.extras?.materialFinish) throw new Error('input is already material-finished (' + json.asset.extras.materialFinish.revision + ')');
  const inputSha256 = sha256(bytes), before = structuredClone(json), changes = [];
  json.materials = json.materials.map((m, index) => {
    const { material, changed } = finishMaterial(m);
    if (changed.length) changes.push({ index, name: m.name ?? null, changed });
    return material;
  });
  if (!changes.length) throw new Error('nothing to finish: materials already match ' + FINISH_RECIPE);
  json.asset.extras = { ...(json.asset.extras || {}), materialFinish: { revision, recipe: FINISH_RECIPE, tool: FINISH_TOOL, inputSha256,
    metallicFactorMax: FINISH_METALNESS_MAX, opaqueBlendAlphaCutoff: FINISH_ALPHA_CUTOFF } };
  const text = Buffer.from(JSON.stringify(json)), pad = Buffer.alloc((4 - text.length % 4) % 4, 0x20);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + text.length + pad.length + binChunk.length, 8);
  header.writeUInt32LE(text.length + pad.length, 12); header.writeUInt32LE(JSON_CHUNK, 16);
  const output = Buffer.concat([header, text, pad, binChunk]);
  // 쓰기 전 재검사: BIN 바이트 동일, materials·materialFinish 외 JSON 동일.
  const check = validateGLB(output);
  if (!check.binChunk.equals(binChunk)) throw new Error('internal: BIN changed');
  const strip = (j) => { const c = structuredClone(j); delete c.materials; if (c.asset.extras) delete c.asset.extras.materialFinish;
    if (c.asset.extras && !Object.keys(c.asset.extras).length && !before.asset.extras) delete c.asset.extras; return JSON.stringify(c); };
  if (strip(check.json) !== strip(before)) throw new Error('internal: non-material JSON changed');
  return { output, sha256: sha256(output), inputSha256, revision, changes };
}

/** 출력은 임시 파일을 쓴 뒤 하드링크로 원자적으로 만든다. 이미 있으면 EEXIST 로 멈추고 기존 파일은 그대로다. */
export function writeNoClobber(outputPath, bytes) {
  if (fs.existsSync(outputPath)) throw new Error('refusing to overwrite existing output: ' + outputPath);
  const temp = outputPath + '.tmp-' + process.pid;
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try { fs.linkSync(temp, outputPath); } finally { fs.rmSync(temp, { force: true }); }
}

function main(argv) {
  const [input, output, revision] = argv;
  if (!input || !output || !revision || argv.length > 3) throw new Error('Usage: node tools/art/finish-library-materials.mjs <input.glb> <output.glb> <revision-id>');
  if (path.resolve(input) === path.resolve(output)) throw new Error('output must differ from input');
  if (fs.existsSync(output)) throw new Error('refusing to overwrite existing output: ' + output);
  const result = finishLibraryGLB(fs.readFileSync(input), revision);
  writeNoClobber(output, result.output);
  console.log(JSON.stringify({ output, bytes: result.output.length, sha256: result.sha256, inputSha256: result.inputSha256, revision, recipe: FINISH_RECIPE, changes: result.changes }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error('finish-library-materials: ' + error.message); process.exitCode = 1; }
}
