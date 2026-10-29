import { describe, expect, test } from 'bun:test';
import { newDeviceKey, ORIGIN, v1Harness } from './helpers/v1-harness';
import { createGoogleVerifier } from '../packages/tll-social/src/server/google';

// 가짜 제공자: 토큰 교환은 code → id_token, id_token 검증은 표에서 sub·nonce를 꺼낸다.
async function oidcHarness(env: Record<string, string> = { KAKAO_REST_KEY: 'kakao-rest', CHATGPT_CLIENT_ID: 'oaiapp_test' }) {
  const h = await v1Harness({ env });
  const issued = new Map<string, { sub: string; nonce: string }>();
  const exchanges: { url: string; body: string; auth: string | null }[] = [];
  const deps = h.deps as any;
  deps.fetch = async (url: string, init: RequestInit) => {
    const body = String(init.body), code = new URLSearchParams(body).get('code')!;
    exchanges.push({ url, body, auth: (init.headers as Record<string, string>).authorization ?? null });
    if (code === 'down') return new Response('x', { status: 502 });
    if (!issued.has(code)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ id_token: 'idt-' + code, access_token: 'a' });
  };
  deps.verifyIdToken = async (provider: string, token: string, clientIds: string[]) => {
    if (provider === 'google') { const sub = h.google.get(token); if (!sub) throw Object.assign(new Error('bad'), { status: 401 }); return { sub }; }
    const hit = issued.get(token.slice(4));
    if (!hit || !clientIds.length) throw Object.assign(new Error('bad'), { status: 401 });
    return hit;
  };
  /** start → 제공자 로그인(가짜) → 콜백. 반환: 앱으로 돌아간 쿼리. */
  const login = async (provider: string, mode: 'link' | 'recover', who: string, opts: { token?: string; deviceKey?: string; tamperNonce?: boolean; error?: string; skipFinish?: boolean } = {}) => {
    const start = await h.send('POST', '/auth/oauth/start', { provider, mode, ...(opts.deviceKey ? { deviceKey: opts.deviceKey } : {}) }, opts.token);
    if (start.status !== 200) return { start };
    const auth = new URL(start.body.url);
    const code = 'code-' + Math.random().toString(36).slice(2);
    issued.set(code, { sub: who, nonce: opts.tamperNonce ? 'other' : auth.searchParams.get('nonce')! });
    const q = opts.error ? `error=${opts.error}` : `code=${code}`;
    const res = await callback(provider, `${q}&state=${auth.searchParams.get('state')}`);
    let fin: { status: number; body: any } | null = null;
    // 앱이 돌아와서 자기 세션(link) 또는 자기 기기 키(recover)로 티켓을 낸다.
    if (res.ticket && !opts.skipFinish) fin = await h.send('POST', '/auth/oauth/finish', mode === 'link' ? { ticket: res.ticket } : { ticket: res.ticket, deviceKey: opts.deviceKey }, mode === 'link' ? opts.token : undefined);
    const result = fin ? (fin.status === 200 ? 'ok' : fin.body.error) : res.result;
    return { start, auth, res, fin, result, mode: res.mode, ticket: res.ticket, state: auth.searchParams.get('state')! };
  };
  const { handleV1Request } = await import('../worker/v1/router');
  // 콜백은 제공자 페이지에서 오는 최상위 이동이다(Origin 없음, cross-site).
  const callback = async (provider: string, query: string) => {
    const res = await handleV1Request(new Request(`${ORIGIN}/api/v1/auth/oauth/callback/${provider}?${query}`, { headers: { 'sec-fetch-site': 'cross-site' } }), h.env, h.deps);
    const loc = new URL(res.headers.get('location') ?? ORIGIN);
    return { status: res.status, location: loc, result: loc.searchParams.get('result'), mode: loc.searchParams.get('mode'), login: loc.searchParams.get('login'), ticket: loc.searchParams.get('ticket') };
  };
  return { ...h, issued, exchanges, login, callback };
}

