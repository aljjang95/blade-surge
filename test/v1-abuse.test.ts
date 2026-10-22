import { describe, expect, test } from 'bun:test';
import { newDeviceKey, v1Harness } from './helpers/v1-harness';
import { sha256Hex } from '../worker/v1/token';
import { LIMITS } from '../worker/v1/limit';
import { AUDIT_FLAGS_PER_ACCOUNT } from '../worker/v1/runs';

const ip = (n: number) => ({ 'cf-connecting-ip': `203.0.113.${n}` });

describe('MMO P1 남용 제한 (IP 해시·계정별 레이트 리밋)', () => {
  test('/auth/session: IP당 창 한도 초과는 429, 다른 IP·다음 창은 통과', async () => {
    const h = await v1Harness();
    const key = newDeviceKey();
    const [max] = LIMITS.session;
    for (let i = 0; i < max; i++) expect((await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(1))).status).toBe(200);
    const over = await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(1));
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('rate');
    expect(over.body.retryAfter).toBeGreaterThan(0);
    expect((await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(2))).status).toBe(200);
    h.advance(LIMITS.session[1]);
    expect((await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(1))).status).toBe(200);
    // 저장되는 키는 원문 IP가 아니다.
    const rows = h.db.sqlite.query('SELECT key FROM v1_rate').all() as { key: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
  });

  test('/auth/session: 새 계정 생성은 IP당 시간 한도, 기존 키 갱신은 영향 없음', async () => {
    const h = await v1Harness();
    const existing = newDeviceKey();
    expect((await h.send('POST', '/auth/session', { deviceKey: existing }, undefined, ip(3))).status).toBe(200);
    for (let i = 1; i < LIMITS.sessionNew[0]; i++) expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() }, undefined, ip(3))).status).toBe(200);
    const blocked = await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() }, undefined, ip(3));
    expect(blocked.status).toBe(429);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: LIMITS.sessionNew[0] });
    expect((await h.send('POST', '/auth/session', { deviceKey: existing }, undefined, ip(3))).status).toBe(200);
    expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() }, undefined, ip(4))).status).toBe(200);
  });

  test('/auth/recover: IP당 한도, 한도는 제공자 검증 전에 적용된다', async () => {
    const h = await v1Harness();
    let verified = 0;
    const deps = { ...h.deps, verifyIdToken: async (...args: Parameters<typeof h.deps.verifyIdToken>) => { verified++; return h.deps.verifyIdToken(...args); } };
    const { handleV1Request } = await import('../worker/v1/router');
    const call = (headers: Record<string, string>) => handleV1Request(new Request('https://blade.example/api/v1/auth/recover', {
      method: 'POST', headers: { origin: 'https://blade.example', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ provider: 'google', idToken: 'nobody', deviceKey: newDeviceKey() }) }), h.env, deps);
    for (let i = 0; i < LIMITS.recover[0]; i++) expect((await call(ip(5))).status).toBe(401);
    const verifiedBefore = verified;
    const over = await call(ip(5));
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(verified).toBe(verifiedBefore);
    expect((await call(ip(6))).status).toBe(401);
  });

  test('/import: IP당 한도 초과는 429', async () => {
    const h = await v1Harness();
    const a = await h.session();
    for (let i = 0; i < LIMITS.import[0]; i++) expect((await h.send('POST', '/import', { installId: 'bad', save: {} }, a.token, ip(7))).status).toBe(400);
    expect((await h.send('POST', '/import', { installId: 'bad', save: {} }, a.token, ip(7))).status).toBe(429);
    expect((await h.send('POST', '/import', { installId: 'bad', save: {} }, a.token, ip(8))).status).toBe(400);
  });

  test('/cmd·/runs/start: 계정별 상한, 다른 계정은 영향 없음', async () => {
    const h = await v1Harness();
    const a = await h.session(), b = await h.session();
    const cmd = (token: string) => h.send('POST', '/cmd', { cid: 'rate-cmd-0001', op: 'nope', args: [] }, token);
    for (let i = 0; i < LIMITS.cmd[0]; i++) expect((await cmd(a.token)).status).toBe(400);
    expect((await cmd(a.token)).status).toBe(429);
    expect((await cmd(b.token)).status).toBe(400);
    const start = (token: string) => h.send('POST', '/runs/start', { kind: 'campaign', contentId: '9-9', heroId: 'knight', cid: 'rate-run-0001' }, token);
    for (let i = 0; i < LIMITS.runStart[0]; i++) expect((await start(a.token)).status).toBe(400);
    expect((await start(a.token)).status).toBe(429);
    expect((await start(b.token)).status).toBe(400);
    h.advance(60_000);
    expect((await cmd(a.token)).status).toBe(400);
  });

  test('만료된 카운터 행은 새 창에서 정리된다', async () => {
    const h = await v1Harness();
    const key = newDeviceKey();
    await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(9));
    h.advance(3 * 3600_000);
    await h.send('POST', '/auth/session', { deviceKey: key }, undefined, ip(10));
    const rows = h.db.sqlite.query("SELECT key FROM v1_rate WHERE key LIKE 'session:%'").all();
    expect(rows.length).toBe(1);
  });
});

