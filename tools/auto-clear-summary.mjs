// AUTO 실측 보고서의 짝을 검증한 뒤 같은 시드끼리만 집계한다.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const arg = key => process.argv.find(s => s.startsWith(`--${key}=`))?.slice(key.length + 3);
const out = path.join(root, 'work/qa/auto-20261020');
const beforeTag = arg('before') || 'baseline-97bc087';
const afterTag = arg('after') || 'fixed-c899684';
const before = JSON.parse(await fs.readFile(path.join(out, beforeTag, 'report.json'), 'utf8'));
const after = JSON.parse(await fs.readFile(path.join(out, afterTag, 'report.json'), 'utf8'));
for (const report of [before, after]) {
  if (!report.finished || report.runs.length !== 27 || new Set(report.runs.map(r => r.id)).size !== 27) throw Error('27개 시나리오 완결 보고서가 필요합니다.');
}
if (before.seedBase !== after.seedBase || before.heroId !== after.heroId || before.heroLevel !== after.heroLevel ||
  before.maxChunks !== after.maxChunks || before.dt !== after.dt || before.harnessSha256 !== after.harnessSha256) throw Error('비교 실행 조건이 다릅니다.');
const round = n => Math.round(n * 10) / 10;
const mean = rows => rows.length ? round(rows.reduce((sum, row) => sum + row.last.elapsed, 0) / rows.length) : null;
const summary = report => {
  const wins = report.runs.filter(r => r.status === 'win');
  return { head: report.head, total: report.runs.length, wins: wins.length,
    clearRatePercent: round(wins.length / report.runs.length * 100),
    unassistedWins: wins.filter(r => r.unassistedWin).length, meanClearSeconds: mean(wins),
    deaths: report.runs.reduce((n, r) => n + r.deaths, 0),
    failures: report.runs.filter(r => r.status !== 'win').map(r => ({ id: r.id, status: r.status, elapsed: r.last?.elapsed })),
    stallSuspects: report.runs.reduce((n, r) => n + r.stallSuspects.length, 0), errors: report.errors };
};
const rows = before.runs.map(b => {
  const a = after.runs.find(r => r.id === b.id);
  if (!a || a.seed !== b.seed || JSON.stringify(a.fixture.saveHero) !== JSON.stringify(b.fixture.saveHero)) throw Error(`시드 또는 초기 저장 불일치: ${b.id}`);
  return { id: b.id, seed: b.seed,
    before: { status: b.status, seconds: b.last?.elapsed, deaths: b.deaths, unassistedWin: b.unassistedWin },
    after: { status: a.status, seconds: a.last?.elapsed, deaths: a.deaths, unassistedWin: a.unassistedWin },
    deltaSeconds: b.status === 'win' && a.status === 'win' ? round(a.last.elapsed - b.last.elapsed) : null };
});
const common = new Set(rows.filter(r => r.before.status === 'win' && r.after.status === 'win').map(r => r.id));
const comparison = { generatedAt: new Date().toISOString(), beforeTag, afterTag,
  fixture: after.fixture, viewport: after.viewport, seedBase: after.seedBase,
  before: summary(before), after: summary(after),
  pairedWins: { count: common.size, beforeMeanSeconds: mean(before.runs.filter(r => common.has(r.id))), afterMeanSeconds: mean(after.runs.filter(r => common.has(r.id))) },
  qualifications: [
    'Windows Chromium + SwiftShader, 844×390 터치 뷰포트, 고정 1/60초로 실제 컴파일 게임을 가속 실행했다. 실기기 GPU·발열·실시간 조작·공개 배포 검증은 아니다.',
    '사망 뒤 실제 revivePlayer 경로를 호출한 실행은 부활 포함 완주이며 무사망 AUTO 클리어와 구별했다.',
    '이전 런타임은 저장에 0인 각성 스킬도 1로 바꾸었다. 같은 초기 저장을 사용했으며 이 제품 결함의 수정을 비교에서 숨기지 않았다.',
    '평균 클리어 시간은 성공한 실행만 집계한다. 성공 집합 차이의 영향을 피하도록 공통 성공 시나리오 평균도 함께 적었다.',
    '과거의 30초 무진행 판정은 의심 기록만 남겼으며 두 빌드 모두 같은 최대 프레임까지 실행했다.',
  ], rows };
await fs.writeFile(path.join(out, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
const status = s => ({ win: '승리', timeout: '시간 초과', 'paused-blocked': '일시정지 막힘', lost: '패배', error: '실행 오류', 'settlement-failed': '정산 실패' })[s] || s;
const line = r => `| ${r.id} | ${r.seed} | ${status(r.before.status)} / ${r.before.seconds} / ${r.before.deaths} | ${status(r.after.status)} / ${r.after.seconds} / ${r.after.deaths} | ${r.deltaSeconds ?? '-'} |`;
const markdown = `# AUTO 동일 시드 런타임 비교\n\n기준: ${before.head}\n수정: ${after.head}\n\n| 지표 | 기준 | 수정 |\n|---|---:|---:|\n| 완주 | ${comparison.before.wins}/27 | ${comparison.after.wins}/27 |\n| 클리어율 | ${comparison.before.clearRatePercent}% | ${comparison.after.clearRatePercent}% |\n| 무사망 클리어 | ${comparison.before.unassistedWins}/27 | ${comparison.after.unassistedWins}/27 |\n| 성공 평균 시간 | ${comparison.before.meanClearSeconds}초 | ${comparison.after.meanClearSeconds}초 |\n| 전체 사망 수 | ${comparison.before.deaths} | ${comparison.after.deaths} |\n| 공통 성공 ${common.size}개 평균 | ${comparison.pairedWins.beforeMeanSeconds}초 | ${comparison.pairedWins.afterMeanSeconds}초 |\n\n| 시나리오 | 시드 | 기준: 결과 / 초 / 사망 | 수정: 결과 / 초 / 사망 | 시간 차이(초) |\n|---|---:|---|---|---:|\n${rows.map(line).join('\n')}\n\n${comparison.qualifications.map(s => '- ' + s).join('\n')}\n`;
await fs.writeFile(path.join(out, 'comparison.md'), markdown);
console.log(JSON.stringify({ before: comparison.before, after: comparison.after, pairedWins: comparison.pairedWins }, null, 2));
