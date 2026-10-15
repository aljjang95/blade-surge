// 잿불금고 심층(ember_vault deep) 냉각 밸브·밀물 창 QA 판정 함수 (BUNDLE-10 qa lane). 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/ember-tide-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.ember_deep)다.
// 시간·반지름·개수·방 번호는 정의(def)와 인자(opts)에서 받고, 문구·색은 BUNDLE-10 PLAN 3.0·3.1 의 계약 값을 TIDE/ACTION 상수로 적는다(정의가 그 계약과 같은지는 checkDefinition 이 따로 본다).
//
// 관측 행(상태가 바뀐 스텝, 유지(hd > 0) 중인 모든 스텝, 닫힌 조작판 대기(wait) 스텝, 1초 간격 스텝, 표식 스텝만 남긴다.
// 밸브 개방 판정에 필요한 연속 유지 구간과 닫힌 대기 표본은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, hd route.hold,
//   sl world.sealed(1/0), rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state,
//   g: 밸브마다 { id 방 id, rd gate.ready, at gate.attuned, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수,
//      ph gate.phase(0 heat · 1 warning · 2 vent · 3 그 밖), sk gate.shocks(없으면 -1), po route.padOpen(gate) (1/0, 메서드가 없으면 -1), px/pz gate.pad, ht gate.hits,
//      vn 밀물 띠 mesh visible(1/0, 뷰가 없으면 -1), pv 조작판 고리 visible, lb 상태 라벨 문자열(관측 못 하면 null), vc 밀물 띠 uniform 색(hex, 없으면 -1), pc 조작판 고리 색, vv 뷰 root visible }(전부 숫자·문자열),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(같은 상태가 0.6초 이어진 뒤 표본)
// 토스트 표본({ n, t, msg, kind })과 뷰 같은 프레임 A/B 표본(viewAB, 행과 따로 남긴다)도 입력이다.

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
// 유지(inside) 판정의 부동소수 여유. 규칙은 같은 스텝의 영웅 위치로 반경을 판정하므로 넓은 여유가 필요 없다.
export const POSITION_SLACK = .01;
// 밀물 띠 피격 위치 여유: 피격 스텝 끝의 위치는 넉백이 시작된 뒤라 띠 경계에서 조금 벗어날 수 있다.
const STRIP_SLACK = .6;
const SETTLE_STEPS = 10;
const CARRY_MAX_STEPS = 90;
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);

/** PLAN 3.0 공유 정의 계약 값. */
export const TIDE = Object.freeze({
  id: 'ember_tide_valves_deep', rooms: Object.freeze([2, 3, 4]), ventColor: 0x3d8cff, waitLabel: '밀물 대기',
  copy: Object.freeze({ title: '냉각 밸브 개방', unit: '냉각 밸브', done: '냉각 밸브', doneVerb: '개방', cooled: '개방', warning: '밀물 경고', vent: '밀물', calm: '물 빠짐',
    afterShort: '밀물 뒤', afterLong: '밀물이 빠진 뒤', avoidLong: '밀물을 피한 뒤', waitShort: '밀물 대기' }),
});
/** 목표창 action 문구(PLAN 3.1). 열림 문구는 정의의 holdSeconds 로 만든다. */
export const ACTION = Object.freeze({
  closed: '밀물이 빠진 뒤 옮겨 간 조작판으로 이동',
  avoid: '밀물을 피한 뒤 옮겨 간 조작판으로 이동',
});
/** 이 심층에서 나오면 안 되는 재벼림 문구(망치 충격파). */
export const LEAK_WORDS = Object.freeze(['망치', '충격파']);
const leaks = text => typeof text === 'string' && LEAK_WORDS.some(word => text.includes(word));
/** 목표창 열림 action: '청록 조작판에서 2초 유지'. */
export const holdPhraseOf = def => '청록 조작판에서 ' + def.holdSeconds + '초 유지';
/** 목표창 제목과 결과 줄의 이름: 정의 copy.title('냉각 밸브 개방'). */
export const valveTitle = def => def.copy?.title ?? '냉각선 복구';
/** 결과 화면 줄: '냉각 밸브 개방 3/3 · 완료'. */
export const resultLineOf = def => valveTitle(def) + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';

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
/** 영웅과 그 행에서 관측한 gate.pad 사이의 거리(관측이 없으면 무한대). */
export const padDistance = (row, index) => {
  const g = row?.g?.[index];
  return g && Number.isFinite(g.px) && Number.isFinite(g.pz) && Number.isFinite(row.x) ? Math.hypot(row.x - g.px, row.z - g.pz) : Infinity;
};
/** 열린 조작판 행: padOpen 이 참이고, 독립 관측(준비·가열·밀물 ≥ 1)이 같은 말을 한다(밀물 창 정의). */
export const isOpenRow = (row, index) => {
  const g = row?.g?.[index];
  return !!g && g.po === 1 && g.rd === 1 && g.ph === 0 && g.sk >= 1;
};
/** 닫힌 조작판 대기 행: 현재 밸브가 ready 이고 닫혀 있으며 영웅이 그 조작판 위에 있고 유지가 0 이다. */
export const isWaitRow = (row, def) => {
  const g = row?.g?.[row.pr];
  // 대기는 규칙 반경 안에서만 센다(반경 밖의 유지 0 은 반경 때문이라 닫힘의 증거가 아니다).
  return !!g && g.rd === 1 && g.at === 0 && g.po === 0 && row.hd === 0 && padDistance(row, row.pr) <= def.radius;
};

/**
 * 유지 구간. hd > 0 이 이어지는 연속 스텝(n 이 1씩 늘고 hd 가 매 스텝 늘어난다)을 한 구간으로 묶는다.
 * fromZero: 구간의 첫 hd 가 한 프레임(0 에서 새로 시작)인지. 일시정지·이탈·밀물 뒤의 유지는 0 에서 새로 시작해야 한다.
 */
