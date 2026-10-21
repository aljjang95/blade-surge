// MMO P1-A: D1 타입, CAS 배치 헬퍼, 마이그레이터 (docs/MMO_DESIGN.md 3.3).
// D1 batch는 한 트랜잭션이지만 "0행이면 중단"이 없다. 그래서 같은 배치의 모든 쓰기에
// 같은 rev 조건을 걸고, 문서 UPDATE를 마지막에 둔다. 문서가 0행이면 앞의 쓰기도 모두 0행이다.

export type D1Value = string | number | null;
export interface D1Result<T = unknown> { success: boolean; results?: T[]; meta?: { changes?: number } }
export interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

export const SCHEMA_VERSION = 1;
export const DOC_LIMIT = 262144;

export class V1Error extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) { super(code); }
}

/** 마이그레이션 SQL을 문장 단위로 나눈다(주석 제거, 줄 끝 세미콜론 기준). */
export function splitSql(sql: string): string[] {
  const body = sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
  return body.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

/** 로컬·테스트·증명 도구용 마이그레이터. 운영 D1은 코디네이터가 wrangler로 적용한다. 재적용은 무해하다. */
export async function applyMigrations(db: D1Database, sqlTexts: string[], now = Date.now()): Promise<number> {
  for (const sql of sqlTexts) await db.batch(splitSql(sql).map(s => db.prepare(s)));
  await db.prepare('UPDATE v1_schema SET applied_at = ? WHERE singleton = 1 AND applied_at = 0').bind(now).run();
  const row = await db.prepare('SELECT version FROM v1_schema WHERE singleton = 1').first<{ version: number }>();
  return row?.version ?? 0;
}

/** 런타임은 DDL을 실행하지 않는다. 스키마가 없거나 낮으면 503으로 닫는다. */
export async function schemaReady(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT version FROM v1_schema WHERE singleton = 1').first<{ version: number }>();
    return !!row && row.version >= SCHEMA_VERSION;
  } catch { return false; }
}

/** 배치 안의 부가 쓰기: SQL은 마지막 자리 표시자 두 개로 (account_id, base_rev) 가드를 받는다. */
export interface GuardedWrite { sql: string; values: D1Value[] }
/** rev 가드 조건. 부가 쓰기의 WHERE 절 끝에 붙인다. 바인딩: account_id, base_rev. */
export const REV_GUARD = "EXISTS (SELECT 1 FROM account_docs WHERE account_id = ? AND doc_name = 'core' AND rev = ?)";

export interface Projection { level: number; power: number; stageIdx: number; gold: number; gemsFree: number; gemsPaid: number }
export interface CasCommit {
  accountId: string;
  baseRev: number;
  doc: string;
  now: number;
  /** 원장 한 줄. op_id 중복이면 배치 전체가 롤백된다(멱등). */
  ledger: { opId: string; kind: string; delta: unknown; receipt?: unknown };
  projection?: Projection;
  writes?: GuardedWrite[];
}
export type CasOutcome = { ok: true; rev: number } | { ok: false; reason: 'conflict' | 'duplicate' };

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * CAS 배치 한 번: 부가 쓰기 → 원장 → 투영 → 문서(마지막). 모두 같은 base_rev 가드.
 * 문서 UPDATE가 0행이면 다른 쓰기도 0행이므로 'conflict'. op_id 중복은 제약 위반으로 전체 롤백 → 'duplicate'.
 */
export async function casCommit(db: D1Database, c: CasCommit): Promise<CasOutcome> {
  const bytes = byteLength(c.doc);
  if (bytes > DOC_LIMIT) throw new V1Error(413, 'doc-too-large');
  const statements: D1Statement[] = [];
  for (const w of c.writes ?? []) statements.push(db.prepare(w.sql).bind(...w.values, c.accountId, c.baseRev));
  statements.push(db.prepare(`INSERT INTO wallet_ledger(op_id, account_id, kind, delta, receipt, rev_after, at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`)
    .bind(c.ledger.opId, c.accountId, c.ledger.kind, JSON.stringify(c.ledger.delta ?? null),
      c.ledger.receipt === undefined ? null : JSON.stringify(c.ledger.receipt), c.baseRev + 1, c.now, c.accountId, c.baseRev));
  if (c.projection) {
    const p = c.projection;
    statements.push(db.prepare(`UPDATE accounts SET level = ?, power = ?, stage_idx = ?, gold = ?, gems_free = ?, gems_paid = ?, last_seen = ?
      WHERE account_id = ? AND ${REV_GUARD}`)
      .bind(p.level, p.power, p.stageIdx, p.gold, p.gemsFree, p.gemsPaid, c.now, c.accountId, c.accountId, c.baseRev));
  }
  statements.push(db.prepare(`UPDATE account_docs SET doc = ?, rev = rev + 1, bytes = ?, updated_at = ?
    WHERE account_id = ? AND doc_name = 'core' AND rev = ?`).bind(c.doc, bytes, c.now, c.accountId, c.baseRev));
  let results: D1Result[];
  try { results = await db.batch(statements); }
  catch (error) {
    if (isConstraint(error, 'wallet_ledger.op_id')) return { ok: false, reason: 'duplicate' };
    throw error;
  }
  const changed = results[results.length - 1]?.meta?.changes ?? 0;
  return changed === 1 ? { ok: true, rev: c.baseRev + 1 } : { ok: false, reason: 'conflict' };
}

/** D1/SQLite 제약 위반 메시지 판별. 메시지 원문은 클라이언트로 보내지 않는다. */
export function isConstraint(error: unknown, column?: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed|PRIMARY KEY|constraint failed/i.test(message)) return false;
  return !column || message.includes(column);
}

export interface DocRow { rev: number; doc: string; updated_at: number }
export async function readDoc(db: D1Database, accountId: string): Promise<DocRow | null> {
  return db.prepare("SELECT rev, doc, updated_at FROM account_docs WHERE account_id = ? AND doc_name = 'core'").bind(accountId).first<DocRow>();
}
export async function ledgerReceipt(db: D1Database, opId: string, accountId: string): Promise<{ receipt: unknown; rev_after: number } | null> {
  const row = await db.prepare('SELECT receipt, rev_after, account_id FROM wallet_ledger WHERE op_id = ?').bind(opId)
    .first<{ receipt: string | null; rev_after: number; account_id: string }>();
  if (!row || row.account_id !== accountId) return null;
  return { receipt: row.receipt ? JSON.parse(row.receipt) : null, rev_after: row.rev_after };
}
