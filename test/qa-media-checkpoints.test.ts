import { expect, setDefaultTimeout, test } from 'bun:test';
// 실제 자식 프로세스·렌더를 쓰므로 PC가 바쁠 때 기본 5초 제한에 걸리지 않게 한다.
setDefaultTimeout(30_000);
import { assessMediaObservations, bindMediaRequestIssues, createMediaCheckpoints } from '../tools/qa-media-checkpoints.mjs';
import { classifyMediaCancellations } from '../tools/conquest-media-observer.mjs';
import { existsSync, readFileSync } from 'node:fs';

function fixture() {
  const media: any[] = [], diagnostics: any[] = [], documents: any[] = [];
  let origin = 1000, at = 1100;
  const page = { evaluate: async (fn: Function) => fn.constructor.name === 'AsyncFunction'
    ? { before: origin, timeOrigin: origin, snapshot: { at: at++, events: [], tracks: [], droppedEvents: 0 } } : origin };
  const collector = createMediaCheckpoints(page, media, diagnostics, documents);
  return { page, collector, media, diagnostics, documents, changeOrigin: (value: number) => { origin = value; } };
}
test('captures original clock values and actual document identity without relabeling', async () => {
  const f = fixture(); await f.collector.bindDocument(1); await f.collector.beforeNavigation(1);
  expect(f.documents).toEqual([{ documentId: 1, timeOrigin: 1000 }]);
  expect(f.media.map(m => [m.documentId, m.timeOrigin, m.snapshot.at])).toEqual([[1, 1000, 1100], [1, 1000, 1101]]);
  expect(f.diagnostics).toHaveLength(0);
});
test('drain waits for captures enqueued by another completion', async () => {
  const f = fixture(); await f.collector.bindDocument(1);
  const first = f.collector.capture(1, 'first'); first.then(() => f.collector.capture(1, 'enqueued-later'));
  await f.collector.drain(); expect(f.media.map(m => m.reason)).toEqual(['first', 'enqueued-later']);
});
test('native document mismatch is preserved instead of attaching new-document evidence', async () => {
  const f = fixture(); await f.collector.bindDocument(1); f.changeOrigin(2000);
  await f.collector.capture(1, 'late-old-request'); await f.collector.drain();
  expect(f.media).toHaveLength(0); expect(f.diagnostics).toEqual([expect.objectContaining({ documentId: 1,
    expectedTimeOrigin: 1000, observedTimeOrigin: 2000, error: 'native-document-mismatch' })]);
});
test('destroyed execution context and unbound document remain diagnostics', async () => {
  const f = fixture(); await f.collector.bindDocument(1);
  f.page.evaluate = async () => { throw Error('Execution context was destroyed'); };
  await f.collector.capture(1, 'destroyed'); await f.collector.capture(2, 'unbound'); await f.collector.drain();
  expect(f.media).toHaveLength(0); expect(f.diagnostics).toHaveLength(2);
  expect(f.diagnostics[0].error).toContain('Execution context was destroyed');
  expect(f.diagnostics[1].error).toContain('Unbound native document');
});
test('ambiguous document identities cannot be bound', async () => {
  const f = fixture(); await f.collector.bindDocument(1);
  await expect(f.collector.bindDocument(1)).rejects.toThrow('Ambiguous');
  await expect(f.collector.bindDocument(2)).rejects.toThrow('Ambiguous');
});
test('request and snapshot must use the same actual native document origin', async () => {
  const f = fixture(); await f.collector.bindDocument(1);
  await f.collector.capture(1, 'request-origin-mismatch', 2000); await f.collector.drain();
  expect(f.media).toHaveLength(0); expect(f.diagnostics[0].error).toContain('Request document identity');
});
test('a failure or observation loss collected during cleanup cannot retain prior acceptance', () => {
  const report: any = { errors: [], httpErrors: [], mediaCheckpointDiagnostics: [], requestFailures: [], media: [] };
  expect(assessMediaObservations(report).passed).toBe(true);
  report.requestFailures.push({ engine: 'chromium', documentId: 1, url: 'https://local/old.mp3',
    type: 'media', error: 'net::ERR_ABORTED', status: 200, started: 1000, responseAt: 1100, failedAt: 2000 });
  expect(assessMediaObservations(report).passed).toBe(false);
  expect(assessMediaObservations(report).mediaCancellations.unresolved).toHaveLength(1);
  report.requestFailures = []; report.mediaCheckpointDiagnostics.push({ error: 'Execution context was destroyed' });
  expect(assessMediaObservations(report).passed).toBe(false);
});
const oldRaw = new URL('../work/aaa-20261003/replay-ui-clean-1c97026/report.json', import.meta.url);
test.skipIf(!existsSync(oldRaw))('checkpoint collection cannot promote the preserved early-snapshot failure', () => {
  const r = JSON.parse(readFileSync(oldRaw, 'utf8'));
  expect(r.status).toBe('fail');
  const result = classifyMediaCancellations(r.requestFailures.filter((f: any) => f.documentId === 2), r.media.filter((m: any) => m.documentId === 2));
  expect(result.classified).toHaveLength(0); expect(result.unresolved[0].reason).toBe('missing-or-incomplete-observation');
});

