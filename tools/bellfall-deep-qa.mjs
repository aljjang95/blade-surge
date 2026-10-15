#!/usr/bin/env node
// 종락 회랑 심층(bellfall_crypt/deep) 종문 역순 공명 실제 UI QA 도구 (BUNDLE-04 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 종문 phase 타임라인을 기록한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 컨트롤러(kind === 'reverse-bells')가 없는 기준선 빌드에서는 종 검사를 건너뛰고 같은 측정만 남긴다.
// 판정 함수는 tools/bellfall-deep-checks.mjs 에 있고 test/bellfall-deep-checks.test.ts 가 합격·불합격 입력을 모두 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { FRAME, analyzeBells, checkDiscord, checkGuideText, checkResult, discordEvents, reverseOrder, stepStats } from './bellfall-deep-checks.mjs';

const HELP = [
  '사용법: node tools/bellfall-deep-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '  --profile=<목록>          auto|discord|pause|refresh|screens|all (쉼표로 여러 개, 기본 auto)',
  '  --seed=<uint32>           Math.random 시드(기본 20261015)',
  '  --hero=<id>               fixture 영웅 knight|mage 등(기본 knight)',
  '  --viewport=WxH            기본 844x390',
  '  --motion=reduce|no-preference   브라우저 prefers-reduced-motion(기본 reduce). 값 없는 --motion 은 reduce',
  '  --quality=low|default     low 면 설정 핸들러와 같은 경로(settings.quality=low + applySettings)로 낮은 화질. 값 없는 --quality 는 low',
  '  --origin=<url>            공유 런타임 옵션(로컬 preview 또는 고정 라이브 주소만 허용)',
  '  --help                    이 도움말',
  '',
  '프로필(F = fixture, R = 실제 UI·입력, C = 제어 실행)',
  '  auto     F 저장 주입(해금·영웅·장비·에너지) → R 출격 버튼 → R AUTO → C 고정 1/60 스텝 완주 → 불협 0·결과 줄·R 새로고침 보존',
  '  discord  AUTO 로 answer 까지 간 뒤 R AUTO 끔 → R 키보드(KeyW/A/S/D)로 오답 종 중심에 2초 이상 머문다.',
  '           1회째: 불협 1·HP 약 6%·toll·progress 0·목표창에 정답 노출 없음. 2회째 뒤: 목표창에 다음 + 정답 label. R AUTO 로 완주·결과 불협 2회',
  '  pause    R #btn-pause/#btn-resume: 소등 중 tollClock 불변·재개 뒤 이어짐, answer 유지 중 pause 면 hold 0, 이후 완주',
  '  refresh  answer 단계 R 새로고침: pending 취소·에너지 1회 환급',
  '  screens  wake 점등·소등 중·answer 유지·불협 직후·결과 순간마다 640x360, 844x390, 390x844 스크린샷(PNG)',
  '',
  '주의: 좌표 이동·무적·HP 주입으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.',
  'SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다. discord 의 키보드 입력은 Playwright 가 보낸 에뮬레이터 키 이벤트다.',
].join('\n');
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
// 값 없는 플래그(--quality, --motion)도 받는다.
const flag = (name, bare, fallback) => qaArgument(name) ?? (process.argv.includes('--' + name) ? bare : fallback);
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'discord', 'pause', 'refresh', 'screens'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
const seed = Number(arg('seed', '20261015'));
qaAssert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, '--seed must be uint32');
const heroId = arg('hero', 'knight');
const viewportMatch = /^(\d{3,4})x(\d{3,4})$/.exec(arg('viewport', '844x390'));
qaAssert(viewportMatch, '--viewport must be WxH');
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
const motion = flag('motion', 'reduce', 'reduce');
qaAssert(['reduce', 'no-preference'].includes(motion), '--motion must be reduce|no-preference');
const quality = flag('quality', 'low', 'default');
qaAssert(['low', 'default'].includes(quality), '--quality must be low|default');
const contextOptions = { reducedMotion: motion };
const SCREEN_VIEWPORTS = [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
const DUNGEON_ID = 'bellfall_crypt';

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다). 정답·간격·방 번호를 이 파일에 박지 않는다.
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const depthDef = EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID && (d.depth ?? 'deep') === 'deep');
qaAssert(depthDef, 'Target project has no ' + DUNGEON_ID + ' deep definition');
// 종문 정의(후보 빌드에만 있다). 기준선 빌드에서는 null 이고 종 검사를 건너뛴다.
const bellDef = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES?.bellfall_deep ?? null;
const bellRooms = bellDef?.kind === 'reverse-bells' ? bellDef.gates.map(gate => gate.roomId) : null;
const answerOrder = bellRooms ? reverseOrder(bellDef.tollOrder) : null;
const labelOf = room => bellDef?.gates.find(gate => gate.roomId === room)?.label ?? null;
const chosenNeedsKeyboard = selected.includes('discord') || selected.includes('screens');

