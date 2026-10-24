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
    (e.s.roster.policy = 1, e.s.roster.starterChosen = true);
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


import { recommendedLevel } from '../src/data/loot-tables.js';
import { lootGuide, levelStatusLabel } from '../src/data/region-guide.js';
import { CHAPTERS } from '../src/data/stages.js';

// ---------- 전투 공용(실제 탭으로 진입, 주입 픽스처로 빠르게 승리) ----------
// 스테이지 상세의 #st-go 를 실제로 탭해 전투를 시작한다. 이야기 컷 "건너뛰기"가 뜨면 실제로 탭한다.
async function startStageFromDetail(s, code) {
  const { page } = s;
  await page.locator('#stage-grid [data-stage="' + code + '"]').tap(); await page.waitForTimeout(500);
  await page.locator('#st-go').tap(); s.rec.did('캠페인 ' + code + ' #st-go 실제 탭');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const skip = page.getByRole('button', { name: /건너뛰기/ });
    if (await skip.count() && await skip.first().isVisible().catch(() => false)) { await skip.first().tap().catch(() => {}); s.rec.did('이야기 컷 "건너뛰기" 실제 탭'); }
    if (await page.evaluate(() => window.app.mode === 'battle' && window.app.battle?.active && !!window.app.battle.player)) break;
  }
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !!window.app.battle.player, undefined, { timeout: 90000 });
  await page.waitForFunction(() => window.app.battle.elapsed > 0.5, undefined, { timeout: 60000 });
}
// 주입 픽스처: 살아 있는 적의 HP 를 1 로 낮추고 플레이어 HP 를 유지하며 AUTO 를 켠다(전투·처치·드랍·결산은 실제 코드 경로).
async function winFastFixture(s, { timeout = 240000 } = {}) {
  const { page } = s;
  await page.evaluate(() => {
    if (window.__qaFix) clearInterval(window.__qaFix);
    window.__qaFix = setInterval(() => { const b = window.app.battle; if (!b?.active) return; for (const e of b.enemies) if (e.alive && e.hp > 1) e.hp = 1; const P = b.player; if (P?.alive) P.hp = P.maxHp; }, 80);
  });
  s.rec.inject('전투 픽스처: 살아 있는 적 HP=1, 플레이어 HP 유지(80ms 주기). 처치·드랍·결산은 실제 코드 경로');
  const auto = await page.evaluate(() => !!window.app.battle.player?.auto);
  if (!auto) { await page.locator('#btn-auto').tap(); s.rec.did('AUTO 버튼 실제 탭'); }
  const t0 = Date.now();
  await page.waitForFunction(() => document.getElementById('result')?.classList.contains('show'), undefined, { timeout });
  await page.evaluate(() => { clearInterval(window.__qaFix); window.__qaFix = 0; });
  await page.waitForTimeout(2400); // 결과 화면 연출·전리품 카드가 모두 붙을 때까지
  return { ms: Date.now() - t0 };
}

