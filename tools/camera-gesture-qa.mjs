// 로컬 Chromium CDP 터치로 실제 사용자 흐름의 빈 화면 회전·핀치·조이스틱 동시 입력과 전체화면 결과를 확인한다.
// 흐름: 부팅 시작 버튼 → 자연 모달(출석 등) 닫기 → 로비 빈 화면 회전 → 실제 던전 진입 버튼 → 출격 준비창 → 원정 시작
//       → 전투 HUD 제스처 · 이동 방향 · 정리 경계 → (선택) 전체화면 거절/미지원 안내.
// CDP Input.dispatchTouchEvent는 브라우저 입력 파이프라인을 거치는 자동화 터치다. 실기기 터치·GPU·발열·OS 막대 숨김 증거가 아니다.
// 실행: 빌드한 dist를 loopback preview로 띄운 뒤
//   node tools/camera-gesture-qa.mjs --url=http://127.0.0.1:5231/ --label=<이름> [--expected-sha=<40hex>]
//   선택: --groups=lobby,battle,fullscreen(일부만이면 최대 partial) --deadline-sec=<초>(넘은 단계는 NOT_RUN)
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';

const arg = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
const target = new URL(arg('url') || 'http://127.0.0.1:5231/');
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.username || target.password) throw Error('localhost only');
const label = arg('label') || new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[\w-]+$/.test(label)) throw Error('Invalid --label');
const expectedSha = arg('expected-sha');
// 정해진 시간 안의 기능 스모크: 넘으면 남은 단계를 실행하지 않고 NOT_RUN으로 남긴다(PASS로 세지 않는다).
const deadlineSec = Number(arg('deadline-sec') || 0);
// 묶음 선택(기본 전체). 일부만 고르면 결과는 최대 partial이다.
const ALL_GROUPS = ['lobby', 'battle', 'fullscreen'];
const groups = new Set((arg('groups') || ALL_GROUPS.join(',')).split(',').filter(g => ALL_GROUPS.includes(g)));
const startedAt = Date.now();
const dir = 'work/qa/camera-gesture/' + label;
await mkdir('work/qa/camera-gesture', { recursive: true });
await mkdir(dir); // 같은 label의 이전 결과를 덮어쓰지 않는다.
const report = { label, started: new Date().toISOString(), target: target.href,
  scope: 'Local headless Chromium (SwiftShader) with CDP touch emulation, 844x390 landscape, deviceScaleFactor 1. Real boot/modal/dungeon card/preparation/start buttons. Not a physical device, GPU, heat, feel or OS system bar result.',
  steps: [], screenshots: [], errors: [], status: 'running' };
const save = () => writeFile(dir + '/report.json', JSON.stringify(report, null, 2));
const assert = (ok, message) => { if (!ok) throw Error(message); };
let cleanup = null, diagnose = null;
const step = async (name, fn, { required = true, needs = null } = {}) => {
  const row = { name, required, status: 'running' }; report.steps.push(row); await save();
  if (deadlineSec > 0 && Date.now() - startedAt > deadlineSec * 1000) {
    row.status = 'NOT_RUN'; row.reason = 'deadline ' + deadlineSec + 's reached before this step'; await save(); return row;
  }
  // 손가락을 이어 받는 단계는 선행 단계가 통과했을 때만 의미가 있다. 연쇄 FAIL 대신 사유를 남긴다.
  if (needs && needs.status !== 'PASS') {
    row.status = 'NOT_RUN'; row.reason = 'prerequisite "' + needs.name + '" was ' + needs.status; await save(); return row;
  }
  const t0 = Date.now();
  try { const detail = await fn(); row.status = detail?.notRun ? 'NOT_RUN' : 'PASS'; if (detail) row.detail = detail; }
  catch (error) { row.status = 'FAIL'; row.error = String(error?.message || error); try { row.state = await diagnose?.(); } catch {} }
  // 실패한 단계의 손가락·일시정지가 다음 단계를 오염시키지 않게 실제 입력으로 정리한다.
  // 통과한 단계는 다음 단계로 의도적으로 넘기는 손가락(조이스틱+회전→핀치)을 유지한다.
  if (row.status !== 'PASS') try { await cleanup?.(); } catch (error) { row.cleanupError = String(error?.message || error); }
  // 다음 단계가 어떤 상태에서 시작했는지 남긴다(정리 뒤 상태).
  try { const after = await diagnose?.(); if (after) row.after = after; } catch {}
  row.ms = Date.now() - t0;
  await save(); return row;
};
/** pointermove는 애니메이션 프레임에 맞춰 전달되므로 값을 읽기 전에 두 프레임을 기다린다. */
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
/** 시작·끝·취소는 즉시 전달되고 남은 move를 먼저 비운다. 처리 확인용으로 한 프레임만 기다린다. */
const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

