// 흑사막 분지(sable_mirage_basin 일반·심층) 가짜 왕좌 + 거울 미궁(BUNDLE-09) QA 판정 함수. 브라우저 없이 단위 검사할 수 있게 분리했다.
// 입력은 tools/sable-mirror-qa.mjs 의 페이지 프로브가 app.step 한 번마다 관측해 남긴 행(게임 시간)과 대상 프로젝트의 공유 정의(ROUTE_OBJECTIVES.sable_standard · sable_deep)다.
// 시간·반경·개수·방 번호는 모두 인자(def, opts)로 받는다. 이 파일에는 게임 수치를 박지 않는다(문구와 연출 계약 상수만 PLAN 3.1·3.2 에서 가져온다).
//
// 관측 행(상태가 바뀐 스텝, 미궁이 running 인 모든 스텝, 1초 간격 스텝, 표식 스텝만 남긴다. 판정에 필요한 연속 구간은 빠짐없이 남는다):
//   n 스텝 번호(P.run 이 센다), t 게임 시각, x/z 영웅 위치, hp/mhp 영웅 HP, al 영웅 생존(1/0), rm 현재 방 id, pr route.progress(파괴한 왕좌 수), sl world.sealed(1/0),
//   rem 보스·시작을 뺀 미정화 방 수, cond (왕좌 전부 파괴 && rem = 0 이면 1), au AUTO(1/0), ah 공격 입력 유지(1/0), ps 영웅 state,
//   g: 왕좌마다 { id 방 id, rd gate.ready, bk gate.broken, ph gate.phase(0 spin · 1 still · 2 그 밖), pph 직전 스텝 끝의 ph, ag gate.age, pag 직전 스텝 끝의 age,
//      hi gate.hits, dh 이 스텝에서 hits 가 는 양, cl room.cleared, fw room.forgeWave, dc room.discovered, al 그 방의 살아 있는 적 수, pd 그 방의 대기열 수 }(전부 숫자),
//   mz route.maze 관측 { ph(0 idle · 1 running · 2 done), lim, lf(left), el(elapsed), col(collapses), ill(illusions), cd(cooldown), tn(trailN), dm 영웅–진짜 거울 거리, di 영웅–환영 거울 거리,
//      fd 시작·붕괴 스텝에서 도구가 world.buildFlow 로 다시 잰 영웅 칸 거리(규칙의 dist), fa 같은 스텝의 인접 위치 거리 후보들 } 또는 null(maze 없음),
//   mv route.mazeView 관측 { s: [진짜 거울 상태 번호, 환영 거울 상태 번호](MIRROR_STATE_NAMES 순서), f footprints, c count, d drawCalls } 또는 null(mazeView 없음),
//   tr 발자국이 갱신된 행의 trail 좌표 [x0, z0, x1, z1, ...](앞 trailN 개), mk 도구가 찍은 구간 표식(선택), dom 목표창 문구(같은 상태가 0.6초 이어진 뒤 표본)
// 뷰 같은 프레임 A/B 표본(viewAB, 행과 따로 남긴다): { label, n, t, ph 미궁 phase 번호, mzCalls mazeView.drawCalls, rtCalls route.view.drawCalls, on 둘 다 켠 렌더 calls,
//   offMaze 거울 뷰만 끈 calls, offAll 거울 뷰와 왕좌 뷰를 모두 끈 calls }

/** 고정 스텝 한 번의 길이. 관측이 스텝 끝에서만 이뤄지므로 시간 비교는 이 값만큼의 양자화 오차를 허용한다. */
export const FRAME = 1 / 60;
const EPS = 1e-6;
/** 진짜 거울 도달(done) 스텝의 영웅 위치 여유. 규칙은 같은 스텝의 영웅 위치로 반경을 판정하므로 부동소수 여유만 둔다(PLAN 6절 2). */
export const POSITION_SLACK = .01;
/** running 인데 영웅이 반경 안(반경 − 이 값)에 있으면 도달 판정이 빠진 것이다. 미궁 판정은 같은 스텝의 영웅 위치를 쓰고
 * (Battle.update: player.update → updateExpedition), 그 뒤 위치를 옮기는 군중 후처리는 적이 없는 미궁에서 일어나지 않는다.
 * 밀침은 속도로 다음 스텝에 적용된다. 그래서 규칙 반경 그대로에 부동소수 여유만 둔다(B08 리뷰 P2-2 교훈). 미궁이 열린 스텝만 면제한다(그 스텝은 도달을 판정하지 않는다, PLAN 3.1). */
export const INSIDE_MARGIN = POSITION_SLACK;
/** 환영 거울 접촉 스텝의 위치 여유: 같은 이유로 규칙 반경 그대로 + 부동소수 여유. */
export const TOUCH_SLACK = POSITION_SLACK;
const SETTLE_STEPS = 10;
const CARRY_MAX_STEPS = 90;
const ACTION_STATES = Object.freeze(['attack', 'skill', 'ult', 'dodge']);
/** 거울 뷰 상태 이름(PLAN 3.2 mirrorState). mv.s 는 이 순서의 번호다(알 수 없는 이름은 9). */
export const MIRROR_STATE_NAMES = Object.freeze(['hidden', 'real', 'illusion', 'shattered']);
export const MIRROR_STATE_CODE = Object.freeze(Object.fromEntries(MIRROR_STATE_NAMES.map((name, i) => [name, i])));
export const MAZE_PHASE_NAMES = Object.freeze(['idle', 'running', 'done']);
export const MAZE_PHASE_CODE = Object.freeze(Object.fromEntries(MAZE_PHASE_NAMES.map((name, i) => [name, i])));
export const GATE_PHASE_NAMES = Object.freeze(['spin', 'still', 'broken']);
export const GATE_PHASE_CODE = Object.freeze({ spin: 0, still: 1 });
/** 거울 뷰 draw call 상한(PLAN 3.2: 메시 4개). */
export const VIEW_DRAW_LIMIT = 4;
/** 거울 뷰 인스턴스 수 기대(보고 항목): 거울 틀 2 + 거울면 2 + 모래시계 원뿔 4 + 발자국 trailCount. 게이트가 아니다. */
export const mirrorViewCount = def => 8 + (def.escape?.trailCount ?? 0);
/** 거울 뷰가 사라지는 시한(PLAN 3.2: 부서진 뒤 0.5초). */
const SHATTER_SECONDS = .5;
const VIEW_AB_MIN_SAMPLES = 3;
export const THRONE_TITLE = '가짜 왕좌 파괴';
export const MAZE_TITLE = '거울 미궁 탈출';
/** 목표창 action 문구(PLAN 3.1). */
export const ACTION = Object.freeze({
  undiscovered: '다음 구역을 찾아 이동',
  fight: '이 구역의 적을 먼저 처치',
  still: '모래시계 멈춤 · 지금 왕좌 공격',
  spin: '모래시계 회전 · 멈출 때까지 대기',
});
export const mazeActionOf = seconds => '모래 발자국을 따라 진짜 거울로 · ' + seconds + '초';
/** 결과 화면 줄: '가짜 왕좌 파괴 4/4 · 완료'. */
export const throneResultLine = def => THRONE_TITLE + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';
/** 결과 화면 줄: '거울 미궁 탈출 완료 · 거울 붕괴 n회 · 환영 거울 n회'. */
export const mazeResultLine = escape => '거울 미궁 탈출 ' + (escape?.escaped ? '완료' : '미완료') + ' · 거울 붕괴 ' + escape?.collapses + '회 · 환영 거울 ' + escape?.illusions + '회';

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
const sameSet = (a, b) => a.length === b.length && JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
/** 같은 스텝을 한 번 더 기록한 표식 행(mk)을 빼고 스텝마다 첫 행만 남긴다. */
const stepRows = rows => { const seen = new Set(); return rows.filter(r => (seen.has(r.n) ? false : (seen.add(r.n), true))); };

