// 아이템 상세 시트: "강화하기" 버튼이 하단 고정 버튼 줄(판매·금고·장착)에 가려지지 않는지 네 화면 크기에서 측정한다.
// 사용: bun run dev 를 띄운 뒤 node tools/qa/item-sheet-overlap.mjs [--origin=http://127.0.0.1:5173] [--out=work/qa/ch2-entry]
// 합격: 강화하기 rect 와 고정 버튼 줄 rect 의 교집합 0, 강화하기가 뷰포트 안(스크롤 없이) 에 완전히 보임.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const arg = (k, d) => process.argv.find((v) => v.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ORIGIN = arg('origin', 'http://127.0.0.1:5173');
const OUT = path.resolve(arg('out', 'work/qa/ch2-entry'));
const THREADS_UA = 'Mozilla/5.0 (Linux; Android 15; SM-S948N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36 Barcelona 390.0.0.28.85 Android (35/15; 450dpi; 1080x2340; samsung; SM-S948N; e3q; qcom; ko_KR; 812345678)';
const ALL = [[360, 640], [390, 700], [844, 390], [667, 375]];
const only = arg('sizes', '');   // 예: --sizes=390x700,360x640
const SIZES = only ? ALL.filter(([w, h]) => only.split(',').includes(`${w}x${h}`)) : ALL;
const r = (b) => b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.y), bottom: Math.round(b.y + b.height) };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launchOpts());
const rows = []; let failed = false;
try {
  // 부팅이 느려(소프트웨어 GL) 한 번만 부팅하고 화면 크기만 바꿔 가며 같은 시트를 다시 연다.
  const ctx = await browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: THREADS_UA });
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
  // 시트 높이가 가장 큰 경우: 가방(미착용) 장비 + 착용 중 장비 비교, 골드·강화석·주문서가 충분해 강화 칸이 모두 켜진 상태. 상태 준비만 게임 규칙(eco)으로 하고 시트는 실제 탭으로 연다.
  const info = await page.evaluate(() => {
    const eco = window.app.eco, s = eco.s;
    s.gold = Math.max(s.gold, 500000); s.stones = Math.max(s.stones || 0, 200); s.bless = Math.max(s.bless || 0, 3); s.protect = Math.max(s.protect || 0, 3);
    const worn = eco.addItem('rare', 'weapon'), spare = eco.addItem('epic', 'weapon');
    eco.equip(s.selected, worn?.uid ?? worn);
    return { uid: (spare?.uid ?? spare) ?? null };
  });
  if (info.uid === null) throw new Error('가방 장비 지급 실패');
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { document.querySelector('#modal.show #i-close')?.click(); window.app.meta.openTab('heroes'); });
    await page.waitForTimeout(1200);
    const cell = page.locator(`[data-inv="${info.uid}"]`).first();
    await cell.scrollIntoViewIfNeeded().catch(() => {});
    await cell.tap({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('#e-go', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const o = (b) => b && { x: b.x, y: b.y, width: b.width, height: b.height };
      const go = document.querySelector('#e-go'), actions = document.querySelector('.is-actions');
      const btns = [...document.querySelectorAll('.is-actions button')].map((b) => ({ id: b.id, ...o(b.getBoundingClientRect()) }));
      const body = document.querySelector('.is-body');
      return { go: o(go?.getBoundingClientRect()), actions: o(actions?.getBoundingClientRect()), btns, vh: innerHeight, vw: innerWidth,
        body: o(body?.getBoundingClientRect()), bodyScroll: body ? { top: body.scrollTop, h: body.scrollHeight, c: body.clientHeight } : null };
    });
    const go = r(m.go), actions = r(m.actions), btns = m.btns.map((b) => ({ id: b.id, ...r(b) })), body = r(m.body);
    const overlapActions = go && actions ? inter(go, actions) : -1;
    const overlapBtns = go ? Math.max(0, ...btns.map((b) => inter(go, b))) : -1;
    // 뷰포트 안(스크롤 없이) 완전히 보이고, 스크롤 영역(.is-body) 안에서도 잘리지 않아야 한다.
    const inside = !!go && go.top >= 0 && go.bottom <= m.vh && go.x >= 0 && go.x + go.w <= m.vw && !!body && go.top >= body.top && go.bottom <= body.bottom;
    const ok = !!go && overlapActions === 0 && overlapBtns === 0 && inside;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(OUT, `item-sheet-${width}x${height}.png`) });
    rows.push({ size: `${width}x${height}`, go, actions, btns, body, overlapActions, overlapBtns, inside, scroll: m.bodyScroll, ok });
    console.log(`[${width}x${height}] ${ok ? 'OK' : 'FAIL'} 강화하기 y ${go?.top}~${go?.bottom} / 고정 줄 y ${actions?.top}~${actions?.bottom} / 스크롤 영역 y ${body?.top}~${body?.bottom} · 교집합 ${overlapActions}/${overlapBtns} · 뷰포트·스크롤영역 안 ${inside} · 스크롤 ${JSON.stringify(m.bodyScroll)}`);
  }
  await ctx.close();
} finally {
  await browser.close();
  await fs.writeFile(path.join(OUT, 'item-sheet-overlap.json'), JSON.stringify(rows, null, 2));
}
process.exit(failed ? 1 : 0);