const report = { kind: 'bellfall-deep-qa', releaseApproved: false, seed, heroId, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'bellfall-deep-checks.mjs'))), profiles: {}, checks: [],
  bellDefinition: bellDef ? JSON.parse(JSON.stringify(bellDef)) : null,
  catalog: { id: depthDef.id, energy: depthDef.energy, unlockCode: depthDef.unlockCode, minLevel: depthDef.minLevel, rewards: depthDef.rewards,
    firstRewards: depthDef.firstRewards, objective: depthDef.objective },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^심층 원정/', '[data-dungeon="bellfall_crypt"][data-depth="deep"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창, 하위 .battle-objective-title/.battle-objective-action)'],
    result: ['.exp-result-shell (결과 줄 innerText)', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives (getter: phase/progress/lit/discords/tolls/tollIndex/tollClock/hold/holdGate/lastToll/lastDiscord/discordT/guide/here/gates)',
      'window.app.expeditionUI.result.routeObjective', 'window.app.battle.world.rooms/sealed', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨·기본 원정 승리)·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)', quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → 심층 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      chosenNeedsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): 오답 종 중심으로 걷는 방향은 도구가 종 중심의 화면 투영으로 정함. 텔레포트·무적·HP 주입 없음' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각'] },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/bellfall-deep-bells.js', 'src/game/bellfall-deep-bell-view.js', 'src/game/route-objectives.js', 'src/data/route-objectives.js',
  'src/data/expedition-depths.js', 'src/ui/battle-objective-view.js', 'src/ui/battle-readability.js', 'src/expansion/hub.jsx', 'src/game/battle-base.js',
  'src/game/expedition-economy.js', 'src/game/player.js', 'src/main.js'].filter(file => fs.existsSync(path.join(projectRoot, file)));
const qa = await createExpeditionQa({ root: projectRoot, driver: import.meta.filename, report, sourceFiles });
let page;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };

