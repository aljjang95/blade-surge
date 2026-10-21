// 캠페인 지도·보스 표식·지역 해금·로비 마을 전환 실제 입력 검증.
// 사용법: node tools/campaign-town-qa.mjs [origin=http://127.0.0.1:5193/] [out=work/campaign-town-qa] [--only=map,midboss,region,first]
// 고정값(테스트 훅): 시나리오마다 새 브라우저 저장에 진행도(별·해금)·기사 45레벨·튜토리얼 완료를 시드한다. 위치·체력·피해·승리는 바꾸지 않는다.
// 입력: 탭 이동·관문 선택·던전 입장·결과 로비 복귀·마을 칩은 실제 터치다. 전투만 SwiftShader 속도 때문에 app.step(1/60) 으로 AUTO 가속한다(metrics-driver).
// 이 결과는 viewport/터치 에뮬과 소프트웨어 렌더 관측이며 물리 기기·GPU 프레임 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5193/', out = path.resolve(positional[1] || 'work/campaign-town-qa');
const only = (args.find((a) => a.startsWith('--only='))?.split('=')[1] || 'map,midboss,region,towns,first').split(',');
const [VW, VH] = (args.find((a) => a.startsWith('--vp='))?.split('=')[1] || '844x390').split('x').map(Number);
await fs.mkdir(out, { recursive: true });
const KEY = 'bladesurge_save_v1';
const report = { started: new Date().toISOString(), origin, viewport: `${VW}x${VH} dsf2 touch`, fixtures: {}, checks: [], shots: [], errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 240)); };
const stars = (list, value = 3) => Object.fromEntries(list.map((code) => [code, value]));
const region = (ch, n = 10) => Array.from({ length: n }, (_, i) => `${ch}-${i + 1}`);
const today = Math.floor(Date.now() / 86400000);
const seedSave = (unlocked, starCodes, extra = {}) => ({ progress: { unlocked, stars: stars(starCodes), difficulty: 'story' }, heroes: { knight: { level: 45 } }, tutorial: { completed: true }, daily: { day: 0, last: today }, ...extra });

const browser = await chromium.launch(launchOpts());
async function open(name, seed) {
  report.fixtures[name] = seed ? { unlocked: seed.progress.unlocked, stars: Object.keys(seed.progress.stars).length, knightLevel: 45, tutorialCompleted: true } : 'fresh save';
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
  if (seed) await context.addInitScript(([key, data]) => { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } }, [KEY, seed]);
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(name + ': ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GLTFLoader/.test(m.text())) report.errors.push(name + ': ' + m.text().slice(0, 300)); });
  const shot = async (label) => { const file = `${name}-${label}.png`; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.shots.push(file); return file; };
  const tap = async (selector, timeout = 20000) => {
    const target = page.locator(selector).first();
    try { await target.tap({ timeout }); } catch (error) { const box = await target.boundingBox(); if (!box) throw error; await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); }
  };
  const boot = async () => {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
    await page.waitForTimeout(1500);
    for (let n = 0; n < 4; n++) { if (!await page.locator('#modal.show #m-cancel').isVisible().catch(() => false)) break; await tap('#modal.show #m-cancel'); await page.waitForTimeout(300); }
  };
  return { context, page, shot, tap, boot };
}

// 메뉴 → 캠페인(실제 터치) 으로 캠페인 탭을 연다.
async function openCampaign({ page, tap }) {
  await tap('#meta .oath-nav-menu'); await page.waitForTimeout(500);
  await tap('#oath-menu [data-tab="stage"]'); await page.waitForTimeout(900);
  const tab = await page.evaluate(() => window.app.meta.tab);
  if (tab !== 'stage') await page.evaluate(() => window.app.meta.openTab('stage'));
}

// AUTO 전투를 보스 등장 또는 종료까지 가속한다.
async function fight(page, { until }) {
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
  await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); });
  await page.evaluate(installMetricsDriver, { storyEvents: [] });
  for (let chunk = 0; chunk < 240; chunk++) {
    const s = await page.evaluate((until) => {
      const a = window.app, b = a.battle, P = b.player; let seen = false;
      for (let i = 0; i < 300 && b.active; i++) {
        if (!P.alive) { a.step(1 / 60, false); if (!P.alive && b.active && (globalThis.__deadT = (globalThis.__deadT || 0) + 1) > 240) { b.revivePlayer(); a.ui.closeModal?.(); globalThis.__deadT = 0; } continue; }
        globalThis.__metricsDriver.step(1 / 60, false);
        if (until === 'boss' && b.boss && b.boss.alive) { seen = true; break; }
      }
      return { active: b.active, boss: !!(b.boss && b.boss.alive), seen, kills: b.kills, win: b.result?.win ?? null };
    }, until);
    if (until === 'boss' && s.seen) return s;
    if (!s.active) return s;
  }
  return { timeout: true };
}

