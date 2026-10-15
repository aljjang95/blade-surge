#!/usr/bin/env node
// 혜성 기사단장 보스전 푸른 궤도선(comet_bastion 일반·심층) 실제 UI QA 도구 (BUNDLE-06 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 보스전을 app.step 한 번마다 관측한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 읽기 경로: app.battle.routeObjectives.bossOrbit (state/kind/warnLeft/warnTotal/strikes/centerStrikes/hits/attackStartsDuringWarn/center/def)와
// 전투 종료 보고 routeObjective.bossMeteors/bossCenterMeteors/bossMeteorHits, 결과 화면 DOM 줄 '푸른 궤도선 유성 n회 · 피격 m회', 목표창 #objective 문구.
// bossOrbit 이 없는 기준선 빌드(예: 0838881)에서는 궤도선 판정을 건너뛰고 보스 등장·처치 시각, 보스방 첫 진입·bossReady draw call, 보스 구간 스텝 ms, 완주 시간만 남긴다.
// 판정 함수는 tools/comet-boss-checks.mjs 에 있고 test/comet-boss-checks.test.ts 가 합격·불합격 입력을 모두 검사한다. 기준선 비교는 tools/comet-boss-compare.mjs 다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { FRAME, analyzeBossOrbit, checkManualSegment, checkPause, checkScreens, stepStats, summarizeBoss } from './comet-boss-checks.mjs';

const HELP = [
  '사용법: node tools/comet-boss-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '                           bossOrbit 이 없는 기준선 빌드(예: 0838881)도 받는다. 그때는 궤도선 판정을 건너뛰고 공통 측정만 남긴다.',
  '  --depth=<standard|deep>  개인 기본 원정 comet_bastion 의 일반 카드 또는 심층 카드(기본 deep)',
  '  --profile=<목록>          auto|orbit|pause|screens|all (쉼표로 여러 개, 기본 auto)',
  '  --seed=<uint32>           Math.random 시드(기본 20261015)',
  '  --hero=<id>               fixture 영웅 knight|mage 등(기본 knight)',
  '  --viewport=WxH            기본 844x390',
  '  --motion=reduce|no-preference   브라우저 prefers-reduced-motion(기본 reduce). 값 없는 --motion 은 reduce',
  '  --quality=low|default     low 면 설정 핸들러와 같은 경로(settings.quality=low + applySettings)로 낮은 화질. 값 없는 --quality 는 low',
  '  --origin=<url>            공유 런타임 옵션(로컬 preview 또는 고정 라이브 주소만 허용)',
  '  --help                    이 도움말',
  '',
  '프로필(F = fixture, R = 실제 UI·입력, C = 제어 실행)',
  '  auto     F 저장 주입(해금·영웅·장비·에너지) → R 출격 카드 버튼 → R #btn-auto → C 고정 1/60 스텝 완주 → R 결과 화면 → R 새로고침 보존',
  '           + 보스전 관측·판정(후보 빌드): 낙하마다 예고 길이·kind 순서·피격 = 구역 판정·예고 중 새 공격 없음, 처치 뒤 ended,',
  '             결과 bossMeteors/bossMeteorHits = 관측 수, 결과 줄, 목표창 warn 문구, complete·progress = target',
  '  orbit    AUTO 로 보스 부착까지 → R #btn-auto 로 AUTO 끔 → R 키보드(KeyW/A/S/D)로 예고마다 안전 지점(outer 반지름 4.0 · center 반지름 6.6)으로 이동,',
  '           공격 키 없음 → 낙하 3회 이상(outer ≥ 1 · center ≥ 1)·피격 0 확인 → R #btn-auto 로 AUTO 켬 → 완주. 영웅이 쓰러지면 실패',
  '  pause    warn 중 R #btn-pause → 120스텝+1초 동안 warnLeft·strikes·게임 시간 불변 → R #btn-resume → 이어짐 → 낙하 → 완주',
  '  screens  궤도선 armed · 바깥 예고 · 중심 예고 순간마다 640x360, 844x390, 390x844 스크린샷(PNG) + 결과',
  '',
  '주의: 좌표 이동·무적·HP 주입·보스 hp 조작으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.',
  'SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다. orbit 의 키보드 입력은 Playwright 가 보낸 에뮬레이터 키 이벤트다.',
].join('\n');
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
// 값 없는 플래그(--quality, --motion)도 받는다.
const flag = (name, bare, fallback) => qaArgument(name) ?? (process.argv.includes('--' + name) ? bare : fallback);
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'orbit', 'pause', 'screens'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
const depth = arg('depth', 'deep');
qaAssert(['standard', 'deep'].includes(depth), '--depth must be standard|deep');
const deep = depth === 'deep';
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
const DUNGEON_ID = 'comet_bastion';
/** orbit 프로필이 향하는 안전 지점 반지름(PLAN 6절). 방향은 영웅의 현재 방향을 유지한다. */
const SAFE_TARGET = Object.freeze({ outer: 4.0, center: 6.6 });

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다). 접근·에너지·보상을 이 파일에 박지 않는다.
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { DUNGEONS } = await load('src/data/expansion.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const dungeonDef = deep ? EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID) : DUNGEONS.find(d => d.id === DUNGEON_ID);
qaAssert(dungeonDef, 'Target project has no ' + DUNGEON_ID + ' ' + depth + ' definition');
// 보스 궤도선 정의(후보 빌드에만 있다). 기준선 빌드에서는 null 이고 궤도선 검사를 건너뛴다.
const routeData = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES ?? {};
const routeDef = (deep ? routeData.comet_deep : routeData.comet_standard) ?? null;
const orbitDef = routeDef?.boss ?? null;
const needsKeyboard = selected.includes('orbit');

const STEP_CLASS = {
  auto: [['F', '저장 주입(해금·영웅 Lv.50 별3 스킬5·장비·에너지·AUTO)'], ['R', '출격 카드 버튼 · #btn-auto'], ['C', 'app.testPause + 고정 1/60 app.step 으로 완주'],
    ['C', '보스 구간 app.step 한 번마다 page.evaluate 한 번에 관측(읽기 전용)'], ['R', '결과 화면 DOM · 로비 버튼 · 새로고침']],
  orbit: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 보스 부착(armed)까지 고정 스텝'],
    ['R', '키보드 KeyW/A/S/D 로 예고마다 안전 지점 이동(공격 키 없음)'], ['C', '키 입력 사이 4스텝씩 고정 진행'], ['C', 'AUTO 완주 · 결과 판정']],
  pause: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 warn 중반까지 고정 스텝'], ['C', '정지 중 app.step 120회(stepRaw)로 게임 시간 불변 확인']],
  screens: [['F', '저장 주입'], ['R', '출격 카드 버튼'], ['C', 'AUTO 로 armed·바깥 예고·중심 예고 순간까지 고정 스텝'], ['C', 'renderer.render() 단독 호출 + viewport 3종 스크린샷(시뮬레이션 tick 없음)']],
};
const report = { kind: 'comet-boss-qa', releaseApproved: false, seed, heroId, depth, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'comet-boss-checks.mjs'))), profiles: {}, checks: [], reportItems: {},
  orbitDefinition: orbitDef ? JSON.parse(JSON.stringify(orbitDef)) : null,
  catalog: { id: dungeonDef.id, depth, energy: dungeonDef.energy, minLevel: dungeonDef.minLevel, unlockCode: dungeonDef.unlockCode ?? null, rewards: dungeonDef.rewards,
    firstRewards: dungeonDef.firstRewards ?? null, objective: dungeonDef.objective ?? null, routeKind: routeDef?.kind ?? null, routeId: routeDef?.id ?? null },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^' + (deep ? '심층' : '기본') + ' 원정/',
      ...(deep ? [] : ['details.exp-dungeon-details > summary (닫혀 있으면)']), '[data-dungeon="comet_bastion"][data-depth="' + depth + '"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창 textContent, 10Hz 갱신이라 warn 시작 0.25초 뒤부터 표본)'],
    result: ['.exp-result-shell (결과 줄 innerText, "푸른 궤도선 유성 n회 · 피격 m회")', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives.bossOrbit (getter: state/kind/warnLeft/warnTotal/strikes/centerStrikes/hits/attackStartsDuringWarn/center/def)',
      'window.app.battle.boss (hp/alive/spawning/state/special/attackSequence/completedAttackSequence)', 'window.app.battle.player (pos/hp/maxHp/invuln/auto/state)',
      'window.app.input (attackHeld)', 'window.app.expeditionUI.result.routeObjective.bossMeteors/bossCenterMeteors/bossMeteorHits', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨' + (deep ? '·기본 원정 승리' : '') + ')·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)', quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → ' + (deep ? '심층' : '기본') + ' 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      needsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): 걷는 방향은 도구가 안전 지점의 화면 투영으로 정함. 텔레포트·무적·HP 주입·공격 키 없음' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각'],
    steps: Object.fromEntries(selected.map(name => [name, STEP_CLASS[name].map(([kind, detail]) => ({ kind, detail }))])) },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·보스 hp·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/comet-boss-orbit.js', 'src/game/comet-boss-orbit-view.js', 'src/game/comet-orbits.js', 'src/game/comet-deep-orbits.js', 'src/game/route-objectives.js',
  'src/data/route-objectives.js', 'src/data/expedition-depths.js', 'src/data/expansion.js', 'src/data/stages.js', 'src/ui/battle-objective-view.js', 'src/expansion/hub.jsx',
  'src/game/battle-base.js', 'src/game/enemies.js', 'src/game/player.js', 'src/game/expedition-economy.js', 'src/main.js'].filter(file => fs.existsSync(path.join(projectRoot, file)));
