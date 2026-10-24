import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { readGlb } from '../tools/art/fit-leg-rest.mjs';

// 기사 2·3단계 몸(t6 다리 rest 맞춤): 정점·가중치는 그대로이고 다리 역바인드만 고쳤다.
// 1단계 골격에 다시 묶이는 몸이므로 다리 밖 관절의 역바인드는 1단계와 같아야 하고, 발 정점은 bind 자세에서 바닥(0)에 닿아야 한다.
const LEG = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase|ToeEnd)$/;
const bare = (name: string) => name.replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');

function skinData(path: string) {
  const bytes = readFileSync(path), { json, bin } = readGlb(bytes);
  const skin = json.skins[0], prim = json.meshes[0].primitives[0];
  const floats = (index: number) => {
    const acc = json.accessors[index], view = json.bufferViews[acc.bufferView];
    const n = acc.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as any)[acc.type];
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    return Float32Array.from({ length: n }, (_, i) => bin.readFloatLE(start + i * 4));
  };
  return { bytes, names: skin.joints.map((j: number) => bare(json.nodes[j].name)), inverses: floats(skin.inverseBindMatrices), position: floats(prim.attributes.POSITION), json, bin, prim };
}

test('기사 2·3단계: 다리 밖 역바인드는 1단계와 같고, 다리 역바인드만 바뀌었다', () => {
  const t1 = skinData('asset-library/normalized/hero_knight_t1.glb');
  for (const id of ['hero_knight_t2', 'hero_knight_t3']) {
    const body = skinData(`asset-library/normalized/${id}.glb`);
    expect(body.names).toEqual(t1.names);
    let legChanged = 0;
    body.names.forEach((name: string, k: number) => {
      const a = body.inverses.subarray(k * 16, k * 16 + 16), b = t1.inverses.subarray(k * 16, k * 16 + 16);
      const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
      if (LEG.test(name)) { if (!same) legChanged++; } else expect(same, `${id} ${name}`).toBe(true);
    });
    expect(legChanged).toBe(10);
  }
});

test('기사 2·3단계: bind 자세(1단계 골격 rest)에서 발 정점이 바닥에 닿고 발목 rest 높이가 1단계와 같다', () => {
  for (const id of ['hero_knight_t2', 'hero_knight_t3']) {
    const { json, bin, prim, names, inverses, position } = skinData(`asset-library/normalized/${id}.glb`);
    const jointsAcc = json.accessors[prim.attributes.JOINTS_0], weightsAcc = json.accessors[prim.attributes.WEIGHTS_0];
    expect(jointsAcc.componentType === 5121 || jointsAcc.componentType === 5123).toBe(true);
    const jv = json.bufferViews[jointsAcc.bufferView], wv = json.bufferViews[weightsAcc.bufferView];
    const js = (jv.byteOffset || 0) + (jointsAcc.byteOffset || 0), jsz = jointsAcc.componentType === 5121 ? 1 : 2, jstride = jv.byteStride || 4 * jsz;
    const ws = (wv.byteOffset || 0) + (weightsAcc.byteOffset || 0), wstride = wv.byteStride || 16;
    expect(weightsAcc.componentType).toBe(5126);
    // 골격 rest = 1단계 역바인드의 역행렬(2·3단계 원래 역바인드와 같음, 위 테스트)
    const t1 = skinData('asset-library/normalized/hero_knight_t1.glb');
    const skinMats = names.map((_: string, k: number) => new THREE.Matrix4().fromArray(t1.inverses, k * 16).invert().multiply(new THREE.Matrix4().fromArray(inverses, k * 16)));
    const foot = new Set(names.map((n: string, k: number) => /(Foot|ToeBase|ToeEnd)$/.test(n) ? k : -1).filter((k: number) => k >= 0));
    let footMin = Infinity, v = new THREE.Vector3(), out = new THREE.Vector3();
    for (let i = 0; i < position.length / 3; i++) {
      out.set(0, 0, 0); let footW = 0;
      for (let c = 0; c < 4; c++) {
        const j = jsz === 1 ? bin.readUInt8(js + i * jstride + c) : bin.readUInt16LE(js + i * jstride + c * 2), w = bin.readFloatLE(ws + i * wstride + c * 4);
        if (!w) continue;
        if (foot.has(j)) footW += w;
        out.addScaledVector(v.set(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]).applyMatrix4(skinMats[j]), w);
      }
      if (footW > 0.5) footMin = Math.min(footMin, out.y);
    }
    expect(Math.abs(footMin), `${id} sole`).toBeLessThan(0.01);
    const k = names.indexOf('RightFoot');
    const restAnkle = new THREE.Matrix4().fromArray(inverses, k * 16).invert().elements[13];
    let floor = Infinity; for (let i = 1; i < position.length; i += 3) floor = Math.min(floor, position[i]);
    expect(restAnkle - floor).toBeCloseTo(0.1633, 3);
  }
});
