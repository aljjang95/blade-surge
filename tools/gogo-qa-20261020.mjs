// 사이클 20261020-hero-sfx-autotarget-vfx 브라우저 QA(A1~A8). 실제 개발 서버·실제 터치 입력으로 검증한다.
// 사용: node tools/gogo-qa-20261020.mjs --origin http://127.0.0.1:5342/ --out work/qa/gogo-20261020 [--only A3,A4]
// 규칙: 상태 준비(영웅 레벨·등급·재화·선택 영웅·튜토리얼 완료)와 전투 위치·방향 픽스처만 주입하고 보고서에 injected 로 남긴다.
//       전투 진입·공격·스킬·AUTO·설정·스킬 트리는 실제 탭(Playwright 터치, 다중 터치는 CDP)이다. src/ 는 수정하지 않는다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const origin = arg('origin', 'http://127.0.0.1:5342/');
const out = path.resolve(arg('out', 'work/qa/gogo-20261020'));
const only = arg('only') ? arg('only').split(',').map((s) => s.trim().toUpperCase()) : null;
const VIEW = { width: 844, height: 390 }, WIDE = { width: 1280, height: 590 };
const HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad2deg = (r) => r * 180 / Math.PI;
const round = (n, d = 2) => (Number.isFinite(n) ? +n.toFixed(d) : n);
await fs.mkdir(out, { recursive: true });

// ---------- 보고서 레코드 ----------
function newRec(id, title) {
  const rec = { id, title, pass: false, checks: [], injected: [], real: [], observed: {}, captures: [], pageErrors: [], started: new Date().toISOString() };
  rec.check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };
  rec.inject = (t) => { if (!rec.injected.includes(t)) rec.injected.push(t); };
  rec.did = (t) => { if (!rec.real.includes(t)) rec.real.push(t); };
  rec.obs = (k, v) => { rec.observed[k] = v; };
  rec.shot = async (s, name) => {
    const file = rec.id + '-' + name + '.png';
    await s.page.screenshot({ path: path.join(out, file) });
    rec.captures.push(file); return file;
  };
  return rec;
}

// ---------- 세션(브라우저 컨텍스트) ----------
async function open(browser, rec, viewport = VIEW) {
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const s = { context, page, rec, viewport, requests: [], cdp: null };
  page.on('pageerror', (e) => rec.pageErrors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/Ignored attempt to cancel a touchstart event with cancelable=false/.test(t)) { rec.ignoredConsole = (rec.ignoredConsole || 0) + 1; return; } rec.pageErrors.push('console: ' + t.slice(0, 300)); });
  page.on('request', (r) => { if (r.url().includes('/sfx/')) s.requests.push({ t: Date.now(), url: new URL(r.url()).pathname }); });
  s.cdp = await context.newCDPSession(page);
  s.close = () => context.close();
  return s;
}

async function closeModals(page) {
  for (let n = 0; n < 6; n++) {
    const c = page.locator('#modal.show #m-cancel');
    if (!await c.isVisible().catch(() => false)) break;
    await c.tap(); await page.waitForTimeout(250);
  }
}

// 부팅: #btn-ignore-rotate → #boot-start → 로비. 출석 등 모달은 실제 탭으로 닫는다.
async function boot(s) {
  const { page } = s;
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await closeModals(page);
  s.rec.did('부팅: #btn-ignore-rotate·#boot-start 실제 탭 → lobby');
}

// 상태 준비(주입): 튜토리얼 완료 처리, 선택 영웅, 영웅 레벨·등급, 재화.
async function prepareState(s, { hero = 'knight', level = null, grade = null, gold = 0, tutorial = true } = {}) {
  const info = await s.page.evaluate(({ hero, level, grade, gold, tutorial }) => {
    const e = window.app.eco;
    if (tutorial) e.s.tutorial = { completed: true };
    e.s.selected = hero;
    const h = e.hero(hero);
    if (level) { h.level = level; h.exp = 0; }
    if (grade) h.grade = grade;
    if (gold) e.addRewards({ gold }, { silent: true });
    e.save(); e.emit?.();
    return { selected: e.s.selected, level: h.level, grade: h.grade, tutorial: e.s.tutorial };
  }, { hero, level, grade, gold, tutorial });
  s.rec.inject('eco 상태 준비: ' + JSON.stringify({ hero, level, grade, gold, tutorial }));
  return info;
}

// 전투 진입(실제 탭): 추천 던전 "출격 준비" → "원정 시작" → (있으면) 인트로 건너뛰기 → battle.
async function enterBattle(s, { settle = 1500 } = {}) {
  const { page } = s;
  await closeModals(page);
  await page.locator('#citadel-dungeon-prepare').tap(); await page.waitForTimeout(900);
  await page.getByRole('button', { name: /원정 시작/ }).tap(); await page.waitForTimeout(700);
  const skip = page.getByRole('button', { name: /건너뛰기/ });
  if (await skip.count()) await skip.first().tap().catch(() => {});
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !!window.app.battle.player, undefined, { timeout: 90000 });
  await page.waitForFunction(() => window.app.battle.elapsed > 0.5, undefined, { timeout: 60000 });
  await page.waitForTimeout(settle);
  s.rec.did('전투 진입: #citadel-dungeon-prepare → 원정 시작 → 건너뛰기 탭 → mode=battle');
}

// 오디오 재생 가로채기: 모듈 싱글톤을 개발 서버 모듈 그래프에서 그대로 import 해 _sample·합성음을 감싼다(src 수정 없음).
async function hookAudio(s) {
  const r = await s.page.evaluate(async () => {
    const { audio } = await import('/src/engine/audio.js');
    const lib = await import('/src/engine/combat-sound-library.js');
    window.__sfx = window.__sfx || [];
    if (!audio.__qaHooked) {
      audio.__qaHooked = true;
      const orig = audio._sample.bind(audio);
      audio._sample = function (buffer, opts = {}) {
        let name = null;
        for (const k of Object.keys(this.buffers)) if (this.buffers[k] === buffer) { name = k; break; }
        window.__sfx.push({ t: performance.now(), name, group: opts.group, url: name && opts.group === 'sfx' ? lib.sfxUrl(name) : null });
        return orig(buffer, opts);
      };
      for (const k of ['whoosh', 'thump', 'contactSnap', 'clang', 'magic', 'charge', 'holy', 'noise']) {
        if (typeof audio[k] !== 'function') continue;
        const f = audio[k].bind(audio);
        audio[k] = (...a) => { window.__sfx.push({ t: performance.now(), name: 'synth:' + k, group: 'synth', url: null }); return f(...a); };
      }
    }
    return { enabled: audio.enabled, ctx: !!audio.ctx, unavailable: !!audio.unavailable, buffers: Object.keys(audio.buffers).length };
  });
  s.rec.did('오디오 계측: audio._sample·합성음 래핑(모듈 싱글톤 import)');
  return r;
}
const sfxLog = (s) => s.page.evaluate(() => window.__sfx || []);
const sfxMark = (s) => s.page.evaluate(() => (window.__sfx || []).length);

