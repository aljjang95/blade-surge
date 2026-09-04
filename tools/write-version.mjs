// 빌드 산출물에 커밋 SHA 를 심는다 — deploy-guard 가 라이브에서 이걸 읽는다
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
const sha = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(); } catch { return null; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain']).toString().trim().length > 0; } catch { return false; } })();
mkdirSync('dist', { recursive: true });
writeFileSync('dist/version.json', JSON.stringify({ sha, dirty, builtAt: new Date().toISOString() }) + '\n');
console.log('version.json:', sha ? sha.slice(0, 8) : '(git 없음)', dirty ? '(더러움)' : '');