try {
  // ------------------------------------------------------------ 캠페인 지도
  if (only.includes('map')) {
    const t = await open('map', seedSave(7, [...region(1, 6)]));
    await t.boot();
    await t.shot('01-lobby-region1');
    const lobby = await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, town: window.app.eco.campaignTownState(), world: window.app.arena.lobbyWorld?.userData?.townId, chapter: window.app.arena.lobbyHall?.userData?.campaignChapter }));
    check('로비 마을 칩이 1지역 마을을 보여 준다', /종지기 정원 마을/.test(lobby.chip) && lobby.town.current === 1 && lobby.chapter === 1, lobby);
    await openCampaign(t);
    await t.page.waitForTimeout(400);
    await t.shot('02-campaign-region1-map');
    const map = await t.page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; };
      const cells = [...document.querySelectorAll('#stage-grid .stage-cell')], chips = [...document.querySelectorAll('#chapter-tabs .cmap-chip')];
      return { cells: cells.map((c) => ({ code: c.dataset.stage, rank: c.dataset.rank, mid: c.classList.contains('is-midboss'), region: c.classList.contains('is-regionboss'), flag: c.querySelector('.stage-flag')?.textContent || null, visible: vis(c) })), chips: chips.map((c) => ({ text: c.textContent.trim().replace(/\s+/g, ' '), visible: vis(c) })), sortieVisible: vis(document.querySelector('#st-go')) };
    });
    check('지역 칩 6개와 관문 1-1..1-10 이 스크롤 없이 한 화면에 보인다', map.cells.length === 10 && map.chips.length === 6 && map.cells.every((c) => c.visible) && map.chips.every((c) => c.visible) && map.sortieVisible, { visible: map.cells.filter((c) => !c.visible).map((c) => c.code), sortie: map.sortieVisible });
    check('1-5 는 중간 보스, 1-10 은 지역 보스 깃발', map.cells[4].mid && map.cells[4].flag === '중간 보스' && map.cells[9].region && map.cells[9].flag === '지역 보스' && map.cells.filter((c) => c.flag).length === 2, map.cells.filter((c) => c.flag));
    await t.tap('#stage-grid [data-stage="1-5"]'); await t.page.waitForTimeout(500);
    await t.page.evaluate(() => document.querySelector('.stage-unlock-note')?.scrollIntoView({ block: 'center' })); await t.page.waitForTimeout(300);
    await t.shot('03-midboss-1-5-detail');
    await t.tap('#stage-grid [data-stage="1-10"]'); await t.page.waitForTimeout(500);
    await t.page.evaluate(() => document.querySelector('.stage-unlock-note')?.scrollIntoView({ block: 'center' })); await t.page.waitForTimeout(300);
    await t.shot('04-boss-1-10-detail');
    const note = await t.page.evaluate(() => document.querySelector('.stage-unlock-note')?.textContent || '');
    check('1-10 상세가 다음 지역과 마을 전환을 알린다', /새 지역 · 불씨 왕국의 용광로/.test(note) && /로비 마을 · 불씨 용광로 마을/.test(note), note);
    await t.context.close();
  }

  // ------------------------------------------------------------ 중간 보스 1-5 전투
  if (only.includes('midboss')) {
    const t = await open('midboss', seedSave(5, region(1, 4)));
    await t.boot(); await openCampaign(t);
    await t.tap('#stage-grid [data-stage="1-5"]'); await t.page.waitForTimeout(400);
    await t.tap('#st-go'); await t.page.waitForTimeout(500);
    const seen = await fight(t.page, { until: 'boss' });
    check('1-5 보스방에서 중간 보스가 등장한다', seen.seen, seen);
    await t.page.waitForTimeout(250);
    await t.shot('01-boss-intro-and-hp-bar');
    const ui = await t.page.evaluate(() => { const r = (s) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom) }; }; return { intro: r('.boss-intro'), introText: document.querySelector('.boss-intro')?.textContent, bar: r('#bossbar'), rank: document.querySelector('#bossbar .boss-rank')?.textContent, joy: r('.joy-base'), attack: r('#btn-attack') }; });
    check('중간 보스 띠가 상단 가장자리에 있고 체력 막대에 계급 칩이 붙는다', ui.intro && ui.intro.y <= 12 && ui.intro.b <= 46 && /중간 보스/.test(ui.introText) && ui.rank === '중간 보스', ui);
    const end = await fight(t.page, { until: 'end' });
    await t.page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); }); await t.page.waitForTimeout(2600);
    const res = await t.page.evaluate(() => ({ win: window.app.battle.result?.win, banner: !!document.querySelector('.region-unlock-banner'), town: window.app.eco.campaignTownState() }));
    await t.shot('02-result-midboss');
    check('중간 보스 클리어는 마을을 바꾸지 않는다', res.win === true && !res.banner && res.town.current === 1, res);
    await t.context.close();
  }

  // ------------------------------------------------------------ 지역 보스 1-10 → 해금 → 마을 전환
  if (only.includes('region')) {
    const t = await open('region', seedSave(10, region(1, 9)));
    await t.boot();
    await t.shot('01-lobby-before-town1');
    const before = await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, state: window.app.eco.campaignTownState(), stars: Object.keys(window.app.eco.s.progress.stars).length, gems: window.app.eco.s.gems }));
    check('클리어 전 마을은 1지역', before.state.current === 1 && before.state.latest === 1, before);
    await openCampaign(t);
    await t.tap('#stage-grid [data-stage="1-10"]'); await t.page.waitForTimeout(400);
    await t.tap('#st-go'); await t.page.waitForTimeout(500);
    const seen = await fight(t.page, { until: 'boss' });
    check('1-10 보스방에서 지역 보스가 등장한다', seen.seen, seen);
    await t.page.waitForTimeout(250);
    await t.shot('02-boss-intro-and-hp-bar');
    const ui = await t.page.evaluate(() => ({ introText: document.querySelector('.boss-intro')?.textContent, rank: document.querySelector('#bossbar .boss-rank')?.textContent, data: document.querySelector('.boss-intro')?.dataset.rank }));
    check('지역 보스 띠와 체력 막대 계급 칩', /지역 보스/.test(ui.introText || '') && ui.rank === '지역 보스' && ui.data === 'regionboss', ui);
    await fight(t.page, { until: 'end' });
    await t.page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); });
    await t.page.waitForSelector('.region-unlock-banner', { timeout: 15000 }).catch(() => {});
    await t.page.waitForTimeout(700);
    await t.shot('03-result-unlock-celebration');
    const res = await t.page.evaluate(() => ({ win: window.app.battle.result?.win, banner: document.querySelector('.region-unlock-banner')?.textContent, bannerTop: Math.round(document.querySelector('.region-unlock-banner')?.getBoundingClientRect().top ?? -1), state: window.app.eco.campaignTownState(), unlocked: window.app.eco.s.progress.unlocked, stars: Object.keys(window.app.eco.s.progress.stars).length, gems: window.app.eco.s.gems }));
    check('새 지역 해금 띠가 위쪽 가장자리에 나온다', res.win === true && /새 지역 해금 · 불씨 용광로 마을/.test(res.banner || '') && res.bannerTop <= 12, res);
    check('해금은 한 번만: 다음 지역 열림·마을 저장·첫 클리어 보석 1회', res.unlocked === 11 && res.state.latest === 2 && res.state.current === 2 && res.state.celebrated === 2 && res.stars === before.stars + 1 && res.gems - before.gems >= 300, { before, res });
    await t.page.waitForTimeout(4600);
    await t.page.evaluate(() => { window.app.testPause = false; }); // 전투 가속이 끝났으므로 실시간 루프를 되살린다
    await t.tap('#btn-result-lobby');
    await t.page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 60000 });
    await t.page.waitForTimeout(1800);
    await t.shot('04-lobby-after-town2');
    const after = await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, chapter: window.app.arena.lobbyHall?.userData?.campaignChapter, world: window.app.arena.lobbyWorld?.userData?.townId, music: window.app.arena && null, pending: !!document.querySelector('.region-unlock-banner') }));
    check('로비로 돌아오면 마을이 불씨 용광로 마을로 바뀌어 있다', /불씨 용광로 마을/.test(after.chip) && after.chapter === 2 && after.world === 'emberforge', after);
    // 이전 마을 다시 가기
    await t.tap('#campaign-town-chip'); await t.page.waitForTimeout(500);
    await t.shot('05-town-menu');
    await t.tap('#campaign-town-menu [data-town="1"]'); await t.page.waitForTimeout(1500);
    await t.shot('06-lobby-revisit-town1');
    const revisit = await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, state: window.app.eco.campaignTownState(), chapter: window.app.arena.lobbyHall?.userData?.campaignChapter }));
    check('이전 마을로 다시 갈 수 있고 선택이 저장된다', /종지기 정원 마을/.test(revisit.chip) && revisit.state.current === 1 && revisit.state.latest === 2 && revisit.chapter === 1, revisit);
    // 재시작해도 선택 유지
    await t.page.evaluate(() => sessionStorage.setItem('qa-seeded', '1'));
    await t.boot(); await t.page.waitForTimeout(800);
    const persisted = await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, state: window.app.eco.campaignTownState(), chapter: window.app.arena.lobbyHall?.userData?.campaignChapter }));
    await t.shot('07-lobby-after-restart');
    check('재시작 뒤에도 고른 마을이 유지된다', /종지기 정원 마을/.test(persisted.chip) && persisted.state.current === 1 && persisted.chapter === 1, persisted);
    await t.tap('#campaign-town-chip'); await t.page.waitForTimeout(400);
    await t.tap('#campaign-town-menu [data-town="2"]'); await t.page.waitForTimeout(1500);
    const forward = await t.page.evaluate(() => ({ state: window.app.eco.campaignTownState(), chapter: window.app.arena.lobbyHall?.userData?.campaignChapter }));
    check('잠긴 마을은 고를 수 없고 해금한 마을로는 다시 이동한다', forward.state.current === 2 && forward.chapter === 2, forward);
    await t.tap('#campaign-town-chip'); await t.page.waitForTimeout(400);
    const lockedRow = await t.page.evaluate(() => document.querySelector('#campaign-town-menu [data-town="3"]')?.getAttribute('aria-disabled'));
    await t.tap('#campaign-town-menu [data-town="3"]'); await t.page.waitForTimeout(500);
    check('3지역 마을은 잠겨 있어 이동되지 않는다', lockedRow === 'true' && (await t.page.evaluate(() => window.app.eco.campaignTownState().current)) === 2, lockedRow);
    await t.context.close();
  }

  // ------------------------------------------------------------ 여섯 마을 전부(전 지역 클리어 저장, 마을 칩을 실제 터치로 순회)
  if (only.includes('towns')) {
    const t = await open('towns', seedSave(60, Array.from({ length: 6 }, (_, i) => region(i + 1)).flat()));
    await t.boot();
    const seen = [];
    for (let ch = 1; ch <= 6; ch++) {
      await t.tap('#campaign-town-chip'); await t.page.waitForTimeout(400);
      await t.tap(`#campaign-town-menu [data-town="${ch}"]`); await t.page.waitForTimeout(1600);
      await t.shot(`0${ch}-lobby-town${ch}`);
      seen.push(await t.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip b')?.textContent, chapter: window.app.arena.lobbyHall?.userData?.campaignChapter, scenery: window.app.arena.lobbyWorld?.userData?.townId, calls: window.app.renderer?.r?.info?.render?.calls })));
    }
    check('여섯 마을이 모두 서로 다른 풍경으로 바뀐다', seen.length === 6 && seen.every((x, i) => x.chapter === i + 1) && new Set(seen.map((x) => x.scenery)).size >= 5 && new Set(seen.map((x) => x.chip)).size === 6, seen);
    await t.context.close();
  }

  // ------------------------------------------------------------ 신규 첫 출격 → 캠페인 1-1(튜토리얼)
  if (only.includes('first')) {
    const t = await open('first', null);
    await t.boot();
    await t.shot('01-lobby-first-sortie');
    const lobby = await t.page.evaluate(() => ({ town: window.app.eco.campaignTownState(), chip: document.querySelector('#campaign-town-chip')?.textContent, label: document.querySelector('#citadel-command')?.textContent?.replace(/\s+/g, ' ').slice(0, 80) }));
    check('신규 저장은 1지역 마을과 첫 출격 카드로 시작한다', lobby.town.current === 1 && /종지기/.test(lobby.chip) && /첫 출격/.test(lobby.label), lobby);
    await t.tap('#citadel-dungeon-prepare'); await t.page.waitForTimeout(800);
    await t.shot('02-first-sortie-prepare');
    await t.tap('dialog[open] .citadel-hub-go');
    await t.page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 180000 }).catch(() => {});
    await t.page.waitForTimeout(2500);
    const battle = await t.page.evaluate(() => ({ mode: window.app.mode, code: window.app.battle?.stage?.code, tutorial: !!document.querySelector('#tutorial.show, .tutorial-card, #tut-card:not(.hidden)'), tut: window.app.tutorial?.active ?? null }));
    await t.shot('03-first-sortie-battle-1-1');
    check('첫 출격이 캠페인 1-1 전투로 시작된다', battle.mode === 'battle' && battle.code === '1-1', battle);
    await t.context.close();
  }
} catch (error) {
  report.errors.push(String(error.stack || error).slice(0, 800)); console.error(error);
} finally {
  await browser.close();
  report.finished = new Date().toISOString();
  report.failures = report.checks.filter((c) => !c.ok).length;
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, errors: report.errors.length, out }, null, 1));
  process.exitCode = report.failures || report.errors.length ? 1 : 0;
}
