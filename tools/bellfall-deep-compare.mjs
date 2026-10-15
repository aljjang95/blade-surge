#!/usr/bin/env node
// 종락 회랑 심층 QA 기준선 비교(BUNDLE-04 PLAN 5절 4번). 두 bellfall-deep-qa report.json 의 auto 실행을 비교한다.
// 완주 시간 비 ≤ 2, draw call 증가 ≤ 12(짝 없는 표본은 실패)를 판정하고, 50ms 초과 스텝은 전체·종문 구간(toll·answer)으로 나눠 보고한다.
// 50ms 절대 검사는 각 report 의 검사가 그대로 판정한다(여기서 대신하거나 완화하지 않는다).
import fs from 'node:fs';
import { compareToBaseline } from './bellfall-deep-checks.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
if (process.argv.includes('--help') || !arg('candidate') || !arg('baseline')) {
  console.log('사용법: node tools/bellfall-deep-compare.mjs --candidate=<report.json> --baseline=<report.json> [--out=<json>]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const runOf = file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = report.profiles?.auto?.runs?.[0];
  if (!run) throw Error('auto 실행이 없는 report: ' + file);
  return { head: report.head ?? null, status: report.status, heroId: report.heroId, seed: report.seed,
    time: run.result?.win ? run.result.time : null, samples: run.summary?.samples || [], slow: run.summary?.slow || [],
    stepMs: run.summary?.stepMs, renderMs: run.summary?.renderMs };
};
const cand = runOf(arg('candidate')), base = runOf(arg('baseline'));
const same = cand.heroId === base.heroId && cand.seed === base.seed;
const result = { candidate: { head: cand.head, status: cand.status }, baseline: { head: base.head, status: base.status }, sameHeroSeed: same, ...compareToBaseline(cand, base) };
result.ok = result.ok && same;
const text = JSON.stringify(result, null, 2);
if (arg('out')) fs.writeFileSync(arg('out'), text + '\n', { flag: 'wx' });
console.log(text);
process.exit(result.ok ? 0 : 1);
