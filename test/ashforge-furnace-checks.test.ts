import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/ashforge-furnace-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEEP: any = (ROUTE_OBJECTIVES as any).ashforge_deep;
const STD: any = (ROUTE_OBJECTIVES as any).ashforge_standard;
const NAMES: string[] = [...K.STATE_NAMES];

// 방 배치와 종류. 판정은 방 id·좌표·종류를 인자로 받는다(정예방은 증원 REINFORCEMENTS 회).
const DEEP_ROOMS = [{ id: 2, x: 31, z: -29, type: 'elite' }, { id: 4, x: 62, z: 0, type: 'treasure' }, { id: 5, x: 93, z: 0, type: 'elite' }, { id: 7, x: 124, z: 29, type: 'normal' }];
const STD_ROOMS = [{ id: 1, x: 31, z: 0, type: 'normal' }, { id: 2, x: 62, z: -29, type: 'elite' }, { id: 3, x: 62, z: 29, type: 'normal' }, { id: 5, x: 124, z: 0, type: 'normal' }];
const REINFORCEMENTS = 2;
const PAD_OFFSET = 3.5;
// 목표창 문구는 PLAN 3.1 의 계약 문장을 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const TXT = { closed: '망치 충격파 뒤 옮겨 간 조작판으로 이동', avoid: '망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동', open: '청록 조작판에서 2초 유지', plainAvoid: '분출을 피하고 청록 조작판으로 이동' };

/**
 * 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 건너뛴 스텝은 skip 으로 센다.
 * release 세션은 모습(view)과 사슬 scale 을 시나리오가 직접 선언한다(판정 함수가 그 선언을 관측과 맞춰 본다).
 */
class Sim {
  rows: any[] = []; n = 0; pr = 0; hd = 0; sl = 1; au = 1; ah = 0; ps = 'move'; hero = { x: 0, z: 0 }; rem: number; g: any[]; vs: string[]; cs: number[];
  coolT: number[] = []; domNext: string | null = null; deepRules: boolean;
  constructor(public def: any, public rooms: any[], public reinforcements: number, public release: boolean) {
    this.deepRules = !!def.shockWindow;
    this.g = def.gates.map((gate: any, i: number) => ({ id: gate.roomId, rd: 0, at: 0, cl: 0, fw: 0, dc: 0, al: 0, pd: 0, ph: 0, sk: this.deepRules ? 0 : -1, po: this.deepRules ? 0 : -1,
      px: rooms[i].x - PAD_OFFSET, pz: rooms[i].z, vv: 0 }));
    this.vs = def.gates.map(() => 'hidden'); this.cs = def.gates.map(() => 0);
    this.rem = def.gates.length + 3;
    this.snap({ mk: 'start' });
  }
  snap(extra: any = {}) {
    const row: any = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: 100, mhp: 100, al: 1, rm: 0, pr: this.pr, hd: this.hd, sl: this.sl, rem: this.rem,
      au: this.au, ah: this.ah, ps: this.ps, g: this.g.map(x => ({ ...x })),
      rv: this.release ? { c: this.def.gates.length * 10, d: 2, s: this.vs.map(v => NAMES.indexOf(v)), cs: [...this.cs] } : null, ...extra };
    if (this.domNext) { row.dom = this.domNext; this.domNext = null; }
    this.rows.push(row); return row;
  }
  step(extra: any = {}) { this.n++; return this.snap(extra); }
  skip(k: number) { this.n += k; }
  mark(label: string) { return this.snap({ mk: label }); }
  room(i: number) { return this.rooms[i]; }
  pad(i: number) { return { x: this.g[i].px, z: this.g[i].pz }; }
  /** 영웅을 gate i 조작판 위(dx, dz 만큼 떨어진 곳)에 둔다. */
  onPad(i: number, dx = 0, dz = 0) { const p = this.pad(i); this.hero = { x: p.x + dx, z: p.z + dz }; }
  view(i: number, name: string) { this.vs[i] = name; this.cs[i] = ['bound', 'shock', 'open'].includes(name) ? 1 : name === 'releasing' ? .5 : 0; }
  title() { return this.def.copy.title + ' ' + this.pr + '/' + this.def.gates.length; }
  /** 현재 심장로의 목표창 문구(계약 문장). */
  text(i: number) {
    const g = this.g[i], hot = g.ph === 1 || g.ph === 2;
    const action = this.deepRules ? (hot ? TXT.avoid : g.po === 1 ? TXT.open : TXT.closed) : (hot ? TXT.plainAvoid : TXT.open);
    return this.title() + action;
  }
  sample(i: number) { this.domNext = this.text(i); }
  discover(i: number) { const g = this.g[i]; g.dc = 1; g.vv = 1; if (this.release) this.view(i, 'bound'); this.skip(10); this.step(); }
  /** 적 처치. 정예방은 증원 waves 회를 모두 겪은 뒤. */
  fight(i: number, { waves = this.reinforcements }: any = {}) {
    const g = this.g[i];
    g.al = 5; this.skip(30); this.step(); g.al = 0;
    if (this.room(i).type === 'elite') for (let w = 1; w <= waves; w++) { g.fw = w; this.step(); if (w < waves) { g.al = 4; this.skip(30); this.step(); g.al = 0; } }
  }
  /** ready. 심층은 이 순간 shocks 0 · 닫힘 · 가열이다. */
  readyUp(i: number, { dirty = false }: any = {}) {
    const g = this.g[i];
    g.rd = 1; if (this.deepRules) { g.sk = 0; g.po = 0; g.ph = 0; }
    if (dirty) g.al = 1;
    if (this.release) this.view(i, i === this.pr ? 'shock' : 'bound');
    this.step();
  }
  /** 닫힌 조작판 위 대기(유지 0). 한 스텝씩 행이 남는다. */
  closedWait(i: number, rows: number, { sample = true }: any = {}) {
    this.onPad(i, .3, 0);
    for (let k = 1; k <= rows; k++) { if (sample && k === 40) this.sample(i); this.step(); }
  }
  /** 예고(warning) → 분출(vent) → 가열 복귀(shocks + 1, 조작판이 반대편으로 옮겨 가 열림). */
  shockCycle(i: number, { warning = 84, vent = 48, here = true }: any = {}) {
    const g = this.g[i];
    if (here) this.onPad(i, .3, 0);
    g.ph = 1; for (let k = 1; k <= warning; k++) { if (k === 40) this.sample(i); this.step(); }
    g.ph = 2; for (let k = 1; k <= vent; k++) { if (k === 40) this.sample(i); this.step(); }
    const room = this.room(i);
    g.ph = 0; g.sk++; g.po = 1; g.px = g.px < room.x ? room.x + PAD_OFFSET : room.x - PAD_OFFSET;
    if (this.release) this.view(i, 'open');
    this.step();
  }
  /** 열린 조작판 위 유지: hd 가 1/60 씩 늘어난다(기본 119행 = 2초 − 1/60). */
  hold(i: number, { rows = Math.round(this.def.holdSeconds / FRAME) - 1, dom = true, closedAt = -1 }: any = {}) {
    this.skip(40); this.onPad(i, .2, 0);
    for (let k = 1; k <= rows; k++) {
      this.hd = k * FRAME;
      const g = this.g[i];
      if (k === closedAt) { g.po = 0; g.ph = 1; if (this.release) this.view(i, 'shock'); }
      if (dom && k === 36) this.sample(i);
      this.step();
    }
  }
  cool(i: number) {
    const g = this.g[i];
    this.hd = 0; g.at = 1; g.cl = 1; this.pr++; this.rem--; g.ph = 3; if (this.deepRules) g.po = 0;
    if (this.release) this.view(i, 'releasing');
    this.coolT[i] = (this.n + 1) * FRAME;
    return this.step();
  }
  /** 냉각 0.7초 뒤 사슬 scale 0, 1.7초 뒤 released. */
  releaseOut(i: number, { stuck = false, wrong = false }: any = {}) {
    if (!this.release) return;
    this.skip(41); if (!stuck) this.cs[i] = 0; this.step();
    this.skip(59); this.view(i, 'released'); if (stuck) this.cs[i] = .5; if (wrong) this.vs[i] = 'releasing'; this.step();
  }
  unseal({ remaining = 0 } = {}) { this.skip(72); this.sl = 0; this.rem = remaining; this.step(); }
}

