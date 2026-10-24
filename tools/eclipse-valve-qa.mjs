#!/usr/bin/env node
// 일식 수문(eclipse_hydra_vault 일반·심층) 역류 밸브 봉인 실제 UI QA 도구 (BUNDLE-07 qa lane).
// 실제 빌드(dist)를 production preview 로 띄우고, 실제 UI 버튼으로 출격해 밸브 봉인 전 과정을 app.step 한 번마다 관측한다.
// 공유 tools/expedition-qa-runtime.mjs 를 수정 없이 쓴다(clean HEAD·dist·소스 해시 결속, 콘솔/네트워크/미디어 분류).
// 읽기 경로: app.battle.routeObjectives (progress/hold/gates[i].{room,ready,attuned}/def/view.count/view.drawCalls), gates[i].room.{id,x,z,type,cleared,discovered,forgeWave},
// app.battle.world.{sealed,rooms,roomAt,linkPending}, app.battle.{enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, paused},
// 목표창 #objective textContent(10Hz 갱신이라 유지 0.5초 뒤부터 표본), 결과 화면 .exp-result-shell innerText 와 app.expeditionUI.result.routeObjective,
// app.renderer.r.info.render.calls(방 첫 진입 draw call 표본, renderer.render() 단독 호출), app.renderer.scene 의 InstancedMesh(뷰 인스턴스 스냅샷),
// route.view.group.visible(뷰 실제 draw call A/B: 밸브 모습이 바뀐 스텝 끝에서 같은 프레임을 그룹 켠 채·끈 채 renderer.render() 로 한 번씩 그려 calls 차이를 잰다. 시뮬레이션 스텝 없음, 끝나면 visible 복원).
// 경로 정의(ROUTE_OBJECTIVES.eclipse_deep)가 없는 기준선 빌드(--project)에서는 밸브 판정을 건너뛰고 공통 측정만 남긴다.
// 일반 기준선(정의는 있고 view 만 없음)은 밸브 3개 규칙 판정을 하고 뷰 판정만 건너뛴다.
// 판정 함수는 tools/eclipse-valve-checks.mjs 에 있고 test/eclipse-valve-checks.test.ts 가 합격·불합격 입력을 모두 검사한다. 기준선 비교는 tools/eclipse-valve-compare.mjs 다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { analyzeOrder, analyzePauseSeal, analyzeValves, checkPause, checkScreenMoment, checkScreens, stepStats, streamBase } from './eclipse-valve-checks.mjs';

