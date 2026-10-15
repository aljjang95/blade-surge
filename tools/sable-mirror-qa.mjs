#!/usr/bin/env node
// 흑사막 분지(sable_mirage_basin 일반·심층) 가짜 왕좌 + 거울 미궁 탈출 실제 UI QA 도구 (BUNDLE-09 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 왕좌 파괴와 거울 미궁 전 과정을 app.step 한 번마다 관측한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 읽기 경로: app.battle.routeObjectives (progress/complete/def.escape/gates[i].{room,ready,broken,phase,age,hits}/maze.{room,phase,real,illusion,limit,left,elapsed,collapses,illusions,cooldown,trail,trailN}/
// mazeView.{group,states,footprints,count,drawCalls}/view.{group,drawCalls}), gates[i].room.{id,x,z,type,cleared,discovered,forgeWave}, app.battle.world.{sealed,rooms,roomAt,linkPending,buildFlow,minX,minZ,cols},
// app.battle.{enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, paused}, 목표창 #objective textContent(같은 상태가 0.6초 이어진 뒤 표본),
// 결과 화면 .exp-result-shell innerText 와 app.expeditionUI.result.routeObjective, app.renderer.r.info.render.calls(방 첫 진입 draw call 표본, renderer.render() 단독 호출).
// 거울 뷰 states 는 같은 스텝의 maze.phase 로 다시 계산해(mirrorState 계약) 비교한다. 제한 시간은 미궁 시작·붕괴 스텝에서 world.buildFlow(real.x, real.z) 로 영웅 칸 거리를 다시 읽어 검산한다.
// 뷰 같은 프레임 A/B: 거울 뷰 상태가 바뀐 스텝 끝과 running 중 일정 간격에서 같은 프레임을 mazeView.group 표시/숨김(그리고 route.view.group 까지 숨김)으로 renderer.render() 해 calls 차이를 잰다(시뮬레이션 스텝 없음, 끝나면 visible 복원).
// 거울 미궁 정의(ROUTE_OBJECTIVES.sable_deep.escape)나 mazeView 가 없는 기준선 빌드(--project)에서는 왕좌·미궁 판정을 건너뛰고 공통 측정만 남긴다. 일반(sable_standard)은 기준선에도 있어 왕좌 3곳을 판정한다.
// 판정 함수는 tools/sable-mirror-checks.mjs 에 있고 test/sable-mirror-checks.test.ts 가 합격·불합격 입력을 모두 검사한다. 기준선 비교는 tools/sable-mirror-compare.mjs 다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { GATE_PHASE_CODE, MAZE_PHASE_CODE, MIRROR_STATE_CODE, analyzeOrder, analyzePauseResume, analyzeThrones, checkPause, checkScreenMoment, checkScreens, stepStats } from './sable-mirror-checks.mjs';

