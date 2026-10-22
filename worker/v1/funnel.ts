// BM D11: 결제 퍼널 집계(설치 → 튜토리얼 완료 → 상점 → 결제 시트 → 결제 시작 → 첫 결제)와 결제율(월 결제자 ÷ MAU).
// 개인정보 최소: 계정 id(가명)·단계·서버 시각만 저장한다. 기기·IP·자유 문자열·클라이언트 시각은 저장하지 않는다.
// '첫 결제'는 클라이언트가 보낼 수 없다. 서버 영수증 검증 지급(iap.ts grantOnce)만 기록한다.
import { fail, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import type { D1Database } from './db';

const DAY = 86400000;
/** 클라이언트가 보고할 수 있는 단계(로컬 퍼널 이벤트 이름 → 서버 단계). */
export const CLIENT_STEPS: Readonly<Record<string, string>> = Object.freeze({
  first_run: 'install', tutorial_complete: 'tutorial_complete', shop_view: 'shop_view', paysheet_open: 'paysheet_open',
});
export const FUNNEL_STEPS = Object.freeze(['install', 'tutorial_complete', 'shop_view', 'paysheet_open', 'purchase_start', 'first_purchase']);
const MAX_EVENTS = 20;

const dayOf = (ms: number) => Math.floor(ms / DAY);

async function cohortDay(db: D1Database, accountId: string, now: number): Promise<number> {
  const row = await db.prepare('SELECT created_at FROM accounts WHERE account_id = ?').bind(accountId).first<{ created_at: number }>();
  return dayOf(row?.created_at ?? now);
}

/** 서버만 쓰는 단계(결제 시작). 최초 도달 시각만 남는다. */
export async function recordServerMilestone(db: D1Database, accountId: string, step: 'purchase_start' | 'first_purchase', now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO funnel_milestones(account_id, step, first_at, cohort_day) VALUES (?, ?, ?, ?)')
    .bind(accountId, step, now, await cohortDay(db, accountId, now)).run();
}

/** POST /api/v1/funnel {events:[name...]} — 단계 최초 도달과 오늘 활성만 기록한다. 같은 단계 반복은 무해(INSERT OR IGNORE). */
export async function ingestFunnel(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['events']);
  if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) fail(400, 'events');
  const steps = new Set<string>();
  for (const name of body.events) {
    if (typeof name !== 'string' || !Object.hasOwn(CLIENT_STEPS, name)) fail(400, 'event');
    steps.add(CLIENT_STEPS[name]);
  }
  const accountId = auth.account.account_id, cohort = await cohortDay(c.db, accountId, c.now);
  // 계정이 있으면 설치 단계는 계정 생성 시점에 이미 도달한 것으로 본다(앱 재설치·로컬 로그 초기화와 무관).
  steps.add('install');
  const statements = [...steps].map((step) => c.db.prepare('INSERT OR IGNORE INTO funnel_milestones(account_id, step, first_at, cohort_day) VALUES (?, ?, ?, ?)')
    .bind(accountId, step, c.now, cohort));
  statements.push(c.db.prepare('INSERT OR IGNORE INTO funnel_active(day, account_id) VALUES (?, ?)').bind(dayOf(c.now), accountId));
  await c.db.batch(statements);
  return { accepted: steps.size, serverTime: c.now };
}

export interface FunnelReport {
  fromDay: number; toDay: number;
  cohort: Record<string, number>;
  conversion: Record<string, number>;
  activeAccounts: number; payers: number; paymentRate: number; revenueKRW: number; target: number; meetsTarget: boolean;
}

/**
 * 기간 [fromDay, toDay](UTC 일) 보고서. cohort = 그 기간에 설치한 계정의 단계별 도달 수, conversion = 설치 대비 비율.
 * 결제율 = 기간 중 (테스트·역분개 제외) 지급이 있는 계정 ÷ 기간 중 활성 계정. 목표 1%.
 */
export async function funnelReport(db: D1Database, fromDay: number, toDay: number): Promise<FunnelReport> {
  const rows = await db.prepare('SELECT step, COUNT(*) AS n FROM funnel_milestones WHERE cohort_day BETWEEN ? AND ? GROUP BY step').bind(fromDay, toDay).all<{ step: string; n: number }>();
  const cohort: Record<string, number> = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0]));
  for (const r of rows.results ?? []) cohort[r.step] = r.n;
  const base = cohort.install || 0;
  const conversion = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, base ? cohort[s] / base : 0]));
  const from = fromDay * DAY, to = (toDay + 1) * DAY;
  const active = await db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM funnel_active WHERE day BETWEEN ? AND ?').bind(fromDay, toDay).first<{ n: number }>();
  const paid = await db.prepare(`SELECT COUNT(DISTINCT account_id) AS n, COALESCE(SUM(price_krw), 0) AS krw FROM iap_grants
    WHERE granted_at >= ? AND granted_at < ? AND reversed_at IS NULL AND price_krw > 0`).bind(from, to).first<{ n: number; krw: number }>();
  const activeAccounts = active?.n ?? 0, payers = paid?.n ?? 0;
  const paymentRate = activeAccounts ? payers / activeAccounts : 0;
  return { fromDay, toDay, cohort, conversion, activeAccounts, payers, paymentRate, revenueKRW: paid?.krw ?? 0, target: 0.01, meetsTarget: paymentRate >= 0.01 };
}
