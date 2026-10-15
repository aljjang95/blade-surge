// 로컬 Chromium CDP 터치로 실제 사용자 흐름의 빈 화면 회전·핀치·조이스틱 동시 입력과 전체화면 결과를 확인한다.
// 흐름: 부팅 시작 버튼 → 자연 모달(출석 등) 닫기 → 로비 빈 화면 회전 → 실제 던전 진입 버튼 → 출격 준비창 → 원정 시작
//       → 전투 HUD 제스처 · 이동 방향 · 정리 경계 → (선택) 전체화면 거절/미지원 안내.
// CDP Input.dispatchTouchEvent는 브라우저 입력 파이프라인을 거치는 자동화 터치다. 실기기 터치·GPU·발열·OS 막대 숨김 증거가 아니다.
// 실행: 빌드한 dist를 loopback preview로 띄운 뒤
//   node tools/camera-gesture-qa.mjs --url=http://127.0.0.1:5231/ --label=<이름> [--expected-sha=<40hex>]
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
const dir = 'work/qa/camera-gesture/' + label;
await mkdir('work/qa/camera-gesture', { recursive: true });
await mkdir(dir); // 같은 label의 이전 결과를 덮어쓰지 않는다.
const report = { label, started: new Date().toISOString(), target: target.href,
  scope: 'Local headless Chromium (SwiftShader) with CDP touch emulation, 844x390 landscape, deviceScaleFactor 1. Real boot/modal/dungeon card/preparation/start buttons. Not a physical device, GPU, heat, feel or OS system bar result.',
  steps: [], screenshots: [], errors: [], status: 'running' };
const save = () => writeFile(dir + '/report.json', JSON.stringify(report, null, 2));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const step = async (name, fn, { required = true } = {}) => {
  const row = { name, required, status: 'running' }; report.steps.push(row); await save();
  try { const detail = await fn(); row.status = detail?.notRun ? 'NOT_RUN' : 'PASS'; if (detail) row.detail = detail; }
  catch (error) { row.status = 'FAIL'; row.error = String(error?.message || error); }
  await save(); return row;
};

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
    down: async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() }); },
    move: async (id, x, y, steps = 6) => {
      const from = touches.get(id);
      for (let i = 1; i <= steps; i++) { touches.set(id, { x: from.x + (x - from.x) * i / steps, y: from.y + (y - from.y) * i / steps }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() }); }
    },
    up: async id => { touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points() }); },
    cancel: async () => { touches.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); },
    clear: () => touches.clear(),
  };
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(dir + '/' + name + '.png', Buffer.from(r.data, 'base64')); report.screenshots.push(name + '.png');
  };
  return { page, touch, shot };
}

/** 빈 world 표면(캔버스 또는 로비 tab-home)인 점을 화면 격자에서 찾는다. */
const emptyPoint = (page, region) => page.evaluate(({ x0, x1, y0, y1 }) => {
  for (let y = y0; y <= y1; y += .04) for (let x = x0; x <= x1; x += .04) {
    const px = Math.round(innerWidth * x), py = Math.round(innerHeight * y), el = document.elementFromPoint(px, py);
    if (el && (el.id === 'gl' || el.id === 'tab-home')) return { x: px, y: py };
  }
  return null;
}, region);
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
  const candidates = ['[data-dungeon-cta]:visible', '[data-command-route="glass_garden"]:visible'];
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
  await page.waitForFunction(clock => window.app.renderer.time - clock >= .5, start.clock, { timeout: 30000 });
  const end = await cam(page);
  await touch.up(11);
  const moved = { x: end.player.x - start.player.x, z: end.player.z - start.player.z };
  return { distance: Math.hypot(moved.x, moved.z), angleToCameraForward: angle(moved, start.forward), yaw: start.yaw };
}