export function holdRuns(rows) {
  const runs = [];
  let open = null;
  rows.forEach((row, i) => {
    if (!(row.hd > 0)) { open = null; return; }
    const prev = open ? rows[open.end] : null;
    // 같은 스텝을 한 번 더 기록한 표식 행(mk)은 유지 구간을 끊지 않는다.
    if (prev && row.n === prev.n && row.hd === prev.hd) { open.end = i; return; }
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
 * 밸브 개방 이벤트 판정. 개방 = route.progress 가 늘어난 스텝.
 * (a) 개방한 밸브의 방 id 가 정의 순서와 같음, (b) 직전 연속 유지 구간이 0 에서 새로 시작하고 엔진의 hold 값과 행의 게임 시각 길이 모두 holdSeconds − 1/60 이상,
 * (b2) 그 구간 동안 영웅이 그 밸브의 gate.pad 반경(def.radius) 안, (c) 그 구간의 모든 표본에서 조작판이 열려 있음(padOpen · ready · 가열 · 밀물 ≥ 1),
 * (d) 그 방의 살아 있는 적·대기열 0(유지 구간 전체와 개방 스텝), (e) 정예방이면 forgeWave = reinforcements,
 * 그 밖에 개방 스텝에서 그 밸브가 attuned·cleared, 앞 밸브는 모두 attuned·뒤 밸브는 모두 아직 아님, 개방 전에는 그 방이 cleared 가 아님.
 */
export function checkCoolings(rows, def, { reinforcements = 0, rooms = [] } = {}) {
  const runs = holdRuns(rows), n = def.gates.length, cools = [], violations = [];
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
    const farthest = runRows.length ? Math.max(...runRows.map(r => padDistance(r, index))) : null;
    const closedRows = runRows.filter(r => !isOpenRow(r, index)).length;
    const elite = (room?.type ?? null) === 'elite';
    const rec = {
      row: i, n: cur.n, t: cur.t, index, roomId: gate?.id ?? null, wantRoomId: want?.roomId ?? null, jump: step,
      order: step === 1 && !!want && gate?.id === want.roomId,
      hold: { found: !!run, seconds, span, fromZero: run?.fromZero ?? false, need: def.holdSeconds - FRAME,
        ok: !!run && run.fromZero && seconds + EPS >= def.holdSeconds - FRAME && span + EPS >= def.holdSeconds - FRAME },
      inside: { farthest, limit: def.radius + POSITION_SLACK, ok: !!run && !!room && farthest <= def.radius + POSITION_SLACK },
      open: { rows: runRows.length, closedRows, ok: runRows.length > 0 && closedRows === 0 },
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
    cools.push(rec);
  }
  const observedOrder = cools.map(s => s.roomId);
  const wantOrder = def.gates.map(g => g.roomId);
  for (const s of cools) {
    if (!s.order) violations.push({ kind: 'order', n: s.n, roomId: s.roomId, want: s.wantRoomId });
    if (!s.hold.ok) violations.push({ kind: 'hold', n: s.n, roomId: s.roomId, seconds: s.hold.seconds, span: s.hold.span, need: s.hold.need, fromZero: s.hold.fromZero });
    if (!s.inside.ok) violations.push({ kind: 'inside', n: s.n, roomId: s.roomId, farthest: s.inside.farthest, limit: s.inside.limit });
    if (!s.open.ok) violations.push({ kind: 'closed-pad', n: s.n, roomId: s.roomId, ...s.open });
    if (!s.cleared.ok) violations.push({ kind: 'enemies', n: s.n, roomId: s.roomId, ...s.cleared });
    if (!s.forge.ok) violations.push({ kind: 'forge', n: s.n, roomId: s.roomId, ...s.forge });
    if (!s.state.ok) violations.push({ kind: 'state', n: s.n, roomId: s.roomId, ...s.state });
  }
  return { cools, observedOrder, wantOrder, count: cools.length, target: n, violations,
    ok: {
      count: cools.length === n && rows.at(-1)?.pr === n,
      order: cools.length === n && cools.every(s => s.order) && JSON.stringify(observedOrder) === JSON.stringify(wantOrder),
      hold: cools.length > 0 && cools.every(s => s.hold.ok),
      inside: cools.length > 0 && cools.every(s => s.inside.ok),
      padOpen: cools.length > 0 && cools.every(s => s.open.ok),
      enemies: cools.length > 0 && cools.every(s => s.cleared.ok),
      reinforcements: cools.length > 0 && cools.every(s => s.forge.ok),
      state: cools.length > 0 && cools.every(s => s.state.ok),
    } };
}

/**
 * 모든 유지(hd > 0) 표본의 조작판 상태. 유지 중인 밸브의 조작판은 열려 있어야 한다(닫힌 상태의 유지는 규칙 위반).
 * 개방에 이르지 못한 유지(이탈·일시정지로 끊긴 구간)도 포함한다.
 */
export function checkHoldWindows(rows) {
  const held = rows.filter(r => r.hd > 0);
  const bad = held.filter(r => !isOpenRow(r, r.pr)).map(r => ({ n: r.n, pr: r.pr, g: r.g?.[r.pr] ?? null }));
  return { rows: held.length, bad: bad.slice(0, 6), badCount: bad.length, ok: held.length > 0 && bad.length === 0 };
}

/**
 * 닫힌 대기. 현재 밸브가 ready 인데 조작판이 닫혀 있고(밀물 전이거나 경고·밀물 중) 영웅이 조작판 위에서 유지 0 으로 기다린 표본 수.
 * 그 표본에서 그 밸브는 attuned 도 cleared 도 아니어야 한다.
 */
export function checkWaiting(rows, def, { required = true } = {}) {
  const samples = rows.filter(r => isWaitRow(r, def));
  const bad = samples.filter(r => r.g[r.pr].at !== 0 || r.g[r.pr].cl !== 0);
  const ns = new Set(samples.map(r => r.n));
  return { required, samples: ns.size, seconds: ns.size * FRAME, bad: bad.length, firstN: samples[0]?.n ?? null, ok: !required || (ns.size >= 1 && bad.length === 0) };
}

/**
 * 준비 시점. 밸브마다 처음 ready 가 된 행에서 방이 발견돼 있고 그 방의 적·대기열이 0 이며, 정예방은 증원 횟수를 모두 마친 뒤(forgeWave = reinforcements)여야 한다.
 * ready 이전의 모든 행에서 그 밸브가 현재 차례일 때 유지는 0 이다.
 */
export function checkReadyTiming(rows, def, { reinforcements = 0, rooms = [] } = {}) {
  const gates = def.gates.map((gate, i) => {
    const at = rows.findIndex(r => r.g?.[i]?.rd === 1);
    const row = at >= 0 ? rows[at] : null, g = row?.g?.[i];
    const type = roomById(rooms, gate.roomId)?.type ?? null, elite = type === 'elite';
    const early = rows.slice(0, at < 0 ? rows.length : at).filter(r => r.pr === i && r.hd > 0).length;
    const ok = !!g && g.dc === 1 && g.al === 0 && g.pd === 0 && (!elite || g.fw === reinforcements) && early === 0;
    return { index: i, roomId: gate.roomId, type, n: row?.n ?? null, discovered: g?.dc ?? null, alive: g?.al ?? null, pending: g?.pd ?? null, forgeWave: g?.fw ?? null,
      want: elite ? reinforcements : null, holdBeforeReady: early, ok };
  });
  return { gates, ok: gates.every(g => g.ok) };
}

/**
 * 순서 대기. 뒤 밸브(index > progress)의 방을 먼저 정리해 ready 가 돼도(적·대기열 0) 그 밸브는 attuned·cleared 가 아니고 진행은 늘지 않는다(앞 밸브가 열릴 때까지).
 * AUTO 의 경로에 따라 이 상황이 관측되지 않을 수 있어 observed 로 알리고, 관측된 표본에서 위반이 없으면 통과한다. 관측 필수 여부는 required 로 정한다.
 */
export function checkOrderWait(rows, def, { required = false } = {}) {
  const early = [], bad = [];
  rows.forEach(r => def.gates.forEach((_, j) => {
    const g = r.g?.[j];
    if (!g || j <= r.pr || g.rd !== 1 || g.al !== 0 || g.pd !== 0) return;
    early.push({ n: r.n, gate: j });
    if (g.at !== 0 || g.cl !== 0) bad.push({ n: r.n, gate: j, at: g.at, cl: g.cl, pr: r.pr });
  }));
  const gates = [...new Set(early.map(e => e.gate))];
  return { required, observed: early.length > 0, rows: early.length, gates, bad: bad.slice(0, 6), badCount: bad.length, ok: bad.length === 0 && (!required || early.length > 0) };
}

/**
 * 밀물 주기. 현재 밸브의 단계 길이(경고 warningSeconds · 밀물 ventSeconds · 밀물 뒤 물 빠짐 heatSeconds)를 행 사이의 게임 시각 차로 재서 ±2프레임 안인지,
 * 밀물 횟수(shocks)가 준비된 뒤 시작된 밀물이 끝날 때만 +1 인지, 조작판이 밀물이 끝나는 행에서만 반대편(방 중심 ± padOffset)으로 옮겨 가는지 본다.
 * 첫 물 빠짐(관측 시작부터의 구간)은 시작 시각을 알 수 없어 길이를 재지 않는다.
 */
export function checkTideCycle(rows, def, { rooms = [] } = {}) {
  const tol = 2 * FRAME + EPS, durations = { warning: [], vent: [], calm: [] }, bad = [];
  let shockEnds = 0, flips = 0;
  def.gates.forEach((gate, i) => {
    const room = roomById(rooms, gate.roomId);
    let seg = null, prevRow = null;
    for (const r of rows) {
      const g = r.g?.[i];
      if (!g) continue;
      if (prevRow && r.n === prevRow.n) { continue; }
      const before = prevRow?.g?.[i] ?? null;
      // 조작판은 밀물이 끝나는 행(밀물 → 물 빠짐)에서만 움직인다.
      if (before && (before.px !== g.px || before.pz !== g.pz) && !(before.ph === 2 && g.ph === 0)) bad.push({ kind: 'pad-moved', gate: i, n: r.n, from: [before.px, before.pz], to: [g.px, g.pz] });
      if (!seg) seg = { ph: g.ph, t: r.t, prev: null, rd: g.rd, rdBefore: g.rd };
      else if (g.ph !== seg.ph) {
        const len = r.t - seg.t, name = seg.ph === 1 ? 'warning' : seg.ph === 2 ? 'vent' : seg.ph === 0 && seg.prev === 2 ? 'calm' : null;
        const want = name === 'warning' ? def.warningSeconds : name === 'vent' ? def.ventSeconds : name === 'calm' ? def.heatSeconds : null;
        const wanted = (seg.ph === 0 && g.ph === 1) || (seg.ph === 1 && g.ph === 2) || (seg.ph === 2 && g.ph === 0);
        if (name && wanted) {
          durations[name].push({ gate: i, n: r.n, seconds: len });
          if (Math.abs(len - want) > tol) bad.push({ kind: 'duration', gate: i, phase: name, seconds: len, want, n: r.n });
        }
        if (seg.ph === 2 && g.ph === 0 && before) {
          shockEnds++;
          const gain = g.sk - before.sk;
          // 밀물이 시작된 스텝에 ready 가 막 켜진 경우(rdBefore ≠ rd)는 같은 스텝 안의 순서를 알 수 없어 0·1 둘 다 허용한다.
          const armed = seg.rd === 1 && seg.rdBefore === 1, unarmed = seg.rd !== 1, okGain = armed ? gain === 1 : unarmed ? gain === 0 : (gain === 0 || gain === 1);
          if (!okGain) bad.push({ kind: 'shocks', gate: i, n: r.n, armed, unarmed, gain });
          const side0 = before.px - (room?.x ?? NaN), side1 = g.px - (room?.x ?? NaN);
          const flipped = Math.abs(Math.abs(side1) - def.padOffset) <= POSITION_SLACK && Math.abs(side0 + side1) <= POSITION_SLACK;
          if (flipped) flips++; else bad.push({ kind: 'pad-flip', gate: i, n: r.n, before: side0, after: side1, offset: def.padOffset });
        } else if (before && g.sk !== before.sk && !(seg.ph === 2 && g.ph === 0)) bad.push({ kind: 'shocks-moved', gate: i, n: r.n, from: before.sk, to: g.sk });
        seg = { ph: g.ph, t: r.t, prev: seg.ph, rd: g.rd, rdBefore: before?.rd ?? g.rd };
      }
      prevRow = r;
    }
  });
  const count = durations.warning.length + durations.vent.length + durations.calm.length;
  return { durations, shockEnds, flips, bad: bad.slice(0, 8), badCount: bad.length, ok: bad.length === 0 && durations.warning.length >= 1 && durations.vent.length >= 1 && shockEnds >= 1 && flips === shockEnds, count };
}

/**
 * 밀물 띠 피해(gate.hits). 늘어난 행은 (a) 그 밸브가 현재 차례, (b) 밀물 단계, (c) 영웅이 띠(폭 4 × 길이 12, 중심 = 방 중심 ∓ padOffset 의 조작판 반대편) 안,
 * 한 밀물에 한 번만 늘어난다. 최종 hits 합계는 결과 보고의 overheatHits 와 같아야 한다(checkResultFields 가 비교). hp 하락 비율은 보고용이다.
 */
export function checkTideHits(rows, def, { rooms = [], stripWidth = 4, stripLength = 12 } = {}) {
  const hits = [], bad = [];
  let total = 0;
  def.gates.forEach((gate, i) => {
    const room = roomById(rooms, gate.roomId);
    let window = 0, hitsInWindow = 0, prev = null, last = 0;
    rows.forEach((r, k) => {
      const g = r.g?.[i];
      if (!g) return;
      if (prev && prev.ph !== 2 && g.ph === 2) { window++; hitsInWindow = 0; }
      if (prev && g.ht > prev.ht) {
        hitsInWindow += g.ht - prev.ht;
        const stripX = (room?.x ?? NaN) * 2 - g.px, stripZ = room?.z ?? NaN;
        const inside = Math.abs(r.x - stripX) <= stripWidth / 2 + STRIP_SLACK && Math.abs(r.z - stripZ) <= stripLength / 2 + STRIP_SLACK;
        const before = rows[k - 1];
        const ratio = before && before.n === r.n - 1 && r.mhp > 0 ? (before.hp - r.hp) / r.mhp : null;
        hits.push({ gate: i, n: r.n, ratio, inside });
        if (r.pr !== i) bad.push({ kind: 'not-current', gate: i, n: r.n, pr: r.pr });
        if (g.ph !== 2) bad.push({ kind: 'not-vent', gate: i, n: r.n, ph: g.ph });
        if (!inside) bad.push({ kind: 'outside-strip', gate: i, n: r.n, hero: [r.x, r.z], strip: [stripX, stripZ] });
        if (hitsInWindow > 1) bad.push({ kind: 'repeat', gate: i, n: r.n, windowHits: hitsInWindow });
      }
      last = g.ht;
      prev = g;
    });
    total += last;
  });
  return { total, hits, bad: bad.slice(0, 6), badCount: bad.length, ok: bad.length === 0 };
}

/**
 * 보스 봉인 해제. world.sealed 가 처음 false 가 된 스텝은 progress = n 이고 모든 비보스·비시작 방이 cleared 인 뒤여야 한다.
 * 시작부터 sealed 였고, 마지막 개방 스텝 뒤에 해제된다.
 */
export function checkUnseal(rows, def) {
  const n = def.gates.length;
  const first = rows.findIndex(r => r.sl === 0);
  const startsSealed = rows[0]?.sl === 1;
  if (first < 0) return { ok: false, startsSealed, reason: 'never-unsealed' };
  const row = rows[first], prev = rows[first - 1];
  const lastCool = [...rows.keys()].filter(i => i > 0 && rows[i].pr > rows[i - 1].pr).at(-1) ?? -1;
  const ok = startsSealed && prev?.sl === 1 && row.pr === n && row.rem === 0 && first > lastCool;
  return { ok, startsSealed, n: row.n, t: row.t, progress: row.pr, remaining: row.rem, afterLastCool: first > lastCool, reason: ok ? null : 'early-or-inconsistent' };
}

/**
 * 결과 객체: { id, label, complete: true, progress n, target n, rooms = 정의 순서, overheatHits }.
 * overheatHits 는 0 이상의 정수이고, hitsTotal(관측한 gate.hits 합계)이 주어지면 같아야 한다.
 */
export function checkResultFields(ro, def, win = true, { hitsTotal = null } = {}) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId);
  const got = ro ? { id: ro.id, label: ro.label ?? null, complete: ro.complete, progress: ro.progress, target: ro.target, rooms: [...(ro.rooms || [])], overheatHits: ro.overheatHits } : null;
  const hitsOk = !!ro && Number.isInteger(ro.overheatHits) && ro.overheatHits >= 0 && (hitsTotal === null || ro.overheatHits === hitsTotal);
  const ok = !!ro && win === true && ro.id === def.id && ro.label === valveTitle(def) && ro.complete === true && ro.progress === n && ro.target === n
    && JSON.stringify(ro.rooms) === JSON.stringify(rooms) && hitsOk;
  return { ok, got, hitsOk, hitsTotal, want: { id: def.id, label: valveTitle(def), complete: true, progress: n, target: n, rooms } };
}
/** 결과 화면 줄: '냉각 밸브 개방 3/3 · 완료'. */
export function checkResultLine(text, def) {
  const line = resultLineOf(def);
  return { ok: typeof text === 'string' && text.includes(line), line };
}
/** 결과 줄 요소(기존 일반 줄): aria-label '<제목> 결과' 이고 본문이 '<제목> n/n · 완료'. lines: [{ aria, text }]. */
export function checkResultElement(lines, def) {
  const aria = valveTitle(def) + ' 결과', line = resultLineOf(def);
  const found = (lines || []).filter(l => l?.aria === aria);
  const ok = found.length === 1 && String(found[0].text).replace(/\s+/g, ' ').trim() === line;
  return { ok, aria, line, found: found.map(l => l.text) };
}

/** PLAN 3.1 의 밸브 이름(방 2 · 3 · 4 순서)과 냉각 장치 수치(엔진·수치 그대로). */
export const VALVE_LABELS = Object.freeze(['1번 냉각 밸브 · 좌현 화물칸', '2번 냉각 밸브 · 우현 화물칸', '3번 냉각 밸브 · 기관실 격벽']);
export const MECHANICS = Object.freeze({ holdSeconds: 2, radius: 1.6, padOffset: 3.5, heatSeconds: 4, warningSeconds: 1.4, ventSeconds: .8 });

/** 대상 프로젝트의 정의(ROUTE_OBJECTIVES.ember_deep)가 PLAN 3.0·3.1 계약과 같은지. 어긋난 항목을 issues 로 돌려준다. */
export function checkDefinition(def) {
  if (!def) return { ok: false, issues: [{ field: 'definition', got: null }] };
  const issues = [];
  const want = (field, got, expected) => { if (JSON.stringify(got) !== JSON.stringify(expected)) issues.push({ field, got, want: expected }); };
  want('id', def.id, TIDE.id); want('kind', def.kind, 'cooling'); want('shockWindow', !!def.shockWindow, true); want('ventColor', def.ventColor, TIDE.ventColor);
  want('rooms', (def.gates || []).map(g => g.roomId), [...TIDE.rooms]); want('labels', (def.gates || []).map(g => g.label), [...VALVE_LABELS]);
  for (const [key, value] of Object.entries(TIDE.copy)) want('copy.' + key, def.copy?.[key], value);
  for (const [key, value] of Object.entries(MECHANICS)) want(key, def[key], value);
  return { ok: issues.length === 0, issues };
}

/**
 * 관측값(ready · phase · padOpen)으로 계산한 목표창 action 기대 문구. ready 가 아니면 null(이 구역의 적과 증원 처치 단계라 표본을 쓰지 않는다).
 * 경고·밀물 중 → 밀물을 피하는 문구, 가열 중 닫힘 → 밀물이 빠진 뒤 이동 문구, 열림 → 유지 문구.
 */
export function expectedAction(g, def) {
  if (!g || g.rd !== 1) return null;
  const hot = g.ph === 1 || g.ph === 2;
  return hot ? ACTION.avoid : g.po === 1 ? holdPhraseOf(def) : ACTION.closed;
}
/**
 * 목표창 표본(같은 상태가 0.6초 이어져 10Hz 갱신이 지난 뒤). 모든 표본에 제목과 그 상태의 기대 action 이 있고 재벼림 문구(망치·충격파)가 없어야 한다.
 * 밸브마다 그 밸브가 준비된 뒤 표본이 1개 이상, 전체에서 열림 표본과 닫힘(조작판이 닫힌 ready) 표본이 각각 1개 이상, 밸브마다 열린 조작판 표본이 1개 이상이어야 한다.
 * 경고·밀물 중 표본(avoid)은 보고 항목이다.
 */
export function checkObjectiveSamples(rows, def, cools) {
  const title = valveTitle(def), phrase = holdPhraseOf(def);
  const samples = rows.filter(r => typeof r.dom === 'string');
  const kinds = samples.map(r => ({ row: r, g: r.g?.[r.pr], want: expectedAction(r.g?.[r.pr], def) }));
  const bad = kinds.filter(k => !k.row.dom.includes(title) || k.want === null || !k.row.dom.includes(k.want) || leaks(k.row.dom)).map(k => ({ n: k.row.n, want: k.want, dom: k.row.dom }));
  const open = kinds.filter(k => k.want === phrase && k.g?.po === 1);
  const closed = kinds.filter(k => k.g?.po === 0 && k.want === ACTION.closed);
  const avoid = kinds.filter(k => k.want === ACTION.avoid);
  const missing = [], openMissing = [];
  for (const c of cools) {
    const first = rows.findIndex(r => r.g?.[c.index]?.rd === 1);
    const window = first >= 0 ? rows.slice(first, c.row) : [];
    if (!window.some(r => typeof r.dom === 'string' && r.pr === c.index)) missing.push({ index: c.index, roomId: c.roomId });
    // 열린 표본: 이 개방의 마지막 열린 구간(닫힘 행 이후)에서 열림 문구가 나와야 한다.
    let from = c.row - 1;
    while (from > 0 && isOpenRow(rows[from - 1], c.index)) from--;
    if (!rows.slice(from, c.row).some(r => typeof r.dom === 'string' && r.pr === c.index && r.dom.includes(phrase))) openMissing.push({ index: c.index, roomId: c.roomId });
  }
  return { title, phrase, samples: samples.length, open: open.length, closed: closed.length, avoid: avoid.length, bad: bad.slice(0, 6), missing, openMissing,
    ok: samples.length > 0 && bad.length === 0 && missing.length === 0 && open.length >= 1 && closed.length >= 1 && openMissing.length === 0 };
}

/**
 * 토스트 표본({ n, t, msg, kind }). 밸브마다 준비 토스트 '<이름> 방어 완료 · 밀물이 빠진 뒤 청록 조작판에서 2초 유지' 1회,
 * 개방 토스트 '<이름> 개방 · 냉각 밸브 k/n 개방' 1회(k 순서), 밀물 피해 토스트 '밀물 피해 · 밀물 뒤 옮겨 간 조작판으로 이동'은 결과 overheatHits 와 같은 횟수.
 * 조작판·밸브·냉각·밀물을 말하는 토스트에는 재벼림 문구(망치·충격파)가 없어야 한다.
 */
export function checkToasts(toasts, def, { overheatHits = null } = {}) {
  const list = (toasts || []).map(t => String(t?.msg ?? ''));
  const n = def.gates.length;
  const count = text => list.filter(m => m === text).length;
  const ready = def.gates.map(g => ({ text: g.label + ' 방어 완료 · ' + TIDE.copy.afterLong + ' 청록 조작판에서 2초 유지' }));
  const cooled = def.gates.map((g, i) => ({ text: g.label + ' ' + TIDE.copy.cooled + ' · ' + TIDE.copy.done + ' ' + (i + 1) + '/' + n + ' ' + TIDE.copy.doneVerb }));
  for (const item of [...ready, ...cooled]) item.count = count(item.text);
  const hitText = TIDE.copy.vent + ' 피해 · ' + TIDE.copy.afterShort + ' 옮겨 간 조작판으로 이동';
  const hitCount = count(hitText);
  const order = cooled.map(c => list.indexOf(c.text));
  const ordered = order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]));
  const leaked = list.filter(m => /조작판|밸브|냉각|밀물/.test(m) && leaks(m));
  const ok = ready.every(r => r.count === 1) && cooled.every(c => c.count === 1) && ordered && leaked.length === 0 && (overheatHits === null || hitCount === overheatHits);
  return { ok, ready, cooled, hitText, hitCount, overheatHits, ordered, leaked, total: list.length };
}

