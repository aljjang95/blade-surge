// 사이클 20261020-s26-device-acceptance 실기기 QA(A1~A5). 실제 안드로이드 Chrome에서 정식 호스트를 돌린다.
// 사용: node tools/gogo-qa-20261020-s26.mjs --serial <adb 시리얼> --out <폴더> [--steps a1,a2,a3,a4,a5] [--minutes 11] [--port 9341]
//       [--origin https://blade.tllhouse.com/] [--holder gogo:20261020-s26-device-acceptance]
// 입력: 게임 입력은 모두 adb shell input(tap·swipe, OS 터치 주입)이다. CDP(Chrome 원격 디버깅)는 상태 읽기·좌표 계산·상태 준비 주입에만 쓰고
//       주입은 보고서 injected 로 따로 적는다.
// 기기 보호: 입력·캡처 전마다 전경 창이 Chrome인지 확인하고 아니면 즉시 멈춘다(exit 4, 주인이 폰을 쓰는 중).
//       시작 때 이 사이트 localStorage(게임 저장)를 백업하고 끝나면 그대로 복원한다. 화면 꺼짐 시간만 바꾸며 원래 값으로 되돌린다.
//       볼륨·밝기·앱 전환은 하지 않는다. 연 탭만 닫고 자기 adb forward 만 지운다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const serial = arg('serial'); if (!serial) { console.error('--serial 필요'); process.exit(2); }
const out = path.resolve(arg('out', 'work/qa/s26'));
const steps = arg('steps', 'a1,a2,a3,a4,a5').split(',').map((s) => s.trim().toLowerCase());
const minutes = +arg('minutes', '11');
const port = +arg('port', '9341');
const origin = arg('origin', 'https://blade.tllhouse.com/');
const holder = arg('holder', 'gogo:20261020-s26-device-acceptance');
const FORWARD_PS = 'C:/Users/heart/.codex/tools/tab-connect/adb-forward.ps1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 2) => (Number.isFinite(n) ? +n.toFixed(d) : n);
await fs.mkdir(out, { recursive: true });

class OwnerBusy extends Error {}
const report = { serial, origin, started: new Date().toISOString(), device: {}, settings: {}, steps: {}, focusChecks: 0, errors: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

// ---------- adb ----------
function adb(args, { binary = false, timeout = 30000 } = {}) {
  return execFileSync('adb', ['-s', serial, ...args], { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 << 20, timeout, windowsHide: true });
}
const sh = (cmd, o) => adb(['shell', cmd], o);
function focus() { const m = sh('dumpsys window | grep mCurrentFocus').match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/); return m ? m[1].trim() : 'unknown'; }
function guard(label) {
  const f = focus(); report.focusChecks++;
  if (!/^com\.android\.chrome\//.test(f)) throw new OwnerBusy('전경 창이 Chrome 이 아님(' + f + ') · ' + label);
}

// ---------- CDP ----------
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.wait = new Map(); this.listeners = []; }
  open() { return new Promise((res, rej) => { this.ws = new WebSocket(this.url); this.ws.onopen = () => res(); this.ws.onerror = (e) => rej(new Error('CDP 연결 실패')); this.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.wait.has(d.id)) { const w = this.wait.get(d.id); this.wait.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); } else if (d.method) for (const l of this.listeners) l(d); }; }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => { this.wait.set(id, { res, rej }); setTimeout(() => { if (this.wait.has(id)) { this.wait.delete(id); rej(new Error('CDP 시간 초과 ' + method)); } }, 60000); }); }
  async ev(fn, a) {
    const expr = '(' + fn.toString() + ')(' + JSON.stringify(a === undefined ? null : a) + ')';
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
const http = async (p, method = 'GET') => { const r = await fetch('http://127.0.0.1:' + port + p, { method }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// 새 문서마다: 포인터 기록(좌표 보정·명중 확인), Web Audio 재생 호출 수, rAF 수.
const HOOK = String.raw`(() => { if (window.__qa) return; const Q = window.__qa = { ptr: [], lastTarget: null, audio: { buf: 0, osc: 0, states: {}, last: 0 }, raf: 0 };
  addEventListener('pointerdown', (e) => { Q.lastTarget = e.target; Q.ptr.push({ x: e.clientX, y: e.clientY, type: e.pointerType, t: performance.now() }); if (Q.ptr.length > 100) Q.ptr.shift(); }, true);
  const wrap = (C, key) => { if (!C) return; const s = C.prototype.start; C.prototype.start = function (...a) { Q.audio[key]++; Q.audio.last = performance.now(); try { const st = this.context.state; Q.audio.states[st] = (Q.audio.states[st] || 0) + 1; } catch {} return s.apply(this, a); }; };
  wrap(window.AudioBufferSourceNode, 'buf'); wrap(window.OscillatorNode, 'osc');
  const tick = () => { Q.raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
})();`;

let cdp = null, targetId = null, map = null;
const ev = (fn, a) => cdp.ev(fn, a);

// ---------- 좌표·터치 ----------
// CSS 좌표 → 기기 좌표: x = cssX*scale + ox. 매 탭의 pointerdown 기록으로 오프셋을 다시 맞춘다(전체화면 전환 등).
async function initMap() {
  const v = await ev(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, fs: !!document.fullscreenElement, ow: outerWidth, oh: outerHeight, orient: screen.orientation?.type || '' }));
  const wm = sh('wm size'), size = wm.match(/Physical size: (\d+)x(\d+)/), ov = wm.match(/Override size: (\d+)x(\d+)/);
  let W = +(ov || size)[1], H = +(ov || size)[2]; const rot = /landscape/.test(v.orient) ? 1 : 0;
  if ((rot === 1) !== (W > H)) [W, H] = [H, W];
  const scale = v.dpr;
  map = { scale, ox: Math.max(0, (W - v.w * scale) / 2) * 0, oy: Math.max(0, H - v.h * scale), W, H, rot, view: v };
  return map;
}
const toDev = (x, y) => [Math.round(x * map.scale + map.ox), Math.round(y * map.scale + map.oy)];
async function ptrCount() { return ev(() => window.__qa.ptr.length); }
async function tapAt(x, y, label) {
  guard(label);
  const n0 = await ptrCount(); const [X, Y] = toDev(x, y);
  sh('input tap ' + X + ' ' + Y);
  await sleep(160);
  const p = await ev((n0) => window.__qa.ptr.slice(n0), n0);
  const got = p[0] || null;
  if (got) { const dx = got.x - x, dy = got.y - y; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { map.ox -= dx * map.scale; map.oy -= dy * map.scale; } }
  return { X, Y, got };
}
// 요소를 화면에 보이게 하고 가운데를 탭한다. 다른 요소가 덮고 있으면 실패로 남긴다.
async function tapSel(sel, { text = null, index = 0, label = sel, retry = true } = {}) {
  const info = await ev(({ sel, text, index }) => {
    const all = [...document.querySelectorAll(sel)].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; });
    const list = text ? all.filter((n) => new RegExp(text).test(n.textContent.trim())) : all;
    const el = list[index]; if (!el) return null;
    let r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { el.scrollIntoView({ block: 'center', inline: 'center' }); r = el.getBoundingClientRect(); }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy);
    window.__qaEl = el;
    return { cx, cy, w: r.width, h: r.height, covered: !(top && (top === el || el.contains(top))), coverBy: top ? (top.id || top.className || top.tagName) + '' : null };
  }, { sel, text, index });
  if (!info) throw new Error('요소 없음: ' + label);
  const t = await tapAt(info.cx, info.cy, label);
  let hit = await ev(() => !!(window.__qa.lastTarget && window.__qaEl && (window.__qaEl === window.__qa.lastTarget || window.__qaEl.contains(window.__qa.lastTarget))));
  if (!hit && retry) { await sleep(300); return tapSel(sel, { text, index, label, retry: false }); }
  return { label, ...info, ...t, hit };
}
async function visible(sel, text = null) {
  return ev(({ sel, text }) => [...document.querySelectorAll(sel)].some((n) => { const r = n.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; return !text || new RegExp(text).test(n.textContent.trim()); }), { sel, text });
}
async function waitFor(fn, a, timeout = 60000, every = 400) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { const v = await ev(fn, a); if (v) return v; } catch {} await sleep(every); } return null; }
async function swipe(x1, y1, x2, y2, ms, label) { guard(label); const [A, B] = toDev(x1, y1), [C, D] = toDev(x2, y2); sh('input swipe ' + A + ' ' + B + ' ' + C + ' ' + D + ' ' + ms, { timeout: ms + 20000 }); return { from: [A, B], to: [C, D], ms }; }
async function shot(rec, name) {
  guard('캡처 ' + name);
  const buf = adb(['exec-out', 'screencap', '-p'], { binary: true, timeout: 60000 });
  guard('캡처 후 ' + name);
  const file = rec.id + '-' + name + '.png'; await fs.writeFile(path.join(out, file), buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  rec.captures.push({ file, sha256, at: new Date().toISOString() }); return file;
}

// ---------- 기록 ----------
function newRec(id, title) {
  const rec = { id, title, pass: false, checks: [], injected: [], real: [], observed: {}, captures: [], taps: [], started: new Date().toISOString() };
  rec.check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };
  rec.inject = (t) => rec.injected.push(t);
  rec.did = (t) => rec.real.push(t);
  rec.obs = (k, v) => { rec.observed[k] = v; };
  rec.tap = async (sel, o = {}) => { let t; try { t = await tapSel(sel, o); } catch (e) { if (!/요소 없음/.test(String(e))) throw e; await sleep(1500); t = await tapSel(sel, o); } rec.taps.push({ label: t.label, X: t.X, Y: t.Y, hit: t.hit, covered: t.covered }); rec.did('실제 터치(adb input tap): ' + t.label + (t.hit ? '' : ' [명중 확인 실패]')); return t; };
  report.steps[id] = rec; return rec;
}

