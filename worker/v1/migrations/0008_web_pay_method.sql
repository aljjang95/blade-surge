-- 웹 결제 수단 대조(BM_HANDOFF 2026-10-28 리뷰 P2): intent 때 서버가 허락한 결제수단(CARD·KAKAOPAY·NAVERPAY·TOSSPAY)을 저장하고,
-- 지급 전 포트원 조회의 method.type(·provider)과 대조한다. 이 표에 행이 없는 옛 의도는 허용 수단 목록으로만 대조한다.
-- 재적용해도 무해하도록 열 추가(ALTER) 대신 IF NOT EXISTS 별도 표로 둔다.
-- 웹 결제만 스키마 v8을 요구한다(WEB_SCHEMA_VERSION). 다른 v1 API의 SCHEMA_VERSION(7)은 그대로라 적용 전에는 웹 결제만 닫힌다.
CREATE TABLE IF NOT EXISTS iap_web_pay_methods (
  payment_id TEXT PRIMARY KEY CHECK (length(payment_id) BETWEEN 16 AND 64),
  pay_method TEXT NOT NULL CHECK (pay_method IN ('CARD','KAKAOPAY','NAVERPAY','TOSSPAY')),
  created_at INTEGER NOT NULL
);

UPDATE v1_schema SET version = 8 WHERE singleton = 1 AND version < 8;
