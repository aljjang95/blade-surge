#!/usr/bin/env node
// 일식 수문 역류 밸브 QA 기준선 비교(BUNDLE-07 PLAN 5절 5번). 두 eclipse-valve-qa report.json 의 auto 실행을 기계적으로 비교한다.
// 판정(JSON 출력의 ok): 같은 영웅·시드·depth·재시드·viewport·motion·quality 설정, 기준선이 실제로 경로 정의가 다른 빌드(심층: 기준선 정의 없음·후보 정의 있음 / 일반: 기준선 view 없음·후보 view 있음),
// 양쪽 report·run 이 pass(후보는 밸브 판정까지 통과), 완주 시간 비 ≤ 2.0, 밸브 방 첫 진입 프레임 draw call 증가 ≤ 3(짝 있는 방만, 짝 0개면 실패),
// 전체 런 50ms 초과 수 ≤ 기준선 + 2. 완주 시간 비 자체는 숫자로 남기고, 일반 비교의 1.00 ± 0.05 여부(time.parity.within)는 보고 항목이다.
// 보고 항목(게이트 아님): 양쪽 1000 스텝당 50ms 초과율과 스텝 수(slow.report), 후보의 뷰 실제 draw call A/B 최댓값(viewGpu.candidateMax, 판정은 후보 report 의 viewGpu).
// 50ms 절대 검사는 각 report 의 reportItems.absolute50ms 가 보고하며 여기서 대신하거나 완화하지 않는다.
// 기준선은 같은 도구를 --project=<기준선 워크트리> 로 같은 --hero --seed --depth 에서 돌린 report 여야 한다.
import fs from 'node:fs';
import { compareRuns, compareSetup, compareTargetsOk } from './eclipse-valve-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('base') || !arg('cand')) {
  console.log('사용법: node tools/eclipse-valve-compare.mjs --base=<기준선 report.json> --cand=<후보 report.json> [--out=<새 json 경로>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  const simulation = run.metrics?.simulation?.n, render = run.metrics?.render?.n;
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed, depth: report.depth ?? null, reseedOn: report.reseed?.on ?? null,
    viewport: report.viewport ?? null, motion: report.motion ?? null, quality: report.quality ?? null,
    routeDefinition: !!report.routeDefinition, viewDefined: !!report.viewDefined, valveRooms: report.valveRooms ?? null, runStatus: run.status ?? null,
    valvesOk: run.valves?.ok ?? null, time: run.result?.win ? run.result.time : null, samples: run.summary?.samples || [], runOver50: run.metrics?.over50ms ?? null,
    steps: run.summary?.steps ?? (Number.isFinite(simulation) && Number.isFinite(render) ? simulation + render : null), viewGpuMax: run.valves?.view?.gpu?.max ?? null };
};
const cand = runOf(arg('cand')), base = runOf(arg('base'));
const { same, ok: sameSetup } = compareSetup(cand, base);
const verdict = compareRuns(cand, base);
const setupOf = r => ({ viewport: r.viewport, motion: r.motion, quality: r.quality });
const result = { candidate: { head: cand.head, status: cand.status, runStatus: cand.runStatus, heroId: cand.heroId, depth: cand.depth, reseed: cand.reseedOn, ...setupOf(cand), routeDefinition: cand.routeDefinition, viewDefined: cand.viewDefined, valvesOk: cand.valvesOk, valveRooms: cand.valveRooms },
  baseline: { head: base.head, status: base.status, runStatus: base.runStatus, heroId: base.heroId, depth: base.depth, reseed: base.reseedOn, ...setupOf(base), routeDefinition: base.routeDefinition, viewDefined: base.viewDefined },
  same, sameSetup, ...verdict,
  absolute50ms: { note: '절대 검사는 각 report 의 reportItems.absolute50ms 가 보고한다. 여기는 보고 항목', candidateRun: cand.runOver50, baselineRun: base.runOver50 } };
// 기준선·후보가 뒤바뀌거나 후보끼리 비교되면 합격하지 않는다.
result.targetsOk = compareTargetsOk(cand, base, cand.depth);
result.ok = verdict.ok && sameSetup && result.targetsOk;
const out = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), out + '\n', { flag: 'wx' });
console.log(out);
process.exit(result.ok ? 0 : 1);
