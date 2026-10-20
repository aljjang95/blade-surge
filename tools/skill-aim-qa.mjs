// 드래그 스킬 조준 실제 화면 QA: 실제 마크업·CSS·게임 루프에서 CDP 터치로 끌고 놓아, 화면에서 끈 방향과 시전 뒤 영웅이 바라보는 화면 방향을 비교한다.
// 시작 상태 고정(픽스처): 무적, 쿨다운 0, MP 100, AUTO 끔. 입력은 모두 실제 터치/키 이벤트다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = process.argv[2] || 'http://127.0.0.1:5181';
const out = path.resolve(process.argv[3] || 'work/qa-skill-aim');
const views = (process.argv[4] || '1280x590,844x390,800x360').split(',').map(v => v.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const rows = []; let pass = true;
const deg = r => r * 180 / Math.PI;
const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return deg(d > Math.PI ? 2 * Math.PI - d : d); };
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  await page.evaluate(async () => { app.ui.closeModal?.(); app.eco.s.energy = 100; if (!await app.startStage(app.eco.nextStage())) throw Error('stage start failed'); app.companionAgent?.endBattle?.(); });
  await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const reset = () => page.evaluate(() => { const p = app.battle.player; p.auto = false; p.invuln = 1e6; p.cds.fill(0); p.mp = p.maxMp; p.ult = 0; if (p.state === 'skill' || p.state === 'attack') { p.state = 'idle'; p.skillCtx = null; } app.input.clear(); });
  const geom = () => page.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, left: b.left, top: b.top }; }; return { s0: r('.skill-btn[data-skill="0"]'), s1: r('.skill-btn[data-skill="1"]'), joy: r('#joy'), cancel: r('#skill-aim-cancel') }; });
  // 영웅의 앞 방향을 화면 좌표로 투영한다.
  const heroScreen = () => page.evaluate(() => { const p = app.battle.player, cam = app.renderer.camera; const V = cam.position.constructor; const a = new V(p.pos.x, p.pos.y + .3, p.pos.z), f = p.forward(new V()); const b = a.clone().addScaledVector(f, 3); a.project(cam); b.project(cam); const W = innerWidth, H = innerHeight; return { x: (a.x + 1) / 2 * W, y: (1 - a.y) / 2 * H, dx: (b.x - a.x) / 2 * W, dy: -(b.y - a.y) / 2 * H, yaw: p.yaw, state: p.state, ctx: p.skillCtx?.sk?.id || null, mp: p.mp, cd0: p.cds[p.combatSkillIndex(0)], cd1: p.cds[p.combatSkillIndex(1)] }; });
  const row = { viewport: w + 'x' + h, drags: [], errors };
  try {
    await reset(); let g = await geom();
    // 1) 방향 드래그 4종: 끈 화면 방향과 시전 뒤 영웅의 화면 방향 비교
    const dirs = [[-1, 0], [-.7, -.7], [0, -1], [-.7, .7]];
    for (let i = 0; i < dirs.length; i++) {
      await reset(); await page.waitForTimeout(250); g = await geom();
      const [ux, uy] = dirs[i], o = { id: 7, x: g.s0.x, y: g.s0.y };
      const to = { id: 7, x: Math.max(4, Math.min(w - 4, g.s0.x + ux * 80)), y: Math.max(4, Math.min(h - 4, g.s0.y + uy * 80)) };
      await touch('touchStart', [o]); await touch('touchMove', [{ id: 7, x: (o.x + to.x) / 2, y: (o.y + to.y) / 2 }]); await touch('touchMove', [to]);
      await page.waitForTimeout(220);
      const hold = await page.evaluate(() => ({ aim: app.input.skillAim && { ...app.input.skillAim }, view: app.battle.player.skillAimView.group.visible, aiming: document.querySelector('.skill-btn[data-skill="0"]').classList.contains('aiming'), cancelOn: document.getElementById('skill-aim-cancel').classList.contains('on'), knob: getComputedStyle(document.querySelector('.skill-btn[data-skill="0"] .aim-knob')).opacity }));
      if (i === 1) await page.screenshot({ path: path.join(out, 'aim-hold-' + w + 'x' + h + '.png') });
      const before = await heroScreen();
      await touch('touchEnd', []); await page.waitForTimeout(90);
      const after = await heroScreen();
      const dragAngle = Math.atan2(to.y - o.y, to.x - o.x), heroAngle = Math.atan2(after.dy, after.dx);
      const err = angDiff(dragAngle, heroAngle);
      const ok = hold.aim?.active && hold.view && hold.aiming && hold.cancelOn && +hold.knob > .5 && !!after.ctx && err < 12;
      row.drags.push({ dir: dirs[i], hold, castSkill: after.ctx, mpSpent: before.mp - after.mp, dragDeg: +deg(dragAngle).toFixed(1), heroDeg: +deg(heroAngle).toFixed(1), errDeg: +err.toFixed(1), ok });
      if (!ok) pass = false;
    }
    // 2) 취소 구역에서 놓기
    await reset(); await page.waitForTimeout(250); g = await geom();
    const o = { id: 8, x: g.s0.x, y: g.s0.y };
    const m0 = await heroScreen();
    await touch('touchStart', [o]); await touch('touchMove', [{ id: 8, x: (o.x + g.cancel.x) / 2, y: (o.y + g.cancel.y) / 2 }]); await touch('touchMove', [{ id: 8, x: g.cancel.x, y: g.cancel.y }]);
    await page.waitForTimeout(150);
    const hot = await page.evaluate(() => document.getElementById('skill-aim-cancel').className);
    await page.screenshot({ path: path.join(out, 'aim-cancel-' + w + 'x' + h + '.png') });
    await touch('touchEnd', []); await page.waitForTimeout(120);
    const m1 = await heroScreen();
    row.cancel = { hotClass: hot, after: await page.evaluate(() => document.getElementById('skill-aim-cancel').className), castSkill: m1.ctx, mpBefore: m0.mp, mpAfter: m1.mp, cdBefore: m0.cd0, cdAfter: m1.cd0, ok: hot.includes('hot') && !m1.ctx && m1.mp >= m0.mp && m1.cd0 === 0 };
    if (!row.cancel.ok) pass = false;
    // 3) 짧은 탭은 즉시 시전
    await reset(); await page.waitForTimeout(250);
    await touch('touchStart', [{ id: 9, x: g.s0.x, y: g.s0.y }]); await touch('touchMove', [{ id: 9, x: g.s0.x + 4, y: g.s0.y + 2 }]); await touch('touchEnd', []); await page.waitForTimeout(90);
    const t1 = await heroScreen(); row.tap = { castSkill: t1.ctx, ok: !!t1.ctx }; if (!row.tap.ok) pass = false;
    // 4) 키보드 1
    await reset(); await page.waitForTimeout(250);
    await page.keyboard.press('Digit1'); await page.waitForTimeout(90);
    const k1 = await heroScreen(); row.keyboard = { castSkill: k1.ctx, ok: !!k1.ctx }; if (!row.keyboard.ok) pass = false;
    // 5) 이동 조이스틱과 동시에 조준
    await reset(); await page.waitForTimeout(250); g = await geom();
    const j0 = { id: 1, x: g.joy.x, y: g.joy.y }, j1 = { id: 1, x: g.joy.x + 30, y: g.joy.y - 10 };
    await touch('touchStart', [j0]); await touch('touchMove', [j1]);
    const s0 = { id: 2, x: g.s1.x, y: g.s1.y }, s1 = { id: 2, x: g.s1.x - 80, y: g.s1.y - 20 };
    await touch('touchStart', [j1, s0]); await touch('touchMove', [j1, { id: 2, x: g.s1.x - 40, y: g.s1.y - 10 }]); await touch('touchMove', [j1, s1]);
    await page.waitForTimeout(150);
    const multi = await page.evaluate(() => ({ joy: app.input.joy.active, move: Math.hypot(app.input.screenMove.x, app.input.screenMove.y), aim: !!app.input.skillAim?.active, slot: app.input.skillAim?.slot }));
    // CDP는 한 손가락만 떼는 이벤트를 만들 수 없어 touchEnd 하나로 조이스틱이 먼저, 스킬 손가락이 뒤에 떨어진다.
    const midQ = await page.evaluate(() => ({ q: [...app.input.queue], pending: [...app.input.aimedCasts.keys()], gest: app.input.skillGestures.size, state: app.battle.player.state })); await touch('touchEnd', []); await page.waitForFunction(() => app.battle.player.cds[app.battle.player.combatSkillIndex(1)] > 0 || app.battle.player.skillCtx, null, { timeout: 1500 }).catch(() => {});
    const mc = await heroScreen();
    row.multitouch = { ...multi, midQ, castSkill: mc.ctx, cd1: mc.cd1, ok: multi.joy && multi.move > .2 && multi.aim && multi.slot === 1 && (!!mc.ctx || mc.cd1 > 0) }; if (!row.multitouch.ok) pass = false;
  } catch (e) { row.failure = String(e.message || e); pass = false; }
  if (row.errors.length) pass = false;
  rows.push(row); await ctx.close();
}
await browser.close();
const report = { scope: '로컬 개발 서버, 격리 Chromium 모바일 터치(CDP), 실제 마크업과 게임 루프. 시작 상태(무적·쿨다운·MP·AUTO 끔)만 고정. 실기기 아님.', origin, pass, rows };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass, rows: rows.map(r => ({ v: r.viewport, drags: r.drags.map(d => [d.castSkill, d.errDeg, d.ok]), cancel: r.cancel?.ok, tap: r.tap?.ok, kb: r.keyboard?.ok, multi: r.multitouch?.ok, failure: r.failure, errors: r.errors.slice(0, 2) })) }));
if (!pass) process.exitCode = 1;
