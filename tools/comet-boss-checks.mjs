// 혜성 기사단장 보스전 푸른 궤도선(BUNDLE-06) QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/comet-boss-qa.mjs 의 페이지 프로브가 app.step 한 번마다 남긴 보스 구간 관측 행(게임 시간)과 대상 프로젝트의 데이터 정의(ROUTE_OBJECTIVES.comet_*.boss)다.
// 시간·반지름·간격 값은 모두 인자(def)로 받는다. 이 파일에는 게임 수치를 박지 않는다.
//
// 관측 행(보스가 처음 나타난 스텝부터 처치 뒤 몇 스텝까지, 스텝 하나에 행 하나):
//   n 스텝 번호, t 게임 시각, hp/alive/spn(spawning)/st(state)/sp(special)/seq(attackSequence)/cseq(completedAttackSequence) 보스,
//   os/ok/wl/wt/sk/ck/ht/asw = bossOrbit.state/kind/warnLeft/warnTotal/strikes/centerStrikes/hits/attackStartsDuringWarn (기준선 빌드는 null),
//   hr 영웅의 궤도 중심 기준 반지름, hhp/hmax 영웅 HP, inb 영웅이 보스방 안인지, inv 영웅 무적 시간이 남았는지(hurt 가 false 를 돌려줄 수 있는 근거),
//   au AUTO 여부, ah 공격 입력 유지 여부, ps 영웅 state, dom 목표창 문구(warn 중 표본에만).

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 모든 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-9;
/** 구역 경계에서 이만큼 안쪽·바깥쪽은 영웅 위치 관측 시점 차이로 판정이 갈릴 수 있어 모호로 표시하고 실패로 세지 않는다. */
export const AMBIGUOUS = .05;
/** 목표창 문구. warn 중 kind 에 맞는 문구만 보여야 한다. */
export const OBJECTIVE_TITLE = '푸른 궤도선';
export const OBJECTIVE_PHRASE = Object.freeze({ outer: '푸른 선 안쪽으로', center: '푸른 선 밖으로' });
/** 목표창은 10Hz 로 갱신되므로 warn 시작 뒤 이 시간이 지난 행에서만 문구를 읽는다. */
export const OBJECTIVE_SETTLE = .25;
/** 플레이어 동작 state. orbit 프로필의 키보드 구간에서는 시작 직후 잔여 동작을 빼고 이 state 가 나오면 안 된다. */
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);

const num = value => Number.isFinite(value) ? value : null;
const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol + EPS;

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
export function stepStats(values, limit = 50) {
  const n = values.length;
  return { n, p50: percentile(values, .5), p95: percentile(values, .95), max: n ? Math.max(...values) : null, over: values.filter(v => v > limit).length };
}

/**
 * 영웅 반지름 r 이 kind 의 피격 구역 안인지. outer 는 outerMin ≤ r ≤ outerMax, center 는 r ≤ safe 다.
 * 경계(outerMin·outerMax·safe)에서 AMBIGUOUS 이내면 ambiguous 로 표시한다.
 */
export function zoneStatus(kind, r, def) {
  if (!Number.isFinite(r) || (kind !== 'outer' && kind !== 'center')) return { inside: null, ambiguous: false, margin: null, valid: false };
  if (kind === 'outer') {
    const margin = Math.min(Math.abs(r - def.outerMin), Math.abs(r - def.outerMax));
    return { inside: r >= def.outerMin - EPS && r <= def.outerMax + EPS, ambiguous: margin <= AMBIGUOUS + EPS, margin, valid: true };
  }
  const margin = Math.abs(r - def.safe);
  return { inside: r <= def.safe + EPS, ambiguous: margin <= AMBIGUOUS + EPS, margin, valid: true };
}

/** warn 연속 구간. ordinal 은 warn 시작 순서(1부터)이고 취소된 warn 도 센다(컨트롤러의 n++ 와 같다). */
export function warnRuns(rows) {
  const runs = [];
  let open = null;
  rows.forEach((row, i) => {
    if (row.os === 'warn') {
      if (!open) { open = { start: i, last: i }; runs.push(open); } else open.last = i;
    } else open = null;
  });
  return runs.map((run, k) => ({ ...run, ordinal: k + 1 }));
}