describe('리다이렉트 로그인(카카오·ChatGPT OIDC)', () => {
  test('제공자 가용성: 키가 없으면 꺼짐', async () => {
    const off = await v1Harness({ env: { GOOGLE_CLIENT_IDS: '' } });
    expect((await off.send('GET', '/auth/providers')).body).toEqual({ google: false, kakao: false, chatgpt: false });
    const on = await oidcHarness();
    expect((await on.send('GET', '/auth/providers')).body).toEqual({ google: true, kakao: true, chatgpt: true });
    const kakaoOnly = await oidcHarness({ KAKAO_REST_KEY: 'k' });
    expect((await kakaoOnly.send('GET', '/auth/providers')).body.chatgpt).toBe(false);
    expect((await kakaoOnly.send('POST', '/auth/oauth/start', { provider: 'chatgpt', mode: 'recover', deviceKey: newDeviceKey() })).status).toBe(501);
  });

  test('인가 URL: 카카오는 state·nonce, ChatGPT는 PKCE S256까지', async () => {
    const h = await oidcHarness();
    const k = await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'recover', deviceKey: newDeviceKey() });
    const ku = new URL(k.body.url);
    expect(ku.origin + ku.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(ku.searchParams.get('client_id')).toBe('kakao-rest');
    expect(ku.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/v1/auth/oauth/callback/kakao');
    expect(ku.searchParams.get('scope')).toBe('openid');
    expect(ku.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ku.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/);
    const c = await h.send('POST', '/auth/oauth/start', { provider: 'chatgpt', mode: 'recover', deviceKey: newDeviceKey() });
    const cu = new URL(c.body.url);
    expect(cu.origin + cu.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(cu.searchParams.get('scope')).toBe('openid profile email');
    expect(cu.searchParams.get('code_challenge_method')).toBe('S256');
    // state 원문은 D1에 남지 않는다(해시만).
    expect(JSON.stringify(h.db.sqlite.query('SELECT * FROM oauth_states').all())).not.toContain(ku.searchParams.get('state')!);
  });

  test('link 모드는 세션이 필요하고 recover 모드는 기기 키가 필요', async () => {
    const h = await oidcHarness();
    expect((await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' })).body.error).toBe('token');
    expect((await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'recover' })).status).toBe(401);
    expect((await h.send('POST', '/auth/oauth/start', { provider: 'google', mode: 'recover', deviceKey: newDeviceKey() })).body.error).toBe('provider');
    expect((await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'merge', deviceKey: newDeviceKey() })).body.error).toBe('mode');
  });

  test('게스트 → 카카오 연동 → 다른 기기에서 카카오 로그인 = 같은 진행 복원', async () => {
    const h = await oidcHarness();
    const a = await h.session();
    const linked = await h.login('kakao', 'link', 'kakao-user-1', { token: a.token });
    expect(linked.res!.status).toBe(302);
    expect(linked.res!.location.origin).toBe(ORIGIN);
    expect([linked.result, linked.mode, linked.res!.login]).toEqual(['ok', 'link', 'kakao']);
    expect((await h.send('GET', '/me', undefined, a.token)).body.linked).toEqual(['kakao']);
    // 토큰 교환은 서버가 카카오 토큰 엔드포인트로, 리다이렉트 URI를 다시 실어 보낸다.
    expect(h.exchanges[0].url).toBe('https://kauth.kakao.com/oauth/token');
    expect(new URLSearchParams(h.exchanges[0].body).get('redirect_uri')).toBe(ORIGIN + '/api/v1/auth/oauth/callback/kakao');
    // 새 기기(세션을 만든 적 없는 키)
    const phone = newDeviceKey();
    const rec = await h.login('kakao', 'recover', 'kakao-user-1', { deviceKey: phone });
    expect(rec.result).toBe('ok');
    expect(rec.fin!.body.accountId).toBe(a.accountId);
    expect((await h.send('GET', '/me', undefined, rec.fin!.body.token)).body.accountId).toBe(a.accountId);
    const s = await h.session(phone);
    expect(s.accountId).toBe(a.accountId);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
  });

  test('연동 없는 카카오로 recover → no-link(기기 상태 그대로), 다른 계정에 이어진 카카오로 link → linked-elsewhere', async () => {
    const h = await oidcHarness();
    const device = newDeviceKey();
    expect((await h.login('kakao', 'recover', 'nobody', { deviceKey: device })).result).toBe('no-link');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_keys').get()).toEqual({ n: 0 });
    const a = await h.session(), b = await h.session();
    expect((await h.login('kakao', 'link', 'k-1', { token: a.token })).result).toBe('ok');
    expect((await h.login('kakao', 'link', 'k-1', { token: b.token })).result).toBe('linked-elsewhere');
    expect((await h.login('kakao', 'link', 'k-2', { token: a.token })).result).toBe('already-linked');
    // 같은 사람의 구글과 카카오는 한 계정에 둘 다 이어질 수 있다.
    h.google.set('g-tok', 'g-1');
    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'g-tok' }, a.token)).body.linked).toEqual(['google', 'kakao']);
  });

  test('state는 1회용·10분 만료, nonce 불일치·취소·교환 실패는 실패 코드', async () => {
    const h = await oidcHarness();
    const a = await h.session();
    const ok = await h.login('chatgpt', 'link', 'oa-1', { token: a.token });
    expect(ok.result).toBe('ok');
    expect(new URLSearchParams(h.exchanges.at(-1)!.body).get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 같은 state 재사용, 같은 티켓 재사용
    expect((await h.callback('chatgpt', `code=x&state=${ok.state}`)).result).toBe('expired');
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: ok.ticket }, a.token)).status).toBe(410);
    // 티켓을 state 자리에 넣어도 콜백으로 꺼낼 수 없다.
    const t2 = await h.login('chatgpt', 'link', 'oa-9', { token: (await h.session()).token, skipFinish: true });
    expect((await h.callback('chatgpt', `code=x&state=${t2.ticket}`)).result).toBe('expired');
    h.advance(5 * 60 * 1000 + 1);
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: t2.ticket }, (await h.session()).token)).status).toBe(410);
    expect((await h.login('chatgpt', 'link', 'oa-2', { token: (await h.session()).token, tamperNonce: true })).result).toBe('error');
    expect((await h.login('kakao', 'link', 'k', { token: a.token, error: 'access_denied' })).result).toBe('cancel');
    // 다른 제공자 콜백 경로로 state를 돌려도 거부
    const s = await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' }, a.token);
    expect((await h.callback('chatgpt', `code=c&state=${new URL(s.body.url).searchParams.get('state')}`)).result).toBe('expired');
    const late = await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' }, a.token);
    h.advance(10 * 60 * 1000 + 1);
    expect((await h.callback('kakao', `code=c&state=${new URL(late.body.url).searchParams.get('state')}`)).result).toBe('expired');
    const down = await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' }, (await h.session()).token);
    expect((await h.callback('kakao', `code=down&state=${new URL(down.body.url).searchParams.get('state')}`)).result).toBe('unavailable');
    expect((await h.callback('kakao', 'code=c&state=short')).result).toBe('error');
    expect((await h.callback('naver', 'code=c&state=' + 'a'.repeat(43))).result).toBe('error');
  });

  test('ChatGPT 기밀 클라이언트 비밀은 HTTP Basic, 카카오 비밀은 본문으로만', async () => {
    const h = await oidcHarness({ KAKAO_REST_KEY: 'kakao-rest', KAKAO_CLIENT_SECRET: 'ks', CHATGPT_CLIENT_ID: 'oaiapp_test', CHATGPT_CLIENT_SECRET: 'cs' });
    const a = await h.session();
    await h.login('chatgpt', 'link', 'oa', { token: a.token });
    expect(h.exchanges.at(-1)!.auth).toBe('Basic ' + btoa('oaiapp_test:cs'));
    expect(new URLSearchParams(h.exchanges.at(-1)!.body).has('client_secret')).toBe(false);
    await h.login('kakao', 'link', 'k', { token: a.token });
    expect(h.exchanges.at(-1)!.auth).toBeNull();
    expect(new URLSearchParams(h.exchanges.at(-1)!.body).get('client_secret')).toBe('ks');
  });

  test('콜백 응답은 결과 코드만 싣는다(코드·토큰·주체 없음)', async () => {
    const h = await oidcHarness();
    const r = await h.login('kakao', 'link', 'secret-sub', { token: (await h.session()).token });
    expect([...r.res!.location.searchParams.keys()].sort()).toEqual(['login', 'mode', 'result', 'ticket']);
    expect(r.res!.location.toString()).not.toContain('secret-sub');
    // 원문 sub는 D1에 저장하지 않는다.
    expect(JSON.stringify(h.db.sqlite.query('SELECT * FROM account_links').all())).not.toContain('secret-sub');
  });

  test('차단·삭제 계정 기기는 recover로 다른 계정으로 갈아타지 못함', async () => {
    const h = await oidcHarness();
    const a = await h.session(), b = await h.session();
    expect((await h.login('kakao', 'link', 'k-a', { token: a.token })).result).toBe('ok');
    h.db.sqlite.exec(`UPDATE accounts SET status = 'banned' WHERE account_id = '${b.accountId}'`);
    expect((await h.login('kakao', 'recover', 'k-a', { deviceKey: b.deviceKey })).result).toBe('banned');
  });
});

