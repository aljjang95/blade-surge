// 빌드 산출물에 커밋 SHA 를 심는다 — deploy-guard 가 라이브에서 이걸 읽는다
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
const sha = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(); } catch { return null; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain']).toString().trim().length > 0; } catch { return false; } })();
mkdirSync('dist', { recursive: true });
const builtAt = new Date().toISOString();
const pwaRelease = createHash('sha256').update(`${sha}:${builtAt}`).update(readFileSync('dist/index.html')).digest('hex').slice(0, 20);
const worker = readFileSync('public/sw.js', 'utf8');
if (worker.split('__BLADE_PWA_RELEASE__').length !== 2) throw new Error('PWA release token missing or duplicated');
writeFileSync('dist/sw.js', worker.replace('__BLADE_PWA_RELEASE__', pwaRelease));
writeFileSync('dist/version.json', JSON.stringify({ sha, dirty, builtAt, pwaRelease }) + '\n');
console.log('version.json:', sha ? sha.slice(0, 8) : '(git 없음)', dirty ? '(더러움)' : '');
