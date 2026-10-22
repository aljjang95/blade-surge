// 무한의 성·일일 임무·시즌 이벤트 실제 입력 검증(docs/CONTENT_90D.md 7절).
// 사용법: node tools/content-90d-qa.mjs [origin=http://127.0.0.1:5193/] [out=work/content-90d-qa] [--vp=844x390]
// 고정값(테스트 훅): 새 브라우저 저장에 진행도(2-10 클리어 = 진행도 21)·기사 45레벨·튜토리얼 완료를 시드한다.
// 입력: 메뉴 → 무한의 성 → 탭 전환 → 도전 → 결과 → 다음 층 버튼은 실제 터치다. 전투만 SwiftShader 속도 때문에 app.step(1/60) AUTO 가속(metrics-driver).
// viewport/터치 에뮬과 소프트웨어 렌더 관측이며 물리 기기·GPU 프레임 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5193/';
const [VW, VH] = (args.find((a) => a.startsWith('--vp='))?.split('=')[1] || '844x390').split('x').map(Number);
const out = path.resolve(positional[1] || `work/content-90d-qa/${VW}x${VH}`);
await fs.mkdir(out, { recursive: true });
const KEY = 'bladesurge_save_v1';
const report = { started: new Date().toISOString(), origin, viewport: `${VW}x${VH} dsf2 touch`, checks: [], shots: [], errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const today = Math.floor(Date.now() / 86400000);
const stars = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${Math.floor(i / 10) + 1}-${(i % 10) + 1}`, 3]));
const seed = { progress: { unlocked: 21, stars, difficulty: 'story' }, heroes: { knight: { level: 45 } }, tutorial: { completed: true }, daily: { day: 0, last: today } };

const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
await context.addInitScript(([key, data]) => { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } }, [KEY, seed]);
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GLTFLoader/.test(m.text())) report.errors.push(m.text().slice(0, 300)); });
const shot = async (label) => { const file = `${label}.png`; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.shots.push(file); return file; };
const tap = async (selector, timeout = 20000) => {
  const target = page.locator(selector).first();
  try { await target.tap({ timeout }); } catch (error) {
    if (/performing tap action/.test(String(error.message))) { await page.waitForTimeout(800); return; }
    const box = await target.boundingBox(); if (!box) throw error; await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
};
// 화면 안에 완전히 보이는지(가장자리 1px 허용)와 서로 겹치는지 잰다.
const rect = (selector) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }, selector);
const inside = (r) => !!r && r.w > 0 && r.h > 0 && r.x >= -1 && r.y >= -1 && r.r <= VW + 1 && r.b <= VH + 1;

async function fight() {
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
  await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); });
  await page.evaluate(installMetricsDriver, { storyEvents: [] });
  for (let chunk = 0; chunk < 240; chunk++) {
    const s = await page.evaluate(() => {
      const a = window.app, b = a.battle, P = b.player;
      for (let i = 0; i < 300 && b.active; i++) {
        if (!P.alive) { a.step(1 / 60, false); if (!P.alive && b.active && (globalThis.__deadT = (globalThis.__deadT || 0) + 1) > 240) { b.revivePlayer(); a.ui.closeModal?.(); globalThis.__deadT = 0; } continue; }
        globalThis.__metricsDriver.step(1 / 60, false);
      }
      return { active: b.active, kills: b.kills, win: b.result?.win ?? null };
    });
    if (!s.active) return s;
  }
  return { timeout: true };
}

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await tap('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
  await page.waitForTimeout(1500);
  for (let n = 0; n < 4; n++) { if (!await page.locator('#modal.show #m-cancel').isVisible().catch(() => false)) break; await tap('#modal.show #m-cancel'); await page.waitForTimeout(300); }
  await shot('01-lobby');

  // 메뉴 → 모험 묶음의 '무한의 성' 입구(실제 터치)
  await tap('#meta .oath-nav-menu'); await page.waitForTimeout(600);
  await shot('02-menu-tower-entry');
  const entry = await rect('#oath-menu [data-menu-key="menu-tower"]');
  check('메뉴의 모험 묶음에 무한의 성 입구가 화면 안에 보인다', inside(entry), entry);
  await tap('#oath-menu [data-menu-key="menu-tower"]'); await page.waitForTimeout(900);
  const tower = await page.evaluate(() => ({ open: document.querySelector('#journey')?.open, tab: window.app.journeyView.tab, title: document.querySelector('#journey .journey-banner h3')?.textContent, go: document.querySelector('[data-control="launch-tower"]')?.textContent, disabled: document.querySelector('[data-control="launch-tower"]')?.disabled }));
  check('무한의 성 탭이 열리고 1층 도전 버튼이 활성', tower.open && tower.tab === 'tower' && /최고 0층/.test(tower.title || '') && tower.go === '1층 도전' && !tower.disabled, tower);
  await shot('03-tower-tab');
  await page.evaluate(() => document.querySelector('#journey .journey-section')?.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300);
  await shot('04-tower-events');
  const dialog = await rect('#journey'), tabs = await rect('#journey .journey-tabs');
  check('성장 여정 창과 탭 5개가 화면 안에 들어온다', inside(dialog) && inside(tabs), { dialog, tabs, vp: [VW, VH] });

  // 오늘의 의뢰 탭: 새 일일·주간 임무(탑·하드)가 보인다
  await tap('#journey [data-control="tab-contracts"]'); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('[data-control="claim-daily-daily_tower"]')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
  await shot('05-daily-missions');
  const daily = await page.evaluate(() => [...document.querySelectorAll('#journey .journey-card h3')].map((n) => n.textContent));
  check('일일 임무에 성의 다음 층·더 거친 길, 주간에 성을 오르는 한 주가 있다', daily.includes('성의 다음 층') && daily.includes('더 거친 길') && daily.includes('성을 오르는 한 주'), daily);

  // 탑 탭으로 돌아가 실제 도전
  await tap('#journey [data-control="tab-tower"]'); await page.waitForTimeout(500);
  await tap('[data-control="launch-tower"]');
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await shot('06-tower-floor1-battle');
  const battle = await page.evaluate(() => ({ code: window.app.battle.stage.code, tower: window.app.battle.stage.tower, energy: window.app.eco.s.energy, scale: window.app.battle.stage.scale, journeyOpen: !!document.querySelector('#journey')?.open }));
  check('1층 전투: 코드 T1, 에너지 차감 없음, 여정 창 닫힘(플레이 영역 가림 없음)', battle.code === 'T1' && battle.tower?.floor === 1 && !battle.journeyOpen, battle);
  const energyBefore = battle.energy;
  const end = await fight();
  await page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); }); await page.waitForTimeout(2600);
  await page.evaluate(() => { window.app.testPause = false; });
  await shot('07-tower-floor1-result');
  const res = await page.evaluate(() => ({ win: window.app.battle.result?.win, best: window.app.eco.s.endgame.tower.best, energy: window.app.eco.s.energy, retry: document.querySelector('#btn-result-retry')?.textContent, next: getComputedStyle(document.querySelector('#btn-result-next')).display, summary: document.querySelector('#result-loot-details summary')?.textContent, daily: window.app.journey.snapshot().contracts.daily.find((c) => c.id === 'daily_tower') }));
  check('1층 승리 정산: 최고 1층, 에너지 그대로, 다음 버튼은 2층 도전', end.win === true && res.win === true && res.best === 1 && res.energy >= energyBefore && /2층 도전/.test(res.retry || '') && res.next === 'none', { end, res });
  check('일일 임무 성의 다음 층 1/1 달성', res.daily?.cur === 1 && res.daily?.ready === true, res.daily);

  // 결과의 2층 도전 버튼(실제 터치)
  await tap('#btn-result-retry');
  await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 180000 });
  const second = await page.evaluate(() => ({ code: window.app.battle.stage.code, scale: window.app.battle.stage.scale }));
  check('결과 화면에서 2층으로 이어서 도전한다(적 배율 상승)', second.code === 'T2' && second.scale > battle.scale, { first: battle.scale, second });
  await page.waitForTimeout(800);
  await shot('08-tower-floor2-battle');
  await fight();
  await page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); }); await page.waitForTimeout(2000);
  await page.evaluate(() => { window.app.testPause = false; });
  await tap('#btn-result-lobby');
  await page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 60000 });
  await page.waitForTimeout(1200);
  // 주간 보급 받기(실제 터치)
  await page.evaluate(() => window.app.journeyView.open('tower')); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('[data-control="claim-tower-chest"]')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
  const goldBefore = await page.evaluate(() => window.app.eco.s.gold);
  await tap('[data-control="claim-tower-chest"]'); await page.waitForTimeout(600);
  await shot('09-weekly-chest-claimed');
  const chest = await page.evaluate(() => ({ gold: window.app.eco.s.gold, label: document.querySelector('[data-control="claim-tower-chest"]')?.textContent, best: window.app.eco.s.endgame.tower.best }));
  check('주간 보급 상자 수령(골드 증가, 이번 주 수령 완료)', chest.gold > goldBefore && /수령 완료/.test(chest.label || ''), { goldBefore, chest });
} catch (error) {
  report.errors.push('fatal: ' + String(error?.stack || error).slice(0, 600));
  await shot('zz-fatal').catch(() => {});
} finally {
  report.finished = new Date().toISOString();
  report.pass = report.checks.length > 0 && report.checks.every((c) => c.ok) && !report.errors.some((e) => e.startsWith('fatal'));
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(report.pass ? 'ALL PASS' : 'FAILED', `${report.checks.filter((c) => c.ok).length}/${report.checks.length}`, 'errors', report.errors.length);
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}
