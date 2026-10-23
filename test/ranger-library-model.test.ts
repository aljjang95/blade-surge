import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installRangerRuntimeLoader, stripImages } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, poseRangerBowString, applyLibraryHeroBody, disposeCharacter, bowStringTriangles } from '../src/engine/assets.js';
import { libraryAssetForHero, resolveAssetSource, revisedLibraryFile, rangerLibraryRevision } from '../src/engine/library-assets.js';
import { attackPhase } from '../src/game/combat-motion.js';
import { HEROES } from '../src/data/heroes.js';
import { RANGER_HEAD_LIFT } from '../src/game/player.js';
import manifest from '../asset-library/manifest.json';
import { finishLibraryGLB } from '../tools/art/finish-library-materials.mjs';
import REV_V1 from '../src/data/ranger-library-revision-v1.json';
import REV_V2 from '../src/data/ranger-library-revision-v2.json';
import REV_V3 from '../src/data/ranger-library-revision-v3.json';

// 궁수 라이브러리 교정본(ranger-library-v1): 실제 GLB 를 실제 loadHeroModel 경로로 받아 손·활·시위 좌표를 잰다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());

const REV = rangerLibraryRevision();
const sha = (path: string) => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const glbJson = (path: string) => { const b = readFileSync(new URL(path, import.meta.url)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };
const parse = (path: string) => new GLTFLoader().parseAsync(stripImages(readFileSync(new URL(path, import.meta.url))), '');
const v = () => new THREE.Vector3(), q = () => new THREE.Quaternion();
// 재질 마감(library-skin-finish-v1)은 이 세 필드만 바꾼다. 나머지 재질 필드·텍스처 참조는 원본 그대로여야 한다.
const finished = (m: any) => ({ ...m, alphaMode: 'MASK', alphaCutoff: .5, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, metallicFactor: .22 } });
function glbParts(bytes: Buffer) { const len = bytes.readUInt32LE(12); return { json: JSON.parse(bytes.subarray(20, 20 + len).toString()), binChunk: bytes.subarray(20 + len) }; }
function glbBytes(json: any, binChunk: Buffer) {
  const text = Buffer.from(JSON.stringify(json)), pad = Buffer.alloc((4 - text.length % 4) % 4, 0x20), h = Buffer.alloc(20);
  h.write('glTF'); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + text.length + pad.length + binChunk.length, 8); h.writeUInt32LE(text.length + pad.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([h, text, pad, binChunk]);
}

test('교정본은 원본 SHA 에서 생성된 정확한 파일이며 원본 GLB·manifest 는 그대로다', () => {
  const asset = manifest.assets.find((a: any) => a.id === 'hero_ranger_t1')!;
  expect(sha('../asset-library/normalized/hero_ranger_t1.glb')).toBe(asset.sha256);
  expect(REV.source.sha256).toBe(asset.sha256);
  expect(sha('../public' + REV.output.path)).toBe(REV.output.sha256);
  expect(resolveAssetSource(asset)).toBe(REV.output.path);
  expect(() => revisedLibraryFile({ ...asset, sha256: 'f'.repeat(64) } as any)).toThrow('exact generated file');
  expect(revisedLibraryFile(manifest.assets.find((a: any) => a.id === 'hero_ranger_t2') as any, REV)).toBeNull();
});

