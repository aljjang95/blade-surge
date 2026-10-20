// 사이클 20261020-grade-monetization-reset 브라우저 QA(A1~A5). 실제 개발 서버·실제 터치 입력으로 검증한다.
// 사용: node tools/gogo-qa-20261020-grade.mjs --origin http://127.0.0.1:5361/ --out <evidence 폴더> [--only A1,A2] [--gl swift]
// 규칙: 상태 준비(재화·영웅 레벨·등급·보유 영웅·튜토리얼 완료)와 실패 주입(저장 실패)·이전 저장 픽스처만 주입하고 보고서에 injected 로 남긴다.
//       하단 탭·영웅 카드·초월/스킬 트리 버튼·상점 상품·모달 버튼·소환 버튼·전투 스킬 버튼은 모두 Playwright 터치(locator.tap())다.
//       src/ 는 수정하지 않는다. 결과는 <out>/<id>.json 과 캡처 png, summary.json 이다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const origin = arg('origin', 'http://127.0.0.1:5361/');
const out = path.resolve(arg('out', 'work/qa/gogo-20261020-grade'));
const only = arg('only') ? arg('only').split(',').map((s) => s.trim().toUpperCase()) : null;
const VIEW = { width: 844, height: 390 }, WIDE = { width: 1280, height: 590 };
const SAVE_KEY = 'bladesurge_save_v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 3) => (Number.isFinite(n) ? +n.toFixed(d) : n);
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
await fs.mkdir(out, { recursive: true });

// ---------- 보고서 레코드 ----------
function newRec(id, title) {
  const rec = { id, title, pass: false, checks: [], injected: [], real: [], observed: {}, captures: [], pageErrors: [], started: new Date().toISOString(), cur: null };
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

// 같은 시드 Math.random(mulberry32). 전투 방·적 구성을 등급 사이에서 같게 만든다.
const seedScript = (seed) => '(() => { let a = ' + seed + ' >>> 0; Math.random = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();';

// ---------- 세션(브라우저 컨텍스트) ----------
async function open(browser, rec, viewport = VIEW, { seed = null, initScript = null } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  if (seed !== null) await context.addInitScript(seedScript(seed));
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const s = { context, page, rec, viewport };
  page.on('pageerror', (e) => rec.pageErrors.push('pageerror: ' + String(e).slice(0, 300)));
  // Vite 개발 서버는 Worker 경로(/api/social/*, 커뮤니티 #216)를 서빙하지 않아 404 가 난다. 그 404 만 따로 세고 다른 실패는 그대로 오류로 본다.
  page.on('response', (r) => { if (r.status() === 404 && new URL(r.url()).pathname.startsWith('/api/social/')) rec.devWorker404 = (rec.devWorker404 || 0) + 1; });
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/Ignored attempt to cancel a touchstart event with cancelable=false/.test(t)) { rec.ignoredConsole = (rec.ignoredConsole || 0) + 1; return; } if (/status of 404/.test(t) && /\/api\/social\//.test(m.location()?.url || '')) { rec.ignoredDevWorker404 = (rec.ignoredDevWorker404 || 0) + 1; return; } rec.pageErrors.push('console: ' + t.slice(0, 300) + (m.location()?.url ? ' @ ' + m.location().url : '')); });
  s.close = () => context.close();
  rec.cur = s;
  return s;
}

let errN = 0;
async function errShot(s) { try { errN++; await s.page.screenshot({ path: path.join(out, s.rec.id + '-error-' + errN + '.png') }); s.rec.captures.push(s.rec.id + '-error-' + errN + '.png'); } catch {} }

async function closeModals(page) {
  for (let n = 0; n < 6; n++) {
    const c = page.locator('#modal.show #m-cancel');
    if (!await c.isVisible().catch(() => false)) break;
    await c.tap(); await page.waitForTimeout(250);
  }
  // 출석 보상 등 닫기 버튼만 있는 모달
  const x = page.locator('#modal.show button', { hasText: /^닫기$/ });
  if (await x.count()) { await x.first().tap().catch(() => {}); await page.waitForTimeout(300); }
}

// 토스트 문구 수집(창이 닫히기 전에 읽기 위해).
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
  await installToastLog(page);
  s.rec.did('부팅: #btn-ignore-rotate·#boot-start 실제 탭 → lobby');
}

// 상태 준비(주입): 튜토리얼 완료, 선택 영웅, 보유 영웅, 영웅 레벨·등급·조각, 재화.
async function prepareState(s, o = {}) {
  const p = { hero: 'knight', level: null, grade: null, gold: null, gems: null, tickets: null, ssrTickets: null, shards: null, transcendStones: null, skillResets: null, own: [], tutorial: true, ...o };
  const info = await s.page.evaluate((p) => {
    const e = window.app.eco;
    if (p.tutorial) e.s.tutorial = { completed: true };
    for (const id of [p.hero, ...p.own]) if (!e.ownHero(id)) e.grantHero(id);
    e.s.selected = p.hero;
    const h = e.hero(p.hero);
    if (p.level) { h.level = p.level; h.exp = 0; }
    if (p.grade) h.grade = p.grade;
    if (p.shards !== null) h.shards = p.shards;
    for (const [k, v] of Object.entries({ gold: p.gold, gems: p.gems, tickets: p.tickets, ssrTickets: p.ssrTickets, transcendStones: p.transcendStones, skillResets: p.skillResets })) if (v !== null) e.s[k] = v;
    if (p.ownShards) for (const [id, n] of Object.entries(p.ownShards)) e.hero(id).shards = n;
    e.save(); e.emit?.();
    return { selected: e.s.selected, level: h.level, grade: h.grade, shards: h.shards, gold: e.s.gold, gems: e.s.gems, tickets: e.s.tickets, ssrTickets: e.s.ssrTickets, transcendStones: e.s.transcendStones, skillResets: e.s.skillResets };
  }, p);
  s.rec.inject('eco 상태 준비: ' + JSON.stringify(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)))));
  await s.page.waitForTimeout(250);
  return info;
}
const eco = (s, fn, arg) => s.page.evaluate(fn, arg);
const ecoSnap = (s) => s.page.evaluate(() => { const e = window.app.eco.s; return { gems: e.gems, gold: e.gold, tickets: e.tickets, ssrTickets: e.ssrTickets, transcendStones: e.transcendStones, skillResets: e.skillResets, purchases: e.purchases.length, spentKRW: e.spentKRW }; });
const heroSnap = (s, id) => s.page.evaluate((id) => { const e = window.app.eco, h = e.hero(id), sp = e.skillPoints(id); return { level: h.level, grade: h.grade, shards: h.shards, skills: [...h.skills], loadout: [...(h.skillLoadout || [])], sp: { earned: sp.earned, bonus: sp.bonus, spent: sp.spent, available: sp.available }, gems: e.s.gems, skillResets: e.s.skillResets, gold: e.s.gold, transcendStones: e.s.transcendStones }; }, id);

