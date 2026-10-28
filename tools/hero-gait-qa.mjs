// 영웅 걸음 발끝 방위 계측 + 클로즈업 녹화(팔자걸음 전후 비교). 실제 개발 서버·실제 몸체 GLB·실제 달리기 클립·1/60초 고정 스텝.
// 사용: node tools/hero-gait-qa.mjs --out <폴더> [--heroes knight,barbarian,mage] [--view 844x390] [--video 1]
// 지표: 이동 중 접지 구간(발끝 본이 가장 낮은 높이 +3cm 이내)에서 발목→발끝 본 수평 방위가 영웅 진행 방향과 이루는 각(바깥 +, 도).
// 주입: 스테이지 직접 시작, 적 제거, 영웅 무적, 원 궤적 이동 입력(input.move). 헤드리스 SwiftShader 결과이며 실기기 손맛 증거가 아니다.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(arg('out', 'work/qa/hero-gait'));
const [width, height] = arg('view', '844x390').split('x').map(Number);
const heroes = arg('heroes', 'knight,barbarian,mage').split(',');
const video = arg('video', '1') !== '0';
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch(launchOpts());
const report = { origin, view: `${width}x${height}`, scope: 'headless Chromium SwiftShader, fixed 1/60 steps; bone-based foot yaw, not device evidence', heroes: {}, errors: [] };
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
  for (const hero of heroes) {
    const ok = await page.evaluate(async hero => {
      const app = window.app; app.ui.closeModal?.();
      const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 100; e.s.selected = hero; e.s.settings.cameraAuto = false;
      const h = e.hero(hero); h.owned = true; h.level = Math.max(h.level || 1, 30);
      if (!await app.startStage(window.__stageDef(1, 1))) return false;
      app.companionAgent?.endBattle?.();
      return true;
    }, hero);
    if (!ok) { report.errors.push(hero + ' 시작 실패'); continue; }
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player?.model && window.app.battle.elapsed > .3, null, { timeout: 90000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    const info = await page.evaluate(() => {
      const app = window.app, b = app.battle, p = b.player, V = window.__THREE.Vector3;
      app.testPause = true;
      for (const e of b.enemies) { e.update = () => {}; e.pos.set(5000, 0, 5000); }
      p.invuln = 1e9; p.auto = false;
      app.cameraControls?.set?.({ yaw: 0, pitch: 4, zoom: 140 });
      let body = null; p.model.traverse(n => { if (!body && n.isSkinnedMesh && n.skeleton?.bones.some(x => x.name === 'mixamorigLeftFoot')) body = n; });
      const bone = name => body?.skeleton.bones.find(x => x.name === name);
      const parts = { L: [bone('mixamorigLeftFoot'), bone('mixamorigLeftToe_End')], R: [bone('mixamorigRightFoot'), bone('mixamorigRightToe_End')] };
      const a = new V(), c = new V();
      window.__gait = { rows: [] };
      window.__gaitStep = (frames, t0) => {
        for (let i = 0; i < frames; i++) {
          const t = t0 + i / 60, ang = t * .9;   // 반경 넓은 원을 돌며 계속 달린다(방향 전환이 완만해 접지 측정이 안정적이다)
          // 실제 조이스틱과 같은 경로(screenMove → 카메라 기준 변환)로 넣는다.
          app.input.joy.active = true; app.input.screenMove.x = Math.cos(ang); app.input.screenMove.y = Math.sin(ang);
          app.step(1 / 60, false);
          const vx = p.vel?.x || 0, vz = p.vel?.z || 0, sp = Math.hypot(vx, vz);
          p.model.updateMatrixWorld(true);
          const row = { sp };
          for (const [s, sg] of [['L', 1], ['R', -1]]) {
            const [f, toe] = parts[s]; if (!f || !toe) continue;
            f.getWorldPosition(a); toe.getWorldPosition(c); c.sub(a);
            // 진행 방향 기준 바깥(+) 각도. 왼발은 진행 방향의 왼쪽이 바깥이다.
            const fx = vx / (sp || 1), fz = vz / (sp || 1), lx = fz, lz = -fx;   // 진행 방향 왼쪽 단위벡터(+Y 위, 오른손 좌표)
            const fwd = c.x * fx + c.z * fz, lat = c.x * lx + c.z * lz;
            row[s] = { yaw: Math.atan2(lat * sg, fwd) * 180 / Math.PI, toeY: a.y + c.y };
          }
          window.__gait.rows.push(row);
        }
      };
      // 클로즈업: 영웅 진행 방향 앞쪽 비스듬히 낮게(발이 보이게) 카메라를 두고 한 장 그린다. 게임 카메라 상태(rig)는 건드리지 않는다.
      const cam = app.renderer.camera, eye = new V(), look = new V();
      window.__gaitShot = () => {
        const vx = p.vel?.x || 0, vz = p.vel?.z || 0, sp = Math.hypot(vx, vz) || 1, fx = vx / sp, fz = vz / sp;
        const saved = cam.position.clone(), savedQ = cam.quaternion.clone(), fov = cam.fov;
        eye.set(p.pos.x + fx * 3.4 - fz * 1.6, 1.5, p.pos.z + fz * 3.4 + fx * 1.6); look.set(p.pos.x, .55, p.pos.z);
        cam.position.copy(eye); cam.fov = 38; cam.updateProjectionMatrix(); cam.lookAt(look); cam.updateMatrixWorld();
        app.renderer.render();
        cam.position.copy(saved); cam.quaternion.copy(savedQ); cam.fov = fov; cam.updateProjectionMatrix();
      };
      return { bones: !!(parts.L[0] && parts.L[1] && parts.R[0] && parts.R[1]) };
    });
    report.heroes[hero] = { bones: info.bones };
    const dir = path.join(out, hero + '-frames'); await fs.mkdir(dir, { recursive: true });
    const total = 6 * 60, every = 2;
    for (let f = 0, k = 0; f < total; f += every, k++) {
      await page.evaluate(([n, t0]) => window.__gaitStep(n, t0), [every, f / 60]);
      if (video && f >= 60) await page.evaluate(() => window.__gaitShot());
      if (video && f >= 60) await fs.writeFile(path.join(dir, String(k).padStart(4, '0') + '.png'), await page.screenshot());
    }
    const rows = (await page.evaluate(() => window.__gait.rows)).slice(60).filter(r => r.sp > 2 && r.L && r.R);
    const stat = side => {
      const minY = Math.min(...rows.map(r => r[side].toeY));
      const stance = rows.filter(r => r[side].toeY - minY < .03).map(r => r[side].yaw);
      const mean = stance.reduce((s, v) => s + v, 0) / (stance.length || 1);
      const all = rows.map(r => r[side].yaw).sort((a, b) => a - b);
      return { allMedianDeg: +all[Math.floor(all.length / 2)].toFixed(1), stanceFrames: stance.length, stanceMeanDeg: +mean.toFixed(1), stanceMaxDeg: +Math.max(...stance).toFixed(1) };
    };
    Object.assign(report.heroes[hero], { movingFrames: rows.length, left: stat('L'), right: stat('R') });
    if (video) {
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-pattern_type', 'glob', '-i', path.join(dir, '*.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', path.join(out, hero + '-run.mp4')]);
      if (r.status !== 0) report.errors.push(hero + ' ffmpeg ' + String(r.stderr).slice(0, 200));
    }
    console.error(hero, JSON.stringify(report.heroes[hero]));
    await page.evaluate(() => { window.app.input.clear(); window.app.testPause = false; window.app.toLobby?.(); });
    await page.waitForTimeout(800);
  }
  await context.close();
} finally {
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
