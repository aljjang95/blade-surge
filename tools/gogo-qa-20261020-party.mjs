// 사이클 20261020-drops-region-party-sfx · A5 파티 원격 타격음 브라우저 QA.
// 실제 로컬 Worker(wrangler dev, Durable Object 포함)에 브라우저 컨텍스트 둘로 붙어 파티를 만들고 전투에 들어간 뒤,
// 게스트 화면에서 재생된 원격 타격음 샘플(실제 AudioBufferSourceNode.start 호출)을 공격자 영웅별로 기록한다.
// 사용:  bun run build && node tools/gogo-qa-20261020-party.mjs --serve --out work/qa/gogo-20261020-party [--guests barbarian,mage,rogue,ranger] [--host knight]
//        이미 wrangler 가 떠 있으면 --serve 대신 --origin http://127.0.0.1:5235/ (APP_ORIGIN 이 그 origin 과 같아야 한다).
// 라운드마다 새 파티: 호스트(기본 knight) + 게스트(영웅 하나). 게스트는 호스트의 타격(호스트 영웅)과 자기 타격(게스트 영웅)을 함께 듣는다.
// 주입(보고서 injected): 오늘 출석 처리, 전투 픽스처(플레이어를 적 옆으로 이동·체력 유지·호스트 자동 전투·게스트 공격 유지).
// 파티 생성·참가·준비·출격과 네트워크 전송·게스트 재생은 실제 UI·실제 WebSocket·실제 게임 코드다. 소스(src/)는 수정하지 않는다.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const PORT = Number(arg('port', '5235'));
const serve = flag('serve');
const origin = serve ? 'http://127.0.0.1:' + PORT + '/' : arg('origin', 'http://127.0.0.1:' + PORT + '/');
const out = path.resolve(arg('out', 'work/qa/gogo-20261020-party'));
const hostHero = arg('host', 'knight');
const guestHeroes = (arg('guests', 'barbarian,mage,rogue,ranger')).split(',').map((s) => s.trim()).filter(Boolean);
const COMBAT_MS = Number(arg('combat-ms', '45000')); // 공격자마다 hit 이벤트가 MIN_HITS 개 모일 때까지 기다리는 최대 시간
const MIN_HITS = Number(arg('min-hits', '4'));
for (const h of [hostHero, ...guestHeroes]) if (!HEROES.includes(h)) throw new Error('알 수 없는 영웅: ' + h);
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('localhost only');
await fs.mkdir(out, { recursive: true });

const report = { tool: 'tools/gogo-qa-20261020-party.mjs', started: new Date().toISOString(), origin, hostHero, guestHeroes,
  scope: '실제 로컬 Worker+Durable Object, 브라우저 컨텍스트 2개(Chromium, SwiftShader), 실제 WebSocket. 실기기·실제 네트워크 지연·청감 평가가 아니다.',
  injected: ['오늘 출석 처리(로비 모달 방지)', '전투 픽스처: 호스트가 모든 파티원을 가장 가까운 적 옆으로 옮기고 체력을 유지하며 호스트 영웅은 자동 전투', '게스트 입력: app.input.press 로 스킬 0~3 반복(터치 대신 같은 입력 큐)'],
  real: ['파티 만들기·참가·준비·함께 출격 실제 클릭', '호스트 시뮬레이션의 타격 → hit 이벤트(hero) → Durable Object 검증·중계 → 게스트 재생'],
  rounds: [], checks: [], pageErrors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log((ok ? 'OK   ' : 'FAIL ') + name, JSON.stringify(detail ?? '').slice(0, 300)); return !!ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 로컬 Worker ----------
let wrangler = null;
async function startWorker() {
  const dir = path.resolve('work/qa/party-sfx'); await fs.mkdir(dir, { recursive: true });
  const config = { name: 'blade-surge-party-qa', main: '../../../worker/index.ts', compatibility_date: '2025-06-01',
    assets: { binding: 'ASSETS', run_worker_first: ['/api/*'], directory: '../../../dist', not_found_handling: 'single-page-application', html_handling: 'auto-trailing-slash' },
    durable_objects: { bindings: [{ name: 'DIALOGUE_BUDGET', class_name: 'DialogueBudget' }, { name: 'PARTIES', class_name: 'PartyRoom' }, { name: 'SOCIAL', class_name: 'SocialHub' }] },
    migrations: [{ tag: 'dialogue-budget-v1', new_sqlite_classes: ['DialogueBudget'] }, { tag: 'party-dungeons-v1', new_sqlite_classes: ['PartyRoom'] }, { tag: 'social-hub-v1', new_sqlite_classes: ['SocialHub'] }],
    vars: { APP_ORIGIN: 'http://127.0.0.1:' + PORT, DIALOGUE_ENABLED: 'false', SOCIAL_ADMIN_IDS: '', SOCIAL_DEV_ORIGINS: 'true', GOOGLE_CLIENT_IDS: '' } };
  await fs.writeFile(path.join(dir, 'wrangler.json'), JSON.stringify(config, null, 2));
  const bin = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'wrangler.exe' : 'wrangler');
  wrangler = spawn(bin, ['dev', '-c', path.join(dir, 'wrangler.json'), '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', path.join(dir, 'state')], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('wrangler dev 시작 시간 초과')), 90000);
    const onData = (d) => { if (String(d).includes('Ready on')) { clearTimeout(timer); resolve(); } };
    wrangler.stdout.on('data', onData); wrangler.stderr.on('data', onData);
    wrangler.on('exit', (code) => reject(new Error('wrangler dev 종료 ' + code)));
  });
  report.worker = 'wrangler dev (로컬, Durable Object 포함) ' + origin;
}
const stopWorker = async () => { if (!wrangler) return; wrangler.removeAllListeners('exit'); if (process.platform === 'win32') spawn('taskkill', ['/pid', String(wrangler.pid), '/T', '/F']); else wrangler.kill(); await sleep(500); };

