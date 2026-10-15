#!/usr/bin/env node
// 종락 회랑 심층 QA 기준선 비교(BUNDLE-05 PLAN 5절 5번). 두 bellfall-deep-qa report.json 의 auto 실행을 비교한다.
// 판정(JSON 출력의 ok): 보스전 시간 비 ≤ 2.0, 완주 시간 비 ≤ 2.0, 보스방 첫 진입 프레임 draw call 증가 ≤ 3(짝 없으면 실패),
// 보스 구간 50ms 초과 수 ≤ 기준선 + 2, 같은 영웅·시드. 후보와 기준선은 같은 도구로 같은 --hero(기사) --seed 에서 돌린 report 여야 한다.
// 50ms 절대 검사는 각 report 의 검사가 그대로 판정한다(여기서 대신하거나 완화하지 않고, 아래 absolute50ms 보고 항목으로만 남긴다).
// 종 방 draw call(B04 기준)과 장막이 붙은 직후 draw call 은 gating 하지 않는 참고 항목(info)이다.
import fs from 'node:fs';
import { compareBoss, drawCallIncrease } from './bellfall-deep-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('candidate') || !arg('baseline')) {
  console.log('사용법: node tools/bellfall-deep-compare.mjs --candidate=<report.json> --baseline=<report.json> [--out=<json>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed, counterDefinition: !!report.counterDefinition, counterDetected: !!report.counterDetected,
    time: run.result?.win ? run.result.time : null, fight: run.boss?.defeated ? run.boss.fightSeconds : null, samples: run.summary?.samples || [],
    bossOver50: Number.isFinite(run.boss?.over50) ? run.boss.over50 : null, runOver50: run.metrics?.over50 ?? null, counterOk: run.counterAnalysis?.ok ?? null };
};
const cand = runOf(arg('candidate')), base = runOf(arg('baseline'));
const same = cand.heroId === base.heroId && cand.seed === base.seed;
const verdict = compareBoss(cand, base);
const pick = (run, ...labels) => run.samples.filter(s => labels.some(l => s.label === l || (l.endsWith('*') && s.label.startsWith(l.slice(0, -1)))));
const result = { candidate: { head: cand.head, status: cand.status, heroId: cand.heroId, counterDetected: cand.counterDetected, counterAnalysisOk: cand.counterOk },
  baseline: { head: base.head, status: base.status, heroId: base.heroId, counterDefinition: base.counterDefinition }, sameHeroSeed: same, ...verdict,
  absolute50ms: { note: '절대 검사는 각 report 의 검사가 판정한다. 여기는 보고 항목', candidateBoss: cand.bossOver50, baselineBoss: base.bossOver50, candidateRun: cand.runOver50, baselineRun: base.runOver50 },
  info: { bellRoomDraw: drawCallIncrease(pick(cand, 'enter:room*', 'firstDark'), pick(base, 'enter:room*', 'firstDark'), 12), bossReadyDraw: drawCallIncrease(pick(cand, 'bossReady'), pick(base, 'bossReady'), 3) } };
result.ok = verdict.ok && same;
const text = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), text + '\n', { flag: 'wx' });
console.log(text);
process.exit(result.ok ? 0 : 1);
