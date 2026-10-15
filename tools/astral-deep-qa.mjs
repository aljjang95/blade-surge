#!/usr/bin/env node
// 성운 첨탑 심층(astral_leviathan_spire deep) 성좌 4곳 복원·외곽 고리 정화 실제 UI QA 도구 (BUNDLE-12 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 성좌 복원과 외곽 고리 정화 전 과정을 app.step 한 번마다 관측한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 읽기 경로: app.battle.routeObjectives (progress/phase/read/hold/selected/mistakes/revealed/gates[i].{room,pos,ready,available,attuned,answer,pads[].{id,code,pos}}/
//   ring.{phase,room,center,minX,maxX,minZ,maxZ,clock,left,limit,elapsed,collapses,shardHits,purified,held,marks[].{pos,hold,done},shard.{state,age,cycle}}/def/view/ringView),
// gates[i].room.{id,x,z,type,cleared,discovered}, app.battle.world.{sealed,rooms,roomAt,linkPending,minX,minZ,cols},
// app.battle.{enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, stage.encounter.tactic, paused}, 목표창 #objective textContent(같은 상태가 0.6초 이어진 뒤 표본),
// 결과 화면 .exp-result-shell innerText·p[aria-label] 와 app.expeditionUI.result.routeObjective, app.ui.toast 호출(감싸개로 기록만), app.input.keys, app.renderer.r.info.render.calls(방 첫 진입 draw call 표본).
// 규칙·뷰 구현은 읽지 않는다(PLAN 3.1 읽기 계약만). 경로 정의(ROUTE_OBJECTIVES.astral_deep)가 없는 기준선 빌드(--project, 예: a737875)에서는 성좌·고리 판정을 건너뛰고 완주·시간·50ms 만 기록한다.
// 판정 함수는 tools/astral-deep-checks.mjs 에 있고 test/astral-deep-checks.test.ts 가 합격·불합격 입력을 모두 검사한다. 기준선 비교는 tools/astral-deep-compare.mjs 다(한 짝씩).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { DEEP, GATE_PHASE_CODE, MOMENTS, PHASE_CODE, SHARD_CODE, analyzeAuto, analyzeChoice, analyzeRingManual, checkScreenMoment, checkScreens, inRoom, stepStats } from './astral-deep-checks.mjs';

const HELP = [
  '사용법: node tools/astral-deep-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션 (성운 첨탑 심층 카드만: 일반 성운 첨탑에는 이 정의가 없다)',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '                           심층 정의(ROUTE_OBJECTIVES.astral_deep)가 없는 기준선 빌드(예: a737875)도 받는다. 그때는 성좌·고리 판정을 건너뛰고 완주·시간·50ms 만 기록·판정한다(choice·ring·screens 는 건너뜀).',
  '  --profile=<목록>          auto|choice|ring|screens|all (쉼표로 여러 개, 기본 auto). choice·ring·screens 는 경로 정의가 있는 빌드(후보)에서만 돈다.',
  '  --depth=deep              심층 고정(다른 값은 거부)',
  '  --seed=<uint32>           Math.random 시드(기본 20261015)',
  '  --no-reseed               전투 시작 직후 재시드(window.__qaReseed)를 끈다. 기본은 켬: 전투가 활성이고 route.prepareView 가 끝난 뒤 첫 app.step 전에 한 번 같은 시드로 되돌린다',
  '  --hero=<id>               fixture 영웅 knight|mage 등(기본 knight)',
  '  --viewport=WxH            기본 844x390',
  '  --motion=reduce|no-preference   브라우저 prefers-reduced-motion(기본 reduce). 값 없는 --motion 은 reduce',
  '  --quality=low|default     low 면 설정 핸들러와 같은 경로(settings.quality=low + applySettings)로 낮은 화질. 값 없는 --quality 는 low',
  '  --wait-load=<수>          시작 전 1분 load 가 이 값 이하가 될 때까지 최대 180초 기다린다(기다린 시간과 load 를 report.load 에 기록). 기본은 기다리지 않고 기록만',
  '  --origin=<url>            공유 런타임 옵션(로컬 preview 또는 고정 라이브 주소만 허용)',
  '  --help                    이 도움말',
  '',
  '프로필(F = fixture, R = 실제 UI·입력, C = 제어 실행)',
  '  auto     F 저장 주입(해금·영웅·장비·에너지) → R 출격 카드 버튼 → R #btn-auto → C 고정 1/60 스텝 완주 → R 결과 화면 → R 새로고침 보존',
  '           + 성좌·고리 판정: 완주 · 복원 순서 [3,2,5,6](보고 rooms · constellations) · 방 2 성좌가 1번 복원 전에 준비되고 그동안 미정화 · 차례 아닌 성좌 방은 복원 전 미정화(매 관측 행) ·',
  '             복원 직전 read ≥ 1초 · hold ≥ 1초 관측(0 에서 시작, 모래시계 8m 안, 정답 판 반경 안, 그 방 적 0) · 고리 열림(4/4 와 시작·보스 뺀 모든 방 정화 뒤, 열리는 스텝 clock 0) ·',
  '             정화 시작(방 사각형 안 첫 스텝, limit 20) · 고리 시계 · 집결 위상(첫 1초 · 주기 4.5 · 예고 1.5 · 터짐 .5) · 파편 피격(cycle 당 한 번, 기록) · 성표 4개(0 에서 시작한 1초 유지) · 붕괴 0 ·',
  '             고리 완료 · world.sealed 는 고리 완료 전까지 true → 완료 뒤 해제 · 결과 보고 { id, complete, progress, target, mistakes, rooms, constellations, ring{ purified, marks, collapses, shardHits, seconds } } ·',
  '             결과 두 줄(별자리 복원 4/4 · … / 외곽 고리 정화 완료 · 성표 4/4 · …) · 목표창 문구 · 토스트(전술 토스트는 정확 일치만 면제)',
  '           + 보고 항목: 성좌·고리 방 첫 진입 draw call, 50ms 초과 집계, 파편 피격 · 오답 수 · ring.seconds, 실행 전후 1분 load',
  '  choice   AUTO 로 1번 성좌(방 3)가 ready 가 될 때까지 → R #btn-auto 끔 → R 키보드(KeyW/A/S/D)로 모래시계 근처에서 단서 읽기(select) → 오답 판(가까운 것)에서 1초 + 다음 프레임 →',
  '           mistakes +1 · phase retry · 진행 불변 · hurt 호출 0 → 판 밖으로 나와 다시 읽기(select) → 정답 판 1초 → progress 1(방 3 정화) → R AUTO 켬 → 완주. 공격 키 없음',
  '  ring     AUTO 로 고리 open 까지 → R #btn-auto 끔 → 방 밖이면 3초 대기(running 아님; 열림 순간 이미 방 안이면 그 사실을 기록하고 열린 다음 스텝 running 으로 대신) → R 키보드로 진입(첫 스텝 running · limit 20) →',
  '           중심(core) 안에서 집결 터짐마다 피격 1회(같은 cycle 두 번 없음, 두 cycle 관측, 넘긴 값 .06) → 성표 하나 정화(1/4) → 성표 밖 · core 밖에서 제한 시간 초과 붕괴 1회(넘긴 값 .06, 성표 0/4, left 20) → R AUTO 켬 → 4/4 · 봉인 해제 → 완주',
  '  screens  단서 읽기(read) · 판 선택(select) · 고리 열림(ringOpen) · 집결 예고(warning) · 집결 터짐(burst) 순간마다 640x360, 844x390, 390x844 PNG + 그 순간 route 상태 JSON + 결과 PNG(캡처 대기 90초)',
  '',
  '주의: 좌표 이동·무적·HP 주입·적 hp 조작으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.',
  'SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다. choice·ring·screens 의 키보드 입력은 Playwright 가 보낸 에뮬레이터 키 이벤트다.',
].join('\n');
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
// 값 없는 플래그(--quality, --motion)도 받는다.
const flag = (name, bare, fallback) => qaArgument(name) ?? (process.argv.includes('--' + name) ? bare : fallback);
/** 실행 환경 부하 기록: /proc/loadavg 1·5·15분 평균(없으면 null). */
const loadNow = () => { try { const [a, b, c] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number); return { avg1: a, avg5: b, avg15: c, at: new Date().toISOString() }; } catch { return null; } };
const loadStart = loadNow();
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'choice', 'ring', 'screens'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
qaAssert(arg('depth', 'deep') === 'deep', '--depth must be deep (성운 첨탑 일반에는 심층 성좌·고리 정의가 없다)');
const depth = 'deep';
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
const waitLoad = qaArgument('wait-load') === undefined ? null : Number(qaArgument('wait-load'));
qaAssert(waitLoad === null || (Number.isFinite(waitLoad) && waitLoad > 0), '--wait-load must be a positive number');
const contextOptions = { reducedMotion: motion };
const SCREEN_VIEWPORTS = [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
const DUNGEON_ID = 'astral_leviathan_spire';
/** ring 프로필: 방 밖 대기 3초(스텝 180), 중심에 닿았다고 보는 반경, 안전한 점은 정화한 성표에서 접선 방향으로 떨어진 거리. */
const RING_RUN = Object.freeze({ waitSteps: 180, centerNear: 1, tangent: 3, edgeNear: 1.2 });
/** 키보드로 걷다 한 번에 돌리는 스텝 수와 그 상한(40초). */
const WALK_CHUNK = 4;

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다). 접근·에너지·증원 횟수를 이 파일에 박지 않는다.
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const dungeonDef = EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID && d.depth === 'deep');
qaAssert(dungeonDef, 'Target project has no ' + DUNGEON_ID + ' deep definition');
// 성좌·고리 정의. 기준선(a737875)에는 astral_deep 이 없어 null 이고 성좌·고리 판정을 건너뛴다.
const routeData = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES ?? {};
const routeDef = routeData.astral_deep ?? null;
const deepRooms = routeDef ? [...routeDef.gates.map(g => g.roomId), routeDef.ring?.roomId].filter(id => Number.isInteger(id)) : null;
const judgedProfiles = !!routeDef && routeDef.kind === DEEP.kind;
const needsKeyboard = selected.some(name => name !== 'auto');

