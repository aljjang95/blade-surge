/**
 * 전운 굴리기 슬롯머신 릴 타임라인(순수 함수). 설계: docs/RUNE_AND_BLESSING_DESIGN.md 3.5.
 * - 결과는 굴림(economy.blessingRoll) 시점에 이미 정해져 있고, 여기서는 "언제 어느 칸이 보이는지"만 계산한다.
 * - 위치 단위는 칸(cell). 릴 띠는 위→아래로 흐르고, 위치가 1 늘면 문양 1칸이 지나간다.
 * - 일정 속도로 돌다가 멈춤 직전 짧게 급감속하고, 멈춤 시각에 결과 칸을 지나 6% 튀었다가 제자리로 돌아온다.
 * - 건너뛰기는 남은 릴을 즉시 "준비 완료(ready)" 상태로 보낸다. 결과 칸은 그대로다.
 */

/** 기본 연출(2.4초)과 짧게(0.6초). stops: 릴별 멈춤 시각, ready: 카드 선택 가능 시각. */
export const REEL_TIMINGS = Object.freeze({
  full: Object.freeze({ stops: Object.freeze([1.2, 1.7, 2.2]), ready: 2.4, decel: 0.34, settle: 0.2, speed: 13 }),
  short: Object.freeze({ stops: Object.freeze([0.36, 0.48, 0.6]), ready: 0.6, decel: 0.12, settle: 0.12, speed: 15 }),
});

/** 멈춤 튕김 크기(칸 높이의 6%). */
export const REEL_OVERSHOOT = 0.06;
/** 째깍 소리 최소 간격(초당 약 12회 상한). */
export const TICK_MIN_INTERVAL = 1 / 12;
/** 감속이 끝나 멈춤 칸으로 들어갈 때 남기는 속도 비율(급감속 뒤 "쿵" 하고 박히는 느낌). */
const END_SPEED_RATIO = 0.16;

// 튕김 곡선 b(τ) = sin(πτ)(1−τ), τ∈[0,1]. 꼭짓점을 1로 맞춘다(τ≈0.35, 값≈0.58).
const bump = (/** @type {number} */ u) => Math.sin(Math.PI * u) * (1 - u);
const BUMP_PEAK = (() => { let m = 0; for (let i = 0; i <= 1000; i++) m = Math.max(m, bump(i / 1000)); return m; })();

/**
 * 릴 3개의 움직임 계획. finalCells[i]는 릴 i가 멈출 칸 번호(띠 길이에 맞춰 호출자가 정한 정수).
 * 기본값은 속도 × 멈춤 시각에서 가장 가까운 정수다(cellsForReel 참고).
 * @param {{ short?: boolean, finalCells?: number[] }} [options]
 */
export function planReels({ short = false, finalCells } = {}) {
  const t = short ? REEL_TIMINGS.short : REEL_TIMINGS.full;
  const reels = t.stops.map((stop, i) => {
    const decel = Math.min(t.decel, stop * 0.5), start = stop - decel;
    // 일정 구간 거리 v·start + 감속 구간 거리 ≈ v·decel·(1+e)/2 가 정수 칸에 떨어지도록 v 를 미세 조정한다.
    const unit = start + decel * (1 + END_SPEED_RATIO) / 2;
    const final = finalCells?.[i] ?? Math.max(3, Math.round(t.speed * unit));
    const speed = final / unit;
    return { index: i, stop, decel, decelStart: start, final, speed, endSpeed: speed * END_SPEED_RATIO, settle: t.settle };
  });
  return { short, ready: t.ready, reels };
}

/** 계획에 맞춰 릴 i의 띠에 필요한 칸 수(결과 칸 위·아래로 1칸씩 여유). */
export function cellsForReel(plan, i) { return plan.reels[i].final + 2; }

/**
 * 시각 t(초)의 릴 하나 상태. pos: 칸 위치(실수), velocity: 칸/초, phase: spin|decel|settle|stopped.
 * skipAt 이 있고 t ≥ skipAt 이면 즉시 멈춤 상태(튕김 없음).
 * @param {{ final: number, speed: number, endSpeed: number, stop: number, decel: number, decelStart: number, settle: number }} reel
 * @param {number} t
 * @param {number|null} [skipAt]
 * @param {{pos?: number, velocity?: number, phase?: string, stopped?: boolean}} [out] 매 프레임 할당을 줄이려면 같은 객체를 넘긴다.
 */
export function reelAt(reel, t, skipAt = null, out = {}) {
  const r = reelState(reel, t, skipAt);
  out.pos = r[0]; out.velocity = r[1]; out.phase = r[2]; out.stopped = r[2] === 'settle' || r[2] === 'stopped';
  return /** @type {{pos: number, velocity: number, phase: string, stopped: boolean}} */ (out);
}

