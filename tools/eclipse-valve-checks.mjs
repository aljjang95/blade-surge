// 일식 수문 역류 밸브 봉인(BUNDLE-07) QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/eclipse-valve-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.eclipse_*)다.
// 시간·반지름·개수·방 번호는 모두 인자(def, opts)로 받는다. 이 파일에는 게임 수치를 박지 않는다(링 색 기대값만 PLAN 3.2 의 연출 계약이다).
//
// 관측 행(상태가 바뀐 스텝, 유지(hd > 0) 중인 모든 스텝, 1초 간격 스텝, 표식 스텝만 남긴다. 봉인 판정에 필요한 연속 유지 구간은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, hd route.hold,
//   sl world.sealed(1/0), rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state,
//   g: 밸브마다 { id 방 id, rd gate.ready, at gate.attuned, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수 }(전부 숫자),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(유지 중 표본), vw { c: route.view.count, d: route.view.drawCalls } 또는 null(뷰 없음)(표본),
//   vis 뷰 인스턴스 스냅샷(표본): { found, by, meshes: [{ name, count, transparent, mc 재질 색 hex, inst: [{ s: [sx, sy, sz], c: 인스턴스 색 hex | null }] }] }

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/** 영웅 위치 관측은 스텝 끝이고 route.update 는 영웅 이동 앞에서 판정하므로 한 프레임 이동량(≈0.15)보다 넉넉한 여유를 둔다. */
export const POSITION_SLACK = .25;
/** 키보드 구간에서 시작 직후 잔여 동작(AUTO 가 시작한 공격 모션)을 건너뛰는 스텝 수. */
const SETTLE_STEPS = 10;
/** 영웅 동작 state. 키보드 구간에서는 이 state 가 나오면 안 된다. */
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 뷰 연출 계약(PLAN 3.2): 봉인된 고리는 금색, 차례가 아닌 고리는 회색이다. 차례·유지 중 고리는 def.cueColor 다. */
export const RING_COLOR = Object.freeze({ sealed: 0xffd060, waiting: 0x8394ac });
/** 뷰 draw call 상한(PLAN 3.2). */
export const VIEW_DRAW_LIMIT = 3;
const COLOR_TOLERANCE = .2;
const SCALE_EPS = 1e-4;

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
export function stepStats(values, limit = 50) {
  const n = values.length;
  return { n, p50: percentile(values, .5), p95: percentile(values, .95), max: n ? Math.max(...values) : null, over: values.filter(v => v > limit).length };
}

/** 목표창 제목과 결과 줄의 이름: 정의의 noun + verb. 일반은 '역류 밸브 잠금', 심층은 '역류 밸브 봉인'. */
export const valveTitle = def => def.noun + ' ' + def.verb;
/** 결과 화면 줄: '역류 밸브 봉인 4/4 · 완료'. */
export const resultLineOf = def => valveTitle(def) + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';
/** 목표창 유지 문구: '중심에서 2초 유지'. */
export const holdPhraseOf = def => '중심에서 ' + def.holdSeconds + '초 유지';
const roomDistance = (row, room) => room ? Math.hypot(row.x - room.x, row.z - room.z) : Infinity;
const roomById = (rooms, id) => (rooms || []).find(room => room.id === id) ?? null;

/**
 * 유지 구간. hd > 0 이 이어지는 연속 스텝(n 이 1씩 늘고 hd 가 매 스텝 늘어난다)을 한 구간으로 묶는다.
 * fromZero: 구간의 첫 hd 가 한 프레임(0 에서 새로 시작)인지. 일시정지·반경 이탈 뒤의 유지는 0 에서 새로 시작해야 한다.
 */
export function holdRuns(rows) {
  const runs = [];
  let open = null;
  rows.forEach((row, i) => {
    if (!(row.hd > 0)) { open = null; return; }
    const prev = open ? rows[open.end] : null;
    const continues = !!prev && row.n === prev.n + 1 && row.hd > prev.hd && row.hd - prev.hd <= 2 * FRAME + EPS;
    if (continues) { open.end = i; open.max = row.hd; return; }
    open = { start: i, end: i, max: row.hd, fromZero: Math.abs(row.hd - FRAME) <= EPS };
    runs.push(open);
  });
  return runs;
}

