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
  page.on('console', (m) => { if (m.type() === 'error') rec.pageErrors.push('console: ' + m.text().slice(0, 300)); });
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

// ---------- 러너 ----------
const CRITERIA = { A3: ['자동 타겟 켜짐: 공격 시 적 쪽으로 회전·체력 감소', A3], A4: ['설정에서 자동 타겟 끄기·유지·yaw 유지', A4] };
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