describe('연동 CSRF 차단(티켓은 시작한 계정·기기에만)', () => {
  test('공격자가 자기 세션으로 시작한 인가 URL을 피해자가 열어도 피해자 앱은 티켓을 쓸 수 없다', async () => {
    const h = await oidcHarness();
    const attacker = await h.session(), victim = await h.session();
    // 피해자가 공격자의 URL로 카카오 로그인 → 콜백은 티켓만 만든다(아직 아무 연동 없음).
    const r = await h.login('kakao', 'link', 'victim-kakao', { token: attacker.token, skipFinish: true });
    expect(r.res!.result).toBe('ok');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_links').get()).toEqual({ n: 0 });
    // 피해자 앱이 자기 세션으로 내면 거부된다(그리고 티켓은 소모된다).
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: r.ticket }, victim.token)).body.error).toBe('ticket-mismatch');
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: r.ticket }, attacker.token)).status).toBe(410);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_links').get()).toEqual({ n: 0 });
  });

  test('recover 티켓은 시작한 기기 키로만, 세션 없이 낸 link 티켓은 거부', async () => {
    const h = await oidcHarness();
    const a = await h.session();
    await h.login('kakao', 'link', 'k-owner', { token: a.token });
    const mine = newDeviceKey();
    const r = await h.login('kakao', 'recover', 'k-owner', { deviceKey: mine, skipFinish: true });
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: r.ticket, deviceKey: newDeviceKey() })).body.error).toBe('ticket-mismatch');
    const r2 = await h.login('kakao', 'recover', 'k-owner', { deviceKey: mine, skipFinish: true });
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: r2.ticket })).body.error).toBe('ticket-mismatch');
    const l = await h.login('kakao', 'link', 'k-x', { token: (await h.session()).token, skipFinish: true });
    expect((await h.send('POST', '/auth/oauth/finish', { ticket: l.ticket })).body.error).toBe('ticket-mismatch');
  });
});

