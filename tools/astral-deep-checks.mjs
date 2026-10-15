// 성운 첨탑 성좌 4곳·외곽 고리 QA 판정 함수. 심층(BUNDLE-12)과 일반판 조율판 4곳·기록 외곽 고리(BUNDLE-13)를 같은 함수로 판정한다. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/astral-deep-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.astral_deep | astral_standard)다.
// 시간·반경·개수·방 번호는 정의(def)와 인자(opts, setup)에서 받는다. 어느 depth 의 계약인지는 정의 id 로 정한다(contractOf: 일반판 id 면 일반판, 그 밖은 심층).
// 문구·색·숫자 계약은 BUNDLE-12 PLAN 3.0·3.1 과 BUNDLE-13 PLAN 3.0·3.1 의 값을 DEEP/RING/COPY(심층)와 STANDARD/STANDARD_RING(일반판) 상수로 적고,
// 고리 문구는 3.1 틀 함수(ringCopy)로 정의의 문구 필드에서 만든다(정의가 그 계약과 같은지는 checkDefinition 이 따로 본다). 읽기 계약은 app.battle.routeObjectives 의
//   progress · phase · read · hold · selected · mistakes · revealed · gates[i].{room,ready,available,attuned,answer,pads,pos} · ring · finish 보고뿐이다.
//
// 관측 행(상태가 바뀐 스텝, 읽기(rs > 0)·유지(hd > 0) 스텝, 고리가 open|running 인 모든 스텝, 1초 간격 스텝, 표식 스텝만 남긴다. 판정에 필요한 연속 구간은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, sl world.sealed(1/0),
//   rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state, pz 스텝 끝에 전투가 일시정지(1, 없으면 생략),
//   rs route.read, hd route.hold, ph route.phase(0 combat · 1 read · 2 select · 3 retry · 4 complete, 9 알 수 없음, -1 읽지 못함), rv route.revealed(1/0, -1 읽지 못함),
//   se route.selected(판 id, 없으면 빈 문자열, 읽지 못하면 null), mi route.mistakes(-1 = 읽지 못함), hn 지금까지 player.hurt 호출 수, ec 지금 차례 성좌의 전투 중 적 수(그 방 소속 + 전투 반경 안),
//   g: 성좌마다 { id 방 id, rdy gate.ready, av gate.available, at gate.attuned, cl room.cleared, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수 }(전부 숫자),
//   rg: route.ring 관측 { ph(0 idle · 1 open · 2 running · 3 done · 9 알 수 없음), rid 고리 방 id, ck clock, lf left, lim limit, el elapsed, co collapses, sh shardHits, pu purified,
//      ho held(없으면 -1, 읽지 못하면 null), m: 성표마다 { h hold, d done(1/0) }, sd: { s(0 calm · 1 warning · 2 burst · 9 알 수 없음), a age, c cycle(첫 주기 전 -1, 읽지 못하면 null) } } 또는 null(ring 없음),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(같은 상태가 0.6초 이어진 뒤 표본),
//   hr 그 스텝에 player.hurt 가 받은 피해 ÷ 최대 체력 목록(도구의 관측 감싸개, 호출이 없으면 생략)
// 정적 값(setup)은 행과 따로 한 번 남긴다: { gates[i]: { id, roomX, roomZ, x, z(모래시계), answer, pads[]: { id, x, z } }, ring: { roomId, roomX, roomZ, cx, cz(중심), minX, maxX, minZ, maxZ, marks[]: { x, z } } }.
// 토스트 표본({ n, t, msg, kind, tac })은 행과 따로 남긴다.

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/** 위치 경계 판정의 부동소수 여유. */
export const POSITION_SLACK = .01;
/** 한 스텝에 영웅은 최대 약 .12 움직인다(가장 빠른 영웅 7.2/60). 행 위치(스텝 끝)와 규칙이 본 위치의 차이를 이 값으로 받는다. */
export const MOVE_SLACK = .2;
/** 고리 방 사각형 진입 판정 여유: 시작 스텝의 영웅은 규칙이 본 위치와 한 스텝 이동량만큼 다를 수 있다. */
export const START_SLACK = .15;
/** 집결 중심 core 경계: 터지는 동안 core + OUTER 안이면 피격이어야 설명되고, core − INNER 안 깊숙이 있으면 반드시 피격이어야 한다. */
const CORE_OUTER_SLACK = .2;
const CORE_INNER_MARGIN = .3;
const SETTLE_STEPS = 10;
const CARRY_MAX_STEPS = 90;
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 상태가 바뀌는 시각에서 부동소수 때문에 상태를 가를 수 없는 범위. */
const BOUNDARY = 1e-6;

/**
 * 피해 판정(BUNDLE-11 smoke 수리와 같음). 규칙은 최대 체력 × 정의 값(damage)을 player.hurt 에 넘기고, 실제 체력 감소는 영웅 방어로 줄어든다.
 * 정상 경로는 하나만 면제한다: 그 스텝 행의 hr(도구가 감싼 player.hurt 가 받은 피해 ÷ 최대 체력 목록)에 정의 값과 1e-6 안으로 같은 값이 있고,
 * 실제 감소 비가 0 보다 크고 정의 값 이하다. hr 이 없거나(관측 누락), 넘긴 값이 다르거나, 감소가 0(무적 등) 이거나 정의 값을 넘으면 실패다.
 */
export function damageMatches(row, ratio, want) {
  const raw = Array.isArray(row?.hr) ? row.hr : null;
  return !!raw && raw.some(x => Number.isFinite(x) && Math.abs(x - want) <= 1e-6) &&
    ratio !== null && Number.isFinite(ratio) && ratio > 0 && ratio <= want + 1e-6;
}

export const PHASE_NAMES = Object.freeze(['idle', 'open', 'running', 'done']);
export const PHASE_CODE = Object.freeze(Object.fromEntries(PHASE_NAMES.map((name, i) => [name, i])));
export const GATE_PHASE_NAMES = Object.freeze(['combat', 'read', 'select', 'retry', 'complete']);
export const GATE_PHASE_CODE = Object.freeze(Object.fromEntries(GATE_PHASE_NAMES.map((name, i) => [name, i])));
export const SHARD_NAMES = Object.freeze(['calm', 'warning', 'burst']);
export const SHARD_CODE = Object.freeze(Object.fromEntries(SHARD_NAMES.map((name, i) => [name, i])));

/** PLAN 3.0 공유 정의 계약 값(성좌 4곳). */
export const DEEP = Object.freeze({
  id: 'astral_fallen_constellations_deep', kind: 'deep-constellations', title: '별자리 복원', radius: 1.2, readRadius: 8, readSeconds: 1, holdSeconds: 1, combatRadius: 22,
  rooms: Object.freeze([3, 2, 5, 6]), stations: Object.freeze([1, 2, 3, 4]),
  labels: Object.freeze(['1번 성좌 · 끊어진 별길', '2번 성좌 · 되돌아온 빛', '3번 성좌 · 가라앉은 닻별', '4번 성좌 · 귀환 좌표']),
  answers: Object.freeze(['circle', 'diamond', 'triangle', 'circle']),
  choices: Object.freeze([
    Object.freeze({ id: 'triangle', code: 'A', glyph: '△', name: '삼각', dx: -3.5, dz: 0 }),
    Object.freeze({ id: 'circle', code: 'B', glyph: '○', name: '원', dx: 0, dz: 3.5 }),
    Object.freeze({ id: 'diamond', code: 'C', glyph: '◇', name: '마름모', dx: 3.5, dz: 0 }),
  ]),
});
/** PLAN 3.0 공유 정의 계약 값(외곽 고리). */
export const RING = Object.freeze({
  roomId: 7, label: '성좌 외곽 고리', title: '외곽 고리 정화', mark: '성표', shard: '파편', verb: '정화하', markVerb: '정화',
  marks: Object.freeze([Object.freeze([-6, 0]), Object.freeze([0, -6]), Object.freeze([6, 0]), Object.freeze([0, 6])]),
  markRadius: 1.4, holdSeconds: 1, limit: 20, first: 1, period: 4.5, warning: 1.5, burst: .5, core: 3.4, damage: .06, collapseDamage: .06, shards: 8, color: 0x8fb8ff,
});
/** BUNDLE-13 PLAN 3.0 공유 정의 계약 값(일반판 조율판 4곳: 방 1 → 3 → 4 → 6). 판 모양·읽기·유지 수치는 심층과 같다. */
export const STANDARD = Object.freeze({
  id: 'astral_constellations_standard', kind: 'constellations', title: '별자리 복원', radius: 1.2, readRadius: 8, readSeconds: 1, holdSeconds: 1, combatRadius: 22,
  rooms: Object.freeze([1, 3, 4, 6]), stations: Object.freeze([1, 2, 3, 4]),
  labels: Object.freeze(['1번 조율판 · 첫 항로', '2번 조율판 · 먼 좌표', '3번 조율판 · 귀환 별', '4번 조율판 · 마지막 항로']),
  answers: Object.freeze(['triangle', 'diamond', 'circle', 'triangle']),
  choices: DEEP.choices,
});
/** BUNDLE-13 PLAN 3.0 공유 정의 계약 값(일반판 기록 외곽 고리: 표지 3개·제한 24초·피해 4%). */
export const STANDARD_RING = Object.freeze({
  roomId: 7, label: '기록 외곽 고리', title: '외곽 고리 이탈', mark: '항로 표지', shard: '기록 파편', verb: '밝히', markVerb: '점등',
  marks: Object.freeze([Object.freeze([-6, 0]), Object.freeze([0, -6]), Object.freeze([6, 0])]),
  markRadius: 1.4, holdSeconds: 1, limit: 24, first: 1.5, period: 5, warning: 2, burst: .5, core: 3.2, damage: .04, collapseDamage: .04, shards: 6, color: 0x9ccaff,
});
/** 목표창·토스트·결과 문구(PLAN 2절 5, 3.1, 3.2). 판정 함수의 상수는 테스트가 따로 적은 문장과 맞춰 본다. */
export const COPY = Object.freeze({
  clue: '모래시계 단서를 읽으세요', waiting: '복원 순서 대기',
  allRestored: '모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다',
  ringOpen: '성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요',
  shardHit: '파편 집결 피격 · 파편이 모이면 중심 밖으로', done: '외곽 고리 정화 · 레비아탄의 봉인이 풀립니다',
  ringTitle: '외곽 고리 정화', ringOpenAction: '성좌 외곽 고리로 이동', ringRunAction: '파편이 모이면 중심 밖으로 · ', remain: '남은 구역 정화',
  find: '다음 구역을 찾아 이동', fight: '이 구역의 적과 증원 처치', read: '모래시계 단서 1초 읽기', select: '월드 단서와 같은 판에서 1초 유지',
  retry: '판 밖으로 나와 다시 읽기', combat: '전투를 마치고 모래시계로 이동',
});
/** 이 심층에서 나오면 안 되는 이전(보물방 공명)·일반판(조율판) 문구. */
export const LEAK_WORDS = Object.freeze(['공명', '조율판']);
/** 일반판에서 나오면 안 되는 이전(보물방 공명)·심층(성좌·성표) 문구. */
export const STANDARD_LEAK_WORDS = Object.freeze(['공명', '성좌', '성표']);
/** depth 별 계약. gates = 조율판·성좌 계약, ring = 외곽 고리 계약, requireEarly = 대기 성좌(차례 전 준비) 관측 요구(일반판에는 대기 조율판이 없다). */
export const CONTRACTS = Object.freeze({
  deep: Object.freeze({ depth: 'deep', routeKey: 'astral_deep', gates: DEEP, ring: RING, leakWords: LEAK_WORDS, requireEarly: true }),
  standard: Object.freeze({ depth: 'standard', routeKey: 'astral_standard', gates: STANDARD, ring: STANDARD_RING, leakWords: STANDARD_LEAK_WORDS, requireEarly: false }),
});
/** 정의에 맞는 depth 계약. 일반판 정의 id 면 일반판, 그 밖(심층·정의 없음)은 심층이다. */
export const contractOf = def => (def?.id === STANDARD.id ? CONTRACTS.standard : CONTRACTS.deep);
const leaks = (text, def) => typeof text === 'string' && contractOf(def).leakWords.some(word => text.includes(word));
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * 고리 문구 틀(BUNDLE-13 PLAN 3.1). 정의의 문구 필드(label · title · mark · shard · verb · markVerb)와 표지 수 n 으로 토스트·목표창·결과 줄을 만든다.
 * 조사(가·이·로)는 두 정의의 낱말에 맞춘 고정 글자다. 심층 정의는 위 COPY 의 문장을 글자 그대로 낸다(테스트가 같음을 고정한다).
 */
