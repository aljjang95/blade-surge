// tll-social 클라이언트 SDK 테스트: 가짜 fetch·WebSocket·저장소·타이머
import { describe, expect, test } from 'bun:test';
import { createSocialClient, isDeviceKey, memoryStorage } from '../src/client/index.js';
import { DEVICE_KEY } from '../src/shared/protocol';

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function makeClock() {
  let t = 1_000_000;
  let seq = 0;
  const tasks = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { seq += 1; tasks.set(seq, { at: t + Math.max(0, Number(ms) || 0), fn }); return seq; },
    clearTimeout(id) { tasks.delete(id); },
    pending() { return [...tasks.values()].map(task => task.at - t).sort((a, b) => a - b); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, task] of tasks) if (task.at <= end && (!next || task.at < next[1].at)) next = [id, task];
        if (!next) break;
        tasks.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
    jump(ms) { t += ms; },
  };
}

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  serverOpen() { this.readyState = 1; this.onopen?.({}); }
  serverSend(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  serverClose() { this.closed = true; this.readyState = 3; this.onclose?.({ code: 1006 }); }
  last() { return this.sent[this.sent.length - 1]; }
}

const json = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function makeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { url, method: init.method, headers: init.headers ?? {}, body };
    calls.push(call);
    return handler(call);
  };
  fn.calls = calls;
  return fn;
}

const ME = { id: 'p_' + 'a'.repeat(24), name: '모험가', tag: '0001', no: 1, title: null, linked: false };
const FRIEND = { id: 'p_' + 'b'.repeat(24), name: '친구', tag: '0002', no: 2, title: null, linked: false };
const STRANGER = { id: 'p_' + 'c'.repeat(24), name: '낯선이', tag: '0003', no: 3, title: null, linked: false };
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

function defaultHandler(call) {
  const path = call.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/social/, '').split('?')[0];
  if (path === '/ws-ticket') return json(200, { ticket: 'f'.repeat(32), expiresAt: 0 });
  if (path === '/me') return json(200, { profile: ME, friends: [{ player: FRIEND, online: false, presence: null }], requests: { incoming: [], outgoing: [] }, blocks: [], titles: [], isAdmin: false });
  return json(200, { ok: true });
}

function setup(overrides = {}) {
  FakeSocket.instances = [];
  const clock = makeClock();
  const storage = overrides.storage ?? memoryStorage();
  const fetch = makeFetch(overrides.handler ?? defaultHandler);
  const docListeners = {};
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => { docListeners[name] = fn; }, removeEventListener() {} };
  const winListeners = {};
  const window = { addEventListener: (name, fn) => { winListeners[name] = fn; }, removeEventListener() {} };
  const navigator = { onLine: true };
  const client = createSocialClient({
    gameId: 'blade-surge', storage, fetch, WebSocket: FakeSocket,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now, random: () => 0.5,
    document, window, navigator, location: { protocol: 'https:', host: 'blade.tllhouse.com' },
    ...overrides.options,
  });
  return { client, clock, storage, fetch, document, docListeners, winListeners, navigator };
}

async function connectOnline(env, welcome = {}) {
  env.client.connect();
  await flush();
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
  ws.serverOpen();
  ws.serverSend({ t: 'welcome', me: ME, world: 'world-1', channels: [{ id: 'world-1', count: 3 }], history: {}, inbox: [], friends: [], ...welcome });
  await flush();
  return ws;
}

