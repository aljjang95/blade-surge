// Explicit local browser authorization is required before running this adapter.
// Isolated save, real compiled app + native browser input, controlled fixed-step combat.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'work/overhaul-v3/gameplay');
const report = {
  status: 'running', started: new Date().toISOString(),
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Local compiled app, isolated save, native mouse/keyboard and controlled fixed-step battle. Projected visible mesh geometry is not pixel occlusion proof. No physical-device, human-playtest, production or audio-perception claim.',
  errors: [], externalRequests: [], checks: [], framing: [],
};
const check = (ok, name, evidence) => {
  report.checks.push({ name, pass: !!ok, evidence });
  if (!ok) throw Error(name + ': ' + JSON.stringify(evidence));
};
let browser, server;
await mkdir(out, { recursive: true });
try {
  server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(launchOpts({ headless: true }));
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || /^(data|blob):/.test(url)) return route.continue();
    report.externalRequests.push({ url, method: route.request().method() });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'));
  await page.evaluate(async () => {
    app.testPause = true; app.ui.closeModal(); app.eco.s.energy = 100;
    app.eco.s.selected = 'knight';
    if (!await app.startStage(app.eco.nextStage())) throw Error('Stage did not start');
    app.battle.player.auto = false; app.battle.player.invuln = 10000;
    app.companionAgent?.endBattle();
    for (let i = 0; i < 120; i++) app.step(1 / 60, i === 119);
    for (const enemy of app.battle.enemies) enemy.stun = 10000;
  });
  const step = count => page.evaluate(count => { for (let i = 0; i < count; i++) app.step(1 / 60, i === count - 1); }, count);
  await page.evaluate(() => document.activeElement?.blur());
  const initialYaw = await page.evaluate(() => app.cameraControls.value.yaw);
  await page.mouse.move(440, 180); await page.mouse.down({ button: 'right' });
  await page.mouse.move(570, 185, { steps: 8 }); await page.mouse.up({ button: 'right' });
  await step(90);
  const drag = await page.evaluate(() => ({ yaw: app.cameraControls.value.yaw, active: !!app.cameraControls.drag, joy: app.input.joy.active }));
  check(Math.abs(drag.yaw - initialYaw) > 20 && !drag.active && !drag.joy, 'Right drag rotates camera without claiming joystick', drag);
  const zoomBefore = await page.evaluate(() => app.cameraControls.value.zoom);
  await page.mouse.wheel(0, -120);
  const zoomAfter = await page.evaluate(() => app.cameraControls.value.zoom);
  check(zoomAfter > zoomBefore, 'Wheel zoom', { zoomBefore, zoomAfter });

  for (const yaw of [-90, 0, 90, 170]) {
    await page.evaluate(yaw => { app.input.clear(); app.cameraControls.set({ yaw }); app.battle.player.state = 'idle'; }, yaw);
    await step(90);
    await page.keyboard.down('d');
    const move = await page.evaluate(() => {
      app.input.update();
      const p = app.battle.player.pos.clone(), c = app.renderer.camera;
      const a = p.clone().project(c), b = p.clone().add(new __THREE.Vector3(app.input.move.x, 0, app.input.move.y)).project(c);
      return { world: { ...app.input.move }, screenDx: b.x - a.x, screenDy: b.y - a.y, start: p.toArray() };
    });
    await step(12); await page.keyboard.up('d');
    move.end = await page.evaluate(() => app.battle.player.pos.toArray());
    check(move.screenDx > .001 && Math.abs(move.screenDy) < Math.abs(move.screenDx) * .25, 'Camera-relative right input at ' + yaw, move);
    check(Math.hypot(move.end[0] - move.start[0], move.end[2] - move.start[2]) > .01, 'Manual player movement at ' + yaw, move);
  }

  await page.mouse.move(440, 180); await page.mouse.down({ button: 'right' });
  await page.mouse.move(465, 180);
  await page.evaluate(() => app.ui.pause(true));
  const paused = await page.evaluate(() => ({ paused: app.battle.paused, drag: !!app.cameraControls.drag, held: app.input.attackHeld, enabled: app.input.enabled, yaw: app.cameraControls.value.yaw }));
  await page.mouse.move(600, 220); await page.mouse.up({ button: 'right' });
  const pausedYaw = await page.evaluate(() => app.cameraControls.value.yaw);
  check(paused.paused && !paused.drag && !paused.held && pausedYaw === paused.yaw, 'Pause releases camera capture and blocks rotation', paused);
  await page.locator('#btn-resume').click(); await page.evaluate(() => document.activeElement?.blur());

  await page.keyboard.down('j'); await page.keyboard.down('Space'); await page.keyboard.up('j');
  const heldOne = await page.evaluate(() => ({ held: app.input.attackHeld, sources: [...app.input.attackSources] }));
  await page.keyboard.up('Space');
  check(heldOne.held && heldOne.sources.includes('Space') && !await page.evaluate(() => app.input.attackHeld), 'Independent keyboard attack sources release', heldOne);
  const attack = await page.locator('#btn-attack').boundingBox();
  await page.mouse.move(attack.x + attack.width / 2, attack.y + attack.height / 2); await page.mouse.down();
  await page.keyboard.down('j'); await page.mouse.up();
  const overlap = await page.evaluate(() => ({ held: app.input.attackHeld, sources: [...app.input.attackSources] }));
  await page.keyboard.up('j');
  check(overlap.held && overlap.sources.includes('KeyJ') && !await page.evaluate(() => app.input.attackHeld), 'Button release preserves independently held keyboard attack', overlap);

  await page.evaluate(() => {
    app.input.clear(); const g = app.battle, p = g.player;
    const type = Object.keys(__EN).find(id => !__EN[id].boss && app.models[__EN[id].model]);
    const e = g.spawnEnemy(type, null, g.curRoom, p.pos.clone().add(new __THREE.Vector3(0, 0, -1.5)));
    if (!e) throw Error('Contact probe enemy unavailable');
    e.spawning = false; e.stun = 10000; e.hp = e.maxHp = 100000;
    p.state = 'idle'; p.stun = 0; p.vel.set(0, 0, 0); p.lockTarget = e;
    const damage = g.damageEnemy;
    window.__contact = { hits: [], restore: () => { g.damageEnemy = damage; } };
    g.damageEnemy = function (target, amount, options) {
      const before = target.hp, result = damage.call(this, target, amount, options);
      // Base melee hitArea currently omits source; damageEnemy defaults it to player.
      if (target === e && (!options?.source || options.source === p) && p.state === 'attack') __contact.hits.push({ loss: before - target.hp, distance: p.pos.distanceTo(e.pos), state: p.state });
      return result;
    };
  });
  await page.keyboard.down('j'); await step(110); await page.keyboard.up('j');
  const contact = await page.evaluate(() => { const hits = __contact.hits; __contact.restore(); return hits; });
  check(contact.some(hit => hit.loss > 0), 'Manual held attack causes direct-contact damage', contact);
  await page.screenshot({ path: path.join(out, 'contact.png') });

  for (const [width, height] of [[880, 400], [640, 360]]) for (const low of [false, true]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: low ? 'reduce' : 'no-preference' });
    await page.evaluate(low => {
      app.ui.pause(false); app.input.clear(); app.renderer.setQuality(low ? 'low' : 'high'); app.fx.setQuality(low ? 'low' : 'high');
      app.cameraControls.reset(); app.battle.player.state = 'idle';
    }, low);
    await step(120);
    const bounds = await page.evaluate(() => {
      const p = app.battle.player, points = []; app.scene.updateMatrixWorld(true);
      p.model.traverse(o => {
        if (!o.isMesh || o.name === 'HeroOccludedSilhouette') return;
        for (let a = o; a; a = a.parent) if (!a.visible) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        if (materials.every(m => m.visible === false || m.opacity === 0)) return;
        const v = new __THREE.Vector3();
        for (let i = 0; i < o.geometry.attributes.position.count; i++) {
          o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).project(app.renderer.camera);
          if (v.z >= -1 && v.z <= 1) points.push({ x: (v.x + 1) * innerWidth / 2, y: (1 - v.y) * innerHeight / 2 });
        }
      });
      const b = { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
      return { ...b, height: b.bottom - b.top, vertices: points.length, locator: p.beacon.locator.visible && p.beacon.root.visible, quality: app.renderer.quality, reduced: app.reducedMotion.matches, width: innerWidth, viewportHeight: innerHeight, radial: app.renderer.u.uRadial.value, aberr: app.renderer.u.uAberr.value };
    });
    report.framing.push(bounds);
    check(bounds.vertices > 100 && bounds.height >= 24 && bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height && bounds.locator, 'Player visible geometry bounds ' + width + '/' + low, bounds);
    check(bounds.radial === 0 && bounds.aberr === 0 && bounds.reduced === low, 'Clear effects and reduced-motion state ' + width + '/' + low, bounds);
    await page.screenshot({ path: path.join(out, `battle-${width}-${low ? 'low-reduced' : 'high'}.png`) });
  }
  check(report.errors.length === 0, 'No uncaught browser exceptions', report.errors);
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  report.finished = new Date().toISOString();
  const file = path.join(out, 'report.json');
  await writeFile(file, JSON.stringify(report, null, 2));
  await writeFile(path.join(out, 'report.sha256'), createHash('sha256').update(await readFile(file)).digest('hex'));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure, report: file }));
}