// ---------- 실제 탭 이동 ----------
// 하단 내비는 던전·영웅·메뉴 3개뿐이다. 소환·상점 등은 메뉴 창 안의 버튼(data-tab)을 실제로 탭한다.
const tapTab = async (s, tab) => {
  await closeModals(s.page);
  if (tab === 'home' || tab === 'heroes') await s.page.locator('.bottomnav button[data-tab="' + tab + '"]').tap();
  else { await s.page.locator('.bottomnav .oath-nav-menu').tap(); await s.page.waitForTimeout(450); await s.page.locator('#oath-menu button[data-tab="' + tab + '"]').tap(); }
  await s.page.waitForTimeout(600);
};
const tabShown = (s, tab) => s.page.evaluate((tab) => document.getElementById('tab-' + tab)?.classList.contains('show') === true, tab);
const shopTabOn = (s) => s.page.evaluate(() => { const b = document.querySelector('#shop-tabs button.on'); return b ? { id: b.dataset.t, name: b.textContent.trim() } : null; });
// 영웅 탭 → 영웅 카드 → 성장 버튼('스킬 트리' | '초월') 실제 탭.
async function openGrowth(s, heroId, label) {
  await tapTab(s, 'heroes');
  await s.page.locator('.hero-card[data-hero-id="' + heroId + '"]').tap(); await s.page.waitForTimeout(500);
  await s.page.locator('.hs-growth-links button', { hasText: label }).tap();
  await s.page.waitForSelector(label === '초월' ? '.tc-layer:not([hidden]) .tc-go' : '.st-layer:not([hidden]) .st-grid', { timeout: 10000 });
  await s.page.waitForTimeout(500);
  s.rec.did('하단 영웅 탭 → ' + heroId + ' 카드 → "' + label + '" 버튼 실제 탭');
}
const modalText = (s) => s.page.locator('#modal.show #modal-box').innerText().catch(() => '');
async function tapModal(s, sel) { await s.page.locator('#modal.show ' + sel).tap(); await s.page.waitForTimeout(450); }

// 전투 진입(실제 탭): 추천 던전 "출격 준비" → "원정 시작" → (있으면) 건너뛰기 → battle.
async function enterBattle(s, { settle = 1500 } = {}) {
  const { page } = s;
  await closeModals(page);
  await tapTab(s, 'home');
  await page.locator('#citadel-dungeon-prepare').tap(); await page.waitForTimeout(900);
  await page.getByRole('button', { name: /원정 시작/ }).tap(); await page.waitForTimeout(700);
  const skip = page.getByRole('button', { name: /건너뛰기/ });
  if (await skip.count()) await skip.first().tap().catch(() => {});
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !!window.app.battle.player, undefined, { timeout: 90000 });
  await page.waitForFunction(() => window.app.battle.elapsed > 0.5, undefined, { timeout: 60000 });
  await page.waitForTimeout(settle);
  s.rec.did('전투 진입: #citadel-dungeon-prepare → 원정 시작 → 건너뛰기 탭 → mode=battle');
}
// 적이 있는 방까지 AUTO 버튼을 실제 탭해 이동한 뒤 AUTO 를 다시 꺼 둔다.
async function waitForEnemies(s, timeout = 120000) {
  const { page } = s;
  const live = () => page.evaluate(() => { const b = window.app.battle, P = b?.player; if (!b?.active || !P) return null; const l = b.enemies.filter((e) => e.alive && !e.spawning).map((e) => Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z)); return { n: l.length, min: l.length ? Math.min(...l) : null, auto: P.auto }; });
  let st = await live();
  if (st && st.n > 0) return st;
  await page.locator('#btn-auto').tap(); s.rec.did('AUTO 버튼 실제 탭(적이 있는 방까지 이동)');
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { await sleep(150); st = await live(); if (st && st.n > 0 && st.min <= 14) break; }
  if (!st || st.n === 0) throw new Error('적이 나타나지 않음(타임아웃) ' + JSON.stringify(st));
  if (st.auto) { await page.locator('#btn-auto').tap(); s.rec.did('AUTO 버튼 실제 탭(끄기)'); await sleep(250); }
  return await live();
}
// 주입: 플레이어를 가장 가까운 적에서 dist 만큼 떨어진 곳에 놓고 적을 바라보게 한다.
async function placeFixture(s, dist = 4) {
  const r = await s.page.evaluate((dist) => {
    const b = window.app.battle, P = b.player, W = b.world;
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
    P.yaw = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    return { ok: true, name: e.def?.name, enemies: live.length };
  }, dist);
  s.rec.inject('전투 픽스처: 플레이어를 가장 가까운 적에서 ' + dist + ' 거리로 이동하고 적을 바라보게 설정');
  return r;
}
const stageSig = (s) => s.page.evaluate(() => { const b = window.app.battle; return { enemies: b.enemies.filter((e) => e.alive).map((e) => e.def?.id || e.def?.name).sort().join(','), stage: b.stage?.id ?? b.stageId ?? null }; });

