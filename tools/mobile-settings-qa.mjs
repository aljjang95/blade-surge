// Compiled local UI and browser media observations. No real-user save or remote browser.
import { chromium, firefox, webkit, devices } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'work/mobile-settings-qa');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const sizes = [[320, 568], [390, 844], [412, 915], [667, 375], [844, 390], [1024, 768]];
const files = ['src/ui/meta.js', 'src/ui/mobile-combat.css', 'src/platform/app-mode.js', 'src/platform/app-mode.css', 'src/platform/pwa.js', 'src/companion/CompanionPanel.tsx', 'src/companion/bootstrap.ts', 'src/companion/companion.css', 'src/engine/audio.js', 'src/data/music.js', 'tools/mobile-settings-qa.mjs'];
const report = { status: 'running', started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Current compiled game, actual UI taps and original browser media playback. Three local engines, six resized layouts each. Programmatic scrolling and viewport/touch/UA emulation are not physical gestures or OS installation. No player save fixture, spending, time/stat changes or audible-output claim.',
  sources: Object.fromEntries(await Promise.all(files.map(async p => [p, hash((await fs.readFile(path.join(root, p), 'utf8')).replaceAll('\r\n', '\n'))]))), engines: [] };
await fs.mkdir(out, { recursive: true }); await fs.copyFile(import.meta.filename, path.join(out, 'driver.mjs'));
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

function observeMedia() {
  const tracks = [], events = [], sources = new WeakMap();
  const state = t => { const el = t.ref.deref(); if (!el) return { ...t.last, connected: t.connected, collected: true };
    return t.last = { id: t.id, src: el.currentSrc || el.src, time: el.currentTime, paused: el.paused, error: el.error?.code || null, connected: t.connected, collected: false }; };
  window.__settingsMedia = { snapshot: () => ({ at: Date.now(), tracks: tracks.map(state), events: [...events] }) };
  const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
  const create = Context.prototype.createMediaElementSource, disconnect = AudioNode.prototype.disconnect;
  Context.prototype.createMediaElementSource = function (el) {
    const node = create.call(this, el), track = { id: tracks.length + 1, ref: new WeakRef(el), connected: true }; tracks.push(track); sources.set(node, track); state(track);
    for (const kind of ['playing', 'pause', 'error']) el.addEventListener(kind, () => events.push({ kind, at: Date.now(), ...state(track) }));
    return node;
  };
  AudioNode.prototype.disconnect = function (...args) { const result = disconnect.apply(this, args), track = sources.get(this); if (track) { track.connected = false; events.push({ kind: 'source-disconnect', at: Date.now(), ...state(track) }); } return result; };
}

async function mediaProgress(page, suffix) {
  const available = await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function');
  if (!available) return { supported: false, reason: 'This local engine has no Web Audio constructor; existing silent fallback, no playback claim.' };
  await page.waitForFunction(suffix => window.__settingsMedia.snapshot().tracks.some(t => t.src.endsWith(suffix) && t.connected && !t.paused && !t.error && t.time > .2), suffix, { timeout: 20000 });
  const before = await page.evaluate(() => window.__settingsMedia.snapshot()); await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__settingsMedia.snapshot());
  const track = after.tracks.find(t => t.src.endsWith(suffix) && t.connected), earlier = before.tracks.find(t => t.id === track.id);
  assert(track.time > earlier.time + .2 && !track.error && !track.paused, 'Media playback did not advance');
  return { supported: true, before, after };
}

async function hit(page, selector, minimum = 44) {
  return page.locator(selector).evaluate((e, minimum) => {
    const r = e.getBoundingClientRect(), points = [[.5, .5], [.12, .12], [.88, .12], [.12, .88], [.88, .88]];
    const hits = points.map(([x, y]) => { const found = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y); return found === e || e.contains(found); });
    if (r.height < minimum || r.width <= 0 || r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || !hits.every(Boolean)) throw Error('Clipped or covered control: ' + e.outerHTML.slice(0, 100));
    return { width: r.width, height: r.height, hits };
  }, minimum);
}

