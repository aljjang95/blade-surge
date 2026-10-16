// 재벼림 제련소 심장로 냉각(BUNDLE-08) QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/ashforge-furnace-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.ashforge_*)다.
// 시간·반지름·개수·방 번호는 모두 인자(def, opts)로 받는다. 이 파일에는 게임 수치를 박지 않는다(문구와 연출 계약 상수만 PLAN 3.1·3.2 에서 가져온다).
//
// 관측 행(상태가 바뀐 스텝, 유지(hd > 0) 중인 모든 스텝, 닫힌 조작판 대기(wait) 스텝, 1초 간격 스텝, 표식 스텝만 남긴다.
// 냉각 판정에 필요한 연속 유지 구간과 닫힌 대기 표본은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress, hd route.hold,
//   sl world.sealed(1/0), rem 보스·시작을 뺀 미정화 방 수, au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state,
//   g: 심장로마다 { id 방 id, rd gate.ready, at gate.attuned, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수,
//      ph gate.phase(0 heat · 1 warning · 2 vent · 3 그 밖), sk gate.shocks(없으면 -1), po route.padOpen(gate) (1/0, 메서드가 없으면 -1), px/pz gate.pad,
//      vv route.view.entries[i].root.visible (1/0, 없으면 -1) }(전부 숫자),
//   rv releaseView 관측 { c: count, d: drawCalls, s: states 를 STATE_NAMES 번호로, cs: 심장로별 사슬 인스턴스 scale 최댓값 } 또는 null(releaseView 없음),
//   mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(같은 상태가 0.6초 이어진 뒤 표본)
// 뷰 같은 프레임 A/B 표본(viewAB, 행과 따로 남긴다): { n, t, pr, hd, g: [{ dc, at, rd, po, ra 냉각 뒤 경과 또는 null }], changed: 바뀐 심장로 index[],
//   relCalls releaseView.drawCalls, viewCalls route.view.drawCalls, on 둘 다 켠 렌더 calls, offRelease 사슬 뷰만 끈 calls, offAll 사슬 뷰와 냉각 장치 뷰를 모두 끈 calls }

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/**
 * 영웅 위치 관측은 스텝 끝이다. battle.update 는 player.update 뒤에 updateExpedition(route.update)을 부르므로 판정 위치는 이동이 반영된 뒤다.
 * 그 뒤 같은 스텝의 군중 밀림과 투사체·넉백 후처리가 위치를 조금 더 옮길 수 있어 한 프레임 이동량(≈0.15)보다 넉넉한 여유를 둔다.
 */
// 유지(inside) 판정의 부동소수 여유. 규칙은 같은 스텝의 영웅 위치로 반경을 판정하므로 넓은 여유가 필요 없다(리뷰 P2-2: .25 는 반경 회귀를 가렸다).
export const POSITION_SLACK = .01;
const SETTLE_STEPS = 10;
const CARRY_MAX_STEPS = 90;
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 해방 연출 상태 이름(PLAN 3.2). rv.s 는 이 순서의 번호다(알 수 없는 이름은 9). */
export const STATE_NAMES = Object.freeze(['hidden', 'bound', 'shock', 'open', 'releasing', 'released']);
export const STATE_CODE = Object.freeze(Object.fromEntries(STATE_NAMES.map((name, i) => [name, i])));
/** 심장로마다 인스턴스 10개(사슬 4가닥 + 불씨 6개)와 draw call 2회 이하(PLAN 3.2). */
export const INSTANCES_PER_FURNACE = 10;
export const CHAINS_PER_FURNACE = 4;
export const VIEW_DRAW_LIMIT = 2;
export const SCALE_EPS = 1e-4;
const VIEW_AB_MIN_SAMPLES = 3;
/** 목표창 action 문구(PLAN 3.1). 열림 문구는 정의의 holdSeconds 로 만든다. */
export const ACTION = Object.freeze({
  closed: '망치 충격파 뒤 옮겨 간 조작판으로 이동',
  avoid: '망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동',
  plainAvoid: '분출을 피하고 청록 조작판으로 이동',
});
/** 목표창 열림 action: '청록 조작판에서 2초 유지'. */
export const holdPhraseOf = def => '청록 조작판에서 ' + def.holdSeconds + '초 유지';
/** 목표창 제목과 결과 줄의 이름: 정의 copy.title('심장로 냉각', 일반 '용광로 냉각'). */
export const furnaceTitle = def => def.copy?.title ?? '냉각선 복구';
/** 결과 화면 줄: '심장로 냉각 4/4 · 완료'. */
export const resultLineOf = def => furnaceTitle(def) + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';

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
/** 열린 조작판 행: padOpen 이 참이고, 독립 관측(준비·가열·충격파 ≥ 1)이 같은 말을 한다(shockWindow 정의). */
export const isOpenRow = (row, index) => {
  const g = row?.g?.[index];
  return !!g && g.po === 1 && g.rd === 1 && g.ph === 0 && g.sk >= 1;
};
/** 닫힌 조작판 대기 행: 현재 심장로가 ready 이고 닫혀 있으며 영웅이 그 조작판 위에 있고 유지가 0 이다. */
export const isWaitRow = (row, def) => {
  const g = row?.g?.[row.pr];
  // 대기는 규칙 반경 안에서만 센다(반경 밖의 유지 0 은 반경 때문이라 닫힘의 증거가 아니다).
  return !!g && g.rd === 1 && g.at === 0 && g.po === 0 && row.hd === 0 && padDistance(row, row.pr) <= def.radius;
};

/**
 * 유지 구간. hd > 0 이 이어지는 연속 스텝(n 이 1씩 늘고 hd 가 매 스텝 늘어난다)을 한 구간으로 묶는다.
 * fromZero: 구간의 첫 hd 가 한 프레임(0 에서 새로 시작)인지. 일시정지·이탈·충격파 뒤의 유지는 0 에서 새로 시작해야 한다.
 */
