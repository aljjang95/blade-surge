// Local UI and earned-save regression. No real-user storage or production browser access.
import { chromium, firefox, webkit, devices } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { installMetricsDriver } from './metrics-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (key, fallback = '') => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3) ?? fallback;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const acquired = path.resolve(root, arg('save'));
const relative = path.relative(root, acquired).replaceAll('\\', '/');
assert(relative.startsWith('work/natural-progression-') && relative.endsWith('.json'), 'Supply a synthetic acquisition checkpoint under work/natural-progression-*');
const bytes = await fs.readFile(acquired), payload = JSON.parse(bytes);
assert(hash(bytes) === arg('sha256') && payload.syntheticQaOnly && payload.schema === 'bladesurge-synthetic-qa-save/v1', 'Acquired save identity mismatch');
const parentBytes = await fs.readFile(path.join(path.dirname(acquired), 'report.json')), parent = JSON.parse(parentBytes);
assert(parent.runs.flatMap(r => [r.checkpointBefore, r.checkpointAfter]).filter(Boolean).some(c => c.path.replaceAll('\\', '/') === relative && c.sha256 === hash(bytes)), 'Checkpoint has no acquisition receipt');
assert(payload.save.spentKRW === 0 && !payload.save.purchases.length && !payload.save.expedition.pending, 'Expected a settled free-play synthetic save');
// The candidate changes navigation only: preserve the acquired profile's combat/economy rules.
for (const [file, digest] of Object.entries(parent.sources)) {
  if (file.startsWith('work/')) continue;
  assert(hash((await fs.readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n')) === digest, 'Acquisition gameplay source changed: ' + file);
}
const out = path.join(root, 'work/defeat-growth-qa'); await fs.mkdir(out, { recursive: true });
const sourceFiles = ['index.html', 'src/style.css', 'src/ui/ui.js', 'src/ui/meta.js', 'src/ui/growth.js', 'src/game/growth-options.js', 'tools/defeat-growth-qa.mjs'];
const report = { status: 'running', started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Actual Chromium AUTO 4-1 defeat from the acquired free mage profile, fixed 1/60s, seed identical to retained control. Other engines and repeated layout/routing/edge cases use explicitly restored UI fixtures. Viewport/touch emulation and programmatic scrolling are not physical mobile performance or OS-installed PWA certification.',
  acquisition: { path: relative, sha256: hash(bytes), parentSha256: hash(parentBytes), head: payload.head },
  sources: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash((await fs.readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'))]))), engines: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await fs.copyFile(import.meta.filename, path.join(out, 'driver.mjs'));
let server, browser;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  report.build = await (await fetch(url + '/version.json')).json();
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  report.entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  report.entrySha256 = hash(await fs.readFile(path.join(root, 'dist', report.entry)));
  const manifest = await (await fetch(url + '/manifest.webmanifest')).json();
  assert(manifest.display === 'fullscreen' && manifest.display_override.includes('standalone'), 'PWA fullscreen/standalone fallback regressed');
  report.manifest = { display: manifest.display, display_override: manifest.display_override, start_url: manifest.start_url };
  for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
    browser = await launcher.launch();
    const row = { engine, version: browser.version(), errors: [], layouts: [], routes: [], status: 'running' }; report.engines.push(row);
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, hasTouch: true, reducedMotion: 'reduce',
      userAgent: engine === 'webkit' ? devices['iPhone 13'].userAgent : devices['Pixel 7'].userAgent });
    const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => row.errors.push(String(e)));
    await page.addInitScript(save => localStorage.setItem('bladesurge_save_v1', JSON.stringify(save)), payload.save);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.app.testPause = true; window.app.ui.closeModal(); });
    await page.locator('#app-mode-open').tap(); await page.locator('#app-mode-dialog[open]').waitFor();
    row.installGuide = await page.locator('#app-mode-guide').innerText();
    assert(/설치|홈 화면/.test(row.installGuide), 'Install instructions missing');
    await page.locator('#app-mode-close').tap();
    assert(await page.locator('#app-mode-open').evaluate(e => e === document.activeElement), 'Install guide lost focus return');
    const started = await page.evaluate(() => {
      let seed = (Math.imul(20261031, 1) ^ 0x9e3779b9) >>> 0;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      return window.app.startStage(window.app.eco.nextStage());
    });
    assert(started, 'Acquired mage cannot depart');
    await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting);
    assert(!await page.locator('.companion-pause-launcher').isVisible(), 'Neve overlaps active combat');
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    await page.evaluate(() => { window.app.battle.player.auto = true; window.app.testPause = true; });
    if (engine === 'chromium') {
      for (let chunk = 0; chunk < 90; chunk++) {
        row.combat = await page.evaluate(() => {
          const b = window.app.battle;
          for (let i = 0; i < 600 && b.active && b.player.alive; i++) window.__metricsDriver.step(1 / 60, false);
          return { active: b.active, hp: b.player.hp, alive: b.player.alive, elapsed: b.elapsed, kills: b.kills, stage: b.stage.code };
        });
        if (!row.combat.alive || !row.combat.active) break;
      }
      assert(row.combat.stage === '4-1' && row.combat.hp === 0 && row.combat.active, 'Actual control did not reach the expected death');
      await page.evaluate(() => { for (let i = 0; i < 240; i++) window.app.step(1 / 60, false); window.app.step(.001, true); });
      await page.locator('#r-no').waitFor();
      const gems = await page.evaluate(() => window.app.eco.s.gems);
      assert((await page.locator('#r-no').innerText()).includes('정비하기'), 'Death screen hides preparation route');
      await page.screenshot({ path: path.join(out, 'actual-death.png') }); await page.locator('#r-no').tap();
      assert(await page.evaluate(g => window.app.eco.s.gems === g && window.app.battle.result?.win === false, gems), 'Leave death changed gems or outcome');
      row.death = 'Actual AUTO death; native preparation/leave button; zero revive spending';
    } else {
      await page.evaluate(() => window.app.battle.defeat());
      row.death = 'UI fixture: native defeat after departure, no combat balance claim';
    }
    await page.locator('#result.show').waitFor();
    await page.evaluate(() => { window.__growthQaResult = window.app.battle.result; window.__growthQaState = structuredClone(window.app.eco.s); });
    const showFixture = () => page.evaluate(() => {
      const a = window.app; a.ui.closeModal(); a.battle.chronicle.close(); a.eco.s = structuredClone(window.__growthQaState);
      a.mode = 'battle'; a.ui.show(document.querySelector('#meta'), false); a.battle.active = false;
      a.battle.result = window.__growthQaResult; a.ui.hideResult(); a.ui.showResult(a.battle, false);
    });
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(size); await page.waitForTimeout(150);
      if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
      await showFixture(); await page.waitForTimeout(550);
      await page.locator('.result-box').evaluate(e => { e.scrollTop = 0; });
      const pinnedFooter = await page.locator('#btn-result-retry').evaluate(e => {
        const r = e.getBoundingClientRect();
        const points = [[r.x + r.width / 2, r.y + r.height / 2], [r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]];
        return r.top >= 0 && r.bottom <= innerHeight + 1 && points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === e || e.contains(hit); });
      });
      assert(pinnedFooter, engine + ' retry is hidden before scrolling');
      assert(await page.locator('#result-growth .growth-action').count() === 3, 'Earned growth choices missing');
      assert(!await page.locator('#result .exp-row').first().isVisible() && !await page.locator('#result-loot').isVisible(), 'Defeat shows victory rewards');
      const controls = [];
      for (const selector of ['[data-growth="equipment"]', '[data-growth="skill"]', '[data-growth="mastery"]', '#btn-result-lobby', '#btn-result-retry']) {
        const button = page.locator(selector); await button.scrollIntoViewIfNeeded();
        const geometry = await button.evaluate(e => {
          const r = e.getBoundingClientRect();
          const points = [[r.x + r.width / 2, r.y + r.height / 2], [r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]];
          return { width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            hit: points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === e || e.contains(hit); }), hitSamples: points.length, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert(geometry.inside && geometry.hit && geometry.height >= 44 && !geometry.overflow, engine + ' unreachable ' + selector + ': ' + JSON.stringify(geometry));
        controls.push({ selector, ...geometry });
      }
      row.layouts.push({ viewport: size, controls, pinnedFooter, scrolling: 'scrollIntoViewIfNeeded; native touch scrolling not certified' });
      await page.locator('#result-growth').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, engine + '-' + size.width + 'x' + size.height + '.png') }); await save();
    }
    // Real UI destinations and keyboard activation; the result is explicitly replayed between cases.
    for (const kind of ['equipment', 'skill', 'mastery']) {
      await page.setViewportSize({ width: 320, height: 568 }); await showFixture(); await page.waitForTimeout(550);
      const before = await page.evaluate(() => JSON.stringify(window.app.eco.s));
      const button = page.locator('[data-growth="' + kind + '"]'); await button.focus(); await page.keyboard.press('Enter');
      const close = page.locator(kind === 'equipment' ? '#e-close' : kind === 'skill' ? '#m-cancel' : '#masterworks .mw-close');
      await close.waitFor();
      assert(await page.evaluate(() => window.app.mode === 'lobby' && !window.app.battle.active), 'Preparation kept combat active');
      assert(await page.evaluate(s => JSON.stringify(window.app.eco.s) === s, before), 'Opening ' + kind + ' changed save/resources');
      assert(await close.evaluate(e => e === document.activeElement), 'Destination did not focus its close control');
      await close.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, engine + '-' + kind + '.png') });
      await page.keyboard.press('Enter');
      assert(!await close.isVisible(), 'Keyboard cannot close ' + kind);
      row.routes.push({ kind, activated: 'keyboard Enter', navigationSpent: 0, close: 'keyboard Enter' });
    }
    if (engine === 'chromium') {
      await showFixture(); await page.waitForTimeout(550);
      await page.evaluate(() => { window.app.eco.s.gold = 0; window.app.eco.s.masterworks.renown = 0; });
      await page.locator('[data-growth="equipment"]').tap();
      assert(await page.locator('#result-growth .growth-action').count() === 0, 'Stale resource quote was actionable');
      assert(await page.locator('#btn-result-lobby').evaluate(e => e === document.activeElement), 'Empty preparation has no focus fallback');
      row.staleResources = 'Current resources rechecked; no destination opened; fallback remains reachable';
      await showFixture(); await page.waitForTimeout(550);
      await page.evaluate(() => { window.app.eco.s.selected = 'knight'; });
      await page.locator('[data-growth="equipment"]').tap();
      assert(await page.locator('#result.show').isVisible() && !await page.locator('#modal.show').isVisible(), 'Stale hero opened former equipment');
      row.staleHero = 'Former hero equipment did not open after selection changed';
      await showFixture(); await page.locator('#btn-result-lobby').tap();
      const wonStart = await page.evaluate(() => { const a = window.app; a.meta.chapter = 1; a.meta.stage = null; a.meta.renderStages(); return a.startStage(a.meta.stage); });
      assert(wonStart, 'Earned hero cannot retry a completed stage');
      await page.evaluate(() => { window.app.battle.player.auto = true; window.app.testPause = true; });
      for (let chunk = 0; chunk < 90; chunk++) {
        const active = await page.evaluate(() => { for (let i = 0; i < 600 && window.app.battle.active; i++) window.__metricsDriver.step(1 / 60, false); return window.app.battle.active; });
        if (!active) break;
      }
      await page.evaluate(() => { for (let i = 0; i < 240; i++) window.app.step(1 / 60, false); });
      await page.waitForFunction(() => window.app.battle.result?.win === true && window.app.battle.result?.reward);
      await page.waitForFunction(() => document.querySelector('#result-exp-txt').textContent.startsWith('Lv.'));
      assert(!await page.locator('#result-growth').isVisible() && await page.locator('#result .exp-row').first().isVisible(), 'Victory did not restore reward presentation');
      row.victory = await page.evaluate(() => ({ stage: window.app.battle.stage.code, win: window.app.battle.result.win, reward: window.app.battle.result.reward, experience: document.querySelector('#result-exp-txt').textContent }));
      await page.screenshot({ path: path.join(out, 'actual-victory.png') });
    }
    assert(!row.errors.length, engine + ' page errors: ' + row.errors.join('; ')); row.status = 'pass'; await save();
    await browser.close(); browser = null;
  }
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve());
  report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure }));
}