// ---------- 페이지 안 측정 프로브(게임 판정에는 쓰지 않는다) ----------
function installProbe({ bellRooms }) {
  const app = window.app;
  const P = window.__bellQa = { dt: 1 / 60, bellRooms, steps: 0 };
  const routeOf = () => app.battle.routeObjectives;
  // player.js hurt 의 방어 외 경감(가드·성역·아이기스·물약 방어). 하나라도 켜져 있으면 불협 피해를 정확히 판정할 수 없다.
  const reductionState = () => {
    const b = app.battle, p = b.player, armory = b.sp?.armory;
    return { guard: (p.guardT || 0) > 0 && p.def?.jobId === 'guardian' ? 1 : 0, sanctum: p.dr > 0 && p.drT > 0 ? p.dr : 0,
      aegis: armory?.aegisUntil > b.elapsed ? armory.aegis || 0 : 0, tonicGuard: (p.tonicGuardT || 0) > 0 ? 1 : 0 };
  };
  const isBells = r => r?.def?.kind === 'reverse-bells';
  const num = value => Number.isFinite(value) ? value : null;
  const gateRows = () => (routeOf()?.gates || []).map(g => ({ room: g.room.id, label: g.label, phase: g.phase, purgePending: !!g.purgePending, spawned: !!g.spawned, prepared: !!g.prepared }));
  const ctlRow = () => {
    const r = routeOf(); if (!isBells(r)) return null;
    return { phase: r.phase, progress: r.progress, lit: r.lit, complete: !!r.complete, closed: !!r.closed, discords: r.discords, tolls: r.tolls, tollIndex: r.tollIndex,
      tollClock: num(r.tollClock), hold: num(r.hold), holdRoom: r.holdGate?.room?.id ?? null, lastTollRoom: r.lastToll?.room?.id ?? null,
      lastDiscordRoom: r.lastDiscord?.room?.id ?? null, discordT: num(r.discordT), guideRoom: r.guide?.room?.id ?? null, here: r.here?.id ?? null };
  };
  // 종 월드 표시 상태: 컨트롤러 view.group, 없으면 이름에 bell 이 들어간 그룹. 보이는 mesh 수와 인스턴스 합을 센다.
  const bellView = () => {
    const r = routeOf(); let group = r?.view?.group ?? null;
    if (!group) app.renderer.scene.traverse(o => { if (!group && o.isGroup && /bell/i.test(o.name)) group = o; });
    if (!group) return { found: false };
    const visible = o => { for (let n = o; n; n = n.parent) { if (!n.visible) return false; if (n === group) return true; } return true; };
    let meshes = 0, instances = 0;
    group.traverse(o => { if (o.isMesh && visible(o)) { meshes++; instances += o.isInstancedMesh ? o.count : 1; } });
    return { found: true, name: group.name, groupVisible: !!group.visible, disposed: !!r?.view?.disposed, meshes, instances };
  };
  P.begin = () => {
    const b = app.battle, r = routeOf();
    Object.assign(P, { log: [], hpDrops: [], clears: [], samples: [], stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0,
      sampledRooms: new Set(), darkSampled: false, sealT: null, startElapsed: b.elapsed });
    P.prev = { phase: r?.phase ?? null, gp: (r?.gates || []).map(g => g.phase), discords: r?.discords ?? 0, hold: r?.hold ?? 0, holdRoom: r?.holdGate?.room?.id ?? null,
      cleared: b.world.rooms.map(x => !!x.cleared), sealed: !!b.world.sealed, hp: b.player.hp, room: b.curRoom?.id ?? null, def: b.player.stats?.def ?? null, red: reductionState() };
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, gates: gateRows().length, rooms: b.world.rooms.length, sealed: !!b.world.sealed };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2), bells: bellView() };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, r = routeOf(), t = b.elapsed, p = b.player;
    if (isBells(r)) {
      const gp = r.gates.map(g => g.phase);
      gp.forEach((phase, i) => {
        if (phase === P.prev.gp[i]) return;
        const g = r.gates[i];
        P.log.push({ kind: 'gate', t, room: g.room.id, from: P.prev.gp[i], to: phase, ctlPhase: r.phase, tollIndex: r.tollIndex });
        P.prev.gp[i] = phase;
        if (phase === 'dark' && !P.darkSampled) { P.darkSampled = true; P.sample('firstDark', { gate: g.room.id }); }
      });
      if (r.discords > P.prev.discords) {
        // 방어력과 다른 경감 상태는 피해가 들어간 스텝 직전 값이다(가드는 피격 때 0 이 되므로 직후 값으로는 알 수 없다).
        P.log.push({ kind: 'discord', t, discords: r.discords, discordsBefore: P.prev.discords, hpBefore: P.prev.hp, hpAfter: p.hp, maxHp: p.maxHp, def: P.prev.def, reductions: P.prev.red, prevHold: P.prev.hold,
          prevHoldRoom: P.prev.holdRoom, wrongRoom: r.lastDiscord?.room?.id ?? null, phaseAfter: r.phase, progressAfter: r.progress, gatesAfter: gp.slice(), tolls: r.tolls, here: r.here?.id ?? null });
      }
      if (r.phase !== P.prev.phase) {
        P.log.push({ kind: 'ctl', t, from: P.prev.phase, to: r.phase, progress: r.progress, lit: r.lit, discords: r.discords, tolls: r.tolls, tollIndex: r.tollIndex,
          tollClock: num(r.tollClock), hpRatio: p.hp / p.maxHp, here: r.here?.id ?? null });
        P.prev.phase = r.phase;
      }
      P.prev.discords = r.discords; P.prev.hold = r.hold; P.prev.holdRoom = r.holdGate?.room?.id ?? null;
    }
    b.world.rooms.forEach((room, i) => {
      if (room.cleared && !P.prev.cleared[i]) { P.clears.push({ t, room: room.id, type: room.type }); P.prev.cleared[i] = true; }
    });
    if (P.prev.sealed && !b.world.sealed) { P.sealT = t; P.prev.sealed = false; }
    if (p.hp < P.prev.hp - 1e-6) P.hpDrops.push({ t, drop: P.prev.hp - p.hp, hp: p.hp, maxHp: p.maxHp, room: b.curRoom?.id ?? null });
    P.prev.hp = p.hp;
    P.prev.def = p.stats?.def ?? null; P.prev.red = reductionState();
    if (p.maxHp > 0) P.minHpRatio = Math.min(P.minHpRatio, p.hp / p.maxHp);
    let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    P.maxAlive = Math.max(P.maxAlive, alive);
    const room = b.curRoom?.id ?? null;
    if (room !== P.prev.room) {
      P.prev.room = room;
      // 종 방(정의가 있으면 gate 방, 없으면 모든 방)의 첫 진입 프레임을 잰다.
      if (room !== null && (!P.bellRooms || P.bellRooms.includes(room)) && !P.sampledRooms.has(room)) { P.sampledRooms.add(room); P.sample('enter:room' + room); }
    }
  };
  const hit = stop => {
    const b = app.battle, r = routeOf(), ok = isBells(r);
    switch (stop.type) {
      case 'ctl': return ok && r.phase === stop.phase;
      case 'lit': return ok && r.lit >= stop.n;
      case 'tollIndex': return ok && r.phase === 'toll' && r.tollIndex >= stop.n;
      case 'hold': return ok && r.phase === 'answer' && r.hold >= stop.s;
      case 'discords': return ok && r.discords >= stop.n;
      case 'time': return b.elapsed >= stop.t;
      case 'boss': return !!b.boss?.alive;
      case 'result': return !!app.expeditionUI.result;
      default: return false;
    }
  };
  P.run = ({ n, stop = null, renderEvery = 0 }) => {
    const b = app.battle; let ran = 0, reason = 'n';
    for (; ran < n; ran++) {
      if (!b.active) { reason = 'inactive'; break; }
      if (b.paused) { reason = 'paused'; break; }
      const render = renderEvery > 0 && P.steps % renderEvery === 0;
      const t0 = performance.now(); app.step(P.dt, render); const ms = performance.now() - t0;
      P.steps++; (render ? P.renderMs : P.stepMs).push(+ms.toFixed(3));
      if (ms > 50) P.slow.push({ t: b.elapsed, ms: +ms.toFixed(1), render, room: b.curRoom?.id ?? null, phase: routeOf()?.phase ?? null });
      observe();
      if (stop && hit(stop)) { reason = 'stop'; ran++; break; }
    }
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons] };
  };
  P.stepRaw = n => { for (let i = 0; i < n; i++) app.step(P.dt, false); return app.battle.elapsed; };
  P.freeze = () => {
    const b = app.battle; let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    return { elapsed: b.elapsed, paused: b.paused, active: b.active, hp: b.player.hp, maxHp: b.player.maxHp, pos: { x: b.player.pos.x, z: b.player.pos.z }, alive, kills: b.kills,
      ctl: ctlRow(), gates: gateRows(), bells: bellView() };
  };
  // 목표창 DOM 텍스트(게임이 실제로 그린 값). 10Hz 갱신이라 호출 전에 몇 스텝 진행한다.
  P.objectiveText = () => {
    const el = document.getElementById('objective');
    return { text: el ? el.textContent : null, action: el?.querySelector('.battle-objective-action')?.textContent ?? null, title: el?.querySelector('.battle-objective-title')?.textContent ?? null };
  };
  // 키보드 이동용: 종 중심까지 거리와 화면 방향(영웅 → 중심 투영 차). 입력은 밖에서 키로 보낸다.
  P.aimGate = room => {
    const b = app.battle, r = routeOf(), g = r?.gates?.find(x => x.room.id === room); if (!g) return null;
    const p = b.player.pos, c = app.renderer.camera; c.updateMatrixWorld();
    const a = p.clone().project(c), z = g.center.clone().project(c);
    return { room, phase: g.phase, radius: r.def.radius, dist: Math.hypot(g.center.x - p.x, g.center.z - p.z),
      dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2 };
  };
  P.summary = () => ({ steps: P.steps, stepMs: P.stepMs, renderMs: P.renderMs, slow: P.slow.slice(0, 20), maxAlive: P.maxAlive, minHpRatio: P.minHpRatio, samples: P.samples,
    log: P.log, clears: P.clears, hpDrops: P.hpDrops, sealT: P.sealT });
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
  qaAssert(items.length > 0, 'No glasswarden fixture items in target project');
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
async function beginRun(tag) {
  const before = await state();
  const row = { tag, status: 'running', before, choices: [] };
  await launchFromLobby(row);
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
  row.probe = await page.evaluate(installProbe, { bellRooms });
  row.begin = await page.evaluate(() => window.__bellQa.begin());
  row.bells = row.begin.kind === 'reverse-bells';
  report.bellsDetected = row.bells;
  // 정의가 있는 후보 빌드인데 컨트롤러가 다르면 기준선으로 오인하지 않도록 실패로 남긴다.
  if (bellDef && !row.bells) check(tag + ': 종문 정의가 있는데 컨트롤러 kind 가 reverse-bells 가 아님', false, { kind: row.begin.kind, controller: row.begin.controller });
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
async function advance(row, stop, { max = 60 * 60 * 12, chunk = 600, renderEvery = 0 } = {}) {
  let total = 0, last;
  while (total < max) {
    last = await page.evaluate(opts => window.__bellQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = () => page.evaluate(() => window.__bellQa.freeze());
const runSteps = n => page.evaluate(count => window.__bellQa.run({ n: count }), n);
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
/** 실제 #btn-auto 버튼으로 AUTO 를 원하는 상태로 맞춘다. */
async function setAuto(on) {
  const now = await page.evaluate(() => window.app.battle.player.auto);
  if (now !== on) await page.locator('#btn-auto').click();
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === on, 'Native AUTO button did not set AUTO ' + on);
}

// ---------- 키보드 이동(discord/screens) ----------
const held = new Set();
async function setKeys(next) {
  for (const key of [...held]) if (!next.has(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
/** 화면 방향(영웅 → 종 중심 투영 차)을 8방향 키 조합으로 바꾼다. 입력 키는 화면 기준이다(카메라 요를 입력층이 처리). */
function keysToward(aim) {
  const len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len, keys = new Set();
  if (ux > .38) keys.add('KeyD'); if (ux < -.38) keys.add('KeyA'); if (uy > .38) keys.add('KeyS'); if (uy < -.38) keys.add('KeyW');
  return keys;
}
/**
 * 영웅을 키보드로 roomId 종 중심으로 걷게 하고 그 종에서 불협이 날 때까지(= 유지 2초 이상) 서 있게 한다.
 * 중심 반경의 절반 안에 들면 키를 놓고 가만히 선다(반경 80% 밖으로 밀리면 다시 걷는다).
 * AUTO 는 꺼져 있어야 하고, 좌표 이동·무적 없이 실제 입력만 쓴다.
 */
async function dwellOnGate(row, roomId, { maxSteps = 60 * 40 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard dwelling');
  await nativeGameplayFocus(page); // 버튼 포커스를 벗어나 캔버스 키 입력을 살린다
  const before = (await freeze()).ctl.discords;
  let near = false, total = 0, trail = [];
  try {
    while (total < maxSteps) {
      const aim = await page.evaluate(id => window.__bellQa.aimGate(id), roomId);
      qaAssert(aim, 'No bell gate for room ' + roomId);
      near = near ? aim.dist <= aim.radius * .8 : aim.dist <= aim.radius * .5;
      await setKeys(near ? new Set() : keysToward(aim));
      const r = await page.evaluate(opts => window.__bellQa.run(opts), { n: near ? 12 : 6, stop: { type: 'discords', n: before + 1 } });
      total += r.ran;
      if (trail.length < 400 && total % 60 < 12) trail.push({ steps: total, dist: +aim.dist.toFixed(2), near, t: ms(r.elapsed), phase: aim.phase });
      if (r.reason === 'stop') return { room: roomId, steps: total, trail };
      if (r.reason === 'inactive') throw Error('Battle ended while dwelling on room ' + roomId);
      if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row); await nativeGameplayFocus(page); near = false; }
    }
    throw Error('Dwelling on room ' + roomId + ' did not reach discord within ' + maxSteps + ' steps: ' + JSON.stringify(trail.slice(-6)));
  } finally { await setKeys(new Set()); }
}
/** 불협 직후(소등 재생 중) 키보드로 종 원 밖(반경 + 1)까지 걸어 나간다. 다음 공명 단계에서 목표창을 읽는 동안 유지가 쌓이지 않게 한다(리뷰 b04-review P3). */
async function leaveGate(roomId, { maxSteps = 600 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard leaving');
  await nativeGameplayFocus(page);
  let total = 0;
  try {
    while (total < maxSteps) {
      const aim = await page.evaluate(id => window.__bellQa.aimGate(id), roomId);
      qaAssert(aim, 'No bell gate for room ' + roomId);
      qaAssert(aim.phase !== 'dark', 'Gate turned dark before leaving room ' + roomId);
      if (aim.dist > aim.radius + 1) return { room: roomId, steps: total, dist: +aim.dist.toFixed(2) };
      // 화면상 중심 반대쪽. 영웅이 중심과 겹쳐 방향이 없으면 아래(KeyS)로 나간다.
      const away = Math.hypot(aim.dx, aim.dy) > 1 ? keysToward({ dx: -aim.dx, dy: -aim.dy }) : new Set(['KeyS']);
      await setKeys(away);
      const r = await page.evaluate(opts => window.__bellQa.run(opts), { n: 6 });
      total += r.ran;
      if (r.reason !== 'n') throw Error('Leaving room ' + roomId + ' stopped: ' + r.reason);
    }
    throw Error('Leaving room ' + roomId + ' did not exit the bell circle within ' + maxSteps + ' steps');
  } finally { await setKeys(new Set()); }
}
/** 불협 직후 사건을 로그에서 읽어 정답 방과 함께 판정한다. */
async function verifyLastDiscord(row, ordinal) {
  const log = await page.evaluate(() => window.__bellQa.log);
  const events = discordEvents(log, bellDef), event = events.at(-1);
  qaAssert(event && events.length === ordinal, 'Expected discord #' + ordinal + ' in log, found ' + events.length);
  const result = checkDiscord(event, bellDef);
  check(row.tag + ': 불협 ' + ordinal + '회째 사건(1회 증가·방어 경감 적용 ' + Math.round(bellDef.discord.damage * 100) + '% 기준 피해·2초 유지·오답 종·toll·progress 0·모든 종 lit)', result.ok, { event, result });
  (row.discordChecks ??= []).push({ ordinal, event, result });
  return result;
}
/** 목표창 DOM 이 answer 단계 문구로 바뀔 때까지 몇 스텝 진행한 뒤 읽는다(10Hz 갱신 때문). */
async function readAnswerObjective() {
  let last;
  for (let n = 0; n < 10; n++) {
    await runSteps(6);
    last = await page.evaluate(() => window.__bellQa.objectiveText());
    if (last.title?.includes('종문 역순 공명')) return { ...last, settled: true };
  }
  return { ...last, settled: false };
}
async function checkObjectiveLeak(row, discords) {
  const expectedLabel = labelOf(answerOrder[0]);
  const dom = await readAnswerObjective();
  const verdict = checkGuideText(dom.text, { discords, guideAfter: bellDef.guideAfter, expectedLabel });
  (row.objectiveReads ??= []).push({ discords, expectedLabel, dom, verdict });
  check(row.tag + ': 목표창이 answer 문구로 갱신됨(불협 ' + discords + ')', dom.settled, dom);
  check(row.tag + ': 목표창 ' + (discords >= bellDef.guideAfter ? "'다음 ' + 정답 label 표시" : '정답 미노출') + '(불협 ' + discords + ')', verdict.ok, verdict);
  return verdict;
}

/** 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·종문 판정을 기록한다. */
async function playToEnd(row, { moments = [], expectedDiscords = 0, expectFirstClear = true } = {}) {
  row.shots = [];
  for (const moment of moments) {
    const r = await advance(row, moment.stop, { renderEvery: 0 });
    if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); break; }
    row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed) });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await waitResult();
  row.summary = await page.evaluate(() => window.__bellQa.summary());
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
  const s = row.summary;
  row.metrics = { elapsed: row.result?.time ?? null, kills: row.result?.kills ?? null, hpDrops: s.hpDrops.length, hpDropTotal: ms(s.hpDrops.reduce((sum, d) => sum + d.drop, 0)),
    minHpRatio: s.minHpRatio, maxAlive: s.maxAlive, simulation: stepStats(s.stepMs), render: stepStats(s.renderMs), over50ms: s.slow.length, slow: s.slow,
    drawCalls: s.samples.map(x => ({ label: x.label, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms, bells: x.bells })) };
  check(row.tag + ': 50ms 초과 스텝 없음(SwiftShader JS ms)', s.slow.length === 0, s.slow);
  if (row.bells) {
    const ro = row.result?.routeObjective;
    row.bellAnalysis = analyzeBells({ log: s.log, clears: s.clears, sealT: s.sealT, result: ro, resultText: row.resultText, expectedDiscords }, bellDef);
    for (const [name, ok] of Object.entries(row.bellAnalysis.acceptance)) check(row.tag + ': 종문 ' + name, ok, ok ? undefined : row.bellAnalysis[{ phaseOrderValid: 'timeline', tollSequence: 'replays', reverseAnswer: 'answers', clearedOnlyAfterDone: 'clears', resultObjective: 'result', resultLine: 'resultLine' }[name]]);
    check(row.tag + ': 봉인 해제 시각 관측(done 이후)', s.sealT != null, { sealT: s.sealT });
    check(row.tag + ': 결과 routeObjective(불협 ' + expectedDiscords + ')', checkResult(ro, bellDef, { discords: expectedDiscords, win }).ok, ro);
    // 불협이 하나도 없는 완주에서는 HP 감소 사건이 불협 때문이 아님을 확인한다(불협 로그 0).
    if (expectedDiscords === 0) check(row.tag + ': 불협 사건 0', discordEvents(s.log, bellDef).length === 0);
    const dark = s.samples.find(x => x.label === 'firstDark');
    check(row.tag + ': 첫 소등 프레임 표본·종 메시 표시', !!dark && dark.bells?.found && dark.bells.meshes > 0, dark);
    const entered = s.samples.filter(x => x.label.startsWith('enter:room') && bellRooms.includes(x.room));
    check(row.tag + ': 종 방 ' + bellRooms.length + '곳 첫 진입 프레임 표본', entered.length === bellRooms.length, entered.map(x => x.label));
    row.timeline = { ctl: s.log.filter(e => e.kind === 'ctl').map(e => ({ t: ms(e.t), from: e.from, to: e.to, discords: e.discords, tolls: e.tolls })),
      darks: s.log.filter(e => e.kind === 'gate' && e.to === 'dark').map(e => ({ t: ms(e.t), room: e.room })),
      resonated: s.log.filter(e => e.kind === 'gate' && e.to === 'resonated').map(e => ({ t: ms(e.t), room: e.room })),
      lit: s.log.filter(e => e.kind === 'gate' && e.to === 'lit' && e.from === 'locked').map(e => ({ t: ms(e.t), room: e.room })),
      discords: s.log.filter(e => e.kind === 'discord').map(e => ({ t: ms(e.t), room: e.wrongRoom, hpDrop: ms(e.hpBefore - e.hpAfter), maxHp: e.maxHp, discords: e.discords })),
      clears: s.clears.map(c => ({ t: ms(c.t), room: c.room })), sealT: s.sealT };
  } else {
    row.baseline = { skipped: 'kind !== reverse-bells (기준선 빌드): 종 검사 생략, 공통 측정만 기록', elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops,
      frames: { simulation: row.metrics.simulation, render: row.metrics.render }, drawCalls: row.metrics.drawCalls };
  }
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
async function pauseBattle() {
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => window.app.battle.paused && document.getElementById('pause-overlay').classList.contains('show'));
}
async function resumeBattle() {
  await page.locator('#btn-resume').click();
  await page.waitForFunction(() => !window.app.battle.paused);
}
const wrongRoom = () => bellDef.tollOrder[0]; // 가장 먼저 꺼진 종 = 정답 공명의 마지막. 첫 정답 방과 다르다.

// ---------- 프로필 ----------
const profiles = {
  async auto() {
    await applyFixture();
    const row = await beginRun('auto');
    await playToEnd(row, { expectedDiscords: 0 });
    await closeResultToLobby();
    await reloadCheck(row);
    return { runs: [row] };
  },
  async discord() {
    await applyFixture();
    const row = await beginRun('discord');
    if (!row.bells) return { skipped: '기준선 빌드에는 종문 컨트롤러가 없다' };
    qaAssert(wrongRoom() !== answerOrder[0], 'Data has no wrong first gate');
    await advance(row, { type: 'ctl', phase: 'answer' }, { max: 60 * 60 * 12 });
    row.firstAnswer = await freeze();
    check('discord: AUTO 로 answer 까지 도달·불협 0·progress 0', row.firstAnswer.ctl.phase === 'answer' && row.firstAnswer.ctl.discords === 0 && row.firstAnswer.ctl.progress === 0, row.firstAnswer.ctl);
    await setAuto(false);
    await checkObjectiveLeak(row, 0);
    row.dwell1 = await dwellOnGate(row, wrongRoom());
    const first = await verifyLastDiscord(row, 1);
    row.afterFirst = await freeze();
    check('discord: 1회째 뒤 불협 1·toll·progress 0·모든 종 lit', row.afterFirst.ctl.discords === 1 && row.afterFirst.ctl.phase === 'toll' && row.afterFirst.ctl.progress === 0
      && row.afterFirst.gates.every(g => g.phase === 'lit'), { ctl: row.afterFirst.ctl, gates: row.afterFirst.gates, first: first.ok });
    row.shotDiscord1 = await shot('discord-1-after');
    await advance(row, { type: 'ctl', phase: 'answer' }, { max: 60 * 60 });
    await checkObjectiveLeak(row, 1);
    row.dwell2 = await dwellOnGate(row, wrongRoom());
    await verifyLastDiscord(row, 2);
    row.leave2 = await leaveGate(wrongRoom());
    await advance(row, { type: 'ctl', phase: 'answer' }, { max: 60 * 60 });
    const guide = await checkObjectiveLeak(row, 2);
    row.guideRoom = (await freeze()).ctl.guideRoom;
    check('discord: 컨트롤러 guide 가 정답 첫 종(' + labelOf(answerOrder[0]) + ')', row.guideRoom === answerOrder[0], { guideRoom: row.guideRoom, expected: answerOrder[0], domOk: guide.ok });
    row.shotGuide = await shot('discord-guide');
    await setAuto(true);
    await playToEnd(row, { expectedDiscords: 2 });
    await closeResultToLobby();
    return { runs: [row] };
  },
  async pause() {
    await applyFixture();
    const row = await beginRun('pause');
    if (!row.bells) return { skipped: '기준선 빌드에는 종문 컨트롤러가 없다' };
    // 소등 중 일시정지: tollClock·tollIndex·종 상태가 멈추고 재개 뒤 이어진다.
    await advance(row, { type: 'tollIndex', n: 1 }, { max: 60 * 60 * 12 });
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(() => window.__bellQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await freeze();
    const same = JSON.stringify([paused.elapsed, paused.ctl, paused.gates]) === JSON.stringify([still.elapsed, still.ctl, still.gates]);
    check('pause: 소등 중 120스텝+1초 동안 게임 시간·tollClock·tollIndex·종 상태 불변', same, { paused: paused.ctl, still: still.ctl });
    check('pause: 소등 중 정지 시점의 phase 는 toll', paused.ctl.phase === 'toll' && still.ctl.phase === 'toll', { phase: still.ctl.phase });
    row.pauseTollShot = await shot('paused-toll');
    await resumeBattle();
    const resumedRun = await runSteps(60);
    const resumed = await freeze();
    const advanced = resumed.ctl.tollClock - still.ctl.tollClock;
    check('pause: 재개 뒤 tollClock 이 이어서 진행(60스텝 ± 2스텝, 정지 시간 미반영)', resumed.ctl.phase !== 'toll' || Math.abs(advanced - 60 * FRAME) <= 2 * FRAME + 1e-9,
      { before: before.ctl.tollClock, still: still.ctl.tollClock, resumed: resumed.ctl.tollClock, advanced, reason: resumedRun.reason });
    // answer 유지 중 일시정지: 유지는 0 으로 돌아가고 진행도·불협은 그대로이며 재개 뒤 다시 쌓인다.
    await advance(row, { type: 'hold', s: .4 }, { max: 60 * 60 * 12 });
    const held1 = await freeze();
    check('pause: 일시정지 직전 answer 유지 중', held1.ctl.phase === 'answer' && held1.ctl.hold >= .4 && held1.ctl.holdRoom !== null, held1.ctl);
    await pauseBattle();
    const holdPaused = await freeze();
    await page.evaluate(() => window.__bellQa.stepRaw(120)); await page.waitForTimeout(1000);
    const holdStill = await freeze();
    check('pause: answer 유지 중 일시정지면 hold 0·단계/진행/불협 유지', holdPaused.ctl.hold === 0 && holdStill.ctl.hold === 0 && holdStill.ctl.phase === 'answer'
      && holdStill.ctl.progress === held1.ctl.progress && holdStill.ctl.discords === held1.ctl.discords && holdStill.elapsed === holdPaused.elapsed, { held: held1.ctl, paused: holdPaused.ctl, still: holdStill.ctl });
    row.pauseHoldShot = await shot('paused-answer-hold');
    await resumeBattle();
    await runSteps(30);
    const holdResumed = await freeze();
    check('pause: 재개 뒤 hold 는 0 에서 다시 쌓임(이전 유지를 이어받지 않음)', holdResumed.ctl.hold <= 31 * FRAME + 1e-9 && holdResumed.ctl.discords === held1.ctl.discords, { held: held1.ctl.hold, resumed: holdResumed.ctl.hold });
    row.holdAfterResume = holdResumed.ctl;
    await playToEnd(row, { expectedDiscords: 0 });
    await closeResultToLobby();
    return { runs: [row] };
  },
  async refresh() {
    await applyFixture();
    const row = await beginRun('refresh');
    await advance(row, row.bells ? { type: 'ctl', phase: 'answer' } : { type: 'time', t: 20 }, { max: 60 * 60 * 12 });
    row.atRefresh = await freeze();
    const mid = await state();
    check('refresh: ' + (row.bells ? 'answer 단계' : '전투 중') + ' 저장에 pending 티켓 존재', mid.pending?.id === row.started.pending.id);
    await qa.boot({ reload: true });
    const first = await state();
    row.firstReload = { state: first, energy: energyChange({ ...row.before, energy: row.before.energy }, first, 0, 'refresh refund') };
    check('refresh: pending 취소·에너지 1회 환급', first.pending === null && first.mode === 'lobby' && first.energy >= row.before.energy && first.energy <= row.before.energy + 2 && first.depthWins === row.before.depthWins, { before: row.before.energy, started: row.started.energy, after: first.energy });
    await qa.boot({ reload: true });
    const second = await state();
    check('refresh: 두 번째 새로고침은 추가 환급 없음', second.energy <= first.energy + 2 && second.pending === null, { first: first.energy, second: second.energy });
    row.status = 'pass'; return { runs: [row] };
  },
  async screens() {
    await applyFixture();
    const row = await beginRun('screens');
    if (!row.bells) {
      await playToEnd(row, { moments: [{ label: 'boss', stop: { type: 'boss' } }], expectedDiscords: 0 });
    } else {
      row.shots = [];
      const moments = [{ label: 'wake-lit', stop: { type: 'lit', n: 1 } }, { label: 'toll', stop: { type: 'tollIndex', n: 1 } }, { label: 'answer-hold', stop: { type: 'hold', s: .6 } }];
      for (const moment of moments) {
        const r = await advance(row, moment.stop, { max: 60 * 60 * 12 });
        if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); continue; }
        row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed), ctl: (await freeze()).ctl });
      }
      check('screens: wake 점등·소등 중·answer 유지 순간에 도달', row.shots.every(s => s.reached), row.shots.map(s => ({ label: s.label, reached: s.reached })));
      // 불협 직후 장면은 실제 키보드 입력으로 만든다. AUTO 를 끄고 오답 종에 머문 뒤 바로 촬영하고 다시 AUTO 로 완주한다.
      await setAuto(false);
      row.dwell = await dwellOnGate(row, wrongRoom());
      await verifyLastDiscord(row, 1);
      row.shots.push({ label: 'discord-after', reached: true, files: await captureScreens('discord-after-' + row.tag), ctl: (await freeze()).ctl });
      await setAuto(true);
      await playToEnd(row, { expectedDiscords: 1 });
    }
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
  for (const name of selected) {
    const started = Date.now();
    try {
      report.profiles[name] = { status: 'running' }; await qa.save();
      const result = await profiles[name]();
      report.profiles[name] = { status: result.skipped ? 'skipped' : 'pass', ...result, wallMs: Date.now() - started };
    } catch (error) {
      report.profiles[name] = { status: 'fail', failure: String(error?.stack || error), wallMs: Date.now() - started };
      process.exitCode = 1;
      // 실패 표본의 원인을 남긴다: 종문 사건 로그·정화 순서·AUTO 목표·방별 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__bellQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        const pending = {};
        for (const n of b.pending) pending[n.room?.id ?? 'none'] = (pending[n.room?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.() ?? null, summary: q?.summary ? (({ log, clears, hpDrops, sealT }) => ({ log, clears, hpDrops, sealT }))(q.summary()) : null,
          objective: q?.objectiveText?.() ?? null, autoTarget: b.autoTarget?.id ?? null, curRoom: b.curRoom?.id ?? null, sealed: !!b.world.sealed, alive, pending,
          rooms: b.world.rooms.map(r => ({ id: r.id, type: r.type, spawned: !!r.spawned, cleared: !!r.cleared, discovered: !!r.discovered })),
          auto: !!b.player?.auto, playerState: b.player?.state ?? null };
      }).catch(diagError => ({ error: String(diagError) }));
      await setKeys(new Set()).catch(() => {});
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
console.log(JSON.stringify({ status: report.status, out: qa.out, bellsDetected: report.bellsDetected, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
