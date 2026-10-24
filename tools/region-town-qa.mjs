// 지역 마을 해금(docs/region-dungeon-unlock.md) 실제 입력 검증.
// 사용법: node tools/region-town-qa.mjs [origin=http://127.0.0.1:5193/] [out=work/region-town-qa] [--only=fresh,arrived,legacy,clear] [--vp=1280x720]
// 시나리오
//  fresh   : 아무 시드 없는 새 저장(Lv.1). 로비 카드 줄·'다른 던전' 수·3D 관문·다른 던전 목록·마을 둘러보기 관문을 읽는다.
//  arrived : 1-10 을 클리어했고 아직 해금 축하를 못 본 저장(celebrated=1). 부팅 직후 새 마을 도착 띠와 지역 2 카드·관문.
//  legacy  : 캠페인은 안 하고 잿불 금고만 깬 옛 저장(regionGate 없음). 기록 있는 던전이 숨지 않는지.
//  clear   : 1-9 클리어 저장에서 실제 터치로 1-10 출격 → AUTO 가속 전투 → 결과 → 로비 복귀 → 도착 띠·새 관문 솟아오름·새 카드.
// 고정값(테스트 훅): 저장 시드(진행도·기사 45레벨·튜토리얼 완료)만 넣는다. 위치·체력·피해·승리는 바꾸지 않는다. 전투만 app.step(1/60) 가속.
// 결과는 viewport/터치 에뮬과 SwiftShader 소프트웨어 렌더 관측이며 실기기·GPU 프레임 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5193/', out = path.resolve(positional[1] || 'work/region-town-qa');
const only = (args.find((a) => a.startsWith('--only='))?.split('=')[1] || 'fresh,arrived,legacy,clear').split(',');
const [VW, VH] = (args.find((a) => a.startsWith('--vp='))?.split('=')[1] || '1280x720').split('x').map(Number);
const touch = VW < 1000 || VH < 500;
await fs.mkdir(out, { recursive: true });
const KEY = 'bladesurge_save_v1';
const tag = `${VW}x${VH}`;
const report = { started: new Date().toISOString(), origin, viewport: `${tag}${touch ? ' dsf2 touch' : ' dsf1'}`, checks: [], shots: [], observations: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const stars = (codes) => Object.fromEntries(codes.map((code) => [code, 3]));
const region = (ch, n = 10) => Array.from({ length: n }, (_, i) => `${ch}-${i + 1}`);
const today = Math.floor(Date.now() / 86400000);
const seedSave = (unlocked, codes, extra = {}) => ({ progress: { unlocked, stars: stars(codes), difficulty: 'story' }, heroes: { knight: { level: 45 } }, tutorial: { completed: true }, guide: { seen: true }, daily: { day: 0, last: today }, ...extra });

const browser = await chromium.launch(launchOpts());
async function open(name, seed) {
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, locale: 'ko-KR', serviceWorkers: 'block' });
  if (seed) await context.addInitScript(([key, data]) => { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } }, [KEY, seed]);
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(name + ': ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GLTFLoader|net::/.test(m.text())) report.errors.push(name + ': ' + m.text().slice(0, 300)); });
  const shot = async (label) => { const file = `${tag}-${name}-${label}.png`; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.shots.push(file); return file; };
  const tap = async (selector, timeout = 20000) => {
    const target = page.locator(selector).first();
    if (!touch) return target.click({ timeout });
    try { await target.tap({ timeout }); } catch (error) {
      if (/performing tap action/.test(String(error.message))) { await page.waitForTimeout(800); return; }
      const box = await target.boundingBox(); if (!box) throw error; await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
  };
  const boot = async () => {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
    await page.waitForTimeout(1500);
    for (let n = 0; n < 5; n++) { if (!await page.locator('#modal.show #m-cancel').isVisible().catch(() => false)) break; await tap('#modal.show #m-cancel'); await page.waitForTimeout(300); }
    await dismissRotate();
  };
  // 세로 화면 안내('가로로 돌려주세요')는 로비에서 다시 뜬다. '세로로 계속하기'를 실제로 눌러 닫는다.
  const dismissRotate = async () => { const b = page.locator('#rotate-hint #btn-ignore-rotate'); if (await b.isVisible().catch(() => false)) { await tap('#rotate-hint #btn-ignore-rotate'); await page.waitForTimeout(300); } };
  return { context, page, shot, tap, boot, dismissRotate };
}

// 로비가 지금 보여 주는 것: 카드 줄, '다른 던전' 링크, 3D 관문(걷기 판정과 같은 핫스팟), 마을 칩.
const readLobby = (page) => page.evaluate(() => {
  const app = window.app, hall = app.arena.lobbyHall?.userData;
  return {
    town: app.eco.campaignTownState(), chip: document.querySelector('#campaign-town-chip b')?.textContent,
    cards: [...document.querySelectorAll('#citadel-command .dl-pick')].map((n) => n.dataset.dungeonId),
    other: document.querySelector('#citadel-other-dungeons')?.textContent,
    selected: document.querySelector('#citadel-command .dl-name')?.textContent,
    gates: (hall?.hotspots || []).filter((s) => s.kind === 'dungeon').map((s) => s.route),
    walkGates: (app.hubMovement?.hotspots || []).filter((s) => s.kind === 'dungeon').map((s) => s.route),
    rising: hall?.risingGates?.() ?? null, emerging: hall?.emergingIds || [],
    arrival: (document.querySelector('.town-arrival-banner[data-qa-held]') || document.querySelector('.town-arrival-banner'))?.textContent || null,
    arrivalBox: (() => { const n = document.querySelector('.town-arrival-banner[data-qa-held]') || document.querySelector('.town-arrival-banner'); if (!n) return null; const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; })(),
  };
});
async function holdBanners(page) {
  await page.evaluate(() => {
    if (window.__qaHold) return; window.__qaHold = true;
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof HTMLElement) || n.dataset.qaHeld || !n.matches('.region-unlock-banner, .town-arrival-banner')) continue;
      const c = n.cloneNode(true); c.dataset.qaHeld = '1'; c.style.animation = 'none'; c.style.opacity = '1'; n.after(c);
    } }).observe(document.body, { childList: true, subtree: true });
  });
}
const release = (page) => page.evaluate(() => document.querySelectorAll('[data-qa-held]').forEach((n) => n.remove()));
// '다른 던전' 목록(기존 원정 목록)의 기본 원정 카드와 예고 줄.
async function readList(t) {
  await t.dismissRotate();
  await t.tap('#citadel-other-dungeons'); await t.page.waitForTimeout(1200);
  await t.page.evaluate(() => { const d = document.querySelector('.exp-dungeon-details'); if (d) d.open = true; document.querySelector('.exp-region-teaser')?.scrollIntoView({ block: 'center' }); });
  await t.page.waitForTimeout(500);
  return t.page.evaluate(() => ({
    cards: [...document.querySelectorAll('.exp-dungeon[data-depth="standard"]:not(.exp-region-teaser)')].map((n) => n.dataset.dungeon),
    teaser: document.querySelector('.exp-region-teaser')?.textContent?.replace(/\s+/g, ' ') || null,
    journey: [...document.querySelectorAll('.journey-node')].map((n) => n.dataset.journeyNode),
  }));
}
async function closeList(t) { await t.page.evaluate(() => window.app.expeditionUI.close?.()); await t.page.waitForTimeout(600); }
async function explore(t, label) {
  await t.dismissRotate();
  await t.tap('#citadel-explore'); await t.page.waitForTimeout(1500);
  await t.shot(label);
  const walk = await t.page.evaluate(() => (window.app.hubMovement?.hotspots || []).filter((s) => s.kind === 'dungeon').map((s) => s.route));
  await t.page.evaluate(() => window.app.setHubWalkMode(false)); await t.page.waitForTimeout(600);
  return walk;
}

