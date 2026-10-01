// 실제 게임의 링 draw와 수명을 측정하며 자연 완주·실기기 증거와 구분한다.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { launchOpts } from './chrome.mjs';

const out = resolve(process.argv[2] || 'work/ring-batch');
const originArg = process.argv[3];
const report = { status: 'running', startedAt: new Date().toISOString(), controlledRender: true, cases: [], errors: [],
  scope: '실제 키보드 스킬 입력 뒤, 기존 링 32개의 단일 장면 draw와 소멸·재시작을 측정. 자연 완주 및 실기기 성능은 별도.' };
await mkdir(out, { recursive: true });
const server = originArg ? null : await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const origin = originArg || `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch(launchOpts({ headless: true }));
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
      if (!app.eco.reset()) throw Error('save reset failed');
      app.eco.s.selected = hero; app.eco.s.settings.quality = quality; app.eco.s.tutorial = { completed: true }; app.eco.save();
    }, { hero, quality });
    await page.click('#boot-start'); await page.waitForFunction(() => app.mode === 'lobby');
    await page.evaluate(async () => {
      app.ui.closeModal(); app.applySettings(); app.testPause = true;
      if (app.fx.rings) {
        globalThis.__ringCompiles = 0;
        const material = app.fx.rings.material, previous = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => { globalThis.__ringCompiles++; previous.call(material, shader, renderer); };
      }
      let seed = 20261001; Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      await app.startStage(app.eco.nextStage()); globalThis.__ringWarmCompiles = globalThis.__ringCompiles;
      app.battle.player.auto = false; document.activeElement?.blur();
    });
    const before = await page.evaluate(() => app.battle.player.mp);
    await page.keyboard.down('1');
    const cast = await page.evaluate(() => { app.step(1 / 60, true); const p = app.battle.player;
      return { state: p.state, mp: p.mp, cooldown: p.cds[0] }; });
    await page.keyboard.up('1');
    assert.equal(cast.state, 'skill'); assert.ok(cast.mp < before); assert.ok(cast.cooldown > 0);
    await page.evaluate(() => { for (let i = 0; i < 48; i++) app.step(1 / 60, i === 47); });
    await page.screenshot({ path: join(out, `${hero}-${quality}-real-skill.png`) });
    const result = await page.evaluate(() => {
      const b = app.battle, p = b.player, r = app.renderer.r;
      const room = b.world.rooms.find(room => room.type === 'normal');
      p.pos.set(room.x, 0, room.z); p.yaw = 0; app.fx.clearAll(); b.hazards.spawn(room, p);
      app.renderer.rig.target.copy(p.pos); app.renderer.rig.pos.copy(p.pos).add(app.renderer.rig.offset);
      for (let i = 0; i < 60; i++) app.renderer.update(1 / 60, 1 / 60);
      const warnings = b.hazards.getPartyWarnings();
      const count = () => {
        const previous = r.getRenderTarget();
        // 실제 전투와 같은 선형 합성 타깃으로 그려 별도 화면 셰이더를 만들지 않는다.
        r.setRenderTarget(app.renderer.composer.readBuffer); r.info.reset();
        r.render(app.renderer.scene, app.renderer.camera);
        const calls = r.info.render.calls; r.setRenderTarget(previous); return calls;
      };
      const restCalls = count();
      const colors = [0xff6040, 0x60dfff, 0xb080ff, 0xffd060];
      for (let i = 0; i < 32; i++) {
        const angle = i / 32 * Math.PI * 2;
        app.fx.ring(p.pos.clone().add(new __THREE.Vector3(Math.cos(angle) * 1.5, 0, Math.sin(angle) * 1.5)), colors[i % 4],
          { r0: .25, r1: 2 + (i % 3) * .3, life: 1, y: .09 });
      }
      app.fx.update(.2); const ringCalls = count(); app.renderer.render();
      return { restCalls, ringCalls, addedDrawCalls: ringCalls - restCalls, pooled: !!app.fx.rings, instances: app.fx.rings?.mesh.count,
        ringCompiles: { prepared: globalThis.__ringWarmCompiles, afterDraw: globalThis.__ringCompiles },
        warnings, warningsAfter: b.hazards.getPartyWarnings(), alive: p.alive };
    });
    report.lastSample = { hero, quality, reduced, cast, ...result };
    assert.equal(result.addedDrawCalls, result.pooled ? 1 : 64);
    if (result.pooled) {
      assert.equal(result.instances, 32);
      assert.ok(result.ringCompiles.prepared > 0);
      assert.equal(result.ringCompiles.afterDraw, result.ringCompiles.prepared, '실제 링 프로그램은 준비 이후 다시 컴파일하지 않는다');
    }
    assert.deepEqual(result.warningsAfter, result.warnings); assert.equal(result.alive, true);
    await page.screenshot({ path: join(out, `${hero}-${quality}-stacked-rings.png`) });
    const cleared = await page.evaluate(() => {
      app.fx.update(1); const r = app.renderer.r, previous = r.getRenderTarget();
      r.setRenderTarget(app.renderer.composer.readBuffer); r.info.reset(); r.render(app.renderer.scene, app.renderer.camera); r.setRenderTarget(previous);
      return { calls: r.info.render.calls, instances: app.fx.rings?.mesh.count, visible: app.fx.rings?.mesh.visible };
    });
    assert.equal(cleared.calls, result.restCalls);
    if (result.pooled) { assert.equal(cleared.instances, 0); assert.equal(cleared.visible, false); }
    await page.evaluate(() => { app.fx.ring(app.battle.player.pos, 0xffffff, { life: 5 }); app.battle.stop(); app.mode = 'lobby'; });
    if (result.pooled) assert.equal(await page.evaluate(() => app.fx.rings.mesh.count), 0);
    await page.evaluate(async () => { await app.startStage(app.eco.nextStage()); app.fx.ring(app.battle.player.pos, 0xffd060); app.step(1 / 60, true); });
    if (result.pooled) assert.ok(await page.evaluate(() => app.fx.rings.mesh.count > 0));
    report.cases.push({ hero, quality, reduced, cast, ...result, cleared, restarted: true }); await context.close();
  }
  assert.deepEqual(report.errors, []); report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); if (server) await new Promise(r => server.httpServer.close(r));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, report: join(out, 'report.json') }));
}
