// Google Play 스토어 등록용 스크린샷 캡처 드라이버.
// 실제 게임(Vite 개발 서버)을 Chromium으로 열고, 실제 터치 입력으로 타이틀 → 로비 → 던전 출격 → 전투(AUTO + 궁극기 터치)
// → 원정 결과 → 장비 장착 → 던전 지도 → 장비 상세(강화) 순서로 진행하며 화면을 저장한다.
// 게임 UI는 가공하지 않는다. 시간만 app.step(1/60)으로 결정적으로 진행한다(SwiftShader 소프트웨어 렌더라 실시간 루프가 느리다).
//
// 고정값(fixture): 새 저장 + 영웅 검성 Lv.3 + 출석/튜토리얼 팝업만 건너뜀 + Math.random 시드 고정.
// 위치·체력·피해·처치·드랍·승리는 바꾸지 않는다. 분위기를 위해 장면을 합성·오버레이하지 않는다.
//
// 사용법:
//   node tools/store-screenshots.mjs [--sets=phone,tablet7,tablet10] [--out=store/googleplay/screenshots]
//                                    [--origin=http://127.0.0.1:5173] [--level=3] [--keep-raw]
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback = '') => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);

// CSS 뷰포트 × DPR 2 = 실제 출력 픽셀. 모두 가로(sensorLandscape) 화면이다.
const SETS = {
  phone: { prefix: 'phone', width: 960, height: 540, dpr: 2 },        // 1920x1080 (16:9)
  tablet7: { prefix: 'tablet7', width: 960, height: 600, dpr: 2 },    // 1920x1200 (16:10)
  tablet10: { prefix: 'tablet10', width: 1280, height: 800, dpr: 2 }, // 2560x1600 (16:10)
  // 피처 그래픽 원본: 가로로 넓게(3072x1500) 잡아 영웅을 오른쪽에 두고 자른다. HUD를 숨기고 궁극기 순간의 3D 장면만 캡처한다(work/store-keyart/raw.png). 기본 실행에는 포함하지 않는다.
  keyart: { prefix: 'keyart', width: 1536, height: 750, dpr: 2, keyart: true },
};
if (arg('dpr')) for (const spec of Object.values(SETS)) spec.dpr = Number(arg('dpr')); // 개발용 미리보기(제출용은 기본 2)
const selected = arg('sets', 'phone,tablet7,tablet10').split(',').filter(Boolean);
for (const name of selected) if (!SETS[name]) throw Error(`알 수 없는 세트: ${name}`);
const outDir = path.resolve(root, arg('out', 'store/googleplay/screenshots'));
const level = Number(arg('level', '3'));
const SEED = 0x5eed1019;
const ULT_FRAMES = 32; // 궁극기 터치 뒤 이 프레임 수(≈0.53초)만큼 진행한 순간을 저장한다.

// 파일 번호는 스토어 노출 순서다.
const ORDER = ['title', 'lobby', 'combat', 'boss', 'reward', 'map', 'hero', 'enhance'];

let server, origin = arg('origin');
if (!origin) {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
}
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch(launchOpts());
const report = [];

try {
  for (const name of selected) report.push(await captureSet(SETS[name]));
} finally {
  await browser.close();
  await server?.close();
}
console.log(JSON.stringify(report, null, 2));

