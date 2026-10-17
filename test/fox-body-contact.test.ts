import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../asset-library/manifest.json';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../src/engine/assets.js';
import { foxBodyRevision, resolveAssetSource } from '../src/engine/library-assets.js';

let restore = () => {}, model: any;
beforeAll(async () => {
  restore = installRangerRuntimeLoader();
  const asset = manifest.assets.find(entry => entry.id === 'avatar_ranger_fox')!;
  expect(resolveAssetSource(asset)).toBe(foxBodyRevision().output.path);
  const bytes = readFileSync(new URL('../public' + foxBodyRevision().output.path, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(foxBodyRevision().output.sha256);
  model = await loadHeroAsset(asset);
});
afterAll(() => restore());

function sampleTimes(clip: THREE.AnimationClip) {
  const times = new Set<number>(Array.from({ length: 301 }, (_, i) => clip.duration * i / 300));
  for (const track of clip.tracks) for (const time of track.times) times.add(time);
  for (const time of [.04, .15625, .23, .4375, .475, .875, .9916666666666667]) if (time <= clip.duration) times.add(time);
  return [...times].sort((a, b) => a - b);
}
function lowestSkin(root: THREE.Object3D) {
  let min = Infinity; const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((node: any) => {
    if (!node.isSkinnedMesh || !node.userData.libraryBody) return;
    node.skeleton.update();
    for (let i = 0; i < node.geometry.attributes.position.count; i++) {
      node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
      min = Math.min(min, point.y);
    }
  });
  expect(Number.isFinite(min)).toBe(true);
  return min;
}

// 원본 Actor의 사망 후 침하를 적용하지 않은 실제 저작 스킨이다. 수치는 GPU/미술 승인이나 실기기 증거가 아니다.
for (const name of ['bow_shoot', 'bow_shoot_rapid', 'cast_shoot', 'cheer', 'death', 'Dodge_Backward', 'hit', 'idle', 'interact', 'run', 'dodge']) {
  test('여우 실제 런타임 ' + name + ': 301 균등·모든 키·기존 실패 시점에서 외피가 바닥을 관통하지 않는다', () => {
    const instance = spawnCharacter(model), clip = instance.clips[name];
    expect(instance.root.userData.libraryBodyAssetId).toBe('avatar_ranger_fox');
    expect(clip).toBeDefined();
    const action = instance.mixer.clipAction(clip);
    action.reset(); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    let min = Infinity, max = -Infinity, last = Infinity;
    for (const time of sampleTimes(clip)) {
      action.time = time; instance.mixer.update(0);
      last = lowestSkin(instance.root); min = Math.min(min, last); max = Math.max(max, last);
    }
    expect(min).toBeGreaterThanOrEqual(-.01);
    if (['idle', 'bow_shoot', 'bow_shoot_rapid'].includes(name)) {
      expect(Math.abs(min)).toBeLessThanOrEqual(.02);
      expect(Math.abs(max)).toBeLessThanOrEqual(.02);
    }
    if (name === 'death') expect(Math.abs(last)).toBeLessThanOrEqual(.02);
    disposeCharacter(instance.root, instance.mixer);
  }, 30000);
}
