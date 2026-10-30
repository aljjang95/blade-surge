#!/usr/bin/env bun
// 마라톤 7일 현상금 의뢰 단위 표(플레이타임 장부용). simulate('marathon', 시드 0..15, {days: 7}) 중앙값을 JSON 으로 낸다.
//   사용: bun tools/playtime-bounty-units.mjs   → stdout + work/playtime/inventory/bounty-units.json (결정적, sha256 포함)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulate } from './sim-90d.mjs';

const SEEDS = 16, DAYS = 7;
const p50 = (v) => { const a = v.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(.5 * (a.length - 1) + .5))] : null; };
const runs = Array.from({ length: SEEDS }, (_, seed) => simulate('marathon', seed, { days: DAYS }));
const MIN_PER_DAY = 480;

const daily = Array.from({ length: DAYS }, (_, i) => {
  const f = (k) => p50(runs.map((r) => r.days[i][k]));
  return { day: i + 1, bountyMin: f('bountyMin'), bountyDone: f('bountyDone'), hunterRank: f('hunterRank'), starvedMin: f('starvedMin') };
});
const maxRank = Math.max(1, ...runs.flatMap((r) => r.bountyLog.map((x) => x.rank)));
const rankUps = [];
for (let rank = 2; rank <= maxRank; rank++) {
  const hits = runs.map((r) => r.bountyLog.find((x) => x.rank === rank)).map((h) => h ? { day: h.day, minuteOfDay: h.minuteOfDay, cumulativeMin: (h.day - 1) * MIN_PER_DAY + h.minuteOfDay } : null);
  rankUps.push({ rank, reached: hits.filter(Boolean).length, day: p50(hits.map((h) => h?.day ?? null)), minuteOfDay: p50(hits.map((h) => h?.minuteOfDay ?? null)), cumulativeMin: p50(hits.map((h) => h?.cumulativeMin ?? null)) });
}
const body = { persona: 'marathon', seeds: SEEDS, days: DAYS, stat: 'p50', daily, rankUps };
const sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
const out = JSON.stringify({ ...body, sha256 }, null, 2);
mkdirSync('work/playtime/inventory', { recursive: true });
writeFileSync('work/playtime/inventory/bounty-units.json', out + '\n');
console.log(out);
