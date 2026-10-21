// 캐릭터 선명도 실측(lane f6-crisp): 폰 뷰포트에서 실제 렌더 해상도(유효 DPR)를 읽고, 로비·전투의 영웅을 장치 해상도로 잘라 저장한다.
// 렌더는 소프트웨어(SwiftShader)라 FPS 는 대표값이 아니다. 거버너를 배율 1.0·열 단계 0 으로 고정하고 app.step(1/60) 로 직접 그린다.
// 사용: node tools/crisp-qa.mjs <origin> <출력폴더> <태그 before|after> [뷰포트목록 915x412@3.5,1280x800@2,800x360@2.75]
import { chromium } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const origin = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = path.resolve(process.argv[3] || 'work/crisp-qa');
const tag = process.argv[4] || 'run';
const views = (process.argv[5] || '915x412@3.5,1280x800@2,800x360@2.75').split(',').map((v) => { const [s, d] = v.split('@'); const [w, h] = s.split('x').map(Number); return { w, h, dsf: Number(d) }; });
await fsp.mkdir(out, { recursive: true });
const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers')
  ? fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0] : undefined);
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, args });
const rows = [];

for (const { w, h, dsf } of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  const name = `${w}x${h}@${dsf}`;
  const row = { viewport: name, errors };
  try {
    await page.goto(origin + '/', { waitUntil: 'commit', timeout: 120000 });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
    // 소프트웨어 렌더의 느린 프레임이 거버너를 흔들지 않게 고정한다(이전 빌드에는 lockResolution 이 없어 열 단계만 0으로).
    const fix = () => page.evaluate(() => {
      const g = app.frameGovernor; g.tier = 0; g.lockResolution?.(1); app.testPause = true;
      app.renderer.setThermalTier(0); app.renderer.setResolutionScale?.(1);
      return { lock: typeof g.lockResolution };
    });
    await fix();
    const info = () => page.evaluate(() => {
      const r = app.renderer, c = app.canvas || document.querySelector('canvas');
      const gl = r.r.getContext();
      return { dpr: devicePixelRatio, quality: r.quality, touch: r.touch, tier: r.thermalTier, resolutionScale: r.resolutionScale ?? null,
        renderRatio: r.r.getPixelRatio(), backing: [c.width, c.height], css: [innerWidth, innerHeight],
        nativeFraction: +(r.r.getPixelRatio() / devicePixelRatio).toFixed(3),
        fxaa: !!r.lobbyAA?.enabled, sharpen: r.sharpenPass ? !!r.sharpenPass.enabled : null, maxAniso: r.r.capabilities.getMaxAnisotropy() };
    });

    // ---- 로비: 영웅 클로즈업(최대 확대·정면) ----
    await page.evaluate(async () => {
      app.ui.closeModal?.();
      app.renderer.lobbyCamera = { yaw: 27, pitch: 11, zoom: 135 };
      for (let i = 0; i < 90; i++) app.step(1 / 60, i === 89);
    });
    const heroBox = (getPos) => page.evaluate((fn) => {
      const T = window.__THREE, cam = app.renderer.camera; cam.updateMatrixWorld();
      const p = new T.Vector3(); (new Function('return ' + fn))()(p);
      const proj = (y) => { const v = p.clone(); v.y += y; v.project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
      const foot = proj(0), head = proj(1.9), hgt = Math.abs(foot[1] - head[1]);
      return { cx: foot[0], cy: (foot[1] + head[1]) / 2, hgt };
    }, getPos);
    const lobbyBox = await heroBox('(p) => p.copy(app.showcase.root.position)');
    await page.evaluate(() => { app.step(1 / 60, true); });
    row.lobby = { ...(await info()), hero: lobbyBox };
    const clipFor = (b) => { const side = Math.max(120, b.hgt * 1.15); return { x: Math.max(0, Math.min(w - side, b.cx - side / 2)), y: Math.max(0, Math.min(h - side, b.cy - side / 2)), width: Math.min(side, w), height: Math.min(side, h) }; };
    await page.screenshot({ path: path.join(out, `${tag}-lobby-full-${name}.png`), timeout: 240000 });
    await page.screenshot({ path: path.join(out, `${tag}-lobby-hero-${name}.png`), clip: clipFor(lobbyBox), timeout: 240000 });

    // ---- 전투: 영웅 ----
    await page.evaluate(async () => {
      app.testPause = false; app.eco.s.energy = 100;
      if (!await app.startExpedition('dungeon', 'glass_garden', { depth: 'standard' })) throw Error('expedition start failed');
    });
    await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 120000 });
    await fix();
    await page.evaluate(() => {
      const b = app.battle, p = b.player; p.auto = false; p.invuln = 1e6; app.input.clear();
      for (let i = 0; i < 120; i++) app.step(1 / 60, i === 119);
    });
    const battleBox = await heroBox('(p) => p.copy(app.battle.player.pos)');
    await page.evaluate(() => { app.step(1 / 60, true); });
    row.battle = { ...(await info()), hero: battleBox };
    await page.screenshot({ path: path.join(out, `${tag}-battle-full-${name}.png`), timeout: 240000 });
    await page.screenshot({ path: path.join(out, `${tag}-battle-hero-${name}.png`), clip: clipFor(battleBox), timeout: 240000 });
  } catch (error) { row.fail = String(error?.message || error).slice(0, 400); }
  rows.push(row);
  await ctx.close();
}
await browser.close();
await fsp.writeFile(path.join(out, `${tag}-report.json`), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.map((r) => ({ viewport: r.viewport, fail: r.fail, errors: r.errors.length,
  lobby: r.lobby && { renderRatio: r.lobby.renderRatio, frac: r.lobby.nativeFraction, backing: r.lobby.backing, quality: r.lobby.quality, fxaa: r.lobby.fxaa, sharpen: r.lobby.sharpen, tier: r.lobby.tier },
  battle: r.battle && { renderRatio: r.battle.renderRatio, frac: r.battle.nativeFraction, backing: r.battle.backing, fxaa: r.battle.fxaa, sharpen: r.battle.sharpen, tier: r.battle.tier } })), null, 1));
process.exit(rows.some((r) => r.fail) ? 1 : 0);
