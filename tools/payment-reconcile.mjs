#!/usr/bin/env node
// 일별 웹 결제 대사(읽기 전용): 서버 지급 장부(iap_web_payments) vs 포트원 결제 목록.
// 쓰기 SQL은 만들지 않는다. D1은 --print-sql 로 SELECT 만 출력해 운영자가 실행하고, 결과(JSON)를 --d1-json 으로 넘긴다.
// 포트원은 GET /payments 만 호출한다(키는 $APEX_CLOUD_URL/p/portone 프록시가 붙임). 개인정보·키는 출력하지 않는다.
//
// 사용:
//   node tools/payment-reconcile.mjs --print-sql [--date 2026-10-29]
//   wrangler d1 execute apex-rsi --remote --json --command "<위 SELECT>" > d1.json
//   node tools/payment-reconcile.mjs --d1-json d1.json [--date 2026-10-29] [--to 2026-10-30] [--portone-json p.json] [--include-test]
//   (--portone-json 이 없으면 APEX_CLOUD_URL 프록시로 GET /payments 를 조회한다)
// 종료 코드: 0 일치 · 2 차이 있음 · 1 입력/호출 오류
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KST_MS = 9 * 3600000;
const DAY_MS = 86400000;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** KST 날짜(YYYY-MM-DD) → 그날 00:00 KST 의 epoch ms. */
export function kstDayStart(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다');
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_MS;
}

/** 기본값: 어제(KST). from/to 는 포함 날짜. 반환 [fromMs, untilMs) */
export function kstRange(fromDate, toDate, now = Date.now()) {
  const todayKst = new Date(now + KST_MS).toISOString().slice(0, 10);
  const yesterday = new Date(kstDayStart(todayKst) - DAY_MS + KST_MS).toISOString().slice(0, 10);
  const from = fromDate || yesterday;
  const to = toDate || from;
  const fromMs = kstDayStart(from);
  const untilMs = kstDayStart(to) + DAY_MS;
  if (untilMs <= fromMs) throw new Error('--to 는 --date 와 같거나 뒤여야 합니다');
  return { from, to, fromMs, untilMs };
}

/** 운영자가 실행할 SELECT(읽기 전용). 숫자만 끼워 넣는다. */
export function buildSelectSql(fromMs, untilMs) {
  const a = Math.floor(Number(fromMs)), b = Math.floor(Number(untilMs));
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error('범위가 정수가 아닙니다');
  return `SELECT payment_id, product_id, amount_krw, state, test, created_at, granted_at, cancelled_at FROM iap_web_payments WHERE created_at >= ${a} AND created_at < ${b} ORDER BY created_at`;
}

/** wrangler d1 execute --json 출력(배열 또는 단일 객체) → 행 배열. */
export function parseD1Json(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  const blocks = Array.isArray(data) ? data : [data];
  const rows = [];
  for (const b of blocks) for (const r of b?.results ?? []) rows.push(r);
  return rows;
}

/** 포트원 GET /payments 응답 items → 비교용 형태. 필요한 필드만 남긴다(개인정보 제외). */
export function normalizePortone(items) {
  return (items || []).map((p) => ({
    id: String(p.id),
    status: String(p.status),
    total: Number(p.amount?.total) || 0,
    cancelled: Number(p.amount?.cancelled) || 0,
    test: p.channel?.type === 'TEST',
  }));
}

const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);

/**
 * 순수 비교. server: D1 행, portone: normalizePortone 결과.
 * kind: missing_on_portone · missing_on_server · amount_mismatch · cancel_not_reflected · cancelled_but_paid
 */