try { report.head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { report.head = null; }
try { report.servedVersion = await (await fetch(new URL('version.json', target), { cache: 'no-store' })).json(); } catch (error) { report.servedVersion = { error: String(error) }; }
if (expectedSha) report.shaMatch = report.servedVersion?.sha === expectedSha && report.servedVersion?.dirty === false;

const browser = await chromium.launch(launchOpts({ headless: true }));
report.browser = browser.version();
const contextOptions = { ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

/** 페이지 하나에 CDP 터치 도구를 붙인다. */
async function openPage(context) {
  const page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', e => report.errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  const touches = new Map();
  const points = () => [...touches.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 }));
  const touch = {
    get size() { return touches.size; },
    down: async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() }); await frame(page); },
    move: async (id, x, y, steps = 6) => {
      const from = touches.get(id);
      for (let i = 1; i <= steps; i++) { touches.set(id, { x: from.x + (x - from.x) * i / steps, y: from.y + (y - from.y) * i / steps }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() }); }
      await frames(page);
    },
    // CDP touchEnd의 touchPoints는 "떼는 손가락"이다. 남은 손가락을 보내면 그 손가락들이 떨어진다(root PC 보정 실험).
    up: async id => {
      const ended = touches.get(id);
      if (!ended) return;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: ended.x, y: ended.y, radiusX: 4, radiusY: 4, force: 1 }] });
      touches.delete(id); await frame(page);
    },
    cancel: async () => { touches.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await frame(page); },
    clear: () => touches.clear(),
  };
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(dir + '/' + name + '.png', Buffer.from(r.data, 'base64')); report.screenshots.push(name + '.png');
  };
  return { page, touch, shot };
}

/**
 * 빈 world 표면(캔버스 또는 로비 tab-home)인 점을 화면 격자에서 찾는다.
 * 브라우저 터치 보정은 손가락 근처의 버튼으로 대상을 옮기므로(실제 손가락과 같다) 주변 반경도 모두 world인 점만 쓴다.
 */
/** 로비 UI는 메인 루프의 syncHub가 다음 프레임에 다시 표시한다. 점을 고르기 전에 프레임이 진행되게 한다. */
const settle = async page => { await frames(page); await frames(page); };
const emptyPoint = async (page, region) => { await settle(page); return page.evaluate(({ x0, x1, y0, y1, clear }) => {
  // hit test와 함께 보이는 상호작용 요소의 사각형에서도 떨어진 점만 쓴다(표시 직전 패널·터치 보정 대비).
  // world 표면 자체(#gl 캔버스는 tabIndex=0, #tab-home)는 상호작용 요소에서 뺀다.
  const rects = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.id !== 'gl' && el.id !== 'tab-home').map(el => el.getBoundingClientRect()).filter(r => r.width > 2 && r.height > 2);
  const nearUi = (px, py) => rects.some(r => px > r.left - clear && px < r.right + clear && py > r.top - clear && py < r.bottom + clear);
  const world = (px, py) => { const el = document.elementFromPoint(px, py); return !!el && (el.id === 'gl' || el.id === 'tab-home'); };
  for (let y = y0; y <= y1; y += .04) for (let x = x0; x <= x1; x += .04) {
    const px = Math.round(innerWidth * x), py = Math.round(innerHeight * y);
    let ok = world(px, py) && !nearUi(px, py);
    for (let a = 0; ok && a < 8; a++) ok = world(px + Math.round(Math.cos(a * Math.PI / 4) * clear), py + Math.round(Math.sin(a * Math.PI / 4) * clear));
    if (ok) return { x: px, y: py, clear };
  }
  return null;
}, { clear: 28, ...region }); };
/** 실제 pointerdown이 어느 요소로 갔는지 기록한다(실패 원인 구분용 관측). */
const watchDown = page => page.evaluate(() => { window.__qaDown = []; if (window.__qaDownOn) return; window.__qaDownOn = true;
  document.addEventListener('pointerdown', e => window.__qaDown.push({ target: e.target?.id || e.target?.tagName, type: e.pointerType, dp: e.defaultPrevented }), true); });
const downs = page => page.evaluate(() => window.__qaDown || []);
const padState = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); if (!el) return 'missing'; const r = el.getBoundingClientRect(); return r.width <= 1 && r.height <= 1 ? 'hidden' : 'visible:' + Math.round(r.width) + 'x' + Math.round(r.height); }, selector);

