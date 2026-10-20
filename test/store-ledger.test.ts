import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { cleanupStoreMetadata, handleStoreRequest, STORE_DATABASE_ID, STORE_PRODUCT_ID, storeHash, TOSS_AD_GROUP_ID, TOSS_REMOVE_ADS_SKU,
  type StoreD1Database, type StoreD1Statement, type StoreEnv } from '../worker/store';

// 실제 SQLite SQL/UNIQUE/trigger를 실행한다. 제공자 응답만 fixture이며 실결제 증거가 아니다.
const databases: Database[] = [];
const clockMocks: { mockRestore(): void }[] = [];
afterEach(() => { for (const mock of clockMocks.splice(0)) mock.mockRestore(); for (const database of databases.splice(0)) database.close(); });
function sqliteD1() {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  sqlite.exec(readFileSync(new URL('../worker/store.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, values: (string | number | null)[] = []): StoreD1Statement => ({
    bind: (...args) => prepare(sql, args),
    first: async <T>() => sqlite.query(sql).get(...values) as T | null,
    all: async <T>() => ({ success: true, results: sqlite.query(sql).all(...values) as T[] }),
    run: async () => { const r = sqlite.query(sql).run(...values); return { success: true, meta: { changes: r.changes } }; },
  });
  const db: StoreD1Database = { prepare, batch: async <T>(statements: StoreD1Statement[]) => {
    sqlite.exec('BEGIN');
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result as any; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  return { db, sqlite };
}
function setup() {
  const { db, sqlite } = sqliteD1();
  const calls: Request[] = [];
  let status = 'PAYMENT_COMPLETED', failProvider = false, envelope = 'SUCCESS', product = TOSS_REMOVE_ADS_SKU;
  let mismatch = false;
  let beforeOrder: (() => Promise<void>) | undefined;
  const env: StoreEnv = {
    COMMERCE_DB: db, COMMERCE_DATABASE_ID: STORE_DATABASE_ID, STORE_BILLING_ENABLED: 'true',
    TOSS_MTLS_APP_NAME: 'blade-surge', TOSS_REMOVE_ADS_ACTIVE: 'true',
    TOSS_MTLS: { fetch: async request => {
      calls.push(request.clone());
      if (failProvider) throw new Error('secret-provider-token-must-not-leak');
      const body = await request.json() as any;
      if (request.url.endsWith('/users/anon-key/exchange')) return Response.json({ resultType: 'SUCCESS', success: { anonKey: `verified-${body.code.split('-')[0]}` } });
      const observedStatus = status;
      if (beforeOrder) await beforeOrder();
      return Response.json({ resultType: envelope, success: { orderId: mismatch ? 'forged-order' : body.orderId,
        sku: product, status: observedStatus, statusDeterminedAt: new Date().toISOString() } });
    } },
  };
  const send = async (path: string, body?: any, token?: string, extra: Record<string, string> = {}) => {
    const req = new Request(`https://blade.tllhouse.com/api/store/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: 'https://blade-surge.apps.tossmini.com', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const r = await handleStoreRequest(req, env); return { status: r.status, body: await r.json() as any, headers: r.headers };
  };
  const login = async (code: string) => (await send('auth', { channel: 'apps-in-toss', code })).body;
  const prepare = async (token: string, key = 'fixed-key') => (await send('orders', { channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: key }, token)).body.intentId as string;
  const verify = (token: string, intentId: string, orderId = 'provider-order-1') => send('verify', { channel: 'apps-in-toss', intentId, orderId }, token);
  const restore = (token: string, orderId = 'provider-order-1') => send('restore', { channel: 'apps-in-toss', orderId }, token);
  return { env, sqlite, calls, send, login, prepare, verify, restore,
    status: (value: string) => { status = value; }, down: (value = true) => { failProvider = value; },
    envelope: (value: string) => { envelope = value; }, product: (value: string) => { product = value; },
    mismatch: () => { mismatch = true; }, before: (value?: () => Promise<void>) => { beforeOrder = value; } };
}

describe('store fail-closed capabilities and preparation', () => {
  test('B3 concurrent unique orders admit at most 20 unclaimed intents; valid retries consume no extra allocation', async () => {
    const s = setup(), auth = await s.login('alice-1');
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => s.send('orders', {
      channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: `unique-${i}`,
    }, auth.token)));
    expect(results.filter(r => r.status === 200)).toHaveLength(20);
    expect(results.filter(r => r.status === 429)).toHaveLength(10);
    const accepted = results.findIndex(r => r.status === 200), existing = results[accepted].body.intentId;
    const retry = await s.send('orders', { channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: `unique-${accepted}` }, auth.token);
    expect(retry.status).toBe(200); expect(retry.body.intentId).toBe(existing);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_intents').get()).toEqual({ n: 20 });
    expect(s.calls).toHaveLength(1);
  });
  test('B3 hourly admission is atomic at its boundary and retrying an existing intent spends no new-order slot', async () => {
    const now = Date.UTC(2026, 9, 12, 3, 10), mock = spyOn(Date, 'now').mockReturnValue(now); clockMocks.push(mock);
    const s = setup(), auth = await s.login('alice-1');
    // 이미 결박된 최근 metadata 59개를 주입한다. 결제/지급 fixture나 제공자 증거가 아니다.
    const insert = s.sqlite.query(`INSERT INTO store_intents(intent_id, subject, channel, product_id, sku, idempotency_hash, purchase_hash, created_at, expires_at)
      VALUES (?, ?, ?, 'remove_ads_v1', ?, ?, ?, ?, ?)`);
    for (let i = 1; i <= 59; i++) insert.run(`claimed-${i}`, auth.subject, 'apps-in-toss', TOSS_REMOVE_ADS_SKU,
      i.toString(16).padStart(64, '0'), i.toString(16).padStart(64, '0'), now, now + 30 * 60_000);
    // 같은 subject의 다른 채널 기록은 이 채널의 새 주문 예산을 쓰지 않는다.
    for (let i = 1; i <= 60; i++) insert.run(`other-channel-${i}`, auth.subject, 'googleplay', STORE_PRODUCT_ID,
      i.toString(16).padStart(64, '0'), i.toString(16).padStart(64, '0'), now, now + 30 * 60_000);
    const r = await Promise.all(Array.from({ length: 8 }, (_, i) => s.send('orders', { channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: `last-${i}` }, auth.token)));
    expect(r.filter(x => x.status === 200)).toHaveLength(1); expect(r.filter(x => x.status === 429)).toHaveLength(7);
    const slot = r.findIndex(x => x.status === 200), id = r[slot].body.intentId;
    const retries = await Promise.all(Array.from({ length: 20 }, () => s.send('orders', { channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: `last-${slot}` }, auth.token)));
    expect(retries.every(x => x.status === 200 && x.body.intentId === id)).toBe(true);
    expect(s.sqlite.query("SELECT COUNT(*) AS n FROM store_intents WHERE subject = ? AND channel = 'apps-in-toss'").get(auth.subject)).toEqual({ n: 60 });
    const bob = await s.login('bob-1'); expect(await s.prepare(bob.token, 'independent-subject')).toBeString();
    mock.mockReturnValue(now + 3_600_000);
    const fresh = await s.login('alice-2'); expect(await s.prepare(fresh.token, 'new-hour')).toBeString();
    expect(s.sqlite.query("SELECT COUNT(*) AS n FROM store_intents WHERE subject = ? AND channel = 'apps-in-toss'").get(auth.subject)).toEqual({ n: 61 });
  });
  test('billing requires feature, exact D1 identity/schema, Blade mTLS and active server product', async () => {
    const s = setup();
    expect((await s.send('capabilities?channel=apps-in-toss')).body.billing).toBe(true);
    for (const change of [
      { STORE_BILLING_ENABLED: 'false' }, { COMMERCE_DB: undefined }, { COMMERCE_DATABASE_ID: 'other-db' },
      { TOSS_MTLS: undefined }, { TOSS_MTLS_APP_NAME: 'bapchingu' }, { TOSS_REMOVE_ADS_ACTIVE: 'false' },
    ]) {
      const env = { ...s.env, ...change };
      const result = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/capabilities?channel=apps-in-toss'), env);
      expect((await result.json() as any).billing).toBe(false);
      const auth = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'apps-in-toss', code: 'alice-unused' }),
      }), env);
      expect(auth.status).toBe(503);
    }
    expect(s.calls).toHaveLength(0);
    s.sqlite.exec('DROP TABLE store_binding');
    expect((await s.send('capabilities?channel=apps-in-toss')).body.billing).toBe(false);
  });
  test('only the exact enabled Toss group can advertise independently of disabled billing', async () => {
    const s = setup(); s.env.STORE_BILLING_ENABLED = 'false';
    s.env.TOSS_REMOVE_ADS_ACTIVE = 'false';
    s.env.TOSS_AD_GROUP_ID = TOSS_AD_GROUP_ID; s.env.TOSS_AD_GROUP_ENABLED = 'true';
    expect((await s.send('capabilities?channel=apps-in-toss')).body).toMatchObject({ billing: false, ads: true });
    s.env.TOSS_AD_GROUP_ID = 'wrong-group';
    expect((await s.send('capabilities?channel=apps-in-toss')).body.ads).toBe(false);
    const google = await handleStoreRequest(new Request('https://blade.tllhouse.com/api/store/capabilities?channel=googleplay'), s.env);
    expect((await google.json() as any).ads).toBe(false);
  });
  test('concurrent preparation is idempotent and scoped to verified subject; no client price/SKU authority', async () => {
    const s = setup(), alice = await s.login('alice-1'), bob = await s.login('bob-1');
    const ids = await Promise.all(Array.from({ length: 12 }, () => s.prepare(alice.token)));
    expect(new Set(ids).size).toBe(1);
    expect(await s.prepare(bob.token)).not.toBe(ids[0]);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_intents').get()).toEqual({ n: 2 });
    for (const extra of [{ amount: 1 }, { sku: 'free' }, { currency: 'KRW' }]) {
      expect((await s.send('orders', { channel: 'apps-in-toss', productId: STORE_PRODUCT_ID, idempotencyKey: 'x', ...extra }, alice.token)).status).toBe(400);
    }
    expect((await s.send('orders', { channel: 'apps-in-toss', productId: 'starter', idempotencyKey: 'x' }, alice.token)).status).toBe(400);
    const row = s.sqlite.query('SELECT sku FROM store_intents LIMIT 1').get() as any;
    expect(row.sku).toBe(TOSS_REMOVE_ADS_SKU);
  });
});

describe('30-day bounded metadata retention', () => {
  const DAY = 24 * 60 * 60_000, NOW = Date.UTC(2026, 9, 12, 3, 20, 30);
  function fixture(now = NOW) {
    clockMocks.push(spyOn(Date, 'now').mockReturnValue(now));
    const s = setup(); s.env.STORE_BILLING_ENABLED = 'false';
    let serial = 0;
    const hash = () => (++serial).toString(16).padStart(64, '0');
    const subject = 'a'.repeat(64);
    const session = (expires = NOW - 31 * DAY) => {
      const id = hash(); s.sqlite.query('INSERT INTO store_sessions VALUES (?, ?, ?, ?, ?)')
        .run(id, 'googleplay', subject, NOW - 40 * DAY, expires); return id;
    };
    const code = (used = NOW - 31 * DAY) => {
      const id = hash(); s.sqlite.query('INSERT INTO store_auth_codes VALUES (?, ?)').run(id, used); return id;
    };
    const budget = (window = Math.floor((NOW - 31 * DAY) / 3_600_000)) => {
      const id = hash(); s.sqlite.query('INSERT INTO store_budgets VALUES (?, ?, 1)').run(id, window); return id;
    };
    const intent = (expires = NOW - 31 * DAY, purchase: string | null = null) => {
      const id = `retention-intent-${++serial}`;
      s.sqlite.query(`INSERT INTO store_intents(intent_id, subject, channel, product_id, sku, idempotency_hash, purchase_hash, created_at, expires_at)
        VALUES (?, ?, 'googleplay', 'remove_ads_v1', 'remove_ads_v1', ?, ?, ?, ?)`)
        .run(id, subject, hash(), purchase, NOW - 40 * DAY, expires); return id;
    };
    const ledger = (state: 'paid' | 'unpaid' | 'refunded', grants: number) => {
      const id = hash(); s.sqlite.query(`INSERT INTO store_ledger
        (channel, purchase_hash, subject, product_id, sku, toss_order_id, state, grant_count, granted_at, checked_at)
        VALUES ('googleplay', ?, ?, 'remove_ads_v1', 'remove_ads_v1', NULL, ?, ?, ?, ?)`)
        .run(id, subject, state, grants, grants ? NOW - 39 * DAY : null, NOW - 31 * DAY); return id;
    };
    const counts = () => ['store_sessions', 'store_auth_codes', 'store_budgets', 'store_intents', 'store_ledger']
      .map(table => (s.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    return { ...s, session, code, budget, intent, ledger, hash, counts };
  }
  test('deletes metadata older than 30 days while preserving current, paid/refunded and uncertain records', async () => {
    const s = fixture();
    s.session(); const current = s.session(NOW + 60_000), recent = s.session(NOW - DAY), exactSession = s.session(NOW - 30 * DAY);
    s.code(); const recentCode = s.code(NOW - 29 * DAY), exactCode = s.code(NOW - 30 * DAY);
    s.budget(); const currentBudget = s.budget(Math.floor(NOW / 3_600_000));
    const partialWindow = s.budget(Math.floor((NOW - 30 * DAY) / 3_600_000));
    s.intent(); s.intent(NOW - 31 * DAY, s.ledger('unpaid', 0));
    const paidIntent = s.intent(NOW - 31 * DAY, s.ledger('paid', 1));
    const refundedIntent = s.intent(NOW - 31 * DAY, s.ledger('refunded', 1));
    const previouslyPaidIntent = s.intent(NOW - 31 * DAY, s.ledger('unpaid', 1));
    const refundTombstone = s.intent(NOW - 31 * DAY, s.ledger('refunded', 0));
    const unknownReceipt = s.intent(NOW - 31 * DAY, s.hash());
    const currentIntent = s.intent(NOW + 60_000), recentIntent = s.intent(NOW - DAY), exactIntent = s.intent(NOW - 30 * DAY);
    const purchaseHistory = s.sqlite.query('SELECT * FROM store_ledger ORDER BY purchase_hash').all();
    const retainedIntents = [paidIntent, refundedIntent, previouslyPaidIntent, refundTombstone, unknownReceipt, currentIntent, recentIntent, exactIntent];
    const result = await cleanupStoreMetadata(s.env);
    expect(result).toEqual({ cutoff: NOW - 30 * DAY, deleted: { sessions: 1, authCodes: 1, budgets: 1, intents: 2 } });
    expect(s.sqlite.query('SELECT token_hash FROM store_sessions ORDER BY token_hash').all()).toEqual([current, recent, exactSession].map(token_hash => ({ token_hash })));
    expect(s.sqlite.query('SELECT code_hash FROM store_auth_codes ORDER BY code_hash').all()).toEqual([recentCode, exactCode].map(code_hash => ({ code_hash })));
    expect(s.sqlite.query('SELECT budget_hash FROM store_budgets ORDER BY budget_hash').all()).toEqual([currentBudget, partialWindow].map(budget_hash => ({ budget_hash })));
    expect(s.sqlite.query('SELECT intent_id FROM store_intents').all().map((r: any) => r.intent_id).sort()).toEqual(retainedIntents.sort());
    expect(s.sqlite.query('SELECT * FROM store_ledger ORDER BY purchase_hash').all()).toEqual(purchaseHistory);
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 0, authCodes: 0, budgets: 0, intents: 0 });
    expect(s.calls).toHaveLength(0);
  });
  test('each call deletes at most 500 rows per table; later calls drain the backlog without deleting paid history', async () => {
    const s = fixture();
    s.sqlite.transaction(() => { for (let i = 0; i < 503; i++) { s.session(); s.code(); s.budget(); s.intent(); } })();
    s.intent(NOW - 31 * DAY, s.ledger('paid', 1));
    expect(s.counts()).toEqual([503, 503, 503, 504, 1]);
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 500, authCodes: 500, budgets: 500, intents: 500 });
    expect(s.counts()).toEqual([3, 3, 3, 4, 1]);
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 3, authCodes: 3, budgets: 3, intents: 3 });
    expect(s.counts()).toEqual([0, 0, 0, 1, 1]);
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 0, authCodes: 0, budgets: 0, intents: 0 });
  });
  test('a budget window ending at exactly the 30-day boundary is retained until it is older', async () => {
    const now = Math.floor(NOW / 3_600_000) * 3_600_000, s = fixture(now);
    const boundaryHour = (now - 30 * DAY) / 3_600_000;
    s.budget(boundaryHour - 2); const exact = s.budget(boundaryHour - 1), current = s.budget(boundaryHour);
    expect((await cleanupStoreMetadata(s.env)).deleted.budgets).toBe(1);
    expect(s.sqlite.query('SELECT budget_hash FROM store_budgets ORDER BY budget_hash').all()).toEqual([exact, current].map(budget_hash => ({ budget_hash })));
  });
  test('missing/wrong DB binding or schema returns a masked error with zero write attempts', async () => {
    const s = fixture(); s.session(); s.code(); s.budget(); s.intent();
    let batches = 0; const batch = s.env.COMMERCE_DB!.batch;
    s.env.COMMERCE_DB!.batch = async <T>(statements: StoreD1Statement[]) => { batches++; return batch<T>(statements); };
    const before = s.counts();
    await expect(cleanupStoreMetadata({ ...s.env, COMMERCE_DB: undefined })).rejects.toThrow('store-binding-missing');
    await expect(cleanupStoreMetadata({ ...s.env, COMMERCE_DATABASE_ID: 'other-product-db' })).rejects.toThrow('store-binding-missing');
    s.sqlite.query("UPDATE store_binding SET database_id = 'other-product-db'").run();
    await expect(cleanupStoreMetadata(s.env)).rejects.toThrow('store-schema-missing');
    s.sqlite.query('UPDATE store_binding SET database_id = ?, schema_version = 2').run(STORE_DATABASE_ID);
    await expect(cleanupStoreMetadata(s.env)).rejects.toThrow('store-schema-missing');
    s.sqlite.exec('DROP TABLE store_binding');
    await expect(cleanupStoreMetadata(s.env)).rejects.toThrow('store-schema-missing');
    expect(batches).toBe(0); expect(s.counts()).toEqual(before);
  });
  test('the SQL identity guard prevents deletion if the DB marker changes after the initial read', async () => {
    const s = fixture(); s.session(); s.code(); s.budget(); s.intent();
    const batch = s.env.COMMERCE_DB!.batch, before = s.counts();
    s.env.COMMERCE_DB!.batch = async <T>(statements: StoreD1Statement[]) => {
      s.sqlite.query("UPDATE store_binding SET database_id = 'other-product-db'").run(); return batch<T>(statements);
    };
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 0, authCodes: 0, budgets: 0, intents: 0 });
    expect(s.counts()).toEqual(before);
  });
  test('a failed table deletion rolls back all metadata deletions and never exposes raw DB errors', async () => {
    const s = fixture(); s.session(); s.code(); s.budget(); s.intent();
    const before = s.counts();
    s.sqlite.exec("CREATE TRIGGER retention_failure BEFORE DELETE ON store_budgets BEGIN SELECT RAISE(ABORT, 'private-token-identifier'); END");
    await expect(cleanupStoreMetadata(s.env)).rejects.toThrow('store-cleanup-unavailable');
    expect(s.counts()).toEqual(before);
    s.sqlite.exec('DROP TRIGGER retention_failure');
    expect((await cleanupStoreMetadata(s.env)).deleted).toEqual({ sessions: 1, authCodes: 1, budgets: 1, intents: 1 });
  });
});

describe('SQLite receipt ownership and monotonic refunds', () => {
  test('simultaneous duplicate receipts grant once; restore and GET perform fresh fixed provider lookup', async () => {
    const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token);
    const results = await Promise.all(Array.from({ length: 12 }, () => s.verify(auth.token, intent)));
    expect(results.every(r => r.status === 200 && r.body.adFree === true)).toBe(true);
    const row = s.sqlite.query('SELECT grant_count, state, subject FROM store_ledger').get() as any;
    expect(row).toMatchObject({ grant_count: 1, state: 'paid', subject: auth.subject });
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 1 });
    const count = s.calls.length;
    expect((await s.send('entitlements?channel=apps-in-toss', undefined, auth.token)).body.adFree).toBe(true);
    expect(s.calls.length).toBe(count + 1);
    const request = s.calls.at(-1)!;
    expect(request.url).toBe('https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/order/get-order-status');
    expect(request.method).toBe('POST'); expect(await request.json()).toEqual({ orderId: 'provider-order-1' });
  });
  test('cross-subject replay is 409, including two racing first claimants', async () => {
    const s = setup(), alice = await s.login('alice-1'), bob = await s.login('bob-1');
    const a = await s.prepare(alice.token), b = await s.prepare(bob.token);
    const r = await Promise.all([s.verify(alice.token, a), s.verify(bob.token, b)]);
    expect(r.map(x => x.status).sort()).toEqual([200, 409]);
    const owner = (s.sqlite.query('SELECT subject FROM store_ledger').get() as any).subject;
    const loser = owner === alice.subject ? bob : alice;
    const calls = s.calls.length;
    expect((await s.restore(loser.token)).status).toBe(409);
    expect(s.calls.length).toBe(calls);
    expect((s.sqlite.query('SELECT grant_count FROM store_ledger').get() as any).grant_count).toBe(1);
  });
  test('one intent reserves one receipt; foreign intents and extra forged fields are rejected', async () => {
    const s = setup(), alice = await s.login('alice-1'), bob = await s.login('bob-1'), intent = await s.prepare(alice.token);
    expect((await s.verify(bob.token, intent)).status).toBe(409);
    expect((await s.verify(alice.token, intent)).status).toBe(200);
    expect((await s.verify(alice.token, intent, 'order-2')).status).toBe(409);
    expect((await s.send('verify', { channel: 'apps-in-toss', intentId: intent, orderId: 'x', status: 'PURCHASED' }, alice.token)).status).toBe(400);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 1 });
  });
  test('refund revokes; an in-flight paid response and future restore cannot undo the tombstone', async () => {
    const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token);
    await s.verify(auth.token, intent);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    s.before(async () => { entered(); await wait; });
    const stale = s.restore(auth.token); await started;
    s.before(); s.status('REFUNDED');
    expect((await s.restore(auth.token)).body.adFree).toBe(false);
    release(); expect((await stale).body.adFree).toBe(false);
    s.status('PURCHASED'); expect((await s.restore(auth.token)).body.adFree).toBe(false);
    expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'refunded', grant_count: 1 });
    expect(() => s.sqlite.exec("UPDATE store_ledger SET state = 'paid'")).toThrow('store-ledger-immutable');
  });
  test('refund before first grant stays refunded and grant_count remains zero', async () => {
    const s = setup(), auth = await s.login('alice-1'); s.status('REFUNDED');
    expect((await s.restore(auth.token)).body.adFree).toBe(false);
    s.status('PAYMENT_COMPLETED'); expect((await s.restore(auth.token)).body.adFree).toBe(false);
    expect(s.sqlite.query('SELECT state, grant_count FROM store_ledger').get()).toEqual({ state: 'refunded', grant_count: 0 });
  });
  test('provider failure never returns a cached positive entitlement and masks secret errors', async () => {
    const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token); await s.verify(auth.token, intent);
    s.down();
    for (const r of [await s.restore(auth.token), await s.send('entitlements?channel=apps-in-toss', undefined, auth.token)]) {
      expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'provider-unavailable', adFree: false });
      expect(JSON.stringify(r.body)).not.toContain('secret-provider-token');
    }
    expect((s.sqlite.query('SELECT state FROM store_ledger').get() as any).state).toBe('paid');
  });
  test('Toss ad group cannot bypass paid entitlement by disabling billing or product activation', async () => {
    const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token);
    await s.verify(auth.token, intent);
    s.env.STORE_BILLING_ENABLED = 'false'; s.env.TOSS_REMOVE_ADS_ACTIVE = 'false';
    s.env.TOSS_AD_GROUP_ID = TOSS_AD_GROUP_ID; s.env.TOSS_AD_GROUP_ENABLED = 'true';
    expect((await s.send('capabilities?channel=apps-in-toss')).body).toMatchObject({ billing: false, ads: false });
    expect((await s.send('entitlements?channel=apps-in-toss', undefined, auth.token)).body.adFree).toBe(false);
    expect((s.sqlite.query('SELECT state FROM store_ledger').get() as any).state).toBe('paid');
  });
  test('FAIL envelope, forged SKU/order, unknown status, pending and failed cannot grant', async () => {
    for (const mode of ['envelope', 'sku', 'order', 'unknown', 'pending', 'failed']) {
      const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token);
      if (mode === 'envelope') s.envelope('FAIL');
      if (mode === 'sku') s.product('forged-sku');
      if (mode === 'order') s.mismatch();
      if (mode === 'unknown') s.status('UNKNOWN');
      if (mode === 'pending') s.status('ORDER_IN_PROGRESS');
      if (mode === 'failed') s.status('FAILED');
      const result = await s.verify(auth.token, intent);
      expect(result.body.adFree).toBe(false);
      expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger WHERE grant_count = 1').get()).toEqual({ n: 0 });
    }
  });
  test('restore is bounded to 20, deduplicates lookups, and records refunds even if another receipt fails', async () => {
    const s = setup(), auth = await s.login('alice-1');
    expect((await s.send('restore', { channel: 'apps-in-toss', receipts: Array.from({ length: 21 }, (_, i) => ({ orderId: `order-${i}` })) }, auth.token)).status).toBe(400);
    const count = s.calls.length;
    expect((await s.send('restore', { channel: 'apps-in-toss', receipts: [{ orderId: 'order-1' }, { orderId: 'order-1' }] }, auth.token)).body.adFree).toBe(true);
    expect(s.calls.length).toBe(count + 1);
    s.status('REFUNDED');
    const original = s.env.TOSS_MTLS!.fetch;
    s.env.TOSS_MTLS!.fetch = async r => {
      if ((await r.clone().json() as any).orderId === 'bad') throw new Error('private');
      return original(r);
    };
    const result = await s.send('restore', { channel: 'apps-in-toss', receipts: [{ orderId: 'bad' }, { orderId: 'order-1' }] }, auth.token);
    expect(result.status).toBe(503); expect(result.body.adFree).toBe(false);
    expect((s.sqlite.query('SELECT state FROM store_ledger').get() as any).state).toBe('refunded');
  });
  test('B4 lifetime financial history does not impose a 20-receipt grant capacity', async () => {
    const s = setup(), auth = await s.login('alice-1');
    const first = await s.send('restore', { channel: 'apps-in-toss', receipts: Array.from({ length: 19 }, (_, i) => ({ orderId: `limit-${i}` })) }, auth.token);
    expect(first.body.adFree).toBe(true);
    const results = await Promise.all([s.restore(auth.token, 'twentieth'), s.restore(auth.token, 'twenty-first')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 200]);
    expect(results.every(r => r.body.adFree === true)).toBe(true);
    expect(s.sqlite.query('SELECT COUNT(*) AS n FROM store_ledger').get()).toEqual({ n: 21 });
  });
  test('real deadline bounds a hanging provider; expired session/intent make zero provider calls', async () => {
    const s = setup(), auth = await s.login('alice-1'), intent = await s.prepare(auth.token);
    s.sqlite.exec('UPDATE store_sessions SET expires_at = created_at + 1');
    await new Promise(resolve => setTimeout(resolve, 2));
    const count = s.calls.length;
    expect((await s.verify(auth.token, intent)).status).toBe(401); expect(s.calls.length).toBe(count);
    const fresh = await s.login('alice-2');
    s.sqlite.exec('UPDATE store_intents SET expires_at = created_at + 1');
    await new Promise(resolve => setTimeout(resolve, 2));
    expect((await s.verify(fresh.token, intent)).status).toBe(409);
    const newIntent = await s.prepare(fresh.token, 'new-key');
    s.env.TOSS_MTLS!.fetch = async () => new Promise<Response>(() => {});
    const start = Date.now(), result = await s.verify(fresh.token, newIntent);
    expect(result.status).toBe(503); expect(result.body.adFree).toBe(false);
    expect(Date.now() - start).toBeLessThan(6500);
  }, 8000);
  test('only session/code hashes are persisted and one Toss auth code cannot be spent twice', async () => {
    const s = setup(), auth = await s.login('alice-secretcode');
    expect(auth.subject).toBe(await storeHash('apps-in-toss:verified-alice'));
    expect((await s.send('auth', { channel: 'apps-in-toss', code: 'alice-secretcode' })).status).toBe(409);
    const rows = JSON.stringify({ sessions: s.sqlite.query('SELECT * FROM store_sessions').all(), codes: s.sqlite.query('SELECT * FROM store_auth_codes').all() });
    expect(rows).not.toContain(auth.token); expect(rows).not.toContain('alice-secretcode'); expect(rows).not.toContain('verified-alice');
    expect((await s.send('auth', { channel: 'apps-in-toss', anonKey: 'client-chosen' })).status).toBe(400);
    expect((await s.send('auth', { channel: 'apps-in-toss', code: 'other', subject: auth.subject })).status).toBe(400);
  });
});