const STEP_CLASS = {
  auto: [['F', '저장 주입(해금·영웅 Lv.50 별3 스킬5·장비·에너지·AUTO)'], ['R', '출격 카드 버튼 · #btn-auto'], ['C', 'app.testPause + 고정 1/60 app.step 으로 완주'],
    ['C', 'app.step 한 번마다 page.evaluate 한 번에 관측(읽기 전용, 상태 변화·읽기/유지 중·고리 open|running 매 스텝·1초 간격 행)'],
    ['C', 'renderer.render() 단독 호출로 방 첫 진입 draw call 표본'], ['R', '결과 화면 DOM · 로비 버튼 · 새로고침']],
  choice: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 1번 성좌 ready 까지 고정 스텝'], ['R', '키보드 KeyW/A/S/D 로 모래시계 근처 읽기 · 오답 판 · 판 밖 · 정답 판(공격 키 없음)'],
    ['C', '키 입력 사이 4스텝씩 고정 진행(키보드 구간은 매 스텝 관측)'], ['C', 'AUTO 완주 · 결과 판정']],
  ring: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 고리 open 까지 고정 스텝'], ['R', '키보드로 방 밖 대기 · 진입 · 중심 core 체류 · 성표 정화 · 안전한 점에서 붕괴 대기(공격 키 없음)'],
    ['C', '키 입력 사이 4스텝씩 고정 진행(키보드 구간은 매 스텝 관측)'], ['C', 'AUTO 완주 · 결과 판정']],
  screens: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 단서 읽기·판 선택 순간까지 고정 스텝'], ['R', '고리 open 에서 키보드로 방 가장자리 → 방 안 안전한 점 이동'],
    ['C', 'renderer.render() 단독 호출 + viewport 3종 스크린샷(시뮬레이션 tick 없음) + 순간별 route 상태 JSON']],
};
const report = { kind: 'astral-deep-qa', releaseApproved: false, seed, heroId, depth, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'astral-deep-checks.mjs'))), profiles: {}, checks: [], reportItems: {},
  reseed: { on: reseedOn, elapsed: null }, load: { start: loadStart, waitedMs: 0, end: null, waitLoad }, routeDefinition: routeDef ? JSON.parse(JSON.stringify(routeDef)) : null, deepRooms,
  catalog: { id: dungeonDef.id, depth, energy: dungeonDef.energy, minLevel: dungeonDef.minLevel, unlockCode: dungeonDef.unlockCode ?? null, rewards: dungeonDef.rewards,
    firstRewards: dungeonDef.firstRewards ?? null, objective: dungeonDef.objective ?? null, tactic: dungeonDef.tactic ?? null, mechanics: dungeonDef.mechanics ?? null, routeId: routeDef?.id ?? null },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^심층 원정/', '[data-dungeon="' + DUNGEON_ID + '"][data-depth="deep"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창 textContent, 같은 상태 0.6초 뒤 표본)'],
    result: ['.exp-result-shell (결과 줄 innerText)', '.exp-result-shell p[aria-label] (aria-label "별자리 복원 결과" · "외곽 고리 정화 결과")', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives (progress/phase/read/hold/selected/mistakes/revealed/gates[i].*/ring.*/def/view/ringView)',
      'window.app.battle.world (sealed/rooms/roomAt/linkPending/minX/minZ/cols)', 'window.app.battle (enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, stage.encounter.tactic, player.pos/hp/auto/state)',
      'window.app.input.attackHeld', 'window.app.input.keys / enabled', 'window.app.ui.toast (호출 기록 감싸개)', 'window.app.battle.player.hurt (호출 기록 감싸개)', 'window.app.renderer.r.info.render.calls',
      'window.app.expeditionUI.result.routeObjective', 'window.__qaReseed (init script)', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨·기본 원정 승리)·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)와 window.__qaReseed(seed) 재시드(전투 활성·prepareView 뒤 첫 스텝 전 1회)',
      quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → 심층 원정 → 카드 출격 버튼', '#btn-auto', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      needsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): 걷는 방향은 도구가 목표 위치의 화면 투영으로 정함(게임 입력층이 지운 키는 다시 누름). 텔레포트·무적·HP 주입·공격 키 없음' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)', 'app.ui.toast · player.hurt 감싸개(호출을 그대로 넘기고 기록만)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각', '모래시계 단서·판·고리·파편의 실제 모습(PNG 는 사람이 본다)'],
    steps: Object.fromEntries(selected.map(name => [name, STEP_CLASS[name].map(([kind, detail]) => ({ kind, detail }))])) },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/route-objectives.js', 'src/game/astral-constellations.js', 'src/game/astral-deep-constellations.js', 'src/game/astral-constellation-view.js', 'src/game/astral-deep-ring-view.js',
  'src/data/route-objectives.js', 'src/data/expedition-depths.js', 'src/data/expansion.js', 'src/data/stages.js', 'src/ui/battle-objective-view.js', 'src/ui/battle-readability.js', 'src/expansion/hub.jsx',
  'src/game/battle-base.js', 'src/game/world.js', 'src/engine/input.js', 'src/game/expedition-combat.js', 'src/game/enemies.js', 'src/game/player.js', 'src/game/expedition-economy.js', 'src/main.js']
  .filter(file => fs.existsSync(path.join(projectRoot, file)));
// 시작 전 부하 대기(선택): 1분 load 가 기준 이하가 될 때까지 최대 180초. 기다린 시간과 실제 load 를 남긴다. 3분이 지나면 그대로 시작한다.
if (waitLoad !== null) {
  const began = Date.now();
  while (Date.now() - began < 180000 && (loadNow()?.avg1 ?? 0) > waitLoad) await new Promise(resolve => setTimeout(resolve, 5000));
  report.load.waitedMs = Date.now() - began;
}
report.load.beforeStart = loadNow();
const qa = await createExpeditionQa({ root: projectRoot, driver: import.meta.filename, report, sourceFiles });
let page;
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); return !!ok; };
/** 실행 태그별 관측 행(report 에는 파일로만 남긴다). */
const traces = new Map();

