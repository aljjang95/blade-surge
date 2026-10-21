// 전달용 GLB 압축. 저장소의 원본 GLB(해시 계약 대상)는 건드리지 않고, 빌드 산출물의 사본에만 적용한다.
//
// 원본 JSON 은 글자 그대로 두고 accessors·bufferViews·buffers 만 새로 쓴다(노드·메시·재질·애니메이션 구조·extras 불변).
// 접근자마다 "원본 그대로"와 "EXT_meshopt_compression" 중 deflate 후 더 작은 쪽을 고른다(AAB·정적 호스팅 모두 deflate 계열 압축을 쓰므로).
//  · meshopt 는 디코드하면 원본과 바이트가 같은 무손실 압축이다(삼각형 안 시작 꼭짓점 회전만 허용).
//  · 회전 애니메이션 출력만 float32 쿼터니언을 정규화 int16 으로 줄인 뒤 meshopt 로 묶는다. 요소 오차 <= 1/32767(각도 약 0.002도).
//    glTF 2.0 코어가 허용하는 형식이고 GLTFLoader 가 로드할 때 float32 로 풀어 준다.
// 바꾸지 않는 것: 위치·법선·UV·가중치·조인트·키 시간·이동·스케일 값. hero-body-motion 이 골반 위치 트랙의 decoded Float32
//   스냅샷을 비트 단위로 대조하므로 위치 트랙과 시간은 반드시 보존해야 한다.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** 변환 규칙을 바꾸면 올려서 캐시를 무효화한다. */
export const GLB_OPTIMIZER_VERSION = 'glb-meshopt-v2';
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const FLOAT = 5126, SHORT = 5122, USHORT = 5123, UINT = 5125;
const ROTATION_MAX_ERROR = 1 / 32767;
/** 접근자 단위로 meshopt 를 고르는 기준. deflate 후 크기가 이만큼 이하로 줄어야 쓴다. */
const MIN_GAIN = 0.95;

const gz = (bytes) => gzipSync(bytes, { level: 6 }).length;
const align4 = (n) => (n + 3) & ~3;

function splitGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('GLB 가 아닙니다');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + 20, jsonLength).toString('utf8'));
  const binOffset = 20 + jsonLength;
  const bin = binOffset + 8 <= bytes.byteLength ? bytes.subarray(binOffset + 8, binOffset + 8 + view.getUint32(binOffset, true)) : new Uint8Array(0);
  return { json, bin };
}

function joinGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const binChunk = Buffer.concat([Buffer.from(bin), Buffer.alloc((4 - bin.byteLength % 4) % 4)]);
  const header = Buffer.alloc(12); header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length); jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binChunk.length); binHeader.write('BIN\0', 4);
  return new Uint8Array(Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

const elementBytes = (accessor) => COMPONENT_BYTES[accessor.componentType] * TYPE_COUNT[accessor.type];

/** 접근자의 데이터를 인터리브 없이 촘촘히 복사한다. */
function readAccessor(json, bin, accessor) {
  const view = json.bufferViews[accessor.bufferView], size = elementBytes(accessor), stride = view.byteStride || size;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0), out = new Uint8Array(accessor.count * size);
  if (stride === size) out.set(bin.subarray(start, start + out.length));
  else for (let i = 0; i < accessor.count; i++) out.set(bin.subarray(start + i * stride, start + i * stride + size), i * size);
  return out;
}

/** 회전 출력(LINEAR/STEP)의 접근자 번호를 모은다. 다른 용도로도 쓰이는 접근자는 제외한다. */
function rotationOutputs(json) {
  const rotation = new Set(), other = new Set();
  for (const animation of json.animations || []) {
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      if (channel.target.path === 'rotation' && (sampler.interpolation || 'LINEAR') !== 'CUBICSPLINE') rotation.add(sampler.output);
      else other.add(sampler.output);
    }
  }
  for (const index of other) rotation.delete(index);
  return rotation;
}