/**
 * 봉인 이벤트 판정. 봉인 = route.progress 가 늘어난 스텝.
 * (a) 봉인한 밸브의 방 id 가 정의 순서와 같음, (b) 직전 연속 유지 구간이 holdSeconds − 1/60 이상이고 0 에서 새로 시작함,
 * (b2) 그 구간 동안 영웅이 방 중심 반경(def.radius) 안, (c) 그 방의 살아 있는 적·대기열 0(유지 구간 전체와 봉인 스텝), (d) 정예방이면 forgeWave = reinforcements,
 * 그 밖에 봉인 스텝에서 그 밸브가 attuned·cleared, 앞 밸브는 모두 attuned·뒤 밸브는 모두 아직 아님, 봉인 전에는 그 방이 cleared 가 아님.
 */
export function checkSeals(rows, def, { reinforcements = 0, rooms = [] } = {}) {
  const runs = holdRuns(rows), n = def.gates.length, seals = [], violations = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i], prev = rows[i - 1];
    if (!(cur.pr > prev.pr)) continue;
    const index = prev.pr, step = cur.pr - prev.pr;
    const gate = cur.g?.[index], want = def.gates[index];
    const room = roomById(rooms, gate?.id);
    const run = runs.find(r => r.end === i - 1 && cur.n === prev.n + 1) ?? null;
    const seconds = run ? rows[run.end].hd : null;
    const runRows = run ? rows.slice(run.start, run.end + 1) : [];
    const farthest = runRows.length ? Math.max(...runRows.map(r => roomDistance(r, room))) : null;
    const elite = (room?.type ?? null) === 'elite';
    const rec = {
      row: i, n: cur.n, t: cur.t, index, roomId: gate?.id ?? null, wantRoomId: want?.roomId ?? null, jump: step,
      order: step === 1 && !!want && gate?.id === want.roomId,
      hold: { found: !!run, seconds, fromZero: run?.fromZero ?? false, need: def.holdSeconds - FRAME,
        ok: !!run && run.fromZero && seconds + EPS >= def.holdSeconds - FRAME },
      inside: { farthest, limit: def.radius + POSITION_SLACK, ok: !!run && !!room && farthest <= def.radius + POSITION_SLACK },
      cleared: { sealAlive: gate?.al ?? null, sealPending: gate?.pd ?? null,
        runDirty: runRows.filter(r => r.g?.[index]?.al !== 0 || r.g?.[index]?.pd !== 0).length,
        runNotReady: runRows.filter(r => r.g?.[index]?.rd !== 1).length,
        ok: !!gate && gate.al === 0 && gate.pd === 0 && !!run && runRows.every(r => r.g?.[index]?.al === 0 && r.g?.[index]?.pd === 0 && r.g?.[index]?.rd === 1) },
      forge: { type: room?.type ?? null, forgeWave: gate?.fw ?? null, want: elite ? reinforcements : null,
        ok: !!gate && (!elite || (gate.fw === reinforcements && runRows.every(r => r.g?.[index]?.fw === reinforcements))) },
      state: { attuned: gate?.at === 1 && gate?.cl === 1,
        earlier: cur.g?.slice(0, index).every(g => g.at === 1) ?? false, later: cur.g?.slice(index + 1).every(g => g.at === 0) ?? false,
        earlyClear: rows.slice(0, i).filter(r => r.g?.[index]?.cl === 1).length },
    };
    rec.state.ok = rec.state.attuned && rec.state.earlier && rec.state.later && rec.state.earlyClear === 0;
    seals.push(rec);
  }
  const observedOrder = seals.map(s => s.roomId);
  const wantOrder = def.gates.map(g => g.roomId);
  for (const s of seals) {
    if (!s.order) violations.push({ kind: 'order', n: s.n, roomId: s.roomId, want: s.wantRoomId });
    if (!s.hold.ok) violations.push({ kind: 'hold', n: s.n, roomId: s.roomId, seconds: s.hold.seconds, need: s.hold.need, fromZero: s.hold.fromZero });
    if (!s.inside.ok) violations.push({ kind: 'inside', n: s.n, roomId: s.roomId, farthest: s.inside.farthest, limit: s.inside.limit });
    if (!s.cleared.ok) violations.push({ kind: 'enemies', n: s.n, roomId: s.roomId, ...s.cleared });
    if (!s.forge.ok) violations.push({ kind: 'forge', n: s.n, roomId: s.roomId, ...s.forge });
    if (!s.state.ok) violations.push({ kind: 'state', n: s.n, roomId: s.roomId, ...s.state });
  }
  return { seals, observedOrder, wantOrder, count: seals.length, target: n, violations,
    ok: {
      count: seals.length === n && rows.at(-1)?.pr === n,
      order: seals.length === n && seals.every(s => s.order) && JSON.stringify(observedOrder) === JSON.stringify(wantOrder),
      hold: seals.length > 0 && seals.every(s => s.hold.ok),
      inside: seals.length > 0 && seals.every(s => s.inside.ok),
      enemies: seals.length > 0 && seals.every(s => s.cleared.ok),
      reinforcements: seals.length > 0 && seals.every(s => s.forge.ok),
      state: seals.length > 0 && seals.every(s => s.state.ok),
    } };
}

