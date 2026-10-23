import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';

// blade-art#t3: 마법사 2·3단계(회색 피부)·야만전사 2단계(어두운 얼굴)를 Tripo 재생성 몸으로 바꿨다.
// 세 몸은 1단계 골격·클립을 공유하는 메시 전용 파일이므로, 1단계와 같은 관절 이름·순서와 정상 가중치를 가져야 한다.
const read = (id: string) => {
  const bytes = readFileSync(new URL(`../asset-library/normalized/${id}.glb`, import.meta.url));
  const len = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + len).toString());
  return { bytes, json, bin: bytes.subarray(20 + len + 8) };
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const CASES = [['hero_mage_t2', 'hero_mage_t1'], ['hero_mage_t3', 'hero_mage_t1'], ['hero_barbarian_t2', 'hero_barbarian_t1']] as const;

for (const [id, baseId] of CASES) test(`${id} 는 ${baseId} 골격에 재결합된 메시 전용 몸이고 가중치가 정상이다`, () => {
  const body = read(id), base = read(baseId), entry = (manifest as any).assets.find((a: any) => a.id === id);
  expect(sha(body.bytes)).toBe(entry.sha256);
  expect(body.bytes.length).toBe(entry.bytes);
  const names = (g: any) => g.skins[0].joints.map((n: number) => g.nodes[n].name);
  expect(names(body.json)).toEqual(names(base.json));
  expect(body.json.animations ?? []).toEqual([]);
  const rebind = body.json.asset.extras.bodyRebind;
  expect(rebind).toMatchObject({ method: 'rotation-only-bind-pose', baseSha256: sha(base.bytes), clips: 'none' });
  expect(entry.provenance.rawSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(entry.provenance.previousSha256).toMatch(/^[0-9a-f]{64}$/);
  const joints = body.json.skins[0].joints.length;
  for (const p of body.json.meshes.flatMap((m: any) => m.primitives)) {
    const ja = body.json.accessors[p.attributes.JOINTS_0], wa = body.json.accessors[p.attributes.WEIGHTS_0];
    const jv = body.json.bufferViews[ja.bufferView], wv = body.json.bufferViews[wa.bufferView];
    expect([ja.componentType, wa.componentType]).toEqual([5123, 5126]);
    for (let i = 0; i < wa.count; i++) {
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        const w = body.bin.readFloatLE((wv.byteOffset || 0) + (wa.byteOffset || 0) + i * 16 + c * 4);
        const j = body.bin.readUInt16LE((jv.byteOffset || 0) + (ja.byteOffset || 0) + i * 8 + c * 2);
        if (w > 0) expect(j).toBeLessThan(joints);
        sum += w;
      }
      if (Math.abs(sum - 1) > 1e-4) throw new Error(`${id} vertex ${i} weight sum ${sum}`);
    }
  }
});
