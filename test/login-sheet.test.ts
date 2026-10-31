import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { AccountClient } from '../src/net/account-client.js';
import { setupAccount, REGISTERED_KEY } from '../src/net/account.js';
import { loadProviders, startProviderLogin, googleLogin, consumeLoginReturn, takeLoginReturn, deleteAccount } from '../src/net/account-login.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { Economy } from '../src/game/economy.js';

// 서버 계약을 흉내 내는 fetch 목: 호출 기록을 남기고 경로별 응답을 돌려준다.
function mockServer(routes: Record<string, (body: any, headers: Headers) => { status?: number; body?: any }>) {
  const calls: { method: string; path: string; body: any; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const path = new URL(url, 'https://x.test').pathname.replace('/api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init.headers);
    calls.push({ method: String(init.method), path, body, auth: headers.get('authorization') });
    const route = routes[`${init.method} ${path}`] || (() => ({ status: 404, body: { error: 'not-found' } }));
    const out = route(body, headers);
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
const session = () => ({ body: { token: 't1', accountId: 'a1', authority: 'shadow', serverTime: Date.now() } });
const me = (extra = {}) => ({ body: { legacy: true, doc: null, stateHash: 'x', linked: [], ...extra } });
const newApp = () => ({ eco: new Economy({ storage: createMemoryStorage() } as any), battle: null, ui: { toast() {} } } as any);
const clientOf = (fetchImpl: any) => new AccountClient({ deviceKey: 'k'.repeat(43), channel: 'web', fetchImpl, url: (p: string) => 'https://x.test' + p });
const wait = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };

// bun 에는 localStorage 가 없어 메모리 구현을 끼운다(secure-storage 도 같은 저장소를 쓴다).
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); } };
beforeEach(() => { mem.delete(REGISTERED_KEY); });
afterAll(() => { delete (globalThis as any).localStorage; });

describe('AccountClient 로그인 계약', () => {
  test('providers 는 토큰 없이, oauthStart recover 는 deviceKey, link 는 Bearer', async () => {
    const srv = mockServer({
      'GET /auth/providers': () => ({ body: { google: true, kakao: false, chatgpt: false } }),
      'POST /auth/session': session,
      'POST /auth/oauth/start': (b) => ({ body: { url: 'https://p.test/' + b.mode } }),
      'POST /auth/delete': () => ({ body: { ok: true } }),
    });
    const c = clientOf(srv.fetchImpl);
    expect(await c.providers()).toEqual({ google: true, kakao: false, chatgpt: false });
    const rec = await c.oauthStart('kakao', 'recover');
    expect(rec.url).toContain('recover');
    expect(srv.calls.at(-1)!.body).toMatchObject({ provider: 'kakao', mode: 'recover', deviceKey: 'k'.repeat(43), channel: 'web' });
    expect(srv.calls.at(-1)!.auth).toBeNull();
    await c.oauthStart('kakao', 'link');
    const link = srv.calls.at(-1)!;
    expect(link.body).toEqual({ provider: 'kakao', mode: 'link' });
    expect(link.auth).toBe('Bearer t1');
    await c.deleteAccount();
    expect(srv.calls.at(-1)!.body).toEqual({ confirm: 'DELETE' });
  });
  test('loadProviders: 503 은 null, 네이티브는 구글·카카오를 숨긴다', async () => {
    const off = mockServer({ 'GET /auth/providers': () => ({ status: 503, body: { error: 'v1-disabled' } }) });
    expect(await loadProviders(clientOf(off.fetchImpl))).toBeNull();
    const on = mockServer({ 'GET /auth/providers': () => ({ body: { google: true, kakao: true, chatgpt: false } }) });
    expect(await loadProviders(clientOf(on.fetchImpl), { native: true })).toEqual({ google: false, kakao: false, chatgpt: false });
    expect(await loadProviders(clientOf(on.fetchImpl))).toEqual({ google: true, kakao: true, chatgpt: false });
  });
});

