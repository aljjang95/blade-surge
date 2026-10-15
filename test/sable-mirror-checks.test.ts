import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/sable-mirror-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEEP: any = (ROUTE_OBJECTIVES as any).sable_deep;
const STD: any = (ROUTE_OBJECTIVES as any).sable_standard;
const ESC: any = DEEP.escape;

// 계약 문장은 PLAN 3.1·3.2 에서 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const TXT = { title: '가짜 왕좌 파괴', mazeTitle: '거울 미궁 탈출', undiscovered: '다음 구역을 찾아 이동', fight: '이 구역의 적을 먼저 처치', still: '모래시계 멈춤 · 지금 왕좌 공격', spin: '모래시계 회전 · 멈출 때까지 대기',
  maze: (s: number) => '모래 발자국을 따라 진짜 거울로 · ' + s + '초' };
const STATE = { hidden: 0, real: 1, illusion: 2, shattered: 3 };
// 방 배치: 심층 지도 9방 중 왕좌 방 2(정예)·3·5(정예)·6, 거울 방 4 중심 (62, 0).
const ROOM = { x: 62, z: 0 };
const REAL = { x: ROOM.x + ESC.real[0], z: ROOM.z + ESC.real[1] };
const ILLU = { x: ROOM.x + ESC.illusion[0], z: ROOM.z + ESC.illusion[1] };
const DEEP_ROOMS = [{ id: 2, type: 'elite' }, { id: 3, type: 'normal' }, { id: 5, type: 'elite' }, { id: 6, type: 'normal' }];
const STD_ROOMS = [{ id: 2, type: 'elite' }, { id: 5, type: 'elite' }, { id: 6, type: 'normal' }];
const REINFORCEMENTS = 2;
const clone = <T,>(value: T): T => structuredClone(value);

/**
 * 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 건너뛴 스텝은 skip 으로 센다.
 * 왕좌 phase·age 는 시나리오가 직접 선언하고, 판정 함수가 그 선언을 관측 규칙(직전 스텝 끝 phase 등)과 맞춰 본다.
 */
class Sim {
  rows: any[] = []; n = 0; hero = { x: 20, z: 0 }; hp = 100; pr = 0; sl = 1; rem: number; au = 1; ah = 0; ps = 'move';
  g: any[]; mz: any = null; mv: any = null; tr: number[] | null = null; domNext: string | null = null; flow: any = null; speed = .12;
  constructor(public def: any, public rooms: any[], public reinforcements: number, public maze: boolean) {
    this.g = def.gates.map((gate: any) => ({ id: gate.roomId, rd: 0, bk: 0, ph: 0, pph: 0, ag: 0, pag: 0, hi: 0, dh: 0, cl: 0, fw: 0, dc: 0, al: 0, pd: 0 }));
    this.rem = def.gates.length + (maze ? 3 : 2);
    if (maze) {
      this.mz = { ph: 0, lim: 0, lf: 0, el: 0, col: 0, ill: 0, cd: 0, tn: 0 };
      this.mv = { s: [STATE.hidden, STATE.hidden], f: 0, c: 8 + ESC.trailCount, d: 0 };
    }
    this.snap({ mk: 'start' });
  }
  get cond() { return this.g.every(x => x.bk === 1) && this.rem === 0 ? 1 : 0; }
  snap(extra: any = {}) {
    const row: any = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: this.hp, mhp: 100, al: 1, rm: 0, pr: this.pr, sl: this.sl, rem: this.rem, cond: this.cond,
      au: this.au, ah: this.ah, ps: this.ps, g: this.g.map(x => ({ ...x })), mz: null, mv: null, ...extra };
    if (this.mz) {
      row.mz = { ...this.mz, dm: Math.hypot(this.hero.x - REAL.x, this.hero.z - REAL.z), di: Math.hypot(this.hero.x - ILLU.x, this.hero.z - ILLU.z) };
      if (this.flow) { row.mz.fd = this.flow.fd; row.mz.fa = this.flow.fa; this.flow = null; }
    }
    if (this.mv) row.mv = { ...this.mv, s: [...this.mv.s] };
    if (this.tr) { row.tr = this.tr; this.tr = null; }
    if (this.domNext) { row.dom = this.domNext; this.domNext = null; }
    this.rows.push(row); return row;
  }
  step(fn?: () => void, extra: any = {}) {
    this.n++;
    for (const g of this.g) { g.pph = g.ph; g.pag = g.ag; g.dh = 0; }
    // 미궁 시계는 규칙 갱신 앞에서 이미 running 인 스텝만 간다(시작 스텝은 limit = left, 경과 0).
    if (this.mz?.ph === 1) { this.mz.lf -= FRAME; this.mz.el += FRAME; this.mz.cd = Math.max(0, this.mz.cd - FRAME); }
    fn?.();
    return this.snap(extra);
  }
  skip(k: number) { this.n += k; for (const g of this.g) { g.pph = g.ph; g.pag = g.ag; g.dh = 0; } if (this.mz?.ph === 1) { this.mz.lf -= k * FRAME; this.mz.el += k * FRAME; } }
  mark(label: string) { return this.snap({ mk: label }); }
  /** 목표창 표본: 아직 부수지 않은 첫 왕좌의 상태(계약 문장). */
  sampleDom() {
    const cur = this.g.find(g => g.bk !== 1);
    if (this.mz?.ph === 1) { this.domNext = TXT.mazeTitle + ' ' + TXT.maze(Math.ceil(this.mz.lf)); return; }
    if (!cur) return;
    const action = cur.dc !== 1 ? TXT.undiscovered : cur.rd !== 1 ? TXT.fight : cur.ph === 1 ? TXT.still : TXT.spin;
    this.domNext = TXT.title + ' ' + this.pr + '/' + this.g.length + ' ' + action;
  }
  discover(i: number) { this.g[i].dc = 1; this.sampleDom(); this.skip(36); this.step(); }
  /** 적 처치. 정예방은 증원 waves 회를 모두 겪은 뒤. */
  fight(i: number, { waves = this.reinforcements }: any = {}) {
    const g = this.g[i];
    g.al = 5; this.sampleDom(); this.skip(36); this.step(); g.al = 0;
    if (this.rooms.find(r => r.id === g.id)?.type === 'elite') for (let w = 1; w <= waves; w++) { g.fw = w; this.step(); if (w < waves) { g.al = 4; this.skip(30); this.step(); g.al = 0; } }
  }
  readyUp(i: number, { dirty = false, early = false }: any = {}) {
    const g = this.g[i];
    g.rd = 1; g.ph = 0; g.ag = 0;
    if (dirty) g.al = 1;
    if (early) g.fw = 0;
    this.step();
  }
  /** 회전 2.4초가 지나 멈춤으로 넘어가고(첫 멈춤 스텝) 그 표본. */
  toStill(i: number) {
    const g = this.g[i];
    this.sampleDom(); this.skip(40); this.step();
    g.ph = 1; g.ag = 0; this.step();
    this.sampleDom(); this.skip(36); this.step();
  }
  hit(i: number) {
    const g = this.g[i];
    g.hi++; g.dh = 1;
    if (g.hi >= this.def.hits) {
      g.bk = 1; g.ph = 2; g.cl = 1; this.pr++; this.rem--;
      if (this.maze && this.cond && this.startLag === 0) this.startMaze();
    }
  }
  startLag = 0;
  /** 균열 hits 회, 12스텝(0.2초) 간격. 마지막 균열에서 부서진다. */
  cracks(i: number) {
    for (let k = 0; k < this.def.hits; k++) { this.skip(11); this.g[i].ag += 12 * FRAME; this.step(() => this.hit(i)); }
  }
  startMaze() {
    this.mz.ph = 1; this.mz.lim = this.mz.lf = 30; this.mz.el = 0; this.mz.tn = 10;
    this.flow = { fd: 96, fa: [95, 97, 96, 96] };
    this.mv.s = [STATE.real, STATE.illusion]; this.mv.d = 4; this.mv.f = 1;
    this.setTrail();
  }
  setTrail() {
    const pts: number[] = [];
    for (let k = 0; k < this.mz.tn; k++) pts.push(this.hero.x + (REAL.x - this.hero.x) * (k + 1) / this.mz.tn, this.hero.z + (REAL.z - this.hero.z) * (k + 1) / this.mz.tn);
    this.tr = pts;
  }
  /** 영웅을 목표로 한 스텝 걷는다. */
  walk(to: { x: number; z: number }) {
    const dx = to.x - this.hero.x, dz = to.z - this.hero.z, d = Math.hypot(dx, dz) || 1, m = Math.min(this.speed, d);
    this.hero = { x: this.hero.x + dx / d * m, z: this.hero.z + dz / d * m };
  }
  /** running 중 진짜 거울까지 걸어가 done. 36스텝마다 목표창 표본, 30스텝마다 발자국 갱신.
   * 실제 규칙처럼 반경 안에 들어간 그 스텝이 done 이다(반경 안 running 행이 없다). */
  runToReal({ stopShort = false }: any = {}) {
    let k = 0;
    while (Math.hypot(this.hero.x - REAL.x, this.hero.z - REAL.z) - this.speed > ESC.radius) {
      k++;
      this.step(() => { this.walk(REAL); if (k % 36 === 0) this.sampleDom(); if (k % 30 === 0) { this.setTrail(); this.mv.f = Math.min(10, this.mv.f + 3); } });
      if (stopShort && k > 40) return;
    }
    this.step(() => { this.walk(REAL); this.mz.ph = 2; this.sl = 0; this.mv.s = [STATE.shattered, STATE.shattered]; }, {});
  }
  /** done 뒤: 거울이 부서져 0.5초 뒤 사라진다. */
  afterDone(rows = 120) {
    for (let k = 1; k <= rows; k++) this.step(() => { if (k >= 31) this.mv.d = 0; });
  }
}

