// 두 번째(잿불 항구)·세 번째(별마루 설원) 마을 진행을 실제 키보드·DOM 입력으로 검증하고, 출격 준비창 글자 대비를 측정한다.
// 실행: CHROME_PATH 설정 후 node tools/town-progression-qa.mjs (먼저 bun run build).
// QA_TOWN=starcrest 로 세 번째 마을을 검사한다(기본 emberport). QA_LOW_EXP=1 이면 탐험 레벨을 올리지 않아 입장 차단 사유 표시를 확인하고 출격 전에 끝낸다. QA_VP=844x390 처럼 화면 크기를 바꿀 수 있다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { TOWNS, TOWN_SHOP_BY_ID, TOWN_TRAINER_BY_ID } from '../src/data/towns.js';
import { townHub } from '../src/data/citadel-hub.js';

const TOWN_ID = process.env.QA_TOWN || 'emberport';
const TOWN_INDEX = TOWNS.findIndex(town => town.id === TOWN_ID);
if (TOWN_INDEX < 0) throw new Error('알 수 없는 QA_TOWN: ' + TOWN_ID);
// QA_GATE로 마을 안의 다른 던전을 고를 수 있다. 첫 마을(oathhold)은 이동석·상점 순회 없이 바로 게이트로 간다.
const TOWN = TOWNS[TOWN_INDEX], LABEL = TOWN.name, GATE = process.env.QA_GATE || TOWN.dungeonIds[0];
if (!TOWN.dungeonIds.includes(GATE)) throw new Error(TOWN_ID + '에 없는 QA_GATE: ' + GATE);
const GATE_SPOT = townHub(TOWN_ID).hotspots.find(spot => spot.id === 'dungeon:' + GATE);
const SIDE = Math.sign(GATE_SPOT.x) || 1;
// 대상 마을까지 열리도록 앞선 마을마다 다음 마을이 요구하는 수만큼 던전을 클리어 상태로 둔다.
const PRIOR_CLEARS = TOWNS.slice(0, TOWN_INDEX).flatMap((town, index) => town.dungeonIds.slice(0, TOWNS[index + 1].requiredClears));

