#!/usr/bin/env node
/**
 * 최적화 검증 — 결정적인 값만 본다.
 *
 * SwiftShader 위의 ms 는 컨테이너 부하에 따라 같은 구성이 85→144→76 으로 튄다.
 * 그래서 판정은 **삼각형 수 / 드로우콜 / 블룸 렌더타깃 크기** 로 한다. 이건 안 흔들린다.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve } from 'path';

const PROJ = resolve(new URL('..', import.meta.url).pathname);
const PORT = 4195;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.hero().level = 30; e.save(); });
await page.click('#boot-start', { force: true });
await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());
await page.evaluate(async () => { await window.app.startStage(window.app.eco.nextStage()); });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.app.testPause = true; window.app.battle.player.auto = true; });

const r = await page.evaluate(({ dt }) => {
  const app = window.app, R = app.renderer;
  for (let k = 0; k < 60; k++) { for (let i = 0; i < 60; i++) app.step(dt, false); if (app.battle.enemies.filter((e) => e.alive).length >= 5) break; }
  const info = R.r.info; info.autoReset = false;
  let tri = 0, calls = 0;
  for (let i = 0; i < 12; i++) { info.reset(); app.step(dt, true); tri = Math.max(tri, info.render.triangles); calls = Math.max(calls, info.render.calls); }
  // 블룸이 실제로 몇 픽셀에서 도는가
  const b = R.bloom;
  const mips = (b.renderTargetsHorizontal || []).map((t) => `${t.width}x${t.height}`);
  // 그림자를 던지는 인스턴스드 메시 / 전체
  let imTotal = 0, imShadow = 0, imInstances = 0;
  R.scene.traverse((o) => { if (o.isInstancedMesh) { imTotal++; imInstances += o.count; if (o.castShadow) imShadow++; } });
  return { tri, calls, alive: app.battle.enemies.filter((e) => e.alive).length,
    canvas: [R.r.domElement.width, R.r.domElement.height], pixelRatio: R.r.getPixelRatio(),
    bloomTarget: b.renderTargetBright ? `${b.renderTargetBright.width}x${b.renderTargetBright.height}` : '?',
    bloomMips: mips, instancedMeshes: imTotal, shadowCasters: imShadow, instances: imInstances };
}, { dt: 1 / 60 });

try { await page.screenshot({ path: resolve(PROJ, '.rsi/shots/perf.png'), timeout: 60000 }); } catch (e) { console.log('스크린샷 스킵'); }
await br.close(); srv.kill();

console.log(`캔버스 ${r.canvas.join('x')} (픽셀비 ${r.pixelRatio})   적 ${r.alive}마리`);
console.log(`삼각형        ${r.tri.toLocaleString()}`);
console.log(`드로우콜      ${r.calls}`);
console.log(`블룸 밝기타깃  ${r.bloomTarget}`);
console.log(`블룸 밉 체인   ${r.bloomMips.join(' → ')}`);
console.log(`인스턴스드메시 ${r.instancedMeshes}개 (그림자 캐스터 ${r.shadowCasters}개, 인스턴스 ${r.instances}개)`);
console.log(errors.length ? `에러 ${errors.length}건: ${errors[0]}` : '에러 0');
