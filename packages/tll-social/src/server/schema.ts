export interface Sql {
  exec(query: string, ...bindings: any[]): { toArray(): any[]; one?(): any };
}

// 이후 추가 컬럼·인덱스는 이 목록을 갱신하고 버전만 올린다. 모든 버전이 같은 보정 함수를 사용한다.
const SCHEMA_VERSION = 5;
const EXPECTED_COLUMNS: Record<string, Record<string, string>> = {
  // 기존 프로필의 생성 IP·기록 요약은 추측하지 않는다.
  players: { created_ip_hash: 'TEXT', hero: 'TEXT' },
  clears: { summary: 'TEXT', rank_summary: 'TEXT', subject_hash: 'TEXT', last_at: 'INTEGER' },
  ws_tickets: { key_hash: 'TEXT' },
  // 반영 완료 글이 가리키는 패치노트 글 id(선택). 기존 글은 null.
  posts: { patch_note_slug: 'TEXT' },
};
const EXPECTED_INDEXES = [
  'CREATE INDEX IF NOT EXISTS player_keys_player ON player_keys(player_id, last_seen)',
  'CREATE INDEX IF NOT EXISTS account_links_player ON account_links(player_id)',
  'CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id)',
  'CREATE INDEX IF NOT EXISTS blocks_target ON blocks(target)',
  'CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id, started_at)',
  'CREATE INDEX IF NOT EXISTS clears_rank ON clears(content_id, rank)',
  'CREATE INDEX IF NOT EXISTS clears_best ON clears(content_id, best_ms)',
  'CREATE INDEX IF NOT EXISTS clears_player ON clears(player_id)',
  'CREATE INDEX IF NOT EXISTS inbox_player ON dm_inbox(to_id,id)',
  'CREATE INDEX IF NOT EXISTS chat_channel ON chat_log(channel,at)',
  'CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at,id)',
  'CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,id)',
  'CREATE INDEX IF NOT EXISTS reports_target ON reports(target,kind,created_at)',
  'CREATE INDEX IF NOT EXISTS rate_key ON rate_events(key,at)',
  'CREATE INDEX IF NOT EXISTS rate_at ON rate_events(at)',
  'CREATE INDEX IF NOT EXISTS nonces_at ON nonces(at)',
  'CREATE INDEX IF NOT EXISTS clears_subject ON clears(content_id, subject_hash, rank)',
  'CREATE INDEX IF NOT EXISTS clears_recent ON clears(content_id, last_at)',
  'CREATE INDEX IF NOT EXISTS recent_messages_at ON recent_messages(at)',
  'CREATE INDEX IF NOT EXISTS ws_tickets_player ON ws_tickets(player_id)',
  'CREATE INDEX IF NOT EXISTS ws_tickets_key ON ws_tickets(key_hash)',
];

function ensureExpectedSchema(sql: Sql): void {
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const existing = new Set(sql.exec(`PRAGMA table_info(${table})`).toArray().map(row => row.name));
    for (const [column, definition] of Object.entries(columns)) {
      if (!existing.has(column)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  sql.exec('CREATE TABLE IF NOT EXISTS account_link_history (provider TEXT NOT NULL, subject_hash TEXT NOT NULL, player_id TEXT NOT NULL, unlinked_at INTEGER NOT NULL, PRIMARY KEY(provider, subject_hash))');
  sql.exec('CREATE TABLE IF NOT EXISTS recent_messages (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, at INTEGER NOT NULL)');
  for (const statement of EXPECTED_INDEXES) sql.exec(statement);
}

export function migrate(sql: Sql): void {
  sql.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const version = sql.exec('SELECT MAX(version) AS version FROM schema_version').toArray()[0]?.version ?? 0;
  if (version < 1) {
    const statements = [
      `CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL,
        no INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL, renamed_at INTEGER, title_id TEXT, muted_until INTEGER NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0, UNIQUE(name, tag))`,
      // 기기 키와 신원을 분리한다. 한 플레이어가 기기 키를 최대 5개까지 가진다.
      'CREATE TABLE player_keys (key_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
      // 외부 계정은 subject의 SHA-256만 저장한다(이메일·이름 저장 안 함).
      'CREATE TABLE account_links (provider TEXT NOT NULL, subject_hash TEXT NOT NULL, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(provider, subject_hash), UNIQUE(provider, player_id))',
      'CREATE TABLE friends (a TEXT, b TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(a,b))',
      'CREATE TABLE friend_requests (from_id TEXT, to_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(from_id,to_id))',
      'CREATE TABLE blocks (owner TEXT, target TEXT, PRIMARY KEY(owner,target))',
      'CREATE TABLE runs (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, content_id TEXT NOT NULL, mode TEXT NOT NULL, started_at INTEGER NOT NULL, cleared_at INTEGER)',
      // rank 0은 순위 미부여(fame.requireLinked일 때 미연동 기록).
      'CREATE TABLE clears (content_id TEXT, player_id TEXT, first_at INTEGER NOT NULL, best_ms INTEGER NOT NULL, count INTEGER NOT NULL, rank INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(content_id,player_id))',
      'CREATE TABLE titles (player_id TEXT, title_id TEXT, earned_at INTEGER NOT NULL, PRIMARY KEY(player_id,title_id))',
      'CREATE TABLE dm_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)',
      'CREATE TABLE chat_log (channel TEXT, id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)',
      'CREATE TABLE listings (id TEXT PRIMARY KEY, host_id TEXT NOT NULL UNIQUE, party_code TEXT NOT NULL, content_id TEXT, note TEXT NOT NULL, slots INTEGER NOT NULL, members INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
      `CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
        body TEXT NOT NULL, diag TEXT, status TEXT NOT NULL DEFAULT 'open', votes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dev_reply TEXT, hidden INTEGER NOT NULL DEFAULT 0)`,
      'CREATE TABLE votes (post_id INTEGER, player_id TEXT, PRIMARY KEY(post_id,player_id))',
      'CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, dev INTEGER NOT NULL DEFAULT 0)',
      'CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL)',
      'CREATE TABLE rate_events (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, at INTEGER NOT NULL)',
      'CREATE TABLE ws_tickets (ticket TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
      'CREATE TABLE nonces (player_id TEXT, nonce TEXT, at INTEGER NOT NULL, PRIMARY KEY(player_id,nonce))',
      'CREATE TABLE chat_state (player_id TEXT PRIMARY KEY, last_at INTEGER NOT NULL, text TEXT NOT NULL, repeats INTEGER NOT NULL)',
    ];
    for (const statement of statements) sql.exec(statement);
    sql.exec('INSERT INTO schema_version(version) VALUES (1)');
  }
  if (version < SCHEMA_VERSION) {
    // v2로 기록됐더라도 과거 배포에서 빠진 컬럼·인덱스를 실제 스키마와 대조해 복구한다.
    ensureExpectedSchema(sql);
    if (version < 2) {
      sql.exec('UPDATE clears SET last_at = first_at WHERE last_at IS NULL');
      sql.exec(`UPDATE clears SET subject_hash = (SELECT subject_hash FROM account_links WHERE player_id = clears.player_id AND provider = 'google' AND created_at <= clears.first_at) WHERE rank > 0 AND subject_hash IS NULL`);
      // 발급 기기 키를 알 수 없는 기존 티켓은 다시 발급해야 한다.
      sql.exec('DELETE FROM ws_tickets');
      sql.exec('INSERT INTO schema_version(version) VALUES (2)');
    }
    sql.exec('INSERT INTO schema_version(version) VALUES (?)', SCHEMA_VERSION);
  }
}