/** 심층 정상 세션: 방 2 → 4 → 5 → 7 순서로 발견 → 처치 → ready → 닫힌 대기 → 충격파 → 열린 유지 → 냉각 → 해방. */
function deepSession(over: any = {}) {
  const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, over.release ?? true);
  s.mark('x');
  for (let i = 0; i < 4; i++) {
    s.discover(i);
    if (i === 2) s.rem -= 3;   // 나머지 구역 정화
    s.fight(i, over['fight' + i]);
    s.readyUp(i, over['ready' + i]);
    if (!over.noWait) s.closedWait(i, 60);
    s.shockCycle(i, { here: !over.noWait });
    s.hold(i, over['hold' + i]);
    if (over.unsealEarly && i === 3) s.sl = 0;
    s.cool(i);
    s.releaseOut(i, i === over.stuckGate ? { stuck: true } : i === over.wrongGate ? { wrong: true } : {});
  }
  if (!over.unsealEarly) s.unseal(over.unseal);
  s.mark('end');
  return s;
}
function standardSession(over: any = {}) {
  const s = new Sim(STD, STD_ROOMS, 0, false);
  for (let i = 0; i < 4; i++) {
    s.discover(i);
    if (i === 3) s.rem -= 3;
    s.fight(i, { waves: 0 });
    s.readyUp(i);
    s.hold(i, over['hold' + i]);
    s.cool(i);
  }
  s.unseal();
  s.mark('end');
  return s;
}
const resultOf = (def: any, over: any = {}) => ({ id: def.id, label: def.copy.title, complete: true, progress: def.gates.length, target: def.gates.length, rooms: def.gates.map((g: any) => g.roomId), ...over });
const lineOf = (def: any) => def.copy.title + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';
const layoutOf = (n: number, over: any = {}) => ({ seen: Array.from({ length: n }, () => true), mismatches: [], ...over });
/** 뷰 같은 프레임 A/B 표본 하나. changed 는 모습이 바뀐 심장로 index. */
const abSample = (n: number, g: any[], pr: number, changed: number[], over: any = {}) => ({ n, t: n * FRAME, pr, hd: 0, g, changed, relCalls: 2, viewCalls: 5, on: 20, offRelease: 18, offAll: 13, ...over });
const abSet = (over: any = {}) => [
  abSample(1, [{ dc: 1, at: 0, rd: 0, po: 0, ra: null }], 0, [0]),
  abSample(2, [{ dc: 1, at: 0, rd: 1, po: 1, ra: null }], 0, [0]),
  abSample(3, [{ dc: 1, at: 1, rd: 1, po: 0, ra: 0 }], 1, [0]),
  ...(over.extra ?? []),
];
const analyze = (s: Sim, def = DEEP, over: any = {}, opts: any = {}) => K.analyzeFurnaces({ rows: s.rows, result: resultOf(def), resultText: '원정 결과 ' + lineOf(def) + ' 전투 시간', win: true, rooms: s.rooms,
  viewAB: abSet(), layout: layoutOf(def.gates.length), hasRelease: s.release, ...over }, def,
  { reinforcements: s.reinforcements, expectWaiting: !!def.shockWindow, releaseExpected: s.release, syncExpected: true, ...opts });
const failing = (a: any) => Object.entries(a.acceptance).filter(([, ok]) => !ok).map(([name]) => name);

describe('공유 정의', () => {
  test('심층 4곳(2·4·5·7)은 충격파 창과 해방 연출을 갖고, 일반 4곳(1·2·3·5)은 갖지 않는다', () => {
    expect(DEEP.gates.map((g: any) => g.roomId)).toEqual([2, 4, 5, 7]);
    expect(STD.gates.map((g: any) => g.roomId)).toEqual([1, 2, 3, 5]);
    expect(DEEP.shockWindow).toBe(true);
    expect(DEEP.release).toBe('ember-chains');
    expect(DEEP.releaseSeconds).toBe(1.6);
    expect(STD.shockWindow).toBeUndefined();
    expect(STD.release).toBeUndefined();
  });
  test('제목·결과 줄·열림 문구는 정의 copy 와 holdSeconds 로 만든다', () => {
    expect(K.furnaceTitle(DEEP)).toBe('심장로 냉각');
    expect(K.resultLineOf(DEEP)).toBe('심장로 냉각 4/4 · 완료');
    expect(K.resultLineOf(STD)).toBe('용광로 냉각 4/4 · 완료');
    expect(K.holdPhraseOf(DEEP)).toBe(TXT.open);
    expect(K.ACTION.closed).toBe(TXT.closed);
    expect(K.ACTION.avoid).toBe(TXT.avoid);
  });
});

