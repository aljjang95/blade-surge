#!/usr/bin/env node
// 격리된 로컬 빌드의 실제 입력과 제어된 아트 검사를 분리해 기록한다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const at = a.indexOf('=');
  return at < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, at), a.slice(at + 1)];
}));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(root, String(args.out || `work/dungeon-forge-20261008/qa-${stamp}`));
const report = {
  schema: 1, status: 'RUNNING', started: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Local compiled game; isolated browser save. Native pointer/keyboard events use controlled fixed simulation steps. Separate art fixtures directly visit locked chapters, place/stun durable enemies and grant invulnerability. This is not natural campaign progression, a human playtest, physical-device/GPU performance, audio-perception or production release evidence.',
  fontconfigFixture: process.env.FONTCONFIG_FILE || null,
  viewports: [[1440, 900], [390, 844], [360, 800]],
  checks: [], errors: [], warnings: [], networkFailures: [], badResponses: [], externalRequests: [], optionalFontFixtures: [], screenshots: [],
};
await mkdir(out, { recursive: false });
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const check = (ok, name, evidence, scope = 'controlled-fixture') => {
  report.checks.push({ name, status: ok ? 'PASS' : 'FAIL', scope, evidence });
  console.log(JSON.stringify({ checkpoint: name, status: ok ? 'PASS' : 'FAIL', ...(ok ? {} : { evidence }) }));
  if (!ok) throw Error(name + ': ' + JSON.stringify(evidence));
};
let browser, server, page;
const step = count => page.evaluate(count => {
  for (let i = 0; i < count; i++) app.step(1 / 60, i === count - 1);
}, count);
const screenshot = async name => {
  const file = path.join(out, name + '.png');
  await page.screenshot({ path: file, timeout: 120000 }); report.screenshots.push(file); return file;
};
const dismissRotate = async () => {
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
};
const geometry = () => page.evaluate(() => {
  const selectors = ['#btn-attack', '#btn-dodge', '#btn-pause', '#joy .joy-base'];
  return selectors.map(selector => {
    const e = document.querySelector(selector), r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { selector, x: r.x, y: r.y, width: r.width, height: r.height,
      inside: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      reachable: hit === e || e.contains(hit) || (selector.includes('joy') && !!hit?.closest('#joy')),
      hit: hit?.id || (typeof hit?.className === 'string' ? hit.className : '') };
  });
});
async function fixtureStage(ch, st, hero = 'knight') {
  return page.evaluate(async ({ ch, st, hero }) => {
    app.toLobby(); app.ui.closeModal(); app.testPause = true;
    document.querySelector('#meta').classList.remove('show'); app.mode = 'battle';
    const stage = __stageDef(ch, st);
    await app.battle.start(stage, hero, app.eco.hero(hero), app.eco.heroEquipBonus(hero));
    app.companionAgent?.endBattle(); app.battle.player.auto = false;
    app.battle.player.invuln = 10000;
    for (let i = 0; i < 90; i++) app.step(1 / 60, i === 89);
    return { code: stage.code, name: stage.dungeon?.name, theme: stage.chapter.theme };
  }, { ch, st, hero });
}

