#!/usr/bin/env node
/**
 * 프레임 프로파일러 — 렉의 원인을 귀속시킨다.
 *
 *   node tools/profile.mjs
 *
 * metrics.mjs 는 120프레임 중 1프레임만 렌더해서 avgFrameMs 가 사실상 "로직 시간"이다.
 * 여기서는 **매 프레임 렌더**하고, 렌더 기능을 하나씩 꺼가며 각각이 몇 ms 를 먹는지 잰다.
 *
 * 주의: SwiftShader(소프트웨어 래스터)라 절대값은 실기와 다르다.
 *       그래서 **비율과 순위**를 본다 — 무엇이 제일 비싼가.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PROJ = resolve(new URL('..', import.meta.url).pathname);
const PORT = 4194;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const OUT = arg('--out', '.rsi/profile.json');
mkdirSync(resolve(PROJ, '.rsi'), { recursive: true });

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const br = await chromium.launch({ args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc',
] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.hero().level = 30; e.save(); });
await page.click('#boot-start', { force: true });
await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());
await page.evaluate(async () => { await window.app.startStage(window.app.eco.nextStage()); });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.app.testPause = true; window.app.battle.player.auto = true; });

/** 적이 많이 깔린 상태로 이동시킨다 — 렉은 한산할 때 안 난다 */
const warm = await page.evaluate(async ({ dt }) => {
  const app = window.app;
  for (let k = 0; k < 60; k++) {
    for (let i = 0; i < 60; i++) app.step(dt, false);
    if (app.battle.enemies.filter((e) => e.alive).length >= 5) break;
  }
  return { alive: app.battle.enemies.filter((e) => e.alive).length, room: app.battle.curRoom?.type };
}, { dt: 1 / 60 });

/** 한 가지 설정으로 N프레임 렌더하며 프레임 시간을 잰다 */
const measure = (label, setup, n = 80) => page.evaluate(async ({ label, setup, n, dt }) => {
  const app = window.app, R = app.renderer;
  // 원상복구용 스냅샷
  const snap = { bloom: R.bloom.enabled, shadow: R.r.shadowMap.enabled, pr: R.r.getPixelRatio() };
  // eslint-disable-next-line no-new-func
  new Function('app', 'R', setup)(app, R);
  const info = R.r.info; info.autoReset = false;
  for (let i = 0; i < 12; i++) app.step(dt, true);        // 워밍업
  const t = [];
  let tri = 0, calls = 0;
  for (let i = 0; i < n; i++) {
    info.reset();
    const a = performance.now();
    app.step(dt, true);
    t.push(performance.now() - a);
    tri = Math.max(tri, info.render.triangles); calls = Math.max(calls, info.render.calls);
  }
  // 복구
  R.bloom.enabled = snap.bloom; R.r.shadowMap.enabled = snap.shadow;
  R.r.setPixelRatio(snap.pr); R.composer.setPixelRatio(snap.pr);
  R.r.shadowMap.needsUpdate = true;
  const s = [...t].sort((x, y) => x - y);
  return { label, avg: t.reduce((a, b) => a + b, 0) / t.length, p50: s[(n / 2) | 0], p95: s[(n * 0.95) | 0], max: s[n - 1], tri, calls,
    alive: app.battle.enemies.filter((e) => e.alive).length };
}, { label, setup, n, dt: 1 / 60 });

const R2 = (x) => Math.round(x * 100) / 100;
const rows = [];
const run = async (label, setup, n) => { const r = await measure(label, setup, n); rows.push(r);
  console.log(`  ${label.padEnd(24)} avg ${R2(r.avg)}ms  p95 ${R2(r.p95)}ms  calls ${r.calls}  tri ${r.tri}`); return r; };
console.log(`적 ${warm.alive}마리 · ${warm.room} 방 — 측정 시작`);
// 기준 = 지금 그대로. 이후 하나씩 끄면서 차이를 본다.
await run('기준(전부 켬)', '');
await run('블룸 끔', 'R.bloom.enabled = false;');
await run('그림자 끔', 'R.r.shadowMap.enabled = false;');

await run('픽셀비 0.5', 'R.r.setPixelRatio(0.5); R.composer.setPixelRatio(0.5);');

// 컴포저 우회는 render 를 덮어썼으므로 되돌린다



// 로직만은 render=false 로 다시 정확히
const logicOnly = await page.evaluate(({ dt, n }) => {
  const app = window.app, t = [];
  for (let i = 0; i < 20; i++) app.step(dt, false);
  for (let i = 0; i < n; i++) { const a = performance.now(); app.step(dt, false); t.push(performance.now() - a); }
  const s = [...t].sort((x, y) => x - y);
  return { label: '로직만(렌더 안 함)', avg: t.reduce((a, b) => a + b, 0) / t.length, p50: s[(n / 2) | 0], p95: s[(n * 0.95) | 0], max: s[n - 1], tri: 0, calls: 0,
    alive: app.battle.enemies.filter((e) => e.alive).length };
}, { dt: 1 / 60, n: 120 });
rows.push(logicOnly);
console.log(`  ${logicOnly.label.padEnd(24)} avg ${R2(logicOnly.avg)}ms  p95 ${R2(logicOnly.p95)}ms`);

// 씬 규모
const scene = await page.evaluate(() => {
  const R = window.app.renderer; let meshes = 0, skinned = 0, points = 0, lights = 0, objs = 0, mats = new Set(), geos = new Set();
  R.scene.traverse((o) => {
    objs++;
    if (o.isSkinnedMesh) skinned++; else if (o.isPoints) points++; else if (o.isMesh) meshes++;
    if (o.isLight) lights++;
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.uuid));
    if (o.geometry) geos.add(o.geometry.uuid);
  });
  return { objs, meshes, skinned, points, lights, materials: mats.size, geometries: geos.size,
    programs: R.r.info.programs?.length ?? 0, textures: R.r.info.memory.textures, geoMem: R.r.info.memory.geometries,
    pixelRatio: R.r.getPixelRatio(), quality: R.quality,
    drawBuffer: [R.r.domElement.width, R.r.domElement.height] };
});

await br.close(); srv.kill();

const base = rows[0];
console.log(`\n적 ${warm.alive}마리 · ${warm.room} 방 · 캔버스 ${scene.drawBuffer.join('x')} · 픽셀비 ${scene.pixelRatio} · 품질 ${scene.quality}\n`);
console.log('구성                       avg     p50     p95     max   드로우콜  삼각형   기준대비');
for (const r of rows) {
  const save = base.avg > 0 ? ((base.avg - r.avg) / base.avg * 100) : 0;
  console.log(
    `${r.label.padEnd(24)}${String(R2(r.avg)).padStart(7)}${String(R2(r.p50)).padStart(8)}${String(R2(r.p95)).padStart(8)}` +
    `${String(R2(r.max)).padStart(8)}${String(r.calls).padStart(9)}${String(r.tri).padStart(9)}` +
    `${(r === base ? '—' : (save >= 0 ? '-' : '+') + Math.abs(Math.round(save)) + '%').padStart(10)}`);
}
console.log('\n씬:', JSON.stringify(scene));
writeFileSync(resolve(PROJ, OUT), JSON.stringify({ warm, scene, rows }, null, 2));
console.log(`\n→ ${OUT}`);
