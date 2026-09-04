#!/usr/bin/env node
/**
 * deploy-guard — 라이브를 뒤로 되돌리는 배포를 막는다.
 *
 * 왜: 클라우드 세션은 GitHub 푸시가 막혀 origin/main 이 라이브보다 뒤처져 있을 수 있다.
 * 그 상태에서 origin/main 만 클론한 다음 세션이 `npm run deploy` 하면
 * **라이브가 통째로 후퇴한다** — 유저가 보던 콘텐츠가 사라진다.
 * 2026-09-03 에 세 세션이 서로를 못 보고 갈래를 셋 만든 것과 같은 메커니즘이다.
 *
 * 라이브는 /version.json 에 자기 커밋 SHA 를 싣는다(빌드 때 생성).
 * 배포 전에 그걸 읽어 세 가지를 본다:
 *   1) 라이브 SHA 를 내가 모른다      → 거부. 내가 못 본 작업이 라이브에 있다 (R2/origin 먼저 흡수)
 *   2) 내 HEAD 가 라이브의 조상이다   → 거부. 뒤로 되돌리는 배포다
 *   3) 그 외                          → 통과
 *
 *   node tools/deploy-guard.mjs                  # 검사
 *   node tools/deploy-guard.mjs --force "이유"    # 알고도 강행 (이유 필수)
 */
import { execFileSync } from 'child_process';

const URL_ = process.env.DEPLOY_URL || 'https://blade-surge.affinity-agent-studio.workers.dev';
const forceIdx = process.argv.indexOf('--force');
const force = forceIdx >= 0;
const reason = force ? process.argv.slice(forceIdx + 1).join(' ') : '';

const git = (...a) => execFileSync('git', a).toString().trim();
const known = (sha) => { try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; } };
const isAncestor = (a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } };

const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;

let live = null;
try {
  const r = await fetch(`${URL_}/version.json`, { cache: 'no-store' });
  if (r.ok) live = (await r.json()).sha || null;
} catch { /* 라이브가 안 뜨면 아래에서 통과 */ }

const fail = (msg, hint) => {
  console.error(`\n✗ 배포 중단 — ${msg}`);
  if (hint) console.error(hint);
  if (force) { console.error(`\n⚠ --force 로 강행한다: ${reason || '(이유 없음)'}`); process.exit(0); }
  console.error(`\n알고도 강행하려면: npm run deploy -- --force "이유"`);
  process.exit(1);
};

console.log(`배포 가드 — HEAD ${head.slice(0, 8)}${dirty ? ' (작업트리 더러움)' : ''} / 라이브 ${live ? live.slice(0, 8) : '(version.json 없음)'}`);

if (!live) { console.log('  라이브 버전을 못 읽었다 — 첫 배포로 보고 통과한다'); process.exit(0); }
if (live === head) { console.log('  라이브와 같은 커밋이다 — 통과 (재배포)'); process.exit(0); }

if (!known(live)) {
  fail(`라이브 커밋 ${live.slice(0, 8)} 을 이 저장소가 모른다.`,
    `  라이브에 내가 못 본 작업이 올라가 있다. 지금 배포하면 그게 사라진다.\n` +
    `  먼저 흡수해라: git fetch origin  +  R2 blade-surge-handoff 의 rotations/ 최신 번들`);
}
if (isAncestor(head, live)) {
  const behind = git('rev-list', '--count', `${head}..${live}`);
  fail(`내 HEAD 가 라이브보다 ${behind}커밋 뒤처져 있다.`,
    `  이대로 배포하면 라이브가 ${behind}커밋 후퇴한다.\n` +
    `  git merge --ff-only ${live.slice(0, 8)} 로 먼저 따라잡아라`);
}

const ahead = git('rev-list', '--count', `${live}..${head}`);
if (!isAncestor(live, head)) console.log(`  ⚠ 라이브와 갈라져 있다 (라이브에만 있는 커밋 ${git('rev-list', '--count', `${head}..${live}`)}개). 그래도 전진 배포라 통과한다`);
console.log(`  라이브보다 ${ahead}커밋 앞선다 — 통과`);