export function holdRuns(rows) {
  const runs = [];
  let open = null;
  rows.forEach((row, i) => {
    if (!(row.hd > 0)) { open = null; return; }
    const prev = open ? rows[open.end] : null;
    // 같은 스텝을 한 번 더 기록한 표식 행(mk)은 유지 구간을 끊지 않는다(smoke-order-1: 'partial' 표식 행이 열린 유지를 둘로 나눴다).
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
 * 냉각 이벤트 판정. 냉각 = route.progress 가 늘어난 스텝.
 * (a) 냉각한 심장로의 방 id 가 정의 순서와 같음, (b) 직전 연속 유지 구간이 0 에서 새로 시작하고 엔진의 hold 값과 행의 게임 시각 길이 모두 holdSeconds − 1/60 이상,
 * (b2) 그 구간 동안 영웅이 그 심장로의 gate.pad 반경(def.radius) 안, (c) 그 구간의 모든 표본에서 조작판이 열려 있음(shockWindow 정의: padOpen · ready · 가열 · 충격파 ≥ 1, 일반: padOpen 이 닫힌 적 없음),
 * (d) 그 방의 살아 있는 적·대기열 0(유지 구간 전체와 냉각 스텝), (e) 정예방이면 forgeWave = reinforcements,
 * 그 밖에 냉각 스텝에서 그 심장로가 attuned·cleared, 앞 심장로는 모두 attuned·뒤 심장로는 모두 아직 아님, 냉각 전에는 그 방이 cleared 가 아님.
 */
export function checkCoolings(rows, def, { reinforcements = 0, rooms = [] } = {}) {
  const runs = holdRuns(rows), n = def.gates.length, shock = !!def.shockWindow, cools = [], violations = [];
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
    const closedRows = runRows.filter(r => (shock ? !isOpenRow(r, index) : r.g?.[index]?.po === 0)).length;
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
 * 모든 유지(hd > 0) 표본의 조작판 상태. shockWindow 정의는 유지 중인 심장로의 조작판이 열려 있어야 한다(닫힌 상태의 유지는 규칙 위반).
 * 일반 정의는 padOpen 이 닫힌 적이 없어야 한다(-1 은 padOpen 메서드가 없는 빌드).
 * 냉각에 이르지 못한 유지(이탈·일시정지로 끊긴 구간)도 포함한다.
 */
export function checkHoldWindows(rows, def) {
  const shock = !!def.shockWindow;
  const held = rows.filter(r => r.hd > 0);
  const bad = held.filter(r => (shock ? !isOpenRow(r, r.pr) : r.g?.[r.pr]?.po === 0)).map(r => ({ n: r.n, pr: r.pr, g: r.g?.[r.pr] ?? null }));
  // 일반 정의: 어떤 행의 어떤 심장로에서도 padOpen 이 닫혀 있으면 안 된다.
  const closedAnywhere = shock ? 0 : rows.filter(r => (r.g || []).some(g => g.po === 0)).length;
  return { rows: held.length, bad: bad.slice(0, 6), badCount: bad.length, closedAnywhere, ok: held.length > 0 && bad.length === 0 && closedAnywhere === 0 };
}

/**
 * 닫힌 대기(심층). 현재 심장로가 ready 인데 조작판이 닫혀 있고(충격파 전이거나 예고·분출 중) 영웅이 조작판 위에서 유지 0 으로 기다린 표본 수.
 * 그 표본에서 그 심장로는 attuned 도 cleared 도 아니어야 한다. 일반에서는 요구하지 않는다.
 */
export function checkWaiting(rows, def, { required = true } = {}) {
  const samples = rows.filter(r => isWaitRow(r, def));
  const bad = samples.filter(r => r.g[r.pr].at !== 0 || r.g[r.pr].cl !== 0);
  const ns = new Set(samples.map(r => r.n));
  return { required, samples: ns.size, seconds: ns.size * FRAME, bad: bad.length, firstN: samples[0]?.n ?? null, ok: !required || (ns.size >= 1 && bad.length === 0) };
}

/**
 * 보스 봉인 해제. world.sealed 가 처음 false 가 된 스텝은 progress = n 이고 모든 비보스·비시작 방이 cleared 인 뒤여야 한다.
 * 시작부터 sealed 였고, 마지막 냉각 스텝 뒤에 해제된다.
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

/** 결과 객체: { id, label 제목, complete: true, progress n, target n, rooms = 정의 순서 }. */
export function checkResultFields(ro, def, win = true) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId);
  const got = ro ? { id: ro.id, label: ro.label ?? null, complete: ro.complete, progress: ro.progress, target: ro.target, rooms: [...(ro.rooms || [])] } : null;
  const ok = !!ro && win === true && ro.id === def.id && ro.complete === true && ro.progress === n && ro.target === n
    && JSON.stringify(ro.rooms) === JSON.stringify(rooms) && (ro.label === undefined || ro.label === furnaceTitle(def));
  return { ok, got, want: { id: def.id, label: furnaceTitle(def), complete: true, progress: n, target: n, rooms } };
}
/** 결과 화면 줄: '심장로 냉각 4/4 · 완료'(일반 '용광로 냉각 4/4 · 완료'). */
export function checkResultLine(text, def) {
  const line = resultLineOf(def);
  return { ok: typeof text === 'string' && text.includes(line), line };
}

/**
 * 관측값(ready · phase · padOpen)으로 계산한 목표창 action 기대 문구. ready 가 아니면 null(이 구역의 적과 증원 처치 단계라 표본을 쓰지 않는다).
 * shockWindow: 예고·분출 중 → 망치 충격파를 피하는 문구, 가열 중 닫힘 → 충격파 뒤 이동 문구, 열림 → 유지 문구.
 * 일반: 예고·분출 중 → 분출을 피하는 문구, 그 밖 → 유지 문구.
 */
export function expectedAction(g, def) {
  if (!g || g.rd !== 1) return null;
  const hot = g.ph === 1 || g.ph === 2;
  if (def.shockWindow) return hot ? ACTION.avoid : g.po === 1 ? holdPhraseOf(def) : ACTION.closed;
  return hot ? ACTION.plainAvoid : holdPhraseOf(def);
}
/**
 * 목표창 표본(같은 상태가 0.6초 이어져 10Hz 갱신이 지난 뒤). 모든 표본에 제목과 그 상태의 기대 action 이 있어야 한다.
 * 냉각마다 그 심장로가 준비된 뒤 표본이 1개 이상, 심층(shockWindow)은 전체에서 열림 표본과 닫힘(조작판이 닫힌 ready) 표본이 각각 1개 이상, 냉각마다 열린 조작판 표본이 1개 이상이어야 한다.
 */
export function checkObjectiveSamples(rows, def, cools) {
  const title = furnaceTitle(def), phrase = holdPhraseOf(def), shock = !!def.shockWindow;
  const samples = rows.filter(r => typeof r.dom === 'string');
  const kinds = samples.map(r => ({ row: r, g: r.g?.[r.pr], want: expectedAction(r.g?.[r.pr], def) }));
  const bad = kinds.filter(k => !k.row.dom.includes(title) || k.want === null || !k.row.dom.includes(k.want)).map(k => ({ n: k.row.n, want: k.want, dom: k.row.dom }));
  const open = kinds.filter(k => k.want === phrase && (!shock || k.g?.po === 1));
  const closed = kinds.filter(k => shock && k.g?.po === 0 && k.want !== null);
  const closedHeat = kinds.filter(k => k.want === ACTION.closed);
  const missing = [], openMissing = [];
  for (const c of cools) {
    const first = rows.findIndex(r => r.g?.[c.index]?.rd === 1);
    const window = first >= 0 ? rows.slice(first, c.row) : [];
    if (!window.some(r => typeof r.dom === 'string' && r.pr === c.index)) missing.push({ index: c.index, roomId: c.roomId });
    // 열린 표본: 이 냉각의 마지막 열린 구간(닫힘 행 이후)에서 열림 문구가 나와야 한다.
    if (shock) {
      let from = c.row - 1;
      while (from > 0 && isOpenRow(rows[from - 1], c.index)) from--;
      if (!rows.slice(from, c.row).some(r => typeof r.dom === 'string' && r.pr === c.index && r.dom.includes(phrase))) openMissing.push({ index: c.index, roomId: c.roomId });
    }
  }
  return { title, phrase, samples: samples.length, open: open.length, closed: closed.length, closedHeat: closedHeat.length, bad: bad.slice(0, 6), missing, openMissing,
    ok: samples.length > 0 && bad.length === 0 && missing.length === 0 && (!shock || (open.length >= 1 && closed.length >= 1 && openMissing.length === 0)) };
}

// ---------- 해방 연출 뷰 ----------
/**
 * 관측값(discovered/attuned/progress/ready/padOpen/냉각 뒤 경과)으로 계산한 심장로의 기대 상태 집합. 뷰의 furnaceState 를 복사하지 않고 계약(PLAN 3.2)에서 다시 쓴다.
 * 방 미발견 → hidden, attuned → 경과 < releaseSeconds 면 releasing 그 뒤 released(경계 ±1.5프레임은 둘 다 허용),
 * 현재 심장로 ready + 열림 → open, ready + 닫힘 → shock, 그 밖 → bound.
 */
export function expectedStates(g, index, progress, age, def) {
  if (!g || g.dc !== 1) return ['hidden'];
  if (g.at === 1) {
    const rs = def.releaseSeconds ?? 0, tol = 1.5 * FRAME;
    if (!Number.isFinite(age) || age < rs - tol) return ['releasing'];
    if (age > rs + tol) return ['released'];
    return ['releasing', 'released'];
  }
  if (index === progress && g.rd === 1) return g.po === 0 ? ['shock'] : ['open'];
  return ['bound'];
}
/** 각 심장로가 처음 attuned 로 관측된 행의 게임 시각(없으면 null). */
export const coolTimes = (rows, def) => def.gates.map((_, i) => rows.find(r => r.g?.[i]?.at === 1)?.t ?? null);

/**
 * releaseView 판정(행 단위). 시작 행(n 0, 첫 update 전)은 제외한다.
 * count: 모든 행에서 count = 심장로 수 × 10 · drawCalls ≤ 2,
 * states: 모든 행에서 rv.s[i] 가 관측 기대 상태 집합 안,
 * chainLook: 보이는 상태(bound · shock · open)면 사슬 scale > 0, 숨은 상태(hidden · released)면 0,
 * chainRelease: 냉각한 뒤 releaseSeconds + 1/60 안에 그 심장로 사슬 scale 이 0(그 시각 이후 행이 있어야 확인 가능),
 * discover: 방 발견 스텝(그 심장로의 dc 가 처음 1 인 행)의 같은 스텝 표본에서 state 가 hidden 이 아님.
 */
export function checkRelease(rows, def) {
  const n = def.gates.length, rs = def.releaseSeconds ?? 0;
  const body = rows.filter(r => r.n > 0);
  const missing = body.filter(r => !r.rv).length;
  const withRv = body.filter(r => r.rv);
  const cool = coolTimes(rows, def);
  const countBad = withRv.filter(r => r.rv.c !== n * INSTANCES_PER_FURNACE).map(r => ({ n: r.n, count: r.rv.c }));
  const drawBad = withRv.filter(r => !(Number.isFinite(r.rv.d) && r.rv.d <= VIEW_DRAW_LIMIT)).map(r => ({ n: r.n, drawCalls: r.rv.d }));
  const stateBad = [], lookBad = [];
  for (const r of withRv) {
    for (let i = 0; i < n; i++) {
      const got = STATE_NAMES[r.rv.s?.[i]] ?? 'unknown';
      const g = r.g?.[i];
      const age = g?.at === 1 && cool[i] !== null ? r.t - cool[i] : null;
      const allowed = expectedStates(g, i, r.pr, age, def);
      if (!allowed.includes(got)) stateBad.push({ n: r.n, gate: i, got, allowed });
      const scale = r.rv.cs?.[i];
      if (['bound', 'shock', 'open'].includes(got) && !(scale > SCALE_EPS)) lookBad.push({ n: r.n, gate: i, got, scale, kind: 'chain-missing' });
      if (['hidden', 'released'].includes(got) && !(scale <= SCALE_EPS)) lookBad.push({ n: r.n, gate: i, got, scale, kind: 'chain-left' });
    }
  }
  const release = def.gates.map((gate, i) => {
    if (cool[i] === null) return { gate: i, cooled: false, ok: true };
    const deadline = cool[i] + rs + FRAME + EPS;
    const after = rows.findIndex(r => r.t >= deadline);
    let last = -1;
    for (let k = 0; k < rows.length; k++) if (rows[k].t <= deadline) last = k;
    const scale = last >= 0 ? rows[last].rv?.cs?.[i] ?? null : null;
    return { gate: i, cooled: true, coolT: cool[i], deadline, observedAfter: after >= 0, scale, ok: after >= 0 && scale !== null && scale <= SCALE_EPS };
  });
  const discover = def.gates.map((gate, i) => {
    const r = body.find(x => x.g?.[i]?.dc === 1);
    const got = r?.rv ? STATE_NAMES[r.rv.s?.[i]] ?? 'unknown' : null;
    return { gate: i, n: r?.n ?? null, state: got, ok: !!r && got !== null && got !== 'hidden' };
  });
  const ok = {
    count: withRv.length > 0 && missing === 0 && countBad.length === 0 && drawBad.length === 0,
    states: withRv.length > 0 && stateBad.length === 0,
    chainLook: withRv.length > 0 && lookBad.length === 0,
    chainRelease: release.every(x => x.ok) && release.some(x => x.cooled),
    discover: discover.every(x => x.ok),
  };
  return { rows: withRv.length, missing, countBad: countBad.slice(0, 4), drawBad: drawBad.slice(0, 4), stateBad: stateBad.slice(0, 8), stateBadCount: stateBad.length,
    lookBad: lookBad.slice(0, 8), release, discover, ok };
}
/** 사슬 인스턴스가 심장로 순서대로(심장로마다 연속 4개) 놓였는지: 프로브가 한 번 읽은 인스턴스 위치로 확인한 결과를 받는다. */
export function checkChainLayout(layout, gateCount) {
  const seen = layout?.seen ?? [];
  const mismatches = layout?.mismatches ?? [];
  const all = Array.from({ length: gateCount }, (_, i) => seen[i] === true);
  return { seen: all, mismatches: mismatches.slice(0, 6), ok: all.every(Boolean) && mismatches.length === 0 };
}
/** 냉각 장치 뷰(route.view)의 방 발견 같은 프레임 표시: vv(뷰 root.visible)가 dc(방 발견)와 모든 행에서 같다. expected 가 거짓(syncView 가 없는 기준선)이면 불일치 수만 보고한다. */
export function checkViewSync(rows, def, { expected = true } = {}) {
  const body = rows.filter(r => r.n > 0);
  let observable = 0;
  const mismatches = [];
  for (const r of body) def.gates.forEach((_, i) => {
    const g = r.g?.[i];
    if (!g || g.vv === -1 || g.vv === undefined) return;
    observable++;
    if (g.vv !== g.dc) mismatches.push({ n: r.n, gate: i, visible: g.vv, discovered: g.dc });
  });
  return { expected, observable, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 6), ok: !expected || (observable > 0 && mismatches.length === 0) };
}

/**
 * 같은 프레임 A/B(C 제어 렌더). 심장로 모습이 바뀐 스텝 끝에서 releaseView.group 을 켠 채·끈 채 한 번씩 그린 렌더 calls 차이(gpu = on − offRelease)가
 * 0 이상 limit(2) 이하이고 releaseView.drawCalls 와 같아야 한다. 표본(주장 > 0)이 minSamples 이상이고 bound · open · releasing 으로 바뀐 직후 표본을 각각 포함해야 한다.
 * 보고: 냉각 장치 뷰(route.view.group)까지 끈 경로 목표 전체 차이(routeGpu = on − offAll)와 releaseView + route.view 주장 합계와의 일치.
 */
export function checkViewGpu(samples, def, { limit = VIEW_DRAW_LIMIT, minSamples = VIEW_AB_MIN_SAMPLES } = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const rows = list.map(s => {
    const gpu = Number.isFinite(s.on) && Number.isFinite(s.offRelease) ? s.on - s.offRelease : null;
    const routeGpu = Number.isFinite(s.on) && Number.isFinite(s.offAll) ? s.on - s.offAll : null;
    const routeClaimed = Number.isFinite(s.relCalls) && Number.isFinite(s.viewCalls) ? s.relCalls + s.viewCalls : null;
    const triggers = [...new Set((s.changed || []).map(i => expectedStates(s.g?.[i], i, s.pr, s.g?.[i]?.ra, def)[0]))];
    return { n: s.n, claimed: s.relCalls ?? null, routeClaimed, on: s.on ?? null, offRelease: s.offRelease ?? null, offAll: s.offAll ?? null, viewGpuCalls: gpu, routeGpuCalls: routeGpu, triggers,
      matches: gpu !== null && gpu === s.relCalls, within: gpu !== null && gpu >= 0 && gpu <= limit, routeMatches: routeGpu !== null && routeGpu === routeClaimed };
  });
  const counted = rows.filter(r => r.claimed > 0);
  const bad = rows.filter(r => !r.matches || !r.within);
  const triggered = new Set(counted.flatMap(r => r.triggers));
  const coverage = { bound: triggered.has('bound'), open: triggered.has('open'), releasing: triggered.has('releasing'), shock: triggered.has('shock') };
  const gpus = rows.map(r => r.viewGpuCalls).filter(Number.isFinite);
  const routeGpus = rows.map(r => r.routeGpuCalls).filter(Number.isFinite);
  const ok = counted.length >= minSamples && bad.length === 0 && coverage.bound && coverage.open && coverage.releasing;
  return { classification: 'C', limit, minSamples, samples: counted.length, recorded: rows.length, max: gpus.length ? Math.max(...gpus) : null, coverage, bad: bad.slice(0, 6), rows,
    route: { note: '보고 항목: 냉각 장치 뷰(route.view.group)까지 포함한 경로 목표 전체 A/B', max: routeGpus.length ? Math.max(...routeGpus) : null,
      mismatches: rows.filter(r => !r.routeMatches).length, samples: routeGpus.length },
    reason: ok ? null : !rows.length ? 'no-samples' : counted.length < minSamples ? 'too-few-samples' : bad.length ? 'mismatch-or-over-limit' : 'coverage', ok };
}

// ---------- 종합 ----------
/**
 * 후보 빌드의 한 번 완주 종합 판정. obs: { rows, result, resultText, win, rooms, viewAB, layout, hasRelease }.
 * opts: { reinforcements, expectWaiting(심층: 닫힌 대기 표본 필수), releaseExpected(def.release 가 있는 후보), syncExpected(route.syncView 가 있는 후보) }.
 * ok 는 acceptance 의 모든 항목이 통과일 때만 true 다. 정의에 해방 연출이 없으면(일반) releaseView 가 없어야 한다.
 */
export function analyzeFurnaces(obs, def, { reinforcements = 0, expectWaiting = false, releaseExpected = false, syncExpected = false } = {}) {
  const rows = obs.rows || [];
  const cools = checkCoolings(rows, def, { reinforcements, rooms: obs.rooms });
  const holds = checkHoldWindows(rows, def);
  const waiting = checkWaiting(rows, def, { required: expectWaiting });
  const unseal = checkUnseal(rows, def);
  const result = checkResultFields(obs.result, def, obs.win === true);
  const line = checkResultLine(obs.resultText, def);
  const objective = checkObjectiveSamples(rows, def, cools.cools);
  const sync = checkViewSync(rows, def, { expected: syncExpected });
  const release = releaseExpected ? { ...checkRelease(rows, def), layout: checkChainLayout(obs.layout, def.gates.length), gpu: checkViewGpu(obs.viewAB, def) } : null;
  const noRelease = releaseExpected ? null : { hasRelease: !!obs.hasRelease, rowsWithView: rows.filter(r => r.rv).length };
  const acceptance = {
    coolCount: cools.ok.count, coolOrder: cools.ok.order, holdDuration: cools.ok.hold, holdInside: cools.ok.inside, padOpen: cools.ok.padOpen, holdWindows: holds.ok,
    enemiesCleared: cools.ok.enemies, reinforcements: cools.ok.reinforcements, gateState: cools.ok.state, waiting: waiting.ok, unseal: unseal.ok,
    resultFields: result.ok, resultLine: line.ok, objectiveText: objective.ok,
    ...(syncExpected ? { viewSync: sync.ok } : {}),
    ...(release ? { releaseCount: release.ok.count, releaseStates: release.ok.states, releaseChains: release.ok.chainLook && release.ok.chainRelease,
      releaseDiscover: release.ok.discover, releaseLayout: release.layout.ok, releaseGpu: release.gpu.ok } : { noRelease: !noRelease.hasRelease && noRelease.rowsWithView === 0 }),
  };
  return { ok: Object.values(acceptance).every(Boolean), acceptance, cools: cools.cools, observedOrder: cools.observedOrder, wantOrder: cools.wantOrder, violations: cools.violations,
    holds, waiting, unseal, result, resultLine: line, objective, sync, release, noRelease, rows: rows.length };
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
  // 그 구간에 공격 입력이 하나라도 있으면 면제하지 않는다(smoke-order-1: AUTO 의 회전 베기가 끈 뒤 56스텝 이어졌다).
  let carry = 0;
  if (ACTION_STATES.includes(a.ps)) {
    // 상한 CARRY_MAX_STEPS(1.5초): 한 동작이 끝나는 시간 안에서만 면제한다(smoke 실측 56스텝).
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
 * order 프로필 판정(첫 심장로 index 0, 키보드만). 표식: manual-start(AUTO 끔) · pad1(조작판 반경 1.2 안) · shock1(첫 충격파 뒤, shocks 1) · partial(열린 유지 ≥ 1.0) ·
 * exit(조작판에서 3.0 밖) · warn(다음 망치 예고) · dwell-end(닫힌 체류를 마친 충격파 뒤) · cooled(progress 1).
 * dwell: manual-start~dwell-end 에서 영웅이 조작판 반경 안인 ready·닫힘 스텝의 합계 ≥ minDwell(2초)이고 그동안 유지 0 · 냉각 없음.
 * partial: 열린 유지 구간이 0 에서 시작해 ≥ 1.0초, 그 뒤 이탈로 hold 0(progress 불변).
 * final: 마지막 닫힌 체류(dwell-end) 뒤에 0 에서 시작한 새 유지가 holdSeconds − 1/60 이상 모두 열린 조작판에서 이어져 냉각.
 * 모든 구간이 AUTO 꺼짐 · 공격 입력 없음 · 영웅 생존이다.
 */
export function analyzeOrder(rows, def, { rooms = [], minDwell = 2, minPartial = 1, exitDistance = 3 } = {}) {
  const idx = 0;
  const names = ['manual-start', 'pad1', 'shock1', 'partial', 'exit', 'warn', 'dwell-end', 'cooled'];
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
    firstWindow: windowSeconds('pad1', 'shock1'), secondWindow: windowSeconds('warn', 'dwell-end') };
  dwell.ok = dwell.seconds + EPS >= dwell.need && dwell.holdWhileClosed === 0 && dwell.coolWhileClosed === 0;
  // 열린 유지 ≥ 1.0 뒤 이탈.
  const partialRows = rows.slice(at('shock1'), at('exit') + 1);
  const runs = holdRuns(partialRows);
  // 구간 바로 뒤의 다음 스텝 행(표식 행은 같은 스텝의 중복이라 건너뛴다)이 유지 0 이고 progress 불변이어야 한다.
  const nextStep = run => partialRows.slice(run.end + 1).find(r => r.n > partialRows[run.end].n) ?? null;
  const aborted = runs.filter(run => run.fromZero && run.max + EPS >= minPartial && partialRows.slice(run.start, run.end + 1).every(r => isOpenRow(r, idx))
    && nextStep(run)?.hd === 0 && nextStep(run)?.pr === idx);
  const exitRow = m.exit, exitPad = padDistance(exitRow, idx);
  const partial = { abortedMax: aborted.length ? Math.max(...aborted.map(a => a.max)) : null, exitHold: exitRow.hd, exitDistance: exitPad, exitProgress: exitRow.pr,
    ok: aborted.length >= 1 && exitRow.hd === 0 && exitPad + EPS >= exitDistance && exitRow.pr === idx };
  // 마지막 새 유지로 냉각.
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
 * 각 인자는 페이지 freeze 결과 { elapsed, paused, pr, hd, gx: [{ ag, ph, sk }] }. 게임 시간 · 심장로 주기(age · phase · shocks) · progress 불변, hold 0,
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
/** 재개 뒤 첫 냉각의 유지 구간이 재개 이후에 0 에서 시작해 holdSeconds − 1/60 이상 모두 열린 조작판에서 이어졌는지. 표식 resume 필요. */
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
 * screens 순간의 심장로 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze, rv 포함)이다. 라벨이 가리키는 심장로(want.gate)의 관측 기대 상태가 want.state 를 포함하고,
 * releaseView 가 있으면 같은 스텝 표본의 states 가 want.state 이며 사슬 scale 이 그 상태와 맞다(보이는 상태 > 0, released = 0). releasing 은 reduced motion 에서 사슬이 즉시 사라질 수 있어 scale 을 요구하지 않는다.
 * states 는 PNG 마다 기록하도록 돌려준다.
 */
export function checkScreenMoment(shot, def, want, { releaseExpected = false } = {}) {
  const row = shot?.capture ?? null;
  const g = row?.g?.[want.gate];
  const allowed = row ? expectedStates(g, want.gate, row.pr, g?.ra ?? null, def) : [];
  const stateOk = !!row && allowed.includes(want.state);
  if (!releaseExpected) return { ok: stateOk, stateOk, allowed, states: null };
  const got = row?.rv ? STATE_NAMES[row.rv.s?.[want.gate]] ?? 'unknown' : null;
  const scale = row?.rv?.cs?.[want.gate] ?? null;
  const scaleOk = ['bound', 'shock', 'open'].includes(want.state) ? scale > SCALE_EPS : want.state === 'released' ? scale <= SCALE_EPS : true;
  return { ok: stateOk && got === want.state && scaleOk, stateOk, allowed, got, scale, scaleOk, states: row?.rv ? row.rv.s.map(c => STATE_NAMES[c] ?? 'unknown') : null };
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
 * 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. depth 'deep' 은 기준선에 경로 정의가 없고 후보에 해방 연출(release)이 있는 정의가 있어야 하고,
 * 'standard' 는 둘 다 같은 정의이고 해방 연출이 없어야 한다. 두 report 의 HEAD 는 달라야 한다(같은 빌드끼리의 비교는 합격하지 않는다).
 */
export function compareTargetsOk(cand, base, depth) {
  if (!cand || !base) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const definition = depth === 'deep' ? !base.routeDefinition && !!cand.routeDefinition && !!cand.routeDefinition.release
    : !!base.routeDefinition && !!cand.routeDefinition && !cand.routeDefinition.release && !base.routeDefinition.release
      && JSON.stringify(base.routeDefinition) === JSON.stringify(cand.routeDefinition);
  return differs && definition && cand.furnacesOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/**
 * 두 report 의 실행 설정이 같은지: 영웅 · 시드 · depth · 재시드에 더해 viewport · motion · quality 도 같아야 비교가 성립한다(없는 값은 같지 않다고 본다).
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
 * PLAN 5절 5 기준선 비교. cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), furnaceRooms(cand), viewGpu(cand 의 checkViewGpu 결과, 심층), routeViewGpu(보고용) }.
 * 사전 선언된 게이트(PLAN 1절 · 5절 5): 완주 시간 비 ≤ timeRatio(심층 · 일반), 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra, 후보 심층의 해방 뷰 같은 프레임 A/B(viewGpu.ok).
 * 보고 항목(게이트 아님): 심장로 방 첫 진입 draw call 증가, 50ms 초과율, 일반 완주 시간 비가 1.00 ± 0.05 인지, 경로 목표 전체 A/B.
 */
export function compareRuns(cand, base, { depth = 'deep', timeRatio = 2, slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const time = { cand: a ?? null, base: b ?? null, ratio, limit: timeRatio, ok: ratio !== null && ratio <= timeRatio };
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  const deep = depth === 'deep';
  const gpu = cand?.viewGpu ?? null;
  const viewGpu = deep ? { ok: gpu?.ok === true, samples: gpu?.samples ?? null, max: gpu?.max ?? null, limit: gpu?.limit ?? VIEW_DRAW_LIMIT, coverage: gpu?.coverage ?? null } : null;
  const gates = { time: time.ok, slow: slow.ok, ...(deep ? { viewGpu: viewGpu.ok } : {}) };
  const report = {
    note: '보고 항목(게이트 아님, PLAN 1절 · 5절 5 사전 선언): 심장로 방 첫 진입 draw call 증가 · 50ms 초과율 · 일반 완주 시간 비 1.00 ± 0.05 · 경로 목표 전체 A/B',
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.furnaceRooms),
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    timeParity: { ratio, target: 1, tolerance: .05, within: ratio !== null && Math.abs(ratio - 1) <= .05, applies: !deep },
    routeViewGpu: cand?.routeViewGpu ?? null,
  };
  return { ok: Object.values(gates).every(Boolean), gates, time, slow, viewGpu, report };
}

// ---------- 거수 사슬 끊기(BUNDLE-15) ----------
// 재벼림 심층 보스방의 거수(ash_colossus) 사슬 규칙 판정. 입력은 qa 프로브가 보스방 진입 뒤 스텝마다 남기는 사슬 행(rows), chains.filter 감싸개 기록(filters), 토스트(toasts), 보스방 정보(room)다.
// 모든 시간·반경·거리·배율은 정의(def = ROUTE_OBJECTIVES.ashforge_deep.chains)에서 읽는다. 이 파일의 CHAINS 상수는 정의가 PLAN 3.1 계약과 같은지(checkChainsDefinition)와 문구에만 쓴다.
// 독립 대조(B14 교훈): 컨트롤러가 받은 값을 같은 식으로 다시 계산하지 않는다. 끌기 방향·기둥·벽 지점은 도구가 직접 읽은 boss.signatures.plan.events[0] 과 보스방 x/z/w/h 로 계산하고,
// 버티기는 도구가 읽은 영웅 위치와 (도구가 계산한) 기둥 거리, 영웅 state·hp 로 판정한다.
// 사슬 행(컨트롤러 읽기 상태 이름 그대로, PLAN 3.2):
//   n 스텝, t 게임 시각, hx/hz 영웅 위치, hp, ha 영웅 생존, au AUTO, ps 영웅 state,
//   cs state(idle|chained|open|exposed|unchained|ended), cl chainsLeft, cu cuts, cw windows, cm misses, cb broken, pu pulling(1/0), sd pullSide, qx/qz pillar, ax/az anchor(없으면 null),
//   hd hold, ht holdTotal, wl windowLeft, wt windowTotal, el exposedLeft, et exposedTotal, ed exposedDamage, lc lastCutT(Infinity 는 null),
//   bo 보스 존재, al 생존, spn spawning, bs 보스 state, sp special, pk plan.key, ix/iz plan.events[0].x/z, sq attackSequence, cq completedAttackSequence,
//   by yaw, bx/bz 위치, bvx/bvz 속도, dom 목표창 문구 표본(선택)
// 필터 기록(chains.filter(dmg, attacker) 감싸개): { n, dmg 입력, out 출력, st 그 순간 state }.
// room: 도구가 world 에서 직접 읽은 보스방 { id, x, z, w, h }.

/** 거수 사슬 공유 정의 계약(PLAN 3.1). 판정은 정의 값을 읽고, 이 상수는 정의가 계약과 같은지와 문구에만 쓴다. */
export const CHAINS = Object.freeze({
  id: 'ashforge_deep_chains', boss: 'ash_colossus', signature: 'kiln_hammer', title: '거수의 사슬', resultAria: '거수의 사슬 결과',
  values: Object.freeze({ count: 3, window: 5, hold: 1.2, radius: 1.6, pillarOffset: 8.4, anchorMargin: 1.2, exposed: 5, exposedMult: 2, weaken: .1 }),
  pullText: '사슬이 망치 쪽으로 끌림 · 반대편 기둥으로', freeToast: '거수의 사슬이 모두 끊겼다',
});
/** screens 프로필의 사슬 순간(후보에만): 끌기 중 · 기둥 열림(hold > 0) · 끊김(exposed). */
export const CHAIN_MOMENTS = Object.freeze(['chain-pull', 'chain-open', 'chain-cut']);
/** 기둥을 방 안쪽으로 자르는 가장자리 여유(PLAN 3.2 '방 안쪽(가장자리 1.2)'). 정의의 anchorMargin 과 같은 값이지만 다른 규칙이라 따로 둔다. */
export const CHAINS_PILLAR_EDGE = 1.2;
/** 벽 지점 z 허용 오차: 컨트롤러는 시전을 본 갱신 때의 보스 z 를, 도구는 시전이 처음 관측된 행의 보스 z 를 쓴다(한두 스텝 차이). */
export const CHAINS_ANCHOR_Z_TOL = .5;
/** 수동 구간에서 영웅이 한 스텝에 움직일 수 있는 최대 거리(순간이동 방지용 상한). */
export const CHAINS_MAX_STEP_MOVE = 1.5;
/** open 의 '쫓지 않음' 판정(PLAN 3.6): 영웅-보스 거리가 스텝 앞뒤 모두 range × .92 + .3 보다 먼 추격 스텝에만 적용한다(.92 는 Enemy 추격 분기와 같은 값, .3 은 한 스텝 안 이동 여유). */
export const CHAINS_RANGE_FACTOR = .92;
export const CHAINS_RANGE_SLACK = .3;
/** 묶인 추격 스텝의 보스 이동 속도 상한(초당). 거수 추격 속도 3.4 의 약 절반이고, 모의에서 넉백은 초당 .75 가 최대였다(PLAN 4.1). */
export const CHAINS_PIN_MAX_SPEED = 1.8;
/** 도구가 읽은 보스 def.range 로 계산한 '사거리 밖' 거리 기준. */
export const chainsFarLimit = range => range * CHAINS_RANGE_FACTOR + CHAINS_RANGE_SLACK;
const CHAIN_TOL = 1e-6;
const CHAIN_REL = 1e-9;
const nearRel = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= CHAIN_REL * Math.max(1, Math.abs(a), Math.abs(b));
const nearAbs = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const escapeRe = text => String(text).split('').map(ch => '.*+?^$|(){}[]\\'.includes(ch) ? '\\' + ch : ch).join('');

export const chainsAttachToast = def => '거수의 사슬 ' + def.count + '개 · 망치가 끄는 반대편 기둥에서 버티세요';
export const chainsOpenToast = def => '사슬 기둥 열림 · ' + def.window + '초 안에 ' + def.hold + '초 버티기';
export const chainsCutToast = (def, n) => '사슬 끊김 ' + n + '/' + def.count + ' · 거수가 휘청인다';
export const chainsPlainText = (def, left) => '남은 사슬 ' + left + '/' + def.count + ' · 망치가 끄는 반대편 기둥에서 버티기';
/** 소수 한 자리 문구: 0.1초 올림(ceil)·내림(floor). 경계(정확히 0.1의 배수 ± 1e-9)에서는 두 구현이 모두 맞을 수 있어 가능한 문구를 모두 돌려준다. */
export function tenths(value, mode) {
  const exact = mode === 'ceil' ? Math.ceil(value * 10) : Math.floor(value * 10);
  const eps = mode === 'ceil' ? Math.ceil(value * 10 - 1e-9) : Math.floor(value * 10 + 1e-9);
  return [...new Set([exact, eps].map(v => (v / 10).toFixed(1)))];
}
/** 열림 문구: '기둥 열림 n.n초 · 행동 없이 h.h/1.2초'(n 은 windowLeft 0.1초 올림, h 는 hold 내림). */
export const chainsOpenTexts = (def, wl, hd) => {
  const out = [];
  for (const n of tenths(wl, 'ceil')) for (const h of tenths(hd, 'floor')) out.push('기둥 열림 ' + n + '초 · 행동 없이 ' + h + '/' + def.hold + '초');
  return out;
};
/**
 * 피해 배율(PLAN 3.6): 끊은 사슬 k 개마다 weaken 씩 늘어 (1 + weaken × k), 휘청임(exposed) 동안은 거기에 exposedMult 를 곱한다. idle·ended 는 1배.
 * k 는 컨트롤러가 알려 주는 cuts 가 아니라 도구가 관측 행에서 직접 센 끊김 수(open → exposed 전이 수)여야 한다(독립 대조).
 */
export const chainsExpectedMult = (def, k, state) => (state === 'idle' || state === 'ended' ? 1 : (1 + def.weaken * k) * (state === 'exposed' ? def.exposedMult : 1));
/** 목표창 노출 문구의 받는 피해 %: round((1 + weaken × k) × exposedMult × 100). 첫 끊김(k = 1)은 220%. */
export const chainsExposedPct = (def, k) => Math.round((1 + def.weaken * k) * def.exposedMult * 100);
/** 관측 행에서 도구가 센 끊김 전이(open → exposed)의 스텝 번호 목록. */
export function chainsCutSteps(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].cs === 'open' && rows[i].cs === 'exposed') out.push(rows[i].n);
  return out;
}
/**
 * 스텝 n 에서 부른 필터 시점까지 끊긴 수 k. 필터 기록의 n 은 그 호출이 일어난 스텝이고 st 는 호출 순간 state 다.
 * exposed 호출이면 끊김은 이미 일어났으므로 n 이하의 전이를 세고, 그 밖의 state 는 같은 스텝의 컨트롤러 갱신이 호출보다 늦을 수 있어 n 보다 앞선 전이만 센다.
 */
export const chainsCutsAt = (cutSteps, n, state) => cutSteps.filter(s => (state === 'exposed' ? s <= n : s < n)).length;
/** 노출 문구: '사슬 끊김 · 휘청 n.n초 · 받는 피해 220%'(n 은 exposedLeft 0.1초 올림, % 는 도구가 센 끊김 수 k 로 계산). */
export const chainsExposedTexts = (def, el, k) => tenths(el, 'ceil').map(n => '사슬 끊김 · 휘청 ' + n + '초 · 받는 피해 ' + chainsExposedPct(def, k) + '%');
const chainsOpenPattern = def => new RegExp('기둥 열림 \\d+\\.\\d초 · 행동 없이 \\d+\\.\\d/' + escapeRe(def.hold) + '초');
const chainsExposedPattern = (def, k) => new RegExp('사슬 끊김 · 휘청 \\d+\\.\\d초 · 받는 피해 ' + chainsExposedPct(def, k) + '%');
/** 갱신 대기 판정용: 앞 범주(exposed)에서 남은 문구인지만 보므로 퍼센트는 가리지 않는다. */
const chainsExposedLoose = /사슬 끊김 · 휘청 \d+\.\d초 · 받는 피해 \d+%/;
const chainsPlainPattern = def => new RegExp('남은 사슬 \\d+/' + def.count + ' · 망치가 끄는 반대편 기둥에서 버티기');
/** 결과 줄: '거수의 사슬 끊음 {cuts}/{count} · 기둥 창 {windows}번 · 놓침 {misses}번'. */
export const chainsResultLine = c => '거수의 사슬 끊음 ' + c.cuts + '/' + c.count + ' · 기둥 창 ' + c.windows + '번 · 놓침 ' + c.misses + '번';
/** 목표창 표시 범주: 끌기 없음(plain) · 끌기 중(pull) · 열림(open) · 노출(exposed). 그 밖의 state 는 표시하지 않는다(null). */
export const chainCat = r => (r.cs === 'exposed' ? 'exposed' : r.cs === 'open' ? 'open' : r.cs === 'chained' ? (r.pu === 1 ? 'pull' : 'plain') : null);

/** 정의가 PLAN 3.1 계약과 같은지(id·보스·서명·수치). 어긋난 항목을 issues 로 돌려준다. */
export function checkChainsDefinition(def) {
  if (!def) return { ok: false, issues: [{ field: 'chains', got: null }] };
  const issues = [];
  const want = (field, got, expected) => { if (JSON.stringify(got) !== JSON.stringify(expected)) issues.push({ field, got, want: expected }); };
  want('id', def.id, CHAINS.id); want('boss', def.boss, CHAINS.boss); want('signature', def.signature, CHAINS.signature);
  for (const [key, value] of Object.entries(CHAINS.values)) want(key, def[key], value);
  return { ok: issues.length === 0, issues };
}

/**
 * 시전 시작 지점(영웅 위치 = 원판 착탄점 impactX)과 보스방으로 도구가 직접 계산한 끌기 방향·기둥·벽 지점(PLAN 3.2).
 * pullSide = |impactX − room.x| ≥ 1 이면 부호, 아니면 이전 창 수(windowsBefore)가 짝수 +1 / 홀수 −1. 기둥 = (room.x − pullSide × pillarOffset, room.z)를 방 안쪽(가장자리 1.2)으로 자른다.
 * 벽 지점 = (room.x + pullSide × (room.w/2 − anchorMargin), 시전 시작 때의 보스 z).
 */
export function chainsExpectedGeometry(room, impactX, windowsBefore, bossZ, def) {
  const dx = impactX - room.x;
  const side = Math.abs(dx) >= 1 ? Math.sign(dx) : (windowsBefore % 2 === 0 ? 1 : -1);
  const e = CHAINS_PILLAR_EDGE;
  const pillar = { x: clampTo(room.x - side * def.pillarOffset, room.x - room.w / 2 + e, room.x + room.w / 2 - e), z: clampTo(room.z, room.z - room.h / 2 + e, room.z + room.h / 2 - e) };
  const anchor = { x: room.x + side * (room.w / 2 - def.anchorMargin), z: bossZ };
  return { side, pillar, anchor };
}

/** 연속 행 구간(pred 가 참인 인덱스 구간). */
function chainRuns(rows, pred) {
  const runs = [];
  let open = null;
  rows.forEach((r, i) => {
    if (!pred(r)) { open = null; return; }
    if (open && pred(rows[i - 1])) { open.end = i; return; }
    open = { start: i, end: i };
    runs.push(open);
  });
  return runs;
}
/** attackSequence 마다 처음 본 boss.special(시그니처). */
function chainSequenceSignatures(rows) {
  const map = new Map();
  for (const r of rows) if (r.sq > 0 && r.sp && !map.has(r.sq)) map.set(r.sq, r.sp);
  return map;
}
/** completedAttackSequence 가 처음 쓰인 스텝(행 인덱스)과 그 공격의 시그니처. */
export function chainCompletions(rows, def) {
  const sig = chainSequenceSignatures(rows), out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.bo === 1 && b.cq > 0 && b.cq > a.cq) out.push({ idx: i, n: b.n, t: b.t, seq: b.cq, sig: sig.get(b.cq) ?? null, hammer: sig.get(b.cq) === def.signature });
  }
  return out;
}
/**
 * 용재 망치 시전 목록. 시전 = 보스가 attack·special·plan.key 가 시그니처인 attackSequence 마다 첫 행.
 * idx 시작 행, completeIdx 마지막 고리(cq === seq) 행, endIdx 시전이 끝난 행(마지막 고리 없이 끝나면 broken 후보), pullIdx 컨트롤러가 끌기(pu)를 보인 첫 행(chained 에서만).
 */