export function ringCopy(ring) {
  const L = ring.label, T = ring.title, M = ring.mark, S = ring.shard, V = ring.verb, Kv = ring.markVerb, n = ring.marks.length;
  return Object.freeze({
    allRestored: '모든 별자리 복원 · 모든 구역을 정화하면 ' + L + '가 열립니다',
    ringOpen: L + ' 개방 · 고리 위 ' + M + ' ' + n + '개를 ' + V + '세요',
    start: limit => T + ' 시작 · ' + limit + '초',
    mark: (k, total = n) => M + ' ' + Kv + ' · ' + k + '/' + total,
    shardHit: S + ' 집결 피격 · ' + S + '이 모이면 중심 밖으로',
    collapse: limit => '외곽 고리 붕괴 · ' + M + '가 흐려졌습니다 · 다시 ' + limit + '초',
    done: T + ' · 레비아탄의 봉인이 풀립니다',
    title: T, openAction: L + '로 이동', runAction: S + '이 모이면 중심 밖으로 · ',
    resultAria: T + ' 결과',
    resultLine: info => T + ' ' + (info?.purified ? '완료' : '미완료') + ' · ' + M + ' ' + info?.marks + '/' + n + ' · ' + S + ' 피격 ' + info?.shardHits + '회 · 붕괴 ' + info?.collapses + '회',
    startPattern: new RegExp('^' + escapeRe(T + ' 시작 · ') + '\\d+초$'),
    collapsePattern: new RegExp('^' + escapeRe('외곽 고리 붕괴 · ' + M + '가 흐려졌습니다 · 다시 ') + '\\d+초$'),
    markPattern: new RegExp('^' + escapeRe(M + ' ' + Kv + ' · ') + '\\d+\\/\\d+$'),
  });
}

export const readyToast = (def, i, current) => def.gates[i].label + ' 정화 · ' + (current ? COPY.clue : COPY.waiting);
export const restoreToast = (def, i) => def.gates[i].label + ' 복원 완료 · ' + (i + 1) + '/' + def.gates.length;
// 아래 세 토스트는 심층 문구다(ringCopy(RING) 와 같다). 일반판을 포함한 일반 판정은 ringCopy(def.ring) 을 쓴다.
export const startToast = limit => '외곽 고리 정화 시작 · ' + limit + '초';
export const markToast = (k, n) => '성표 정화 · ' + k + '/' + n;
export const collapseToast = limit => '외곽 고리 붕괴 · 성표가 흐려졌습니다 · 다시 ' + limit + '초';
/** 오답 토스트: '<판 코드> <도형> 오답 · 단서는 <답 코드> <도형> · 판 밖으로 나와 다시 읽으세요.' (일반판 엔진 그대로). */
export function wrongToast(def, gateIndex, padId) {
  const pad = def.choices.find(c => c.id === padId), clue = def.choices.find(c => c.id === def.gates[gateIndex]?.answer);
  return pad && clue ? pad.code + ' ' + pad.glyph + ' 오답 · 단서는 ' + clue.code + ' ' + clue.glyph + ' · 판 밖으로 나와 다시 읽으세요.' : null;
}
/** 결과 화면 줄: '별자리 복원 4/4 · <라벨> → … · 오답 n회'(기존 일반 줄)와 '외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 n회 · 붕괴 n회'. */
export const constellationResultLine = ro => '별자리 복원 ' + ro?.progress + '/' + ro?.target + ' · '
  + ((ro?.constellations || []).map(s => s.label).join(' → ') || '복원한 별자리 없음') + ' · 오답 ' + ro?.mistakes + '회';
export const ringResultLine = (ring, markCount = RING.marks.length, def = RING) => ringCopy({ ...def, marks: Array.from({ length: markCount }) }).resultLine(ring);

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
export function stepStats(values, limit = 50) {
  const n = values.length;
  return { n, p50: percentile(values, .5), p95: percentile(values, .95), max: n ? Math.max(...values) : null, over: values.filter(v => v > limit).length };
}

/** 같은 스텝 번호의 중복 행(표식 행)을 뺀 스텝 행. */
const stepRows = rows => { const seen = new Set(); return rows.filter(r => (seen.has(r.n) ? false : (seen.add(r.n), true))); };
const isInt = v => Number.isInteger(v);
const finite = v => Number.isFinite(v);
const near = (a, b, tol = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tol;
/** 키 순서와 상관없는 깊은 비교(정의 객체의 키 순서에 기대지 않는다). */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => k in b && same(a[k], b[k]));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const live = r => !!r.rg && (r.rg.ph === PHASE_CODE.open || r.rg.ph === PHASE_CODE.running);
const ringSetup = setup => setup?.ring ?? null;

/** 영웅이 고리 방 사각형 안(경계 포함, slack 만큼 넓힘·음수면 좁힘)인지. */
export const inRoom = (setup, x, z, slack = POSITION_SLACK) => {
  const r = ringSetup(setup);
  return !!r && finite(x) && finite(z) && x >= r.minX - slack && x <= r.maxX + slack && z >= r.minZ - slack && z <= r.maxZ + slack;
};

/** 대상 프로젝트의 정의(ROUTE_OBJECTIVES.astral_deep | astral_standard)가 PLAN 3.0 계약과 같은지(정의 id 가 일반판이면 일반판 계약, 아니면 심층 계약). 어긋난 항목을 issues 로 돌려준다. */
export function checkDefinition(def, contract = contractOf(def)) {
  if (!def) return { ok: false, issues: [{ field: 'definition', got: null }] };
  const issues = [];
  const G = contract.gates, R = contract.ring;
  const want = (field, got, expected) => { if (!same(JSON.parse(JSON.stringify(got ?? null)), JSON.parse(JSON.stringify(expected)))) issues.push({ field, got, want: expected }); };
  want('id', def.id, G.id); want('kind', def.kind, G.kind); want('radius', def.radius, G.radius); want('readRadius', def.readRadius, G.readRadius);
  want('readSeconds', def.readSeconds, G.readSeconds); want('holdSeconds', def.holdSeconds, G.holdSeconds); want('combatRadius', def.combatRadius, G.combatRadius);
  want('choices', def.choices, G.choices);
  want('rooms', (def.gates || []).map(g => g.roomId), [...G.rooms]); want('stations', (def.gates || []).map(g => g.stationId), [...G.stations]);
  want('labels', (def.gates || []).map(g => g.label), [...G.labels]); want('answers', (def.gates || []).map(g => g.answer), [...G.answers]);
  want('ring', def.ring, R);
  return { ok: issues.length === 0, issues };
}
/**
 * 정적 setup 이 정의와 맞는지(도구가 브라우저에서 읽은 값): 성좌 방 id · 모래시계 위치(= 방 중심) · 판 위치(= 모래시계 + 정의 오프셋) · 답,
 * 고리 방 id · 중심(= 방 중심) · 성표 위치(= 중심 + 정의 오프셋) · 사각형(중심과 성표가 안, core 가 안).
 */
export function checkSetup(setup, def) {
  if (!setup || !Array.isArray(setup.gates) || !setup.ring) return { ok: false, reason: 'missing' };
  const c = def?.ring;
  const gates = def.gates.map((gate, i) => {
    const g = setup.gates[i];
    if (!g) return false;
    const pads = def.choices.every(choice => { const p = (g.pads || []).find(q => q.id === choice.id); return !!p && near(p.x, g.x + choice.dx) && near(p.z, g.z + choice.dz); });
    return g.id === gate.roomId && near(g.x, g.roomX) && near(g.z, g.roomZ) && g.answer === gate.answer && (g.pads || []).length === def.choices.length && pads;
  });
  const r = setup.ring;
  const rect = [r.minX, r.maxX, r.minZ, r.maxZ].every(finite) && r.minX < r.maxX && r.minZ < r.maxZ;
  const marks = !!c && Array.isArray(r.marks) && r.marks.length === c.marks.length && c.marks.every((m, i) => near(r.marks[i]?.x, r.cx + m[0]) && near(r.marks[i]?.z, r.cz + m[1]));
  const checks = {
    gates: gates.every(Boolean), room: !!c && r.roomId === c.roomId, rect, center: near(r.cx, r.roomX) && near(r.cz, r.roomZ),
    centerInside: rect && r.minX < r.cx && r.cx < r.maxX && r.minZ < r.cz && r.cz < r.maxZ, marks,
    marksInside: rect && marks && r.marks.every(m => m.x - c.markRadius >= r.minX && m.x + c.markRadius <= r.maxX && m.z - c.markRadius >= r.minZ && m.z + c.markRadius <= r.maxZ),
    coreInside: rect && !!c && r.cx - c.core >= r.minX && r.cx + c.core <= r.maxX && r.cz - c.core >= r.minZ && r.cz + c.core <= r.maxZ,
  };
  return { ok: Object.values(checks).every(Boolean), checks, gates };
}

/**
 * 관측 완전성. 모든 행에서 읽기 · 유지 · 단계 · 선택 · 오답 수 · 피해 호출 수 · 성좌 칸이 읽혀야 하고, ring 이 있는 정의에서는 모든 행의 rg(성표 개수만큼 m, 집결 상태 코드 0~2)가 읽혀야 한다
 * (고리 숫자는 단계에 맞게: clock 은 열린 뒤, left · limit · elapsed 는 정화 시작 뒤, 집결 age 는 열린 동안).
 * -1(읽지 못함)·null·undefined 는 통과가 아니라 실패다(BUNDLE-10 리뷰 P3-5). held · cycle 처럼 -1 이 정상 값인 칸은 읽지 못함을 null 로 남긴다.
 */
export function checkObservation(rows, def) {
  const bad = [];
  const gateCount = def.gates.length, markCount = def.ring?.marks?.length ?? 0;
  for (const r of rows) {
    const miss = [];
    if (!(finite(r.rs) && r.rs >= 0)) miss.push('rs');
    if (!(finite(r.hd) && r.hd >= 0)) miss.push('hd');
    if (!(isInt(r.ph) && r.ph >= 0 && r.ph <= 4)) miss.push('ph');
    if (!(r.rv === 0 || r.rv === 1)) miss.push('rv');
    if (typeof r.se !== 'string') miss.push('se');
    if (!(isInt(r.mi) && r.mi >= 0)) miss.push('mi');
    if (!(isInt(r.hn) && r.hn >= 0)) miss.push('hn');
    if (!(isInt(r.ec) && r.ec >= 0)) miss.push('ec');
    if (!Array.isArray(r.g) || r.g.length !== gateCount || r.g.some(g => !g || ['id', 'rdy', 'av', 'at', 'cl', 'dc', 'al', 'pd'].some(k => !finite(g[k])))) miss.push('g');
    if (markCount > 0) {
      const rg = r.rg;
      if (!rg || !(rg.ph >= 0 && rg.ph <= 3) || !finite(rg.rid) || ![rg.co, rg.sh, rg.pu].every(v => isInt(v) && v >= 0) || !(isInt(rg.ho) && rg.ho >= -1)) miss.push('rg');
      else {
        if (rg.ph >= PHASE_CODE.open && !finite(rg.ck)) miss.push('rg.ck');
        if (rg.ph >= PHASE_CODE.running && ![rg.lf, rg.lim, rg.el].every(finite)) miss.push('rg.run');
        if (!Array.isArray(rg.m) || rg.m.length !== markCount || rg.m.some(m => !m || !(finite(m.h) && m.h >= 0) || !(m.d === 0 || m.d === 1))) miss.push('rg.m');
        const sd = rg.sd;
        if (!sd || !(sd.s >= 0 && sd.s <= 2) || !isInt(sd.c) || sd.c < -1) miss.push('rg.sd');
        else if (live(r) && !finite(sd.a)) miss.push('rg.sd');
      }
    }
    if (miss.length) bad.push({ n: r.n, miss });
  }
  return { rows: rows.length, badCount: bad.length, bad: bad.slice(0, 6), ok: rows.length > 0 && bad.length === 0 };
}

// ---------- 성좌 4곳 ----------
/** 끝 인덱스에서 거꾸로 스텝 번호가 1씩 이어지고 pred 를 만족하는 연속 구간의 시작 인덱스(끝 행이 pred 를 못 맞추면 -1). */
function runStart(list, end, pred) {
  if (end < 0 || end >= list.length || !pred(list[end])) return -1;
  let s = end;
  while (s > 0 && list[s - 1].n === list[s].n - 1 && pred(list[s - 1])) s--;
  return s;
}
/** 유지 구간: hd > 0 이고 스텝마다 hd 가 게임 시간만큼 늘며 이어지는 구간의 시작 인덱스. */
function holdStart(list, end) {
  if (end < 0 || !(list[end].hd > 0)) return -1;
  let s = end;
  while (s > 0 && list[s - 1].n === list[s].n - 1 && list[s - 1].hd > 0 && near(list[s].hd - list[s - 1].hd, list[s].t - list[s - 1].t, EPS)) s--;
  return s;
}

/**
 * 복원 이벤트 판정. 복원 = route.progress 가 늘어난 스텝(확정은 유지가 찬 다음 유효 프레임이라 그 직전 행에서 유지가 가득 차 있다).
 * (a) 복원한 성좌의 방 id 가 정의 순서와 같음(한 번에 +1),
 * (b) 직전 스텝 행에서 끝나는 연속 유지 구간이 0 에서 새로 시작하고 엔진의 hold 가 holdSeconds 이상·게임 시각 길이 holdSeconds − 1/60 이상, 그 구간 내내 route.selected 가 정답 판이고 영웅이 정답 판 반경 안,
 * (c) 그 유지 앞에 읽기 구간(rs > 0, 0 에서 새로 시작해 게임 시간만큼 늘어 readSeconds 에 이름)이 이어지고 유지 시작 직전 행의 read 가 readSeconds 이상,
 * (d) 읽기·유지 내내 그 성좌가 ready · available 이고 그 방의 살아 있는 적·대기열 0, 전투 중 적 수(ec) 0, 영웅이 모래시계 readRadius 안,
 * 그 밖에 복원 스텝에서 그 성좌가 attuned 이고 방이 cleared(같은 행), 앞 성좌는 모두 attuned · 뒤 성좌는 모두 아직 아님, 복원 전에는 그 방이 cleared 가 아님, 오답 수 불변.
 */
