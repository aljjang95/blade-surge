// Independent, finite native-input check. Root supplies a frozen compiled origin.
// This driver does not build, deploy, grant progression, invoke gameplay methods,
// set actor positions, advance simulation, or write game state through evaluate.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';
import { HEROES } from '../src/data/heroes.js';
import { ENERGY } from '../src/data/shop.js';

const root = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = arg('origin'), expectedSha = arg('expected-sha');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '') || !/^[a-f0-9]{40}$/.test(expectedSha || '')) throw Error('Supply a frozen --origin=http://127.0.0.1:PORT and --expected-sha=40_HEX. No server is started by this driver.');
const run = arg('run') || new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw Error('Invalid run label');
const out = path.join(root, 'work/qa/citadel-preparation-20261004', run);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // A previous attempt is never overwritten.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (value, message) => { if (!value) throw Error(message); };
const driver = await fs.readFile(import.meta.filename);
await fs.writeFile(path.join(out, 'driver.mjs'), driver, { flag: 'wx' });
const sourceFiles = ['src/main.js', 'src/ui/citadel-hub.js', 'src/ui/citadel-hub.css', 'src/game/citadel-preparation.js', 'src/game/hub-movement.js', 'src/engine/hub-controls.js', 'src/game/expedition-economy.js', 'src/game/expedition-combat.js', 'src/game/masterworks-service.js', 'src/game/masterworks-battle.js', 'src/game/run-personal-goals.js', 'src/game/run-history.js', 'src/data/citadel-hub.js', 'src/data/expansion.js', 'src/data/expedition-depths.js', 'src/data/seasonal-content.js', 'src/expansion/hub.jsx', 'src/ui/masterworks.js', 'src/ui/journey.js', 'src/game/journey-service.js'];
const report = { status: 'running', origin, expectedSha, started: new Date().toISOString(), driverSha256: hash(driver), scope: 'One 390×844 emulated-touch Chromium journey against a frozen compiled candidate. Exact naturally-earned fixture, actual native setting/goal choices, Glass standard/deep preparation, one standard entry, I attack potion, native giveup/settlement/return/reload. No fake progression or simulation pacing.', limitations: ['Physical phone, subjective human play, FPS, unlocked deep admission, deep combat, and winning rewards are not verified here.', 'The original naturally-earned fixture has AUTO enabled and no saved goal; changes to manual and one real history goal are deliberate native UI actions recorded separately.'], sources: {}, compiledFiles: [], checks: {}, nativeSteps: [], walks: [], screenshots: [], runtimeErrors: [], networkErrors: [], blockedRequests: [], visualReview: 'pending independent image inspection' };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await save();
let browser, context, page, fixtureSave, prepared;
const deadline = setTimeout(() => { report.status = 'fail'; report.failure = 'Finite native driver exceeded its 10-minute wall-time guard'; void save().finally(() => process.exit(1)); }, 600000);

async function state() {
  return page.evaluate(() => {
    const app = window.app, position = app.showcase?.root.position, e = app.renderer.camera.matrixWorld.elements;
    const stored = localStorage.getItem('bladesurge_save_v1'), primary = stored ? JSON.parse(stored) : null;
    const player = app.battle?.player;
    return { observedAt: Date.now(), mode: app.mode, tab: app.meta.tab, starting: !!app.stageStarting, rendererClock: app.renderer.time,
      position: position ? { x: position.x, y: position.y, z: position.z } : null, yaw: Math.atan2(-e[2], e[0]), nearest: app.hubMovement?.nearest?.id,
      gold: app.eco.s.gold, energy: app.eco.s.energy, energyT: app.eco.s.energyT, energyMax: app.eco.energyMax,
      selected: app.eco.s.selected, heroLevel: app.eco.s.heroes[app.eco.s.selected]?.level, autoBattle: app.journey.s.autoBattle,
      potions: { ...app.expedition.s.consumables }, consumed: app.expedition.s.stats.consumed, pending: app.expedition.s.pending ? { ...app.expedition.s.pending } : null,
      goal: app.masterworks.s.personalGoal, history: app.masterworks.s.history,
      stage: app.battle?.stage?.expedition || null, active: !!app.battle?.active, paused: !!app.battle?.paused,
      player: player ? { alive: player.alive, auto: player.auto, hp: player.hp, maxHp: player.maxHp, tonicAtkT: player.tonicAtkT || 0 } : null,
      result: app.expeditionUI.result ? { win: app.expeditionUI.result.win, saveError: app.expeditionUI.result.saveError, rewards: app.expeditionUI.result.rewards } : null,
      receipt: app.battle?.result?.expeditionReceipt || null, rpgDirty: !!app.battle?.rpgDirty,
      keys: Object.keys(app.hubControls?.keys || {}), pointer: app.hubControls?.pointer?.id ?? null,
      focused: document.activeElement?.className || document.activeElement?.id || document.activeElement?.tagName,
      primary: primary ? { gold: primary.gold, selected: primary.selected, autoBattle: primary.journey?.autoBattle, potions: primary.expedition?.consumables, consumed: primary.expedition?.stats?.consumed, pending: primary.expedition?.pending, goal: primary.masterworks?.personalGoal } : null };
  });
}

