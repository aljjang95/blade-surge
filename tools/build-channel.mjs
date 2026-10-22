// 각 스토어의 산출물은 공개 웹 dist와 분리하고 같은 정확한 소스를 기록한다.
import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FULL_MANIFEST_NAME, MANIFEST_NAME, stripRemote, verifyChannelBuild } from './optimize/asset-split.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const channel = process.argv[2];
if (!['googleplay', 'onestore', 'apps-in-toss'].includes(channel)) throw Error('명시된 스토어 채널이 필요합니다.');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw Error('커밋한 clean 소스로만 스토어를 빌드합니다.');
const dir = path.join(root, 'work', 'store-builds', channel), web = path.join(dir, 'web');
// 이전 빌드의 남은 파일이 APK 에 섞이지 않게 스토어 채널 web 폴더는 매번 비우고 시작한다(work/store-builds/<채널>/web 은 이 도구 소유).
await fs.rm(web, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });
await build({ root, mode: channel, define: { __BLADE_CHANNEL__: JSON.stringify(channel) },
  build: { outDir: web, emptyOutDir: false } });
// 네이티브 채널(googleplay·onestore)은 remote 자산을 APK 에서 빼고(런타임이 정식 호스트에서 받아 보관), core 가 빠짐없이 남았는지 검사한다.
const streamed = channel === 'googleplay' || channel === 'onestore';
let split = null;
if (streamed) {
  const fullPath = path.join(web, FULL_MANIFEST_NAME);
  const full = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  const removed = await stripRemote(web, full);
  const problems = await verifyChannelBuild(web, full);
  if (problems.length) throw Error(`APK web 폴더 검사 실패(${problems.length}건): ${problems.slice(0, 10).join(' | ')}`);
  await fs.rename(fullPath, path.join(dir, FULL_MANIFEST_NAME));
  const sum = (rows) => Object.values(rows).reduce((total, row) => total + row.b, 0);
  split = { remoteFiles: removed.length, remoteBytes: sum(full.remote), coreFiles: full.core.files, coreBytes: full.core.bytes, manifest: MANIFEST_NAME };
}
const manifest = { sha: head, dirty: false, builtAt: new Date().toISOString(), channel,
  canonicalApi: 'https://blade.tllhouse.com', ...(split ? { split } : {}), packageId: channel === 'apps-in-toss' ? 'blade-surge' : 'com.theluxurylord.bladesurge' };
await fs.writeFile(path.join(web, 'version.json'), JSON.stringify(manifest) + '\n');
// 네이티브/PWA SDK를 서로 섞지 않고 앱인토스는 공식 ait 포맷으로만 묶는다.
if (channel === 'apps-in-toss') {
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'blade-surge-toss-channel', private: true, type: 'module', dependencies: { '@apps-in-toss/web-framework': '3.8.0' } }));
  await fs.writeFile(path.join(dir, 'apps-in-toss.config.mjs'), `export default ${JSON.stringify({ appName: 'blade-surge', brand: { primaryColor: '#173d34' }, permissions: [], webBundleDir: 'web' })};\n`);
  execFileSync(process.execPath, [path.join(root, 'node_modules/@apps-in-toss/cli/dist/index.js'), 'build'], { cwd: dir, stdio: 'inherit' });
  const artifact = await fs.readFile(path.join(dir, 'blade-surge.ait'));
  await fs.writeFile(path.join(dir, 'artifact.json'), JSON.stringify({ ...manifest, artifactKind: 'ait', bytes: artifact.length,
    artifactSha256: createHash('sha256').update(artifact).digest('hex') }, null, 2));
}
console.log(JSON.stringify({ channel, head, web }));
