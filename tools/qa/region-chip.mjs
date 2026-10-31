// 로비 좌상단 'REGION 0N' 칩: 네 화면 크기에서 글자가 한 줄인지, 다른 로비 요소와 겹치지 않는지 측정한다.
// 사용: npx vite --host 127.0.0.1 --port 5197 --strictPort 를 띄운 뒤
//       node tools/qa/region-chip.mjs [--origin=http://127.0.0.1:5197] [--out=work/qa/region-chip] [--sizes=390x700,360x640]
// 합격: 칩 안 REGION 글자 줄 수 1, 칩 높이 <= 한 줄 높이 기준(작은 글자 줄 + 이름 줄 + 패딩 = 56px 이하), 다른 요소와 교집합 0.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const arg = (k, d) => process.argv.find((v) => v.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ORIGIN = arg('origin', 'http://127.0.0.1:5197');
const OUT = path.resolve(arg('out', 'work/qa/region-chip'));
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Barcelona 352.0.0.0';
const ALL = [[360, 640], [390, 700], [844, 390], [667, 375]];
const only = arg('sizes', '');
const SIZES = only ? ALL.filter(([w, h]) => only.split(',').includes(`${w}x${h}`)) : ALL;
const MAX_CHIP_H = 56;

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launchOpts());
const rows = []; let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: UA });
  await installAutoStarter(ctx);
  const page = await ctx.newPage();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.app?.mode === 'lobby').catch(() => false)) break;
    const st = page.locator('#boot-start:not(.hidden)'); if (await st.isVisible().catch(() => false)) await st.tap().catch(() => {});
    const g = page.getByRole('button', { name: '게스트로 시작' }); if (await g.isVisible().catch(() => false)) await g.tap().catch(() => {});
    const rot = page.locator('#btn-ignore-rotate'); if (await rot.isVisible().catch(() => false)) await rot.tap().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.app.ui.closeModal?.(); window.app.meta.openTab('home'); });
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(1500);
    const rot = page.locator('#btn-ignore-rotate'); if (await rot.isVisible().catch(() => false)) { await rot.tap().catch(() => {}); await page.waitForTimeout(600); }
    const m = await page.evaluate(() => {
      const chip = document.getElementById('campaign-town-chip');
      if (!chip || chip.hidden) return null;
      const o = (b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
      const tag = chip.querySelector('small');
      const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size; };
      const menu = document.getElementById('campaign-town-menu');
      const vw = innerWidth, vh = innerHeight;
      const others = [];
      for (const el of document.querySelectorAll('#meta *')) {
        if (chip.contains(el) || el.contains(chip) || menu?.contains(el) || el === menu) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || el.closest('[hidden]')) continue;
        if (el.children.length && !['BUTTON'].includes(el.tagName)) continue; // 잎 요소와 버튼만
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4 || b.width * b.height > vw * vh * 0.4) continue;
        others.push({ el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`, ...o(b) });
      }
      return { vw, vh, chip: o(chip.getBoundingClientRect()), tag: o(tag.getBoundingClientRect()), tagLines: lines(tag), nameLines: lines(chip.querySelector('b')), others };
    });
    if (!m) { rows.push({ size: `${width}x${height}`, error: 'chip 없음/숨김' }); failed = true; continue; }
    const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const hits = m.others.map((e) => ({ el: e.el, area: +inter(m.chip, e).toFixed(1) })).filter((h) => h.area > 0);
    const overlap = +hits.reduce((s, h) => s + h.area, 0).toFixed(1);
    const ok = m.tagLines === 1 && m.nameLines === 1 && m.chip.h <= MAX_CHIP_H && overlap === 0 && m.chip.x >= 0 && m.chip.x + m.chip.w <= m.vw;
    if (!ok) failed = true;
    const size = `${width}x${height}`;
    await page.screenshot({ path: path.join(OUT, `${size}.png`) });
    rows.push({ size, ok, chip: m.chip, tagLines: m.tagLines, nameLines: m.nameLines, overlap, hits });
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(rows, null, 2));
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