// ---------- 왕좌 ----------
/**
 * 파괴한 왕좌 집합. bk 가 0 에서 1 이 되는 행으로 센다. 파괴한 방 집합 = 정의의 왕좌 방 집합이고(순서는 자유), 각 왕좌는 한 번만 부서지며 되돌아오지 않는다.
 */
export function checkThroneSet(rows, def) {
  const n = def.gates.length, want = def.gates.map(g => g.roomId), broken = [], undone = [];
  for (let i = 1; i < rows.length; i++) {
    rows[i].g?.forEach((g, k) => {
      const prev = rows[i - 1].g?.[k];
      if (g.bk === 1 && prev?.bk !== 1) broken.push({ gate: k, room: g.id, n: rows[i].n });
      if (g.bk !== 1 && prev?.bk === 1) undone.push({ gate: k, n: rows[i].n });
    });
  }
  const observed = broken.map(b => b.room);
  return { broken, observed, want, undone, count: broken.length, target: n,
    ok: broken.length === n && sameSet(observed, want) && new Set(observed).size === n && undone.length === 0 && rows.at(-1)?.pr === n };
}

/**
 * 균열이 는 스텝의 왕좌 phase 'still'(같은 스텝 관측 기준). 스텝 안에서 근접·광역 타격(player.update)은 경로 목표 갱신(route.update) 앞,
 * 투사체는 뒤에서 판정하므로 균열 판정이 본 phase 는 직전 스텝 끝(pph) 또는 이 스텝 끝(ph)이다. 정상 경로는 둘이다:
 * (1) 직전 스텝 끝이 still, (2) 회전→멈춤 전이 스텝: 직전 스텝 끝이 spin 이고 age + 한 프레임이 spinSeconds 에 닿아 이 스텝에 멈춤으로 넘어간 경우(투사체 순서).
 * 마지막 균열은 같은 스텝에 파괴되어 ph 가 broken 이 되므로 같은 두 경로로 본다. 그 밖(직전도 이 스텝도 spin)은 회전 중 균열 위반이다.
 * 추가로 그때 왕좌가 준비(rd)된 상태, 한 스텝에 +1, 같은 왕좌의 균열 간격 ≥ hitGap − 한 프레임.
 */
export function checkCracks(rows, def) {
  const seen = new Set(), lastT = new Map(), cracks = [], violations = [];
  for (const row of rows) {
    row.g?.forEach((g, i) => {
      if (!(g.dh > 0)) return;
      const key = row.n + ':' + i;
      if (seen.has(key)) return;
      seen.add(key);
      const still = g.pph === GATE_PHASE_CODE.still;
      const flipped = g.pph === GATE_PHASE_CODE.spin && Number.isFinite(g.pag) && g.pag + FRAME + EPS >= def.spinSeconds && g.ph !== GATE_PHASE_CODE.spin;
      const gap = lastT.has(i) ? row.t - lastT.get(i) : Infinity;
      lastT.set(i, row.t);
      const rec = { n: row.n, gate: i, roomId: g.id, dh: g.dh, pph: g.pph, ph: g.ph, pag: g.pag, ready: g.rd === 1, still, flipped, gap };
      cracks.push(rec);
      if (!(still || flipped)) violations.push({ kind: 'spinning', ...rec });
      if (g.rd !== 1) violations.push({ kind: 'not-ready', ...rec });
      if (g.dh !== 1) violations.push({ kind: 'multi-hit', ...rec });
      if (gap + FRAME + EPS < def.hitGap) violations.push({ kind: 'gap', ...rec, need: def.hitGap });
    });
  }
  const perGate = def.gates.map((_, i) => cracks.filter(c => c.gate === i).length);
  return { cracks: cracks.length, perGate, transitions: cracks.filter(c => !c.still && c.flipped).length, violations,
    ok: cracks.length > 0 && violations.length === 0 && perGate.every(count => count === def.hits) };
}

/**
 * 왕좌 준비(ready) 시점. 처음 rd = 1 이 관측된 행에서 그 방의 적·대기열이 0 이고, 정예방은 forgeWave = 증원 횟수다.
 * 정예방의 증원 전에는 어떤 행에서도 rd = 1 이 아니다. 왕좌마다 준비가 관측되어야 한다.
 */
export function checkReady(rows, def, { rooms = [], reinforcements = 0 } = {}) {
  const gates = def.gates.map((gate, i) => {
    const idx = rows.findIndex(r => r.g?.[i]?.rd === 1);
    const room = roomById(rooms, gate.roomId), elite = (room?.type ?? null) === 'elite';
    if (idx < 0) return { gate: i, roomId: gate.roomId, ready: false, ok: false };
    const g = rows[idx].g[i];
    const early = elite ? rows.filter(r => r.g?.[i]?.rd === 1 && r.g[i].fw !== reinforcements).length : 0;
    const dirty = rows.filter(r => r.g?.[i]?.rd === 1 && r.g[i].dh > 0 && (r.g[i].al !== 0 || r.g[i].pd !== 0)).length;
    return { gate: i, roomId: gate.roomId, type: room?.type ?? null, ready: true, n: rows[idx].n, alive: g.al, pending: g.pd, forgeWave: g.fw, want: elite ? reinforcements : null, earlyRows: early, dirtyHitRows: dirty,
      ok: g.al === 0 && g.pd === 0 && (!elite || g.fw === reinforcements) && early === 0 && dirty === 0 };
  });
  return { gates, ok: gates.length > 0 && gates.every(g => g.ok), eliteRooms: gates.filter(g => g.type === 'elite').map(g => g.roomId) };
}

/**
 * 보스 봉인. world.sealed 가 처음 false 가 된 행은 모든 왕좌가 부서지고(pr = n) 모든 비시작·비보스 방이 정화(rem = 0)된 뒤다. 시작부터 sealed 였다.
 * 거울 미궁이 있으면(opts.maze) 봉인은 done 전 내내 true 이고, 해제는 done 스텝 또는 그 뒤다(같은 스텝 unsealBoss). 일반(미궁 없음)은 마지막 파괴 뒤다.
 */
