// 일식 수문 역류 밸브 봉인(BUNDLE-07) QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/eclipse-valve-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.eclipse_*)다.
// 시간·반지름·개수·방 번호는 모두 인자(def, opts)로 받는다. 이 파일에는 게임 수치를 박지 않는다(링·물줄기 색·높이 기대값만 PLAN 3.2 의 연출 계약이다).
//
// 관측 행(상태가 바뀐 스텝, 유지(hd > 0) 중인 모든 스텝, 1초 간격 스텝, 표식 스텝만 남긴다. 봉인 판정에 필요한 연속 유지 구간은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, hd route.hold,
//   sl world.sealed(1/0), rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state,
//   g: 밸브마다 { id 방 id, rd gate.ready, at gate.attuned, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수 }(전부 숫자),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(유지 중 표본), vw { c: route.view.count, d: route.view.drawCalls } 또는 null(뷰 없음)(표본),
//   vis 뷰 인스턴스 스냅샷(표본): { found, by, meshes: [{ name, count, transparent, mc 재질 색 hex, inst: [{ s: [sx, sy, sz], c: 인스턴스 색 hex | null }] }] }
// 뷰 실제 draw call A/B 표본(viewAB, 행과 따로 남긴다): { n, t, pr, hd, g: [{ dc, at }], changed: 바뀐 밸브 index[], viewCalls route.view.drawCalls, on 그룹 켠 렌더 calls, off 끈 렌더 calls }

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/**
 * 영웅 위치 관측은 스텝 끝이다. battle.update 는 player.update 뒤에 updateExpedition(route.update)을 부르므로 판정 위치는 이동이 반영된 뒤다.
 * 그 뒤 같은 스텝의 군중 밀림(resolveCrowdContacts)과 투사체·넉백 후처리가 위치를 조금 더 옮길 수 있어 한 프레임 이동량(≈0.15)보다 넉넉한 여유를 둔다.
 */
export const POSITION_SLACK = .25;
/** 키보드 구간에서 시작 직후 잔여 동작(AUTO 가 시작한 공격 모션)을 건너뛰는 스텝 수. */
const SETTLE_STEPS = 10;
/** 영웅 동작 state. 키보드 구간에서는 이 state 가 나오면 안 된다. */
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 뷰 연출 계약(PLAN 3.2): 봉인된 고리는 금색, 차례가 아닌 고리는 회색이다. 유지 중 고리는 def.cueColor, 차례 고리는 cueColor 를 흰색 쪽으로 섞은 색이다. */
export const RING_COLOR = Object.freeze({ sealed: 0xffd060, waiting: 0x8394ac });
/** cueColor 에 흰색을 섞는 비율 t 의 허용 구간. 유지 중·대기 = t < .1(cueColor 그대로), 차례 = t ∈ [.2, .6]. 두 구간이 떨어져 있어 차례와 유지가 색으로 구분된다. */
export const WHITE_MIX = Object.freeze({ plain: [0, .1], next: [.2, .6] });
/** 물줄기 높이 기준(차례 표본의 y 스케일)에 대한 비율: 대기 .5, 유지 max(.15, 1 − hold/holdSeconds). 허용 오차는 비율 ±.03. */
export const STREAM_RATIO = Object.freeze({ waiting: .5, holdMin: .15, tolerance: .03 });
/** 뷰 draw call 상한(PLAN 3.2). */
export const VIEW_DRAW_LIMIT = 3;
const COLOR_TOLERANCE = .2;
/** 흰색 섞음 띠와의 선형 색공간 거리 허용치. 8비트 양자화 오차(≈.007)보다 크고 두 띠 사이 간격(≈.09)보다 작다. */
const BAND_TOLERANCE = .03;
const VIEW_AB_MIN_SAMPLES = 3;
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
    // 이음 규칙: 연속한 스텝 행에서 hold 증가량이 게임 시각 t 의 증가량과 같아야 한다. 엔진이 유지량을 2배로 쌓으면 구간이 끊긴다.
    const continues = !!prev && row.n === prev.n + 1 && row.hd > prev.hd && Math.abs((row.hd - prev.hd) - (row.t - prev.t)) <= EPS;
    if (continues) { open.end = i; open.max = row.hd; return; }
    open = { start: i, end: i, max: row.hd, fromZero: Math.abs(row.hd - FRAME) <= EPS };
    runs.push(open);
  });
  return runs;
}