describe('게스트 서버 행 지연 생성', () => {
  const routes = { 'POST /auth/session': session, 'GET /me': () => me() };
  test('첫 실행은 부팅 때 /auth/session 을 부르지 않고, 1-1 클리어 뒤에 연결해 등록 표시를 남긴다', async () => {
    const srv = mockServer(routes);
    const app = newApp();
    const state = await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    await new Promise((r) => setTimeout(r, 30));
    expect(state.status).toBe('deferred');
    expect(srv.calls.length).toBe(0);
    app.eco.completeStage({ ch: 1, st: 1, idx: 0, code: '1-1' }, 3);
    await wait(() => state.status === 'ready');
    expect(srv.calls.some((c) => c.path === '/auth/session')).toBe(true);
    expect(localStorage.getItem(REGISTERED_KEY)).toBe('1');
  });
  test('등록 표시가 있으면 부팅 즉시 연결하고, 로컬 클리어 진행이 있어도 연결한다', async () => {
    localStorage.setItem(REGISTERED_KEY, '1');
    const a = mockServer(routes);
    const sa = await setupAccount(newApp(), { fetchImpl: a.fetchImpl as any });
    await wait(() => sa.status === 'ready');
    expect(a.calls.some((c) => c.path === '/auth/session')).toBe(true);
    localStorage.removeItem(REGISTERED_KEY);
    const app = newApp(); app.eco.s.progress.stars['1-1'] = 3;
    const b = mockServer(routes);
    const sb = await setupAccount(app, { fetchImpl: b.fetchImpl as any });
    await wait(() => sb.status === 'ready');
    expect(b.calls.some((c) => c.path === '/auth/session')).toBe(true);
  });
  test('사용자가 연동을 시작(ensure)하면 연결된다', async () => {
    const srv = mockServer(routes);
    const state = await setupAccount(newApp(), { fetchImpl: srv.fetchImpl as any });
    expect(srv.calls.length).toBe(0);
    expect(await state.ensure()).toBe(true);
    expect(srv.calls.filter((c) => c.path === '/auth/session').length).toBe(1);
  });
});

