/**
 * 게이트 B 보조 — 장비 외형: 영웅 4명 × (맨몸 / E / L+15) 로비 쇼케이스 컷.
 *   node tools/shot_look.mjs [출력폴더=.rsi/shots]
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4198, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
mkdirSync(OUT, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());
const heroes = ['knight', 'barbarian', 'mage', 'rogue'];
const tiers = [{ k: 'bare' }, { k: 'E', r: 'E', enh: 0 }, { k: 'L15', r: 'L', enh: 15 }];
for (const h of heroes) for (const t of tiers) {
  const info = await page.evaluate(async ({ h, t }) => {
    const e = window.app.eco; if (!e.ownHero(h)) e.grantHero(h);
    e.s.selected = h; const hero = e.hero(h);
    for (const sl of ['weapon', 'armor', 'ring', 'boots']) hero.equip[sl] = null;
    if (t.r) for (const sl of ['weapon', 'armor']) { const inst = e.addItem(t.r, sl); inst.enh = t.enh; hero.equip[sl] = inst.uid; }
    e.save();
    document.getElementById('meta')?.classList.remove('show');
    await window.app.showcaseHero(h, true);
    window.app.testPause = true;
    for (let i = 0; i < 90; i++) window.app.step(1 / 60, i === 89);
    const s = window.app.showcase; const vis = []; s.root.traverse((o) => { if (o.isMesh && o.visible && /Sword|Shield|Axe|Staff|Wand|Knife|Spellbook/.test(o.name)) vis.push(o.name); });
    return { vis, look: s.look };
  }, { h, t });
  console.log(h, t.k, info.vis.join(','), info.look.trailColor.toString(16), info.look.aura?.toString(16));
  await page.screenshot({ path: `${OUT}/look_${h}_${t.k}.png`, clip: { x: 240, y: 0, width: 400, height: 400 } });
}
console.log('errors', errors);
await br.close(); srv.kill();
