// 녹청 성역 심층(verdigris_sanctum deep) 생명 제단 4곳·점등 이동·포자 수로 돌파 QA 판정 함수 (BUNDLE-11 qa lane). 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/verdigris-deep-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.verdigris_deep)다.
// 시간·반경·개수·방 번호는 정의(def)와 인자(opts, setup)에서 받는다. 문구·색·숫자 계약은 BUNDLE-11 PLAN 3.0·3.1 의 값을 ALTAR/CHANNEL/COPY 상수로 적는다
// (정의가 그 계약과 같은지는 checkDefinition 이 따로 본다). 읽기 계약은 app.battle.routeObjectives 의 lit · litMoves · litT · progress · gates · channel · finish 보고뿐이다.
//
// 관측 행(상태가 바뀐 스텝, 유지(hd > 0)·제단 중심 근처(wrong 후보) 스텝, 수로가 open|running 인 모든 스텝, 1초 간격 스텝, 표식 스텝만 남긴다. 판정에 필요한 연속 구간은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, hd route.hold,
//   sl world.sealed(1/0), rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state, pz 스텝 끝에 전투가 일시정지(1, 없으면 생략),
//   bu route.bursts, lt route.lit 의 방 id(-1 = null, -2 = lit 속성 없음, -3 = 방 id 없음), lm route.litMoves(-1 = 읽지 못함), lT route.litT(-1 = 읽지 못함),
//   g: 제단마다 { id 방 id, rd gate.ready, at gate.attuned, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수 }(전부 숫자),
//   ch: route.channel 관측 { ph(0 idle · 1 open · 2 running · 3 done · 9 알 수 없음), rid 수로 방 id, ck clock, lf left, lim limit, el elapsed, fl floods, sh sporeHits,
//      b: 띠마다 { x 월드 중심, h half, s(0 calm · 1 warning · 2 burst · 9 알 수 없음), a age, c cycle },
//      fd 시작·범람 스텝에서 도구가 world.buildFlow(exit) 로 다시 잰 영웅 칸 거리(음수 = 읽지 못함) } 또는 null(channel 없음),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(같은 상태가 0.6초 이어진 뒤 표본),
//   hr 그 스텝에 player.hurt 가 받은 피해 ÷ 최대 체력 목록(도구의 관측 감싸개, 호출이 없으면 생략)
// 토스트 표본({ n, t, msg, kind })과 수로 setup({ roomId, roomX, roomZ, minX, maxX, minZ, maxZ, startX, finishX, entry{x,z}, exit{x,z} })은 행과 따로 남긴다.

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/** 위치 경계 판정의 부동소수 여유. 규칙은 같은 스텝의 영웅 위치로 판정하므로 넓은 여유가 필요 없다. */
export const POSITION_SLACK = .01;
/** 띠 피격 위치 여유: 피격 스텝 끝의 위치는 넉백이 시작된 뒤라 띠 경계에서 조금 벗어날 수 있다. 반대로 분출 중 띠 '깊숙이'(경계 − 이 값) 있으면 반드시 피격이어야 한다. */
const BAND_OUTER_SLACK = .6;
const BAND_INNER_MARGIN = .3;
const SETTLE_STEPS = 10;
const CARRY_MAX_STEPS = 90;
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 띠 경계(상태가 바뀌는 시각)에서 부동소수 때문에 상태를 가를 수 없는 범위. */
const BOUNDARY = 1e-6;

/** 피해 판정(BUNDLE-11 smoke 수리). 규칙은 최대 체력 × 정의 값(damage)을 player.hurt 에 넘기고, 실제 체력 감소는 영웅 방어로 줄어든다
 * (smoke-cand-order-1·channel-1: 기사 체력 감소 비 .038 = .08 × .476, .0286 = .06 × .476). 정상 경로는 하나만 면제한다:
 * 그 스텝 행의 hr(도구가 감싼 player.hurt 가 받은 피해 ÷ 최대 체력 목록)에 정의 값과 1e-6 안으로 같은 값이 있고, 실제 감소 비가 0 보다 크고 정의 값 이하다.
 * hr 이 없거나(관측 누락), 넘긴 값이 다르거나, 감소가 0(무적 등) 이거나 정의 값을 넘으면(같은 스텝의 다른 피해) 실패다. */
export function damageMatches(row, ratio, want) {
  const raw = Array.isArray(row?.hr) ? row.hr : null;
  return !!raw && raw.some(x => Number.isFinite(x) && Math.abs(x - want) <= 1e-6) &&
    ratio !== null && Number.isFinite(ratio) && ratio > 0 && ratio <= want + 1e-6;
}

export const PHASE_NAMES = Object.freeze(['idle', 'open', 'running', 'done']);
export const PHASE_CODE = Object.freeze(Object.fromEntries(PHASE_NAMES.map((name, i) => [name, i])));
export const BAND_NAMES = Object.freeze(['calm', 'warning', 'burst']);
export const BAND_CODE = Object.freeze(Object.fromEntries(BAND_NAMES.map((name, i) => [name, i])));

/** PLAN 3.0 공유 정의 계약 값(제단). */
export const ALTAR = Object.freeze({
  id: 'verdigris_root_heart_deep', kind: 'spore-altars', title: '생명 제단 정화', noun: '생명 제단', verb: '정화', holdSeconds: 2, radius: 3, cueColor: 0x72e6ae,
  rooms: Object.freeze([2, 5, 3, 6]), labels: Object.freeze(['뿌리 샘 제단', '이끼 못 제단', '덩굴 회랑 제단', '포자 정원 제단']),
  wrongStep: Object.freeze({ seconds: 1, damage: .08, cooldown: 2, color: 0xb06cff }),
});
/** PLAN 3.0 공유 정의 계약 값(포자 수로). */
export const CHANNEL = Object.freeze({
  roomId: 7, label: '포자 수로', startLine: -7.5, finishLine: 7.5, entry: Object.freeze([-9, 0]), exit: Object.freeze([9, 0]),
  bands: Object.freeze([-5.4, -1.8, 1.8, 5.4]), bandHalf: 1.1, first: 1, period: 4, lag: .8, warning: 1, burst: .7, damage: .06,
  pace: 3, grace: 6, floodDamage: .06, color: 0x9be86a,
});
/** 목표창·토스트·결과 문구(PLAN 2절 6, 3.1, 3.2). 판정 함수의 상수는 테스트가 따로 적은 문장과 맞춰 본다. */
export const COPY = Object.freeze({
  altarTitle: '생명 제단 정화', find: '다음 구역을 찾아 이동', fight: '뿌리 빛 제단 · 이 구역의 적 처치', hold: '뿌리 빛 제단 중심에서 2초 유지',
  remain: '남은 구역 정화', channelTitle: '포자 수로 돌파', channelOpen: '서쪽 수로 입구로 이동', channelRun: '포자 물결이 지나간 뒤 동쪽 출구로 · ',
  open: '포자 수로 개방 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로', hit: '포자 물결 피격 · 물결이 지나간 뒤 건너기', done: '포자 수로 돌파 · 녹청 거수의 봉인이 풀립니다',
  lastMove: '모든 구역을 정화하면 포자 수로가 열립니다',
});
/** 이 심층에서 나오면 안 되는 이전(보물방 공명)·일반판(번호) 문구. */
export const LEAK_WORDS = Object.freeze(['공명']);
const NUMBERED = /[1-4]번 생명 제단/;
const leaks = text => typeof text === 'string' && (LEAK_WORDS.some(word => text.includes(word)) || NUMBERED.test(text));

export const startToast = limit => '포자 수로 돌파 시작 · ' + limit + '초';
export const floodToast = limit => '포자 수로 범람 · 다시 ' + limit + '초';
/** 정화 토스트: '<이름> 정화 · n/4 · 뿌리 빛이 <다음 이름>으로 옮겨 갑니다', 마지막은 '… 4/4 · 모든 구역을 정화하면 포자 수로가 열립니다'. */
export const purifyToast = (def, i) => def.gates[i].label + ' 정화 · ' + (i + 1) + '/' + def.gates.length + ' · '
  + (i + 1 < def.gates.length ? '뿌리 빛이 ' + def.gates[i + 1].label + '으로 옮겨 갑니다' : COPY.lastMove);
/** 결과 화면 줄: '생명 제단 정화 4/4 · 완료'(기존 일반 줄)와 '포자 수로 돌파 완료 · 포자 피격 n회 · 범람 n회'. */
export const altarResultLine = def => ALTAR.title + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';
export const channelResultLine = ch => '포자 수로 돌파 ' + (ch?.crossed ? '완료' : '미완료') + ' · 포자 피격 ' + ch?.sporeHits + '회 · 범람 ' + ch?.floods + '회';

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
export function stepStats(values, limit = 50) {
  const n = values.length;
  return { n, p50: percentile(values, .5), p95: percentile(values, .95), max: n ? Math.max(...values) : null, over: values.filter(v => v > limit).length };
}

const roomById = (rooms, id) => (rooms || []).find(room => room.id === id) ?? null;
/** 같은 스텝 번호의 중복 행(표식 행)을 뺀 스텝 행. */
const stepRows = rows => { const seen = new Set(); return rows.filter(r => (seen.has(r.n) ? false : (seen.add(r.n), true))); };
const isInt = v => Number.isInteger(v);
const finite = v => Number.isFinite(v);

/** 영웅이 수로 방 사각형 안(경계 포함)인지. */
export const inRoom = (setup, x, z) => !!setup && finite(x) && finite(z) && x >= setup.minX - POSITION_SLACK && x <= setup.maxX + POSITION_SLACK
  && z >= setup.minZ - POSITION_SLACK && z <= setup.maxZ + POSITION_SLACK;
/** 돌파 시작 조건: 방 안이고 출발선 서쪽(x ≤ startX). */
export const inStartZone = (setup, x, z) => inRoom(setup, x, z) && x <= setup.startX + POSITION_SLACK;
/** 제한 시간: ceil(도착 지점까지 거리장 칸 수 / pace + grace). */
export const limitOf = (channel, dist) => Math.ceil(dist / channel.pace + channel.grace);