export function checkSeal(rows, def, { maze = false } = {}) {
  const n = def.gates.length;
  const first = rows.findIndex(r => r.sl === 0);
  const startsSealed = rows[0]?.sl === 1;
  if (first < 0) return { ok: false, startsSealed, reason: 'never-unsealed' };
  const row = rows[first], prev = rows[first - 1];
  const lastBreak = [...rows.keys()].filter(i => i > 0 && rows[i].pr > rows[i - 1].pr).at(-1) ?? -1;
  const doneIdx = rows.findIndex(r => r.mz?.ph === MAZE_PHASE_CODE.done);
  const base = startsSealed && prev?.sl === 1 && row.pr === n && row.rem === 0 && first > lastBreak;
  const afterDone = !maze || (doneIdx >= 0 && first >= doneIdx && row.mz?.ph === MAZE_PHASE_CODE.done && rows.slice(0, first).every(r => r.sl === 1));
  return { ok: base && afterDone, startsSealed, n: row.n, t: row.t, progress: row.pr, remaining: row.rem, afterLastBreak: first > lastBreak, doneIdx, firstUnsealed: first,
    afterDone, reason: base && afterDone ? null : 'early-or-inconsistent' };
}

// ---------- 거울 미궁 ----------
/**
 * 영웅 칸 거리 d 에서의 제한 시간: ceil(d / pace + grace). 도구가 브라우저 안에서 world.buildFlow(real.x, real.z) 로 다시 읽은 거리(fd)와
 * 인접 위치 거리 후보(fa, 칸 경계에서 관측 위치와 규칙 위치가 칸 하나 어긋나는 경우)에서 기대 값 집합을 만든다.
 */
export const limitOf = (escape, dist) => Math.ceil(dist / escape.pace + escape.grace);
export function expectedLimits(escape, mz) {
  if (!Number.isFinite(mz?.fd)) return { exact: null, allowed: [] };
  const exact = limitOf(escape, mz.fd);
  const allowed = [...new Set([exact, ...(mz.fa || []).filter(Number.isFinite).map(d => limitOf(escape, d))])];
  return { exact, allowed };
}

/**
 * 미궁 시작. running 이 처음 관측된 행에서: 그 전 표본은 모두 idle(running·done 없음), 이 행에 pr = n · 모든 왕좌 부서짐 · rem = 0 · cond,
 * 조건이 처음 관측된 스텝에서 최대 한 스텝 뒤에 시작, 시작 스텝은 limit = left(경과 0), 횟수 0, limit ≥ 1.
 */
export function checkMazeStart(rows, def) {
  const n = def.gates.length, idx = rows.findIndex(r => r.mz?.ph === MAZE_PHASE_CODE.running);
  if (idx < 0) return { ok: false, reason: 'never-running' };
  const r = rows[idx], before = rows.slice(0, idx);
  const notIdle = before.filter(x => !x.mz || x.mz.ph !== MAZE_PHASE_CODE.idle).length;
  const condIdx = rows.findIndex(x => x.cond === 1), lag = condIdx >= 0 ? r.n - rows[condIdx].n : null;
  const earlyCond = before.filter(x => x.cond === 1).length;
  const rec = { n: r.n, t: r.t, progress: r.pr, remaining: r.rem, cond: r.cond, lag, earlierRows: before.length, notIdleBefore: notIdle, earlyCondRows: earlyCond,
    brokenAll: r.g.every(g => g.bk === 1), limit: r.mz.lim, left: r.mz.lf, elapsed: r.mz.el, illusions: r.mz.ill, collapses: r.mz.col, hero: { x: r.x, z: r.z } };
  return { ...rec, ok: before.length > 0 && notIdle === 0 && r.pr === n && r.rem === 0 && r.cond === 1 && rec.brokenAll && lag !== null && lag >= 0 && lag <= 1
    && r.mz.ill === 0 && r.mz.col === 0 && r.mz.el <= FRAME + EPS && r.mz.lim >= 1 && Math.abs(r.mz.lf - r.mz.lim) <= FRAME + EPS };
}
/**
 * 제한 시간 계산. 도구가 거리(fd)를 다시 읽은 모든 행(시작 스텝, 붕괴 스텝)에서 limit 이 ceil(d / pace + grace) 집합 안에 있고
 * 붕괴 스텝은 left 가 새 limit 으로 돌아와 있다. 시작 스텝 행이 반드시 하나 있어야 한다.
 */
export function checkMazeLimit(rows, def) {
  const esc = def.escape, measured = stepRows(rows).filter(r => r.mz && Number.isFinite(r.mz.fd) && r.mz.ph === MAZE_PHASE_CODE.running);
  const list = measured.map(r => {
    const e = expectedLimits(esc, r.mz);
    return { n: r.n, hero: { x: r.x, z: r.z }, dist: r.mz.fd, limit: r.mz.lim, left: r.mz.lf, exact: e.exact, allowed: e.allowed, collapses: r.mz.col,
      ok: e.allowed.includes(r.mz.lim) && Math.abs(r.mz.lf - r.mz.lim) <= FRAME + EPS };
  });
  const start = rows.find(r => r.mz?.ph === MAZE_PHASE_CODE.running);
  const startMeasured = !!start && list.some(x => x.n === start.n);
  return { rows: list, startMeasured, ok: startMeasured && list.length > 0 && list.every(x => x.ok) };
}
/** 미궁 시계. 연속한 running 두 스텝(붕괴 없음)에서 left 는 게임 시간만큼 줄고 elapsed 는 늘어난다. 확인한 쌍이 minPairs 개 이상이어야 한다. */
export function checkMazeClock(rows, { minPairs = 30 } = {}) {
  const list = stepRows(rows), bad = [], pauseEntry = [];
  let pairs = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (!a.mz || !b.mz || a.mz.ph !== MAZE_PHASE_CODE.running || b.mz.ph !== MAZE_PHASE_CODE.running || b.n !== a.n + 1 || a.mz.col !== b.mz.col) continue;
    pairs++;
    const dt = b.t - a.t;
    // 정상 경로 하나만 면제한다: 그 스텝 안에서 전투가 일시정지됐다(pz). Battle.update 가 게임 시간을 먼저 올린 뒤
    // 게임 타이머(마지막 구역 정화 0.45초 뒤 각인 선택 창)가 정지를 걸면, 같은 스텝의 경로 목표 갱신은 돌지 않는다.
    // 이때는 시계·경과가 정확히 그대로여야 한다(조금이라도 바뀌면 위반).
    if (b.pz === 1 && b.mz.lf === a.mz.lf && b.mz.el === a.mz.el) { pauseEntry.push({ n: b.n, dt }); continue; }
    if (Math.abs((a.mz.lf - b.mz.lf) - dt) > EPS || Math.abs((b.mz.el - a.mz.el) - dt) > EPS) bad.push({ n: b.n, dt, left: [a.mz.lf, b.mz.lf], elapsed: [a.mz.el, b.mz.el] });
  }
  return { pairs, bad: bad.slice(0, 6), badCount: bad.length, pauseEntry, ok: pairs >= minPairs && bad.length === 0 };
}
/**
 * 진짜 거울 도달. done 은 직전 행이 running 이고 done 스텝 영웅–진짜 거울 거리 ≤ radius + .01 에서만 처음 관측된다.
 * running 행 중에 영웅이 반경 안 깊숙이(radius − INSIDE_MARGIN) 있는 행이 없다. done 뒤에는 다시 running 이 되지 않는다.
 */
