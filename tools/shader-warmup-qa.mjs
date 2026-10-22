// 셰이더 준비(warm-up) 실측(lane f4-combat-hud): 로딩이 끝난 뒤에 새 프로그램이 컴파일되는지, 컴파일됐다면 어떤 재질이며 그 드로 호출이 몇 ms 걸렸는지 센다.
//  - 방법: renderer.renderBufferDirect 를 감싸 info.programs 가 늘어난 호출만 기록(재질·오브젝트·소요 ms)
//  - 구간 A: battle.active 직후 실시간 12초(첫 화면·연출) / 구간 B: 적 8종 소환 + 평타·회피·스킬 0~5 첫 사용 + 처치 연출(app.step 결정적 진행)
//  - 같은 시나리오를 수정 전/후 빌드에 돌려 비교한다. 새 프로그램이 한 개라도 있으면 exit 1.
//  - 주의: 소프트웨어 GL(SwiftShader)의 ms 는 실기기와 다르다. 프로그램 수는 기기와 무관한 결정적 지표다.
// 사용: node tools/shader-warmup-qa.mjs <origin> [출력 json] [heroId]
import { chromium } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const origin = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const outFile = path.resolve(process.argv[3] || 'work/shader-warmup.json');
const hero = process.argv[4] || 'knight';
await fsp.mkdir(path.dirname(outFile), { recursive: true });
const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers')
  ? fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0] : undefined);
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, args });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto(origin + '/', { waitUntil: 'commit', timeout: 120000 });
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
// 렌더 호출 감시자는 로딩 전에 건다(준비 단계의 컴파일은 'prepare', 이후는 'late' 로 구분한다).
await page.evaluate(() => {
  window.__events = []; window.__phase = 'boot';
  const r = app.renderer.r, orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const n0 = r.info.programs.length, t0 = performance.now(), out = orig(camera, scene, geometry, material, object, group), ms = performance.now() - t0;
    if (r.info.programs.length > n0) {
      const chain = []; for (let o = object; o && chain.length < 5; o = o.parent) chain.push(o.name || o.type);
      window.__events.push({ phase: window.__phase, ms: +ms.toFixed(1), count: r.info.programs.length, material: material.type, map: !!material.map, side: material.side, blending: material.blending,
        key: material.customProgramCacheKey?.().slice(-44), geometry: geometry.type, chain });
    }
    return out;
  };
});
await page.tap('#boot-start');
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
await page.evaluate(async hero => {
  app.ui.closeModal?.(); app.eco.s.energy = 100;
  if (!app.eco.s.heroes[hero]) app.eco.s.heroes[hero] = { ...app.eco.s.heroes.knight, id: hero };
  app.eco.s.selected = hero; window.__phase = 'prepare';
  if (!await app.startExpedition('dungeon', 'glass_garden', { depth: 'standard' })) throw Error('expedition start failed');
}, hero);
await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 120000 });
await page.evaluate(() => { window.__phase = 'late-a'; });
await page.waitForTimeout(12000);
await page.evaluate(() => { window.__phase = 'late-b'; app.testPause = true; });
const programs = await page.evaluate(async () => {
  const a = app, b = a.battle, T = window.__THREE, p = b.player; p.auto = false; p.invuln = 1e6; p.mp = p.maxMp;
  const pos = p.pos;
  ['bone_orc', 'skel_rogue', 'skel_mage', 'skel_minion', 'ghost', 'skel_priest', 'ghost_skull', 'bomb_slime'].forEach((t, i) => b.spawnEnemy(t, null, null, new T.Vector3(pos.x + 3 + (i % 4) * 0.9, 0, pos.z - 2 + Math.floor(i / 4) * 2.5)));
  const frames = n => { for (let i = 0; i < n - 1; i++) a.step(1 / 60, false); a.step(1 / 60, true); };
  frames(45);
  a.input.queue.push('attack'); frames(20); a.input.queue.push('dodge'); frames(20);
  for (let s = 0; s < 6; s++) { p.cds.fill(0); p.mp = p.maxMp; a.input.queue.push('skill' + s); frames(16); frames(8); }
  for (const e of b.enemies) if (e.alive) e.hurt?.(1e9, { dirx: 1, dirz: 0 });
  frames(40);
  return a.renderer.r.info.programs.length;
});
const events = await page.evaluate(() => window.__events);
const late = events.filter(e => e.phase.startsWith('late'));
const report = { origin, hero, totalPrograms: programs, compiledDuringPrepare: events.filter(e => e.phase === 'prepare').length, compiledAfterLoading: late.length,
  lateMs: +late.reduce((s, e) => s + e.ms, 0).toFixed(1), late, note: 'SwiftShader 의 ms 는 실기기와 다르다. 프로그램 수가 정본 지표.' };
await fsp.writeFile(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ hero, totalPrograms: programs, compiledDuringPrepare: report.compiledDuringPrepare, compiledAfterLoading: late.length, lateMs: report.lateMs, late: late.map(e => `${e.phase} ${e.material}${e.map ? '+map' : ''} side${e.side} ${e.key} ${e.ms}ms in ${e.chain.join('/')}`) }, null, 1));
await browser.close();
if (late.length) process.exitCode = 1;
