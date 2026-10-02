// Shared production-only evidence runtime. Source prepared; execution NOT_RUN.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { installConquestMediaObserver } from './conquest-media-observer.mjs';
import { assessMediaObservations, createMediaCheckpoints } from './qa-media-checkpoints.mjs';

export const qaArgument = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export const qaHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const qaAssert = (condition, message) => { if (!condition) throw Error(message); };
const live = 'https://blade.tllhouse.com';

export async function createExpeditionQa({ root, driver, report, sourceFiles }) {
  const output = qaArgument('out'), expected = qaArgument('expected-sha'), origin = qaArgument('origin');
  qaAssert(output && path.isAbsolute(output), 'Required --out=/NEW/absolute/output; parent must already exist');
  qaAssert(/^[0-9a-f]{40}$/.test(expected || ''), 'Required --expected-sha=<full committed release SHA>');
  qaAssert(!origin || origin === live || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Only local production preview or the fixed existing live origin is allowed');
  const out = path.resolve(output);
  await fs.mkdir(out); // Exclusive creation: do not modify any prior evidence.
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  Object.assign(report, { started: new Date().toISOString(), head: git(['rev-parse', 'HEAD']), expectedSha: expected,
    status: 'running', releaseApproved: false, errors: [], httpErrors: [], requestFailures: [], media: [], mediaCheckpointDiagnostics: [], documents: [], sources: {} });
  for (const file of sourceFiles) report.sources[file] = qaHash(await fs.readFile(path.join(root, file)));
  await fs.writeFile(path.join(out, 'driver.mjs'), await fs.readFile(driver), { flag: 'wx' });
  await fs.writeFile(path.join(out, 'runtime.mjs'), await fs.readFile(import.meta.filename), { flag: 'wx' });
  await fs.writeFile(path.join(out, 'media-observer.mjs'), await fs.readFile(path.join(root, 'tools/conquest-media-observer.mjs')), { flag: 'wx' });
  await fs.writeFile(path.join(out, 'media-checkpoints.mjs'), await fs.readFile(path.join(root, 'tools/qa-media-checkpoints.mjs')), { flag: 'wx' });
  const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await save();
  let server, browser, context, page, url, localVersionBytes, localIndexBytes, documentId = 0, ended = false, closed = false, checkpoints;
  const listenerDisposers = [], requests = new Map();
  const on = (name, listener) => { page.on(name, listener); listenerDisposers.push(() => page.off(name, listener)); };
  async function versionGuard() {
    qaAssert(git(['rev-parse', 'HEAD']) === expected && !git(['status', '--porcelain']), 'Freeze/commit the exact clean checkout before production QA');
    const localBytes = await fs.readFile(path.join(root, 'dist/version.json'));
    const localIndex = await fs.readFile(path.join(root, 'dist/index.html'));
    const localVersion = JSON.parse(localBytes);
    qaAssert(localVersion.sha === expected && localVersion.dirty === false && typeof localVersion.pwaRelease === 'string', 'dist is not the exact clean production build; helper never builds or uses dev');
    if (localVersionBytes) qaAssert(qaHash(localBytes) === qaHash(localVersionBytes) && qaHash(localIndex) === qaHash(localIndexBytes), 'Production artifact changed during QA');
    else { localVersionBytes = localBytes; localIndexBytes = localIndex; report.localArtifact = { version: localVersion, versionSha256: qaHash(localBytes), indexSha256: qaHash(localIndex) }; }
    if (url) {
      const versionResponse = await fetch(`${url}/version.json?qa=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      qaAssert(versionResponse.ok, `Production version response ${versionResponse.status}`);
      const served = await versionResponse.json();
      qaAssert(served.sha === expected && served.dirty === false && served.pwaRelease === localVersion.pwaRelease && served.builtAt === localVersion.builtAt, 'Served release differs from exact local production artifact');
      const indexResponse = await fetch(`${url}/?qa=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      qaAssert(indexResponse.ok, `Production index response ${indexResponse.status}`);
      const html = await indexResponse.text();
      qaAssert(!html.includes('/@vite/client') && !html.includes('/src/main.js') && /src=["']\/assets\/[^"']+\.js["']/.test(html), 'Expected compiled production modules, not a dev entry');
      qaAssert(qaHash(Buffer.from(html)) === qaHash(localIndex), 'Served production index does not match exact build bytes');
      report.build = served; report.servedIndexSha256 = qaHash(Buffer.from(html));
    }
    for (const [file, hash] of Object.entries(report.sources)) qaAssert(qaHash(await fs.readFile(path.join(root, file))) === hash, `Driver dependency changed: ${file}`);
  }
  async function start({ viewport = { width: 844, height: 390 } } = {}) {
    await versionGuard();
    if (!origin) server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
    url = origin || `http://127.0.0.1:${server.httpServer.address().port}`; report.origin = url;
    await versionGuard();
    browser = await chromium.launch(launchOpts());
    context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const storage = await context.storageState();
    qaAssert(storage.cookies.length === 0 && storage.origins.length === 0, 'Expected an isolated fresh browser context');
    report.contextInitiallyEmpty = true;
    page = await context.newPage(); page.setDefaultTimeout(30000);
    await page.addInitScript(installConquestMediaObserver);
    on('pageerror', error => report.errors.push(String(error)));
    on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    checkpoints = createMediaCheckpoints(page, report.media, report.mediaCheckpointDiagnostics, report.documents);
    on('request', request => requests.set(request, { engine: 'chromium', documentId,
      documentTimeOrigin: report.documents.find(document => document.documentId === documentId)?.timeOrigin ?? null, url: request.url(),
      type: request.resourceType(), range: request.headers().range || null, started: Date.now() }));
    on('response', response => {
      const request = response.request(), row = requests.get(request), timing = request.timing();
      if (row) Object.assign(row, { started: timing.startTime, status: response.status(),
        responseAt: timing.responseStart >= 0 ? timing.startTime + timing.responseStart : Date.now(),
        nodeResponseAt: Date.now(), contentRange: response.headers()['content-range'] || null });
      if (response.status() >= 400) report.httpErrors.push({ documentId, url: response.url(), status: response.status() });
    });
    on('requestfailed', request => {
      const row = requests.get(request), timing = request.timing();
      if (row) Object.assign(row, { started: timing.startTime, timing,
        failedAt: timing.responseEnd >= 0 ? timing.startTime + timing.responseEnd : Date.now(),
        nodeFailureAt: Date.now(), error: request.failure()?.errorText });
      const failed = row || { engine: 'chromium', documentId, url: request.url(),
        error: request.failure()?.errorText, failedAt: Date.now() };
      report.requestFailures.push(failed);
      // A real native zero-ms turn records failure-time evidence; clocks and
      // strict classifier windows are unchanged. Unbound/mismatched docs fail.
      checkpoints.capture(failed.documentId, 'native-requestfailed', failed.documentTimeOrigin ?? null);
    });
    await save(); return page;
  }
  async function captureMedia(label) {
    qaAssert(!closed && checkpoints, 'No active native observation document');
    await checkpoints.capture(documentId, label); await checkpoints.drain();
  }
  async function boot({ reload = false } = {}) {
    qaAssert(!ended, 'Observation window has ended');
    if (reload) await checkpoints.beforeNavigation(documentId);
    documentId++;
    if (reload) await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await checkpoints.bindDocument(documentId);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    // Only pacing changes. No Date/PRNG/profile/actor/input/decision override.
    await page.evaluate(() => { window.app.testPause = true; });
    await page.waitForTimeout(900);
    for (const selector of ['#modal.show #m-cancel', '#modal.show #m-guide-close']) {
      if (await page.locator(selector).isVisible()) await page.locator(selector).click();
    }
    await save();
  }
  function mediaGates() {
    const assessment = assessMediaObservations(report);
    report.mediaCancellations = assessment.mediaCancellations;
    // Empty, incomplete, erroneous or ambiguous native evidence cannot pass,
    // including a document that happened to have no failed request.
    const complete = report.documents.length > 0 && report.documents.every(document => report.media.some(media => media.documentId === document.documentId))
      && report.media.every(({ snapshot }) => snapshot.droppedEvents === 0
        && !snapshot.events.some(e => e.connectionAmbiguous || e.error || e.kind === 'error') && !snapshot.tracks.some(t => t.error));
    report.mediaGates = assessment.passed && complete ? 'pass' : 'fail';
    qaAssert(report.mediaGates === 'pass', 'Unresolved browser/runtime/network or incomplete native document-observation failures');
  }
  async function finishObservations() {
    qaAssert(!ended && !closed, 'Observation was already finalized');
    await versionGuard(); await captureMedia('final-before-context-close');
    await checkpoints.drain();
    report.functionalEndedAt = new Date().toISOString();
    report.status = 'functional-pass-pending-final-observation';
    ended = true; await save();
  }
  async function close() {
    if (closed) return report.mediaGates;
    // Preserve late failures through shutdown. No listener whitelist/detach
    // before browser close and no earlier PASS survives final assessment.
    try {
      if (!ended && page && !page.isClosed() && documentId) await captureMedia('failure-before-context-close');
      await checkpoints?.drain(); await browser?.close(); await checkpoints?.drain();
    } catch (error) { report.errors.push('QA cleanup: ' + String(error?.stack || error)); }
    try { await new Promise(resolve => server?.httpServer.close(resolve) || resolve()); }
    catch (error) { report.errors.push('QA preview cleanup: ' + String(error?.stack || error)); }
    for (const dispose of listenerDisposers) dispose();
    closed = true; report.observationEndedAt = new Date().toISOString();
    try { mediaGates(); } finally { await save(); }
    return report.mediaGates;
  }
  return { out, report, save, start, boot, captureMedia, finishObservations, close,
    get page() { return page; }, get origin() { return url; } };
}

export async function nativeInputObservation(page) {
  return page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player, focus = document.activeElement;
    return { focus: { tag: focus?.tagName || null, id: focus?.id || null, hasFocus: document.hasFocus(),
      blocked: !!focus?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls') },
      mode: a.mode, active: b.active, paused: b.paused, elapsed: b.elapsed,
      input: { enabled: a.input.enabled, queue: [...a.input.queue], attackHeld: a.input.attackHeld, sources: [...a.input.attackSources],
        keys: Object.fromEntries(['KeyJ', 'KeyK', 'Digit1', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].map(key => [key, !!a.input.keys[key]])) },
      player: { auto: p?.auto, alive: p?.alive, state: p?.state, stateT: p?.stateT, comboIdx: p?.comboIdx,
        currentAnim: p?.current?.anim || null, expectedAnim: p?.def.combo[p?.comboIdx]?.anim || null } };
  });
}
export async function nativeGameplayFocus(page) {
  const before = await nativeInputObservation(page);
  const target = await page.evaluate(() => {
    const canvas = document.querySelector('#gl'), bounds = canvas.getBoundingClientRect();
    for (const [rx, ry] of [[.5, .62], [.5, .5], [.5, .4], [.4, .62], [.6, .62], [.35, .5], [.65, .5]]) {
      const x = bounds.left + bounds.width * rx, y = bounds.top + bounds.height * ry;
      if (document.elementFromPoint(x, y) === canvas) return { x, y, canvas: canvas.id };
    }
    return null;
  });
  qaAssert(target, 'No unobstructed native gameplay canvas pixel');
  await page.mouse.click(target.x, target.y);
  const after = await nativeInputObservation(page);
  qaAssert(after.focus.hasFocus && !after.focus.blocked && after.mode === 'battle' && after.active && !after.paused && after.input.enabled && after.player.alive, 'Native canvas click did not establish actual gameplay focus/input');
  return { before, target, after };
}
