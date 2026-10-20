export interface Sql {
  exec(query: string, ...bindings: any[]): { toArray(): any[]; one?(): any };
}

export function migrate(sql: Sql): void {
  sql.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const version = sql.exec('SELECT MAX(version) AS version FROM schema_version').toArray()[0]?.version ?? 0;
  if (version >= 1) return;
  const statements = [
    `CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL,
      no INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL, renamed_at INTEGER, title_id TEXT, muted_until INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0, UNIQUE(name, tag))`,
    // 기기 키와 신원을 분리한다. 한 플레이어가 기기 키를 최대 5개까지 가진다.
    'CREATE TABLE player_keys (key_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
    'CREATE INDEX player_keys_player ON player_keys(player_id, last_seen)',
    // 외부 계정은 subject의 SHA-256만 저장한다(이메일·이름 저장 안 함).
    'CREATE TABLE account_links (provider TEXT NOT NULL, subject_hash TEXT NOT NULL, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(provider, subject_hash), UNIQUE(provider, player_id))',
    'CREATE INDEX account_links_player ON account_links(player_id)',
    'CREATE TABLE friends (a TEXT, b TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(a,b))',
    'CREATE TABLE friend_requests (from_id TEXT, to_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(from_id,to_id))',
    'CREATE INDEX friend_requests_to ON friend_requests(to_id)',
    'CREATE TABLE blocks (owner TEXT, target TEXT, PRIMARY KEY(owner,target))',
    'CREATE INDEX blocks_target ON blocks(target)',
    'CREATE TABLE runs (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, content_id TEXT NOT NULL, mode TEXT NOT NULL, started_at INTEGER NOT NULL, cleared_at INTEGER)',
    'CREATE INDEX runs_player ON runs(player_id, started_at)',
    // rank 0은 순위 미부여(fame.requireLinked일 때 미연동 기록).
    'CREATE TABLE clears (content_id TEXT, player_id TEXT, first_at INTEGER NOT NULL, best_ms INTEGER NOT NULL, count INTEGER NOT NULL, rank INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(content_id,player_id))',
    'CREATE INDEX clears_rank ON clears(content_id, rank)',
    'CREATE INDEX clears_best ON clears(content_id, best_ms)',
    'CREATE INDEX clears_player ON clears(player_id)',
    'CREATE TABLE titles (player_id TEXT, title_id TEXT, earned_at INTEGER NOT NULL, PRIMARY KEY(player_id,title_id))',
    'CREATE TABLE dm_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE INDEX inbox_player ON dm_inbox(to_id,id)',
    'CREATE TABLE chat_log (channel TEXT, id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)',
    'CREATE INDEX chat_channel ON chat_log(channel,at)',
    'CREATE TABLE listings (id TEXT PRIMARY KEY, host_id TEXT NOT NULL UNIQUE, party_code TEXT NOT NULL, content_id TEXT, note TEXT NOT NULL, slots INTEGER NOT NULL, members INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
    `CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, diag TEXT, status TEXT NOT NULL DEFAULT 'open', votes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dev_reply TEXT, hidden INTEGER NOT NULL DEFAULT 0)`,
    'CREATE INDEX posts_created ON posts(created_at,id)',
    'CREATE TABLE votes (post_id INTEGER, player_id TEXT, PRIMARY KEY(post_id,player_id))',
    'CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, dev INTEGER NOT NULL DEFAULT 0)',
    'CREATE INDEX comments_post ON comments(post_id,id)',
    'CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE INDEX reports_target ON reports(target,kind,created_at)',
    'CREATE TABLE rate_events (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, at INTEGER NOT NULL)',
    'CREATE INDEX rate_key ON rate_events(key,at)',
    'CREATE INDEX rate_at ON rate_events(at)',
    'CREATE TABLE ws_tickets (ticket TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE nonces (player_id TEXT, nonce TEXT, at INTEGER NOT NULL, PRIMARY KEY(player_id,nonce))',
    'CREATE INDEX nonces_at ON nonces(at)',
    'CREATE TABLE chat_state (player_id TEXT PRIMARY KEY, last_at INTEGER NOT NULL, text TEXT NOT NULL, repeats INTEGER NOT NULL)',
  ];
  for (const statement of statements) sql.exec(statement);
  sql.exec('INSERT INTO schema_version(version) VALUES (1)');
}
