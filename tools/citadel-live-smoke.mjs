// Finite post-deploy proof. Root must deploy the expected release before running.
// Public GET/hash checks and native browser input only; no gameplay/state writes,
// purchase, battle, account, party, build, deployment, or performance benchmark.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';

const root = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = arg('origin'), expectedSha = arg('expected-sha'), run = arg('run');
if (origin !== 'https://blade.tllhouse.com') throw Error('Supply the authorized public --origin=https://blade.tllhouse.com');
if (!/^[a-f0-9]{40}$/.test(expectedSha || '')) throw Error('Supply the deployed full 40-character --expected-sha');
if (!/^[a-zA-Z0-9_-]+$/.test(run || '')) throw Error('Supply a unique --run label');
const out = path.join(root, 'work/qa/citadel-hub-v1/live', run);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // Never overwrite an earlier receipt.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const driverBytes = await fs.readFile(import.meta.filename);
await fs.writeFile(path.join(out, 'driver.mjs'), driverBytes, { flag: 'wx' });
const report = {
  status: 'running', origin, expectedSha, started: new Date().toISOString(),
  driver: { path: path.relative(root, import.meta.filename), sha256: hash(driverBytes) },
  scope: 'Public release byte identity and one isolated native Chromium 390×844 portrait touch smoke on the unchanged naturally earned fixture. No physical-phone, FPS, subjective human-play, purchase, or full QA-repeat claim.',
  sources: {}, files: [], fetchConcurrency: 8, networkErrors: [], runtimeErrors: [], consoleErrors: [], browserAssetResponses: [], blockedRequests: [], screenshots: [],
};
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const finiteDeadline = setTimeout(() => { report.status = 'fail'; report.failure = 'Finite smoke exceeded its 8-minute wall-time guard'; void save().finally(() => process.exit(1)); }, 480000);
let browser, page;

