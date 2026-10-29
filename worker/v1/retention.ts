// 보관·파기 크론(docs/ACCOUNT_POLICY.md 7장 표). 시간당 크론이 부르며 모든 작업은 1회 최대 limit(기본 100)건이다.
// 결제·환불 기록(wallet_ledger, iap_*, 포트원 결제)은 전자상거래법 보존 때문에 여기서 건드리지 않는다(후속: 5년 뒤 파기).
import type { D1Database } from './db';
import { purgeExpiredTombstones, syncBannedTombstones } from './tombstone';

/** 탈퇴 파기에서 계정 id로 통째로 지우는 진행·개인 데이터 표. 감사 기록(audit_flags)·제재(sanctions)·결제 표는 남긴다. */
const PROGRESS_TABLES = ['account_docs', 'legacy_saves', 'mail', 'run_tickets', 'parity_log', 'account_flags', 'oauth_states', 'account_keys', 'account_links'];

/** idle 파기에서 지우는 진행·임포트 멱등 표(결제 표 제외). */
const IDLE_PROGRESS_TABLES = ['legacy_saves', 'mail', 'run_tickets', 'parity_log', 'oauth_states'];

export interface PurgeResult { withdrawn: number; archives: number; idleAccounts: number; tombstones: number; banned: number }

/**
 * 탈퇴 보관(30일)이 지난 계정을 파기한다: 진행 문서·사본·우편·런 티켓·보관본을 지우고 status='deleted'로 바꾼다.
 * 계정 행은 결제 원장의 참조 주체라 남기고(표시 투영값만 비움: 레벨·재화·길드), 소셜 이름은 탈퇴 때 이미 "탈퇴한 모험가"로 익명화됐다.
 * 유료 재화 잔액(gems_paid)은 결제 기록과 한 묶음이라 건드리지 않는다.
 * 가드: 아직 status='deleting'이고 탈퇴 보관본의 purge_at이 지난 계정만. 사이에 상태가 바뀌면 모든 문장이 0행이다.
 */
export async function purgeWithdrawnAccounts(db: D1Database, now: number, limit = 100): Promise<number> {
  const rows = await db.prepare(`SELECT DISTINCT a.account_id FROM accounts a
    JOIN account_archive r ON r.account_id = a.account_id AND r.reason = 'deleted-by-user'
    WHERE a.status = 'deleting' AND r.purge_at <= ? ORDER BY a.account_id LIMIT ?`).bind(now, limit).all<{ account_id: string }>();
  let purged = 0;
  for (const { account_id: id } of rows.results ?? []) {
    const due = `EXISTS (SELECT 1 FROM accounts WHERE account_id = ? AND status = 'deleting') AND EXISTS (SELECT 1 FROM account_archive WHERE account_id = ? AND reason = 'deleted-by-user' AND purge_at <= ?)`;
    // 순서가 중요하다: 표 비우기(상태·보관본 가드) → 상태 전환 → 보관본 삭제(전환된 계정만). 한 트랜잭션이라 중간 상태는 보이지 않는다.
    const writes = PROGRESS_TABLES.map(table => db.prepare(`DELETE FROM ${table} WHERE account_id = ? AND ${due}`).bind(id, id, id, now));
    writes.push(db.prepare(`UPDATE accounts SET status = 'deleted', guild_id = NULL, level = 1, power = 0, stage_idx = 1, gold = 0, gems_free = 0
      WHERE account_id = ? AND ${due}`).bind(id, id, id, now));
    writes.push(db.prepare(`DELETE FROM account_archive WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE account_id = ? AND status = 'deleted')`).bind(id, id));
    const out = await db.batch(writes);
    if (out[PROGRESS_TABLES.length]?.meta?.changes) purged++;
  }
  return purged;
}

/**
 * purge_at이 지난 보관본을 지운다(기기 이관 'switched:*' 90일, 미접속 게스트 'idle' 1년). 탈퇴 보관본('deleted-by-user')은
 * 계정 상태를 함께 바꿔야 해서 purgeWithdrawnAccounts가 맡고 여기서는 건드리지 않는다.
 * 미접속 게스트('idle')는 보관본이 사라지면 복원할 수 없으므로, 그 계정을 deleted로 익명화한다
 * (보관본이 사라진 채 'idle-archived' 표시만 남으면 돌아온 게스트가 빈 문서를 받는 모순이 생긴다). 이 게스트는 생성 조건상
 * 연동·결제 이력이 없고 계정 행만 남는다. 같은 기기가 돌아오면 ensureAccount가 새 계정으로 되살린다(auth.ts).
 */