async function wardrobeQa({ framing = false } = {}) {
  const sizes = framing ? report.viewports : [[1440, 900]];
  await page.locator('button[data-tab="heroes"]').click(); await step(1);
  await page.waitForFunction(() => app.wardrobe?.instance?.root && document.querySelector('#hero-wardrobe canvas'), null, { timeout: 45000 });
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await dismissRotate(); await step(1);
    for (const hero of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
      const beforeId = await page.evaluate(() => app.wardrobe.instance?.root.uuid);
      await page.locator(`#hero-list [data-hero-id="${hero}"]`).click();
      await page.waitForFunction(beforeId => app.wardrobe.instance?.root && app.wardrobe.instance.root.uuid !== beforeId, beforeId, { timeout: 45000 });
      const wardrobe = await page.evaluate(() => {
        const nodes = [], canvas = document.querySelector('#hero-wardrobe canvas');
        app.wardrobe.instance.root.traverse(o => {
          if (!o.isMesh || (!/^Forge_/.test(o.name) && !o.userData.forgedWeapon)) return;
          let visible = true; for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
          nodes.push({ name: o.name, form: o.userData.forgedWeapon, visible });
        });
        const gl = canvas.getContext('webgl2');
        return { nodes, width: canvas.width, height: canvas.height, webgl2: gl instanceof WebGL2RenderingContext, lost: gl?.isContextLost() };
      });
      check(wardrobe.nodes.some(n => n.visible) && wardrobe.webgl2 && !wardrobe.lost && wardrobe.width > 0 && wardrobe.height > 0,
        `Native R3F wardrobe forged weapon ${hero}/${width}`, wardrobe, 'native-input');
      if (!framing) {
        await page.getByRole('button', { name: '착용 모습 오른쪽 회전' }).click();
        await screenshot('r3f-wardrobe-' + hero); continue;
      }
      for (const direction of ['front', 'left', 'right']) {
        await page.locator('.wardrobe-controls').getByRole('button', { name: '정면', exact: true }).click();
        if (direction !== 'front') await page.getByRole('button', { name: direction === 'left' ? '착용 모습 왼쪽 회전' : '착용 모습 오른쪽 회전' }).click();
        const yaw = direction === 'front' ? 0 : direction === 'left' ? -Math.PI / 4 : Math.PI / 4;
        await page.waitForFunction(yaw => Math.abs((app.wardrobe.instance?.root.parent?.parent?.rotation.y ?? 100) - yaw) < .001, yaw);
        const framing = await page.evaluate(() => {
          const instance = app.wardrobe.instance, state = instance.root.__r3f?.root?.getState?.();
          if (!state?.camera) throw Error('R3F current camera is unavailable for independent projection');
          state.scene.updateMatrixWorld(true); state.camera.updateMatrixWorld(true);
          const box = { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity, near: Infinity, far: -Infinity }, point = new __THREE.Vector3();
          let vertices = 0;
          instance.root.traverseVisible(o => {
            if (!o.isMesh) return;
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            if (materials.every(m => m.visible === false || m.opacity === 0)) return;
            for (let i = 0; i < o.geometry.attributes.position.count; i++) {
              o.getVertexPosition(i, point).applyMatrix4(o.matrixWorld).project(state.camera); vertices++;
              box.left = Math.min(box.left, point.x); box.right = Math.max(box.right, point.x);
              box.top = Math.max(box.top, point.y); box.bottom = Math.min(box.bottom, point.y);
              box.near = Math.min(box.near, point.z); box.far = Math.max(box.far, point.z);
            }
          });
          const canvas = document.querySelector('#hero-wardrobe canvas'), rect = canvas.getBoundingClientRect();
          return { box, vertices, viewport: [innerWidth, innerHeight], canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            frame: instance.frame, camera: { position: state.camera.position.toArray(), fov: state.camera.fov, aspect: state.camera.aspect } };
        });
        check(framing.vertices > 100 && framing.box.left >= -1.001 && framing.box.right <= 1.001 && framing.box.bottom >= -1.001 && framing.box.top <= 1.001 && framing.box.near >= -1 && framing.box.far <= 1,
          `Visible animated hero and weapon stay inside R3F camera ${hero}/${width}/${direction}`, framing, 'native-rotation-visible-vertex-projection');
        if ((width === 1440 && direction === 'right') || (width === 390 && direction === 'front') || (width === 360 && direction === 'left')) {
          await screenshot(`r3f-wardrobe-${hero}-${width}-${direction}`);
        }
      }
    }
  }
  await page.locator('button[data-tab="home"]').click();
  await page.waitForFunction(() => !app.wardrobe.instance && !document.querySelector('#hero-wardrobe canvas'));
  check(true, 'Native home tab unmounts R3F wardrobe and releases character', {}, 'native-release-lifecycle');
}

