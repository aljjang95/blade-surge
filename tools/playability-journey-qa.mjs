// 실제 사용자 여정 E2E QA — 새 브라우저 프로필에서 궁수를 실제 UI로 고르고, 던전 준비·출격·수동 실시간 전투·결과·장비·재입장을 이어서 검사한다.
//
// 흐름(모두 실제 입력): 부팅 시작 버튼 → (회전 안내가 보이면 실제 버튼) → 자연 팝업(출석 등)을 '닫기'로 닫기
//   → 영웅 탭에서 궁수 카드 선택(필요하면 '출전시키기') → 홈 단일 CTA '출격 준비' → 준비 취소(비용 0) → 다시 열어 최종 출격(카탈로그 에너지 1회)
//   → AUTO 꺼짐 확인 → CDP 터치 조이스틱 + 공격/회피 버튼으로 자연 생성 적과 수동 실시간 전투(옆걸음·후퇴 사격, 회피→사격)
//   → (기본) 실제 AUTO 버튼을 켜고 보유 물약만 실제 버튼으로 써서 정상 종료까지 '자동 완주' — 보고서에 그대로 표시
//   → 결과(전리품) → 결과의 장비 버튼(.exp-result-gear) 또는 없으면 결과 '로비' → 영웅 탭 → 전리품 시트·장착 → 같은 던전 준비 → 재입장 1회 차감.
//
// 하지 않는 것: app.step/testPause, 무적, 적 생성, 순간이동, 시간 조작, 강제 승리, 경제·선택 영웅 직접 쓰기, app.startStage 직접 호출,
//   숨은 요소 강제 클릭. 페이지 JS는 상태 읽기와 window.__journeyObs(관측 기록)만 쓴다(tools/playability-journey-observer.mjs).
// 이 결과는 Playwright/CDP 자동화 터치다. 실제 Android Chrome·삼성 인터넷 물리 기기, 사람 조작감, 발열 증거가 아니다.
//
// 실행(빌드한 dist를 loopback preview로 띄운 뒤):
//   node tools/playability-journey-qa.mjs --url http://127.0.0.1:4173/ --label <새 이름> --expected-sha <40hex> [--chrome-executable "C:\Program Files\Google\Chrome\Application\chrome.exe"]
//   선택: --manual-sec 150  --finish auto|manual|none  --finish-sec 240  --deadline-sec 1500  --boot-timeout-sec 300
// 결과: work/qa/playability-journey/<label>/report.json + PNG. 같은 label이 있으면 덮어쓰지 않고 멈춘다. 필수 단계가 모두 PASS일 때만 exit 0.
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOpts } from './chrome.mjs';
import { decodeGrid, inferCell, distanceField, pathDirection, worldToStick, clearLine, evasiveDirection } from './playability-journey-nav.mjs';
import { installObserver, setObserverPhase, drainObserver, readBattle, readGrid, readLobby, probeNode, scrollerOf, readImages, readWardrobe, readGpu, readRangerRig } from './playability-journey-observer.mjs';
import { assessManual, MANUAL_THRESHOLDS } from './playability-journey-assess.mjs';
import { pickResultLoot } from './playability-journey-loot.mjs';
import { ITEM_BY_ID } from '../src/data/items.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + name) return argv[i + 1];
    if (argv[i].startsWith('--' + name + '=')) return argv[i].slice(name.length + 3);
  }
  return undefined;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('node tools/playability-journey-qa.mjs --url <loopback url> --label <name> --expected-sha <40hex> [--chrome-executable <path>] [--manual-sec 150] [--finish auto|manual|none] [--finish-sec 240] [--deadline-sec 1500]');
  process.exit(0);
}
const num = (name, fallback, min, max) => { const v = Number(arg(name) ?? fallback); if (!Number.isFinite(v) || v < min || v > max) throw Error('--' + name + ' must be ' + min + '..' + max); return v; };

const target = new URL(arg('url') || 'http://127.0.0.1:4173/');
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.username || target.password || !/^https?:$/.test(target.protocol)) {
  console.error('playability-journey-qa: --url must be a loopback http(s) URL (localhost/127.0.0.1/[::1])'); process.exit(2);
}
const label = arg('label') || 'journey-' + new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(label) || label.includes('..')) { console.error('playability-journey-qa: invalid --label'); process.exit(2); }
const expectedSha = arg('expected-sha') || null;
if (expectedSha && !/^[0-9a-f]{40}$/.test(expectedSha)) { console.error('playability-journey-qa: --expected-sha must be 40 lowercase hex'); process.exit(2); }
const chromeExecutable = arg('chrome-executable') || null;
if (chromeExecutable && !existsSync(chromeExecutable)) { console.error('playability-journey-qa: --chrome-executable not found: ' + chromeExecutable); process.exit(2); }
const manualSec = num('manual-sec', 150, 20, 900);
const finishMode = arg('finish') || 'auto';
if (!['auto', 'manual', 'none'].includes(finishMode)) { console.error('playability-journey-qa: --finish must be auto|manual|none'); process.exit(2); }
const finishSec = num('finish-sec', 240, 30, 1200);
const deadlineSec = num('deadline-sec', 1500, 120, 7200);
const bootTimeoutSec = num('boot-timeout-sec', 300, 30, 1200);

const OUT_ROOT = path.join(REPO, 'work', 'qa', 'playability-journey');
const dir = path.join(OUT_ROOT, label);
await mkdir(OUT_ROOT, { recursive: true });
try { await mkdir(dir); } catch (error) { console.error('playability-journey-qa: output exists, refusing to overwrite: ' + dir + ' (' + error.code + ')'); process.exit(2); }

const VIEWPORT = { width: 844, height: 390 };
const ENERGY_REGEN_MS = 180000; // src/data/shop.js ENERGY.regenSec
const startedAt = Date.now();
const deadlineAt = startedAt + deadlineSec * 1000;
const report = {
  tool: 'tools/playability-journey-qa.mjs', label, started: new Date(startedAt).toISOString(), finished: null, status: 'running',
  target: target.href, expectedSha, head: null, headClean: null, servedVersion: null, versionBinding: null,
  browser: { launch: chromeExecutable ? 'installed-chrome-executable' : 'tools/chrome.mjs launchOpts', executablePath: chromeExecutable, args: null, headless: true, version: null, userAgent: null, gpu: null },
  viewport: { ...VIEWPORT, deviceScaleFactor: 1, hasTouch: true, isMobile: true, device: 'Pixel 7 profile (UA/touch), landscape 844x390' },
  scope: 'Playwright/CDP automation on a fresh browser profile. Real buttons, CDP multi-touch joystick/attack/dodge and real game clock. Not a physical Android Chrome/Samsung Internet device, GPU thermals or human feel result.',
  notPhysicalDevice: true, physicalTargets: ['Android Chrome', 'Samsung Internet'],
  fixture: false,
  fixtureBoundary: 'No app.step/testPause, invulnerability, enemy spawn, teleport, time warp, forced win, economy/selected-hero writes or app.startStage call. Page JS reads state and writes only window.__journeyObs.',
  options: { manualSec, finishMode, finishSec, deadlineSec, bootTimeoutSec },
  thresholds: MANUAL_THRESHOLDS,
  realInputs: { counts: {}, events: [] }, steps: [], errors: [], consoleErrors: [], screenshots: [], network: { rangerModels: [] },
  journey: {}, summary: null,
};
const J = report.journey;
let browser = null, page = null, cdp = null, finalized = false;
const save = () => writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
const remainingMs = () => deadlineAt - Date.now();
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
class StepFailure extends Error { constructor(message, detail) { super(message); this.detail = detail; } }
const fail = (message, detail) => { throw new StepFailure(message, detail); };

