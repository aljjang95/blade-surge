-- Preview catalog and pseudonymous player binding. No payment, wallet or grant tables.
CREATE TABLE IF NOT EXISTS commerce_key_versions (
  key_version TEXT PRIMARY KEY,
  key_proof TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS commerce_subjects (
  subject_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (player_id, key_version)
);
CREATE INDEX IF NOT EXISTS commerce_subjects_key_version_player ON commerce_subjects (key_version, player_id);

CREATE TABLE IF NOT EXISTS commerce_catalog (
  catalog_version TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount_krw INTEGER NOT NULL CHECK (amount_krw > 0),
  currency TEXT NOT NULL CHECK (currency = 'KRW'),
  sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sale_enabled = 0),
  PRIMARY KEY (catalog_version, sku)
);

INSERT OR IGNORE INTO commerce_catalog (catalog_version, sku, amount_krw, currency, sale_enabled) VALUES
  ('2026-09-23.preview-v1', 'starter', 1200, 'KRW', 0),
  ('2026-09-23.preview-v1', 'monthly', 5900, 'KRW', 0),
  ('2026-09-23.preview-v1', 'growth', 12000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'boss_pack', 33000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'vip_pass', 19000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem1', 3900, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem2', 12000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem3', 25000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem4', 39000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem5', 79000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'gem6', 129000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'enh_pack', 22000, 'KRW', 0),
  ('2026-09-23.preview-v1', 'pass', 9900, 'KRW', 0);
