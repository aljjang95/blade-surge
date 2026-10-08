// 원본 report를 수정하지 않고 이 실행의 정확한 취소 한 건만 검증한다.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assessMediaObservations } from '../../../tools/qa-media-checkpoints.mjs';
const dir = path.resolve(import.meta.dirname, 'media-handoff-v1');
const raw = await readFile(path.join(dir, 'report.json'));
const source = JSON.parse(raw);
const naturalRaw = await readFile(path.resolve(import.meta.dirname, 'natural-v4-run2/report.json'));
const natural = JSON.parse(naturalRaw);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const events = r => r.cdpMedia.filter(x => x.method === 'Media.playerEventsAdded').flatMap(x => x.payload.events.map(e => ({ playerId: x.payload.playerId, timestamp: e.timestamp, data: JSON.parse(e.value) })));
function qualify(r) {
  const failures = [], qualified = [], need = (ok, reason) => { if (!ok) failures.push(reason); };
  const js = assessMediaObservations(r), all = events(r);
  need(r.checks.every(c => c.status === 'PASS') && r.checks.length === 6, 'native-functional-checks');
  need(js.passed, 'strict-existing-js-lifecycle-assessment');
  need(r.errors.length === 0 && r.httpErrors.length === 0 && r.mediaCheckpointDiagnostics.length === 0, 'runtime-http-observer-error');
  need(r.requestFailures.length === 1 && r.playwrightFailedRequests.length === 1, 'exact-single-failure');
  need(JSON.stringify(r.build) === JSON.stringify(natural.build), 'candidate-build-identity');
  need(!r.cdpMedia.some(x => x.method === 'Media.playerErrorsRaised' && x.payload.errors?.length), 'native-player-error');
  for (const f of r.requestFailures) {
    const mark = failures.length;
    const correlated = js.mediaCancellations.classified.find(x => x.request.requestId === f.requestId);
    need(!!correlated, 'existing-strict-classification');
    need(f.method === 'GET' && f.type === 'media' && f.error === 'net::ERR_ABORTED' && f.canceled === true && f.status === 206, 'successful-canceled-media');
    need(r.documents.some(d => d.kind === 'cdp-root-frame' && d.frameId === f.frameId && d.loaderId === f.loaderId), 'exact-native-frame-loader');
    need(r.documents.some(d => d.documentId === f.documentId && d.timeOrigin === f.documentTimeOrigin), 'exact-native-document-clock');
    const loads = all.filter(e => e.data.event === 'kLoad' && e.data.url === f.url && e.timestamp <= f.nativeFailedAt);
    need(loads.length === 1, 'unique-original-native-load-lifetime');
    const load = loads[0]; if (!load) continue;
    need(Math.abs(load.timestamp - f.nativeStarted) <= .25, 'native-load-request-time-link');
    const history = all.filter(e => e.playerId === load.playerId && e.timestamp >= load.timestamp && e.timestamp <= f.nativeFailedAt).sort((a, b) => a.timestamp - b.timestamp);
    const play = history.find(e => e.data.event === 'kPlay');
    const pipeline = history.find(e => e.data.pipeline_state === 'kPlaying');
    const pause = history.filter(e => e.data.event === 'kPause').at(-1);
    const suspended = history.filter(e => e.data.event === 'kSuspended').at(-1);
    need(!!play && !!pipeline && !!pause && !!suspended && play.timestamp < pause.timestamp && pipeline.timestamp < pause.timestamp && pause.timestamp < suspended.timestamp, 'same-player-decode-play-pause-suspend-order');
    need(!!suspended && f.nativeFailedAt >= suspended.timestamp && f.nativeFailedAt - suspended.timestamp <= .25, 'native-suspend-immediately-before-exact-cancel');
    need(!!pause && !history.some(e => e.data.event === 'kPlay' && e.timestamp > pause.timestamp), 'no-replay-after-stop');
    const replacementLoads = all.filter(e => e.data.event === 'kLoad' && e.data.url === correlated?.replacement.src && e.timestamp > load.timestamp && e.timestamp < f.nativeFailedAt && e.playerId !== load.playerId);
    need(replacementLoads.length === 1, 'unique-distinct-replacement-native-player');
    const replacementLoad = replacementLoads[0];
    need(!!replacementLoad && all.some(e => e.playerId === replacementLoad.playerId && e.data.event === 'kPlay' && e.timestamp > replacementLoad.timestamp && e.timestamp < f.nativeFailedAt), 'replacement-native-play-before-cancel');
    const laterSameUrl = all.filter(e => e.data.event === 'kLoad' && e.data.url === f.url && e.timestamp > f.nativeFailedAt);
    need(laterSameUrl.length === 1 && laterSameUrl.every(e => e.playerId !== load.playerId), 'return-lobby-is-distinct-load-lifetime');
    if (failures.length === mark) qualified.push({ requestId: f.requestId, url: f.url, nativePlayerId: load.playerId,
      loadAt: load.timestamp, requestAt: f.nativeStarted, playAt: play.timestamp, pauseAt: pause.timestamp,
      suspendedAt: suspended.timestamp, canceledAt: f.nativeFailedAt, suspendToCancelMs: (f.nativeFailedAt - suspended.timestamp) * 1000,
      matchedJsInstanceId: correlated.matchedInstanceId, stoppedPlaybackSec: correlated.stoppedInstances[0].currentTime,
      replacementNativePlayerId: replacementLoad.playerId, returnNativePlayerId: laterSameUrl[0].playerId });
  }
  return { passed: failures.length === 0 && qualified.length === r.requestFailures.length, failures, qualified };
}
const original = qualify(source);
const rewriteEvents = (r, fn) => { for (const x of r.cdpMedia) if (x.method === 'Media.playerEventsAdded') x.payload.events = x.payload.events.flatMap(e => fn(e, JSON.parse(e.value), x.payload.playerId)); };
const originalPlayer = original.qualified[0]?.nativePlayerId;
const replacementPlayer = original.qualified[0]?.replacementNativePlayerId;
const controls = [
  ['unsuccessful-http', r => { r.requestFailures[0].status = 404; }],
  ['not-browser-canceled', r => { r.requestFailures[0].canceled = false; }],
  ['network-reset', r => { r.requestFailures[0].error = 'net::ERR_CONNECTION_RESET'; }],
  ['wrong-frame', r => { r.requestFailures[0].frameId = 'wrong-frame'; }],
  ['wrong-document-clock', r => { r.requestFailures[0].documentTimeOrigin += 1; }],
  ['missing-native-suspension', r => rewriteEvents(r, (e, v) => v.event === 'kSuspended' ? [] : [e])],
  ['native-suspension-after-cancel', r => rewriteEvents(r, (e, v) => [{ ...e, timestamp: v.event === 'kSuspended' ? r.requestFailures[0].nativeFailedAt + 1 : e.timestamp }])],
  ['missing-native-pause', r => rewriteEvents(r, (e, v, p) => p === originalPlayer && v.event === 'kPause' ? [] : [e])],
  ['wrong-native-load-url', r => rewriteEvents(r, (e, v, p) => [{ ...e, value: p === originalPlayer && v.event === 'kLoad' ? JSON.stringify({ ...v, url: v.url + '?other' }) : e.value }])],
  ['missing-native-replacement-play', r => rewriteEvents(r, (e, v, p) => p === replacementPlayer && v.event === 'kPlay' ? [] : [e])],
  ['missing-js-disconnect', r => { for (const m of r.media) m.snapshot.events = m.snapshot.events.filter(e => e.kind !== 'source-disconnect'); }],
  ['runtime-console-error', r => { r.errors.push({ type: 'console', message: 'control error' }); }],
  ['unrelated-model-failure', r => { r.requestFailures.push({ engine: 'chromium', documentId: 1, url: r.origin + '/models/missing.glb', type: 'fetch', error: 'net::ERR_FAILED' }); }],
  ['different-build', r => { r.build.pwaRelease = 'different'; }],
].map(([name, mutate]) => { const copy = structuredClone(source); mutate(copy); const assessed = qualify(copy); return { name, rejected: !assessed.passed, failures: assessed.failures }; });
const result = { schema: 1, status: original.passed && controls.every(c => c.rejected) ? 'PASS' : 'FAIL', checkedAt: new Date().toISOString(),
  source: { path: path.join(dir, 'report.json'), sha256: sha(raw), preservedStatus: source.status },
  earlierNaturalRun: { path: path.resolve(import.meta.dirname, 'natural-v4-run2/report.json'), sha256: sha(naturalRaw), preservedStatus: natural.status,
    scope: 'Ten native-action functional checks remain positive. This later identical-build reproduction diagnoses the one observed media cancellation pattern; the earlier report was not rewritten or retroactively asserted to contain native CDP evidence.' },
  scope: 'Only this immutable report exact successful media request and its same native player load/play/pause/suspend/cancel sequence are qualified. Not an ERR_ABORTED allowlist, audible playback proof, physical-device validation or production release.',
  build: source.build, assessment: original, rejectionControls: controls, limitations: ['Natural manual segment is scripted Chromium SwiftShader, not human or physical-device play.', 'Result screenshot captured an initial animation frame; functional visible-result and native return-click evidence are distinct from result-screen visual acceptance.'] };
await writeFile(path.join(dir, 'qualification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, rawSha256: result.source.sha256, qualified: original.qualified, controlsRejected: controls.filter(c => c.rejected).length, controlCount: controls.length, failures: original.failures }, null, 2));
process.exitCode = result.status === 'PASS' ? 0 : 1;
