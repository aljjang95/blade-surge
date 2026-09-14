import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'work/ability-vfx-qa');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const acquiredPath = 'work/natural-progression-mage-20261031-chapter-six/after-21-star_archive-deep.json';
const acquiredBytes = await fs.readFile(path.join(root, acquiredPath));
const acquired = JSON.parse(acquiredBytes);
const report = {
  status: 'running', started: new Date().toISOString(),
  scope: 'Actual compiled Chromium battle on the acquired free Mage profile. UI boot, real stage start, real skill state transitions and rendered screenshots; no HP, damage, kill, position or victory edits.',
  acquisition: { path: acquiredPath, sha256: hash(acquiredBytes) }, skills: [], errors: [], screenshots: [],
};
await fs.mkdir(out, { recursive: true });
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
let server; let browser;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.addInitScript(save => localStorage.setItem('bladesurge_save_v1', JSON.stringify(save)), acquired.save);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
  await page.evaluate(() => { window.app.testPause = true; window.app.ui.closeModal(); });
  const started = await page.evaluate(async () => {
    const ok = await window.app.startStage(window.__stageDef(1, 1));
    window.app.testPause = true;
    if (window.app.battle?.player) window.app.battle.player.auto = false;
    return { ok, mode: window.app.mode, active: !!window.app.battle?.active, hero: window.app.battle?.player?.def?.id };
  });
  report.stage = started;
  if (!started.ok || !started.active || started.hero !== 'mage') throw Error('Actual mage battle did not start');
  const cases = [
    { index: 0, id: 'fireball', frames: 78 },
    { index: 1, id: 'chain', frames: 72 },
    { index: 3, id: 'meteor', frames: 42, ult: true },
    { index: 2, id: 'blizzard', frames: 30 },
    { index: 5, id: 'chrono_seal', frames: 42 },
  ];
  for (const spec of cases) {
    const capture = await page.evaluate(({ index, frames, ult }) => {
      const b = window.app.battle, p = b.player;
      if (ult) p.ult = p.ultMax;
      const before = p.cds.slice();
      const started = p.tryCastSkill(index);
      for (let i = 0; i < frames; i++) window.app.step(1 / 60, true);
      return { started, state: p.state, cooldown: p.cds[index], beforeCooldown: before[index], fxItems: window.app.fx.items.length, active: b.active };
    }, spec);
    if (!capture.started) throw Error(`${spec.id} did not start`);
    report.skills.push({ ...spec, ...capture });
    const screenshot = `${spec.id}.png`;
    await page.screenshot({ path: path.join(out, screenshot) });
    report.screenshots.push({ path: `work/ability-vfx-qa/${screenshot}`, sha256: hash(await fs.readFile(path.join(out, screenshot))) });
    await page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, true); });
  }
  if (report.errors.length) throw Error('Browser page errors: ' + report.errors.join('; '));
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString(); await save();
  await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve());
  console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure }));
}
