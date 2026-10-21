import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SocialCore } from '../src/server/core';
import { randomHex, sha256Hex } from '../src/server/hub';
import type { GameConfig } from '../src/shared/protocol';

const config: GameConfig = {
  gameId: 'migration-test', worldChannels: 1, worldCapacity: 1,
  contents: [{ id: 'cave', name: '동굴', minClearSec: 40 }], titleTiers: [], bannedWords: [],
  founders: { maxNo: 0, titleId: 'founder', label: '창립' }, completion: { titleId: 'all', label: '전체' }, dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
};

const expectedColumns: Record<string, Record<string, string>> = {
  players: { created_ip_hash: 'TEXT', hero: 'TEXT' },
  clears: { summary: 'TEXT', rank_summary: 'TEXT', subject_hash: 'TEXT', last_at: 'INTEGER' },
  ws_tickets: { key_hash: 'TEXT' },
};
const expectedIndexes: Record<string, [string, string[]]> = {
  player_keys_player: ['player_keys', ['player_id', 'last_seen']],
  account_links_player: ['account_links', ['player_id']],
  friend_requests_to: ['friend_requests', ['to_id']],
  blocks_target: ['blocks', ['target']],
  runs_player: ['runs', ['player_id', 'started_at']],
  clears_rank: ['clears', ['content_id', 'rank']],
  clears_best: ['clears', ['content_id', 'best_ms']],
  clears_player: ['clears', ['player_id']],
  inbox_player: ['dm_inbox', ['to_id', 'id']],
  chat_channel: ['chat_log', ['channel', 'at']],
  posts_created: ['posts', ['created_at', 'id']],
  comments_post: ['comments', ['post_id', 'id']],
  reports_target: ['reports', ['target', 'kind', 'created_at']],
  rate_key: ['rate_events', ['key', 'at']],
  rate_at: ['rate_events', ['at']],
  nonces_at: ['nonces', ['at']],
  clears_subject: ['clears', ['content_id', 'subject_hash', 'rank']],
  clears_recent: ['clears', ['content_id', 'last_at']],
  recent_messages_at: ['recent_messages', ['at']],
  ws_tickets_player: ['ws_tickets', ['player_id']],
  ws_tickets_key: ['ws_tickets', ['key_hash']],
};

function expectLatestSchema(db: Database) {
  expect(db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 4 });
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actual = db.query(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
    for (const [name, type] of Object.entries(columns)) expect(actual).toContainEqual(expect.objectContaining({ name, type }));
  }
  for (const [name, [table, columns]] of Object.entries(expectedIndexes)) {
    expect(db.query(`PRAGMA index_list(${table})`).all()).toContainEqual(expect.objectContaining({ name }));
    expect(db.query(`PRAGMA index_info(${name})`).all().map((row: any) => row.name)).toEqual(columns);
  }
}

