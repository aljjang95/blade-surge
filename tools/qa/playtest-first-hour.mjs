// 운영 주소 첫 플레이 표본 봇(3개월 R7 QA). 새 게스트로 실제 DOM·CDP 터치 입력으로 첫 30분/1시간을 플레이하고
// 분 단위 목표 시각표·막힘 지점·콘솔 오류를 JSON·Markdown 표로 남긴다.
// 사용: node tools/qa/playtest-first-hour.mjs --profile=a|b [--origin=https://blade.tllhouse.com] [--minutes=30] [--out=work/qa/playtest-a]
//   a: 390x700 세로(Threads 인앱 UA) 첫 30분 / b: 844x390 가로 첫 60분
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
const OUT = path.resolve(arg('out', `work/qa/playtest-${profile}`));
const HUMAN = { tap: 900, read: 2200 }; // 보수적 사람 속도(ms): 탭 사이 간격·화면 읽는 시간

const events = []; const defects = []; const consoleErrors = []; const shots = [];
let battleSec = 0; let menuMs = 0; let lastMark = Date.now(); let battles = 0; const wallStart = Date.now();
const clock = () => battleSec + menuMs / 1000;
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
    stars: Object.keys(s.progress?.stars || {}).length, tut: s.tutorial };
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

// 전투: 첫 전투는 튜토리얼을 읽고 직접 조작한 뒤 AUTO, 그 뒤는 AUTO 로 빨리 감는다.
async function playBattle(first) {
  await page.waitForFunction(() => window.app.battle?.active && window.app.battle.elapsed > .5 && window.app.input.enabled, null, { timeout: 180000 }).catch(() => defect('전투', '전투 시작 대기 3분 초과'));
  const t0 = (await state()).el; mark(); addMenu();
  const startClock = clock(); const base = battleSec;
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
    const dead = await page.evaluate(() => { const a = window.app; a.testPause = true; try { for (let i = 0; i < 400 && a.battle.active; i++) a.step(0.05, false); } finally { a.testPause = false; } return !a.battle.active; });
    if (dead) break;
  }
  s = await live(); mark();
  battles++;
  return s;
}

async function result() {
  await page.waitForFunction(() => document.querySelector('#result.show, #result.on, #result:not(.hidden)') && getComputedStyle(document.querySelector('#result')).display !== 'none', null, { timeout: 60000 }).catch(() => {});
  await sleep(HUMAN.read);
  const info = await page.evaluate(() => ({ title: document.querySelector('#result-title')?.innerText, lvl: document.querySelector('#result-levelup')?.innerText, vis: [...document.querySelectorAll('#result button')].filter(b => b.offsetParent).map(b => b.id || b.innerText.slice(0, 8)) }));
  return info;
}

try {
  await boot();
  // ---- 1단계: 캠페인 1-1부터 순서대로. 목표 시각까지 반복. ----
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
      await ok.tap({ timeout: 4000 }).catch(() => defect('로비', '창 확인 버튼 탭 실패'));
      await sleep(HUMAN.read);
    }
    if (!(await page.locator('#citadel-dungeon-prepare').first().isVisible().catch(() => false))) {
      const seen = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.id || '') + '|' + (b.innerText || '').slice(0, 10).replace(/\s+/g, ' ')).slice(0, 25));
      defect('로비', `출격 버튼 없음 · 버튼 ${seen.join(' ')}`);
      await shot('lobby-no-sortie');
    }
    await tap('#citadel-dungeon-prepare', { label: '출격' }); await sleep(HUMAN.read);
    await tap('#stage-select-enter', { label: '입장' });
    addMenu();
    const s1 = await playBattle(battles === 0);
    mark();
    const r = await result(); addMenu();
    ev(`전투 ${battles} 끝`, `${r.title} · Lv.${s1.lv} · 진행 ${s1.unlocked} · 버튼 ${r.vis.join(',')}`);
    await shot(`result-${battles}`);
    mark();
    if (!(await tap('#btn-result-lobby', { optional: true }))) { defect('결과', '로비 버튼 없음'); break; }
    await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 }).catch(() => defect('결과', '로비 복귀 60초 초과'));
    addMenu();
    if (battles >= 40) break;
  }
} catch (e) { defect('봇 중단', String(e.stack || e).slice(0, 300)); }

const final = await state().catch(() => ({}));
const out = { profile, origin: ORIGIN, viewport: VIEW, ua: UA ? 'threads' : '기본', targetMin: TARGET_MIN, gameMinutes: +(clock() / 60).toFixed(1), wallMinutes: +((Date.now() - wallStart) / 60000).toFixed(1), battles, final, events, defects, consoleErrors, shots, at: new Date().toISOString() };
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(out, null, 2));
console.log(`끝: 게임 시계 ${out.gameMinutes}분 · 벽시계 ${out.wallMinutes}분 · 전투 ${battles} · 결함 ${defects.length} · 콘솔오류 ${consoleErrors.length}`);
await browser.close();
