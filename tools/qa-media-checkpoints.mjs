// Keep real observer snapshots bound to an actual native document lifetime.
// Does not rewrite clocks or retain media elements/nodes.
import { classifyMediaCancellations } from './conquest-media-observer.mjs';
export function createMediaCheckpoints(page, media, diagnostics, documents) {
  const origins = new Map(), pending = new Set();
  const fence = () => new Promise(resolve => setImmediate(resolve));
  async function bindDocument(documentId) {
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    if (!Number.isSafeInteger(documentId) || documentId <= 0 || !Number.isFinite(timeOrigin)
      || origins.has(documentId) || [...origins.values()].includes(timeOrigin)) throw Error('Ambiguous native document identity');
    origins.set(documentId, timeOrigin); documents.push({ documentId, timeOrigin });
  }
  /** @param {number} documentId @param {string} reason @param {number|null} [requestTimeOrigin] */
  function capture(documentId, reason, requestTimeOrigin = undefined) {
    const expected = origins.get(documentId);
    const task = (async () => {
      try {
        if (!Number.isFinite(expected)) throw Error('Unbound native document');
        if (requestTimeOrigin !== undefined && requestTimeOrigin !== expected) throw Error('Request document identity does not match observation binding');
        const observation = await page.evaluate(async () => {
          const before = performance.timeOrigin;
          await new Promise(resolve => setTimeout(resolve, 0));
          return { before, timeOrigin: performance.timeOrigin, snapshot: globalThis.__conquestMedia.snapshot() };
        });
        if (observation.before !== expected || observation.timeOrigin !== expected) {
          diagnostics.push({ documentId, reason, expectedTimeOrigin: expected,
            observedTimeOrigin: observation.timeOrigin, beforeTimeOrigin: observation.before,
            error: 'native-document-mismatch' }); return;
        }
        media.push({ engine: 'chromium', documentId, timeOrigin: expected, reason, snapshot: observation.snapshot });
      } catch (error) {
        diagnostics.push({ documentId, reason, expectedTimeOrigin: expected ?? null, error: String(error?.stack || error) });
      }
    })();
    pending.add(task); task.finally(() => pending.delete(task)); return task;
  }
  async function drain() {
    // A callback can enqueue another capture while an earlier one is awaited.
    for (let round = 0; round < 128; round++) {
      await fence();
      if (!pending.size) return;
      await Promise.all([...pending]);
    }
    throw Error('Media observation queue did not settle');
  }
  async function beforeNavigation(documentId) {
    await drain(); await capture(documentId, 'before-native-navigation');
    await drain(); await capture(documentId, 'after-native-observation-drain'); await drain();
  }
  return { bindDocument, capture, drain, beforeNavigation };
}

// Call after all pending captures and cleanup events have been collected.
export function assessMediaObservations(report) {
  const mediaCancellations = { classified: [], unresolved: [], documents: [] };
  for (const documentId of new Set(report.requestFailures.map(request => request.documentId))) {
    const result = classifyMediaCancellations(report.requestFailures.filter(request => request.documentId === documentId),
      report.media.filter(media => media.documentId === documentId));
    mediaCancellations.documents.push({ documentId, ...result });
    mediaCancellations.classified.push(...result.classified); mediaCancellations.unresolved.push(...result.unresolved);
  }
  return { passed: report.errors.length === 0 && report.httpErrors.length === 0
    && report.mediaCheckpointDiagnostics.length === 0 && mediaCancellations.unresolved.length === 0, mediaCancellations };
}

/** 이 문서의 요청 실패 중, 실패 시각(failedAt) 이후에 찍힌 관측 스냅샷이 아직 없는 것.
 * failedAt 은 리소스 타이밍 시계, 스냅샷 시각은 페이지 시계라서 실패 직후 스냅샷도 failedAt 보다 앞설 수 있다
 * (BUNDLE-02 실측 −3~−287ms). 분류기는 failedAt 이후 스냅샷을 요구하므로, 관측 종료 직전 실패는 다시 관측해야 한다.
 * 판정 기준을 바꾸지 않는다. 관측을 더할지 결정하는 데만 쓴다. */
export function failuresAwaitingObservation(report, documentId) {
  let latest = -Infinity;
  for (const media of report.media) if (media.documentId === documentId && Number.isFinite(media.snapshot?.at)) latest = Math.max(latest, media.snapshot.at);
  return report.requestFailures.filter(failure => failure.documentId === documentId && Number.isFinite(failure.failedAt) && latest < failure.failedAt);
}
