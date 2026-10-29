// 보관·파기·남용 방지 묘비(지휘 2026-10-29, docs/ACCOUNT_POLICY.md 7장).
import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { archiveIdleGuests, IDLE_MS, IDLE_PURGE_MS, restoreIdle } from '../worker/v1/archive';
import { purgeExpiredArchives, purgeWithdrawnAccounts, runRetention } from '../worker/v1/retention';
import { BANNED_TOMBSTONE_MS, hasRecentTombstone, purgeExpiredTombstones, syncBannedTombstones, WITHDRAWN_TOMBSTONE_MS } from '../worker/v1/tombstone';
import { providerSubject } from '../worker/v1/auth';

const DAY = 24 * 3600 * 1000;
type H = Awaited<ReturnType<typeof v1Harness>>;
const q = (h: H, sql: string, ...b: any[]) => h.db.sqlite.query(sql).get(...b) as any;
const count = (h: H, table: string, id: string) => q(h, `SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`, id).n;

/** 구글 연동 계정을 만들고 진행 흔적(우편·레거시·원장)을 심은 뒤 탈퇴시킨다. */
async function withdraw(h: H, sub = 'sub-w') {
  const s = await h.session();
  h.google.set('g-' + sub, sub);
  await h.send('POST', '/auth/link', { provider: 'google', idToken: 'g-' + sub }, s.token);
  h.db.sqlite.exec(`INSERT INTO mail(mail_id, account_id, kind, title, rewards, created_at, expires_at) VALUES ('m:${s.accountId}', '${s.accountId}', 'x', 't', '{}', 1, 2)`);
  h.db.sqlite.exec(`INSERT INTO legacy_saves(legacy_id, account_id, uploaded_at, doc, report, status) VALUES ('${s.accountId.padEnd(64, 'a')}', '${s.accountId}', 1, '{}', '{}', 'shadow')`);
  h.db.sqlite.exec(`INSERT INTO wallet_ledger(op_id, account_id, kind, delta, receipt, rev_after, at) VALUES ('iap:${s.accountId}', '${s.accountId}', 'iap', '{}', 'r', 1, 1)`);
  expect((await h.send('POST', '/auth/delete', { confirm: 'DELETE' }, s.token)).body).toEqual({ ok: true });
  return s;
}

describe('탈퇴 파기(30일)', () => {
  test('보관 기한 전에는 그대로, 기한이 지나면 진행 데이터를 지우고 deleted로 익명화한다. 결제 원장은 남는다', async () => {
    const h = await v1Harness();
    const s = await withdraw(h);
    const due = q(h, "SELECT purge_at FROM account_archive WHERE account_id = ?", s.accountId).purge_at;
    h.setNow(due - 1);
    expect(await purgeWithdrawnAccounts(h.db as any, h.now())).toBe(0);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', s.accountId).status).toBe('deleting');
    expect(count(h, 'account_docs', s.accountId)).toBe(1);
    h.setNow(due);
    expect(await purgeWithdrawnAccounts(h.db as any, h.now())).toBe(1);
    for (const t of ['account_docs', 'legacy_saves', 'mail', 'account_archive', 'account_keys', 'account_links']) expect([t, count(h, t, s.accountId)]).toEqual([t, 0]);
    expect(q(h, 'SELECT status, level, gold, guild_id FROM accounts WHERE account_id = ?', s.accountId)).toEqual({ status: 'deleted', level: 1, gold: 0, guild_id: null });
    expect(count(h, 'wallet_ledger', s.accountId)).toBe(1); // 결제분 보존
    expect(await purgeWithdrawnAccounts(h.db as any, h.now())).toBe(0); // 멱등
  });
  test('경쟁: 조회 뒤 계정이 deleting이 아니게 되면 아무것도 지우지 않는다', async () => {
    const h = await v1Harness();
    const s = await withdraw(h);
    h.setNow(q(h, "SELECT purge_at FROM account_archive WHERE account_id = ?", s.accountId).purge_at);
    let raced = false;
    const racing = { prepare: (x: string) => h.db.prepare(x), batch: async (st: any[]) => {
      if (!raced) { raced = true; h.db.sqlite.exec(`UPDATE accounts SET status = 'active' WHERE account_id = '${s.accountId}'`); }
      return h.db.batch(st);
    } };
    expect(await purgeWithdrawnAccounts(racing as any, h.now())).toBe(0);
    expect(raced).toBe(true);
    expect(count(h, 'account_docs', s.accountId)).toBe(1);
    expect(count(h, 'account_archive', s.accountId)).toBe(1);
  });
  test('1회 상한: 5건이 기한이어도 limit(3)만큼만', async () => {
    const h = await v1Harness();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await withdraw(h, 'sub-' + i)).accountId);
    h.setNow(h.now() + 31 * DAY);
    expect(await purgeWithdrawnAccounts(h.db as any, h.now(), 3)).toBe(3);
    expect(await purgeWithdrawnAccounts(h.db as any, h.now(), 3)).toBe(2);
    expect(q(h, "SELECT COUNT(*) AS n FROM accounts WHERE status = 'deleted'").n).toBe(5);
  });
});