async function classifyDarkFloorSlabs() {
  const relative = 'src/game/region-architecture.js';
  const source = await readFile(path.join(root, relative));
  const original = execFileSync('git', ['show', '678caf52a19ffda2240bfd7882278c4c0b77c49d:' + relative], { cwd: root });
  const hashes = { source: createHash('sha256').update(source).digest('hex'), baseline: createHash('sha256').update(original).digest('hex') };
  check(hashes.source === hashes.baseline, 'Architectural slab authoring source is identical to pre-patch baseline', hashes, 'baseline-source-comparison');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const probe of [{ ch: 4, st: 8, x: 500, y: 820 }, { ch: 5, st: 4, x: 1340, y: 370 }]) {
    await fixtureStage(probe.ch, probe.st);
    const ray = await page.evaluate(({ x, y }) => {
      app.scene.updateMatrixWorld(true); app.renderer.camera.updateMatrixWorld(true);
      const caster = new __THREE.Raycaster();
      caster.setFromCamera(new __THREE.Vector2(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2), app.renderer.camera);
      const hits = caster.intersectObject(app.arena.group, true).filter(hit => {
        for (let node = hit.object; node; node = node.parent) if (!node.visible) return false;
        return true;
      }).slice(0, 5).map(hit => {
        const mesh = hit.object, material = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
        const attribute = mesh.geometry.getAttribute('color'), face = hit.face;
        return { name: mesh.name, point: hit.point.toArray(), distance: hit.distance, instanceId: hit.instanceId,
          materialRole: mesh.userData.materialRole, roomRanges: mesh.userData.roomRanges, face: { a: face.a, b: face.b, c: face.c },
          vertexColors: attribute ? [face.a, face.b, face.c].map(i => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]) : null,
          material: { name: material.name, color: material.color?.getHexString(), map: material.map?.name,
            image: material.map?.image?.currentSrc || material.map?.image?.src || null } };
      });
      return { pixel: { x, y }, viewport: [innerWidth, innerHeight], hits };
    }, probe);
    const first = ray.hits[0];
    check(first && /^(tide|crown)-(room|rooms)-/.test(first.name) && first.materialRole === 0 && first.point[1] > .05 && first.point[1] < .09,
      `Dark floor patch is existing raised architectural stone, not a missing tile ${probe.ch}-${probe.st}`, ray, 'actual-pixel-raycast-and-unchanged-source');
    await screenshot(`floor-slab-probe-${probe.ch}-${probe.st}`);
  }
}

