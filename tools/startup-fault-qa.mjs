#!/usr/bin/env node
// 시작(부팅) 호환성·실패 경로 브라우저 점검. 지정한 dist 를 루프백에서 서빙하고 장애 주입별로 실제 Chromium 에서 부팅한다.
// 사용: node tools/startup-fault-qa.mjs --dist dist --label candidate-repaired --out work/startup-incident
//        [--mode candidate|baseline] [--scenarios normal,hp-denied] [--capture all|failure-ui|none] [--viewport 1280x720]
// candidate 모드는 시나리오 기대를 하나라도 어기면 종료 코드 1 이다. baseline 모드는 관측 기록이며 PASS 판정을 내지 않는다.
// 실기기·실제 GPU 검증이 아니다(클라우드 SwiftShader). 저장 데이터는 새 브라우저 프로필 안에서만 다룬다.
// 비활성 출격 버튼을 강제로 누르거나 시간을 조작하지 않는다. 화면 캡처 실패는 기능 판정과 따로 기록한다.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const dist = path.resolve(opt('dist', 'dist'));
const label = opt('label', 'candidate');
const outDir = path.resolve(opt('out', 'work/startup-incident'));
const mode = opt('mode', 'candidate');
const capturePolicy = opt('capture', 'all');
const [vw, vh] = opt('viewport', '1280x720').split('x').map(Number);
if (!['candidate', 'baseline'].includes(mode)) throw new Error('--mode must be candidate or baseline');
if (!['all', 'failure-ui', 'none'].includes(capturePolicy)) throw new Error('--capture must be all, failure-ui or none');
if (!(vw > 0 && vh > 0)) throw new Error('--viewport must be WIDTHxHEIGHT');
const SAVE_KEY = 'bladesurge_save_v1';
const SENTINEL = JSON.stringify({ qaSentinel: 'startup-fault-qa', note: '저장 보존 확인용 표식' });
const BASE_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const MEDIA_QUERIES = ['(prefers-reduced-motion: reduce)', '(display-mode: standalone)', '(display-mode: fullscreen)'];
// 게임 캔버스 수명주기 리스너: Three(손실·복구·생성오류) + Renderer(복구 시 클리어 알파) + App(손실·복구). 중복 등록 검출용.
const CANVAS_LISTENERS = { webglcontextlost: 2, webglcontextrestored: 3, webglcontextcreationerror: 1 };

// 페이지 스크립트보다 먼저 실행된다. 정상 동작은 그대로 통과시키고 호출만 기록한다.
const probeScript = fault => '(' + function (fault) {
  const probe = window.__startupProbe = { contexts: [], canvasListeners: {}, media: [], toasts: [] };
  document.addEventListener('DOMContentLoaded', () => {
    const layer = document.getElementById('toast-layer');
    if (layer) new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) probe.toasts.push(String(n.textContent || '').slice(0, 120)); }).observe(layer, { childList: true });
  });
  if (fault.removeWebgl2Api) { try { delete window.WebGL2RenderingContext; } catch {} }
  if (fault.denyStorage) {
    const deny = () => { throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
  }
  const mql = window.MediaQueryList?.prototype;
  if (mql) {
    if (fault.legacyMediaQueryList) {
      Object.defineProperty(mql, 'addEventListener', { configurable: true, value: undefined });
      Object.defineProperty(mql, 'removeEventListener', { configurable: true, value: undefined });
    }
    const addListener = mql.addListener;
    if (typeof addListener === 'function') mql.addListener = function (fn) { probe.media.push({ media: this.media, api: 'addListener' }); return addListener.call(this, fn); };
  }
  const injected = () => new DOMException('QA 주입: WebGL2 컨텍스트 생성 예외', 'NotSupportedError');
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    let result, outcome;
    try {
      if (type === 'webgl2' && fault.removeWebgl2Api) result = null;
      else if (type === 'webgl2' && fault.webgl2 === 'throw') throw injected();
      else if (type === 'webgl2' && attrs?.powerPreference === 'high-performance' && fault.highPerformance === 'null') result = null;
      else if (type === 'webgl2' && attrs?.powerPreference === 'high-performance' && fault.highPerformance === 'throw') throw injected();
      else result = getContext.call(this, type, attrs);
      outcome = result ? 'ok' : 'null';
      return result;
    } catch (error) { outcome = 'threw'; throw error; }
    finally { if (this.id === 'gl' && /webgl/.test(type)) probe.contexts.push({ type, powerPreference: attrs?.powerPreference ?? null, withAttributes: !!attrs, result: outcome }); }
  };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (this instanceof HTMLCanvasElement && this.id === 'gl' && /^webglcontext/.test(type)) probe.canvasListeners[type] = (probe.canvasListeners[type] || 0) + 1;
    if (window.MediaQueryList && this instanceof MediaQueryList && type === 'change') probe.media.push({ media: this.media, api: 'addEventListener' });
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if (this instanceof HTMLCanvasElement && this.id === 'gl' && /^webglcontext/.test(type)) probe.canvasListeners[type] = (probe.canvasListeners[type] || 0) - 1;
    return remove.call(this, type, fn, o);
  };
}.toString() + ')(' + JSON.stringify(fault) + ')';