/**
 * 밸브 뷰 표시(PLAN 3.2): 밀물 띠 색 = def.ventColor(파란 물빛), 닫힌 조작판(ready · 닫힘)의 라벨 = '밀물 대기', 재벼림 문구 없음, 현재 밸브가 경고·밀물 중일 때 띠가 보이고 가열 중에는 숨음.
 * 라벨은 관측할 수 있을 때만(lb 가 문자열인 행이 있을 때) 요구한다(관측 못 하면 labelObservable false 로 알린다).
 */
export function checkTideView(rows, def) {
  const cells = rows.flatMap(r => (r.g || []).map((g, i) => ({ r, g, i })));
  const colors = cells.filter(c => Number.isFinite(c.g.vc) && c.g.vc >= 0);
  const colorBad = colors.filter(c => c.g.vc !== def.ventColor).slice(0, 4).map(c => ({ n: c.r.n, gate: c.i, vc: c.g.vc }));
  const labelObservable = cells.some(c => typeof c.g.lb === 'string');
  const labelRows = cells.filter(c => c.r.pr === c.i && c.g.rd === 1 && c.g.at === 0 && c.g.po === 0 && typeof c.g.lb === 'string');
  const labelBad = labelRows.filter(c => c.g.lb !== TIDE.waitLabel).slice(0, 4).map(c => ({ n: c.r.n, gate: c.i, lb: c.g.lb }));
  const leakBad = cells.filter(c => leaks(c.g.lb)).slice(0, 4).map(c => ({ n: c.r.n, gate: c.i, lb: c.g.lb }));
  const hotRows = cells.filter(c => c.r.pr === c.i && (c.g.ph === 1 || c.g.ph === 2) && c.g.vn !== -1 && c.g.vn !== undefined);
  const calmRows = cells.filter(c => c.r.pr === c.i && c.g.ph === 0 && c.g.vn !== -1 && c.g.vn !== undefined);
  const stripBad = [...hotRows.filter(c => c.g.vn !== 1), ...calmRows.filter(c => c.g.vn !== 0)].slice(0, 4).map(c => ({ n: c.r.n, gate: c.i, ph: c.g.ph, vn: c.g.vn }));
  const ok = colors.length > 0 && colorBad.length === 0 && labelBad.length === 0 && leakBad.length === 0 && stripBad.length === 0 && hotRows.length > 0 && (!labelObservable || labelRows.length > 0);
  return { ok, ventColor: def.ventColor, colorRows: colors.length, colorBad, labelObservable, labelRows: labelRows.length, labelBad, leakBad, hotRows: hotRows.length, calmRows: calmRows.length, stripBad };
}
/** 밸브 뷰가 방 발견 같은 스텝에 보이는지(vv = dc). 보고 항목이다(냉각 장치 GLB 뷰는 기존 뷰). */
export function checkViewSync(rows, def) {
  let observable = 0;
  const mismatches = [];
  for (const r of rows.filter(x => x.n > 0)) def.gates.forEach((_, i) => {
    const g = r.g?.[i];
    if (!g || g.vv === -1 || g.vv === undefined) return;
    observable++;
    if (g.vv !== g.dc) mismatches.push({ n: r.n, gate: i, visible: g.vv, discovered: g.dc });
  });
  return { observable, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 6) };
}
/**
 * 경로 목표 뷰 같은 프레임 A/B(보고 항목, 게이트 아님). 표본: { on 뷰 켠 렌더 calls, offView 끈 렌더 calls, changed, codes }.
 * 냉각 장치 GLB 뷰는 기존 뷰라 증가를 판정하지 않고 최대·평균과 표본 수를 알린다.
 */
