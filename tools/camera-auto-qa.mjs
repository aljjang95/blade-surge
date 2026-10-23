// 전투 카메라 AUTO 전후 비교(c1). 실제 개발 서버·실제 부팅 탭·1/60초 고정 스텝(app.testPause) 프레임.
// 사용: node tools/camera-auto-qa.mjs --out <폴더> [--views 915x412,390x844,844x390]
// 산출(커밋 금지): <out>/<view>/<scene>-<auto|manual>-<t>.png, <out>/metrics.json
// 장면: boss-behind(1-5 보스를 카메라 뒤 9m에 두고 보스가 정상 패턴으로 공격), crowd(1-1 적 6마리를 영웅 둘레 4~10m에 흩뿌림),
//       hold(AUTO 켬, 실제 마우스 오른쪽 드래그 직후 3초 정지 → 복귀).
// 판정: 보스 예고 범위(보스 위치 ± 반경+4.5) 네 점과 영웅이 화면 안(NDC |x|,|y| ≤ 1)에 든 표본 비율, 무리 적의 화면 안 비율, yaw/zoom 궤적.
// 주입: 스테이지 직접 시작, 적 배치, 플레이어 무적, Math.random 시드. 판정·피해·카메라 코드는 건드리지 않는다.
// 이것은 헤드리스 SwiftShader 결과다. 실기기 터치·GPU·손맛 증거가 아니다.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(arg('out', 'work/qa/camera-auto'));
const views = (arg('views') || '915x412,390x844,844x390').split(',').map(v => v.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch(launchOpts());
const report = { origin, started: new Date().toISOString(), scope: 'headless Chromium SwiftShader, fixed 1/60 steps; not device/GPU/feel evidence', views: {}, errors: [] };

const setup = async (page, ch, st) => {
  const ok = await page.evaluate(async ({ ch, st }) => {
    const app = window.app; app.ui.closeModal?.();
    const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 100; e.s.selected = 'knight';
    const h = e.hero('knight'); h.level = 50; h.exp = 0;
    const ex = e.s.expedition; if (ex) { ex.unlockedJobs = []; ex.selectedJob = null; }
    e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
    if (!await app.startStage(window.__stageDef(ch, st))) return false;
    app.companionAgent?.endBattle?.();
    return true;
  }, { ch, st });
  if (!ok) throw Error(`${ch}-${st} 시작 실패`);
  await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 });
  await page.waitForTimeout(400);
  // 세로 화면의 '가로로 돌려주세요' 안내는 실제 버튼으로 닫는다(전투 시작마다 다시 뜰 수 있다).
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.evaluate(() => {
    const app = window.app; app.testPause = true;
    let s = 77; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    window.__measure = () => {
      const r = app.renderer, cam = r.camera, b = app.battle, p = b.player, V = window.__THREE.Vector3;
      cam.updateMatrixWorld();
      const inside = (x, y, z) => { const q = new V(x, y, z).project(cam); return q.z <= 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1; };
      const boss = b.enemies.find(e => e.isBoss && e.alive);
      let bossIn = null;
      if (boss) { const R = boss.radius + 4.5, c = boss.pos; bossIn = [[R, 0], [-R, 0], [0, R], [0, -R]].every(([dx, dz]) => inside(c.x + dx, 0, c.z + dz)); }
      const crowd = b.enemies.filter(e => e.alive && !e.spawning && !e.isBoss);
      return { hero: inside(p.pos.x, 1, p.pos.z), bossIn, crowdIn: crowd.length ? crowd.filter(e => inside(e.pos.x, .8, e.pos.z)).length / crowd.length : null,
        yaw: +r.battleCamera.yaw.toFixed(2), pitch: +r.battleCamera.pitch.toFixed(2), zoom: +r.battleCamera.zoom.toFixed(2) };
    };
    window.__run = (frames, every) => { const rows = []; for (let i = 0; i < frames; i++) { app.step(1 / 60, i % every === every - 1 || i === frames - 1); if (i % every === every - 1) rows.push(window.__measure()); } return rows; };
  });
};

const summarize = rows => ({ samples: rows.length,
  heroIn: rows.filter(r => r.hero).length / rows.length,
  bossIn: rows.some(r => r.bossIn !== null) ? rows.filter(r => r.bossIn).length / rows.filter(r => r.bossIn !== null).length : null,
  crowdIn: rows.some(r => r.crowdIn !== null) ? +(rows.reduce((s, r) => s + (r.crowdIn ?? 0), 0) / rows.filter(r => r.crowdIn !== null).length).toFixed(3) : null,
  first: rows[0], last: rows[rows.length - 1] });

