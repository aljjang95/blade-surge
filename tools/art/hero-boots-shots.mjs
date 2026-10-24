/**
 * 등급 부츠 촬영·접지 측정 — 실제 빌드(dist)를 vite preview 로 띄우고 Playwright Chromium(SwiftShader)에서
 * 영웅마다 신발 등급(N·S·E·U·L)의 실제 신발 아이템을 저장 상태(app.eco) 인벤토리에 넣어 장착시킨 뒤(look.js applyLook → syncHeroBoots)
 *   ① 로비 기본 카메라 390x844·1280x720 ② 전투 기본 카메라 390x844·1280x720
 *   ③ 발 근접(정면 대각·옆 두 시점 한 장): 로비 대기, 전투 대기·달리기·기본 공격·회피 중간 프레임
 * 을 찍고, 같은 프레임에서 부츠 밑창 최저점·몸 원래 발바닥 최저점의 바닥 기준 높이(cm)를 잰다.
 *   bun run build && node tools/art/hero-boots-shots.mjs <outDir> [--heroes knight,mage,rogue,barbarian,ranger] [--grades N,S,E,U,L] [--armor <갑옷 id>] [--dist dist]
 * 출력: <hero>_<grade>_<장면>.png, report.json(장면별 부착 부츠 id·배율, 접지 측정, 콘솔 오류, 기대와 다른 부착).
 * 기대 부츠(N=없음, S=boots_n, E·U=boots_e, L=boots_l)와 다르면 exit 1. SwiftShader 화면이며 실기기 증거가 아니다.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const outArg = args.find((a, i) => !a.startsWith('--') && !['--dist', '--heroes', '--grades', '--armor'].includes(args[i - 1]));
const HEROES = flag('--heroes', 'knight,mage,rogue,barbarian,ranger').split(',');
const GRADES = flag('--grades', 'N,S,E,U,L').split(',');
// 선택: 갑옷 단계 몸 교체(예: a_town_ember = 2단계)와 함께 확인할 때 갑옷 아이템 id.
const ARMOR = flag('--armor', '');
// 등급별 대표 신발(src/data/items.js 마을 신발). 부츠 매핑은 src/data/hero-boots.json 과 같다.
const BOOT_ITEM = { N: 'b_cloth', S: 'b_swift', E: 'b_knight', U: 'b_storm', L: 'b_sky' };
const EXPECT = { N: null, S: 'boots_n', E: 'boots_e', U: 'boots_e', L: 'boots_l' };
if (!outArg || HEROES.some((h) => !['knight', 'barbarian', 'mage', 'ranger', 'rogue'].includes(h)) || GRADES.some((g) => !BOOT_ITEM[g])) {
  console.error('사용: node tools/art/hero-boots-shots.mjs <outDir> [--heroes knight,...] [--grades N,S,E,U,L] [--dist dist]'); process.exit(2);
}
const PROJ = resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname));
const OUT = resolve(outArg), DIST = resolve(PROJ, flag('--dist', 'dist')), PORT = 4297 + Math.floor(Math.random() * 400);
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 720 }];
mkdirSync(OUT, { recursive: true });
const report = { at: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJ }).toString().trim(), dist: DIST, errors: [], warnings: [], cases: [], mismatches: [] };

const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }

/** 페이지 안 도우미: 부착 상태, 접지 측정, 발 근접 렌더. */
function installHelpers() {
  const T = window.__THREE, app = window.app, q = {};
  const rootOf = () => app.mode === 'battle' ? app.battle?.player?.model : app.showcase?.root;
  const norm = (n) => String(n || '').replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');
  const bone = (root, name) => { let found = null; root.traverse((o) => { if (!found && o.isBone && norm(o.name) === name) found = o; }); return found; };
  const bodyOf = (root) => { let s = null; root.traverse((o) => { if (!s && o.isSkinnedMesh && o.userData.libraryBody) s = o; }); return s; };
  q.state = () => {
    const root = rootOf(); if (!root) return null;
    const boots = root.userData.heroBoots || null, body = bodyOf(root);
    return { mode: app.mode, hero: root.userData.heroId ?? app.showcase?.def?.id ?? null, body: root.userData.libraryBodyAssetId ?? null,
      boots: boots?.id ?? null, target: root.userData.bootsTargetId ?? null, feetHidden: root.userData.gearRim?.hideFeet?.value === 1,
      bootsMesh: boots ? { name: boots.mesh.name, vertices: boots.mesh.geometry.attributes.position.count, parent: boots.mesh.parent?.name } : null };
  };
  // 스킨 적용 뒤 월드 y 최저점(바닥 = 영웅 root 월드 y). filter(i) 로 정점을 고른다.
  const lowest = (mesh, filter) => {
    const v = new T.Vector3(); let min = Infinity; const n = mesh.geometry.attributes.position.count;
    mesh.updateMatrixWorld(true); mesh.skeleton?.update();
    for (let i = 0; i < n; i += 2) { if (filter && !filter(i)) continue; mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y < min) min = v.y; }
    return min;
  };
  q.contact = () => {
    const root = rootOf(); if (!root) return null;
    root.updateWorldMatrix(true, true);
    const ground = root.getWorldPosition(new T.Vector3()).y, body = bodyOf(root), boots = root.userData.heroBoots?.mesh;
    let footMin = null;
    if (body) {
      const feet = new Set(['RightFoot', 'LeftFoot', 'RightToeBase', 'LeftToeBase'].map((n) => body.skeleton.bones.findIndex((b) => norm(b.name) === n)).filter((k) => k >= 0));
      const si = body.geometry.attributes.skinIndex, sw = body.geometry.attributes.skinWeight;
      footMin = lowest(body, (i) => { let w = 0; for (let k = 0; k < 4; k++) if (feet.has(si.getComponent(i, k))) w += sw.getComponent(i, k); return w > 0.5; });
    }
    const cm = (y) => y === null || !Number.isFinite(y) ? null : +((y - ground) * 100).toFixed(1);
    return { bootsSoleCm: boots ? cm(lowest(boots)) : null, bodyFootSoleCm: cm(footMin) };
  };
  // 발 근접: 정면 대각·옆 두 시점을 한 장(1024x512)에.
  q.closeup = () => {
    const root = rootOf(); if (!root) return null;
    root.updateWorldMatrix(true, true);
    const cam = app.renderer.camera, canvas = app.renderer.r.domElement;
    const rf = bone(root, 'RightFoot'), lf = bone(root, 'LeftFoot'), hips = bone(root, 'Hips');
    if (!rf || !lf || !hips) return null;
    const a = rf.getWorldPosition(new T.Vector3()), b = lf.getWorldPosition(new T.Vector3()), h = hips.getWorldPosition(new T.Vector3());
    // 공격·회피에서는 발이 벌어지고 root 높이와 바닥이 어긋나므로 두 발목 중점과 발 간격으로 구도를 잡는다.
    const center = a.clone().add(b).multiplyScalar(0.5), spread = a.distanceTo(b);
    const leg = Math.max(0.2, h.y - Math.min(a.y, b.y), spread * 0.9);
    const front = new T.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
    const right = new T.Vector3().crossVectors(front, new T.Vector3(0, 1, 0)).normalize();
    const views = [center.clone().addScaledVector(front, leg * 1.5).addScaledVector(right, leg * 0.9).add(new T.Vector3(0, leg * 0.45, 0)),
      center.clone().addScaledVector(right, leg * 1.8).add(new T.Vector3(0, leg * 0.2, 0))];
    const saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const out = document.createElement('canvas'); out.width = 1024; out.height = 512; const ctx = out.getContext('2d');
    views.forEach((pos, i) => {
      cam.position.copy(pos); cam.lookAt(center); cam.updateMatrixWorld(true);
      app.renderer.render();
      const side = Math.min(canvas.width, canvas.height); ctx.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, i * 512, 0, 512, 512);
    });
    cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.updateMatrixWorld(true);
    return out.toDataURL('image/png');
  };
  window.__bootsQA = q;
}