export function chainCasts(rows, def) {
  const casts = [], seen = new Map();
  const isCast = (r, seq) => r.bs === 'attack' && r.sp === def.signature && r.pk === def.signature && r.sq === seq;
  rows.forEach((r, i) => {
    if (r.bo === 1 && r.al === 1 && r.sq > 0 && r.bs === 'attack' && r.sp === def.signature && r.pk === def.signature && !seen.has(r.sq)) {
      const c = { seq: r.sq, idx: i, n: r.n, t: r.t, state: r.cs, ix: r.ix, iz: r.iz, bx: r.bx, bz: r.bz, completeIdx: null, endIdx: null, pullIdx: null };
      seen.set(r.sq, c); casts.push(c);
    }
  });
  for (const c of casts) {
    for (let i = c.idx + 1; i < rows.length; i++) {
      if (c.completeIdx === null && rows[i].cq === c.seq) c.completeIdx = i;
      if (c.endIdx === null && !isCast(rows[i], c.seq)) c.endIdx = i;
      if (c.completeIdx !== null && c.endIdx !== null) break;
    }
    const until = Math.min((c.completeIdx ?? c.endIdx ?? rows.length - 1) + 1, rows.length - 1);
    for (let i = c.idx; i <= until; i++) if (rows[i].pu === 1 && rows[i].cs === 'chained' && rows[i].sq === c.seq) { c.pullIdx = i; break; }
  }
  return casts;
}

