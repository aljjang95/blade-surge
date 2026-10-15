#!/usr/bin/env node
// 녹청 성역 심층 제단·수로 QA 기준선 비교(BUNDLE-11 PLAN 5절 5번). 두 verdigris-deep-qa report.json 의 auto 실행을 한 짝씩 기계적으로 비교한다.
// 게이트(JSON 출력의 gates · ok): 같은 영웅·시드·depth·재시드·viewport·motion·quality 설정, 기준선이 실제로 다른 빌드(HEAD 가 다르고, 기준선에는 경로 정의 verdigris_deep 이 없고 후보에는 있음),
// 양쪽 report·run 이 pass(후보는 제단·수로 판정까지 통과), 완주 시간 비 ≤ 2.0, 전체 런 50ms 초과 수 ≤ 기준선 + 2.
// 보고 항목(게이트 아님, PLAN 5절 5에서 사전 선언): report.roomEnterDrawCalls 제단·수로 방 첫 진입 draw call 증가, report.over50PerThousandSteps 50ms 초과율,
// report.load 실행 전후 1분 load, report.order 어느 쪽이 먼저 돌았는지(짝은 순서를 섞어 돌린다).
// 50ms 절대 검사는 각 report 의 reportItems.absolute50ms 가 보고하며 여기서 대신하거나 완화하지 않는다.
// 한 짝(base → cand 또는 cand → base)만 판정한다. 시리즈에서는 짝마다 이 도구를 한 번씩 실행하고 두 짝 모두 통과해야 게이트가 통과한다(짝 a: 기준선 → 후보, 짝 b: 후보 → 기준선).
// 기준선은 같은 도구를 --project=<기준선 워크트리> 로 같은 --hero --seed 에서 돌린 report 여야 한다.
import fs from 'node:fs';
import { compareRuns, compareSetup, compareTargetsOk } from './verdigris-deep-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('base') || !arg('cand')) {
  console.log('사용법: node tools/verdigris-deep-compare.mjs --base=<기준선 report.json> --cand=<후보 report.json> [--out=<새 json 경로>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  const simulation = run.metrics?.simulation?.n, render = run.metrics?.render?.n;
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed, depth: report.depth ?? null, reseedOn: report.reseed?.on ?? null,
    viewport: report.viewport ?? null, motion: report.motion ?? null, quality: report.quality ?? null,
    routeDefinition: report.routeDefinition ?? null, altarRooms: report.altarRooms ?? null, runStatus: run.status ?? null,
    altarOk: run.altar?.ok ?? null, time: run.result?.win ? run.result.time : null, samples: run.summary?.samples || [], runOver50: run.metrics?.over50ms ?? null,
    steps: run.summary?.steps ?? (Number.isFinite(simulation) && Number.isFinite(render) ? simulation + render : null), started: report.started ?? null,
    load: report.load ? { start: report.load.start ?? null, beforeStart: report.load.beforeStart ?? null, end: report.load.end ?? null, waitedMs: report.load.waitedMs ?? null } : null };
};
const cand = runOf(arg('cand')), base = runOf(arg('base'));
const { same, ok: sameSetup } = compareSetup(cand, base);
const verdict = compareRuns(cand, base);
const setupOf = r => ({ viewport: r.viewport, motion: r.motion, quality: r.quality });
const defOf = r => (r.routeDefinition ? { id: r.routeDefinition.id, kind: r.routeDefinition.kind ?? null, gates: r.routeDefinition.gates?.length ?? null } : null);
// 기준선·후보가 뒤바뀌거나 후보끼리 비교되면 합격하지 않는다.
const targetsOk = compareTargetsOk(cand, base);
const result = { candidate: { head: cand.head, status: cand.status, runStatus: cand.runStatus, heroId: cand.heroId, depth: cand.depth, reseed: cand.reseedOn, ...setupOf(cand), definition: defOf(cand), altarOk: cand.altarOk },
  baseline: { head: base.head, status: base.status, runStatus: base.runStatus, heroId: base.heroId, depth: base.depth, reseed: base.reseedOn, ...setupOf(base), definition: defOf(base) },
  same, sameSetup, targetsOk, ...verdict,
  absolute50ms: { note: '절대 검사는 각 report 의 reportItems.absolute50ms 가 보고한다. 여기는 보고 항목', candidateRun: cand.runOver50, baselineRun: base.runOver50 } };
result.gates = { sameSetup, targetsOk, ...verdict.gates };
result.ok = sameSetup && targetsOk && verdict.ok;
const out = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), out + '\n', { flag: 'wx' });
console.log(out);
process.exit(result.ok ? 0 : 1);
