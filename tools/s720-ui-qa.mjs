// 720시간 콘텐츠 UI(전설 수련 판 · 고통 단계 선택 · 결과 띠 · 장비 접두) 실제 입력 QA.
// 사용법: node tools/s720-ui-qa.mjs [origin=http://127.0.0.1:5391/] [out=work/qa/s720-ui] [--sizes=844x390,640x360,1280x720] [--only=a,b]
// 저장 주입: 지옥 1지역 클리어 · 영웅 Lv.80 · 전설 점수 있음 · 고통 최고 T2(해금 T3). 이후 모든 조작은 실제 탭/클릭 입력이다.
//   ① 관문 선택 → 고통 선택 → T1 → 출격 → 결과(고통 단계 띠)
//   ② 영웅 → 전설 수련 → 노드 찍기(+1 · +5 · 최대) → 재분배(앱 내 확인)
//   ③ 장비 접두(인벤토리 · 비교 시트) · 잠금 사유 · 서버 권위 잠금
// 캡처는 work/qa/s720-ui/<크기>/ 에 남기고 커밋하지 않는다. viewport/터치 에뮬 + SwiftShader 관측이며 실기기·GPU 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';
import { SCENARIOS } from './s720-ui-scenarios.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5391/', out = path.resolve(positional[1] || 'work/qa/s720-ui');
const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=')[1];
const SIZES = (flag('sizes') || '844x390,640x360,1280x720').split(',').map((s) => { const [width, height] = s.split('x').map(Number); return { id: s, width, height }; });
const only = flag('only')?.split(',') || null;
const report = { started: new Date().toISOString(), origin, note: 'Seeded save (hell region 1 cleared, hero Lv.80, legend points) then native tap/click input. Viewport emulation + SwiftShader; not physical-device evidence.', sizes: [] };
const failures = [];
const browser = await chromium.launch(launchOpts());

/** 부팅 직후 로비에서 한 번 주입하는 저장 상태(규칙 코드는 건드리지 않고 저장 값만 채운다). */
const SEED = () => {
  const eco = window.app.eco, s = eco.s, id = s.selected;
  s.progress.unlocked = 12;
  s.progress.stars = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`1-${i + 1}`, 3]));
  s.progress.difficulty = 'story';
  s.endgame = { ...(s.endgame || {}), peak: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`1-${i + 1}`, 3])), torment: { best: 2, today: { day: 0, runs: 0 } } };
  s.heroes[id].level = 80; s.heroes[id].exp = 0;
  s.legend = { version: 1, rank: 12, exp: 4000000, points: 0, nodes: { blade_edge: 5, wall_bulk: 3 } };
  s.gold = 9000000; s.energy = Math.max(s.energy, 60);
  eco.save(); eco.emit(); localStorage.removeItem('blade-surge.stage-select.v1');
  window.app.stageSelect.memory = { introSeen: true, last: null };
  return { hero: id, rank: s.legend.rank };
};

