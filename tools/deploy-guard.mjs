#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import config from './release-config.json' with { type: 'json' };

export const DEPLOY_URL = config.origin;
const SHA = /^[a-f0-9]{40}$/;
export function checkRelease({ head, dirty, live, expectedLive, known, isAncestor }) {
  if (!SHA.test(head)) throw new Error('HEAD 커밋이 유효하지 않습니다.');
  if (dirty) throw new Error('미커밋 변경이 있습니다. 검증한 파일을 먼저 커밋하세요.');
  if (!live || !SHA.test(live.sha) || live.dirty !== false) throw new Error('라이브의 정확한 clean 버전을 확인할 수 없습니다.');
  if (expectedLive && live.sha !== expectedLive) throw new Error('배포 준비 이후 라이브가 바뀌었습니다. 다시 대조하세요.');
  if (!known(live.sha)) throw new Error('라이브 커밋을 로컬 저장소가 모릅니다. fetch 후 변경을 확인하세요.');
  if (!isAncestor(live.sha, head)) throw new Error('HEAD가 라이브의 후속 커밋이 아닙니다. 후퇴 또는 분기 배포를 중단합니다.');
  return { head, live: live.sha, target: DEPLOY_URL, worker: 'blade-surge' };
}
export async function readVersion(url = DEPLOY_URL) {
  const response = await fetch(`${url}/version.json?verify=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`라이브 버전 조회 HTTP ${response.status}`);
  return response.json();
}
export async function guard(expectedLive) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const check = (...args) => { try { git(...args); return true; } catch { return false; } };
  const receipt = checkRelease({ head: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
    live: await readVersion(), expectedLive,
    known: (sha) => check('cat-file', '-e', `${sha}^{commit}`), isAncestor: (a, b) => check('merge-base', '--is-ancestor', a, b),
  });
  mkdirSync('_autopipe/evidence', { recursive: true });
  writeFileSync('_autopipe/evidence/deploy-preflight.json', JSON.stringify({ ...receipt, checkedAt: new Date().toISOString() }, null, 2));
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--force')) throw new Error('force 우회는 지원하지 않습니다. 원인을 해결하고 재검증하세요.');
    const index = process.argv.indexOf('--expect-live');
    const expected = index < 0 ? undefined : process.argv[index + 1];
    if (index >= 0 && !SHA.test(expected ?? '')) throw new Error('--expect-live에는 전체 커밋 SHA가 필요합니다.');
    console.log(JSON.stringify(await guard(expected), null, 2));
  } catch (error) { console.error(`배포 중단: ${error.message}`); process.exitCode = 1; }
}
