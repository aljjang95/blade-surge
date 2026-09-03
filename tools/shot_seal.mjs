import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
/**
 * 게이트 B 보조 — 봉인 결계 / 포탈 / 보스방 진입 3장을 찍는다 (하네스 스크린샷엔 잘 안 잡히는 장면).
 *   node tools/shot_seal.mjs [출력폴더=.rsi/shots]
 */
import { resolve } from 'path';
import { mkdirSync } from 'fs';
const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4197, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
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
await page.evaluate(async () => { await window.app.startStage(window.app.eco.nextStage()); });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.app.testPause = true; });
// 1) 결계 앞 — 게이트 바깥 복도에 플레이어를 세운다
const info = await page.evaluate(() => {
  const b = window.app.battle, W = b.world, g = W.gates[0], B = W.bossRoom;
  const dx = g.x - B.x, dz = g.z - B.z, l = Math.hypot(dx, dz) || 1;
  b.player.pos.set(g.x + dx / l * 4, 0, g.z + dz / l * 4); b.player.face(g.x, g.z);
  const rig = window.app.renderer.rig; rig.target.copy(b.player.pos); rig.pos.copy(b.player.pos).add(rig.offset);
  for (let i = 0; i < 30; i++) window.app.step(1 / 60, i === 29);
  return { gates: W.gates.length, sealed: W.sealed, rooms: W.rooms.length, obj: document.getElementById('objective').textContent };
});
console.log(info);
await page.screenshot({ path: OUT + '/seal.png' });
// 2) 봉인 해제 → 포탈
const info2 = await page.evaluate(() => {
  const b = window.app.battle, W = b.world;
  for (const r of W.rooms) if (r.type !== 'boss' && r.type !== 'start') { r.cleared = true; r.spawned = true; }
  b.player.pos.set(W.rooms[1].x, 0, W.rooms[1].z);
  const rig = window.app.renderer.rig; rig.target.copy(b.player.pos); rig.pos.copy(b.player.pos).add(rig.offset);
  b.unsealBoss();
  for (let i = 0; i < 40; i++) window.app.step(1 / 60, i === 39);
  return { sealed: W.sealed, portal: !!b.portal, obj: document.getElementById('objective').textContent, seals: window.app.arena.seals.length };
});
console.log(info2);
await page.screenshot({ path: OUT + '/portal.png' });
// 3) 포탈 진입 → 보스방 앞
const info3 = await page.evaluate(() => {
  const b = window.app.battle; b.player.auto = true;
  for (let i = 0; i < 240; i++) window.app.step(1 / 60, i === 239);
  return { portal: !!b.portal, room: b.curRoom?.type, boss: !!b.boss, pos: b.player.pos.toArray().map((v) => Math.round(v)) };
});
console.log(info3);
await page.screenshot({ path: OUT + '/boss_entry.png' });
console.log('errors', errors);
await br.close(); srv.kill();
