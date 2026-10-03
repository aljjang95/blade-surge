// Focused native-input review of the walking citadel. Run only after root freezes
// the candidate and supplies its production origin. This helper never builds,
// changes the product, calls gameplay methods, or writes state through evaluate.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';
import { ENERGY } from '../src/data/shop.js';

const root = path.resolve(import.meta.dirname, '..');
const argument = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = argument('origin');
const selectedCases = argument('cases')?.split(',') || ['desktop', 'portrait'];
if (selectedCases.some(value => !['desktop', 'portrait'].includes(value))) throw Error('Cases must be desktop and/or portrait');
const requestedQuality = argument('quality');
if (requestedQuality && requestedQuality !== 'low') throw Error('Only --quality=low native fallback is supported');
const recheck = argument('recheck');
if (recheck && recheck !== 'labels') throw Error('Only --recheck=labels is supported');
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Supply --origin=http://127.0.0.1:PORT after candidate freeze; no server is started by this helper.');
const runName = argument('run') || new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[a-zA-Z0-9_-]+$/.test(runName)) throw Error('Invalid run label');
const out = path.join(root, 'work/qa/citadel-hub-v1', runName);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // Retain prior evidence.
const hash = value => createHash('sha256').update(value).digest('hex');
const executedDriverBytes = await fs.readFile(import.meta.filename);
const executedDriverSha256 = hash(executedDriverBytes);
await fs.writeFile(path.join(out, 'driver.mjs'), executedDriverBytes, { flag: 'wx' });
const fixture = argument('save') || '/workspace/blade-surge/work/aaa-20261003/astral-earned-d376ee6/earned-save.json';
const fixtureBytes = await fs.readFile(fixture);
const fixtureReport = JSON.parse(await fs.readFile(path.join(path.dirname(fixture), 'report.json'), 'utf8'));
if (fixtureReport.status !== 'pass' || fixtureReport.naturalStart !== true || fixtureReport.synthetic !== false || fixtureReport.earnedSave?.natural !== true || fixtureReport.earnedSave?.sha256 !== hash(fixtureBytes)) throw Error('Fixture must match its passing naturally-earned receipt.');
const fixtureSave = JSON.parse(fixtureBytes);
const sources = ['src/main.js', 'src/engine/renderer.js', 'src/game/arena.js', 'src/data/citadel-hub.js', 'src/game/citadel-hub-scene.js', 'src/game/hub-movement.js', 'src/engine/hub-controls.js', 'src/ui/citadel-hub.js', 'src/ui/citadel-hub.css', 'src/ui/citadel-integration.css', 'src/ui/citadel-shop.js', 'src/ui/citadel-shop.css', 'src/game/expedition-economy.js', 'public/models/citadel-hub-v1/manifest.json'];
const report = { status: 'running', scope: 'Native Chromium desktop keyboard and portrait emulated touch against the supplied compiled candidate. No physical-phone or subjective human-play claim.', origin, started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), driverSha256: executedDriverSha256, fixture: { path: fixture, sha256: hash(fixtureBytes), sourceHead: fixtureReport.head, natural: true, level: fixtureSave.expedition.level }, sources: {}, errors: [], cases: [], screenshots: [], visualReview: 'pending independent image inspection' };
for (const file of sources) report.sources[file] = hash(await fs.readFile(path.join(root, file)));
const artifactIndex = await fs.readFile(path.join(root, 'dist/index.html'));
const servedIndex = await (await fetch(origin, { cache: 'no-store' })).text();
if (servedIndex.includes('/@vite/client') || servedIndex.includes('/src/main.js') || hash(Buffer.from(servedIndex)) !== hash(artifactIndex)) throw Error('Supplied origin must serve the frozen compiled dist/index.html.');
report.artifactIndexSha256 = hash(artifactIndex);
const saveReport = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await saveReport();
const assert = (value, message) => { if (!value) throw Error(message); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const spot = id => CITADEL_HUB_HOTSPOTS.find(s => s.id === id);
let browser;

async function state(page) {
  return page.evaluate(() => {
    const a = window.app, p = a.showcase?.root.position;
    const c = a.hubControls || a.citadelControls || a.citadel?.controls;
    const e = a.renderer.camera.matrixWorld.elements;
    const r = a.renderer.r;
    const stored = localStorage.getItem('bladesurge_save_v1'), primary = stored ? JSON.parse(stored) : null;
    return { mode: a.mode, tab: a.meta.tab, position: p ? { x: p.x, y: p.y, z: p.z } : null, nearest: a.hubMovement?.nearest?.id, moving: a.hubMovement?.moving, yaw: Math.atan2(-e[2], e[0]), camera: { x: a.renderer.camera.position.x, y: a.renderer.camera.position.y, z: a.renderer.camera.position.z }, rendering: { quality: a.renderer.quality, bufferWidth: r.domElement.width, bufferHeight: r.domElement.height, pixelRatio: r.getPixelRatio(), lastPass: { ...r.info.render }, lastPassScope: 'Observed last renderer pass; composer autoReset may prevent full-frame totals', geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs.length }, gold: a.eco.s.gold, energy: a.eco.s.energy, energyT: a.eco.s.energyT, energyMax: a.eco.energyMax, level: a.expedition.s.level, potions: { ...a.expedition.s.consumables }, pending: a.expedition.s.pending ? { ...a.expedition.s.pending } : null, selected: a.eco.s.selected, active: !!a.battle?.active, stage: a.battle?.stage?.expedition || null, starting: !!a.stageStarting, keys: c ? Object.keys(c.keys) : null, pointer: c?.pointer?.id ?? null, primary: primary ? { gold: primary.gold, expedition: { level: primary.expedition?.level, consumables: primary.expedition?.consumables } } : null, observedAt: Date.now(), focused: document.activeElement?.className || document.activeElement?.id || document.activeElement?.tagName };
  });
}

async function focusWorld(page) {
  const v = page.viewportSize();
  await page.mouse.click(v.width * .54, v.height * .43);
}

async function boot(page, reload = false) {
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const proceed = page.getByRole('button', { name: '세로로 계속하기', exact: true });
  if (await proceed.isVisible()) await proceed.click();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), undefined, { timeout: 90000 });
  if (await proceed.isVisible()) await proceed.click();
  await page.waitForTimeout(250);
  const legacyCancel = page.locator('#modal.show #m-cancel');
  if (await legacyCancel.isVisible()) await legacyCancel.click();
  await page.locator('.citadel-hub-ui:not([hidden])').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
}