export function compare(server, portone, opts = {}) {
  const includeTest = !!opts.includeTest;
  const srv = server.filter((r) => includeTest || !Number(r.test));
  const pay = portone.filter((p) => includeTest || !p.test);
  const pById = new Map(pay.map((p) => [p.id, p]));
  const sById = new Map(srv.map((r) => [r.payment_id, r]));
  const diffs = [];
  let matched = 0;
  for (const r of srv) {
    const p = pById.get(r.payment_id);
    const sv = r.state, amt = Number(r.amount_krw) || 0;
    if (sv === 'intent' || sv === 'failed') {
      // 지급 전/실패 건: 포트원에서 PAID 면 돈은 받았는데 지급이 안 된 것.
      if (p && p.status === 'PAID') diffs.push({ kind: 'missing_on_server', paymentId: r.payment_id, server: sv, portone: p.status, serverAmount: amt, portoneAmount: p.total });
      continue;
    }
    if (!p) { diffs.push({ kind: 'missing_on_portone', paymentId: r.payment_id, server: sv, serverAmount: amt }); continue; }
    if (sv === 'granted') {
      if (p.status === 'CANCELLED' || p.status === 'PARTIAL_CANCELLED') diffs.push({ kind: 'cancel_not_reflected', paymentId: r.payment_id, server: sv, portone: p.status, serverAmount: amt, portoneAmount: p.total });
      else if (p.status !== 'PAID') diffs.push({ kind: 'missing_on_portone', paymentId: r.payment_id, server: sv, portone: p.status, serverAmount: amt });
      else if (p.total !== amt) diffs.push({ kind: 'amount_mismatch', paymentId: r.payment_id, server: sv, portone: p.status, serverAmount: amt, portoneAmount: p.total });
      else matched++;
    } else if (sv === 'cancelled') {
      if (p.status === 'PAID') diffs.push({ kind: 'cancelled_but_paid', paymentId: r.payment_id, server: sv, portone: p.status, serverAmount: amt, portoneAmount: p.total });
      else matched++;
    }
  }
  for (const p of pay) {
    if (sById.has(p.id)) continue;
    // 서버 장부에 없는 PAID 결제만 문제로 본다.
    if (p.status === 'PAID') diffs.push({ kind: 'missing_on_server', paymentId: p.id, server: null, portone: p.status, portoneAmount: p.total });
  }
  const totals = {
    serverGranted: sum(srv.filter((r) => r.state === 'granted'), (r) => Number(r.amount_krw) || 0),
    serverCancelled: sum(srv.filter((r) => r.state === 'cancelled'), (r) => Number(r.amount_krw) || 0),
    portonePaid: sum(pay.filter((p) => p.status === 'PAID'), (p) => p.total),
    portoneCancelled: sum(pay.filter((p) => p.status === 'CANCELLED' || p.status === 'PARTIAL_CANCELLED'), (p) => p.cancelled || p.total),
  };
  return { matched, diffs, totals, serverCount: srv.length, portoneCount: pay.length };
}

/** 포트원 GET /payments 한 페이지 요청 URL(requestBody 쿼리 파라미터 JSON). */
export function portoneListUrl(base, fromMs, untilMs, pageNumber, storeId) {
  const filter = { from: new Date(fromMs).toISOString(), until: new Date(untilMs).toISOString(), timestampType: 'CREATED_AT' };
  if (storeId) filter.storeId = storeId;
  const body = { page: { number: pageNumber, size: PAGE_SIZE }, filter };
  return `${base.replace(/\/$/, '')}/p/portone/payments?requestBody=${encodeURIComponent(JSON.stringify(body))}`;
}

async function fetchPortone(fromMs, untilMs) {
  const base = process.env.APEX_CLOUD_URL;
  if (!base) throw new Error('APEX_CLOUD_URL 이 없습니다(--portone-json 으로 파일을 넘길 수도 있습니다)');
  const items = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const res = await fetch(portoneListUrl(base, fromMs, untilMs, n, process.env.PORTONE_STORE_ID), { method: 'GET' });
    if (!res.ok) throw new Error(`포트원 목록 조회 실패 HTTP ${res.status}`);
    const data = await res.json();
    items.push(...(data.items || []));
    const total = Number(data.page?.totalCount) || 0;
    if (!data.items?.length || (n + 1) * PAGE_SIZE >= total) break;
  }
  return items;
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

async function main(argv) {
  const range = kstRange(arg(argv, '--date'), arg(argv, '--to'));
  if (argv.includes('--print-sql')) { console.log(buildSelectSql(range.fromMs, range.untilMs)); return 0; }
  const d1 = arg(argv, '--d1-json');
  if (!d1) throw new Error('--d1-json <파일> 또는 --print-sql 이 필요합니다');
  const server = parseD1Json(readFileSync(d1, 'utf8'));
  const pj = arg(argv, '--portone-json');
  const raw = pj ? JSON.parse(readFileSync(pj, 'utf8')) : { items: await fetchPortone(range.fromMs, range.untilMs) };
  const portone = normalizePortone(Array.isArray(raw) ? raw : raw.items);
  const r = compare(server, portone, { includeTest: argv.includes('--include-test') });
  console.log(`대사 범위(KST): ${range.from} ~ ${range.to}`);
  console.log(`서버 ${r.serverCount}건 / 포트원 ${r.portoneCount}건 / 일치 ${r.matched}건 / 차이 ${r.diffs.length}건`);
  console.log(`서버 지급 ₩${r.totals.serverGranted} · 서버 취소 ₩${r.totals.serverCancelled} · 포트원 PAID ₩${r.totals.portonePaid} · 포트원 취소 ₩${r.totals.portoneCancelled}`);
  for (const d of r.diffs) console.log(`  [${d.kind}] ${d.paymentId} 서버=${d.server ?? '-'}(₩${d.serverAmount ?? '-'}) 포트원=${d.portone ?? '-'}(₩${d.portoneAmount ?? '-'})`);
  return r.diffs.length ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`오류: ${e.message}`); process.exit(1); });
}
