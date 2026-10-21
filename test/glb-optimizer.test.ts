import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { optimizeGlb, verifyOptimized } from '../tools/optimize/glb.mjs';

// 전달용 GLB 압축(tools/optimize/glb.mjs)이 게임이 실제로 쓰는 로더 경로(GLTFLoader + three 의 MeshoptDecoder)에서
// 원본과 같은 장면·정점·클립을 내는지 확인한다. Node 에는 이미지 디코딩이 없어 텍스처 참조만 제거하고 비교한다.
const read = (path: string) => new Uint8Array(readFileSync(new URL('../' + path, import.meta.url)));
const SAMPLES = [
  'public/models/heroes-next/rogue-library-t1-v2.glb',   // 스킨·14개 클립·내장 WebP
  'asset-library/normalized/skeleton_mage.glb',          // 몬스터 스킨 모델
  'public/models/tll/knight-casual-v2.glb',              // 스킨 없는 정적 메시(hero-identity 가 정점을 직접 읽는다)
  'public/models/citadel-hub-v1/gate-ember_vault.glb',   // 외부 텍스처 URI
  'public/models/sanctuary-v2/sanctuary-v2.glb',         // 로비 홀(대형 정적 장면)
];

function withoutImages(bytes: Uint8Array): ArrayBuffer {
  const buffer = Buffer.from(bytes), jsonLength = buffer.readUInt32LE(12), doc = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString());
  delete doc.images; delete doc.textures; delete doc.samplers;
  const strip = (value: any) => { if (value && typeof value === 'object') for (const key of Object.keys(value)) { if (/Texture$/.test(key)) delete value[key]; else strip(value[key]); } };
  for (const material of doc.materials || []) strip(material);
  const json = Buffer.from(JSON.stringify(doc)), pad = Buffer.alloc((4 - json.length % 4) % 4, 32), tail = buffer.subarray(20 + jsonLength);
  const header = Buffer.from(buffer.subarray(0, 20)); header.writeUInt32LE(20 + json.length + pad.length + tail.length, 8); header.writeUInt32LE(json.length + pad.length, 12);
  const packed = Buffer.concat([header, json, pad, tail]);
  return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
}
const load = (bytes: Uint8Array) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(withoutImages(bytes), '');

const triangleKey = (index: ArrayLike<number>, t: number) => { const [a, b, c] = [index[t], index[t + 1], index[t + 2]]; return [[a, b, c], [b, c, a], [c, a, b]].map(r => r.join()).sort()[0]; };
const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a as ArrayLike<number>).every((value, i) => Object.is(value, b[i]));

test.each(SAMPLES)('%s: 압축본은 같은 장면·정점·클립을 낸다(회전 트랙만 3.1e-5 이내)', async (path) => {
  const source = read(path), optimized = await optimizeGlb(source);
  expect('skipped' in optimized ? optimized.skipped : '').toBe('');
  const bytes = (optimized as { bytes: Uint8Array }).bytes;
  expect(bytes.length).toBeLessThan(source.length);
  expect(await verifyOptimized(source, bytes)).toBeNull();
  const [a, b] = [await load(source), await load(bytes)];
  const names = (gltf: any) => { const out: string[] = []; gltf.scene.traverse((node: any) => out.push(`${node.type}:${node.name}`)); return out; };
  expect(names(b)).toEqual(names(a));
  expect(JSON.stringify(b.scene.userData)).toBe(JSON.stringify(a.scene.userData));
  const meshesA: any[] = [], meshesB: any[] = [];
  a.scene.traverse((node: any) => { if (node.isMesh) meshesA.push(node); }); b.scene.traverse((node: any) => { if (node.isMesh) meshesB.push(node); });
  expect(meshesB.length).toBe(meshesA.length);
  meshesA.forEach((mesh, i) => {
    const other = meshesB[i];
    expect(Object.keys(other.geometry.attributes).sort()).toEqual(Object.keys(mesh.geometry.attributes).sort());
    for (const name of Object.keys(mesh.geometry.attributes)) {
      const [x, y] = [mesh.geometry.attributes[name], other.geometry.attributes[name]];
      expect(y.array.constructor.name, name).toBe(x.array.constructor.name);
      expect(y.normalized, name).toBe(x.normalized);
      expect(sameArray(x.array, y.array), `${mesh.name}.${name}`).toBe(true);
    }
    const [ia, ib] = [mesh.geometry.index, other.geometry.index];
    expect(!!ib).toBe(!!ia);
    if (ia) { expect(ib.count).toBe(ia.count); for (let t = 0; t < ia.count; t += 3) if (triangleKey(ia.array, t) !== triangleKey(ib.array, t)) throw new Error(`삼각형 불일치 ${mesh.name}#${t}`); }
    expect(other.isSkinnedMesh).toBe(mesh.isSkinnedMesh);
    expect(other.material.name).toBe(mesh.material.name);
  });
  expect(b.animations.map((clip: THREE.AnimationClip) => clip.name)).toEqual(a.animations.map((clip: THREE.AnimationClip) => clip.name));
  let rotationTracks = 0, worst = 0;
  a.animations.forEach((clip: THREE.AnimationClip, ci: number) => {
    const other = b.animations[ci];
    expect(other.duration).toBe(clip.duration);
    expect(other.tracks.length).toBe(clip.tracks.length);
    clip.tracks.forEach((track, ti) => {
      const twin = other.tracks[ti];
      expect(twin.name).toBe(track.name); expect(twin.ValueTypeName).toBe(track.ValueTypeName); expect(twin.getInterpolation()).toBe(track.getInterpolation());
      expect(sameArray(track.times, twin.times), `${clip.name} ${track.name} times`).toBe(true);
      expect(twin.values.constructor.name).toBe(track.values.constructor.name);
      if (track.name.endsWith('.quaternion')) {
        rotationTracks++;
        for (let k = 0; k < track.values.length; k++) worst = Math.max(worst, Math.abs(track.values[k] - twin.values[k]));
      } else expect(sameArray(track.values, twin.values), `${clip.name} ${track.name}`).toBe(true);
    });
  });
  if (a.animations.length) expect(rotationTracks).toBeGreaterThan(0);
  expect(worst).toBeLessThanOrEqual(1 / 32767 + 1e-9);
});

test('이미 meshopt 이거나 이득이 없는 GLB 는 건드리지 않는다', async () => {
  expect('skipped' in await optimizeGlb(read('public/models/Knight.glb'))).toBe(true);
  expect('skipped' in await optimizeGlb(read('public/models/heroes-next/ranger-t2-body-fit-v1.glb'))).toBe(true);
});

test('골반 위치 트랙처럼 회전이 아닌 애니메이션은 비트 단위로 같다(hero-body-motion 계약)', async () => {
  const source = read('public/models/heroes-next/rogue-library-t1-v2.glb'), optimized = await optimizeGlb(source) as { bytes: Uint8Array };
  const [a, b] = [await load(source), await load(optimized.bytes)];
  let compared = 0;
  for (const [ci, clip] of a.animations.entries()) for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const twin = b.animations[ci].tracks.find((t: THREE.KeyframeTrack) => t.name === track.name)!;
    expect(sameArray(track.times, twin.times)).toBe(true); expect(sameArray(track.values, twin.values)).toBe(true); compared++;
  }
  expect(compared).toBeGreaterThan(0);
});
