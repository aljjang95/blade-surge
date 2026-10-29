// 계정 후속(지휘 2026-10-29): 탈퇴 시 소셜 허브 정리, 미접속 게스트 보관·복원, 계정 표시(test).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createSocialHub } from '../packages/tll-social/src/server/hub';
import { SOCIAL_CONFIG } from '../src/social/config.js';
import { newDeviceKey, T0, v1Harness } from './helpers/v1-harness';
import { archiveIdleGuests, IDLE_MS, restoreIdle } from '../worker/v1/archive';

// 실제 SocialHub + 가짜 WebSocket(열린 소켓·close 코드·수신 메시지를 볼 수 있다). v1 하네스의 허브는 소켓을 받지 못해 따로 만든다.
class FakeSocket {
  sent: any[] = []; att: unknown = null; tags: string[] = []; closed: { code?: number; reason?: string } | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  serializeAttachment(v: unknown) { this.att = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.att); }
}
function socketHub() {
  const sqlite = new Database(':memory:');
  const sockets: FakeSocket[] = [];
  let t = T0;
  const ctx = {
    storage: { sql: { exec: (q: string, ...b: any[]) => { const rows = sqlite.query(q).all(...b); return { toArray: () => rows }; } }, transactionSync: <T>(fn: () => T) => sqlite.transaction(fn)() as T },
    acceptWebSocket(ws: FakeSocket, tags: string[] = []) { ws.tags = tags; sockets.push(ws); },
    getWebSockets: (tag?: string) => sockets.filter(s => !tag || s.tags.includes(tag)), waitUntil() {},
  };
  const Hub = createSocialHub(SOCIAL_CONFIG as any, { now: () => t, createPair: () => [new FakeSocket(), new FakeSocket()] as any, upgradeResponse: () => Response.json({}) });
  const hub = new Hub(ctx as any, {});
  const call = async (method: string, path: string, key?: string, body?: unknown) => {
    const headers: Record<string, string> = { 'x-social-ip': 'ip-test' };
    if (key) headers['x-social-key'] = key;
    const res = await hub.fetch(new Request('https://social.internal' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() as any };
  };
  const connect = async (key: string) => {
    const { ticket } = (await call('POST', '/ws-ticket', key)).body;
    await call('GET', '/ws?ticket=' + ticket);
    const ws = sockets[sockets.length - 1];
    await hub.webSocketMessage(ws as any, JSON.stringify({ t: 'hello' }));
    return ws;
  };
  const say = (ws: FakeSocket, m: unknown) => hub.webSocketMessage(ws as any, JSON.stringify(m));
  return { advance: (ms: number) => { t += ms; }, namespace: { idFromName: (n: string) => n, get: () => hub }, call, connect, say };
}

describe('회원 탈퇴 → 소셜 허브 정리', () => {
  test('탈퇴하면 그 플레이어의 열린 소켓이 4003으로 닫히고 파티 메시지가 더 이상 오지 않는다', async () => {
    const sh = socketHub();
    const h = await v1Harness({ env: { SOCIAL: sh.namespace as any } });
    const key = newDeviceKey(), otherKey = newDeviceKey();
    const profile = (await sh.call('POST', '/profile', key, { name: '떠날소켓' })).body;
    await sh.call('POST', '/profile', otherKey, { name: '남는소켓' });
    const gone = await sh.connect(key), stay = await sh.connect(otherKey);
    const party = 'party:ABCDEF0123456789ABCD';
    await sh.say(gone, { t: 'join', channel: party });
    await sh.say(stay, { t: 'join', channel: party });
    await sh.say(stay, { t: 'say', channel: party, text: '탈퇴 전', nonce: 'before-0001' });
    expect(gone.sent.some(m => m.t === 'msg' && m.m.text === '탈퇴 전')).toBe(true); // 대조: 탈퇴 전에는 받는다
    const s = await h.session(key);
    expect(s.accountId).toBe(profile.id);
    expect((await h.send('POST', '/auth/delete', { confirm: 'DELETE' }, s.token)).body).toEqual({ ok: true });
    expect(gone.closed?.code).toBe(4003);
    expect(stay.closed).toBeNull();
    const received = gone.sent.length;
    sh.advance(2000); // 채팅 최소 간격
    await sh.say(stay, { t: 'say', channel: party, text: '탈퇴 후', nonce: 'after-0002' });
    expect(stay.sent.some(m => m.t === 'msg' && m.m.text === '탈퇴 후')).toBe(true);
    expect(gone.sent.length).toBe(received);
    expect(gone.sent.some(m => m.t === 'msg' && m.m.text === '탈퇴 후')).toBe(false);
  });
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
    const row = q('SELECT tag, hero, created_ip_hash FROM players WHERE id = ?', profile.id);
    expect(String(row.tag).startsWith('x')).toBe(true);
    expect(row.hero).toBeNull();
    expect(row.created_ip_hash).toBeNull();
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
  test('조회 뒤 배치 전에 게스트가 돌아와(last_seen 갱신) 있으면 문서를 지우지도 플래그를 만들지도 않는다', async () => {
    const h = await v1Harness();
    const idle = await h.session();
    h.advance(IDLE_MS + 1000);
    const before = h.db.sqlite.query("SELECT rev, doc FROM account_docs WHERE account_id = ?").get(idle.accountId) as any;
    let raced = false;
    const racing = {
      prepare: (q: string) => h.db.prepare(q),
      batch: async (stmts: any[]) => {
        if (!raced) { raced = true; h.db.sqlite.exec(`UPDATE accounts SET last_seen = ${h.now()} WHERE account_id = '${idle.accountId}'`); } // SELECT 뒤 돌아온 게스트
        return h.db.batch(stmts);
      },
    };
    expect(await archiveIdleGuests(racing as any, h.now())).toBe(0);
    expect(raced).toBe(true);
    expect(h.db.sqlite.query("SELECT rev, doc FROM account_docs WHERE account_id = ?").get(idle.accountId)).toEqual(before);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM account_archive WHERE account_id = ?").get(idle.accountId)).toEqual({ n: 0 });
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM account_flags WHERE account_id = ? AND flag = 'idle-archived'").get(idle.accountId)).toEqual({ n: 0 });
  });
  test('복원 실패 뒤 last_seen이 최근인 상태에서 재시도해도 문서가 복원되고 /me가 200이다', async () => {
    const h = await v1Harness();
    const idle = await h.session();
    h.advance(IDLE_MS + 1000);
    expect(await archiveIdleGuests(h.db as any, h.now())).toBe(1);
    h.db.sqlite.exec(`UPDATE accounts SET last_seen = ${h.now()} WHERE account_id = '${idle.accountId}'`); // 앞선 복원이 실패한 채 접속 시각만 갱신된 상태
    const back = await h.session(idle.deviceKey);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM account_docs WHERE account_id = ?").get(idle.accountId)).toEqual({ n: 1 });
    expect((await h.send('GET', '/me', undefined, back.token)).status).toBe(200);
  });
});