describe('회원 탈퇴', () => {
  test('확인 문자열 필요 → deleting, 세션·연동·키 끊김, 문서 30일 보관, 같은 기기는 새 게스트', async () => {
    const h = await oidcHarness();
    const a = await h.session();
    await h.login('kakao', 'link', 'k-del', { token: a.token });
    expect((await h.send('POST', '/auth/delete', {}, a.token)).status).toBe(400);
    expect((await h.send('POST', '/auth/delete', { confirm: 'yes' }, a.token)).body.error).toBe('confirm');
    expect((await h.send('POST', '/auth/delete', { confirm: 'DELETE' }, a.token)).body).toEqual({ ok: true });
    expect((await h.send('GET', '/me', undefined, a.token)).status).toBe(401);
    expect(h.db.sqlite.query('SELECT status FROM accounts WHERE account_id = ?').get(a.accountId)).toEqual({ status: 'deleting' });
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM account_links').get()).toEqual({ n: 0 });
    const arc = h.db.sqlite.query('SELECT reason, purge_at - archived_at AS keep FROM account_archive WHERE account_id = ?').get(a.accountId) as any;
    expect(arc).toEqual({ reason: 'deleted-by-user', keep: 30 * 24 * 3600 * 1000 });
    // 탈퇴한 카카오로는 더 이상 복원되지 않는다.
    expect((await h.login('kakao', 'recover', 'k-del', { deviceKey: newDeviceKey() })).result).toBe('no-link');
    const again = await h.session(a.deviceKey);
    expect(again.accountId).not.toBe(a.accountId);
  });
});

describe('리세마라 비용 방어', () => {
  test('새 계정 생성: IP당 시간 30·하루 100, 기존 계정 갱신은 별도', async () => {
    const h = await oidcHarness();
    for (let i = 0; i < 30; i++) await h.session();
    expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() })).status).toBe(429);
    let made = 30;
    for (let hour = 1; hour < 5; hour++) {
      h.advance(60 * 60 * 1000);
      for (let i = 0; i < 30; i++) { const r = await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() }); if (r.status === 200) made++; }
    }
    expect(made).toBe(100);
  });
});

describe('OIDC 검증기 공용화', () => {
  test('iss는 지정한 발급자만, aud 배열에 클라이언트가 있어야 함', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const now = 1_800_000_000_000;
    const v = createGoogleVerifier({ now: () => now, issuers: ['https://auth.openai.com'], fetch: async () => Response.json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }) });
    const sign = async (claims: Record<string, unknown>) => {
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const body = enc({ alg: 'RS256', kid: 'k1' }) + '.' + enc(claims);
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(body));
      return body + '.' + Buffer.from(sig).toString('base64url');
    };
    const base = { iss: 'https://auth.openai.com', sub: 'user-abc', iat: now / 1000, exp: now / 1000 + 600, nonce: 'n1' };
    expect(await v.verify(await sign({ ...base, aud: ['oaiapp_x', 'other'] }), ['oaiapp_x'])).toEqual({ sub: 'user-abc', nonce: 'n1' });
    await expect(v.verify(await sign({ ...base, aud: ['other'] }), ['oaiapp_x'])).rejects.toThrow();
    await expect(v.verify(await sign({ ...base, aud: 'oaiapp_x', iss: 'https://accounts.google.com' }), ['oaiapp_x'])).rejects.toThrow();
  });
});