/** 부착: 보스가 나타난 뒤(spawning 이 풀린 행) 한 스텝 안에 chained(chainsLeft = count, cuts 0), 그 전에는 idle, 상태 전이는 허용 그래프(PLAN 3.2)뿐이다. */
export function checkChainsAttach(rows, def) {
  const bossAt = rows.findIndex(r => r.bo === 1 && r.al === 1 && r.spn === 0);
  const attachAt = rows.findIndex(r => r.cs !== 'idle');
  const early = rows.filter(r => (r.cs === 'chained' || r.cs === 'open' || r.cs === 'exposed') && (r.bo !== 1 || r.spn === 1)).length;
  const allowed = { idle: ['idle', 'chained', 'ended'], chained: ['chained', 'open', 'ended'], open: ['open', 'exposed', 'chained', 'ended'], exposed: ['exposed', 'chained', 'unchained', 'ended'],
    unchained: ['unchained', 'ended'], ended: ['ended'] };
  const bad = [];
  for (let i = 1; i < rows.length; i++) if (!(allowed[rows[i - 1].cs] ?? []).includes(rows[i].cs)) bad.push({ idx: i, n: rows[i].n, from: rows[i - 1].cs, to: rows[i].cs });
  const delay = bossAt >= 0 && attachAt >= 0 ? attachAt - bossAt : null;
  const first = attachAt >= 0 ? rows[attachAt] : null;
  const preIdle = attachAt < 0 ? false : rows.slice(0, attachAt).every(r => r.cs === 'idle');
  const startsFull = !!first && first.cs === 'chained' && first.cl === def.count && first.cu === 0;
  return { ok: bossAt >= 0 && attachAt >= 0 && delay >= 0 && delay <= 1 && early === 0 && preIdle && startsFull && bad.length === 0, bossAt, attachAt, delay, early, preIdle, startsFull,
    chainsLeftAtAttach: first?.cl ?? null, badTransitions: bad.slice(0, 6) };
}