export function checkRestorations(rows, def, { setup } = {}) {
  const list = stepRows(rows), n = def.gates.length, events = [], violations = [];
  for (let i = 1; i < list.length; i++) {
    const cur = list[i], prev = list[i - 1];
    if (!(cur.pr > prev.pr)) continue;
    const index = prev.pr, gate = cur.g?.[index], want = def.gates[index], sg = setup?.gates?.[index];
    const dense = cur.n === prev.n + 1;
    const hs = dense ? holdStart(list, i - 1) : -1;
    const hrows = hs >= 0 ? list.slice(hs, i) : [];
    const seconds = hrows.length ? hrows.at(-1).hd : null, span = hrows.length ? hrows.at(-1).t - hrows[0].t + FRAME : null;
    const answer = (sg?.pads || []).find(p => p.id === want?.answer) ?? null;
    const padFar = hrows.length && answer ? Math.max(...hrows.map(r => dist(r, answer))) : null;
    const selOk = hrows.length > 0 && hrows.every(r => r.se === want?.answer);
    // 읽기 구간: 유지 구간 앞(과 유지 구간 안)에서 rs > 0 이 이어진다.
    const rs0 = hs >= 0 ? runStart(list, i - 1, r => r.rs > 0) : -1;
    const before = hs >= 1 ? list[hs - 1] : null;
    const readRows = rs0 >= 0 && hs >= 1 && hs - 1 >= rs0 ? list.slice(rs0, hs) : [];
    // 읽기는 게임 시간만큼 늘다가 readSeconds 에서 멈춘다(엔진이 min 으로 묶는다). 정상 경로는 하나다:
    // 늘어나는 행은 증가량이 경과 시간과 같고, readSeconds 에 닿는 행만 증가량이 경과 시간 이하이며,
    // 닿은 뒤(단서를 읽고 판으로 걸어가는 동안)는 앞 행과 지금 행이 모두 readSeconds 이상이고 값이 같다. 그 밖(제자리·감소·더 빠른 증가)은 실패.
    const atCap = r => r.rs + EPS >= def.readSeconds;
    const readRise = readRows.every((r, k) => {
      if (k === 0) return true;
      const p = readRows[k - 1], d = r.rs - p.rs, dt = r.t - p.t;
      if (near(d, dt, EPS)) return true;
      if (!atCap(p) && atCap(r)) return d > 0 && d <= dt + EPS;
      return atCap(p) && atCap(r) && Math.abs(d) <= EPS;
    });
    const readSpan = readRows.length * FRAME;
    const allRows = hrows.length && readRows.length ? [...readRows, ...hrows] : [];
    const hourglass = sg ? { x: sg.x, z: sg.z } : null;
    const rec = {
      row: i, n: cur.n, t: cur.t, index, roomId: gate?.id ?? null, wantRoomId: want?.roomId ?? null, jump: cur.pr - prev.pr, dense,
      order: cur.pr - prev.pr === 1 && !!want && gate?.id === want.roomId,
      hold: { found: hrows.length > 0, seconds, span, fromZero: hrows.length > 0 && hrows[0].hd <= FRAME + EPS, need: def.holdSeconds,
        ok: hrows.length > 0 && hrows[0].hd <= FRAME + EPS && seconds + EPS >= def.holdSeconds && span + EPS >= def.holdSeconds - FRAME },
      pad: { farthest: padFar, limit: def.radius + MOVE_SLACK, selected: selOk, ok: hrows.length > 0 && !!answer && selOk && padFar <= def.radius + MOVE_SLACK },
      read: { found: readRows.length > 0, startRead: readRows[0]?.rs ?? null, readBeforeHold: before?.rs ?? null, span: readSpan, need: def.readSeconds, rise: readRise,
        ok: readRows.length > 0 && readRows[0].rs <= FRAME + EPS && readRise && before.rs + EPS >= def.readSeconds && readSpan + EPS >= def.readSeconds },
      available: { rows: allRows.length, notAvailable: allRows.filter(r => r.g?.[index]?.av !== 1 || r.g?.[index]?.rdy !== 1).length,
        busy: allRows.filter(r => r.g?.[index]?.al !== 0 || r.g?.[index]?.pd !== 0 || r.ec !== 0).length,
        far: hourglass ? allRows.filter(r => dist(r, hourglass) > def.readRadius + MOVE_SLACK).length : null },
      state: { attuned: gate?.at === 1 && gate?.cl === 1,
        earlier: cur.g?.slice(0, index).every(g => g.at === 1) ?? false, later: cur.g?.slice(index + 1).every(g => g.at === 0 && g.cl === 0) ?? false,
        earlyClear: list.slice(0, i).filter(r => r.g?.[index]?.cl === 1).length, mistakesSame: cur.mi === prev.mi },
    };
    rec.available.ok = allRows.length > 0 && rec.available.notAvailable === 0 && rec.available.busy === 0 && rec.available.far === 0 && !!hourglass;
    rec.state.ok = rec.state.attuned && rec.state.earlier && rec.state.later && rec.state.earlyClear === 0 && rec.state.mistakesSame;
    events.push(rec);
  }
  const observedOrder = events.map(s => s.roomId), wantOrder = def.gates.map(g => g.roomId);
  for (const s of events) {
    if (!s.order) violations.push({ kind: 'order', n: s.n, roomId: s.roomId, want: s.wantRoomId, jump: s.jump });
    if (!s.hold.ok) violations.push({ kind: 'hold', n: s.n, roomId: s.roomId, seconds: s.hold.seconds, span: s.hold.span, need: s.hold.need, fromZero: s.hold.fromZero, dense: s.dense });
    if (!s.pad.ok) violations.push({ kind: 'pad', n: s.n, roomId: s.roomId, farthest: s.pad.farthest, limit: s.pad.limit, selected: s.pad.selected });
    if (!s.read.ok) violations.push({ kind: 'read', n: s.n, roomId: s.roomId, ...s.read });
    if (!s.available.ok) violations.push({ kind: 'available', n: s.n, roomId: s.roomId, ...s.available });
    if (!s.state.ok) violations.push({ kind: 'state', n: s.n, roomId: s.roomId, ...s.state });
  }
  const lastPr = list.at(-1)?.pr;
  return { events, observedOrder, wantOrder, count: events.length, target: n, violations,
    ok: {
      count: events.length === n && lastPr === n,
      order: events.length === n && events.every(s => s.order) && JSON.stringify(observedOrder) === JSON.stringify(wantOrder),
      hold: events.length > 0 && events.every(s => s.hold.ok && s.pad.ok),
      read: events.length > 0 && events.every(s => s.read.ok),
      available: events.length > 0 && events.every(s => s.available.ok),
      state: events.length > 0 && events.every(s => s.state.ok),
    } };
}

/**
 * 차례가 아닌 성좌 방. 성좌 방의 cleared 는 그 성좌가 attuned 가 된 뒤에만(매 관측 행) 참이고, attuned 는 그 성좌 차례(progress > index)인 뒤에만 참이다.
 * 복원 스텝에는 같은 행에서 attuned 와 cleared 가 함께 바뀐다(markCleared 가 같은 스텝에 일어남). 먼저 정리돼도(ready, 적 0) 차례 전에는 어느 것도 참이 아니다.
 * early(PLAN 2절 1): 2번 성좌(방 2)는 1번 복원 전에 ready 가 되고 그동안 미정화여야 한다(requireEarly 면 관측을 요구한다. 길 순서상 방 2 를 먼저 지나므로 AUTO 는 이 표본을 만든다).
 */
export function checkTurnRooms(rows, def, { requireEarly = true } = {}) {
  const bad = [], early = [];
  def.gates.forEach((_, j) => {
    const firstClear = rows.findIndex(r => r.g?.[j]?.cl === 1), firstAtt = rows.findIndex(r => r.g?.[j]?.at === 1);
    if (firstClear >= 0 && firstClear !== firstAtt) bad.push({ kind: 'cleared-not-with-attune', gate: j, clearRow: rows[firstClear].n, attuneRow: firstAtt >= 0 ? rows[firstAtt].n : null });
  });
  for (const r of rows) def.gates.forEach((_, j) => {
    const g = r.g?.[j];
    if (!g) return;
    if (g.cl === 1 && g.at !== 1) bad.push({ kind: 'cleared-before-attune', n: r.n, gate: j });
    if (g.at === 1 && !(r.pr > j)) bad.push({ kind: 'attuned-out-of-turn', n: r.n, gate: j, pr: r.pr });
    if (j > r.pr && g.rdy === 1 && g.al === 0 && g.pd === 0 && g.at === 0) early.push({ n: r.n, gate: j, pr: r.pr });
  });
  const gates = [...new Set(early.map(e => e.gate))];
  // 2번 성좌: 1번 복원(progress 0) 동안 ready 인 행이 있고, 그 행들에서 미정화.
  const second = rows.filter(r => r.pr === 0 && r.g?.[1]?.rdy === 1);
  const secondClean = second.every(r => r.g[1].cl === 0 && r.g[1].at === 0);
  const earlyRec = { gate: 1, rows: second.length, firstN: second[0]?.n ?? null, clean: secondClean, required: requireEarly };
  return { observed: early.length > 0, rows: early.length, gates, early: earlyRec, bad: bad.slice(0, 8), badCount: bad.length,
    ok: bad.length === 0 && secondClean && (!requireEarly || second.length > 0) };
}

/** 준비 시점. 성좌마다 처음 ready 가 된 행에서 방이 발견돼 있고 그 방의 적·대기열이 0 이다. ready 이전에는 그 성좌 차례의 읽기·유지가 0 이다. */
export function checkReadyTiming(rows, def) {
  const gates = def.gates.map((gate, i) => {
    const at = rows.findIndex(r => r.g?.[i]?.rdy === 1);
    const row = at >= 0 ? rows[at] : null, g = row?.g?.[i];
    const early = rows.slice(0, at < 0 ? rows.length : at).filter(r => r.pr === i && (r.rs > 0 || r.hd > 0)).length;
    return { index: i, roomId: gate.roomId, n: row?.n ?? null, pr: row?.pr ?? null, discovered: g?.dc ?? null, alive: g?.al ?? null, pending: g?.pd ?? null, readBeforeReady: early,
      ok: !!g && g.dc === 1 && g.al === 0 && g.pd === 0 && early === 0 };
  });
  return { gates, ok: gates.every(g => g.ok) };
}

// ---------- 외곽 고리 ----------
/**
 * 집결 기대 상태(PLAN 3.1): u = clock − first; u < 0 이면 calm·cycle −1, 아니면 cycle = floor(u / period), m = u − cycle·period;
 * m < warning 이면 warning, m < warning + burst 이면 burst, 그 밖 calm. age = 그 상태 안에서 지난 초(calm 은 터짐이 끝난 뒤부터).
 * edge: 경계(상태가 바뀌는 시각)에서 부동소수 때문에 상태를 가를 수 없는 값.
 */
export function shardExpect(ring, clock) {
  const u = clock - ring.first;
  if (u < 0) return { state: SHARD_CODE.calm, cycle: -1, age: null, edge: Math.abs(u) <= BOUNDARY };
  const cycle = Math.floor(u / ring.period), m = u - cycle * ring.period;
  const w = ring.warning, b = ring.burst;
  const edge = Math.abs(u) <= BOUNDARY || [0, w, w + b, ring.period].some(x => Math.abs(m - x) <= BOUNDARY);
  if (m < w) return { state: SHARD_CODE.warning, cycle, age: m, edge };
  if (m < w + b) return { state: SHARD_CODE.burst, cycle, age: m - w, edge };
  return { state: SHARD_CODE.calm, cycle, age: m - w - b, edge };
}

/**
 * 고리 열림. 처음 idle 이 아니게 된 행은 open 이고(앞 행은 모두 idle), 그 행에서 progress = n · 모든 성좌 attuned · 시작/보스를 뺀 모든 방 cleared(rem = 0) · clock 0(열리는 스텝에는 시간이 흐르지 않음),
 * 조건(progress = n 이고 rem = 0)이 처음 관측된 스텝에서 최대 한 스텝 뒤에 열린다(markCleared 직후가 아니라 다음 update). 열림 뒤 어느 행에서도 조건이 깨지지 않고, phase 는 idle → open → running → done 순서로만 간다.
 * 고리 방 id 는 정의와 같다. "4/4 전에 열림"은 early 로 잡힌다.
 */
export function checkRingOpen(rows, def) {
  const n = def.gates.length, first = rows.findIndex(r => r.rg && r.rg.ph !== PHASE_CODE.idle);
  if (first < 0) return { ok: false, reason: 'never-open' };
  const r = rows[first], before = rows.slice(0, first);
  const notIdle = before.filter(x => x.rg?.ph !== PHASE_CODE.idle).length;
  const condIdx = rows.findIndex(x => x.pr === n && x.rem === 0), lag = condIdx >= 0 ? r.n - rows[condIdx].n : null;
  const early = rows.filter(x => x.rg && x.rg.ph !== PHASE_CODE.idle && (x.pr !== n || x.rem !== 0 || x.g.some(g => g.at !== 1))).map(x => ({ n: x.n, pr: x.pr, rem: x.rem, ph: x.rg.ph }));
  const sequence = [];
  for (const row of stepRows(rows)) if (row.rg && row.rg.ph !== sequence.at(-1)) sequence.push(row.rg.ph);
  const monotone = sequence.every((ph, i) => i === 0 || ph > sequence[i - 1]);
  const rec = { n: r.n, t: r.t, phase: r.rg.ph, progress: r.pr, remaining: r.rem, clock: r.rg.ck, lag, earlierRows: before.length, notIdleBefore: notIdle,
    allAttuned: r.g.every(g => g.at === 1), early: early.slice(0, 4), earlyCount: early.length, sequence, roomId: r.rg.rid };
  return { ...rec, ok: before.length > 0 && notIdle === 0 && r.rg.ph === PHASE_CODE.open && r.pr === n && r.rem === 0 && rec.allAttuned && r.rg.ck <= EPS
    && lag !== null && lag >= 0 && lag <= 1 && early.length === 0 && monotone && r.rg.rid === def.ring.roomId && rows.every(x => !x.rg || x.rg.rid === r.rg.rid) };
}

