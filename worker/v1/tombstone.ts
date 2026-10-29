// 남용 방지 묘비(docs/ACCOUNT_POLICY.md 7장). 탈퇴한 연동 90일, 정지(banned) 계정 연동 1년.
// 용도는 오직 "계정당 1회 보상"(연동 보상 등) 재수령 방지다. 가입·진행·로그인은 이 표로 막지 않는다(리세마라는 막지 않는 결정).
// 저장하는 값은 account_links.subject_hash(= sha256(provider:sub))뿐이라 원문 식별자는 어디에도 없다.
import type { D1Database } from './db';

export const WITHDRAWN_TOMBSTONE_MS = 90 * 24 * 3600 * 1000;
export const BANNED_TOMBSTONE_MS = 365 * 24 * 3600 * 1000;

/** 탈퇴 배치에 넣을 문장 SQL: 이 계정의 연동을 묘비로 옮긴다. 바인딩 순서: now, now + 보관기간, account_id. account_links 삭제보다 앞에 둔다. */
export const WITHDRAWN_TOMBSTONE_SQL = `INSERT INTO abuse_tombstones(provider, subject_hash, reason, created_at, expires_at)
  SELECT provider, subject_hash, 'withdrawn', ?, ? FROM account_links WHERE account_id = ? AND true
  ON CONFLICT(provider, subject_hash) DO UPDATE SET expires_at = max(expires_at, excluded.expires_at), reason = CASE WHEN reason = 'banned' THEN reason ELSE excluded.reason END`;

/**
 * 이 제공자 계정이 최근 탈퇴·정지한 계정에 묶여 있었는가. 1회 보상 지급 직전에 부르고, true면 '이미 받음'으로 처리한다.
 * 지급 코드 연결 지점: docs/ACCOUNT_POLICY.md 7장(현재 서버에는 연동 보상 지급 코드가 없다).
 */
export async function hasRecentTombstone(db: D1Database, provider: string, subjectHash: string, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM abuse_tombstones WHERE provider = ? AND subject_hash = ? AND expires_at > ?')
    .bind(provider, subjectHash, now).first();
  return !!row;
}

/**
 * 정지 계정의 연동을 1년 묘비로 올린다(정지 경로가 어디든 크론이 맞춘다). 시작 시각은 가장 최근 ban 제재 시각, 없으면 last_seen.
 * 이미 지난 정지(1년 경과)는 올리지 않아 만료된 묘비가 되살아나지 않는다. 기존 banned 묘비가 있어도 새 만료일이 더 늦으면(재제재) 갱신 대상이다(UPSERT가 max를 유지). 한 번에 최대 limit개.
 */
export async function syncBannedTombstones(db: D1Database, now: number, limit = 100): Promise<number> {
  const out = await db.prepare(`INSERT INTO abuse_tombstones(provider, subject_hash, reason, created_at, expires_at)
    SELECT l.provider, l.subject_hash, 'banned', ?, b.since + ? FROM account_links l
      JOIN (SELECT a.account_id, COALESCE((SELECT MAX(s.at) FROM sanctions s WHERE s.account_id = a.account_id AND s.kind = 'ban'), a.last_seen) AS since
            FROM accounts a WHERE a.status = 'banned') b ON b.account_id = l.account_id
    WHERE b.since + ? > ?
      AND NOT EXISTS (SELECT 1 FROM abuse_tombstones t WHERE t.provider = l.provider AND t.subject_hash = l.subject_hash AND t.reason = 'banned' AND t.expires_at >= b.since + ?)
    LIMIT ?
    ON CONFLICT(provider, subject_hash) DO UPDATE SET reason = 'banned', expires_at = max(expires_at, excluded.expires_at)`)
    .bind(now, BANNED_TOMBSTONE_MS, BANNED_TOMBSTONE_MS, now, BANNED_TOMBSTONE_MS, limit).run();
  return out.meta?.changes ?? 0;
}

/** 만료된 묘비를 지운다(한 번에 최대 limit). */
export async function purgeExpiredTombstones(db: D1Database, now: number, limit = 100): Promise<number> {
  const out = await db.prepare('DELETE FROM abuse_tombstones WHERE rowid IN (SELECT rowid FROM abuse_tombstones WHERE expires_at <= ? LIMIT ?)')
    .bind(now, limit).run();
  return out.meta?.changes ?? 0;
}
