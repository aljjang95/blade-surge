import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';

function database(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../migrations/0001_commerce_preview.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_commerce_order_intents_preview.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_commerce_merchant_snapshot_preview.sql', import.meta.url), 'utf8'));
  return db;
}

function insert(db: Database, overrides: Record<string, string | number | null> = {}, mode: 'INSERT' | 'INSERT OR REPLACE' = 'INSERT'): void {
  const row = {
    order_id: 'order-one', player_id: 'player-one', sales_channel: 'WEB', idempotency_key: 'retry-one',
    catalog_version: '2026-09-23.preview-v1', sku: 'starter', amount_krw: 1200, currency: 'KRW',
    payment_id: 'payment-one', store_id: 'blade-test-store', merchant_id: 'blade-test-merchant', channel_key: 'blade-test-channel',
    state: 'PREPARED', created_at: '2026-09-23T00:00:00Z', ...overrides,
  };
  db.prepare(`${mode} INTO commerce_order_intents
    (order_id, player_id, sales_channel, idempotency_key, catalog_version, sku,
     amount_krw, currency, payment_id, store_id, merchant_id, channel_key, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.order_id, row.player_id, row.sales_channel, row.idempotency_key, row.catalog_version, row.sku,
      row.amount_krw, row.currency, row.payment_id, row.store_id, row.merchant_id, row.channel_key, row.state, row.created_at,
    );
}

test('order intent freezes the preview catalog amount and cannot represent paid or granted state', () => {
  const db = database();
  try {
    insert(db);
    expect(db.query('SELECT COUNT(*) AS count FROM commerce_order_intents').get()).toEqual({ count: 1 });
    expect(() => insert(db, { order_id: 'order-two', payment_id: 'payment-two', idempotency_key: 'retry-two', amount_krw: 1 })).toThrow();
    expect(() => insert(db, { order_id: 'order-two', payment_id: 'payment-two', idempotency_key: 'retry-two', sku: 'unknown' })).toThrow();
    expect(() => insert(db, { order_id: 'order-two', payment_id: 'payment-two', idempotency_key: 'retry-two', state: 'PAID' })).toThrow();
    expect(() => db.exec("UPDATE commerce_order_intents SET amount_krw = 1 WHERE order_id = 'order-one'")).toThrow();
  } finally { db.close(); }
});

test('order intent rejects retries that conflict for one player and payment ID reuse across players', () => {
  const db = database();
  try {
    insert(db);
    expect(() => insert(db, { order_id: 'order-two', payment_id: 'payment-two' })).toThrow();
    expect(() => insert(db, { order_id: 'order-two', player_id: 'player-two', idempotency_key: 'retry-two' })).toThrow();
    insert(db, { order_id: 'order-two', player_id: 'player-two', payment_id: 'payment-two' });
    expect(db.query('SELECT COUNT(*) AS count FROM commerce_order_intents').get()).toEqual({ count: 2 });
  } finally { db.close(); }
});

test('replacement and deletion cannot erase the original retry or payment identity', () => {
  const db = database();
  try {
    insert(db);
    expect(() => insert(db, { sku: 'monthly', amount_krw: 5900 }, 'INSERT OR REPLACE')).toThrow();
    expect(() => insert(db, { order_id: 'order-two', player_id: 'player-two', idempotency_key: 'retry-two', sku: 'monthly', amount_krw: 5900 }, 'INSERT OR REPLACE')).toThrow();
    expect(() => db.exec("DELETE FROM commerce_order_intents WHERE order_id = 'order-one'")).toThrow();
    expect(db.query('SELECT order_id, player_id, sku, amount_krw, payment_id FROM commerce_order_intents').get()).toEqual({
      order_id: 'order-one', player_id: 'player-one', sku: 'starter', amount_krw: 1200, payment_id: 'payment-one',
    });
  } finally { db.close(); }
});

test('missing order ID cannot create an unaddressable intent', () => {
  const db = database();
  try {
    expect(() => insert(db, { order_id: null })).toThrow();
    expect(db.query('SELECT COUNT(*) AS count FROM commerce_order_intents').get()).toEqual({ count: 0 });
  } finally { db.close(); }
});

test('order intent requires an immutable PortOne merchant ID snapshot', () => {
  const db = database();
  try {
    const columns = db.query('PRAGMA table_info(commerce_order_intents)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('merchant_id');
    expect(() => insert(db, { merchant_id: '' })).toThrow();
    expect(() => insert(db, { merchant_id: null })).toThrow();
    insert(db);
    expect(db.query("SELECT merchant_id FROM commerce_order_intents WHERE order_id = 'order-one'").get()).toEqual({ merchant_id: 'blade-test-merchant' });
    expect(() => db.exec("UPDATE commerce_order_intents SET merchant_id = 'another-merchant' WHERE order_id = 'order-one'")).toThrow();
  } finally { db.close(); }
});

test('migration preserves old unbound orders and rejects new orders without a merchant snapshot', () => {
  const db = new Database(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../migrations/0001_commerce_preview.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../migrations/0002_commerce_order_intents_preview.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO commerce_order_intents
      (order_id, player_id, sales_channel, idempotency_key, catalog_version, sku,
       amount_krw, currency, payment_id, store_id, channel_key, state, created_at)
      VALUES ('legacy-order', 'legacy-player', 'WEB', 'legacy-retry', '2026-09-23.preview-v1',
        'starter', 1200, 'KRW', 'legacy-payment', 'legacy-store', 'legacy-channel',
        'PREPARED', '2026-09-23T00:00:00Z')`);
    db.exec(readFileSync(new URL('../migrations/0003_commerce_merchant_snapshot_preview.sql', import.meta.url), 'utf8'));
    expect(db.query("SELECT merchant_id FROM commerce_order_intents WHERE order_id = 'legacy-order'").get()).toEqual({ merchant_id: null });
    expect(() => db.exec(`INSERT INTO commerce_order_intents
      (order_id, player_id, sales_channel, idempotency_key, catalog_version, sku,
       amount_krw, currency, payment_id, store_id, channel_key, state, created_at)
      VALUES ('missing-merchant', 'new-player', 'WEB', 'new-retry', '2026-09-23.preview-v1',
        'starter', 1200, 'KRW', 'new-payment', 'new-store', 'new-channel', 'PREPARED',
        '2026-09-24T00:00:00Z')`)).toThrow('merchant snapshot required');
    insert(db, { order_id: 'new-order', player_id: 'new-player', payment_id: 'new-payment', idempotency_key: 'new-retry' });
    expect(db.query("SELECT merchant_id FROM commerce_order_intents WHERE order_id = 'new-order'").get()).toEqual({ merchant_id: 'blade-test-merchant' });
    expect(() => db.exec("UPDATE commerce_order_intents SET merchant_id = 'guessed' WHERE order_id = 'legacy-order'")).toThrow();
  } finally { db.close(); }
});