// ---------- 게임 흐름 ----------
async function closeModals(rec) {
  for (let n = 0; n < 6; n++) {
    if (await visible('#modal.show #m-cancel')) { await rec.tap('#modal.show #m-cancel', { label: '모달 닫기(#m-cancel)' }); await sleep(350); continue; }
    if (await visible('#modal.show button', '^닫기$')) { await rec.tap('#modal.show button', { text: '^닫기$', label: '모달 닫기' }); await sleep(350); continue; }
    break;
  }
}
async function boot(rec) {
  await cdp.send('Page.navigate', { url: origin }); await sleep(1500);
  await waitFor(() => document.readyState !== 'loading' && !!document.querySelector('#boot-start'), null, 120000);
  await initMap(); rec.obs('viewportAtBoot', map.view);
  if (await visible('#btn-ignore-rotate')) { await rec.tap('#btn-ignore-rotate', { label: '세로 화면 안내 무시' }); await sleep(500); }
  await waitFor(() => { const b = document.querySelector('#boot-start'); return b && !b.classList.contains('hidden') && b.getBoundingClientRect().width > 0; }, null, 180000);
  await rec.tap('#boot-start', { label: '시작(#boot-start)' });
  const ok = await waitFor(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, 120000);
  await sleep(1500);
  await initMap();
  rec.obs('viewportAfterStart', { ...map.view, scale: map.scale, oy: map.oy });
  await closeModals(rec);
  return !!ok;
}
async function prepare(rec, p) {
  const info = await ev((p) => {
    const e = window.app.eco;
    e.s.tutorial = { completed: true };
    if (!e.ownHero(p.hero)) e.grantHero(p.hero);
    e.s.selected = p.hero; const h = e.hero(p.hero);
    if (p.level) { h.level = p.level; h.exp = 0; }
    if (p.grade) h.grade = p.grade;
    if (p.energy) e.s.energy = Math.max(e.s.energy, p.energy);
    if (p.gold) e.s.gold = Math.max(e.s.gold, p.gold);
    if (p.gems) e.s.gems = Math.max(e.s.gems, p.gems);
    e.save(); e.emit?.();
    return { selected: e.s.selected, level: h.level, grade: h.grade, energy: e.s.energy, gold: e.s.gold, gems: e.s.gems, autoTarget: e.s.settings?.autoTarget };
  }, p);
  rec.inject('저장 상태 준비(CDP): ' + JSON.stringify(p));
  await sleep(300); return info;
}
async function enterBattle(rec) {
  await closeModals(rec);
  if (!await visible('#citadel-dungeon-prepare')) { await rec.tap('.bottomnav button[data-tab="home"]', { label: '하단 던전 탭' }).catch(() => {}); await sleep(800); }
  await rec.tap('#citadel-dungeon-prepare', { label: '출격 준비' }); await sleep(1000);
  await rec.tap('button', { text: '원정 시작', label: '원정 시작' }); await sleep(900);
  for (let i = 0; i < 6; i++) { if (await visible('button', '건너뛰기')) { await rec.tap('button', { text: '건너뛰기', label: '건너뛰기' }).catch(() => {}); await sleep(600); } if (await ev(() => window.app.mode === 'battle' && !!window.app.battle?.active)) break; await sleep(700); }
  const ok = await waitFor(() => window.app.mode === 'battle' && window.app.battle?.active && window.app.battle.elapsed > 0.8, null, 90000);
  await sleep(800); await initMap(); return !!ok;
}
const battleSnap = () => ev(() => { const b = window.app.battle, P = b?.player; if (!b?.active || !P) return null; const live = b.enemies.filter((e) => e.alive && !e.spawning); const d = (e) => Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z); const near = live.slice().sort((a, c) => d(a) - d(c))[0]; return { auto: !!P.auto, hp: Math.round(P.hp), maxHp: Math.round(P.maxHp), alive: P.alive, state: P.state, pos: { x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2) }, yaw: P.yaw, ult: P.ult, live: live.length, near: near ? { i: b.enemies.indexOf(near), hp: near.hp, d: +d(near).toFixed(2), yawTo: Math.atan2(near.pos.x - P.pos.x, near.pos.z - P.pos.z) } : null, hpSum: Math.round(live.reduce((a, e) => a + e.hp, 0)), elapsed: +b.elapsed.toFixed(2) }; });
async function setAuto(rec, on) { const s = await battleSnap(); if (s && s.auto !== on) { await rec.tap('#btn-auto', { label: 'AUTO ' + (on ? '켜기' : '끄기') }); await sleep(400); } return (await battleSnap())?.auto; }
async function approachEnemy(rec, maxD = 6, timeout = 60000) {
  await setAuto(rec, true); const t0 = Date.now(); let s = null;
  while (Date.now() - t0 < timeout) { s = await battleSnap(); if (s?.near && s.near.d <= maxD) break; await handleChoice(rec); await sleep(300); }
  await setAuto(rec, false); return battleSnap();
}
// 각인·만남 선택 모달은 게임을 멈춘다. 첫 선택지를 실제 탭으로 고른다.
async function handleChoice(rec) {
  if (await visible('.mw-boon, .mw-story-choice')) { await rec.tap('.mw-boon, .mw-story-choice', { label: '각인·만남 선택지' }).catch(() => {}); await sleep(700); return true; }
  return false;
}
const resultShown = async () => (await visible('#btn-result-lobby')) || (await visible('.exp-result-gear'));
const playArea = () => ev(() => {
  // 플레이 보호 영역: 가로 가운데 1/3, 위 HUD 줄 아래부터 조작부 위까지. 그 안에 겹치는 DOM 요소(캔버스·월드 제외)를 찾는다.
  const W = innerWidth, H = innerHeight, R = (n) => n.getBoundingClientRect();
  const hudTop = [...document.querySelectorAll('.hud-top')].filter((n) => n.offsetParent).reduce((m, n) => Math.max(m, R(n).bottom), 0);
  const ctrlTop = [...document.querySelectorAll('.actions > *, .joy-base')].filter((n) => n.offsetParent).reduce((m, n) => Math.min(m, R(n).top), H);
  const zone = { left: W / 3, right: W * 2 / 3, top: Math.max(hudTop, H * 0.12), bottom: Math.min(ctrlTop, H * 0.85) };
  const hits = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!n.offsetParent && getComputedStyle(n).position !== 'fixed') continue;
    if (n.closest('canvas, #three, .hud-top, .actions, #joy, #minimap-wrap, #btn-map, #skill-aim-cancel')) continue;
    const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05 || cs.pointerEvents === 'none' && !n.textContent.trim()) continue;
    const r = R(n); if (r.width < 4 || r.height < 4) continue;
    const ow = Math.min(r.right, zone.right) - Math.max(r.left, zone.left), oh = Math.min(r.bottom, zone.bottom) - Math.max(r.top, zone.top);
    if (ow <= 0 || oh <= 0) continue;
    const bg = cs.backgroundColor, hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg), txt = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!hasBg && !txt && cs.backgroundImage === 'none' && n.tagName !== 'IMG') continue;
    hits.push({ el: (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 40), text: n.textContent.trim().slice(0, 30), area: Math.round(ow * oh) });
  }
  return { zone, hits: hits.slice(0, 10) };
});