const HELP = [
  '사용법: node tools/sable-mirror-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '                           심층 정의(ROUTE_OBJECTIVES.sable_deep.escape)나 mazeView 가 없는 기준선 빌드(예: 03d89ac)도 받는다. 그때는 왕좌·미궁 판정을 건너뛰고 공통 측정만 남긴다.',
  '  --depth=<standard|deep>  개인 기본 원정 sable_mirage_basin 의 일반 카드 또는 심층 카드(기본 deep). 접근·에너지·증원 횟수는 대상 프로젝트 데이터에서 읽는다.',
  '  --profile=<목록>          auto|order|pause|screens|all (쉼표로 여러 개, 기본 auto). order·pause·screens 는 심층 전용(거울 미궁 정의가 있는 빌드)',
  '  --seed=<uint32>           Math.random 시드(기본 20261015)',
  '  --no-reseed               전투 시작 직후 재시드(window.__qaReseed)를 끈다. 기본은 켬: 전투가 활성이고 route.prepareView 가 끝난 뒤 첫 app.step 전에 한 번 같은 시드로 되돌린다',
  '  --hero=<id>               fixture 영웅 knight|mage 등(기본 knight)',
  '  --viewport=WxH            기본 844x390',
  '  --motion=reduce|no-preference   브라우저 prefers-reduced-motion(기본 reduce). 값 없는 --motion 은 reduce',
  '  --quality=low|default     low 면 설정 핸들러와 같은 경로(settings.quality=low + applySettings)로 낮은 화질. 값 없는 --quality 는 low',
  '  --origin=<url>            공유 런타임 옵션(로컬 preview 또는 고정 라이브 주소만 허용)',
  '  --help                    이 도움말',
  '',
  '프로필(F = fixture, R = 실제 UI·입력, C = 제어 실행)',
  '  auto     F 저장 주입(해금·영웅·장비·에너지) → R 출격 카드 버튼 → R #btn-auto → C 고정 1/60 스텝 완주 → R 결과 화면 → R 새로고침 보존',
  '           + 왕좌 판정: 파괴 방 집합 · 균열이 는 스텝의 왕좌 phase still · ready 시점 적/대기열 0·정예방 forgeWave · 봉인 해제 시점 · 결과/결과 줄 · 목표창 문구',
  '           + 미궁 판정(심층): 시작 스텝 조건(진행 n·모든 구역 정화·시작 전 idle) · limit = ceil(거리/pace + grace)(buildFlow 로 다시 잰 영웅 칸 거리) · 시계 · done 은 진짜 거울 반경 안에서만 ·',
  '             봉인은 done 전 유지 · AUTO 환영 접촉 0·붕괴 0 · 발자국 방향 · 결과 escape · 결과 줄 · 목표창 미궁 문구',
  '           + 거울 뷰(심층): states = 같은 스텝 maze.phase 의 mirrorState · footprints ≥ 1 · drawCalls ≤ 4 · 부서진 뒤 0.5초 안에 숨김',
  '           + 뷰 같은 프레임 A/B(C): 상태가 바뀐 스텝 끝과 running 간격에서 mazeView.group 표시/숨김으로 calls 차이 ≤ 4 이고 mazeView.drawCalls 와 같은지(표본 ≥ 3, hidden·running·shattered 포함)',
  '             왕좌 뷰까지 포함한 경로 목표 전체 A/B 와 왕좌 방 첫 진입 draw call 은 보고 항목',
  '  order    AUTO 로 미궁 running 까지 → R #btn-auto 끔 → R 키보드(KeyW/A/S/D)로 환영 거울 반경 안 → illusions 증가·피해 → 방 중심(두 거울에서 3 밖)에서 시간 초과(collapses 증가)까지 대기 →',
  '           진짜 거울 → done → R AUTO 켬 → 완주. 공격 키 없음',
  '  pause    미궁 running 중 left ≤ limit − 1 에서 R #btn-pause → 120스텝+1초 게임 시간·left·elapsed·trail·거울 뷰 불변 → R #btn-resume → left 감소 재개 → 완주',
  '  screens  왕좌 멈춤(throne-still)·미궁 시작(maze-start)·발자국(footprints, ≥ 3)·탈출 뒤(escaped, 0.3초) 순간마다 640x360, 844x390, 390x844 PNG + 결과 PNG, PNG 마다 그 순간 states 기록',
  '',
  '주의: 좌표 이동·무적·HP 주입·적 hp 조작으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.',
  'SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다. order 의 키보드 입력은 Playwright 가 보낸 에뮬레이터 키 이벤트다.',
].join('\n');
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
// 값 없는 플래그(--quality, --motion)도 받는다.
const flag = (name, bare, fallback) => qaArgument(name) ?? (process.argv.includes('--' + name) ? bare : fallback);
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'order', 'pause', 'screens'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
const depth = arg('depth', 'deep');
qaAssert(['standard', 'deep'].includes(depth), '--depth must be standard|deep');
const deep = depth === 'deep';
const seed = Number(arg('seed', '20261015'));
qaAssert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, '--seed must be uint32');
const reseedOn = !process.argv.includes('--no-reseed');
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
const DUNGEON_ID = 'sable_mirage_basin';
/** order 프로필(PLAN 6절 6): 방 중심에서 두 거울과 떨어져야 하는 거리 3, 방 중심에 닿았다고 보는 반경 1.2. */
const ORDER = Object.freeze({ away: 3, centerNear: 1.2 });

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다). 접근·에너지·증원 횟수를 이 파일에 박지 않는다.
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { DUNGEONS } = await load('src/data/expansion.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const dungeonDef = deep ? EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID) : DUNGEONS.find(d => d.id === DUNGEON_ID);
qaAssert(dungeonDef, 'Target project has no ' + DUNGEON_ID + ' ' + depth + ' definition');
// 왕좌 정의. 심층 기준선(03d89ac)에는 sable_deep 이 없어 null 이고 왕좌·미궁 판정을 건너뛴다. 일반은 두 빌드 모두 sable_standard 가 있다.
const routeData = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES ?? {};
const routeDef = (deep ? routeData.sable_deep : routeData.sable_standard) ?? null;
const escapeDef = routeDef?.escape ?? null;
const throneRooms = routeDef ? routeDef.gates.map(g => g.roomId) : null;
const judgedProfiles = !!escapeDef && deep;
const needsKeyboard = selected.includes('order');

const STEP_CLASS = {
  auto: [['F', '저장 주입(해금·영웅 Lv.50 별3 스킬5·장비·에너지·AUTO)'], ['R', '출격 카드 버튼 · #btn-auto'], ['C', 'app.testPause + 고정 1/60 app.step 으로 완주'],
    ['C', 'app.step 한 번마다 page.evaluate 한 번에 관측(읽기 전용, 상태 변화·미궁 running 매 스텝·1초 간격 행)'], ['C', 'renderer.render() 단독 호출로 방 첫 진입 draw call 표본'], ['R', '결과 화면 DOM · 로비 버튼 · 새로고침']],
  order: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 미궁 running 까지 고정 스텝'],
    ['R', '키보드 KeyW/A/S/D 로 환영 거울 접촉·방 중심 대기·진짜 거울 이동(공격 키 없음)'], ['C', '키 입력 사이 4스텝씩 고정 진행(키보드 구간은 매 스텝 관측)'], ['C', 'AUTO 완주 · 결과 판정']],
  pause: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 미궁 left ≤ limit − 1 까지 고정 스텝'], ['C', '정지 중 app.step 120회(stepRaw)로 게임 시간·미궁 시계·거울 뷰 불변 확인'], ['C', 'AUTO 완주']],
  screens: [['F', '저장 주입'], ['R', '출격 카드 버튼'], ['C', 'AUTO 로 왕좌 멈춤·미궁 시작·발자국·탈출 뒤 순간까지 고정 스텝'], ['C', 'renderer.render() 단독 호출 + viewport 3종 스크린샷(시뮬레이션 tick 없음)']],
};
/** 뷰가 있는 빌드에서 모든 프로필의 프로브가 하는 제어 렌더. */
const VIEW_AB_STEP = ['C', '뷰 같은 프레임 A/B: 상태가 바뀐 스텝 끝과 running 간격에서 mazeView.group · route.view.group visible 을 바꿔 renderer.render() 여러 번(시뮬레이션 스텝 없음, 끝나면 visible 복원)'];
for (const list of Object.values(STEP_CLASS)) list.push(VIEW_AB_STEP);
const report = { kind: 'sable-mirror-qa', releaseApproved: false, seed, heroId, depth, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'sable-mirror-checks.mjs'))), profiles: {}, checks: [], reportItems: {},
  reseed: { on: reseedOn, elapsed: null }, routeDefinition: routeDef ? JSON.parse(JSON.stringify(routeDef)) : null, escapeExpected: !!escapeDef, throneRooms,
  catalog: { id: dungeonDef.id, depth, energy: dungeonDef.energy, minLevel: dungeonDef.minLevel, unlockCode: dungeonDef.unlockCode ?? null, rewards: dungeonDef.rewards,
    firstRewards: dungeonDef.firstRewards ?? null, objective: dungeonDef.objective ?? null, mechanics: dungeonDef.mechanics ?? null, routeId: routeDef?.id ?? null },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^' + (deep ? '심층' : '기본') + ' 원정/',
      ...(deep ? [] : ['details.exp-dungeon-details > summary (닫혀 있으면)']), '[data-dungeon="' + DUNGEON_ID + '"][data-depth="' + depth + '"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창 textContent, 같은 상태 0.6초 뒤 표본)'],
    result: ['.exp-result-shell (결과 줄 innerText, aria-label "가짜 왕좌 파괴 결과" · "거울 미궁 탈출 결과")', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives (progress/complete/gates[i].room/ready/broken/phase/age/hits/maze.*/mazeView.group/states/footprints/count/drawCalls/view.group/drawCalls)',
      'window.app.battle.world (sealed/rooms/roomAt/linkPending/buildFlow/minX/minZ/cols)', 'window.app.battle (enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, player.pos/hp/auto/state)',
      'window.app.input.attackHeld', 'window.app.renderer.r.info.render.calls', 'window.app.expeditionUI.result.routeObjective', 'window.__qaReseed (init script)', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨' + (deep ? '·기본 원정 승리' : '') + ')·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)와 window.__qaReseed(seed) 재시드(전투 활성·prepareView 뒤 첫 스텝 전 1회)',
      quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → ' + (deep ? '심층' : '기본') + ' 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      needsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): 걷는 방향은 도구가 목표 위치의 화면 투영으로 정함. 텔레포트·무적·HP 주입·공격 키 없음' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)',
      '뷰 같은 프레임 A/B: mazeView.group · route.view.group 의 visible 을 바꿔 같은 프레임을 renderer.render() 로 각각 그려 calls 차이 측정(끝나면 visible 복원)',
      'world.buildFlow(real.x, real.z) 읽기: 미궁 시작·붕괴 스텝의 영웅 칸 거리 검산(캐시 키가 규칙과 같아 거리장을 바꾸지 않는다)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각', '거울·발자국·모래시계의 실제 모습(PNG 는 사람이 본다)'],
    steps: Object.fromEntries(selected.map(name => [name, STEP_CLASS[name].map(([kind, detail]) => ({ kind, detail }))])) },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/false-thrones.js', 'src/game/false-throne-view.js', 'src/game/mirror-maze-view.js', 'src/data/route-objectives.js', 'src/data/expedition-depths.js', 'src/data/expansion.js',
  'src/data/stages.js', 'src/ui/battle-objective-view.js', 'src/ui/battle-readability.js', 'src/expansion/hub.jsx', 'src/game/battle-base.js', 'src/game/world.js',
  'src/game/expedition-combat.js', 'src/game/enemies.js', 'src/game/player.js', 'src/game/expedition-economy.js', 'src/main.js'].filter(file => fs.existsSync(path.join(projectRoot, file)));
const qa = await createExpeditionQa({ root: projectRoot, driver: import.meta.filename, report, sourceFiles });
let page;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };
/** 실행 태그별 관측 행(report 에는 파일로만 남긴다). */
const traces = new Map();

