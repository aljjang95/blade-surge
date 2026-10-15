// 궁수 실제 런타임 경로(loadHeroModel → 라이브러리 몸체 → KayKit 활 소켓)를 Bun 에서 그대로 실행하기 위한 로더 교체.
// URL 을 저장소 파일로 바꾸고 이미지 디코드만 제거한다. 지오메트리·스킨·클립·노드는 원본 그대로다.
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = new URL('../../', import.meta.url);
export const overrides = new Map();
export function filePathFor(url) {
  if (overrides.has(url)) return overrides.get(url);
  const library = /^\/models\/library\/(.+)$/.exec(url);
  if (library) return new URL('asset-library/normalized/' + library[1], ROOT);
  if (url.startsWith('/')) return new URL('public' + url, ROOT);
  return new URL(url, ROOT);
}
export function stripImages(bytes) {
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length).toString());
  for (const m of doc.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    if (m.extensions) for (const ext of Object.values(m.extensions)) for (const k of Object.keys(ext)) if (k.endsWith('Texture')) delete ext[k];
  }
  delete doc.textures; delete doc.images; delete doc.samplers;
  const json = Buffer.from(JSON.stringify(doc)), pad = Buffer.alloc((4 - json.length % 4) % 4, 32), tail = bytes.subarray(20 + length);
  const header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + json.length + pad.length + tail.length, 8); header.writeUInt32LE(json.length + pad.length, 12);
  const packed = Buffer.concat([header, json, pad, tail]);
  return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
}
const original = GLTFLoader.prototype.loadAsync;
export function installRangerRuntimeLoader() {
  GLTFLoader.prototype.loadAsync = function (url) {
    return Promise.resolve().then(() => this.parseAsync(stripImages(readFileSync(filePathFor(url))), ''));
  };
  return () => { GLTFLoader.prototype.loadAsync = original; };
}

