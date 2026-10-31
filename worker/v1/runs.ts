// MMO P1-E: 런 티켓 발급·정산 (docs/MMO_DESIGN.md 3.4.2). T0 서버 발급 티켓·시계 + T1 개연성.
// 보상 실행 런은 티켓이 필수이며 정산은 티켓당 1회, 유효 2시간이다.
import { casCommit, ledgerReceipt, REV_GUARD, type GuardedWrite } from './db';
import { debtRepayment, overlayEntitlements } from './iap';
import { CID, fail, isId, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import { loadAccountDoc } from './cmd';
import { docOf, loadEconomy } from './state';
import { randomHex } from './token';
import { applySettlement, campaignStage, heroCombatProfile, parseStageCode, plausibility, validateFacts, RULES_VERSION } from '../../src/shared/settlement.js';
import { applyDifficulty, DIFFICULTIES } from '../../src/game/difficulty.js';
import { stageDef } from '../../src/data/stages.js';
import { hashValue, parityHash } from '../../src/shared/state-hash.js';
import { isChapterOpen } from '../../src/data/chapter-open.js';

export const TICKET_TTL_MS = 2 * 3600 * 1000;
export const MAX_OPEN_TICKETS = 5;
const uint32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

interface TicketRow {
  run_id: string; account_id: string; kind: string; content_id: string; difficulty: string; hero_id: string;
  seed: number; loot_seed: number; hero_hash: string; energy_spent: number; state: string;
  started_at: number; expires_at: number; settled_at: number | null; verdict: string | null; result: string | null;
}

export async function startRun(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['kind', 'contentId', 'difficulty', 'heroId', 'cid'], ['kind', 'contentId', 'heroId', 'cid']);
  if (typeof body.cid !== 'string' || !CID.test(body.cid)) fail(400, 'cid');
  if (body.kind !== 'campaign') fail(400, 'kind');
  if (!parseStageCode(body.contentId)) fail(400, 'content');
  if (!isId(body.heroId, 32)) fail(400, 'hero');
  if (body.difficulty !== undefined && !(typeof body.difficulty === 'string' && Object.hasOwn(DIFFICULTIES, body.difficulty))) fail(400, 'difficulty');
  const accountId = auth.account.account_id, opId = `start:${accountId}:${body.cid}`;
  const replay = await ledgerReceipt(c.db, opId, accountId);
  if (replay) return { ...(replay.receipt as object), replayed: true };
  const open = await c.db.prepare("SELECT COUNT(*) AS n FROM run_tickets WHERE account_id = ? AND state = 'open' AND expires_at > ?")
    .bind(accountId, c.now).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_TICKETS) fail(429, 'too-many-open');
  const doc = await loadAccountDoc(c.db, accountId);
  // 영웅 소유의 정본은 서버 권한 표다. 문서의 roster.paid를 권한으로 덮어쓴 뒤 소유를 확인한다(/cmd와 같은 방식).
  await overlayEntitlements(c.db, accountId, doc.state, c.now);
  const eco = loadEconomy(doc.state, { now: c.now });
  const stage = campaignStage(eco.s, body.contentId, (body.difficulty as string) ?? 'story');
  if (!stage || !eco.isUnlocked(stage.ch, stage.st)) fail(403, 'locked');
  // 시간 개방 지역은 진행도를 채워도 개방 시각 전에는 티켓을 주지 않는다(서버 시계만 쓴다).
  if (!isChapterOpen(stage.ch, c.now)) fail(403, 'chapter-closed');
  const heroId = body.heroId as string, profile = heroCombatProfile(eco, heroId);
  if (!profile) fail(403, 'hero');
  // 미소유 영웅으로는 티켓을 발급하지 않는다(해금 전 영웅으로 보상 판을 돌리는 우회 차단).
  if (!eco.ownHero(heroId)) fail(403, 'hero-locked');
  // 에너지는 서버 시계로만 계산한다. 기기 시계·요청 값은 들어가지 않는다.
  if (!eco.spendEnergy(stage.energy)) fail(409, 'energy', { energy: eco.s.energy, energyT: eco.s.energyT, need: stage.energy, serverTime: c.now });
  const runId = randomHex(16), seed = uint32(), lootSeed = uint32(), expiresAt = c.now + TICKET_TTL_MS;
  const heroHash = hashValue({ profile, equip: eco.hero(heroId).equip });
  const next = docOf(eco);
  const receipt = { runId, seed, lootSeed, expiresAt, serverTime: c.now, rulesVersion: RULES_VERSION, contentId: stage.code,
    difficulty: stage.difficultyId, heroId, energy: eco.s.energy, energyT: eco.s.energyT, energySpent: stage.energy, rev: doc.rev + 1 };
  const writes: GuardedWrite[] = [
    { sql: `UPDATE run_tickets SET state = 'expired' WHERE account_id = ? AND state = 'open' AND expires_at <= ? AND ${REV_GUARD}`, values: [accountId, c.now] },
    { sql: `INSERT INTO run_tickets(run_id, account_id, kind, content_id, difficulty, hero_id, seed, loot_seed, hero_hash, energy_spent, state, started_at, expires_at)
      SELECT ?, ?, 'campaign', ?, ?, ?, ?, ?, ?, ?, 'open', ?, ? WHERE ${REV_GUARD}`,
      values: [runId, accountId, stage.code, stage.difficultyId, heroId, seed, lootSeed, heroHash, stage.energy, c.now, expiresAt] },
  ];
  const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId, kind: 'run-start', delta: { energy: -stage.energy, runId }, receipt }, projection: next.projection, writes });
  if (!outcome.ok) {
    const again = outcome.reason === 'duplicate' ? await ledgerReceipt(c.db, opId, accountId) : null;
    if (again) return { ...(again.receipt as object), replayed: true };
    fail(409, 'conflict');
  }
  return receipt;
}