const HELP = [
  '사용법: node tools/eclipse-valve-qa.mjs --expected-sha=<40hex> --out=<새 절대경로> [옵션]',
  '',
  '필수',
  '  --expected-sha=<40hex>   검사 대상 프로젝트의 clean HEAD 이자 dist/version.json 의 sha',
  '  --out=<절대경로>          새로 만들 결과 폴더(부모 폴더는 이미 있어야 하며 기존 폴더를 덮지 않는다)',
  '',
  '옵션',
  '  --project=<절대경로>      검사 대상 프로젝트 루트(기본: 이 도구가 있는 저장소). dist 가 미리 빌드돼 있어야 한다(이 도구는 빌드하지 않는다).',
  '                           심층 정의(ROUTE_OBJECTIVES.eclipse_deep)가 없는 기준선 빌드(예: dbdde51)도 받는다. 그때는 밸브 판정을 건너뛰고 공통 측정만 남긴다.',
  '  --depth=<standard|deep>  개인 기본 원정 eclipse_hydra_vault 의 일반 카드 또는 심층 카드(기본 deep). 접근·에너지·증원 횟수는 대상 프로젝트 데이터에서 읽는다.',
  '  --profile=<목록>          auto|order|pause|screens|all (쉼표로 여러 개, 기본 auto). order 는 심층 전용(밸브 4개, 순서 대기)',
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
  '           + 밸브 판정: 봉인마다 방 순서·직전 연속 유지(게임 시각 길이·반경 안)·적/대기열 0·정예방 증원·순서 대기·보스 봉인 해제·결과/결과 줄·목표창·뷰(고리·물줄기 색, 물줄기 높이)',
  '           + 뷰 실제 draw call A/B(C): 밸브 모습이 바뀐 스텝 끝에서 같은 프레임을 뷰 그룹 켠 채·끈 채 한 번씩 그려 calls 차이(viewGpuCalls) ≤ 3 이고 route.view.drawCalls 와 같은지(표본 ≥ 3, 차례·유지·봉인 포함)',
  '  order    AUTO 로 progress 2·방 5 ready·적 0 까지 → R #btn-auto 끔 → R 키보드(KeyW/A/S/D)로 방 5 중심 → 3초(progress 불변·방 5 cleared 아님) → R AUTO 켬 →',
  '           progress 3 에서 R AUTO 끔 → R 키보드로 방 5 중심에서 유지 ≥ 1.0 뒤 반경 밖(중심에서 4.0) → hold 0 → 다시 중심 → progress 4(공격 키 없음) → R AUTO 켬 → 완주',
  '  pause    유지 hold ≥ 0.8 에서 R #btn-pause → 120스텝+1초 게임 시간 불변·hold 0 → R #btn-resume → 새 유지 ≥ 2초 뒤 봉인 → 완주',
  '  screens  다음 밸브·유지 중(hold ≥ 1.0)·순서 대기(심층)·봉인 직후 0.5초 순간마다 640x360, 844x390, 390x844 PNG + 결과 PNG, 순간마다 뷰 상태(인스턴스 스냅샷) 기록',
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
const DUNGEON_ID = 'eclipse_hydra_vault';
/** order 프로필: 방 5 중심에 닿았다고 보는 반경, 반경 밖으로 나갈 목표 거리(PLAN 6절), 순서 대기 구간 길이(스텝). */
const ORDER = Object.freeze({ near: 1.5, exitDistance: 4.0, waitSteps: 180, minPartialHold: 1.0 });

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
// 밸브 정의. 심층 기준선(dbdde51)에는 eclipse_deep 이 없어 null 이고 밸브 판정을 건너뛴다. 일반 기준선은 정의가 있고 view 만 없다.
const routeData = (await load('src/data/route-objectives.js')).ROUTE_OBJECTIVES ?? {};
const routeDef = (deep ? routeData.eclipse_deep : routeData.eclipse_standard) ?? null;
const viewExpected = !!routeDef?.view;
const valveRooms = routeDef ? routeDef.gates.map(g => g.roomId) : null;
const needsKeyboard = selected.includes('order');

const STEP_CLASS = {
  auto: [['F', '저장 주입(해금·영웅 Lv.50 별3 스킬5·장비·에너지·AUTO)'], ['R', '출격 카드 버튼 · #btn-auto'], ['C', 'app.testPause + 고정 1/60 app.step 으로 완주'],
    ['C', 'app.step 한 번마다 page.evaluate 한 번에 관측(읽기 전용, 상태 변화·유지 중·1초 간격 행)'], ['C', 'renderer.render() 단독 호출로 방 첫 진입 draw call 표본'], ['R', '결과 화면 DOM · 로비 버튼 · 새로고침']],
  order: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-auto 끔/켬'], ['C', 'AUTO 로 progress 2·방 5 ready·적 0 까지 고정 스텝'],
    ['R', '키보드 KeyW/A/S/D 로 방 5 중심 이동·대기·반경 밖 이탈·재진입(공격 키 없음)'], ['C', '키 입력 사이 4스텝씩 고정 진행'], ['C', 'AUTO 완주 · 결과 판정']],
  pause: [['F', '저장 주입'], ['R', '출격 카드 버튼 · #btn-pause/#btn-resume'], ['C', 'AUTO 로 유지 hold ≥ 0.8 까지 고정 스텝'], ['C', '정지 중 app.step 120회(stepRaw)로 게임 시간 불변 확인'], ['C', 'AUTO 완주']],
  screens: [['F', '저장 주입'], ['R', '출격 카드 버튼'], ['C', 'AUTO 로 다음 밸브·유지 중·순서 대기·봉인 직후 순간까지 고정 스텝'], ['C', 'renderer.render() 단독 호출 + viewport 3종 스크린샷(시뮬레이션 tick 없음)']],
};
/** 뷰가 있는 빌드에서 모든 프로필의 프로브가 하는 제어 렌더. */
const VIEW_AB_STEP = ['C', '뷰 실제 draw call A/B: 밸브 모습이 바뀐 스텝 끝에서 같은 프레임을 route.view.group.visible true/false 로 renderer.render() 한 번씩(시뮬레이션 스텝 없음, 끝나면 visible 복원)'];
if (viewExpected) for (const list of Object.values(STEP_CLASS)) list.push(VIEW_AB_STEP);
const report = { kind: 'eclipse-valve-qa', releaseApproved: false, seed, heroId, depth, viewport, motion, quality, selectedProfiles: selected, projectRoot,
  driverSha256: qaHash(fs.readFileSync(import.meta.filename)),
  checksSha256: qaHash(fs.readFileSync(path.join(import.meta.dirname, 'eclipse-valve-checks.mjs'))), profiles: {}, checks: [], reportItems: {},
  reseed: { on: reseedOn, elapsed: null }, routeDefinition: routeDef ? JSON.parse(JSON.stringify(routeDef)) : null, viewDefined: viewExpected, valveRooms,
  catalog: { id: dungeonDef.id, depth, energy: dungeonDef.energy, minLevel: dungeonDef.minLevel, unlockCode: dungeonDef.unlockCode ?? null, rewards: dungeonDef.rewards,
    firstRewards: dungeonDef.firstRewards ?? null, objective: dungeonDef.objective ?? null, mechanics: dungeonDef.mechanics ?? null, routeId: routeDef?.id ?? null },
  selectors: { launch: ['#btn-expedition', '.adventure-nav [data-section="dungeons"]', '.exp-route-tabs button /^' + (deep ? '심층' : '기본') + ' 원정/',
      ...(deep ? [] : ['details.exp-dungeon-details > summary (닫혀 있으면)']), '[data-dungeon="' + DUNGEON_ID + '"][data-depth="' + depth + '"] .exp-primary'],
    battle: ['#btn-auto', '#btn-pause', '#btn-resume', '#pause-overlay.show', '#gl (canvas 포커스)', '#objective (목표창 textContent, 10Hz 갱신이라 유지 0.5초 뒤부터 표본)'],
    result: ['.exp-result-shell (결과 줄 innerText, "역류 밸브 봉인 n/n · 완료")', '.exp-result-footer .exp-primary', '.exp-result-shell .exp-close'],
    page: ['window.app.battle.routeObjectives (progress/hold/gates[i].room/ready/attuned/def/view.count/view.drawCalls/view.group.visible)', 'window.app.battle.world (sealed/rooms/roomAt/linkPending)',
      'window.app.battle (enemies[].homeRoom/alive, pending[].room, curRoom, stage.expedition.mechanics, player.pos/hp/auto/state)', 'window.app.input.attackHeld',
      'window.app.renderer.r.info.render.calls', 'window.app.renderer.scene (InstancedMesh: instanceMatrix 스케일·instanceColor)', 'window.app.expeditionUI.result.routeObjective',
      'window.__qaReseed (init script)', 'window.app.expedition.dungeonAccess'] },
  classification: {
    fixture: ['저장 주입: 해금(진행 별·탐험 레벨' + (deep ? '·기본 원정 승리' : '') + ')·영웅 레벨/별/스킬·장비·에너지 최대·AUTO 설정', 'Math.random 시드(LCG)와 window.__qaReseed(seed) 재시드(전투 활성·prepareView 뒤 첫 스텝 전 1회)',
      quality === 'low' ? '낮은 화질 설정(설정 핸들러와 같은 경로)' : null].filter(Boolean),
    realInput: ['#btn-expedition → 던전 탭 → ' + (deep ? '심층' : '기본') + ' 원정 → 카드 출격 버튼', '#btn-auto', '#btn-pause/#btn-resume', '결과 화면 버튼(로비로)', '선택지 모달 버튼', '브라우저 새로고침',
      needsKeyboard ? 'Playwright 키보드 이벤트(KeyW/A/S/D, 에뮬레이터 입력): 걷는 방향은 도구가 방 연결(L자 복도) 경로의 화면 투영으로 정함. 텔레포트·무적·HP 주입·공격 키 없음' : null].filter(Boolean),
    controlled: ['app.testPause + 고정 1/60초 app.step (자연 RAF 아님)', 'renderer.render() 단독 호출(스크린샷·draw call 샘플, 시뮬레이션 tick 없음)',
      viewExpected ? '뷰 draw call A/B: route.view.group.visible 을 켜고 끈 같은 프레임을 renderer.render() 로 각각 그려 calls 차이 측정(끝나면 visible 복원)' : null].filter(Boolean),
    notProven: ['실제 Android/GPU/터치/발열', '자연 해금·장비 획득', '수동 플레이 밸런스', '사람의 실제 키보드·터치 조작 감각'],
    steps: Object.fromEntries(selected.map(name => [name, STEP_CLASS[name].map(([kind, detail]) => ({ kind, detail }))])) },
  scope: '로컬 production preview + SwiftShader headless Chromium. fixture 영웅/장비로 합법 범위 값만 주입하고 전투 중 HP·위치·적·결과는 건드리지 않는다.' };

