// MMO P1 완료 게이트: 실제 로컬 workerd(miniflare) + D1 + SocialHub DO로 게스트→임포트→런 시작→정산→/me 일치를 증명한다.
// 네트워크 배포 없음. 실행: node tools/v1-proof.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const ORIGIN = 'https://blade.example';
const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser',
  loader: { '.css': 'empty' }, conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*'] });
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'v1-proof',
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
  bindings: { APP_ORIGIN: ORIGIN, V1_ENABLED: 'true', V1_SERVER_AUTHORITY_PERCENT: '100', SESSION_HMAC: 'proof-secret-'.padEnd(48, 'x'), DIALOGUE_ENABLED: 'false', GOOGLE_CLIENT_IDS: '' },
  d1Databases: { COMMERCE_DB: 'v1-proof' },
  durableObjects: { SOCIAL: { className: 'SocialHub', useSQLite: true }, PARTIES: { className: 'PartyRoom', useSQLite: true }, DIALOGUE_BUDGET: { className: 'DialogueBudget', useSQLite: true } },
}));
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
try {
  const db = await mf.getD1Database('COMMERCE_DB');
  const closed = await mf.dispatchFetch(ORIGIN + '/api/v1/me', { headers: { origin: ORIGIN } });
  assert.equal(closed.status, 503); step('스키마 미적용이면 v1 닫힘(503)', true);
  for (const file of readdirSync('worker/v1/migrations').filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync('worker/v1/migrations/' + file, 'utf8').split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    const statements = sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean).map(s => db.prepare(s));
    await db.batch(statements); await db.batch(statements);
  }
  step('D1 마이그레이션 2회 적용(재적용 무해)', true);
  const call = async (method, path, body, token) => {
    const headers = { origin: ORIGIN };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await mf.dispatchFetch(ORIGIN + '/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const deviceKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  // 기존 소셜 프로필이 있는 기기 키 → 같은 playerId 입양
  const profile = await mf.dispatchFetch(ORIGIN + '/api/social/profile', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer ' + deviceKey }, body: JSON.stringify({ name: '증명모험가' }) });
  const social = await profile.json();
  const session = await call('POST', '/auth/session', { deviceKey });
  assert.equal(session.status, 200); assert.equal(session.body.accountId, social.id);
  step('게스트 세션 + 소셜 playerId 입양', true, session.body.accountId);
  const token = session.body.token;
  assert.equal(session.body.authority, 'server');
  const legacySave = JSON.parse(readFileSync('test/fixtures/saves/mid.json', 'utf8'));
  const imported = await call('POST', '/import', { installId: crypto.randomUUID(), save: legacySave }, token);
  assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.equal(imported.body.status, 'imported');
  step('로컬 세이브 임포트(정화)', true, `gold ${imported.body.doc.gold} · unlocked ${imported.body.doc.progress.unlocked}`);
  const start = await call('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'proof-start-1' }, token);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  step('런 티켓 발급(서버 시계 에너지 차감)', true, `energy ${start.body.energy}`);
  const forged = await call('POST', `/runs/${start.body.runId}/settle`, { win: true, elapsedMs: 1000, kills: { normal: 9999, elite: 0, boss: 1 }, stars: 3 }, token);
  assert.equal(forged.body.verdict, 'rejected'); assert.equal(forged.body.got.length, 0);
  step('위조 정산(초단시간·처치 초과) 지급 0', true, forged.body.issues.join(','));
  const start2 = await call('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'proof-start-2' }, token);
  // 실제 시계 경과가 최소 클리어 시간보다 짧으므로 티켓 시작 시각을 과거로 옮긴다(증명 전용 D1 조작).
  await db.prepare('UPDATE run_tickets SET started_at = started_at - 120000 WHERE run_id = ?').bind(start2.body.runId).run();
  const settle = await call('POST', `/runs/${start2.body.runId}/settle`, { win: true, elapsedMs: 90000, kills: { normal: 40, elite: 2, boss: 1 }, roomsCleared: 5, hpLost: 300, revives: 0, damageDealt: 1000, stars: 3 }, token);
  assert.equal(settle.status, 200, JSON.stringify(settle.body)); assert.equal(settle.body.verdict, 'ok');
  step('정상 정산 영수증', true, `got ${settle.body.got.length} · loot ${settle.body.loot.length}`);
  const me = await call('GET', '/me', undefined, token);
  assert.equal(me.body.rev, settle.body.rev); assert.equal(me.body.stateHash, settle.body.stateHash);
  assert.equal(me.body.doc.gold, settle.body.doc.gold);
  step('/me = 정산 문서(rev·상태 해시·골드)', true, `rev ${me.body.rev}`);
  const replay = await call('POST', `/runs/${start2.body.runId}/settle`, { win: true, elapsedMs: 90000, kills: { normal: 40, elite: 2, boss: 1 }, stars: 3 }, token);
  assert.equal(replay.body.replayed, true);
  const after = await call('GET', '/me', undefined, token);
  assert.equal(after.body.doc.gold, me.body.doc.gold);
  step('정산 재전송 멱등(추가 지급 없음)', true);
  const internal = await mf.dispatchFetch(ORIGIN + '/api/social/internal/account', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(internal.status, 404); step('소셜 내부 API 공개 차단', true);
} catch (error) {
  step('예외', false, error?.message);
  process.exitCode = 1;
} finally { await mf.dispose(); }
console.log(JSON.stringify({ proof: 'v1', pass: results.every(r => r.ok), steps: results.length }));