/** 단위 쿼터니언 float32 데이터를 정규화 int16 으로 바꾼다. 단위 길이가 아니면 null. */
function packRotation(source) {
  const floats = new Float32Array(source.buffer, source.byteOffset, source.byteLength / 4), packed = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i += 4) {
    const length = Math.hypot(floats[i], floats[i + 1], floats[i + 2], floats[i + 3]);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3) return null;
  }
  for (let i = 0; i < floats.length; i++) packed[i] = Math.round(Math.max(-1, Math.min(1, floats[i])) * 32767);
  return new Uint8Array(packed.buffer);
}

/** 접근자가 어떤 meshopt 모드가 되는지. 인덱스는 삼각형 리스트면 TRIANGLES, 아니면 INDICES. 압축할 수 없으면 null. */
function modeFor(json, accessorIndex, accessor) {
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== accessorIndex) continue;
      if (accessor.componentType !== USHORT && accessor.componentType !== UINT) return null;
      return (primitive.mode === undefined || primitive.mode === 4) && accessor.count % 3 === 0 ? 'TRIANGLES' : 'INDICES';
    }
  }
  return 'ATTRIBUTES';
}

/** 이 변환기가 다루지 않는 구조면 이유를, 다룰 수 있으면 null 을 돌려준다. */
function unsupportedReason(json) {
  if ((json.extensionsUsed || []).some(name => /draco|meshopt|sparse/i.test(name))) return `지원하지 않는 확장: ${json.extensionsUsed.join(',')}`;
  if ((json.buffers || []).length !== 1 || json.buffers[0].uri) return '버퍼가 하나의 GLB BIN 이 아닙니다';
  if ((json.accessors || []).some(accessor => accessor.sparse)) return 'sparse 접근자';
  const withView = (json.accessors || []).filter(a => a.bufferView !== undefined);
  const used = new Set(withView.map(a => a.bufferView));
  const imageViews = new Set((json.images || []).filter(image => image.bufferView !== undefined).map(image => image.bufferView));
  const references = (JSON.stringify(json).match(/"bufferView":\d+/g) || []).length;
  if (references !== withView.length + (json.images || []).filter(image => image.bufferView !== undefined).length) return '접근자·이미지 밖에서 bufferView 를 참조';
  for (let i = 0; i < (json.bufferViews || []).length; i++) if (!used.has(i) && !imageViews.has(i)) return `쓰이지 않는 bufferView #${i}`;
  for (const accessor of withView) if (/^MAT[23]$/.test(accessor.type) && COMPONENT_BYTES[accessor.componentType] !== 4) return '정렬 패딩이 필요한 행렬 접근자';
  return null;
}

/**
 * GLB 한 개를 압축한다.
 * @param {Uint8Array} bytes 원본 GLB
 * @returns {Promise<{bytes: Uint8Array, stats: {accessors: number, compressed: number, rotations: number}}|{skipped: string}>}
 */