const LOW_EXP = !!process.env.QA_LOW_EXP;
const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'work/qa/town-progression-' + TOWN_ID + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  status: 'running', startedAt: new Date().toISOString(),
  scope: '로컬 dist · headless Chrome · 실제 WASD/DOM 입력 · 고정 dt AUTO. 물리 모바일·GPU·발열 검증 아님.',
  viewport: process.env.QA_VP ? { width: +process.env.QA_VP.split('x')[0], height: +process.env.QA_VP.split('x')[1] } : { width: 1280, height: 720 },
  fixture: { disclosed: true, naturalProgression: false, overrides: { selectedHeroLevel: 16, expeditionLevel: '12 (QA_LOW_EXP 제외)', town: TOWN_ID, priorClears: PRIOR_CLEARS, materials: 60, gold: 200000 },
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
  for (const file of ['src/game/skills.js', 'src/data/hero-library.js', 'src/engine/assets.js', 'src/game/player.js', 'src/ui/storybook.css', 'src/ui/citadel-hub.js', 'tools/town-progression-qa.mjs']) {
    report.sources[file] = hash(await readFile(join(root, file)));
  }
  await writeFile(join(out, 'driver.mjs'), await readFile(fileURLToPath(import.meta.url)));
  report.build = JSON.parse(await readFile(join(root, 'dist/version.json'), 'utf8'));
  // 오래된 dist 로 통과하지 않도록 빌드 SHA 가 현재 HEAD 와 같은지 먼저 확인한다(작업 중 dirty 빌드는 기록만 남긴다).
  check('dist 빌드 SHA = HEAD', report.build.sha === report.head, { build: report.build.sha, head: report.head, dirty: report.build.dirty });
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
  const setup = await page.evaluate(({ LOW_EXP, clears }) => {
    const a = window.app, s = a.eco.s;
    a.testPause = true;
    s.heroes[s.selected].level = 16;
    if (!LOW_EXP) s.expedition.level = Math.max(s.expedition.level || 1, 12);
    for (const id of clears) s.expedition.stats[id] = Math.max(1, s.expedition.stats[id] || 0);
    Object.assign(s.expedition.materials, { glass_leaf: 60, ember_core: 60, star_dust: 60 });
    s.gold = 200000;
    const saved = a.eco.save(); a.eco.emit();
    return { saved, heroId: s.selected };
  }, { LOW_EXP, clears: PRIOR_CLEARS });
  check('fixture 저장', setup.saved, setup);
  await page.locator('#meta [data-tab="home"]').click();
  await page.locator('#citadel-explore').click();
  check('출격 탭→마을 걷기', (await state()).walking, null);
  if (TOWN_INDEX > 0) {
  await walkTo({ x: 0, z: 6.6 });
  await walkTo({ x: 3.3, z: 7.1 });
  await interact('waystone:main', 'map');
  const card = await page.evaluate(() => [...document.querySelectorAll('.town-dialog[open] .town-map > li')].map(li => ({ id: li.dataset.town, state: li.dataset.state, go: !li.querySelector('.town-go')?.disabled })));
  check(LABEL + ' 해금 카드', card.find(c => c.id === TOWN_ID)?.state === 'open' && card.find(c => c.id === TOWN_ID).go, card);
  await page.locator('.town-dialog[open] [data-town-act="travel"][data-town="' + TOWN_ID + '"]').click();
  await page.locator('.town-dialog[open]').waitFor({ state: 'hidden' });
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.app.step(1 / 60, i % 30 === 0); });
  const arrived = await page.evaluate(() => ({ ui: window.app.townUI.activeId, scene: window.app.arena.lobbyHall?.userData?.townId, saved: JSON.parse(localStorage.getItem('bladesurge_save_v1')).towns.currentTownId,
    hotspots: window.app.hubMovement.hotspots.map(h => h.id), pos: { ...window.app.hubMovement.position }, walking: window.app.canWalkHub(), place: document.querySelector('.town-place-name, .town-place h2, .town-place strong')?.textContent }));
  report.arrived = arrived;
  check(LABEL + ' 도착·장면·저장', arrived.ui === TOWN_ID && arrived.scene === TOWN_ID && arrived.saved === TOWN_ID && arrived.hotspots.includes('dungeon:' + GATE) && arrived.walking, arrived);
  await capture(TOWN_ID + '-arrived');
  await walkTo({ x: -6.4, z: 4.1 });
  await interact('npc:potion-merchant', 'merchant');
  const offers = await page.evaluate(() => [...document.querySelectorAll('.town-dialog[open] [data-town-act="buy"]')].map(b => ({ id: b.dataset.offer, disabled: b.disabled })));
  report.emberOffers = offers;
    check(LABEL + ' 상인 상품 노출', offers.length > 0 && offers.every(o => o.id.startsWith(TOWN_ID)), offers);
  const buyId = offers.find(o => !o.disabled)?.id;
  const before = await state();
  await page.locator('.town-dialog[open] [data-town-act="buy"][data-offer="' + buyId + '"]').click();
  const after = await state();
  check(LABEL + ' 상인 구매', after.towns.purchased.includes(buyId) && after.gold < before.gold, { buyId, gold: [before.gold, after.gold] });
  await capture(TOWN_ID + '-merchant');
  await closeTown();
  await walkTo({ x: -3.8, z: 4.1 });
  await walkTo({ x: -3.8, z: 6.6 });
  await interact('npc:trainer', 'trainer');
  const lessons = await page.evaluate(() => [...document.querySelectorAll('.town-dialog[open] [data-town-act="learn"]')].map(b => ({ id: b.dataset.offer, disabled: b.disabled })));
  report.emberLessons = lessons;
  check(LABEL + ' 교관 기술 노출', lessons.length > 0 && lessons.every(l => l.id.startsWith(TOWN_ID)), lessons);
  const learnId = lessons.find(l => !l.disabled)?.id;
  if (learnId) {
    const lb = await state();
    await page.locator('.town-dialog[open] [data-town-act="learn"][data-offer="' + learnId + '"]').click();
    const la = await state();
    check(LABEL + ' 교관 습득', la.towns.learned[la.heroId]?.includes(learnId), { learnId, learned: la.towns.learned });
  }
  await capture(TOWN_ID + '-trainer');
  await closeTown();
  }
  await walkTo({ x: 0, z: 3 });
  if (GATE_SPOT.z < -8) {
    // 첫 마을 게이트는 북쪽 한 줄에 서 있다. x=±6의 벤치·화단을 피해 옆 통로로 올라간 뒤 정면에서 다가간다.
    const lane = Math.abs(GATE_SPOT.x) >= 5 && Math.abs(GATE_SPOT.x) <= 7 ? GATE_SPOT.x - Math.sign(GATE_SPOT.x) * 2 : GATE_SPOT.x;
    await walkTo({ x: lane, z: 0 });
    await walkTo({ x: lane, z: -8 });
    await walkTo({ x: GATE_SPOT.x, z: GATE_SPOT.z + 1.4 });
  } else {
    await walkTo({ x: SIDE * 8.5, z: 3 });
    await walkTo({ x: SIDE * 8.5, z: GATE_SPOT.z });
    await walkTo({ x: GATE_SPOT.x - SIDE * 1.4, z: GATE_SPOT.z });
  }
  const near = await state();
  report.gateNear = near.nearest;
  check(LABEL + ' 게이트 접근', near.nearest === 'dungeon:' + GATE, { nearest: near.nearest, position: near.position });
  await page.locator('.citadel-hub-interact').click();
  await page.locator('.citadel-hub-dialog[open]').waitFor();
  await capture(TOWN_ID + '-gate');
  report.contrast = await page.evaluate(() => {
    const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
    const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
    const bgCandidates = el => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n); let options = null;
        if (s.backgroundImage !== 'none') {
          const first = s.backgroundImage.split(/\),\s*(?=(?:linear|radial|url|repeating))/)[0];
          if (/url\(/.test(first)) return null;
          const stops = [...first.matchAll(/rgba?\([^)]+\)/g)].map(x => parse(x[0])).filter(x => x && x.a > 0);
          if (stops.length) options = stops;
        }
        const bc = parse(s.backgroundColor);
        if (!options && bc && bc.a > 0) options = [bc];
        if (options) { layers.push(options); if (options.every(o => o.a >= .99)) break; }
      }
      let bases = [{ r: 255, g: 255, b: 255, a: 1 }];
      for (let i = layers.length - 1; i >= 0; i--) { const next = []; for (const base of bases) for (const o of layers[i]) next.push(over(o, base)); bases = next.slice(0, 64); }
      return bases;
    };
    const out = [];
    for (const el of document.querySelectorAll('.citadel-hub-dialog[open] *')) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!own || el.offsetParent === null) continue;
      const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity === 0) continue;
      const fg = parse(s.color), bases = bgCandidates(el);
      if (!bases) { out.push({ text: own.slice(0, 30), ratio: null, note: 'image background' }); continue; }
      const ratios = bases.map(bg => { const x = lum(fg), y = lum(bg); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); });
      const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, need = size >= 18 || (bold && size >= 14) ? 3 : 4.5;
      const avg = ratios.reduce((p, q) => p + q, 0) / ratios.length;
      out.push({ text: own.slice(0, 30), size: s.fontSize, fg: s.color, worst: +Math.min(...ratios).toFixed(2), avg: +avg.toFixed(2), need, ratio: +avg.toFixed(2) });
    }
    return out;
  });
  const lowRows = report.contrast.filter(r => r.ratio !== null && r.avg < r.need);
  for (const row of lowRows) console.log('LOW', JSON.stringify(row));
  if (LOW_EXP) { report.blockedLine = await page.evaluate(() => { const el = document.querySelector('.citadel-hub-dialog[open] .citadel-hub-access'); const s = getComputedStyle(el); return { text: el.textContent, blocked: el.dataset.blocked, color: s.color, weight: s.fontWeight, go: document.querySelector('.citadel-hub-go').disabled }; }); console.log('BLOCKED', JSON.stringify(report.blockedLine)); report.layout = await page.evaluate(() => { const q = s => { const e = document.querySelector('.citadel-hub-dialog[open] ' + s); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), sh: e.scrollHeight, ch: e.clientHeight }; }; return { shell: q('.citadel-hub-destination-shell'), scroll: q('.citadel-hub-destination-scroll'), heading: q('.citadel-hub-destination-heading'), body: q('.citadel-hub-destination-body'), footer: q('.citadel-hub-destination-footer'), cancel: q('.citadel-hub-cancel'), go: q('.citadel-hub-go') }; }); console.log('LAYOUT', JSON.stringify(report.layout)); }
  check('출격 준비창 글자 대비(평균 기준)', lowRows.length === 0, lowRows);
  console.log('CONTRAST total', report.contrast.length, 'below-need(avg)', lowRows.length, 'worst-below', report.contrast.filter(r => r.ratio !== null && r.worst < r.need).length, 'image-bg', report.contrast.filter(r => r.ratio === null).length);
  if (LOW_EXP) { check('차단 사유 강조', report.blockedLine.blocked === 'true' && report.blockedLine.go && /탐험 레벨/.test(report.blockedLine.text), report.blockedLine); report.status = 'pass'; throw Object.assign(new Error('done'), { done: true }); }
  report.expedition = { before: await state(), chunks: [] };
  report.objectiveTitles = [];
  await page.locator('.citadel-hub-go').click();
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  const admission = await page.evaluate(() => ({ route: window.app.battle.stage.expedition, auto: window.app.battle.player.auto }));
  check(LABEL + ' 첫 던전 실제 출격', admission.route.id === GATE, admission);
  await capture(TOWN_ID + '-battle');
  if (!admission.auto) await page.locator('#btn-auto').click();
  for (let chunk = 0; chunk < 240; chunk++) {
    const current = await page.evaluate(wantHold => {
      const a = window.app, b = a.battle;
      let holding = false;
      for (let frame = 0; frame < 600 && b.active && !b.paused; frame++) {
        a.step(1 / 60, frame % 90 === 0);
        // 순차 목표 위에서 유지 중인 장면을 한 번 남긴다(렌더 프레임 포함).
        if (wantHold && (b.routeObjectives?.hold || 0) > .8) { a.step(1 / 60, true); holding = true; break; }
      }
      return { active: b.active, paused: b.paused, hp: b.player.hp, auto: b.player.auto, elapsed: b.elapsed, kills: b.kills, win: b.result?.win, holding };
    }, !report.holdShot);
    if (current.holding) { report.holdShot = true; await capture(TOWN_ID + '-objective-hold'); }
    report.expedition.chunks.push(current);
    const goal = await page.evaluate(() => document.querySelector('.battle-objective-title')?.textContent?.trim() || '');
    if (goal && report.objectiveTitles.at(-1) !== goal) report.objectiveTitles.push(goal);
    if (current.paused && current.active) {
      const choice = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').first();
      await choice.waitFor(); report.choices.push({ text: await choice.innerText(), elapsed: current.elapsed });
      await choice.click();
    }
    if (!current.active) break;
    if (chunk % 12 === 0) { console.log('AUTO', JSON.stringify(current)); await save(); }
  }
  const last = report.expedition.chunks.at(-1);
  check(LABEL + ' 던전 AUTO 결과', last && !last.active, last);
  report.expedition.win = last.win;
  await page.evaluate(() => { for (let frame = 0; frame < 240 && !window.app.expeditionUI.result; frame++) window.app.step(1 / 60, frame % 60 === 0); });
  await page.locator('.exp-result-shell').waitFor();
  const res = await state();
  report.expedition.after = { stats: res.stats, pending: res.pending, win: res.result?.win, saveError: res.result?.saveError };
  await capture(TOWN_ID + '-result');
  check(LABEL + ' 던전 정산', !res.result?.saveError && res.pending === null, report.expedition.after);
  report.routeObjective = await page.evaluate(() => window.app.battle.result?.routeObjective || null);
  if (GATE === 'eclipse_hydra_vault') {
    console.log('OBJECTIVES', JSON.stringify(report.objectiveTitles), JSON.stringify(report.routeObjective));
    check('역류 밸브 3/3 잠금 기록', report.routeObjective?.id === 'eclipse_backflow_valves' && report.routeObjective.complete && JSON.stringify(report.routeObjective.rooms) === '[2,5,7]', report.routeObjective);
    check('결과 화면 역류 밸브 기록', (await page.locator('[aria-label="역류 밸브 잠금 결과"]').textContent())?.includes('3/3'), null);
    check('전투 목표창에 역류 밸브 진행 표시', report.objectiveTitles.some(t => t.startsWith('역류 밸브 잠금')), report.objectiveTitles);
  }
  check('콘솔 오류 0', report.errors.length === 0, report.errors);
  report.status = 'pass';
} catch (error) {
  if (error.done) { console.log('LOW_EXP 종료'); } else {
  report.status = 'fail'; report.failure = error.stack || String(error); process.exitCode = 1;
  console.error(report.failure);
  if (page && !page.isClosed()) await capture('failure').catch(() => {});
  }
} finally {
  await browser?.close().catch(error => { report.errors.push(error.message); report.status = 'fail'; process.exitCode = 1; });
  if (server) await new Promise(resolveClose => server.httpServer.close(resolveClose));
  report.endedAt = new Date().toISOString();
  await save();
  console.log('QA report:', join(out, 'report.json'));
}












