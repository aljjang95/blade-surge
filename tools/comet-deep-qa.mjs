#!/usr/bin/env node
// 혜성 요새 심층(comet_bastion/deep) 궤도 고리 실제 UI QA 도구 (BUNDLE-01 worldui lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 고리별 phase 타임라인을 기록한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 고리(kind === 'deep-orbits')가 없는 기준선 빌드에서는 고리 검사를 건너뛰고 같은 측정만 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';

const HELP = `사용법: node tools/comet-deep-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]

필수
  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha
  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)

옵션
  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다.
  --profile=<목록>          auto|fail|pause|giveup|save-fault|refresh|retry|touch|screens|all (쉼표로 여러 개, 기본 auto)
  --seed=<uint32>           Math.random 시드(기본 20261015)
  --hero=<id>               fixture 영웅(기본 knight)
  --viewport=WxH            기본 844x390
  --motion=reduce|no-preference   브라우저 prefers-reduced-motion(기본 reduce)
  --quality=low|default     low 면 설정 핸들러와 같은 경로(settings.quality='low' + applySettings)로 낮은 화질
  --origin=<url>            공유 런타임 옵션(로컬 preview 또는 고정 라이브 주소만 허용)
  --help                    이 도움말

프로필(F = fixture, R = 실제 UI·입력, C = 제어 실행)
  auto       F 저장 주입(해금·영웅·장비·에너지) → R 출격 버튼 → R AUTO → C 고정 1/60 스텝 완주 → R 결과 → R 새로고침 보존
  fail       고리 하나를 AUTO 로 밀기 시작한 뒤 R AUTO 끔으로 멈춰 붕괴 실패(0.1 표시 다음 프레임) 확인 후 다시 연결(고리 빌드만)
  pause      R #btn-pause/#btn-resume 중 시계·폭풍 예고 정지 확인
  giveup     R #btn-giveup 패배 결과 → R 다시 도전(새 티켓·새 컨트롤러·이전 뷰 dispose·에너지 재차감)
  save-fault 승리 정산에 eco.save 실패 주입(F, 이 프로필 안에서만) → R 정산 다시 저장 → 보상 1회
  refresh    전투 중 R 새로고침: pending 취소·에너지 1회 환급
  retry      승리 → R 다시 도전 → 새 컨트롤러 완주 후 첫 보상 미지급
  touch      R CDP 터치 이벤트(가상 조이스틱)로 1고리 밀기·쉼터·폭풍 회피(에뮬레이터 입력, 실기기 아님)
  screens    준비·붕괴·쉼터·폭풍 예고·보스·결과 순간마다 여러 viewport 스크린샷(PNG)

주의: 좌표 이동·무적·HP 주입으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.
SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다.`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'fail', 'pause', 'giveup', 'save-fault', 'refresh', 'retry', 'touch', 'screens'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
const seed = Number(arg('seed', '20261015'));
qaAssert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, '--seed must be uint32');
const heroId = arg('hero', 'knight');
const viewportMatch = /^(\d{3,4})x(\d{3,4})$/.exec(arg('viewport', '844x390'));
qaAssert(viewportMatch, '--viewport must be WxH');
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
const motion = arg('motion', 'reduce');
qaAssert(['reduce', 'no-preference'].includes(motion), '--motion must be reduce|no-preference');
const quality = arg('quality', 'default');
qaAssert(['low', 'default'].includes(quality), '--quality must be low|default');
const needsTouch = selected.includes('touch');
const contextOptions = { reducedMotion: motion, ...(needsTouch ? { hasTouch: true, isMobile: true } : {}) };
const SCREEN_VIEWPORTS = [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
const SAVE_KEY = 'bladesurge_save_v1';
const DUNGEON_ID = 'comet_bastion';
const RING_ROOMS = [1, 2, 3, 5, 7];
const FRAME = 1 / 60;

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다).
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const depthDef = EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID);
qaAssert(depthDef, 'Target project has no ' + DUNGEON_ID + ' deep definition');

const report = { kind: 'comet-deep-qa', releaseApproved: false, seed, heroId, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)), profiles: {}, checks: [],
  catalog: { id: depthDef.id, energy: depthDef.energy, unlockCode: depthDef.unlockCode, minLevel: depthDef.minLevel, rewards: depthDef.rewards,
    firstRewards: depthDef.firstRewards, objective: depthDef.objective },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨·기본 원정 승리)·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)', quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null,
      selected.includes('save-fault') ? 'save-fault 프로필 한정 eco.save 실패 주입' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → 심층 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume/#btn-giveup', '결과 화면 버튼(다시 도전·정산 다시 저장·로비)', '선택지 모달 버튼',
      '브라우저 새로고침', needsTouch ? 'CDP 터치 이벤트(가상 조이스틱, 에뮬레이터)' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스'] },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/comet-deep-orbit-view.js', 'src/game/comet-deep-orbits.js', 'src/game/route-objectives.js', 'src/data/route-objectives.js',
  'src/data/expedition-depths.js', 'src/ui/battle-objective-view.js', 'src/expansion/hub.jsx', 'src/game/battle-base.js', 'src/game/expedition-economy.js',
  'src/main.js'].filter(file => fs.existsSync(path.join(projectRoot, file)));
const qa = await createExpeditionQa({ root: projectRoot, driver: import.meta.filename, report, sourceFiles });
let page;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };

