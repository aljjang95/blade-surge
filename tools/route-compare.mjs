/**
 * 던전 동선 실측 — 보스 직행(direct)과 전부 사냥(full)을 같은 시드·같은 새 저장으로 AUTO 로 비교하고,
 * 1-1 전투 화면에서 지도 창 동선 버튼의 겹침·터치 높이를 잰다.
 *   node tools/route-compare.mjs [--out <dir>] [--seed 7] [--levels 1-5:12,2-5:20] [--stages 1-1,1-5,2-5] [--repeat 1-1] [--only compare|screens]
 * 전제: `bun run build` 산출물(dist). vite preview 로 dist 를 띄우고 Playwright 로 window.app 을 고정 dt(1/60)로 렌더 없이 진행한다.
 * 규칙: 동선·관문마다 새 브라우저 컨텍스트(빈 저장). 같은 관문의 두 동선은 같은 영웅 레벨로 맞춘다(--levels, 기록됨). AUTO 만 쓴다.
 * 이 도구는 결과 측정용이다. 실기기 입력·GPU 프레임·체감 난이도의 판단이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAutoStarter } from './qa-starter.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const OUT = resolve(PROJ, arg('out', 'work/qa/route-compare'));
const SEED = Number(arg('seed', 7)), MAX_SEC = Number(arg('max-sec', 900));
const STAGES = arg('stages', '1-1,1-5,2-5').split(',');
const REPEAT = arg('repeat', '1-1'), ONLY = arg('only', 'all');
const LEVELS = Object.fromEntries(arg('levels', '').split(',').filter(Boolean).map((s) => { const [c, l] = s.split(':'); return [c, Number(l)]; }));
const PREF_KEY = 'bs.dungeonRoute.v1';
const PORT = 4800 + Math.floor(Math.random() * 150);
mkdirSync(resolve(OUT, 'route-shots'), { recursive: true });

// --origin <url>: 배포된 정식 호스트를 그대로 연다(운영 readback 캡처용). 없으면 dist 를 vite preview 로 띄운다.
const ORIGIN = arg('origin', '');
const srv = ORIGIN ? null : spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
const BASE = ORIGIN || `http://localhost:${PORT}/`;
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch { /* 기동 대기 */ } if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv?.kill(); throw new Error('server did not start'); }
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const storyFirst = Object.fromEntries(STORY_EVENTS.map((ev) => [ev.id, ev.choices?.[0]?.id]));

/** 새 컨텍스트 + 부팅. mode 는 페이지 로드 전에 저장 키로 심는다(지도 버튼으로 고른 것과 같은 저장). */
async function openGame({ mode, viewport, mobile = false }) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(([k, m]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ mode: m, guide: true })); } catch { /* 저장 불가 */ } }, [PREF_KEY, mode]);
  await installAutoStarter(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));
  await page.goto(BASE);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.app.ui.closeModal?.());
  return { ctx, page, errors };
}

