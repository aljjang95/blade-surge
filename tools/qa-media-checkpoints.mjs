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

/** 미디어 요청 실패의 시작 시각을 렌더러 발행 시각(CDP Network.requestWillBeSent wallTime)으로 묶는다. mobile-qa 와 같은 정의다.
 * Playwright timing.startTime 은 네트워크 스택이 요청을 실제로 시작한 시각이라 브라우저 우선순위 대기가 들어간다
 * (BUNDLE-03: 전투 시작 때 VeryHigh 폰트 요청이 진행 중이면 Low 미디어 요청이 렌더러 발행 뒤 약 250~340ms 늦게 시작했다).
 * 같은 문서·같은 URL에서 실패로 끝난 미디어 발행 기록이 정확히 하나이고, 그 발행 시각이 네트워크 시작보다 늦지 않을 때만 바꾼다.
 * 그 밖에는 시작 시각을 그대로 두고 이유를 남긴다. 분류기·250ms 창·정지 증명·대체 재생 요구는 바꾸지 않는다.
 * 한 번 묶은 실패는 다시 묶지 않는다(startEvidence 가 있으면 건너뛴다). */
export function bindMediaRequestIssues(failures, issues) {
  for (const failure of failures) {
    if (failure.type !== 'media' || failure.startEvidence) continue;
    const matches = issues.filter(issue => issue.documentId === failure.documentId && issue.url === failure.url && issue.failed === true);
    const issue = matches.length === 1 ? matches[0] : null;
    const issuedAt = issue && Number.isFinite(issue.wallTime) ? issue.wallTime * 1000 : NaN;
    if (!issue || issue.redirected || !Number.isFinite(issuedAt) || !Number.isFinite(failure.started) || issuedAt > failure.started) {
      failure.startEvidence = { kind: 'network-start', reason: matches.length > 1 ? 'ambiguous-issue-records'
        : !issue ? 'no-issue-record' : issue.redirected ? 'redirected-issue-record' : 'issue-time-inconsistent' };
      continue;
    }
    failure.startEvidence = { kind: 'renderer-issue', issuedAt, networkStartedAt: failure.started, networkDelayMs: failure.started - issuedAt, requestId: issue.requestId };
    failure.started = issuedAt;
  }
  return failures;
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