const HP_OK = ['high-performance:ok'];
const SCENARIOS = {
  normal: { expect: 'play', contexts: HP_OK, power: 'high-performance' },
  'hp-denied': { fault: { highPerformance: 'null' }, expect: 'play', contexts: ['high-performance:null', 'default:ok'], power: 'default' },
  'hp-throw': { fault: { highPerformance: 'throw' }, expect: 'play', contexts: ['high-performance:threw', 'default:ok'], power: 'default' },
  // 저장 불가 상태에서는 기존 계약대로 에너지를 쓰는 출격을 막는다. 정상 로비·정직한 저장 경고·비활성 출격을 확인하고 강제로 누르지 않는다.
  'storage-denied': { fault: { denyStorage: true }, expect: 'lobby', contexts: HP_OK, storageUnavailable: true, seedSave: true },
  'storage-blocked-profile': { profileCookiesBlocked: true, expect: 'lobby', contexts: HP_OK, storageUnavailable: true },
  'legacy-matchmedia': { fault: { legacyMediaQueryList: true }, expect: 'lobby', contexts: HP_OK, mediaApi: 'addListener' },
  'context-restore': { expect: 'lobby', contexts: HP_OK, restore: true },
  'webgl2-disabled': { args: ['--disable-webgl2'], expect: 'fail', code: 'BS-GFX-02', retry: true, contexts: ['high-performance:null', 'default:null'] },
  'webgl-off': { baseArgs: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'], expect: 'fail', code: 'BS-GFX-03', retry: true, contexts: ['high-performance:null', 'default:null'] },
  'no-webgl2-api': { fault: { removeWebgl2Api: true }, expect: 'fail', code: 'BS-GFX-01', retry: true, contexts: ['high-performance:null', 'default:null'] },
  'all-throw': { fault: { webgl2: 'throw' }, expect: 'fail', code: 'BS-GFX-02', retry: true, contexts: ['high-performance:threw', 'default:threw'] },
};
const selected = (opt('scenarios', '') || Object.keys(SCENARIOS).join(',')).split(',').filter(Boolean);
for (const name of selected) if (!SCENARIOS[name]) throw new Error('unknown scenario ' + name);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__qa-blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>qa</title>'); return; }
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); } catch { file = path.join(dist, 'index.html'); }
  try { const body = await fs.readFile(file); res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = 'http://127.0.0.1:' + server.address().port;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const proxy = proxyUrl ? (() => { const u = new URL(proxyUrl); return { server: u.protocol + '//' + u.host, bypass: '127.0.0.1,localhost', ...(u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}) }; })() : undefined;

const settled = () => { const s = document.getElementById('boot-start'), f = document.getElementById('boot-failure'); return (s && !s.classList.contains('hidden')) || (f && !f.hidden); };
const bootState = page => page.evaluate(() => {
  const q = id => document.getElementById(id);
  const start = q('boot-start');
  return { msg: q('boot-msg')?.textContent || '', pct: q('boot-pct')?.textContent || '', start: start && !start.classList.contains('hidden') ? start.textContent : null,
    failureCode: q('boot-failure') && !q('boot-failure').hidden ? q('boot-failure-code')?.textContent || '' : null,
    detail: q('boot-failure-detail')?.textContent || null, bootVisible: q('boot')?.classList.contains('show'),
    appCreated: !!window.app, mode: window.app?.mode ?? null, probe: window.__startupProbe };
});
const storageSnapshot = page => page.evaluate(() => { try { const s = window.localStorage; const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; } catch (e) { return { unavailable: e.name }; } });

