// 유리 정원 소품 키트 실제 화면 점검: 첫 던전(유리 정원)에 입장해 방마다 영웅을 옮기며 스크린샷과 draw call을 기록한다.
// 흐름은 camera-gesture-qa.mjs와 같다(부팅 → 모달 닫기 → 던전 입구 → 출격 준비 → 시작). 영웅 이동은 QA 전용 직접 배치이며
// 실제 터치 이동·GPU·발열 증거가 아니다. 장식 on/off 비교는 같은 방·같은 프레임에서 그룹 가시성만 바꾼다.
// 실행: node tools/glass-garden-decor-qa.mjs --url=http://127.0.0.1:5186/ --label=<이름>
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
const target = new URL(arg('url') || 'http://127.0.0.1:5186/');
if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('localhost only');
const label = arg('label') || new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[\w-]+$/.test(label)) throw Error('Invalid --label');
const dir = 'work/qa/glass-garden/' + label;
await mkdir(dir, { recursive: true });
const report = { label, target: target.href, scope: 'Local headless Chromium (SwiftShader) 844x390 touch emulation. Hero placed directly by the QA script; not a device/GPU/feel result.', shots: [], rooms: [], errors: [], console: [] };

const browser = await chromium.launch(launchOpts({ headless: true }));
const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await context.newPage(); page.setDefaultTimeout(120000);
page.on('pageerror', e => report.errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) report.console.push('http ' + r.status() + ' ' + r.url().slice(-120)); });
page.on('crash', () => report.errors.push('page crash'));
page.on('framenavigated', f => { if (f === page.mainFrame()) report.console.push('navigated ' + f.url().slice(-80)); });
page.on('console', m => { if (['error', 'warning'].includes(m.type())) report.console.push(m.type() + ': ' + m.text().slice(0, 200)); });
const frames = n => page.evaluate(k => new Promise(r => { let i = 0; const f = () => ++i >= k ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }), n);
const shot = async name => { if (arg('noshot')) return; await page.screenshot({ path: `${dir}/${name}.png` }); report.shots.push(name + '.png'); };