// ---------- 오디오 계측: 실제로 재생된 샘플 URL ----------
// fetch(/sfx/…) → decodeAudioData → AudioBufferSourceNode.start 를 이어 붙여 빌드된 앱에서도 재생된 샘플 경로를 얻는다.
const AUDIO_HOOK = () => {
  const urlOfBytes = new WeakMap(), urlOfBuffer = new WeakMap(); window.__played = [];
  const nativeFetch = window.fetch;
  window.fetch = async function (...a) {
    const res = await nativeFetch.apply(this, a);
    const u = typeof a[0] === 'string' ? a[0] : a[0]?.url;
    if (u && u.includes('/sfx/')) {
      const native = res.arrayBuffer.bind(res);
      res.arrayBuffer = async () => { const bytes = await native(); urlOfBytes.set(bytes, new URL(u, location.href).pathname); return bytes; };
    }
    return res;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (bytes, ...rest) {
    const u = urlOfBytes.get(bytes); const p = decode.call(this, bytes, ...rest);
    if (u && p?.then) p.then((buffer) => urlOfBuffer.set(buffer, u), () => {});
    return p;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const u = urlOfBuffer.get(this.buffer); if (u) window.__played.push({ t: performance.now(), url: u });
    return start.apply(this, a);
  };
};

// ---------- 세션 ----------
async function openClient(browser, label, heroId, name) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const c = { label, heroId, context, page, hitFrames: [] };
  page.on('pageerror', (e) => report.pageErrors.push(label + ' pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text(); if (m.type() !== 'error' || /Ignored attempt to cancel a touchstart/.test(t)) return;
    const url = m.location()?.url || '';
    // 커뮤니티(/api/social/me)는 로그인 전에 401 이 정상이다. 파티와 무관해 오류로 세지 않고 별도로 센다.
    if (/\/api\/social\/me$/.test(url) && /401/.test(t)) { report.ignoredSocial401 = (report.ignoredSocial401 || 0) + 1; return; }
    report.pageErrors.push(label + ' console: ' + t.slice(0, 200) + (url ? ' @ ' + url.replace(origin, '/') : ''));
  });
  // 받은 snapshot 프레임의 hit 이벤트(hero 포함 여부 관찰)
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    if (typeof f.payload !== 'string' || !f.payload.includes('"hit"')) return;
    try { const m = JSON.parse(f.payload); if (m.type === 'snapshot') for (const e of m.snapshot.events) if (e.type === 'hit') c.hitFrames.push({ hero: e.hero ?? null, value: e.value }); } catch { /* 비 JSON */ }
  }));
  await page.addInitScript(AUDIO_HOOK);
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
  await page.waitForTimeout(700);
  for (let n = 0; n < 4; n++) { const close = page.locator('#modal.show #m-cancel'); if (!await close.isVisible().catch(() => false)) break; await close.tap(); }
  await page.evaluate(() => document.querySelector('#party-open').click());
  await page.getByLabel('모험가 이름', { exact: true }).fill(name);
  await page.getByLabel('파티 영웅', { exact: true }).selectOption(heroId);
  return c;
}

