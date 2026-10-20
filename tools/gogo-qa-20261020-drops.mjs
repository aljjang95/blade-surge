// 사이클 20261020-drops-region-party-sfx 브라우저 QA(UI 레인 A2·A4·A6). 실제 개발 서버·실제 터치 입력으로 검증한다.
// 사용: node tools/gogo-qa-20261020-drops.mjs --origin http://127.0.0.1:5371/ --out <evidence 폴더> [--only A2,A4,A6] [--gl swift]
// 규칙: 상태 준비(재화·영웅 레벨·진행도·전투 픽스처)는 주입하고 보고서에 injected 로 남긴다.
//       하단 탭·메뉴 버튼·캠페인 칸·난이도 카드·결과/전리품 카드·장착/판매/강화 버튼은 모두 Playwright 터치(locator.tap())다.
//       src/ 는 수정하지 않는다. 결과는 <out>/<id>.json 과 캡처 png, summary.json 이다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const origin = arg('origin', 'http://127.0.0.1:5371/');
const out = path.resolve(arg('out', 'work/qa/gogo-20261020-drops'));
const only = arg('only') ? arg('only').split(',').map((s) => s.trim().toUpperCase()) : null;
const VIEW = { width: 844, height: 390 }, WIDE = { width: 1280, height: 590 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(out, { recursive: true });

// ---------- 공용 겹침 검사 ----------
// 두 요소의 boundingBox 교차 면적이 0 보다 크면 겹친 것이다(visible 검사만으로는 잡지 못한다).
export function rectOverlap(a, b) {
  if (!a || !b) return { overlap: false, area: 0, reason: 'missing-box' };
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const area = w > 0 && h > 0 ? w * h : 0;
  return { overlap: area > 0.5, area: Math.round(area * 10) / 10 };
}
// 선택자 목록 → 보이는 요소의 boundingBox. 같은 선택자가 여러 개면 모두 돌려준다.
async function boxesOf(page, sel) {
  const loc = page.locator(sel), n = await loc.count(), list = [];
  for (let i = 0; i < n; i++) { const e = loc.nth(i); if (!await e.isVisible().catch(() => false)) continue; const box = await e.boundingBox(); if (box) list.push({ sel, i, box }); }
  return list;
}
// pairs: [[selA, selB], ...]  각 쌍의 모든 요소 조합을 검사해 겹친 조합을 돌려준다.
async function overlapReport(page, pairs) {
  const found = [], checked = [];
  for (const [a, b] of pairs) {
    const A = await boxesOf(page, a), B = await boxesOf(page, b);
    checked.push({ a, b, countA: A.length, countB: B.length });
    for (const x of A) for (const y of B) { if (x.sel === y.sel && x.i === y.i) continue; const r = rectOverlap(x.box, y.box); if (r.overlap) found.push({ a, ai: x.i, b, bi: y.i, area: r.area, boxA: x.box, boxB: y.box }); }
  }
  return { found, checked };
}
// 화면 밖으로 잘림: 요소가 뷰포트 안에 완전히 들어오는지
async function insideViewport(page, sel) {
  const list = await boxesOf(page, sel), vp = page.viewportSize();
  return list.map((x) => ({ sel, i: x.i, inside: x.box.x >= -0.5 && x.box.y >= -0.5 && x.box.x + x.box.width <= vp.width + 0.5 && x.box.y + x.box.height <= vp.height + 0.5, box: x.box }));
}

// ---------- 보고서 레코드 ----------
function newRec(id, title) {
  const rec = { id, title, pass: false, checks: [], injected: [], real: [], observed: {}, captures: [], pageErrors: [], started: new Date().toISOString(), cur: null };
  rec.check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };
  rec.inject = (t) => { if (!rec.injected.includes(t)) rec.injected.push(t); };
  rec.did = (t) => { if (!rec.real.includes(t)) rec.real.push(t); };
  rec.obs = (k, v) => { rec.observed[k] = v; };
  rec.shot = async (s, name) => {
    const file = rec.id + '-' + s.viewport.width + '-' + name + '.png';
    await s.page.screenshot({ path: path.join(out, file) });
    rec.captures.push(file); return file;
  };
  return rec;
}

