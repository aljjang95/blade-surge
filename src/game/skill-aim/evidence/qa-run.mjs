import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const report = { scope: '격리 Chromium/CDP 터치, 초기 전투 상태 주입; 물리 기기 검증 아님', rows: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5188/');
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
  await page.evaluate(() => { app.eco.s.tutorial = { completed: true }; app.eco.save(); });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => app.mode !== 'boot');
  await page.evaluate(() => app.ui.closeModal());
  await page.evaluate(async () => { app.testPause = true; await app.startStage(app.eco.nextStage()); });
  await page.waitForFunction(() => !!app.battle.player && app.battle.active, null, { timeout: 60000 });
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const state = () => page.evaluate(() => { const p = app.battle.player, a = app.input; return { aim: a.skillAim, queue: [...a.queue], yaw: p.yaw, mp: p.mp, cds: [...p.cds], joy: a.joy.active, view: p.skillAimView.group.visible, meshes: p.skillAimView.group.children.length, knob: { x: document.querySelector('.skill-btn[data-skill="0"]').style.getPropertyValue('--aim-x'), y: document.querySelector('.skill-btn[data-skill="0"]').style.getPropertyValue('--aim-y'), aiming: document.querySelector('.skill-btn[data-skill="0"]').classList.contains('aiming') }, cancelClasses: document.getElementById('skill-aim-cancel')?.className, pending: [...a.aimedCasts.values()], ctx: p.skillCtx?.sk.id }; });
  for (const [width, height] of [[1280, 590], [844, 390], [800, 360]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const boxes = await page.evaluate(() => {
      const p = app.battle.player; p.auto = false; p.state = 'idle'; p.stun = 0; p.cds.fill(0); p.mp = 100; p.invuln = 100;
      app.battle.paused = false; app.input.enabled = true; app.input.clear();
      // integration 소유 마크업을 수정하지 않고 테스트 문서에 계약 요소만 주입한다.
      let cancel = document.getElementById('skill-aim-cancel');
      if (!cancel) { cancel = document.createElement('div'); cancel.id = 'skill-aim-cancel'; document.body.append(cancel); }
      cancel.style.cssText = 'position:fixed;left:62%;top:12%;width:60px;height:60px;z-index:999;pointer-events:none;border-radius:50%;color:red'; cancel.textContent = 'X';
      for (const b of document.querySelectorAll('.skill-btn')) if (!b.querySelector('.aim-knob')) { const knob = document.createElement('span'); knob.className = 'aim-knob'; b.append(knob); }
      const b = document.querySelector('.skill-btn[data-skill="0"]').getBoundingClientRect();
      const j = document.getElementById('joy').getBoundingClientRect(), c = cancel.getBoundingClientRect();
      return { b: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, j: { x: j.x + j.width / 2, y: j.y + j.height / 2 }, c: { x: c.x + c.width / 2, y: c.y + c.height / 2 }, yaw: app.input.getCameraYaw() };
    });
    const origin = { id: 2, ...boxes.b }, dragged = { id: 2, x: boxes.b.x - 65, y: boxes.b.y - 30 };
    await touch('touchStart', [origin]); await touch('touchMove', [dragged]);
    await page.evaluate(() => { app.step(0, true); });
    const holding = await state();
    if (!holding.aim?.active || !holding.view || !holding.knob.aiming || !holding.knob.x) throw Error('조준 표시 없음 ' + JSON.stringify(holding));
    await page.screenshot({ path: `src/game/skill-aim/evidence/qa-${width}.png` });
    let expectedYaw = Math.atan2(holding.aim.x, holding.aim.z);
    await touch('touchEnd', []);
    const released = await state(); expectedYaw = Math.atan2(released.pending[0].x, released.pending[0].z);
    await page.evaluate(() => app.battle.player.handleInput(app.input, 0));
    const cast = await state(); if (cast.knob.aiming || cast.knob.x || cast.knob.y) throw Error('해제 후 CSS 변수 잔존');
    if (Math.abs(cast.yaw - expectedYaw) > .001 || !cast.ctx) throw Error('시전 방향 불일치 ' + JSON.stringify({holding,released,cast,expectedYaw}));
    await page.evaluate(() => { const p = app.battle.player; p.state = 'idle'; p.skillCtx = null; p.cds.fill(0); p.mp = 100; app.input.clear(); });
    const beforeCancel = await state();
    await touch('touchStart', [origin]); await touch('touchMove', [{ id: 2, ...boxes.c }]);
    const cancelling = await state(); await touch('touchEnd', []); const cancelled = await state();
    if (!cancelling.cancelClasses.includes('hot') || cancelled.cancelClasses.includes('hot') || !cancelling.aim.cancel || cancelled.queue.length || cancelled.mp !== beforeCancel.mp || JSON.stringify(cancelled.cds) !== JSON.stringify(beforeCancel.cds)) throw Error('취소 실패');
    const joy = { id: 1, ...boxes.j }, joyMove = { id: 1, x: boxes.j.x + 30, y: boxes.j.y };
    await touch('touchStart', [joy]); await touch('touchMove', [joyMove]);
    await touch('touchStart', [joyMove, origin]); await touch('touchMove', [joyMove, dragged]);
    const multi = await state();
    if (!multi.joy || !multi.aim.active) throw Error('멀티터치 실패');
    await touch('touchCancel', []);
    await touch('touchStart', [origin]); await touch('touchEnd', []); const tap = await state();
    if (!tap.queue.includes('skill0')) throw Error('탭 실패');
    report.rows.push({ width, height, holding, released, cast, cancelled, multi, tap, expectedYaw, angleError: Math.abs(cast.yaw - expectedYaw), markup: '취소/knob 테스트 DOM 주입' });
  }
  report.pass = true;
} catch (e) { report.pass = false; report.failure = e.message; }
finally { await browser.close(); await writeFile('src/game/skill-aim/evidence/qa-result.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;