/**
 * 창(open 연속 행)·노출(exposed 연속 행) 판정. 반환 acceptance 는 항목별 통과 여부다.
 * 열림: 가장 가까운 앞 completedAttackSequence 변화가 def.signature 시그니처이고 같은 스텝이거나 한 스텝 앞이며, 그 망치는 끌기(pu)가 먼저 관측돼야 한다(no-trigger · wrong-signature · late-open · duplicate-sequence · not-pulled).
 * 망치가 완성됐는데 열리지 않으면(missed) 위반이다(보스 처치 스텝 제외).
 * 길이: 놓침(miss)으로 끝난 창 = def.window ± 1/60, 끊김(cut)·보스 처치로 끝난 창은 ≤ def.window + 1/60. windowLeft 시계는 스텝마다 게임 시각 증가량만큼 줄고 첫 값은 def.window(−1/60 허용), windowTotal = def.window.
 * 버티기: 끊김 행에서 거꾸로, 도구가 영웅 위치로 직접 잰 기둥(독립 계산) 거리 ≤ def.radius + POSITION_SLACK · state idle|move · hp 비감소가 연속된 시간 ≥ def.hold − 1/60, 모두 그 창 안.
 * 묶임(PLAN 3.6): exposed 는 새 공격 없음(attackSequence 불변)·yaw 불변·추격 스텝 vel 0. open 은 영웅이 사거리 안이면 묶지 않으므로 새 공격·yaw 변화를 허용하고,
 * 도구가 잰 영웅-보스 거리가 그 스텝 앞뒤 모두 range × .92 + .3 보다 먼 추격 스텝(앞뒤 행이 모두 open·chase)에만 '쫓지 않음'(vel 0 이고 이동 속도 ≤ 초당 1.8)을 본다.
 * range 는 도구가 페이지에서 읽은 보스 def.range(opts.range)이고, 없으면 open 의 묶임을 판정할 수 없어 pinnedStill 이 실패한다. open 동안 영웅이 사거리 안에서 생긴 새 공격 수는 보고 항목이다.
 * 위치 이동량(넉백 등)은 moveMax 로 보고한다.
 * 노출: 끊김 직후 이어지고 길이 = def.exposed ± 1/60(보스 처치 면제), exposedLeft 시계, exposedTotal, 끝나면 chainsLeft > 0 이면 chained 아니면 unchained.
 */
export function checkChainsWindows(rows, def, room, casts, comps, { range = null } = {}) {
  const rangeKnown = Number.isFinite(range) && range > 0, farLimit = rangeKnown ? chainsFarLimit(range) : null;
  const heroDist = r => Math.hypot(r.hx - r.bx, r.hz - r.bz);
  const openRuns = chainRuns(rows, r => r.cs === 'open'), exposedRuns = chainRuns(rows, r => r.cs === 'exposed');
  const castBySeq = new Map(casts.map(c => [c.seq, c]));
  const windows = [], seen = new Set();
  openRuns.forEach((run, index) => {
    const span = rows.slice(run.start, run.end + 1), first = span[0], last = span.at(-1), reasons = [];
    const pre = comps.filter(c => c.idx <= run.start);
    const closest = pre.at(-1) ?? null;
    const trig = pre.filter(c => c.hammer && run.start - c.idx <= 1).at(-1) ?? null;
    if (!trig) {
      if (!closest) reasons.push('no-trigger');
      else if (!closest.hammer && run.start - closest.idx <= 1) reasons.push('wrong-signature');
      else if (closest.hammer) reasons.push('late-open');
      else reasons.push('no-trigger');
    } else if (seen.has(trig.seq)) reasons.push('duplicate-sequence');
    if (trig) seen.add(trig.seq);
    const cast = trig ? castBySeq.get(trig.seq) ?? null : null;
    if (trig && (!cast || cast.pullIdx === null)) reasons.push('not-pulled');
    const contiguous = span.every((r, k) => k === 0 || r.n === span[k - 1].n + 1);
    const length = last.t - first.t + FRAME;
    const next = rows[run.end + 1] ?? null;
    const endKind = next === null ? (last.al === 0 ? 'truncated' : 'unterminated')
      : next.cs === 'exposed' ? 'cut' : next.cs === 'ended' || next.al === 0 || last.al === 0 ? 'truncated' : next.cs === 'chained' ? 'miss' : 'unterminated';
    const lengthOk = endKind === 'miss' ? contiguous && Math.abs(length - def.window) <= FRAME + EPS
      : endKind === 'cut' || endKind === 'truncated' ? contiguous && length <= def.window + FRAME + EPS : false;
    let clockBad = 0;
    span.forEach((r, k) => {
      if (k === 0) return;
      const p = span[k - 1], dwl = p.wl - r.wl, dt = r.t - p.t;
      if (!(Math.abs(dwl - dt) <= CHAIN_TOL) && !(dwl === 0 && dt === 0)) clockBad++;
    });
    const startOk = first.wl <= def.window + EPS && first.wl >= def.window - FRAME - EPS;
    const totalsOk = span.every(r => r.wt === def.window && r.ht === def.hold);
    const yawChanged = span.filter(r => r.by !== first.by).length;
    const moveMax = Math.max(...span.map(r => Math.hypot(r.bx - first.bx, r.bz - first.bz)));
    // 묶임(open): 앞뒤 행이 모두 open·추격이고 영웅-보스 거리가 앞뒤 모두 사거리 기준보다 먼 스텝에서 보스가 쫓지 않아야 한다. 새 공격은 허용하되 영웅이 사거리 안이었던 수를 센다.
    const pin = { observed: rangeKnown, farLimit, chaseSteps: 0, farChaseSteps: 0, movingFarChase: 0, maxFarSpeed: 0, maxFarDispSpeed: 0, newAttacks: 0, newAttacksInRange: 0, newAttacksOutOfRange: 0 };
    for (let k = 1; k < span.length; k++) {
      const p = span[k - 1], r = span[k];
      if (r.n !== p.n + 1) continue;
      if (r.sq > p.sq) {
        pin.newAttacks++;
        if (rangeKnown && (heroDist(p) <= farLimit || heroDist(r) <= farLimit)) pin.newAttacksInRange++; else pin.newAttacksOutOfRange++;
      }
      if (!(p.bs === 'chase' && r.bs === 'chase' && p.ha === 1 && r.ha === 1 && p.al === 1 && r.al === 1)) continue;
      pin.chaseSteps++;
      if (!rangeKnown || !(heroDist(p) > farLimit && heroDist(r) > farLimit)) continue;
      pin.farChaseSteps++;
      const speed = Math.hypot(r.bvx, r.bvz), dt = r.t - p.t, disp = dt > 0 ? Math.hypot(r.bx - p.bx, r.bz - p.bz) / dt : 0;
      pin.maxFarSpeed = Math.max(pin.maxFarSpeed, speed); pin.maxFarDispSpeed = Math.max(pin.maxFarDispSpeed, disp);
      if (!(speed <= CHAINS_PIN_MAX_SPEED) || !(disp <= CHAINS_PIN_MAX_SPEED)) pin.movingFarChase++;
    }
    // 버티기(끊긴 창만): 끊김 행(exposed 첫 행)에서 거꾸로 연속으로 조건을 채운 시간.
    let hold = null, cutCounts = null;
    if (endKind === 'cut') {
      const k = run.end + 1, cutRow = rows[k];
      const expected = cast && cast.pullIdx !== null && Number.isFinite(cast.ix) && room ? chainsExpectedGeometry(room, cast.ix, openRuns.filter(o => o.start < cast.pullIdx).length, cast.bz, def) : null;
      const pil = expected ? expected.pillar : (Number.isFinite(last.qx) ? { x: last.qx, z: last.qz } : null);
      const qual = (r, p) => !!p && !!pil && r.ha === 1 && Math.hypot(r.hx - pil.x, r.hz - pil.z) <= def.radius + POSITION_SLACK && (r.ps === 'idle' || r.ps === 'move') && r.n === p.n + 1 && r.hp >= p.hp - 1e-9;
      let i = k;
      while (i >= run.start && qual(rows[i], rows[i - 1])) i--;
      const seconds = i + 1 <= k ? cutRow.t - rows[i + 1].t + FRAME : 0;
      hold = { seconds, need: def.hold - FRAME, ok: seconds + EPS >= def.hold - FRAME, startN: i + 1 <= k ? rows[i + 1].n : null, independentPillar: !!expected, controllerHold: last.hd };
      cutCounts = { cu: cutRow.cu === last.cu + 1, cl: cutRow.cl === last.cl - 1 };
    }
    windows.push({ index, startIdx: run.start, endIdx: run.end, n: first.n, t: first.t, seq: trig?.seq ?? null, delaySteps: trig || closest ? run.start - (trig ?? closest).idx : null, reasons, endKind,
      contiguous, rows: span.length, length, lengthOk, startWindowLeft: first.wl, startOk, totalsOk, clockBad, yawChanged, pin, moveMax, hold, cutCounts, ok: false });
  });
  const exposures = [];
  exposedRuns.forEach((run, index) => {
    const span = rows.slice(run.start, run.end + 1), first = span[0], last = span.at(-1);
    const prev = windows.find(w => w.endIdx === run.start - 1 && w.endKind === 'cut') ?? null;
    const contiguous = span.every((r, k) => k === 0 || r.n === span[k - 1].n + 1);
    const length = last.t - first.t + FRAME;
    const next = rows[run.end + 1] ?? null;
    const wantNext = last.cl > 0 ? 'chained' : 'unchained';
    const endKind = next === null ? (last.al === 0 ? 'truncated' : 'unterminated') : next.cs === wantNext ? 'expired' : next.cs === 'ended' || next.al === 0 || last.al === 0 ? 'truncated' : 'wrong-next';
    const lengthOk = endKind === 'expired' ? contiguous && Math.abs(length - def.exposed) <= FRAME + EPS : endKind === 'truncated' ? contiguous && length <= def.exposed + FRAME + EPS : false;
    let clockBad = 0;
    span.forEach((r, k) => {
      if (k === 0) return;
      const p = span[k - 1], del = p.el - r.el, dt = r.t - p.t;
      if (!(Math.abs(del - dt) <= CHAIN_TOL) && !(del === 0 && dt === 0)) clockBad++;
    });
    const startOk = first.el <= def.exposed + EPS && first.el >= def.exposed - FRAME - EPS;
    const totalsOk = span.every(r => r.et === def.exposed);
    // 휘청이는 동안 새 공격이 없다: attackSequence 가 첫 행 그대로다(open 에서 영웅이 사거리 안일 때 시작한 공격은 이어질 수 있다).
    const seqStable = span.every(r => r.sq === first.sq);
    const yawStable = span.every(r => r.by === first.by);
    // 추격 스텝(앞뒤 행이 모두 exposed·chase)은 vel 0 이다. 첫 행은 같은 스텝에서 컨트롤러 갱신과 추격 분기의 순서가 갈릴 수 있어 앞 행이 exposed 인 스텝만 본다.
    let chaseSteps = 0, movingChase = 0;
    for (let k = 1; k < span.length; k++) {
      const p = span[k - 1], r = span[k];
      if (r.n !== p.n + 1 || !(p.bs === 'chase' && r.bs === 'chase')) continue;
      chaseSteps++;
      if (r.bvx !== 0 || r.bvz !== 0) movingChase++;
    }
    const moveMax = Math.max(...span.map(r => Math.hypot(r.bx - first.bx, r.bz - first.bz)));
    exposures.push({ index, startIdx: run.start, endIdx: run.end, n: first.n, t: first.t, cutWindow: prev?.index ?? null, endKind, contiguous, rows: span.length, length, lengthOk, startExposedLeft: first.el, startOk, totalsOk,
      clockBad, seqStable, yawStable, chaseSteps, movingChase, moveMax, ok: false });
  });
  for (const w of windows) w.ok = w.reasons.length === 0 && w.contiguous && w.lengthOk && w.startOk && w.totalsOk && w.clockBad === 0 && w.endKind !== 'unterminated' && rangeKnown && w.pin.movingFarChase === 0
    && (w.endKind !== 'cut' || (w.hold?.ok === true && w.cutCounts?.cu === true && w.cutCounts?.cl === true));
  for (const e of exposures) e.ok = e.cutWindow !== null && e.contiguous && e.lengthOk && e.startOk && e.totalsOk && e.clockBad === 0 && e.endKind !== 'unterminated' && e.endKind !== 'wrong-next' && e.seqStable && e.yawStable && e.movingChase === 0;
  // 완성된 용재 망치(끌기가 관측된 것)는 보스 처치 스텝이 아니면 반드시 열려야 한다.
  const missed = comps.filter(c => {
    if (!c.hammer) return false;
    const cast = castBySeq.get(c.seq);
    if (!cast || cast.pullIdx === null) return false;
    const a = rows[c.idx], b = rows[c.idx + 1] ?? null;
    if (a.cs === 'open' || a.cs === 'exposed' || a.cs === 'ended' || a.al === 0 || !b || b.al === 0 || b.cs === 'ended') return false;
    return !openRuns.some(r => r.start === c.idx || r.start === c.idx + 1);
  }).map(c => ({ idx: c.idx, n: c.n, seq: c.seq }));
  const has = reason => windows.some(w => w.reasons.includes(reason));
  const cutWindows = windows.filter(w => w.endKind === 'cut');
  const pinTotals = { rangeKnown, farLimit, farChaseSteps: windows.reduce((a, w) => a + w.pin.farChaseSteps, 0), movingFarChase: windows.reduce((a, w) => a + w.pin.movingFarChase, 0),
    newAttacks: windows.reduce((a, w) => a + w.pin.newAttacks, 0), newAttacksInRange: windows.reduce((a, w) => a + w.pin.newAttacksInRange, 0), newAttacksOutOfRange: windows.reduce((a, w) => a + w.pin.newAttacksOutOfRange, 0) };
  return { windows, exposures, pin: pinTotals, count: windows.length, cutCount: cutWindows.length, missCount: windows.filter(w => w.endKind === 'miss').length, missed, completions: comps.length, hammerCompletions: comps.filter(c => c.hammer).length,
    acceptance: {
      windowCount: windows.length >= 1,
      noEarlyOpen: !has('no-trigger') && !has('wrong-signature'),
      openTiming: !has('late-open') && !has('duplicate-sequence') && !has('not-pulled'),
      noMissedOpen: missed.length === 0,
      windowLength: windows.length > 0 && windows.every(w => w.contiguous && w.lengthOk && w.startOk && w.totalsOk && w.clockBad === 0 && w.endKind !== 'unterminated'),
      holdBeforeCut: windows.length > 0 && cutWindows.every(w => w.hold?.ok === true && w.cutCounts?.cu === true && w.cutCounts?.cl === true),
      noNewAttack: windows.length > 0 && exposures.every(e => e.seqStable),
      yawFixed: windows.length > 0 && exposures.every(e => e.yawStable),
      pinnedStill: windows.length > 0 && rangeKnown && windows.every(w => w.pin.movingFarChase === 0) && exposures.every(e => e.movingChase === 0),
      exposedLength: exposures.every(e => e.cutWindow !== null && e.contiguous && e.lengthOk && e.startOk && e.totalsOk && e.clockBad === 0 && e.endKind !== 'unterminated' && e.endKind !== 'wrong-next') && exposures.length === cutWindows.length,
    } };
}