// ---------- A4: 다음 스테이지·지역·권장 Lv·대표 보상 ----------
const guideText = (s) => s.page.evaluate(() => ({
  level: document.querySelector('#stage-detail .stage-level')?.innerText.replace(/\s+/g, ' ').trim() || null,
  tone: document.querySelector('#stage-detail .stage-level')?.dataset.tone || null,
  title: document.querySelector('#stage-detail .stage-level')?.title || null,
  loot: document.querySelector('#stage-detail .stage-loot-guide')?.innerText.replace(/\s+/g, ' ').trim() || null,
  diff: document.querySelector('#stage-detail .stage-loot-guide')?.dataset.lootDifficulty || null,
  chips: [...document.querySelectorAll('#stage-detail .reward-chip')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
}));
async function A4campaign(browser, rec, viewport) {
  const s = await open(browser, rec, viewport), tag = viewport.width + '';
  try {
    await boot(s); await prepareState(s, { hero: 'knight', level: 15, unlocked: 10, starsThrough: 9 });
    await tapTab(s, 'stage'); rec.did('메뉴 → 모험(캠페인) 실제 탭');
    rec.check(tag + ' 캠페인 탭이 열렸다', await tabShown(s, 'stage'));
    await s.page.locator('#stage-grid [data-stage="1-9"]').tap(); rec.did('1-9 칸 실제 탭'); await s.page.waitForTimeout(500);
    const rec19 = recommendedLevel(1, 9);
    const g = await guideText(s); rec.obs('stage19-' + tag, g);
    await rec.shot(s, 'campaign-1-9');
    rec.check(tag + ' 1-9 상세에 "권장 Lv.' + rec19 + ' · 내 Lv.15" 와 상태가 보인다', !!g.level && g.level.includes('권장 Lv.' + rec19) && g.level.includes('내 Lv.15') && g.level.includes(levelStatusLabel(15, rec19).text), g);
    // 난이도 카드 실제 탭 → 전리품 문구가 실제 표(lootGuide)와 같고 난이도마다 달라진다
    const texts = {};
    for (const id of ['story', 'adept', 'nightmare']) {
      await s.page.locator('#stage-detail [data-difficulty="' + id + '"]').tap(); rec.did('난이도 카드 ' + id + ' 실제 탭'); await s.page.waitForTimeout(450);
      texts[id] = await guideText(s);
      const expected = lootGuide(1, id).lines;
      rec.check(tag + ' 난이도 ' + id + ': 전리품 문구가 lootTable 계산값과 같다', texts[id].diff === id && expected.every((l) => texts[id].loot.includes(l)), { loot: texts[id].loot, expected });
    }
    rec.obs('lootByDifficulty-' + tag, Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.loot])));
    await rec.shot(s, 'campaign-1-9-nightmare');
    rec.check(tag + ' 난이도를 바꾸면 전리품 문구가 바뀐다(3종 모두 다름)', new Set(Object.values(texts).map((t) => t.loot)).size === 3);
    rec.check(tag + ' 정예 칩 장비 개수가 표와 같다', texts.story.chips.some((c) => c.includes('장비 ' + lootGuide(1, 'story').elite.gearRolls + '개')), texts.story.chips);
    // 레벨 상태 4종(주입한 레벨 + 칸 재선택 실제 탭)
    for (const [lv, want] of [[5, '레벨 부족'], [rec19 - 2, '도전 가능'], [rec19, '준비 완료'], [rec19 + 12, '너무 쉬움']]) {
      await s.page.evaluate((lv) => { const e = window.app.eco; e.hero(e.s.selected).level = lv; e.emit(); }, lv); rec.inject('영웅 레벨 ' + lv + ' 로 변경');
      await s.page.locator('#stage-grid [data-stage="1-8"]').tap(); await s.page.waitForTimeout(250);
      await s.page.locator('#stage-grid [data-stage="1-9"]').tap(); await s.page.waitForTimeout(400);
      const t = await guideText(s);
      rec.check(tag + ' 내 Lv.' + lv + ' → "' + want + '"', !!t.level && t.level.includes(want) && t.level.includes('내 Lv.' + lv), t);
    }
    // 겹침: 새 요소와 버튼·다른 줄
    await s.page.evaluate((lv) => { const e = window.app.eco; e.hero(e.s.selected).level = lv; e.emit(); }, 15);
    await s.page.locator('#stage-grid [data-stage="1-8"]').tap(); await s.page.waitForTimeout(250); await s.page.locator('#stage-grid [data-stage="1-9"]').tap(); await s.page.waitForTimeout(400);
    const L = '#stage-detail .stage-level', G = '#stage-detail .stage-loot-guide';
    const ov = await overlapReport(s.page, [[L, '#stage-detail .difficulty-picker'], [L, '#stage-detail .rewards'], [L, '#stage-detail .meta:not(.stage-stage-level):not(.stage-level)'], [L, '#st-go'], [L, '#st-sweep'], [G, '#st-go'], [G, '#st-sweep'], [G, '#stage-detail .rewards'], [G, '#stage-detail .difficulty-picker'], [G, L]]);
    rec.check(tag + ' 캠페인: 권장 Lv 줄·전리품 문구가 난이도 카드·보상 칩·출격/소탕 버튼과 겹치지 않는다', ov.found.length === 0, { found: ov.found.slice(0, 3), checked: ov.checked.length });
    await s.page.locator('#st-go').scrollIntoViewIfNeeded(); await s.page.waitForTimeout(250);
    await rec.shot(s, 'campaign-launch-buttons');
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}
async function A4result(browser, rec, viewport) {
  const s = await open(browser, rec, viewport), tag = viewport.width + '';
  try {
    await boot(s); await prepareState(s, { hero: 'knight', level: 18, unlocked: 10, starsThrough: 9 });
    await tapTab(s, 'stage'); rec.did('메뉴 → 모험(캠페인) 실제 탭');
    const detail10 = await guideText(s); rec.obs('stage110-' + tag, detail10);
    await startStageFromDetail(s, '1-10');
    const win = await winFastFixture(s); rec.obs('battleMs-' + tag, win.ms);
    const stageCode = await s.page.evaluate(() => window.app.battle.stage?.code);
    rec.check(tag + ' 1-10 전투가 실제로 끝나 결과 화면(승리)이 떴다', stageCode === '1-10' && await s.page.evaluate(() => window.app.battle.result?.win === true && document.getElementById('result').classList.contains('show')), { stageCode });
    // 결과 레이아웃: 안내 블록을 스크롤해서 보이게 한다
    const blk = s.page.locator('#result-growth .next-guide'); 
    rec.check(tag + ' 결과 화면에 "다음 출격" 블록이 있다', await blk.count() === 1);
    await blk.scrollIntoViewIfNeeded(); await s.page.waitForTimeout(300);
    const txt = (await blk.innerText()).replace(/\s+/g, ' ').trim(); rec.obs('nextGuide-' + tag, txt);
    await rec.shot(s, 'result-next-guide');
    const ch2 = CHAPTERS[1], rec21 = recommendedLevel(2, 1);
    const myLv = await s.page.evaluate(() => window.app.eco.hero(window.app.eco.s.selected).level);
    rec.check(tag + ' 안내: 새 지역 개방 · ' + ch2.name, txt.includes('새 지역 개방: ' + ch2.name), txt);
    rec.check(tag + ' 안내: 다음 스테이지 2-1 + 권장 Lv.' + rec21 + ' + 내 Lv.' + myLv + ' + 상태', txt.includes('2-1') && txt.includes('권장 Lv.' + rec21) && txt.includes('내 Lv.' + myLv) && txt.includes(levelStatusLabel(myLv, rec21).text), { txt, myLv });
    rec.check(tag + ' 안내: 대표 보상(재료·에픽 확률)', /대표 보상 · .+ ×\d+/.test(txt) && /에픽 이상 \d+%/.test(txt), txt);
    const sc = await s.page.evaluate(() => { const r = document.querySelector('#result .result-scroll').getBoundingClientRect(), b = document.querySelector('#result-growth .next-guide').getBoundingClientRect(); return { scroll: { y: r.y, h: r.height, bottom: r.bottom, top: r.top }, guide: { top: b.top, bottom: b.bottom } }; });
    rec.check(tag + ' 결과: 안내 블록이 스크롤 영역 안에 완전히 보인다', sc.guide.top >= sc.scroll.top - 0.5 && sc.guide.bottom <= sc.scroll.bottom + 0.5, sc);
    const ov = await overlapReport(s.page, [['#result-growth .next-guide', '.result-btns'], ['#result-growth .next-guide', '#btn-result-next'], ['#result-growth .next-guide', '#btn-result-lobby'], ['#result-growth .next-guide', '#btn-result-retry'], ['#result-growth .next-guide', '#btn-result-double'], ['#result .result-scroll', '.result-btns']]);
    rec.check(tag + ' 결과: 다음 출격 블록·스크롤 영역이 하단 버튼과 겹치지 않는다', ov.found.length === 0, { found: ov.found.slice(0, 3), checked: ov.checked.length });
    const btns = await insideViewport(s.page, '#btn-result-next, #btn-result-lobby, #btn-result-retry');
    rec.check(tag + ' 결과: 하단 버튼이 화면 안에 완전히 들어온다', btns.length >= 3 && btns.every((b) => b.inside), btns);
    // 다음 탭 → 2-1 전투 시작
    await s.page.locator('#btn-result-next').tap(); rec.did('결과 화면 #btn-result-next 실제 탭');
    for (let i = 0; i < 20; i++) { await s.page.waitForTimeout(500); const skip = s.page.getByRole('button', { name: /건너뛰기/ }); if (await skip.count() && await skip.first().isVisible().catch(() => false)) await skip.first().tap().catch(() => {}); if (await s.page.evaluate(() => window.app.mode === 'battle' && window.app.battle?.active && window.app.battle.stage?.code === '2-1')) break; }
    const next = await s.page.evaluate(() => ({ mode: window.app.mode, code: window.app.battle.stage?.code, active: window.app.battle.active }));
    rec.check(tag + ' 다음 탭 → 2-1 전투 진입', next.mode === 'battle' && next.code === '2-1' && next.active, next);
    await rec.shot(s, 'battle-2-1-started');
    // 새로고침 뒤 캠페인 2-1 상세에 권장 Lv 표시
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)'); await boot(s);
    await tapTab(s, 'stage');
    const snap = await ecoSnap(s); rec.obs('afterReload-' + tag, snap);
    await s.page.locator('#chapter-tabs [data-ch="2"]').tap(); await s.page.waitForTimeout(400);
    await s.page.locator('#stage-grid [data-stage="2-1"]').tap(); await s.page.waitForTimeout(500);
    const g21 = await guideText(s); rec.obs('stage21-' + tag, g21);
    await rec.shot(s, 'campaign-2-1');
    rec.check(tag + ' 새로고침 뒤 진행도 유지(unlocked ≥ 11)', snap.unlocked >= 11, snap);
    rec.check(tag + ' 2-1 상세에 "권장 Lv.' + rec21 + '" 표시', !!g21.level && g21.level.includes('권장 Lv.' + rec21), g21);
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}
async function A4(browser, rec) {
  await A4campaign(browser, rec, VIEW); await A4campaign(browser, rec, WIDE);
  await A4result(browser, rec, VIEW); await A4result(browser, rec, WIDE);
}



