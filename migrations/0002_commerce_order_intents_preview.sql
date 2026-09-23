-- Immutable preparation records only. No checkout, payment capture, grant or reversal state.
CREATE TABLE IF NOT EXISTS commerce_order_intents (
  order_id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL,
  sales_channel TEXT NOT NULL CHECK (sales_channel = 'WEB'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  catalog_version TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount_krw INTEGER NOT NULL CHECK (amount_krw > 0),
  currency TEXT NOT NULL CHECK (currency = 'KRW'),
  payment_id TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL CHECK (length(store_id) > 0),
  channel_key TEXT NOT NULL CHECK (length(channel_key) > 0),
  state TEXT NOT NULL DEFAULT 'PREPARED' CHECK (state = 'PREPARED'),
  created_at TEXT NOT NULL,
  UNIQUE (player_id, sales_channel, idempotency_key),
  FOREIGN KEY (catalog_version, sku) REFERENCES commerce_catalog (catalog_version, sku)
);

CREATE TRIGGER IF NOT EXISTS commerce_order_intents_catalog_match
BEFORE INSERT ON commerce_order_intents
WHEN NOT EXISTS (
  SELECT 1 FROM commerce_catalog AS catalog
  WHERE catalog.catalog_version = NEW.catalog_version
    AND catalog.sku = NEW.sku
    AND catalog.amount_krw = NEW.amount_krw
    AND catalog.currency = NEW.currency
)
BEGIN
  SELECT RAISE(ABORT, 'catalog snapshot mismatch');
END;

-- Reject conflicting rows before SQLite's REPLACE conflict action can delete them.
CREATE TRIGGER IF NOT EXISTS commerce_order_intents_no_replace
BEFORE INSERT ON commerce_order_intents
WHEN EXISTS (
  SELECT 1 FROM commerce_order_intents AS existing
  WHERE existing.order_id = NEW.order_id
    OR existing.payment_id = NEW.payment_id
    OR (existing.player_id = NEW.player_id
      AND existing.sales_channel = NEW.sales_channel
      AND existing.idempotency_key = NEW.idempotency_key)
)
BEGIN
  SELECT RAISE(ABORT, 'order intent conflicts with existing record');
END;

CREATE TRIGGER IF NOT EXISTS commerce_order_intents_immutable
BEFORE UPDATE ON commerce_order_intents
BEGIN
  SELECT RAISE(ABORT, 'order intent is immutable');
END;

CREATE TRIGGER IF NOT EXISTS commerce_order_intents_no_delete
BEFORE DELETE ON commerce_order_intents
BEGIN
  SELECT RAISE(ABORT, 'order intent cannot be deleted');
END;
