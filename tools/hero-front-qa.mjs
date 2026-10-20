// 로비 영웅 정면 근접 캡처: 직업별로 쇼케이스를 정면 시점(기본 시점 프리셋 '정면')으로 두고 몸 주변을 잘라 찍는다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const [origin = 'http://127.0.0.1:5188', outArg = 'work/qa-hero-front', list = 'knight,barbarian,mage,rogue,ranger'] = process.argv.slice(2);
const out = path.resolve(outArg); await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=d3d11'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(origin + '/'); await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show') && app.showcase, null, { timeout: 120000 });
await page.evaluate(() => app.ui.closeModal?.());
const rows = [];
for (const id of list.split(',')) {
  await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, id);
  await page.evaluate(() => document.querySelector('[data-lobby-view="front"]')?.click());
  await page.waitForTimeout(1800);
  for (const t of [0, 1.1]) {
    if (t) await page.waitForTimeout(1100);
    const box = await page.evaluate(() => { const s = app.showcase, cam = app.renderer.camera; s.root.updateMatrixWorld(true); const V = s.root.position.constructor; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; s.root.traverse(o => { if (!o.isBone) return; const p = o.getWorldPosition(new V()).project(cam); const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }); const h = y1 - y0; return { x: Math.max(0, x0 - h * .45), y: Math.max(0, y0 - h * .35), width: Math.min(innerWidth, (x1 - x0) + h * .9), height: Math.min(innerHeight, h * 1.5) }; });
    await page.screenshot({ path: path.join(out, id + '-' + (t ? 'b' : 'a') + '.png'), clip: box });
  }
  rows.push(id);
}
console.log(JSON.stringify({ rows, errors: errors.slice(0, 2) }));
await b.close();