/** 부팅 버튼과 자연 모달은 실제 버튼으로만 처리한다. */
async function boot(page, { tapStart = true } = {}) {
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const portrait = page.locator('#btn-ignore-rotate');
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  const bootLabel = await page.locator('#boot-start').innerText();
  if (!tapStart) return { bootLabel };
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 150000 });
  if (await portrait.isVisible()) await portrait.tap();
  await page.waitForTimeout(800);
  const closed = [];
  for (let n = 0; n < 5; n++) {
    const close = page.locator('#modal.show #m-cancel');
    if (!await close.isVisible()) break;
    closed.push((await page.locator('#modal.show').innerText()).split('\n')[0].slice(0, 40));
    await close.tap(); await page.waitForTimeout(600);
  }
  return { bootLabel, closedModals: closed, fullscreenAfterBoot: await page.evaluate(() => !!document.fullscreenElement) };
}

/** 로비의 실제 던전 진입 버튼 → 출격 준비창 → 원정 시작. 숨은 디버그 버튼은 누르지 않는다. */
async function enterDungeon(page) {
  const before = await page.evaluate(() => ({ energy: window.app.eco.s.energy, mode: window.app.mode }));
  // 새 던전 중심 로비의 단일 추천 CTA가 있으면 그것을, 없으면 기존 던전 카드(유리 정원)를 쓴다.
  const candidates = ['#citadel-dungeon-prepare:visible', '[data-dungeon-cta]:visible', '[data-command-route="glass_garden"]:visible'];
  let used = null;
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count() && await el.isVisible()) { await el.scrollIntoViewIfNeeded(); await el.tap(); used = selector; break; }
  }
  assert(used, 'No visible dungeon entry control');
  const dialog = page.locator('.citadel-hub-dialog[open]');
  await dialog.waitFor({ timeout: 60000 });
  const go = dialog.locator('.citadel-hub-go');
  const prep = { title: await dialog.locator('#citadel-destination-title').innerText(), go: await go.innerText(), disabled: await go.isDisabled(),
    energyAfterOpen: await page.evaluate(() => window.app.eco.s.energy) };
  assert(!prep.disabled, 'Preparation start disabled: ' + prep.go);
  assert(prep.energyAfterOpen === before.energy, 'Opening preparation consumed energy');
  await go.tap();
  await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting && !window.app.battle.paused, null, { timeout: 150000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ energy: window.app.eco.s.energy, mode: window.app.mode, auto: !!window.app.battle?.player?.auto }));
  return { used, before, prep, after, spent: before.energy - after.energy };
}

const cam = page => page.evaluate(() => {
  const app = window.app, e = app.renderer.camera.matrixWorld.elements;
  return { ...app.renderer.battleCamera, joy: !!app.input.joy.active, touches: app.cameraControls.touch.size, mode: app.cameraControls.touch.mode,
    forward: { x: -e[8], z: -e[10] }, player: app.battle?.player ? { x: app.battle.player.pos.x, z: app.battle.player.pos.z } : null, clock: app.renderer.time };
});
const angle = (a, b) => { const d = Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z) || 1)))); return d * 180 / Math.PI; };

/** 조이스틱 위쪽을 실제 시간 동안 누르고 이동 방향과 카메라 전방(지면 투영)의 각도를 잰다. */
async function joystickForward(page, touch, joyBox) {
  const cx = joyBox.x + joyBox.width * .3, cy = joyBox.y + joyBox.height * .6;
  const start = await cam(page);
  await touch.down(11, cx, cy); await touch.move(11, cx, cy - 45, 3);
  await page.waitForFunction(clock => window.app.renderer.time - clock >= .5, start.clock, { timeout: 90000 });
  const end = await cam(page);
  await touch.up(11);
  const moved = { x: end.player.x - start.player.x, z: end.player.z - start.player.z };
  return { distance: Math.hypot(moved.x, moved.z), angleToCameraForward: angle(moved, start.forward), yaw: start.yaw };
}