describe('holdRuns', () => {
  const at = (n: number, hd: number, t = n * FRAME) => ({ n, t, hd });
  test('연속 스텝에서 hold 증가량이 게임 시각 증가량과 같을 때만 한 구간이다', () => {
    const rows = [at(1, FRAME), at(2, 2 * FRAME), at(3, 3 * FRAME), at(4, 0), at(5, FRAME), at(7, 3 * FRAME), at(8, 2 * FRAME)];
    expect(K.holdRuns(rows).map((r: any) => [r.start, r.end, r.fromZero])).toEqual([[0, 2, true], [4, 4, true], [5, 5, false], [6, 6, false]]);
  });
  test('엔진이 유지량을 2배로 쌓으면 구간이 이어지지 않는다', () => {
    const rows = [at(1, 2 * FRAME, FRAME), at(2, 4 * FRAME, 2 * FRAME), at(3, 6 * FRAME, 3 * FRAME)];
    expect(K.holdRuns(rows).map((r: any) => [r.start, r.end])).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
  test('같은 스텝을 한 번 더 기록한 표식 행은 구간을 끊지 않지만, 같은 스텝인데 hold 가 다르면 이어지지 않는다', () => {
    const dup = [at(1, FRAME), at(2, 2 * FRAME), { ...at(2, 2 * FRAME), mk: 'partial' }, at(3, 3 * FRAME), at(4, 0)];
    expect(K.holdRuns(dup).map((r: any) => [r.start, r.end, r.fromZero, r.max])).toEqual([[0, 3, true, 3 * FRAME]]);
    const odd = [at(1, FRAME), at(2, 2 * FRAME), at(2, 5 * FRAME), at(3, 6 * FRAME)];
    expect(K.holdRuns(odd).length).toBeGreaterThan(1);
  });
});

describe('냉각 판정(checkCoolings)', () => {
  test('정상 심층 세션은 냉각 4회·순서 [2,4,5,7]·유지 ≥ 2초 − 1/60·전 표본 열림으로 통과한다', () => {
    const r = K.checkCoolings(deepSession().rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.count).toBe(4);
    expect(r.observedOrder).toEqual([2, 4, 5, 7]);
    expect(r.cools.every((c: any) => c.hold.seconds >= DEEP.holdSeconds - FRAME - 1e-6)).toBe(true);
    expect(Object.values(r.ok).every(Boolean)).toBe(true);
    expect(r.violations).toEqual([]);
  });
  test('순서 위반: 냉각한 심장로의 방 id 가 정의 순서와 다르면 order 가 실패한다', () => {
    const s = deepSession();
    const i = s.rows.findIndex((r, k) => k > 0 && r.pr > s.rows[k - 1].pr);
    for (let k = i; k < s.rows.length; k++) s.rows[k].g[0].id = 99;
    const r = K.checkCoolings(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.order).toBe(false);
    expect(r.violations.some((v: any) => v.kind === 'order')).toBe(true);
  });
  test('유지 부족: 118행(2초 − 2/60)만 채우고 냉각하면 hold 가 실패한다', () => {
    const r = K.checkCoolings(deepSession({ hold1: { rows: 118 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.hold).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'hold').roomId).toBe(4);
  });
  test('닫힌 상태 유지: 유지 도중 조작판이 닫혔는데 hold 가 이어지면 padOpen 이 실패한다', () => {
    const r = K.checkCoolings(deepSession({ hold0: { closedAt: 50 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.padOpen).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'closed-pad').closedRows).toBeGreaterThan(0);
  });
  test('충격파 횟수가 0 인데 열린 표본이면(독립 관측이 padOpen 과 어긋나면) 열림으로 인정하지 않는다', () => {
    const s = deepSession();
    for (const row of s.rows) if (row.hd > 0 && row.pr === 0) row.g[0].sk = 0;
    expect(K.checkCoolings(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.padOpen).toBe(false);
  });
  test('증원 전 냉각: 정예방의 forgeWave 가 증원 횟수보다 작으면 reinforcements 가 실패한다', () => {
    const r = K.checkCoolings(deepSession({ fight0: { waves: 1 } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.reinforcements).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'forge').roomId).toBe(2);
  });
  test('방에 적이 남은 채 냉각하면 enemies 가 실패한다', () => {
    const r = K.checkCoolings(deepSession({ ready3: { dirty: true } }).rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(r.ok.enemies).toBe(false);
  });
  test('영웅이 유지 중 조작판 반경 밖(2.5)이면 inside 가 실패한다', () => {
    const s = deepSession();
    for (const row of s.rows) if (row.hd > 0 && row.pr === 2) row.x += 2.5;
    expect(K.checkCoolings(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.inside).toBe(false);
  });
  test('냉각 중 앞 심장로가 attuned 가 아니거나 냉각 전에 방이 cleared 였으면 gateState 가 실패한다', () => {
    const s = deepSession();
    const early = s.rows.findIndex(r => r.n > 0 && r.g[2].dc === 1);
    s.rows[early].g[2].cl = 1;
    expect(K.checkCoolings(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS }).ok.state).toBe(false);
  });
});

describe('유지 표본의 조작판 상태(checkHoldWindows)', () => {
  test('정상 세션은 모든 유지 표본이 열려 있다', () => {
    expect(K.checkHoldWindows(deepSession().rows, DEEP).ok).toBe(true);
  });
  test('냉각에 이르지 못한 유지라도 닫힌 조작판에서 hold > 0 이면 실패한다', () => {
    const s = deepSession();
    // 닫힌 대기 표본 한 줄에 hold 를 억지로 올린다.
    const row = s.rows.find(r => r.pr === 0 && r.g[0].rd === 1 && r.g[0].po === 0 && r.hd === 0 && r.n > 0)!;
    row.hd = FRAME;
    const r = K.checkHoldWindows(s.rows, DEEP);
    expect(r.ok).toBe(false);
    expect(r.badCount).toBe(1);
  });
  test('일반 정의는 padOpen 이 닫힌 적이 없어야 한다(-1 은 메서드가 없는 기준선)', () => {
    const s = standardSession();
    expect(K.checkHoldWindows(s.rows, STD).ok).toBe(true);
    s.rows.at(-2)!.g[1].po = 0;
    expect(K.checkHoldWindows(s.rows, STD).ok).toBe(false);
  });
});

describe('닫힌 대기(checkWaiting)', () => {
  test('ready 인데 닫힌 조작판 위에서 유지 0 으로 기다린 표본이 1개 이상이면 통과한다', () => {
    const r = K.checkWaiting(deepSession().rows, DEEP, { required: true });
    expect(r.ok).toBe(true);
    expect(r.samples).toBeGreaterThanOrEqual(60);
  });
  test('닫힌 대기 미관측: 영웅이 닫힌 조작판 근처에 간 적이 없으면 실패한다. 일반에서는 요구하지 않는다', () => {
    const s = deepSession({ noWait: true });
    // noWait 세션은 영웅이 조작판에 가지 않는다(원점 근처).
    const r = K.checkWaiting(s.rows, DEEP, { required: true });
    expect(r.samples).toBe(0);
    expect(r.ok).toBe(false);
    expect(K.checkWaiting(s.rows, DEEP, { required: false }).ok).toBe(true);
  });
  test('대기 표본에서 그 심장로의 방이 이미 cleared 면 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => r.n > 0 && K.isWaitRow(r, DEEP))!;
    row.g[0].cl = 1;
    expect(K.checkWaiting(s.rows, DEEP).ok).toBe(false);
  });
  test('대기는 규칙 반경(def.radius) 안에서만 센다: 반경 밖(1.7)의 유지 0 은 닫힘의 증거가 아니다', () => {
    const s = deepSession();
    const row = s.rows.find(r => r.n > 0 && K.isWaitRow(r, DEEP))!;
    const g = row.g[row.pr];
    row.x = g.px + 1.55; row.z = g.pz; expect(K.isWaitRow(row, DEEP)).toBe(true);
    row.x = g.px + 1.7; expect(K.isWaitRow(row, DEEP)).toBe(false);
  });
});
describe('유지 위치 여유(리뷰 P2-2)', () => {
  test('유지 구간 영웅이 조작판 반경 1.6 을 넘어(1.7) 있으면 inside 가 실패한다', () => {
    const s = deepSession();
    for (const r of s.rows) if (r.pr === 0 && r.hd > 0) { r.x = r.g[0].px + 1.7; r.z = r.g[0].pz; }
    const c = K.checkCoolings(s.rows, DEEP, { reinforcements: REINFORCEMENTS, rooms: DEEP_ROOMS });
    expect(c.cools[0].inside.ok).toBe(false);
    expect(c.cools[0].inside.limit).toBeLessThan(DEEP.radius + .02);
  });
});

describe('봉인 해제·결과', () => {
  test('정상 세션: 해제는 progress = 4 이고 남은 구역 0 인 마지막 냉각 뒤다', () => {
    const u = K.checkUnseal(deepSession().rows, DEEP);
    expect(u.ok).toBe(true);
    expect(u.progress).toBe(4);
  });
  test('조기 봉인 해제: 마지막 냉각 스텝에서 이미 풀려 있으면 실패한다', () => {
    const u = K.checkUnseal(deepSession({ unsealEarly: true }).rows, DEEP);
    expect(u.ok).toBe(false);
  });
  test('구역이 남은 채 해제되면(rem > 0) 실패한다', () => {
    expect(K.checkUnseal(deepSession({ unseal: { remaining: 1 } }).rows, DEEP).ok).toBe(false);
  });
  test('결과 객체: 정상 통과, progress·rooms·id·complete·label 불일치와 패배는 실패한다', () => {
    expect(K.checkResultFields(resultOf(DEEP), DEEP, true).ok).toBe(true);
    expect(K.checkResultFields(resultOf(DEEP, { progress: 3 }), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP, { rooms: [2, 4, 7, 5] }), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP, { id: 'ashforge_furnaces_standard' }), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP, { complete: false }), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP, { label: '용광로 냉각' }), DEEP, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEEP), DEEP, false).ok).toBe(false);
    expect(K.checkResultFields(null, DEEP, true).ok).toBe(false);
  });
  test('결과 줄: 정의 제목과 n/n · 완료가 있어야 한다(심층 제목을 일반 줄로 대신할 수 없다)', () => {
    expect(K.checkResultLine('x ' + lineOf(DEEP) + ' y', DEEP).ok).toBe(true);
    expect(K.checkResultLine('x ' + lineOf(STD) + ' y', DEEP).ok).toBe(false);
    expect(K.checkResultLine('심장로 냉각 3/4 · 완료', DEEP).ok).toBe(false);
    expect(K.checkResultLine('심장로 냉각 4/4', DEEP).ok).toBe(false);
    expect(K.checkResultLine(undefined, DEEP).ok).toBe(false);
  });
});