function unchanged(before, after, label, { allowGoal = false, allowAuto = false } = {}) {
  const regenDue = Math.max(0, Math.floor((after.observedAt - before.energyT) / (ENERGY.regenSec * 1000)));
  assert(before.gold === after.gold && equal(before.potions, after.potions) && before.consumed === after.consumed && before.pending === null && after.pending === null && before.selected === after.selected && before.heroLevel === after.heroLevel && equal(before.history, after.history), `${label}: preparation changed currency, stock, receipt, hero, or history`);
  assert(after.energy >= before.energy && after.energy <= Math.min(before.energyMax, before.energy + regenDue), `${label}: energy changed outside natural regeneration`);
  if (!allowGoal) assert(equal(before.goal, after.goal), `${label}: changed selected personal goal`);
  if (!allowAuto) assert(before.autoBattle === after.autoBattle, `${label}: changed departure control`);
}

async function step(name, action) {
  const row = { name, started: new Date().toISOString(), status: 'running' }; report.nativeSteps.push(row); await save();
  try { const result = await action(); row.after = await state(); row.status = 'pass'; row.finished = new Date().toISOString(); await save(); return result; }
  catch (error) { row.status = 'fail'; row.error = String(error); try { row.after = await state(); } catch {} await save(); throw error; }
}

async function boot(reload = false) {
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' }); else await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const portrait = page.getByRole('button', { name: '세로로 계속하기', exact: true });
  if (await portrait.isVisible()) await portrait.tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 90000 });
  if (await portrait.isVisible()) await portrait.tap();
  const close = page.locator('#modal.show #m-cancel');
  await page.waitForTimeout(700);
  if (await close.isVisible()) await close.tap();
  await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
}

async function screenshot(name) {
  const before = await page.evaluate(() => window.app.renderer.time);
  if (!(await page.evaluate(() => window.app.expeditionUI.opened))) await page.waitForFunction(time => window.app.renderer.time - time >= .08, before, { timeout: 25000 });
  const layout = await page.evaluate(() => {
    const box = selector => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { selector, x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, dialog: box('.citadel-hub-dialog[open]'), go: box('.citadel-hub-dialog[open] .citadel-hub-go') };
  });
  assert(layout.scrollWidth <= layout.width, `${name}: horizontal document overflow`);
  if (layout.dialog) assert(layout.dialog.x >= -1 && layout.dialog.y >= -1 && layout.dialog.x + layout.dialog.width <= layout.width + 1 && layout.dialog.y + layout.dialog.height <= layout.height + 1, `${name}: destination dialog exceeds viewport`);
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 25000 });
  report.screenshots.push({ file: `${name}.png`, layout, state: await state() }); await save();
}

