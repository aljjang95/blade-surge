/**
 * 게이트 B 보조 — 기본 콤보 컷: 영웅별로 무리 한가운데서 콤보를 끝까지 돌리며 각 타의 타격 순간을 찍는다.
 *   node tools/shot_combo.mjs [출력폴더=.rsi/shots] [영웅=knight,barbarian,mage,rogue]
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4196, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
const HEROES = (process.argv[3] || 'knight,barbarian,mage,rogue').split(',');
mkdirSync(OUT, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
// 웹폰트 CDN 은 헤드리스 컨테이너에서 프록시를 타지 않아 커넥션 리셋이 난다 —
// 게임이 아니라 CDN 을 재는 셈이라 하네스에선 빈 CSS 로 즉시 응답한다 (실측: 부트 0.9초 → 12.8초)
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());
for (const h of HEROES) {
  await page.evaluate(async (h) => {
    const e = window.app.eco; if (!e.ownHero(h)) e.grantHero(h); e.s.selected = h; e.hero(h).level = 5; e.save();
    if (window.app.mode === 'battle') window.app.toLobby();
    await window.app.startStage(window.app.eco.nextStage());
    window.app.testPause = true;
  }, h);
  await page.waitForTimeout(800);
  // 무리 소환 + 콤보 시작
  const n = await page.evaluate(() => {
    const b = window.app.battle, p = b.player; p.auto = false; b.input.enabled = true;
    const R = b.stage.rosterFor('normal'); const made = [];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const e = b.spawnEnemy(R.trash[i % R.trash.length], null, b.world.startRoom, p.pos.clone().add({ x: Math.cos(a) * 3.2, y: 0, z: Math.sin(a) * 3.2 })); if (e) { e.maxHp = e.hp = 1e6; e.atk = 0; made.push(e); } }
    for (let i = 0; i < 70; i++) window.app.step(1 / 60, false);   // 스폰 완료
    b.input.attackHeld = true;
    return p.def.combo.length;
  });
  // 각 타의 타격 직후 프레임을 찍는다
  for (let k = 0; k < n; k++) {
    const info = await page.evaluate(() => {
      const app = window.app, p = app.battle.player; app.battle.input.attackHeld = true;
      let guard = 0, idx = -1;
      while (guard++ < 400) { const before = p.hitDone; app.step(1 / 60, false); if (p.state === 'attack' && p.hitDone && !before) { idx = p.comboIdx; break; } }
      for (let i = 0; i < 4; i++) app.step(1 / 60, i === 3);
      return { idx, state: p.state, move: p.current?.move || '-', combo: app.battle.combo };
    });
    console.log(h, k, info);
    await page.screenshot({ path: `${OUT}/combo_${h}_${k}.png`, clip: { x: 140, y: 0, width: 600, height: 400 } });
  }
}
console.log('errors', errors);
await br.close(); srv.kill();