export function summarizeViewAB(samples) {
  const diffs = (samples || []).map(s => (Number.isFinite(s.on) && Number.isFinite(s.offView) ? s.on - s.offView : null)).filter(Number.isFinite);
  return { classification: 'C', samples: diffs.length, recorded: (samples || []).length, max: diffs.length ? Math.max(...diffs) : null, min: diffs.length ? Math.min(...diffs) : null,
    mean: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null, note: '보고 항목(게이트 아님): route.view.group 표시/숨김 같은 프레임 calls 차이' };
}

// ---------- 종합 ----------
/**
 * 후보 빌드의 한 번 완주 종합 판정. obs: { rows, result, resultText, resultLines, win, rooms, toasts, viewAB }.
 * opts: { reinforcements }. ok 는 acceptance 의 모든 항목이 통과일 때만 true 다.
 */
export function analyzeTide(obs, def, { reinforcements = 0 } = {}) {
  const rows = obs.rows || [];
  const definition = checkDefinition(def);
  const cools = checkCoolings(rows, def, { reinforcements, rooms: obs.rooms });
  const holds = checkHoldWindows(rows);
  const waiting = checkWaiting(rows, def, { required: true });
  const ready = checkReadyTiming(rows, def, { reinforcements, rooms: obs.rooms });
  const orderWait = checkOrderWait(rows, def);
  const cycle = checkTideCycle(rows, def, { rooms: obs.rooms });
  const hits = checkTideHits(rows, def, { rooms: obs.rooms });
  const unseal = checkUnseal(rows, def);
  const result = checkResultFields(obs.result, def, obs.win === true, { hitsTotal: hits.total });
  const line = checkResultLine(obs.resultText, def);
  const element = checkResultElement(obs.resultLines, def);
  const objective = checkObjectiveSamples(rows, def, cools.cools);
  const toasts = checkToasts(obs.toasts, def, { overheatHits: obs.result?.overheatHits ?? null });
  const view = checkTideView(rows, def);
  const sync = checkViewSync(rows, def);
  const viewAB = summarizeViewAB(obs.viewAB);
  const acceptance = {
    definition: definition.ok, coolCount: cools.ok.count, coolOrder: cools.ok.order, holdDuration: cools.ok.hold, holdInside: cools.ok.inside, padOpen: cools.ok.padOpen, holdWindows: holds.ok,
    enemiesCleared: cools.ok.enemies, reinforcements: cools.ok.reinforcements, readyTiming: ready.ok, gateState: cools.ok.state, waiting: waiting.ok, orderWait: orderWait.ok,
    tideCycle: cycle.ok, tideHits: hits.ok, unseal: unseal.ok, resultFields: result.ok, resultLine: line.ok, resultElement: element.ok, objectiveText: objective.ok,
    toasts: toasts.ok, tideView: view.ok,
  };
  return { ok: Object.values(acceptance).every(Boolean), acceptance, cools: cools.cools, observedOrder: cools.observedOrder, wantOrder: cools.wantOrder, violations: cools.violations,
    definition, holds, waiting, ready, orderWait, cycle, hits, unseal, result, resultLine: line, resultElement: element, objective, toasts, view, sync, viewAB, rows: rows.length };
}

