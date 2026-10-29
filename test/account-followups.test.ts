// 계정 후속(지휘 2026-10-29): 탈퇴 시 소셜 허브 정리, 미접속 게스트 보관·복원, 계정 표시(test).
import { describe, expect, test } from 'bun:test';
import { newDeviceKey, v1Harness } from './helpers/v1-harness';
import { archiveIdleGuests, IDLE_MS, restoreIdle } from '../worker/v1/archive';

describe('회원 탈퇴 → 소셜 허브 정리', () => {
  test('기기 키·친구가 지워지고 이름이 익명화된다. 같은 키로는 다시 입양되지 않는다', async () => {
    const h = await v1Harness({ social: true });
    const key = newDeviceKey(), friendKey = newDeviceKey();
    const profile = (await h.social!.call('POST', '/profile', key, { name: '떠날모험가' })).body;
    const friend = (await h.social!.call('POST', '/profile', friendKey, { name: '남는친구' })).body;
    await h.social!.call('POST', '/friends/request', key, { playerId: friend.id });
    await h.social!.call('POST', '/friends/respond', friendKey, { playerId: profile.id, accept: true });
    const s = await h.session(key);
    expect(s.accountId).toBe(profile.id);
    expect((await h.send('POST', '/auth/delete', { confirm: 'DELETE' }, s.token)).body).toEqual({ ok: true });
    const q = (sql: string, ...b: any[]) => h.social!.sqlite.query(sql).get(...b) as any;
    expect(q('SELECT COUNT(*) AS n FROM player_keys WHERE player_id = ?', profile.id)).toEqual({ n: 0 });
    expect(q('SELECT COUNT(*) AS n FROM friends WHERE a = ? OR b = ?', profile.id, profile.id)).toEqual({ n: 0 });
    expect(q('SELECT name FROM players WHERE id = ?', profile.id)).toEqual({ name: '탈퇴한 모험가' });
    // 남은 친구의 목록에서도 사라진다.
    expect((await h.social!.call('GET', '/me', friendKey)).body.friends).toEqual([]);
    // 허브가 실패하면 탈퇴를 진행하지 않는다.
    const h2 = await v1Harness({ social: true });
    const s2 = await h2.session();
    (h2.env as any).SOCIAL = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}', { status: 500 }) }) };
    expect((await h2.send('POST', '/auth/delete', { confirm: 'DELETE' }, s2.token)).body.error).toBe('social-unavailable');
    expect(h2.db.sqlite.query('SELECT status FROM accounts WHERE account_id = ?').get(s2.accountId)).toEqual({ status: 'active' });
  });
});

describe('미접속 게스트 보관(영구 삭제 아님)', () => {
  test('180일 미접속·연동 없음·무결제·저레벨만 보관 → 같은 기기로 돌아오면 같은 진행 복원', async () => {
    const h = await v1Harness();
    const idle = await h.session(), linked = await h.session(), paid = await h.session(), tester = await h.session(), recent = await h.session();
    h.google.set('g', 'sub-1');
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'g' }, linked.token);
    h.db.sqlite.exec(`UPDATE accounts SET gems_paid = 10 WHERE account_id = '${paid.accountId}'`);
    h.db.sqlite.exec(`INSERT INTO account_flags(account_id, flag, at) VALUES ('${tester.accountId}', 'test', 1)`);
    const before = h.db.sqlite.query("SELECT rev, doc FROM account_docs WHERE account_id = ?").get(idle.accountId) as any;
    h.advance(IDLE_MS + 1000);
    await h.session(recent.deviceKey); // 최근 접속
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(1);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM account_docs WHERE account_id = ?").get(idle.accountId)).toEqual({ n: 0 });
    expect(h.db.sqlite.query("SELECT reason FROM account_archive WHERE account_id = ?").get(idle.accountId)).toEqual({ reason: 'idle' });
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({ n: 5 }); // 계정 행은 남는다
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(0); // 멱등
    // 돌아옴: 같은 기기 키 → 같은 계정, 같은 rev·문서
    const back = await h.session(idle.deviceKey);
    expect(back.accountId).toBe(idle.accountId);
    expect(h.db.sqlite.query("SELECT rev, doc FROM account_docs WHERE account_id = ?").get(idle.accountId)).toEqual(before);
    expect((await h.send('GET', '/me', undefined, back.token)).status).toBe(200);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM account_flags WHERE account_id = ?").get(idle.accountId)).toEqual({ n: 0 });
    expect(await restoreIdle(h.db as any, idle.accountId, h.now())).toBe(false);
  });
});