/**
 * 끌기·기둥·벽 지점 판정(독립 대조). 시전(chained 에서 시작한 것)마다: 끌기(pu)가 시작 행에서 2행 안에 나타나고, 도구가 시전 시작 행의 plan.events[0].x 와 보스방으로 계산한
 * 끌기 방향(sd)·기둥(qx,qz)·벽 지점(ax, az)이 컨트롤러 읽기 값과 같다(기둥·벽 x 1e-6, 벽 z ± CHAINS_ANCHOR_Z_TOL). 끌기 중(chained+pu)과 열림 행 전체에서 같다.
 * 끌기가 아닌 행(chained+pu 0, idle, exposed, unchained, ended)에서 sd 는 0, chained 가 아닌 state 에서 pu 는 0. chained 가 아닌 state 에서 시작한 시전에는 끌기가 없다.
 */
export function checkChainsGeometry(rows, def, room, casts, windows) {
  if (!room || ![room.x, room.z, room.w, room.h].every(Number.isFinite)) return { ok: false, observed: false, reason: 'room-not-observed', casts: [], pulled: 0 };
  const openStarts = windows.map(w => w.startIdx);
  const winBySeq = new Map(windows.filter(w => w.seq !== null).map(w => [w.seq, w]));
  const per = [], bad = [];
  for (const c of casts) {
    const rec = { seq: c.seq, n: c.n, state: c.state, pullDelay: c.pullIdx === null ? null : c.pullIdx - c.idx, pulled: c.pullIdx !== null, side: null, wantSide: null, pillarDiff: null, anchorXDiff: null, anchorZDiff: null, ok: true };
    per.push(rec);
    if (c.state !== 'chained') {
      if (c.pullIdx !== null) { rec.ok = false; bad.push({ seq: c.seq, kind: 'pull-outside-chained', state: c.state }); }
      continue;
    }
    if (c.pullIdx === null) {
      // 마지막 고리 없이 끝나거나 보스가 쓰러지는 시전이라도 시작 직후에는 끌기가 보여야 한다.
      const cut = c.completeIdx ?? c.endIdx;
      if (cut !== null && cut - c.idx > 2) { rec.ok = false; bad.push({ seq: c.seq, kind: 'no-pull' }); }
      continue;
    }
    if (c.pullIdx - c.idx > 2) { rec.ok = false; bad.push({ seq: c.seq, kind: 'pull-late', delay: c.pullIdx - c.idx }); }
    if (!Number.isFinite(c.ix)) { rec.ok = false; bad.push({ seq: c.seq, kind: 'impact-not-observed' }); continue; }
    const exp = chainsExpectedGeometry(room, c.ix, openStarts.filter(i => i < c.pullIdx).length, c.bz, def);
    const win = winBySeq.get(c.seq) ?? null;
    const last = Math.min(win ? win.endIdx : (c.completeIdx ?? c.endIdx ?? c.pullIdx), rows.length - 1);
    rec.wantSide = exp.side;
    for (let i = c.pullIdx; i <= last; i++) {
      const r = rows[i];
      if (!((r.cs === 'chained' && r.pu === 1) || r.cs === 'open')) continue;
      rec.side = r.sd;
      const sideOk = r.sd === exp.side;
      const pillarDiff = Math.hypot(r.qx - exp.pillar.x, r.qz - exp.pillar.z);
      const anchorXDiff = Math.abs(r.ax - exp.anchor.x), anchorZDiff = Math.abs(r.az - exp.anchor.z);
      rec.pillarDiff = Math.max(rec.pillarDiff ?? 0, pillarDiff); rec.anchorXDiff = Math.max(rec.anchorXDiff ?? 0, anchorXDiff); rec.anchorZDiff = Math.max(rec.anchorZDiff ?? 0, anchorZDiff);
      if (!sideOk || !(pillarDiff <= 2 * CHAIN_TOL) || !(anchorXDiff <= 2 * CHAIN_TOL) || !(anchorZDiff <= CHAINS_ANCHOR_Z_TOL)) {
        rec.ok = false; bad.push({ seq: c.seq, n: r.n, kind: 'geometry', got: { side: r.sd, pillar: [r.qx, r.qz], anchor: [r.ax, r.az] }, want: { side: exp.side, pillar: [exp.pillar.x, exp.pillar.z], anchor: [exp.anchor.x, exp.anchor.z] } });
        break;
      }
    }
  }
  const pullState = rows.filter(r => (r.pu === 1 && r.cs !== 'chained') || (r.cs === 'chained' && r.pu === 0 && r.sd !== 0) || (r.cs !== 'chained' && r.cs !== 'open' && r.sd !== 0)).length;
  const pulled = per.filter(p => p.pulled).length;
  return { ok: pulled >= 1 && bad.length === 0 && pullState === 0, observed: true, casts: per, pulled, hammerCasts: casts.length, pullStateBad: pullState, bad: bad.slice(0, 6), badCount: bad.length };
}

/** 컨트롤러 집계와 독립 집계의 일치: 관측한 창·끊김·놓침 수, chainsLeft = count − cuts, 카운터 단조, 끌기 후 마지막 고리 없이 끝난 시전 수(broken). */
export function checkChainsCounts(rows, def, windows, casts) {
  const last = rows.at(-1) ?? null;
  if (!last) return { ok: false, reason: 'no-rows' };
  const leftBad = rows.filter(r => r.cl !== def.count - r.cu || r.cu > def.count).length;
  let monotonic = true;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.cu < a.cu || b.cw < a.cw || b.cm < a.cm || b.cb < a.cb || b.cu - a.cu > 1 || b.cw - a.cw > 1 || b.cm - a.cm > 1) monotonic = false;
  }
  const derivedBroken = casts.filter(c => c.pullIdx !== null && c.completeIdx === null && c.endIdx !== null && rows[c.endIdx].al === 1 && rows[c.endIdx].cs !== 'ended').length;
  const derived = { windows: windows.count, cuts: windows.cutCount, misses: windows.missCount, broken: derivedBroken };
  const got = { windows: last.cw, cuts: last.cu, misses: last.cm, broken: last.cb };
  return { ok: leftBad === 0 && monotonic && JSON.stringify(derived) === JSON.stringify(got), leftBad, monotonic, derived, got };
}

/** lastCutT: 첫 끊김 전에는 null(Infinity), 끊긴 뒤에는 가장 가까운 끊김 행에서 잰 경과 시간과 2프레임 안에서 같다. */
export function checkChainsLastCut(rows, windows) {
  const cuts = windows.exposures.filter(e => e.cutWindow !== null).map(e => rows[e.startIdx]);
  const firstN = cuts.length ? cuts[0].n : Infinity;
  const beforeBad = rows.filter(r => r.n < firstN && r.lc !== null).length;
  let afterBad = 0;
  for (const r of rows) {
    // 보스 처치 뒤(ended)에는 컨트롤러가 갱신하지 않아 lastCutT 가 멈춘다.
    if (r.n < firstN || r.cs === 'ended') continue;
    const base = cuts.filter(c => c.t <= r.t + EPS).at(-1);
    if (!base || !Number.isFinite(r.lc) || Math.abs(r.lc - (r.t - base.t)) > 2 * FRAME + CHAIN_TOL) afterBad++;
  }
  return { ok: beforeBad === 0 && afterBad === 0, beforeBad, afterBad, cuts: cuts.length };
}

/**
 * 피해 배율(chains.filter 감싸개 기록, PLAN 3.6). 호출마다 기대 배율 = (1 + weaken × k) × (exposed 이면 exposedMult, 아니면 1), idle·ended 는 1배다.
 * k 는 컨트롤러의 cuts·damageMult 가 아니라 도구가 관측 행에서 직접 센 끊김 수(open → exposed 전이 수, 그 호출 시점까지)다. 컨트롤러 값을 그대로 쓰면 독립 대조가 아니다.
 * chained(끊김 뒤)·open·unchained 의 약화 배율도 판정한다. 마지막 행의 exposedDamage 는 exposed 호출 출력 합계여야 한다(basis 'output').
 * 증분(출력 − 입력) 합계는 sumBonus 로 보고만 하고 basis 'bonus' 는 실패다. exposed 가 아닌 행에서 exposedDamage 가 늘면 실패.
 * 표본 없음: opts.requireCalls(auto 프로필)일 때만 끊김이 있었는데 exposed 호출이 없으면 실패한다. 수동 chains 프로필은 보고(exposedCalls)로 둔다.
 * filters 가 null(관측 누락)이면 실패한다.
 */
export function checkChainsFilters(filters, rows, def, { cuts = 0, requireCalls = false } = {}) {
  if (!Array.isArray(filters)) return { ok: false, observed: false, bad: [{ kind: 'not-observed' }], badCount: 1 };
  const bad = [], cutSteps = chainsCutSteps(rows), byState = {};
  let exposedCalls = 0, weakenedCalls = 0, sumOut = 0, sumBonus = 0, kMax = 0;
  filters.forEach((f, i) => {
    const k = chainsCutsAt(cutSteps, f.n, f.st), mult = chainsExpectedMult(def, k, f.st), want = f.dmg * mult;
    kMax = Math.max(kMax, k);
    const slot = byState[f.st] ??= { calls: 0, minK: k, maxK: k };
    slot.calls++; slot.minK = Math.min(slot.minK, k); slot.maxK = Math.max(slot.maxK, k);
    if (f.st === 'exposed') { exposedCalls++; sumOut += f.out; sumBonus += f.out - f.dmg; }
    else if (k > 0 && f.st !== 'idle' && f.st !== 'ended') weakenedCalls++;
    if (!nearRel(f.out, want)) bad.push({ kind: f.st === 'exposed' ? 'exposed-multiplier' : k > 0 && f.st !== 'idle' && f.st !== 'ended' ? 'weaken-multiplier' : 'outside-exposure', i, n: f.n, state: f.st, k, dmg: f.dmg, out: f.out, want, mult });
  });
  const last = rows.at(-1) ?? null;
  const edTol = 1e-6 * Math.max(1, Math.abs(last?.ed ?? 0));
  const basis = !last ? null : Math.abs(last.ed - sumOut) <= edTol ? 'output' : Math.abs(last.ed - sumBonus) <= edTol ? 'bonus' : null;
  // exposedDamage 는 exposed 가 아닌 행에서 늘지 않는다.
  let growthOutside = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].ed > rows[i - 1].ed + 1e-9 && rows[i].cs !== 'exposed' && rows[i - 1].cs !== 'exposed') growthOutside++;
  const needCalls = requireCalls && cuts >= 1;
  return { ok: bad.length === 0 && basis === 'output' && growthOutside === 0 && (!needCalls || exposedCalls >= 1), observed: true, calls: filters.length, exposedCalls, weakenedCalls, kMax, byState, sumOut, sumBonus,
    exposedDamage: last?.ed ?? null, basis, growthOutside, requireCalls, bad: bad.slice(0, 8), badCount: bad.length };
}