describe('보관본 파기', () => {
  test('기기 이관 보관본(90일)은 기한이 지나야 지워진다', async () => {
    const h = await v1Harness();
    const guest = await h.session();
    const linked = await h.session();
    h.google.set('g', 'sub-1');
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'g' }, linked.token);
    await h.send('POST', '/auth/recover', { provider: 'google', idToken: 'g', deviceKey: guest.deviceKey });
    const row = q(h, "SELECT purge_at FROM account_archive WHERE reason LIKE 'switched:%'");
    h.setNow(row.purge_at - 1);
    expect((await purgeExpiredArchives(h.db as any, h.now())).archives).toBe(0);
    h.setNow(row.purge_at);
    expect((await purgeExpiredArchives(h.db as any, h.now())).archives).toBe(1);
    expect(q(h, "SELECT COUNT(*) AS n FROM account_archive").n).toBe(0);
  });
  test('미접속 게스트 보관본은 1년 뒤 파기되고 계정은 deleted, 돌아온 기기는 새 계정으로 되살아난다', async () => {
    const h = await v1Harness({ social: true });
    const idle = await h.session();
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(1);
    const due = q(h, "SELECT purge_at FROM account_archive WHERE account_id = ?", idle.accountId).purge_at;
    expect(due).toBe(h.now() + IDLE_PURGE_MS);
    h.setNow(due - 1);
    expect((await purgeExpiredArchives(h.db as any, h.now())).idleAccounts).toBe(0);
    h.setNow(due);
    expect((await purgeExpiredArchives(h.db as any, h.now())).idleAccounts).toBe(1);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', idle.accountId).status).toBe('deleted');
    for (const t of ['account_archive', 'account_flags', 'account_keys', 'account_docs']) expect([t, count(h, t, idle.accountId)]).toEqual([t, 0]);
    const back = await h.session(idle.deviceKey); // 같은 기기: 허브가 같은 playerId를 돌려준다
    expect(back.accountId).toBe(idle.accountId);
    expect(back.created).toBe(true);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', idle.accountId).status).toBe('active');
    expect((await h.send('GET', '/me', undefined, back.token)).status).toBe(200);
  });
  test('test 표시·결제 이력이 있는 계정은 idle 파기에서 제외된다', async () => {
    const h = await v1Harness();
    const tester = await h.session(), paid = await h.session(), plain = await h.session();
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(3);
    // 보관 뒤에 표시·결제가 생긴 경우도 파기 가드가 막는다.
    h.db.sqlite.exec(`INSERT INTO account_flags(account_id, flag, at) VALUES ('${tester.accountId}', 'test', 1)`);
    h.db.sqlite.exec(`UPDATE accounts SET gems_paid = 5 WHERE account_id = '${paid.accountId}'`);
    h.setNow(h.now() + IDLE_PURGE_MS + 1);
    expect((await purgeExpiredArchives(h.db as any, h.now())).idleAccounts).toBe(1);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', plain.accountId).status).toBe('deleted');
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', tester.accountId).status).toBe('active');
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', paid.accountId).status).toBe('active');
    expect(count(h, 'account_archive', tester.accountId)).toBe(1); // 보관본도 남는다
  });
  test('복원하면 쓴 보관본은 지워져 다시 보관돼도 옛 기한으로 앞당겨 파기되지 않는다', async () => {
    const h = await v1Harness();
    const idle = await h.session();
    h.advance(IDLE_MS + 1000);
    await archiveIdleGuests(h.db as any, h.now());
    await h.session(idle.deviceKey);
    expect(count(h, 'account_archive', idle.accountId)).toBe(0);
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(1);
    expect(q(h, 'SELECT purge_at FROM account_archive WHERE account_id = ?', idle.accountId).purge_at).toBe(h.now() + IDLE_PURGE_MS);
  });
});