try {
  const context = await browser.newContext(contextOptions);
  const { page, touch, shot } = await openPage(context);
  let entered = false;
  const booted = await step('boot via start button and close natural modals', async () => { const r = await boot(page); report.boot = r; return r; });
  if (booted.status !== 'PASS') throw Error('Boot failed; later steps not run');
  await step('lobby old camera pad hidden', async () => { const s = await padState(page, '#lobby-camera-pad'); assert(s === 'hidden' || s === 'missing', s); return { pad: s }; });
  await shot('lobby');
  diagnose = () => page.evaluate(() => { const app = window.app;
    return { mode: app.mode, tab: app.meta?.tab, walking: !!app.canWalkHub?.(), orbit: !!app.lobbyCameraControls?.active, camera: { ...app.renderer.lobbyCamera },
      gesture: { size: app.lobbyCameraControls?.touch.size, mode: app.lobbyCameraControls?.touch.mode }, modal: !!document.querySelector('dialog[open], #modal.show') }; });
  // 실제로 보이는 복귀 컨트롤로 착지에 돌아온다. 원정 머리글 '로비'가 보이면 그것, 짧은 가로처럼 머리글을 숨긴 화면에서는
  // 항상 보이는 하단 '던전' 목적지(mobile-menu.css의 복귀 경로). 숨은 요소를 강제로 누르지 않는다.
  const returnToLanding = async () => {
    if (!await page.evaluate(() => !!document.querySelector('#expedition-root .exp-shell'))) return 'already-landing';
    const control = page.locator('#expedition-root .exp-close:visible, #meta .bottomnav [data-tab="home"]:visible').first();
    const used = await control.evaluate(el => el.matches('.exp-close') ? 'exp-close' : 'bottomnav-home');
    await control.tap();
    await page.waitForFunction(() => !document.querySelector('#expedition-root .exp-shell') && window.app.commandUI?.visible && window.app.meta.tab === 'home', null, { timeout: 60000 });
    return used;
  };
  // 실패한 로비 단계가 원정 화면을 연 채로 두면 전투 진입이 연쇄로 실패한다. 정리에서 착지로 복원한다.
  const BASE_VIEWPORT = { width: 844, height: 390 };
  const restoreViewport = async () => { const v = page.viewportSize(); if (v && (v.width !== BASE_VIEWPORT.width || v.height !== BASE_VIEWPORT.height)) { await page.setViewportSize(BASE_VIEWPORT); await page.waitForTimeout(500); await settle(page); } };
  cleanup = async () => { if (touch.size) await touch.cancel(); await returnToLanding().catch(() => {}); await restoreViewport().catch(() => {}); };
  // 기본 선택 로비(마을 걷기 아님)에서 빈 화면 한 손가락 회전과 탭 무회전을 검사한다. 걷기 모드는 필수 경로가 아니다.
  const lobbyRotate = async () => {
    const point = await emptyPoint(page, { x0: .4, x1: .95, y0: .15, y1: .6 });
    if (!point) return { notRun: true, reason: 'no empty lobby world point visible' };
    const before = await page.evaluate(() => ({ ...window.app.renderer.lobbyCamera }));
    await watchDown(page);
    await touch.down(1, point.x, point.y); await touch.move(1, point.x + 80, point.y); await touch.up(1);
    await frames(page);
    const after = await page.evaluate(() => ({ ...window.app.renderer.lobbyCamera }));
    const saved = await page.evaluate(() => ({ ...(window.app.eco.s.settings.lobbyCamera || {}) }));
    const down = await downs(page);
    assert(before.yaw !== after.yaw, 'Lobby world drag did not rotate: ' + JSON.stringify({ point, down }));
    return { point, down, before, after, saved, walking: await page.evaluate(() => !!window.app.canWalkHub?.()) };
  };
  const lobbyTap = async () => {
    const point = await emptyPoint(page, { x0: .4, x1: .95, y0: .15, y1: .6 });
    if (!point) return { notRun: true, reason: 'no empty lobby world point visible' };
    const tapBefore = await page.evaluate(() => ({ ...window.app.renderer.lobbyCamera }));
    await watchDown(page);
    await touch.down(1, point.x, point.y); await touch.move(1, point.x + 4, point.y + 2, 2); await touch.up(1);
    const tapAfter = await page.evaluate(() => ({ ...window.app.renderer.lobbyCamera }));
    const down = await downs(page);
    assert(tapBefore.yaw === tapAfter.yaw && tapBefore.pitch === tapAfter.pitch, 'Sub-slop tap rotated lobby');
    // 탭이 버튼으로 가서 다른 화면을 연 것이 아니라 빈 world에 닿았음을 확인한다.
    assert(down.length && down.every(d => d.target === 'gl' || d.target === 'tab-home'), 'Tap did not land on empty world: ' + JSON.stringify({ point, down }));
    return { point, down, tapBefore, tapAfter };
  };
  if (groups.has('lobby')) {
  await step('lobby empty-world one-finger rotate', lobbyRotate);
  await step('lobby tap without drag does not rotate', lobbyTap);
  await step('town walk (optional entry): empty-world rotate, tap no-rotate, return', async () => {
    const explore = page.locator('#citadel-explore:visible, [data-town-walk]:visible').first();
    if (!await explore.count()) return { notRun: true, reason: 'no town walk entry in this lobby' };
    await explore.tap(); await page.waitForFunction(() => window.app.canWalkHub?.(), null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const r = { rotate: await lobbyRotate(), tap: await lobbyTap() };
    await shot('town-walk-after-rotate');
    const back = page.getByRole('button', { name: '출격 메뉴로' });
    if (await back.isVisible()) { await back.tap(); await page.waitForFunction(() => !window.app.canWalkHub?.(), null, { timeout: 30000 }); }
    // 안쪽 검사가 실행되지 않았으면 이 단계도 PASS가 아니다.
    return r.rotate?.notRun || r.tap?.notRun ? { ...r, notRun: true, reason: 'inner town-walk check not run' } : r;
  });
  // 던전 우선 로비의 착지 패널은 스크롤하지 않는다. 실제 보조 목록('다른 던전' → 원정 던전 목록)을 열어 터치 스크롤이
  // 로비 시점 제스처에 먹히지 않는지, 닫으면 착지로 돌아오는지 확인한다.
  await step('lobby secondary dungeon list scrolls by touch without moving the lobby camera', async () => {
    const other = page.locator('#citadel-other-dungeons:visible');
    assert(await other.count(), 'No visible other-dungeons entry on the landing');
    const cameraBefore = await page.evaluate(() => ({ ...window.app.renderer.lobbyCamera }));
    await other.tap();
    await page.locator('#expedition-root .exp-shell').waitFor({ timeout: 60000 }); await settle(page);
    const findScroller = () => page.evaluate(() => {
      const cands = [...document.querySelectorAll('#expedition-root .exp-shell, #expedition-root .exp-shell *')].filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      const all = cands.filter(el => { const r = el.getBoundingClientRect(); return el.scrollHeight > el.clientHeight + 20 && r.width > 40 && r.height > 60 && r.top < innerHeight && r.bottom > 0; });
      const el = all[0];
      if (!el) return { found: false, viewport: [innerWidth, innerHeight], scrollables: cands.slice(0, 6).map(c => ({ cls: String(c.className).slice(0, 40), sh: c.scrollHeight, ch: c.clientHeight, h: Math.round(c.getBoundingClientRect().height) })) };
      el.dataset.qaScroll = '1'; const r = el.getBoundingClientRect();
      return { found: true, viewport: [innerWidth, innerHeight], selector: el.id || String(el.className), x: r.x + r.width / 2, y: r.y + Math.min(r.height - 10, r.height * .7), top: r.top, bottom: r.bottom, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    // 844x390에서 목록이 넘치지 않으면 지원하는 짧은 가로 640x360에서 실제로 넘치는 목록을 쓴다(강제 높이·scrollTop 없음).
    let info = await findScroller(); const tried = [info];
    if (!info.found) { await page.setViewportSize({ width: 640, height: 360 }); await page.waitForTimeout(600); await settle(page); info = await findScroller(); tried.push(info); }
    if (!info.found) { const used = await returnToLanding(); await restoreViewport(); const row = report.steps[report.steps.length - 1]; row.tried = tried;
      throw Error('No overflowing secondary list at 844x390 or 640x360: ' + JSON.stringify({ tried, closedWith: used })); }
    await touch.down(2, info.x, info.y); await touch.move(2, info.x, Math.max(info.top + 8, info.y - 120), 8); await touch.up(2);
    // 손을 뗀 뒤 Chrome 관성 스크롤(fling)이 끝날 때까지 기다린다. PC 설치 Chrome 추적에서 scrollTop이 아직 움직이는 중(387→391)의
    // 첫 탭은 pointerdown/up/touchend만 받고 click이 없었고(fling 정지에 쓰임), 실제 scrollTop이 300ms 그대로인 뒤의 첫 탭은 click으로 착지에 갔다.
    // 고정 대기 대신 매 프레임 실제 scrollTop을 보고 300ms 무변화를 조건으로 삼는다(최대 5초, 못 멈추면 FAIL). 탭 재시도·강제 click·scrollTop 쓰기 없음.
    const quiet = await page.evaluate(({ quietMs, maxMs }) => new Promise((resolve) => {
      const el = document.querySelector('[data-qa-scroll]'), start = performance.now(), samples = [];
      let last = el.scrollTop, since = start, frames = 0; samples.push({ t: 0, top: last });
      const check = () => {
        const top = el.scrollTop, now = performance.now(); frames++;
        if (top !== last) { last = top; since = now; if (samples.length < 60) samples.push({ t: Math.round(now - start), top }); }
        if (now - since >= quietMs) return resolve({ settled: true, top, elapsedMs: Math.round(now - start), quietMs, maxMs, frames, samples });
        if (now - start >= maxMs) return resolve({ settled: false, top, elapsedMs: Math.round(now - start), quietMs, maxMs, frames, samples });
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }), { quietMs: 300, maxMs: 5000 });
    const after = await page.evaluate(() => ({ scrollTop: document.querySelector('[data-qa-scroll]').scrollTop, camera: { ...window.app.renderer.lobbyCamera }, gesture: window.app.lobbyCameraControls.touch.size }));
    // 닫기 실패가 스크롤 근거를 가리지 않게 먼저 기록하고 캡처한다.
    const row = report.steps[report.steps.length - 1]; row.scrollEvidence = { info, quiet, after, cameraBefore }; await save();
    await shot('secondary-list-after-scroll');
    assert(quiet.settled, 'Secondary list scroll did not settle (scrollTop unchanged ' + quiet.quietMs + 'ms) within ' + quiet.maxMs + 'ms: ' + JSON.stringify(quiet));
    // 복귀는 한 번의 실제 탭으로 판정한다(returnToLanding 안에서 재시도하지 않는다). 실패 뒤 정리 탭은 이 판정에 들어가지 않는다.
    let closedWith = null, closeError = null;
    const tapAt = Date.now();
    try { closedWith = await returnToLanding(); } catch (error) { closeError = String(error?.message || error).slice(0, 400); }
    const firstTapToLandingMs = closeError ? null : Date.now() - tapAt;
    await restoreViewport();
    const back = await page.evaluate(() => ({ landing: !!window.app.commandUI?.visible, tab: window.app.meta.tab, camera: { ...window.app.renderer.lobbyCamera } }));
    assert(after.scrollTop > info.scrollTop, 'Secondary list did not scroll by touch: ' + JSON.stringify({ info, after }));
    assert(after.gesture === 0 && after.camera.yaw === cameraBefore.yaw && after.camera.pitch === cameraBefore.pitch, 'List scroll moved the lobby camera: ' + JSON.stringify({ cameraBefore, after }));
    assert(!closeError && back.landing && back.tab === 'home', 'Closing the list did not return to the landing: ' + JSON.stringify({ closedWith, closeError, back }));
    return { ...info, tried: tried.length > 1 ? tried : undefined, quiet, after, back, closedWith, firstTapToLandingMs, restoredViewport: page.viewportSize() };
  });
  }
  if (groups.has('battle')) {
  await step('enter dungeon through real lobby control and preparation', async () => { const r = await enterDungeon(page); entered = true; report.entry = r; assert(r.spent > 0, 'Final start spent no energy'); return r; });
  if (!entered) throw Error('Battle not entered; remaining battle steps not run');
  await step('battle old camera pad hidden', async () => { const s = await padState(page, '#battle-camera-pad'); assert(s === 'hidden' || s === 'missing', s); return { pad: s }; });
  await shot('battle-start');
  const joy = await page.locator('#joy').boundingBox();
  const world = await emptyPoint(page, { x0: .42, x1: .72, y0: .16, y1: .5 });
  assert(joy && world, 'No joystick or empty battle world point');
  // 핀치 두 번째 손가락도 버튼 보정이 없는 빈 world 점에서 내린다(첫 손가락 오른쪽).
  const world2 = await emptyPoint(page, { x0: (world.x + 110) / 844, x1: .8, y0: Math.max(.12, world.y / 390 - .08), y1: .62 });
  assert(world2, 'No second empty battle world point for pinch');
  report.points = { joy, world, world2 };
  diagnose = () => page.evaluate(() => { const app = window.app, b = app.battle;
    return { mode: app.mode, active: !!b?.active, paused: b?.paused, pauseReasons: b?.pauseReasons ? [...b.pauseReasons] : undefined, alive: b?.player?.alive,
      modal: !!document.querySelector('#modal.show'), inputEnabled: app.input.enabled, joy: app.input.joy.active, camera: { ...app.renderer.battleCamera },
      gesture: { size: app.cameraControls.touch.size, mode: app.cameraControls.touch.mode }, clock: app.renderer.time, focused: document.activeElement?.id || document.activeElement?.tagName }; });
  cleanup = async () => {
    if (touch.size) await touch.cancel();
    if (await page.locator('#btn-resume').isVisible()) { await page.locator('#btn-resume').tap(); await page.waitForFunction(() => !window.app.battle.paused, null, { timeout: 30000 }); }
  };
  await step('default movement follows camera forward (before rotation)', async () => {
    const r = await joystickForward(page, touch, joy); assert(r.distance > .4 && r.angleToCameraForward < 30, JSON.stringify(r)); return r;
  });
  let rotated, pinched;
  const joyRotate = await step('joystick held + one world finger rotates', async () => {
    const jx = joy.x + joy.width * .3, jy = joy.y + joy.height * .6;
    const start = await cam(page);
    await touch.down(1, jx, jy); await touch.move(1, jx + 40, jy, 3);
    await touch.down(2, world.x, world.y); await touch.move(2, world.x + 90, world.y + 20);
    rotated = await cam(page);
    assert(rotated.joy && Math.abs(rotated.yaw - start.yaw) > 10, 'Joystick + world drag failed');
    return { start, rotated };
  });
  const pinchRow = await step('joystick held + two world fingers pinch without rotating', async () => {
    await touch.down(3, world2.x, world2.y); await touch.move(3, world2.x + 90, world2.y);
    pinched = await cam(page);
    assert(pinched.joy && pinched.zoom !== rotated.zoom && pinched.yaw === rotated.yaw, 'Pinch failed or rotated: ' + JSON.stringify({ rotated, pinched }));
    return { pinched };
  }, { needs: joyRotate });
  await step('pinch -> remaining finger re-anchors without jump', async () => {
    await touch.up(2);
    const resumedStart = await cam(page);
    await touch.move(3, world2.x + 91, world2.y, 1);
    const noJump = await cam(page);
    await touch.move(3, world2.x + 150, world2.y);
    const resumed = await cam(page);
    assert(Math.abs(noJump.yaw - resumedStart.yaw) < 1 && Math.abs(resumed.yaw - noJump.yaw) > 5 && resumed.zoom === pinched?.zoom, 'Remaining finger jumped or did not rotate: ' + JSON.stringify({ resumedStart, noJump, resumed }));
    await touch.up(3); await touch.up(1);
    return { resumedStart, noJump, resumed };
  }, { needs: pinchRow });
  // 사슬 단계가 중간에 멈춰도 다음 독립 단계는 손가락 없이 시작한다.
  if (touch.size) await touch.cancel();
  await step('movement follows rotated camera forward', async () => {
    const r = await joystickForward(page, touch, joy); assert(r.distance > .4 && r.angleToCameraForward < 30, JSON.stringify(r)); return r;
  });
  await step('camera value survives combat frames (no rebound/override)', async () => {
    const a = await cam(page);
    await page.waitForFunction(clock => window.app.renderer.time - clock >= 1, a.clock, { timeout: 90000 });
    const b = await cam(page);
    assert(a.yaw === b.yaw && a.pitch === b.pitch && a.zoom === b.zoom, 'Camera value changed without input');
    return { a, b };
  });
  await step('touchcancel mid-rotate releases gesture', async () => {
    await touch.down(4, world.x, world.y); await touch.move(4, world.x + 40, world.y);
    const during = await cam(page);
    await touch.cancel();
    const after = await cam(page);
    assert(during.touches === 1 && after.touches === 0, 'Gesture not released by cancel: ' + JSON.stringify({ during, after }));
    return { during, after };
  });
  await step('pause button during rotate ends capture; resume restores control', async () => {
    await touch.down(5, world.x, world.y); await touch.move(5, world.x + 40, world.y);
    const pause = await page.locator('#btn-pause').boundingBox();
    await touch.down(6, pause.x + pause.width / 2, pause.y + pause.height / 2); await touch.up(6);
    await page.waitForTimeout(300);
    const paused = await page.evaluate(() => !!window.app.battle.paused);
    const beforeMove = await cam(page);
    await touch.move(5, world.x + 140, world.y);
    const afterMove = await cam(page);
    await touch.up(5);
    assert(paused && beforeMove.yaw === afterMove.yaw && afterMove.touches === 0, 'Paused battle still rotated or kept capture: ' + JSON.stringify({ paused, beforeMove, afterMove }));
    await page.locator('#btn-resume').tap();
    await page.waitForFunction(() => !window.app.battle.paused, null, { timeout: 30000 });
    return { paused, beforeMove, afterMove };
  });
  await step('mouse right-drag still rotates', async () => {
    const before = await cam(page);
    await page.mouse.move(world.x, world.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(world.x + 60, world.y, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await frames(page);
    const after = await cam(page);
    assert(Math.abs(after.yaw - before.yaw) > 5, 'Mouse right drag did not rotate');
    return { before, after };
  });
  await step('keyboard arrow on focused camera pad rotates', async () => {
    // 실제 키보드 경로: Tab으로 이동 → 패드가 닫힌 '시점' 묶음 안에 있으면 Enter로 열기 → Tab으로 패드 → 방향키.
    // 닫힌 details 안 요소는 렌더되지 않아 스크립트 focus()가 조용히 실패하므로 쓰지 않는다.
    const path = [];
    const focused = () => page.evaluate(() => { const a = document.activeElement, pad = document.getElementById('battle-camera-pad');
      const holder = pad?.closest('details');
      return { pad: a === pad, summary: !!holder && a === holder.querySelector('summary'), open: holder ? holder.open : null, id: a?.id || a?.tagName }; });
    for (let n = 0; n < 40; n++) {
      const f = await focused();
      if (f.pad) break;
      if (f.summary && !f.open) { await page.keyboard.press('Enter'); path.push('Enter'); continue; }
      await page.keyboard.press('Tab'); path.push('Tab:' + (await focused()).id);
    }
    const reached = await focused();
    assert(reached.pad, 'Keyboard Tab never reached camera pad: ' + JSON.stringify({ path, reached }));
    const visible = await padState(page, '#battle-camera-pad');
    const before = await cam(page);
    await page.keyboard.press('ArrowLeft');
    const after = await cam(page);
    // 원래 상태로: 패드 포커스를 풀고 연 '시점' 묶음을 닫는다.
    await page.evaluate(() => { const pad = document.getElementById('battle-camera-pad'); pad?.blur(); const d = pad?.closest('details'); if (d) d.open = false; });
    assert(after.yaw !== before.yaw, 'Arrow key did not rotate: ' + JSON.stringify({ visible, before, after }));
    return { path, padWhenFocused: visible, before, after };
  });
  await step('resize during rotate releases gesture', async () => {
    await touch.down(7, world.x, world.y); await touch.move(7, world.x + 40, world.y);
    await page.setViewportSize({ width: 800, height: 380 }); await page.waitForTimeout(500);
    const after = await cam(page);
    touch.clear(); await touch.cancel();
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(500);
    assert(after.touches === 0, 'Gesture survived resize');
    return { after };
  });
  await shot('battle-after-gestures');
  }
  await context.close();
  cleanup = diagnose = null;

  if (groups.has('fullscreen')) {
  // 전체화면 결과: 실제 탭에서 요청 → 실제 브라우저 결과를 그대로 기록한다.
  const real = await browser.newContext(contextOptions);
  const realPage = await openPage(real);
  await step('boot start tap requests fullscreen (actual headless result)', async () => {
    const r = await boot(realPage.page);
    return { ...r, note: 'Headless Chromium result; a real phone browser may differ.' };
  }, { required: false });
  await real.close();
  // 거절·미지원 안내는 브라우저 API를 init script로 바꿔 분기만 확인한다(실제 기기 결과 아님).
  const rejected = await browser.newContext(contextOptions);
  await rejected.addInitScript(() => {
    Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('denied (qa stub)')); };
    // 관측 전용: 2.2초 뒤 사라지는 토스트 문구를 기록한다.
    window.__qaToasts = [];
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__qaToasts.push(n.textContent); })
      .observe(document, { childList: true, subtree: true });
  });
  const rejectedPage = await openPage(rejected);
  await step('fullscreen rejection shows honest notice (API stub)', async () => {
    const r = await boot(rejectedPage.page);
    await rejectedPage.page.waitForTimeout(400);
    const toasts = await rejectedPage.page.evaluate(() => window.__qaToasts);
    const fullscreen = await rejectedPage.page.evaluate(() => !!document.fullscreenElement);
    assert(!fullscreen, 'Fullscreen reported active after rejection');
    assert(toasts.some(t => /거절/.test(t)), 'No rejection notice shown');
    return { ...r, toasts };
  });
  await rejected.close();
  const unsupported = await browser.newContext(contextOptions);
  await unsupported.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
    delete Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = undefined;
  });
  const unsupportedPage = await openPage(unsupported);
  await step('unsupported fullscreen does not promise fullscreen (API stub)', async () => {
    const r = await boot(unsupportedPage.page, { tapStart: false });
    const hint = await unsupportedPage.page.locator('#app-mode-boot-hint').innerText().catch(() => '');
    const fsButton = await unsupportedPage.page.locator('#app-mode-boot-fullscreen').isVisible().catch(() => false);
    assert(!/전체화면/.test(r.bootLabel) && !fsButton, 'Unsupported browser still promises fullscreen: ' + r.bootLabel);
    return { ...r, hint, fullscreenButtonVisible: fsButton };
  });
  await unsupported.close();
  }
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  const required = report.steps.filter(s => s.required);
  report.summary = { pass: report.steps.filter(s => s.status === 'PASS').length, fail: report.steps.filter(s => s.status === 'FAIL').length, notRun: report.steps.filter(s => s.status === 'NOT_RUN').length };
  report.status = report.error || required.some(s => s.status === 'FAIL') || report.errors.length ? 'fail' : required.some(s => s.status === 'NOT_RUN') ? 'partial' : 'pass';
  report.groups = [...groups];
  if (report.status === 'pass' && groups.size < ALL_GROUPS.length) report.status = 'partial';
  report.finished = new Date().toISOString(); await save(); await browser.close();
  console.log('camera-gesture-qa ' + report.status + ' ' + JSON.stringify(report.summary) + ' -> ' + dir);
  if (report.status !== 'pass') process.exitCode = 1;
}