// ---------- 전투 픽스처: 가장 가까운 적 고르기·배치 ----------
// 시작 방에는 적이 없다. 적이 없으면 실제 AUTO 버튼을 탭해 다음 방으로 가게 하고, 적이 가까워지면 AUTO 를 다시 탭해 끈다.
async function waitForEnemies(s, timeout = 120000) {
  const { page } = s;
  const live = () => page.evaluate(() => { const b = window.app.battle, P = b?.player; if (!b?.active || !P) return null; const l = b.enemies.filter((e) => e.alive && !e.spawning).map((e) => Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z)); return { n: l.length, min: l.length ? Math.min(...l) : null, auto: P.auto }; });
  let st = await live();
  if (st && st.n > 0) return st;
  await page.locator('#btn-auto').tap(); s.rec.did('AUTO 버튼 실제 탭(적이 있는 방까지 이동)');
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(150); st = await live();
    if (st && st.n > 0 && st.min <= 14) break;
  }
  if (!st || st.n === 0) throw new Error('적이 나타나지 않음(타임아웃) ' + JSON.stringify(st));
  if (st.auto) { await page.locator('#btn-auto').tap(); s.rec.did('AUTO 버튼 실제 탭(끄기)'); await sleep(250); }
  return await live();
}
// 주입: 플레이어를 가장 가까운 적에서 dist 만큼 떨어진 걸어갈 수 있는 곳에 놓고 yaw 를 적의 반대로 돌린다.
async function placeFixture(s, { dist = 3, flip = true } = {}) {
  const r = await s.page.evaluate(({ dist, flip }) => {
    const a = window.app, b = a.battle, P = b.player, W = b.world;
    const live = b.enemies.filter((e) => e.alive && !e.spawning);
    live.sort((x, y) => Math.hypot(x.pos.x - P.pos.x, x.pos.z - P.pos.z) - Math.hypot(y.pos.x - P.pos.x, y.pos.z - P.pos.z));
    const e = live[0]; if (!e) return { ok: false, reason: 'no-enemy' };
    let placed = null;
    for (let k = 0; k < 16 && !placed; k++) {
      const ang = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z) + k * Math.PI / 8 * (k % 2 ? 1 : -1);
      const x = e.pos.x + Math.sin(ang) * dist, z = e.pos.z + Math.cos(ang) * dist;
      if (!W || (W.walkable(x, z) && W.walkable(e.pos.x + (x - e.pos.x) * .5, e.pos.z + (z - e.pos.z) * .5))) placed = { x, z };
    }
    if (!placed) return { ok: false, reason: 'no-walkable-spot' };
    P.pos.set(placed.x, P.pos.y, placed.z); P.vel.set(0, 0, 0); P.lockTarget = null;
    const toEnemy = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    P.yaw = flip ? toEnemy + Math.PI : toEnemy;
    window.__fx = { enemy: e, yaw0: P.yaw };
    const others = live.filter((o) => o !== e).map((o) => Math.hypot(o.pos.x - P.pos.x, o.pos.z - P.pos.z));
    return { ok: true, name: e.def?.name, hp: e.hp, dist: Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z), yaw0: P.yaw, toEnemy, state: P.state, othersMin: others.length ? Math.min(...others) : null };
  }, { dist, flip });
  s.rec.inject('전투 픽스처: 플레이어를 가장 가까운 적에서 ' + dist + ' 거리로 이동하고 yaw 를 ' + (flip ? '적 반대 방향' : '적 방향') + '으로 설정');
  return r;
}
// 프레임마다 yaw·체력·상태를 기록하는 계측(rAF)과 공격 버튼 touchstart 시각.
async function startSampler(s) {
  await s.page.evaluate(() => {
    const S = window.__samp = { rows: [], run: true, tapW: null, tapG: null };
    const btn = document.getElementById('btn-attack');
    btn.addEventListener('touchstart', () => { S.tapW = performance.now(); S.tapG = window.app.battle.elapsed; }, { capture: true, once: true });
    const tick = () => {
      if (!S.run) return;
      const b = window.app.battle, P = b?.player, e = window.__fx?.enemy;
      if (P) S.rows.push({ w: performance.now(), g: b.elapsed, yaw: P.yaw, state: P.state, ehp: e ? e.hp : null, ealive: e ? e.alive : null,
        ex: e ? e.pos.x : null, ez: e ? e.pos.z : null, px: P.pos.x, pz: P.pos.z, abYaw: P.attackBufferYaw, lock: P.lockTarget === e,
        d: e ? Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) : null, einv: e ? (e.invuln || 0) : null, auto: P.auto,
        mx: window.app.input?.move?.x ?? null, my: window.app.input?.move?.y ?? null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function readSampler(s) {
  return s.page.evaluate(() => { window.__samp.run = false; return { tapW: window.__samp.tapW, tapG: window.__samp.tapG, rows: window.__samp.rows }; });
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
// 샘플러 행을 평가: 탭 후 windowSec 안의 yaw 오차(적 방향 대비)·체력 감소 시각.
function evalAttack(sm, fixture0, windowSec = .5) {
  const fixtureHp = fixture0.hp;
  const rows = sm.rows.filter((r) => sm.tapG !== null && r.g >= sm.tapG);
  const before = sm.rows.filter((r) => sm.tapG !== null && r.g < sm.tapG);
  const fixture = { ...fixture0, hp: before.length ? before[before.length - 1].ehp : fixture0.hp };
  if (!rows.length) return { tapped: sm.tapG !== null, rows: 0 };
  const errAt = (r) => Math.abs(rad2deg(angDiff(r.yaw, Math.atan2(r.ex - r.px, r.ez - r.pz))));
  const within = rows.filter((r) => r.g - sm.tapG <= windowSec);
  const hp0 = fixture.hp;
  const hit = rows.find((r) => r.ehp !== null && (r.ehp < hp0 || r.ealive === false));
  const yawShift = (r) => Math.abs(rad2deg(angDiff(r.yaw, fixture.yaw0)));
  return {
    tapped: true, frames: rows.length, windowSec,
    errDegStart: round(errAt(rows[0]), 1), errDegMinInWindow: round(Math.min(...within.map(errAt)), 1), errDegAtWindowEnd: round(errAt(within[within.length - 1]), 1),
    yawShiftMaxInWindowDeg: round(Math.max(...within.map(yawShift)), 1),
    hpBefore: round(hp0, 1), hpFirstDrop: hit ? round(hit.ehp, 1) : null, hpDropAtSec: hit ? round(hit.g - sm.tapG, 3) : null, hpAtPlacement: round(fixtureHp, 1),
    lockSet: within.some((r) => r.lock), states: [...new Set(rows.slice(0, 60).map((r) => r.state))],
  };
}

// 탭 전후 프레임 궤적(원인 분석용): [탭 기준 초, yaw 도, 적 방향 오차 도, 거리, 상태, 입력 이동 x·y, auto]
function traceOf(sm, fromSec = -.15, toSec = .7, step = 3) {
  if (sm.tapG === null) return [];
  return sm.rows.filter((r) => r.g - sm.tapG >= fromSec && r.g - sm.tapG <= toSec).filter((_, i) => i % step === 0).map((r) => [round(r.g - sm.tapG, 2), round(rad2deg(r.yaw), 0),
    round(Math.abs(rad2deg(angDiff(r.yaw, Math.atan2(r.ex - r.px, r.ez - r.pz)))), 0), round(r.d, 1), r.state, round(r.mx, 2), round(r.my, 2), r.auto ? 1 : 0, round(r.ehp, 0)]);
}
// 실제 공격 버튼 탭 한 번.
async function tapAttack(s) { await s.page.locator('#btn-attack').tap(); }

// ---------- CDP 다중 터치(조이스틱 드래그 + 공격) ----------
const touchSend = (s, type, points) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
async function joystickAttack(s, { dx, dy, holdMs = 450 }) {
  const j = await s.page.evaluate(() => { const r = document.querySelector('.joy-base').getBoundingClientRect(), a = document.getElementById('btn-attack').getBoundingClientRect(); return { jx: r.x + r.width / 2, jy: r.y + r.height / 2, ax: a.x + a.width / 2, ay: a.y + a.height / 2 }; });
  const J0 = { x: j.jx, y: j.jy, id: 1 };
  await touchSend(s, 'touchStart', [J0]); await sleep(60);
  const len = Math.hypot(dx, dy) || 1, mag = 40;
  const J1 = { x: j.jx + dx / len * mag, y: j.jy + dy / len * mag, id: 1 };
  for (const f of [.3, .6, 1]) { await touchMove(s, [{ x: j.jx + (J1.x - j.jx) * f, y: j.jy + (J1.y - j.jy) * f, id: 1 }]); await sleep(50); }
  await sleep(holdMs);
  const A = { x: j.ax, y: j.ay, id: 2 };
  await touchSend(s, 'touchStart', [J1, A]); await sleep(90);
  await touchSend(s, 'touchEnd', [J1]); // 공격 손가락만 뗀다
  return { J1, release: async () => { await touchSend(s, 'touchEnd', []); } };
}
const touchMove = (s, pts) => touchSend(s, 'touchMove', pts);

// ---------- A3 ----------
async function A3(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight' });
    rec.obs('autoTargetSetting', await s.page.evaluate(() => window.app.eco.s.settings.autoTarget));
    rec.check('자동 타겟 기본값 켜짐', rec.observed.autoTargetSetting === true, rec.observed.autoTargetSetting);
    await enterBattle(s); await waitForEnemies(s);
    // (a) 적 방향 반대 yaw 에서 공격 버튼 탭 → 적 쪽으로 돈다.
    let fx = await placeFixture(s, { dist: 3, flip: true });
    rec.obs('fixture', fx); rec.check('픽스처 배치', fx.ok, fx);
    if (fx.ok) {
      await rec.shot(s, 'before'); await startSampler(s); await sleep(120);
      await tapAttack(s); rec.did('실제 공격 버튼(#btn-attack) 탭'); await sleep(1400);
      const sm = await readSampler(s), ev = evalAttack(sm, fx, .5);
      ev.trace = traceOf(sm); ev.traceCols = '[탭 기준 초, yaw, 적 방향 오차, 거리, 상태, 입력x, 입력y, auto, 적 체력]';
      rec.obs('tapAttack', ev); await rec.shot(s, 'after');
      rec.check('탭 직후 0.5초(게임시간) 안에 적 방향 30도 이내로 회전', ev.tapped && ev.errDegMinInWindow <= 30, { start: ev.errDegStart, min: ev.errDegMinInWindow, end: ev.errDegAtWindowEnd });
      rec.check('그 적 체력 감소', ev.hpDropAtSec !== null, { hpBefore: ev.hpBefore, hpFirstDrop: ev.hpFirstDrop, atSec: ev.hpDropAtSec });
      rec.check('lockTarget 이 그 적으로 설정', ev.lockSet);
    }
    // (b) 관찰: 조이스틱을 적 반대로 누른 채 공격 탭.
    await sleep(1500);
    fx = await placeFixture(s, { dist: 3, flip: false });
    if (fx.ok) {
      const dir = await s.page.evaluate(() => { const P = window.app.battle.player, e = window.__fx.enemy; return { ex: e.pos.x - P.pos.x, ez: e.pos.z - P.pos.z }; });
      await startSampler(s);
      const h = await joystickAttack(s, { dx: -dir.ex, dy: -dir.ez });
      rec.did('조이스틱 실제 터치 드래그(적 반대) 유지 + 공격 버튼 동시 터치(CDP 다중 터치)');
      await sleep(1200); const sm = await readSampler(s); await h.release();
      const rows = sm.rows.filter((r) => sm.tapG !== null && r.g >= sm.tapG), first = rows[0];
      const tapRow = sm.rows.filter((r) => r.g < sm.tapG).pop() || first;
      const yawAtStart = rows.find((r) => r.state === 'attack') || first;
      const toEnemy = yawAtStart ? Math.atan2(yawAtStart.ex - yawAtStart.px, yawAtStart.ez - yawAtStart.pz) : null;
      const joyYaw = tapRow && Math.hypot(tapRow.mx || 0, tapRow.my || 0) > .1 ? Math.atan2(tapRow.mx, tapRow.my) : undefined;
      rec.obs('joystickAttack', {
        tapped: sm.tapG !== null, joystickWorldYawDeg: joyYaw === undefined ? null : round(rad2deg(joyYaw), 1),
        enemyYawDeg: toEnemy === null ? null : round(rad2deg(toEnemy), 1),
        attackYawDeg: yawAtStart ? round(rad2deg(yawAtStart.yaw), 1) : null,
        errToEnemyDeg: yawAtStart && toEnemy !== null ? round(Math.abs(rad2deg(angDiff(yawAtStart.yaw, toEnemy))), 1) : null,
        errToJoystickDeg: yawAtStart && joyYaw !== undefined ? round(Math.abs(rad2deg(angDiff(yawAtStart.yaw, joyYaw))), 1) : null,
        distAtTap: tapRow ? round(tapRow.d, 2) : null, distAtAttackStart: yawAtStart ? round(yawAtStart.d, 2) : null, enemyInvuln: yawAtStart ? yawAtStart.einv : null,
        hpDropped: rows.some((r) => r.ehp !== null && r.ehp < (tapRow ? tapRow.ehp : fx.hp)), note: '관찰값(통과/실패 아님)',
        trace: traceOf(sm), traceCols: '[탭 기준 초, yaw, 적 방향 오차, 거리, 상태, 입력x, 입력y, auto, 적 체력]',
      });
      rec.check('조이스틱+공격 동시 입력이 전달됨(공격 시작)', sm.tapG !== null && rows.some((r) => r.state === 'attack'), rec.observed.joystickAttack);
      await rec.shot(s, 'joystick');
    }
  } finally { await s.close(); }
}

// ---------- A4 ----------
async function openSettings(s) {
  await closeModals(s.page);
  // 설정 입구는 하단 "메뉴" 다이얼로그 안에 있다.
  if (!await s.page.locator('#btn-settings').isVisible().catch(() => false)) { await s.page.locator('.oath-nav-menu').tap(); await s.page.waitForTimeout(500); }
  await s.page.locator('#btn-settings').tap(); await s.page.waitForSelector('#modal.show .toggle[data-k="autoTarget"]', { timeout: 10000 });
  await s.page.waitForTimeout(250);
}
const settingToggleState = (s) => s.page.evaluate(() => { const b = document.querySelector('#modal.show .toggle[data-k="autoTarget"]'); return b ? { on: b.classList.contains('on'), aria: b.getAttribute('aria-checked') } : null; });
const ecoAutoTarget = (s) => s.page.evaluate(() => window.app.eco.s.settings.autoTarget);
async function A4(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight' });
    await openSettings(s);
    const t0 = await settingToggleState(s); rec.obs('toggleBefore', t0);
    await s.page.locator('#modal.show .toggle[data-k="autoTarget"]').tap(); rec.did('설정 → "공격 자동 타겟팅" 행 토글 실제 탭(끄기)');
    await s.page.waitForTimeout(400);
    const t1 = await settingToggleState(s); rec.obs('toggleAfterTap', t1);
    rec.check('탭 직후 토글이 꺼짐', t0?.on === true && t1?.on === false, { before: t0, after: t1 });
    rec.check('탭 직후 eco.s.settings.autoTarget===false', await ecoAutoTarget(s) === false);
    await rec.shot(s, 'settings-off');
    // 새로고침 뒤에도 유지
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)');
    await boot(s);
    rec.check('새로고침 뒤 eco.s.settings.autoTarget===false', await ecoAutoTarget(s) === false, await ecoAutoTarget(s));
    await openSettings(s);
    const t2 = await settingToggleState(s); rec.obs('toggleAfterReload', t2);
    rec.check('새로고침 뒤 설정 화면에서도 꺼짐', t2?.on === false && t2?.aria === 'false', t2);
    await rec.shot(s, 'settings-after-reload'); await closeModals(s.page);
    // A3 픽스처에서 공격 시 yaw 유지
    await prepareState(s, { hero: 'knight' });
    await enterBattle(s); await waitForEnemies(s);
    const fx = await placeFixture(s, { dist: 3, flip: true });
    rec.obs('fixture', fx); rec.check('픽스처 배치', fx.ok, fx);
    if (fx.ok) {
      await startSampler(s); await sleep(120); await tapAttack(s); rec.did('실제 공격 버튼 탭(자동 타겟 꺼짐)'); await sleep(1400);
      const sm = await readSampler(s), ev = evalAttack(sm, fx, .5);
      rec.obs('tapAttackOff', ev); await rec.shot(s, 'after-attack');
      rec.check('공격이 시작됨', ev.tapped && ev.states?.includes('attack'), ev.states);
      rec.check('yaw 유지(0.5초 안 최대 변화 10도 이하, 적 쪽으로 돌지 않음)', ev.tapped && ev.yawShiftMaxInWindowDeg <= 10 && ev.errDegMinInWindow > 30, { yawShiftMax: ev.yawShiftMaxInWindowDeg, errToEnemyMin: ev.errDegMinInWindow });
    }
    // 복구: 다시 켜기(로비에서 실제 탭)
    await s.page.evaluate(() => { window.app.toLobby?.(); });
    await s.page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 30000 }).catch(() => {});
    await s.page.waitForTimeout(800); await closeModals(s.page);
    await openSettings(s);
    await s.page.locator('#modal.show .toggle[data-k="autoTarget"]').tap(); await s.page.waitForTimeout(300);
    rec.check('다시 켜기 후 eco.s.settings.autoTarget===true', await ecoAutoTarget(s) === true, await settingToggleState(s));
    rec.did('설정에서 다시 켜기 실제 탭');
  } finally { await s.close(); }
}

// ---------- 전투 행동 도우미(실제 탭) ----------
const hasLive = (s) => s.page.evaluate(() => { const b = window.app.battle; return !!b?.active && b.enemies.some((e) => e.alive && !e.spawning); });
// 가까운 적 옆에 서서(주입) 실제 공격 버튼을 attacks 번 탭하고, 실제 스킬 버튼을 skills 에 적힌 슬롯 순서대로 탭한다.
async function combatBurst(s, { attacks = 3, skills = [0], gap = 650 } = {}) {
  const out = { attacks: 0, skills: [] };
  for (let i = 0; i < attacks; i++) {
    if (!await hasLive(s)) await waitForEnemies(s);
    const fx = await placeFixture(s, { dist: 2.5, flip: false });
    if (!fx.ok) continue;
    await s.page.locator('#btn-attack').tap(); out.attacks++; await sleep(gap);
  }
  s.rec.did('실제 공격 버튼 탭 x' + out.attacks);
  for (const slot of skills) {
    if (!await hasLive(s)) await waitForEnemies(s);
    await placeFixture(s, { dist: 3, flip: false });
    await sleep(500);
    const before = await s.page.evaluate((i) => { const P = window.app.battle.player; return { cd: P.cds[i], mp: P.mp, ult: P.ult, state: P.state }; }, slot);
    await s.page.locator('.skill-btn[data-skill="' + slot + '"]').tap();
    await sleep(250);
    const after = await s.page.evaluate((i) => { const P = window.app.battle.player; return { cd: P.cds[i], mp: P.mp, ult: P.ult, state: P.state }; }, slot);
    out.skills.push({ slot, before, after, cast: after.state === 'skill' || after.state === 'ult' || after.cd > before.cd || after.ult < before.ult });
    await sleep(900);
  }
  s.rec.did('실제 스킬 버튼 탭 슬롯 ' + skills.join(','));
  return out;
}
const classifyUrl = (u) => (u.startsWith('/sfx/mirelo-v1/') ? 'mirelo-v1' : u.startsWith('/sfx/voice/') ? 'voice' : 'legacy');
// ---------- A1 ----------
async function A1(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s);
    const hk = await hookAudio(s); rec.obs('audio', hk);
    rec.check('오디오 컨텍스트 사용 가능', hk.ctx && hk.enabled && !hk.unavailable, hk);
    await prepareState(s, { hero: 'knight' });
    // UI 효과음: 실제 탭으로 메뉴를 열고 닫는다.
    const uiMark = await sfxMark(s);
    await s.page.locator('.oath-nav-menu').tap(); await sleep(500); await s.page.locator('#oath-menu .oath-menu-close').tap(); await sleep(500);
    rec.did('메뉴 열기·닫기 실제 탭(UI 효과음)');
    const uiLog = (await sfxLog(s)).slice(uiMark);
    const reqBeforeBattle = s.requests.length;
    await enterBattle(s); await waitForEnemies(s);
    const mark = await sfxMark(s), reqMark = s.requests.length;
    const burst = await combatBurst(s, { attacks: 4, skills: [0] });
    await sleep(800);
    const log = (await sfxLog(s)).slice(mark);
    rec.obs('burst', burst);
    const played = log.filter((e) => e.url), voices = log.filter((e) => e.group !== 'sfx' && e.group !== 'synth'), synth = log.filter((e) => e.group === 'synth');
    const combatPlayed = played.filter((e) => !/^\/sfx\/mirelo-v1\/ui\//.test(e.url));
    rec.obs('combatPlayed', Object.fromEntries([...new Set(combatPlayed.map((e) => e.url))].map((u) => [u, combatPlayed.filter((e) => e.url === u).length])));
    rec.obs('voicePlays', voices.length); rec.obs('synthMethodCalls(샘플로 대체된 호출 포함)', Object.fromEntries([...new Set(synth.map((e) => e.name))].map((n) => [n, synth.filter((e) => e.name === n).length])));
    rec.obs('uiPlayed', Object.fromEntries([...new Set(uiLog.filter((e) => e.url).map((e) => e.url))].map((u) => [u, uiLog.filter((e) => e.url === u).length])));
    const reqs = s.requests; const byClass = { 'mirelo-v1': 0, voice: 0, legacy: 0 };
    for (const r of reqs) byClass[classifyUrl(r.url)]++;
    rec.obs('sfxRequests', { total: reqs.length, ...byClass, legacyUrls: [...new Set(reqs.filter((r) => classifyUrl(r.url) === 'legacy').map((r) => r.url))] });
    rec.obs('requestsDuringBattleBurst', reqs.slice(reqMark).map((r) => r.url));
    rec.check('전투 효과음 재생이 실제로 있었다(샘플 3회 이상)', combatPlayed.length >= 3, combatPlayed.length);
    rec.check('재생된 모든 전투 효과음이 /sfx/mirelo-v1/', combatPlayed.every((e) => classifyUrl(e.url) === 'mirelo-v1'), combatPlayed.filter((e) => classifyUrl(e.url) !== 'mirelo-v1').map((e) => e.url));
    rec.check('영웅 전용 소리(mirelo-v1/hero/knight/) 재생', combatPlayed.some((e) => e.url.includes('/hero/knight/')), null);
    rec.check('스킬 시전 소리 재생(skill_*)', combatPlayed.some((e) => /\/skill_/.test(e.url)), null);
    rec.check('공용 타격 레이어(mirelo-v1/hit/) 재생', combatPlayed.some((e) => e.url.includes('/mirelo-v1/hit/')), null);
    rec.check('Sonniss 등 예전 경로 /sfx/ 요청 0', byClass.legacy === 0, rec.observed.sfxRequests.legacyUrls);
    rec.check('UI 효과음도 mirelo-v1', uiLog.filter((e) => e.url).every((e) => classifyUrl(e.url) === 'mirelo-v1'), rec.observed.uiPlayed);
    rec.check('스킬이 실제로 시전됨', burst.skills.every((k) => k.cast), burst.skills);
    await rec.shot(s, 'battle');
  } finally { await s.close(); }
}

