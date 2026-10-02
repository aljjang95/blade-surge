// Actual UI departures and retries in a fresh, isolated local browser save.
// No restored profile, gear/currency grants, combat positions, HP, kills or outcome injection.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { installConquestMediaObserver, classifyMediaCancellations } from './conquest-media-observer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argument = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const remote = argument('origin');
if (remote && remote !== 'https://blade.tllhouse.com') throw Error('Hosted QA is restricted to the existing release origin');
const relative = argument('out') || `work/replayability-qa-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const out = path.resolve(root, relative);
if (!path.relative(root, out).replaceAll('\\', '/').startsWith('work/')) throw Error('Evidence must be under work/');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // Preserve every prior run; an existing output directory is an error.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = ['src/game/run-history.js', 'src/game/masterworks-core.js', 'src/game/masterworks-battle.js', 'src/ui/masterworks.js', 'src/ui/ui.js', 'src/expansion/hub.jsx', 'tools/replayability-qa.mjs'];
const report = { status: 'running', started: new Date().toISOString(), head,
  scope: 'Exact clean production build at local preview or the fixed release origin; fresh isolated save and normal UI choices. Fixed 1/60s app.step replaces wall-clock pacing only. First departure uses native J input then native AUTO; later departures use persisted AUTO. Actual victories, local records, reload and the existing same-route retry button. No physical phone, manual victory, long-term retention or AAA-completion proof.',
  sources: Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await fs.readFile(path.join(root, file)))]))),
  runs: [], errors: [], requestFailures: [], httpErrors: [], media: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await fs.copyFile(import.meta.filename, path.join(out, 'driver.mjs')); await save();
let server, browser, documentId = 0;

async function boot(page, url, reload = false) {
  documentId++; // Each native navigation creates a new media-observer document lifetime.
  if (reload) await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
  await page.evaluate(() => { window.app.testPause = true; });
  await page.waitForTimeout(900);
  // Existing daily/guide overlays are dismissed through their actual close controls.
  for (const selector of ['#modal.show #m-cancel', '#modal.show #m-guide-close']) {
    if (await page.locator(selector).isVisible()) await page.locator(selector).click();
  }
}

async function depart(page) {
  await page.locator('#btn-expedition').click();
  await page.locator('.adventure-nav [data-section="dungeons"]').click();
  await page.locator('.exp-route-tabs').getByRole('button', { name: '기본 원정', exact: true }).click();
  await page.locator('[data-dungeon="glass_garden"][data-depth="standard"] .exp-primary').click();
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  assert(await page.evaluate(() => window.app.battle.stage.expedition.id === 'glass_garden' && window.app.battle.stage.expedition.depth === 'standard'), 'Wrong native departure route');
}

async function manualAttackObservation(page) {
  return page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player, input = a.input, focus = document.activeElement;
    return { focus: { tag: focus?.tagName || null, id: focus?.id || null, hasFocus: document.hasFocus(),
      blocked: !!focus?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls') },
      mode: a.mode, active: b.active, paused: b.paused, elapsed: b.elapsed,
      input: { enabled: input.enabled, attackHeld: input.attackHeld, queue: [...input.queue], sources: [...input.attackSources], keyJ: !!input.keys.KeyJ },
      player: { auto: p.auto, alive: p.alive, state: p.state, stateT: p.stateT, comboIdx: p.comboIdx,
        currentAnim: p.current?.anim || null, expectedAnim: p.def.combo[p.comboIdx]?.anim || null,
        actionName: p.actionName, actionTime: p.action?.time ?? null, hitDone: p.hitDone }, controlSeen: b.run.controlSeen };
  });
}

async function acceptNativeManualAttack(page) {
  const evidence = { status: 'running', beforeFocus: await manualAttackObservation(page) };
  report.manualAttack = evidence; await save();
  // Use a real click on an unobstructed world pixel. Never alter tabindex,
  // player state, input queues or attack methods to manufacture acceptance.
  evidence.worldTarget = await page.evaluate(() => {
    const canvas = document.querySelector('#gl'), bounds = canvas.getBoundingClientRect();
    for (const [rx, ry] of [[.5, .62], [.5, .5], [.5, .4], [.4, .62], [.6, .62]]) {
      const x = bounds.left + bounds.width * rx, y = bounds.top + bounds.height * ry;
      if (document.elementFromPoint(x, y) === canvas) return { x, y, target: canvas.id };
    }
    return null;
  });
  await save(); assert(evidence.worldTarget, 'No unobstructed native gameplay focus target');
  await page.mouse.click(evidence.worldTarget.x, evidence.worldTarget.y);
  evidence.beforeKey = await manualAttackObservation(page); await save();
  const before = evidence.beforeKey;
  assert(before.focus.hasFocus && !before.focus.blocked && before.mode === 'battle' && before.active && !before.paused && before.input.enabled, 'Native gameplay focus/input is not ready');
  assert(before.player.auto === false && before.player.alive && ['idle', 'move'].includes(before.player.state) && !before.input.attackHeld && !before.input.queue.includes('attack'), 'Manual attack must begin from an untouched ready actor');
  try {
    await page.keyboard.down('j');
    evidence.keyDown = await manualAttackObservation(page); await save();
    assert(evidence.keyDown.input.attackHeld && evidence.keyDown.input.keyJ && evidence.keyDown.input.sources.includes('KeyJ') && evidence.keyDown.input.queue.includes('attack'), 'Real J keydown was ignored by gameplay input');
    await page.evaluate(() => window.app.step(1 / 60));
    evidence.afterOneStep = await manualAttackObservation(page); await save();
    const first = evidence.afterOneStep;
    assert(first.player.auto === false && first.player.state === 'attack' && first.player.currentAnim === first.player.expectedAnim && first.player.stateT > 0 && first.elapsed > before.elapsed && !first.input.queue.includes('attack'), 'Real J input did not start and advance the native attack');
    await page.evaluate(() => { for (let i = 0; i < 6; i++) window.app.step(1 / 60, i === 5); });
    evidence.attackProgress = await manualAttackObservation(page); await save();
    const progress = evidence.attackProgress;
    assert(progress.player.auto === false && progress.player.state === 'attack' && progress.player.currentAnim === first.player.currentAnim && progress.player.stateT > first.player.stateT && progress.elapsed > first.elapsed, 'Native manual attack failed to progress before AUTO');
    // Preserve the original 120 fixed frames before enabling AUTO.
    await page.evaluate(() => { for (let i = 0; i < 113; i++) window.app.step(1 / 60, i === 112); });
  } finally {
    await page.keyboard.up('j'); evidence.keyUp = await manualAttackObservation(page); await save();
  }
  assert(!evidence.keyUp.input.attackHeld && !evidence.keyUp.input.keyJ && !evidence.keyUp.input.sources.includes('KeyJ'), 'Native J release left an attack input held');
  evidence.status = 'pass'; await save();
}

async function complete(page, expectedControl) {
  const run = { status: 'running', expectedControl, choices: [] }; report.runs.push(run); await save();
  for (let chunk = 0; chunk < 90; chunk++) {
    run.last = await page.evaluate(() => {
      const a = window.app, b = a.battle;
      for (let frame = 0; frame < 600 && b.active && !b.paused; frame++) a.step(1 / 60, frame % 90 === 0);
      return { active: b.active, paused: b.paused, hp: b.player?.hp, elapsed: b.elapsed, kills: b.kills, win: b.result?.win };
    });
    if (run.last.paused) {
      const choice = page.locator('#masterworks[open] .mw-choices button, #masterworks[open] .mw-story-choices button').first();
      await choice.waitFor({ state: 'visible', timeout: 10000 });
      run.choices.push(await choice.evaluate(e => ({ boon: e.dataset.boon || null, story: e.dataset.storyChoice || null })));
      await choice.click();
    }
    if (!run.last.active) break;
    if (chunk % 12 === 0) { await save(); console.log(JSON.stringify({ phase: 'combat', ...run.last })); }
  }
  // Victory schedules the native result after its celebration; fixed-step mode
  // must keep advancing those existing timers even after combat is inactive.
  for (let chunk = 0; chunk < 20 && !await page.locator('.exp-result-shell').isVisible(); chunk++) {
    await page.evaluate(() => { for (let frame = 0; frame < 120 && !window.app.expeditionUI.result; frame++) window.app.step(1 / 60, frame === 119); });
  }
  await page.locator('.exp-result-shell').waitFor({ state: 'visible', timeout: 30000 });
  run.after = await page.evaluate(() => {
    const a = window.app, b = a.battle;
    return { result: structuredClone(a.expeditionUI.result), history: structuredClone(a.eco.s.masterworks.history),
      actual: { heroId: b.heroId, heroLevel: b.growthStart.level, perfects: b.run.perfects, breaks: b.run.breaks, timeSec: b.result.time },
      currencies: { gold: a.eco.s.gold, energy: a.eco.s.energy }, dirty: b.rpgDirty, pending: a.expedition.s.pending };
  });
  assert(run.after.result?.win === true && !run.after.result.saveError && !run.after.dirty && run.after.pending === null, 'Actual departure did not produce a saved victory');
  const record = run.after.history.at(-1);
  assert(record?.details?.route?.id === 'glass_garden' && record.details.route.depth === 'standard' && record.details.control === expectedControl, 'Route or actual control mode missing');
  for (const [key, value] of Object.entries(run.after.actual)) assert(record.details[key] === value, 'Observed record differs from real battle: ' + key);
  assert(record.outcome === 'victory' && record.details.heroId === 'knight', 'Default earned hero/outcome mismatch');
  await page.screenshot({ path: path.join(out, `result-${report.runs.length}.png`) });
  run.status = 'pass'; await save(); return record;
}

async function inspectJournal(page, record, fromResult) {
  const before = await page.evaluate(() => JSON.stringify(window.app.eco.s));
  if (fromResult) {
    await page.locator('.exp-result-shell').getByText('성장 기록 · 의뢰 보상', { exact: true }).click();
    await page.locator('.exp-result-shell').getByRole('button', { name: '명성으로 영구 숙련 배우기', exact: true }).click();
  } else await page.locator('.oath-nav-growth').click();
  await page.locator('#masterworks .mw-tabs').getByRole('button', { name: '기록', exact: true }).click();
  const card = page.locator(`[data-run-history="${record.runId}"]`);
  await card.scrollIntoViewIfNeeded();
  const text = await card.innerText();
  assert(text.includes('유리 정원') && text.includes('검성 아르카') && text.includes(`정확 회피 ${record.details.perfects}`) && text.includes(`균형 붕괴 ${record.details.breaks}`), 'Journal omitted actual route/hero/mastery');
  assert(text.includes(record.details.control === 'mixed' ? '수동·AUTO 혼합' : 'AUTO'), 'Journal mislabels AUTO');
  assert(await page.evaluate(before => JSON.stringify(window.app.eco.s) === before, before), 'Reading the journal spent resources or changed progression');
  await page.screenshot({ path: path.join(out, `journal-${record.runId}-document-${documentId}.png`) });
  await page.locator('#masterworks .mw-close').click(); return text;
}

try {
  assert(!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), 'Freeze/commit the candidate before actual UI QA');
  if (!remote) server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = remote || 'http://127.0.0.1:' + server.httpServer.address().port;
  report.origin = url;
  report.build = await (await fetch(url + '/version.json')).json();
  assert(report.build.sha === head && report.build.dirty === false, 'Production build is not the exact clean candidate');
  browser = await chromium.launch(launchOpts());
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(30000); await page.addInitScript(installConquestMediaObserver);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  const requests = new Map();
  page.on('request', request => requests.set(request, { engine: 'chromium', documentId, url: request.url(),
    type: request.resourceType(), range: request.headers().range || null, started: Date.now() }));
  page.on('response', response => {
    const request = response.request(), row = requests.get(request), timing = request.timing();
    if (row) Object.assign(row, { started: timing.startTime, status: response.status(),
      responseAt: timing.responseStart >= 0 ? timing.startTime + timing.responseStart : Date.now(),
      nodeResponseAt: Date.now(), contentRange: response.headers()['content-range'] || null });
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => {
    const row = requests.get(request), timing = request.timing();
    if (row) Object.assign(row, { started: timing.startTime, timing,
      failedAt: timing.responseEnd >= 0 ? timing.startTime + timing.responseEnd : Date.now(),
      nodeFailureAt: Date.now(), error: request.failure()?.errorText });
    report.requestFailures.push(row || { engine: 'chromium', documentId, url: request.url(),
      error: request.failure()?.errorText, failedAt: Date.now() });
  });
  await boot(page, url);
  report.initial = await page.evaluate(() => ({ selected: window.app.eco.s.selected, history: window.app.eco.s.masterworks.history.length, purchases: window.app.eco.s.purchases, spentKRW: window.app.eco.s.spentKRW }));
  assert(report.initial.selected === 'knight' && report.initial.history === 0 && report.initial.spentKRW === 0 && report.initial.purchases.length === 0, 'Expected untouched fresh free-play save');
  await depart(page);
  assert(await page.evaluate(() => window.app.battle.player.auto === false), 'Fresh departure unexpectedly uses AUTO');
  await acceptNativeManualAttack(page);
  await page.locator('#btn-auto').click();
  const first = await complete(page, 'mixed'); report.firstJournal = await inspectJournal(page, first, true);
  const saved = await page.evaluate(() => structuredClone(window.app.eco.s.masterworks.history));
  report.media.push({ engine: 'chromium', documentId, snapshot: await page.evaluate(() => window.__conquestMedia.snapshot()) });
  await boot(page, url, true);
  report.reload = await page.evaluate(() => structuredClone(window.app.eco.s.masterworks.history));
  assert(JSON.stringify(report.reload) === JSON.stringify(saved), 'History changed on reload');
  await inspectJournal(page, first, false);
  await depart(page);
  assert(await page.evaluate(() => window.app.battle.player.auto === true), 'Native AUTO setting was not persisted');
  const second = await complete(page, 'auto');
  assert(first.runId !== second.runId, 'Repeated actual departure reused a history identity');
  const button = page.locator('.exp-result-footer').getByRole('button', { name: '다시 도전 · 에너지 4', exact: true });
  const before = await page.evaluate(() => ({ energy: window.app.eco.s.energy, history: structuredClone(window.app.eco.s.masterworks.history), seq: window.app.expedition.s.seq }));
  await button.click(); await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  report.retry = await page.evaluate(() => ({ route: window.app.battle.stage.expedition, riftId: window.app.battle.stage.riftId || null, energy: window.app.eco.s.energy,
    pending: structuredClone(window.app.expedition.s.pending), history: structuredClone(window.app.eco.s.masterworks.history) }));
  assert(report.retry.route.id === 'glass_garden' && report.retry.route.depth === 'standard' && !report.retry.route.conquestId && !report.retry.riftId, 'Retry changed the native destination');
  assert(report.retry.pending?.energy === 4 && report.retry.pending.id === before.seq + 1 && report.retry.energy === before.energy - 4, 'Existing retry did not charge its displayed catalog price exactly once');
  assert(JSON.stringify(report.retry.history) === JSON.stringify(before.history), 'Departure created a completed record or repaid a result');
  report.media.push({ engine: 'chromium', documentId, snapshot: await page.evaluate(() => window.__conquestMedia.snapshot()) });
  await boot(page, url, true);
  report.unfinishedReload = await page.evaluate(() => ({ energy: window.app.eco.s.energy, history: structuredClone(window.app.eco.s.masterworks.history), pending: window.app.expedition.s.pending }));
  assert(report.unfinishedReload.energy === before.energy && report.unfinishedReload.pending === null && JSON.stringify(report.unfinishedReload.history) === JSON.stringify(before.history), 'Unfinished native retry did not refund once without inventing completion');
  await boot(page, url, true);
  const again = await page.evaluate(() => ({ energy: window.app.eco.s.energy, history: structuredClone(window.app.eco.s.masterworks.history) }));
  assert(again.energy === report.unfinishedReload.energy && JSON.stringify(again.history) === JSON.stringify(before.history), 'Repeated reload duplicated refund or records');
  report.media.push({ engine: 'chromium', documentId, snapshot: await page.evaluate(() => window.__conquestMedia.snapshot()) });
  // Observer track IDs reset on a native reload. Preserve each actual document's
  // identity rather than treating two independent lifetimes as duplicate instances.
  // All failures remain subject to the unchanged strict lifecycle classifier.
  report.mediaCancellations = { classified: [], unresolved: [], documents: [] };
  for (const id of new Set(report.requestFailures.map(request => request.documentId))) {
    const failures = report.requestFailures.filter(request => request.documentId === id);
    const snapshots = report.media.filter(media => media.documentId === id);
    const result = classifyMediaCancellations(failures, snapshots);
    report.mediaCancellations.documents.push({ documentId: id, ...result });
    report.mediaCancellations.classified.push(...result.classified);
    report.mediaCancellations.unresolved.push(...result.unresolved);
  }
  assert(report.errors.length === 0 && report.httpErrors.length === 0 && report.mediaCancellations.unresolved.length === 0, 'Unresolved browser/runtime/network failures');
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve());
  report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure }));
}