/**
 * 순서 대기(심층). 마지막 밸브(방 5)의 gate.ready 가 켜졌는데 progress 가 그 밸브 차례 전인 표본 수. 밸브가 3개인 일반에서는 요구하지 않는다.
 * 대기 중 그 밸브는 attuned 가 아니고 방도 cleared 가 아니어야 한다.
 */
export function checkWaiting(rows, def, { required = true } = {}) {
  const w = def.gates.length - 1;
  const samples = rows.filter(r => r.g?.[w]?.rd === 1 && r.pr < w);
  const bad = samples.filter(r => r.g[w].at !== 0 || r.g[w].cl !== 0);
  return { required, gate: w, samples: samples.length, bad: bad.length, firstN: samples[0]?.n ?? null, ok: !required || (samples.length >= 1 && bad.length === 0) };
}

/**
 * 보스 봉인 해제. world.sealed 가 처음 false 가 된 스텝은 progress = n 이고 모든 비보스·비시작 방이 cleared 인 뒤여야 한다.
 * 시작부터 sealed 였고, 마지막 봉인 스텝 뒤에 해제된다.
 */
export function checkUnseal(rows, def) {
  const n = def.gates.length;
  const first = rows.findIndex(r => r.sl === 0);
  const startsSealed = rows[0]?.sl === 1;
  if (first < 0) return { ok: false, startsSealed, reason: 'never-unsealed' };
  const row = rows[first], prev = rows[first - 1];
  const lastSeal = [...rows.keys()].filter(i => i > 0 && rows[i].pr > rows[i - 1].pr).at(-1) ?? -1;
  const ok = startsSealed && prev?.sl === 1 && row.pr === n && row.rem === 0 && first > lastSeal;
  return { ok, startsSealed, n: row.n, t: row.t, progress: row.pr, remaining: row.rem, afterLastSeal: first > lastSeal, reason: ok ? null : 'early-or-inconsistent' };
}

/** 결과 객체: { id, complete: true, progress n, target n, rooms = 정의 순서, label }. */
export function checkResultFields(ro, def, win = true) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId);
  const got = ro ? { id: ro.id, label: ro.label ?? null, complete: ro.complete, progress: ro.progress, target: ro.target, rooms: [...(ro.rooms || [])] } : null;
  const ok = !!ro && win === true && ro.id === def.id && ro.complete === true && ro.progress === n && ro.target === n
    && JSON.stringify(ro.rooms) === JSON.stringify(rooms) && (ro.label === undefined || ro.label === valveTitle(def));
  return { ok, got, want: { id: def.id, label: valveTitle(def), complete: true, progress: n, target: n, rooms } };
}
/** 결과 화면 줄: '역류 밸브 봉인 4/4 · 완료'(일반 '역류 밸브 잠금 3/3 · 완료'). */
export function checkResultLine(text, def) {
  const line = resultLineOf(def);
  return { ok: typeof text === 'string' && text.includes(line), line };
}