// BUNDLE-02 cand-screens-default: frost.mp3 중단 직후 스냅샷이 리소스 타이밍 failedAt 보다 287ms(페이지 시계) 앞섰고,
// 관측 종료 스냅샷도 165ms 앞서 실패 뒤 관측이 없었다. 런타임은 이 목록이 빌 때까지만 다시 관측한다.
test('failures awaiting a post-failure observation follow the page-clock snapshot times per document', async () => {
  const { failuresAwaitingObservation } = await import('../tools/qa-media-checkpoints.mjs');
  const end = 1792042949535.877;
  const frost = { documentId: 1, url: 'http://127.0.0.1/bgm/regions/frost.mp3', failedAt: end };
  const lobby = { documentId: 1, url: 'http://127.0.0.1/bgm/lobby.mp3', failedAt: end - 33000 };
  const snap = (documentId: number, at: number) => ({ documentId, snapshot: { at } });
  const report: any = { requestFailures: [lobby, frost], media: [-32999, -6125, -287, -165].map(d => snap(1, end + d)) };
  expect(failuresAwaitingObservation(report, 1)).toEqual([frost]);
  report.media.push(snap(2, end + 500));
  expect(failuresAwaitingObservation(report, 1)).toEqual([frost]);
  report.media.push(snap(1, end));
  expect(failuresAwaitingObservation(report, 1)).toEqual([]);
  report.requestFailures.push({ documentId: 1, url: 'x', failedAt: NaN });
  expect(failuresAwaitingObservation(report, 1)).toEqual([]);
  expect(failuresAwaitingObservation({ requestFailures: [frost], media: [] }, 1)).toEqual([frost]);
});


// ---- BUNDLE-03: 요청 시작 증거를 렌더러 발행 시각으로 묶기(창·분류 규칙 불변) ----
// 고정 입력은 B02 v2 화면 기본 프로필 report의 frost.mp3 실패와 실패 뒤 마지막 스냅샷이다(네트워크 시작이 loadstart 뒤 320ms).
// 발행 기록(issue)은 그 실행에 없던 값이라 합성한다. 시각은 diag-4 트레이스의 렌더러 발행(loadstart 15ms 전)을 따른다.
const frostCut = () => JSON.parse(readFileSync(new URL('./fixtures/media-cancellation/b03-screens-default-frost.json', import.meta.url), 'utf8'));
const issueAt = (cut: any, at: number, extra: any = {}) => ({ documentId: cut.failure.documentId, requestId: 'r-frost', url: cut.failure.url,
  wallTime: at / 1000, timestamp: 1, failed: true, redirected: false, ...extra });