/** 심층 정상 AUTO 세션(왕좌 방 순서 [0,1,2,3] = 목록 순서): 발견 → 처치 → ready → 멈춤 → 균열 5회 → 파괴, 4/4 + 모든 구역 정화 뒤 미궁 → 진짜 거울 → 봉인 해제. */
function deepRun(over: any = {}) {
  const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
  s.startLag = over.startLag ?? 0;
  for (let i = 0; i < 4; i++) {
    s.discover(i);
    if (i === 2) s.rem -= 3;   // 나머지 구역(1·4·7) 정화
    s.fight(i, over['fight' + i]);
    s.readyUp(i, over['ready' + i]);
    s.toStill(i);
    s.cracks(i);
    if (over.afterBreak) over.afterBreak(s, i);
  }
  if (s.startLag > 0) { for (let k = 1; k < s.startLag; k++) s.step(); s.step(() => s.startMaze()); }
  s.runToReal(over.run);
  s.afterDone(over.afterRows ?? 120);
  s.mark('end');
  return s;
}
function standardRun() {
  const s = new Sim(STD, STD_ROOMS, 1, false);
  for (let i = 0; i < 3; i++) {
    s.discover(i);
    if (i === 1) s.rem -= 2;
    s.fight(i, { waves: 1 });
    s.readyUp(i);
    s.toStill(i);
    s.cracks(i);
  }
  s.skip(72); s.sl = 0; s.step();
  s.mark('end');
  return s;
}
const round2 = (v: number) => Math.round(v * 100) / 100;
const AB = (over: any = {}) => ([
  { label: 'start', n: 0, ph: 0, mzCalls: 0, rtCalls: 3, on: 20, offMaze: 20, offAll: 17 },
  { label: 'state', n: 500, ph: 1, mzCalls: 4, rtCalls: 3, on: 24, offMaze: 20, offAll: 17 },
  { label: 'interval', n: 590, ph: 1, mzCalls: 4, rtCalls: 3, on: 24, offMaze: 20, offAll: 17 },
  { label: 'state', n: 900, ph: 2, mzCalls: 4, rtCalls: 3, on: 24, offMaze: 20, offAll: 17 },
  { label: 'hidden-after', n: 940, ph: 2, mzCalls: 0, rtCalls: 3, on: 20, offMaze: 20, offAll: 17 },
]).map((x, i) => ({ ...x, ...(over[i] ?? {}) }));
function deepObs(s: Sim, over: any = {}) {
  const done = s.rows.find(r => r.mz?.ph === 2);
  const escape = { escaped: true, collapses: 0, illusions: 0, seconds: round2(done.mz.el), ...(over.escape ?? {}) };
  const result = { id: DEEP.id, label: '가짜 왕좌 파괴', complete: true, progress: 4, target: 4, rooms: [2, 3, 5, 6], sandReflects: 0, escape, ...(over.result ?? {}) };
  return { rows: s.rows, result, win: true, rooms: DEEP_ROOMS, viewAB: AB(), hasMaze: true, hasMazeView: true,
    resultText: over.resultText ?? '원정 승리\n가짜 왕좌 파괴 4/4 · 완료\n거울 미궁 탈출 완료 · 거울 붕괴 ' + escape.collapses + '회 · 환영 거울 ' + escape.illusions + '회\n보상',
    mazeSetup: { roomOk: true, realOk: true, illusionOk: true, real: REAL }, ...(over.obs ?? {}) };
}
function stdObs(s: Sim, over: any = {}) {
  const result = { id: STD.id, label: '가짜 왕좌 파괴', complete: true, progress: 3, target: 3, rooms: [2, 5, 6], sandReflects: 0, ...(over.result ?? {}) };
  return { rows: s.rows, result, win: true, rooms: STD_ROOMS, viewAB: [], hasMaze: false, hasMazeView: false, resultText: over.resultText ?? '원정 승리\n가짜 왕좌 파괴 3/3 · 완료\n보상', ...(over.obs ?? {}) };
}
/** 행 복사본에서 조건에 맞는 행을 고친다. */
function tweak(rows: any[], pred: (r: any, i: number) => boolean, fn: (r: any) => void) {
  const copy = clone(rows);
  let hit = 0;
  copy.forEach((r, i) => { if (pred(r, i)) { fn(r); hit++; } });
  expect(hit).toBeGreaterThan(0);
  return copy;
}

describe('계약 상수', () => {
  test('제한 시간 식은 방 7 시작 30초 · 방 6 시작 22초(PLAN 3절)와 같다', () => {
    expect(K.limitOf(ESC, 96)).toBe(30);
    expect(K.limitOf(ESC, 64)).toBe(22);
    expect(K.limitOf(ESC, 0)).toBe(ESC.grace);
    expect(K.limitOf(ESC, 1)).toBe(ESC.grace + 1);
  });
  test('거울 상태는 maze.phase 로 정한다(idle → hidden, running → real/illusion, done → shattered)', () => {
    expect(K.expectedMirrorStates(0)).toEqual(['hidden', 'hidden']);
    expect(K.expectedMirrorStates(1)).toEqual(['real', 'illusion']);
    expect(K.expectedMirrorStates(2)).toEqual(['shattered', 'shattered']);
  });
  test('결과 줄 문구', () => {
    expect(K.throneResultLine(DEEP)).toBe('가짜 왕좌 파괴 4/4 · 완료');
    expect(K.throneResultLine(STD)).toBe('가짜 왕좌 파괴 3/3 · 완료');
    expect(K.mazeResultLine({ escaped: true, collapses: 2, illusions: 1 })).toBe('거울 미궁 탈출 완료 · 거울 붕괴 2회 · 환영 거울 1회');
    expect(K.mirrorViewCount(DEEP)).toBe(8 + ESC.trailCount);
  });
});

describe('왕좌 파괴 집합', () => {
  test('정상 세션: 방 {2,3,5,6} 이 각각 한 번씩 부서진다', () => {
    const r = K.checkThroneSet(deepRun().rows, DEEP);
    expect(r.ok).toBe(true);
    expect(r.observed).toEqual([2, 3, 5, 6]);
  });
  test('순서는 자유다: 3·1·4·2번 순으로 부숴도 합격', () => {
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, false);
    s.rem = 0;
    for (const i of [2, 0, 3, 1]) { s.g[i].rd = 1; s.g[i].ph = 1; s.cracks(i); }
    expect(K.checkThroneSet(s.rows, DEEP).ok).toBe(true);
    expect(K.checkThroneSet(s.rows, DEEP).observed).toEqual([5, 2, 6, 3]);
  });
  test('한 곳을 부수지 않았으면 실패', () => {
    const rows = tweak(deepRun().rows, r => r.g[3].bk === 1, r => { r.g[3].bk = 0; });
    expect(K.checkThroneSet(rows, DEEP).ok).toBe(false);
  });
  test('정의와 다른 방이 부서지면 실패', () => {
    const rows = tweak(deepRun().rows, () => true, r => { r.g[3].id = 7; });
    expect(K.checkThroneSet(rows, DEEP).ok).toBe(false);
  });
  test('부서진 왕좌가 되살아나면 실패', () => {
    const rows = deepRun().rows;
    const idx = rows.findIndex(r => r.g[0].bk === 1) + 5;
    const bad = tweak(rows, (_, i) => i === idx, r => { r.g[0].bk = 0; });
    expect(K.checkThroneSet(bad, DEEP).ok).toBe(false);
  });
});

describe('균열 phase', () => {
  test('정상 세션: 균열은 모두 직전 스텝 끝이 still 이고 왕좌마다 정확히 hits 회', () => {
    const r = K.checkCracks(deepRun().rows, DEEP);
    expect(r.ok).toBe(true);
    expect(r.perGate).toEqual([5, 5, 5, 5]);
    expect(r.violations).toEqual([]);
  });
  test('회전 중(직전도 이 스텝도 spin)에 균열이 늘면 실패', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[1].dh > 0);
    const bad = tweak(rows, (_, i) => i === first, r => { r.g[1].pph = 0; r.g[1].ph = 0; r.g[1].pag = 1; });
    const r = K.checkCracks(bad, DEEP);
    expect(r.ok).toBe(false);
    expect(r.violations[0].kind).toBe('spinning');
  });
  test('회전→멈춤 전이 스텝(직전 spin, age 가 spinSeconds 에 닿음)의 균열은 정상 경로로 인정하고 따로 센다', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[1].dh > 0);
    const ok = tweak(rows, (_, i) => i === first, r => { r.g[1].pph = 0; r.g[1].pag = DEEP.spinSeconds - FRAME / 2; r.g[1].ph = 1; });
    const r = K.checkCracks(ok, DEEP);
    expect(r.ok).toBe(true);
    expect(r.transitions).toBe(1);
    // 전이 시각이 아직 멀면(age 1.0) 같은 모양이라도 위반이다.
    const far = tweak(rows, (_, i) => i === first, r => { r.g[1].pph = 0; r.g[1].pag = 1; r.g[1].ph = 1; });
    expect(K.checkCracks(far, DEEP).ok).toBe(false);
  });
  test('마지막 균열(파괴 스텝, ph broken)도 직전 스텝 끝이 spin 이면 실패', () => {
    const rows = deepRun().rows;
    const idx = rows.findIndex(r => r.g[0].bk === 1);
    const bad = tweak(rows, (_, i) => i === idx, r => { r.g[0].pph = 0; r.g[0].pag = 0.5; });
    expect(K.checkCracks(bad, DEEP).ok).toBe(false);
  });
  test('준비되지 않은 왕좌에 균열이 늘면 실패', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[2].dh > 0);
    const bad = tweak(rows, (_, i) => i === first, r => { r.g[2].rd = 0; });
    expect(K.checkCracks(bad, DEEP).violations.some((v: any) => v.kind === 'not-ready')).toBe(true);
  });
  test('한 스텝에 균열이 둘 늘거나 간격이 hitGap 보다 짧으면 실패', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[0].dh > 0);
    expect(K.checkCracks(tweak(rows, (_, i) => i === first, r => { r.g[0].dh = 2; }), DEEP).violations.some((v: any) => v.kind === 'multi-hit')).toBe(true);
    const idxs = rows.map((r, i) => (r.g[0].dh > 0 ? i : -1)).filter(i => i >= 0);
    const fast = tweak(rows, (_, i) => i === idxs[1], r => { r.t = rows[idxs[0]].t + 0.05; });
    expect(K.checkCracks(fast, DEEP).violations.some((v: any) => v.kind === 'gap')).toBe(true);
  });
  test('균열이 hits 회에 못 미치거나 아예 없으면 실패', () => {
    const rows = deepRun().rows;
    const idxs = rows.map((r, i) => (r.g[0].dh > 0 ? i : -1)).filter(i => i >= 0);
    expect(K.checkCracks(tweak(rows, (_, i) => i === idxs[1], r => { r.g[0].dh = 0; }), DEEP).ok).toBe(false);
    expect(K.checkCracks(tweak(rows, () => true, r => r.g.forEach((g: any) => { g.dh = 0; })), DEEP).ok).toBe(false);
  });
});

