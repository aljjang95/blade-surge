// GLB 안 이미지 하나의 바이트만 바꾼다(텍스처 부분 수정용). 그 bufferView 뒤의 bufferView 오프셋을 4바이트 정렬로 밀고 BIN·헤더 길이를 다시 쓴다.
// 정점·인덱스·애니메이션 등 다른 bufferView 의 바이트는 그대로다.
//   node tools/art/replace-glb-image.mjs <입력.glb> <이미지 번호> <새 이미지 파일> <출력.glb>
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readGlb } from './fit-leg-rest.mjs';

const pad4 = (n) => (n + 3) & ~3;

export function replaceGlbImage(bytes, imageIndex, image) {
  const { json, bin } = readGlb(bytes);
  const target = json.images?.[imageIndex]?.bufferView;
  if (target === undefined) throw new Error('image has no bufferView: ' + imageIndex);
  const isWebp = image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP';
  const isPng = image.readUInt32BE(0) === 0x89504e47;
  const mime = isWebp ? 'image/webp' : isPng ? 'image/png' : null;
  if (mime !== json.images[imageIndex].mimeType) throw new Error(`image format ${mime} differs from ${json.images[imageIndex].mimeType}`);
  const views = json.bufferViews.map((v, i) => ({ i, v, start: v.byteOffset || 0 })).sort((a, b) => a.start - b.start);
  const chunks = [];
  let at = 0;
  for (const { i, v, start } of views) {
    if (v.buffer !== 0) throw new Error('single buffer expected');
    const data = i === target ? image : bin.subarray(start, start + v.byteLength);
    const offset = pad4(at);
    if (offset > at) chunks.push(Buffer.alloc(offset - at));
    v.byteOffset = offset; v.byteLength = data.length; chunks.push(Buffer.from(data)); at = offset + data.length;
  }
  const newBin = Buffer.concat([...chunks, Buffer.alloc(pad4(at) - at)]);
  json.buffers[0].byteLength = newBin.length;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + newBin.length, 8);
  const head = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, head(text.length, 0x4e4f534a), text, head(newBin.length, 0x004e4942), newBin]);
}

if (import.meta.main || process.argv[1]?.endsWith('replace-glb-image.mjs')) {
  const [input, index, imagePath, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node tools/art/replace-glb-image.mjs input.glb imageIndex image.webp output.glb');
  const bytes = fs.readFileSync(input), out = replaceGlbImage(bytes, Number(index), fs.readFileSync(imagePath));
  fs.writeFileSync(output, out);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  console.log(JSON.stringify({ input, inputSha256: sha(bytes), output, outputSha256: sha(out), bytes: out.length }));
}
