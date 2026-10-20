// 종락 회랑 심층(bellfall_crypt deep) 종문 역순 공명 QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/bellfall-deep-qa.mjs 의 페이지 프로브가 app.step 한 번마다 남긴 관측 로그(게임 시간)와 대상 프로젝트의 데이터 정의다.
// 정답·간격·허용 오차는 모두 인자(def)로 받는다. 이 파일에는 방 번호나 시간 값을 박지 않는다.

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 모든 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-9;
/** 방어 경감 상한. src/game/player.js hurt 의 `1 - min(0.6, def / (def + 250))` 과 같은 식이다(리뷰 b04-review P1). */
export const DEFENSE_CAP = .6;
export const DEFENSE_SCALE = 250;

/** 컨트롤러가 hurt 에 넘기는 값(최대 체력 × damage)에 영웅 방어 경감을 적용한 실제 HP 감소량. 다른 경감이 없을 때만 정확하다. */
export function mitigatedDamage(maxHp, ratio, def) {
  if (!(maxHp > 0) || !Number.isFinite(ratio) || !Number.isFinite(def) || def < 0) return NaN;
  return Math.max(1, Math.round(maxHp * ratio * (1 - Math.min(DEFENSE_CAP, def / (def + DEFENSE_SCALE)))));
}

/** 컨트롤러 단계 전이 허용표. wake → answer 같은 단계 건너뛰기는 목록에 없으므로 실패한다. 불협은 answer → toll 이다. */
export const ALLOWED = Object.freeze({ wake: ['toll'], toll: ['answer'], answer: ['toll', 'done'], done: [] });

/** 소등 순서의 역순이 정답 공명 순서(방 id)다. */
export const reverseOrder = tollOrder => [...tollOrder].reverse();

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol + EPS;
const ctlEvents = log => (log || []).filter(e => e.kind === 'ctl');

/**
 * 컨트롤러 phase 전이 로그를 검사한다. 첫 전이는 wake 에서 시작하고, 각 전이의 from 은 직전 전이의 to 와 이어져야 하며,
 * 모든 전이는 ALLOWED 에 있어야 한다.
 */
export function checkPhaseTimeline(log) {
  const events = ctlEvents(log), violations = [];
  let at = 'wake';
  for (const e of events) {
    if (e.from !== at) violations.push({ t: e.t, reason: 'discontinuous', expectedFrom: at, from: e.from, to: e.to });
    if (!ALLOWED[e.from]?.includes(e.to)) violations.push({ t: e.t, reason: 'illegal-step', from: e.from, to: e.to });
    at = e.to;
  }
  return { ok: violations.length === 0, violations, count: events.length, last: at };
}

/** 소등 재생(wake→toll, answer→toll 마다 하나)을 로그에서 잘라낸다. dark 는 gate 가 lit → dark 로 바뀐 사건이다. */
export function buildReplays(log) {
  const replays = [];
  let current = null;
  for (const e of log || []) {
    if (e.kind === 'ctl' && e.to === 'toll') { current = { startT: e.t, from: e.from, darks: [], answerT: null }; replays.push(current); }
    else if (e.kind === 'ctl' && e.to === 'answer' && current) { current.answerT = e.t; current = null; }
    else if (e.kind === 'gate' && e.to === 'dark' && current) current.darks.push({ t: e.t, room: e.room });
  }
  return replays;
}

/**
 * 소등 재생 하나를 검사한다: 순서 = tollOrder, 첫 소등 = 시작 + lead(양자화 2스텝), 간격 = gap ± 1/60, answer 시작 = 마지막 소등 + tail ± 1/60.
 * answerT 가 없으면(재생 도중 종료) 지금까지의 소등이 tollOrder 의 앞부분과 같은지만 본다.
 */
export function checkReplay(replay, def) {
  const { tollOrder, toll } = def, rooms = replay.darks.map(d => d.room), complete = replay.answerT != null;
  const gaps = replay.darks.slice(1).map((d, i) => d.t - replay.darks[i].t);
  /** @type {any} */
  const out = { rooms, complete, gaps, leadMeasured: replay.darks.length ? replay.darks[0].t - replay.startT : null, tailMeasured: null };
  out.orderOk = complete ? same(rooms, tollOrder) : same(rooms, tollOrder.slice(0, rooms.length));
  out.countOk = complete ? rooms.length === tollOrder.length : rooms.length <= tollOrder.length;
  out.gapOk = gaps.every(g => close(g, toll.gap, FRAME));
  out.leadOk = replay.darks.length === 0 || close(out.leadMeasured, toll.lead, 2 * FRAME);
  if (complete && replay.darks.length) {
    out.tailMeasured = replay.answerT - replay.darks.at(-1).t;
    out.tailOk = close(out.tailMeasured, toll.tail, FRAME);
  } else out.tailOk = !complete;
  out.ok = out.orderOk && out.countOk && out.gapOk && out.leadOk && out.tailOk;
  return out;
}

