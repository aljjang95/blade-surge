// Tripo Studio 서명 URL을 받아 raw 폴더에 저장한다. URL은 인자 파일로 받아 셸 노출을 피한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
const [urlFile, out] = process.argv.slice(2);
const url = readFileSync(urlFile, 'utf8').trim();
const res = await fetch(url);
if (!res.ok) throw new Error('download failed ' + res.status);
const bytes = Buffer.from(await res.arrayBuffer());
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(JSON.stringify({ out, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));

