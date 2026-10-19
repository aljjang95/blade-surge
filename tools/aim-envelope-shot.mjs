// 조준 중 확정 영역(실선·채움)과 바깥 한계(호박색 점선: 확률 띠·몰이 한계)가 화면에서 구분돼 그려지는지 실제 화면으로 찍는다.
// 실제 CDP 터치로 스킬 버튼을 끌어 조준 표시를 띄우고, aim-view의 envelope 메시 상태와 화면 캡처를 남긴다.
// 사용: node tools/aim-envelope-shot.mjs <origin> [출력폴더] [뷰포트목록]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = (process.argv[2] || 'http://127.0.0.1:5197').replace(/\/$/, '');
const out = path.resolve(process.argv[3] || 'work/cycles/20261019-aim-envelope-ui/qa-envelope-shot');
const views = (process.argv[4] || '1280x590,844x390,800x360').split(',').map(v => v.split('x').map(Number));
const CASES = [['mage', 'meteor'], ['barbarian', 'magma_zone'], ['knight', 'shield_bash'], ['barbarian', 'quake'], ['barbarian', 'hell_axe'], ['barbarian', 'whirlwind']];
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const rows = []; let pass = true;
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  let current = null;
  for (const [hero, skill] of CASES) {
    const row = { viewport: w + 'x' + h, hero, skill, errors };
    try {
      if (current !== hero) {
        if (current) { await page.evaluate(() => app.toLobby?.()); await page.waitForTimeout(500); }
        await page.evaluate(async hero => { app.ui.closeModal?.(); app.eco.s.energy = 100; app.eco.s.selected = hero; if (!await app.startStage(app.eco.nextStage())) throw Error('stage'); app.companionAgent?.endBattle?.(); }, hero);
        await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 60000 });
        await page.waitForTimeout(1200); current = hero;
      }
      const slot = await page.evaluate(skill => { const p = app.battle.player; p.auto = false; p.invuln = 1e6; p.heroLevel = 60; p.cds.fill(0); p.mp = p.maxMp; p.ult = p.ultMax; app.input.clear(); for (let s = 0; s < 6; s++) if (p.def.skills[p.combatSkillIndex(s)]?.id === skill) return s; return -1; }, skill);
      if (slot < 0) { row.failure = '스킬이 슬롯에 없다'; pass = false; rows.push(row); continue; }
      const c = await page.evaluate(slot => { const b = document.querySelector('.skill-btn[data-skill="' + slot + '"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, slot);
      // 짧게 끌어(버튼 반지름의 절반 정도) 조준 지점이 영웅 가까이에 오게 한다: 확정 원과 바깥 점선이 한 화면에 들어온다.
      await touch('touchStart', [{ id: 7, x: c.x, y: c.y }]); await touch('touchMove', [{ id: 7, x: c.x - 10, y: c.y - 8 }]); await touch('touchMove', [{ id: 7, x: c.x - 20, y: c.y - 16 }]);
      await page.waitForTimeout(400);
      row.state = await page.evaluate(() => { const v = app.battle.player.skillAimView, s = app.battle.player._skillAimShape; return { visible: v.group.visible, envelopeVisible: v.envelope.visible, envelopeScale: +v.envelope.scale.x.toFixed(2), envelopeRenderOrder: v.envelope.renderOrder, targetVisible: v.target.visible, targetScale: +v.target.scale.x.toFixed(2), rangeScale: +v.range.scale.x.toFixed(2), shape: { kind: s.kind, range: +s.range.toFixed(2), radius: +s.radius.toFixed(2), envelope: +s.envelope.toFixed(2), envelopeKind: s.envelopeKind } }; });
      await page.screenshot({ path: path.join(out, skill + '-' + w + 'x' + h + '.png') });
      await touch('touchEnd', []); await page.waitForTimeout(150);
      row.ok = row.state.visible && row.state.envelopeVisible && row.state.envelopeScale > (row.state.shape.kind === 'circle' ? row.state.shape.radius : row.state.shape.range);
    } catch (e) { row.failure = String(e.message || e); row.ok = false; }
    if (!row.ok || errors.length) pass = false;
    rows.push(row);
  }
  await ctx.close();
}
await browser.close();
const report = { scope: '로컬 개발 서버, 격리 Chromium 모바일 터치(CDP). 조준 표시 envelope 메시 상태와 화면 캡처. 실기기 아님.', origin, pass, rows };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass, rows: rows.map(r => [r.viewport, r.skill, r.ok, r.state?.envelopeScale, r.state?.shape?.envelopeKind, r.failure]) }));
if (!pass) process.exitCode = 1;