/** 브라우저 안 도우미: 고정 시드, 입장, 제안(은혜·이야기) 첫 선택, 정산까지. */
function install({ seed, storyFirst: story }) {
  const a = window.app, e = a.eco;
  let st = seed >>> 0;
  const reseed = () => { st = seed >>> 0; };
  a.testPause = true; // 설치 즉시 앱 자체 루프를 세운다: 실시간 프레임이 난수를 쓰면 같은 시드도 판마다 갈린다
  Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  setInterval(() => { document.querySelector('.lore-scene-skip')?.click(); }, 250);
  const R = window.__R = { reseed, frames: 0, offers: [], abort: null };
  R.enter = async (code, level) => {
    const [ch, s] = code.split('-').map(Number);
    e.s.progress.unlocked = Math.max(e.s.progress.unlocked, (ch - 1) * 10 + s);
    if (level > 1) { e.hero().level = level; e.hero().exp = 0; }
    e.s.energy = e.energyMax; e.save?.();
    const def = window.__stageDef(ch, s);
    reseed(); // 입장 직전에 시드를 되감아 같은 관문이 같은 난수열로 시작하게 한다
    const ok = await a.startStage({ ch, st: s });
    for (let i = 0; i < 80 && !(a.battle?.active && a.battle.player); i++) await new Promise((r) => setTimeout(r, 100));
    const b = a.battle, p = b.player;
    if (ok === false || !b.active || !p) return { ok: false };
    p.auto = true; a.ui.closeModal?.();
    a.tutorial.end?.(); // 첫 전투 안내 카드(실시간 타이머)를 치워 1-1 도 같은 조건으로 돌린다
    return { ok: true, recPower: def.recPower, power: e.heroPower(e.s.selected), level: e.hero().level, mode: b.routeMode, early: !!b.routeOpenEarly, rooms: b.world.rooms.length, hero: e.s.selected };
  };
  const offers = () => {
    const b = a.battle;
    for (let g = 0; g < 8 && b.active; g++) {
      const o = b.currentOffer?.(); if (!o) return;
      let res;
      if (o.kind === 'boon') { res = b.selectBoon?.(o.ids?.[0]); if (res?.ok) R.offers.push('boon:' + o.ids?.[0]); }
      else if (o.kind === 'story') { res = b.selectStory?.(story[o.id]); if (res?.ok) R.offers.push('story:' + o.id); }
      if (!res?.ok) return;
    }
  };
  R.run = (n, until) => {
    const b = a.battle, p = b.player; let pausedRun = 0;
    for (let k = 0; k < n; k++) {
      R.frames++;
      if (!p.alive && b.active) { for (let i = 0; i < 140; i++) a.step(1 / 60, false); if (b.active) { a.ui.closeModal?.(); b.defeat(); } break; }
      if (b.paused) { offers(); if (++pausedRun > 900) { R.abort = 'paused-softlock'; break; } a.step(1 / 60, false); continue; }
      pausedRun = 0;
      a.step(1 / 60, false);
      if (!b.active || b.bossDefeated) break;
      if (until && until(b)) break;
      if (b.elapsed > window.__MAXSEC) { R.abort = 'timeout'; break; }
    }
    return { t: +b.elapsed.toFixed(1), active: b.active, won: !!b.bossDefeated, abort: R.abort };
  };
  R.settle = () => {
    const b = a.battle;
    if (b.active && R.abort) { try { b.defeat(); } catch { /* 이미 끝남 */ } }
    for (let i = 0; i < 600; i++) { if (b.result && a.ui.resultData === b.result) break; a.step(1 / 60, false); }
    const r = b.result; if (!r) return { ok: false };
    const rw = r.reward || {}, got = {};
    for (const g of rw.got || []) got[g.k] = (got[g.k] || 0) + g.n;
    return { ok: true, win: !!r.win, elapsed: +b.elapsed.toFixed(2), resultTime: +(r.time ?? 0).toFixed(2), kills: r.kills, stars: r.stars ?? null, rooms: r.rooms ?? b.roomsCleared, totalRooms: r.totalRooms ?? b.world.rooms.length,
      fullClear: !!r.fullClear, exp: rw.exp ?? null, combatExp: rw.combatExp ?? null, totalExp: rw.totalExp ?? ((rw.exp || 0) + (rw.combatExp || 0)), gold: got.gold ?? null, got, fullClearBonus: rw.fullClearBonus || null,
      gear: (rw.loot || []).length, ups: rw.ups ?? null, saveError: rw.saveError || null, offers: R.offers.length, hpLost: r.hpLost ?? null };
  };
  window.__MAXSEC = 900;
}

async function playOne(code, mode, level) {
  const { ctx, page, errors } = await openGame({ mode, viewport: { width: 844, height: 390 } });
  try {
    await page.evaluate(install, { seed: SEED, storyFirst });
    await page.evaluate((s) => { window.__MAXSEC = s; }, MAX_SEC);
    const entered = await page.evaluate(([c, l]) => window.__R.enter(c, l), [code, level]);
    if (!entered.ok) return { code, mode, error: 'start failed' };
    let last;
    for (let i = 0; i < 400; i++) {
      last = await page.evaluate(() => window.__R.run(900));
      if (!last.active || last.won || last.abort) break;
    }
    const settle = await page.evaluate(() => window.__R.settle());
    return { code, mode, ...entered, ...settle, abort: last?.abort || null, pageErrors: errors.slice(0, 3) };
  } finally { await ctx.close(); }
}

const ratio = (d, f) => (d != null && f ? +(d / f).toFixed(3) : null);
const perMin = (v, s) => (v != null && s ? +(v / (s / 60)).toFixed(1) : null);

