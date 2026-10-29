/**
 * 소환 졸병 근접 확인 — 관문에 들어가 그 관문의 대장(던전 대장이면 dungeonBossId)을 영웅 앞에 세우고 실제 summonMinions 로
 * 졸병을 부른 직후를 844×390 으로 찍는다. 졸병이 그 장 전용 몸(stages.js CHAPTER_SPECIES)으로 나오는지 보는 도구다.
 *   node tools/summon-closeup.mjs <장-관문 …> [--out work/qa/summon]   예: node tools/summon-closeup.mjs 1-1 2-1 3-8 4-2 6-3
 * 전제: bun run build 산출물(dist). swiftshader 소프트웨어 렌더라 GPU 프레임·실기기 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const args = process.argv.slice(2), outAt = args.indexOf('--out');
const OUT = resolve(PROJ, outAt >= 0 ? args[outAt + 1] : 'work/qa/summon'), PORT = 4299;
const STAGES = args.filter((a, i) => /^\d+-\d+$/.test(a) && !(outAt >= 0 && i === outAt + 1));
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const report = { viewport: '844x390@2x', renderer: 'swiftshader', shots: [] };
try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (const code of STAGES) {
    const [ch, st] = code.split('-').map(Number);
    const info = await page.evaluate(async ([ch, st]) => {
      const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = (ch - 1) * 10 + st; e.save();
      a.battle?.stop?.();
      await a.startStage(e.nextStage()); a.testPause = true;
      const b = a.battle, p = b.player;
      p.auto = false; p.hp = p.maxHp; p.invuln = 999;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const V = p.pos.constructor, bossAt = p.pos.clone().add(new V(6.5, 0, 0));
      const boss = b.spawnEnemy(b.stage.encounter.enemyId, null, b.curRoom, bossAt);
      if (!boss) return { error: 'boss spawn failed' };
      boss.atkCd = 999;
      const before = new Set(b.enemies);
      // 시작 방은 정화(cleared) 상태라 실제 소환이 취소된다 — 대장 방을 전투 중으로 되돌린 뒤 부른다.
      if (boss.homeRoom) boss.homeRoom.cleared = false;
      b.summonMinions(boss, 3);
      const hold = () => { boss.pos.copy(bossAt); boss.vel.set(0, 0, 0); boss.atkCd = 999; boss.face?.(p.pos.x, p.pos.z); };
      // 소환 타이머(0.12초 간격)를 돌린 뒤, 졸병을 대장과 영웅 사이에 한 줄로 세워 몸이 가리지 않게 한다.
      for (let k = 0; k < 30; k++) { hold(); a.step(1 / 60, false); }
      const minions = b.enemies.filter((x) => x.alive && !before.has(x));
      minions.forEach((m, i) => { m.at = p.pos.clone().add(new V(3.4, 0, (i - (minions.length - 1) / 2) * 2.2)); });
      for (let k = 0; k < 150; k++) { hold(); for (const m of minions) { m.pos.copy(m.at); m.vel.set(0, 0, 0); m.atkCd = 999; m.face?.(p.pos.x, p.pos.z); } a.step(1 / 60, k === 149); }
      return { cleared: boss.homeRoom?.cleared ?? null, alive: b.enemies.filter((x) => x.alive).length, max: b.maxAlive, code: b.stage.code, dungeon: b.stage.dungeon?.id ?? null, boss: { id: boss.runtimeSpeciesId, name: boss.def.name, summon: boss.def.summon },
        minions: minions.map((m) => ({ id: m.runtimeSpeciesId, name: m.def.name, model: m.def.model, asset: m.libraryAsset?.id || null, dress: m.dress?.props || null })) };
    }, [ch, st]);
    await page.waitForTimeout(300);
    const file = `${OUT}/summon-${code}.png`;
    await page.screenshot({ path: file });
    // 근접: 졸병들을 정면 3/4에서 한 화면에(HUD 제외 캔버스).
    const close = await page.evaluate(() => {
      const a = window.app, b = a.battle, r = a.renderer, cam = r.camera, p = b.player;
      const ms = b.enemies.filter((x) => x.alive && !x.def.boss);
      if (!ms.length) return null;
      const cx = ms.reduce((s, m) => s + m.pos.x, 0) / ms.length, cz = ms.reduce((s, m) => s + m.pos.z, 0) / ms.length;
      const saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
      cam.position.set(cx - 5.2, 2.6, cz + 2.4); cam.lookAt(cx, 0.9, cz); cam.updateMatrixWorld();
      r.render(); const data = r.r.domElement.toDataURL('image/png');
      cam.position.copy(saved.p); cam.quaternion.copy(saved.q);
      return data;
    });
    if (close) writeFileSync(`${OUT}/summon-${code}-close.png`, Buffer.from(close.split(',')[1], 'base64'));
    report.shots.push({ file, close: close ? `${OUT}/summon-${code}-close.png` : null, ...info });
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(OUT, 'summon-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
}