export function checkMazeDone(rows, def) {
  const esc = def.escape, idx = rows.findIndex(r => r.mz?.ph === MAZE_PHASE_CODE.done);
  if (idx < 1) return { ok: false, reason: 'never-done' };
  const row = rows[idx], prev = rows[idx - 1];
  const opened = rows.find(r => r.mz?.ph === MAZE_PHASE_CODE.running)?.n;
  const inside = rows.filter(r => r.mz?.ph === MAZE_PHASE_CODE.running && r.n !== opened && r.mz.dm <= esc.radius - INSIDE_MARGIN).map(r => ({ n: r.n, dm: r.mz.dm }));
  const back = rows.slice(idx).filter(r => r.mz?.ph !== MAZE_PHASE_CODE.done).length;
  return { n: row.n, t: row.t, distance: row.mz.dm, limit: esc.radius + POSITION_SLACK, previous: prev.mz?.ph ?? null, insideNotDone: inside.slice(0, 4), insideCount: inside.length, back,
    elapsed: row.mz.el, hpAlive: row.al === 1 && row.hp > 0,
    ok: prev.mz?.ph === MAZE_PHASE_CODE.running && row.mz.dm <= esc.radius + POSITION_SLACK && inside.length === 0 && back === 0 && row.al === 1 };
}
/** AUTO 는 환영 거울에 닿지 않고 시간 초과도 없다: 모든 행 illusions = 0, collapses = 0 (running 이 관측되어야 한다). */
export function checkAutoCounts(rows) {
  const running = rows.filter(r => r.mz?.ph === MAZE_PHASE_CODE.running || r.mz?.ph === MAZE_PHASE_CODE.done);
  const ill = Math.max(0, ...running.map(r => r.mz.ill)), col = Math.max(0, ...running.map(r => r.mz.col));
  return { rows: running.length, illusions: ill, collapses: col, ok: running.length > 0 && ill === 0 && col === 0 };
}
/**
 * 발자국(trail). 갱신된 행(tr)마다: 점 수 = trailN ≤ trailCount, 모든 점 유한, 점이 둘 이상이면 첫 점보다 마지막 점이 진짜 거울에 더 가깝다.
 * running 에서 trailN ≥ 1 이 관측되고, 갱신 행이 minUpdates 개 이상이다. opts.real = 진짜 거울 좌표.
 */
export function checkTrail(rows, def, { real, minUpdates = 3 } = {}) {
  const esc = def.escape, list = rows.filter(r => Array.isArray(r.tr) && r.mz?.ph === MAZE_PHASE_CODE.running), bad = [];
  for (const r of list) {
    const pts = r.tr.length / 2;
    const finite = r.tr.every(Number.isFinite);
    const toward = pts < 2 || !real || Math.hypot(r.tr[0] - real.x, r.tr[1] - real.z) > Math.hypot(r.tr[2 * pts - 2] - real.x, r.tr[2 * pts - 1] - real.z);
    if (!finite || pts !== r.mz.tn || pts > esc.trailCount || !toward) bad.push({ n: r.n, points: pts, trailN: r.mz.tn, finite, toward });
  }
  const seen = rows.some(r => r.mz?.ph === MAZE_PHASE_CODE.running && r.mz.tn >= 1);
  return { updates: list.length, seen, bad: bad.slice(0, 6), badCount: bad.length, ok: seen && list.length >= minUpdates && bad.length === 0 };
}

// ---------- 거울 뷰 ----------
/** 미궁 phase 번호로 계산한 기대 거울 상태(mirrorState 계약: idle → hidden, running → real/illusion, done → shattered). */
export function expectedMirrorStates(phase) {
  if (phase === MAZE_PHASE_CODE.running) return ['real', 'illusion'];
  if (phase === MAZE_PHASE_CODE.done) return ['shattered', 'shattered'];
  return ['hidden', 'hidden'];
}
/**
 * 거울 뷰 행 판정(시작 행 n 0 제외). states: 모든 행에서 mv.s 가 같은 스텝 maze.phase 로 계산한 기대 상태, footprints: running 에서 f ≥ 1 인 행이 있고 모든 행 f ≤ trailCount,
 * draw: 모든 행 d ≤ 4 이고 hidden 상태 행은 d = 0, hide: 부서진 뒤 SHATTER_SECONDS 가 지난 행은 d = 0(그 이후 행이 있어야 확인 가능).
 * 보고: count 값들(기대 mirrorViewCount).
 */
export function checkMazeView(rows, def) {
  const esc = def.escape, body = rows.filter(r => r.n > 0 && r.mz);
  const withView = body.filter(r => r.mv), missing = body.length - withView.length;
  const stateBad = [], drawBad = [];
  for (const r of withView) {
    const want = expectedMirrorStates(r.mz.ph), got = r.mv.s.map(c => MIRROR_STATE_NAMES[c] ?? 'unknown');
    if (got[0] !== want[0] || got[1] !== want[1]) stateBad.push({ n: r.n, phase: r.mz.ph, got, want });
    if (!(Number.isFinite(r.mv.d) && r.mv.d <= VIEW_DRAW_LIMIT) || (got[0] === 'hidden' && got[1] === 'hidden' && r.mv.d !== 0)) drawBad.push({ n: r.n, drawCalls: r.mv.d, states: got });
  }
  const running = withView.filter(r => r.mz.ph === MAZE_PHASE_CODE.running);
  const footBad = withView.filter(r => !(r.mv.f >= 0 && r.mv.f <= esc.trailCount)).map(r => ({ n: r.n, footprints: r.mv.f }));
  const footMax = Math.max(0, ...running.map(r => r.mv.f));
  const done = body.find(r => r.mz.ph === MAZE_PHASE_CODE.done);
  const late = done ? withView.filter(r => r.mz.ph === MAZE_PHASE_CODE.done && r.t >= done.t + SHATTER_SECONDS + 2 * FRAME) : [];
  const stillDrawn = late.filter(r => r.mv.d !== 0).map(r => ({ n: r.n, drawCalls: r.mv.d }));
  const counts = [...new Set(withView.map(r => r.mv.c))];
  return { rows: withView.length, missing, stateBad: stateBad.slice(0, 6), stateBadCount: stateBad.length, drawBad: drawBad.slice(0, 6), drawBadCount: drawBad.length,
    footprintsMax: footMax, footBad: footBad.slice(0, 4), runningRows: running.length, hideRows: late.length, stillDrawn: stillDrawn.slice(0, 4), counts, expectedCount: mirrorViewCount(def),
    ok: { states: withView.length > 0 && missing === 0 && stateBad.length === 0 && running.length > 0,
      footprints: running.length > 0 && footMax >= 1 && footBad.length === 0,
      draw: withView.length > 0 && drawBad.length === 0,
      hide: late.length > 0 && stillDrawn.length === 0 } };
}
/**
 * 같은 프레임 A/B(C 제어 렌더). 거울 뷰 상태가 바뀐 스텝 끝과 running 중 간격에서 같은 프레임을 mazeView.group 켠 채·끈 채 그린 calls 차이(gpu = on − offMaze)가
 * 0 이상 limit(4) 이하이고 mazeView.drawCalls 와 같아야 한다. 표본이 minSamples 이상이고 hidden · running · shattered 를 각각 포함하며, running 표본은 실제로 그려져야 한다(gpu ≥ 1).
 * 보고: 왕좌 뷰(route.view.group)까지 끈 경로 목표 전체 차이(routeGpu = on − offAll)와 mazeView + route.view 주장 합계와의 일치.
 */