describe('ready 시점', () => {
  test('정상 세션: 정예방은 증원 2회 뒤, 적·대기열 0', () => {
    const r = K.checkReady(deepRun().rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS });
    expect(r.ok).toBe(true);
    expect(r.eliteRooms).toEqual([2, 5]);
  });
  test('증원 1회에서 ready 가 되면 실패(정예방)', () => {
    const rows = deepRun().rows;
    const bad = tweak(rows, r => r.g[0].rd === 1 && r.g[0].fw === 2, r => { r.g[0].fw = 1; });
    expect(K.checkReady(bad, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
  });
  test('ready 인데 그 방에 적이나 대기열이 남아 있으면 실패', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[1].rd === 1);
    expect(K.checkReady(tweak(rows, (_, i) => i === first, r => { r.g[1].al = 2; }), DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
    expect(K.checkReady(tweak(rows, (_, i) => i === first, r => { r.g[1].pd = 1; }), DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
  });
  test('균열 스텝에 적이 있으면 실패, 왕좌가 한 번도 ready 가 아니면 실패', () => {
    const rows = deepRun().rows;
    const first = rows.findIndex(r => r.g[3].dh > 0);
    expect(K.checkReady(tweak(rows, (_, i) => i === first, r => { r.g[3].al = 1; }), DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
    expect(K.checkReady(tweak(rows, () => true, r => { r.g[3].rd = 0; }), DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
  });
});

describe('보스 봉인', () => {
  test('심층 정상 세션: done 스텝에 해제', () => {
    const r = K.checkSeal(deepRun().rows, DEEP, { maze: true });
    expect(r.ok).toBe(true);
  });
  test('done 보다 먼저 해제되면 실패', () => {
    const rows = deepRun().rows;
    const run = rows.findIndex(r => r.mz?.ph === 1) + 20;
    const bad = tweak(rows, (_, i) => i >= run, r => { r.sl = 0; });
    expect(K.checkSeal(bad, DEEP, { maze: true }).ok).toBe(false);
  });
  test('4/4 전에 해제되면 실패, 한 번도 해제되지 않아도 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkSeal(tweak(rows, r => r.pr === 3, r => { r.sl = 0; }), DEEP, { maze: true }).ok).toBe(false);
    expect(K.checkSeal(tweak(rows, () => true, r => { r.sl = 1; }), DEEP, { maze: true }).ok).toBe(false);
  });
  test('미정화 방이 남아 있는데 해제되면 실패', () => {
    const rows = tweak(deepRun().rows, r => r.sl === 0, r => { r.rem = 1; });
    expect(K.checkSeal(rows, DEEP, { maze: true }).ok).toBe(false);
  });
  test('일반(미궁 없음): 마지막 파괴 뒤 해제는 합격, 파괴 직전 해제는 실패', () => {
    const s = standardRun();
    expect(K.checkSeal(s.rows, STD, { maze: false }).ok).toBe(true);
    expect(K.checkSeal(tweak(s.rows, r => r.pr === 2, r => { r.sl = 0; }), STD, { maze: false }).ok).toBe(false);
  });
});

describe('미궁 시작·제한 시간·시계', () => {
  test('정상 세션: 조건 성립 같은 스텝(지연 0)과 한 스텝 뒤(지연 1) 시작은 합격, 두 스텝 뒤는 실패', () => {
    expect(K.checkMazeStart(deepRun().rows, DEEP).ok).toBe(true);
    const lag1 = K.checkMazeStart(deepRun({ startLag: 1 }).rows, DEEP);
    expect(lag1.ok).toBe(true);
    expect(lag1.lag).toBe(1);
    const lag2 = K.checkMazeStart(deepRun({ startLag: 2 }).rows, DEEP);
    expect(lag2.ok).toBe(false);
    expect(lag2.lag).toBe(2);
  });
  test('조건이 성립하기 전에 running 이면 실패(남은 구역이 있는데 시작)', () => {
    const rows = deepRun().rows;
    const start = rows.findIndex(r => r.mz?.ph === 1);
    const bad = tweak(rows, (_, i) => i === start, r => { r.rem = 2; r.cond = 0; });
    expect(K.checkMazeStart(bad, DEEP).ok).toBe(false);
  });
  test('시작 스텝에 진행 수가 모자라거나 시작 전 표본에 running 이 섞이면 실패', () => {
    const rows = deepRun().rows;
    const start = rows.findIndex(r => r.mz?.ph === 1);
    expect(K.checkMazeStart(tweak(rows, (_, i) => i === start, r => { r.pr = 3; }), DEEP).ok).toBe(false);
    expect(K.checkMazeStart(tweak(rows, (_, i) => i === start - 10, r => { r.mz.ph = 1; }), DEEP).ok).toBe(false);
  });
  test('시작 스텝의 횟수·경과·left 가 어긋나면 실패', () => {
    const rows = deepRun().rows;
    const start = rows.findIndex(r => r.mz?.ph === 1);
    expect(K.checkMazeStart(tweak(rows, (_, i) => i === start, r => { r.mz.ill = 1; }), DEEP).ok).toBe(false);
    expect(K.checkMazeStart(tweak(rows, (_, i) => i === start, r => { r.mz.lf = 25; }), DEEP).ok).toBe(false);
  });
  test('limit = ceil(거리/pace + grace): 다시 잰 거리(96) → 30 이면 합격, 29 나 pace 를 잘못 쓴 값은 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeLimit(rows, DEEP).ok).toBe(true);
    const start = rows.findIndex(r => r.mz?.ph === 1);
    expect(K.checkMazeLimit(tweak(rows, (_, i) => i === start, r => { r.mz.lim = 29; r.mz.lf = 29; }), DEEP).ok).toBe(false);
    expect(K.checkMazeLimit(tweak(rows, (_, i) => i === start, r => { r.mz.lim = 25; r.mz.lf = 25; }), DEEP).ok).toBe(false);
  });
  test('제한 시간은 다시 잰 영웅 칸 거리(fd)로만 판정한다: 인접 위치 거리 후보(97 → 31)나 floor 값은 실패', () => {
    const rows = deepRun().rows;
    const start = rows.findIndex(r => r.mz?.ph === 1);
    const alt = tweak(rows, (_, i) => i === start, r => { r.mz.lim = 31; r.mz.lf = 31; });
    expect(K.checkMazeLimit(alt, DEEP).ok).toBe(false);
  });
  test('시작 스텝에 거리를 다시 재지 못했으면 실패', () => {
    const rows = tweak(deepRun().rows, r => r.mz?.fd !== undefined, r => { delete r.mz.fd; delete r.mz.fa; });
    expect(K.checkMazeLimit(rows, DEEP).ok).toBe(false);
  });
  test('붕괴 스텝은 left 가 새 limit 으로 돌아와야 한다', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 1) + 100;
    const base = tweak(rows, (_, k) => k === i, r => { r.mz.col = 1; r.mz.lim = 8; r.mz.lf = 8; r.mz.fd = 8; r.mz.fa = [7, 9, 8, 8]; });
    expect(K.checkMazeLimit(base, DEEP).ok).toBe(true);
    const stale = tweak(rows, (_, k) => k === i, r => { r.mz.col = 1; r.mz.lim = 8; r.mz.lf = 0; r.mz.fd = 8; r.mz.fa = [7, 9, 8, 8]; });
    expect(K.checkMazeLimit(stale, DEEP).ok).toBe(false);
  });
  test('시계: running 연속 스텝에서 left 는 게임 시간만큼 줄고 elapsed 는 늘어난다', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeClock(rows).ok).toBe(true);
    const i = rows.findIndex(r => r.mz?.ph === 1) + 60;
    expect(K.checkMazeClock(tweak(rows, (_, k) => k === i, r => { r.mz.lf += 0.01; })).ok).toBe(false);
    expect(K.checkMazeClock(tweak(rows, (_, k) => k === i, r => { r.mz.el += 0.01; })).ok).toBe(false);
  });
  test('스텝 안에서 일시정지가 시작된 행(pz)만 시계가 그대로여도 면제하고, 값이 조금이라도 바뀌거나 pz 가 없으면 실패', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 1) + 60, prev = rows[i - 1];
    const frozen = (r: any) => { r.mz.lf = prev.mz.lf; r.mz.el = prev.mz.el; };
    const shifted = (r: any) => { r.mz.lf = r.mz.lf - 1e-9; };
    // 면제 뒤에도 다음 쌍의 차이가 그대로 맞도록 이후 행 전체를 한 스텝만큼 되돌린다.
    const later = (r: any) => { r.mz.lf += rows[i].t - prev.t; r.mz.el -= rows[i].t - prev.t; };
    const exempt = tweak(tweak(rows, (_, k) => k > i, later), (_, k) => k === i, (r: any) => { frozen(r); r.pz = 1; });
    const res = K.checkMazeClock(exempt);
    expect(res.ok).toBe(true); expect(res.pauseEntry.length).toBe(1);
    expect(K.checkMazeClock(tweak(tweak(rows, (_, k) => k > i, later), (_, k) => k === i, frozen)).ok).toBe(false);
    expect(K.checkMazeClock(tweak(exempt, (_, k) => k === i, shifted)).ok).toBe(false);
  });
  test('확인한 쌍이 모자라면(running 이 짧거나 없음) 실패', () => {
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
    expect(K.checkMazeClock(s.rows).ok).toBe(false);
  });
});