async function capture(page, name, row) {
  const renderable = await page.evaluate(() => !window.app.expeditionUI.opened);
  if (renderable) {
    const before = await page.evaluate(() => window.app.renderer.time);
    await page.waitForFunction(time => window.app.renderer.time - time >= .18, before, { timeout: 15000 });
  }
  await page.screenshot({ path: path.join(out, name + '.png') });
  const layout = await page.evaluate(() => {
    const box = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(), st = getComputedStyle(el); return { selector: s, visible: r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden', x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, controls: ['.citadel-hub-near', '.citadel-hub-interact', '.citadel-hub-stick', '.lobby-bottom', '#oath-menu', '.oath-nav-menu', '#citadel-shop[open]', '.citadel-hub-dialog[open]', '.citadel-hub-go', '.citadel-shop-buy', '#expedition-root'].map(box).filter(Boolean) };
  });
  row.frames.push({ name, layout, state: await state(page) });
  report.screenshots.push(name + '.png');
  assert(layout.scrollWidth <= layout.width, name + ': horizontal overflow');
  await saveReport();
}

async function selectLowGraphics(page, touch) {
  const click = async selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
  await click('.oath-nav-menu'); await click('#oath-menu #btn-settings');
  await click('#modal.show [data-q="low"]'); await click('#modal.show #m-cancel');
  await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
  assert((await state(page)).rendering.quality === 'low', 'Native settings did not select low graphics');
}

// Inverse camera transform chooses trusted native keyboard or touch input.
// Reading coordinates only steers the input; no actor position is ever assigned.
async function pulse(page, session, vector, milliseconds, touch) {
  const clockBefore = await page.evaluate(() => window.app.renderer.time);
  const seconds = Math.max(.08, Math.min(.12, milliseconds / 1000));
  const observeProgress = () => page.waitForFunction(({ clockBefore, seconds }) => window.app.renderer.time - clockBefore >= seconds, { clockBefore, seconds }, { timeout: 25000 });
  if (touch) {
    const box = await page.locator('.citadel-hub-stick').boundingBox();
    assert(box, 'Touch joystick missing');
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const length = Math.hypot(vector.x, vector.y) || 1;
    const radius = Math.min(box.width, box.height) * .34;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + vector.x / length * radius, y: center.y + vector.y / length * radius, id: 1 }] });
    try { await observeProgress(); }
    finally { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  } else {
    const angle = Math.atan2(vector.y, vector.x), x = Math.cos(Math.round(angle / (Math.PI / 4)) * Math.PI / 4), y = Math.sin(Math.round(angle / (Math.PI / 4)) * Math.PI / 4);
    const keys = [x > .3 ? 'KeyD' : x < -.3 ? 'KeyA' : null, y > .3 ? 'KeyS' : y < -.3 ? 'KeyW' : null].filter(Boolean);
    for (const key of keys) await page.keyboard.down(key);
    try { await observeProgress(); }
    finally { for (const key of keys) await page.keyboard.up(key); }
  }
}

