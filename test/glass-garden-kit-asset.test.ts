import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLASS_GARDEN_KIT_ASSETS, extractKitGeometry } from '../src/engine/glass-garden-kit.js';
import { GLASS_GARDEN_PROPS } from '../src/game/glass-garden-decor.js';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('public/models/glass-garden-kit-v1/manifest.json').toString('utf8'));
const glbJson = (bytes: Buffer) => JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
type Asset = { id: string; lod: number; file: string; url: string; bytes: number; sha256: string; triangles: number; vertices: number;
  draws: number; materials: string[]; boundsGltf: { min: number[]; max: number[] }; lodRatio?: number };
const assets: Asset[] = manifest.assets;
const pick = (id: string, lod: number) => assets.find(asset => asset.id === id && asset.lod === lod)!;

test('manifest는 소품 6종 × LOD 2개를 빠짐없이 기록하고 제작 스크립트 해시와 출처를 담는다', () => {
  expect(manifest.version).toBe('glass-garden-kit-v1');
  expect(assets).toHaveLength(GLASS_GARDEN_KIT_ASSETS.length * 2);
  for (const id of GLASS_GARDEN_KIT_ASSETS) for (const lod of [0, 1]) expect(pick(id, lod)).toBeDefined();
  expect(manifest.generator).toBe('tools/art/build-glass-garden-kit-v1.py');
  expect(manifest.generatorSha256).toBe(sha(read(manifest.generator)));
  expect(manifest.rights).toContain('no external assets');
  expect(manifest.runtime).toMatchObject({ units: 'metres', up: '+Y', forward: '+Z', pivot: 'ground-centred', static: true });
  for (const path of manifest.reference) expect(read(path).length).toBeGreaterThan(1000);
  for (const path of Object.values(manifest.evidence).filter((value: any) => value.startsWith('art/'))) expect(read(path as string).length).toBeGreaterThan(1000);
});

test('GLB 바이트·SHA-256·삼각형 수가 manifest와 같고 삼각형 예산·LOD1 비율을 지킨다', () => {
  for (const asset of assets) {
    const bytes = read(`public/models/glass-garden-kit-v1/${asset.file}`);
    expect(asset.url).toBe(`/models/glass-garden-kit-v1/${asset.file}`);
    expect(bytes.length).toBe(asset.bytes);
    expect(sha(bytes)).toBe(asset.sha256);
    const json = glbJson(bytes);
    const primitives = json.meshes.flatMap((mesh: any) => mesh.primitives);
    const triangles = primitives.reduce((sum: number, primitive: any) => sum + json.accessors[primitive.indices].count / 3, 0);
    expect(triangles).toBe(asset.triangles);
    expect(triangles).toBeLessThan(manifest.policy.maxTrianglesPerAsset);
    expect(asset.bytes).toBeLessThan(60000); // 소품 하나가 요청 하나에 들어가는 작은 파일
    expect(primitives.length).toBe(asset.draws);
    expect(asset.draws).toBeLessThanOrEqual(manifest.policy.maxDrawsPerAsset);
  }
  for (const id of GLASS_GARDEN_KIT_ASSETS) {
    const ratio = pick(id, 1).triangles / pick(id, 0).triangles;
    expect(ratio).toBeGreaterThanOrEqual(manifest.policy.lod1Ratio[0]);
    expect(ratio).toBeLessThanOrEqual(manifest.policy.lod1Ratio[1]);
    expect(pick(id, 1).lodRatio).toBeCloseTo(ratio, 3);
  }
});

