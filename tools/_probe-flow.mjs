
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,200)));
await page.goto('http://127.0.0.1:5342/');
if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').tap();
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
await page.waitForTimeout(1500);
for (let n = 0; n < 4; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible()) break; await c.tap(); await page.waitForTimeout(400); }
await page.evaluate(() => { window.app.eco.s.tutorial = { completed: true }; window.app.eco.save(); });
await page.locator('#citadel-dungeon-prepare').tap(); await page.waitForTimeout(1500);
await page.screenshot({ path: 'work/qa/flow-20261020/probe-g.png' });
const btns = () => page.evaluate(() => JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent && b.getBoundingClientRect().width>0).map(b => [b.id, b.className.toString().slice(0,30), (b.textContent||'').trim().slice(0,16)])));
console.log(await btns());
console.log(await page.evaluate(() => JSON.stringify({ mode: window.app.mode, active: window.app.battle?.active, shown: [...document.querySelectorAll('.screen.show, dialog[open], [role=dialog]:not([hidden])')].map(n=>n.id||n.className.toString().slice(0,40)) })));
await browser.close();

