import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sourceSnapshot } from './build-source.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, process.argv[2] || 'work/combat-slice/qa');
await fs.mkdir(out, { recursive: true });
const server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8' }).trim();
const report = { status: 'running', origin, started: new Date().toISOString(), sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'),
  diffSha256: createHash('sha256').update(git('diff', 'HEAD')).digest('hex'),
  sourceSha256: sourceSnapshot(root).digest,
  build: JSON.parse(await fs.readFile(path.join(root, 'dist/version.json'), 'utf8')), checks: [], errors: [], consoleErrors: [], httpErrors: [],
  limits: ['Desktop Chromium touch emulation; not a physical Android device.', 'Fonts CDN CSS is stubbed, matching the existing metrics harness.'] };
const check = (ok, name, evidence) => { report.checks.push({ name, pass: !!ok, evidence }); if (!ok) throw Error(name + ': ' + JSON.stringify(evidence)); };
let browser;
try {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/build-source.json'), 'utf8'));
  check(report.sourceSha256 === manifest.digest && report.build.sourceSha256 === manifest.digest && report.build.sha === report.sha && report.build.dirty === !!report.dirty,
    '실행 빌드가 tracked·untracked 현재 소스와 일치한다', { sourceSha256: report.sourceSha256, buildSha: report.build.sha, dirty: report.build.dirty, files: manifest.files.length });
  browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block', recordVideo: { dir: out, size: { width: 844, height: 390 } } });
  const page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ url: r.url(), status: r.status() }); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(origin); await page.locator('#boot-start:not(.hidden)').waitFor(); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'));
  await page.evaluate(() => { app.ui.closeModal(); app.testPause = true; });
  await page.click('.oath-nav-menu');
  const before = await page.evaluate(() => JSON.stringify(app.eco.s));
  await page.click('#btn-combat-practice');
  await page.waitForFunction(() => app.battle?.stage?.practice && app.battle.active && !app.stageStarting);
  const step = (frames, render = true) => page.evaluate(({ frames, render }) => { for (let i = 0; i < frames; i++) app.step(1 / 60, render && i === frames - 1); }, { frames, render });
  await step(25);
  const scene = await page.evaluate(() => {
    const b = app.battle, p = b.player, gl = app.renderer.r.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    let bones = 0, meshes = 0, textured = 0; p.model.traverse(o => { if (o.isBone) bones++; if (o.isMesh) { meshes++; const m = Array.isArray(o.material) ? o.material : [o.material]; textured += m.filter(m => m.map).length; } });
    return { hero: p.def.id, identity: p.model.userData.tllIdentity, enemies: b.enemies.filter(e => e.alive).length, clips: Object.keys(p.clips).length, bones, meshes, textured,
      rooms: b.world.rooms.length, auto: p.auto, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), camera: app.renderer.camera.position.toArray() };
  });
  check(scene.enemies === 10 && scene.hero === 'knight' && scene.bones > 10 && scene.clips > 15 && scene.textured > 0 && !scene.auto, '실제 리깅 영웅과 적 10체가 수동 연습에 연결된다', scene);
  report.renderer = scene.renderer;
  if (/swiftshader|software/i.test(scene.renderer)) report.limits.push('Software WebGL frame intervals do not represent GPU performance.');
  await page.screenshot({ path: path.join(out, 'practice-844x390.png') });
  const layout = await page.evaluate(() => ['btn-attack', 'btn-dodge', 'btn-pause', 'practice-restart', 'practice-exit', ...[...document.querySelectorAll('.skill-btn')].map(e => e.id)].filter(Boolean).map(id => {
    const e = document.getElementById(id), r = e.getBoundingClientRect(); return { id, rect: r.toJSON(), reachable: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  }));
  check(layout.every(e => e.reachable && e.inViewport), '844×390의 핵심 버튼이 보이고 실제 클릭점이 일치한다', layout);
  // 키보드 이동은 게임 상태를 직접 이동시키지 않는다.
  const start = await page.evaluate(() => app.battle.player.pos.toArray());
  await page.keyboard.down('a'); await step(20); await page.keyboard.up('a');
  const moved = await page.evaluate(() => app.battle.player.pos.toArray());
  check(Math.hypot(start[0] - moved[0], start[2] - moved[2]) > .5, 'WASD 실제 입력으로 이동한다', { start, moved });
  await page.click('#btn-pause'); const frozen = await page.evaluate(() => app.battle.elapsed); await step(30);
  check(await page.evaluate(t => app.battle.paused && !app.input.enabled && app.battle.elapsed === t, frozen), '일시정지가 전투와 입력을 멈춘다', { elapsed: frozen });
  await page.click('#btn-resume'); await page.keyboard.press('j'); await step(2);
  check(await page.evaluate(() => app.battle.player.state === 'attack'), 'HUD 클릭 후 J 입력이 즉시 공격한다', await page.evaluate(() => ({ state: app.battle.player.state, focus: document.activeElement.id })));
  await step(60); await page.keyboard.press('k'); await step(7);
  const mpBefore = await page.evaluate(() => app.battle.player.mp);
  await page.keyboard.press('1'); await step(1);
  check(await page.evaluate(() => app.battle.player.state === 'dodge' && app.battle.player.skillBuffer?.slot === 0), '회피 중 스킬 입력을 보존한다', await page.evaluate(() => ({ state: app.battle.player.state, buffer: app.battle.player.skillBuffer })));
  const dodgeTrace = [];
  for (let i = 0; i < 24; i++) {
    await step(5);
    const state = await page.evaluate(() => ({ state: app.battle.player.state, stateT: app.battle.player.stateT, stun: app.battle.player.stun, buffer: app.battle.player.skillBuffer, mp: app.battle.player.mp, cooldown: app.battle.player.cds[0] }));
    dodgeTrace.push(state); if (state.cooldown > 0) break;
  }
  check(await page.evaluate(mp => app.battle.player.mp < mp - 10 && app.battle.player.cds[0] > 0, mpBefore), '회피 종료 후 실제 스킬이 시전되고 MP/쿨다운이 적용된다', dodgeTrace);
  await page.screenshot({ path: path.join(out, 'dodge-skill.png') });
  // 모바일 조이스틱은 Chromium의 네이티브 터치 입력으로 조작한다.
  const touch = await context.newCDPSession(page);
  await step(80);
  const touchStart = await page.evaluate(() => app.battle.player.pos.toArray());
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 320, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 122, y: 320, id: 1 }] });
  await step(20);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(await page.evaluate(pos => Math.hypot(app.battle.player.pos.x - pos[0], app.battle.player.pos.z - pos[2]) > .5 && !app.input.joy.active, touchStart), '터치 조이스틱 이동과 손 뗀 뒤 해제가 동작한다', await page.evaluate(() => ({ pos: app.battle.player.pos.toArray(), joyActive: app.input.joy.active })));
  await page.click('#practice-restart'); await page.waitForFunction(() => app.battle.active && !app.stageStarting); await step(25);
  await page.click('.oath-camera-details > summary'); await page.click('#battle-camera-zoom-out'); await page.keyboard.press('j'); await step(2);
  check(await page.evaluate(() => app.battle.player.state === 'attack'), '시점 버튼 클릭 후에도 공격 키를 사용할 수 있다', null);
  await page.click('#battle-camera-reset'); await page.click('.oath-camera-details > summary');
  await page.click('#practice-restart'); await page.waitForFunction(() => app.battle.active && !app.stageStarting); await step(25);
  await page.getByRole('button', { name: '도감', exact: true }).click();
  const codexElapsed = await page.evaluate(() => app.battle.elapsed); await step(20);
  check(await page.evaluate(t => app.battle.paused && !app.input.enabled && app.battle.elapsed === t, codexElapsed), '도감은 현재 연습 전투를 정지한다', null);
  await page.click('#rpg-codex .rpg-close'); await page.keyboard.press('j'); await step(2);
  check(await page.evaluate(() => !app.battle.paused && app.input.enabled && app.battle.player.state === 'attack'), '도감 닫기 후 전투와 공격 키가 복귀한다', await page.evaluate(() => ({ paused: app.battle.paused, enabled: app.input.enabled, state: app.battle.player.state, focus: document.activeElement.id, keyboardLaunch: app.combatPractice.campaign.rpgView.keyboardLaunch })));
  await page.evaluate(() => { const v = app.combatPractice.campaign.rpgView; v.open(v.hudButton, false); v.close(); v.open(v.hudButton, false); });
  await page.waitForTimeout(50);
  check(await page.evaluate(() => document.getElementById('rpg-codex').open && app.battle.paused && !app.input.enabled), '지연된 도감 close 이벤트가 같은 틱의 재열기 정지를 해제하지 않는다', null);
  await page.click('#rpg-codex .rpg-close');
  // 실제 시간의 플레이 녹화/프레임 표본. 고정 dt 결과를 FPS로 바꾸지 않는다.
  await page.click('#practice-restart'); await page.waitForFunction(() => app.battle.active && !app.stageStarting); await step(25);
  await page.evaluate(() => { app.input.clear(); app.testPause = false; window.__practiceFrames = []; let last = performance.now(); const frame = t => { __practiceFrames.push(t - last); last = t; if (__practiceFrames.length < 180) requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  await page.waitForFunction(() => __practiceFrames.length >= 180);
  report.performance = await page.evaluate(() => {
    const frames = __practiceFrames.slice(10).sort((a, b) => a - b), r = app.renderer.r, gl = r.getContext(), autoReset = r.info.autoReset;
    r.info.autoReset = false; r.info.reset(); app.renderer.render(); const calls = r.info.render.calls, triangles = r.info.render.triangles; r.info.autoReset = autoReset;
    return { samples: frames.length, p50FrameMs: frames[Math.floor(frames.length * .5)], p95FrameMs: frames[Math.floor(frames.length * .95)], drawCalls: calls, triangles, alive: app.battle.enemies.filter(e => e.alive).length, width: innerWidth, height: innerHeight, dpr: r.getPixelRatio() };
  });
  check(report.performance.drawCalls <= 420, '연습 전투의 드로우콜이 기존 예산 안에 있다', report.performance);
  await page.evaluate(() => { app.testPause = true; app.input.clear(); });
  await page.click('#practice-restart'); await page.waitForFunction(() => app.battle.active && !app.stageStarting); await step(25);
  await page.evaluate(() => { app.testPause = false; });
  const held = new Set(); let telegraph = false, maxComboIndex = 0, attacks = 0;
  for (let n = 0; n < 900; n++) {
    const intent = await page.evaluate(() => {
      const b = app.battle, p = b.player, e = p.nearestEnemy(99); if (!b.active || !e) return { done: !b.active, keys: [], attack: false };
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz), c = Math.cos(app.input.getCameraYaw()), s = Math.sin(app.input.getCameraYaw());
      const sx = (dx * c - dz * s) / (d || 1), sy = (dx * s + dz * c) / (d || 1);
      const aim = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(aim - p.yaw), Math.cos(aim - p.yaw)), moving = d > 1.9 || Math.abs(diff) > .3;
      return { done: false, keys: moving ? [...(sx > .3 ? ['d'] : sx < -.3 ? ['a'] : []), ...(sy > .3 ? ['s'] : sy < -.3 ? ['w'] : [])] : [],
        attack: d < 3.5 && (p.state === 'idle' || p.state === 'move' || p.state === 'attack' && p.canQueueCombo() && !p.comboQueued),
        telegraph: b.enemies.some(e => e.alive && e.telegraph > 0), idx: p.comboIdx };
    });
    if (intent.done) break; telegraph ||= intent.telegraph; maxComboIndex = Math.max(maxComboIndex, intent.idx || 0);
    for (const key of held) if (!intent.keys.includes(key)) { await page.keyboard.up(key); held.delete(key); }
    for (const key of intent.keys) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
    if (intent.attack) { await page.keyboard.press('j'); attacks++; }
    await page.waitForTimeout(80);
    if (telegraph && n === 10) await page.screenshot({ path: path.join(out, 'manual-combat.png') });
  }
  for (const key of held) await page.keyboard.up(key);
  await page.evaluate(() => { app.testPause = true; app.input.clear(); });
  check(await page.evaluate(() => app.battle.result?.practice && app.battle.result.win && app.battle.kills === 10), '적 10체를 실제 수동 이동/공격으로 처치하고 연습 결과에 도착한다', await page.evaluate(() => app.battle.result));
  check(telegraph && maxComboIndex >= 2, '적의 예고와 수동 연속 콤보가 실제 전투에서 발화한다', { telegraph, maxComboIndex, attacks });
  await page.screenshot({ path: path.join(out, 'practice-victory.png') });
  const after = await page.evaluate(() => JSON.stringify(app.eco.s));
  const changedPaths = [];
  const diffSave = (a, b, key = '') => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffSave(a[k], b[k], key ? key + '.' + k : k); else changedPaths.push(key); };
  diffSave(JSON.parse(before), JSON.parse(after));
  // 에너지 재생 시계는 로비와 전투 모두에서 정상적으로 갱신된다.
  check(changedPaths.every(key => key === 'energyT'), '연습이 에너지·재화·성장·진행 데이터를 변경하지 않는다', { protectedDataUnchanged: changedPaths.every(key => key === 'energyT'), changedPaths });
  await page.click('#practice-again'); await page.waitForFunction(() => app.battle.active && !app.stageStarting);
  check(await page.evaluate(() => app.battle.kills === 0 && app.battle.enemies.length === 10), '결과에서 새 10체 전투로 재도전한다', null);
  await page.click('#btn-pause'); await page.click('#btn-giveup');
  check(await page.evaluate(() => app.battle.result?.practice && !app.battle.result.win && !app.input.enabled && app.battle.kills === 0), '중단도 캠페인 정산 없이 연습 결과로 닫힌다', null);
  await page.click('#practice-again'); await page.waitForFunction(() => app.battle.active && !app.stageStarting);
  await page.click('#practice-exit'); await page.waitForFunction(() => app.mode === 'lobby'); await step(1);
  check(await page.evaluate(() => !app.battle.stage?.practice && !document.body.classList.contains('combat-practice')), '로비로 돌아와 원래 캠페인 전투를 복원한다', null);
  await page.click('#btn-battle'); await page.waitForFunction(() => app.battle.active && !app.stageStarting);
  check(await page.evaluate(() => !app.battle.stage.practice && app.battle.player.alive), '연습 종료 후 실제 캠페인 출격이 가능하다', null);
  await page.evaluate(() => { const v = app.battle.chronicle; v.open('run', v.hud); v.close(); v.open('run', v.hud); });
  await page.waitForTimeout(50);
  check(await page.evaluate(() => document.getElementById('masterworks').open && app.battle.paused && !app.input.enabled), '각인 close 이벤트도 재열기 뒤 새 정지 소유권을 유지한다', null);
  await page.click('#masterworks .mw-header > .mw-close');
  check(!report.errors.length && !report.consoleErrors.length && !report.httpErrors.length, '브라우저·콘솔·자산 HTTP 오류가 없다', { errors: report.errors, consoleErrors: report.consoleErrors, httpErrors: report.httpErrors });
  check(sourceSnapshot(root).digest === report.sourceSha256, '검증 도중 소스가 바뀌지 않았다', null);
  const video = page.video(); await context.close(); await video.saveAs(path.join(out, 'real-play.webm'));
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally {
  await browser?.close(); server.httpServer.closeAllConnections?.(); await new Promise(r => server.httpServer.close(r));
  report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure, performance: report.performance, report: path.join(out, 'report.json') }));
}