try {
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const start = page.locator('#boot-start:not(.hidden)');
  await start.waitFor({ timeout: 180000 });
  await start.dispatchEvent('click');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
  const ignore = page.locator('#btn-ignore-rotate');
  if (await ignore.isVisible()) await ignore.dispatchEvent('click');
  await page.waitForTimeout(800);
  for (let n = 0; n < 8; n++) {
    const close = page.locator('#modal.show #m-cancel, #modal.show button:has-text("닫기"), #modal.show button:has-text("보상 받기")').first();
    if (!await close.isVisible().catch(() => false)) break;
    await close.dispatchEvent('click'); await page.waitForTimeout(500);
  }
  if (arg('quality')) await page.evaluate(q => window.app.renderer.setQuality(q), arg('quality'));
  await page.locator('#citadel-dungeon-prepare').first().dispatchEvent('click');
  const dialog = page.locator('.citadel-hub-dialog[open]');
  await dialog.waitFor({ timeout: 60000 });
  await dialog.locator('.citadel-hub-go').dispatchEvent('click');
  await page.waitForFunction(() => window.app?.battle?.active || document.querySelector('.film-skip, [data-film-skip], #film-skip'), null, { timeout: 180000 });
  const film = page.locator('.film-skip, [data-film-skip], #film-skip, button:has-text("건너뛰기")').first();
  if (await film.isVisible().catch(() => false)) await film.dispatchEvent('click');
  await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  report.expedition = await page.evaluate(() => ({ route: window.app.battle.world.expeditionRouteId, depth: window.app.battle.world.expeditionDepth, rooms: window.app.battle.world.rooms.length }));
  // renderer.render() 단독 한 번(그림자·본 장면·후처리 전체 한 프레임)을 info.reset 뒤에 읽는다. 다른 QA 도구와 같은 표본 경로.
  const info = () => page.evaluate(() => { const app = window.app, i = app.renderer.r.info, prev = i.autoReset; i.autoReset = false; i.reset();
    app.renderer.render(); const row = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, quality: app.renderer.quality }; i.autoReset = prev; return row; });
  const place = (x, z) => page.evaluate(({ x, z }) => { const p = window.app.battle.player; p.pos.set(x, p.pos.y, z); p.invuln = 1e9; for (const e of window.app.battle.enemies) e.hp = Math.max(e.hp, 1); }, { x, z });
  // 소음 줄이기: 적과 투사체를 치워 장식만 보이게 하는 대신, 실제 전투 화면을 그대로 둔다(적은 건드리지 않음).
  const decor = await page.evaluate(() => { const d = window.app.battle.arena.glassGardenDecor; return d ? { ...d.userData.stats, children: d.children.length } : null; });
  report.decor = decor;
  const rooms = await page.evaluate(() => window.app.battle.world.rooms.map(r => ({ id: r.id, type: r.type, x: r.x, z: r.z, w: r.w, h: r.h })));
  if (arg('props')) {
    // 소품 종류마다 첫 배치 앞 3.4 m에 영웅을 세워 게임 카메라로 그 소품을 찍는다.
    const placements = await page.evaluate(() => window.app.battle.arena.glassGardenDecor.userData.placements);
    const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] };
    for (const asset of [...new Set(placements.map(p => p.asset))]) {
      const list = placements.filter(p => p.asset === asset), pick = list[Math.min(list.length - 1, Number(arg('nth') || 0))];
      const [ix, iz] = inward[pick.wall];
      await place(pick.x + ix * 3.4, pick.z + iz * 3.4); await frames(5); await page.waitForTimeout(400); await frames(3);
      report.rooms.push({ room: pick.roomId, type: 'prop', view: asset, with: await info(), without: { calls: 0, triangles: 0 }, deltaCalls: 0, deltaTriangles: 0 });
      await shot(`prop-${asset}`);
    }
    await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
    throw Object.assign(new Error('props done'), { benign: true });
  }
  const views = (arg('views') || 'center,west,north,south').split(',');
  const offsets = room => ({ center: [0, 0], west: [-room.w / 2 + 5, 0], east: [room.w / 2 - 5, 0], north: [0, -room.h / 2 + 5], south: [0, room.h / 2 - 5] });
  const only = (arg('rooms') || '').split(',').filter(Boolean).map(Number);
  for (const room of rooms) {
    if (only.length && !only.includes(room.id)) continue;
    for (const tag of views) {
      const [dx, dz] = offsets(room)[tag];
      await place(room.x + dx, room.z + dz); await frames(5); await page.waitForTimeout(400); await frames(3);
      // 같은 동기 호출 안에서 장식을 켠 채·끈 채 한 번씩 그려(게임 루프가 끼어들 틈이 없다) 차이를 정확히 잰다.
      const pair = await page.evaluate(() => {
        const app = window.app, i = app.renderer.r.info, prev = i.autoReset, group = app.battle.arena.glassGardenDecor, visible = group.visible;
        const read = () => ({ calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, quality: app.renderer.quality });
        i.autoReset = false;
        try {
          group.visible = true; i.reset(); app.renderer.render(); const withDecor = read();
          group.visible = false; i.reset(); app.renderer.render(); const without = read();
          return { withDecor, without };
        } finally { group.visible = visible; i.autoReset = prev; }
      });
      const { withDecor, without } = pair;
      await frames(2);
      report.rooms.push({ room: room.id, type: room.type, view: tag, with: withDecor, without, deltaCalls: withDecor.calls - without.calls, deltaTriangles: withDecor.triangles - without.triangles });
      await shot(`room${room.id}-${tag}`);
      await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
    }
  }
} catch (error) { if (!error.benign) { report.fatal = String(error?.stack || error); process.exitCode = 1; } try { await shot('failure'); } catch {} }
await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({ dir, fatal: report.fatal, expedition: report.expedition, decor: report.decor, errors: report.errors, rooms: report.rooms.map(r => [r.room, r.view, r.with.calls, r.without.calls, r.deltaTriangles]) }, null, 1));