/** 유지 구간의 게임 시각 길이: t_end − t_start + 한 프레임(첫 행의 hd 가 한 프레임이므로 구간 길이는 행 수만큼이다). */
export const runSpan = (rows, run) => rows[run.end].t - rows[run.start].t + FRAME;

/**
 * 봉인 이벤트 판정. 봉인 = route.progress 가 늘어난 스텝.
 * (a) 봉인한 밸브의 방 id 가 정의 순서와 같음, (b) 직전 연속 유지 구간이 0 에서 새로 시작하고, 엔진의 hold 값과 행의 게임 시각 길이(t_end − t_start + FRAME) 모두 holdSeconds − 1/60 이상임,
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
    const span = run ? runSpan(rows, run) : null;
    const runRows = run ? rows.slice(run.start, run.end + 1) : [];
    const farthest = runRows.length ? Math.max(...runRows.map(r => roomDistance(r, room))) : null;
    const elite = (room?.type ?? null) === 'elite';
    const rec = {
      row: i, n: cur.n, t: cur.t, index, roomId: gate?.id ?? null, wantRoomId: want?.roomId ?? null, jump: step,
      order: step === 1 && !!want && gate?.id === want.roomId,
      hold: { found: !!run, seconds, span, fromZero: run?.fromZero ?? false, need: def.holdSeconds - FRAME,
        ok: !!run && run.fromZero && seconds + EPS >= def.holdSeconds - FRAME && span + EPS >= def.holdSeconds - FRAME },
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
    if (!s.hold.ok) violations.push({ kind: 'hold', n: s.n, roomId: s.roomId, seconds: s.hold.seconds, span: s.hold.span, need: s.hold.need, fromZero: s.hold.fromZero });
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
const heightOf = inst => inst?.s ? inst.s[1] : null;
// 뷰의 THREE.Color.lerp 는 선형 색공간에서 섞는다. 인스턴스 색 hex 는 sRGB 라서 같은 공간으로 바꿔 비교한다.
const toLinear = c => (c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4));
const toSrgb = c => (c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055);
const hexLinear = hex => hexRgb(hex).map(toLinear);
/** cue 를 흰색 쪽으로 t 만큼 섞은 색의 sRGB hex(뷰의 color(cue).lerp(white, t) 와 같다). 테스트와 보고용. */
export function mixWhite(cue, t) {
  const [r, g, b] = hexLinear(cue).map(v => toSrgb(v + (1 - v) * t));
  const byte = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
/** got 가 cue 를 흰색 쪽으로 t ∈ [lo, hi] 섞은 색의 띠 안(선형 색공간 거리 ≤ BAND_TOLERANCE)인지. */
export function inWhiteBand(got, cue, [lo, hi]) {
  if (!Number.isFinite(got) || !Number.isFinite(cue)) return false;
  const g = hexLinear(got), c = hexLinear(cue), d = c.map(v => 1 - v);
  const dd = d.reduce((sum, v) => sum + v * v, 0);
  const t = dd > 1e-9 ? Math.min(hi, Math.max(lo, g.reduce((sum, v, k) => sum + (v - c[k]) * d[k], 0) / dd)) : lo;
  return Math.hypot(...g.map((v, k) => v - (c[k] + d[k] * t))) <= BAND_TOLERANCE;
}
/** 인스턴스 스냅샷에서 이름으로 메시를 가른다. 이름이 stream 이면 물줄기, ring 이면 고리다(재질 투명 여부로 대신 찾지 않는다). */
const meshGroups = (vis, n) => {
  const meshes = (vis?.meshes || []).filter(m => m.count === n && Array.isArray(m.inst) && m.inst.length >= n);
  const streams = meshes.filter(m => /stream/i.test(m.name || ''));
  const rings = meshes.filter(m => /ring/i.test(m.name || '') && !streams.includes(m));
  return { meshes, streams, rings };
};
/** 물줄기 높이 기준: 같은 런에서 '차례' 밸브의 물줄기 y 스케일 중 가장 큰 값. 표본이 없으면 null. samples: [{ vis, row }]. */
export function streamBase(samples, def) {
  const n = def.gates.length;
  let best = null;
  for (const { vis, row } of samples || []) {
    const { streams } = meshGroups(vis, n);
    for (let i = 0; i < n; i++) {
      if (expectedLook(row, i) !== 'next') continue;
      for (const m of streams) { const y = heightOf(m.inst[i]); if (y > SCALE_EPS && (best === null || y > best)) best = y; }
    }
  }
  return best;
}
/** 기준에 대한 물줄기 높이 비율의 기대값: 차례 1, 대기 .5, 유지 max(.15, 1 − hold/holdSeconds)(그 표본 행의 hold). */
const heightRatio = (look, row, def) => (look === 'next' ? 1 : look === 'waiting' ? STREAM_RATIO.waiting : Math.max(STREAM_RATIO.holdMin, 1 - row.hd / def.holdSeconds));
/**
 * 렌더된 인스턴스 스냅샷을 기대 모습과 맞춰 본다. 반환: { ok, observable, problems, ringColor }. 물줄기·고리 메시를 이름으로 못 찾으면 observable false.
 * 고리 색은 고리 메시만, 물줄기 색은 물줄기 메시만 본다. opts.streamBase 가 있으면 물줄기 높이도 맞춰 본다(undefined 면 높이 판정 생략, null 이면 기준 없음).
 */
export function checkLook(vis, row, def, { streamBase: base } = {}) {
  const n = def.gates.length;
  const { meshes, streams, rings } = meshGroups(vis, n);
  if (!vis?.found || !streams.length || !rings.length) {
    return { ok: false, observable: false, problems: [{ kind: 'unobservable', by: vis?.by ?? null, stream: streams.length, ring: rings.length }], ringColor: 'unobservable' };
  }
  const problems = [];
  for (let i = 0; i < n; i++) {
    const want = expectedLook(row, i);
    if (want === 'hidden') {
      if (meshes.some(m => scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'visible-while-hidden' });
      continue;
    }
    if (!rings.some(m => scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'ring-hidden' });
    // 고리 색(고리 메시만).
    for (const m of rings) {
      const got = m.inst[i]?.c ?? null;
      const ok = want === 'sealed' ? colorNear(got, RING_COLOR.sealed) : want === 'waiting' ? colorNear(got, RING_COLOR.waiting)
        : inWhiteBand(got, def.cueColor, want === 'next' ? WHITE_MIX.next : WHITE_MIX.plain);
      if (!ok) problems.push({ gate: i, want, kind: 'ring-color', got });
    }
    if (want === 'sealed') {
      if (streams.some(m => scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'stream-visible-after-seal' });
      if (!meshes.some(m => !streams.includes(m) && scaleOf(m.inst[i]) > SCALE_EPS)) problems.push({ gate: i, want, kind: 'nothing-left-after-seal' });
      continue;
    }
    if (streams.every(m => !(scaleOf(m.inst[i]) > SCALE_EPS))) { problems.push({ gate: i, want, kind: 'stream-hidden' }); continue; }
    // 물줄기 색(물줄기 메시만): 차례만 밝힌 색이고 유지·대기는 cueColor 그대로다.
    for (const m of streams) {
      const got = m.inst[i]?.c ?? null;
      if (!inWhiteBand(got, def.cueColor, want === 'next' ? WHITE_MIX.next : WHITE_MIX.plain)) problems.push({ gate: i, want, kind: 'stream-color', got });
      if (base === undefined) continue;
      const y = heightOf(m.inst[i]);
      if (want !== 'next' && base === null) { problems.push({ gate: i, want, kind: 'no-height-reference' }); continue; }
      if (base === null) continue;
      const got2 = y / base, wantRatio = heightRatio(want, row, def);
      if (!(Math.abs(got2 - wantRatio) <= STREAM_RATIO.tolerance)) problems.push({ gate: i, want, kind: 'stream-height', got: got2, wantRatio });
    }
  }
  return { ok: problems.length === 0, observable: true, problems, ringColor: 'checked' };
}

/**
 * 뷰 판정(def.view 가 있는 빌드). route.view 의 공개 getter: count = 밸브 수, drawCalls ≤ 3.
 * 표본마다 렌더된 인스턴스가 기대 모습과 맞아야 하고, 봉인된 밸브 표본(물줄기 숨김·금색 고리)과 차례·유지 표본을 모두 한 번 이상 봤어야 한다.
 * 같은 런에 '차례' 표본이 있어야 물줄기 높이 기준이 서므로 없으면 실패한다. waitingExpected(순서 대기 시나리오가 있는 심층)면 대기 표본도 요구한다.
 */
export function checkView(rows, def, { sealsExpected = true, waitingExpected = false } = {}) {
  const n = def.gates.length;
  const counted = rows.filter(r => r.vw);
  const missingView = rows.filter(r => r.vw === null).length;
  const badCount = counted.filter(r => r.vw.c !== n).map(r => ({ n: r.n, count: r.vw.c }));
  const badDraw = counted.filter(r => !(r.vw.d <= VIEW_DRAW_LIMIT)).map(r => ({ n: r.n, drawCalls: r.vw.d }));
  const visRows = rows.filter(r => r.vis);
  const base = streamBase(visRows.map(r => ({ vis: r.vis, row: r })), def);
  const looks = visRows.map(r => ({ n: r.n, result: checkLook(r.vis, r, def, { streamBase: base }), wants: r.g.map((_, i) => expectedLook(r, i)) }));
  const unobservable = looks.filter(l => !l.result.observable).length;
  const mismatched = looks.filter(l => l.result.observable && !l.result.ok).map(l => ({ n: l.n, wants: l.wants, problems: l.result.problems }));
  const seen = new Set(looks.flatMap(l => l.wants));
  const coverage = { sealed: seen.has('sealed'), live: seen.has('next') || seen.has('holding'), waiting: seen.has('waiting'), next: base !== null };
  const countOk = counted.length > 0 && missingView === 0 && badCount.length === 0 && badDraw.length === 0;
  return { samples: counted.length, looks: looks.length, missingView, unobservable, badCount: badCount.slice(0, 6), badDraw: badDraw.slice(0, 6), mismatched: mismatched.slice(0, 6), coverage, streamBase: base,
    ringColor: looks.some(l => l.result.ringColor === 'checked') ? 'checked' : 'unobservable',
    ok: { count: countOk, look: looks.length > 0 && unobservable === 0 && mismatched.length === 0 && (!sealsExpected || coverage.sealed) && coverage.live && coverage.next && (!waitingExpected || coverage.waiting) } };
}

/**
 * 뷰 실제 draw call A/B(PLAN 5절 보강). 표본 = 상태가 바뀐 직후 같은 프레임을 route.view.group 켠 채·끈 채 renderer 로 한 번씩 그린 calls({ on, off }).
 * viewGpuCalls = on − off 가 뷰의 주장(route.view.drawCalls)과 같고 상한 이하여야 한다. 표본(주장 > 0)이 minSamples 이상이고 차례·유지·봉인으로 바뀐 직후 표본을 각각 포함해야 한다.
 * 주장이 0 이어도 기록된 표본은 모두 on − off 가 0 이어야 한다(거짓 보고 방지).
 */
export function checkViewGpu(samples, { limit = VIEW_DRAW_LIMIT, minSamples = VIEW_AB_MIN_SAMPLES } = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const rows = list.map(s => {
    const gpu = Number.isFinite(s.on) && Number.isFinite(s.off) ? s.on - s.off : null;
    const looks = (s.g || []).map((_, i) => expectedLook(s, i));
    return { n: s.n, claimed: s.viewCalls ?? null, on: s.on ?? null, off: s.off ?? null, viewGpuCalls: gpu, triggers: [...new Set((s.changed || []).map(i => looks[i]))],
      matches: gpu !== null && gpu === s.viewCalls, within: gpu !== null && gpu >= 0 && gpu <= limit };
  });
  const counted = rows.filter(r => r.claimed > 0);
  const bad = rows.filter(r => !r.matches || !r.within);
  const triggered = new Set(counted.flatMap(r => r.triggers));
  const coverage = { next: triggered.has('next'), holding: triggered.has('holding'), sealed: triggered.has('sealed') };
  const gpus = rows.map(r => r.viewGpuCalls).filter(Number.isFinite);
  const ok = counted.length >= minSamples && bad.length === 0 && coverage.next && coverage.holding && coverage.sealed;
  return { classification: 'C', limit, minSamples, samples: counted.length, recorded: rows.length, max: gpus.length ? Math.max(...gpus) : null, coverage, bad: bad.slice(0, 6), rows,
    reason: ok ? null : !rows.length ? 'no-samples' : counted.length < minSamples ? 'too-few-samples' : bad.length ? 'mismatch-or-over-limit' : 'coverage', ok };
}

// ---------- 종합 ----------
/**
 * 후보 빌드의 한 번 완주 종합 판정. obs: { rows, result, resultText, win, rooms, viewAB }. opts: { reinforcements, expectWaiting, viewExpected }.
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
  const view = viewExpected ? { ...checkView(rows, def, { waitingExpected: expectWaiting }), gpu: checkViewGpu(obs.viewAB) } : null;
  const acceptance = {
    sealCount: seals.ok.count, sealOrder: seals.ok.order, holdDuration: seals.ok.hold, holdInside: seals.ok.inside, enemiesCleared: seals.ok.enemies,
    reinforcements: seals.ok.reinforcements, gateState: seals.ok.state, waiting: waiting.ok, unseal: unseal.ok, resultFields: result.ok, resultLine: line.ok, objectiveText: objective.ok,
    ...(view ? { viewCount: view.ok.count, viewLook: view.ok.look, viewGpu: view.gpu.ok } : {}),
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
    sealSpan: sealRun ? runSpan(finalRows, sealRun) : null,
    keyboard: checkKeyboardSegment(rows, 'manual2-start', 'manual2-end') };
  final.ok = final.startProgress === w && final.endProgress === w + 1 && aborted.length >= 1 && final.exitHold === 0 && final.exitOutside
    && !!sealRun && final.sealFromZero && final.sealAfterExit && final.sealSeconds + EPS >= def.holdSeconds - FRAME && final.sealSpan + EPS >= def.holdSeconds - FRAME && final.keyboard.ok;
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
 * screens 순간의 밸브 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze)이다. 뷰 갱신은 같은 스텝에서 끝나므로(2b4ea65) 촬영 행이 기대 모습과 맞아야 한다.
 * 라벨이 가리키는 밸브(want.gate)의 기대 모습이 want.look 과 같고, 뷰가 있으면 렌더된 인스턴스가 그 모습이다(물줄기 높이는 opts.streamBase, 같은 런의 차례 표본 기준).
 */
export function checkScreenMoment(shot, def, want, { viewExpected = false, streamBase: base } = {}) {
  const row = shot?.capture ?? null;
  const stateOk = !!row && expectedLook(row, want.gate) === want.look;
  if (!viewExpected) return { ok: stateOk, stateOk, looks: null };
  const look = row?.vis ? checkLook(row.vis, row, def, { streamBase: base }) : null;
  return { ok: stateOk && !!look?.ok, stateOk, looks: look ? [{ ok: look.ok, observable: look.observable, problems: look.problems }] : [] };
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
 * 두 report 의 실행 설정이 같은지: 영웅·시드·depth·재시드에 더해 viewport·motion·quality 도 같아야 비교가 성립한다(없는 값은 같지 않다고 본다).
 * cand/base: { heroId, seed, depth, reseedOn, viewport, motion, quality }.
 */
export function compareSetup(cand, base) {
  const eq = key => cand?.[key] != null && JSON.stringify(cand[key]) === JSON.stringify(base?.[key]);
  const same = { hero: eq('heroId'), seed: eq('seed'), depth: eq('depth'), reseed: eq('reseedOn'), viewport: eq('viewport'), motion: eq('motion'), quality: eq('quality') };
  return { same, ok: Object.values(same).every(Boolean) };
}
/** 1000 스텝당 50ms 초과 수(보고 항목). 스텝 수가 없거나 0 이면 null. */
export const overPer1000 = (over, steps) => (Number.isFinite(over) && Number.isFinite(steps) && steps > 0 ? over / steps * 1000 : null);
/**
 * PLAN 5절 5 기준선 비교. cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), valveRooms(cand), viewGpuMax(보고용) }.
 * 완주 시간 비 ≤ timeRatio(심층·일반), 밸브 방 첫 진입 draw call 증가 ≤ drawLimit(짝 있는 방만, 짝 0개면 실패), 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra.
 */
export function compareRuns(cand, base, { timeRatio = 2, drawLimit = 3, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio,
    parity: { target: 1, tolerance: .05, within: ratio !== null && Math.abs(ratio - 1) <= .05, note: '일반 비교(연출만 바뀐 빌드)의 1.00 ± 0.05 여부는 보고 항목이며 게이트가 아니다' } };
  const draw = roomDrawCalls(cand?.samples, base?.samples, cand?.valveRooms, drawLimit);
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra,
    report: { note: '보고 항목(게이트 아님): 1000 스텝당 50ms 초과율과 스텝 수', steps: { cand: cand?.steps ?? null, base: base?.steps ?? null },
      per1000: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps) } } };
  const viewGpu = { candidateMax: cand?.viewGpuMax ?? null, limit: VIEW_DRAW_LIMIT, note: '보고 항목: 후보 런의 뷰 실제 draw call A/B 최댓값(판정은 후보 report 의 viewGpu)' };
  return { ok: time.ok && draw.ok && slow.ok, time, drawCalls: draw, slow, viewGpu };
}