// Reuse the proven partial-deflection touch protocol; release latency otherwise
// makes full-throw short pulses oscillate. Clock reads happen AFTER touchMove.
async function pulse(session, vector, milliseconds) {
  const box = await page.locator('.citadel-hub-stick').boundingBox(); assert(box, 'Visible native touch joystick missing');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, length = Math.hypot(vector.x, vector.y) || 1;
  const radius = Math.min(box.width, box.height) * .34 * Math.max(.22, Math.min(1, milliseconds / 450));
  const seconds = Math.max(.08, Math.min(.12, milliseconds / 1000));
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + vector.x / length * radius, y: center.y + vector.y / length * radius, id: 1 }] });
    const clock = await page.evaluate(() => window.app.renderer.time);
    await page.waitForFunction(({ clock, seconds }) => window.app.renderer.time - clock >= seconds, { clock, seconds }, { timeout: 25000 });
  } finally { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

async function walk(session, target, { tolerance = .42, nearest = null } = {}) {
  const row = { target, before: await state(), pulses: [] }; report.walks.push(row);
  const until = Date.now() + 100000; let stalls = 0;
  for (let n = 0; n < 55 && Date.now() < until; n++) {
    const before = await state(), dx = target.x - before.position.x, dz = target.z - before.position.z, remaining = Math.hypot(dx, dz);
    if (nearest ? before.nearest === nearest : remaining <= tolerance) { row.after = before; row.status = 'pass'; await save(); return; }
    const c = Math.cos(before.yaw), s = Math.sin(before.yaw);
    await pulse(session, { x: dx * c - dz * s, y: dx * s + dz * c }, Math.max(80, Math.min(450, remaining / 4.2 * 1000 * .8)));
    const after = await state(), moved = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    row.pulses.push({ before: before.position, after: after.position, clockBefore: before.rendererClock, clockAfter: after.rendererClock });
    stalls = moved < .015 ? stalls + 1 : 0; assert(stalls < 6, `Native touch stalled approaching ${JSON.stringify(target)} at ${JSON.stringify(after.position)}`);
  }
  row.status = 'fail'; row.after = await state(); await save(); throw Error(`Finite touch approach failed to reach ${JSON.stringify(target)}`);
}

async function prepState() {
  return page.evaluate(() => {
    const dialog = document.querySelector('.citadel-hub-dialog[open]');
    const text = label => dialog.querySelector(`[aria-label="${label}"]`)?.textContent.trim() ?? null;
    return { title: dialog.querySelector('#citadel-destination-title').textContent, depth: dialog.querySelector('[data-citadel-depth]:checked')?.dataset.citadelDepth,
      stats: dialog.querySelector('.citadel-hub-destination-stats').textContent, unlock: dialog.querySelector('[data-citadel-unlock]').textContent, cost: dialog.querySelector('[data-citadel-cost]').textContent, objective: dialog.querySelector('.citadel-hub-objective').textContent,
      access: dialog.querySelector('.citadel-hub-access').textContent, goText: dialog.querySelector('.citadel-hub-go').textContent, goDisabled: dialog.querySelector('.citadel-hub-go').disabled,
      rewards: text('클리어 보상'), hero: text('출격 영웅'), goal: text('개인 목표'), goalStatus: dialog.querySelector('[aria-label="개인 목표"]').dataset.status, potionsText: text('보유 물약'),
      potions: [...dialog.querySelectorAll('[data-citadel-potion]')].map(row => ({ id: row.dataset.citadelPotion, text: row.textContent, count: Number(row.querySelector('[data-citadel-potion-count]').textContent.replace(/\D/g, '')), key: row.querySelector('kbd')?.textContent })) };
  });
}

try {
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); assert(report.head === expectedSha, 'Source HEAD differs from expected frozen candidate');
  for (const file of sourceFiles) report.sources[file] = hash(await fs.readFile(path.join(root, file)));
  report.version = JSON.parse(await fs.readFile(path.join(root, 'dist/version.json'), 'utf8'));
  assert(report.version.sha === expectedSha && report.version.dirty === false, 'Candidate dist must carry expected SHA and dirty:false');
  const index = await fs.readFile(path.join(root, 'dist/index.html')), served = Buffer.from(await (await fetch(origin, { cache: 'no-store', signal: AbortSignal.timeout(25000) })).text());
  assert(hash(index) === hash(served) && !served.includes('/@vite/client') && !served.includes('/src/main.js'), 'Supplied origin does not serve the frozen compiled index');
  report.artifactIndexSha256 = hash(index);
  report.servedVersion = await (await fetch(`${origin}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(25000) })).json();
  assert(report.servedVersion.sha === expectedSha && report.servedVersion.dirty === false, 'Served version differs from the compiled candidate');
  for (const file of [...new Set([...index.toString().matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]))]) {
    const local = await fs.readFile(path.join(root, 'dist', file.slice(1))), response = await fetch(`${origin}${file}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
    assert(response.ok, `${file}: HTTP ${response.status}`); const bytes = Buffer.from(await response.arrayBuffer());
    report.compiledFiles.push({ file, bytes: bytes.length, sha256: hash(bytes), localSha256: hash(local) }); assert(hash(bytes) === hash(local), `${file}: served bytes differ from frozen dist`);
  }
  const fixturePath = path.join(root, 'work/aaa-20261003/astral-earned-d376ee6/earned-save.json'), fixtureBytes = await fs.readFile(fixturePath);
  const receiptBytes = await fs.readFile(path.join(path.dirname(fixturePath), 'report.json')), receipt = JSON.parse(receiptBytes);
  assert(hash(fixtureBytes) === '32168140f3355b1afcad07b4e77e5b9f9a98b04c2a349265dbe9920c6deced61' && receipt.status === 'pass' && receipt.naturalStart === true && receipt.synthetic === false && receipt.earnedSave?.natural === true && receipt.earnedSave.sha256 === hash(fixtureBytes), 'Fixture does not match its naturally-earned passing receipt');
  fixtureSave = JSON.parse(fixtureBytes);
  report.fixture = { path: fixturePath, sha256: hash(fixtureBytes), receiptSha256: hash(receiptBytes), natural: true, exactOriginalBytes: true, installation: 'Fresh isolated browser storageState before navigation; no evaluate/localStorage writes', level: fixtureSave.expedition.level, gold: fixtureSave.gold, potions: fixtureSave.expedition.consumables };
  await fs.writeFile(path.join(out, 'fixture-original.json'), fixtureBytes, { flag: 'wx' }); await fs.writeFile(path.join(out, 'fixture-earned-receipt.json'), receiptBytes, { flag: 'wx' }); await save();
  browser = await chromium.launch(launchOpts({ headless: true }));
  report.browser = { version: browser.version(), viewport: { width: 390, height: 844 }, touch: true, isMobile: true, serviceWorkers: 'blocked', rendererScope: 'SwiftShader software harness; actual renderer-clock waits do not accelerate or replace simulation' };
  context = await browser.newContext({ viewport: report.browser.viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'bladesurge_save_v1', value: fixtureBytes.toString('utf8') }] }] } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method()) || ![origin, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin) || (url.origin === origin && url.pathname.startsWith('/api/'))) { report.blockedRequests.push({ url: request.url(), method: request.method() }); await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(20000); const session = await context.newCDPSession(page);
  page.on('pageerror', error => report.runtimeErrors.push({ message: error.message, stack: error.stack }));
  page.on('response', response => { if (response.status() >= 400 && /\.(?:glb|gltf|png|jpe?g|webp|svg|woff2?|js|css|mp3|ogg|wav|mp4)(\?|$)/.test(response.url())) report.networkErrors.push({ url: response.url(), status: response.status() }); });
  page.on('requestfailed', request => { if (['script', 'stylesheet', 'image', 'font', 'media'].includes(request.resourceType()) || /\.glb(\?|$)/.test(request.url())) report.networkErrors.push({ url: request.url(), failure: request.failure()?.errorText }); });
  await step('Boot exact naturally-earned fixture', () => boot()); report.initial = await state();
  assert(report.initial.gold === fixtureSave.gold && equal(report.initial.potions, fixtureSave.expedition.consumables) && equal(report.initial.history, fixtureSave.masterworks.history) && report.initial.goal === null && report.initial.pending === null, 'Boot changed the earned fixture resources/history/goal');
  await step('Choose manual through existing native Journey Supply checkbox', async () => {
    await page.locator('.oath-nav-menu').tap();
    await page.locator('#oath-menu[open] .journey-lobby').tap(); await page.locator('#journey[open] [data-control="tab-supply"]').tap();
    const input = page.locator('#journey[open] [data-control="auto-battle"]'); assert(await input.isChecked(), 'Earned fixture did not have its native AUTO setting'); await input.tap();
    await page.waitForFunction(() => window.app.journey.s.autoBattle === false); await page.locator('#journey[open] .journey-close').tap();
    const after = await state(); unchanged(report.initial, after, 'Native manual setting', { allowAuto: true }); assert(after.primary.autoBattle === false, 'Manual choice was not durably saved'); report.checks.nativeManualSetting = { before: report.initial.autoBattle, after: after.autoBattle };
  });
  await step('Choose a real prior Lv4 AUTO perfect-dodge goal through native journal', async () => {
    const before = await state(); await page.locator('.oath-nav-growth').tap(); await page.locator('#masterworks[open] .mw-tabs').getByRole('button', { name: '기록', exact: true }).tap();
    await page.locator('#masterworks[open] [data-goal-run="4"]').tap(); await page.locator('#masterworks[open] [data-personal-goal-metric="perfects"]').tap();
    await page.waitForFunction(() => window.app.masterworks.s.personalGoal?.metric === 'perfects'); await page.locator('#masterworks[open] .mw-close').tap();
    const after = await state(); unchanged(before, after, 'Native real-history goal selection', { allowGoal: true });
    assert(after.goal.context.heroLevel === 4 && after.goal.context.control === 'auto' && after.goal.context.route.id === 'glass_garden' && equal(after.primary.goal, after.goal), 'Native journal did not persist the exact prior earned history goal'); report.checks.nativeGoalSelection = { runId: 4, before: before.goal, after: after.goal };
  });
  prepared = await state(); const glass = CITADEL_HUB_HOTSPOTS.find(spot => spot.id === 'dungeon:glass_garden');
  await step('Touch-walk clear physical roads to Glass gate', async () => { await walk(session, { x: 0, z: 1 }); await walk(session, { x: -8.5, z: 1 }); await walk(session, { x: -8.5, z: glass.z + 1.05 }, { nearest: glass.id }); unchanged(prepared, await state(), 'Physical gate approach'); });
  await screenshot('portrait-glass-gate');
  await step('Open actual standard preparation with native proximity button', async () => {
    await page.locator('.citadel-hub-interact').tap(); await page.locator('.citadel-hub-dialog[open]').waitFor(); const view = await prepState(), live = await state();
    assert(view.depth === 'standard' && view.title === glass.label && !view.goDisabled && /에너지\s*4/.test(view.goText), 'Standard preparation shows wrong canonical route/cost/access');
    assert(/360/.test(view.rewards) && /유리 잎/.test(view.rewards), 'Standard fixed clear reward is missing');
    assert(view.hero.includes(HEROES[live.selected].name) && /Lv\.?\s*5/.test(view.hero) && /수동/.test(view.hero), 'Preparation does not show actual selected Lv5 manual hero');
    assert(equal(view.potions.map(p => [p.id, p.count, p.key]), [['hp_tonic', 7, 'U'], ['overdrive', 1, 'I'], ['aegis', 1, 'O']]), 'Preparation potion counts/keys differ from real owned stock');
    assert(/회복 물약/.test(view.potionsText) && /35%/.test(view.potionsText) && /25%/.test(view.potionsText) && /30%/.test(view.potionsText), 'Canonical potion effect descriptions missing');
    assert(view.goalStatus === 'mismatch' && /Lv\.?\s*4/.test(view.goal) && /AUTO/.test(view.goal) && /(다르|불일치|비교하지|달라)/.test(view.goal), 'Preparation falsely treats the saved Lv4 AUTO goal as current Lv5 manual conditions');
    unchanged(prepared, live, 'Standard preparation open'); assert(live.keys.length === 0 && live.pointer === null, 'Destination dialog retained lobby input'); report.checks.standardPrep = view;
  });
  await screenshot('portrait-standard-preparation');
  await step('Scroll native preparation to actual supplies and saved mismatch', async () => {
    const box = await page.locator('.citadel-hub-destination-scroll').boundingBox(); assert(box, 'Preparation scroll area missing');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 1100);
    unchanged(prepared, await state(), 'Native preparation scroll'); await screenshot('portrait-standard-supplies-goal');
  });
  await step('Select genuinely locked deep route through native radio', async () => {
    await page.locator('.citadel-hub-dialog[open] [data-citadel-depth="deep"]').tap(); const view = await prepState();
    assert(view.depth === 'deep' && /종의 뿌리/.test(view.title) && /에너지\s*6/.test(view.goText) && /Lv\.?\s*1/.test(view.unlock) && view.goDisabled && /2-10/.test(view.access), 'Deep prep did not show canonical cost6/minLv1 and actual campaign2-10 lock');
    assert(/1400|1,400/.test(view.rewards) && /1000|1,000/.test(view.rewards), 'Deep preparation omitted base and conditional first-clear gold');
    unchanged(prepared, await state(), 'Locked deep toggle'); report.checks.lockedDeepPrep = view;
  });
  await screenshot('portrait-deep-locked-preparation');
  await step('Restore standard, cancel, reopen with native E without spending', async () => {
    await page.locator('.citadel-hub-dialog[open] [data-citadel-depth="standard"]').tap(); await page.locator('.citadel-hub-cancel').tap(); await page.locator('.citadel-hub-dialog[open]').waitFor({ state: 'hidden' });
    await page.keyboard.press('KeyE'); await page.locator('.citadel-hub-dialog[open]').waitFor(); const view = await prepState();
    assert(view.depth === 'standard' && !view.goDisabled && /에너지\s*4/.test(view.goText), 'Native E reopen did not restore accessible standard preparation'); unchanged(prepared, await state(), 'Native cancel and E reopen'); report.checks.cancelReopen = view;
  });
  await step('Use actual gate-to-journal bridge, close and reopen with native E', async () => {
    await page.locator('.citadel-hub-dialog[open] .citadel-hub-goal-open').tap();
    await page.locator('#masterworks[open][data-view="journal"]').waitFor();
    assert(!(await page.locator('.citadel-hub-dialog').evaluate(dialog => dialog.open)), 'Journal bridge left destination dialog open');
    unchanged(prepared, await state(), 'Native gate-to-journal bridge');
    await screenshot('portrait-native-journal-bridge');
    await page.locator('#masterworks[open] .mw-close').tap();
    await page.waitForFunction(() => !document.querySelector('#masterworks[open]') &&
      document.activeElement === document.querySelector('.citadel-hub-interact:not([disabled])') && window.app.canWalkHub());
    await page.keyboard.press('KeyE');
    await page.locator('.citadel-hub-dialog[open]').waitFor(); const view = await prepState();
    assert(view.depth === 'standard' && !view.goDisabled && view.goalStatus === 'mismatch', 'Journal bridge return lost standard admission or saved mismatch');
    unchanged(prepared, await state(), 'Native journal close and E reopen'); report.checks.journalBridge = view;
  });
  await step('Enter once through ordinary canonical standard admission', async () => {
    const before = await state(); await page.locator('.citadel-hub-go').tap();
    await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle.active && window.app.battle.stage?.expedition?.id === 'glass_garden', undefined, { timeout: 90000 });
    await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle.active && !window.app.stageStarting && !document.querySelector('.exp-cinematic'), undefined, { timeout: 25000 });
    const after = await state(); assert(after.stage.kind === 'dungeon' && after.stage.id === 'glass_garden' && after.stage.depth === 'standard' && after.pending?.energy === 4 && before.energy - after.energy === 4, 'Canonical entry did not issue one standard ticket and exact energy4 charge');
    assert(after.gold === before.gold && equal(after.potions, before.potions) && equal(after.goal, before.goal) && after.player.auto === false, 'Entry changed preparation stock/goal/currency or manual setting'); report.checks.entry = { before, after };
  });
  await step('Use owned attack potion with actual native I input', async () => {
    const before = await state(); await page.keyboard.press('KeyI');
    await page.waitForFunction(() => window.app.expedition.s.consumables.overdrive === 0 && window.app.battle.player.tonicAtkT > 0, undefined, { timeout: 15000 });
    const after = await state(); assert(after.potions.overdrive === before.potions.overdrive - 1 && after.potions.hp_tonic === before.potions.hp_tonic && after.potions.aegis === before.potions.aegis && after.consumed === before.consumed + 1 && after.player.tonicAtkT > 0 && after.player.tonicAtkT <= 12 && after.gold === before.gold && equal(after.goal, before.goal) && after.primary.potions.overdrive === 0, 'Native I did not durably consume exactly one owned potion and apply its live effect'); report.checks.nativePotion = { before, after };
  });
  await screenshot('portrait-native-overdrive');
  await step('Native giveup, one saved failure receipt, return and reload', async () => {
    await page.locator('#btn-pause').tap(); await page.locator('#btn-giveup').tap(); await page.locator('.exp-result-shell').waitFor({ timeout: 25000 });
    const settled = await state(); assert(settled.result?.win === false && !settled.result.saveError && settled.receipt?.ok === true && settled.pending === null && equal(settled.result.rewards, {}), 'Actual giveup result did not save a reward-free terminal receipt'); report.checks.settlement = settled;
    await screenshot('portrait-native-failure-receipt'); await page.locator('.exp-result-shell .exp-close').tap(); await page.locator('.citadel-hub-ui:not([hidden])').waitFor();
    const returned = await state(); assert(returned.mode === 'lobby' && returned.pending === null && returned.selected === prepared.selected && Math.hypot(returned.position.x, returned.position.z - 3.6) < .01 && equal(returned.goal, prepared.goal) && returned.potions.overdrive === 0 && returned.gold === prepared.gold, 'Saved return did not retain hero, consumed stock, goal, and unchanged gold'); report.checks.returned = returned;
    await boot(true); const loaded = await state(); assert(loaded.mode === 'lobby' && loaded.pending === null && loaded.potions.hp_tonic === 7 && loaded.potions.overdrive === 0 && loaded.potions.aegis === 1 && loaded.consumed === prepared.consumed + 1 && loaded.gold === prepared.gold && loaded.autoBattle === false && equal(loaded.goal, prepared.goal) && equal(loaded.primary.goal, prepared.goal), 'Reload resurrected consumed potion or lost native manual/goal/save choices'); report.checks.reload = loaded;
  });
  await screenshot('portrait-reloaded-hub');
  for (const file of sourceFiles) assert(hash(await fs.readFile(path.join(root, file))) === report.sources[file], `${file}: production source changed during frozen QA`);
  assert(report.runtimeErrors.length === 0 && report.networkErrors.length === 0 && report.blockedRequests.length === 0, 'Native driver recorded JavaScript, asset/network, or disallowed request errors');
  report.status = 'native-checks-pass-awaiting-visual-review';
} catch (error) {
  report.status = 'fail'; report.failure = String(error); process.exitCode = 1;
  if (page) { try { report.failedState = await state(); await page.screenshot({ path: path.join(out, 'native-failure.png'), timeout: 15000 }); report.screenshots.push({ file: 'native-failure.png', failureEvidence: true }); } catch (failure) { report.failureCaptureError = String(failure); } }
} finally {
  clearTimeout(deadline);
  if (context) try { const storage = await context.storageState(); await fs.writeFile(path.join(out, 'actual-storage-final.json'), JSON.stringify(storage, null, 2), { flag: 'wx' }); } catch (error) { report.storageCaptureError = String(error); }
  await browser?.close(); report.finished = new Date().toISOString(); await save();
  console.log(JSON.stringify({ status: report.status, out, expectedSha, driverSha256: report.driverSha256, nativeSteps: report.nativeSteps.length, walks: report.walks.length, runtimeErrors: report.runtimeErrors.length, networkErrors: report.networkErrors.length, failure: report.failure }));
}