/** @param {any} log @param {any} def @param {any} [expectedCount] */
export function checkReplays(log, def, expectedCount) {
  const replays = buildReplays(log), rows = replays.map(r => checkReplay(r, def));
  const countOk = expectedCount == null || replays.length === expectedCount;
  return { ok: countOk && rows.length > 0 && rows.every(r => r.ok), count: replays.length, countOk, rows };
}

/** answer 단계 하나씩의 공명 기록. 끝은 불협(answer → toll), 완료(→ done), 또는 로그 끝(open)이다. */
export function buildAttempts(log) {
  const attempts = [];
  let current = null;
  for (const e of log || []) {
    if (e.kind === 'ctl' && e.to === 'answer') { current = { startT: e.t, resonated: [], end: 'open', endT: null }; attempts.push(current); }
    else if (e.kind === 'gate' && e.to === 'resonated' && current) current.resonated.push({ t: e.t, room: e.room });
    else if (e.kind === 'ctl' && current && e.from === 'answer') { current.end = e.to === 'done' ? 'done' : 'discord'; current.endT = e.t; current = null; }
  }
  return attempts;
}

/**
 * 공명 순서 검사. 모든 시도의 공명은 역순 정답의 앞부분이고, 완료한 시도는 전체 역순과 같다.
 * 각 공명은 직전 사건(answer 시작 또는 앞선 공명)으로부터 holdSeconds - 1/60 이상 뒤여야 한다.
 * 불협으로 끝난 시도 수는 기대 불협 수와 같아야 한다(expectedDiscords 가 null 이면 비교하지 않는다).
 */
/** @param {any} log @param {any} def @param {any} [expectedDiscords] */
export function checkAnswerOrder(log, def, expectedDiscords = null) {
  const answer = reverseOrder(def.tollOrder), attempts = buildAttempts(log);
  const rows = attempts.map(a => {
    const rooms = a.resonated.map(r => r.room);
    const prefixOk = same(rooms, answer.slice(0, rooms.length));
    const fullOk = a.end !== 'done' || same(rooms, answer);
    let prev = a.startT, holdOk = true;
    for (const r of a.resonated) { if (r.t - prev < def.holdSeconds - FRAME - EPS) holdOk = false; prev = r.t; }
    return { startT: a.startT, end: a.end, rooms, prefixOk, fullOk, holdOk };
  });
  const discordEnds = attempts.filter(a => a.end === 'discord').length;
  const discordCountOk = expectedDiscords == null || discordEnds === expectedDiscords;
  const finished = attempts.filter(a => a.end === 'done').length === 1 && attempts.at(-1)?.end === 'done';
  return { ok: attempts.length > 0 && rows.every(r => r.prefixOk && r.fullOk && r.holdOk) && discordCountOk && finished,
    answer, attempts: rows, discordEnds, discordCountOk, finished };
}

/**
 * 방 정화·봉인 검사. 세 종 방은 phase 'done' 시각 이전에 정화되지 않고, 봉인 해제는 done 이후다.
 * 한 스텝 안에서 여러 방이 정화되면 도구가 방 번호순으로 기록하므로 순서를 알 수 없다. 서로 다른 시각에 정화된 방끼리만 정답(역순) 순서를 요구한다.
 * clears: [{ t, room }], doneT/sealT: 게임 시간 또는 null.
 */
export function checkClears({ clears, gateRooms, tollOrder, doneT, sealT }) {
  const answer = reverseOrder(tollOrder);
  const gateClears = (clears || []).filter(c => gateRooms.includes(c.room));
  const beforeDone = Number.isFinite(doneT) ? gateClears.filter(c => c.t < doneT - EPS).map(c => c.room) : gateClears.map(c => c.room);
  const allCleared = gateRooms.every(room => gateClears.some(c => c.room === room));
  let orderOk = true, observable = false;
  for (const a of gateClears) for (const b of gateClears) {
    if (a.t < b.t - EPS) { observable = true; if (answer.indexOf(a.room) > answer.indexOf(b.room)) orderOk = false; }
  }
  const sealAfterDone = sealT == null ? null : Number.isFinite(doneT) && sealT >= doneT - EPS;
  const clearedOnce = gateRooms.every(room => gateClears.filter(c => c.room === room).length === 1);
  return { ok: Number.isFinite(doneT) && beforeDone.length === 0 && allCleared && orderOk && clearedOnce && sealAfterDone !== false,
    gateRoomsBeforeDone: beforeDone, allCleared, orderOk, orderObservable: observable, sealAfterDone, doneT: doneT ?? null, sealT: sealT ?? null, clearedOnce };
}

