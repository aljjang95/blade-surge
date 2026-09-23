import { expect, test } from 'bun:test';
import { BATTLE_PASS, SKUS } from '../src/data/shop.js';
import { COMMERCE_CATALOG_VERSION, PREVIEW_CATALOG, handleCommerceRequest, type CommerceDatabase, type CommerceEnv } from '../worker/commerce';
import { handleRequest } from '../worker/index';

const origin = 'https://blade.tllhouse.com';
const clientId = 'blade-test.apps.googleusercontent.com';
const hmacKey = Buffer.alloc(32, 7).toString('base64url');
const now = Math.floor(Date.now() / 1000);
type Row = { sku: string; amount_krw: number; currency: string; sale_enabled: number };

class LocalDatabase {
  rows: Row[] = PREVIEW_CATALOG.map(({ sku, amountKRW }) => ({ sku, amount_krw: amountKRW, currency: 'KRW', sale_enabled: 0 }));
  subjects = new Map<string, { player_id: string; key_version: string }>();
  keyVersions = new Map<string, string>();
  writes = 0;
  prepare(sql: string) {
    const statement = (args: unknown[]): any => ({
      bind: (...values: unknown[]) => statement(values),
      all: async () => {
        if (sql.includes('FROM commerce_catalog')) return { results: args[0] === COMMERCE_CATALOG_VERSION ? this.rows : [] };
        if (sql.includes('FROM commerce_subjects AS old')) {
          const rows = [...this.subjects.values()];
          const versions = new Set(rows.filter((row) => row.key_version !== args[0]
            && !rows.some((current) => current.player_id === row.player_id && current.key_version === args[1])
            && !(row.key_version !== args[3] && rows.some((previous) => previous.player_id === row.player_id && previous.key_version === args[2])))
            .map((row) => row.key_version));
          return { results: [...versions].slice(0, 2).map((key_version) => ({ key_version })) };
        }
        return { results: [] };
      },
      first: async () => {
        if (sql.includes('FROM commerce_subjects')) return this.subjects.get(args[0] as string) ?? null;
        if (sql.includes('FROM commerce_key_versions')) {
          const key_proof = this.keyVersions.get(args[0] as string);
          return key_proof ? { key_proof } : null;
        }
        return null;
      },
      run: async () => {
        if (sql.includes('INTO commerce_key_versions')) {
          const [version, proof] = args as [string, string];
          if (!this.keyVersions.has(version) && ![...this.keyVersions.values()].includes(proof)) this.keyVersions.set(version, proof);
          return { success: true };
        }
        if (sql.startsWith('INSERT OR IGNORE')) {
          this.writes++;
          if (!this.subjects.has(args[0] as string) && ![...this.subjects.values()].some((row) => row.player_id === args[1] && row.key_version === args[2])) {
            this.subjects.set(args[0] as string, { player_id: args[1] as string, key_version: args[2] as string });
          }
        }
        return { success: true };
      },
    });
    return statement([]);
  }
}
function env(db?: LocalDatabase): CommerceEnv {
  return { APP_ORIGIN: origin, COMMERCE_DB: db as CommerceDatabase | undefined, COMMERCE_IDENTITY_ENABLED: 'false' };
}
function request(path: string, init?: RequestInit): Request { return new Request(origin + path, init); }
function encode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

