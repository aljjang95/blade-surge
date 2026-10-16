#!/usr/bin/env node
// 잿불금고 심층(ember_vault deep) 냉각 밸브 3곳·밀물 창·키 입력 실제 UI QA 도구 (BUNDLE-10 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 밸브 개방 전 과정을 app.step 한 번마다 관측한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 읽기 경로: app.battle.routeObjectives (progress/hold/gates[i].{room,ready,attuned,phase,shocks,pad,hits,age}/padOpen(gate)/def/view.{entries[i].{root,vent,pad,labelState},group}),
// gates[i].room.{id,x,z,type,cleared,discovered,forgeWave}, app.battle.world.{sealed,rooms,roomAt,linkPending}, app.battle.{enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, paused},
// 목표창 #objective textContent(같은 상태가 0.6초 이어진 뒤 표본), 결과 화면 .exp-result-shell innerText·p[aria-label] 와 app.expeditionUI.result.routeObjective, app.ui.toast 호출(감싸개로 기록만),
// app.input.keys(keys 프로필), app.renderer.r.info.render.calls(방 첫 진입 draw call 표본, renderer.render() 단독 호출).
// 뷰 같은 프레임 A/B(보고 항목): 밸브 모습이 바뀐 스텝 끝에서 같은 프레임을 route.view.group 표시/숨김으로 renderer.render() 해 calls 차이를 잰다(시뮬레이션 스텝 없음, 끝나면 visible 복원).
// 경로 정의(ROUTE_OBJECTIVES.ember_deep)가 없는 기준선 빌드(--project, 예: 79883ad)에서는 밸브 판정을 건너뛰고 공통 측정만 남긴다. keys 프로필은 기준선에서도 돌고 이동 여부만 report.baselineKeys 에 기록한다.
// BUNDLE-14: 사슬 집행자 후방 노출(ROUTE_OBJECTIVES.ember_deep.rear)이 있는 후보 빌드는 보스방 진입 뒤 스텝마다 app.battle.routeObjectives.rear(state/windowLeft/windows/rearHits/frontHits/sideHits/broken)와
// rear.boss(pos/yaw/state/special/attackSequence/completedAttackSequence/atkCd/alive/vel), 부채꼴·갑주 호 메시(이름 TLL_EmberRearWedge·TLL_EmberRearGuard 의 visible·색), #objective 문구, 토스트, 결과 routeObjective.rear 를 관측한다.
// rear.filter(dmg, attacker) 는 (입력 피해, 출력, 그 순간 state, 보스 yaw·위치, attacker.pos, 도구가 직접 읽은 영웅 위치, 도구가 보스 − 영웅 위치로 계산한 구분)를 기록만 하는 감싸개로 둔다(동작을 바꾸지 않는다). 후방 정의가 없는 기준선(8e89a51 밸브만, 79883ad 정의 없음)은 후방 판정을 건너뛰고 문구 누출만 관찰한다.
// 판정 함수는 tools/ember-tide-checks.mjs 에 있고 test/ember-tide-checks.test.ts 가 합격·불합격 입력을 모두 검사한다. 기준선 비교는 tools/ember-tide-compare.mjs 다(한 짝씩).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { MOMENTS, REAR, REAR_MOMENTS, TIDE, analyzeOrder, analyzePauseCooling, analyzeRear, analyzeTide, checkKeys, checkPause, checkRearLeak, checkRearManual, checkRearMoment, checkRearPause, checkScreenMoment, checkScreens,
  describeBaselineKeys, stepStats } from './ember-tide-checks.mjs';

const HELP = [
  '사용법: node tools/ember-tide-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션 (잿불금고 심층 카드만: 일반 잿불금고에는 이 정의가 없다)',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '                           기준선 판별(정의의 하위 항목이 없는지로 정함): ROUTE_OBJECTIVES.ember_deep.rear 가 없는 빌드(8e89a51: 밸브 정의만 있음)는 후방 판정을 건너뛰고 기존 밸브 판정과 공통 측정을 그대로 한다.',
  '                           ember_deep 정의 자체가 없는 B10 기준선(79883ad)은 밸브 판정도 건너뛰고 공통 측정만 남긴다(order·pause·screens 는 건너뜀). 어느 기준선이든 후방 문구·토스트 누출만 관찰해 판정한다.',
  '  --profile=<목록>          auto|order|pause|keys|screens|rear|all (쉼표로 여러 개, 기본 auto). order·pause·screens·rear 는 밀물 창이 있는 정의(후보)에서만 돌고, rear 는 rear 정의가 있는 후보에서만 돈다. keys 는 기준선에서도 돈다.',
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
  '           + 밸브 판정: 개방 방 순서 [2,3,4]·직전 연속 유지(게임 시각 길이·조작판 반경 안·표본 전부 padOpen)·적/대기열 0·정예방 증원 1회 뒤 준비·닫힌 조작판 대기 표본·순서 대기·밀물 주기(경고 1.4 · 밀물 0.8 · 물 빠짐 4)·',
  '             밀물 띠 피해(분출당 1회, 띠 안)·봉인 해제(3/3 과 모든 구역 뒤)·결과 보고/결과 줄/줄 요소·목표창 밀물 문구(닫힘·열림)·토스트·밸브 뷰(띠 색 파랑, 라벨 밀물 대기)',
  '           + 보고 항목: 밸브 방 첫 진입 draw call, 경로 목표 뷰 표시/숨김 같은 프레임 A/B calls 차이, 50ms 초과 집계, 실행 전후 1분 load',
  '           + 후방 판정(rear 정의가 있는 후보, 모든 프로필의 완주에 적용; 관측이 빠지면 실패): 보스 등장 뒤 부착(armored)·부착 토스트 정확히 1회 · 용재 망치(kiln_hammer)의 completedAttackSequence 가 처음 쓰인 스텝(또는 다음 스텝)에만 exposed ·',
  '             다른 시그니처 뒤·지연 열림·같은 망치 두 번 없음 · 열림 토스트 창마다 1회(정의 window 로 만든 문구) · 창 길이 = window ± 1/60(보스 처치로 끝난 마지막 창만 면제하고 기록)·windowLeft 시계 · 창 안 보스 yaw 불변·새 공격 0·chase 속도 0(이동은 보고) ·',
  '             피해 배율(창 안 attacker 있는 타격 = 입력 × rear|front|1(구분 = 도구가 보스 − 영웅 위치로 계산), attacker 없는 호출·창 밖 = 1배이고 세지 않음, 집계 = 컨트롤러 rearHits·frontHits·sideHits와 구분별 수 일치) · 독립 대조(attacker 위치 = 그 순간 영웅 위치 1e-6, 영웅 위치 구분 = 배율에서 읽은 구분) · 부채꼴(TLL_EmberRearWedge 0x5ff0d0)·갑주 호(TLL_EmberRearGuard 0xd8a070)는 exposed 에서만 보임 ·',
  '             목표창 제목 "사슬 집행자 후방"·armored/exposed 문구(남은 시간 0.1초 올림) · 결과 routeObjective.rear = 마지막 관측값, 결과 줄 "사슬 집행자 후방 공격 n회 · 노출 n번 · 정면 막힘 n회" · AUTO 후방(auto 계열: 창 ≥ 1, 등 뒤 타격이 있는 창 ≥ 1, rearHits > frontHits)',
  '  order    AUTO 로 1번 밸브(방 2) ready·적 0 까지 → R #btn-auto 끔 → R 키보드(KeyW/A/S/D)로 닫힌 조작판 위 체류(유지 0) → 첫 밀물이 지나가 옮겨 간 열린 조작판으로 → 유지 ≥ 1.0 뒤 3.0 밖으로 이탈(유지 0) →',
  '           다음 밀물 경고에 현재 조작판으로 들어가 밀물이 지나가는 동안 다시 체류(닫힌 체류 합계 ≥ 2초) → 옮겨 간 열린 조작판에서 새 2초로 개방 → R AUTO 켬 → 완주. 공격 키 없음',
  '  pause    열린 유지 hold ≥ 0.8 에서 R #btn-pause → 120스텝+1초 게임 시간 불변·hold 0 → R #btn-resume → 새 유지 ≥ 2초 뒤 개방 → 완주',
  '  keys     AUTO 로 첫 밸브 방 정화(후보 ready·적 0) → R #btn-auto 끔 → R 키보드 KeyD 를 누른 채 30스텝 이동 → R #btn-pause → 60스텝+0.5초 → R #btn-resume → 키를 다시 누르지 않고 30스텝:',
  '           영웅 x 가 0.5 이상 늘고 app.input.keys.KeyD true → keyup 뒤 30스텝 안에 멈춤 · KeyD false → R AUTO 켬 → 완주. 키 이벤트 로그가 정지~재개 구간에 비어 있어야 통과(재입력 우회 금지). 기준선은 같은 단계를 돌려 이동 여부만 기록',
  '  screens  닫힌 조작판(밀물 대기)·밀물 경고·밀물·열린 조작판·개방 직후 순간마다 640x360, 844x390, 390x844 PNG + 결과 PNG, PNG 마다 그 순간 gate 상태 기록(캡처 대기 90초)',
  '           + 후방 정의가 있는 후보는 순간 2개 더: rear-armored(보스 등장 뒤 armored, 목표창 armored 문구, 부채꼴·갑주 호 숨김)·rear-exposed(exposed 이고 windowLeft ≤ window − 0.5, 부채꼴·갑주 호 보임)',
  '  rear     (후보만) AUTO 로 보스방까지(밸브 3/3·봉인 해제·보스 등장) → 첫 창이 열리면 R #btn-auto 끔 → R 키보드(KeyW/A/S/D 이동 + KeyJ 공격)로 보스 정면 쪽에 서서 정면 타격 ≥ 1 → 옆으로 돌아 등 뒤에서 등 뒤 타격 ≥ 1',
  '           (창이 부족하면 R #btn-auto 로 AUTO 를 켜 다음 창을 기다렸다 이어서) → 창 안에서 R #btn-pause → 60스텝 + 0.5초 동안 windowLeft·보스 yaw·attackSequence 불변 → R #btn-resume → R AUTO 켬 → 완주.',
  '           정면·등 뒤 타격의 filter 기록은 attacker 가 있고 도구가 영웅 위치로 계산한 구분이 front·rear 이며 배율이 정의의 front·rear 인지 판정한다. 좌표 이동·무적·HP 주입 없음(키보드 구간의 순간이동도 검사). 키보드 이동은 order·keys 와 같은 방식이다',
  '',
  '주의: 좌표 이동·무적·HP 주입·적 hp 조작으로 정상 플레이를 증명하지 않는다. viewport 검사는 실제 Android/GPU/터치/발열 검증이 아니다.',
  'SwiftShader 소프트웨어 렌더라 프레임 ms 는 JS 측 측정값이다. order·keys 의 키보드 입력은 Playwright 가 보낸 에뮬레이터 키 이벤트다.',
].join('\n');
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const arg = (name, fallback) => qaArgument(name) ?? fallback;
// 값 없는 플래그(--quality, --motion)도 받는다.
const flag = (name, bare, fallback) => qaArgument(name) ?? (process.argv.includes('--' + name) ? bare : fallback);
/** 실행 환경 부하 기록: /proc/loadavg 1·5·15분 평균(없으면 null). */
const loadNow = () => { try { const [a, b, c] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number); return { avg1: a, avg5: b, avg15: c, at: new Date().toISOString() }; } catch { return null; } };
const loadStart = loadNow();
const projectRoot = path.resolve(arg('project', path.resolve(import.meta.dirname, '..')));
const PROFILES = ['auto', 'order', 'pause', 'keys', 'screens', 'rear'];
const profileArg = arg('profile', 'auto');
const selected = profileArg === 'all' ? [...PROFILES] : profileArg.split(',');
qaAssert(selected.every(name => PROFILES.includes(name)), '--profile must be one of ' + PROFILES.join('|') + '|all');
qaAssert(arg('depth', 'deep') === 'deep', '--depth must be deep (잿불금고 일반에는 냉각 밸브 정의가 없다)');
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
const DUNGEON_ID = 'ember_vault';
/** order 프로필: 조작판에 닿았다고 보는 반경 1.2, 조작판에서 밖으로 나갈 거리 3.0(정지 판정은 여유 .2), 닫힌 체류 합계 하한(스텝 양자화 여유 포함 2.1초), 열린 유지 하한 1.0, 체류 반복 상한. */
const ORDER = Object.freeze({ padNear: 1.2, exitDistance: 3.2, minPartialHold: 1.0, minDwell: 2.1, centerNear: 1.2, maxDwellLoops: 3 });
/** keys 프로필(PLAN 3.3): 단계별 스텝 수, 정지 중 추가 스텝, 키를 누를 위치(첫 밸브 방 중심에서 서쪽으로), 전체 이동 하한. */
const KEYS = Object.freeze({ steps: 30, pauseSteps: 60, pauseWaitMs: 500, startOffset: 6, startNear: 1.2, key: 'KeyD' });
/** rear 프로필: 공격 키(src/engine/input.js: KeyJ 또는 Space, 누르는 순간 press('attack')), 한 번에 진행하는 스텝, 정지 중 추가 스텝, 시도 상한, 창 안 정지 전 남은 시간 하한. */
const REAR_RUN = Object.freeze({ attackKey: 'KeyJ', chunk: 4, pauseSteps: 60, pauseWaitMs: 500, resumeSteps: 6, maxIterations: 240, maxCycles: 14, pauseMinLeft: 1.0 });