/**
 * 정화 시작. running 이 처음 관측된 행: 앞 행은 open(밀집 관측), 영웅은 고리 방 사각형 안(한 스텝 이동 여유 포함)이고, 시작 스텝은 elapsed ≤ 한 프레임 · limit = 정의 limit · left = limit · 붕괴 0 · 피격 0 · 정화 0.
 * 열려 있는 동안(열린 스텝은 제외) 영웅이 사각형 '깊숙이'(경계 − START_SLACK 안) 있던 행이 있으면 시작이 늦은 것이다. waited: 열린 뒤 시작 전까지 보낸 초(open 행 수).
 */
export function checkRingStart(rows, def, setup) {
  const idx = rows.findIndex(r => r.rg?.ph === PHASE_CODE.running);
  if (idx < 1) return { ok: false, reason: 'never-running' };
  const r = rows[idx], p = rows[idx - 1], openIdx = rows.findIndex(x => x.rg && x.rg.ph !== PHASE_CODE.idle);
  const openN = openIdx >= 0 ? rows[openIdx].n : null;
  const late = rows.slice(0, idx).filter(x => x.n !== openN && x.rg?.ph === PHASE_CODE.open && inRoom(setup, x.x, x.z, -START_SLACK)).map(x => ({ n: x.n, x: x.x, z: x.z }));
  const waited = openIdx >= 0 ? (r.n - rows[openIdx].n - 1) * FRAME : null;
  const rec = { n: r.n, t: r.t, hero: { x: r.x, z: r.z }, inZone: inRoom(setup, r.x, r.z, START_SLACK), previous: p.rg?.ph ?? null, previousStep: p.n === r.n - 1,
    limit: r.rg.lim, left: r.rg.lf, elapsed: r.rg.el, collapses: r.rg.co, shardHits: r.rg.sh, purified: r.rg.pu, lateRows: late.slice(0, 4), lateCount: late.length, waited, openN: rows[openIdx]?.n ?? null };
  return { ...rec, ok: p.rg?.ph === PHASE_CODE.open && rec.previousStep && rec.inZone && late.length === 0 && r.rg.el <= FRAME + EPS && r.rg.lim === def.ring.limit
    && Math.abs(r.rg.lf - r.rg.lim) <= FRAME + EPS && r.rg.co === 0 && r.rg.sh === 0 && r.rg.pu === 0 };
}

/** 제한 시간. 정화 중인 모든 행의 limit 은 정의 limit 이고 0 ≤ left ≤ limit 이다. */
export function checkRingLimit(rows, def) {
  const run = stepRows(rows).filter(r => r.rg?.ph === PHASE_CODE.running);
  const bad = run.filter(r => r.rg.lim !== def.ring.limit || !(r.rg.lf >= -EPS) || r.rg.lf > r.rg.lim + EPS).map(r => ({ n: r.n, lim: r.rg.lim, lf: r.rg.lf }));
  return { rows: run.length, bad: bad.slice(0, 6), badCount: bad.length, ok: run.length > 0 && bad.length === 0 };
}

/**
 * 고리 시계. 연속한 open|running 두 스텝에서 clock 은 게임 시간만큼 늘고, 둘 다 running 이면 left 는 게임 시간만큼 줄고 elapsed 는 늘어난다(붕괴 스텝 쌍은 left · elapsed 제외).
 * 정상 경로 하나만 면제한다: 그 스텝 안에서 전투가 일시정지됐고(pz) clock · left · elapsed 가 직전 행과 정확히 같다. 조금이라도 다르면 위반이다.
 * 확인한 쌍이 minPairs 개 이상이어야 한다.
 */
export function checkRingClock(rows, { minPairs = 30 } = {}) {
  const list = stepRows(rows), bad = [], pauseEntry = [];
  let pairs = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (!live(a) || !live(b) || b.n !== a.n + 1) continue;
    pairs++;
    const dt = b.t - a.t;
    const sameAll = b.rg.ck === a.rg.ck && b.rg.lf === a.rg.lf && b.rg.el === a.rg.el;
    if (b.pz === 1 && sameAll) { pauseEntry.push({ n: b.n, dt }); continue; }
    if (Math.abs((b.rg.ck - a.rg.ck) - dt) > EPS) { bad.push({ kind: 'clock', n: b.n, dt, clock: [a.rg.ck, b.rg.ck] }); continue; }
    if (a.rg.ph === PHASE_CODE.running && b.rg.ph === PHASE_CODE.running && a.rg.co === b.rg.co
      && (Math.abs((a.rg.lf - b.rg.lf) - dt) > EPS || Math.abs((b.rg.el - a.rg.el) - dt) > EPS)) bad.push({ kind: 'left', n: b.n, dt, left: [a.rg.lf, b.rg.lf], elapsed: [a.rg.el, b.rg.el] });
  }
  return { pairs, bad: bad.slice(0, 6), badCount: bad.length, pauseEntry, ok: pairs >= minPairs && bad.length === 0 };
}

/** 집결 위상. open|running 행마다 집결 상태 · cycle · age 가 clock 에서 계산한 값과 같다(경계 값은 건너뛴다). 예고와 터짐이 모두 관측돼야 한다. */
export function checkShards(rows, def, { minRows = 30 } = {}) {
  const c = def.ring, bad = [];
  let checked = 0, skipped = 0, rowsChecked = 0;
  const seen = { calm: 0, warning: 0, burst: 0 };
  for (const r of stepRows(rows)) {
    if (!live(r)) continue;
    rowsChecked++;
    const sd = r.rg.sd;
    seen[SHARD_NAMES[sd.s]]++;
    const e = shardExpect(c, r.rg.ck);
    if (e.edge) { skipped++; continue; }
    checked++;
    if (sd.s !== e.state) bad.push({ kind: 'state', n: r.n, clock: r.rg.ck, got: SHARD_NAMES[sd.s], want: SHARD_NAMES[e.state] });
    else if (sd.c !== e.cycle) bad.push({ kind: 'cycle', n: r.n, clock: r.rg.ck, got: sd.c, want: e.cycle });
    // age 는 예고·터짐 상태에서만 판정한다(calm 의 경과 기준은 규칙 구현에 맡긴다: 값이 유한한지는 관측 완전성이 본다).
    else if (e.age !== null && e.state !== SHARD_CODE.calm && Math.abs(sd.a - e.age) > 1e-4) bad.push({ kind: 'age', n: r.n, clock: r.rg.ck, got: sd.a, want: e.age });
  }
  return { rows: rowsChecked, checked, skipped, seen, bad: bad.slice(0, 8), badCount: bad.length, ok: rowsChecked >= minRows && bad.length === 0 && seen.warning > 0 && seen.burst > 0 };
}

/**
 * 파편 피격(ring.shardHits). 늘어난 행은 (a) 한 번에 +1, (b) 그 행 또는 직전 스텝 행에서 터지는 중이고 영웅이 중심 core 반경(+여유) 안,
 * (c) 같은 cycle 에 두 번 늘지 않는다(집결당 한 번). 설명할 수 없는 증가(core 밖·터짐 아님)는 위반이다.
 * 터지는 동안 core 깊숙이(core − 여유) 있던 cycle 에 증가가 없으면 missed 다. strictMissed 면 위반이고, 아니면(AUTO: 회피 동작 무적 가능) 기록만 한다.
 * strict 면 직전 스텝보다 HP 가 줄고 hurt 에 넘긴 값이 정의 damage 여야 한다. multiRow: 같은 cycle 안에서 터짐 중 core 안 영웅이 있던 행이 둘 이상이면서 증가가 한 번뿐인 칸 수(두 번 없음을 뜻 있게 보여 준다).
 */
export function checkShardHits(rows, def, setup, { strict = false, strictMissed = false } = {}) {
  const c = def.ring, rs = ringSetup(setup), sr = stepRows(rows), cells = new Map(), hits = [], bad = [];
  const center = rs ? { x: rs.cx, z: rs.cz } : null;
  const cell = cycle => { if (!cells.has(cycle)) cells.set(cycle, { cycle, deep: 0, edge: 0, inc: 0 }); return cells.get(cycle); };
  for (let i = 0; i < sr.length; i++) {
    const r = sr[i], p = i > 0 ? sr[i - 1] : null;
    if (!r.rg) continue;
    if (live(r) && center && r.rg.sd.s === SHARD_CODE.burst) {
      const d = dist(r, center), k = cell(r.rg.sd.c);
      if (d <= c.core - CORE_INNER_MARGIN) k.deep++;
      if (d <= c.core + CORE_OUTER_SLACK) k.edge++;
    }
    if (!p?.rg || !(r.rg.sh > p.rg.sh)) continue;
    const jump = r.rg.sh - p.rg.sh;
    // 이 증가를 설명하는 집결: 이 행이나 직전 스텝 행에서 터지는 중이고 영웅이 core 안(여유 포함)이다.
    let found = null;
    for (const src of [r, p]) {
      if (found || !src.rg || !live(src) || !center) continue;
      if (src.rg.sd.s === SHARD_CODE.burst && dist(src, center) <= c.core + CORE_OUTER_SLACK) found = { cycle: src.rg.sd.c };
    }
    const ratio = p.n === r.n - 1 && r.mhp > 0 ? (p.hp - r.hp) / r.mhp : null;
    const rec = { n: r.n, t: r.t, jump, cycle: found?.cycle ?? null, ratio, raw: r.hr ?? null, explained: !!found };
    hits.push(rec);
    if (jump !== 1) bad.push({ kind: 'jump', n: r.n, jump });
    if (!found) bad.push({ kind: 'unexplained', n: r.n, hero: [r.x, r.z] });
    else cell(found.cycle).inc += jump;
    if (strict && !damageMatches(r, ratio, c.damage)) bad.push({ kind: 'damage', n: r.n, ratio, raw: r.hr ?? null, want: c.damage });
  }
  const list = [...cells.values()];
  for (const k of list) if (k.inc > 1) bad.push({ kind: 'double', cycle: k.cycle, hits: k.inc });
  const missed = list.filter(k => k.deep > 0 && k.inc === 0).map(k => ({ cycle: k.cycle }));
  if (strictMissed) for (const m of missed) bad.push({ kind: 'missed', ...m });
  const first = sr.find(r => r.rg)?.rg.sh ?? 0, last = sr.at(-1)?.rg?.sh ?? null;
  const multiRow = list.filter(k => k.inc === 1 && k.edge >= 2).length;
  return { total: last === null ? null : last - first, hits, cells: list.filter(k => k.inc > 0 || k.deep > 0), missed, multiRow, bad: bad.slice(0, 8), badCount: bad.length, strict,
    ok: bad.length === 0 && last !== null && last - first === hits.reduce((a, h) => a + h.jump, 0) };
}

/**
 * 성표. 모든 정화 중인 행에서 (a) purified 가 done 성표 수와 같고, (b) 정화하지 않은 성표의 hold 는 영웅이 그 성표 반경(+여유) 안일 때만 0 보다 크고(벗어나면 초기화),
 * 한 번에 한 성표만 유지 중이며 held 가 그 번호다. 정화 이벤트(purified 증가) = (c) 한 번에 성표 하나가 done 으로 바뀌고 purified +1,
 * (d) 그 성표의 hold 가 0 에서 새로 시작해 게임 시간만큼 늘며 holdSeconds − 1/60 이상(정화 스텝 포함 1~2행 안에서 가득 참) 이어졌고 그 내내 영웅이 성표 반경 안,
 * (e) 붕괴 스텝이 아니면 done 이 풀리거나 purified 가 줄지 않는다. 순서는 자유라 정화한 순서를 기록만 한다.
 */