// ---------- 페이지 안 측정 프로브(게임 판정에는 쓰지 않는다) ----------
function installProbe({ ringRooms }) {
  const app = window.app;
  const P = window.__deepQa = { dt: 1 / 60, ringRooms, steps: 0 };
  const routeOf = () => app.battle.routeObjectives;
  const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const gateRows = () => (routeOf()?.gates || []).map(g => ({ room: g.room.id, phase: g.phase, clock: g.clock, connectT: g.connectT, slack: g.slack, failures: g.failures, hits: g.hits,
    stormIndex: g.stormIndex, stormWarn: !!g.stormWarn, stormWarnT: g.stormWarnT, lockT: g.lockT, angle: g.angle, present: !!g.present }));
  P.begin = () => {
    const b = app.battle, r = routeOf();
    Object.assign(P, { events: [], hpDrops: [], clears: [], samples: [], stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, trace: [], steps: 0,
      sampledRooms: new Set(), stormSampled: new Set(), startElapsed: b.elapsed });
    P.prev = { phase: (r?.gates || []).map(g => g.phase), warn: (r?.gates || []).map(g => !!g.stormWarn), cleared: b.world.rooms.map(x => !!x.cleared),
      hp: b.player.hp, room: b.curRoom?.id ?? null };
    return { kind: r?.def?.kind ?? null, gates: gateRows().length, rooms: b.world.rooms.length };
  };
  P.viewState = () => {
    const v = routeOf()?.view; if (!v?.entries) return null;
    return { groupVisible: v.group.visible, disposed: !!v.disposed, gates: v.entries.map(e => {
      let meshes = 0; e.root.traverse(o => { if (o.isMesh && o.visible) meshes++; });
      return { rootVisible: e.root.visible, meshes: e.root.visible ? meshes : 0, red: e.red.visible, ring: e.ring.visible, arc: e.arc.visible, fill: e.fill.visible }; }) };
  };
  P.sample = label => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const row = { label, t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2), view: P.viewState() };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, r = routeOf(), t = b.elapsed, p = b.player;
    (r?.gates || []).forEach((g, i) => {
      if (g.phase !== P.prev.phase[i]) {
        P.events.push({ t, kind: 'phase', gate: i, room: g.room.id, from: P.prev.phase[i], to: g.phase, clock: g.clock, connectT: g.connectT, slack: g.slack,
          failures: g.failures, hits: g.hits, hpRatio: p.hp / p.maxHp, here: r.here?.id ?? null });
        P.prev.phase[i] = g.phase;
      }
      if (!!g.stormWarn !== P.prev.warn[i]) {
        P.events.push({ t, kind: 'stormWarn', gate: i, room: g.room.id, on: !!g.stormWarn, stormIndex: g.stormIndex, warnT: g.stormWarnT });
        P.prev.warn[i] = !!g.stormWarn;
        if (g.stormWarn && !P.stormSampled.has(g.room.id)) { P.stormSampled.add(g.room.id); P.sample('stormWarn:room' + g.room.id); }
      }
    });
    b.world.rooms.forEach((room, i) => {
      if (room.cleared && !P.prev.cleared[i]) { P.clears.push({ t, room: room.id, type: room.type }); P.prev.cleared[i] = true; }
    });
    if (p.hp < P.prev.hp - 1e-6) P.hpDrops.push({ t, drop: P.prev.hp - p.hp, hp: p.hp, maxHp: p.maxHp, stormHits: r?.stormHits ?? null, room: b.curRoom?.id ?? null });
    P.prev.hp = p.hp;
    if (p.maxHp > 0) P.minHpRatio = Math.min(P.minHpRatio, p.hp / p.maxHp);
    let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    P.maxAlive = Math.max(P.maxAlive, alive);
    const room = b.curRoom?.id ?? null;
    if (room !== P.prev.room) {
      P.prev.room = room;
      if (room !== null && P.ringRooms.includes(room) && !P.sampledRooms.has(room)) { P.sampledRooms.add(room); P.sample('enter:room' + room); }
    }
  };
  const hit = stop => {
    const b = app.battle, r = routeOf(), gates = r?.gates || [];
    switch (stop.type) {
      case 'phase': return gates.some((g, i) => g.phase === stop.phase && (stop.gate == null || stop.gate === i));
      case 'stormWarn': return gates.some(g => g.phase === 'storm' && g.stormWarn);
      case 'time': return b.elapsed >= stop.t;
      case 'boss': return !!b.boss?.alive;
      case 'failure': return gates[stop.gate].failures > stop.from;
      case 'connected': return gates[stop.gate].phase === 'connected';
      case 'result': return !!app.expeditionUI.result;
      default: return false;
    }
  };
  P.run = ({ n, stop = null, renderEvery = 0, trace = null }) => {
    const b = app.battle; let ran = 0, reason = 'n';
    for (; ran < n; ran++) {
      if (!b.active) { reason = 'inactive'; break; }
      if (b.paused) { reason = 'paused'; break; }
      const render = renderEvery > 0 && P.steps % renderEvery === 0;
      const t0 = performance.now(); app.step(P.dt, render); const ms = performance.now() - t0;
      P.steps++; (render ? P.renderMs : P.stepMs).push(+ms.toFixed(3));
      if (ms > 50) P.slow.push({ t: b.elapsed, ms: +ms.toFixed(1), render, room: b.curRoom?.id ?? null, phases: gateRows().map(g => g.phase).join(',') });
      observe();
      if (trace != null) { const g = routeOf()?.gates?.[trace]; if (g) { P.trace.push({ t: b.elapsed, phase: g.phase, clock: g.clock, failures: g.failures }); if (P.trace.length > 40) P.trace.shift(); } }
      if (stop && hit(stop)) { reason = 'stop'; ran++; break; }
    }
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons] };
  };
  P.stepRaw = n => { for (let i = 0; i < n; i++) app.step(P.dt, false); return app.battle.elapsed; };
  P.freeze = () => {
    const b = app.battle, r = routeOf(); let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    return { elapsed: b.elapsed, paused: b.paused, active: b.active, hp: b.player.hp, pos: { x: b.player.pos.x, z: b.player.pos.z }, alive, kills: b.kills,
      stormHits: r?.stormHits ?? null, collapseFailures: r?.collapseFailures ?? null, gates: gateRows(), view: P.viewState() };
  };
  P.aim = () => {
    const b = app.battle, r = routeOf(), g = r?.current; if (!g) return null;
    const p = b.player.pos, c = app.renderer.camera; let target = null;
    c.updateMatrixWorld();
    if (g.phase === 'ready' || g.phase === 'collapse') target = r.autoPoint(g.room);
    else if (g.phase === 'shelter') target = g.center;
    else if (g.phase === 'storm') target = g.stormWarn || g.stormIndex > 0 ? g.stormShelter : g.center;
    if (!target) return { phase: g.phase, target: null };
    const a = p.clone().project(c), z = target.clone().project(c);
    return { phase: g.phase, room: g.room.id, target: { x: target.x, z: target.z }, dist: Math.hypot(target.x - p.x, target.z - p.z),
      dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2 };
  };
  P.summary = () => {
    const all = P.stepMs.concat(P.renderMs);
    const stat = arr => ({ n: arr.length, mean: arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3) : null, p50: pct(arr, .5), p95: pct(arr, .95), p99: pct(arr, .99), max: arr.length ? Math.max(...arr) : null });
    return { steps: P.steps, simulation: stat(P.stepMs), render: stat(P.renderMs), over50ms: P.slow.length, slow: P.slow.slice(0, 20), maxAlive: P.maxAlive, minHpRatio: P.minHpRatio,
      samples: P.samples, events: P.events, clears: P.clears, hpDrops: P.hpDrops, trace: P.trace, frameMs: stat(all) };
  };
  return true;
}

