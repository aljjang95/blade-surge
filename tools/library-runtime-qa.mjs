/**
 * TLL 에셋 라이브러리 런타임 QA — manifest 의 교체 몬스터가 실제 전투에서 Tripo 모델로 스폰되고
 * 논리 애니메이션(idle/run/attack/hit/death)이 재생되는지 단언하고 화면을 남긴다.
 *   node tools/library-runtime-qa.mjs [출력폴더=work/library-qa]
 * 전제: bun run build 산출물(dist)을 vite preview 로 띄운다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4231, OUT = resolve(PROJ, process.argv[2] || 'work/library-qa');
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(PROJ, 'asset-library/manifest.json'), 'utf8'));
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }

const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, detail ?? ''); };
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (const asset of manifest.assets.filter((a) => a.kind === 'character' && a.replaces)) {
    const enemyKey = await page.evaluate((model) => Object.entries(window.__EN || {}).find(([, d]) => d.model === model)?.[0] || null, asset.replaces);
    if (!enemyKey) { check(`${asset.id}: 교체 대상 적 정의`, false, asset.replaces); continue; }
    const info = await page.evaluate(async ({ enemyKey }) => {
      const a = window.app, e = a.eco;
      a.testPause = false; e.s.energy = 9999; e.save();
      a.battle.stop?.(); await a.startStage(e.nextStage()); a.testPause = true;
      const b = a.battle, p = b.player, V = p.pos.constructor;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const spawned = [];
      for (let i = 0; i < 6; i++) { const ang = i / 6 * Math.PI * 2; spawned.push(b.spawnEnemy(enemyKey, null, b.curRoom, p.pos.clone().add(new V(Math.cos(ang) * 4, 0, Math.sin(ang) * 4)))); }
      for (let i = 0; i < 90; i++) a.step(1 / 60, i === 89);
      const list = b.enemies.filter((x) => x.alive && x.def.model && x.type === window.__EN[enemyKey].name);
      const first = list[0];
      return { count: list.length, rig: first?.rigName, role: window.__EN[enemyKey].meleeRole || null, library: first?.model?.userData?.libraryAsset?.id || first?.model?.children?.[0]?.userData?.libraryAsset?.id || null,
        clips: first ? Object.keys(first.clips) : [], action: first?.actionName };
    }, { enemyKey });
    check(`${asset.id}: '${asset.replaces}' 스폰`, info.count > 0, `${info.count}마리`);
    check(`${asset.id}: library 리그 사용`, info.rig === 'library', info.rig);
    check(`${asset.id}: 7개 논리 클립 보유`, ['idle','walk','run','attack','attackHeavy','hit','death'].every((c) => info.clips.includes(c)), info.clips.join(','));
    await page.screenshot({ path: `${OUT}/${asset.id}-approach.png` });
    // 플레이어 공격으로 피격·사망 애니메이션까지 진행
    const after = await page.evaluate(() => {
      const b = window.app.battle, p = b.player; const seen = new Set();
      const lib = () => b.enemies.filter((en) => en.rigName === 'library');
      const watch = () => { for (const en of lib()) if (en.actionName) seen.add(en.actionName); };
      // 1) 플레이어 곁으로 붙여 실제 AI 공격을 유도한다(최대 6초).
      for (let k = 0; k < 360 && !seen.has('attack') && !seen.has('attackHeavy'); k++) {
        for (const en of lib()) if (en.alive && k % 30 === 0) { en.pos.x = p.pos.x + 1.2; en.pos.z = p.pos.z; }
        window.app.step(1 / 60, k % 60 === 0); watch();
      }
      // 2) 피격 → 처치. 적 체력 비례 피해로 몸집 큰 정예·보스도 확실히 쓰러뜨린다.
      for (let k = 0; k < 240; k++) {
        if (k % 20 === 0) for (const en of lib()) if (en.alive) en.hurt(Math.ceil(en.maxHp * 0.3), { kb: 0.1, kind: 'slash', hitReact: true });
        window.app.step(1 / 60, k % 40 === 0); watch();
      }
      return [...seen];
    });
    // 공격과 사망은 반드시 재생돼야 한다(사망은 처치 순간 die() 경로).
    // 돌진(charger) 역할은 원작 설계상 달리기 몸통 박치기로 공격한다.
    const attackClips = info.role === 'charger' ? ['run'] : ['attack', 'attackHeavy'];
    check(`${asset.id}: 공격 클립 재생${info.role ? ` (${info.role})` : ''}`, attackClips.some((clip) => after.includes(clip)), after.join(','));
    check(`${asset.id}: 사망 클립 재생`, after.includes('death'), after.join(','));
    await page.screenshot({ path: `${OUT}/${asset.id}-combat.png` });
  }
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

