// 조준 중 취소 버튼(#skill-aim-cancel) 겹침 실측: 실제 전투 화면에서 실제 CDP 터치로 스킬 버튼을 끌어 취소 버튼을 띄운 채
// 보이는 모든 글자(텍스트 노드) 사각형과 HUD 카드(#hud 직계 자식·퀘스트 카드) 사각형이 취소 버튼 사각형과 겹치는지 센다.
// 취소 버튼이 컨트롤(스킬 버튼·조이스틱)을 만나지 않는지도 함께 기록한다. 개발 서버 전용 import 없이 정식 빌드에서도 돈다.
// 사용: node tools/aim-cancel-overlap-qa.mjs <origin> [출력폴더] [뷰포트목록 1280x590,844x390,800x360]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = (process.argv[2] || 'http://127.0.0.1:5197').replace(/\/$/, '');
const out = path.resolve(process.argv[3] || 'work/cycles/20261019-aim-envelope-ui/qa-cancel');
const views = (process.argv[4] || '1280x590,844x390,800x360').split(',').map(v => v.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const rows = []; let pass = true;
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  await page.evaluate(async () => { app.ui.closeModal?.(); app.eco.s.energy = 100; if (!await app.startStage(app.eco.nextStage())) throw Error('stage start failed'); app.companionAgent?.endBattle?.(); });
  await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const row = { viewport: w + 'x' + h, errors };
  try {
    await page.evaluate(() => { const p = app.battle.player; p.auto = false; p.invuln = 1e6; p.cds.fill(0); p.mp = p.maxMp; app.input.clear(); });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const s0 = await page.evaluate(() => { const b = document.querySelector('.skill-btn[data-skill="0"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await touch('touchStart', [{ id: 7, x: s0.x, y: s0.y }]); await touch('touchMove', [{ id: 7, x: s0.x - 40, y: s0.y - 30 }]); await touch('touchMove', [{ id: 7, x: s0.x - 80, y: s0.y - 60 }]);
    await page.waitForTimeout(350);
    const hit = await page.evaluate(() => {
      const cancel = document.getElementById('skill-aim-cancel'), cb = cancel.getBoundingClientRect();
      const on = cancel.classList.contains('on');
      const shown = el => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < .05) return false; } return true; };
      const meets = r => r.width > 0 && r.height > 0 && r.left < cb.right && r.right > cb.left && r.top < cb.bottom && r.bottom > cb.top;
      const box = r => [r.left, r.top, r.right, r.bottom].map(Math.round);
      const texts = [], cards = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.trim()) continue; const el = n.parentElement;
        if (!el || cancel.contains(el) || !shown(el) || !document.getElementById('hud')?.contains(el)) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (meets(r)) { texts.push({ text: n.nodeValue.trim().slice(0, 24), owner: el.id || String(el.className).slice(0, 40), r: box(r) }); break; }
      }
      for (const el of document.querySelectorAll('#hud > *')) {
        if (el === cancel || cancel.contains(el) || el.contains(cancel) || el.tagName === 'CANVAS' || !shown(el)) continue;
        const cs = getComputedStyle(el); if (cs.pointerEvents === 'none' && !(el.textContent || '').trim()) continue;
        const r = el.getBoundingClientRect();
        if (!meets(r) || !(el.textContent || '').trim()) continue;
        // 카드의 글자가 아닌 투명 컨테이너는 글자 겹침으로 따로 센다. 배경이 있는 카드만 카드 겹침으로 센다.
        const bg = cs.backgroundColor, hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' || cs.backgroundImage !== 'none' || +cs.borderTopWidth > 0;
        if (hasBg) cards.push({ id: el.id || String(el.className).slice(0, 40), r: box(r) });
      }
      const controls = [...document.querySelectorAll('.skill-btn, #joy, .joy-base, .attack-btn, .dodge-btn')].filter(shown).filter(el => meets(el.getBoundingClientRect())).map(el => el.id || String(el.className).slice(0, 40));
      const quest = document.querySelector('#objective, .quest-card, .stage-objective'); const q = quest && shown(quest) ? box(quest.getBoundingClientRect()) : null;
      return { on, cancel: box(cb), vw: innerWidth, vh: innerHeight, texts, cards, controls, objective: q };
    });
    await page.screenshot({ path: path.join(out, 'cancel-' + w + 'x' + h + '.png') });
    await touch('touchEnd', []);
    row.hit = hit; row.overlaps = hit.texts.length + hit.cards.length; row.ok = hit.on && row.overlaps === 0 && hit.controls.length === 0;
  } catch (e) { row.failure = String(e.message || e); row.ok = false; }
  if (!row.ok || errors.length) pass = false;
  rows.push(row); await ctx.close();
}
await browser.close();
const report = { scope: '로컬 개발 서버, 격리 Chromium 모바일 터치(CDP), 실제 마크업과 전투 루프. 글자 사각형(Range) 및 배경이 있는 HUD 카드와 취소 버튼 사각형의 교차 수. 실기기 아님.', origin, pass, rows };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass, rows: rows.map(r => ({ v: r.viewport, on: r.hit?.on, cancel: r.hit?.cancel, overlaps: r.overlaps, texts: r.hit?.texts, cards: r.hit?.cards, controls: r.hit?.controls, objective: r.hit?.objective, failure: r.failure, errors: r.errors.slice(0, 2) })) }, null, 1));
if (!pass) process.exitCode = 1;