export function checkMarks(rows, def, setup) {
  const c = def.ring, rs = ringSetup(setup), list = stepRows(rows), events = [], bad = [];
  const marks = rs?.marks ?? [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r.rg || r.rg.ph === PHASE_CODE.idle) continue;
    const doneCount = r.rg.m.filter(m => m.d === 1).length;
    if (r.rg.pu !== doneCount) bad.push({ kind: 'count', n: r.n, purified: r.rg.pu, done: doneCount });
    const holding = [];
    r.rg.m.forEach((m, k) => {
      if (m.d === 1 || !(m.h > 0)) return;
      holding.push(k);
      if (!marks[k] || dist(r, marks[k]) > c.markRadius + MOVE_SLACK) bad.push({ kind: 'held-away', n: r.n, mark: k, hold: m.h, distance: marks[k] ? dist(r, marks[k]) : null });
    });
    if (holding.length > 1) bad.push({ kind: 'two-held', n: r.n, marks: holding });
    if (holding.length === 1 && r.rg.ho !== holding[0]) bad.push({ kind: 'held-index', n: r.n, held: r.rg.ho, want: holding[0] });
    const p = i > 0 ? list[i - 1] : null;
    if (!p?.rg || p.rg.ph === PHASE_CODE.idle) continue;
    const collapsed = r.rg.co > p.rg.co;
    if (!collapsed) {
      if (r.rg.pu < p.rg.pu) bad.push({ kind: 'purified-down', n: r.n, from: p.rg.pu, to: r.rg.pu });
      r.rg.m.forEach((m, k) => { if (p.rg.m[k].d === 1 && m.d === 0) bad.push({ kind: 'undone', n: r.n, mark: k }); });
    }
    if (r.rg.pu > p.rg.pu && !collapsed) {
      const flipped = r.rg.m.map((m, k) => (m.d === 1 && p.rg.m[k].d === 0 ? k : -1)).filter(k => k >= 0);
      const k = flipped[0] ?? null;
      // 가득 찬 유지: 정화 스텝 행(hold 가 리셋되지 않았으면) 또는 그 직전 행에서 끝나는 연속 유지 구간.
      let run = null;
      if (k !== null) {
        const endAt = list[i].rg.m[k].h > 0 ? i : i - 1;
        const pick = list.map(x => ({ ...x, hd: x.rg?.m?.[k]?.h ?? 0 }));
        const hs = endAt >= 0 ? holdStart(pick, endAt) : -1;
        const hrows = hs >= 0 ? pick.slice(hs, endAt + 1) : [];
        const far = hrows.length && marks[k] ? Math.max(...hrows.map(x => dist(x, marks[k]))) : null;
        run = { steps: hrows.length, seconds: hrows.length ? hrows.at(-1).hd : null, fromZero: hrows.length > 0 && hrows[0].hd <= FRAME + EPS, farthest: far };
      }
      const rec = { n: r.n, t: r.t, mark: k, flipped: flipped.length, jump: r.rg.pu - p.rg.pu, purified: r.rg.pu, run,
        ok: flipped.length === 1 && r.rg.pu - p.rg.pu === 1 && !!run && run.fromZero && run.steps * FRAME + EPS >= c.holdSeconds - FRAME && run.seconds + FRAME + EPS >= c.holdSeconds
          && run.farthest !== null && run.farthest <= c.markRadius + MOVE_SLACK };
      events.push(rec);
      if (!rec.ok) bad.push({ kind: 'purify', n: r.n, ...rec });
    }
  }
  const doneRow = list.find(r => r.rg?.ph === PHASE_CODE.done);
  const last = list.at(-1);
  return { events, order: events.map(e => e.mark), count: events.length, bad: bad.slice(0, 8), badCount: bad.length,
    finalPurified: last?.rg?.pu ?? null, doneAllMarks: !!doneRow && doneRow.rg.m.every(m => m.d === 1) && doneRow.rg.pu === c.marks.length,
    ok: bad.length === 0 && events.length > 0 };
}

/**
 * 붕괴(ring.collapses). 늘어난 행은 (a) 한 번에 +1, (b) 앞 스텝 행이 running 이고 left 가 그 스텝에서 바닥났다(앞 행 left ≤ 한 프레임), (c) 이 행의 left = limit(정의 limit), phase 는 running 유지,
 * (d) purified 0 · 모든 성표 done false · hold 0 · held −1(성표 초기화), 정화 시간은 limit 부터 다시. strict 면 직전 스텝보다 HP 가 줄고 hurt 에 넘긴 값이 정의 collapseDamage 여야 한다.
 */
export function checkCollapses(rows, def, { strict = false } = {}) {
  const c = def.ring, sr = stepRows(rows), collapses = [], bad = [];
  for (let i = 1; i < sr.length; i++) {
    const r = sr[i], p = sr[i - 1];
    if (!r.rg || !p.rg || !(r.rg.co > p.rg.co)) continue;
    const dense = p.n === r.n - 1;
    const ratio = dense && r.mhp > 0 ? (p.hp - r.hp) / r.mhp : null;
    const rec = { n: r.n, t: r.t, jump: r.rg.co - p.rg.co, dense, previousLeft: p.rg.lf, previousPhase: p.rg.ph, phase: r.rg.ph, limit: r.rg.lim, left: r.rg.lf, purified: r.rg.pu,
      doneMarks: r.rg.m.filter(m => m.d === 1).length, holdMarks: r.rg.m.filter(m => m.h !== 0).length, held: r.rg.ho, ratio, raw: r.hr ?? null, hero: { x: r.x, z: r.z } };
    collapses.push(rec);
    if (rec.jump !== 1) bad.push({ kind: 'jump', n: r.n, jump: rec.jump });
    if (!dense) bad.push({ kind: 'sparse', n: r.n });
    if (p.rg.ph !== PHASE_CODE.running || !(p.rg.lf <= FRAME + EPS)) bad.push({ kind: 'not-expired', n: r.n, previousPhase: p.rg.ph, previousLeft: p.rg.lf });
    if (r.rg.ph !== PHASE_CODE.running) bad.push({ kind: 'phase', n: r.n, phase: r.rg.ph });
    if (r.rg.lim !== c.limit || Math.abs(r.rg.lf - r.rg.lim) > FRAME + EPS) bad.push({ kind: 'limit', n: r.n, limit: r.rg.lim, left: r.rg.lf });
    if (rec.purified !== 0 || rec.doneMarks !== 0 || rec.holdMarks !== 0 || rec.held !== -1) bad.push({ kind: 'marks-kept', n: r.n, purified: rec.purified, doneMarks: rec.doneMarks, holdMarks: rec.holdMarks, held: rec.held });
    if (strict && !damageMatches(r, ratio, c.collapseDamage)) bad.push({ kind: 'damage', n: r.n, ratio, raw: r.hr ?? null, want: c.collapseDamage });
  }
  const last = [...sr].reverse().find(r => r.rg);
  return { total: last?.rg?.co ?? null, collapses, bad: bad.slice(0, 8), badCount: bad.length, strict, ok: bad.length === 0 && (last?.rg?.co ?? 0) === collapses.reduce((a, f) => a + f.jump, 0) };
}

/**
 * 고리 완료. done 은 앞 행이 running(밀집 관측)이고 done 스텝에 purified 가 성표 수·모든 성표 done 일 때만 처음 관측된다. done 뒤에는 다시 running 이 되지 않고 횟수(붕괴·피격)가 늘지 않는다.
 */
export function checkRingDone(rows, def) {
  const idx = rows.findIndex(r => r.rg?.ph === PHASE_CODE.done);
  if (idx < 1) return { ok: false, reason: 'never-done' };
  const r = rows[idx], p = rows[idx - 1], markCount = def.ring.marks.length;
  const after = rows.slice(idx), back = after.filter(x => x.rg?.ph !== PHASE_CODE.done).length;
  const grew = after.filter(x => x.rg && (x.rg.co !== r.rg.co || x.rg.sh !== r.rg.sh)).length;
  return { n: r.n, t: r.t, previous: p.rg?.ph ?? null, purified: r.rg.pu, elapsed: r.rg.el, back, grew, hpAlive: r.al === 1 && r.hp > 0,
    ok: p.rg?.ph === PHASE_CODE.running && p.n === r.n - 1 && r.rg.pu === markCount && r.rg.m.every(m => m.d === 1) && back === 0 && grew === 0 && r.al === 1 };
}

/**
 * 보스 봉인. 시작부터 world.sealed 였고 고리 완료(done) 전 모든 행에서 true 다(4/4 와 모든 구역 정화로는 풀리지 않는다).
 * 해제(처음 false)는 done 스텝 또는 그 한 스텝 뒤이고 그때 progress = n · rem = 0 이며 그 뒤 다시 잠기지 않는다.
 */
export function checkSeal(rows, def) {
  const n = def.gates.length, first = rows.findIndex(r => r.sl === 0);
  const startsSealed = rows[0]?.sl === 1;
  if (first < 0) return { ok: false, startsSealed, reason: 'never-unsealed' };
  const row = rows[first], doneIdx = rows.findIndex(r => r.rg?.ph === PHASE_CODE.done);
  const beforeAll = rows.slice(0, first).every(r => r.sl === 1);
  const relocked = rows.slice(first).filter(r => r.sl !== 0).length;
  const afterDone = doneIdx >= 0 && first >= doneIdx && row.n - rows[doneIdx].n <= 1 && row.rg?.ph === PHASE_CODE.done;
  const ok = startsSealed && beforeAll && afterDone && row.pr === n && row.rem === 0 && relocked === 0;
  return { ok, startsSealed, n: row.n, t: row.t, progress: row.pr, remaining: row.rem, doneIdx, firstUnsealed: first, afterDone, relocked, reason: ok ? null : 'early-or-inconsistent' };
}

/** AUTO 는 붕괴가 없고(collapses 0) 성표 4개를 정화한다. 파편 피격 · 오답 수는 기록만 한다. clean 이 아니면 붕괴 수는 요구하지 않는다. */
export function checkAutoCounts(rows, def, { clean = true } = {}) {
  const ring = rows.filter(r => r.rg && (r.rg.ph === PHASE_CODE.running || r.rg.ph === PHASE_CODE.done));
  const collapses = Math.max(0, ...ring.map(r => r.rg.co)), shardHits = Math.max(0, ...ring.map(r => r.rg.sh)), purified = ring.at(-1)?.rg.pu ?? null;
  const last = rows.at(-1);
  return { rows: ring.length, collapses, shardHits, purified, mistakes: last?.mi ?? null, hurts: last?.hn ?? null,
    ok: ring.length > 0 && purified === def.ring.marks.length && (!clean || collapses === 0) };
}

// ---------- 결과·문구 ----------
const compact = s => String(s ?? '').replace(/\s+/g, '');
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * 결과 객체: { id, complete: true, progress n, target n, mistakes, rooms = 정의 순서, constellations[{ stationId, roomId, label, choice }], ring{ purified, marks, collapses, shardHits, seconds } }.
 * 횟수는 0 이상의 정수이고 관측한 마지막 값(opts.mistakes · collapses · shardHits)과 같아야 한다. seconds 는 정화 시작 뒤 걸린 초(done 행의 elapsed, opts.seconds)와 .06 안에서 같다.
 * ring.purified 는 완료 여부(true) 또는 정화한 성표 수(성표 수와 같음)로 읽고, ring.marks 는 정화한 성표 수로 성표 수와 같다.
 */
export function checkResultFields(ro, def, win = true, { mistakes = null, collapses = null, shardHits = null, seconds = null } = {}) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId), ring = ro?.ring ?? null, markCount = def.ring.marks.length;
  const count = (v, want) => isInt(v) && v >= 0 && (want === null || v === want);
  const stations = def.gates.map(g => ({ stationId: g.stationId, roomId: g.roomId, label: g.label, choice: g.answer }));
  const ringOk = !!ring && (ring.purified === true || ring.purified === markCount) && ring.marks === markCount && count(ring.collapses, collapses) && count(ring.shardHits, shardHits)
    && finite(ring.seconds) && ring.seconds >= 0 && (seconds === null || Math.abs(ring.seconds - seconds) <= .06);
  const ok = !!ro && win === true && ro.id === def.id && ro.complete === true && ro.progress === n && ro.target === n && count(ro.mistakes, mistakes)
    && JSON.stringify(ro.rooms) === JSON.stringify(rooms) && same(JSON.parse(JSON.stringify(ro.constellations ?? null)), stations) && ringOk;
  const got = ro ? { id: ro.id, complete: ro.complete, progress: ro.progress, target: ro.target, mistakes: ro.mistakes, rooms: [...(ro.rooms || [])],
    constellations: ro.constellations ? ro.constellations.map(s => ({ ...s })) : null, ring: ring ? { ...ring } : null } : null;
  return { ok, got, ringOk, want: { id: def.id, complete: true, progress: n, target: n, mistakes, rooms, constellations: stations, collapses, shardHits, seconds } };
}
/** 결과 화면 본문에 두 줄('별자리 복원 4/4 · … · 오답 n회', '외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 n회 · 붕괴 n회')이 모두 있고 별자리 줄은 한 번만 나온다. */
export function checkResultLines(text, def, ro) {
  const constellation = constellationResultLine(ro), ring = ringResultLine(ro?.ring, def.ring.marks.length, def.ring);
  const body = norm(text);
  const countOf = needle => (needle ? body.split(needle).length - 1 : 0);
  const prefixCount = countOf('별자리 복원 ' + ro?.progress + '/' + ro?.target);
  return { ok: typeof text === 'string' && countOf(constellation) === 1 && prefixCount === 1 && countOf(ring) === 1, constellation, ring, constellationFound: countOf(constellation), ringFound: countOf(ring), prefixCount };
}
/** 결과 줄 요소: aria-label '별자리 복원 결과' 본문이 첫 줄, '외곽 고리 정화 결과' 본문이 둘째 줄과 정확히 같고 각각 하나뿐이다. lines: [{ aria, text }]. */
export function checkResultElements(lines, def, ro) {
  const constellationAria = '별자리 복원 결과', ringAria = ringCopy(def.ring).resultAria, constellation = constellationResultLine(ro), ring = ringResultLine(ro?.ring, def.ring.marks.length, def.ring);
  const pick = aria => (lines || []).filter(l => l?.aria === aria);
  const a = pick(constellationAria), c = pick(ringAria);
  const ok = a.length === 1 && norm(a[0].text) === constellation && c.length === 1 && norm(c[0].text) === ring;
  return { ok, constellationAria, ringAria, constellation, ring, found: { constellation: a.map(l => l.text), ring: c.map(l => l.text) } };
}

