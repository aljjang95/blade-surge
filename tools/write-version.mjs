// 빌드 산출물에 커밋 SHA 를 심는다 — deploy-guard 가 라이브에서 이걸 읽는다
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { sourceSnapshot, projectRoot } from './build-source.mjs';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${projectRoot.replaceAll('\\', '/')}`, ...args], { cwd: projectRoot, encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
const source = sourceSnapshot();
if (source.digest !== JSON.parse(readFileSync('dist/build-source.json', 'utf8')).digest) throw Error('Source changed after bundling; rebuild required');
mkdirSync('dist', { recursive: true });
const builtAt = new Date().toISOString();
const pwaRelease = createHash('sha256').update(`${sha}:${builtAt}`).update(readFileSync('dist/index.html')).digest('hex').slice(0, 20);
const worker = readFileSync('public/sw.js', 'utf8');
if (worker.split('__BLADE_PWA_RELEASE__').length !== 2) throw new Error('PWA release token missing or duplicated');
writeFileSync('dist/sw.js', worker.replace('__BLADE_PWA_RELEASE__', pwaRelease));
writeFileSync('dist/version.json', JSON.stringify({ sha, dirty, builtAt, pwaRelease, sourceSha256: source.digest }) + '\n');
console.log('version.json:', sha ? sha.slice(0, 8) : '(git 없음)', dirty ? '(더러움)' : '');