export async function purgeExpiredArchives(db: D1Database, now: number, limit = 100): Promise<{ archives: number; idleAccounts: number }> {
  // 후보 조회에도 파기 가드와 같은 제외 조건을 넣는다(LIMIT이 보호 대상에 먼저 걸려 뒤의 정상 대상이 영구 미처리되는 것을 막는다).
  const idleDue = (col: string, expire: string) => `EXISTS (SELECT 1 FROM account_archive r WHERE r.account_id = ${col} AND r.reason = 'idle' AND r.purge_at <= ${expire}
      AND EXISTS (SELECT 1 FROM account_flags WHERE account_id = ${col} AND flag = 'idle-archived')
      AND NOT EXISTS (SELECT 1 FROM account_flags WHERE account_id = ${col} AND flag = 'test')
      AND NOT EXISTS (SELECT 1 FROM account_archive WHERE account_id = ${col} AND reason = 'idle' AND purge_at > ${expire})
      AND NOT EXISTS (SELECT 1 FROM account_links WHERE account_id = ${col})
      AND NOT EXISTS (SELECT 1 FROM iap_purchases WHERE account_id = ${col}) AND NOT EXISTS (SELECT 1 FROM iap_web_payments WHERE account_id = ${col})
      AND EXISTS (SELECT 1 FROM accounts x WHERE x.account_id = ${col} AND x.status = 'active' AND x.gems_paid = 0 AND x.last_seen <= r.archived_at))`;
  const nowSql = String(Math.trunc(now)); // 숫자 리터럴(바인딩 없는 공통 가드)
  const idle = await db.prepare(`SELECT account_id FROM accounts a WHERE ${idleDue('a.account_id', nowSql)} ORDER BY account_id LIMIT ?`)
    .bind(limit).all<{ account_id: string }>();
  let idleAccounts = 0;
  for (const { account_id: id } of idle.results ?? []) {
    // 보관 이후 돌아온 계정(last_seen이 보관 시각보다 늦음)은 가드가 걸러낸다. 같은 조건이 복원(archive.ts restoreIdle)과 상호 배제된다.
    const deleted = `EXISTS (SELECT 1 FROM accounts WHERE account_id = ? AND status = 'deleted') AND EXISTS (SELECT 1 FROM account_archive WHERE account_id = ? AND reason = 'idle')`;
    // 결제 보존 대상이 아닌 진행·임포트 멱등 기록(legacy_saves·우편·티켓·parity·원장의 임포트/명령/정산 행)은 함께 지운다.
    // 같은 id로 되살아난 계정이 옛 임포트 상태(409 already-imported)나 옛 명령 응답을 물려받지 않게 한다. 결제 원장(kind 'iap%')은 남긴다.
    const cleanups = [...IDLE_PROGRESS_TABLES.map(t => `DELETE FROM ${t} WHERE account_id = ?`),
      `DELETE FROM wallet_ledger WHERE account_id = ? AND kind NOT LIKE 'iap%'`, 'DELETE FROM account_keys WHERE account_id = ?', 'DELETE FROM account_flags WHERE account_id = ?'];
    const out = await db.batch([
      db.prepare(`UPDATE accounts SET status = 'deleted', guild_id = NULL, level = 1, power = 0, stage_idx = 1, gold = 0, gems_free = 0
        WHERE account_id = ? AND ${idleDue('accounts.account_id', nowSql)}`).bind(id),
      ...cleanups.map(sql => db.prepare(`${sql} AND ${deleted}`).bind(id, id, id)),
      db.prepare(`DELETE FROM account_archive WHERE account_id = ? AND reason = 'idle' AND EXISTS (SELECT 1 FROM accounts WHERE account_id = ? AND status = 'deleted')`).bind(id, id),
    ]);
    if (out[0]?.meta?.changes) idleAccounts++;
  }
  // 기기 이관 보관본, 그리고 계정이 이미 돌아와 표시가 없는 만료된 idle 사본은 행만 지운다.
  const out = await db.prepare(`DELETE FROM account_archive WHERE archive_id IN (SELECT archive_id FROM account_archive r WHERE purge_at <= ? AND
      (reason LIKE 'switched:%' OR (reason = 'idle' AND NOT EXISTS (SELECT 1 FROM account_flags f WHERE f.account_id = r.account_id AND f.flag = 'idle-archived'))) LIMIT ?)`)
    .bind(now, limit).run();
  return { archives: out.meta?.changes ?? 0, idleAccounts };
}

/** 시간당 크론 한 번: 탈퇴 파기 → 보관본 파기 → 정지 묘비 갱신 → 만료 묘비 삭제. 각 단계는 독립이라 한 단계가 실패해도 다음은 돈다. */
export async function runRetention(db: D1Database, now: number, limit = 100): Promise<PurgeResult> {
  const result: PurgeResult = { withdrawn: 0, archives: 0, idleAccounts: 0, tombstones: 0, banned: 0 };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (error) { console.warn('retention step failed', name, error instanceof Error ? error.name : 'unknown'); }
  };
  await step('withdrawn', async () => { result.withdrawn = await purgeWithdrawnAccounts(db, now, limit); });
  await step('archives', async () => { Object.assign(result, await purgeExpiredArchives(db, now, limit)); });
  await step('banned', async () => { result.banned = await syncBannedTombstones(db, now, limit); });
  await step('tombstones', async () => { result.tombstones = await purgeExpiredTombstones(db, now, limit); });
  return result;
}