/** 보스 구간 요약. 처치 행은 alive 가 처음 false 가 된 행이다. */
export function summarizeBoss(trace) {
  const rows = trace || [];
  if (!rows.length) return { observed: false, defeated: false, appearT: null, readyT: null, defeatT: null, fightSeconds: null, rows: 0, defeatIdx: -1 };
  const defeat = rows.findIndex(r => !r.alive), ready = rows.find(r => !r.spn);
  const defeatT = defeat >= 0 ? rows[defeat].t : null;
  return { observed: true, defeated: defeat >= 0, appearT: rows[0].t, readyT: ready ? ready.t : null, defeatT,
    fightSeconds: defeatT === null ? null : defeatT - rows[0].t, rows: rows.length, defeatIdx: defeat,
    hpStart: rows[0].hp, hpEnd: rows.at(-1).hp, sequences: rows.reduce((m, r) => Math.max(m, r.seq || 0), 0) };
}

const ORDER = Object.freeze({ idle: ['idle', 'armed', 'ended'], armed: ['armed', 'warn', 'ended'], warn: ['warn', 'armed', 'ended'], ended: ['ended'] });

/** state 전이표(idle → armed ⇄ warn → ended)와 getter 규약(kind 는 warn 에서만, warnLeft 는 warn 밖 0, 예고는 warning 이하)을 검사한다. */
export function checkStateMachine(rows, def) {
  const violations = [];
  rows.forEach((row, i) => {
    if (!ORDER[row.os]) { violations.push({ i, t: row.t, reason: 'unknown-state', state: row.os }); return; }
    const prev = rows[i - 1];
    if (prev && ORDER[prev.os] && !ORDER[prev.os].includes(row.os)) violations.push({ i, t: row.t, reason: 'illegal-transition', from: prev.os, to: row.os });
    if (row.os === 'warn') {
      if (row.ok !== 'outer' && row.ok !== 'center') violations.push({ i, t: row.t, reason: 'warn-without-kind', kind: row.ok ?? null });
      if (!(row.wl > 0) || row.wl > def.warning + EPS) violations.push({ i, t: row.t, reason: 'warn-left-range', warnLeft: row.wl });
      if (prev?.os === 'warn' && prev.ok === row.ok && !(row.wl <= prev.wl + EPS)) violations.push({ i, t: row.t, reason: 'warn-left-not-decreasing', from: prev.wl, to: row.wl });
      if (prev?.os === 'warn' && prev.ok !== row.ok) violations.push({ i, t: row.t, reason: 'kind-changed-in-warn', from: prev.ok, to: row.ok });
      if (close(row.wt, def.warning, EPS) === false) violations.push({ i, t: row.t, reason: 'warn-total', warnTotal: row.wt ?? null });
    } else {
      if ((row.ok ?? null) !== null) violations.push({ i, t: row.t, reason: 'kind-outside-warn', state: row.os, kind: row.ok });
      if (Number.isFinite(row.wl) && row.wl > EPS) violations.push({ i, t: row.t, reason: 'warn-left-outside-warn', state: row.os, warnLeft: row.wl });
    }
    if (prev && (row.sk < prev.sk || row.ck < prev.ck || row.ht < prev.ht || row.asw < prev.asw)) violations.push({ i, t: row.t, reason: 'counter-decreased' });
  });
  return { ok: violations.length === 0, violations };
}

/**
 * 낙하 이벤트(strikes 가 증가한 스텝)마다 직전 warn 을 찾아 판정한다.
 * (a) warn 길이 = warning ± 1/60, (b) kind = ordinal % centerEvery === 0 ? center : outer,
 * (c) 피격 여부(hits 증가)가 낙하 스텝 영웅 반지름의 구역 판정과 일치(경계 ±0.05 는 모호), (d) warn 동안 attackSequence 증가 0·attackStartsDuringWarn 0.
 */