// ---------- 페이지 안 측정 프로브(게임 판정에는 쓰지 않는다) ----------
function installProbe(cfg) {
  const app = window.app;
  const P = window.__astralDeepQa = { dt: 1 / 60, steps: 0, cfg, dense: false, toasts: [] };
  const routeOf = () => app.battle.routeObjectives;
  const EMPTY = [];
  const RPH = cfg.ringPhase, GPH = cfg.gatePhase, SHD = cfg.shard, CHOICES = cfg.choiceIds;
  const H = 18, K = 7;   // sig 앞 칸 수, 성좌마다 칸 수
  const num = v => (Number.isFinite(v) ? v : null);
  const int = v => (Number.isInteger(v) ? v : null);
  const bit = v => (typeof v === 'boolean' ? (v ? 1 : 0) : -1);
  // 토스트 기록: 호출을 그대로 넘기는 관측용 감싸개다(게임 판정에는 쓰지 않는다). 프로브를 다시 설치해도 한 번만 감싼다.
  const ui = app.ui;
  if (ui && !ui.__astralDeepQaWrapped) {
    const original = ui.toast;
    ui.toast = function (...args) {
      const q = window.__astralDeepQa;
      if (q?.toasts) q.toasts.push({ n: q.steps, t: app.battle?.elapsed ?? null, msg: String(args[0]), kind: args[1] ?? null, tac: typeof app.battle?.stage?.encounter?.tactic === 'string' ? app.battle.stage.encounter.tactic : null });
      return original.apply(this, args);
    };
    ui.__astralDeepQaWrapped = true;
  }
  const ringOf = () => { const r = routeOf(); return r && r.ring ? r.ring : null; };
  const roomOf = id => app.battle.world.rooms.find(x => x.id === id) ?? null;
  const setupOf = () => {
    const r = routeOf();
    if (!r || !Array.isArray(r.gates)) return null;
    const v = o => ({ x: o && Number.isFinite(o.x) ? o.x : null, z: o && Number.isFinite(o.z) ? o.z : null });
    const gates = r.gates.map(g => ({ id: g.room.id, roomX: num(g.room.x), roomZ: num(g.room.z), x: v(g.pos).x, z: v(g.pos).z, answer: g.answer ?? null,
      pads: (g.pads || []).map(p => ({ id: p.id, ...v(p.pos) })) }));
    const c = ringOf();
    if (!c) return { gates, ring: null };
    const rid = c.room?.id ?? c.room, rm = roomOf(rid);
    return { gates, ring: { roomId: rid ?? null, roomX: num(rm?.x), roomZ: num(rm?.z), cx: v(c.center).x, cz: v(c.center).z, minX: num(c.minX), maxX: num(c.maxX), minZ: num(c.minZ), maxZ: num(c.maxZ),
      marks: (Array.isArray(c.marks) ? c.marks : EMPTY).map(m => v(m?.pos)) } };
  };
  // 지금 차례 성좌의 전투 중 적 수: 그 방 소속이거나 영웅에서 전투 반경 안(부모 inCombat 과 같은 정의).
  const ecOf = r => {
    const b = app.battle, gs = r && r.gates ? r.gates : EMPTY, gate = r ? gs[r.progress] : null;
    if (!gate) return 0;
    const p = b.player.pos; let n = 0;
    for (const e of b.enemies) if (e.alive && (e.homeRoom === gate.room || (e.pos && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= cfg.combatRadius))) n++;
    return n;
  };
  // ---- 행 만들기: 관측값만 읽는다. sig 는 상태 변화 감지용 숫자 배열이다. ----
  const fill = () => {
    const b = app.battle, r = routeOf(), gs = r && r.gates ? r.gates : EMPTY, s = P.sig, c = ringOf();
    let rem = 0;
    for (const room of b.world.rooms) if (room.type !== 'start' && room.type !== 'boss' && !room.cleared) rem++;
    s[0] = b.curRoom ? b.curRoom.id : -1; s[1] = r && Number.isInteger(r.progress) ? r.progress : -1; s[2] = b.world.sealed ? 1 : 0; s[3] = rem; s[4] = b.player.auto ? 1 : 0;
    s[5] = r && r.read > 0 ? 1 : 0; s[6] = r && r.hold > 0 ? 1 : 0; s[7] = r ? (typeof r.phase === 'string' ? (GPH[r.phase] ?? 9) : -1) : -1; s[8] = r ? bit(r.revealed) : -1;
    const sel = r ? r.selected : undefined;
    s[9] = typeof sel === 'string' ? CHOICES.indexOf(sel) : sel === null ? -1 : -2; s[10] = r && Number.isInteger(r.mistakes) ? r.mistakes : -1;
    s[11] = c ? (RPH[c.phase] ?? 9) : -1; s[12] = c && Number.isInteger(c.collapses) ? c.collapses : -1; s[13] = c && Number.isInteger(c.shardHits) ? c.shardHits : -1;
    s[14] = c && Number.isInteger(c.purified) ? c.purified : -1; s[15] = c && Number.isInteger(c.held) ? c.held : -2;
    s[16] = c ? (SHD[c.shard?.state] ?? 9) : -1; s[17] = c && Number.isInteger(c.shard?.cycle) ? c.shard.cycle : -9;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i], room = g.room, o = H + i * K;
      let al = 0, pd = 0;
      for (const e of b.enemies) if (e.alive && e.homeRoom === room) al++;
      for (const q of b.pending) if (q.room === room) pd++;
      s[o] = g.ready ? 1 : 0; s[o + 1] = g.available ? 1 : 0; s[o + 2] = g.attuned ? 1 : 0; s[o + 3] = room.cleared ? 1 : 0; s[o + 4] = room.discovered ? 1 : 0; s[o + 5] = al; s[o + 6] = pd;
    }
  };
  const build = mk => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r && r.gates ? r.gates : EMPTY, s = P.sig, c = ringOf();
    const row = { n: P.steps, t: b.elapsed, x: p.pos.x, z: p.pos.z, hp: p.hp, mhp: p.maxHp, al: p.alive ? 1 : 0, rm: s[0], pr: s[1], sl: s[2], rem: s[3], au: s[4],
      ah: app.input.attackHeld ? 1 : 0, ps: p.state, rs: r ? num(r.read) : null, hd: r ? num(r.hold) : null, ph: s[7], rv: s[8], se: typeof (r ? r.selected : undefined) === 'string' ? r.selected : r && r.selected === null ? '' : null,
      mi: s[10], hn: P.hurtN, ec: ecOf(r),
      g: gs.map((g, i) => { const o = H + i * K; return { id: g.room.id, rdy: s[o], av: s[o + 1], at: s[o + 2], cl: s[o + 3], dc: s[o + 4], al: s[o + 5], pd: s[o + 6] }; }), rg: null };
    if (c) {
      row.rg = { ph: s[11], rid: num(c.room?.id ?? c.room), ck: num(c.clock), lf: num(c.left), lim: num(c.limit), el: num(c.elapsed), co: int(c.collapses), sh: int(c.shardHits), pu: int(c.purified),
        ho: Number.isInteger(c.held) ? c.held : null,
        m: (Array.isArray(c.marks) ? c.marks : EMPTY).map(m => ({ h: num(m?.hold), d: typeof m?.done === 'boolean' ? (m.done ? 1 : 0) : -1 })),
        sd: { s: s[16], a: num(c.shard?.age), c: int(c.shard?.cycle) } };
    }
    // 스텝 끝에 전투가 일시정지돼 있으면 표시한다(스텝 안에서 정지가 시작된 경우를 시계 판정이 구분한다).
    if (b.paused) row.pz = 1;
    if (mk) row.mk = mk;
    return row;
  };
  // 피해 기록: player.hurt 를 그대로 넘기는 관측용 감싸개(게임 판정에는 쓰지 않는다). 규칙이 넘긴 피해(÷ 최대 체력)를 그 스텝 번호로 남기고 호출 수를 센다.
  // app.step 안에서 불리므로 스텝 번호는 아직 올리기 전 값 + 1 이다(행의 n 과 같다). 전투마다 새 영웅이라 begin 에서 한 번 감싼다.
  const wrapHurt = pl => {
    if (!pl || pl.__astralDeepQaHurt || typeof pl.hurt !== 'function') return;
    const original = pl.hurt;
    pl.hurt = function (dmg, opts) {
      const q = window.__astralDeepQa;
      if (q?.hurts) { q.hurts.push({ n: q.steps + 1, raw: this.maxHp > 0 && Number.isFinite(dmg) ? dmg / this.maxHp : null }); q.hurtN++; }
      return original.call(this, dmg, opts);
    };
    pl.__astralDeepQaHurt = true;
  };
  const push = row => {
    const hs = P.hurts;
    if (hs && hs.length && hs[hs.length - 1].n === row.n) { const hr = []; for (const h of hs) if (h.n === row.n) hr.push(h.raw); row.hr = hr; }
    P.rows.push(row); P.prevSig.set(P.sig); P.prevRs = row.rs > 0; P.prevHd = row.hd > 0;
  };
  P.begin = () => {
    const b = app.battle, r = routeOf(), gn = r && r.gates ? r.gates.length : 0, size = H + gn * K;
    Object.assign(P, { hpDrops: [], samples: [], stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0, startElapsed: b.elapsed, rows: [], toasts: [], hurts: [], hurtN: 0,
      sig: new Float64Array(size), prevSig: new Float64Array(size).fill(-1e9), prevRs: false, prevHd: false, entered: new Set(), wp: [], okey: -1, ostable: 0, ckey: -1, cstable: 0 });
    wrapHurt(b.player);
    P.prevRoom = b.curRoom?.id ?? null;
    P.prevHp = b.player.hp;
    fill();
    push(build('start'));
    const c = ringOf();
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, routeId: r?.def?.id ?? null, gates: gn, hasRing: !!c, hasPhase: r ? 'phase' in r : false,
      hasFinish: typeof r?.finish === 'function', hasView: !!r?.view, hasRingView: !!r?.ringView, setup: setupOf(),
      allRooms: b.world.rooms.map(x => ({ id: x.id, type: x.type, x: x.x, z: x.z })), reinforcements: b.stage?.expedition?.mechanics?.reinforcements ?? 0,
      encounterTactic: typeof b.stage?.encounter?.tactic === 'string' ? b.stage.encounter.tactic : null,
      def: r ? { id: r.def.id, kind: r.def.kind ?? null, readSeconds: r.def.readSeconds, holdSeconds: r.def.holdSeconds, radius: r.def.radius } : null };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset, r = routeOf();
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2),
      view: r?.view && Number.isFinite(r.view.drawCalls) ? r.view.drawCalls : null, ringView: r?.ringView && Number.isFinite(r.ringView.drawCalls) ? r.ringView.drawCalls : null };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r && r.gates ? r.gates : EMPTY;
    fill();
    const s = P.sig, q = P.prevSig;
    let changed = false;
    for (let i = 0; i < s.length; i++) if (s[i] !== q[i]) { changed = true; break; }
    const ringLive = s[11] === RPH.open || s[11] === RPH.running;
    // 목표창 표본. 고리 open|running: 횟수·phase 가 바뀌지 않은 채 36스텝(0.6초)마다. 그 밖: 지금 차례 성좌의 상태 키가 36스텝 변하지 않았을 때 한 번(10Hz 갱신 뒤).
    let wantDom = false;
    if (ringLive) {
      const key = s[11] * 10000 + s[12] * 100 + s[13];
      if (key !== P.ckey) { P.ckey = key; P.cstable = 0; } else P.cstable++;
      wantDom = P.cstable > 0 && P.cstable % 36 === 0;
      P.okey = -1; P.ostable = 0;
    } else if (r && s[11] <= RPH.idle) {
      P.ckey = -1; P.cstable = 0;
      let okey = 99999;
      if (r.progress < gs.length) { const o = H + r.progress * K; okey = (r.progress + 1) * 1000 + s[o + 4] * 100 + s[o] * 10 + s[7]; }
      if (okey !== P.okey) { P.okey = okey; P.ostable = 0; } else P.ostable++;
      wantDom = P.ostable === 36;
    } else { P.ckey = -1; P.cstable = 0; P.okey = -1; P.ostable = 0; }
    if (changed || s[5] === 1 || s[6] === 1 || P.prevRs || P.prevHd || ringLive || wantDom || P.dense || P.steps % 60 === 0) {
      const row = build(null);
      if (wantDom) row.dom = document.getElementById('objective')?.textContent ?? null;
      push(row);
    }
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
  // 영웅에서 고리 방 사각형까지의 거리(안이면 0).
  const rectDistance = (c, p) => Math.hypot(Math.max(c.minX - p.x, 0, p.x - c.maxX), Math.max(c.minZ - p.z, 0, p.z - c.maxZ));
  // screens 순간(관측 조건만으로 판정): read · select 는 route.phase 로, ringOpen 은 고리 phase open, warning(age .5 이상, 파편이 모이는 중) · burst 는 고리 open|running 이고 영웅이 고리 방 안.
  const momentNow = label => {
    const b = app.battle, r = routeOf(), c = ringOf();
    if (!r) return false;
    const gate = r.gates?.[r.progress];
    switch (label) {
      case 'read': return r.phase === 'read' && r.read > 0 && !!gate?.available;
      case 'select': return r.phase === 'select' && r.revealed === true && !!gate?.available;
      case 'ringOpen': return !!c && c.phase === 'open';
      case 'warning': return !!c && (c.phase === 'open' || c.phase === 'running') && rectDistance(c, b.player.pos) === 0 && c.shard?.state === 'warning' && c.shard.age >= .5;
      case 'burst': return !!c && (c.phase === 'open' || c.phase === 'running') && rectDistance(c, b.player.pos) === 0 && c.shard?.state === 'burst';
      default: return false;
    }
  };
  P.hit = stop => {
    const b = app.battle, r = routeOf(), c = ringOf(), p = b.player.pos;
    switch (stop.type) {
      case 'time': return b.elapsed >= stop.t;
      case 'result': return !!app.expeditionUI.result;
      case 'progress': return !!r && r.progress >= stop.n;
      case 'gateReady': return !!r && !!r.gates?.[stop.index]?.ready;
      case 'phase': return !!r && r.phase === stop.name;
      case 'mistakes': return !!r && r.mistakes >= stop.min;
      case 'ringOpen': return !!c && c.phase !== 'idle';
      case 'ringRunning': return !!c && c.phase === 'running';
      case 'ringDone': return !!c && c.phase === 'done';
      case 'ringHits': return !!c && c.shardHits >= stop.min;
      case 'ringPurified': return !!c && c.purified >= stop.min;
      case 'ringCollapses': return !!c && c.collapses >= stop.min;
      case 'shard': return !!c && (c.phase === 'open' || c.phase === 'running') && c.shard?.state === stop.state;
      case 'roomEntered': return b.curRoom?.id === stop.room;
      case 'near': return Math.hypot(p.x - stop.x, p.z - stop.z) <= stop.r;
      case 'nearOrHits': return Math.hypot(p.x - stop.x, p.z - stop.z) <= stop.r || (!!c && c.shardHits >= stop.min);
      case 'nearRect': { if (!c) return false; const d = rectDistance(c, p); return d > 0 && d <= stop.d; }
      case 'moment': { for (const label of stop.pending) if (momentNow(label)) { P.momentHit = label; return true; } return false; }
      default: return false;
    }
  };
  P.run = ({ n, stop = null, renderEvery = 0 }) => {
    const b = app.battle; let ran = 0, reason = 'n';
    P.momentHit = null;
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
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons], hit: P.momentHit };
  };
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
    const row = build(null);
    Object.assign(row, { elapsed: b.elapsed, paused: b.paused, active: b.active, kills: b.kills });
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
    // 먼 경유점을 그대로 투영하면 카메라 뒤·시야 밖에서 부호가 뒤집힌다. 경유점 방향으로 영웅 앞 2 유닛 점만 투영해 화면 방향을 얻는다.
    const ex = wp.x - p.x, ez = wp.z - p.z, el = Math.hypot(ex, ez) || 1;
    const a = p.clone().project(cam), z = p.clone().set(p.x + ex / el * 2, p.y, p.z + ez / el * 2).project(cam);
    // live: 게임 입력층이 지금 눌려 있다고 아는 키. 일시정지 해제 등에서 input.clear() 가 키 상태를 지우면 다시 눌러야 한다.
    const ks = app.input.keys || {}, live = [];
    for (const k in ks) if (ks[k]) live.push(k);
    return { dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2, left: P.wp.length, final: fin, dist: Math.hypot(fin.x - p.x, fin.z - p.z), live };
  };
  // 느린 스텝 목록은 자르지 않는다(기준선 비교가 개수를 정확히 세야 한다).
  P.summary = () => ({ steps: P.steps, stepMs: P.stepMs, renderMs: P.renderMs, slow: P.slow, maxAlive: P.maxAlive, minHpRatio: P.minHpRatio, samples: P.samples,
    hpDrops: P.hpDrops, rows: P.rows, toasts: P.toasts });
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
  }, { heroId, id: DUNGEON_ID, items, unlockCode: dungeonDef.unlockCode ?? null, minLevel: dungeonDef.minLevel, quality });
  qaAssert(fixture.access.ok, 'Fixture did not open deep access: ' + fixture.access.error);
  report.fixture = { ...fixture, items: items.map(item => item.id), kind: 'FIXTURE' };
  await qa.save(); return fixture;
}
async function launchFromLobby(row) {
  await page.locator('#btn-expedition').click();
  await page.locator('.adventure-nav [data-section="dungeons"]').click();
  await page.locator('.exp-route-tabs').getByRole('button', { name: /^심층 원정/ }).click();
  const card = page.locator('[data-dungeon="' + DUNGEON_ID + '"][data-depth="deep"]');
  await card.waitFor({ state: 'visible' });
  row.cardText = await card.innerText();
  const energyOnCard = Number(/에너지 (\d+)/.exec(row.cardText)?.[1]);
  check('card energy matches catalog', energyOnCard === dungeonDef.energy, { card: energyOnCard, catalog: dungeonDef.energy });
  const button = card.locator('.exp-primary');
  qaAssert(await button.isEnabled(), 'deep card departure button disabled');
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
    routeKind: r?.def?.kind ?? null, routeId: r?.def?.id ?? null, rooms: b.world.rooms.length, gates: r && r.gates ? r.gates.length : 0, controller: r ? r.constructor.name : null,
    hasView: !!r?.view, hasRingView: !!r?.ringView, hasRing: !!r?.ring, hasPhase: r ? 'phase' in r : false, mechanics: b.stage.expedition?.mechanics ?? null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && info.route.depth === 'deep' && row.started.pending?.energy === dungeonDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === 'deep' && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  // 정의가 있는 후보 빌드인데 컨트롤러가 없으면(규칙 lane 미병합) 기준선으로 오인하지 않도록 실패로 남긴다. 정의가 없는 기준선인데 컨트롤러가 있어도 실패로 남긴다.
  if (routeDef) check(tag + ': 성좌 컨트롤러 id = ' + routeDef.id, info.routeId === routeDef.id && info.gates === routeDef.gates.length && info.hasRing && info.hasPhase, { routeId: info.routeId, gates: info.gates, controller: info.controller, hasRing: info.hasRing, hasPhase: info.hasPhase });
  else check(tag + ': 성좌 정의가 없는 기준선인데 routeObjectives 가 있음', !info.routeId, { routeId: info.routeId, controller: info.controller });
  if (routeDef) check(tag + ': 출격 직후(prepareView 뒤) route.view(성좌 뷰) · route.ringView(고리 뷰) 존재', info.hasView && info.hasRingView, { hasView: info.hasView, hasRingView: info.hasRingView });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { ringPhase: { idle: PHASE_CODE.idle, open: PHASE_CODE.open, running: PHASE_CODE.running, done: PHASE_CODE.done },
    gatePhase: GATE_PHASE_CODE, shard: SHARD_CODE, choiceIds: (routeDef?.choices ?? DEEP.choices).map(c => c.id), combatRadius: routeDef?.combatRadius ?? DEEP.combatRadius });
  row.begin = await page.evaluate(() => window.__astralDeepQa.begin());
  row.reinforcements = row.begin.reinforcements;
  // 재시드: 첫 app.step 전 한 번. --no-reseed 면 호출하지 않는다.
  row.reseed = reseedOn ? await page.evaluate(s => { const q = window.__astralDeepQa, b = window.app.battle; const r = { on: true, elapsed: b.elapsed, active: b.active, steps: q.steps, hasRoute: !!b.routeObjectives, hasView: !!b.routeObjectives?.view };
    window.__qaReseed(s); return r; }, seed) : { on: false, elapsed: null };
  report.reseed = { on: row.reseed.on, elapsed: row.reseed.elapsed };
  if (reseedOn) check(tag + ': 재시드는 전투 활성·첫 스텝 전(elapsed 0)', row.reseed.active === true && row.reseed.steps === 0 && row.reseed.elapsed === 0, row.reseed);
  if (routeDef) check(tag + ': 정예방 증원 횟수 = 대상 프로젝트 mechanics.reinforcements', row.reinforcements === (dungeonDef.mechanics?.reinforcements ?? 0), { page: row.reinforcements, project: dungeonDef.mechanics?.reinforcements ?? null });
  await qa.save(); return row;
}
/**
 * 각인 창(선택지 모달)은 정지 사유가 걸린 뒤 조금 늦게 보일 수 있다. 대기 전의 정지 상태(정지 사유·열린 dialog·버튼 수)를 먼저 남기고 90초까지 기다린다.
 * 기다려도 안 보이면 그 시점의 진단을 담아 실패한다. 선택은 실제 첫 번째 버튼 클릭이다.
 */
