// 현상금 의뢰판 실제 화면 확인: 1-10 클리어 저장 → 메뉴 → 의뢰판 → 출발(에너지 0) → 전투 시작 화면 → (선택) 승리 정산.
// 사용법: node tools/bounty-qa.mjs [origin=http://127.0.0.1:5173/] [out=work/cycles/3m-day1]
// 이 결과는 viewport/터치 에뮬과 소프트웨어 렌더 관측이며 물리 기기·GPU 프레임 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const args = process.argv.slice(2);
const origin = args[0] || 'http://127.0.0.1:5173/', out = path.resolve(args[1] || 'work/cycles/3m-day1');
await fs.mkdir(out, { recursive: true });
const KEY = 'bladesurge_save_v1';
const stars = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`1-${i + 1}`, 3]));
const seed = { progress: { unlocked: 11, stars, difficulty: 'story' }, heroes: { knight: { level: 30 } }, tutorial: { completed: true }, energy: 0 };
const report = { origin, checks: [], shots: [], errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };

const browser = await chromium.launch(launchOpts());
async function run(label, vp, mobile) {
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'ko-KR', serviceWorkers: 'block' });
  await context.addInitScript(([key, data]) => { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } }, [KEY, seed]);
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(label + ': ' + String(e).slice(0, 300)));
  const shot = async (n) => { const f = `bounty-${n}.png`; await page.screenshot({ path: path.join(out, f), timeout: 120000 }); report.shots.push(f); };
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
  await page.waitForTimeout(1500);
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
  await page.evaluate(() => { const h = document.getElementById('rotate-hint'); if (h) h.style.display = 'none'; });
  for (let n = 0; n < 4; n++) { if (!await page.locator('#modal.show #m-cancel').isVisible().catch(() => false)) break; await page.locator('#modal.show #m-cancel').click(); await page.waitForTimeout(300); }
  const sum = await page.evaluate(() => window.app.eco.bountySummary());
  check(`${label} board open`, sum.open && sum.available >= 8, sum);
  // 메뉴 → 현상금 의뢰판 (실제 입력)
  await page.locator('#meta .oath-nav-menu').click(); await page.waitForTimeout(500);
  const entry = page.locator('#oath-menu #menu-bounty'); check(`${label} menu entry`, await entry.count() === 1);
  await entry.click(); await page.waitForTimeout(800);
  check(`${label} dialog open`, await page.evaluate(() => document.getElementById('bounty')?.open === true));
  await shot(`board-${label}`);
  const m = await page.evaluate(() => {
    const d = document.getElementById('bounty'); const r = d.getBoundingClientRect();
    const btns = [...d.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, minBtnH: Math.min(...btns.map((b) => b.height)), hScroll: d.scrollWidth > d.clientWidth + 1, rows: d.querySelectorAll('.bounty-row').length };
  });
  check(`${label} fits viewport and 44px targets`, m.w <= m.vw && m.minBtnH >= 43.5 && !m.hScroll, m);
  // 상인 탭
  await page.locator('#bounty [data-control="tab-shop"]').click(); await page.waitForTimeout(300); await shot(`shop-${label}`);
  await page.locator('#bounty [data-control="tab-board"]').click(); await page.waitForTimeout(300);
  // 출발: 에너지 0 이어도 시작
  const before = await page.evaluate(() => ({ energy: window.app.eco.s.energy, stars: JSON.stringify(window.app.eco.s.progress.stars) }));
  await page.locator('#bounty .bounty-go').first().click();
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle.active, undefined, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({ mode: window.app.mode, active: window.app.battle.active, bounty: window.app.battle.stage?.bounty?.id, energy: window.app.eco.s.energy, dialogOpen: document.getElementById('bounty').open }));
  check(`${label} battle started with energy 0`, st.mode === 'battle' && st.active && !!st.bounty && st.energy === before.energy && !st.dialogOpen, st);
  await shot(`battle-${label}`);
  // 정산(승리 결과를 주입하는 대신 UI 가 부르는 경로를 그대로: 결과 객체로 showResult)
  const settled = await page.evaluate(() => {
    const b = window.app.battle; b.active = false;
    b.result = { win: true, stars: 3, time: 90, maxCombo: 50, revives: 0, kills: 10, hpLost: 0, fullClear: false };
    b.ui.showResult(b, true);
    return true;
  });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(() => ({ line: document.querySelector('.bounty-result')?.textContent || null, completed: window.app.eco.bountySummary().completed, marks: window.app.eco.s.bounty.marks, retry: document.getElementById('btn-result-retry').textContent, rect: (() => { const r = document.querySelector('.bounty-result')?.getBoundingClientRect(); return r && [Math.round(r.top), Math.round(r.height)]; })() }));
  check(`${label} result settles once`, settled && res.completed === 1 && !!res.line, res);
  await shot(`result-${label}`);
  await context.close();
}
try {
  await run('390x700', { width: 390, height: 700 }, true);
  await run('360x640', { width: 360, height: 640 }, true);
  await run('1280x800', { width: 1280, height: 800 }, false);
} finally { await browser.close(); }
check('no page errors', report.errors.length === 0, report.errors);
await fs.writeFile(path.join(out, 'bounty-qa.json'), JSON.stringify(report, null, 1));
process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
