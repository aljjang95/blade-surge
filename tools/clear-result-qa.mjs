// 클리어 결과 화면 QA: 1-1 첫 클리어 → 첫 클리어 토스트 위치, 카드 3택, 정비소 수리, 강화 전승 흐름을 실제 빌드(vite preview)에서 찍는다.
// 고정값(로컬 새 저장만, 운영 계정 데이터 없음): 기사 Lv10, 무기 장착·내구도 40, 골드 200만, 같은 영웅의 +6 장비 슬롯별 1개.
// 사용: node tools/clear-result-qa.mjs [--url=https://blade.tllhouse.com] [--out=work/qa/clear-result] [--transfer=1]
//   --url 을 주면 그 주소를 연다(운영 확인용, 브라우저 저장만 쓰는 새 게스트). 없으면 dist 를 vite preview 로 띄운다.
//   --transfer=1 이면 전승 시트에서 실제 전승(확인)까지 누른다(로컬 새 저장에서만 쓴다).
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installMetricsDriver } from './metrics-driver.mjs';
import { installAutoStarter } from './qa-starter.mjs';
import { launchOpts } from './chrome.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3) || '';
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, arg('out') || 'work/qa/clear-result');
const doTransfer = arg('transfer') === '1';
// 운영 주소(--url)에서는 장비·골드 고정값을 넣지 않는다(게스트 저장이 서버로 올라갈 수 있다). 새 게스트 그대로 1-1 만 깬다.
const seedGear = !arg('url') || arg('seed') === '1';
const { STORY_EVENTS } = await import(pathToFileURL(path.join(root, 'src/data/masterworks.js')).href);
await fs.mkdir(out, { recursive: true });
const VIEWPORTS = (arg('vp') || '844x390,390x844').split(',').map((s) => { const [width, height] = s.split('x').map(Number); return { width, height }; });

let server = null, url = arg('url');
if (!url) { server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } }); url = 'http://127.0.0.1:' + server.httpServer.address().port; }
const browser = await chromium.launch(launchOpts());
const report = { url, started: new Date().toISOString(), runs: [] };

/** 두 사각형이 겹치는 넓이(px²). */
const overlapJs = `(a, b) => !a || !b ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))`;