/**
 * 불협 사건 하나를 검사한다.
 * ev: { discords, discordsBefore, hpBefore, hpAfter, maxHp, def, reductions, prevHold, wrongRoom, expectedRoom, phaseAfter, progressAfter, gatesAfter }
 * 피해는 방어 경감을 적용한 기대값과 정확히 같아야 한다. 다른 경감(성역·보호막·물약 방어)이 켜져 있거나
 * 같은 스텝에 다른 피해가 섞이면 값이 달라지므로 합격하지 않는다(거짓 합격 대신 실패).
 */
export function checkDiscord(ev, def) {
  const drop = ev.hpBefore - ev.hpAfter, ratio = ev.maxHp > 0 ? drop / ev.maxHp : NaN;
  const reductions = ev.reductions && typeof ev.reductions === 'object' ? ev.reductions : null;
  const otherReduction = !reductions || Object.values(reductions).some(v => v !== 0);
  const expected = mitigatedDamage(ev.maxHp, def.discord.damage, ev.def);
  /** @type {any} */
  const out = {
    countStep: ev.discords === ev.discordsBefore + 1,
    damageOk: !otherReduction && close(drop, expected, 1e-6),
    heldLongEnough: Number.isFinite(ev.prevHold) && ev.prevHold >= def.holdSeconds - FRAME - EPS && ev.prevHold <= def.holdSeconds + EPS,
    wrongGate: ev.wrongRoom != null && ev.wrongRoom !== ev.expectedRoom,
    toll: ev.phaseAfter === 'toll', progressReset: ev.progressAfter === 0,
    allLit: Array.isArray(ev.gatesAfter) && ev.gatesAfter.length === def.gates.length && ev.gatesAfter.every(phase => phase === 'lit'),
    drop, ratio, expected, otherReduction,
  };
  out.ok = out.countStep && out.damageOk && out.heldLongEnough && out.wrongGate && out.toll && out.progressReset && out.allLit;
  return out;
}

/**
 * 로그의 불협 사건에 그 시점의 정답 방(expectedRoom)을 붙인다. 정답 방은 현재 시도에서 이미 공명한 수만큼 역순 정답을 센 값이다.
 */
export function discordEvents(log, def) {
  const answer = reverseOrder(def.tollOrder), out = [];
  let resonated = 0;
  for (const e of log || []) {
    if (e.kind === 'ctl' && e.to === 'answer') resonated = 0;
    else if (e.kind === 'gate' && e.to === 'resonated') resonated++;
    else if (e.kind === 'discord') out.push({ ...e, expectedRoom: answer[resonated] ?? null });
  }
  return out;
}

/**
 * 목표창 DOM 텍스트 검사. 불협이 guideAfter 회 미만인 answer 단계에서는 '다음 '도 정답 label 도 보이면 안 된다.
 * guideAfter 회 이상이면 '다음 ' + 정답 label 이 보여야 한다.
 */
export function checkGuideText(text, { discords, guideAfter, expectedLabel }) {
  const body = String(text ?? ''), next = body.includes('다음 '), label = body.includes(expectedLabel);
  const shouldGuide = discords >= guideAfter;
  const ok = shouldGuide ? body.includes('다음 ' + expectedLabel) : !next && !label;
  return { ok, shouldGuide, hasNext: next, hasLabel: label, text: body };
}

/** 결과 routeObjective 검사. rooms 는 이번 시도의 공명 순서(역순 정답)다. */
/** @param {any} ro @param {any} def @param {{ discords?: any, win?: boolean }} [options] */
export function checkResult(ro, def, { discords, win = true } = {}) {
  const gates = def.gates.length, answer = reverseOrder(def.tollOrder);
  /** @type {any} */
  const out = { id: ro?.id === def.id, label: ro?.label === '종문 역순 공명', complete: ro?.complete === true && win === true, progress: ro?.progress === gates,
    target: ro?.target === gates, rooms: same(ro?.rooms, answer), discords: discords == null || ro?.discords === discords,
    tolls: discords == null || ro?.tolls === discords + 1 };
  out.ok = Object.values(out).every(Boolean);
  return out;
}

/**
 * 결과 화면 줄: '종문 역순 공명 n/3 · 불협 k회'(+ ' · 반격 창 w회')(+ ' · 완료')가 정확히 한 번 있고 일반 줄과 중복되지 않는다.
 * 반격 창 횟수(counterWindows, BUNDLE-05)는 숫자일 때만 붙는다. 기준선 빌드의 결과에는 이 필드가 없다.
 */
export function checkResultLine(text, ro) {
  const counter = typeof ro?.counterWindows === 'number' ? ' · 반격 창 ' + ro.counterWindows + '회' : '';
  const line = '종문 역순 공명 ' + ro?.progress + '/' + ro?.target + ' · 불협 ' + ro?.discords + '회' + counter + (ro?.complete ? ' · 완료' : '');
  const body = String(text ?? ''), occurrences = body.split('종문 역순 공명').length - 1;
  return { ok: body.includes(line) && occurrences === 1 && (ro?.complete ? true : !body.includes(line + ' · 완료')), line, occurrences };
}

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** 스텝 ms 분포(p50/p95/max)와 limit(기본 50ms) 초과 개수. */
export function stepStats(values, limit = 50) {
  const n = values.length;
  return { n, p50: percentile(values, .5), p95: percentile(values, .95), max: n ? Math.max(...values) : null, over: values.filter(v => v > limit).length };
}

