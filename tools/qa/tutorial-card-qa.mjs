// 첫 전투(1-1) 조작 안내 카드 겹침 점검(지휘 2026-10-30: 390x700 에서 3/5 카드가 상단 HP·MP·가방을 덮음).
// 화면 크기마다 1-1 을 첫 전투 상태(튜토리얼 미완료)로 열고 5단계를 차례로 펼쳐, 카드 사각형과 HUD 요소·영웅 몸 사각형의 겹침 면적을 잰다.
// 사용: node tools/qa/tutorial-card-qa.mjs [--tag after] [--url https://blade.tllhouse.com] [--sizes 360x640,390x700,390x844,844x390]
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'after'), remote = arg('url', '');
const sizes = arg('sizes', '360x640,390x700,390x844,844x390').split(',').map(s => s.split('x').map(Number));
const out = path.join(root, 'work/tutorial-card', tag);
const report = { tag, url: remote || 'dist', runs: [], errors: [] };
await fs.mkdir(out, { recursive: true });
// 카드가 덮으면 안 되는 HUD 요소(hud-clearance 의 전투 HUD 목록과 같은 범위).
const HUD = ['.hud-player', '.hud-center .wave', '.hud-center .stage-name', '.hud-right-top', '#btn-map', '#objective', '#bossbar', '.joy-base', '.actions .skill-btn', '#btn-dodge', '#btn-attack', '.exp-potions', '.battle-camera-controls'];

let server = null, browser;
try {
  if (!remote) server = await preview({ root, logLevel: 'error', build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
  const url = remote || 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(launchOpts());
  for (const [W, H] of sizes) {
    const id = `${W}x${H}`;
    const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    await installAutoStarter(page);
    page.on('pageerror', e => report.errors.push(`${id}: ${e}`));
    await page.addInitScript(() => { try { localStorage.setItem('bladesurge_scene_seen_all', '1'); } catch {} });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.locator('#boot-start').click();
    if (remote) await page.getByRole('button', { name: '게스트로 시작' }).click({ timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
    const ok = await page.evaluate(async () => {
      const app = window.app; app.ui.closeModal?.(); app.eco.s.energy = 999; app.eco.s.tutorial = { completed: false };
      return await app.startStage(window.__stageDef(1, 1));
    });
    const run = { id, ok, steps: [] };
    if (!ok) { run.failure = '전투 시작 실패'; report.runs.push(run); await context.close(); continue; }
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.elapsed > .3, null, { timeout: 90000 }).catch(() => {});
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.evaluate(() => { window.app.testPause = true; for (let i = 0; i < 30; i++) window.app.step(1 / 60, i === 29); });
    for (const phase of ['move', 'attack', 'dodge', 'skill', 'clear']) {
      const m = await page.evaluate(({ phase, HUD }) => {
        const app = window.app, t = app.tutorial;
        t.setExpanded(true, 60); t.show(phase);
        for (let i = 0; i < 6; i++) app.step(1 / 60, i === 5);
        const card = document.querySelector('#battle-tutorial .tutorial-card');
        const rc = card && !card.hidden ? card.getBoundingClientRect() : null;
        const area = (a, c) => { const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); return w > 0 && h > 0 ? Math.round(w * h) : 0; };
        const hits = [];
        if (rc) for (const sel of HUD) for (const el of document.querySelectorAll('#hud ' + sel)) {
          const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) continue;
          const a = area(rc, r); if (a > 0) hits.push({ sel, area: a });
        }
        // 영웅 몸: 발~머리(1.9m) 투영, 폭은 높이의 0.56.
        const b = app.battle, p = b.player.pos, cam = b.renderer.camera, W = innerWidth, H = innerHeight;
        const proj = y => { const v = p.clone().setY(y).project(cam); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
        const foot = proj(0), head = proj(1.9), h = Math.max(8, foot.y - head.y);
        const hero = { left: foot.x - h * .28, right: foot.x + h * .28, top: head.y, bottom: foot.y };
        return { phase, step: document.getElementById('tutorial-step')?.textContent, card: rc && { left: Math.round(rc.left), top: Math.round(rc.top), right: Math.round(rc.right), bottom: Math.round(rc.bottom) }, hudOverlap: hits, heroOverlap: rc ? area(rc, hero) : 0 };
      }, { phase, HUD });
      run.steps.push(m);
      if (phase === 'dodge') await page.screenshot({ path: path.join(out, `${id}-dodge.jpg`), type: 'jpeg', quality: 85 });
    }
    run.totalHud = run.steps.reduce((s, x) => s + x.hudOverlap.reduce((a, b) => a + b.area, 0), 0);
    run.totalHero = run.steps.reduce((s, x) => s + x.heroOverlap, 0);
    report.runs.push(run);
    await context.close();
  }
  report.status = report.runs.every(r => r.ok && !r.totalHud && !r.totalHero) ? 'pass' : 'overlap';
} catch (e) { report.status = 'fail'; report.failure = String(e?.stack || e); process.exitCode = 1; }
finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server?.close?.().catch?.(() => {});
  console.log(JSON.stringify({ status: report.status, runs: report.runs.map(r => ({ id: r.id, hud: r.totalHud, hero: r.totalHero, worst: r.steps?.flatMap(s => s.hudOverlap.map(h => s.phase + ':' + h.sel + ':' + h.area)).slice(0, 6), cards: r.steps?.map(s => s.card && [s.card.top, s.card.bottom]) })), errors: report.errors.slice(0, 3), failure: report.failure?.slice(0, 400) }));
}
process.exit(process.exitCode || 0);