async function imageStats(file) {
  const sharp = (await import('sharp')).default;
  const { channels } = await sharp(file).stats();
  return { stdev: +(channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3).toFixed(2), mean: +(channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3).toFixed(2) };
}
// SwiftShader 에서 렌더 루프가 바쁘면 캡처가 늦다. 캡처 실패는 captureErrors 에만 기록하고 기능 점검은 계속한다.
async function capture(page, rec, file, kind) {
  if (capturePolicy === 'none' || (capturePolicy === 'failure-ui' && kind === 'progress')) return false;
  try { await page.screenshot({ path: file, timeout: 60000 }); (rec.captures ||= []).push(path.basename(file)); return true; }
  catch (error) { (rec.captureErrors ||= []).push(path.basename(file) + ': ' + String(error.message).split('\n')[0]); return false; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function runScenario(name) {
  const sc = SCENARIOS[name];
  const rec = { scenario: name, label, mode, expect: sc.expect, checks: [], pageErrors: [], consoleErrors: [], navigations: 0, steps: [] };
  const check = (id, ok, observed) => { rec.checks.push({ id, ok: !!ok, observed }); return !!ok; };
  const shot = (page, step, kind) => capture(page, rec, path.join(outDir, label + '-' + name + '-' + step + '.png'), kind);
  const args = [...(sc.baseArgs || BASE_ARGS), ...(sc.args || [])];
  let browser, context, profileDir;
  const ctxOpts = { viewport: { width: vw, height: vh }, serviceWorkers: 'block', proxy };
  if (sc.profileCookiesBlocked) {
    profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-startup-profile-'));
    await fs.mkdir(path.join(profileDir, 'Default'), { recursive: true });
    await fs.writeFile(path.join(profileDir, 'Default', 'Preferences'), JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } }));
    context = await chromium.launchPersistentContext(profileDir, { executablePath: '/usr/bin/chromium', args, ...ctxOpts });
  } else {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
    context = await browser.newContext(ctxOpts);
  }
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror', e => rec.pageErrors.push(String(e.message).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); });
    if (sc.retry || sc.seedSave) {
      await page.goto(origin + '/__qa-blank');
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, SENTINEL]);
      rec.storageBefore = await storageSnapshot(page);
    }
    await context.addInitScript(probeScript(sc.fault || {}));
    page.on('framenavigated', f => { if (f === page.mainFrame() && !f.url().includes('__qa-blank')) rec.navigations++; });
    const t0 = Date.now();
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(settled, null, { timeout: 180000 });
    rec.bootSettledMs = Date.now() - t0;
    rec.boot = await bootState(page);
    rec.storageAccess = await page.evaluate(() => { try { void window.localStorage.length; return 'ok'; } catch (e) { return e.name; } });
    // 시작 버튼 문구는 실패 뒤 플랫폼 콜백이 덮어쓸 수 있다. 성공은 App 생성·100%·실패 패널 없음·메시지 비움으로만 본다.
    const ready = rec.boot.appCreated && rec.boot.failureCode === null && rec.boot.msg === '' && rec.boot.pct === '100%' && !!rec.boot.start;
    rec.outcome = ready ? 'ready' : 'boot-failure';
    const attempts = rec.boot.probe.contexts.filter(c => c.type === 'webgl2').map(c => c.powerPreference + ':' + c.result);
    check('webgl2-requests', same(attempts, sc.contexts), attempts);
    check('webgl2-requests-keep-attributes', rec.boot.probe.contexts.every(c => c.type !== 'webgl2' || c.withAttributes), rec.boot.probe.contexts);
    if (sc.expect === 'fail') await failurePath(page, sc, rec, check, shot);
    else await healthyPath(page, sc, rec, check, shot, context);
  } catch (error) {
    rec.error = String(error?.message || error).slice(0, 500);
    check('harness-completed', false, rec.error);
    const page = context.pages()[0];
    rec.errorState = await page?.evaluate(() => ({ mode: window.app?.mode ?? null, commandVisible: window.app?.commandUI?.visible ?? null, tab: window.app?.meta?.tab ?? null,
      modal: document.querySelector('#modal.show .modal-box')?.textContent?.slice(0, 160) ?? null, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id || d.className),
      toasts: window.__startupProbe?.toasts ?? [] })).catch(e => String(e.message).slice(0, 120));
    if (page) await capture(page, rec, path.join(outDir, label + '-' + name + '-error.png'), 'error');
  } finally {
    await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (profileDir) await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  check('no-page-errors', rec.pageErrors.length === 0, rec.pageErrors);
  rec.failedChecks = rec.checks.filter(c => !c.ok).map(c => c.id);
  // baseline 모드는 알려진 실패를 관측으로만 남긴다. PASS 로 바꾸지 않는다.
  rec.verdict = mode === 'baseline' ? 'observed' : rec.failedChecks.length ? 'fail' : 'pass';
  return rec;
}