describe('진짜 거울 도달', () => {
  test('정상 세션: done 은 반경 안에서만', () => {
    const r = K.checkMazeDone(deepRun().rows, DEEP);
    expect(r.ok).toBe(true);
    expect(r.distance).toBeLessThanOrEqual(ESC.radius + K.POSITION_SLACK);
  });
  test('done 스텝 거리가 반경 밖(3)이면 실패', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = 3; }), DEEP).ok).toBe(false);
  });
  test('경계: 반경 + .01 이내는 합격, 그 밖은 실패', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = ESC.radius + .009; }), DEEP).ok).toBe(true);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = ESC.radius + .02; }), DEEP).ok).toBe(false);
  });
  test('running 인데 영웅이 반경 안 깊숙이(0.5) 있으면 도달 판정이 빠진 것이라 실패', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2) - 3;
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = 0.5; }), DEEP).ok).toBe(false);
  });
  test('위치 여유는 규칙 반경 그대로: running 행이 반경 − .02 안이면 실패, 미궁이 열린 스텝의 행만 면제', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2) - 3, open = rows.findIndex(r => r.mz?.ph === 1);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = ESC.radius - .02; }), DEEP).ok).toBe(false);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.dm = ESC.radius + .001; }), DEEP).ok).toBe(true);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === open, r => { r.mz.dm = 0.5; }), DEEP).ok).toBe(true);
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === open + 1, r => { r.mz.dm = 0.5; }), DEEP).ok).toBe(false);
  });
  test('done 뒤 다시 running 이 되거나 done 이 없으면 실패', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2) + 10;
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.ph = 1; }), DEEP).ok).toBe(false);
    expect(K.checkMazeDone(tweak(rows, r => r.mz?.ph === 2, r => { r.mz.ph = 1; }), DEEP).ok).toBe(false);
  });
  test('done 직전 행이 running 이 아니면 실패(idle 에서 바로 done)', () => {
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2) - 1;
    expect(K.checkMazeDone(tweak(rows, (_, k) => k === i, r => { r.mz.ph = 0; }), DEEP).ok).toBe(false);
  });
});

describe('AUTO 횟수와 발자국', () => {
  test('AUTO 는 환영 접촉 0 · 붕괴 0', () => {
    expect(K.checkAutoCounts(deepRun().rows).ok).toBe(true);
    const rows = deepRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2);
    expect(K.checkAutoCounts(tweak(rows, (_, k) => k >= i - 20, r => { r.mz.ill = 1; })).ok).toBe(false);
    expect(K.checkAutoCounts(tweak(rows, (_, k) => k >= i - 20, r => { r.mz.col = 1; })).ok).toBe(false);
    expect(K.checkAutoCounts(new Sim(DEEP, DEEP_ROOMS, 2, true).rows).ok).toBe(false);
  });
  test('발자국: 정상 세션 합격', () => {
    expect(K.checkTrail(deepRun().rows, DEEP, { real: REAL }).ok).toBe(true);
  });
  test('발자국 방향이 거꾸로(첫 점이 거울에 더 가까움)이면 실패', () => {
    const rows = tweak(deepRun().rows, r => Array.isArray(r.tr), r => {
      const flat: number[] = [];
      for (let k = r.tr.length / 2 - 1; k >= 0; k--) flat.push(r.tr[2 * k], r.tr[2 * k + 1]);
      r.tr = flat;
    });
    expect(K.checkTrail(rows, DEEP, { real: REAL }).ok).toBe(false);
  });
  test('점 수가 trailN 과 다르거나 trailCount 를 넘거나 유한하지 않으면 실패', () => {
    const base = deepRun().rows;
    expect(K.checkTrail(tweak(base, r => Array.isArray(r.tr), r => { r.mz.tn = 7; }), DEEP, { real: REAL }).ok).toBe(false);
    expect(K.checkTrail(tweak(base, r => Array.isArray(r.tr), r => { r.tr = [...r.tr, 1, 1]; r.mz.tn = 11; }), DEEP, { real: REAL }).ok).toBe(false);
    expect(K.checkTrail(tweak(base, r => Array.isArray(r.tr), r => { r.tr[0] = Number.NaN; }), DEEP, { real: REAL }).ok).toBe(false);
  });
  test('발자국 갱신이 없거나 running 중 trailN 이 0 이면 실패', () => {
    const base = deepRun().rows;
    expect(K.checkTrail(tweak(base, r => Array.isArray(r.tr), r => { delete r.tr; }), DEEP, { real: REAL }).ok).toBe(false);
    expect(K.checkTrail(tweak(base, r => r.mz?.ph === 1, r => { r.mz.tn = 0; delete r.tr; }), DEEP, { real: REAL }).ok).toBe(false);
  });
});

describe('거울 뷰', () => {
  test('정상 세션: states 가 매 스텝 maze.phase 와 맞고 drawCalls ≤ 4, footprints ≥ 1, 부서진 뒤 숨김', () => {
    const r = K.checkMazeView(deepRun().rows, DEEP);
    expect(r.ok).toEqual({ states: true, footprints: true, draw: true, hide: true });
    expect(r.counts).toEqual([8 + ESC.trailCount]);
  });
  test('running 인데 거울 상태가 hidden 이면 실패(미궁 시작 스텝에 거울이 같은 프레임에 보여야 한다)', () => {
    const rows = deepRun().rows;
    const start = rows.findIndex(r => r.mz?.ph === 1);
    const bad = tweak(rows, (_, i) => i === start, r => { r.mv.s = [STATE.hidden, STATE.hidden]; r.mv.d = 0; });
    expect(K.checkMazeView(bad, DEEP).ok.states).toBe(false);
  });
  test('진짜/환영이 뒤바뀌거나 idle 에 보이면 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeView(tweak(rows, r => r.mz?.ph === 1, r => { r.mv.s = [STATE.illusion, STATE.real]; }), DEEP).ok.states).toBe(false);
    expect(K.checkMazeView(tweak(rows, (_, i) => i === 3, r => { r.mv.s = [STATE.real, STATE.illusion]; }), DEEP).ok.states).toBe(false);
  });
  test('done 인데 shattered 가 아니면 실패', () => {
    const rows = tweak(deepRun().rows, r => r.mz?.ph === 2, r => { r.mv.s = [STATE.real, STATE.illusion]; });
    expect(K.checkMazeView(rows, DEEP).ok.states).toBe(false);
  });
  test('drawCalls 가 5 이상이거나 hidden 인데 0 이 아니면 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeView(tweak(rows, r => r.mz?.ph === 1, r => { r.mv.d = 5; }), DEEP).ok.draw).toBe(false);
    expect(K.checkMazeView(tweak(rows, (_, i) => i === 2, r => { r.mv.d = 1; }), DEEP).ok.draw).toBe(false);
  });
  test('footprints 가 running 내내 0 이거나 trailCount 를 넘으면 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeView(tweak(rows, r => r.mz?.ph === 1, r => { r.mv.f = 0; }), DEEP).ok.footprints).toBe(false);
    expect(K.checkMazeView(tweak(rows, r => r.mz?.ph === 1, r => { r.mv.f = ESC.trailCount + 1; }), DEEP).ok.footprints).toBe(false);
  });
  test('부서진 지 0.5초가 지나도 그려지면 실패, 그 뒤 행이 없으면 확인 불가로 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkMazeView(tweak(rows, r => r.mz?.ph === 2, r => { r.mv.d = 4; }), DEEP).ok.hide).toBe(false);
    expect(K.checkMazeView(deepRun({ afterRows: 10 }).rows, DEEP).ok.hide).toBe(false);
  });
  test('mazeView 가 없는 행이 섞이면 실패', () => {
    const rows = tweak(deepRun().rows, (_, i) => i === 30, r => { r.mv = null; });
    expect(K.checkMazeView(rows, DEEP).ok.states).toBe(false);
  });
});