describe('신원 키', () => {
  test('43자 base64url 키를 만들어 저장하고 다음 실행에서 그대로 쓴다', () => {
    const storage = memoryStorage();
    const { client } = setup({ storage });
    const key = client.exportKey();
    expect(key).toHaveLength(43);
    expect(DEVICE_KEY.test(key)).toBe(true);
    expect(storage.getItem('tll-social:blade-surge:key')).toBe(key);
    const again = setup({ storage });
    expect(again.client.exportKey()).toBe(key);
  });

  test('저장소 접근이 예외를 던지면 메모리로 이어 간다', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    const { client } = setup({ storage: broken });
    expect(isDeviceKey(client.exportKey())).toBe(true);
  });

  test('importKey는 형식을 검사하고, 맞으면 교체 후 연결을 다시 시작한다', async () => {
    const env = setup();
    const before = env.client.exportKey();
    expect(await env.client.importKey('짧은값')).toEqual({ ok: false, error: 'bad-key', status: 0 });
    expect(await env.client.importKey(before.slice(0, 42) + 'B')).toMatchObject({ ok: false, error: 'bad-key' });
    expect(env.client.exportKey()).toBe(before);
    const first = await connectOnline(env);
    const other = createSocialClient({ gameId: 'other-game', storage: memoryStorage(), fetch: env.fetch, WebSocket: FakeSocket, window: null, document: null }).exportKey();
    expect((await env.client.importKey('  ' + other + '\n')).ok).toBe(true);
    expect(env.client.exportKey()).toBe(other);
    expect(env.storage.getItem('tll-social:blade-surge:key')).toBe(other);
    expect(env.storage.getItem('tll-social:blade-surge:key:prev')).toBe(before);
    expect(first.closed).toBe(true);
    expect(env.client.state.me).toBeNull();
    await flush();
    const ticketCalls = env.fetch.calls.filter(call => call.url.endsWith('/ws-ticket'));
    expect(ticketCalls.at(-1).headers.Authorization).toBe('Bearer ' + other);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe('REST 오류 정규화', () => {
  test('성공은 ok·data, 인증 헤더는 Bearer 키', async () => {
    const env = setup({ handler: () => json(200, { id: ME.id }) });
    const result = await env.client.lookup('모험가#0001');
    expect(result).toEqual({ ok: true, status: 200, data: { id: ME.id } });
    const call = env.fetch.calls[0];
    expect(call.url).toBe('/api/social/players/lookup?code=' + encodeURIComponent('모험가#0001'));
    expect(call.headers.Authorization).toBe('Bearer ' + env.client.exportKey());
  });

  test('본문 retryAfterMs, Retry-After 헤더, 네트워크 실패, 깨진 JSON', async () => {
    let mode = 'rate';
    const env = setup({ handler: () => {
      if (mode === 'rate') return json(429, { error: 'rate', retryAfterMs: 5000 });
      if (mode === 'header') return json(429, { error: 'rate' }, { 'retry-after': '3' });
      if (mode === 'plain') return new Response('oops', { status: 502 });
      if (mode === 'broken') return new Response('{not json', { status: 200 });
      throw new TypeError('Failed to fetch');
    } });
    expect(await env.client.listings()).toEqual({ ok: false, error: 'rate', status: 429, retryAfterMs: 5000 });
    mode = 'header';
    expect(await env.client.listings()).toEqual({ ok: false, error: 'rate', status: 429, retryAfterMs: 3000 });
    mode = 'plain';
    expect(await env.client.listings()).toEqual({ ok: false, error: 'http-502', status: 502 });
    mode = 'broken';
    expect(await env.client.listings()).toEqual({ ok: false, error: 'bad-response', status: 200 });
    mode = 'network';
    expect(await env.client.listings()).toEqual({ ok: false, error: 'network', status: 0 });
  });

  test('8초 동안 응답이 없으면 timeout으로 끝난다', async () => {
    const env = setup({ handler: () => new Promise(() => {}) });
    let settled = null;
    env.client.fame().then(result => { settled = result; });
    await env.clock.advance(7999);
    expect(settled).toBeNull();
    await env.clock.advance(1);
    expect(settled).toEqual({ ok: false, error: 'timeout', status: 0 });
    expect(env.fetch.calls[0].headers.Authorization).toBeUndefined();
  });
});

describe('선택 영웅 프로필', () => {
  test('profile(name, hero)는 선택 영웅을 본문에 넣고 반환 프로필을 반영한다', async () => {
    const profile = { ...ME, hero: 'mage' };
    const env = setup({ handler: () => json(201, profile) });
    const states = [];
    env.client.on('state', state => states.push(state.me));
    expect(await env.client.profile(ME.name, 'mage')).toEqual({ ok: true, status: 201, data: profile });
    expect(env.fetch.calls[0]).toMatchObject({ url: '/api/social/profile', method: 'POST', body: { name: ME.name, hero: 'mage' } });
    expect(env.fetch.calls[0].headers.Authorization).toBe('Bearer ' + env.client.exportKey());
    expect(env.client.state.me).toEqual(profile);
    expect(states).toEqual([profile]);
  });

  test('profile(name) 호출은 hero를 생략하는 기존 본문을 유지한다', async () => {
    const env = setup({ handler: () => json(201, { ...ME, hero: null }) });
    await env.client.profile(ME.name);
    expect(env.fetch.calls[0].body).toEqual({ name: ME.name });
    expect(env.client.state.me.hero).toBeNull();
  });

  test('setHero는 키 인증으로 /me/hero를 호출하고 state.me를 갱신한다', async () => {
    const profile = { ...ME, hero: 'ranger' };
    const env = setup({ handler: call => call.url.endsWith('/me/hero') ? json(200, profile) : defaultHandler(call) });
    await env.client.me();
    const states = [];
    env.client.on('state', state => states.push(state.me));
    expect(await env.client.setHero('ranger')).toEqual({ ok: true, status: 200, data: profile });
    const call = env.fetch.calls.at(-1);
    expect(call).toMatchObject({ url: '/api/social/me/hero', method: 'POST', body: { hero: 'ranger' } });
    expect(call.headers.Authorization).toBe('Bearer ' + env.client.exportKey());
    expect(env.client.state.me).toEqual(profile);
    expect(states).toEqual([profile]);
  });

  test('setHero 오류는 그대로 반환하고 기존 프로필·상태 알림을 보존한다', async () => {
    const env = setup({ handler: call => call.url.endsWith('/me/hero') ? json(400, { error: 'hero' }) : defaultHandler(call) });
    await env.client.me();
    const states = [];
    env.client.on('state', state => states.push(state.me));
    expect(await env.client.setHero('paladin')).toEqual({ ok: false, status: 400, error: 'hero' });
    expect(env.client.state.me).toEqual(ME);
    expect(states).toEqual([]);
  });
});

describe('실시간 연결', () => {
  test('ticket → wss URL → hello → welcome 상태 반영', async () => {
    const env = setup();
    const seen = [];
    env.client.on('connection', event => seen.push(event.state));
    env.client.connect();
    expect(env.client.connection).toBe('connecting');
    await flush();
    const ws = FakeSocket.instances[0];
    expect(ws.url).toBe('wss://blade.tllhouse.com/api/social/ws?ticket=' + 'f'.repeat(32));
    expect(ws.url).not.toContain(env.client.exportKey());
    ws.serverOpen();
    expect(ws.sent[0]).toEqual({ t: 'hello', presence: { state: 'lobby' } });
    ws.serverSend({
      t: 'welcome', me: ME, world: 'world-2', channels: [{ id: 'world-1', count: 3 }, { id: 'world-2', count: 9 }],
      history: { 'world-2': [{ id: 'h1', channel: 'world-2', kind: 'chat', from: FRIEND, text: '안녕', at: 1 }] },
      inbox: [{ id: 'd1', channel: null, kind: 'whisper', from: FRIEND, to: ME.id, text: '귓속말', at: 2 }],
      friends: [{ id: FRIEND.id, online: true, presence: { state: 'battle', where: '건선거' } }],
    });
    await flush();
    const s = env.client.state;
    expect(s.connection).toBe('online');
    expect(seen).toEqual(['connecting', 'online']);
    expect(s.currentWorld).toBe('world-2');
    expect(s.channels).toHaveLength(2);
    expect(s.messages.get('world-2').map(m => m.id)).toEqual(['h1']);
    expect(s.unread.get('world-2') ?? 0).toBe(0);
    expect(s.messages.get('dm').map(m => m.id)).toEqual(['d1']);
    expect(s.unread.get('dm')).toBe(1);
    expect(s.friends.get(FRIEND.id)).toMatchObject({ online: true, presence: { state: 'battle', where: '건선거' }, mini: { name: '친구' } });
    expect(s.me.id).toBe(ME.id);
  });

  test('ws:// 는 http 기준 주소에서 자동 선택된다', async () => {
    const env = setup({ options: { location: { protocol: 'http:', host: 'localhost:5173' } } });
    env.client.connect();
    await flush();
    expect(FakeSocket.instances[0].url.startsWith('ws://localhost:5173/api/social/ws?ticket=')).toBe(true);
  });

  test('msg 수신: 미확인 수, 내 메시지 제외, 차단 상대 제외, 중복 무시, 100개 유지', async () => {
    const blocked = [];
    const env = setup({ handler: call => {
      if (call.url.endsWith('/blocks')) { blocked.push(call.body.playerId); return json(200, { ok: true }); }
      if (call.url.endsWith('/me')) return json(200, { profile: ME, friends: [], requests: { incoming: [], outgoing: [] }, blocks: blocked, titles: [] });
      return defaultHandler(call);
    } });
    const ws = await connectOnline(env);
    const got = [];
    env.client.on('msg', m => got.push(m.id));
    ws.serverSend({ t: 'msg', m: { id: 'm1', channel: 'world-1', kind: 'chat', from: FRIEND, text: 'hi', at: 1 } });
    ws.serverSend({ t: 'msg', m: { id: 'm1', channel: 'world-1', kind: 'chat', from: FRIEND, text: 'hi', at: 1 } });
    ws.serverSend({ t: 'msg', m: { id: 'm2', channel: 'world-1', kind: 'chat', from: ME, text: '나', at: 2 } });
    expect(env.client.state.unread.get('world-1')).toBe(1);
    expect(got).toEqual(['m1', 'm2']);
    await env.client.block(STRANGER.id, true);
    ws.serverSend({ t: 'msg', m: { id: 'm3', channel: 'world-1', kind: 'chat', from: STRANGER, text: '차단됨', at: 3 } });
    expect(got).not.toContain('m3');
    env.client.markRead('world-1');
    expect(env.client.state.unread.get('world-1')).toBe(0);
    for (let i = 0; i < 120; i += 1) ws.serverSend({ t: 'msg', m: { id: 'x' + i, channel: 'world-1', kind: 'chat', from: FRIEND, text: String(i), at: 10 + i } });
    const list = env.client.state.messages.get('world-1');
    expect(list).toHaveLength(100);
    expect(list.at(-1).id).toBe('x119');
    const fames = [];
    env.client.on('fame', m => fames.push(m.id));
    ws.serverSend({ t: 'msg', m: { id: 'f1', channel: null, kind: 'fame', text: '최초 정복', at: 99 } });
    expect(fames).toEqual(['f1']);
  });

  test('재연결 백오프는 1초에서 두 배씩 늘어 30초에서 멈추고, welcome 뒤 초기화된다', async () => {
    let failTicket = true;
    const env = setup({ handler: call => (call.url.endsWith('/ws-ticket') && failTicket ? json(503, { error: 'unavailable' }) : defaultHandler(call)) });
    const delays = [];
    env.client.on('connection', event => { if (event.retryInMs !== undefined) delays.push(event.retryInMs); });
    env.client.connect();
    await flush();
    for (let i = 0; i < 6; i += 1) await env.clock.advance(delays.at(-1));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    failTicket = false;
    await env.clock.advance(30000);
    const ws = FakeSocket.instances.at(-1);
    ws.serverOpen();
    ws.serverSend({ t: 'welcome', me: ME, world: 'world-1', channels: [], history: {}, inbox: [], friends: [] });
    await flush();
    expect(env.client.connection).toBe('online');
    ws.serverClose();
    expect(delays.at(-1)).toBe(1000);
  });

  test('지터는 0.8~1.2배 범위로 적용된다', async () => {
    const env = setup({ handler: () => json(500, { error: 'x' }), options: { random: () => 0 } });
    const delays = [];
    env.client.on('connection', event => { if (event.retryInMs !== undefined) delays.push(event.retryInMs); });
    env.client.connect();
    await flush();
    expect(delays).toEqual([800]);
  });

  test('프로필이 없으면 재시도하지 않고, 프로필을 만들면 연결한다', async () => {
    let hasProfile = false;
    const env = setup({ handler: call => {
      if (call.url.endsWith('/ws-ticket') && !hasProfile) return json(401, { error: 'no-profile' });
      if (call.url.endsWith('/profile')) { hasProfile = true; return json(200, ME); }
      return defaultHandler(call);
    } });
    const errors = [];
    env.client.on('error', e => errors.push(e.code));
    env.client.connect();
    await flush();
    expect(errors).toEqual(['no-profile']);
    expect(env.clock.pending()).toEqual([]);
    expect((await env.client.profile('모험가')).ok).toBe(true);
    await flush();
    expect(env.client.state.me.id).toBe(ME.id);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  test('탭을 숨기면 25초 뒤 끊고, 다시 보이면 재연결한다', async () => {
    const env = setup();
    const ws = await connectOnline(env);
    env.document.visibilityState = 'hidden';
    env.docListeners.visibilitychange();
    await env.clock.advance(24999);
    expect(ws.closed).toBe(false);
    await env.clock.advance(1);
    expect(ws.closed).toBe(true);
    expect(env.client.connection).toBe('offline');
    await env.clock.advance(60000);
    expect(FakeSocket.instances).toHaveLength(1);
    env.document.visibilityState = 'visible';
    env.docListeners.visibilitychange();
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  test('20초마다 ping을 보낸다', async () => {
    const env = setup();
    const ws = await connectOnline(env);
    await env.clock.advance(20000);
    expect(ws.last()).toEqual({ t: 'ping' });
    await env.clock.advance(20000);
    expect(ws.sent.filter(m => m.t === 'ping')).toHaveLength(2);
  });

  test('끊긴 동안 say/whisper는 최대 10개 큐, 30초 지나면 버리고 재연결 뒤 보낸다', async () => {
    const env = setup();
    expect(env.client.say('world-1', '   ')).toMatchObject({ ok: false, error: 'length' });
    expect(env.client.say('lobby', 'hi')).toMatchObject({ ok: false, error: 'channel' });
    const old = env.client.say('world-1', '오래된 말');
    expect(old.data.queued).toBe(true);
    env.clock.jump(31000);
    for (let i = 0; i < 11; i += 1) env.client.say('world-1', '말' + i);
    env.client.whisper(FRIEND.id, '귓속말');
    const ws = await connectOnline(env);
    const sent = ws.sent.filter(m => m.t === 'say' || m.t === 'whisper');
    expect(sent).toHaveLength(10);
    expect(sent.map(m => m.text)).not.toContain('오래된 말');
    expect(sent.at(-1)).toMatchObject({ t: 'whisper', to: FRIEND.id, text: '귓속말' });
    expect(sent.every(m => /^[A-Za-z0-9_-]{8,32}$/.test(m.nonce))).toBe(true);
    expect(new Set(sent.map(m => m.nonce)).size).toBe(10);
    const live = env.client.say('world-1', '바로');
    expect(live.data.queued).toBe(false);
    expect(ws.last()).toMatchObject({ t: 'say', text: '바로' });
  });

  test('파티 채널과 고른 광장은 재연결 뒤 다시 join한다', async () => {
    const env = setup();
    const ws = await connectOnline(env);
    const code = 'A'.repeat(20);
    env.client.joinParty(code);
    env.client.joinWorld(3);
    expect(ws.sent.filter(m => m.t === 'join').map(m => m.channel)).toEqual(['party:' + code, 'world-3']);
    ws.serverClose();
    await env.clock.advance(1000);
    const next = FakeSocket.instances.at(-1);
    next.serverOpen();
    next.serverSend({ t: 'welcome', me: ME, world: 'world-1', channels: [], history: {}, inbox: [], friends: [] });
    await flush();
    expect(next.sent.filter(m => m.t === 'join').map(m => m.channel)).toEqual(['world-3', 'party:' + code]);
    expect(env.client.invite(FRIEND.id, 'bad')).toMatchObject({ ok: false, error: 'party-code' });
    expect(env.client.invite(FRIEND.id, code).ok).toBe(true);
    expect(next.last()).toEqual({ t: 'invite', to: FRIEND.id, partyCode: code });
  });

  test('friend·presence 이벤트가 상태에 반영된다', async () => {
    const env = setup();
    const ws = await connectOnline(env);
    await flush();
    ws.serverSend({ t: 'friend', event: 'request', player: STRANGER });
    expect(env.client.state.requests.incoming.map(m => m.id)).toEqual([STRANGER.id]);
    ws.serverSend({ t: 'friend', event: 'accepted', player: STRANGER });
    expect(env.client.state.requests.incoming).toEqual([]);
    expect(env.client.state.friends.has(STRANGER.id)).toBe(true);
    ws.serverSend({ t: 'presence', id: STRANGER.id, online: true, presence: { state: 'party' } });
    expect(env.client.state.friends.get(STRANGER.id)).toMatchObject({ online: true, presence: { state: 'party' } });
    ws.serverSend({ t: 'friend', event: 'removed', player: STRANGER });
    expect(env.client.state.friends.has(STRANGER.id)).toBe(false);
  });

  test('수락 이벤트가 접속·상태를 싣고 오면 요청자 화면에 바로 온라인으로 보인다', async () => {
    const env = setup();
    const ws = await connectOnline(env);
    const before = env.fetch.calls.length;
    ws.serverSend({ t: 'friend', event: 'accepted', player: STRANGER, online: true, presence: { state: 'battle', where: '건선거' } });
    expect(env.client.state.friends.get(STRANGER.id)).toMatchObject({ online: true, presence: { state: 'battle', where: '건선거' } });
    await flush();
    expect(env.fetch.calls).toHaveLength(before);
    ws.serverSend({ t: 'friend', event: 'accepted', player: FRIEND, online: false, presence: null });
    expect(env.client.state.friends.get(FRIEND.id)).toMatchObject({ online: false, presence: null });
  });

  test('접속 정보 없는 수락 이벤트는 /me로 다시 받아 맞춘다', async () => {
    let accepted = false;
    const env = setup({ handler: call => {
      if (call.url.endsWith('/me')) return json(200, { profile: ME, friends: accepted ? [{ player: STRANGER, online: true, presence: { state: 'lobby' } }] : [], requests: { incoming: [], outgoing: [] }, blocks: [], titles: [] });
      return defaultHandler(call);
    } });
    const ws = await connectOnline(env);
    await flush();
    accepted = true;
    ws.serverSend({ t: 'friend', event: 'accepted', player: STRANGER });
    expect(env.client.state.friends.get(STRANGER.id)).toMatchObject({ online: false });
    await flush();
    expect(env.client.state.friends.get(STRANGER.id)).toMatchObject({ online: true, presence: { state: 'lobby' } });
  });
});

describe('서버가 없을 때 자동 요청 줄이기', () => {
  const notFound = () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
  const meCalls = env => env.fetch.calls.filter(call => call.url.endsWith('/me')).length;

  test('첫 /me가 404면 60초 동안 자동 /me는 요청 없이 offline으로 돌려준다', async () => {
    const env = setup({ handler: notFound });
    expect(await env.client.me()).toMatchObject({ ok: false, error: 'http-404' });
    expect(await env.client.me()).toMatchObject({ ok: false, error: 'offline' });
    expect(await env.client.me()).toMatchObject({ ok: false, error: 'offline' });
    expect(meCalls(env)).toBe(1);
    await env.clock.advance(59000);
    await env.client.me();
    expect(meCalls(env)).toBe(1);
    await env.clock.advance(1100);
    await env.client.me();
    expect(meCalls(env)).toBe(2);
  });

  test('연속 실패하면 간격이 두 배로 늘고, 사용자가 연 경우(manual)는 한 번 다시 시도한다', async () => {
    const env = setup({ handler: notFound });
    await env.client.me();
    await env.clock.advance(60100);
    await env.client.me();
    expect(meCalls(env)).toBe(2);
    await env.clock.advance(60100);
    await env.client.me();
    expect(meCalls(env)).toBe(2);
    await env.clock.advance(60100);
    await env.client.me();
    expect(meCalls(env)).toBe(3);
    expect(await env.client.me({ manual: true })).toMatchObject({ ok: false, error: 'http-404' });
    expect(meCalls(env)).toBe(4);
  });

  test('네트워크 실패도 같고, 성공하면 백오프가 풀린다', async () => {
    let up = false;
    const env = setup({ handler: call => { if (!up) throw new TypeError('offline'); return defaultHandler(call); } });
    expect(await env.client.me()).toMatchObject({ error: 'network' });
    up = true;
    expect(await env.client.me()).toMatchObject({ error: 'offline' });
    expect((await env.client.me({ manual: true })).ok).toBe(true);
    expect((await env.client.me()).ok).toBe(true);
  });

  test('JSON 오류 코드가 있는 404(no-profile)는 서버가 있는 것으로 본다', async () => {
    const env = setup({ handler: () => json(404, { error: 'no-profile' }) });
    expect(await env.client.me()).toMatchObject({ error: 'no-profile' });
    expect(await env.client.me()).toMatchObject({ error: 'no-profile' });
    expect(meCalls(env)).toBe(2);
  });

  test('ws-ticket이 404면 재연결 대기가 60초 이상이고 그동안 티켓을 다시 요청하지 않는다', async () => {
    const env = setup({ handler: notFound });
    env.client.connect();
    await flush();
    const tickets = () => env.fetch.calls.filter(call => call.url.endsWith('/ws-ticket')).length;
    expect(tickets()).toBe(1);
    expect(env.clock.pending()[0]).toBeGreaterThanOrEqual(60000);
    env.winListeners.online();
    await flush();
    expect(tickets()).toBe(1);
    await env.clock.advance(59000);
    expect(tickets()).toBe(1);
    await env.clock.advance(2000);
    expect(tickets()).toBe(2);
    expect(env.clock.pending()[0]).toBeGreaterThanOrEqual(110000);
  });
});

describe('런 기록', () => {
  test('runStart·runClear는 fetch가 던져도 resolve한다', async () => {
    const env = setup({ handler: () => { throw new Error('boom'); } });
    expect(await env.client.runStart('emberwake_drydock')).toMatchObject({ ok: false });
    expect(await env.client.runClear('r1')).toMatchObject({ ok: false, queued: true });
  });

  test('오프라인 클리어는 저장소 큐에 넣고 온라인이 되면 다시 보낸다', async () => {
    let up = false;
    const env = setup({ handler: call => {
      if (!up) throw new TypeError('offline');
      if (call.url.endsWith('/runs/clear')) return json(200, { contentId: 'emberwake_drydock', elapsedMs: 50000, firstClear: true, rank: 1 });
      if (call.url.endsWith('/runs/start')) return json(200, { runId: call.body.contentId === 'a' ? 'run-a' : 'run-b' });
      return defaultHandler(call);
    } });
    env.navigator.onLine = false;
    const queued = await env.client.runClear('run-1');
    expect(queued).toEqual({ ok: false, error: 'offline', status: 0, queued: true });
    expect(env.fetch.calls).toHaveLength(0);
    env.navigator.onLine = true;
    const net = await env.client.runClear('run-2');
    expect(net).toMatchObject({ ok: false, error: 'network', queued: true });
    expect(env.client.pendingRunClears().map(item => item.runId)).toEqual(['run-1', 'run-2']);
    const raw = JSON.parse(env.storage.getItem('tll-social:blade-surge:runq'));
    expect(raw).toHaveLength(2);
    const replayed = [];
    env.client.on('clear', event => replayed.push(event.runId));
    up = true;
    env.winListeners.online();
    await flush();
    expect(replayed).toEqual(['run-1', 'run-2']);
    expect(env.client.pendingRunClears()).toEqual([]);
    expect(env.storage.getItem('tll-social:blade-surge:runq')).toBeNull();
  });

  test('2시간이 지난 기록은 버리고, 최대 20개만 남긴다', async () => {
    const env = setup({ handler: () => { throw new TypeError('offline'); } });
    env.navigator.onLine = false;
    for (let i = 0; i < 25; i += 1) await env.client.runClear('run-' + i);
    const list = env.client.pendingRunClears();
    expect(list).toHaveLength(20);
    expect(list[0].runId).toBe('run-5');
    env.clock.jump(2 * 60 * 60 * 1000 + 1);
    expect(env.client.pendingRunClears()).toEqual([]);
  });

  test('시작 시각을 아는 런은 시작 기준 2시간으로 자른다', async () => {
    let up = true;
    const env = setup({ handler: call => {
      if (!up) throw new TypeError('offline');
      return json(200, { runId: 'run-x' });
    } });
    expect((await env.client.runStart('emberwake_drydock')).data.runId).toBe('run-x');
    env.clock.jump(90 * 60 * 1000);
    up = false;
    await env.client.runClear('run-x');
    expect(env.client.pendingRunClears()).toHaveLength(1);
    env.clock.jump(31 * 60 * 1000);
    expect(env.client.pendingRunClears()).toEqual([]);
  });

  test('되돌릴 수 없는 실패(4xx)는 큐에서 지운다', async () => {
    let status = 0;
    const env = setup({ handler: () => { if (!status) throw new TypeError('offline'); return json(status, { error: 'run-expired' }); } });
    await env.client.runClear('run-1');
    status = 400;
    await env.client.flushRunClears();
    expect(env.client.pendingRunClears()).toEqual([]);
  });

  test('새 클라이언트가 만들어질 때 남은 큐를 다시 보낸다', async () => {
    const storage = memoryStorage();
    const first = setup({ storage, handler: () => { throw new TypeError('offline'); } });
    await first.client.runClear('run-9');
    const second = setup({ storage, handler: () => json(200, { contentId: 'x' }) });
    await flush();
    expect(second.fetch.calls.map(call => call.body)).toEqual([{ runId: 'run-9' }]);
    expect(second.client.pendingRunClears()).toEqual([]);
  });
});

describe('구글 연동', () => {
  test('linkGoogle은 토큰 형식을 검사하고 성공하면 linked를 반영한다', async () => {
    const env = setup({ handler: call => (call.url.endsWith('/auth/link') ? json(200, { ...ME, linked: true }) : defaultHandler(call)) });
    expect(await env.client.linkGoogle('not-a-jwt')).toMatchObject({ ok: false, error: 'token' });
    expect(env.fetch.calls).toHaveLength(0);
    const result = await env.client.linkGoogle(ID_TOKEN);
    expect(result.ok).toBe(true);
    expect(env.fetch.calls[0].body).toEqual({ provider: 'google', idToken: ID_TOKEN });
    expect(env.fetch.calls[0].headers.Authorization).toBe('Bearer ' + env.client.exportKey());
    expect(env.client.state.me.linked).toBe(true);
  });

  test('linked-elsewhere 오류는 그대로 돌려준다', async () => {
    const env = setup({ handler: () => json(409, { error: 'linked-elsewhere' }) });
    expect(await env.client.linkGoogle(ID_TOKEN)).toEqual({ ok: false, error: 'linked-elsewhere', status: 409 });
  });

  test('recoverWithGoogle은 새 키를 본문으로 보내고 성공하면 저장 후 재연결한다', async () => {
    const env = setup({ handler: call => (call.url.endsWith('/auth/recover') ? json(200, { ...ME, linked: true }) : defaultHandler(call)) });
    const oldKey = env.client.exportKey();
    const firstWs = await connectOnline(env);
    const result = await env.client.recoverWithGoogle(ID_TOKEN);
    expect(result.ok).toBe(true);
    const call = env.fetch.calls.find(item => item.url.endsWith('/auth/recover'));
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body.provider).toBe('google');
    expect(call.body.idToken).toBe(ID_TOKEN);
    expect(isDeviceKey(call.body.deviceKey)).toBe(true);
    expect(call.body.deviceKey).not.toBe(oldKey);
    expect(env.client.exportKey()).toBe(call.body.deviceKey);
    expect(env.storage.getItem('tll-social:blade-surge:key')).toBe(call.body.deviceKey);
    expect(env.storage.getItem('tll-social:blade-surge:key:prev')).toBe(oldKey);
    expect(env.client.state.me).toMatchObject({ id: ME.id, linked: true });
    expect(firstWs.closed).toBe(true);
    await flush();
    const tickets = env.fetch.calls.filter(item => item.url.endsWith('/ws-ticket'));
    expect(tickets.at(-1).headers.Authorization).toBe('Bearer ' + call.body.deviceKey);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  test('recover 실패면 기존 키를 유지한다', async () => {
    const env = setup({ handler: () => json(404, { error: 'not-linked' }) });
    const oldKey = env.client.exportKey();
    expect(await env.client.recoverWithGoogle(ID_TOKEN)).toEqual({ ok: false, error: 'not-linked', status: 404 });
    expect(env.client.exportKey()).toBe(oldKey);
    expect(env.storage.getItem('tll-social:blade-surge:key:prev')).toBeNull();
  });

  test('unlink는 linked를 해제하고 503 link-disabled를 그대로 전달한다', async () => {
    let disabled = false;
    const env = setup({ handler: call => {
      if (disabled) return json(503, { error: 'link-disabled' });
      if (call.url.endsWith('/auth/link')) return json(200, { ...ME, linked: true });
      if (call.url.endsWith('/auth/unlink')) return json(200, { ok: true });
      return defaultHandler(call);
    } });
    await env.client.linkGoogle(ID_TOKEN);
    expect((await env.client.unlink()).ok).toBe(true);
    expect(env.fetch.calls.at(-1).body).toEqual({ provider: 'google' });
    expect(env.client.state.me.linked).toBe(false);
    expect(await env.client.unlink('Google!')).toMatchObject({ ok: false, error: 'provider' });
    disabled = true;
    expect(await env.client.linkGoogle(ID_TOKEN)).toEqual({ ok: false, error: 'link-disabled', status: 503 });
  });
});