async function takeChoice(row, last = null) {
  const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
  const snap = () => page.evaluate(() => ({ reasons: [...window.app.battle.pauseReasons], paused: window.app.battle.paused, active: window.app.battle.active,
    elapsed: window.app.battle.elapsed, open: [...document.querySelectorAll('dialog[open]')].map(d => d.id),
    count: document.querySelectorAll('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').length }));
  const before = await snap(); const waitStart = Date.now();
  try { await buttons.first().waitFor({ state: 'visible', timeout: 90000 }); }
  catch {
    const now = await page.evaluate(() => ({ reasons: [...window.app.battle.pauseReasons], paused: window.app.battle.paused,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ id: d.id || d.className, offer: d.dataset.offer ?? null, view: d.dataset.view ?? null, text: (d.innerText || '').slice(0, 400), buttons: [...d.querySelectorAll('button')].slice(0, 12).map(b => ({ cls: b.className, dis: b.disabled, vis: !!(b.offsetWidth || b.offsetHeight), text: (b.innerText || '').slice(0, 30) })) })) }));
    throw Error('Battle paused without a visible native choice: ' + JSON.stringify({ atPause: last?.pauseReasons ?? null, elapsed: last?.elapsed ?? null, before, waitedMs: Date.now() - waitStart, now }));
  }
  row.choices.push({ text: await buttons.first().innerText(), elapsed: await page.evaluate(() => window.app.battle.elapsed), before, waitedMs: Date.now() - waitStart });
  await buttons.first().click();
}
let keyboardMode = false;
/** stop 조건 또는 전투 종료까지 고정 스텝으로 진행한다. 선택지 모달이 열리면 실제 첫 번째 버튼을 누른다(키보드 구간이면 캔버스 포커스를 되찾는다). */
async function advance(row, stop, { max = 60 * 60 * 12, chunk = 600, renderEvery = 0 } = {}) {
  let total = 0, last;
  while (total < max) {
    last = await page.evaluate(opts => window.__astralDeepQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row, last); if (keyboardMode) await nativeGameplayFocus(page); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = () => page.evaluate(() => window.__astralDeepQa.freeze());
const mark = label => page.evaluate(l => window.__astralDeepQa.mark(l), label);
const setDense = on => page.evaluate(v => window.__astralDeepQa.setDense(v), on);
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
// 캡처 대기는 90초다(소프트웨어 렌더 로드가 높을 때 640x360 캡처가 기본 30초를 넘긴 적이 있다).
const SHOT_TIMEOUT = 90000;
/** viewport 3종 PNG. 각 PNG 옆에 같은 이름의 .json 으로 그 순간의 상태(state)를 남기고 [{ png, json }] 을 돌려준다. 파일 이름은 라벨·태그·크기로 정해 서로 겹치지 않고, 이미 있으면 쓰기가 실패한다(wx). */
async function captureScreens(label, stateOf) {
  const shots = [];
  for (const size of SCREEN_VIEWPORTS) {
    await page.setViewportSize(size);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => window.app.renderer.render()); // 시뮬레이션 tick 없이 그리기만
    const base = label + '-' + size.width + 'x' + size.height;
    await page.screenshot({ path: path.join(qa.out, base + '.png'), timeout: SHOT_TIMEOUT });
    fs.writeFileSync(path.join(qa.out, base + '.json'), JSON.stringify({ label, viewport: size, png: base + '.png', state: stateOf }, null, 1), { flag: 'wx' });
    shots.push({ png: base + '.png', json: base + '.json' });
  }
  await page.setViewportSize(viewport); await page.waitForTimeout(150);
  await page.evaluate(() => window.app.renderer.render());
  return shots;
}
const shot = async label => { const file = label + '.png'; await page.evaluate(() => window.app.renderer.render()); await page.screenshot({ path: path.join(qa.out, file), timeout: SHOT_TIMEOUT }); return file; };
/** 실제 #btn-auto 버튼으로 AUTO 를 원하는 상태로 맞춘다. */
async function setAuto(on) {
  const now = await page.evaluate(() => window.app.battle.player.auto);
  if (now !== on) await page.locator('#btn-auto').click();
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === on, 'Native AUTO button did not set AUTO ' + on);
}