export function analyzeStrikes(rows, def) {
  const runs = warnRuns(rows), warns = [], strikes = [], violations = [], strikeRows = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].sk > rows[i - 1].sk) {
    strikeRows.push(i);
    const prevWarn = rows[i - 1].os === 'warn';
    if (!prevWarn) violations.push({ i, t: rows[i].t, reason: 'strike-without-warn', state: rows[i - 1].os });
    if (rows[i].sk - rows[i - 1].sk !== 1) violations.push({ i, t: rows[i].t, reason: 'multi-strike', delta: rows[i].sk - rows[i - 1].sk });
  }
  if (rows[0] && rows[0].sk > 0) violations.push({ i: 0, t: rows[0].t, reason: 'strikes-before-observation', strikes: rows[0].sk });
  for (const run of runs) {
    const start = rows[run.start], end = rows[run.last], next = rows[run.last + 1] ?? null, before = rows[run.start - 1] ?? null;
    const outcome = !next ? 'open' : next.sk > end.sk ? 'strike' : 'cancelled';
    const expectedKind = run.ordinal % def.centerEvery === 0 ? 'center' : 'outer';
    const baseSeq = before ? before.seq : start.seq;
    const seqSteady = rows.slice(run.start, run.last + 1).every(r => r.seq === baseSeq);
    const warn = { ordinal: run.ordinal, startIdx: run.start, startT: start.t, kind: start.ok, expectedKind, kindOk: start.ok === expectedKind,
      startWarnLeft: start.wl, startWarnLeftOk: Number.isFinite(start.wl) && start.wl <= def.warning + EPS && start.wl >= def.warning - FRAME - EPS,
      seqSteady, startedDuringAttack: before ? before.st === 'attack' : false, aswDuring: rows.slice(run.start, run.last + 1).reduce((m, r) => Math.max(m, r.asw || 0), 0),
      bossState: start.st, outcome, rows: run.last - run.start + 1 };
    if (outcome === 'strike') {
      const row = next;
      warn.endT = row.t; warn.duration = row.t - start.t; warn.durationOk = close(warn.duration, def.warning, FRAME);
      const dHits = row.ht - end.ht, dCenter = row.ck - end.ck, zone = zoneStatus(start.ok, row.hr, def);
      const heroAlive = end.hhp > 0, expectedHit = !!(heroAlive && zone.inside);
      const actualHit = dHits >= 1, imm = !!(end.inv || row.inv);
      let verdict;
      if (zone.ambiguous) verdict = 'ambiguous';
      else if (!zone.valid || dHits > 1) verdict = 'fail';
      else if (actualHit === expectedHit) verdict = 'ok';
      else if (expectedHit && !actualHit && imm) verdict = 'excused';
      else verdict = 'fail';
      const strike = { n: row.sk, t: row.t, idx: run.last + 1, ordinal: run.ordinal, kind: start.ok, r: num(row.hr), zoneInside: zone.inside, margin: zone.margin, heroAlive,
        expectedHit, hit: actualHit, hitDelta: dHits, centerDelta: dCenter, immune: imm, inBossRoom: row.inb ?? null, verdict };
      warn.strike = strike; strikes.push(strike);
    }
    warns.push(warn);
  }
  return { runs, warns, strikes, strikeRows, violations };
}

/** 목표창 표본(warn 중 dom 이 있는 행)이 그 warn 의 kind 에 맞는 문구인지. 맞는 표본이 warn 마다 1개 이상 있어야 한다(취소되지 않은 warn). */
export function checkObjectiveSamples(rows, warns) {
  const bad = [], perWarn = [];
  for (const warn of warns) {
    if (warn.outcome === 'open') continue;
    const last = rows.findIndex((r, i) => i >= warn.startIdx && r.os !== 'warn');
    const end = last < 0 ? rows.length : last;
    const samples = rows.slice(warn.startIdx, end).filter(r => typeof r.dom === 'string');
    const want = OBJECTIVE_PHRASE[warn.kind], other = OBJECTIVE_PHRASE[warn.kind === 'outer' ? 'center' : 'outer'];
    const wrong = samples.filter(r => !want || !r.dom.includes(want) || r.dom.includes(other) || !r.dom.includes(OBJECTIVE_TITLE));
    for (const r of wrong) bad.push({ ordinal: warn.ordinal, kind: warn.kind, t: r.t, dom: r.dom });
    perWarn.push({ ordinal: warn.ordinal, kind: warn.kind, outcome: warn.outcome, samples: samples.length, wrong: wrong.length });
  }
  const required = perWarn.filter(w => w.outcome === 'strike');
  const missing = required.filter(w => w.samples === 0);
  return { ok: bad.length === 0 && missing.length === 0 && required.length > 0, bad, missing, perWarn };
}

