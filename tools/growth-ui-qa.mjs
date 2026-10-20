// 성장 UI(스킬 트리·영웅 초월) 화면 캡처와 배치 검사. 설계도 skill-tree-screen / transcend-screen 비교용.
// 사용법: node tools/growth-ui-qa.mjs [origin=http://127.0.0.1:5330/] [out=work/qa/ui-20261020] [heroId]
// 주입 fixture: eco.addRewards 로 조각·초월석·골드를 채우고, 초월 대상 영웅은 실제 eco.hero 상태 그대로 쓴다.
// 화면 열기는 게임의 실제 진입 함수(meta.openSkillTree / meta.openTranscend)를 쓴다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
const origin = process.argv[2] || 'http://127.0.0.1:5330/', out = path.resolve(process.argv[3] || 'work/qa/ui-20261020');
const wantHero = process.argv[4] || null;
await fs.mkdir(out, { recursive: true });
const SIZES = [{ width: 844, height: 390 }, { width: 1280, height: 590 }];
const report = { started: new Date().toISOString(), origin, sizes: SIZES, results: [] };
const failures = [];
const browser = await chromium.launch(launchOpts());
for (const viewport of SIZES) {
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const row = { viewport, checks: [], errors: [] }; report.results.push(row);
  page.on('pageerror', (e) => row.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') row.errors.push(m.text()); });
  const check = (name, ok, detail) => { row.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(viewport.width + 'x' + viewport.height + ': ' + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); };
  try {
    await page.goto(origin);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
    await page.waitForTimeout(1500);
    for (let n = 0; n < 4; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible()) break; await c.tap(); await page.waitForTimeout(200); }
    const info = await page.evaluate((want) => {
      const eco = window.app.eco;
      eco.addRewards({ gold: 2000000, transcendStones: 20 }, { silent: true });
      const owned = Object.keys(eco.s.heroes || {});
      const target = want || owned.find((id) => id !== eco.s.selected) || eco.s.selected;
      eco.emit();
      return { selected: eco.s.selected, target, owned };
    }, wantHero);
    row.fixture = info;
    // 영웅 화면으로 이동 후, 실제 진입 함수로 두 화면을 연다.
    await page.locator('.bottomnav button[data-tab="heroes"]').tap(); await page.waitForTimeout(800);
    for (const [name, call] of [['skilltree', 'openSkillTree'], ['transcend', 'openTranscend']]) {
      const ok = await page.evaluate(([fn, id]) => window.app.meta[fn](id), [call, info.target]);
      check(name + ' opened', ok === true || ok === undefined || !!ok, ok);
      await page.waitForTimeout(1200);
      const rects = await page.evaluate(() => {
        const layer = document.querySelector('.gx-layer:not([hidden])'); if (!layer) return null;
        const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom) }; };
        const panels = [...layer.querySelectorAll('.gx-panel')].map(r);
        const clipped = [...layer.querySelectorAll('button')].filter((n) => n.offsetParent).map((n) => ({ t: (n.textContent || '').trim().slice(0, 10), ...r(n) })).filter((b) => b.x < 0 || b.y < 0 || b.r > innerWidth + 1 || b.b > innerHeight + 1);
        return { layer: r(layer), panels, portrait: r(layer.querySelector('.gx-portrait')), clipped, scrollOverflow: [...layer.querySelectorAll('.gx-panel')].filter((n) => n.scrollHeight > n.clientHeight + 2).length };
      });
      row[name] = rects;
      check(name + ' layer visible', !!rects);
      const hidden = await page.evaluate(() => window.app.showcase?.root?.visible === false);
      check(name + ' lobby 3D hero hidden behind overlay', hidden);
      check(name + ' no clipped buttons', rects && rects.clipped.length === 0, rects && rects.clipped);
      await page.screenshot({ path: path.join(out, name + '-' + viewport.width + 'x' + viewport.height + '.png') });
      await page.evaluate(() => { for (const v of [window.app.meta.skillTree, window.app.meta.transcendView]) v?.close?.({ rerender: false, restoreFocus: false }); });
      check(name + ' lobby 3D hero restored on close', await page.evaluate(() => window.app.showcase?.root?.visible !== false));
    }
  } catch (e) { check('run', false, String(e)); }
  check('no page errors', row.errors.length === 0, row.errors.slice(0, 3));
  await context.close();
}
await browser.close();
report.failures = failures;
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(failures.length ? 'FAIL\n' + failures.join('\n') : 'OK');
process.exit(failures.length ? 1 : 0);