try {
  for (const size of SIZES) {
    const dir = path.join(out, size.id); await fs.mkdir(dir, { recursive: true });
    const touch = size.width < 1000;
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const row = { id: size.id, checks: [], errors: [], shots: [] }; report.sizes.push(row);
    page.on('pageerror', (e) => row.errors.push(String(e)));
    // 로컬 vite 에는 Worker API(/api/*)가 없어 404 가 난다(기존 동작). 그 밖의 오류만 센다.
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) row.errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) row.errors.push(`HTTP ${r.status()} ${r.url()}`); });
    const check = (name, ok, detail) => { row.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(`${size.id}: ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`); };
    const settle = (ms = 300) => page.waitForTimeout(ms);
    const act = async (selector) => {
      const target = page.locator(selector).first();
      try { await (touch ? target.tap({ timeout: 15000 }) : target.click({ timeout: 15000 })); }
      catch (error) {
        const box = await target.boundingBox(); if (!box) throw error;
        row.inputFallbacks = (row.inputFallbacks || 0) + 1;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      }
    };
    const shot = async (name) => { const file = path.join(dir, `${name}.png`); await page.screenshot({ path: file, timeout: 120000 }); row.shots.push(file); return file; };
    const dismissRotate = async () => { const b = page.locator('#rotate-hint #btn-ignore-rotate'); if (await b.isVisible().catch(() => false)) { await act('#rotate-hint #btn-ignore-rotate'); await settle(200); } };
    const closeModals = async () => { for (let n = 0; n < 5; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible().catch(() => false)) break; await act('#modal.show #m-cancel'); await settle(250); } };
    /** 요소들이 화면 안에 있고 서로 겹치지 않는지, 터치 대상이 44px 이상인지. */
    const layout = (rootSel, ignore = '') => page.evaluate(([root, skip]) => {
      const host = document.querySelector(root); if (!host) return { missing: true };
      const rect = (n) => n.getBoundingClientRect();
      const visible = (n) => { const r = rect(n); const st = getComputedStyle(n); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
      const buttons = [...host.querySelectorAll('button')].filter(visible).filter((b) => !skip || !b.matches(skip));
      const out = buttons.filter((b) => { const r = rect(b); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; }).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24));
      const small = buttons.filter((b) => { const r = rect(b); return r.height < 43.5 || r.width < 43.5; }).map((b) => ({ t: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), w: Math.round(rect(b).width), h: Math.round(rect(b).height) }));
      // 같은 부모 줄의 버튼끼리 겹침
      const overlaps = [];
      for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
        const a = rect(buttons[i]), b = rect(buttons[j]);
        if (buttons[i].contains(buttons[j]) || buttons[j].contains(buttons[i])) continue;
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps.push([(buttons[i].textContent || '').trim().slice(0, 14), (buttons[j].textContent || '').trim().slice(0, 14)]);
      }
      // 텍스트가 잘리는 요소(자식 넘침)
      const clipped = [...host.querySelectorAll('*')].filter((n) => visible(n) && n.children.length === 0 && n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflow !== 'visible' && getComputedStyle(n).textOverflow !== 'ellipsis' && n.clientWidth > 0).map((n) => (n.textContent || '').trim().slice(0, 20));
      const hr = rect(host);
      return { out, small, overlaps, clipped, hostInView: hr.left >= -1 && hr.top >= -1 && hr.right <= innerWidth + 1 && hr.bottom <= innerHeight + 1, overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, count: buttons.length };
    }, [rootSel, ignore]);
    const ctx = { page, row, size, dir, touch, check, settle, act, shot, layout, closeModals, dismissRotate, SEED };
    try {
      await installAutoStarter(page);
      await page.goto(origin);
      await settle(400); await dismissRotate();
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
      await dismissRotate(); await act('#boot-start');
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show') && window.app.oathShell, undefined, { timeout: 180000 });
      await settle(1500); await dismissRotate(); await closeModals(); await settle(400);
      const seeded = await page.evaluate(SEED);
      check('저장 주입(Lv.80 · 전설 12단계 · 지옥 1지역 클리어)', seeded.rank === 12, seeded);
      await settle(400);
      for (const scenario of SCENARIOS) {
        if (only && !only.includes(scenario.id)) continue;
        try { await scenario.run(ctx); } catch (error) { row.fatal = (row.fatal ? row.fatal + '\n' : '') + `${scenario.id}: ${String(error?.stack || error)}`; failures.push(`${size.id}: ${scenario.id} fatal ${error?.message}`); await shot(`99-fatal-${scenario.id}`).catch(() => {}); }
      }
      check('콘솔 오류 0', row.errors.length === 0, row.errors.slice(0, 5));
    } catch (error) {
      row.fatal = String(error?.stack || error);
      failures.push(`${size.id}: fatal ${error?.message}`);
      await shot('99-fatal').catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
}
report.failures = failures;
report.finished = new Date().toISOString();
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures, sizes: report.sizes.map((p) => ({ id: p.id, pass: p.checks.filter((c) => c.ok).length, total: p.checks.length, fatal: p.fatal ? p.fatal.slice(0, 400) : undefined })) }, null, 2));
process.exit(failures.length ? 1 : 0);

