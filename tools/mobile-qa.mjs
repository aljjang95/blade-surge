// 모바일 프로필의 실제 브라우저 입력/생명주기 검증. 게임 상태와 프레임 시계를 쓰지 않는다.
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { installConquestMediaObserver } from './conquest-media-observer.mjs';
import { createMediaCheckpoints, assessMediaObservations } from './qa-media-checkpoints.mjs';
import { runMobileJourneyChecks } from './mobile-journey-checks.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
if (flag('help')) {
  console.log('node tools/mobile-qa.mjs --origin=http://127.0.0.1:5175 --expected-sha=<40 hex> --out=/absolute/new-directory [--artifact-dir=/absolute/dist] [--profiles=android,iphone] [--journey] [--angle=swiftshader|d3d11] [--headed] [--empty-fonts-css] [--chrome=/usr/bin/chromium]');
  process.exit(0);
}
const origin = arg('origin'), expectedSha = arg('expected-sha'), out = path.resolve(arg('out') || '');
const artifactDir = path.resolve(arg('artifact-dir') || path.join(root, 'dist'));
const selected = (arg('profiles') || 'android,iphone').split(',');
const angle = arg('angle') || 'swiftshader';
if (!['swiftshader', 'd3d11'].includes(angle)) throw Error('Supported --angle=swiftshader|d3d11');
const allowedOrigin = origin === 'https://blade.tllhouse.com' || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin || '');
if (!allowedOrigin || !/^[a-f0-9]{40}$/.test(expectedSha || '') || !arg('out') || selected.some(name => !['android', 'iphone'].includes(name))) throw Error('Supply authorized --origin, full --expected-sha, new --out and valid --profiles');
let publicProxy;
if (origin === 'https://blade.tllhouse.com') {
  const source = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].find(key => process.env[key]);
  if (source) {
    let proxy;
    try { proxy = new URL(process.env[source]); } catch { throw Error('Configured public-origin proxy URL is invalid'); }
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) throw Error('Public-origin Chromium requires a configured credential-free HTTP(S) proxy without a path');
    const nodeEnvProxy = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy') || /(?:^|\s)--use-env-proxy(?:\s|$)/.test(process.env.NODE_OPTIONS || '');
    if (!nodeEnvProxy) throw Error('Restart Node 24 with NODE_USE_ENV_PROXY=1 so artifact fetch honors the configured proxy and NO_PROXY');
    publicProxy = { server: proxy.origin, source, protocol: proxy.protocol, nodeEnvProxy };
  }
}
const profiles = { android: { name: 'Pixel 7', device: devices['Pixel 7'] }, iphone: { name: 'iPhone 13', device: devices['iPhone 13'] } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function bounded(promise, label, milliseconds = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label}: native call timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // 실패 원본을 덮어쓰지 않는다.
const driver = await fs.readFile(import.meta.filename);
await fs.writeFile(path.join(out, 'driver.mjs'), driver, { flag: 'wx' });
for (const file of ['conquest-media-observer.mjs', 'qa-media-checkpoints.mjs', 'mobile-journey-checks.mjs']) await fs.copyFile(path.join(root, 'tools', file), path.join(out, file));
const report = {
  status: 'running', started: new Date().toISOString(), origin, expectedSha,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scenario: flag('journey') ? 'mobile-entry-and-dungeon-journey' : 'mobile-input-lifecycle', angle,
  driverSha256: hash(driver), headed: flag('headed'), emptyFontsCss: flag('empty-fonts-css'),
  proxy: publicProxy ? { configured: true, source: publicProxy.source, protocol: publicProxy.protocol, credentials: false, chromiumExplicitProxy: true, nodeEnvProxy: true, environmentPreserved: true } : { chromiumExplicitProxy: false, environmentPreserved: true },
  scope: 'Fresh isolated Chromium mobile DPR/user-agent/touch profiles, native CDP touch/orientation and actual tab visibility. Natural renderer-clock observation only. iPhone profile uses Chromium, not Safari. No physical phone/GPU/thermal/subjective audio or full native Android certification.',
  artifactDir, artifact: [], profiles: [],
};
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function releaseBytes(file) {
  assert(file.startsWith('/') && !file.startsWith('//') && !file.includes('..') && !file.includes('\\'), `Invalid artifact path ${file}`);
  const localPath = path.resolve(artifactDir, file === '/' ? 'index.html' : `.${file}`);
  assert(localPath.startsWith(artifactDir + path.sep), 'Artifact path escapes declared directory');
  const expected = await fs.readFile(localPath);
  const response = await fetch(new URL(file, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const match = bytes.length === expected.length && hash(bytes) === hash(expected);
  report.artifact.push({ path: file, status: response.status, bytes: bytes.length, sha256: hash(bytes), expectedBytes: expected.length, expectedSha256: hash(expected), match });
  assert(match, `${file}: served bytes differ from the preserved expected artifact`);
  return bytes;
}
async function versionGuard() {
  const value = JSON.parse(await releaseBytes('/version.json'));
  assert(value.sha === expectedSha && value.dirty === false, 'Served version is not the expected clean release');
  if (report.version) assert(JSON.stringify(value) === JSON.stringify(report.version), 'Release changed during mobile QA');
  else report.version = value;
}

function installInputObserver() {
  const observations = [];
  globalThis.__mobileInput = observations;
  const record = (event, phase) => {
    if (observations.length >= 3000) return;
    const a = globalThis.app;
    observations.push({ type: event.type, phase, at: performance.timeOrigin + performance.now(),
      trusted: event.isTrusted, target: event.target === globalThis ? 'window' : event.target?.id || event.target?.tagName,
      code: event.code || null, prevented: event.defaultPrevented, hidden: document.hidden,
      touches: event.changedTouches ? [...event.changedTouches].map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY,
        hit: document.elementFromPoint(t.clientX, t.clientY)?.id || document.elementFromPoint(t.clientX, t.clientY)?.tagName })) : null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      orientation: { type: screen.orientation?.type, angle: screen.orientation?.angle },
      active: document.activeElement?.id || document.activeElement?.tagName,
      clock: a?.renderer?.time, mode: a?.mode, enabled: a?.input?.enabled,
      queue: [...(a?.input?.queue || [])], held: a?.input?.attackHeld,
      sources: [...(a?.input?.attackSources || [])], player: a?.battle?.player?.state,
      paused: a?.battle?.paused, reasons: [...(a?.battle?.pauseReasons || [])],
      stageStarting: a?.stageStarting, contextLost: a?.contextLost, testPause: a?.testPause,
      playerDetail: a?.battle?.player ? { stateT: a.battle.player.stateT, comboIdx: a.battle.player.comboIdx, comboQueued: a.battle.player.comboQueued,
        attackBufferT: a.battle.player.attackBufferT, dodgeBufferT: a.battle.player.dodgeBufferT, alive: a.battle.player.alive } : null });
  };
  for (const type of ['orientationchange', 'resize', 'visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume', 'blur', 'focus', 'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    addEventListener(type, event => { record(event, 'before-product-listener'); setTimeout(() => record(event, 'after-native-task'), 0); }, true);
  }
  screen.orientation?.addEventListener('change', event => { record(event, 'screen-orientation'); });
}

let browser, chromiumProcess;
async function launchNativeBrowser(profileDir) {
  // 기본 Playwright page 세션의 강제 focus/visibility override를 만들지 않는다.
  const userDataDir = path.join(profileDir, 'isolated-chromium-profile');
  await fs.mkdir(userDataDir);
  const args = ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--use-gl=angle', `--use-angle=${angle}`, ...(angle === 'swiftshader' ? ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []), '--autoplay-policy=no-user-gesture-required'];
  if (publicProxy) args.push(`--proxy-server=${publicProxy.server}`);
  if (!flag('headed')) args.push('--headless=new');
  args.push('about:blank');
  chromiumProcess = spawn(arg('chrome') || process.env.CHROME_PATH || '/usr/bin/chromium', args, { stdio: 'ignore' });
  const started = Date.now(); let port;
  while (Date.now() - started < 20000) {
    assert(chromiumProcess.exitCode === null, 'Owned Chromium exited before CDP startup');
    try { port = (await fs.readFile(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(/^\d+$/.test(port || ''), 'Owned Chromium CDP startup timed out');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 30000 });
  return browser.contexts()[0];
}
async function closeNativeBrowser() {
  if (browser) await bounded(browser.close(), 'Owned Chromium close', 5000).catch(() => {});
  browser = null;
  if (chromiumProcess && chromiumProcess.exitCode === null && chromiumProcess.signalCode === null) {
    chromiumProcess.kill('SIGTERM');
    const started = Date.now();
    while (chromiumProcess.exitCode === null && chromiumProcess.signalCode === null && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 100));
    if (chromiumProcess.exitCode === null && chromiumProcess.signalCode === null) chromiumProcess.kill('SIGKILL');
  }
  chromiumProcess = null;
}
const deadline = setTimeout(() => { report.status = 'fail'; report.failure = 'Finite 35-minute mobile QA deadline exceeded'; void closeNativeBrowser().finally(save).finally(() => process.exit(1)); }, 2100000);
try {
  const expectedVersion = JSON.parse(await fs.readFile(path.join(artifactDir, 'version.json')));
  assert(expectedVersion.sha === expectedSha && expectedVersion.dirty === false, 'Preserved local artifact must have expected SHA and dirty=false');
  await versionGuard();
  const index = (await releaseBytes('/')).toString('utf8');
  assert(!index.includes('/@vite/client') && !index.includes('/src/main.js'), 'Compiled release required, not dev server');
  const files = [...new Set([...index.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]))];
  assert(files.some(file => /index-.*\.js$/.test(file)), 'Compiled index script missing');
  for (const file of files) await releaseBytes(file);
  for (const profileName of selected) {
    const profile = profiles[profileName], device = profile.device, dir = path.join(out, profileName);
    await fs.mkdir(dir);
    const r = { name: profileName, deviceName: profile.name, status: 'running', browserEngine: 'chromium',
      emulation: { viewport: device.viewport, screen: device.screen, deviceScaleFactor: device.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: device.userAgent },
      steps: [], screenshots: [], errors: [], httpErrors: [], requestFailures: [], playwrightFailedRequests: [], network: [], cdpMedia: [], media: [], mediaCheckpointDiagnostics: [], documents: [], input: [], diagnostics: [] };
    report.profiles.push(r); await save();
    const context = await launchNativeBrowser(dir); r.browserVersion = browser.version();
    r.browserControl = 'Owned isolated Chromium process; public connectOverCDP(noDefaults:true) preserves native tab visibility. Native CDP mobile overrides and touch; service worker network bypass.';
    await context.addInitScript(installConquestMediaObserver);
    await context.addInitScript(installInputObserver);
    if (flag('empty-fonts-css')) await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('**/api/**', route => { r.diagnostics.push({ kind: 'blocked-api', url: route.request().url(), method: route.request().method() }); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const session = await context.newCDPSession(page), requests = new Map();
    const nativeCall = (method, params, timeout) => bounded(session.send(method, params), method, timeout);
    let documentId = 0, backgroundPage, observationClosing = false;
    const checkpoints = createMediaCheckpoints(page, r.media, r.mediaCheckpointDiagnostics, r.documents);
    const stamp = () => Date.now();
    const safeCapture = reason => { if (documentId && !observationClosing) void checkpoints.capture(documentId, reason); };
    page.on('pageerror', error => r.errors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') r.errors.push({ kind: 'console', message: message.text() }); });
    page.on('response', response => { if (response.status() >= 400) r.httpErrors.push({ url: response.url(), status: response.status(), at: stamp() }); });
    page.on('requestfailed', request => { r.playwrightFailedRequests.push({ documentIdAtReceipt: documentId, url: request.url(), type: request.resourceType(), error: request.failure()?.errorText, at: stamp() }); });
    for (const method of ['Media.playerCreated', 'Media.playersCreated', 'Media.playerEventsAdded', 'Media.playerPropertiesChanged', 'Media.playerMessagesLogged', 'Media.playerErrorsRaised']) {
      session.on(method, payload => r.cdpMedia.push({ method, receivedAt: stamp(), documentIdAtReceipt: documentId, ownership: 'not-attributed-from-receipt-document', payload }));
    }
    session.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) r.documents.push({ kind: 'cdp-root-frame', documentIdAtReceipt: documentId, frameId: frame.id, loaderId: frame.loaderId, url: frame.url, at: stamp() }); });
    session.on('Network.requestWillBeSent', event => {
      const row = { engine: 'chromium', documentId, requestId: event.requestId, frameId: event.frameId, loaderId: event.loaderId,
        url: event.request.url, method: event.request.method, type: event.type?.toLowerCase(), range: event.request.headers.Range || event.request.headers.range || null,
        nativeStarted: event.timestamp, nativeWallTime: event.wallTime, started: event.wallTime * 1000, nodeStartedAt: stamp(),
        documentTimeOrigin: r.documents.find(doc => doc.documentId === documentId)?.timeOrigin ?? null };
      requests.set(event.requestId, row); r.network.push(row);
    });
    session.on('Network.responseReceived', event => {
      const row = requests.get(event.requestId); if (!row) return;
      Object.assign(row, { type: event.type?.toLowerCase(), status: event.response.status, nativeResponseAt: event.timestamp,
        responseAt: row.started + (event.timestamp - row.nativeStarted) * 1000,
        contentRange: event.response.headers['content-range'] || event.response.headers['Content-Range'] || null, mimeType: event.response.mimeType });
    });
    session.on('Network.loadingFinished', event => {
      const row = requests.get(event.requestId); if (!row) return;
      Object.assign(row, { nativeFinishedAt: event.timestamp, encodedDataLength: event.encodedDataLength });
    });
    session.on('Network.loadingFailed', event => {
      const row = requests.get(event.requestId) || { engine: 'chromium', documentId, requestId: event.requestId };
      Object.assign(row, { nativeFailedAt: event.timestamp, failedAt: Number.isFinite(row.started) ? row.started + (event.timestamp - row.nativeStarted) * 1000 : stamp(),
        nodeFailureAt: stamp(), error: event.errorText, canceled: event.canceled, blockedReason: event.blockedReason });
      r.requestFailures.push(row);
      if (!observationClosing) void checkpoints.capture(row.documentId, 'native-cdp-loadingfailed', row.documentTimeOrigin);
    });
    await nativeCall('Page.enable'); await nativeCall('Network.enable'); await nativeCall('Media.enable');
    await nativeCall('Network.setBypassServiceWorker', { bypass: true });
    await nativeCall('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await nativeCall('Emulation.setUserAgentOverride', { userAgent: device.userAgent });
    await nativeCall('Emulation.setDeviceMetricsOverride', { ...device.viewport, screenWidth: device.screen.width, screenHeight: device.screen.height,
      deviceScaleFactor: device.deviceScaleFactor, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });

    const state = () => page.evaluate(() => {
      const a = globalThis.app, b = a.battle, p = b?.player, pos = a.showcase?.root.position;
      const raw = localStorage.getItem('bladesurge_save_v1'), s = raw ? JSON.parse(raw) : null;
      return { at: performance.timeOrigin + performance.now(), documentTimeOrigin: performance.timeOrigin,
        mode: a.mode, clock: a.renderer.time, hidden: document.hidden, visibility: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth },
        orientation: { type: screen.orientation?.type, angle: screen.orientation?.angle },
        hallName: a.arena?.lobbyHall?.name, position: pos ? { x: pos.x, z: pos.z } : null,
        hubInput: { pointer: a.hubControls?.pointer?.id ?? null, stick: { ...a.hubControls?.stickMove } },
        input: { enabled: a.input.enabled, held: a.input.attackHeld, sources: [...a.input.attackSources], queue: [...a.input.queue], move: { ...a.input.move }, joy: { active: a.input.joy.active, id: a.input.joy.id } },
        selected: a.eco.s.selected, gold: a.eco.s.gold, inventory: a.eco.s.inventory.length, level: a.eco.hero().level,
        energy: a.eco.s.energy, pending: a.expedition.s.pending, autoBattle: a.journey.s.autoBattle,
        expedition: { level: a.expedition.s.level, xp: a.expedition.s.xp, stats: { ...a.expedition.s.stats }, claimed: [...a.expedition.s.claimed] },
        battle: { active: !!b?.active, paused: !!b?.paused, reasons: [...(b?.pauseReasons || [])], elapsed: b?.elapsed, result: b?.result ? { win: b.result.win, receipt: b.result.expeditionReceipt } : null },
        player: p ? { state: p.state, stateT: p.stateT, comboIdx: p.comboIdx, comboQueued: p.comboQueued, attackBufferT: p.attackBufferT, dodgeBufferT: p.dodgeBufferT, alive: p.alive,
          hp: p.hp, pos: { x: p.pos.x, z: p.pos.z }, cds: [...p.cds] } : null,
        stored: s ? { selected: s.selected, gold: s.gold, inventory: s.inventory.length, level: s.heroes?.[s.selected]?.level, energy: s.energy, pending: s.expedition?.pending, autoBattle: s.journey?.autoBattle } : null };
    });
    async function clockProgress(seconds = .2) {
      const clock = (await state()).clock;
      await page.waitForFunction(({ clock, seconds }) => app.renderer.time - clock >= seconds, { clock, seconds }, { timeout: 60000 });
    }
    async function step(name, action, diagnostic = false) {
      const row = { name, started: new Date().toISOString(), status: 'running', before: await state() };
      r.steps.push(row); await save();
      try { await action(row); row.after = await state(); row.status = diagnostic ? 'observation' : 'pass'; }
      catch (error) { row.status = 'fail'; row.error = String(error.stack || error); try { row.after = await state(); } catch {} throw error; }
      finally { row.finished = new Date().toISOString(); await checkpoints.capture(documentId, name); await save(); console.log(JSON.stringify({ profile: profileName, step: name, status: row.status, accepted: row.accepted, out })); }
    }
    async function screenshot(name) {
      const file = `${name}.png`;
      const started = Date.now();
      // 실제 표시할 이미지의 로드·decode와 CSS 배경의 native 완료를 기다린다.
      // 파일을 미리 요청하거나 DOM·게임·저장·프레임 시계를 바꾸지 않는다.
      await page.waitForFunction(() => [...document.images].filter(el => {
        const r = el.getBoundingClientRect();
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
      }).every(el => el.complete && el.naturalWidth > 0), undefined, { timeout: 30000 });
      const artwork = await page.evaluate(async () => {
        const visible = el => { const r = el.getBoundingClientRect(); return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; };
        const images = [...document.images].filter(visible);
        await Promise.all(images.map(el => el.decode()));
        const backgrounds = [...document.querySelectorAll('.dungeon-journey-map,.citadel-hub-destination-art')].filter(visible)
          .flatMap(el => [...getComputedStyle(el).backgroundImage.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]));
        return { images: images.map(el => ({ src: el.currentSrc, width: el.naturalWidth, height: el.naturalHeight })), backgrounds };
      });
      while (!artwork.backgrounds.every(url => r.network.some(row => row.documentId === documentId && row.url === url && Number.isFinite(row.nativeFinishedAt)))) {
        if (Date.now() - started > 30000) throw Error(`${name}: visible CSS artwork did not finish loading`);
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const nativeImage = await nativeCall('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 60000);
      await fs.writeFile(path.join(dir, file), Buffer.from(nativeImage.data, 'base64'));
      const layout = await page.evaluate(() => [...document.querySelectorAll('.citadel-hub-near,.citadel-hub-interact,#hud.show #btn-pause,#hud.show #btn-attack,#hud.show .skill-btn,#hud.show #joy,.exp-result-shell,.exp-result-shell .exp-close')].map(el => {
        const b = el.getBoundingClientRect(); return { id: el.id, class: el.className, text: el.innerText?.slice(0, 160), x: b.x, y: b.y, width: b.width, height: b.height }; }));
      const s = await state(); assert(s.viewport.scrollWidth <= s.viewport.width + 1, `${name}: horizontal overflow`);
      r.screenshots.push({ file: `${profileName}/${file}`, sha256: hash(await fs.readFile(path.join(dir, file))), state: s, layout, artwork: { ...artwork, waitMs: Date.now() - started } }); await save();
    }
    async function boot(reload = false) {
      if (reload) { await checkpoints.beforeNavigation(documentId); r.input.push({ documentId, events: await page.evaluate(() => __mobileInput) }); }
      documentId++;
      if (reload) await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      else await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await checkpoints.bindDocument(documentId);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      for (const row of r.network.filter(row => row.documentId === documentId)) row.documentTimeOrigin = timeOrigin;
      const portrait = page.locator('#btn-ignore-rotate');
      if (await portrait.isVisible()) await shortTouch(portrait);
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
      if (flag('journey')) {
        const entry = await page.evaluate(() => { const button = document.querySelector('#boot-start'), box = button.getBoundingClientRect(); return { text: button.textContent, fullscreen: !!document.fullscreenElement, reachable: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }; });
        assert(entry.reachable, 'Portrait rotation hint covered the primary start button');
        r.diagnostics.push({ kind: 'start-screen', reload, ...entry });
        if (!reload && !entry.fullscreen) assert(entry.text === '전체화면 · 가로로 시작', 'Mobile primary start must offer fullscreen and landscape');
        await screenshot(reload ? 'reload-entry' : 'mobile-fullscreen-entry');
      }
      await shortTouch('#boot-start');
      await page.waitForFunction(() => app.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
      if (flag('journey')) r.diagnostics.push({ kind: 'screen-request', reload, ...await page.evaluate(() => ({ fullscreen: !!document.fullscreenElement, request: app.appModeView.lastLandscapeRequest, width: innerWidth, height: innerHeight })) });
      if (await portrait.isVisible()) await shortTouch(portrait);
      const modal = page.locator('#modal.show #m-cancel'); if (await modal.isVisible()) await shortTouch(modal);
      // 출격 메뉴를 기본 로비로 쓰는 여정과 기존 마을 이동 검증의 진입점을 구분한다.
      if (flag('journey')) await page.locator('#citadel-command:not([hidden])').waitFor();
      else {
        if (await page.locator('#citadel-explore').isVisible()) await shortTouch('#citadel-explore');
        await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
      }
      await clockProgress();
      assert((await state()).hallName === 'Citadel_PlayableHub', 'Current authored playable hub did not load');
      await checkpoints.capture(documentId, reload ? 'reload-boot' : 'fresh-boot');
    }
    async function touch(type, points = []) { await nativeCall('Input.dispatchTouchEvent', { type, touchPoints: points }); }
    async function center(selector, stable = true) {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector;
      await locator.waitFor({ state: 'visible' });
      if (stable) {
        await locator.scrollIntoViewIfNeeded();
        const handle = await locator.elementHandle(); try { await handle.waitForElementState('stable', { timeout: 30000 }); } finally { await handle.dispose(); }
      }
      const point = await locator.evaluate((el, isJoystick) => {
        const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, hit = document.elementFromPoint(x, y);
        return { x, y, id: 1, width: b.width, height: b.height, hit: hit?.id || hit?.tagName,
          reachable: isJoystick ? !!hit?.closest('#joy') : hit === el || el.contains(hit) };
      }, typeof selector === 'string' && selector.startsWith('#joy'));
      assert(point && point.width > 0 && point.height > 0 && point.reachable, `Touch target missing/covered ${selector}: ${JSON.stringify(point)}`);
      return { x: point.x, y: point.y, id: point.id };
    }
    async function shortTouch(selector, stable = true) {
      const point = await center(selector, stable); await touch('touchStart', [point]); await touch('touchEnd');
      return state();
    }
    async function neutral() { await page.waitForFunction(() => app.battle.player.state === 'idle' && !app.fx.trails.length, undefined, { timeout: 60000 }); }
    async function joystick(selector, playerMode) {
      const point = await center(selector), before = await state();
      await touch('touchStart', [point]);
      try { await touch('touchMove', [{ ...point, x: point.x + 38 }]); await clockProgress(.2); }
      finally { await touch('touchEnd'); }
      const after = await state(), from = playerMode ? before.player.pos : before.position, to = playerMode ? after.player.pos : after.position;
      return { distance: Math.hypot(to.x - from.x, to.z - from.z), before, after };
    }
    async function rotate(landscape) {
      const width = landscape ? device.viewport.height : device.viewport.width, height = landscape ? device.viewport.width : device.viewport.height;
      await nativeCall('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, mobile: true, deviceScaleFactor: device.deviceScaleFactor,
        screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 } });
    }

    try {
      await boot(); await screenshot('portrait-hub');
      if (flag('journey')) {
        await runMobileJourneyChecks({ page, device, nativeCall, shortTouch, state, step, screenshot, boot, clockProgress });
      } else {
      await step('Portrait native touch hub joystick and release', async row => {
        row.touch = await joystick('.citadel-hub-stick', false);
        assert(row.touch.distance > .05, 'Hub touch joystick did not move in natural frames');
        assert(row.touch.after.hubInput.pointer === null && row.touch.after.hubInput.stick.x === 0 && row.touch.after.hubInput.stick.y === 0, 'Hub touch release retained stick input');
      });
      await step('Native touch standard Glass admission', async row => {
        await shortTouch('#btn-expedition'); await shortTouch('.adventure-nav [data-section="dungeons"]');
        await shortTouch(page.locator('.exp-route-tabs').getByRole('button', { name: '기본 원정', exact: true }));
        await shortTouch('.exp-dungeon-details > summary');
        await shortTouch(page.locator('[data-dungeon="glass_garden"][data-depth="standard"]').getByRole('button', { name: '던전 입장', exact: true }));
        await page.waitForFunction(() => app.battle?.active && !app.stageStarting && !document.querySelector('.exp-cinematic'), undefined, { timeout: 180000 });
        await clockProgress(); const s = await state();
        assert(s.pending?.target === 'glass_garden' && s.pending.depth === 'standard' && s.energy === row.before.energy - 4 && !s.autoBattle && s.input.enabled, 'Actual manual admission/energy/input mismatch');
      });
      await screenshot('portrait-battle');
      await step('Portrait touch battle joystick and release', async row => {
        row.touch = await joystick('#joy .joy-base', true); assert(row.touch.distance > .05, 'Battle touch joystick did not move');
        assert(!row.touch.after.input.joy.active && row.touch.after.input.move.x === 0 && row.touch.after.input.move.y === 0, 'Battle joystick release retained input');
      });
      await step('Native portrait-to-landscape orientation and immediate short touch attack', async row => {
        await neutral(); row.eventsBefore = (await page.evaluate(() => __mobileInput)).length;
        await rotate(true); row.dispatched = false;
        try { row.immediate = await shortTouch('#btn-attack', false); row.dispatched = true; }
        catch (error) {
          if (!String(error).startsWith('Error: Touch target missing/covered')) throw error;
          row.guardError = String(error); row.outcome = 'notDispatched'; row.accepted = false;
        }
        if (row.dispatched) {
          try { await page.waitForFunction(() => app.battle.player.state === 'attack', undefined, { timeout: 30000 }); row.accepted = true; row.outcome = 'dispatchedAndAccepted'; }
          catch { row.accepted = false; row.outcome = 'dispatchedButNotAccepted'; }
        }
        row.inputEvents = (await page.evaluate(() => __mobileInput)).slice(row.eventsBefore);
        row.nativeOrientation = row.inputEvents.filter(e => ['orientationchange', 'resize', 'change'].includes(e.type));
        assert(row.nativeOrientation.some(e => e.trusted && e.viewport.width > e.viewport.height && (e.target === 'window' || e.phase === 'screen-orientation')), 'No native landscape orientation/resize event observed');
        row.scope = 'Immediate resize-adjacent input observation, separate from stabilized interaction gate. A missed tap remains a recorded diagnostic.';
        if (!row.accepted) { r.diagnostics.push({ kind: row.outcome, guardError: row.guardError, events: row.inputEvents }); console.log(JSON.stringify({ profile: profileName, diagnostic: row.outcome, guardError: row.guardError })); }
      }, true);
      await clockProgress(.3); await neutral(); await screenshot('landscape-battle');
      assert((await state()).orientation.type === 'landscape-primary', 'Screenshot changed native landscape orientation');
      await step('Stabilized native short touch attack', async row => {
        row.immediate = await shortTouch('#btn-attack');
        await page.waitForFunction(() => app.battle.player.state === 'attack', undefined, { timeout: 45000 }); row.accepted = await state();
        assert(!row.immediate.input.held, 'Touch end retained attackHeld'); await neutral();
      });
      await step('Stabilized held touch attack visible shader and release', async row => {
        await touch('touchStart', [await center('#btn-attack')]);
        try {
          await page.waitForFunction(() => app.battle.player.state === 'attack' && app.fx.trails.some(t => t.geo.drawRange.count > 0), undefined, { timeout: 60000 });
          row.observed = await page.evaluate(() => { const a = app, gl = a.renderer.r.getContext(); return { held: a.input.attackHeld, progress: a.battle.player.attackProgress(), trails: a.fx.trails.map(t => ({ shader: !!t.mat.isShaderMaterial, drawCount: t.geo.drawRange.count, alpha: [...t.alpha].filter(x => x > 0).length })), linked: a.renderer.r.info.programs.every(p => gl.getProgramParameter(p.program, gl.LINK_STATUS)) }; });
          assert(row.observed.held && row.observed.linked && row.observed.trails.some(t => t.shader && t.drawCount > 0 && t.alpha > 0), 'Native held touch did not produce linked visible ribbon');
          await screenshot('landscape-held-trail');
        } finally { await touch('touchEnd'); }
        assert(!(await state()).input.held, 'Held touch release retained attack'); await neutral();
      });
      await step('Actual touch skill and cooldown', async row => {
        row.immediate = await shortTouch('.skill-btn[data-skill="0"]');
        await page.waitForFunction(() => app.battle.player.state === 'skill' && app.battle.player.cds[0] > 0, undefined, { timeout: 45000 });
        row.accepted = await state(); await screenshot('landscape-skill'); await neutral();
      });
      await step('Pause clears touch ownership and explicit resume', async row => {
        await touch('touchStart', [await center('#btn-attack')]);
        try { await page.locator('#btn-pause').click(); } finally { await touch('touchEnd'); }
        const s = await state(); row.paused = s;
        assert(s.battle.paused && !s.input.enabled && !s.input.held && !s.input.queue.length, 'Manual pause retained touch ownership/queue');
        await shortTouch('#btn-resume'); await clockProgress();
        const after = await state(); assert(!after.battle.paused && after.input.enabled && !after.input.held && !after.input.queue.length, 'Explicit resume retained input or pause');
      });
      await step('Actual native background visibility pauses and explicit foreground resume', async row => {
        row.eventsBefore = (await page.evaluate(() => __mobileInput)).length;
        await touch('touchStart', [await center('#btn-attack')]);
        backgroundPage = await bounded(context.newPage(), 'Background tab creation');
        await bounded(backgroundPage.bringToFront(), 'Background tab activation');
        try { await page.waitForFunction(() => document.hidden && app.battle.paused, undefined, { timeout: 15000, polling: 100 }); row.hidden = await state(); }
        finally {
          // 숨긴 target의 touch ack를 기다리기 전에 실제 native foreground로 복귀한다.
          try { await nativeCall('Page.bringToFront'); }
          finally { await touch('touchEnd'); await bounded(backgroundPage.close(), 'Background tab close'); backgroundPage = null; }
        }
        await page.waitForFunction(() => !document.hidden, undefined, { timeout: 15000, polling: 100 });
        row.foreground = await state(); row.events = (await page.evaluate(() => __mobileInput)).slice(row.eventsBefore);
        assert(row.events.some(e => e.type === 'visibilitychange' && e.trusted && e.hidden), 'Native hidden visibility event missing');
        assert(row.foreground.battle.paused && !row.foreground.input.enabled && !row.foreground.input.held && !row.foreground.input.queue.length, 'Foreground resumed without explicit action or retained input');
        await shortTouch('#btn-resume'); await clockProgress(); assert(!(await state()).battle.paused, 'Foreground explicit resume failed');
      });
      await step('Real touch giveup receipt and return/reload save continuity', async row => {
        await shortTouch('#btn-pause'); await shortTouch('#btn-giveup');
        await page.locator('.exp-result-shell').waitFor({ timeout: 45000 }); row.settled = await state();
        assert(row.settled.battle.result?.win === false && row.settled.battle.result?.receipt?.ok && row.settled.pending === null, 'Actual zero-reward giveup receipt did not persist');
        await screenshot('actual-giveup-receipt');
        await shortTouch('.exp-result-shell .exp-close'); await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
        await clockProgress(); await checkpoints.capture(documentId, 'actual-return-before-reload');
        await boot(true); const reloaded = await state();
        for (const key of ['selected', 'gold', 'inventory', 'level', 'autoBattle']) assert(row.settled[key] === reloaded[key], `Reload changed settled ${key}`);
        assert(reloaded.pending === null && reloaded.stored.pending === null, 'Reload resurrected admission');
        await screenshot('reloaded-landscape-hub');
      });
      }
      assert(!r.errors.length && !r.httpErrors.length, 'Browser runtime or HTTP errors observed');
      r.functionalStatus = 'pass';
    } catch (error) {
      r.functionalStatus = 'fail'; r.failure = String(error.stack || error); process.exitCode = 1;
      try { await screenshot('failure'); } catch {}
      console.log(JSON.stringify({ profile: profileName, status: 'fail', failure: r.failure, out }));
    } finally {
      try {
        r.input.push({ documentId, events: await page.evaluate(() => __mobileInput) });
        await checkpoints.capture(documentId, 'final-before-context-close'); await checkpoints.drain();
        await context.storageState({ path: path.join(dir, 'storage-final.json') });
      } catch (error) { r.mediaCheckpointDiagnostics.push({ kind: 'final-observation', error: String(error) }); }
      observationClosing = true; await backgroundPage?.close(); await context.close(); await checkpoints.drain(); await closeNativeBrowser();
      const assessment = assessMediaObservations(r);
      r.mediaQualification = { ...assessment, nativePlayerCorrelation: 'Raw CDP media/network payloads preserved for independent instance/suspension/request review. JS classifier candidates alone do not establish native cancellation cause.' };
      r.status = r.functionalStatus !== 'pass' ? 'fail' : assessment.passed && !r.requestFailures.length ? 'functional-and-network-pass-awaiting-visual-review' : 'functional-pass-media-unresolved';
      r.finished = new Date().toISOString(); await save();
      console.log(JSON.stringify({ profile: profileName, status: r.status, functional: r.functionalStatus, errors: r.errors.length, httpErrors: r.httpErrors.length, rawRequestFailures: r.requestFailures.length, mediaUnresolved: assessment.mediaCancellations.unresolved.length, out }));
    }
  }
  await versionGuard();
  report.status = report.profiles.some(profile => profile.functionalStatus !== 'pass') ? 'fail' : report.profiles.some(profile => profile.status === 'functional-pass-media-unresolved') ? 'functional-pass-media-unresolved' : 'functional-and-network-pass-awaiting-visual-review';
} catch (error) { report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally { clearTimeout(deadline); await closeNativeBrowser(); report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, profiles: report.profiles.map(p => ({ name: p.name, status: p.status })), out, failure: report.failure })); }