const br = await chromium.launch(launchOpts());
let exitCode = 0;
try {
  const ctx = await br.newContext({ viewport: SIZES[0], deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text().slice(0, 240));
    if (m.type() === 'warning' && /boots/i.test(m.text())) report.warnings.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => report.errors.push('PAGEERR ' + e.message.slice(0, 240)));
  page.on('response', (r) => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  const closePopups = async () => { const stop = page.getByRole('button', { name: '그만 보기' }).first(); if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {}); for (let i = 0; i < 4; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); await page.waitForTimeout(250); } } await page.evaluate(() => window.app.ui?.closeModal?.()).catch(() => {}); };
  const settle = async (frames = 60) => { await page.waitForTimeout(400); await page.evaluate((n) => { for (let i = 0; i < n; i++) window.app.step?.(1 / 60, false); window.app.renderer.render(); }, frames).catch(() => {}); await page.waitForTimeout(150); };
  const saveDataUrl = async (url, file) => { if (!url) return null; writeFileSync(`${OUT}/${file}`, Buffer.from(url.split(',')[1], 'base64')); return file; };
  const waitBoots = (expected) => page.waitForFunction((id) => { const s = window.__bootsQA.state(); return s && (s.boots ?? null) === id && (id === null || s.target === id); }, expected, { timeout: 45000 }).then(() => true, () => false);

  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
  await page.waitForTimeout(1200); await closePopups();
  await page.evaluate(installHelpers);

  for (const hero of HEROES) for (const grade of GRADES) {
    const id = `${hero}_${grade}${ARMOR ? '_' + ARMOR : ''}`, expected = EXPECT[grade], rec = { hero, grade, item: BOOT_ITEM[grade], expected, shots: [], scenes: {} };
    report.cases.push(rec);
    const check = (scene, state) => { if (!state || state.boots !== expected) report.mismatches.push({ case: id, scene, expected, state }); };
    try {
      await page.setViewportSize(SIZES[0]);
      if (await page.evaluate(() => window.app.mode) !== 'lobby') { await page.evaluate(() => window.app.toLobby()); await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 }); await closePopups(); }
      // 신발 장착(저장은 이 컨텍스트 안에서만) 후 쇼케이스를 그 영웅으로.
      await page.evaluate(async ({ hero, itemId, armorId }) => {
        const a = window.app, s = a.eco.s; a.testPause = false;
        a.eco.hero(hero);
        for (const id of [armorId, itemId].filter(Boolean)) { const inst = { uid: s.invSeq++, id, enh: 0 }; s.inventory.push(inst); a.eco.equip(hero, inst.uid); }
        s.selected = hero; a.eco.emit?.();
        a.meta?.openTab?.('home');
        await a.showcaseHero(hero, true);
      }, { hero, itemId: BOOT_ITEM[grade], armorId: ARMOR });
      await page.waitForFunction((h) => window.app.showcase?.def?.id === h, hero, { timeout: 60000 });
      rec.scenes.lobbyAttached = await waitBoots(expected);
      await closePopups(); await settle();
      const lobby = rec.scenes.lobby = { state: await page.evaluate(() => window.__bootsQA.state()), contact: await page.evaluate(() => window.__bootsQA.contact()) };
      check('lobby', lobby.state);
      for (const size of SIZES) {
        await page.setViewportSize(size); await page.waitForTimeout(500);
        if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click().catch(() => {});
        await page.evaluate(() => window.app.renderer.render()).catch(() => {});
        const file = `${id}_lobby_${size.width}.png`; await page.screenshot({ path: `${OUT}/${file}`, timeout: 120000 });   // 첫 장은 SwiftShader 셰이더 컴파일로 느리다 rec.shots.push(file);
      }
      await page.setViewportSize(SIZES[1]); await page.waitForTimeout(300);
      rec.shots.push(await saveDataUrl(await page.evaluate(() => window.__bootsQA.closeup()), `${id}_lobby_closeup.png`));

      // 전투: 같은 장비로 다음 스테이지. 무적·AUTO 끔으로 시작 상태를 고정한다.
      await page.setViewportSize(SIZES[0]);
      await page.evaluate(async (h) => { const a = window.app; a.ui.closeModal?.(); a.eco.s.energy = 9999; a.eco.s.selected = h; await a.startStage(a.eco.nextStage()); }, hero);
      await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, null, { timeout: 90000 });
      await closePopups();
      rec.scenes.battleAttached = await waitBoots(expected);
      await page.evaluate(() => { const p = window.app.battle.player; p.invuln = 1e9; p.auto = false; window.app.input.clear?.(); for (let i = 0; i < 90; i++) window.app.step(1 / 60, false); window.app.renderer.render(); });
      const battle = rec.scenes.battle = { state: await page.evaluate(() => window.__bootsQA.state()), contact: {} };
      check('battle', battle.state);
      for (const size of SIZES) {
        await page.setViewportSize(size); await page.waitForTimeout(500);
        if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click().catch(() => {});
        await page.evaluate(() => { window.app.step(1 / 60, false); window.app.renderer.render(); }).catch(() => {});
        const file = `${id}_battle_${size.width}.png`; await page.screenshot({ path: `${OUT}/${file}` }); rec.shots.push(file);
      }
      await page.setViewportSize(SIZES[1]); await page.waitForTimeout(300);
      // 동작별 중간 프레임: 대기 → 달리기(KeyD) → 기본 공격 1타 → 회피. 각 동작 동안 접지 최저·최고를 모은다.
      for (const pose of ['idle', 'run', 'attack', 'dodge']) {
        const result = await page.evaluate((pose) => {
          const app = window.app, p = app.battle.player, q = window.__bootsQA;
          const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
          const step = () => { p.invuln = 1e9; app.step(1 / 60, false); };
          for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) key('keyup', c);
          for (let i = 0; i < 90 && p.state !== 'idle'; i++) step();
          const samples = [];
          let frames = 40, mid = 20;
          if (pose === 'run') { key('keydown', 'KeyD'); frames = 50; mid = 36; }
          if (pose === 'attack') { p.cds?.fill?.(0); p.startCombo(0); const dur = p.def.combo[0].dur || .6; frames = Math.max(8, Math.round(dur * 60)); mid = Math.round(frames * .5); }
          if (pose === 'dodge') { p.dodge(null); frames = 19; mid = 9; }
          let image = null;
          for (let f = 0; f < frames; f++) {
            step();
            if (f % 3 === 0 || f === mid) samples.push(q.contact());
            if (f === mid) image = q.closeup();
          }
          if (pose === 'run') key('keyup', 'KeyD');
          const vals = (k) => samples.map((s) => s?.[k]).filter((v) => v !== null && v !== undefined);
          const range = (k) => { const v = vals(k); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
          return { image, state: p.state, bootsSoleCm: range('bootsSoleCm'), bodyFootSoleCm: range('bodyFootSoleCm'), samples: samples.length };
        }, pose);
        rec.shots.push(await saveDataUrl(result.image, `${id}_battle_${pose}.png`));
        delete result.image; battle.contact[pose] = result;
      }
    } catch (e) { rec.error = String(e.message || e).slice(0, 300); report.mismatches.push({ case: id, error: rec.error }); }
    console.log(JSON.stringify({ case: id, lobby: rec.scenes.lobby?.state?.boots ?? null, battle: rec.scenes.battle?.state?.boots ?? null, contact: rec.scenes.battle?.contact && Object.fromEntries(Object.entries(rec.scenes.battle.contact).map(([k, v]) => [k, v.bootsSoleCm])), error: rec.error }));
  }
} finally {
  report.ok = report.mismatches.length === 0;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
  if (!report.ok) exitCode = 1;
}
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors.length, warnings: report.warnings, mismatches: report.mismatches.length, ok: report.ok }));
process.exit(exitCode);