/** 결과 줄 문구. 같은 줄이 정확히 한 번 있어야 한다. */
export const bossResultLine = (strikes, hits) => '푸른 궤도선 유성 ' + strikes + '회 · 피격 ' + hits + '회';
export function checkResultLine(text, strikes, hits) {
  const body = String(text ?? ''), lines = body.match(/푸른 궤도선 유성 \d+회 · 피격 \d+회/g) || [], want = bossResultLine(strikes, hits);
  return { ok: lines.length === 1 && lines[0] === want, lines, want, anyMention: body.split('푸른 궤도선 유성').length - 1 };
}

/** 결과 routeObjective: complete·progress = target 과 보스 유성 필드(관측 낙하 수·중심 낙하 수·피격 수). */
export function checkResultFields(ro, observed, win = true) {
  const complete = win === true && ro?.complete === true && Number.isInteger(ro?.target) && ro.progress === ro.target;
  const meteors = Number.isInteger(ro?.bossMeteors) && ro.bossMeteors === observed.strikes;
  const centers = Number.isInteger(ro?.bossCenterMeteors) && ro.bossCenterMeteors === observed.centerStrikes;
  const hits = Number.isInteger(ro?.bossMeteorHits) && ro.bossMeteorHits === observed.hits;
  return { ok: complete && meteors && centers && hits, complete, meteors, centers, hits,
    result: { id: ro?.id ?? null, complete: ro?.complete ?? null, progress: ro?.progress ?? null, target: ro?.target ?? null, bossMeteors: ro?.bossMeteors ?? null,
      bossCenterMeteors: ro?.bossCenterMeteors ?? null, bossMeteorHits: ro?.bossMeteorHits ?? null }, observed };
}

/**
 * 보스 구간 전체 판정(후보 빌드, bossOrbit 이 있는 실행에서만 부른다).
 * obs: { trace, result: 결과 routeObjective, resultText: 결과 화면 DOM 텍스트, win, finalOrbit: 전투 종료 뒤 읽은 { state } 또는 null }
 * opts.minStrikes: 낙하 최소 수(auto 1, orbit 프로필 3).
 * acceptance 의 값이 전부 true 여야 한다.
 */
export function analyzeBossOrbit(obs, def, { minStrikes = 1 } = {}) {
  const rows = obs.trace || [], summary = summarizeBoss(rows), machine = checkStateMachine(rows, def), strikeInfo = analyzeStrikes(rows, def);
  const objective = checkObjectiveSamples(rows, strikeInfo.warns);
  const observed = { strikes: rows.reduce((m, r) => Math.max(m, r.sk || 0), 0), centerStrikes: rows.reduce((m, r) => Math.max(m, r.ck || 0), 0), hits: rows.reduce((m, r) => Math.max(m, r.ht || 0), 0) };
  const full = strikeInfo.warns.filter(w => w.outcome === 'strike');
  const defeatIdx = summary.defeatIdx, post = defeatIdx >= 0 ? rows.slice(defeatIdx + 1) : [];
  const afterDefeatStrike = defeatIdx >= 0 ? strikeInfo.strikeRows.filter(i => i > defeatIdx) : [];
  const endedOk = defeatIdx >= 0 && post.length >= 1 && post.every(r => r.os === 'ended') && (obs.finalOrbit == null || obs.finalOrbit.state === 'ended');
  const centerDeltaOk = strikeInfo.strikes.every(s => s.centerDelta === (s.kind === 'center' ? 1 : 0));
  const hitsAccounted = strikeInfo.strikes.reduce((sum, s) => sum + s.hitDelta, 0) === observed.hits && strikeInfo.strikes.length === observed.strikes;
  const result = checkResultFields(obs.result, observed, obs.win !== false);
  const line = checkResultLine(obs.resultText, observed.strikes, observed.hits);
  const warnAttack = strikeInfo.warns.filter(w => !w.seqSteady || w.startedDuringAttack || w.aswDuring > 0);
  const lastAsw = rows.reduce((m, r) => Math.max(m, r.asw || 0), 0);
  const acceptance = {
    bossObserved: summary.observed && summary.defeated === true,
    strikeCount: observed.strikes >= minStrikes,
    stateMachine: machine.ok,
    warnDuration: full.length > 0 && full.every(w => w.durationOk && w.startWarnLeftOk),
    kindOrder: strikeInfo.warns.every(w => w.kindOk),
    hitMatchesZone: strikeInfo.violations.length === 0 && strikeInfo.strikes.every(s => s.verdict !== 'fail'),
    noAttackDuringWarn: warnAttack.length === 0 && lastAsw === 0,
    centerStats: centerDeltaOk && hitsAccounted,
    noStrikeAfterDefeat: afterDefeatStrike.length === 0,
    endedAfterDefeat: endedOk,
    objectiveText: objective.ok,
    resultFields: result.ok,
    resultLine: line.ok,
  };
  return { acceptance, ok: Object.values(acceptance).every(Boolean), summary, observed, warns: strikeInfo.warns, strikes: strikeInfo.strikes, violations: strikeInfo.violations,
    machine, objective, result, resultLine: line, warnAttack,
    ambiguous: strikeInfo.strikes.filter(s => s.verdict === 'ambiguous'), excused: strikeInfo.strikes.filter(s => s.verdict === 'excused'),
    cancelled: strikeInfo.warns.filter(w => w.outcome === 'cancelled').length, post: { rows: post.length, states: [...new Set(post.map(r => r.os))] },
    kinds: { outer: observed.strikes - observed.centerStrikes, center: observed.centerStrikes } };
}

