import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createSocialHub, type HubSocket } from '../src/server/hub';
import { handleSocialRequest } from '../src/server/router';
import type { GameConfig } from '../src/shared/protocol';

const CONFIG: GameConfig = {
  gameId: 'test-game', worldChannels: 2, worldCapacity: 50,
  contents: [{ id: 'cave', name: '동굴', minClearSec: 40 }],
  titleTiers: [{ id: 'first', maxRank: 1, label: '최초 정복자' }],
  founders: { maxNo: 10, titleId: 'founder', label: '창립 모험가' },
  completion: { titleId: 'conqueror', label: '전 지역 정복자' },
  dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
  bannedWords: [],
};
const APP = 'https://game.example.com';
const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

class FakeSocket implements HubSocket {
  sent: any[] = [];
  att: unknown = null;
  tags: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  // 실제 런타임처럼 직렬화된 복사본만 오간다.
  serializeAttachment(value: unknown) { this.att = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.att); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
}
function harness(env: Record<string, string> = {}) {
  const db = new Database(':memory:');
  let t = 1_800_000_000_000;
  const sockets: FakeSocket[] = [];
  const posted: { url: string; body: any }[] = [];
  const ctx = {
    storage: { sql: { exec: (q: string, ...b: any[]) => { const rows = db.query(q).all(...b); return { toArray: () => rows }; } }, transactionSync: <T>(fn: () => T) => db.transaction(fn)() as T },
    acceptWebSocket(ws: HubSocket, tags: string[] = []) { (ws as FakeSocket).tags = tags; sockets.push(ws as FakeSocket); },
    getWebSockets(tag?: string) { return sockets.filter(s => !tag || s.tags.includes(tag)); },
    waitUntil(_p: Promise<unknown>) {},
  };
  const Hub = createSocialHub(CONFIG, {
    now: () => t,
    createPair: () => [new FakeSocket(), new FakeSocket()],
    upgradeResponse: () => Response.json({ upgraded: true }),
    fetch: async (url: string, init?: RequestInit) => { posted.push({ url, body: JSON.parse(String(init?.body)) }); return new Response(null, { status: 204 }); },
  });
  let hub = new Hub(ctx, env);
  const call = async (method: string, path: string, key?: string, body?: unknown) => {
    const headers: Record<string, string> = { 'x-social-ip': 'ip-' + Math.random() };
    if (key) headers['x-social-key'] = key;
    const res = await hub.fetch(new Request('https://social.internal' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() as any };
  };
  const join = async (name: string) => {
    const key = newKey();
    const profile = (await call('POST', '/profile', key, { name })).body;
    const { ticket } = (await call('POST', '/ws-ticket', key)).body;
    const up = await call('GET', '/ws?ticket=' + ticket);
    expect(up.body).toEqual({ upgraded: true });
    const ws = sockets[sockets.length - 1];
    return { key, id: profile.id as string, ws, ticket: ticket as string };
  };
  const send = (ws: FakeSocket, m: unknown) => hub.webSocketMessage(ws, JSON.stringify(m));
  return { ctx, Hub, call, join, send, sockets, posted, advance: (ms: number) => { t += ms; }, wake: () => { hub = new Hub(ctx, env); }, get hub() { return hub; } };
}

describe('SocialHub 어댑터', () => {
  test('티켓 → 업그레이드 → hello/say 왕복, 절전 후 attachment로 복원', async () => {
    const h = harness();
    const a = await h.join('에이'), b = await h.join('비비');
    await h.send(a.ws, { t: 'hello', presence: { state: 'lobby' } });
    await h.send(b.ws, { t: 'hello' });
    expect(a.ws.last('welcome')).toMatchObject({ me: { id: a.id }, world: 'world-1' });
    await h.send(a.ws, { t: 'say', channel: 'world-1', text: '안녕하세요', nonce: 'nonce-0001' });
    expect(b.ws.last('msg').m).toMatchObject({ kind: 'chat', text: '안녕하세요', from: { id: a.id } });
    expect(a.ws.last('msg').m.text).toBe('안녕하세요');
    // 절전: 인스턴스(메모리 속도제한 포함)를 새로 만든다. 소켓 attachment만 남는다.
    h.wake();
    h.advance(1300);
    await h.send(a.ws, { t: 'say', channel: 'world-1', text: '다시 깨어남', nonce: 'nonce-0002' });
    expect(b.ws.last('msg').m.text).toBe('다시 깨어남');
    // 최소 간격은 저장소에 있어 깨어난 직후에도 지켜진다.
    h.wake();
    await h.send(a.ws, { t: 'say', channel: 'world-1', text: '너무 빠름', nonce: 'nonce-0003' });
    expect(a.ws.last('error')).toMatchObject({ code: 'rate' });
    // 같은 티켓 재사용 불가
    expect((await h.call('GET', '/ws?ticket=' + a.ticket)).status).toBe(401);
    // 종료하면 상대에게 소켓이 전달되지 않는다
    await h.hub.webSocketClose(b.ws, 1000, 'bye');
    h.advance(1300);
    const before = b.ws.sent.length;
    await h.send(a.ws, { t: 'say', channel: 'world-1', text: '아무도 없나', nonce: 'nonce-0004' });
    expect(b.ws.sent.length).toBe(before);
  });
  test('한 플레이어 소켓 최대 3개, 밴하면 소켓을 닫는다', async () => {
    const h = harness();
    const a = await h.join('여러기기');
    const extra: FakeSocket[] = [a.ws];
    for (let i = 0; i < 3; i++) {
      h.advance(10);
      const { ticket } = (await h.call('POST', '/ws-ticket', a.key)).body;
      await h.call('GET', '/ws?ticket=' + ticket);
      extra.push(h.sockets[h.sockets.length - 1]);
    }
    expect(extra.map(s => s.closed?.code ?? null)).toEqual([4000, null, null, null]);
    const admin = await h.join('운영자');
    const hub = new h.Hub(h.ctx, { SOCIAL_ADMIN_IDS: admin.id });
    const res = await hub.fetch(new Request('https://social.internal/admin/ban', { method: 'POST', headers: { 'x-social-key': admin.key, 'x-social-ip': 'x' }, body: JSON.stringify({ playerId: a.id, banned: true }) }));
    expect(res.status).toBe(200);
    expect(extra.slice(1).map(s => s.closed?.code)).toEqual([4003, 4003, 4003]);
    expect((await h.call('POST', '/ws-ticket', a.key)).status).toBe(403);
  });
  test('디스코드 웹훅은 멘션을 무력화하고 잘못된 URL은 보내지 않는다', async () => {
    const h = harness({ DISCORD_WEBHOOK_BOARD: 'https://discord.com/api/webhooks/123/abc_DEF', DISCORD_WEBHOOK_FAME: 'http://evil.example/hook' });
    const a = await h.join('제보자');
    expect((await h.call('POST', '/board', a.key, { category: 'bug', title: '@everyone 버그', body: '<@123> 확인' })).status).toBe(201);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(h.posted[0].body.embeds[0].title).toBe('[bug] @\u200beveryone 버그');
    const run = (await h.call('POST', '/runs/start', a.key, { contentId: 'cave', mode: 'solo' })).body;
    h.advance(41000);
    expect((await h.call('POST', '/runs/clear', a.key, { runId: run.runId })).body.rank).toBe(1);
    expect(h.posted).toHaveLength(1);
  });
});

describe('handleSocialRequest 라우터', () => {
  const setup = (extra: Record<string, string> = {}) => {
    const h = harness();
    const ids: unknown[] = [];
    const env = { APP_ORIGIN: APP, ...extra, SOCIAL: { idFromName: (n: string) => n, get: (id: unknown) => ({ fetch: (r: Request) => { ids.push(id); return h.hub.fetch(r); } }) } };
    const go = (path: string, init: RequestInit & { base?: string } = {}) => handleSocialRequest(new Request((init.base ?? APP) + '/api/social' + path, init), env, CONFIG);
    return { h, ids, go };
  };
  test('origin·키·본문 검사 뒤 게임 허브로 전달', async () => {
    const { ids, go } = setup();
    const key = newKey();
    const post = (path: string, body: string, headers: Record<string, string> = {}) => go(path, { method: 'POST', body, headers: { origin: APP, 'content-type': 'application/json', authorization: 'Bearer ' + key, ...headers } });
    const created = await post('/profile', JSON.stringify({ name: '라우터' }));
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    expect(ids[0]).toBe('hub:test-game');
    expect((await go('/me', { headers: { origin: APP, authorization: 'Bearer ' + key } })).status).toBe(200);
    expect((await go('/profile', { method: 'POST', body: '{"name":"없음"}', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key } })).status).toBe(403);
    expect((await go('/fame', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await go('/fame')).status).toBe(200);
    expect((await go('/fame', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await go('/fame', { base: 'https://other.workers.dev' })).status).toBe(403);
    expect(await (await go('/me', { headers: { origin: APP, authorization: 'Bearer nope' } })).json()).toEqual({ error: 'bad-key' });
    expect((await post('/board', 'x'.repeat(9000))).status).toBe(413);
    expect((await post('/board', '{', {})).status).toBe(400);
    expect((await post('/board', '{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await go('/ws', { headers: { origin: APP } })).status).toBe(426);
    expect((await go('/ws?ticket=zz', { headers: { origin: APP, upgrade: 'websocket' } })).status).toBe(401);
    expect((await go('/ws?ticket=' + 'a'.repeat(32), { headers: { upgrade: 'websocket' } })).status).toBe(403);
  });
  test('로컬 개발 origin은 SOCIAL_DEV_ORIGINS=true일 때만', async () => {
    const off = setup({ SOCIAL_DEV_ORIGINS: 'false' });
    expect((await off.go('/fame', { base: 'http://localhost:8787', headers: { origin: 'http://localhost:5173' } })).status).toBe(403);
    const on = setup({ SOCIAL_DEV_ORIGINS: 'true' });
    expect((await on.go('/fame', { base: 'http://localhost:8787', headers: { origin: 'http://localhost:5173' } })).status).toBe(200);
    expect((await on.go('/fame', { base: 'http://localhost:8787', headers: { origin: 'http://192.168.0.2:5173' } })).status).toBe(403);
  });
});