try {
  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}x${vp.height}`, row = { viewport: tag, errors: [], console401: [] };
    report.runs.push(row);
    const context = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (e) => row.errors.push(String(e).slice(0, 300)));
    const t0 = Date.now(); row.social = [];
    page.on('response', (r) => {
      const u = r.url().replace(/[?#].*$/, '');
      if (r.status() === 401) row.console401.push({ url: u, method: r.request().method(), t: (Date.now() - t0) / 1000 });
      if (u.includes('/api/')) row.social.push([(Date.now() - t0) / 1000, r.request().method(), u.replace(/^https?:\/\/[^/]+/, ''), r.status()]);
    });
    const mark = (k) => { row.marks = { ...(row.marks || {}), [k]: (Date.now() - t0) / 1000 }; };
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await installAutoStarter(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    row.fixture = await page.evaluate((seedGear) => {
      const a = window.app, e = a.eco;
      if (!e.reset()) throw Error('새 저장 격리 실패');
      e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
      e.s.selected = 'knight'; const h = e.hero('knight'); h.level = 10; h.exp = 0;
      if (!seedGear) { e.save(); return { plain: true }; }
      e.s.gold = 2_000_000;
      // 무기: 장착 + 내구도 40(수리 견적이 생기게). 다른 슬롯: +6 원본(전승용).
      const made = {};
      for (const slot of ['weapon', 'armor', 'ring', 'boots']) {
        let it = null;
        try { it = e.addItem('SR', slot, undefined, 0, 'knight'); } catch { it = null; }
        if (!it) continue;
        if (slot === 'weapon') { e.equip('knight', it.uid); it.dur = 40; } else it.enh = 6;
        made[slot] = { uid: it.uid, id: it.id, enh: it.enh || 0, dur: it.dur ?? null };
      }
      // 무기 전승 원본(+6, 미착용)도 하나 둔다 — 결과 화면 첫 전리품이 무기여도 전승 짝이 있게.
      try { const w2 = e.addItem('SR', 'weapon', undefined, 0, 'knight'); if (w2) { w2.enh = 6; made.weapon6 = { uid: w2.uid, id: w2.id, enh: 6 }; } } catch {}
      e.save();
      return made;
    }, seedGear);
    mark('bootStart');
    await page.locator('#boot-start').tap({ force: true });
    await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
    await page.evaluate(async () => {
      const a = window.app; a.testPause = true; a.ui.closeModal(); a.journey.s.autoBattle = true; a.eco.s.energy = 999;
      await a.startStage({ ch: 1, st: 1 });
    });
    mark('stageStart');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
    await page.evaluate(() => { const a = window.app; a.battle.player.auto = true; a.ui.closeModal(); });
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    for (let chunk = 0; chunk < 200; chunk++) {
      const active = await page.evaluate(() => {
        const a = window.app, b = a.battle, P = b.player;
        for (let i = 0; i < 600 && b.active; i++) {
          if (!P.alive) { a.step(1 / 60, false); if (!P.alive) { b.revivePlayer(); a.ui.closeModal?.(); } continue; }
          globalThis.__metricsDriver.step(1 / 60, false);
        }
        return b.active;
      });
      if (!active) break;
    }
    await page.evaluate(() => { window.app.testPause = false; for (let i = 0; i < 240; i++) window.app.step(1 / 60, false); });
    await page.locator('#result.show').waitFor({ timeout: 30000 });
    mark('result');
    // 세로 화면은 전투 진입 때 '가로로 돌려주세요' 안내가 다시 뜬다 → 사용자처럼 '세로로 계속하기'.
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    // 첫 클리어 토스트(결과가 뜬 뒤 1.8초)를 기다렸다가 위치를 잰다.
    const toastSeen = await page.waitForFunction(() => [...document.querySelectorAll('#toast-layer .toast')].some((t) => t.textContent.includes('첫 클리어')), null, { timeout: 6000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(250);
    row.toast = await page.evaluate(`(() => { const ov = ${overlapJs}; const R = (s) => document.querySelector(s)?.getBoundingClientRect() || null;
      const toasts = [...document.querySelectorAll('#toast-layer .toast')].map((t) => ({ text: t.textContent.trim(), r: t.getBoundingClientRect().toJSON() }));
      const keys = { title: '#result-title', stars: '#result .stars', cards: '#result-cards', chips: '#result-cards + *', shop: '#result-shop', use: '#result .result-use:not([hidden])', btns: '#result .result-btns' };
      return toasts.map((t) => ({ text: t.text, rect: t.r, overlap: Object.fromEntries(Object.entries(keys).map(([k, s]) => [k, Math.round(ov(t.r, R(s)))])) }));
    })()`);
    row.toastSeen = toastSeen;
    await page.screenshot({ path: path.join(out, `${tag}-1-toast.png`) });
    // 카드 고르기
    await page.waitForSelector('#result-cards .cl-card', { timeout: 15000 });
    await page.waitForTimeout(2200);
    // 수리 화면을 찍으려고 '정비 쿠폰'(무료 수리)이 아닌 카드를 고른다. 쿠폰 카드가 나왔는지는 기록한다.
    const pick = await page.evaluate(() => { const cc = window.app.eco.s.clearCard; const kinds = cc?.cards.map((c) => c.kind) || []; const i = kinds.findIndex((k) => k !== 'repair'); return { kinds, index: Math.max(0, i) }; });
    row.cards = pick;
    await page.locator('#result-cards .cl-card').nth(pick.index).click({ force: true });
    await page.waitForTimeout(1500);
    await page.locator('#result-shop:not([hidden])').waitFor({ timeout: 10000 }).catch(() => {});
    await page.locator('#result-shop').scrollIntoViewIfNeeded().catch(() => {});
    const repairBefore = await page.evaluate(() => {
      const r = document.querySelector('#result-shop .cl-repair'), b = r?.querySelector('[data-act="repair"]');
      const a = window.app, e = a.eco, uid = e.hero('knight').equip.weapon, inst = e.s.inventory.find((x) => x.uid === uid);
      return { text: r?.innerText.replace(/\s+/g, ' ').trim() || null, button: b ? { text: b.innerText.trim(), disabled: b.disabled } : null, dur: inst?.dur ?? 100, gold: e.s.gold };
    });
    await page.locator('#result-shop .cl-repair').screenshot({ path: path.join(out, `${tag}-2-repair-before.png`) }).catch(() => {});
    await page.screenshot({ path: path.join(out, `${tag}-2-shop.png`) });
    if (repairBefore.button && !repairBefore.button.disabled) {
      await page.locator('#result-shop [data-act="repair"]').click({ force: true });
      await page.waitForTimeout(600);
    }
    const repairAfter = await page.evaluate(() => {
      const r = document.querySelector('#result-shop .cl-repair'), b = r?.querySelector('[data-act="repair"]');
      const e = window.app.eco, uid = e.hero('knight').equip.weapon, inst = e.s.inventory.find((x) => x.uid === uid);
      return { text: r?.innerText.replace(/\s+/g, ' ').trim() || null, button: b ? { text: b.innerText.trim(), disabled: b.disabled } : null, dur: inst?.dur ?? 100, gold: e.s.gold };
    });
    row.repair = { before: repairBefore, after: repairAfter };
    await page.locator('#result-shop .cl-repair').screenshot({ path: path.join(out, `${tag}-3-repair-after.png`) }).catch(() => {});
    // 넘침 측정: 정비소 버튼 글자가 버튼 밖으로 나가는지
    row.shopOverflow = await page.evaluate(() => [...document.querySelectorAll('#result-shop button')].filter((b) => b.offsetParent && (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1)).map((b) => b.innerText.trim()));
    // 전승
    const tbtn = page.locator('#result-shop [data-act="transfer"]').first();
    if (await tbtn.count()) {
      await tbtn.click({ force: true });
      await page.waitForSelector('.enh-transfer', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      const sheet = () => page.evaluate(() => {
        const box = document.querySelector('.enh-transfer'); if (!box) return null;
        const over = [...box.querySelectorAll('*')].filter((n) => n.offsetParent && n.children.length === 0 && n.textContent.trim() && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible').map((n) => n.textContent.trim().slice(0, 40));
        const br = box.getBoundingClientRect();
        return { src: box.querySelectorAll('[data-src]').length, dst: box.querySelectorAll('[data-dst]').length, go: !!box.querySelector('#et-go:not([disabled])'), text: box.innerText.replace(/\s+/g, ' ').slice(0, 300), clipped: over, outOfView: br.right > innerWidth + 1 || br.left < -1 };
      });
      row.transfer = { opened: await sheet() };
      await page.screenshot({ path: path.join(out, `${tag}-4-transfer-sheet.png`) });
      if (doTransfer && seedGear && row.transfer.opened) {
        const src = page.locator('.enh-transfer [data-src]').first();
        if (await src.count() && !(await page.locator('#et-go:not([disabled])').count())) { await src.click(); await page.waitForTimeout(300); }
        const before = await page.evaluate(() => window.app.eco.s.inventory.filter((x) => x.owner === 'knight').map((x) => ({ uid: x.uid, enh: x.enh || 0 })));
        if (await page.locator('#et-go:not([disabled])').count()) {
          await page.locator('#et-go').click(); await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${tag}-5-transfer-confirm.png`) });
          await page.locator('#et-yes').click(); await page.waitForTimeout(900);
        }
        const after = await page.evaluate(() => window.app.eco.s.inventory.filter((x) => x.owner === 'knight').map((x) => ({ uid: x.uid, enh: x.enh || 0 })));
        const changed = after.filter((x) => (before.find((y) => y.uid === x.uid)?.enh ?? -1) !== x.enh).map((x) => ({ uid: x.uid, from: before.find((y) => y.uid === x.uid)?.enh, to: x.enh }));
        row.transfer.done = { changed, sheet: await sheet() };
        await page.screenshot({ path: path.join(out, `${tag}-6-transfer-done.png`) });
      }
    } else row.transfer = { opened: null, reason: 'no transfer button' };
    await context.close();
  }
} finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); server?.httpServer.close();
}
console.log(JSON.stringify(report, null, 1));
