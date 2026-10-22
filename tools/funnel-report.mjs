#!/usr/bin/env node
// BM D11 결제 퍼널 보고서 SQL. worker/v1/funnel.ts funnelReport와 같은 식이다.
// 사용: node tools/funnel-report.mjs [--days 30]  → D1 콘솔 또는
//   apex cf -- npx wrangler d1 execute blade-surge-commerce-production --remote --command "<출력 SQL>"
// 운영 DB에 쓰지 않는다(SELECT만). 결과에는 계정 id가 나오지 않는다(집계만).
const DAY = 86400000;
const arg = process.argv.indexOf('--days');
const days = Math.max(1, Math.min(365, Number(arg > 0 ? process.argv[arg + 1] : 30) || 30));
const toDay = Math.floor(Date.now() / DAY), fromDay = toDay - days + 1;

const queries = {
  cohort: `SELECT step, COUNT(*) AS accounts FROM funnel_milestones WHERE cohort_day BETWEEN ${fromDay} AND ${toDay} GROUP BY step ORDER BY accounts DESC;`,
  active: `SELECT COUNT(DISTINCT account_id) AS active_accounts FROM funnel_active WHERE day BETWEEN ${fromDay} AND ${toDay};`,
  payers: `SELECT COUNT(DISTINCT account_id) AS payers, COALESCE(SUM(price_krw), 0) AS revenue_krw FROM iap_grants WHERE granted_at >= ${fromDay * DAY} AND granted_at < ${(toDay + 1) * DAY} AND reversed_at IS NULL AND price_krw > 0;`,
  products: `SELECT product_id, COUNT(*) AS grants, SUM(CASE WHEN reversed_at IS NULL THEN 0 ELSE 1 END) AS reversed FROM iap_grants WHERE granted_at >= ${fromDay * DAY} GROUP BY product_id;`,
};
console.log(`# 결제 퍼널 ${days}일 (UTC 일 ${fromDay}~${toDay}). 결제율 = payers ÷ active_accounts, 목표 1%.`);
for (const [name, sql] of Object.entries(queries)) console.log(`\n-- ${name}\n${sql}`);