// ---------- A1: 등급 차이 ----------
async function a1Run(browser, rec, grade) {
  const s = await open(browser, rec, VIEW, { seed: 20261020 });
  try {
    await boot(s); await prepareState(s, { hero: 'mage', level: 30, grade });
    await enterBattle(s, { settle: 1200 }); await waitForEnemies(s);
    // 스킬 0(화염구)이 쓸 수 있을 때까지(AUTO 이동 중 시전한 대기시간·MP 회복) 기다린다.
    await s.page.waitForFunction(() => { const P = window.app.battle.player; return P.cds[0] <= 0 && P.mp >= 30 && !['skill', 'ult', 'dead'].includes(P.state); }, undefined, { timeout: 30000 });
    const fx = await placeFixture(s, 4); if (!fx.ok) throw new Error('픽스처 실패 ' + JSON.stringify(fx));
    const pre = await s.page.evaluate(async () => {
      const { HEROES } = await import('/src/data/heroes.js');
      const b = window.app.battle, P = b.player, st = P.stats, sk = HEROES.mage.skills[0];
      return { stats: { atk: st.atk, hp: st.hp, skillMul: st.skillMul, cdMul: st.cdMul, ultGain: st.ultGain, grade: st.grade }, maxHp: P.maxHp, ult: P.ult, mp: P.mp, cd0: P.cds[0], skill0: { name: sk.name, cd: sk.cd, dmg: sk.dmg }, skillLevel0: P.skillLevels[0] };
    });
    // 계측: 궁극기 충전 호출, 스킬 0 재사용 대기·피해·궁극기 게이지 표본.
    await s.page.evaluate(() => {
      const P = window.app.battle.player; window.__ultCalls = [];
      const orig = P.addUlt.bind(P);
      P.addUlt = function (n) { window.__ultCalls.push({ n, ultGain: P.stats.ultGain }); return orig(n); };
      const S = window.__cd = { max: 0, dmg: null, ultRows: [], run: true };
      const tick = () => { if (!S.run) return; const b = window.app.battle, Q = b.player; S.max = Math.max(S.max, Q.cds[0]); if (Q.skillCtx && Q.skillCtx.dmg !== undefined && S.dmg === null) S.dmg = Q.skillCtx.dmg; S.ultRows.push(Q.ult); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    rec.inject('계측 훅: player.addUlt 호출 기록·cds[0]/skillCtx.dmg/ult 표본(rAF)');
    const layout = await stageSig(s);
    await s.page.locator('.skill-btn[data-skill="0"]').tap(); rec.did('전투 HUD 스킬 버튼 .skill-btn[data-skill="0"](화염구) 실제 탭: ' + grade);
    await sleep(2300);
    const post = await s.page.evaluate(() => {
      const S = window.__cd; S.run = false;
      const P = window.app.battle.player, a = P.gradeAura, named = P.root.getObjectByName?.('GradeAura') || null;
      return { cd: { max: S.max, dmg: S.dmg, cdAfter: P.cds[0] }, ult: { before: null, after: P.ult, rowsMin: Math.min(...S.ultRows), rowsMax: Math.max(...S.ultRows) }, ultCalls: window.__ultCalls, state: P.state,
        aura: { grade: a?.grade, group: !!a?.group, visible: a?.group?.visible ?? null, ring: a?.ring?.visible ?? null, aura: a?.aura?.visible ?? null, namedFound: !!named, namedVisible: named ? named.visible : null, ringOpacity: a?.ring?.material?.opacity ?? null, auraOpacity: a?.aura?.material?.opacity ?? null } };
    });
    post.ult.before = pre.ult;
    await rec.shot(s, grade.toLowerCase() + '-844');
    const ultBase = post.ultCalls.reduce((t, c) => t + c.n / (c.ultGain || 1), 0), ultSum = post.ultCalls.reduce((t, c) => t + c.n, 0);
    return { grade, pre, post, layout, ultCalls: post.ultCalls.length, ultBaseSum: round(ultBase), ultCalledSum: round(ultSum), ultCalledPerBase: ultBase > 0 ? round(ultSum / ultBase) : null,
      castDmg: post.cd.dmg, dmgPerAtk: post.cd.dmg !== null ? round(post.cd.dmg / pre.stats.atk, 4) : null, measuredCd: post.cd.max };
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}
async function A1(browser, rec) {
  const rows = [];
  for (const grade of ['SR', 'SSR', 'SSSR']) rows.push(await a1Run(browser, rec, grade));
  const [sr, ssr, sssr] = rows;
  const table = rows.map((r) => ({ grade: r.grade, atk: r.pre.stats.atk, hp: r.pre.stats.hp, skillMul: r.pre.stats.skillMul, cdMul: r.pre.stats.cdMul, ultGain: r.pre.stats.ultGain, skill0Cd: r.pre.skill0.cd, measuredCdAfterCast: round(r.measuredCd, 3), expectedCd: round(r.pre.skill0.cd * r.pre.stats.cdMul, 3), castDmg: r.castDmg === null ? null : round(r.castDmg, 2), dmgPerAtk: r.dmgPerAtk, ultCalls: r.ultCalls, ultCalledPerBase: r.ultCalledPerBase, ultBefore: round(r.post.ult.before, 2), ultAfter: round(r.post.ult.after, 2), aura: { visible: r.post.aura.visible, ring: r.post.aura.ring, body: r.post.aura.aura } }));
  rec.obs('gradeTable', table); rec.obs('layoutSig', rows.map((r) => ({ grade: r.grade, ...r.layout }))); rec.obs('rawRows', rows);
  rec.check('3개 등급 모두 전투 stats.grade 가 요청한 등급', rows.every((r) => r.pre.stats.grade === r.grade), rows.map((r) => r.pre.stats.grade));
  const rt = (a, b) => (b ? a / b : NaN);
  rec.check('atk 비율 SSR/SR = 2/1.5 (±2%)', near(rt(ssr.pre.stats.atk, sr.pre.stats.atk), 2 / 1.5, 2 / 1.5 * 0.02), { sr: sr.pre.stats.atk, ssr: ssr.pre.stats.atk, ratio: round(rt(ssr.pre.stats.atk, sr.pre.stats.atk), 4) });
  rec.check('atk 비율 SSSR/SR = 2.6/1.5 (±2%)', near(rt(sssr.pre.stats.atk, sr.pre.stats.atk), 2.6 / 1.5, 2.6 / 1.5 * 0.02), { ratio: round(rt(sssr.pre.stats.atk, sr.pre.stats.atk), 4) });
  rec.check('hp 비율 SSR/SR = 2/1.5 (±2%)', near(rt(ssr.pre.stats.hp, sr.pre.stats.hp), 2 / 1.5, 2 / 1.5 * 0.02), { sr: sr.pre.stats.hp, ssr: ssr.pre.stats.hp, ratio: round(rt(ssr.pre.stats.hp, sr.pre.stats.hp), 4) });
  rec.check('hp 비율 SSSR/SR = 2.6/1.5 (±2%)', near(rt(sssr.pre.stats.hp, sr.pre.stats.hp), 2.6 / 1.5, 2.6 / 1.5 * 0.02), { ratio: round(rt(sssr.pre.stats.hp, sr.pre.stats.hp), 4) });
  rec.check('skillMul 1 / 1.2 / 1.45', near(sr.pre.stats.skillMul, 1, 1e-6) && near(ssr.pre.stats.skillMul, 1.2, 1e-6) && near(sssr.pre.stats.skillMul, 1.45, 1e-6), table.map((t) => t.skillMul));
  rec.check('cdMul 1 / 0.92 / 0.85', near(sr.pre.stats.cdMul, 1, 1e-6) && near(ssr.pre.stats.cdMul, 0.92, 1e-6) && near(sssr.pre.stats.cdMul, 0.85, 1e-6), table.map((t) => t.cdMul));
  rec.check('ultGain 차이 SSR-SR=0.1, SSSR-SR=0.2', near(ssr.pre.stats.ultGain - sr.pre.stats.ultGain, 0.1, 1e-6) && near(sssr.pre.stats.ultGain - sr.pre.stats.ultGain, 0.2, 1e-6), table.map((t) => t.ultGain));
  for (const r of rows) {
    rec.check(r.grade + ': 실제 스킬 탭 뒤 재사용 대기 = 기본 cd × cdMul (±0.15s, 첫 프레임 감소분 허용)', near(r.measuredCd, r.pre.skill0.cd * r.pre.stats.cdMul, 0.15), { measured: round(r.measuredCd, 3), expected: round(r.pre.skill0.cd * r.pre.stats.cdMul, 3) });
    rec.check(r.grade + ': 스킬 피해 / 공격력 = sk.dmg × 스킬 레벨 배율 × skillMul', r.castDmg !== null && near(r.dmgPerAtk, r.pre.skill0.dmg * (1 + (r.pre.skillLevel0 - 1) * 0.12) * r.pre.stats.skillMul, 0.02), { dmgPerAtk: r.dmgPerAtk, sk: r.pre.skill0, level: r.pre.skillLevel0 });
    rec.check(r.grade + ': 궁극기 충전 호출량 = 기본 충전 × ultGain(호출이 있을 때)', r.ultCalls === 0 || near(r.ultCalledPerBase, r.pre.stats.ultGain, 0.001), { calls: r.ultCalls, perBase: r.ultCalledPerBase, ultGain: r.pre.stats.ultGain });
  }
  rec.check('SSR/SSSR 스킬 피해/공격력 비율 1.2 / 1.45 (SR 대비 ±3%)', sr.dmgPerAtk && near(ssr.dmgPerAtk / sr.dmgPerAtk, 1.2, 0.036) && near(sssr.dmgPerAtk / sr.dmgPerAtk, 1.45, 0.044), { ssr: ssr.dmgPerAtk && sr.dmgPerAtk ? round(ssr.dmgPerAtk / sr.dmgPerAtk, 4) : null, sssr: sssr.dmgPerAtk && sr.dmgPerAtk ? round(sssr.dmgPerAtk / sr.dmgPerAtk, 4) : null });
  rec.check('오라 SR: 표시 없음', sr.post.aura.visible !== true && sr.post.aura.ring !== true && sr.post.aura.aura !== true, sr.post.aura);
  rec.check('오라 SSR: 링만(GradeAura 그룹·링 표시, 몸 오라 없음)', ssr.post.aura.visible === true && ssr.post.aura.ring === true && ssr.post.aura.aura === false && ssr.post.aura.namedFound, ssr.post.aura);
  rec.check('오라 SSSR: 링+몸 오라', sssr.post.aura.visible === true && sssr.post.aura.ring === true && sssr.post.aura.aura === true && sssr.post.aura.namedFound, sssr.post.aura);
}

// ---------- A2: 소환 ----------
async function A2(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight', gems: 3000, tickets: 0, ssrTickets: 2, own: ['barbarian'], ownShards: { barbarian: 5 } });
    const before = { ...await ecoSnap(s), barbarianShards: await eco(s, () => window.app.eco.hero('barbarian').shards) };
    rec.obs('before', before);
    await tapTab(s, 'gacha'); rec.did('하단 소환 탭 실제 탭');
    const ssrBtn = s.page.locator('#btn-pull-ssr');
    rec.check('소환 화면에 #btn-pull-ssr 보임', await ssrBtn.isVisible(), await ssrBtn.innerText().catch(() => null));
    rec.obs('ssrButtonText', (await ssrBtn.innerText().catch(() => '')).replace(/\s+/g, ' '));
    await rec.shot(s, 'gacha-screen');
    // SSR 확정권 소환
    await ssrBtn.tap(); rec.did('#btn-pull-ssr 실제 탭');
    await s.page.waitForSelector('#reveal.show .rcard, #reveal:not(.hidden) .rcard', { timeout: 15000 }).catch(() => {});
    await s.page.waitForTimeout(400);
    if (await s.page.locator('#btn-reveal-skip').isVisible().catch(() => false)) { await s.page.locator('#btn-reveal-skip').tap(); rec.did('#btn-reveal-skip 실제 탭'); }
    await s.page.waitForSelector('#reveal-foot:not(.hidden)', { timeout: 15000 });
    await s.page.waitForTimeout(500);
    const card1 = (await s.page.locator('.rcard .nm').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    rec.obs('ssrCard', card1); await rec.shot(s, 'reveal-ssr-ticket');
    const dup = card1.join(' ').match(/조각 \+(\d+) · 초월 (\d+)\/(\d+)/);
    rec.check('SSR 확정권 결과 카드가 "조각 +10 · 초월 n/120"', !!dup && dup[1] === '10' && dup[3] === '120', card1);
    const mid = { ...await ecoSnap(s), barbarianShards: await eco(s, () => window.app.eco.hero('barbarian').shards) };
    rec.obs('afterSsrTicket', mid);
    rec.check('확정권 1장 소모, 조각 5 → 15', mid.ssrTickets === before.ssrTickets - 1 && mid.barbarianShards === before.barbarianShards + 10, { before, mid });
    rec.check('결과 카드의 n 이 저장된 조각 수와 같다', !!dup && Number(dup[2]) === mid.barbarianShards, { card: dup && dup[2], saved: mid.barbarianShards });
    await s.page.locator('#btn-reveal-close').tap(); rec.did('#btn-reveal-close 실제 탭'); await s.page.waitForTimeout(700);
    // 보석 1회 소환
    rec.check('결과 닫기 뒤 소환 탭으로 돌아옴', await tabShown(s, 'gacha'));
    await s.page.locator('#btn-pull1').tap(); rec.did('#btn-pull1 실제 탭(소환권 0 → 보석 300)');
    await s.page.waitForSelector('.rcard', { timeout: 15000 });
    await s.page.waitForTimeout(300);
    if (await s.page.locator('#btn-reveal-skip').isVisible().catch(() => false)) { await s.page.locator('#btn-reveal-skip').tap(); rec.did('#btn-reveal-skip 실제 탭'); }
    await s.page.waitForSelector('#reveal-foot:not(.hidden)', { timeout: 15000 });
    await s.page.waitForTimeout(500);
    const card2 = (await s.page.locator('.rcard .nm').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    rec.obs('pull1Card', card2); await rec.shot(s, 'reveal-pull1');
    const after = { ...await ecoSnap(s), barbarianShards: await eco(s, () => window.app.eco.hero('barbarian').shards) };
    rec.obs('afterPull1', after);
    rec.check('1회 소환: 보석 300 소모', after.gems === mid.gems - 300 && after.tickets === 0, { mid: mid.gems, after: after.gems });
    rec.check('1회 소환 결과 카드가 있다', card2.length === 1 && card2[0].length > 0, card2);
    const dup2 = card2.join(' ').match(/조각 \+(\d+) · 초월 (\d+)\/(\d+)/);
    rec.obs('pull1IsDuplicateHero', !!dup2);
    if (dup2) rec.check('1회 소환이 중복 영웅이면 "조각 +N · 초월 n/필요" 형식', /조각 \+\d+ · 초월 \d+\/\d+/.test(card2.join(' ')), card2);
    await s.page.locator('#btn-reveal-close').tap(); await s.page.waitForTimeout(700);
    // 새로고침 뒤 유지
    const persistBefore = await s.page.evaluate(() => { const e = window.app.eco; return { ssrTickets: e.s.ssrTickets, gems: e.s.gems, heroes: Object.fromEntries(Object.entries(e.s.heroes).map(([k, h]) => [k, h.shards])) }; });
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)');
    await boot(s);
    const persistAfter = await s.page.evaluate(() => { const e = window.app.eco; return { ssrTickets: e.s.ssrTickets, gems: e.s.gems, heroes: Object.fromEntries(Object.entries(e.s.heroes).map(([k, h]) => [k, h.shards])) }; });
    rec.obs('persist', { before: persistBefore, after: persistAfter });
    rec.check('새로고침 뒤 barbarian 조각 유지(15 이상)', persistAfter.heroes.barbarian === persistBefore.heroes.barbarian && persistAfter.heroes.barbarian >= 15, { before: persistBefore.heroes.barbarian, after: persistAfter.heroes.barbarian });
    rec.check('새로고침 뒤 확정권 1장 유지', persistAfter.ssrTickets === persistBefore.ssrTickets && persistAfter.ssrTickets === 1, persistAfter.ssrTickets);
    rec.check('새로고침 뒤 보석 유지', persistAfter.gems === persistBefore.gems, { before: persistBefore.gems, after: persistAfter.gems });
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
}

// ---------- A3: 초월 ----------
const tcState = (s) => s.page.evaluate(() => {
  const go = document.querySelector('.tc-layer:not([hidden]) .tc-go');
  return { goDisabled: go ? go.disabled : null, goText: go ? go.textContent.trim() : null, routes: [...document.querySelectorAll('.tc-layer:not([hidden]) .tc-route')].map((b) => ({ route: b.dataset.route, text: b.textContent.trim(), visible: b.offsetParent !== null })),
    mats: [...document.querySelectorAll('.tc-layer:not([hidden]) .tc-mat')].map((li) => li.getAttribute('aria-label')) };
});
async function battleAtk(s) { await enterBattle(s); return s.page.evaluate(() => { const st = window.app.battle.player.stats; return { atk: st.atk, hp: st.hp, grade: st.grade, skillMul: st.skillMul }; }); }
async function A3(browser, rec) {
  // (0) SR 기준 전투 수치
  const base = await open(browser, rec);
  let srBattle;
  try {
    await boot(base); await prepareState(base, { hero: 'mage', level: 30, grade: 'SR', gold: 300000, gems: 2000, shards: 60, transcendStones: 0, tickets: 0 });
    srBattle = await battleAtk(base); rec.obs('srBattle', srBattle);
  } catch (e) { await errShot(base); throw e; } finally { await base.close(); }
  // (1) 전체 흐름 844x390
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'mage', level: 30, grade: 'SR', gold: 300000, gems: 2000, shards: 60, transcendStones: 0, tickets: 0 });
    await openGrowth(s, 'mage', '초월');
    const st0 = await tcState(s); rec.obs('transcend844', st0);
    rec.check('844: 초월석 행 .tc-route[data-route=shop-enh] 보임', st0.routes.some((r) => r.route === 'shop-enh' && r.visible), st0.routes);
    rec.check('844: 조각(60)·골드(300000)는 충분해 소환·골드 안내 버튼 없음', !st0.routes.some((r) => r.route === 'gacha' || r.route === 'shop-gold'), st0.routes);
    rec.check('844: 초월하기 비활성', st0.goDisabled === true, st0);
    await rec.shot(s, 'transcend-844');
    await s.page.locator('.tc-route[data-route="shop-enh"]').tap(); rec.did('.tc-route[data-route="shop-enh"] 실제 탭'); await s.page.waitForTimeout(700);
    rec.check('초월석 구하기 탭 → 상점 탭이 열리고 강화 탭이 선택됨', await tabShown(s, 'shop') && (await shopTabOn(s))?.id === 'enh', { shop: await tabShown(s, 'shop'), tab: await shopTabOn(s) });
    await rec.shot(s, 'shop-enh-from-transcend');
    const g0 = await heroSnap(s, 'mage');
    const item = s.page.locator('.shop-item', { has: s.page.locator('.si-name', { hasText: /^초월석 ×10$/ }) });
    rec.check('상점에 "초월석 ×10" 상품이 있다', await item.count() === 1, await item.count());
    await item.locator('button').tap(); rec.did('"초월석 ×10" 상품 보석 버튼 실제 탭'); await s.page.waitForTimeout(800);
    await closeModals(s.page);
    const g1 = await heroSnap(s, 'mage');
    rec.obs('afterBuyStones', g1);
    rec.check('보석 900 감소, 초월석 10', g0.gems - g1.gems === 900 && g1.transcendStones === 10, { gems: [g0.gems, g1.gems], stones: g1.transcendStones });
    await openGrowth(s, 'mage', '초월');
    const st2 = await tcState(s); rec.obs('transcendReady', st2);
    rec.check('재료 충족 → 초월하기 활성, 안내 버튼 없음', st2.goDisabled === false && st2.routes.length === 0, st2);
    await rec.shot(s, 'transcend-ready');
    await s.page.locator('.tc-go').tap(); rec.did('.tc-go(초월하기) 실제 탭'); await s.page.waitForTimeout(500);
    rec.obs('confirmText', await modalText(s));
    await tapModal(s, '#m-ok'); rec.did('확인 모달 #m-ok 실제 탭'); await s.page.waitForTimeout(600);
    const g2 = await heroSnap(s, 'mage');
    rec.obs('afterTranscend', g2); await rec.shot(s, 'transcend-done');
    rec.check('grade SSR, 재료 소모(조각 60·초월석 10·골드 300000)', g2.grade === 'SSR' && g2.shards === 0 && g2.transcendStones === 0 && g2.gold === 0, g2);
    await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)'); await boot(s);
    const g3 = await heroSnap(s, 'mage'); rec.obs('afterReload', g3);
    rec.check('새로고침 뒤 grade SSR 유지', g3.grade === 'SSR', g3.grade);
    const ssrBattle = await battleAtk(s); rec.obs('ssrBattle', ssrBattle);
    rec.check('전투 stats.grade SSR', ssrBattle.grade === 'SSR', ssrBattle);
    rec.check('전투 atk 가 SR 때의 2/1.5 배 (±2%)', near(ssrBattle.atk / srBattle.atk, 2 / 1.5, 2 / 1.5 * 0.02), { sr: srBattle.atk, ssr: ssrBattle.atk, ratio: round(ssrBattle.atk / srBattle.atk, 4) });
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  // (1b) 1280x590 초월 화면(새 컨텍스트)
  const w = await open(browser, rec, WIDE);
  try {
    await boot(w); await prepareState(w, { hero: 'mage', level: 30, grade: 'SR', gold: 300000, gems: 2000, shards: 60, transcendStones: 0, tickets: 0 });
    await openGrowth(w, 'mage', '초월');
    const st1 = await tcState(w); rec.obs('transcend1280', st1);
    rec.check('1280: .tc-route[data-route=shop-enh] 보임·초월하기 비활성', st1.routes.some((r) => r.route === 'shop-enh' && r.visible) && st1.goDisabled === true, st1);
    await rec.shot(w, 'transcend-1280');
  } catch (e) { await errShot(w); throw e; } finally { await w.close(); }
  // (2) 부족 재료별 안내 이동
  const t = await open(browser, rec);
  try {
    await boot(t); await prepareState(t, { hero: 'mage', level: 30, grade: 'SR', gold: 0, gems: 2000, shards: 0, transcendStones: 0, tickets: 0 });
    await openGrowth(t, 'mage', '초월');
    const st = await tcState(t); rec.obs('shortAll', st);
    rec.check('조각·초월석·골드 모두 부족: 안내 버튼 gacha / shop-enh / shop-gold 3개', ['gacha', 'shop-enh', 'shop-gold'].every((k) => st.routes.some((r) => r.route === k && r.visible)), st.routes);
    await rec.shot(t, 'transcend-short-all');
    await t.page.locator('.tc-route[data-route="gacha"]').tap(); rec.did('.tc-route[data-route="gacha"] 실제 탭'); await t.page.waitForTimeout(700);
    rec.check('조각 부족 안내 → 소환 탭 열림', await tabShown(t, 'gacha'));
    await rec.shot(t, 'route-gacha');
    await openGrowth(t, 'mage', '초월');
    await t.page.locator('.tc-route[data-route="shop-gold"]').tap(); rec.did('.tc-route[data-route="shop-gold"] 실제 탭'); await t.page.waitForTimeout(700);
    rec.check('골드 부족 안내 → 상점 골드 탭 열림', await tabShown(t, 'shop') && (await shopTabOn(t))?.id === 'gold', { tab: await shopTabOn(t) });
    await rec.shot(t, 'route-shop-gold');
  } catch (e) { await errShot(t); throw e; } finally { await t.close(); }
}

// ---------- A4: 상점 ----------
async function shopSnapshot(s) {
  return s.page.evaluate(() => ({ items: [...document.querySelectorAll('#shop-grid .shop-item')].map((d) => ({ name: d.querySelector('.si-name')?.textContent.trim(), flow: d.querySelector('.si-flow')?.textContent.trim() || null, role: d.querySelector('.si-flow')?.dataset.role || null, cash: /결제 준비 중/.test(d.textContent) })) }));
}
// #shop-flow 칩이 상점 패널 머리(.panel-head) 아래에서 잘리지 않고 완전히 보이는지(첫 .sf-step top >= panel-head bottom, 칩 전체가 뷰포트 안).
const flowClip = (s) => s.page.evaluate(() => {
  const head = document.querySelector('#tab-shop .panel-head'), steps = [...document.querySelectorAll('#shop-flow .sf-step')], row = document.getElementById('shop-flow');
  if (!head || !steps.length) return { ok: false, reason: 'missing', head: !!head, steps: steps.length };
  const hb = head.getBoundingClientRect().bottom, rects = steps.map((b) => b.getBoundingClientRect()), rr = row.getBoundingClientRect();
  return { headBottom: Math.round(hb * 10) / 10, firstStepTop: Math.round(rects[0].top * 10) / 10, minTop: Math.round(Math.min(...rects.map((r) => r.top)) * 10) / 10, maxBottom: Math.round(Math.max(...rects.map((r) => r.bottom)) * 10) / 10, rowTop: Math.round(rr.top * 10) / 10, viewportH: innerHeight, viewportW: innerWidth, minLeft: Math.round(Math.min(...rects.map((r) => r.left)) * 10) / 10, maxRight: Math.round(Math.max(...rects.map((r) => r.right)) * 10) / 10,
    ok: rects[0].top >= hb - 0.5 && Math.min(...rects.map((r) => r.top)) >= hb - 0.5 && Math.max(...rects.map((r) => r.bottom)) <= innerHeight + 0.5 && Math.min(...rects.map((r) => r.left)) >= -0.5 && Math.max(...rects.map((r) => r.right)) <= innerWidth + 0.5 };
});

async function A4(browser, rec) {
  const s = await open(browser, rec);
  try {
    await boot(s); await prepareState(s, { hero: 'knight', gems: 1500, transcendStones: 0, tickets: 5 });
    await tapTab(s, 'shop'); rec.did('하단 상점 탭 실제 탭');
    const flow = await s.page.evaluate(() => { const row = document.getElementById('shop-flow'); return { present: !!row && row.offsetParent !== null, steps: [...(row?.querySelectorAll('.sf-step') || [])].map((b) => ({ step: b.dataset.step, text: b.textContent.trim().replace(/\s+/g, ' '), visible: b.offsetParent !== null })) }; });
    rec.obs('flow844', flow);
    rec.check('844: #shop-flow 에 5단계(gems,summon,shards,transcend,battle) 보임', flow.present && flow.steps.map((x) => x.step).join() === 'gems,summon,shards,transcend,battle' && flow.steps.every((x) => x.visible), flow);
    const clip844 = await flowClip(s); rec.obs('flowClip844', clip844);
    rec.check('844: 흐름 칩이 패널 머리 아래에 완전히 보임(첫 .sf-step top >= .panel-head bottom, 칩 전체가 화면 안)', clip844.ok, clip844);
    await rec.shot(s, 'shop-flow-844');
    // 탭별 .si-flow
    const perTab = {};
    for (const [id, name] of [['hot', '추천'], ['gem', '보석'], ['pack', '패키지'], ['enh', '강화'], ['gold', '골드'], ['energy', '에너지']]) {
      await s.page.locator('#shop-tabs button[data-t="' + id + '"]').tap(); await s.page.waitForTimeout(450);
      perTab[id] = await shopSnapshot(s); await rec.shot(s, 'shop-tab-' + id);
      const items = perTab[id].items;
      rec.check(name + ' 탭: 모든 상품에 .si-flow (' + items.length + '개)', items.length > 0 && items.every((i) => i.flow), items.filter((i) => !i.flow).map((i) => i.name));
    }
    rec.obs('perTab', perTab);
    // 현금 상품
    const cash = [['gem', '보석 300', null], ['pack', 'SSSR 초월 성장 패키지', null], ['hot', '스타터 팩', null]];
    for (const [tab, name] of cash) {
      await s.page.locator('#shop-tabs button[data-t="' + tab + '"]').tap(); await s.page.waitForTimeout(450);
      const item = s.page.locator('#shop-grid .shop-item', { has: s.page.locator('.si-name', { hasText: new RegExp('^' + name + '$') }) });
      if (await item.count() !== 1) { rec.check('현금 상품 "' + name + '" 이 ' + tab + ' 탭에 있다', false, await item.count()); continue; }
      const itemText = (await item.innerText()).replace(/\s+/g, ' ');
      const b = await ecoSnap(s);
      await item.locator('button').tap(); rec.did('현금 상품 버튼 실제 탭: ' + name); await s.page.waitForTimeout(600);
      const mt = (await modalText(s)).replace(/\s+/g, ' ');
      rec.obs('cash-' + name, { itemText, modal: mt });
      await rec.shot(s, 'paysheet-' + tab);
      rec.check(name + ': 모달에 "유료 구매 준비 중", 상품 카드에 "결제 준비 중"', /유료 구매 준비 중/.test(mt) && /결제 준비 중/.test(itemText), { modal: mt, itemText });
      await tapModal(s, '#p-cancel');
      const a = await ecoSnap(s);
      rec.check(name + ': 탭 전후 gems·transcendStones·purchases·spentKRW 동일', a.gems === b.gems && a.transcendStones === b.transcendStones && a.purchases === b.purchases && a.spentKRW === b.spentKRW, { before: b, after: a });
    }
    // 초월 단계 탭 → 초월 화면
    await s.page.locator('#shop-flow .sf-step[data-step="transcend"]').tap(); rec.did('#shop-flow 초월 단계 실제 탭'); await s.page.waitForTimeout(700);
    rec.check('#shop-flow 초월 단계 → 초월 화면 열림', await s.page.locator('.tc-layer:not([hidden]) .tc-go').isVisible().catch(() => false));
    await rec.shot(s, 'flow-transcend-opened');
  } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  // 1280x590 상점 흐름 줄(새 컨텍스트)
  const w = await open(browser, rec, WIDE);
  try {
    await boot(w); await prepareState(w, { hero: 'knight', gems: 1500, tickets: 5 });
    await tapTab(w, 'shop');
    const flowW = await w.page.evaluate(() => [...document.querySelectorAll('#shop-flow .sf-step')].map((b) => ({ step: b.dataset.step, visible: b.offsetParent !== null })));
    rec.obs('flow1280', flowW); rec.check('1280: #shop-flow 5단계 보임', flowW.length === 5 && flowW.every((x) => x.visible), flowW);
    const clip1280 = await flowClip(w); rec.obs('flowClip1280', clip1280);
    rec.check('1280: 흐름 칩이 패널 머리 아래에 완전히 보임(첫 .sf-step top >= .panel-head bottom, 칩 전체가 화면 안)', clip1280.ok, clip1280);
    await rec.shot(w, 'shop-flow-1280');
    const rolesW = await shopSnapshot(w); rec.check('1280: 추천 탭 상품에 .si-flow', rolesW.items.length > 0 && rolesW.items.every((i) => i.flow), rolesW.items.filter((i) => !i.flow).map((i) => i.name));
  } catch (e) { await errShot(w); throw e; } finally { await w.close(); }
  // 보석 부족
  const t = await open(browser, rec);
  try {
    await boot(t); await prepareState(t, { hero: 'knight', gems: 0 });
    await tapTab(t, 'shop');
    await t.page.locator('#shop-tabs button[data-t="enh"]').tap(); await t.page.waitForTimeout(450);
    const item = t.page.locator('#shop-grid .shop-item', { has: t.page.locator('.si-name', { hasText: /^스킬 초기화서$/ }) });
    rec.check('강화 탭에 "스킬 초기화서"(300) 상품', await item.count() === 1, await item.count());
    const b = await ecoSnap(t);
    await item.locator('button').tap(); rec.did('"스킬 초기화서" 상품 보석 버튼 실제 탭(보석 0)'); await t.page.waitForTimeout(600);
    const mt = (await modalText(t)).replace(/\s+/g, ' '); rec.obs('shortGemsModal', mt); await rec.shot(t, 'gems-short-modal');
    rec.check('보석 부족 모달에 무료 획득처 안내와 "보석 탭 보기"', /무료/.test(mt) && /출석/.test(mt) && /보석 탭 보기/.test(mt), mt);
    await tapModal(t, '#m-ok'); rec.did('모달 "보석 탭 보기"(#m-ok) 실제 탭');
    const a = await ecoSnap(t);
    rec.check('보석 탭 보기 → 상점 보석 탭 열림', await tabShown(t, 'shop') && (await shopTabOn(t))?.id === 'gem', await shopTabOn(t));
    rec.check('부족 구매 시도에 재화·초기화서 변화 없음', a.gems === b.gems && a.skillResets === b.skillResets, { before: b, after: a });
    await rec.shot(t, 'gem-tab-after-short');
  } catch (e) { await errShot(t); throw e; } finally { await t.close(); }
}

// ---------- A5: 스킬 초기화 ----------
const spOf = (h) => h.sp.available;
async function openTree(s) { await openGrowth(s, 'mage', '스킬 트리'); }
async function learn(s, i, times = 1) {
  for (let n = 0; n < times; n++) {
    await s.page.locator('.st-icon[data-key="cell-' + i + '"]').tap(); await s.page.waitForTimeout(250);
    await s.page.locator('.st-learn').tap(); await s.page.waitForTimeout(450);
  }
}
const BASE_SKILLS = [1, 1, 1, 1, 0, 0, 0, 0];
const loadoutAwakenOk = (lo, skills) => lo.every((i) => i === -1 || skills[i] >= 1);
async function A5(browser, rec) {
  // (a) Lv12 무료 구간
  {
    const s = await open(browser, rec);
    try {
      await boot(s); await prepareState(s, { hero: 'mage', level: 12, skillResets: 1, gems: 1500 });
      const h0 = await heroSnap(s, 'mage'); await openTree(s);
      await learn(s, 0, 3); await learn(s, 1, 2); await learn(s, 4, 1);
      const h1 = await heroSnap(s, 'mage'); rec.obs('a_afterLearn', h1);
      rec.check('(a) 스킬 습득 실제 탭으로 SP 투자(7)', h1.sp.spent === 7 && h1.skills[0] === 4 && h1.skills[1] === 3 && h1.skills[4] === 1, h1);
      await rec.shot(s, 'a-before-reset');
      await s.page.locator('.st-reset').tap(); rec.did('.st-reset 실제 탭'); await s.page.waitForTimeout(500);
      const mt = (await modalText(s)).replace(/\s+/g, ' '); rec.obs('a_modal', mt);
      rec.check('(a) 모달에 "무료 초기화"(Lv.20 미만 무료)', /Lv\.20 미만이라 무료/.test(mt) && await s.page.locator('#modal.show #m-ok').innerText() === '무료 초기화', mt);
      await tapModal(s, '#m-ok'); rec.did('모달 "무료 초기화"(#m-ok) 실제 탭');
      const h2 = await heroSnap(s, 'mage'); rec.obs('a_afterReset', h2); await rec.shot(s, 'a-after-reset');
      rec.check('(a) SP 전액 복귀(available = earned, spent 0)', h2.sp.available === h2.sp.earned && h2.sp.spent === 0 && h2.sp.available === h0.sp.available, { h0: h0.sp, h2: h2.sp });
      rec.check('(a) 무료 초기화라 초기화서·보석 그대로', h2.skillResets === h1.skillResets && h2.gems === h1.gems, { before: [h1.skillResets, h1.gems], after: [h2.skillResets, h2.gems] });
      rec.check('(a) 스킬 레벨 기본값(1,1,1,1,0,0,0,0)', JSON.stringify(h2.skills) === JSON.stringify(BASE_SKILLS), h2.skills);
    } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  }
  // (b) Lv30 + 초기화서 1, 각성 스킬 Q/E 장착
  {
    const s = await open(browser, rec);
    try {
      await boot(s); await prepareState(s, { hero: 'mage', level: 30, skillResets: 1, gems: 1500 });
      await openTree(s);
      await learn(s, 0, 2); await learn(s, 4, 3); await learn(s, 5, 2);
      // Q/E 장착: 습득한 각성 스킬 칸을 고르고 전투 슬롯 버튼을 실제 탭한다.
      await s.page.locator('.st-icon[data-key="cell-4"]').tap(); await s.page.waitForTimeout(250);
      await s.page.locator('.st-equip-btn[data-key="equip-Q"]').tap(); await s.page.waitForTimeout(350);
      await s.page.locator('.st-icon[data-key="cell-5"]').tap(); await s.page.waitForTimeout(250);
      await s.page.locator('.st-equip-btn[data-key="equip-E"]').tap(); await s.page.waitForTimeout(350);
      rec.did('각성 스킬 칸 탭 → 전투 슬롯 .st-equip-btn Q/E 실제 탭(장착 UI 경로 있음)');
      const h1 = await heroSnap(s, 'mage'); rec.obs('b_beforeReset', h1); await rec.shot(s, 'b-before-reset');
      rec.check('(b) Q=cell4, E=cell5 장착됨', h1.loadout[0] === 4 && h1.loadout[1] === 5 && h1.skills[4] === 3 && h1.skills[5] === 2, { loadout: h1.loadout, skills: h1.skills });
      await s.page.locator('.st-reset').tap(); await s.page.waitForTimeout(500);
      const mt = (await modalText(s)).replace(/\s+/g, ' '); rec.obs('b_modal', mt);
      rec.check('(b) 모달 "초기화서 사용"(보유 1개)', /스킬 초기화서 1개를 사용합니다 \(보유 1개\)/.test(mt) && await s.page.locator('#modal.show #m-ok').innerText() === '초기화서 사용', mt);
      await tapModal(s, '#m-ok'); rec.did('모달 "초기화서 사용"(#m-ok) 실제 탭');
      const h2 = await heroSnap(s, 'mage'); rec.obs('b_afterReset', h2); await rec.shot(s, 'b-after-reset');
      rec.check('(b) skillResets 1 → 0', h1.skillResets === 1 && h2.skillResets === 0, [h1.skillResets, h2.skillResets]);
      rec.check('(b) 반환 SP = 투자 SP, 전부 복귀', h2.sp.spent === 0 && h2.sp.available === h1.sp.available + h1.sp.spent && h2.sp.available === h2.sp.earned, { before: h1.sp, after: h2.sp });
      rec.check('(b) 각성 슬롯 -1(해제)', JSON.stringify(h2.loadout) === JSON.stringify([-1, -1]) && JSON.stringify(h2.skills) === JSON.stringify(BASE_SKILLS), { loadout: h2.loadout, skills: h2.skills });
      rec.check('(b) 보석 변화 없음', h2.gems === h1.gems, [h1.gems, h2.gems]);
      await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)'); await boot(s);
      const h3 = await heroSnap(s, 'mage'); rec.obs('b_afterReload', h3);
      rec.check('(b) 새로고침 뒤 초기화 상태 유지', h3.skillResets === 0 && JSON.stringify(h3.loadout) === JSON.stringify([-1, -1]) && JSON.stringify(h3.skills) === JSON.stringify(BASE_SKILLS) && h3.sp.available === h3.sp.earned, h3);
    } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  }
  // (c) 초기화서 0, 보석 1000
  {
    const s = await open(browser, rec);
    try {
      await boot(s); await prepareState(s, { hero: 'mage', level: 30, skillResets: 0, gems: 1000 });
      await openTree(s); await learn(s, 0, 2);
      const h1 = await heroSnap(s, 'mage');
      await s.page.locator('.st-reset').tap(); await s.page.waitForTimeout(500);
      const mt = (await modalText(s)).replace(/\s+/g, ' '); rec.obs('c_modal', mt); await rec.shot(s, 'c-gems-modal');
      const okLabel = await s.page.locator('#modal.show #m-ok').innerText();
      rec.check('(c) 모달 "보석 300개로 초기화"', okLabel === '보석 300개로 초기화', { okLabel, mt });
      await tapModal(s, '#m-ok'); rec.did('모달 "보석 300개로 초기화"(#m-ok) 실제 탭');
      const h2 = await heroSnap(s, 'mage'); rec.obs('c_afterReset', h2);
      rec.check('(c) gems 1000 → 700, SP 전액 복귀', h1.gems === 1000 && h2.gems === 700 && h2.sp.spent === 0 && h2.sp.available === h2.sp.earned, { gems: [h1.gems, h2.gems], sp: h2.sp });
    } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  }
  // (d) 초기화서 0, 보석 0 → 상점 보기
  {
    const s = await open(browser, rec);
    try {
      await boot(s); await prepareState(s, { hero: 'mage', level: 30, skillResets: 0, gems: 0 });
      await openTree(s); await learn(s, 0, 2);
      const h1 = await heroSnap(s, 'mage');
      await s.page.locator('.st-reset').tap(); await s.page.waitForTimeout(500);
      const mt = (await modalText(s)).replace(/\s+/g, ' '); rec.obs('d_modal', mt); await rec.shot(s, 'd-shop-modal');
      rec.check('(d) 모달 "상점 보기" 안내', /상점에서 스킬 초기화서를 구할 수 있습니다/.test(mt) && await s.page.locator('#modal.show #m-ok').innerText() === '상점 보기', mt);
      await tapModal(s, '#m-ok'); rec.did('모달 "상점 보기"(#m-ok) 실제 탭'); await s.page.waitForTimeout(500);
      const h2 = await heroSnap(s, 'mage');
      rec.check('(d) 상점 강화 탭 열림', await tabShown(s, 'shop') && (await shopTabOn(s))?.id === 'enh', await shopTabOn(s));
      rec.check('(d) 스킬·보석·초기화서 변화 없음', JSON.stringify(h2.skills) === JSON.stringify(h1.skills) && h2.gems === 0 && h2.skillResets === 0, { before: h1.skills, after: h2.skills });
      await rec.shot(s, 'd-shop-opened');
    } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  }
  // (e) 저장 실패 주입
  {
    const s = await open(browser, rec);
    try {
      await boot(s); await prepareState(s, { hero: 'mage', level: 12, skillResets: 1, gems: 700 });
      await openTree(s); await learn(s, 0, 2); await learn(s, 4, 1);
      const h1 = await heroSnap(s, 'mage'); rec.obs('e_before', h1);
      await s.page.evaluate((key) => { const orig = Storage.prototype.setItem; window.__origSetItem = orig; Storage.prototype.setItem = function (k, v) { if (String(k).indexOf(key) === 0) throw new DOMException('QuotaExceededError', 'QuotaExceededError'); return orig.call(this, k, v); }; }, SAVE_KEY);
      rec.inject('저장 실패 주입: Storage.prototype.setItem 이 bladesurge_save_v1* 키에 QuotaExceededError 를 던짐(초기화 탭 직전~토스트 확인 뒤 해제)');
      await s.page.locator('.st-reset').tap(); await s.page.waitForTimeout(500);
      await tapModal(s, '#m-ok'); rec.did('모달 "무료 초기화"(#m-ok) 실제 탭(저장 실패 중)');
      await s.page.waitForTimeout(500);
      const toasts = await toastLog(s); const h2 = await heroSnap(s, 'mage');
      await s.page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
      rec.obs('e_toasts', toasts); rec.obs('e_after', h2); await rec.shot(s, 'e-save-failed');
      rec.check('(e) 토스트 "저장하지 못해 초기화를 취소했습니다"', toasts.some((t) => /저장하지 못해/.test(t)), toasts);
      rec.check('(e) skills·gems·skillResets 원상태', JSON.stringify(h2.skills) === JSON.stringify(h1.skills) && h2.gems === h1.gems && h2.skillResets === h1.skillResets && JSON.stringify(h2.loadout) === JSON.stringify(h1.loadout), { before: h1, after: h2 });
      rec.check('(e) SP 투자 상태 유지(spent 그대로)', h2.sp.spent === h1.sp.spent, [h1.sp.spent, h2.sp.spent]);
    } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
  }
  // (f) SP 도입 전 저장 픽스처
  {
    const mk = await open(browser, rec);
    let raw;
    try { await boot(mk); await prepareState(mk, { hero: 'mage', level: 5, skillResets: 0, gems: 100 }); raw = await mk.page.evaluate((key) => localStorage.getItem(key), SAVE_KEY); } catch (e) { await errShot(mk); throw e; } finally { await mk.close(); }
    for (const variant of ['gradeless', 'gradeful']) {
      const save = JSON.parse(raw);
      save.heroes.mage.level = 5; save.heroes.mage.skills = [6, 6, 6, 6, 0, 0, 0, 0]; delete save.heroes.mage.spBonus;
      if (variant === 'gradeless') delete save.heroes.mage.grade;
      const init = '(() => { if (!sessionStorage.getItem("__qaFixture")) { sessionStorage.setItem("__qaFixture", "1"); localStorage.removeItem(' + JSON.stringify(SAVE_KEY + '_backup') + '); localStorage.setItem(' + JSON.stringify(SAVE_KEY) + ', ' + JSON.stringify(JSON.stringify(save)) + '); } })();';
      const s = await open(browser, rec, VIEW, { initScript: init });
      try {
        rec.inject('이전 저장 픽스처(' + variant + '): ' + SAVE_KEY + ' 에 heroes.mage = level 5, skills [6,6,6,6,0,0,0,0], spBonus 필드 없음' + (variant === 'gradeless' ? ', grade 없음' : '') + ' (최초 로드 전 addInitScript 로 1회 기록)');
        await boot(s);
        const h1 = await heroSnap(s, 'mage'); rec.obs('f_' + variant + '_loaded', h1);
        const bonus = await eco(s, () => window.app.eco.skillPoints('mage').bonus);
        rec.check('(f/' + variant + ') 로드 뒤 skillPoints.bonus > 0 (21 = 투자 28 - Lv5 획득 7)', bonus > 0 && bonus === 21, { bonus, sp: h1.sp });
        rec.check('(f/' + variant + ') 초과 스킬 레벨은 그대로(6,6,6,6)', JSON.stringify(h1.skills.slice(0, 4)) === '[6,6,6,6]', h1.skills);
        rec.check('(f/' + variant + ') 남은 SP 음수 아님(available = earned+bonus-spent = 0)', h1.sp.available === 0 && h1.sp.spent === 28, h1.sp);
        await openTree(s); await rec.shot(s, 'f-' + variant + '-tree');
        await s.page.locator('.st-reset').tap(); await s.page.waitForTimeout(500);
        const mt = (await modalText(s)).replace(/\s+/g, ' ');
        rec.check('(f/' + variant + ') Lv5 무료 초기화 모달(돌려받는 SP 28)', /스킬 포인트 28/.test(mt) && /무료/.test(mt), mt);
        await tapModal(s, '#m-ok'); rec.did('모달 "무료 초기화"(#m-ok) 실제 탭');
        const h2 = await heroSnap(s, 'mage'); rec.obs('f_' + variant + '_afterReset', h2);
        rec.check('(f/' + variant + ') 초기화 뒤에도 bonus 21 유지, available = 전체 예산(레벨 획득 7 + bonus 21 = 28, skillPoints.earned 는 예산 포함값)', h2.sp.bonus === 21 && h2.sp.earned === 28 && h2.sp.earned - h2.sp.bonus === 7 && h2.sp.available === 28 && h2.sp.spent === 0, h2.sp);
        await s.page.reload({ waitUntil: 'domcontentloaded' }); rec.did('새로고침(page.reload)'); await boot(s);
        const h3 = await heroSnap(s, 'mage'); rec.obs('f_' + variant + '_afterReload', h3);
        rec.check('(f/' + variant + ') 새로고침 뒤에도 bonus 21·available 28', h3.sp.bonus === 21 && h3.sp.available === 28, h3.sp);
      } catch (e) { await errShot(s); throw e; } finally { await s.close(); }
    }
  }
}

// ---------- 러너 ----------
const CRITERIA = {
  A1: ['등급 SR/SSR/SSSR 같은 시드 전투 수치·재사용 대기·궁극기 충전·오라', A1],
  A2: ['소환 SSR 확정권·1회 소환·중복 조각 표시·저장', A2],
  A3: ['초월 재료 안내·상점 초월석 구매·SR→SSR 초월·전투 수치', A3],
  A4: ['상점 성장 흐름 줄·상품 용도·현금 상품 결제 준비 중·보석 부족 안내', A4],
  A5: ['스킬 초기화(무료/초기화서/보석/상점/저장 실패/이전 저장)', A5],
};
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
  summary.criteria[id] = { pass: rec.pass, checks: rec.checks.length, failedChecks: rec.checks.filter((c) => !c.ok).map((c) => c.name), pageErrors: rec.pageErrors.length };
  if (!rec.pass) failed = true;
  console.log(id, rec.pass ? 'PASS' : 'FAIL', rec.checks.filter((c) => !c.ok).map((c) => c.name).join(' | '), rec.pageErrors.length ? '(pageErrors ' + rec.pageErrors.length + ')' : '');
}
await browser.close();
summary.finished = new Date().toISOString(); summary.pass = !failed;
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
process.exit(failed ? 1 : 0);
