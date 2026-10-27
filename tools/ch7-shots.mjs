/**
 * 7장 종탑 실제 화면 캡처·크기 측정 — 7-1 종지기, 7-5 중간 보스, 7-10 최종 보스를 실제 빌드에서 띄워
 * 영웅 대비 높이와 로드된 라이브러리 자산 id 를 재고 844×390·640×360 으로 찍는다. 시계는 app.step 고정 dt 로 직접 진행한다.
 *   node tools/ch7-shots.mjs [출력폴더=work/qa/ch7] [접두어=after]
 * 전제: bun run build 산출물(dist). GPU 프레임·실기기 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const PORT = 4296, OUT = resolve(PROJ, process.argv[2] || 'work/qa/ch7'), TAG = process.argv[3] || 'after';
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 844, height: 390 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
const report = { tag: TAG, scenes: {} };
const enter = (st) => page.evaluate(async (st) => {
  const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = 60 + st; e.save();
  a.battle?.stop?.();
  const stage = e.nextStage();
  await a.startStage(stage); a.testPause = true;
  const b = a.battle, p = b.player; p.auto = false;
  for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
  p.hp = p.maxHp; p.invuln = 0;
  return stage.code;
}, st);
// 영웅·적의 실제 월드 높이(메시 바운딩 박스 합)와 로드된 자산 정보. 부유체는 박스 바닥 y(minY)로 호버 높이를 본다.
const measure = () => page.evaluate(() => {
  const b = window.app.battle, p = b.player;
  // 스킨드 메시의 정점 박스는 단위가 어긋나 믿을 수 없다. 뼈 월드 위치 박스(관절 중심 높이)와 자산 규격 높이 × 최종 모델 배율을 함께 남긴다.
  const box = (a) => {
    let minY = 1e9, maxY = -1e9; a.model.updateWorldMatrix(true, true);
    const v = new a.pos.constructor();
    a.model.traverse((o) => { if (o.isBone) { o.getWorldPosition(v); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); } });
    const hm = a.libraryAsset?.heightM ?? null, sc = a.model.scale.x;
    return { boneMinY: +minY.toFixed(2), boneH: +(maxY - minY).toFixed(2), heightM: hm, modelScale: +sc.toFixed(3), effH: hm ? +(hm * sc * (a.model.parent?.scale?.x || 1)).toFixed(2) : null };
  };
  const info = (e) => ({ type: e.type, model: e.def?.model, asset: e.libraryAsset?.id || null, rosterAsset: e.libraryRoster?.asset || null, rosterScale: e.libraryRoster?.scale ?? null, defScale: e.def?.scale, radius: +e.radius.toFixed(2), clips: Object.keys(e.clips).length, ...box(e) });
  return { hero: { ...box(p), radius: +p.radius.toFixed(2), asset: p.libraryAsset?.id || null }, enemies: b.enemies.filter((e) => e.alive).map(info) };
});
const shoot = async (scene) => {
  for (const [w, h] of [[844, 390], [640, 360]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
    await page.evaluate(() => { for (let k = 0; k < 90; k++) window.app.step(1 / 60, k === 89); });
    await page.waitForTimeout(300);
    const f = `${OUT}/${TAG}-${scene}-${w}x${h}.png`; await page.screenshot({ path: f });
    report.scenes[scene].shots = { ...(report.scenes[scene].shots || {}), [`${w}x${h}`]: f };
  }
  await page.setViewportSize({ width: 844, height: 390 });
};
const SPAWN = { bellringer: ['bell_ringer', 1], midboss: ['belltower_midboss', 5], finalboss: ['belltower_finalboss', 10] };
try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (const [scene, [key, st]] of Object.entries(SPAWN)) {
    const code = await enter(st);
    // 영웅 앞 6m(보스는 8m)에 세우고 대기 자세로 둔다. 방 중심이 아니라 플레이어 기준이라 카메라 구도는 실제 전투와 같다.
    await page.evaluate(([key, d]) => {
      const a = window.app, b = a.battle, p = b.player;
      const at = p.pos.clone().add(new p.pos.constructor(d, 0, 0));
      const e = b.spawnEnemy(key, null, b.curRoom, at);
      for (let k = 0; k < 240 && e.spawning; k++) a.step(1 / 60, false);
      // 등장이 끝나면 제자리 대기로 고정한다(공격·이동 없음).
      for (let k = 0; k < 60; k++) { e.pos.copy(at); e.vel.set(0, 0, 0); e.atkCd = 999; if (e.bellringer) e.bellringer.cd = 999; a.step(1 / 60, false); }
    }, [key, { bellringer: 3.2, midboss: 4.2, finalboss: 5.6 }[scene]]);
    report.scenes[scene] = { code, ...(await measure()) };
    await shoot(scene);
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(OUT, `${TAG}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
}