// ---------------------------------------------------------------- 단계 실행기
const step = async (name, fn, { required = true, timeoutSec = 120, needs = [] } = {}) => {
  const row = { name, required, status: 'running', at: new Date().toISOString() };
  report.steps.push(row); await save();
  const blocked = needs.find((n) => n && n.status !== 'PASS');
  if (remainingMs() <= 0) { row.status = 'NOT_RUN'; row.reason = 'deadline ' + deadlineSec + 's reached'; await save(); return row; }
  if (blocked) { row.status = 'NOT_RUN'; row.reason = 'prerequisite "' + blocked.name + '" was ' + blocked.status; await save(); return row; }
  const t0 = Date.now(), token = { cancelled: false };
  let timer = null;
  try {
    const limit = Math.max(1000, Math.min(timeoutSec * 1000, remainingMs()));
    const detail = await Promise.race([fn(token), new Promise((_, reject) => { timer = setTimeout(() => { token.cancelled = true; reject(new StepFailure('step timeout after ' + Math.round(limit / 1000) + 's')); }, limit); })]);
    if (detail?.notRun) { row.status = 'NOT_RUN'; row.reason = detail.reason; } else row.status = 'PASS';
    if (detail) row.detail = detail;
  } catch (error) {
    token.cancelled = true;
    row.status = 'FAIL'; row.error = String(error?.message || error);
    if (error?.detail !== undefined) row.detail = error.detail;
    if (!(error instanceof StepFailure)) row.stack = String(error?.stack || '').split('\n').slice(0, 4).join(' | ');
    await screenshot('zz-fail-' + report.steps.length, { step: name }).catch(() => {});
  } finally { clearTimeout(timer); }
  if (row.status !== 'PASS') await releaseTouches().catch(() => {});
  row.ms = Date.now() - t0;
  await save();
  return row;
};
const check = (name, result, opts) => step(name, async () => { if (!result.ok) fail(name + ' not met', result.detail); return result.detail; }, opts);

// ---------------------------------------------------------------- 입력(CDP 터치)
const touches = new Map();
const points = () => [...touches.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 }));
const logInput = (type, label, extra = {}) => {
  const c = report.realInputs.counts; c[type] = (c[type] || 0) + 1;
  if (report.realInputs.events.length < 800) report.realInputs.events.push({ t: Date.now() - startedAt, type, label, ...extra });
};
const T = {
  down: async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() }); },
  move: async (id, x, y, steps = 3) => {
    const from = touches.get(id); if (!from) return;
    for (let i = 1; i <= steps; i++) { touches.set(id, { x: from.x + (x - from.x) * i / steps, y: from.y + (y - from.y) * i / steps }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() }); }
  },
  // CDP touchEnd 의 touchPoints 는 떼는 손가락이다. 남은 손가락을 보내면 그 손가락이 떨어진다(root PC 보정).
  up: async (id) => {
    const p = touches.get(id); if (!p) return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 }] });
    touches.delete(id);
  },
};
async function releaseTouches() {
  for (const id of [...touches.keys()]) await T.up(id);
  if (M) M.joyDown = false;
}
async function probe(selector) {
  const h = await page.$(selector);
  if (!h) return { exists: false, visible: false, selector };
  try { return { ...(await h.evaluate(probeNode)), selector }; } finally { await h.dispose(); }
}
/** 스크롤 영역 안에서 가려진 요소는 실제 터치 스와이프로 보이게 한다(scrollIntoView·강제 클릭 없음). */
async function revealHandle(h, label) {
  let pr = await h.evaluate(probeNode);
  for (let n = 0; n < 8 && pr.visible && !(pr.inView && pr.hit); n++) {
    const sc = await h.evaluate(scrollerOf);
    if (!sc) break;
    const cx = sc.x + sc.w / 2, cy = sc.y + sc.h / 2;
    const span = sc.horizontal ? Math.min(sc.w * 0.6, 220) : Math.min(sc.h * 0.6, 220);
    const dx = sc.horizontal ? Math.sign(pr.x - cx) || 1 : 0, dy = sc.horizontal ? 0 : Math.sign(pr.y - cy) || 1;
    const sx = cx + dx * span / 2, sy = cy + dy * span / 2;
    await T.down(70, sx, sy); await T.move(70, sx - dx * span, sy - dy * span, 8); await T.up(70);
    logInput('touch-swipe', 'reveal ' + label, { scroller: sc.tag, horizontal: sc.horizontal });
    await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 5000 }).catch(() => {});
    await waitMs(250);
    pr = await h.evaluate(probeNode);
  }
  return pr;
}
async function tapHandle(h, label, { id = 60, hold = 45 } = {}) {
  let pr = await h.evaluate(probeNode);
  if (pr.visible && !(pr.inView && pr.hit)) pr = await revealHandle(h, label);
  if (!pr.exists || !pr.visible) fail(label + ' is not visible', pr);
  if (!pr.hit) fail(label + ' is covered at its centre by ' + pr.hitDesc, pr);
  if (pr.disabled) fail(label + ' is disabled', pr);
  await T.down(id, pr.x, pr.y); await waitMs(hold); await T.up(id);
  logInput('touch-tap', label, { x: Math.round(pr.x), y: Math.round(pr.y) });
  return pr;
}
async function tap(selector, label, opts) {
  const h = await page.$(selector);
  if (!h) fail(label + ': ' + selector + ' not found');
  try { return await tapHandle(h, label + ' [' + selector + ']', opts); } finally { await h.dispose(); }
}
async function waitFor(fn, argValue, timeoutMs, what) {
  try { return await page.waitForFunction(fn, argValue, { timeout: Math.max(500, Math.min(timeoutMs, remainingMs())), polling: 100 }); }
  catch (error) { fail('timed out waiting for ' + what + ' (' + Math.round(timeoutMs / 1000) + 's)', { diagnostics: await diagnose().catch(() => null) }); }
}
const diagnose = () => page.evaluate(() => {
  const app = window.app, b = app?.battle;
  return { mode: app?.mode, tab: app?.meta?.tab, active: !!b?.active, paused: !!b?.paused, stageStarting: !!app?.stageStarting, selected: app?.eco?.s?.selected, energy: app?.eco?.s?.energy,
    modal: (document.querySelector('#modal.show h2')?.textContent || '').trim() || null, dialog: !!document.querySelector('dialog[open]'), masterworks: !!document.querySelector('dialog#masterworks[open]'), cinematic: !!document.querySelector('.exp-cinematic'),
    result: app?.expeditionUI?.result ? { win: app.expeditionUI.result.win } : null, focused: document.activeElement?.id || document.activeElement?.tagName };
});

// ---------------------------------------------------------------- 캡처
async function screenshot(name, note = null) {
  if (!cdp) return null;
  const file = name.replace(/[^\w.-]/g, '_') + '.png';
  const shot = await Promise.race([cdp.send('Page.captureScreenshot', { format: 'png' }), waitMs(90000).then(() => null)]);
  if (!shot) { report.screenshots.push({ file: null, name, note, error: 'capture timeout' }); return null; }
  await writeFile(path.join(dir, file), Buffer.from(shot.data, 'base64'));
  report.screenshots.push({ file, name, at: Date.now() - startedAt, note });
  return file;
}
const battleNote = async () => {
  const s = await page.evaluate(readBattle).catch(() => null);
  const shots = await page.evaluate(() => window.__journeyObs?.counters?.shots ?? null).catch(() => null);
  return s?.player ? { clock: s.clock, state: s.player.state, auto: s.player.auto, joy: s.input.joy, hp: Math.round(s.player.hp), enemies: s.enemies.length, observedShots: shots } : null;
};