describe('거울 뷰 같은 프레임 A/B', () => {
  test('정상: 표본 5개, hidden·running·shattered 포함, 차이 ≤ 4 이고 mazeView.drawCalls 와 같음', () => {
    const r = K.checkMazeViewGpu(AB(), DEEP);
    expect(r.ok).toBe(true);
    expect(r.max).toBe(4);
    expect(r.coverage).toEqual({ hidden: true, running: true, shattered: true });
    expect(r.route.mismatches).toBe(0);
  });
  test('첫 update 전 start 표본(scale 0 메시가 보여 4 calls)은 일치 검사만 받고 hidden 표본으로 세지 않는다', () => {
    const onlyStart = AB({ 0: { mzCalls: 4, on: 24 } }).filter(x => x.label !== 'hidden-after');
    const r = K.checkMazeViewGpu(onlyStart, DEEP);
    expect(r.coverage.hidden).toBe(false); expect(r.ok).toBe(false);
    const withGate = [...onlyStart, { label: 'gate', n: 100, ph: 0, mzCalls: 0, rtCalls: 3, on: 20, offMaze: 20, offAll: 17 }];
    expect(K.checkMazeViewGpu(withGate, DEEP).coverage.hidden).toBe(true);
  });
  test('차이가 5 이상이면 실패', () => {
    expect(K.checkMazeViewGpu(AB({ 1: { on: 25, mzCalls: 5 } }), DEEP).ok).toBe(false);
  });
  test('실제 차이와 mazeView.drawCalls 가 다르면 실패', () => {
    expect(K.checkMazeViewGpu(AB({ 1: { mzCalls: 3 } }), DEEP).ok).toBe(false);
    expect(K.checkMazeViewGpu(AB({ 3: { mzCalls: 2 } }), DEEP).ok).toBe(false);
  });
  test('running 인데 실제로 그려지지 않으면(차이 0 = 주장 0) 실패', () => {
    expect(K.checkMazeViewGpu(AB({ 1: { on: 20, mzCalls: 0 }, 2: { on: 20, mzCalls: 0 } }), DEEP).ok).toBe(false);
  });
  test('표본이 3개 미만이거나 hidden · running · shattered 중 하나가 빠지면 실패', () => {
    expect(K.checkMazeViewGpu(AB().slice(0, 2), DEEP).ok).toBe(false);
    expect(K.checkMazeViewGpu(AB().filter(x => x.ph !== 0), DEEP).ok).toBe(false);
    expect(K.checkMazeViewGpu(AB().filter(x => x.ph !== 1), DEEP).ok).toBe(false);
    expect(K.checkMazeViewGpu(AB().filter(x => x.ph !== 2), DEEP).ok).toBe(false);
    expect(K.checkMazeViewGpu([], DEEP).reason).toBe('no-samples');
  });
  test('측정값이 비어 있으면(그룹 없음) 실패', () => {
    expect(K.checkMazeViewGpu(AB({ 1: { on: null, offMaze: null } }), DEEP).ok).toBe(false);
  });
  test('왕좌 뷰까지 끈 전체 차이가 주장 합계와 다르면 보고 항목에 불일치로만 남는다(게이트 아님)', () => {
    const r = K.checkMazeViewGpu(AB({ 1: { offAll: 19 } }), DEEP);
    expect(r.ok).toBe(true);
    expect(r.route.mismatches).toBe(1);
  });
});

describe('결과·목표창', () => {
  const obs = () => deepObs(deepRun());
  test('결과 객체: 정상 합격', () => {
    const o = obs();
    expect(K.checkResultFields(o.result, DEEP, true, { clean: true, mazeSeconds: o.result.escape.seconds }).ok).toBe(true);
  });
  test('결과 객체: 진행·완료·방 집합·id·label 이 어긋나면 실패', () => {
    const o = obs();
    for (const patch of [{ progress: 3 }, { complete: false }, { target: 3 }, { rooms: [2, 3, 5] }, { id: 'sable_false_thrones' }, { label: '냉각선 복구' }]) {
      expect(K.checkResultFields({ ...o.result, ...patch }, DEEP, true).ok).toBe(false);
    }
    expect(K.checkResultFields(o.result, DEEP, false).ok).toBe(false);
    expect(K.checkResultFields(null, DEEP, true).ok).toBe(false);
  });
  test('결과 escape: escaped false · 횟수 비정수 · AUTO 인데 횟수 > 0 · seconds 불일치이면 실패', () => {
    const o = obs();
    expect(K.checkResultFields({ ...o.result, escape: { ...o.result.escape, escaped: false } }, DEEP, true).ok).toBe(false);
    expect(K.checkResultFields({ ...o.result, escape: { ...o.result.escape, collapses: 1.5 } }, DEEP, true).ok).toBe(false);
    expect(K.checkResultFields({ ...o.result, escape: { ...o.result.escape, illusions: 1 } }, DEEP, true, { clean: true }).ok).toBe(false);
    expect(K.checkResultFields({ ...o.result, escape: { ...o.result.escape, illusions: 1 } }, DEEP, true, { clean: false }).ok).toBe(true);
    expect(K.checkResultFields(o.result, DEEP, true, { mazeSeconds: o.result.escape.seconds + 0.5 }).ok).toBe(false);
    const { escape, ...noEscape } = o.result;
    expect(K.checkResultFields(noEscape, DEEP, true).ok).toBe(false);
  });
  test('일반 결과에는 escape 가 없어야 한다', () => {
    const o = stdObs(standardRun());
    expect(K.checkResultFields(o.result, STD, true).ok).toBe(true);
    expect(K.checkResultFields({ ...o.result, escape: { escaped: true, collapses: 0, illusions: 0, seconds: 1 } }, STD, true).ok).toBe(false);
  });
  test('결과 줄: 왕좌 줄과 미궁 줄(횟수 포함)이 모두 있어야 한다', () => {
    const o = obs();
    expect(K.checkResultLines(o.resultText, DEEP, o.result).ok).toBe(true);
    expect(K.checkResultLines('가짜 왕좌 파괴 4/4 · 완료', DEEP, o.result).ok).toBe(false);
    expect(K.checkResultLines('거울 미궁 탈출 완료 · 거울 붕괴 0회 · 환영 거울 0회', DEEP, o.result).ok).toBe(false);
    expect(K.checkResultLines(o.resultText.replace('붕괴 0회', '붕괴 2회'), DEEP, o.result).ok).toBe(false);
    expect(K.checkResultLines(o.resultText.replace('완료 ·', '미완료 ·'), DEEP, o.result).ok).toBe(false);
  });
  test('일반 결과 줄에는 거울 미궁이 없다', () => {
    const o = stdObs(standardRun());
    expect(K.checkResultLines(o.resultText, STD, o.result).ok).toBe(true);
    expect(K.checkResultLines(o.resultText + '\n거울 미궁 탈출 완료', STD, o.result).ok).toBe(false);
    expect(K.checkResultLines('가짜 왕좌 파괴 4/4 · 완료', STD, o.result).ok).toBe(false);
  });
  test('목표창: 정상 세션은 왕좌 표본과 미궁 표본이 모두 있고 문구가 맞는다', () => {
    const r = K.checkObjectiveSamples(deepRun().rows, DEEP);
    expect(r.ok).toBe(true);
    expect(r.throne).toBeGreaterThan(0);
    expect(r.maze).toBeGreaterThan(0);
  });
  test('목표창: 상태와 다른 문구(멈춤인데 회전 문구)나 미궁 초 표시가 어긋나면 실패', () => {
    const rows = deepRun().rows;
    const still = rows.findIndex(r => typeof r.dom === 'string' && r.dom.includes(TXT.still));
    expect(K.checkObjectiveSamples(tweak(rows, (_, i) => i === still, r => { r.dom = r.dom.replace(TXT.still, TXT.spin); }), DEEP).ok).toBe(false);
    const maze = rows.findIndex(r => typeof r.dom === 'string' && r.dom.includes(TXT.mazeTitle));
    expect(K.checkObjectiveSamples(tweak(rows, (_, i) => i === maze, r => { r.dom = TXT.mazeTitle + ' ' + TXT.maze(99); }), DEEP).ok).toBe(false);
  });
  test('목표창: 미궁 표본의 초는 ceil(left) 또는 +1(10Hz 갱신 지연)만 허용', () => {
    const rows = deepRun().rows;
    const maze = rows.findIndex(r => typeof r.dom === 'string' && r.dom.includes(TXT.mazeTitle));
    const c = Math.ceil(rows[maze].mz.lf);
    expect(K.checkObjectiveSamples(tweak(rows, (_, i) => i === maze, r => { r.dom = TXT.mazeTitle + ' ' + TXT.maze(c + 1); }), DEEP).ok).toBe(true);
    expect(K.checkObjectiveSamples(tweak(rows, (_, i) => i === maze, r => { r.dom = TXT.mazeTitle + ' ' + TXT.maze(c + 2); }), DEEP).ok).toBe(false);
  });
  test('목표창: 미궁 단계 표본이 없으면(심층) 실패, 제목이 틀려도 실패', () => {
    const rows = deepRun().rows;
    expect(K.checkObjectiveSamples(tweak(rows, r => typeof r.dom === 'string' && r.dom.includes(TXT.mazeTitle), r => { delete r.dom; }), DEEP).ok).toBe(false);
    const first = rows.findIndex(r => typeof r.dom === 'string' && r.mz?.ph === 0);
    expect(K.checkObjectiveSamples(tweak(rows, (_, i) => i === first, r => { r.dom = '냉각선 복구 ' + TXT.spin; }), DEEP).ok).toBe(false);
  });
  test('일반 목표창: 거울 미궁 문구가 섞이면 실패, 왕좌 표본이 없으면 실패', () => {
    const rows = standardRun().rows;
    expect(K.checkObjectiveSamples(rows, STD).ok).toBe(true);
    const i = rows.findIndex(r => typeof r.dom === 'string');
    expect(K.checkObjectiveSamples(tweak(rows, (_, k) => k === i, r => { r.dom = r.dom + ' 거울 미궁 탈출'; }), STD).ok).toBe(false);
    expect(K.checkObjectiveSamples(tweak(rows, r => typeof r.dom === 'string', r => { delete r.dom; }), STD).ok).toBe(false);
  });
});

