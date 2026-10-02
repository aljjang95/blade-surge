// Controlled overlap and real input. Native mobile GPU/audio and natural progression are separate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import sharp from 'sharp';
import { launchOpts } from './chrome.mjs';

if (!process.argv[2]) throw Error('A new output directory is required');
const out = resolve(process.argv[2]);
await mkdir(out);
const originArg = process.argv[3];
const report = { status: 'running', startedAt: new Date().toISOString(), cases: [], errors: [],
  scope: 'Real 1/J keys; protected ring/slash/flash/circle overlap with bloom disabled verifies original direct pixels. Bloom-enabled warning captures are visual evidence, not pixel invariance or natural boss completion.' };
const server = originArg ? null : await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const origin = originArg || `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch(launchOpts({ headless: true }));
const capture = async (page, name) => {
  const bytes = await page.screenshot(); await writeFile(join(out, name), bytes, { flag: 'wx' }); return bytes;
};
const region = bytes => sharp(bytes).extract({ left: 280, top: 110, width: 320, height: 150 }).removeAlpha().raw().toBuffer();
try {
  report.build = await (await fetch(origin + '/version.json')).json();
  for (const [hero, quality, reduced] of [['knight', 'mid', false], ['mage', 'low', false], ['ranger', 'mid', true]]) {
    const context = await browser.newContext({ viewport: { width: 880, height: 400 }, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
    await page.evaluate(({ hero, quality }) => {
      if (!app.eco.reset()) throw Error('controlled save reset failed');
      app.eco.s.selected = hero; app.eco.s.settings.quality = quality; app.eco.s.tutorial = { completed: true }; app.eco.save();
    }, { hero, quality });
    await page.click('#boot-start'); await page.waitForFunction(() => app.mode === 'lobby');
    await page.evaluate(async () => {
      app.ui.closeModal(); app.applySettings(); app.testPause = true;
      await app.startStage(app.eco.nextStage()); app.battle.player.auto = false; document.activeElement?.blur();
      app.step(1 / 60, true);
    });
    const prepared = await page.evaluate(() => app.renderer.r.info.programs.length);
    await page.keyboard.down('1');
    const skill = await page.evaluate(() => { app.step(1 / 60, true); return { state: app.battle.player.state, programs: app.renderer.r.info.programs.length }; });
    await page.keyboard.up('1'); assert.equal(skill.state, 'skill'); assert.equal(skill.programs, prepared);
    await page.evaluate(() => { for (let i = 0; i < 90; i++) app.step(1 / 60, i === 89); });
    await page.keyboard.down('j');
    const attack = await page.evaluate(() => { app.step(1 / 60, true); return { state: app.battle.player.state, programs: app.renderer.r.info.programs.length }; });
    await page.keyboard.up('j'); assert.equal(attack.state, 'attack'); assert.equal(attack.programs, prepared);
    await page.evaluate(() => {
      const b = app.battle, p = b.player, room = b.world.rooms.find(r => r.type === 'normal');
      p.pos.set(room.x, 0, room.z); app.fx.clearAll();
      app.renderer.rig.target.copy(p.pos); app.renderer.rig.pos.copy(p.pos).add(app.renderer.rig.offset);
      for (let i = 0; i < 60; i++) app.renderer.update(1 / 60, 1 / 60);
    });
    const warnings = [];
    for (const kind of ['ring', 'slashArc', 'flash', 'castCircle']) {
      const before = await page.evaluate(kind => {
        app.fx.clearAll(); const p = app.battle.player, fx = app.fx, r = app.renderer;
        const body = p.pos.clone().setY(1.2);
        if (kind === 'ring') fx.ring(body, 0xff3030, { r0: .8, r1: 2, vertical: true, y: 0, life: 1, telegraph: true });
        if (kind === 'slashArc') fx.slashArc(p.pos, 0, 0xff3030, { height: 1.2, radius: 2, life: 1, telegraph: true });
        if (kind === 'flash') fx.flash(body, 0xa0ff90, { size: 4, life: 1, telegraph: true });
        if (kind === 'castCircle') fx.castCircle(p.pos, 0x80ff90, { radius: 2, life: 1, telegraph: true });
        fx.update(.18); r.bloom.enabled = false; r.render();
        const targets = [r.composer.renderTarget1, r.composer.renderTarget2, r.bloom.renderTargetBright, ...r.bloom.renderTargetsHorizontal, ...r.bloom.renderTargetsVertical];
        return { age: fx.items.map(i => i.t), lifetime: fx.items.map(i => i.life),
          materials: fx.items.map(i => ({ protected: i.obj.material?.userData.telegraph,
            focus: i.obj.material?.customProgramCacheKey().includes('|hero-effect-focus-') || false })),
          targetIds: targets.map(t => t.texture.uuid), programs: r.r.info.programs.length };
      }, kind);
      const focused = await capture(page, `${hero}-${kind}-direct-focus.png`);
      await page.evaluate(() => { app.fx.focus.area.value.set(0, 0, 0, 0); app.renderer.composer.render(); });
      const neutral = await capture(page, `${hero}-${kind}-direct-neutral.png`);
      assert.deepEqual(await region(focused), await region(neutral), `${hero}/${kind} direct warning pixels must remain unchanged`);
      const after = await page.evaluate(() => {
        const fx = app.fx, r = app.renderer;
        const targets = [r.composer.renderTarget1, r.composer.renderTarget2, r.bloom.renderTargetBright, ...r.bloom.renderTargetsHorizontal, ...r.bloom.renderTargetsVertical];
        return { age: fx.items.map(i => i.t), lifetime: fx.items.map(i => i.life), targetIds: targets.map(t => t.texture.uuid), programs: r.r.info.programs.length };
      });
      assert.deepEqual(after.age, before.age); assert.deepEqual(after.lifetime, before.lifetime);
      assert.deepEqual(after.targetIds, before.targetIds); assert.equal(after.programs, before.programs);
      assert.ok(before.materials.every(m => m.protected && !m.focus));
      await page.evaluate(q => { app.renderer.bloom.enabled = q !== 'low'; app.renderer.render(); }, quality);
      await capture(page, `${hero}-${kind}-configured-bloom-overlap.png`);
      warnings.push({ kind, directPixelInvariant: true, ...before });
    }
    report.cases.push({ hero, quality, reduced, preparedPrograms: prepared, skill, attack, warnings });
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); if (server) await new Promise(resolve => server.httpServer.close(resolve));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, report: join(out, 'report.json') }));
}
