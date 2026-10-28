/**
 * 장별 몬스터·던전 정체성 캡처 — 장 1~7 의 X-1/X-3/X-5/X-10 관문에서 자연 스폰 적과 환경을 844×390 으로 찍고 report json 을 남긴다.
 *   node tools/monster-identity-shots.mjs [출력폴더=work/qa/identity] [접두어=before]
 * 전제: bun run build 산출물(dist). 관문 → unlocked = (장-1)*10 + 관문 (Economy.nextStage 규칙).
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const PORT = 4297, OUT = resolve(PROJ, process.argv[2] || 'work/qa/identity'), TAG = process.argv[3] || 'before';
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
const report = { tag: TAG, scenes: {} };

const enter = (unlocked) => page.evaluate(async (unlocked) => {
  const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = unlocked; e.save();
  a.battle?.stop?.();
  const stage = e.nextStage();
  await a.startStage(stage); a.testPause = true;
  const p = a.battle.player; p.auto = false; p.hp = p.maxHp;
  return stage.code;
}, unlocked);

// 자연 스폰 진행 → 공격 정지 → 화면 밖 적은 영웅 앞 4~7m 로 이동 → 요약.
const settle = (st) => page.evaluate((st) => {
  const a = window.app, b = a.battle, p = b.player, cam = a.renderer.camera;
  // 시작 방은 비어 있다 — 자연 진입처럼 플레이어를 다음 방(5·10 관문은 보스방 우선) 중앙으로 옮겨 enterRoom 이 무리를 깔게 한다.
  const rooms = b.world.rooms.filter((r) => r.type !== 'start' && !r.cleared);
  const isB = (r) => r === b.world.bossRoom;
  const target = ((st >= 5) ? rooms.find(isB) : null) || rooms.find((r) => !isB(r)) || rooms[0];
  if (target) { p.pos.set(target.x, p.pos.y, target.z); if (b.enterRoom && b.curRoom !== target) b.enterRoom(target); }
  for (let k = 0; k < 150; k++) a.step(1 / 60, false);
  const freeze = () => { p.invuln = 999; p.hp = p.maxHp; for (const en of b.enemies) if (en.alive) { en.atkCd = 999; if (en.bellringer) en.bellringer.cd = 999; } };
  freeze();
  const V = p.pos.constructor, v = new V();
  const onScreen = (en) => { v.copy(en.pos); v.y += 1; v.project(cam); return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1; };
  const alive = () => b.enemies.filter((e) => e.alive);
  let moved = 0;
  const lst = alive();
  if (lst.filter(onScreen).length < Math.min(3, lst.length)) {
    lst.slice(0, 6).forEach((en, i) => { if (onScreen(en)) return; const d = 4 + (i % 4) * 0.9, z = (i - 2.5) * 1.3; en.pos.set(p.pos.x + d, p.pos.y, p.pos.z + z); en.vel?.set(0, 0, 0); moved++; });
  }
  for (let k = 0; k < 30; k++) { freeze(); a.step(1 / 60, k === 29); }
  const col = (c) => c?.isColor ? '#' + c.getHexString() : (c ?? null);
  const scene = a.scene, lights = {};
  scene.traverse((o) => { if (o.isLight) { const t = o.type; (lights[t] ||= []).push({ color: col(o.color), i: +o.intensity.toFixed(2) }); } });
  const stage = b.stage;
  return {
    room: target ? { type: target.type, boss: isB(target) } : null, moved, onScreen: alive().filter(onScreen).length,
    chapterTheme: stage.chapter?.theme, chapterName: stage.chapter?.name, dungeonId: stage.dungeon?.id ?? null,
    fog: scene.fog ? { type: scene.fog.type, color: col(scene.fog.color), near: scene.fog.near ?? null, far: scene.fog.far ?? null, density: scene.fog.density ?? null } : null,
    background: col(scene.background),
    lights, lightCount: Object.fromEntries(Object.entries(lights).map(([k, v]) => [k, v.length])),
    enemies: alive().map((e) => ({
      type: e.type, model: e.def?.model, asset: e.libraryAsset?.id || null, tint: e.def?.tint != null ? (typeof e.def.tint === 'number' ? '#' + e.def.tint.toString(16).padStart(6, '0') : e.def.tint) : null,
      scale: e.def?.scale ?? null, isElite: !!(e.isElite ?? e.elite ?? e.def?.elite), isBoss: !!(e.isBoss ?? e.boss ?? e.def?.boss), screen: onScreen(e),
    })),
  };
}, st);

try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (let ch = 1; ch <= 7; ch++) for (const st of [1, 3, 5, 10]) {
    const name = `ch${ch}-${st}`;
    try {
      const code = await enter((ch - 1) * 10 + st);
      const info = await settle(st);
      const sk = await page.evaluate(() => { const t = window.app.battle.stage; return { expedition: t.expedition ? { id: t.expedition.id } : undefined, dungeon: t.dungeon ? { id: t.dungeon.id, landmark: t.dungeon.landmark } : undefined, chapter: { theme: t.chapter?.theme } }; });
      info.dungeonVisual = dungeonVisualFor(sk)?.key ?? null;
      await page.evaluate(() => { for (let k = 0; k < 3; k++) window.app.step(1 / 60, true); }); await page.waitForTimeout(500);
      const f = `${OUT}/${TAG}-${name}.png`; await page.screenshot({ path: f });
      report.scenes[name] = { code, shot: f, ...info };
    } catch (err) { report.scenes[name] = { error: String(err).slice(0, 300) }; errors.push(`${name}: ${err}`); }
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(OUT, `${TAG}-report.json`), JSON.stringify(report, null, 2));
  console.log(Object.entries(report.scenes).map(([k, s]) => `${k} ${s.code} dv=${s.dungeonVisual} on=${s.onScreen} ${s.error || ''}`).join('\n'));
  await br.close(); srv.kill();
}