// ---------- order 프로필(키보드) ----------
const markIndex = (rows, label) => rows.findIndex(r => r.mk === label);
const markOf = (rows, label) => rows[markIndex(rows, label)] ?? null;
/** 키보드 구간 판정. 표식 from~to 사이 행에서 AUTO 꺼짐 · 공격 입력 없음 · 공격/스킬/회피 state 없음(시작 직후 SETTLE_STEPS 제외) · 영웅 생존. */
export function checkKeyboardSegment(rows, from, to) {
  const ia = markIndex(rows, from), ib = markIndex(rows, to), a = rows[ia], b = rows[ib];
  if (!a || !b || ib < ia) return { ok: false, reason: 'missing-mark', from, to, found: [!!a, !!b] };
  const seg = rows.slice(ia, ib + 1);
  const settled = seg.filter(r => r.n >= a.n + SETTLE_STEPS);
  const autoRows = seg.filter(r => r.au === 1).length, held = seg.filter(r => r.ah === 1).length;
  // 면제하는 정상 경로 하나: AUTO 를 끄기 전에 이미 시작된 동작(구간 첫 행이 동작 중)이 끝날 때까지의 첫 연속 구간.
  // 그 구간에 공격 입력이 하나라도 있으면 면제하지 않는다.
  let carry = 0;
  if (ACTION_STATES.includes(a.ps)) {
    // 상한 CARRY_MAX_STEPS(1.5초): 한 동작이 끝나는 시간 안에서만 면제한다.
    while (carry < seg.length && ACTION_STATES.includes(seg[carry].ps) && seg[carry].ah !== 1 && seg[carry].n - a.n < CARRY_MAX_STEPS) carry++;
  }
  const carryRows = seg.slice(0, carry);
  const carried = new Set(carryRows);
  const action = settled.filter(r => !carried.has(r) && ACTION_STATES.includes(r.ps)).length;
  const dead = seg.filter(r => r.al !== 1 || !(r.hp > 0)).length;
  return { ok: seg.length > 0 && autoRows === 0 && held === 0 && action === 0 && dead === 0, rows: seg.length, steps: b.n - a.n, autoRows, attackHeld: held, actionRows: action,
    carriedActionRows: carryRows.length, dead };
}
/**
 * order 프로필 판정(첫 밸브 index 0, 키보드만). 표식: manual-start(AUTO 끔) · pad1(조작판 반경 안) · tide1(첫 밀물 뒤, shocks 1) · partial(열린 유지 ≥ 1.0) ·
 * exit(조작판에서 3.0 밖) · warn(다음 밀물 경고) · dwell-end(닫힌 체류를 마친 밀물 뒤) · cooled(progress 1).
 * dwell: manual-start~dwell-end 에서 영웅이 조작판 반경 안인 ready·닫힘 스텝의 합계 ≥ minDwell(2초)이고 그동안 유지 0 · 개방 없음.
 * partial: 열린 유지 구간이 0 에서 시작해 ≥ 1.0초, 그 뒤 이탈로 hold 0(progress 불변).
 * final: 마지막 닫힌 체류(dwell-end) 뒤에 0 에서 시작한 새 유지가 holdSeconds − 1/60 이상 모두 열린 조작판에서 이어져 개방.
 * 모든 구간이 AUTO 꺼짐 · 공격 입력 없음 · 영웅 생존이다.
 */
