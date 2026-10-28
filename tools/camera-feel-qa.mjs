// 전투 카메라 체감 계측(전후 비교용). 실제 개발 서버·실제 부팅·AUTO 전투(영웅 자동 조작)·1/60초 고정 스텝·시드 고정.
// 사용: node tools/camera-feel-qa.mjs --out <폴더> [--view 844x390] [--scenes 1-1,2-4,7-10b] [--seconds 14] [--video 1]
// 장면: 'c-s'는 일반 진행 전투, 끝에 b 가 붙으면 봉인을 풀고 보스방 문 앞에서 시작해 보스전을 잰다.
// 산출(커밋 금지): <out>/<scene>.mp4(--video), <out>/<scene>-*.png, <out>/metrics.json
// 지표: 카메라 방위(yaw) 이동량·최대 회전 속도, 영웅까지 거리·FOV 의 변동 폭(줌 펌핑), 영웅 화면 위치의 중심 이탈,
//       영웅 화면 위치의 프레임간 급변(카메라가 시선을 빼앗는 순간), 화면 안 적 비율.
// 주입: 스테이지 직접 시작, 영웅 무적·레벨, Math.random 시드. 판정·피해·카메라 코드는 건드리지 않는다.
// 헤드리스 SwiftShader 결과다. 실기기 터치·GPU·손맛 증거가 아니다.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(arg('out', 'work/qa/camera-feel'));
const [width, height] = arg('view', '844x390').split('x').map(Number);
const scenes = arg('scenes', '1-1,2-4,7-10b').split(',');
const seconds = Number(arg('seconds', '14'));
const hero = arg('hero', 'knight');
const video = arg('video', '1') !== '0';
const every = 3;   // 20fps 촬영
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch(launchOpts());
const report = { origin, view: `${width}x${height}`, hero, seconds, scope: 'headless Chromium SwiftShader, fixed 1/60 steps, seeded; not device/GPU/feel evidence', scenes: {}, errors: [] };

const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const round = (v, n = 3) => Number.isFinite(v) ? +v.toFixed(n) : null;
function summarize(rows) {
  const dt = 1 / 60;
  let yawTravel = 0, maxYawRate = 0;
  const yawRates = [], screenJumps = [];
  for (let i = 1; i < rows.length; i++) {
    let dy = rows[i].camYaw - rows[i - 1].camYaw; dy = ((dy + 180) % 360 + 360) % 360 - 180;
    yawTravel += Math.abs(dy); const rate = Math.abs(dy) / dt; yawRates.push(rate); maxYawRate = Math.max(maxYawRate, rate);
    screenJumps.push(Math.hypot(rows[i].heroX - rows[i - 1].heroX, rows[i].heroY - rows[i - 1].heroY));
  }
  const dist = rows.map(r => r.dist), fov = rows.map(r => r.fov), off = rows.map(r => Math.hypot(r.heroX - r.centerX, r.heroY - r.centerY));
  const inCombat = rows.filter(r => r.near > 0);
  return {
    frames: rows.length, combatFrames: inCombat.length,
    yawTravelDeg: round(yawTravel, 1), maxYawRateDegPerSec: round(maxYawRate, 1), p95YawRateDegPerSec: round(pct(yawRates, .95), 1),
    distRange: round(Math.max(...dist) - Math.min(...dist)), distMin: round(Math.min(...dist)), distMax: round(Math.max(...dist)),
    fovRange: round(Math.max(...fov) - Math.min(...fov), 2),
    heroOffCenterP95: round(pct(off, .95)), heroOffCenterMax: round(Math.max(...off)),
    heroScreenJumpP99: round(pct(screenJumps, .99), 4), heroScreenJumpMax: round(Math.max(...screenJumps), 4),
    enemiesOnScreen: inCombat.length ? round(inCombat.reduce((s, r) => s + r.onScreen, 0) / inCombat.length) : null,
    bossFrames: rows.filter(r => r.boss).length,
  };
}

