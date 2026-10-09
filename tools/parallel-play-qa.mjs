// 자연 프레임 루프와 실제 브라우저 입력으로 세 격리 플레이를 병행한다.
// 실기기 성능·발열·오디오·미디어 승인과 독립 리뷰를 대신하지 않는다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeGameplayFocus } from './expedition-qa-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const assert = (value, message) => { if (!value) throw Error(message); };
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = argument('expected-sha'), output = argument('out'), origin = argument('origin');
const profile = argument('profile'), angle = argument('angle') || 'default';
assert(/^[0-9a-f]{40}$/.test(expected || ''), 'Required --expected-sha=<full committed SHA>');
assert(output && path.isAbsolute(output), 'Required --out=<new absolute directory>, with an existing parent');
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || ''), 'Required --origin=http://127.0.0.1:<production-preview-port>');
assert(['default', 'd3d11'].includes(angle), 'Supported --angle=default|d3d11');
assert(!profile || ['manual', 'touch', 'growth'].includes(profile), 'Supported --profile=manual|touch|growth');
const out = path.resolve(output);
await fs.mkdir(out);
const report = { head: expected, started: new Date().toISOString(), origin, angle, status: 'running', releaseApproved: false,
  scope: 'Concurrent isolated Chromium contexts; native inputs and natural clock. No actor/save/clock override. Functional QA only; no physical phone, FPS, audio/media acceptance or independent review.',
  artifacts: {}, profiles: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
async function guard() {
  assert(git(['rev-parse', 'HEAD']) === expected && !git(['status', '--porcelain']), 'Freeze the exact clean committed checkout before and throughout QA');
  for (const file of ['dist/version.json', 'dist/index.html', 'src/ui/ui.js', 'src/engine/input.js', 'tools/parallel-play-qa.mjs', 'tools/expedition-qa-runtime.mjs']) {
    const digest = hash(await fs.readFile(path.join(root, file)));
    if (report.artifacts[file]) assert(report.artifacts[file] === digest, `Artifact changed during play: ${file}`);
    report.artifacts[file] = digest;
  }
  const local = JSON.parse(await fs.readFile(path.join(root, 'dist/version.json'), 'utf8'));
  assert(local.sha === expected && local.dirty === false, 'Build the exact clean commit before QA');
  const response = await fetch(`${origin}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok, 'Production version unavailable');
  const served = await response.json();
  assert(served.sha === expected && served.dirty === false && served.builtAt === local.builtAt && served.pwaRelease === local.pwaRelease, 'Served build differs from local candidate');
  const index = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(index.ok && hash(Buffer.from(await index.text())) === report.artifacts['dist/index.html'], 'Served production index differs from local build');
  report.build = served;
}

let browser;
try {
  await guard();
  await fs.writeFile(path.join(out, 'driver.mjs'), await fs.readFile(fileURLToPath(import.meta.url)), { flag: 'wx' });
  browser = await chromium.launch({ args: ['--enable-gpu', '--autoplay-policy=no-user-gesture-required', ...(angle === 'd3d11' ? ['--use-angle=d3d11'] : [])] });
  const profiles = [{ id: 'manual', viewport: { width: 1280, height: 720 } },
    { id: 'touch', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    { id: 'growth', viewport: { width: 1280, height: 720 } }].filter(p => !profile || p.id === profile);
  const runs = await Promise.allSettled(profiles.map(async ({ id, ...options }) => {
    const context = await browser.newContext(options), page = await context.newPage();
    page.setDefaultTimeout(30000);
    const row = { id, status: 'running', steps: [], errors: [], httpErrors: [], requestFailures: [] };
    report.profiles.push(row);
    page.on('pageerror', error => row.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') row.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) row.httpErrors.push({ url: response.url(), status: response.status() }); });
    // 실패 원문은 남긴다. 이 기능 검사는 미디어 취소의 유효성 판정을 하지 않는다.
    page.on('requestfailed', request => row.requestFailures.push({ url: request.url(), type: request.resourceType(), error: request.failure()?.errorText }));
    const state = () => page.evaluate(() => {
      const a = window.app, b = a.battle, p = b?.player;
      return { mode: a.mode, energy: a.eco.s.energy, gold: a.eco.s.gold, selected: a.eco.s.selected,
        level: a.eco.hero().level, inventory: a.eco.s.inventory.length, auto: a.journey.s.autoBattle,
        input: { enabled: a.input.enabled, held: a.input.attackHeld, queue: [...a.input.queue], move: { ...a.input.move }, joy: a.input.joy.active },
        active: b?.active, paused: b?.paused, elapsed: b?.elapsed, kills: b?.kills,
        player: p ? { state: p.state, combo: p.comboIdx, hp: p.hp, x: p.pos.x, z: p.pos.z } : null,
        result: b?.result ? { win: b.result.win } : null, pending: a.expedition.s.pending, history: a.eco.s.masterworks.history.length };
    });
    const tap = async selector => {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector;
      if (options.hasTouch) await locator.tap(); else await locator.click();
    };
    const shot = async label => {
      const file = `${id}-${label}.png`;
      await page.screenshot({ path: path.join(out, file) });
      row.lastScreenshot = file;
    };
    const step = async (name, action) => {
      const item = { name, started: new Date().toISOString(), before: await state() }; row.steps.push(item);
      try { await action(item); item.after = await state(); item.status = 'passed'; }
      catch (error) { item.status = 'failed'; item.error = String(error); throw error; }
      finally { console.log(JSON.stringify({ id, name, status: item.status, error: item.error })); await save(); }
    };
    async function boot(reload = false) {
      if (reload) await page.reload(); else await page.goto(origin);
      if (await page.locator('#btn-ignore-rotate').isVisible()) await tap('#btn-ignore-rotate');
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await tap('#boot-start');
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
      if (await page.locator('#modal.show #m-cancel').isVisible()) await tap('#modal.show #m-cancel');
    }
    try {
      await boot();
      row.renderer = await page.evaluate(() => {
        const gl = document.querySelector('#gl').getContext('webgl2'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return { webgl2: !!gl, vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
      });
      assert(row.renderer.webgl2, 'WebGL2 unavailable');
      await step('native-standard-admission', async item => {
        await tap('#btn-expedition'); await tap('.adventure-nav [data-section="dungeons"]');
        await tap(page.locator('.exp-route-tabs').getByRole('button', { name: '기본 원정', exact: true }));
        await tap('.exp-dungeon-details > summary');
        await tap(page.locator('[data-dungeon="glass_garden"][data-depth="standard"]').getByRole('button', { name: '던전 입장', exact: true }));
        await page.waitForFunction(() => app.battle?.active && !app.stageStarting && !document.querySelector('.exp-cinematic'), undefined, { timeout: 120000 });
        if (await page.locator('#tutorial-skip').isVisible()) await tap('#tutorial-skip');
        assert((await state()).energy === item.before.energy - 4, 'Admission must charge energy exactly once'); await shot('battle');
      });
      if (id === 'manual') {
        await step('keyboard-move-release', async item => {
          item.focus = await nativeGameplayFocus(page); await page.keyboard.down('KeyD');
          try { await page.waitForFunction(({ x, z }) => Math.hypot(app.battle.player.pos.x - x, app.battle.player.pos.z - z) > .05, item.before.player); }
          finally { await page.keyboard.up('KeyD'); }
          await page.waitForFunction(() => app.input.move.x === 0 && app.input.move.y === 0);
        });
        await step('manual-combo-pause-resume', async item => {
          await nativeGameplayFocus(page); await page.keyboard.down('Space');
          try { await page.waitForFunction(() => app.battle.player.state === 'attack'); item.held = await state(); }
          finally { await page.keyboard.up('Space'); }
          await tap('#btn-pause'); const paused = await state();
          assert(paused.paused && !paused.input.enabled && !paused.input.held && !paused.input.queue.length, 'Pause must clear combat input');
          await tap('#btn-resume'); assert(!(await state()).paused, 'Resume failed'); await shot('resume');
        });
        await step('pointer-auto-off-keyboard-without-refocus', async item => {
          await tap('#btn-auto'); await tap('#btn-auto'); assert(!(await state()).auto, 'AUTO must be off');
          item.focus = await page.evaluate(() => ({ id: document.activeElement?.id, blocked: !!document.activeElement?.closest('button,input,textarea,select') }));
          const before = await state(); await page.keyboard.down('KeyD');
          try {
            await page.waitForFunction(() => !!app.input.keys.KeyD, undefined, { timeout: 1500 });
            await page.waitForFunction(({ x, z }) => Math.hypot(app.battle.player.pos.x - x, app.battle.player.pos.z - z) > .05, before.player);
          } finally { await page.keyboard.up('KeyD'); }
          await page.waitForFunction(() => app.input.move.x === 0 && app.input.move.y === 0); await shot('auto-off-move');
        });
        await step('keyboard-auto-keeps-ui-focus', async item => {
          await page.keyboard.press('Tab');
          for (let count = 0; count < 40 && !(await page.locator('#btn-auto').evaluate(el => el === document.activeElement)); count++) await page.keyboard.press('Tab');
          assert(await page.locator('#btn-auto').evaluate(el => el === document.activeElement), 'Native Tab did not reach AUTO');
          await page.keyboard.press('Enter'); assert((await state()).auto, 'Keyboard AUTO activation failed');
          assert(await page.locator('#btn-auto').evaluate(el => el === document.activeElement), 'Keyboard AUTO focus was stolen');
          await page.keyboard.down('KeyD');
          try { item.keysBlocked = await page.evaluate(() => !app.input.keys.KeyD); assert(item.keysBlocked, 'Focused UI key leaked into combat'); }
          finally { await page.keyboard.up('KeyD'); }
          await page.keyboard.press('Enter'); assert(!(await state()).auto, 'Keyboard AUTO deactivation failed');
        });
      } else if (id === 'touch') {
        await step('native-multitouch-cancel', async item => {
          const cdp = await context.newCDPSession(page);
          const center = async selector => { const b = await page.locator(selector).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
          const joy = await center('#joy .joy-base'), attack = await center('#btn-attack');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...joy, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: joy.x + 30, y: joy.y, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: joy.x + 30, y: joy.y, id: 1 }, { ...attack, id: 2 }] });
          await page.waitForFunction(() => app.input.joy.active && app.input.attackHeld); item.held = await state();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
          await page.waitForFunction(() => !app.input.joy.active && !app.input.attackHeld && app.input.move.x === 0 && app.input.move.y === 0);
        });
        await step('portrait-landscape-layout', async () => {
          await page.setViewportSize({ width: 390, height: 844 });
          if (await page.locator('#btn-ignore-rotate').isVisible()) await tap('#btn-ignore-rotate');
          await shot('portrait'); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Portrait overflow');
          await page.setViewportSize({ width: 844, height: 390 }); await tap('#btn-attack'); await shot('landscape');
        });
      } else {
        await step('natural-auto-victory-growth-settlement', async item => {
          await tap('#btn-auto'); assert((await state()).auto, 'AUTO preference not persisted'); const started = Date.now();
          while (Date.now() - started < 300000) {
            if (await page.locator('.exp-result-shell').isVisible()) break;
            const choice = page.locator('#masterworks[open] .mw-choices button:not([disabled]),#masterworks[open] .mw-story-choices button:not([disabled])').first();
            if (await choice.isVisible()) await tap(choice);
            if (await page.locator('#tutorial-skip').isVisible()) await tap('#tutorial-skip');
            if (await page.locator('#modal.show #r-no').isVisible()) await tap('#r-no');
            await page.waitForTimeout(1500);
          }
          assert(await page.locator('.exp-result-shell').isVisible(), 'Natural run did not show its result within 300 seconds');
          const result = await state(); item.result = result;
          assert(result.result?.win && !result.active, 'Natural AUTO run did not win');
          assert(!result.pending, 'Visible result retained its admission ticket');
          assert(result.history === item.before.history + 1, 'Settlement must record one run');
          assert(result.inventory > item.before.inventory && result.gold > item.before.gold, 'Victory must preserve real loot and award gold');
          await shot('result');
        });
      }
      await step('result-return-save-reload', async item => {
        if ((await state()).active) { await tap('#btn-pause'); await tap('#btn-giveup'); }
        await page.locator('.exp-result-shell').waitFor({ timeout: 60000 }); await tap('.exp-result-shell .exp-close');
        await page.waitForFunction(() => app.mode === 'lobby'); const before = await state(); item.saved = before;
        assert(!before.pending, 'Return retained an admission ticket'); await boot(true); const after = await state();
        for (const key of ['gold', 'level', 'inventory', 'selected', 'history', 'auto']) assert(after[key] === before[key], `Reload changed ${key}`);
        assert(!after.pending, 'Reload resurrected an admission ticket'); await shot('reloaded');
      });
      row.status = 'functional-pass';
    } catch (error) {
      row.status = 'failed'; row.failure = String(error.stack || error);
      try { row.lastState = await state(); await shot('failure'); row.visibleText = await page.locator('body').innerText(); } catch {}
    } finally {
      await context.close(); row.finished = new Date().toISOString();
      if (row.errors.length || row.httpErrors.length) row.status = 'failed'; await save();
    }
  }));
  for (const result of runs) if (result.status === 'rejected') throw result.reason;
  await guard(); assert(report.profiles.every(row => row.status === 'functional-pass'), 'At least one functional play profile failed');
  report.status = 'functional-pass';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally { await browser?.close(); report.finished = new Date().toISOString(); await save(); }
console.log(JSON.stringify({ status: report.status, profiles: report.profiles.map(({ id, status, failure }) => ({ id, status, failure })), out }, null, 2));