export function analyzeOrder(rows, def, { rooms = [], minDwell = 2, minPartial = 1, exitDistance = 3 } = {}) {
  const idx = 0;
  const names = ['manual-start', 'pad1', 'tide1', 'partial', 'exit', 'warn', 'dwell-end', 'cooled'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, dwell: { ok: false }, partial: { ok: false }, final: { ok: false }, keyboard: { ok: false } };
  const at = k => markIndex(rows, k);
  const seg = rows.slice(at('manual-start'), at('cooled') + 1);
  const keyboard = checkKeyboardSegment(rows, 'manual-start', 'cooled');
  // 닫힌 체류: 마지막 닫힌 체류 끝(dwell-end)까지 영웅이 조작판 위에서 ready · 닫힘으로 기다린 스텝(n 중복 제거).
  const dwellSeg = rows.slice(at('manual-start'), at('dwell-end') + 1);
  const isOnPad = r => { const g = r.g?.[idx]; return r.pr === idx && !!g && g.rd === 1 && g.at === 0 && g.po === 0 && padDistance(r, idx) <= def.radius; };
  const onPad = dwellSeg.filter(isOnPad);
  const steps = new Set(onPad.map(r => r.n));
  const windowSeconds = (a, b) => new Set(rows.slice(at(a), at(b) + 1).filter(isOnPad).map(r => r.n)).size * FRAME;
  const dwell = { seconds: steps.size * FRAME, need: minDwell - 2 * FRAME, holdWhileClosed: onPad.filter(r => r.hd > 0).length,
    coolWhileClosed: onPad.filter(r => r.g[idx].at === 1 || r.g[idx].cl === 1 || r.pr > idx).length,
    firstWindow: windowSeconds('pad1', 'tide1'), secondWindow: windowSeconds('warn', 'dwell-end') };
  dwell.ok = dwell.seconds + EPS >= dwell.need && dwell.holdWhileClosed === 0 && dwell.coolWhileClosed === 0;
  // 열린 유지 ≥ 1.0 뒤 이탈.
  const partialRows = rows.slice(at('tide1'), at('exit') + 1);
  const runs = holdRuns(partialRows);
  // 구간 바로 뒤의 다음 스텝 행(표식 행은 같은 스텝의 중복이라 건너뛴다)이 유지 0 이고 progress 불변이어야 한다.
  const nextStep = run => partialRows.slice(run.end + 1).find(r => r.n > partialRows[run.end].n) ?? null;
  const aborted = runs.filter(run => run.fromZero && run.max + EPS >= minPartial && partialRows.slice(run.start, run.end + 1).every(r => isOpenRow(r, idx))
    && nextStep(run)?.hd === 0 && nextStep(run)?.pr === idx);
  const exitRow = m.exit, exitPad = padDistance(exitRow, idx);
  const partial = { abortedMax: aborted.length ? Math.max(...aborted.map(a => a.max)) : null, exitHold: exitRow.hd, exitDistance: exitPad, exitProgress: exitRow.pr,
    ok: aborted.length >= 1 && exitRow.hd === 0 && exitPad + EPS >= exitDistance && exitRow.pr === idx };
  // 마지막 새 유지로 개방.
  const coolings = checkCoolings(rows, def, { rooms });
  const cool = coolings.cools.find(c => c.index === idx) ?? null;
  const final = { cooled: !!cool, startProgress: m['dwell-end'].pr, endProgress: m.cooled.pr, seconds: cool?.hold.seconds ?? null, span: cool?.hold.span ?? null, fromZero: cool?.hold.fromZero ?? false,
    open: cool?.open.ok ?? false, startsAfterDwell: false };
  if (cool) {
    const run = holdRuns(rows).find(r => r.end === cool.row - 1);
    final.startsAfterDwell = !!run && rows[run.start].n > m['dwell-end'].n;
  }
  final.ok = !!cool && cool.order && cool.hold.ok && cool.open.ok && cool.inside.ok && final.startsAfterDwell && final.startProgress === idx && final.endProgress === idx + 1;
  return { ok: keyboard.ok && dwell.ok && partial.ok && final.ok, keyboard, dwell, partial, final, rows: seg.length };
}

