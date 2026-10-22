-- Blade Surge BM D10/D11: Google Play 인앱 결제 원장·권한·RTDN·결제 퍼널 집계 (docs/BM_DESIGN.md 5~7장).
-- 재적용해도 무해하도록 IF NOT EXISTS 만 쓴다. 운영 적용은 코디네이터가 `wrangler d1 migrations apply`로 한다.
-- 구매 토큰 원문은 저장하지 않는다(token_hash = sha256). Play 재조회가 필요한 경로는 클라이언트·RTDN이 토큰을 다시 보낸다.

-- Play obfuscatedAccountId ↔ 계정. RTDN·환불 이벤트를 계정으로 되찾는 유일한 길이다.
CREATE TABLE IF NOT EXISTS iap_obf (
  obf_id TEXT PRIMARY KEY CHECK (length(obf_id) BETWEEN 16 AND 64),
  account_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- 구매(토큰) 1건 = 1행. 상태는 Play 서버 조회 결과만 반영한다.
CREATE TABLE IF NOT EXISTS iap_purchases (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('consumable','non_consumable','subscription')),
  state TEXT NOT NULL CHECK (state IN ('pending','granted','refunded','expired','declined')),
  order_hash TEXT,
  linked_token_hash TEXT,
  expires_at INTEGER,
  test INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0, 1)),
  acked INTEGER NOT NULL DEFAULT 0 CHECK (acked IN (0, 1)),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS iap_purchases_acct ON iap_purchases(account_id, created_at);
CREATE INDEX IF NOT EXISTS iap_purchases_open ON iap_purchases(state, acked, consumed);

-- 지급 1줄 = 지급 단위(일회 상품의 구매, 구독의 결제 주기 주문). grant_id = wallet_ledger.op_id와 같다.
CREATE TABLE IF NOT EXISTS iap_grants (
  grant_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  product_id TEXT NOT NULL,
  rewards TEXT NOT NULL,
  price_krw INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  reversed_at INTEGER,
  -- 구독 지급의 결제 주기 주문(sha256). 환불은 이 주문의 지급만 되돌린다.
  order_hash TEXT,
  -- 계정당 1회 상품의 결박 키('<account>:<product>'). 동시 결제 2건도 하나만 지급된다. 역분개하면 NULL로 풀어 재구매를 허용한다.
  once_key TEXT UNIQUE,
  -- 이 지급에서 상환한 기존 부채(JSON). 이 지급이 환불되면 부채로 되돌린다.
  repaid TEXT,
  -- 역분개 때 0 아래로 내리지 못한 부족분(JSON, 기록용). 미상환 잔액 정본은 iap_debt.
  debt TEXT
);
CREATE INDEX IF NOT EXISTS iap_grants_acct ON iap_grants(account_id, granted_at);
CREATE INDEX IF NOT EXISTS iap_grants_token ON iap_grants(token_hash);

-- 기간·영구 권한. 같은 토큰의 같은 권한은 한 행(갱신 시 expires_at만 늘어난다). 환불·취소는 revoked_at.
CREATE TABLE IF NOT EXISTS iap_entitlements (
  account_id TEXT NOT NULL,
  ent_key TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  PRIMARY KEY (account_id, ent_key, token_hash)
);

-- 환불로 생긴 미상환 부채(재화별 잔액). 이후 서버 지급(결제·서버 정산)에서 먼저 상환한다.
CREATE TABLE IF NOT EXISTS iap_debt (
  account_id TEXT NOT NULL,
  reward_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, reward_key)
);

-- 운영 커서(환불 대사 마지막 성공 시각 등).
CREATE TABLE IF NOT EXISTS iap_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- 지급 배치 가드: 같은 배치에서 토큰이 이미 환불 상태면 이 표에 x=0을 넣으려다 CHECK 위반으로 배치 전체가 롤백된다
-- (환불과 지급이 경합해도 환불된 구매에 보상이 붙지 않게 하는 원자 검사). 행은 절대 남지 않는다.
CREATE TABLE IF NOT EXISTS iap_refund_guard (
  x INTEGER NOT NULL CONSTRAINT iap_refund_guard CHECK (x = 1)
);

-- RTDN(Pub/Sub push) 멱등: messageId 해시. 본문은 신뢰하지 않고 Play 재조회의 계기로만 쓴다.
CREATE TABLE IF NOT EXISTS iap_rtdn (
  message_hash TEXT PRIMARY KEY CHECK (length(message_hash) = 64),
  kind TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS iap_rtdn_received ON iap_rtdn(received_at);

-- D11 퍼널: 계정별 단계 최초 도달 시각(개인정보 최소: 계정 id·단계·시각만). 결제 단계는 서버 검증 성공 때만 서버가 쓴다.
CREATE TABLE IF NOT EXISTS funnel_milestones (
  account_id TEXT NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('install','tutorial_complete','shop_view','paysheet_open','purchase_start','first_purchase')),
  first_at INTEGER NOT NULL,
  cohort_day INTEGER NOT NULL,
  PRIMARY KEY (account_id, step)
);
CREATE INDEX IF NOT EXISTS funnel_milestones_cohort ON funnel_milestones(cohort_day, step);

-- 일별 활성(DAU/MAU, 결제율 분모). 계정·날짜 한 행.
CREATE TABLE IF NOT EXISTS funnel_active (
  day INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (day, account_id)
);

UPDATE v1_schema SET version = 3 WHERE singleton = 1 AND version < 3;