describe('MMO P1 계정 P2 보강', () => {
  // 소유자 확인(SELECT) 뒤 INSERT 직전에 끼어든 경쟁 쓰기를 흉내 낸다.
  const raceBeforeInsert = (h: Awaited<ReturnType<typeof v1Harness>>, rival: () => void) => {
    const prepare = h.db.prepare.bind(h.db);
    let fired = false;
    h.db.prepare = (sql: string) => {
      const st = prepare(sql);
      if (!sql.startsWith('INSERT INTO account_links')) return st;
      const wrap = (inner: typeof st): typeof st => ({ ...inner, bind: (...v) => wrap(inner.bind(...v)), run: async () => { if (!fired) { fired = true; rival(); } return inner.run(); } });
      return wrap(st);
    };
    return () => fired;
  };

  test('link UNIQUE 경합(PRIMARY KEY)은 500이 아니라 409 linked-elsewhere', async () => {
    const h = await v1Harness();
    h.google.set('tok-shared', 'sub-shared');
    const a = await h.session(), b = await h.session();
    const hash = await sha256Hex('google:sub-shared');
    const fired = raceBeforeInsert(h, () => h.db.sqlite.query("INSERT INTO account_links(provider, subject_hash, account_id, created_at) VALUES ('google', ?, ?, 1)").run(hash, b.accountId));
    const r = await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-shared' }, a.token);
    expect(fired()).toBe(true);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('linked-elsewhere');
    expect(r.body.other.accountId).toBe(b.accountId);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_links').get()).toEqual({ n: 1 });
  });

  test('link UNIQUE 경합((provider, account_id))은 409 already-linked', async () => {
    const h = await v1Harness();
    h.google.set('tok-1', 'sub-1');
    const a = await h.session();
    const fired = raceBeforeInsert(h, () => h.db.sqlite.query("INSERT INTO account_links(provider, subject_hash, account_id, created_at) VALUES ('google', ?, ?, 1)").run('f'.repeat(64), a.accountId));
    const r = await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-1' }, a.token);
    expect(fired()).toBe(true);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('already-linked');
  });

  test('unlink: 본인 연동의 ID 토큰이 있어야 해제된다', async () => {
    const h = await v1Harness();
    h.google.set('tok-me', 'sub-me'); h.google.set('tok-other', 'sub-other');
    const a = await h.session();
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-me' }, a.token);
    expect((await h.send('POST', '/auth/unlink', { provider: 'google' }, a.token)).status).toBe(400);
    expect((await h.send('POST', '/auth/unlink', { provider: 'google', idToken: 'forged' }, a.token)).status).toBe(401);
    expect((await h.send('POST', '/auth/unlink', { provider: 'google', idToken: 'tok-other' }, a.token)).body.error).toBe('reauth-mismatch');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_links').get()).toEqual({ n: 1 });
    expect((await h.send('POST', '/auth/unlink', { provider: 'google', idToken: 'tok-me' }, a.token)).body.linked).toEqual([]);
  });

  test('recover: 현재 기기 키 계정이 차단 상태면 다른 계정으로 갈아탈 수 없다', async () => {
    const h = await v1Harness();
    h.google.set('tok-clean', 'sub-clean');
    const clean = await h.session();
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-clean' }, clean.token);
    const cheater = await h.session();
    h.db.sqlite.query("UPDATE accounts SET status = 'banned' WHERE account_id = ?").run(cheater.accountId);
    const r = await h.send('POST', '/auth/recover', { provider: 'google', idToken: 'tok-clean', deviceKey: cheater.deviceKey });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('banned');
    expect(h.db.sqlite.query('SELECT account_id FROM account_keys WHERE account_id = ?').all(cheater.accountId).length).toBe(1);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_archive').get()).toEqual({ n: 0 });
  });

  test('audit_flags: 계정당 상한 이후에는 플래그가 늘지 않는다', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const t = await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'flag-start-01' }, a.token);
    expect(t.status).toBe(200);
    for (let i = 0; i < AUDIT_FLAGS_PER_ACCOUNT + 25; i++) {
      expect((await h.send('POST', `/runs/${t.body.runId}/settle`, { win: 'yes' }, a.token)).status).toBe(400);
    }
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM audit_flags WHERE account_id = ?').get(a.accountId)).toEqual({ n: AUDIT_FLAGS_PER_ACCOUNT });
  });
});