test('메시·스킨·역바인드는 원본 바이트 그대로이고 관절 rest 가 같으며 클립·소켓만 바뀐다', () => {
  const a = glbJson('../asset-library/normalized/hero_ranger_t1.glb'), b = glbJson('../public' + REV.output.path);
  expect(b.meshes).toEqual(a.meshes.map((m: any) => ({ ...m, primitives: m.primitives.map((p: any) => ({ ...p, attributes: expect.any(Object), indices: expect.any(Number) })) })));
  // 원본은 금속도 기본(1)·BLEND 였고, 채택본은 마감 규칙 세 필드만 다르다.
  expect(a.materials.every((m: any) => m.alphaMode === 'BLEND' && m.pbrMetallicRoughness.metallicFactor === undefined)).toBe(true);
  expect(b.materials).toEqual(a.materials.map(finished)); expect(b.images).toEqual(a.images.map((i: any) => ({ ...i, bufferView: expect.any(Number) })));
  for (const node of a.nodes) {
    const o = b.nodes.find((n: any) => n.name === node.name);
    for (const k of ['translation', 'rotation']) if (node[k]) node[k].forEach((x: number, i: number) => expect(Math.abs(o[k][i] - x)).toBeLessThan(.01));
  }
  const names = b.animations.map((c: any) => c.name).sort();
  expect(names).toEqual([...Object.keys(asset().clips), 'Dodge_Backward', 'bow_shoot_rapid'].sort());
  for (const [name, seconds] of Object.entries(REV.clips)) {
    const clip = b.animations.find((c: any) => c.name === name);
    expect(Math.max(...clip.samplers.map((s: any) => b.accessors[s.input].max[0]))).toBeCloseTo(seconds as number, 3);
  }
  const node = (n: string) => b.nodes.findIndex((x: any) => x.name === n);
  expect(b.nodes[node('mixamorig:LeftHand')].children).toContain(node('RangerBowGrip_L'));
  expect(b.nodes[node('mixamorig:RightHand')].children).toContain(node('RangerDrawNock_R'));
  function asset() { return manifest.assets.find((x: any) => x.id === 'hero_ranger_t1')!; }
});

test('v3 는 PC Blender 5.2.2 패킹본(a8fea05…)에 재질 마감만 더한 정확한 파일이고, v1·v2 파일과 기록은 그대로다', () => {
  for (const rev of [REV_V1, REV_V2, REV_V3]) expect(sha('../public' + rev.output.path)).toBe(rev.output.sha256);
  expect(REV_V3.id).toBe('ranger-library-v3'); expect(REV_V3.supersedes).toBe(REV_V2.id); expect(REV_V3.license).toBe(REV_V2.license);
  expect(REV_V3.materialFinish.inputSha256).toBe(REV_V3.authoring.packedSha256);
  const bytes = readFileSync(new URL('../public' + REV_V3.output.path, import.meta.url)), { json, binChunk } = glbParts(bytes);
  // 저작 출처(v2 레시피·5.2.40 내보내기·실행 당시 스크립트 이름)와 마감 출처가 따로 남는다.
  expect(json.asset.extras).toEqual({ rangerLibraryRevision: 'ranger-library-v2', sourceSha256: REV_V3.source.sha256,
    authoring: 'Blender Khronos glTF Blender I/O v5.2.40 / LOCAL-AUTHOR-BLENDER52.py', packer: 'tools/art/pack-ranger-library.mjs',
    materialFinish: { revision: REV_V3.id, recipe: 'library-skin-finish-v1', tool: 'tools/art/finish-library-materials.mjs', inputSha256: REV_V3.authoring.packedSha256, metallicFactorMax: .22, opaqueBlendAlphaCutoff: .5 } });
  // 마감을 되돌리면 PC 패킹 로그의 SHA 가 그대로 나오고, 그 입력을 다시 마감하면 같은 바이트가 나온다.
  const raw = structuredClone(json); raw.materials = glbJson('../public' + REV_V2.output.path).materials; delete raw.asset.extras.materialFinish;
  const packed = glbBytes(raw, binChunk);
  expect(createHash('sha256').update(packed).digest('hex')).toBe(REV_V3.authoring.packedSha256);
  expect(finishLibraryGLB(packed, REV_V3.id).output.equals(bytes)).toBe(true);
});