import { ITEM_BY_ID, RARITY_INFO, ITEM_POOL } from '../src/data/items.js';
const EPIC_PER_SLOT = Object.fromEntries(Object.keys(ITEM_POOL).map((slot) => [slot, ITEM_POOL[slot].find((it) => it.rarity === 'E').id]));

// ---------- A2: 결과 전리품 → 장착·판매·강화 → 새로고침 ----------
const invSnap = (s) => s.page.evaluate(() => { const e = window.app.eco, id = e.s.selected, h = e.hero(id); return { gold: e.s.gold, stones: e.s.stones, power: e.heroPower(id), equip: { ...h.equip }, inv: e.s.inventory.map((x) => ({ uid: x.uid, id: x.id, enh: x.enh })) }; });
async function A2view(browser, rec, viewport) {
  const s = await open(browser, rec, viewport), tag = viewport.width + '';
  try {
    await boot(s); await prepareState(s, { hero: 'knight', level: 60, unlocked: 1, gold: 500000 });
    // 주입: 강화 재료와 부위별 에픽 장비 착용(낮은 등급 전리품이 "판매" 판정으로 나오도록 비교 기준을 만든다)
    const base = JSON.parse(JSON.stringify(EPIC_PER_SLOT));
    await s.page.evaluate((base) => { const e = window.app.eco; e.s.stones = 200; e.s.stones2 = 50; const h = e.hero(e.s.selected); for (const [slot, id] of Object.entries(base)) { const inst = { uid: e.s.invSeq++, id, enh: 0 }; e.s.inventory.push(inst); h.equip[slot] = inst.uid; } e.emit(); }, base);
    rec.inject('강화석 200·상급 강화석 50 지급 + 부위별 에픽(E) 장비 4개 지급·착용(비교 기준)');
    const before = await invSnap(s); rec.obs('before-' + tag, before);
    await tapTab(s, 'stage'); rec.did('메뉴 → 모험 실제 탭');
    await startStageFromDetail(s, '1-1');
    const win = await winFastFixture(s); rec.obs('battleMs-' + tag, win.ms);
    const lootOrder = await s.page.evaluate(() => (window.app.battle.result?.reward?.loot || []).map((x) => x.uid)); // 결과 카드 순서
    const afterBattle = await invSnap(s), byUid = new Map(afterBattle.inv.map((x) => [x.uid, x]));
    const loot = lootOrder.map((u) => byUid.get(u)).filter(Boolean);
    rec.obs('lootCount-' + tag, loot.length);
    rec.check(tag + ' 실제 전투(1-1) 승리 뒤 새 장비를 얻었다(' + loot.length + '개)', loot.length >= 1 && await s.page.evaluate(() => window.app.battle.result?.win === true), { loot: loot.length });
    await s.page.locator('#result-loot-details > summary').tap(); rec.did('결과 "획득 보상" 펼치기 실제 탭'); await s.page.waitForTimeout(600);
    const cards = await s.page.evaluate(() => [...document.querySelectorAll('#result-loot .loot-item[data-verdict]')].map((c) => ({ verdict: c.dataset.verdict, lc: c.querySelector('.lc')?.textContent.trim() || '', aria: c.getAttribute('aria-label') || '', disabled: c.disabled })));
    rec.obs('lootCards-' + tag, { total: cards.length, byVerdict: cards.reduce((m, c) => (m[c.verdict] = (m[c.verdict] || 0) + 1, m), {}), sample: cards.slice(0, 6) });
    await rec.shot(s, 'result-loot-cards');
    rec.check(tag + ' 결과 전리품 카드마다 비교 문구(.lc)와 설명이 있다', cards.length === loot.length && cards.every((c) => c.lc && /장비 비교 · /.test(c.aria)), { cards: cards.length, loot: loot.length });
    const expectVerdicts = await s.page.evaluate((uids) => { const e = window.app.eco, id = e.s.selected; return uids.map((u) => { const p = e.previewItem(id, u); if (!p) return 'none'; if (p.remove) return 'equipped'; const d = Math.round(p.after.power - p.before.power); return d > 0 ? 'better' : d < 0 ? 'worse' : 'same'; }); }, lootOrder);
    // 장착 전 기준으로 계산한 판정이므로, 결과 화면이 그렸을 때와 같아야 한다
    rec.check(tag + ' 카드 판정(더 좋음/판매)이 현재 장착 대비 전투력 증감과 카드 순서까지 같다', JSON.stringify(cards.map((c) => c.verdict)) === JSON.stringify(expectVerdicts), { cards: cards.map((c) => c.verdict).join(','), expect: expectVerdicts.join(',') });
    rec.check(tag + ' 판정이 한 종류가 아니다(추천·판매 둘 다 보인다)', new Set(cards.map((c) => c.verdict)).size >= 2, [...new Set(cards.map((c) => c.verdict))]);
    const worse = cards.find((c) => c.verdict === 'worse');
    rec.check(tag + ' "판매" 카드 문구가 판매가를 보인다', !worse || /^판매 [\d,]+$/.test(worse.lc), worse);
    // 겹침: 스크롤 영역에 보이는 부분만 하단 버튼과 비교한다
    const visOv = await s.page.evaluate(() => { const sc = document.querySelector('#result .result-scroll').getBoundingClientRect(), btn = document.querySelector('.result-btns').getBoundingClientRect(); const hit = []; document.querySelectorAll('#result-loot .loot-item').forEach((c, i) => { const r = c.getBoundingClientRect(); const top = Math.max(r.top, sc.top), bottom = Math.min(r.bottom, sc.bottom); if (bottom <= top) return; const ow = Math.min(r.right, btn.right) - Math.max(r.left, btn.left), oh = Math.min(bottom, btn.bottom) - Math.max(top, btn.top); if (ow > 0.5 && oh > 0.5) hit.push({ i, ow, oh }); }); return { hit, scrollBottom: sc.bottom, btnTop: btn.top }; });
    const ovR = await overlapReport(s.page, [['#result .result-scroll', '.result-btns']]);
    rec.check(tag + ' 결과: 스크롤 영역에 보이는 전리품 카드·스크롤 영역이 하단 버튼과 겹치지 않는다', visOv.hit.length === 0 && ovR.found.length === 0, { visOv, found: ovR.found.slice(0, 2) });
    const cardFit = await s.page.evaluate(() => [...document.querySelectorAll('#result-loot .loot-item .lc')].map((l) => { const c = l.closest('.loot-item').getBoundingClientRect(), r = l.getBoundingClientRect(); return { text: l.textContent, inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.bottom <= c.bottom + 0.5 }; }));
    rec.check(tag + ' 결과: 비교 문구가 카드 밖으로 넘치지 않는다', cardFit.length > 0 && cardFit.every((x) => x.inside), cardFit.filter((x) => !x.inside).slice(0, 3));
    // 카드 실제 탭 → 영웅 탭 + 장비 시트
    const pickIdx = Math.max(0, cards.findIndex((c) => c.verdict === 'better')), pick = loot[pickIdx], pd = ITEM_BY_ID[pick.id];
    await s.page.locator('#result-loot .loot-item[data-verdict]').nth(pickIdx).scrollIntoViewIfNeeded();
    await s.page.locator('#result-loot .loot-item[data-verdict]').nth(pickIdx).tap(); rec.did('결과 전리품 카드 실제 탭(▲ 장착 추천 카드)'); await s.page.waitForTimeout(900);
    const sheet = await s.page.evaluate(() => ({ tab: document.getElementById('tab-heroes')?.classList.contains('show'), name: document.querySelector('#modal.show .item-sheet h2')?.innerText || '', eq: document.querySelector('#modal.show #i-eq')?.innerText || '', sell: !!document.querySelector('#modal.show #i-sell'), enh: !!document.querySelector('#modal.show #e-go') }));
    rec.obs('sheet-' + tag, sheet); await rec.shot(s, 'item-sheet-from-result');
    rec.check(tag + ' 카드 탭 → 영웅 탭 + 해당 장비(' + pd.name + ') 시트(장착·판매·강화 버튼)', sheet.tab && sheet.name.includes(pd.name) && !!sheet.eq && sheet.sell && sheet.enh, sheet);
    // 장착
    const preEq = await invSnap(s), wasEquipped = Object.values(preEq.equip).includes(pick.uid);
    if (!wasEquipped) { await s.page.locator('#modal.show #i-eq').tap(); rec.did('시트 #i-eq(장착하기) 실제 탭'); await s.page.waitForTimeout(700); }
    const postEq = await invSnap(s);
    const verdict = cards[pickIdx].verdict, sign = Math.sign(postEq.power - preEq.power);
    rec.check(tag + ' 장착: ' + pd.slot + ' 슬롯이 해당 장비로 바뀌고 전투력 증감 부호가 카드 판정(' + verdict + ')과 같다', postEq.equip[pd.slot] === pick.uid && (verdict === 'better' ? sign > 0 : verdict === 'worse' ? sign < 0 : true), { verdict, preEq: { power: preEq.power, slot: preEq.equip[pd.slot] }, postEq: { power: postEq.power, slot: postEq.equip[pd.slot] }, wasEquipped });
    // 영웅 가방 NEW: 연 장비는 꺼지고 이번에 얻은 나머지는 켜진다
    const lootSet = afterBattle.inv.filter((x) => !before.inv.some((b) => b.uid === x.uid)).map((x) => x.uid); // 전투 중 얻은 장비 전부(결과 카드 밖 직접 획득 포함)
    const bagNew = await s.page.evaluate(({ lootSet, openUid }) => { const set = new Set(lootSet); const cells = [...document.querySelectorAll('#hero-bag [data-inv]')]; return { items: cells.length, news: cells.filter((c) => c.querySelector('.bag-new')).length, mismatch: cells.filter((c) => { const uid = +c.dataset.inv, want = set.has(uid) && uid !== openUid; return !!c.querySelector('.bag-new') !== want; }).map((c) => c.dataset.inv).slice(0, 5) }; }, { lootSet, openUid: pick.uid });
    rec.obs('bagNew-' + tag, bagNew); await rec.shot(s, 'hero-bag-new');
    rec.check(tag + ' 가방: 이번에 얻은 장비(연 것 제외)에만 NEW(' + bagNew.news + '개), 연 장비는 꺼졌다', bagNew.news > 0 && bagNew.mismatch.length === 0, bagNew);
    const ovB = await overlapReport(s.page, [['#hero-bag .bag-new', '#hero-bag .bag-eq'], ['#hero-bag .bag-new', '#hero-bag .inventory-level'], ['#hero-bag .bag-new', '#hero-bag .inventory-name']]);
    rec.check(tag + ' 가방: NEW 표시가 착용·강화 표시와 겹치지 않는다', ovB.found.length === 0, ovB.found.slice(0, 3));
    // 판매: 이번에 얻은 장비 중 장착하지 않은 것(가방에서 실제 탭)
    const sellTarget = await s.page.evaluate((lootSet) => { const e = window.app.eco, h = e.hero(e.s.selected), worn = new Set(Object.values(h.equip)); const cell = [...document.querySelectorAll('#hero-bag [data-inv]')].find((c) => lootSet.includes(+c.dataset.inv) && !worn.has(+c.dataset.inv)); return cell ? +cell.dataset.inv : null; }, lootSet);
    rec.check(tag + ' 가방에 판매할 새 장비가 있다', sellTarget !== null, sellTarget);
    const sd = ITEM_BY_ID[byUid.get(sellTarget).id];
    const preSell = await invSnap(s);
    await s.page.locator('#hero-bag [data-inv="' + sellTarget + '"]').tap(); rec.did('가방 새 장비 칸 실제 탭(판매 대상)'); await s.page.waitForTimeout(700);
    await s.page.locator('#modal.show #i-sell').tap(); rec.did('시트 #i-sell 실제 탭'); await s.page.waitForTimeout(500);
    await s.page.locator('#modal.show #m-ok').tap(); rec.did('판매 확인 #m-ok 실제 탭'); await s.page.waitForTimeout(700);
    const postSell = await invSnap(s), expGold = RARITY_INFO[sd.rarity]?.sell || 200;
    rec.check(tag + ' 판매(' + sd.name + '): 골드 +' + expGold + ', 장비 1개 감소', postSell.gold - preSell.gold === expGold && postSell.inv.length === preSell.inv.length - 1 && !postSell.inv.some((x) => x.uid === sellTarget), { gold: [preSell.gold, postSell.gold], inv: [preSell.inv.length, postSell.inv.length] });
    // 강화: 장착한 장비(가방에서 실제 탭)
    await s.page.evaluate((slot) => { window.app.meta.bagSlot = slot; window.app.meta.renderHeroes(); }, pd.slot); await s.page.waitForTimeout(400);
    await s.page.locator('#hero-bag [data-inv="' + pick.uid + '"]').tap(); rec.did('가방 장착 장비 칸 실제 탭(강화 대상)'); await s.page.waitForTimeout(700);
    const preEnh = await invSnap(s), enhBefore = preEnh.inv.find((x) => x.uid === pick.uid).enh;
    let tries = 0, enhAfter = enhBefore, goldAfter = preEnh.gold;
    while (tries < 4 && enhAfter <= enhBefore) {
      tries++;
      if (!await s.page.locator('#modal.show #e-go').count()) { await s.page.locator('#hero-bag [data-inv="' + pick.uid + '"]').tap().catch(() => {}); await s.page.waitForTimeout(600); }
      await s.page.locator('#modal.show #e-go').tap(); rec.did('시트 #e-go(강화하기) 실제 탭'); await s.page.waitForTimeout(2600);
      const cur = await invSnap(s); enhAfter = (cur.inv.find((x) => x.uid === pick.uid) || { enh: -1 }).enh; goldAfter = cur.gold;
      if (enhAfter < 0) break;
    }
    await rec.shot(s, 'item-sheet-enhanced');
    rec.check(tag + ' 강화: 단계 +' + enhBefore + ' → +' + enhAfter + '(시도 ' + tries + ')·골드 감소', enhAfter > enhBefore && goldAfter < preEnh.gold, { enhBefore, enhAfter, tries, gold: [preEnh.gold, goldAfter] });
    // 새로고침 뒤 유지
    const finalBefore = await invSnap(s);
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)'); await boot(s);
    const finalAfter = await invSnap(s); rec.obs('persist-' + tag, { before: { gold: finalBefore.gold, equip: finalBefore.equip, inv: finalBefore.inv.length }, after: { gold: finalAfter.gold, equip: finalAfter.equip, inv: finalAfter.inv.length } });
    rec.check(tag + ' 새로고침 뒤 장착·강화 단계·골드·장비 목록 유지', finalAfter.equip[pd.slot] === pick.uid && (finalAfter.inv.find((x) => x.uid === pick.uid) || {}).enh === enhAfter && finalAfter.gold === finalBefore.gold && finalAfter.inv.length === finalBefore.inv.length && !finalAfter.inv.some((x) => x.uid === sellTarget), { before: finalBefore.equip, after: finalAfter.equip });
    await tapTab(s, 'heroes'); await s.page.waitForTimeout(500);
    rec.check(tag + ' 새로고침 뒤 NEW 표시는 없다(세션 메모리, 저장 스키마 불변)', await s.page.evaluate(() => document.querySelectorAll('#hero-bag .bag-new').length) === 0);
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}