async function fight(page) {
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
  await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); });
  await page.evaluate(installMetricsDriver, { storyEvents: [] });
  for (let chunk = 0; chunk < 260; chunk++) {
    const s = await page.evaluate(() => {
      const a = window.app, b = a.battle, P = b.player;
      for (let i = 0; i < 300 && b.active; i++) {
        if (!P.alive) { a.step(1 / 60, false); if (!P.alive && b.active && (globalThis.__deadT = (globalThis.__deadT || 0) + 1) > 240) { b.revivePlayer(); a.ui.closeModal?.(); globalThis.__deadT = 0; } continue; }
        globalThis.__metricsDriver.step(1 / 60, false);
      }
      return { active: b.active, win: b.result?.win ?? null };
    });
    if (!s.active) return s;
  }
  return { timeout: true };
}

// 관문 상승 연출을 실제 앱 프레임(app.step)으로 7초 진행한다. 렌더는 마지막 한 번만.
const settleRise = (page) => page.evaluate(() => { for (let i = 0; i < 210; i++) window.app.step(1 / 30, i === 209); return window.app.arena.lobbyHall?.userData.risingGates?.(); });
const REGION1 = ['glass_garden', 'bellfall_crypt', 'rootbound_grotto', 'hollowbell_arboretum'];
try {
  if (only.includes('fresh')) {
    const t = await open('fresh', null);
    await t.boot();
    await t.shot('01-lobby');
    const lobby = await readLobby(t.page); report.observations.fresh = { lobby };
    check('새 저장: 첫 마을은 REGION 01 종지기 정원 마을', lobby.town.current === 1 && /종지기 정원 마을/.test(lobby.chip || ''), lobby.chip);
    check('새 저장: 로비 카드 줄은 지역 1 던전 4곳뿐(잿불 금고 없음)', JSON.stringify(lobby.cards) === JSON.stringify(REGION1), lobby.cards);
    check("새 저장: '다른 던전' 수는 보이는 던전 기준", /다른 던전 \d+\/4$/.test(lobby.other || ''), lobby.other);
    check('새 저장: 3D 관문·걷기 핫스팟도 지역 1 던전 4곳', JSON.stringify(lobby.gates) === JSON.stringify(REGION1) && JSON.stringify(lobby.walkGates) === JSON.stringify(REGION1), { gates: lobby.gates, walk: lobby.walkGates });
    const list = await readList(t); report.observations.fresh.list = list;
    await t.shot('02-other-dungeons-teaser');
    check("새 저장: '다른 던전' 목록은 지역 1 + 다음 마을 잠금 줄 하나", JSON.stringify(list.cards) === JSON.stringify(REGION1) && /불씨 용광로 마을/.test(list.teaser || '') && /1-10 클리어 시/.test(list.teaser || '') && !list.journey.includes('ember_vault'), list);
    await closeList(t);
    const walk = await explore(t, '03-explore-gates');
    check('새 저장: 마을 둘러보기 관문도 같은 4곳', JSON.stringify(walk) === JSON.stringify(REGION1), walk);
    await t.context.close();
  }

  if (only.includes('arrived')) {
    // 1-10 첫 클리어 직후 앱이 닫혀 결과 화면 축하를 못 본 저장(celebrated=1, current=2).
    const t = await open('arrived', seedSave(11, region(1), { campaignTown: { current: 2, celebrated: 1 } }));
    await t.context.addInitScript(() => {
      new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement) || n.dataset.qaHeld || !n.matches('.region-unlock-banner, .town-arrival-banner')) continue;
        const c = n.cloneNode(true); c.dataset.qaHeld = '1'; c.style.animation = 'none'; c.style.opacity = '1'; n.after(c);
      } }).observe(document, { childList: true, subtree: true });
    });
    await t.boot();
    await t.page.waitForTimeout(400);
    await t.shot('01-lobby-arrival');
    const lobby = await readLobby(t.page); report.observations.arrived = { lobby };
    check('도착: 결과 화면을 못 본 저장도 로비에서 새 관문 5곳을 솟아오르게 다시 짓는다', lobby.emerging.length === 5, { emerging: lobby.emerging, rising: lobby.rising });
    await t.page.waitForTimeout(600);
    await t.shot('01b-lobby-gates-rising');
    const left = await settleRise(t.page);
    check('도착: 앱 프레임 7초 뒤 새 관문이 모두 선다', left === 0, left);
    const region2 = ['ember_vault', 'cinder_tide_lock', 'ashforge_catacomb', 'slagwater_foundry', 'emberwake_drydock', 'sunbrass_quarry'];
    check('도착: 마을 칩이 REGION 02 불씨 용광로 마을', lobby.town.current === 2 && /불씨 용광로 마을/.test(lobby.chip || ''), lobby.chip);
    check('도착: 위쪽 가장자리 새 마을 도착 띠(새 던전 6곳)', /새 마을 도착/.test(lobby.arrival || '') && /새 던전 6곳/.test(lobby.arrival || '') && lobby.arrivalBox && lobby.arrivalBox.top <= 14 && lobby.arrivalBox.bottom <= 64, { text: lobby.arrival, box: lobby.arrivalBox });
    check('도착: 카드 줄은 새 마을 던전 6곳이 먼저, 이전 마을 4곳이 뒤', JSON.stringify(lobby.cards) === JSON.stringify([...region2, ...REGION1]), lobby.cards);
    const gates2 = region2.filter((id) => id !== 'sunbrass_quarry'); // 컨셉 던전은 관문 없는 목록 전용
    check('도착: 3D 관문은 새 마을 던전 5곳(관문 없는 컨셉 던전 제외)', JSON.stringify(lobby.gates) === JSON.stringify(gates2), lobby.gates);
    await release(t.page);
    await t.page.waitForTimeout(300);
    await t.shot('02-lobby-region2-cards');
    const walk = await explore(t, '03-explore-region2-gates');
    check('도착: 마을 둘러보기 관문도 같은 5곳', JSON.stringify(walk) === JSON.stringify(gates2), walk);
    await t.context.close();
  }

  if (only.includes('legacy')) {
    const t = await open('legacy', { progress: { unlocked: 1, stars: {}, difficulty: 'story' }, heroes: { knight: { level: 12 } }, tutorial: { completed: true }, guide: { seen: true }, daily: { day: 0, last: today },
      expedition: { level: 6, stats: { glass_garden: 4, ember_vault: 2 }, depthWins: {} } });
    await t.boot();
    await t.shot('01-lobby-legacy');
    const lobby = await readLobby(t.page);
    const kept = await t.page.evaluate(() => window.app.eco.s.regionGate);
    report.observations.legacy = { lobby, kept };
    check('옛 저장: 깬 잿불 금고는 캠페인 전이라도 카드·관문에 남는다', lobby.cards.includes('ember_vault') && lobby.gates.includes('ember_vault') && kept?.kept?.includes('ember_vault'), { cards: lobby.cards, gates: lobby.gates, kept });
    check('옛 저장: 기록 없는 다음 지역 던전은 숨는다', !lobby.cards.includes('cinder_tide_lock') && !lobby.cards.includes('star_archive'), lobby.cards);
    await t.context.close();
  }

  if (only.includes('clear')) {
    const t = await open('clear', seedSave(10, region(1, 9)));
    await t.boot();
    await holdBanners(t.page);
    const before = await readLobby(t.page);
    await t.shot('01-lobby-before');
    check('1-10 전: 지역 1 카드·관문', JSON.stringify(before.cards) === JSON.stringify(REGION1) && JSON.stringify(before.gates) === JSON.stringify(REGION1), before);
    await t.tap('#meta .oath-nav-menu'); await t.page.waitForTimeout(500);
    await t.tap('#oath-menu [data-tab="stage"]'); await t.page.waitForTimeout(900);
    if (await t.page.evaluate(() => window.app.meta.tab) !== 'stage') await t.page.evaluate(() => window.app.meta.openTab('stage'));
    await t.tap('#stage-grid [data-stage="1-10"]'); await t.page.waitForTimeout(400);
    await t.tap('#st-go'); await t.page.waitForTimeout(500);
    const end = await fight(t.page);
    await t.page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); });
    await t.page.waitForSelector('.region-unlock-banner[data-qa-held]', { timeout: 30000, state: 'attached' }).catch(() => {});
    await t.page.waitForTimeout(500);
    await t.shot('02-result-unlock');
    const res = await t.page.evaluate(() => ({ banner: document.querySelector('.region-unlock-banner[data-qa-held]')?.textContent, state: window.app.eco.campaignTownState() }));
    check('1-10 첫 클리어: 결과 화면 위쪽 띠 "새 지역 해금"과 새 마을 이동 안내', end.win === true && /새 지역 해금 · 불씨 용광로 마을/.test(res.banner || '') && /새 마을로 이동/.test(res.banner || ''), { end, res });
    await release(t.page);
    await t.page.evaluate(() => { window.app.testPause = false; });
    await t.page.waitForTimeout(4600);
    await t.tap('#btn-result-lobby');
    await t.page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 60000 });
    await t.page.waitForTimeout(700);
    await t.shot('03-lobby-arrival-veil');
    const arrive = await readLobby(t.page);
    await t.page.waitForTimeout(1300);
    await t.shot('04-lobby-gates-rising');
    const mid = await readLobby(t.page);
    // 상승 연출은 실제 시간(약 5초) 기준이다. SwiftShader 헤드리스는 로비 프레임이 몇 초에 한 번이라, 전투처럼 app.step(1/30) 으로 7초를 가속한다.
    await settleRise(t.page);
    await t.shot('05-lobby-new-town');
    const after = await readLobby(t.page);
    report.observations.clear = { before, arrive, mid, after };
    check('로비 복귀: 새 마을 도착 띠', /새 마을 도착/.test(arrive.arrival || '') && /불씨 용광로 마을/.test(arrive.arrival || ''), arrive.arrival);
    check('로비 복귀: 새 관문 5곳이 솟아오르는 중으로 지어진다', arrive.emerging.length === 5 && (arrive.rising > 0 || mid.rising > 0), { emerging: arrive.emerging, rising: [arrive.rising, mid.rising] });
    check('로비 복귀: 연출이 끝나면 관문이 모두 선다', after.rising === 0, after.rising);
    check('로비 복귀: 새 마을 카드가 먼저 보이고 추천도 새 마을 던전', after.cards[0] === 'ember_vault' && after.cards.length === 10 && after.town.current === 2, { cards: after.cards, selected: after.selected });
    await t.context.close();
  }
} catch (error) {
  report.errors.push(String(error.stack || error).slice(0, 800)); console.error(error);
} finally {
  await browser.close();
  report.finished = new Date().toISOString();
  report.failures = report.checks.filter((c) => !c.ok).length;
  await fs.writeFile(path.join(out, `report-${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, errors: report.errors.length, out }, null, 1));
  process.exitCode = report.failures || report.errors.length ? 1 : 0;
}