async function compare() {
  const rows = [];
  for (const code of STAGES) {
    const level = LEVELS[code] || 1;
    for (const mode of ['full', 'direct']) {
      const row = await playOne(code, mode, level); rows.push(row);
      console.log(JSON.stringify({ code, mode, level, win: row.win, t: row.elapsed, kills: row.kills, rooms: `${row.rooms}/${row.totalRooms}`, fullClear: row.fullClear, stars: row.stars, exp: row.totalExp, gold: row.gold, abort: row.abort, recPower: row.recPower, power: row.power }));
    }
  }
  // 결정성: 같은 관문·동선을 한 번 더 돌려 핵심 수치가 같은지 본다.
  const determinism = [];
  if (REPEAT) for (const mode of ['full', 'direct']) {
    const first = rows.find((r) => r.code === REPEAT && r.mode === mode);
    if (!first) continue;
    const again = await playOne(REPEAT, mode, LEVELS[REPEAT] || 1);
    const keys = ['win', 'elapsed', 'kills', 'rooms', 'totalRooms', 'fullClear', 'stars', 'totalExp', 'gold', 'gear'];
    const diff = keys.filter((k) => JSON.stringify(first[k]) !== JSON.stringify(again[k])).map((k) => ({ key: k, first: first[k], again: again[k] }));
    determinism.push({ code: REPEAT, mode, identical: diff.length === 0, diff });
  }
  const table = STAGES.map((code) => {
    const f = rows.find((r) => r.code === code && r.mode === 'full'), d = rows.find((r) => r.code === code && r.mode === 'direct');
    return { code, level: LEVELS[code] || 1,
      full: f, direct: d,
      ratio: f && d ? { time: ratio(d.elapsed, f.elapsed), expPerMin: ratio(perMin(d.totalExp, d.elapsed), perMin(f.totalExp, f.elapsed)), goldPerMin: ratio(perMin(d.gold, d.elapsed), perMin(f.gold, f.elapsed)),
        expPerRun: ratio(d.totalExp, f.totalExp), goldPerRun: ratio(d.gold, f.gold) } : null };
  });
  return { seed: SEED, levels: LEVELS, rows, table, determinism };
}

// ---- 화면 ----
const VIEWPORTS = [[360, 640], [390, 700], [390, 844], [844, 390]];
const BUTTONS = ['#btn-route-full', '#btn-route-direct', '#btn-route-guide', '#btn-map-close'];
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

async function measure(page) {
  return page.evaluate((sels) => {
    const vw = innerWidth, vh = innerHeight, dlg = document.getElementById('battle-atlas'), body = dlg?.querySelector('.battle-atlas-body');
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    // 눈에 보이는가: 스크롤 영역 안에 들어오고, 중심점을 실제로 이 버튼이 받는가(푸터·헤더가 가리지 않음).
    const seen = (el) => {
      const r = el.getBoundingClientRect(), c = body?.getBoundingClientRect();
      const inside = !c || !body.contains(el) || (r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5);
      const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
      return inside && (hit === el || el.contains(hit));
    };
    const buttons = {}; const els = {};
    for (const s of sels) { const el = document.querySelector(s); els[s] = el; buttons[s] = el && el.getClientRects().length ? { ...rect(el), disabled: !!el.disabled, visibleAtOpen: seen(el) } : null; }
    const scrollable = body ? body.scrollHeight - body.clientHeight : 0;
    if (body) body.scrollTop = body.scrollHeight;
    for (const s of sels) if (buttons[s]) { buttons[s].visibleAfterScroll = seen(els[s]); buttons[s].afterScroll = rect(els[s]); }
    if (body) body.scrollTop = 0;
    return { vw, vh, open: !!dlg?.open, dialog: dlg ? rect(dlg) : null, buttons, bodyScrollable: scrollable, bodyH: body ? body.clientHeight : null };
  }, BUTTONS);
}

function judge(m) {
  const names = Object.keys(m.buttons).filter((k) => m.buttons[k]);
  const overlaps = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (overlap(m.buttons[names[i]], m.buttons[names[j]])) overlaps.push([names[i], names[j]]);
  const outside = names.filter((n) => { const r = m.buttons[n]; return r.left < -0.5 || r.top < -0.5 || r.right > m.vw + 0.5 || r.bottom > m.vh + 0.5; });
  const low = names.filter((n) => m.buttons[n].h < 44).map((n) => `${n}=${m.buttons[n].h}`);
  const missing = Object.keys(m.buttons).filter((k) => !m.buttons[k]);
  const hiddenAtOpen = names.filter((n) => !m.buttons[n].visibleAtOpen), unreachable = names.filter((n) => !m.buttons[n].visibleAtOpen && !m.buttons[n].visibleAfterScroll);
  return { hiddenAtOpen, unreachable, overlaps: overlaps.length, overlapPairs: overlaps, outsideViewport: outside, under44: low, missing, ok: !overlaps.length && !outside.length && !low.length && !missing.length && !hiddenAtOpen.length };
}