// ---------------------------------------------------------------- 공통 흐름 조각
async function dismissRotate() {
  const pr = await probe('#rotate-hint #btn-ignore-rotate');
  if (!pr.visible || !pr.hit) return null;
  await tap('#rotate-hint #btn-ignore-rotate', 'rotate hint: continue');
  return { dismissed: true, text: pr.text };
}
async function closeNaturalModals() {
  const closed = [];
  // autoPopups 는 첫 로비 진입 0.6초 뒤 출석 창을 연다. 열림 이벤트를 짧게 기다린다(열리지 않으면 없음으로 기록).
  await page.waitForFunction(() => !!document.querySelector('#modal.show'), null, { timeout: 6000, polling: 100 }).catch(() => {});
  for (let n = 0; n < 6; n++) {
    const info = await page.evaluate(() => { const m = document.querySelector('#modal.show'); return m ? { head: (m.querySelector('h2')?.textContent || '').trim(), buttons: [...m.querySelectorAll('button')].map((b) => b.id || b.textContent.trim()).slice(0, 6) } : null; });
    if (!info) break;
    const cancel = await probe('#modal.show #m-cancel');
    if (!cancel.visible) fail('natural modal has no visible close button', info);
    await tap('#modal.show #m-cancel', 'close natural modal "' + info.head + '"');
    closed.push({ ...info, closedWith: '#m-cancel', attendance: /출석/.test(info.head), claimed: false });
    await page.waitForFunction(() => !document.querySelector('#modal.show'), null, { timeout: 8000, polling: 100 }).catch(() => {});
    await page.waitForFunction(() => !!document.querySelector('#modal.show'), null, { timeout: 1200, polling: 100 }).catch(() => {});
  }
  return closed;
}
const lobby = () => page.evaluate(readLobby);
const costOf = (text) => { const m = String(text || '').match(/\d+/); return m ? Number(m[0]) : null; };
/** 에너지 1회 차감 확인. 자연 회복(180초 주기)이 사이에 끼면 energyT 이동으로 보정해 기록한다. */
function energyCharge(before, after, cost) {
  const regen = before.energy < (before.energyMax ?? 100) && after.energyT > before.energyT ? Math.round((after.energyT - before.energyT) / ENERGY_REGEN_MS) : 0;
  const charge = before.energy - after.energy + regen;
  return { ok: cost !== null && charge === cost, cost, before: before.energy, after: after.energy, regenTicks: regen, charge };
}
async function waitPreparation() {
  await waitFor(() => { const d = document.querySelector('.citadel-hub-dialog[open]'); return !!d && !!d.querySelector('#citadel-destination-title')?.textContent.trim() && !!d.querySelector('.citadel-hub-go')?.textContent.trim(); }, null, 30000, 'dungeon preparation dialog');
  const s = await lobby();
  return { ...s.prep, costValue: costOf(s.prep.cost), energy: s.energy };
}
/** 최종 출격 → (입장 영상이면 실제 건너뛰기 버튼) → 전투 준비 완료. */
async function sortieFromPreparation(tag) {
  const before = await lobby();
  const prep = before.prep;
  if (!prep) fail('preparation dialog is not open');
  if (prep.goDisabled) fail('final sortie button disabled: ' + prep.go, prep);
  const cost = costOf(prep.cost);
  await tap('.citadel-hub-dialog[open] .citadel-hub-go', tag + ' final sortie "' + prep.go + '"');
  const film = { seen: false, skipped: false };
  await waitFor(() => !!document.querySelector('.exp-cinematic') || (window.app?.mode === 'battle' && !!window.app.battle?.active && !window.app.stageStarting), null, 180000, tag + ' battle or entrance film');
  if (await page.evaluate(() => !!document.querySelector('.exp-cinematic'))) {
    film.seen = true;
    await screenshot(tag + '-entrance-film', { note: 'entrance film shown by the game' });
    const skip = await probe('.exp-cinematic button');
    if (skip.visible && skip.hit) { await tap('.exp-cinematic button', tag + ' entrance film skip'); film.skipped = true; }
    await waitFor(() => !document.querySelector('.exp-cinematic'), null, 20000, 'entrance film end');
  }
  await waitFor(() => window.app?.mode === 'battle' && !!window.app.battle?.active && !window.app.stageStarting && !window.app.battle.paused && !!window.app.battle.player, null, 180000, tag + ' battle ready');
  const after = await lobby();
  return { prep, cost, before: { energy: before.energy, energyT: before.energyT }, after: { energy: after.energy, energyT: after.energyT }, energy: energyCharge(before, after, cost), film, battle: after.battle, journeyAuto: after.journeyAuto };
}