/** 계정당 감사 플래그 상한. 잘못된 정산을 반복 전송해 audit_flags를 부풀리는 남용을 막는다(상한 뒤에는 기록만 생략). */
export const AUDIT_FLAGS_PER_ACCOUNT = 200;
async function flag(c: Ctx, accountId: string, runId: string, kind: string, detail: unknown, severity = 1) {
  await c.db.prepare(`INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at)
    SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM audit_flags WHERE account_id = ?) < ?`)
    .bind(accountId, runId, kind, severity, JSON.stringify(detail).slice(0, 2000), c.now, accountId, AUDIT_FLAGS_PER_ACCOUNT).run();
}

export async function settleRun(c: Ctx, auth: Authed, runId: string, body: Record<string, unknown>) {
  const accountId = auth.account.account_id;
  const ticket = await c.db.prepare('SELECT * FROM run_tickets WHERE run_id = ?').bind(runId).first<TicketRow>();
  // 타인의 티켓과 없는 티켓은 같은 응답이다(존재 여부를 알려 주지 않는다).
  if (!ticket || ticket.account_id !== accountId) fail(404, 'ticket');
  if (ticket.state === 'settled' || ticket.state === 'rejected') {
    // 멱등: 같은 영수증만 다시 돌려준다(추가 지급 없음).
    return { ...(ticket.result ? JSON.parse(ticket.result) : {}), replayed: true };
  }
  if (ticket.state !== 'open') fail(410, 'expired');
  if (ticket.expires_at <= c.now) {
    await c.db.prepare("UPDATE run_tickets SET state = 'expired' WHERE run_id = ? AND state = 'open'").bind(runId).run();
    fail(410, 'expired');
  }
  const invalid = validateFacts(body);
  if (invalid) {
    await flag(c, accountId, runId, 'settle-schema', { invalid });
    fail(400, invalid === 'unknown-field' ? 'unknown-field' : 'schema', { field: invalid });
  }
  const facts = body as any;
  const doc = await loadAccountDoc(c.db, accountId);
  const eco = loadEconomy(doc.state, { now: c.now });
  const at = parseStageCode(ticket.content_id)!;
  const stage = applyDifficulty(stageDef(at.ch, at.st), (DIFFICULTIES as Record<string, unknown>)[ticket.difficulty] ?? DIFFICULTIES.story);
  if (!isChapterOpen(at.ch, c.now)) fail(403, 'chapter-closed');
  const profile = heroCombatProfile(eco, ticket.hero_id) ?? { atk: 1, maxHp: 1, level: 1 };
  const check = plausibility(stage, facts, { heroAtk: profile.atk, maxHp: profile.maxHp, wallMs: c.now - ticket.started_at });
  const outcome = applySettlement(eco, stage, { heroId: ticket.hero_id, lootSeed: ticket.loot_seed, wallMs: c.now - ticket.started_at,
    // 처치 원장은 서버 권위 계정만: 그림자 계정은 클라이언트가 티켓을 쓰지 않아 정산이 직접 API 호출뿐이고, 그 값이 컷오버까지 남는다(Codex 보안 리뷰 PR #435).
    killLedger: auth.account.authority === 'server' }, facts, check.verdict);
  // 결제 환불로 생긴 미상환 부채는 서버 정산 획득분에서 먼저 갚는다(같은 배치, 영수증에 상환량 표시).
  const debt = await debtRepayment(c.db, accountId, eco.s, c.now);
  const next = docOf(eco);
  const state = check.verdict === 'rejected' ? 'rejected' : 'settled';
  const receipt = { receiptId: runId, verdict: check.verdict, issues: check.issues, win: !!facts.win && check.verdict !== 'rejected',
    got: outcome.got, loot: outcome.loot, levelUps: outcome.ups, first: outcome.first, stars: outcome.stars ?? null, fullClear: outcome.fullClear ?? false, exp: outcome.exp, combatExp: outcome.combatExp,
    killLedger: outcome.killLedger ?? { kills: 0, species: 0, dropped: 0 },
    rev: doc.rev + 1, stateHash: parityHash(eco.s), serverTime: c.now, rulesVersion: RULES_VERSION,
    ...(Object.keys(debt.repaid).length ? { debtRepaid: debt.repaid } : {}) };
  const writes: GuardedWrite[] = [
    ...debt.writes,
    { sql: `UPDATE run_tickets SET state = ?, settled_at = ?, verdict = ?, result = ? WHERE run_id = ? AND state = 'open' AND ${REV_GUARD}`,
      values: [state, c.now, check.verdict, JSON.stringify(receipt), runId] },
  ];
  if (check.verdict !== 'ok') writes.push({ sql: `INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) SELECT ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`,
    values: [accountId, runId, 'settle-' + check.verdict, check.verdict === 'rejected' ? 2 : 1, JSON.stringify(check.issues), c.now] });
  const result = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId: 'run:' + runId, kind: 'run-settle', delta: { verdict: check.verdict, got: outcome.got, loot: outcome.loot, killLedger: outcome.killLedger ?? null }, receipt },
    projection: next.projection, writes });
  if (!result.ok) {
    if (result.reason === 'duplicate') {
      const row = await c.db.prepare('SELECT result FROM run_tickets WHERE run_id = ?').bind(runId).first<{ result: string | null }>();
      if (row?.result) return { ...JSON.parse(row.result), replayed: true };
    }
    fail(409, 'conflict');
  }
  return { ...receipt, doc: JSON.parse(next.text) };
}
