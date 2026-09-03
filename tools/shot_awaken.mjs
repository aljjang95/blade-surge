/**
 * 게이트 B 보조 — 각성 스킬(레벨 구간 해금) 8종을 실제로 시전해 눈으로 본다.
 *   node tools/shot_awaken.mjs [출력폴더=.rsi/shots]
 * 하네스(metrics)는 레벨 1 로 돌기 때문에 각성기가 한 번도 발화하지 않는다 — 이 컷이 유일한 눈이다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4196, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
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

// 잠금 상태 UI 한 컷 (레벨 1 검성 — 각성 2칸이 잠겨 보여야 한다)
await page.evaluate(async () => {
  const a = window.app; a.eco.s.energy = 9999; a.eco.s.selected = 'knight'; a.eco.hero('knight').level = 1; a.eco.save();
  await a.startStage(a.eco.nextStage()); a.testPause = true;
  for (let i = 0; i < 40; i++) a.step(1 / 60, i === 39);
});
await page.screenshot({ path: `${OUT}/awk_locked.png` });
console.log('locked', await page.evaluate(() => [...document.querySelectorAll('.skill-btn')].map((b) => (b.classList.contains('locked') ? 'L' : '-')).join('')));

const HEROES = ['knight', 'barbarian', 'mage', 'rogue'];
for (const h of HEROES) {
  for (const slot of [4, 5]) {
    const info = await page.evaluate(async ({ h, slot }) => {
      const a = window.app; a.testPause = false;
      const e = a.eco; if (!e.ownHero(h)) e.grantHero(h);
      e.s.selected = h; e.hero(h).level = 25; e.s.energy = 9999; e.save();
      a.battle.stop?.();
      await a.startStage(e.nextStage());
      a.testPause = true;
      const b = a.battle, p = b.player;
      // 적을 플레이어 앞에 한 무리 세운다 (각성기는 몹몰이용이라 무리가 있어야 읽힌다)
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const at = p.pos.clone().add(new (p.pos.constructor)(Math.cos(ang) * (3 + (i % 3)), 0, Math.sin(ang) * (3 + (i % 3))));
        b.spawnEnemy(i % 3 === 0 ? 'skel_rogue' : 'skel_minion', null, b.curRoom, at);
      }
      for (const en of b.enemies) { en.spawning = 0; en.spawnT = 9; }
      for (let i = 0; i < 30; i++) a.step(1 / 60, false);
      const sk = p.def.skills[slot];
      const ok = p.tryCastSkill(slot);
      const frames = Math.round((sk.id === 'chrono_seal' || sk.id === 'sanctuary' || sk.id === 'magma_zone' ? 1.5 : 0.8) * 60);
      for (let i = 0; i < frames; i++) a.step(1 / 60, i === frames - 1);
      const cdAtCast = p.cds[slot];
      for (let i = 0; i < 60; i++) a.step(1 / 60, false);
      const cdAfter1s = p.cds[slot];
      // 쿨타임이 안 줄면 각성기는 층당 1회짜리가 된다 — 하네스는 레벨 1 이라 이걸 못 잡는다
      return { name: sk.name, ok, unlocked: p.unlocked(slot), cdTicks: sk.ult ? 'ult' : (cdAfter1s < cdAtCast - 0.5 ? 'OK' : `FAIL ${cdAtCast}→${cdAfter1s}`), inWall: !!(b.world && !b.world.walkable(p.pos.x, p.pos.z)), enemies: b.enemies.filter((x) => x.alive).length };
    }, { h, slot });
    console.log(h, slot, JSON.stringify(info));
    await page.screenshot({ path: `${OUT}/awk_${h}_${slot}.png` });
    // 후반부 (장판·해제 폭발)
    await page.evaluate(() => { for (let i = 0; i < 110; i++) window.app.step(1 / 60, i === 109); });
    await page.screenshot({ path: `${OUT}/awk_${h}_${slot}b.png` });
  }
}
console.log('errors', errors.slice(0, 12));
await br.close(); srv.kill();
