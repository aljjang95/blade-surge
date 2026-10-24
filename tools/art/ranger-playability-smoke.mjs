// 수동 궁수 실제 입력 스모크(로컬 루프백 전용, 격리 저장). 실제 앱·실제 키보드 입력·고정 스텝 전투로
// 측면 이동 사격, 후퇴 사격, 회피→사격, 대상 없음, AUTO 를 관측하고 화면을 남긴다. 물리 기기·사람 플레이 증거가 아니다.
//   node tools/art/ranger-playability-smoke.mjs <origin> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';
const [origin = 'http://127.0.0.1:5761', out = 'work/ranger-smoke'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const report = { origin, checks: [], errors: [], samples: {} };
const check = (ok, name, evidence) => { report.checks.push({ name, pass: !!ok, evidence }); if (!ok) console.log('FAIL', name, JSON.stringify(evidence)); };
const browser = await chromium.launch(launchOpts());
try {
  const context = await browser.newContext({ viewport: { width: 880, height: 400 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.errors.push(m.text().slice(0, 240)); });
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  const setup = await page.evaluate(async () => {
    app.testPause = true; app.ui.closeModal(); app.eco.s.energy = 100; app.eco.s.selected = 'ranger';
    if (!await app.startStage(app.eco.nextStage())) throw Error('stage start failed');
    const b = app.battle, p = b.player; p.auto = false; p.invuln = 1e4; app.companionAgent?.endBattle();
    for (let i = 0; i < 90; i++) app.step(1 / 60, i === 89);
    return { hero: p.def.id, revision: p.model.getObjectByName('RangerBowGrip_L') ? 'ranger-library-v1' : null, strings: !!p.model.getObjectByName('Bow_String_Upper'),
      upperClip: !!p.clips.RangerBowUpper, room: b.world?.rooms?.length };
  });
  check(setup.hero === 'ranger' && setup.revision && setup.strings && setup.upperClip, 'manual ranger spawned with corrected rig', setup);
  // 플레이어 근처에 조준 대상 둘을 실제 적 생성 경로로 만든다(전투 하네스 준비. 게임 플레이 중 순간이동이 아니다).
  const spawn = (dx, dz) => page.evaluate(([dx, dz]) => {
    const b = app.battle, p = b.player, id = Object.keys(window.__EN).find((k) => !window.__EN[k].boss && !window.__EN[k].elite && app.models[window.__EN[k].model]);
    const before = b.enemies.length; b.spawnEnemy(id, null, b.world?.roomAt(p.pos.x, p.pos.z) || null, { x: p.pos.x + dx, z: p.pos.z + dz });
    const e = b.enemies[b.enemies.length - 1]; if (b.enemies.length === before) return null;
    e.spawning = false; e.stun = 1e4; e.atkCd = 1e4; return { id, x: e.pos.x - p.pos.x, z: e.pos.z - p.pos.z };
  }, [dx, dz]);
  const step = (n, render = false) => page.evaluate(([n, render]) => { for (let i = 0; i < n; i++) app.step(1 / 60, render && i === n - 1); }, [n, render]);
  const state = () => page.evaluate(() => { const p = app.battle.player, t = p.rangerAim?.target;
    return { state: p.state, yaw: p.yaw, x: p.pos.x, z: p.pos.z, hitDone: p.hitDone, action: p.actionName, held: !!p.bowStringHeld, legs: !!p._bowLegs?.on, legRate: p._bowLegs?.run.timeScale ?? null,
      target: t ? { x: t.pos.x, z: t.pos.z } : null, arrows: app.battle.projectiles.filter((a) => a.owner === p).map((a) => ({ x: a.dir.x, z: a.dir.z, t: a.t })) }; });
  const clearEnemies = () => page.evaluate(() => { for (const e of app.battle.enemies) { e.alive = false; e.dead = true; } app.step(1 / 60, false); app.battle.projectiles.length = 0; });
  const angleTo = (s) => s.target ? Math.abs(Math.atan2(Math.sin(s.yaw - Math.atan2(s.target.x - s.x, s.target.z - s.z)), Math.cos(s.yaw - Math.atan2(s.target.x - s.x, s.target.z - s.z)))) : null;

  await clearEnemies();
  const left = await spawn(-6, 0);
  check(!!left, 'enemy spawned through battle.spawnEnemy', left);
  await page.evaluate(() => document.activeElement?.blur());
  // 1) 실제 키보드: D(이동) 누른 채 J(공격)
  await page.keyboard.down('KeyD'); await step(18);
  const s0 = await state();
  await page.keyboard.down('KeyJ'); await step(2); await page.keyboard.up('KeyJ');
  const s1 = await state(); await step(8, true);
  const draw = await state(); await page.screenshot({ path: out + '/ranger-move-shot-draw.png' });
  for (let i = 0; i < 40; i++) { await step(1); const s = await state(); if (s.hitDone) break; }
  const rel = await state(); await step(1, true); await page.screenshot({ path: out + '/ranger-move-shot-release.png' });
  await page.keyboard.up('KeyD');
  report.samples.sideways = { s0, s1, draw, rel };
  check(s1.state === 'attack' && angleTo(s1) < .05, 'sideways move + attack aims at the left target', { yawErr: angleTo(s1), s1 });
  check(draw.held && draw.legs && draw.x !== s1.x, 'string held by right hand while legs run during draw', draw);
  check(rel.arrows.length === 1 && Math.hypot(rel.arrows[0].x - (rel.target.x - rel.x) / Math.hypot(rel.target.x - rel.x, rel.target.z - rel.z), rel.arrows[0].z - (rel.target.z - rel.z) / Math.hypot(rel.target.x - rel.x, rel.target.z - rel.z)) < .05, 'single arrow released toward target', rel.arrows);
  await step(60);
  // 2) 후퇴 사격: 적 반대 방향으로 이동하며 공격
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyJ'); await step(2); await page.keyboard.up('KeyJ');
  await step(10, true); const back = await state(); await page.screenshot({ path: out + '/ranger-retreat-shot.png' });
  await page.keyboard.up('KeyD'); await step(60);
  report.samples.retreat = back;
  check(back.state === 'attack' && back.legRate !== null, 'retreat shot keeps aim and layered legs', back);
  // 3) 회피 → 사격
  await page.keyboard.down('KeyW'); await page.keyboard.press('KeyK'); await step(3); await page.keyboard.press('KeyJ');
  const dodge = []; for (let i = 0; i < 30; i++) { await step(1); dodge.push(await state()); if (dodge.at(-1).state === 'attack') break; }
  await page.keyboard.up('KeyW'); await step(1, true); await page.screenshot({ path: out + '/ranger-dodge-shot.png' });
  const ds = dodge.at(-1); report.samples.dodge = dodge.map((d) => d.state).join(',');
  check(ds.state === 'attack' && angleTo(ds) < .08, 'dodge cancels into an aimed shot', { last: ds, seq: report.samples.dodge });
  await step(80);
  // 4) 대상 없음: 기존 방향 유지
  await clearEnemies();
  const none0 = await state(); await page.keyboard.press('KeyJ'); await step(30);
  const none1 = await state();
  report.samples.none = { none0, none1 };
  check(none1.target === null && Math.abs(none1.yaw - none0.yaw) < 1e-6 && none1.arrows.length >= 1, 'no target keeps facing and still fires', { none0: none0.yaw, none1: none1.yaw, arrows: none1.arrows.length });
  // 5) AUTO 는 기존 경로
  await spawn(0, 5);
  const auto = await page.evaluate(() => { const p = app.battle.player; p.auto = true; for (let i = 0; i < 120; i++) app.step(1 / 60, i === 119); return { action: p.actionName, state: p.state, layered: p.actionName === 'RangerBowUpper' }; });
  await page.screenshot({ path: out + '/ranger-auto.png' });
  check(!auto.layered, 'AUTO does not use the manual layered shot', auto);
  check(report.errors.length === 0, 'no page errors', report.errors);
} finally {
  await browser.close();
  report.pass = report.checks.every((c) => c.pass);
  writeFileSync(out + '/ranger-smoke-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.map((c) => (c.pass ? 'PASS ' : 'FAIL ') + c.name), errors: report.errors.slice(0, 5) }));
}