/**
 * 목표창 표본(유지 중 10Hz 갱신 뒤). 모든 표본에 제목과 유지 문구가 있어야 하고, 봉인마다 그 유지 구간에서 표본이 1개 이상 있어야 한다.
 */
export function checkObjectiveSamples(rows, def, seals) {
  const title = valveTitle(def), phrase = holdPhraseOf(def);
  const samples = rows.filter(r => typeof r.dom === 'string');
  const bad = samples.filter(r => !r.dom.includes(title) || !r.dom.includes(phrase)).map(r => ({ n: r.n, dom: r.dom }));
  const runs = holdRuns(rows);
  const missing = seals.map(s => {
    const run = runs.find(r => r.end === s.row - 1);
    return run && rows.slice(run.start, run.end + 1).some(r => typeof r.dom === 'string') ? null : { index: s.index, roomId: s.roomId };
  }).filter(Boolean);
  return { title, phrase, samples: samples.length, bad: bad.slice(0, 6), missing, ok: samples.length > 0 && bad.length === 0 && missing.length === 0 };
}

// ---------- 뷰 ----------
/**
 * 관측값(discovered/attuned/progress/hold)으로 계산한 밸브의 기대 모습. 뷰의 valveState 를 다시 쓰지 않고 렌더된 인스턴스와 맞춰 보는 기준이다.
 * hidden(방 미발견) | sealed | holding | next | waiting
 */
export function expectedLook(row, i) {
  const g = row.g?.[i];
  if (!g || g.dc !== 1) return 'hidden';
  if (g.at === 1) return 'sealed';
  if (i === row.pr) return row.hd > 0 ? 'holding' : 'next';
  return 'waiting';
}
const hexRgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
const colorNear = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.hypot(...hexRgb(a).map((v, k) => v - hexRgb(b)[k])) <= COLOR_TOLERANCE;
const scaleOf = inst => inst?.s ? Math.max(...inst.s) : null;
/** 차례(next) 고리는 뷰가 cueColor 를 흰색 쪽으로 밝혀 쓴다(PLAN 3.2 '밝은 청록'). cueColor 를 흰색 쪽으로 t ∈ [0, .6] 섞은 색만 면제한다. */
const nearBrightened = (got, cue) => {
  for (let t = 0; t <= .6 + 1e-9; t += .05) {
    const c = hexRgb(cue).map(v => v + (1 - v) * t);
    if (Number.isFinite(got) && Math.hypot(...hexRgb(got).map((v, k) => v - c[k])) <= COLOR_TOLERANCE / 4) return true;
  }
  return false;
};
/** 물줄기 메시: 이름에 stream 이 있는 메시. 이름으로 찾지 못하면 반투명 메시로 대신한다(바닥 고리도 반투명이라 이름이 우선이다 — smoke-deep-auto-1 오탐). */
const streamMeshes = meshes => {
  const named = meshes.filter(m => /stream/i.test(m.name || ''));
  return named.length ? named : meshes.filter(m => m.transparent);
};
/** 렌더된 인스턴스 스냅샷을 기대 모습과 맞춰 본다. 반환: { ok, observable, problems, ringColor }. 인스턴스를 못 찾으면 observable false. */
export function checkLook(vis, row, def) {
  const n = def.gates.length;
  const meshes = (vis?.meshes || []).filter(m => m.count === n && Array.isArray(m.inst) && m.inst.length >= n);
  if (!vis?.found || meshes.length === 0) return { ok: false, observable: false, problems: [{ kind: 'unobservable', by: vis?.by ?? null }], ringColor: 'unobservable' };
  const streams = streamMeshes(meshes);
  const problems = [];
  let ringChecked = false;
  const colored = meshes.filter(m => m.inst.some(x => x.c !== null && x.c !== undefined));
  for (let i = 0; i < n; i++) {
    const want = expectedLook(row, i);
    if (want === 'hidden') {
      if (meshes.some(m => scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'visible-while-hidden' });
      continue;
    }
    if (!streams.length) problems.push({ gate: i, want, kind: 'no-stream-mesh' });
    else if (want === 'sealed') {
      if (streams.some(m => scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'stream-visible-after-seal' });
      if (!meshes.some(m => !streams.includes(m) && scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'nothing-left-after-seal' });
    } else if (streams.every(m => !(scaleOf(m.inst[i]) > SCALE_EPS))) problems.push({ gate: i, want, kind: 'stream-hidden' });
    if (colored.length) {
      ringChecked = true;
      const wantColor = want === 'sealed' ? RING_COLOR.sealed : want === 'waiting' ? RING_COLOR.waiting : def.cueColor;
      const okColor = colored.some(m => colorNear(m.inst[i].c, wantColor) || (want === 'next' && nearBrightened(m.inst[i].c, def.cueColor)));
      if (!okColor) problems.push({ gate: i, want, kind: 'ring-color', got: colored.map(m => m.inst[i].c), wantColor });
    }
  }
  return { ok: problems.length === 0, observable: true, problems, ringColor: ringChecked ? 'checked' : 'unobservable' };
}