// ---------- pause 프로필 ----------
/**
 * 열린 유지 중 일시정지. before: 정지 직전(hold ≥ 0.8), paused: 정지 직후, still: 120스텝+1초 뒤, resumed: 재개 뒤 steps 스텝.
 * 각 인자는 페이지 freeze 결과 { elapsed, paused, pr, hd, gx: [{ ag, ph, sk }] }. 게임 시간 · 밀물 주기(age · phase · shocks) · progress 불변, hold 0,
 * 재개 뒤 hold 는 0 에서 새로 시작(steps 프레임을 넘지 않음)하고 정지 직전 값에서 이어지지 않는다.
 */
export function checkPause({ before, paused, still, resumed, steps, minHold = .8 }) {
  const cycle = o => (o?.gx?.[0] ? [o.gx[0].ag, o.gx[0].ph, o.gx[0].sk] : null);
  const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const frozen = !!before && !!paused && !!still && before.hd >= minHold - EPS && paused.hd === 0 && still.hd === 0
    && paused.elapsed === before.elapsed && still.elapsed === before.elapsed && paused.pr === before.pr && still.pr === before.pr
    && same(cycle(before), cycle(paused)) && same(cycle(before), cycle(still));
  const restartedFromZero = !!resumed && resumed.hd >= 0 && resumed.hd <= steps * FRAME + EPS;
  const resumedOk = frozen && restartedFromZero && resumed.pr === before.pr && resumed.elapsed > still.elapsed
    && Math.abs(resumed.elapsed - still.elapsed - steps * FRAME) <= 2 * FRAME;
  return { ok: frozen && resumedOk, frozen, resumedOk, restartedFromZero, expectedAdvance: steps * FRAME,
    before: before ?? null, paused: paused ?? null, still: still ?? null, resumed: resumed ?? null };
}
/** 재개 뒤 첫 개방의 유지 구간이 재개 이후에 0 에서 시작해 holdSeconds − 1/60 이상 모두 열린 조작판에서 이어졌는지. 표식 resume 필요. */
export function analyzePauseCooling(rows, def, { rooms = [], reinforcements = 0 } = {}) {
  const mark = markOf(rows, 'resume');
  if (!mark) return { ok: false, reason: 'missing-mark' };
  const cools = checkCoolings(rows, def, { reinforcements, rooms }).cools;
  const first = cools.find(s => s.n > mark.n) ?? null;
  if (!first) return { ok: false, reason: 'no-cooling-after-resume' };
  const run = holdRuns(rows).find(r => r.end === first.row - 1);
  const startN = run ? rows[run.start].n : null;
  return { ok: !!run && startN > mark.n && run.fromZero && first.hold.ok && first.open.ok && first.order, coolN: first.n, runStartN: startN, resumeN: mark.n, seconds: first.hold.seconds, need: def.holdSeconds - FRAME, open: first.open };
}

// ---------- keys 프로필(PLAN 3.3: 정지·재개 뒤 눌려 있던 이동 키) ----------
/**
 * 입력 수리 판정. 도구는 키보드 이벤트를 단계(hold · pause · resume · release)별로 기록한다.
 * k: { x0 키를 누르기 전 영웅 x, hold: 행[] (KeyD 를 누른 채), pause: { before, paused, still } (페이지 freeze), resumeX0 재개 시점 x, resume: 행[] (키 이벤트 없음),
 *      release: 행[] (keyup 뒤), events: [{ phase, op, key }], interrupted: null | { segment, reason } }.
 * 행: { n, t, x, z, kd app.input.keys.KeyD(1/0), en input.enabled, pa battle.paused }.
 * 판정(PLAN 3.3): 재개 뒤 키 이벤트 없이 steps 스텝 안에 영웅 x 가 minMove 이상 늘고 그때 KeyD 가 true, keyup 뒤 steps 스텝 안에 멈추고 KeyD 가 false.
 * 키 이벤트 로그가 pause · resume 단계에 비어 있고 hold 에는 KeyD down 1회, release 에는 KeyD up 1회뿐이어야 한다(재입력 우회는 실증이 아니다).
 */
export function summarizeKeys(k, { steps = 30, minMove = .5, stopSlack = .05 } = {}) {
  const hold = k?.hold ?? [], resume = k?.resume ?? [], release = k?.release ?? [], events = k?.events ?? [];
  const phase = name => events.filter(e => e.phase === name);
  const holdMoved = hold.length ? hold.at(-1).x - k.x0 : null;
  const gains = resume.map(r => r.x - k.resumeX0);
  const first = gains.findIndex(g => g >= minMove);
  const tail = release.slice(-Math.min(15, release.length));
  const stopMove = tail.length >= 2 ? Math.hypot(tail.at(-1).x - tail[0].x, tail.at(-1).z - tail[0].z) : null;
  const p = k?.pause ?? {};
  return {
    holdRows: hold.length, holdMoved, holdKeyDown: hold.length > 0 && hold.every(r => r.kd === 1),
    pauseFrozen: !!p.before && !!p.paused && !!p.still && p.paused.paused === true && p.still.paused === true && p.paused.elapsed === p.before.elapsed && p.still.elapsed === p.before.elapsed
      && p.still.x === p.paused.x && p.still.z === p.paused.z,
    resumeRows: resume.length, resumeGain: gains.length ? Math.max(...gains) : null, movedAtStep: first >= 0 ? first + 1 : null, keyDownAtMove: first >= 0 ? resume[first].kd === 1 : false,
    keyDownAtEnd: resume.length > 0 && resume.at(-1).kd === 1, resumeEnabled: resume.some(r => r.en === 1),
    releaseRows: release.length, releaseKeyUp: release.length > 0 && release.every(r => r.kd === 0), stopMove,
    holdEvents: phase('hold').map(e => e.op + ' ' + e.key), pauseEvents: phase('pause').map(e => e.op + ' ' + e.key), resumeEvents: phase('resume').map(e => e.op + ' ' + e.key),
    releaseEvents: phase('release').map(e => e.op + ' ' + e.key), interrupted: k?.interrupted ?? null,
    steps, minMove,
  };
}
export function checkKeys(k, opts = {}) {
  const s = summarizeKeys(k, opts), steps = s.steps;
  const precondition = !s.interrupted && s.holdRows === steps && s.holdMoved >= s.minMove && s.holdKeyDown && s.pauseFrozen;
  const resumed = s.resumeRows === steps && s.resumeGain >= s.minMove && s.keyDownAtMove && s.keyDownAtEnd && s.resumeEnabled;
  const released = s.releaseRows === steps && s.releaseKeyUp && s.stopMove !== null && s.stopMove <= (opts.stopSlack ?? .05);
  const events = JSON.stringify(s.holdEvents) === JSON.stringify(['down KeyD']) && s.pauseEvents.length === 0 && s.resumeEvents.length === 0
    && JSON.stringify(s.releaseEvents) === JSON.stringify(['up KeyD']);
  return { ok: precondition && resumed && released && events, precondition, resumed, released, events, ...s };
}
/** 기준선 모드: 같은 단계를 돌려 이동 여부만 기록한다. 판정하지 않는다(judged false). */
export function describeBaselineKeys(k, opts = {}) {
  const s = summarizeKeys(k, opts);
  return { judged: false, moved: s.resumeGain !== null && s.resumeGain >= s.minMove, holdMoved: s.holdMoved, resumeGain: s.resumeGain, keyDownAtEnd: s.keyDownAtEnd, stoppedAfterRelease: s.releaseKeyUp && s.stopMove !== null && s.stopMove <= (opts.stopSlack ?? .05),
    interrupted: s.interrupted, events: { hold: s.holdEvents, pause: s.pauseEvents, resume: s.resumeEvents, release: s.releaseEvents } };
}