// ---------- 공통 보조 ----------
const ms = value => Math.round(value * 1000) / 1000;
async function state() {
  const row = await page.evaluate(id => {
    const a = window.app, b = a.battle;
    return { mode: a.mode, active: b.active, paused: b.paused, energy: a.eco.s.energy, energyT: a.eco.s.energyT, energyMax: a.eco.energyMax, observedAt: Date.now(),
      seq: a.expedition.s.seq, pending: a.expedition.s.pending ? structuredClone(a.expedition.s.pending) : null, ticket: a.expeditionTicket ? structuredClone(a.expeditionTicket) : null,
      depthWins: a.expedition.s.depthWins?.[id] ?? 0, materials: structuredClone(a.expedition.s.materials), gold: a.eco.s.gold,
      stats: structuredClone(a.expedition.s.stats), raw: localStorage.getItem('bladesurge_save_v1') };
  }, DUNGEON_ID);
  const bytes = row.raw ? Buffer.from(row.raw, 'utf8') : null;
  return { ...row, raw: undefined, saveBytes: bytes?.length ?? null, saveSha256: bytes ? qaHash(bytes) : null };
}
const period = ENERGY.regenSec * 1000;
function energyChange(before, after, cost, label) {
  // 에너지 정책은 읽기만 한다. 실제 차감 뒤 자연 회복이 끼어들 수 있어 0..경과 틱 범위로 검사한다.
  const regained = after.energy - (before.energy - cost);
  const maxTicks = Math.ceil((after.observedAt - before.observedAt) / period) + 1;
  check('energy:' + label, regained >= 0 && regained <= maxTicks, { before: before.energy, after: after.energy, cost, regained, maxTicks });
  return { cost, before: before.energy, after: after.energy, regained };
}
async function applyFixture() {
  const items = EXPEDITION_ITEMS.filter(item => item.set === 'glasswarden').map(({ id, rarity, slot }) => ({ id, rarity, slot }));
  const fixture = await page.evaluate(({ heroId, id, items, unlockCode, minLevel, quality }) => {
    const a = window.app, e = a.eco;
    a.expeditionUI.result = null; a.toLobby(); a.testPause = true; a.ui.closeModal();
    e.grantHero(heroId); e.s.selected = heroId;
    const h = e.hero(heroId); h.level = 50; h.star = 3; h.skills = h.skills.map(() => 5); h.exp = 0; h.equip = {};
    for (const def of items) { const inst = e.addItem(def.rarity, def.slot); inst.id = def.id; inst.enh = 15; h.equip[def.slot] = inst.uid; }
    a.expedition.s.level = Math.max(a.expedition.s.level, minLevel, 10);
    e.s.progress.stars[unlockCode] = Math.max(1, e.s.progress.stars[unlockCode] || 0);
    a.expedition.s.stats[id] = Math.max(1, a.expedition.s.stats[id] || 0);
    if (a.expedition.s.depthWins) a.expedition.s.depthWins[id] = 0;
    e.s.energy = e.energyMax; e.s.energyT = Date.now(); a.journey.s.autoBattle = true;
    if (quality === 'low') { e.s.settings.quality = 'low'; a.applySettings(); }
    e.save(); a.meta.refreshHome?.();
    return { heroId, level: h.level, star: h.star, skills: [...h.skills], equip: Object.keys(h.equip), energy: e.s.energy, expeditionLevel: a.expedition.s.level,
      access: a.expedition.dungeonAccess(id, { depth: 'deep' }), quality: e.s.settings.quality || 'auto' };
  }, { heroId, id: DUNGEON_ID, items, unlockCode: depthDef.unlockCode, minLevel: depthDef.minLevel, quality });
  qaAssert(fixture.access.ok, 'Fixture did not open deep access: ' + fixture.access.error);
  report.fixture = { ...fixture, items: items.map(item => item.id), kind: 'FIXTURE' };
  await qa.save(); return fixture;
}
async function launchFromLobby(row) {
  await page.locator('#btn-expedition').click();
  await page.locator('.adventure-nav [data-section="dungeons"]').click();
  await page.locator('.exp-route-tabs').getByRole('button', { name: /^심층 원정/ }).click();
  const card = page.locator('[data-dungeon="' + DUNGEON_ID + '"][data-depth="deep"]');
  row.cardText = await card.innerText();
  const energyOnCard = Number(/에너지 (\d+)/.exec(row.cardText)?.[1]);
  check('card energy matches catalog', energyOnCard === depthDef.energy, { card: energyOnCard, catalog: depthDef.energy });
  const button = card.locator('.exp-primary');
  qaAssert(await button.isEnabled(), 'Deep card departure button disabled');
  await button.click();
}
async function launchFromResult() {
  const retry = page.locator('.exp-result-footer .exp-primary').filter({ hasText: '다시 도전' });
  await retry.click();
}
async function beginRun(tag, via) {
  const before = await state();
  const row = { tag, via, status: 'running', before, choices: [] };
  if (via === 'lobby') await launchFromLobby(row); else { row.retryButtonText = await page.locator('.exp-result-footer .exp-primary').filter({ hasText: '다시 도전' }).innerText(); await launchFromResult(); }
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  row.started = await state();
  row.energy = energyChange(before, row.started, depthDef.energy, tag + ' admission');
  const info = await page.evaluate(() => { const a = window.app, b = a.battle; return { route: structuredClone(b.stage.expedition), heroId: b.heroId, auto: b.player.auto,
    routeKind: b.routeObjectives?.def?.kind ?? null, rooms: b.world.rooms.length, controller: b.routeObjectives ? b.routeObjectives.constructor.name : null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && info.route.depth === 'deep' && row.started.pending?.energy === depthDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === 'deep' && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { ringRooms: RING_ROOMS }); // 프로브 설치 후 begin
  row.begin = await page.evaluate(() => window.__deepQa.begin());
  row.rings = row.begin.kind === 'deep-orbits';
  report.build ??= {}; report.ringsDetected = row.rings;
  await qa.save(); return row;
}
async function takeChoice(row) {
  const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
  try { await buttons.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { throw Error('Battle paused without a visible native choice: ' + JSON.stringify(await page.evaluate(() => [...window.app.battle.pauseReasons]))); }
  row.choices.push({ text: await buttons.first().innerText(), elapsed: await page.evaluate(() => window.app.battle.elapsed) });
  await buttons.first().click();
}
/** stop 조건 또는 전투 종료까지 고정 스텝으로 진행한다. 선택지 모달이 열리면 실제 첫 번째 버튼을 누른다. */
async function advance(row, stop, { max = 60 * 60 * 12, chunk = 600, renderEvery = 0, trace = null } = {}) {
  let total = 0, last;
  while (total < max) {
    last = await page.evaluate(opts => window.__deepQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery, trace });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
async function resultSnapshot() {
  return page.evaluate(() => {
    const r = window.app.expeditionUI.result; if (!r) return null;
    return { win: r.win, id: r.id, depth: r.depth, kills: r.kills, combo: r.combo, time: r.time, saveError: r.saveError,
      routeObjective: r.routeObjective ? structuredClone(r.routeObjective) : null,
      rewards: { gold: r.rewards.gold, xp: r.rewards.xp, materials: { ...(r.rewards.materials || {}) }, firstClear: !!r.rewards.firstClear, loot: r.rewards.loot?.length ?? 0 } };
  });
}
async function waitResult() {
  for (let n = 0; n < 40 && !await page.locator('.exp-result-shell').isVisible(); n++) {
    await page.evaluate(() => { for (let i = 0; i < 120 && !window.app.expeditionUI.result; i++) window.app.step(1 / 60, i === 119); });
  }
  await page.locator('.exp-result-shell').waitFor({ state: 'visible', timeout: 30000 });
}
async function captureScreens(label) {
  const shots = [];
  for (const size of SCREEN_VIEWPORTS) {
    await page.setViewportSize(size);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => window.app.renderer.render()); // 시뮬레이션 tick 없이 그리기만
    const file = label + '-' + size.width + 'x' + size.height + '.png';
    await page.screenshot({ path: path.join(qa.out, file) }); shots.push(file);
  }
  await page.setViewportSize(viewport); await page.waitForTimeout(150);
  await page.evaluate(() => window.app.renderer.render());
  return shots;
}
const shot = async label => { const file = label + '.png'; await page.evaluate(() => window.app.renderer.render()); await page.screenshot({ path: path.join(qa.out, file) }); return file; };

// ---------- 타임라인 분석(고리 빌드 전용) ----------
const ALLOWED = { locked: ['ready'], ready: ['collapse'], collapse: ['shelter', 'ready'], shelter: ['storm', 'ready'], storm: ['connected'], connected: [] };
function analyzeRings(summary, routeObjective, result) {
  const gates = {};
  for (const e of summary.events.filter(e => e.kind === 'phase')) (gates[e.room] ??= []).push(e);
  const rows = Object.entries(gates).map(([room, list]) => {
    const orderOk = list.every(e => ALLOWED[e.from]?.includes(e.to));
    const connect = list.find(e => e.to === 'connected'), toStorm = list.find(e => e.to === 'storm');
    const warns = summary.events.filter(e => e.kind === 'stormWarn' && e.on && String(e.room) === room);
    const cleared = summary.clears.find(c => String(c.room) === room);
    return { room: Number(room), orderOk, transitions: list.map(e => ({ t: ms(e.t), from: e.from, to: e.to, clock: e.clock == null ? null : ms(e.clock), slack: e.slack == null ? null : ms(e.slack) })),
      attempts: list.filter(e => e.to === 'collapse').length, failures: list.filter(e => e.from !== 'locked' && e.to === 'ready' && e.from !== 'ready').length,
      slack: toStorm?.slack ?? null, connectedAt: connect?.t ?? null, stormWarnCount: warns.length, clearedAt: cleared?.t ?? null,
      clearedAfterConnect: cleared && connect ? cleared.t >= connect.t : null };
  });
  const slackMin = Math.min(...rows.map(r => r.slack ?? Infinity));
  return { rows, slackMin: Number.isFinite(slackMin) ? ms(slackMin) : null, order: summary.clears.map(c => c.room),
    stormHits: routeObjective?.stormHits ?? null, collapseFailures: routeObjective?.collapseFailures ?? null,
    acceptance: { phaseOrderValid: rows.every(r => r.orderOk), allConnected: rows.length === 5 && rows.every(r => r.connectedAt != null), stormWarnThreeEach: rows.every(r => r.stormWarnCount === 3),
      clearedOnlyAfterConnect: rows.every(r => r.clearedAfterConnect === true), slackAtLeast4: slackMin >= 4, noStormHits: routeObjective?.stormHits === 0,
      resultComplete: routeObjective?.complete === true && routeObjective?.progress === 5 && result?.win === true } };
}

/** 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시를 기록한다. */
async function playToEnd(row, { moments = [], expectFirstClear = true } = {}) {
  row.shots = [];
  for (const moment of moments) {
    const r = await advance(row, moment.stop, { renderEvery: 0 });
    if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); break; }
    row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed) });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await waitResult();
  row.summary = await page.evaluate(() => window.__deepQa.summary());
  row.result = await resultSnapshot();
  row.resultText = await page.locator('.exp-result-shell').innerText();
  row.after = await state();
  row.settlement = await page.evaluate(() => { const b = window.app.battle; return { paid: !!b.result?.expeditionReceipt?.ok, receipt: b.result?.expeditionReceipt ? structuredClone({ ok: b.result.expeditionReceipt.ok, rewards: b.result.expeditionReceipt.rewards }) : null, dirty: !!b.rpgDirty }; });
  const win = row.result?.win === true;
  check(row.tag + ': 완주 승리', win && !row.result.saveError && row.settlement.paid, { win, saveError: row.result?.saveError });
  if (win) {
    check(row.tag + ': depthWins +1', row.after.depthWins === row.before.depthWins + 1, { before: row.before.depthWins, after: row.after.depthWins });
    check(row.tag + ': pending 비움', row.after.pending === null && row.after.seq === row.before.seq + 1);
    const wantMaterials = {};
    for (const [m, n] of Object.entries(depthDef.rewards.materials || {})) wantMaterials[m] = n + (expectFirstClear ? depthDef.firstRewards.materials?.[m] || 0 : 0);
    const gotMaterials = Object.fromEntries(Object.keys(wantMaterials).map(m => [m, (row.after.materials[m] || 0) - (row.before.materials[m] || 0)]));
    check(row.tag + ': 재료 보상 ' + (expectFirstClear ? '첫 보상 포함 1회' : '첫 보상 미지급'), JSON.stringify(wantMaterials) === JSON.stringify(gotMaterials), { want: wantMaterials, got: gotMaterials });
    check(row.tag + ': firstClear 표시', row.result.rewards.firstClear === expectFirstClear);
    check(row.tag + ': 저장 바이트 변경', row.after.saveSha256 !== row.before.saveSha256 && row.after.saveSha256 !== row.started.saveSha256);
  }
  if (row.rings) {
    row.rings = analyzeRings(row.summary, row.result?.routeObjective, row.result);
    const ro = row.result?.routeObjective;
    const line = '궤도 고리 연결 ' + ro?.progress + '/' + ro?.target + ' · 붕괴 실패 ' + ro?.collapseFailures + '회 · 유성 피격 ' + ro?.stormHits + '회' + (ro?.complete ? ' · 완료' : '');
    check(row.tag + ': 결과 줄이 routeObjective 와 일치', ro?.id === 'comet_deep_orbits' && row.resultText.includes(line), { line, id: ro?.id });
    check(row.tag + ': 결과 줄 중복 없음', row.resultText.split('궤도 고리 연결').length - 1 === 1);
    for (const [name, ok] of Object.entries(row.rings.acceptance)) check(row.tag + ': 고리 ' + name, ok);
  } else row.rings = { skipped: 'kind !== deep-orbits (기준선 빌드): 고리 검사 생략, 공통 측정만 기록' };
  row.status = 'pass';
  await qa.captureMedia(row.tag + '-result');
  row.resultShot = await shot('result-' + row.tag);
  await qa.save(); return row;
}
async function closeResultToLobby() {
  await page.locator('.exp-result-shell .exp-close').click();
  await page.waitForFunction(() => window.app.mode === 'lobby' && !window.app.battle.active);
}
async function reloadCheck(row) {
  const before = await state();
  await qa.boot({ reload: true });
  const after = await state();
  check(row.tag + ': 새로고침 후 보상·승리수·pending 보존', after.depthWins === before.depthWins && after.pending === null && JSON.stringify(after.materials) === JSON.stringify(before.materials) && after.gold === before.gold,
    { beforeWins: before.depthWins, afterWins: after.depthWins });
  row.reload = { beforeSha: before.saveSha256, afterSha: after.saveSha256, energy: energyChange(before, after, 0, row.tag + ' reload') };
}
async function giveUp() {
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => window.app.battle.paused);
  await page.locator('#btn-giveup').click();
  await waitResult();
}