const dlgOpen = (page) => page.evaluate(() => !!document.getElementById('battle-atlas')?.open);
/** 손가락 탭으로 연다. 탭이 안 먹으면 마우스 클릭으로 한 번 더 — 어느 쪽으로 열렸는지 기록한다. */
async function openMap(page) {
  await page.locator('#btn-map').tap({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  if (await dlgOpen(page)) return 'tap';
  await page.locator('#btn-map').click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  return (await dlgOpen(page)) ? 'click-after-tap-failed' : 'failed';
}
async function closeMap(page) {
  await page.locator('#btn-map-close').tap({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  if (await dlgOpen(page)) await page.locator('#btn-map-close').click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function screens() {
  const out = [];
  for (const [w, h] of VIEWPORTS) {
    const tag = `${w}x${h}`;
    const { ctx, page, errors } = await openGame({ mode: 'direct', viewport: { width: w, height: h }, mobile: true });
    try {
      await page.evaluate(install, { seed: SEED, storyFirst });
      const entered = await page.evaluate(() => window.__R.enter('1-1', 1));
      if (!entered.ok) { out.push({ viewport: tag, error: 'start failed' }); continue; }
      // 세로 화면 안내(가로 권장)는 '세로로 계속하기'로 넘긴다 — 사람이 세로로 쓰는 경우와 같다.
      await page.locator('#btn-ignore-rotate').click({ timeout: 2000, force: true }).catch(() => {});
      await page.evaluate(() => document.body.classList.remove('force-landscape')); // 버튼의 동작과 같다(ui.js)
      // 첫 전투 안내 카드는 '그만 보기'로 닫는다(사람이 하는 것과 같다).
      await page.getByRole('button', { name: '그만 보기' }).click({ timeout: 1500, force: true }).catch(() => {});
      // 입장 직후 조금만 진행해 첫 장면이 그려지게 한다(렌더 1회).
      await page.evaluate(() => { window.__R.run(45); window.app.battle.player.auto = false; window.app.step(0, true); });
      await page.waitForTimeout(300);
      const row = { viewport: tag, entered };
      // (a) HUD 미니맵
      const wrap = page.locator('#minimap');
      row.hudMinimapBox = await wrap.boundingBox().catch(() => null);
      await page.screenshot({ path: resolve(OUT, 'route-shots', `${tag}-a-hud.png`) });
      if (row.hudMinimapBox) await page.screenshot({ path: resolve(OUT, 'route-shots', `${tag}-a-minimap.png`), clip: { x: Math.max(0, row.hudMinimapBox.x - 6), y: Math.max(0, row.hudMinimapBox.y - 6), width: Math.min(w, row.hudMinimapBox.width + 12), height: Math.min(h, row.hudMinimapBox.height + 12) } });
      // (b) 지도 창
      row.openEarly = await openMap(page);
      row.mapEarly = await measure(page); row.mapEarlyJudge = judge(row.mapEarly);
      await page.screenshot({ path: resolve(OUT, 'route-shots', `${tag}-b-map.png`) });
      await closeMap(page);
      // (c) 직행 모드에서 경로 방 정화 후 봉인이 풀릴 때까지 AUTO 로 진행한 뒤 지도 창
      await page.evaluate(() => { window.app.battle.player.auto = true; });
      let unsealed = false;
      for (let i = 0; i < 200 && !unsealed; i++) {
        const r = await page.evaluate(() => { const o = window.__R.run(300, (b) => !b.world.sealed); const b = window.app.battle; return { ...o, sealed: !!b.world.sealed, cleared: b.roomsCleared, total: b.world.rooms.length }; });
        unsealed = !r.sealed || !r.active; row.unsealState = r;
        if (!r.active) break;
      }
      await page.evaluate(() => { const b = window.app.battle; b.player.auto = false; for (let i = 0; i < 100; i++) window.app.step(1 / 60, false); window.app.step(0, true); });
      row.unsealed = unsealed;
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(OUT, 'route-shots', `${tag}-c-hud-unsealed.png`) });
      row.openUnsealed = await openMap(page);
      row.mapUnsealed = await measure(page); row.mapUnsealedJudge = judge(row.mapUnsealed);
      row.routeView = await page.evaluate(() => { const v = window.app.battle.routeView?.(); return v && { mode: v.mode, pathLeft: v.pathLeft, optionalLeft: v.optionalLeft, optionalTotal: v.optionalTotal, revealed: v.revealed, early: v.early }; });
      await page.screenshot({ path: resolve(OUT, 'route-shots', `${tag}-c-map-unsealed.png`) });
      row.pageErrors = errors.slice(0, 3);
      out.push(row);
      console.log(JSON.stringify({ viewport: tag, early: row.mapEarlyJudge, unsealed: row.mapUnsealedJudge, unsealedFlag: row.unsealed }));
    } finally { await ctx.close(); }
  }
  return out;
}

const result = { build: null, args: { stages: STAGES, seed: SEED, levels: LEVELS, repeat: REPEAT } };
try {
  if (ONLY === 'all' || ONLY === 'compare') result.compare = await compare();
  if (ONLY === 'all' || ONLY === 'screens') result.screens = await screens();
} catch (err) { result.error = String(err?.stack || err).slice(0, 600); process.exitCode = 1; }
finally {
  writeFileSync(resolve(OUT, ONLY === 'screens' ? 'screens.json' : ONLY === 'compare' ? 'summary.json' : 'summary.json'), JSON.stringify(result, null, 1));
  await browser.close(); srv?.kill();
}
console.log('done', OUT, result.error || '');
