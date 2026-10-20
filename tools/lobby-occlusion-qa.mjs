// 로비 영웅 가림 실측과 카드→출격→전투 진입 실제 터치 확인. 대표님 규칙(UI는 플레이를 가리지 않는다).
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = process.argv[2] || 'http://127.0.0.1:5184';
const out = path.resolve(process.argv[3] || 'work/qa-lobby-occlusion');
const views = (process.argv[4] || '1280x590,844x390,800x360').split(',').map(v => v.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const rows = []; let pass = true;
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show') && app.showcase, null, { timeout: 120000 });
  await page.evaluate(() => app.ui.closeModal?.()); await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const s = app.showcase, cam = app.renderer.camera; s.root.updateMatrixWorld(true); cam.updateMatrixWorld(true);
    const V = s.root.position.constructor; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    s.root.traverse(o => { if (!o.isBone) return; const p = o.getWorldPosition(new V()).project(cam); const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); });
    const pad = 14; const hero = { left: x0 - pad, top: y0 - pad * 3, right: x1 + pad, bottom: y1 + pad };
    const vis = el => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && b.width > 2 && b.height > 2; };
    const hits = [];
    for (const el of document.querySelectorAll('#meta *')) {
      if (!vis(el)) continue; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      const opaque = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || el.matches('button, img');
      if (!opaque || el.id === 'lobby-camera-pad') continue;
      if (b.width > innerWidth * .9 && b.height > innerHeight * .9) continue;
      if (b.left < hero.right && b.right > hero.left && b.top < hero.bottom && b.bottom > hero.top) hits.push({ el: (el.id ? '#' + el.id : el.tagName) + '.' + String(el.className).split(' ').slice(0, 2).join('.'), r: [b.left, b.top, b.right, b.bottom].map(Math.round) });
    }
    return { hero: Object.fromEntries(Object.entries(hero).map(([k, v]) => [k, Math.round(v)])), hits: hits.slice(0, 10) };
  });
  await page.screenshot({ path: path.join(out, 'lobby-' + w + 'x' + h + '.png') });
  const flow = {};
  try {
    const cards = page.locator('.dl-cards > *');
    flow.cardCount = await cards.count();
    if (flow.cardCount >= 2) { await cards.nth(1).tap(); await page.waitForTimeout(250); flow.secondDetail = await page.evaluate(() => document.querySelector('.dl-card')?.textContent?.slice(0, 40)); }
    await cards.nth(0).tap(); await page.waitForTimeout(250); flow.firstDetail = await page.evaluate(() => document.querySelector('.dl-card')?.textContent?.slice(0, 40));
    await page.locator('#citadel-dungeon-prepare').tap(); await page.waitForTimeout(700);
    flow.prepTitle = await page.evaluate(() => document.querySelector('#citadel-destination-title')?.textContent || null);
    await page.screenshot({ path: path.join(out, 'prep-' + w + 'x' + h + '.png') });
    await page.locator('.citadel-hub-go').tap();
    flow.battle = await page.waitForFunction(() => app.mode === 'battle' && app.battle?.active, null, { timeout: 30000 }).then(() => true).catch(() => false);
  } catch (e) { flow.error = String(e.message || e).slice(0, 200); }
  const ok = m.hits.length === 0 && flow.battle === true && !errors.length;
  if (!ok) pass = false;
  rows.push({ viewport: w + 'x' + h, ...m, flow, errors: errors.slice(0, 3), ok });
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ origin, pass, rows }, null, 2));
console.log(JSON.stringify({ pass, rows: rows.map(r => ({ v: r.viewport, hero: r.hero, hits: r.hits, flow: r.flow, errors: r.errors })) }));
if (!pass) process.exitCode = 1;
