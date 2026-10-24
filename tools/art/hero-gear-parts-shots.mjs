/**
 * 갑옷 외형 파츠(투구·어깨·건틀릿) 촬영·측정 — 실제 빌드(dist)를 vite preview 로 띄우고 Playwright Chromium(SwiftShader)에서
 * 영웅마다 갑옷 등급 케이스(N·S·E·U-storm·U-frost·L)의 실제 갑옷 아이템을 저장 상태(app.eco) 인벤토리에 넣어 장착시킨 뒤(look.js applyLook → syncHeroGearParts)
 *   ① 로비 기본 카메라 390x844·844x390·1280x800 ② 전투 기본 카메라 같은 크기 3종
 *   ③ 파츠 근접(머리·어깨 한 쌍·오른손 세 시점을 한 장): 로비 대기, 전투 대기·달리기·기본 공격·회피 중간 프레임
 * 을 찍고, 부착 상태(root.userData.heroGearParts)와 드로우콜·삼각형(renderer.info)을 파츠 보임/숨김으로 전후 비교해 잰다.
 *   bun run build && node tools/art/hero-gear-parts-shots.mjs <outDir> [--heroes knight,mage,rogue,barbarian,ranger] [--cases N,S,E,U1,U2,L] [--poses] [--quick] [--dev] [--dist dist]
 * 출력: <hero>_<case>_<장면>.png, report.json(부착 세트·삼각형·드로우콜 전후, 콘솔 경고·오류, 기대와 다른 부착).
 * 기대(등급 → 세트): N 없음 · S → parts_n · E·U → parts_e · L → parts_l. 다르면 exit 1. SwiftShader 화면이며 실기기 증거가 아니다.
 * 결과 폴더는 저장소에 커밋하지 않는다.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchOpts } from '../chrome.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const outArg = args.find((a, i) => !a.startsWith('--') && !['--dist', '--heroes', '--cases'].includes(args[i - 1]));
const HEROES = flag('--heroes', 'knight,ranger,mage,rogue,barbarian').split(',');
// 등급 케이스: 대표 갑옷 아이템(src/data/items.js)과 기대 세트(src/data/hero-gear-parts.json grades).
const CASES = {
  N: { armor: 'a_leather', expect: null },
  S: { armor: 'a_chain', expect: 'parts_n' },
  E: { armor: 'a_knight', expect: 'parts_e' },
  U1: { armor: 'a_storm', expect: 'parts_e' },     // 테마 storm
  U2: { armor: 'a_rime', expect: 'parts_e' },      // 테마 frost
  L: { armor: 'a_titan', expect: 'parts_l' },
};
const CASE_IDS = flag('--cases', 'N,S,E,U1,U2,L').split(',');
const POSES = args.includes('--poses');
// --quick: 로비 1280x800 + 근접만(맞춤 반복용). --dev: dist 대신 vite 개발 서버(데이터 JSON 수정이 바로 반영).
const MEASURE = args.includes('--measure');   // 촬영 없이 부착 상태·몸 치수만(--dev 와 함께)
const QUICK = args.includes('--quick') || MEASURE, DEV = args.includes('--dev');
if (!outArg || HEROES.some((h) => !['knight', 'barbarian', 'mage', 'ranger', 'rogue'].includes(h)) || CASE_IDS.some((c) => !CASES[c])) {
  console.error('사용: node tools/art/hero-gear-parts-shots.mjs <outDir> [--heroes knight,...] [--cases N,S,E,U1,U2,L] [--poses] [--quick] [--dev] [--dist dist]'); process.exit(2);
}
const PROJ = resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname));
const OUT = resolve(outArg), DIST = resolve(PROJ, flag('--dist', 'dist')), PORT = 4297 + Math.floor(Math.random() * 400);
const SIZES = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }];
mkdirSync(OUT, { recursive: true });
const report = { at: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJ }).toString().trim(), dist: DIST, errors: [], warnings: [], cases: [], mismatches: [] };

const viteArgs = DEV ? ['--port', String(PORT), '--strictPort'] : ['preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'];
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), ...viteArgs], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }

/** 페이지 안 도우미: 부착 상태, 렌더 통계(파츠 보임/숨김 전후), 파츠 근접 렌더. */
function installHelpers() {
  const T = window.__THREE, app = window.app, q = {};
  const rootOf = () => app.mode === 'battle' ? app.battle?.player?.model : app.showcase?.root;
  const norm = (n) => String(n || '').replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');
  const bone = (root, name) => { let found = null; root.traverse((o) => { if (!found && o.isBone && norm(o.name) === name) found = o; }); return found; };
  // 개발 서버 전용: 몸 치수 → 배율(= 치수 ÷ ref)을 읽는다(dist 번들에서는 모듈을 다시 가져올 수 없다).
  q.measures = async () => {
    try {
      const mod = await import('/src/engine/hero-gear-parts.js'), root = rootOf(); let skin = null;
      root.traverse((o) => { if (!skin && o.isSkinnedMesh && o.userData.libraryBody) skin = o; });
      const ref = { headTop: 0.2, shoulderSpan: 0.18, forearm: 0.25 };
      return Object.fromEntries(Object.entries(ref).map(([k, r]) => { const m = mod.heroSlotMeasure(skin, k); return [k, m && { measure: +m.toFixed(4), scale: +(m / r).toFixed(3) }]; }));
    } catch { return null; }
  };
  q.state = () => {
    const root = rootOf(); if (!root) return null;
    const st = root.userData.heroGearParts || null;
    return { mode: app.mode, hero: root.userData.heroId ?? app.showcase?.def?.id ?? null, body: root.userData.libraryBodyAssetId ?? null,
      parts: st?.pick?.set?.id ?? null, partList: st?.pick?.parts ?? null, target: root.userData.gearPartsTarget ?? null,
      meshes: st ? st.meshes.map((m) => ({ name: m.name, vertices: m.geometry.attributes.position.count, triangles: (m.geometry.index?.count ?? 0) / 3, parent: m.parent?.name })) : [] };
  };
  // 드로우콜·삼각형: 같은 프레임에서 파츠 메시를 숨겼다 보였다 하며 renderer.info 를 읽는다.
  q.stats = () => {
    const root = rootOf(); if (!root) return null;
    const meshes = root.userData.heroGearParts?.meshes || [], r = app.renderer.r;
    const read = () => { r.info.autoReset = false; r.info.reset(); app.renderer.render(); r.info.autoReset = true; return { calls: r.info.render.calls, triangles: r.info.render.triangles }; };
    const withParts = read();
    for (const m of meshes) m.visible = false;
    const without = read();
    for (const m of meshes) m.visible = true;
    app.renderer.render();
    return { withParts, without, deltaCalls: withParts.calls - without.calls, deltaTriangles: withParts.triangles - without.triangles };
  };
  // 파츠 근접: 머리·어깨(양쪽)·오른손 세 시점을 한 장(1536x512)에. 영웅 키(엉덩이→머리)를 단위로 거리를 잡는다.
  q.closeup = () => {
    const root = rootOf(); if (!root) return null;
    root.updateWorldMatrix(true, true);
    const cam = app.renderer.camera, canvas = app.renderer.r.domElement;
    const head = bone(root, 'Head'), hips = bone(root, 'Hips'), ra = bone(root, 'RightArm'), la = bone(root, 'LeftArm'), rh = bone(root, 'RightHand');
    if (!head || !hips || !ra || !la || !rh) return null;
    const P = (b) => b.getWorldPosition(new T.Vector3());
    const H = Math.max(0.4, P(head).y - P(hips).y);
    const front = new T.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
    const right = new T.Vector3().crossVectors(front, new T.Vector3(0, 1, 0)).normalize();
    const spot = (center, d, side, up) => ({ center, pos: center.clone().addScaledVector(front, d).addScaledVector(right, side * d).add(new T.Vector3(0, up * d, 0)) });
    const chest = P(ra).add(P(la)).multiplyScalar(0.5);
    const views = [spot(P(head).add(new T.Vector3(0, H * 0.25, 0)), H * 2.4, 0.4, 0.1), spot(chest, H * 3.2, 0.25, 0.15), spot(P(rh), H * 1.6, 0.5, 0.35)];
    const saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const out = document.createElement('canvas'); const base = q.base === true; out.width = 1536; out.height = base ? 1024 : 512; const ctx = out.getContext('2d');
    const meshes = root.userData.heroGearParts?.meshes || [];
    // base 이면 두 번째 줄에 파츠를 숨긴 같은 시점(몸 원래 모습)을 찍어 무엇이 파츠이고 무엇이 몸인지 구분한다.
    for (const row of base ? [0, 1] : [0]) {
      for (const m of meshes) m.visible = row === 0;
      views.forEach(({ center, pos }, i) => {
        cam.position.copy(pos); cam.lookAt(center); cam.updateMatrixWorld(true);
        app.renderer.render();
        const side = Math.min(canvas.width, canvas.height); ctx.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, i * 512, row * 512, 512, 512);
      });
    }
    for (const m of meshes) m.visible = true;
    cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.updateMatrixWorld(true);
    return out.toDataURL('image/png');
  };
  window.__gpQA = q;
}