test('정적 키트 계약: meshopt 압축·정점 색·gg_matte/gg_glow 두 재질뿐, 텍스처·스킨·애니메이션·카메라·조명 없음', () => {
  for (const asset of assets) {
    const json = glbJson(read(`public/models/glass-garden-kit-v1/${asset.file}`));
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.images || []).toHaveLength(0); expect(json.textures || []).toHaveLength(0);
    expect(json.skins || []).toHaveLength(0); expect(json.animations || []).toHaveLength(0); expect(json.cameras || []).toHaveLength(0);
    expect(json.extensions?.KHR_lights_punctual).toBeUndefined();
    expect(json.meshes).toHaveLength(1);
    for (const material of json.materials) {
      expect(['gg_matte', 'gg_glow']).toContain(material.name);
      expect(material.alphaMode || 'OPAQUE').toBe('OPAQUE');
    }
    expect(new Set(json.materials.map((material: any) => material.name)).size).toBe(json.materials.length);
    for (const primitive of json.meshes[0].primitives) {
      expect(primitive.attributes.COLOR_0).toBeDefined();
      expect(primitive.attributes.NORMAL).toBeDefined();
      expect(primitive.attributes.TEXCOORD_0).toBeUndefined();
    }
    // 노드 이름: 제작 스크립트가 붙인 gg_* 이름을 유지한다.
    expect(json.nodes.some((node: any) => String(node.name).startsWith('gg_'))).toBe(true);
  }
});

test('피벗·크기·발자국: 지면 중앙, 미터 단위, 소품 명세(GLASS_GARDEN_PROPS)가 실제 경계를 덮는다', () => {
  for (const id of GLASS_GARDEN_KIT_ASSETS) {
    const spec = (GLASS_GARDEN_PROPS as Record<string, any>)[id];
    for (const lod of [0, 1]) {
      const { min, max } = pick(id, lod).boundsGltf;
      expect(min.concat(max).every(Number.isFinite)).toBe(true);
      expect(min[1]).toBeGreaterThanOrEqual(-0.001); expect(min[1]).toBeLessThan(0.02);   // 바닥이 y=0
      expect(max[1]).toBeLessThanOrEqual(spec.height + 0.01);                            // 명세 높이는 실제 높이를 덮는 상한
      expect(max[1]).toBeGreaterThan(spec.height - 0.1);
      const [cx, cz] = spec.center || [0, 0];
      if (spec.shape === 'round') {
        const reach = Math.max(...[min[0], max[0]].map(x => Math.abs(x - cx)), ...[min[2], max[2]].map(z => Math.abs(z - cz)));
        expect(reach).toBeLessThanOrEqual(spec.radius + 0.02);
      } else {
        expect(Math.max(Math.abs(min[0]), Math.abs(max[0]))).toBeLessThanOrEqual(spec.half + 0.02);
        expect(Math.max(Math.abs(min[2]), Math.abs(max[2]))).toBeLessThanOrEqual(spec.depth + 0.02);
      }
    }
    expect(pick(id, 0).triangles).toBe(spec.tris); expect(pick(id, 1).triangles).toBe(spec.lod1);
  }
  // 걸이 등 외 소품은 XZ 중앙 피벗이어야 한다(모듈 이동·회전이 예측 가능하다).
  for (const id of GLASS_GARDEN_KIT_ASSETS.filter(id => id !== 'hanging-lantern')) {
    const { min, max } = pick(id, 0).boundsGltf;
    expect(Math.abs((min[0] + max[0]) / 2)).toBeLessThan(0.1);
  }
});

test('런타임 로더 경로: GLTFLoader + meshopt로 풀고 재질별 지오메트리를 뽑으며 원본 삼각형 수가 보존된다', async () => {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  for (const asset of assets) {
    const bytes = read(`public/models/glass-garden-kit-v1/${asset.file}`);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    const parts = extractKitGeometry(gltf.scene);
    let triangles = 0;
    for (const role of ['matte', 'glow'] as const) for (const geometry of parts[role]) {
      triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
      expect(geometry.getAttribute('color').itemSize).toBe(3);
      for (const value of geometry.getAttribute('color').array) expect(Number.isFinite(value)).toBe(true);
    }
    expect(triangles).toBe(asset.triangles);
    expect(parts.matte.length).toBe(1);
    // 발광 재질이 있는 소품은 같은 GLB 안의 두 번째 프리미티브로 나온다.
    expect(parts.glow.length).toBe(asset.materials.includes('gg_glow') ? 1 : 0);
  }
});