// ---------- 프로필 ----------
const profiles = {
  async auto() {
    await applyFixture();
    const row = await beginRun('auto', 'lobby');
    await playToEnd(row);
    await closeResultToLobby();
    await reloadCheck(row);
    return { runs: [row] };
  },
  async retry() {
    await applyFixture();
    const first = await beginRun('retry-first', 'lobby');
    await playToEnd(first);
    const oldRoute = await page.evaluate(() => { window.__deepQaOldRoute = window.app.battle.routeObjectives; return !!window.__deepQaOldRoute; });
    const second = await beginRun('retry-second', 'result');
    check('retry: 새 티켓', second.started.pending.id === first.started.pending.id + 1);
    check('retry: 에너지 재차감', second.energy.cost === depthDef.energy);
    second.controller = await page.evaluate(() => { const b = window.app.battle, old = window.__deepQaOldRoute, r = b.routeObjectives;
      const groups = []; window.app.renderer.scene.traverse(o => { if (o.name === 'TLL_CometDeepOrbits') groups.push(o); });
      return { oldRoute: !!old, changed: r !== old, newClosed: r?.closed ?? null, newProgress: r?.progress ?? null, oldClosed: old?.closed ?? null,
        oldViewDisposed: old ? (old.view == null) : null, orbitGroups: groups.length }; });
    if (second.rings) check('retry: 새 컨트롤러 0/5, 이전 컨트롤러 닫힘·뷰 해제, 궤도 그룹 1개', second.controller.changed && second.controller.newProgress === 0 && second.controller.newClosed === false
      && second.controller.oldClosed === true && second.controller.oldViewDisposed === true && second.controller.orbitGroups === 1, second.controller);
    await playToEnd(second, { expectFirstClear: false });
    await closeResultToLobby();
    await reloadCheck(second);
    return { runs: [first, second], oldRoute };
  },
  async giveup() {
    await applyFixture();
    const row = await beginRun('giveup', 'lobby');
    await advance(row, row.rings ? { type: 'phase', phase: 'collapse' } : { type: 'time', t: 20 }, { max: 60 * 60 * 6 });
    row.beforeGiveUp = await page.evaluate(() => window.__deepQa.freeze());
    await giveUp();
    row.result = await resultSnapshot();
    row.resultText = await page.locator('.exp-result-shell').innerText();
    row.after = await state();
    check('giveup: 패배 결과·완료 표시 없음', row.result.win === false && !row.resultText.includes('· 완료') && await page.locator('[data-outcome="defeat"]').count() === 1);
    check('giveup: 보상 없음·승리수 불변·pending 비움·에너지 환급 없음', row.after.depthWins === row.before.depthWins && row.after.pending === null && row.after.energy <= row.before.energy - depthDef.energy + 2);
    if (row.rings) {
      const ro = row.result.routeObjective;
      check('giveup: routeObjective 부분 동결·complete false', ro?.id === 'comet_deep_orbits' && ro.complete === false && ro.progress < 5);
      check('giveup: 결과 줄', row.resultText.includes('궤도 고리 연결 ' + ro.progress + '/5 · 붕괴 실패 ' + ro.collapseFailures + '회 · 유성 피격 ' + ro.stormHits + '회') && !row.resultText.includes('연결 ' + ro.progress + '/5 · 붕괴 실패 ' + ro.collapseFailures + '회 · 유성 피격 ' + ro.stormHits + '회 · 완료'));
    }
    row.shot = await shot('giveup-result');
    await page.evaluate(() => { window.__deepQaOldRoute = window.app.battle.routeObjectives; });
    const again = await beginRun('giveup-retry', 'result');
    again.controller = await page.evaluate(() => { const old = window.__deepQaOldRoute, r = window.app.battle.routeObjectives;
      const groups = []; window.app.renderer.scene.traverse(o => { if (o.name === 'TLL_CometDeepOrbits') groups.push(o); });
      return { changed: r !== old, oldClosed: old?.closed ?? null, oldViewDisposed: old ? old.view == null : null, newProgress: r?.progress ?? null, orbitGroups: groups.length }; });
    check('giveup: 새 티켓·에너지 재차감', again.started.pending.id === row.started.pending.id + 1 && again.energy.cost === depthDef.energy);
    if (again.rings) check('giveup: 새 컨트롤러·이전 뷰 해제', again.controller.changed && again.controller.oldClosed === true && again.controller.oldViewDisposed === true && again.controller.newProgress === 0 && again.controller.orbitGroups === 1, again.controller);
    await advance(again, { type: 'time', t: 5 });
    await giveUp(); again.result = await resultSnapshot(); await closeResultToLobby();
    return { runs: [row, again] };
  },
  async pause() {
    await applyFixture();
    const row = await beginRun('pause', 'lobby');
    await advance(row, row.rings ? { type: 'phase', phase: 'collapse' } : { type: 'time', t: 25 }, { max: 60 * 60 * 6 });
    const before = await page.evaluate(() => window.__deepQa.freeze());
    await page.locator('#btn-pause').click();
    await page.waitForFunction(() => window.app.battle.paused && document.getElementById('pause-overlay').classList.contains('show'));
    const paused = await page.evaluate(() => window.__deepQa.freeze());
    await page.evaluate(() => window.__deepQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await page.evaluate(() => window.__deepQa.freeze());
    const same = JSON.stringify([paused.elapsed, paused.pos, paused.gates, paused.stormHits]) === JSON.stringify([still.elapsed, still.pos, still.gates, still.stormHits]);
    check('pause: 120스텝+1초 동안 게임 시간·시계·위치 불변', same, { paused: paused.elapsed, still: still.elapsed });
    row.pauseShot = await shot('paused-collapse');
    await page.locator('#btn-resume').click();
    await page.waitForFunction(() => !window.app.battle.paused);
    await page.evaluate(() => window.__deepQa.run({ n: 60 }));
    const resumed = await page.evaluate(() => window.__deepQa.freeze());
    check('pause: 재개 뒤 시간 진행', resumed.elapsed > still.elapsed);
    if (row.rings) {
      const g0 = before.gates.find(g => g.phase === 'collapse'), g1 = resumed.gates.find(g => g.room === g0?.room);
      check('pause: 붕괴 시계는 재개 뒤에만 감소', !!g0 && g1 && g1.clock < g0.clock && g1.clock > paused.gates.find(g => g.room === g0.room).clock - 2, { before: g0?.clock, resumed: g1?.clock });
      const r = await advance(row, { type: 'stormWarn' }, { max: 60 * 60 * 6 });
      if (r.reason === 'stop') {
        const w1 = await page.evaluate(() => window.__deepQa.freeze());
        await page.locator('#btn-pause').click(); await page.waitForFunction(() => window.app.battle.paused);
        await page.evaluate(() => window.__deepQa.stepRaw(90));
        const w2 = await page.evaluate(() => window.__deepQa.freeze());
        const warnGate = w1.gates.find(g => g.stormWarn);
        const gate2 = w2.gates.find(g => g.room === warnGate.room);
        check('pause: 폭풍 예고 중 일시정지에 예고 시간·표시 유지', gate2.stormWarn && gate2.stormWarnT === warnGate.stormWarnT && w2.view?.gates.some(g => g.red), { warnT: warnGate.stormWarnT, after: gate2.stormWarnT });
        row.pauseStormShot = await shot('paused-storm-warn');
        await page.locator('#btn-resume').click(); await page.waitForFunction(() => !window.app.battle.paused);
      } else row.stormPause = 'not-reached: ' + r.reason;
    }
    row.summary = await page.evaluate(() => window.__deepQa.summary());
    await giveUp(); await closeResultToLobby();
    row.status = 'pass';
    return { runs: [row] };
  },
  async fail() {
    await applyFixture();
    const row = await beginRun('fail', 'lobby');
    if (!row.rings) return { skipped: '기준선 빌드에는 붕괴 고리가 없다' };
    // 첫 실제 밀기(= AUTO 가 룬석을 민 순간)에 collapse 가 시작되면 AUTO 를 끄고 영웅을 세운다.
    await advance(row, { type: 'phase', phase: 'collapse' }, { max: 60 * 60 * 6 });
    const started = await page.evaluate(() => window.__deepQa.freeze());
    const gateIndex = started.gates.findIndex(g => g.phase === 'collapse'), roomId = started.gates[gateIndex].room;
    await page.locator('#btn-auto').click();
    row.autoOff = await page.evaluate(() => window.app.battle.player.auto);
    qaAssert(row.autoOff === false, 'Native AUTO button did not turn AUTO off');
    const failBase = started.gates[gateIndex].failures;
    const fail = await advance(row, { type: 'failure', gate: gateIndex, from: failBase }, { max: 60 * 60 * 12, trace: gateIndex });
    const trace = await page.evaluate(() => window.__deepQa.summary().trace);
    const last = trace.slice(-3);
    const after = await page.evaluate(() => window.__deepQa.freeze());
    const gate = after.gates[gateIndex];
    row.failure = { roomId, reason: fail.reason, trace: last, after: gate };
    check('fail: 붕괴 시간 초과 → ready 복귀·실패 +1', fail.reason === 'stop' && gate.phase === 'ready' && gate.failures === failBase + 1, gate);
    check('fail: 실패 직전 프레임에도 시계가 남아 있었다(0.0 표시 없음)', last.length >= 2 && last.at(-2).phase === 'collapse' && last.at(-2).clock > 0, last);
    check('fail: 방 미정화·다른 고리 영향 없음', !(await page.evaluate(id => window.app.battle.world.rooms.find(r => r.id === id).cleared, roomId)));
    row.failShot = await shot('fail-reset');
    await page.locator('#btn-auto').click();
    const connect = await advance(row, { type: 'connected', gate: gateIndex }, { max: 60 * 60 * 6 });
    const summary = await page.evaluate(() => window.__deepQa.summary());
    row.recovered = { reason: connect.reason, events: summary.events.filter(e => e.gate === gateIndex && e.kind === 'phase').map(e => ({ t: ms(e.t), from: e.from, to: e.to })) };
    check('fail: 이어서 정상 연결', connect.reason === 'stop');
    row.summary = summary;
    await giveUp(); await closeResultToLobby(); row.status = 'pass';
    return { runs: [row] };
  },
  async 'save-fault'() {
    await applyFixture();
    const row = await beginRun('save-fault', 'lobby');
    // 정산 직전까지 평소처럼 진행한 뒤 정산 저장만 실패시킨다(원함수는 이 프로필 안에서 복원).
    await advance(row, row.rings ? { type: 'boss' } : { type: 'time', t: 60 }, { max: 60 * 60 * 12 });
    await page.evaluate(() => { const eco = window.app.eco; window.__deepQaOrigSave = eco.save; eco.save = () => false; });
    const faultSha = (await state()).saveSha256;
    await advance(row, null, { renderEvery: 1800 });
    await waitResult();
    row.faulted = { result: await resultSnapshot(), after: await state(), saveShaBeforeFault: faultSha };
    check('save-fault: 정산 저장 실패 표시', !!row.faulted.result.saveError && await page.getByRole('button', { name: '정산 다시 저장' }).count() === 1);
    check('save-fault: 승리수·재료·pending 은 롤백(정산 전 상태)', row.faulted.after.depthWins === row.before.depthWins && row.faulted.after.pending?.id === row.started.pending.id && JSON.stringify(row.faulted.after.materials) === JSON.stringify(row.before.materials), { wins: row.faulted.after.depthWins });
    const blocked = await page.evaluate(() => [...document.querySelectorAll('.exp-result-footer button')].map(b => b.disabled));
    check('save-fault: 다른 출발 버튼 비활성', blocked.length > 0 && blocked.every(Boolean), blocked);
    await page.locator('.exp-result-shell .exp-close').click({ force: true }).catch(() => {});
    check('save-fault: 닫기 차단', await page.locator('.exp-result-shell').isVisible());
    row.faultShot = await shot('save-fault');
    await page.evaluate(() => { window.app.eco.save = window.__deepQaOrigSave; delete window.__deepQaOrigSave; });
    await page.getByRole('button', { name: '정산 다시 저장' }).click();
    await page.waitForFunction(() => window.app.expeditionUI.result && !window.app.expeditionUI.result.saveError);
    row.retried = { result: await resultSnapshot(), after: await state() };
    check('save-fault: 재시도 성공·승리수 +1 한 번·첫 보상 1회', row.retried.after.depthWins === row.before.depthWins + 1 && row.retried.result.rewards.firstClear === true && row.retried.after.pending === null && row.retried.after.saveSha256 !== row.faulted.after.saveSha256);
    check('save-fault: 재시도 버튼이 사라져 재클릭 증가 없음', await page.getByRole('button', { name: '정산 다시 저장' }).count() === 0);
    row.summary = await page.evaluate(() => window.__deepQa.summary()); row.status = 'pass';
    await closeResultToLobby(); await reloadCheck(row);
    return { runs: [row] };
  },
  async refresh() {
    await applyFixture();
    const row = await beginRun('refresh', 'lobby');
    await advance(row, { type: 'time', t: 20 });
    const mid = await state();
    check('refresh: 전투 중 저장에 pending 티켓 존재', mid.pending?.id === row.started.pending.id);
    await qa.boot({ reload: true });
    const first = await state();
    row.firstReload = { state: first, energy: energyChange({ ...row.before, energy: row.before.energy }, first, 0, 'refresh refund') };
    check('refresh: pending 취소·에너지 1회 환급', first.pending === null && first.mode === 'lobby' && first.energy >= row.before.energy && first.energy <= row.before.energy + 2 && first.depthWins === row.before.depthWins, { before: row.before.energy, started: row.started.energy, after: first.energy });
    await qa.boot({ reload: true });
    const second = await state();
    check('refresh: 두 번째 새로고침은 추가 환급 없음', second.energy <= first.energy + 2 && second.pending === null, { first: first.energy, second: second.energy });
    row.status = 'pass'; return { runs: [row] };
  },
  async touch() {
    await applyFixture();
    const row = await beginRun('touch', 'lobby');
    if (!row.rings) return { skipped: '기준선 빌드에는 붕괴 고리가 없다' };
    await advance(row, { type: 'phase', phase: 'ready' }, { max: 60 * 60 * 6 });
    await page.locator('#btn-auto').click();
    qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for touch control');
    const cdp = await page.context().newCDPSession(page);
    const origin = await page.evaluate(() => { const r = document.getElementById('joy').getBoundingClientRect(); const x = r.left + r.width * .3, y = r.top + r.height * .6; const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit?.id || hit?.className || hit?.tagName, inside: !!hit?.closest('#joy') }; });
    row.touchOrigin = origin;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: origin.x, y: origin.y, id: 1 }] });
    const log = []; let gateRoom = null, done = false;
    for (let turn = 0; turn < 900 && !done; turn++) {
      const aim = await page.evaluate(() => window.__deepQa.aim());
      if (!aim || !aim.target) { await page.evaluate(() => window.__deepQa.run({ n: 6 })); continue; }
      gateRoom ??= aim.room;
      const len = Math.hypot(aim.dx, aim.dy) || 1, near = aim.dist < .5;
      const px = near ? origin.x : origin.x + aim.dx / len * 45, py = near ? origin.y : origin.y + aim.dy / len * 45;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py, id: 1 }] });
      const r = await page.evaluate(() => window.__deepQa.run({ n: 6 }));
      if (turn % 20 === 0) log.push({ turn, phase: aim.phase, dist: +aim.dist.toFixed(2), t: ms(r.elapsed) });
      const gate = (await page.evaluate(() => window.__deepQa.freeze())).gates.find(g => g.room === gateRoom);
      if (gate.phase === 'connected' || r.reason === 'inactive') done = true;
      if (r.reason === 'paused') await takeChoice(row);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    row.summary = await page.evaluate(() => window.__deepQa.summary());
    const g = (await page.evaluate(() => window.__deepQa.freeze())).gates.find(x => x.room === gateRoom);
    row.touch = { room: gateRoom, finalPhase: g.phase, slack: g.slack, failures: g.failures, hits: g.hits, log, note: '에뮬레이터 터치 이벤트이며 실기기 입력이 아니다. 목표 지점은 autoPoint 를 화면 방향으로 투영한 값이다.' };
    check('touch: 입력이 #joy 안에 닿음', origin.inside, origin);
    check('touch: 터치로 1고리 연결', g.phase === 'connected', row.touch);
    await page.locator('#btn-auto').click(); await giveUp(); await closeResultToLobby(); row.status = 'pass';
    return { runs: [row] };
  },
  async screens() {
    await applyFixture();
    const row = await beginRun('screens', 'lobby');
    const moments = row.rings ? [{ label: 'ready', stop: { type: 'phase', phase: 'ready' } }, { label: 'collapse', stop: { type: 'phase', phase: 'collapse' } },
      { label: 'shelter', stop: { type: 'phase', phase: 'shelter' } }, { label: 'storm-warn', stop: { type: 'stormWarn' } }, { label: 'boss', stop: { type: 'boss' } }]
      : [{ label: 'boss', stop: { type: 'boss' } }];
    await playToEnd(row, { moments });
    row.resultShots = await captureScreens('result-' + row.tag);
    await closeResultToLobby();
    return { runs: [row] };
  },
};