export async function optimizeGlb(bytes) {
  await MeshoptEncoder.ready;
  const { json: source, bin } = splitGlb(bytes);
  const reason = unsupportedReason(source);
  if (reason) return { skipped: reason };
  if (!(source.accessors || []).length) return { skipped: '압축할 접근자 없음' };
  const json = structuredClone(source), rotations = rotationOutputs(source);
  const pieces = [], newViews = [], viewByKey = new Map();
  let packedOffset = 0, fallbackOffset = 0;
  const pushPacked = (data) => {
    const offset = packedOffset; pieces.push(data);
    const pad = align4(data.length) - data.length;
    if (pad) pieces.push(new Uint8Array(pad));
    packedOffset += align4(data.length);
    return offset;
  };
  const stats = { accessors: 0, compressed: 0, rotations: 0 };

  json.accessors.forEach((accessor, accessorIndex) => {
    if (accessor.bufferView === undefined) return;
    stats.accessors++;
    const original = readAccessor(source, bin, accessor), sourceView = source.bufferViews[accessor.bufferView];
    let data = original, size = elementBytes(accessor), packedRotation = false;
    if (rotations.has(accessorIndex) && accessor.componentType === FLOAT && accessor.type === 'VEC4') {
      const packed = packRotation(original);
      if (packed) { data = packed; size = 8; packedRotation = true; }
    }
    const mode = modeFor(source, accessorIndex, accessor), count = accessor.count;
    let compressed = null, stride = size;
    if (mode === 'ATTRIBUTES') {
      stride = align4(size);
      let padded = data;
      if (stride !== size) {
        padded = new Uint8Array(count * stride);
        for (let i = 0; i < count; i++) padded.set(data.subarray(i * size, (i + 1) * size), i * stride);
      }
      if (stride <= 256) compressed = MeshoptEncoder.encodeGltfBuffer(padded, count, stride, 'ATTRIBUTES');
    } else if (mode) {
      stride = accessor.componentType === USHORT ? 2 : 4;
      compressed = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode);
    }
    // 회전 정밀도를 줄이는 것은 meshopt 로 묶어 이득이 있을 때만 한다. 이득이 없으면 float 원본을 그대로 둔다.
    const useCompressed = !!compressed && gz(compressed) < gz(original) * MIN_GAIN;
    const key = createHash('sha1').update(useCompressed ? compressed : original).update(`|${mode}|${stride}|${count}|${useCompressed}`).digest('hex');
    let viewIndex = viewByKey.get(key);
    if (viewIndex === undefined) {
      const view = {};
      if (useCompressed) {
        const byteLength = count * stride;
        Object.assign(view, { buffer: 1, byteOffset: fallbackOffset, byteLength });
        if (mode === 'ATTRIBUTES') view.byteStride = stride;
        view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: pushPacked(compressed), byteLength: compressed.length, byteStride: stride, count, mode } };
        fallbackOffset += align4(byteLength);
        stats.compressed++;
      } else {
        Object.assign(view, { buffer: 0, byteOffset: pushPacked(original), byteLength: original.length });
      }
      if (sourceView.target !== undefined) view.target = sourceView.target;
      viewIndex = newViews.push(view) - 1; viewByKey.set(key, viewIndex);
    }
    accessor.bufferView = viewIndex; accessor.byteOffset = 0;
    if (useCompressed && packedRotation) { accessor.componentType = SHORT; accessor.normalized = true; delete accessor.min; delete accessor.max; stats.rotations++; }
  });

  if (!stats.compressed) return { skipped: '이득 있는 접근자 없음' };
  // 이미지처럼 접근자가 아닌 bufferView 는 원본 바이트 그대로 새 BIN 으로 옮긴다.
  for (const image of json.images || []) {
    if (image.bufferView === undefined) continue;
    const sourceView = source.bufferViews[image.bufferView];
    const raw = bin.subarray(sourceView.byteOffset || 0, (sourceView.byteOffset || 0) + sourceView.byteLength);
    const key = createHash('sha1').update(raw).update('|image').digest('hex');
    let viewIndex = viewByKey.get(key);
    if (viewIndex === undefined) { viewIndex = newViews.push({ buffer: 0, byteOffset: pushPacked(raw), byteLength: raw.length }) - 1; viewByKey.set(key, viewIndex); }
    image.bufferView = viewIndex;
  }
  json.bufferViews = newViews;
  json.buffers = [{ byteLength: packedOffset }, { byteLength: fallbackOffset, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'EXT_meshopt_compression'])];
  const out = joinGlb(json, Buffer.concat(pieces));
  if (gz(out) >= gz(bytes) * MIN_GAIN) return { skipped: `deflate 후 이득 없음(${gz(bytes)} -> ${gz(out)})` };
  return { bytes: out, stats };
}

const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;

/** 삼각형 순서와 감김 방향은 보존하되 삼각형 안 시작 꼭짓점 회전은 같은 것으로 본다. */
function sameTriangles(a, b, bytes) {
  const view = (array) => (bytes === 2 ? new Uint16Array(array.buffer, array.byteOffset, array.length / 2) : new Uint32Array(array.buffer, array.byteOffset, array.length / 4));
  const [x, y] = [view(a), view(b)];
  if (x.length !== y.length) return false;
  for (let t = 0; t + 2 < x.length; t += 3) {
    const [p, q, r] = [x[t], x[t + 1], x[t + 2]];
    const at = (u, v, w) => y[t] === u && y[t + 1] === v && y[t + 2] === w;
    if (!(at(p, q, r) || at(q, r, p) || at(r, p, q))) return false;
  }
  return true;
}

