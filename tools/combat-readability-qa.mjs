// 전투 가독성 기준 녹화: 5영웅 × (1-1, 3-2, 3-5 중간 보스)를 고정 시드·고정 프레임(1/60s)으로 AUTO 플레이하며
// 일정 간격으로 프레임을 찍고, 적중·빗나감 계측(window.app.battle.readability)이 있으면 함께 기록한다.
// 픽스처 주입: 저장의 선택 영웅·보유·진행도·에너지만 바꾼다(HP·피해·처치·승리는 건드리지 않는다).
// 사용: node tools/combat-readability-qa.mjs [--tag before|after] [--heroes knight,ranger] [--cases 1-1,3-2,3-5] [--w 844 --h 390]
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'before');
const heroes = arg('heroes', 'knight,barbarian,mage,rogue,ranger').split(',');
const cases = arg('cases', '1-1,3-2,3-5').split(',').map(s => s.split('-').map(Number));
const W = Number(arg('w', 844)), H = Number(arg('h', 390));
const SECONDS = Number(arg('seconds', 14)), SHOT_EVERY = Number(arg('every', 10));
const out = path.join(root, 'work/combat-readability', tag);
const hash = b => createHash('sha256').update(b).digest('hex');
const report = { tag, viewport: { w: W, h: H }, dt: 1 / 60, seconds: SECONDS, seed: 'Math.random 고정(mulberry32 0xB1ADE)', runs: [], errors: [] };
await fs.mkdir(out, { recursive: true });

let server, browser;
try {
  server = await preview({ root, logLevel: 'error', build: { outDir: arg('dist', 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(launchOpts());
  for (const hero of heroes) {
    for (const [ch, st] of cases) {
      const id = `${hero}-${ch}-${st}`;
      const dir = path.join(out, id); await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      await installAutoStarter(page);
      page.on('pageerror', e => report.errors.push(`${id}: ${e}`));
      // 고정 시드: 게임 내 Math.random 을 결정적으로 만든다.
      await page.addInitScript(() => {
        let a = 0xB1ADE; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
        try { localStorage.setItem('bladesurge_scene_seen_all', '1'); } catch {}
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
      if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
      await page.locator('#boot-start').click();
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
      const started = await page.evaluate(async ({ hero, ch, st }) => {
        const app = window.app; app.ui.closeModal?.();
        const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 999;
        if (!e.s.roster.owned.includes(hero)) e.s.roster.owned.push(hero);
        e.s.selected = hero; const h = e.hero(hero); if (h) { h.level = Math.max(h.level || 1, 30); h.exp = 0; }
        const ex = e.s.expedition; if (ex) { ex.unlockedJobs = []; ex.selectedJob = null; }
        e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
        const ok = await app.startStage(window.__stageDef(ch, st));
        app.companionAgent?.endBattle?.();
        return { ok, hero: app.battle?.player?.def?.id };
      }, { hero, ch, st });
      if (started.ok) {
        await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 }).catch(() => {});
        if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
        Object.assign(started, await page.evaluate(() => { const app = window.app; app.testPause = true; const b = app.battle; if (b?.player) b.player.auto = true; return { active: !!b?.active, hero: b?.player?.def?.id }; }));
      }
      const run = { id, hero, stage: `${ch}-${st}`, started, frames: [], metrics: null };
      if (!started.ok || !started.active) { run.failure = '전투 시작 실패'; report.runs.push(run); await context.close(); continue; }
      const total = Math.round(SECONDS * 60), every = SHOT_EVERY; // SHOT_EVERY 프레임마다 1장
      for (let f = 0, n = 0; f < total; f += every, n++) {
        await page.evaluate(k => { for (let i = 0; i < k; i++) window.app.step(1 / 60, i === k - 1); }, every);
        const file = `f${String(n).padStart(3, '0')}.jpg`;
        await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 80 });
        if (n % 6 === 0) run.frames.push({ t: +((f + every) / 60).toFixed(2), file, sha256: hash(await fs.readFile(path.join(dir, file))) });
      }
      run.metrics = await page.evaluate(() => {
        const b = window.app.battle, r = b?.readability;
        return { active: !!b?.active, readability: r ? { ...r.stats } : null, enemiesAlive: (b?.enemies || []).filter(e => !e.dead).length };
      });
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '6', '-i', path.join(dir, 'f%03d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', path.join(out, `${id}.mp4`)]);
        run.video = `work/combat-readability/${tag}/${id}.mp4`;
      } catch (e) { run.videoError = String(e).slice(0, 200); }
      report.runs.push(run);
      await context.close();
      await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  report.status = report.errors.length ? 'errors' : 'done';
} catch (e) { report.status = 'fail'; report.failure = String(e?.stack || e); process.exitCode = 1; }
finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise(r => server?.httpServer.close(r) || r());
  console.log(JSON.stringify({ status: report.status, runs: report.runs.map(r => ({ id: r.id, ok: !r.failure, m: r.metrics?.readability })), errors: report.errors.slice(0, 5), failure: report.failure?.slice(0, 400) }));
}
