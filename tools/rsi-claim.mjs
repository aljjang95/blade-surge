#!/usr/bin/env node
/**
 * rsi-claim — 회전 축 선점 락. 예약 세션 여러 개가 같은 축을 동시에 잡는 걸 막는다.
 *
 * 왜 필요한가: 2026-09-03 에 세 세션이 같은 날 회전 7 을 각자 구현해 서로 못 합치는 패치가 두 벌 생겼다.
 * 브랜치·PR 로는 못 막는다 — 충돌은 코드가 아니라 **무엇을 할지 고르는 순간**에 생긴다.
 * D1 의 PRIMARY KEY 충돌을 원자적 락으로 쓴다(같은 축 INSERT 는 하나만 성공).
 *
 *   node tools/rsi-claim.mjs status                  # 현재 잡힌 축 + 최근 회전 기록
 *   node tools/rsi-claim.mjs claim <축> [메모]        # 선점. 이미 잡혀 있으면 exit 2
 *   node tools/rsi-claim.mjs done  <축> [번들키]      # 완료 기록 + 락 해제
 *   node tools/rsi-claim.mjs fail  <축> [사유]        # 실패 기록 + 락 해제
 *   node tools/rsi-claim.mjs steal <축>               # 6시간 넘게 running 인 죽은 락 회수
 *
 * 필요한 것: CLOUDFLARE_API_TOKEN (session-auth 뿌리 토큰)
 */
import { execFileSync } from 'child_process';

const ACC = process.env.CLOUDFLARE_ACCOUNT_ID || 'b761ad56f2b49b27a0f8eaf0928848a3';
const DB = process.env.APEX_RSI_DB || '1e1295d4-01b8-4877-951e-8c100b4d7473';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const REPO = process.env.GH_REPO || 'aljjang95/blade-surge';
const SESSION = process.env.CLAUDE_SESSION_ID || process.env.SESSION || `pid-${process.pid}-${Date.now().toString(36)}`;
const STALE_HOURS = 6;
if (!TOKEN) { console.error('CLOUDFLARE_API_TOKEN 이 없다 — session-auth 스킬을 읽어라'); process.exit(1); }

async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${DB}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('D1: ' + JSON.stringify(j.errors));
  return j.result[0];
}
const now = () => new Date().toISOString();
const headSha = () => { try { return execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(); } catch { return null; } };

const [cmd, axis, ...rest] = process.argv.slice(2);
const note = rest.join(' ') || null;

if (cmd === 'status' || !cmd) {
  const cl = await q('SELECT axis, session, started_at, note FROM rsi_claim WHERE repo = ? ORDER BY started_at', [REPO]);
  const lg = await q('SELECT axis, status, head_sha, bundle, finished_at FROM rsi_log WHERE repo = ? ORDER BY id DESC LIMIT 8', [REPO]);
  console.log('■ 지금 잡혀 있는 축');
  if (!cl.results.length) console.log('  (없음 — 아무 축이나 잡아도 된다)');
  for (const c of cl.results) {
    const age = (Date.now() - Date.parse(c.started_at)) / 3600000;
    console.log(`  ${c.axis}  ${age.toFixed(1)}h 전  session=${c.session.slice(0, 12)}${age > STALE_HOURS ? '  ← 죽은 락일 수 있다 (steal 가능)' : ''}${c.note ? '  · ' + c.note : ''}`);
  }
  console.log('\n■ 최근 회전');
  for (const l of lg.results) console.log(`  ${l.finished_at?.slice(0, 16) || '?'}  ${l.status.padEnd(6)} ${l.axis}${l.head_sha ? '  ' + l.head_sha.slice(0, 8) : ''}${l.bundle ? '  ' + l.bundle : ''}`);
  process.exit(0);
}

if (!axis) { console.error('축을 지정해라 (예: PRD-4-3)'); process.exit(1); }

if (cmd === 'claim') {
  try {
    await q('INSERT INTO rsi_claim (repo, axis, session, base_sha, started_at, note) VALUES (?, ?, ?, ?, ?, ?)', [REPO, axis, SESSION, headSha(), now(), note]);
    console.log(`선점 성공: ${axis}`);
    process.exit(0);
  } catch (e) {
    const cur = await q('SELECT session, started_at FROM rsi_claim WHERE repo = ? AND axis = ?', [REPO, axis]);
    const c = cur.results[0];
    if (!c) { console.error('선점 실패(원인 불명): ' + e.message); process.exit(1); }
    const age = (Date.now() - Date.parse(c.started_at)) / 3600000;
    console.error(`이미 잡혀 있다: ${axis} — session=${c.session.slice(0, 12)}, ${age.toFixed(1)}h 전`);
    console.error(age > STALE_HOURS ? `  ${STALE_HOURS}시간이 지났다. 회수하려면: node tools/rsi-claim.mjs steal ${axis}` : '  다른 축을 골라라 (status 로 확인)');
    process.exit(2);
  }
}

if (cmd === 'steal') {
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600000).toISOString();
  const r = await q('UPDATE rsi_claim SET session = ?, started_at = ?, base_sha = ? WHERE repo = ? AND axis = ? AND started_at < ?', [SESSION, now(), headSha(), REPO, axis, cutoff]);
  const ok = r.meta.changes > 0;
  console.log(ok ? `회수 성공: ${axis}` : `회수 실패 — ${STALE_HOURS}시간이 안 지났다`);
  process.exit(ok ? 0 : 2);
}

if (cmd === 'done' || cmd === 'fail') {
  const cur = await q('SELECT session, base_sha, started_at FROM rsi_claim WHERE repo = ? AND axis = ?', [REPO, axis]);
  const c = cur.results[0] || {};
  await q('INSERT INTO rsi_log (repo, axis, session, status, base_sha, head_sha, bundle, started_at, finished_at, note) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [REPO, axis, c.session || SESSION, cmd === 'done' ? 'done' : 'failed', c.base_sha || null, headSha(), cmd === 'done' ? note : null, c.started_at || null, now(), cmd === 'fail' ? note : null]);
  await q('DELETE FROM rsi_claim WHERE repo = ? AND axis = ?', [REPO, axis]);
  console.log(`${cmd === 'done' ? '완료' : '실패'} 기록 + 락 해제: ${axis}`);
  process.exit(0);
}

console.error('알 수 없는 명령. status | claim | done | fail | steal');
process.exit(1);