try {
  const context = await browser.newContext(contextOptions);
  const { page, touch, shot } = await openPage(context);
  let entered = false;
  await step('boot via start button and close natural modals', async () => { const r = await boot(page); report.boot = r; return r; });
  await step('lobby old camera pad hidden', async () => { const s = await padState(page, '#lobby-camera-pad'); assert(s === 'hidden' || s === 'missing', s); return { pad: s }; });
  await shot('lobby');
  await step('lobby empty-world one-finger rotate', async () => {
    const point = await emptyPoint(page, { x0: .55, x1: .95, y0: .2, y1: .7 });
    if (!point) return { notRun: true, reason: 'no empty lobby world point visible' };
    const before = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    await touch.down(1, point.x, point.y); await touch.move(1, point.x + 80, point.y); await touch.up(1);
    const after = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    assert(before.yaw !== after.yaw, 'Lobby world drag did not rotate');
    return { point, before, after };
  });
  await step('lobby tap without drag does not rotate', async () => {
    const point = await emptyPoint(page, { x0: .55, x1: .95, y0: .2, y1: .7 });
    if (!point) return { notRun: true };
    const before = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    await touch.down(1, point.x, point.y); await touch.move(1, point.x + 4, point.y + 2, 2); await touch.up(1);
    const after = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    assert(before.yaw === after.yaw && before.pitch === after.pitch, 'Sub-slop tap rotated lobby');
    return { before, after };
  });
  await step('lobby scroll panel still scrolls by touch', async () => {
    const info = await page.evaluate(() => {
      const all = [...document.querySelectorAll('#tab-home *')].filter(el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20 && r.width > 40 && r.height > 60 && r.top < innerHeight && r.bottom > 0; });
      const el = all[0]; if (!el) return null;
      el.dataset.qaScroll = '1'; const r = el.getBoundingClientRect();
      return { selector: el.id || el.className, x: r.x + r.width / 2, y: r.y + Math.min(r.height - 10, r.height * .7), top: r.top, bottom: r.bottom, scrollTop: el.scrollTop };
    });
    if (!info) return { notRun: true, reason: 'no overflowing lobby panel in this layout' };
    await touch.down(2, info.x, info.y); await touch.move(2, info.x, Math.max(info.top + 8, info.y - 120), 8); await touch.up(2);
    await page.waitForTimeout(400);
    const scrollTop = await page.evaluate(() => document.querySelector('[data-qa-scroll]').scrollTop);
    assert(scrollTop > info.scrollTop, 'Panel did not scroll by touch (touch-action may block it)');
    return { ...info, after: scrollTop };
  });
  await step('enter dungeon through real lobby control and preparation', async () => { const r = await enterDungeon(page); entered = true; report.entry = r; assert(r.spent > 0, 'Final start spent no energy'); return r; });
  if (!entered) throw Error('Battle not entered; remaining battle steps not run');
  await step('battle old camera pad hidden', async () => { const s = await padState(page, '#battle-camera-pad'); assert(s === 'hidden' || s === 'missing', s); return { pad: s }; });
  await shot('battle-start');
  const joy = await page.locator('#joy').boundingBox();
  const world = await emptyPoint(page, { x0: .42, x1: .72, y0: .16, y1: .5 });
  assert(joy && world, 'No joystick or empty battle world point');
  report.points = { joy, world };
  await step('default movement follows camera forward (before rotation)', async () => {
    const r = await joystickForward(page, touch, joy); assert(r.distance > .4 && r.angleToCameraForward < 30, JSON.stringify(r)); return r;
  });
  let rotated, pinched;
  await step('joystick held + one world finger rotates', async () => {
    const jx = joy.x + joy.width * .3, jy = joy.y + joy.height * .6;
    const start = await cam(page);
    await touch.down(1, jx, jy); await touch.move(1, jx + 40, jy, 3);
    await touch.down(2, world.x, world.y); await touch.move(2, world.x + 90, world.y + 20);
    rotated = await cam(page);
    assert(rotated.joy && Math.abs(rotated.yaw - start.yaw) > 10, 'Joystick + world drag failed');
    return { start, rotated };
  });
  await step('joystick held + two world fingers pinch without rotating', async () => {
    await touch.down(3, world.x + 150, world.y + 20); await touch.move(3, world.x + 240, world.y + 20);
    pinched = await cam(page);
    assert(pinched.joy && pinched.zoom !== rotated.zoom && pinched.yaw === rotated.yaw, 'Pinch failed or rotated');
    return { pinched };
  });
  await step('pinch -> remaining finger re-anchors without jump', async () => {
    await touch.up(2);
    const resumedStart = await cam(page);
    await touch.move(3, world.x + 241, world.y + 20, 1);
    const noJump = await cam(page);
    await touch.move(3, world.x + 300, world.y + 20);
    const resumed = await cam(page);
    assert(Math.abs(noJump.yaw - resumedStart.yaw) < 1 && Math.abs(resumed.yaw - noJump.yaw) > 5 && resumed.zoom === pinched.zoom, 'Remaining finger jumped or did not rotate');
    await touch.up(3); await touch.up(1);
    return { resumedStart, noJump, resumed };
  });
  await step('movement follows rotated camera forward', async () => {
    const r = await joystickForward(page, touch, joy); assert(r.distance > .4 && r.angleToCameraForward < 30, JSON.stringify(r)); return r;
  });
  await step('camera value survives combat frames (no rebound/override)', async () => {
    const a = await cam(page);
    await page.waitForFunction(clock => window.app.renderer.time - clock >= 1, a.clock, { timeout: 30000 });
    const b = await cam(page);
    assert(a.yaw === b.yaw && a.pitch === b.pitch && a.zoom === b.zoom, 'Camera value changed without input');
    return { a, b };
  });
  await step('touchcancel mid-rotate releases gesture', async () => {
    await touch.down(4, world.x, world.y); await touch.move(4, world.x + 40, world.y);
    const during = await cam(page);
    await touch.cancel();
    const after = await cam(page);
    assert(during.touches === 1 && after.touches === 0, 'Gesture not released by cancel');
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
    assert(paused && beforeMove.yaw === afterMove.yaw && afterMove.touches === 0, 'Paused battle still rotated or kept capture');
    await page.locator('#btn-resume').tap();
    await page.waitForFunction(() => !window.app.battle.paused, null, { timeout: 30000 });
    return { paused, beforeMove, afterMove };
  });
  await step('mouse right-drag still rotates', async () => {
    const before = await cam(page);
    await page.mouse.move(world.x, world.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(world.x + 60, world.y, { steps: 5 }); await page.mouse.up({ button: 'right' });
    const after = await cam(page);
    assert(Math.abs(after.yaw - before.yaw) > 5, 'Mouse right drag did not rotate');
    return { before, after };
  });
  await step('keyboard arrow on focused camera pad rotates', async () => {
    await page.keyboard.press('Tab'); // 키보드 상호작용으로 focus-visible 상태를 만든다.
    await page.locator('#battle-camera-pad').focus();
    const visible = await padState(page, '#battle-camera-pad');
    const before = await cam(page);
    await page.keyboard.press('ArrowLeft');
    const after = await cam(page);
    await page.locator('#battle-camera-pad').blur();
    assert(after.yaw !== before.yaw, 'Arrow key did not rotate');
    return { padWhenFocused: visible, before, after };
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
  await context.close();

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
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  const required = report.steps.filter(s => s.required);
  report.summary = { pass: report.steps.filter(s => s.status === 'PASS').length, fail: report.steps.filter(s => s.status === 'FAIL').length, notRun: report.steps.filter(s => s.status === 'NOT_RUN').length };
  report.status = report.error || required.some(s => s.status === 'FAIL') || report.errors.length ? 'fail' : required.some(s => s.status === 'NOT_RUN') ? 'partial' : 'pass';
  report.finished = new Date().toISOString(); await save(); await browser.close();
  console.log('camera-gesture-qa ' + report.status + ' ' + JSON.stringify(report.summary) + ' -> ' + dir);
  if (report.status !== 'pass') process.exitCode = 1;
}