// ---------- 세션 ----------
async function open(browser, rec, viewport = VIEW) {
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const s = { context, page, rec, viewport };
  page.on('pageerror', (e) => rec.pageErrors.push('pageerror: ' + String(e).slice(0, 300)));
  // Vite 개발 서버는 Worker 경로(/api/social/*)를 서빙하지 않아 404 가 난다. 그 404 만 따로 세고 나머지는 오류로 본다.
  page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname.startsWith('/api/social/')) rec.devWorker404 = (rec.devWorker404 || 0) + 1; });
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/Ignored attempt to cancel a touchstart event with cancelable=false/.test(t)) { rec.ignoredConsole = (rec.ignoredConsole || 0) + 1; return; } if (/status of 404/.test(t) && /\/api\/social\//.test(m.location()?.url || '')) { rec.ignoredDevWorker404 = (rec.ignoredDevWorker404 || 0) + 1; return; } rec.pageErrors.push('console: ' + t.slice(0, 300) + (m.location()?.url ? ' @ ' + m.location().url : '')); });
  s.close = () => context.close();
  rec.cur = s;
  return s;
}
let errN = 0;
async function errShot(s) { try { errN++; const f = s.rec.id + '-error-' + errN + '.png'; await s.page.screenshot({ path: path.join(out, f) }); s.rec.captures.push(f); } catch {} }
async function closeModals(page) {
  for (let n = 0; n < 6; n++) {
    const c = page.locator('#modal.show #m-cancel');
    if (!await c.isVisible().catch(() => false)) break;
    await c.tap(); await page.waitForTimeout(250);
  }
  const x = page.locator('#modal.show button', { hasText: /^닫기$/ });
  if (await x.count()) { await x.first().tap().catch(() => {}); await page.waitForTimeout(300); }
}
async function installToastLog(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const layer = document.getElementById('toast-layer');
    if (!layer || window.__toastObs) return;
    window.__toastObs = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) window.__toasts.push((n.textContent || '').trim()); });
    window.__toastObs.observe(layer, { childList: true, subtree: true });
  });
}
const toastLog = (s) => s.page.evaluate(() => window.__toasts || []);
async function boot(s) {
  const { page } = s;
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await closeModals(page);
  await installToastLog(page);
  s.rec.did('부팅: #btn-ignore-rotate·#boot-start 실제 탭 → lobby');
}
// 상태 준비(주입): 튜토리얼 완료, 출전 영웅·레벨, 재화, 진행도(unlocked·stars), 난이도.
async function prepareState(s, o = {}) {
  const p = { hero: 'knight', level: null, gold: null, gems: null, ssrTickets: null, energy: null, unlocked: null, starsThrough: null, difficulty: null, tutorial: true, ...o };
  const info = await s.page.evaluate((p) => {
    const e = window.app.eco;
    if (p.tutorial) e.s.tutorial = { completed: true };
    if (!e.ownHero(p.hero)) e.grantHero(p.hero);
    e.s.selected = p.hero;
    const h = e.hero(p.hero);
    if (p.level) { h.level = p.level; h.exp = 0; }
    for (const [k, v] of Object.entries({ gold: p.gold, gems: p.gems, ssrTickets: p.ssrTickets, energy: p.energy })) if (v !== null) e.s[k] = v;
    if (p.unlocked !== null) e.s.progress.unlocked = p.unlocked;
    if (p.starsThrough !== null) for (let i = 1; i <= p.starsThrough; i++) e.s.progress.stars[Math.ceil(i / 10) + '-' + (((i - 1) % 10) + 1)] = 3;
    if (p.difficulty) e.s.progress.difficulty = p.difficulty;
    e.save(); e.emit?.();
    return { selected: e.s.selected, level: h.level, gold: e.s.gold, gems: e.s.gems, energy: e.s.energy, unlocked: e.s.progress.unlocked, difficulty: e.s.progress.difficulty };
  }, p);
  s.rec.inject('eco 상태 준비: ' + JSON.stringify(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null))));
  await s.page.waitForTimeout(250);
  return info;
}
const ecoSnap = (s) => s.page.evaluate(() => { const e = window.app.eco, h = e.hero(e.s.selected); return { gold: e.s.gold, gems: e.s.gems, energy: e.s.energy, level: h.level, inv: e.s.inventory.length, ssrTickets: e.s.ssrTickets, unlocked: e.s.progress.unlocked, difficulty: e.s.progress.difficulty }; });
const tapTab = async (s, tab) => {
  await closeModals(s.page);
  if (tab === 'home' || tab === 'heroes') await s.page.locator('.bottomnav button[data-tab="' + tab + '"]').tap();
  else { await s.page.locator('.bottomnav .oath-nav-menu').tap(); await s.page.waitForTimeout(450); await s.page.locator('#oath-menu button[data-tab="' + tab + '"]').tap(); }
  await s.page.waitForTimeout(600);
};
const tabShown = (s, tab) => s.page.evaluate((tab) => document.getElementById('tab-' + tab)?.classList.contains('show') === true, tab);
const modalText = (s) => s.page.locator('#modal.show #modal-box').innerText().catch(() => '');

