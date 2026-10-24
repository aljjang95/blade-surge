import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../asset-library/manifest.json';
import BOOTS_DATA from '../src/data/hero-boots.json';
import { heroLibraryAssets, resolveAssetSource } from '../src/engine/library-assets.js';
import { pickBootsEntry, bootsGeometryContract, syncHeroBoots, heroAnkleHeight, BOOTS_TRIANGLE_LIMIT, BOOTS_SCALE_RANGE } from '../src/engine/hero-boots.js';
import { bootsFrame, TARGETS } from '../tools/art/normalize-boots.mjs';

// 출하한 등급 부츠 GLB(public/models/boots)를 실제 GLTFLoader 로 읽고, 게임이 실제로 쓰는 영웅 몸 GLB 에 syncHeroBoots 로 붙인다.
// bun 에는 이미지 디코더가 없으므로 텍스처 참조만 걷어 낸 같은 GLB(기하·스킨·역바인드는 바이트 그대로)를 파싱한다.
const HEROES = ['knight', 'mage', 'rogue', 'barbarian', 'ranger'] as const;
const root = new URL('../', import.meta.url);

function withoutTextures(bytes: Buffer): ArrayBuffer {
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const bin = bytes.subarray(20 + jsonLength);   // BIN 청크 헤더 포함 그대로
  for (const material of json.materials || []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture; delete material.extensions;
    if (material.pbrMetallicRoughness) { delete material.pbrMetallicRoughness.baseColorTexture; delete material.pbrMetallicRoughness.metallicRoughnessTexture; }
  }
  delete json.images; delete json.textures; delete json.samplers;
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key]) json[key] = json[key].filter((e: string) => e !== 'EXT_texture_webp');
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + text.length + bin.length, 8); header.writeUInt32LE(text.length, 12); header.write('JSON', 16);
  const out = Buffer.concat([header, text, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
const parse = (path: string) => new GLTFLoader().parseAsync(withoutTextures(readFileSync(new URL(path, root))), '');
const bootsFile = (id: string) => readFileSync(new URL(`public/models/boots/${id}.glb`, root));
const glbJson = (bytes: Buffer) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());

/** WEBP(VP8·VP8L·VP8X) 헤더에서 크기. */
function webpSize(b: Buffer) {
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error('not webp');
}

/** 게임이 영웅 단계별로 실제 받는 몸 파일(/models/library = asset-library/normalized). */
const bodyFiles = (heroId: string) => heroLibraryAssets(manifest, heroId).map((asset: any) => ({
  id: asset.id, path: resolveAssetSource(asset, '/x').replace('/x/models/library/', 'asset-library/normalized/').replace('/x/', 'public/'),
}));

test('출하 데이터: N 없음, S=boots_n, E·U=boots_e, L=boots_l 이고 파일 SHA·삼각형이 기록과 같다', () => {
  expect(['N', 'S', 'E', 'U', 'L'].map((r) => pickBootsEntry(r)?.id ?? null)).toEqual([null, 'boots_n', 'boots_e', 'boots_e', 'boots_l']);
  for (const entry of BOOTS_DATA.boots) {
    const bytes = bootsFile(entry.id), json = glbJson(bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(json.accessors[json.meshes[0].primitives[0].indices].count / 3).toBe(entry.triangles);
    expect(entry.triangles).toBeLessThanOrEqual(BOOTS_TRIANGLE_LIMIT);
    expect([json.meshes.length, json.meshes[0].primitives.length, json.materials.length, json.skins?.length ?? 0]).toEqual([1, 1, 1, 0]);
    // 모바일 예산: 라이브러리 몸과 같은 1024 WEBP, 파일 1MB 이하
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const bin = bytes.subarray(28 + bytes.readUInt32LE(12));
    for (const image of json.images) {
      const view = json.bufferViews[image.bufferView];
      expect(image.mimeType).toBe('image/webp');
      expect(Math.max(...webpSize(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)))).toBeLessThanOrEqual(1024);
    }
  }
});

test('출하 GLB 는 저작 계약(발목 원점·+Y 위·+Z 발끝·미터)을 지킨다', async () => {
  for (const entry of BOOTS_DATA.boots) {
    const gltf = await parse(`public/models/boots/${entry.id}.glb`);
    const meshes: THREE.Mesh[] = []; gltf.scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
    expect(meshes).toHaveLength(1);
    const g = meshes[0].geometry; expect(bootsGeometryContract(g)).toBe(true);
    const { min, max } = g.boundingBox!;
    expect(max.z).toBeGreaterThan(-min.z * 1.5);   // 발끝(+Z)이 발목 앞쪽으로 더 길다(뒤꿈치는 짧다)
    expect(Math.abs(min.x + max.x)).toBeLessThan(0.03);   // 다리 축이 좌우 가운데
  }
});

test('정규화 도구: 발끝 방향(yaw)과 발목 원점을 원본에서 다시 계산할 수 있다', () => {
  // 발끝이 -X 인 상자형 부츠(목은 +X 쪽 위로)를 +Z 로 돌리면 목 중심이 뒤꿈치 쪽 절반에 온다.
  const pts: number[] = [];
  for (const [x, y, z] of [[-0.5, 0, -0.2], [0.5, 0, 0.2], [-0.5, 0.3, 0.2], [0.1, 0.7, -0.2], [0.5, 0.7, 0.2], [0.5, 0, -0.2]]) pts.push(x, y, z);
  const frame = bootsFrame(new Float32Array(pts), { yaw: 90 });
  expect(frame.heelSide).toBeGreaterThan(0.1); expect(frame.heelSide).toBeLessThan(0.5);
  expect(frame.min[2]).toBeCloseTo(-0.5, 5); expect(frame.max[2]).toBeCloseTo(0.5, 5);
  expect(frame.origin[1]).toBeCloseTo(1 / 2.4, 5);
  expect(Object.keys(TARGETS)).toEqual(BOOTS_DATA.boots.map((b) => b.id));
});

// knight 2·3단계 몸(hero_knight_t2/t3)은 원래 발이 바닥보다 약 29cm 아래로 묶여 부츠를 거절했다. t6 에서 다리 역바인드를 고쳐(tools/art/fit-leg-rest.mjs)
// 이제 다른 몸과 같은 조건(발목 높이 0.163m, 밑창 1.5cm 이내)으로 붙는다.

for (const heroId of HEROES) test(`${heroId}: 실제 단계 몸 GLB 모두에 S·E·U·L 부츠가 실제 로드 경로로 붙고 밑창·발길이가 맞는다`, async () => {
  const boots = new Map<string, any>();
  for (const entry of BOOTS_DATA.boots) boots.set(entry.path, await parse(`public/models/boots/${entry.id}.glb`));
  const files = bodyFiles(heroId);
  expect(files.length).toBeGreaterThanOrEqual(3);
  for (const file of files) {
    const gltf = await parse(file.path);
    let skin: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o: any) => { if (!skin && o.isSkinnedMesh) skin = o; });
    expect(skin).not.toBeNull();
    const body = skin as unknown as THREE.SkinnedMesh;
    body.userData.libraryBody = 1;
    gltf.scene.userData.authoredContract = { role: 'hero', heroId };
    gltf.scene.updateMatrixWorld(true);
    body.geometry.computeBoundingBox();
    const ankle = heroAnkleHeight(body)!;
    // 영웅 원래 발(발·발끝 가중치 > 0.5)의 bind 공간 앞뒤 길이
    const names = body.skeleton.bones.map((b) => b.name.replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, ''));
    const foot = new Set(['RightFoot', 'RightToeBase'].map((n) => names.indexOf(n)).filter((k) => k >= 0));
    const p = body.geometry.attributes.position, si = body.geometry.attributes.skinIndex, sw = body.geometry.attributes.skinWeight;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < p.count; i++) {
      let w = 0; for (let k = 0; k < 4; k++) if (foot.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w > 0.5) { zMin = Math.min(zMin, p.getZ(i)); zMax = Math.max(zMax, p.getZ(i)); }
    }
    for (const rarity of ['S', 'E', 'U', 'L']) {
      const warns: string[] = [];
      syncHeroBoots(gltf.scene, { rarity }, { load: (path: string) => Promise.resolve(boots.get(path)), warn: (m: string) => warns.push(m) });
      await new Promise((r) => setTimeout(r, 0));
      const state = gltf.scene.userData.heroBoots;
      expect(state?.id, `${file.id} ${rarity}`).toBe(pickBootsEntry(rarity)!.id);
      expect(warns).toEqual([]);
      const g = state.mesh.geometry, pos = g.attributes.position, slot = g.attributes.skinIndex;
      let yMin = Infinity, bzMin = Infinity, bzMax = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (slot.getX(i) !== 0) continue;   // 오른발 짝
        yMin = Math.min(yMin, pos.getY(i)); bzMin = Math.min(bzMin, pos.getZ(i)); bzMax = Math.max(bzMax, pos.getZ(i));
      }
      // 밑창이 몸 바닥에 닿는다(부풀림 1% 오차 안, 1.5cm 이하)
      expect(Math.abs(yMin - body.geometry.boundingBox!.min.y), `${file.id} ${rarity} sole`).toBeLessThan(0.015);
      // 부츠 발길이는 영웅 발의 1.25배 이하(이동 판독·접지를 가리지 않게), 0.7배 이상(발을 덮는다)
      const ratio = (bzMax - bzMin) / (zMax - zMin);
      expect(ratio, `${file.id} ${rarity} length ${ratio.toFixed(2)}`).toBeLessThanOrEqual(1.25);
      expect(ratio, `${file.id} ${rarity} length ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
    }
    gltf.scene.userData.libraryDisposed = true;
  }
}, 60000);