/** 대상 프로젝트의 정의(ROUTE_OBJECTIVES.verdigris_deep)가 PLAN 3.0 계약과 같은지. 어긋난 항목을 issues 로 돌려준다. */
export function checkDefinition(def) {
  if (!def) return { ok: false, issues: [{ field: 'definition', got: null }] };
  const issues = [];
  const want = (field, got, expected) => { if (JSON.stringify(got) !== JSON.stringify(expected)) issues.push({ field, got, want: expected }); };
  want('id', def.id, ALTAR.id); want('kind', def.kind, ALTAR.kind); want('holdSeconds', def.holdSeconds, ALTAR.holdSeconds); want('radius', def.radius, ALTAR.radius);
  want('noun', def.noun, ALTAR.noun); want('verb', def.verb, ALTAR.verb); want('cueColor', def.cueColor, ALTAR.cueColor); want('hiddenOrder', def.hiddenOrder, true);
  want('wrongStep', def.wrongStep, ALTAR.wrongStep);
  want('rooms', (def.gates || []).map(g => g.roomId), [...ALTAR.rooms]); want('labels', (def.gates || []).map(g => g.label), [...ALTAR.labels]);
  want('channel', def.channel, CHANNEL);
  return { ok: issues.length === 0, issues };
}
/** 수로 setup 이 정의와 맞는지(도구가 브라우저에서 읽은 값): 수로 방 id·출발/도착선·입구/출구가 방 중심 + 정의 오프셋이고 띠가 방 사각형 안이다. */
export function checkChannelSetup(setup, def) {
  const c = def?.channel;
  if (!setup || !c) return { ok: false, reason: 'missing' };
  const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-6;
  const rect = [setup.minX, setup.maxX, setup.minZ, setup.maxZ].every(finite) && setup.minX < setup.maxX && setup.minZ < setup.maxZ;
  const checks = {
    room: setup.roomId === c.roomId, rect, center: rect && setup.minX < setup.roomX && setup.roomX < setup.maxX && setup.minZ < setup.roomZ && setup.roomZ < setup.maxZ,
    startX: near(setup.startX, setup.roomX + c.startLine), finishX: near(setup.finishX, setup.roomX + c.finishLine),
    entry: near(setup.entry?.x, setup.roomX + c.entry[0]) && near(setup.entry?.z, setup.roomZ + c.entry[1]),
    exit: near(setup.exit?.x, setup.roomX + c.exit[0]) && near(setup.exit?.z, setup.roomZ + c.exit[1]),
    bandsInside: rect && c.bands.every(x => setup.roomX + x - c.bandHalf >= setup.minX && setup.roomX + x + c.bandHalf <= setup.maxX),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

/**
 * 관측 완전성. 모든 행에서 lit(-1 이상)·litMoves(≥ 0)·litT(≥ 0)·bursts(≥ 0)·제단 칸이 읽혀야 하고, channel 이 있는 정의에서는 모든 행의 ch(띠 개수만큼 b, 상태 코드 0~2)가 읽혀야 한다
 * (수로 숫자는 단계에 맞게: clock 은 열린 뒤, left · limit · elapsed 는 돌파 시작 뒤, 띠의 age · cycle 은 열린 동안).
 * -1(읽지 못함)·null·undefined 는 통과가 아니라 실패다(BUNDLE-10 리뷰 P3-5).
 */
export function checkObservation(rows, def) {
  const bad = [];
  const gateCount = def.gates.length, bandCount = def.channel?.bands?.length ?? 0;
  for (const r of rows) {
    const miss = [];
    if (!(isInt(r.lt) && r.lt >= -1)) miss.push('lt');
    if (!(isInt(r.lm) && r.lm >= 0)) miss.push('lm');
    if (!(finite(r.lT) && r.lT >= 0)) miss.push('lT');
    if (!(isInt(r.bu) && r.bu >= 0)) miss.push('bu');
    if (!Array.isArray(r.g) || r.g.length !== gateCount || r.g.some(g => !g || ['id', 'rd', 'at', 'cl', 'dc', 'al', 'pd'].some(k => !finite(g[k])))) miss.push('g');
    if (bandCount > 0) {
      const ch = r.ch;
      // 수로 숫자: 카운터와 방은 항상, clock 은 열린 뒤, left · limit · elapsed 는 돌파 시작 뒤에 읽혀야 한다(idle 의 초기값은 규칙에 맡긴다).
      if (!ch || ![ch.fl, ch.sh, ch.rid].every(finite) || !(ch.ph >= 0 && ch.ph <= 3)) miss.push('ch');
      else {
        if (ch.ph >= PHASE_CODE.open && !finite(ch.ck)) miss.push('ch.ck');
        if (ch.ph >= PHASE_CODE.running && ![ch.lf, ch.lim, ch.el].every(finite)) miss.push('ch.run');
        const strictBands = ch.ph === PHASE_CODE.open || ch.ph === PHASE_CODE.running;
        if (!Array.isArray(ch.b) || ch.b.length !== bandCount || ch.b.some(b => !b || !finite(b.x) || !finite(b.h) || !(b.s >= 0 && b.s <= 2))) miss.push('ch.b');
        else if (strictBands && ch.b.some(b => !finite(b.a) || !isInt(b.c))) miss.push('ch.b');
      }
    }
    if (miss.length) bad.push({ n: r.n, miss });
  }
  return { rows: rows.length, badCount: bad.length, bad: bad.slice(0, 6), ok: rows.length > 0 && bad.length === 0 };
}

// ---------- 생명 제단 ----------
/**
 * 유지 구간. hd > 0 이 이어지는 연속 스텝(n 이 1씩 늘고 hd 가 매 스텝 게임 시간만큼 는다)을 한 구간으로 묶는다.
 * fromZero: 구간의 첫 hd 가 한 프레임(0 에서 새로 시작)인지.
 */
export function holdRuns(rows) {
  const runs = [];
  let open = null;
  rows.forEach((row, i) => {
    if (!(row.hd > 0)) { open = null; return; }
    const prev = open ? rows[open.end] : null;
    // 같은 스텝을 한 번 더 기록한 표식 행은 유지 구간을 끊지 않는다.
    if (prev && row.n === prev.n && row.hd === prev.hd) { open.end = i; return; }
    const continues = !!prev && row.n === prev.n + 1 && row.hd > prev.hd && Math.abs((row.hd - prev.hd) - (row.t - prev.t)) <= EPS;
    if (continues) { open.end = i; open.max = row.hd; return; }
    open = { start: i, end: i, max: row.hd, fromZero: Math.abs(row.hd - FRAME) <= EPS };
    runs.push(open);
  });
  return runs;
}
export const runSpan = (rows, run) => rows[run.end].t - rows[run.start].t + FRAME;

/**
 * 정화 이벤트 판정. 정화 = route.progress 가 늘어난 스텝.
 * (a) 정화한 제단의 방 id 가 정의 순서와 같음, (b) 직전 연속 유지 구간이 0 에서 새로 시작하고 엔진의 hold 와 게임 시각 길이 모두 holdSeconds − 1/60 이상,
 * (b2) 그 구간 내내 영웅이 그 방 중심 반경(def.radius) 안, (c) 그 구간 내내 그 제단이 점등(lit)이고 ready, (d) 그 방의 살아 있는 적·대기열 0,
 * 그 밖에 정화 스텝에서 그 제단이 attuned 이고 방이 cleared(같은 행), 앞 제단은 모두 attuned·뒤 제단은 모두 아직 아님, 정화 전에는 그 방이 cleared 가 아님.
 */
export function checkAltars(rows, def, { rooms = [] } = {}) {
  const runs = holdRuns(rows), n = def.gates.length, purifies = [], violations = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i], prev = rows[i - 1];
    if (!(cur.pr > prev.pr)) continue;
    const index = prev.pr, gate = cur.g?.[index], want = def.gates[index];
    const room = roomById(rooms, gate?.id);
    const run = runs.find(r => r.end === i - 1 && cur.n === prev.n + 1) ?? null;
    const runRows = run ? rows.slice(run.start, run.end + 1) : [];
    const seconds = run ? rows[run.end].hd : null, span = run ? runSpan(rows, run) : null;
    const farthest = runRows.length && room ? Math.max(...runRows.map(r => Math.hypot(r.x - room.x, r.z - room.z))) : null;
    const rec = {
      row: i, n: cur.n, t: cur.t, index, roomId: gate?.id ?? null, wantRoomId: want?.roomId ?? null, jump: cur.pr - prev.pr,
      order: cur.pr - prev.pr === 1 && !!want && gate?.id === want.roomId,
      hold: { found: !!run, seconds, span, fromZero: run?.fromZero ?? false, need: def.holdSeconds - FRAME,
        ok: !!run && run.fromZero && seconds + EPS >= def.holdSeconds - FRAME && span + EPS >= def.holdSeconds - FRAME },
      inside: { farthest, limit: def.radius + POSITION_SLACK, ok: !!run && !!room && farthest <= def.radius + POSITION_SLACK },
      lit: { rows: runRows.length, notLit: runRows.filter(r => r.lt !== want?.roomId).length, ok: runRows.length > 0 && runRows.every(r => r.lt === want?.roomId && r.g?.[index]?.rd === 1) },
      enemies: { sealAlive: gate?.al ?? null, sealPending: gate?.pd ?? null,
        ok: !!gate && gate.al === 0 && gate.pd === 0 && runRows.length > 0 && runRows.every(r => r.g?.[index]?.al === 0 && r.g?.[index]?.pd === 0) },
      state: { attuned: gate?.at === 1 && gate?.cl === 1,
        earlier: cur.g?.slice(0, index).every(g => g.at === 1) ?? false, later: cur.g?.slice(index + 1).every(g => g.at === 0) ?? false,
        earlyClear: rows.slice(0, i).filter(r => r.g?.[index]?.cl === 1).length },
    };
    rec.state.ok = rec.state.attuned && rec.state.earlier && rec.state.later && rec.state.earlyClear === 0;
    purifies.push(rec);
  }
  const observedOrder = purifies.map(s => s.roomId), wantOrder = def.gates.map(g => g.roomId);
  for (const s of purifies) {
    if (!s.order) violations.push({ kind: 'order', n: s.n, roomId: s.roomId, want: s.wantRoomId, jump: s.jump });
    if (!s.hold.ok) violations.push({ kind: 'hold', n: s.n, roomId: s.roomId, seconds: s.hold.seconds, span: s.hold.span, need: s.hold.need, fromZero: s.hold.fromZero });
    if (!s.inside.ok) violations.push({ kind: 'inside', n: s.n, roomId: s.roomId, farthest: s.inside.farthest, limit: s.inside.limit });
    if (!s.lit.ok) violations.push({ kind: 'not-lit', n: s.n, roomId: s.roomId, ...s.lit });
    if (!s.enemies.ok) violations.push({ kind: 'enemies', n: s.n, roomId: s.roomId, ...s.enemies });
    if (!s.state.ok) violations.push({ kind: 'state', n: s.n, roomId: s.roomId, ...s.state });
  }
  return { purifies, observedOrder, wantOrder, count: purifies.length, target: n, violations,
    ok: {
      count: purifies.length === n && rows.at(-1)?.pr === n,
      order: purifies.length === n && purifies.every(s => s.order) && JSON.stringify(observedOrder) === JSON.stringify(wantOrder),
      hold: purifies.length > 0 && purifies.every(s => s.hold.ok),
      inside: purifies.length > 0 && purifies.every(s => s.inside.ok),
      lit: purifies.length > 0 && purifies.every(s => s.lit.ok),
      enemies: purifies.length > 0 && purifies.every(s => s.enemies.ok),
      state: purifies.length > 0 && purifies.every(s => s.state.ok),
    } };
}

