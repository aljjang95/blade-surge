// 같은 스테이지 2연패 뒤 결과 화면 캡처 (ch2-entry, 2-1, 390x700 인앱 UA).
// stage-power-sweep.mjs 의 부팅·새 저장·레벨 설정·startStage·AUTO 진행 방식을 그대로 따른다.
// 부활은 하지 않는다: 쓰러지면 부활 창의 '정비하기'(#r-no)를 실제 tap 하고, 결과 화면이 뜰 때까지 step 을 돌린다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { installMetricsDriver } from '/home/user/blade-surge/tools/metrics-driver.mjs';
import { installAutoStarter } from '/home/user/blade-surge/tools/qa-starter.mjs';
import { STORY_EVENTS } from '/home/user/blade-surge/src/data/masterworks.js';

const ORIGIN = 'http://127.0.0.1:5199';
const OUT = '/home/user/blade-surge/work/qa/ch2-entry';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 Barcelona 330.0';
const CH = 2, ST = 1, LEVEL = 8, SEED = 0x5eed;
const storyEvents = STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) }));

await fs.mkdir(OUT, { recursive: true });
const report = { origin: ORIGIN, viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true, userAgent: UA,
  stage: `${CH}-${ST}`, level: LEVEL, reviveTaps: 0, defeatFallbackUsed: false, errors: [] };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(String(e).slice(0, 200)));

// 전투가 끝나거나(결과 패널 .show) 쓰러진 뒤 부활 창을 정비로 닫고 결과가 보일 때까지 기다린다.
async function fightToResult(label) {
  for (let chunk = 0; chunk < 400; chunk++) {
    const s = await page.evaluate(() => {
      const b = window.app.battle, P = b.player;
      for (let i = 0; i < 600 && b.active; i++) {
        if (!P.alive) return { dead: true, active: b.active, elapsed: b.elapsed };
        globalThis.__metricsDriver.step(1 / 60, false);
      }
      return { dead: false, active: b.active, elapsed: b.elapsed };
    });
    if (s.dead || !s.active) break;
    if (s.elapsed > 900) throw new Error(`${label}: 900초 안에 끝나지 않음`);
  }
  let defeatSteps = 0;
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => {
      const res = document.getElementById('result');
      const retry = document.getElementById('btn-result-retry');
      const rev = document.getElementById('r-no');
      return {
        resultShown: !!res?.classList.contains('show'),
        retryReady: !!retry && retry.offsetParent !== null && !retry.disabled,
        reviveOpen: !!rev && rev.offsetParent !== null,
      };
    });
    if (st.resultShown && st.retryReady) return { defeatSteps };
    if (st.reviveOpen) {
      await page.locator('#r-no').tap().catch(() => {});
      report.reviveTaps++;
      await page.waitForTimeout(250);
      continue;
    }
    if (i > 150 && !st.resultShown) {
      // 부활 창 없이 결과가 안 뜨면 최후 수단: 패배 처리. 보고에 명시한다.
      await page.evaluate(() => window.app.battle.defeat());
      report.defeatFallbackUsed = true;
    }
    await page.evaluate(() => { for (let k = 0; k < 60; k++) window.app.step(1 / 60, false); });
    defeatSteps++;
    await page.waitForTimeout(120);
  }
  throw new Error(`${label}: 결과 화면이 뜨지 않음`);
}

try {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await installAutoStarter(page);
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.evaluate(() => {
    const e = window.app.eco;
    if (!e.reset()) throw Error('새 저장 격리 실패');
    e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
    e.save();
  });
  await page.locator('#boot-start').tap({ force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 180000 });

  const pre = await page.evaluate(({ ch, st, level, seed }) => {
    const a = window.app, e = a.eco;
    a.testPause = true; a.ui.closeModal();
    e.s.energy = 9999; e.s.tutorial = { completed: true };
    e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
    const h = e.hero(e.s.selected); h.level = level; h.exp = 0;
    e.save();
    a.journey.s.autoBattle = true;
    let state = seed >>> 0;
    Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    return { heroId: e.s.selected, power: e.heroPower(e.s.selected) };
  }, { ch: CH, st: ST, level: LEVEL, seed: SEED });
  report.heroId = pre.heroId; report.power = pre.power;

  const started = await page.evaluate(({ ch, st }) => window.app.startStage({ ch, st }), { ch: CH, st: ST });
  if (started === false) throw Error('출격 실패');
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
  report.recPower = await page.evaluate(() => window.app.battle.stage.recPower);
  const armBattle = () => page.evaluate(() => {
    const a = window.app, P = a.battle.player; a.testPause = true; P.auto = true; a.ui.closeModal();
  });
  await armBattle();
  await page.evaluate(installMetricsDriver, { storyEvents });

  const readBtns = () => page.evaluate(() => {
    const use = document.getElementById('btn-result-use');
    const retry = document.getElementById('btn-result-retry');
    const first = document.querySelector('#result-growth .growth-action');
    const r = use?.getBoundingClientRect();
    return {
      useText: use?.textContent.replace(/\s+/g, ' ').trim() || '',
      useLabel: document.getElementById('result-use-label')?.textContent.trim() || '',
      useHint: document.getElementById('result-use-hint')?.textContent.trim() || '',
      useHidden: !!use?.hidden, useDisabled: !!use?.disabled,
      useRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      retryClass: retry?.className || '', retryText: retry?.textContent.trim() || '',
      retryHidden: !!retry?.hidden,
      growthFirstText: first?.textContent.replace(/\s+/g, ' ').trim() || null,
      lossStreak: window.app.ui?.resultData?.lossStreak ?? null,
      win: window.app.battle?.result?.win ?? null,
    };
  });

  // 패배 1회
  const d1 = await fightToResult('loss1');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/streak-loss1-390x700.png` });
  report.loss1 = { ...(await readBtns()), defeatSteps: d1.defeatSteps, screenshot: `${OUT}/streak-loss1-390x700.png` };

  // 다시 도전 (실제 tap) → 같은 2-1 재시작
  await page.locator('#btn-result-retry').tap();
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player && !window.app.battle.result, null, { timeout: 180000 });
  await armBattle();
  await page.evaluate(installMetricsDriver, { storyEvents });

  // 패배 2회
  const d2 = await fightToResult('loss2');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/streak-loss2-390x700.png` });
  report.loss2 = { ...(await readBtns()), defeatSteps: d2.defeatSteps, screenshot: `${OUT}/streak-loss2-390x700.png` };

  await fs.writeFile(`${OUT}/streak.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  report.fatal = String(err.message || err).slice(0, 400);
  await fs.writeFile(`${OUT}/streak.json`, JSON.stringify(report, null, 2));
  console.error('FAILED', report.fatal);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