const FIXTURE = () => {
  // 호스트 페이지: 방 하나를 열어 적을 불러낸 뒤, 매 150ms 모든 파티원을 가장 가까운 적 옆으로 옮기고 체력을 유지한다.
  const a = window.app, b = a.battle;
  const room = b.world.rooms.find((r) => r !== b.world.startRoom && !r.cleared) || b.world.rooms[1];
  for (const p of a.party.players.values()) { p.pos.set(room.x, 0, room.z); p.vel?.set(0, 0, 0); }
  b.player.auto = true;
  window.__qaTimer = setInterval(() => {
    const alive = b.enemies.filter((e) => e.alive && !e.spawning);
    for (const p of a.party.players.values()) {
      p.hp = p.maxHp; p.invuln = Math.max(p.invuln || 0, 1);
      if (!alive.length) continue;
      let best = alive[0], d = Infinity; for (const e of alive) { const x = e.pos.distanceToSquared(p.pos); if (x < d) { d = x; best = e; } }
      const i = [...a.party.players.values()].indexOf(p);
      p.pos.set(best.pos.x + 1.1 + 0.3 * i, 0, best.pos.z + 0.4 * i);
      // 게스트는 이동 입력 없이 공격만 보내므로 시선을 적 쪽으로 맞춘다(호스트 영웅은 자동 전투가 맞춘다).
      if (p !== b.player) p.yaw = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
    }
  }, 150);
  return { room: [room.x, room.z], players: [...a.party.players.values()].map((p) => p.def.id) };
};

async function round(browser, guestHero, index) {
  const rec = { index, hostHero, guestHero, checks: [], errors: [] };
  const clients = [];
  try {
    const host = await openClient(browser, 'host', hostHero, '호스트'); clients.push(host);
    const guest = await openClient(browser, 'guest', guestHero, '게스트'); clients.push(guest);
    await host.page.getByRole('button', { name: '파티 만들기', exact: true }).click();
    const code = await host.page.getByLabel('파티 초대 코드', { exact: true }).inputValue();
    await guest.page.getByLabel('초대 코드', { exact: true }).fill(code);
    await guest.page.getByRole('button', { name: '파티 참가', exact: true }).click();
    for (const c of clients) { await c.page.waitForFunction(() => document.querySelectorAll('.party-members li').length === 2); await c.page.getByRole('button', { name: '준비 완료', exact: true }).click(); }
    await host.page.getByRole('button', { name: '함께 출격', exact: true }).click();
    await host.page.waitForFunction(() => { const b = window.app?.battle; return window.app?.party?.run && b?.active && !b.paused && b.elapsed > .5; }, null, { timeout: 120000 });
    await guest.page.waitForFunction(() => window.app?.party?.snapshot && window.app.mode === 'battle', null, { timeout: 60000 });
    rec.joined = true;
    // 게스트가 파티원 영웅 샘플을 실제로 불러왔는지(원격 첫 타격부터 영웅별로 들리는 조건)
    await guest.page.waitForFunction(() => window.__played !== undefined, null, { timeout: 5000 });
    rec.fixture = await host.page.evaluate(FIXTURE);
    // 게스트가 스킬 입력을 반복해 누른다. app.input.press 는 버튼·키보드와 같은 입력 큐이고, 전송(updateGuest)·호스트 시전은 그대로다.
    // 게스트의 기본 공격(attack)은 호스트 RemoteInput 이 큐에 넣지 않아 호스트에서 실행되지 않으므로(별도 보고) 스킬로 검증한다.
    await guest.page.evaluate(() => { let n = 0; window.__qaPress = setInterval(() => { window.app.input.press('skill' + (n++ % 4)); }, 450); });
    const deadline = Date.now() + COMBAT_MS;
    while (Date.now() < deadline && ![hostHero, guestHero].every((h) => guest.hitFrames.filter((f) => f.hero === h).length >= MIN_HITS)) await sleep(500);
    rec.remoteInputs = await host.page.evaluate(() => [...window.app.party.inputs.entries()].map(([id, i]) => { const p = window.app.party.players.get(id);
      return { hero: p.def.id, local: p === window.app.battle.player, attackHeld: i.attackHeld, age: Math.round(performance.now() - i.last), alive: p.alive, state: p.state, mp: Math.round(p.mp ?? 0), stun: p.stun, cast: p.casting ?? null }; }));
    rec.guestState = await guest.page.evaluate(() => ({ hidden: document.hidden, paused: window.app.battle.paused, snapPaused: window.app.party.snapshot?.paused, held: window.app.input.attackHeld, mode: window.app.mode }));
    rec.hostSimHits = await host.page.evaluate(() => ({ kills: window.app.battle.kills, enemies: window.app.battle.enemies.filter((e) => e.alive).length, dmg: Math.round(window.app.battle.dmgDealt) }));
    const played = await guest.page.evaluate(() => window.__played);
    const heroHit = (h) => played.filter((p) => p.url.includes('/hero/' + h + '/hit_')).length;
    rec.guestPlayed = { total: played.length, heroHitLayerByHero: Object.fromEntries(HEROES.map((h) => [h, heroHit(h)])),
      samples: Object.fromEntries([...new Set(played.map((p) => p.url))].sort().map((u) => [u, played.filter((p) => p.url === u).length])) };
    const frames = guest.hitFrames;
    rec.guestReceivedHits = { total: frames.length, byHero: Object.fromEntries(HEROES.map((h) => [h, frames.filter((f) => f.hero === h).length])), withoutHero: frames.filter((f) => f.hero === null).length };
    const attackers = [...new Set([hostHero, guestHero])];
    const ok = (name, v, detail) => { rec.checks.push({ name, ok: !!v, ...(detail === undefined ? {} : { detail }) }); check('라운드' + index + ' ' + name, v, detail); };
    ok('호스트가 적을 실제로 때렸다', rec.hostSimHits.dmg > 0, rec.hostSimHits);
    ok('게스트가 hero 가 실린 hit 이벤트를 받았다', rec.guestReceivedHits.total > 0 && rec.guestReceivedHits.withoutHero === 0, rec.guestReceivedHits);
    for (const h of attackers) {
      ok('공격자 ' + h + ': 이벤트 수신', rec.guestReceivedHits.byHero[h] > 0, rec.guestReceivedHits.byHero[h]);
      ok('공격자 ' + h + ': 게스트가 hero/' + h + '/hit_* 영웅 타격 레이어 재생', rec.guestPlayed.heroHitLayerByHero[h] > 0, rec.guestPlayed.heroHitLayerByHero[h]);
    }
    const stray = HEROES.filter((h) => !attackers.includes(h) && heroHit(h) > 0);
    ok('공격하지 않은 영웅의 타격 레이어는 재생되지 않았다', stray.length === 0, stray);
    await guest.page.screenshot({ path: path.join(out, 'round' + index + '-guest-' + guestHero + '.png') });
    await host.page.screenshot({ path: path.join(out, 'round' + index + '-host-' + hostHero + '.png') });
  } catch (error) {
    rec.errors.push(String(error?.stack || error).slice(0, 600)); check('라운드' + index + ' 진행', false, rec.errors[0]);
  } finally {
    for (const c of clients) await c.context.close().catch(() => {});
  }
  report.rounds.push(rec);
}

