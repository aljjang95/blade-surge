/**
 * 게이트 B 보조 — 컴파일된 게임의 5영웅 기본 콤보·회피 연계 HUD 시각 fixture.
 *   node tools/shot_combo.mjs [새 출력폴더=.rsi/shots/combo-시각] [영웅=knight,barbarian,mage,rogue,ranger]
 * Input.press/Player.canQueueCombo로 진행한다. 고정 시계·변경된 Lv5/적 무리이므로 자연 플레이 검증이 아니다.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';
import { launchOpts } from './chrome.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const PROJ = fileURLToPath(new URL('..', import.meta.url));
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const OUT = resolve(PROJ, process.argv[2] || `.rsi/shots/combo-${stamp}`);
const HEROES = (process.argv[3] || 'knight,barbarian,mage,rogue,ranger').split(',');
const ALL_HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const AUTHORED_COUNTS = { knight: 6, barbarian: 5, mage: 5, rogue: 6, ranger: 5 };
const DT = 1 / 120;
const assert = (condition, message) => { if (!condition) throw Error(message); };
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: PROJ, encoding: 'utf8' }).trim();
const reportFile = join(OUT, 'report.json');
assert(!existsSync(reportFile), `기존 결과를 덮어쓰지 않습니다: ${reportFile}`);
mkdirSync(OUT, { recursive: true });
const report = {
  schemaVersion: 2, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Compiled-game visual fixture: real Input.press, Player query/transition/hit methods and app.step. Not natural play, native pointer input, performance or physical-device evidence.',
  viewport: { width: 880, height: 400 }, dt: DT,
  limitations: ['Google font CDN responses retain the former harness empty-CSS stub; screenshots use installed fallback fonts.',
    'Fresh isolated browser saves are prepared at level 5, with tutorial completed and manual control.',
    'Ten spawned visual targets use HP=1000000, ATK=0 and attack cooldown=1000000; these are not normal combat balance.',
    'Bomber behavior remains real: its warmup explosion can cause minimum damage, hit recovery and target loss. First attack waits for actual idle readiness; surviving targets are recorded.',
    'Knight perfect-dodge cut injects one incoming Player.hurt(1) while actual dodge invulnerability is active; no direct counterWindow assignment.'],
  heroes: [], errors: [], failedRequests: [], source: null, build: null,
};
let server, browser, activePage;
const persist = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');

try {
  assert(HEROES.length && new Set(HEROES).size === HEROES.length && HEROES.every(hero => ALL_HEROES.includes(hero)), '지원하지 않거나 중복된 영웅');
  const files = git('ls-files', '-co', '--exclude-standard', '--', 'src', 'index.html', 'vite.config.js', 'package.json', 'bun.lock')
    .split('\n').filter(Boolean).filter(file => existsSync(join(PROJ, file)) && statSync(join(PROJ, file)).isFile());
  const sources = Object.fromEntries([...new Set(files)].sort().map(file => [file, hash(join(PROJ, file))]));
  report.source = { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    dirty: !!git('status', '--porcelain'), files: sources, toolSha256: hash(fileURLToPath(import.meta.url)) };
  const version = JSON.parse(readFileSync(join(PROJ, 'dist/version.json'), 'utf8'));
  const buildTime = Date.parse(version.builtAt);
  assert(version.sha === report.source.head && Number.isFinite(buildTime), '현재 HEAD와 dist/version.json이 다릅니다. 먼저 이 후보를 빌드하세요.');
  const newer = Object.keys(sources).filter(file => statSync(join(PROJ, file)).mtimeMs > buildTime + 1000);
  assert(!newer.length, `소스보다 오래된 빌드입니다: ${newer.join(', ')}`);
  const entries = [...readFileSync(join(PROJ, 'dist/index.html'), 'utf8').matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]);
  assert(entries.length, '빌드의 실제 JS/CSS 진입점 누락');
  const entryAssets = Object.fromEntries([...new Set(entries)].sort().map(file => [file, hash(join(PROJ, 'dist', file))]));
  report.build = { version, indexSha256: hash(join(PROJ, 'dist/index.html')), versionSha256: hash(join(PROJ, 'dist/version.json')), entryAssets };
  server = await preview({ root: PROJ, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const servedVersion = await (await fetch(`${origin}/version.json`, { cache: 'no-store' })).json();
  assert(JSON.stringify(servedVersion) === JSON.stringify(version), '브라우저 서버의 빌드 식별자 불일치');
  report.build.servedVersion = servedVersion;
  browser = await chromium.launch(launchOpts({ headless: true }));
  for (const hero of HEROES) {
    const context = await browser.newContext({ viewport: report.viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(90000);
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ hero, kind: 'console', message: message.text() }); });
    page.on('pageerror', error => report.errors.push({ hero, kind: 'pageerror', message: error.message }));
    page.on('requestfailed', request => report.failedRequests.push({ hero, url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) report.errors.push({ hero, kind: 'http', status: response.status(), url: response.url() }); });
    // 기존 하네스와 동일한 외부 폰트 격리. 실제 폰트 품질 증거로 사용하지 않는다.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(origin);
    await page.locator('#boot-start:not(.hidden)').waitFor();
    const preparation = await page.evaluate(hero => {
      const app = window.app, eco = app.eco;
      if (!eco.reset()) throw Error('독립 저장 초기화 실패');
      const before = { selected: eco.s.selected, level: eco.hero(hero)?.level, energy: eco.s.energy, inventory: eco.s.inventory.length };
      const granted = !eco.ownHero(hero); if (granted) eco.grantHero(hero);
      eco.s.daily.last = Math.floor(Date.now() / 86400000); eco.s.tutorial = { completed: true };
      eco.s.selected = hero; eco.hero(hero).level = 5; eco.hero(hero).exp = 0;
      if (!eco.save()) throw Error('fixture 저장 실패');
      if (app.journey.setAuto(false)?.ok !== true) throw Error('수동 조작 저장 실패');
      return { before, granted, after: { selected: hero, level: eco.hero(hero).level, energy: eco.s.energy,
        inventory: eco.s.inventory.length, tutorialCompleted: true, auto: false } };
    }, hero);
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app.mode === 'lobby' && !document.getElementById('boot').classList.contains('show'));
    await page.evaluate(() => { window.app.ui.closeModal(); window.app.testPause = true; });
    const run = { hero, preparation, fixture: null, attacks: [], followup: [], status: 'running' };
    report.heroes.push(run); persist();
    run.fixture = await page.evaluate(async ({ hero, dt }) => {
      const app = window.app;
      let seed = 20261008;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const started = await app.startStage(app.eco.nextStage());
      if (started !== true || !app.battle.active || app.battle.player.def.id !== hero) throw Error('요청 영웅의 실제 출격 실패');
      const battle = app.battle, player = battle.player;
      if (player.auto || !battle.input.enabled || battle.paused) throw Error('수동 입력 불가');
      app.input.clear();
      // 실패도 원래 입력/시간/피격 경로를 그대로 남긴다. 관찰 래퍼는 반환값과 인자를 바꾸지 않는다.
      const hits = [], presses = [], consumes = [], hurts = [], observations = [];
      let frame = 0, phase = 'warmup', lastSemantic = '';
      const snapshot = () => ({ frame, phase, elapsed: battle.elapsed,
        app: { mode: app.mode, expeditionOpened: !!app.expeditionUI?.opened, stageStarting: !!app.stageStarting,
          contextLost: !!app.contextLost, testPause: !!app.testPause, documentHidden: document.hidden },
        battle: { active: battle.active, paused: battle.paused, pending: battle.pending?.length ?? battle.pending ?? null,
          enemyCount: battle.enemies.length, aliveEnemies: battle.enemies.filter(enemy => enemy.alive).length,
          timeCtl: Object.fromEntries(Object.entries(battle.timeCtl).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean')) },
        input: { sameAsApp: app.input === battle.input, enabled: battle.input.enabled, queue: [...battle.input.queue],
          attackHeld: battle.input.attackHeld, move: { ...battle.input.move } },
        player: { state: player.state, stateT: player.stateT, alive: player.alive, auto: player.auto, hp: player.hp,
          stun: player.stun, index: player.comboIdx, currentIndex: player.def.combo.indexOf(player.current),
          hitDone: player.hitDone, progress: player.state === 'attack' ? player.attackProgress() : null,
          attackBufferT: player.attackBufferT, comboQueued: player.comboQueued, dodgeBufferT: player.dodgeBufferT,
          comboResume: player.comboResume ? { ...player.comboResume } : null, counterWindow: player.counterWindow },
        bombers: battle.enemies.filter(enemy => enemy.behavior === 'bomber').map(enemy => ({ name: enemy.def.name,
          species: enemy.runtimeSpeciesId || null, state: enemy.state, fuse: enemy.fuse, alive: enemy.alive,
          distance: Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.z - player.pos.z) })) });
      const observe = label => {
        const state = snapshot();
        const semantic = JSON.stringify([state.app, state.battle.active, state.battle.paused, state.battle.pending,
          state.battle.aliveEnemies, state.input, state.player.state, state.player.hp, state.player.index,
          state.player.hitDone, state.player.attackBufferT > 0, state.player.comboQueued,
          state.bombers.map(enemy => [enemy.state, enemy.alive, enemy.fuse >= 0])]);
        if (label || semantic !== lastSemantic || frame % 60 === 0) observations.push({ label: label || 'frame', ...state });
        lastSemantic = semantic;
      };
      const hit = player.doComboHit, hurt = player.hurt, consume = battle.input.consume;
      player.doComboHit = function(tick = 0) {
        const event = { index: this.comboIdx, tick, hitDone: this.hitDone, state: this.state, elapsed: battle.elapsed, progress: this.attackProgress() };
        const result = hit.apply(this, arguments); hits.push({ ...event, counterAfter: this.counterWindow }); return result;
      };
      player.hurt = function(damage, options) {
        const before = snapshot(), result = hurt.apply(this, arguments);
        hurts.push({ damage, options: options ? { ...options } : null, result, before, after: snapshot() }); return result;
      };
      battle.input.consume = function(action) {
        const before = this.queue.includes(action) ? snapshot() : null, result = consume.apply(this, arguments);
        if (before || result) consumes.push({ action, result, before, after: snapshot() }); return result;
      };
      window.__comboShot = { hits, presses, consumes, hurts, observations, snapshot };
      observe('before-targets');
      const roster = battle.stage.rosterFor('normal'), targets = [];
      for (let index = 0; index < 10; index++) {
        const angle = index / 10 * Math.PI * 2;
        const point = player.pos.clone().add({ x: Math.cos(angle) * 3.2, y: 0, z: Math.sin(angle) * 3.2 });
        const species = roster.trash[index % roster.trash.length];
        const enemy = battle.spawnEnemy(species, null, battle.world.startRoom, point);
        if (!enemy) throw Error(`fixture 적 ${index} 생성 실패`);
        const before = { hp: enemy.hp, maxHp: enemy.maxHp, atk: enemy.atk, atkCd: enemy.atkCd };
        enemy.hp = enemy.maxHp = 1000000; enemy.atk = 0; enemy.atkCd = 1000000;
        targets.push({ species, name: enemy.def.name, behavior: enemy.behavior, before, after: { hp: enemy.hp, maxHp: enemy.maxHp, atk: enemy.atk, atkCd: enemy.atkCd } });
      }
      for (let warmup = 0; warmup < 150; warmup++) { app.step(dt, false); frame++; observe(); }
      observe('after-warmup'); phase = 'combo';
      const verify = () => { if (!battle.active || !player.alive || player.auto || battle.paused || !battle.input.enabled) throw Error('fixture 전투 입력 경계 이탈'); };
      const step = () => { verify(); app.step(dt, false); frame++; observe(); verify(); };
      const wait = (predicate, limit = 600) => { for (let frame = 0; frame < limit && !predicate(); frame++) step(); if (!predicate()) throw Error('실제 전이 제한시간 초과'); };
      const press = (action, purpose) => {
        verify(); phase = purpose;
        const before = snapshot(); battle.input.press(action);
        presses.push({ action, purpose, index: player.comboIdx, state: player.state, progress: player.state === 'attack' ? player.attackProgress() : null,
          elapsed: battle.elapsed, before, after: snapshot() }); observe('press');
      };
      const contact = expected => {
        const offset = hits.length; let before = null, rising = false;
        for (let frame = 0; frame < 600; frame++) {
          before = { index: player.comboIdx, state: player.state, hitDone: player.hitDone };
          step();
          const fresh = hits.slice(offset).filter(event => event.tick === 0);
          if (!fresh.length) continue;
          if (fresh.length !== 1 || fresh[0].index !== expected || !fresh[0].hitDone) throw Error(`잘못된 타격 순서: expected ${expected}, got ${JSON.stringify(fresh)}`);
          rising = player.comboIdx === expected && player.hitDone && (before.index !== expected || !before.hitDone);
          if (!rising || player.state !== 'attack' || player.current !== player.def.combo[expected]) throw Error('hitDone 접촉 경계 불일치');
          app.step(0, true);
          return { ...fresh[0], hitDoneRising: rising, before, combo: battle.combo, move: player.current.move || null };
        }
        throw Error(`타격 ${expected}가 발생하지 않았습니다`);
      };
      const queue = expected => {
        wait(() => player.state === 'attack' && player.canQueueCombo());
        if (player.comboIdx !== expected - 1) throw Error(`다음 타 예약 전 인덱스 불일치 ${player.comboIdx}/${expected}`);
        press('attack', `combo-${expected}`);
      };
      Object.assign(window.__comboShot, { step, wait, press, contact, queue });
      return { hero: player.def.id, level: player.heroLevel, hp: player.hp, maxHp: player.maxHp,
        stage: battle.stage.code, comboCount: player.def.combo.length, targetCount: targets.length,
        survivedTargetsAfterWarmup: battle.enemies.filter(enemy => enemy.alive).length, targets, seed: 20261008, warmupFrames: 150 };
    }, { hero, dt: DT });
    const count = run.fixture.comboCount;
    assert(count === AUTHORED_COUNTS[hero], `예상한 27타 계약이 변경됨: ${hero}/${count}`);
    run.readiness = await page.evaluate(() => {
      const { battle } = window.app, player = battle.player, driver = window.__comboShot;
      const before = driver.snapshot();
      // 자폭 피격의 실제 경직이 끝난 뒤 첫 입력을 한 번 보낸다. 상태/버퍼를 직접 지우지 않는다.
      driver.wait(() => player.state === 'idle' && player.stun <= 0 && player.attackBufferT <= 0 &&
        battle.input.queue.length === 0 && !player.comboResume);
      return { before, after: driver.snapshot(), waitedFrames: driver.snapshot().frame - before.frame,
        survivedTargets: battle.enemies.filter(enemy => enemy.alive).map(enemy => ({ species: enemy.runtimeSpeciesId, name: enemy.def.name })) };
    });
    persist();
    for (let index = 0; index < count; index++) {
      const info = await page.evaluate(index => {
        const driver = window.__comboShot;
        if (index === 0) driver.press('attack', 'combo-0'); else driver.queue(index);
        return driver.contact(index);
      }, index);
      const name = `combo_${hero}_${String(index + 1).padStart(2, '0')}.png`;
      const hud = await page.evaluate(() => {
        const button = document.getElementById('btn-attack'), dodge = document.querySelector('#btn-dodge .dodge-cd');
        const controls = [button, document.getElementById('btn-dodge')].map(node => ({ id: node.id, rect: node.getBoundingClientRect().toJSON() }));
        const copy = [...button.querySelectorAll('.attack-combo-label,.attack-combo-stage,.attack-combo-cue')].map(node => ({ text: node.textContent, hidden: node.hidden, scrollWidth: node.scrollWidth, width: node.clientWidth, font: getComputedStyle(node).font }));
        return { status: button.dataset.comboStatus, stage: Number(button.dataset.comboStage), total: Number(button.dataset.comboTotal),
          aria: button.getAttribute('aria-label'), controls, copy, dodgeHidden: dodge.hidden, dodgeDisplay: getComputedStyle(dodge).display };
      });
      assert(info.index === index && info.hitDoneRising && hud.stage === index + 1 && hud.total === count, `실제 타수/HUD 불일치 ${hero}/${index}`);
      assert(hud.copy.every(item => item.hidden || item.scrollWidth <= item.width + 1), `공격 버튼 문구 넘침 ${hero}/${index}`);
      assert(hud.controls.every(({ rect }) => rect.left >= 0 && rect.top >= 0 && rect.right <= 880 && rect.bottom <= 400), '조작 버튼이 전체 프레임 밖에 있음');
      await page.screenshot({ path: join(OUT, name) });
      const png = readFileSync(join(OUT, name));
      assert(png.readUInt32BE(16) === 880 && png.readUInt32BE(20) === 400, 'PNG 전체 프레임 크기 불일치');
      run.attacks.push({ ...info, hud, screenshot: name, sha256: hash(join(OUT, name)), width: 880, height: 400 });
      persist();
    }
    if (hero === 'knight') {
      const cut = async (name, action) => {
        const state = await page.evaluate(action);
        const file = `followup_${name}.png`;
        await page.screenshot({ path: join(OUT, file) });
        const png = readFileSync(join(OUT, file));
        assert(png.readUInt32BE(16) === 880 && png.readUInt32BE(20) === 400, `후속 PNG 전체 프레임 크기 불일치: ${name}`);
        run.followup.push({ name, ...state, screenshot: file, sha256: hash(join(OUT, file)), width: 880, height: 400 }); persist();
      };
      await cut('dodge-resume', () => {
        const a = window.app, p = a.battle.player, d = window.__comboShot;
        d.wait(() => p.state === 'idle' && p.dodgeCd <= 0);
        d.press('attack', 'followup-first'); d.contact(0);
        d.queue(1); d.contact(1); d.queue(2); d.contact(2);
        d.wait(() => p.canDodgeCancel());
        d.press('dodge', 'followup-dodge'); d.step();
        if (p.state !== 'dodge' || p.comboResume?.idx !== 3) throw Error('실제 회피 연계 보존 실패');
        a.step(0, true);
        const button = document.getElementById('btn-attack');
        if (button.dataset.comboStatus !== 'dodge-resume' || button.dataset.comboStage !== '4') throw Error('회피 연계 HUD 불일치');
        return { state: p.state, resume: { ...p.comboResume }, counterWindow: p.counterWindow, text: button.innerText, aria: button.getAttribute('aria-label') };
      });
      await cut('perfect-counter', () => {
        const a = window.app, p = a.battle.player, before = { hp: p.hp, counterWindow: p.counterWindow, perfectWindow: p.perfectWindow, invuln: p.invuln };
        const accepted = p.hurt(1, { kb: 2, dirx: 1 });
        if (accepted !== false || p.hp !== before.hp || !(p.counterWindow > before.counterWindow)) throw Error('Player.hurt의 실제 퍼펙트 회피 경로 실패');
        a.step(0, true);
        const button = document.getElementById('btn-attack');
        if (button.dataset.counterActive !== 'true') throw Error('마무리 강화 HUD 불일치');
        return { injectedIncomingHit: { damage: 1, kb: 2, dirx: 1 }, before, after: { hp: p.hp, counterWindow: p.counterWindow },
          state: p.state, resume: { ...p.comboResume }, text: button.innerText, aria: button.getAttribute('aria-label') };
      });
      await cut('resume-ready', () => {
        const a = window.app, p = a.battle.player, d = window.__comboShot;
        d.wait(() => p.state === 'idle'); a.step(0, true);
        const button = document.getElementById('btn-attack');
        if (button.dataset.comboStatus !== 'resume' || p.comboResume?.idx !== 3) throw Error('실제 회피 복귀/HUD 불일치');
        return { state: p.state, resume: { ...p.comboResume }, counterWindow: p.counterWindow, text: button.innerText, aria: button.getAttribute('aria-label') };
      });
      await cut('counter-consumed', () => {
        const a = window.app, p = a.battle.player, d = window.__comboShot;
        d.press('attack', 'followup-resume'); d.contact(3); d.queue(4); d.contact(4); d.queue(5); d.contact(5);
        if (p.counterWindow !== 0) throw Error('실제 마무리의 강화 소비 실패');
        a.step(0, true);
        const button = document.getElementById('btn-attack');
        if (button.dataset.counterActive !== 'false') throw Error('소비된 마무리 강화가 HUD에 잔류');
        return { state: p.state, index: p.comboIdx, hitDone: p.hitDone, counterWindow: p.counterWindow, text: button.innerText, aria: button.getAttribute('aria-label') };
      });
    }
    run.trace = await page.evaluate(() => {
      const { hits, presses, consumes, hurts, observations, snapshot } = window.__comboShot;
      return { hits, presses, consumes, hurts, observations, final: snapshot() };
    });
    assert(run.attacks.length === count, '영웅 타격 컷 누락');
    assert(report.errors.length === 0, `런타임 오류: ${JSON.stringify(report.errors)}`);
    run.status = 'pass'; persist();
    await context.close();
    activePage = null;
    console.log(JSON.stringify({ hero, attacks: run.attacks.length, followup: run.followup.length, status: run.status }));
  }
  const expected = HEROES.reduce((total, hero) => total + AUTHORED_COUNTS[hero], 0);
  assert(report.heroes.reduce((total, run) => total + run.attacks.length, 0) === expected, '전체 27타 순서/컷 누락');
  assert(report.errors.length === 0, '런타임 오류');
  for (const [file, digest] of Object.entries(report.source.files)) assert(hash(join(PROJ, file)) === digest, `촬영 중 소스 변경: ${file}`);
  assert(hash(join(PROJ, 'dist/version.json')) === report.build.versionSha256 && hash(join(PROJ, 'dist/index.html')) === report.build.indexSha256, '촬영 중 빌드 변경');
  for (const [file, digest] of Object.entries(report.build.entryAssets)) assert(hash(join(PROJ, 'dist', file)) === digest, `촬영 중 빌드 진입점 변경: ${file}`);
  report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1;
  if (report.heroes.at(-1)?.status === 'running') report.heroes.at(-1).status = 'fail';
  if (activePage && !activePage.isClosed()) {
    const run = report.heroes.at(-1);
    try {
      const trace = await activePage.evaluate(() => {
        const driver = window.__comboShot;
        if (!driver) return { appMode: window.app?.mode, note: 'fixture 관찰기 설치 전 실패' };
        const { hits, presses, consumes, hurts, observations, snapshot } = driver;
        return { hits, presses, consumes, hurts, observations, final: snapshot() };
      });
      if (run) run.trace = trace; else report.failureTrace = trace;
      const file = `failure_${run?.hero || 'setup'}.png`;
      // 실패 시 추가 app.step을 호출하지 않아 큐·상태를 바꾸지 않는다. 직전 렌더 화면을 보존한다.
      await activePage.screenshot({ path: join(OUT, file) });
      report.failureScreenshot = { screenshot: file, sha256: hash(join(OUT, file)), note: 'Last rendered frame; no extra simulation step on failure.' };
    } catch (diagnosticError) { report.diagnosticFailure = String(diagnosticError?.stack || diagnosticError); }
  }
} finally {
  if (browser) await browser.close().catch(error => { report.errors.push({ kind: 'browser-close', message: error.message }); report.status = 'fail'; process.exitCode = 1; });
  if (server) await new Promise(resolveClose => server.httpServer.close(resolveClose));
  report.completedAt = new Date().toISOString(); persist();
  console.log(JSON.stringify({ status: report.status, out: OUT, heroes: report.heroes.length, failure: report.failure }));
}
