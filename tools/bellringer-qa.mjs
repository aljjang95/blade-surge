/**
 * 7장 종탑 도시 런타임 QA — 실제 빌드에서 7-1 출격, 종지기(bellringer)의 예고→고리 충격파→피해, 회피 무적, 종 파괴 기절,
 * 최종 보스 세 박자 종소리(겹치는 한가운데만 안전)를 단언하고 단계별 화면을 남긴다.
 *   node tools/bellringer-qa.mjs [출력폴더=work/qa/bellringer]
 * 전제: bun run build 산출물(dist). 고정 dt(1/60) 진행이며 실기기 입력·GPU 프레임 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4295, OUT = resolve(PROJ, process.argv[2] || 'work/qa/bellringer');
const VIEWPORT = { width: 844, height: 390 };
mkdirSync(OUT, { recursive: true });
const build = JSON.parse(readFileSync(resolve(PROJ, 'dist/version.json'), 'utf8'));
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: VIEWPORT })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
// 미리보기 서버에는 Worker API 가 없어 /api/* 404 는 정상이다. 그 밖의 4xx·5xx 는 오류로 센다.
page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };
// 7-1 에서 시작 위치 +8m 에 적을 놓고 다른 적은 치운다. 화면 크기와 시계(개방 시각)는 호출 쪽이 정한다.
const enterStage = async (st = 1) => page.evaluate(async (st) => {
  const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = 60 + st; e.save();
  a.battle?.stop?.();
  const stage = e.nextStage();
  await a.startStage(stage); a.testPause = true;
  const b = a.battle, p = b.player; p.auto = false;
  for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
  p.hp = p.maxHp; p.invuln = 0;
  return { code: stage.code, dungeon: stage.dungeon?.id, theme: stage.chapter?.theme, active: b.active };
}, st);
try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());

  // 1) 7-1 출격과 화면
  const entered = await enterStage(1);
  check('7-1 출격(종탑 경로, crypt 테마)', entered.code === '7-1' && entered.active && entered.dungeon === 'bellstreet' && entered.theme === 'crypt', entered);
  await page.screenshot({ path: `${OUT}/01-stage-7-1.png` });

  // 2) 종지기: 예고 → 첫 고리 → 두 번째 고리 → 피해(가만히 선 플레이어)
  await page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player;
    window.__r = b.spawnEnemy('bell_ringer', null, b.curRoom, p.pos.clone().add(new p.pos.constructor(8, 0, 0)));
    window.__hp0 = p.hp;
  });
  const timeline = await page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player, en = window.__r, out = [];
    const bell = en.bellringer;
    let phase = null;
    for (let k = 0; k < 900; k++) {
      a.step(1 / 60, false);
      if (bell.phase !== phase) { out.push({ k, phase: bell.phase, tele: +(en.telegraph || 0).toFixed(2), special: en.special, vx: +en.vel.length().toFixed(2) }); phase = bell.phase; }
      if (bell.tolls > 0 && !bell.busy && p.hp < window.__hp0) { out.push({ k, event: 'done', hits: bell.hits, hpLost: window.__hp0 - p.hp }); break; }
    }
    a.step(1 / 60, true);
    return out;
  });
  const toll = timeline.find((x) => x.phase === 'toll'), recover = timeline.find((x) => x.phase === 'recover'), done = timeline.find((x) => x.event === 'done');
  check('종지기: 예고(toll) → 고리(recover) → 종료 순서', !!(toll && recover && done) && timeline.indexOf(toll) < timeline.indexOf(recover), timeline);
  check('종지기: 예고 중 제자리·예고 링 표시', !!toll && toll.special === 'bell' && toll.vx === 0 && toll.tele > 0, toll);
  check('종지기: 서 있는 플레이어는 고리 두 겹에 맞는다', !!done && done.hits === 2 && done.hpLost > 0, done);
  // 고리가 화면에 그려지는 순간을 찍는다.
  await page.evaluate(async () => {
    const a = window.app, b = a.battle, p = b.player, en = window.__r; p.hp = p.maxHp; en.bellringer.cd = 0; p.invuln = 0;
    p.pos.x = en.pos.x + 9;
    for (let k = 0; k < 400 && !en.bellringer.ringing; k++) a.step(1 / 60, false);
    for (let k = 0; k < 40; k++) a.step(1 / 60, k === 39);
  });
  const shot = await page.evaluate(() => { const r = window.__r.bellringer; return { ringing: r.ringing, r0: +r.rings[0].r.toFixed(2), meshVisible: !!r.rings[0].mesh?.visible }; });
  check('종지기: 고리 충격파가 그려진다', shot.ringing && shot.meshVisible && shot.r0 > 1.4, shot);
  await page.screenshot({ path: `${OUT}/02-ring-wave.png` });

  // 3) 회피 무적: 고리가 지나갈 때 무적이면 피해가 없다
  const dodged = await page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player, en = window.__r; p.hp = p.maxHp; const hp0 = p.hp;
    for (let k = 0; k < 600 && en.bellringer.busy; k++) { p.invuln = 1; a.step(1 / 60, false); }
    en.bellringer.cd = 0; en.stun = 0; p.pos.x = en.pos.x + 7;
    let saw = false, attempts = 0;
    for (let k = 0; k < 800; k++) { p.invuln = 1; a.step(1 / 60, false); saw ||= en.bellringer.ringing; if (saw && !en.bellringer.busy) break; }
    a.step(1 / 60, true);
    return { saw, hpLost: hp0 - p.hp, attempts };
  });
  check('종지기: 회피 무적으로 지나가면 피해 0', dodged.saw && dodged.hpLost === 0, dodged);

  // 4) 종 파괴: 종이 피해를 먼저 받고, 깨지면 주변 적 2초 기절 + 종지기 무방비
  const shatter = await page.evaluate(() => {
    const a = window.app, b = a.battle, p = b.player, en = window.__r;
    const mate = b.spawnEnemy('skel_minion', null, b.curRoom, en.pos.clone().add(new en.pos.constructor(2.5, 0, 0)));
    mate.stun = 0; mate.spawning = false;
    const hp0 = en.hp; en.hurt(en.bellringer.bellHp * .5, { kb: 0 });
    const bodyIntact = en.hp === hp0;
    en.hurt(en.bellringer.bellHp + 5, { kb: 0 });
    return { bodyIntact, intact: en.bellringer.intact, mateStun: +mate.stun.toFixed(2), exposedStun: +en.stun.toFixed(2), bellHidden: !en.bellringer.bell.visible, texts: null };
  });
  check('종 파괴: 몸은 그대로 → 파괴 → 주변 적 2초 기절·종지기 무방비', shatter.bodyIntact && !shatter.intact && shatter.mateStun >= 1.9 && shatter.exposedStun >= 1.9 && shatter.bellHidden, shatter);
  await page.screenshot({ path: `${OUT}/03-bell-shattered.png` });

  // 5) 최종 보스 세 박자 종소리: 한가운데는 안전, 바깥은 맞는다
  const bossRun = async (offset) => {
    await enterStage(10);
    return page.evaluate((offset) => {
      const a = window.app, b = a.battle, p = b.player;
      const boss = b.spawnEnemy('belltower_finalboss', null, b.curRoom, p.pos.clone());
      const room = boss.homeRoom || b.curRoom;
      boss.spawning = false; boss.state = 'chase'; boss.stateT = 99; boss.atkCd = 0; boss.hp = boss.maxHp;
      p.hp = p.maxHp; p.invuln = 0; p.pos.set(room.x + offset[0], 0, room.z + offset[1]);
      boss.pos.set(room.x - 8, 0, room.z - 8);
      boss.startAttack(8);
      const key = boss.special, plan = boss.signatures?.plan;
      let tele = 0;
      for (let k = 0; k < 600 && boss.state === 'attack'; k++) { a.step(1 / 60, false); tele = Math.max(tele, boss.signatures?.warnings().length || 0); }
      a.step(1 / 60, true);
      return { key, events: plan?.events.map((e) => e.type), tele, hpLost: p.maxHp - p.hp, phase: boss.phase };
    }, offset);
  };
  const center = await bossRun([0, 0]);
  check('최종 보스: 세 박자 종소리 선택·고리 3개+마지막 울림', center.key === 'bell_threefold' && center.events?.join() === 'ring,ring,ring,disk' && center.tele > 0, center);
  check('최종 보스: 겹치는 한가운데는 안전', center.hpLost === 0, center);
  await page.screenshot({ path: `${OUT}/04-boss-center-safe.png` });
  const outer = await bossRun([9, 0]);
  check('최종 보스: 바깥은 고리나 마지막 울림에 맞는다', outer.hpLost > 0, outer);
  await page.screenshot({ path: `${OUT}/05-boss-outer-hit.png` });
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), build, viewport: VIEWPORT, results, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