const sourceFiles = ['src/game/route-objectives.js', 'src/game/backflow-valve-view.js', 'src/data/route-objectives.js', 'src/data/expedition-depths.js', 'src/data/expansion.js',
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
  const P = window.__eclipseValveQa = { dt: 1 / 60, steps: 0, cfg };
  const routeOf = () => app.battle.routeObjectives;
  const EMPTY = [];
  // ---- 뷰 인스턴스 스냅샷: 공개 Three 객체(InstancedMesh)만 읽는다. route.view 의 공개 필드 → 이름(backflow|valve|밸브) → 개수 일치 순으로 찾는다. ----
  const sceneOf = () => app.renderer.scene;
  const visibleChain = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const toSrgb = c => c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055;
  const hexOf = (r, g, b) => (Math.round(Math.min(1, Math.max(0, toSrgb(r))) * 255) << 16) | (Math.round(Math.min(1, Math.max(0, toSrgb(g))) * 255) << 8) | Math.round(Math.min(1, Math.max(0, toSrgb(b))) * 255);
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const viewMeshes = () => {
    const found = [], seen = new Set(), n = cfg.gateCount;
    const add = o => { if (o?.isInstancedMesh && o.count === n && !seen.has(o)) { seen.add(o); found.push(o); } };
    let by = null;
    const view = routeOf()?.view;
    if (view && typeof view === 'object') {
      for (const key of Object.keys(view)) {
        const v = view[key];
        if (!v || typeof v !== 'object' || v === sceneOf() || v.isScene || v === routeOf()) continue;
        add(v); if (v.isObject3D && typeof v.traverse === 'function') v.traverse(add);
      }
      if (found.length) by = 'view-props';
    }
    if (!found.length) {
      sceneOf().traverse(o => { if (!o.isInstancedMesh) return; for (let p = o; p; p = p.parent) if (/backflow|valve|밸브/i.test(p.name || '')) { add(o); return; } });
      if (found.length) by = 'name';
    }
    if (!found.length) {
      sceneOf().traverse(add);
      if (found.length && found.length <= 6) by = 'count-fallback'; else found.length = 0;
    }
    return { found, by };
  };
  P.visSnapshot = () => {
    const { found, by } = viewMeshes();
    return { found: found.length > 0, by, meshes: found.map(m => {
      const a = m.instanceMatrix.array, ic = m.instanceColor ? m.instanceColor.array : null, shown = visibleChain(m), inst = [];
      for (let i = 0; i < m.count; i++) {
        const o = i * 16;
        inst.push({ s: shown ? [r6(Math.hypot(a[o], a[o + 1], a[o + 2])), r6(Math.hypot(a[o + 4], a[o + 5], a[o + 6])), r6(Math.hypot(a[o + 8], a[o + 9], a[o + 10]))] : [0, 0, 0],
          c: ic ? hexOf(ic[i * 3], ic[i * 3 + 1], ic[i * 3 + 2]) : null });
      }
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      return { name: m.name || '', count: m.count, transparent: !!mat?.transparent, mc: mat?.color?.getHex ? mat.color.getHex() : null, inst };
    }) };
  };
  const viewCounts = () => { const v = routeOf()?.view; return v ? { c: v.count, d: v.drawCalls } : null; };
  // ---- 뷰 실제 draw call A/B: 밸브마다 모습 코드(0 hidden, 1 sealed, 2 holding, 3 next, 4 waiting)가 바뀐 스텝 끝에서 측정한다. 코드는 sig(관측값)로만 계산한다. ----
  const abChanged = () => {
    const r = routeOf(), s = P.sig;
    if (!r) return null;
    let changed = null;
    for (let i = 0; i < r.gates.length; i++) {
      const o = 6 + i * 7, code = s[o + 4] !== 1 ? 0 : s[o + 1] === 1 ? 1 : i === s[1] ? (s[5] === 1 ? 2 : 3) : 4;
      if (code !== P.abCodes[i]) { (changed ??= []).push(i); P.abCodes[i] = code; }
    }
    return changed;
  };
  /** 같은 프레임을 뷰 그룹 켠 채·끈 채 한 번씩 그린다(P.sample 과 같은 info.reset + renderer.render 경로, app.step 없음). visible 과 autoReset 은 반드시 복원한다. */
  P.measureView = changed => {
    const b = app.battle, r = routeOf(), view = r?.view, group = view?.group;
    const rec = { n: P.steps, t: b.elapsed, pr: r.progress, hd: r.hold, g: r.gates.map(g => ({ dc: g.room.discovered ? 1 : 0, at: g.attuned ? 1 : 0 })), changed,
      viewCalls: view ? view.drawCalls : null, on: null, off: null };
    if (!group) return rec;
    const info = app.renderer.r.info, autoReset = info.autoReset, visible = group.visible;
    info.autoReset = false;
    try {
      group.visible = true; info.reset(); app.renderer.render(); rec.on = info.render.calls;
      group.visible = false; info.reset(); app.renderer.render(); rec.off = info.render.calls;
    } finally { group.visible = visible; info.autoReset = autoReset; }
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
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i], room = g.room, o = 6 + i * 7;
      let al = 0, pd = 0;
      for (const e of b.enemies) if (e.alive && e.homeRoom === room) al++;
      for (const q of b.pending) if (q.room === room) pd++;
      s[o] = g.ready ? 1 : 0; s[o + 1] = g.attuned ? 1 : 0; s[o + 2] = room.cleared ? 1 : 0; s[o + 3] = room.forgeWave || 0; s[o + 4] = room.discovered ? 1 : 0; s[o + 5] = al; s[o + 6] = pd;
    }
  };
  const build = mk => {
    const b = app.battle, p = b.player, r = routeOf(), gs = r ? r.gates : EMPTY, s = P.sig;
    const row = { n: P.steps, t: b.elapsed, x: p.pos.x, z: p.pos.z, hp: p.hp, mhp: p.maxHp, al: p.alive ? 1 : 0, rm: s[0], pr: s[1], hd: r ? r.hold : 0, sl: s[2], rem: s[3], au: s[4],
      ah: app.input.attackHeld ? 1 : 0, ps: p.state,
      g: gs.map((g, i) => { const o = 6 + i * 7; return { id: g.room.id, rd: s[o], at: s[o + 1], cl: s[o + 2], fw: s[o + 3], dc: s[o + 4], al: s[o + 5], pd: s[o + 6] }; }) };
    if (mk) row.mk = mk;
    return row;
  };
  const push = row => { P.rows.push(row); P.prevSig.set(P.sig); P.prevHd = row.hd; };
  P.begin = () => {
    const b = app.battle, r = routeOf(), gn = r ? r.gates.length : 0, size = 6 + gn * 7;
    Object.assign(P, { hpDrops: [], clears: [], samples: [], viewAB: [], abCodes: new Int8Array(gn).fill(-1), stepMs: [], renderMs: [], slow: [], maxAlive: 0, minHpRatio: 1, steps: 0, startElapsed: b.elapsed, rows: [],
      sig: new Float64Array(size), prevSig: new Float64Array(size).fill(-1e9), prevHd: 0, vkey: null, vstable: 0, entered: new Set(), wp: [], marks: [] });
    P.prevRoom = b.curRoom?.id ?? null;
    P.prev = { cleared: b.world.rooms.map(x => !!x.cleared), hp: b.player.hp };
    fill();
    abChanged();   // 시작 모습을 기준으로 삼는다(시작 직후는 측정하지 않는다)
    const row = build('start');
    if (cfg.viewExpected) row.vw = viewCounts();
    push(row);
    const rooms = r ? r.gates.map(g => ({ id: g.room.id, x: g.room.x, z: g.room.z, type: g.room.type })) : [];
    return { kind: r?.def?.kind ?? null, controller: r ? r.constructor.name : null, routeId: r?.def?.id ?? null, gates: gn, rooms, hasView: !!r?.view, view: viewCounts(),
      allRooms: b.world.rooms.map(x => ({ id: x.id, type: x.type, x: x.x, z: x.z })), reinforcements: b.stage?.expedition?.mechanics?.reinforcements ?? 0,
      def: r ? { id: r.def.id, holdSeconds: r.def.holdSeconds, radius: r.def.radius, noun: r.def.noun, verb: r.def.verb, view: r.def.view ?? null } : null };
  };
  P.sample = (label, extra) => {
    const b = app.battle, info = app.renderer.r.info, prev = info.autoReset;
    info.autoReset = false; info.reset();
    const t0 = performance.now(); app.renderer.render(); const ms = performance.now() - t0;
    const row = { label, ...(extra || {}), t: b.elapsed, room: b.curRoom?.id ?? null, calls: info.render.calls, triangles: info.render.triangles, ms: +ms.toFixed(2), view: viewCounts() };
    info.autoReset = prev; P.samples.push(row); return row;
  };
  const observe = () => {
    const b = app.battle, p = b.player, r = routeOf();
    fill();
    const s = P.sig, q = P.prevSig, hd = r ? r.hold : 0;
    let changed = false;
    for (let i = 0; i < s.length; i++) if (s[i] !== q[i]) { changed = true; break; }
    // 뷰 표본 키: 진행·유지 여부·밸브별 ready/attuned/discovered. 키가 3스텝 변하지 않으면 안정된 모습으로 보고 인스턴스를 한 번 읽는다.
    let key = s[1] * 2 + s[5];
    for (let i = 0; i < (r ? r.gates.length : 0); i++) { const o = 6 + i * 7; key = key * 8 + s[o] * 4 + s[o + 1] * 2 + s[o + 4]; }
    if (key !== P.vkey) { P.vkey = key; P.vstable = 0; } else P.vstable++;
    const wantVis = cfg.viewExpected && !!r && (P.vstable === 3 || P.steps % 300 === 0);
    if (changed || hd > 0 || P.prevHd > 0 || P.steps % 60 === 0 || wantVis) {
      const row = build(null);
      if (hd >= .5 && P.steps % 6 === 0) row.dom = document.getElementById('objective')?.textContent ?? null;
      if (wantVis) { row.vw = viewCounts(); row.vis = P.visSnapshot(); }
      push(row);
    }
    b.world.rooms.forEach((room, i) => { if (room.cleared && !P.prev.cleared[i]) { P.clears.push({ t: b.elapsed, room: room.id, type: room.type }); P.prev.cleared[i] = true; } });
    // 밸브 모습이 바뀐 스텝 끝: 같은 프레임의 뷰 draw call A/B(최대 40회).
    if (cfg.viewExpected && r) { const ch = abChanged(); if (ch && P.viewAB.length < 40) P.viewAB.push(P.measureView(ch)); }
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
  };
  P.hit = stop => {
    const b = app.battle, r = routeOf(), p = b.player.pos;
    switch (stop.type) {
      case 'time': return b.elapsed >= stop.t;
      case 'result': return !!app.expeditionUI.result;
      case 'progress': return !!r && r.progress >= stop.n;
      case 'hold': return !!r && r.hold >= stop.min && (stop.progress == null || r.progress === stop.progress);
      case 'next': { const g = r?.gates[stop.gate]; return !!g && g.room.discovered && !g.attuned && r.progress === stop.progress && r.hold === 0; }
      case 'orderReady': { const g = r?.gates[stop.gate]; return !!g && r.progress === stop.progress && g.ready && !g.attuned && gateClear(g); }
      case 'waiting': { const g = r?.gates[stop.gate]; return !!g && g.ready && !g.attuned && r.progress < stop.below && r.progress >= (stop.min ?? 0) && r.hold === 0 && gateClear(g); }
      case 'near': return Math.hypot(p.x - stop.x, p.z - stop.z) <= stop.r;
      case 'away': return Math.hypot(p.x - stop.x, p.z - stop.z) >= stop.r;
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
  // 구간 표식: 현재 상태의 행을 mk 와 함께 하나 더 넣는다. 같은 스텝의 행과 n 이 겹칠 수 있어 판정은 행 순서(인덱스)로 구간을 자른다.
  P.mark = label => {
    const b = app.battle; if (!b?.world || !b.player) return null;
    fill();
    const row = build(label);
    push(row); return row.n;
  };
  P.freeze = withView => {
    const b = app.battle; fill();
    const row = build(null);
    Object.assign(row, { elapsed: b.elapsed, paused: b.paused, active: b.active, kills: b.kills });
    if (withView) { row.vw = viewCounts(); row.vis = routeOf()?.view ? P.visSnapshot() : null; }
    return row;
  };
  // 키보드 이동용: 영웅 → 다음 경유점의 화면 투영 차. 경로는 방 연결(links)과 L자 복도(linkPending)의 모서리를 방 중심 경유로 따른다.
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
    clears: P.clears, hpDrops: P.hpDrops, rows: P.rows });
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
    (e.s.roster.policy = 1, e.s.roster.starterChosen = true); e.s.selected = heroId;
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
    hasView: !!r?.view, mechanics: b.stage.expedition?.mechanics ?? null }; });
  Object.assign(row, info);
  check(tag + ': route/depth/ticket', info.route.id === DUNGEON_ID && (info.route.depth ?? 'standard') === depth && row.started.pending?.energy === dungeonDef.energy
    && row.started.pending.id === before.seq + 1 && row.started.pending.depth === depth && row.started.pending.target === DUNGEON_ID, { route: info.route, pending: row.started.pending, seqBefore: before.seq });
  // 정의가 있는 후보 빌드인데 컨트롤러가 없거나, 정의가 없는 기준선인데 컨트롤러가 있으면 기준선으로 오인하지 않도록 실패로 남긴다.
  if (routeDef) check(tag + ': 밸브 컨트롤러 id = ' + routeDef.id, info.routeId === routeDef.id && info.gates === routeDef.gates.length, { routeId: info.routeId, gates: info.gates, controller: info.controller });
  else check(tag + ': 밸브 정의가 없는 기준선인데 routeObjectives 가 있음', !info.routeId, { routeId: info.routeId, controller: info.controller });
  if (viewExpected) check(tag + ': 출격 직후(prepareView 뒤) route.view 존재', info.hasView, { hasView: info.hasView });
  if (!info.auto) await page.locator('#btn-auto').click();
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true, 'AUTO is not active after native button');
  row.focus = await nativeGameplayFocus(page);
  row.probe = await page.evaluate(installProbe, { viewExpected, gateCount: info.gates });
  row.begin = await page.evaluate(() => window.__eclipseValveQa.begin());
  row.reinforcements = row.begin.reinforcements;
  // 재시드: 첫 app.step 전 한 번. --no-reseed 면 호출하지 않는다.
  row.reseed = reseedOn ? await page.evaluate(s => { const q = window.__eclipseValveQa, b = window.app.battle; const r = { on: true, elapsed: b.elapsed, active: b.active, steps: q.steps, hasRoute: !!b.routeObjectives, hasView: !!b.routeObjectives?.view };
    window.__qaReseed(s); return r; }, seed) : { on: false, elapsed: null };
  report.reseed = { on: row.reseed.on, elapsed: row.reseed.elapsed };
  if (reseedOn) check(tag + ': 재시드는 전투 활성·첫 스텝 전(elapsed 0)', row.reseed.active === true && row.reseed.steps === 0 && row.reseed.elapsed === 0, row.reseed);
  if (routeDef) check(tag + ': 정예방 증원 횟수 = 대상 프로젝트 mechanics.reinforcements', row.reinforcements === (dungeonDef.mechanics?.reinforcements ?? 0), { page: row.reinforcements, project: dungeonDef.mechanics?.reinforcements ?? null });
  await qa.save(); return row;
}
async function takeChoice(row) {
  const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
  try { await buttons.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { throw Error('Battle paused without a visible native choice: ' + JSON.stringify(await page.evaluate(() => [...window.app.battle.pauseReasons]))); }
  row.choices.push({ text: await buttons.first().innerText(), elapsed: await page.evaluate(() => window.app.battle.elapsed) });
  await buttons.first().click();
}
let keyboardMode = false;
/** stop 조건 또는 전투 종료까지 고정 스텝으로 진행한다. 선택지 모달이 열리면 실제 첫 번째 버튼을 누른다(키보드 구간이면 캔버스 포커스를 되찾는다). */
async function advance(row, stop, { max = 60 * 60 * 12, chunk = 600, renderEvery = 0 } = {}) {
  let total = 0, last;
  while (total < max) {
    last = await page.evaluate(opts => window.__eclipseValveQa.run(opts), { n: Math.min(chunk, max - total), stop, renderEvery });
    total += last.ran;
    if (last.reason === 'stop' || last.reason === 'inactive') return { ...last, total };
    if (last.reason === 'paused') { await takeChoice(row); if (keyboardMode) await nativeGameplayFocus(page); continue; }
    if (total % (chunk * 10) === 0) { await qa.save(); console.log(JSON.stringify({ tag: row.tag, elapsed: ms(last.elapsed), total })); }
  }
  throw Error('Bounded fixed steps exhausted: ' + JSON.stringify(last));
}
const freeze = withView => page.evaluate(v => window.__eclipseValveQa.freeze(v), !!withView);
const mark = label => page.evaluate(l => window.__eclipseValveQa.mark(l), label);
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
 * AUTO 를 끈 영웅을 키보드(W/A/S/D)만으로 목표(방 중심 또는 한 점)까지 걷게 한다. 경유점은 방 연결의 L자 복도 모서리와 방 중심이다.
 * stop 이 참이 되면 끝낸다. 공격·회피 키는 누르지 않는다. 좌표 이동·무적 없이 실제 입력만 쓴다. 영웅이 쓰러지면 전투가 끝나 예외가 난다.
 */
async function walkTo(row, target, stop, { maxSteps = 60 * 40 } = {}) {
  qaAssert(await page.evaluate(() => window.app.battle.player.auto) === false, 'AUTO must be off for keyboard walking');
  await page.evaluate(t => window.__eclipseValveQa.setTarget(t), target);
  let total = 0; const trail = [];
  try {
    while (total < maxSteps) {
      if (await page.evaluate(s => window.__eclipseValveQa.hit(s), stop)) return { steps: total, trail };
      const aim = await page.evaluate(() => window.__eclipseValveQa.aim());
      await setKeys(keysToward(aim));
      const r = await page.evaluate(opts => window.__eclipseValveQa.run(opts), { n: 4, stop });
      total += r.ran;
      if (trail.length < 300 && (total / 4) % 15 === 0) trail.push({ steps: total, t: ms(r.elapsed), dist: +aim.dist.toFixed(2), left: aim.left });
      if (r.reason === 'stop') return { steps: total, trail };
      if (r.reason === 'inactive') throw Error('Battle ended while walking by keyboard (hero down?): ' + JSON.stringify(trail.slice(-6)));
      if (r.reason === 'paused') { await setKeys(new Set()); await takeChoice(row); await nativeGameplayFocus(page); }
    }
    throw Error('Keyboard walking did not reach its stop within ' + maxSteps + ' steps: ' + JSON.stringify(trail.slice(-6)));
  } finally { await setKeys(new Set()); }
}

// ---------- 완주·정리 ----------
/** 관측 행을 파일로 빼고, 밸브 정의가 있는 빌드는 봉인 전 과정을 판정한다. 기준선(정의 없음)은 공통 측정만 남긴다. */
function recordValves(row, raw) {
  const rows = raw.rows;
  delete raw.rows;
  traces.set(row.tag, rows);
  const file = row.tag + '-trace.json';
  fs.writeFileSync(path.join(qa.out, file), JSON.stringify(rows), { flag: 'wx' });
  row.traceFile = file; row.traceRows = rows.length;
  const roomSamples = raw.samples.filter(x => x.label === 'roomEnter');
  check(row.tag + ': 방 첫 진입 draw call 표본(roomEnter) 1개 이상', roomSamples.length > 0, { rooms: roomSamples.map(x => x.roomId) });
  if (!routeDef) { row.valves = { skipped: '밸브 정의(ROUTE_OBJECTIVES.eclipse_' + depth + ')가 없는 기준선 빌드: 밸브 판정 생략, 공통 측정만 기록' }; return; }
  const missingRooms = valveRooms.filter(id => !roomSamples.some(x => x.roomId === id));
  check(row.tag + ': 밸브 방마다 첫 진입 draw call 표본', missingRooms.length === 0, { valveRooms, missing: missingRooms });
  if (!viewExpected) row.viewSkipped = '정의에 view 가 없는 기준선 빌드: 뷰 판정 생략';
  const analysis = analyzeValves({ rows, result: row.result?.routeObjective, resultText: row.resultText, win: row.result?.win === true, rooms: row.begin.rooms, viewAB: raw.viewAB },
    routeDef, { reinforcements: row.reinforcements, expectWaiting: deep, viewExpected });
  row.valves = analysis;
  if (analysis.view) (report.reportItems.viewGpuCalls ??= []).push({ tag: row.tag, classification: 'C', max: analysis.view.gpu.max, samples: analysis.view.gpu.samples, limit: analysis.view.gpu.limit,
    note: '보고 항목: 뷰 실제 draw call A/B(같은 프레임, 뷰 그룹 켠 채 − 끈 채). 판정은 acceptance.viewGpu' });
  const LABELS = { sealCount: '봉인 ' + routeDef.gates.length + '회(progress 증가 스텝)', sealOrder: '봉인 순서 = 정의 순서 [' + valveRooms.join(', ') + ']',
    holdDuration: '봉인마다 직전 연속 유지(0 에서 시작, hold 증가 = 게임 시각 증가)가 엔진 hold·게임 시각 길이 모두 ≥ ' + routeDef.holdSeconds + '초 − 1/60', holdInside: '유지 동안 영웅이 방 중심 반경 ' + routeDef.radius + ' 안',
    enemiesCleared: '봉인 시점 그 방의 적·대기열 0(유지 구간 전체 포함)', reinforcements: '정예방 forgeWave = 증원 횟수 ' + row.reinforcements, gateState: '봉인 순서 상태(앞 밸브 attuned·뒤 밸브 아직·봉인 전 cleared 아님)',
    waiting: '순서 대기 관측(마지막 밸브 ready 이고 차례 전 표본 ≥ 1, 심층만)', unseal: 'world.sealed 해제는 progress = n 이고 모든 비보스 방 cleared 뒤', resultFields: '결과 routeObjective { id, complete, progress, target, rooms }',
    resultLine: "결과 줄 '" + analysis.resultLine.line + "'", objectiveText: '목표창 유지 표본에 제목과 유지 문구', viewCount: '뷰 count = 밸브 수·drawCalls ≤ 3',
    viewLook: '렌더된 뷰 인스턴스 = 관측 기대 모습(고리 색·물줄기 색을 이름별 메시로 따로, 물줄기 높이 = 차례 표본 기준 비율' + (deep ? ', 순서 대기 표본 필수' : '') + ')',
    viewGpu: '뷰 실제 draw call A/B(C 제어 렌더): 표본 ≥ 3(차례·유지·봉인 포함)·viewGpuCalls ≤ 3·route.view.drawCalls 와 같음' };
  for (const [name, ok] of Object.entries(analysis.acceptance)) check(row.tag + ': 밸브 ' + (LABELS[name] ?? name), ok, ok ? undefined : { name, violations: analysis.violations.slice(0, 8), waiting: analysis.waiting, unseal: analysis.unseal,
    result: analysis.result, line: analysis.resultLine, objective: analysis.objective, view: analysis.view, observedOrder: analysis.observedOrder, wantOrder: analysis.wantOrder });
}
/** 승리까지 AUTO 완주하고 정산·결과·보상·저장 해시·밸브 판정을 기록한다. moments 는 screens 프로필이 순간마다 멈춰 PNG 를 남기는 목록이다. */
async function playToEnd(row, { moments = [], expectFirstClear = true } = {}) {
  row.shots ??= [];
  for (const moment of moments) {
    const r = await advance(row, moment.stop, { renderEvery: 0 });
    if (r.reason !== 'stop') { row.shots.push({ label: moment.label, reached: false }); break; }
    const stopRow = await freeze(true);
    if (moment.settle) await advanceSteps(row, moment.settle);
    const capture = await freeze(true);
    row.shots.push({ label: moment.label, reached: true, files: await captureScreens(moment.label + '-' + row.tag), elapsed: ms(r.elapsed), stop: stopRow, capture });
  }
  const end = await advance(row, null, { renderEvery: 1800 });
  row.end = end;
  await mark('end');
  await waitResult();
  row.summary = await page.evaluate(() => window.__eclipseValveQa.summary());
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
    drawCalls: s.samples.map(x => ({ label: x.label, roomId: x.roomId ?? null, room: x.room, t: ms(x.t), calls: x.calls, triangles: x.triangles, ms: x.ms, view: x.view })) };
  // 스텝별 ms 배열은 통계만 남기고 버린다(관측 행은 파일로 뺀다).
  delete s.stepMs; delete s.renderMs;
  (report.reportItems.absolute50ms ??= []).push({ tag: row.tag, runOver50: row.metrics.over50ms, note: '보고 항목(판정 아님). 기준선 대비 증가는 eclipse-valve-compare 가 판정한다.' });
  recordValves(row, s);
  if (!routeDef) {
    row.baseline = { skipped: row.valves.skipped, elapsed: row.metrics.elapsed, kills: row.metrics.kills, hits: row.metrics.hpDrops, frames: { simulation: row.metrics.simulation, render: row.metrics.render }, drawCalls: row.metrics.drawCalls };
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
const skipUnlessValves = row => (!routeDef || !row.gates) ? { skipped: '밸브 정의(또는 routeObjectives)가 없는 기준선 빌드' } : null;

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
    await applyFixture();
    const row = await beginRun('order');
    const why = skipUnlessValves(row);
    if (why || !deep || row.gates < 4) return { skipped: why?.skipped ?? 'order 프로필은 밸브가 4개인 심층 전용이다' };
    const w = row.gates - 1, wantRoom = routeDef.gates[w].roomId, center = row.begin.rooms.find(r => r.id === wantRoom);
    // 1) AUTO 로 progress w − 1 이고 마지막 밸브가 ready·적/대기열 0 인 순간까지. 거기서 AUTO 를 실제 버튼으로 끈다.
    const ready = await advance(row, { type: 'orderReady', progress: w - 1, gate: w }, { max: 60 * 60 * 15 });
    check('order: AUTO 로 progress ' + (w - 1) + '·방 ' + wantRoom + ' ready·적 0 까지', ready.reason === 'stop', { reason: ready.reason, elapsed: ready.elapsed });
    qaAssert(ready.reason === 'stop', 'Order wait never reached: ' + ready.reason);
    row.readyAt = await freeze();
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard = await nativeGameplayFocus(page);
    await mark('manual1-start');
    // 2) 키보드로 방 5 중심 반경 1.5 안, 3초 대기: 차례가 아니라 봉인되지 않고 방도 cleared 가 아니어야 한다.
    row.walk1 = await walkTo(row, { room: wantRoom }, { type: 'near', x: center.x, z: center.z, r: ORDER.near });
    await mark('wait-start');
    await advanceSteps(row, ORDER.waitSteps);
    await mark('wait-end');
    row.waitState = await freeze();
    check('order: 방 ' + wantRoom + ' 중심 3초 뒤에도 progress 불변·cleared 아님(순서 대기)', row.waitState.pr === w - 1 && row.waitState.g[w].cl === 0 && row.waitState.g[w].at === 0, row.waitState);
    row.waitShot = await shot('order-waiting-center');
    // 3) AUTO 를 켜 progress w 까지(밸브 w − 1 봉인), 그 순간 다시 끈다.
    await setAuto(true); keyboardMode = false;
    const sealedLast = await advance(row, { type: 'progress', n: w }, { max: 60 * 60 * 10 });
    check('order: AUTO 로 progress ' + w + ' 까지', sealedLast.reason === 'stop', { reason: sealedLast.reason });
    qaAssert(sealedLast.reason === 'stop', 'Gate ' + (w - 1) + ' never sealed: ' + sealedLast.reason);
    await setAuto(false);
    keyboardMode = true;
    row.focusKeyboard2 = await nativeGameplayFocus(page);
    await mark('manual2-start');
    // 4) 키보드로 방 5 중심 → 유지 ≥ 1.0 → 반경 밖(중심에서 4.0) → hold 0 → 다시 중심 → 새 유지로 봉인.
    row.walk2 = await walkTo(row, { room: wantRoom }, { type: 'near', x: center.x, z: center.z, r: ORDER.near });
    const partial = await advance(row, { type: 'hold', min: ORDER.minPartialHold, progress: w }, { max: 60 * 10 });
    check('order: 방 ' + wantRoom + ' 에서 유지 ≥ ' + ORDER.minPartialHold + '초', partial.reason === 'stop', { reason: partial.reason });
    qaAssert(partial.reason === 'stop', 'Partial hold never reached: ' + partial.reason);
    row.partialAt = await freeze();
    row.walkOut = await walkTo(row, { x: center.x + ORDER.exitDistance, z: center.z }, { type: 'away', x: center.x, z: center.z, r: routeDef.radius + .4 });
    await advanceSteps(row, 2);
    await mark('exit');
    row.exitState = await freeze();
    check('order: 반경 밖으로 나가면 hold 0', row.exitState.hd === 0 && Math.hypot(row.exitState.x - center.x, row.exitState.z - center.z) > routeDef.radius, row.exitState);
    row.walk3 = await walkTo(row, { room: wantRoom }, { type: 'near', x: center.x, z: center.z, r: ORDER.near });
    const resealed = await advance(row, { type: 'progress', n: w + 1 }, { max: 60 * 15 });
    check('order: 다시 들어가 새 유지로 progress ' + (w + 1), resealed.reason === 'stop', { reason: resealed.reason });
    qaAssert(resealed.reason === 'stop', 'Gate ' + w + ' never sealed after re-entry: ' + resealed.reason);
    await mark('manual2-end');
    row.sealedShot = await shot('order-last-sealed');
    // 5) AUTO 를 켜 완주.
    await setAuto(true); keyboardMode = false;
    await playToEnd(row);
    const analysis = analyzeOrder(traces.get(row.tag), routeDef, { rooms: row.begin.rooms, waitSeconds: ORDER.waitSteps / 60 });
    row.order = analysis;
    check('order: 순서 대기 구간(3초·progress 불변·방 cleared 아님·반경 안·키보드 전용)', analysis.wait.ok, analysis.wait);
    check('order: 유지 ≥ 1.0 뒤 이탈 → hold 0 → 재진입 새 유지 봉인(키보드 전용)', analysis.final.ok, analysis.final);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async pause() {
    await applyFixture();
    const row = await beginRun('pause');
    const why = skipUnlessValves(row);
    if (why) return why;
    // 첫 밸브를 유지하는 중 hold ≥ 0.8 인 첫 스텝에서 멈춘다(2초 유지의 절반 안쪽).
    const reached = await advance(row, { type: 'hold', min: .8, progress: 0 }, { max: 60 * 60 * 12 });
    check('pause: AUTO 로 첫 밸브 유지 hold ≥ 0.8 까지 진행', reached.reason === 'stop', { reason: reached.reason });
    qaAssert(reached.reason === 'stop', 'No hold reached: ' + reached.reason);
    const before = await freeze();
    await pauseBattle();
    const paused = await freeze();
    await page.evaluate(() => window.__eclipseValveQa.stepRaw(120)); await page.waitForTimeout(1000);
    const still = await freeze();
    row.pauseShot = await shot('paused-hold');
    await resumeBattle();
    await mark('resume');
    const resumedRun = await advanceSteps(row, 30);
    const resumed = await freeze();
    const verdict = checkPause({ before, paused, still, resumed, steps: 30 });
    row.pauseCheck = { before, paused, still, resumed, resumeReason: resumedRun.reason, verdict };
    check('pause: 유지 중 120스텝+1초 동안 게임 시간 불변·hold 0·progress 불변', verdict.frozen, verdict);
    check('pause: 재개 뒤 hold 가 0 에서 새로 시작(30스텝 안)', verdict.resumedOk, verdict);
    await playToEnd(row);
    const sealed = analyzePauseSeal(traces.get(row.tag), routeDef, { rooms: row.begin.rooms, reinforcements: row.reinforcements });
    row.pauseSeal = sealed;
    check('pause: 재개 뒤 그 밸브가 새 유지 ≥ ' + routeDef.holdSeconds + '초 − 1/60 로 봉인', sealed.ok, sealed);
    await closeResultToLobby();
    return { runs: [row] };
  },
  async screens() {
    await applyFixture();
    const row = await beginRun('screens');
    const judged = !!routeDef && row.gates > 0;
    const w = row.gates - 1;
    const moments = !judged ? [{ label: 'mid', stop: { type: 'time', t: 60 } }] : [
      { label: 'next', stop: { type: 'next', gate: 0, progress: 0 }, settle: 0, want: { gate: 0, look: 'next' } },
      { label: 'holding', stop: { type: 'hold', min: 1.0, progress: 0 }, settle: 0, want: { gate: 0, look: 'holding' } },
      { label: 'sealed', stop: { type: 'progress', n: 1 }, settle: 30, want: { gate: 0, look: 'sealed' } },
      ...(deep ? [{ label: 'waiting', stop: { type: 'waiting', gate: w, below: w, min: 1 }, settle: 12, want: { gate: w, look: 'waiting' } }] : []),
    ];
    await playToEnd(row, { moments });
    const verdict = checkScreens(row.shots, moments.map(m => m.label), SCREEN_VIEWPORTS.length);
    check('screens: 모든 순간에 도달해 3개 화면 크기 PNG 를 남김', verdict.ok, verdict.rows);
    row.screensCheck = verdict;
    // 물줄기 높이 기준: 같은 런의 차례 표본(촬영 행의 뷰 스냅샷)에서 잰다.
    const base = viewExpected && judged ? streamBase(row.shots.filter(x => x.reached && x.capture?.vis).map(x => ({ vis: x.capture.vis, row: x.capture })), routeDef) : undefined;
    if (viewExpected && judged) check('screens: 같은 런의 차례 표본으로 물줄기 높이 기준을 잼', base !== null, { streamBase: base });
    if (judged) for (const m of moments) {
      const s = row.shots.find(x => x.label === m.label);
      if (!s?.reached) continue;
      s.look = checkScreenMoment(s, routeDef, m.want, { viewExpected, streamBase: base });
      check('screens: ' + m.label + ' 순간의 밸브 ' + m.want.gate + ' 상태 = ' + m.want.look + ' (촬영 스텝 행' + (viewExpected ? ', 렌더된 뷰 인스턴스 포함' : '') + ')', s.look.ok, s.look);
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
        const a = window.app, b = a.battle, q = window.__eclipseValveQa;
        if (!b?.world) return null;
        const alive = {};
        for (const e of b.enemies) if (e.alive) alive[e.homeRoom?.id ?? 'none'] = (alive[e.homeRoom?.id ?? 'none'] || 0) + 1;
        return { freeze: q?.freeze?.(false) ?? null, recentRows: q?.rows?.slice(-30) ?? null, hpDrops: q?.hpDrops?.slice(-20) ?? null,
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
console.log(JSON.stringify({ status: report.status, out: qa.out, depth, valveDefinition: !!routeDef, viewExpected, reseed: report.reseed, profiles: Object.fromEntries(Object.entries(report.profiles).map(([k, v]) => [k, v.status])),
  failedChecks: report.failedChecks, mediaGates: report.mediaGates, failure: report.failure, cleanupFailure: report.cleanupFailure, releaseApproved: false }));