// ---------- screens 프로필 ----------
/** 순간 이름(게임 흐름과 무관한 관측 상태): 닫힌 조작판 · 밀물 경고 · 밀물 · 열린 조작판 · 개방 직후. */
export const MOMENTS = Object.freeze(['closed', 'warning', 'vent', 'open', 'opened']);
/** 모든 순간에 도달했고 순간마다 viewport 개수만큼 PNG 가 있는지. */
export function checkScreens(shots, labels, viewportCount) {
  const rows = labels.map(label => {
    const shot = (shots || []).find(s => s.label === label);
    return { label, reached: !!shot?.reached, files: shot?.files?.length ?? 0, ok: !!shot?.reached && shot.files?.length === viewportCount };
  });
  return { ok: rows.length > 0 && rows.every(r => r.ok), rows };
}
/**
 * screens 순간의 첫 밸브(index 0) 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze)이다. 라벨의 관측 조건(독립 관측값)과 뷰 표시가 맞아야 한다.
 * closed: ready · 가열 · 닫힘 · 유지 0, 뷰 라벨 '밀물 대기'(관측 가능할 때). warning/vent: 경고/밀물 단계, 띠가 보이고 색 = def.ventColor.
 * open: 열린 조작판에서 유지 ≥ 1.0, 조작판 고리 보임. opened: 개방 뒤 0.1초 이상(attuned · cleared), 띠 숨김.
 */
export function checkScreenMoment(shot, def, label) {
  const row = shot?.capture ?? null, g = row?.g?.[0], idx = 0;
  const ra = g?.ra ?? null;
  const state = { closed: !!g && row.pr === idx && g.rd === 1 && g.at === 0 && g.ph === 0 && g.po === 0 && row.hd === 0,
    warning: !!g && row.pr === idx && g.rd === 1 && g.ph === 1, vent: !!g && row.pr === idx && g.rd === 1 && g.ph === 2,
    open: !!g && row.pr === idx && isOpenRow(row, idx) && row.hd >= 1 - EPS, opened: !!g && g.at === 1 && g.cl === 1 && ra !== null && ra >= .1 - EPS }[label] ?? false;
  const stripColor = !!g && (g.vc === -1 || g.vc === def.ventColor);
  const view = {
    closed: !g || g.lb === null || g.lb === undefined || g.lb === TIDE.waitLabel,
    warning: !!g && g.vn !== 0 && stripColor, vent: !!g && g.vn !== 0 && stripColor,
    open: !!g && g.pv !== 0, opened: !!g && g.vn !== 1,
  }[label] ?? false;
  return { ok: state && view && !leaks(g?.lb), state, view, label, gate: g ? { id: g.id, rd: g.rd, at: g.at, ph: g.ph, sk: g.sk, po: g.po, hd: row.hd, vn: g.vn, pv: g.pv, lb: g.lb ?? null, vc: g.vc } : null };
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
 * 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. 심층 전용이라 기준선에는 경로 정의(ember_deep)가 없고 후보에는 있어야 한다.
 * 두 report 의 HEAD 는 달라야 한다(같은 빌드끼리의 비교는 합격하지 않는다). 후보는 밸브 판정(tideOk)까지 통과해야 한다.
 */
export function compareTargetsOk(cand, base) {
  if (!cand || !base) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const definition = !base.routeDefinition && cand.routeDefinition?.id === TIDE.id;
  return differs && definition && cand.tideOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/** 두 report 의 실행 설정이 같은지: 영웅 · 시드 · depth · 재시드 · viewport · motion · quality 가 같아야 비교가 성립한다(없는 값은 같지 않다고 본다). */
export function compareSetup(cand, base) {
  const eq = key => cand?.[key] != null && JSON.stringify(cand[key]) === JSON.stringify(base?.[key]);
  const same = { hero: eq('heroId'), seed: eq('seed'), depth: eq('depth'), reseed: eq('reseedOn'), viewport: eq('viewport'), motion: eq('motion'), quality: eq('quality') };
  return { same, ok: Object.values(same).every(Boolean) };
}
/** 1000 스텝당 50ms 초과 수(보고 항목). 스텝 수가 없거나 0 이면 null. */
export const overPer1000 = (over, steps) => (Number.isFinite(over) && Number.isFinite(steps) && steps > 0 ? over / steps * 1000 : null);
/** 어느 쪽이 먼저 돌았는지(보고 항목). started 는 report.started(ISO). 짝은 순서를 섞어 돌리므로 뒤에 돈 쪽의 부하 영향을 읽는 데 쓴다. */
export function runOrder(candStarted, baseStarted) {
  const c = Date.parse(candStarted), b = Date.parse(baseStarted);
  return Number.isFinite(c) && Number.isFinite(b) ? (c < b ? 'cand-first' : b < c ? 'base-first' : 'same-time') : 'unknown';
}
/**
 * PLAN 5절 5 기준선 비교(한 짝). cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), valveRooms(cand), routeViewAB(보고용), load, started }.
 * 사전 선언된 게이트: 완주 시간 비 ≤ timeRatio, 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra.
 * 보고 항목(게이트 아님): 밸브 방 첫 진입 draw call 증가, 50ms 초과율, 경로 목표 뷰 표시/숨김 calls 차이, 실행 전후 1분 load, 실행 순서.
 */
export function compareRuns(cand, base, { timeRatio = 2, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio };
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  const gates = { time: time.ok, slow: slow.ok };
  const report = {
    note: '보고 항목(게이트 아님, PLAN 5절 5 사전 선언): 밸브 방 첫 진입 draw call 증가 · 50ms 초과율 · 경로 목표 뷰 같은 프레임 A/B · 실행 전후 load · 실행 순서',
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.valveRooms),
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    routeViewAB: cand?.routeViewAB ?? null,
    load: { cand: cand?.load ?? null, base: base?.load ?? null },
    order: runOrder(cand?.started, base?.started),
  };
  return { ok: Object.values(gates).every(Boolean), gates, time, slow, report };
}
