// MMO P1-G: 로컬 세이브 → 서버 계정 이전 (docs/MMO_DESIGN.md 4장). 원문은 legacy_saves에 보존하고
// 정화(normalizeSave 재사용 + 재화 상한 절삭)한 문서만 account_docs.core가 된다. 로컬 세이브는 지우지 않는다.
import { casCommit, ledgerReceipt, REV_GUARD, type GuardedWrite } from './db';
import { CID, fail, onlyKeys } from './http';
import { socialCreatedAt, type Authed, type Ctx } from './auth';
import { loadAccountDoc } from './cmd';
import { docOf, loadEconomy } from './state';
import { sha256Hex } from './token';
import { sanitizeLegacySave } from '../../src/shared/legacy-sanitize.js';
import { parityHash } from '../../src/shared/state-hash.js';
import { entitlementsOf, iapAllowance, iapSchemaReady } from './iap';
import { HERO_LEGACY_COMPENSATION, HERO_POLICY } from '../../src/data/hero-roster.js';

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOLD_MS = 30 * 24 * 3600 * 1000;

/** 서버가 지급한 유료 보상만큼 정화 상한을 넓히고, 유효한 결제 권한(패스 프리미엄 수령 기록·월정액 수령일)은 보존한다. */
async function paidContext(c: Ctx, accountId: string, serverState?: Record<string, any>) {
  // 서버 문서의 roster는 신뢰값이다(정책 1은 이 값에서만 유지된다). 결제 스키마와 무관하게 항상 준다.
  // 소환 상태(마일리지·픽업 확정·초보자 횟수)와 유료 보석 몫도 서버 문서 값만 믿는다(가져오기로 위조 금지, BM 12장).
  const hero = { serverRoster: serverState?.roster as Record<string, unknown> | undefined, serverGacha: serverState?.gacha as Record<string, unknown> | undefined,
    serverPaidGems: Number(serverState?.paidGems) || 0,
    // 진행도 바닥값: 서버 문서가 이미 가진 진행(서버 정산·이전 정화 결과). 가져오기 원본은 이보다 낮게는 깎이지 않는다.
    serverProgress: serverState?.progress as Record<string, unknown> | undefined, serverEndgame: serverState?.endgame as Record<string, unknown> | undefined, serverGearDex: serverState?.gearDex };
  if (!await iapSchemaReady(c.db)) return hero;
  const e = await entitlementsOf(c.db, accountId, c.now);
  return { ...hero, allowance: await iapAllowance(c.db, accountId), entitled: { passPremium: e.passPremium, monthlyUntil: e.monthlyUntil, heroes: e.heroes } };
}
/**
 * 서버 기록만으로 만든 저장 나이와 기존 이용자 증거(BM_DESIGN 11.6-1).
 * - createdAt(정화 상한의 경과일 기준) = 서버 계정 생성 시각과 소셜 프로필 생성 시각 중 이른 쪽. 클라이언트 세이브의 created는 쓰지 않는다.
 * - legacyProof = 소셜 프로필 생성 시각(서버 기록). 정책 1 판정은 sanitize의 trustedRoster가 HERO_STARTER_POLICY_SINCE와 비교한다.
 * - 허브는 가져오기 때 한 번만 부르고 그 값(socialAt)을 legacy_saves.report에 남긴다. 그림자 스냅샷은 저장값을 재사용한다
 *   (스냅샷마다 전역 허브 왕복을 피하고, 같은 경과일 기준을 유지해 스냅샷이 재화를 다시 깎지 않게 한다).
 *   컷오버 뒤에 만든 프로필은 어차피 정책 1 증거가 아니므로 가져오기 뒤 생긴 프로필을 다시 조회할 필요가 없다.
 */