let browser = null;
try {
  if (serve) await startWorker();
  browser = await chromium.launch(launchOpts());
  report.browserVersion = browser.version();
  for (let i = 0; i < guestHeroes.length; i++) await round(browser, guestHeroes[i], i + 1);
  // 전체: 공격자 영웅별로 서로 다른 샘플이 재생됐다.
  const sampleSets = {};
  for (const r of report.rounds) for (const h of [r.hostHero, r.guestHero]) {
    const set = Object.keys(r.guestPlayed?.samples || {}).filter((u) => u.includes('/hero/' + h + '/hit_'));
    if (set.length) sampleSets[h] = [...new Set([...(sampleSets[h] || []), ...set])].sort();
  }
  report.heroHitSamplesByAttacker = sampleSets;
  const heard = Object.keys(sampleSets);
  check('재생된 공격자 영웅이 호스트+게스트 영웅 전체를 덮는다', [hostHero, ...guestHeroes].every((h) => heard.includes(h)), heard);
  const flat = Object.values(sampleSets).flat();
  check('영웅마다 샘플이 서로 겹치지 않는다', new Set(flat).size === flat.length, sampleSets);
  check('콘솔·페이지 오류 0', report.pageErrors.length === 0, report.pageErrors.slice(0, 5));
} catch (error) {
  check('QA 실행', false, String(error?.stack || error).slice(0, 600));
} finally {
  await browser?.close().catch(() => {});
  await stopWorker();
  report.finished = new Date().toISOString(); report.pass = report.checks.length > 0 && report.checks.every((c) => c.ok);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('결과:', report.pass ? 'PASS' : 'FAIL', '->', path.join(out, 'report.json'));
  process.exitCode = report.pass ? 0 : 1;
}
