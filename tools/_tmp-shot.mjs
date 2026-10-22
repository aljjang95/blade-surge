import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
const [url, out] = process.argv.slice(2);
const br = await chromium.launch(launchOpts());
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.goto(url);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
await page.click('#boot-start', { force: true }); await page.waitForTimeout(2500);
for (let i = 0; i < 4; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click(); await page.waitForTimeout(400); } }
await page.waitForTimeout(4000);
await page.screenshot({ path: out + '-lobby.png' });
await br.close();