let server, browser, page, networkFault = false;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } }); const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  // This test owns the preview server. Reset its TCP connections only during the
  // isolated offline-shell probe; no mocked worker or browser-global connectivity.
  server.httpServer.prependListener('request', request => { if (networkFault) request.socket.destroy(); });
  report.version = await (await fetch(origin + '/version.json')).json();
  report.entry = (await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  report.entrySha256 = hash(await fs.readFile(path.join(root, 'dist' + report.entry)));
  const manifest = await (await fetch(origin + '/manifest.webmanifest')).json();
  assert(manifest.display === 'fullscreen' && manifest.display_override.includes('standalone'), 'PWA app display modes missing');
  for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
    const row = { engine, status: 'running', layouts: [], errors: [], requestFailures: [], mediaResponses: [] }; report.engines.push(row);
    browser = await launcher.launch(); row.version = browser.version();
    const ua = engine === 'chromium' ? devices['Pixel 7'].userAgent : engine === 'webkit' ? devices['iPhone 13'].userAgent : undefined;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine !== 'firefox', ...(ua ? { userAgent: ua } : {}) });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => row.errors.push(String(e)));
    const mediaRequests = new WeakMap();
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/bgm/')) mediaRequests.set(r, { url: r.url(), started: Date.now(), range: r.headers().range || null, type: r.resourceType() }); });
    page.on('requestfailed', r => row.requestFailures.push({ ...mediaRequests.get(r), url: r.url(), error: r.failure()?.errorText, at: Date.now() }));
    page.on('response', r => { const request = mediaRequests.get(r.request()); if (request) { request.status = r.status(); request.responded = Date.now(); request.contentRange = r.headers()['content-range'] || null; } });
    page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/bgm/')) row.mediaResponses.push({ url: r.url(), status: r.status(), at: Date.now(), range: r.headers()['content-range'] || null }); });
    await page.addInitScript(observeMedia);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await hit(page, '#app-mode-boot-install'); await page.locator('#app-mode-boot-install').tap();
    await page.locator('#app-mode-dialog:modal').waitFor(); row.bootGuide = await page.locator('#app-mode-guide').innerText();
    await page.locator('#app-mode-close').tap(); assert(await page.locator('#app-mode-boot-install').evaluate(e => e === document.activeElement), 'Boot install lost focus');
    await page.locator('#boot-start').tap(); await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 45000 });
    await page.waitForTimeout(1000); if (await page.locator('#modal.show #m-cancel').isVisible()) await page.locator('#m-cancel').tap();
    row.lobbyMusic = await mediaProgress(page, '/bgm/regions/lobby.mp3');
    const originalSettings = await page.evaluate(() => structuredClone(window.app.eco.s.settings));
    for (const [width, height] of sizes) {
      const layout = { width, height }; await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
      if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
      await hit(page, '#app-mode-open'); await hit(page, '.companion-lobby-launcher');
      await page.locator('#btn-settings').tap(); await page.locator('#modal.show').waitFor();
      for (const selector of ['#cam-desc', '#input-help']) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const box = await page.locator(selector).evaluate(e => { const r = e.getBoundingClientRect(), panel = e.closest('.modal-box').getBoundingClientRect(); return { text: e.textContent, width: r.width, height: r.height, inside: r.left >= panel.left && r.right <= panel.right, overflow: e.scrollWidth > e.clientWidth + 1 }; });
        assert(box.inside && !box.overflow && box.height > 0, 'Settings help clipped: ' + JSON.stringify(box)); layout[selector.slice(1)] = box;
      }
      assert(layout['input-help'].text.includes('조이스틱') && !layout['input-help'].text.includes('WASD'), 'Touch settings show keyboard-only help');
      layout.panelOverflow = await page.locator('#modal-box').evaluate(e => e.scrollWidth > e.clientWidth + 1); assert(!layout.panelOverflow, 'Settings panel scrolls sideways');
      await page.locator('#pwa-install').scrollIntoViewIfNeeded(); await hit(page, '#pwa-install', 36);
      await page.locator('#m-cancel').scrollIntoViewIfNeeded(); await hit(page, '#m-cancel');
      await page.screenshot({ path: path.join(out, engine + '-' + width + 'x' + height + '-settings.png') });
      await page.locator('#m-cancel').tap(); await page.locator('#app-mode-open').tap(); await page.locator('#app-mode-dialog:modal').waitFor();
      layout.installGuide = await page.locator('#app-mode-guide').innerText(); assert(/홈 화면|설치/.test(layout.installGuide), 'Missing install instructions');
      if (engine === 'webkit') assert(layout.installGuide.includes('Safari'), 'Missing iOS route');
      if (engine === 'chromium') assert(layout.installGuide.includes('Chrome'), 'Missing Android route');
      await page.locator('#app-mode-install').scrollIntoViewIfNeeded(); await hit(page, '#app-mode-install');
      await page.locator('#app-mode-close').scrollIntoViewIfNeeded(); await hit(page, '#app-mode-close'); await page.locator('#app-mode-close').tap();
      assert(await page.locator('#app-mode-open').evaluate(e => e === document.activeElement), 'Lobby install lost focus');
      await page.locator('.companion-lobby-launcher').tap(); await page.locator('#companion-panel:modal').waitFor();
      await hit(page, '.companion-close'); await page.locator('.companion-close').tap(); await page.locator('#companion-panel').waitFor({ state: 'detached' });
      assert(await page.locator('.companion-lobby-launcher').evaluate(e => e === document.activeElement), 'Neve lost focus');
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'Document overflow');
      layout.status = 'pass'; row.layouts.push(layout); await save(); console.log(engine + ' ' + width + 'x' + height + ': settings/PWA/Neve pass');
    }
    const afterSettings = await page.evaluate(() => window.app.eco.s.settings);
    assert(JSON.stringify(originalSettings) === JSON.stringify(afterSettings), 'Read-only settings visits changed preferences');
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(150);
    row.departed = Date.now(); await page.locator('#btn-battle').tap(); await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting, null, { timeout: 45000 });
    assert(!await page.locator('.companion-pause-launcher').isVisible() && !await page.locator('#companion-panel').isVisible(), 'Neve covers active battle');
    await page.locator('#btn-pause').tap(); await page.waitForFunction(() => window.app.battle.paused);
    await page.locator('.companion-pause-launcher').scrollIntoViewIfNeeded(); await page.locator('.companion-pause-launcher').tap(); await page.locator('#companion-panel:modal').waitFor();
    await page.locator('.companion-close').tap(); await page.locator('#companion-panel').waitFor({ state: 'detached' });
    assert(await page.evaluate(() => window.app.battle.paused), 'Closing Neve silently resumed combat');
    row.battleMusic = await mediaProgress(page, '/bgm/regions/garden.mp3');
    if (row.battleMusic.supported) { const tracks = row.battleMusic.after.tracks; assert(tracks.filter(t => t.connected).length === 1 && tracks.find(t => t.src.endsWith('/bgm/regions/lobby.mp3')).paused, 'Old track remains after fade'); }
    await page.locator('#btn-resume').scrollIntoViewIfNeeded(); await page.locator('#btn-resume').tap();
    await page.waitForFunction(() => !window.app.battle.paused); assert(!await page.locator('.companion-pause-launcher').isVisible(), 'Neve remains visible after resume');
    row.mediaFinal = await page.evaluate(() => window.__settingsMedia.snapshot());
    assert(row.mediaResponses.every(r => [200, 206].includes(r.status)), 'BGM returned an unsuccessful HTTP status');
    assert(!row.mediaFinal.events.some(e => e.kind === 'error'), 'Browser media error observed');
    assert(!row.errors.length && !row.requestFailures.length, 'Observed page/network failures: ' + JSON.stringify({ errors: row.errors, requests: row.requestFailures }));
    row.networkObservationEnded = Date.now();
    // Intentional context disposal is outside the completed online-play probe.
    // Close it before the separate offline context changes the owned server.
    page.removeAllListeners('requestfailed'); page.removeAllListeners('response'); page.removeAllListeners('pageerror');
    await context.close();
    if (engine === 'chromium') {
      const desktop = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false });
      const desktopPage = await desktop.newPage();
      try {
        await desktopPage.goto(origin, { waitUntil: 'domcontentloaded' }); await desktopPage.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
        await desktopPage.locator('#boot-start').click(); await desktopPage.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'));
        await desktopPage.waitForTimeout(800); if (await desktopPage.locator('#modal.show #m-cancel').isVisible()) await desktopPage.locator('#modal.show #m-cancel').click();
        await desktopPage.locator('#btn-settings').click(); await desktopPage.locator('#input-help').scrollIntoViewIfNeeded();
        row.desktopHelp = await desktopPage.locator('#input-help').innerText();
        assert(row.desktopHelp.includes('WASD') && row.desktopHelp.includes('1~6') && row.desktopHelp.includes('R/Q/E') && !row.desktopHelp.includes('조이스틱'), 'Keyboard controls are not described accurately');
      } finally { await desktop.close(); }
    }
    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const offlinePage = await offlineContext.newPage(); row.offline = { status: 'running', failures: [], phase: 'online' };
    offlinePage.on('requestfailed', r => row.offline.failures.push({ url: r.url(), error: r.failure()?.errorText, phase: row.offline.phase }));
    try {
      await offlinePage.goto(origin, { waitUntil: 'domcontentloaded' });
      await offlinePage.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
      await offlinePage.waitForFunction(async () => { if (!navigator.serviceWorker.controller) return false; for (const name of await caches.keys()) if (await (await caches.open(name)).match('/offline.html')) return true; return false; }, null, { timeout: 60000 });
      row.offline.phase = 'tcp-reset'; networkFault = true; server.httpServer.closeAllConnections();
      const offlineResponse = await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      row.offline.shell = { status: offlineResponse.status(), fromServiceWorker: offlineResponse.fromServiceWorker(), text: await offlinePage.locator('body').innerText() };
      assert(row.offline.shell.fromServiceWorker && /오프라인|인터넷|연결/.test(row.offline.shell.text), 'Actual service worker did not supply the offline connection notice');
      await offlinePage.waitForTimeout(200);
      networkFault = false; row.offline.phase = 'online-return';
      await offlinePage.goto(origin, { waitUntil: 'domcontentloaded' });
      await offlinePage.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
      row.offline.returned = true;
      assert(!row.offline.failures.some(f => f.phase !== 'tcp-reset'), 'Unexpected online failure during offline recovery');
      row.offline.status = 'pass';
    } finally { networkFault = false; await offlineContext.close(); }
    row.status = 'pass'; await save(); await browser.close(); browser = null;
  }
  report.status = 'pass';
} catch (e) { report.status = 'fail'; report.failure = String(e.stack || e); process.exitCode = 1; if (page) try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch {} }
finally { networkFault = false; await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve()); report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, failure: report.failure })); }