/**
 * 후보와 기준선의 draw call 표본({ label, calls, room })을 비교한다(리뷰 b04-review P2).
 * 'enter:roomN' 은 기준선의 같은 라벨과, 'firstDark' 는 같은 후보 실행에서 그 순간 영웅이 있던 방의 'enter:roomN' 과 비교한다.
 * 짝이 없는 표본은 실패다(기준선 최댓값과 비교하는 거짓 합격을 막는다). 모든 증가량이 limit 이하여야 한다.
 */
export function drawCallIncrease(candidate, baseline, limit = 12) {
  const rows = candidate.map(row => {
    const pair = row.label === 'firstDark'
      ? candidate.find(c => c.label === 'enter:room' + row.room)
      : baseline.find(b => b.label === row.label);
    const reference = pair ? pair.calls : null;
    return { label: row.label, calls: row.calls, reference, against: pair ? (row.label === 'firstDark' ? 'candidate ' : 'baseline ') + pair.label : null,
      increase: pair ? row.calls - reference : null, matched: !!pair };
  });
  const max = rows.reduce((m, row) => row.matched ? Math.max(m, row.increase) : m, -Infinity);
  return { ok: rows.length > 0 && baseline.length > 0 && rows.every(row => row.matched) && max <= limit, max: Number.isFinite(max) ? max : null, limit, rows };
}

/**
 * PLAN 5절 4번 기준선 비교. 후보·기준선 auto 실행 요약에서 완주 시간 비(≤ timeRatio), draw call 증가(≤ drawLimit)를 판정하고,
 * 50ms 초과 스텝은 전체 개수와 함께 종문 구간(toll·answer 단계)만 따로 센다. 50ms 절대 검사는 각 실행 report 의 검사가 그대로 판정한다.
 * cand/base: { time, samples, slow, stepMs?, renderMs? }. 개수는 전체 스텝 ms 배열이 있으면 그것으로 센다(옛 report 의 slow 는 20개로 잘려 있다).
 */
export function compareToBaseline(cand, base, { timeRatio = 2, drawLimit = 12 } = {}) {
  const ratio = cand?.time > 0 && base?.time > 0 ? cand.time / base.time : null;
  const draw = drawCallIncrease(cand?.samples || [], base?.samples || [], drawLimit);
  const featureSlow = (cand?.slow || []).filter(s => s.phase === 'toll' || s.phase === 'answer');
  const over = run => Array.isArray(run?.stepMs) || Array.isArray(run?.renderMs)
    ? [...(run.stepMs || []), ...(run.renderMs || [])].filter(ms => ms > 50).length : (run?.slow || []).length;
  return { ok: ratio !== null && ratio <= timeRatio && draw.ok, time: { cand: cand?.time ?? null, base: base?.time ?? null, ratio, limit: timeRatio },
    draw, over50: { cand: over(cand), base: over(base), featureWindow: featureSlow.length, featureSlow } };
}

/** 첫 소등(wake → toll) 전에 모든 gate 가 lit 이 된 사건이 있었는지. */
function litBeforeToll(log, gateRooms) {
  const lit = new Set();
  for (const e of log || []) {
    if (e.kind === 'gate' && e.to === 'lit') lit.add(e.room);
    if (e.kind === 'ctl' && e.from === 'wake' && e.to === 'toll') return gateRooms.every(room => lit.has(room));
  }
  return false;
}

/**
 * 한 번의 완주 관측을 모두 판정한다.
 * obs: { log, clears, sealT, result: routeObjective, resultText, expectedDiscords }
 * 반환 acceptance 의 값이 전부 true 여야 한다.
 */