/**
 * 점등 이동. 점등은 한 번에 한 제단: 모든 행에서 progress < n 이면 lit = 지금 차례 제단의 방, 끝나면(progress = n) lit 은 null(-1).
 * litMoves 는 정화 스텝에서만 +1 씩 늘어 progress 와 함께 움직이고(마지막 정화는 옮길 제단이 없어 늘지 않는다 → 끝 값 n − 1), 첫 행은 lit = 첫 제단 · litMoves 0.
 * litT 는 마지막 점등 이동 뒤 게임 시간이라 이동 스텝에서 한 프레임 이하이고 이동 뒤 1초까지는 게임 시간만큼 흐른다(그 뒤에는 1초 이상이면 된다).
 */
export function checkLit(rows, def, { finalMoves = def.gates.length - 1 } = {}) {
  const n = def.gates.length, bad = [];
  const first = rows[0];
  const startOk = !!first && first.lt === def.gates[0].roomId && first.lm === 0;
  let moveT = null, moves = 0, prev = null, litRows = 0, nullRows = 0;
  for (const r of rows) {
    const wantLit = r.pr < n ? def.gates[r.pr]?.roomId : -1;
    if (r.lt !== wantLit) bad.push({ kind: 'lit', n: r.n, pr: r.pr, lt: r.lt, want: wantLit });
    if (r.pr < n) litRows++; else nullRows++;
    const wantMoves = Math.min(r.pr, finalMoves);
    if (r.lm !== wantMoves) bad.push({ kind: 'moves', n: r.n, pr: r.pr, lm: r.lm, want: wantMoves });
    if (prev) {
      if (r.lm < prev.lm) bad.push({ kind: 'moves-back', n: r.n, from: prev.lm, to: r.lm });
      if (r.lm !== prev.lm) {
        moves += r.lm - prev.lm;
        // 점등은 정화 스텝에서만 옮겨 간다(진행이 같은 스텝에 늘었어야 한다).
        if (!(r.pr > prev.pr)) bad.push({ kind: 'moved-without-purify', n: r.n, pr: r.pr });
        if (!(r.lT <= FRAME + EPS)) bad.push({ kind: 'litT-after-move', n: r.n, lT: r.lT });
        moveT = r.t;
      }
    }
    // 이동 직후 1초(연출 구간)는 게임 시간과 같이 흘러야 하고, 그 뒤에는 줄어들지 않고 1초 이상이면 된다(규칙이 값을 어디서 멈춰도 통과).
    if (moveT !== null && r.lm > 0) {
      const since = r.t - moveT;
      if (since <= 1 ? Math.abs(r.lT - since) > 2 * FRAME + EPS : r.lT + 2 * FRAME + EPS < 1) bad.push({ kind: 'litT-clock', n: r.n, lT: r.lT, expected: since });
    }
    prev = r;
  }
  const last = rows.at(-1);
  return { startOk, moves, finalMoves: last?.lm ?? null, litRows, nullRows, bad: bad.slice(0, 8), badCount: bad.length,
    ok: startOk && bad.length === 0 && last?.pr === n && last?.lm === finalMoves && last?.lt === -1 && moves === finalMoves };
}

/**
 * 비점등 제단 방. 제단 방의 cleared 는 그 제단이 attuned 가 된 뒤에만(매 관측 행) 참이고, attuned 는 그 제단 차례(progress > index)인 뒤에만 참이다.
 * 정화 스텝에는 같은 행에서 attuned 와 cleared 가 함께 바뀐다(markCleared 가 같은 스텝에 일어남). 먼저 정리돼도(rd = 1, 적 0) 차례 전에는 어느 것도 참이 아니다.
 * observed: 차례가 아닌 제단이 준비된(적 0) 채 정화 전인 표본이 있었는지(AUTO 경로에 따라 없을 수 있어 보고하고, required 면 관측을 요구한다).
 */
export function checkUnlit(rows, def, { required = false } = {}) {
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
    if (j > r.pr && g.rd === 1 && g.al === 0 && g.pd === 0 && g.at === 0) early.push({ n: r.n, gate: j });
  });
  const gates = [...new Set(early.map(e => e.gate))];
  return { required, observed: early.length > 0, rows: early.length, gates, bad: bad.slice(0, 8), badCount: bad.length, ok: bad.length === 0 && (!required || early.length > 0) };
}

/**
 * 준비 시점. 제단마다 처음 ready 가 된 행에서 방이 발견돼 있고 그 방의 적·대기열이 0 이다. ready 이전에는 그 제단 차례의 유지가 0 이다.
 */
export function checkReadyTiming(rows, def, { rooms = [] } = {}) {
  const gates = def.gates.map((gate, i) => {
    const at = rows.findIndex(r => r.g?.[i]?.rd === 1);
    const row = at >= 0 ? rows[at] : null, g = row?.g?.[i];
    const early = rows.slice(0, at < 0 ? rows.length : at).filter(r => r.pr === i && r.hd > 0).length;
    const ok = !!g && g.dc === 1 && g.al === 0 && g.pd === 0 && early === 0;
    return { index: i, roomId: gate.roomId, type: roomById(rooms, gate.roomId)?.type ?? null, n: row?.n ?? null, discovered: g?.dc ?? null, alive: g?.al ?? null,
      pending: g?.pd ?? null, holdBeforeReady: early, ok };
  });
  return { gates, ok: gates.every(g => g.ok) };
}

/**
 * 포자 폭발(route.bursts). 늘어난 행은 (a) 한 번에 +1, (b) 그 직전 스텝 행이 바로 앞 스텝(밀집 관측), (c) 차례가 아닌 제단(index > progress, ready, 아직 정화 전)의 중심 반경 안,
 * (d) 같은 제단 반경 안에 ready 인 채 연속으로 wrongStep.seconds − 1/60 이상 머묾, (e) 진행·정화 불변, (f) 앞 폭발과 cooldown + seconds − 1/60 이상 떨어짐.
 * strict 면 직전 스텝보다 HP 가 최대 체력의 wrongStep.damage ± .01 줄어야 한다(교전이 없는 수동 구간). 비율은 항상 기록한다.
 */
export function checkWrongStep(rows, def, { rooms = [], strict = false, after = null } = {}) {
  const ws = def.wrongStep, sr = stepRows(rows), bursts = [], bad = [];
  let lastT = null;
  for (let i = 1; i < sr.length; i++) {
    const cur = sr[i], p = sr[i - 1];
    if (!(cur.bu > p.bu)) continue;
    // after 를 주면 그 스텝 이후의 폭발만 판정한다(앞 구간은 머문 시간을 거슬러 읽는 데만 쓴다).
    if (after !== null && cur.n <= after) { lastT = cur.t; continue; }
    const dense = p.n === cur.n - 1;
    const gates = def.gates.map((_, j) => j).filter(j => {
      const room = roomById(rooms, cur.g?.[j]?.id);
      return j > p.pr && p.g?.[j]?.rd === 1 && p.g?.[j]?.at === 0 && !!room && Math.hypot(cur.x - room.x, cur.z - room.z) <= def.radius + POSITION_SLACK;
    });
    const j = gates[0] ?? null, room = j === null ? null : roomById(rooms, cur.g[j].id);
    let dwellStart = i;
    while (j !== null && dwellStart > 0 && sr[dwellStart - 1].n === sr[dwellStart].n - 1 && sr[dwellStart - 1].g?.[j]?.rd === 1 && sr[dwellStart - 1].g?.[j]?.at === 0
      && Math.hypot(sr[dwellStart - 1].x - room.x, sr[dwellStart - 1].z - room.z) <= def.radius + POSITION_SLACK) dwellStart--;
    const dwell = j === null ? 0 : cur.t - sr[dwellStart].t + FRAME;
    const ratio = dense && cur.mhp > 0 ? (p.hp - cur.hp) / cur.mhp : null;
    const rec = { n: cur.n, t: cur.t, gate: j, jump: cur.bu - p.bu, dense, dwell, ratio, raw: cur.hr ?? null, progressSame: cur.pr === p.pr, gap: lastT === null ? null : cur.t - lastT };
    bursts.push(rec);
    if (rec.jump !== 1) bad.push({ kind: 'jump', n: cur.n, jump: rec.jump });
    if (!dense) bad.push({ kind: 'sparse', n: cur.n });
    if (j === null) bad.push({ kind: 'no-source', n: cur.n, hero: [cur.x, cur.z] });
    if (j !== null && dwell + EPS < ws.seconds) bad.push({ kind: 'dwell', n: cur.n, dwell, need: ws.seconds });
    if (!rec.progressSame) bad.push({ kind: 'progress-changed', n: cur.n });
    if (lastT !== null && cur.t - lastT + FRAME + EPS < ws.cooldown + ws.seconds) bad.push({ kind: 'cooldown', n: cur.n, gap: cur.t - lastT, need: ws.cooldown + ws.seconds - FRAME });
    if (strict && !damageMatches(cur, ratio, ws.damage)) bad.push({ kind: 'damage', n: cur.n, ratio, raw: cur.hr ?? null, want: ws.damage });
    lastT = cur.t;
  }
  // 판정 대상 구간의 bursts 증가량(앞 구간 제외)이 판정한 폭발 수와 같아야 한다.
  const base = after === null ? (sr[0]?.bu ?? 0) : (sr.filter(r => r.n <= after).at(-1)?.bu ?? (sr[0]?.bu ?? 0));
  const total = (sr.at(-1)?.bu ?? 0) - base, sum = bursts.reduce((a, b) => a + b.jump, 0);
  return { count: bursts.length, final: sr.at(-1)?.bu ?? null, bursts, bad: bad.slice(0, 8), badCount: bad.length, strict, ok: bad.length === 0 && total === sum };
}