/**
 * orbit 프로필: AUTO 를 끈 구간(rows 의 [from, to))의 판정. 낙하 minStrikes 이상·outer ≥ 1·center ≥ 1·궤도 피격 0, 영웅 생존,
 * 구간 중 AUTO 꺼짐·공격 입력 없음(키보드 이동만). 구간 앞 행(from - 1)의 카운터를 기준으로 구간 안 증가를 센다.
 */
export function checkManualSegment(rows, from, to, { minStrikes = 3 } = {}) {
  const seg = rows.slice(from, to), base = rows[from - 1] ?? { sk: 0, ck: 0, ht: 0 }, last = seg.at(-1) ?? base;
  const strikes = (last.sk || 0) - (base.sk || 0), center = (last.ck || 0) - (base.ck || 0), outer = strikes - center, hits = (last.ht || 0) - (base.ht || 0);
  // AUTO 를 끈 직후에는 AUTO 가 시작한 공격·스킬·회피 동작이 몇 스텝 남을 수 있다. 처음으로 동작 state 를 벗어난 행부터 센다.
  const lead = seg.findIndex(r => !ACTION_STATES.includes(r.ps)), body = lead < 0 ? seg : seg.slice(lead);
  const autoSteps = seg.filter(r => r.au).length, attackHeld = seg.filter(r => r.ah).length, attackState = body.filter(r => ACTION_STATES.includes(r.ps)).length;
  const dead = seg.some(r => !(r.hhp > 0));
  const checks = { segment: seg.length > 0, strikes: strikes >= minStrikes, outer: outer >= 1, center: center >= 1, noHits: hits === 0, heroAlive: !dead,
    keyboardOnly: lead >= 0 && autoSteps === 0 && attackHeld === 0 && attackState === 0 };
  return { ok: Object.values(checks).every(Boolean), checks, steps: seg.length, leadSteps: lead < 0 ? seg.length : lead, strikes, outer, center, hits, autoSteps, attackHeld, attackState,
    minHpRatio: seg.reduce((m, r) => r.hmax > 0 ? Math.min(m, r.hhp / r.hmax) : m, 1) };
}

/**
 * pause 프로필: warn 중 #btn-pause → 몇 스텝 → warnLeft·strikes 불변 → #btn-resume → 이어짐.
 * 각 인자는 페이지 freeze 결과 { elapsed, orbit: { state, kind, warnLeft, strikes, centerStrikes, hits, asw }, boss: { seq } }.
 * before: 일시정지 직전, paused: 일시정지 직후, still: 120스텝+1초 뒤, resumed: 재개 뒤 steps 스텝.
 */
