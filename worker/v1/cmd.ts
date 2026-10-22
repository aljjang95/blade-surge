// MMO P1-D: POST /api/v1/cmd 멱등 명령 실행, GET /api/v1/me 문서 조회 (docs/MMO_DESIGN.md 3.3).
import { casCommit, ledgerReceipt, readDoc, REV_GUARD, type D1Database, type GuardedWrite } from './db';
import { CID, fail, onlyKeys, isInt } from './http';
import { links, type Authed, type Ctx } from './auth';
import { docOf, loadEconomy } from './state';
import { validateOp } from '../../src/shared/v1-ops.js';
import { parityHash } from '../../src/shared/state-hash.js';

const HASH = /^[0-9a-z]{22}$/;

export async function loadAccountDoc(db: D1Database, accountId: string) {
  const row = await readDoc(db, accountId);
  if (!row) fail(404, 'no-doc');
  return { rev: row.rev, state: JSON.parse(row.doc) as Record<string, unknown> };
}

/** 그림자 모드 패리티 기록(클라이언트가 해시를 보냈을 때만). 같은 배치에서 rev 가드를 받는다. */
export function parityWrite(accountId: string, op: string, clientHash: string | undefined, serverHash: string, now: number): GuardedWrite[] {
  if (!clientHash) return [];
  return [{ sql: `INSERT INTO parity_log(account_id, op, client_hash, server_hash, match, at) SELECT ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`,
    values: [accountId, op, clientHash, serverHash, clientHash === serverHash ? 1 : 0, now] }];
}

export async function runCommand(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['cid', 'op', 'args', 'baseRev', 'clientHash'], ['cid', 'op', 'args']);
  if (typeof body.cid !== 'string' || !CID.test(body.cid)) fail(400, 'cid');
  if (body.baseRev !== undefined && !isInt(body.baseRev, 0)) fail(400, 'baseRev');
  if (body.clientHash !== undefined && (typeof body.clientHash !== 'string' || !HASH.test(body.clientHash))) fail(400, 'clientHash');
  const def = validateOp(body.op, body.args);
  if (!def) fail(400, 'op');
  const accountId = auth.account.account_id, opId = `cid:${accountId}:${body.cid}`;
  const replay = await ledgerReceipt(c.db, opId, accountId);
  if (replay) return { ...(replay.receipt as object), replayed: true };
  const doc = await loadAccountDoc(c.db, accountId);
  if (body.baseRev !== undefined && body.baseRev !== doc.rev) fail(409, 'stale', { rev: doc.rev });
  const eco = loadEconomy(doc.state, { now: c.now });
  const result = def.run(eco, ...(body.args as unknown[]));
  if (!def.ok(result)) fail(422, 'rejected', { op: body.op, reason: (result as { reason?: unknown })?.reason ?? eco.lastTrainingError ?? null, rev: doc.rev });
  const next = docOf(eco), parity = parityHash(eco.s);
  const receipt = { op: body.op, result: result ?? null, stateHash: parity, rev: doc.rev + 1, serverTime: c.now };
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId, kind: 'cmd:' + body.op, delta: { args: body.args }, receipt },
    projection: next.projection, writes: parityWrite(accountId, body.op as string, body.clientHash as string | undefined, parity, c.now) });
  if (!outcome.ok) {
    if (outcome.reason === 'duplicate') {
      const again = await ledgerReceipt(c.db, opId, accountId);
      if (again) return { ...(again.receipt as object), replayed: true };
    }
    fail(409, 'conflict');
  }
  return { ...receipt, doc: JSON.parse(next.text), match: body.clientHash === undefined ? null : body.clientHash === parity };
}

export async function getMe(c: Ctx, auth: Authed, flags: Record<string, boolean>) {
  const accountId = auth.account.account_id;
  const doc = await loadAccountDoc(c.db, accountId);
  // 조회는 쓰기 없이 서버 시계로 에너지만 계산해 보여 준다.
  const eco = loadEconomy(doc.state, { now: c.now });
  const legacy = await c.db.prepare('SELECT status, uploaded_at FROM legacy_saves WHERE account_id = ?').bind(accountId).first<{ status: string; uploaded_at: number }>();
  return {
    accountId, authority: auth.account.authority, status: auth.account.status, ageBand: auth.account.age_band,
    rev: doc.rev, doc: eco.snapshot(), stateHash: parityHash(eco.s), serverTime: c.now,
    linked: await links(c.db, accountId), legacy: legacy ? { status: legacy.status, uploadedAt: legacy.uploaded_at } : null, flags,
  };
}
