/**
 * 무기 쥠 QA — 영웅별로 무기·방어구를 장착하고 전투 시점을 가까이 당겨 대기·공격 자세를 캡처한다.
 *   node tools/weapon-grip-qa.mjs [출력폴더=work/qa/weapon-grip] [포트=4410]
 * 손 소켓 위치와 손바닥 거리(m)를 함께 기록한다. 실기기 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installAutoStarter } from './qa-starter.mjs';
const OUT = process.argv[2] || 'work/qa/weapon-grip', PORT = Number(process.argv[3] || 4410);
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let up = false; for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch('http://localhost:' + PORT + '/')).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 500)); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('console', m => { if (['warning', 'error'].includes(m.type()) && !/KHR_parallel|deprecated/.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
const report = {};
try {
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto('http://localhost:' + PORT + '/'); await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) { const c = page.locator('#modal.show #m-cancel'); if (await c.isVisible().catch(() => false)) { await c.click(); await page.waitForTimeout(300); } }
  for (const hero of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
    await page.evaluate(async (hero) => {
      const a = window.app, e = a.eco; if (a.battle?.active) { a.battle.stop(); a.toLobby(); }
      e.s.roster.policy = 1; e.s.roster.starterChosen = true; // 모든 영웅을 소유한 정책 1로 둔다(장착 시험용)
      e.s.selected = hero; e.s.energy = 9999;
      for (const slot of ['weapon', 'armor']) { const it = e.addItem('E', slot); e.equip(hero, it.uid); }
      return { ok: await a.startStage(e.nextStage()), mode: a.mode, starting: a.stageStarting };
    }, hero).then(r => console.log(hero, JSON.stringify(r)));
    await page.waitForFunction(() => window.app.battle?.player?.model, null, { timeout: 60000 }); await page.waitForTimeout(2500);
    for (let i = 0; i < 3; i++) { const c = page.locator('#modal.show #m-cancel'); if (await c.isVisible().catch(() => false)) { await c.click(); await page.waitForTimeout(300); } }
    await page.evaluate(() => { const b = window.app.battle; for (const en of b.enemies) { en.hp = 0; en.alive = false; en.dead = true; if (en.root) en.root.visible = false; } window.app.renderer.battleCamera = { yaw: 35, pitch: -14, zoom: 140 }; });
    await page.waitForTimeout(1200);
    report[hero] = await page.evaluate(() => {
      const m = window.app.battle.player.model, out = {};
      for (const name of ['LibrarySocket_r', 'LibrarySocket_l']) { const s = m.getObjectByName(name); if (!s) continue; const p = s.getWorldPosition(new s.position.constructor()); const h = s.parent.getWorldPosition(new s.position.constructor()); out[name] = { offset: +p.distanceTo(h).toFixed(3), parent: s.parent.name }; }
      return out;
    });
    await page.screenshot({ path: OUT + '/' + hero + '-idle.png', clip: { x: 300, y: 90, width: 360, height: 380 } });
    await page.evaluate(() => { const b = window.app.battle; b.player.attack?.(); });
    await page.waitForTimeout(260);
    await page.screenshot({ path: OUT + '/' + hero + '-attack.png', clip: { x: 300, y: 90, width: 360, height: 380 } });
  }
} finally {
  writeFileSync(OUT + '/result.json', JSON.stringify({ at: new Date().toISOString(), report, errors }, null, 2));
  console.log(JSON.stringify(report), JSON.stringify(errors.slice(0, 6)));
  await br.close(); srv.kill();
}