export function checkMazeViewGpu(samples, def, { limit = VIEW_DRAW_LIMIT, minSamples = VIEW_AB_MIN_SAMPLES } = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const rows = list.map(s => {
    const gpu = Number.isFinite(s.on) && Number.isFinite(s.offMaze) ? s.on - s.offMaze : null;
    const routeGpu = Number.isFinite(s.on) && Number.isFinite(s.offAll) ? s.on - s.offAll : null;
    const routeClaimed = Number.isFinite(s.mzCalls) && Number.isFinite(s.rtCalls) ? s.mzCalls + s.rtCalls : null;
    return { label: s.label ?? null, n: s.n, phase: s.ph, claimed: s.mzCalls ?? null, routeClaimed, on: s.on ?? null, offMaze: s.offMaze ?? null, offAll: s.offAll ?? null, viewGpuCalls: gpu, routeGpuCalls: routeGpu,
      matches: gpu !== null && gpu === s.mzCalls, within: gpu !== null && gpu >= 0 && gpu <= limit, routeMatches: routeGpu !== null && routeGpu === routeClaimed };
  });
  const bad = rows.filter(r => !r.matches || !r.within);
  const phases = new Set(rows.map(r => r.phase));
  const coverage = { hidden: phases.has(MAZE_PHASE_CODE.idle), running: phases.has(MAZE_PHASE_CODE.running), shattered: phases.has(MAZE_PHASE_CODE.done) };
  const unseen = rows.filter(r => r.phase === MAZE_PHASE_CODE.running && !(r.viewGpuCalls >= 1));
  const gpus = rows.map(r => r.viewGpuCalls).filter(Number.isFinite), routeGpus = rows.map(r => r.routeGpuCalls).filter(Number.isFinite);
  const ok = rows.length >= minSamples && bad.length === 0 && coverage.hidden && coverage.running && coverage.shattered && unseen.length === 0;
  return { classification: 'C', limit, minSamples, samples: rows.length, max: gpus.length ? Math.max(...gpus) : null, coverage, bad: bad.slice(0, 6), unseenRunning: unseen.slice(0, 4), rows,
    route: { note: '보고 항목: 왕좌 뷰(route.view.group)까지 포함한 경로 목표 전체 A/B', max: routeGpus.length ? Math.max(...routeGpus) : null, mismatches: rows.filter(r => !r.routeMatches).length, samples: routeGpus.length },
    reason: ok ? null : !rows.length ? 'no-samples' : rows.length < minSamples ? 'too-few-samples' : bad.length ? 'mismatch-or-over-limit' : unseen.length ? 'running-not-drawn' : 'coverage', ok };
}

// ---------- 결과·목표창 ----------
/**
 * 결과 객체: { id, label '가짜 왕좌 파괴', complete true, progress n, target n, rooms = 부순 방(순서 자유) } + 심층은 escape { escaped true, collapses, illusions, seconds }, 일반은 escape 없음.
 * opts.mazeSeconds(관측한 done 스텝의 maze.elapsed)가 있으면 escape.seconds 가 소수 2자리 반올림 안에서 같다. opts.clean 이면 collapses = illusions = 0(AUTO).
 */
export function checkResultFields(ro, def, win = true, { mazeSeconds = null, clean = false } = {}) {
  const n = def.gates.length, rooms = def.gates.map(g => g.roomId);
  const got = ro ? { id: ro.id, label: ro.label ?? null, complete: ro.complete, progress: ro.progress, target: ro.target, rooms: [...(ro.rooms || [])], escape: ro.escape ?? null } : null;
  const base = !!ro && win === true && ro.id === def.id && ro.label === THRONE_TITLE && ro.complete === true && ro.progress === n && ro.target === n && sameSet(ro.rooms || [], rooms);
  let escapeOk;
  if (def.escape) {
    const e = ro?.escape;
    escapeOk = !!e && e.escaped === true && Number.isInteger(e.collapses) && e.collapses >= 0 && Number.isInteger(e.illusions) && e.illusions >= 0 && Number.isFinite(e.seconds) && e.seconds >= 0
      && (!clean || (e.collapses === 0 && e.illusions === 0)) && (mazeSeconds === null || Math.abs(e.seconds - mazeSeconds) <= .006 + EPS);
  } else escapeOk = !!ro && (ro.escape === undefined || ro.escape === null);
  return { ok: base && escapeOk, got, want: { id: def.id, label: THRONE_TITLE, complete: true, progress: n, target: n, rooms, escape: def.escape ? 'escaped true' : null }, mazeSeconds };
}
/** 결과 화면 줄: '가짜 왕좌 파괴 n/n · 완료' + (심층) '거울 미궁 탈출 완료 · 거울 붕괴 n회 · 환영 거울 n회'(횟수는 결과 escape 와 같다). 일반에는 거울 미궁 줄이 없다. */
export function checkResultLines(text, def, ro) {
  const throne = throneResultLine(def), t = typeof text === 'string' ? text : '';
  const maze = def.escape ? mazeResultLine(ro?.escape) : null;
  const throneOk = t.includes(throne);
  const mazeOk = def.escape ? !!ro?.escape?.escaped && t.includes('거울 미궁 탈출 완료') && t.includes(maze) : !t.includes('거울 미궁');
  return { ok: throneOk && mazeOk, throne, maze, throneOk, mazeOk };
}
/**
 * 관측값으로 계산한 목표창 기대 문구. 미궁 running 이면 '거울 미궁 탈출' + '모래 발자국을 따라 진짜 거울로 · n초'(10Hz 갱신 지연으로 ceil(left) 또는 +1),
 * 왕좌 단계는 아직 부수지 않은 첫 왕좌의 상태(미발견 · 적 처치 · 멈춤 · 회전). 4/4 이후(idle · done)와 왕좌가 없을 때는 표본을 쓰지 않는다(null).
 */
export function expectedObjective(row) {
  const mz = row.mz;
  if (mz?.ph === MAZE_PHASE_CODE.running) { const c = Math.ceil(mz.lf); return { title: MAZE_TITLE, phase: 'maze', actions: [mazeActionOf(c), mazeActionOf(c + 1)] }; }
  if (mz && mz.ph !== MAZE_PHASE_CODE.idle) return null;
  const cur = (row.g || []).find(g => g.bk !== 1);
  if (!cur) return null;
  if (cur.dc !== 1) return { title: THRONE_TITLE, phase: 'throne', actions: [ACTION.undiscovered] };
  if (cur.rd !== 1) return { title: THRONE_TITLE, phase: 'throne', actions: [ACTION.fight] };
  return { title: THRONE_TITLE, phase: 'throne', actions: [cur.ph === GATE_PHASE_CODE.still ? ACTION.still : ACTION.spin] };
}
/**
 * 목표창 표본(같은 상태가 0.6초 이어진 뒤). 기대 문구가 있는 모든 표본에 제목과 action 이 들어 있고, 왕좌 단계 표본이 1개 이상,
 * 심층은 미궁 단계 표본이 1개 이상, 일반은 어떤 표본에도 '거울 미궁'이 없다.
 */