describe('로그인 흐름', () => {
  test('카카오 recover 시작은 session 없이 url 로 이동한다', async () => {
    const srv = mockServer({ 'POST /auth/oauth/start': () => ({ body: { url: 'https://k.test/go' } }) });
    const app: any = newApp(); app.account = { client: clientOf(srv.fetchImpl), ensure: async () => true };
    let went = '';
    const out = await startProviderLogin(app, 'kakao', { assign: (u: string) => { went = u; } });
    expect(out.ok).toBe(true); expect(went).toBe('https://k.test/go');
    expect(srv.calls.map((c) => c.path)).toEqual(['/auth/oauth/start']);
  });
  test('구글: recover 404 no-link 면 게스트 세션 후 link', async () => {
    const srv = mockServer({
      'POST /auth/recover': () => ({ status: 404, body: { error: 'no-link' } }),
      'POST /auth/session': session, 'GET /me': () => me(),
      'POST /auth/link': () => ({ body: { ok: true } }),
    });
    const app: any = newApp();
    const state = await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    const out = await googleLogin(app, { signIn: async () => 'idtok' });
    expect(out).toMatchObject({ ok: true, action: 'linked' });
    expect(srv.calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/auth/recover', '/auth/session', '/auth/link']));
    expect(srv.calls.find((c) => c.path === '/auth/recover')!.body).toMatchObject({ provider: 'google', idToken: 'idtok' });
    expect(state.status).toBe('ready');
  });
  test('구글 link 409 linked-elsewhere: 확인하면 recover, 거절하면 아무 것도 안 바뀐다', async () => {
    let recovered = 0;
    const srv = mockServer({
      'POST /auth/recover': (_b) => { recovered++; return recovered === 1 ? { status: 404, body: { error: 'no-link' } } : { body: { ok: true } }; },
      'POST /auth/session': session, 'GET /me': () => me({ doc: null }),
      'POST /auth/link': () => ({ status: 409, body: { error: 'linked-elsewhere', mine: {}, other: {} } }),
    });
    const app: any = newApp();
    await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    const no = await googleLogin(app, { signIn: async () => 't', confirm: async () => false });
    expect(no).toMatchObject({ ok: false, reason: 'linked-elsewhere-declined' });
    expect(recovered).toBe(1);
    recovered = 0;
    const yes = await googleLogin(app, { signIn: async () => 't', confirm: async () => true });
    expect(yes).toMatchObject({ ok: true, action: 'recovered' });
    expect(recovered).toBe(2);
  });
  test('takeLoginReturn: ticket 쿼리를 읽자마자 주소에서 지운다', () => {
    let replaced = '';
    const ret = takeLoginReturn({ location: { search: '?x=1&login=kakao&result=ok&mode=link&ticket=' + 'T'.repeat(43), pathname: '/', hash: '' } as any, history: { state: null, replaceState: (_s: any, _t: string, u: string) => { replaced = u; } } as any });
    expect(ret).toEqual({ provider: 'kakao', result: 'ok', mode: 'link', ticket: 'T'.repeat(43) });
    expect(replaced).toBe('/?x=1');
    expect(takeLoginReturn({ location: { search: '?x=1', pathname: '/', hash: '' } as any, history: {} as any })).toBeNull();
  });
  test('콜백 복귀: ok 가 아니면 토스트만, ok 의 link 는 Bearer 로 finish', async () => {
    const srv = mockServer({ 'POST /auth/session': session, 'GET /me': () => me(), 'POST /auth/oauth/finish': () => ({ body: { mode: 'link', provider: 'kakao', linked: ['kakao'] } }) });
    const app: any = newApp();
    await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    const toasts: string[] = [];
    for (const result of ['cancel', 'expired', 'error', 'unavailable', 'rate']) await consumeLoginReturn(app, { provider: 'kakao', result, mode: 'link', ticket: '' }, { toast: (m: string) => toasts.push(m) });
    expect(toasts.length).toBe(5);
    expect(srv.calls.some((c) => c.path === '/auth/oauth/finish')).toBe(false);
    const out = await consumeLoginReturn(app, { provider: 'kakao', result: 'ok', mode: 'link', ticket: 'tk' }, { toast: (m: string) => toasts.push(m) });
    expect(out.action).toBe('linked');
    const fin = srv.calls.find((c) => c.path === '/auth/oauth/finish')!;
    expect(fin.body).toEqual({ ticket: 'tk' });
    expect(fin.auth).toBe('Bearer t1');
  });
  test('recover finish: 세션 없이 deviceKey 로 보내고 응답 토큰을 쓰며 서버 문서를 그림자 모드여도 적용', async () => {
    const doc = { ...JSON.parse(JSON.stringify(newApp().eco.s)), gold: 777_777 };
    const srv = mockServer({
      'POST /auth/oauth/finish': () => ({ body: { mode: 'recover', provider: 'kakao', token: 'newtok', accountId: 'a2', authority: 'shadow', expiresAt: 1, serverTime: Date.now(), switchedFrom: 'a1' } }),
      'POST /auth/session': () => ({ body: { token: 'newtok', accountId: 'a2', authority: 'shadow', serverTime: Date.now() } }),
      'GET /me': () => me({ doc }),
    });
    const app: any = newApp();
    const state = await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    const out = await consumeLoginReturn(app, { provider: 'kakao', result: 'ok', mode: 'recover', ticket: 'tk' }, {});
    expect(out.action).toBe('recovered');
    const fin = srv.calls.find((c) => c.path === '/auth/oauth/finish')!;
    expect(Object.keys(fin.body).sort()).toEqual(['deviceKey', 'ticket']);
    expect(fin.auth).toBeNull();
    await wait(() => state.status === 'ready');
    expect(state.authority).toBe('shadow');
    expect(app.eco.s.gold).toBe(777_777);
  });
  test('finish 오류: no-link 는 게스트 세션 후 link 자동 시작, linked-elsewhere 는 확인 후 recover, 만료는 안내', async () => {
    let code = 'no-link', status = 404;
    const srv = mockServer({
      'POST /auth/oauth/finish': () => ({ status, body: { error: code } }),
      'POST /auth/oauth/start': (b) => ({ body: { url: 'https://p.test/' + b.provider + '/' + b.mode } }),
      'POST /auth/session': session, 'GET /me': () => me(),
    });
    const run = async (mode: string, confirm = async () => true) => {
      const app: any = newApp(); await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
      const toasts: string[] = []; let url = '';
      await consumeLoginReturn(app, { provider: 'kakao', result: 'ok', mode, ticket: 'tk' }, { toast: (m: string) => toasts.push(m), confirm, assign: (u: string) => { url = u; } });
      return { toasts, url };
    };
    expect((await run('recover')).url).toBe('https://p.test/kakao/link');
    code = 'linked-elsewhere'; status = 409;
    expect((await run('link')).url).toBe('https://p.test/kakao/recover');
    expect((await run('link', async () => false)).url).toBe('');
    code = 'ticket-expired'; status = 410;
    expect((await run('link')).toasts[0]).toContain('다시 시도');
    code = 'x'; status = 429;
    expect((await run('link')).toasts[0]).toContain('잠시 후');
  });
  test('회원 탈퇴: 성공하면 등록 표시를 지우고 기기 키까지 초기화(keepIdentity:false)한 뒤 새로고침', async () => {
    const srv = mockServer({ 'POST /auth/session': session, 'GET /me': () => me(), 'POST /auth/delete': () => ({ body: { ok: true } }) });
    const app: any = newApp();
    const state = await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    await state.ensure();
    expect(localStorage.getItem(REGISTERED_KEY)).toBe('1');
    let resetOpts: any = null, reloaded = false;
    const out = await deleteAccount(app, { reset: async (o: any) => { resetOpts = o; return { ok: true }; }, pending: () => false, reload: () => { reloaded = true; } });
    expect(out.ok).toBe(true);
    expect(localStorage.getItem(REGISTERED_KEY)).toBeNull();
    // ensure()는 세션만 기다리므로 연결 마무리(그림자 스냅샷)가 뒤따를 수 있다: 탈퇴 요청 자체를 찾는다.
    expect(srv.calls.find((c) => c.path === '/auth/delete')!.body).toEqual({ confirm: 'DELETE' });
    expect(resetOpts).toEqual({ keepIdentity: false });
    expect(reloaded).toBe(true);
  });
  test('회원 탈퇴: 결제 대기면 서버를 부르지 않고, 서버 409 billing-pending 은 안내하며 로컬을 지우지 않는다', async () => {
    const srv = mockServer({ 'POST /auth/session': session, 'GET /me': () => me(), 'POST /auth/delete': () => ({ status: 409, body: { error: 'billing-pending' } }) });
    const app: any = newApp();
    const state = await setupAccount(app, { fetchImpl: srv.fetchImpl as any });
    await state.ensure();
    let resetCalled = false;
    const reset = async () => { resetCalled = true; return { ok: true }; };
    expect(await deleteAccount(app, { reset, pending: () => true, reload() {} })).toMatchObject({ ok: false, reason: 'payment' });
    expect(srv.calls.some((c) => c.path === '/auth/delete')).toBe(false);
    expect(await deleteAccount(app, { reset, pending: () => false, reload() {} })).toMatchObject({ ok: false, reason: 'billing-pending' });
    expect(resetCalled).toBe(false);
    expect(localStorage.getItem(REGISTERED_KEY)).toBe('1');
  });
});