try {
  for (const [width, height] of views) {
    const key = `${width}x${height}`, dir = path.join(out, key); await fs.mkdir(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(key + ' ' + String(e).slice(0, 300)));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
    await page.addStyleTag({ content: '#dmg-layer{visibility:hidden!important}' });
    const result = report.views[key] = {};
    for (const scene of ['boss-behind', 'crowd']) for (const mode of ['manual', 'auto']) {
      await setup(page, scene === 'boss-behind' ? 1 : 1, scene === 'boss-behind' ? 5 : 1);
      await page.evaluate(({ scene, mode }) => {
        const app = window.app, b = app.battle, p = b.player, V = window.__THREE.Vector3;
        app.eco.s.settings.cameraAuto = mode === 'auto';
        p.invuln = 1e9; p.hp = p.maxHp; p.auto = false; app.input.clear();
        const o = p.pos.clone();
        if (scene === 'boss-behind') {
          let boss = b.enemies.find(e => e.isBoss && e.alive);
          if (!boss) boss = b.spawnEnemy(app.battle.stage.dungeonBossId || app.battle.stage.encounter.enemyId, null, null, o.clone().add(new V(3, 0, 9)));
          for (const e of b.enemies) if (e !== boss) { e.update = () => {}; e.pos.set(o.x + 5000, 0, o.z + 5000); }
          boss.spawning = false; boss.hp = boss.maxHp = 1e12; boss.pos.set(o.x + 3, 0, o.z + 9); boss.atkCd = 0;
        } else {
          // 무리는 제자리에 고정한다(쫓아와 뭉치면 퍼짐 비교가 안 된다).
          const ring = [[4, -3], [-6, -4], [8, 2], [-5, 6], [2, 9], [-9, -1]];
          for (const e of b.enemies) { e.update = () => {}; e.pos.set(o.x + 5000, 0, o.z + 5000); }
          for (const [dx, dz] of ring) b.spawnEnemy('skel_minion', null, null, new V(o.x + dx, 0, o.z + dz));
          let i = 0;
          for (const e of b.enemies) if (e.pos.x < o.x + 1000 && i < ring.length) { e.pos.set(o.x + ring[i][0], 0, o.z + ring[i][1]); e.spawning = false; e.hp = e.maxHp = 1e12; e.update = () => {}; i++; }
        }
        app.cameraControls.reset();
        if (mode === 'manual') app.cameraControls.auto.interrupt();
      }, { scene, mode });
      const rows = [];
      for (const [ti, frames] of [30, 150, 300].entries()) {
        rows.push(...await page.evaluate(n => window.__run(n, 6), frames));
        await fs.writeFile(path.join(dir, `${scene}-${mode}-${['0.5s', '3s', '8s'][ti]}.png`), await page.screenshot());
      }
      result[`${scene}-${mode}`] = summarize(rows);
      await page.evaluate(() => { window.app.testPause = false; window.app.toLobby?.(); });
      await page.waitForTimeout(600);
      console.error(key, scene, mode, JSON.stringify(result[`${scene}-${mode}`]).slice(0, 220));
    }
    // 실제 입력: 오른쪽 드래그 직후 AUTO 가 멈췄다가 무입력 뒤에 복귀하는지.
    if (width > height) {
      await setup(page, 1, 5);
      await page.evaluate(() => { const app = window.app, b = app.battle, p = b.player; app.eco.s.settings.cameraAuto = true; p.invuln = 1e9; const boss = b.enemies.find(e => e.isBoss && e.alive); if (boss) { boss.spawning = false; boss.hp = boss.maxHp = 1e12; boss.pos.set(p.pos.x + 3, 0, p.pos.z + 9); } app.cameraControls.reset(); });
      await page.mouse.move(width * .55, height * .3); await page.mouse.down({ button: 'right' }); await page.mouse.move(width * .7, height * .32, { steps: 6 }); await page.mouse.up({ button: 'right' });
      const afterDrag = await page.evaluate(() => window.__measure());
      const held = await page.evaluate(() => window.__run(60 * 3, 30));
      const resumed = await page.evaluate(() => window.__run(60 * 4, 30));
      result.hold = { afterDrag, heldYawSpread: Math.max(...held.map(r => r.yaw)) - Math.min(...held.map(r => r.yaw)), resumedLast: resumed[resumed.length - 1], button: await page.locator('#battle-camera-auto').textContent().catch(() => null) };
      await fs.writeFile(path.join(dir, 'hold-resumed.png'), await page.screenshot());
      await page.evaluate(() => { window.app.testPause = false; window.app.toLobby?.(); });
      console.error(key, 'hold', JSON.stringify(result.hold));
    }
    await context.close();
  }
} finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