test('v3 의 5.2 재저작 클립은 v2 와 채널·키 시간이 같고 회전 차 0.1° 이내이며, 메시·스킨·텍스처 바이트는 v2 와 같다', () => {
  const read = (path: string) => { const b = readFileSync(new URL(path, import.meta.url)), p = glbParts(b); return { j: p.json, bin: p.binChunk.subarray(8) }; };
  const a = read('../public' + REV_V2.output.path), b = read('../public' + REV_V3.output.path);
  const view = (g: any, i: number) => { const x = g.j.bufferViews[i]; return g.bin.subarray(x.byteOffset || 0, (x.byteOffset || 0) + x.byteLength); };
  const floats = (g: any, i: number) => { const acc = g.j.accessors[i], raw = view(g, acc.bufferView); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
  const kept = (g: any) => [...g.j.meshes.flatMap((m: any) => m.primitives.flatMap((p: any) => [...Object.values(p.attributes), p.indices])).map((i: any) => g.j.accessors[i].bufferView),
    ...g.j.skins.map((s: any) => g.j.accessors[s.inverseBindMatrices].bufferView), ...g.j.images.map((i: any) => i.bufferView)];
  const ka = kept(a), kb = kept(b); expect(kb.length).toBe(ka.length);
  ka.forEach((index: number, k: number) => expect(view(b, kb[k]).equals(view(a, index))).toBe(true));
  expect(b.j.animations.map((c: any) => c.name)).toEqual(a.j.animations.map((c: any) => c.name));
  let maxDeg = 0, maxMove = 0;
  for (const ca of a.j.animations) {
    const cb = b.j.animations.find((c: any) => c.name === ca.name); expect(cb.channels.length).toBe(ca.channels.length);
    for (const ch of ca.channels) {
      const chb = cb.channels.find((c: any) => c.target.node === ch.target.node && c.target.path === ch.target.path); expect(chb).toBeDefined();
      const sa = ca.samplers[ch.sampler], sb = cb.samplers[chb.sampler];
      expect(floats(b, sb.input)).toEqual(floats(a, sa.input));
      const oa = floats(a, sa.output), ob = floats(b, sb.output); expect(ob.length).toBe(oa.length);
      if (ch.target.path === 'rotation') for (let i = 0; i < oa.length; i += 4) {
        const dot = Math.abs(oa[i] * ob[i] + oa[i + 1] * ob[i + 1] + oa[i + 2] * ob[i + 2] + oa[i + 3] * ob[i + 3]);
        maxDeg = Math.max(maxDeg, THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, dot))));
      } else for (let i = 0; i < oa.length; i++) maxMove = Math.max(maxMove, Math.abs(oa[i] - ob[i]));
    }
  }
  // 실측 0.065°·5e-5(원본 cm 단위). 재저작이 v2 동작을 바꾸지 않았다는 계약이다.
  expect(maxDeg).toBeLessThan(.1); expect(maxMove).toBeLessThan(1e-3);
});

// ---- v4: 사망 활 접촉 교정(저작 v3, art-src/ranger/author_ranger_library_v3.py). 실제 접촉 측정은 test/ranger-death-contact.test.ts ----
test('v4 는 PC Blender 5.2.2 저작 v3 패킹본에 재질 마감만 더한 정확한 파일이고, 출처가 실제 저작 스크립트와 이어진다', () => {
  for (const rev of [REV_V1, REV_V2, REV_V3]) expect(sha('../public' + rev.output.path)).toBe(rev.output.sha256);
  expect(REV.id).toBe('ranger-library-v4'); expect(REV.supersedes).toBe(REV_V3.id);
  for (const k of ['asset', 'source', 'axisReference', 'sockets', 'bow', 'license'] as const) expect(REV[k]).toEqual(REV_V3[k]);
  expect(REV.authoring.script).toBe('art-src/ranger/author_ranger_library_v3.py');
  expect(sha('../' + REV.authoring.script)).toBe(REV.authoring.scriptSha256);
  expect(REV.authoring.blender).toMatch(/^5\.2\.2/);
  expect(REV.materialFinish.inputSha256).toBe(REV.authoring.packedSha256);
  const bytes = readFileSync(new URL('../public' + REV.output.path, import.meta.url)), { json, binChunk } = glbParts(bytes);
  // 패커에 준 revision·저작 스크립트 경로와 5.2 내보내기 이름이 그대로 남는다(클라우드 4.3 미리보기는 여기서 걸러진다).
  expect(REV.authoring.packedAuthoringExtra).toMatch(/^Blender Khronos glTF Blender I\/O v5\.2\.\d+ \/ art-src\/ranger\/author_ranger_library_v3\.py$/);
  expect(json.asset.extras).toEqual({ rangerLibraryRevision: REV.id, sourceSha256: REV.source.sha256, authoring: REV.authoring.packedAuthoringExtra,
    packer: 'tools/art/pack-ranger-library.mjs',
    materialFinish: { revision: REV.id, recipe: 'library-skin-finish-v1', tool: 'tools/art/finish-library-materials.mjs', inputSha256: REV.authoring.packedSha256, metallicFactorMax: .22, opaqueBlendAlphaCutoff: .5 } });
  const raw = structuredClone(json); raw.materials = glbJson('../public' + REV_V2.output.path).materials; delete raw.asset.extras.materialFinish;
  const packed = glbBytes(raw, binChunk);
  expect(createHash('sha256').update(packed).digest('hex')).toBe(REV.authoring.packedSha256);
  expect(finishLibraryGLB(packed, REV.id).output.equals(bytes)).toBe(true);
});

