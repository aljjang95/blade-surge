// 스트리밍 자산 배포 검사: 스토어 채널 매니페스트의 remote 파일이 정식 호스트(또는 로컬 web dist)에 같은 내용으로 있는지 확인한다.
// 사용: node tools/check-remote-assets.mjs [매니페스트=work/store-builds/googleplay/web/asset-manifest.json] [대상=https://blade.tllhouse.com | dist 폴더]
//       [--previous <이전 릴리스 매니페스트.json>]...  이미 배포된 옛 앱 버전의 remote 경로·해시도 호스트에 남아 있는지 함께 본다(여러 번 줄 수 있다).
// remote 파일은 배포에서 지우거나 덮어쓰지 않는다: 스토어에 남은 옛 앱은 옛 매니페스트의 해시 URL 을 계속 요청한다.
// 앱 릴리스(AAB 업로드) 전에 반드시 돌린다: APK 에는 remote 파일이 없으므로 호스트에 없거나 내용이 다르면 그 콘텐츠는 앱에서 비어 보인다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2), previousPaths = [], positional = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--previous') previousPaths.push(argv[++i]); else positional.push(argv[i]); }
const manifestPath = path.resolve(positional[0] || 'work/store-builds/googleplay/web/asset-manifest.json');
const target = positional[1] || 'https://blade.tllhouse.com';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, manifest.hashLength || 16);
const remote = Object.entries(manifest.remote);
// 이전 릴리스: 현재 매니페스트와 같은 경로·같은 해시는 중복이라 뺀다. 경로는 같고 해시만 다른 파일은 옛 앱이 옛 해시 URL 을 요청하므로 따로 본다(?v= 가 다르다).
const previous = [];
for (const file of previousPaths) {
  const old = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
  for (const [rel, row] of Object.entries(old.remote || {})) if (manifest.remote[rel]?.h !== row.h && !previous.some(([r, x]) => r === rel && x.h === row.h)) previous.push([rel, row, path.basename(path.dirname(path.resolve(file))) || file]);
}
const problems = [];
let ok = 0;
const check = async ([rel, row, from]) => {
  const label = from ? `${rel}(이전 릴리스 ${from})` : rel;
  try {
    let bytes;
    if (/^https?:/.test(target)) {
      const url = `${target.replace(/\/$/, '')}/${rel}?v=${row.h}`;
      const response = await fetch(url, { headers: { Origin: 'https://localhost' } });
      if (!response.ok) { problems.push(`${label}: HTTP ${response.status}`); return; }
      if (/text\/html/i.test(response.headers.get('content-type') || '')) { problems.push(`${label}: HTML 응답(SPA 폴백으로 보임 — 파일이 호스트에 없음)`); return; }
      const allow = response.headers.get('access-control-allow-origin');
      if (allow !== 'https://localhost' && allow !== '*') problems.push(`${label}: CORS 헤더 없음(Access-Control-Allow-Origin=${allow})`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else bytes = await fs.readFile(path.join(path.resolve(target), rel));
    if (hash(bytes) !== row.h) problems.push(`${label}: 내용 해시 불일치(호스트 ${hash(bytes)} / 앱 ${row.h})`); else ok += 1;
  } catch (error) { problems.push(`${label}: ${error.code === 'ENOENT' ? '호스트에 없음' : error.message}`); }
};
const queue = [...remote, ...previous];
await Promise.all(Array.from({ length: 8 }, async () => { for (let item = queue.shift(); item; item = queue.shift()) await check(item); }));
console.log(JSON.stringify({ manifest: path.relative(process.cwd(), manifestPath), target, remoteFiles: remote.length, previousFiles: previous.length, ok, problems: problems.length }));
for (const problem of problems.slice(0, 40)) console.log('  -', problem);
process.exit(problems.length ? 1 : 0);
