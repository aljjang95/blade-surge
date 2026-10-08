// 자연 RAF에서 실제 브라우저 입력만 보내는 격리된 QA 실행기.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../../tools/chrome.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const out = path.resolve(root, String(args.out || `work/dungeon-forge-20261008/natural-${Date.now()}`));
const report = { schema: 1, status: 'RUNNING', startedAt: new Date().toISOString(),
  scope: 'Isolated Chromium software renderer, natural requestAnimationFrame only, fresh local save and native pointer/keyboard input. App state is read only. No app.step, app.testPause mutation, actor spawning, grants or invulnerability. This is scripted browser play, not human playtesting, physical-device performance, perceived audio quality or production acceptance. Companion remains naturally active, so kills are not attributed solely to player attacks.',
  checks: [], actions: [], samples: [], screenshots: [], errors: [], warnings: [], failedRequests: [], badResponses: [], externalRequests: [] };
await mkdir(out, { recursive: false });
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const check = (ok, name, evidence) => { report.checks.push({ status: ok ? 'PASS' : 'FAIL', name, evidence }); if (!ok) throw Error(name); };
let browser, server, page;
const sample = async label => {
  const value = await page.evaluate(() => {
    const a = window.app, b = a?.battle, p = b?.player;
    const alive = (b?.enemies || []).filter(e => e.alive);
    const near = p ? alive.map(e => ({ type: e.type, distance: Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z),
      dx: e.pos.x - p.pos.x, dz: e.pos.z - p.pos.z, hp: e.hp })).sort((x, y) => x.distance - y.distance)[0] : null;
    return { mode: a?.mode, stage: b?.stage?.code, active: b?.active, paused: b?.paused, elapsed: b?.elapsed,
      kills: b?.kills, roomsCleared: b?.roomsCleared, result: b?.result ? { win: b.result.win } : null,
      testPause: !!a?.testPause, inputEnabled: a?.input?.enabled, held: a?.input?.attackHeld,
      player: p ? { auto: p.auto, hp: p.hp, maxHp: p.maxHp, mp: p.mp, pos: p.pos.toArray(), state: p.state,
        stateT: p.stateT, comboIdx: p.comboIdx, clip: p.actionName, dodgeCd: p.dodgeCd, cds: [...p.cds] } : null,
      nearest: near, alive: alive.length, trailSamples: Math.max(0, ...(a?.fx?.trails || []).map(t => t.n || 0)),
      fxItems: a?.fx?.items?.length || 0, rendererCalls: a?.renderer?.r?.info?.render?.calls,
      focus: document.activeElement?.id, modal: !!document.querySelector('#modal.show'),
      offer: document.querySelector('#masterworks[open]')?.dataset.offer || null };
  });
  const row = { label, wallAt: new Date().toISOString(), ...value }; report.samples.push(row); return row;
};
const shot = async name => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f, timeout: 45000 }); report.screenshots.push(f); };
const click = async selector => { report.actions.push({ at: new Date().toISOString(), input: 'pointer-click', selector }); await page.locator(selector).click({ timeout: 15000 }); };
const press = async key => { report.actions.push({ at: new Date().toISOString(), input: 'key-press', key }); await page.keyboard.press(key, { delay: 55 }); };
const focusGame = () => page.locator('#gl').focus();
const chooseVisibleOffer = async () => {
  for (const selector of ['#masterworks[open] [data-boon]', '#masterworks[open] [data-story-choice]']) {
    const node = page.locator(selector).first();
    if (await node.isVisible()) { const text = await node.innerText(); report.actions.push({ input: 'native-earned-choice', text }); await node.click(); await page.waitForTimeout(350); await focusGame(); return true; }
  }
  return false;
};
const waitObservation = async (predicate, label, limit = 10000) => {
  const deadline = Date.now() + limit; let last;
  while (Date.now() < deadline) { last = await sample(label); if (predicate(last)) return last; await page.waitForTimeout(180); }
  return last;
};

