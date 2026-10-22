// 스트리밍 자산 배포 검사: 스토어 채널 매니페스트의 remote 파일이 정식 호스트(또는 로컬 web dist)에 같은 내용으로 있는지 확인한다.
// 사용: node tools/check-remote-assets.mjs [매니페스트=work/store-builds/googleplay/web/asset-manifest.json] [대상=https://blade.tllhouse.com | dist 폴더]
// 앱 릴리스(AAB 업로드) 전에 반드시 돌린다: APK 에는 remote 파일이 없으므로 호스트에 없거나 내용이 다르면 그 콘텐츠는 앱에서 비어 보인다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const manifestPath = path.resolve(process.argv[2] || 'work/store-builds/googleplay/web/asset-manifest.json');
const target = process.argv[3] || 'https://blade.tllhouse.com';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, manifest.hashLength || 16);
const remote = Object.entries(manifest.remote);
const problems = [];
let ok = 0;
const check = async ([rel, row]) => {
  try {
    let bytes;
    if (/^https?:/.test(target)) {
      const url = `${target.replace(/\/$/, '')}/${rel}?v=${row.h}`;
      const response = await fetch(url, { headers: { Origin: 'https://localhost' } });
      if (!response.ok) { problems.push(`${rel}: HTTP ${response.status}`); return; }
      const allow = response.headers.get('access-control-allow-origin');
      if (allow !== 'https://localhost' && allow !== '*') problems.push(`${rel}: CORS 헤더 없음(Access-Control-Allow-Origin=${allow})`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else bytes = await fs.readFile(path.join(path.resolve(target), rel));
    if (hash(bytes) !== row.h) problems.push(`${rel}: 내용 해시 불일치(호스트 ${hash(bytes)} / 앱 ${row.h})`); else ok += 1;
  } catch (error) { problems.push(`${rel}: ${error.code === 'ENOENT' ? '호스트에 없음' : error.message}`); }
};
const queue = [...remote];
await Promise.all(Array.from({ length: 8 }, async () => { for (let item = queue.shift(); item; item = queue.shift()) await check(item); }));
console.log(JSON.stringify({ manifest: path.relative(process.cwd(), manifestPath), target, remoteFiles: remote.length, ok, problems: problems.length }));
for (const problem of problems.slice(0, 40)) console.log('  -', problem);
process.exit(problems.length ? 1 : 0);
