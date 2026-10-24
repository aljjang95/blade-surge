import { afterEach, describe, expect, test } from 'bun:test';
import { applyMigrations, casCommit, ledgerReceipt, readDoc, schemaReady, splitSql, REV_GUARD, DOC_LIMIT } from '../worker/v1/db';
import { createD1, migratedD1, migrationTexts, type ShimD1 } from './helpers/d1-shim';

const ACCOUNT = 'p_' + 'a'.repeat(24);
const dbs: ShimD1[] = [];
afterEach(() => { while (dbs.length) dbs.pop()!.close(); });

async function seeded() {
  const db = await migratedD1(); dbs.push(db);
  db.sqlite.query("INSERT INTO accounts(account_id, created_at, last_seen, channel_first) VALUES (?, 1, 1, 'web')").run(ACCOUNT);
  db.sqlite.query("INSERT INTO account_docs(account_id, doc_name, rev, doc, bytes, updated_at) VALUES (?, 'core', 1, '{}', 2, 1)").run(ACCOUNT);
  return db;
}

describe('MMO P1-A D1 기반', () => {
  test('마이그레이션은 재적용해도 무해하고 스키마 버전을 남긴다', async () => {
    const db = createD1(); dbs.push(db);
    expect(await schemaReady(db)).toBe(false);
    expect(await applyMigrations(db, migrationTexts(), 100)).toBe(4);
    db.sqlite.query("INSERT INTO accounts(account_id, created_at, last_seen, channel_first) VALUES (?, 1, 1, 'web')").run(ACCOUNT);
    expect(await applyMigrations(db, migrationTexts(), 200)).toBe(4);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
    expect(db.sqlite.query('SELECT applied_at FROM v1_schema').get()).toEqual({ applied_at: 100 });
    expect(await schemaReady(db)).toBe(true);
  });

  test('SQL 분리기는 주석과 여러 줄 문장을 처리한다', () => {
    expect(splitSql('-- a;\nCREATE TABLE x (\n a INTEGER -- b;\n);\nINSERT INTO x VALUES (1);')).toEqual(['CREATE TABLE x (\n a INTEGER \n)', 'INSERT INTO x VALUES (1)']);
  });

  test('계정 id·키 해시 형식은 DB 제약으로도 막힌다', async () => {
    const db = await migratedD1(); dbs.push(db);
    expect(() => db.sqlite.query("INSERT INTO accounts(account_id, created_at, last_seen, channel_first) VALUES ('evil', 1, 1, 'web')").run()).toThrow();
    expect(() => db.sqlite.query("INSERT INTO account_keys VALUES ('short', ?, 1, 1)").run(ACCOUNT)).toThrow();
  });

  test('CAS: 같은 base rev 동시 2회 중 1회만 반영된다', async () => {
    const db = await seeded();
    const commit = (n: number) => casCommit(db, { accountId: ACCOUNT, baseRev: 1, doc: JSON.stringify({ n }), now: 10 + n,
      ledger: { opId: `cid:${ACCOUNT}:op-${n}`, kind: 'cmd', delta: { n } }, projection: { level: n, power: 0, stageIdx: 1, gold: n, gemsFree: 0, gemsPaid: 0 } });
    const [a, b] = await Promise.all([commit(1), commit(2)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((a.ok ? b : a)).toEqual({ ok: false, reason: 'conflict' });
    const doc = await readDoc(db, ACCOUNT);
    expect(doc?.rev).toBe(2);
    const winner = a.ok ? 1 : 2;
    expect(JSON.parse(doc!.doc)).toEqual({ n: winner });
    // 진 쪽의 원장·투영은 남지 않는다.
    expect(db.sqlite.query('SELECT op_id FROM wallet_ledger').all()).toEqual([{ op_id: `cid:${ACCOUNT}:op-${winner}` }]);
    expect(db.sqlite.query('SELECT gold FROM accounts').get()).toEqual({ gold: winner });
  });

  test('CAS: 원장 op_id 중복이면 배치 전체가 롤백된다(멱등)', async () => {
    const db = await seeded();
    const opId = `cid:${ACCOUNT}:same`;
    const first = await casCommit(db, { accountId: ACCOUNT, baseRev: 1, doc: '{"a":1}', now: 5, ledger: { opId, kind: 'cmd', delta: 1, receipt: { got: 1 } } });
    expect(first).toEqual({ ok: true, rev: 2 });
    const again = await casCommit(db, { accountId: ACCOUNT, baseRev: 2, doc: '{"a":2}', now: 6, ledger: { opId, kind: 'cmd', delta: 1 },
      writes: [{ sql: `INSERT INTO audit_flags(account_id, kind, severity, detail, at) SELECT 'x', 'k', 1, 'd', 1 WHERE ${REV_GUARD}`, values: [] }] });
    expect(again).toEqual({ ok: false, reason: 'duplicate' });
    expect((await readDoc(db, ACCOUNT))!.doc).toBe('{"a":1}');
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM audit_flags').get()).toEqual({ n: 0 });
    expect(await ledgerReceipt(db, opId, ACCOUNT)).toEqual({ receipt: { got: 1 }, rev_after: 2 });
    expect(await ledgerReceipt(db, opId, 'p_' + 'b'.repeat(24))).toBeNull();
  });

  test('CAS: 낡은 rev의 부가 쓰기도 함께 무시된다', async () => {
    const db = await seeded();
    const out = await casCommit(db, { accountId: ACCOUNT, baseRev: 7, doc: '{}', now: 5, ledger: { opId: 'x', kind: 'cmd', delta: null },
      writes: [{ sql: `INSERT INTO audit_flags(account_id, kind, severity, detail, at) SELECT 'x', 'k', 1, 'd', 1 WHERE ${REV_GUARD}`, values: [] }] });
    expect(out).toEqual({ ok: false, reason: 'conflict' });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM audit_flags').get()).toEqual({ n: 0 });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM wallet_ledger').get()).toEqual({ n: 0 });
  });

  test('문서 256KB 상한', async () => {
    const db = await seeded();
    await expect(casCommit(db, { accountId: ACCOUNT, baseRev: 1, doc: 'x'.repeat(DOC_LIMIT + 1), now: 1, ledger: { opId: 'big', kind: 'cmd', delta: null } }))
      .rejects.toThrow('doc-too-large');
    expect(() => db.sqlite.query("UPDATE account_docs SET bytes = 262145").run()).toThrow();
  });
});