/**
 * 목표창 표본(dom 이 있는 행). 제목 '거수의 사슬'. 범주별 정확한 문구: plain '남은 사슬 n/3 · 망치가 끄는 반대편 기둥에서 버티기'(n = chainsLeft), pull '사슬이 망치 쪽으로 끌림 · 반대편 기둥으로',
 * open '기둥 열림 n.n초 · 행동 없이 h.h/1.2초'(n 은 windowLeft 0.1초 올림, h 는 hold 내림), exposed '사슬 끊김 · 휘청 n.n초 · 받는 피해 220%'(n 은 exposedLeft 0.1초 올림, % 는 round((1 + weaken × k) × exposedMult × 100), k 는 도구가 센 끊김 수).
 * 목표창은 battle-readability.update 가 0.1초마다 다시 그리므로, 범주가 바뀐 뒤 이 주기(+2스텝) 안의 표본은 바로 앞 범주의 문구일 때만 '갱신 대기'(lag)로 따로 세고, 주기를 넘으면 실패한다.
 * 같은 범주 안에서 수치가 한 스텝 앞선 문구(stepLag)는 보고만 한다. 보스가 쓰러진 행(정화 완료 문구)은 판정하지 않는다.
 * plain·pull 범주는 36스텝 이어지면 36번째 행에 표본이 있어야 하고, open·exposed 는 범주 시작 10스텝 뒤 행에 항상 표본이 있어야 한다(갱신 주기를 넘겼는데 앞 문구가 남은 목표창을 잡는다).
 * open·exposed 가 관측된 실행은 각 범주 표본 ≥ 1.
 */
export const CHAINS_OBJECTIVE_REFRESH = .1 + 2 / 60;
/** 프로브가 표본을 읽는 행 위치(범주가 시작한 행부터 센 0 기준 인덱스): plain·pull 은 36번째 행, open·exposed 는 범주 시작 10스텝 뒤(갱신 주기 8스텝을 넘긴 첫 확인 행). */
export const CHAINS_PLAIN_SAMPLE = 35;
export const CHAINS_REFRESH_SAMPLE = 10;
export function checkChainsObjective(rows, def) {
  const patterns = { plain: chainsPlainPattern(def), open: chainsOpenPattern(def), exposed: chainsExposedLoose };
  // 노출 문구의 받는 피해 %는 도구가 센 끊김 수 k(그 행까지의 open → exposed 전이 수)로 계산한다. 컨트롤러의 cuts·damageMult 는 쓰지 않는다.
  const cutSteps = chainsCutSteps(rows);
  const exactTexts = (cat, r) => (cat === 'plain' ? [chainsPlainText(def, r.cl)] : cat === 'pull' ? [CHAINS.pullText] : cat === 'open' ? chainsOpenTexts(def, r.wl, r.hd)
    : cat === 'exposed' ? chainsExposedTexts(def, r.el, chainsCutsAt(cutSteps, r.n, 'exposed')) : []);
  const looksLike = (cat, dom) => (cat === 'pull' ? dom.includes(CHAINS.pullText) : cat && patterns[cat] ? patterns[cat].test(dom) : false);
  const bad = [], lag = [], stepLag = [], counts = { plain: 0, pull: 0, open: 0, exposed: 0 };
  let cat = null, prevCat = null, changedAt = -Infinity, samples = 0;
  rows.forEach((r, i) => {
    const c = chainCat(r);
    if (c !== cat) { prevCat = cat; cat = c; changedAt = r.t; }
    if (r.al === 0 || c === null || typeof r.dom !== 'string') return;
    samples++;
    if (!r.dom.includes(CHAINS.title)) { bad.push({ n: r.n, cat: c, dom: r.dom, why: 'title' }); return; }
    if (exactTexts(c, r).some(t => r.dom.includes(t))) { counts[c]++; return; }
    const waiting = r.t - changedAt <= CHAINS_OBJECTIVE_REFRESH + 1e-9;
    if (waiting && prevCat && looksLike(prevCat, r.dom)) { lag.push({ n: r.n, cat: c, from: prevCat, after: r.t - changedAt }); return; }
    const p = rows[i - 1];
    if (p && chainCat(p) === c && exactTexts(c, p).some(t => r.dom.includes(t))) { stepLag.push({ n: r.n, cat: c }); counts[c]++; return; }
    bad.push({ n: r.n, cat: c, dom: r.dom, why: 'text', want: exactTexts(c, r)[0] ?? null });
  });
  // 표본 위치 계약(프로브): plain·pull 은 36번째 행, open·exposed 는 범주가 바뀐 행들과 범주 시작 10스텝 뒤 행(항상)에 표본이 있다.
  const missing = [];
  const need = cat => (cat === 'plain' || cat === 'pull' ? CHAINS_PLAIN_SAMPLE : cat === 'open' || cat === 'exposed' ? CHAINS_REFRESH_SAMPLE : null);
  for (const run of chainRuns(rows, r => chainCat(r) !== null)) {
    let start = run.start;
    for (let i = run.start; i <= run.end + 1; i++) {
      if (i > run.end || chainCat(rows[i]) !== chainCat(rows[start])) {
        const k = need(chainCat(rows[start]));
        if (k !== null && i - start > k && rows[start + k].al === 1 && typeof rows[start + k].dom !== 'string') missing.push({ n: rows[start + k].n, cat: chainCat(rows[start]) });
        start = i;
      }
    }
  }
  const sawOpen = rows.some(r => r.cs === 'open' && r.al === 1), sawExposed = rows.some(r => r.cs === 'exposed' && r.al === 1);
  return { ok: samples > 0 && bad.length === 0 && missing.length === 0 && (!sawOpen || counts.open >= 1) && (!sawExposed || counts.exposed >= 1) && counts.plain + counts.pull >= 1,
    samples, counts, bad: bad.slice(0, 6), badCount: bad.length, missing: missing.slice(0, 4), lag: lag.slice(0, 6), lagCount: lag.length, stepLagCount: stepLag.length, refresh: CHAINS_OBJECTIVE_REFRESH };
}

/** 토스트: 부착 1회, 열림 창마다 1회, 끊김 '사슬 끊김 n/3 · 거수가 휘청인다' 가 n = 1..cuts 순서대로 1회씩, 모두 끊기면 '거수의 사슬이 모두 끊겼다' 1회(아니면 0회). 비슷한 다른 문구는 누출이다. */
export function checkChainsToasts(toasts, def, { windows = null, cuts = null, controllerWindows = null, free = false, encounterTactic = null } = {}) {
  const list = (toasts || []).map(t => String(t?.msg ?? ''));
  const attachText = chainsAttachToast(def), openText = chainsOpenToast(def);
  const attach = list.filter(m => m === attachText).length, opened = list.filter(m => m === openText).length, freed = list.filter(m => m === CHAINS.freeToast).length;
  const cutTexts = cuts === null ? [] : Array.from({ length: cuts }, (_, i) => chainsCutToast(def, i + 1));
  const cutCounts = cutTexts.map(text => list.filter(m => m === text).length);
  const order = cutTexts.map(text => list.indexOf(text));
  const inOrder = order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
  const known = new Set([attachText, openText, CHAINS.freeToast, ...Array.from({ length: def.count }, (_, i) => chainsCutToast(def, i + 1))]);
  const exempt = typeof encounterTactic === 'string' && encounterTactic.length > 0 ? encounterTactic : null;
  const stray = list.filter(m => m !== exempt && !known.has(m) && (m.includes('거수의 사슬') || m.includes('사슬 기둥') || m.includes('사슬 끊김')));
  // 기대 수보다 많은 끊김 토스트(예: 끊김이 2번인데 3/3)도 누출이다.
  const extraCut = list.filter(m => known.has(m) && m !== attachText && m !== openText && m !== CHAINS.freeToast && !cutTexts.includes(m)).length;
  return { ok: attach === 1 && windows !== null && opened === windows && (controllerWindows === null || opened === controllerWindows) && cuts !== null && cutCounts.every(n => n === 1) && inOrder
    && freed === (free ? 1 : 0) && extraCut === 0 && stray.length === 0,
    attach, opened, windows, controllerWindows, cutCounts, inOrder, freed, wantFreed: free ? 1 : 0, extraCut, attachText, openText, stray: stray.slice(0, 4), total: list.length };
}

/**
 * 결과: routeObjective.chains 가 고정 객체 { id, count, windows, cuts, misses, exposedDamage, broken } 이고 마지막 관측값과 같으며(exposedDamage 는 반올림),
 * 결과 줄이 '거수의 사슬 끊음 {cuts}/{count} · 기둥 창 {windows}번 · 놓침 {misses}번' 과 정확히 같고 aria-label '거수의 사슬 결과' 요소가 하나뿐이다.
 */
export function checkChainsResult(ro, last, resultText, resultLines, def) {
  const c = ro?.chains ?? null, keys = ['broken', 'count', 'cuts', 'exposedDamage', 'id', 'misses', 'windows'];
  const ints = c ? ['count', 'windows', 'cuts', 'misses', 'broken'].every(k => Number.isInteger(c[k]) && c[k] >= 0) : false;
  const fields = !!c && !!last && JSON.stringify(Object.keys(c).sort()) === JSON.stringify(keys) && c.id === def.id && c.count === def.count && ints
    && c.windows === last.cw && c.cuts === last.cu && c.misses === last.cm && c.broken === last.cb && c.exposedDamage === Math.round(last.ed);
  const line = c ? chainsResultLine(c) : null;
  const found = (resultLines || []).filter(l => l?.aria === CHAINS.resultAria);
  const element = !!line && found.length === 1 && String(found[0].text).replace(/\s+/g, ' ').trim() === line;
  const body = String(resultText ?? '').replace(/\s+/g, ' ');
  return { fields, line, element, text: !!line && body.includes(line), ok: fields && element && !!line && body.includes(line), got: c,
    last: last ? { windows: last.cw, cuts: last.cu, misses: last.cm, broken: last.cb, exposedDamage: Math.round(last.ed) } : null, found: found.map(l => l.text) };
}

/** AUTO 수용(사전 선언): 후보의 auto 프로필 심층에서 끊김 ≥ 1. 창마다 결과(끊김·놓침)와 길이는 보고 항목이다. */
export function checkChainsAuto(rows, windows) {
  const last = rows.at(-1) ?? null;
  return { ok: !!last && last.cu >= 1, cuts: last?.cu ?? null, windows: windows.count, per: windows.windows.map(w => ({ index: w.index, endKind: w.endKind, length: w.length, holdSeconds: w.hold?.seconds ?? null })) };
}

/**
 * 후보 빌드 한 번 완주의 사슬 종합 판정. obs: { rows, filters, toasts, room, result(routeObjective), resultText, resultLines, encounterTactic }.
 * obs.bossRange: 도구가 페이지에서 읽은 보스 def.range(open 묶임 판정). opts.autoCuts: auto 프로필이면 cuts ≥ 1 과 exposed 필터 표본 ≥ 1 을 요구한다(수동 chains 프로필은 표본 없음을 보고로 둔다). ok 는 acceptance 의 모든 항목이 통과일 때만 true 다.
 */
export function analyzeChains(obs, def, { autoCuts = false } = {}) {
  const rows = obs.rows || [];
  const definition = checkChainsDefinition(def), attach = checkChainsAttach(rows, def);
  const comps = chainCompletions(rows, def), casts = chainCasts(rows, def);
  const win = checkChainsWindows(rows, def, obs.room ?? null, casts, comps, { range: obs.bossRange ?? null });
  const geometry = checkChainsGeometry(rows, def, obs.room ?? null, casts, win.windows);
  const counts = checkChainsCounts(rows, def, win, casts), lastCut = checkChainsLastCut(rows, win);
  const filters = checkChainsFilters(obs.filters, rows, def, { cuts: win.cutCount, requireCalls: autoCuts });
  const objective = checkChainsObjective(rows, def);
  const last = rows.at(-1) ?? null;
  const toasts = checkChainsToasts(obs.toasts, def, { windows: win.count, cuts: last?.cu ?? null, controllerWindows: last?.cw ?? null, free: rows.some(r => r.cs === 'unchained'), encounterTactic: obs.encounterTactic ?? null });
  const result = checkChainsResult(obs.result, last, obs.resultText, obs.resultLines, def);
  const auto = checkChainsAuto(rows, win);
  const acceptance = {
    definition: definition.ok, attach: attach.ok, attachToast: toasts.attach === 1, pullGeometry: geometry.ok, ...win.acceptance, countsConsistent: counts.ok, lastCut: lastCut.ok,
    multiplier: filters.ok, objectiveText: objective.ok, toasts: toasts.ok, resultChains: result.ok, ...(autoCuts ? { autoCuts: auto.ok } : {}),
  };
  return { ok: rows.length > 0 && Object.values(acceptance).every(Boolean), acceptance, definition, attach, windows: win.windows, exposures: win.exposures, pin: win.pin, windowCount: win.count, cutCount: win.cutCount, missCount: win.missCount,
    missed: win.missed, hammerCompletions: win.hammerCompletions, casts: casts.length, geometry, counts, lastCut, filters, objective, toasts, result, auto, rows: rows.length };
}

