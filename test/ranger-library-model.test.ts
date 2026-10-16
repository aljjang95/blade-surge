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
import manifest from '../asset-library/manifest.json';

// 궁수 라이브러리 교정본(ranger-library-v1): 실제 GLB 를 실제 loadHeroModel 경로로 받아 손·활·시위 좌표를 잰다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());

const REV = rangerLibraryRevision();
const sha = (path: string) => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const glbJson = (path: string) => { const b = readFileSync(new URL(path, import.meta.url)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };
const parse = (path: string) => new GLTFLoader().parseAsync(stripImages(readFileSync(new URL(path, import.meta.url))), '');
const v = () => new THREE.Vector3(), q = () => new THREE.Quaternion();

test('교정본은 원본 SHA 에서 생성된 정확한 파일이며 원본 GLB·manifest 는 그대로다', () => {
  const asset = manifest.assets.find((a: any) => a.id === 'hero_ranger_t1')!;
  expect(sha('../asset-library/normalized/hero_ranger_t1.glb')).toBe(asset.sha256);
  expect(REV.source.sha256).toBe(asset.sha256);
  expect(sha('../public' + REV.output.path)).toBe(REV.output.sha256);
  expect(resolveAssetSource(asset)).toBe(REV.output.path);
  expect(() => revisedLibraryFile({ ...asset, sha256: 'f'.repeat(64) } as any)).toThrow('exact generated file');
  expect(revisedLibraryFile(manifest.assets.find((a: any) => a.id === 'hero_ranger_t2') as any)).toBeNull();
});

test('메시·스킨·역바인드는 원본 바이트 그대로이고 관절 rest 가 같으며 클립·소켓만 바뀐다', () => {
  const a = glbJson('../asset-library/normalized/hero_ranger_t1.glb'), b = glbJson('../public' + REV.output.path);
  expect(b.meshes).toEqual(a.meshes.map((m: any) => ({ ...m, primitives: m.primitives.map((p: any) => ({ ...p, attributes: expect.any(Object), indices: expect.any(Number) })) })));
  expect(b.materials).toEqual(a.materials); expect(b.images).toEqual(a.images.map((i: any) => ({ ...i, bufferView: expect.any(Number) })));
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