/**
 * 뷰 판정(def.view 가 있는 빌드). route.view 의 공개 getter: count = 밸브 수, drawCalls ≤ 3.
 * 표본마다 렌더된 인스턴스가 기대 모습과 맞아야 하고, 봉인된 밸브 표본(물줄기 숨김·금색 고리)과 차례·유지 표본을 모두 한 번 이상 봤어야 한다.
 */
export function checkView(rows, def, { sealsExpected = true } = {}) {
  const n = def.gates.length;
  const counted = rows.filter(r => r.vw);
  const missingView = rows.filter(r => r.vw === null).length;
  const badCount = counted.filter(r => r.vw.c !== n).map(r => ({ n: r.n, count: r.vw.c }));
  const badDraw = counted.filter(r => !(r.vw.d <= VIEW_DRAW_LIMIT)).map(r => ({ n: r.n, drawCalls: r.vw.d }));
  const looks = rows.filter(r => r.vis).map(r => ({ n: r.n, result: checkLook(r.vis, r, def), wants: r.g.map((_, i) => expectedLook(r, i)) }));
  const unobservable = looks.filter(l => !l.result.observable).length;
  const mismatched = looks.filter(l => l.result.observable && !l.result.ok).map(l => ({ n: l.n, wants: l.wants, problems: l.result.problems }));
  const seen = new Set(looks.flatMap(l => l.wants));
  const coverage = { sealed: seen.has('sealed'), live: seen.has('next') || seen.has('holding'), waiting: seen.has('waiting') };
  const countOk = counted.length > 0 && missingView === 0 && badCount.length === 0 && badDraw.length === 0;
  return { samples: counted.length, looks: looks.length, missingView, unobservable, badCount: badCount.slice(0, 6), badDraw: badDraw.slice(0, 6), mismatched: mismatched.slice(0, 6), coverage,
    ringColor: looks.some(l => l.result.ringColor === 'checked') ? 'checked' : 'unobservable',
    ok: { count: countOk, look: looks.length > 0 && unobservable === 0 && mismatched.length === 0 && (!sealsExpected || coverage.sealed) && coverage.live } };
}

// ---------- 종합 ----------
/**
 * 후보 빌드의 한 번 완주 종합 판정. obs: { rows, result, resultText, win, rooms }. opts: { reinforcements, expectWaiting, viewExpected }.
 * ok 는 acceptance 의 모든 항목이 통과일 때만 true 다.
 */
export function analyzeValves(obs, def, { reinforcements = 0, expectWaiting = false, viewExpected = false } = {}) {
  const rows = obs.rows || [];
  const seals = checkSeals(rows, def, { reinforcements, rooms: obs.rooms });
  const waiting = checkWaiting(rows, def, { required: expectWaiting });
  const unseal = checkUnseal(rows, def);
  const result = checkResultFields(obs.result, def, obs.win === true);
  const line = checkResultLine(obs.resultText, def);
  const objective = checkObjectiveSamples(rows, def, seals.seals);
  const view = viewExpected ? checkView(rows, def) : null;
  const acceptance = {
    sealCount: seals.ok.count, sealOrder: seals.ok.order, holdDuration: seals.ok.hold, holdInside: seals.ok.inside, enemiesCleared: seals.ok.enemies,
    reinforcements: seals.ok.reinforcements, gateState: seals.ok.state, waiting: waiting.ok, unseal: unseal.ok, resultFields: result.ok, resultLine: line.ok, objectiveText: objective.ok,
    ...(view ? { viewCount: view.ok.count, viewLook: view.ok.look } : {}),
  };
  return { ok: Object.values(acceptance).every(Boolean), acceptance, seals: seals.seals, observedOrder: seals.observedOrder, wantOrder: seals.wantOrder, violations: seals.violations,
    waiting, unseal, result, resultLine: line, objective, view, rows: rows.length };
}

