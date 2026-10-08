// 기존 관측기와 원시 CDP 증거로 자연 음악 전환·포기 복귀만 재검수한다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { launchOpts } from '../../tools/chrome.mjs';
import { installConquestMediaObserver } from '../../tools/conquest-media-observer.mjs';
import { createMediaCheckpoints, assessMediaObservations } from '../../tools/qa-media-checkpoints.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = path.resolve(root, String(args.out || `work/dungeon-forge-20261008/media-handoff-${Date.now()}`));
await mkdir(out, { recursive: false });
const report = { schema: 1, status: 'RUNNING', startedAt: new Date().toISOString(),
  scope: 'Fresh local Chromium profile; natural RAF and native UI only. Existing unchanged media observer wraps original media methods without changing their result or retaining media elements. App combat/save state is never written. Raw CDP player/network observations retained for separate review; JS lifecycle classification alone is not proof of native cancellation cause or audible playback. Earlier natural run2 failure remains immutable.',
  checks: [], actions: [], states: [], errors: [], warnings: [], httpErrors: [], requestFailures: [], playwrightFailedRequests: [], network: [], cdpMedia: [], media: [], mediaCheckpointDiagnostics: [], documents: [], screenshots: [] };
for (const file of ['tools/conquest-media-observer.mjs', 'tools/qa-media-checkpoints.mjs']) {
  (report.observerHashes ||= {})[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const check = (ok, name, evidence) => { report.checks.push({ name, status: ok ? 'PASS' : 'FAIL', evidence }); if (!ok) throw Error(name); };
let browser, server, page, session, checkpoints, closing = false;
const stamp = () => Date.now();
const click = async selector => { report.actions.push({ at: stamp(), input: 'native-click', selector }); await page.locator(selector).click({ timeout: 30000 }); };
const state = async label => {
  const value = await page.evaluate(() => ({ at: performance.timeOrigin + performance.now(), timeOrigin: performance.timeOrigin,
    mode: app.mode, active: !!app.battle.active, paused: !!app.battle.paused, elapsed: app.battle.elapsed, testPause: !!app.testPause,
    playerPresent: !!app.battle.player, attackHeld: app.input.attackHeld, playerHP: app.battle.player?.hp, auto: app.battle.player?.auto,
    result: app.battle.result ? { win: app.battle.result.win } : null, stage: app.battle.stage?.code,
    inputEnabled: app.input.enabled, modal: !!document.querySelector('#modal.show'), resultVisible: !!document.querySelector('#result.show') }));
  report.states.push({ label, ...value }); await checkpoints.capture(1, label); return value;
};
const shot = async name => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f, timeout: 60000 }); report.screenshots.push(f); };
try {
  report.build = JSON.parse(await readFile(path.join(root, 'dist/version.json'), 'utf8'));
  server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`; report.origin = origin;
  browser = await chromium.launch(launchOpts({ headless: true, env: { ...process.env, FONTCONFIG_FILE: '/tmp/blade-qa-fontconfig/fonts.conf' } }));
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 880, height: 400 }, serviceWorkers: 'block' });
  await context.addInitScript(installConquestMediaObserver);
  await context.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page = await context.newPage(); session = await context.newCDPSession(page);
  checkpoints = createMediaCheckpoints(page, report.media, report.mediaCheckpointDiagnostics, report.documents);
  const requests = new Map();
  page.on('pageerror', e => report.errors.push({ type: 'pageerror', message: String(e), at: stamp() }));
  page.on('console', m => { if (m.type() === 'error') report.errors.push({ type: 'console', message: m.text(), at: stamp() }); else if (m.type() === 'warning') report.warnings.push({ text: m.text(), at: stamp() }); });
  page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ url: r.url(), status: r.status(), at: stamp() }); });
  page.on('requestfailed', r => report.playwrightFailedRequests.push({ url: r.url(), type: r.resourceType(), error: r.failure()?.errorText, at: stamp() }));
  for (const method of ['Media.playerCreated', 'Media.playersCreated', 'Media.playerEventsAdded', 'Media.playerPropertiesChanged', 'Media.playerMessagesLogged', 'Media.playerErrorsRaised']) {
    session.on(method, payload => report.cdpMedia.push({ method, receivedAt: stamp(), documentIdAtReceipt: 1, ownership: 'Not attributed solely from receipt document; inspect original native player IDs/load lifetime.', payload }));
  }
  session.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) report.documents.push({ kind: 'cdp-root-frame', frameId: frame.id, loaderId: frame.loaderId, url: frame.url, at: stamp() }); });
  session.on('Network.requestWillBeSent', e => {
    const row = { engine: 'chromium', documentId: 1, requestId: e.requestId, frameId: e.frameId, loaderId: e.loaderId,
      url: e.request.url, method: e.request.method, type: e.type?.toLowerCase(), range: e.request.headers.Range || e.request.headers.range || null,
      nativeStarted: e.timestamp, nativeWallTime: e.wallTime, started: e.wallTime * 1000, nodeStartedAt: stamp(),
      documentTimeOrigin: report.documents.find(d => d.documentId === 1)?.timeOrigin ?? null };
    requests.set(e.requestId, row); report.network.push(row);
  });
  session.on('Network.responseReceived', e => {
    const row = requests.get(e.requestId); if (!row) return;
    Object.assign(row, { type: e.type?.toLowerCase(), status: e.response.status, nativeResponseAt: e.timestamp,
      responseAt: row.started + (e.timestamp - row.nativeStarted) * 1000,
      contentRange: e.response.headers['content-range'] || e.response.headers['Content-Range'] || null, mimeType: e.response.mimeType });
  });
  session.on('Network.loadingFinished', e => { const row = requests.get(e.requestId); if (row) Object.assign(row, { nativeFinishedAt: e.timestamp, encodedDataLength: e.encodedDataLength }); });
  session.on('Network.loadingFailed', e => {
    const row = requests.get(e.requestId) || { engine: 'chromium', documentId: 1, requestId: e.requestId };
    Object.assign(row, { nativeFailedAt: e.timestamp, failedAt: Number.isFinite(row.started) ? row.started + (e.timestamp - row.nativeStarted) * 1000 : stamp(), nodeFailureAt: stamp(), error: e.errorText, canceled: e.canceled, blockedReason: e.blockedReason });
    report.requestFailures.push(row);
    if (!closing) void checkpoints.capture(1, 'native-loading-failed', row.documentTimeOrigin);
  });
  await session.send('Page.enable'); await session.send('Network.enable'); await session.send('Media.enable'); await session.send('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 }); await checkpoints.bindDocument(1);
  await page.locator('#boot-start:not(.hidden)').waitFor({ state: 'visible', timeout: 180000 }); await click('#boot-start');
  await page.waitForFunction(() => app.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 90000 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await page.locator('#modal.show #m-cancel').isVisible()) await click('#modal.show #m-cancel');
    if (await page.locator('.citadel-command-campaign').isVisible()) { await page.waitForTimeout(700); if (!await page.locator('#modal.show').isVisible()) break; }
    await page.waitForTimeout(400);
  }
  await page.locator('.citadel-command-campaign').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => __conquestMedia.snapshot().tracks.some(t => t.src.endsWith('/bgm/regions/lobby.mp3') && !t.paused && t.connected && t.currentTime > 1 && t.readyState >= 2), null, { timeout: 30000 });
  check(true, 'Lobby media decodes and plays before handoff', await state('lobby-playback')); await save();
  await click('.citadel-command-campaign'); await click('#st-go');
  await page.waitForFunction(() => app.mode === 'battle' && app.battle.active && !app.stageStarting, null, { timeout: 90000 });
  await page.waitForTimeout(4500); const battle = await state('native-battle-handoff');
  check(battle.stage === '1-1' && !battle.testPause, 'Native stage entry without fixed stepping or grants', battle);
  await shot('01-battle-after-music-handoff'); await state('post-battle-screenshot'); await save();
  await click('#btn-pause'); const paused = await state('native-pause'); await page.waitForTimeout(1200); const still = await state('native-pause-stable');
  check(still.paused && still.elapsed === paused.elapsed && !still.attackHeld, 'Pause freezes natural time before giveup', { paused, still });
  await click('#btn-giveup');
  await page.locator('#btn-result-lobby').waitFor({ state: 'visible', timeout: 90000 });
  const result = await state('native-giveup-result'); check(!result.active && result.result?.win === false && result.resultVisible, 'Native giveup reaches real defeat result', result);
  await shot('02-native-defeat-result'); await click('#btn-result-lobby');
  await page.waitForFunction(() => app.mode === 'lobby', null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const lobby = await state('native-return-lobby'); check(!lobby.active && !lobby.playerPresent && !lobby.attackHeld && !lobby.testPause, 'Native result returns to clean lobby lifecycle', lobby);
  await shot('03-native-return-lobby'); await state('final-observation'); await checkpoints.drain();
  report.jsLifecycleAssessment = assessMediaObservations(report);
  check(report.errors.length === 0 && report.httpErrors.length === 0 && report.mediaCheckpointDiagnostics.length === 0, 'No runtime, HTTP or media observation errors', { errors: report.errors, httpErrors: report.httpErrors, diagnostics: report.mediaCheckpointDiagnostics });
  report.status = report.jsLifecycleAssessment.passed ? 'FUNCTIONAL_PASS_NATIVE_MEDIA_REVIEW_REQUIRED' : 'FUNCTIONAL_PASS_MEDIA_UNRESOLVED';
} catch (e) { report.status = 'FAIL'; report.failure = String(e?.stack || e); try { if (page) await shot('failure'); } catch {} }
finally {
  if (checkpoints) { try { await checkpoints.capture(1, 'pre-close-final'); await checkpoints.drain(); } catch {} }
  closing = true; report.finishedAt = new Date().toISOString(); await save();
  await session?.detach(); await browser?.close(); await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve());
}
console.log(JSON.stringify({ status: report.status, report: path.join(out, 'report.json'), checks: report.checks.length, requestFailures: report.requestFailures.length, failure: report.failure }, null, 2));
process.exitCode = report.status === 'FAIL' ? 1 : 0;
