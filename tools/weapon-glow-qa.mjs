/**
 * 무기 강화 빛·방어구 외형 제거 화면 QA — 광륜(WeaponHalo)·look.aura·몸체 단계를 단계별로 기록하고 캡처한다.
 *   bun run build && node tools/weapon-glow-qa.mjs [출력폴더=work/qa/weapon-glow]
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4298, OUT = resolve(PROJ, process.argv[2] || 'work/qa/weapon-glow');
const HEROES = [['barbarian', '드라칸'], ['knight', '아르카']], STEPS = [0, 6, 10, 13, 15, 20];
const VIEWS = [[844, 390], [640, 360], [390, 844]];
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 844, height: 390 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], results = [], records = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };

// 영웅 소유·L 갑옷/무기 장착·강화 단계 설정 후 쇼케이스를 다시 그리고 상태를 읽는다.
const setup = (heroId, enh, withArmor) => page.evaluate(async ({ heroId, enh, withArmor }) => {
  const eco = window.app.eco, s = eco.s;
  if (!s.roster.owned.includes(heroId)) s.roster.owned = [...s.roster.owned, heroId];
  s.roster.starterChosen = true; s.selected = heroId;
  const add = (id, e) => { let inst = s.inventory.find((x) => x.id === id); if (!inst) { inst = { uid: s.invSeq++, id, enh: 0 }; s.inventory.push(inst); } inst.enh = e; return inst; };
  const w = add('w_town_star', enh), h = eco.hero(heroId);
  h.equip.weapon = w.uid;
  if (withArmor) h.equip.armor = add('a_town_star', 0).uid;
  eco.emit();
  await window.app.showcaseHero(heroId);
  await new Promise((r) => setTimeout(r, 700));
  const sc = window.app.showcase, root = sc.root;
  const bad = []; let halo = null;
  root.traverse((o) => {
    if (o.name === 'WeaponHalo') { let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false; halo = { opacity: +o.material.opacity.toFixed(3), visible: vis, parent: o.parent?.name, scale: [+o.scale.x.toFixed(2), +o.scale.y.toFixed(2)] }; }
    if (/helm|pauldron|gauntlet/i.test(o.name)) { let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false; if (vis && (o.isMesh || o.children.length === 0)) bad.push(o.name); }
  });
  const a = sc.look?.aura;
  return { body: root.userData.libraryBodyAssetId ?? null, bad, halo, aura: a === undefined ? null : (typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : a), glowTier: sc.look?.weapon?.glowTier?.id ?? null };
}, { heroId, enh, withArmor });

const settle = (ms = 600) => page.waitForTimeout(ms);
const shot = async (name) => { const f = `${name}.png`; await page.screenshot({ path: resolve(OUT, f) }); return f; };
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await settle(1200);
  for (let i = 0; i < 3; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click(); await settle(400); } }
  await page.evaluate(() => { window.app.ui.confirm = async () => true; });

  for (const [heroId, label] of HEROES) {
    // 기준: 갑옷 없이 +0 몸체
    const base = await setup(heroId, 0, false);
    const armored = await setup(heroId, 0, true);
    check(`${label}: L 갑옷 장착해도 투구/어깨/건틀릿 파츠 0`, armored.bad.length === 0, armored.bad);
    check(`${label}: L 갑옷 장착 몸체가 갑옷 없을 때와 같음(1단계)`, armored.body === base.body, { base: base.body, armored: armored.body });
    for (const enh of STEPS) {
      const r = await setup(heroId, enh, true);
      await settle(500);
      const file = await shot(`${heroId}-enh${String(enh).padStart(2, '0')}`);
      const expectHalo = enh >= 6;
      records.push({ hero: heroId, enh, ...r, file });
      check(`${label} +${enh}: WeaponHalo ${expectHalo ? '있음' : '없음'}`, expectHalo ? !!r.halo?.visible : !r.halo, { halo: r.halo, aura: r.aura, glowTier: r.glowTier });
    }
  }

  // 뷰포트별 로비 캡처(+0, +15)
  for (const [heroId] of HEROES.slice(0, 1)) for (const [w, h] of VIEWS) {
    await page.setViewportSize({ width: w, height: h }); await settle(500);
    for (const enh of [0, 15]) { await setup(heroId, enh, true); await settle(600); records.push({ view: `${w}x${h}`, enh, file: await shot(`lobby-${w}x${h}-enh${String(enh).padStart(2, '0')}`) }); }
  }
  // 전투 +15 (844×390)
  await page.setViewportSize({ width: 844, height: 390 });
  await setup('barbarian', 15, true);
  await page.evaluate(async () => { window.app.eco.s.energy = 9999; await window.app.startStage(window.app.eco.nextStage()); });
  await page.waitForFunction(() => window.app.battle?.player?.model, null, { timeout: 60000 }).catch(() => {});
  await settle(2500);
  const battle = await page.evaluate(() => { const m = window.app.battle?.player?.model; let halo = null; m?.traverse((o) => { if (o.name === 'WeaponHalo') halo = { opacity: +o.material.opacity.toFixed(3), parent: o.parent?.name }; }); return { mode: window.app.mode, halo }; });
  records.push({ view: 'battle-844x390', enh: 15, ...battle, file: await shot('battle-844x390-enh15') });
  check('전투 +15 광륜 존재', !!battle.halo, battle);
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results, records, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
