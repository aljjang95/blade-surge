import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { stripImages } from '../tools/art/ranger-runtime-loader.mjs';
import { FINISH_ALPHA_CUTOFF, FINISH_METALNESS_MAX, finishMaterial, validateGLB } from '../tools/art/finish-library-materials.mjs';
import { LIBRARY_SKIN_METALNESS_MAX, normalizeLibrarySkinMaterial } from '../src/engine/assets.js';
import ROGUE_V2 from '../src/data/rogue-library-revision-v2.json';
import ROGUE_AXIS_V1 from '../src/data/rogue-library-revision-v1.json';
import RANGER_V2 from '../src/data/ranger-library-revision-v2.json';
import RANGER_V3 from '../src/data/ranger-library-revision-v3.json';

// 재질 마감 CLI(tools/art/finish-library-materials.mjs): 게임 로더 보정과 같은 규칙인지, 잘못된 입력·기존 출력에서 아무것도 쓰지 않는지 실제 프로세스로 확인한다.
const TOOL = new URL('../tools/art/finish-library-materials.mjs', import.meta.url).pathname;
const AXIS_V1 = new URL('../public' + ROGUE_AXIS_V1.output.path, import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'finish-materials-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (...args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

test('마감 규칙은 게임 로더 normalizeLibrarySkinMaterial 과 같은 상수·조건만 쓴다', () => {
  expect(FINISH_METALNESS_MAX).toBe(LIBRARY_SKIN_METALNESS_MAX); expect(FINISH_ALPHA_CUTOFF).toBe(.5);
  const tex = { baseColorTexture: { index: 2 } };
  expect(finishMaterial({ name: 'a', alphaMode: 'BLEND', pbrMetallicRoughness: tex })).toEqual({ material: { name: 'a', alphaMode: 'MASK', alphaCutoff: .5, pbrMetallicRoughness: { ...tex, metallicFactor: .22 } },
    changed: ['pbrMetallicRoughness.metallicFactor', 'alphaMode', 'alphaCutoff'] });
  // 반투명(알파<1) BLEND 는 그대로, 이미 낮은 금속도·높은 cutoff 는 유지, pbr 이 없으면 glTF 기본 금속도 1 을 상한으로 내린다.
  expect(finishMaterial({ alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, .5], metallicFactor: .1 } }).changed).toEqual([]);
  expect(finishMaterial({ alphaMode: 'BLEND', alphaCutoff: .7, pbrMetallicRoughness: { metallicFactor: .1 } })).toEqual({ material: { alphaMode: 'MASK', alphaCutoff: .7, pbrMetallicRoughness: { metallicFactor: .1 } }, changed: ['alphaMode'] });
  expect(finishMaterial({ name: 'b' })).toEqual({ material: { name: 'b', pbrMetallicRoughness: { metallicFactor: .22 } }, changed: ['pbrMetallicRoughness.metallicFactor'] });
  expect(finishMaterial({ name: 'c', alphaMode: 'MASK', pbrMetallicRoughness: { metallicFactor: 0 } }).changed).toEqual([]);
});

test('마감본은 three 로더가 읽은 그대로 런타임 보정 결과와 같고, 보정을 거친 게임 재질 상태는 이전 버전과 같다', async () => {
  const skin = async (path: string) => {
    const gltf = await new GLTFLoader().parseAsync(stripImages(readFileSync(new URL('../public' + path, import.meta.url))), '');
    let found: any = null; gltf.scene.traverse((o: any) => { if (o.isSkinnedMesh) found = o.material; }); return found;
  };
  const state = (m: any) => ({ metalness: m.metalness, transparent: m.transparent, depthWrite: m.depthWrite, alphaTest: m.alphaTest, opacity: m.opacity });
  for (const [before, after] of [[RANGER_V2.output.path, RANGER_V3.output.path], [ROGUE_AXIS_V1.output.path, ROGUE_V2.output.path]]) {
    const old = await skin(before), raw = await skin(after), loaded = state(raw);
    expect(state(old)).toMatchObject({ metalness: 1, transparent: true });   // 이전 파일은 런타임 보정에 기대고 있었다
    expect(loaded).toEqual({ metalness: .22, transparent: false, depthWrite: true, alphaTest: .5, opacity: 1 });
    expect(state(normalizeLibrarySkinMaterial(raw))).toEqual(loaded);
    expect(state(normalizeLibrarySkinMaterial(old))).toEqual(loaded);
  }
});

test('CLI 는 명시한 입력·출력으로 커밋된 도적 v2 와 같은 바이트를 쓰고, 같은 출력에 다시 쓰지 않는다', () => {
  const out = join(dir, 'rogue.glb'), ok = run(AXIS_V1, out, ROGUE_V2.id);
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ sha256: ROGUE_V2.output.sha256, inputSha256: ROGUE_AXIS_V1.output.sha256, revision: ROGUE_V2.id });
  expect(readFileSync(out).equals(readFileSync(new URL('../public' + ROGUE_V2.output.path, import.meta.url)))).toBe(true);
  writeFileSync(join(dir, 'keep.glb'), 'previous');
  const again = run(AXIS_V1, join(dir, 'keep.glb'), ROGUE_V2.id);
  expect(again.status).toBe(1); expect(again.stderr).toContain('refusing to overwrite');
  expect(readFileSync(join(dir, 'keep.glb'), 'utf8')).toBe('previous');
  // 이미 마감된 파일을 다시 마감하지 않는다(출처 사슬이 겹치지 않게).
  const twice = run(out, join(dir, 'twice.glb'), 'rogue-library-v3');
  expect(twice.status).toBe(1); expect(twice.stderr).toContain('already material-finished'); expect(existsSync(join(dir, 'twice.glb'))).toBe(false);
  expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
});

test('잘못된 입력·인자는 이유와 함께 실패하고 출력 파일을 만들지 않는다', () => {
  const good = readFileSync(AXIS_V1);
  const cases: Array<[string, Buffer, string]> = [
    ['text.glb', Buffer.from('not a glb at all, just text bytes'), 'bad magic'],
    ['truncated.glb', good.subarray(0, good.length - 4), 'header length'],
    ['json-only.glb', (() => { const n = good.readUInt32LE(12), b = Buffer.from(good.subarray(0, 20 + n + 8)); b.writeUInt32LE(b.length, 8); return b; })(), 'BIN chunk'],
    ['bad-json.glb', (() => { const b = Buffer.from(good); b.write('}', 20); return b; })(), 'does not parse'],
  ];
  for (const [name, bytes, reason] of cases) {
    writeFileSync(join(dir, name), bytes);
    expect(() => validateGLB(bytes)).toThrow(reason);
    const out = join(dir, 'out-' + name), r = run(join(dir, name), out, 'rogue-library-v2');
    expect(r.status).toBe(1); expect(r.stderr).toContain(reason); expect(existsSync(out)).toBe(false);
  }
  for (const args of [[AXIS_V1, join(dir, 'x.glb')], [AXIS_V1, join(dir, 'x.glb'), 'Not A Revision'], [AXIS_V1, AXIS_V1, 'rogue-library-v2']]) {
    const r = run(...args); expect(r.status).toBe(1); expect(existsSync(join(dir, 'x.glb'))).toBe(false);
  }
  expect(readFileSync(AXIS_V1).equals(good)).toBe(true);
});