async function walk(page, session, target, touch, row) {
  if (!touch) await focusWorld(page);
  const before = await state(page), start = Date.now();
  let previous = before.position, stalls = 0;
  while (Date.now() - start < 120000) {
    const current = await state(page), dx = target.x - current.position.x, dz = target.z - current.position.z, remaining = Math.hypot(dx, dz);
    if (remaining < .42) { row.walks.push({ input: touch ? 'native CDP touch on visible joystick' : 'native keyboard', target, before: before.position, after: current.position }); return current; }
    const c = Math.cos(current.yaw), s = Math.sin(current.yaw);
    await pulse(page, session, { x: dx * c - dz * s, y: dx * s + dz * c }, Math.max(80, Math.min(450, remaining / 4.2 * 1000 * .8)), touch);
    const after = await state(page);
    stalls = distance(previous, after.position) < .015 ? stalls + 1 : 0; previous = after.position;
    assert(stalls < 6, 'Native movement stalled en route to ' + JSON.stringify(target) + ' from ' + JSON.stringify(after.position) + ' focus=' + after.focused);
  }
  throw Error('Native route timed out to ' + JSON.stringify(target));
}

async function interact(page, touch) {
  if (touch) await page.locator('.citadel-hub-interact').tap();
  else { await focusWorld(page); await page.keyboard.press('KeyE'); }
}
async function dismissDestination(page, touch) {
  if (touch) await page.locator('.citadel-hub-cancel').tap(); else await page.keyboard.press('Escape');
  await page.locator('.citadel-hub-dialog[open]').waitFor({ state: 'hidden' });
}
function noSpend(a, b, label) {
  const due = Math.max(0, Math.floor((b.observedAt - a.energyT) / (ENERGY.regenSec * 1000)));
  assert(a.gold === b.gold && b.energy >= a.energy && b.energy <= Math.min(a.energyMax, a.energy + due) && JSON.stringify(a.potions) === JSON.stringify(b.potions) && a.pending === null && b.pending === null, label + ': proximity/open spent resources');
}
async function returnFromBattle(page, touch) {
  const click = async s => touch ? page.locator(s).tap() : page.locator(s).click();
  await click('#btn-pause'); await click('#btn-giveup');
  await page.locator('.exp-result-shell').waitFor({ timeout: 25000 });
  await click('.exp-result-shell .exp-close');
  await page.locator('.citadel-hub-ui:not([hidden])').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
}