// ---------- order 프로필(키보드) ----------
const markIndex = (rows, label) => rows.findIndex(r => r.mk === label);
const markOf = (rows, label) => rows[markIndex(rows, label)] ?? null;
/**
 * 키보드 구간 판정. 표식 from~to 사이 행에서 AUTO 꺼짐·공격 입력 없음·공격/스킬/회피 state 없음(시작 직후 SETTLE_STEPS 제외)·영웅 생존.
 */
export function checkKeyboardSegment(rows, from, to) {
  const ia = markIndex(rows, from), ib = markIndex(rows, to), a = rows[ia], b = rows[ib];
  if (!a || !b || ib < ia) return { ok: false, reason: 'missing-mark', from, to, found: [!!a, !!b] };
  // 표식 행이 같은 스텝의 이전 행과 n 이 겹칠 수 있어 행 순서로 자른다.
  const seg = rows.slice(ia, ib + 1);
  const settled = seg.filter(r => r.n >= a.n + SETTLE_STEPS);
  const autoRows = seg.filter(r => r.au === 1).length, held = seg.filter(r => r.ah === 1).length;
  const action = settled.filter(r => ACTION_STATES.includes(r.ps)).length;
  const dead = seg.filter(r => r.al !== 1 || !(r.hp > 0)).length;
  return { ok: seg.length > 0 && autoRows === 0 && held === 0 && action === 0 && dead === 0, rows: seg.length, steps: b.n - a.n, autoRows, attackHeld: held, actionRows: action, dead };
}
/**
 * order 프로필 판정. 표식: manual1-start(AUTO 끔), wait-start(방 5 중심 반경 안), wait-end(3초 뒤), manual2-start(progress = w 에서 AUTO 끔),
 * exit(유지 ≥ 1.0 뒤 반경 밖), manual2-end(progress w+1 에서).
 * w = 마지막 밸브 index. wait 구간: progress 불변(w − 1)·그 방 cleared 아님·영웅이 계속 반경 안·3초 이상.
 * 최종 구간: 반경 안 유지 ≥ 1.0 뒤 반경 밖으로 나가 hold 0 → 다시 들어가 새 유지 ≥ holdSeconds − 1/60 로 봉인(w+1).
 */