// ---------- A2 ----------
// 내용이 같은 파일이 영웅 사이에 섞여 있지 않은지 SHA-256 으로 비교한다(페이지 안에서 같은 출처 fetch).
const hashUrls = (s, urls) => s.page.evaluate(async (list) => {
  const out = {};
  for (const u of list) { const ab = await (await fetch(u)).arrayBuffer(); const d = await crypto.subtle.digest('SHA-256', ab); out[u] = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  return out;
}, urls);
async function A2(browser, rec) {
  const perHero = {};
  for (const hero of HEROES) {
    const s = await open(browser, rec);
    try {
      await boot(s); const hk = await hookAudio(s);
      await prepareState(s, { hero });
      await enterBattle(s); await waitForEnemies(s);
      const heroId = await s.page.evaluate(() => window.app.battle.player.def.id);
      const mark = await sfxMark(s);
      const burst = await combatBurst(s, { attacks: 3, skills: [0] });
      await sleep(800);
      const log = (await sfxLog(s)).slice(mark), played = log.filter((e) => e.url);
      const heroFiles = [...new Set(played.filter((e) => e.url.includes('/mirelo-v1/hero/')).map((e) => e.url))];
      const commonHit = [...new Set(played.filter((e) => e.url.includes('/mirelo-v1/hit/')).map((e) => e.url))];
      const hashes = await hashUrls(s, heroFiles);
      perHero[hero] = { heroId, audioCtx: hk.ctx, played: played.length, heroFiles, commonHit, hashes, burst, synth: log.filter((e) => e.group === 'synth').length };
      await rec.shot(s, hero);
    } finally { await s.close(); }
  }
  rec.obs('perHero', perHero);
  for (const hero of HEROES) {
    const p = perHero[hero];
    rec.check(hero + ': 선택 영웅으로 전투 진입', p?.heroId === hero, p?.heroId);
    rec.check(hero + ': mirelo-v1/hero/' + hero + '/ 파일 재생(스윙·스킬 포함)', !!p && p.heroFiles.length >= 2 && p.heroFiles.every((u) => u.includes('/mirelo-v1/hero/' + hero + '/')) && p.heroFiles.some((u) => /swing_|finisher/.test(u)) && p.heroFiles.some((u) => /skill_/.test(u)), p?.heroFiles);
    rec.check(hero + ': 스킬 시전됨', !!p && p.burst.skills.every((k) => k.cast), p?.burst.skills);
  }
  const owner = new Map(); let dupPath = [], dupContent = [];
  for (const hero of HEROES) for (const u of perHero[hero]?.heroFiles || []) { if (owner.has(u) && owner.get(u) !== hero) dupPath.push(u); owner.set(u, hero); }
  const hashOwner = new Map();
  for (const hero of HEROES) for (const [u, h] of Object.entries(perHero[hero]?.hashes || {})) { if (hashOwner.has(h) && hashOwner.get(h).hero !== hero) dupContent.push([hashOwner.get(h).url, u]); else hashOwner.set(h, { hero, url: u }); }
  rec.check('다섯 영웅의 재생 파일 집합이 서로 겹치지 않음(경로)', dupPath.length === 0, dupPath);
  rec.check('다섯 영웅의 재생 파일 내용(SHA-256)이 서로 겹치지 않음', dupContent.length === 0, dupContent);
}

// ---------- A5 ----------
async function A5(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight' });
    await enterBattle(s);
    await s.page.evaluate(() => {
      const st = window.__a5 = { deaths: 0, wasAlive: true, hpMin: 1, maxEnemies: 0 };
      setInterval(() => { const b = window.app.battle, P = b?.player; if (!P) return; if (!P.alive && st.wasAlive) st.deaths++; st.wasAlive = P.alive; st.hpMin = Math.min(st.hpMin, P.hp / P.maxHp); st.maxEnemies = Math.max(st.maxEnemies, b.enemies.filter((e) => e.alive).length); }, 50);
    });
    await s.page.locator('#btn-auto').tap(); rec.did('전투 HUD AUTO 버튼(#btn-auto) 실제 탭');
    const wall0 = Date.now(); let st = null, shotMid = false; const stalls = [], modalPauses = [];
    while (Date.now() - wall0 < 300000) {
      await sleep(1000);
      st = await s.page.evaluate(() => { const b = window.app.battle, P = b?.player, r = b?.result; return { active: !!b?.active, win: r ? !!r.win : null, resultShown: (() => { const v = (n) => { if (!n) return false; if (typeof n.checkVisibility === 'function') return n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }; return v(document.querySelector('#btn-result-lobby')) || [...document.querySelectorAll('h1,h2,h3,h4,strong,b,div,p,span')].some((n) => /^원정 (승리|실패|패배)$/.test(n.textContent.trim()) && v(n)); })(), elapsed: b ? +b.elapsed.toFixed(1) : null, kills: b?.kills ?? null, hp: P ? Math.round(P.hp) : null, maxHp: P ? Math.round(P.maxHp) : null, auto: P?.auto, rooms: b?.world ? b.world.rooms.filter((x) => x.cleared).length + '/' + b.world.rooms.length : null, a5: window.__a5 }; });
      if (!shotMid && Date.now() - wall0 > 30000) { shotMid = true; await rec.shot(s, 'auto-mid'); }
      // 각인·만남 선택 모달은 게임을 멈추고 자동 적용 타이머(게임 시간 8초)도 멈춘다. 멈춤을 기록하고 실제 탭으로 첫 선택지를 고른다.
      const choice = s.page.locator('.mw-boon, .mw-story-choice').first();
      if (await choice.isVisible().catch(() => false) && !st.resultShown) {
        const snap = () => s.page.evaluate(() => { const b = window.app.battle, P = b.player, d = document.querySelector('.mw-boon, .mw-story-choice')?.closest('dialog, [role=dialog], .mw-dialog, section, article') || null, r = d ? d.getBoundingClientRect() : null;
          return { paused: !!b.paused, pauseReasons: [...(b.pauseReasons || [])], timeScale: b.timeScale ?? b.timeCtl?.scale ?? null, elapsed: +b.elapsed.toFixed(3), playerHp: Math.round(P.hp), playerState: P.state, enemyHpSum: Math.round(b.enemies.reduce((a, e) => a + (e.alive ? e.hp : 0), 0)), aliveEnemies: b.enemies.filter((e) => e.alive).length, modalCoverage: r ? +((Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / (innerWidth * innerHeight)).toFixed(2) : null }; });
        const prev = { elapsed: st.elapsed, playerHp: st.hp, note: '직전 1초 폴링 값(모달이 열리기 전)' };
        const m0 = await snap(); await sleep(1000); const m1 = await snap();
        modalPauses.push({ wallSec: round((Date.now() - wall0) / 1000, 1), before: prev, atOpen: m0, after1sWall: m1,
          elapsedDelta1s: round(m1.elapsed - m0.elapsed, 3), playerHpDelta: m1.playerHp - m0.playerHp, enemyHpDelta: m1.enemyHpSum - m0.enemyHpSum, pausesPlay: m1.elapsed === m0.elapsed && m1.enemyHpSum === m0.enemyHpSum && m1.playerHp === m0.playerHp });
        const e0 = st.elapsed; await sleep(2000);
        const e1 = await s.page.evaluate(() => +window.app.battle.elapsed.toFixed(1));
        const kind = await s.page.evaluate(() => document.querySelector('.mw-boon') ? 'boon' : 'story');
        stalls.push({ wallSec: round((Date.now() - wall0) / 1000, 1), kind, gameElapsedBefore: e0, gameElapsedAfter3sWall: e1, frozen: e1 === e0 });
        if (stalls.length === 1) await rec.shot(s, 'imprint-modal');
        await choice.tap().catch(() => {}); rec.did('각인·만남 선택 모달의 첫 선택지 실제 탭(AUTO 는 선택하지 않음)'); await sleep(800);
        const closeBtn = s.page.locator('.mw-close, #m-cancel').first();
        if (await choice.isVisible().catch(() => false) && await closeBtn.isVisible().catch(() => false)) await closeBtn.tap().catch(() => {});
        continue;
      }
      if (st.resultShown || (!st.active && st.win !== null)) break;
    }
    await sleep(1500);
    const fin = await s.page.evaluate(() => { const b = window.app.battle; return { win: b?.result ? !!b.result.win : null, resultShown: (() => { const v = (n) => { if (!n) return false; if (typeof n.checkVisibility === 'function') return n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }; return v(document.querySelector('#btn-result-lobby')) || [...document.querySelectorAll('h1,h2,h3,h4,strong,b,div,p,span')].some((n) => /^원정 (승리|실패|패배)$/.test(n.textContent.trim()) && v(n)); })(), resultTitle: document.querySelector('#result h1, #result .result-title, #result-title')?.textContent || null, elapsedGame: b ? +b.elapsed.toFixed(1) : null, kills: b?.kills ?? null, a5: window.__a5 }; });
    await rec.shot(s, 'result');
    const wallSec = round((Date.now() - wall0) / 1000, 1);
    rec.obs('final', { ...fin, wallSeconds: wallSec, last: st }); rec.obs('autoStallsAtChoiceModal', stalls); rec.obs('imprintModalPausesPlay', { modals: modalPauses, anyPauses: modalPauses.some((m) => m.pausesPlay), allPause: modalPauses.length > 0 && modalPauses.every((m) => m.pausesPlay) }); rec.obs('deaths', fin.a5.deaths); rec.obs('minHpRatio', round(fin.a5.hpMin, 3)); rec.obs('maxAliveEnemies', fin.a5.maxEnemies);
    rec.check('승리 화면까지 도달(300초 이내)', fin.win === true && fin.resultShown, { win: fin.win, resultShown: fin.resultShown, wallSeconds: wallSec });
    rec.check('사망 0', fin.a5.deaths === 0, { deaths: fin.a5.deaths, minHpRatio: round(fin.a5.hpMin, 3) });
  } finally { await s.close(); }
}

// ---------- A6 ----------
// scene 계측: skills-v2 텍스처(VFX_TEX 의 sv2-*)를 쓰는 지면 메시·스프라이트 수, 지면 링 최대 반경, 총 객체 수.
async function installVfxProbe(s) {
  await s.page.evaluate(async () => {
    const { VFX_TEX } = await import('/src/engine/assets.js');
    const sv = new Set(Object.entries(VFX_TEX).filter(([k]) => k.startsWith('sv2-')).map(([, v]) => v));
    window.__sv2Keys = Object.keys(VFX_TEX).filter((k) => k.startsWith('sv2-'));
    window.__vfxMax = { n: 0, r: 0 };
    window.__vfxSnap = () => {
      const scene = window.app.renderer.scene; let n = 0, total = 0, maxR = 0, meshes = 0, sprites = 0;
      scene.traverse((o) => {
        total++;
        const m = o.material; if (!m || !m.map || !sv.has(m.map) || !o.visible) return;
        for (let a = o; a; a = a.parent) if (a.name === 'GradeAura') return;
        n++; if (o.isMesh) { meshes++; maxR = Math.max(maxR, o.scale.x * (o.geometry?.parameters?.width || 1) / 2); } else if (o.isSprite) sprites++;
      });
      return { sv2: n, meshes, sprites, total, children: scene.children.length, maxGroundRadius: +maxR.toFixed(2) };
    };
    const tick = () => { const k = window.__vfxSnap(); window.__vfxMax.n = Math.max(window.__vfxMax.n, k.sv2); window.__vfxMax.r = Math.max(window.__vfxMax.r, k.maxGroundRadius); if (k.sv2 > 0 && window.__tapG !== null && window.__tapG !== undefined && window.__vfxMax.first === undefined) window.__vfxMax.first = +(window.app.battle.elapsed - window.__tapG).toFixed(3); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
// 스킬 버튼을 실제로 탭하고, 시전 직후 deltas(게임 초)마다 게임을 잠깐 멈춰 캡처한다(멈춤은 캡처 정확도용).
async function castAndCapture(s, rec, { slot, tag, deltas = [.15, .4] }) {
  await s.page.evaluate((slot) => {
    const b = window.app.battle, P = b.player;
    P.cds.fill(0); P.mp = P.maxMp; P.ult = P.ultMax; window.__vfxMax = { n: 0, r: 0 }; window.__tapG = null;
    document.querySelector('.skill-btn[data-skill="' + slot + '"]').addEventListener('touchstart', () => { window.__tapG = b.elapsed; }, { capture: true, once: true });
  }, slot);
  const info = await s.page.evaluate((slot) => { const P = window.app.battle.player; return { id: P.def.skills[slot]?.id, name: P.def.skills[slot]?.name, ult: !!P.def.skills[slot]?.ult, unlocked: P.unlocked(slot), state: P.state }; }, slot);
  await s.page.locator('.skill-btn[data-skill="' + slot + '"]').tap();
  const snaps = [];
  for (const d of deltas) {
    const snap = await s.page.evaluate(async (d) => {
      const b = window.app.battle;
      for (let i = 0; i < 400 && (window.__tapG === null || b.elapsed - window.__tapG < d); i++) await new Promise((r) => requestAnimationFrame(r));
      b.setPaused('gogo-qa', true);
      return { atSec: +(b.elapsed - window.__tapG).toFixed(3), state: b.player.state, ...window.__vfxSnap() };
    }, d);
    const file = await rec.shot(s, tag + '-' + Math.round(d * 1000) + 'ms');
    await s.page.evaluate(() => window.app.battle.setPaused('gogo-qa', false));
    snaps.push({ delta: d, ...snap, file });
  }
  await sleep(1400);
  const max = await s.page.evaluate(() => ({ ...window.__vfxMax }));
  return { ...info, snaps, maxSv2: max.n, maxGroundRadius: round(max.r, 2), firstSv2AtSec: max.first ?? null };
}
async function A6Pass(browser, rec, viewport, heroes, tagPrefix) {
  const result = {};
  for (const hero of heroes) {
    const s = await open(browser, rec, viewport);
    try {
      await boot(s); await prepareState(s, { hero, level: 30 });
      await enterBattle(s, { settle: 2500 });
      await installVfxProbe(s); await sleep(500);
      const base = await s.page.evaluate(() => ({ ...window.__vfxSnap(), keys: window.__sv2Keys }));
      rec.inject('스킬 시전 직전 쿨다운 0·MP 가득·궁극기 게이지 가득(P.cds/P.mp/P.ult)');
      const skill = await castAndCapture(s, rec, { slot: 0, tag: tagPrefix + hero + '-skill' });
      await sleep(800);
      const ult = await castAndCapture(s, rec, { slot: 3, tag: tagPrefix + hero + '-ult' });
      await sleep(1500);
      // 반복 시전 3회 → 효과가 끝난 뒤 scene 객체 수가 시작값으로 돌아오는지
      const before = await s.page.evaluate(() => window.__vfxSnap());
      for (let i = 0; i < 3; i++) {
        await s.page.evaluate(() => { const P = window.app.battle.player; P.cds.fill(0); P.mp = P.maxMp; });
        await s.page.locator('.skill-btn[data-skill="0"]').tap(); await sleep(1100);
      }
      await sleep(3500);
      let after = await s.page.evaluate(() => window.__vfxSnap());
      for (let i = 0; i < 8; i++) { await sleep(500); const again = await s.page.evaluate(() => window.__vfxSnap()); const same = again.total === after.total; after = again; if (same && after.total === base.total) break; }
      result[hero] = { base, skill, ult, repeat: { start: { total: base.total, children: base.children, sv2: base.sv2 }, before, after, returnedToStart: after.total === base.total && after.children === base.children && after.sv2 === base.sv2, returned: after.total === base.total && after.children === base.children && after.sv2 === base.sv2 } };
    } finally { await s.close(); }
  }
  return result;
}
async function A6(browser, rec) {
  const heroes = arg('heroes') ? arg('heroes').split(',') : ['knight', 'mage', 'ranger'];
  const main = await A6Pass(browser, rec, VIEW, heroes, '844-');
  rec.obs('viewport844x390', main);
  for (const hero of heroes) {
    const r = main[hero];
    rec.check(hero + ': 스킬 시전(' + r.skill.id + ')', r.skill.snaps.every((k) => k.state === 'skill' || k.state === 'ult'), r.skill.snaps.map((k) => k.state));
    rec.check(hero + ': 스킬 시전 직후 skills-v2 텍스처 메시 > 0', r.skill.snaps.some((k) => k.sv2 > 0) && r.skill.maxSv2 > 0, { atSnaps: r.skill.snaps.map((k) => k.sv2), maxSv2: r.skill.maxSv2, keys: r.base.keys.length });
    rec.check(hero + ': 궁극기 시전(' + r.ult.id + ')', r.ult.unlocked && r.ult.snaps.some((k) => k.state === 'ult'), r.ult.snaps.map((k) => k.state));
    rec.check(hero + ': 궁극기 skills-v2 메시 > 0', r.ult.maxSv2 > 0, { atSnaps: r.ult.snaps.map((k) => k.sv2), maxSv2: r.ult.maxSv2 });
    rec.check(hero + ': 궁극기 지면 링 반경 10 이상(링 목표 r1=10, 마지막 표본 전 9.8 이상 허용)', r.ult.maxGroundRadius >= 9.8, r.ult.maxGroundRadius);
    rec.check(hero + ': 반복 시전 3회 뒤 scene 객체 수(총·자식·skills-v2)가 전투 시작값으로 복귀', r.repeat.returnedToStart, r.repeat);
  }
  const wide = await A6Pass(browser, rec, WIDE, heroes, '1280-');
  rec.obs('viewport1280x590', Object.fromEntries(Object.entries(wide).map(([h, r]) => [h, { skillSv2: r.skill.maxSv2, ultSv2: r.ult.maxSv2, ultRadius: r.ult.maxGroundRadius, snaps: [...r.skill.snaps, ...r.ult.snaps].map((k) => k.file) }])));
  for (const hero of heroes) rec.check(hero + ' 1280x590: 스킬·궁극기 skills-v2 메시 > 0', wide[hero].skill.maxSv2 > 0 && wide[hero].ult.maxSv2 > 0, { skill: wide[hero].skill.maxSv2, ult: wide[hero].ult.maxSv2 });
}

// ---------- A7 ----------
// 화면 중앙 보호 영역(가로 가운데 1/3, 상단 HUD 아래~하단 조작부 위)과 겹치는 DOM UI 를 찾는다. 월드 이펙트·피해 숫자는 별도 표기.
const overlapProbe = (s) => s.page.evaluate(() => {
  const W = innerWidth, H = innerHeight, R = (n) => n.getBoundingClientRect();
  const top = R(document.querySelector('.hud-top')).bottom;
  const ctrl = [...document.querySelectorAll('.actions > *, .joy-base')].filter((n) => n.offsetParent).map((n) => R(n).top);
  const zone = { x0: W / 3, x1: W * 2 / 3, y0: top, y1: Math.min(...ctrl) };
  const skip = (n) => n.closest('.hud-top, .actions, #joy, canvas, #minimap-wrap, #btn-map, #skill-aim-cancel');
  const found = [];
  for (const n of document.body.querySelectorAll('*')) {
    if (skip(n)) continue;
    const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    let op = 1; for (let a = n; a && a !== document.body; a = a.parentElement) { op *= parseFloat(getComputedStyle(a).opacity); if (a.hidden || getComputedStyle(a).display === 'none') op = 0; }
    if (op < 0.05) continue;
    const r = R(n); if (r.width < 2 || r.height < 2) continue;
    const ix = Math.min(r.right, zone.x1) - Math.max(r.left, zone.x0), iy = Math.min(r.bottom, zone.y1) - Math.max(r.top, zone.y0);
    if (ix <= 0 || iy <= 0) continue;
    const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    const bg = /rgba?\(/.test(cs.backgroundColor) && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs.backgroundColor) && cs.backgroundColor !== 'transparent';
    if (!(own || bg || cs.backgroundImage !== 'none' || n.tagName === 'IMG' || n.tagName === 'SVG')) continue;
    if (r.width >= W * 0.95 && r.height >= H * 0.9) continue; // 화면 전체 비네트·플래시
    found.push({ id: n.id || null, cls: String(n.className || '').slice(0, 40), text: (n.textContent || '').trim().slice(0, 24), world: !!n.closest('#dmg-layer'), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], op: +op.toFixed(2) });
  }
  return { zone: { x0: Math.round(zone.x0), x1: Math.round(zone.x1), y0: Math.round(zone.y0), y1: Math.round(zone.y1) }, paused: !!window.app.battle.paused, pauseReasons: [...(window.app.battle.pauseReasons || [])], found };
});
async function A7One(browser, rec, grade, samples, shotTag) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight', grade });
    await enterBattle(s, { settle: 2500 });
    await sleep(800);
    const aura = await s.page.evaluate(() => { const P = window.app.battle.player, a = P.gradeAura; return { grade: a?.grade, group: !!a?.group, visible: a?.group?.visible ?? null, ring: a?.ring?.visible ?? null, aura: a?.aura?.visible ?? null, ringOpacity: a?.ring?.material?.opacity ?? null, ringMapSet: !!a?.ring?.material?.map, auraMapSet: !!a?.aura?.material?.map, heroGrade: window.app.eco.hero(window.app.eco.s.selected).grade }; });
    await rec.shot(s, shotTag + '-844');
    const rows = [];
    if (samples > 0) {
      await s.page.locator('#btn-auto').tap(); rec.did('AUTO 버튼 실제 탭(전투 중 UI 표본 확보)');
      for (let i = 0; i < samples; i++) { await sleep(2000); rows.push(await overlapProbe(s)); if (i === 4) await rec.shot(s, shotTag + '-mid'); }
    }
    await s.close();
    // 1280x590 캡처
    const w = await open(browser, rec, WIDE);
    try {
      await boot(w); await prepareState(w, { hero: 'knight', grade }); await enterBattle(w, { settle: 2500 }); await sleep(800);
      await rec.shot(w, shotTag + '-1280');
    } finally { await w.close(); }
    return { aura, rows };
  } catch (e) { await s.close().catch(() => {}); throw e; }
}
async function A7(browser, rec) {
  const sssr = await A7One(browser, rec, 'SSSR', 10, 'sssr');
  rec.obs('sssrAura', sssr.aura);
  rec.check('SSSR: GradeAura 그룹 표시(group.visible)', sssr.aura.visible === true, sssr.aura);
  rec.check('SSSR: 지면 링·몸 오라 모두 표시', sssr.aura.ring === true && sssr.aura.aura === true, { ring: sssr.aura.ring, aura: sssr.aura.aura });
  // 전투가 일시정지된 표본(각인·만남 선택 모달 등)은 '플레이 중 겹침'이 아니라 별도로 기록한다. 규칙: 모달은 플레이가 멈춘 동안만 열린다.
  const live = sssr.rows.map((r) => (r.paused ? [] : r.found.filter((f) => !f.world))), pausedSamples = sssr.rows.map((r, i) => ({ i, reasons: r.pauseReasons, items: r.paused ? r.found.filter((f) => !f.world).map((f) => f.cls || f.id) : [] })).filter((x) => x.reasons.length);
  rec.obs('overlapSamples', sssr.rows.map((r, i) => ({ i, zone: r.zone, paused: r.paused, ui: r.found.filter((f) => !f.world), dmgNumbers: r.found.filter((f) => f.world).length })));
  rec.obs('pausedSamples', pausedSamples);
  rec.check('전투 DOM UI 중앙 보호 영역 겹침 0(2초 간격 10회 표본, 플레이 진행 중인 표본 기준)', sssr.rows.length === 10 && live.every((l) => l.length === 0), live.map((l, i) => ({ sample: i, items: l })).filter((x) => x.items.length));
  const ssr = await A7One(browser, rec, 'SSR', 0, 'ssr');
  rec.obs('ssrAura', ssr.aura);
  rec.check('SSR: GradeAura 그룹 표시(금색 링, 몸 오라 없음)', ssr.aura.visible === true && ssr.aura.ring === true && ssr.aura.aura === false, ssr.aura);
}

// ---------- A8 ----------
async function skillState(s) {
  return s.page.evaluate(() => {
    const e = window.app.eco, id = e.s.selected, h = e.hero(id), sp = e.skillPoints(id);
    return { id, level: h.level, skills: [...(h.skills || [])], loadout: h.skillLoadout, sp: sp.available, spent: sp.spent, earned: sp.earned };
  });
}
async function A8(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight', level: 30 });
    const s0 = await skillState(s); rec.obs('start', s0);
    // 영웅 화면 → 스킬 트리(실제 탭)
    await s.page.locator('.bottomnav button[data-tab="heroes"]').tap(); await sleep(900);
    await s.page.locator('.hs-growth-links button', { hasText: '스킬 트리' }).tap(); rec.did('하단 내비 영웅·장비 → "스킬 트리" 실제 탭');
    await s.page.waitForSelector('.st-layer:not([hidden]) .st-grid, .gx-layer.st-layer:not([hidden])', { timeout: 10000 }); await sleep(600);
    await rec.shot(s, 'tree-open');
    const cells = await s.page.evaluate(() => [...document.querySelectorAll('.st-cell')].map((c, i) => ({ i, state: [...c.classList].find((k) => k.startsWith('is-') && !['is-awaken', 'is-selected'].includes(k)), awaken: c.classList.contains('is-awaken'), label: c.querySelector('.st-icon')?.getAttribute('aria-label') })));
    rec.obs('cellsBefore', cells);
    const ready = cells.filter((c) => c.awaken && c.state === 'is-ready');
    rec.check('습득 가능한 각성 스킬이 있다', ready.length > 0, cells.filter((c) => c.awaken));
    if (!ready.length) return;
    // 각성 칸의 스킬 인덱스는 data-key (cell-N)
    const idx = await s.page.evaluate(() => { const c = [...document.querySelectorAll('.st-cell.is-awaken.is-ready .st-icon')][0]; return Number(c.dataset.key.replace('cell-', '')); });
    const other = await s.page.evaluate((idx) => { const c = [...document.querySelectorAll('.st-cell.is-awaken .st-icon')].map((n) => Number(n.dataset.key.replace('cell-', ''))).filter((i) => i !== idx); return c; }, idx);
    rec.obs('target', { idx, others: other });
    await s.page.locator('.st-icon[data-key="cell-' + idx + '"]').tap(); await sleep(400);
    const learnLabel1 = await s.page.locator('.st-learn').innerText();
    await s.page.locator('.st-learn').tap(); rec.did('각성 스킬 칸 탭 → "습득" 버튼 실제 탭'); await sleep(700);
    const s1 = await skillState(s); await rec.shot(s, 'learned-1');
    rec.obs('afterLearn', { learnLabel: learnLabel1, ...s1 });
    rec.check('습득: 스킬 레벨 0→1', s0.skills[idx] === 0 && s1.skills[idx] === 1, { before: s0.skills[idx], after: s1.skills[idx] });
    rec.check('습득: SP 감소', s1.sp < s0.sp, { before: s0.sp, after: s1.sp });
    await s.page.locator('.st-learn').tap(); rec.did('"강화" 버튼 한 번 더 실제 탭'); await sleep(700);
    const s2 = await skillState(s); await rec.shot(s, 'learned-2');
    rec.obs('afterUpgrade', s2);
    rec.check('한 번 더 올리기: 레벨 1→2·SP 추가 감소', s2.skills[idx] === 2 && s2.sp < s1.sp, { level: s2.skills[idx], sp: [s1.sp, s2.sp] });
    // 배우지 않은 각성 스킬은 장착 거부
    const equipUi = []; const eqApi = [];
    for (const o of other) {
      await s.page.locator('.st-icon[data-key="cell-' + o + '"]').tap(); await sleep(350);
      equipUi.push({ idx: o, equipRowVisible: await s.page.locator('.st-equip').count() > 0, learnDisabled: await s.page.locator('.st-learn').isDisabled() });
      eqApi.push({ idx: o, slot0: await s.page.evaluate(([id, i]) => window.app.eco.setSkillLoadout(id, 0, i), [s0.id, o]), slot1: await s.page.evaluate(([id, i]) => window.app.eco.setSkillLoadout(id, 1, i), [s0.id, o]) });
    }
    rec.inject('미습득 각성 스킬 장착 시도는 eco.setSkillLoadout API 직접 호출(UI에는 장착 행이 없음을 함께 확인)');
    rec.obs('equipAttempt', { ui: equipUi, api: eqApi, loadoutAfter: (await skillState(s)).loadout });
    const unlearned = (await skillState(s)).skills;
    const noEquipUi = equipUi.filter((u) => unlearned[u.idx] === 0).every((u) => !u.equipRowVisible);
    rec.check('미습득 각성 스킬: UI에 장착 행 없음', noEquipUi, equipUi);
    rec.check('미습득 각성 스킬: setSkillLoadout 거부(false)', eqApi.filter((a) => unlearned[a.idx] === 0).every((a) => a.slot0 === false && a.slot1 === false), eqApi);
    // 새로고침 뒤 유지
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)');
    await boot(s);
    const s3 = await skillState(s);
    rec.obs('afterReload', s3);
    rec.check('새로고침 뒤 스킬 레벨 유지', s3.skills[idx] === 2, s3.skills);
    rec.check('새로고침 뒤 SP 유지', s3.sp === s2.sp, { before: s2.sp, after: s3.sp });
  } finally { await s.close(); }
}