describe('목표창 표본(checkObjectiveSamples)', () => {
  const objective = (s: Sim) => K.checkObjectiveSamples(s.rows, DEEP, K.checkCoolings(s.rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).cools);
  test('정상 세션은 닫힘·분출 중·열림 문구 표본을 모두 갖는다', () => {
    const o = objective(deepSession());
    expect(o.ok).toBe(true);
    expect(o.open).toBeGreaterThanOrEqual(4);
    expect(o.closed).toBeGreaterThanOrEqual(1);
  });
  test('열림 상태에서 닫힘 문구가 나오면(문구가 상태와 어긋나면) 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => typeof r.dom === 'string' && r.g[r.pr].po === 1)!;
    row.dom = row.dom.replace(TXT.open, TXT.closed);
    expect(objective(s).ok).toBe(false);
  });
  test('제목이 없으면 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => typeof r.dom === 'string')!;
    row.dom = row.dom.replace('심장로 냉각', '냉각선 복구');
    expect(objective(s).ok).toBe(false);
  });
  test('열림 표본이 한 곳이라도 없으면 openMissing 으로 실패한다', () => {
    const s = deepSession({ hold2: { dom: false } });
    const o = objective(s);
    expect(o.openMissing.map((x: any) => x.roomId)).toEqual([5]);
    expect(o.ok).toBe(false);
  });
  test('예고·분출 중에는 충격파를 피하는 문구여야 한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => typeof r.dom === 'string' && r.g[r.pr].ph === 1)!;
    expect(row.dom).toContain(TXT.avoid);
    row.dom = row.dom.replace(TXT.avoid, TXT.closed);
    expect(objective(s).ok).toBe(false);
  });
  test('일반 정의: 예고 중 분출을 피하는 문구, 그 밖 유지 문구. 닫힘 표본은 요구하지 않는다', () => {
    const s = standardSession();
    const o = K.checkObjectiveSamples(s.rows, STD, K.checkCoolings(s.rows, STD, { rooms: STD_ROOMS }).cools);
    expect(o.ok).toBe(true);
    expect(o.closed).toBe(0);
  });
});

describe('해방 연출 뷰(checkRelease)', () => {
  const rel = (s: Sim) => K.checkRelease(s.rows, DEEP);
  test('정상 세션: count 40·drawCalls 2·states 일치·사슬 해제·발견 스텝 표시를 모두 통과한다', () => {
    const r = rel(deepSession());
    expect(r.ok).toEqual({ count: true, states: true, chainLook: true, chainRelease: true, discover: true });
  });
  test('count 가 심장로 수 × 10 이 아니면 실패한다', () => {
    const s = deepSession();
    s.rows[5].rv.c = 36;
    expect(rel(s).ok.count).toBe(false);
  });
  test('drawCalls 가 2 를 넘으면 실패한다', () => {
    const s = deepSession();
    s.rows[7].rv.d = 3;
    expect(rel(s).ok.count).toBe(false);
  });
  test('states 불일치: 닫힌 조작판인데 open 이라고 하면 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => r.pr === 0 && r.g[0].rd === 1 && r.g[0].po === 0 && r.n > 0)!;
    row.rv.s[0] = NAMES.indexOf('open');
    const r = rel(s);
    expect(r.ok.states).toBe(false);
    expect(r.stateBad[0].got).toBe('open');
  });
  test('사슬 미해제: 냉각 뒤 1.6초 + 1/60 이 지나도 사슬 scale 이 남으면 실패한다', () => {
    const r = rel(deepSession({ stuckGate: 1 }));
    expect(r.ok.chainRelease).toBe(false);
    expect(r.release[1].ok).toBe(false);
  });
  test('releasing 이어야 할 시각에 released 라고 하면(너무 이른 해방) states 가 실패한다', () => {
    const s = deepSession();
    const cooled = s.rows.findIndex(r => r.g[0].at === 1);
    s.rows[cooled].rv.s[0] = NAMES.indexOf('released');
    expect(rel(s).ok.states).toBe(false);
  });
  test('released 시각 뒤에도 releasing 이라고 하면 실패한다', () => {
    expect(rel(deepSession({ wrongGate: 2 })).ok.states).toBe(false);
  });
  test('보이는 상태인데 사슬 scale 이 0 이면 chainLook 이 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => r.rv && r.rv.s[0] === NAMES.indexOf('bound'))!;
    row.rv.cs[0] = 0;
    expect(rel(s).ok.chainLook).toBe(false);
  });
  test('방 발견 스텝의 같은 표본이 hidden 이면 discover 가 실패한다', () => {
    const s = deepSession();
    const row = s.rows.find(r => r.n > 0 && r.g[1].dc === 1)!;
    row.rv.s[1] = NAMES.indexOf('hidden'); row.rv.cs[1] = 0;
    const r = rel(s);
    expect(r.ok.discover).toBe(false);
    expect(r.discover[1].state).toBe('hidden');
  });
  test('releaseView 관측이 없는 행이 있으면 count 가 실패한다', () => {
    const s = deepSession();
    s.rows[6].rv = null;
    expect(rel(s).ok.count).toBe(false);
  });
  test('냉각 뒤 마감 시각 이후 행이 없으면(확인할 수 없으면) 실패한다', () => {
    const s = deepSession();
    const keep = s.rows.findIndex(r => r.g[3].at === 1);
    const r = K.checkRelease(s.rows.slice(0, keep + 1), DEEP);
    expect(r.release[3].observedAfter).toBe(false);
    expect(r.ok.chainRelease).toBe(false);
  });
  test('expectedStates: 경계(±1.5프레임)에서는 releasing 과 released 를 모두 허용한다', () => {
    const g = { dc: 1, at: 1, rd: 1, po: 0 };
    expect(K.expectedStates(g, 0, 1, 1.0, DEEP)).toEqual(['releasing']);
    expect(K.expectedStates(g, 0, 1, 1.6, DEEP)).toEqual(['releasing', 'released']);
    expect(K.expectedStates(g, 0, 1, 1.7, DEEP)).toEqual(['released']);
    expect(K.expectedStates({ dc: 0, at: 0, rd: 0, po: 0 }, 0, 0, null, DEEP)).toEqual(['hidden']);
    expect(K.expectedStates({ dc: 1, at: 0, rd: 1, po: 1 }, 0, 0, null, DEEP)).toEqual(['open']);
    expect(K.expectedStates({ dc: 1, at: 0, rd: 1, po: 0 }, 0, 0, null, DEEP)).toEqual(['shock']);
    expect(K.expectedStates({ dc: 1, at: 0, rd: 1, po: 1 }, 1, 0, null, DEEP)).toEqual(['bound']);
  });
});

