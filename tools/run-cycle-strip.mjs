// 달리기 발 미끄러짐 확인용 프레임 띠: 영웅을 실제 키(D)로 1.2초 달리게 한 뒤 1/30초 간격 8장을 같은 카메라로 찍는다.
// 각 장에 디딤발(낮은 발) 월드 좌표를 함께 기록해 바닥 위 미끄럼(cm)을 숫자로도 남긴다.
// 사용: node tools/run-cycle-strip.mjs <distDir> <outDir> [heroes]
import { chromium } from 'playwright';
import { preview } from 'vite';
import sharp from 'sharp';
import { launchOpts } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJ = fileURLToPath(new URL('..', import.meta.url));
const [distArg = 'dist', outArg = '/tmp/claude-0/lanes-shots/h3-feel/run', heroArg = 'knight,barbarian,mage,rogue,ranger'] = process.argv.slice(2);
const out = resolve(outArg); mkdirSync(out, { recursive: true });
const server = await preview({ root: PROJ, configFile: false, build: { outDir: resolve(PROJ, distArg) }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch(launchOpts({ headless: true }));
const report = {};
try {
  for (const hero of heroArg.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page.setDefaultTimeout(900000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(origin); await page.locator('#boot-start:not(.hidden)').waitFor();
    await page.evaluate(h => { const eco = window.app.eco; eco.reset(); (eco.s.roster.policy = 1, eco.s.roster.starterChosen = true); eco.s.tutorial = { completed: true }; eco.s.daily.last = Math.floor(Date.now() / 86400000); eco.s.selected = h; eco.save(); window.app.journey.setAuto(false); }, hero);
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app.mode === 'lobby' && !document.getElementById('boot').classList.contains('show'));
    await page.evaluate(async () => { const app = window.app; app.ui.closeModal(); app.testPause = true; let s = 7; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; if (await app.startStage(app.eco.nextStage()) !== true) throw Error('출격 실패'); app.battle.player.auto = false; app.companionAgent?.endBattle?.(); app.renderer.setCameraPreset('action'); const b = app.battle; for (const e of b.enemies) e.dispose(); b.enemies.length = 0; b.pending.length = 0; const r = b.world.startRoom; b.player.pos.set(r.x - 4, 0, r.z); for (let i = 0; i < 60; i++) app.step(1 / 60, false); });
    await page.keyboard.down('KeyD');
    const frames = [];
    await page.evaluate(() => { for (let i = 0; i < 72; i++) window.app.step(1 / 60, false); });
    for (let k = 0; k < 8; k++) {
      const info = await page.evaluate(() => {
        const app = window.app; app.step(1 / 60, false); app.step(1 / 60, true);
        const p = app.battle.player, T = window.__THREE; p.model.updateMatrixWorld(true);
        const feet = []; p.model.traverse(o => { if (o.isBone && /foot/i.test(o.name) && !/toe|end/i.test(o.name)) feet.push(o); });
        const fp = feet.slice(0, 2).map(f => { const v = f.getWorldPosition(new T.Vector3()); return [v.x, v.y, v.z]; });
        return { x: p.pos.x, z: p.pos.z, ts: p.action?.timeScale, clip: p.actionName, sprint: p.sprint, fp };
      });
      const file = join(out, `${hero}-run-${k}.png`); await page.screenshot({ path: file });
      frames.push({ ...info, file });
    }
    await page.keyboard.up('KeyD');
    // 디딤발: 각 프레임의 낮은 발. 연속 두 프레임에서 같은 발이 디딤발이면 그 사이 수평 이동이 미끄럼이다.
    const slips = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      const ia = a.fp[0][1] < a.fp[1][1] ? 0 : 1, ib = b.fp[0][1] < b.fp[1][1] ? 0 : 1;
      if (ia === ib) slips.push(Math.hypot(b.fp[ib][0] - a.fp[ia][0], b.fp[ib][2] - a.fp[ia][2]) * 100);
    }
    const body = Math.hypot(frames.at(-1).x - frames[0].x, frames.at(-1).z - frames[0].z) / (frames.length - 1) * 100;
    report[hero] = { timeScale: frames.at(-1).ts, sprint: frames.at(-1).sprint, bodyCmPerStep: Math.round(body), plantedSlipCmPerStep: slips.map(v => Math.round(v)),
      slipRatio: slips.length ? Math.round(slips.reduce((x, y) => x + y, 0) / slips.length / body * 100) / 100 : null };
    const W = 300, H = 300, tiles = [];
    for (const f of frames) tiles.push(await sharp(f.file).extract({ left: 694, top: 200, width: 300, height: 300 }).toBuffer());
    // 플레이어 중심 근처 고정 창(카메라가 따라오므로 영웅은 거의 같은 자리, 바닥 무늬가 흐른다)
    await sharp({ create: { width: W * tiles.length, height: H, channels: 3, background: '#111' } })
      .composite(tiles.map((input, i) => ({ input, left: i * W, top: 0 }))).png().toFile(join(out, `strip-${hero}-run.png`));
    console.log(JSON.stringify({ hero, ...report[hero] }));
    await ctx.close();
  }
} finally { await browser.close(); await new Promise(r => server.httpServer.close(r)); }
writeFileSync(join(out, 'run-report.json'), JSON.stringify(report, null, 1));
