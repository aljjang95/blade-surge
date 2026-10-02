// Controlled A/B render evidence plus a real keyboard skill transition. This is
// not natural progression, a floor completion, physical-device or audio proof.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { preview } from 'vite';
import sharp from 'sharp';
import { launchOpts } from './chrome.mjs';

if (!process.argv[2]) throw Error('A new output directory is required');
const out = resolve(process.argv[2]);
const remote = process.argv[3];
const report = { status: 'running', startedAt: new Date().toISOString(), controlledRender: true,
  scope: 'Same compiled game, actor, camera, warning, seed and effect clocks; focus disabled versus enabled against one neutral rest reference. RT and actor ownership assessed by code review, GPU allocation counts observed. No victory, progression or device claims.', cases: [], errors: [], failures: [] };
await mkdir(out);
const server = remote ? null : await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const origin = remote || `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch(launchOpts({ headless: true }));
const hash = b => createHash('sha256').update(b).digest('hex');
try {
  report.build = await (await fetch(origin + '/version.json')).json();
  for (const [hero, quality, reduced] of [['knight', 'mid', false], ['mage', 'low', false], ['ranger', 'mid', true]]) {
    const context = await browser.newContext({ viewport: { width: 880, height: 400 }, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 400)); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
    await page.evaluate(({ hero, quality }) => {
      assertReset(app.eco.reset()); app.eco.s.selected = hero; app.eco.s.settings.quality = quality;
      app.eco.s.tutorial = { completed: true }; app.eco.save();
      function assertReset(ok) { if (!ok) throw Error('save reset failed'); }
    }, { hero, quality });
    await page.click('#boot-start'); await page.waitForFunction(() => app.mode === 'lobby');
    await page.evaluate(async () => {
      app.ui.closeModal(); app.applySettings(); app.testPause = true;
      let seed = 20261001; Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      await app.startStage(app.eco.nextStage()); app.battle.player.auto = false;
      document.activeElement?.blur();
    });
    // Existing unlocked first skill, through the real keyboard/input/simulation.
    const before = await page.evaluate(() => ({ mp: app.battle.player.mp, state: app.battle.player.state }));
    await page.keyboard.down('1');
    const cast = await page.evaluate(() => {
      app.step(1 / 60, true);
      const p = app.battle.player;
      return { state: p.state, mp: p.mp, cooldown: p.cds[0], skill: p.skillCtx?.sk.id };
    });
    await page.keyboard.up('1');
    assert.equal(cast.state, 'skill'); assert.ok(cast.mp < before.mp); assert.ok(cast.cooldown > 0);
    await page.evaluate(() => { for (let i = 0; i < 48; i++) app.step(1 / 60, i === 47); });
    await page.screenshot({ path: join(out, `${hero}-${quality}-real-skill.png`) });
    const geometry = await page.evaluate(() => {
      const b = app.battle, p = b.player, room = b.world.rooms.find(r => r.type === 'normal');
      // Only the controlled rendering scene is arranged here.
      p.pos.set(room.x, 0, room.z); p.yaw = 0;
      app.fx.clearAll(); b.hazards.spawn(room, p);
      app.renderer.rig.target.copy(p.pos); app.renderer.rig.pos.copy(p.pos).add(app.renderer.rig.offset);
      for (let i = 0; i < 60; i++) app.renderer.update(1 / 60, 1 / 60);
      app.renderer.render();
      const bottom = p.pos.clone().setY(.2).project(app.renderer.camera), top = p.pos.clone().setY(2.4).project(app.renderer.camera);
      const center = p.pos.clone().setY(1.2).project(app.renderer.camera);
      const right = app.renderer.camera.matrixWorld.elements;
      const side = p.pos.clone().add(new __THREE.Vector3(right[0] * .5, 1.2, right[2] * .5)).project(app.renderer.camera);
      return { x: (center.x + 1) * 440, top: (1 - top.y) * 200, bottom: (1 - bottom.y) * 200,
        halfWidth: Math.max(5, Math.abs(side.x - center.x) * 440), warnings: b.hazards.getPartyWarnings() };
    });
    // A common neutral reference; bloom focus can affect the actor even without FX.
    await page.evaluate(() => { app.fx.focus.area.value.set(0, 0, 0, 0); app.renderer.composer.render(); });
    const reference = await page.screenshot({ path: join(out, `${hero}-${quality}-rest.png`) });
    const samples = {};
    for (const focus of [false, true]) {
      await page.evaluate(enabled => {
        app.fx.clearAll();
        const p = app.battle.player;
        let seed = 20261001; Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
        for (const [profile, dx, dz] of [['fire', -.65, -.25], ['frost', .7, .15], ['void', 0, .8]]) {
          app.fx.abilitySignature(p.pos.clone().add(new __THREE.Vector3(dx, 0, dz)), profile, { heavy: true, scale: 1.25, life: 1.2 });
        }
        app.fx.firePillar(p.pos.clone().add(new __THREE.Vector3(.15, 0, .25)), { height: 5, width: 2.5, life: 1.2 });
        app.fx.flipbook(p.pos, 'explosion', { size: 5, life: 1.2, y: 1.5 });
        app.fx.update(.18);
        app.renderer.render();
        // A/B uses the exact compiled candidate. Only the focus uniform changes.
        if (!enabled && app.fx.focus) app.fx.focus.area.value.set(0, 0, 0, 0);
        app.renderer.composer.render();
      }, focus);
      const file = `${hero}-${quality}-${focus ? 'focused' : 'legacy'}.png`;
      samples[focus ? 'focused' : 'legacy'] = await page.screenshot({ path: join(out, file) });
    }
    const raw = await sharp(reference).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const legacy = await sharp(samples.legacy).removeAlpha().raw().toBuffer(), focused = await sharp(samples.focused).removeAlpha().raw().toBuffer();
    let beforeError = 0, afterError = 0, pixels = 0;
    for (let y = Math.max(0, Math.ceil(geometry.top)); y < Math.min(raw.info.height, geometry.bottom); y++)
      for (let x = Math.max(0, Math.ceil(geometry.x - geometry.halfWidth)); x < Math.min(raw.info.width, geometry.x + geometry.halfWidth); x++) {
        const i = (y * raw.info.width + x) * 3;
        for (let c = 0; c < 3; c++) { beforeError += Math.abs(raw.data[i + c] - legacy[i + c]); afterError += Math.abs(raw.data[i + c] - focused[i + c]); }
        pixels++;
      }
    const state = await page.evaluate(() => ({ focus: app.fx.focus.area.value.toArray(), resourceObservation: { textures: app.renderer.r.info.memory.textures, geometries: app.renderer.r.info.memory.geometries, programs: app.renderer.r.info.programs.length }, warnings: app.battle.hazards.getPartyWarnings(), alive: app.battle.player.alive,
      active: app.battle.active, mode: app.mode, focusTargetPresent: !!app.renderer.heroEffectTarget?.(), viewport: app.fx.focus.viewport.value.toArray() }));
    report.lastSample = { hero, quality, geometry, beforeError, afterError, pixels, ratio: afterError / beforeError, ...state };
    report.lastSample.programs = await page.evaluate(() => app.renderer.r.info.programs.filter(p => p.cacheKey.includes('hero-effect-focus')).map(p => ({
      key: p.cacheKey.slice(-120), focus: p.getUniforms().map.heroFocus?.cache, viewport: p.getUniforms().map.heroFocusViewport?.cache,
    })));
    assert.ok(pixels > 50); assert.ok(beforeError > pixels * 3, 'effect scene must actually obscure the hero');
    if (!(afterError / beforeError < .72)) report.failures.push({ hero, quality, ratio: afterError / beforeError, gate: 'hero-region colour error <0.72' });
    assert.deepEqual(state.warnings, geometry.warnings); assert.equal(state.alive, true);
    report.cases.push({ hero, quality, reduced, cast, heroRegionPixels: pixels, legacyError: beforeError / (pixels * 3), focusedError: afterError / (pixels * 3),
      errorRatio: afterError / beforeError, warningGeometryUnchanged: true, ...state,
      captures: Object.fromEntries(Object.entries(samples).map(([k, bytes]) => [k, { sha256: hash(bytes), file: `${hero}-${quality}-${k === 'legacy' ? 'legacy' : 'focused'}.png` }])) });
    // Focus clears in lobby and binds the next actual actor on restart.
    await page.evaluate(() => { app.battle.stop(); app.mode = 'lobby'; app.renderer.render(); });
    assert.deepEqual(await page.evaluate(() => app.fx.focus.area.value.toArray()), [0, 0, 0, 0]);
    await page.evaluate(async () => { await app.startStage(app.eco.nextStage()); app.renderer.update(1 / 60, 1 / 60); app.renderer.render(); });
    assert.ok(await page.evaluate(() => app.fx.focus.area.value.z > 0));
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failures, [], 'every preregistered hero readability case must pass'); report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); if (server) await new Promise(r => server.httpServer.close(r));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, report: join(out, 'report.json') }));
}