describe('종합 판정 analyzeThrones', () => {
  const run = (s: Sim, over: any = {}, opts: any = {}) => K.analyzeThrones(deepObs(s, over), DEEP, { reinforcements: REINFORCEMENTS, ...opts });
  test('심층 정상 AUTO 세션은 모든 항목 합격', () => {
    const a = run(deepRun());
    expect(Object.entries(a.acceptance).filter(([, ok]) => !ok)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(Object.keys(a.acceptance)).toEqual(expect.arrayContaining(['throneSet', 'throneCracks', 'throneReady', 'sealed', 'mazeStart', 'mazeLimit', 'mazeClock', 'mazeDone', 'autoCounts', 'mazeViewStates', 'mazeViewGpu']));
  });
  test('거울 미궁이 없는 빌드(hasMaze false)는 심층 판정에서 실패', () => {
    expect(run(deepRun(), { obs: { hasMaze: false } }).acceptance.mazeExists).toBe(false);
    expect(run(deepRun(), { obs: { hasMazeView: false } }).ok).toBe(false);
    expect(run(deepRun(), { obs: { mazeSetup: { roomOk: true, realOk: false, illusionOk: true, real: REAL } } }).acceptance.mazeExists).toBe(false);
  });
  test('한 항목만 깨뜨려도 해당 항목이 실패한다(균열 · 시계 · 목표창 · 뷰 A/B)', () => {
    const s = deepRun();
    const i = s.rows.findIndex(r => r.g[0].dh > 0);
    const spin = { ...deepObs(s), rows: tweak(s.rows, (_, k) => k === i, r => { r.g[0].pph = 0; r.g[0].ph = 0; r.g[0].pag = 1; }) };
    expect(K.analyzeThrones(spin, DEEP, { reinforcements: 2 }).acceptance.throneCracks).toBe(false);
    expect(run(s, { obs: { viewAB: AB({ 1: { mzCalls: 3 } }) } }).acceptance.mazeViewGpu).toBe(false);
    expect(run(s, { obs: { resultText: '가짜 왕좌 파괴 4/4 · 완료' } }).acceptance.resultLine).toBe(false);
  });
  test('AUTO 인데 환영 접촉이 있으면 autoCounts 와 결과가 실패, clean false 면 이 두 항목을 요구하지 않는다', () => {
    const s = deepRun();
    const rows = tweak(s.rows, r => r.mz?.ph === 2, r => { r.mz.ill = 1; });
    const withHit = { ...deepObs(s, { escape: { illusions: 1 } }), rows };
    expect(K.analyzeThrones(withHit, DEEP, { reinforcements: 2 }).acceptance.autoCounts).toBe(false);
    expect(K.analyzeThrones(withHit, DEEP, { reinforcements: 2 }).acceptance.resultFields).toBe(false);
    const relaxed = K.analyzeThrones(withHit, DEEP, { reinforcements: 2, clean: false });
    expect(relaxed.acceptance.autoCounts).toBeUndefined();
    expect(relaxed.acceptance.resultFields).toBe(true);
  });
  test('일반 정상 세션: 왕좌 3곳 합격, 미궁 없음', () => {
    const a = K.analyzeThrones(stdObs(standardRun()), STD, { reinforcements: 1 });
    expect(Object.entries(a.acceptance).filter(([, ok]) => !ok)).toEqual([]);
    expect(a.acceptance.noMaze).toBe(true);
    expect(a.acceptance.mazeStart).toBeUndefined();
  });
  test('일반에 미궁·뷰 행이나 maze 가 보이면 실패', () => {
    const s = standardRun();
    const withMaze = K.analyzeThrones(stdObs(s, { obs: { hasMaze: true } }), STD, { reinforcements: 1 });
    expect(withMaze.acceptance.noMaze).toBe(false);
    const rows = tweak(s.rows, (_, i) => i === 4, r => { r.mz = { ph: 0 }; });
    expect(K.analyzeThrones({ ...stdObs(s), rows }, STD, { reinforcements: 1 }).acceptance.noMaze).toBe(false);
  });
  test('일반 봉인 해제가 3/3 전이면 실패', () => {
    const s = standardRun();
    const rows = tweak(s.rows, r => r.pr === 2, r => { r.sl = 0; });
    expect(K.analyzeThrones({ ...stdObs(s), rows }, STD, { reinforcements: 1 }).acceptance.sealed).toBe(false);
  });
});

describe('결과 줄 요소(aria-label)', () => {
  const lines = (collapses = 0, illusions = 0) => [
    { label: '가짜 왕좌 파괴 결과', text: '가짜 왕좌 파괴 4/4 · 완료' },
    { label: '거울 미궁 탈출 결과', text: '거울 미궁 탈출 완료 · 거울 붕괴 ' + collapses + '회 · 환영 거울 ' + illusions + '회' },
  ];
  const ro = (collapses = 0, illusions = 0) => ({ escape: { escaped: true, collapses, illusions, seconds: 10 } });
  test('심층: 두 요소의 본문이 문구와 횟수까지 같으면 합격', () => {
    expect(K.checkResultLineElements(lines(), DEEP, ro()).ok).toBe(true);
    expect(K.checkResultLineElements(lines(2, 1), DEEP, ro(2, 1)).ok).toBe(true);
    expect(K.checkResultLineElements([{ label: '가짜 왕좌 파괴 결과', text: '가짜  왕좌 파괴 4/4 · 완료\n' }, lines()[1]], DEEP, ro()).ok).toBe(true);
  });
  test('요소가 없거나 본문이 다르거나 횟수가 결과와 다르면 실패', () => {
    expect(K.checkResultLineElements([lines()[0]], DEEP, ro()).ok).toBe(false);
    expect(K.checkResultLineElements([lines()[1]], DEEP, ro()).ok).toBe(false);
    expect(K.checkResultLineElements(lines(1, 0), DEEP, ro()).ok).toBe(false);
    expect(K.checkResultLineElements([{ label: '가짜 왕좌 파괴 결과', text: '가짜 왕좌 파괴 3/4 · 완료' }, lines()[1]], DEEP, ro()).ok).toBe(false);
    expect(K.checkResultLineElements([], DEEP, ro()).ok).toBe(false);
  });
  test('일반: 왕좌 줄만 있고 거울 미궁 요소가 없어야 한다', () => {
    const std = [{ label: '가짜 왕좌 파괴 결과', text: '가짜 왕좌 파괴 3/3 · 완료' }];
    expect(K.checkResultLineElements(std, STD, {}).ok).toBe(true);
    expect(K.checkResultLineElements([...std, lines()[1]], STD, ro()).ok).toBe(false);
  });
  test('analyzeThrones 는 resultLines 가 넘어왔을 때만 이 항목을 판정한다', () => {
    const s = deepRun();
    const without = K.analyzeThrones(deepObs(s), DEEP, { reinforcements: 2 });
    expect(without.acceptance.resultLineElements).toBeUndefined();
    const good = K.analyzeThrones({ ...deepObs(s), resultLines: lines() }, DEEP, { reinforcements: 2 });
    expect(good.acceptance.resultLineElements).toBe(true);
    expect(good.ok).toBe(true);
    const bad = K.analyzeThrones({ ...deepObs(s), resultLines: [lines()[0]] }, DEEP, { reinforcements: 2 });
    expect(bad.acceptance.resultLineElements).toBe(false);
    expect(bad.ok).toBe(false);
  });
});

// ---------- order ----------
/** order 세션: AUTO 로 running → 키보드로 환영 거울 접촉(HP −6) → 방 중심 대기 → 시간 초과 붕괴(HP −6, limit 재계산) → 진짜 거울 done → AUTO 켜 완주. */
function orderRun(over: any = {}) {
  const s = deepRun({ run: { stopShort: true } });
  // deepRun 의 runToReal 이 done 까지 가므로 order 는 직접 구성한다.
  const t = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
  for (let i = 0; i < 4; i++) { t.g[i].dc = 1; t.g[i].rd = 1; t.g[i].bk = 1; t.g[i].ph = 2; t.g[i].hi = 5; t.g[i].cl = 1; }
  t.pr = 4; t.rem = 0; t.step(() => t.startMaze());
  for (let k = 0; k < 20; k++) t.step(() => t.walk(REAL));   // AUTO 로 조금 이동
  t.au = 0; t.mark('manual-start');
  let guard = 0;
  while (Math.hypot(t.hero.x - ILLU.x, t.hero.z - ILLU.z) > ESC.radius && guard++ < 2000) t.step(() => t.walk(ILLU));
  t.step(() => { t.mz.ill = 1; t.mz.cd = over.cooldown ?? ESC.illusionCooldown; t.hp -= over.illusionDrop ?? 6; });
  t.mark('illusion-hit');
  for (let k = 0; k < 200 && Math.hypot(t.hero.x - ROOM.x, t.hero.z - ROOM.z) > 1.2; k++) t.step(() => t.walk(ROOM));
  if (over.noCenter) { t.hero = { x: ILLU.x + 1, z: ILLU.z }; }
  t.mark('center');
  let w = 0;
  while (t.mz.lf > 0 && w++ < 5000) t.step(() => {});
  t.step(() => { t.mz.col = 1; t.hp -= over.collapseDrop ?? 6; t.mz.lim = t.mz.lf = 8; t.flow = { fd: 8, fa: [7, 9, 8, 8] }; });
  t.mark('collapse');
  guard = 0;
  while (Math.hypot(t.hero.x - REAL.x, t.hero.z - REAL.z) - t.speed > ESC.radius && guard++ < 2000) t.step(() => t.walk(REAL));
  t.step(() => { t.walk(REAL); t.mz.ph = 2; t.sl = 0; t.mv.s = [STATE.shattered, STATE.shattered]; });
  t.mark('real-reach');
  t.au = 1;
  for (let k = 0; k < 10; k++) t.step();
  void s;
  return t;
}
describe('order 프로필', () => {
  const result = (over: any = {}) => ({ escape: { escaped: true, collapses: 1, illusions: 1, seconds: 20, ...over } });
  test('정상 세션 합격', () => {
    const a = K.analyzeOrder(orderRun().rows, DEEP, { result: result() });
    expect(a.keyboard.ok).toBe(true);
    expect(a.illusion.ok).toBe(true);
    expect(a.collapse.ok).toBe(true);
    expect(a.done.ok).toBe(true);
    expect(a.result.ok).toBe(true);
    expect(a.ok).toBe(true);
  });
  test('환영 접촉 거리 여유는 규칙 반경 + .01: 반경 + .02 에서 늘어난 접촉은 실패', () => {
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.ill > 0);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.di = ESC.radius + .005; }), DEEP, { result: result() }).illusion.ok).toBe(true);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.di = ESC.radius + .02; }), DEEP, { result: result() }).illusion.ok).toBe(false);
  });
  test('표식이 빠지면 실패', () => {
    const rows = orderRun().rows.filter(r => r.mk !== 'center');
    const a = K.analyzeOrder(rows, DEEP, { result: result() });
    expect(a.ok).toBe(false);
    expect(a.reason).toBe('missing-marks');
  });
  test('키보드 구간에 AUTO 가 켜져 있거나 공격 입력이 있거나 영웅이 쓰러지면 실패', () => {
    const rows = orderRun().rows;
    const m = rows.findIndex(r => r.mk === 'manual-start');
    expect(K.analyzeOrder(tweak(rows, (_, i) => i === m + 40, r => { r.au = 1; }), DEEP, { result: result() }).keyboard.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, i) => i === m + 40, r => { r.ah = 1; }), DEEP, { result: result() }).keyboard.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, i) => i === m + 40, r => { r.ps = 'attack'; }), DEEP, { result: result() }).keyboard.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, i) => i === m + 40, r => { r.al = 0; }), DEEP, { result: result() }).keyboard.ok).toBe(false);
  });
  test('AUTO 를 끄기 전에 시작된 동작이 이어지는 첫 구간만 면제한다', () => {
    const rows = orderRun().rows;
    const m = rows.findIndex(r => r.mk === 'manual-start');
    const carried = tweak(rows, (r, i) => i >= m && i < m + 30, r => { r.ps = 'attack'; });
    expect(K.analyzeOrder(carried, DEEP, { result: result() }).keyboard.ok).toBe(true);
    const held = tweak(rows, (r, i) => i >= m && i < m + 30, r => { r.ps = 'attack'; if (r.n === rows[m].n + 5) r.ah = 1; });
    expect(K.analyzeOrder(held, DEEP, { result: result() }).keyboard.ok).toBe(false);
  });
  test('환영 접촉에 피해가 없거나 쿨다운이 비었거나 접촉 거리가 멀면 실패', () => {
    expect(K.analyzeOrder(orderRun({ illusionDrop: 0 }).rows, DEEP, { result: result() }).illusion.ok).toBe(false);
    expect(K.analyzeOrder(orderRun({ cooldown: 0 }).rows, DEEP, { result: result() }).illusion.ok).toBe(false);
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.ill === 1);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.di = 4; }), DEEP, { result: result() }).illusion.ok).toBe(false);
  });
  test('환영 접촉으로 봉인이 풀리거나 done 이 되면 실패', () => {
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.ill === 1);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.sl = 0; }), DEEP, { result: result() }).illusion.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.ph = 2; }), DEEP, { result: result() }).ok).toBe(false);
  });
  test('붕괴가 두 거울에서 3 안에서 일어나면 실패(시간 초과 위치 조건)', () => {
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.col === 1);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i - 5, r => { r.mz.di = 2; }), DEEP, { result: result() }).collapse.ok).toBe(false);
  });
  test('붕괴 피해가 없거나 limit 이 재계산되지 않으면 실패', () => {
    expect(K.analyzeOrder(orderRun({ collapseDrop: 0 }).rows, DEEP, { result: result() }).collapse.ok).toBe(false);
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.col === 1);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.lim = 0; r.mz.lf = 0; }), DEEP, { result: result() }).collapse.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.lim = 20; r.mz.lf = 20; }), DEEP, { result: result() }).collapse.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.ph = 0; }), DEEP, { result: result() }).collapse.ok).toBe(false);
  });
  test('done 거리가 반경 밖이거나 해제가 done 보다 이르면 실패', () => {
    const rows = orderRun().rows;
    const i = rows.findIndex(r => r.mz?.ph === 2);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i, r => { r.mz.dm = 3; }), DEEP, { result: result() }).done.ok).toBe(false);
    expect(K.analyzeOrder(tweak(rows, (_, k) => k === i - 30, r => { r.sl = 0; }), DEEP, { result: result() }).done.ok).toBe(false);
  });
  test('결과 escape 가 빠지거나 횟수가 관측과 다르면 실패', () => {
    const rows = orderRun().rows;
    expect(K.analyzeOrder(rows, DEEP, { result: null }).result.ok).toBe(false);
    expect(K.analyzeOrder(rows, DEEP, { result: result({ collapses: 0 }) }).result.ok).toBe(false);
    expect(K.analyzeOrder(rows, DEEP, { result: result({ illusions: 2 }) }).result.ok).toBe(false);
    expect(K.analyzeOrder(rows, DEEP, { result: result({ escaped: false }) }).result.ok).toBe(false);
  });
});