test('v4 는 v3 와 메시·스킨·텍스처·재질·노드가 같고, 사망 외 10개 클립은 비트 동일, 사망은 0.75초까지 비트 동일하고 그 뒤 왼팔 회전·골반 높이만 다르다', () => {
  const read = (path: string) => { const b = readFileSync(new URL(path, import.meta.url)), p = glbParts(b); return { j: p.json, bin: p.binChunk.subarray(8) }; };
  const a = read('../public' + REV_V3.output.path), b = read('../public' + REV.output.path);
  const view = (g: any, i: number) => { const x = g.j.bufferViews[i]; return g.bin.subarray(x.byteOffset || 0, (x.byteOffset || 0) + x.byteLength); };
  const floats = (g: any, i: number) => { const acc = g.j.accessors[i], raw = view(g, acc.bufferView); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
  const kept = (g: any) => [...g.j.meshes.flatMap((m: any) => m.primitives.flatMap((p: any) => [...Object.values(p.attributes), p.indices])).map((i: any) => g.j.accessors[i].bufferView),
    ...g.j.skins.map((s: any) => g.j.accessors[s.inverseBindMatrices].bufferView), ...g.j.images.map((i: any) => i.bufferView)];
  const ka = kept(a), kb = kept(b); expect(kb.length).toBe(ka.length);
  ka.forEach((index: number, k: number) => expect(view(b, kb[k]).equals(view(a, index))).toBe(true));
  for (const k of ['skins', 'meshes', 'materials', 'textures', 'images', 'samplers', 'scenes']) expect(b.j[k]).toEqual(a.j[k]);
  // 관절·메시 노드는 그대로, Blender 가 내보내는 두 소켓(그립·노크)은 같은 정의라 TRS 성분 1e-4(손 본 로컬 단위) 이내만 허용한다.
  const SOCKETS = ['RangerBowGrip_L', 'RangerDrawNock_R'];
  expect(b.j.nodes.length).toBe(a.j.nodes.length);
  a.j.nodes.forEach((node: any, i: number) => {
    const o = b.j.nodes[i];
    if (!SOCKETS.includes(node.name)) { expect(o).toEqual(node); return; }
    expect(Object.keys(o).sort()).toEqual(Object.keys(node).sort()); expect(o.name).toBe(node.name);
    for (const k of ['translation', 'rotation', 'scale']) if (node[k]) node[k].forEach((x: number, c: number) => expect(Math.abs(o[k][c] - x)).toBeLessThan(1e-4));
  });
  expect(b.j.animations.map((c: any) => c.name)).toEqual(a.j.animations.map((c: any) => c.name));
  const changed = new Set<string>();
  for (const ca of a.j.animations) {
    const cb = b.j.animations.find((c: any) => c.name === ca.name); expect(cb.channels.length).toBe(ca.channels.length);
    for (const ch of ca.channels) {
      const chb = cb.channels.find((c: any) => c.target.node === ch.target.node && c.target.path === ch.target.path); expect(chb).toBeDefined();
      const sa = ca.samplers[ch.sampler], sb = cb.samplers[chb.sampler], times = floats(a, sa.input);
      expect(floats(b, sb.input)).toEqual(times);
      const oa = floats(a, sa.output), ob = floats(b, sb.output), w = oa.length / times.length;
      if (ca.name !== 'death') { expect(sb.interpolation).toBe(sa.interpolation); expect(Buffer.from(ob.buffer).equals(Buffer.from(oa.buffer))).toBe(true); continue; }
      // 사망: 쓰러지는 동안(0–18f)은 비트 동일. 그 뒤는 저작 변경(차 > 1e-4)과 내보내기 행렬 분해 잡음(실측 회전 6e-8 · 이동 6e-6 원본 단위 · 배율 3e-7)을 나눈다.
      // 배율 채널은 리그에 배율 동작이 없어 1 로 고정되며, 잡음 때문에 2키 STEP/LINEAR 선택만 달라질 수 있다(v2→v3 에도 있다).
      if (ch.target.path !== 'scale') expect(sb.interpolation).toBe(sa.interpolation);
      else for (const x of [...oa, ...ob]) expect(Math.abs(x - 1)).toBeLessThan(1e-5);
      let max = 0;
      for (let k = 0; k < times.length; k++) for (let c = 0; c < w; c++) {
        const d = Math.abs(ob[k * w + c] - oa[k * w + c]);
        if (times[k] <= .75 && ch.target.path !== 'scale') expect(d).toBe(0);
        max = Math.max(max, d);
      }
      if (max > 1e-4) changed.add(a.j.nodes[ch.target.node].name + '.' + ch.target.path);
    }
  }
  // 정착 보정은 왼팔 IK 사슬(위팔·아래팔)과 손 회전만 바꾸고, 골반 이동은 그 결과에 대한 실제 스킨 접지 재계산이다(런타임 몸 본 차 ≤3mm 는 접촉 테스트).
  expect([...changed].sort()).toEqual(['mixamorig:Hips.translation', 'mixamorig:LeftArm.rotation', 'mixamorig:LeftForeArm.rotation', 'mixamorig:LeftHand.rotation']);
});

async function ranger() {
  const gltf = await loadHeroModel('ranger', 1);
  expect(gltf.scene.userData.libraryAsset?.id).toBe('hero_ranger_t1');
  return spawnCharacter(gltf);
}
function pose(inst: any, name: string, time: number, drawing = false) {
  inst.mixer.stopAllAction();
  const action = inst.mixer.clipAction(inst.clips[name]); action.reset(); action.play(); action.time = time; inst.mixer.update(0);
  inst.root.updateMatrixWorld(true);
  const held = poseRangerBowString(inst.root, drawing); inst.root.updateMatrixWorld(true);
  return held;
}
const nodes = (inst: any) => ({ bow: inst.root.getObjectByName('Bow'), grip: inst.root.getObjectByName('RangerBowGrip_L'), nock: inst.root.getObjectByName('RangerDrawNock_R'),
  left: inst.root.getObjectByName('mixamorigLeftHand'), head: inst.root.getObjectByName('mixamorigHead'), upper: inst.root.getObjectByName('Bow_String_Upper') });

test('원인 재현: 원본 클립은 대기 자세에서 왼손(활 손)이 머리 위로 솟는다', async () => {
  const gltf = await parse('../asset-library/normalized/hero_ranger_t1.glb'), mixer = new THREE.AnimationMixer(gltf.scene);
  const idle = gltf.animations.find((c) => c.name === 'idle')!; mixer.clipAction(idle).play(); mixer.update(0); gltf.scene.updateMatrixWorld(true);
  const left = gltf.scene.getObjectByName('mixamorigLeftHand')!.getWorldPosition(v()), head = gltf.scene.getObjectByName('mixamorigHead')!.getWorldPosition(v());
  expect(left.y).toBeGreaterThan(head.y + .2);
});

test('모든 교정 클립에서 활은 저작 그립과 같은 자리·방향이고 대기·달리기의 활 손은 어깨 아래다', async () => {
  const inst = await ranger(), n = nodes(inst);
  for (const name of ['Idle', 'Running_A', 'Dodge_Forward', 'Dodge_Backward', 'Hit_A', 'Death_A', 'Cheer', 'Interact', 'Bow_Shoot']) {
    const clip = inst.clips[name]; expect(clip).toBeDefined();
    for (const k of [0, .2, .4, .6, .8, 1]) {
      pose(inst, name, clip.duration * k);
      // 굽힌 클립의 본 배율 미세 오차(1e-3)로 생기는 0.2° 이내 차이만 허용한다.
      expect(THREE.MathUtils.radToDeg(n.grip.getWorldQuaternion(q()).angleTo(n.bow.getWorldQuaternion(q())))).toBeLessThan(.5);
      expect(n.grip.getWorldPosition(v()).distanceTo(n.bow.getWorldPosition(v()))).toBeLessThan(1e-4);
      if (name === 'Idle' || name === 'Running_A') expect(n.left.getWorldPosition(v()).y).toBeLessThan(n.head.getWorldPosition(v()).y);
    }
  }
  disposeCharacter(inst.root, inst.mixer);
});

test('만작에서 시위는 실제 오른손 노크 소켓에 걸리고 발사 순간(0.42) 뒤에는 쉼 위치로 돌아간다', async () => {
  const inst = await ranger(), n = nodes(inst), clip = inst.clips.Bow_Shoot, hitAt = HEROES.ranger.combo[0].hitAt;
  const end = v();
  for (const t of [.27, .32, .37, .41]) {
    expect(pose(inst, 'Bow_Shoot', attackPhase(t, hitAt) * clip.duration, true)).toBe(true);
    const local = n.bow.worldToLocal(n.nock.getWorldPosition(v()));
    expect(Math.abs(local.y)).toBeLessThan(.02); expect(Math.abs(local.z)).toBeLessThan(.02);
    end.set(0, 1, 0); n.upper.localToWorld(end);
    expect(end.distanceTo(n.nock.getWorldPosition(v()))).toBeLessThan(1e-4);
    // 활 축: 림은 거의 수직, 표적 방향(-x 로컬)은 몸 정면(+Z)
    const bq = n.bow.getWorldQuaternion(q());
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(bq).y).toBeGreaterThan(.9);
    expect(new THREE.Vector3(-1, 0, 0).applyQuaternion(bq).z).toBeGreaterThan(.98);
  }
  const full = (() => { pose(inst, 'Bow_Shoot', attackPhase(.41, hitAt) * clip.duration, true); return n.bow.worldToLocal(n.nock.getWorldPosition(v())).x; })();
  expect(full).toBeGreaterThan(.45);   // 쉼 노크 0.177 에서 실제로 당겨졌다
  for (const t of [.43, .5, .75, 1]) {
    expect(pose(inst, 'Bow_Shoot', attackPhase(t, hitAt) * clip.duration, t < hitAt)).toBe(false);
    end.set(0, 1, 0); n.upper.localToWorld(end);
    expect(n.bow.worldToLocal(end.clone()).distanceTo(new THREE.Vector3(.177, 0, 0))).toBeLessThan(1e-4);
  }
  // 발사 전 상태가 아니면(대기·달리기) 손 위치와 무관하게 쉼 시위
  expect(pose(inst, 'Idle', 0, false)).toBe(false);
  disposeCharacter(inst.root, inst.mixer);
});

