// 몹몰이 무리 전투·무쿨 회피 실제 브라우저 확인(로컬 dev 서버). 실제 DOM 탭·키 입력만 쓰고 게임 상태·시간·경제를 강제하지 않는다.
// 사용: node tools/crowd-combat-qa.mjs --url http://127.0.0.1:5291/ --out <dir> [--hero ranger] [--video]
// 범위: Linux Chromium SwiftShader + CDP 터치 프로필. 실기기 Android/GPU/발열/사람 조작감 증거가 아니다.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { launchOpts } from './chrome.mjs';

const args = process.argv.slice(2), get = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const url = get('--url', 'http://127.0.0.1:5291/'), out = path.resolve(get('--out', 'crowd-combat-qa')), hero = get('--hero', 'ranger');
fs.mkdirSync(out, { recursive: true });
const report = { url, hero, started: new Date().toISOString(), scope: 'Linux Chromium SwiftShader, 844x390 CDP 터치 프로필. 실기기·체감 증거 아님.', errors: [], console: [], frames: [], dodges: [] };
let browser, page, shot = 0;
// 느린 SwiftShader 에서 프로세스가 끊겨도 근거가 남도록 보고서를 단계마다 쓴다.
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const snap = async (label) => { const file = String(++shot).padStart(2, '0') + '-' + label + '.png'; await page.screenshot({ path: path.join(out, file) }); return file; };
// 관찰 전용: 상태를 읽기만 한다.
const observe = () => page.evaluate(() => {
  const b = window.app.battle, p = b.player, w = b.world, room = w?.roomAt(p.pos.x, p.pos.z);
  const enemies = b.enemies.filter(e => e.alive && !e.spawning).map(e => ({ d: +Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z).toFixed(1),
    aggro: e.pack ? e.pack.aggro : null, follower: !!e.packFollower, ranged: !!e.def.ranged, state: e.state, home: e.homeRoom?.id }));
  return { clock: +b.elapsed.toFixed(2), active: b.active, paused: b.paused, hp: +(p.hp / p.maxHp).toFixed(3), state: p.state, auto: p.auto,
    dodgeCd: p.dodgeCd, invuln: +(p.invuln || 0).toFixed(3), kills: b.kills, room: room?.id ?? null, roomType: room?.type ?? null,
    cleared: w.rooms.filter(r => r.cleared && r.type !== 'start').length, rooms: w.rooms.length - 1, enemies,
    cdLabelHidden: document.querySelector('#btn-dodge .dodge-cd')?.hidden ?? true, stage: b.stage?.expedition?.id || b.stage?.code };
});
// SwiftShader 는 게임 시계가 실제 시간보다 훨씬 느릴 수 있다. 예산은 게임 시계로 재고 실제 시간은 상한만 둔다.
const clock = () => page.evaluate(() => window.app.battle.elapsed);
const waitClock = (t, realMs = 120000) => page.waitForFunction(v => window.app.battle.elapsed >= v || !window.app.battle.active, t, { timeout: realMs, polling: 100 });
async function holdToward(gameSeconds, pick, realCapMs = 300000) {
  // 다음 미정화 방으로 실제 화살표 키를 눌러 걷는다(방향은 게임의 실제 길찾기 거리장을 읽어 8방향으로 고른다).
  const down = new Set(), realUntil = Date.now() + realCapMs, gameUntil = (await clock()) + gameSeconds;
  try {
    while (Date.now() < realUntil && (await clock()) < gameUntil) {
      const dir = await page.evaluate((pickMode) => {
        const b = window.app.battle, p = b.player.pos, w = b.world;
        const rooms = w.rooms.filter(r => !r.cleared && !(w.sealed && r === w.bossRoom) && r.type !== 'start');
        rooms.sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z));
        const goal = rooms[0]; if (!goal) return null;
        if (pickMode === 'enter' && w.roomAt(p.x, p.z) === goal && Math.hypot(goal.x - p.x, goal.z - p.z) < goal.w / 2 - 3) return null;
        const d = w.flowDir(w.buildFlow(goal.x, goal.z), p.x, p.z) || [goal.x - p.x, goal.z - p.z];
        return d;
      }, pick);
      const want = new Set();
      if (dir) { if (dir[0] > .38) want.add('ArrowRight'); if (dir[0] < -.38) want.add('ArrowLeft'); if (dir[1] > .38) want.add('ArrowDown'); if (dir[1] < -.38) want.add('ArrowUp'); }
      for (const k of [...down]) if (!want.has(k)) { await page.keyboard.up(k); down.delete(k); }
      for (const k of want) if (!down.has(k)) { await page.keyboard.down(k); down.add(k); }
      if (!dir) break;
      const o = await observe(); if (o.enemies.some(e => e.d < 9 && e.aggro !== false)) break;
      await page.waitForTimeout(120);
    }
  } finally { for (const k of down) await page.keyboard.up(k); }
}
try {
  browser = await chromium.launch(launchOpts({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }));
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
    ...(args.includes('--video') ? { recordVideo: { dir: out, size: { width: 844, height: 390 } } } : {}) });
  page = await ctx.newPage(); page.setDefaultTimeout(120000);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.console.push(m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor(); await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'));
  await page.waitForFunction(() => !!document.querySelector('#modal.show'), null, { timeout: 6000 }).catch(() => {});
  for (let i = 0; i < 4; i++) { const close = page.locator('#modal.show #m-cancel'); if (!await close.isVisible()) break; await close.tap(); await page.waitForTimeout(400); }
  await page.locator('#meta .bottomnav [data-tab="heroes"]').tap(); await page.locator('#hero-list [data-hero-id="' + hero + '"]').tap();
  if (await page.locator('#h-sel').isVisible()) await page.locator('#h-sel').tap();
  await page.waitForFunction(h => window.app.eco.s.selected === h, hero);
  await page.locator('#meta .bottomnav [data-tab="home"]').tap();
  await page.locator('#citadel-dungeon-prepare').tap(); await page.locator('.citadel-hub-dialog[open] .citadel-hub-go').tap();
  await page.waitForFunction(() => document.querySelector('.exp-cinematic') || (window.app.mode === 'battle' && window.app.battle.active));
  const skip = page.locator('.exp-cinematic button'); if (await skip.isVisible()) await skip.tap();
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting && !window.app.battle.paused && window.app.battle.elapsed > .1);
  report.start = await observe(); await snap('start'); save();
  if (args.includes('--auto-first')) {
    // AUTO 버튼을 실제로 눌러 첫 방까지 걷고 무리 발각·합류·전투를 게임 시계 1초 간격으로 기록한다.
    // 교전 중(8m 안 3마리 이상)에는 회피 버튼을 실제로 연타해 무쿨 회피를 확인한다.
    await page.locator('#btn-auto').tap();
    const realStart = Date.now(), gameStart = await clock(); let dodged = 0;
    while (Date.now() - realStart < 1500000) {
      const o = await observe();
      o.file = await snap('auto-' + report.frames.length); report.frames.push(o); save();
      if (dodged < 4 && o.enemies.filter(e => e.d < 8).length >= 3) {
        for (; dodged < 4; dodged++) {
          await page.locator('#btn-dodge').tap();
          const ok = await page.waitForFunction(() => window.app.battle.player.state === 'dodge', null, { timeout: 30000 }).then(() => true, () => false);
          const during = await observe();
          await page.locator('#btn-dodge').tap();
          await page.waitForFunction(() => window.app.battle.player.state !== 'dodge', null, { timeout: 60000 }).catch(() => {});
          const after = await observe();
          report.dodges.push({ i: dodged, started: ok, duringInvuln: during.invuln, duringCd: during.dodgeCd, cdLabelHidden: during.cdLabelHidden,
            near: during.enemies.filter(e => e.d < 8).length, endCd: after.dodgeCd, clock: after.clock, hp: after.hp });
          if (dodged === 1) await snap('dodge-in-crowd');
          save();
        }
      }
      if (o.cleared >= 1 && o.enemies.length === 0 || !o.active || o.clock - gameStart > 70) break;
      await waitClock(o.clock + 1, 240000).catch(() => {});
    }
    report.end = await observe(); await snap('end');
    report.peakNear = Math.max(...report.frames.map(f => f.enemies.filter(e => e.d < 7).length));
    report.followersSeen = Math.max(...report.frames.map(f => f.enemies.filter(e => e.follower).length));
    report.pass = report.errors.length === 0 && report.dodges.length > 0 && report.dodges.every(d => d.started && d.duringCd === 0 && d.endCd === 0 && d.cdLabelHidden) && report.end.cleared >= 1;
    save(); await ctx.close();
  } else {
  // 1) 첫 방으로 실제 키 이동 → 무리 발각·함께 도착을 0.5초 간격으로 기록한다.
  await holdToward(25, 'enter');
  for (let i = 0; i < 10; i++) { const o = await observe(); o.file = await snap('approach-' + i); report.frames.push(o); await waitClock(o.clock + .5); }
  // 2) 실제 회피 버튼 연타: 회피가 끝나자마자 다시 누른다. 진행 중 탭은 새 회피를 만들지 않아야 한다.
  for (let i = 0; i < 6; i++) {
    const before = await observe();
    await page.locator('#btn-dodge').tap();
    await page.waitForFunction(() => window.app.battle.player.state === 'dodge', null, { timeout: 8000 });
    const during = await observe();
    await page.locator('#btn-dodge').tap();   // 진행 중 탭(무시돼야 함)
    const t0 = await page.evaluate(() => window.app.battle.player.stateT);
    await page.waitForFunction(() => window.app.battle.player.state !== 'dodge', null, { timeout: 8000 });
    const after = await observe();
    report.dodges.push({ i, beforeState: before.state, duringInvuln: during.invuln, duringCd: during.dodgeCd, cdLabelHidden: during.cdLabelHidden,
      stateTAfterSecondTap: t0, endCd: after.dodgeCd, endInvuln: after.invuln, clock: after.clock });
    if (i === 2) await snap('dodge-chain');
  }
  // 3) 실제 공격 버튼을 몇 번 누르고 AUTO 버튼으로 남은 무리를 정리한다.
  for (let i = 0; i < 8; i++) { await page.locator('#btn-attack').tap(); await page.waitForTimeout(160); }
  await page.locator('#btn-auto').tap();
  const firstRoom = (await observe()).room;
  const realStart = Date.now(), gameStart = await clock();
  while (Date.now() - realStart < 720000) {
    const o = await observe();
    if (report.frames.length < 48) { o.file = await snap('auto-' + report.frames.length); report.frames.push(o); }
    if (o.cleared >= 2 || !o.active || o.clock - gameStart > 90) break;
    await waitClock(o.clock + 1.5, 180000).catch(() => {});
  }
  report.end = await observe(); await snap('end');
  report.firstRoom = firstRoom;
  report.peakNear = Math.max(...report.frames.map(f => f.enemies.filter(e => e.d < 7).length));
  report.followersSeen = Math.max(...report.frames.map(f => f.enemies.filter(e => e.follower).length));
  report.pass = report.errors.length === 0 && report.dodges.every(d => d.duringCd === 0 && d.endCd === 0 && d.cdLabelHidden) && report.end.cleared >= 1;
  await ctx.close();
  }
} catch (e) { report.fail = String(e.stack || e).split('\n').slice(0, 5).join(' | '); process.exitCode = 1; }
finally {
  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, errors: report.errors.length, console: report.console.length, dodges: report.dodges.length, peakNear: report.peakNear, end: report.end && { kills: report.end.kills, cleared: report.end.cleared, clock: report.end.clock } }));
  await browser?.close();
}