// ---------- 포자 수로 ----------
const live = r => !!r.ch && (r.ch.ph === PHASE_CODE.open || r.ch.ph === PHASE_CODE.running);
const near = (a, b, tol = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tol;

/**
 * 띠 한 줄의 기대 상태(PLAN 3.1): u = clock − first − i·lag; u < 0 이면 calm·cycle −1, 아니면 m = u mod period;
 * m < warning 이면 warning, m < warning + burst 이면 burst, 그 밖 calm. cycle = floor(u / period), age = 그 상태 안에서 지난 초(calm 은 분출이 끝난 뒤부터).
 * edge: 경계(상태가 바뀌는 시각)에서 부동소수 때문에 상태를 가를 수 없는 값.
 */
export function bandExpect(channel, i, clock) {
  const u = clock - channel.first - i * channel.lag;
  if (u < 0) return { state: BAND_CODE.calm, cycle: -1, age: null, edge: Math.abs(u) <= BOUNDARY };
  const cycle = Math.floor(u / channel.period), m = u - cycle * channel.period;
  const w = channel.warning, b = channel.burst;
  const edge = Math.abs(u) <= BOUNDARY || [0, w, w + b, channel.period].some(x => Math.abs(m - x) <= BOUNDARY);
  if (m < w) return { state: BAND_CODE.warning, cycle, age: m, edge };
  if (m < w + b) return { state: BAND_CODE.burst, cycle, age: m - w, edge };
  return { state: BAND_CODE.calm, cycle, age: m - w - b, edge };
}

/**
 * 수로 열림. 처음 idle 이 아니게 된 행은 open 이고(앞 행은 모두 idle), 그 행에서 progress = n · 모든 제단 attuned · 시작/보스를 뺀 모든 방 cleared(rem = 0) · lit null · clock 0(열리는 스텝에는 시간이 흐르지 않음),
 * 조건(progress = n 이고 rem = 0)이 처음 관측된 스텝에서 최대 한 스텝 뒤에 열린다(markCleared 직후가 아니라 다음 update). 열림 뒤 어느 행에서도 조건이 깨지지 않고, phase 는 idle → open → running → done 순서로만 간다.
 */
export function checkChannelOpen(rows, def) {
  const n = def.gates.length, first = rows.findIndex(r => r.ch && r.ch.ph !== PHASE_CODE.idle);
  if (first < 0) return { ok: false, reason: 'never-open' };
  const r = rows[first], before = rows.slice(0, first);
  const notIdle = before.filter(x => x.ch?.ph !== PHASE_CODE.idle).length;
  const condIdx = rows.findIndex(x => x.pr === n && x.rem === 0), lag = condIdx >= 0 ? r.n - rows[condIdx].n : null;
  const early = rows.filter(x => x.ch && x.ch.ph !== PHASE_CODE.idle && (x.pr !== n || x.rem !== 0 || x.g.some(g => g.at !== 1))).map(x => ({ n: x.n, pr: x.pr, rem: x.rem, ph: x.ch.ph }));
  const sequence = [];
  for (const row of stepRows(rows)) if (row.ch && row.ch.ph !== sequence.at(-1)) sequence.push(row.ch.ph);
  const monotone = sequence.every((ph, i) => i === 0 || ph > sequence[i - 1]);
  const rec = { n: r.n, t: r.t, phase: r.ch.ph, progress: r.pr, remaining: r.rem, lit: r.lt, clock: r.ch.ck, lag, earlierRows: before.length, notIdleBefore: notIdle,
    allAttuned: r.g.every(g => g.at === 1), early: early.slice(0, 4), earlyCount: early.length, sequence };
  return { ...rec, ok: before.length > 0 && notIdle === 0 && r.ch.ph === PHASE_CODE.open && r.pr === n && r.rem === 0 && rec.allAttuned && r.lt === -1 && r.ch.ck <= EPS
    && lag !== null && lag >= 0 && lag <= 1 && early.length === 0 && monotone && rows.every(x => !x.ch || x.ch.rid === r.ch.rid) };
}

/**
 * 돌파 시작. running 이 처음 관측된 행: 앞 행은 open(밀집 관측), 영웅은 수로 방 안이고 x ≤ startX, 시작 스텝은 elapsed ≤ 한 프레임 · limit ≥ 1 · left = limit · 범람 0 · 피격 0.
 * 열려 있는 동안(열린 스텝은 제외) 시작 조건을 채운 행이 있으면 시작이 늦은 것이다. waited: 열린 뒤 시작 조건 밖에서 보낸 초(open 행 수).
 */
export function checkChannelStart(rows, def, setup) {
  const idx = rows.findIndex(r => r.ch?.ph === PHASE_CODE.running);
  if (idx < 1) return { ok: false, reason: 'never-running' };
  const r = rows[idx], p = rows[idx - 1], openIdx = rows.findIndex(x => x.ch && x.ch.ph !== PHASE_CODE.idle);
  const late = rows.slice(0, idx).filter((x, k) => k !== openIdx && x.ch?.ph === PHASE_CODE.open && inStartZone(setup, x.x, x.z)).map(x => ({ n: x.n, x: x.x }));
  const waited = openIdx >= 0 ? (r.n - rows[openIdx].n - 1) * FRAME : null;
  const rec = { n: r.n, t: r.t, hero: { x: r.x, z: r.z }, startX: setup?.startX ?? null, inZone: inStartZone(setup, r.x, r.z), previous: p.ch?.ph ?? null, previousStep: p.n === r.n - 1,
    limit: r.ch.lim, left: r.ch.lf, elapsed: r.ch.el, floods: r.ch.fl, sporeHits: r.ch.sh, lateRows: late.slice(0, 4), lateCount: late.length, waited };
  return { ...rec, ok: p.ch?.ph === PHASE_CODE.open && rec.previousStep && rec.inZone && late.length === 0 && r.ch.el <= FRAME + EPS && r.ch.lim >= 1
    && Math.abs(r.ch.lf - r.ch.lim) <= FRAME + EPS && r.ch.fl === 0 && r.ch.sh === 0 };
}

/**
 * 제한 시간 계산. 도구가 거리(fd)를 다시 읽은 모든 running 행(시작 스텝, 범람 스텝)에서 limit 이 ceil(d / pace + grace)이고 left 가 새 limit 으로 돌아와 있다.
 * 시작 스텝 행과 모든 범람 스텝 행이 측정돼 있어야 한다(측정 못 한 범람은 실패).
 */
export function checkChannelLimit(rows, def) {
  const c = def.channel, list = [];
  const sr = stepRows(rows);
  const startIdx = sr.findIndex(r => r.ch?.ph === PHASE_CODE.running);
  const floodRows = sr.filter((r, i) => i > 0 && r.ch && sr[i - 1].ch && r.ch.fl > sr[i - 1].ch.fl);
  for (const r of sr) {
    if (r.ch?.ph !== PHASE_CODE.running || !(r.ch.fd >= 0) || !finite(r.ch.fd)) continue;
    const exact = limitOf(c, r.ch.fd);
    list.push({ n: r.n, hero: { x: r.x, z: r.z }, dist: r.ch.fd, limit: r.ch.lim, left: r.ch.lf, exact, floods: r.ch.fl, ok: r.ch.lim === exact && Math.abs(r.ch.lf - r.ch.lim) <= FRAME + EPS });
  }
  const startMeasured = startIdx >= 0 && list.some(x => x.n === sr[startIdx].n);
  const floodsMeasured = floodRows.every(r => list.some(x => x.n === r.n));
  return { rows: list, startMeasured, floodsMeasured, floods: floodRows.length, ok: startMeasured && floodsMeasured && list.length > 0 && list.every(x => x.ok) };
}

/**
 * 수로 시계. 연속한 open|running 두 스텝에서 clock 은 게임 시간만큼 늘고, 둘 다 running 이면 left 는 게임 시간만큼 줄고 elapsed 는 늘어난다(범람 스텝 쌍은 제외).
 * 정상 경로 하나만 면제한다: 그 스텝 안에서 전투가 일시정지됐고(pz) clock · left · elapsed 가 직전 행과 정확히 같다. 조금이라도 다르면 위반이다.
 * 확인한 쌍이 minPairs 개 이상이어야 한다.
 */
export function checkChannelClock(rows, { minPairs = 30 } = {}) {
  const list = stepRows(rows), bad = [], pauseEntry = [];
  let pairs = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (!live(a) || !live(b) || b.n !== a.n + 1) continue;
    pairs++;
    const dt = b.t - a.t;
    const sameAll = b.ch.ck === a.ch.ck && b.ch.lf === a.ch.lf && b.ch.el === a.ch.el;
    if (b.pz === 1 && sameAll) { pauseEntry.push({ n: b.n, dt }); continue; }
    if (Math.abs((b.ch.ck - a.ch.ck) - dt) > EPS) { bad.push({ kind: 'clock', n: b.n, dt, clock: [a.ch.ck, b.ch.ck] }); continue; }
    if (a.ch.ph === PHASE_CODE.running && b.ch.ph === PHASE_CODE.running && a.ch.fl === b.ch.fl
      && (Math.abs((a.ch.lf - b.ch.lf) - dt) > EPS || Math.abs((b.ch.el - a.ch.el) - dt) > EPS)) bad.push({ kind: 'left', n: b.n, dt, left: [a.ch.lf, b.ch.lf], elapsed: [a.ch.el, b.ch.el] });
  }
  return { pairs, bad: bad.slice(0, 6), badCount: bad.length, pauseEntry, ok: pairs >= minPairs && bad.length === 0 };
}

