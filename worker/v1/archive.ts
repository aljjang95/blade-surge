// 미접속 게스트 보관(docs/ACCOUNT_POLICY.md 3장): 영구 삭제가 아니다.
// 대상: 활성·연동 없음·무결제·레벨 5 이하·180일 미접속·테스트 아님. 진행 문서를 account_archive로 옮기고 표시만 남긴다.
// 같은 기기 키로 돌아오면 세션 생성 때 그대로 복원한다(createSession → restoreIdle).
import type { D1Database } from './db';

export const IDLE_MS = 180 * 24 * 3600 * 1000;
export const IDLE_MAX_LEVEL = 5;
/** 보관본 파기 예정 시각(개인정보처리방침 기준, 파기 작업은 별도). */
export const IDLE_PURGE_MS = 365 * 24 * 3600 * 1000;

interface DocRow { account_id: string; rev: number; doc: string }

/** 크론 한 번에 최대 limit 계정을 보관한다. 보관한 계정 수를 돌려준다. */
export async function archiveIdleGuests(db: D1Database, now: number, limit = 100): Promise<number> {
  const rows = await db.prepare(`SELECT a.account_id, d.rev, d.doc FROM accounts a
    JOIN account_docs d ON d.account_id = a.account_id AND d.doc_name = 'core'
    WHERE a.status = 'active' AND a.last_seen < ? AND a.gems_paid = 0 AND a.level <= ?
      AND NOT EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.account_id)
      AND NOT EXISTS (SELECT 1 FROM account_flags f WHERE f.account_id = a.account_id)
      AND NOT EXISTS (SELECT 1 FROM iap_purchases p WHERE p.account_id = a.account_id)
      AND NOT EXISTS (SELECT 1 FROM iap_web_payments w WHERE w.account_id = a.account_id)
    ORDER BY a.last_seen LIMIT ?`).bind(now - IDLE_MS, IDLE_MAX_LEVEL, limit).all<DocRow>();
  let archived = 0;
  for (const r of rows.results ?? []) {
    // 문서 rev가 그대로일 때만 옮긴다(사이에 접속해 진행이 바뀌었으면 건너뛴다). 배치는 한 트랜잭션이다.
    const out = await db.batch([
      db.prepare("INSERT OR IGNORE INTO account_archive(archive_id, account_id, reason, doc, archived_at, purge_at) SELECT ?, ?, 'idle', ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_docs WHERE account_id = ? AND doc_name = 'core' AND rev = ?)")
        .bind(`idle:${r.account_id}:${r.rev}`, r.account_id, r.doc, now, now + IDLE_PURGE_MS, r.account_id, r.rev),
      db.prepare("INSERT OR IGNORE INTO account_flags(account_id, flag, at) SELECT ?, 'idle-archived', ? WHERE EXISTS (SELECT 1 FROM account_docs WHERE account_id = ? AND doc_name = 'core' AND rev = ?)")
        .bind(r.account_id, now, r.account_id, r.rev),
      db.prepare("DELETE FROM account_docs WHERE account_id = ? AND doc_name = 'core' AND rev = ?").bind(r.account_id, r.rev),
    ]);
    if (out[2]?.meta?.changes) archived++;
  }
  return archived;
}

/** 보관된 게스트가 돌아왔다: 마지막 보관본을 같은 rev로 되돌리고 표시를 지운다. 보관 상태가 아니면 아무것도 하지 않는다. */
export async function restoreIdle(db: D1Database, accountId: string, now: number): Promise<boolean> {
  const flag = await db.prepare("SELECT 1 AS x FROM account_flags WHERE account_id = ? AND flag = 'idle-archived'").bind(accountId).first();
  if (!flag) return false;
  const arc = await db.prepare("SELECT archive_id, doc FROM account_archive WHERE account_id = ? AND reason = 'idle' ORDER BY archived_at DESC LIMIT 1")
    .bind(accountId).first<{ archive_id: string; doc: string }>();
  if (!arc) return false;
  const rev = Number(arc.archive_id.split(':').pop()) || 1;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO account_docs(account_id, doc_name, rev, doc, bytes, updated_at) VALUES (?, 'core', ?, ?, ?, ?)")
      .bind(accountId, rev, arc.doc, new TextEncoder().encode(arc.doc).length, now),
    db.prepare("DELETE FROM account_flags WHERE account_id = ? AND flag = 'idle-archived'").bind(accountId),
  ]);
  return true;
}
