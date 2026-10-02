import { expect, test } from 'bun:test';
import { assessMediaObservations, createMediaCheckpoints } from '../tools/qa-media-checkpoints.mjs';
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
