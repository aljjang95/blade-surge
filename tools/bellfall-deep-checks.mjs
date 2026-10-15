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

/** 결과 화면 줄: '종문 역순 공명 n/3 · 불협 k회'(+ ' · 완료')가 정확히 한 번 있고 일반 줄과 중복되지 않는다. */
export function checkResultLine(text, ro) {
  const line = '종문 역순 공명 ' + ro?.progress + '/' + ro?.target + ' · 불협 ' + ro?.discords + '회' + (ro?.complete ? ' · 완료' : '');
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
 * cand/base: { time, samples, slow }
 */
export function compareToBaseline(cand, base, { timeRatio = 2, drawLimit = 12 } = {}) {
  const ratio = cand?.time > 0 && base?.time > 0 ? cand.time / base.time : null;
  const draw = drawCallIncrease(cand?.samples || [], base?.samples || [], drawLimit);
  const featureSlow = (cand?.slow || []).filter(s => s.phase === 'toll' || s.phase === 'answer');
  return { ok: ratio !== null && ratio <= timeRatio && draw.ok, time: { cand: cand?.time ?? null, base: base?.time ?? null, ratio, limit: timeRatio },
    draw, over50: { cand: (cand?.slow || []).length, base: (base?.slow || []).length, featureWindow: featureSlow.length, featureSlow } };
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
