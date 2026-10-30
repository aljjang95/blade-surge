// 운영 주소 첫 플레이 표본 봇(3개월 R7 QA). 새 게스트로 실제 DOM·CDP 터치 입력으로 첫 30분/1시간을 플레이하고
// 분 단위 목표 시각표·막힘 지점·콘솔 오류를 JSON·Markdown 표로 남긴다.
// 사용: node tools/qa/playtest-first-hour.mjs --profile=a|b [--origin=https://blade.tllhouse.com] [--minutes=30] [--out=work/qa/playtest-a]
//   a: 390x700 세로(Threads 인앱 UA) 첫 30분 / b: 844x390 가로 첫 60분
// 성장 행동(--growth=1 기본): 보상 수령·소환(소환권·무료 보석만)·장비 착용·장비 강화·스킬 강화·현상금 의뢰·첫 보스를 실제 탭으로 수행하고 처음 도달 시각을 firstReached 로 남긴다.
//   --growth=0 이면 예전처럼 AUTO 전투만. 유료 재화(paidGems)·결제 화면은 절대 건드리지 않는다.
// 시계 계약: 소프트웨어 GL(컨테이너)은 약 6fps라 게임 시간이 실시간의 약 0.3배로 흐른다. 그래서 전투 중 "기다리는 구간"만
//   app.step(0.05, false) 로 빨리 감고(전투 판정·AI는 게임 코드 그대로), 메뉴·로딩·화면 대기는 벽시계 그대로 더한다.
//   표본의 분 단위 시각 = 전투 게임 시간 + 메뉴 벽시계 시간. 전투의 처음 구간은 빨리 감지 않고 실제 터치로 직접 조작한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const arg = (k, d) => process.argv.find(v => v.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// 인앱 UA(tools/qa/inapp-touch.mjs 와 같은 Threads 문자열; 그 파일은 import 만으로 실행돼 복사한다).
const THREADS_UA = 'Mozilla/5.0 (Linux; Android 15; SM-S948N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36 Barcelona 390.0.0.28.85 Android (35/15; 450dpi; 1080x2340; samsung; SM-S948N; e3q; qcom; ko_KR; 812345678)';
const profile = arg('profile', 'a');
const ORIGIN = arg('origin', 'https://blade.tllhouse.com');
const TARGET_MIN = Number(arg('minutes', profile === 'a' ? 30 : 60));
const VIEW = profile === 'a' ? { width: 390, height: 700 } : { width: 844, height: 390 };
const UA = profile === 'a' ? THREADS_UA : undefined;
const GROWTH = arg('growth', '1') !== '0';
const OUT = path.resolve(arg('out', `work/qa/playtest-${profile}`));
const HUMAN = { tap: 900, read: 2200 }; // 보수적 사람 속도(ms): 탭 사이 간격·화면 읽는 시간

const events = []; const defects = []; const consoleErrors = []; const shots = [];
const stageLog = []; let wall = null;
let battleSec = 0; let menuMs = 0; let lastMark = Date.now(); let battles = 0; let losses = 0; const wallStart = Date.now();
const clock = () => battleSec + menuMs / 1000;
const firstReached = {}; // 행동 → { t(초), at, note, level(증거 수준) }. 모두 실제 탭이 일으킨 상태 변화를 읽어 기록한다.
const reach = (name, note = '') => { if (firstReached[name]) return false; firstReached[name] = { t: Math.round(clock()), at: fmt(clock()), note, evidence: 'manual' }; console.log(`[최초:${name}] ${fmt(clock())} ${note}`); return true; };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mark = () => { lastMark = Date.now(); };
const addMenu = () => { menuMs += Date.now() - lastMark; lastMark = Date.now(); };
const ev = (name, note = '') => { const e = { t: Math.round(clock()), at: fmt(clock()), name, note }; events.push(e); console.log(`[${e.at}] ${name} ${note}`); return e; };
const defect = (where, text) => { defects.push({ at: fmt(clock()), where, text }); console.log(`[결함] ${where}: ${text}`); };

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launchOpts());
const ctx = await browser.newContext({ viewport: VIEW, isMobile: true, hasTouch: true, deviceScaleFactor: 1, ...(UA ? { userAgent: UA } : {}) });
await installAutoStarter(ctx);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ at: fmt(clock()), text: m.text().slice(0, 240) }); });
page.on('pageerror', e => consoleErrors.push({ at: fmt(clock()), text: `pageerror ${e.message.slice(0, 240)}` }));

