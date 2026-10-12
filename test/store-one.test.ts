import { afterEach, beforeAll, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { handleStoreRequest, STORE_DATABASE_ID, STORE_PRODUCT_ID, GOOGLE_PACKAGE_NAME, storeHash,
  type StoreD1Database, type StoreD1Statement, type StoreEnv } from '../worker/store';

// 독립 ONE V7 제공자 fixture와 실제 RSA 서명/SQLite를 사용한다. 실결제/실제 ONE 인증 증거가 아니다.
const CLIENT = 'blade-one-fixture.apps.googleusercontent.com';
const ONE_PRESENTER = 'blade-one-android-fixture.apps.googleusercontent.com';
const API_ID = '9999943210', OAUTH_ID = '9999987654', PURCHASE_TOKEN = '26010100000000000001';
const SECRET = 'fixture+ONE/secret=', ACCESS = 'fixture-one-bearer';
const BASE = 'https://iap-apis.onestore.net';
let keyPair: CryptoKeyPair, publicJwk: JsonWebKey;
const databases: Database[] = [], mocks: { mockRestore(): void }[] = [];
afterEach(() => { for (const m of mocks.splice(0)) m.mockRestore(); for (const db of databases.splice(0)) db.close(); });
beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicJwk = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), use: 'sig', alg: 'RS256' };
});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function identity(sub = 'one-alice', patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: 'RS256', kid: 'one-fixture-key' })}.${encode({ sub, iss: 'https://accounts.google.com', aud: CLIENT, iat: now, exp: now + 3600, ...patch })}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(data))).toString('base64url')}`;
}
async function fixture() {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  sqlite.exec(readFileSync(new URL('../worker/store.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, args: (string | number | null)[] = []): StoreD1Statement => ({
    bind: (...values) => prepare(sql, values), first: async <T>() => sqlite.query(sql).get(...args) as T | null,
    all: async <T>() => ({ success: true, results: sqlite.query(sql).all(...args) as T[] }),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...args).changes } }),
  });
  const db: StoreD1Database = { prepare, batch: async <T>(statements: StoreD1Statement[]) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results as any; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  let secret: unknown = { client_id: OAUTH_ID, client_secret: SECRET, api_client_id: API_ID, package_name: GOOGLE_PACKAGE_NAME, environment: 'production-v7' };
  const env: StoreEnv = {
    COMMERCE_DB: db, COMMERCE_DATABASE_ID: STORE_DATABASE_ID, STORE_BILLING_ENABLED: 'true',
    BLADESURGE_GOOGLE_IDENTITY_READY: 'true', BLADESURGE_GOOGLE_CLIENT_ID: CLIENT,
    BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED: 'true', ONE_SERVER_API_ENABLED: 'true', ONE_REMOVE_ADS_ACTIVE: 'true',
    BLADESURGE_ONE_PACKAGE_NAME: GOOGLE_PACKAGE_NAME, BLADESURGE_ONE_API_CLIENT_ID: API_ID, BLADESURGE_ONE_OAUTH_CLIENT_ID: OAUTH_ID,
    ONE_PUBLISHER: { get: async () => JSON.stringify(secret) },
  };
  Object.assign(env, { BLADESURGE_ONESTORE_GOOGLE_PRESENTERS: JSON.stringify([CLIENT, ONE_PRESENTER]) });
  const calls: Request[] = [];
  const account = await storeHash(await storeHash('onestore:one-alice'));
  let purchase: Record<string, unknown> = { consumptionState: 0, developerPayload: account, purchaseState: 0,
    purchaseTime: Date.now() - 1000, purchaseId: '26010111111111111111', acknowledgeState: 0, quantity: 1 };
  let oauth: Record<string, unknown> = { client_id: OAUTH_ID, access_token: ACCESS, token_type: 'bearer', expires_in: 3600, scope: 'DEFAULT' };
  let ack: unknown = { result: { code: 'Success', message: 'fixture only' } };
  let afterAck: Record<string, unknown> = {}, ackTakesEffect = true, down = false, hang = false, jwksWrong = false;
  let orderStatus = 200, activeToken = PURCHASE_TOKEN;
  let firstGet: (() => Promise<void>) | undefined;
  const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input); calls.push(request.clone());
    if (down) throw new Error(`do-not-leak ${SECRET} ${ACCESS}`);
    if (request.url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: [{ ...publicJwk, kid: jwksWrong ? 'different-kid' : 'one-fixture-key' }] });
    }
    if (request.url === `${BASE}/v7/oauth/token`) {
      expect(request.method).toBe('POST'); expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
      expect(request.headers.get('x-market-code')).toBe('MKT_ONE');
      expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({ grant_type: 'client_credentials', client_id: OAUTH_ID, client_secret: SECRET });
      return Response.json(oauth);
    }
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS}`);
    expect(request.headers.get('x-market-code')).toBe('MKT_ONE');
    expect(request.headers.get('content-type')).toBe('application/json');
    if (request.url.endsWith('/acknowledge')) {
      expect(request.url).toBe(`${BASE}/v7/apps/${API_ID}/purchases/all/products/${STORE_PRODUCT_ID}/${activeToken}/acknowledge`);
      expect(request.method).toBe('POST'); expect(await request.json()).toEqual({ developerPayload: account });
      if (ackTakesEffect) purchase = { ...purchase, acknowledgeState: 1, ...afterAck };
      return Response.json(ack);
    }
    expect(request.url).toBe(`${BASE}/v7/apps/${API_ID}/purchases/inapp/products/${STORE_PRODUCT_ID}/${activeToken}`);
    expect(request.method).toBe('GET'); expect(request.body).toBeNull();
    if (hang) return new Promise<Response>(() => {});
    const observed = { ...purchase }; if (firstGet) await firstGet();
    return Response.json(observed, { status: orderStatus });
  }) as typeof fetch); mocks.push(mock);
  const send = async (path: string, body?: any, token?: string) => {
    const r = await handleStoreRequest(new Request(`https://blade.tllhouse.com/api/store/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://localhost', 'X-Store-Channel': 'onestore',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: r.status, body: await r.json() as any };
  };
  const auth = async (sub = 'one-alice') => (await send('auth', { channel: 'onestore', idToken: await identity(sub) })).body;
  const intent = async (token: string, key = 'one-idempotent-key') => (await send('orders', { channel: 'onestore', productId: STORE_PRODUCT_ID, idempotencyKey: key }, token)).body;
  const verify = (token: string, intentId: string, purchaseToken = activeToken) => send('verify', { channel: 'onestore', intentId, purchaseToken }, token);
  const restore = (token: string) => send('restore', { channel: 'onestore', purchaseToken: activeToken }, token);
  return { env, sqlite, calls, send, auth, intent, verify, restore, account,
    token: (value: string) => { activeToken = value; },
    purchase: (patch: Record<string, unknown>) => { purchase = { ...purchase, ...patch }; },
    oauth: (patch: Record<string, unknown>) => { oauth = { ...oauth, ...patch }; },
    secret: (value: unknown) => { secret = value; }, secretPatch: (patch: Record<string, unknown>) => { secret = { ...(secret as any), ...patch }; },
    ack: (value: unknown) => { ack = value; }, ackEffect: (value: boolean) => { ackTakesEffect = value; },
    afterAck: (patch: Record<string, unknown>) => { afterAck = patch; }, down: () => { down = true; }, hang: () => { hang = true; },
    http: (status: number) => { orderStatus = status; }, badJwks: () => { jwksWrong = true; },
    before: (value?: () => Promise<void>) => { firstGet = value; }, unmock: () => { mocks.pop()!.mockRestore(); } };
}

test('ONE V7 capability is reachable through exact Blade configuration and defaults disabled without it', async () => {
  const s = await fixture(); expect((await s.send('capabilities?channel=onestore')).body.billing).toBe(true);
  for (const patch of [
    { ONE_SERVER_API_ENABLED: undefined }, { ONE_SERVER_API_ENABLED: 'false' }, { ONE_PUBLISHER: undefined },
    { BLADESURGE_ONE_PACKAGE_NAME: 'com.other.app' }, { BLADESURGE_ONE_API_CLIENT_ID: undefined },
    { BLADESURGE_ONE_API_CLIENT_ID: 'other/id?host=evil' }, { BLADESURGE_ONE_OAUTH_CLIENT_ID: undefined },
    { ONE_REMOVE_ADS_ACTIVE: 'false' }, { BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED: 'false' }, { BLADESURGE_GOOGLE_IDENTITY_READY: 'false' },
  ]) {
    const r = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/capabilities?channel=onestore'), { ...s.env, ...patch });
    expect((await r.json() as any).billing).toBe(false);
  }
  expect(s.calls).toHaveLength(0);
});
test('B1 ONE accepts its approved distinct Android presenter and rejects a presenter approved only for Google Play', async () => {
  const s = await fixture();
  const hybrid = await s.send('auth', { channel: 'onestore', idToken: await identity('one-alice', { azp: ONE_PRESENTER }) });
  expect(hybrid.status).toBe(200); expect(hybrid.body.subject).toBe(await storeHash('onestore:one-alice'));
  const foreign = 'blade-play-only-fixture.apps.googleusercontent.com';
  Object.assign(s.env, { BLADESURGE_GOOGLEPLAY_GOOGLE_PRESENTERS: JSON.stringify([CLIENT, foreign]) });
  expect((await s.send('auth', { channel: 'onestore', idToken: await identity('one-alice', { azp: foreign }) })).status).toBe(401);
  Object.assign(s.env, { BLADESURGE_ONESTORE_GOOGLE_PRESENTERS: undefined });
  const count = s.calls.length;
  expect((await s.send('auth', { channel: 'onestore', idToken: await identity() })).status).toBe(503); expect(s.calls.length).toBe(count);
});
test('B4 ONE 21st repurchase after 20 verified refunds is acknowledged/read back/recorded without losing history', async () => {
  const s = await fixture(), auth = await s.auth();
  for (let i = 1; i <= 20; i++) {
    const token = `260101${String(i).padStart(14, '0')}`; s.token(token); s.purchase({ purchaseState: 0, acknowledgeState: 0, purchaseId: token });
    const intent = await s.intent(auth.token, `one-repurchase-${i}`);
    expect((await s.verify(auth.token, intent.intentId)).body.adFree).toBe(true);
    s.purchase({ purchaseState: 1 }); expect((await s.restore(auth.token)).body.adFree).toBe(false);
  }
  const history = s.sqlite.query('SELECT * FROM store_ledger ORDER BY purchase_hash').all(); expect(history).toHaveLength(20);
  s.token('26010100000000000021'); s.purchase({ purchaseState: 0, acknowledgeState: 0, purchaseId: '26010100000000000021' });
  const next = await s.intent(auth.token, 'one-repurchase-21'), result = await s.verify(auth.token, next.intentId);
  expect(result.status).toBe(200); expect(result.body.adFree).toBe(true);
  expect(s.calls.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(21);
  expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 21 });
  expect(s.sqlite.query("SELECT * FROM store_ledger WHERE state = 'refunded' ORDER BY purchase_hash").all()).toEqual(history);
  expect(s.sqlite.query("SELECT grant_count FROM store_ledger WHERE state = 'paid'").get()).toEqual({ grant_count: 1 });
});
test('ONE uses signed Google identity, fixed production OAuth/path and server-issued account payload before acknowledge', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token);
  expect(auth.subject).toBe(await storeHash('onestore:one-alice')); expect(prepared.obfuscatedAccountId).toBe(s.account);
  const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(200); expect(r.body.adFree).toBe(true);
  expect(s.calls.map(r => r.url)).toEqual([
    'https://www.googleapis.com/oauth2/v3/certs', `${BASE}/v7/oauth/token`,
    `${BASE}/v7/apps/${API_ID}/purchases/inapp/products/remove_ads_v1/${PURCHASE_TOKEN}`,
    `${BASE}/v7/apps/${API_ID}/purchases/all/products/remove_ads_v1/${PURCHASE_TOKEN}/acknowledge`,
    `${BASE}/v7/apps/${API_ID}/purchases/inapp/products/remove_ads_v1/${PURCHASE_TOKEN}`,
  ]);
  expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'paid', grant_count: 1 });
  const rows = JSON.stringify({ ledger: s.sqlite.query('SELECT * FROM store_ledger').all(), sessions: s.sqlite.query('SELECT * FROM store_sessions').all() });
  for (const raw of [SECRET, ACCESS, PURCHASE_TOKEN, auth.token, 'one-alice']) expect(rows).not.toContain(raw);
  expect(s.calls.some(r => /consume|revoke|refund|sbpp|apis\.onestore\.co\.kr/.test(r.url))).toBe(false);
});
test('ONE Google crypto identity rejects wrong audience, forged signature and foreign JWKS before issuing a session', async () => {
  const s = await fixture();
  const wrong = await s.send('auth', { channel: 'onestore', idToken: await identity('one-alice', { aud: 'other-product.apps.googleusercontent.com' }) });
  expect(wrong.status).toBe(401); expect(s.calls).toHaveLength(0);
  const parts = (await identity()).split('.'); parts[2] = Buffer.alloc(256, 9).toString('base64url');
  expect((await s.send('auth', { channel: 'onestore', idToken: parts.join('.') })).status).toBe(401);
  s.badJwks(); expect((await s.send('auth', { channel: 'onestore', idToken: await identity() })).status).toBe(401);
  expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_sessions').get()).toEqual({ n: 0 });
});
test('another product/sandbox credentials, malformed secret and wrong OAuth client cannot reach purchase lookup', async () => {
  for (const patch of [{ package_name: 'com.other.product' }, { api_client_id: 'another-api-id' },
    { client_id: 'other-product-oauth' }, { environment: 'sandbox' }, { client_secret: '' }]) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.secretPatch(patch);
    const count = s.calls.length, r = await s.verify(auth.token, prepared.intentId);
    expect(r.status).toBe(503); expect(r.body.adFree).toBe(false); expect(s.calls.length).toBe(count); s.unmock();
  }
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.secret(null);
  expect((await s.verify(auth.token, prepared.intentId)).status).toBe(503);
});
test('OAuth response identity/type/expiry must be official and positive; HTTP success does not imply purchase success', async () => {
  for (const patch of [{ client_id: 'wrong-client' }, { token_type: 'other' }, { expires_in: 0 }, { access_token: '' }, { access_token: 'bad\nheader' }]) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.oauth(patch);
    const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(503); expect(r.body.adFree).toBe(false);
    expect(s.calls.filter(r => r.url.includes('/purchases/'))).toHaveLength(0); s.unmock();
  }
});
test('developerPayload is mandatory and must match before acknowledge, so a foreign purchase cannot be relabelled', async () => {
  for (const developerPayload of [undefined, 'client-provided-payload', await storeHash('foreign-account')]) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.purchase({ developerPayload });
    const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(409); expect(r.body.adFree).toBe(false);
    expect(s.calls.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(0);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 0 }); s.unmock();
  }
});
test('numeric purchase state, quantity one, unconsumed status and documented metadata are required', async () => {
  for (const patch of [{ purchaseState: '0' }, { purchaseState: 2 }, { quantity: 2 }, { quantity: '1' },
    { consumptionState: 1 }, { acknowledgeState: '1' }, { purchaseId: undefined }, { purchaseTime: Date.now() + 60_000 }, { error: 'NoSuchData', purchaseState: undefined }]) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.purchase(patch);
    const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(422); expect(r.body.adFree).toBe(false);
    expect(s.calls.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(0); s.unmock();
  }
});
test('malformed/sandbox tokens and extra client package/product fields cannot redirect the fixed lookup', async () => {
  for (const token of ['x'.repeat(21), '../other', 'SANDBOX0000000000001', 'abc?other=product']) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token), count = s.calls.length;
    expect((await s.verify(auth.token, prepared.intentId, token)).status).toBe(400); expect(s.calls.length).toBe(count); s.unmock();
  }
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token);
  expect((await s.send('verify', { channel: 'onestore', intentId: prepared.intentId, purchaseToken: PURCHASE_TOKEN, productId: 'other-product' }, auth.token)).status).toBe(400);
  expect((await s.send('verify', { channel: 'onestore', intentId: prepared.intentId, purchaseToken: PURCHASE_TOKEN, packageName: 'com.other.app' }, auth.token)).status).toBe(400);
});
test('acknowledge requires the exact Success envelope and a matching confirmed readback; never consumes', async () => {
  for (const ack of [{ code: 'Success' }, { result: { code: 'Failure' } }, { result: { code: 'success' } }]) {
    const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.ack(ack);
    const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(503); expect(r.body.adFree).toBe(false);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 0 }); s.unmock();
  }
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.ackEffect(false);
  const r = await s.verify(auth.token, prepared.intentId); expect(r.status).toBe(503); expect(r.body.error).toBe('purchase-acknowledgement-unverified');
});
test('an acknowledgement race with refund records a tombstone, and a changed purchaseId is rejected', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.afterAck({ purchaseState: 1 });
  expect((await s.verify(auth.token, prepared.intentId)).body.adFree).toBe(false);
  expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'refunded', grant_count: 0 }); s.unmock();
  const other = await fixture(), user = await other.auth(), order = await other.intent(user.token); other.afterAck({ purchaseId: 'changed-purchase-id' });
  expect((await other.verify(user.token, order.intentId)).status).toBe(422);
  expect(other.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 0 });
});
test('already acknowledged purchases are idempotent; cross-subject replay stops before any provider call', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.purchase({ acknowledgeState: 1 });
  const results = await Promise.all([s.verify(auth.token, prepared.intentId), s.verify(auth.token, prepared.intentId)]);
  expect(results.every(r => r.status === 200 && r.body.adFree === true)).toBe(true);
  expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'paid', grant_count: 1 });
  expect(s.calls.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(0);
  const bob = await s.auth('one-bob'), count = s.calls.length;
  expect((await s.restore(bob.token)).status).toBe(409); expect(s.calls.length).toBe(count);
});
test('restore verifies latest cancellation and a late paid result cannot remove the refund tombstone', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.purchase({ acknowledgeState: 1 });
  await s.verify(auth.token, prepared.intentId);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  s.before(async () => { entered(); await wait; }); const latePaid = s.restore(auth.token); await started;
  s.before(); s.purchase({ purchaseState: 1 }); expect((await s.restore(auth.token)).body.adFree).toBe(false);
  release(); expect((await latePaid).body.adFree).toBe(false);
  expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'refunded', grant_count: 1 });
});
test('provider error/404 never falls back to the paid ledger; raw credentials and provider errors are masked', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.purchase({ acknowledgeState: 1 });
  await s.verify(auth.token, prepared.intentId); s.http(404);
  const notFound = await s.restore(auth.token); expect(notFound.status).toBe(503); expect(notFound.body.adFree).toBe(false);
  s.down(); const r = await s.restore(auth.token);
  expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'provider-unavailable', adFree: false });
  expect(JSON.stringify(r.body)).not.toContain(SECRET); expect((s.sqlite.query('SELECT state FROM store_ledger').get() as any).state).toBe('paid');
});
test('ONE provider lookup has a real deadline and cannot grant when the response never arrives', async () => {
  const s = await fixture(), auth = await s.auth(), prepared = await s.intent(auth.token); s.hang();
  const start = Date.now(), r = await s.verify(auth.token, prepared.intentId);
  expect(r.status).toBe(503); expect(r.body.adFree).toBe(false); expect(Date.now() - start).toBeLessThan(6500);
  expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 0 });
}, 8000);
