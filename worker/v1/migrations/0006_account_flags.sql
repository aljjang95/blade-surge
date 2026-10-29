-- 계정 표시(docs/ACCOUNT_POLICY.md): 운영 테스트 계정(test, 통계 제외), 미접속 게스트 보관(idle-archived).
-- 재적용해도 무해하도록 IF NOT EXISTS만 쓴다.
CREATE TABLE IF NOT EXISTS account_flags (
  account_id TEXT NOT NULL,
  flag TEXT NOT NULL CHECK (flag IN ('test','idle-archived')),
  at INTEGER NOT NULL,
  note TEXT,
  PRIMARY KEY (account_id, flag)
);
CREATE INDEX IF NOT EXISTS account_flags_flag ON account_flags(flag, at);

UPDATE v1_schema SET version = 6 WHERE singleton = 1 AND version < 6;
