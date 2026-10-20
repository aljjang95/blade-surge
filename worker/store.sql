-- 코디네이터가 정본 D1에 적용한다. 이 파일 작성 자체는 DB 변경이 아니다.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_binding (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  database_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);
INSERT OR IGNORE INTO store_binding VALUES (1, '88d8e114-6c6d-408a-acca-52ede4e94d28', 1);

CREATE TABLE IF NOT EXISTS store_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  channel TEXT NOT NULL CHECK (channel IN ('apps-in-toss', 'googleplay', 'onestore')),
  subject TEXT NOT NULL CHECK (length(subject) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS store_sessions_expiry ON store_sessions(expires_at);

-- 일회용 Toss 코드도 원문 대신 해시만 보관한다. 실패한 교환도 같은 코드로 재시도하지 않는다.
CREATE TABLE IF NOT EXISTS store_auth_codes (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS store_auth_codes_retention ON store_auth_codes(used_at, code_hash);

-- 시간당 제공자 조회/인증 예산. 사용자/IP/토큰 원문을 저장하지 않는다.
CREATE TABLE IF NOT EXISTS store_budgets (
  budget_hash TEXT NOT NULL CHECK (length(budget_hash) = 64),
  window_start INTEGER NOT NULL,
  calls INTEGER NOT NULL CHECK (calls BETWEEN 1 AND 60),
  PRIMARY KEY(budget_hash, window_start)
);
CREATE INDEX IF NOT EXISTS store_budgets_retention ON store_budgets(window_start, budget_hash);

CREATE TABLE IF NOT EXISTS store_intents (
  intent_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL CHECK (length(subject) = 64),
  channel TEXT NOT NULL CHECK (channel IN ('apps-in-toss', 'googleplay', 'onestore')),
  product_id TEXT NOT NULL CHECK (product_id = 'remove_ads_v1'),
  sku TEXT NOT NULL,
  idempotency_hash TEXT NOT NULL CHECK (length(idempotency_hash) = 64),
  purchase_hash TEXT CHECK (purchase_hash IS NULL OR length(purchase_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  UNIQUE(subject, channel, idempotency_hash)
);
CREATE INDEX IF NOT EXISTS store_intents_retention ON store_intents(expires_at, intent_id);
CREATE INDEX IF NOT EXISTS store_intents_admission_window ON store_intents(subject, channel, created_at);
CREATE INDEX IF NOT EXISTS store_intents_unclaimed ON store_intents(subject, channel, expires_at) WHERE purchase_hash IS NULL;

CREATE TABLE IF NOT EXISTS store_ledger (
  channel TEXT NOT NULL CHECK (channel IN ('apps-in-toss', 'googleplay', 'onestore')),
  purchase_hash TEXT NOT NULL CHECK (length(purchase_hash) = 64),
  subject TEXT NOT NULL CHECK (length(subject) = 64),
  product_id TEXT NOT NULL CHECK (product_id = 'remove_ads_v1'),
  sku TEXT NOT NULL,
  -- Toss 주문 ID는 서버 재조회용이다. Google purchaseToken/IDToken은 저장하지 않는다.
  toss_order_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('paid', 'unpaid', 'refunded')),
  grant_count INTEGER NOT NULL CHECK (grant_count IN (0, 1)),
  granted_at INTEGER,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(channel, purchase_hash),
  CHECK ((channel = 'apps-in-toss' AND toss_order_id IS NOT NULL) OR (channel != 'apps-in-toss' AND toss_order_id IS NULL)),
  CHECK ((grant_count = 0 AND granted_at IS NULL) OR (grant_count = 1 AND granted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS store_ledger_subject ON store_ledger(subject, channel);

-- 잘못된 후속 SQL도 다른 사용자에게 구매를 이전하거나 환불 tombstone을 지울 수 없다.
CREATE TRIGGER IF NOT EXISTS store_ledger_immutable
BEFORE UPDATE ON store_ledger
WHEN NEW.channel != OLD.channel OR NEW.purchase_hash != OLD.purchase_hash
  OR NEW.subject != OLD.subject OR NEW.product_id != OLD.product_id OR NEW.sku != OLD.sku
  OR NEW.toss_order_id IS NOT OLD.toss_order_id
  OR (OLD.state = 'refunded' AND NEW.state != 'refunded')
  OR NEW.grant_count < OLD.grant_count OR NEW.granted_at IS NOT OLD.granted_at AND OLD.granted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'store-ledger-immutable');
END;

CREATE TRIGGER IF NOT EXISTS store_intent_receipt_immutable
BEFORE UPDATE OF purchase_hash ON store_intents
WHEN OLD.purchase_hash IS NOT NULL AND NEW.purchase_hash IS NOT OLD.purchase_hash
BEGIN
  SELECT RAISE(ABORT, 'store-intent-receipt-immutable');
END;