try {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e).slice(0, 300)));
  await installAutoStarter(page);
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
  for (const scene of scenes) {
    const boss = scene.endsWith('b'), [ch, st] = scene.replace(/b$/, '').split('-').map(Number);
    const ok = await page.evaluate(async ({ ch, st, hero }) => {
      const app = window.app; app.ui.closeModal?.();
      const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 100; e.s.selected = hero;
      const h = e.hero(hero); h.level = Math.max(h.level || 1, 60); h.exp = 0;
      const ex = e.s.expedition; if (ex) { ex.unlockedJobs = []; ex.selectedJob = null; }
      e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
      e.s.settings.cameraAuto = true;
      if (!await app.startStage(window.__stageDef(ch, st))) return false;
      app.companionAgent?.endBattle?.();
      return true;
    }, { ch, st, hero });
    if (!ok) { report.errors.push(`${scene} 시작 실패`); continue; }
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 });
    await page.waitForTimeout(300);
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.evaluate(({ boss }) => {
      const app = window.app, b = app.battle, p = b.player;
      app.testPause = true;
      let s = 77; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      p.invuln = 1e9; p.auto = true; app.input.clear();
      app.cameraControls?.reset?.(); app.cameraControls?.auto?.resume?.();
      if (boss && b.world?.bossRoom) {
        // 봉인 해제 포탈과 같은 자리(보스방 문 바깥)에서 보스방을 목표로 시작한다.
        const W = b.world, B = W.bossRoom, g = W.gates[0];
        for (const e of b.enemies) if (!e.isBoss) { e.hp = 0; e.alive = false; e.dead = true; }
        W.unseal?.(); b.arena.openSeal?.(b.fx); b.bossRush = true; b.autoTarget = B; B.discovered = true;
        if (g) { const dx = g.x - B.x, dz = g.z - B.z, l = Math.hypot(dx, dz) || 1; p.pos.set(g.x + dx / l * 3.5, 0, g.z + dz / l * 3.5); }
        const rig = app.renderer.rig; rig.target.copy(p.pos); rig.pos.copy(p.pos).add(rig.offset);
      }
      const V = window.__THREE.Vector3, q = new V(), fwd = new V();
      window.__feel = { rows: [] };
      window.__sample = () => {
        const r = app.renderer, cam = r.camera, bb = app.battle, pl = bb.player;
        cam.updateMatrixWorld();
        cam.getWorldDirection(fwd);
        q.set(pl.pos.x, (pl.pos.y || 0) + 1, pl.pos.z).project(cam);
        const heroX = q.x, heroY = q.y;
        // 화면 구도의 기준점: 카메라가 바라보는 점(rig.target + lookOffset)의 투영.
        q.copy(r.rig.target).add(r.rig.lookOffset).project(cam);
        let near = 0, onScreen = 0;
        for (const e of bb.enemies) {
          if (!e.alive || e.spawning || !e.pos) continue;
          if (Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z) > 12) continue;
          near++; const v = new V(e.pos.x, .8, e.pos.z).project(cam);
          if (v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) onScreen++;
        }
        window.__feel.rows.push({ t: +bb.elapsed.toFixed(3), camYaw: Math.atan2(fwd.x, fwd.z) * 180 / Math.PI, dist: cam.position.distanceTo(pl.pos), fov: cam.fov,
          heroX, heroY, centerX: q.x, centerY: q.y, near, onScreen: near ? onScreen / near : 1, boss: !!(bb.boss?.alive && !bb.boss.spawning) });
      };
      window.__run = (frames, renderLast) => { for (let i = 0; i < frames; i++) { app.step(1 / 60, !renderLast || i === frames - 1); window.__sample(); } };
    }, { boss });
    const dir = path.join(out, scene + '-frames'); await fs.mkdir(dir, { recursive: true });
    const total = Math.round(seconds * 60);
    for (let f = 0, k = 0; f < total; f += every, k++) {
      await page.evaluate(n => window.__run(n, true), every);
      if (video) await fs.writeFile(path.join(dir, String(k).padStart(4, '0') + '.png'), await page.screenshot());
    }
    const rows = await page.evaluate(() => window.__feel.rows);
    report.scenes[scene] = summarize(rows);
    await fs.writeFile(path.join(out, scene + '-rows.json'), JSON.stringify(rows));
    if (video) {
      const mp4 = path.join(out, scene + '.mp4');
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(60 / every), '-i', path.join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', mp4]);
      if (r.status !== 0) report.errors.push(`${scene} ffmpeg ${String(r.stderr).slice(0, 200)}`);
    }
    console.error(scene, JSON.stringify(report.scenes[scene]));
    await page.evaluate(() => { window.app.testPause = false; window.app.toLobby?.(); });
    await page.waitForTimeout(800);
  }
  await context.close();
} finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