async function failurePath(page, sc, rec, check, shot) {
  const b = rec.boot;
  check('boot-failed', rec.outcome === 'boot-failure' && !b.appCreated, { appCreated: b.appCreated, pct: b.pct });
  check('failure-at-0pct', b.pct === '0%', b.pct);
  check('failure-code', b.failureCode === sc.code, b.failureCode);
  check('start-control-hidden', b.start === null, b.start);
  check('no-network-blame', !/인터넷/.test(b.msg), b.msg);
  check('detail-allowlisted', !!b.detail && b.detail.split('\n').every(line => /^(오류 코드|단계|빌드|WebGL 2 API|WebGL 2 요청|저장 공간|시각): /.test(line)), b.detail);
  await shot(page, 'boot', 'failure-ui');
  if (await page.locator('#boot-failure details summary').isVisible().catch(() => false)) {
    await page.click('#boot-failure details summary');
    await page.click('#boot-failure-copy');
    await page.waitForTimeout(300);
    rec.copy = { status: await page.textContent('#boot-failure-copy'), clipboard: await page.evaluate(() => navigator.clipboard.readText().catch(e => 'read-failed:' + e.name)) };
    await shot(page, 'details', 'failure-ui');
  }
  check('copy-matches-detail', !!rec.copy && rec.copy.clipboard === b.detail && rec.copy.clipboard.includes(sc.code), rec.copy ?? null);
  // 자동 새로고침이 없는지 5초 지켜본 뒤 사용자가 한 번 누른다.
  await page.waitForTimeout(5000);
  rec.navigationsBeforeRetry = rec.navigations;
  check('no-automatic-reload', rec.navigationsBeforeRetry === 1, rec.navigationsBeforeRetry);
  const retry = await page.locator('#boot-retry').isVisible() ? '#boot-retry' : '#boot-start';
  rec.retryControl = retry;
  check('retry-control-visible', retry === '#boot-retry', retry);
  await page.click(retry);
  await page.waitForTimeout(1500);
  await page.waitForFunction(settled, null, { timeout: 120000 });
  await page.waitForTimeout(5000);
  rec.afterRetry = await bootState(page);
  rec.navigationsAfterRetry = rec.navigations;
  check('retry-reloads-once', rec.navigationsAfterRetry - rec.navigationsBeforeRetry === 1, [rec.navigationsBeforeRetry, rec.navigationsAfterRetry]);
  check('retry-shows-same-failure', rec.afterRetry.failureCode === sc.code && !rec.afterRetry.appCreated, rec.afterRetry.failureCode);
  rec.storageAfter = await storageSnapshot(page);
  rec.saveUnchanged = rec.storageAfter[SAVE_KEY] === SENTINEL;
  check('save-preserved', rec.saveUnchanged, rec.storageAfter[SAVE_KEY]?.slice(0, 80) ?? null);
}