const qa = await createExpeditionQa({ root: projectRoot, driver: import.meta.filename, report, sourceFiles });
let page;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };

// ---------- 페이지 안 측정 프로브(게임 판정에는 쓰지 않는다) ----------
function installProbe(cfg) {
  const app = window.app;
  const P = window.__cometBossQa = { dt: 1 / 60, steps: 0, cfg };
  const routeOf = () => app.battle.routeObjectives;
  const orbitOf = () => routeOf()?.bossOrbit ?? null;
  const orbitRow = () => {
    const o = orbitOf(); if (!o) return null;
    return { state: o.state, kind: o.kind ?? null, warnLeft: o.warnLeft, warnTotal: o.warnTotal, strikes: o.strikes, centerStrikes: o.centerStrikes, hits: o.hits, asw: o.attackStartsDuringWarn };
  };
  // 궤도선 뷰(이름에 BossOrbit 이 들어간 그룹)에서 보이는 mesh 수. 이름을 못 찾으면 found false. draw call 표본의 참고 정보다.
  const orbitView = () => {
    let found = false, meshes = 0;
    app.renderer.scene.traverse(o => {
      if (!/boss.?orbit/i.test(o.name)) return;
      found = true;
      o.traverse(m => { if (!m.isMesh) return; let vis = true; for (let n = m; n; n = n.parent) { if (!n.visible) { vis = false; break; } if (n === o) break; } if (vis) meshes++; });
    });
    return { found, meshes };
  };
  const bossRow = () => {
    const boss = app.battle.boss ?? P.bossRef; if (!boss) return null;
    return { hp: boss.hp, alive: !!boss.alive, state: boss.state, special: boss.special ?? null, seq: boss.attackSequence || 0 };
  };
  P.begin = () => {
    const b = app.battle, r = routeOf();
    Object.assign(P, { hpDrops: [], clears: [], samples: [], stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0, startElapsed: b.elapsed,
      // 보스 구간(보스가 처음 나타난 스텝부터 처치까지): 행 trace·스텝 ms·영웅 HP 최소 비율. 처치 뒤 12스텝까지 더 남겨 ended 를 본다.
      bossRef: null, bossDone: false, bossPost: 0, bossTrace: [], bossSlow: [], bossStepMs: [], bossRenderMs: [], bossMinHpRatio: 1,
      bossEnterSampled: false, bossReadyAt: null, bossReadySampled: false, marks: [] });
    P.prev = { cleared: b.world.rooms.map(x => !!x.cleared), hp: b.player.hp, room: b.curRoom?.id ?? null };
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, rooms: b.world.rooms.length, orbit: !!orbitOf(), orbitDef: orbitOf()?.def ?? null };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const o = orbitOf();
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2),
      orbit: o ? o.state : null, view: o ? orbitView() : null };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  // 보스 구간 관측. 스텝 뒤 page.evaluate 한 번(P.run)에 묶인 기존 방식 그대로이고 게임 객체에는 아무것도 붙이지 않는다.
  const bossObserve = (ms, render) => {
    const b = app.battle, p = b.player;
    let boss = P.bossRef;
    if (!boss) { if (!b.boss) return; boss = P.bossRef = b.boss; }
    if (P.bossPost >= 12) return;
    const inSegment = !P.bossDone, o = orbitOf(), alive = !!boss.alive;
    if (inSegment) {
      (render ? P.bossRenderMs : P.bossStepMs).push(+ms.toFixed(3));
      if (ms > 50) P.bossSlow.push({ t: b.elapsed, ms: +ms.toFixed(1), render, state: boss.state, special: boss.special ?? null, orbit: o ? o.state : null });
      if (p.maxHp > 0) P.bossMinHpRatio = Math.min(P.bossMinHpRatio, p.hp / p.maxHp);
    } else P.bossPost++;
    const c = o?.center;
    const row = { n: P.steps, t: b.elapsed, hp: boss.hp, alive, spn: !!boss.spawning, st: boss.state, sp: boss.special ?? null, seq: boss.attackSequence || 0, cseq: boss.completedAttackSequence || 0,
      os: o ? o.state : null, ok: o ? (o.kind ?? null) : null, wl: o ? o.warnLeft : null, wt: o ? o.warnTotal : null, sk: o ? o.strikes : null, ck: o ? o.centerStrikes : null,
      ht: o ? o.hits : null, asw: o ? o.attackStartsDuringWarn : null, hr: o && c ? Math.hypot(p.pos.x - c.x, p.pos.z - c.z) : null,
      hhp: p.hp, hmax: p.maxHp, inb: b.world.roomAt?.(p.pos.x, p.pos.z)?.type === 'boss', inv: (p.invuln || 0) > 0, au: !!p.auto, ah: !!app.input.attackHeld, ps: p.state };
    // 목표창은 10Hz 로 갱신되므로 warn 시작 0.25초 뒤부터 6스텝마다 표본을 남긴다.
    if (o && o.state === 'warn' && o.warnTotal - o.warnLeft >= .25 && P.steps % 6 === 0) row.dom = document.getElementById('objective')?.textContent ?? null;
    P.bossTrace.push(row);
    if (!alive) P.bossDone = true;
    // 'bossReady': spawning 이 풀린 스텝의 다음 스텝 끝에서 찍는다(후보·기준선 같은 정의). 컨트롤러는 spawning 이 풀린 다음 스텝의 routeObjectives
    // 단계에서 부착하므로(armed) 이 표본에서 후보는 궤도선이 armed 이고 뷰가 보인다(표본의 orbit·view 에 적힌다).
    if (!boss.spawning && P.bossReadyAt === null) P.bossReadyAt = P.steps;
    else if (P.bossReadyAt !== null && !P.bossReadySampled && P.steps > P.bossReadyAt) { P.bossReadySampled = true; P.sample('bossReady'); }
  };
  const observe = (ms, render) => {
    const b = app.battle, p = b.player;
    b.world.rooms.forEach((room, i) => {
      if (room.cleared && !P.prev.cleared[i]) { P.clears.push({ t: b.elapsed, room: room.id, type: room.type }); P.prev.cleared[i] = true; }
    });
    if (p.hp < P.prev.hp - 1e-6) P.hpDrops.push({ t: b.elapsed, drop: P.prev.hp - p.hp, hp: p.hp, maxHp: p.maxHp, room: b.curRoom?.id ?? null });
    P.prev.hp = p.hp;
    if (p.maxHp > 0) P.minHpRatio = Math.min(P.minHpRatio, p.hp / p.maxHp);
    let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    P.maxAlive = Math.max(P.maxAlive, alive);
    const room = b.curRoom?.id ?? null;
    if (room !== P.prev.room) {
      P.prev.room = room;
      // 보스방 첫 진입 프레임의 draw call(기준선 비교 대상).
      if (b.curRoom?.type === 'boss' && !P.bossEnterSampled) { P.bossEnterSampled = true; P.sample('bossEnter'); }
    }
    bossObserve(ms, render);
  };
  const hit = stop => {
    const b = app.battle, o = orbitOf();
    switch (stop.type) {
      case 'time': return b.elapsed >= stop.t;
      case 'boss': return !!b.boss?.alive;
      case 'bossReady': return !!b.boss?.alive && !b.boss.spawning;
      case 'orbit': {
        if (!o || o.state !== stop.state) return false;
        if (stop.kind && o.kind !== stop.kind) return false;
        if (stop.leftMax != null && !(o.warnLeft <= stop.leftMax)) return false;
        if (stop.minAge != null && !(o.warnTotal - o.warnLeft >= stop.minAge)) return false;
        return true;
      }
      case 'strikes': return !!o && o.strikes >= stop.n;
      case 'orbitDone': return !!o && o.strikes >= stop.min && o.centerStrikes >= 1 && o.strikes - o.centerStrikes >= 1;
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
      if (ms > 50) P.slow.push({ t: b.elapsed, ms: +ms.toFixed(1), render, room: b.curRoom?.id ?? null, orbit: orbitOf()?.state ?? null });
      observe(ms, render);
      if (stop && hit(stop)) { reason = 'stop'; ran++; break; }
    }
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons] };
  };
  P.stepRaw = n => { for (let i = 0; i < n; i++) app.step(P.dt, false); return app.battle.elapsed; };
  P.traceLength = () => P.bossTrace.length;
  P.freeze = () => {
    const b = app.battle; let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    return { elapsed: b.elapsed, paused: b.paused, active: b.active, hp: b.player.hp, maxHp: b.player.maxHp, pos: { x: b.player.pos.x, z: b.player.pos.z }, alive, kills: b.kills,
      orbit: orbitRow(), boss: bossRow() };
  };
  // 키보드 이동용: 영웅의 궤도 중심 기준 반지름과 안전 지점까지의 화면 방향(영웅 → 안전 지점 투영 차). 입력은 밖에서 키로 보낸다.
  // 안전 지점 = 영웅의 현재 방향(중심 → 영웅)을 유지한 반지름 cfg.targets[kind]. warn center 면 6.6, 그 밖(armed·warn outer)은 4.0.
  // 이미 안전한 창 안(center: 6.2~8.4, 그 밖: 4.6 이하)이면 inside 로 알리고 멈춘다.
  P.aimOrbit = () => {
    const b = app.battle, o = orbitOf(); if (!o) return null;
    const p = b.player.pos, c = o.center, cam = app.renderer.camera;
    let dx = p.x - c.x, dz = p.z - c.z; const r = Math.hypot(dx, dz);
    if (r < .3) { const bp = b.boss?.pos ?? P.bossRef?.pos; dx = bp ? p.x - bp.x : 0; dz = bp ? p.z - bp.z : 1; if (Math.hypot(dx, dz) < 1e-6) { dx = 0; dz = 1; } }
    const len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
    const centerWarn = o.state === 'warn' && o.kind === 'center';
    const R = centerWarn ? P.cfg.targets.center : P.cfg.targets.outer;
    const inside = centerWarn ? r >= 6.2 && r <= 8.4 : r <= 4.6;
    cam.updateMatrixWorld();
    const a = p.clone().project(cam), z = p.clone().set(c.x + ux * R, p.y, c.z + uz * R).project(cam);
    return { state: o.state, kind: o.kind ?? null, warnLeft: o.warnLeft, r, target: R, inside, strikes: o.strikes, centerStrikes: o.centerStrikes, hits: o.hits,
      dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2 };
  };
  // 느린 스텝 목록은 자르지 않는다(기준선 비교가 개수를 정확히 세야 한다).
  P.summary = () => ({ steps: P.steps, stepMs: P.stepMs, renderMs: P.renderMs, slow: P.slow, maxAlive: P.maxAlive, minHpRatio: P.minHpRatio, samples: P.samples,
    clears: P.clears, hpDrops: P.hpDrops,
    boss: { trace: P.bossTrace, slow: P.bossSlow, stepMs: P.bossStepMs, renderMs: P.bossRenderMs, minHpRatio: P.bossMinHpRatio, finalOrbit: orbitRow() } });
  return true;
}