test('정적 시위 성분만 떼어 내고 활 몸체 삼각형은 보존한다', async () => {
  const inst = await ranger(), bow = nodes(inst).bow;
  expect(bowStringTriangles(bow.geometry)).toBeNull();
  expect(bow.geometry.index.count / 3).toBe(476 - 56);
  expect(bow.getObjectByName('Bow_String_Upper')).toBeDefined(); expect(bow.getObjectByName('Bow_String_Lower')).toBeDefined();
  disposeCharacter(inst.root, inst.mixer);
});

test('갑옷 2·3단계와 여우 아바타는 1단계 교정 클립과 그립·노크 소켓을 함께 쓴다', async () => {
  const t1 = await loadHeroModel('ranger', 1);
  for (const id of ['hero_ranger_t2', 'hero_ranger_t3', 'avatar_ranger_fox']) {
    const asset = manifest.assets.find((a: any) => a.id === id)!;
    const gltf = await loadHeroAsset(asset);
    expect(gltf.scene.userData.libraryAsset?.id).toBe(id);
    expect(gltf.animations).toBe(t1.animations);
    const inst = spawnCharacter(gltf), n = nodes(inst);
    expect(n.grip && n.nock).toBeTruthy();
    pose(inst, 'Bow_Shoot', .3);
    // 1단계 검사와 같은 허용(굽힌 클립의 0.1° 이내 수치 오차)
    expect(THREE.MathUtils.radToDeg(n.grip.getWorldQuaternion(q()).angleTo(n.bow.getWorldQuaternion(q())))).toBeLessThan(.5);
    disposeCharacter(inst.root, inst.mixer);
  }
  // 같은 인스턴스 몸체 교체(장비 단계): 소켓·시위·클립이 유지된다.
  const inst = await ranger(), before = nodes(inst);
  expect(applyLibraryHeroBody(inst.root, manifest.assets.find((a: any) => a.id === 'hero_ranger_t3'))).toBe(true);
  const after = nodes(inst);
  expect(after.grip).toBe(before.grip); expect(after.bow).toBe(before.bow); expect(after.upper).toBe(before.upper);
  expect(pose(inst, 'Bow_Shoot', attackPhase(.38, .42) * inst.clips.Bow_Shoot.duration, true)).toBe(true);
  disposeCharacter(inst.root, inst.mixer);
  expect(libraryAssetForHero('ranger')?.id).toBe('hero_ranger_t1');
});


