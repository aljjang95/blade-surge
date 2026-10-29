-- 계정 로그인 확장: 카카오·ChatGPT(OpenAI) OIDC 제공자 + 리다이렉트 로그인 상태(docs/ACCOUNT_POLICY.md).
-- account_links.provider CHECK를 넓히려면 SQLite는 표를 다시 만들어야 한다. 아래 순서는 재적용해도 무해하다
-- (두 번째 적용 때는 이미 넓어진 표를 같은 모양으로 한 번 더 옮길 뿐이다).
CREATE TABLE IF NOT EXISTS account_links_v5 (
  provider TEXT NOT NULL CHECK (provider IN ('google','play_games','toss','kakao','chatgpt')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject_hash),
  UNIQUE (provider, account_id)
);
INSERT OR IGNORE INTO account_links_v5(provider, subject_hash, account_id, created_at) SELECT provider, subject_hash, account_id, created_at FROM account_links;
DROP TABLE account_links;
ALTER TABLE account_links_v5 RENAME TO account_links;

-- 리다이렉트(인가 코드) 로그인의 1회용 상태. state는 해시만 저장하고, 쓰면 바로 지운다(10분 만료).
-- mode=link는 시작한 세션의 account_id, mode=recover는 이 기기의 key_hash를 묶는다.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY CHECK (length(state_hash) = 64),
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('link','recover')),
  account_id TEXT,
  key_hash TEXT,
  channel TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_states_exp ON oauth_states(expires_at);

UPDATE v1_schema SET version = 5 WHERE singleton = 1 AND version < 5;