try {
  report.build = JSON.parse(await readFile(path.join(root, 'dist/version.json'), 'utf8'));
  if (args['expected-sha']) check(report.build.sha === args['expected-sha'], 'Requested build SHA', report.build);
  server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`; report.origin = origin;
  browser = await chromium.launch(launchOpts({ headless: true,
    env: { ...process.env, FONTCONFIG_FILE: '/tmp/blade-qa-fontconfig/fonts.conf' } })); report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 880, height: 400 }, hasTouch: false, serviceWorkers: 'block' });
  report.viewport = { width: 880, height: 400 };
  await context.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(origin + '/') || /^(data|blob):/.test(u)) return route.continue();
    if (new URL(u).hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    report.externalRequests.push({ url: u, method: route.request().method() }); return route.abort();
  });
  page = await context.newPage();
  const fontDir = args['font-dir'] || '/tmp/blade-qa-fonts/node_modules/@fontsource/noto-sans-kr/files';
  const fonts = await Promise.all([400, 700].map(async weight => ({ family: 'Noto Sans KR', weight,
    data: (await readFile(path.join(fontDir, `noto-sans-kr-korean-${weight}-normal.woff2`))).toString('base64') })));
  fonts.push({ family: 'Black Han Sans', weight: 400, data: (await readFile('/tmp/blade-qa-title-fonts/node_modules/@fontsource/black-han-sans/files/black-han-sans-korean-400-normal.woff2')).toString('base64') });
  await page.addInitScript(fonts => {
    window.__qaFonts = Promise.all(fonts.map(async ({ family, weight, data }) => {
      const f = new FontFace(family, `url(data:font/woff2;base64,${data})`, { weight: String(weight) });
      await f.load(); document.fonts.add(f);
    }));
  }, fonts);
  report.fontFixture = 'QA-only local Noto Sans KR 400/700 and Black Han Sans 400, plus per-browser FONTCONFIG_FILE for generic system-ui fallback; optional external CSS empty. Application and OS fonts unchanged.';
  page.on('pageerror', e => report.errors.push({ type: 'pageerror', text: String(e) }));
  page.on('console', m => { if (m.type() === 'error') report.errors.push({ type: 'console', text: m.text() }); else if (m.type() === 'warning') report.warnings.push(m.text()); });
  page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), resource: r.resourceType(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push({ url: r.url(), status: r.status() }); });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => window.__qaFonts);
  await page.locator('#boot-start:not(.hidden)').waitFor({ state: 'visible', timeout: 180000 });
  await click('#boot-start');
  await page.waitForFunction(() => app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 60000 });
  const lobbyDeadline = Date.now() + 60000;
  while (Date.now() < lobbyDeadline) {
    if (await page.locator('#modal.show #m-cancel').isVisible()) await click('#modal.show #m-cancel');
    if (await page.locator('.citadel-command-campaign').isVisible()) {
      await page.waitForTimeout(700);
      if (!await page.locator('#modal.show').isVisible()) break;
    }
    await page.waitForTimeout(400);
  }
  await page.locator('.citadel-command-campaign').waitFor({ state: 'visible', timeout: 15000 });
  await shot('01-fresh-lobby');
  await click('.citadel-command-campaign');
  await page.locator('#st-go').waitFor({ state: 'visible', timeout: 30000 });
  await shot('01b-native-stage-selection');
  await click('#st-go');
  await page.waitForFunction(() => app.mode === 'battle' && app.battle.active && !app.stageStarting, null, { timeout: 90000 });
  const entered = await sample('native-entry');
  check(entered.stage === '1-1' && !entered.testPause, 'Fresh native first-stage entry uses natural RAF', entered);
  await save();
  if (!entered.player.auto) await click('#btn-auto');
  await focusGame();
  const encounter = await waitObservation(s => s.nearest?.distance <= 5 && s.alive >= 3, 'auto-route', 180000);
  check(encounter.nearest?.distance <= 5 && encounter.alive >= 3, 'AUTO reaches real first crowd', encounter);
  await click('#btn-auto'); await focusGame();
  const manualStart = await sample('manual-start');
  check(!manualStart.player.auto, 'Native AUTO toggle returns manual control', manualStart);
  await save();
  await shot('02-first-crowd-manual');

  // 자연 프레임에서 새 입력 edge를 반복하고 실제 actor 상태를 관측한다.
  const manualSamples = []; let attackObserved = false, skillObserved = false, dodgeObserved = false, moved = false;
  for (let cycle = 0; cycle < 3; cycle++) {
    let s = await sample(`cycle-${cycle}-start`);
    if (!s.active || !s.player || s.player.hp <= 0) break;
    if (s.paused) { await chooseVisibleOffer(); s = await sample(`cycle-${cycle}-choice`); }
    await focusGame();
    for (let i = 0; i < 7; i++) {
      await press('Space');
      const a = await waitObservation(x => x.player?.state === 'attack' || !x.active, `space-${cycle}-${i}`, 1500);
      manualSamples.push(a); attackObserved ||= a.player?.state === 'attack';
      await page.waitForTimeout(330);
      if (!a.active) break;
    }
    s = await sample(`cycle-${cycle}-before-skill`); if (!s.active) break;
    const skillBefore = await waitObservation(x => ['idle', 'move'].includes(x.player?.state) && (x.player?.cds?.[0] || 0) <= 0 || !x.active, `skill-window-${cycle}`, 25000);
    await press('1');
    const skill = await waitObservation(x => x.player?.state === 'skill' || (x.player?.cds?.[0] || 0) > (skillBefore.player?.cds?.[0] || 0) + .2 || !x.active, `skill-${cycle}`, 5000);
    manualSamples.push(skill); skillObserved ||= skill.player?.state === 'skill' || (skill.player?.cds?.[0] || 0) > (skillBefore.player?.cds?.[0] || 0) + .2;
    await page.waitForTimeout(900);
    s = await sample(`cycle-${cycle}-before-dodge`); if (!s.active) break;
    const direction = ['a', 'd', 'w'][cycle];
    report.actions.push({ at: new Date().toISOString(), input: 'key-hold', key: direction, purpose: 'WASD plus dodge' });
    await page.keyboard.down(direction); await press('ShiftLeft');
    const dodge = await waitObservation(x => x.player?.state === 'dodge' || (x.player?.dodgeCd || 0) > (s.player?.dodgeCd || 0) + .1 || !x.active, `dodge-${cycle}`, 5000);
    dodgeObserved ||= dodge.player?.state === 'dodge' || (dodge.player?.dodgeCd || 0) > (s.player?.dodgeCd || 0) + .1;
    await page.waitForTimeout(550); await page.keyboard.up(direction);
    const afterMove = await sample(`movement-${cycle}`);
    moved ||= Math.hypot((afterMove.player?.pos[0] || 0) - s.player.pos[0], (afterMove.player?.pos[2] || 0) - s.player.pos[2]) > .1;
    manualSamples.push(dodge, afterMove); await shot(`03-manual-cycle-${cycle}`); await save();
    if (afterMove.paused) await chooseVisibleOffer();
  }
  check(attackObserved, 'Fresh Space events start manual attack animation', manualSamples.filter(s => s.player?.state === 'attack').map(s => ({ clip: s.player.clip, combo: s.player.comboIdx, trails: s.trailSamples })));
  check(skillObserved, 'Native skill key consumes a real skill cooldown', manualSamples.filter(s => (s.player?.cds?.[0] || 0) > 0).map(s => ({ mp: s.player.mp, cooldown: s.player.cds[0], state: s.player.state })));
  check(dodgeObserved && moved, 'Native WASD and Shift move/dodge actor', { dodgeObserved, moved });
  await focusGame(); report.actions.push({ at: new Date().toISOString(), input: 'key-hold', key: 's', purpose: 'WASD reverse movement' });
  await page.keyboard.down('s'); await page.waitForTimeout(700); await page.keyboard.up('s'); await sample('reverse-movement');
  let beforePause = await sample('before-pause');
  if (beforePause.paused) { await chooseVisibleOffer(); beforePause = await sample('after-earned-choice'); }
  check(beforePause.active && beforePause.player.hp > 0, 'Natural manual segment remains alive', beforePause);
  await click('#btn-pause');
  const paused = await sample('paused-start'); await page.waitForTimeout(1800); const still = await sample('paused-after-wall-wait');
  check(still.paused && still.elapsed === paused.elapsed && !still.held, 'Native pause freezes natural game time and clears attack', { paused, still });
  await shot('04-native-pause'); await click('#btn-resume'); await focusGame();
  const resumed = await waitObservation(s => !s.paused && s.elapsed > still.elapsed, 'resumed', 10000);
  check(!resumed.paused && resumed.elapsed > still.elapsed && !resumed.player.auto, 'Native resume restores natural manual play', resumed);
  await press('Space'); await page.waitForTimeout(800); await shot('05-resumed-attack');
  const end = await sample('manual-end'); report.manualSummary = { from: manualStart, to: end, killDelta: end.kills - manualStart.kills,
    gameSeconds: end.elapsed - manualStart.elapsed, caveat: 'Companion combat remains active; killDelta is the whole natural battle segment.' };
  check(report.samples.every(s => !s.testPause), 'No controlled stepping/testPause during recorded session', {});
  check(report.errors.length === 0 && report.badResponses.length === 0 && report.failedRequests.length === 0, 'No runtime or application network failures', { errors: report.errors, badResponses: report.badResponses, failedRequests: report.failedRequests });
  await click('#btn-pause'); await click('#btn-giveup');
  await page.locator('#btn-result-lobby').waitFor({ state: 'visible', timeout: 30000 }); await shot('06-native-result');
  await click('#btn-result-lobby'); await page.waitForFunction(() => app.mode === 'lobby');
  const lobby = await sample('native-return'); check(!lobby.active && !lobby.player && !lobby.held, 'Native giveup/result returns cleanly to lobby', lobby);
  report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.failure = String(e?.stack || e); if (page) { try { await shot('failure'); } catch {} } }
finally { report.finishedAt = new Date().toISOString(); await save(); await browser?.close(); await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve()); }
console.log(JSON.stringify({ status: report.status, report: path.join(out, 'report.json'), checks: report.checks.length, failure: report.failure }, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