const br = await chromium.launch(launchOpts());
let exitCode = 0;
try {
  const ctx = await br.newContext({ viewport: SIZES[0], deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text().slice(0, 240));
    if (m.type() === 'warning' && /gear parts/i.test(m.text())) report.warnings.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => report.errors.push('PAGEERR ' + e.message.slice(0, 240)));
  page.on('response', (r) => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  const closePopups = async () => { const stop = page.getByRole('button', { name: '그만 보기' }).first(); if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {}); for (let i = 0; i < 4; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); await page.waitForTimeout(250); } } await page.evaluate(() => window.app.ui?.closeModal?.()).catch(() => {}); };
  const settle = async (frames = 60) => { await page.waitForTimeout(400); await page.evaluate((n) => { for (let i = 0; i < n; i++) window.app.step?.(1 / 60, false); window.app.renderer.render(); }, frames).catch(() => {}); await page.waitForTimeout(150); };
  const saveDataUrl = async (url, file) => { if (!url) return null; writeFileSync(`${OUT}/${file}`, Buffer.from(url.split(',')[1], 'base64')); return file; };
  const waitParts = (expected) => page.waitForFunction((id) => { const s = window.__gpQA.state(); return s && (s.parts ?? null) === id && (id === null || s.target === id); }, expected, { timeout: 60000 }).then(() => true, () => false);
  const shot = async (size, file, fn) => {
    await page.setViewportSize(size); await page.waitForTimeout(500);
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click().catch(() => {});
    await page.evaluate(fn).catch(() => {});
    await page.screenshot({ path: `${OUT}/${file}`, timeout: 120000 });
    return file;
  };

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby' || !!document.querySelector('#starter-select .ss-go:not([disabled])'), null, { timeout: 120000 });
  if (await page.$('#starter-select .ss-go')) await page.click('#starter-select .ss-go', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
  await page.evaluate((heroes) => { const r = window.app.eco.s.roster; if (r) for (const h of heroes) if (!r.owned.includes(h)) r.owned.push(h); }, HEROES);
  await page.waitForTimeout(1200); await closePopups();
  await page.evaluate(installHelpers);

  for (const hero of HEROES) for (const caseId of CASE_IDS) {
    const { armor, expect } = CASES[caseId];
    const id = `${hero}_${caseId}`, rec = { hero, case: caseId, armor, expected: expect, shots: [], scenes: {} };
    report.cases.push(rec);
    const check = (scene, state) => { if (!state || (state.parts ?? null) !== expect) report.mismatches.push({ case: id, scene, expected: expect, state }); };
    try {
      await page.setViewportSize(SIZES[0]);
      if (await page.evaluate(() => window.app.mode) !== 'lobby') { await page.evaluate(() => window.app.toLobby()); await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 }); await closePopups(); }
      await page.evaluate(async ({ hero, armorId }) => {
        const a = window.app, s = a.eco.s; a.testPause = false;
        a.eco.hero(hero);
        const inst = { uid: s.invSeq++, id: armorId, enh: 0 }; s.inventory.push(inst); a.eco.equip(hero, inst.uid);
        s.selected = hero; a.eco.emit?.();
        a.meta?.openTab?.('home');
        await a.showcaseHero(hero, true);
      }, { hero, armorId: armor });
      await page.waitForFunction((h) => window.app.showcase?.def?.id === h, hero, { timeout: 60000 });
      rec.scenes.lobbyAttached = await waitParts(expect);
      await closePopups(); await settle();
      const lobby = rec.scenes.lobby = { state: await page.evaluate(() => window.__gpQA.state()), measures: DEV ? await page.evaluate(() => window.__gpQA.measures()) : undefined };
      check('lobby', lobby.state);
      for (const size of MEASURE ? [] : QUICK ? [SIZES[2]] : SIZES) {
        const file = `${id}_lobby_${size.width}x${size.height}.png`;
        await shot(size, file, () => window.app.renderer.render()); rec.shots.push(file);
      }
      lobby.stats = await page.evaluate(() => window.__gpQA.stats());
      if (!MEASURE) { await page.setViewportSize(SIZES[2]); await page.waitForTimeout(300);
        rec.shots.push(await saveDataUrl(await page.evaluate((b) => { window.__gpQA.base = b; return window.__gpQA.closeup(); }, QUICK), `${id}_lobby_zoom.png`)); }

      if (QUICK) { console.log(JSON.stringify({ case: id, lobby: lobby.state?.parts ?? null, body: lobby.state?.body, partList: lobby.state?.partList, measures: lobby.measures })); continue; }
      await page.setViewportSize(SIZES[0]);
      await page.evaluate(async (h) => { const a = window.app; a.ui.closeModal?.(); a.eco.s.energy = 9999; a.eco.s.selected = h; await a.startStage(a.eco.nextStage()); }, hero);
      await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, null, { timeout: 90000 });
      await closePopups();
      rec.scenes.battleAttached = await waitParts(expect);
      await page.evaluate(() => { const p = window.app.battle.player; p.invuln = 1e9; p.auto = false; window.app.input.clear?.(); for (let i = 0; i < 90; i++) window.app.step(1 / 60, false); window.app.renderer.render(); });
      const battle = rec.scenes.battle = { state: await page.evaluate(() => window.__gpQA.state()), poses: {} };
      check('battle', battle.state);
      for (const size of SIZES) {
        const file = `${id}_battle_${size.width}x${size.height}.png`;
        await shot(size, file, () => { window.app.step(1 / 60, false); window.app.renderer.render(); }); rec.shots.push(file);
      }
      battle.stats = await page.evaluate(() => window.__gpQA.stats());
      await page.setViewportSize(SIZES[2]); await page.waitForTimeout(300);
      rec.shots.push(await saveDataUrl(await page.evaluate(() => window.__gpQA.closeup()), `${id}_battle_zoom.png`));
      if (POSES) for (const pose of ['run', 'attack', 'dodge']) {
        const result = await page.evaluate((pose) => {
          const app = window.app, p = app.battle.player, q = window.__gpQA;
          const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
          const step = () => { p.invuln = 1e9; app.step(1 / 60, false); };
          for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) key('keyup', c);
          for (let i = 0; i < 90 && p.state !== 'idle'; i++) step();
          let frames = 40, mid = 20;
          if (pose === 'run') { key('keydown', 'KeyD'); frames = 50; mid = 36; }
          if (pose === 'attack') { p.cds?.fill?.(0); p.startCombo(0); const dur = p.def.combo[0].dur || .6; frames = Math.max(8, Math.round(dur * 60)); mid = Math.round(frames * .5); }
          if (pose === 'dodge') { p.dodge(null); frames = 19; mid = 9; }
          let image = null;
          for (let f = 0; f < frames; f++) { step(); if (f === mid) image = q.closeup(); }
          if (pose === 'run') key('keyup', 'KeyD');
          return { image, state: p.state };
        }, pose);
        rec.shots.push(await saveDataUrl(result.image, `${id}_battle_${pose}.png`));
        battle.poses[pose] = result.state;
      }
    } catch (e) { rec.error = String(e.message || e).slice(0, 300); report.mismatches.push({ case: id, error: rec.error }); }
    const s = rec.scenes;
    console.log(JSON.stringify({ case: id, lobby: s.lobby?.state?.parts ?? null, battle: s.battle?.state?.parts ?? null, body: s.lobby?.state?.body, lobbyDelta: s.lobby?.stats && [s.lobby.stats.deltaCalls, s.lobby.stats.deltaTriangles], battleDelta: s.battle?.stats && [s.battle.stats.deltaCalls, s.battle.stats.deltaTriangles], error: rec.error }));
  }
} finally {
  report.ok = report.mismatches.length === 0;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
  if (!report.ok) exitCode = 1;
}
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors.length, warnings: report.warnings, mismatches: report.mismatches.length, ok: report.ok }));
process.exit(exitCode);
