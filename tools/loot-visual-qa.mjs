// 필드 장비 드랍 비주얼 QA: 등급 N·S·E·U·L 드랍을 한 화면에 늘어놓은 장면과 실제 AUTO 전투 중 드랍 장면을 찍는다.
// 실행 전 `bun run build`. 결과는 --out 폴더(기본 work/loot-visual-<tag>)에 png 와 report.json(renderer.info 드로우콜·삼각형)으로 남는다.
// 장면은 관찰용 픽스처다: 늘어놓기 장면은 자석 반경을 0 으로 두고 drops.spawn 으로 정해진 장비를 놓는다(보상·저장에는 쓰지 않음).
// 전투 장면은 실제 AUTO 전투(고정 1/60초) 위에, 화면 안에 E/U/L 을 확실히 보이려고 drops.spawn 주입을 더한 것이다(주입 표기).
// 클라우드 헤드리스(SwiftShader)는 GPU 가 없으므로 프레임 시간은 판단 근거가 아니다. 드로우콜·삼각형만 비교한다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { installMetricsDriver } from './metrics-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const tag = arg('tag', 'candidate'), out = path.resolve(arg('out', path.join(root, `work/loot-visual-${tag}`)));
const quality = arg('quality', 'high'), stageCode = arg('stage', '1-1');
// 전/후 비교: --app-root 로 다른 체크아웃(예: origin/main 을 빌드한 임시 worktree)의 dist 를 같은 장면으로 찍는다.
const appRoot = path.resolve(arg('app-root', root));
// 낮 장면: --expedition=windmeadow 처럼 야외 원정 필드로 시작한다(실제 원정 시작 경로, 입장 연출은 끝까지 기다린다).
const expedition = arg('expedition', '');
const viewports = arg('viewports', '1280x720,844x390').split(',').map(v => v.split('x').map(Number));
if (expedition && !/^[a-z_]{1,40}$/.test(expedition)) throw Error('Invalid expedition');
if (!/^[a-z0-9-]{1,40}$/.test(tag) || !['high', 'mid', 'low'].includes(quality) || !/^\d-\d{1,2}$/.test(stageCode)) throw Error('Invalid tag/quality/stage');
await mkdir(out, { recursive: true });
// 등급별 대표 장비: 1줄 = 같은 부위(무기) 등급 비교, 2줄 = 부위·원본 종류(대장간 · 방어구 리그 · 병기고 GLB) 비교.
const SHOWCASE = [
  ['w_iron', 'N'], ['w_steel', 'S'], ['w_flame', 'E'], ['w_storm', 'U'], ['w_dragon', 'L'],
  ['a_leather', 'N'], ['b_swift', 'S'], ['r_ruby', 'E'], ['arm_aegis_weapon', 'U'], ['a_sun', 'L'],
];
const report = { expedition, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(), appRoot, tag, quality, stage: stageCode, started: new Date().toISOString(), shots: [], errors: [],
  scope: 'Local production build, SwiftShader headless. Showcase = fixture spawns with magnet radius 0. Combat = natural AUTO combat at fixed 1/60s plus injected E/U/L spawns for visibility. Draw calls/triangles from renderer.info over one composed frame (all passes). Not GPU/phone frame-time evidence.' };
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
let server, browser;
try {
  server = await preview({ root: appRoot, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: arg('chromium', process.env.LOOT_QA_CHROMIUM) || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1000, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push(`${width}x${height}: ${error}`));
    await page.addInitScript(() => { let n = 20261024; Math.random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    await page.waitForTimeout(800);
    const started = await page.evaluate(async ({ quality, stageCode, expedition }) => {
      const a = window.app; a.testPause = true; a.ui.closeModal();
      a.eco.s.settings.quality = quality; a.renderer.setQuality(quality); a.fx.setQuality(quality);
      if (expedition) {
        a.testPause = false; a.eco.s.energy = Math.max(a.eco.s.energy, 60);
        const ok = await a.startExpedition('dungeon', expedition);
        a.testPause = true; a.ui.closeModal();
        return ok ? expedition : null;
      }
      const [ch, st] = stageCode.split('-').map(Number);
      let stage = window.__stageDef(ch, st);
      if (!(await a.startStage(stage))) { stage = a.eco.nextStage(); if (!(await a.startStage(stage))) return null; }
      return stage.code || `${stage.ch}-${stage.st}`;
    }, { quality, stageCode, expedition });
    if (!started) throw Error('stage start rejected');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting);
    const info = () => page.evaluate(() => {
      const a = window.app, r = a.renderer.r; r.info.autoReset = false; r.info.reset();
      a.step(.0001, true);
      const result = { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length ?? null, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
      r.info.autoReset = true; return result;
    });
    const shot = async (scene, extra = {}) => {
      const file = path.join(out, `${tag}-${scene}-${width}x${height}.png`);
      const metrics = await info();
      await page.screenshot({ path: file });
      report.shots.push({ scene, viewport: `${width}x${height}`, file, ...metrics, ...extra }); await save();
    };
    // 1) 늘어놓기: 전투를 멈추고 시작방에 장비 10개를 두 줄로 둔다.
    await page.evaluate(() => { const b = window.app.battle; b.player.auto = false; for (let n = 0; n < 30; n++) window.app.step(1 / 60, false); });
    report.baseline ||= {}; report.baseline[`${width}x${height}`] = await info();
    const layout = await page.evaluate((showcase) => {
      const a = window.app, b = a.battle, d = b.drops, T = window.__THREE, cam = a.renderer.camera, p = b.player.pos;
      d.magnetR = 0;
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      const toward = new T.Vector3().subVectors(cam.position, p).setY(0).normalize();
      showcase.forEach(([id, rarity], i) => {
        const row = Math.floor(i / 5), col = i % 5;
        const pos = p.clone().addScaledVector(right, (col - 2) * 1.55).addScaledVector(toward, row ? 2.1 : .2);
        d.spawn(pos, 'item', { id, rarity, uid: `qa-${i}` }, { count: 1, spread: 0 });
      });
      return { spawned: d.items.filter(it => it.kind === 'item').length };
    }, SHOWCASE);
    // 착지 직후(충격 링·스쿼시)와 대기 상태를 따로 찍는다.
    await page.evaluate(() => { for (let n = 0; n < 34; n++) window.app.step(1 / 60, false); });
    await shot('showcase-landing', layout);
    await page.evaluate(() => { for (let n = 0; n < 150; n++) window.app.step(1 / 60, false); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { for (let n = 0; n < 2; n++) window.app.step(1 / 60, false); });
    await shot('showcase-idle', layout);
    // 2) 실제 전투: 드랍을 정리하고 AUTO 로 싸운다. 처치가 쌓이면 화면 안쪽에 E/U/L 을 주입한다.
    await page.evaluate(() => { const b = window.app.battle; b.drops.clear(); b.drops.magnetR = 4.2; b.player.auto = true; });
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    const combat = await page.evaluate(() => {
      const b = window.app.battle;
      for (let n = 0; n < 60 * 40 && b.active && b.kills < 6; n++) window.__metricsDriver.step(1 / 60, false);
      return { kills: b.kills, elapsed: b.elapsed, natural: b.drops.items.filter(it => it.kind === 'item').map(it => it.payload.rarity) };
    });
    await page.evaluate(() => {
      const a = window.app, b = a.battle, d = b.drops, T = window.__THREE, cam = a.renderer.camera, p = b.player.pos;
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      const toward = new T.Vector3().subVectors(cam.position, p).setY(0).normalize();
      // 전투 무리와 겹치지 않게 카메라 쪽 앞줄에 둔다(튀어오름 퍼짐은 실제 드랍과 같은 spread).
      [['w_frost', 'E', -2.4], ['r_storm', 'U', 0], ['w_sun', 'L', 2.4], ['b_cloth', 'N', -1.2], ['a_chain', 'S', 1.2]].forEach(([id, rarity, x], i) => {
        d.spawn(p.clone().addScaledVector(right, x).addScaledVector(toward, i > 2 ? 3.6 : 2.3), 'item', { id, rarity, uid: `qa-c${i}` }, { count: 1, spread: .3 });
      });
      d.magnetR = 0;
      for (let n = 0; n < 40; n++) window.__metricsDriver.step(1 / 60, false);
    });
    await shot('combat-landing', { ...combat, injected: ['N', 'S', 'E', 'U', 'L'] });
    await page.evaluate(() => { for (let n = 0; n < 90; n++) window.__metricsDriver.step(1 / 60, false); });
    await shot('combat-idle', combat);
    await context.close();
  }
  report.status = report.errors.length ? 'page-errors' : 'pass';
} catch (error) { report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve()); report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, out, failure: report.failure, shots: report.shots.map(s => [s.scene, s.viewport, s.calls, s.triangles]) })); }