async function healthyPath(page, sc, rec, check, shot, context) {
  check('boot-ready', rec.outcome === 'ready', { msg: rec.boot.msg, pct: rec.boot.pct, code: rec.boot.failureCode, appCreated: rec.boot.appCreated });
  await shot(page, 'boot', 'progress');
  if (rec.outcome !== 'ready') return;
  await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 90000 });
  rec.steps.push('lobby');
  check('lobby-reached', true, 'lobby');
  await page.waitForFunction(() => !document.getElementById('boot').classList.contains('show'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (await page.locator('#modal.show #m-cancel').isVisible()) { await page.click('#modal.show #m-cancel'); rec.steps.push('welcome-modal-cancel-click'); }
  rec.lobby = await page.evaluate(() => ({ storageStatus: app.eco.storageStatus, toasts: window.__startupProbe.toasts.slice(), canvasListeners: { ...window.__startupProbe.canvasListeners }, media: window.__startupProbe.media.slice() }));
  check('canvas-lifecycle-listeners', same(rec.lobby.canvasListeners, CANVAS_LISTENERS), rec.lobby.canvasListeners);
  const api = sc.mediaApi || 'addEventListener';
  const subscriptions = MEDIA_QUERIES.map(media => rec.lobby.media.filter(m => m.media === media).map(m => m.api));
  check('media-query-subscriptions', subscriptions.every(list => same(list, [api])), Object.fromEntries(MEDIA_QUERIES.map((m, i) => [m, subscriptions[i]])));
  await shot(page, 'lobby', 'progress');
  if (sc.storageUnavailable) return storagePath(page, sc, rec, check, shot, context);
  check('storage-ready', rec.lobby.storageStatus === 'ready', rec.lobby.storageStatus);
  if (sc.restore) return restorePath(page, rec, check);
  if (sc.expect === 'lobby') return;
  await openDeparture(page, rec);
  const access = await departureState(page);
  rec.departure = access;
  if (!check('departure-enabled', access.goDisabled === false, access)) return;
  await page.click('.citadel-hub-go'); rec.steps.push('departure-go-click');
  const deadline = Date.now() + 180000;
  while (!(await page.evaluate(() => !!(app.battle?.active && !app.stageStarting)))) {
    if (Date.now() > deadline) throw new Error('battle did not become active');
    if (await page.locator('.exp-cinematic button').isVisible().catch(() => false)) { await page.click('.exp-cinematic button'); rec.steps.push('entrance-film-skip-click'); }
    await page.waitForTimeout(500);
  }
  rec.steps.push('battle-active');
  if (await page.locator('#battle-tutorial').isVisible()) { await page.click('#tutorial-skip'); rec.steps.push('tutorial-skip-click'); }
  await page.waitForTimeout(800);
  const e0 = await page.evaluate(() => app.battle.elapsed);
  const w0 = Date.now();
  await page.keyboard.down('w');
  // 실제 프레임 루프가 전투 시계를 올리는지 본다. 소프트웨어 렌더링은 느리므로 최대 20초까지 기다린다(시간 조작 없음).
  let e1 = e0;
  while (Date.now() - w0 < 20000) { await page.waitForTimeout(1000); e1 = await page.evaluate(() => app.battle.elapsed); if (e1 > e0 && Date.now() - w0 >= 3000) break; }
  await page.keyboard.up('w');
  rec.battle = await page.evaluate(e0 => {
    const gl = app.renderer.r.getContext(), a = gl.getContextAttributes();
    return { elapsedStart: e0, elapsedEnd: app.battle.elapsed, active: app.battle.active, paused: !!app.battle.paused, stage: app.battle.stage?.id ?? app.battle.stageId ?? null,
      contextLost: gl.isContextLost(), attributes: { alpha: a.alpha, antialias: a.antialias, stencil: a.stencil, depth: a.depth, powerPreference: a.powerPreference },
      clearAlpha: app.renderer.r.getClearAlpha(), contextPowerPreference: app.renderer.contextPowerPreference ?? null, storageStatus: app.eco.storageStatus };
  }, e0);
  rec.battle.wallMs = Date.now() - w0;
  check('battle-active', rec.battle.active && !rec.battle.paused && !rec.battle.contextLost, { active: rec.battle.active, paused: rec.battle.paused, contextLost: rec.battle.contextLost });
  check('battle-clock-advances', rec.battle.elapsedEnd > rec.battle.elapsedStart, [rec.battle.elapsedStart, rec.battle.elapsedEnd, rec.battle.wallMs]);
  check('context-attributes', same(rec.battle.attributes, { alpha: true, antialias: false, stencil: false, depth: true, powerPreference: sc.power }), rec.battle.attributes);
  check('context-power-preference', rec.battle.contextPowerPreference === sc.power, rec.battle.contextPowerPreference);
  check('opaque-clear-alpha', rec.battle.clearAlpha === 1, rec.battle.clearAlpha);
  const file = path.join(outDir, label + '-' + rec.scenario + '-battle.png');
  if (await capture(page, rec, file, 'progress')) rec.battleImage = await imageStats(file);
}

async function openDeparture(page, rec) {
  if (await page.locator('#modal.show #m-cancel').isVisible()) { await page.click('#modal.show #m-cancel'); rec.steps.push('modal-cancel-click'); }
  await page.waitForFunction(() => app.commandUI?.visible, null, { timeout: 30000 });
  await page.click('#citadel-dungeon-prepare'); rec.steps.push('dungeon-landing-prepare-click');
  await page.locator('.citadel-hub-dialog[open]').waitFor({ timeout: 30000 });
}
const departureState = page => page.evaluate(() => { const d = document.querySelector('.citadel-hub-dialog[open]');
  return { goDisabled: d.querySelector('.citadel-hub-go')?.disabled ?? null, access: d.querySelector('.citadel-hub-access')?.textContent ?? null }; });

async function storagePath(page, sc, rec, check, shot, context) {
  check('storage-unavailable-status', rec.lobby.storageStatus === 'unavailable', rec.lobby.storageStatus);
  check('storage-warning-shown', rec.lobby.toasts.some(t => t.includes('저장 공간을 사용할 수 없어')), rec.lobby.toasts);
  await openDeparture(page, rec);
  rec.departure = await departureState(page);
  // 저장할 수 없으면 에너지를 쓰는 출격을 막는 기존 보호가 유지돼야 한다. 버튼을 강제로 누르지 않는다.
  check('paid-entry-disabled', rec.departure.goDisabled === true, rec.departure);
  check('paid-entry-reason', rec.departure.access === '저장 공간을 확인해 주세요.', rec.departure.access);
  await shot(page, 'departure', 'failure-ui');
  await page.keyboard.press('Escape'); rec.steps.push('departure-blocked-escape');
  rec.stillLobby = await page.evaluate(() => ({ mode: app.mode, battleActive: !!app.battle?.active, stageStarting: !!app.stageStarting }));
  check('no-battle-started', rec.stillLobby.mode === 'lobby' && !rec.stillLobby.battleActive && !rec.stillLobby.stageStarting, rec.stillLobby);
  if (sc.seedSave) {
    // 페이지의 getter 차단과 분리된 Playwright 저장 상태로 기존 저장값이 그대로인지 확인한다.
    const state = await context.storageState();
    const saved = state.origins.find(o => o.origin === origin)?.localStorage.find(item => item.name === SAVE_KEY)?.value ?? null;
    check('save-preserved', saved === SENTINEL, saved?.slice(0, 80) ?? null);
  }
}

async function restorePath(page, rec, check) {
  const before = await page.evaluate(() => app.renderer.r.getClearAlpha());
  await page.evaluate(() => { window.__qaLose = app.renderer.r.getContext().getExtension('WEBGL_lose_context'); window.__qaLose.loseContext(); });
  await page.waitForFunction(() => app.contextLost === true, null, { timeout: 30000 });
  rec.steps.push('context-lost');
  await page.evaluate(() => window.__qaLose.restoreContext());
  await page.waitForFunction(() => app.contextLost === false, null, { timeout: 240000 });
  rec.steps.push('context-restored');
  rec.restore = await page.evaluate(before => ({ clearAlphaBefore: before, clearAlphaAfter: app.renderer.r.getClearAlpha(), contextLost: app.renderer.r.getContext().isContextLost(),
    recoveryHidden: document.getElementById('render-recovery').hidden, mode: app.mode }), before);
  check('context-recovered', !rec.restore.contextLost && rec.restore.recoveryHidden && rec.restore.mode === 'lobby', rec.restore);
  check('opaque-clear-alpha-after-restore', rec.restore.clearAlphaBefore === 1 && rec.restore.clearAlphaAfter === 1, [rec.restore.clearAlphaBefore, rec.restore.clearAlphaAfter]);
}

await fs.mkdir(outDir, { recursive: true });
const reportFile = path.join(outDir, label + '-report.json');
if (await fs.stat(reportFile).then(() => true, () => false)) throw new Error('report exists, use a new --label: ' + reportFile);
const report = { label, mode, dist, capturePolicy, viewport: vw + 'x' + vh, startedAt: new Date().toISOString(),
  browser: 'Chromium (/usr/bin/chromium) headless; SwiftShader unless scenario overrides. Not a physical-device or customer-environment result.',
  version: JSON.parse(await fs.readFile(path.join(dist, 'version.json'), 'utf8').catch(() => 'null')), scenarios: [] };
for (const name of selected) {
  const rec = await runScenario(name);
  report.scenarios.push(rec);
  console.log(JSON.stringify({ scenario: name, verdict: rec.verdict, failed: rec.failedChecks, code: rec.boot?.failureCode, pct: rec.boot?.pct,
    battle: rec.battle && [rec.battle.elapsedStart, rec.battle.elapsedEnd], captureErrors: rec.captureErrors?.length || 0, error: rec.error }));
}
report.endedAt = new Date().toISOString();
report.failed = report.scenarios.filter(s => s.verdict === 'fail').map(s => s.scenario);
report.verdict = mode === 'baseline' ? 'observed' : report.failed.length ? 'fail' : 'pass';
await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
server.close();
console.log(JSON.stringify({ label, mode, verdict: report.verdict, failed: report.failed }));
if (mode === 'candidate' && report.failed.length) process.exitCode = 1;