try {
  page = await qa.start({ viewport, context: contextOptions });
  await page.addInitScript(seedValue => { let n = seedValue; Math.random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }, seed);
  await qa.boot();
  report.initial = await state();
  // all 에서는 retry 가 auto 의 승리·새로고침 검사를 모두 포함하므로 중복 실행을 피한다.
  const order = selected.filter(name => !(name === 'auto' && selected.includes('retry')));
  for (const name of order) {
    const started = Date.now();
    try {
      report.profiles[name] = { status: 'running' }; await qa.save();
      const result = await profiles[name]();
      report.profiles[name] = { status: result.skipped ? 'skipped' : 'pass', ...result, wallMs: Date.now() - started };
    } catch (error) {
      report.profiles[name] = { status: 'fail', failure: String(error?.stack || error), wallMs: Date.now() - started };
      process.exitCode = 1;
      // 실패 표본의 원인을 남긴다: 고리 phase 이벤트·정화 순서·AUTO 목표·방별 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__deepQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        const pending = {};
        for (const n of b.pending) pending[n.room?.id ?? 'none'] = (pending[n.room?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.() ?? null, summary: q?.summary ? (({ events, clears, hpDrops, trace }) => ({ events, clears, hpDrops, trace }))(q.summary()) : null,
          autoTarget: b.autoTarget?.id ?? null, curRoom: b.curRoom?.id ?? null, sealed: !!b.world.sealed, alive, pending,
          rooms: b.world.rooms.map(r => ({ id: r.id, type: r.type, spawned: !!r.spawned, cleared: !!r.cleared, discovered: !!r.discovered, forgeWave: r.forgeWave || 0 })),
          auto: !!b.player?.auto, playerState: b.player?.state ?? null };
      }).catch(diagError => ({ error: String(diagError) }));
      await qa.save();
      try { await qa.boot({ reload: true }); } catch (bootError) { report.profiles[name].recoverFailure = String(bootError); break; }
    }
    await qa.save();
  }
  report.failedChecks = report.checks.filter(item => !item.ok).map(item => item.name);
  if (report.failedChecks.length) process.exitCode = 1;
  await qa.finishObservations();
  report.status = process.exitCode ? 'fail' : 'pass';
} catch (error) { report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1; }
finally {
  try { await qa.close(); } catch (error) { report.status = 'fail'; report.cleanupFailure = String(error?.stack || error); process.exitCode = 1; }
  if (report.mediaGates !== 'pass') report.status = 'fail';
  report.finished = new Date().toISOString(); await qa.save();
}
console.log(JSON.stringify({ status: report.status, out: qa.out, ringsDetected: report.ringsDetected, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