export function analyzeBells(obs, def) {
  const { log, clears, sealT, result, resultText, expectedDiscords } = obs;
  const timeline = checkPhaseTimeline(log);
  const doneEvent = ctlEvents(log).find(e => e.to === 'done');
  const replays = checkReplays(log, def, expectedDiscords == null ? null : expectedDiscords + 1);
  const answers = checkAnswerOrder(log, def, expectedDiscords);
  const gateRooms = def.gates.map(g => g.roomId);
  const clearCheck = checkClears({ clears, gateRooms, tollOrder: def.tollOrder, doneT: doneEvent?.t ?? null, sealT });
  const resultCheck = checkResult(result, def, { discords: expectedDiscords });
  const lineCheck = checkResultLine(resultText, result);
  const acceptance = { phaseOrderValid: timeline.ok, reachedDone: !!doneEvent, litAllBeforeToll: litBeforeToll(log, gateRooms), tollSequence: replays.ok,
    reverseAnswer: answers.ok, clearedOnlyAfterDone: clearCheck.ok, resultObjective: resultCheck.ok, resultLine: lineCheck.ok };
  return { acceptance, ok: Object.values(acceptance).every(Boolean), timeline, replays, answers, clears: clearCheck, result: resultCheck, resultLine: lineCheck };
}
// ---------- BUNDLE-05 합창 장막(counter) 판정 ----------
// 입력은 tools/bellfall-deep-qa.mjs 의 보스 관측 행(trace)이다. 보스가 처음 나타난 스텝부터 처치 몇 스텝 뒤까지 app.step 한 번(고정 1/60)마다 한 행이다.
// { n, t, hp, alive, spn, seq, cseq, st, sp, plan, age, last, cs, wl, wins, brk, vh, oh, vd, od, mul }
//   n 스텝 번호, t 게임 시각, hp 보스 hp, alive 생존, spn 등장 연출 중, seq boss.attackSequence, cseq boss.completedAttackSequence,
//   st boss.state, sp boss.special, plan signatures.plan?.key, age signatures.age, last signatures.plan?.lastStrike(age·last 는 진단용이고 판정에 쓰지 않는다),
//   cs counter.state(counter 없는 빌드는 null),
//   wl windowLeft, wins windows, brk broken, vh/oh veiledHits/openHits, vd/od veiledDamage/openDamage, mul damageMul().
// 컨트롤러는 enemies update 보다 앞서 돌기 때문에 관측(스텝 끝)보다 1스텝 늦게 열리는 것이 정상이다. 그래서 "열림 ≤ 트리거 + 1스텝"을 허용한다.

/**
 * def.signature 의 마지막 고리가 실제로 터진 행인지(PLAN 3.1 열림 조건). BossSignatures 가 마지막 고리를 터뜨리는 순간
 * boss.completedAttackSequence 를 attackSequence 와 같게 쓰므로, 시그니처 시전 중(sp)이면서 cseq === seq 인 행부터가 트리거다.
 * age·lastStrike 비교는 쓰지 않는다(1/60 격자 오차로 고리가 터지기 전에 참이 될 수 있다). seq 0 은 아직 조종이 없는 상태다.
 */
export const isTrigger = (row, def) => !!row && row.sp === def.signature && row.seq > 0 && row.cseq === row.seq;

/** counter.state 가 open 인 연속 구간. closedBy 는 구간 바로 다음 행의 counter.state, 관측이 거기서 끝나면 null 이다. */
export function openRuns(trace) {
  const runs = [];
  let run = null;
  (trace || []).forEach((row, i) => {
    if (row.cs === 'open') {
      if (!run) { run = { startIdx: i, endIdx: i, closedBy: null }; runs.push(run); } else run.endIdx = i;
    } else if (run) { run.closedBy = row.cs ?? null; run = null; }
  });
  return runs;
}

/**
 * 반격 창마다 판정한다: 열림 시점(같은 attackSequence 의 def.signature 에서 cseq === seq 가 처음 된 트리거 행부터 1스텝 이내, 그 전에는 열리지 않음),
 * 길이(def.window ± 1/60, 처치로 끝난 창은 truncated 로 길이를 보지 않는다), 창 동안 attackSequence 불변, windowLeft 단조 감소, 한 attackSequence 에 창 하나.
 */
export function checkWindows(trace, def) {
  const rows = trace || [], runs = openRuns(rows), seen = new Set(), windows = [];
  for (const run of runs) {
    const open = rows[run.startIdx], reasons = [];
    // 열림을 이끈 트리거 행: 같은 attackSequence 안에서 가장 먼저 cseq === seq 가 된 행(열린 행 자신 포함, 거슬러 올라가며 찾는다).
    // 트리거 전에 열렸다면(cseq !== seq 인데 open) 트리거가 없어 no-trigger 로 실패한다.
    let triggerIdx = -1;
    for (let i = run.startIdx; i >= 0 && rows[i].seq === open.seq; i--) if (isTrigger(rows[i], def)) triggerIdx = i;
    let cause = null;
    if (triggerIdx < 0) {
      const ref = rows[Math.max(0, run.startIdx - 1)];
      cause = ref.sp !== def.signature ? 'wrong-signature' : 'before-last-strike';
      reasons.push('no-trigger');
    } else if (run.startIdx - triggerIdx > 1) reasons.push('late-open');
    if (seen.has(open.seq)) reasons.push('duplicate-sequence');
    seen.add(open.seq);
    const span = rows.slice(run.startIdx, run.endIdx + 1);
    const seqStable = span.every(r => r.seq === open.seq);
    let monotonic = true;
    for (let i = 1; i < span.length; i++) if (!(span[i].wl <= span[i - 1].wl + EPS)) monotonic = false;
    const startOk = Number.isFinite(open.wl) && open.wl <= def.window + EPS && open.wl >= def.window - FRAME - EPS;
    const after = rows[run.endIdx + 1] ?? null;
    let truncated = false;
    if (!after) truncated = true;
    else if (after.cs === 'veiled') truncated = false;
    else if (!after.alive) truncated = true; // 보스 처치로 끝난 창
    else reasons.push('closed-without-expiry');
    const length = after ? after.t - open.t : null;
    const lengthOk = truncated ? null : close(length, def.window, FRAME);
    const ok = reasons.length === 0 && seqStable && monotonic && startOk && lengthOk !== false;
    windows.push({ index: windows.length, startIdx: run.startIdx, t: open.t, seq: open.seq, triggerIdx, delaySteps: triggerIdx < 0 ? null : run.startIdx - triggerIdx,
      cause, reasons, seqStable, monotonic, startWindowLeft: open.wl, length, truncated, lengthOk, openRows: span.length, ok });
  }
  return windows;
}