const sleep = ms => page.waitForTimeout(ms);
async function shot(tag) {
  const f = `${String(shots.length + 1).padStart(2, '0')}-${tag}.png`;
  await page.screenshot({ path: path.join(OUT, f) }).catch(() => {}); shots.push({ at: fmt(clock()), f, tag });
}
// 세로 이용자는 로비·결과 뒤에도 가로 전환 안내가 탭을 가로막을 수 있다. 보이면 먼저 "세로로 계속하기"를 누른다.
async function dismissRotate() {
  const rot = page.locator('#btn-ignore-rotate');
  if (await rot.isVisible().catch(() => false)) { ev('가로 전환 안내', '탭을 막아 세로로 계속하기 누름'); await rot.tap({ timeout: 3000 }).catch(() => {}); await sleep(HUMAN.tap); }
}
async function tap(sel, { optional = false, label = sel } = {}) {
  await dismissRotate();
  const l = page.locator(sel).first();
  if (!(await l.isVisible().catch(() => false))) { if (!optional) defect('탭', `${label} 안 보임`); return false; }
  await l.tap({ timeout: 5000 }).catch(e => { defect('탭', `${label} 실패 ${String(e.message).split('\n')[0].slice(0, 80)}`); });
  await sleep(HUMAN.tap); return true;
}
async function tapText(text, opts = {}) {
  const l = page.getByRole('button', { name: text }).first();
  if (!(await l.isVisible().catch(() => false))) return false;
  await l.tap({ timeout: 5000 }).catch(() => {}); await sleep(HUMAN.tap); return true;
}
const state = () => page.evaluate(() => {
  const a = window.app; const b = a.battle; const s = a.eco.s;
  return { mode: a.mode, active: !!b?.active, el: b?.elapsed || 0, hp: b?.player?.hp, maxHp: b?.player?.maxHp, auto: !!b?.player?.auto,
    lv: s.heroes?.[s.selected]?.level, hero: s.selected, gold: s.gold, gems: s.gems, energy: s.energy, unlocked: s.progress?.unlocked,
    stars: Object.keys(s.progress?.stars || {}).length, tut: s.tutorial,
    tickets: s.tickets, paidGems: s.paidGems || 0, pulls: s.totalPulls || 0, stones: s.stones, inv: (s.inventory || []).length,
    enh: (s.inventory || []).reduce((n, i) => n + (i.enh || 0), 0), equipped: Object.values(s.heroes?.[s.selected]?.equip || {}).filter(v => v != null).length,
    skillSum: (s.heroes?.[s.selected]?.skills || []).reduce((n, v) => n + v, 0), roster: Object.keys(s.heroes || {}).length,
    bounty: (() => { try { return a.eco.bountySummary(); } catch { return null; } })() };
});