export function analyzeOrder(rows, def, { rooms = [], waitSeconds = 3, minPartial = 1 } = {}) {
  const w = def.gates.length - 1, room = roomById(rooms, def.gates[w].roomId);
  const m = Object.fromEntries(['manual1-start', 'wait-start', 'wait-end', 'manual2-start', 'exit', 'manual2-end'].map(k => [k, markOf(rows, k)]));
  const missing = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, wait: { ok: false }, final: { ok: false } };
  const at = k => markIndex(rows, k);
  const waitRows = rows.slice(at('wait-start'), at('wait-end') + 1);
  const wait = { rows: waitRows.length, seconds: m['wait-end'].t - m['wait-start'].t, progress: [...new Set(waitRows.map(r => r.pr))],
    clearedRows: waitRows.filter(r => r.g?.[w]?.cl !== 0).length, readyRows: waitRows.filter(r => r.g?.[w]?.rd === 1).length,
    farthest: Math.max(...waitRows.map(r => roomDistance(r, room))), keyboard: checkKeyboardSegment(rows, 'manual1-start', 'wait-end') };
  wait.ok = wait.seconds + EPS >= waitSeconds - 2 * FRAME && wait.progress.length === 1 && wait.progress[0] === w - 1 && wait.clearedRows === 0
    && wait.readyRows === waitRows.length && wait.farthest <= def.radius + POSITION_SLACK && wait.keyboard.ok;
  const finalRows = rows.slice(at('manual2-start'), at('manual2-end') + 1);
  const runs = holdRuns(finalRows);
  const exitRow = m.exit;
  const aborted = runs.filter(run => finalRows[run.end].n < exitRow.n + 2 && run.max + EPS >= minPartial
    && finalRows[run.end + 1] && finalRows[run.end + 1].hd === 0 && finalRows[run.end + 1].pr === w);
  const sealRow = finalRows.findIndex((r, i) => i > 0 && r.pr > finalRows[i - 1].pr);
  const sealRun = runs.find(run => run.end === sealRow - 1) ?? null;
  const final = { rows: finalRows.length, startProgress: m['manual2-start'].pr, endProgress: m['manual2-end'].pr, abortedMax: aborted.length ? Math.max(...aborted.map(a => a.max)) : null,
    exitHold: exitRow.hd, exitDistance: roomDistance(exitRow, room), exitOutside: roomDistance(exitRow, room) > def.radius,
    sealSeconds: sealRun ? finalRows[sealRun.end].hd : null, sealAfterExit: !!sealRun && finalRows[sealRun.start].n > exitRow.n, sealFromZero: sealRun?.fromZero ?? false,
    keyboard: checkKeyboardSegment(rows, 'manual2-start', 'manual2-end') };
  final.ok = final.startProgress === w && final.endProgress === w + 1 && aborted.length >= 1 && final.exitHold === 0 && final.exitOutside
    && !!sealRun && final.sealFromZero && final.sealAfterExit && final.sealSeconds + EPS >= def.holdSeconds - FRAME && final.keyboard.ok;
  return { ok: wait.ok && final.ok, wait, final };
}

// ---------- pause 프로필 ----------
/**
 * 유지 중 일시정지. before: 정지 직전(hold ≥ 0.8), paused: 정지 직후, still: 120스텝+1초 뒤, resumed: 재개 뒤 steps 스텝.
 * 각 인자는 페이지 freeze 결과 { elapsed, paused, pr, hd }. 게임 시간 불변·hold 0·progress 불변, 재개 뒤 hold 는 0 에서 새로 시작(steps 프레임을 넘지 않음).
 */
export function checkPause({ before, paused, still, resumed, steps, minHold = .8 }) {
  const frozen = !!before && !!paused && !!still && before.hd >= minHold - EPS && paused.hd === 0 && still.hd === 0
    && paused.elapsed === before.elapsed && still.elapsed === before.elapsed && paused.pr === before.pr && still.pr === before.pr;
  const restartedFromZero = !!resumed && resumed.hd >= 0 && resumed.hd <= steps * FRAME + EPS;
  const resumedOk = frozen && restartedFromZero && resumed.pr === before.pr && resumed.elapsed > still.elapsed
    && Math.abs(resumed.elapsed - still.elapsed - steps * FRAME) <= 2 * FRAME;
  return { ok: frozen && resumedOk, frozen, resumedOk, restartedFromZero, expectedAdvance: steps * FRAME,
    before: before ?? null, paused: paused ?? null, still: still ?? null, resumed: resumed ?? null };
}
/** 재개 뒤 첫 봉인의 유지 구간이 재개 이후에 0 에서 시작해 holdSeconds − 1/60 이상인지. 표식 resume 필요. */
export function analyzePauseSeal(rows, def, { rooms = [], reinforcements = 0 } = {}) {
  const mark = markOf(rows, 'resume');
  if (!mark) return { ok: false, reason: 'missing-mark' };
  const seals = checkSeals(rows, def, { reinforcements, rooms }).seals;
  const first = seals.find(s => s.n > mark.n) ?? null;
  if (!first) return { ok: false, reason: 'no-seal-after-resume' };
  const run = holdRuns(rows).find(r => r.end === first.row - 1);
  const startN = run ? rows[run.start].n : null;
  return { ok: !!run && startN > mark.n && run.fromZero && first.hold.ok && first.order, sealN: first.n, runStartN: startN, resumeN: mark.n, seconds: first.hold.seconds, need: def.holdSeconds - FRAME };
}