/** 띠 위상. open|running 행마다 모든 띠의 중심 x · half · 상태 · cycle · age 가 clock 에서 계산한 값과 같다(경계 값은 건너뛴다). 경고와 분출이 모두 관측돼야 한다. */
export function checkBands(rows, def, setup, { minRows = 30 } = {}) {
  const c = def.channel, bad = [];
  let checked = 0, skipped = 0, rowsChecked = 0;
  const seen = { calm: 0, warning: 0, burst: 0 };
  for (const r of stepRows(rows)) {
    if (!live(r)) continue;
    rowsChecked++;
    r.ch.b.forEach((b, i) => {
      if (!b || !near(b.x, setup.roomX + c.bands[i]) || !near(b.h, c.bandHalf)) { bad.push({ kind: 'geometry', n: r.n, band: i, x: b?.x ?? null, h: b?.h ?? null }); return; }
      seen[BAND_NAMES[b.s]]++;
      const e = bandExpect(c, i, r.ch.ck);
      if (e.edge) { skipped++; return; }
      checked++;
      if (b.s !== e.state) bad.push({ kind: 'state', n: r.n, band: i, clock: r.ch.ck, got: BAND_NAMES[b.s], want: BAND_NAMES[e.state] });
      else if (b.c !== e.cycle) bad.push({ kind: 'cycle', n: r.n, band: i, clock: r.ch.ck, got: b.c, want: e.cycle });
      // age 는 경고·분출 상태에서만 판정한다(calm 의 경과 기준은 규칙 구현에 맡긴다: 값이 유한한지는 관측 완전성이 본다).
      else if (e.age !== null && e.state !== BAND_CODE.calm && Math.abs(b.a - e.age) > 1e-4) bad.push({ kind: 'age', n: r.n, band: i, clock: r.ch.ck, got: b.a, want: e.age });
    });
  }
  return { rows: rowsChecked, checked, skipped, seen, bad: bad.slice(0, 8), badCount: bad.length, ok: rowsChecked >= minRows && bad.length === 0 && seen.warning > 0 && seen.burst > 0 };
}

/**
 * 분출 피해(channel.sporeHits). 늘어난 행은 (a) 한 번에 +1, (b) 그 행 또는 직전 스텝 행에서 영웅이 수로 방 안이고 분출 중인 띠의 중심 ± (half + 여유) 안,
 * (c) 같은 띠·같은 cycle 에 두 번 늘지 않는다(분출당 한 번). 설명할 수 없는 증가(띠 밖·분출 아님)는 위반이다.
 * 분출 중인 띠 깊숙이(half − 여유) 있던 (띠, cycle)에 증가가 없으면 missed 다. strictMissed 면 위반이고, 아니면(AUTO: 회피 동작 무적 가능) 기록만 한다.
 * strict 면 직전 스텝보다 HP 가 최대 체력의 damage ± .01 줄어야 한다. multiRow: 같은 (띠, cycle) 안에서 분출 중 영웅이 있던 행이 둘 이상이면서 증가가 한 번뿐인 칸 수(두 번 없음을 뜻 있게 보여 준다).
 */
export function checkChannelHits(rows, def, setup, { strict = false, strictMissed = false } = {}) {
  const c = def.channel, sr = stepRows(rows), cells = new Map(), hits = [], bad = [];
  const cell = (band, cycle) => { const key = band + ':' + cycle; if (!cells.has(key)) cells.set(key, { band, cycle, deep: 0, edge: 0, inc: 0 }); return cells.get(key); };
  for (let i = 0; i < sr.length; i++) {
    const r = sr[i], p = i > 0 ? sr[i - 1] : null;
    if (!r.ch) continue;
    if (live(r) && inRoom(setup, r.x, r.z)) r.ch.b.forEach((b, bi) => {
      if (!b || b.s !== BAND_CODE.burst) return;
      const dx = Math.abs(r.x - b.x), k = cell(bi, b.c);
      if (dx <= b.h - BAND_INNER_MARGIN) k.deep++;
      if (dx <= b.h + BAND_OUTER_SLACK) k.edge++;
    });
    if (!p?.ch || !(r.ch.sh > p.ch.sh)) continue;
    const jump = r.ch.sh - p.ch.sh;
    // 이 증가를 설명하는 띠: 이 행이나 직전 스텝 행에서 분출 중이고 영웅이 그 띠 안(여유 포함)이다.
    let found = null;
    for (const src of [r, p]) {
      if (found || !src.ch || !live(src) || !inRoom(setup, src.x, src.z)) continue;
      src.ch.b.forEach((b, bi) => { if (!found && b?.s === BAND_CODE.burst && Math.abs(src.x - b.x) <= b.h + BAND_OUTER_SLACK) found = { band: bi, cycle: b.c, x: src.x }; });
    }
    const ratio = p.n === r.n - 1 && r.mhp > 0 ? (p.hp - r.hp) / r.mhp : null;
    const rec = { n: r.n, t: r.t, jump, band: found?.band ?? null, cycle: found?.cycle ?? null, ratio, raw: r.hr ?? null, explained: !!found };
    hits.push(rec);
    if (jump !== 1) bad.push({ kind: 'jump', n: r.n, jump });
    if (!found) bad.push({ kind: 'unexplained', n: r.n, hero: [r.x, r.z] });
    else cell(found.band, found.cycle).inc += jump;
    if (strict && !damageMatches(r, ratio, c.damage)) bad.push({ kind: 'damage', n: r.n, ratio, raw: r.hr ?? null, want: c.damage });
  }
  const list = [...cells.values()];
  for (const k of list) if (k.inc > 1) bad.push({ kind: 'double', band: k.band, cycle: k.cycle, hits: k.inc });
  const missed = list.filter(k => k.deep > 0 && k.inc === 0).map(k => ({ band: k.band, cycle: k.cycle }));
  if (strictMissed) for (const m of missed) bad.push({ kind: 'missed', ...m });
  const first = sr.find(r => r.ch)?.ch.sh ?? 0, last = sr.at(-1)?.ch?.sh ?? null;
  const multiRow = list.filter(k => k.inc === 1 && k.edge >= 2).length;
  return { total: last === null ? null : last - first, hits, cells: list.filter(k => k.inc > 0 || k.deep > 0), missed, multiRow, bad: bad.slice(0, 8), badCount: bad.length, strict,
    ok: bad.length === 0 && last !== null && last - first === hits.reduce((a, h) => a + h.jump, 0) };
}

/**
 * 범람(channel.floods). 늘어난 행은 (a) 한 번에 +1, (b) 앞 스텝 행이 running 이고 left 가 그 스텝에서 바닥났다(앞 행 left ≤ 한 프레임), (c) 이 행의 limit 이 도구가 다시 잰 거리로 계산한 값이고 left = limit,
 * (d) 열린 phase 는 running 유지. strict 면 직전 스텝보다 HP 가 최대 체력의 floodDamage ± .01 줄어야 한다. 비율은 항상 기록한다.
 */
export function checkFloods(rows, def, { strict = false } = {}) {
  const c = def.channel, sr = stepRows(rows), floods = [], bad = [];
  for (let i = 1; i < sr.length; i++) {
    const r = sr[i], p = sr[i - 1];
    if (!r.ch || !p.ch || !(r.ch.fl > p.ch.fl)) continue;
    const dense = p.n === r.n - 1;
    const exact = r.ch.fd >= 0 && finite(r.ch.fd) ? limitOf(c, r.ch.fd) : null;
    const ratio = dense && r.mhp > 0 ? (p.hp - r.hp) / r.mhp : null;
    const rec = { n: r.n, t: r.t, jump: r.ch.fl - p.ch.fl, dense, previousLeft: p.ch.lf, previousPhase: p.ch.ph, phase: r.ch.ph, limit: r.ch.lim, left: r.ch.lf, exact, dist: r.ch.fd ?? null, ratio };
    floods.push(rec);
    if (rec.jump !== 1) bad.push({ kind: 'jump', n: r.n, jump: rec.jump });
    if (!dense) bad.push({ kind: 'sparse', n: r.n });
    if (p.ch.ph !== PHASE_CODE.running || !(p.ch.lf <= FRAME + EPS)) bad.push({ kind: 'not-expired', n: r.n, previousPhase: p.ch.ph, previousLeft: p.ch.lf });
    if (r.ch.ph !== PHASE_CODE.running) bad.push({ kind: 'phase', n: r.n, phase: r.ch.ph });
    if (exact === null || r.ch.lim !== exact || Math.abs(r.ch.lf - r.ch.lim) > FRAME + EPS) bad.push({ kind: 'limit', n: r.n, limit: r.ch.lim, exact, left: r.ch.lf, dist: r.ch.fd ?? null });
    if (strict && !damageMatches(r, ratio, c.floodDamage)) bad.push({ kind: 'damage', n: r.n, ratio, raw: r.hr ?? null, want: c.floodDamage });
  }
  const last = [...sr].reverse().find(r => r.ch);
  return { total: last?.ch?.fl ?? null, floods, bad: bad.slice(0, 8), badCount: bad.length, strict, ok: bad.length === 0 && (last?.ch?.fl ?? 0) === floods.reduce((a, f) => a + f.jump, 0) };
}

/**
 * 돌파 완료. done 은 앞 행이 running(밀집 관측)이고 done 스텝의 영웅이 수로 방 안 x ≥ finishX 일 때만 처음 관측된다. running 행(시작 스텝 제외)에서 영웅이 방 안 x ≥ finishX + 여유면 done 이었어야 한다.
 * done 뒤에는 다시 running 이 되지 않고 횟수(범람·피격)가 늘지 않는다.
 */
export function checkChannelDone(rows, def, setup) {
  const idx = rows.findIndex(r => r.ch?.ph === PHASE_CODE.done);
  if (idx < 1) return { ok: false, reason: 'never-done' };
  const r = rows[idx], p = rows[idx - 1], startN = rows.find(x => x.ch?.ph === PHASE_CODE.running)?.n;
  const inside = rows.filter(x => x.ch?.ph === PHASE_CODE.running && x.n !== startN && inRoom(setup, x.x, x.z) && x.x >= setup.finishX + POSITION_SLACK).map(x => ({ n: x.n, x: x.x }));
  const after = rows.slice(idx), back = after.filter(x => x.ch?.ph !== PHASE_CODE.done).length;
  const grew = after.filter(x => x.ch && (x.ch.fl !== r.ch.fl || x.ch.sh !== r.ch.sh)).length;
  return { n: r.n, t: r.t, x: r.x, finishX: setup?.finishX ?? null, previous: p.ch?.ph ?? null, elapsed: r.ch.el, insideNotDone: inside.slice(0, 4), insideCount: inside.length, back, grew,
    hpAlive: r.al === 1 && r.hp > 0,
    ok: p.ch?.ph === PHASE_CODE.running && p.n === r.n - 1 && inRoom(setup, r.x, r.z) && r.x >= setup.finishX - POSITION_SLACK && inside.length === 0 && back === 0 && grew === 0 && r.al === 1 };
}