// ---------- 키보드 ----------
const held = new Set();
async function setKeys(next, live = null) {
  for (const key of [...held]) if (!next.has(key)) { await page.keyboard.up(key); held.delete(key); }
  // live 를 주면, 도구가 누르고 있다고 아는 키 중 게임 입력층에서 지워진 키(input.clear: 각인 창 닫힘 뒤 정지 해제 등)를 떼었다 다시 누른다(실제 사용자의 재입력과 같다).
  if (live) for (const key of [...held]) if (!live.includes(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
/** 화면 방향(영웅 → 경유점 투영 차)을 8방향 키 조합으로 바꾼다. 입력 키는 화면 기준이다(카메라 요를 입력층이 처리). */
function keysToward(aim) {
  const len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len, keys = new Set();
  if (ux > .38) keys.add('KeyD'); if (ux < -.38) keys.add('KeyA'); if (uy > .38) keys.add('KeyS'); if (uy < -.38) keys.add('KeyW');
  return keys;
}
/**
 * AUTO 를 끈 영웅을 키보드(W/A/S/D)만으로 목표(방 중심, 한 점, 또는 방 중심을 지나 한 점)까지 걷게 한다. 경유점은 방 연결의 L자 복도 모서리와 방 중심이다.
 * stop 이 참이 되면 끝낸다. 공격·회피 키는 누르지 않는다. 좌표 이동·무적 없이 실제 입력만 쓴다. 영웅이 쓰러지면 전투가 끝나 예외가 난다.
 */
async function walkTo(row, target, stop, { maxSteps = 60 * 40 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard walking');
  await page.evaluate(t => window.__astralDeepQa.setTarget(t), target);
  let total = 0; const trail = [];
  try {
    while (total < maxSteps) {
      if (await page.evaluate(s => window.__astralDeepQa.hit(s), stop)) return { steps: total, trail, hit: await page.evaluate(() => window.__astralDeepQa.momentHit) };
      const aim = await page.evaluate(() => window.__astralDeepQa.aim());
      await setKeys(keysToward(aim), aim.live);
      const r = await page.evaluate(opts => window.__astralDeepQa.run(opts), { n: WALK_CHUNK, stop });
      total += r.ran;
      if (trail.length < 300 && (total / WALK_CHUNK) % 15 === 0) trail.push({ steps: total, t: ms(r.elapsed), dist: +aim.dist.toFixed(2), left: aim.left });
      if (r.reason === 'stop') return { steps: total, trail, hit: await page.evaluate(() => window.__astralDeepQa.momentHit) };
      if (r.reason === 'inactive') throw Error('Battle ended while walking by keyboard (hero down?): ' + JSON.stringify(trail.slice(-6)));
      if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row, r); await nativeGameplayFocus(page); }
    }
    throw Error('Keyboard walking did not reach its stop within ' + maxSteps + ' steps: ' + JSON.stringify(trail.slice(-6)));
  } finally { await setKeys(new Set()); }
}

// ---------- 완주·정리 ----------
const LABELS = {
  observation: '관측 완전성: 읽기 · 유지 · 단계 · 선택 · 오답 수 · 피해 호출 수 · 성좌 칸 · 고리 칸(성표 · 집결)이 모든 행에서 읽힘(-1 · null 은 실패)',
  definition: '정의 = PLAN 3.0 계약(성좌 방 [3,2,5,6]·라벨·답, 고리 방 7·성표·limit 20·집결 수치)', setup: '정적 setup(모래시계 = 방 중심, 판 = 모래시계 + 오프셋, 고리 중심 = 방 중심, 성표 = 중심 + 오프셋, 사각형)',
  restoreCount: '성좌 복원 4회(progress 증가 스텝, 한 번에 +1)', restoreOrder: '복원 순서 = 정의 순서 [' + (routeDef ? routeDef.gates.map(g => g.roomId).join(', ') : DEEP.rooms.join(', ')) + '] (보고 rooms)',
  restoreHold: '복원마다 직전 연속 유지(0 에서 시작, hold 증가 = 게임 시각 증가)가 hold ≥ 1초 · 게임 시각 길이 ≥ 1초 − 1/60, 내내 route.selected 가 정답 판이고 영웅이 정답 판 반경 안',
  restoreRead: '유지 앞 읽기 구간이 0 에서 시작해 게임 시간만큼 늘어 read ≥ 1초(유지 시작 직전 행 read ≥ 1)', restoreAvailable: '읽기·유지 내내 그 성좌가 ready · available · 그 방 적 0 · 전투 중 적 0 · 모래시계 8m 안',
  restoreState: '복원 상태(앞 성좌 attuned · 뒤 성좌 아직 · 복원 전 cleared 아님 · 오답 수 불변)', turnRooms: '차례 아닌 성좌 방은 복원 전 미정화(매 관측 행) · 방 2 성좌는 1번 복원 전에 준비되고 그동안 미정화',
  readyTiming: '성좌 준비 시점: 방 발견·적/대기열 0, 준비 전 읽기·유지 0', ringOpen: '고리 열림: 4/4 와 시작·보스를 뺀 모든 방 정화 뒤(조건 관측 최대 한 스텝 뒤), 열리는 스텝 clock 0, phase 순서',
  ringStart: '정화 시작: 방 사각형 안 첫 스텝 running · limit 20 · 열린 동안 늦은 시작 없음', ringLimit: '제한 시간: 정화 중 limit 20 · 0 ≤ left ≤ limit', ringClock: '고리 시계(clock · left · elapsed 가 게임 시간만큼, 일시정지 스텝은 값이 정확히 같을 때만 면제)',
  shards: '집결 위상(첫 1초 · 주기 4.5 · 예고 1.5 · 터짐 .5) = clock 계산값', shardHits: '파편 피격: 터지는 동안 중심 core 3.4 안에서만·같은 cycle 한 번(기록: 파편 피격 수)',
  marks: '성표: 정화 = 0 에서 시작한 1초 유지·반경 1.4 안, 벗어나면 초기화, purified = done 수', collapses: '붕괴: 제한 시간이 바닥난 스텝·성표 초기화·left = limit(AUTO 는 0)', ringDone: '고리 완료: 성표 4/4 스텝 done·그 뒤 유지',
  sealed: 'world.sealed 는 고리 완료(done) 전까지 true, 완료 스텝에 해제', resultFields: '결과 routeObjective { id, complete, progress, target, mistakes, rooms, constellations, ring{ purified, marks, collapses, shardHits, seconds } }',
  resultLine: "결과 줄 '별자리 복원 4/4 · … · 오답 n회' + '외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 n회 · 붕괴 n회'", resultElements: '결과 줄 요소 aria-label 두 개 본문',
  objectiveText: '목표창 단계별 문구(선택 단계·고리 정화 중 표본 필수, 공명·조율판 문구 없음)',
  toasts: '토스트: 준비(차례/대기)·복원 4회·모든 별자리 복원·고리 열림·시작 limit·성표·피격·붕괴·오답·완료, 전술 토스트는 정확 일치만 면제', autoCounts: '고리 성표 4개 정화(AUTO 는 붕괴 0)',
};
/** 관측 행을 파일로 빼고, 성좌·고리 정의가 있는 빌드는 전 과정을 판정한다. 기준선(정의 없음)은 공통 측정만 남긴다. */
function recordRun(row, raw, { clean = true } = {}) {
  const rows = raw.rows, toasts = raw.toasts;
  delete raw.rows; delete raw.toasts;
  traces.set(row.tag, rows);
  fs.writeFileSync(path.join(qa.out, row.tag + '-trace.json'), JSON.stringify(rows), { flag: 'wx' });
  fs.writeFileSync(path.join(qa.out, row.tag + '-toasts.json'), JSON.stringify(toasts), { flag: 'wx' });
  row.traceFile = row.tag + '-trace.json'; row.toastFile = row.tag + '-toasts.json'; row.traceRows = rows.length;
  const roomSamples = raw.samples.filter(x => x.label === 'roomEnter');
  check(row.tag + ': 방 첫 진입 draw call 표본(roomEnter) 1개 이상', roomSamples.length > 0, { rooms: roomSamples.map(x => x.roomId) });
  if (!routeDef) { row.deep = { skipped: '성좌·고리 정의(ROUTE_OBJECTIVES.astral_deep)가 없는 기준선 빌드: 성좌·고리 판정 생략, 완주·시간·50ms 만 기록' }; return; }
  const missingRooms = deepRooms.filter(id => !roomSamples.some(x => x.roomId === id));
  check(row.tag + ': 성좌·고리 방마다 첫 진입 draw call 표본', missingRooms.length === 0, { deepRooms, missing: missingRooms });
  const analysis = analyzeAuto({ rows, setup: row.begin.setup, result: row.result?.routeObjective, resultText: row.resultText, resultLines: row.resultLines,
    win: row.result?.win === true, toasts, encounterTactic: row.begin.encounterTactic ?? null }, routeDef, { clean });
  row.deep = analysis;
  const doneRow = rows.find(r => r.rg?.ph === PHASE_CODE.done), last = rows.at(-1);
  (report.reportItems.ringCounts ??= []).push({ tag: row.tag, shardHits: analysis.counts.shardHits, collapses: analysis.counts.collapses, mistakes: analysis.counts.mistakes, hurts: last?.hn ?? null,
    seconds: doneRow?.rg.el ?? null, limitAtStart: rows.find(r => r.rg?.ph === PHASE_CODE.running)?.rg.lim ?? null, result: row.result?.routeObjective?.ring ?? null,
    note: '보고 항목(판정 아님): 파편 피격 · 오답 · 붕괴 수와 고리 정화에 걸린 초(AUTO 의 붕괴 0 만 게이트)' });
  (report.reportItems.objectiveSamples ??= []).push({ tag: row.tag, samples: analysis.objective.samples, kinds: analysis.objective.kinds, note: '보고 항목: 목표창 단계별 표본 수' });
  (report.reportItems.earlyReady ??= []).push({ tag: row.tag, early: analysis.turn.early, observedOutOfTurn: analysis.turn.observed, gates: analysis.turn.gates, note: '보고 항목: 차례 아닌 성좌가 먼저 준비된 관측(방 2 는 필수, 나머지는 AUTO 경로에 따라 없을 수 있다)' });
  (report.reportItems.viewDrawCalls ??= []).push({ tag: row.tag, samples: raw.samples.filter(x => x.view !== null || x.ringView !== null).map(x => ({ roomId: x.roomId ?? null, calls: x.calls, view: x.view, ringView: x.ringView })), note: '보고 항목: route.view.drawCalls · route.ringView.drawCalls (뷰 계약 get drawCalls)' });
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': ' + (LABELS[name] ?? name), ok, ok ? undefined : { name, observation: analysis.observation, restorations: { ...analysis.restorations, events: analysis.restorations.events?.slice(0, 4) },
    turn: analysis.turn, ready: analysis.ready, open: analysis.open, start: analysis.start, limit: analysis.limit, clock: analysis.clock, shards: analysis.shards,
    hits: { ...analysis.hits, hits: analysis.hits.hits?.slice(0, 6) }, marks: analysis.marks, collapses: analysis.collapses, done: analysis.done, seal: analysis.seal, counts: analysis.counts, result: analysis.result,
    resultLines: analysis.resultLines, resultElements: analysis.resultElements, objective: analysis.objective, toasts: analysis.toasts, definition: analysis.definition, setup: analysis.setup });
}
/**
 * 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·성좌/고리 판정을 기록한다. 결과 두 줄과 줄 요소(aria-label)를 읽는다.
 * clean: AUTO 가 붕괴 없이 고리를 정화했는지까지 요구한다(고리를 수동으로 건드린 ring · screens 는 false).
 */
async function playToEnd(row, { expectFirstClear = true, clean = true } = {}) {
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await mark('end');
  await waitResult();
  row.summary = await page.evaluate(() => window.__astralDeepQa.summary());
  row.result = await resultSnapshot();
  row.resultText = await page.locator('.exp-result-shell').innerText();
  row.resultLines = await page.locator('.exp-result-shell p[aria-label]').evaluateAll(els => els.map(el => ({ aria: el.getAttribute('aria-label'), text: el.textContent })));
  row.after = await state();
  row.settlement = await page.evaluate(() => { const b = window.app.battle; return { paid: !!b.result?.expeditionReceipt?.ok, receipt: b.result?.expeditionReceipt ? structuredClone({ ok: b.result.expeditionReceipt.ok, rewards: b.result.expeditionReceipt.rewards }) : null, dirty: !!b.rpgDirty }; });
  const win = row.result?.win === true;
  check(row.tag + ': 완주 승리', win && !row.result.saveError && row.settlement.paid, { win, saveError: row.result?.saveError });
  if (win) {
    check(row.tag + ': pending 비움', row.after.pending === null && row.after.seq === row.before.seq + 1);
    check(row.tag + ': 저장 바이트 변경', row.after.saveSha256 !== row.before.saveSha256 && row.after.saveSha256 !== row.started.saveSha256);
    const gotMaterials = Object.fromEntries(Object.keys(dungeonDef.rewards.materials || {}).map(m => [m, (row.after.materials[m] || 0) - (row.before.materials[m] || 0)]));
    check(row.tag + ': depthWins +1', row.after.depthWins === row.before.depthWins + 1, { before: row.before.depthWins, after: row.after.depthWins });
    const wantMaterials = {};
    for (const [m, n] of Object.entries(dungeonDef.rewards.materials || {})) wantMaterials[m] = n + (expectFirstClear ? dungeonDef.firstRewards?.materials?.[m] || 0 : 0);
    check(row.tag + ': 재료 보상 ' + (expectFirstClear ? '첫 보상 포함 1회' : '첫 보상 미지급'), JSON.stringify(wantMaterials) === JSON.stringify(gotMaterials), { want: wantMaterials, got: gotMaterials });
    check(row.tag + ': firstClear 표시', row.result.rewards.firstClear === expectFirstClear);
  }
  const s = row.summary;
  row.metrics = { elapsed: row.result?.time ?? null, kills: row.result?.kills ?? null, hpDrops: s.hpDrops.length, hpDropTotal: ms(s.hpDrops.reduce((sum, d) => sum + d.drop, 0)),
    minHpRatio: s.minHpRatio, maxAlive: s.maxAlive, simulation: stepStats(s.stepMs), render: stepStats(s.renderMs), over50ms: [...s.stepMs, ...s.renderMs].filter(v => v > 50).length, slow: s.slow,
    drawCalls: s.samples.map(x => ({ label: x.label, roomId: x.roomId ?? null, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms, view: x.view, ringView: x.ringView })) };
  // 스텝별 ms 배열은 통계만 남기고 버린다(관측 행은 파일로 뺀다). 느린 스텝 목록(slow)은 자르지 않는다.
  delete s.stepMs; delete s.renderMs;
  (report.reportItems.absolute50ms ??= []).push({ tag: row.tag, runOver50: row.metrics.over50ms, steps: s.steps, note: '보고 항목(판정 아님). 기준선 대비 증가는 astral-deep-compare 가 판정한다.' });
  recordRun(row, s, { clean });
  if (!routeDef) {
    row.baseline = { skipped: row.deep.skipped, elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops, frames: { simulation: row.metrics.simulation, render: row.metrics.render }, drawCalls: row.metrics.drawCalls };
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
/** choice·ring·screens 는 성좌·고리 정의가 있는 후보에서만 돈다. 정의가 없는 기준선이면 출격하기 전에 건너뛴다. */
const skipUnlessJudged = () => (judgedProfiles ? null : { skipped: '성좌·고리 정의(ROUTE_OBJECTIVES.astral_deep)가 있는 빌드에서만 도는 프로필이다' });
const nearest = (list, p) => list.reduce((best, item) => (!best || Math.hypot(item.x - p.x, item.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? item : best), null);

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
  async choice() {
    const why = skipUnlessJudged();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('choice');
    const setup = row.begin.setup, sg = setup.gates[0], answerPad = sg.pads.find(p => p.id === routeDef.gates[0].answer);
    qaAssert(sg && answerPad, 'gate 0 setup is not readable from the page');
    // 1) AUTO 로 1번 성좌(방 3)가 ready 가 될 때까지(적과 증원 처치). 읽기는 그 다음 스텝부터라 아직 시작 전이다.
    const ready = await advance(row, { type: 'gateReady', index: 0 }, { max: 60 * 60 * 15 });
    check('choice: AUTO 로 1번 성좌(방 ' + routeDef.gates[0].roomId + ') ready 까지', ready.reason === 'stop', { reason: ready.reason, elapsed: ready.elapsed });
    qaAssert(ready.reason === 'stop', 'First constellation never became ready: ' + ready.reason);
    // 2) AUTO 를 실제 버튼으로 끈다. 여기부터 ch-correct 까지 매 스텝을 관측한다.
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    await setDense(true);
    await mark('ch-manual');
    row.manualState = await freeze();
    // 3) 키보드로 모래시계 근처에 서서 단서를 읽는다(select 가 될 때까지).
    row.walkRead = await walkTo(row, { x: sg.x, z: sg.z }, { type: 'phase', name: 'select' });
    await mark('ch-read1');
    row.readState = await freeze();
    // 4) 오답 판(답이 아닌 판 중 영웅에서 가까운 것)에 서서 1초 + 다음 프레임 → mistakes +1.
    const wrongPad = nearest(sg.pads.filter(p => p.id !== answerPad.id), row.readState);
    row.wrongPad = wrongPad.id;
    row.walkWrong = await walkTo(row, { x: wrongPad.x, z: wrongPad.z }, { type: 'mistakes', min: row.readState.mi + 1 });
    await mark('ch-wrong');
    row.wrongState = await freeze();
    // 5) 판 밖(모래시계 중심)으로 나와 다시 읽는다(retry → read → select).
    row.walkReread = await walkTo(row, { x: sg.x, z: sg.z }, { type: 'phase', name: 'select' });
    await mark('ch-reread');
    row.rereadState = await freeze();
    // 6) 정답 판에 서서 1초 + 다음 프레임 → progress 1(방 정화).
    row.walkCorrect = await walkTo(row, { x: answerPad.x, z: answerPad.z }, { type: 'progress', n: 1 });
    await mark('ch-correct');
    row.correctState = await freeze();
    await setDense(false);
    // 7) AUTO 를 켜 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row);
    const analysis = analyzeChoice(traces.get(row.tag), routeDef, setup);
    row.choice = analysis;
    check('choice: 키보드 구간(AUTO 꺼짐·공격 입력/동작 없음·생존)', analysis.keyboard?.ok, analysis.keyboard);
    check('choice: 1번 성좌가 준비된 순간(진행 0, ready, 미정화)에 AUTO 를 끔', analysis.start?.ok, analysis.start);
    check('choice: 모래시계 8m 안에서 단서를 읽어 select(revealed, read ≥ 1)', analysis.read?.ok, analysis.read);
    check('choice: 오답 판 1초 + 다음 프레임 → mistakes +1 · phase retry · 진행 불변 · 읽기/유지 0', analysis.wrong?.ok, analysis.wrong);
    check('choice: 읽기부터 정답 확정까지 player.hurt 호출 0(오답은 피해 없음)', analysis.hurts?.ok, analysis.hurts);
    check('choice: 판 밖에서 retry 후 읽기가 0 에서 새로 시작해 select 로 돌아옴', analysis.retry?.ok, analysis.retry);
    check('choice: 정답 판 확정 → progress 1 · 1번 성좌 attuned · 방 정화 · 오답 1회', analysis.correct?.ok, analysis.correct);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async ring() {
    const why = skipUnlessJudged();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('ring');
    const setup = row.begin.setup, rs = setup.ring;
    qaAssert(rs && Number.isFinite(rs.cx) && Number.isFinite(rs.minX), 'ring setup is not readable from the page');
    // 1) AUTO 로 고리가 open 이 되는 스텝까지(열리는 스텝에는 시간이 흐르지 않는다).
    const opened = await advance(row, { type: 'ringOpen' }, { max: 60 * 60 * 15 });
    check('ring: AUTO 로 고리 open 까지', opened.reason === 'stop', { reason: opened.reason, elapsed: opened.elapsed });
    qaAssert(opened.reason === 'stop', 'Ring never opened: ' + opened.reason);
    // 2) AUTO 를 실제 버튼으로 끈다. 여기부터 rg-auto 까지 매 스텝을 관측한다.
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    await setDense(true);
    await mark('rg-manual');
    row.openState = await freeze();
    // 3) 방 사각형 밖이면 3초 기다린다(running 이 아니어야 한다). 열린 순간 이미 방 안이면 그 사실을 남기고 다음 스텝에 running 인지로 대신한다(판정이 mode 에 어느 쪽인지 적는다).
    row.insideAtOpen = inRoom(setup, row.openState.x, row.openState.z);
    if (row.insideAtOpen) await advanceSteps(row, 1); else await advanceSteps(row, RING_RUN.waitSteps);
    await mark('rg-wait-end');
    // 4) 키보드로 진입. 진입 첫 스텝에 running 이 되면 멈춘다.
    if (!row.insideAtOpen) row.walkIn = await walkTo(row, { room: rs.roomId }, { type: 'ringRunning' });
    await mark('rg-started');
    row.startState = await freeze();
    qaAssert(row.startState.rg?.ph === PHASE_CODE.running, 'Ring did not start after entering the room');
    const s0 = row.startState.rg.sh;
    // 5) 중심(core) 안에 서서 집결이 터질 때마다 피해 1회(같은 cycle 두 번 없음) → 두 cycle 관측.
    row.walkCenter = await walkTo(row, { x: rs.cx, z: rs.cz }, { type: 'nearOrHits', x: rs.cx, z: rs.cz, r: RING_RUN.centerNear, min: s0 + 1 });
    if ((await freeze()).rg.sh < s0 + 1) {
      const hit = await advance(row, { type: 'ringHits', min: s0 + 1 }, { max: 60 * 10 });
      check('ring: 중심 core 안에서 집결 터짐에 파편 피격 +1', hit.reason === 'stop', { reason: hit.reason });
      qaAssert(hit.reason === 'stop', 'First shard hit never happened: ' + hit.reason);
    }
    await mark('sh1');
    const end1 = await advance(row, { type: 'shard', state: 'calm' }, { max: 60 * 3 });
    qaAssert(end1.reason === 'stop', 'First burst never ended: ' + end1.reason);
    await mark('sh1-end');
    const hit2 = await advance(row, { type: 'ringHits', min: s0 + 2 }, { max: 60 * 8 });
    check('ring: 다음 cycle 에 파편 피격 +1(같은 cycle 두 번 없음)', hit2.reason === 'stop', { reason: hit2.reason });
    qaAssert(hit2.reason === 'stop', 'Second shard hit never happened: ' + hit2.reason);
    await mark('sh2');
    const end2 = await advance(row, { type: 'shard', state: 'calm' }, { max: 60 * 3 });
    qaAssert(end2.reason === 'stop', 'Second burst never ended: ' + end2.reason);
    await mark('sh2-end');
    // 6) 가장 가까운 성표 하나를 정화한다(성표는 core 밖, 순서 자유).
    const hero = await freeze();
    const target = nearest(rs.marks, hero);
    row.markIndex = rs.marks.indexOf(target);
    row.walkMark = await walkTo(row, target, { type: 'ringPurified', min: 1 });
    await mark('pu1');
    row.purifyState = await freeze();
    // 7) 정화한 성표에서 접선 방향으로 떨어진 안전한 점(성표 밖 · core 밖)에서 제한 시간이 바닥나기를 기다린다 → 붕괴 1회.
    const vx = target.x - rs.cx, vz = target.z - rs.cz, len = Math.hypot(vx, vz) || 1;
    const safe = { x: target.x - vz / len * RING_RUN.tangent, z: target.z + vx / len * RING_RUN.tangent };
    row.safePoint = safe;
    const budget = Number.isFinite(row.purifyState.rg?.lf) ? Math.ceil((row.purifyState.rg.lf + 10) * 60) : 60 * 40;
    row.walkSafe = await walkTo(row, safe, { type: 'ringCollapses', min: 1 }, { maxSteps: budget });
    await mark('collapse');
    row.collapseState = await freeze();
    // 8) AUTO 를 켜 4/4 · 봉인 해제 · 완주.
    await mark('rg-auto');
    await setAuto(true); keyboardMode = false;
    await setDense(false);
    await playToEnd(row, { clean: false });
    const analysis = analyzeRingManual(traces.get(row.tag), routeDef, setup, { minWait: 2.5 });
    row.ringManual = analysis;
    check('ring: 키보드 구간(AUTO 꺼짐·공격 입력/동작 없음·생존)', analysis.keyboard?.ok, analysis.keyboard);
    check('ring: ' + (row.insideAtOpen ? '열림 순간 이미 방 안(inside-at-open): 열린 다음 스텝에 running · limit 20' : '방 밖 3초 대기 중 running 아님(대기 ' + (analysis.start?.seconds ?? '?') + '초) · 진입 첫 스텝 running · limit 20'), analysis.start?.ok, analysis.start);
    check('ring: 중심 core 에서 집결 터짐마다 피해 1회, 다음 cycle 에 다시 1회(넘긴 값 .06)', analysis.hits?.ok, analysis.hits);
    check('ring: 성표 하나 정화(purified 1, 붕괴 0, 0 에서 시작한 1초 유지)', analysis.purify?.ok, analysis.purify);
    check('ring: 성표 밖 · core 밖에서 제한 시간 초과 붕괴 1회(넘긴 값 .06, purified 0, 모든 성표 done false, left = limit)', analysis.collapse?.ok, analysis.collapse);
    check('ring: AUTO 가 이어받아 4/4 · 고리 완료 · world.sealed 해제 · 붕괴는 끝까지 1회', analysis.final?.ok, analysis.final);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async screens() {
    const why = skipUnlessJudged();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('screens');
    const setup = row.begin.setup;
    row.shots = [];
    const grab = async label => {
      const capture = await freeze();
      const look = checkScreenMoment({ capture }, routeDef, label, setup);
      const files = await captureScreens(label + '-' + row.tag, { label, capture, look });
      row.shots.push({ label, reached: true, files: files.map(f => f.png), stateFiles: files.map(f => f.json), elapsed: ms(capture.elapsed), capture, look });
    };
    const miss = label => row.shots.push({ label, reached: false });
    // 1) 단서 읽기(read) · 판 선택(select): AUTO 로 진행하다 route.phase 가 그 단계가 되는 첫 스텝.
    const pending = ['read', 'select'];
    while (pending.length) {
      const r = await advance(row, { type: 'moment', pending: [...pending] }, { max: 60 * 60 * 15 });
      if (r.reason !== 'stop' || !pending.includes(r.hit)) break;
      await grab(r.hit);
      pending.splice(pending.indexOf(r.hit), 1);
    }
    for (const label of pending) miss(label);
    // 2) 고리 열림(ringOpen): 영웅이 방 안이면 그 스텝 그대로, 밖이면 AUTO 를 끄고 키보드로 방 가장자리(1.2m 앞)까지 가서(아직 open) 캡처.
    const opened = await advance(row, { type: 'ringOpen' }, { max: 60 * 60 * 15 });
    if (opened.reason === 'stop' && setup.ring) {
      const f = await freeze();
      row.openedInside = inRoom(setup, f.x, f.z);
      if (row.openedInside) await grab('ringOpen');
      await setAuto(false);
      keyboardMode = true;
      row.focusKeyboard = await nativeGameplayFocus(page);
      if (!row.openedInside) {
        row.walkEdge = await walkTo(row, { room: setup.ring.roomId }, { type: 'nearRect', d: RING_RUN.edgeNear });
        await grab('ringOpen');
      }
      // 3) 집결 예고(warning) · 터짐(burst): 방 안 안전한 점(서쪽 문 안쪽 북서, core 밖 · 성표 밖)에 서서 기다린다.
      const safe = { x: setup.ring.cx - 4.5, z: setup.ring.cz - 4.5 };
      const wait = ['warning', 'burst'];
      while (wait.length) {
        const w = await walkTo(row, safe, { type: 'moment', pending: [...wait] }, { maxSteps: 60 * 30 });
        if (!wait.includes(w.hit)) break;
        await grab(w.hit);
        wait.splice(wait.indexOf(w.hit), 1);
      }
      for (const label of wait) miss(label);
      await setAuto(true); keyboardMode = false;
    } else for (const label of ['ringOpen', 'warning', 'burst']) miss(label);
    await playToEnd(row, { clean: false });
    const verdict = checkScreens(row.shots, [...MOMENTS], SCREEN_VIEWPORTS.length);
    check('screens: 모든 순간에 도달해 3개 화면 크기 PNG 와 상태 JSON 을 남김', verdict.ok, verdict.rows);
    row.screensCheck = verdict;
    for (const label of MOMENTS) {
      const s = row.shots.find(x => x.label === label);
      if (!s?.reached) continue;
      // PNG 마다 그 순간 route 상태(관측 필드)를 함께 기록한다. 관측 필드 누락은 실패다.
      s.pngStates = s.files.map((file, i) => ({ file, state: s.stateFiles[i], elapsed: s.capture.elapsed, look: s.look }));
      check('screens: ' + label + ' 순간의 route 상태(관측 필드 누락 없음)', s.look.ok, s.look);
    }
    row.resultShots = await captureScreens('result-' + row.tag, { label: 'result', routeObjective: row.result?.routeObjective ?? null, resultLines: row.resultLines, resultText: row.resultText });
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
      // 실패 표본의 원인을 남긴다: 성좌·고리 상태, 최근 관측 행, 목표창, 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__astralDeepQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.() ?? null, recentRows: q?.rows?.slice(-30) ?? null, hpDrops: q?.hpDrops?.slice(-20) ?? null, toasts: q?.toasts?.slice(-20) ?? null,
          objective: document.getElementById('objective')?.textContent ?? null, curRoom: b.curRoom?.id ?? null, sealed: !!b.world.sealed, alive,
          auto: !!b.player?.auto, playerState: b.player?.state ?? null, inputKeys: { ...a.input.keys }, inputEnabled: !!a.input.enabled };
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
  report.load.end = loadNow();
  report.finished = new Date().toISOString(); await qa.save();
}
console.log(JSON.stringify({ status: report.status, out: qa.out, depth, deepDefinition: !!routeDef, reseed: report.reseed, load: report.load, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