// ---------- screens 프로필 ----------
/** 모든 순간에 도달했고 순간마다 viewport 개수만큼 PNG 가 있는지. */
export function checkScreens(shots, labels, viewportCount) {
  const rows = labels.map(label => {
    const shot = (shots || []).find(s => s.label === label);
    return { label, reached: !!shot?.reached, files: shot?.files?.length ?? 0, ok: !!shot?.reached && shot.files?.length === viewportCount };
  });
  return { ok: rows.length > 0 && rows.every(r => r.ok), rows };
}
/**
 * screens 순간의 밸브 상태. shot.stop·shot.capture 는 정지 시점·촬영 시점의 관측 행(freeze)이다.
 * 라벨이 가리키는 밸브(want.gate)의 기대 모습이 want.look 과 같고, 뷰가 있으면 렌더된 인스턴스가 그 모습이다(뷰 갱신 1스텝 지연이 있어 두 시점 중 하나와 맞으면 통과).
 */
export function checkScreenMoment(shot, def, want, { viewExpected = false } = {}) {
  const at = [shot?.stop, shot?.capture].filter(Boolean);
  const stateOk = at.some(row => expectedLook(row, want.gate) === want.look);
  if (!viewExpected) return { ok: stateOk, stateOk, looks: null };
  const looks = at.filter(row => row.vis).map(row => checkLook(row.vis, row, def));
  return { ok: stateOk && looks.some(l => l.ok), stateOk, looks: looks.map(l => ({ ok: l.ok, observable: l.observable, problems: l.problems })) };
}

// ---------- 기준선 비교 ----------
/** 방 첫 진입 draw call 표본({ label: 'roomEnter', roomId, calls })을 방별로 짝지어 후보 − 기준선 ≤ limit 인지. 짝 0개면 실패. */
export function roomDrawCalls(candSamples, baseSamples, rooms, limit = 3) {
  const pick = (samples, id) => (samples || []).find(s => s.label === 'roomEnter' && s.roomId === id) ?? null;
  const pairs = (rooms || []).map(id => {
    const c = pick(candSamples, id), b = pick(baseSamples, id);
    const matched = !!c && !!b && Number.isFinite(c.calls) && Number.isFinite(b.calls);
    const increase = matched ? c.calls - b.calls : null;
    return { room: id, cand: c?.calls ?? null, base: b?.calls ?? null, increase, matched, ok: matched && increase <= limit };
  });
  const matchedPairs = pairs.filter(p => p.matched);
  return { limit, pairs, matched: matchedPairs.length, maxIncrease: matchedPairs.length ? Math.max(...matchedPairs.map(p => p.increase)) : null,
    ok: matchedPairs.length > 0 && matchedPairs.every(p => p.ok) };
}
/** 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. depth: 'deep' 는 기준선에 경로 정의가 없고 후보에 있어야 하고, 'standard' 는 둘 다 정의가 있되 기준선에 view 가 없고 후보에 있어야 한다. */
export function compareTargetsOk(cand, base, depth) {
  if (!cand || !base) return false;
  const definition = depth === 'deep' ? !base.routeDefinition && !!cand.routeDefinition
    : !!base.routeDefinition && !!cand.routeDefinition && !base.viewDefined && !!cand.viewDefined;
  return definition && cand.valvesOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/**
 * PLAN 5절 5 기준선 비교. cand/base: { time 완주 초(승리만), samples, runOver50, valveRooms(cand) }.
 * 완주 시간 비 ≤ timeRatio(심층·일반), 밸브 방 첫 진입 draw call 증가 ≤ drawLimit(짝 있는 방만, 짝 0개면 실패), 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra.
 */
export function compareRuns(cand, base, { timeRatio = 2, drawLimit = 3, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio,
    parity: { target: 1, tolerance: .05, within: ratio !== null && Math.abs(ratio - 1) <= .05, note: '일반 비교(연출만 바뀐 빌드)의 1.00 ± 0.05 여부는 보고 항목이며 게이트가 아니다' } };
  const draw = roomDrawCalls(cand?.samples, base?.samples, cand?.valveRooms, drawLimit);
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  return { ok: time.ok && draw.ok && slow.ok, time, drawCalls: draw, slow };
}