try {
  report.version = JSON.parse(await readFile(path.join(root, 'dist/version.json'), 'utf8'));
  server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  report.origin = origin;
  browser = await chromium.launch(launchOpts({ headless: true })); report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || /^(data|blob):/.test(url)) return route.continue();
    if (new URL(url).hostname === 'fonts.googleapis.com') {
      report.optionalFontFixtures.push({ url, fixture: 'Empty optional external font CSS; uses installed system fallback. No CDN-font availability claim.' });
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    report.externalRequests.push({ url, method: route.request().method() }); return route.abort();
  });
  page = await context.newPage();
  if (args['font-dir']) {
    const fonts = await Promise.all([400, 700].map(async weight => ({ weight,
      data: (await readFile(path.join(String(args['font-dir']), `noto-sans-kr-korean-${weight}-normal.woff2`))).toString('base64') })));
    report.systemFontFixture = { family: 'Noto Sans KR', weights: fonts.map(f => f.weight),
      scope: 'QA-only local font preload for missing container Korean fonts; application CSS and production assets unchanged.' };
    await page.addInitScript(fonts => {
      window.__qaFonts = Promise.all(fonts.map(async ({ weight, data }) => {
        const font = new FontFace('Noto Sans KR', `url(data:font/woff2;base64,${data})`, { weight: String(weight) });
        await font.load(); document.fonts.add(font);
      }));
    }, fonts);
  }
  page.on('pageerror', e => { report.errors.push({ kind: 'pageerror', text: String(e) }); console.error('QA pageerror:', String(e)); });
  page.on('console', m => {
    if (m.type() === 'error') { report.errors.push({ kind: 'console', text: m.text() }); console.error('QA console:', m.text()); }
    else if (m.type() === 'warning') report.warnings.push(m.text());
  });
  page.on('requestfailed', req => report.networkFailures.push({ url: req.url(), resource: req.resourceType(), error: req.failure()?.errorText }));
  page.on('response', res => { if (res.status() >= 400) report.badResponses.push({ url: res.url(), status: res.status() }); });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (args['font-dir']) await page.evaluate(() => window.__qaFonts);
  await dismissRotate();
  await page.locator('#boot-start:not(.hidden)').waitFor({ state: 'visible', timeout: 180000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 60000 });
  if (await page.locator('#modal.show #m-cancel').isVisible()) await page.locator('#m-cancel').click();
  await page.locator('.citadel-command-campaign').waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(() => { app.testPause = true; app.step(1 / 60, true); });
  const gpu = await page.evaluate(() => {
    const renderer = app.renderer, gl = renderer.r.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: gl instanceof WebGL2RenderingContext, lost: gl.isContextLost(), version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER), revision: __THREE.REVISION };
  });
  check(gpu.webgl2 && !gpu.lost, 'Actual game WebGL2 context available', gpu, 'native-boot');
  if (args['wardrobe-only']) {
    report.scope = 'Local compiled game, isolated save; native hero-tab/hero-card/front/left/right buttons at 1440/390/360. All visible skinned vertices project through the current R3F camera. Geometry bounds are not pixel occlusion, physical-device or production evidence. Manual screenshot review remains a separate gate.';
    await wardrobeQa({ framing: true });
    await classifyDarkFloorSlabs();
  } else {
  await screenshot('lobby-1440');
  await page.locator('.citadel-command-campaign').click();
  await step(1);
  await page.locator('#st-go').click();
  await page.waitForFunction(() => app.mode === 'battle' && app.battle.active && !app.stageStarting, null, { timeout: 90000 });
  if (await page.evaluate(() => app.battle.player.auto)) await page.locator('#btn-auto').click();
  await page.evaluate(() => document.activeElement?.blur());
  await step(90);
  check(await page.evaluate(() => app.battle.stage.code === '1-1' && !app.battle.player.auto), 'Fresh save enters first stage through visible campaign card and entry button', {}, 'native-input');

  for (const [width, height] of report.viewports) {
    await page.setViewportSize({ width, height }); await dismissRotate(); await step(90);
    const boxes = await geometry();
    check(boxes.every(b => b.inside && b.reachable && b.width >= 32 && b.height >= 32), `Reachable battle controls ${width}x${height}`, boxes, 'native-layout');
    const before = await page.evaluate(() => app.battle.player.pos.toArray());
    const joy = await page.locator('#joy .joy-base').boundingBox();
    await page.mouse.move(joy.x + joy.width / 2, joy.y + joy.height / 2); await page.mouse.down();
    await page.mouse.move(joy.x + joy.width * .8, joy.y + joy.height / 2, { steps: 8 });
    await step(18); await page.mouse.up(); await step(3);
    const after = await page.evaluate(() => ({ pos: app.battle.player.pos.toArray(), active: app.input.joy.active }));
    const travel = Math.hypot(after.pos[0] - before[0], after.pos[2] - before[2]);
    check(travel > .05 && !after.active, `Native joystick moves and releases ${width}`, { before, after, travel, fixedSteps: 21 }, 'native-pointer-input');
    await page.locator('#btn-attack').click(); await step(1);
    const attack = await page.evaluate(() => ({ state: app.battle.player.state, clip: app.battle.player.actionName,
      held: app.input.attackHeld, combo: app.battle.player.attackProgress() }));
    check(attack.state === 'attack', `Native attack starts an actual clip ${width}`, attack, 'native-pointer-input');
    await step(90);
    await page.locator('#btn-pause').click();
    const pauseStart = await page.evaluate(() => app.battle.elapsed); await step(60);
    const pause = await page.evaluate(() => ({ paused: app.battle.paused, elapsed: app.battle.elapsed, held: app.input.attackHeld, joy: app.input.joy.active }));
    check(pause.paused && pause.elapsed === pauseStart && !pause.held && !pause.joy, `Pause freezes and releases controls ${width}`, pause, 'native-pointer-input');
    await page.locator('#btn-resume').click(); await step(3);
    check(!await page.evaluate(() => app.battle.paused), `Native resume ${width}`, {}, 'native-pointer-input');
    await screenshot(`battle-native-${width}`); await save();
  }
  await page.locator('#btn-pause').click(); await page.locator('#btn-giveup').click();
  await page.locator('#btn-result-lobby').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#btn-result-lobby').click();
  await page.waitForFunction(() => app.mode === 'lobby');
  const returned = await page.evaluate(() => ({ active: app.battle.active, player: !!app.battle.player, held: app.input.attackHeld,
    trails: app.fx.trails.length, fx: app.fx.items.length, enabled: app.input.enabled }));
  check(!returned.active && !returned.player && !returned.held && !returned.trails, 'Native giveup/result/lobby removes battle actors and trails', returned, 'native-release-lifecycle');

  await page.setViewportSize({ width: 1440, height: 900 });
  await wardrobeQa();
  await fixtureStage(1, 1);
  const art = await page.evaluate(() => {
    const names = ['Skeleton_Vanguard', 'Skeleton_Skirmisher', 'Skeleton_Runekeeper', 'Skeleton_Bulwark'];
    const models = names.map(name => {
      const model = app.models[name], nodes = [];
      model?.scene.traverse(o => { if (o.isSkinnedMesh && o.name.startsWith('TLL_' + name + '_')) nodes.push({ name: o.name, vertices: o.geometry.attributes.position.count }); });
      return { name, loaded: !!model, clips: model?.animations.length || 0, nodes };
    });
    const weapons = [];
    app.battle.player.model.traverse(o => {
      if (!o.isMesh || (!/^Forge_/.test(o.name) && !o.userData.forgedWeapon)) return;
      let visible = true; for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
      weapons.push({ name: o.name, form: o.userData.forgedWeapon, visible, vertices: o.geometry.attributes.position.count });
    });
    return { models, weapons };
  });
  check(art.models.every(m => m.loaded && m.clips > 0 && m.nodes.length > 0), 'Four authored enemy surfaces are loaded on real animated rigs', art.models);
  check(art.weapons.some(w => w.visible && w.vertices > 0), 'Actual knight actor carries authored forge weapon geometry', art.weapons);

  const contactSetup = await page.evaluate(() => {
    const g = app.battle, p = g.player, r = g.world.startRoom;
    for (const e of g.enemies) e.dispose(); g.enemies.length = 0;
    p.pos.set(r.x, 0, r.z); p.state = 'idle'; p.stun = 0; p.vel.set(0, 0, 0); p.kb.set(0, 0, 0); p.yaw = Math.PI;
    const names = ['Skeleton_Vanguard', 'Skeleton_Skirmisher', 'Skeleton_Runekeeper', 'Skeleton_Bulwark'];
    const enemies = names.map((name, i) => {
      const type = Object.keys(__EN).find(id => __EN[id].model === name);
      if (!type) throw Error('No runtime roster for ' + name);
      const e = g.spawnEnemy(type, null, r, { x: r.x + (i ? (i - 2) * 2.5 : 0), z: r.z + (i ? -4 : -1.45) });
      e.spawning = false; e.stun = 10000; e.hp = e.maxHp = 100000; return e;
    });
    p.lockTarget = enemies[0];
    const contact = app.fx.contact, damage = g.damageEnemy;
    window.__forgeProbe = { contacts: [], damage: [], peakTrailSamples: 0, peakTrailIndices: 0, target: enemies[0] };
    app.fx.contact = function (...args) {
      const result = contact.apply(this, args);
      __forgeProbe.contacts.push({ options: args[3], sprite: !!result?.isSprite, width: result?.scale.x, height: result?.scale.y,
        texture: result?.material?.map?.image?.currentSrc || result?.material?.map?.image?.src || 'procedural' });
      return result;
    };
    g.damageEnemy = function (target, amount, options) {
      const hp = target.hp, result = damage.call(this, target, amount, options);
      if (target === __forgeProbe.target && hp > target.hp) __forgeProbe.damage.push({ loss: hp - target.hp, state: p.state });
      return result;
    };
    __forgeProbe.restore = () => { app.fx.contact = contact; g.damageEnemy = damage; };
    return enemies.map(e => ({ type: e.type, model: e.def.model, pos: e.pos.toArray(), alive: e.alive }));
  });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('j');
  const hit = await page.evaluate(() => {
    for (let i = 0; i < 90; i++) {
      app.step(1 / 60, i % 10 === 0);
      for (const tr of app.fx.trails) {
        __forgeProbe.peakTrailSamples = Math.max(__forgeProbe.peakTrailSamples, tr.n);
        __forgeProbe.peakTrailIndices = Math.max(__forgeProbe.peakTrailIndices, tr.geo.drawRange.count);
      }
      if (__forgeProbe.contacts.length) { app.step(.001, true); break; }
    }
    return { contacts: __forgeProbe.contacts, damage: __forgeProbe.damage, peakTrailSamples: __forgeProbe.peakTrailSamples,
      peakTrailIndices: __forgeProbe.peakTrailIndices };
  });
  await page.keyboard.up('j');
  check(hit.damage.some(d => d.loss > 0) && hit.contacts.length > 0 && hit.contacts.every(c => c.sprite), 'Native key attack damages controlled enemy and emits new contact VFX', { setup: contactSetup, ...hit }, 'native-key-with-enemy-fixture');
  check(hit.peakTrailSamples >= 2 && hit.peakTrailIndices >= 6, 'Actual weapon motion writes visible trail triangles', hit, 'native-key-with-enemy-fixture');
  await screenshot('forge-enemies-contact');
  await page.evaluate(() => __forgeProbe.restore());
  await step(180);
  const ended = await page.evaluate(() => ({ trails: app.fx.trails.length, held: app.input.attackHeld, state: app.battle.player.state }));
  check(ended.trails === 0 && !ended.held, 'Released attack expires weapon trails', ended);

  for (const [ch, st] of [[1, 4], [2, 4], [3, 8], [4, 8], [5, 4], [6, 3]]) {
    const stage = await fixtureStage(ch, st);
    const scene = await page.evaluate(() => {
      const g = app.battle, maps = [], surfaces = [], renderer = app.renderer.r;
      app.arena.group.traverse(o => {
        if (!o.isMesh) return;
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          const image = material.map?.image, src = image?.currentSrc || image?.src || '';
          if (/dungeon|forge|stone/i.test(src)) maps.push({ node: o.name, material: material.name, tag: material.userData.surfaceTexture,
            textureName: material.map.name, url: src, width: image?.width, height: image?.height });
        }
        if (/surface|forge/i.test(o.name)) surfaces.push({ name: o.name, instances: o.count, vertices: o.geometry.attributes.position.count });
      });
      return { maps, surfaces, rooms: g.world.rooms.length, roomCentersWalkable: g.world.rooms.every(r => g.world.walkable(r.x, r.z)),
        spawnWalkable: g.world.walkable(g.player.pos.x, g.player.pos.z), drawCalls: renderer.info.render.calls,
        surface: app.arena.group.userData.dungeonSurface, memory: { ...renderer.info.memory }, lost: renderer.getContext().isContextLost() };
    });
    check(scene.roomCentersWalkable && scene.spawnWalkable && !scene.lost, 'Dungeon room/spawn geometry ' + stage.code, { stage, ...scene });
    check(scene.maps.some(m => m.width > 0 && m.height > 0 && /dungeon-stone-v1/.test(m.url) && m.tag === 'gpt-dungeon-stone-v1'), 'Generated stone texture is sampled by actual dungeon material ' + stage.code, scene.maps);
    check(scene.surface?.uniqueTiles > 0 && scene.surface.uniqueTiles < scene.surface.sampledTiles, 'Dungeon surface removes overlapping tile instances ' + stage.code, scene.surface);
    await screenshot(`dungeon-${stage.code}-${stage.theme}`); await save();
  }
  const lifecycle = await page.evaluate(() => {
    const oldPlayer = app.battle.player.root, oldEnemies = app.battle.enemies.map(e => e.root), trails = [...app.fx.trails];
    app.toLobby();
    const attached = obj => { for (let o = obj; o; o = o.parent) if (o === app.scene) return true; return false; };
    return { mode: app.mode, playerAttached: attached(oldPlayer), enemiesAttached: oldEnemies.filter(attached).length,
      trailsAttached: trails.filter(t => attached(t.mesh)).length, trails: app.fx.trails.length, battle: app.battle.active,
      contextLost: app.renderer.r.getContext().isContextLost(), glError: app.renderer.r.getContext().getError() };
  });
  check(lifecycle.mode === 'lobby' && !lifecycle.playerAttached && !lifecycle.enemiesAttached && !lifecycle.trailsAttached && !lifecycle.trails && !lifecycle.battle && !lifecycle.contextLost && lifecycle.glError === 0,
    'Repeated chapter transitions release battle actor/trail ownership', lifecycle);
  }
  const failedVisualRequests = report.networkFailures.filter(n => /\.(?:glb|gltf|webp|png|jpe?g|js|css)(?:[?#]|$)/i.test(n.url));
  check(!failedVisualRequests.length && !report.badResponses.length, 'No failed model/texture/script loads or HTTP errors', { failedVisualRequests, badResponses: report.badResponses });
  check(!report.errors.length, 'No browser runtime or shader errors', report.errors);
  check(!report.warnings.some(w => /vfx tex fail|model.*fail|shader.*error/i.test(w)), 'No asset fallback warnings', report.warnings);
  report.status = 'PASS';
} catch (error) {
  report.status = /Executable doesn't exist|browserType.launch/.test(String(error)) ? 'BLOCKED' : 'FAIL';
  report.failure = String(error.stack || error); process.exitCode = 1;
  if (page) { try { await screenshot('failure'); } catch {} }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  report.finished = new Date().toISOString(); await save();
  await writeFile(path.join(out, 'report.sha256'), createHash('sha256').update(await readFile(path.join(out, 'report.json'))).digest('hex') + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, out, failure: report.failure }));
}