/**
 * 보스 봉인. 시작부터 world.sealed 였고 돌파(done) 전 모든 행에서 true 다. 해제(처음 false)는 done 스텝 또는 그 한 스텝 뒤이고 그때 progress = n · rem = 0 이며 그 뒤 다시 잠기지 않는다.
 */
export function checkSeal(rows, def) {
  const n = def.gates.length, first = rows.findIndex(r => r.sl === 0);
  const startsSealed = rows[0]?.sl === 1;
  if (first < 0) return { ok: false, startsSealed, reason: 'never-unsealed' };
  const row = rows[first], doneIdx = rows.findIndex(r => r.ch?.ph === PHASE_CODE.done);
  const beforeAll = rows.slice(0, first).every(r => r.sl === 1);
  const relocked = rows.slice(first).filter(r => r.sl !== 0).length;
  const afterDone = doneIdx >= 0 && first >= doneIdx && row.n - rows[doneIdx].n <= 1 && row.ch?.ph === PHASE_CODE.done;
  const ok = startsSealed && beforeAll && afterDone && row.pr === n && row.rem === 0 && relocked === 0;
  return { ok, startsSealed, n: row.n, t: row.t, progress: row.pr, remaining: row.rem, doneIdx, firstUnsealed: first, afterDone, relocked, reason: ok ? null : 'early-or-inconsistent' };
}

/** AUTO 는 시간 초과 범람이 없다(floods 0). 포자 피격·폭발 수는 기록만 한다. */
export function checkAutoCounts(rows) {
  const ch = rows.filter(r => r.ch && (r.ch.ph === PHASE_CODE.running || r.ch.ph === PHASE_CODE.done));
  const floods = Math.max(0, ...ch.map(r => r.ch.fl)), sporeHits = Math.max(0, ...ch.map(r => r.ch.sh));
  return { rows: ch.length, floods, sporeHits, bursts: rows.at(-1)?.bu ?? null, ok: ch.length > 0 && floods === 0 };
}

// ---------- 결과·문구 ----------
const compact = s => String(s ?? '').replace(/\s+/g, '');
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * 결과 객체: { id, label '생명 제단 정화', complete: true, progress n, target n, rooms = 정의 순서, sporeBursts, channel{ crossed true, floods, sporeHits, seconds } }.
 * 횟수는 0 이상의 정수이고 관측한 마지막 값(opts.bursts · floods · sporeHits)과 같아야 한다. seconds 는 돌파 시작 뒤 걸린 초(done 행의 elapsed, opts.seconds)와 .06 안에서 같다.
 */
export function checkResultFields(ro, def, win = true, { bursts = null, floods = null, sporeHits = null, seconds = null } = {}) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId), ch = ro?.channel ?? null;
  const count = (v, want) => isInt(v) && v >= 0 && (want === null || v === want);
  const channelOk = !!ch && ch.crossed === true && count(ch.floods, floods) && count(ch.sporeHits, sporeHits)
    && finite(ch.seconds) && ch.seconds >= 0 && (seconds === null || Math.abs(ch.seconds - seconds) <= .06);
  const ok = !!ro && win === true && ro.id === def.id && ro.label === ALTAR.title && ro.complete === true && ro.progress === n && ro.target === n
    && JSON.stringify(ro.rooms) === JSON.stringify(rooms) && count(ro.sporeBursts, bursts) && channelOk;
  const got = ro ? { id: ro.id, label: ro.label ?? null, complete: ro.complete, progress: ro.progress, target: ro.target, rooms: [...(ro.rooms || [])], sporeBursts: ro.sporeBursts, channel: ch ? { ...ch } : null } : null;
  return { ok, got, channelOk, want: { id: def.id, label: ALTAR.title, complete: true, progress: n, target: n, rooms, bursts, floods, sporeHits, seconds } };
}
/** 결과 화면 본문에 두 줄('생명 제단 정화 4/4 · 완료', '포자 수로 돌파 완료 · 포자 피격 n회 · 범람 n회')이 모두 있다. */
export function checkResultLines(text, def, ro) {
  const altar = altarResultLine(def), channel = channelResultLine(ro?.channel);
  const body = norm(text);
  return { ok: typeof text === 'string' && body.includes(altar) && body.includes(channel), altar, channel, altarFound: body.includes(altar), channelFound: body.includes(channel) };
}
/** 결과 줄 요소: aria-label '생명 제단 정화 결과' 본문이 첫 줄, '포자 수로 돌파 결과' 본문이 둘째 줄과 정확히 같고 각각 하나뿐이다. lines: [{ aria, text }]. */
export function checkResultElements(lines, def, ro) {
  const altarAria = ALTAR.title + ' 결과', channelAria = '포자 수로 돌파 결과', altar = altarResultLine(def), channel = channelResultLine(ro?.channel);
  const pick = aria => (lines || []).filter(l => l?.aria === aria);
  const a = pick(altarAria), c = pick(channelAria);
  const ok = a.length === 1 && norm(a[0].text) === altar && c.length === 1 && norm(c[0].text) === channel;
  return { ok, altarAria, channelAria, altar, channel, found: { altar: a.map(l => l.text), channel: c.map(l => l.text) } };
}

/**
 * 목표창 기대 문구(PLAN 3.2): 제단 단계는 제목 '생명 제단 정화' + n/4 와 다음 구역을 찾아 이동 · 뿌리 빛 제단 · 이 구역의 적 처치 · 뿌리 빛 제단 중심에서 2초 유지,
 * 4/4 뒤 수로가 닫혀 있으면 남은 구역 정화, 열림은 '포자 수로 돌파' · 서쪽 수로 입구로 이동, 돌파 중은 포자 물결이 지나간 뒤 동쪽 출구로 · N초(10Hz 갱신이라 올림 값 또는 한 칸 위).
 * done 이후는 보스 흐름이라 표본을 보지 않는다(null).
 */
export function expectedObjective(row, def) {
  const n = def.gates.length, ch = row.ch;
  if (ch?.ph === PHASE_CODE.done) return null;
  if (ch?.ph === PHASE_CODE.open) return { kind: 'open', title: COPY.channelTitle, action: COPY.channelOpen };
  if (ch?.ph === PHASE_CODE.running) return { kind: 'run', title: COPY.channelTitle, actionPrefix: COPY.channelRun, seconds: [Math.ceil(ch.lf), Math.ceil(ch.lf) + 1] };
  if (row.pr >= n) return { kind: 'remain', title: COPY.altarTitle, action: COPY.remain };
  const g = row.g?.[row.pr];
  if (!g) return null;
  if (g.dc !== 1) return { kind: 'find', title: COPY.altarTitle, count: row.pr + '/' + n, action: COPY.find };
  if (g.rd !== 1) return { kind: 'fight', title: COPY.altarTitle, count: row.pr + '/' + n, action: COPY.fight };
  return { kind: 'hold', title: COPY.altarTitle, count: row.pr + '/' + n, action: '뿌리 빛 제단 중심에서 ' + def.holdSeconds + '초 유지' };
}
/**
 * 목표창 표본(같은 상태가 0.6초 이어진 뒤 10Hz 갱신이 지난 표본). 모든 표본이 그 상태의 기대 문구를 가지고 이전(공명)·일반판 번호 문구가 없어야 한다.
 * 제단 유지 표본(hold)과 수로 돌파 중 표본(run)이 각각 1개 이상 있어야 한다. 나머지 단계 표본은 보고 항목이다.
 */
export function checkObjectiveSamples(rows, def) {
  const samples = rows.filter(r => typeof r.dom === 'string'), kinds = {}, bad = [];
  for (const r of samples) {
    const want = expectedObjective(r, def), dom = compact(r.dom);
    let ok = !!want && !leaks(r.dom) && dom.includes(compact(want.title));
    if (ok && want.count) ok = dom.includes(compact(want.count));
    if (ok && want.action) ok = dom.includes(compact(want.action));
    if (ok && want.actionPrefix) ok = want.seconds.some(s => dom.includes(compact(want.actionPrefix + s + '초')));
    if (want) kinds[want.kind] = (kinds[want.kind] ?? 0) + 1;
    if (!ok) bad.push({ n: r.n, want: want ? (want.action ?? want.actionPrefix + want.seconds.join('|')) : null, dom: r.dom });
  }
  return { samples: samples.length, kinds, bad: bad.slice(0, 6), badCount: bad.length, ok: samples.length > 0 && bad.length === 0 && (kinds.hold ?? 0) >= 1 && (kinds.run ?? 0) >= 1 };
}

/**
 * 토스트 표본({ n, t, msg, kind }). 정화 토스트 4개가 각각 1회·정의 순서, 수로 열림 1회, 시작 '포자 수로 돌파 시작 · <limit>초' 1회(startLimit 이 시작 스텝 limit 과 같음),
 * 피격 토스트는 결과의 sporeHits 와 같은 횟수, 범람 토스트 '포자 수로 범람 · 다시 <limit>초'는 floods 와 같은 횟수(floodLimits 가 있으면 순서대로 같은 limit), 완료 토스트 1회.
 * 순서: 정화 4번째 < 열림 < 시작 < 완료. 이전(공명)·일반판 번호 문구가 있으면 누출이다.
 * 보스 입장 때 뜨는 실제 전술 토스트(stage.encounter.tactic)는 그 순간의 tactic 문자열(토스트의 tac, 없으면 encounterTactic)과 정확히 같은 토스트만 누출 검사에서 뺀다. 한 글자라도 다르면 그대로 검사한다.
 */
