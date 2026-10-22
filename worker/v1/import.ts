// MMO P1-G: 로컬 세이브 → 서버 계정 이전 (docs/MMO_DESIGN.md 4장). 원문은 legacy_saves에 보존하고
// 정화(normalizeSave 재사용 + 재화 상한 절삭)한 문서만 account_docs.core가 된다. 로컬 세이브는 지우지 않는다.
import { casCommit, ledgerReceipt, REV_GUARD, type GuardedWrite } from './db';
import { CID, fail, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import { loadAccountDoc } from './cmd';
import { docOf, loadEconomy } from './state';
import { sha256Hex } from './token';
import { sanitizeLegacySave } from '../../src/shared/legacy-sanitize.js';
import { parityHash } from '../../src/shared/state-hash.js';

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOLD_MS = 30 * 24 * 3600 * 1000;

export async function importLegacy(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['installId', 'save', 'clientHash'], ['installId', 'save']);
  if (typeof body.installId !== 'string' || !INSTALL_ID.test(body.installId)) fail(400, 'install-id');
  if (!body.save || typeof body.save !== 'object' || Array.isArray(body.save)) fail(400, 'save');
  const accountId = auth.account.account_id;
  const legacyId = await sha256Hex('legacy:' + body.installId);
  const prior = await c.db.prepare('SELECT legacy_id, account_id, status FROM legacy_saves WHERE legacy_id = ? OR account_id = ?')
    .bind(legacyId, accountId).first<{ legacy_id: string; account_id: string; status: string }>();
  // 같은 설치는 한 번만, 한 계정도 한 번만 임포트한다(계정 중복 이득 차단).
  if (prior) fail(409, prior.account_id === accountId ? 'already-imported' : 'install-imported', { status: prior.status });
  const doc = await loadAccountDoc(c.db, accountId);
  const raw = JSON.stringify(body.save);
  const result = sanitizeLegacySave(body.save, { now: c.now });
  // 서버에서 이미 진행한 계정(rev>1: 명령·정산 이력)은 덮어쓰지 않는다. 원문만 'rejected'로 보관한다.
  const untouched = doc.rev === 1;
  const status = !result.ok ? 'rejected' : untouched ? (auth.account.authority === 'server' ? 'imported' : 'shadow') : 'rejected';
  const report = { ...result.report, status, reason: !result.ok ? result.reason : untouched ? null : 'account-has-progress' };
  const writes: GuardedWrite[] = [{
    sql: `INSERT INTO legacy_saves(legacy_id, account_id, uploaded_at, doc, report, status) SELECT ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`,
    values: [legacyId, accountId, c.now, raw, JSON.stringify(report), status],
  }];
  if (result.ok && result.report.severe) {
    writes.push({ sql: `INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) SELECT ?, NULL, 'import-clamped', 2, ?, ? WHERE ${REV_GUARD}`,
      values: [accountId, JSON.stringify(result.report.clamped).slice(0, 2000), c.now] });
    writes.push({ sql: `INSERT INTO sanctions(account_id, kind, until, reason, by, at) SELECT ?, 'payout_hold', ?, 'import-clamped', 'system', ? WHERE ${REV_GUARD}`,
      values: [accountId, c.now + HOLD_MS, c.now] });
  }
  let eco = loadEconomy(doc.state, { now: c.now });
  if (status !== 'rejected' && result.ok) eco = loadEconomy(result.state, { now: c.now });
  const next = docOf(eco);
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId: 'import:' + legacyId, kind: 'import', delta: { status, clamped: result.ok ? result.report.clamped : null }, receipt: { status } },
    projection: next.projection, writes });
  if (!outcome.ok) fail(409, outcome.reason === 'duplicate' ? 'install-imported' : 'conflict');
  return { status, report, rev: outcome.rev, doc: JSON.parse(next.text), stateHash: parityHash(eco.s), clientMatch: body.clientHash === undefined ? null : body.clientHash === parityHash(eco.s), serverTime: c.now };
}

/**
 * 그림자 모드(M1) 재동기화: 로컬이 정본인 동안 전투 보상처럼 명령 밖에서 바뀐 상태를 서버 그림자 문서로 맞춘다.
 * 임포트와 같은 정화 규칙을 적용하므로 컷오버 때 넘어가는 값도 같은 상한 안이다. 서버 권위 계정은 거부한다.
 */
export async function shadowSnapshot(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['cid', 'save', 'clientHash'], ['cid', 'save']);
  if (typeof body.cid !== 'string' || !CID.test(body.cid)) fail(400, 'cid');
  if (auth.account.authority !== 'shadow') fail(409, 'server-authority');
  if (!body.save || typeof body.save !== 'object' || Array.isArray(body.save)) fail(400, 'save');
  const accountId = auth.account.account_id, opId = `snap:${accountId}:${body.cid}`;
  const replay = await ledgerReceipt(c.db, opId, accountId);
  if (replay) return { ...(replay.receipt as object), replayed: true };
  const doc = await loadAccountDoc(c.db, accountId);
  const result = sanitizeLegacySave(body.save, { now: c.now });
  if (!result.ok) fail(400, 'save');
  // 상한 계산의 경과일은 서버가 처음 본 문서의 created를 기준으로 한다(로컬 created 조작 무효).
  const created = Number((doc.state as { created?: unknown }).created);
  const eco = loadEconomy({ ...result.state, created: Number.isSafeInteger(created) ? created : result.state.created }, { now: c.now });
  const next = docOf(eco), hash = parityHash(eco.s);
  const receipt = { rev: doc.rev + 1, stateHash: hash, clamped: result.report.clamped, match: body.clientHash === undefined ? null : body.clientHash === hash, serverTime: c.now };
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId, kind: 'shadow-snapshot', delta: { clamped: result.report.clamped }, receipt }, projection: next.projection,
    writes: body.clientHash === undefined ? [] : [{ sql: `INSERT INTO parity_log(account_id, op, client_hash, server_hash, match, at) SELECT ?, 'snapshot', ?, ?, ?, ? WHERE ${REV_GUARD}`,
      values: [accountId, body.clientHash as string, hash, body.clientHash === hash ? 1 : 0, c.now] }] });
  if (!outcome.ok) fail(409, 'conflict');
  return receipt;
}