// ---- v2 전신 리타깃·접지·백스텝 계약(2026-10-16 사용자 재신고: 몸 꺾임) ----
const bone = (inst: any, n: string) => inst.root.getObjectByName('mixamorig' + n);
const wp = (o: any) => o.getWorldPosition(v());
/** 무릎이 엉덩이–발목 선에서 벗어난 방향: 몸 정면(+Z) 성분과 좌우(X) 성분 */
function kneeBend(inst: any, side: 'Left' | 'Right') {
  const hip = wp(bone(inst, side + 'UpLeg')), knee = wp(bone(inst, side + 'Leg')), ankle = wp(bone(inst, side + 'Foot'));
  const axis = ankle.clone().sub(hip).normalize(), off = knee.clone().sub(hip);
  off.sub(axis.multiplyScalar(off.dot(axis)));
  return { forward: off.z, lateral: Math.abs(off.x), depth: off.length() };
}
function skinMinY(inst: any) {
  let min = Infinity; const p = v();
  inst.root.updateMatrixWorld(true);
  inst.root.traverse((o: any) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}
function hipsFacing(inst: any) {
  const q0 = bone(inst, 'Hips').getWorldQuaternion(q()), rest = bone(inst, 'Hips').userData.restQ as THREE.Quaternion;
  return new THREE.Vector3(1, 0, 0).applyQuaternion(q0.multiply(rest.clone().invert()));
}

test('원인 재현과 교정: 원본 달리기는 무릎이 옆으로 꺾이고, 교정본은 무릎이 몸 정면으로 굽는다', async () => {
  const gltf = await parse('../asset-library/normalized/hero_ranger_t1.glb'), mixer = new THREE.AnimationMixer(gltf.scene);
  const raw = { root: gltf.scene }, run = gltf.animations.find((c) => c.name === 'run')!;
  let rawLateral = 0;
  for (const k of [0, .25, .5, .75]) {
    mixer.stopAllAction(); const a = mixer.clipAction(run); a.reset(); a.play(); a.time = run.duration * k; mixer.update(0); gltf.scene.updateMatrixWorld(true);
    for (const s of ['Left', 'Right'] as const) { const b = kneeBend(raw, s); if (b.depth > .03) rawLateral = Math.max(rawLateral, b.lateral / b.depth); }
  }
  expect(rawLateral).toBeGreaterThan(.6);   // 굽힘의 60% 이상이 옆 방향
  const inst = await ranger();
  for (const k of [0, .25, .5, .75]) {
    pose(inst, 'Running_A', inst.clips.Running_A.duration * k);
    for (const s of ['Left', 'Right'] as const) {
      const b = kneeBend(inst, s);
      if (b.depth > .03) { expect(b.forward).toBeGreaterThan(0); expect(b.lateral / b.depth).toBeLessThan(.45); }
    }
  }
  disposeCharacter(inst.root, inst.mixer);
});

test('실제 스킨 접지: 대기·사격·피격은 발이 지면에, 구르기 중간과 사망 끝 자세는 몸이 지면에 닿는다', async () => {
  const inst = await ranger();
  const at = (name: string, k: number) => { pose(inst, name, inst.clips[name].duration * k); return skinMinY(inst); };
  for (const [name, k] of [['Idle', 0], ['Idle', .5], ['Bow_Shoot', .4], ['Hit_A', .3], ['Dodge_Forward', .5], ['Death_A', 1]] as const) {
    const y = at(name, k);
    expect(Math.abs(y)).toBeLessThan(.03);
  }
  // 공개 v1(5bbc7e7b…)은 쓰러진 뒤 끝까지 0.3m 이상 떠 있었다
  const gltf = await parse('../public/models/heroes-next/ranger-library-t1-v1.glb'), mixer = new THREE.AnimationMixer(gltf.scene);
  const death = gltf.animations.find((c) => c.name === 'death')!; const a = mixer.clipAction(death); a.play();
  for (const k of [.6, .8, 1]) { a.time = death.duration * k; mixer.update(0); expect(skinMinY({ root: gltf.scene })).toBeGreaterThan(.3); }
  // 구르기는 키 사이(48fps 의 반 프레임)에서도 뜨거나 묻히지 않는다
  for (let i = 0; i <= 48; i++) { pose(inst, 'Dodge_Forward', inst.clips.Dodge_Forward.duration * i / 48); expect(Math.abs(skinMinY(inst))).toBeLessThan(.03); }
  disposeCharacter(inst.root, inst.mixer);
});

test('백스텝은 앞구르기의 역재생이 아닌 서 있는 뒤로 뛰기이고, 피격·사망은 대기와 같은 방향에서 시작한다', async () => {
  const inst = await ranger();
  inst.root.traverse((o: any) => { if (o.isBone) o.userData.restQ = o.getWorldQuaternion(q()); });
  const head = (name: string, k: number) => { pose(inst, name, inst.clips[name].duration * k); return wp(bone(inst, 'Head')); };
  let diff = 0;
  for (const k of [.25, .5, .75]) diff = Math.max(diff, head('Dodge_Backward', k).distanceTo(head('Dodge_Forward', 1 - k)));
  expect(diff).toBeGreaterThan(.25);
  for (const k of [0, .25, .5, .75, 1]) {
    pose(inst, 'Dodge_Backward', inst.clips.Dodge_Backward.duration * k);
    expect(wp(bone(inst, 'Head')).y - wp(bone(inst, 'Hips')).y).toBeGreaterThan(.25);   // 머리가 골반 위(구르지 않는다)
  }
  pose(inst, 'Dodge_Backward', inst.clips.Dodge_Backward.duration * .35);
  expect(skinMinY(inst)).toBeGreaterThan(.04);   // 실제로 발이 뜬다
  const yaw = (name: string) => { pose(inst, name, 0); const f = hipsFacing(inst); return Math.atan2(f.z, f.x); };
  const idle = yaw('Idle');
  for (const name of ['Hit_A', 'Death_A', 'Dodge_Forward']) expect(Math.abs(Math.atan2(Math.sin(yaw(name) - idle), Math.cos(yaw(name) - idle)))).toBeLessThan(THREE.MathUtils.degToRad(12));
  disposeCharacter(inst.root, inst.mixer);
});

test('사격: 만작에서 상체는 과녁 쪽으로 비틀리고(왼어깨 전방) 얼굴은 정면, 연속 발사 클립은 세 번 당긴다', async () => {
  const inst = await ranger(), n = nodes(inst), clip = inst.clips.Bow_Shoot;
  pose(inst, 'Bow_Shoot', attackPhase(.38, .42) * clip.duration, true);
  const ls = wp(bone(inst, 'LeftArm')), rs = wp(bone(inst, 'RightArm'));
  const shoulder = ls.clone().sub(rs); shoulder.y = 0; shoulder.normalize();
  expect(shoulder.z).toBeGreaterThan(.55);   // 어깨선이 화살선(+Z) 쪽으로 35° 이상 돌았다
  const rapid = inst.clips.bow_shoot_rapid; expect(rapid).toBeDefined();
  let pulls = 0, wasDrawn = false;
  for (let f = 0; f <= 24; f += .5) {
    pose(inst, 'bow_shoot_rapid', f / 24 * rapid.duration, true);
    const x = n.bow.worldToLocal(n.nock.getWorldPosition(v())).x, drawn = x > .5;
    if (drawn && !wasDrawn) pulls++; wasDrawn = drawn;
  }
  expect(pulls).toBe(3);
  disposeCharacter(inst.root, inst.mixer);
});

test('궁수 전투 머리 보정은 귀 축(z) 피치로 고개만 들고 옆으로 기울이지 않는다', async () => {
  // 출시 GLB 의 머리 뼈 로컬 축(앞 +x, 귀 +z)을 월드에서 읽어, 보정 전후 앞 방향만 30° 위로 돌았는지 확인한다.
  const gltf = await parse('../public' + REV.output.path);
  const head = gltf.scene.getObjectByName('mixamorigHead') as THREE.Bone;
  expect(head?.isBone).toBe(true);
  gltf.scene.updateMatrixWorld(true);
  const axis = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).transformDirection(head.matrixWorld);
  const front = axis(1, 0, 0), side = axis(0, 0, 1);
  head.quaternion.multiply(RANGER_HEAD_LIFT); head.updateMatrixWorld(true);
  expect(axis(0, 0, 1).distanceTo(side)).toBeLessThan(1e-4);
  expect(THREE.MathUtils.radToDeg(front.angleTo(axis(1, 0, 0)))).toBeCloseTo(30, 1);
  expect(axis(1, 0, 0).y).toBeGreaterThan(front.y + .3);
});
