// 첫 전투 튜토리얼 카드·접힘 버튼이 상단 HUD 와 겹치는지 rect 로 측정한다(겹침 0 이 합격).
// 사용: node tools/qa/tutorial-hud-overlap.mjs [--origin=http://127.0.0.1:5199]
import { chromium } from 'playwright';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const arg = (k, d) => process.argv.find(v => v.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ORIGIN = arg('origin', 'http://127.0.0.1:5199');
const VIEWS = [[390, 700], [360, 640], [844, 390], [667, 375]];
const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

const browser = await chromium.launch(launchOpts());
let bad = 0;
for (const [width, height] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await installAutoStarter(ctx);
  const page = await ctx.newPage();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show')).catch(() => false)) break;
    for (const sel of ['#btn-ignore-rotate', '#boot-start:not(.hidden)']) await page.locator(sel).tap({ timeout: 800 }).catch(() => {});
    await page.getByRole('button', { name: '게스트로 시작' }).tap({ timeout: 800 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // 로비 도착 직후 뜨는 가로 전환 안내(세로 화면만)를 기다렸다가 닫는다.
  if (width < height) {
    for (let k = 0; k < 8; k++) {
      if (!(await page.evaluate(() => document.body.classList.contains('force-landscape')))) break;
      if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  await page.locator('#citadel-dungeon-prepare').tap();
  await page.waitForTimeout(1500);
  await page.locator('#stage-select-enter').tap();
  await page.waitForFunction(() => window.app.battle?.active && window.app.battle.elapsed > .3 && !document.querySelector('#battle-tutorial')?.hidden, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  // 접힘·펼침 두 상태 모두 측정한다.
  for (const state of ['펼침', '접힘']) {
    const toggle = page.locator('#battle-tutorial .tutorial-toggle');
    const expanded = (await toggle.getAttribute('aria-expanded').catch(() => null)) === 'true';
    if ((state === '펼침') !== expanded) { await toggle.tap({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
    const res = await page.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const vis = e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 4 && r.height > 4 && +s.opacity > 0.05; };
      const tut = document.querySelector('#battle-tutorial');
      const mine = [...tut.querySelectorAll('.tutorial-card, .tutorial-toggle')].filter(vis);
      const others = [...document.querySelectorAll('#hud *')].filter(e => !tut.contains(e) && e !== tut && vis(e) && e.children.length === 0 && e.id !== 'dmg-layer' && !e.classList.contains('neb-tag') && !(e.getBoundingClientRect().width * e.getBoundingClientRect().height > 0.4 * innerWidth * innerHeight));
      const hits = [];
      for (const m of mine) for (const o of others) {
        const a = box(m), b = box(o);
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) hits.push({ tut: m.className, hud: `${o.tagName.toLowerCase()}#${o.id || ''}.${String(o.className).split(' ')[0]}`, text: (o.innerText || '').slice(0, 12) });
      }
      return { mine: mine.length, hits };
    });
    bad += res.hits.length;
    console.log(`${width}x${height} ${state}: 튜토리얼 요소 ${res.mine} · 겹침 ${res.hits.length}`);
    for (const h of res.hits.slice(0, 8)) console.log(`   - ${h.tut} ↔ ${h.hud} "${h.text}"`);
    await page.screenshot({ path: `work/qa/tut-${width}x${height}-${state}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `겹침 합계 ${bad} — 실패` : '겹침 0 — 통과');
process.exit(bad ? 1 : 0);