import { ECONOMY_PACE } from '../src/data/economy-pace.js';
const expectedPace = (key) => { const s = ECONOMY_PACE.savings[key]; return s && s.days > 0 ? s.target + ' ' + s.freeDays + '일→' + s.withDays + '일' : null; };

// ---------- A6: 상점·소환 단축 일수 문구 ----------
async function shopItems(s) {
  return s.page.evaluate(() => [...document.querySelectorAll('#shop-grid .shop-item')].map((d) => ({ name: d.querySelector('.si-name')?.textContent.trim(), pace: d.querySelector('.si-pace')?.innerText.replace(/\s+/g, ' ').trim() || null, paceTitle: d.querySelector('.si-pace')?.title || null })));
}
async function A6view(browser, rec, viewport) {
  const s = await open(browser, rec, viewport), tag = viewport.width + '';
  try {
    await boot(s); await prepareState(s, { hero: 'knight', gems: 1500, ssrTickets: 1 });
    await tapTab(s, 'shop'); rec.did('메뉴 → 상점 실제 탭');
    const tabs = await s.page.evaluate(() => [...document.querySelectorAll('#shop-tabs button')].map((b) => ({ id: b.dataset.t, name: b.textContent.trim() })));
    rec.obs('shopTabs' + tag, tabs);
    const perTab = {}; let withPace = 0, withoutPace = 0, wrongText = [];
    const SKU_IDS = await s.page.evaluate(() => [...document.querySelectorAll('#shop-grid .shop-item')].length);
    void SKU_IDS;
    for (const t of tabs) {
      await s.page.locator('#shop-tabs button[data-t="' + t.id + '"]').tap(); await s.page.waitForTimeout(450);
      const items = await shopItems(s); perTab[t.id] = items;
      await rec.shot(s, 'shop-' + t.id);
      for (const it of items) { if (it.pace) withPace++; else withoutPace++; }
      const ov = await overlapReport(s.page, [['#shop-grid .shop-item .si-pace', '#shop-grid .shop-item .si-desc'], ['#shop-grid .shop-item .si-pace', '#shop-grid .shop-item button'], ['#shop-grid .shop-item .si-pace', '#shop-grid .shop-item .si-flow'], ['#shop-grid .shop-item .si-pace', '#shop-grid .shop-item .si-name'], ['#shop-grid .shop-item .si-pace', '#shop-grid .shop-item .si-bonus']]);
      rec.check(tag + ' 상점 ' + t.name + ' 탭: 단축 문구가 설명·가격 버튼·용도·이름·보너스와 겹치지 않는다', ov.found.length === 0, ov.found.slice(0, 3));
      const fits = (await insideViewport(s.page, '#shop-grid .shop-item .si-pace')).filter((x) => !x.inside);
      void fits; // 목록은 스크롤되므로 뷰포트 밖은 허용; 카드 안에서 잘림은 아래에서 검사
      const clipped = await s.page.evaluate(() => [...document.querySelectorAll('#shop-grid .shop-item')].filter((d) => d.querySelector('.si-pace')).map((d) => { const p = d.querySelector('.si-pace').getBoundingClientRect(), c = d.getBoundingClientRect(); return { name: d.querySelector('.si-name')?.textContent.trim(), clipped: p.bottom > c.bottom + 0.5 || p.right > c.right + 0.5 }; }).filter((x) => x.clipped));
      rec.check(tag + ' 상점 ' + t.name + ' 탭: 단축 문구가 상품 카드 밖으로 잘리지 않는다', clipped.length === 0, clipped);
    }
    rec.obs('shopPace' + tag, perTab);
    const all = Object.values(perTab).flat();
    rec.check(tag + ' 상점: 단축 일수가 있는 상품에는 문구가 있다(' + withPace + '개)', withPace >= 5, { withPace, withoutPace });
    // 상품명 → skuId 대응은 화면에 없으므로, 문구 형식과 값이 ECONOMY_PACE 의 어느 항목과 일치하는지 본다.
    const known = new Set(Object.keys(ECONOMY_PACE.savings).map(expectedPace).filter(Boolean));
    for (const it of all) if (it.pace) { const head = it.pace.split(' −')[0]; if (!known.has(head)) wrongText.push(it); }
    rec.check(tag + ' 상점: 모든 단축 문구가 economy-pace 의 대상·일수와 일치', wrongText.length === 0, wrongText.slice(0, 3));
    rec.check(tag + ' 상점: 모든 문구에 기준(스토리 30분/일·별 승급 제외 예상)이 있다', all.filter((i) => i.pace).every((i) => /별 승급 제외 예상/.test(i.pace)), all.filter((i) => i.pace && !/별 승급 제외 예상/.test(i.pace)).slice(0, 3));
    rec.check(tag + ' 상점: 단축 0일 상품(강화석 등)에는 문구가 없다', all.some((i) => !i.pace && /강화석|보호|축복/.test(i.name || '')), all.filter((i) => !i.pace).map((i) => i.name).slice(0, 6));
    // 소환 화면
    await tapTab(s, 'gacha'); rec.did('메뉴 → 소환 실제 탭');
    const g = await s.page.evaluate(() => ({ pace: document.getElementById('gacha-pace')?.innerText.trim() || '', paceHidden: document.getElementById('gacha-pace')?.hidden, tag: document.getElementById('pace-ssr')?.innerText.trim() || '', ssrVisible: !!document.getElementById('btn-pull-ssr')?.offsetParent }));
    rec.obs('gacha' + tag, g);
    await rec.shot(s, 'gacha-with-ticket');
    const exp = expectedPace('ssrTicket'), saved = ECONOMY_PACE.savings.ssrTicket.days;
    rec.check(tag + ' 소환: SSR 확정권 버튼 보임 + "−' + saved + '일 단축" 태그', g.ssrVisible && g.tag === '−' + saved + '일 단축', g);
    rec.check(tag + ' 소환: 줄 문구에 대상·전후 일수·단축·기준', !!exp && g.pace.includes('SSR 확정권 1장') && g.pace.includes(exp) && g.pace.includes('−' + saved + '일') && g.pace.includes('별 승급 제외 예상'), { g, exp });
    const ov = await overlapReport(s.page, [['#gacha-pace', '#btn-pull1'], ['#gacha-pace', '#btn-pull10'], ['#gacha-pace', '#btn-pull-ssr'], ['#gacha-pace', '.gacha-foot'], ['#gacha-pace', '#gacha-odds'], ['#pace-ssr', '#btn-pull-ssr small:not(.pace-ssr)'], ['#btn-pull-ssr', '#btn-pull10'], ['#btn-pull-ssr', '#btn-pull1']]);
    rec.check(tag + ' 소환: 단축 줄·SSR 버튼이 다른 요소와 겹치지 않는다', ov.found.length === 0, { found: ov.found.slice(0, 3), checked: ov.checked });
    const inside = await insideViewport(s.page, '#gacha-pace, #btn-pull-ssr, #btn-pull1, #btn-pull10, .gacha-foot');
    rec.check(tag + ' 소환: 단축 줄과 소환 버튼이 화면 안에 완전히 들어온다', inside.length >= 5 && inside.every((x) => x.inside), inside);
    // 확정권이 없을 때: 버튼은 숨고 줄은 남는다
    await s.page.evaluate(() => { const e = window.app.eco; e.s.ssrTickets = 0; e.emit(); });
    rec.inject('SSR 확정권 0장으로 변경(eco.s.ssrTickets=0)');
    await s.page.waitForTimeout(300);
    const g0 = await s.page.evaluate(() => ({ paceVisible: !!document.getElementById('gacha-pace')?.offsetParent, ssrVisible: !!document.getElementById('btn-pull-ssr')?.offsetParent }));
    await rec.shot(s, 'gacha-no-ticket');
    rec.check(tag + ' 소환: 확정권이 없으면 버튼은 숨고 단축 줄은 보인다', g0.paceVisible && !g0.ssrVisible, g0);
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}
async function A6(browser, rec) { await A6view(browser, rec, VIEW); await A6view(browser, rec, WIDE); }

/*__INSERT__*/

// ---------- 러너 ----------
const CRITERIA = { A6: ['상점·소환 단축 일수 문구', A6] };
const GL = arg('gl', 'gpu');
const browser = await chromium.launch(GL === 'swift' ? launchOpts() : { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const summary = { started: new Date().toISOString(), origin, out, viewport: VIEW, wide: WIDE, criteria: {} };
let failed = false;
for (const id of Object.keys(CRITERIA).filter((k) => !only || only.includes(k))) {
  const [title, fn] = CRITERIA[id], rec = newRec(id, title);
  try { await fn(browser, rec); } catch (e) {
    rec.check('실행 오류 없음', false, String(e?.stack || e).slice(0, 800));
    if (rec.cur) { try { await rec.cur.page.screenshot({ path: path.join(out, id + '-error.png') }); rec.captures.push(id + '-error.png'); } catch {} }
  }
  rec.pass = rec.checks.length > 0 && rec.checks.every((c) => c.ok) && rec.pageErrors.length === 0;
  rec.finished = new Date().toISOString();
  const { cur, ...plain } = rec; void cur;
  await fs.writeFile(path.join(out, id + '.json'), JSON.stringify(plain, null, 2));
  summary.criteria[id] = { pass: rec.pass, checks: rec.checks.length, failedChecks: rec.checks.filter((c) => !c.ok).map((c) => c.name), pageErrors: rec.pageErrors.length, devWorker404: rec.devWorker404 || 0 };
  if (!rec.pass) failed = true;
  console.log(id, rec.pass ? 'PASS' : 'FAIL', rec.checks.filter((c) => !c.ok).map((c) => c.name).join(' | '), rec.pageErrors.length ? '(pageErrors ' + rec.pageErrors.length + ')' : '');
}
await browser.close();
summary.finished = new Date().toISOString(); summary.pass = !failed;
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
process.exit(failed ? 1 : 0);