/** @returns {[number, number, string]} [위치, 속도, 단계] */
function reelState(reel, t, skipAt) {
  if (skipAt !== null && t >= skipAt && skipAt < reel.stop + reel.settle) {
    // 건너뛴 순간 이미 멈춘 릴은 튕김을 이어 가지 않고 그대로 고정한다.
    return [reel.final, 0, 'stopped'];
  }
  if (t <= 0) return [0, reel.speed, 'spin'];
  if (t < reel.decelStart) return [reel.speed * t, reel.speed, 'spin'];
  if (t < reel.stop) {
    // 큐빅 에르미트: 시작 위치·속도(v), 끝 위치(final)·속도(endSpeed). 끝이 정수 칸이라 결과 칸에 정확히 선다.
    const d = reel.decel, u = (t - reel.decelStart) / d, p0 = reel.speed * reel.decelStart, p1 = reel.final;
    const m0 = reel.speed * d, m1 = reel.endSpeed * d, u2 = u * u, u3 = u2 * u;
    const pos = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
    const vel = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * m1) / d;
    return [pos, vel, 'decel'];
  }
  const tau = (t - reel.stop) / reel.settle;
  if (tau < 1) {
    const amp = REEL_OVERSHOOT / BUMP_PEAK;
    return [reel.final + amp * bump(tau), 0, 'settle'];
  }
  return [reel.final, 0, 'stopped'];
}

/**
 * 시각 t의 전체 상태. ready: 카드를 고를 수 있는지(2.40s 또는 건너뛰기 직후).
 * @param {ReturnType<typeof planReels>} plan
 * @param {number} t
 * @param {number|null} [skipAt]
 */
export function timelineAt(plan, t, skipAt = null) {
  const reels = plan.reels.map(r => reelAt(r, t, skipAt));
  const ready = t >= plan.ready || (skipAt !== null && t >= skipAt);
  return { reels, ready, stoppedCount: reels.filter(r => r.stopped).length };
}

/**
 * (t0, t1] 구간에 일어난 사건. 순서대로 돌려준다.
 * - {type:'stop', reel, at}: 릴 멈춤(쿵·진동·등급 점). 건너뛰기로 멈춘 릴은 skipAt 에 한꺼번에 나온다.
 * - {type:'ready', at}: 카드 선택 가능.
 * @param {ReturnType<typeof planReels>} plan
 * @param {number} t0
 * @param {number} t1
 * @param {number|null} [skipAt]
 */
export function eventsBetween(plan, t0, t1, skipAt = null) {
  /** @type {{type: 'stop'|'ready', reel?: number, at: number, skipped?: boolean}[]} */
  const out = [];
  const effStop = (/** @type {number} */ s) => (skipAt !== null && skipAt < s ? skipAt : s);
  for (const r of plan.reels) {
    const at = effStop(r.stop);
    if (at > t0 && at <= t1) out.push({ type: 'stop', reel: r.index, at, skipped: at !== r.stop });
  }
  const readyAt = skipAt !== null && skipAt < plan.ready ? skipAt : plan.ready;
  if (readyAt > t0 && readyAt <= t1) out.push({ type: 'ready', at: readyAt });
  return out.sort((a, b) => a.at - b.at || (a.type === 'ready' ? 1 : 0) - (b.type === 'ready' ? 1 : 0) || (a.reel ?? 0) - (b.reel ?? 0));
}

/** 멈춘 순서(릴 번호). 기본 0→1→2. */
export function stopOrder(plan) { return plan.reels.slice().sort((a, b) => a.stop - b.stop).map(r => r.index); }

/** 째깍 소리 상한: 마지막 째깍 뒤 TICK_MIN_INTERVAL 이 지나야 다시 낸다. */
export function shouldTick(now, last) { return !(now - last < TICK_MIN_INTERVAL - 1e-9); }

/** 등급 → 진동 패턴. III 멈춤은 [40,30,80], 그 밖의 멈춤은 25ms. */
export function stopVibration(grade) { return grade === 3 ? [40, 30, 80] : 25; }

/**
 * 띠 칸 → 화면 Y 이동(px). 띠는 DOM 위쪽부터 칸 번호가 큰 순서로 놓인다(위→아래 흐름).
 * 칸 번호 pos 가 창 가운데에 오도록 한다. cells: 띠 전체 칸 수, cell: 칸 높이, view: 창 높이.
 */
export function stripOffset(pos, cells, cell, view) {
  return view / 2 - (cells - 1 - pos + 0.5) * cell;
}

/**
 * 장식용 결정적 난수(mulberry32). 릴 문양 배치에만 쓴다. 전투 난수(전역 무작위 함수)를 소비하지 않아
 * 연출 설정(기본·짧게·움직임 줄이기)이 달라도 이후 전투 결과가 바뀌지 않는다.
 * @param {string} seed
 */
export function decorRng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 릴 한 줄의 장식 가문 목록(칸 번호 s 0..cells-1, 결과 칸 fin 은 null). 결과 칸 위·아래는 결과와 다른 가문으로 둔다.
 * @param {{ seed: string, cells: number, fin: number, resultFam: string, families: readonly string[] }} o
 * @returns {Array<string|null>}
 */
export function decorFamilies({ seed, cells, fin, resultFam, families }) {
  const rng = decorRng(seed), n = families.length, out = /** @type {Array<string|null>} */ (new Array(cells).fill(null));
  let prev = resultFam;
  for (let s = cells - 1; s >= 0; s--) {
    if (s === fin) { prev = resultFam; continue; }
    let f = families[Math.floor(rng() * n)];
    const near = s === fin + 1 || s === fin - 1;
    if (f === prev || (near && f === resultFam)) f = families[(families.indexOf(f) + 1 + (f === resultFam ? 1 : 0)) % n];
    if (f === resultFam && near) f = families[(families.indexOf(f) + 2) % n];
    out[s] = f; prev = f;
  }
  return out;
}
