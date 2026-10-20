// 로컬 게임에서 영웅 보이스 자산 요청과 화면 근거를 수집한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.BLADE_SURGE_QA_URL || 'http://127.0.0.1:4413';
const outDir = 'work/voice-ko/qa';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const voiceRequests = [];
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/sfx/voice/')) voiceRequests.push({ method: request.method(), path: url.pathname });
});
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(15000);
await page.screenshot({ path: `${outDir}/01-initial.png`, fullPage: true });
const initialButtons = await page.locator('button:visible').allTextContents();
const initialText = await page.locator('body').innerText();
const startButton = page.getByRole('button', { name: '터치하여 시작' });
if (await startButton.isVisible()) {
  await startButton.click();
  await page.waitForTimeout(2500);
}
const closeReward = page.getByRole('button', { name: '닫기' });
if (await closeReward.isVisible()) {
  await closeReward.click();
  await page.waitForTimeout(500);
}
const heroesButton = page.getByRole('button', { name: '영웅', exact: true });
if (await heroesButton.isVisible()) {
  await heroesButton.click();
  await page.waitForTimeout(700);
}
await page.screenshot({ path: `${outDir}/02-lobby.png`, fullPage: true });
for (const heroId of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
  const card = page.locator(`#hero-list [data-hero-id="${heroId}"]`);
  if (await card.isVisible()) {
    await card.click();
    await page.waitForTimeout(900);
  }
}
const launch = page.locator('button:visible').filter({ hasText: /^출격/ }).first();
if (await launch.count()) {
  await launch.click().catch(() => {});
  await page.waitForTimeout(1800);
}
const launchAgain = page.locator('button:visible').filter({ hasText: /^출격/ }).first();
if (await launchAgain.count()) {
  await launchAgain.click().catch(() => {});
  await page.waitForTimeout(4500);
}
await page.keyboard.down('Space');
await page.waitForTimeout(800);
await page.keyboard.up('Space');
await page.keyboard.press('Digit1');
await page.waitForTimeout(1200);
await page.keyboard.press('Digit2');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/03-hero-selection.png`, fullPage: true });
const buttonsAfterSelection = await page.locator('button:visible').allTextContents();
const links = await page.locator('a:visible').evaluateAll(items => items.map(item => ({ text: item.textContent?.trim(), href: item.href })));
const result = { baseUrl, initialButtons, buttonsAfterSelection, links, lobbyText: (await page.locator('body').innerText()).slice(0, 3000), initialText: initialText.slice(0, 2000), voiceRequests, screenshots: [`${outDir}/01-initial.png`, `${outDir}/02-lobby.png`, `${outDir}/03-hero-selection.png`] };
writeFileSync(`${outDir}/network-log.json`, JSON.stringify(result, null, 2) + '\n', 'utf8');
await browser.close();
console.log(JSON.stringify({ voiceRequests: voiceRequests.length, paths: voiceRequests.map(item => item.path), screenshots: result.screenshots }));
