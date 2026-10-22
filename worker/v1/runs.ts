// MMO P1-E: 런 티켓 발급·정산 (docs/MMO_DESIGN.md 3.4.2). T0 서버 발급 티켓·시계 + T1 개연성.
// 보상 실행 런은 티켓이 필수이며 정산은 티켓당 1회, 유효 2시간이다.
import { casCommit, ledgerReceipt, REV_GUARD, type GuardedWrite } from './db';
import { CID, fail, isId, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import { loadAccountDoc } from './cmd';
import { docOf, loadEconomy } from './state';
import { randomHex } from './token';
import { applySettlement, campaignStage, heroCombatProfile, parseStageCode, plausibility, validateFacts, RULES_VERSION } from '../../src/shared/settlement.js';
import { applyDifficulty, DIFFICULTIES } from '../../src/game/difficulty.js';
import { stageDef } from '../../src/data/stages.js';
import { hashValue, parityHash } from '../../src/shared/state-hash.js';

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
  const eco = loadEconomy(doc.state, { now: c.now });
  const stage = campaignStage(eco.s, body.contentId, (body.difficulty as string) ?? 'story');
  if (!stage || !eco.isUnlocked(stage.ch, stage.st)) fail(403, 'locked');
  const heroId = body.heroId as string, profile = heroCombatProfile(eco, heroId);
  if (!profile) fail(403, 'hero');
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

async function flag(c: Ctx, accountId: string, runId: string, kind: string, detail: unknown, severity = 1) {
  await c.db.prepare('INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(accountId, runId, kind, severity, JSON.stringify(detail).slice(0, 2000), c.now).run();
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
  const profile = heroCombatProfile(eco, ticket.hero_id) ?? { atk: 1, maxHp: 1, level: 1 };
  const check = plausibility(stage, facts, { heroAtk: profile.atk, maxHp: profile.maxHp, wallMs: c.now - ticket.started_at });
  const outcome = applySettlement(eco, stage, { heroId: ticket.hero_id, lootSeed: ticket.loot_seed }, facts, check.verdict);
  const next = docOf(eco);
  const state = check.verdict === 'rejected' ? 'rejected' : 'settled';
  const receipt = { receiptId: runId, verdict: check.verdict, issues: check.issues, win: !!facts.win && check.verdict !== 'rejected',
    got: outcome.got, loot: outcome.loot, levelUps: outcome.ups, first: outcome.first, exp: outcome.exp, combatExp: outcome.combatExp,
    rev: doc.rev + 1, stateHash: parityHash(eco.s), serverTime: c.now, rulesVersion: RULES_VERSION };
  const writes: GuardedWrite[] = [
    { sql: `UPDATE run_tickets SET state = ?, settled_at = ?, verdict = ?, result = ? WHERE run_id = ? AND state = 'open' AND ${REV_GUARD}`,
      values: [state, c.now, check.verdict, JSON.stringify(receipt), runId] },
  ];
  if (check.verdict !== 'ok') writes.push({ sql: `INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) SELECT ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`,
    values: [accountId, runId, 'settle-' + check.verdict, check.verdict === 'rejected' ? 2 : 1, JSON.stringify(check.issues), c.now] });
  const result = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
    ledger: { opId: 'run:' + runId, kind: 'run-settle', delta: { verdict: check.verdict, got: outcome.got, loot: outcome.loot }, receipt },
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
