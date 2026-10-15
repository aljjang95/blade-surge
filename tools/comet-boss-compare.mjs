#!/usr/bin/env node
// 혜성 기사단장 보스전 푸른 궤도선 QA 기준선 비교(BUNDLE-06 PLAN 5절 5번). 두 comet-boss-qa report.json 의 auto 실행을 기계적으로 비교한다.
// 판정(JSON 출력의 ok): 같은 영웅·시드·depth, 보스전 시간 비 ≤ 2.0, 완주 시간 비 ≤ 2.0, 보스방 첫 진입 프레임(bossEnter) draw call 증가 ≤ 3,
// bossReady(보스 등장 연출이 풀린 다음 스텝) draw call 증가 ≤ 3(짝 없으면 실패), 보스 구간 50ms 초과 수 ≤ 기준선 + 2.
// 50ms 절대 검사는 각 report 의 보고 항목(reportItems.absolute50ms)이며 여기서 대신하거나 완화하지 않고 아래 absolute50ms 로만 남긴다.
// 기준선은 같은 도구를 --project=<기준선 워크트리> 로 같은 --hero --seed --depth 에서 돌린 report 여야 한다.
import fs from 'node:fs';
import { compareRuns } from './comet-boss-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('base') || !arg('cand')) {
  console.log('사용법: node tools/comet-boss-compare.mjs --base=<기준선 report.json> --cand=<후보 report.json> [--out=<새 json 경로>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed, depth: report.depth ?? null, orbitDefinition: !!report.orbitDefinition,
    orbitDetected: !!report.orbitDetected, time: run.result?.win ? run.result.time : null, fight: run.boss?.defeated ? run.boss.fightSeconds : null, samples: run.summary?.samples || [],
    bossOver50: Number.isFinite(run.boss?.over50) ? run.boss.over50 : null, runOver50: run.metrics?.over50ms ?? null, orbitOk: run.orbitAnalysis?.ok ?? null };
};
const cand = runOf(arg('cand')), base = runOf(arg('base'));
const same = { hero: cand.heroId === base.heroId, seed: cand.seed === base.seed, depth: cand.depth !== null && cand.depth === base.depth };
const sameHeroSeedDepth = same.hero && same.seed && same.depth;
const verdict = compareRuns(cand, base);
const result = { candidate: { head: cand.head, status: cand.status, heroId: cand.heroId, depth: cand.depth, orbitDetected: cand.orbitDetected, orbitAnalysisOk: cand.orbitOk },
  baseline: { head: base.head, status: base.status, heroId: base.heroId, depth: base.depth, orbitDefinition: base.orbitDefinition }, same, sameHeroSeedDepth, ...verdict,
  absolute50ms: { note: '절대 검사는 각 report 의 reportItems.absolute50ms 가 보고한다. 여기는 보고 항목', candidateBoss: cand.bossOver50, baselineBoss: base.bossOver50, candidateRun: cand.runOver50, baselineRun: base.runOver50 } };
result.ok = verdict.ok && sameHeroSeedDepth;
const text = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), text + '\n', { flag: 'wx' });
console.log(text);
process.exit(result.ok ? 0 : 1);