export function checkToasts(toasts, def, { sporeHits = null, floods = null, startLimit = null, floodLimits = null, encounterTactic = null } = {}) {
  // 각 토스트는 뜬 순간의 stage.encounter.tactic(tac)을 함께 남길 수 있다. 있으면 그 값과, 없으면 인자 encounterTactic 과 정확히 같을 때만 면제한다.
  const fallback = typeof encounterTactic === 'string' && encounterTactic.length > 0 ? encounterTactic : null;
  const items = (toasts || []).map(t => ({ msg: String(t?.msg ?? ''), tac: typeof t?.tac === 'string' && t.tac.length > 0 ? t.tac : fallback }));
  const list = items.map(i => i.msg);
  const count = text => list.filter(m => m === text).length;
  const purify = def.gates.map((_, i) => ({ text: purifyToast(def, i), count: count(purifyToast(def, i)), at: list.indexOf(purifyToast(def, i)) }));
  const startAll = list.filter(m => /^포자 수로 돌파 시작 · \d+초$/.test(m)), floodAll = list.filter(m => /^포자 수로 범람 · 다시 \d+초$/.test(m));
  const hitCount = count(COPY.hit), openCount = count(COPY.open), doneCount = count(COPY.done);
  const ordered = purify.every((p, i) => p.at >= 0 && (i === 0 || p.at > purify[i - 1].at));
  const seq = [purify.at(-1).at, list.indexOf(COPY.open), startAll.length ? list.indexOf(startAll[0]) : -1, list.indexOf(COPY.done)];
  const sequence = seq.every((at, i) => at >= 0 && (i === 0 || at > seq[i - 1]));
  const isTactic = i => !!i.tac && i.msg === i.tac;
  const tacticToasts = items.filter(isTactic).length;
  const leaked = items.filter(i => !isTactic(i) && leaks(i.msg)).map(i => i.msg);
  const startOk = startAll.length === 1 && (startLimit === null || startAll[0] === startToast(startLimit));
  const floodOk = (floods === null || floodAll.length === floods) && (floodLimits === null || (floodAll.length === floodLimits.length && floodAll.every((m, i) => m === floodToast(floodLimits[i]))));
  const ok = purify.every(p => p.count === 1) && ordered && openCount === 1 && startOk && doneCount === 1 && sequence && floodOk && leaked.length === 0 && (sporeHits === null || hitCount === sporeHits);
  return { ok, purify, ordered, sequence, openCount, startToasts: startAll, startOk, hitCount, sporeHits, floodToasts: floodAll, floodOk, doneCount, leaked, tacticToasts, total: list.length };
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
const lastOf = (rows, pick) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].ch) return pick(rows[i]); return null; };
/**
 * auto 프로필 종합 판정. obs: { rows, setup(수로 setup), rooms(방 id · x · z · type), result, resultText, resultLines, win, toasts, encounterTactic }.
 * clean: AUTO 가 범람 없이 돌파했는지(autoFloods)까지 요구한다. 수동 구간이 있는 order · channel 프로필은 false 로 부른다.
 */
export function analyzeAuto(obs, def, { clean = true } = {}) {
  const rows = obs.rows || [], setup = obs.setup;
  const definition = checkDefinition(def), setupCheck = checkChannelSetup(setup, def), observation = checkObservation(rows, def);
  const altars = checkAltars(rows, def, { rooms: obs.rooms }), lit = checkLit(rows, def), unlit = checkUnlit(rows, def), ready = checkReadyTiming(rows, def, { rooms: obs.rooms });
  const wrong = checkWrongStep(rows, def, { rooms: obs.rooms });
  const open = checkChannelOpen(rows, def), start = checkChannelStart(rows, def, setup), limit = checkChannelLimit(rows, def), clock = checkChannelClock(rows);
  const bands = checkBands(rows, def, setup), hits = checkChannelHits(rows, def, setup), floods = checkFloods(rows, def), done = checkChannelDone(rows, def, setup);
  const seal = checkSeal(rows, def), counts = checkAutoCounts(rows);
  const finalBursts = rows.at(-1)?.bu ?? null, finalFloods = lastOf(rows, r => r.ch.fl), finalHits = lastOf(rows, r => r.ch.sh);
  const doneRow = rows.find(r => r.ch?.ph === PHASE_CODE.done);
  const result = checkResultFields(obs.result, def, obs.win === true, { bursts: finalBursts, floods: finalFloods, sporeHits: finalHits, seconds: doneRow?.ch.el ?? null });
  const lines = checkResultLines(obs.resultText, def, obs.result);
  const elements = Array.isArray(obs.resultLines) ? checkResultElements(obs.resultLines, def, obs.result) : null;
  const objective = checkObjectiveSamples(rows, def);
  const startRow = rows.find(r => r.ch?.ph === PHASE_CODE.running);
  const toasts = checkToasts(obs.toasts, def, { sporeHits: finalHits, floods: finalFloods, startLimit: startRow?.ch.lim ?? null, floodLimits: floods.floods.map(f => f.limit), encounterTactic: obs.encounterTactic ?? null });
  const acceptance = {
    observation: observation.ok, definition: definition.ok, channelSetup: setupCheck.ok,
    altarCount: altars.ok.count, altarOrder: altars.ok.order, altarHold: altars.ok.hold, altarInside: altars.ok.inside, altarLit: altars.ok.lit, altarEnemies: altars.ok.enemies, altarState: altars.ok.state,
    litMoves: lit.ok, unlitRooms: unlit.ok, readyTiming: ready.ok, wrongStep: wrong.ok,
    channelOpen: open.ok, channelStart: start.ok, channelLimit: limit.ok, channelClock: clock.ok, channelBands: bands.ok, channelHits: hits.ok, channelFloods: floods.ok, channelDone: done.ok,
    sealed: seal.ok, resultFields: result.ok, resultLine: lines.ok, objectiveText: objective.ok, toasts: toasts.ok,
    ...(elements ? { resultElements: elements.ok } : {}),
    ...(clean ? { autoFloods: counts.ok } : {}),
  };
  return { ok: Object.values(acceptance).every(Boolean), acceptance, definition, setup: setupCheck, observation, altars, lit, unlit, ready, wrong, open, start, limit, clock, bands, hits, floods, done, seal, counts,
    result, resultLines: lines, resultElements: elements, objective, toasts, rows: rows.length };
}

// ---------- order 프로필(키보드) ----------
/**
 * order 프로필 판정(수동, 공격 키 없음). 표식: manual-start(AUTO 끔, 차례가 아닌 제단이 준비됨) · burst1(포자 폭발 +1 스텝) · dwell-end(폭발 뒤 제단 중심에서 minDwell 초 이상 머문 끝).
 * 앞 단계(AUTO): 첫 제단(방 2) 정화 뒤 점등이 둘째 제단으로 옮겨 감(progress 1 · litMoves 1 · lit = 정의 둘째 방).
 * 수동 구간: 준비된 비점등 제단 j(manual-start 행에서 index > progress, ready, 적 0, 정화 전)의 중심 반경 안에서 wrongStep.seconds 머문 뒤 폭발 +1 한 번(HP 8% 감소, 진행 불변, 정화 불변),
 * 폭발 뒤 minDwell 초 넘게 그 반경 안에 머물러도 유지는 0 · attuned false · 방 미정화 · 점등 그대로 · 폭발은 더 늘지 않는다.
 */
export function analyzeOrder(rows, def, { rooms = [], minDwell = 2 } = {}) {
  const names = ['manual-start', 'burst1', 'dwell-end'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, keyboard: { ok: false }, burst: { ok: false }, dwell: { ok: false }, lit: { ok: false } };
  const at = k => markIndex(rows, k);
  const a = at('manual-start'), b = at('burst1'), c = at('dwell-end');
  const start = rows[a], burst = rows[b], end = rows[c];
  const keyboard = checkKeyboardSegment(rows, 'manual-start', 'dwell-end');
  const j = def.gates.findIndex((_, k) => k > start.pr && start.g?.[k]?.rd === 1 && start.g[k].at === 0 && start.g[k].al === 0 && start.g[k].pd === 0);
  const room = j >= 0 ? roomById(rooms, def.gates[j].roomId) : null;
  const litMoved = rows.slice(0, a).some(r => r.pr === 1 && r.lm === 1 && r.lt === def.gates[1].roomId);
  const seg = rows.slice(a, c + 1);
  const wrong = checkWrongStep(rows.slice(0, c + 1), def, { rooms, strict: true, after: start.n });
  const first = wrong.bursts[0] ?? null;
  const post = rows.slice(b, c + 1);
  const insideNow = r => !!room && Math.hypot(r.x - room.x, r.z - room.z) <= def.radius + POSITION_SLACK;
  // 폭발의 넉백으로 잠깐 반경을 벗어날 수 있어(도구가 키로 중심으로 되돌린다) 반경 밖 행은 기록하고, 반경 안에 머문 시간과 끝 시점의 위치를 판정한다.
  const away = post.filter(r => !insideNow(r)).length, insideSeconds = stepRows(post).filter(insideNow).length * FRAME;
  const seconds = end.t - burst.t;
  const burstRec = { count: end.bu - start.bu, atBurst: burst.bu - start.bu, beforeBurst: rows.slice(a, b).filter(r => r.n < burst.n && r.bu !== start.bu).length, gate: j, dwellBefore: first?.dwell ?? null, ratio: first?.ratio ?? null, raw: first?.raw ?? null,
    progressSame: burst.pr === start.pr, ok: j >= 0 && end.bu - start.bu === 1 && burst.bu - start.bu === 1 && rows.slice(a, b).filter(r => r.n < burst.n).every(r => r.bu === start.bu) && wrong.ok && wrong.count === 1 && burst.pr === start.pr };
  const dwell = { seconds, need: minDwell - 2 * FRAME, awayRows: away, insideSeconds, insideNeed: minDwell - .4, endInside: insideNow(end), holdRows: post.filter(r => r.hd !== 0).length,
    attuned: post.filter(r => j < 0 || r.g[j].at !== 0).length, cleared: post.filter(r => j < 0 || r.g[j].cl !== 0).length, progressChanged: post.filter(r => r.pr !== start.pr).length,
    litChanged: seg.filter(r => r.lt !== def.gates[start.pr].roomId).length, secondBurst: end.bu - burst.bu };
  dwell.ok = j >= 0 && seconds + EPS >= dwell.need && insideSeconds + EPS >= dwell.insideNeed && dwell.endInside && dwell.holdRows === 0 && dwell.attuned === 0 && dwell.cleared === 0 && dwell.progressChanged === 0 && dwell.litChanged === 0 && dwell.secondBurst === 0;
  const lit = { moved: litMoved, startLit: start.lt, startProgress: start.pr, ok: litMoved && start.lt === def.gates[start.pr]?.roomId && start.pr >= 1 };
  return { ok: keyboard.ok && burstRec.ok && dwell.ok && lit.ok, keyboard, burst: burstRec, dwell, lit, wrong, rows: seg.length };
}