/** 트리거 뒤 1스텝을 더 보고도 한 번도 열지 않은 attackSequence 목록(끊김이 아니라 컨트롤러 누락). */
export function missedOpens(trace, def) {
  const rows = trace || [], opened = new Set(openRuns(rows).map(r => rows[r.startIdx].seq)), missed = [], seen = new Set();
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.cs === null || a.cs === undefined || a.cs === 'ended' || !a.alive || !b.alive || !isTrigger(a, def) || !isTrigger(b, def) || b.seq !== a.seq) continue;
    if (a.cs === 'open' || b.cs === 'open' || opened.has(a.seq) || seen.has(a.seq)) continue;
    seen.add(a.seq);
    missed.push({ idx: i, t: a.t, seq: a.seq, counterState: b.cs });
  }
  return missed;
}

/**
 * 카운터 피해 회계와 보스 hp 의 일치 검사(리뷰 P3-1). counter 가 veiled/open 인 연속 두 행 사이에서 보스 hp 감소량이 (vd + od) 증가량과 같아야 한다
 * (상대 오차 1e-6 또는 절대 1e-3). 처치 행(alive 가 거짓이거나 hp 가 0 이하로 잘린 행)으로 들어가는 구간은 마지막 타격이 hp 0 으로 잘리므로 제외한다.
 * 장막을 우회해 hp 를 깎는 경로가 있으면 감소량이 회계보다 커져서 실패한다. 회복으로 hp 가 늘어도 회계와 어긋나므로 실패한다.
 */
export function checkHpMatchesCounter(trace) {
  const rows = trace || [], violations = [];
  let pairs = 0, skipped = 0;
  const live = r => r.cs === 'veiled' || r.cs === 'open';
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (!live(a) || !live(b)) continue;
    if (!a.alive || !b.alive || !(b.hp > 0)) { skipped++; continue; }
    pairs++;
    const dropped = a.hp - b.hp, accounted = (b.vd + b.od) - (a.vd + a.od);
    if (!Number.isFinite(dropped) || !Number.isFinite(accounted) || Math.abs(dropped - accounted) > Math.max(1e-3, 1e-6 * Math.max(Math.abs(dropped), Math.abs(accounted))))
      violations.push({ idx: i, t: b.t, state: b.cs, dropped, accounted });
  }
  return { ok: violations.length === 0, pairs, skipped, violations: violations.slice(0, 20), count: violations.length };
}

/** 상태별 피해 배수: veiled = veil, open = open, 그 밖(idle·ended) = 1. */
export function checkDamageMultiplier(trace, def) {
  const violations = [];
  (trace || []).forEach((row, i) => {
    if (row.cs === null || row.cs === undefined) return;
    const want = row.cs === 'open' ? def.open : row.cs === 'veiled' ? def.veil : 1;
    if (!close(row.mul, want, 1e-9)) violations.push({ idx: i, t: row.t, state: row.cs, mul: row.mul, want });
  });
  return { ok: violations.length === 0, violations: violations.slice(0, 20), count: violations.length };
}

/** windows 는 스텝마다 최대 +1, 맞은 횟수·피해 합은 줄어들지 않는다. broken 도 줄지 않는다. 마지막 행 값을 돌려준다. */
export function checkCounterStats(trace) {
  const rows = (trace || []).filter(r => r.cs !== null && r.cs !== undefined), violations = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (!(b.wins >= a.wins && b.wins - a.wins <= 1)) violations.push({ idx: i, field: 'wins', from: a.wins, to: b.wins });
    for (const field of ['brk', 'vh', 'oh', 'vd', 'od']) if (!(b[field] >= a[field] - EPS)) violations.push({ idx: i, field, from: a[field], to: b[field] });
  }
  const last = rows.at(-1) ?? null;
  return { ok: violations.length === 0, violations: violations.slice(0, 20), windows: last?.wins ?? null, broken: last?.brk ?? null,
    veiledHits: last?.vh ?? null, openHits: last?.oh ?? null, veiledDamage: last?.vd ?? null, openDamage: last?.od ?? null };
}

