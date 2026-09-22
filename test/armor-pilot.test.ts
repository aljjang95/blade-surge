import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assembleHeroIdentity } from '../src/engine/hero-identity.js';
import { requiredModelAliases } from '../src/engine/assets.js';
import { ARMOR_VISUALS, armorVisualFor } from '../src/data/armor-visuals.js';

// 숫자 리그 검사에서는 텍스처 참조만 메모리 복사본에서 제외한다. 미술 승인 아님.
async function load(relative: string) {
  const bytes = readFileSync(new URL('../public/models/' + relative, import.meta.url));
  const n = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + n).toString());
  const strip = (v: any) => {
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      if (k.endsWith('Texture') && v[k]?.index !== undefined) delete v[k];
      else strip(v[k]);
    }
  };
  for (const m of doc.materials || []) strip(m);
  const json = Buffer.from(JSON.stringify(doc)), padding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.from(bytes.subarray(0, 20)), tail = bytes.subarray(20 + n);
  header.writeUInt32LE(20 + json.length + padding.length + tail.length, 8);
  header.writeUInt32LE(json.length + padding.length, 12);
  const packed = Buffer.concat([header, json, padding, tail]);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.length), '');
}
test('외형 ID는 다섯 기존 갑옷·검성으로 한정된다', () => {
  expect(Object.keys(ARMOR_VISUALS).length).toBe(5);
  expect(armorVisualFor('__proto__', 'knight')).toBeNull();
  expect(armorVisualFor('a_rime', 'ranger')).toBeNull();
  expect(armorVisualFor('unknown', 'knight')).toBeNull();
});
const manifest = JSON.parse(readFileSync(new URL('../public/models/armor-pilot/v1/manifest.json', import.meta.url), 'utf8'));
test('출력 해시·예산·서로 다른 부품 구성', () => {
  expect(manifest.source_unchanged).toBe(true);
  const signatures = new Set();
  for (const entry of manifest.variants) {
    const bytes = readFileSync(new URL('../public/models/armor-pilot/v1/' + entry.file, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(entry.vertices).toBeLessThanOrEqual(25000);
    expect(entry.materials).toBeLessThanOrEqual(12);
    signatures.add(entry.triangles + ':' + entry.parts);
  }
  expect(signatures.size).toBe(5);
});
for (const id of Object.keys(ARMOR_VISUALS)) test(id + ' 기존 리그와 필수 동작 12위상 검사', async () => {
  const source = await load('Knight.glb'), fitting = await load('armor-pilot/v1/' + id + '.glb');
  const head = source.scene.getObjectByName('Knight_Head');
  const clips = source.animations.slice();
  assembleHeroIdentity(source, fitting, 'Knight', 'expedition-v3');
  expect(source.scene.getObjectByName('Knight_Head')).toBe(head);
  expect(source.animations).toEqual(clips);
  const skins: THREE.SkinnedMesh[] = [];
  source.scene.traverse(o => { if (o instanceof THREE.SkinnedMesh && o.name.startsWith('TLL_')) skins.push(o); });
  expect(skins.length).toBeGreaterThan(0);
  const mixer = new THREE.AnimationMixer(source.scene), point = new THREE.Vector3();
  let poses = 0, maximumSpan = 0;
  for (const name of requiredModelAliases('hero', 'knight')) {
    const clip = clips.find(c => c.name === name); expect(clip).toBeDefined();
    for (let phase = 0; phase < 12; phase++) {
      mixer.stopAllAction(); const action = mixer.clipAction(clip!); action.reset().play();
      action.time = clip!.duration * phase / 12; mixer.update(0); source.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      for (const skin of skins) {
        const positions = skin.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          skin.applyBoneTransform(i, point.fromBufferAttribute(positions, i)).applyMatrix4(skin.matrixWorld);
          if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(id + ':' + name + ': nonfinite pose');
          bounds.expandByPoint(point);
        }
      }
      const span = bounds.getSize(new THREE.Vector3()).length();
      expect(span).toBeGreaterThan(.2); expect(span).toBeLessThan(8);
      expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(10);
      maximumSpan = Math.max(maximumSpan, span); poses++;
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(source.scene);
  console.info('ARMOR_POSE_PROOF ' + JSON.stringify({ id, poses, maximumSpan, faceObjectPreserved: true, clips: clips.length, visualCollisionApproved: false, materialRenderApproved: false }));
}, 60000);
