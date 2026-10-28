/**
 * 장 의상 근접 확인 — 한 장의 1관문에 들어가 그 장 종(species)을 영웅 앞에 한 줄로 세우고 대기 자세로 찍는다.
 * 소품이 뼈에 맞게 붙었는지(위치·방향·크기)를 보는 도구다. 시계는 app.step 고정 dt.
 *   node tools/dress-closeup.mjs [장=1] [출력폴더=work/qa/dress] [접두어=after]
 * 전제: bun run build 산출물(dist). swiftshader 소프트웨어 렌더라 GPU 프레임·실기기 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const CH = Number(process.argv[2] || 1), OUT = resolve(PROJ, process.argv[3] || 'work/qa/dress'), TAG = process.argv[4] || 'after', PORT = 4298;
mkdirSync(OUT, { recursive: true });
// 줄마다 4마리, 영웅 앞(+x) 줄을 세운다.
const LINEUPS = {
  1: [
    ['skel_minion', 'skel_shield', 'skel_rogue', 'elite_skel_captain'],
    ['skel_mage', 'skel_priest', 'bone_orc', 'elite_bone_lord'],
    ['ghost', 'ghost_skull', 'elite_wraith', 'bomb_slime'],
    ['grave_burrower', 'garden_midboss', 'garden_finalboss'],
  ],
  2: [
    ['orc', 'orc_blob', 'tribal', 'cacto_wall'],
    ['bomb_imp', 'imp', 'ash_burrower', 'hywirl'],
    ['tribal_shaman', 'armabee', 'elite_orc_chief', 'elite_bluedemon'],
    ['forge_midboss', 'forge_finalboss'],
  ],
  3: [
    ['skel_shield', 'bone_orc', 'skel_rogue', 'golem_guard'],
    ['ghost', 'ghost_skull', 'skel_mage', 'skel_priest'],
    ['blob_green', 'frost_burrower', 'elite_yeti', 'elite_golem'],
    ['elite_wraith', 'frost_midboss', 'frost_finalboss'],
  ],
  4: [
    ['squidle', 'glub', 'abyss_seer', 'blob_pink'],
    ['bomb_abyss', 'alien', 'mushnub', 'golem_guard'],
    ['elite_golem', 'elite_mushroom_king', 'elite_dragonling', 'armabee_evo'],
    ['tide_midboss', 'tide_finalboss', 'skel_minion'],
  ],
  5: [
    ['ninja', 'alien', 'skel_shield', 'bone_orc'],
    ['imp', 'bomb_abyss', 'abyss_seer', 'tribal_shaman'],
    ['elite_bluedemon', 'elite_dragonling', 'elite_skel_captain', 'skel_priest'],
    ['crown_midboss', 'crown_finalboss', 'ghost'],
  ],
  6: [
    ['skel_minion', 'orc', 'ghost', 'ninja'],
    ['squidle', 'golem_guard', 'skel_mage', 'imp'],
    ['homecoming_midboss', 'homecoming_finalboss'],
  ],
  7: [
    ['skel_minion', 'skel_shield', 'skel_rogue', 'bone_orc'],
    ['ghost', 'ghost_skull', 'blob_green', 'skel_mage'],
    ['skel_priest', 'elite_skel_captain', 'elite_wraith', 'elite_bone_lord'],
  ],
};
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const report = { tag: TAG, chapter: CH, rows: [] };
try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (const [row, species] of (LINEUPS[CH] || []).entries()) {
    const info = await page.evaluate(async ([ch, species]) => {
      const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = (ch - 1) * 10 + 1; e.save();
      a.battle?.stop?.();
      await a.startStage(e.nextStage()); a.testPause = true;
      const b = a.battle, p = b.player; p.auto = false; p.hp = p.maxHp; p.invuln = 999;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const spawned = species.map((id, i) => {
        const at = p.pos.clone().add(new p.pos.constructor(4.2, 0, (i - (species.length - 1) / 2) * 2.3));
        const en = b.spawnEnemy(id, null, b.curRoom, at);
        return en && { id, at, en };
      }).filter(Boolean);
      for (let k = 0; k < 240; k++) { for (const s of spawned) { s.en.pos.copy(s.at); s.en.vel.set(0, 0, 0); s.en.atkCd = 999; s.en.face?.(p.pos.x, p.pos.z); } a.step(1 / 60, k === 239); }
      const st = b.stage;
      return { stage: { code: st.code, chapter: st.chapter?.id ?? null, ch: st.ch, expedition: !!st.expedition, keys: Object.keys(st).slice(0, 12) }, enemies: spawned.map((s) => ({ id: s.id, asset: s.en.libraryAsset?.id || null, dress: s.en.dress?.props || null })) };
    }, [CH, species]);
    await page.waitForTimeout(300);
    // 근접 초상: 각 적을 앞 3/4·뒤 3/4 두 방향에서 게임 카메라를 잠시 옮겨 렌더하고 캔버스만 받는다(HUD 제외).
    const portraits = await page.evaluate(() => {
      const a = window.app, b = a.battle, r = a.renderer, cam = r.camera, saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
      const out = [];
      for (const en of b.enemies.filter((x) => x.alive)) {
        const h = Math.max(1.4, (en.libraryAsset?.heightM || 2) * en.model.scale.x * (en.model.parent?.scale?.x || 1));
        const yaw = en.yaw ?? 0, shots = [];
        for (const side of [0.6, Math.PI - 0.6]) {
          const ang = yaw + side, d = h * 1.9;
          cam.position.set(en.pos.x + Math.sin(ang) * d, en.pos.y + h * 0.9, en.pos.z + Math.cos(ang) * d);
          cam.lookAt(en.pos.x, en.pos.y + h * 0.5, en.pos.z); cam.updateMatrixWorld();
          r.render(); shots.push(r.r.domElement.toDataURL('image/png'));
        }
        out.push({ id: en.runtimeSpeciesId, shots });
      }
      cam.position.copy(saved.p); cam.quaternion.copy(saved.q);
      return out;
    });
    for (const pt of portraits) pt.shots.forEach((data, k) => writeFileSync(`${OUT}/${TAG}-ch${CH}-${pt.id}-${k ? 'back' : 'front'}.png`, Buffer.from(data.split(',')[1], 'base64')));
    const file = `${OUT}/${TAG}-ch${CH}-row${row + 1}.png`;
    await page.screenshot({ path: file });
    report.rows.push({ file, ...info });
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(OUT, `${TAG}-ch${CH}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
}