/** 보스 구간 요약: 등장·등장 연출 끝·처치 시각(게임 시간)과 보스전 길이. 기준선(counter 없는 빌드)에서도 같은 값이 나온다. */
export function summarizeBoss(trace) {
  const rows = trace || [];
  if (!rows.length) return { observed: false, appearT: null, readyT: null, defeatT: null, fightSeconds: null, rows: 0 };
  const defeat = rows.findIndex(r => !r.alive), ready = rows.find(r => !r.spn);
  const defeatT = defeat >= 0 ? rows[defeat].t : null;
  return { observed: true, defeated: defeat >= 0, appearT: rows[0].t, readyT: ready ? ready.t : null, defeatT,
    fightSeconds: defeatT === null ? null : defeatT - rows[0].t, rows: rows.length, defeatIdx: defeat,
    hpStart: rows[0].hp, hpEnd: rows.at(-1).hp, sequences: rows.reduce((m, r) => Math.max(m, r.seq || 0), 0) };
}

/**
 * 보스 관측 전체 판정(PLAN 5절·QA 도구 계약).
 * obs: { trace, result: 결과 routeObjective, resultText: 결과 줄 DOM 텍스트, finalCounter: 전투 종료 뒤 읽은 { state } 또는 null }
 * acceptance 의 값이 전부 true 여야 한다. counter 정의(def)가 있는 후보 빌드에서만 부른다.
 */
export function analyzeCounter(obs, def) {
  const trace = obs.trace || [], summary = summarizeBoss(trace), windows = checkWindows(trace, def), missed = missedOpens(trace, def);
  const multiplier = checkDamageMultiplier(trace, def), stats = checkCounterStats(trace), hpMatch = checkHpMatchesCounter(trace);
  const defeatIdx = summary.defeatIdx ?? -1, post = defeatIdx >= 0 ? trace.slice(defeatIdx + 1) : [];
  const endedOk = defeatIdx >= 0 && post.length >= 1 && post.every(r => r.cs === 'ended') && (obs.finalCounter == null || obs.finalCounter.state === 'ended');
  const bad = reason => windows.filter(w => w.reasons.includes(reason));
  const observedWindows = windows.length, ro = obs.result, body = String(obs.resultText ?? '');
  const lineMatches = body.match(/반격 창 \d+회/g) || [];
  const acceptance = {
    bossObserved: summary.observed && summary.defeated === true,
    windowCount: observedWindows >= 1,
    windowsConsistent: stats.windows === observedWindows,
    noEarlyOpen: bad('no-trigger').length === 0,
    openTiming: bad('late-open').length === 0 && bad('duplicate-sequence').length === 0,
    windowLength: windows.every(w => w.monotonic && w.reasons.indexOf('closed-without-expiry') < 0 && w.lengthOk !== false && (Number.isFinite(w.startWindowLeft) && w.startWindowLeft <= def.window + EPS && w.startWindowLeft >= def.window - FRAME - EPS)),
    noNewAttack: windows.every(w => w.seqStable),
    noMissedOpen: missed.length === 0,
    damageMultiplier: multiplier.ok,
    counterStats: stats.ok,
    // 보스 처치 때는 카운터가 broken 을 세지 않고 ended 가 되므로 예외 없이 0 이어야 한다. 조종이 끊기면 마지막 울림이 온다는 약속이 깨진 것이다.
    noBroken: stats.broken === 0,
    hpMatchesCounter: hpMatch.ok,
    endedAfterDefeat: endedOk,
    resultWindows: Number.isInteger(ro?.counterWindows) && ro.counterWindows === observedWindows,
    resultLine: lineMatches.length === 1 && lineMatches[0] === '반격 창 ' + observedWindows + '회',
  };
  return { acceptance, ok: Object.values(acceptance).every(Boolean), summary, windows, observedWindows, fullWindows: windows.filter(w => !w.truncated).length,
    missed, multiplier, stats, hpMatch, post: { rows: post.length, states: [...new Set(post.map(r => r.cs))] }, resultWindows: ro?.counterWindows ?? null, resultLineMatches: lineMatches };
}

/**
 * 목표창 DOM 검사(PLAN 3.2). read: { dom: { text }, counter: { state, windowLeft, windowTotal } }는 같은 호출에서 읽은 값이다.
 * veiled: '합창 장막' + 문구 + 받는 피해 (1-veil)% 감소. open: '합창 장막' + '반격 창 n.n초'(올림 0.1초, 10Hz 갱신 지연 허용) + 받는 피해 open%.
 */
