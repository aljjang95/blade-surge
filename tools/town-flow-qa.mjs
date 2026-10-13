// 빌드된 게임에서 공개 자원 픽스처와 실제 키보드·DOM 입력으로 마을→원정 흐름을 검증한다.
// 실행: CHROME_PATH 설정 후 node tools/town-flow-qa.mjs (먼저 bun run build).
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { TOWN_SHOP_BY_ID, TOWN_TRAINER_BY_ID } from '../src/data/towns.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'work/qa/town-flow-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  status: 'running', startedAt: new Date().toISOString(),
  scope: '로컬 dist · headless Chrome · 실제 WASD/DOM 입력 · 고정 dt AUTO. 물리 모바일·GPU·발열 검증 아님.',
  viewport: { width: 1280, height: 720 },
  fixture: { disclosed: true, naturalProgression: false, overrides: { glass_leaf: 20, selectedHeroLevel: 3, gold: 20000 },
    pacing: '부트 후 testPause=true; app.step(1/60)으로 진행', randomness: '게임 난수 원본 유지' },
  checks: [], walks: [], choices: [], screenshots: [], errors: [], sources: {},
};
const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, detail });
  console.log((ok ? 'OK   ' : 'FAIL ') + name);
  if (!ok) throw new Error(name + ': ' + JSON.stringify(detail));
}
let server, browser, page;
async function capture(name) {
  const file = name + '.png';
  await page.screenshot({ path: join(out, file) });
  report.screenshots.push(file);
  await save();
}
async function state() {
  return page.evaluate(() => {
    const a = window.app, s = a.eco.s, m = a.hubMovement, e = a.renderer.camera.matrixWorld.elements;
    const persisted = JSON.parse(localStorage.getItem('bladesurge_save_v1') || 'null');
    const wallet = save => save ? { gold: save.gold, materials: save.expedition.materials,
      inventory: save.inventory, towns: save.towns, stats: save.expedition.stats, pending: save.expedition.pending } : null;
    return { ...wallet(s), stored: wallet(persisted), heroId: s.selected, heroLevel: s.heroes[s.selected].level,
      mode: a.mode, walking: a.canWalkHub(), position: { ...m.position }, nearest: m.nearest?.id,
      yaw: Math.atan2(-e[2], e[0]), result: a.expeditionUI.result };
  });
}
async function dismissPopups() {
  let quietSince = Date.now(), count = 0;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.locator('#modal.show').isVisible()) {
      const close = page.locator('#modal.show #m-cancel, #modal.show #m-guide-close').first();
      await close.click();
      count++;
      quietSince = Date.now();
    }
    if (Date.now() - quietSince >= 1600) {
      check('자동 팝업 반복 닫기', !await page.locator('#modal.show').isVisible(), { closed: count });
      return;
    }
    await page.waitForTimeout(100);
  }
  check('자동 팝업 반복 닫기', false, { closed: count, reason: '15초 안에 안정되지 않음' });
}
async function walkTo(target) {
  await page.locator('#gl').focus();
  const before = await state();
  let last = before.position, stalls = 0;
  for (let pulse = 0; pulse < 240; pulse++) {
    const current = await state();
    checkWalking(current);
    const dx = target.x - current.position.x, dz = target.z - current.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .25) {
      report.walks.push({ target, before: before.position, after: current.position, pulses: pulse, input: 'Playwright keyboard WASD; camera yaw 역변환' });
      return;
    }
    const c = Math.cos(current.yaw), s = Math.sin(current.yaw);
    const angle = Math.atan2(dx * s + dz * c, dx * c - dz * s);
    const quantized = Math.round(angle / (Math.PI / 4)) * Math.PI / 4;
    const x = Math.cos(quantized), y = Math.sin(quantized);
    const keys = [x > .3 ? 'KeyD' : x < -.3 ? 'KeyA' : null, y > .3 ? 'KeyS' : y < -.3 ? 'KeyW' : null].filter(Boolean);
    const frames = Math.max(1, Math.min(12, Math.floor(distance / 4.2 * 60 * .7)));
    for (const key of keys) await page.keyboard.down(key);
    try {
      await page.evaluate(frames => { for (let i = 0; i < frames; i++) window.app.step(1 / 60, i === frames - 1); }, frames);
    } finally {
      for (const key of keys) await page.keyboard.up(key);
    }
    const after = await state();
    stalls = Math.hypot(after.position.x - last.x, after.position.z - last.z) < .001 ? stalls + 1 : 0;
    last = after.position;
    if (stalls >= 8) throw new Error('마을 이동 정체: ' + JSON.stringify({ target, position: last }));
  }
  throw new Error('마을 이동 입력 상한 초과: ' + JSON.stringify(target));
}
function checkWalking(current) {
  if (!current.walking) throw new Error('마을 키보드 이동이 잠김: ' + JSON.stringify(current));
}
async function interact(id, view) {
  const before = await state();
  check(id + ' 실제 접근', before.nearest === id, { position: before.position, nearest: before.nearest });
  await page.locator('.citadel-hub-interact').click();
  await page.locator('.town-dialog[open][data-view="' + view + '"]').waitFor();
  await capture(view);
}
async function closeTown() {
  await page.locator('.town-dialog[open] [data-town-act="close"]').click();
  await page.locator('.town-dialog[open]').waitFor({ state: 'hidden' });
}
function paidExactly(before, after, price) {
  return after.gold === before.gold - price.gold && Object.entries(price.materials || {})
    .every(([id, amount]) => after.materials[id] === before.materials[id] - amount);
}