const assessCut = (cut: any, issues: any[]) => {
  const report = { errors: [], httpErrors: [], mediaCheckpointDiagnostics: [], requestFailures: [cut.failure], media: cut.media };
  bindMediaRequestIssues(report.requestFailures, issues);
  return assessMediaObservations(report);
};
test('B03 frost cut: network start 320ms after trusted loadstart stays unresolved without a renderer issue record', () => {
  const cut = frostCut(), result = assessCut(cut, []);
  expect(cut.failure.startEvidence).toEqual({ kind: 'network-start', reason: 'no-issue-record' });
  expect(cut.failure.started).toBe(cut.times.networkStartedAt);
  expect(result.passed).toBe(false);
  expect(result.mediaCancellations.unresolved.map((u: any) => u.reason)).toEqual([cut.expectedBeforeFix]);
});
test('B03 frost cut: a single failed renderer issue record inside the unchanged 250ms window classifies the request', () => {
  const cut = frostCut(), issued = cut.times.loadstartNativeAt - 15;
  const result = assessCut(cut, [issueAt(cut, issued)]);
  expect(cut.failure.started).toBe(issued);
  expect(cut.failure.startEvidence).toMatchObject({ kind: 'renderer-issue', issuedAt: issued, networkStartedAt: cut.times.networkStartedAt });
  expect(cut.failure.startEvidence.networkDelayMs).toBeCloseTo(cut.times.networkStartedAt - issued, 6);
  expect(result.passed).toBe(true);
  const [c]: any[] = result.mediaCancellations.classified;
  expect(c.matchedInstanceId).toBe(2); expect(c.requestStartEvidence.anchorKind).toBe('source-created');
  expect(Math.abs(c.requestStartEvidence.startDeltaMs)).toBeLessThanOrEqual(250);
});
test('B03 frost cut: the window is not widened when the issue itself is more than 250ms from creation and loadstart', () => {
  const cut = frostCut(), issued = cut.times.createdAt + 400; // 생성 +400, loadstart +273, 네트워크 시작보다는 앞
  expect(issued).toBeLessThanOrEqual(cut.times.networkStartedAt);
  const result = assessCut(cut, [issueAt(cut, issued)]);
  expect(cut.failure.startEvidence.kind).toBe('renderer-issue');
  expect(result.passed).toBe(false);
  expect(result.mediaCancellations.unresolved.map((u: any) => u.reason)).toEqual(['ambiguous-or-missing-request-start-instance']);
});
test('B03 issue binding keeps the network start unless exactly one consistent failed record matches', () => {
  const at = (cut: any) => cut.times.loadstartNativeAt - 15;
  const cases: [string, (cut: any) => any[]][] = [
    ['ambiguous-issue-records', cut => [issueAt(cut, at(cut)), issueAt(cut, at(cut) + 1, { requestId: 'r-2' })]],
    ['no-issue-record', cut => [issueAt(cut, at(cut), { documentId: cut.failure.documentId + 1 })]],
    ['no-issue-record', cut => [issueAt(cut, at(cut), { failed: false })]],
    ['no-issue-record', cut => [issueAt(cut, at(cut), { url: cut.failure.url + '?other' })]],
    ['redirected-issue-record', cut => [issueAt(cut, at(cut), { redirected: true })]],
    ['issue-time-inconsistent', cut => [issueAt(cut, cut.times.networkStartedAt + 1)]],
    ['issue-time-inconsistent', cut => [issueAt(cut, NaN)]],
  ];
  for (const [reason, issues] of cases) {
    const cut = frostCut(), result = assessCut(cut, issues(cut));
    expect(cut.failure.startEvidence).toEqual({ kind: 'network-start', reason });
    expect(cut.failure.started).toBe(cut.times.networkStartedAt);
    expect(result.mediaCancellations.unresolved).toHaveLength(1);
  }
  // 이미 묶은 실패는 다시 묶지 않는다.
  const cut = frostCut(), failures = [cut.failure];
  bindMediaRequestIssues(failures, [issueAt(cut, at(cut))]);
  bindMediaRequestIssues(failures, [issueAt(cut, at(cut) - 100)]);
  expect(cut.failure.started).toBe(at(cut));
  // 미디어가 아닌 실패는 건드리지 않는다.
  const other = { ...frostCut().failure, type: 'stylesheet' };
  bindMediaRequestIssues([other], [issueAt(frostCut(), at(frostCut()))]);
  expect(other.startEvidence).toBeUndefined();
});

