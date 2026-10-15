import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/eclipse-valve-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEEP: any = (ROUTE_OBJECTIVES as any).eclipse_deep;
const STD: any = (ROUTE_OBJECTIVES as any).eclipse_standard;

// 방 배치와 종류(정예방은 증원 reinforcements 회). 판정은 방 id·좌표·종류를 인자로 받는다.
const DEEP_ROOMS = [{ id: 2, x: 31, z: -29, type: 'treasure' }, { id: 4, x: 62, z: 0, type: 'elite' }, { id: 7, x: 124, z: 29, type: 'elite' }, { id: 5, x: 93, z: 0, type: 'treasure' }];
const STD_ROOMS = [{ id: 2, x: 31, z: -29, type: 'treasure' }, { id: 5, x: 93, z: 0, type: 'normal' }, { id: 7, x: 124, z: 29, type: 'elite' }];
const REINFORCEMENTS = 2;

/** 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 건너뛴 스텝은 skip 으로 센다. */
class Sim {
  rows: any[] = []; n = 0; pr = 0; hd = 0; sl = 1; au = 1; ah = 0; ps = 'move'; hero = { x: 0, z: 0 }; rem: number; g: any[]; extra = 2;
  constructor(public def: any, public rooms: any[], public reinforcements: number) {
    this.g = def.gates.map((gate: any) => ({ id: gate.roomId, rd: 0, at: 0, cl: 0, fw: 0, dc: 0, al: 0, pd: 0 }));
    this.rem = def.gates.length + this.extra;
    this.snap({ mk: 'start' });
  }
  snap(extra: any = {}) {
    const row = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: 100, mhp: 100, al: 1, rm: 0, pr: this.pr, hd: this.hd, sl: this.sl, rem: this.rem,
      au: this.au, ah: this.ah, ps: this.ps, g: this.g.map(x => ({ ...x })), ...extra };
    this.rows.push(row); return row;
  }
  step(extra: any = {}) { this.n++; return this.snap(extra); }
  skip(k: number) { this.n += k; }
  mark(label: string) { return this.snap({ mk: label }); }
  room(i: number) { return this.rooms.find((r: any) => r.id === this.def.gates[i].roomId); }
  place(i: number, dx = 0, dz = 0) { const r = this.room(i); this.hero = { x: r.x + dx, z: r.z + dz }; }
  /** 방을 발견하고 적을 처치한다. 정예방은 증원 waves 회를 모두 겪은 뒤 ready. */
  clear(i: number, { waves = this.reinforcements, ready = true, dirtyAtReady = false }: any = {}) {
    const g = this.g[i], room = this.room(i);
    g.dc = 1; this.skip(20); this.step();
    g.al = 5; this.skip(30); this.step();
    g.al = 0;
    if (room.type === 'elite') for (let w = 1; w <= waves; w++) { g.fw = w; this.step(); if (w < waves) { g.al = 4; this.skip(30); this.step(); g.al = 0; } }
    if (ready) { g.rd = 1; if (dirtyAtReady) g.al = 1; this.step(); }
  }
  /** 유지 구간: rows 개 행(hd = k/60). 마지막 행 다음이 봉인 스텝(hd 0, progress 증가). */
  hold(i: number, { rows = Math.round(this.def.holdSeconds / FRAME) - 1, dx = 0, dz = 0, dom = true, domText, hdScale = 1 }: any = {}) {
    this.place(i, dx, dz);
    for (let k = 1; k <= rows; k++) {
      this.hd = k * FRAME * hdScale;   // hdScale 2: 엔진이 유지량을 2배로 쌓는 퇴행
      const row: any = this.step();
      if (dom && this.hd >= .5 && k % 6 === 0) row.dom = domText ?? valveTitle(this.def) + ' ' + this.pr + '/' + this.def.gates.length + holdPhraseOf(this.def);
    }
  }
  seal(i: number) {
    const g = this.g[i];
    this.hd = 0; g.at = 1; g.cl = 1; this.pr++; this.rem--;
    return this.step();
  }
  waitFor(i: number) { const g = this.g[i]; g.dc = 1; this.skip(10); this.step(); g.al = 3; this.skip(20); this.step(); g.al = 0; g.rd = 1; this.step(); }
  unseal({ remaining = 0 } = {}) { this.skip(72); this.sl = 0; this.rem = remaining; this.step(); }
}
const valveTitle = (def: any) => K.valveTitle(def);
const holdPhraseOf = (def: any) => K.holdPhraseOf(def);

/** 심층 정상 세션: 방 2 → 4 → (5 순서 대기) → 7 → 5. 각 봉인 뒤 뷰 표본(stable 3스텝 뒤)을 남긴다. */
function deepSession(over: any = {}) {
  const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS);
  s.mark('x'); // 첫 행 뒤 표식(무시되는 라벨)
  s.clear(0, over.clear0); s.hold(0, over.hold0); s.seal(0);
  s.clear(1, over.clear1); s.hold(1, over.hold1); s.seal(1);
  s.rem -= s.extra; // 나머지 구역 정화
  if (!over.noWait) s.waitFor(3);
  s.clear(2, over.clear2); s.hold(2, over.hold2); s.seal(2);
  if (over.noWait) s.waitFor(3);
  s.hold(3, over.hold3); s.seal(3);
  if (over.unsealEarly) { const row = s.rows.at(-1); row.sl = 0; }
  else s.unseal(over.unseal);
  s.mark('end');
  return s;
}
function standardSession(over: any = {}) {
  const s = new Sim(STD, STD_ROOMS, 0);
  for (let i = 0; i < 3; i++) {
    if (i === 2) s.rem -= s.extra;
    s.clear(i, { waves: 0 }); s.hold(i, over['hold' + i]); s.seal(i);
  }
  s.unseal();
  s.mark('end');
  return s;
}
const resultOf = (def: any, over: any = {}) => ({ id: def.id, label: valveTitle(def), complete: true, progress: def.gates.length, target: def.gates.length, rooms: def.gates.map((g: any) => g.roomId), ...over });
const textOf = (def: any) => '원정 결과 ' + K.resultLineOf(def) + ' 전투 시간';
const run = (s: Sim, def = DEEP, over: any = {}, opts: any = {}) => K.analyzeValves({ rows: s.rows, result: resultOf(def), resultText: textOf(def), win: true, rooms: s.rooms, ...over }, def,
  { reinforcements: s.reinforcements, expectWaiting: def === DEEP, viewExpected: false, ...opts });
const failing = (a: any) => Object.entries(a.acceptance).filter(([, ok]) => !ok).map(([name]) => name);

describe('공유 정의', () => {
  test('심층 4곳(2·4·7·5)·일반 3곳(2·5·7)이고 제목은 정의의 noun + verb 다', () => {
    expect(DEEP.gates.map((g: any) => g.roomId)).toEqual([2, 4, 7, 5]);
    expect(STD.gates.map((g: any) => g.roomId)).toEqual([2, 5, 7]);
    expect(K.resultLineOf(DEEP)).toBe('역류 밸브 봉인 4/4 · 완료');
    expect(K.resultLineOf(STD)).toBe('역류 밸브 잠금 3/3 · 완료');
    expect(K.holdPhraseOf(DEEP)).toBe('중심에서 2초 유지');
  });
});