// ---------- pause ----------
const freezeAt = (over: any = {}) => ({ elapsed: 100, paused: true, mz: { ph: 1, lim: 30, lf: 28.5, el: 1.5, col: 0, ill: 0, cd: 0, tn: 10 }, tr: [1, 2, 3, 4], mv: { s: [1, 2], f: 3, c: 18, d: 4 }, ...over });
describe('pause 프로필', () => {
  const scene = (over: any = {}) => {
    const before = freezeAt({ paused: false, ...(over.before ?? {}) });
    const paused = freezeAt(over.paused);
    const still = freezeAt(over.still);
    const resumed = freezeAt({ paused: false, elapsed: 100 + 30 * FRAME, mz: { ph: 1, lim: 30, lf: 28.5 - 30 * FRAME, el: 1.5 + 30 * FRAME, col: 0, ill: 0, cd: 0, tn: 10 }, ...(over.resumed ?? {}) });
    return K.checkPause({ before, paused, still, resumed, steps: 30 });
  };
  test('정상: 불변 뒤 재개하면 left 가 30스텝만큼 준다', () => {
    const r = scene();
    expect(r.ok).toBe(true);
    expect(r.running).toBe(true);
  });
  test('정지 중 게임 시간·left·elapsed 가 움직이면 실패', () => {
    expect(scene({ still: { elapsed: 100.5 } }).frozen).toBe(false);
    expect(scene({ still: { mz: { ph: 1, lim: 30, lf: 28.4, el: 1.5, col: 0, ill: 0, cd: 0, tn: 10 } } }).frozen).toBe(false);
    expect(scene({ still: { mz: { ph: 1, lim: 30, lf: 28.5, el: 1.6, col: 0, ill: 0, cd: 0, tn: 10 } } }).frozen).toBe(false);
  });
  test('정지 중 trail · 거울 뷰 · 횟수가 바뀌면 실패', () => {
    expect(scene({ still: { tr: [1, 2, 3, 5] } }).frozen).toBe(false);
    expect(scene({ still: { mv: { s: [1, 2], f: 4, c: 18, d: 4 } } }).frozen).toBe(false);
    expect(scene({ paused: { mz: { ph: 1, lim: 30, lf: 28.5, el: 1.5, col: 1, ill: 0, cd: 0, tn: 10 } } }).frozen).toBe(false);
  });
  test('정지가 걸리지 않았으면(paused false) 실패, 정지 시점이 left ≤ limit − 1 이 아니어도 실패', () => {
    expect(scene({ paused: { paused: false } }).frozen).toBe(false);
    expect(scene({ before: { mz: { ph: 1, lim: 30, lf: 29.5, el: 0.5, col: 0, ill: 0, cd: 0, tn: 10 } }, paused: { mz: { ph: 1, lim: 30, lf: 29.5, el: 0.5, col: 0, ill: 0, cd: 0, tn: 10 } }, still: { mz: { ph: 1, lim: 30, lf: 29.5, el: 0.5, col: 0, ill: 0, cd: 0, tn: 10 } } }).running).toBe(false);
  });
  test('재개 뒤 left 가 줄지 않거나 너무 줄면 실패', () => {
    expect(scene({ resumed: { mz: { ph: 1, lim: 30, lf: 28.5, el: 1.5, col: 0, ill: 0, cd: 0, tn: 10 } } }).resumedOk).toBe(false);
    expect(scene({ resumed: { mz: { ph: 1, lim: 30, lf: 20, el: 10, col: 0, ill: 0, cd: 0, tn: 10 } } }).resumedOk).toBe(false);
  });
  test('재개 뒤 완주: done 이 있고 붕괴·접촉 0 이어야 한다', () => {
    const rows = deepRun().rows;
    const withMark = tweak(rows, (_, i) => i === 8, r => { r.mk = 'resume'; });
    expect(K.analyzePauseResume(withMark).ok).toBe(true);
    expect(K.analyzePauseResume(rows.filter(r => r.mk !== 'resume')).reason).toBe('missing-mark');
    const collapsed = tweak(withMark, r => r.mz?.ph === 2, r => { r.mz.col = 1; });
    expect(K.analyzePauseResume(collapsed).ok).toBe(false);
  });
});