async function googleFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let keyFetches = 0;
  const fetchKeys = (async (url: string) => {
    keyFetches++;
    if (url !== 'https://www.googleapis.com/oauth2/v3/certs') throw new Error('unexpected URL');
    return Response.json({ keys: [jwk] });
  }) as typeof fetch;
  const issue = async (overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => {
    const first = encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT', ...header });
    const second = encode({ iss: 'https://accounts.google.com', aud: clientId, sub: '12345678901234567890', iat: now - 10, exp: now + 1800, ...overrides });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${first}.${second}`));
    return `${first}.${second}.${Buffer.from(signature).toString('base64url')}`;
  };
  return { fetchKeys, issue, get keyFetches() { return keyFetches; } };
}

test('disabled server catalog exactly mirrors 12 mock cash SKUs and the pass', async () => {
  const expected: Map<string, number> = new Map(SKUS.filter((sku) => sku.kind === 'cash').map((sku) => [sku.id, sku.price]));
  expected.set('pass', BATTLE_PASS.price);
  expect(expected.size).toBe(13);
  const actual: Map<string, number> = new Map(PREVIEW_CATALOG.map((item) => [item.sku, item.amountKRW]));
  expect(actual).toEqual(expected);
  const db = new LocalDatabase();
  const response = await handleCommerceRequest(request('/api/commerce/catalog'), env(db));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { version: string; saleEnabled: boolean; items: { saleEnabled: boolean }[] };
  expect(body.version).toBe(COMMERCE_CATALOG_VERSION);
  expect(body.saleEnabled).toBe(false);
  expect(body.items).toHaveLength(13);
  expect(body.items.every((item) => item.saleEnabled === false)).toBe(true);
});

test('partial, repriced or enabled catalog and missing D1 fail closed', async () => {
  expect((await handleCommerceRequest(request('/api/commerce/catalog'), env())).status).toBe(503);
  const db = new LocalDatabase();
  db.rows.pop();
  expect((await handleCommerceRequest(request('/api/commerce/catalog'), env(db))).status).toBe(503);
  db.rows = new LocalDatabase().rows;
  db.rows[0] = { ...db.rows[0], amount_krw: 1 };
  expect((await handleCommerceRequest(request('/api/commerce/catalog'), env(db))).status).toBe(503);
  db.rows = new LocalDatabase().rows;
  db.rows[0] = { ...db.rows[0], sale_enabled: 1 };
  expect((await handleCommerceRequest(request('/api/commerce/catalog'), env(db))).status).toBe(503);
});

test('orders never open, including with identity and a seeded database', async () => {
  const db = new LocalDatabase(), settings = env(db);
  settings.COMMERCE_IDENTITY_ENABLED = 'true';
  const response = await handleCommerceRequest(request('/api/commerce/orders', { method: 'POST', body: JSON.stringify({ sku: 'starter', amount: 1 }) }), settings);
  expect(response.status).toBe(503);
  expect(db.writes).toBe(0);
  expect((await response.json() as { error: string }).error).toBe('billing-unavailable');
  // The production router must reach the fail-closed commerce handler.
  expect((await handleRequest(request('/api/commerce/orders', { method: 'POST' }), settings as any)).status).toBe(503);
});

test('identity remains disabled until binding, client ID and HMAC key are configured', async () => {
  const db = new LocalDatabase(), settings = env(db);
  expect((await handleCommerceRequest(request('/api/commerce/me'), settings)).status).toBe(503);
  settings.COMMERCE_IDENTITY_ENABLED = 'true';
  expect((await handleCommerceRequest(request('/api/commerce/me'), settings)).status).toBe(503);
  expect(db.writes).toBe(0);
});

test('verified Google tokens bind one pseudonymous player across issuer spellings', async () => {
  const db = new LocalDatabase(), settings = env(db), fixture = await googleFixture();
  Object.assign(settings, { COMMERCE_IDENTITY_ENABLED: 'true', COMMERCE_GOOGLE_CLIENT_ID: clientId, COMMERCE_SUBJECT_HMAC_KEY: hmacKey, COMMERCE_SUBJECT_KEY_VERSION: 'v1' });
  const firstToken = await fixture.issue({ iss: 'accounts.google.com' });
  const secondToken = await fixture.issue({ iss: 'https://accounts.google.com' });
  const first = await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${firstToken}` } }), settings, fixture.fetchKeys);
  const second = await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${secondToken}` } }), settings, fixture.fetchKeys);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const firstBody = await first.json() as { playerId: string; saleEnabled: boolean };
  const secondBody = await second.json() as { playerId: string; saleEnabled: boolean };
  expect(firstBody).toEqual(secondBody);
  expect(firstBody.saleEnabled).toBe(false);
  expect(db.subjects.size).toBe(1);
  expect([...db.subjects.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
  expect([...db.subjects.keys()][0]).not.toContain('12345678901234567890');
});

test('key rotation preserves player ID and refuses premature previous-key retirement', async () => {
  const db = new LocalDatabase(), fixture = await googleFixture();
  const token = await fixture.issue(), nextKey = Buffer.alloc(32, 8).toString('base64url');
  const firstEnv = { ...env(db), COMMERCE_IDENTITY_ENABLED: 'true', COMMERCE_GOOGLE_CLIENT_ID: clientId,
    COMMERCE_SUBJECT_HMAC_KEY: hmacKey, COMMERCE_SUBJECT_KEY_VERSION: 'v1' };
  const get = (settings: CommerceEnv) => handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${token}` } }), settings, fixture.fetchKeys);
  const first = await get(firstEnv);
  expect(first.status).toBe(200);
  const playerId = (await first.json() as { playerId: string }).playerId;
  const nextEnv = { ...firstEnv, COMMERCE_SUBJECT_HMAC_KEY: nextKey, COMMERCE_SUBJECT_KEY_VERSION: 'v2' };
  expect((await get({ ...firstEnv, COMMERCE_SUBJECT_HMAC_KEY: nextKey })).status).toBe(503); // Changed key with reused version.
  expect((await get(nextEnv)).status).toBe(503); // v1-only account still exists.
  expect(db.subjects.size).toBe(1);
  const rotationEnv = { ...nextEnv, COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY: hmacKey, COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION: 'v1' };
  expect((await get({ ...rotationEnv, COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY: nextKey })).status).toBe(503);
  const migrated = await get(rotationEnv);
  expect(migrated.status).toBe(200);
  expect((await migrated.json() as { playerId: string }).playerId).toBe(playerId);
  expect(db.subjects.size).toBe(2);
  const retired = await get(nextEnv);
  expect(retired.status).toBe(200);
  expect((await retired.json() as { playerId: string }).playerId).toBe(playerId);
  expect((await get({ ...rotationEnv, COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION: 'v2' })).status).toBe(503);
  const thirdKey = Buffer.alloc(32, 9).toString('base64url');
  const thirdEnv = { ...nextEnv, COMMERCE_SUBJECT_HMAC_KEY: thirdKey, COMMERCE_SUBJECT_KEY_VERSION: 'v3' };
  expect((await get(thirdEnv)).status).toBe(503);
  const thirdRotation = { ...thirdEnv, COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY: nextKey, COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION: 'v2' };
  db.subjects.set('unmigrated-v1', { player_id: '22222222-2222-4222-8222-222222222222', key_version: 'v1' });
  expect((await get(thirdRotation)).status).toBe(503); // Older unmapped account cannot be silently skipped.
  db.subjects.delete('unmigrated-v1');
  const third = await get(thirdRotation);
  expect(third.status).toBe(200);
  expect((await third.json() as { playerId: string }).playerId).toBe(playerId);
  expect((await get(thirdEnv)).status).toBe(200);
  expect(db.keyVersions.size).toBe(3);
});