export function checkCounterObjective(read, def) {
  const body = String(read?.dom?.text ?? ''), state = read?.counter?.state ?? null;
  const veilPct = Math.round((1 - def.veil) * 100), openPct = Math.round(def.open * 100);
  /** @type {any} */
  const out = { state, hasTitle: body.includes('합창 장막') };
  if (state === 'veiled') {
    out.veilText = body.includes('마지막 울림 직후에만 장막이 걷힘');
    out.damageText = body.includes('받는 피해 ' + veilPct + '% 감소');
    out.noWindowText = !/반격 창 \d/.test(body);
    out.ok = out.hasTitle && out.veilText && out.damageText && out.noWindowText;
  } else if (state === 'open') {
    const m = /반격 창 (\d+\.\d)초/.exec(body), seconds = m ? Number(m[1]) : NaN, left = read.counter.windowLeft, total = read.counter.windowTotal;
    out.seconds = Number.isFinite(seconds) ? seconds : null;
    out.windowText = !!m;
    // 표시는 올림이고 10Hz 로 갱신되므로 현재 windowLeft 보다 작을 수 없고(미세 오차 제외), 갱신 지연 한 틱 + 올림 0.1 이상 크지 않다.
    out.secondsOk = Number.isFinite(seconds) && seconds >= left - .05 && seconds <= left + .35 && seconds <= Math.ceil(total * 10) / 10 + 1e-6;
    out.damageText = body.includes('받는 피해 ' + openPct + '%');
    out.ok = out.hasTitle && out.windowText && out.secondsOk && out.damageText;
  } else out.ok = false;
  return out;
}

/**
 * 반격 창 중 일시정지 검사. before: 창이 열린 직후, paused: 일시정지 직후, still: 120스텝+실시간 1초 뒤(여전히 일시정지), resumed: 재개 뒤 steps 스텝.
 * 각 값은 { elapsed, counter: { state, windowLeft, windows }, boss: { seq } }. 정지 중 값은 정확히 같아야 한다.
 * 재개 뒤 windowLeft 는 그 사이 흐른 게임 시간(elapsed 차)만큼 줄어야 한다. 처치·치명타 슬로모션이 dt 를 줄일 수 있으므로 고정 steps × 1/60 이 아니라
 * elapsed 차와 비교하고, elapsed 차가 0 보다 크고 steps × 1/60 + 2/60 을 넘지 않는지만 본다.
*/
export function checkCounterPause({ before, paused, still, resumed, steps }) {
  const snap = x => [x.elapsed, x.counter?.state, x.counter?.windowLeft, x.counter?.windows, x.boss?.seq];
  const frozen = JSON.stringify(snap(paused)) === JSON.stringify(snap(still)) && JSON.stringify(snap(before)) === JSON.stringify(snap(paused));
  const decreased = before.counter?.windowLeft - resumed.counter?.windowLeft;
  const elapsedDelta = resumed.elapsed - still.elapsed;
  const resumedOpen = resumed.counter?.state === 'open';
  return { ok: frozen && before.counter?.state === 'open' && paused.counter?.state === 'open' && still.counter?.state === 'open'
      && resumedOpen && elapsedDelta > 0 && elapsedDelta <= steps * FRAME + 2 * FRAME + EPS && close(decreased, elapsedDelta, 1e-6) && resumed.boss?.seq === before.boss?.seq,
    frozen, openBefore: before.counter?.state === 'open', resumedOpen, decreased, elapsedDelta, maxElapsed: steps * FRAME + 2 * FRAME, sequenceKept: resumed.boss?.seq === before.boss?.seq };
}

/**
 * 기준선 비교(PLAN 5절 5번). 후보·기준선 auto 실행 요약 { fight, time, samples, bossOver50 }:
 * 보스전 시간 비 ≤ fightRatio, 완주 시간 비 ≤ timeRatio, 보스방 첫 진입 draw call('bossEnter') 증가 ≤ drawLimit(짝이 없으면 실패),
 * 보스 구간 50ms 초과 수 ≤ 기준선 + slowExtra.
 */
export function compareBoss(cand, base, { fightRatio = 2, timeRatio = 2, drawLimit = 3, slowExtra = 2 } = {}) {
  const ratioOf = (a, b, limit) => { const ratio = a > 0 && b > 0 ? a / b : null; return { cand: a ?? null, base: b ?? null, ratio, limit, ok: ratio !== null && ratio <= limit }; };
  const fight = ratioOf(cand?.fight, base?.fight, fightRatio), time = ratioOf(cand?.time, base?.time, timeRatio);
  const only = run => (run?.samples || []).filter(s => s.label === 'bossEnter');
  const draw = drawCallIncrease(only(cand), only(base), drawLimit);
  const c = cand?.bossOver50, b = base?.bossOver50;
  const slow = { cand: c ?? null, base: b ?? null, limit: Number.isFinite(b) ? b + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(b) && c <= b + slowExtra };
  return { ok: fight.ok && time.ok && draw.ok && slow.ok, fight, time, draw, slow };
}