// 대상 프로젝트의 데이터를 그 경로에서 읽는다(기준선 빌드와 후보 빌드가 각자의 데이터를 쓴다). 접근·에너지·증원 횟수를 이 파일에 박지 않는다.
const load = async file => import(pathToFileURL(path.join(projectRoot, file)).href);
const { EXPEDITION_DEPTHS } = await load('src/data/expedition-depths.js');
const { EXPEDITION_ITEMS } = await load('src/data/expedition-items.js');
const { ENERGY } = await load('src/data/shop.js');
const { HEROES } = await load('src/data/heroes.js');
qaAssert(HEROES[heroId], 'Unknown --hero ' + heroId);
const dungeonDef = EXPEDITION_DEPTHS.find(d => d.id === DUNGEON_ID);
qaAssert(dungeonDef, 'Target project has no ' + DUNGEON_ID + ' deep definition');
// 밸브 정의. 기준선(79883ad)에는 ember_deep 이 없어 null 이고 밸브 판정을 건너뛴다.
const routeData = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES ?? {};
const routeDef = routeData.ember_deep ?? null;
const valveRooms = routeDef ? routeDef.gates.map(g => g.roomId) : null;
// 사슬 집행자 후방 정의. 8e89a51(밸브 정의만)과 79883ad(정의 없음)에는 없어 null 이고 후방 판정을 건너뛴다. 정의의 하위 항목(rear)이 있는지로만 후보와 기준선을 가른다.
const rearDef = routeDef?.rear ?? null;
const firstValveRoom = routeDef ? routeDef.gates[0].roomId : TIDE.rooms[0];
const judgedProfiles = !!routeDef?.shockWindow;
const needsKeyboard = selected.includes('order') || selected.includes('keys') || selected.includes('rear');

