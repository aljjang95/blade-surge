/**
 * 영웅·갑옷 단계별 촬영 — 실제 빌드(dist)를 vite preview로 띄우고 Playwright Chromium(SwiftShader)에서
 * 지정 영웅이 지정 갑옷 단계 몸체(hero_<id>_t<tier>)로 보이는지 ① 로비 ② 영웅 화면 ③ 전투 기본 카메라를 390x844·1280x720로 찍는다.
 *   bun run build && node tools/art/hero-tier-shots.mjs <outDir> --hero <knight|barbarian|mage|ranger|rogue> --tier <1|1.5|2|2.5|3> [--theme <세트>] [--dist dist]
 * 1.5 = S등급 몸(hero_<id>_t1s, S 갑옷 a_chain), 2.5 = U등급 테마 몸(hero_<id>_t2u, 영웅 대표 테마 갑옷 또는 --theme 세트 갑옷).
 * 단계는 모델을 바꾸지 않고, 그 단계가 되는 실제 갑옷 아이템(a_town_oath/ember/star = appearanceTier 1/2/3)을
 * 게임 저장 상태(app.eco)의 인벤토리에 넣어 영웅에게 장착시키는 방식으로 만든다(look.js applyLook → heroAppearanceTier).
 * 출력: <장면>_<폭>.png, <장면>_<폭>_head.png, report.json(콘솔 오류, 장면별 실제 몸체 asset id·단계, 불일치 여부).
 * 요청 단계와 실제 로드된 몸체가 다르면 exit 1. 저장은 새 컨텍스트(빈 localStorage)라 격리된다. SwiftShader 화면이며 실기기 증거가 아니다.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const outArg = args.find((a, i) => !a.startsWith('--') && !['--dist', '--hero', '--tier', '--theme'].includes(args[i - 1]));
const HERO = flag('--hero', ''), TIER = Number(flag('--tier', 0));
// 갑옷 단계 → 그 단계가 되는 실제 갑옷 아이템(src/data/items.js TOWN_ITEMS, appearanceTier 명시)
// U 테마 몸의 영웅별 대표 세트(art-src/t4-pc/PC_BRIEF.md)와 세트 → U 갑옷 id
const HERO_THEME = { knight: 'storm', rogue: 'plague', mage: 'frost', ranger: 'phoenix', barbarian: 'gravity' };
const THEME_ARMOR = { storm: 'a_storm', blood: 'a_blood', gravity: 'a_gravity', phoenix: 'a_phoenix', frost: 'a_rime', plague: 'a_plague', rune: 'a_sigil', tether: 'a_bind' };
const THEME = flag('--theme', HERO_THEME[HERO]);
const ARMOR_BY_TIER = { 1: 'a_town_oath', 1.5: 'a_chain', 2: 'a_town_ember', 2.5: THEME_ARMOR[THEME], 3: 'a_town_star' };
const BODY_ID = `hero_${HERO}_` + ({ 1.5: 't1s', 2.5: 't2u' }[TIER] || `t${TIER}`);
if (!outArg || !['knight', 'barbarian', 'mage', 'ranger', 'rogue'].includes(HERO) || !ARMOR_BY_TIER[TIER]) { console.error('사용: node tools/art/hero-tier-shots.mjs <outDir> --hero <knight|barbarian|mage|ranger|rogue> --tier <1|1.5|2|2.5|3> [--theme <세트>] [--dist dist]'); process.exit(2); }
const PROJ = resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname));
const OUT = resolve(outArg), DIST = resolve(PROJ, flag('--dist', 'dist')), PORT = 4297 + Math.floor(Math.random() * 400);
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 720 }];
mkdirSync(OUT, { recursive: true });
const report = { at: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJ }).toString().trim(), dist: DIST, hero: HERO, tier: TIER, body: BODY_ID, armorItem: ARMOR_BY_TIER[TIER], errors: [], scenes: {}, shots: [], bodies: [], mismatches: [] };

const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }

// 영웅 머리의 화면 좌표(CSS px) 투영: 머리 뼈~HeadTop_End(없으면 머리 뼈 위 0.25m)를 카메라로 투영한다.
// 현재 장면에서 실제로 로드된 영웅 몸체 asset id·단계(로비/영웅 화면은 쇼케이스, 전투는 플레이어 모델)
const readBody = (scene) => {
  const app = window.app, root = app.mode === 'battle' ? app.battle?.player?.model : app.showcase?.root;
  return root ? { asset: root.userData.libraryBodyAssetId ?? null, tier: root.userData.libraryHeroTier ?? null, heroId: root.userData.heroId ?? app.showcase?.def?.id ?? null, source: app.mode === 'battle' ? 'battle.player.model' : 'showcase.root' } : null;
};
const projectHead = (scene) => {
  const T = window.__THREE, app = window.app;
  if (scene === 'hero') {   // 영웅 화면의 착용 모습은 별도 R3F 캔버스라 앱 카메라로 투영할 수 없다. 캔버스 안 고정 비율(머리 위치)로 근사한다.
    const cv = document.querySelector('.wardrobe-canvas canvas'); if (!cv) return null;
    const r = cv.getBoundingClientRect();
    return { center: { x: r.x + r.width * 0.5, y: r.y + r.height * 0.37 }, sizePx: r.height * 0.07, behind: false, hero: app.eco.s.selected, approx: 'wardrobe-canvas 비율' };
  }
  const root = app.mode === 'battle' ? app.battle?.player?.model : app.showcase?.root;
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  let head = null, top = null;
  root.traverse((o) => { if (!o.isBone) return; const n = o.name.toLowerCase().replace(/mixamorig:?/, ''); if (n === 'head') head = o; if (/headtop/.test(n)) top = o; });
  if (!head) return null;
  const a = head.getWorldPosition(new T.Vector3()), b = top ? top.getWorldPosition(new T.Vector3()) : a.clone().add(new T.Vector3(0, 0.25, 0));
  const c = a.clone().add(b).multiplyScalar(0.5), cam = app.renderer.camera;
  cam.updateMatrixWorld();
  const px = (v) => { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, behind: p.z > 1 }; };
  const pc = px(c), pa = px(a), pb = px(b);
  return { center: pc, sizePx: Math.hypot(pa.x - pb.x, pa.y - pb.y), behind: pc.behind, hero: app.eco.s.selected };
};

const br = await chromium.launch(launchOpts());
try {
  const ctx = await br.newContext({ viewport: SIZES[0], deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => report.errors.push('PAGEERR ' + e.message.slice(0, 240)));
  const closePopups = async () => { for (let i = 0; i < 4; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); await page.waitForTimeout(300); } } await page.evaluate(() => window.app.ui?.closeModal?.()).catch(() => {}); };
  const settle = async (frames = 90) => { await page.waitForTimeout(700); await page.evaluate((n) => { for (let i = 0; i < n; i++) window.app.step?.(1 / 60, false); window.app.renderer.render(); }, frames).catch(() => {}); await page.waitForTimeout(250); };

  async function shoot(scene, step) {
    const rec = report.scenes[scene] = { entered: false };
    try {
      await step(); rec.entered = true;
      for (const size of SIZES) {
        await page.setViewportSize(size); await page.waitForTimeout(600);
        if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click().catch(() => {});
        await page.evaluate(() => window.app.renderer.render()).catch(() => {});
        const base = `${scene}_${size.width}`, full = `${OUT}/${base}.png`;
        await page.screenshot({ path: full });
        const info = await page.evaluate(projectHead, scene).catch(() => null);
        const body = await page.evaluate(readBody, scene).catch(() => null);
        const shot = { file: `${base}.png`, viewport: size, head: info, body };
        report.bodies.push({ scene, width: size.width, ...body });
        if (!body || body.asset !== BODY_ID || body.tier !== TIER) report.mismatches.push({ scene, width: size.width, expected: BODY_ID, body });
        if (info && !info.behind) {
          const S = 2, half = Math.max(70, info.sizePx * 2.4), W = size.width * S, H = size.height * S;
          const left = Math.max(0, Math.round((info.center.x - half) * S)), top = Math.max(0, Math.round((info.center.y - half) * S));
          const w = Math.min(W - left, Math.round(half * 2 * S)), h = Math.min(H - top, Math.round(half * 2 * S));
          if (w > 20 && h > 20) { await sharp(full).extract({ left, top, width: w, height: h }).resize({ height: 720, withoutEnlargement: false }).toFile(`${OUT}/${base}_head.png`); shot.headFile = `${base}_head.png`; }
        }
        report.shots.push(shot);
      }
    } catch (e) { rec.error = String(e.message || e).slice(0, 300); }
  }

  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
  await page.waitForTimeout(1200); await closePopups();
  // 영웅 선택 + 단계 갑옷을 인벤토리에 넣고 그 영웅에게 장착(저장은 이 컨텍스트 안에서만). 장착 갑옷이 heroAppearanceTier 를 정한다.
  const equipped = await page.evaluate(async ({ hero, armorId }) => {
    const a = window.app, s = a.eco.s; a.testPause = false;
    a.eco.hero(hero);   // 영웅 상태 보장
    const inst = { uid: s.invSeq++, id: armorId, enh: 0 }; s.inventory.push(inst);
    a.eco.equip(hero, inst.uid); s.selected = hero; a.eco.emit?.();
    await a.showcaseHero(hero, true);
    return { uid: inst.uid, equipUid: s.heroes[hero].equip.armor };
  }, { hero: HERO, armorId: ARMOR_BY_TIER[TIER] });
  report.equipped = equipped;
  await page.waitForFunction((h) => window.app.showcase?.def?.id === h, HERO, { timeout: 60000 });
  // 단계 몸체는 비동기로 받은 뒤 교체된다 — 기대 asset 이 될 때까지 최대 60초 기다린다(안 되면 불일치로 기록)
  await page.waitForFunction((id) => window.app.showcase?.root?.userData.libraryBodyAssetId === id, BODY_ID, { timeout: 60000 }).catch(() => {});

  await shoot('lobby', async () => { await page.evaluate(() => window.app.meta.openTab('home')); await closePopups(); await settle(); });
  await shoot('hero', async () => { await page.evaluate((h) => { const m = window.app.meta; m.heroSel = h; m.openTab('heroes'); m.renderHeroes?.(); }, HERO); await closePopups(); await settle(); });
  await shoot('battle', async () => {
    await page.setViewportSize(SIZES[0]);
    await page.evaluate(async (h) => { const a = window.app; a.ui.closeModal?.(); a.eco.s.energy = 9999; a.eco.s.selected = h; await a.startStage(a.eco.nextStage()); }, HERO);
    await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, null, { timeout: 90000 });
    await closePopups();
    await page.evaluate(() => { const b = window.app.battle; b.player.invuln = 99; for (let i = 0; i < 120; i++) window.app.step(1 / 60, false); window.app.renderer.render(); });
    await page.waitForTimeout(500);
  });
} finally {
  report.heroCheck = report.shots.map((s) => s.head?.hero);
  // 모든 장면이 요청한 영웅·단계 몸체였을 때만 통과(장면 진입 실패도 불일치로 본다)
  report.ok = report.mismatches.length === 0 && report.bodies.length === SIZES.length * 3 && Object.values(report.scenes).every((x) => x.entered);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await br.close(); srv.kill();
}
console.log(JSON.stringify({ scenes: report.scenes, errors: report.errors.length, bodies: report.bodies, mismatches: report.mismatches.length, ok: report.ok, shots: report.shots.map((s) => s.file) }));
if (!report.ok) process.exit(1);