async function captureSet(spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dpr,
    hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  const files = {};
  const log = (...a) => console.log(`[${spec.prefix}]`, ...a);

  // 일시정지한 루프에서 결정적으로 시간을 진행한다. 마지막 프레임만 렌더한다.
  const settle = (frames = 30, render = true) => page.evaluate(({ frames, render }) => {
    for (let i = 0; i < frames; i++) app.step(1 / 60, render && i === frames - 1);
  }, { frames, render });
  const save = async (key, raw) => {
    const index = ORDER.indexOf(key) + 1;
    const file = path.join(outDir, `${spec.prefix}-${String(index).padStart(2, '0')}.png`);
    // Play는 알파 없는 24비트 PNG를 요구한다.
    const info = await sharp(raw).removeAlpha().png({ compressionLevel: 9 }).toFile(file);
    if (info.width !== spec.width * spec.dpr || info.height !== spec.height * spec.dpr) throw Error(`${file}: 크기 불일치 ${info.width}x${info.height}`);
    files[key] = path.relative(root, file);
    log('저장', files[key], `${info.width}x${info.height}`);
  };
  const snap = async (key, { frames = 30, wait = 500 } = {}) => {
    await settle(frames);
    await page.waitForTimeout(wait);
    await save(key, await page.screenshot({ timeout: 180000 }));
  };
  const shootNow = async key => { // 전투 순간 포착: 이미 진행한 시간 위에 한 프레임만 그린다.
    await settle(1);
    await save(key, await page.screenshot({ timeout: 180000 }));
  };
  // HUD·메뉴를 숨기고 3D 캔버스(와 피해 숫자)만 찍는다. 장면은 가공하지 않는다.
  const keyartShot = async (name = 'raw.png') => {
    const style = await page.addStyleTag({ content: 'body > :not(#gl):not(#dmg-layer){visibility:hidden !important}' });
    await settle(1);
    const dir = path.join(root, 'work/store-keyart');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), await page.screenshot({ timeout: 180000 }));
    await style.evaluate(node => node.remove());
    log('키아트 원본 저장', path.join('work/store-keyart', name));
  };
  const bossShot = () => spec.keyart ? keyartShot() : shootNow('boss');
  const touch = async target => { await (typeof target === 'string' ? page.locator(target).first() : target).tap(); };

  try {
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.evaluate(({ level }) => {
    const e = app.eco; if (!e.reset()) throw Error('새 저장 격리 실패');
    e.s.daily.last = Math.floor(Date.now() / 86400000); // 출석 팝업만 건너뛴다.
    e.s.tutorial = { completed: true };
    e.s.selected = 'knight'; const h = e.hero('knight'); h.level = level; h.exp = 0; e.save();
  }, { level });

  // 01 타이틀
  await page.waitForTimeout(1500);
  if (!spec.keyart) await save('title', await page.screenshot({ timeout: 180000 }));

  // 02 로비
  await touch('#boot-start');
  await page.waitForFunction(() => app.mode === 'lobby', null, { timeout: 120000 });
  await page.evaluate(seed => {
    app.testPause = true;
    let s = seed >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }, SEED);
  await settle(120, false);
  if (!spec.keyart) await snap('lobby', { frames: 30, wait: 800 });

  // 출격: 실제 터치로 출격 준비 → 원정 시작
  await touch('#citadel-dungeon-prepare');
  await page.locator('.citadel-hub-dialog[open]').waitFor();
  await page.waitForTimeout(500);
  await touch('.citadel-hub-dialog .citadel-hub-go');
  await page.waitForFunction(() => app.battle?.active && !app.stageStarting && !!app.battle.player, null, { timeout: 240000 });
  await page.evaluate(() => { app.testPause = true; });
  if (await page.locator('#tutorial-skip').isVisible().catch(() => false)) await touch('#tutorial-skip');
  await touch('#btn-auto');
  // 키아트: 시점 확대 버튼(+)을 4번 눌러 영웅을 크게 담는다. 버튼이 접혀 있어 같은 click 핸들러를 직접 호출한다.
  if (spec.keyart) for (let i = 0; i < 4; i++) { await page.evaluate(() => document.getElementById('battle-camera-zoom-in').click()); await settle(10, false); }

  // 03~04 전투: 6프레임(0.1초)씩 진행하며 장면 조건을 본다.
  // 전투 장면 = 적이 화면에 3마리 이상 + 콤보 3 이상에서 스킬 이펙트(스파크 60+, 이펙트 오브젝트 9+)가 정점인 순간.
  // 보스 장면 = 보스전에서 궁극기 게이지가 차면 실제 터치로 발동하고 이펙트가 퍼진 순간.
  let combatDone = false, bossDone = false, ultTried = false;
  for (let tick = 0; tick < 6000; tick++) {
    const s = await page.evaluate(() => {
      const bt = app.battle, P = bt.player;
      for (let i = 0; i < 6 && bt.active && !bt.paused; i++) {
        if (!P.alive) bt.revivePlayer?.();
        app.step(1 / 60, false);
      }
      const cam = app.renderer.camera; let visible = 0;
      for (const e of bt.enemies) {
        if (!e.alive || e.spawning) continue;
        const v = e.pos.clone().project(cam);
        if (Math.abs(v.x) < 0.8 && v.y > -0.7 && v.y < 0.7) visible++;
      }
      const fx = app.fx;
      return { active: bt.active, paused: bt.paused, state: P.state, visible, sparks: fx.sparks.n, items: fx.items.length,
        combo: Number(document.getElementById('combo-n')?.textContent) || 0,
        bossHp: bt.boss?.alive ? bt.boss.hp / (bt.boss.maxHp || bt.boss.hpMax || 1) : null, ult: P.ult, ultMax: P.ultMax, el: bt.elapsed };
    });
    if (!s.active || (spec.keyart && bossDone)) break;
    if (s.paused) { // 각인/이야기 선택 창은 실제 터치로 닫는다.
      const choice = page.locator('#masterworks[open] .mw-choices button:not([disabled]),#masterworks[open] .mw-story-choices button:not([disabled])').first();
      if (await choice.isVisible().catch(() => false)) await touch(choice);
      else await page.waitForTimeout(300);
      continue;
    }
    if (!spec.keyart && !combatDone && s.bossHp == null && s.items >= 9 && s.sparks >= 60 && s.visible >= 3 && s.combo >= 3 && s.el > 2) {
      combatDone = true; await shootNow('combat'); log('전투 포착', JSON.stringify(s));
    }
    if (s.bossHp != null && !bossDone) {
      if (!ultTried && s.ult >= s.ultMax && ['idle', 'move', 'attack'].includes(s.state)) {
        ultTried = true; await touch('.skill-btn.ult'); // 실제 터치로 궁극기
        if (flag('candidates')) {
          let elapsed = 0;
          for (const frames of [6, 8, 8, 10]) {
            await page.evaluate(n => { for (let i = 0; i < n; i++) app.step(1 / 60, false); }, frames); elapsed += frames;
            if (spec.keyart) await keyartShot(`cand-${String(elapsed).padStart(2, '0')}.png`);
            else { await settle(1); await fs.mkdir(path.join(outDir, '_cand'), { recursive: true }); await page.screenshot({ path: path.join(outDir, '_cand', `${spec.prefix}-ult-${String(elapsed).padStart(2, '0')}.png`), timeout: 180000 }); }
          }
        }
        await page.evaluate(n => { for (let i = 0; i < n; i++) app.step(1 / 60, false); }, flag('candidates') ? 0 : ULT_FRAMES);
        bossDone = true; log('궁극기 포착', JSON.stringify(s));
        await bossShot();
      } else if (s.state === 'ult') { // AUTO가 먼저 궁극기를 쓴 경우
        await page.evaluate(() => { for (let i = 0; i < 25; i++) app.step(1 / 60, false); });
        bossDone = true; await bossShot(); log('궁극기 포착(AUTO 발동)', JSON.stringify(s));
      } else if (s.bossHp < 0.25) { bossDone = true; await bossShot(); log('보스 포착(궁극기 미준비)', JSON.stringify(s)); }
    }
  }
  if (spec.keyart) { await context.close(); return { set: spec.prefix, size: `${spec.width * spec.dpr}x${spec.height * spec.dpr}`, level, seed: SEED, files: { raw: 'work/store-keyart/raw.png' }, pageErrors: errors }; }
  if (!combatDone) log('경고: 전투 장면 조건을 못 맞춤');
  if (!bossDone) log('경고: 보스 장면 조건을 못 맞춤');

  // 05 원정 결과: 정산 UI가 나올 때까지 시간을 더 진행한다.
  for (let i = 0; i < 80; i++) {
    await page.evaluate(() => { for (let k = 0; k < 30; k++) app.step(1 / 60, false); });
    await page.waitForTimeout(200);
    if (await page.locator('.exp-result-shell').isVisible().catch(() => false)) break;
  }
  await page.locator('.exp-result-shell').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await snap('reward', { frames: 2, wait: 800 });

  // 로비 복귀 후 영웅·장비: 실제 전리품 장착
  const lobbyBack = page.locator('button', { hasText: /^로비$/ }).first();
  if (await lobbyBack.isVisible().catch(() => false)) await touch(lobbyBack);
  for (let i = 0; i < 40 && await page.evaluate(() => app.mode !== 'lobby'); i++) { await settle(10, false); await page.waitForTimeout(200); }
  await settle(60, true); await page.waitForTimeout(500); // 마지막 전투 프레임이 패널 뒤에 남지 않게 로비 장면을 한 번 그린다.
  const nav = label => page.locator('button', { hasText: label }).filter({ visible: true }).last();

  // 06 던전 지도
  await touch(nav(/^던전$/));
  if (!await page.locator('[data-journey-node]').first().isVisible().catch(() => false)) {
    await settle(10, false); await page.waitForTimeout(800);
    if (!await page.locator('[data-journey-node]').first().isVisible().catch(() => false)) {
      await touch('#citadel-other-dungeons'); await page.waitForTimeout(800);
      await touch('.adventure-nav [data-section="dungeons"]');
    }
  }
  await page.locator('[data-journey-node]').first().waitFor({ timeout: 30000 });
  await snap('map', { frames: 30, wait: 1000 });

  // 07 영웅·장비
  await touch(nav(/영웅·장비/));
  await page.locator('.bag-item').first().waitFor({ timeout: 30000 });
  for (const slot of ['무기', '방어구', '반지', '신발']) {
    await touch(page.locator('button', { hasText: new RegExp(`^${slot}$`) }).filter({ visible: true }).last());
    await page.waitForTimeout(250);
    const item = page.locator('.bag-item').first();
    if (!await item.isVisible().catch(() => false)) continue;
    await touch(item);
    const equip = page.locator('#i-eq');
    await equip.waitFor({ timeout: 10000 });
    if (slot === '무기') { // 08 장비 상세(강화): 장착 직전 화면
      await settle(10); await page.waitForTimeout(600);
      await save('enhance', await page.screenshot({ timeout: 180000 }));
    }
    await touch(equip);
    await page.waitForTimeout(500);
  }
  await touch(page.locator('button', { hasText: /^전체$/ }).filter({ visible: true }).last()).catch(() => {});
  await snap('hero', { frames: 90, wait: 900 });

  } catch (error) { // 실패 장면을 남겨 원인을 눈으로 확인한다.
    await page.screenshot({ path: path.join(outDir, `_fail-${spec.prefix}.png`), timeout: 60000 }).catch(() => {});
    log('실패', error.message.split('\n')[0], JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 14)).slice(0, 30)).catch(() => [])));
    throw error;
  }
  await context.close();
  if (errors.length) log('pageerror', errors);
  return { set: spec.prefix, size: `${spec.width * spec.dpr}x${spec.height * spec.dpr}`, level, seed: SEED, files, pageErrors: errors };
}
