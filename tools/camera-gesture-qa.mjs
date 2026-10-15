// 로컬 Chromium 에뮬레이션 터치(CDP)로 빈 화면 회전·핀치·조이스틱 동시 입력을 확인한다.
// 실기기 터치·발열·OS 상태 표시줄 숨김 검증이 아니다. 실행: 로컬 preview를 띄운 뒤
//   node tools/camera-gesture-qa.mjs --url=http://127.0.0.1:5225/
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const target = new URL(process.argv.find(a => a.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:5225/');
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.username || target.password) throw Error('localhost only');
const out = 'work/camera-gesture-qa.json', dir = 'work/camera-gesture-qa.artifacts'; await mkdir(dir, { recursive: true });
const report = { started: new Date().toISOString(), target: target.href, scope: 'Local Chromium CDP touch emulation at 844x390. No physical device, GPU, heat or OS system bar claim.', steps: [], status: 'running' };
const save = () => writeFile(out, JSON.stringify(report, null, 2));
const assert = (ok, message) => { if (!ok) throw Error(message); };

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  const touches = new Map();
  const send = async type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 })) });
  const down = async (id, x, y) => { touches.set(id, { x, y }); await send('touchStart'); };
  const move = async (id, x, y, steps = 6) => {
    const from = touches.get(id);
    for (let i = 1; i <= steps; i++) { touches.set(id, { x: from.x + (x - from.x) * i / steps, y: from.y + (y - from.y) * i / steps }); await send('touchMove'); }
  };
  const up = async id => { const p = touches.get(id); touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...touches.entries()].map(([i, q]) => ({ id: i, x: q.x, y: q.y })) }); return p; };
  // 빈 world 표면(캔버스 또는 로비 tab-home)인 점을 화면 격자에서 찾는다.
  const emptyPoint = region => page.evaluate(({ x0, x1, y0, y1 }) => {
    for (let y = y0; y <= y1; y += .05) for (let x = x0; x <= x1; x += .05) {
      const px = Math.round(innerWidth * x), py = Math.round(innerHeight * y), el = document.elementFromPoint(px, py);
      if (el && (el.id === 'gl' || el.id === 'tab-home')) return { x: px, y: py };
    }
    return null;
  }, region);
  const hiddenPad = selector => page.evaluate(s => { const el = document.querySelector(s); if (!el) return 'missing'; const r = el.getBoundingClientRect(); return r.width <= 1 && r.height <= 1 ? 'hidden' : 'visible:' + r.width + 'x' + r.height; }, selector);

  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  report.bootLabel = await page.locator('#boot-start').innerText();
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
  for (let n = 0; n < 4; n++) { const close = page.locator('#modal.show #m-cancel'); if (!await close.isVisible()) break; await close.tap(); }
  report.fullscreenAfterBoot = await page.evaluate(() => !!document.fullscreenElement);

  report.lobbyPad = await hiddenPad('#lobby-camera-pad');
  const lobbyPoint = await emptyPoint({ x0: .35, x1: .65, y0: .3, y1: .6 });
  if (lobbyPoint) {
    const before = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    await down(1, lobbyPoint.x, lobbyPoint.y); await move(1, lobbyPoint.x + 80, lobbyPoint.y); await up(1);
    const after = await page.evaluate(() => ({ ...window.app.eco.s.settings.lobbyCamera }));
    report.steps.push({ name: 'lobby empty-world one-finger rotate', point: lobbyPoint, before, after, changed: before.yaw !== after.yaw });
    assert(before.yaw !== after.yaw, 'Lobby world drag did not rotate');
  } else report.steps.push({ name: 'lobby empty-world one-finger rotate', result: 'NOT_RUN: no empty world point' });
  await save();

  await page.locator('#btn-battle').tap();
  await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  report.battlePad = await hiddenPad('#battle-camera-pad');
  const joy = await page.locator('#joy').boundingBox();
  const world = await emptyPoint({ x0: .45, x1: .7, y0: .2, y1: .45 });
  assert(joy && world, 'No joystick or empty battle world point');
  const camera = () => page.evaluate(() => ({ ...window.app.renderer.battleCamera, joy: window.app.input.joy.active }));
  const joyX = joy.x + joy.width * .3, joyY = joy.y + joy.height * .6;
  const start = await camera();
  await down(1, joyX, joyY); await move(1, joyX + 40, joyY, 3);
  await down(2, world.x, world.y); await move(2, world.x + 70, world.y + 20);
  const rotated = await camera();
  report.steps.push({ name: 'joystick held + world rotate', start, rotated });
  assert(rotated.joy && rotated.yaw !== start.yaw, 'Joystick + world drag failed');
  await down(3, world.x + 150, world.y + 20); await move(3, world.x + 230, world.y + 20);
  const pinched = await camera();
  report.steps.push({ name: 'joystick held + two-world pinch', pinched });
  assert(pinched.joy && pinched.zoom !== rotated.zoom && pinched.yaw === rotated.yaw, 'Pinch failed or rotated');
  await up(2);
  const resumedStart = await camera();
  await move(3, world.x + 230.5, world.y + 20, 1);
  const noJump = await camera();
  await move(3, world.x + 280, world.y + 20);
  const resumed = await camera();
  report.steps.push({ name: 'pinch -> remaining finger rotate', resumedStart, noJump, resumed });
  assert(Math.abs(noJump.yaw - resumedStart.yaw) < 1 && resumed.yaw !== noJump.yaw && resumed.zoom === pinched.zoom, 'Remaining finger jumped or did not rotate');
  await up(3); await up(1);
  await page.screenshot({ path: dir + '/battle-after-gestures.png' });
  report.errors = errors; report.status = errors.length ? 'fail' : 'pass';
} catch (error) {
  report.status = 'fail'; report.error = String(error?.stack || error);
} finally {
  report.finished = new Date().toISOString(); await save(); await browser.close();
  console.log('camera-gesture-qa ' + report.status + ' -> ' + out);
  if (report.status !== 'pass') process.exitCode = 1;
}