/**
 * 목표창 기대 문구(PLAN 3.2): 성좌 단계는 제목 '별자리 복원' + n/4 와 단계 문구(발견 전 '다음 구역을 찾아 이동', 준비 전 '이 구역의 적과 증원 처치',
 * read '모래시계 단서 1초 읽기', select '월드 단서와 같은 판에서 1초 유지', retry '판 밖으로 나와 다시 읽기', 그 밖 '전투를 마치고 모래시계로 이동'),
 * 4/4 뒤 고리가 닫혀 있으면 '남은 구역 정화', 열림은 '외곽 고리 정화' · 성좌 외곽 고리로 이동, 정화 중은 파편이 모이면 중심 밖으로 · N초(10Hz 갱신이라 올림 값 또는 한 칸 위).
 * done 이후는 보스 흐름이라 표본을 보지 않는다(null).
 */
export function expectedObjective(row, def) {
  const n = def.gates.length, rg = row.rg;
  const title = contractOf(def).gates.title;
  if (rg?.ph === PHASE_CODE.done) return null;
  if (rg?.ph === PHASE_CODE.open) { const c = ringCopy(def.ring); return { kind: 'open', title: c.title, action: c.openAction }; }
  if (rg?.ph === PHASE_CODE.running) { const c = ringCopy(def.ring); return { kind: 'run', title: c.title, actionPrefix: c.runAction, seconds: [Math.ceil(rg.lf), Math.ceil(rg.lf) + 1] }; }
  if (row.pr >= n) return { kind: 'remain', title, count: n + '/' + n, action: COPY.remain };
  const g = row.g?.[row.pr];
  if (!g) return null;
  const count = row.pr + '/' + n;
  if (g.dc !== 1) return { kind: 'find', title, count, action: COPY.find };
  if (g.rdy !== 1) return { kind: 'fight', title, count, action: COPY.fight };
  if (row.ph === GATE_PHASE_CODE.retry) return { kind: 'retry', title, count, action: COPY.retry };
  if (row.ph === GATE_PHASE_CODE.select) return { kind: 'select', title, count, action: COPY.select };
  if (row.ph === GATE_PHASE_CODE.read) return { kind: 'read', title, count, action: COPY.read };
  return { kind: 'combat', title, count, action: COPY.combat };
}
/**
 * 목표창 표본(같은 상태가 0.6초 이어진 뒤 10Hz 갱신이 지난 표본). 모든 표본이 그 상태의 기대 문구를 가지고 이전(공명)·일반판(조율판) 문구가 없어야 한다.
 * 선택 단계 표본(select)과 고리 정화 중 표본(run)이 각각 1개 이상 있어야 한다. 나머지 단계 표본은 보고 항목이다.
 */
export function checkObjectiveSamples(rows, def) {
  const samples = rows.filter(r => typeof r.dom === 'string'), kinds = {}, bad = [];
  for (const r of samples) {
    const want = expectedObjective(r, def), dom = compact(r.dom);
    let ok = !!want && !leaks(r.dom, def) && dom.includes(compact(want.title));
    if (ok && want.count) ok = dom.includes(compact(want.count));
    if (ok && want.action) ok = dom.includes(compact(want.action));
    if (ok && want.actionPrefix) ok = want.seconds.some(s => dom.includes(compact(want.actionPrefix + s + '초')));
    if (want) kinds[want.kind] = (kinds[want.kind] ?? 0) + 1;
    if (!ok) bad.push({ n: r.n, want: want ? (want.action ?? want.actionPrefix + want.seconds.join('|')) : null, dom: r.dom });
  }
  return { samples: samples.length, kinds, bad: bad.slice(0, 6), badCount: bad.length, ok: samples.length > 0 && bad.length === 0 && (kinds.select ?? 0) >= 1 && (kinds.run ?? 0) >= 1 };
}

/**
 * 토스트 표본({ n, t, msg, kind, tac }). 성좌마다 준비 토스트 1회('<라벨> 정화 · 모래시계 단서를 읽으세요' — 준비된 순간 그 성좌가 차례일 때, 아니면 '… · 복원 순서 대기'),
 * 복원 토스트 4개 각각 1회·정의 순서('<라벨> 복원 완료 · n/4'), 4번째 뒤 '모든 별자리 복원 …' 1회, 고리 열림 1회, 시작 '외곽 고리 정화 시작 · <limit>초' 1회(startLimit 이 시작 스텝 limit 과 같음),
 * 성표 토스트 '성표 정화 · k/4' 는 관측한 정화 이벤트(purifyCounts: 정화 직후 purified 값을 순서대로)마다 1회(마지막 4/4 성표 토스트는 완료 토스트가 대신할 수 있어 있어도 없어도 된다),
 * 파편 피격 토스트는 결과의 shardHits 와 같은 횟수, 붕괴 토스트는 collapses 와 같은 횟수(collapseLimits 가 있으면 순서대로 같은 limit), 오답 토스트는 mistakes 와 같은 횟수, 완료 토스트 1회.
 * 순서: 복원 4번째 < 모든 별자리 복원 < 열림 < 시작 < 완료. 이전(공명)·일반판(조율판) 문구가 있으면 누출이다.
 * 보스 입장 때 뜨는 실제 전술 토스트(stage.encounter.tactic)는 그 순간의 tactic 문자열(토스트의 tac, 없으면 encounterTactic)과 정확히 같은 토스트만 누출 검사에서 뺀다. 한 글자라도 다르면 그대로 검사한다.
 * readyCurrent: 성좌마다 준비된 순간 그 성좌가 차례였는지(true/false, checkReadyTiming 의 pr 로 계산)를 도구가 넘긴다. 없으면 두 문구 중 하나면 된다.
 */
export function checkToasts(toasts, def, { shardHits = null, collapses = null, mistakes = null, startLimit = null, collapseLimits = null, purifyCounts = null, readyCurrent = null, encounterTactic = null } = {}) {
  const fallback = typeof encounterTactic === 'string' && encounterTactic.length > 0 ? encounterTactic : null;
  const items = (toasts || []).map(t => ({ msg: String(t?.msg ?? ''), tac: typeof t?.tac === 'string' && t.tac.length > 0 ? t.tac : fallback }));
  const list = items.map(i => i.msg);
  const count = text => list.filter(m => m === text).length;
  const n = def.gates.length, markCount = def.ring.marks.length, copy = ringCopy(def.ring);
  const restore = def.gates.map((_, i) => ({ text: restoreToast(def, i), count: count(restoreToast(def, i)), at: list.indexOf(restoreToast(def, i)) }));
  const ready = def.gates.map((_, i) => {
    const cur = readyToast(def, i, true), wait = readyToast(def, i, false);
    const total = count(cur) + count(wait), want = readyCurrent?.[i];
    const exact = want === undefined || want === null ? total === 1 : (want ? count(cur) === 1 && count(wait) === 0 : count(wait) === 1 && count(cur) === 0);
    const at = Math.max(list.indexOf(cur), list.indexOf(wait));
    return { total, exact, ok: exact && at >= 0 && at < restore[i].at };
  });
  const startAll = list.filter(m => copy.startPattern.test(m)), collapseAll = list.filter(m => copy.collapsePattern.test(m));
  const markAll = list.filter(m => copy.markPattern.test(m)), wrongAll = list.filter(m => /오답 · 단서는 .* · 판 밖으로 나와 다시 읽으세요\.$/.test(m));
  const hitCount = count(copy.shardHit), openCount = count(copy.ringOpen), doneCount = count(copy.done), allCount = count(copy.allRestored);
  const ordered = restore.every((p, i) => p.at >= 0 && (i === 0 || p.at > restore[i - 1].at));
  const seq = [restore.at(-1).at, list.indexOf(copy.allRestored), list.indexOf(copy.ringOpen), startAll.length ? list.indexOf(startAll[0]) : -1, list.indexOf(copy.done)];
  const sequence = seq.every((at, i) => at >= 0 && (i === 0 || at > seq[i - 1]));
  const isTactic = i => !!i.tac && i.msg === i.tac;
  const tacticToasts = items.filter(isTactic).length;
  const leaked = items.filter(i => !isTactic(i) && leaks(i.msg, def)).map(i => i.msg);
  const startOk = startAll.length === 1 && (startLimit === null || startAll[0] === copy.start(startLimit));
  const collapseOk = (collapses === null || collapseAll.length === collapses) && (collapseLimits === null || (collapseAll.length === collapseLimits.length && collapseAll.every((m, i) => m === copy.collapse(collapseLimits[i]))));
  // 성표 토스트: 정화 이벤트마다 정확히 하나(마지막 4/4 는 선택). purifyCounts 가 없으면 형식만 본다.
  let markOk = true, markExpect = null;
  if (purifyCounts) {
    markExpect = purifyCounts.filter(k => k < markCount).map(k => copy.mark(k, markCount));
    const finals = purifyCounts.filter(k => k === markCount).length;
    const got = markAll.filter(m => m !== copy.mark(markCount, markCount));
    markOk = JSON.stringify(got) === JSON.stringify(markExpect) && markAll.length - got.length <= finals;
  }
  const mistakesOk = mistakes === null || wrongAll.length === mistakes;
  const ok = ready.every(r => r.ok) && restore.every(p => p.count === 1) && ordered && allCount === 1 && openCount === 1 && startOk && doneCount === 1 && sequence && collapseOk && markOk && mistakesOk
    && leaked.length === 0 && (shardHits === null || hitCount === shardHits);
  return { ok, ready, restore, ordered, sequence, allCount, openCount, startToasts: startAll, startOk, markToasts: markAll, markOk, markExpect, hitCount, shardHits, collapseToasts: collapseAll, collapseOk,
    wrongToasts: wrongAll, mistakesOk, doneCount, leaked, tacticToasts, total: list.length, gates: n };
}

// ---------- 키보드 구간 ----------
const markIndex = (rows, label) => rows.findIndex(r => r.mk === label);
const markOf = (rows, label) => rows[markIndex(rows, label)] ?? null;
/** 키보드 구간 판정. 표식 from~to 사이 행에서 AUTO 꺼짐 · 공격 입력 없음 · 공격/스킬/회피 state 없음(시작 직후 SETTLE_STEPS 제외) · 영웅 생존. */
export function checkKeyboardSegment(rows, from, to) {
  const ia = markIndex(rows, from), ib = markIndex(rows, to), a = rows[ia], b = rows[ib];
  if (!a || !b || ib < ia) return { ok: false, reason: 'missing-mark', from, to, found: [!!a, !!b] };
  const seg = rows.slice(ia, ib + 1);
  const settled = seg.filter(r => r.n >= a.n + SETTLE_STEPS);
  const autoRows = seg.filter(r => r.au === 1).length, held = seg.filter(r => r.ah === 1).length;
  // 면제하는 정상 경로 하나: AUTO 를 끄기 전에 이미 시작된 동작(구간 첫 행이 동작 중)이 끝날 때까지의 첫 연속 구간(상한 CARRY_MAX_STEPS).
  // 그 구간에 공격 입력이 하나라도 있으면 면제하지 않는다.
  let carry = 0;
  if (ACTION_STATES.includes(a.ps)) {
    while (carry < seg.length && ACTION_STATES.includes(seg[carry].ps) && seg[carry].ah !== 1 && seg[carry].n - a.n < CARRY_MAX_STEPS) carry++;
  }
  const carried = new Set(seg.slice(0, carry));
  const action = settled.filter(r => !carried.has(r) && ACTION_STATES.includes(r.ps)).length;
  const dead = seg.filter(r => r.al !== 1 || !(r.hp > 0)).length;
  return { ok: seg.length > 0 && autoRows === 0 && held === 0 && action === 0 && dead === 0, rows: seg.length, steps: b.n - a.n, autoRows, attackHeld: held, actionRows: action, carriedActionRows: carry, dead };
}

// ---------- 종합 ----------
const lastOf = (rows, pick) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].rg) return pick(rows[i]); return null; };
/**
 * auto 프로필 종합 판정. obs: { rows, setup, result, resultText, resultLines, win, toasts, encounterTactic }.
 * clean: AUTO 가 붕괴 없이 고리를 정화했는지까지 요구한다. 수동 구간이 있는 ring 프로필은 false 로 부른다. requireEarly: 2번 성좌가 1번 복원 전에 준비돼 있어야 한다
 * (기본은 depth 계약 값: 심층 true, 일반판 false — 일반판에는 대기 조율판이 없다).
 */