function dataSnapshot(db: Database) {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_version' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.query(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

// 현행 migrate를 호출하지 않고 과거 스키마와 데이터를 고정한다. 누락 인덱스도 함께 복구해야 한다.
function legacy() {
  const db = new Database(':memory:');
  let now = 1000;
  db.exec(`
    CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
    INSERT INTO schema_version VALUES (1);
    CREATE TABLE players(id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, no INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      renamed_at INTEGER, title_id TEXT, muted_until INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, UNIQUE(name, tag));
    INSERT INTO players(id, name, tag, no, created_at) VALUES ('ranked', '기존플레이어', '0001', 1, 100), ('guest', '미연동', '0002', 2, 100), ('late', '나중연동', '0003', 3, 100);
    CREATE TABLE player_keys(key_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE account_links(provider TEXT, subject_hash TEXT, player_id TEXT, created_at INTEGER, PRIMARY KEY(provider, subject_hash));
    INSERT INTO account_links VALUES ('google', 'subject-before-clear', 'ranked', 150), ('google', 'subject-after-clear', 'late', 300);
    CREATE TABLE clears(content_id TEXT, player_id TEXT, first_at INTEGER, best_ms INTEGER, count INTEGER, rank INTEGER, revoked INTEGER DEFAULT 0, PRIMARY KEY(content_id, player_id));
    INSERT INTO clears VALUES ('cave', 'ranked', 200, 50000, 2, 1, 0), ('cave', 'guest', 200, 60000, 1, 0, 0), ('cave', 'late', 200, 70000, 1, 2, 0);
    CREATE TABLE ws_tickets(ticket TEXT PRIMARY KEY, player_id TEXT, expires_at INTEGER);
    INSERT INTO ws_tickets VALUES ('old-ticket', 'ranked', 999999);
    CREATE TABLE friends(a TEXT, b TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(a,b));
    CREATE TABLE friend_requests(from_id TEXT, to_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(from_id,to_id));
    CREATE TABLE blocks(owner TEXT, target TEXT, PRIMARY KEY(owner,target));
    CREATE TABLE runs(id TEXT PRIMARY KEY, player_id TEXT NOT NULL, content_id TEXT NOT NULL, mode TEXT NOT NULL, started_at INTEGER NOT NULL, cleared_at INTEGER);
    CREATE TABLE titles(player_id TEXT, title_id TEXT, earned_at INTEGER NOT NULL, PRIMARY KEY(player_id,title_id));
    INSERT INTO titles VALUES ('ranked', 'first:cave', 200);
    CREATE TABLE dm_inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, to_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE chat_log(channel TEXT, id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE listings(id TEXT PRIMARY KEY, host_id TEXT NOT NULL UNIQUE, party_code TEXT NOT NULL, content_id TEXT, note TEXT NOT NULL,
      slots INTEGER NOT NULL, members INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE posts(id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, diag TEXT, status TEXT NOT NULL DEFAULT 'open', votes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dev_reply TEXT, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE votes(post_id INTEGER, player_id TEXT, PRIMARY KEY(post_id,player_id));
    CREATE TABLE comments(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, dev INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE reports(id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE rate_events(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE nonces(player_id TEXT, nonce TEXT, at INTEGER NOT NULL, PRIMARY KEY(player_id,nonce));
    CREATE TABLE chat_state(player_id TEXT PRIMARY KEY, last_at INTEGER NOT NULL, text TEXT NOT NULL, repeats INTEGER NOT NULL);
  `);
  const create = (failPrefix?: string) => new SocialCore({
    sql: { exec(q, ...b) {
      if (failPrefix && q.startsWith(failPrefix)) throw new Error('마이그레이션 실패 주입');
      const rows = db.query(q).all(...b); return { toArray: () => rows };
    } },
    transaction: fn => db.transaction(fn)(), config, now: () => now, randomHex, sha256Hex,
  });
  return { db, create, advance: (ms: number) => { now += ms; } };
}

function legacyV2() {
  const h = legacy();
  h.db.exec(`
    INSERT INTO schema_version VALUES (2);
    ALTER TABLE players ADD COLUMN created_ip_hash TEXT;
    ALTER TABLE clears ADD COLUMN summary TEXT;
    ALTER TABLE clears ADD COLUMN subject_hash TEXT;
    ALTER TABLE clears ADD COLUMN last_at INTEGER;
    ALTER TABLE ws_tickets ADD COLUMN key_hash TEXT;
    CREATE TABLE account_link_history(provider TEXT NOT NULL, subject_hash TEXT NOT NULL, player_id TEXT NOT NULL, unlinked_at INTEGER NOT NULL, PRIMARY KEY(provider, subject_hash));
    INSERT INTO account_link_history VALUES ('google', 'old-subject', 'ranked', 500);
    CREATE TABLE recent_messages(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, at INTEGER NOT NULL);
    INSERT INTO recent_messages VALUES ('message', 'ranked', 600);
    UPDATE players SET created_ip_hash = 'original-ip' WHERE id = 'ranked';
    UPDATE clears SET summary = '{"kills":20}', subject_hash = 'ranked-subject', last_at = 900 WHERE player_id = 'ranked';
    UPDATE ws_tickets SET key_hash = 'issued-key';
    CREATE INDEX clears_subject ON clears(content_id, subject_hash, rank);
    CREATE INDEX ws_tickets_key ON ws_tickets(key_hash);
  `);
  return h;
}

test('v1→v4는 모든 기대 컬럼·인덱스를 만들고 기존 순위·기록을 보존한다', () => {
  const h = legacy(), before = dataSnapshot(h.db);
  h.create();
  expectLatestSchema(h.db);
  expect(dataSnapshot(h.db)).toEqual({
    ...before,
    players: (before.players as object[]).map(row => ({ ...row, created_ip_hash: null, hero: null })),
    clears: (before.clears as any[]).map(row => ({
      ...row, summary: null, rank_summary: null, last_at: row.first_at,
      subject_hash: row.player_id === 'ranked' ? 'subject-before-clear' : null,
    })),
    ws_tickets: [], account_link_history: [], recent_messages: [],
  });
  expect(h.db.query('SELECT name, created_ip_hash FROM players WHERE id = ?').get('ranked')).toEqual({ name: '기존플레이어', created_ip_hash: null });
  expect(h.db.query('SELECT rank, count, first_at, last_at, best_ms, subject_hash, summary, rank_summary FROM clears WHERE player_id = ?').get('ranked'))
    .toEqual({ rank: 1, count: 2, first_at: 200, last_at: 200, best_ms: 50000, subject_hash: 'subject-before-clear', summary: null, rank_summary: null });
  expect(h.db.query('SELECT subject_hash FROM clears WHERE player_id = ?').get('guest')).toEqual({ subject_hash: null });
  expect(h.db.query('SELECT subject_hash FROM clears WHERE player_id = ?').get('late')).toEqual({ subject_hash: null });
  expect(h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get()).toEqual({ n: 0 });
  expect(h.db.query('SELECT * FROM titles').all()).toEqual([{ player_id: 'ranked', title_id: 'first:cave', earned_at: 200 }]);
  const data = dataSnapshot(h.db);
  expect(() => h.create()).not.toThrow();
  expectLatestSchema(h.db);
  expect(dataSnapshot(h.db)).toEqual(data);
});

test('rank_summary 없는 v2→v4는 누락만 보정하고 기존 데이터·발급 티켓을 보존한다', () => {
  const h = legacyV2();
  const before = dataSnapshot(h.db);
  expect(() => h.db.query('SELECT rank_summary FROM clears').all()).toThrow('no such column');
  h.create();
  expectLatestSchema(h.db);
  const after = dataSnapshot(h.db);
  expect(after).toEqual({
    ...before,
    players: (before.players as object[]).map(row => ({ ...row, hero: null })),
    clears: (before.clears as object[]).map(row => ({ ...row, rank_summary: null })),
  });
  expect(() => h.create()).not.toThrow();
  expectLatestSchema(h.db);
  expect(dataSnapshot(h.db)).toEqual(after);
});

test('v3→v4는 hero를 null로 추가하고 기존 데이터·발급 티켓을 보존한다', () => {
  const h = legacyV2();
  h.db.exec('INSERT INTO schema_version VALUES (3); ALTER TABLE clears ADD COLUMN rank_summary TEXT');
  const before = dataSnapshot(h.db);
  h.create();
  expectLatestSchema(h.db);
  expect(dataSnapshot(h.db)).toEqual({ ...before, players: (before.players as object[]).map(row => ({ ...row, hero: null })) });
});

test('v3에 hero가 이미 있으면 기존 영웅을 보존하고 누락 컬럼만 보정한다', () => {
  const h = legacyV2();
  h.db.exec("INSERT INTO schema_version VALUES (3); ALTER TABLE players ADD COLUMN hero TEXT; UPDATE players SET hero = 'mage' WHERE id = 'ranked'");
  const before = dataSnapshot(h.db);
  h.create();
  expectLatestSchema(h.db);
  expect(dataSnapshot(h.db)).toEqual({ ...before, clears: (before.clears as object[]).map(row => ({ ...row, rank_summary: null })) });
});

test('최신 DB는 두 번 재실행해도 스키마·전체 데이터와 선택 영웅을 변경하지 않는다', () => {
  const h = legacyV2();
  h.db.exec('ALTER TABLE clears ADD COLUMN rank_summary TEXT');
  h.create();
  h.db.exec(`UPDATE clears SET rank_summary = '{"kills":10}' WHERE player_id = 'ranked'`);
  h.db.exec("UPDATE players SET hero = 'ranger' WHERE id = 'ranked'");
  const data = dataSnapshot(h.db);
  const schema = h.db.query('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
  for (let i = 0; i < 2; i++) {
    expect(() => h.create()).not.toThrow();
    expectLatestSchema(h.db);
    expect(dataSnapshot(h.db)).toEqual(data);
    expect(h.db.query('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()).toEqual(schema);
  }
});

test('보정된 v2 DB에서 runs/clear가 성공하고 기존 순위 요약을 추측하지 않는다', async () => {
  const h = legacyV2(), core = h.create(), key = 'a'.repeat(42) + 'A';
  h.db.query('INSERT INTO player_keys VALUES (?, ?, ?, ?)').run(await core.keyHash(key), 'ranked', 100, 100);
  const call = (path: string, body: unknown) => core.handle({
    method: 'POST', path, body, key, query: new URLSearchParams(), ipHash: 'request-ip', adminIds: [], clientIds: [],
  });
  const start = await call('/runs/start', { contentId: 'cave', mode: 'solo' });
  expect(start.status).toBe(201);
  h.advance(50000);
  const summary = { elapsedMs: 50000, kills: 30, roomsCleared: 3, bossDefeated: true, hpLost: 5 };
  const result = await call('/runs/clear', { runId: (start.body as any).runId, summary });
  expect(result.status).toBe(200);
  expect(h.db.query('SELECT rank, count, first_at, subject_hash, summary, rank_summary FROM clears WHERE player_id = ?').get('ranked'))
    .toEqual({ rank: 1, count: 3, first_at: 200, subject_hash: 'ranked-subject', summary: JSON.stringify(summary), rank_summary: null });
});

test('v2→v4 도중 오류는 새 컬럼·버전·데이터를 롤백하고 재시도한다', () => {
  const h = legacyV2(), data = dataSnapshot(h.db);
  expect(() => h.create('CREATE INDEX IF NOT EXISTS clears_subject')).toThrow('마이그레이션 실패 주입');
  expect(h.db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 2 });
  expect(h.db.query('PRAGMA table_info(clears)').all().map((row: any) => row.name)).not.toContain('rank_summary');
  expect(dataSnapshot(h.db)).toEqual(data);
  expect(() => h.create()).not.toThrow();
  expectLatestSchema(h.db);
});

test('v3→v4 도중 오류는 hero·버전·전체 데이터를 롤백하고 재시도한다', () => {
  const h = legacyV2();
  h.db.exec('INSERT INTO schema_version VALUES (3); ALTER TABLE clears ADD COLUMN rank_summary TEXT');
  const before = dataSnapshot(h.db);
  expect(() => h.create('CREATE INDEX IF NOT EXISTS clears_subject')).toThrow('마이그레이션 실패 주입');
  expect(h.db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 3 });
  expect(h.db.query('PRAGMA table_info(players)').all().map((row: any) => row.name)).not.toContain('hero');
  expect(dataSnapshot(h.db)).toEqual(before);
  h.create();
  expectLatestSchema(h.db);
});

test('마이그레이션 도중 오류는 스키마·기존 데이터·티켓을 함께 롤백하며 재시도 가능', () => {
  const h = legacy();
  expect(() => h.create('CREATE TABLE IF NOT EXISTS recent_messages')).toThrow('마이그레이션 실패 주입');
  expect(h.db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 1 });
  expect(h.db.query('PRAGMA table_info(players)').all().map((r: any) => r.name)).not.toContain('created_ip_hash');
  expect(h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get()).toEqual({ n: 1 });
  expect(h.db.query('SELECT rank, count FROM clears WHERE player_id = ?').get('ranked')).toEqual({ rank: 1, count: 2 });
  expect(() => h.create()).not.toThrow();
});
