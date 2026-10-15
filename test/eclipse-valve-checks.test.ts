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
  hold(i: number, { rows = Math.round(this.def.holdSeconds / FRAME) - 1, dx = 0, dz = 0, dom = true, domText }: any = {}) {
    this.place(i, dx, dz);
    for (let k = 1; k <= rows; k++) {
      this.hd = k * FRAME;
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
  test('연속 스텝의 hd 증가만 한 구간이고, 틈이 있거나 hd 가 줄면 새 구간이다', () => {
    const rows = [{ n: 1, hd: FRAME }, { n: 2, hd: 2 * FRAME }, { n: 3, hd: 3 * FRAME }, { n: 4, hd: 0 }, { n: 5, hd: FRAME }, { n: 7, hd: 3 * FRAME }, { n: 8, hd: 2 * FRAME }];
    const runs = K.holdRuns(rows);
    expect(runs.map((r: any) => [r.start, r.end, r.fromZero])).toEqual([[0, 2, true], [4, 4, true], [5, 5, false], [6, 6, false]]);
  });
  test('0 에서 시작하지 않은 구간은 fromZero 가 false 다', () => {
    expect(K.holdRuns([{ n: 1, hd: .8 }, { n: 2, hd: .8 + FRAME }])[0].fromZero).toBe(false);
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
const hex = (n: number) => n;
/** 상태에 맞는 렌더 인스턴스(기둥·물줄기·고리 세 mesh). 물줄기는 투명, 고리만 인스턴스 색을 가진다. 상태는 이 파일이 직접 정한다. */
function visFor(row: any, def: any, over: any = {}) {
  const n = def.gates.length;
  const look = (i: number) => { const g = row.g[i]; return g.dc !== 1 ? 'hidden' : g.at === 1 ? 'sealed' : i === row.pr ? (row.hd > 0 ? 'holding' : 'next') : 'waiting'; };
  const inst = (pick: (look: string) => any) => Array.from({ length: n }, (_, i) => pick(look(i)));
  const s = (v: number) => [v, v, v];
  const ringColor: any = { sealed: 0xffd060, waiting: 0x8394ac, next: def.cueColor, holding: def.cueColor, hidden: 0x000000 };
  return { found: true, by: 'name', meshes: [
    { name: 'pillar', count: n, transparent: false, mc: 0xffffff, inst: inst((l) => ({ s: s(l === 'hidden' ? 0 : 1), c: null })) },
    { name: 'stream', count: n, transparent: true, mc: def.cueColor, inst: inst((l) => ({ s: s(l === 'hidden' || l === 'sealed' ? 0 : l === 'waiting' ? .5 : 1), c: null })) },
    { name: 'ring', count: n, transparent: false, mc: 0xffffff, inst: inst((l) => ({ s: s(l === 'hidden' ? 0 : 1), c: hex(ringColor[l]) })) },
  ], ...over };
}
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
describe('뷰(checkView·checkLook)', () => {
  test('정상: count = 밸브 수·drawCalls ≤ 3·물줄기/고리가 기대 모습이면 통과하고 봉인·차례 표본을 모두 봤다', () => {
    const v = K.checkView(withViews(deepSession(), DEEP).rows, DEEP);
    expect(v.ok).toEqual({ count: true, look: true });
    expect(v.coverage.sealed).toBe(true);
    expect(v.coverage.live).toBe(true);
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
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[0].at === 1) vis.meshes[1].inst[0].s = [1, 1, 1]; });
    const v = K.checkView(s.rows, DEEP);
    expect(v.ok.look).toBe(false);
    expect(v.mismatched[0].problems.some((p: any) => p.kind === 'stream-visible-after-seal')).toBe(true);
  });
  test('차례인 밸브의 물줄기가 숨겨져 있으면 실패한다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.pr === 1 && row.hd > 0) vis.meshes[1].inst[1].s = [0, 0, 0]; });
    expect(K.checkView(s.rows, DEEP).ok.look).toBe(false);
  });
  test('봉인 고리가 금색이 아니거나 순서 대기 고리가 회색이 아니면 실패한다', () => {
    const a = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[0].at === 1) vis.meshes[2].inst[0].c = 0x63e7dd; });
    expect(K.checkView(a.rows, DEEP).ok.look).toBe(false);
    const b = withViews(deepSession(), DEEP, (vis, row) => { if (row.pr >= 1 && row.g[3].dc === 1 && row.g[3].at === 0 && row.pr < 3) vis.meshes[2].inst[3].c = 0xffd060; });
    expect(K.checkView(b.rows, DEEP).ok.look).toBe(false);
  });
  test('미발견 방의 밸브가 보이면 실패한다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { if (row.g[2].dc !== 1) vis.meshes[0].inst[2].s = [1, 1, 1]; });
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
  test('analyzeValves 는 viewExpected 일 때만 뷰 항목을 판정한다', () => {
    const s = withViews(deepSession(), DEEP);
    expect(Object.keys(run(s, DEEP, {}, { viewExpected: true }).acceptance)).toContain('viewLook');
    expect(Object.keys(run(s).acceptance)).not.toContain('viewLook');
    expect(run(s, DEEP, {}, { viewExpected: true }).ok).toBe(true);
  });
  test('expectedLook 는 관측값만으로 hidden/sealed/holding/next/waiting 을 구분한다', () => {
    const row: any = { pr: 1, hd: 0, g: [{ dc: 1, at: 1 }, { dc: 1, at: 0 }, { dc: 1, at: 0 }, { dc: 0, at: 0 }] };
    expect([0, 1, 2, 3].map(i => K.expectedLook(row, i))).toEqual(['sealed', 'next', 'waiting', 'hidden']);
    row.hd = .4;
    expect(K.expectedLook(row, 1)).toBe('holding');
  });
  // smoke-deep-auto-1 오탐 수리: 실제 뷰는 바닥 고리도 반투명이고, 차례 고리는 청록을 흰색 쪽으로 밝힌 색(0xbff1ed)이다.
  const realLike = (vis: any, row: any) => {
    vis.meshes[0].name = 'TLL_BackflowValvePillars';
    vis.meshes[1].name = 'TLL_BackflowValveStreams';
    vis.meshes[2].name = 'TLL_BackflowValveRings'; vis.meshes[2].transparent = true;
    for (let i = 0; i < row.g.length; i++) if (K.expectedLook(row, i) === 'next') vis.meshes[2].inst[i].c = 0xbff1ed;
  };
  test('실제 뷰 모양(반투명 고리·밝힌 차례 고리)은 통과한다', () => {
    const v = K.checkView(withViews(deepSession(), DEEP, realLike).rows, DEEP);
    expect(v.ok).toEqual({ count: true, look: true });
  });
  test('실제 뷰 모양에서도 봉인된 밸브의 물줄기가 보이면 실패하고, 반투명 고리는 물줄기로 세지 않는다', () => {
    const s = withViews(deepSession(), DEEP, (vis, row) => { realLike(vis, row); if (row.g[0].at === 1) vis.meshes[1].inst[0].s = [1, 1, 1]; });
    const v = K.checkView(s.rows, DEEP);
    expect(v.ok.look).toBe(false);
    expect(v.mismatched[0].problems.map((p: any) => p.kind)).toEqual(['stream-visible-after-seal']);
  });
  test('차례 고리가 회색이거나 금색이면 밝힌 청록 면제를 받지 못하고 실패한다', () => {
    for (const bad of [0x8394ac, 0xffd060]) {
      const s = withViews(deepSession(), DEEP, (vis, row) => {
        realLike(vis, row);
        for (let i = 0; i < row.g.length; i++) if (K.expectedLook(row, i) === 'next') vis.meshes[2].inst[i].c = bad;
      });
      expect(K.checkView(s.rows, DEEP).ok.look).toBe(false);
    }
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
  s.hold(3, { rows: over.finalRows ?? 119, dom: false });
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
    shot.stop.vis.meshes[1].inst[0].s = [1, 1, 1]; shot.capture.vis.meshes[1].inst[0].s = [1, 1, 1];
    expect(K.checkScreenMoment(shot, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: true }).ok).toBe(false);
  });
  test('뷰 갱신 1스텝 지연: 정지 시점 또는 촬영 시점 중 하나만 맞아도 통과한다', () => {
    const stop = stateRow({ pr: 0, g: stateRow().g.map((g: any, i: number) => (i === 0 ? { dc: 1, at: 0 } : g)) }), capture = stateRow();
    expect(K.checkScreenMoment({ stop, capture }, DEEP, { gate: 0, look: 'sealed' }, { viewExpected: false }).ok).toBe(true);
    expect(K.checkScreenMoment({ stop, capture }, DEEP, { gate: 0, look: 'next' }, { viewExpected: false }).ok).toBe(true);
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
