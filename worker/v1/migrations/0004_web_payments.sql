-- Blade Surge 수익화 1단계 레인 B: 웹 결제(포트원 V2) 의도·결제 원장 (docs/BM_DESIGN.md '영웅 해금').
-- 지급·권한은 기존 iap_purchases / iap_grants / iap_entitlements / wallet_ledger를 그대로 쓴다(token_hash = sha256('portone:' + paymentId)).
-- 이 표는 "서버가 발급한 paymentId ↔ 계정·상품·금액" 결박과 결제 상태(취소 회수 대사 대상)만 가진다.
-- 재적용해도 무해하도록 IF NOT EXISTS 만 쓴다. 운영 적용은 코디네이터가 `wrangler d1 migrations apply`로 한다(원격 적용 전에는 웹 결제가 닫혀 있다).
CREATE TABLE IF NOT EXISTS iap_web_payments (
  payment_id TEXT PRIMARY KEY CHECK (length(payment_id) BETWEEN 16 AND 64),
  account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount_krw INTEGER NOT NULL CHECK (amount_krw > 0),
  store_id TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  test INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('intent','granted','cancelled','failed')),
  token_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  granted_at INTEGER,
  cancelled_at INTEGER,
  -- 마지막으로 포트원을 조회한 시각(취소 대사 순환용).
  checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS iap_web_payments_acct ON iap_web_payments(account_id, created_at);
CREATE INDEX IF NOT EXISTS iap_web_payments_recon ON iap_web_payments(state, checked_at);

UPDATE v1_schema SET version = 4 WHERE singleton = 1 AND version < 4;