describe('사슬 배치·냉각 장치 뷰 동기화', () => {
  test('사슬 인스턴스 위치가 심장로별로 확인되고 어긋남이 없을 때만 통과한다', () => {
    expect(K.checkChainLayout(layoutOf(4), 4).ok).toBe(true);
    expect(K.checkChainLayout(layoutOf(4, { seen: [true, true, false, true] }), 4).ok).toBe(false);
    expect(K.checkChainLayout(layoutOf(4, { mismatches: [{ instance: 5 }] }), 4).ok).toBe(false);
    expect(K.checkChainLayout(undefined, 4).ok).toBe(false);
  });
  test('route.view 가 방 발견과 같은 스텝에 보이는지: 어긋나면 후보에서는 실패하고 기준선에서는 보고만 한다', () => {
    const s = deepSession();
    expect(K.checkViewSync(s.rows, DEEP, { expected: true }).ok).toBe(true);
    const row = s.rows.find(r => r.n > 0 && r.g[2].dc === 1)!;
    row.g[2].vv = 0;
    const strict = K.checkViewSync(s.rows, DEEP, { expected: true });
    expect(strict.ok).toBe(false);
    expect(strict.mismatches[0]).toMatchObject({ gate: 2, visible: 0, discovered: 1 });
    expect(K.checkViewSync(s.rows, DEEP, { expected: false }).ok).toBe(true);
    expect(K.checkViewSync(s.rows, DEEP, { expected: false }).mismatchCount).toBeGreaterThan(0);
  });
  test('뷰 root 를 읽지 못하면(vv -1) 후보에서는 관측 불가로 실패한다', () => {
    const s = deepSession();
    for (const r of s.rows) for (const g of r.g) g.vv = -1;
    expect(K.checkViewSync(s.rows, DEEP, { expected: true }).ok).toBe(false);
  });
});

describe('뷰 같은 프레임 A/B(checkViewGpu)', () => {
  test('차이 2 이고 releaseView.drawCalls 와 같으며 bound·open·releasing 표본이 있으면 통과한다. 경로 전체 차이는 보고만 한다', () => {
    const r = K.checkViewGpu(abSet(), DEEP);
    expect(r.ok).toBe(true);
    expect(r.max).toBe(2);
    expect(r.coverage).toMatchObject({ bound: true, open: true, releasing: true });
    expect(r.route.max).toBe(7);
    expect(r.route.mismatches).toBe(0);
  });
  test('차이가 3 이면 실패한다(상한 2)', () => {
    const r = K.checkViewGpu(abSet({ extra: [abSample(4, [{ dc: 1, at: 0, rd: 0, po: 0, ra: null }], 0, [0], { on: 21, relCalls: 3 })] }), DEEP);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch-or-over-limit');
  });
  test('측정 차이와 releaseView.drawCalls 주장이 다르면 실패한다', () => {
    const list = abSet(); list[0].offRelease = 19;
    expect(K.checkViewGpu(list, DEEP).ok).toBe(false);
  });
  test('표본이 3개 미만이거나 releasing 표본이 없으면 실패한다', () => {
    expect(K.checkViewGpu(abSet().slice(0, 2), DEEP).reason).toBe('too-few-samples');
    const noRelease = abSet({ extra: [abSample(9, [{ dc: 1, at: 0, rd: 0, po: 0, ra: null }], 0, [0])] }).filter(x => x.n !== 3);
    const r = K.checkViewGpu(noRelease, DEEP);
    expect(r.coverage.releasing).toBe(false);
    expect(r.ok).toBe(false);
  });
  test('draw call 이 0 이라고 주장하면서 차이가 있으면 실패한다(거짓 보고 방지)', () => {
    const list = abSet({ extra: [abSample(5, [{ dc: 1, at: 0, rd: 0, po: 0, ra: null }], 0, [0], { relCalls: 0 })] });
    expect(K.checkViewGpu(list, DEEP).ok).toBe(false);
  });
  test('경로 전체 차이가 주장 합계와 다르면 보고 항목에 불일치로 남지만 게이트는 막지 않는다', () => {
    const list = abSet(); list[1].offAll = 12;
    const r = K.checkViewGpu(list, DEEP);
    expect(r.ok).toBe(true);
    expect(r.route.mismatches).toBe(1);
  });
});

describe('종합(analyzeFurnaces)', () => {
  test('정상 심층 세션은 모든 항목을 통과한다', () => {
    const a = analyze(deepSession());
    expect(failing(a)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.observedOrder).toEqual([2, 4, 5, 7]);
  });
  test('유지 부족 · 닫힌 상태 유지 · 증원 전 냉각 · 닫힌 대기 미관측 · 조기 해제 · 결과 불일치는 각각 해당 항목만 실패한다', () => {
    expect(failing(analyze(deepSession({ hold0: { rows: 100 } })))).toContain('holdDuration');
    expect(failing(analyze(deepSession({ hold0: { closedAt: 60 } })))).toEqual(expect.arrayContaining(['padOpen', 'holdWindows']));
    expect(failing(analyze(deepSession({ fight2: { waves: 0 } })))).toContain('reinforcements');
    expect(failing(analyze(deepSession({ noWait: true })))).toEqual(['waiting']);
    expect(failing(analyze(deepSession({ unsealEarly: true })))).toContain('unseal');
    expect(failing(analyze(deepSession(), DEEP, { result: resultOf(DEEP, { progress: 3 }) }))).toEqual(['resultFields']);
    expect(failing(analyze(deepSession(), DEEP, { resultText: '심장로 냉각 3/4' }))).toEqual(['resultLine']);
  });
  test('사슬 미해제 · states 불일치 · A/B 실패는 release 항목만 실패한다', () => {
    expect(failing(analyze(deepSession({ stuckGate: 0 })))).toEqual(['releaseChains']);
    expect(failing(analyze(deepSession({ wrongGate: 3 })))).toEqual(['releaseStates']);
    expect(failing(analyze(deepSession(), DEEP, { viewAB: abSet().slice(0, 2) }))).toEqual(['releaseGpu']);
    expect(failing(analyze(deepSession(), DEEP, { layout: layoutOf(4, { seen: [true, false, true, true] }) }))).toEqual(['releaseLayout']);
  });
  test('기준선 모드: syncView 가 없는 빌드는 viewSync 를 판정하지 않는다', () => {
    const s = deepSession();
    for (const row of s.rows) for (const g of row.g) g.vv = 0;
    expect(failing(analyze(s, DEEP, {}, { syncExpected: false }))).toEqual([]);
    expect(failing(analyze(s, DEEP, {}, { syncExpected: true }))).toEqual(['viewSync']);
  });
  test('정상 일반 세션: 냉각 [1,2,3,5]·releaseView 없음·padOpen 항상 열림으로 통과한다', () => {
    const a = analyze(standardSession(), STD, { viewAB: [] }, { expectWaiting: false, releaseExpected: false });
    expect(failing(a)).toEqual([]);
    expect(a.observedOrder).toEqual([1, 2, 3, 5]);
    expect(a.acceptance.noRelease).toBe(true);
  });
  test('일반인데 releaseView 가 있으면 noRelease 가 실패하고, padOpen 이 닫히면 holdWindows 가 실패한다', () => {
    const s = standardSession();
    s.rows[4].rv = { c: 40, d: 2, s: [1, 1, 1, 1], cs: [1, 1, 1, 1] };
    expect(failing(analyze(s, STD, { viewAB: [] }, { expectWaiting: false, releaseExpected: false }))).toEqual(['noRelease']);
    const t = standardSession();
    t.rows.at(-2)!.g[1].po = 0;
    expect(failing(analyze(t, STD, { viewAB: [] }, { expectWaiting: false, releaseExpected: false }))).toContain('holdWindows');
    expect(failing(analyze(standardSession(), STD, { viewAB: [], hasRelease: true }, { expectWaiting: false, releaseExpected: false }))).toEqual(['noRelease']);
  });
  test('일반 기준선(padOpen 메서드 없음: po -1)도 냉각 규칙은 판정한다', () => {
    const s = standardSession();
    expect(s.rows.every(r => r.g.every((g: any) => g.po === -1))).toBe(true);
    expect(analyze(s, STD, { viewAB: [] }, { expectWaiting: false, releaseExpected: false, syncExpected: false }).ok).toBe(true);
    const short = standardSession({ hold1: { rows: 100 } });
    expect(failing(analyze(short, STD, { viewAB: [] }, { expectWaiting: false, releaseExpected: false }))).toContain('holdDuration');
  });
});