async function serverAge(c: Ctx, accountId: string, stored?: number | null) {
  const row = await c.db.prepare('SELECT created_at FROM accounts WHERE account_id = ?').bind(accountId).first<{ created_at: number }>();
  const account = row?.created_at ?? c.now;
  const social = stored !== undefined ? stored : await socialCreatedAt(c.env, accountId);
  return { socialAt: social, createdAt: social !== null ? Math.min(account, social) : account, legacyProof: social !== null ? { source: 'social-profile', at: social } : null };
}
/** 증거 없이 정책 1을 주장한 저장이 서버 정본이 될 때 주는 1회 보상(원장 op_id로 계정당 한 번). */
export const LEGACY_COMP_OP = (accountId: string) => 'legacy-comp:' + accountId;
function grantCompensation(eco: any) {
  for (const [key, n] of Object.entries(HERO_LEGACY_COMPENSATION)) eco.s[key] = (Number(eco.s[key]) || 0) + n;
  return { ...HERO_LEGACY_COMPENSATION };
}

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
  const age = await serverAge(c, accountId);
  const result = sanitizeLegacySave(body.save, { now: c.now, createdAt: age.createdAt, legacyProof: age.legacyProof, ...await paidContext(c, accountId, doc.state) });
  // 서버에서 이미 진행한 계정(rev>1: 명령·정산 이력)은 덮어쓰지 않는다. 원문만 'rejected'로 보관한다.
  const untouched = doc.rev === 1;
  const status = !result.ok ? 'rejected' : untouched ? (auth.account.authority === 'server' ? 'imported' : 'shadow') : 'rejected';
  const report: Record<string, unknown> = { ...result.report, status, reason: !result.ok ? result.reason : untouched ? null : 'account-has-progress', socialAt: age.socialAt };
  let eco = loadEconomy(doc.state, { now: c.now });
  if (status !== 'rejected' && result.ok) eco = loadEconomy(result.state, { now: c.now });
  // 서버 권위 계정은 가져오기 결과가 곧 정본이다. 증거 없는 정책 1 주장이면 여기서 보상한다(그림자 계정은 컷오버 때 settleLegacyCompensation).
  if (status === 'imported' && result.ok && result.report.roster.legacyClaim) report.compensation = grantCompensation(eco);
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
  // 임포트가 먼저다: 정화 기준이 되는 원문·상태가 없는 계정의 그림자 스냅샷은 재화를 마음대로 깎을 수 있으므로 거부한다.
  const imported = await c.db.prepare('SELECT status, report FROM legacy_saves WHERE account_id = ?').bind(accountId).first<{ status: string; report: string | null }>();
  if (!imported || (imported.status !== 'shadow' && imported.status !== 'imported')) fail(409, 'import-required');
  const doc = await loadAccountDoc(c.db, accountId);
  // 가져오기 때 서버가 조회해 둔 소셜 시각을 재사용한다(이 PR 이전 가져오기 행에는 없으므로 그때만 허브를 부른다).
  const storedAt = (JSON.parse(imported.report || '{}') as { socialAt?: unknown }).socialAt;
  const age = await serverAge(c, accountId, storedAt === null || Number.isSafeInteger(storedAt) ? storedAt as number | null : undefined);
  const result = sanitizeLegacySave(body.save, { now: c.now, createdAt: age.createdAt, legacyProof: age.legacyProof, ...await paidContext(c, accountId, doc.state) });
  if (!result.ok) fail(400, 'save');
  const eco = loadEconomy(result.state, { now: c.now });
  const next = docOf(eco), hash = parityHash(eco.s);
  const receipt = { rev: doc.rev + 1, stateHash: hash, clamped: result.report.clamped, match: body.clientHash === undefined ? null : body.clientHash === hash, serverTime: c.now };
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId, kind: 'shadow-snapshot', delta: { clamped: result.report.clamped }, receipt }, projection: next.projection,
    writes: body.clientHash === undefined ? [] : [{ sql: `INSERT INTO parity_log(account_id, op, client_hash, server_hash, match, at) SELECT ?, 'snapshot', ?, ?, ?, ? WHERE ${REV_GUARD}`,
      values: [accountId, body.clientHash as string, hash, body.clientHash === hash ? 1 : 0, c.now] }] });
  if (!outcome.ok) fail(409, 'conflict');
  return receipt;
}

/**
 * 그림자 → 서버 권위 컷오버 뒤 첫 세션에서 한 번: 가져오기 원본이 정책 1을 주장했지만 서버 증거가 없어 정책 2가 된 계정에
 * HERO_LEGACY_COMPENSATION을 준다. 서버 문서가 정책 1(증거가 뒤늦게 확인됨)이거나 가져오기에서 이미 보상했으면 주지 않는다.
 * 원장 op_id(legacy-comp:<계정>)가 유일해서 동시 세션·재시도에도 한 번만 커밋된다.
 */
export async function settleLegacyCompensation(c: Ctx, accountId: string): Promise<{ tickets: number } | null> {
  const legacy = await c.db.prepare('SELECT status, report FROM legacy_saves WHERE account_id = ?').bind(accountId).first<{ status: string; report: string }>();
  if (!legacy || (legacy.status !== 'shadow' && legacy.status !== 'imported')) return null;
  const report = JSON.parse(legacy.report || '{}');
  if (report?.roster?.legacyClaim !== true || report.compensation) return null;
  if (await ledgerReceipt(c.db, LEGACY_COMP_OP(accountId), accountId)) return null;
  const doc = await loadAccountDoc(c.db, accountId);
  if ((doc.state as Record<string, any> | undefined)?.roster?.policy === HERO_POLICY.LEGACY) return null;
  const eco = loadEconomy(doc.state, { now: c.now });
  const granted = grantCompensation(eco);
  const next = docOf(eco);
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId: LEGACY_COMP_OP(accountId), kind: 'legacy-compensation', delta: granted, receipt: granted }, projection: next.projection });
  return outcome.ok ? granted : null;
}