// ---------- chains 프로필(수동 키보드) ----------
/**
 * 수동 사슬 구간 판정. marks: [{ mk, n }] — manual-start / attack-key / manual-end. 구간(manual-start ~ manual-end) 안:
 *  AUTO 꺼짐 · 영웅 생존 · 순간이동 없음(한 스텝 이동 ≤ CHAINS_MAX_STEP_MOVE).
 *  (1) outside: 첫 창이 열린 행의 영웅이 도구가 계산한 기둥 반경 밖이다(기둥 밖에서 열림을 기다렸다).
 *  (2) attack: attack-key 표식 직전 열린 행에서 hold 가 minHold − 1/60 이상 쌓였고, 표식 뒤 maxAfter 스텝 안에 hold 0 · 영웅 state 가 동작(attack 등)이다.
 *  (3) cut: 공격 키 뒤에 끊김(cuts 증가)이 있고, 그 끊김의 버티기 연속 구간(도구 독립 계산)이 공격 키 뒤에 새로 시작했다.
 */
export function checkChainsManual(rows, marks, def, { room = null, minHold = .5, maxAfter = 8, range = null } = {}) {
  const start = (marks || []).find(m => m.mk === 'manual-start'), attack = (marks || []).find(m => m.mk === 'attack-key'), end = (marks || []).find(m => m.mk === 'manual-end');
  if (!start || !attack || !end) return { ok: false, reason: 'missing-marks', found: [!!start, !!attack, !!end] };
  const inStint = r => r.n > start.n && r.n <= end.n;
  const seg = rows.filter(inStint);
  const autoRows = seg.filter(r => r.au !== 0).length, dead = seg.filter(r => r.ha !== 1).length;
  let teleports = 0;
  for (let i = 1; i < rows.length; i++) if (inStint(rows[i]) && rows[i].n === rows[i - 1].n + 1 && Math.hypot(rows[i].hx - rows[i - 1].hx, rows[i].hz - rows[i - 1].hz) > CHAINS_MAX_STEP_MOVE) teleports++;
  const casts = chainCasts(rows, def), comps = chainCompletions(rows, def);
  const win = checkChainsWindows(rows, def, room, casts, comps, { range });
  const firstWin = win.windows.find(w => rows[w.startIdx].n > start.n) ?? null;
  const castBySeq = new Map(casts.map(c => [c.seq, c]));
  const cast0 = firstWin?.seq != null ? castBySeq.get(firstWin.seq) : null;
  const geo = cast0 && room && Number.isFinite(cast0.ix) && cast0.pullIdx !== null ? chainsExpectedGeometry(room, cast0.ix, win.windows.filter(o => o.startIdx < cast0.pullIdx).length, cast0.bz, def) : null;
  const firstOpenRow = firstWin ? rows[firstWin.startIdx] : null;
  const outsideDist = firstOpenRow && geo ? Math.hypot(firstOpenRow.hx - geo.pillar.x, firstOpenRow.hz - geo.pillar.z) : null;
  const outside = outsideDist !== null && outsideDist > def.radius;
  const before = rows.filter(r => r.n <= attack.n && r.cs === 'open').at(-1) ?? null;
  const preHold = before ? before.hd : null;
  const after = rows.filter(r => r.n > attack.n && r.n <= attack.n + maxAfter);
  const reset = after.find(r => r.hd === 0 && ACTION_STATES.includes(r.ps)) ?? null;
  const attackOk = !!before && preHold + EPS >= minHold - FRAME && !!reset && before.n >= attack.n - 2;
  const cutWin = win.windows.find(w => w.endKind === 'cut' && rows[w.startIdx].n > start.n && rows[w.endIdx + 1].n > attack.n) ?? null;
  const cutOk = !!cutWin && cutWin.hold?.ok === true && cutWin.hold.startN > attack.n;
  const orderOk = start.n < attack.n && attack.n < end.n;
  return { ok: seg.length > 0 && autoRows === 0 && dead === 0 && teleports === 0 && outside && attackOk && cutOk && orderOk, rows: seg.length, autoRows, dead, teleports, outside, outsideDist, preHold, resetN: reset?.n ?? null,
    attackOk, cutOk, cutHold: cutWin?.hold ?? null, orderOk };
}

/**
 * 창 안 일시정지. 각 인자는 페이지 freeze 결과 { elapsed, paused, chain: 사슬 행 }. before: 정지 직전(open, hold ≥ minHold), paused: 정지 직후, still: 60스텝 + 0.5초 뒤.
 * 게임 시간·state·windowLeft·hold·보스 yaw·attackSequence·위치가 정확히 같고, 재개 뒤 steps 스텝에서 windowLeft 는 흐른 게임 시간만큼 줄고 hold 는 정지 전 값에서 이어진다(0 으로 지워지지 않음).
 */
export function checkChainsPause({ before, paused, still, resumed, steps, minHold = .3 }) {
  const snap = x => (x?.chain ? [x.elapsed, x.chain.cs, x.chain.hd, x.chain.wl, x.chain.by, x.chain.sq, x.chain.bx, x.chain.bz] : null);
  const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const frozen = !!before && before.chain?.cs === 'open' && before.chain.hd + EPS >= minHold && paused?.paused === true && still?.paused === true && same(snap(before), snap(paused)) && same(snap(before), snap(still));
  const delta = resumed && still ? resumed.elapsed - still.elapsed : null;
  const decreased = resumed?.chain && before?.chain ? before.chain.wl - resumed.chain.wl : null;
  const holdKept = !!resumed?.chain && !!before?.chain && resumed.chain.hd + CHAIN_TOL >= before.chain.hd && resumed.chain.hd <= before.chain.hd + (delta ?? 0) + CHAIN_TOL;
  const resumedOk = frozen && resumed?.chain?.cs === 'open' && delta > 0 && delta <= steps * FRAME + 2 * FRAME + EPS && nearAbs(decreased, delta, CHAIN_TOL) && holdKept
    && resumed.chain.by === before.chain.by && resumed.chain.sq === before.chain.sq;
  return { ok: frozen && resumedOk, frozen, resumedOk, holdBefore: before?.chain?.hd ?? null, holdResumed: resumed?.chain?.hd ?? null, holdKept, windowLeft: before?.chain?.wl ?? null, decreased, elapsedDelta: delta,
    yawKept: resumed?.chain?.by === before?.chain?.by, sequenceKept: resumed?.chain?.sq === before?.chain?.sq };
}

/**
 * screens 사슬 순간. shot.capture.chain 은 PNG 를 찍은 스텝의 사슬 행(+ dom). chain-pull: 보스 등장 뒤 chained · 끌기 중(pu, sd ≠ 0) · 목표창 끌기 문구.
 * chain-open: open 이고 hold > 0 · 목표창 열림 문구(행동 없이). chain-cut: exposed 이고 exposedLeft ≤ def.exposed − .5 · 목표창 휘청 문구(받는 피해 % = round((1 + weaken × k) × exposedMult × 100), k 는 프로브가 센 끊김 수 kc — 컨트롤러 cuts 가 아님; 첫 끊김 220%). 관측 누락은 실패다.
 */
export function checkChainMoment(shot, def, label) {
  const r = shot?.capture?.chain ?? null;
  const dom = typeof r?.dom === 'string' ? r.dom : '';
  const base = !!r && r.bo === 1 && r.al === 1 && r.spn === 0;
  const state = label === 'chain-pull' ? base && r.cs === 'chained' && r.pu === 1 && r.sd !== 0
    : label === 'chain-open' ? base && r.cs === 'open' && r.hd > 0 && r.wl > 0
      : label === 'chain-cut' ? base && r.cs === 'exposed' && r.el > 0 && r.el <= def.exposed - .5 + EPS : false;
  const view = label === 'chain-pull' ? dom.includes(CHAINS.title) && dom.includes(CHAINS.pullText)
    : label === 'chain-open' ? dom.includes(CHAINS.title) && chainsOpenPattern(def).test(dom)
      : label === 'chain-cut' ? dom.includes(CHAINS.title) && Number.isInteger(r?.kc) && r.kc >= 1 && chainsExposedPattern(def, r.kc).test(dom) : false;
  return { ok: state && view, state, view, label, chain: r ? { cs: r.cs, pu: r.pu, sd: r.sd, hd: r.hd, wl: r.wl, el: r.el, cl: r.cl, kc: r.kc ?? null, dom: dom || null } : null };
}

/** 기준선 누출 관찰 대상 문구(사슬 정의가 없는 기준선 빌드에는 없어야 한다). */
export const CHAINS_LEAK_WORDS = Object.freeze(['거수의 사슬', '사슬 기둥', '사슬 끊김']);
/** 토스트·목표창 표본·결과 화면 글에 사슬 문구가 없어야 한다. 관측이 하나도 없으면 통과하지 않는다. */
export function checkChainsLeak(toasts, doms, resultText = '') {
  const texts = [...(toasts || []).map(t => String(t?.msg ?? '')), ...(doms || []).map(String), String(resultText ?? '')];
  const leaked = texts.filter(m => CHAINS_LEAK_WORDS.some(w => m.includes(w)));
  return { ok: (toasts || []).length > 0 && (doms || []).length > 0 && leaked.length === 0, toasts: (toasts || []).length, domSamples: (doms || []).length, leaked: leaked.slice(0, 4) };
}

// ---------- 기준선 비교(거수 사슬 짝) ----------
/**
 * 사슬 짝의 기준선·후보 판별. 후보 심층 정의에는 chains 가 있고 기준선에는 없으며, chains 를 뺀 나머지 정의가 같아야 한다(둘 다 같은 재벼림 심층 심장로 정의).
 * HEAD 가 달라야 하고, 양쪽 report·run 이 pass, 심장로 판정(furnacesOk)이 양쪽 통과, 후보는 사슬 판정(chainsOk)까지 통과해야 한다.
 */
export function compareChainsTargetsOk(cand, base) {
  if (!cand || !base) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const strip = d => { if (!d) return null; const { chains, ...rest } = d; return rest; };
  const definition = !!cand.routeDefinition?.chains && !base.routeDefinition?.chains && !!base.routeDefinition && JSON.stringify(strip(cand.routeDefinition)) === JSON.stringify(strip(base.routeDefinition));
  return differs && definition && cand.chainsOk === true && cand.furnacesOk === true && base.furnacesOk === true && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/** 어느 쪽이 먼저 돌았는지(보고 항목). started 는 report.started(ISO). 짝은 순서를 섞어 돌리므로 뒤에 돈 쪽의 부하 영향을 읽는 데 쓴다. */
export function runOrder(candStarted, baseStarted) {
  const c = Date.parse(candStarted), b = Date.parse(baseStarted);
  return Number.isFinite(c) && Number.isFinite(b) ? (c < b ? 'cand-first' : b < c ? 'base-first' : 'same-time') : 'unknown';
}
/**
 * 사슬 짝 비교(PLAN 3.5 · 7절). 사전 선언 게이트: 전체 런 50ms 초과 수 cand ≤ base + slowExtra(2). 보고 항목(게이트 아님): 완주 시간 비, 처치 수, 50ms 초과율,
 * 심장로 방 첫 진입 draw call 증가, 후보의 사슬 결과(끊김·창·놓침), 실행 전후 load, 실행 순서.
 */
export function compareChainRuns(cand, base, { slowExtra = 2 } = {}) {
  const a = cand?.time, b = base?.time;
  const ratio = a > 0 && b > 0 ? a / b : null;
  const c = cand?.runOver50, d = base?.runOver50;
  const slow = { cand: c ?? null, base: d ?? null, limit: Number.isFinite(d) ? d + slowExtra : null, ok: Number.isFinite(c) && Number.isFinite(d) && c <= d + slowExtra };
  const gates = { slow: slow.ok };
  const report = {
    note: '보고 항목(게이트 아님, PLAN 3.5 · 7절 사전 선언): 완주 시간 비 · 처치 수 · 50ms 초과율 · 심장로 방 첫 진입 draw call 증가 · 사슬 결과 · 실행 전후 load · 실행 순서',
    time: { cand: a ?? null, base: b ?? null, ratio },
    kills: { cand: cand?.kills ?? null, base: base?.kills ?? null },
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.furnaceRooms),
    chains: cand?.chainsSummary ?? null,
    load: { cand: cand?.load ?? null, base: base?.load ?? null },
    order: runOrder(cand?.started, base?.started),
  };
  return { ok: Object.values(gates).every(Boolean), gates, slow, report };
}