// ---------------------------------------------------------------- 수동 전투 제어
const JOY = 1, ATTACK = 2, DODGE = 3, POTION = 4, STICK_PX = 46;
let M = null;
const acc = { frames: [], shots: [], ended: [], damage: [], transitions: [], counters: {}, lastError: null };
async function pull() {
  const d = await page.evaluate(drainObserver).catch(() => null);
  if (!d) return;
  for (const k of ['frames', 'shots', 'ended', 'damage', 'transitions']) acc[k].push(...d[k]);
  acc.counters = d.counters; if (d.lastError) acc.lastError = d.lastError;
}
async function setStick(dir, camYaw) {
  if (!dir) { if (M.joyDown) { await T.up(JOY); M.joyDown = false; } return; }
  const s = worldToStick(dir.x, dir.z, camYaw);
  const tx = M.anchor.x + s.x * STICK_PX, ty = M.anchor.y + s.y * STICK_PX;
  if (!M.joyDown) { await T.down(JOY, M.anchor.x, M.anchor.y); M.joyDown = true; await T.move(JOY, tx, ty, 3); logInput('touch-joystick', 'joystick down'); }
  else { await T.move(JOY, tx, ty, 2); M.stickMoves++; }
}
/** 전투 버튼은 touchstart 로 동작한다. 조이스틱을 누른 채 둘째 손가락으로 누른다. 가려졌으면 입력하지 않고 센다. */
async function pressButton(selector, id, label) {
  const pr = await probe(selector);
  if (!pr.visible || !pr.hit || pr.disabled) { M.blockedTaps.push({ label, pr: { visible: pr.visible, hit: pr.hit, hitDesc: pr.hitDesc, disabled: pr.disabled } }); return false; }
  await T.down(id, pr.x, pr.y); await waitMs(40); await T.up(id);
  logInput('touch-button', label, { withJoystick: M.joyDown });
  return true;
}
async function ensureGrid(s) {
  const key = s.worldKey + '|' + s.sealed;
  if (M.gridKey === key && M.grid) return;
  const raw = await page.evaluate(readGrid);
  M.grid = decodeGrid(raw); M.gridKey = key; M.fieldKey = null; M.gridLoads++;
  if (raw) M.cellCheck = inferCell(raw);
}
function exploreGoal(s) {
  if (s.portal) return { ...s.portal, why: 'portal' };
  const boss = s.rooms.find((r) => r.id === s.bossRoomId);
  if (boss && !boss.cleared && boss.discovered && !s.sealed) return { x: boss.x, z: boss.z, why: 'boss-room' };
  const p = s.player;
  const cands = s.rooms.filter((r) => !r.cleared && !(s.sealed && r.id === s.bossRoomId)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  return cands[0] ? { x: cands[0].x, z: cands[0].z, why: 'room:' + cands[0].type } : null;
}
async function navigate(s, goal, why) {
  const p = s.player, now = Date.now();
  const key = Math.round(goal.x) + ',' + Math.round(goal.z) + '|' + M.gridKey;
  if (M.fieldKey !== key) { M.field = M.grid ? distanceField(M.grid, goal.x, goal.z) : null; M.fieldKey = key; }
  // 두 셀 앞 셀 중심을 향한다(실제 미끄러짐·제어 주기 모의에서 막힘 없이 가장 빨랐다).
  let dir = M.field ? pathDirection(M.grid, M.field, p.x, p.z, 2) : null;
  if (!dir || dir.arrived || (dir.x === 0 && dir.z === 0)) {
    const dx = goal.x - p.x, dz = goal.z - p.z, l = Math.hypot(dx, dz);
    if (l < 0.6) { await setStick(null); return; }
    dir = { x: dx / l, z: dz / l };
  }
  // 막힘: 1.5초 동안 0.4 유닛도 못 가면 0.5초 옆으로 비킨다.
  if (!M.lastPos || Math.hypot(p.x - M.lastPos.x, p.z - M.lastPos.z) > 0.4) { M.lastPos = { x: p.x, z: p.z }; M.lastProgress = now; }
  else if (M.joyDown && now - M.lastProgress > 1500) { M.stuck++; M.sideSign = -M.sideSign; M.stuckDir = { x: -dir.z * M.sideSign, z: dir.x * M.sideSign }; M.stuckUntil = now + 500; M.lastProgress = now; }
  if (now < M.stuckUntil && M.stuckDir) dir = M.stuckDir;
  await setStick(dir, s.camYaw);
  M.actions[why] = (M.actions[why] || 0) + 1;
}
async function maybePotion(s, phase) {
  const p = s.player;
  if (!p || p.hp / Math.max(1, p.maxHp) >= 0.35 || Date.now() - M.potionAt < 3000) return;
  const potion = s.potions.find((x) => x.id === 'hp_tonic' && x.n > 0 && !x.disabled);
  if (!potion) return;
  // 물약 버튼은 click 으로 동작한다. 첫 손가락 탭이 되도록 조이스틱을 먼저 뗀다.
  await setStick(null);
  M.potionAt = Date.now();
  try { await tap('.exp-potions [data-potion="hp_tonic"]', 'potion hp_tonic', { id: POTION }); M.potions.push({ phase, clock: s.clock, hp: Math.round(p.hp), before: potion.n }); }
  catch (error) { M.potions.push({ phase, clock: s.clock, error: String(error.message) }); }
}
/**
 * 자연 진행 중 열리는 원정 각인·길 위의 만남 선택(dialog#masterworks[open]). 이 화면은 전투를 멈추고 선택을 기다린다.
 * 실제 보이는 선택 카드를 CDP 탭으로 고른다(각인은 첫 카드, 만남은 회복 선택이 있으면 그것). 대화상자를 닫거나 상태를 쓰지 않는다.
 */
async function handleMasterworksChoice(s, phase) {
  const mw = s.masterworks; if (!mw) return null;
  await setStick(null); await releaseTouches();
  let selector = null, picked = null, kind = null;
  if (mw.boons.length) { kind = 'boon'; picked = mw.boons[0]; selector = 'dialog#masterworks[open] [data-boon="' + picked + '"]'; }
  else if (mw.stories.length) { kind = 'story'; picked = (mw.stories.find((c) => c.reward === 'heal') || mw.stories[0]).id; selector = 'dialog#masterworks[open] [data-story-choice="' + picked + '"]'; }
  const entry = { phase, clock: s.clock, title: mw.title, kind, options: kind === 'boon' ? mw.boons : mw.stories.map((c) => c.id), picked };
  if (!selector) { entry.waiting = true; (M.choices ||= []).push(entry); await waitMs(250); return 'waiting'; }
  await tap(selector, 'masterworks ' + kind + ' choice ' + picked);
  await page.waitForFunction((before) => { const d = document.querySelector('dialog#masterworks[open]'); return !d || !d.querySelector('[data-boon="' + before + '"], [data-story-choice="' + before + '"]'); }, picked, { timeout: 8000, polling: 100 }).catch(() => {});
  entry.after = await page.evaluate(() => ({ open: !!document.querySelector('dialog#masterworks[open]'), paused: !!window.app.battle?.paused, reasons: window.app.battle?.pauseReasons ? [...window.app.battle.pauseReasons] : [] }));
  (M.choices ||= []).push(entry);
  return 'picked';
}
/** 전투 중 모달: 사망이면 보석 부활 대신 '전투 마치기', 닫기 버튼이 있으면 닫기. */
async function handleBattleModal(s, phase) {
  await setStick(null);
  const no = await probe('#modal.show #r-no');
  if (no.visible) {
    M.deaths.push({ phase, clock: s.clock, head: s.modal.head });
    await screenshot('zz-death-' + phase, { modal: s.modal });
    await tap('#modal.show #r-no', 'death: end battle without gem revive');
    return 'death';
  }
  const cancel = await probe('#modal.show #m-cancel');
  if (cancel.visible && cancel.hit) { await tap('#modal.show #m-cancel', 'close battle modal "' + s.modal.head + '"'); M.modals.push({ phase, head: s.modal.head, closedWith: '#m-cancel' }); return 'closed'; }
  M.modals.push({ phase, head: s.modal.head, buttons: s.modal.buttons, closedWith: null });
  await waitMs(250);
  return 'waiting';
}
const ACTIONS = ['strafe', 'retreat', 'dodge'];
async function combatAction(s, foe, d) {
  const p = s.player;
  let kind = ACTIONS[M.actionIdx % ACTIONS.length];
  if (kind === 'dodge' && p.dodgeCd > 0) kind = 'strafe';
  if (d < 3.2 && kind === 'strafe') kind = 'retreat';
  const ev = evasiveDirection(M.grid, p.x, p.z, foe.x, foe.z, kind === 'strafe' ? 'strafe' : 'retreat', M.sideSign);
  M.sideSign = -M.sideSign;
  await setStick(ev, s.camYaw);
  if (kind === 'dodge') {
    await waitMs(90);
    const dodged = await pressButton('#btn-dodge', DODGE, 'dodge button');
    await waitMs(70);
    const shot = dodged && await pressButton('#btn-attack', ATTACK, 'attack button after dodge');
    M.actions.dodgeShot = (M.actions.dodgeShot || 0) + (shot ? 1 : 0);
    if (shot && !M.captured.dodge) { await waitMs(140); M.captured.dodge = await screenshot('06-manual-dodge-shot', await battleNote()); }
    await waitMs(380);
  } else {
    // 이동이 실제로 붙은 뒤 공격한다(이동 중 사격).
    await waitMs(170);
    const shot = await pressButton('#btn-attack', ATTACK, 'attack button while moving (' + ev.kind + ')');
    M.actions[kind + 'Shot'] = (M.actions[kind + 'Shot'] || 0) + (shot ? 1 : 0);
    if (shot && !M.captured.draw) { await waitMs(60); M.captured.draw = await screenshot('04-manual-moving-draw', { ...(await battleNote()), move: ev.kind }); }
    await waitMs(260);
    if (shot && !M.captured.release) M.captured.release = await screenshot('05-manual-release', { ...(await battleNote()), move: ev.kind });
  }
  M.actionIdx++;
  M.nextActionAt = Date.now() + 140;
}
/** 실제 입력 제어 루프. 수동 판정이 모두 충족되거나 시간이 다하거나 전투가 끝나면 멈춘다. */
async function controlLoop(token, { untilMs, phase, stopWhenAssessed }) {
  let assessedAt = 0, reason = 'time budget reached', assessment = null;
  while (!token.cancelled) {
    if (Date.now() >= untilMs) break;
    const s = await page.evaluate(readBattle);
    if (s.mode !== 'battle' || !s.active) { reason = s.result ? 'battle finished' : 'battle inactive'; break; }
    if (s.masterworks) { await handleMasterworksChoice(s, phase); continue; }
    if (s.modal) { if (await handleBattleModal(s, phase) === 'death') { reason = 'player died'; break; } continue; }
    if (s.cinematic) { await setStick(null); const sk = await probe('.exp-cinematic button'); if (sk.visible && sk.hit) await tap('.exp-cinematic button', 'film skip'); else await waitMs(200); continue; }
    if (!s.player) { await waitMs(100); continue; }
    if (s.player.auto) { reason = 'AUTO turned on outside the tool'; M.unexpectedAuto = true; break; }
    if (s.paused || !s.player.alive) { await setStick(null); await waitMs(120); continue; }
    await ensureGrid(s);
    await maybePotion(s, phase);
    const p = s.player;
    const foes = s.enemies.filter((e) => !e.spawning && !e.invuln).map((e) => ({ ...e, d: Math.hypot(e.x - p.x, e.z - p.z) })).sort((a, b) => a.d - b.d);
    const foe = foes[0];
    if (foe) {
      const los = clearLine(M.grid, p.x, p.z, foe.x, foe.z, foe.r);
      // 화살 사거리(12) 안쪽 9.5 이내에서 시야가 열리면 이동 사격, 아니면 실제 조이스틱으로 다가간다.
      if (los && foe.d <= 9.5) { if (Date.now() >= M.nextActionAt) await combatAction(s, foe, foe.d); }
      else await navigate(s, foe, los ? 'close-in' : 'approach');
    } else if (s.enemies.some((e) => e.spawning)) {
      await setStick(null); M.actions.waitSpawn = (M.actions.waitSpawn || 0) + 1;
    } else {
      const goal = exploreGoal(s);
      if (goal) await navigate(s, goal, 'explore'); else await setStick(null);
      M.lastGoal = goal;
    }
    if (Date.now() - assessedAt > 1000) {
      assessedAt = Date.now(); await pull();
      assessment = assessManual(acc);
      if (stopWhenAssessed && Object.values(assessment.checks).every((c) => c.ok)) { reason = 'all manual observations met'; break; }
    }
    await waitMs(40);
  }
  await setStick(null);
  await pull();
  return reason;
}

// ---------------------------------------------------------------- 실행
const exitWith = async (status, error) => {
  if (finalized) return;
  finalized = true;
  if (error) report.errors.push('driver: ' + String(error?.stack || error).split('\n').slice(0, 5).join(' | '));
  const required = report.steps.filter((s) => s.required);
  report.summary = { pass: report.steps.filter((s) => s.status === 'PASS').length, fail: report.steps.filter((s) => s.status === 'FAIL').length, notRun: report.steps.filter((s) => s.status === 'NOT_RUN').length,
    requiredPass: required.filter((s) => s.status === 'PASS').length, required: required.length };
  report.status = status || (required.some((s) => s.status === 'FAIL') || report.errors.length ? 'fail' : required.some((s) => s.status !== 'PASS') ? 'partial' : 'pass');
  report.finished = new Date().toISOString();
  report.wallSec = Math.round((Date.now() - startedAt) / 1000);
  try { writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2)); } catch {}
  // 판정 근거가 된 원시 관측(읽기 전용 샘플)을 따로 남긴다.
  try { writeFileSync(path.join(dir, 'samples.json'), JSON.stringify({ label, note: 'Raw read-only observer samples (window.__journeyObs). phase=manual is the scored segment.', ...acc }, null, 1)); } catch {}
  try { await browser?.close(); } catch {}
  console.log('playability-journey-qa ' + report.status + ' ' + JSON.stringify(report.summary) + ' -> ' + path.relative(REPO, dir));
  for (const s of report.steps) console.log('  ' + s.status.padEnd(7) + (s.required ? ' ' : ' (optional) ') + s.name + (s.error ? ' :: ' + s.error : s.reason ? ' :: ' + s.reason : ''));
  process.exitCode = report.status === 'pass' ? 0 : 1;
};
const hardStop = setTimeout(() => { exitWith('fail', new Error('hard deadline ' + (deadlineSec + 120) + 's exceeded')).then(() => process.exit(1)); }, (deadlineSec + 120) * 1000);
hardStop.unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { exitWith('interrupted', new Error('received ' + sig)).then(() => process.exit(130)); });

