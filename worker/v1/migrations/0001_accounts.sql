-- Blade Surge MMO P1 계정·진행 스키마 (docs/MMO_DESIGN.md 3.3).
-- 모든 계정 테이블의 선두 키는 account_id 다(나중에 crc32(account_id) % N 분할 가능).
-- 재적용해도 무해하도록 IF NOT EXISTS 만 쓴다. 운영 적용은 코디네이터가 `wrangler d1 migrations apply`로 한다.

CREATE TABLE IF NOT EXISTS v1_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

-- ── 신원 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  account_id   TEXT PRIMARY KEY CHECK (account_id GLOB 'p_[0-9a-f]*' AND length(account_id) = 26),
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','muted','banned','deleting','deleted')),
  token_ver    INTEGER NOT NULL DEFAULT 1,
  age_band     TEXT CHECK (age_band IN ('u14','14_17','18p')),
  authority    TEXT NOT NULL DEFAULT 'shadow' CHECK (authority IN ('shadow','server')),
  channel_first TEXT NOT NULL CHECK (channel_first IN ('web','googleplay','onestore','apps-in-toss')),
  -- 조회용 투영 (정본은 account_docs.core)
  level INTEGER NOT NULL DEFAULT 1,
  power INTEGER NOT NULL DEFAULT 0,
  stage_idx INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0,
  gems_free INTEGER NOT NULL DEFAULT 0,
  gems_paid INTEGER NOT NULL DEFAULT 0,
  guild_id TEXT,
  shard INTEGER NOT NULL DEFAULT 0 CHECK (shard BETWEEN 0 AND 99)
);
CREATE INDEX IF NOT EXISTS accounts_guild ON accounts(guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_seen ON accounts(last_seen);

CREATE TABLE IF NOT EXISTS account_keys (
  key_hash TEXT PRIMARY KEY CHECK (length(key_hash) = 64),
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_keys_acct ON account_keys(account_id, last_seen);

CREATE TABLE IF NOT EXISTS account_links (
  provider TEXT NOT NULL CHECK (provider IN ('google','play_games','toss')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject_hash),
  UNIQUE (provider, account_id)
);

-- 전환/삭제 시 90일 보관
CREATE TABLE IF NOT EXISTS account_archive (
  archive_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  doc TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  purge_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_archive_acct ON account_archive(account_id, archived_at);

-- ── 진행 문서와 원장 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS account_docs (
  account_id TEXT NOT NULL,
  doc_name TEXT NOT NULL DEFAULT 'core',
  rev INTEGER NOT NULL,
  doc TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, doc_name),
  CHECK (bytes <= 262144)
);

-- op_id: cid:<uuid> / run:<id> / start:<id> / import:<id> / iap:<hash>. 중복 = 제약 위반 = 배치 롤백(멱등).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  op_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  delta TEXT NOT NULL,
  receipt TEXT,
  rev_after INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_ledger_acct ON wallet_ledger(account_id, at);

CREATE TABLE IF NOT EXISTS legacy_saves (
  legacy_id TEXT PRIMARY KEY CHECK (length(legacy_id) = 64),
  account_id TEXT UNIQUE NOT NULL,
  uploaded_at INTEGER NOT NULL,
  doc TEXT NOT NULL,
  report TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shadow','imported','rejected','restored'))
);

-- 'raid:w03:<acct>' 처럼 결정적 id → 지연 생성 멱등
CREATE TABLE IF NOT EXISTS mail (
  mail_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rewards TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS mail_acct ON mail(account_id, claimed_at, created_at);

-- ── 런(전투) 티켓 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_tickets (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('campaign','expedition','deep','rift','tower','raid','arena','party')),
  content_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  hero_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  loot_seed INTEGER NOT NULL,
  hero_hash TEXT NOT NULL,
  energy_spent INTEGER NOT NULL,
  party_run_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','settled','expired','refunded','rejected')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  verdict TEXT,
  result TEXT
);
CREATE INDEX IF NOT EXISTS run_tickets_acct ON run_tickets(account_id, state, started_at);

-- ── 제재 / 감사 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sanctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mute','ban','rank_ban','payout_hold')),
  until INTEGER,
  reason TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sanctions_acct ON sanctions(account_id, at);

CREATE TABLE IF NOT EXISTS audit_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  severity INTEGER NOT NULL,
  detail TEXT NOT NULL,
  at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS audit_flags_acct ON audit_flags(account_id, at);

-- 그림자 모드(M1) 패리티 기록: 클라이언트 규칙과 서버 규칙의 상태 해시 비교 결과.
CREATE TABLE IF NOT EXISTS parity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  op TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  server_hash TEXT NOT NULL,
  match INTEGER NOT NULL CHECK (match IN (0, 1)),
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS parity_log_acct ON parity_log(account_id, at);

INSERT OR IGNORE INTO v1_schema(singleton, version, applied_at) VALUES (1, 1, 0);
