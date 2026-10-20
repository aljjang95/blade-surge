// 궁수 연속 동작 런타임 캡처(로컬 루프백 전용, 격리 브라우저 컨텍스트). 실제 앱·실제 Player·실제 카메라·실제 키보드 입력으로
// 고정 스텝(1/60초)을 진행하고 2스텝마다(30fps) 화면을 남긴다. 게임 재생 속도 그대로의 연속 프레임이며, 시퀀스 배치(적 생성·스킬 개방·피해)는
// 진단 픽스처다. 자연 UI 여정·실기기·사람 조작감 증거가 아니다.
//   node tools/art/ranger-motion-capture.mjs <origin> <outDir> [label] [body,…]
//   body 목록(예: hero_ranger_t3,avatar_ranger_fox)을 주면 실제 몸체 교체(applyLibraryHeroBody) 뒤 짧은 시퀀스(달리기·이동 사격·회피→사격·피격)만 찍는다.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launchOpts } from '../chrome.mjs';
const [origin = 'http://127.0.0.1:5761', out = 'work/ranger-motion', label = 'after', bodyList = ''] = process.argv.slice(2);
const bodies = bodyList ? bodyList.split(',') : [];
// RANGER_MOTION_ONLY=07 처럼 주면 그 번호로 시작하는 시퀀스만 찍는다(긴 사망 꼬리 재촬영 등).
const only = process.env.RANGER_MOTION_ONLY || '';
const want = (name) => !only || only.split(',').some((p) => name.startsWith(p));
mkdirSync(out, { recursive: true });
const report = { origin, label, sequences: [], errors: [] };
const browser = await chromium.launch(launchOpts());
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.errors.push(m.text().slice(0, 240)); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 180000 });
  report.setup = await page.evaluate(async () => {
    app.testPause = true; app.ui.closeModal(); app.eco.s.energy = 100; app.eco.s.selected = 'ranger';
    if (!await app.startStage(app.eco.nextStage())) throw Error('stage start failed');
    const b = app.battle, p = b.player; p.auto = false; p.invuln = 1e4; app.companionAgent?.endBattle();
    for (const e of b.enemies) { e.alive = false; e.dead = true; }
    for (let i = 0; i < 60; i++) app.step(1 / 60, false);
    b.projectiles.length = 0;
    const g = p.model.getObjectByName('RangerBowGrip_L');
    return { hero: p.def.id, body: p.model.userData.libraryBodyAssetId || null, clips: Object.keys(p.clips).sort(), grip: !!g };
  });
  await page.evaluate(() => document.activeElement?.blur());
  let seq = null, frame = 0;
  const start = (name, note) => { seq = { name, note, frames: [], dir: out + '/' + name }; mkdirSync(seq.dir, { recursive: true }); frame = 0; report.sequences.push(seq); };
  const state = () => page.evaluate(() => { const p = app.battle.player; const a = p.action;
    return { st: p.state, act: p.actionName, t: a ? +a.time.toFixed(3) : null, yaw: +p.yaw.toFixed(3), shown: Number.isFinite(p._shownYaw) ? +p._shownYaw.toFixed(3) : null,
      x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), held: !!p.bowStringHeld, hp: Math.round(p.hp),
      // 사망 경계 판정용: Actor 가 deathT>1.2 부터 가라앉으므로 클립 시각(t)과 함께 남긴다(사망 전에는 음수).
      deathT: Number.isFinite(p.deathT) ? +p.deathT.toFixed(3) : null, y: +p.pos.y.toFixed(3) }; });
  const step = async (n) => {
    for (let i = 0; i < n; i++) {
      const shot = (frame % 2) === 0;
      await page.evaluate((r) => app.step(1 / 60, r), shot);
      if (shot) {
        await page.screenshot({ path: seq.dir + '/' + String(seq.frames.length).padStart(5, '0') + '.jpg', type: 'jpeg', quality: 82 });
        seq.frames.push(await state());
      }
      frame++;
    }
  };
  const spawn = (dx, dz) => page.evaluate(([dx, dz]) => {
    const b = app.battle, p = b.player, id = Object.keys(window.__EN).find((k) => !window.__EN[k].boss && !window.__EN[k].elite && app.models[window.__EN[k].model]);
    b.spawnEnemy(id, null, b.world?.roomAt(p.pos.x, p.pos.z) || null, { x: p.pos.x + dx, z: p.pos.z + dz });
    const e = b.enemies[b.enemies.length - 1]; e.spawning = false; e.stun = 1e4; e.atkCd = 1e4; e.hp = e.maxHp = 1e7; return !!e;
  }, [dx, dz]);
  const clear = () => page.evaluate(() => { for (const e of app.battle.enemies) { e.alive = false; e.dead = true; } app.step(1 / 60, false); app.battle.projectiles.length = 0; });
  const key = (k, down) => down ? page.keyboard.down(k) : page.keyboard.up(k);
  const tap = async (k) => { await page.keyboard.down(k); await step(1); await page.keyboard.up(k); };

  if (bodies.length) {
    for (const id of bodies) {
      report.swaps = report.swaps || {};
      report.swaps[id] = await page.evaluate(async (id) => {
        const { applyLibraryHeroBody } = await import('/src/engine/assets.js');
        const { default: manifest } = await import('/asset-library/manifest.json');
        const p = app.battle.player, asset = manifest.assets.find((a) => a.id === id);
        let done = applyLibraryHeroBody(p.model, asset, () => { done = true; });
        for (let i = 0; i < 200 && !done; i++) await new Promise((r) => setTimeout(r, 50));
        p.model.userData.onLibraryBodySwap?.();
        return { done, body: p.model.userData.libraryBodyAssetId };
      }, id);
      await clear(); await spawn(-6, 0);
      start('body-' + id, id + ': 달리기 → 후퇴 이동 사격 2회 → 방향 회피→사격 → 강타 피격');
      await key('KeyW', true); await step(40); await key('KeyW', false); await step(10);
      await key('KeyD', true); for (let i = 0; i < 2; i++) { await tap('KeyJ'); await step(26); } await key('KeyD', false); await step(16);
      await key('KeyS', true); await tap('KeyK'); await step(8); await tap('KeyJ'); await key('KeyS', false); await step(36);
      await page.evaluate(() => { const p = app.battle.player; p.invuln = 0; p.hp = p.maxHp; p.hurt(10, { dirx: 1, dirz: 0, kb: 8 }); p.invuln = 1e4; }); await step(36);
    }
    report.pass = report.errors.length === 0 && Object.values(report.swaps).every((s) => s.done);
  } else {
  if (want('01')) {
  start('01-idle-run-stop', '대기 1초 → 오른쪽 달리기 1.2초 → 정지 0.8초 → 위 달리기 0.7초 → 정지');
  await step(60); await key('KeyD', true); await step(72); await key('KeyD', false); await step(48);
  await key('KeyW', true); await step(42); await key('KeyW', false); await step(40);
  }

  await spawn(-6, 0);
  if (want('02')) {
  start('02-stationary-combo', '정지 상태에서 J 연타(5연 콤보), 대상은 왼쪽 6m');
  for (let i = 0; i < 6; i++) { await tap('KeyJ'); await step(17); }
  await step(40);
  }

  if (want('03')) {
  start('03-move-shot-side-retreat', 'D(오른쪽, 대상 반대쪽=후퇴) 누른 채 J 3회 → S(아래, 측면) 누른 채 J 3회');
  await key('KeyD', true); for (let i = 0; i < 3; i++) { await tap('KeyJ'); await step(26); } await key('KeyD', false); await step(20);
  await key('KeyS', true); for (let i = 0; i < 3; i++) { await tap('KeyJ'); await step(26); } await key('KeyS', false); await step(30);
  }

  if (want('04')) {
  start('04-dodge-4dir-shot', '방향 회피 W·A·S·D 각각 → 회피 중 J(회피→사격)');
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { await key(k, true); await tap('KeyK'); await step(8); await tap('KeyJ'); await key(k, false); await step(40); }
  }

  if (want('05')) {
  start('05-backstep-shot', '방향 없는 회피(백스텝) 2회, 두 번째는 J 연계');
  await tap('KeyK'); await step(36); await tap('KeyK'); await step(8); await tap('KeyJ'); await step(40);
  }

  if (want('06')) {
  start('06-skills', '스킬 8종(픽스처: 레벨·MP·쿨타임·궁극 게이지 개방) tryCastSkill 순서 재생');
  await page.evaluate(() => { const p = app.battle.player; p.heroLevel = 99; });
  const skills = await page.evaluate(() => app.battle.player.def.skills.map((s) => s.id));
  for (let i = 0; i < skills.length; i++) {
    await page.evaluate((i) => { const p = app.battle.player; p.mp = p.maxMp = 999; p.cds = p.cds.map(() => 0); p.ult = p.ultMax; p.tryCastSkill(i); }, i);
    await step(66);
  }
  await step(20);
  }

  await clear();
  if (want('07')) {
  start('07-hit-death', '강타 피격(kb 8) 2회 → 사망(픽스처 피해)');
  await page.evaluate(() => { const p = app.battle.player; p.invuln = 0; p.hp = p.maxHp; });
  await page.evaluate(() => app.battle.player.hurt(10, { dirx: 1, dirz: 0, kb: 8 })); await step(40);
  await page.evaluate(() => { const p = app.battle.player; p.invuln = 0; p.hurt(10, { dirx: 0, dirz: 1, kb: 8 }); }); await step(40);
  await page.evaluate(() => { const p = app.battle.player; p.invuln = 0; p.hurt(p.hp + 999, { dirx: 0, dirz: 1, kb: 8 }); }); await step(only ? 260 : 110);
  }

  report.pass = report.errors.length === 0;
  }
} finally {
  await browser.close();
  for (const s of report.sequences) {
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', s.dir + '/%05d.jpg', '-vf', 'drawtext=text=' + "'" + label + ' ' + s.name + "'" + ':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', out + '/' + label + '-' + s.name + '.mp4']);
    } catch (e) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', s.dir + '/%05d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', out + '/' + label + '-' + s.name + '.mp4']);
    }
  }
  writeFileSync(out + '/motion-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ pass: report.pass, setup: report.setup, sequences: report.sequences.map((s) => [s.name, s.frames.length]), errors: report.errors.slice(0, 5) }));
}