// ---------- channel 프로필(수동) ----------
/**
 * channel 프로필 판정(수동, 공격 키 없음). 표식: ch-manual(수로 open 에서 AUTO 끔) · ch-wait-end(출발선 밖 대기를 마침) · ch-started(돌파 시작 스텝) ·
 * hit1(첫 피격 스텝) · hit1-end(같은 분출이 끝난 뒤, 띠 안에 계속 선 채) · hit2(다음 cycle 피격 스텝) · hit2-end · flood(범람 스텝) · ch-done(돌파 스텝).
 * wait: ch-manual~ch-wait-end 동안 phase 는 계속 open 이고 영웅은 출발선 밖(방 밖 또는 x > startX)이며 게임 시간으로 minWait 초 이상 기다린다 → 시작 안 됨.
 * start: 대기를 마친 뒤 처음 running 인 행이 시작 조건 첫 스텝(checkChannelStart 가 늦은 시작 없음을 보증)이고 ch-started 표식과 같은 스텝이다.
 * hits: hit1 에서 sporeHits +1, 같은 분출이 끝날 때까지 늘지 않고(그동안 분출 중 띠 안 행이 둘 이상), hit2 는 같은 띠의 다음 cycle 에서 +1.
 * flood: 범람 1회 이상, 매 범람이 제한 시간 소진 스텝이고 limit 재계산(checkFloods · checkChannelLimit). done: 돌파 스텝과 봉인 해제는 checkChannelDone · checkSeal.
 */
export function analyzeChannelManual(rows, def, setup, { minWait = 2.5 } = {}) {
  const names = ['ch-manual', 'ch-wait-end', 'ch-started', 'hit1', 'hit1-end', 'hit2', 'hit2-end', 'flood', 'ch-done'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, keyboard: { ok: false }, wait: { ok: false }, hits: { ok: false }, flood: { ok: false } };
  const at = k => markIndex(rows, k);
  const keyboard = checkKeyboardSegment(rows, 'ch-manual', 'ch-done');
  const waitRows = stepRows(rows.slice(at('ch-manual'), at('ch-wait-end') + 1));
  const waitSeconds = (m['ch-wait-end'].n - m['ch-manual'].n) * FRAME;
  const inZone = waitRows.filter(r => inStartZone(setup, r.x, r.z)).length, notOpen = waitRows.filter(r => r.ch?.ph !== PHASE_CODE.open).length;
  const wait = { seconds: waitSeconds, need: minWait - FRAME, rows: waitRows.length, inZoneRows: inZone, notOpenRows: notOpen, ok: waitSeconds + EPS >= minWait - FRAME && inZone === 0 && notOpen === 0 };
  const start = checkChannelStart(rows, def, setup);
  const startAgain = { ok: start.ok && start.n > m['ch-wait-end'].n && start.n === m['ch-started'].n, startN: start.n ?? null, markN: m['ch-started'].n, waitEndN: m['ch-wait-end'].n };
  const s0 = m['ch-started'].ch.sh, h1 = m.hit1, e1 = m['hit1-end'], h2 = m.hit2, e2 = m['hit2-end'];
  const burstRows = (from, to) => stepRows(rows.slice(at(from), at(to) + 1)).filter(r => live(r) && inRoom(setup, r.x, r.z) && r.ch.b[0].s === BAND_CODE.burst
    && Math.abs(r.x - r.ch.b[0].x) <= r.ch.b[0].h + BAND_OUTER_SLACK).length;
  const hitFacts = { base: s0, hit1: h1.ch.sh, hit1End: e1.ch.sh, hit2: h2.ch.sh, hit2End: e2.ch.sh, cycle1: h1.ch.b[0].c, cycle1End: e1.ch.b[0].c, cycle2: h2.ch.b[0].c, cycle2End: e2.ch.b[0].c,
    insideBurstRows1: burstRows('hit1', 'hit1-end'), insideBurstRows2: burstRows('hit2', 'hit2-end') };
  const hitsMarks = h1.ch.sh === s0 + 1 && e1.ch.sh === s0 + 1 && hitFacts.cycle1 === hitFacts.cycle1End && h2.ch.sh === s0 + 2 && e2.ch.sh === s0 + 2
    && hitFacts.cycle2 === hitFacts.cycle1 + 1 && hitFacts.cycle2 === hitFacts.cycle2End && hitFacts.insideBurstRows1 >= 2 && hitFacts.insideBurstRows2 >= 2;
  const hitsAll = checkChannelHits(rows, def, setup, { strict: true, strictMissed: true });
  const hits = { ...hitFacts, marksOk: hitsMarks, all: hitsAll, ok: hitsMarks && hitsAll.ok && hitsAll.multiRow >= 2 };
  const floods = checkFloods(rows, def, { strict: true }), limit = checkChannelLimit(rows, def);
  const flood = { marked: m.flood.ch.fl, floods, limit, ok: m.flood.ch.fl >= 1 && floods.ok && floods.total >= 1 && limit.ok };
  const done = checkChannelDone(rows, def, setup), seal = checkSeal(rows, def);
  const doneAt = { ok: done.ok && done.n === m['ch-done'].n, doneN: done.n ?? null, markN: m['ch-done'].n };
  return { ok: keyboard.ok && wait.ok && startAgain.ok && hits.ok && flood.ok && doneAt.ok && seal.ok, keyboard, wait, start: startAgain, hits, flood, done: doneAt, seal };
}

// ---------- screens 프로필 ----------
/** 순간 이름(게임 흐름과 무관한 관측 상태): 점등 기둥 · 점등 이동 직후 · 비점등 보라 고리(준비된 비점등 제단) · 수로 띠(서쪽 첫 띠 기준) calm · warning · burst. */
export const MOMENTS = Object.freeze(['lit', 'moved', 'unlit', 'calm', 'warning', 'burst']);
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
 * screens 순간의 route 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze)이고, 관측 필드(lit · litMoves · litT · bursts · 제단 칸 · channel 띠)에 누락이 있으면 실패한다.
 * lit: 첫 제단이 점등이고 그 방 안에서 발견됨. moved: 정화 한 번 뒤 점등이 둘째 제단으로 옮겨 가 0.1초 이상 지남(litT).
 * unlit: 차례가 아닌 제단이 준비됨(ready · 적 0 · 정화 전)이고 영웅이 그 방 안. calm · warning · burst: 수로 open|running 이고 영웅이 수로 방 안, 서쪽 첫 띠의 상태가 그 이름.
 * 상태 JSON 에는 이 행 전체를 쓰므로 PNG 와 맞춰 볼 수 있다.
 */
export function checkScreenMoment(shot, def, label) {
  const row = shot?.capture ?? null;
  if (!row) return { ok: false, label, state: false, observed: false };
  const observed = checkObservation([row], def).ok;
  let state = false;
  if (label === 'lit') {
    const g = row.g?.[0];
    state = row.pr === 0 && row.lt === def.gates[0].roomId && g?.dc === 1 && row.rm === def.gates[0].roomId;
  } else if (label === 'moved') {
    state = row.pr === 1 && row.lm === 1 && row.lt === def.gates[1].roomId && row.lT + EPS >= .1 - FRAME && row.lT <= 1.5;
  } else if (label === 'unlit') {
    state = def.gates.some((gate, j) => j > row.pr && row.g?.[j]?.rd === 1 && row.g[j].at === 0 && row.g[j].al === 0 && row.g[j].pd === 0 && row.g[j].dc === 1 && row.rm === row.g[j].id);
  } else if (['calm', 'warning', 'burst'].includes(label)) {
    state = live(row) && row.rm === row.ch.rid && row.ch.b?.[0]?.s === BAND_CODE[label];
  }
  const bands = Array.isArray(row.ch?.b) ? row.ch.b.map(b => BAND_NAMES[b?.s] ?? 'unknown') : null;
  return { ok: observed && state, label, state, observed, lit: row.lt, litMoves: row.lm, litT: row.lT, progress: row.pr, phase: row.ch?.ph ?? null, bands, bursts: row.bu };
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
 * 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. 기준선(8039e6a)에는 경로 정의(verdigris_deep)가 없고 후보에는 있어야 한다.
 * 두 report 의 HEAD 는 달라야 한다(같은 빌드끼리의 비교는 합격하지 않는다). 후보는 제단·수로 판정(altarOk)까지 통과해야 한다.
 */
export function compareTargetsOk(cand, base) {
  if (!cand || !base) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const definition = !base.routeDefinition && cand.routeDefinition?.id === ALTAR.id;
  return differs && definition && cand.altarOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/** 두 report 의 실행 설정이 같은지: 영웅 · 시드 · depth · 재시드 · viewport · motion · quality 가 같아야 비교가 성립한다(없는 값은 같지 않다고 본다). */
export function compareSetup(cand, base) {
  const eq = key => cand?.[key] != null && JSON.stringify(cand[key]) === JSON.stringify(base?.[key]);
  const same = { hero: eq('heroId'), seed: eq('seed'), depth: eq('depth'), reseed: eq('reseedOn'), viewport: eq('viewport'), motion: eq('motion'), quality: eq('quality') };
  return { same, ok: Object.values(same).every(Boolean) };
}
/** 1000 스텝당 50ms 초과 수(보고 항목). 스텝 수가 없거나 0 이면 null. */
export const overPer1000 = (over, steps) => (Number.isFinite(over) && Number.isFinite(steps) && steps > 0 ? over / steps * 1000 : null);
/** 어느 쪽이 먼저 돌았는지(보고 항목). started 는 report.started(ISO). */
export function runOrder(candStarted, baseStarted) {
  const c = Date.parse(candStarted), b = Date.parse(baseStarted);
  return Number.isFinite(c) && Number.isFinite(b) ? (c < b ? 'cand-first' : b < c ? 'base-first' : 'same-time') : 'unknown';
}
/**
 * PLAN 5절 5 기준선 비교(한 짝). cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), altarRooms(cand), load, started }.
 * 사전 선언된 게이트: 완주 시간 비 ≤ timeRatio, 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra.
 * 보고 항목(게이트 아님): 제단·수로 방 첫 진입 draw call 증가, 50ms 초과율, 실행 전후 1분 load, 실행 순서.
 */
export function compareRuns(cand, base, { timeRatio = 2, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio };
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  const gates = { time: time.ok, slow: slow.ok };
  const report = {
    note: '보고 항목(게이트 아님, PLAN 5절 5 사전 선언): 제단·수로 방 첫 진입 draw call 증가 · 50ms 초과율 · 실행 전후 load · 실행 순서',
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.altarRooms),
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    load: { cand: cand?.load ?? null, base: base?.load ?? null },
    order: runOrder(cand?.started, base?.started),
  };
  return { ok: Object.values(gates).every(Boolean), gates, time, slow, report };
}