/** 압축 결과를 meshopt 디코더로 풀어 원본과 대조한다. 같으면 null, 어긋나면 이유를 돌려준다. */
export async function verifyOptimized(sourceBytes, optimizedBytes) {
  await MeshoptDecoder.ready;
  const { json: a, bin: binA } = splitGlb(sourceBytes), { json: b, bin: binB } = splitGlb(optimizedBytes);
  const strip = (json) => {
    const copy = structuredClone(json);
    delete copy.bufferViews; delete copy.buffers;
    for (const image of copy.images || []) delete image.bufferView;
    for (const accessor of copy.accessors || []) for (const key of ['bufferView', 'byteOffset', 'componentType', 'normalized', 'min', 'max']) delete accessor[key];
    copy.extensionsUsed = (copy.extensionsUsed || []).filter(name => name !== 'EXT_meshopt_compression');
    copy.extensionsRequired = (copy.extensionsRequired || []).filter(name => name !== 'EXT_meshopt_compression');
    if (!copy.extensionsUsed.length) delete copy.extensionsUsed;
    if (!copy.extensionsRequired.length) delete copy.extensionsRequired;
    return copy;
  };
  if (JSON.stringify(strip(a)) !== JSON.stringify(strip(b))) return '접근자·버퍼 밖의 JSON 이 달라졌습니다';
  const decodeView = (view) => {
    const ext = view.extensions?.EXT_meshopt_compression;
    if (!ext) return binB.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const target = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, binB.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter || 'NONE');
    return target;
  };
  const rotations = rotationOutputs(a);
  for (let i = 0; i < a.accessors.length; i++) {
    const [x, y] = [a.accessors[i], b.accessors[i]];
    if (x.bufferView === undefined) { if (y.bufferView !== undefined) return `접근자 #${i} 데이터가 생김`; continue; }
    const before = readAccessor(a, binA, x), view = b.bufferViews[y.bufferView], decoded = decodeView(view), size = elementBytes(y);
    const stride = view.byteStride || size, after = new Uint8Array(y.count * size);
    for (let k = 0; k < y.count; k++) after.set(decoded.subarray(k * stride + (y.byteOffset || 0), k * stride + (y.byteOffset || 0) + size), k * size);
    if (y.componentType === SHORT && x.componentType === FLOAT) {
      if (!y.normalized || !rotations.has(i)) return `접근자 #${i} 회전이 아닌데 int16 으로 바뀜`;
      const floats = new Float32Array(before.buffer, before.byteOffset, before.length / 4), ints = new Int16Array(after.buffer, after.byteOffset, after.length / 2);
      for (let k = 0; k < floats.length; k++) if (Math.abs(floats[k] - Math.max(ints[k] / 32767, -1)) > ROTATION_MAX_ERROR) return `접근자 #${i} 회전 오차 초과`;
      continue;
    }
    if (x.componentType !== y.componentType || !!x.normalized !== !!y.normalized) return `접근자 #${i} 컴포넌트 불일치`;
    const triangles = view.extensions?.EXT_meshopt_compression?.mode === 'TRIANGLES';
    if (triangles ? !sameTriangles(before, after, COMPONENT_BYTES[x.componentType]) : !sameBytes(before, after)) return `접근자 #${i} 데이터 불일치`;
  }
  for (let i = 0; i < (a.images || []).length; i++) {
    const [x, y] = [a.images[i], b.images[i]];
    if (x.bufferView === undefined) continue;
    const [vx, vy] = [a.bufferViews[x.bufferView], b.bufferViews[y.bufferView]];
    if (!sameBytes(binA.subarray(vx.byteOffset || 0, (vx.byteOffset || 0) + vx.byteLength), binB.subarray(vy.byteOffset || 0, (vy.byteOffset || 0) + vy.byteLength))) return `이미지 #${i} 바이트 불일치`;
  }
  return null;
}