try {
  try { report.head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { report.head = null; }
  try { report.headClean = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === ''; } catch { report.headClean = null; }
  try { report.servedVersion = await (await fetch(new URL('version.json', target), { cache: 'no-store' })).json(); } catch (error) { report.servedVersion = { error: String(error?.message || error) }; }

  const opts = chromeExecutable ? { executablePath: chromeExecutable, headless: true } : launchOpts({ headless: true });
  report.browser.args = opts.args || [];
  report.browser.executablePath = opts.executablePath || null;
  browser = await chromium.launch(opts);
  report.browser.version = browser.version();
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: VIEWPORT, screen: VIEWPORT, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  cdp = await context.newCDPSession(page);
  report.browser.userAgent = await page.evaluate(() => navigator.userAgent);
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + String(e?.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && report.consoleErrors.length < 50) report.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('response', (r) => { const u = r.url(); if (/ranger/i.test(u) && /\.glb(\?|$)/i.test(u)) report.network.rangerModels.push({ path: new URL(u).pathname, status: r.status() }); });

  // 1. 버전 결합
  await step('served build and git HEAD match --expected-sha (clean)', async () => {
    const v = report.servedVersion || {};
    report.versionBinding = { expectedSha, served: v.sha || null, servedDirty: v.dirty ?? null, head: report.head, headClean: report.headClean };
    if (!expectedSha) return { notRun: true, reason: 'no --expected-sha given', ...report.versionBinding };
    if (v.sha !== expectedSha || v.dirty !== false) fail('served version.json is not the exact clean expected build', report.versionBinding);
    if (report.head !== expectedSha) fail('git HEAD differs from --expected-sha', report.versionBinding);
    return report.versionBinding;
  }, { timeoutSec: 30 });

  // 2. 부팅 · 자연 팝업
  const boot = await step('fresh profile boot via start button, natural popups closed', async () => {
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitFor(() => { const b = document.querySelector('#boot-start'); return !!b && !b.classList.contains('hidden') && !b.disabled; }, null, bootTimeoutSec * 1000, 'boot start button');
    const rotate = [await dismissRotate()];
    const bootLabel = (await probe('#boot-start')).text;
    const storage = await page.evaluate(() => Object.keys(localStorage).length);
    await tap('#boot-start', 'boot start');
    await waitFor(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, 180000, 'lobby after boot');
    rotate.push(await dismissRotate());
    const closed = await closeNaturalModals();
    report.browser.gpu = await page.evaluate(readGpu);
    J.boot = { bootLabel, localStorageKeysBeforeStart: storage, rotate: rotate.filter(Boolean), closedModals: closed, attendanceClosed: closed.some((m) => m.attendance), fullscreen: await page.evaluate(() => !!document.fullscreenElement) };
    await screenshot('00-lobby', { closedModals: closed.length });
    return J.boot;
  }, { timeoutSec: bootTimeoutSec + 240 });
  if (boot.status !== 'PASS') throw new Error('boot failed; later steps not run');

  // 3. 영웅 UI 로 궁수 선택
  const select = await step('select Ranger through hero UI (card, 출전시키기 if needed)', async () => {
    const before = await lobby();
    await tap('#meta .bottomnav [data-tab="heroes"]', 'bottom nav heroes');
    await waitFor(() => window.app?.meta?.tab === 'heroes' && !!document.querySelector('#hero-list [data-hero-id="ranger"]'), null, 30000, 'hero list with ranger');
    await tap('#hero-list [data-hero-id="ranger"]', 'hero card ranger');
    await waitFor(() => window.app.meta.heroSel === 'ranger', null, 15000, 'ranger hero detail');
    let usedSelectButton = false;
    if ((await probe('#h-sel')).visible) { await tap('#h-sel', '출전시키기'); usedSelectButton = true; }
    await waitFor(() => window.app.eco.s.selected === 'ranger' && document.querySelector('#hero-list [data-hero-id="ranger"]')?.getAttribute('aria-pressed') === 'true' && /출전 중/.test(document.querySelector('#hero-detail .hs-go')?.textContent || ''), null, 15000, 'ranger selected (출전 중)');
    J.selection = { before: before.selected, after: (await lobby()).selected, usedSelectButton, header: await page.evaluate(() => (document.querySelector('#hero-detail .hs-head')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)) };
    return J.selection;
  }, { needs: [boot], timeoutSec: 90 });
  await step('selected Ranger 3D preview ready before capture', async () => {
    const ready = await page.waitForFunction(() => { const c = document.querySelector('#hero-wardrobe canvas'), r = c?.getBoundingClientRect(); return !!window.app?.wardrobe?.instance && !!r && r.width > 100 && r.height > 100; }, null, { timeout: Math.min(90000, remainingMs()), polling: 200 }).then(() => true).catch(() => false);
    J.selectionPreview = await page.evaluate(readWardrobe);
    await screenshot('01-selected-ranger', J.selectionPreview);
    if (!ready) fail('hero 3D preview not ready within 90s', J.selectionPreview);
    return J.selectionPreview;
  }, { required: false, needs: [select], timeoutSec: 150 });

  // 4. 홈 단일 CTA → 준비 → 취소(비용 0) → 다시 준비
  const prep = await step('home single CTA opens dungeon preparation; cancel costs zero', async () => {
    await tap('#meta .bottomnav [data-tab="home"]', 'bottom nav home');
    await waitFor(() => window.app?.meta?.tab === 'home' && !!document.querySelector('#citadel-dungeon-prepare'), null, 20000, 'home landing');
    const ia = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !n.closest('[hidden]'); };
      return { ctas: [...document.querySelectorAll('#tab-home .dl-cta, #tab-home .btn-gold, #tab-home .mpl-cmd-go')].filter(vis).map((b) => (b.id || '') + ':' + b.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)),
        nav: [...document.querySelectorAll('#meta .bottomnav button')].filter(vis).map((b) => b.textContent.trim().replace(/\s+/g, ' ')), title: document.querySelector('#citadel-command-title')?.textContent?.trim() || null };
    });
    if (ia.ctas.length !== 1) fail('home landing must show exactly one emphasized CTA', ia);
    const before = await lobby();
    await tap('#citadel-dungeon-prepare', 'home CTA 출격 준비');
    const opened = await waitPreparation();
    if (opened.energy !== before.energy) fail('opening preparation changed energy', { before: before.energy, opened });
    await screenshot('02-preparation', opened);
    await tap('.citadel-hub-dialog[open] .citadel-hub-cancel', 'preparation 돌아가기');
    await waitFor(() => !document.querySelector('.citadel-hub-dialog[open]'), null, 10000, 'preparation closed');
    const cancelled = await lobby();
    if (cancelled.energy !== before.energy) fail('cancel changed energy', { before: before.energy, after: cancelled.energy });
    await tap('#citadel-dungeon-prepare', 'home CTA 출격 준비 (again)');
    const again = await waitPreparation();
    if (again.title !== opened.title) fail('reopened preparation shows a different dungeon', { opened, again });
    if (again.costValue === null) fail('preparation cost not readable', again);
    J.preparation = { ia, opened, cancelEnergy: { before: before.energy, after: cancelled.energy }, again };
    return J.preparation;
  }, { needs: [boot], timeoutSec: 120 });

  // 5. 최종 출격(1회 차감)
  const entry = await step('final sortie starts battle and spends catalog energy once', async () => {
    const r = await sortieFromPreparation('entry');
    J.entry = r;
    await screenshot('03-battle-start', await battleNote());
    if (r.battle.hero !== 'ranger') fail('battle hero is not ranger', r);
    if (!r.energy.ok) fail('energy charge differs from catalog cost', r.energy);
    return r;
  }, { needs: [select, prep], timeoutSec: 300 });

  // 6. AUTO 꺼짐 · 교정 리그(읽기 전용)
  const autoOff = await step('AUTO is off for the manual segment (flag recorded)', async () => {
    const s0 = await lobby();
    let toggled = false;
    if (s0.battle.auto) { await tap('#btn-auto', 'AUTO off'); toggled = true; await waitFor(() => window.app.battle?.player?.auto === false, null, 10000, 'AUTO off'); }
    const s1 = await page.evaluate(() => ({ auto: !!window.app.battle.player.auto, buttonOn: document.querySelector('#btn-auto').classList.contains('on'), journeyAuto: window.app.journey?.s?.autoBattle ?? null }));
    if (s1.auto || s1.buttonOn) fail('AUTO still on', s1);
    J.autoOff = { initial: s0.battle.auto, toggledOffByTool: toggled, ...s1 };
    return J.autoOff;
  }, { needs: [entry], timeoutSec: 30 });
  await step('corrected Ranger grip/nock/string sockets present at runtime (read-only)', async () => {
    const rig = await page.evaluate(readRangerRig);
    J.rig = { ...rig, network: report.network.rangerModels.slice(0, 6) };
    const missing = Object.entries(rig?.sockets || {}).filter(([, v]) => !v).map(([k]) => k);
    if (!rig || rig.hero !== 'ranger' || missing.length || !rig.upperClip || !rig.rangerAim) fail('corrected ranger rig not present', { ...J.rig, missing });
    return J.rig;
  }, { needs: [entry], timeoutSec: 30 });

  // 7. 수동 실시간 전투
  const manual = await step('manual Ranger segment: CDP joystick + attack/dodge buttons vs naturally spawned enemies', async (token) => {
    const installed = await page.evaluate(installObserver, 'manual');
    const anchor = await page.evaluate(() => {
      const el = document.querySelector('#joy'); if (!el) return null;
      const r = el.getBoundingClientRect();
      for (const fy of [0.6, 0.5, 0.7, 0.4, 0.8]) for (const fx of [0.35, 0.3, 0.45, 0.25, 0.55]) { const x = r.x + r.width * fx, y = r.y + r.height * fy, h = document.elementFromPoint(x, y); if (h && (h === el || el.contains(h))) return { x, y, area: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }
      return null;
    });
    if (!anchor) fail('joystick area #joy is not hit-testable');
    M = { anchor, joyDown: false, grid: null, gridKey: null, gridLoads: 0, cellCheck: null, field: null, fieldKey: null, sideSign: 1, actionIdx: 0, nextActionAt: 0, lastPos: null, lastProgress: Date.now(), stuck: 0, stuckDir: null, stuckUntil: 0,
      actions: {}, blockedTaps: [], potions: [], potionAt: 0, deaths: [], modals: [], captured: {}, stickMoves: 0, lastGoal: null, unexpectedAuto: false };
    const t0 = Date.now(), s0 = await page.evaluate(readBattle);
    const reason = await controlLoop(token, { untilMs: t0 + manualSec * 1000, phase: 'manual', stopWhenAssessed: true });
    const s1 = await page.evaluate(readBattle);
    J.manual = { installed, anchor, endReason: reason, wallSec: Math.round((Date.now() - t0) / 100) / 10, clock: [s0.clock, s1.clock], kills: [s0.kills, s1.kills], dmg: [s0.dmg, s1.dmg],
      actions: M.actions, blockedTaps: M.blockedTaps.slice(0, 20), blockedTapCount: M.blockedTaps.length, potions: M.potions, deaths: M.deaths, modals: M.modals, choices: M.choices || [], stuck: M.stuck, gridLoads: M.gridLoads, inferredCell: M.cellCheck,
      observerError: acc.lastError, samples: { frames: acc.frames.length, shots: acc.shots.length, ended: acc.ended.length, damage: acc.damage.length } };
    if (M.unexpectedAuto) fail('AUTO turned on during the manual segment', J.manual);
    // 이 단계는 수동 구간을 실제로 실행했는지만 본다. 사격·명중·이동 판정은 아래 개별 단계가 같은 샘플로 PASS/FAIL 한다.
    return J.manual;
  }, { needs: [autoOff], timeoutSec: manualSec + 120 });
  const assessment = assessManual(acc);
  J.manualAssessment = { checks: assessment.checks, shots: assessment.shots.slice(0, 60) };
  const mc = assessment.checks, mopt = { needs: [manual], timeoutSec: 10 };
  await check('manual: joystick moves the Ranger with AUTO off', mc.joystickMovement, mopt);
  await check('manual: basic arrow direction matches aimed enemy (movement-independent aim)', mc.aimTowardTarget, mopt);
  await check('manual: strafe while shooting (move direction 45-135 deg from shot)', mc.strafeShot, mopt);
  await check('manual: retreat while shooting (move direction >=120 deg from shot)', mc.retreatShot, mopt);
  await check('manual: dodge button then aimed shot (dodge -> attack)', mc.dodgeThenShot, mopt);
  await check('manual: normal basic attack spawns one arrow (data count per combo)', mc.normalSingleArrow, mopt);
  await check('manual: arrows hit and damage naturally spawned enemies', mc.arrowDamagesEnemy, mopt);
  await check('manual: natural game clock advanced (no pause/time warp)', mc.gameClockProgress, mopt);
  await check('manual: bow string held during moving draw (runtime pose flag)', mc.movingDrawHeld, mopt);

  // 8. 정상 종료(자동 완주 표시) → 결과
  const completion = await step('natural battle completion: victory (' + (finishMode === 'auto' ? 'AUTO via real button after manual segment' : finishMode === 'manual' ? 'manual input' : 'not attempted') + ')', async (token) => {
    let s = await page.evaluate(readBattle);
    J.completion = { mode: finishMode, label: finishMode === 'auto' ? 'automatic completion: AUTO turned on with the real button after the manual segment; only owned potions via real buttons' : finishMode, deaths: [], potions: [] };
    if (finishMode === 'none' && s.active) return { notRun: true, reason: '--finish none' };
    if (!M) M = { joyDown: false, actions: {}, blockedTaps: [], potions: [], potionAt: 0, deaths: [], modals: [], captured: {}, stickMoves: 0 };
    const until = Date.now() + finishSec * 1000;
    if (s.modal) { await handleBattleModal(s, 'completion'); s = await page.evaluate(readBattle); }
    // AUTO 버튼을 누르기 전에 화면을 덮은 각인·만남 선택을 실제로 고른다.
    for (let n = 0; n < 4 && s.masterworks; n++) { await handleMasterworksChoice(s, 'completion'); s = await page.evaluate(readBattle); }
    if (s.active && finishMode === 'auto') {
      await releaseTouches();
      await page.evaluate(setObserverPhase, 'auto');
      await tap('#btn-auto', 'AUTO on (automatic completion)');
      await waitFor(() => window.app.battle?.player?.auto === true, null, 10000, 'AUTO on');
      J.completion.autoOnAtClock = (await page.evaluate(readBattle)).clock;
      await screenshot('07-auto-completion', await battleNote());
    }
    if (s.active && finishMode === 'manual') {
      await page.evaluate(setObserverPhase, 'manual-finish');
      M.anchor = M.anchor || J.manual?.anchor;
      J.completion.manualEndReason = await controlLoop(token, { untilMs: until, phase: 'manual-finish', stopWhenAssessed: false });
    }
    while (!token.cancelled && Date.now() < until) {
      s = await page.evaluate(readBattle);
      if (s.result && s.resultVisible) break;
      if (s.masterworks) { await handleMasterworksChoice(s, 'completion'); continue; }
      if (s.modal) { await handleBattleModal(s, 'completion'); continue; }
      if (s.cinematic) { const sk = await probe('.exp-cinematic button'); if (sk.visible && sk.hit) await tap('.exp-cinematic button', 'film skip'); continue; }
      if (s.active && s.player?.alive && !s.paused) await maybePotion(s, 'completion');
      await waitMs(300);
    }
    s = await page.evaluate(readBattle);
    J.completion.deaths = M.deaths.filter((d) => d.phase !== 'manual'); J.completion.potions = M.potions; J.completion.choices = (M.choices || []).filter((c) => c.phase !== 'manual');
    await pull();
    const later = acc.shots.filter((x) => x.phase !== 'manual');
    J.completion.observed = { shotsAfterManual: later.length, autoShots: later.filter((x) => x.auto).length, damageEventsAfterManual: acc.damage.filter((d) => d.phase !== 'manual').length };
    if (!(s.result && s.resultVisible)) {
      // 시간 초과: 결과 이후 흐름을 이어 검사하도록 실제 일시정지 → 포기로 끝낸다. 승리는 NOT_RUN 이다.
      const was = { clock: s.clock, active: s.active, hp: s.player ? Math.round(s.player.hp) : null, enemies: s.enemies.length, kills: s.kills };
      // 일시정지 버튼을 덮은 선택 대화상자가 남아 있으면 먼저 실제로 고른다(덮인 버튼은 누르지 않는다).
      for (let n = 0; n < 4 && s.masterworks; n++) { await handleMasterworksChoice(s, 'timeout'); s = await page.evaluate(readBattle); }
      if (s.active) {
        await releaseTouches();
        await tap('#btn-pause', 'pause (finish timeout)');
        await waitFor(() => { const b = document.querySelector('#btn-giveup'); const r = b?.getBoundingClientRect(); return !!r && r.width > 0; }, null, 10000, 'pause panel');
        await tap('#btn-giveup', 'give up (finish timeout)');
      }
      await waitFor(() => !!window.app.expeditionUI?.result, null, 60000, 'result after give up');
      J.completion.route = 'give-up after ' + finishSec + 's timeout';
      return { notRun: true, reason: 'no natural result within ' + finishSec + 's; ended via real pause → 포기 (victory NOT_RUN)', ...J.completion, atTimeout: was };
    }
    J.completion.route = s.result.win ? 'natural victory' : 'natural defeat';
    J.completion.result = s.result;
    if (!s.result.win) fail('battle ended in defeat (no fake pass)', J.completion);
    return J.completion;
  }, { needs: [entry], timeoutSec: finishSec + 180 });

  // 9. 결과 화면 · 전리품
  let lootFound = false;
  const result = await step('result screen saved; loot recorded', async () => {
    await waitFor(() => { const el = document.querySelector('.exp-result-shell'), r = el?.getBoundingClientRect(); return !!window.app.expeditionUI?.result && !!r && r.width > 0; }, null, 60000, 'result screen');
    const r = await page.evaluate(() => {
      const x = window.app.expeditionUI.result;
      return { win: !!x.win, saveError: x.saveError || null, kind: x.kind, id: x.id, depth: x.depth, name: x.name, kills: x.kills, combo: x.combo, time: x.time,
        rewards: { loot: (x.rewards?.loot || []).map((i) => ({ uid: i.uid, id: i.id })), heroExp: x.rewards?.heroExp ?? null, stones: x.rewards?.stones ?? null, gold: x.rewards?.gold ?? null, firstClear: !!x.rewards?.firstClear },
        outcome: document.querySelector('.exp-result-shell')?.dataset.outcome || null,
        buttons: [...document.querySelectorAll('.exp-result-footer button, .exp-result-header button')].map((b) => ({ text: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), cls: String(b.className), disabled: !!b.disabled })),
        gearButton: !!document.querySelector('.exp-result-gear') };
    });
    J.result = r;
    await screenshot('08-result', { win: r.win, loot: r.rewards.loot.length, outcome: r.outcome });
    if (r.saveError) fail('result not saved', r);
    lootFound = r.rewards.loot.length > 0;
    if (lootFound) {
      const summary = page.locator('.exp-result-shell details > summary', { hasText: '전리품' }).first();
      if (await summary.count()) {
        const h = await summary.elementHandle();
        try { await tapHandle(h, 'result loot details summary'); } finally { await h.dispose(); }
        await waitFor(() => !!document.querySelector('.exp-loot-reveal'), null, 10000, 'loot reveal');
        J.result.lootImages = await page.evaluate(readImages, '.exp-loot-reveal article img');
        // 결과 카드의 등급 글자·이름·그림을 따로 읽는다(아이템 선택은 등급+이름의 정본 정체성, 그림은 뒤 비교에만 쓴다).
        J.result.lootCards = await page.evaluate(() => [...document.querySelectorAll('.exp-loot-reveal article')].map((a) => {
          const t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' '), img = a.querySelector('img');
          return { rarity: t(a.querySelector('small')), name: t(a.querySelector('b')), src: img?.getAttribute('src') || null, currentSrc: img?.currentSrc || null, data: { ...(img?.dataset || {}) }, complete: !!img?.complete, naturalWidth: img?.naturalWidth || 0 };
        }));
        await screenshot('08b-result-loot', { images: J.result.lootImages.length });
      } else { J.result.lootImages = []; J.result.lootCards = []; }
    }
    return J.result;
  }, { needs: [entry], timeoutSec: 120 });
  await step('natural victory produced loot (end-to-end item identity input)', async () => {
    if (!J.result?.win) return { notRun: true, reason: 'no natural victory' };
    if (!lootFound) return { notRun: true, reason: 'victory without equipment loot in this run' };
    return { loot: J.result.rewards.loot };
  }, { needs: [result], timeoutSec: 10 });

  // 10. 결과 → 장비
  const equipment = await step('result -> equipment screen via real UI (route recorded)', async () => {
    const gear = await probe('.exp-result-gear');
    let route;
    if (gear.exists && gear.visible) {
      await tap('.exp-result-gear', 'result equipment button');
      route = 'result-gear-button';
    } else {
      await tap('.exp-result-header .exp-close', 'result 로비');
      await waitFor(() => window.app?.mode === 'lobby' && !window.app.expeditionUI?.result && window.app.meta?.tab === 'home', null, 30000, 'lobby after result');
      await tap('#meta .bottomnav [data-tab="heroes"]', 'bottom nav heroes');
      route = 'result-lobby-then-heroes-nav (.exp-result-gear not present)';
    }
    await waitFor(() => window.app?.mode === 'lobby' && window.app.meta?.tab === 'heroes' && window.app.eco.s.selected === 'ranger', null, 30000, 'hero equipment screen');
    if (await page.evaluate(() => window.app.meta.heroSel !== 'ranger')) fail('equipment screen opened for a different hero', await diagnose());
    if (!(await probe('#hero-bag')).exists) { await tap('#hs-tab-gear', 'equipment pane tab'); await waitFor(() => !!document.querySelector('#hero-bag'), null, 10000, 'bag'); }
    const ready = await page.waitForFunction(() => { const c = document.querySelector('#hero-wardrobe canvas'), r = c?.getBoundingClientRect(); return !!window.app?.wardrobe?.instance && !!r && r.width > 100 && r.height > 100; }, null, { timeout: Math.min(90000, remainingMs()), polling: 200 }).then(() => true).catch(() => false);
    J.equipment = { route, gearButtonPresent: gear.exists && gear.visible, wardrobeReady: ready, wardrobe: await page.evaluate(readWardrobe), equip: await page.evaluate(() => ({ ...window.app.eco.s.heroes.ranger.equip })) };
    await screenshot('09-equipment', { route, wardrobeReady: ready });
    return J.equipment;
  }, { needs: [result], timeoutSec: 180 });

  // 11. 전리품 시트 · 장착 · 같은 그림/정체성
  const item = await step('loot item opened and equipped via UI; same item identity on bag/sheet/slot', async () => {
    if (!lootFound) return { notRun: true, reason: J.result?.win ? 'no loot' : 'no natural victory loot' };
    const inv = await page.evaluate((loot) => loot.map((l) => { const i = window.app.eco.s.inventory.find((x) => x.uid === l.uid); return i ? { uid: i.uid, id: i.id, enh: i.enh } : null; }).filter(Boolean), J.result.rewards.loot);
    const bagUids = await page.evaluate(() => [...document.querySelectorAll('#hero-bag [data-inv]')].map((el) => el.dataset.inv));
    const pick = inv.filter((it) => bagUids.includes(String(it.uid)));
    if (!pick.length) fail('loot items not shown in the Ranger bag', { inv, bagUids: bagUids.length });
    // 결과 화면에 실제로 보인 전리품(희귀도 상위 6) 중 가방에 있는 아이템을 먼저 고른다(궁수는 무기 우선). 보상 순서·경제·결과 UI는 바꾸지 않는다.
    // 결과에 보인 아이템이 가방에 없으면 첫 가방 전리품으로 가방/시트/칸 검사만 하고 결과 그림 비교는 NOT_RUN으로 남긴다.
    const selection = pickResultLoot({ cards: J.result.lootCards || [], loot: J.result.rewards.loot, bagUids, itemById: ITEM_BY_ID, preferSlot: 'weapon' });
    const it = (selection.pick && pick.find((x) => x.uid === selection.pick.uid)) || pick[0];
    const card = selection.pick && it.uid === selection.pick.uid ? J.result.lootCards[selection.pick.cardIndex] : null;
    J.itemSelection = { via: card ? 'result-visible-card' : 'first-bag-loot (no result-visible loot in the Ranger bag)', pick: selection.pick, cards: selection.cards };
    const cell = '#hero-bag [data-inv="' + it.uid + '"]';
    const bagLabel = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('aria-label') || '', cell);
    const name = bagLabel.split(' +')[0];
    const bagBefore = await page.evaluate(readImages, cell + ' img');
    await tap(cell, 'bag loot item');
    await waitFor(() => !!document.querySelector('#modal.show .is-head'), null, 15000, 'item sheet');
    const sheet = await page.evaluate(() => {
      const m = document.querySelector('#modal.show'), t = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
      return { title: t(m.querySelector('.is-head h2')), tags: t(m.querySelector('.is-tags')), primary: t(m.querySelector('#i-eq')), has3d: !!m.querySelector('#i-3d'),
        formNotes: [...m.querySelectorAll('p, small, figcaption, .is-note, .is-preview-caption')].map(t).filter((x) => /형태|리그|외형|들면|활|궁수/.test(x)).slice(0, 6) };
    });
    sheet.images = await page.evaluate(readImages, '#modal.show .is-head-art img');
    await screenshot('10-item-sheet', { uid: it.uid, id: it.id, title: sheet.title });
    let equipped = false;
    if (sheet.primary === '장착하기') {
      await tap('#modal.show #i-eq', 'equip loot (장착하기)');
      await waitFor((uid) => Object.values(window.app.eco.s.heroes.ranger.equip).includes(uid), it.uid, 15000, 'loot equipped on ranger');
      equipped = true;
    }
    if ((await probe('#modal.show #i-close')).visible) await tap('#modal.show #i-close', 'item sheet 닫기');
    await waitFor(() => !document.querySelector('#modal.show'), null, 10000, 'item sheet closed');
    const slot = await page.evaluate(readImages, '.hs-slot[data-uid="' + it.uid + '"] img');
    const bagAfter = await page.evaluate(readImages, cell + ' img');
    const resultImg = card;
    await page.waitForFunction(() => { const c = document.querySelector('#hero-wardrobe canvas'), r = c?.getBoundingClientRect(); return !!window.app?.wardrobe?.instance && !!r && r.width > 100; }, null, { timeout: Math.min(60000, remainingMs()), polling: 200 }).catch(() => {});
    J.item = { uid: it.uid, itemId: it.id, name, bagLabel, sheet, equipped, primaryAction: sheet.primary, bag: bagBefore[0] || null, bagAfter: bagAfter[0] || null, slot: slot[0] || null, result: resultImg, selection: J.itemSelection,
      rangerEquip: await page.evaluate(() => ({ ...window.app.eco.s.heroes.ranger.equip })), wardrobe: await page.evaluate(readWardrobe) };
    await screenshot('10b-equipped', { uid: it.uid, equipped });
    if (!equipped) fail('loot not equipped (primary action was "' + sheet.primary + '")', J.item);
    if (!sheet.title.includes(name)) fail('item sheet title does not match the bag item', J.item);
    if (card && (card.name !== name || ITEM_BY_ID[it.id]?.name !== name)) fail('result card, bag item and catalog name differ for the selected item', J.item);
    const srcs = [J.item.bag?.src, sheet.images[0]?.src, J.item.slot?.src];
    if (srcs.some((s) => !s) || new Set(srcs).size !== 1) fail('bag / sheet / equipped slot thumbnails differ for the same item', { srcs, item: J.item });
    return J.item;
  }, { needs: [equipment], timeoutSec: 180 });
  await step('result loot thumbnail matches equipment thumbnail for the same item', async () => {
    if (!J.item?.slot) return { notRun: true, reason: 'no equipped loot item' };
    if (!J.item.result) return { notRun: true, reason: 'no result-visible loot item (reveal top 6) found in the Ranger bag, or reveal not opened', selection: J.itemSelection };
    const a = J.item.result.src, b = J.item.slot.src;
    if (a !== b) fail('result loot image and equipment image differ', { result: J.item.result, slot: J.item.slot });
    return { uid: J.item.uid, itemId: J.item.itemId, card: { rarity: J.item.result.rarity, name: J.item.result.name }, via: J.itemSelection?.via, src: a, resultData: J.item.result.data, slotData: J.item.slot.data };
  }, { needs: [item], timeoutSec: 10 });

  // 12. 같은 던전 준비 → 재입장 1회 차감
  await step('same dungeon preparation -> re-entry spends energy once', async () => {
    if (!J.preparation?.again?.title) return { notRun: true, reason: 'first preparation not recorded' };
    let via;
    const heroSortie = await probe('#h-next');
    if (await page.evaluate(() => window.app?.meta?.tab === 'heroes') && heroSortie.visible) { await tap('#h-next', 'hero header 출격 준비'); via = 'hero-header #h-next'; }
    else {
      if (await page.evaluate(() => !!window.app.expeditionUI?.result)) { await tap('.exp-result-header .exp-close', 'result 로비'); await waitFor(() => window.app.mode === 'lobby' && !window.app.expeditionUI?.result, null, 30000, 'lobby'); }
      if (await page.evaluate(() => window.app.meta?.tab !== 'home')) await tap('#meta .bottomnav [data-tab="home"]', 'bottom nav home');
      await tap('#citadel-dungeon-prepare', 'home CTA 출격 준비'); via = 'home CTA';
    }
    const p2 = await waitPreparation();
    await screenshot('11-reentry-preparation', p2);
    if (p2.title !== J.preparation.again.title) fail('re-entry preparation is a different dungeon', { first: J.preparation.again.title, now: p2.title });
    const r = await sortieFromPreparation('reentry');
    J.reentry = { via, ...r };
    await screenshot('12-reentry-battle', await battleNote());
    if (r.battle.hero !== 'ranger') fail('re-entry hero is not ranger', J.reentry);
    if (!r.energy.ok) fail('re-entry energy charge differs from catalog cost', r.energy);
    return J.reentry;
  }, { needs: [result], timeoutSec: 300 });

  await step('no page errors during the journey', async () => {
    if (report.errors.length) fail('page errors', report.errors.slice(0, 10));
    return { consoleErrors: report.consoleErrors.length };
  }, { timeoutSec: 10 });
  await exitWith();
} catch (error) {
  await exitWith(null, error);
} finally {
  clearTimeout(hardStop);
  if (!finalized) await exitWith();
}