// ---------- order ----------
/** order 프로필 모의 세션: 1번 심장로를 키보드로(AUTO 꺼짐) 닫힌 체류 → 열린 유지 1초 → 이탈 → 닫힌 체류 → 열린 유지로 냉각. 모든 행이 스텝 단위다. */
function orderSession(over: any = {}) {
  const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
  s.discover(0); s.fight(0); s.readyUp(0);
  s.au = 0; s.mark('manual-start');
  s.onPad(0, 1, 0); s.mark('pad1');
  const dwell1 = over.shortDwell ? 5 : 60;
  for (let k = 1; k <= dwell1; k++) { if (over.attack && k === 20) { s.ah = 1; s.ps = 'attack'; } s.step(); }
  s.ah = 0; s.ps = 'move';
  s.g[0].ph = 1; for (let k = 0; k < (over.shortDwell ? 3 : 84); k++) s.step();
  s.g[0].ph = 2; for (let k = 0; k < (over.shortDwell ? 3 : 48); k++) s.step();
  const room = DEEP_ROOMS[0], g = s.g[0];
  g.ph = 0; g.sk = 1; g.po = 1; g.px = room.x + PAD_OFFSET; s.view(0, 'open'); s.step(); s.mark('shock1');
  s.skip(70); s.onPad(0, .2, 0);
  const partial = over.noPartial ? 20 : 70;
  for (let k = 1; k <= partial; k++) { s.hd = k * FRAME; if (over.holdClosed && k === 10) { g.po = 0; g.ph = 1; s.view(0, 'shock'); } s.step(); }
  s.mark('partial');
  s.hd = 0; s.hero = { x: g.px - PAD_OFFSET, z: g.pz }; if (over.holdClosed) { g.po = 1; g.ph = 0; s.view(0, 'open'); } s.step(); s.mark('exit');
  g.ph = 1; s.view(0, 'shock'); g.po = 0; s.step(); s.mark('warn');
  s.onPad(0, .4, 0);
  for (let k = 0; k < (over.shortDwell ? 3 : 84); k++) { if (over.holdWhileClosed && k === 30) s.hd = FRAME; else s.hd = 0; s.step(); }
  s.hd = 0;
  g.ph = 2; for (let k = 0; k < (over.shortDwell ? 3 : 48); k++) s.step();
  g.ph = 0; g.sk = 2; g.po = 1; g.px = room.x - PAD_OFFSET; s.view(0, 'open'); s.step(); s.mark('dwell-end');
  s.skip(70); s.onPad(0, .2, 0);
  const finalRows = over.finalShort ? 100 : 119;
  for (let k = 1; k <= finalRows; k++) { s.hd = k * FRAME; s.step(); }
  s.cool(0); s.mark('cooled');
  return s;
}
describe('order 프로필(analyzeOrder)', () => {
  const run = (s: Sim) => K.analyzeOrder(s.rows, DEEP, { rooms: DEEP_ROOMS });
  test('정상 키보드 세션: 닫힌 체류 합계 ≥ 2초 · 유지 ≥ 1.0 뒤 3.0 밖 이탈 · 새 유지로 냉각이 통과한다', () => {
    const a = run(orderSession());
    expect(a.ok).toBe(true);
    expect(a.dwell.seconds).toBeGreaterThanOrEqual(2);
    expect(a.partial.abortedMax).toBeGreaterThanOrEqual(1);
    expect(a.partial.exitDistance).toBeGreaterThanOrEqual(3);
    expect(a.final.seconds).toBeGreaterThanOrEqual(DEEP.holdSeconds - FRAME - 1e-6);
  });
  test('닫힌 체류가 2초 미만이면 dwell 이 실패한다', () => {
    const a = run(orderSession({ shortDwell: true }));
    expect(a.dwell.ok).toBe(false);
    expect(a.ok).toBe(false);
  });
  test('닫힌 조작판 위에서 hold 가 올라가면 dwell 이 실패한다', () => {
    const a = run(orderSession({ holdWhileClosed: true }));
    expect(a.dwell.holdWhileClosed).toBeGreaterThan(0);
    expect(a.dwell.ok).toBe(false);
  });
  test('이탈 전 열린 유지가 1.0초에 못 미치면 partial 이 실패한다', () => {
    const a = run(orderSession({ noPartial: true }));
    expect(a.partial.ok).toBe(false);
  });
  test('열린 유지가 중간에 닫히면(닫힌 상태의 hold) partial 구간이 열림으로 인정되지 않는다', () => {
    expect(run(orderSession({ holdClosed: true })).partial.ok).toBe(false);
  });
  test('최종 유지가 2초 − 1/60 에 못 미치면 final 이 실패한다', () => {
    const a = run(orderSession({ finalShort: true }));
    expect(a.final.ok).toBe(false);
  });
  test('키보드 구간에서 공격 입력이나 공격 state 가 있으면 keyboard 가 실패한다', () => {
    const a = run(orderSession({ attack: true }));
    expect(a.keyboard.ok).toBe(false);
    expect(a.keyboard.attackHeld).toBeGreaterThan(0);
  });
  describe('키보드 구간: AUTO 를 끄기 전에 시작된 동작의 이어짐만 면제한다', () => {
    const row = (n: number, ps: string, extra: any = {}) => ({ n, t: n * FRAME, ps, au: 0, ah: 0, al: 1, hp: 100, ...extra });
    const seg = (list: any[]) => { list[0].mk = 'from'; list[list.length - 1].mk = 'to'; return list; };
    test('구간 첫 행부터 이어진 공격 동작(입력 0)은 면제되고, 끝난 뒤 다시 생기면 실패한다', () => {
      const carried = seg([...Array.from({ length: 56 }, (_, i) => row(i, 'attack')), ...Array.from({ length: 30 }, (_, i) => row(56 + i, 'move'))]);
      const a = K.checkKeyboardSegment(carried, 'from', 'to');
      expect(a.ok).toBe(true); expect(a.carriedActionRows).toBe(56); expect(a.actionRows).toBe(0);
      const again = seg([...Array.from({ length: 20 }, (_, i) => row(i, 'attack')), ...Array.from({ length: 20 }, (_, i) => row(20 + i, 'idle')),
        ...Array.from({ length: 5 }, (_, i) => row(40 + i, 'dodge')), row(45, 'idle')]);
      expect(K.checkKeyboardSegment(again, 'from', 'to').ok).toBe(false);
    });
    test('구간 첫 행이 동작 중이 아니면 면제가 없고, 이어진 동작 중 공격 입력이 있으면 실패한다', () => {
      const fresh = seg([...Array.from({ length: 15 }, (_, i) => row(i, 'idle')), ...Array.from({ length: 5 }, (_, i) => row(15 + i, 'attack')), row(20, 'idle')]);
      const b = K.checkKeyboardSegment(fresh, 'from', 'to');
      expect(b.ok).toBe(false); expect(b.carriedActionRows).toBe(0);
      const pressed = seg([...Array.from({ length: 30 }, (_, i) => row(i, 'attack', i === 12 ? { ah: 1 } : {})), row(30, 'idle')]);
      expect(K.checkKeyboardSegment(pressed, 'from', 'to').ok).toBe(false);
    });
    test('이어진 동작 면제는 90스텝(1.5초)까지다', () => {
      const long = seg([...Array.from({ length: 120 }, (_, i) => row(i, 'attack')), row(120, 'idle')]);
      const a = K.checkKeyboardSegment(long, 'from', 'to');
      expect(a.ok).toBe(false); expect(a.carriedActionRows).toBe(90);
    });
  });
  test('AUTO 가 켜진 행이 구간에 있으면 실패하고, 영웅이 쓰러져도 실패한다', () => {
    const s = orderSession();
    s.rows[s.rows.findIndex(r => r.mk === 'pad1') + 3].au = 1;
    expect(run(s).keyboard.ok).toBe(false);
    const t = orderSession();
    t.rows[t.rows.findIndex(r => r.mk === 'pad1') + 3].al = 0;
    expect(run(t).keyboard.ok).toBe(false);
  });
  test('표식이 빠지면 판정 불가로 실패한다', () => {
    const s = orderSession();
    s.rows = s.rows.filter(r => r.mk !== 'warn');
    const a = run(s);
    expect(a.ok).toBe(false);
    expect(a.missing).toEqual(['warn']);
  });
});

