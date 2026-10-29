// 출격 스모크(빌드 산출물): 실제 Chromium WebGL2로 캠페인 1-1을 근접·원거리 영웅으로 출격시키고
// 셰이더 링크·전투 시작·몇 초 진행을 확인한다. 셰이더 문자열 하나가 깨지면 모든 출격이
// '던전을 준비하지 못했습니다'로 끝나는데 단위 테스트는 GLSL을 컴파일하지 않아 놓친다(#394 → #408).
// 사용: node tools/sortie-smoke.mjs [--dist dist] [--dev]  (bun run check 의 마지막 단계)
import { chromium } from 'playwright';
import { preview, createServer } from 'vite';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HEROES = arg('heroes', 'knight,ranger').split(',');
const failures = [];
let server, browser;
try {
  if (process.argv.includes('--dev')) { server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await server.listen(); }
  else server = await preview({ root, logLevel: 'error', build: { outDir: arg('dist', 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(launchOpts());
  for (const hero of HEROES) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage(); await installAutoStarter(page);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { const t = m.text(); if (/did not link|ERROR: \d+:\d+|던전을 준비하지 못했습니다|stage preparation failed/i.test(t)) errors.push(t.slice(0, 300)); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
    const started = await page.evaluate(async hero => {
      const app = window.app; app.ui.closeModal?.(); const e = app.eco;
      e.s.tutorial = { completed: true }; e.s.energy = 999;
      if (!e.s.roster.owned.includes(hero)) e.s.roster.owned.push(hero);
      e.s.selected = hero;
      return await app.startStage(window.__stageDef(1, 1));
    }, hero);
    const ready = started && await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 120000 }).then(() => true, () => false);
    let result = null;
    if (ready) {
      // 렌더를 켠 채 몇 초 진행: 전투 중에야 처음 그려지는 재질(조준선·체력 막대·스킬 VFX)도 링크된다.
      result = await page.evaluate(() => {
        const app = window.app; app.testPause = true; app.battle.player.auto = true;
        for (let i = 0; i < 240; i++) app.step(1 / 60, i % 4 === 3);
        const r = app.renderer; return { active: !!app.battle?.active, programs: r?.renderer?.info?.programs?.length ?? null, mode: app.mode };
      });
    }
    if (!started || !ready || !result?.active || errors.length) failures.push({ hero, started, ready, result, errors: errors.slice(0, 4) });
    console.log(JSON.stringify({ hero, started, ready, result, errors: errors.length }));
    await context.close();
  }
} catch (e) { failures.push({ error: String(e?.stack || e).slice(0, 600) }); }
finally {
  await browser?.close(); await server?.close?.().catch?.(() => {});
}
if (failures.length) { console.error('출격 스모크 실패: ' + JSON.stringify(failures, null, 2)); process.exit(1); }
console.log('출격 스모크 통과');
process.exit(0);
