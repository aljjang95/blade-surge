-- Blade Surge MMO P1 남용 제한 카운터. 키(해시된 IP 또는 계정) × 고정 창 하나당 한 행이며, 한 문장 UPSERT로 원자적으로 센다.
-- 재적용해도 무해하도록 IF NOT EXISTS 만 쓴다. 운영 적용은 코디네이터가 `wrangler d1 migrations apply`로 한다.

CREATE TABLE IF NOT EXISTS v1_rate (
  key TEXT PRIMARY KEY,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v1_rate_until ON v1_rate(until);

UPDATE v1_schema SET version = 2 WHERE singleton = 1 AND version < 2;
