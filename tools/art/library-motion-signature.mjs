// 라이브러리 몸체 GLB 의 '동작 서명': 메시·재질·텍스처를 뺀 골격·스킨 역바인드·애니메이션 바이트의 SHA-256.
// 몸만 바꾼 후속 개정(예: 궁수 ranger-library-v5 = v4 골격·클립 + 새 Tripo 몸)이 클립 원본과 같은 동작을 싣는지 증명한다.
// 포함: 모든 노드의 이름·TRS·행렬·자식(이름)·스킨 여부, 스킨 관절 이름 순서·skeleton·역바인드 행렬 바이트,
//       모든 클립의 이름·채널(대상 노드 이름·경로)·보간·입력/출력 접근자 형식과 바이트.
//   node tools/art/library-motion-signature.mjs <a.glb> [b.glb ...]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function parts(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const len = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + len).toString());
  const at = 20 + len, bin = bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at));
  return { json, bin };
}

function accessorBytes(json, bin, index) {
  const acc = json.accessors[index];
  if (acc.sparse) throw new Error('sparse accessor is not supported');
  const view = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type], size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const elem = comps * size, stride = view.byteStride || elem, start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = Buffer.alloc(acc.count * elem);
  for (let i = 0; i < acc.count; i++) bin.copy(out, i * elem, start + i * stride, start + i * stride + elem);
  return { type: acc.type, componentType: acc.componentType, count: acc.count, normalized: !!acc.normalized, sha256: createHash('sha256').update(out).digest('hex') };
}

/** GLB 바이트 → { signature, nodes, joints, clips } (signature 는 64자 hex). */
export function libraryMotionSignature(bytes) {
  const { json, bin } = parts(bytes), name = (i) => json.nodes[i].name;
  const nodes = json.nodes.map((n) => ({ name: n.name, translation: n.translation ?? null, rotation: n.rotation ?? null, scale: n.scale ?? null,
    matrix: n.matrix ?? null, children: (n.children || []).map(name), skinned: n.skin != null }));
  const skins = (json.skins || []).map((s) => ({ joints: s.joints.map(name), skeleton: s.skeleton != null ? name(s.skeleton) : null,
    inverseBindMatrices: s.inverseBindMatrices != null ? accessorBytes(json, bin, s.inverseBindMatrices) : null }));
  const animations = (json.animations || []).map((a) => ({ name: a.name, channels: a.channels.map((c) => {
    const s = a.samplers[c.sampler];
    return { node: name(c.target.node), path: c.target.path, interpolation: s.interpolation || 'LINEAR', input: accessorBytes(json, bin, s.input), output: accessorBytes(json, bin, s.output) };
  }) }));
  const canonical = JSON.stringify({ schema: 'blade-surge.library-motion-signature.v1', nodes, skins, animations });
  return { signature: createHash('sha256').update(canonical).digest('hex'), nodes: nodes.length, joints: skins[0]?.joints.length ?? 0, clips: animations.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const path of process.argv.slice(2)) console.log(JSON.stringify({ path, ...libraryMotionSignature(fs.readFileSync(path)) }));
}