// 로비까지: 부팅 → 시작 → 게스트로 시작 → (세로면) 세로로 계속하기. 걸린 벽시계 시간을 그대로 시계에 더한다.
async function boot() {
  mark();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const deadline = Date.now() + 240000; let rotateShown = false; let guestAt = 0;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show')).catch(() => false)) break;
    const rot = page.locator('#btn-ignore-rotate');
    if (await rot.isVisible().catch(() => false)) { if (!rotateShown) { rotateShown = true; ev('가로 전환 안내', '세로 이용자에게 먼저 뜸'); } await sleep(HUMAN.read); await rot.tap().catch(() => {}); }
    const st = page.locator('#boot-start:not(.hidden)'); if (await st.isVisible().catch(() => false)) { await sleep(HUMAN.tap); await st.tap().catch(() => {}); }
    const g = page.getByRole('button', { name: '게스트로 시작' }); if (await g.isVisible().catch(() => false)) { guestAt = guestAt || clock(); await sleep(HUMAN.tap); await g.tap().catch(() => {}); }
    await sleep(500);
  }
  const rot = page.locator('#btn-ignore-rotate'); if (await rot.isVisible().catch(() => false)) { await sleep(HUMAN.read); await rot.tap().catch(() => {}); }
  addMenu();
  const s = await state(); if (s.mode !== 'lobby') throw Error('로비 진입 실패');
  ev('로비 도착', `영웅 ${s.hero} · 에너지 ${s.energy} · 골드 ${s.gold} · 보석 ${s.gems}`);
  await shot('lobby');
}

async function stick(dx, dy, ms) {
  const r = await page.evaluate(() => { const e = document.querySelector('#joy .joy-base') || document.querySelector('#joy'); const b = e?.getBoundingClientRect(); return b && b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; });
  if (!r) return false;
  const pt = { id: 1, radiusX: 8, radiusY: 8, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pt, x: r.x, y: r.y }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...pt, x: r.x + dx * i * 12, y: r.y + dy * i * 12 }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}


