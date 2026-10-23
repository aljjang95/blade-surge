import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installRangerRuntimeLoader, stripImages } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, poseRangerBowString, disposeCharacter } from '../src/engine/assets.js';
import { rangerLibraryRevision } from '../src/engine/library-assets.js';
import manifest from '../asset-library/manifest.json';
import REV_V3 from '../src/data/ranger-library-revision-v3.json';

// 궁수 사망 활 접촉(ranger-library-v4, 저작 v3): 실제 loadHeroModel → spawnCharacter 경로의 Bow 정점(시위 자식 포함)을 월드로 옮겨 잰다.
// 비교 기준은 공개 v3 GLB 의 death 클립을 같은 런타임 인스턴스에 재생한 값이다(런타임 클립은 GLB 원본 파싱과 트랙이 같다).
// 수치 경계: 바닥(y=0) 관통 여부·몸 본 위치·활 회전 연속성. 실루엣이 '쓰러진 자세로 보이는지'는 렌더 검토 몫이며 이 테스트가 승인하지 않는다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());

const REV = rangerLibraryRevision();
const v = () => new THREE.Vector3(), q = () => new THREE.Quaternion();
const SAMPLES = 300;
const LEFT_ARM = /^mixamorig(LeftArm|LeftForeArm|LeftHand)/;   // 정착 보정이 바꾸는 왼팔 사슬과 손(손가락 포함)
/** 이름으로 노드를 찾는다(없으면 실패). */
const node = (inst: any, name: string): any => { const o = inst.root.getObjectByName(name); expect(o).toBeDefined(); return o; };

