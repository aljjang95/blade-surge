#!/usr/bin/env node
// 흑사막 분지 가짜 왕좌·거울 미궁 QA 기준선 비교(BUNDLE-09 PLAN 5절 5번). 두 sable-mirror-qa report.json 의 auto 실행을 기계적으로 비교한다.
// 게이트(JSON 출력의 gates · ok): 같은 영웅·시드·depth·재시드·viewport·motion·quality 설정, 기준선이 실제로 다른 빌드(HEAD 가 다르고, 심층: 기준선 경로 정의에 escape 없음·후보에 있음 /
// 일반: 양쪽 정의가 같고 escape 없음), 양쪽 report·run 이 pass(후보는 왕좌·미궁 판정까지, 일반 기준선은 왕좌 판정까지 통과), 완주 시간 비 ≤ 2.0(심층·일반),
// 전체 런 50ms 초과 수 ≤ 기준선 + 2, 후보 심층의 거울 뷰 같은 프레임 A/B(후보 report 의 viewGpu.ok: 표본 ≥ 3, hidden·running·shattered 포함, calls 차이 ≤ 4 이고 mazeView.drawCalls 와 같음).
// 보고 항목(게이트 아님, PLAN 5절 5에서 사전 선언): report.roomEnterDrawCalls 왕좌 방 첫 진입 draw call 증가, report.over50PerThousandSteps 50ms 초과율,
// report.timeParity 일반 완주 시간 비 1.00 ± 0.05 여부, report.routeViewGpu 왕좌 뷰까지 포함한 경로 목표 전체 A/B.
// 50ms 절대 검사는 각 report 의 reportItems.absolute50ms 가 보고하며 여기서 대신하거나 완화하지 않는다.
// 기준선은 같은 도구를 --project=<기준선 워크트리> 로 같은 --hero --seed --depth 에서 돌린 report 여야 한다.
import fs from 'node:fs';
import { compareRuns, compareSetup, compareTargetsOk } from './sable-mirror-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('base') || !arg('cand')) {
  console.log('사용법: node tools/sable-mirror-compare.mjs --base=<기준선 report.json> --cand=<후보 report.json> [--out=<새 json 경로>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  const simulation = run.metrics?.simulation?.n, render = run.metrics?.render?.n;
  const gpu = run.thrones?.gpu ?? null;
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed, depth: report.depth ?? null, reseedOn: report.reseed?.on ?? null,
    viewport: report.viewport ?? null, motion: report.motion ?? null, quality: report.quality ?? null,
    routeDefinition: report.routeDefinition ?? null, throneRooms: report.throneRooms ?? null, runStatus: run.status ?? null,
    throneOk: run.thrones?.ok ?? null, time: run.result?.win ? run.result.time : null, samples: run.summary?.samples || [], runOver50: run.metrics?.over50ms ?? null,
    steps: run.summary?.steps ?? (Number.isFinite(simulation) && Number.isFinite(render) ? simulation + render : null),
    // rows 는 크므로 판정에 쓰는 요약만 남긴다.
    viewGpu: gpu ? { ok: gpu.ok, samples: gpu.samples, max: gpu.max, limit: gpu.limit, coverage: gpu.coverage } : null, routeViewGpu: gpu?.route ?? null };
};
const cand = runOf(arg('cand')), base = runOf(arg('base'));
const depth = cand.depth;
const { same, ok: sameSetup } = compareSetup(cand, base);
const verdict = compareRuns(cand, base, { depth });
const setupOf = r => ({ viewport: r.viewport, motion: r.motion, quality: r.quality });
const defOf = r => (r.routeDefinition ? { id: r.routeDefinition.id, escape: !!r.routeDefinition.escape, gates: r.routeDefinition.gates?.length ?? null } : null);
// 기준선·후보가 뒤바뀌거나 후보끼리 비교되면 합격하지 않는다.
const targetsOk = compareTargetsOk(cand, base, depth);
const result = { candidate: { head: cand.head, status: cand.status, runStatus: cand.runStatus, heroId: cand.heroId, depth, reseed: cand.reseedOn, ...setupOf(cand), definition: defOf(cand), throneOk: cand.throneOk },
  baseline: { head: base.head, status: base.status, runStatus: base.runStatus, heroId: base.heroId, depth: base.depth, reseed: base.reseedOn, ...setupOf(base), definition: defOf(base), throneOk: base.throneOk },
  same, sameSetup, targetsOk, ...verdict,
  absolute50ms: { note: '절대 검사는 각 report 의 reportItems.absolute50ms 가 보고한다. 여기는 보고 항목', candidateRun: cand.runOver50, baselineRun: base.runOver50 } };
result.gates = { sameSetup, targetsOk, ...verdict.gates };
result.ok = sameSetup && targetsOk && verdict.ok;
const out = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), out + '\n', { flag: 'wx' });
console.log(out);
process.exit(result.ok ? 0 : 1);