// ---- 성장 행동 (실제 탭만. 읽기용 window.app 조회로 "달라졌는지"만 확인) ----
const dialogOpen = () => page.evaluate(() => !!document.querySelector('dialog[open], #reveal.show, #modal.show'));
async function closeAll() {
  for (let i = 0; i < 8; i++) {
    await dismissRotate();
    if (await page.locator('#reveal.show').count()) { for (const sel of ['#btn-reveal-skip', '#btn-reveal-close']) { const l = page.locator(sel); if (await l.isVisible().catch(() => false)) await l.tap({ timeout: 3000 }).catch(() => {}); } await sleep(500); continue; }
    const closers = ['dialog[open] .oath-menu-close', 'dialog[open] button[aria-label="닫기"]', '.i-close', '#modal.show #m-cancel', '#modal.show #m-ok', 'dialog[open] button:has-text("닫기")', 'dialog[open] button:has-text("×")'];
    let hit = false;
    for (const c of closers) { const l = page.locator(c).first(); if (await l.isVisible().catch(() => false)) { await l.tap({ timeout: 3000 }).catch(() => {}); await sleep(500); hit = true; break; } }
    if (!hit) { if (!(await dialogOpen())) break; await page.keyboard.press('Escape'); await sleep(400); }
  }
}
// 하단 탭으로 던전(출격 화면) 홈으로 돌아온다.
async function toDungeonHome() {
  await closeAll();
  const home = page.getByRole('button', { name: '던전', exact: true }).first();
  if (await home.isVisible().catch(() => false)) { await home.tap({ timeout: 3000 }).catch(() => {}); await sleep(700); }
}
async function openMenuEntry(sel, label) {
  await closeAll();
  if (!(await tap('.oath-nav-menu', { optional: true, label: '메뉴' }))) return false;
  await sleep(500);
  return tap(sel, { optional: true, label });
}
// 임무·보급·우편·업적 창: "받기/수령" 계열 버튼을 보이는 대로 누른다(상점·결제 문구는 누르지 않는다).
async function claimWindow(btnSel, name) {
  if (!(await openMenuEntry(btnSel, name))) { await closeAll(); return 0; }
  await sleep(900);
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const b = page.locator('dialog[open] button:not([disabled]), #modal.show button:not([disabled])').filter({ hasText: /^(받기|수령|모두 받기|전부 받기|보상 받기|일괄 수령)/ }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    const before = await state();
    await b.tap({ timeout: 3000 }).catch(() => {}); await sleep(HUMAN.tap); n++;
    const after = await state();
    if (after.gold !== before.gold || after.gems !== before.gems || after.energy !== before.energy || after.tickets !== before.tickets) reach('reward-claim', `${name} 수령 · 골드 ${before.gold}→${after.gold} 보석 ${before.gems}→${after.gems} 소환권 ${before.tickets}→${after.tickets}`);
  }
  await closeAll();
  return n;
}
async function claimAll() {
  let total = 0;
  for (const [sel, name] of [['#btn-quest', '임무'], ['#btn-idle', '보급'], ['#btn-mail', '우편'], ['#btn-achieve', '업적']]) {
    const n = await claimWindow(sel, name); total += n; if (n) ev('보상 수령', `${name} ${n}건`);
  }
  await toDungeonHome(); return total;
}
// 소환: 소환권이 있으면 장비 소환 배너에서 1회씩. 소환권이 없고 paidGems 가 0이면 무료(시작 지급) 보석으로 단일 소환만 한정 횟수.
async function summon(maxGemPulls = 3) {
  const s0 = await state();
  if (s0.tickets <= 0 && !(s0.paidGems === 0 && s0.gems >= 300 && maxGemPulls > 0)) return 0;
  if (!(await openMenuEntry('[data-menu-key="tab:gacha"]', '소환 탭'))) { await closeAll(); return 0; }
  await sleep(900);
  const tab = page.locator('.gz-tab').nth(1); if (await tab.isVisible().catch(() => false)) { await tab.tap({ timeout: 3000 }).catch(() => {}); await sleep(700); }
  let pulls = 0, gemPulls = 0;
  for (let i = 0; i < 8; i++) {
    const before = await state();
    const useTicket = before.tickets > 0;
    if (!useTicket && !(before.paidGems === 0 && before.gems >= 300 && gemPulls < maxGemPulls)) break;
    if (!(await tap('#btn-pull1', { optional: true, label: '1회 소환' }))) break;
    for (let q = 0; q < 24; q++) { await sleep(400); if (!(await page.locator('#reveal.show').count())) break; for (const sel of ['#btn-reveal-skip', '#btn-reveal-close']) { const l = page.locator(sel); if (await l.isVisible().catch(() => false)) await l.tap({ timeout: 3000 }).catch(() => {}); } }
    const after = await state();
    if (after.pulls > before.pulls) { pulls++; if (!useTicket) gemPulls++; reach('summon-first', `${useTicket ? '소환권' : '무료 보석'} · 장비 ${before.inv}→${after.inv}`); }
    else break;
  }
  await toDungeonHome();
  if (pulls) ev('소환', `${pulls}회(보석 ${gemPulls}회)`);
  return pulls;
}
// 장비 착용: 영웅·장비 화면의 "▲ 더 좋은 장비 장착" 버튼(실제 이용자가 누르는 자동 장착 제안).
async function equipBetter() {
  await closeAll();
  const nav = page.getByRole('button', { name: '영웅·장비' }).first();
  if (!(await nav.isVisible().catch(() => false))) return false;
  await nav.tap({ timeout: 3000 }).catch(() => {}); await sleep(1200);
  const before = await state(); let did = false;
  for (let i = 0; i < 4; i++) {
    const b = page.getByRole('button', { name: /더 좋은 장비 장착/ }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.tap({ timeout: 3000 }).catch(() => {}); await sleep(900); did = true;
  }
  const after = await state();
  if (did || after.equipped > before.equipped) { reach('equip-first', `착용 ${before.equipped}→${after.equipped}`); ev('장비 착용', `${before.equipped}→${after.equipped}`); }
  return did;
}
// 장비 강화: 영웅·장비 화면에서 가방 장비를 눌러 "강화하기". 골드가 허락하는 만큼 몇 번만.
async function enhanceGear(maxTaps = 6) {
  const nav = page.getByRole('button', { name: '영웅·장비' }).first();
  if (!(await page.locator('.bag-item').first().isVisible().catch(() => false))) { if (!(await nav.isVisible().catch(() => false))) return 0; await nav.tap({ timeout: 3000 }).catch(() => {}); await sleep(1200); }
  const items = page.locator('.bag-item'); const count = Math.min(await items.count(), 3);
  let taps = 0; const b0 = await state();
  for (let i = 0; i < count && taps < maxTaps; i++) {
    await items.nth(i).tap({ timeout: 4000 }).catch(() => {}); await sleep(700);
    for (let k = 0; k < 3 && taps < maxTaps; k++) {
      const go = page.locator('.e-go').first();
      if (!(await go.isVisible().catch(() => false)) || await go.isDisabled().catch(() => true)) break;
      await go.tap({ timeout: 4000 }).catch(e => defect('강화', String(e.message).split('\n')[0].slice(0, 100))); await sleep(1300); taps++;
    }
    await closeAllDetail();
  }
  const a1 = await state();
  if (a1.enh > b0.enh || a1.gold < b0.gold) { reach('enhance-first', `강화합 ${b0.enh}→${a1.enh} · 골드 ${b0.gold}→${a1.gold}`); ev('장비 강화', `${taps}번 · 강화합 ${b0.enh}→${a1.enh}`); }
  return taps;
}
async function closeAllDetail() { const c = page.locator('.i-close').first(); if (await c.isVisible().catch(() => false)) { await c.tap({ timeout: 3000 }).catch(() => {}); await sleep(500); } }
// 스킬 강화: 영웅·장비 → 스킬 트리 → "+"(SP) 눌러 올린 뒤 "강화".
async function skillUp() {
  const nav = page.getByRole('button', { name: '영웅·장비' }).first();
  const tree = page.getByRole('button', { name: '스킬 트리' }).first();
  if (!(await tree.isVisible().catch(() => false))) { if (!(await nav.isVisible().catch(() => false))) return 0; await nav.tap({ timeout: 3000 }).catch(() => {}); await sleep(1200); }
  if (!(await tree.isVisible().catch(() => false))) return 0;
  await tree.tap({ timeout: 3000 }).catch(() => {}); await sleep(900);
  const b0 = await state(); let ups = 0;
  for (let i = 0; i < 10; i++) {
    const act = page.locator('button:not([disabled])').filter({ hasText: /^강화 \(SP/ }).first();
    if (await act.isVisible().catch(() => false)) { await act.tap({ timeout: 3000 }).catch(() => {}); await sleep(700); ups++; continue; }
    const plus = page.locator('.st-plus:not([disabled])').first();
    if (await plus.isVisible().catch(() => false)) { await plus.tap({ timeout: 3000 }).catch(() => {}); await sleep(700); ups++; continue; }
    break;
  }
  const a1 = await state();
  if (a1.skillSum > b0.skillSum) { reach('skill-up-first', `스킬 합 ${b0.skillSum}→${a1.skillSum}`); ev('스킬 강화', `${b0.skillSum}→${a1.skillSum}`); }
  await closeAll(); return ups;
}
async function growthRound(why) {
  if (!GROWTH) return;
  mark(); ev('성장 라운드', why);
  const b = await state();
  await summon(); await equipBetter(); await enhanceGear(); await skillUp(); await claimAll(); await toDungeonHome();
  addMenu(); const a = await state();
  ev('성장 결과', `소환 ${b.pulls}→${a.pulls} · 착용 ${b.equipped}→${a.equipped} · 강화합 ${b.enh}→${a.enh} · 스킬합 ${b.skillSum}→${a.skillSum} · 골드 ${b.gold}→${a.gold}`);
  await shot(`growth-${why.replace(/[^a-z0-9가-힣]+/gi, '-')}`);
}
// 현상금 의뢰판: 열려 있으면 첫 의뢰 "출발"을 눌러 전투로 들어간다(에너지 소모 없음).
async function bountyRun() {
  const s0 = await state();
  if (!s0.bounty?.open) return null;
  if (!(await openMenuEntry('#menu-bounty', '현상금 의뢰판'))) { await closeAll(); return null; }
  await sleep(900);
  reach('bounty-board-open', `의뢰 ${s0.bounty.available}건`);
  const go = page.locator('#bounty .bounty-go').first();
  if (!(await go.isVisible().catch(() => false))) { await closeAll(); return null; }
  await go.tap({ timeout: 4000 }).catch(() => {}); await sleep(HUMAN.tap);
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active, null, { timeout: 120000 }).catch(() => {});
  reach('bounty-accept', '의뢰 출발 탭');
  return true;
}

// 전투: 첫 전투는 튜토리얼을 읽고 직접 조작한 뒤 AUTO, 그 뒤는 AUTO 로 빨리 감는다.
async function playBattle(first) {
  await page.waitForFunction(() => window.app.battle?.active && window.app.battle.elapsed > .5 && window.app.input.enabled, null, { timeout: 180000 }).catch(() => defect('전투', '전투 시작 대기 3분 초과'));
  const t0 = (await state()).el; mark(); addMenu();
  const startClock = clock(); const base = battleSec;
  let lost = false;
  const meta = await page.evaluate(() => { const st = window.app.battle.stage || {}; return { code: st.code || st.id || '?', rank: st.rank || '', st: st.st, bounty: st.bounty?.id || '', tower: !!st.tower }; });
  if (['captain', 'warden', 'midboss', 'finalboss'].includes(meta.rank)) { const first = reach(`boss-first-attempt`, `${meta.code} ${meta.rank}`); if (first) ev('첫 보스 도전', `${meta.code} ${meta.rank}`); }
  const live = async () => { const s = await state(); battleSec = base + s.el; return s; };
  if (first) {
    ev('첫 전투 시작', '튜토리얼 안내 표시');
    await shot('battle-1-start');
    for (let i = 0; i < 6; i++) { if (!(await tap('#tutorial-next', { optional: true }))) break; await sleep(HUMAN.read); }
    const skipped = await tap('#tutorial-skip', { optional: true });
    await live();
    // 직접 조작: 움직였다가 공격 연타(실제 터치 입력).
    for (const [dx, dy] of [[1, 0], [0, -1], [-1, 0], [0, 1]]) { await stick(dx, dy, 700); for (let k = 0; k < 3; k++) { await tap('#btn-attack', { optional: true }); } await live(); }
    ev('직접 조작 완료', `조이스틱 4방향 + 공격 · 튜토리얼 ${skipped ? '건너뜀' : '진행'}`);
  }
  let s = await live();
  if (!s.auto) { if (await tap('#btn-auto', { optional: true, label: 'AUTO 버튼' })) ev('AUTO 켬', first ? '첫 전투' : ''); }
  // 빨리 감기: 렌더 없이 0.05초 단위 스텝. 전투가 끝나거나 15분 게임 시간이 차면 멈춘다.
  for (let guard = 0; guard < 80; guard++) {
    s = await live();
    if (!s.active || s.mode !== 'battle') break;
    // 주인공이 쓰러지면(hp 0) 부활창이 뜰 때까지만 3초 더 감고 멈춘다. 부활창 뒤로 계속 감으면 시계가 부풀려진다.
    const dead = await page.evaluate(() => { const a = window.app; a.testPause = true; let down = 0; try { for (let i = 0; i < 400 && a.battle.active; i++) { a.step(0.05, false); if (a.battle.player.hp <= 0 && ++down > 60) break; } } finally { a.testPause = false; } return !a.battle.active; });
    if (dead) break;
    if (await page.locator('#r-no').isVisible().catch(() => false)) { lost = true; break; }
  }
  s = await live(); mark();
  battles++;
  return { ...s, lost, meta };
}

async function result() {
  await page.waitForFunction(() => document.querySelector('#result.show, #result.on, #result:not(.hidden)') && getComputedStyle(document.querySelector('#result')).display !== 'none', null, { timeout: 60000 }).catch(() => {});
  await sleep(HUMAN.read);
  const info = await page.evaluate(() => ({ title: document.querySelector('#result-title')?.innerText, lvl: document.querySelector('#result-levelup')?.innerText, vis: [...document.querySelectorAll('#result button')].filter(b => b.offsetParent).map(b => b.id || b.innerText.slice(0, 8)) }));
  return info;
}

try {
  await boot();
  // ---- 캠페인 1-1부터 순서대로. 목표 시각까지 반복. 전투 사이 로비에서 성장 행동(소환·착용·강화·스킬·보상·의뢰)을 한다. ----
  let sameStageLosses = 0; let lastLossStage = ''; let fromBounty = false; let grew = false;
  while (clock() < TARGET_MIN * 60) {
    const s0 = await state();
    if (s0.mode !== 'lobby') { defect('흐름', `로비 아님: ${s0.mode}`); break; }
    mark();
    await sleep(1500);
    // 로비에 뜨는 보상·안내 창(출석 보상 등)은 이용자처럼 "보상 받기"/확인으로 처리하고 시각표에 남긴다.
    for (let k = 0; k < 5; k++) {
      const ok = page.locator('#m-ok'); if (!(await ok.isVisible().catch(() => false))) break;
      const head = await page.evaluate(() => (document.querySelector('#m-ok')?.closest('dialog, .modal, [role=dialog], div')?.innerText || '').slice(0, 30).replace(/\s+/g, ' '));
      await shot(`lobby-modal-${k + 1}`);
      ev('로비 창 처리', `${head} → ${(await ok.innerText().catch(() => '')).trim()}`);
      const b0 = await state();
      await ok.tap({ timeout: 4000 }).catch(() => defect('로비', '창 확인 버튼 탭 실패'));
      await sleep(HUMAN.read);
      const a0 = await state(); if (a0.gold !== b0.gold || a0.gems !== b0.gems || a0.tickets !== b0.tickets) reach('reward-claim', `로비 창 ${head} 수령`);
    }
    // 성장 라운드: 첫 승리 직후(소환권 등 즉시 사용 가능), 그리고 쓰러진 뒤 매번.
    if (GROWTH && (!grew || sameStageLosses > 0)) { await growthRound(grew ? `${lastLossStage} 쓰러진 뒤` : '첫 승리 뒤'); grew = true; }
    addMenu();
    // 의뢰판이 열렸으면(1-10 클리어 뒤) 첫 의뢰를 한 번 수락한다.
    let startedBounty = false;
    if (GROWTH && !firstReached['bounty-accept']) { startedBounty = !!(await bountyRun()); addMenu(); }
    if (!startedBounty) {
      await toDungeonHome();
      if (!(await page.locator('#citadel-dungeon-prepare').first().isVisible().catch(() => false))) {
        const seen = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.id || '') + '|' + (b.innerText || '').slice(0, 10).replace(/\s+/g, ' ')).slice(0, 25));
        defect('로비', `출격 버튼 없음 · 버튼 ${seen.join(' ')}`);
        await shot('lobby-no-sortie');
      }
      await tap('#citadel-dungeon-prepare', { label: '출격' }); await sleep(HUMAN.read);
      await tap('#stage-select-enter', { label: '입장' });
    }
    addMenu();
    const s1 = await playBattle(battles === 0);
    mark();
    const code = s1.meta?.code;
    if (s1.lost) {
      // AUTO 만으로 쓰러졌다: 이용자는 부활(보석 50) 또는 정비하기를 고른다. 봇은 정비하기(무료)를 눌러 막힘 시각을 남긴다.
      losses++; sameStageLosses = code === lastLossStage ? sameStageLosses + 1 : 1; lastLossStage = code;
      ev('쓰러짐·부활창', `${code} · Lv.${s1.lv} · 진행 ${s1.unlocked} · 전투 ${Math.round(s1.el)}초 · ${losses}번째(같은 단계 연속 ${sameStageLosses})`); await shot(`down-${losses}`);
      stageLog.push({ code, win: false, at: fmt(clock()), battleSec: Math.round(s1.el), lv: s1.lv, enh: s1.enh, equipped: s1.equipped, skillSum: s1.skillSum });
      await tap('#r-no', { optional: true, label: '정비하기' });
      if (sameStageLosses >= 4) { ev('벽 도달', `${code}: 성장 행동 ${sameStageLosses}번 뒤에도 같은 단계에서 계속 쓰러짐`); wall = { code, attempts: sameStageLosses, lv: s1.lv, enh: s1.enh, equipped: s1.equipped, skillSum: s1.skillSum, gold: s1.gold }; await sleep(HUMAN.read); break; }
    } else { sameStageLosses = 0; }
    const r = await result(); addMenu();
    const win = /VICTORY|승리|클리어/i.test(r.title || '') && !s1.lost;
    ev(`전투 ${battles} 끝`, `${code} ${r.title} · Lv.${s1.lv} · 진행 ${s1.unlocked} · 버튼 ${r.vis.join(',')}`);
    if (win) {
      reach('first-win', `${code} Lv.${s1.lv}`); reach(`clear-${code}`, `Lv.${s1.lv} 강화합 ${s1.enh} 스킬합 ${s1.skillSum}`);
      stageLog.push({ code, win: true, at: fmt(clock()), battleSec: Math.round(s1.el), lv: s1.lv, enh: s1.enh, equipped: s1.equipped, skillSum: s1.skillSum });
      if (s1.meta?.bounty) { reach('bounty-complete', `의뢰 ${s1.meta.bounty}`); ev('의뢰 완료', s1.meta.bounty); }
      if (['midboss', 'finalboss'].includes(s1.meta?.rank)) reach('boss-first-clear', `${code} ${s1.meta.rank}`);
      reach('victory-reward', `${r.title} · ${r.lvl || ''}`.trim());
    }
    await shot(`result-${battles}`);
    mark();
    // 승리 직후 결과 화면의 "지금 쓸 곳"(스킬 강화 ›, 더 좋은 장비 등)을 처음 한 번은 이용자처럼 눌러 본다.
    const use = page.locator('#btn-result-use:not([hidden]):not([disabled])');
    if (GROWTH && win && !firstReached['result-use-tap'] && await use.isVisible().catch(() => false)) {
      const label = (await use.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      await use.tap({ timeout: 4000 }).catch(() => defect('결과', '지금 쓸 곳 탭 실패'));
      await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 30000 }).catch(() => {});
      reach('result-use-tap', label); ev('결과의 지금 쓸 곳 탭', label); await sleep(HUMAN.read); await shot('result-use-dest'); await toDungeonHome();
    } else if (!(await tap('#btn-result-lobby', { optional: true }))) {
      const seen = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.id || '') + '|' + (b.innerText || '').slice(0, 10).replace(/\s+/g, ' ')).slice(0, 25));
      defect('결과', `로비 버튼 없음 · 버튼 ${seen.join(' ')}`); await shot('result-no-lobby'); break;
    }
    await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 }).catch(() => defect('결과', '로비 복귀 60초 초과'));
    addMenu();
    if (battles >= 60) break;
  }
} catch (e) { defect('봇 중단', String(e.stack || e).slice(0, 300)); }

const final = await state().catch(() => ({}));
const out = { profile, origin: ORIGIN, viewport: VIEW, ua: UA ? 'threads' : '기본', targetMin: TARGET_MIN, gameMinutes: +(clock() / 60).toFixed(1), wallMinutes: +((Date.now() - wallStart) / 60000).toFixed(1), battles, losses, final, firstReached, stageLog, wall, growth: GROWTH, events, defects, consoleErrors, shots, at: new Date().toISOString() };
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(out, null, 2));
console.log(`끝: 게임 시계 ${out.gameMinutes}분 · 벽시계 ${out.wallMinutes}분 · 전투 ${battles} · 결함 ${defects.length} · 콘솔오류 ${consoleErrors.length}`);
await browser.close();