// ---------- screens ----------
describe('screens 프로필', () => {
  test('모든 순간에 도달해 viewport 개수만큼 PNG 가 있어야 한다', () => {
    const shots = ['a', 'b'].map(label => ({ label, reached: true, files: ['1', '2', '3'] }));
    expect(K.checkScreens(shots, ['a', 'b'], 3).ok).toBe(true);
    expect(K.checkScreens(shots, ['a', 'b', 'c'], 3).ok).toBe(false);
    expect(K.checkScreens([shots[0], { label: 'b', reached: false }], ['a', 'b'], 3).ok).toBe(false);
    expect(K.checkScreens([shots[0], { label: 'b', reached: true, files: ['1', '2'] }], ['a', 'b'], 3).ok).toBe(false);
    expect(K.checkScreens([], [], 3).ok).toBe(false);
  });
  const cap = (over: any = {}) => ({ elapsed: 50, doneT: -1, g: [{ rd: 1, bk: 0, ph: 1 }], mz: { ph: 0 }, mv: { s: [0, 0], f: 0, c: 18, d: 0 }, ...over });
  test('throne-still: 준비된 왕좌가 still 이고 거울은 숨김', () => {
    expect(K.checkScreenMoment({ capture: cap() }, { kind: 'throne-still' }).ok).toBe(true);
    expect(K.checkScreenMoment({ capture: cap({ g: [{ rd: 1, bk: 0, ph: 0 }] }) }, { kind: 'throne-still' }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: cap({ g: [{ rd: 0, bk: 0, ph: 1 }] }) }, { kind: 'throne-still' }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: cap({ mv: { s: [1, 2], f: 0, c: 18, d: 4 } }) }, { kind: 'throne-still' }).ok).toBe(false);
  });
  test('maze-start: 시작 스텝 같은 프레임에 hidden → real/illusion', () => {
    const run = cap({ mz: { ph: 1 }, mv: { s: [1, 2], f: 1, c: 18, d: 4 } });
    const stop = { prev: { mzph: 0, s: [0, 0] } };
    const r = K.checkScreenMoment({ capture: run, stop }, { kind: 'maze-start' });
    expect(r.ok).toBe(true);
    expect(r.states).toEqual(['real', 'illusion']);
    expect(K.checkScreenMoment({ capture: run, stop: { prev: { mzph: 1, s: [1, 2] } } }, { kind: 'maze-start' }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: cap({ mz: { ph: 1 }, mv: { s: [0, 0], f: 0, c: 18, d: 0 } }), stop }, { kind: 'maze-start' }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: run }, { kind: 'maze-start' }).ok).toBe(false);
  });
  test('footprints: running 이고 발자국 ≥ 3', () => {
    const mk = (f: number) => cap({ mz: { ph: 1 }, mv: { s: [1, 2], f, c: 18, d: 4 } });
    expect(K.checkScreenMoment({ capture: mk(3) }, { kind: 'footprints', minFootprints: 3 }).ok).toBe(true);
    expect(K.checkScreenMoment({ capture: mk(2) }, { kind: 'footprints', minFootprints: 3 }).ok).toBe(false);
  });
  test('escaped: done 뒤 0.3초에 shattered', () => {
    const mk = (elapsed: number, s: number[]) => cap({ elapsed, doneT: 50, mz: { ph: 2 }, mv: { s, f: 0, c: 18, d: 0 } });
    expect(K.checkScreenMoment({ capture: mk(50.3, [3, 3]) }, { kind: 'escaped', minAfter: .3 }).ok).toBe(true);
    expect(K.checkScreenMoment({ capture: mk(50.1, [3, 3]) }, { kind: 'escaped', minAfter: .3 }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: mk(50.3, [1, 2]) }, { kind: 'escaped', minAfter: .3 }).ok).toBe(false);
    expect(K.checkScreenMoment({ capture: cap({ elapsed: 60, doneT: -1, mz: { ph: 2 }, mv: { s: [3, 3], f: 0, c: 18, d: 0 } }) }, { kind: 'escaped', minAfter: .3 }).ok).toBe(false);
    expect(K.checkScreenMoment({}, { kind: 'escaped' }).ok).toBe(false);
  });
});

// ---------- 기준선 비교 ----------
describe('기준선 비교', () => {
  const setup = (over: any = {}) => ({ heroId: 'knight', seed: 20261015, depth: 'deep', reseedOn: true, viewport: { width: 844, height: 390 }, motion: 'reduce', quality: 'default', ...over });
  test('같은 설정이면 합격, 하나라도 다르거나 없으면 실패', () => {
    expect(K.compareSetup(setup(), setup()).ok).toBe(true);
    for (const patch of [{ heroId: 'mage' }, { seed: 1 }, { depth: 'standard' }, { reseedOn: false }, { viewport: { width: 640, height: 360 } }, { motion: 'no-preference' }, { quality: 'low' }]) {
      expect(K.compareSetup(setup(), setup(patch)).ok).toBe(false);
    }
    expect(K.compareSetup({ ...setup(), motion: undefined }, { ...setup(), motion: undefined }).ok).toBe(false);
  });
  const cand = (over: any = {}) => ({ head: 'b'.repeat(40), status: 'pass', runStatus: 'pass', throneOk: true, routeDefinition: DEEP, ...over });
  const base = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', throneOk: null, routeDefinition: null, ...over });
  test('심층 대상: 기준선에 escape 정의가 없고 후보에 있어야 한다', () => {
    expect(K.compareTargetsOk(cand(), base(), 'deep')).toBe(true);
    expect(K.compareTargetsOk(cand(), base({ routeDefinition: DEEP }), 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand({ routeDefinition: null }), base(), 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand({ head: base().head }), base(), 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand({ throneOk: false }), base(), 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand({ status: 'fail' }), base(), 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand(), base({ runStatus: 'fail' }), 'deep')).toBe(false);
  });
  test('일반 대상: 양쪽 정의가 같고 escape 가 없고 기준선 왕좌 판정도 통과해야 한다', () => {
    const c = cand({ routeDefinition: STD }), b = base({ routeDefinition: STD, throneOk: true });
    expect(K.compareTargetsOk(c, b, 'standard')).toBe(true);
    expect(K.compareTargetsOk(c, { ...b, throneOk: false }, 'standard')).toBe(false);
    expect(K.compareTargetsOk(c, { ...b, routeDefinition: null }, 'standard')).toBe(false);
    expect(K.compareTargetsOk({ ...c, routeDefinition: DEEP }, b, 'standard')).toBe(false);
  });
  const gpu = { ok: true, samples: 5, max: 4, limit: 4, coverage: { hidden: true, running: true, shattered: true } };
  const run = (over: any = {}) => ({ time: 240, runOver50: 3, steps: 14400, samples: [], throneRooms: [2, 3, 5, 6], viewGpu: gpu, ...over });
  test('완주 시간 비 ≤ 2.0 · 50ms 초과 ≤ 기준선 + 2 · 거울 뷰 A/B 가 모두 맞아야 합격', () => {
    const ok = K.compareRuns(run({ time: 380 }), run({ time: 200, runOver50: 1 }), { depth: 'deep' });
    expect(ok.ok).toBe(true);
    expect(ok.gates).toEqual({ time: true, slow: true, viewGpu: true });
    expect(ok.time.ratio).toBeCloseTo(1.9, 5);
  });
  test('시간 비 2.0 초과는 실패, 경계 2.0 은 합격', () => {
    expect(K.compareRuns(run({ time: 401 }), run({ time: 200 }), { depth: 'deep' }).gates.time).toBe(false);
    expect(K.compareRuns(run({ time: 400 }), run({ time: 200 }), { depth: 'deep' }).gates.time).toBe(true);
    expect(K.compareRuns(run({ time: null }), run({ time: 200 }), { depth: 'deep' }).gates.time).toBe(false);
    expect(K.compareRuns(run(), run({ time: null }), { depth: 'deep' }).gates.time).toBe(false);
  });
  test('50ms 초과 수: 기준선 + 2 까지 합격, 3 이상 늘면 실패', () => {
    expect(K.compareRuns(run({ runOver50: 5 }), run({ runOver50: 3 }), { depth: 'deep' }).gates.slow).toBe(true);
    expect(K.compareRuns(run({ runOver50: 6 }), run({ runOver50: 3 }), { depth: 'deep' }).gates.slow).toBe(false);
    expect(K.compareRuns(run({ runOver50: undefined }), run({ runOver50: 3 }), { depth: 'deep' }).gates.slow).toBe(false);
  });
  test('심층은 후보 거울 뷰 A/B 가 통과해야 하고, 일반에는 이 게이트가 없다', () => {
    expect(K.compareRuns(run({ viewGpu: { ...gpu, ok: false } }), run(), { depth: 'deep' }).ok).toBe(false);
    expect(K.compareRuns(run({ viewGpu: null }), run(), { depth: 'deep' }).ok).toBe(false);
    const std = K.compareRuns(run({ viewGpu: null }), run(), { depth: 'standard' });
    expect(std.gates).toEqual({ time: true, slow: true });
    expect(std.ok).toBe(true);
  });
  test('보고 항목: 일반 시간 비 1.00 ± 0.05, 방 첫 진입 draw call 증가, 50ms 초과율', () => {
    const s = (calls: number) => [2, 3, 5, 6].map(id => ({ label: 'roomEnter', roomId: id, calls }));
    const std = K.compareRuns(run({ time: 204, samples: s(30) }), run({ time: 200, samples: s(28) }), { depth: 'standard' });
    expect(std.report.timeParity.within).toBe(true);
    expect(std.report.timeParity.applies).toBe(true);
    expect(std.report.roomEnterDrawCalls.maxIncrease).toBe(2);
    expect(std.report.roomEnterDrawCalls.matched).toBe(4);
    const far = K.compareRuns(run({ time: 230 }), run({ time: 200 }), { depth: 'standard' });
    expect(far.report.timeParity.within).toBe(false);
    expect(far.ok).toBe(true);
    expect(K.compareRuns(run(), run({ steps: 7200, runOver50: 1 }), { depth: 'deep' }).report.over50PerThousandSteps.base).toBeCloseTo(1 / 7.2, 5);
  });
  test('stepStats / percentile', () => {
    expect(K.stepStats([1, 2, 51, 60]).over).toBe(2);
    expect(K.stepStats([]).p50).toBeNull();
    expect(K.percentile([5, 1, 3], 0.5)).toBe(3);
  });
});
