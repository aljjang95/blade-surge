import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SocialCore } from '../src/server/core';
import { randomHex, sha256Hex } from '../src/server/hub';
import type { GameConfig } from '../src/shared/protocol';

const config: GameConfig = {
  gameId: 'migration-test', worldChannels: 1, worldCapacity: 1, contents: [], titleTiers: [], bannedWords: [],
  founders: { maxNo: 0, titleId: 'founder', label: '창립' }, completion: { titleId: 'all', label: '전체' }, dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
};

// v1 운영 데이터의 변경 대상 테이블만 고정한 독립 마이그레이션 픽스처.
function legacy() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
    INSERT INTO schema_version VALUES (1);
    CREATE TABLE players(id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
    INSERT INTO players VALUES ('ranked', '기존플레이어', 100), ('guest', '미연동', 100), ('late', '나중연동', 100);
    CREATE TABLE account_links(provider TEXT, subject_hash TEXT, player_id TEXT, created_at INTEGER, PRIMARY KEY(provider, subject_hash));
    INSERT INTO account_links VALUES ('google', 'subject-before-clear', 'ranked', 150), ('google', 'subject-after-clear', 'late', 300);
    CREATE TABLE clears(content_id TEXT, player_id TEXT, first_at INTEGER, best_ms INTEGER, count INTEGER, rank INTEGER, revoked INTEGER DEFAULT 0, PRIMARY KEY(content_id, player_id));
    INSERT INTO clears VALUES ('cave', 'ranked', 200, 50000, 2, 1, 0), ('cave', 'guest', 200, 60000, 1, 0, 0), ('cave', 'late', 200, 70000, 1, 2, 0);
    CREATE TABLE ws_tickets(ticket TEXT PRIMARY KEY, player_id TEXT, expires_at INTEGER);
    INSERT INTO ws_tickets VALUES ('old-ticket', 'ranked', 999999);
  `);
  const create = (fail = false) => new SocialCore({
    sql: { exec(q, ...b) {
      if (fail && q.startsWith('CREATE TABLE recent_messages')) throw new Error('마이그레이션 실패 주입');
      const rows = db.query(q).all(...b); return { toArray: () => rows };
    } },
    transaction: fn => db.transaction(fn)(), config, now: () => 1000, randomHex, sha256Hex,
  });
  return { db, create };
}

test('v1→v2는 기존 순위·기록을 보존하고 알 수 없는 IP·summary를 만들지 않는다', () => {
  const h = legacy(); h.create(); h.create();
  expect(h.db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 2 });
  expect(h.db.query('SELECT name, created_ip_hash FROM players WHERE id = ?').get('ranked')).toEqual({ name: '기존플레이어', created_ip_hash: null });
  expect(h.db.query('SELECT rank, count, first_at, last_at, best_ms, subject_hash, summary, rank_summary FROM clears WHERE player_id = ?').get('ranked'))
    .toEqual({ rank: 1, count: 2, first_at: 200, last_at: 200, best_ms: 50000, subject_hash: 'subject-before-clear', summary: null, rank_summary: null });
  expect(h.db.query('SELECT subject_hash FROM clears WHERE player_id = ?').get('guest')).toEqual({ subject_hash: null });
  expect(h.db.query('SELECT subject_hash FROM clears WHERE player_id = ?').get('late')).toEqual({ subject_hash: null });
  expect(h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get()).toEqual({ n: 0 });
});

test('마이그레이션 도중 오류는 스키마·기존 데이터·티켓을 함께 롤백하며 재시도 가능', () => {
  const h = legacy();
  expect(() => h.create(true)).toThrow('마이그레이션 실패 주입');
  expect(h.db.query('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 1 });
  expect(h.db.query('PRAGMA table_info(players)').all().map((r: any) => r.name)).not.toContain('created_ip_hash');
  expect(h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get()).toEqual({ n: 1 });
  expect(h.db.query('SELECT rank, count FROM clears WHERE player_id = ?').get('ranked')).toEqual({ rank: 1, count: 2 });
  expect(() => h.create()).not.toThrow();
});