async function v3Death() {
  const gltf = await new GLTFLoader().parseAsync(stripImages(readFileSync(new URL('../public' + REV_V3.output.path, import.meta.url))), '');
  return gltf.animations.find((c) => c.name === 'death')!;
}
function play(inst: any, clip: THREE.AnimationClip, time: number) {
  inst.mixer.stopAllAction();
  const action = inst.mixer.clipAction(clip); action.reset(); action.play(); action.time = time; inst.mixer.update(0);
  inst.root.updateMatrixWorld(true);
  poseRangerBowString(inst.root, false); inst.root.updateMatrixWorld(true);
}
/** 실제 런타임 활 형상(Bow 몸체 + 시위 자식)의 월드 최저 높이 */
function bowMinY(inst: any) {
  let min = Infinity; const p = v();
  node(inst, 'Bow').traverse((o: any) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}
function skinMinY(inst: any) {
  let min = Infinity; const p = v();
  inst.root.traverse((o: any) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}
/** 균등 표본 + 클립의 모든 키 시간(게임은 임의 시점을 샘플한다) */
function sampleTimes(clip: THREE.AnimationClip) {
  const times = new Set<number>();
  for (let i = 0; i <= SAMPLES; i++) times.add(clip.duration * i / SAMPLES);
  for (const track of clip.tracks) for (const t of track.times) times.add(t);
  return [...times].sort((a, b) => a - b);
}

test('저작 접촉 측정에 쓰는 활 OBJ 는 실제 런타임 Bow 정점과 같다', async () => {
  const inst = spawnCharacter(await loadHeroModel('ranger', 1));
  const pos = node(inst, 'Bow').geometry.attributes.position;
  const obj = readFileSync(new URL('../art-src/ranger/runtime-bow-preview.obj', import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('v '))
    .map((l) => l.split(/\s+/).slice(1, 4).map(Number));
  expect(obj.length).toBe(pos.count);
  let max = 0;
  obj.forEach(([x, y, z], i) => { max = Math.max(max, Math.abs(pos.getX(i) - x), Math.abs(pos.getY(i) - y), Math.abs(pos.getZ(i) - z)); });
  expect(max).toBeLessThan(1e-6);
  disposeCharacter(inst.root, inst.mixer);
});

test('원인 재현: 공개 v3 사망은 몸 스킨이 접지한 채 실제 활이 바닥 아래 5cm 넘게 내려간다', async () => {
  const inst = spawnCharacter(await loadHeroModel('ranger', 1)), clip = await v3Death();
  let low = [Infinity, 0];
  for (const t of sampleTimes(clip)) { play(inst, clip, t); const y = bowMinY(inst); if (y < low[0]) low = [y, t]; }
  expect(low[0]).toBeLessThan(-.05);                       // 실측 -0.0999m
  expect(low[1]).toBeGreaterThan(1); expect(low[1]).toBeLessThan(1.1);   // 1.04초(25f) 부근, 충돌 직후 정착 구간
  play(inst, clip, low[1]); expect(skinMinY(inst)).toBeGreaterThan(-.01);
  disposeCharacter(inst.root, inst.mixer);
});

test('v4 사망: 1단계·갑옷 2·3단계·여우 아바타 모두 실제 활 정점이 클립 전 구간에서 바닥 위이고 손이 활을 쥔 채다', async () => {
  const old = await v3Death();
  for (const id of ['hero_ranger_t1', 'hero_ranger_t2', 'hero_ranger_t3', 'avatar_ranger_fox']) {
    const inst = spawnCharacter(await loadHeroAsset(manifest.assets.find((a: any) => a.id === id)!));
    // 사망은 Death_A/Death_B 어느 쪽이든 같은 저작 death 클립이다.
    expect(inst.clips.Death_A).toBe(inst.clips.death); expect(inst.clips.Death_B).toBe(inst.clips.death);
    const clip = inst.clips.death, bow = node(inst, 'Bow'), grip = node(inst, 'RangerBowGrip_L');
    expect(clip.duration).toBeCloseTo(REV.clips.death, 4);
    // 그립 소켓은 왼손 본 아래에 있다(활을 손에서 떼어 숨기지 않는다).
    let parent = grip.parent; while (parent && parent.name !== 'mixamorigLeftHand') parent = parent.parent;
    expect(parent?.name).toBe('mixamorigLeftHand');
    let bowLow = Infinity, skinLow = Infinity;
    for (const t of sampleTimes(clip)) {
      play(inst, clip, t);
      bowLow = Math.min(bowLow, bowMinY(inst)); skinLow = Math.min(skinLow, skinMinY(inst));
      expect(grip.getWorldPosition(v()).distanceTo(bow.getWorldPosition(v()))).toBeLessThan(1e-4);
      expect(THREE.MathUtils.radToDeg(grip.getWorldQuaternion(q()).angleTo(bow.getWorldQuaternion(q())))).toBeLessThan(.5);
    }
    expect(bowLow).toBeGreaterThanOrEqual(0);
    // 몸 접지는 1단계 스킨으로 푼다. 다른 몸체(갑옷·아바타)의 기존 오프셋(v3 실측 t2 -0.028 · t3 -0.028 · 여우 -0.31m)은 이 변경 범위 밖이므로
    // 같은 몸체에서 v3 보다 더 내려가지 않는지만 본다.
    let oldLow = Infinity;
    for (const t of sampleTimes(old)) { play(inst, old, t); oldLow = Math.min(oldLow, skinMinY(inst)); }
    expect(skinLow).toBeGreaterThan(oldLow - .002);
    if (id === 'hero_ranger_t1') {
      expect(skinLow).toBeGreaterThan(-.01);               // 키 사이 보간 실측 -0.004m
      play(inst, clip, clip.duration); expect(Math.abs(skinMinY(inst))).toBeLessThan(.03);   // 끝 자세는 몸이 바닥에 닿는다
    }
    disposeCharacter(inst.root, inst.mixer);
  }
  // 아바타 4종 × 전 프레임 스키닝 검사라 단독 약 9초, 병렬 부하 시 20초 가까이 걸린다(기본 5초 제한에서 시간 초과로만 실패).
}, 60_000);

test('v4 사망은 쓰러짐(18f=0.75초까지)·몸·끝 자세가 v3 와 같고 정착 구간 활 회전에 새 튐이 없다', async () => {
  const inst = spawnCharacter(await loadHeroModel('ranger', 1)), old = await v3Death(), now = inst.clips.death;
  const bones: THREE.Object3D[] = []; inst.root.traverse((o: any) => { if (o.isBone) bones.push(o); });
  const bow = node(inst, 'Bow'), grip = node(inst, 'RangerBowGrip_L');
  let early = 0, body = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = now.duration * i / SAMPLES;
    play(inst, old, t); const ref = bones.map((b) => b.getWorldPosition(v()));
    play(inst, now, t);
    bones.forEach((b, k) => {
      const d = b.getWorldPosition(v()).distanceTo(ref[k]);
      if (t <= .75 + 1e-9) early = Math.max(early, d);
      if (!LEFT_ARM.test(b.name)) body = Math.max(body, d);
    });
  }
  expect(early).toBeLessThan(1e-4);    // 쓰러지는 동안 모든 본이 같다(실측 1.3e-6m)
  expect(body).toBeLessThan(.003);     // 왼팔 밖 본은 접지 재계산 차이만(실측 1.1mm)
  play(inst, old, old.duration); const p3 = grip.getWorldPosition(v()), q3 = grip.getWorldQuaternion(q());
  play(inst, now, now.duration);
  expect(grip.getWorldPosition(v()).distanceTo(p3)).toBeLessThan(.001);
  expect(THREE.MathUtils.radToDeg(grip.getWorldQuaternion(q()).angleTo(q3))).toBeLessThan(.5);
  // 연속성: 1/240초 간격 활 회전 최대 변화. 정착 구간(0.75초 이후)이 v3 같은 구간보다 크지 않아야 한다(실측 v4 2.7° · v3 4.7°).
  const maxStep = (clip: THREE.AnimationClip) => {
    let prev: THREE.Quaternion | null = null, max = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = clip.duration * i / SAMPLES; play(inst, clip, t);
      const cur = bow.getWorldQuaternion(q());
      if (prev && t > .75) max = Math.max(max, THREE.MathUtils.radToDeg(cur.angleTo(prev)));
      prev = cur;
    }
    return max;
  };
  expect(maxStep(now)).toBeLessThanOrEqual(maxStep(old));
  disposeCharacter(inst.root, inst.mixer);
});
