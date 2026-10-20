// 지역 던전 실제 화면 캡처: 로비 카드 → 출격 → 원정 시작으로 실제 진입해 전투 장면을 찍는다. 시작 상태 고정: 탐험 레벨(픽스처), 무적.
// 사용: node tools/region-capture-qa.mjs <origin> <out> <dungeonId> [viewports]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const [origin = 'http://127.0.0.1:5185', outArg = 'work/qa-region', dungeon = 'star_archive', vps = '1280x590,844x390'] = process.argv.slice(2);
const out = path.resolve(outArg); await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const rows = [];
for (const [w, h] of vps.split(',').map(v => v.split('x').map(Number))) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  await page.evaluate(() => { app.ui.closeModal?.(); app.expedition.s.level = Math.max(app.expedition.s.level, 10); app.eco.s.energy = 100; app.meta?.refresh?.(); app.syncHub?.(); });
  await page.waitForTimeout(500);
  const row = { viewport: w + 'x' + h, dungeon, errors };
  try {
    // 카드의 data-dungeon-id로 찾는다(정식 빌드에는 /src 모듈이 없다).
    const target = page.locator('.dl-pick[data-dungeon-id="' + dungeon + '"]');
    row.name = (await target.first().innerText()).split('\n')[0];
    await target.first().scrollIntoViewIfNeeded(); await target.first().tap(); await page.waitForTimeout(300);
    await page.locator('#citadel-dungeon-prepare').tap(); await page.waitForTimeout(700);
    row.prep = await page.evaluate(() => document.querySelector('#citadel-destination-title')?.textContent || null);
    await page.locator('.citadel-hub-go').tap();
    row.battle = await page.waitForFunction(() => app.mode === 'battle' && app.battle?.active, null, { timeout: 40000 }).then(() => true).catch(() => false);
    if (row.battle) {
      await page.evaluate(() => { app.battle.player.invuln = 1e9; });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(out, dungeon + '-' + w + 'x' + h + '-start.png') });
      // 영웅을 방 가운데 쪽으로 걸려 다른 구도도 남긴다.
      await page.evaluate(() => { app.battle.player.auto = true; });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: path.join(out, dungeon + '-' + w + 'x' + h + '-fight.png') });
      row.frame = await page.evaluate(async () => { const t = []; let last = performance.now(); for (let i = 0; i < 90; i++) { await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); t.push(n - last); last = n; } t.sort((a, b) => a - b); return { p50: +t[45].toFixed(1), p95: +t[85].toFixed(1) }; });
      row.renderInfo = await page.evaluate(() => { const r = app.renderer.renderer || app.renderer.gl || app.renderer.webgl; const i = r?.info?.render; return i ? { calls: i.calls, triangles: i.triangles } : null; });
    }
  } catch (e) { row.error = String(e.message || e).slice(0, 240); }
  rows.push(row); await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(out, dungeon + '-report.json'), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows));
