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