try {
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const file of ['src/game/skills.js', 'src/data/hero-library.js', 'src/engine/assets.js', 'src/game/player.js', 'tools/town-flow-qa.mjs']) {
    report.sources[file] = hash(await readFile(join(root, file)));
  }
  await writeFile(join(out, 'driver.mjs'), await readFile(fileURLToPath(import.meta.url)));
  report.build = JSON.parse(await readFile(join(root, 'dist/version.json'), 'utf8'));
  const index = await readFile(join(root, 'dist/index.html'));
  report.indexSha256 = hash(index);
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
  report.origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  check('dist preview 동일 산출물', hash(Buffer.from(await (await fetch(report.origin)).text())) === report.indexSha256, report.build);
  browser = await chromium.launch(launchOpts({ headless: true }));
  report.browser = { version: browser.version(), executablePath: launchOpts().executablePath || 'Playwright 기본 Chromium' };
  const context = await browser.newContext({ viewport: report.viewport, serviceWorkers: 'block' });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  // 게임과 무관한 외부 폰트 요청은 로컬 빈 CSS로 대체한다.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(report.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
  await dismissPopups();
  report.fixture.before = await state();
  const setup = await page.evaluate(() => {
    const a = window.app, s = a.eco.s;
    a.testPause = true;
    s.expedition.materials.glass_leaf = 20;
    s.heroes[s.selected].level = 3;
    s.gold = 20000;
    const saved = a.eco.save(); a.eco.emit();
    return { saved, heroId: s.selected };
  });
  report.fixture.after = await state();
  check('공개 fixture 저장', setup.saved && report.fixture.after.materials.glass_leaf === 20 && report.fixture.after.heroLevel === 3 && report.fixture.after.gold === 20000, setup);
  await page.locator('#meta [data-tab="home"]').click();
  await page.locator('#citadel-explore').click();
  check('출격 탭→마을 걷기', (await state()).walking, null);
  await capture('walking-start');
  await walkTo({ x: -6.4, z: 4.1 });
  await interact('npc:potion-merchant', 'merchant');
  const offer = TOWN_SHOP_BY_ID.oathhold_blade;
  report.purchase = { offer, before: await state() };
  await page.locator('.town-dialog[open] [data-town-act="buy"][data-offer="' + offer.id + '"]').click();
  report.purchase.after = await state();
  const purchased = report.purchase.after;
  const newItems = purchased.inventory.filter(item => !report.purchase.before.inventory.some(old => old.uid === item.uid));
  check('상점 DOM 구매·골드·재료·인벤토리', paidExactly(report.purchase.before, purchased, offer.price)
    && newItems.length === 1 && newItems[0].id === offer.itemId && purchased.inventory.length === report.purchase.before.inventory.length + 1
    && purchased.towns.purchased.includes(offer.id), { newItems, gold: purchased.gold, glass_leaf: purchased.materials.glass_leaf });
  check('구매 저장', JSON.stringify(purchased.stored) === JSON.stringify({ gold: purchased.gold, materials: purchased.materials, inventory: purchased.inventory, towns: purchased.towns, stats: purchased.stats, pending: purchased.pending }), null);
  await capture('purchased');
  await closeTown();
  await walkTo({ x: -3.8, z: 4.1 });
  await walkTo({ x: -3.8, z: 6.6 });
  await interact('npc:trainer', 'trainer');
  const heroId = purchased.heroId;
  const lesson = Object.values(TOWN_TRAINER_BY_ID).find(item => item.townId === 'oathhold' && item.heroId === heroId);
  report.learning = { lesson, before: await state() };
  await page.locator('.town-dialog[open] [data-town-act="learn"][data-offer="' + lesson.id + '"]').click();
  report.learning.after = await state();
  const learned = report.learning.after;
  check('교관 DOM 습득·learned 변화', !report.learning.before.towns.learned[heroId]?.includes(lesson.id)
    && learned.towns.learned[heroId]?.includes(lesson.id) && learned.towns.learned[heroId].length === (report.learning.before.towns.learned[heroId]?.length || 0) + 1
    && paidExactly(report.learning.before, learned, lesson.price) && JSON.stringify(learned.inventory) === JSON.stringify(report.learning.before.inventory), learned.towns.learned);
  check('기술 저장', JSON.stringify(learned.stored.towns.learned) === JSON.stringify(learned.towns.learned) && learned.stored.gold === learned.gold
    && JSON.stringify(learned.stored.materials) === JSON.stringify(learned.materials), null);
  await capture('learned');
  await closeTown();
  await walkTo({ x: 0, z: 6.6 });
  await walkTo({ x: 3.3, z: 7.1 });
  await interact('waystone:main', 'map');
  check('이동석 지도 3개 마을', await page.locator('.town-dialog[open] .town-map > li').count() === 3, null);
  await closeTown();
  await page.locator('#citadel-command-return').click();
  await page.locator('[data-command-route="glass_garden"]').click();
  await page.locator('.citadel-hub-dialog[open]').waitFor();
  report.expedition = { before: await state(), chunks: [] };
  await page.locator('.citadel-hub-go').click();
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  const admission = await page.evaluate(() => ({ route: window.app.battle.stage.expedition, auto: window.app.battle.player.auto }));
  check('유리 정원 실제 출격', admission.route.id === 'glass_garden' && admission.route.kind === 'dungeon' && admission.route.depth === 'standard', admission);
  if (!admission.auto) await page.locator('#btn-auto').click();
  for (let chunk = 0; chunk < 180; chunk++) {
    const current = await page.evaluate(() => {
      const a = window.app, b = a.battle;
      for (let frame = 0; frame < 600 && b.active && !b.paused; frame++) a.step(1 / 60, frame % 90 === 0);
      return { active: b.active, paused: b.paused, hp: b.player.hp, auto: b.player.auto, elapsed: b.elapsed, kills: b.kills, win: b.result?.win };
    });
    report.expedition.chunks.push(current);
    if (!current.auto) throw new Error('AUTO가 꺼짐');
    if (current.paused && current.active) {
      const choice = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').first();
      await choice.waitFor(); report.choices.push({ text: await choice.innerText(), elapsed: current.elapsed });
      await choice.click();
    }
    if (!current.active) break;
    if (chunk % 12 === 0) { console.log('AUTO', JSON.stringify(current)); await save(); }
  }
  check('AUTO 고정 dt 승리', report.expedition.chunks.at(-1)?.win === true, report.expedition.chunks.at(-1));
  // 승리 뒤 1.6초의 연출 예약도 게임 시계로 진행해야 정산 UI가 열린다.
  await page.evaluate(() => {
    for (let frame = 0; frame < 240 && !window.app.expeditionUI.result; frame++) window.app.step(1 / 60, frame % 60 === 0);
  });
  await page.locator('.exp-result-shell[data-outcome="victory"]').waitFor();
  report.expedition.after = await state();
  const after = report.expedition.after;
  report.expedition.receipt = await page.evaluate(() => window.app.battle.result.expeditionReceipt);
  check('원정 정산·stats.glass_garden +1', after.result?.win && !after.result.saveError && report.expedition.receipt?.ok
    && after.pending === null && after.stats.glass_garden === report.expedition.before.stats.glass_garden + 1
    && after.stored.stats.glass_garden === after.stats.glass_garden && after.stored.pending === null, { stats: after.stats, receipt: report.expedition.receipt });
  await capture('glass-garden-victory');
  check('콘솔 오류 0', report.errors.length === 0, report.errors);
  check('QA 도중 동일 빌드 유지', hash(await readFile(join(root, 'dist/index.html'))) === report.indexSha256, null);
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = error.stack || String(error); process.exitCode = 1;
  console.error(report.failure);
  if (page && !page.isClosed()) await capture('failure').catch(() => {});
} finally {
  await browser?.close().catch(error => { report.errors.push(error.message); report.status = 'fail'; process.exitCode = 1; });
  if (server) await new Promise(resolveClose => server.httpServer.close(resolveClose));
  report.endedAt = new Date().toISOString();
  await save();
  console.log('QA report:', join(out, 'report.json'));
}