export function checkObjectiveSamples(rows, def) {
  const samples = rows.filter(r => typeof r.dom === 'string');
  const kinds = samples.map(r => ({ row: r, want: expectedObjective(r) }));
  const judged = kinds.filter(k => k.want !== null);
  const bad = judged.filter(k => !k.row.dom.includes(k.want.title) || !k.want.actions.some(a => k.row.dom.includes(a))).map(k => ({ n: k.row.n, want: k.want, dom: k.row.dom }));
  const stray = !def.escape ? samples.filter(r => r.dom.includes('거울 미궁')).length : 0;
  const throne = judged.filter(k => k.want.phase === 'throne').length, maze = judged.filter(k => k.want.phase === 'maze').length;
  return { samples: samples.length, judged: judged.length, throne, maze, stray, bad: bad.slice(0, 6),
    ok: bad.length === 0 && throne >= 1 && stray === 0 && (!def.escape || maze >= 1) };
}

/**
 * 결과 화면의 결과 줄 요소(실제 UI DOM). aria-label '가짜 왕좌 파괴 결과'의 본문이 '가짜 왕좌 파괴 n/n · 완료'이고,
 * 심층은 aria-label '거울 미궁 탈출 결과'의 본문이 '거울 미궁 탈출 완료 · 거울 붕괴 n회 · 환영 거울 n회'(횟수는 결과 escape 와 같음), 일반에는 이 요소가 없다.
 * lines: [{ label, text }]. 공백은 하나로 접어 비교한다.
 */
export function checkResultLineElements(lines, def, ro) {
  const list = Array.isArray(lines) ? lines : [], norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const throne = list.find(l => l.label === THRONE_TITLE + ' 결과'), maze = list.find(l => l.label === MAZE_TITLE + ' 결과');
  const throneOk = !!throne && norm(throne.text) === throneResultLine(def);
  const mazeOk = def.escape ? !!maze && !!ro?.escape && norm(maze.text) === mazeResultLine(ro.escape) : !maze;
  return { ok: throneOk && mazeOk, throneOk, mazeOk, labels: list.map(l => l.label) };
}

// ---------- 종합 ----------
/**
 * 한 번 완주(AUTO)의 종합 판정. obs: { rows, result, resultText, win, rooms, viewAB, mazeSetup, hasMaze, hasMazeView }.
 * mazeSetup: 페이지가 begin 에서 읽은 { roomOk(거울 방 id), realOk, illusionOk } 와 진짜 거울 좌표 real { x, z }.
 * opts: { reinforcements, clean(AUTO: 환영 접촉·붕괴 0, 기본 참) }. ok 는 acceptance 의 모든 항목이 통과일 때만 true 다.
 * 정의에 escape 가 없으면(일반) 거울 미궁·뷰가 없어야 한다.
 */