// 1280: 인벤토리 창(I 키, 데스크톱 단축키)에서 NEW 확인. 키 입력은 실제 키보드 이벤트다.
async function A2inventory(browser, rec) {
  const s = await open(browser, rec, WIDE);
  try {
    await boot(s); await prepareState(s, { hero: 'knight', level: 60, unlocked: 1, gold: 500000 });
    const before = await invSnap(s), had = new Set(before.inv.map((x) => x.uid));
    await tapTab(s, 'stage'); await startStageFromDetail(s, '1-1'); await winFastFixture(s);
    const loot = (await invSnap(s)).inv.filter((x) => !had.has(x.uid));
    await s.page.locator('#btn-result-lobby').tap(); rec.did('결과 #btn-result-lobby 실제 탭'); await s.page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 30000 }); await s.page.waitForTimeout(900);
    await s.page.keyboard.press('KeyI'); rec.did('키보드 I(인벤토리 창) 입력'); await s.page.waitForTimeout(900);
    const inv = await s.page.evaluate(() => ({ cells: document.querySelectorAll('.mpl-cell.has-gear').length, news: document.querySelectorAll('.mpl-new').length, aria: [...document.querySelectorAll('.mpl-cell.has-gear')].filter((c) => c.querySelector('.mpl-new')).map((c) => c.getAttribute('aria-label')).slice(0, 5) }));
    rec.obs('inventoryWindow', inv); await rec.shot(s, 'inventory-window-new');
    rec.check('1280 인벤토리 창에서 새 장비 ' + loot.length + '개에 NEW', inv.news === loot.length && loot.length > 0, { inv, loot: loot.length });
    const ov = await overlapReport(s.page, [['.mpl-new', '.mpl-enh'], ['.mpl-new', '.mpl-worn'], ['.mpl-new', '.mpl-qty']]);
    rec.check('1280 인벤토리: NEW 가 강화·착용 표시와 겹치지 않는다', ov.found.length === 0, ov.found.slice(0, 3));
    const first = s.page.locator('.mpl-cell.has-gear:has(.mpl-new)').first(); await first.click(); rec.did('인벤토리 NEW 칸 클릭(마우스)'); await s.page.waitForTimeout(700);
    rec.check('1280 NEW 칸을 열면 NEW 가 하나 줄어든다', await s.page.evaluate(() => document.querySelectorAll('.mpl-new').length) === loot.length - 1, await s.page.evaluate(() => document.querySelectorAll('.mpl-new').length));
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}
async function A2(browser, rec) { await A2view(browser, rec, VIEW); await A2view(browser, rec, WIDE); await A2inventory(browser, rec); }


/*__INSERT__*/

// ---------- 러너 ----------
const CRITERIA = { A2: ['전리품 비교·장착·판매·강화·새로고침', A2], A4: ['다음 스테이지·지역·권장 Lv·대표 보상', A4], A6: ['상점·소환 단축 일수 문구', A6] };
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