// ---------- 공통 보조 ----------
const ms = value => Math.round(value * 1000) / 1000;
async function state() {
  const row = await page.evaluate(id => {
    const a = window.app, b = a.battle;
    return { mode: a.mode, active: b.active, paused: b.paused, energy: a.eco.s.energy, energyT: a.eco.s.energyT, energyMax: a.eco.energyMax, observedAt: Date.now(),
      seq: a.expedition.s.seq, pending: a.expedition.s.pending ? structuredClone(a.expedition.s.pending) : null, ticket: a.expeditionTicket ? structuredClone(a.expeditionTicket) : null,
      depthWins: a.expedition.s.depthWins?.[id] ?? 0, dungeonWins: a.expedition.s.stats?.[id] ?? 0, materials: structuredClone(a.expedition.s.materials), gold: a.eco.s.gold,
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
  const fixture = await page.evaluate(({ heroId, id, items, unlockCode, minLevel, depth, quality }) => {
    const a = window.app, e = a.eco;
    a.expeditionUI.result = null; a.toLobby(); a.testPause = true; a.ui.closeModal();
    e.grantHero(heroId); e.s.selected = heroId;
    const h = e.hero(heroId); h.level = 50; h.star = 3; h.skills = h.skills.map(() => 5); h.exp = 0; h.equip = {};
    for (const def of items) { const inst = e.addItem(def.rarity, def.slot); inst.id = def.id; inst.enh = 15; h.equip[def.slot] = inst.uid; }
    a.expedition.s.level = Math.max(a.expedition.s.level, minLevel, 10);
    if (depth === 'deep') {
      e.s.progress.stars[unlockCode] = Math.max(1, e.s.progress.stars[unlockCode] || 0);
      a.expedition.s.stats[id] = Math.max(1, a.expedition.s.stats[id] || 0);
      if (a.expedition.s.depthWins) a.expedition.s.depthWins[id] = 0;
    }
    e.s.energy = e.energyMax; e.s.energyT = Date.now(); a.journey.s.autoBattle = true;
    if (quality === 'low') { e.s.settings.quality = 'low'; a.applySettings(); }
    e.save(); a.meta.refreshHome?.();
    return { heroId, level: h.level, star: h.star, skills: [...h.skills], equip: Object.keys(h.equip), energy: e.s.energy, expeditionLevel: a.expedition.s.level,
      access: a.expedition.dungeonAccess(id, { depth }), quality: e.s.settings.quality || 'auto' };
  }, { heroId, id: DUNGEON_ID, items, unlockCode: dungeonDef.unlockCode ?? null, minLevel: dungeonDef.minLevel, depth, quality });
  qaAssert(fixture.access.ok, 'Fixture did not open ' + depth + ' access: ' + fixture.access.error);
  report.fixture = { ...fixture, items: items.map(item => item.id), kind: 'FIXTURE' };
  await qa.save(); return fixture;
}
async function launchFromLobby(row) {
  await page.locator('#btn-expedition').click();
  await page.locator('.adventure-nav [data-section="dungeons"]').click();
  await page.locator('.exp-route-tabs').getByRole('button', { name: deep ? /^심층 원정/ : /^기본 원정/ }).click();
  const card = page.locator('[data-dungeon="' + DUNGEON_ID + '"][data-depth="' + depth + '"]');
  if (!deep) {
    // 기본 원정 목록은 접혀 있다(<details open={deep||fields}>). 닫혀 있으면 요약을 눌러 연다.
    const details = page.locator('details.exp-dungeon-details').first();
    if (!await details.evaluate(el => el.open)) await details.locator('> summary').click();
  }
  await card.waitFor({ state: 'visible' });
  row.cardText = await card.innerText();
  const energyOnCard = Number(/에너지 (\d+)/.exec(row.cardText)?.[1]);
  check('card energy matches catalog', energyOnCard === dungeonDef.energy, { card: energyOnCard, catalog: dungeonDef.energy });
  const button = card.locator('.exp-primary');
  qaAssert(await button.isEnabled(), depth + ' card departure button disabled');
  await button.click();
}
async function beginRun(tag) {
  const before = await state();
  const row = { tag, status: 'running', before, choices: [] };
  await launchFromLobby(row);
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  row.started = await state();
  row.energy = energyChange(before, row.started, dungeonDef.energy, tag + ' admission');
  const info = await page.evaluate(() => { const a = window.app, b = a.battle; return { route: structuredClone(b.stage.expedition), heroId: b.heroId, auto: b.player.auto,
    routeKind: b.routeObjectives?.def?.kind ?? null, rooms: b.world.rooms.length, controller: b.routeObjectives ? b.routeObjectives.constructor.name : null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && (info.route.depth ?? 'standard') === depth && row.started.pending?.energy === dungeonDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === depth && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  if (routeDef) check(tag + ': 컨트롤러 종류 = ' + routeDef.kind, info.routeKind === routeDef.kind, { routeKind: info.routeKind, controller: info.controller });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { targets: SAFE_TARGET });
  row.begin = await page.evaluate(() => window.__cometBossQa.begin());
  row.orbit = !!row.begin.orbit;
  report.orbitDetected = row.orbit;
  // 정의가 있는 후보 빌드인데 컨트롤러에 bossOrbit 이 없거나, 정의가 없는데 있으면 기준선으로 오인하지 않도록 실패로 남긴다.
  if (orbitDef && !row.orbit) check(tag + ': 보스 궤도선 정의가 있는데 routeObjectives.bossOrbit 이 없음', false, { kind: row.begin.kind, controller: row.begin.controller });
  if (!orbitDef && row.orbit) check(tag + ': 보스 궤도선 정의가 없는데 routeObjectives.bossOrbit 이 있음', false, { kind: row.begin.kind, controller: row.begin.controller });
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
    last = await page.evaluate(opts => window.__cometBossQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = () => page.evaluate(() => window.__cometBossQa.freeze());
const runSteps = n => page.evaluate(count => window.__cometBossQa.run({ n: count }), n);
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
async function pauseBattle() {
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => window.app.battle.paused && document.getElementById('pause-overlay').classList.contains('show'));
}
async function resumeBattle() {
  await page.locator('#btn-resume').click();
  await page.waitForFunction(() => !window.app.battle.paused);
}

// ---------- 키보드 이동(orbit) ----------
const held = new Set();
async function setKeys(next) {
  for (const key of [...held]) if (!next.has(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
/** 화면 방향(영웅 → 안전 지점 투영 차)을 8방향 키 조합으로 바꾼다. 입력 키는 화면 기준이다(카메라 요를 입력층이 처리). */
function keysToward(aim) {
  const len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len, keys = new Set();
  if (ux > .38) keys.add('KeyD'); if (ux < -.38) keys.add('KeyA'); if (uy > .38) keys.add('KeyS'); if (uy < -.38) keys.add('KeyW');
  return keys;
}
/**
 * AUTO 를 끈 영웅을 키보드(W/A/S/D)만으로 움직여 예고마다 안전 지점으로 보낸다. 공격·회피 키는 누르지 않는다.
 * armed 와 바깥 예고에서는 푸른 선 안쪽(반지름 4.0), 중심 예고에서는 푸른 선 밖(반지름 6.6)이다. 낙하가 minStrikes 이상이고 outer·center 가 하나씩 있으면 끝낸다.
 * 좌표 이동·무적 없이 실제 입력만 쓴다. 영웅이 쓰러지면 전투가 끝나 예외가 난다.
 */
async function dodgeByKeyboard(row, { minStrikes = 3, maxSteps = 60 * 60 * 3 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard dodging');
  let total = 0; const trail = [];
  try {
    while (total < maxSteps) {
      const aim = await page.evaluate(() => window.__cometBossQa.aimOrbit());
      qaAssert(aim, 'No bossOrbit while dodging');
      await setKeys(aim.inside ? new Set() : keysToward(aim));
      const r = await page.evaluate(opts => window.__cometBossQa.run(opts), { n: 4, stop: { type: 'orbitDone', min: minStrikes } });
      total += r.ran;
      if (trail.length < 400 && (total / 4) % 15 === 0) trail.push({ steps: total, t: ms(r.elapsed), state: aim.state, kind: aim.kind, r: +aim.r.toFixed(2), inside: aim.inside, strikes: aim.strikes, hits: aim.hits });
      if (r.reason === 'stop') return { steps: total, trail };
      if (r.reason === 'inactive') throw Error('Battle ended while dodging by keyboard (hero down?): ' + JSON.stringify(trail.slice(-6)));
      if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row); await nativeGameplayFocus(page); }
    }
    throw Error('Keyboard dodging did not reach ' + minStrikes + ' strikes within ' + maxSteps + ' steps: ' + JSON.stringify(trail.slice(-6)));
  } finally { await setKeys(new Set()); }
}

// ---------- 보스 구간 정리 ----------
/**
 * 보스 구간 관측을 report 에 정리한다. 큰 스텝별 trace 는 파일로 빼고, 후보 빌드(bossOrbit 정의 있음)는 궤도선을 판정한다.
 * 기준선(정의 없음)은 보스 등장·처치 시각, 보스방 첫 진입·bossReady draw call, 보스 구간 스텝 ms 만 남긴다.
 */
function recordBoss(row, { minStrikes = 1 } = {}) {
  const s = row.summary, raw = s.boss;
  delete s.boss;
  const summary = summarizeBoss(raw.trace), over50 = [...raw.stepMs, ...raw.renderMs].filter(v => v > 50).length;
  const file = row.tag + '-boss-trace.json';
  fs.writeFileSync(path.join(qa.out, file), JSON.stringify(raw.trace), { flag: 'wx' });
  const sample = label => s.samples.find(x => x.label === label) ?? null;
  row.boss = { traceFile: file, traceRows: raw.trace.length, ...summary, hero: { minHpRatio: raw.minHpRatio }, simulation: stepStats(raw.stepMs), render: stepStats(raw.renderMs), over50, slow: raw.slow,
    drawCalls: { enter: sample('bossEnter'), ready: sample('bossReady') } };
  (report.reportItems.absolute50ms ??= []).push({ tag: row.tag, runOver50: row.metrics.over50ms, bossOver50: over50, note: '보고 항목(판정 아님). 기준선 대비 증가는 comet-boss-compare 가 판정한다.' });
  check(row.tag + ': 보스 등장·처치 관측(app.step 마다)', summary.observed && summary.defeated === true, { rows: summary.rows, appearT: summary.appearT, defeatT: summary.defeatT });
  check(row.tag + ': 보스방 첫 진입 프레임 draw call 표본(bossEnter)', !!sample('bossEnter'), row.boss.drawCalls.enter);
  check(row.tag + ': 보스 등장 연출 다음 스텝 draw call 표본(bossReady)', !!sample('bossReady'), row.boss.drawCalls.ready);
  if (!orbitDef) { row.boss.skipped = 'bossOrbit 정의 없음(기준선 빌드): 궤도선 판정 생략, 공통 측정만 기록'; return; }
  if (!row.orbit) { row.boss.skipped = 'routeObjectives.bossOrbit 없음: beginRun 검사가 실패로 남긴다'; return; }
  const ready = sample('bossReady');
  check(row.tag + ': bossReady 표본 스텝에 궤도선 armed', ready?.orbit === 'armed', ready ? { orbit: ready.orbit, view: ready.view } : null);
  const analysis = analyzeBossOrbit({ trace: raw.trace, result: row.result?.routeObjective, resultText: row.resultText, win: row.result?.win === true, finalOrbit: raw.finalOrbit }, orbitDef, { minStrikes });
  row.orbitAnalysis = { ...analysis, warns: analysis.warns, strikes: analysis.strikes };
  const LABELS = { bossObserved: '보스 등장·처치 관측', strikeCount: '낙하 ' + minStrikes + '회 이상', stateMachine: 'state 전이·getter 규약', warnDuration: '예고 길이 = warning ± 1/60',
    kindOrder: 'kind 순서(예고 순서 % centerEvery)', hitMatchesZone: '피격 여부 = 낙하 스텝 영웅 반지름의 구역 판정(경계 ±0.05 는 모호)', noAttackDuringWarn: '예고 동안 보스 새 공격 없음(attackSequence·attackStartsDuringWarn 0)',
    centerStats: 'centerStrikes·hits 증가가 낙하와 일치', noStrikeAfterDefeat: '처치 뒤 낙하 없음', endedAfterDefeat: '보스 처치 뒤 ended', objectiveText: '목표창 warn 표본이 kind 에 맞는 문구',
    resultFields: '결과 bossMeteors/bossCenterMeteors/bossMeteorHits = 관측 수·complete·progress = target', resultLine: "결과 줄 '푸른 궤도선 유성 n회 · 피격 m회'" };
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': 궤도선 ' + (LABELS[name] ?? name), ok, ok ? undefined : { name, warns: analysis.warns.filter(w => !w.kindOk || w.durationOk === false || !w.startWarnLeftOk || !w.seqSteady || w.startedDuringAttack || w.aswDuring > 0),
    strikes: analysis.strikes.filter(x => x.verdict === 'fail'), violations: analysis.violations, machine: analysis.machine.violations.slice(0, 8), objective: analysis.objective.bad.slice(0, 6), objectiveMissing: analysis.objective.missing,
    result: analysis.result, line: analysis.resultLine, observed: analysis.observed, post: analysis.post });
  // 모호·면제·취소는 실패로 세지 않지만 숨기지 않는다.
  row.boss.orbitReport = { observed: analysis.observed, kinds: analysis.kinds, ambiguous: analysis.ambiguous, excused: analysis.excused, cancelled: analysis.cancelled };
  if (row.manualSegment) {
    const seg = checkManualSegment(raw.trace, row.manualSegment.from, row.manualSegment.to, { minStrikes: 3 });
    row.manualAnalysis = seg;
    check(row.tag + ': 키보드 구간 낙하 3회 이상(outer ≥ 1 · center ≥ 1)', seg.checks.strikes && seg.checks.outer && seg.checks.center, { strikes: seg.strikes, outer: seg.outer, center: seg.center });
    check(row.tag + ': 키보드 구간 궤도선 피격 0', seg.checks.noHits, { hits: seg.hits });
    check(row.tag + ': 키보드 구간 영웅 생존', seg.checks.heroAlive, { minHpRatio: seg.minHpRatio });
    check(row.tag + ': 키보드 구간 AUTO 꺼짐·공격 입력/동작 없음', seg.checks.keyboardOnly, { autoSteps: seg.autoSteps, attackHeld: seg.attackHeld, attackState: seg.attackState });
  }
}

/** 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·보스 판정을 기록한다. */
async function playToEnd(row, { moments = [], minStrikes = 1, expectFirstClear = true } = {}) {
  row.shots ??= [];
  for (const moment of moments) {
    const r = await advance(row, moment.stop, { renderEvery: 0 });
    if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); break; }
    if (moment.settle) await runSteps(moment.settle);
    row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed), orbit: (await freeze()).orbit });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await waitResult();
  row.summary = await page.evaluate(() => window.__cometBossQa.summary());
  row.result = await resultSnapshot();
  row.resultText = await page.locator('.exp-result-shell').innerText();
  row.after = await state();
  row.settlement = await page.evaluate(() => { const b = window.app.battle; return { paid: !!b.result?.expeditionReceipt?.ok, receipt: b.result?.expeditionReceipt ? structuredClone({ ok: b.result.expeditionReceipt.ok, rewards: b.result.expeditionReceipt.rewards }) : null, dirty: !!b.rpgDirty }; });
  const win = row.result?.win === true;
  check(row.tag + ': 완주 승리', win && !row.result.saveError && row.settlement.paid, { win, saveError: row.result?.saveError });
  if (win) {
    check(row.tag + ': pending 비움', row.after.pending === null && row.after.seq === row.before.seq + 1);
    check(row.tag + ': 저장 바이트 변경', row.after.saveSha256 !== row.before.saveSha256 && row.after.saveSha256 !== row.started.saveSha256);
    const gotMaterials = Object.fromEntries(Object.keys(dungeonDef.rewards.materials || {}).map(m => [m, (row.after.materials[m] || 0) - (row.before.materials[m] || 0)]));
    if (deep) {
      check(row.tag + ': depthWins +1', row.after.depthWins === row.before.depthWins + 1, { before: row.before.depthWins, after: row.after.depthWins });
      const wantMaterials = {};
      for (const [m, n] of Object.entries(dungeonDef.rewards.materials || {})) wantMaterials[m] = n + (expectFirstClear ? dungeonDef.firstRewards?.materials?.[m] || 0 : 0);
      check(row.tag + ': 재료 보상 ' + (expectFirstClear ? '첫 보상 포함 1회' : '첫 보상 미지급'), JSON.stringify(wantMaterials) === JSON.stringify(gotMaterials), { want: wantMaterials, got: gotMaterials });
      check(row.tag + ': firstClear 표시', row.result.rewards.firstClear === expectFirstClear);
    } else {
      // 기본 원정의 승리 수는 stats[id] 다. 주간 원정 효과가 보상을 더할 수 있어 재료는 정의 이상인지만 본다.
      check(row.tag + ': 기본 원정 승리 수 +1', row.after.dungeonWins === row.before.dungeonWins + 1, { before: row.before.dungeonWins, after: row.after.dungeonWins });
      const short = Object.entries(dungeonDef.rewards.materials || {}).filter(([m, n]) => gotMaterials[m] < n);
      check(row.tag + ': 재료 보상이 정의 이상', short.length === 0, { want: dungeonDef.rewards.materials, got: gotMaterials });
      check(row.tag + ': 첫 정복 표시 없음(기본 원정)', row.result.rewards.firstClear === false);
    }
  }
  const s = row.summary;
  row.metrics = { elapsed: row.result?.time ?? null, kills: row.result?.kills ?? null, hpDrops: s.hpDrops.length, hpDropTotal: ms(s.hpDrops.reduce((sum, d) => sum + d.drop, 0)),
    minHpRatio: s.minHpRatio, maxAlive: s.maxAlive, simulation: stepStats(s.stepMs), render: stepStats(s.renderMs), over50ms: [...s.stepMs, ...s.renderMs].filter(v => v > 50).length, slow: s.slow,
    drawCalls: s.samples.map(x => ({ label: x.label, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms, orbit: x.orbit, view: x.view })) };
  // 스텝별 ms 배열은 통계만 남기고 버린다(보스 구간 trace 는 파일로 뺀다).
  delete s.stepMs; delete s.renderMs;
  recordBoss(row, { minStrikes });
  if (!orbitDef) {
    row.baseline = { skipped: 'bossOrbit 정의 없음(기준선 빌드): 궤도선 검사 생략, 공통 측정만 기록', elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops,
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
  check(row.tag + ': 새로고침 후 보상·승리수·pending 보존', after.depthWins === before.depthWins && after.dungeonWins === before.dungeonWins && after.pending === null
    && JSON.stringify(after.materials) === JSON.stringify(before.materials) && after.gold === before.gold, { beforeWins: before.depthWins, afterWins: after.depthWins, beforeDungeonWins: before.dungeonWins, afterDungeonWins: after.dungeonWins });
  row.reload = { beforeSha: before.saveSha256, afterSha: after.saveSha256, energy: energyChange(before, after, 0, row.tag + ' reload') };
}

// ---------- 프로필 ----------
const profiles = {
  async auto() {
    await applyFixture();
    const row = await beginRun('auto');
    await playToEnd(row);
    await closeResultToLobby();
    await reloadCheck(row);
    return { runs: [row] };
  },
  async orbit() {
    await applyFixture();
    const row = await beginRun('orbit');
    if (!orbitDef || !row.orbit) return { skipped: '기준선 빌드에는 보스 궤도선(bossOrbit)이 없다' };
    // AUTO 로 보스방까지 가서 궤도선이 붙는(armed) 첫 스텝에서 멈춘다. 첫 예고는 그 뒤 first 초 지나서 온다.
    const attached = await advance(row, { type: 'orbit', state: 'armed' }, { max: 60 * 60 * 12 });
    check('orbit: AUTO 로 보스방까지 와서 궤도선이 붙음(armed)', attached.reason === 'stop', { reason: attached.reason, elapsed: attached.elapsed });
    qaAssert(attached.reason === 'stop', 'bossOrbit never attached: ' + attached.reason);
    row.attachedAt = await freeze();
    await setAuto(false);
    row.focusKeyboard = await nativeGameplayFocus(page);
    const from = await page.evaluate(() => window.__cometBossQa.traceLength());
    row.dodge = await dodgeByKeyboard(row, { minStrikes: 3 });
    const to = await page.evaluate(() => window.__cometBossQa.traceLength());
    row.manualSegment = { from, to };
    row.afterDodge = await freeze();
    check('orbit: 키보드 구간 끝에서 영웅 생존·궤도선 피격 0', row.afterDodge.hp > 0 && row.afterDodge.orbit.hits === 0, { hp: row.afterDodge.hp, orbit: row.afterDodge.orbit });
    row.dodgeShot = await shot('orbit-after-dodge');
    await setAuto(true);
    await playToEnd(row, { minStrikes: 3 });
    await closeResultToLobby();
    return { runs: [row] };
  },
  async pause() {
    await applyFixture();
    const row = await beginRun('pause');
    if (!orbitDef || !row.orbit) return { skipped: '기준선 빌드에는 보스 궤도선(bossOrbit)이 없다' };
    // 예고가 한 번 시작된 뒤 남은 시간이 1.0초 이하가 된 첫 스텝(낙하까지 30스텝 + 여유가 있다)에서 멈춘다.
    const reached = await advance(row, { type: 'orbit', state: 'warn', leftMax: 1.0 }, { max: 60 * 60 * 12 });
    check('pause: AUTO 로 예고(warn) 중반까지 진행', reached.reason === 'stop', { reason: reached.reason });
    qaAssert(reached.reason === 'stop', 'No warn reached: ' + reached.reason);
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(() => window.__cometBossQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await freeze();
    row.pauseShot = await shot('paused-warn');
    await resumeBattle();
    const resumedRun = await runSteps(30);
    const resumed = await freeze();
    const verdict = checkPause({ before, paused, still, resumed, steps: 30 });
    row.pauseCheck = { before: before.orbit, paused: paused.orbit, still: still.orbit, resumed: resumed.orbit, resumeReason: resumedRun.reason, verdict };
    check('pause: 예고 중 120스텝+1초 동안 게임 시간·warnLeft·strikes·hits·attackSequence 불변', verdict.frozen, row.pauseCheck);
    check('pause: 재개 뒤 warnLeft 가 게임 시간(30스텝)만큼만 줄고 같은 예고가 이어짐', verdict.resumedOk && resumedRun.reason === 'n', row.pauseCheck);
    // 이어진 예고가 정상적으로 낙하한다(같은 kind, strikes +1 한 번).
    const strike = await advance(row, { type: 'strikes', n: before.orbit.strikes + 1 }, { max: 60 * 60 });
    const afterStrike = await freeze();
    check('pause: 재개한 예고가 낙하해 strikes +1', strike.reason === 'stop' && afterStrike.orbit.strikes === before.orbit.strikes + 1 && afterStrike.orbit.state === 'armed', { before: before.orbit, after: afterStrike.orbit });
    await playToEnd(row);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async screens() {
    await applyFixture();
    const row = await beginRun('screens');
    if (!orbitDef || !row.orbit) {
      await playToEnd(row, { moments: [{ label: 'boss', stop: { type: 'boss' } }] });
    } else {
      const moments = [{ label: 'orbit-armed', stop: { type: 'orbit', state: 'armed' }, settle: 30 },
        { label: 'orbit-outer-warn', stop: { type: 'orbit', state: 'warn', kind: 'outer', minAge: .6 } },
        { label: 'orbit-center-warn', stop: { type: 'orbit', state: 'warn', kind: 'center', minAge: .6 } }];
      await playToEnd(row, { moments });
      const verdict = checkScreens(row.shots, moments.map(m => m.label), SCREEN_VIEWPORTS.length);
      check('screens: 궤도선 armed·바깥 예고·중심 예고 순간에 도달해 3개 화면 크기 PNG 를 남김', verdict.ok, verdict.rows);
      row.screensCheck = verdict;
      // 순간마다 궤도선 상태가 기대와 같았는지(예고 순간의 kind).
      const want = { 'orbit-armed': ['armed', null], 'orbit-outer-warn': ['warn', 'outer'], 'orbit-center-warn': ['warn', 'center'] };
      for (const shotRow of row.shots) {
        const [state, kind] = want[shotRow.label] ?? [];
        if (shotRow.reached) check('screens: ' + shotRow.label + ' 순간의 궤도선 상태', shotRow.orbit?.state === state && (kind === null || shotRow.orbit?.kind === kind), shotRow.orbit);
      }
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
      // 실패 표본의 원인을 남긴다: 보스·궤도선 상태, 최근 보스 trace, 목표창, 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__cometBossQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.() ?? null, recentTrace: q?.bossTrace?.slice(-30) ?? null, hpDrops: q?.hpDrops?.slice(-20) ?? null,
          objective: document.getElementById('objective')?.textContent ?? null, curRoom: b.curRoom?.id ?? null, sealed: !!b.world.sealed, alive,
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
console.log(JSON.stringify({ status: report.status, out: qa.out, depth, orbitDetected: report.orbitDetected, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