try {
  browser = await chromium.launch(launchOpts({ headless: true }));
  for (const config of [{ name: 'desktop', viewport: { width: 1440, height: 900 }, touch: false }, { name: 'portrait', viewport: { width: 390, height: 844 }, touch: true }].filter(config => selectedCases.includes(config.name))) {
    const row = { name: config.name, status: 'running', walks: [], frames: [], checks: {} }; report.cases.push(row);
    const context = await browser.newContext({ viewport: config.viewport, hasTouch: config.touch, isMobile: config.touch, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'bladesurge_save_v1', value: fixtureBytes.toString('utf8') }] }] } });
    const page = await context.newPage(), session = await context.newCDPSession(page);
    page.setDefaultTimeout(18000);
    page.on('pageerror', e => report.errors.push({ case: config.name, message: e.message }));
    page.on('response', response => { if (response.status() >= 400 && /\.(glb|png|webp|js|css)(\?|$)/.test(response.url())) report.errors.push({ case: config.name, url: response.url(), status: response.status() }); });
    try {
      await boot(page);
      if (requestedQuality) { await selectLowGraphics(page, config.touch); row.graphicsSelectedNatively = 'low'; }
      await capture(page, config.name + '-spawn', row);
      const initial = await state(page);
      assert(initial.level === fixtureSave.expedition.level && initial.gold === fixtureSave.gold, 'Earned fixture changed unexpectedly on load');
      if (recheck === 'labels') {
        const glass = spot('dungeon:glass_garden'), steward = spot('npc:arena-steward');
        await walk(page, session, { x: 0, z: 1 }, config.touch, row);
        await walk(page, session, { x: glass.x, z: glass.z + 1.05 }, config.touch, row);
        await capture(page, config.name + '-glass-gate-label-recheck', row); await interact(page, config.touch);
        await page.locator('.citadel-hub-dialog[open]').waitFor();
        assert((await page.locator('#citadel-destination-title').textContent()) === glass.label, 'Recheck opened wrong gate');
        await capture(page, config.name + '-glass-confirm-label-recheck', row); await dismissDestination(page, config.touch);
        await walk(page, session, { x: 0, z: 1 }, config.touch, row);
        await walk(page, session, { x: steward.x - 1.1, z: steward.z - .5 }, config.touch, row);
        await capture(page, config.name + '-steward-label-recheck', row);
        noSpend(initial, await state(page), 'Native visual label recheck');
        row.checks.labelRecheck = 'Native gate and steward approach; actual PNG review required';
        row.status = 'native-checks-pass-awaiting-visual-review';
        continue;
      }
      const merchant = spot('npc:potion-merchant');
      await walk(page, session, { x: merchant.x + 1.1, z: merchant.z - .5 }, config.touch, row);
      await page.waitForTimeout(450); const nearby = await state(page); noSpend(initial, nearby, 'Merchant approach');
      assert((await page.locator('.citadel-hub-near-name').textContent()) === merchant.label, 'Merchant nearby prompt mismatch');
      await capture(page, config.name + '-merchant', row);
      if (!config.touch) {
        await focusWorld(page); await page.keyboard.down('KeyD'); await page.waitForTimeout(100); await page.keyboard.press('KeyE');
      } else await interact(page, true);
      await page.locator('#citadel-shop[open]').waitFor();
      const modalAt = await state(page), modalClock = await page.evaluate(() => window.app.renderer.time);
      await page.waitForFunction(time => window.app.renderer.time - time >= .18, modalClock, { timeout: 15000 });
      const modalAfter = await state(page);
      assert(distance(modalAt.position, modalAfter.position) < .02, 'Held movement continued through shop modal');
      if (!config.touch) { await page.keyboard.up('KeyD'); assert(modalAfter.keys?.length === 0, 'Modal retained held movement keys'); }
      noSpend(nearby, modalAfter, 'Shop open'); row.checks.modalHeldInput = true;
      const purchase = page.locator('[data-buy-potion="hp_tonic"]');
      if (config.touch) await purchase.tap(); else await purchase.click();
      const bought = await state(page);
      assert(bought.gold === modalAfter.gold - 120 && bought.potions.hp_tonic === modalAfter.potions.hp_tonic + 1 && bought.potions.overdrive === modalAfter.potions.overdrive && bought.potions.aegis === modalAfter.potions.aegis, 'One native gold purchase has wrong inventory/currency delta');
      assert(bought.primary.gold === bought.gold && bought.primary.expedition.consumables.hp_tonic === bought.potions.hp_tonic, 'Purchase not persisted');
      await capture(page, config.name + '-shop-purchased', row);
      row.checks.purchase = { goldBefore: modalAfter.gold, goldAfter: bought.gold, stockBefore: modalAfter.potions.hp_tonic, stockAfter: bought.potions.hp_tonic };
      if (config.touch) await page.locator('.citadel-shop-close').tap(); else await page.keyboard.press('Escape');
      await boot(page, true);
      const reload = await state(page); assert(reload.gold === bought.gold && reload.potions.hp_tonic === bought.potions.hp_tonic, 'Native purchase lost on reload'); row.checks.reloadPersistence = true;
      if (!config.touch) {
        await focusWorld(page); await page.keyboard.down('KeyD'); await page.waitForTimeout(120);
        const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForTimeout(250); const blurred = await state(page);
        await page.bringToFront(); await page.waitForTimeout(250); const returned = await state(page);
        assert(blurred.keys?.length === 0 && distance(blurred.position, returned.position) < .02, 'Window blur retained held movement'); await page.keyboard.up('KeyD'); await other.close(); row.checks.blurHeldInput = true;
      }
      await walk(page, session, { x: 0, z: 3.6 }, config.touch, row);
      const locked = spot('dungeon:comet_bastion'), lockedBefore = await state(page);
      await walk(page, session, { x: locked.x - 1.05, z: locked.z }, config.touch, row); await capture(page, config.name + '-locked-gate', row); await interact(page, config.touch);
      await page.locator('.citadel-hub-dialog[open]').waitFor();
      const lockedState = await state(page), text = await page.locator('.citadel-hub-dialog').textContent();
      assert(text.includes(locked.label) && text.includes('탐험 Lv.' + locked.minLevel) && text.includes('에너지 ' + locked.energy) && await page.locator('.citadel-hub-go').isDisabled(), 'Locked exact route/cost/access missing'); noSpend(lockedBefore, lockedState, 'Locked gate');
      await capture(page, config.name + '-locked-dialog', row); row.checks.lockedGate = { route: locked.route, level: locked.minLevel, energy: locked.energy, blocked: true }; await dismissDestination(page, config.touch);
      await walk(page, session, { x: 9, z: 2 }, config.touch, row);
      await walk(page, session, { x: 0, z: 1 }, config.touch, row);
      const unlocked = spot('dungeon:glass_garden');
      await walk(page, session, { x: unlocked.x, z: unlocked.z + 1.05 }, config.touch, row); await capture(page, config.name + '-glass-gate', row); const entryBefore = await state(page); await interact(page, config.touch);
      await page.locator('.citadel-hub-dialog[open]').waitFor(); const confirm = await state(page); noSpend(entryBefore, confirm, 'Unlocked gate confirmation');
      assert((await page.locator('#citadel-destination-title').textContent()) === unlocked.label && await page.locator('.citadel-hub-go').isEnabled(), 'Exact unlocked route is not enterable');
      await capture(page, config.name + '-glass-confirm', row);
      if (config.touch) await page.locator('.citadel-hub-go').tap(); else await page.locator('.citadel-hub-go').click();
      await page.waitForFunction(() => window.app?.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 60000 });
      const entered = await state(page); assert(entered.stage?.kind === 'dungeon' && entered.stage.id === unlocked.route && entered.energy === confirm.energy - unlocked.energy && entered.gold === confirm.gold, 'Native route start/cost mismatch');
      row.checks.dungeonEntry = { route: entered.stage.id, energyBefore: confirm.energy, energyAfter: entered.energy }; await capture(page, config.name + '-dungeon-entered', row); await returnFromBattle(page, config.touch);
      const back = await state(page); assert(back.mode === 'lobby' && back.pending === null && back.selected === initial.selected && distance(back.position, { x: 0, z: 3.6 }) < .1, 'Native return failed to restore hub/hero'); row.checks.dungeonReturn = true;
      const steward = spot('npc:arena-steward'), arenaBefore = await state(page);
      await walk(page, session, { x: steward.x - 1.1, z: steward.z - .5 }, config.touch, row); await capture(page, config.name + '-arena-steward', row); await interact(page, config.touch);
      await page.locator('.exp-rivals').waitFor(); noSpend(arenaBefore, await state(page), 'Arena steward open');
      const arenaStart = page.locator('.exp-rivals article').first().getByRole('button', { name: '결투 시작', exact: true });
      if (config.touch) await arenaStart.tap(); else await arenaStart.click();
      await page.waitForFunction(() => window.app?.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 60000 });
      const arenaEntered = await state(page); assert(arenaEntered.stage?.kind === 'arena' && arenaEntered.energy === arenaBefore.energy, 'Arena native entry charged energy or wrong battle kind'); row.checks.arenaEntry = { id: arenaEntered.stage.id, energy: arenaEntered.energy }; await returnFromBattle(page, config.touch); row.checks.arenaReturn = (await state(page)).pending === null;
      await capture(page, config.name + '-returned', row);
      const menu = page.locator('.oath-nav-menu'); if (await menu.isVisible()) { if (config.touch) await menu.tap(); else await menu.click(); await capture(page, config.name + '-menu', row); await page.keyboard.press('Escape'); }
      row.status = 'native-checks-pass-awaiting-visual-review';
    } catch (error) { row.status = 'fail'; row.failure = String(error.stack || error); try { await capture(page, config.name + '-failure', row); } catch {} }
    finally { await context.close(); await saveReport(); }
  }
  for (const file of sources) assert(report.sources[file] === hash(await fs.readFile(path.join(root, file))), 'Frozen product changed during QA: ' + file);
  assert(report.artifactIndexSha256 === hash(await fs.readFile(path.join(root, 'dist/index.html'))), 'Frozen build changed during QA');
  assert(report.errors.length === 0, 'Browser/runtime asset errors observed');
  report.status = report.cases.every(row => row.status === 'native-checks-pass-awaiting-visual-review') ? 'native-checks-pass-awaiting-visual-review' : 'fail';
  if (report.status === 'fail') process.exitCode = 1;
} catch (error) { report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally { await browser?.close(); report.finished = new Date().toISOString(); await saveReport(); console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(({ name, status, failure }) => ({ name, status, failure })), errors: report.errors })); }