async function publicBytes(file) {
  assert(file.startsWith('/') && !file.includes('..') && !file.startsWith('//'), `Invalid public artifact path: ${file}`);
  const response = await fetch(new URL(file, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25000) });
  assert(response.ok, `${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function compare(file, group, declared = null) {
  const local = await fs.readFile(path.join(root, 'dist', file.slice(1)));
  if (declared) assert(local.length === declared.bytes && hash(local) === declared.sha256, `${file}: local dist differs from its manifest`);
  const live = await publicBytes(file);
  const row = { path: file, group, localBytes: local.length, liveBytes: live.length, localSha256: hash(local), liveSha256: hash(live), match: local.length === live.length && hash(local) === hash(live) };
  report.files.push(row);
  assert(row.match, `${file}: deployed bytes differ from local dist`);
  return live;
}
async function boundedComparisons(items) {
  let cursor = 0;
  const failures = [];
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { await compare(item.path, item.group, item.declared); }
      catch (error) { failures.push({ path: item.path, error: String(error) }); }
    }
  }));
  report.networkErrors.push(...failures);
  assert(failures.length === 0, `${failures.length} public artifact checks failed`);
}
async function state() {
  return page.evaluate(() => {
    const app = window.app, position = app.showcase?.root.position;
    const hall = app.arena?.lobbyHall, e = app.renderer.camera.matrixWorld.elements;
    const nodes = hall?.userData.hotspotNodes;
    return {
      mode: app.mode, tab: app.meta.tab, position: position ? { x: position.x, y: position.y, z: position.z } : null,
      rendererClock: app.renderer.time, yaw: Math.atan2(-e[2], e[0]), moving: app.hubMovement?.moving,
      nearest: app.hubMovement?.nearest?.id, gold: app.eco.s.gold, potions: { ...app.expedition.s.consumables },
      level: app.expedition.s.level, pending: app.expedition.s.pending, spentKRW: app.eco.s.spentKRW,
      camera: { mode: app.renderer.rig.mode, navigation: app.renderer.lobbyNavigation, position: { x: app.renderer.camera.position.x, y: app.renderer.camera.position.y, z: app.renderer.camera.position.z } },
      scene: { name: hall?.name, version: hall?.userData.version, authoredAssetCount: hall?.userData.authoredAssetCount,
        hotspots: nodes ? [...nodes.entries()].map(([id, node]) => ({ id, authoredRoots: (() => { const names = []; node.traverse(child => { if (/^Citadel_(?:NPC_|Gate_)/.test(child.name) && !child.isMesh) names.push(child.name); }); return names; })(), meshCount: (() => { let n = 0; node.traverse(child => { if (child.isMesh) n++; }); return n; })() })) : [] },
      quality: app.renderer.quality, keys: Object.keys(app.hubControls?.keys || {}), pointer: app.hubControls?.pointer?.id ?? null,
      activeDialog: document.querySelector('dialog[open]')?.id || null,
    };
  });
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function untouched(before, after, label) {
  assert(before.gold === after.gold && JSON.stringify(before.potions) === JSON.stringify(after.potions) && after.pending === null && before.spentKRW === after.spentKRW, `${label}: movement/open changed currency, stock, spend, or expedition ticket`);
}
async function clockProgress(seconds = .08) {
  const before = await page.evaluate(() => window.app.renderer.time);
  await page.waitForFunction(({ before, seconds }) => window.app.renderer.time - before >= seconds, { before, seconds }, { timeout: 25000 });
}
async function touchPulse(session, vector, milliseconds = 80) {
  const seconds = Math.max(.08, Math.min(.12, milliseconds / 1000));
  const box = await page.locator('.citadel-hub-stick').boundingBox();
  assert(box, 'Visible native touch joystick is missing');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Native CDP release latency can overshoot a short approach at full throw.
  const radius = Math.min(box.width, box.height) * .34 * Math.max(.22, Math.min(1, milliseconds / 450)), length = Math.hypot(vector.x, vector.y) || 1;
  const before = await state();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + vector.x / length * radius, y: center.y + vector.y / length * radius, id: 1 }] });
    const holdClock = await page.evaluate(() => window.app.renderer.time);
    await page.waitForFunction(({ clock, seconds }) => window.app.renderer.time - clock >= seconds, { clock: holdClock, seconds }, { timeout: 25000 });
    return await state();
  } finally { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}
async function walk(session, target, { tolerance = .42, maxPulses = 35 } = {}) {
  const start = await state(), pulses = [];
  const deadline = Date.now() + 150000;
  let stalls = 0;
  for (let n = 0; n < maxPulses && Date.now() < deadline; n++) {
    const before = await state(), dx = target.x - before.position.x, dz = target.z - before.position.z;
    if (Math.hypot(dx, dz) <= tolerance) return { target, before: start, after: before, pulses };
    const c = Math.cos(before.yaw), s = Math.sin(before.yaw);
    const after = await touchPulse(session, { x: dx * c - dz * s, y: dx * s + dz * c }, Math.max(80, Math.min(450, Math.hypot(dx, dz) / 4.2 * 1000 * .8)));
    const moved = distance(before.position, after.position);
    pulses.push({ before: before.position, after: after.position, displacement: moved, rendererClockBefore: before.rendererClock, rendererClockAfter: after.rendererClock });
    stalls = moved < .01 ? stalls + 1 : 0;
    assert(stalls < 5, `Native touch movement stalled approaching ${JSON.stringify(target)}`);
  }
  throw Error(`Finite native approach did not reach ${JSON.stringify(target)}`);
}
async function screenshot(file) {
  await clockProgress();
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    shop: (() => { const element = document.querySelector('#citadel-shop[open]'); if (!element) return null; const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })() }));
  assert(layout.scrollWidth <= layout.width, `${file}: horizontal overflow`);
  if (layout.shop) assert(layout.shop.x >= 0 && layout.shop.y >= 0 && layout.shop.x + layout.shop.width <= layout.width + 1 && layout.shop.y + layout.shop.height <= layout.height + 1, 'Shop dialog exceeds portrait viewport');
  await page.screenshot({ path: path.join(out, file), timeout: 25000 });
  report.screenshots.push({ file, layout, state: await state() });
  await save();
}

try {
  report.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert(report.sourceHead === expectedSha, 'Local source HEAD differs from the expected deployed SHA');
  for (const file of ['src/main.js', 'src/game/citadel-hub-scene.js', 'src/data/citadel-hub.js', 'src/game/hub-movement.js', 'src/engine/hub-controls.js', 'src/ui/citadel-hub.js', 'src/ui/citadel-shop.js', 'src/game/expedition-economy.js']) report.sources[file] = hash(await fs.readFile(path.join(root, file)));
  const localVersionBytes = await fs.readFile(path.join(root, 'dist/version.json'));
  report.localVersion = JSON.parse(localVersionBytes);
  assert(report.localVersion.sha === expectedSha && report.localVersion.dirty === false, 'Local dist must carry the expected SHA and dirty:false');
  report.liveVersion = JSON.parse(await compare('/version.json', 'release-version'));
  assert(report.liveVersion.sha === expectedSha && report.liveVersion.dirty === false, 'Public version is not the expected clean release');
  const index = (await compare('/index.html', 'compiled-index')).toString('utf8');
  assert(!index.includes('/@vite/client') && !index.includes('/src/main.js'), 'Public page serves a development build');
  const indexFiles = [...new Set([...index.matchAll(/(?:src|href)=["'](\/assets\/index-[^"']+\.(?:js|css))["']/g)].map(match => match[1]))];
  assert(indexFiles.some(file => file.endsWith('.js')) && indexFiles.some(file => file.endsWith('.css')), 'Compiled index JS/CSS references are missing');
  const manifestPath = '/models/citadel-hub-v1/manifest.json';
  const manifest = JSON.parse(await compare(manifestPath, 'citadel-manifest'));
  assert(manifest.assets.length === 20 && manifest.assets.every(asset => asset.lod1) && manifest.sharedTextures.length === 6, 'Expected 20 base, 20 LOD, and 6 shared texture entries');
  const assets = manifest.assets.flatMap(asset => [{ ...asset, group: 'base-model' }, { ...asset.lod1, group: 'lod-model' }]).concat(manifest.sharedTextures.map(texture => ({ ...texture, group: 'shared-texture' })));
  assert(new Set(assets.map(asset => asset.file)).size === 46, 'Manifest contains duplicate or missing model/texture files');
  for (const asset of assets) assert(/^(?:[a-z0-9_-]+\.glb|textures\/[a-f0-9]+\.png)$/.test(asset.file), 'Unexpected citadel artifact path');
  await boundedComparisons([...indexFiles.map(file => ({ path: file, group: 'compiled-index-code' })), ...assets.map(asset => ({ path: '/models/citadel-hub-v1/' + asset.file, group: asset.group, declared: asset }))]);
  report.hashChecks = { total: report.files.length, baseModels: 20, lodModels: 20, sharedTextures: 6, passed: report.files.every(file => file.match) };
  await save();

  const fixturePath = '/workspace/blade-surge/work/aaa-20261003/astral-earned-d376ee6/earned-save.json';
  const fixtureBytes = await fs.readFile(fixturePath), fixtureSave = JSON.parse(fixtureBytes);
  const fixtureReceipt = JSON.parse(await fs.readFile(path.join(path.dirname(fixturePath), 'report.json'), 'utf8'));
  assert(fixtureReceipt.status === 'pass' && fixtureReceipt.naturalStart === true && fixtureReceipt.synthetic === false && fixtureReceipt.earnedSave?.natural === true && fixtureReceipt.earnedSave.sha256 === hash(fixtureBytes), 'Fixture does not match its passing naturally earned receipt');
  report.fixture = { path: fixturePath, sha256: hash(fixtureBytes), receiptHead: fixtureReceipt.head, natural: true, unchangedBytes: true, installation: 'Fresh isolated browser storageState before navigation only; no evaluate/localStorage writes', level: fixtureSave.expedition.level, gold: fixtureSave.gold, potions: fixtureSave.expedition.consumables };
  browser = await chromium.launch(launchOpts({ headless: true }));
  report.browser = { version: browser.version(), viewport: { width: 390, height: 844 }, mobile: true, touch: true, serviceWorkers: 'blocked', renderer: 'SwiftShader software harness; renderer-clock waits observe actual frames and do not accelerate time' };
  const context = await browser.newContext({ viewport: report.browser.viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'bladesurge_save_v1', value: fixtureBytes.toString('utf8') }] }] } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const publicHost = url.origin === origin || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
    if (!['GET', 'HEAD'].includes(request.method()) || !publicHost || (url.origin === origin && url.pathname.startsWith('/api/'))) {
      report.blockedRequests.push({ url: request.url(), method: request.method() }); await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  const session = await context.newCDPSession(page);
  page.on('pageerror', error => report.runtimeErrors.push({ message: error.message, stack: error.stack }));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/models/citadel-hub-v1/')) report.browserAssetResponses.push({ path: pathname, status: response.status() });
    if (response.status() >= 400 && (['script', 'stylesheet', 'image', 'font', 'media'].includes(response.request().resourceType()) || /\.(?:glb|gltf|png|jpe?g|webp|svg|woff2?|js|css|mp3|ogg|wav)$/.test(pathname))) report.networkErrors.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => {
    if (['script', 'stylesheet', 'image', 'font', 'media'].includes(request.resourceType()) || new URL(request.url()).pathname.startsWith('/models/citadel-hub-v1/')) report.networkErrors.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const portrait = page.getByRole('button', { name: '세로로 계속하기', exact: true });
  if (await portrait.isVisible()) await portrait.tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 90000 });
  if (await portrait.isVisible()) await portrait.tap();
  const modalClose = page.locator('#modal.show #m-cancel');
  if (await modalClose.isVisible()) await modalClose.tap();
  await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
  await clockProgress();
  const initial = await state(); report.initial = initial;
  assert(initial.gold === fixtureSave.gold && initial.level === fixtureSave.expedition.level && JSON.stringify(initial.potions) === JSON.stringify(fixtureSave.expedition.consumables), 'Boot changed earned fixture currency, level, or stock');
  assert(initial.mode === 'lobby' && initial.tab === 'home' && initial.camera.mode === 'lobby' && initial.camera.navigation === true, 'Public release did not enter the walking hub camera');
  assert(initial.scene.version === 'citadel-playable-hub-v1' && initial.scene.authoredAssetCount >= 25, 'Authored citadel scene did not load all expected instances');
  const merchant = CITADEL_HUB_HOTSPOTS.find(spot => spot.id === 'npc:potion-merchant');
  assert(initial.scene.hotspots.some(spot => spot.id === merchant.id && spot.authoredRoots.includes('Citadel_NPC_Merchant')), 'Authored merchant NPC is missing');
  const gateNodes = initial.scene.hotspots.filter(spot => spot.id.startsWith('dungeon:'));
  assert(gateNodes.length === 12 && gateNodes.every(spot => spot.authoredRoots.some(name => name.startsWith('Citadel_Gate_'))), 'Authored dungeon gate scene is incomplete');
  report.sceneChecks = { npcLoaded: true, authoredDungeonGates: gateNodes.length, authoredAssetCount: initial.scene.authoredAssetCount, hubCamera: true };

  const firstTarget = { x: initial.position.x - 1.1, z: initial.position.z };
  report.movement = await walk(session, firstTarget, { tolerance: .2, maxPulses: 20 });
  const displacement = distance(report.movement.before.position, report.movement.after.position);
  assert(displacement >= .9 && displacement <= 1.5 && report.movement.after.rendererClock > report.movement.before.rendererClock, 'Native joystick did not move the hero approximately one metre across actual rendered frames');
  report.movement.displacement = displacement;
  untouched(initial, report.movement.after, 'Native joystick smoke');
  await screenshot('public-playablehub.png');
  report.merchantApproach = await walk(session, { x: merchant.x + 1.1, z: merchant.z - .5 });
  const nearby = await state();
  assert(nearby.nearest === merchant.id && (await page.locator('.citadel-hub-near-name').textContent()) === merchant.label, 'Native approach did not offer the actual nearby merchant');
  untouched(initial, nearby, 'Merchant approach');
  await page.locator('.citadel-hub-interact').tap();
  await page.locator('#citadel-shop[open]').waitFor();
  await clockProgress();
  const shop = await state();
  untouched(initial, shop, 'Actual NPC shop open');
  assert(distance(nearby.position, shop.position) < .02 && shop.keys.length === 0 && shop.pointer === null, 'Shop did not clear lobby movement');
  report.shop = { openedThrough: 'Native touch on actual proximity interaction', purchaseAttempted: false, gold: shop.gold, stock: shop.potions, walletText: await page.locator('.citadel-shop-wallet strong').textContent(), rows: await page.locator('.citadel-shop-potion').allTextContents(), pausedMovement: true };
  assert(report.shop.walletText.replace(/\D/g, '') === String(shop.gold), 'Shop balance does not match existing currency');
  await screenshot('public-shop.png');
  assert(report.runtimeErrors.length === 0 && report.networkErrors.length === 0 && report.blockedRequests.length === 0, 'Public smoke reported asset/network, JS runtime, or disallowed request errors');
  report.status = 'pass'; report.finished = new Date().toISOString();
} catch (error) {
  report.status = 'fail'; report.failure = String(error); process.exitCode = 1;
  if (page) try { await page.screenshot({ path: path.join(out, 'public-failure.png'), timeout: 15000 }); report.screenshots.push({ file: 'public-failure.png', failureEvidence: true }); } catch {}
} finally {
  clearTimeout(finiteDeadline);
  await browser?.close();
  report.finished ||= new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: report.status, origin, expectedSha, out, matchedFiles: report.files.filter(file => file.match).length, movement: report.movement?.displacement, shopOpened: !!report.shop, runtimeErrors: report.runtimeErrors.length, networkErrors: report.networkErrors.length, failure: report.failure }));
}