export function checkPause({ before, paused, still, resumed, steps }) {
  const same = (a, b) => !!a && !!b && a.elapsed === b.elapsed && a.orbit?.state === b.orbit?.state && a.orbit?.kind === b.orbit?.kind
    && a.orbit?.warnLeft === b.orbit?.warnLeft && a.orbit?.strikes === b.orbit?.strikes && a.orbit?.centerStrikes === b.orbit?.centerStrikes
    && a.orbit?.hits === b.orbit?.hits && a.orbit?.asw === b.orbit?.asw && a.boss?.seq === b.boss?.seq;
  const warnBefore = before?.orbit?.state === 'warn' && before.orbit.warnLeft > (steps + 2) * FRAME;
  const frozen = warnBefore && same(before, paused) && same(paused, still);
  const advanced = before?.orbit?.warnLeft - resumed?.orbit?.warnLeft;
  const resumedOk = frozen && resumed?.orbit?.state === 'warn' && resumed.orbit.kind === before.orbit.kind && resumed.orbit.strikes === before.orbit.strikes
    && resumed.orbit.hits === before.orbit.hits && close(advanced, steps * FRAME, 2 * FRAME) && resumed.elapsed > still.elapsed
    && resumed.orbit.asw === before.orbit.asw && resumed.boss?.seq === before.boss?.seq;
  return { ok: frozen && resumedOk, warnBefore, frozen, resumedOk, advanced: Number.isFinite(advanced) ? advanced : null, expectedAdvance: steps * FRAME,
    before: before?.orbit ?? null, paused: paused?.orbit ?? null, still: still?.orbit ?? null, resumed: resumed?.orbit ?? null };
}

/** screens 프로필: 모든 순간에 도달했고 순간마다 viewport 개수만큼 PNG 가 있는지. */
export function checkScreens(shots, labels, viewportCount) {
  const rows = labels.map(label => {
    const shot = (shots || []).find(s => s.label === label);
    return { label, reached: !!shot?.reached, files: shot?.files?.length ?? 0, ok: !!shot?.reached && shot.files?.length === viewportCount };
  });
  return { ok: rows.length > 0 && rows.every(r => r.ok), rows };
}

/**
 * draw call 표본({ label, calls })을 라벨별로 후보·기준선에서 짝지어 비교한다. 짝이 없으면(어느 한쪽에 표본이 없으면) 실패다.
 * 증가량 = 후보 calls − 기준선 calls ≤ limit.
 */
export function drawCallIncrease(cand, base, label, limit = 3) {
  const c = (cand || []).find(s => s.label === label) ?? null, b = (base || []).find(s => s.label === label) ?? null;
  const matched = !!c && !!b && Number.isFinite(c.calls) && Number.isFinite(b.calls);
  const increase = matched ? c.calls - b.calls : null;
  return { label, cand: c?.calls ?? null, base: b?.calls ?? null, increase, limit, matched, ok: matched && increase <= limit };
}

/**
 * PLAN 5절 기준선 비교. cand/base: { fight: 보스전 초(등장→처치), time: 완주 초, samples: draw call 표본, bossOver50: 보스 구간 50ms 초과 스텝 수 }.
 * 보스전 시간 비 ≤ fightRatio, 완주 시간 비 ≤ timeRatio, bossEnter·bossReady draw call 증가 ≤ drawLimit(짝 없으면 실패), 보스 구간 50ms 초과 수 ≤ 기준선 + slowExtra.
 */
export function compareRuns(cand, base, { fightRatio = 2, timeRatio = 2, drawLimit = 3, slowExtra = 2 } = {}) {
  const ratioOf = (a, b, limit) => { const ratio = a > 0 && b > 0 ? a / b : null; return { cand: a ?? null, base: b ?? null, ratio, limit, ok: ratio !== null && ratio <= limit }; };
  const fight = ratioOf(cand?.fight, base?.fight, fightRatio), time = ratioOf(cand?.time, base?.time, timeRatio);
  const bossEnter = drawCallIncrease(cand?.samples, base?.samples, 'bossEnter', drawLimit), bossReady = drawCallIncrease(cand?.samples, base?.samples, 'bossReady', drawLimit);
  const c = cand?.bossOver50, b = base?.bossOver50;
  const slow = { cand: c ?? null, base: b ?? null, limit: Number.isFinite(b) ? b + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(b) && c <= b + slowExtra };
  return { ok: fight.ok && time.ok && bossEnter.ok && bossReady.ok && slow.ok, fight, time, bossEnter, bossReady, slow };
}


