import { afterEach, beforeAll, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { handleStoreRequest, STORE_DATABASE_ID, GOOGLE_PACKAGE_NAME, STORE_PRODUCT_ID, storeHash,
  type StoreD1Database, type StoreD1Statement, type StoreEnv } from '../worker/store';

// 모든 키/제공자 응답은 이 테스트에서 만든 fixture다. 실제 Google/Toss 인증 증거가 아니다.
const CLIENT_ID = 'blade-fixture.apps.googleusercontent.com';
const PLAY_PRESENTER = 'blade-fixture-android-play.apps.googleusercontent.com';
const ONE_PRESENTER = 'blade-fixture-android-one.apps.googleusercontent.com';
let keys: CryptoKeyPair, jwk: JsonWebKey, privatePem: string;
const databases: Database[] = [], mocks: { mockRestore(): void }[] = [];
afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore(); for (const sqlite of databases.splice(0)) sqlite.close(); });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), alg: 'RS256', use: 'sig' };
  privatePem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
});
async function idToken(patch: Record<string, unknown> = {}, headerPatch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', kid: 'fixture-key', ...headerPatch })}.${encode({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-user-123', iat: now, exp: now + 3600, ...patch,
  })}`;
  return `${unsigned}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')}`;
}
function setup() {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  sqlite.exec(readFileSync(new URL('../worker/store.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, values: (string | number | null)[] = []): StoreD1Statement => ({
    bind: (...args) => prepare(sql, args), first: async <T>() => sqlite.query(sql).get(...values) as T | null,
    all: async <T>() => ({ success: true, results: sqlite.query(sql).all(...values) as T[] }),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...values).changes } }),
  });
  const db: StoreD1Database = { prepare, batch: async <T>(statements: StoreD1Statement[]) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results as any; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  const env: StoreEnv = {
    COMMERCE_DB: db, COMMERCE_DATABASE_ID: STORE_DATABASE_ID, STORE_BILLING_ENABLED: 'true',
    BLADESURGE_GOOGLE_IDENTITY_READY: 'true', BLADESURGE_GOOGLE_CLIENT_ID: CLIENT_ID,
    BLADESURGE_GOOGLE_PACKAGE_NAME: GOOGLE_PACKAGE_NAME, GOOGLE_REMOVE_ADS_ACTIVE: 'true',
    GOOGLE_PUBLISHER: { get: async () => JSON.stringify({ type: 'service_account', client_email: 'blade@fixture.iam.gserviceaccount.com', private_key: privatePem, token_uri: 'https://oauth2.googleapis.com/token' }) },
  };
  Object.assign(env, { BLADESURGE_GOOGLEPLAY_GOOGLE_PRESENTERS: JSON.stringify([CLIENT_ID, PLAY_PRESENTER]),
    BLADESURGE_ONESTORE_GOOGLE_PRESENTERS: JSON.stringify([CLIENT_ID, ONE_PRESENTER]) });
  const calls: Request[] = [];
  let state = 'PURCHASED', product = STORE_PRODUCT_ID, quantity = 1, refundableQuantity = 1;
  const boundAccount = Symbol('fixture-bound-account');
  let account: unknown = boundAccount, pendingAck = false, ackFail = false, down = false, badJwks = false;
  const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input); calls.push(request.clone());
    if (down) throw new Error('private-provider-error-bearer');
    if (request.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [{ ...jwk, kid: badJwks ? 'foreign-key' : 'fixture-key' }] });
    if (request.url === 'https://oauth2.googleapis.com/token') {
      expect(request.method).toBe('POST');
      const form = new URLSearchParams(await request.text());
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      const parts = form.get('assertion')!.split('.'), claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(claims).toMatchObject({ aud: 'https://oauth2.googleapis.com/token', iss: 'blade@fixture.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher' });
      expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000)); expect(claims.exp - claims.iat).toBe(3600);
      expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))).toBe(true);
      return Response.json({ token_type: 'Bearer', access_token: 'fixture-access-token', expires_in: 3600 });
    }
    expect(request.url.startsWith(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/`)).toBe(true);
    expect(request.headers.get('authorization')).toBe('Bearer fixture-access-token');
    if (request.url.endsWith(':acknowledge')) {
      expect(request.method).toBe('POST'); expect(await request.json()).toEqual({});
      return new Response(null, { status: ackFail ? 503 : 204 });
    }
    expect(request.method).toBe('GET'); expect(request.body).toBeNull();
    return Response.json({ purchaseStateContext: { purchaseState: state },
      productLineItem: [{ productId: product, productOfferDetails: { quantity, refundableQuantity, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' } }],
      acknowledgementState: pendingAck ? 'ACKNOWLEDGEMENT_STATE_PENDING' : 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      ...(account === undefined ? {} : { obfuscatedExternalAccountId: account === boundAccount
        ? await storeHash(await storeHash('googleplay:google-user-123')) : account }),
    });
  }) as typeof fetch); mocks.push(mock);
  const send = async (path: string, body?: any, token?: string, headers: Record<string, string> = {}) => {
    const response = await handleStoreRequest(new Request(`https://blade.tllhouse.com/api/store/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://localhost',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  };
  const auth = async () => (await send('auth', { channel: 'googleplay', idToken: await idToken() })).body;
  const intent = async (token: string, key = 'google-fixed-key') => (await send('orders', { channel: 'googleplay', productId: STORE_PRODUCT_ID, idempotencyKey: key }, token)).body.intentId;
  const verify = (token: string, intentId: string, purchaseToken = 'fixture-purchase/token') => send('verify', { channel: 'googleplay', intentId, purchaseToken }, token);
  return { sqlite, env, calls, send, auth, intent, verify,
    state: (v: string) => { state = v; }, product: (v: string) => { product = v; }, quantity: (v: number) => { quantity = v; },
    refundable: (v: number) => { refundableQuantity = v; }, account: (v: unknown) => { account = v; },
    pendingAck: (v = true) => { pendingAck = v; }, ackFail: () => { ackFail = true; }, down: () => { down = true; }, badJwks: () => { badJwks = true; } };
}

test('RS256 Google identity is verified against fixed Google JWKS; D1 stores only session hash', async () => {
  const s = setup(), jwt = await idToken(), r = await s.send('auth', { channel: 'googleplay', idToken: jwt });
  expect(r.status).toBe(200); expect(r.body.subject).toBe(await storeHash('googleplay:google-user-123'));
  expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(r.body.expiresAt - Date.now()).toBeGreaterThan(899_000);
  const stored = JSON.stringify(s.sqlite.query('SELECT * FROM store_sessions').all());
  expect(stored).not.toContain(jwt); expect(stored).not.toContain(r.body.token); expect(stored).not.toContain('google-user-123');
  expect(s.calls).toHaveLength(1); expect(s.calls[0].url).toBe('https://www.googleapis.com/oauth2/v3/certs');
});

test('B1 signed hybrid Android azp is approved independently of the fixed web aud and isolated by channel', async () => {
  const s = setup();
  const hybrid = await s.send('auth', { channel: 'googleplay', idToken: await idToken({ azp: PLAY_PRESENTER }) });
  expect(hybrid.status).toBe(200); expect(hybrid.body.subject).toBe(await storeHash('googleplay:google-user-123'));
  for (const azp of [ONE_PRESENTER, 'foreign-product.apps.googleusercontent.com', [PLAY_PRESENTER], null]) {
    expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken({ azp }) })).status).toBe(401);
  }
  expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken({ aud: PLAY_PRESENTER, azp: PLAY_PRESENTER }) })).status).toBe(401);
  expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken({ azp: CLIENT_ID }) })).status).toBe(200);
});
test('B1 missing or malformed presenter approval stays closed, including tokens omitting azp', async () => {
  const s = setup();
  for (const config of [undefined, '', '[]', '"*"', '["*"]', JSON.stringify([CLIENT_ID, 12])]) {
    Object.assign(s.env, { BLADESURGE_GOOGLEPLAY_GOOGLE_PRESENTERS: config });
    expect((await s.send('capabilities?channel=googleplay')).body.billing).toBe(false);
    expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken() })).status).toBe(503);
  }
  expect(s.calls).toHaveLength(0);
});
test('B2 missing or malformed Google account binding cannot be verified/restored or acknowledged', async () => {
  for (const account of [undefined, null, '', [], 'unbound-other-account']) {
    const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token); s.pendingAck(); s.account(account);
    const verified = await s.verify(auth.token, intent);
    expect(verified.status).toBe(409); expect(verified.body.adFree).toBe(false);
    const restored = await s.send('restore', { channel: 'googleplay', purchaseToken: 'fixture-purchase/token' }, auth.token);
    expect(restored.status).toBe(409); expect(restored.body.adFree).toBe(false);
    expect(s.calls.filter(r => r.url.endsWith(':acknowledge'))).toHaveLength(0);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 0 });
    mocks.pop()!.mockRestore();
  }
});
test('B4 Google 21st repurchase after 20 verified refunds is acknowledged, recorded and grants without deleting history', async () => {
  const s = setup(), auth = await s.auth(); s.pendingAck();
  for (let i = 1; i <= 20; i++) {
    const token = `fixture-history-token-${i}`, intent = await s.intent(auth.token, `repurchase-${i}`);
    s.state('PURCHASED'); s.refundable(1);
    expect((await s.verify(auth.token, intent, token)).body.adFree).toBe(true);
    s.state('CANCELLED'); s.refundable(0);
    expect((await s.send('restore', { channel: 'googleplay', purchaseToken: token }, auth.token)).body.adFree).toBe(false);
  }
  const history = s.sqlite.query('SELECT * FROM store_ledger ORDER BY purchase_hash').all(); expect(history).toHaveLength(20);
  const next = await s.intent(auth.token, 'repurchase-21'); s.state('PURCHASED'); s.refundable(1);
  const r = await s.verify(auth.token, next, 'fixture-new-token-21'); expect(r.status).toBe(200); expect(r.body.adFree).toBe(true);
  expect(s.calls.filter(r => r.url.endsWith(':acknowledge'))).toHaveLength(21);
  expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 21 });
  expect(s.sqlite.query("SELECT * FROM store_ledger WHERE state = 'refunded' ORDER BY purchase_hash").all()).toEqual(history);
  expect(s.sqlite.query("SELECT grant_count FROM store_ledger WHERE state = 'paid'").get()).toEqual({ grant_count: 1 });
});
test('wrong aud/issuer/expiry/future iat/azp/alg/remote key URL are rejected before network', async () => {
  const s = setup(), now = Math.floor(Date.now() / 1000);
  const cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ aud: 'other-app.apps.googleusercontent.com' }, {}], [{ aud: [CLIENT_ID] }, {}], [{ iss: 'https://evil.test' }, {}],
    [{ exp: now - 1 }, {}], [{ iat: now + 100 }, {}], [{ iat: now - 7200 }, {}], [{ azp: 'foreign' }, {}],
    [{ exp: '9999999999' }, {}], [{}, { alg: 'none' }], [{}, { jku: 'https://evil.test/keys' }],
  ];
  for (const [claims, header] of cases) expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken(claims, header) })).status).toBe(401);
  expect(s.calls).toHaveLength(0); expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_sessions').get()).toEqual({ n: 0 });
});
test('tampered signature/payload and foreign JWKS key cannot issue sessions', async () => {
  const s = setup(), jwt = await idToken(), parts = jwt.split('.');
  parts[2] = Buffer.alloc(256, 1).toString('base64url');
  expect((await s.send('auth', { channel: 'googleplay', idToken: parts.join('.') })).status).toBe(401);
  const forged = jwt.split('.'); forged[1] = encode({ ...JSON.parse(Buffer.from(forged[1], 'base64url').toString()), sub: 'attacker' });
  expect((await s.send('auth', { channel: 'googleplay', idToken: forged.join('.') })).status).toBe(401);
  s.badJwks(); expect((await s.send('auth', { channel: 'googleplay', idToken: jwt })).status).toBe(401);
  expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_sessions').get()).toEqual({ n: 0 });
});
test('native readiness, exact audience/package and dedicated publisher binding are mandatory; ONE defaults disabled', async () => {
  const s = setup();
  for (const patch of [{ BLADESURGE_GOOGLE_CLIENT_ID: undefined }, { BLADESURGE_GOOGLE_IDENTITY_READY: 'false' },
    { GOOGLE_PUBLISHER: undefined }, { BLADESURGE_GOOGLE_PACKAGE_NAME: 'com.other.app' }, { GOOGLE_REMOVE_ADS_ACTIVE: 'false' }]) {
    const r = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/auth', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'googleplay', idToken: await idToken() }) }), { ...s.env, ...patch });
    expect(r.status).toBe(503); expect((await r.json() as any).adFree).toBe(false);
  }
  s.env.BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED = 'true';
  expect((await s.send('capabilities?channel=onestore')).body).toMatchObject({ billing: false, ads: false, reason: 'one-api-disabled' });
  expect(s.calls).toHaveLength(0);
});
test('service-account JWT uses real crypto; Google V2 verifies exact product/quantity and only acknowledges permanent purchase', async () => {
  const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token); s.pendingAck();
  s.account(await storeHash(auth.subject));
  expect((await s.verify(auth.token, intent)).body.adFree).toBe(true);
  expect(s.calls.map(r => r.url)).toEqual([
    'https://www.googleapis.com/oauth2/v3/certs', 'https://oauth2.googleapis.com/token',
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/productsv2/tokens/fixture-purchase%2Ftoken`,
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/products/remove_ads_v1/tokens/fixture-purchase%2Ftoken:acknowledge`,
  ]);
  const rows = JSON.stringify(s.sqlite.query('SELECT * FROM store_ledger').all());
  expect(rows).not.toContain('fixture-purchase/token'); expect(rows).not.toContain('fixture-access-token'); expect(rows).not.toContain(privatePem);
  expect(s.calls.some(r => r.url.includes(':consume'))).toBe(false);
});
test('Google mismatched product, quantity or account and pending/unknown state cannot grant', async () => {
  for (const mode of ['product', 'quantity', 'account', 'pending', 'unknown', 'ack-failure']) {
    const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token);
    if (mode === 'product') s.product('other-product'); if (mode === 'quantity') s.quantity(2);
    if (mode === 'account') s.account('foreign-subject'); if (mode === 'pending') s.state('PENDING'); if (mode === 'unknown') s.state('UNKNOWN');
    if (mode === 'ack-failure') { s.pendingAck(); s.ackFail(); }
    const r = await s.verify(auth.token, intent); expect(r.body.adFree).toBe(false);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger WHERE grant_count = 1').get()).toEqual({ n: 0 });
    // 다음 fixture를 설치하기 전에 이 fetch mock을 해제한다.
    mocks.pop()!.mockRestore();
  }
});
test('native restore needs fresh receipt; refund tombstone and provider outage cannot return local entitlement', async () => {
  const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token); await s.verify(auth.token, intent);
  expect((await s.send('entitlements?channel=googleplay', undefined, auth.token)).body).toEqual({ error: 'restore-receipts-required', adFree: false });
  expect((await s.send('entitlements?channel=googleplay', undefined, auth.token, { 'X-Store-Receipt': 'fixture-purchase/token' })).body.adFree).toBe(true);
  s.state('CANCELLED'); s.refundable(0);
  expect((await s.send('restore', { channel: 'googleplay', purchaseToken: 'fixture-purchase/token' }, auth.token)).body.adFree).toBe(false);
  s.state('PURCHASED'); s.refundable(1); expect((await s.verify(auth.token, intent)).body.adFree).toBe(false);
  expect((s.sqlite.query('SELECT state FROM store_ledger').get() as any).state).toBe('refunded');
  s.down(); const r = await s.verify(auth.token, intent);
  expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'provider-unavailable', adFree: false });
});
test('public channels and exact origins are enforced without UA inference, wildcard, cookies or credentialed CORS', async () => {
  const s = setup();
  for (const ch of ['toss', 'google', 'one', 'arbitrary']) expect((await s.send(`capabilities?channel=${ch}`)).status).toBe(400);
  for (const origin of ['null', 'http://localhost', 'https://blade.tllhouse.com', 'https://evil.test']) {
    expect((await s.send('auth', { channel: 'googleplay', idToken: await idToken() }, undefined, { Origin: origin, 'User-Agent': 'Toss Android' })).status).toBe(403);
  }
  expect((await s.send('capabilities?channel=googleplay', undefined, undefined, { Cookie: 'session=forged' })).status).toBe(400);
  expect((await s.send('capabilities?channel=googleplay', undefined, undefined, { 'X-Store-Channel': 'onestore' })).status).toBe(403);
  const r = await s.send('capabilities?channel=googleplay');
  expect(r.headers.get('access-control-allow-origin')).toBe('https://localhost');
  expect(r.headers.has('access-control-allow-credentials')).toBe(false); expect(r.headers.get('cache-control')).toBe('no-store');
  for (const origin of ['https://blade-surge.apps.tossmini.com', 'https://blade-surge.private-apps.tossmini.com']) {
    const response = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/auth', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    }), s.env); expect(response.status).toBe(204); expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  }
  const legacy = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/auth', { method: 'OPTIONS', headers: {
    Origin: 'https://blade-surge.web.tossmini.com', 'Access-Control-Request-Method': 'POST',
  } }), s.env); expect(legacy.status).toBe(403);
  expect(s.calls).toHaveLength(0);
});
test('invalid bearer, channel replay and expired sessions stop before provider requests', async () => {
  const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token), count = s.calls.length;
  expect((await s.verify('x'.repeat(43), intent)).status).toBe(401);
  s.sqlite.query("UPDATE store_sessions SET channel = 'apps-in-toss'").run(); expect((await s.verify(auth.token, intent)).status).toBe(403);
  s.sqlite.exec("UPDATE store_sessions SET channel = 'googleplay', expires_at = created_at + 1");
  await new Promise(resolve => setTimeout(resolve, 3)); expect((await s.verify(auth.token, intent)).status).toBe(401);
  expect(s.calls.length).toBe(count);
});
test('server subject lookup budget bounds provider costs and never stores plaintext identity', async () => {
  const s = setup(), auth = await s.auth(), intent = await s.intent(auth.token);
  const hash = await storeHash(`lookup:googleplay:${auth.subject}`);
  s.sqlite.query('INSERT INTO store_budgets VALUES (?, ?, 59)').run(hash, Math.floor(Date.now() / 3_600_000));
  expect((await s.verify(auth.token, intent)).body.adFree).toBe(true);
  const count = s.calls.length, r = await s.verify(auth.token, intent);
  expect(r.status).toBe(429); expect(r.body.adFree).toBe(false); expect(s.calls.length).toBe(count);
  expect(s.sqlite.query('SELECT calls FROM store_budgets WHERE budget_hash = ?').get(hash)).toEqual({ calls: 60 });
  expect(JSON.stringify(s.sqlite.query('SELECT * FROM store_budgets').all())).not.toContain(auth.subject);
});

