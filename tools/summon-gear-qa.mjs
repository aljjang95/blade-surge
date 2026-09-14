import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SUMMON_GEAR } from '../src/data/summon-gear.js';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'work/summon-gear-qa');
const sourcePath = 'work/natural-progression-mage-20261031-chapter-six/after-21-star_archive-deep.json';
const source = JSON.parse(await fs.readFile(path.join(root, sourcePath), 'utf8'));
const save = structuredClone(source.save);
save.selected = 'mage';
const hero = save.heroes.mage;
let uid = Math.max(0, ...save.inventory.map((item) => item.uid)) + 1;
const equipped = {};
for (const def of SUMMON_GEAR.filter((item) => item.rarity === 'U')) {
  const inst = { uid: uid++, id: def.id, enh: 0 };
  save.inventory.push(inst); equipped[def.slot] = inst.uid;
}
hero.equip = { ...hero.equip, ...equipped };
save.invSeq = uid;
const report = { status: 'running', started: new Date().toISOString(), sourcePath, equipment: SUMMON_GEAR.filter((item) => item.rarity === 'U').map((item) => item.id), errors: [] };
const saveReport = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await fs.mkdir(out, { recursive: true });
let server; let browser;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'no-preference' });
  page.on('pageerror', (error) => report.errors.push(String(error)));
  await page.addInitScript((value) => localStorage.setItem('bladesurge_save_v1', JSON.stringify(value)), save);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
  const started = await page.evaluate(async () => {
    window.app.testPause = true; window.app.ui.closeModal();
    const ok = await window.app.startStage(window.__stageDef(1, 1));
    window.app.testPause = true;
    if (window.app.battle?.player) window.app.battle.player.auto = false;
    return { ok, mode: window.app.mode, active: !!window.app.battle?.active, hero: window.app.battle?.player?.def?.id };
  });
  report.stage = started;
  if (!started.ok || !started.active || started.hero !== 'mage') throw Error('summon-gear battle did not start');
  const runtime = await page.evaluate(() => {
    for (let i = 0; i < 420; i++) window.app.step(1 / 60, true);
    const b = window.app.battle;
    const bonus = window.app.eco.heroEquipBonus('mage');
    return { summonIds: (b.sp?.summons || []).map((summon) => summon.id), familiars: b.sp?.familiars?.length || 0, fxItems: b.fx.items.length, active: b.active, heroHp: b.player.hp, hasSetProc: !!b.sp, equip: window.app.eco.s.heroes.mage.equip, inventory: window.app.eco.s.inventory.filter((item) => item.id.startsWith('sg_')).map((item) => item.id), bonusSummons: bonus.summons?.map((summon) => summon.id) };
  });
  report.runtime = runtime;
  if (runtime.summonIds.length !== 4 || runtime.familiars !== 4 || runtime.fxItems < 1 || !runtime.active) throw Error('summon runtime contract failed');
  await page.screenshot({ path: path.join(out, 'summon-battle.png'), timeout: 120000, animations: 'disabled' });
  report.screenshot = 'work/summon-gear-qa/summon-battle.png';
  if (report.errors.length) throw Error('Browser page errors: ' + report.errors.join('; '));
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString(); await saveReport();
  await browser?.close(); await new Promise((resolve) => server?.httpServer.close(resolve) || resolve());
  console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure }));
}
