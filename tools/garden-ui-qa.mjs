// 같은 시작 조건과 실제 입력을 반복하는 거점 UI 검증이다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.resolve(process.argv[2]), origin = process.argv[4] || 'http://127.0.0.1:4173';
await fs.mkdir(out);
const assert = (v, m) => { if (!v) throw Error(m); };
const report = { started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  fixture: 'Independent Chromium process per profile; fresh storage, normal RAF and randomness. Explicit native explore entry for current selection-first contract. Short joystick: release as soon as displacement >0.1, without minimum hold or added delay, then immediate menu tap; repeat five times. Native input only, no injected save/actor/route/time. Browser viewport QA, not physical Android or performance proof.', profiles: [], sources: {} };
for (const file of ['src/ui/garden-ui.css', 'src/ui/oath-shell.js', 'src/main.js', 'src/engine/hub-controls.js', 'tools/garden-ui-qa.mjs', 'dist/index.html']) report.sources[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
assert(!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), 'Freeze a clean source before QA');
report.build = await (await fetch(`${origin}/version.json`)).json();
assert(report.build.sha === report.head && !report.build.dirty, 'Final UI QA requires the exact clean committed build');
let browser;
try {
  for (const spec of [{ id: 'desktop', viewport: { width: 1280, height: 720 } }, { id: 'landscape', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, { id: 'portrait', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }].filter(s => !process.argv[3] || s.id === process.argv[3])) {
    browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
    const { id, ...options } = spec, context = await browser.newContext(options), page = await context.newPage();
    await page.bringToFront();
    const row = { id, viewport: options.viewport, errors: [], httpErrors: [], steps: [], status: 'running' }; report.profiles.push(row);
    page.on('pageerror', e => row.errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') row.errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) row.httpErrors.push({ status: r.status(), url: r.url() }); });
    const tap = selector => options.hasTouch ? page.locator(selector).tap() : page.locator(selector).click();
    const shot = name => page.screenshot({ path: path.join(out, `${id}-${name}.png`) });
    try {
      await page.goto(origin);
      if (await page.locator('#btn-ignore-rotate').isVisible()) await tap('#btn-ignore-rotate');
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await tap('#boot-start');
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
      if (await page.locator('#modal.show #m-cancel').isVisible()) await tap('#modal.show #m-cancel');
      await page.waitForFunction(() => app.showcase && app.commandUI.visible);
      await shot('selection');
      row.selectionLayout = await page.evaluate(() => { const p = document.querySelector('#citadel-command').getBoundingClientRect(), n = document.querySelector('#meta .bottomnav').getBoundingClientRect(); return { panelBottom:p.bottom, navTop:n.top, cards:document.querySelectorAll('[data-command-route]').length }; });
      assert(row.selectionLayout.cards === 12 && row.selectionLayout.panelBottom <= row.selectionLayout.navTop, 'Selection cards or dock overlap');
      await tap('#citadel-explore'); await page.waitForFunction(() => app.canWalkHub());
      await page.waitForTimeout(1200);
      row.layout = await page.evaluate(() => {
        const selectors = ['#meta .bottomnav', '#meta .profile', '#meta .currencies', '.citadel-hub-place', '.citadel-hub-near', '.lobby-camera-tools', '.companion-launcher', ...(matchMedia('(any-pointer:coarse)').matches ? ['.citadel-hub-stick', '#lobby-camera-pad'] : [])];
        const boxes = Object.fromEntries(selectors.map(s => { const el = document.querySelector(s), b = el.getBoundingClientRect(); return [s, { x: b.x, y: b.y, w: b.width, h: b.height }]; }));
        const buttons = [...document.querySelectorAll('#meta .bottomnav button')].map(el => { const b = el.getBoundingClientRect(); return { text: el.textContent.trim(), w: b.width, h: b.height, hit: el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) }; });
        return { boxes, buttons, overflow: document.documentElement.scrollWidth > innerWidth, viewport: { width: innerWidth, height: innerHeight } };
      });
      for (const [name, b] of Object.entries(row.layout.boxes)) assert(b.x >= -1 && b.y >= -1 && b.x + b.w <= row.layout.viewport.width + 1 && b.y + b.h <= row.layout.viewport.height + 1, `${name} outside viewport`);
      for (const b of row.layout.buttons) assert(b.w >= 44 && b.h >= 44 && b.hit, `${b.text} touch target or hit failed`);
      assert(!row.layout.overflow, 'Horizontal overflow');
      const a = row.layout.boxes['#meta .bottomnav'], b = row.layout.boxes['.citadel-hub-near'];
      assert(a.y >= b.y + b.h || b.x >= a.x + a.w || a.x >= b.x + b.w, 'Navigation overlaps gate invitation');
      await shot('hub'); row.steps.push('viewport, native hit targets and invitation/nav separation');
      const before = await page.evaluate(() => ({ ...app.hubMovement.position }));
      if (!options.hasTouch) {
        // 로비는 캔버스 위의 기존 tab-home이 실제 입력 표면이다.
        await page.mouse.click(options.viewport.width * .5, options.viewport.height * .4); await page.keyboard.down('KeyD');
        try { await page.waitForFunction(p => Math.hypot(app.hubMovement.position.x - p.x, app.hubMovement.position.z - p.z) > .1, before); }
        finally { await page.keyboard.up('KeyD'); }
      } else {
        const cdp = await context.newCDPSession(page), box = await page.locator('.citadel-hub-stick').boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 25, y, id: 1 }] });
        try { await page.waitForFunction(p => Math.hypot(app.hubMovement.position.x - p.x, app.hubMovement.position.z - p.z) > .1, before); }
        finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      }
      await page.waitForFunction(() => !app.hubControls.pointer && app.hubControls.move.x === 0 && app.hubControls.move.y === 0);
      row.movement = { before, after: await page.evaluate(() => ({ ...app.hubMovement.position })) }; row.steps.push('actual hub movement and release');
      row.menuBefore = await page.evaluate(() => ({ mode: app.mode, starting: app.stageStarting, walk: app.canWalkHub(), focus: document.hasFocus(), active: document.activeElement?.className, pointer: app.hubControls.pointer, move: { ...app.hubControls.move }, visual: { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } }));
      await page.evaluate(() => { window.menuObserved = []; for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) document.addEventListener(type, e => window.menuObserved.push({ type, target: e.target.className, prevented: e.defaultPrevented }), { capture: false }); });
      await tap('.oath-nav-menu'); await page.locator('#oath-menu[open]').waitFor(); await shot('menu'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#oath-menu').open); row.steps.push('menu open and native Escape');
      row.shortTouchRepeats = [];
      if (options.hasTouch) for (let i = 0; i < 4; i++) {
        await tap('#citadel-explore'); await page.waitForFunction(() => app.canWalkHub());
        const cdp = await context.newCDPSession(page), box = await page.locator('.citadel-hub-stick').boundingBox(), x=box.x+box.width/2, y=box.y+box.height/2;
        const p=await page.evaluate(()=>({...app.hubMovement.position}));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+25,y,id:1}]});
        try {await page.waitForFunction(p=>Math.hypot(app.hubMovement.position.x-p.x,app.hubMovement.position.z-p.z)>.1,p);}
        finally {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
        await page.waitForFunction(()=>!app.hubControls.pointer && app.hubControls.move.x===0 && app.hubControls.move.y===0);
        await tap('.oath-nav-menu'); await page.locator('#oath-menu[open]').waitFor();
        row.shortTouchRepeats.push({iteration:i+2,opened:true}); await page.keyboard.press('Escape'); await cdp.detach();
      }
      await tap('.oath-nav-growth'); await page.locator('#masterworks[open]').waitFor(); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#masterworks').open); row.steps.push('growth opens and closes');
      await tap('#meta .bottomnav [data-tab="heroes"]'); await page.waitForFunction(() => app.meta.tab === 'heroes');
      row.heroLayout = await page.evaluate(() => { const panel = document.querySelector('#tab-heroes').getBoundingClientRect(), nav = document.querySelector('#meta .bottomnav').getBoundingClientRect(); return { panelBottom: panel.bottom, navTop: nav.top }; });
      assert(row.heroLayout.panelBottom <= row.heroLayout.navTop, 'Hero content overlaps dock'); await shot('heroes');
      await tap('#meta .bottomnav [data-tab="home"]'); await page.waitForFunction(() => app.commandUI.visible); row.steps.push('hero menu and return');
      await tap('#btn-expedition'); await page.waitForFunction(() => app.meta.tab === 'stage');
      await shot('adventure');
      await tap('#meta .bottomnav [data-tab="home"]'); await page.waitForFunction(() => app.commandUI.visible); row.steps.push('adventure menu and return');
      await tap('#citadel-explore'); await page.waitForFunction(() => app.canWalkHub());
      await tap('#lobby-camera-toggle'); assert(await page.locator('#lobby-camera-panel').isVisible(), 'Camera panel inaccessible'); await tap('#lobby-camera-toggle'); row.steps.push('camera settings remain accessible');
      row.gateWalk = [];
      for (const target of [{ x: 0, z: -8 }, { x: -9, z: -8 }, { x: -9, z: -9.5 }]) {
        let arrived = false;
        for (let pulse = 0; pulse < 65; pulse++) {
          const state = await page.evaluate(() => ({ ...app.hubMovement.position, yaw: Math.atan2(-app.renderer.camera.matrixWorld.elements[2], app.renderer.camera.matrixWorld.elements[0]) }));
          const dx = target.x - state.x, dz = target.z - state.z, remaining = Math.hypot(dx, dz);
          if (remaining < .45) { arrived = true; break; }
          const c = Math.cos(state.yaw), s = Math.sin(state.yaw), vx = dx * c - dz * s, vy = dx * s + dz * c, norm = Math.hypot(vx, vy);
          const duration = Math.max(100, Math.min(350, remaining / 4.2 * 800));
          if (options.hasTouch) {
            const cdp = await context.newCDPSession(page), box = await page.locator('.citadel-hub-stick').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + vx / norm * box.width * .4, y: y + vy / norm * box.height * .4, id: 1 }] });
            await page.waitForTimeout(duration); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
          } else {
            await page.mouse.click(options.viewport.width * .5, options.viewport.height * .4);
            const keys = [...(Math.abs(vx) > norm * .3 ? [vx > 0 ? 'KeyD' : 'KeyA'] : []), ...(Math.abs(vy) > norm * .3 ? [vy > 0 ? 'KeyS' : 'KeyW'] : [])];
            for (const key of keys) await page.keyboard.down(key);
            await page.waitForTimeout(duration); for (const key of keys) await page.keyboard.up(key);
          }
          await page.waitForFunction(() => !app.hubControls.pointer && app.hubControls.move.x === 0 && app.hubControls.move.y === 0);
          row.gateWalk.push({ target, before: state, after: await page.evaluate(() => ({ ...app.hubMovement.position })) });
        }
        assert(arrived, 'Finite native gate approach stalled');
      }
      await page.waitForFunction(() => app.hubMovement.nearest?.id === 'dungeon:glass_garden');
      const gateBefore = await page.evaluate(() => ({ energy: app.eco.s.energy, gold: app.eco.s.gold, pending: app.expedition.s.pending }));
      await tap('.citadel-hub-interact'); await page.locator('.citadel-hub-dialog[open]').waitFor(); await shot('preparation');
      row.preparation = await page.evaluate(() => ({ title: document.querySelector('#citadel-destination-title').textContent, goDisabled: document.querySelector('.citadel-hub-go').disabled, cost: document.querySelector('[data-citadel-cost]').textContent }));
      assert(!row.preparation.goDisabled, 'Standard departure disabled unexpectedly');
      await tap('.citadel-hub-cancel'); await page.waitForFunction(() => app.canWalkHub());
      const gateAfter = await page.evaluate(() => ({ energy: app.eco.s.energy, gold: app.eco.s.gold, pending: app.expedition.s.pending }));
      assert(JSON.stringify(gateBefore) === JSON.stringify(gateAfter), 'Gate preview/cancel spent resources'); row.steps.push('native walk to glass gate, preparation and resource-preserving cancel');
      if (id === 'portrait') {
        await page.setViewportSize({ width: 320, height: 740 }); await page.waitForTimeout(600); await shot('320');
        row.smallOverflow = await page.evaluate(() => { const b = document.querySelector('#meta .currencies').getBoundingClientRect(); return document.documentElement.scrollWidth > innerWidth || b.x < 0 || b.right > innerWidth; });
        assert(!row.smallOverflow, '320px currency clipping');
      }
      assert(!row.errors.length && !row.httpErrors.length, 'Runtime or HTTP errors'); row.status = 'passed';
    } catch (e) { row.status = 'failed'; row.failure = String(e); row.menuObserved = await page.evaluate(() => window.menuObserved || []); await shot('failure'); }
    console.log(JSON.stringify({ id, status: row.status, failure: row.failure, steps: row.steps }));
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close();
  }
} finally { if (browser?.isConnected()) await browser.close(); }
report.status = report.profiles.every(p => p.status === 'passed') ? 'passed' : 'failed';
for (const [file, digest] of Object.entries(report.sources)) assert(createHash('sha256').update(await fs.readFile(file)).digest('hex') === digest, 'Source changed during UI QA');
assert(execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim() === report.head && !execFileSync('git', ['status','--porcelain'], { encoding:'utf8' }).trim(), 'Source identity changed during UI QA');
const served = await (await fetch(`${origin}/version.json`)).json(); assert(JSON.stringify(served)===JSON.stringify(report.build), 'Served version changed during QA');
report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