// ---------- pause ----------
describe('pause 프로필(checkPause · analyzePauseCooling)', () => {
  const frozen = (over: any = {}) => ({ elapsed: 10, hd: 0, pr: 0, gx: [{ ag: 1.5, ph: 0, sk: 1 }], ...over });
  const good = () => ({ before: frozen({ hd: .85 }), paused: frozen(), still: frozen(), resumed: frozen({ elapsed: 10 + 30 * FRAME, hd: 12 * FRAME }), steps: 30 });
  test('정지 중 게임 시간·심장로 주기·progress 불변, hold 0, 재개 뒤 0 에서 새로 시작이면 통과한다', () => {
    expect(K.checkPause(good()).ok).toBe(true);
  });
  test('정지 중 게임 시간이 흐르면 실패한다', () => {
    const g = good(); g.still.elapsed = 10 + 120 * FRAME;
    expect(K.checkPause(g).frozen).toBe(false);
  });
  test('정지 중 심장로 주기(age)가 흐르면 실패한다', () => {
    const g = good(); g.still.gx[0].ag = 3.5;
    expect(K.checkPause(g).frozen).toBe(false);
  });
  test('정지 직후 hold 가 남아 있으면 실패한다', () => {
    const g = good(); g.paused.hd = .85;
    expect(K.checkPause(g).frozen).toBe(false);
  });
  test('정지 직전 hold 가 0.8 에 못 미치면 실패한다', () => {
    const g = good(); g.before.hd = .5;
    expect(K.checkPause(g).frozen).toBe(false);
  });
  test('재개 뒤 hold 가 정지 직전 값에서 이어지면(30프레임보다 크면) 실패한다', () => {
    const g = good(); g.resumed.hd = .9;
    expect(K.checkPause(g).resumedOk).toBe(false);
  });
  test('재개 뒤 첫 냉각의 유지가 재개 이후에 0 에서 시작해 2초 − 1/60 이상이고 열려 있으면 통과한다', () => {
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
    s.discover(0); s.fight(0); s.readyUp(0); s.closedWait(0, 30); s.shockCycle(0);
    s.skip(40); s.onPad(0, .2, 0);
    for (let k = 1; k <= 50; k++) { s.hd = k * FRAME; s.step(); }
    s.hd = 0; s.step(); s.mark('resume');
    s.hold(0); s.cool(0);
    const r = K.analyzePauseCooling(s.rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS });
    expect(r.ok).toBe(true);
    expect(r.runStartN).toBeGreaterThan(r.resumeN);
  });
  test('재개 전 시작한 유지가 이어져 냉각하면(재개 뒤 새 유지가 아니면) 실패한다', () => {
    const s = new Sim(DEEP, DEEP_ROOMS, REINFORCEMENTS, true);
    s.discover(0); s.fight(0); s.readyUp(0); s.closedWait(0, 30); s.shockCycle(0);
    s.skip(40); s.onPad(0, .2, 0);
    s.hd = 10 * FRAME; s.step(); s.mark('resume');
    for (let k = 11; k <= 119; k++) { s.hd = k * FRAME; s.step(); }
    s.cool(0);
    expect(K.analyzePauseCooling(s.rows, DEEP, { rooms: DEEP_ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
  });
  test('resume 표식이 없으면 판정 불가', () => {
    expect(K.analyzePauseCooling(deepSession().rows, DEEP, { rooms: DEEP_ROOMS }).reason).toBe('missing-mark');
  });
});

// ---------- screens ----------
describe('screens 프로필', () => {
  const shotRow = (over: any = {}) => ({ pr: 0, g: [{ dc: 1, at: 0, rd: 1, po: 0, ra: null }], rv: { c: 40, d: 2, s: [NAMES.indexOf('shock')], cs: [1] }, ...over });
  const want = { gate: 0, state: 'shock' };
  test('모든 순간에 도달하고 PNG 가 viewport 개수만큼 있어야 한다', () => {
    const labels = ['bound', 'shock'];
    expect(K.checkScreens([{ label: 'bound', reached: true, files: ['a', 'b', 'c'] }, { label: 'shock', reached: true, files: ['a', 'b', 'c'] }], labels, 3).ok).toBe(true);
    expect(K.checkScreens([{ label: 'bound', reached: true, files: ['a', 'b', 'c'] }, { label: 'shock', reached: false }], labels, 3).ok).toBe(false);
    expect(K.checkScreens([{ label: 'bound', reached: true, files: ['a', 'b'] }, { label: 'shock', reached: true, files: ['a', 'b', 'c'] }], labels, 3).ok).toBe(false);
  });
  test('촬영 스텝의 관측 기대 상태와 같은 스텝 releaseView.states·사슬 scale 이 맞으면 통과하고 states 를 돌려준다', () => {
    const r = K.checkScreenMoment({ capture: shotRow() }, DEEP, want, { releaseExpected: true });
    expect(r.ok).toBe(true);
    expect(r.states).toEqual(['shock']);
  });
  test('뷰 states 가 다르면 실패한다(관측은 shock 인데 뷰는 open)', () => {
    const r = K.checkScreenMoment({ capture: shotRow({ rv: { c: 40, d: 2, s: [NAMES.indexOf('open')], cs: [1] } }) }, DEEP, want, { releaseExpected: true });
    expect(r.ok).toBe(false);
  });
  test('보이는 상태인데 사슬 scale 이 0 이거나 released 인데 남으면 실패한다', () => {
    expect(K.checkScreenMoment({ capture: shotRow({ rv: { c: 40, d: 2, s: [NAMES.indexOf('shock')], cs: [0] } }) }, DEEP, want, { releaseExpected: true }).ok).toBe(false);
    const released = { capture: { pr: 1, g: [{ dc: 1, at: 1, rd: 1, po: 0, ra: 2.1 }], rv: { c: 40, d: 2, s: [NAMES.indexOf('released')], cs: [.5] } } };
    expect(K.checkScreenMoment(released, DEEP, { gate: 0, state: 'released' }, { releaseExpected: true }).ok).toBe(false);
    released.capture.rv.cs = [0];
    expect(K.checkScreenMoment(released, DEEP, { gate: 0, state: 'released' }, { releaseExpected: true }).ok).toBe(true);
  });
  test('관측 상태가 라벨과 다르면 실패한다(open 을 찍었는데 아직 닫힘)', () => {
    expect(K.checkScreenMoment({ capture: shotRow() }, DEEP, { gate: 0, state: 'open' }, { releaseExpected: false }).ok).toBe(false);
  });
  test('releasing 은 reduced motion 에서 사슬이 즉시 사라져도 통과한다', () => {
    const rel = { capture: { pr: 1, g: [{ dc: 1, at: 1, rd: 1, po: 0, ra: .3 }], rv: { c: 40, d: 2, s: [NAMES.indexOf('releasing')], cs: [0] } } };
    expect(K.checkScreenMoment(rel, DEEP, { gate: 0, state: 'releasing' }, { releaseExpected: true }).ok).toBe(true);
  });
});

// ---------- 기준선 비교 ----------
describe('기준선 비교(compareTargetsOk · compareSetup · compareRuns)', () => {
  const side = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', furnacesOk: true, routeDefinition: DEEP, ...over });
  test('심층: 기준선 정의 없음 · 후보 해방 정의 있음 · HEAD 가 다르고 후보 판정 통과여야 한다', () => {
    const base = side({ head: 'b'.repeat(40), routeDefinition: null, furnacesOk: null });
    expect(K.compareTargetsOk(side(), base, 'deep')).toBe(true);
    expect(K.compareTargetsOk(side({ furnacesOk: false }), base, 'deep')).toBe(false);
    expect(K.compareTargetsOk(side(), side({ head: 'b'.repeat(40) }), 'deep')).toBe(false);   // 기준선에도 정의가 있으면 다른 빌드가 아니다
    expect(K.compareTargetsOk(side(), side({ routeDefinition: null }), 'deep')).toBe(false);   // 같은 HEAD
    expect(K.compareTargetsOk(side({ routeDefinition: STD }), base, 'deep')).toBe(false);   // 후보에 해방 연출 정의가 없음
    expect(K.compareTargetsOk(side(), side({ head: 'b'.repeat(40), routeDefinition: null, status: 'fail' }), 'deep')).toBe(false);
    expect(K.compareTargetsOk(side({ runStatus: 'fail' }), base, 'deep')).toBe(false);
  });
  test('일반: 양쪽 정의가 같고 해방 연출이 없고 HEAD 가 달라야 한다', () => {
    const cand = side({ routeDefinition: STD });
    const base = side({ routeDefinition: STD, head: 'b'.repeat(40), furnacesOk: true });
    expect(K.compareTargetsOk(cand, base, 'standard')).toBe(true);
    expect(K.compareTargetsOk(cand, { ...base, routeDefinition: null }, 'standard')).toBe(false);
    expect(K.compareTargetsOk(cand, { ...base, head: cand.head }, 'standard')).toBe(false);
    expect(K.compareTargetsOk({ ...cand, routeDefinition: DEEP }, { ...base, routeDefinition: DEEP }, 'standard')).toBe(false);
    expect(K.compareTargetsOk(cand, { ...base, routeDefinition: { ...STD, holdSeconds: 3 } }, 'standard')).toBe(false);
  });
  test('실행 설정(영웅·시드·depth·재시드·viewport·motion·quality)이 모두 같아야 한다', () => {
    const a = { heroId: 'knight', seed: 20261015, depth: 'deep', reseedOn: true, viewport: { width: 844, height: 390 }, motion: 'reduce', quality: 'low' };
    expect(K.compareSetup(a, { ...a }).ok).toBe(true);
    expect(K.compareSetup(a, { ...a, heroId: 'mage' }).ok).toBe(false);
    expect(K.compareSetup(a, { ...a, seed: 1 }).ok).toBe(false);
    expect(K.compareSetup(a, { ...a, reseedOn: false }).ok).toBe(false);
    expect(K.compareSetup(a, { ...a, viewport: { width: 640, height: 360 } }).ok).toBe(false);
    expect(K.compareSetup(a, { ...a, quality: 'default' }).ok).toBe(false);
    expect(K.compareSetup({ ...a, motion: undefined }, { ...a, motion: undefined }).ok).toBe(false);
  });
  const gpuOk = { ok: true, samples: 6, max: 2, limit: 2, coverage: { bound: true, open: true, releasing: true } };
  const runSide = (time: number, over50: number, over: any = {}) => ({ time, runOver50: over50, steps: 70000, samples: [], furnaceRooms: [2, 4, 5, 7], viewGpu: gpuOk, ...over });
  test('게이트: 시간 비 ≤ 2.0 · 50ms 초과 ≤ 기준선 + 2 · 심층은 해방 뷰 A/B 통과', () => {
    const r = K.compareRuns(runSide(150, 3), runSide(100, 1), { depth: 'deep' });
    expect(r.ok).toBe(true);
    expect(r.gates).toEqual({ time: true, slow: true, viewGpu: true });
    expect(K.compareRuns(runSide(201, 0), runSide(100, 0), { depth: 'deep' }).gates.time).toBe(false);
    expect(K.compareRuns(runSide(200, 0), runSide(100, 0), { depth: 'deep' }).gates.time).toBe(true);
    expect(K.compareRuns(runSide(100, 4), runSide(100, 1), { depth: 'deep' }).gates.slow).toBe(false);
    expect(K.compareRuns(runSide(100, 3), runSide(100, 1), { depth: 'deep' }).gates.slow).toBe(true);
    const bad = K.compareRuns(runSide(100, 1, { viewGpu: { ...gpuOk, ok: false } }), runSide(100, 1), { depth: 'deep' });
    expect(bad.gates.viewGpu).toBe(false);
    expect(bad.ok).toBe(false);
    expect(K.compareRuns(runSide(100, 1, { viewGpu: null }), runSide(100, 1), { depth: 'deep' }).ok).toBe(false);
  });
  test('완주 시간이 없는(패배) 실행은 시간 게이트를 통과하지 못한다', () => {
    expect(K.compareRuns(runSide(null as any, 0), runSide(100, 0), { depth: 'deep' }).gates.time).toBe(false);
    expect(K.compareRuns(runSide(100, 0), runSide(null as any, 0), { depth: 'deep' }).gates.time).toBe(false);
  });
  test('일반: 해방 뷰 게이트가 없고, 시간 비 1.00 ± 0.05 는 보고 항목이다', () => {
    const r = K.compareRuns(runSide(103, 0, { viewGpu: null }), runSide(100, 0), { depth: 'standard' });
    expect(r.gates).toEqual({ time: true, slow: true });
    expect(r.report.timeParity.within).toBe(true);
    expect(r.report.timeParity.applies).toBe(true);
    const off = K.compareRuns(runSide(110, 0, { viewGpu: null }), runSide(100, 0), { depth: 'standard' });
    expect(off.report.timeParity.within).toBe(false);
    expect(off.ok).toBe(true);
  });
  test('심장로 방 첫 진입 draw call 증가와 50ms 초과율은 보고 항목이며 게이트를 막지 않는다', () => {
    const sample = (roomId: number, calls: number) => ({ label: 'roomEnter', roomId, calls });
    const cand = runSide(100, 0, { samples: [sample(2, 40), sample(4, 44), sample(5, 41), sample(7, 41)] });
    const base = runSide(100, 0, { samples: [sample(2, 30), sample(4, 30), sample(5, 41), sample(7, 41)] });
    const r = K.compareRuns(cand, base, { depth: 'deep' });
    expect(r.report.roomEnterDrawCalls.maxIncrease).toBe(14);
    expect(r.report.roomEnterDrawCalls.matched).toBe(4);
    expect(r.ok).toBe(true);
    expect(r.report.over50PerThousandSteps.cand).toBe(0);
  });
  test('짝이 없는 방은 matched 에서 빠진다', () => {
    const r = K.roomDrawCalls([{ label: 'roomEnter', roomId: 2, calls: 50 }], [{ label: 'roomEnter', roomId: 4, calls: 40 }], [2, 4]);
    expect(r.matched).toBe(0);
    expect(r.maxIncrease).toBe(null);
  });
  test('stepStats 와 percentile', () => {
    const s = K.stepStats([1, 2, 3, 60, 70]);
    expect(s).toMatchObject({ n: 5, max: 70, over: 2 });
    expect(K.percentile([], .5)).toBe(null);
  });
});