test('signature, audience, issuer, expiry, key and origin failures cannot create players', async () => {
  const db = new LocalDatabase(), settings = env(db), fixture = await googleFixture();
  Object.assign(settings, { COMMERCE_IDENTITY_ENABLED: 'true', COMMERCE_GOOGLE_CLIENT_ID: clientId, COMMERCE_SUBJECT_HMAC_KEY: hmacKey, COMMERCE_SUBJECT_KEY_VERSION: 'v1' });
  const good = await fixture.issue();
  const [header, payload, signature] = good.split('.');
  const altered = `${header}.${encode({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'other' })}.${signature}`;
  for (const token of [altered, await fixture.issue({ aud: 'other.apps.googleusercontent.com' }), await fixture.issue({ iss: 'https://evil.example' }), await fixture.issue({ exp: now - 1 }), await fixture.issue({}, { alg: 'none' }), await fixture.issue({}, { kid: 'unknown' })]) {
    expect((await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${token}` } }), settings, fixture.fetchKeys)).status).toBe(401);
  }
  expect((await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${good}`, 'sec-fetch-site': 'cross-site' } }), settings, fixture.fetchKeys)).status).toBe(403);
  expect((await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${good}` } }), { ...settings, APP_ORIGIN: 'https://other.example' }, fixture.fetchKeys)).status).toBe(403);
  expect((await handleCommerceRequest(request('/api/commerce/me', { headers: { Authorization: `Bearer ${good}` } }), settings, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).status).toBe(401);
  expect(fixture.keyFetches).toBe(1); // Unknown kids and forged signatures reuse cached public keys.
  expect(db.writes).toBe(0);
});