// 화면 배치 검사: 보이는 버튼이 화면 밖으로 잘리지 않고(스크롤 영역 안이면 스크롤 가능해야 함) 가운데가 다른 요소에 덮이지 않는다.
const layoutCheck = (root) => ev((root) => {
  const W = innerWidth, H = innerHeight, rootEl = document.querySelector(root) || document.body;
  const scrollParent = (n) => { for (let p = n.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p; } return null; };
  const items = [...rootEl.querySelectorAll('button, [role=button], .shop-item, a.btn')].filter((n) => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; });
  const clipped = [], covered = [], truncated = []; let checked = 0;
  for (const n of items) {
    const r = n.getBoundingClientRect(), sp = scrollParent(n);
    const name = ((n.id ? '#' + n.id : '') + '.' + String(n.className).split(' ')[0] + ' ' + n.textContent.trim().replace(/\s+/g, ' ').slice(0, 24));
    let vis = { left: 0, top: 0, right: W, bottom: H };
    if (sp) { const s = sp.getBoundingClientRect(); vis = { left: Math.max(0, s.left), top: Math.max(0, s.top), right: Math.min(W, s.right), bottom: Math.min(H, s.bottom) }; }
    const fully = r.left >= vis.left - 1 && r.right <= vis.right + 1 && r.top >= vis.top - 1 && r.bottom <= vis.bottom + 1;
    if (!sp && !fully && (r.right > 0 && r.left < W && r.bottom > 0 && r.top < H)) clipped.push({ name, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    if (!sp && (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H)) clipped.push({ name, offscreen: true, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    if (!fully) continue;
    checked++;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy);
    if (!top || !(top === n || n.contains(top) || top.contains(n))) covered.push({ name, by: top ? ((top.id ? '#' + top.id : '') + '.' + String(top.className).split(' ')[0] + ' ' + top.textContent.trim().slice(0, 20)) : null });
    const label = n.querySelector('span, b, strong') || n; if (label.scrollWidth > label.clientWidth + 2 && getComputedStyle(label).textOverflow !== 'ellipsis') truncated.push(name);
  }
  return { viewport: [W, H], items: items.length, checked, clipped: clipped.slice(0, 8), covered: covered.slice(0, 8), truncated: truncated.slice(0, 8) };
}, root);

// ---------- 단계 ----------
async function stepA1() {
  const rec = newRec('A1', '로비 → 출격 준비 → 원정 시작 → 전투, 자동 조준 평타 피해, 조이스틱 이동');
  rec.check('부팅 후 로비', await boot(rec));
  const st = await prepare(rec, { hero: 'knight', energy: 200 }); rec.obs('state', st);
  rec.check('설정 자동 타겟 켜짐(기본값)', st.autoTarget !== false, st.autoTarget);
  await shot(rec, 'lobby');
  rec.check('실제 터치로 전투 진입(mode=battle)', await enterBattle(rec));
  await shot(rec, 'battle-start');
  const s0 = await approachEnemy(rec, 6); rec.obs('afterApproach', s0);
  rec.check('적이 6m 안에 있고 AUTO 꺼짐(평타 시험 준비)', !!s0?.near && s0.near.d <= 6.5 && !s0.auto, s0);
  // rAF 표본: 대상 적 체력·플레이어 상태·방향
  await ev((ti) => { const S = window.__a1 = { rows: [], run: true }; const tick = () => { if (!S.run) return; const b = window.app.battle, P = b.player, e = b.enemies[ti]; S.rows.push({ t: performance.now(), st: P.state, yaw: P.yaw, ehp: e ? e.hp : null, ealive: e ? e.alive : null, yawTo: e ? Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z) : null }); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, s0.near.i);
  rec.inject('계측 훅: 대상 적 체력·플레이어 상태 rAF 표본(읽기 전용)');
  const hp0 = s0.near.hp, sum0 = s0.hpSum;
  for (let i = 0; i < 3; i++) { await rec.tap('#btn-attack', { label: '공격 버튼' }); await sleep(450); }
  await sleep(900);
  const rows = await ev(() => { window.__a1.run = false; return window.__a1.rows; });
  const s1 = await battleSnap();
  const atk = rows.filter((r) => r.st === 'attack');
  const dropped = rows.some((r) => r.ehp !== null && (r.ehp < hp0 || r.ealive === false));
  const ang = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const faced = atk.length ? Math.min(...atk.map((r) => ang(r.yaw, r.yawTo) * 180 / Math.PI)) : null;
  rec.obs('attack', { hpBefore: round(hp0, 1), hpAfter: rows.length ? round(rows[rows.length - 1].ehp, 1) : null, hpSumBefore: sum0, hpSumAfter: s1?.hpSum, attackFrames: atk.length, minAngleToTargetDeg: round(faced, 1) });
  rec.check('공격 버튼 탭 → 공격 동작', atk.length > 0, atk.length);
  rec.check('가장 가까운 적 체력 감소(평타 피해)', dropped, { hp0, last: rows[rows.length - 1]?.ehp });
  rec.check('공격 중 대상 적 쪽을 바라봄(자동 조준, 25° 이내)', faced !== null && faced <= 25, faced);
  await shot(rec, 'after-attack');
  // 조이스틱: 왼쪽 조이스틱 중심에서 오른쪽으로 1.5초 드래그
  const j = await ev(() => { const r = document.querySelector('.joy-base').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
  const p0 = (await battleSnap()).pos;
  const sw = await swipe(j.x, j.y, j.x + j.w * 0.45, j.y - j.w * 0.1, 1500, '조이스틱 드래그'); rec.did('실제 드래그(adb input swipe 1.5초): 조이스틱 ' + JSON.stringify(sw));
  await sleep(300);
  const p1 = (await battleSnap()).pos, moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  rec.obs('joystick', { from: p0, to: p1, movedM: round(moved, 2) });
  rec.check('조이스틱 드래그로 영웅이 0.8m 이상 이동', moved >= 0.8, round(moved, 2));
  rec.check('모든 탭이 의도한 요소에 명중', rec.taps.every((t) => t.hit), rec.taps.filter((t) => !t.hit));
  rec.pass = rec.checks.every((c) => c.ok); await save(); return rec;
}

// AUTO 로 결과 화면까지(각인·만남 선택은 실제 탭). 원정 결과(.exp-result-gear)와 캠페인 결과(#btn-result-lobby) 둘 다 감지한다.
async function autoToResult(rec, tag, limitMs = 420000) {
  await ev(() => { const st = window.__a2 = { deaths: 0, wasAlive: true, hpMin: 1 }; clearInterval(window.__a2t); window.__a2t = setInterval(() => { const P = window.app.battle?.player; if (!P) return; if (!P.alive && st.wasAlive) st.deaths++; st.wasAlive = P.alive; st.hpMin = Math.min(st.hpMin, P.hp / P.maxHp); }, 50); });
  rec.inject('계측 훅: 사망 수·최저 체력 50ms 표본(읽기 전용)');
  await setAuto(rec, true);
  const t0 = Date.now(); let choices = 0, midShot = false;
  while (Date.now() - t0 < limitMs) {
    await sleep(1000);
    if (await resultShown()) break;
    if (await handleChoice(rec)) { choices++; continue; }
    if (!midShot && Date.now() - t0 > 12000) { midShot = true; await shot(rec, tag + '-auto-mid'); }
  }
  await sleep(1500);
  const fin = await ev(() => { clearInterval(window.__a2t); const b = window.app.battle; return { win: b?.result ? !!b.result.win : null, a2: window.__a2, kills: b?.kills ?? null, stage: b?.stage?.code || b?.stage?.name || null, kind: document.querySelector('#btn-result-lobby')?.offsetParent ? 'campaign' : 'expedition' }; });
  fin.wallSec = round((Date.now() - t0) / 1000, 1); fin.choicesTapped = choices;
  rec.obs('auto-' + tag, fin); await shot(rec, tag + '-result');
  rec.check(tag + ': AUTO 로 승리 결과 화면', fin.win === true && await resultShown(), fin);
  rec.check(tag + ': 사망 0', fin.a2.deaths === 0, fin.a2);
  return fin;
}
const invSnap = () => ev(() => { const e = window.app.eco, id = e.s.selected, h = e.hero(id); return { gold: e.s.gold, power: e.heroPower(id), equip: { ...h.equip }, inv: e.s.inventory.map((x) => ({ uid: x.uid, id: x.id, enh: x.enh })) }; });
// 가방에서 uid 칸을 찾는다. 슬롯 필터(meta.bagSlot)를 바꿔야 보이면 UI 상태로 바꾸고 기록한다.
async function showBagCell(rec, uid) {
  for (const slot of [null, 'weapon', 'armor', 'ring', 'boots']) {
    if (slot) { await ev((slot) => { window.app.meta.bagSlot = slot; window.app.meta.renderHeroes(); }, slot); await sleep(400); }
    if (await ev((uid) => !!document.querySelector('#hero-bag [data-inv="' + uid + '"]'), uid)) { if (slot) rec.inject('가방 슬롯 필터 ' + slot + '(meta.bagSlot, UI 상태)'); return true; }
  }
  return false;
}
async function stepA2() {
  const rec = newRec('A2', 'AUTO 무사망 클리어(원정·캠페인), 전리품 → 장착·판매·강화');
  if (!await ev(() => window.app?.mode === 'battle' && window.app.battle?.active)) { await boot(rec); await prepare(rec, { hero: 'knight', energy: 200 }); rec.check('전투 진입', await enterBattle(rec)); }
  const before = new Set((await invSnap()).inv.map((x) => x.uid));
  // (1) 로비 원정: AUTO 클리어 → 전리품 보기 → 장비 정비 → 가방에서 장착·판매·강화
  const f1 = await autoToResult(rec, 'expedition');
  if (f1.kind === 'expedition') {
    if (await visible('summary', '전리품 보기')) { await rec.tap('summary', { text: '전리품 보기', label: '획득 장비 · 전리품 보기 펼치기' }); await sleep(900); }
    const arts = await ev(() => [...document.querySelectorAll('.exp-loot-reveal article')].map((a) => a.textContent.trim().slice(0, 30)));
    rec.obs('expeditionLoot', arts); await shot(rec, 'expedition-loot');
    rec.check('원정 결과에 전리품 카드가 보임', arts.length > 0, arts.length);
    const lay = await layoutCheck('.exp-result-scroll'); rec.obs('expeditionResultLayout', lay);
    rec.check('원정 결과: 버튼 잘림·덮임 없음', lay.clipped.length === 0 && lay.covered.length === 0, lay);
    await rec.tap('.exp-result-gear', { label: '장비 정비' }); await sleep(1500);
  } else { await rec.tap('#btn-result-lobby', { label: '결과 → 로비' }); await sleep(1500); await rec.tap('.bottomnav button[data-tab="heroes"]', { label: '하단 영웅 탭' }); await sleep(900); }
  rec.check('장비 정비 → 영웅 가방 화면', await visible('#hero-bag'));
  const s1 = await invSnap(); const fresh = s1.inv.filter((x) => !before.has(x.uid));
  rec.obs('newItems', fresh.length);
  rec.check('이번 전투로 새 장비를 얻음', fresh.length > 0, fresh.length);
  // 장착: 새 장비 중 착용 대비 전투력이 오르는 것(없으면 첫 번째)
  const pickUid = await ev((uids) => { const e = window.app.eco, id = e.s.selected; let best = null, bd = -1e9; for (const u of uids) { const p = e.previewItem?.(id, u); if (!p || p.remove) continue; const d = p.after.power - p.before.power; if (d > bd) { bd = d; best = u; } } return best ?? uids[0]; }, fresh.map((x) => x.uid));
  if (pickUid != null && await showBagCell(rec, pickUid)) {
    const pre = await invSnap();
    await rec.tap('#hero-bag [data-inv="' + pickUid + '"]', { label: '가방 새 장비 칸(장착 대상)' }); await sleep(900);
    const sheet = await ev(() => ({ eq: !!document.querySelector('#modal.show #i-eq'), sell: !!document.querySelector('#modal.show #i-sell'), enh: !!document.querySelector('#modal.show #e-go') }));
    rec.obs('bagSheet', sheet); await shot(rec, 'bag-item-sheet');
    rec.check('장비 시트에 장착·판매·강화 버튼', sheet.eq && sheet.sell && sheet.enh, sheet);
    const lay = await layoutCheck('#modal.show'); rec.obs('sheetLayout', lay);
    rec.check('장비 시트 버튼 잘림·덮임 없음', lay.clipped.length === 0 && lay.covered.length === 0, lay);
    await rec.tap('#modal.show #i-eq', { label: '장착하기' }); await sleep(900);
    const post = await invSnap();
    rec.obs('equip', { pickUid, power: [pre.power, post.power] });
    rec.check('장착: 새 장비가 슬롯에 들어감', Object.values(post.equip).includes(pickUid), { pickUid, equip: post.equip });
    await closeModals(rec);
  } else rec.check('장착할 새 장비 칸을 가방에서 찾음', false, pickUid);
  // 판매: 이번에 얻은 장비 중 착용하지 않은 것
  const worn = new Set(Object.values((await invSnap()).equip));
  const sellUid = fresh.map((x) => x.uid).find((u) => !worn.has(u));
  if (sellUid != null && await showBagCell(rec, sellUid)) {
    const g0 = (await invSnap()).gold;
    await rec.tap('#hero-bag [data-inv="' + sellUid + '"]', { label: '가방 장비 칸(판매 대상)' }); await sleep(900);
    await rec.tap('#modal.show #i-sell', { label: '판매' }); await sleep(600);
    if (await visible('#modal.show #m-ok')) { await rec.tap('#modal.show #m-ok', { label: '판매 확인' }); await sleep(900); }
    const g1 = await invSnap();
    rec.obs('sell', { uid: sellUid, gold: [g0, g1.gold] });
    rec.check('판매: 골드 증가·장비 제거', g1.gold > g0 && !g1.inv.some((x) => x.uid === sellUid), { g0, g1: g1.gold });
    await closeModals(rec);
  } else rec.check('판매할 새 장비 칸을 가방에서 찾음', false, sellUid);
  // 강화: 방금 장착한 장비
  if (pickUid != null && await showBagCell(rec, pickUid)) {
    const s0 = await invSnap(); const e0 = s0.inv.find((x) => x.uid === pickUid)?.enh; let e1 = e0, tries = 0, gEnd = s0.gold;
    while (tries < 4 && e1 <= e0) {
      tries++;
      if (!await visible('#modal.show #e-go')) { await closeModals(rec); await rec.tap('#hero-bag [data-inv="' + pickUid + '"]', { label: '가방 착용 장비 칸(강화 대상)' }); await sleep(900); }
      await rec.tap('#modal.show #e-go', { label: '강화하기' }); await sleep(2800);
      const c = await invSnap(); e1 = c.inv.find((x) => x.uid === pickUid)?.enh ?? -1; gEnd = c.gold;
    }
    await shot(rec, 'enhanced');
    rec.obs('enhance', { uid: pickUid, enh: [e0, e1], tries, gold: [s0.gold, gEnd] });
    rec.check('강화: 단계 상승·골드 감소', e1 > e0 && gEnd < s0.gold, { e0, e1, tries });
    await closeModals(rec);
  }
  // (2) 캠페인 1-1: AUTO 클리어 → 결과 전리품 카드 탭 → 장비 시트 → 장착
  await rec.tap('.bottomnav .oath-nav-menu', { label: '하단 메뉴' }); await sleep(600);
  await rec.tap('#oath-menu button[data-tab="stage"]', { label: '메뉴 → 모험' }); await sleep(1000);
  await rec.tap('#stage-grid [data-stage="1-1"]', { label: '캠페인 1-1 칸' }); await sleep(600);
  await rec.tap('#st-go', { label: '캠페인 출발(#st-go)' }); await sleep(1500);
  for (let i = 0; i < 8; i++) { if (await visible('button', '건너뛰기')) await rec.tap('button', { text: '건너뛰기', label: '건너뛰기' }).catch(() => {}); if (await ev(() => window.app.mode === 'battle' && window.app.battle?.active && window.app.battle.elapsed > 0.5)) break; await sleep(800); }
  await initMap();
  const beforeC = new Set((await invSnap()).inv.map((x) => x.uid));
  const f2 = await autoToResult(rec, 'campaign');
  if (await visible('#result-loot-details > summary') && !await ev(() => document.querySelector('#result-loot-details')?.open)) { await rec.tap('#result-loot-details > summary', { label: '획득 보상 펼치기' }); await sleep(700); }
  const cards = await ev(() => [...document.querySelectorAll('#result-loot .loot-item[data-verdict]')].map((c) => ({ verdict: c.dataset.verdict, lc: c.querySelector('.lc')?.textContent.trim() || '' })));
  rec.obs('campaignCards', cards); await shot(rec, 'campaign-loot-cards');
  rec.check('캠페인 결과에 전리품 카드', cards.length > 0, cards.length);
  const layR = await layoutCheck('#result'); rec.obs('campaignResultLayout', layR);
  rec.check('캠페인 결과: 버튼 잘림·덮임 없음', layR.clipped.length === 0 && layR.covered.length === 0, layR);
  if (cards.length) {
    const lootUids = await ev(() => (window.app.battle.result?.reward?.loot || []).map((x) => x.uid));
    const idx = Math.max(0, cards.findIndex((c) => c.verdict === 'better')); const uid = lootUids[idx];
    await rec.tap('#result-loot .loot-item[data-verdict]', { index: idx, label: '결과 전리품 카드' }); await sleep(1000);
    const sheet = await ev(() => ({ eq: !!document.querySelector('#modal.show #i-eq'), sell: !!document.querySelector('#modal.show #i-sell'), enh: !!document.querySelector('#modal.show #e-go') }));
    rec.obs('cardSheet', sheet); await shot(rec, 'campaign-card-sheet');
    rec.check('결과 전리품 카드 탭 → 장비 시트(장착·판매·강화)', sheet.eq && sheet.sell && sheet.enh, sheet);
    const pre = await invSnap(); const wasWorn = Object.values(pre.equip).includes(uid);
    if (!wasWorn) { await rec.tap('#modal.show #i-eq', { label: '장착하기(결과 카드에서)' }); await sleep(900); }
    const post = await invSnap();
    rec.check('결과 카드에서 장착', Object.values(post.equip).includes(uid), { uid, wasWorn });
    await closeModals(rec);
  }
  rec.check('모든 탭이 의도한 요소에 명중', rec.taps.every((t) => t.hit), rec.taps.filter((t) => !t.hit));
  rec.pass = rec.checks.every((c) => c.ok); await save(); return rec;
}

async function skillRound(rec, grade) {
  await boot(rec); await prepare(rec, { hero: 'knight', grade, level: 30, energy: 200 });
  rec.check(grade + ' 전투 진입', await enterBattle(rec));
  const s0 = await approachEnemy(rec, 7); 
  const aura = await ev(() => { const a = window.app.battle.player.gradeAura; return { grade: a?.grade ?? null, visible: a?.group?.visible ?? null }; });
  rec.obs('aura-' + grade, aura);
  rec.check(grade + ' 오라가 켜져 있음', aura.grade === grade && aura.visible === true, aura);
  await shot(rec, grade + '-aura');
  const a0 = await ev(() => ({ ...window.__qa.audio, states: { ...window.__qa.audio.states } }));
  await ev(() => { const S = window.__a3 = { st: {}, run: true }; const t = () => { if (!S.run) return; const s = window.app.battle?.player?.state; if (s) S.st[s] = (S.st[s] || 0) + 1; requestAnimationFrame(t); }; requestAnimationFrame(t); });
  for (const i of [0, 1, 2]) {
    if (await ev((i) => { const P = window.app.battle.player; return P.cds[i] <= 0; }, i)) { await rec.tap('.skill-btn[data-skill="' + i + '"]', { label: '스킬 ' + (i + 1) }); await sleep(i === 0 ? 450 : 1300); if (i === 0) await shot(rec, grade + '-skill1-vfx'); }
  }
  await ev(() => { const P = window.app.battle.player; P.ult = P.ultMax; }); rec.inject('궁극기 게이지 가득(P.ult = ultMax)');
  await sleep(300);
  await rec.tap('.skill-btn[data-skill="3"]', { label: '궁극기(R)' }); await sleep(500);
  await shot(rec, grade + '-ult-vfx');
  const pa = await playArea(); rec.obs('playArea-' + grade, pa);
  await sleep(1500);
  const a1 = await ev(() => ({ ...window.__qa.audio, states: { ...window.__qa.audio.states } }));
  const sts = await ev(() => { window.__a3.run = false; return window.__a3.st; });
  const ctx = await ev(() => ({ running: window.__qa.audio.states.running || 0, other: Object.entries(window.__qa.audio.states).filter(([k]) => k !== 'running') }));
  rec.obs('states-' + grade, sts); rec.obs('audio-' + grade, { before: a0, after: a1, ctx });
  rec.check(grade + ' 스킬·궁극기 시전 상태(skill·ult)', (sts.skill || 0) > 0 && (sts.ult || 0) > 0, sts);
  rec.check(grade + ' 효과음 재생 이벤트(AudioBufferSourceNode.start) 증가, 컨텍스트 running', a1.buf > a0.buf && ctx.running > 0, { buf: [a0.buf, a1.buf], osc: [a0.osc, a1.osc], ctx });
  rec.check(grade + ' 플레이 보호 영역을 덮는 UI 없음', pa.hits.length === 0, pa.hits);
}
async function stepA3() {
  const rec = newRec('A3', '스킬·궁극기 VFX, SSR·SSSR 오라, 효과음 재생 이벤트, 화면 중앙 가림 없음');
  await skillRound(rec, 'SSR');
  await skillRound(rec, 'SSSR');
  const sfx = await ev(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/sfx/')).map((r) => new URL(r.name).pathname).slice(0, 40));
  rec.obs('sfxResources', { count: sfx.length, sample: sfx.slice(0, 10) });
  rec.check('효과음 파일(/sfx/)을 실제로 받음', sfx.length > 0, sfx.length);
  rec.check('모든 탭이 의도한 요소에 명중', rec.taps.every((t) => t.hit), rec.taps.filter((t) => !t.hit));
  rec.pass = rec.checks.every((c) => c.ok); await save(); return rec;
}

async function openMenuTab(rec, tab) {
  if (await ev(() => window.app.mode !== 'lobby')) { await boot(rec); }
  await closeModals(rec);
  await rec.tap('.bottomnav .oath-nav-menu', { label: '하단 메뉴' }); await sleep(600);
  await rec.tap('#oath-menu button[data-tab="' + tab + '"]', { label: '메뉴 → ' + tab }); await sleep(1000);
}
async function screenCheck(rec, name, root) {
  const lay = await layoutCheck(root); rec.obs('layout-' + name, lay); await shot(rec, name);
  rec.check(name + ': 버튼이 화면 밖으로 잘리지 않음', lay.clipped.length === 0, lay.clipped);
  rec.check(name + ': 버튼 가운데가 다른 요소에 덮이지 않음(터치 가능)', lay.covered.length === 0, lay.covered);
  return lay;
}
async function stepA4() {
  const rec = newRec('A4', '소환·초월·상점·스킬 초기화 화면 잘림·겹침·터치');
  await boot(rec); await prepare(rec, { hero: 'knight', level: 30, grade: 'SR', gems: 3000 });
  // 소환
  await openMenuTab(rec, 'gacha'); rec.check('소환 화면 열림', await visible('#btn-pull1'));
  await screenCheck(rec, 'gacha', '#tab-gacha');
  // 상점(탭 몇 개를 실제로 넘겨 본다)
  await openMenuTab(rec, 'shop'); rec.check('상점 화면 열림', await visible('#shop-tabs'));
  const shopTabs = await ev(() => [...document.querySelectorAll('#shop-tabs button[data-t]')].map((b) => b.dataset.t));
  rec.obs('shopTabs', shopTabs);
  await screenCheck(rec, 'shop-' + (shopTabs[0] || 'first'), '#tab-shop');
  for (const t of shopTabs.slice(1, 4)) { await rec.tap('#shop-tabs button[data-t="' + t + '"]', { label: '상점 탭 ' + t }); await sleep(600); await screenCheck(rec, 'shop-' + t, '#tab-shop'); }
  // 초월·스킬 트리(영웅 탭 → 기사 → 성장 링크)
  await rec.tap('.bottomnav button[data-tab="heroes"]', { label: '하단 영웅 탭' }); await sleep(800);
  await rec.tap('.hero-card[data-hero-id="knight"]', { label: '기사 카드' }).catch(() => {}); await sleep(700);
  await rec.tap('.hs-growth-links button', { text: '^초월$', label: '초월 열기' }); await sleep(900);
  rec.check('초월 화면 열림', await visible('.tc-go'));
  await screenCheck(rec, 'transcend', '.gx-layer:not([hidden])');
  await rec.tap('.gx-layer:not([hidden]) .gx-close', { label: '초월 닫기' }); await sleep(700);
  await rec.tap('.hs-growth-links button', { text: '^스킬 트리$', label: '스킬 트리 열기' }); await sleep(900);
  rec.check('스킬 트리 열림', await visible('.st-reset'));
  await screenCheck(rec, 'skilltree', '.gx-layer:not([hidden])');
  await rec.tap('.st-reset', { label: '스킬 초기화' }); await sleep(700);
  const mt = await ev(() => document.querySelector('#modal.show #modal-box')?.innerText || '');
  rec.obs('resetModal', mt.slice(0, 200));
  rec.check('스킬 초기화 확인 창이 열림', /초기화/.test(mt), mt.slice(0, 80));
  await screenCheck(rec, 'skill-reset-modal', '#modal.show');
  if (await visible('#modal.show #m-cancel')) await rec.tap('#modal.show #m-cancel', { label: '초기화 취소' }); await sleep(500);
  rec.check('초기화 창 취소로 닫힘', !await visible('#modal.show'));
  await rec.tap('.gx-layer:not([hidden]) .gx-close', { label: '스킬 트리 닫기' }).catch(() => {}); await sleep(600);
  rec.check('모든 탭이 의도한 요소에 명중', rec.taps.every((t) => t.hit), rec.taps.filter((t) => !t.hit));
  rec.pass = rec.checks.every((c) => c.ok); await save(); return rec;
}

function thermal() {
  const bat = sh('dumpsys battery');
  const temp = +(bat.match(/temperature: (\d+)/)?.[1] || NaN) / 10, level = +(bat.match(/level: (\d+)/)?.[1] || NaN);
  const plugged = /AC powered: true|USB powered: true|Wireless powered: true/.test(bat);
  const ts = sh('dumpsys thermalservice');
  const status = +(ts.match(/Thermal Status: (\d+)/)?.[1] ?? NaN);
  const hal = ts.split('Current temperatures from HAL:')[1]?.split(/\n\S/)[0] || '';
  const temps = {}; for (const m of hal.matchAll(/mValue=([\d.\-]+), mType=(\d+), mName=([^,]+)/g)) { const k = { 0: 'cpu', 1: 'gpu', 2: 'battery', 3: 'skin' }[m[2]] || 't' + m[2]; temps[k] = Math.max(temps[k] ?? -99, +m[1]); }
  return { batteryC: temp, level, plugged, thermalStatus: status, hal: temps };
}
async function stepA5() {
  const rec = newRec('A5', minutes + '분 연속 전투 프레임·발열');
  if (!await ev(() => window.app?.mode === 'battle' && window.app.battle?.active)) { await boot(rec); await prepare(rec, { hero: 'knight', energy: 400 }); rec.check('전투 진입', await enterBattle(rec)); }
  await setAuto(rec, true);
  const samples = []; const t0 = Date.now(); let lastRaf = await ev(() => window.__qa.raf), lastT = Date.now(), battles = 1, nextSample = 0;
  const startTherm = thermal(); rec.obs('thermalStart', startTherm);
  while (Date.now() - t0 < minutes * 60000) {
    await sleep(2000);
    guard('측정 중 전경 확인');
    if (await handleChoice(rec)) continue;
    if (await resultShown()) {
      const win = await ev(() => !!window.app.battle?.result?.win);
      if (await visible('#btn-result-retry')) await rec.tap('#btn-result-retry', { label: '결과 → 다시' });
      else await rec.tap('button', { text: '^다시 도전', label: '원정 결과 → 다시 도전' });
      battles++; await sleep(1500);
      for (let i = 0; i < 6; i++) { if (await visible('button', '건너뛰기')) await rec.tap('button', { text: '건너뛰기', label: '건너뛰기' }).catch(() => {}); if (await ev(() => window.app.mode === 'battle' && window.app.battle?.active && window.app.battle.elapsed > 0.5)) break; await sleep(800); }
      await setAuto(rec, true); continue;
    }
    if (Date.now() - t0 >= nextSample) {
      nextSample += 30000;
      const g = await ev(() => { const f = window.app.frameGovernor; return { mode: window.app.mode, tier: f.tier, targetFps: f.targetFps, renderedFps: +f.renderedFps.toFixed(1), p95: +f.p95FrameMs.toFixed(1), miss: +f.missRatio.toFixed(3), raf: window.__qa.raf, battleActive: !!window.app.battle?.active, auto: !!window.app.battle?.player?.auto, enemies: window.app.battle?.enemies?.filter((e) => e.alive).length ?? null }; });
      const now = Date.now(), rafFps = (g.raf - lastRaf) / ((now - lastT) / 1000); lastRaf = g.raf; lastT = now;
      const th = thermal();
      samples.push({ sec: round((now - t0) / 1000, 0), ...g, rafFps: round(rafFps, 1), ...th });
      report.steps.A5.observed.samples = samples; await save();
      if (samples.length % 4 === 1) await shot(rec, 'soak-' + String(samples.length).padStart(2, '0'));
    }
  }
  const endTherm = thermal(); rec.obs('thermalEnd', endTherm); rec.obs('battles', battles);
  // 1분 창(표본 2개) 평균 fps 가 목표의 70% 미만인 창이 연속 4개(2분) 이상이면 지속 저하
  const battleS = samples.filter((s) => s.mode === 'battle' && s.targetFps > 0);
  let run = 0, worst = 0; for (const s of battleS) { if (s.renderedFps < s.targetFps * 0.7) { run++; worst = Math.max(worst, run); } else run = 0; }
  const fps = battleS.map((s) => s.renderedFps), avg = fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : null;
  const maxBat = Math.max(...samples.map((s) => s.batteryC)), maxStatus = Math.max(...samples.map((s) => s.thermalStatus)), maxTier = Math.max(...samples.map((s) => s.tier));
  rec.obs('summary', { samples: samples.length, battleSamples: battleS.length, durationMin: round((Date.now() - t0) / 60000, 1), avgRenderedFps: round(avg, 1), minRenderedFps: fps.length ? Math.min(...fps) : null, maxP95: Math.max(...battleS.map((s) => s.p95)), maxTier, batteryC: [startTherm.batteryC, endTherm.batteryC], maxBatteryC: maxBat, maxThermalStatus: maxStatus, skinC: [startTherm.hal.skin ?? null, endTherm.hal.skin ?? null], worstLowRunSamples: worst });
  rec.check('측정 ' + minutes + '분 이상, 30초 간격 표본', (Date.now() - t0) >= minutes * 60000 - 5000 && samples.length >= minutes * 2 - 1, samples.length);
  rec.check('지속 프레임 저하 없음(목표 70% 미만 연속 2분 미만)', worst < 4, { worst });
  rec.check('과열 없음(thermal status < 3, 배터리 < 45°C)', maxStatus < 3 && maxBat < 45, { maxStatus, maxBat });
  rec.pass = rec.checks.every((c) => c.ok); await save(); return rec;
}

// ---------- 시작·정리 ----------
let backup = null, savedTimeout = null;
async function main() {
  report.device = { model: sh('getprop ro.product.model').trim(), android: sh('getprop ro.build.version.release').trim(), chrome: (sh('dumpsys package com.android.chrome | grep versionName').match(/versionName=(\S+)/) || [])[1] || null, wmSize: sh('wm size').trim().replace(/\s+/g, ' '), density: sh('wm density').trim().replace(/\s+/g, ' ') };
  guard('시작');
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FORWARD_PS, '-Action', 'add', '-Serial', serial, '-Local', 'tcp:' + port, '-Remote', 'localabstract:chrome_devtools_remote', '-Holder', holder], { encoding: 'utf8' });
  const ver = await http('/json/version'); report.device.cdpBrowser = ver.Browser;
  // 안드로이드 Chrome 은 /json/new 를 거절하므로 브라우저 CDP 의 Target.createTarget 으로 새 탭을 연다.
  const br = new Cdp(ver.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, 'ws://127.0.0.1:' + port)); await br.open();
  targetId = (await br.send('Target.createTarget', { url: origin + 'version.json' })).targetId; br.close();
  cdp = new Cdp('ws://127.0.0.1:' + port + '/devtools/page/' + targetId); await cdp.open();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await waitFor(() => document.readyState === 'complete', null, 60000);
  await sleep(800);
  guard('탭 열린 뒤');
  report.device.versionJson = await ev(() => document.body.innerText.slice(0, 300));
  backup = await ev(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await fs.writeFile(path.join(out, 'localStorage-backup.json'), JSON.stringify(backup));
  report.settings.localStorageBackupKeys = Object.keys(backup).length;
  savedTimeout = sh('settings get system screen_off_timeout').trim(); report.settings.screenOffTimeoutOriginal = savedTimeout;
  if (steps.includes('a5')) { sh('settings put system screen_off_timeout 1800000'); report.settings.screenOffTimeoutSet = 1800000; }
  await save();
  for (const s of steps) {
    const fn = { a1: stepA1, a2: stepA2, a3: stepA3, a4: stepA4, a5: stepA5 }[s]; if (!fn) continue;
    try { const r = await fn(); console.log(s.toUpperCase(), r.pass ? 'PASS' : 'FAIL', JSON.stringify(r.checks.filter((c) => !c.ok)).slice(0, 600)); }
    catch (e) { if (e instanceof OwnerBusy) throw e; report.errors.push({ step: s, error: String(e.stack || e).slice(0, 800) }); console.log(s.toUpperCase(), 'ERROR', String(e).slice(0, 300)); await save(); }
  }
}
async function cleanup() {
  const c = {};
  try { if (cdp && backup) { await cdp.send('Page.navigate', { url: origin + 'version.json' }); await sleep(2500); c.restored = await ev((b) => { localStorage.clear(); for (const [k, v] of Object.entries(b)) localStorage.setItem(k, v); return localStorage.length; }, backup); c.restoredMatches = c.restored === Object.keys(backup).length; } } catch (e) { c.restoreError = String(e); }
  try { cdp?.close(); if (targetId) c.tabClosed = await http('/json/close/' + targetId); } catch (e) { c.closeError = String(e); }
  try { if (savedTimeout && report.settings.screenOffTimeoutSet) { sh('settings put system screen_off_timeout ' + savedTimeout); c.screenOffTimeout = sh('settings get system screen_off_timeout').trim(); } } catch (e) { c.settingError = String(e); }
  try { c.forward = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FORWARD_PS, '-Action', 'clean', '-Holder', holder, '-Serial', serial], { encoding: 'utf8' }).trim(); } catch (e) { c.forwardError = String(e); }
  report.cleanup = c; report.finished = new Date().toISOString(); await save();
}
let code = 0;
try { await main(); } catch (e) { if (e instanceof OwnerBusy) { report.ownerBusy = e.message; code = 4; console.log('OWNER_BUSY', e.message); } else { report.errors.push({ fatal: String(e.stack || e).slice(0, 800) }); code = 1; console.log('FATAL', String(e).slice(0, 400)); } }
finally { await cleanup(); }
console.log(JSON.stringify({ out, steps: Object.fromEntries(Object.entries(report.steps).map(([k, v]) => [k, v.pass])), errors: report.errors.length, cleanup: report.cleanup }));
process.exit(code);