// 승인 ID는 합성 fixture다. 실제 AdMob 등록/소유권 확인이나 광고 호출은 하지 않는다.
const FIXTURE_ADMOB_APP = 'ca-app-pub-1234567890123456~1234567890';
const FIXTURE_ADMOB_UNIT = 'ca-app-pub-1234567890123456/0987654321';
const FIXTURE_ONE_ADMOB_APP = 'ca-app-pub-1234567890123456~2222222222';
const FIXTURE_ONE_ADMOB_UNIT = 'ca-app-pub-1234567890123456/2222222222';
function configureAds(env: StoreEnv, ch: 'googleplay' | 'onestore') {
  env.BLADESURGE_ADMOB_PACKAGE_NAME = GOOGLE_PACKAGE_NAME;
  if (ch === 'googleplay') {
    env.BLADESURGE_GOOGLEPLAY_ADS_ENABLED = 'true';
    env.BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID = FIXTURE_ADMOB_APP;
    env.BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID = FIXTURE_ADMOB_UNIT;
    env.BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID = FIXTURE_ADMOB_APP;
    env.BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID = FIXTURE_ADMOB_UNIT;
  } else {
    env.BLADESURGE_ONESTORE_ADS_ENABLED = 'true';
    env.BLADESURGE_ONESTORE_ADMOB_APP_ID = FIXTURE_ONE_ADMOB_APP;
    env.BLADESURGE_ONESTORE_ADMOB_INTERSTITIAL_ID = FIXTURE_ONE_ADMOB_UNIT;
    env.BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID = FIXTURE_ONE_ADMOB_APP;
    env.BLADESURGE_ONESTORE_ADMOB_APPROVED_INTERSTITIAL_ID = FIXTURE_ONE_ADMOB_UNIT;
  }
}
test('native ads default disabled; exact channel-approved Blade IDs allow ads independently of unconfigured billing', async () => {
  const s = setup(); s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  s.env.BLADESURGE_GOOGLE_CLIENT_ID = undefined; s.env.GOOGLE_PUBLISHER = undefined;
  for (const ch of ['googleplay', 'onestore'] as const) {
    expect((await s.send(`capabilities?channel=${ch}`)).body).toMatchObject({ billing: false, ads: false });
    configureAds(s.env, ch);
    expect((await s.send(`capabilities?channel=${ch}`)).body).toMatchObject({ billing: false, ads: true });
  }
  const google = (await s.send('capabilities?channel=googleplay')).body;
  const one = (await s.send('capabilities?channel=onestore')).body;
  expect(google.adConfiguration).toEqual({ appId: FIXTURE_ADMOB_APP, interstitialId: FIXTURE_ADMOB_UNIT });
  expect(one.adConfiguration).toEqual({ appId: FIXTURE_ONE_ADMOB_APP, interstitialId: FIXTURE_ONE_ADMOB_UNIT });
  expect(google.adConfiguration).not.toEqual(one.adConfiguration);
  expect(s.calls).toHaveLength(0);
});
test('missing, malformed, sample, unapproved or mismatched AdMob IDs and wrong package never enable native ads', async () => {
  const s = setup(); s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  for (const ch of ['googleplay', 'onestore'] as const) {
    configureAds(s.env, ch);
    const appField = ch === 'googleplay' ? 'BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID' : 'BLADESURGE_ONESTORE_ADMOB_APP_ID';
    const unitField = ch === 'googleplay' ? 'BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID' : 'BLADESURGE_ONESTORE_ADMOB_INTERSTITIAL_ID';
    const base = { ...s.env };
    const caps = async (patch: Partial<StoreEnv>) => {
      const r = await handleStoreRequest(new Request(`https://blade.tllhouse.com/api/store/capabilities?channel=${ch}`, { headers: { Origin: 'https://localhost' } }), { ...base, ...patch });
      expect(r.status).toBe(200); const result = await r.json() as any; expect(result.ads).toBe(false); expect(result.adConfiguration).toBeUndefined();
    };
    await caps({ [appField]: undefined }); await caps({ [unitField]: undefined });
    await caps({ BLADESURGE_ADMOB_PACKAGE_NAME: 'com.other.product' });
    await caps({ [appField]: 'unregistered-placeholder' });
    await caps({ [unitField]: 'ca-app-pub-1234567890123456/123' });
    await caps({ [appField]: `${FIXTURE_ADMOB_APP} ` });
    if (ch === 'googleplay') {
      await caps({ BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID: undefined });
      await caps({ BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID: undefined });
      await caps({ BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/9999999999' });
      await caps({ BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID: 'ca-app-pub-3940256099942544~3347511713', BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID: 'ca-app-pub-3940256099942544~3347511713',
        BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID: 'ca-app-pub-3940256099942544/1033173712', BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID: 'ca-app-pub-3940256099942544/1033173712' });
    } else {
      await caps({ BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID: undefined });
      await caps({ BLADESURGE_ONESTORE_ADMOB_APPROVED_INTERSTITIAL_ID: undefined });
      await caps({ BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID: 'ca-app-pub-1234567890123456~9999999999' });
      await caps({ BLADESURGE_ONESTORE_ADMOB_APP_ID: 'ca-app-pub-3940256099942544~3347511713', BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID: 'ca-app-pub-3940256099942544~3347511713',
        BLADESURGE_ONESTORE_ADMOB_INTERSTITIAL_ID: 'ca-app-pub-3940256099942544/1033173712', BLADESURGE_ONESTORE_ADMOB_APPROVED_INTERSTITIAL_ID: 'ca-app-pub-3940256099942544/1033173712' });
    }
  }
  expect(s.calls).toHaveLength(0);
});
test('native advertising activation is literal true and channel-specific; flags/approvals cannot cross channels', async () => {
  const s = setup(); s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  configureAds(s.env, 'onestore');
  expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  configureAds(s.env, 'googleplay'); s.env.BLADESURGE_ONESTORE_ADS_ENABLED = 'false';
  expect((await s.send('capabilities?channel=onestore')).body.ads).toBe(false);
  for (const value of [undefined, 'false', 'TRUE', '1']) {
    s.env.BLADESURGE_GOOGLEPLAY_ADS_ENABLED = value;
    expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
    s.env.BLADESURGE_ONESTORE_ADS_ENABLED = value;
    expect((await s.send('capabilities?channel=onestore')).body.ads).toBe(false);
  }
  s.env.BLADESURGE_GOOGLEPLAY_ADS_ENABLED = 'true';
  s.env.BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID = undefined;
  expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  const web = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/capabilities?channel=web', { headers: { Origin: 'https://blade.tllhouse.com' } }), s.env);
  expect((await web.json() as any).ads).toBe(false); expect(s.calls).toHaveLength(0);
});
test('simultaneous Google/ONE public ad IDs stay isolated; another channel or legacy shared IDs cannot substitute', async () => {
  const s = setup(); s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  configureAds(s.env, 'googleplay'); configureAds(s.env, 'onestore');
  s.env.BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID = FIXTURE_ONE_ADMOB_APP;
  s.env.BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID = FIXTURE_ONE_ADMOB_UNIT;
  const wrong = (await s.send('capabilities?channel=googleplay')).body;
  expect(wrong.ads).toBe(false); expect(wrong.adConfiguration).toBeUndefined();
  expect((await s.send('capabilities?channel=onestore')).body.adConfiguration).toEqual({ appId: FIXTURE_ONE_ADMOB_APP, interstitialId: FIXTURE_ONE_ADMOB_UNIT });
  Object.assign(s.env, { BLADESURGE_ADMOB_APP_ID: FIXTURE_ADMOB_APP, BLADESURGE_ADMOB_INTERSTITIAL_ID: FIXTURE_ADMOB_UNIT });
  s.env.BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID = undefined; s.env.BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID = undefined;
  expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  expect(s.calls).toHaveLength(0);
});
test('temporary billing disablement cannot advertise past a previously active or paid ad-free product', async () => {
  const s = setup(); configureAds(s.env, 'googleplay');
  const auth = await s.auth(), intent = await s.intent(auth.token);
  expect((await s.verify(auth.token, intent)).body.adFree).toBe(true);
  s.env.STORE_BILLING_ENABLED = 'false';
  expect((await s.send('capabilities?channel=googleplay')).body).toMatchObject({ billing: false, ads: false });
  // 상품을 비활성으로 바꿔도 지급 이력은 지워지지 않는다. 세션 없는 공개 capability도 광고를 거부한다.
  s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  expect((await s.send('capabilities?channel=googleplay', undefined, auth.token)).body.ads).toBe(false);
  expect((await s.send('entitlements?channel=googleplay', undefined, auth.token)).status).toBe(503);
  expect((s.sqlite.query('SELECT state, grant_count FROM store_ledger').get() as any)).toEqual({ state: 'paid', grant_count: 1 });
  const publisher = s.env.GOOGLE_PUBLISHER;
  s.env.STORE_BILLING_ENABLED = 'true'; s.env.GOOGLE_PUBLISHER = undefined;
  expect((await s.send('capabilities?channel=googleplay')).body).toMatchObject({ billing: false, ads: false, reason: 'google-binding-missing' });
  s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_PUBLISHER = publisher;
  configureAds(s.env, 'onestore'); s.env.ONE_REMOVE_ADS_ACTIVE = 'true';
  expect((await s.send('capabilities?channel=onestore')).body.ads).toBe(false);
  s.env.ONE_REMOVE_ADS_ACTIVE = 'false';
  expect((await s.send('capabilities?channel=onestore')).body.ads).toBe(true);
  // 과거 ONE 지급 기록은 SQLite fixture 주입이다. ONE 제공자 성공을 만들어내지 않는다.
  s.sqlite.query(`INSERT INTO store_ledger(channel, purchase_hash, subject, product_id, sku, toss_order_id, state, grant_count, granted_at, checked_at)
    VALUES ('onestore', ?, ?, 'remove_ads_v1', 'remove_ads_v1', NULL, 'paid', 1, ?, ?)`).run(await storeHash('old-one-receipt'), await storeHash('old-one-subject'), Date.now(), Date.now());
  expect((await s.send('capabilities?channel=onestore')).body.ads).toBe(false);
});
test('native ads fail closed when DB identity, schema or history read is unavailable even with approved configuration', async () => {
  const s = setup(); configureAds(s.env, 'googleplay'); s.env.STORE_BILLING_ENABLED = 'false'; s.env.GOOGLE_REMOVE_ADS_ACTIVE = 'false';
  const original = s.env.COMMERCE_DB;
  s.env.COMMERCE_DB = undefined; expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  s.env.COMMERCE_DB = original; s.env.COMMERCE_DATABASE_ID = 'wrong-database';
  expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  s.env.COMMERCE_DATABASE_ID = STORE_DATABASE_ID;
  s.sqlite.exec('DROP TABLE store_ledger'); expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  s.sqlite.exec('UPDATE store_binding SET schema_version = 0'); expect((await s.send('capabilities?channel=googleplay')).body.ads).toBe(false);
  expect(s.calls).toHaveLength(0);
});
