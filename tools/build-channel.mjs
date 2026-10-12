// 각 스토어의 산출물은 공개 웹 dist와 분리하고 같은 정확한 소스를 기록한다.
import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const channel = process.argv[2];
if (!['googleplay', 'onestore', 'apps-in-toss'].includes(channel)) throw Error('명시된 스토어 채널이 필요합니다.');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw Error('커밋한 clean 소스로만 스토어를 빌드합니다.');
const dir = path.join(root, 'work', 'store-builds', channel), web = path.join(dir, 'web');
await fs.mkdir(dir, { recursive: true });
await build({ root, mode: channel, define: { __BLADE_CHANNEL__: JSON.stringify(channel) },
  build: { outDir: web, emptyOutDir: false } });
const manifest = { sha: head, dirty: false, builtAt: new Date().toISOString(), channel,
  canonicalApi: 'https://blade.tllhouse.com', packageId: channel === 'apps-in-toss' ? 'blade-surge' : 'com.theluxurylord.bladesurge' };
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