describe('남용 방지 묘비', () => {
  test('탈퇴하면 연동 해시가 90일 묘비가 되고 원문 sub는 어디에도 없다', async () => {
    const h = await v1Harness();
    await withdraw(h, 'sub-secret-xyz');
    const hash = await providerSubject('google', 'sub-secret-xyz');
    const row = q(h, 'SELECT * FROM abuse_tombstones');
    expect(row).toEqual({ provider: 'google', subject_hash: hash, reason: 'withdrawn', created_at: h.now(), expires_at: h.now() + WITHDRAWN_TOMBSTONE_MS });
    expect(JSON.stringify(h.db.sqlite.query('SELECT * FROM abuse_tombstones').all())).not.toContain('sub-secret-xyz');
    expect(await hasRecentTombstone(h.db as any, 'google', hash, h.now())).toBe(true);
    expect(await hasRecentTombstone(h.db as any, 'kakao', hash, h.now())).toBe(false);
    expect(await hasRecentTombstone(h.db as any, 'google', hash, row.expires_at - 1)).toBe(true);
    expect(await hasRecentTombstone(h.db as any, 'google', hash, row.expires_at)).toBe(false);
  });
  test('묘비가 있어도 같은 제공자 계정으로 새 계정 연동·가입은 막지 않는다', async () => {
    const h = await v1Harness();
    await withdraw(h, 'sub-again');
    const s2 = await h.session();
    h.google.set('g2', 'sub-again');
    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'g2' }, s2.token)).status).toBe(200);
  });
  test('정지 계정의 연동은 1년 묘비, 만료된 묘비는 크론이 삭제한다', async () => {
    const h = await v1Harness();
    const s = await h.session();
    h.google.set('gb', 'sub-ban');
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'gb' }, s.token);
    h.db.sqlite.exec(`UPDATE accounts SET status = 'banned' WHERE account_id = '${s.accountId}'`);
    h.db.sqlite.exec(`INSERT INTO sanctions(account_id, kind, until, reason, by, at) VALUES ('${s.accountId}', 'ban', NULL, 't', 'gm', ${h.now()})`);
    const hash = await providerSubject('google', 'sub-ban');
    expect(await syncBannedTombstones(h.db as any, h.now())).toBe(1);
    expect(await syncBannedTombstones(h.db as any, h.now())).toBe(0); // 멱등
    const exp = q(h, 'SELECT expires_at, reason FROM abuse_tombstones');
    expect(exp).toEqual({ expires_at: h.now() + BANNED_TOMBSTONE_MS, reason: 'banned' });
    h.setNow(exp.expires_at - 1);
    expect(await purgeExpiredTombstones(h.db as any, h.now())).toBe(0);
    h.setNow(exp.expires_at);
    expect(await hasRecentTombstone(h.db as any, 'google', hash, h.now())).toBe(false);
    expect(await syncBannedTombstones(h.db as any, h.now())).toBe(0); // 1년 지난 정지는 되살리지 않는다
    expect(await purgeExpiredTombstones(h.db as any, h.now())).toBe(1);
    expect(q(h, 'SELECT COUNT(*) AS n FROM abuse_tombstones').n).toBe(0);
  });
  test('runRetention: 한 번의 크론이 파기·묘비 단계를 모두 돈다', async () => {
    const h = await v1Harness();
    await withdraw(h);
    h.setNow(h.now() + 91 * DAY);
    expect(await runRetention(h.db as any, h.now())).toEqual({ withdrawn: 1, archives: 0, idleAccounts: 0, tombstones: 1, banned: 0 });
  });
});