const STEP_CLASS = {
  auto: [['F', '저장 주입(해금·영웅 Lv.50 별3 스킬5·장비·에너지·AUTO)'], ['R', '출격 카드 버튼 · #btn-auto'], ['C', 'app.testPause + 고정 1/60 app.step 으로 완주'],
    ['C', 'app.step 한 번마다 page.evaluate 한 번에 관측(읽기 전용, 상태 변화·유지 중·닫힌 대기·1초 간격 행)'], ['C', 'renderer.render() 단독 호출로 방 첫 진입 draw call 표본'], ['R', '결과 화면 DOM · 로비 버튼 · 새로고침']],
  order: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 1번 밸브 ready·적 0 까지 고정 스텝'],
    ['R', '키보드 KeyW/A/S/D 로 조작판 이동·닫힌 체류·열린 유지·이탈·재진입(공격 키 없음)'], ['C', '키 입력 사이 4스텝씩 고정 진행(키보드 구간은 매 스텝 관측)'], ['C', 'AUTO 완주 · 결과 판정']],
  pause: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 열린 유지 hold ≥ 0.8 까지 고정 스텝'], ['C', '정지 중 app.step 120회(stepRaw)로 게임 시간·밀물 주기 불변 확인'], ['C', 'AUTO 완주']],
  keys: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 첫 밸브 방 정화(후보: ready·적 0)까지 고정 스텝'], ['R', '키보드 KeyW/A/S/D 로 방 서쪽으로 이동(키를 누르는 위치 잡기)'],
    ['R', '키보드 KeyD 를 누른 채(down 1회) · 정지 · 재개 · 키 이벤트 없이 관측 · keyup 1회'], ['C', '단계마다 고정 30스텝(정지 중 stepRaw 60회) 관측'], ['C', 'AUTO 완주']],
  screens: [['F', '저장 주입'], ['R', '출격 카드 버튼'], ['C', 'AUTO 로 닫힘·경고·밀물·열림·개방 직후 순간까지 고정 스텝'], ['C', 'renderer.render() 단독 호출 + viewport 3종 스크린샷(시뮬레이션 tick 없음)']],
  rear: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 보스방(밸브 3/3·봉인 해제·보스 등장)까지, 첫 후방 창이 열린 스텝까지 고정 스텝'],
    ['R', '키보드 KeyW/A/S/D 로 보스 정면 쪽·옆·등 뒤로 걷고 KeyJ 로 공격(좌표 이동·무적·HP 주입 없음)'], ['C', '키 입력 사이 4스텝씩 고정 진행(보스방은 매 스텝 관측), rear.filter 감싸개는 호출을 그대로 넘기고 기록만'],
    ['C', '창 안 정지 중 app.step 60회(stepRaw)로 windowLeft·보스 yaw 불변 확인'], ['C', 'AUTO 완주 · 후방 판정']],
};
/** 경로 뷰가 있는 빌드에서 모든 프로필의 프로브가 하는 제어 렌더. */
const VIEW_AB_STEP = ['C', '뷰 같은 프레임 A/B: 모습이 바뀐 스텝 끝에서 route.view.group visible 을 바꿔 renderer.render() 여러 번(시뮬레이션 스텝 없음, 끝나면 visible 복원)'];
for (const list of Object.values(STEP_CLASS)) list.push(VIEW_AB_STEP);
const report = { kind: 'ember-tide-qa', releaseApproved: false, seed, heroId, depth, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'ember-tide-checks.mjs'))), profiles: {}, checks: [], reportItems: {},
  reseed: { on: reseedOn, elapsed: null }, load: { start: loadStart, waitedMs: 0, end: null, waitLoad }, routeDefinition: routeDef ? JSON.parse(JSON.stringify(routeDef)) : null, valveRooms,
  rearDefinition: rearDef ? JSON.parse(JSON.stringify(rearDef)) : null,
  catalog: { id: dungeonDef.id, depth, energy: dungeonDef.energy, minLevel: dungeonDef.minLevel, unlockCode: dungeonDef.unlockCode ?? null, rewards: dungeonDef.rewards,
    firstRewards: dungeonDef.firstRewards ?? null, objective: dungeonDef.objective ?? null, tactic: dungeonDef.tactic ?? null, mechanics: dungeonDef.mechanics ?? null, routeId: routeDef?.id ?? null },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^심층 원정/', '[data-dungeon="' + DUNGEON_ID + '"][data-depth="deep"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창 textContent, 같은 상태 0.6초 뒤 표본)'],
    result: ['.exp-result-shell (결과 줄 innerText, "<제목> n/n · 완료")', '.exp-result-shell p[aria-label] (기존 일반 줄 aria-label "냉각 밸브 개방 결과")', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives (progress/hold/gates[i].room/ready/attuned/phase/shocks/hits/pad/age/padOpen/def/view.entries[i].{root,vent,pad,labelState}/view.group)',
      'window.app.battle.world (sealed/rooms/roomAt/linkPending)', 'window.app.battle (enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, player.pos/hp/auto/state)',
      'window.app.input.attackHeld', 'window.app.input.keys / enabled', 'window.app.ui.toast (호출 기록 감싸개)', 'window.app.renderer.r.info.render.calls',
      'window.app.battle.routeObjectives.rear (state/windowLeft/windowTotal/windows/rearHits/frontHits/sideHits/rearDamage/frontDamage/broken/lastSide/boss, filter 감싸개)', 'window.app.battle.routeObjectives.rearView (존재 여부)',
      'scene.getObjectByName TLL_EmberRearWedge/TLL_EmberRearGuard (visible 조상 포함, material.color)', 'window.app.expeditionUI.result.routeObjective.rear',
      'window.__qaReseed (init script)', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨·기본 원정 승리)·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)와 window.__qaReseed(seed) 재시드(전투 활성·prepareView 뒤 첫 스텝 전 1회)',
      quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → 심층 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      needsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): order 의 걷는 방향은 도구가 조작판 위치의 화면 투영으로 정함(게임 입력층이 지운 키는 다시 누름). keys 의 KeyD 는 down 1회·정지·재개 사이 키 이벤트 없음·up 1회. 텔레포트·무적·HP 주입 없음. order·keys 는 공격 키 없음, rear 는 KeyJ 공격(정면·등 뒤 타격)' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)',
      '뷰 같은 프레임 A/B: route.view.group 의 visible 을 바꿔 같은 프레임을 renderer.render() 로 각각 그려 calls 차이 측정(끝나면 visible 복원)', 'app.ui.toast 감싸개(호출을 그대로 넘기고 기록만)',
      'rear.filter(dmg, attacker) 감싸개(입력·출력·그 순간 state·보스 yaw·위치·attacker.pos·app.battle.player.pos·도구가 계산한 구분을 기록만 하고 반환값을 바꾸지 않음)'],
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각', '밀물 띠·조작판·후방 부채꼴의 실제 모습(PNG 는 사람이 본다)'],
    steps: Object.fromEntries(selected.map(name => [name, STEP_CLASS[name].map(([kind, detail]) => ({ kind, detail }))])) },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/route-objectives.js', 'src/game/cooling-valves.js', 'src/game/cooling-valve-view.js', 'src/game/ember-rear-exposure.js', 'src/game/ember-rear-view.js', 'src/data/route-objectives.js', 'src/data/expedition-depths.js', 'src/data/expansion.js',
  'src/data/stages.js', 'src/ui/battle-objective-view.js', 'src/ui/battle-readability.js', 'src/expansion/hub.jsx', 'src/game/battle-base.js', 'src/game/world.js', 'src/engine/input.js',
  'src/game/expedition-combat.js', 'src/game/enemies.js', 'src/game/player.js', 'src/game/expedition-economy.js', 'src/main.js'].filter(file => fs.existsSync(path.join(projectRoot, file)));
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
  const P = window.__tideQa = { dt: 1 / 60, steps: 0, cfg, dense: false, labels: [], keyRows: {}, momentHit: null, toasts: [] };
  const routeOf = () => app.battle.routeObjectives;
  const EMPTY = [];
  const PHASE = { heat: 0, warning: 1, vent: 2 };
  const G0 = 8, K = 19;   // sig 앞 칸 수, 밸브마다 칸 수
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const labelIdx = text => {
    if (typeof text !== 'string') return -1;
    let i = P.labels.indexOf(text);
    if (i < 0) { i = P.labels.length; P.labels.push(text); }
    return i;
  };
  // 토스트 기록: 호출을 그대로 넘기는 관측용 감싸개다(게임 판정에는 쓰지 않는다). 프로브를 다시 설치해도 한 번만 감싼다.
  const ui = app.ui;
  if (ui && !ui.__tideQaWrapped) {
    const original = ui.toast;
    ui.toast = function (...args) {
      const q = window.__tideQa;
      if (q?.toasts) q.toasts.push({ n: q.steps, t: app.battle?.elapsed ?? null, msg: String(args[0]), kind: args[1] ?? null });
      return original.apply(this, args);
    };
    ui.__tideQaWrapped = true;
  }
  // ---- 사슬 집행자 후방(BUNDLE-14): 보스방 진입 뒤 스텝마다 행을 남긴다. 게임 객체는 읽기만 하고, rear.filter 만 호출을 그대로 넘기는 감싸개로 기록한다(반환값을 바꾸지 않는다). ----
  const rearOf = () => routeOf()?.rear ?? null;
  const objectiveText = () => document.getElementById('objective')?.textContent ?? null;
  // 부채꼴·갑주 호 메시는 이름으로 찾아 캐시한다(없으면 매번 다시 찾는다 — 관측 누락은 판정이 실패로 센다). visible 은 조상까지 모두 보일 때만 1이다.
  const rv = { wedge: null, guard: null };
  const rvFind = key => (rv[key] ??= app.renderer.scene.getObjectByName(cfg.names[key]) ?? null);
  const viewState = key => {
    const o = rvFind(key);
    if (!o) return [-1, -1];
    let vis = 1;
    for (let n = o; n; n = n.parent) if (!n.visible) { vis = 0; break; }
    let m = o.material;
    if (!m) o.traverse(c => { if (!m && c.material) m = c.material; });
    if (Array.isArray(m)) m = m[0];
    const col = m?.color ?? m?.uniforms?.color?.value;
    return [vis, col?.getHex ? col.getHex() : -1];
  };
  const rearRow = () => {
    const r = rearOf();
    if (!r) return null;
    const b = app.battle, p = b.player, boss = r.boss ?? b.boss ?? P.rearBoss ?? null;
    if (boss) P.rearBoss = boss;
    const [wv, wc] = viewState('wedge'), [gv, gc] = viewState('guard');
    return { n: P.steps, t: b.elapsed, hx: p.pos.x, hz: p.pos.z, hp: p.hp, ha: p.alive ? 1 : 0, au: p.auto ? 1 : 0, ah: app.input.attackHeld ? 1 : 0, ps: p.state,
      rs: r.state, wl: r.windowLeft, wn: r.windows, rh: r.rearHits, fh: r.frontHits, sh: r.sideHits, rd: r.rearDamage, fd: r.frontDamage, br: r.broken, ls: r.lastSide,
      bo: boss ? 1 : 0, al: boss?.alive ? 1 : 0, spn: boss?.spawning ? 1 : 0, bs: boss?.state ?? null, sp: boss?.special ?? null, pk: boss?.signatures?.plan?.key ?? null,
      sq: boss?.attackSequence || 0, cq: boss?.completedAttackSequence || 0, ac: boss?.atkCd ?? null, by: boss?.yaw ?? null, bx: boss?.pos?.x ?? null, bz: boss?.pos?.z ?? null,
      bvx: boss?.vel?.x ?? null, bvz: boss?.vel?.z ?? null, wv, gv, wc, gc };
  };
  const wrapRearFilter = () => {
    const rear = rearOf();
    if (!rear || rear.__tideQaWrapped) return;
    const original = rear.filter;
    // 컨트롤러 계약: filter(dmg, attacker). 기록은 컨트롤러와 독립이다 — 영웅 위치는 app.battle.player.pos 를 직접 읽고, side 는 (보스 − 영웅) 방향과 보스 yaw 의 내적을
    // 정의(cfg.rear)의 rearDot·frontDot 로 직접 계산한다(컨트롤러의 sideOf 를 부르지 않는다). attacker.pos 가 없으면 ax/az/side 는 null 이다.
    rear.filter = function (dmg, attacker) {
      const state = this.state, boss = this.boss ?? null, yaw = boss?.yaw ?? null, bx = boss?.pos?.x ?? null, bz = boss?.pos?.z ?? null;
      const hero = app.battle?.player?.pos ?? null, hx = hero?.x ?? null, hz = hero?.z ?? null;
      const apos = attacker?.pos ?? null, ax = apos ? apos.x : null, az = apos ? apos.z : null;
      // 보스·영웅 위치를 읽지 못하면 side 는 null 로 남는다(판정이 관측 누락으로 실패시킨다).
      let side = null;
      if (apos && [bx, bz, hx, hz].every(Number.isFinite)) {
        side = 'side';
        const dx = bx - hx, dz = bz - hz, l = Math.hypot(dx, dz);
        if (l > 1e-9 && Number.isFinite(yaw)) {
          const dot = (dx / l) * Math.sin(yaw) + (dz / l) * Math.cos(yaw), def = P.cfg.rear;
          side = dot >= def.rearDot ? 'rear' : dot <= -def.frontDot ? 'front' : 'side';
        }
      }
      const out = original.call(this, dmg, attacker);
      const q = window.__tideQa;
      if (q?.rearFilters && q.rearFilters.length < 20000) q.rearFilters.push({ n: q.steps + 1, dmg, out, st: state, yaw, bx, bz, ax, az, hx, hz, side });
      return out;
    };
    rear.__tideQaWrapped = true;
  };
  /** 보스방 진입 뒤 스텝마다 후방 행을 남긴다(보스 처치 뒤 4행까지). 목표창 문구는 exposed 에서는 바뀐 스텝마다, armored 에서는 같은 상태가 36스텝(0.6초) 이어진 뒤 한 번 읽는다.
   * 후방 컨트롤러가 없는 빌드(기준선)도 보스방 목표창 문구를 30스텝마다 모아 누출 관찰에 쓴다. */
  const rearObserve = () => {
    const b = app.battle;
    if (!P.rearOn) { if (b.curRoom?.type === 'boss') P.rearOn = true; else return; }
    if (P.steps % 30 === 0 && P.rearDoms.length < 40) {
      const dom = objectiveText();
      if (typeof dom === 'string' && !P.rearDoms.includes(dom)) P.rearDoms.push(dom);
    }
    if (P.rearPost >= 5) return;
    const row = rearRow();
    if (!row) return;
    if (row.rs === 'exposed') {
      const dom = objectiveText();
      if (dom !== P.rearLastDom) { row.dom = dom; P.rearLastDom = dom; }
      P.rearStable = 0;
    } else {
      P.rearLastDom = null;
      if (row.rs === 'armored') { if (++P.rearStable === 36) row.dom = objectiveText(); } else P.rearStable = 0;
    }
    P.rearRows.push(row);
    if (row.bo === 1 && row.al === 0) P.rearDone = true;
    if (P.rearDone) P.rearPost++;
  };
  // ---- 뷰 같은 프레임 A/B: 밸브마다 모습 코드(0 hidden, 1 대기, 2 닫힘, 3 경고, 4 밀물, 5 열림, 6 개방됨)가 바뀐 스텝 끝에서 측정한다. 코드는 sig(관측값)로만 계산한다. ----
  const abChanged = () => {
    const r = routeOf(), s = P.sig;
    if (!r) return null;
    let changed = null;
    for (let i = 0; i < r.gates.length; i++) {
      const o = G0 + i * K;
      const code = s[o + 4] !== 1 ? 0 : s[o + 1] === 1 ? 6 : (i !== s[1] || s[o] !== 1) ? 1 : s[o + 7] === 1 ? 3 : s[o + 7] === 2 ? 4 : s[o + 9] === 1 ? 5 : 2;
      if (code !== P.abCodes[i]) { (changed ??= []).push(i); P.abCodes[i] = code; }
    }
    return changed;
  };
  /** 같은 프레임을 뷰 그룹 켠 채·끈 채 그린다(P.sample 과 같은 info.reset + renderer.render 경로, app.step 없음). visible 과 autoReset 은 반드시 복원한다. */
  P.measureView = changed => {
    const b = app.battle, r = routeOf(), vg = r.view?.group;
    const rec = { n: P.steps, t: b.elapsed, pr: r.progress, changed, codes: Array.from(P.abCodes), on: null, offView: null };
    if (!vg) return rec;
    const info = app.renderer.r.info, autoReset = info.autoReset, vgv = vg.visible;
    info.autoReset = false;
    try {
      vg.visible = true; info.reset(); app.renderer.render(); rec.on = info.render.calls;
      vg.visible = false; info.reset(); app.renderer.render(); rec.offView = info.render.calls;
    } finally { vg.visible = vgv; info.autoReset = autoReset; }
    return rec;
  };
  // ---- 행 만들기: 관측값만 읽는다. sig 는 상태 변화 감지용 숫자 배열이다. ----
  const gateClear = g => {
    const b = app.battle;
    for (const e of b.enemies) if (e.alive && e.homeRoom === g.room) return false;
    for (const q of b.pending) if (q.room === g.room) return false;
    return true;
  };
  const fill = () => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r ? r.gates : EMPTY, s = P.sig;
    let rem = 0;
    for (const room of b.world.rooms) if (room.type !== 'start' && room.type !== 'boss' && !room.cleared) rem++;
    s[0] = b.curRoom ? b.curRoom.id : -1; s[1] = r ? r.progress : 0; s[2] = b.world.sealed ? 1 : 0; s[3] = rem; s[4] = p.auto ? 1 : 0; s[5] = r && r.hold > 0 ? 1 : 0;
    s[6] = r?.view ? 1 : -1; s[7] = 0;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i], room = g.room, o = G0 + i * K;
      let al = 0, pd = 0;
      for (const e of b.enemies) if (e.alive && e.homeRoom === room) al++;
      for (const q of b.pending) if (q.room === room) pd++;
      s[o] = g.ready ? 1 : 0; s[o + 1] = g.attuned ? 1 : 0; s[o + 2] = room.cleared ? 1 : 0; s[o + 3] = room.forgeWave || 0; s[o + 4] = room.discovered ? 1 : 0; s[o + 5] = al; s[o + 6] = pd;
      s[o + 7] = PHASE[g.phase] ?? 3; s[o + 8] = Number.isFinite(g.shocks) ? g.shocks : -1;
      s[o + 9] = typeof r.padOpen === 'function' ? (r.padOpen(g) ? 1 : 0) : -1;
      s[o + 10] = g.pad.x; s[o + 11] = g.pad.z; s[o + 12] = Number.isFinite(g.hits) ? g.hits : 0;
      const entry = r.view?.entries?.[i];
      s[o + 13] = entry?.vent ? (entry.vent.visible ? 1 : 0) : -1;
      s[o + 14] = entry?.pad ? (entry.pad.visible ? 1 : 0) : -1;
      s[o + 15] = labelIdx(entry?.labelState);
      const vcolor = entry?.vent?.material?.uniforms?.color?.value;
      s[o + 16] = vcolor?.getHex ? vcolor.getHex() : -1;
      s[o + 17] = entry?.pad?.material?.color?.getHex ? entry.pad.material.color.getHex() : -1;
      s[o + 18] = entry?.root ? (entry.root.visible ? 1 : 0) : -1;
      if (g.attuned && P.coolT[i] < 0) P.coolT[i] = b.elapsed;
    }
  };
  const build = (mk, full) => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r ? r.gates : EMPTY, s = P.sig;
    const row = { n: P.steps, t: b.elapsed, x: p.pos.x, z: p.pos.z, hp: p.hp, mhp: p.maxHp, al: p.alive ? 1 : 0, rm: s[0], pr: s[1], hd: r ? r.hold : 0, sl: s[2], rem: s[3], au: s[4],
      ah: app.input.attackHeld ? 1 : 0, ps: p.state,
      g: gs.map((g, i) => {
        const o = G0 + i * K;
        const e = { id: g.room.id, rd: s[o], at: s[o + 1], cl: s[o + 2], fw: s[o + 3], dc: s[o + 4], al: s[o + 5], pd: s[o + 6], ph: s[o + 7], sk: s[o + 8], po: s[o + 9], px: r6(s[o + 10]), pz: r6(s[o + 11]),
          ht: s[o + 12], vn: s[o + 13], pv: s[o + 14], lb: s[o + 15] >= 0 ? P.labels[s[o + 15]] : null, vc: s[o + 16], pc: s[o + 17], vv: s[o + 18] };
        if (full) { e.ra = P.coolT[i] >= 0 ? b.elapsed - P.coolT[i] : null; e.ag = g.age; }
        return e;
      }) };
    if (mk) row.mk = mk;
    return row;
  };
  const push = row => { P.rows.push(row); P.prevSig.set(P.sig); P.prevHd = row.hd; };
  P.begin = () => {
    const b = app.battle, r = routeOf(), gn = r ? r.gates.length : 0, size = G0 + gn * K;
    Object.assign(P, { hpDrops: [], clears: [], samples: [], viewAB: [], abCodes: new Int8Array(gn).fill(-1), stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0, startElapsed: b.elapsed,
      rows: [], sig: new Float64Array(size), prevSig: new Float64Array(size).fill(-1e9), prevHd: 0, entered: new Set(), wp: [], padGate: null, marks: [], toasts: [],
      coolT: new Float64Array(gn).fill(-1), okey: -1, ostable: 0, dwellSteps: 0 });
    Object.assign(P, { rearOn: false, rearRows: [], rearFilters: [], rearMarks: [], rearDoms: [], rearPost: 0, rearDone: false, rearBoss: null, rearLastDom: null, rearStable: 0, hasRear: !!rearOf() });
    wrapRearFilter();
    P.prevRoom = b.curRoom?.id ?? null;
    P.prev = { cleared: b.world.rooms.map(x => !!x.cleared), hp: b.player.hp };
    fill();
    abChanged();   // 시작 모습을 기준으로 삼는다(시작 직후는 측정하지 않는다)
    push(build('start'));
    const rooms = r ? r.gates.map(g => ({ id: g.room.id, x: g.room.x, z: g.room.z, type: g.room.type })) : [];
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, routeId: r?.def?.id ?? null, gates: gn, rooms, hasView: !!r?.view,
      hasSyncView: typeof r?.syncView === 'function', hasPadOpen: typeof r?.padOpen === 'function', hasRear: !!rearOf(), hasRearView: !!r?.rearView,
      allRooms: b.world.rooms.map(x => ({ id: x.id, type: x.type, x: x.x, z: x.z })), reinforcements: b.stage?.expedition?.mechanics?.reinforcements ?? 0,
      encounterTactic: typeof b.stage?.encounter?.tactic === 'string' ? b.stage.encounter.tactic : null,
      def: r ? { id: r.def.id, holdSeconds: r.def.holdSeconds, radius: r.def.radius, shockWindow: !!r.def.shockWindow, ventColor: r.def.ventColor ?? null, copy: r.def.copy ?? null } : null };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2) };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, p = b.player, r = routeOf();
    fill();
    const s = P.sig, q = P.prevSig, hd = r ? r.hold : 0;
    let changed = false;
    for (let i = 0; i < s.length; i++) if (s[i] !== q[i]) { changed = true; break; }
    // 현재 밸브(ready)의 목표창 표본: 상태 키(진행·phase·padOpen)가 36스텝(0.6초) 변하지 않았을 때 한 번 읽는다(10Hz 갱신 뒤).
    const gc = r ? r.gates[r.progress] : null;
    let okey = -1, wait = false;
    if (gc && gc.ready && gc.room.discovered) { const o = G0 + r.progress * K; okey = (r.progress * 4 + s[o + 7]) * 3 + s[o + 9] + 1; }
    if (okey !== P.okey) { P.okey = okey; P.ostable = 0; } else P.ostable++;
    const wantDom = okey >= 0 && P.ostable === 36;
    // 닫힌 조작판 대기: 현재 밸브가 ready 인데 닫혀 있고 영웅이 조작판 위에서 유지 0. 이 스텝은 모두 행으로 남긴다.
    if (gc && gc.ready && !gc.attuned) { const o = G0 + r.progress * K; wait = s[o + 9] === 0 && hd === 0 && Math.hypot(p.pos.x - gc.pad.x, p.pos.z - gc.pad.z) <= cfg.radius; }
    if (wait) P.dwellSteps++;
    if (changed || hd > 0 || P.prevHd > 0 || wait || wantDom || P.dense || P.steps % 60 === 0) {
      const row = build(null);
      if (wantDom) row.dom = document.getElementById('objective')?.textContent ?? null;
      push(row);
    }
    b.world.rooms.forEach((room, i) => { if (room.cleared && !P.prev.cleared[i]) { P.clears.push({ t: b.elapsed, room: room.id, type: room.type }); P.prev.cleared[i] = true; } });
    // 밸브 모습이 바뀐 스텝 끝: 같은 프레임의 뷰 draw call A/B(최대 150회).
    if (r?.view) { const ch = abChanged(); if (ch && P.viewAB.length < 150) P.viewAB.push(P.measureView(ch)); }
    if (p.hp < P.prev.hp - 1e-6) P.hpDrops.push({ t: b.elapsed, drop: P.prev.hp - p.hp, hp: p.hp, maxHp: p.maxHp, room: b.curRoom?.id ?? null });
    P.prev.hp = p.hp;
    if (p.maxHp > 0) P.minHpRatio = Math.min(P.minHpRatio, p.hp / p.maxHp);
    let alive = 0; for (const e of b.enemies) if (e.alive) alive++;
    P.maxAlive = Math.max(P.maxAlive, alive);
    // 방 첫 진입 프레임의 draw call(기준선 비교 대상): 시작·보스방을 뺀 모든 방의 첫 진입마다 한 번.
    if (s[0] !== P.prevRoom) {
      P.prevRoom = s[0];
      const room = b.curRoom;
      if (room && room.type !== 'start' && room.type !== 'boss' && !P.entered.has(room.id)) { P.entered.add(room.id); P.sample('roomEnter', { roomId: room.id, roomType: room.type }); }
    }
    rearObserve();
  };
  // screens 순간(첫 밸브 index 0, 관측 조건만으로 판정): 닫힌 조작판 · 밀물 경고 · 밀물 · 열린 조작판 · 개방 직후.
  const momentNow = label => {
    const b = app.battle, r = routeOf(), g = r?.gates?.[0];
    // 후방 순간: 보스 등장 뒤 armored(목표창이 armored 문구로 바뀐 뒤) · exposed 이고 windowLeft ≤ window − 0.5(부채꼴이 보임).
    if (label === 'rear-armored' || label === 'rear-exposed') {
      const rear = rearOf();
      if (!rear || !rear.boss?.alive || rear.boss.spawning) return false;
      if (label === 'rear-armored') return rear.state === 'armored' && (objectiveText() ?? '').includes(cfg.armoredText);
      return rear.state === 'exposed' && rear.windowLeft > 0 && rear.windowLeft <= cfg.rear.window - .5 && viewState('wedge')[0] === 1;
    }
    if (!g) return false;
    switch (label) {
      case 'closed': return r.progress === 0 && g.ready && !g.attuned && g.phase === 'heat' && !r.padOpen(g) && r.hold === 0;
      case 'warning': return r.progress === 0 && g.ready && !g.attuned && g.phase === 'warning';
      case 'vent': return r.progress === 0 && g.ready && !g.attuned && g.phase === 'vent';
      case 'open': return r.progress === 0 && g.ready && !g.attuned && r.padOpen(g) && r.hold >= 1.0;
      case 'opened': return g.attuned && P.coolT[0] >= 0 && b.elapsed - P.coolT[0] >= .1 - 1e-9;
      default: return false;
    }
  };
  P.hit = stop => {
    const b = app.battle, r = routeOf(), p = b.player.pos, g = r && stop.gate !== undefined ? r.gates[stop.gate] : null;
    switch (stop.type) {
      case 'time': return b.elapsed >= stop.t;
      case 'result': return !!app.expeditionUI.result;
      case 'progress': return !!r && r.progress >= stop.n;
      case 'hold': return !!r && r.hold >= stop.min && (stop.progress == null || r.progress === stop.progress);
      // 밸브가 ready 이고 적·대기열이 0 인 순간(order 의 AUTO 끄는 시점).
      case 'ready': return !!g && r.progress === stop.progress && g.ready && !g.attuned && gateClear(g);
      // 첫 밸브 방 정화: 후보는 그 밸브가 ready·적 0, 기준선(밸브 없음)은 방이 cleared.
      case 'firstClear': {
        const gate = r?.gates?.find(x => x.room.id === stop.room);
        if (gate) return r.gates.indexOf(gate) === r.progress && gate.ready && !gate.attuned && gateClear(gate);
        return !!b.world.rooms.find(room => room.id === stop.room)?.cleared;
      }
      // ready 인데 조작판이 닫힌 순간(밀물 대기).
      case 'closed': return !!g && r.progress === stop.gate && g.ready && !g.attuned && typeof r.padOpen === 'function' && !r.padOpen(g) && r.hold === 0;
      case 'cooled': return !!g && g.attuned && P.coolT[stop.gate] >= 0 && b.elapsed - P.coolT[stop.gate] >= stop.min - 1e-9;
      case 'shocks': return !!g && r.progress === stop.gate && g.ready && g.shocks >= stop.min;
      case 'phase': return !!g && r.progress === stop.gate && g.ready && g.phase === stop.phase;
      case 'near': return Math.hypot(p.x - stop.x, p.z - stop.z) <= stop.r;
      case 'nearPad': return !!g && Math.hypot(p.x - g.pad.x, p.z - g.pad.z) <= stop.r;
      case 'awayPad': return !!g && Math.hypot(p.x - g.pad.x, p.z - g.pad.z) >= stop.r;
      case 'rearState': return rearOf()?.state === stop.state && !!rearOf()?.boss?.alive;
      case 'moment': { for (const label of stop.pending) if (momentNow(label)) { P.momentHit = label; return true; } return false; }
      default: return false;
    }
  };
  /** n 스텝 진행. seg 를 주면 스텝마다 keys 행({ n, t, x, z, kd, en, pa })을 P.keyRows[seg] 에 남기고 돌려준다(keys 프로필). */
  P.run = ({ n, stop = null, renderEvery = 0, seg = null }) => {
    const b = app.battle; let ran = 0, reason = 'n';
    P.momentHit = null;
    const out = seg ? (P.keyRows[seg] = []) : null;
    for (; ran < n; ran++) {
      if (!b.active) { reason = 'inactive'; break; }
      if (b.paused) { reason = 'paused'; break; }
      const render = renderEvery > 0 && P.steps % renderEvery === 0;
      const t0 = performance.now(); app.step(P.dt, render); const ms = performance.now() - t0;
      P.steps++; (render ? P.renderMs : P.stepMs).push(+ms.toFixed(3));
      if (ms > 50) P.slow.push({ n: P.steps, t: b.elapsed, ms: +ms.toFixed(1), render, room: b.curRoom?.id ?? null });
      observe();
      if (out) out.push({ n: P.steps, t: b.elapsed, x: b.player.pos.x, z: b.player.pos.z, kd: app.input.keys.KeyD ? 1 : 0, en: app.input.enabled ? 1 : 0, pa: b.paused ? 1 : 0 });
      if (stop && P.hit(stop)) { reason = 'stop'; ran++; break; }
    }
    return { ran, reason, active: b.active, paused: b.paused, elapsed: b.elapsed, pauseReasons: [...b.pauseReasons], hit: P.momentHit, keyRows: out };
  };
  P.stepRaw = n => { for (let i = 0; i < n; i++) app.step(P.dt, false); return app.battle.elapsed; };
  P.setDense = on => { P.dense = !!on; return P.dense; };
  P.dwellSeconds = () => P.dwellSteps / 60;
  // 구간 표식: 현재 상태의 행을 mk 와 함께 하나 더 넣는다. 같은 스텝의 행과 n 이 겹칠 수 있어 판정은 행 순서(인덱스)로 구간을 자른다.
  P.mark = label => {
    const b = app.battle; if (!b?.world || !b.player) return null;
    fill();
    const row = build(label);
    push(row); return row.n;
  };
  P.freeze = withView => {
    const b = app.battle; fill();
    const row = build(null, true);
    Object.assign(row, { elapsed: b.elapsed, paused: b.paused, active: b.active, kills: b.kills });
    row.gx = (routeOf()?.gates || EMPTY).map(g => ({ ag: g.age, ph: g.phase === 'heat' ? 0 : g.phase === 'warning' ? 1 : g.phase === 'vent' ? 2 : 3, sk: Number.isFinite(g.shocks) ? g.shocks : -1 }));
    row.inputKeys = { KeyD: !!app.input.keys.KeyD, enabled: !!app.input.enabled };
    row.rear = rearRow();
    if (row.rear) row.rear.dom = objectiveText();
    return row;
  };
  // 키보드 이동용: 영웅 → 다음 경유점의 화면 투영 차. 경로는 방 연결(links)과 L자 복도(linkPending)의 모서리를 방 중심 경유로 따른다. pad 목표는 gate.pad 가 옮겨 가도 따라간다.
  P.setTarget = t => {
    const b = app.battle, w = b.world, p = b.player.pos;
    if (t.pad !== undefined) { P.padGate = t.pad; P.wp = [{ x: 0, z: 0 }]; return 1; }
    P.padGate = null;
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
    P.wp = wp; return wp.length;
  };
  P.aim = () => {
    const b = app.battle, p = b.player.pos, cam = app.renderer.camera, r = routeOf();
    if (P.padGate !== null && r) { const pad = r.gates[P.padGate].pad; P.wp = [{ x: pad.x, z: pad.z }]; }
    while (P.wp.length > 1 && Math.hypot(P.wp[0].x - p.x, P.wp[0].z - p.z) < 1.5) P.wp.shift();
    const wp = P.wp[0], fin = P.wp.at(-1);
    cam.updateMatrixWorld();
    // 먼 경유점을 그대로 투영하면 카메라 뒤·시야 밖에서 부호가 뒤집힌다. 경유점 방향으로 영웅 앞 2 유닛 점만 투영해 화면 방향을 얻는다.
    const ex = wp.x - p.x, ez = wp.z - p.z, el = Math.hypot(ex, ez) || 1;
    const a = p.clone().project(cam), z = p.clone().set(p.x + ex / el * 2, p.y, p.z + ez / el * 2).project(cam);
    // live: 게임 입력층이 지금 눌려 있다고 아는 키. 일시정지 해제 등에서 input.clear() 가 키 상태를 지우면 다시 눌러야 한다(order 에서만 쓴다).
    const ks = app.input.keys || {}, live = [];
    for (const k in ks) if (ks[k]) live.push(k);
    return { dx: (z.x - a.x) * innerWidth / 2, dy: -(z.y - a.y) * innerHeight / 2, left: P.wp.length, final: fin, dist: Math.hypot(fin.x - p.x, fin.z - p.z), live };
  };
  // rear 프로필: 현재 후방 상태, 구간 표식, 보스 정면·등 뒤 쪽으로 걷기 위한 화면 방향.
  P.rearState = () => { const r = rearOf(); return r ? { state: r.state, windowLeft: r.windowLeft, windows: r.windows, rearHits: r.rearHits, frontHits: r.frontHits, boss: !!r.boss?.alive } : null; };
  P.rmark = label => { P.rearMarks.push({ mk: label, n: P.steps }); return P.steps; };
  /**
   * side('front'|'rear') 쪽 사거리 지점으로 가는 화면 방향. 지점은 보스 정면/등 뒤로 meleeReach(원거리 영웅은 rangedReach)만큼 떨어진 곳이다.
   * 반대편에 있으면 몸을 가로지르지 않도록 영웅이 있는 쪽 옆 경유점(autoFlank 와 같은 sidePad)을 먼저 거친다. 입력은 밖에서 키로 보낸다(좌표 이동 없음).
   * arrived: 이미 그 쪽 사거리 안(정의의 rearDot/frontDot 에 여유 .15)이라 공격해도 되는 상태. bdx/bdy 는 보스를 향하는 화면 방향이다.
   */
  P.rearAim = side => {
    const b = app.battle, r = rearOf(), boss = r?.boss, hero = b.player;
    if (!r || !boss?.alive || !hero?.alive) return null;
    const def = r.def, p = hero.pos, cam = app.renderer.camera;
    const fx = Math.sin(boss.yaw), fz = Math.cos(boss.yaw), vx = p.x - boss.pos.x, vz = p.z - boss.pos.z, dist = Math.hypot(vx, vz);
    const reach = hero.def?.ranged ? def.rangedReach : def.meleeReach;
    const dot = dist > 1e-9 ? (-vx / dist) * fx + (-vz / dist) * fz : -1;
    const sign = side === 'rear' ? -1 : 1;
    const arrived = side === 'rear' ? dot >= def.rearDot + .15 && dist <= reach + .6 : dot <= -(def.frontDot + .15) && dist <= reach + .6;
    let tx = boss.pos.x + sign * fx * reach, tz = boss.pos.z + sign * fz * reach;
    const along = vx * fx + vz * fz;   // 영웅이 정면 쪽(+)인지 등 쪽(-)인지
    if (side === 'rear' ? along > -.5 : along < .5) {
      const s = vx * fz - vz * fx >= 0 ? 1 : -1, rr = reach + def.sidePad;
      tx = boss.pos.x + s * fz * rr + sign * fx * .8; tz = boss.pos.z - s * fx * rr + sign * fz * .8;
    }
    const room = boss.homeRoom;
    if (room && Number.isFinite(room.w) && Number.isFinite(room.h)) {
      const m = 1.2;
      tx = Math.max(room.x - room.w / 2 + m, Math.min(room.x + room.w / 2 - m, tx));
      tz = Math.max(room.z - room.h / 2 + m, Math.min(room.z + room.h / 2 - m, tz));
    }
    cam.updateMatrixWorld();
    const toward = (x, z) => {
      const ex = x - p.x, ez = z - p.z, el = Math.hypot(ex, ez) || 1;
      const a = p.clone().project(cam), z2 = p.clone().set(p.x + ex / el * 2, p.y, p.z + ez / el * 2).project(cam);
      return { dx: (z2.x - a.x) * innerWidth / 2, dy: -(z2.y - a.y) * innerHeight / 2 };
    };
    const go = toward(tx, tz), at = toward(boss.pos.x, boss.pos.z);
    const ks = app.input.keys || {}, live = [];
    for (const k in ks) if (ks[k]) live.push(k);
    return { state: r.state, windowLeft: r.windowLeft, arrived, dist, dot, dx: go.dx, dy: go.dy, bdx: at.dx, bdy: at.dy, goalDist: Math.hypot(tx - p.x, tz - p.z),
      fh: r.frontHits, rh: r.rearHits, heroState: hero.state, live };
  };
  // 느린 스텝 목록은 자르지 않는다(기준선 비교가 개수를 정확히 세야 한다).
  P.summary = () => ({ steps: P.steps, stepMs: P.stepMs, renderMs: P.renderMs, slow: P.slow, maxAlive: P.maxAlive, minHpRatio: P.minHpRatio, samples: P.samples, viewAB: P.viewAB,
    clears: P.clears, hpDrops: P.hpDrops, rows: P.rows, toasts: P.toasts, dwellSeconds: P.dwellSteps / 60,
    rear: { rows: P.rearRows, filters: P.hasRear ? P.rearFilters : null, marks: P.rearMarks, doms: P.rearDoms } });
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
    routeKind: r?.def?.kind ?? null, routeId: r?.def?.id ?? null, rooms: b.world.rooms.length, gates: r ? r.gates.length : 0, controller: r ? r.constructor.name : null,
    hasView: !!r?.view, hasSyncView: typeof r?.syncView === 'function', mechanics: b.stage.expedition?.mechanics ?? null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && info.route.depth === 'deep' && row.started.pending?.energy === dungeonDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === 'deep' && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  // 정의가 있는 후보 빌드인데 컨트롤러가 없거나(규칙 lane 미병합), 정의가 없는 기준선인데 컨트롤러가 있으면 기준선으로 오인하지 않도록 실패로 남긴다.
  if (routeDef) check(tag + ': 냉각 컨트롤러 id = ' + routeDef.id, info.routeId === routeDef.id && info.gates === routeDef.gates.length, { routeId: info.routeId, gates: info.gates, controller: info.controller });
  else check(tag + ': 밸브 정의가 없는 기준선인데 routeObjectives 가 있음', !info.routeId, { routeId: info.routeId, controller: info.controller });
  if (routeDef) check(tag + ': 출격 직후(prepareView 뒤) route.view 존재', info.hasView, { hasView: info.hasView });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { gateCount: info.gates, radius: routeDef?.radius ?? 1.6, rear: rearDef ? JSON.parse(JSON.stringify(rearDef)) : null,
    names: { wedge: REAR.wedge.name, guard: REAR.guard.name }, armoredText: REAR.armoredText });
  row.begin = await page.evaluate(() => window.__tideQa.begin());
  row.reinforcements = row.begin.reinforcements;
  // 후방 정의가 있는 후보는 컨트롤러와 뷰가 출격 직후(prepareView 뒤)에 있어야 한다. 없으면 관측 누락이라 기준선으로 오인하지 않고 실패로 남긴다.
  if (rearDef) {
    check(tag + ': 후방 컨트롤러(routeObjectives.rear) 존재', row.begin.hasRear, { hasRear: row.begin.hasRear, controller: row.begin.controller });
    check(tag + ': 후방 뷰(routeObjectives.rearView) 존재(출격 직후 prepareView 뒤)', row.begin.hasRearView, { hasRearView: row.begin.hasRearView });
  } else check(tag + ': 후방 정의가 없는 기준선인데 routeObjectives.rear 가 있음', !row.begin.hasRear, { hasRear: row.begin.hasRear });
  // 재시드: 첫 app.step 전 한 번. --no-reseed 면 호출하지 않는다.
  row.reseed = reseedOn ? await page.evaluate(s => { const q = window.__tideQa, b = window.app.battle; const r = { on: true, elapsed: b.elapsed, active: b.active, steps: q.steps, hasRoute: !!b.routeObjectives, hasView: !!b.routeObjectives?.view };
    window.__qaReseed(s); return r; }, seed) : { on: false, elapsed: null };
  report.reseed = { on: row.reseed.on, elapsed: row.reseed.elapsed };
  if (reseedOn) check(tag + ': 재시드는 전투 활성·첫 스텝 전(elapsed 0)', row.reseed.active === true && row.reseed.steps === 0 && row.reseed.elapsed === 0, row.reseed);
  if (routeDef) check(tag + ': 정예방 증원 횟수 = 대상 프로젝트 mechanics.reinforcements', row.reinforcements === (dungeonDef.mechanics?.reinforcements ?? 0), { page: row.reinforcements, project: dungeonDef.mechanics?.reinforcements ?? null });
  await qa.save(); return row;
}
async function takeChoice(row, last = null) {
  // 각인 창(선택지 모달)은 정지 사유가 걸린 뒤 조금 늦게 보일 수 있다. 정지 시점의 상태를 먼저 남기고 90초까지 기다린다.
  const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
  const snap = () => page.evaluate(() => ({ reasons: [...window.app.battle.pauseReasons], paused: window.app.battle.paused, active: window.app.battle.active,
    elapsed: window.app.battle.elapsed, open: [...document.querySelectorAll('dialog[open]')].map(d => d.id),
    count: document.querySelectorAll('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').length }));
  const before = await snap(); const waitStart = Date.now();
  try { await buttons.first().waitFor({ state: 'visible', timeout: 90000 }); }
  catch {
    // 진단: 정지가 걸린 스텝의 정지 사유와 지금 열린 dialog 를 함께 남긴다.
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
    last = await page.evaluate(opts => window.__tideQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row, last); if (keyboardMode) await nativeGameplayFocus(page); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = withView => page.evaluate(v => window.__tideQa.freeze(v), !!withView);
const mark = label => page.evaluate(l => window.__tideQa.mark(l), label);
const setDense = on => page.evaluate(v => window.__tideQa.setDense(v), on);
const dwellSeconds = () => page.evaluate(() => window.__tideQa.dwellSeconds());
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
async function captureScreens(label) {
  const shots = [];
  for (const size of SCREEN_VIEWPORTS) {
    await page.setViewportSize(size);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => window.app.renderer.render()); // 시뮬레이션 tick 없이 그리기만
    const file = label + '-' + size.width + 'x' + size.height + '.png';
    await page.screenshot({ path: path.join(qa.out, file), timeout: SHOT_TIMEOUT }); shots.push(file);
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
async function pauseBattle() {
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => window.app.battle.paused && document.getElementById('pause-overlay').classList.contains('show'));
}
async function resumeBattle() {
  await page.locator('#btn-resume').click();
  await page.waitForFunction(() => !window.app.battle.paused);
}

// ---------- 키보드 ----------
/** 키 이벤트 로그: 모든 keyboard.down/up 을 단계(keyPhase)와 함께 남긴다. keys 프로필은 정지~재개 단계에 이벤트가 없음을 이 로그로 증명한다. */
let keyPhase = 'walk';
const keyEvents = [];
async function kb(op, key) { await page.keyboard[op](key); keyEvents.push({ phase: keyPhase, op, key }); }
const held = new Set();
/** live 를 주면, 도구가 누르고 있다고 아는 키 중 게임 입력층에서 지워진 키(input.clear: 각인 창 닫힘 뒤 정지 해제 등)를 떼었다 다시 누른다(실제 사용자의 재입력과 같다). order 의 walkTo 에서만 쓴다. */
async function setKeys(next, live = null) {
  for (const key of [...held]) if (!next.has(key)) { await kb('up', key); held.delete(key); }
  if (live) for (const key of [...held]) if (!live.includes(key)) { await kb('up', key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await kb('down', key); held.add(key); }
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
  keyPhase = 'walk';
  await page.evaluate(t => window.__tideQa.setTarget(t), target);
  let total = 0; const trail = [];
  try {
    while (total < maxSteps) {
      if (await page.evaluate(s => window.__tideQa.hit(s), stop)) return { steps: total, trail };
      const aim = await page.evaluate(() => window.__tideQa.aim());
      await setKeys(keysToward(aim), aim.live);
      const r = await page.evaluate(opts => window.__tideQa.run(opts), { n: 4, stop });
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
const LABELS = {
  definition: '정의 = PLAN 3.0·3.1 계약(밸브 방 [2,3,4]·이름·밀물 문구·ventColor 0x3d8cff·shockWindow·수치)',
  coolCount: '밸브 개방 ' + (routeDef?.gates.length ?? 3) + '회(progress 증가 스텝)', coolOrder: '개방 순서 = 정의 순서 [' + (valveRooms ?? TIDE.rooms).join(', ') + ']',
  holdDuration: '개방마다 직전 연속 유지(0 에서 시작, hold 증가 = 게임 시각 증가)가 엔진 hold·게임 시각 길이 모두 ≥ ' + (routeDef?.holdSeconds ?? 2) + '초 − 1/60',
  holdInside: '유지 동안 영웅이 그 밸브 gate.pad 반경 ' + (routeDef?.radius ?? 1.6) + ' 안', padOpen: '개방 직전 유지 표본 전부 padOpen(ready·가열·밀물 ≥ 1)',
  holdWindows: '모든 유지 표본(끊긴 구간 포함)이 열린 조작판에서만 이어짐', enemiesCleared: '개방 시점 그 방의 적·대기열 0(유지 구간 전체 포함)',
  reinforcements: '정예방 forgeWave = 증원 횟수', readyTiming: '밸브 준비 시점: 방 발견·적/대기열 0·정예방 증원 완료 뒤, 준비 전 유지 0',
  gateState: '개방 순서 상태(앞 밸브 attuned·뒤 밸브 아직·개방 전 cleared 아님)', waiting: '닫힌 조작판 대기 관측(ready·닫힘·영웅이 조작판 위·유지 0 표본 ≥ 1)',
  orderWait: '순서 대기: 뒤 밸브 방이 먼저 정리돼도 앞 밸브 개방 전에는 개방·정화 없음(관측되면)', tideCycle: '밀물 주기(경고 · 밀물 · 물 빠짐 길이, 준비 뒤 밀물만 shocks +1, 조작판 좌우 교대)',
  tideHits: '밀물 띠 피해: 밀물 단계 · 현재 밸브 · 띠 안 · 분출당 1회', unseal: 'world.sealed 해제는 progress = 3 이고 모든 비보스 방 cleared 뒤',
  resultFields: '결과 routeObjective { id, label, complete, progress, target, rooms, overheatHits }', resultLine: "결과 줄 '냉각 밸브 개방 3/3 · 완료'", resultElement: "결과 줄 요소 aria-label '냉각 밸브 개방 결과' 본문",
  objectiveText: '목표창 제목과 상태별 밀물 문구(닫힘·열림 표본 필수, 망치·충격파 없음)', toasts: '토스트: 준비·개방·밀물 피해 문구, 재벼림 문구 없음', tideView: '밸브 뷰: 밀물 띠 색 파랑 · 닫힘 라벨 밀물 대기 · 띠 표시/숨김',
};
const REAR_LABELS = {
  definition: '정의 = PLAN 3절 계약(id·보스 cinder_chain_executor·서명 kiln_hammer·수치)', attach: '부착: 보스 등장 뒤 한 스텝 안에 armored, 전이는 idle → armored ⇄ exposed → ended 뿐',
  attachToast: "부착 토스트 '사슬 갑주 · 용재 망치가 박히면 등 뒤를 노리세요' 정확히 1회", windowCount: '노출 창 1회 이상',
  noEarlyOpen: '용재 망치 completedAttackSequence 가 쓰이기 전·다른 시그니처 뒤에는 열리지 않음', openTiming: '창이 트리거 같은 스텝 또는 다음 스텝에 열리고 한 망치에 한 번',
  noMissedOpen: '용재 망치가 완성되면 반드시 열림(보스 처치 스텝 제외)', windowLength: '창 길이 = window ± 1/60(보스 처치로 끝난 마지막 창만 면제·기록)·windowLeft 시계',
  noNewAttack: '창 안 attackSequence 불변(새 공격 0)', yawFixed: '창 안 보스 yaw 가 열린 순간과 정확히 같음', pinnedStill: '창 안 보스 state chase 인 스텝은 속도 0(이동은 보고)',
  windowsConsistent: 'rear.windows = 관측한 창 수', openToasts: '열림 토스트(정의 window 문구) 창마다 1회·비슷한 다른 문구 없음',
  multiplier: '피해 배율: 창 안 attacker 있는 타격 = 입력 × rear|front|1(영웅 위치 구분), 그 밖·attacker 없음 1배, 집계 = rearHits·frontHits·sideHits, attacker = 영웅 위치, 영웅 위치 구분 = 배율에서 읽은 구분', rearView: '뷰: 부채꼴 0x5ff0d0·갑주 호 0xd8a070 은 exposed 에서만 보임',
  objectiveText: "목표창 제목 '사슬 집행자 후방'·armored/exposed 문구(남은 시간 0.1초 올림)", resultRear: "결과 routeObjective.rear = 마지막 관측값 · 결과 줄 '사슬 집행자 후방 공격 n회 · 노출 n번 · 정면 막힘 n회'",
  autoRear: 'AUTO 후방: 창 ≥ 1 · 등 뒤 타격이 있는 창 ≥ 1 · rearHits > frontHits',
};
/** 보스방 후방 관측을 파일로 빼고, 후방 정의가 있는 후보는 판정한다. 후방 정의가 없는 기준선은 문구·토스트 누출만 관찰한다(8e89a51·79883ad 공통). */
function recordRear(row, raw, toasts) {
  const file = row.tag + '-rear-trace.json';
  fs.writeFileSync(path.join(qa.out, file), JSON.stringify(raw), { flag: 'wx' });
  row.rearTraceFile = file; row.rearTraceRows = raw.rows.length; row.rearFilterCalls = raw.filters?.length ?? null;
  if (!rearDef) {
    row.rearLeak = checkRearLeak(toasts, raw.doms, row.resultText);
    row.rear = { skipped: '후방 정의(ROUTE_OBJECTIVES.ember_deep.rear)가 없는 기준선 빌드: 후방 판정 생략, 문구·토스트 누출만 관찰' };
    check(row.tag + ': 기준선에 후방 문구·토스트 누출 없음(토스트·보스방 목표창 표본·결과 화면 관찰)', row.rearLeak.ok, row.rearLeak);
    return;
  }
  const analysis = analyzeRear({ rows: raw.rows, filters: raw.filters, toasts, result: row.result?.routeObjective, resultText: row.resultText, resultLines: row.resultLines,
    encounterTactic: row.begin.encounterTactic ?? null }, rearDef, { autoRear: row.tag !== 'rear' });
  row.rear = analysis;
  traces.set(row.tag + ':rear', raw);
  (report.reportItems.rearWindows ??= []).push({ tag: row.tag, windows: analysis.windows.map(w => ({ index: w.index, n: w.n, t: w.t, length: w.length, truncated: w.truncated, delaySteps: w.delaySteps, rows: w.rows,
    moveMax: w.moveMax, startWindowLeft: w.startWindowLeft })), exempt: analysis.windows.filter(w => w.truncated).map(w => ({ index: w.index, length: w.length, why: '보스 처치로 끝난 창: 길이 판정 면제' })),
    note: '보고 항목: 창마다 시작·길이·열림 지연 스텝·보스 이동(넉백) 최대 거리' });
  (report.reportItems.rearAuto ??= []).push({ tag: row.tag, per: analysis.auto.per, windowsWithRear: analysis.auto.windowsWithRear, rearHits: analysis.auto.rearHits, frontHits: analysis.auto.frontHits,
    note: '보고 항목: 창마다 등 뒤·정면 타격 수와 창 시작부터 첫 등 뒤 타격까지 게임 초' });
  (report.reportItems.rearFilters ??= []).push({ tag: row.tag, calls: analysis.filters.calls, exposedCalls: analysis.filters.exposedCalls, attackerless: analysis.filters.attackerless, unreadable: analysis.filters.unreadable, rowCheck: analysis.filters.rowCheck, counts: analysis.filters.counts, controller: analysis.filters.controller });
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': 후방 ' + (REAR_LABELS[name] ?? name), ok, ok ? undefined : { name, definition: analysis.definition.issues, attach: analysis.attach,
    windows: analysis.windows, missed: analysis.missed, filters: analysis.filters, auto: analysis.auto, view: analysis.view, objective: analysis.objective, toasts: analysis.toasts, result: analysis.result });
  if (row.tag === 'rear') {
    const manual = checkRearManual(raw.rows, raw.filters, raw.marks, rearDef);
    row.rearManual = manual;
    check('rear: 키보드 구간 — AUTO 꺼짐·영웅 생존·순간이동 없음·정면 타격 ≥ 1(배율 front)·등 뒤 타격 ≥ 1(배율 rear)·정면 타격 뒤 등 뒤 타격', manual.ok, manual);
  }
}
/** 관측 행을 파일로 빼고, 밸브 정의가 있는 빌드는 개방 전 과정을 판정한다. 기준선(정의 없음)은 공통 측정만 남긴다. */
function recordTide(row, raw) {
  const rows = raw.rows;
  delete raw.rows;
  traces.set(row.tag, rows);
  const file = row.tag + '-trace.json';
  fs.writeFileSync(path.join(qa.out, file), JSON.stringify(rows), { flag: 'wx' });
  row.traceFile = file; row.traceRows = rows.length;
  const roomSamples = raw.samples.filter(x => x.label === 'roomEnter');
  check(row.tag + ': 방 첫 진입 draw call 표본(roomEnter) 1개 이상', roomSamples.length > 0, { rooms: roomSamples.map(x => x.roomId) });
  if (!routeDef) { row.tide = { skipped: '밸브 정의(ROUTE_OBJECTIVES.ember_deep)가 없는 기준선 빌드: 밸브 판정 생략, 공통 측정만 기록' }; return; }
  const missingRooms = valveRooms.filter(id => !roomSamples.some(x => x.roomId === id));
  check(row.tag + ': 밸브 방마다 첫 진입 draw call 표본', missingRooms.length === 0, { valveRooms, missing: missingRooms });
  const analysis = analyzeTide({ rows, result: row.result?.routeObjective, resultText: row.resultText, resultLines: row.resultLines, win: row.result?.win === true, rooms: row.begin.rooms,
    toasts: raw.toasts, viewAB: raw.viewAB, encounterTactic: row.begin.encounterTactic ?? null }, routeDef, { reinforcements: row.reinforcements });
  row.tide = analysis;
  (report.reportItems.routeViewAB ??= []).push({ tag: row.tag, ...analysis.viewAB });
  (report.reportItems.viewSync ??= []).push({ tag: row.tag, observable: analysis.sync.observable, mismatches: analysis.sync.mismatchCount, note: '보고 항목: 밸브 뷰 root.visible = room.discovered (냉각 장치 GLB 뷰는 기존 뷰라 게이트 아님)' });
  (report.reportItems.objectiveSamples ??= []).push({ tag: row.tag, samples: analysis.objective.samples, open: analysis.objective.open, closed: analysis.objective.closed, avoid: analysis.objective.avoid,
    note: '보고 항목: 목표창 열림/닫힘/경고·밀물 표본 수' });
  (report.reportItems.tideHits ??= []).push({ tag: row.tag, total: analysis.hits.total, hits: analysis.hits.hits, note: '보고 항목: 밀물 띠 피해 횟수와 직전 행 대비 hp 하락 비율(최대 체력 대비, 판정 아님)' });
  (report.reportItems.orderWait ??= []).push({ tag: row.tag, observed: analysis.orderWait.observed, rows: analysis.orderWait.rows, gates: analysis.orderWait.gates, note: '보고 항목: 뒤 밸브 방이 먼저 정리된 순서 대기 관측 여부(AUTO 경로에 따라 없을 수 있음)' });
  (report.reportItems.tideCycle ??= []).push({ tag: row.tag, shockEnds: analysis.cycle.shockEnds, warning: analysis.cycle.durations.warning.length, vent: analysis.cycle.durations.vent.length, calm: analysis.cycle.durations.calm.length });
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': 밸브 ' + (LABELS[name] ?? name), ok, ok ? undefined : { name, violations: analysis.violations.slice(0, 8), definition: analysis.definition, holds: analysis.holds, waiting: analysis.waiting,
    ready: analysis.ready, orderWait: analysis.orderWait, cycle: { ...analysis.cycle, durations: undefined }, hits: { ...analysis.hits, hits: undefined }, unseal: analysis.unseal, result: analysis.result, line: analysis.resultLine,
    element: analysis.resultElement, objective: analysis.objective, toasts: analysis.toasts, view: analysis.view, observedOrder: analysis.observedOrder, wantOrder: analysis.wantOrder });
}
/**
 * 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·밸브 판정을 기록한다. momentLabels 는 screens 프로필이 관측 상태(MOMENTS)에 처음 닿는 순간마다 멈춰 PNG 를 남기는 목록이다.
 * 순간의 순서는 정하지 않는다(준비가 밀물 도중이면 닫힘보다 경고가 먼저일 수 있다).
 */
async function playToEnd(row, { momentLabels = null, expectFirstClear = true } = {}) {
  row.shots ??= [];
  if (momentLabels) {
    const pending = [...momentLabels];
    while (pending.length) {
      const r = await advance(row, { type: 'moment', pending }, { renderEvery: 0 });
      if (r.reason !== 'stop' || !pending.includes(r.hit)) break;
      const label = r.hit, capture = await freeze(true);
      row.shots.push({ label, reached: true, files: await captureScreens(label + '-' + row.tag), elapsed: ms(r.elapsed), capture });
      pending.splice(pending.indexOf(label), 1);
    }
    for (const label of pending) row.shots.push({ label, reached: false });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await mark('end');
  await waitResult();
  row.summary = await page.evaluate(() => window.__tideQa.summary());
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
  const rearRaw = s.rear;
  delete s.rear;
  row.metrics = { elapsed: row.result?.time ?? null, kills: row.result?.kills ?? null, hpDrops: s.hpDrops.length, hpDropTotal: ms(s.hpDrops.reduce((sum, d) => sum + d.drop, 0)),
    minHpRatio: s.minHpRatio, maxAlive: s.maxAlive, simulation: stepStats(s.stepMs), render: stepStats(s.renderMs), over50ms: [...s.stepMs, ...s.renderMs].filter(v => v > 50).length, slow: s.slow,
    drawCalls: s.samples.map(x => ({ label: x.label, roomId: x.roomId ?? null, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms })) };
  // 스텝별 ms 배열은 통계만 남기고 버린다(관측 행은 파일로 뺀다). 느린 스텝 목록(slow)은 자르지 않는다.
  delete s.stepMs; delete s.renderMs;
  (report.reportItems.absolute50ms ??= []).push({ tag: row.tag, runOver50: row.metrics.over50ms, steps: s.steps, note: '보고 항목(판정 아님). 기준선 대비 증가는 ember-tide-compare 가 판정한다.' });
  recordTide(row, s);
  recordRear(row, rearRaw, s.toasts);
  if (!routeDef) {
    row.baseline = { skipped: row.tide.skipped, elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops, frames: { simulation: row.metrics.simulation, render: row.metrics.render }, drawCalls: row.metrics.drawCalls };
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
/** rear 프로필은 후방 정의(ember_deep.rear)가 있는 후보에서만 돈다. */
const skipUnlessRear = () => (rearDef ? null : { skipped: '후방 정의(ROUTE_OBJECTIVES.ember_deep.rear)가 있는 후보 빌드에서만 도는 프로필이다(기준선은 후방 판정을 건너뛴다)' });
const rearState = () => page.evaluate(() => window.__tideQa.rearState());
const rmark = label => page.evaluate(l => window.__tideQa.rmark(l), label);
/** 후방 창이 열려 있고 남은 시간이 minLeft 이상이 될 때까지 맞춘다. 이미 그러면 그대로 둔다(AUTO 를 건드리지 않는다). 아니면 AUTO 를 켜 창이 닫히고 다시 열리기를 기다린다. */
async function ensureRearWindow(row, minLeft) {
  for (let k = 0; k < REAR_RUN.maxCycles; k++) {
    const st = await rearState();
    if (!st) throw Error('No rear controller while waiting for a window');
    if (st.state === 'exposed' && st.windowLeft >= minLeft) return st;
    if (st.state === 'ended') throw Error('Rear exposure ended before the window we wanted');
    if (!(await page.evaluate(() => window.app.battle.player.auto))) { keyboardMode = false; await setAuto(true); }
    if (st.state === 'exposed') {
      const closed = await advance(row, { type: 'rearState', state: 'armored' }, { max: 60 * 30 });
      qaAssert(closed.reason === 'stop', 'Rear window never closed: ' + closed.reason);
    }
    const opened = await advance(row, { type: 'rearState', state: 'exposed' }, { max: 60 * 60 * 5 });
    qaAssert(opened.reason === 'stop', 'Rear window never opened: ' + opened.reason);
  }
  throw Error('Could not get a rear window with ' + minLeft + 's left');
}
/**
 * 보스 side('front'|'rear') 쪽 사거리에서 공격 키(KeyJ)로 타격을 하나 더 넣을 때까지 키보드로 걷는다(counter field 'fh'|'rh' 가 base 보다 1 이상 늘 때).
 * 4스텝마다 화면 방향을 다시 잡는다. 창이 닫히면 closed 로 돌려준다. 좌표 이동·무적은 없다. 사거리에 닿으면 보스 쪽 방향키를 누른 채 공격 키를 누른다(수동 공격은 입력 방향으로 선다).
 */
async function strikeFrom(row, side, field, base) {
  for (let i = 0; i < REAR_RUN.maxIterations; i++) {
    const a = await page.evaluate(s => window.__tideQa.rearAim(s), side);
    if (!a) throw Error('Boss or hero gone while striking from ' + side);
    if (a.state !== 'exposed') return { reason: 'closed', iterations: i };
    if (a[field] - base >= 1) return { reason: 'done', iterations: i };
    await setKeys(keysToward(a.arrived ? { dx: a.bdx, dy: a.bdy } : a), a.live);
    const attack = a.arrived && a.heroState !== 'attack';
    if (attack) await kb('down', REAR_RUN.attackKey);
    const r = await page.evaluate(opts => window.__tideQa.run(opts), { n: REAR_RUN.chunk });
    if (attack) await kb('up', REAR_RUN.attackKey);
    if (r.reason === 'inactive') throw Error('Battle ended while striking the chain executor by keyboard (hero down?)');
    if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row, r); await nativeGameplayFocus(page); }
  }
  throw Error('No ' + side + ' strike landed within ' + REAR_RUN.maxIterations + ' iterations');
}
/** AUTO 를 끄고 정면 타격 → 옆으로 돌아 등 뒤 타격을 키보드로 한다. 창이 모자라면 AUTO 를 켜 다음 창을 기다렸다 이어서 한다. 구간마다 manual-start/manual-end 표식을 남긴다. */
async function rearManual(row) {
  const gain = { fh: 0, rh: 0 };
  row.manual = { stints: [], cycles: 0 };
  while (gain.fh < 1 || gain.rh < 1) {
    if (++row.manual.cycles > REAR_RUN.maxCycles) throw Error('Manual rear strikes did not finish: ' + JSON.stringify(gain));
    const st = await ensureRearWindow(row, 0);
    qaAssert(st.state === 'exposed', 'Rear window not open for manual strikes');
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    keyPhase = 'walk';
    const start = await rearState();
    await rmark('manual-start');
    const stint = { startLeft: start.windowLeft, fh: start.frontHits, rh: start.rearHits, results: [] };
    // 등 뒤 타격은 정면 타격을 넣은 뒤의 것만 센다. 창이 열릴 때 영웅이 이미 등 뒤에 있으면 AUTO 가 남긴 콤보가 먼저 등 뒤를 칠 수 있다(b14 smoke s2-cand-rear).
    let rearBase = null;
    try {
      if (gain.fh < 1) { const res = await strikeFrom(row, 'front', 'fh', start.frontHits); stint.results.push({ side: 'front', ...res }); }
      if (stint.results.at(-1)?.reason !== 'closed' && gain.rh < 1) {
        rearBase = (await rearState()).rearHits;
        const res = await strikeFrom(row, 'rear', 'rh', rearBase); stint.results.push({ side: 'rear', ...res });
      }
    } finally { await setKeys(new Set()); await rmark('manual-end'); keyboardMode = false; }
    const end = await rearState();
    gain.fh += end.frontHits - start.frontHits; if (rearBase !== null) gain.rh += end.rearHits - rearBase;
    stint.rearBase = rearBase;
    stint.endLeft = end.windowLeft; stint.gain = { ...gain };
    row.manual.stints.push(stint);
  }
}

/** order·pause·screens 는 밀물 창이 있는 정의에서만 돈다. 정의가 없는 기준선이면 출격하기 전에 건너뛴다. */
const skipUnlessShockWindow = () => (judgedProfiles ? null : { skipped: '밀물 창(shockWindow)이 있는 심층 정의(ROUTE_OBJECTIVES.ember_deep)가 있는 빌드에서만 도는 프로필이다' });

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
    const why = skipUnlessShockWindow();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('order');
    qaAssert(row.gates >= 1, 'order profile needs valves');
    const gate0 = routeDef.gates[0].roomId, center = row.begin.rooms.find(r => r.id === gate0);
    const nearPad = { type: 'nearPad', gate: 0, r: ORDER.padNear };
    // 1) AUTO 로 1번 밸브가 ready·적/대기열 0 인 순간까지. 거기서 AUTO 를 실제 버튼으로 끈다. 여기부터 개방 표식까지 매 스텝을 관측한다.
    const ready = await advance(row, { type: 'ready', progress: 0, gate: 0 }, { max: 60 * 60 * 15 });
    check('order: AUTO 로 1번 밸브(방 ' + gate0 + ') ready·적 0 까지', ready.reason === 'stop', { reason: ready.reason, elapsed: ready.elapsed });
    qaAssert(ready.reason === 'stop', 'First valve never ready: ' + ready.reason);
    row.readyAt = await freeze();
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    await setDense(true);
    await mark('manual-start');
    // 2) 키보드로 현재 조작판 반경 1.2 안 → 첫 밀물(shocks 0→1)까지 머문다(닫힌 체류).
    row.walk1 = await walkTo(row, { pad: 0 }, nearPad);
    await mark('pad1');
    const tide1 = await advance(row, { type: 'shocks', gate: 0, min: 1 }, { max: 60 * 30 });
    check('order: 첫 밀물(shocks 0→1)까지 조작판 위에서 기다림', tide1.reason === 'stop', { reason: tide1.reason });
    qaAssert(tide1.reason === 'stop', 'First tide never passed: ' + tide1.reason);
    await mark('tide1');
    // 3) 옮겨 간 조작판으로 → 열린 유지 ≥ 1.0.
    row.walk2 = await walkTo(row, { pad: 0 }, nearPad);
    const partial = await advance(row, { type: 'hold', min: ORDER.minPartialHold, progress: 0 }, { max: 60 * 10 });
    check('order: 옮겨 간 조작판에서 열린 유지 ≥ ' + ORDER.minPartialHold + '초', partial.reason === 'stop', { reason: partial.reason });
    qaAssert(partial.reason === 'stop', 'Partial hold never reached: ' + partial.reason);
    row.partialAt = await freeze();
    await mark('partial');
    // 4) 조작판에서 3.0 밖(방 중심 쪽)으로 → hold 0.
    row.walkOut = await walkTo(row, { x: center.x, z: center.z }, { type: 'awayPad', gate: 0, r: ORDER.exitDistance });
    await advanceSteps(row, 2);
    await mark('exit');
    row.exitState = await freeze();
    const pad0 = row.exitState.g[0];
    check('order: 조작판에서 3.0 밖이면 hold 0·progress 불변', row.exitState.hd === 0 && row.exitState.pr === 0 && Math.hypot(row.exitState.x - pad0.px, row.exitState.z - pad0.pz) >= 3, row.exitState);
    // 5) 다음 밀물 경고(warning)가 되면 현재 조작판으로 들어가 다음 밀물까지 머문다(닫힌 체류). 합계가 모자라면 같은 방식으로 반복한다.
    const warn = await advance(row, { type: 'phase', gate: 0, phase: 'warning' }, { max: 60 * 12 });
    check('order: 조작판에서 나온 뒤 다음 밀물 경고(warning) 도달', warn.reason === 'stop', { reason: warn.reason });
    qaAssert(warn.reason === 'stop', 'Next warning never reached: ' + warn.reason);
    await mark('warn');
    let want = (await freeze()).gx[0].sk + 1;
    row.walk3 = await walkTo(row, { pad: 0 }, nearPad);
    const dwell2 = await advance(row, { type: 'shocks', gate: 0, min: want }, { max: 60 * 12 });
    qaAssert(dwell2.reason === 'stop', 'Second tide never passed: ' + dwell2.reason);
    row.dwellLoops = 0;
    while (await dwellSeconds() < ORDER.minDwell && row.dwellLoops < ORDER.maxDwellLoops) {
      row.dwellLoops++;
      await walkTo(row, { x: center.x, z: center.z }, { type: 'near', x: center.x, z: center.z, r: ORDER.centerNear });
      const again = await advance(row, { type: 'phase', gate: 0, phase: 'warning' }, { max: 60 * 12 });
      qaAssert(again.reason === 'stop', 'Warning never reached in dwell loop: ' + again.reason);
      want = (await freeze()).gx[0].sk + 1;
      await walkTo(row, { pad: 0 }, nearPad);
      const more = await advance(row, { type: 'shocks', gate: 0, min: want }, { max: 60 * 12 });
      qaAssert(more.reason === 'stop', 'Tide never passed in dwell loop: ' + more.reason);
    }
    row.dwellTotal = await dwellSeconds();
    check('order: 닫힌 조작판 위 체류 합계 ≥ ' + ORDER.minDwell + '초(관측 스텝 수 기준)', row.dwellTotal >= ORDER.minDwell, { dwell: row.dwellTotal, loops: row.dwellLoops });
    await mark('dwell-end');
    // 6) 옮겨 간 조작판으로 → 열린 유지로 개방(progress 1).
    row.walk4 = await walkTo(row, { pad: 0 }, nearPad);
    const cooled = await advance(row, { type: 'progress', n: 1 }, { max: 60 * 15 });
    check('order: 옮겨 간 조작판에서 새 유지로 progress 1', cooled.reason === 'stop', { reason: cooled.reason });
    qaAssert(cooled.reason === 'stop', 'First valve never opened by keyboard: ' + cooled.reason);
    await mark('cooled');
    row.cooledShot = await shot('order-first-opened');
    await setDense(false);
    // 7) AUTO 를 켜 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row);
    const analysis = analyzeOrder(traces.get(row.tag), routeDef, { rooms: row.begin.rooms, minDwell: 2 });
    row.order = analysis;
    check('order: 키보드 구간(AUTO 꺼짐·공격 입력/동작 없음·생존)', analysis.keyboard?.ok, analysis.keyboard);
    check('order: 닫힌 조작판 위 체류 합계 ≥ 2초 동안 유지 0·개방 없음', analysis.dwell?.ok, analysis.dwell);
    check('order: 열린 유지 ≥ 1.0 뒤 조작판 밖 3.0 이탈 → hold 0 (progress 불변)', analysis.partial?.ok, analysis.partial);
    check('order: 마지막 체류 뒤 새 유지가 열린 조작판에서 ≥ 2초 − 1/60 로 개방', analysis.final?.ok, analysis.final);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async pause() {
    const why = skipUnlessShockWindow();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('pause');
    // 첫 밸브를 열린 조작판에서 유지하는 중 hold ≥ 0.8 인 첫 스텝에서 멈춘다(2초 유지의 절반 안쪽).
    const reached = await advance(row, { type: 'hold', min: .8, progress: 0 }, { max: 60 * 60 * 12 });
    check('pause: AUTO 로 첫 밸브 열린 유지 hold ≥ 0.8 까지 진행', reached.reason === 'stop', { reason: reached.reason });
    qaAssert(reached.reason === 'stop', 'No hold reached: ' + reached.reason);
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(() => window.__tideQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await freeze();
    row.pauseShot = await shot('paused-hold');
    await resumeBattle();
    await mark('resume');
    const resumedRun = await advanceSteps(row, 30);
    const resumed = await freeze();
    const verdict = checkPause({ before, paused, still, resumed, steps: 30 });
    row.pauseCheck = { before, paused, still, resumed, resumeReason: resumedRun.reason, verdict };
    check('pause: 열린 유지 중 120스텝+1초 동안 게임 시간·밀물 주기(age·phase·shocks)·progress 불변·hold 0', verdict.frozen, verdict);
    check('pause: 재개 뒤 hold 가 0 에서 새로 시작(30스텝 안)', verdict.resumedOk, verdict);
    await playToEnd(row);
    const cooled = analyzePauseCooling(traces.get(row.tag), routeDef, { rooms: row.begin.rooms, reinforcements: row.reinforcements });
    row.pauseCooling = cooled;
    check('pause: 재개 뒤 그 밸브가 새 유지 ≥ ' + routeDef.holdSeconds + '초 − 1/60 을 열린 조작판에서 채워 개방', cooled.ok, cooled);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async keys() {
    await applyFixture();
    const row = await beginRun('keys');
    keyEvents.length = 0; keyPhase = 'walk';
    // 1) AUTO 로 첫 밸브 방 정화까지(후보: 밸브 ready·적 0, 기준선: 방 cleared). 거기서 AUTO 를 실제 버튼으로 끈다.
    const first = await advance(row, { type: 'firstClear', room: firstValveRoom }, { max: 60 * 60 * 15 });
    check('keys: AUTO 로 첫 밸브 방(' + firstValveRoom + ') 정화까지', first.reason === 'stop', { reason: first.reason, elapsed: first.elapsed });
    qaAssert(first.reason === 'stop', 'First valve room never cleared: ' + first.reason);
    row.readyAt = await freeze();
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    // 2) 키를 누를 위치 잡기: 첫 밸브 방 서쪽(동쪽으로 걸을 공간)으로 걷고 멈춘다. 이 걷기는 판정 구간 밖이며 키 이벤트는 walk 단계로 기록된다.
    const room = row.begin.allRooms.find(r => r.id === firstValveRoom);
    qaAssert(room, 'First valve room not in world: ' + firstValveRoom);
    const spot = { x: room.x - KEYS.startOffset, z: room.z };
    row.walkStart = await walkTo(row, spot, { type: 'near', x: spot.x, z: spot.z, r: KEYS.startNear });
    await advanceSteps(row, 12);
    row.focusAgain = await nativeGameplayFocus(page);
    const k = { events: keyEvents, interrupted: null, hold: null, pause: null, resume: null, release: null, x0: null, resumeX0: null };
    // 3) KeyD 를 누른 채(down 1회) 30스텝. 각인 창 등으로 끊기면 키를 떼고 처리한 뒤 다시 한다(정지 전 단계라 재시도 허용, 이벤트는 마지막 시도만 남긴다).
    for (let attempt = 0; attempt < 3 && !k.hold; attempt++) {
      for (let i = keyEvents.length - 1; i >= 0; i--) if (keyEvents[i].phase === 'hold') keyEvents.splice(i, 1);
      k.x0 = (await freeze()).x;
      keyPhase = 'hold'; await kb('down', KEYS.key);
      const hold = await page.evaluate(o => window.__tideQa.run(o), { n: KEYS.steps, seg: 'hold' });
      if (hold.reason === 'n') { k.hold = hold.keyRows; break; }
      keyPhase = 'walk'; await kb('up', KEYS.key);
      if (hold.reason === 'paused') { await takeChoice(row, hold); await nativeGameplayFocus(page); } else { k.interrupted = { segment: 'hold', reason: hold.reason }; break; }
    }
    if (!k.hold && !k.interrupted) k.interrupted = { segment: 'hold', reason: 'choice-repeat' };
    if (!k.interrupted) {
      // 4) #btn-pause → 정지 중 60스텝 + 0.5초(게임 시간·위치 불변 확인) → #btn-resume. 이 구간에 키 이벤트는 보내지 않는다.
      keyPhase = 'pause';
      const before = await freeze();
      await pauseBattle();
      const paused = await freeze();
      await page.evaluate(n => window.__tideQa.stepRaw(n), KEYS.pauseSteps); await page.waitForTimeout(KEYS.pauseWaitMs);
      const still = await freeze();
      k.pause = { before, paused, still };
      row.pauseShot = await shot('keys-paused');
      // 5) 재개 뒤 키를 다시 누르지 않고 30스텝. 영웅 x 와 app.input.keys.KeyD 를 스텝마다 읽는다.
      keyPhase = 'resume';
      await resumeBattle();
      k.resumeX0 = (await freeze()).x;
      const resume = await page.evaluate(o => window.__tideQa.run(o), { n: KEYS.steps, seg: 'resume' });
      k.resume = resume.keyRows;
      if (resume.reason !== 'n') k.interrupted = { segment: 'resume', reason: resume.reason, pauseReasons: resume.pauseReasons };
      // 6) keyup 1회 뒤 30스텝: 멈추고 KeyD 가 false.
      keyPhase = 'release';
      await kb('up', KEYS.key);
      const release = await page.evaluate(o => window.__tideQa.run(o), { n: KEYS.steps, seg: 'release' });
      k.release = release.keyRows;
      if (release.reason !== 'n' && !k.interrupted) k.interrupted = { segment: 'release', reason: release.reason, pauseReasons: release.pauseReasons };
      keyPhase = 'walk';
    }
    row.keysData = k;
    // 완주 뒤 recordTide 가 '<태그>-trace.json'(keys 프로필은 'keys-trace.json')을 쓰므로 이름을 겹치지 않게 둔다(smoke-cand-keys-1 EEXIST).
    const keysFile = 'keys-input.json';
    fs.writeFileSync(path.join(qa.out, keysFile), JSON.stringify(k), { flag: 'wx' });
    row.keysFile = keysFile;
    if (routeDef) {
      const verdict = checkKeys(k);
      row.keys = verdict;
      check('keys: 사전 조건 — KeyD 를 누른 채 30스텝 이동(x ≥ 0.5)·KeyD true, 정지 중 게임 시간·위치 불변', verdict.precondition, verdict);
      check('keys: 재개 뒤 키 재입력 없이 30스텝 안에 영웅 x 가 0.5 이상 늘고 app.input.keys.KeyD true', verdict.resumed, verdict);
      check('keys: keyup 뒤 30스텝 안에 멈추고 app.input.keys.KeyD false', verdict.released, verdict);
      check('keys: 키 이벤트 로그 — hold 에 KeyD down 1회, pause·resume 에 이벤트 없음, release 에 KeyD up 1회', verdict.events, { hold: verdict.holdEvents, pause: verdict.pauseEvents, resume: verdict.resumeEvents, release: verdict.releaseEvents });
    } else {
      // 기준선: 판정하지 않고 이동 여부만 기록한다. 단계를 끝까지 돌렸는지만 확인한다.
      row.keys = describeBaselineKeys(k);
      report.baselineKeys = row.keys;
      check('keys(기준선): 모든 단계를 끝까지 돌림(이동 여부는 판정하지 않고 report.baselineKeys 에 기록)', !k.interrupted && k.hold?.length === KEYS.steps && k.resume?.length === KEYS.steps && k.release?.length === KEYS.steps, { interrupted: k.interrupted });
    }
    // 7) AUTO 를 켜 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async rear() {
    const why = skipUnlessRear();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('rear');
    keyEvents.length = 0; keyPhase = 'walk';
    // 1) AUTO 로 보스방까지(밸브 3/3·봉인 해제·보스 등장) 진행해 첫 후방 창이 열린 스텝에서 멈춘다.
    const first = await advance(row, { type: 'rearState', state: 'exposed' }, { max: 60 * 60 * 20 });
    check('rear: AUTO 로 보스방까지 가서 첫 후방 창이 열림', first.reason === 'stop', { reason: first.reason, elapsed: first.elapsed });
    qaAssert(first.reason === 'stop', 'First rear window never opened: ' + first.reason);
    row.firstWindow = await freeze();
    // 2) R #btn-auto 끔 → 키보드로 정면 타격, 옆으로 돌아 등 뒤 타격.
    await rearManual(row);
    check('rear: 키보드로 정면 타격 ≥ 1 · 등 뒤 타격 ≥ 1 (AUTO 꺼짐, 구간 ' + row.manual.stints.length + '개)', row.manual.stints.length >= 1, row.manual);
    // 3) 창 안에서 R #btn-pause → 60스텝 + 0.5초 동안 windowLeft·보스 yaw 불변 → R #btn-resume.
    await ensureRearWindow(row, REAR_RUN.pauseMinLeft);
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(n => window.__tideQa.stepRaw(n), REAR_RUN.pauseSteps); await page.waitForTimeout(REAR_RUN.pauseWaitMs);
    const still = await freeze();
    row.pauseShot = await shot('rear-paused');
    await resumeBattle();
    await advanceSteps(row, REAR_RUN.resumeSteps);
    const resumed = await freeze();
    const slim = x => ({ elapsed: x.elapsed, paused: x.paused, rear: x.rear });
    row.rearPause = { before: slim(before), paused: slim(paused), still: slim(still), resumed: slim(resumed), verdict: checkRearPause({ before, paused, still, resumed, steps: REAR_RUN.resumeSteps }) };
    check('rear: 창 안 정지 60스텝+0.5초 동안 게임 시간·windowLeft·보스 yaw·attackSequence·위치 불변, 재개 뒤 windowLeft 가 흐른 시간만큼 줄고 yaw 유지', row.rearPause.verdict.ok, row.rearPause.verdict);
    // 4) R AUTO 켬 → 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async screens() {
    const why = skipUnlessShockWindow();
    if (why) return why;
    await applyFixture();
    const row = await beginRun('screens');
    const labels = [...MOMENTS, ...(rearDef ? REAR_MOMENTS : [])];
    await playToEnd(row, { momentLabels: labels });
    const verdict = checkScreens(row.shots, labels, SCREEN_VIEWPORTS.length);
    check('screens: 모든 순간에 도달해 3개 화면 크기 PNG 를 남김', verdict.ok, verdict.rows);
    row.screensCheck = verdict;
    for (const label of labels) {
      const s = row.shots.find(x => x.label === label);
      if (!s?.reached) continue;
      const rearMoment = REAR_MOMENTS.includes(label);
      s.look = rearMoment ? checkRearMoment(s, rearDef, label) : checkScreenMoment(s, routeDef, label);
      // PNG 마다 그 순간 gate(후방 순간은 후방) 상태를 남긴다(사람이 PNG 와 맞춰 본다).
      s.pngStates = s.files.map(file => ({ file, label, elapsed: s.capture.elapsed, gate: rearMoment ? s.look.rear : s.look.gate }));
      check('screens: ' + label + (rearMoment ? ' 순간의 보스 후방 상태·부채꼴/갑주 호·목표창 (촬영 스텝 행)' : ' 순간의 1번 밸브 상태·뷰 표시 (촬영 스텝 행)'), s.look.ok, s.look);
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
      // 실패 표본의 원인을 남긴다: 밸브 상태, 최근 관측 행, 목표창, 생존 적. 새로고침 전에 읽는다.
      report.profiles[name].diagnostic = await page.evaluate(() => {
        const a = window.app, b = a.battle, q = window.__tideQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.(false) ?? null, recentRows: q?.rows?.slice(-30) ?? null, hpDrops: q?.hpDrops?.slice(-20) ?? null, toasts: q?.toasts?.slice(-20) ?? null,
          objective: document.getElementById('objective')?.textContent ?? null, curRoom: b.curRoom?.id ?? null, sealed: !!b.world.sealed, alive,
          auto: !!b.player?.auto, playerState: b.player?.state ?? null, inputKeys: { ...a.input.keys }, inputEnabled: !!a.input.enabled };
      }).catch(diagError => ({ error: String(diagError) }));
      report.profiles[name].keyEvents = keyEvents.slice(-40);
      await setKeys(new Set()).catch(() => {});
      await page.keyboard.up(KEYS.key).catch(() => {});
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
console.log(JSON.stringify({ status: report.status, out: qa.out, depth, valveDefinition: !!routeDef, rearDefinition: !!rearDef, reseed: report.reseed, load: report.load, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
