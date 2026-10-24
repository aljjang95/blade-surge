#!/usr/bin/env node
/* Android Chrome 가로 화면에서 전투 핀치와 출격 패널을 실제 DOM에 대고 검증한다. */
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installAutoStarter } from './qa-starter.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('=');
  return index < 0 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const origin = new URL(args.url || 'http://127.0.0.1:4401/');
if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('로컬 QA 주소만 허용합니다.');
const out = resolve(args.out || 'docs/qa/mobile-touch-camera-20261013.json');
const screenshotDir = resolve(args.screenshots || 'docs/qa/mobile-touch-camera-20261013');
await mkdir(screenshotDir, { recursive: true });
const report = {
  schema: 1,
  started: new Date().toISOString(),
  target: origin.href,
  scope: 'Playwright Chromium Android viewport with CDP Input.dispatchTouchEvent; physical Android and PWA install remain unverified',
  viewport: { width: 844, height: 390 },
  screenshots: [],
  safeArea: { supported: false },
  checks: [],
};
const save = () => writeFile(out, JSON.stringify(report, null, 2) + '\n');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const screenshot = async (page, name) => {
  const path = resolve(screenshotDir, `${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
  return path;
};
const point = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  assert(box && box.width > 0 && box.height > 0, `터치 대상이 없습니다: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: selector === '#btn-attack' ? 9 : 8 };
};

let browser;
let context;
let page;
try {
  assert(process.env.CHROME_PATH, 'CHROME_PATH가 필요합니다.');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  context = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: report.viewport,
    screen: report.viewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
  });
  page = await context.newPage();
  page.setDefaultTimeout(120000);
  const client = await context.newCDPSession(page);
  try {
    await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 24, bottom: 0, left: 24 } });
    report.safeArea = { supported: true, insets: { top: 0, right: 24, bottom: 0, left: 24 } };
  } catch (error) {
    report.safeArea = { supported: false, error: String(error) };
  }
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ state: 'visible' });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'));
  await page.waitForTimeout(500);
  for (let attempt = 0; attempt < 4; attempt++) {
    const close = page.locator('#modal.show #m-cancel').first();
    if (!await close.isVisible().catch(() => false)) break;
    await close.tap();
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#citadel-command')?.hidden);

  const expanded = await page.evaluate(() => {
    const root = document.querySelector('#citadel-command');
    const box = root?.getBoundingClientRect();
    return { hidden: !!root?.hidden, collapsed: root?.dataset.collapsed, height: box?.height, bottom: box?.bottom };
  });
  assert(!expanded.hidden && expanded.collapsed === 'false', `출격 패널 기본 상태가 펼침이 아닙니다: ${JSON.stringify(expanded)}`);
  report.checks.push({ name: 'citadel-command-expanded', status: 'pass', evidence: expanded, screenshot: await screenshot(page, 'citadel-command-expanded-844x390') });

  await page.locator('#citadel-command .citadel-command-collapse').tap();
  const collapsed = await page.evaluate(() => {
    const root = document.querySelector('#citadel-command');
    const box = root?.getBoundingClientRect();
    const canvas = document.querySelector('#gl')?.getBoundingClientRect();
    const quickLaunch = document.querySelector('.citadel-command-quick-launch');
    return {
      state: root?.dataset.collapsed,
      height: box?.height,
      bottom: box?.bottom,
      quickLaunchVisible: !!quickLaunch && getComputedStyle(quickLaunch).display !== 'none',
      stored: localStorage.getItem('blade-surge.citadel-command.collapsed'),
      canvas: canvas && { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  assert(collapsed.state === 'true' && collapsed.stored === 'true', `접힘 상태 저장 실패: ${JSON.stringify(collapsed)}`);
  assert(collapsed.height <= 64 && collapsed.quickLaunchVisible, `접힌 하단 바 또는 출격 버튼이 잘못됐습니다: ${JSON.stringify(collapsed)}`);
  assert(collapsed.canvas && collapsed.canvas.x <= 0 && collapsed.canvas.y <= 0
    && collapsed.canvas.width >= collapsed.viewport.width - 1 && collapsed.canvas.height >= collapsed.viewport.height - 1,
  `캔버스가 레이아웃 뷰포트를 채우지 못했습니다: ${JSON.stringify(collapsed)}`);
  report.checks.push({ name: 'citadel-command-collapsed-and-canvas', status: 'pass', evidence: collapsed, screenshot: await screenshot(page, 'citadel-command-collapsed-844x390') });

  await page.evaluate(async () => {
    document.querySelector('#citadel-command .citadel-command-collapse')?.click();
    await window.app.startStage(window.app.eco.nextStage());
  });
  await page.waitForFunction(() => window.app?.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting);
  const surface = await page.locator('#gl').boundingBox();
  assert(surface, '전투 캔버스가 없습니다.');
  const first = { x: surface.x + surface.width * .43, y: surface.y + surface.height * .45, id: 1 };
  const second = { x: surface.x + surface.width * .56, y: surface.y + surface.height * .45, id: 2 };
  const firstDistance = Math.hypot(second.x - first.x, second.y - first.y);
  const dispatch = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  await dispatch('touchStart', [first]);
  await dispatch('touchStart', [first, second]);
  await dispatch('touchMove', [first, { ...second, x: surface.x + surface.width * .69 }]);
  await page.waitForTimeout(100);
  const afterOpen = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  await dispatch('touchMove', [first, { ...second, x: surface.x + surface.width * .48 }]);
  await page.waitForTimeout(100);
  const afterClose = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  await dispatch('touchEnd', []);
  assert(afterOpen > before + 1, `두 손가락 벌리기에서 전투 확대가 변하지 않았습니다: ${before} -> ${afterOpen}`);
  assert(afterClose < afterOpen - 1, `두 손가락 모으기에서 전투 축소가 변하지 않았습니다: ${afterOpen} -> ${afterClose}`);
  report.checks.push({ name: 'battle-cdp-pinch-zoom', status: 'pass', evidence: { before, afterOpen, afterClose, firstDistance } });
  report.checks.push({ name: 'battle-pinch-screenshot', status: 'pass', screenshot: await screenshot(page, 'battle-pinch-zoom') });

  const attack = await point(page, '#btn-attack');
  const empty = { x: surface.x + surface.width * .43, y: surface.y + surface.height * .45, id: 10 };
  const beforeButton = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  await dispatch('touchStart', [attack]);
  await dispatch('touchEnd', []);
  await page.waitForTimeout(100);
  const afterButton = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  assert(beforeButton === afterButton, `액션 버튼 터치가 카메라를 가로챘습니다: ${beforeButton} -> ${afterButton}`);
  await dispatch('touchStart', [attack]);
  await dispatch('touchStart', [attack, empty]);
  await dispatch('touchMove', [attack, { ...empty, x: surface.x + surface.width * .57 }]);
  await page.waitForTimeout(100);
  const afterMixed = await page.evaluate(() => window.app.renderer.battleCamera.zoom);
  await dispatch('touchEnd', []);
  assert(afterMixed === afterButton, `액션 버튼+빈 화면 멀티터치가 카메라를 가로챘습니다: ${afterButton} -> ${afterMixed}`);
  report.checks.push({ name: 'battle-action-touch-isolation', status: 'pass', evidence: { beforeButton, afterButton, afterMixed } });
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = String(error.stack || error);
  if (page) {
    try { await screenshot(page, 'failure'); } catch {}
  }
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await save();
  await context?.close();
  await browser?.close();
  console.log(JSON.stringify({ status: report.status, out, screenshots: report.screenshots, checks: report.checks.map(check => check.name) }));
}