export function analyzeThrones(obs, def, { reinforcements = 0, clean = true } = {}) {
  const rows = obs.rows || [], deep = !!def.escape;
  const set = checkThroneSet(rows, def);
  const cracks = checkCracks(rows, def);
  const ready = checkReady(rows, def, { reinforcements, rooms: obs.rooms });
  const seal = checkSeal(rows, def, { maze: deep });
  const doneRow = rows.find(r => r.mz?.ph === MAZE_PHASE_CODE.done);
  const result = checkResultFields(obs.result, def, obs.win === true, { mazeSeconds: doneRow ? doneRow.mz.el : null, clean });
  const line = checkResultLines(obs.resultText, def, obs.result);
  const objective = checkObjectiveSamples(rows, def);
  const acceptance = { throneSet: set.ok, throneCracks: cracks.ok, throneReady: ready.ok, sealed: seal.ok, resultFields: result.ok, resultLine: line.ok, objectiveText: objective.ok };
  // 결과 줄 DOM 요소(aria-label)는 도구가 읽어 넘겼을 때만 판정한다.
  const elements = Array.isArray(obs.resultLines) ? checkResultLineElements(obs.resultLines, def, obs.result) : null;
  if (elements) acceptance.resultLineElements = elements.ok;
  let maze = null, view = null, gpu = null, noMaze = null;
  if (deep) {
    const setup = obs.mazeSetup || {};
    maze = { setup, start: checkMazeStart(rows, def), limit: checkMazeLimit(rows, def), clock: checkMazeClock(rows), done: checkMazeDone(rows, def), counts: checkAutoCounts(rows),
      trail: checkTrail(rows, def, { real: setup.real }) };
    view = checkMazeView(rows, def);
    gpu = checkMazeViewGpu(obs.viewAB, def);
    Object.assign(acceptance, { mazeExists: !!obs.hasMaze && !!obs.hasMazeView && setup.roomOk === true && setup.realOk === true && setup.illusionOk === true,
      mazeStart: maze.start.ok, mazeLimit: maze.limit.ok, mazeClock: maze.clock.ok, mazeDone: maze.done.ok, mazeTrail: maze.trail.ok,
      ...(clean ? { autoCounts: maze.counts.ok } : {}),
      mazeViewStates: view.ok.states, mazeViewFootprints: view.ok.footprints, mazeViewDraw: view.ok.draw, mazeViewHide: view.ok.hide, mazeViewGpu: gpu.ok });
  } else {
    noMaze = { hasMaze: !!obs.hasMaze, hasMazeView: !!obs.hasMazeView, rowsWithMaze: rows.filter(r => r.mz || r.mv).length };
    acceptance.noMaze = !noMaze.hasMaze && !noMaze.hasMazeView && noMaze.rowsWithMaze === 0;
  }
  return { ok: Object.values(acceptance).every(Boolean), acceptance, set, cracks, ready, seal, result, resultLine: line, resultElements: elements, objective, maze, view, gpu, noMaze, rows: rows.length };
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
/**
 * order 프로필 판정(키보드만, 공격 키 없음). 표식: manual-start(AUTO 끔, 미궁 running) · center(환영 접촉 뒤 방 중심, 두 거울에서 떨어짐) · real-reach(done 스텝).
 * illusion: manual-start 뒤 처음 illusions 가 는 행 — 직전 스텝보다 HP 감소, 영웅–환영 거울 거리 ≤ radius + TOUCH_SLACK, 쿨다운 ≈ illusionCooldown, running 유지·봉인 유지.
 * collapse: center 뒤 처음 collapses 가 는 행 — 그 구간 내내 두 거울에서 3 이상 떨어짐, 직전 스텝보다 HP 감소, limit > 0 재계산(도구가 다시 잰 거리 집합 안), left = limit, running 유지.
 * done: manual-start 뒤 처음 done 인 행 — 영웅–진짜 거울 거리 ≤ radius + .01, 직전 행 running, 봉인 해제는 done 스텝 또는 그 뒤. 환영 접촉·시간 초과 구간 내내 done 아님·sealed.
 * result: opts.result.escape { escaped true, collapses ≥ 1, illusions ≥ 1 }이고 마지막 관측 횟수와 같다. 모든 구간이 AUTO 꺼짐 · 공격 입력 없음 · 영웅 생존.
 */
export function analyzeOrder(rows, def, { result = null, away = 3 } = {}) {
  const esc = def.escape;
  const names = ['manual-start', 'center', 'real-reach'];
  const m = Object.fromEntries(names.map(k => [k, markOf(rows, k)]));
  const missing = names.filter(k => !m[k]);
  if (missing.length) return { ok: false, reason: 'missing-marks', missing, keyboard: { ok: false }, illusion: { ok: false }, collapse: { ok: false }, done: { ok: false }, result: { ok: false } };
  const at = k => markIndex(rows, k);
  const keyboard = checkKeyboardSegment(rows, 'manual-start', 'real-reach');
  const from = at('manual-start'), center = at('center'), reach = at('real-reach');
  const base = rows[from].mz;
  // 직전 스텝의 행(키보드 구간은 매 스텝 행이다). 같은 스텝의 표식 행은 건너뛴다.
  const prevStep = idx => { for (let i = idx - 1; i >= 0; i--) if (rows[i].n < rows[idx].n) return rows[i]; return null; };
  const ii = rows.findIndex((r, i) => i >= from && r.mz && r.mz.ill > base.ill);
  let illusion = { ok: false, reason: 'no-touch' };
  if (ii >= 0) {
    const r = rows[ii], p = prevStep(ii);
    illusion = { n: r.n, illusions: r.mz.ill, distance: r.mz.di, limit: esc.radius + TOUCH_SLACK, hpDrop: p ? p.hp - r.hp : null, cooldown: r.mz.cd, running: r.mz.ph === MAZE_PHASE_CODE.running, sealed: r.sl === 1,
      ok: r.mz.ph === MAZE_PHASE_CODE.running && r.sl === 1 && r.mz.di <= esc.radius + TOUCH_SLACK && !!p && p.hp - r.hp > 0 && r.mz.cd >= esc.illusionCooldown - FRAME - EPS };
  }
  const cb = rows[center].mz;
  const ci = rows.findIndex((r, i) => i > center && r.mz && r.mz.col > cb.col);
  let collapse = { ok: false, reason: 'no-collapse' };
  if (ci >= 0) {
    const r = rows[ci], p = prevStep(ci), seg = rows.slice(center, ci + 1);
    const near = seg.filter(x => x.mz.dm < away || x.mz.di < away).length;
    const lim = checkMazeLimit([r], def);
    collapse = { n: r.n, collapses: r.mz.col, nearRows: near, away, hpDrop: p ? p.hp - r.hp : null, limit: r.mz.lim, left: r.mz.lf, running: r.mz.ph === MAZE_PHASE_CODE.running, limitCheck: lim.rows[0] ?? null, illusionsBefore: cb.ill,
      ok: r.mz.ph === MAZE_PHASE_CODE.running && near === 0 && !!p && p.hp - r.hp > 0 && r.mz.lim > 0 && lim.ok };
  }
  const di = rows.findIndex((r, i) => i >= from && r.mz?.ph === MAZE_PHASE_CODE.done);
  let done = { ok: false, reason: 'no-done' };
  if (di > 0) {
    const r = rows[di], before = rows.slice(from, di);
    const premature = before.filter(x => x.mz?.ph !== MAZE_PHASE_CODE.running || x.sl !== 1).length;
    const firstUnsealed = rows.findIndex(x => x.sl === 0);
    done = { n: r.n, distance: r.mz.dm, limit: esc.radius + POSITION_SLACK, previous: rows[di - 1].mz?.ph ?? null, prematureRows: premature, firstUnsealed, alive: r.al === 1,
      ok: r.mz.dm <= esc.radius + POSITION_SLACK && rows[di - 1].mz?.ph === MAZE_PHASE_CODE.running && premature === 0 && firstUnsealed >= di && r.al === 1 && di <= reach };
  }
  const last = [...rows].reverse().find(r => r.mz);
  const e = result?.escape ?? null;
  const resultCheck = { escape: e, lastIllusions: last?.mz.ill ?? null, lastCollapses: last?.mz.col ?? null,
    ok: !!e && e.escaped === true && e.collapses >= 1 && e.illusions >= 1 && e.collapses === last?.mz.col && e.illusions === last?.mz.ill };
  return { ok: keyboard.ok && illusion.ok && collapse.ok && done.ok && resultCheck.ok, keyboard, illusion, collapse, done, result: resultCheck };
}

// ---------- pause 프로필 ----------
/**
 * running 중 일시정지. before: 정지 직전(left ≤ limit − 1), paused: 정지 직후, still: 120스텝+1초 뒤, resumed: 재개 뒤 steps 스텝.
 * 각 인자는 페이지 freeze 결과 { elapsed, paused, mz: { ph, lim, lf, el, col, ill, cd, tn }, tr: 발자국 좌표, mv: { s, f, d } }.
 * 게임 시간 · left · elapsed · 쿨다운 · 횟수 · trail · 거울 뷰(상태·발자국·draw call) 불변, 재개 뒤 left 가 steps 프레임만큼 줄고 elapsed 가 같은 만큼 는다.
 */
export function checkPause({ before, paused, still, resumed, steps, minElapsed = 1 }) {
  const mzKey = o => (o?.mz ? JSON.stringify([o.mz.ph, o.mz.lim, o.mz.lf, o.mz.el, o.mz.col, o.mz.ill, o.mz.cd, o.mz.tn]) : null);
  const trKey = o => JSON.stringify(o?.tr ?? null), mvKey = o => JSON.stringify(o?.mv ? [o.mv.s, o.mv.f, o.mv.d] : null);
  const same = (f, a, b) => f(a) !== null && f(a) === f(b);
  const running = before?.mz?.ph === MAZE_PHASE_CODE.running && before.mz.lf <= before.mz.lim - minElapsed + EPS;
  const frozen = !!before && !!paused && !!still && running && paused.paused === true && still.paused === true
    && paused.elapsed === before.elapsed && still.elapsed === before.elapsed
    && same(mzKey, before, paused) && same(mzKey, before, still) && same(trKey, before, paused) && same(trKey, before, still) && same(mvKey, before, paused) && same(mvKey, before, still);
  const advanced = !!resumed && !!still ? still.mz.lf - resumed.mz.lf : null;
  const resumedOk = frozen && !!resumed && resumed.mz.ph === MAZE_PHASE_CODE.running && Math.abs(advanced - steps * FRAME) <= 2 * FRAME
    && Math.abs((resumed.mz.el - still.mz.el) - steps * FRAME) <= 2 * FRAME && Math.abs(resumed.elapsed - still.elapsed - steps * FRAME) <= 2 * FRAME && resumed.mz.col === still.mz.col;
  return { ok: frozen && resumedOk, frozen, resumedOk, running, expectedAdvance: steps * FRAME, leftAdvance: advanced,
    before: before ?? null, paused: paused ?? null, still: still ?? null, resumed: resumed ?? null };
}
/** 재개 뒤에도 미궁이 끝까지 간다: 표식 resume 뒤에 done 이 있고 그 사이 붕괴·환영 접촉이 없다(AUTO). */
export function analyzePauseResume(rows) {
  const idx = markIndex(rows, 'resume');
  if (idx < 0) return { ok: false, reason: 'missing-mark' };
  const after = rows.slice(idx);
  const done = after.find(r => r.mz?.ph === MAZE_PHASE_CODE.done);
  const last = [...after].reverse().find(r => r.mz);
  return { resumeN: rows[idx].n, doneN: done?.n ?? null, collapses: last?.mz.col ?? null, illusions: last?.mz.ill ?? null, ok: !!done && last?.mz.col === 0 && last?.mz.ill === 0 };
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
 * screens 순간의 화면 상태. shot.capture 는 PNG 를 찍은 스텝의 관측 행(freeze), shot.stop 은 멈춘 스텝의 행(freeze, prev 에 직전 스텝의 미궁 phase 와 거울 상태)이다.
 * kind: 'throne-still'(준비된 왕좌의 phase 가 still) · 'maze-start'(running 첫 스텝, 같은 프레임에 거울이 hidden → real/illusion) · 'footprints'(running, footprints ≥ minFootprints) ·
 * 'escaped'(done 뒤 minAfter 초, 거울 states shattered). states 는 PNG 마다 기록하도록 돌려준다.
 */
export function checkScreenMoment(shot, want) {
  const row = shot?.capture ?? null, stop = shot?.stop ?? null;
  const names = row?.mv ? row.mv.s.map(c => MIRROR_STATE_NAMES[c] ?? 'unknown') : null;
  const ph = row?.mz?.ph ?? null;
  const rec = { states: names, phase: ph, footprints: row?.mv?.f ?? null };
  if (!row) return { ok: false, ...rec };
  if (want.kind === 'throne-still') {
    const gate = (row.g || []).find(g => g.rd === 1 && g.bk !== 1 && g.ph === GATE_PHASE_CODE.still);
    const hidden = !names || (names[0] === 'hidden' && names[1] === 'hidden');
    return { ...rec, gate: gate?.id ?? null, ok: !!gate && hidden };
  }
  if (want.kind === 'maze-start') {
    const prev = stop?.prev ?? null, prevHidden = !!prev && prev.mzph === MAZE_PHASE_CODE.idle && prev.s?.[0] === MIRROR_STATE_CODE.hidden && prev.s?.[1] === MIRROR_STATE_CODE.hidden;
    return { ...rec, prevHidden, sameFrame: names?.[0] === 'real' && names?.[1] === 'illusion', ok: ph === MAZE_PHASE_CODE.running && prevHidden && names?.[0] === 'real' && names?.[1] === 'illusion' };
  }
  if (want.kind === 'footprints') {
    return { ...rec, ok: ph === MAZE_PHASE_CODE.running && names?.[0] === 'real' && names?.[1] === 'illusion' && (row.mv?.f ?? 0) >= (want.minFootprints ?? 3) };
  }
  const after = Number.isFinite(row.doneT) && row.doneT >= 0 ? row.elapsed - row.doneT : null;
  return { ...rec, afterDone: after, ok: ph === MAZE_PHASE_CODE.done && names?.[0] === 'shattered' && names?.[1] === 'shattered' && after !== null && after + FRAME + EPS >= (want.minAfter ?? .3) };
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
 * 기준선이 후보와 다른 빌드인지, 양쪽이 pass 인지. depth 'deep' 은 기준선에 거울 미궁 정의(escape)가 없고 후보에 있어야 하고,
 * 'standard' 는 둘 다 같은 정의이고 escape 가 없어야 한다. 두 report 의 HEAD 는 달라야 한다(같은 빌드끼리의 비교는 합격하지 않는다).
 * 후보는 왕좌·미궁 판정(throneOk)까지 통과해야 하고 일반 기준선도 왕좌 판정을 통과해야 한다(일반 규칙은 기준선에도 있다).
 */
export function compareTargetsOk(cand, base, depth) {
  if (!cand || !base) return false;
  const differs = !!cand.head && !!base.head && cand.head !== base.head;
  const definition = depth === 'deep' ? !base.routeDefinition?.escape && !!cand.routeDefinition?.escape
    : !!base.routeDefinition && !!cand.routeDefinition && !cand.routeDefinition.escape && !base.routeDefinition.escape
      && JSON.stringify(base.routeDefinition) === JSON.stringify(cand.routeDefinition);
  const baseJudged = depth === 'deep' ? true : base.throneOk === true;
  return differs && definition && cand.throneOk === true && baseJudged && cand.status === 'pass' && base.status === 'pass' && cand.runStatus === 'pass' && base.runStatus === 'pass';
}
/** 두 report 의 실행 설정이 같은지: 영웅 · 시드 · depth · 재시드에 더해 viewport · motion · quality 도 같아야 비교가 성립한다(없는 값은 같지 않다고 본다). */
export function compareSetup(cand, base) {
  const eq = key => cand?.[key] != null && JSON.stringify(cand[key]) === JSON.stringify(base?.[key]);
  const same = { hero: eq('heroId'), seed: eq('seed'), depth: eq('depth'), reseed: eq('reseedOn'), viewport: eq('viewport'), motion: eq('motion'), quality: eq('quality') };
  return { same, ok: Object.values(same).every(Boolean) };
}
/** 1000 스텝당 50ms 초과 수(보고 항목). 스텝 수가 없거나 0 이면 null. */
export const overPer1000 = (over, steps) => (Number.isFinite(over) && Number.isFinite(steps) && steps > 0 ? over / steps * 1000 : null);
/**
 * PLAN 5절 5 기준선 비교. cand/base: { time 완주 초(승리만), samples, runOver50, steps(보고용), throneRooms(cand), viewGpu(cand 의 checkMazeViewGpu 결과, 심층), routeViewGpu(보고용) }.
 * 사전 선언된 게이트: 완주 시간 비 ≤ timeRatio(심층 · 일반), 전체 런 50ms 초과 수 ≤ 기준선 + slowExtra, 후보 심층의 거울 뷰 같은 프레임 A/B(viewGpu.ok).
 * 보고 항목(게이트 아님): 왕좌 방 첫 진입 draw call 증가, 50ms 초과율, 일반 완주 시간 비가 1.00 ± 0.05 인지, 왕좌 뷰까지 포함한 경로 목표 전체 A/B.
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
    note: '보고 항목(게이트 아님, PLAN 5절 5 사전 선언): 왕좌 방 첫 진입 draw call 증가 · 50ms 초과율 · 일반 완주 시간 비 1.00 ± 0.05 · 왕좌 뷰까지 포함한 경로 목표 전체 A/B',
    roomEnterDrawCalls: roomDrawCalls(cand?.samples, base?.samples, cand?.throneRooms),
    over50PerThousandSteps: { cand: overPer1000(c, cand?.steps), base: overPer1000(d, base?.steps), steps: { cand: cand?.steps ?? null, base: base?.steps ?? null } },
    timeParity: { ratio, target: 1, tolerance: .05, within: ratio !== null && Math.abs(ratio - 1) <= .05, applies: !deep },
    routeViewGpu: cand?.routeViewGpu ?? null,
  };
  return { ok: Object.values(gates).every(Boolean), gates, time, slow, viewGpu, report };
}
