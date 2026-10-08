// Blender 출력의 비손실 전달 압축. 원본의 축·색·인덱스는 재해석하지 않는다.
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptEncoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
for (const path of process.argv.slice(2)) {
  const file = await readFile(path), jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  if (json.extensionsRequired?.includes('EXT_meshopt_compression')) continue;
  const bytes = file.subarray(28 + jsonLength), chunks = [];
  let packedOffset = 0, fallbackOffset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const view = json.bufferViews[i], accessor = json.accessors.find(a => a.bufferView === i);
    if (!accessor) throw Error(`예상하지 않은 비기하 버퍼: ${path}:${i}`);
    const source = bytes.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const count = accessor.count, stride = view.byteLength / count;
    const mode = view.target === 34963 ? 'TRIANGLES' : 'ATTRIBUTES';
    const compressed = MeshoptEncoder.encodeGltfBuffer(source, count, stride, mode);
    view.buffer = 1; view.byteOffset = fallbackOffset;
    if (mode === 'ATTRIBUTES') view.byteStride = stride;
    view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: packedOffset, byteLength: compressed.length, byteStride: stride, count, mode } };
    chunks.push(Buffer.from(compressed));
    const padding = (4 - compressed.length % 4) % 4; chunks.push(Buffer.alloc(padding));
    packedOffset += compressed.length + padding; fallbackOffset += view.byteLength;
  }
  json.buffers = [{ byteLength: packedOffset }, { byteLength: fallbackOffset, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'EXT_meshopt_compression'])];
  const rawJson = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 32)]);
  const binChunk = Buffer.concat(chunks), header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.write('JSON', 16);
  binaryHeader.writeUInt32LE(binChunk.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  await writeFile(path, Buffer.concat([header, jsonChunk, binaryHeader, binChunk]));
}