describe('idle 파기 후속(교차 리뷰)', () => {
  test('1) 파기된 게스트를 되살려도 옛 임포트·우편·원장 흔적이 없고 결제 원장은 남는다', async () => {
    const h = await v1Harness({ social: true });
    const idle = await h.session();
    const id = idle.accountId;
    h.db.sqlite.exec(`INSERT INTO mail(mail_id, account_id, kind, title, rewards, created_at, expires_at) VALUES ('m:${id}', '${id}', 'x', 't', '{}', 1, 2)`);
    h.db.sqlite.exec(`INSERT INTO legacy_saves(legacy_id, account_id, uploaded_at, doc, report, status) VALUES ('${id.padEnd(64, 'a')}', '${id}', 1, '{}', '{}', 'shadow')`);
    h.db.sqlite.exec(`INSERT INTO wallet_ledger(op_id, account_id, kind, delta, receipt, rev_after, at) VALUES ('import:x${id}', '${id}', 'import', '{}', 'r', 1, 1), ('cid:x${id}', '${id}', 'cmd:x', '{}', 'r', 1, 1), ('iap:x${id}', '${id}', 'iap:gem', '{}', 'r', 1, 1)`);
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(1);
    h.setNow(q(h, 'SELECT purge_at FROM account_archive WHERE account_id = ?', id).purge_at);
    expect((await purgeExpiredArchives(h.db as any, h.now())).idleAccounts).toBe(1);
    for (const t of ['legacy_saves', 'mail']) expect([t, count(h, t, id)]).toEqual([t, 0]);
    expect(q(h, "SELECT COUNT(*) AS n FROM wallet_ledger WHERE account_id = ? AND kind NOT LIKE 'iap%'", id).n).toBe(0);
    expect(q(h, "SELECT COUNT(*) AS n FROM wallet_ledger WHERE account_id = ? AND kind LIKE 'iap%'", id).n).toBe(1);
    const back = await h.session(idle.deviceKey);
    expect(back.created).toBe(true);
    expect(count(h, 'legacy_saves', id)).toBe(0);
  });
  test('2) restoreIdle 직후 파기가 끼어들면 복원 INSERT는 아무것도 되살리지 않는다', async () => {
    const h = await v1Harness();
    const idle = await h.session();
    const id = idle.accountId;
    h.advance(IDLE_MS + 1000);
    await archiveIdleGuests(h.db as any, h.now());
    h.setNow(q(h, 'SELECT purge_at FROM account_archive WHERE account_id = ?', id).purge_at);
    let raced = false;
    const racing = { prepare: (x: string) => h.db.prepare(x), batch: async (st: any[]) => {
      if (!raced) { raced = true; await purgeExpiredArchives(h.db as any, h.now()); }
      return h.db.batch(st);
    } };
    expect(await restoreIdle(racing as any, id, h.now())).toBe(false);
    expect(raced).toBe(true);
    expect(count(h, 'account_docs', id)).toBe(0);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', id).status).toBe('deleted');
  });
  test('2) 보관 뒤 돌아온(last_seen 갱신) 계정은 파기가 건드리지 않는다', async () => {
    const h = await v1Harness();
    const idle = await h.session();
    const id = idle.accountId;
    h.advance(IDLE_MS + 1000);
    await archiveIdleGuests(h.db as any, h.now());
    h.setNow(q(h, 'SELECT purge_at FROM account_archive WHERE account_id = ?', id).purge_at);
    h.db.sqlite.exec(`UPDATE accounts SET last_seen = ${h.now()} WHERE account_id = '${id}'`);
    expect((await purgeExpiredArchives(h.db as any, h.now())).idleAccounts).toBe(0);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', id).status).toBe('active');
    expect(count(h, 'account_archive', id)).toBe(1);
    expect(await restoreIdle(h.db as any, id, h.now())).toBe(true);
    expect(count(h, 'account_docs', id)).toBe(1);
  });
  test('3) 보호 대상이 limit개 이상 앞을 막아도 뒤의 정상 대상이 파기된다', async () => {
    const h = await v1Harness();
    // account_id 순서에서 정상 대상이 맨 뒤가 되게 한다(LIMIT이 앞의 보호 대상 3개에 먼저 걸리는 상황).
    const all = [await h.session(), await h.session(), await h.session(), await h.session()].sort((x, y) => x.accountId.localeCompare(y.accountId));
    const guards = all.slice(0, 3), plain = all[3];
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(4);
    for (const g of guards) h.db.sqlite.exec(`INSERT INTO account_flags(account_id, flag, at) VALUES ('${g.accountId}', 'test', 1)`);
    h.setNow(h.now() + IDLE_PURGE_MS + 1);
    expect((await purgeExpiredArchives(h.db as any, h.now(), 2)).idleAccounts).toBe(1);
    expect(q(h, 'SELECT status FROM accounts WHERE account_id = ?', plain.accountId).status).toBe('deleted');
  });
  test('4) 재제재하면 기존 banned 묘비 만료일이 새 기한으로 연장된다', async () => {
    const h = await v1Harness();
    const s = await h.session();
    h.google.set('gr', 'sub-reban');
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'gr' }, s.token);
    h.db.sqlite.exec(`UPDATE accounts SET status = 'banned' WHERE account_id = '${s.accountId}'`);
    h.db.sqlite.exec(`INSERT INTO sanctions(account_id, kind, until, reason, by, at) VALUES ('${s.accountId}', 'ban', NULL, 't', 'gm', ${h.now()})`);
    expect(await syncBannedTombstones(h.db as any, h.now())).toBe(1);
    const first = q(h, 'SELECT expires_at FROM abuse_tombstones').expires_at;
    const later = h.now() + 100 * DAY;
    h.setNow(later);
    h.db.sqlite.exec(`INSERT INTO sanctions(account_id, kind, until, reason, by, at) VALUES ('${s.accountId}', 'ban', NULL, 't2', 'gm', ${later})`);
    expect(await syncBannedTombstones(h.db as any, later)).toBe(1);
    expect(q(h, 'SELECT expires_at FROM abuse_tombstones').expires_at).toBe(later + BANNED_TOMBSTONE_MS);
    expect(later + BANNED_TOMBSTONE_MS).toBeGreaterThan(first);
    expect(await syncBannedTombstones(h.db as any, later)).toBe(0);
  });
});