// ---------- 러너 ----------
const CRITERIA = { A1: ['전투·UI 효과음이 mirelo-v1 이고 예전 경로 요청 0', A1], A2: ['영웅 5명이 각자 전용 효과음을 재생하고 서로 겹치지 않음', A2], A5: ['AUTO 첫 스테이지 승리·사망 0', A5], A6: ['스킬·궁극기 skills-v2 VFX', A6], A7: ['등급 오라·화면 중앙 UI 겹침', A7], A8: ['스킬 트리 각성 습득·장착 거부·유지', A8], A3: ['자동 타겟 켜짐: 공격 시 적 쪽으로 회전·체력 감소', A3], A4: ['설정에서 자동 타겟 끄기·유지·yaw 유지', A4] };
// 기본은 이 PC 의 실제 GPU(ANGLE D3D11) 헤드리스 Chrome. --gl swift 면 swiftshader(소프트웨어, 게임 시간이 느려진다).
const GL = arg('gl', 'gpu');
const browser = await chromium.launch(GL === 'swift' ? launchOpts() : { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const summary = { started: new Date().toISOString(), origin, out, viewport: VIEW, criteria: {} };
let failed = false;
for (const id of Object.keys(CRITERIA).filter((k) => !only || only.includes(k))) {
  const [title, fn] = CRITERIA[id], rec = newRec(id, title);
  try { await fn(browser, rec); } catch (e) { rec.check('실행 오류 없음', false, String(e?.stack || e).slice(0, 600)); }
  rec.pass = rec.checks.length > 0 && rec.checks.every((c) => c.ok) && rec.pageErrors.length === 0;
  rec.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, id + '.json'), JSON.stringify(rec, null, 2));
  summary.criteria[id] = { pass: rec.pass, failedChecks: rec.checks.filter((c) => !c.ok).map((c) => c.name), pageErrors: rec.pageErrors.length };
  if (!rec.pass) failed = true;
  console.log(id, rec.pass ? 'PASS' : 'FAIL', rec.checks.filter((c) => !c.ok).map((c) => c.name).join(' | '), rec.pageErrors.length ? '(pageErrors ' + rec.pageErrors.length + ')' : '');
}
await browser.close();
summary.finished = new Date().toISOString(); summary.pass = !failed;
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
process.exit(failed ? 1 : 0);
