export function analyzeAuto(obs, def, { clean = true, requireEarly = contractOf(def).requireEarly } = {}) {
  const rows = obs.rows || [], setup = obs.setup;
  // 관측이 빠진 행(null · 없는 칸)이 있어도 예외 없이 실패로 끝나야 한다: 판정 하나가 던지면 그 판정만 실패로 남긴다.
  const guard = (fn, fallback = {}) => { try { return fn(); } catch (error) { return { ...fallback, ok: false, error: String(error?.message ?? error) }; } };
  const definition = checkDefinition(def), observation = checkObservation(rows, def);
  const setupCheck = guard(() => checkSetup(setup, def));
  const restorations = guard(() => checkRestorations(rows, def, { setup }), { ok: { count: false, order: false, hold: false, read: false, available: false, state: false }, events: [], observedOrder: [], violations: [] });
  const turn = guard(() => checkTurnRooms(rows, def, { requireEarly })), ready = guard(() => checkReadyTiming(rows, def), { gates: [] });
  const open = guard(() => checkRingOpen(rows, def)), start = guard(() => checkRingStart(rows, def, setup)), limit = guard(() => checkRingLimit(rows, def)), clock = guard(() => checkRingClock(rows));
  const shards = guard(() => checkShards(rows, def)), hits = guard(() => checkShardHits(rows, def, setup)), marks = guard(() => checkMarks(rows, def, setup), { events: [] });
  const collapses = guard(() => checkCollapses(rows, def), { collapses: [] }), done = guard(() => checkRingDone(rows, def));
  const seal = guard(() => checkSeal(rows, def)), counts = guard(() => checkAutoCounts(rows, def, { clean }));
  const finalMistakes = rows.at(-1)?.mi ?? null, finalCollapses = lastOf(rows, r => r.rg.co), finalHits = lastOf(rows, r => r.rg.sh);
  const doneRow = rows.find(r => r.rg?.ph === PHASE_CODE.done);
  const result = guard(() => checkResultFields(obs.result, def, obs.win === true, { mistakes: finalMistakes, collapses: finalCollapses, shardHits: finalHits, seconds: doneRow?.rg.el ?? null }));
  const lines = guard(() => checkResultLines(obs.resultText, def, obs.result));
  const elements = Array.isArray(obs.resultLines) ? guard(() => checkResultElements(obs.resultLines, def, obs.result)) : null;
  const objective = guard(() => checkObjectiveSamples(rows, def));
  const startRow = rows.find(r => r.rg?.ph === PHASE_CODE.running);
  const toasts = guard(() => checkToasts(obs.toasts, def, { shardHits: finalHits, collapses: finalCollapses, mistakes: finalMistakes, startLimit: startRow?.rg.lim ?? null,
    collapseLimits: collapses.collapses.map(f => f.limit), purifyCounts: marks.events.map(e => e.purified), readyCurrent: ready.gates.map((g, i) => g.pr === i), encounterTactic: obs.encounterTactic ?? null }));
  const acceptance = {
    observation: observation.ok, definition: definition.ok, setup: setupCheck.ok === true,
    restoreCount: restorations.ok.count, restoreOrder: restorations.ok.order, restoreHold: restorations.ok.hold, restoreRead: restorations.ok.read, restoreAvailable: restorations.ok.available, restoreState: restorations.ok.state,
    turnRooms: turn.ok === true, readyTiming: ready.ok === true,
    ringOpen: open.ok === true, ringStart: start.ok === true, ringLimit: limit.ok === true, ringClock: clock.ok === true, shards: shards.ok === true, shardHits: hits.ok === true, marks: marks.ok === true,
    collapses: collapses.ok === true, ringDone: done.ok === true, sealed: seal.ok === true, resultFields: result.ok === true, resultLine: lines.ok === true, objectiveText: objective.ok === true, toasts: toasts.ok === true,
    ...(elements ? { resultElements: elements.ok === true } : {}),
    autoCounts: counts.ok === true,
  };
  return { ok: Object.values(acceptance).every(Boolean), acceptance, definition, setup: setupCheck, observation, restorations, turn, ready, open, start, limit, clock, shards, hits, marks, collapses, done, seal, counts,
    result, resultLines: lines, resultElements: elements, objective, toasts, rows: rows.length };
}

// ---------- choice 프로필(성좌 수동) ----------
/**
 * choice 프로필 판정(수동, 공격 키 없음). 표식: ch-manual(1번 성좌가 준비된 순간 AUTO 끔) · ch-read1(모래시계 근처에서 단서를 읽어 select 가 된 첫 스텝) ·
 * ch-wrong(오답 판 확정 스텝) · ch-reread(판 밖으로 나와 다시 읽어 select 가 된 첫 스텝) · ch-correct(정답 판 확정 스텝, progress 1).
 * 오답: 오답 판에서 holdSeconds 가 찬 다음 유효 프레임에 mistakes +1 · phase retry · progress 불변 · 읽기·유지 0 · selected 비움 이고, 그 확정 직전 유지 구간이 오답 판 하나에서 이어졌다.
 * 그 동안(ch-read1 ~ ch-correct) player.hurt 호출 수(hn)가 늘지 않는다(오답은 피해 없음). 재시도: retry 단계가 관측되고, 판 밖에서 읽기가 0 에서 새로 시작해 readSeconds 에 이르러 select 로 돌아온다.
 * 정답: 정답 판 확정 스텝에 progress 1 · 1번 성좌 attuned · 방 정화(cleared) · mistakes = 오답 1회. 확정 전에는 progress · 정화가 그대로다.
 */
function analyzeChoiceRaw(rows, def, setup) {
  const names = ['ch-manual', 'ch-read1', 'ch-wrong', 'ch-reread', 'ch-correct'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, keyboard: { ok: false }, wrong: { ok: false }, retry: { ok: false }, correct: { ok: false } };
  const idx = names.map(k => markIndex(rows, k));
  const orderedMarks = idx.every((v, i) => i === 0 || v >= idx[i - 1]);
  const gate = def.gates[0], sg = setup?.gates?.[0], hourglass = sg ? { x: sg.x, z: sg.z } : null;
  const manual = m['ch-manual'], read1 = m['ch-read1'], wrong = m['ch-wrong'], reread = m['ch-reread'], correct = m['ch-correct'];
  const keyboard = checkKeyboardSegment(rows, 'ch-manual', 'ch-correct');
  const m0 = manual.mi;
  const start = { progress: manual.pr, ready: manual.g[0]?.rdy, attuned: manual.g[0]?.at, auto: manual.au,
    ok: manual.pr === 0 && manual.g[0]?.rdy === 1 && manual.g[0]?.at === 0 && manual.au === 0 };
  const read = { phase: read1.ph, revealed: read1.rv, read: read1.rs, available: read1.g[0]?.av, distance: hourglass ? dist(read1, hourglass) : null,
    ok: read1.pr === 0 && read1.ph === GATE_PHASE_CODE.select && read1.rv === 1 && read1.rs + EPS >= def.readSeconds && read1.g[0]?.av === 1 && !!hourglass && dist(read1, hourglass) <= def.readRadius + MOVE_SLACK };
  // 오답 확정 직전의 유지 구간(스텝 행 기준)이 오답 판 하나에서 이어졌는지.
  const list = stepRows(rows), wi = list.findIndex(r => r.n === wrong.n);
  const hs = wi > 0 && list[wi - 1].n === wrong.n - 1 ? holdStart(list, wi - 1) : -1;
  const hrows = hs >= 0 ? list.slice(hs, wi) : [];
  const padId = hrows[0]?.se ?? '';
  const pad = (sg?.pads || []).find(p => p.id === padId) ?? null;
  const padFar = hrows.length && pad ? Math.max(...hrows.map(r => dist(r, pad))) : null;
  const wrongOk = {
    mistakes: wrong.mi, base: m0, phase: wrong.ph, progress: wrong.pr, hold: wrong.hd, read: wrong.rs, selected: wrong.se, pad: padId, heldSeconds: hrows.at(-1)?.hd ?? null, farthest: padFar,
    fromZero: hrows.length > 0 && hrows[0].hd <= FRAME + EPS, wrongPad: padId !== '' && padId !== gate.answer && def.choices.some(c => c.id === padId),
    ok: false,
  };
  const before = rows.slice(markIndex(rows, 'ch-manual'), markIndex(rows, 'ch-wrong')).filter(r => r.n < wrong.n);
  const mistakesBefore = before.every(r => r.mi === m0);
  wrongOk.ok = wrong.mi === m0 + 1 && wrong.ph === GATE_PHASE_CODE.retry && wrong.pr === 0 && wrong.hd === 0 && wrong.rs === 0 && wrong.se === '' && mistakesBefore
    && hrows.length > 0 && wrongOk.fromZero && wrongOk.heldSeconds + EPS >= def.holdSeconds && wrongOk.wrongPad && padFar !== null && padFar <= def.radius + MOVE_SLACK
    && hrows.every(r => r.se === padId && r.pr === 0);
  const hurts = { atRead: read1.hn, atCorrect: correct.hn, total: correct.hn - read1.hn, ok: correct.hn === read1.hn };
  const segment = rows.slice(markIndex(rows, 'ch-manual'), markIndex(rows, 'ch-correct') + 1);
  const hpDrop = segment.filter(r => Array.isArray(r.hr)).length;
  hurts.rowsWithHurt = hpDrop;
  // 재시도: retry 단계가 관측되고(오답 확정 행이 retry), 이후 판 밖에서 읽기가 0 에서 새로 시작해 select 로 돌아온다.
  const ri = list.findIndex(r => r.n === reread.n);
  const rs0 = ri >= 0 ? runStart(list, ri, r => r.rs > 0) : -1;
  const between = rows.slice(markIndex(rows, 'ch-wrong'), markIndex(rows, 'ch-reread') + 1);
  const retry = { rereadPhase: reread.ph, read: reread.rs, runStartN: rs0 >= 0 ? list[rs0].n : null, wrongN: wrong.n, readingRows: between.filter(r => r.ph === GATE_PHASE_CODE.read).length,
    retryRows: between.filter(r => r.ph === GATE_PHASE_CODE.retry).length, progress: reread.pr, mistakes: reread.mi,
    ok: reread.ph === GATE_PHASE_CODE.select && reread.rv === 1 && reread.rs + EPS >= def.readSeconds && reread.pr === 0 && reread.mi === m0 + 1 && rs0 >= 0 && list[rs0].n > wrong.n && list[rs0].rs <= FRAME + EPS
      && between.some(r => r.ph === GATE_PHASE_CODE.retry) && between.some(r => r.ph === GATE_PHASE_CODE.read) };
  const early = rows.slice(markIndex(rows, 'ch-manual'), markIndex(rows, 'ch-correct')).filter(r => r.n < correct.n && (r.pr !== 0 || r.g[0].at !== 0 || r.g[0].cl !== 0)).length;
  const correctOk = { progress: correct.pr, attuned: correct.g[0]?.at, cleared: correct.g[0]?.cl, mistakes: correct.mi, earlyRows: early, selected: list.find(r => r.n === correct.n - 1)?.se ?? null,
    ok: correct.pr === 1 && correct.g[0]?.at === 1 && correct.g[0]?.cl === 1 && correct.mi === m0 + 1 && early === 0 && list.find(r => r.n === correct.n - 1)?.se === gate.answer };
  return { ok: orderedMarks && keyboard.ok && start.ok && read.ok && wrongOk.ok && hurts.ok && retry.ok && correctOk.ok, orderedMarks, keyboard, start, read, wrong: wrongOk, hurts, retry, correct: correctOk, rows: segment.length };
}

// ---------- ring 프로필(고리 수동) ----------
/**
 * ring 프로필 판정(수동, 공격 키 없음). 표식: rg-manual(고리 open 에서 AUTO 끔) · rg-wait-end(방 밖 대기를 마침) · rg-started(정화 시작 스텝) · sh1(첫 파편 피격 스텝) · sh1-end(같은 집결이 끝난 뒤, core 안에 계속 선 채) ·
 * sh2(다음 cycle 피격 스텝) · sh2-end · pu1(성표 하나 정화 스텝) · collapse(붕괴 스텝) · rg-auto(AUTO 를 다시 켜기 직전).
 * start: AUTO 를 끈 순간 영웅이 방 사각형 밖이면(waited-outside) 대기 동안 phase 는 계속 open 이고 영웅은 방 밖이며 게임 시간으로 minWait 초 이상 기다린 뒤에야 시작한다.
 *   그 순간 이미 방 안이면(inside-at-open) 대기를 증명할 수 없어 '열린 다음 스텝에 running' 으로 대신한다. 어느 쪽인지 mode 에 남는다. 두 경우 모두 rg-started 는 처음 running 인 스텝이고 limit 은 정의 limit 이다.
 * hits: sh1 에서 shardHits +1, 같은 집결이 끝날 때까지 늘지 않고(그동안 core 안 터짐 행이 둘 이상), sh2 는 다음 cycle 에서 +1. 넘긴 값은 정의 damage(strict), core 깊숙이 있었는데 늘지 않은 집결은 실패.
 * purify: 두 번 피격 뒤 성표 하나 정화(purified 1, 붕괴 0, 유지 구간이 0 에서 시작해 holdSeconds 이상). collapse: 성표 밖 · core 밖에서 제한 시간 초과로 붕괴 1회(넘긴 값 collapseDamage, purified 0, 모든 성표 done false, left = limit).
 * done: AUTO 를 켜 4/4 · 고리 완료 · 봉인 해제(checkRingDone · checkSeal). 붕괴는 끝까지 1회뿐이다.
 */