describe('holdRuns', () => {
  const at = (n: number, hd: number, t = n * FRAME) => ({ n, t, hd });
  test('연속 스텝에서 hold 증가량이 게임 시각 t 증가량과 같을 때만 한 구간이고, 틈이 있거나 hd 가 줄면 새 구간이다', () => {
    const rows = [at(1, FRAME), at(2, 2 * FRAME), at(3, 3 * FRAME), at(4, 0), at(5, FRAME), at(7, 3 * FRAME), at(8, 2 * FRAME)];
    const runs = K.holdRuns(rows);
    expect(runs.map((r: any) => [r.start, r.end, r.fromZero])).toEqual([[0, 2, true], [4, 4, true], [5, 5, false], [6, 6, false]]);
  });
  test('0 에서 시작하지 않은 구간은 fromZero 가 false 다', () => {
    expect(K.holdRuns([at(1, .8), at(2, .8 + FRAME)])[0].fromZero).toBe(false);
  });
  test('hold 증가량이 t 증가량의 2배면(엔진 2배 적립) 구간이 이어지지 않는다 — 예전 2 × FRAME 허용도는 이를 이어 붙였다', () => {
    const rows = [at(1, 2 * FRAME, FRAME), at(2, 4 * FRAME, 2 * FRAME), at(3, 6 * FRAME, 3 * FRAME), at(4, 8 * FRAME, 4 * FRAME)];
    expect(K.holdRuns(rows).map((r: any) => [r.start, r.end])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });
  test('증가량 오차 허용은 1e-6: 5e-7 차이는 이어지고 2e-6 차이는 끊긴다. t 가 없는 행은 이어지지 않는다', () => {
    expect(K.holdRuns([at(1, FRAME), at(2, 2 * FRAME + 5e-7)]).length).toBe(1);
    expect(K.holdRuns([at(1, FRAME), at(2, 2 * FRAME + 2e-6)]).length).toBe(2);
    expect(K.holdRuns([{ n: 1, hd: FRAME }, { n: 2, hd: 2 * FRAME }]).length).toBe(2);
  });
  test('runSpan 은 t_end − t_start + 한 프레임이다', () => {
    const rows = Array.from({ length: 119 }, (_, k) => at(k + 1, (k + 1) * FRAME));
    const run = K.holdRuns(rows)[0];
    expect(K.runSpan(rows, run)).toBeCloseTo(119 * FRAME, 9);
  });
});

describe('봉인 판정(checkSeals)', () => {
  test('정상 심층 세션은 봉인 4회·순서 [2,4,7,5]·유지 ≥ 2초 − 1/60 으로 통과한다', () => {
    const r = K.checkSeals(deepSession().rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.count).toBe(4);
    expect(r.observedOrder).toEqual([2, 4, 7, 5]);
    expect(r.seals.every((s: any) => s.hold.seconds >= DEEP.holdSeconds - FRAME - 1e-6)).toBe(true);
    expect(Object.values(r.ok).every(Boolean)).toBe(true);
    expect(r.violations).toEqual([]);
  });
  test('순서 위반: 봉인한 밸브의 방 id 가 정의 순서와 다르면 order 가 실패한다', () => {
    const s = deepSession();
    for (const row of s.rows) if (row.g.length) { const [a, b] = [row.g[2].id, row.g[3].id]; row.g[2].id = b; row.g[3].id = a; }
    const r = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.order).toBe(false);
    expect(r.violations.some((v: any) => v.kind === 'order')).toBe(true);
  });
  test('순서 위반: progress 가 한 번에 2 오르면 실패한다', () => {
    const s = deepSession();
    const i = s.rows.findIndex((row: any) => row.pr === 1);
    for (let k = i; k < s.rows.length; k++) s.rows[k].pr += 1;
    expect(K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.order).toBe(false);
  });
  test('유지 부족: 1.2초만 머물고 봉인되면 hold 가 실패한다', () => {
    const r = K.checkSeals(deepSession({ hold1: { rows: 72 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.hold).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'hold').seconds).toBeCloseTo(72 * FRAME, 6);
  });
  test('유지 부족: 0 에서 새로 시작하지 않은 구간(중간부터 관측)은 실패한다', () => {
    const s = deepSession();
    const run = K.holdRuns(s.rows)[0];
    s.rows.splice(run.start, 40);
    expect(K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(false);
  });
  test('유지 부족: 유지 구간이 끊긴 스텝(n 틈)이 있으면 직전 연속 구간이 짧아 실패한다', () => {
    const s = deepSession();
    const run = K.holdRuns(s.rows)[1];
    for (let k = run.start + 60; k <= run.end; k++) s.rows[k].n += 5;
    expect(K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(false);
  });
  // ---- 리뷰 P2-4: 유지 시간을 엔진 카운터가 아니라 행의 게임 시각으로 ----
  test('게임 시각: 정상 봉인의 유지 구간은 t_end − t_start + FRAME 이 엔진 hold 와 같고 holdSeconds − FRAME 이상이다', () => {
    const r = K.checkSeals(deepSession().rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    for (const seal of r.seals) {
      expect(seal.hold.span).toBeGreaterThanOrEqual(DEEP.holdSeconds - FRAME - 1e-6);
      expect(seal.hold.span).toBeCloseTo(seal.hold.seconds, 6);
    }
  });
  test('게임 시각: 119 행(= holdSeconds − FRAME)은 통과하고 118 행은 실패한다', () => {
    expect(K.checkSeals(deepSession({ hold1: { rows: 119 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(true);
    expect(K.checkSeals(deepSession({ hold1: { rows: 118 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(false);
  });
  test('게임 시각: 엔진이 유지량을 2배로 쌓아 1초만 머물고 hold 2.0 으로 봉인하면 hold 가 실패한다', () => {
    const s = deepSession({ hold1: { rows: 60, hdScale: 2 } });
    const hold1 = s.rows.filter((row: any) => row.hd > 0 && row.g[1].dc === 1 && row.pr === 1);
    expect(hold1.at(-1).hd).toBeCloseTo(2, 9);   // 엔진 카운터만 보면 2초 유지처럼 보인다
    const r = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.hold).toBe(false);
    expect(r.violations.filter((v: any) => v.kind === 'hold').map((v: any) => v.roomId)).toEqual([4]);
    expect(r.seals.filter((x: any) => x.hold.ok).length).toBe(3);
  });
  test('게임 시각: 첫 스텝은 1 프레임인데 이후 스텝마다 hold 가 2 프레임씩 늘어 1초 만에 1.98 에 닿아도 실패한다(예전 허용도로는 통과)', () => {
    const s = deepSession({ hold1: { rows: 60 } });
    const run = K.holdRuns(s.rows)[1];
    expect(run.end - run.start + 1).toBe(60);
    for (let k = run.start; k <= run.end; k++) s.rows[k].hd = (2 * (k - run.start) + 1) * FRAME;
    expect(s.rows[run.end].hd).toBeGreaterThanOrEqual(DEEP.holdSeconds - FRAME - 1e-9);
    const r = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.hold).toBe(false);
    expect(r.violations.filter((v: any) => v.kind === 'hold').map((v: any) => v.roomId)).toEqual([4]);
  });
  test('게임 시각: 구간 중간에 hold 가 한 번 더 뛰거나(+1 프레임) t 가 멈춘 채 hold 만 늘면 구간이 끊겨 실패한다', () => {
    const jump = deepSession();
    const run = K.holdRuns(jump.rows)[1];
    for (let k = run.start + 50; k <= run.end; k++) jump.rows[k].hd += FRAME;
    expect(K.checkSeals(jump.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(false);
    const frozen = deepSession();
    const run2 = K.holdRuns(frozen.rows)[2];
    for (let k = run2.start + 30; k <= run2.end; k++) frozen.rows[k].t = frozen.rows[run2.start + 29].t;
    expect(K.checkSeals(frozen.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.hold).toBe(false);
  });
  test('빛 밖: 유지 중 영웅이 반경 + 여유 밖으로 나가면 inside 가 실패한다', () => {
    const r = K.checkSeals(deepSession({ hold2: { dx: DEEP.radius + K.POSITION_SLACK + .3 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.inside).toBe(false);
    expect(r.violations.some((v: any) => v.kind === 'inside' && v.roomId === 7)).toBe(true);
  });
  test('빛 안 경계: 반경 안(3.0) 가장자리는 통과한다', () => {
    expect(K.checkSeals(deepSession({ hold2: { dx: DEEP.radius - .05 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.inside).toBe(true);
  });
  test('증원 전 봉인: 정예방 forgeWave 가 증원 횟수보다 작으면 reinforcements 가 실패한다', () => {
    const r = K.checkSeals(deepSession({ clear1: { waves: 1 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.reinforcements).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'forge').roomId).toBe(4);
  });
  test('증원 전 봉인: 보물방은 forgeWave 0 이어도 통과하고, 증원 횟수 0 인 정예방(일반)도 통과한다', () => {
    expect(K.checkSeals(deepSession().rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).seals[0].forge).toMatchObject({ forgeWave: 0, want: null, ok: true });
    expect(K.checkSeals(standardSession().rows, STD, { reinforcements: 0, rooms: STD_ROOMS }).ok.reinforcements).toBe(true);
  });
  test('적이 남은 채 봉인: 봉인 스텝에 살아 있는 적이 있거나 유지 구간에 대기열이 있으면 enemies 가 실패한다', () => {
    const a = deepSession();
    a.rows.find((row: any) => row.pr === 1 && row.hd === 0 && row.g[0].at === 1).g[0].al = 2;
    expect(K.checkSeals(a.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.enemies).toBe(false);
    const b = deepSession();
    const run = K.holdRuns(b.rows)[2];
    b.rows[run.start + 10].g[2].pd = 1;
    expect(K.checkSeals(b.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.enemies).toBe(false);
  });
  test('ready 가 아닌 유지: 유지 구간 중 gate.ready 가 꺼져 있으면 enemies 가 실패한다', () => {
    const s = deepSession();
    const run = K.holdRuns(s.rows)[0];
    s.rows[run.start + 5].g[0].rd = 0;
    expect(K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.enemies).toBe(false);
  });
  test('상태: 봉인 전에 그 방이 cleared 였거나 앞 밸브가 attuned 가 아니면 state 가 실패한다', () => {
    const early = deepSession();
    early.rows.find((row: any) => row.pr === 1 && row.g[1].rd === 1).g[1].cl = 1;
    expect(K.checkSeals(early.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.state).toBe(false);
    const skipped = deepSession();
    for (const row of skipped.rows) if (row.pr >= 2) row.g[0].at = 0;
    expect(K.checkSeals(skipped.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.state).toBe(false);
  });
  test('봉인이 3회뿐이면 count 가 실패한다', () => {
    const s = deepSession();
    const first = s.rows.findIndex((row: any) => row.pr === 4);
    for (let k = first; k < s.rows.length; k++) { s.rows[k].pr = 3; s.rows[k].g[3].at = 0; s.rows[k].g[3].cl = 0; }
    const r = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.count).toBe(false);
  });
  test('일반 세션(밸브 3개 [2,5,7])도 같은 규칙으로 통과한다', () => {
    const r = K.checkSeals(standardSession().rows, STD, { reinforcements: 0, rooms: STD_ROOMS });
    expect(r.observedOrder).toEqual([2, 5, 7]);
    expect(Object.values(r.ok).every(Boolean)).toBe(true);
  });
});

describe('순서 대기(checkWaiting)', () => {
  test('방 5 가 ready 인데 progress < 3 인 표본이 있으면 통과', () => {
    const w = K.checkWaiting(deepSession().rows, DEEP, { required: true });
    expect(w.samples).toBeGreaterThanOrEqual(1);
    expect(w.ok).toBe(true);
  });
  test('대기 미관측: 방 5 가 progress 3 뒤에야 ready 가 되면 실패한다', () => {
    const w = K.checkWaiting(deepSession({ noWait: true }).rows, DEEP, { required: true });
    expect(w.samples).toBe(0);
    expect(w.ok).toBe(false);
  });
  test('대기 중 방 5 가 이미 attuned·cleared 면 실패한다', () => {
    const s = deepSession();
    for (const row of s.rows) if (row.pr < 3 && row.g[3].rd === 1) { row.g[3].cl = 1; }
    expect(K.checkWaiting(s.rows, DEEP, { required: true }).ok).toBe(false);
  });
  test('일반(required false)은 표본이 없어도 통과한다', () => {
    expect(K.checkWaiting(standardSession().rows, STD, { required: false }).ok).toBe(true);
  });
});

describe('보스 봉인 해제(checkUnseal)', () => {
  test('마지막 봉인 뒤·모든 구역 정화 뒤 해제는 통과', () => {
    const u = K.checkUnseal(deepSession().rows, DEEP);
    expect(u).toMatchObject({ ok: true, progress: 4, remaining: 0, startsSealed: true });
  });
  test('봉인 해제 조기: progress 가 4 가 되기 전에 sealed 가 false 가 되면 실패한다', () => {
    const s = deepSession();
    const i = s.rows.findIndex((row: any) => row.pr === 3);
    for (let k = i; k < s.rows.length; k++) s.rows[k].sl = 0;
    expect(K.checkUnseal(s.rows, DEEP).ok).toBe(false);
  });
  test('봉인 해제 조기: 미정화 구역이 남았는데 해제되면 실패한다', () => {
    expect(K.checkUnseal(deepSession({ unseal: { remaining: 1 } }).rows, DEEP).ok).toBe(false);
  });
  test('마지막 봉인 스텝과 같은 스텝에 해제되거나 한 번도 해제되지 않으면 실패한다', () => {
    expect(K.checkUnseal(deepSession({ unsealEarly: true }).rows, DEEP).ok).toBe(false);
    const s = deepSession();
    for (const row of s.rows) row.sl = 1;
    expect(K.checkUnseal(s.rows, DEEP)).toMatchObject({ ok: false, reason: 'never-unsealed' });
  });
  test('시작부터 sealed 가 아니었으면 실패한다', () => {
    const s = deepSession();
    s.rows[0].sl = 0;
    expect(K.checkUnseal(s.rows, DEEP).ok).toBe(false);
  });
});

describe('결과(checkResultFields·checkResultLine)', () => {
  test('정상 결과 객체와 결과 줄은 통과하고 일반은 잠금 문구다', () => {
    expect(K.checkResultFields(resultOf(DEEP), DEEP, true).ok).toBe(true);
    expect(K.checkResultFields(resultOf(STD), STD, true).ok).toBe(true);
    expect(K.checkResultLine(textOf(DEEP), DEEP).ok).toBe(true);
    expect(K.checkResultLine(textOf(STD), STD).ok).toBe(true);
  });
  test('결과 불일치: complete·progress·target·rooms·id·label·패배 각각 실패한다', () => {
    const bad: any[] = [{ complete: false }, { progress: 3 }, { target: 3 }, { rooms: [2, 4, 5, 7] }, { rooms: [2, 4, 7] }, { id: 'eclipse_backflow_valves' }, { label: '역류 밸브 잠금' }];
    for (const over of bad) expect(K.checkResultFields(resultOf(DEEP, over), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP), DEEP, false).ok).toBe(false);
    expect(K.checkResultFields(null, DEEP, true).ok).toBe(false);
  });
  test('결과 불일치: 결과 줄이 다른 개수·다른 동사·미완료면 실패한다', () => {
    for (const text of ['원정 결과 역류 밸브 봉인 3/4 · 완료', '원정 결과 역류 밸브 잠금 4/4 · 완료', '원정 결과 역류 밸브 봉인 4/4', '', undefined]) expect(K.checkResultLine(text, DEEP).ok).toBe(false);
  });
});

describe('목표창 표본(checkObjectiveSamples)', () => {
  test('모든 유지 구간에 제목과 유지 문구가 있는 표본이 있으면 통과', () => {
    const s = deepSession();
    const seals = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).seals;
    const o = K.checkObjectiveSamples(s.rows, DEEP, seals);
    expect(o.ok).toBe(true);
    expect(o.samples).toBeGreaterThanOrEqual(4);
  });
  test('제목이나 유지 문구가 빠진 표본이 있으면 실패한다', () => {
    for (const domText of ['보스 처치 중심에서 2초 유지', '역류 밸브 봉인 이 구역의 적과 증원 처치']) {
      const s = deepSession({ hold2: { domText } });
      const seals = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).seals;
      expect(K.checkObjectiveSamples(s.rows, DEEP, seals).ok).toBe(false);
    }
  });
  test('어떤 봉인의 유지 구간에 표본이 하나도 없으면 missing 으로 실패한다', () => {
    const s = deepSession({ hold1: { dom: false } });
    const seals = K.checkSeals(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).seals;
    const o = K.checkObjectiveSamples(s.rows, DEEP, seals);
    expect(o.ok).toBe(false);
    expect(o.missing.map((m: any) => m.roomId)).toEqual([4]);
  });
});

describe('종합(analyzeValves)', () => {
  test('정상 심층·일반 세션은 모든 항목이 통과한다', () => {
    const d = run(deepSession());
    expect(failing(d)).toEqual([]);
    expect(d.ok).toBe(true);
    const s = run(standardSession(), STD);
    expect(failing(s)).toEqual([]);
    expect(s.ok).toBe(true);
  });
  test('실패 입력은 해당 항목만 실패로 표시한다', () => {
    expect(failing(run(deepSession({ hold1: { rows: 72 } })))).toContain('holdDuration');
    expect(failing(run(deepSession({ clear2: { waves: 1 } })))).toContain('reinforcements');
    expect(failing(run(deepSession({ noWait: true })))).toEqual(['waiting']);
    expect(failing(run(deepSession({ unseal: { remaining: 2 } })))).toEqual(['unseal']);
    expect(failing(run(deepSession(), DEEP, { result: resultOf(DEEP, { progress: 3 }) }))).toEqual(['resultFields']);
    expect(failing(run(deepSession(), DEEP, { resultText: '원정 결과 역류 밸브 봉인 3/4' }))).toEqual(['resultLine']);
    expect(failing(run(deepSession({ hold0: { dx: 4 } })))).toContain('holdInside');
  });
  test('패배 결과(win false)는 resultFields 가 실패한다', () => {
    expect(failing(run(deepSession(), DEEP, { win: false }))).toContain('resultFields');
  });
});

// ---------- 뷰 ----------
const BASE_Y = 3.4;   // 뷰의 STREAM_HEIGHT. 차례 물줄기의 y 스케일이 높이 기준이다.
const lookOf = (row: any, i: number) => { const g = row.g[i]; return g.dc !== 1 ? 'hidden' : g.at === 1 ? 'sealed' : i === row.pr ? (row.hd > 0 ? 'holding' : 'next') : 'waiting'; };
const ratioOf = (look: string, row: any, def: any) => (look === 'hidden' || look === 'sealed' ? 0 : look === 'waiting' ? .5 : look === 'next' ? 1 : Math.max(.15, 1 - row.hd / def.holdSeconds));
/** 상태에 맞는 렌더 인스턴스(기둥·물줄기·고리 세 mesh, 실제 뷰의 이름). 물줄기·고리 모두 반투명이고 인스턴스 색을 가진다. 상태는 이 파일이 직접 정한다. */
function visFor(row: any, def: any, over: any = {}) {
  const n = def.gates.length, cue = def.cueColor, next = K.mixWhite(cue, .45);
  const inst = (pick: (look: string) => any) => Array.from({ length: n }, (_, i) => pick(lookOf(row, i)));
  const ringColor: any = { sealed: 0xffd060, waiting: 0x8394ac, next, holding: cue, hidden: 0x000000 };
  const streamColor: any = { next, holding: cue, waiting: cue, sealed: cue, hidden: cue };
  return { found: true, by: 'name', meshes: [
    { name: 'TLL_BackflowValvePillars', count: n, transparent: false, mc: 0x6f8199, inst: inst(l => ({ s: l === 'hidden' ? [0, 0, 0] : [1, 1, 1], c: null })) },
    { name: 'TLL_BackflowValveStreams', count: n, transparent: true, mc: 0xffffff, inst: inst(l => ({ s: ratioOf(l, row, def) > 0 ? [1, BASE_Y * ratioOf(l, row, def), 1] : [0, 0, 0], c: streamColor[l] })) },
    { name: 'TLL_BackflowValveRings', count: n, transparent: true, mc: 0xffffff, inst: inst(l => ({ s: l === 'hidden' ? [0, 0, 0] : [1, 1, 1], c: ringColor[l] })) },
  ], ...over };
}
const PILLAR = 0, STREAM = 1, RING = 2;
function withViews(s: Sim, def: any, tamper?: (vis: any, row: any) => void) {
  // 각 봉인 3스텝 뒤와 유지 중간에 표본을 붙인다(프로브의 안정 키 규칙 대신, 행 상태에 맞는 스냅샷).
  for (const row of s.rows) {
    const stable = row.hd > 0 && row.hd >= .5 && row.n % 30 === 0 || row.mk === 'end' || row.mk === 'start' || (row.hd === 0 && row.g.some((g: any) => g.at === 1) && row.n % 7 === 0);
    if (!stable) continue;
    row.vw = { c: def.gates.length, d: 3 };
    row.vis = visFor(row, def);
    tamper?.(row.vis, row);
  }
  // 대기·다음 표본이 반드시 있도록 시작 이후 ready 행 하나에도 붙인다.
  const next = s.rows.find((row: any) => row.hd === 0 && row.pr === 0 && row.g[0].dc === 1 && row.g[0].rd === 1);
  if (next && !next.vis) { next.vw = { c: def.gates.length, d: 3 }; next.vis = visFor(next, def); }
  return s;
}
/** 세션 안에서 밸브 i 가 want 모습인 행 하나. */
const rowWith = (s: Sim, i: number, want: string) => s.rows.find((row: any) => row.g.length && lookOf(row, i) === want && (want !== 'holding' || row.hd >= .5));
const kinds = (r: any) => r.problems.map((p: any) => p.kind);
describe('뷰(checkView·checkLook)', () => {
  test('정상: count = 밸브 수·drawCalls ≤ 3·물줄기/고리가 기대 모습이면 통과하고 봉인·차례·대기 표본을 모두 봤다', () => {
    const v = K.checkView(withViews(deepSession(), DEEP).rows, DEEP, { waitingExpected: true });
    expect(v.ok).toEqual({ count: true, look: true });
    expect(v.coverage).toMatchObject({ sealed: true, live: true, waiting: true, next: true });
    expect(v.streamBase).toBe(BASE_Y);
    expect(v.ringColor).toBe('checked');
  });
  test('count 가 밸브 수와 다르거나 drawCalls 가 4 이상이면 count 판정이 실패한다', () => {
    const a = withViews(deepSession(), DEEP); a.rows.find((r: any) => r.vw).vw.c = 3;
    expect(K.checkView(a.rows, DEEP).ok.count).toBe(false);
    const b = withViews(deepSession(), DEEP); b.rows.find((r: any) => r.vw).vw.d = 4;
    expect(K.checkView(b.rows, DEEP).ok.count).toBe(false);
  });
  test('route.view 가 없는데 뷰가 있어야 하면(vw null) 실패한다', () => {
    const s = withViews(deepSession(), DEEP);
    s.rows.find((r: any) => r.vw).vw = null;
    expect(K.checkView(s.rows, DEEP).ok.count).toBe(false);
  });
  test('봉인된 밸브의 물줄기가 보이면 실패한다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[0].at === 1) vis.meshes[STREAM].inst[0].s = [1, 1, 1]; });
    const v = K.checkView(s.rows, DEEP);
    expect(v.ok.look).toBe(false);
    expect(v.mismatched[0].problems.some((p: any) => p.kind === 'stream-visible-after-seal')).toBe(true);
  });
  test('차례인 밸브의 물줄기가 숨겨져 있으면 실패한다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.pr === 1 && row.hd > 0) vis.meshes[STREAM].inst[1].s = [0, 0, 0]; });
    expect(K.checkView(s.rows, DEEP).ok.look).toBe(false);
  });
  test('봉인 고리가 금색이 아니거나 순서 대기 고리가 회색이 아니면 실패한다', () => {
    const a = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[0].at === 1) vis.meshes[RING].inst[0].c = 0x63e7dd; });
    expect(K.checkView(a.rows, DEEP).ok.look).toBe(false);
    const b = withViews(deepSession(), DEEP, (vis, row) => { if (row.pr >= 1 && row.g[3].dc === 1 && row.g[3].at === 0 && row.pr < 3) vis.meshes[RING].inst[3].c = 0xffd060; });
    expect(K.checkView(b.rows, DEEP).ok.look).toBe(false);
  });
  test('미발견 방의 밸브가 보이면 실패한다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[2].dc !== 1) vis.meshes[PILLAR].inst[2].s = [1, 1, 1]; });
    expect(K.checkView(s.rows, DEEP).ok.look).toBe(false);
  });
  test('인스턴스를 찾지 못하면 observable false 로 실패한다(통과로 숨기지 않는다)', () => {
    const s = withViews(deepSession(), DEEP);
    for (const row of s.rows) if (row.vis) row.vis = { found: false, by: null, meshes: [] };
    const v = K.checkView(s.rows, DEEP);
    expect(v.unobservable).toBeGreaterThan(0);
    expect(v.ok.look).toBe(false);
  });
  test('봉인 표본이 하나도 없으면 coverage 로 실패한다', () => {
    const s = withViews(deepSession(), DEEP);
    for (const row of s.rows) if (row.vis && row.g.some((g: any) => g.at === 1)) { delete row.vis; delete row.vw; }
    expect(K.checkView(s.rows, DEEP).ok.look).toBe(false);
  });
  test('expectedLook 는 관측값만으로 hidden/sealed/holding/next/waiting 을 구분한다', () => {
    const row: any = { pr: 1, hd: 0, g: [{ dc: 1, at: 1 }, { dc: 1, at: 0 }, { dc: 1, at: 0 }, { dc: 0, at: 0 }] };
    expect([0, 1, 2, 3].map(i => K.expectedLook(row, i))).toEqual(['sealed', 'next', 'waiting', 'hidden']);
    row.hd = .4;
    expect(K.expectedLook(row, 1)).toBe('holding');
  });

  // ---- 리뷰 P2-3: 고리 색과 물줄기 색을 이름별 메시로 따로 판정한다 ----
  describe('고리·물줄기 색 분리', () => {
    const s = deepSession();
    const next = rowWith(s, 0, 'next'), holding = rowWith(s, 0, 'holding'), waiting = rowWith(s, 3, 'waiting'), sealed = rowWith(s, 1, 'sealed');
    const cue = DEEP.cueColor, bright = K.mixWhite(cue, .45);
    /** 행의 밸브 i 인스턴스 하나만 바꾼 스냅샷을 판정한다. */
    const withInst = (row: any, i: number, mesh: number, patch: any) => { const vis = visFor(row, DEEP); Object.assign(vis.meshes[mesh].inst[i], patch); return K.checkLook(vis, row, DEEP, { streamBase: BASE_Y }); };
    test('정상 색: 차례 = 밝힌 청록(고리·물줄기), 유지 = cueColor, 대기 고리 = 회색·물줄기 = cueColor, 봉인 고리 = 금색', () => {
      for (const row of [next, holding, waiting, sealed]) expect(K.checkLook(visFor(row, DEEP), row, DEEP, { streamBase: BASE_Y })).toMatchObject({ ok: true, observable: true });
    });
    test('차례와 유지가 고리 색으로 구분된다: 유지 고리가 밝힌 색이거나 차례 고리가 cueColor 면 실패한다', () => {
      expect(kinds(withInst(holding, 0, RING, { c: bright }))).toEqual(['ring-color']);
      expect(kinds(withInst(next, 0, RING, { c: cue }))).toEqual(['ring-color']);
    });
    test('고리 색은 고리 메시만 본다: 물줄기 색이 맞아도 유지·차례 고리가 회색이거나 금색이면 실패한다(.some 오탐 퇴행)', () => {
      expect(kinds(withInst(holding, 0, RING, { c: 0x8394ac }))).toEqual(['ring-color']);
      expect(kinds(withInst(next, 0, RING, { c: 0x8394ac }))).toEqual(['ring-color']);
      expect(kinds(withInst(next, 0, RING, { c: 0xffd060 }))).toEqual(['ring-color']);
      expect(kinds(withInst(waiting, 3, RING, { c: cue }))).toEqual(['ring-color']);
      expect(kinds(withInst(sealed, 1, RING, { c: 0x8394ac }))).toEqual(['ring-color']);
    });
    test('물줄기 색은 물줄기 메시만 본다: 차례 물줄기가 cueColor 거나 유지·대기 물줄기가 밝은 색이면 실패한다', () => {
      expect(kinds(withInst(next, 0, STREAM, { c: cue }))).toEqual(['stream-color']);
      expect(kinds(withInst(holding, 0, STREAM, { c: bright }))).toEqual(['stream-color']);
      expect(kinds(withInst(waiting, 3, STREAM, { c: bright }))).toEqual(['stream-color']);
      expect(kinds(withInst(next, 0, STREAM, { c: null }))).toEqual(['stream-color']);
      expect(kinds(withInst(next, 0, RING, { c: null }))).toEqual(['ring-color']);
    });
    test('이름으로 고리·물줄기 메시를 못 찾으면 반투명 메시가 있어도 observable false 로 실패한다', () => {
      const noStream = visFor(next, DEEP); noStream.meshes[STREAM].name = 'TLL_Other';
      expect(K.checkLook(noStream, next, DEEP)).toMatchObject({ ok: false, observable: false });
      const noRing = visFor(next, DEEP); noRing.meshes[RING].name = 'TLL_Other';
      expect(K.checkLook(noRing, next, DEEP)).toMatchObject({ ok: false, observable: false });
      const onlyTransparentRing = visFor(next, DEEP); onlyTransparentRing.meshes.splice(STREAM, 1);   // 반투명 고리만 남아도 물줄기로 세지 않는다
      expect(K.checkLook(onlyTransparentRing, next, DEEP).observable).toBe(false);
      const t = withViews(deepSession(), DEEP, vis => { vis.meshes[STREAM].name = 'TLL_Other'; });
      const v = K.checkView(t.rows, DEEP);
      expect(v.unobservable).toBeGreaterThan(0);
      expect(v.ok.look).toBe(false);
    });
    // 면제는 정상 경로 하나뿐이다: cueColor 에 흰색을 섞은 색(뷰의 color(cue).lerp(white, t)).
    test('흰색 섞음 면제는 띠 안의 색만 받는다: 유지·대기 t < .1, 차례 t ∈ [.2, .6]', () => {
      expect(K.mixWhite(cue, 0)).toBe(cue);
      expect(K.inWhiteBand(K.mixWhite(cue, 0), cue, K.WHITE_MIX.plain)).toBe(true);
      expect(K.inWhiteBand(K.mixWhite(cue, .05), cue, K.WHITE_MIX.plain)).toBe(true);
      for (const t of [.2, .45, .6]) expect(K.inWhiteBand(K.mixWhite(cue, t), cue, K.WHITE_MIX.next)).toBe(true);
      expect(K.inWhiteBand(0xbff1ed, cue, K.WHITE_MIX.next)).toBe(true);           // smoke 에서 관측한 실제 차례 색
      expect(K.inWhiteBand(K.mixWhite(cue, .45), cue, K.WHITE_MIX.plain)).toBe(false);
      expect(K.inWhiteBand(cue, cue, K.WHITE_MIX.next)).toBe(false);
      expect(K.inWhiteBand(K.mixWhite(cue, .15), cue, K.WHITE_MIX.next)).toBe(false);   // 두 띠 사이
      expect(K.inWhiteBand(K.mixWhite(cue, .15), cue, K.WHITE_MIX.plain)).toBe(false);
      expect(K.inWhiteBand(K.mixWhite(cue, .7), cue, K.WHITE_MIX.next)).toBe(false);
      expect(K.inWhiteBand(0x8394ac, cue, K.WHITE_MIX.next)).toBe(false);
      expect(K.inWhiteBand(0xffd060, cue, K.WHITE_MIX.plain)).toBe(false);
      expect(K.inWhiteBand(undefined, cue, K.WHITE_MIX.plain)).toBe(false);
    });
  });

  // ---- 리뷰 P3: 물줄기 높이 · 심층 대기 표본 ----
  describe('물줄기 높이와 대기 표본', () => {
    const s = deepSession();
    const next = rowWith(s, 0, 'next'), holding = rowWith(s, 0, 'holding'), waiting = rowWith(s, 3, 'waiting');
    /** 밸브 i 의 물줄기 y 스케일을 기준(BASE_Y)의 ratio 배로 바꾸고 판정한다. */
    const heightAt = (row: any, i: number, ratio: number, base: any = BASE_Y) => { const vis = visFor(row, DEEP); vis.meshes[STREAM].inst[i].s = [1, BASE_Y * ratio, 1]; return K.checkLook(vis, row, DEEP, { streamBase: base }); };
    test('정상: 대기 .5 · 유지 max(.15, 1 − hold/holdSeconds) · 차례 1 배', () => {
      expect(holding.hd).toBeGreaterThanOrEqual(.5);
      expect(heightAt(waiting, 3, .5).ok).toBe(true);
      expect(heightAt(holding, 0, 1 - holding.hd / DEEP.holdSeconds).ok).toBe(true);
      expect(heightAt(next, 0, 1).ok).toBe(true);
    });
    test('대기 물줄기가 .5 배가 아니면 실패한다(±.03 경계 포함)', () => {
      expect(heightAt(waiting, 3, .52).ok).toBe(true);
      expect(heightAt(waiting, 3, .48).ok).toBe(true);
      expect(kinds(heightAt(waiting, 3, .54))).toEqual(['stream-height']);
      expect(kinds(heightAt(waiting, 3, 1))).toEqual(['stream-height']);
      expect(kinds(heightAt(waiting, 3, .25))).toEqual(['stream-height']);
    });
    test('유지 중 물줄기는 그 표본 행의 hold 로 줄어든다: 안 줄었거나 너무 줄었으면 실패한다', () => {
      const want = 1 - holding.hd / DEEP.holdSeconds;
      expect(kinds(heightAt(holding, 0, 1))).toEqual(['stream-height']);
      expect(kinds(heightAt(holding, 0, want - .05))).toEqual(['stream-height']);
      expect(kinds(heightAt(holding, 0, want + .05))).toEqual(['stream-height']);
      // 다른 표본 행의 hold(예: 막 시작한 유지)의 높이를 쓰면 실패한다.
      expect(kinds(heightAt(holding, 0, 1 - .1 / DEEP.holdSeconds))).toEqual(['stream-height']);
    });
    test('유지가 끝에 가까우면 최소 .15 배에서 멈춘다', () => {
      const late: any = { ...holding, hd: DEEP.holdSeconds - FRAME };
      expect(heightAt(late, 0, .15).ok).toBe(true);
      expect(kinds(heightAt(late, 0, .3))).toEqual(['stream-height']);
      expect(kinds(heightAt(late, 0, 0.001))).toEqual(['stream-height']);
    });
    test('차례 표본의 물줄기가 기준보다 낮으면 실패하고, 기준이 없으면(차례 표본 없음) 대기·유지 표본이 실패한다', () => {
      expect(kinds(heightAt(next, 0, .5))).toEqual(['stream-height']);
      expect(kinds(heightAt(waiting, 3, .5, null))).toEqual(['no-height-reference']);
      expect(kinds(heightAt(holding, 0, 1 - holding.hd / DEEP.holdSeconds, null))).toEqual(['no-height-reference']);
      // 기준을 생략(undefined)하면 높이는 보지 않는다 — checkView 와 screens 는 항상 기준을 넘긴다.
      const vis = visFor(waiting, DEEP); vis.meshes[STREAM].inst[3].s = [1, BASE_Y, 1];
      expect(K.checkLook(vis, waiting, DEEP).ok).toBe(true);
    });
    test('streamBase 는 같은 런 차례 표본 물줄기 y 스케일의 최댓값이고 차례 표본이 없으면 null 이다', () => {
      expect(K.streamBase([{ vis: visFor(next, DEEP), row: next }, { vis: visFor(waiting, DEEP), row: waiting }], DEEP)).toBe(BASE_Y);
      expect(K.streamBase([{ vis: visFor(waiting, DEEP), row: waiting }, { vis: visFor(holding, DEEP), row: holding }], DEEP)).toBeNull();
      expect(K.streamBase([], DEEP)).toBeNull();
    });
    test('checkView: 같은 런에 차례 표본이 없으면 높이 기준이 없어 실패하고, 낮은 차례 물줄기 하나가 섞이면 실패한다', () => {
      const a = withViews(deepSession(), DEEP);
      for (const row of a.rows) if (row.vis && row.g.some((_: any, i: number) => lookOf(row, i) === 'next')) { delete row.vis; delete row.vw; }
      const va = K.checkView(a.rows, DEEP);
      expect(va.streamBase).toBeNull();
      expect(va.coverage.next).toBe(false);
      expect(va.ok.look).toBe(false);
      const b = withViews(deepSession(), DEEP, (vis, row) => { if (row.mk === 'end') return; if (row.hd > 0 && lookOf(row, row.pr) === 'holding') vis.meshes[STREAM].inst[row.pr].s = [1, BASE_Y, 1]; });
      expect(K.checkView(b.rows, DEEP).mismatched[0].problems.some((p: any) => p.kind === 'stream-height')).toBe(true);
    });
    test('심층(순서 대기 시나리오)은 대기 표본이 합격 조건이고, 대기 표본이 없는 일반은 요구하지 않는다', () => {
      const s2 = withViews(deepSession(), DEEP);
      for (const row of s2.rows) if (row.vis && row.g.some((_: any, i: number) => lookOf(row, i) === 'waiting')) { delete row.vis; delete row.vw; }
      const v = K.checkView(s2.rows, DEEP, { waitingExpected: true });
      expect(v.coverage.waiting).toBe(false);
      expect(v.ok.look).toBe(false);
      expect(K.checkView(s2.rows, DEEP, { waitingExpected: false }).ok.look).toBe(true);
      expect(K.checkView(withViews(deepSession(), DEEP).rows, DEEP, { waitingExpected: true }).ok.look).toBe(true);
    });
    test('analyzeValves 는 심층(expectWaiting)에서만 viewLook 에 대기 표본을 요구한다', () => {
      const s2 = withViews(deepSession(), DEEP);
      for (const row of s2.rows) if (row.vis && row.g.some((_: any, i: number) => lookOf(row, i) === 'waiting')) { delete row.vis; delete row.vw; }
      expect(failing(run(s2, DEEP, { viewAB: goodAB() }, { viewExpected: true }))).toEqual(['viewLook']);
      expect(failing(run(s2, DEEP, { viewAB: goodAB() }, { viewExpected: true, expectWaiting: false }))).toEqual([]);
    });
  });

  test('analyzeValves 는 viewExpected 일 때만 뷰 항목을 판정한다', () => {
    const s = withViews(deepSession(), DEEP);
    expect(Object.keys(run(s, DEEP, { viewAB: goodAB() }, { viewExpected: true }).acceptance)).toEqual(expect.arrayContaining(['viewCount', 'viewLook', 'viewGpu']));
    expect(Object.keys(run(s).acceptance)).not.toContain('viewLook');
    expect(run(s, DEEP, { viewAB: goodAB() }, { viewExpected: true }).ok).toBe(true);
  });
});

// ---------- 뷰 실제 draw call A/B ----------
/** A/B 표본 하나: 모습이 바뀐 밸브 changed 의 직후, 그룹 켠 채 on·끈 채 off 렌더 calls, 뷰가 주장한 drawCalls = viewCalls. */
const abSample = (pr: number, hd: number, changed: number[], viewCalls: number, on: number, off: number, over: any = {}) => ({
  n: 100 + pr * 10, t: 1, pr, hd, changed, viewCalls, on, off,
  g: [{ dc: 1, at: pr > 0 ? 1 : 0 }, { dc: 1, at: 0 }, { dc: 0, at: 0 }, { dc: 0, at: 0 }], ...over });
/** 통과 표본: 차례(밸브 0) → 유지 → 봉인 직후. 기둥·물줄기·고리 3 call 이 뷰의 몫이고 나머지 장면은 90 call 이다. */
const goodAB = () => [abSample(0, 0, [0], 2, 92, 90), abSample(0, .5, [0], 3, 93, 90), abSample(1, 0, [0], 2, 92, 90), abSample(1, 0, [1], 3, 93, 90)];
describe('뷰 실제 draw call A/B(checkViewGpu, C 제어 렌더)', () => {
  test('정상: 표본 ≥ 3(차례·유지·봉인 포함)·viewGpuCalls ≤ 3·route.view.drawCalls 와 같으면 통과하고 최댓값을 보고한다', () => {
    const g = K.checkViewGpu(goodAB());
    expect(g).toMatchObject({ ok: true, classification: 'C', samples: 4, max: 3, reason: null });
    expect(g.coverage).toEqual({ next: true, holding: true, sealed: true });
    expect(g.rows.map((r: any) => r.viewGpuCalls)).toEqual([2, 3, 2, 3]);
  });
  test('표본이 없으면 "표본 없음"(no-samples)으로 실패한다(smoke 기록처럼 A/B 가 없던 report)', () => {
    expect(K.checkViewGpu([])).toMatchObject({ ok: false, reason: 'no-samples', samples: 0, max: null });
    expect(K.checkViewGpu(undefined)).toMatchObject({ ok: false, reason: 'no-samples' });
  });
  test('실제 draw call 이 상한 3 을 넘으면 실패한다(재질 두 번 그리기 퇴행: 물줄기 2 + 고리 2 + 기둥 1 = 5)', () => {
    const bad = goodAB(); bad[1] = abSample(0, .5, [0], 5, 95, 90);
    const g = K.checkViewGpu(bad);
    expect(g).toMatchObject({ ok: false, reason: 'mismatch-or-over-limit', max: 5 });
    expect(g.bad[0]).toMatchObject({ viewGpuCalls: 5, within: false, matches: true });
  });
  test('뷰가 주장한 drawCalls 와 실제 차이가 다르면 실패한다(거짓 보고): 주장 ≤ 3 이어도 실제가 더 크거나 작으면', () => {
    const lie = goodAB(); lie[1] = abSample(0, .5, [0], 3, 94, 90);       // 주장 3, 실제 4
    expect(K.checkViewGpu(lie)).toMatchObject({ ok: false });
    expect(K.checkViewGpu(lie).bad[0]).toMatchObject({ claimed: 3, viewGpuCalls: 4, matches: false });
    const under = goodAB(); under[0] = abSample(0, 0, [0], 3, 91, 90);    // 주장 3, 실제 1
    expect(K.checkViewGpu(under).ok).toBe(false);
  });
  test('주장이 0 인 표본도 기록됐다면 실제 차이가 0 이어야 한다(안 그리는 척 그리는 뷰를 잡는다)', () => {
    const zero = [...goodAB(), abSample(0, 0, [2], 0, 91, 90)];
    expect(K.checkViewGpu(zero).ok).toBe(false);
    const honest = [...goodAB(), abSample(0, 0, [2], 0, 90, 90)];
    expect(K.checkViewGpu(honest)).toMatchObject({ ok: true, samples: 4, recorded: 5 });   // 주장 0 인 표본은 개수에 세지 않는다
  });
  test('표본이 3개 미만이면 실패한다', () => {
    expect(K.checkViewGpu(goodAB().slice(0, 2))).toMatchObject({ ok: false, reason: 'too-few-samples' });
    expect(K.checkViewGpu(goodAB().slice(0, 3)).ok).toBe(true);
  });
  test('차례·유지·봉인 중 한 모습이 바뀐 직후 표본이 없으면 실패한다', () => {
    const noSealed = goodAB().filter(s => !(s.pr === 1)).concat([abSample(0, 0, [0], 2, 92, 90), abSample(0, 0, [0], 2, 92, 90)]);
    expect(K.checkViewGpu(noSealed)).toMatchObject({ ok: false, reason: 'coverage', coverage: { sealed: false } });
    const noHolding = goodAB().filter(s => s.hd === 0).concat([abSample(0, 0, [0], 2, 92, 90)]);
    expect(K.checkViewGpu(noHolding).coverage.holding).toBe(false);
    const noNext = [abSample(0, .5, [0], 3, 93, 90), abSample(1, 0, [0], 2, 92, 90), abSample(0, .7, [0], 3, 93, 90)];
    expect(K.checkViewGpu(noNext)).toMatchObject({ ok: false, reason: 'coverage', coverage: { next: false, holding: true, sealed: true } });
  });
  test('렌더 calls 를 못 읽은 표본(on·off null, group 없음)은 실패한다', () => {
    const missing = goodAB(); missing[0] = abSample(0, 0, [0], 2, null as any, null as any);
    expect(K.checkViewGpu(missing)).toMatchObject({ ok: false });
    expect(K.checkViewGpu(missing).bad[0].viewGpuCalls).toBeNull();
  });
  test('analyzeValves: A/B 표본이 없으면 viewGpu 한 항목만 실패한다', () => {
    const s = withViews(deepSession(), DEEP);
    expect(failing(run(s, DEEP, {}, { viewExpected: true }))).toEqual(['viewGpu']);
    const d = run(s, DEEP, { viewAB: goodAB() }, { viewExpected: true });
    expect(d.view.gpu).toMatchObject({ ok: true, max: 3 });
    expect(failing(run(s, DEEP, { viewAB: goodAB().map(x => ({ ...x, on: x.on + 2 })) }, { viewExpected: true }))).toEqual(['viewGpu']);
  });
});

// ---------- order 프로필 ----------
/** PLAN 6절 order: AUTO 로 progress 2·방 5 ready → AUTO 끔 → 방 5 중심 3초(순서 대기) → AUTO 켬 → progress 3 → AUTO 끔 → 방 5 유지 1초 → 이탈 → 재진입 → 봉인. */
function orderSession(over: any = {}) {
  const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS);
  s.clear(0); s.hold(0); s.seal(0);
  s.clear(1); s.hold(1); s.seal(1);
  s.rem -= s.extra;
  s.waitFor(3);
  s.au = 0; s.mark('manual1-start');
  s.place(3, 1.2, 0); s.mark('wait-start');
  const waitSteps = over.waitSteps ?? 180;
  for (let k = 0; k < waitSteps; k++) { if (over.attackDuringWait && k === 90) s.ah = 1; s.step(); }
  s.ah = 0;
  if (over.leaveDuringWait) { s.place(3, 5, 0); s.step(); }
  s.mark('wait-end');
  s.au = 1;
  s.clear(2); s.hold(2); s.seal(2);
  s.au = 0; s.mark('manual2-start');
  s.place(3, 1.2, 0);
  s.hold(3, { rows: over.partialRows ?? 70, dom: false });
  if (over.noExit) { s.hold(3, { rows: 49, dom: false }); }
  s.place(3, 4, 0); s.hd = 0; s.step();
  s.step(); s.mark('exit');
  s.place(3, 1.2, 0);
  s.hold(3, { rows: over.finalRows ?? 119, dom: false, hdScale: over.finalScale ?? 1 });
  s.seal(3);
  s.mark('manual2-end');
  s.au = 1;
  s.unseal(); s.mark('end');
  return s;
}
const orderOf = (s: Sim) => K.analyzeOrder(s.rows, DEEP, { rooms: DEEP_ROOMS, waitSeconds: 3 });
describe('order 프로필(analyzeOrder)', () => {
  test('정상: 순서 대기 3초 → 유지 ≥ 1초 뒤 이탈(hold 0) → 재진입 새 유지로 봉인', () => {
    const o = orderOf(orderSession());
    expect(o.wait.ok).toBe(true);
    expect(o.final.ok).toBe(true);
    expect(o.final.abortedMax).toBeGreaterThanOrEqual(1);
    expect(o.final.keyboard.ok).toBe(true);
    expect(o.ok).toBe(true);
  });
  test('순서 대기가 3초보다 짧으면 실패한다', () => {
    expect(orderOf(orderSession({ waitSteps: 60 })).wait.ok).toBe(false);
  });
  test('대기 중 영웅이 반경 밖으로 나가거나 progress/cleared 가 변하면 실패한다', () => {
    expect(orderOf(orderSession({ leaveDuringWait: true })).wait.ok).toBe(false);
    const s = orderSession();
    const a = K.analyzeOrder(s.rows.map((r: any) => (r.mk === 'wait-end' ? { ...r, pr: 3 } : r)), DEEP, { rooms: DEEP_ROOMS });
    expect(a.wait.ok).toBe(false);
    const b = orderSession();
    for (const r of b.rows) if (r.mk === 'wait-end') r.g = r.g.map((g: any, i: number) => (i === 3 ? { ...g, cl: 1 } : g));
    expect(orderOf(b).wait.ok).toBe(false);
  });
  test('공격 입력이나 AUTO 가 켜진 행이 키보드 구간에 있으면 실패한다', () => {
    expect(orderOf(orderSession({ attackDuringWait: true })).wait.keyboard.ok).toBe(false);
    const s = orderSession();
    const i = s.rows.findIndex((r: any) => r.mk === 'manual2-start');
    s.rows[i + 3].au = 1;
    expect(orderOf(s).final.keyboard.ok).toBe(false);
    const t = orderSession();
    t.rows[t.rows.findIndex((r: any) => r.mk === 'manual2-start') + 20].ps = 'attack';
    expect(orderOf(t).final.keyboard.ok).toBe(false);
  });
  test('이탈이 없거나(유지 1초 미만으로 바로 봉인) 부분 유지가 1초 미만이면 final 이 실패한다', () => {
    expect(orderOf(orderSession({ partialRows: 30 })).final.ok).toBe(false);
  });
  test('재진입 유지가 holdSeconds − 1/60 보다 짧으면 실패한다', () => {
    expect(orderOf(orderSession({ finalRows: 80 })).final.ok).toBe(false);
  });
  test('재진입 유지의 hold 를 엔진이 2배로 쌓아 1초 만에 2.0 이 되면 게임 시각 기준으로 실패한다', () => {
    const o = orderOf(orderSession({ finalRows: 60, finalScale: 2 }));
    expect(o.final.ok).toBe(false);
    expect(orderOf(orderSession()).final.sealSpan).toBeGreaterThanOrEqual(DEEP.holdSeconds - FRAME - 1e-6);
  });
  test('표식이 없으면 missing-marks 로 실패한다', () => {
    const s = orderSession();
    const a = K.analyzeOrder(s.rows.filter((r: any) => r.mk !== 'exit'), DEEP, { rooms: DEEP_ROOMS });
    expect(a).toMatchObject({ ok: false, reason: 'missing-marks', missing: ['exit'] });
  });
  test('checkKeyboardSegment 는 영웅이 쓰러진 구간을 실패로 본다', () => {
    const s = orderSession();
    s.rows.find((r: any) => r.mk === 'wait-start').hp = 0;
    expect(K.checkKeyboardSegment(s.rows, 'manual1-start', 'wait-end').ok).toBe(false);
  });
});

// ---------- pause 프로필 ----------
const fz = (over: any = {}) => ({ elapsed: 10, paused: false, pr: 0, hd: 0, ...over });
describe('pause 프로필', () => {
  const frozen = () => ({ before: fz({ hd: .85 }), paused: fz({ paused: true }), still: fz({ paused: true }), resumed: fz({ elapsed: 10 + 30 * FRAME, hd: 30 * FRAME }), steps: 30 });
  test('정지 중 게임 시간 불변·hold 0 → 재개 뒤 0 에서 새로 시작하면 통과', () => {
    expect(K.checkPause(frozen()).ok).toBe(true);
  });
  test('정지 직후 hold 가 남아 있거나 시간이 흐르면 frozen 이 실패한다', () => {
    expect(K.checkPause({ ...frozen(), paused: fz({ hd: .85 }) }).frozen).toBe(false);
    expect(K.checkPause({ ...frozen(), still: fz({ elapsed: 10 + 2 }) }).frozen).toBe(false);
    expect(K.checkPause({ ...frozen(), before: fz({ hd: .3 }) }).frozen).toBe(false);
  });
  test('재개 뒤 hold 가 이어졌거나(0.85 + …) progress 가 바뀌면 resumedOk 가 실패한다', () => {
    expect(K.checkPause({ ...frozen(), resumed: fz({ elapsed: 10 + 30 * FRAME, hd: .85 + 30 * FRAME }) }).resumedOk).toBe(false);
    expect(K.checkPause({ ...frozen(), resumed: fz({ elapsed: 10 + 30 * FRAME, pr: 1, hd: 0 }) }).resumedOk).toBe(false);
  });
  /** 정지 전 부분 유지(hd .85) → 재개(표식) → 새 유지로 봉인. */
  function pauseSession(over: any = {}) {
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS);
    s.clear(0);
    s.hold(0, { rows: 51, dom: false });
    s.hd = 0; s.mark('resume');
    s.hold(0, { rows: over.rows ?? 119 });
    s.seal(0);
    return s;
  }
  test('재개 이후 새 유지 ≥ 2초 − 1/60 로 봉인하면 통과', () => {
    expect(K.analyzePauseSeal(pauseSession().rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(true);
  });
  test('재개 뒤 유지가 짧으면 실패하고, 표식이 없거나 재개 뒤 봉인이 없으면 이유가 남는다', () => {
    expect(K.analyzePauseSeal(pauseSession({ rows: 70 }).rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
    expect(K.analyzePauseSeal(pauseSession().rows.filter((r: any) => r.mk !== 'resume'), DEEP, { rooms: DEEP_ROOMS }).reason).toBe('missing-mark');
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS); s.clear(0); s.mark('resume');
    expect(K.analyzePauseSeal(s.rows, DEEP, { rooms: DEEP_ROOMS }).reason).toBe('no-seal-after-resume');
  });
});

// ---------- screens 프로필 ----------
describe('screens 프로필', () => {
  test('모든 순간에 도달해 viewport 개수만큼 PNG 가 있어야 통과한다', () => {
    const shots = [{ label: 'next', reached: true, files: ['a', 'b', 'c'] }, { label: 'holding', reached: true, files: ['a', 'b', 'c'] }];
    expect(K.checkScreens(shots, ['next', 'holding'], 3).ok).toBe(true);
    expect(K.checkScreens(shots, ['next', 'holding', 'sealed'], 3).ok).toBe(false);
    expect(K.checkScreens([{ label: 'next', reached: true, files: ['a'] }], ['next'], 3).ok).toBe(false);
    expect(K.checkScreens([{ label: 'next', reached: false }], ['next'], 3).ok).toBe(false);
    expect(K.checkScreens([], [], 3).ok).toBe(false);
  });
  const stateRow = (over: any = {}) => ({ pr: 1, hd: 0, g: [{ dc: 1, at: 1 }, { dc: 1, at: 0 }, { dc: 1, at: 0 }, { dc: 1, at: 0 }], ...over });
  test('순간의 밸브 상태가 라벨이 가리키는 기대 모습과 같아야 하고, 뷰가 있으면 렌더된 인스턴스도 같아야 한다', () => {
    const stop = stateRow(), shot: any = { stop, capture: stateRow() };
    expect(K.checkScreenMoment(shot, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: false }).ok).toBe(true);
    expect(K.checkScreenMoment(shot, DEEP, { gate: 0, look: 'next' }, { viewExpected: false }).ok).toBe(false);
    stop.vis = visFor(stop, DEEP); shot.capture.vis = visFor(shot.capture, DEEP);
    expect(K.checkScreenMoment(shot, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: true }).ok).toBe(true);
    shot.stop.vis.meshes[STREAM].inst[0].s = [1, 1, 1]; shot.capture.vis.meshes[STREAM].inst[0].s = [1, 1, 1];
    expect(K.checkScreenMoment(shot, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: true }).ok).toBe(false);
  });
  // 2b4ea65 에서 뷰 갱신 지연이 없어졌으므로 정지 행이 맞고 촬영 행이 틀린 순간은 통과하지 못한다.
  const nextRow = () => stateRow({ pr: 0, g: stateRow().g.map((g: any, i: number) => (i === 0 ? { dc: 1, at: 0 } : g)) });
  test('촬영 행의 밸브 상태가 기대 모습과 같아야 한다: 정지 행만 맞으면 실패한다', () => {
    const stop = nextRow(), capture = stateRow();   // 정지 시점은 차례, 촬영 시점은 봉인
    expect(K.checkScreenMoment({ stop, capture }, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: false }).ok).toBe(true);
    expect(K.checkScreenMoment({ stop, capture }, DEEP, { gate: 0, look: 'next' }, { viewExpected: false })).toMatchObject({ ok: false, stateOk: false });
    expect(K.checkScreenMoment({ stop: capture, capture: stop }, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: false }).ok).toBe(false);
    expect(K.checkScreenMoment({ stop }, DEEP, { gate: 0, look: 'next' }, { viewExpected: false }).ok).toBe(false);   // 촬영 행 없음
  });
  test('뷰: 촬영 행의 렌더 인스턴스가 기대 모습이어야 한다: 정지 행 인스턴스만 맞거나 촬영 행에 스냅샷이 없으면 실패한다', () => {
    const stop = stateRow(), capture = stateRow();
    stop.vis = visFor(stop, DEEP); capture.vis = visFor(capture, DEEP);
    capture.vis.meshes[STREAM].inst[0].s = [1, 1, 1];   // 봉인인데 물줄기가 보인다
    expect(K.checkScreenMoment({ stop, capture }, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: true })).toMatchObject({ ok: false, stateOk: true });
    const bare = stateRow();
    expect(K.checkScreenMoment({ stop, capture: bare }, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: true })).toMatchObject({ ok: false, looks: [] });
  });
  test('뷰: 물줄기 높이는 같은 런의 차례 표본 기준(streamBase)으로 촬영 행에서 판정한다', () => {
    const capture: any = stateRow({ pr: 1, hd: 1.0 }), shot: any = { stop: capture, capture };
    capture.vis = visFor(capture, DEEP);   // 밸브 1 은 hold 1.0 유지 → 높이 .5 배
    expect(K.checkScreenMoment(shot, DEEP, { gate: 1, look: 'holding' }, { viewExpected: true, streamBase: BASE_Y }).ok).toBe(true);
    capture.vis.meshes[STREAM].inst[1].s = [1, BASE_Y, 1];
    expect(K.checkScreenMoment(shot, DEEP, { gate: 1, look: 'holding' }, { viewExpected: true, streamBase: BASE_Y }).ok).toBe(false);
    expect(K.checkScreenMoment(shot, DEEP, { gate: 1, look: 'holding' }, { viewExpected: true, streamBase: null }).ok).toBe(false);
  });
});

// ---------- 기준선 비교 ----------
const sample = (roomId: number, calls: number) => ({ label: 'roomEnter', roomId, calls });
const cmp = (over: any = {}) => ({ time: 100, samples: [sample(2, 30), sample(4, 31), sample(7, 30), sample(5, 32)], runOver50: 3, valveRooms: [2, 4, 7, 5], ...over });
describe('기준선 비교', () => {
  test('방 첫 진입 draw call 증가 ≤ 3(짝 있는 방만)이고 짝이 하나도 없으면 실패한다', () => {
    const base = [sample(2, 27), sample(4, 28), sample(7, 27), sample(5, 29)];
    const a = K.roomDrawCalls(cmp().samples, base, [2, 4, 7, 5]);
    expect(a).toMatchObject({ ok: true, matched: 4, maxIncrease: 3 });
    const b = K.roomDrawCalls([sample(2, 31), ...cmp().samples.slice(1)], base, [2, 4, 7, 5]);
    expect(b.ok).toBe(false);
    expect(b.pairs[0]).toMatchObject({ increase: 4, ok: false });
    const c = K.roomDrawCalls(cmp().samples, [sample(2, 27)], [2, 4, 7, 5]);
    expect(c.matched).toBe(1);
    expect(c.ok).toBe(true);
    expect(K.roomDrawCalls(cmp().samples, [sample(1, 20)], [2, 4, 7, 5])).toMatchObject({ ok: false, matched: 0 });
    expect(K.roomDrawCalls(cmp().samples, [], [])).toMatchObject({ ok: false, matched: 0 });
  });
  test('완주 시간 비 ≤ 2.0 이고 비 자체가 숫자로 남으며 일반의 1.00 ± 0.05 는 parity 보고 항목이다', () => {
    const base = { time: 100, samples: [sample(2, 30), sample(4, 31), sample(7, 30), sample(5, 32)], runOver50: 3 };
    const ok = K.compareRuns(cmp({ time: 200 }), base);
    expect(ok.time).toMatchObject({ ratio: 2, ok: true });
    expect(ok.time.parity.within).toBe(false);
    expect(K.compareRuns(cmp({ time: 201 }), base).time.ok).toBe(false);
    const near = K.compareRuns(cmp({ time: 104 }), base);
    expect(near.time.parity.within).toBe(true);
    expect(near.ok).toBe(true);
    expect(K.compareRuns(cmp({ time: null }), base).time.ok).toBe(false);
  });
  test('전체 런 50ms 초과 수는 기준선 + 2 까지 허용한다', () => {
    const base = { time: 100, samples: cmp().samples, runOver50: 3 };
    expect(K.compareRuns(cmp({ runOver50: 5 }), base).slow.ok).toBe(true);
    expect(K.compareRuns(cmp({ runOver50: 6 }), base).slow.ok).toBe(false);
    expect(K.compareRuns(cmp({ runOver50: null }), base).slow.ok).toBe(false);
  });
  test('전체 런 50ms 초과 보고 항목: 1000 스텝당 초과율과 스텝 수를 양쪽 다 남기되 게이트(기준선 + 2)는 그대로다', () => {
    const base = { time: 100, samples: cmp().samples, runOver50: 3, steps: 7100 };
    const r = K.compareRuns(cmp({ runOver50: 5, steps: 9500 }), base);
    expect(r.slow.report.steps).toEqual({ cand: 9500, base: 7100 });
    expect(r.slow.report.per1000.cand).toBeCloseTo(5 / 9500 * 1000, 9);
    expect(r.slow.report.per1000.base).toBeCloseTo(3 / 7100 * 1000, 9);
    expect(r.slow.ok).toBe(true);
    expect(K.compareRuns(cmp({ runOver50: 6, steps: 90000 }), base).slow.ok).toBe(false);   // 스텝 수가 많아 초과율이 낮아도 완화되지 않는다
    expect(K.compareRuns(cmp({ runOver50: 3 }), base).slow.report.per1000.cand).toBeNull();   // 스텝 수가 없으면 null
    expect(K.overPer1000(4, 0)).toBeNull();
  });
  test('후보의 뷰 A/B 최댓값은 보고 항목이고 비교 게이트(시간 비·draw call·50ms)에 영향을 주지 않는다', () => {
    const base = { time: 100, samples: cmp().samples, runOver50: 3 };
    expect(K.compareRuns(cmp({ viewGpuMax: 3 }), base).viewGpu).toMatchObject({ candidateMax: 3, limit: 3 });
    expect(K.compareRuns(cmp({ viewGpuMax: 9 }), base).ok).toBe(K.compareRuns(cmp(), base).ok);
    expect(K.compareRuns(cmp(), base).viewGpu.candidateMax).toBeNull();
  });
  const setupOf = (over: any = {}) => ({ heroId: 'knight', seed: 20261015, depth: 'deep', reseedOn: true, viewport: { width: 844, height: 390 }, motion: 'reduce', quality: 'default', ...over });
  test('설정 일치: 영웅·시드·depth·재시드에 viewport·motion·quality 도 같아야 비교가 성립한다', () => {
    expect(K.compareSetup(setupOf(), setupOf()).ok).toBe(true);
    for (const over of [{ heroId: 'mage' }, { seed: 1 }, { depth: 'standard' }, { reseedOn: false }, { viewport: { width: 390, height: 844 } }, { motion: 'no-preference' }, { quality: 'low' }]) {
      const r = K.compareSetup(setupOf(), setupOf(over));
      expect(r.ok).toBe(false);
      expect(Object.values(r.same).filter(v => !v).length).toBe(1);
    }
  });
  test('설정 일치: 값이 없는 report(null)는 같다고 보지 않고, 시드 0 과 재시드 false 는 값으로 본다', () => {
    expect(K.compareSetup(setupOf({ viewport: null }), setupOf({ viewport: null })).same.viewport).toBe(false);
    expect(K.compareSetup(setupOf({ quality: undefined }), setupOf({ quality: undefined })).same.quality).toBe(false);
    expect(K.compareSetup(setupOf({ seed: 0, reseedOn: false }), setupOf({ seed: 0, reseedOn: false })).ok).toBe(true);
  });
  const reports = (over: any = {}) => ({ cand: { routeDefinition: true, viewDefined: true, valvesOk: true, status: 'pass', runStatus: 'pass', ...over.cand },
    base: { routeDefinition: false, viewDefined: false, valvesOk: null, status: 'pass', runStatus: 'pass', ...over.base } });
  test('심층: 기준선에 정의가 없고 후보에 있으며 양쪽 pass·후보 밸브 판정 통과여야 한다', () => {
    const { cand, base } = reports();
    expect(K.compareTargetsOk(cand, base, 'deep')).toBe(true);
    expect(K.compareTargetsOk(base, cand, 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand, { ...base, routeDefinition: true }, 'deep')).toBe(false);
    expect(K.compareTargetsOk({ ...cand, valvesOk: false }, base, 'deep')).toBe(false);
    expect(K.compareTargetsOk({ ...cand, status: 'fail' }, base, 'deep')).toBe(false);
    expect(K.compareTargetsOk(cand, { ...base, runStatus: 'fail' }, 'deep')).toBe(false);
    expect(K.compareTargetsOk(null, base, 'deep')).toBe(false);
  });
  test('일반: 둘 다 정의가 있되 기준선에는 view 가 없고 후보에는 있어야 한다', () => {
    const { cand, base } = reports({ base: { routeDefinition: true } });
    expect(K.compareTargetsOk(cand, base, 'standard')).toBe(true);
    expect(K.compareTargetsOk(cand, { ...base, viewDefined: true }, 'standard')).toBe(false);
    expect(K.compareTargetsOk({ ...cand, viewDefined: false }, base, 'standard')).toBe(false);
    expect(K.compareTargetsOk(cand, { ...base, routeDefinition: false }, 'standard')).toBe(false);
  });
});

describe('통계 보조', () => {
  test('percentile·stepStats', () => {
    expect(K.percentile([], .5)).toBeNull();
    expect(K.percentile([5, 1, 3], .5)).toBe(3);
    expect(K.stepStats([1, 60, 70, 2], 50)).toMatchObject({ n: 4, over: 2, max: 70 });
    expect(K.stepStats([])).toMatchObject({ n: 0, over: 0, max: null });
  });
});