// ---------- 페이지 안 측정 프로브(게임 판정에는 쓰지 않는다) ----------
function installProbe(cfg) {
  const app = window.app;
  const P = window.__mirrorQa = { dt: 1 / 60, steps: 0, cfg, dense: false };
  const routeOf = () => app.battle.routeObjectives;
  const EMPTY = [];
  const MAZE = cfg.mazeCode, MIRROR = cfg.mirrorCode, GATE = cfg.gateCode;
  const H = 16, K = 9;   // sig 앞 칸 수, 왕좌마다 칸 수
  const flowAlt = [[.2, 0], [-.2, 0], [0, .2], [0, -.2]];
  // ---- 영웅 칸 거리: 규칙의 dist 와 같은 식(buildFlow(real) 의 영웅 칸 값, 음수면 직선 거리 × 1.5). 시작·붕괴 스텝에서만 부른다(캐시 키가 규칙과 같다). ----
  const flowAt = (px, pz) => {
    const w = app.battle.world, m = routeOf().maze, f = w.buildFlow(m.real.x, m.real.z);
    const v = f ? f[Math.floor(pz - w.minZ) * w.cols + Math.floor(px - w.minX)] : -1;
    return v >= 0 ? v : Math.hypot(px - m.real.x, pz - m.real.z) * 1.5;
  };
  const trailSum = m => { let acc = 0; for (let i = 0; i < m.trailN; i++) acc += m.trail[2 * i] * (i + 1) + m.trail[2 * i + 1] * 3.7; return acc; };
  // ---- 뷰 같은 프레임 A/B: 같은 프레임을 뷰 그룹 켠 채·끈 채 그린다(P.sample 과 같은 info.reset + renderer.render 경로, app.step 없음). visible 과 autoReset 은 반드시 복원한다. ----
  P.measureView = label => {
    const b = app.battle, r = routeOf(), m = r.maze, mv = r.mazeView, view = r.view, mg = mv?.group, vg = view?.group;
    const rec = { label, n: P.steps, t: b.elapsed, ph: m ? (MAZE[m.phase] ?? 9) : -1, mzCalls: mv ? mv.drawCalls : null, rtCalls: view ? view.drawCalls : null, on: null, offMaze: null, offAll: null };
    if (!mg && !vg) return rec;
    const info = app.renderer.r.info, autoReset = info.autoReset, mgv = mg ? mg.visible : null, vgv = vg ? vg.visible : null;
    info.autoReset = false;
    try {
      if (mg) mg.visible = true;
      if (vg) vg.visible = true;
      info.reset(); app.renderer.render(); rec.on = info.render.calls;
      if (mg) { mg.visible = false; info.reset(); app.renderer.render(); rec.offMaze = info.render.calls; }
      if (vg) vg.visible = false;
      info.reset(); app.renderer.render(); rec.offAll = info.render.calls;
    } finally { if (mg) mg.visible = mgv; if (vg) vg.visible = vgv; info.autoReset = autoReset; }
    return rec;
  };
  // ---- 행 만들기: 관측값만 읽는다. sig 는 상태 변화 감지용 숫자 배열이다. ----
  const fill = () => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r ? r.gates : EMPTY, s = P.sig, m = r ? r.maze : null, mv = r ? r.mazeView : null;
    let rem = 0, broken = 0;
    for (const room of b.world.rooms) if (room.type !== 'start' && room.type !== 'boss' && !room.cleared) rem++;
    for (const g of gs) if (g.broken) broken++;
    s[0] = b.curRoom ? b.curRoom.id : -1; s[1] = r ? r.progress : 0; s[2] = b.world.sealed ? 1 : 0; s[3] = rem; s[4] = p.auto ? 1 : 0;
    s[5] = gs.length > 0 && broken === gs.length && rem === 0 ? 1 : 0;
    s[6] = m ? (MAZE[m.phase] ?? 9) : -1; s[7] = m ? m.collapses : -1; s[8] = m ? m.illusions : -1; s[9] = m ? m.trailN : -1;
    const st = mv ? mv.states : null;
    s[10] = st ? (MIRROR[st[0]] ?? 9) : -1; s[11] = st ? (MIRROR[st[1]] ?? 9) : -1;
    s[12] = mv ? mv.footprints : -1; s[13] = mv ? mv.drawCalls : -1; s[14] = mv ? mv.count : -1;
    s[15] = m ? trailSum(m) : 0;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i], room = g.room, o = H + i * K;
      let al = 0, pd = 0;
      for (const e of b.enemies) if (e.alive && e.homeRoom === room) al++;
      for (const q of b.pending) if (q.room === room) pd++;
      P.curPh[i] = GATE[g.phase] ?? 2; P.curAg[i] = g.age; P.curHi[i] = g.hits;
      s[o] = g.ready ? 1 : 0; s[o + 1] = g.broken ? 1 : 0; s[o + 2] = P.curPh[i]; s[o + 3] = g.hits; s[o + 4] = room.cleared ? 1 : 0; s[o + 5] = room.forgeWave || 0; s[o + 6] = room.discovered ? 1 : 0;
      s[o + 7] = al; s[o + 8] = pd;
    }
  };
  const build = (mk, full) => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r ? r.gates : EMPTY, s = P.sig, m = r ? r.maze : null, mv = r ? r.mazeView : null;
    const row = { n: P.steps, t: b.elapsed, x: p.pos.x, z: p.pos.z, hp: p.hp, mhp: p.maxHp, al: p.alive ? 1 : 0, rm: s[0], pr: s[1], sl: s[2], rem: s[3], cond: s[5], au: s[4],
      ah: app.input.attackHeld ? 1 : 0, ps: p.state,
      g: gs.map((g, i) => {
        const o = H + i * K;
        return { id: g.room.id, rd: s[o], bk: s[o + 1], ph: s[o + 2], pph: P.prevPh[i], ag: g.age, pag: P.prevAg[i], hi: s[o + 3], dh: P.curHi[i] - P.prevHi[i], cl: s[o + 4], fw: s[o + 5], dc: s[o + 6], al: s[o + 7], pd: s[o + 8] };
      }),
      mz: null, mv: null };
    if (m) {
      row.mz = { ph: s[6], lim: m.limit, lf: m.left, el: m.elapsed, col: m.collapses, ill: m.illusions, cd: m.cooldown, tn: m.trailN,
        dm: Math.hypot(p.pos.x - m.real.x, p.pos.z - m.real.z), di: Math.hypot(p.pos.x - m.illusion.x, p.pos.z - m.illusion.z) };
      if (P.flowStep === P.steps) { row.mz.fd = P.fd; row.mz.fa = P.fa; }
      if (m.trailN > 0 && (full || P.trSum !== s[15])) { row.tr = Array.from(m.trail.subarray(0, m.trailN * 2)); P.trSum = s[15]; }
    }
    if (mv) row.mv = { s: [s[10], s[11]], f: s[12], c: s[14], d: s[13] };
    if (mk) row.mk = mk;
    return row;
  };
  const push = row => { P.rows.push(row); P.prevSig.set(P.sig); };
  P.begin = () => {
    const b = app.battle, r = routeOf(), gn = r ? r.gates.length : 0, size = H + gn * K, m = r ? r.maze : null;
    Object.assign(P, { hpDrops: [], samples: [], viewAB: [], stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0, startElapsed: b.elapsed, rows: [],
      sig: new Float64Array(size), prevSig: new Float64Array(size).fill(-1e9), entered: new Set(), wp: [], padGate: null,
      curPh: new Int8Array(gn), prevPh: new Int8Array(gn), curAg: new Float64Array(gn), prevAg: new Float64Array(gn), curHi: new Int32Array(gn), prevHi: new Int32Array(gn),
      okey: -1, ostable: 0, mzStable: 0, trSum: -1, flowStep: -1, fd: null, fa: null, doneT: -1, abLast: 0, spM: -1, spS0: -1, spS1: -1 });
    P.prevRoom = b.curRoom?.id ?? null;
    P.prevHp = b.player.hp;
    fill(); P.prevPh.set(P.curPh); P.prevAg.set(P.curAg); P.prevHi.set(P.curHi);
    push(build('start'));
    if (r && (r.mazeView || r.view)) P.viewAB.push(P.measureView('start'));
    const gates = r ? r.gates.map(g => ({ id: g.room.id, x: g.room.x, z: g.room.z, type: g.room.type })) : [];
    const v3 = v => ({ x: v.x, z: v.z });
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, routeId: r?.def?.id ?? null, gates: gn, rooms: gates, hasView: !!r?.view, hasMaze: !!m, hasMazeView: !!r?.mazeView,
      hasAutoGoal: typeof r?.autoGoal === 'function', hasSyncView: typeof r?.syncView === 'function',
      maze: m ? { roomId: m.room?.id ?? null, roomX: m.room?.x ?? null, roomZ: m.room?.z ?? null, real: v3(m.real), illusion: v3(m.illusion), phase: m.phase, trailCapacity: m.trail?.length ?? null } : null,
      mazeView: r?.mazeView ? { count: r.mazeView.count, drawCalls: r.mazeView.drawCalls, states: [...r.mazeView.states] } : null,
      allRooms: b.world.rooms.map(x => ({ id: x.id, type: x.type, x: x.x, z: x.z })), reinforcements: b.stage?.expedition?.mechanics?.reinforcements ?? 0,
      def: r ? { id: r.def.id, radius: r.def.radius, hits: r.def.hits, escape: r.def.escape ? JSON.parse(JSON.stringify(r.def.escape)) : null } : null };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const r = routeOf();
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2),
      view: r?.mazeView ? { c: r.mazeView.count, d: r.mazeView.drawCalls } : null };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, p = b.player, r = routeOf(), m = r ? r.maze : null, gs = r ? r.gates : EMPTY;
    P.prevPh.set(P.curPh); P.prevAg.set(P.curAg); P.prevHi.set(P.curHi);
    fill();
    const s = P.sig, q = P.prevSig;
    P.spM = q[6]; P.spS0 = q[10]; P.spS1 = q[11];
    const running = s[6] === MAZE.running;
    // 미궁 시작·붕괴 스텝: 영웅 칸 거리를 규칙과 같은 식으로 다시 읽는다.
    if (running && (q[6] !== MAZE.running || s[7] > q[7])) {
      P.flowStep = P.steps; P.fd = flowAt(p.pos.x, p.pos.z);
      P.fa = flowAlt.map(d => flowAt(p.pos.x + d[0], p.pos.z + d[1]));
    }
    if (s[6] === MAZE.done && P.doneT < 0) P.doneT = b.elapsed;
    let changed = false;
    for (let i = 0; i < s.length; i++) if (s[i] !== q[i]) { changed = true; break; }
    // 뷰 같은 프레임 A/B 를 잴 이유는 행을 남기기(push: prevSig 갱신) 전의 직전 스텝 sig 와 비교해 정한다.
    let abWhy = null;
    if (r && (r.mazeView || r.view) && P.viewAB.length < 150) {
      if (s[10] !== q[10] || s[11] !== q[11]) abWhy = 'state';
      else if (running && P.steps - P.abLast >= 90) abWhy = 'interval';
      else if (s[6] === MAZE.done && s[13] !== q[13] && s[13] === 0) abWhy = 'hidden-after';
      else for (let i = 0; i < gs.length; i++) { const o = H + i * K; if (s[o] !== q[o] || s[o + 1] !== q[o + 1]) { abWhy = 'gate'; break; } }
    }
    // 목표창 표본. 왕좌 단계: 현재 왕좌의 상태 키가 36스텝(0.6초) 변하지 않았을 때 한 번(10Hz 갱신 뒤). 미궁 running: 횟수가 바뀌지 않은 채 36스텝마다.
    let wantDom = false;
    if (running) {
      if (s[7] !== q[7] || s[8] !== q[8]) P.mzStable = 0; else P.mzStable++;
      wantDom = P.mzStable > 0 && P.mzStable % 36 === 0;
    } else {
      P.mzStable = 0;
      let cur = -1;
      if (s[6] <= MAZE.idle) for (let i = 0; i < gs.length; i++) if (!gs[i].broken) { cur = i; break; }
      if (cur >= 0) {
        const o = H + cur * K, okey = (cur + 1) * 100 + s[o + 6] * 30 + s[o] * 10 + s[o + 2];
        if (okey !== P.okey) { P.okey = okey; P.ostable = 0; } else P.ostable++;
        wantDom = P.ostable === 36;
      } else { P.okey = -1; P.ostable = 0; }
    }
    if (changed || running || wantDom || P.dense || P.steps % 60 === 0) {
      const row = build(null);
      if (wantDom) row.dom = document.getElementById('objective')?.textContent ?? null;
      push(row);
    }
    // 뷰 같은 프레임 A/B(최대 150회): 거울 뷰 상태 변화, running 중 90스텝 간격, 부서진 뒤 숨김, 왕좌 준비·파괴(왕좌 뷰 보고용).
    if (abWhy) { P.viewAB.push(P.measureView(abWhy)); P.abLast = P.steps; }
    if (p.hp < P.prevHp - 1e-6) P.hpDrops.push({ t: b.elapsed, drop: P.prevHp - p.hp, hp: p.hp, maxHp: p.maxHp, room: b.curRoom?.id ?? null });
    P.prevHp = p.hp;
    if (p.maxHp > 0) P.minHpRatio = Math.min(P.minHpRatio, p.hp / p.maxHp);
    let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    P.maxAlive = Math.max(P.maxAlive, alive);
    // 방 첫 진입 프레임의 draw call(기준선 비교 대상): 시작·보스방을 뺀 모든 방의 첫 진입마다 한 번.
    if (s[0] !== P.prevRoom) {
      P.prevRoom = s[0];
      const room = b.curRoom;
      if (room && room.type !== 'start' && room.type !== 'boss' && !P.entered.has(room.id)) { P.entered.add(room.id); P.sample('roomEnter', { roomId: room.id, roomType: room.type }); }
    }
  };
  P.hit = stop => {
    const b = app.battle, r = routeOf(), m = r ? r.maze : null, mv = r ? r.mazeView : null, p = b.player.pos;
    switch (stop.type) {
      case 'time': return b.elapsed >= stop.t;
      case 'result': return !!app.expeditionUI.result;
      case 'mazeRunning': return !!m && m.phase !== 'idle';
      case 'mazeDone': return !!m && m.phase === 'done';
      case 'mazeLeft': return !!m && m.phase === 'running' && m.left <= m.limit - stop.sub + 1e-9;
      case 'footprints': return !!m && !!mv && m.phase === 'running' && mv.footprints >= stop.min;
      // 준비된 왕좌의 모래시계가 멈춘 순간, 영웅이 그 왕좌의 방 안.
      case 'throneStill': return !!r && r.gates.some(g => g.ready && !g.broken && g.phase === 'still' && b.curRoom === g.room);
      case 'illusions': return !!m && m.illusions >= stop.min;
      case 'collapses': return !!m && m.collapses >= stop.min;
      case 'doneFor': return P.doneT >= 0 && b.elapsed - P.doneT >= stop.min - 1e-9;
      case 'near': return Math.hypot(p.x - stop.x, p.z - stop.z) <= stop.r;
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
      if (ms > 50) P.slow.push({ n: P.steps, t: b.elapsed, ms: +ms.toFixed(1), render, room: b.curRoom?.id ?? null });
      observe();
      if (stop && P.hit(stop)) { reason = 'stop'; ran++; break; }
    }
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons] };
  };
  P.stepRaw = n => { for (let i = 0; i < n; i++) app.step(P.dt, false); return app.battle.elapsed; };
  P.setDense = on => { P.dense = !!on; return P.dense; };
  // 구간 표식: 현재 상태의 행을 mk 와 함께 하나 더 넣는다. 같은 스텝의 행과 n 이 겹칠 수 있어 판정은 행 순서(인덱스)로 구간을 자른다.
  P.mark = label => {
    const b = app.battle; if (!b?.world || !b.player) return null;
    fill();
    const row = build(label);
    push(row); return row.n;
  };
  P.freeze = () => {
    const b = app.battle; fill();
    const row = build(null, true);
    Object.assign(row, { elapsed: b.elapsed, paused: b.paused, active: b.active, kills: b.kills, doneT: P.doneT, prev: { mzph: P.spM, s: [P.spS0, P.spS1] } });
    return row;
  };
  // 키보드 이동용: 영웅 → 다음 경유점의 화면 투영 차. 경로는 방 연결(links)과 L자 복도(linkPending)의 모서리를 방 중심 경유로 따르고, then 이 있으면 마지막에 그 점으로 간다.
  P.setTarget = t => {
    const b = app.battle, w = b.world, p = b.player.pos;
    if (t.room === undefined) { P.wp = [{ x: t.x, z: t.z }]; return P.wp.length; }
    const rooms = w.rooms, byId = id => rooms.find(r => r.id === id), dest = byId(t.room);
    let start = w.roomAt(p.x, p.z);
    if (!start) { let best = Infinity; for (const r of rooms) { const d = Math.hypot(r.x - p.x, r.z - p.z); if (d < best) { best = d; start = r; } } }
    const prev = new Map([[start.id, null]]), queue = [start];
    while (queue.length) { const cur = queue.shift(); for (const id of (cur.links || [])) if (!prev.has(id)) { prev.set(id, cur.id); queue.push(byId(id)); } }
    const ids = [];
    for (let id = dest.id; id !== null && id !== undefined; id = prev.get(id)) ids.unshift(id);
    const cell = new Map(rooms.map(r => [r.gx + ',' + r.gy, r]));
    const stored = (u, v) => (w.linkPending || []).some(([a, c]) => cell.get(a.join(',')) === u && cell.get(c.join(',')) === v);
    const wp = [];
    ids.forEach((id, k) => {
      const A = byId(id);
      if (k > 0) { const U = byId(ids[k - 1]); wp.push(stored(U, A) ? { x: A.x, z: U.z } : { x: U.x, z: A.z }); }
      wp.push({ x: A.x, z: A.z });
    });
    if (t.then) wp.push({ x: t.then.x, z: t.then.z });
    P.wp = wp; return wp.length;
  };
  P.aim = () => {
    const b = app.battle, p = b.player.pos, cam = app.renderer.camera;
    while (P.wp.length > 1 && Math.hypot(P.wp[0].x - p.x, P.wp[0].z - p.z) < 1.5) P.wp.shift();
    const wp = P.wp[0], fin = P.wp.at(-1);
    cam.updateMatrixWorld();
    const a = p.clone().project(cam), z = p.clone().set(wp.x, p.y, wp.z).project(cam);
    return { dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2, left: P.wp.length, final: fin, dist: Math.hypot(fin.x - p.x, fin.z - p.z) };
  };
  // 느린 스텝 목록은 자르지 않는다(기준선 비교가 개수를 정확히 세야 한다).
  P.summary = () => ({ steps: P.steps, stepMs: P.stepMs, renderMs: P.renderMs, slow: P.slow, maxAlive: P.maxAlive, minHpRatio: P.minHpRatio, samples: P.samples, viewAB: P.viewAB,
    hpDrops: P.hpDrops, rows: P.rows });
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
/** 출격 → AUTO 확인 → 프로브 설치 → 재시드 → 시작 관측. 재시드는 battle.active 이고 prepareView 가 끝났으며 아직 step 하지 않은 시점이다(Battle.start: prepareView await 는 active = true 보다 앞). */
async function beginRun(tag) {
  const before = await state();
  const row = { tag, status: 'running', before, choices: [] };
  await launchFromLobby(row);
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  row.started = await state();
  row.energy = energyChange(before, row.started, dungeonDef.energy, tag + ' admission');
  const info = await page.evaluate(() => { const a = window.app, b = a.battle, r = b.routeObjectives; return { route: structuredClone(b.stage.expedition), heroId: b.heroId, auto: b.player.auto,
    routeKind: r?.def?.kind ?? null, routeId: r?.def?.id ?? null, rooms: b.world.rooms.length, gates: r ? r.gates.length : 0, controller: r ? r.constructor.name : null,
    hasView: !!r?.view, hasMaze: !!r?.maze, hasMazeView: !!r?.mazeView, hasAutoGoal: typeof r?.autoGoal === 'function', mechanics: b.stage.expedition?.mechanics ?? null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && (info.route.depth ?? 'standard') === depth && row.started.pending?.energy === dungeonDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === depth && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  // 정의가 있는 후보 빌드인데 컨트롤러가 없거나, 정의가 없는 기준선인데 컨트롤러가 있으면 기준선으로 오인하지 않도록 실패로 남긴다.
  if (routeDef) check(tag + ': 왕좌 컨트롤러 id = ' + routeDef.id, info.routeId === routeDef.id && info.gates === routeDef.gates.length, { routeId: info.routeId, gates: info.gates, controller: info.controller });
  else check(tag + ': 왕좌 정의가 없는 기준선인데 routeObjectives 가 있음', !info.routeId, { routeId: info.routeId, controller: info.controller });
  if (routeDef) check(tag + ': 출격 직후(prepareView 뒤) route.view 존재', info.hasView, { hasView: info.hasView });
  if (escapeDef) check(tag + ': 거울 미궁(route.maze)과 거울 뷰(route.mazeView) 존재(정의에 escape)', info.hasMaze && info.hasMazeView, { hasMaze: info.hasMaze, hasMazeView: info.hasMazeView });
  if (escapeDef) check(tag + ': autoGoal() 존재(AUTO 가 미궁 목표를 받는 읽기 계약)', info.hasAutoGoal, { hasAutoGoal: info.hasAutoGoal });
  else if (routeDef) check(tag + ': 거울 미궁·거울 뷰 없음(정의에 escape 없음)', !info.hasMaze && !info.hasMazeView, { hasMaze: info.hasMaze, hasMazeView: info.hasMazeView });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { mazeCode: MAZE_PHASE_CODE, mirrorCode: MIRROR_STATE_CODE, gateCode: GATE_PHASE_CODE });
  row.begin = await page.evaluate(() => window.__mirrorQa.begin());
  row.reinforcements = row.begin.reinforcements;
  // 거울 위치 = 방 중심 + 오프셋(PLAN 3.1), 거울 방 id = escape.roomId.
  row.mazeSetup = null;
  if (escapeDef && row.begin.maze) {
    const mz = row.begin.maze, near = (a, b) => Math.abs(a - b) <= 1e-6;
    row.mazeSetup = { roomOk: mz.roomId === escapeDef.roomId, real: mz.real, illusion: mz.illusion,
      realOk: near(mz.real.x - mz.roomX, escapeDef.real[0]) && near(mz.real.z - mz.roomZ, escapeDef.real[1]),
      illusionOk: near(mz.illusion.x - mz.roomX, escapeDef.illusion[0]) && near(mz.illusion.z - mz.roomZ, escapeDef.illusion[1]) };
    check(tag + ': 거울 방·진짜/환영 거울 위치 = 방 중심 + 정의 오프셋', row.mazeSetup.roomOk && row.mazeSetup.realOk && row.mazeSetup.illusionOk, { maze: mz, escape: escapeDef });
  }
  // 재시드: 첫 app.step 전 한 번. --no-reseed 면 호출하지 않는다.
  row.reseed = reseedOn ? await page.evaluate(s => { const q = window.__mirrorQa, b = window.app.battle; const r = { on: true, elapsed: b.elapsed, active: b.active, steps: q.steps, hasRoute: !!b.routeObjectives, hasView: !!b.routeObjectives?.view, hasMazeView: !!b.routeObjectives?.mazeView };
    window.__qaReseed(s); return r; }, seed) : { on: false, elapsed: null };
  report.reseed = { on: row.reseed.on, elapsed: row.reseed.elapsed };
  if (reseedOn) check(tag + ': 재시드는 전투 활성·첫 스텝 전(elapsed 0)', row.reseed.active === true && row.reseed.steps === 0 && row.reseed.elapsed === 0, row.reseed);
  if (routeDef) check(tag + ': 정예방 증원 횟수 = 대상 프로젝트 mechanics.reinforcements', row.reinforcements === (dungeonDef.mechanics?.reinforcements ?? 0), { page: row.reinforcements, project: dungeonDef.mechanics?.reinforcements ?? null });
  await qa.save(); return row;
}
async function takeChoice(row, last = null) {
  const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
  const snap = () => page.evaluate(() => ({ reasons: [...window.app.battle.pauseReasons], paused: window.app.battle.paused, active: window.app.battle.active,
    elapsed: window.app.battle.elapsed, open: [...document.querySelectorAll('dialog[open]')].map(d => d.id),
    count: document.querySelectorAll('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').length }));
  const before = await snap(); const waitStart = Date.now();
  try { await buttons.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch {
    // 진단: 정지가 걸린 스텝의 정지 사유와 지금 열린 dialog 를 함께 남긴다(smoke-std-auto-1: 확인 시점엔 사유가 비어 있었다).
    const now = await page.evaluate(() => ({ reasons: [...window.app.battle.pauseReasons], paused: window.app.battle.paused,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ id: d.id || d.className, offer: d.dataset.offer ?? null, view: d.dataset.view ?? null, text: (d.innerText || '').slice(0, 400), buttons: [...d.querySelectorAll('button')].slice(0, 12).map(b => ({ cls: b.className, dis: b.disabled, vis: !!(b.offsetWidth || b.offsetHeight), text: (b.innerText || '').slice(0, 30) })) })) }));
    throw Error('Battle paused without a visible native choice: ' + JSON.stringify({ atPause: last?.pauseReasons ?? null, elapsed: last?.elapsed ?? null, before, waitedMs: Date.now() - waitStart, now }));
  }
  row.choices.push({ text: await buttons.first().innerText(), elapsed: await page.evaluate(() => window.app.battle.elapsed) });
  await buttons.first().click();
}
let keyboardMode = false;
/** stop 조건 또는 전투 종료까지 고정 스텝으로 진행한다. 선택지 모달이 열리면 실제 첫 번째 버튼을 누른다(키보드 구간이면 캔버스 포커스를 되찾는다). */
async function advance(row, stop, { max = 60 * 60 * 12, chunk = 600, renderEvery = 0 } = {}) {
  let total = 0, last;
  while (total < max) {
    last = await page.evaluate(opts => window.__mirrorQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row, last); if (keyboardMode) await nativeGameplayFocus(page); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = withView => page.evaluate(v => window.__mirrorQa.freeze(v), !!withView);
const mark = label => page.evaluate(l => window.__mirrorQa.mark(l), label);
const setDense = on => page.evaluate(v => window.__mirrorQa.setDense(v), on);
/** n 스텝 진행(게임 시간 기준). 선택지 모달이 열리면 처리한다. */
async function advanceSteps(row, n) {
  const t = (await freeze()).elapsed + n / 60 - 1e-9;
  return advance(row, { type: 'time', t }, { max: n * 4 + 600 });
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

// ---------- 키보드 이동(order) ----------
const held = new Set();
async function setKeys(next) {
  for (const key of [...held]) if (!next.has(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
/** 화면 방향(영웅 → 경유점 투영 차)을 8방향 키 조합으로 바꾼다. 입력 키는 화면 기준이다(카메라 요를 입력층이 처리). */
function keysToward(aim) {
  const len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len, keys = new Set();
  if (ux > .38) keys.add('KeyD'); if (ux < -.38) keys.add('KeyA'); if (uy > .38) keys.add('KeyS'); if (uy < -.38) keys.add('KeyW');
  return keys;
}
/**
 * AUTO 를 끈 영웅을 키보드(W/A/S/D)만으로 목표(방 중심, 한 점, 또는 옮겨 가는 gate.pad)까지 걷게 한다. 경유점은 방 연결의 L자 복도 모서리와 방 중심이다.
 * stop 이 참이 되면 끝낸다. 공격·회피 키는 누르지 않는다. 좌표 이동·무적 없이 실제 입력만 쓴다. 영웅이 쓰러지면 전투가 끝나 예외가 난다.
 */
async function walkTo(row, target, stop, { maxSteps = 60 * 40 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard walking');
  await page.evaluate(t => window.__mirrorQa.setTarget(t), target);
  let total = 0; const trail = [];
  try {
    while (total < maxSteps) {
      if (await page.evaluate(s => window.__mirrorQa.hit(s), stop)) return { steps: total, trail };
      const aim = await page.evaluate(() => window.__mirrorQa.aim());
      await setKeys(keysToward(aim));
      const r = await page.evaluate(opts => window.__mirrorQa.run(opts), { n: 4, stop });
      total += r.ran;
      if (trail.length < 300 && (total / 4) % 15 === 0) trail.push({ steps: total, t: ms(r.elapsed), dist: +aim.dist.toFixed(2), left: aim.left });
      if (r.reason === 'stop') return { steps: total, trail };
      if (r.reason === 'inactive') throw Error('Battle ended while walking by keyboard (hero down?): ' + JSON.stringify(trail.slice(-6)));
      if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row, r); await nativeGameplayFocus(page); }
    }
    throw Error('Keyboard walking did not reach its stop within ' + maxSteps + ' steps: ' + JSON.stringify(trail.slice(-6)));
  } finally { await setKeys(new Set()); }
}

// ---------- 완주·정리 ----------
const LABELS = { throneSet: '파괴한 왕좌 방 집합 = 정의의 왕좌 방(순서 자유)', throneCracks: '균열이 는 스텝은 그 왕좌 phase still(같은 스텝 관측, 회전→멈춤 전이 스텝만 예외) · 준비 상태 · 왕좌마다 균열 hits 회',
  throneReady: 'ready 시점 그 방의 적·대기열 0, 정예방은 forgeWave = 증원 횟수', sealed: '보스 봉인: 시작은 sealed, 해제는 모든 왕좌 파괴·모든 구역 정화 뒤' + (escapeDef ? '(done 전 유지, done 스텝 또는 그 뒤 해제)' : ''),
  resultFields: '결과 routeObjective { id, label, complete, progress, target, rooms' + (escapeDef ? ', escape.escaped' : '') + ' }', resultLine: '결과 줄(실제 UI) ' + (routeDef ? "'가짜 왕좌 파괴 " + routeDef.gates.length + "/" + routeDef.gates.length + " · 완료'" : '') + (escapeDef ? " + '거울 미궁 탈출 완료 · 거울 붕괴 n회 · 환영 거울 n회'" : ''),
  objectiveText: '목표창 제목과 상태별 action 문구(왕좌 단계' + (escapeDef ? ' · 미궁 단계 필수' : '') + ')', noMaze: '거울 미궁·거울 뷰 없음(일반)',
  mazeExists: 'route.maze · route.mazeView 존재, 거울 방/위치 = 정의', mazeStart: '미궁 시작 스텝: 시작 전 표본 idle · progress n · 모든 구역 정화 · 조건 성립 뒤 최대 한 스텝 · 횟수 0 · limit = left',
  mazeLimit: 'limit = ceil(거리/pace + grace)(시작·붕괴 스텝에 buildFlow 로 다시 잰 영웅 칸 거리)', mazeClock: 'running 연속 스텝에서 left 감소·elapsed 증가 = 게임 시간', mazeDone: 'done 은 영웅–진짜 거울 거리 ≤ radius + .01 인 스텝에서만(running 중 반경 안 깊숙이 없음)',
  mazeTrail: '발자국 trail: 점 수 = trailN ≤ trailCount, 마지막 점이 첫 점보다 진짜 거울에 가까움, 갱신 ≥ 3', autoCounts: 'AUTO 환영 접촉 0 · 붕괴 0',
  mazeViewStates: '거울 뷰 states = 같은 스텝 maze.phase 의 mirrorState(hidden · real/illusion · shattered)', mazeViewFootprints: 'running 중 footprints ≥ 1 · ≤ trailCount', mazeViewDraw: '거울 뷰 drawCalls ≤ 4(hidden 은 0)',
  mazeViewHide: '부서진 뒤 0.5초 안에 거울 뷰 숨김(drawCalls 0)', mazeViewGpu: '뷰 같은 프레임 A/B(C 제어 렌더): 표본 ≥ 3(hidden·running·shattered 포함)·calls 차이 ≤ 4·mazeView.drawCalls 와 같음' };
LABELS.resultLineElements = "결과 줄 요소 aria-label '가짜 왕좌 파괴 결과'" + (escapeDef ? " · '거울 미궁 탈출 결과'" : '') + ' 본문';
/** 관측 행을 파일로 빼고, 왕좌 정의가 있는 빌드는 왕좌·미궁 전 과정을 판정한다. 기준선(정의 없음)은 공통 측정만 남긴다. */
function recordThrones(row, raw, { clean = true } = {}) {
  const rows = raw.rows;
  delete raw.rows;
  traces.set(row.tag, rows);
  const file = row.tag + '-trace.json';
  fs.writeFileSync(path.join(qa.out, file), JSON.stringify(rows), { flag: 'wx' });
  row.traceFile = file; row.traceRows = rows.length;
  const roomSamples = raw.samples.filter(x => x.label === 'roomEnter');
  check(row.tag + ': 방 첫 진입 draw call 표본(roomEnter) 1개 이상', roomSamples.length > 0, { rooms: roomSamples.map(x => x.roomId) });
  if (!routeDef) { row.thrones = { skipped: '왕좌 정의(ROUTE_OBJECTIVES.sable_' + depth + ')가 없는 기준선 빌드: 왕좌·미궁 판정 생략, 공통 측정만 기록' }; return; }
  const missingRooms = throneRooms.filter(id => !roomSamples.some(x => x.roomId === id));
  check(row.tag + ': 왕좌 방마다 첫 진입 draw call 표본', missingRooms.length === 0, { throneRooms, missing: missingRooms });
  const analysis = analyzeThrones({ rows, result: row.result?.routeObjective, resultText: row.resultText, resultLines: row.resultLines, win: row.result?.win === true, rooms: row.begin.allRooms, viewAB: raw.viewAB,
    mazeSetup: row.mazeSetup, hasMaze: row.begin.hasMaze, hasMazeView: row.begin.hasMazeView }, routeDef, { reinforcements: row.reinforcements, clean });
  row.thrones = analysis;
  if (analysis.gpu) (report.reportItems.viewGpuCalls ??= []).push({ tag: row.tag, classification: 'C', max: analysis.gpu.max, samples: analysis.gpu.samples, limit: analysis.gpu.limit,
    note: '주 게이트: 거울 뷰 같은 프레임 A/B(mazeView.group 켠 채 − 끈 채). 판정은 acceptance.mazeViewGpu' });
  if (analysis.gpu) (report.reportItems.routeViewGpuCalls ??= []).push({ tag: row.tag, classification: 'C', ...analysis.gpu.route,
    note: '보고 항목(게이트 아님): 왕좌 뷰(route.view.group)까지 포함한 경로 목표 전체 A/B' });
  if (analysis.view) (report.reportItems.mirrorViewCount ??= []).push({ tag: row.tag, counts: analysis.view.counts, expected: analysis.view.expectedCount, footprintsMax: analysis.view.footprintsMax,
    note: '보고 항목: 거울 뷰 인스턴스 수(기대 = 거울 틀 2 + 거울면 2 + 모래시계 원뿔 4 + trailCount, 게이트 아님)' });
  (report.reportItems.objectiveSamples ??= []).push({ tag: row.tag, samples: analysis.objective.samples, throne: analysis.objective.throne, maze: analysis.objective.maze, note: '보고 항목: 목표창 왕좌 단계/미궁 단계 표본 수' });
  (report.reportItems.sandReflects ??= []).push({ tag: row.tag, sandReflects: row.result?.routeObjective?.sandReflects ?? null, transitions: analysis.cracks.transitions,
    note: '보고 항목(게이트 아님): 모래 반사 횟수와 회전→멈춤 전이 스텝에서 센 균열 수' });
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': 왕좌 ' + (LABELS[name] ?? name), ok, ok ? undefined : { name, set: analysis.set, cracks: { ...analysis.cracks, violations: analysis.cracks.violations.slice(0, 6) }, ready: analysis.ready,
    seal: analysis.seal, result: analysis.result, line: analysis.resultLine, objective: analysis.objective, maze: analysis.maze, view: analysis.view, gpu: analysis.gpu ? { ...analysis.gpu, rows: undefined } : null, noMaze: analysis.noMaze });
}
/** 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·왕좌 판정을 기록한다. moments 는 screens 프로필이 순간마다 멈춰 PNG 를 남기는 목록이다. */
async function playToEnd(row, { moments = [], expectFirstClear = true, clean = true } = {}) {
  row.shots ??= [];
  for (const moment of moments) {
    const r = await advance(row, moment.stop, { renderEvery: 0 });
    if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); break; }
    const stopRow = await freeze();
    const capture = await freeze();
    row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed), stop: stopRow, capture });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await mark('end');
  await waitResult();
  row.summary = await page.evaluate(() => window.__mirrorQa.summary());
  row.result = await resultSnapshot();
  row.resultText = await page.locator('.exp-result-shell').innerText();
  // 결과 줄 요소(aria-label "<제목> 결과")를 실제 DOM 에서 읽는다.
  row.resultLines = await page.evaluate(() => [...document.querySelectorAll('.exp-result-shell p[aria-label$=" 결과"]')].map(p => ({ label: p.getAttribute('aria-label'), text: p.textContent })));
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
    drawCalls: s.samples.map(x => ({ label: x.label, roomId: x.roomId ?? null, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms, view: x.view })) };
  // 스텝별 ms 배열은 통계만 남기고 버린다(관측 행은 파일로 뺀다).
  delete s.stepMs; delete s.renderMs;
  (report.reportItems.absolute50ms ??= []).push({ tag: row.tag, runOver50: row.metrics.over50ms, note: '보고 항목(판정 아님). 기준선 대비 증가는 sable-mirror-compare 가 판정한다.' });
  recordThrones(row, s, { clean });
  if (!routeDef) {
    row.baseline = { skipped: row.thrones.skipped, elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops, frames: { simulation: row.metrics.simulation, render: row.metrics.render }, drawCalls: row.metrics.drawCalls };
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

/** order·pause·screens 는 거울 미궁 정의가 있는 심층 빌드에서만 돈다. 정의가 없는 기준선이나 일반이면 출격하기 전에 건너뛴다. */
const skipUnlessMaze = () => (judgedProfiles ? null : { skipped: '거울 미궁 정의(ROUTE_OBJECTIVES.sable_deep.escape)가 있는 심층 빌드에서만 도는 프로필이다' });

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
  async order() {
    const why = skipUnlessMaze();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('order');
    const mz = row.begin.maze, center = row.begin.allRooms.find(r => r.id === escapeDef.roomId);
    qaAssert(mz && center, 'order profile needs the maze and its room');
    // 1) AUTO 로 미궁 running 까지. 거기서 AUTO 를 실제 버튼으로 끈다. 여기부터 real-reach 표식까지 매 스텝을 관측한다.
    const up = await advance(row, { type: 'mazeRunning' }, { max: 60 * 60 * 20 });
    check('order: AUTO 로 미궁 running 까지', up.reason === 'stop', { reason: up.reason, elapsed: up.elapsed });
    qaAssert(up.reason === 'stop', 'Maze never started: ' + up.reason);
    row.runningAt = await freeze();
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    await setDense(true);
    await mark('manual-start');
    // 2) 키보드로 환영 거울 반경 안(illusions 증가)까지. 경로는 방 연결을 따라 거울 방 중심을 지난 뒤 환영 거울로 간다.
    row.walk1 = await walkTo(row, { room: escapeDef.roomId, then: mz.illusion }, { type: 'illusions', min: row.runningAt.mz.ill + 1 });
    await mark('illusion-hit');
    // 3) 두 거울에서 떨어진 방 중심으로 가서 시간 초과(collapses 증가)까지 가만히 기다린다.
    row.walk2 = await walkTo(row, { x: center.x, z: center.z }, { type: 'near', x: center.x, z: center.z, r: ORDER.centerNear });
    await mark('center');
    const atCenter = await freeze();
    const waited = await advance(row, { type: 'collapses', min: atCenter.mz.col + 1 }, { max: 60 * 90 });
    check('order: 두 거울에서 3 밖에서 시간 초과(collapses 증가)까지 대기', waited.reason === 'stop', { reason: waited.reason, elapsed: waited.elapsed });
    qaAssert(waited.reason === 'stop', 'Collapse never happened: ' + waited.reason);
    await mark('collapse');
    row.collapseAt = await freeze();
    // 4) 키보드로 진짜 거울까지 → done.
    row.walk3 = await walkTo(row, { x: mz.real.x, z: mz.real.z }, { type: 'mazeDone' });
    await mark('real-reach');
    row.reachShot = await shot('order-real-reach');
    await setDense(false);
    // 5) AUTO 를 켜 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row, { clean: false });
    const analysis = analyzeOrder(traces.get(row.tag), routeDef, { result: row.result?.routeObjective, away: ORDER.away });
    row.order = analysis;
    check('order: 키보드 구간(AUTO 꺼짐·공격 입력/동작 없음·생존)', analysis.keyboard?.ok, analysis.keyboard);
    check('order: 환영 거울 접촉 → illusions 증가·피해·쿨다운·running/sealed 유지', analysis.illusion?.ok, analysis.illusion);
    check('order: 두 거울에서 3 밖 시간 초과 → collapses 증가·피해·limit 재계산(> 0)·running 유지', analysis.collapse?.ok, analysis.collapse);
    check('order: 진짜 거울 done(반경 안)·그 전 내내 running/sealed·영웅 생존', analysis.done?.ok, analysis.done);
    check('order: 결과 escape { escaped true, collapses ≥ 1, illusions ≥ 1 } = 마지막 관측 횟수', analysis.result?.ok, analysis.result);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async pause() {
    const why = skipUnlessMaze();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('pause');
    // 미궁 running 중 left ≤ limit − 1 인 첫 스텝에서 멈춘다.
    const reached = await advance(row, { type: 'mazeLeft', sub: 1 }, { max: 60 * 60 * 20 });
    check('pause: AUTO 로 미궁 left ≤ limit − 1 까지 진행', reached.reason === 'stop', { reason: reached.reason });
    qaAssert(reached.reason === 'stop', 'No running maze: ' + reached.reason);
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(() => window.__mirrorQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await freeze();
    row.pauseShot = await shot('paused-maze');
    await resumeBattle();
    await mark('resume');
    const resumedRun = await advanceSteps(row, 30);
    const resumed = await freeze();
    const verdict = checkPause({ before, paused, still, resumed, steps: 30 });
    row.pauseCheck = { before, paused, still, resumed, resumeReason: resumedRun.reason, verdict };
    check('pause: 미궁 running 중 120스텝+1초 동안 게임 시간·left·elapsed·쿨다운·횟수·trail·거울 뷰 불변', verdict.frozen, verdict);
    check('pause: 재개 뒤 left 가 30스텝만큼 줄고 elapsed 가 같은 만큼 늚', verdict.resumedOk, verdict);
    await playToEnd(row);
    row.pauseResume = analyzePauseResume(traces.get(row.tag));
    check('pause: 재개 뒤 미궁이 done 까지 가고 붕괴·환영 접촉 0', row.pauseResume.ok, row.pauseResume);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async screens() {
    const why = skipUnlessMaze();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('screens');
    const moments = [
      { label: 'throne-still', stop: { type: 'throneStill' }, want: { kind: 'throne-still' } },
      { label: 'maze-start', stop: { type: 'mazeRunning' }, want: { kind: 'maze-start' } },
      { label: 'footprints', stop: { type: 'footprints', min: 3 }, want: { kind: 'footprints', minFootprints: 3 } },
      { label: 'escaped', stop: { type: 'doneFor', min: .3 }, want: { kind: 'escaped', minAfter: .3 } },
    ];
    await playToEnd(row, { moments });
    const verdict = checkScreens(row.shots, moments.map(m => m.label), SCREEN_VIEWPORTS.length);
    check('screens: 모든 순간에 도달해 3개 화면 크기 PNG 를 남김', verdict.ok, verdict.rows);
    row.screensCheck = verdict;
    for (const m of moments) {
      const s = row.shots.find(x => x.label === m.label);
      if (!s?.reached) continue;
      s.look = checkScreenMoment(s, m.want);
      // PNG 마다 그 순간 states 를 남긴다(사람이 PNG 와 맞춰 본다).
      s.pngStates = s.files.map(file => ({ file, states: s.look.states, phase: s.look.phase, footprints: s.look.footprints, elapsed: s.capture.elapsed }));
      check('screens: ' + m.label + ' 순간의 화면 상태(' + m.want.kind + ')', s.look.ok, s.look);
    }
    row.resultShots = await captureScreens('result-' + row.tag);
    await closeResultToLobby();
    return { runs: [row] };
  },
};

try {
  page = await qa.start({ viewport, context: contextOptions });
  // 시드 난수와 재시드 함수: __qaReseed(s) 는 같은 LCG 상태를 s 로 되돌린다.
  await page.addInitScript(seedValue => { let n = seedValue; Math.random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; window.__qaReseed = s => { n = s >>> 0; return n; }; }, seed);
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
      // 실패 표본의 원인을 남긴다: 왕좌·미궁 상태, 최근 관측 행, 목표창, 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__mirrorQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.() ?? null, recentRows: q?.rows?.slice(-30) ?? null, hpDrops: q?.hpDrops?.slice(-20) ?? null,
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
console.log(JSON.stringify({ status: report.status, out: qa.out, depth, throneDefinition: !!routeDef, mazeExpected: !!escapeDef, reseed: report.reseed, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