function analyzeRingManualRaw(rows, def, setup, { minWait = 2.5 } = {}) {
  const names = ['rg-manual', 'rg-wait-end', 'rg-started', 'sh1', 'sh1-end', 'sh2', 'sh2-end', 'pu1', 'collapse', 'rg-auto'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, keyboard: { ok: false }, start: { ok: false }, hits: { ok: false }, purify: { ok: false }, collapse: { ok: false } };
  const at = k => markIndex(rows, k);
  const idx = names.map(at);
  const orderedMarks = idx.every((v, i) => i === 0 || v >= idx[i - 1]);
  const c = def.ring, rs = ringSetup(setup), center = rs ? { x: rs.cx, z: rs.cz } : { x: NaN, z: NaN };
  const keyboard = checkKeyboardSegment(rows, 'rg-manual', 'rg-auto');
  const window = rows.slice(0, at('rg-auto') + 1);
  const open = checkRingOpen(rows, def), begin = checkRingStart(rows, def, setup);
  const manual = m['rg-manual'], waitEnd = m['rg-wait-end'], started = m['rg-started'];
  const insideAtOpen = inRoom(setup, manual.x, manual.z);
  const waitRows = stepRows(rows.slice(at('rg-manual'), at('rg-wait-end') + 1));
  const waitSeconds = (waitEnd.n - manual.n) * FRAME;
  const wait = insideAtOpen
    ? { mode: 'inside-at-open', openN: begin.openN ?? null, startN: begin.n ?? null, markN: started.n, phaseAtManual: manual.rg.ph,
        ok: begin.ok === true && manual.rg.ph === PHASE_CODE.open && begin.n === begin.openN + 1 && begin.n === started.n }
    : { mode: 'waited-outside', seconds: waitSeconds, need: minWait - FRAME, rows: waitRows.length, insideRows: waitRows.filter(r => inRoom(setup, r.x, r.z)).length,
        notOpenRows: waitRows.filter(r => r.rg?.ph !== PHASE_CODE.open).length, startN: begin.n ?? null, markN: started.n, waitEndN: waitEnd.n,
        ok: begin.ok === true && waitSeconds + EPS >= minWait - FRAME && waitRows.every(r => !inRoom(setup, r.x, r.z) && r.rg?.ph === PHASE_CODE.open) && begin.n > waitEnd.n && begin.n === started.n };
  const start = { ...wait, limit: started.rg.lim, left: started.rg.lf, begin, open: open.ok };
  start.ok = wait.ok && open.ok === true && started.rg.ph === PHASE_CODE.running && started.rg.lim === c.limit;
  // 파편 피격
  const s0 = started.rg.sh, h1 = m.sh1, e1 = m['sh1-end'], h2 = m.sh2, e2 = m['sh2-end'];
  const coreBurstRows = (from, to) => stepRows(rows.slice(at(from), at(to) + 1)).filter(r => live(r) && r.rg.sd.s === SHARD_CODE.burst && dist(r, center) <= c.core + CORE_OUTER_SLACK).length;
  const facts = { base: s0, hit1: h1.rg.sh, hit1End: e1.rg.sh, hit2: h2.rg.sh, hit2End: e2.rg.sh, cycle1: h1.rg.sd.c, cycle1End: e1.rg.sd.c, cycle2: h2.rg.sd.c, cycle2End: e2.rg.sd.c,
    coreBurstRows1: coreBurstRows('sh1', 'sh1-end'), coreBurstRows2: coreBurstRows('sh2', 'sh2-end'), distance1: dist(h1, center), distance2: dist(h2, center) };
  const factsOk = h1.rg.sh === s0 + 1 && e1.rg.sh === s0 + 1 && facts.cycle1 === facts.cycle1End && h2.rg.sh === s0 + 2 && e2.rg.sh === s0 + 2
    && facts.cycle2 === facts.cycle1 + 1 && facts.cycle2 === facts.cycle2End && facts.coreBurstRows1 >= 2 && facts.coreBurstRows2 >= 2
    && facts.distance1 <= c.core + CORE_OUTER_SLACK && facts.distance2 <= c.core + CORE_OUTER_SLACK;
  const hitsAll = checkShardHits(window, def, setup, { strict: true, strictMissed: true });
  const hits = { ...facts, marksOk: factsOk, all: hitsAll, ok: factsOk && hitsAll.ok && hitsAll.multiRow >= 2 && hitsAll.total === 2 };
  // 성표 정화
  const marksAll = checkMarks(window, def, setup), pu = m.pu1;
  const purify = { purified: pu.rg.pu, collapses: pu.rg.co, marks: marksAll, firstMark: marksAll.events[0]?.mark ?? null,
    ok: pu.rg.pu === 1 && pu.rg.co === 0 && marksAll.ok && marksAll.count === 1 && pu.rg.m.filter(x => x.d === 1).length === 1 };
  // 붕괴
  const col = m.collapse, collapsesAll = checkCollapses(window, def, { strict: true });
  const marksPos = rs?.marks ?? [];
  const outside = { core: dist(col, center), nearestMark: marksPos.length ? Math.min(...marksPos.map(p => dist(col, p))) : null,
    ok: dist(col, center) > c.core && marksPos.length > 0 && marksPos.every(p => dist(col, p) > c.markRadius) };
  const collapse = { collapses: col.rg.co, purified: col.rg.pu, doneMarks: col.rg.m.filter(x => x.d === 1).length, left: col.rg.lf, limit: col.rg.lim, outside, all: collapsesAll,
    ok: col.rg.co === 1 && col.rg.pu === 0 && col.rg.m.every(x => x.d === 0) && Math.abs(col.rg.lf - c.limit) <= FRAME + EPS && col.rg.lim === c.limit && outside.ok
      && collapsesAll.ok && collapsesAll.total === 1 && m['rg-auto'].rg.co === 1 };
  // 완료(AUTO 가 이어받아 4/4)
  const done = checkRingDone(rows, def), seal = checkSeal(rows, def), last = rows.at(-1);
  const final = { purified: last?.rg?.pu ?? null, collapses: last?.rg?.co ?? null, sealed: last?.sl ?? null, done: done.ok === true, seal: seal.ok === true,
    ok: done.ok === true && seal.ok === true && last?.rg?.pu === c.marks.length && last?.rg?.co === 1 && last?.sl === 0 };
  return { ok: orderedMarks && keyboard.ok && start.ok && hits.ok && purify.ok && collapse.ok && final.ok, orderedMarks, keyboard, start, hits, purify, collapse, final, done, seal, rows: window.length };
}


/** 관측이 깨진 입력(null 칸 등)에도 예외 없이 실패로 끝나도록 감싼다. */
const failSafe = (fn, fallback) => (...args) => { try { return fn(...args); } catch (error) { return { ...fallback, ok: false, reason: 'exception', error: String(error?.message ?? error) }; } };
export const analyzeChoice = failSafe(analyzeChoiceRaw, { keyboard: { ok: false }, wrong: { ok: false }, retry: { ok: false }, correct: { ok: false }, start: { ok: false }, read: { ok: false }, hurts: { ok: false } });
export const analyzeRingManual = failSafe(analyzeRingManualRaw, { keyboard: { ok: false }, start: { ok: false }, hits: { ok: false }, purify: { ok: false }, collapse: { ok: false }, final: { ok: false } });

// ---------- screens 프로필 ----------
/** 순간 이름(게임 흐름과 무관한 관측 상태): 단서 읽기(read) · 판 선택(select) · 고리 열림(ringOpen) · 집결 예고(warning) · 집결 터짐(burst). */
export const MOMENTS = Object.freeze(['read', 'select', 'ringOpen', 'warning', 'burst']);
/** 모든 순간에 도달했고 순간마다 viewport 개수만큼 PNG 와 route 상태 JSON 이 있는지. */
export function checkScreens(shots, labels, viewportCount) {
  const rows = labels.map(label => {
    const shot = (shots || []).find(s => s.label === label);
    const files = shot?.files?.length ?? 0, states = shot?.stateFiles?.length ?? 0;
    return { label, reached: !!shot?.reached, files, stateFiles: states, ok: !!shot?.reached && files === viewportCount && states === viewportCount };
  });
  return { ok: rows.length > 0 && rows.every(r => r.ok), rows };
}
/**
 * screens 순간의 route 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze)이고, 관측 필드(읽기 · 유지 · 단계 · 선택 · 오답 수 · 성좌 칸 · 고리 칸)에 누락이 있으면 실패한다.
 * read · select 는 route.phase 로 고른다(read: 단계 read 이고 읽기 시간이 흐르는 중·모래시계 사용 가능, select: 단계 select 이고 단서가 드러남). ringOpen: 고리 phase open.
 * warning · burst: 고리 open|running 이고 영웅이 고리 방 사각형 안, 집결 상태가 그 이름. 상태 JSON 에는 이 행 전체를 쓰므로 PNG 와 맞춰 볼 수 있다.
 */
export function checkScreenMoment(shot, def, label, setup) {
  const row = shot?.capture ?? null;
  if (!row) return { ok: false, label, state: false, observed: false };
  const observed = checkObservation([row], def).ok;
  let state = false;
  const g = row.g?.[row.pr];
  if (label === 'read') state = row.ph === GATE_PHASE_CODE.read && row.rs > 0 && g?.rdy === 1 && g?.av === 1;
  else if (label === 'select') state = row.ph === GATE_PHASE_CODE.select && row.rv === 1 && row.rs + EPS >= def.readSeconds && g?.av === 1;
  else if (label === 'ringOpen') state = row.rg?.ph === PHASE_CODE.open;
  else if (label === 'warning' || label === 'burst') state = live(row) && !!setup && inRoom(setup, row.x, row.z) && row.rg.sd.s === SHARD_CODE[label];
  return { ok: observed && state, label, state, observed, phase: GATE_PHASE_NAMES[row.ph] ?? null, progress: row.pr, read: row.rs, hold: row.hd, mistakes: row.mi,
    ring: row.rg ? PHASE_NAMES[row.rg.ph] ?? null : null, shard: row.rg ? SHARD_NAMES[row.rg.sd?.s] ?? null : null };
}

// ---------- 기준선 비교 ----------
/** 방 첫 진입 draw call 표본({ label: 'roomEnter', roomId, calls })을 방별로 짝지어 후보 − 기준선을 낸다. 보고 항목이며 게이트가 아니다. */
export function roomDrawCalls(candSamples, baseSamples, rooms) {
  const pick = (samples, id) => (samples || []).find(s => s.label === 'roomEnter' && s.roomId === id) ?? null;
  const pairs = (rooms || []).map(id => {
    const c = pick(candSamples, id), b = pick(baseSamples, id);
    const matched = !!c && !!b && Number.isFinite(c.calls) && Number.isFinite(b.calls);
    return { room: id, cand: c?.calls ?? null, base: b?.calls ?? null, increase: matched ? c.calls - b.calls : null, matched };
  });
  const matchedPairs = pairs.filter(p => p.matched);
  return { pairs, matched: matchedPairs.length, maxIncrease: matchedPairs.length ? Math.max(...matchedPairs.map(p => p.increase)) : null };
}
/**
 * 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. 두 report 의 depth 가 같아야 한다(depth 에 맞는 계약으로 본다).
 * 기준선에는 고리가 없어야 한다: 심층 기준선(a737875)은 경로 정의(astral_deep) 자체가 없고, 일반판 기준선(099eb32)은 조율판 정의는 있지만 ring 이 없다.
 * 후보에는 그 depth 의 정의(id 가 계약과 같음)와 ring 이 있어야 한다.
 * 두 report 의 HEAD 는 달라야 한다(같은 빌드끼리의 비교는 합격하지 않는다). 후보는 성좌·고리 판정(deepOk)까지 통과해야 한다.
 */
export function compareTargetsOk(cand, base) {
  if (!cand || !base) return false;
  const contract = CONTRACTS[cand.depth] ?? null;
  if (!contract || cand.depth !== base.depth) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const definition = cand.routeDefinition?.id === contract.gates.id && !!cand.routeDefinition?.ring && !base.routeDefinition?.ring
    && (!base.routeDefinition || base.routeDefinition.id === contract.gates.id);
  return differs && definition && cand.deepOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/** 두 report 의 실행 설정이 같은지: 영웅 · 시드 · depth · 재시드 · viewport · motion · quality 가 같아야 비교가 성립한다(없는 값은 같지 않다고 본다). */
export function compareSetup(cand, base) {
  const eq = key => cand?.[key] != null && JSON.stringify(cand[key]) === JSON.stringify(base?.[key]);
  const sameSetup = { hero: eq('heroId'), seed: eq('seed'), depth: eq('depth'), reseed: eq('reseedOn'), viewport: eq('viewport'), motion: eq('motion'), quality: eq('quality') };
  return { same: sameSetup, ok: Object.values(sameSetup).every(Boolean) };
}
/** 1000 스텝당 50ms 초과 수(보고 항목). 스텝 수가 없거나 0 이면 null. */
export const overPer1000 = (over, steps) => (Number.isFinite(over) && Number.isFinite(steps) && steps > 0 ? over / steps * 1000 : null);
/** 어느 쪽이 먼저 돌았는지(보고 항목). started 는 report.started(ISO). */
export function runOrder(candStarted, baseStarted) {
  const c = Date.parse(candStarted), b = Date.parse(baseStarted);
  return Number.isFinite(c) && Number.isFinite(b) ? (c < b ? 'cand-first' : b < c ? 'base-first' : 'same-time') : 'unknown';
}
/**
 * PLAN 5절 5 기준선 비교(한 짝). cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), deepRooms(cand), load, started }.
 * 사전 선언된 게이트: 완주 시간 비 ≤ timeRatio, 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra.
 * 보고 항목(게이트 아님): 성좌·고리 방 첫 진입 draw call 증가, 50ms 초과율, 실행 전후 1분 load, 실행 순서.
 */
export function compareRuns(cand, base, { timeRatio = 2, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio };
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  const gates = { time: time.ok, slow: slow.ok };
  const report = {
    note: '보고 항목(게이트 아님, PLAN 5절 5 사전 선언): 성좌·고리 방 첫 진입 draw call 증가 · 50ms 초과율 · 실행 전후 load · 실행 순서',
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.deepRooms),
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    load: { cand: cand?.load ?? null, base: base?.load ?? null },
    order: runOrder(cand?.started, base?.started),
  };
  return { ok: Object.values(gates).every(Boolean), gates, time, slow, report };
}
