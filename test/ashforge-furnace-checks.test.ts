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

// ---------- 거수 사슬 끊기(BUNDLE-15) ----------
// 문구·수치는 PLAN 3.1 · 3.2 · 3.4 계약을 이 파일에 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const CH: any = { id: 'ashforge_deep_chains', boss: 'ash_colossus', signature: 'kiln_hammer', count: 3, window: 5, hold: 1.2, radius: 1.6, pillarOffset: 8.4, anchorMargin: 1.2, exposed: 5, exposedMult: 2, weaken: .1 };
/** 도구가 페이지에서 읽는 보스 def.range(ash_colossus). open 의 '쫓지 않음'은 영웅-보스 거리가 이 값 × .92 + .3 보다 먼 추격 스텝에만 적용된다. */
const RANGE = 3.6;
const FAR = RANGE * .92 + .3;
const BR = { id: 8, x: 150, z: 29, w: 28, h: 28 };
const SIG = 'kiln_hammer';
const T = {
  attach: '거수의 사슬 3개 · 망치가 끄는 반대편 기둥에서 버티세요', open: '사슬 기둥 열림 · 5초 안에 1.2초 버티기', free: '거수의 사슬이 모두 끊겼다',
  cut: (n: number) => '사슬 끊김 ' + n + '/3 · 거수가 휘청인다', plain: (n: number) => '남은 사슬 ' + n + '/3 · 망치가 끄는 반대편 기둥에서 버티기',
  pull: '사슬이 망치 쪽으로 끌림 · 반대편 기둥으로', openDom: (w: string, h: string) => '기둥 열림 ' + w + '초 · 행동 없이 ' + h + '/1.2초', exposedDom: (w: string, pct = 220) => '사슬 끊김 · 휘청 ' + w + '초 · 받는 피해 ' + pct + '%',
};
const ceil1 = (v: number) => (Math.ceil(v * 10 - 1e-9) / 10).toFixed(1);
const floor1 = (v: number) => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1);

/**
 * 페이지 프로브가 남기는 사슬 행을 만드는 모의 세션. 컨트롤러는 PLAN 3.2 의 읽기 상태 이름을 가진 평범한 모의(규칙을 이 파일이 직접 구현)이고,
 * 보스·영웅은 시나리오가 스텝마다 선언한다. 옵션(o)으로 규칙을 일부러 어겨 변이 표본을 만든다.
 */
class ChainSim {
  rows: any[] = []; toasts: any[] = []; filters: any[] = []; marks: any[] = []; n = 0;
  st = 'idle'; cuts = 0; wins = 0; miss = 0; brk = 0; side = 0; pillar: any = { x: 0, z: 0 }; anchor: any = { x: 0, z: 0 }; hd = 0; wl = 0; el = 0; ed = 0; lc: number | null = null;
  lastHp = Infinity; watch = 0; opened = 0; lagLeft = 0;
  boss: any = { bo: 0, al: 0, spn: 1, bs: 'chase', sp: null, pk: null, ix: null, iz: null, sq: 0, cq: 0, by: 1.2, bx: BR.x, bz: BR.z, bvx: 0, bvz: 0 };
  hero: any = { x: BR.x, z: BR.z + 6, hp: 100, ha: 1, ps: 'move', au: 1 };
  cat: string | null = null; catSince = 0; stable = 0; shown: string | null = null; lastDom: string | null = null; pause = 0;
  constructor(public o: any = {}, public def: any = CH) { this.o = { lag: 0, ...o }; }
  toast(msg: string) { this.toasts.push({ n: this.n, t: this.n * FRAME, msg, kind: 'gold' }); }
  step() { this.n++; this.ctl(); this.snap(); }
  tick(k: number) { for (let i = 0; i < k; i++) this.step(); }
  tickUntil(fn: () => boolean, max = 800) { let k = 0; while (!fn() && k++ < max) this.step(); }
  heroAt(x: number, z: number, ps = 'move') { Object.assign(this.hero, { x, z, ps }); }
  /** 영웅이 한 스텝에 최대 speed 씩 목표로 걷는다(순간이동이 아님). 도착하면 ps 로 선다. */
  walk(x: number, z: number, ps = 'idle', speed = .12) {
    let k = 0;
    while (Math.hypot(x - this.hero.x, z - this.hero.z) > speed && k++ < 400) {
      const dx = x - this.hero.x, dz = z - this.hero.z, l = Math.hypot(dx, dz);
      this.hero.x += dx / l * speed; this.hero.z += dz / l * speed; this.hero.ps = 'move'; this.step();
    }
    this.heroAt(x, z, ps);
  }
  // ---- 컨트롤러 모의(PLAN 3.2) ----
  ctl() {
    const dt = FRAME, d = this.def, b = this.boss;
    if (this.st === 'ended') return;
    if (b.bo && !b.al) { this.st = 'ended'; return; }
    if (this.st === 'idle') { if (b.bo && b.al && !b.spn && this.n >= (this.o.attachAt ?? 0)) { this.st = 'chained'; this.toast(T.attach); if (this.o.noAttachToast) this.toasts.pop(); } return; }
    if (this.lc !== null) this.lc += dt;
    if (this.st === 'open') {
      this.wl -= dt;
      const h = this.hero, hurt = h.hp < this.lastHp - 1e-9; this.lastHp = h.hp;
      const inside = Math.hypot(h.x - this.pillar.x, h.z - this.pillar.z) <= (this.o.holdRadius ?? d.radius);
      const stable = this.o.ignoreState ? true : (h.ps === 'idle' || h.ps === 'move');
      this.hd = inside && stable && (this.o.ignoreHurt || !hurt) ? this.hd + dt : 0;
      if (this.hd + 1e-9 >= (this.o.hold ?? d.hold)) { this.cut(); return; }
      if (this.wl <= 1e-9) { this.wl = 0; this.hd = 0; this.side = 0; this.miss += this.o.doubleMiss ? 2 : 1; this.st = 'chained'; }
      return;
    }
    if (this.st === 'exposed') {
      this.el -= dt;
      if (this.el <= 1e-9) { this.el = 0; if (this.cuts < d.count) this.st = 'chained'; else { this.st = 'unchained'; if (!this.o.noFreeToast) this.toast(T.free); } }
      return;
    }
    this.watchHammer();
  }
  watchHammer() {
    const b = this.boss, casting = b.bs === 'attack' && b.sp === SIG && b.pk === SIG;
    if (this.watch) {
      if (b.cq === this.watch) {
        if (this.lagLeft < (this.o.openLag ?? 0)) { this.lagLeft++; return; }
        this.lagLeft = 0; this.watch = 0; if (!this.o.skipOpen) this.open(); return;
      }
      if (!casting || b.sq !== this.watch) { if (!this.o.noBroken) this.brk++; this.watch = 0; this.side = 0; } else return;
    }
    if (casting && b.sq !== this.opened) {
      this.watch = b.sq;
      if (!this.o.noPull) this.startPull();
    }
  }
  startPull() {
    const b = this.boss, d = this.def, dx = b.ix - BR.x;
    let side = Math.abs(dx) >= 1 ? Math.sign(dx) : (this.wins % 2 ? -1 : 1);
    if (this.o.wrongSide) side = -side;
    this.side = side;
    const off = this.o.pillarOffset ?? d.pillarOffset;
    this.pillar = { x: Math.max(BR.x - BR.w / 2 + 1.2, Math.min(BR.x + BR.w / 2 - 1.2, BR.x - side * off)), z: BR.z };
    this.anchor = { x: BR.x + side * (BR.w / 2 - d.anchorMargin) + (this.o.anchorShift ?? 0), z: b.bz + (this.o.anchorZShift ?? 0) };
  }
  open() {
    this.opened = this.boss.sq; this.st = 'open'; this.wl = this.def.window; this.wins++; this.hd = 0; this.lastHp = this.hero.hp;
    if (!this.o.noOpenToast) this.toast(T.open);
  }
  forceOpen() { this.opened = this.boss.sq; this.st = 'open'; this.wl = this.def.window; this.wins++; this.hd = 0; this.lastHp = this.hero.hp; this.toast(T.open); }
  cut() {
    this.cuts += this.o.cutStep ?? 1; this.hd = 0; this.wl = 0; this.side = 0; this.lc = 0; this.st = 'exposed'; this.el = this.def.exposed;
    this.toast(T.cut(this.o.cutToastN ?? this.cuts));
  }
  // ---- 보스 시나리오 ----
  appear() { Object.assign(this.boss, { bo: 1, al: 1, spn: 1 }); this.tick(3); this.boss.spn = 0; this.tick(1); }
  startCast(ix: number, sig = SIG) { Object.assign(this.boss, { sq: this.boss.sq + 1, bs: 'attack', sp: sig, pk: sig, ix, iz: this.hero.z }); }
  completeCast() { this.boss.cq = this.boss.sq; }
  endCast() { Object.assign(this.boss, { bs: 'chase', sp: null, pk: null }); }
  /**
   * 모의 컨트롤러의 filter(PLAN 3.6): 배율 = 약화 (1 + weaken × 끊은 수) × 휘청(exposedMult, exposed 에서만). idle·ended 는 1배.
   * 변이 옵션: noWeaken(약화 무시)·noWeakenExposed(휘청에서만 약화 빠짐)·noWeakenFree(unchained 에서 약화 빠짐)·exposedMult(휘청 배율 변경)·multOutside·filterCutsBias(곱하는 끊김 수가 틀림)·edBasisBonus.
   */
  hurtBoss(dmg: number) {
    const d = this.def, st = this.st, exposed = st === 'exposed', live = st !== 'idle' && st !== 'ended';
    const k = (this.o.filterCuts ?? this.cuts) + (this.o.filterCutsBias ?? 0);
    const dropWeaken = this.o.noWeaken || (this.o.noWeakenFree && st === 'unchained') || (this.o.noWeakenExposed && exposed);
    let mult = live && !dropWeaken ? 1 + d.weaken * k : 1;
    if (exposed) mult *= this.o.exposedMult ?? d.exposedMult;
    else if (this.o.multOutside) mult *= 1.5;
    const out = dmg * mult;
    if (exposed) this.ed += this.o.edBasisBonus ? out - dmg : out;
    this.filters.push({ n: this.n + 1, dmg, out, st });
  }
  killBoss() { this.boss.al = 0; this.tick(5); }
  /** 목표창 문구(제목 + 상태별 계약 문장). */
  domText(cat: string) {
    const title = '거수의 사슬';
    if (cat === 'plain') return title + T.plain(this.def.count - this.cuts);
    if (cat === 'pull') return title + T.pull;
    if (cat === 'open') return title + T.openDom(ceil1(this.wl), floor1(this.hd));
    return title + T.exposedDom(ceil1(this.el), Math.round((1 + this.def.weaken * this.cuts) * this.def.exposedMult * 100));
  }
  snap() {
    const b = this.boss, h = this.hero, st = this.st, d = this.def;
    const open = st === 'open', exposed = st === 'exposed', pulling = st === 'chained' && this.side !== 0;
    const row: any = { n: this.n, t: this.n * FRAME, hx: h.x, hz: h.z, hp: h.hp, ha: h.ha, au: h.au, ps: h.ps,
      cs: st, cl: d.count - this.cuts, cu: this.cuts, cw: this.wins, cm: this.miss, cb: this.brk, pu: pulling ? 1 : 0, sd: st === 'chained' || open ? this.side : 0,
      qx: this.pillar.x, qz: this.pillar.z, ax: this.anchor.x, az: this.anchor.z, hd: open ? this.hd : 0, ht: d.hold, wl: open ? this.wl : 0, wt: d.window, el: exposed ? this.el : 0, et: d.exposed,
      ed: this.ed, lc: this.lc, bo: b.bo, al: b.al, spn: b.spn, bs: b.bs, sp: b.sp, pk: b.pk, ix: b.ix, iz: b.iz, sq: b.sq, cq: b.cq, by: b.by, bx: b.bx, bz: b.bz, bvx: b.bvx, bvz: b.bvz };
    // 목표창 표본: 범주가 바뀐 뒤 o.lag 스텝 동안은 바로 앞 문구가 남는다(10Hz 갱신 대기 모의). open·exposed 는 문구가 바뀐 스텝, plain·pull 은 36번째 행에서 읽는다.
    const cat = exposed ? 'exposed' : open ? 'open' : pulling ? 'pull' : st === 'chained' ? 'plain' : null;
    if (cat !== this.cat) { this.cat = cat; this.catSince = this.n; this.stable = 0; if (cat === 'open' || cat === 'exposed' || cat === null) this.lastDom = null; }
    if (cat) {
      // o.refresh 가 있으면 범주와 상관없이 그 스텝 주기에만 다시 그린다(실제 패널의 10Hz 고정 주기 모의).
      if (this.o.refresh ? this.n % this.o.refresh === 0 : this.n - this.catSince >= (this.o.lag ?? 0)) this.shown = this.o.domOverride?.(cat, row) ?? this.domText(cat);
      if (cat === 'open' || cat === 'exposed') {
        if (this.shown !== this.lastDom) { row.dom = this.shown; this.lastDom = this.shown; }
        else if (this.n - this.catSince === 10) row.dom = this.shown;   // 갱신 주기를 넘긴 시점에는 바뀌지 않았어도 항상 읽는다
      }
      else if (++this.stable === 36) row.dom = this.shown;
    }
    this.rows.push(row);
  }
  /** 한 번의 망치: 끌기 → 마지막 고리 → 창 → (끊김 → 노출) 또는 놓침. 영웅은 평소 방 아래쪽에서 이동하고, 창이 열리면 기둥으로 간다. */
  cycle({ ix, mode = 'cut', castSteps = 100, idle = 45, hits = 2, fightHero = false }: any) {
    this.heroAt(BR.x, BR.z + 6, 'move'); this.tick(idle / 2); this.hurtBoss(30); this.tick(idle - idle / 2);
    this.startCast(ix); this.tick(castSteps);
    this.completeCast(); this.step();
    const near = mode === 'cut' ? { x: this.pillar.x, z: this.pillar.z } : { x: BR.x, z: BR.z + 9 };
    this.heroAt(this.o.heroOffset ? near.x + this.o.heroOffset : near.x, near.z, mode === 'cut' ? (this.o.heroState ?? 'idle') : 'move');
    let k = 0;
    while (this.st === 'open' && k < 500) { if (k === 63) this.endCast(); if (k === 10) this.hurtBoss(25); if (this.o.hurtAt === k) this.hero.hp -= 5; this.step(); k++; }
    if (this.boss.bs === 'attack') this.endCast();
    if (this.st === 'exposed') {
      for (let i = 0; i < hits; i++) { this.tick(40); this.hurtBoss(100); }
      if (fightHero) this.hurtBoss(50);
      this.tickUntil(() => this.st !== 'exposed', 600);
    }
  }
  result() {
    const c = { id: this.def.id, count: this.def.count, windows: this.wins, cuts: this.cuts, misses: this.miss, exposedDamage: Math.round(this.ed), broken: this.brk };
    const line = '거수의 사슬 끊음 ' + c.cuts + '/' + c.count + ' · 기둥 창 ' + c.windows + '번 · 놓침 ' + c.misses + '번';
    return { ro: { id: 'ashforge_heart_furnaces_deep', complete: true, chains: c }, line };
  }
}
const IMPACTS = [BR.x + 6, BR.x - 6, BR.x + 6];
/** 정상 세션: 거수 등장 → 망치 3번 → 매번 끊김 → 노출 → 사슬 모두 끊김(unchained) → 보스 처치. */
function chainSession(o: any = {}, cycles: any[] = [{ ix: IMPACTS[0] }, { ix: IMPACTS[1] }, { ix: IMPACTS[2] }], def: any = CH) {
  const s = new ChainSim(o, def);
  s.tick(5); s.appear();
  for (const c of cycles) s.cycle(c);
  s.tick(20); if (s.st === 'unchained') s.hurtBoss(40);   // unchained 에도 약화 배율(1 + weaken × count)이 남는다
  s.tick(2); s.killBoss();
  return s;
}
const chainObs = (s: ChainSim, over: any = {}) => {
  const r = s.result();
  return { rows: s.rows, filters: s.filters, toasts: s.toasts, room: BR, bossRange: RANGE, result: r.ro, resultText: '원정 결과 ' + r.line + ' 전투 시간', resultLines: [{ aria: '거수의 사슬 결과', text: r.line }], encounterTactic: null, ...over };
};
const analyzeCh = (s: ChainSim, over: any = {}, opts: any = { autoCuts: true }, def: any = CH) => K.analyzeChains(chainObs(s, over), def, opts);

describe('거수 사슬 정의·기하(checkChainsDefinition · chainsExpectedGeometry)', () => {
  test('계약 정의는 통과하고 수치 하나라도 다르면 해당 항목이 issues 에 남는다', () => {
    expect(K.checkChainsDefinition(CH).ok).toBe(true);
    for (const [key, value] of [['window', 6], ['count', 4], ['hold', 1], ['radius', 2], ['pillarOffset', 7], ['anchorMargin', 1], ['exposed', 4], ['exposedMult', 1.5], ['weaken', .2], ['boss', 'x'], ['signature', 'y'], ['id', 'z']]) {
      const r = K.checkChainsDefinition({ ...CH, [key as string]: value });
      expect(r.ok).toBe(false);
      expect(r.issues.map((i: any) => i.field)).toEqual([key]);
    }
    expect(K.checkChainsDefinition(null).ok).toBe(false);
  });
  test('통합 뒤 실제 정의(ROUTE_OBJECTIVES.ashforge_deep.chains)가 있으면 계약과 같고, 다른 정의에는 없다', () => {
    const real = DEEP.chains;
    if (real) expect(K.checkChainsDefinition(real).ok).toBe(true);
    for (const id of Object.keys(ROUTE_OBJECTIVES as any)) if (id !== 'ashforge_deep') expect((ROUTE_OBJECTIVES as any)[id].chains).toBeUndefined();
  });
  test('끌기 방향: 착탄점이 방 중심에서 1 이상 떨어지면 그쪽 부호, 안쪽이면 이전 창 수의 짝홀이다', () => {
    const g = (ix: number, w = 0) => K.chainsExpectedGeometry(BR, ix, w, 33, CH);
    expect(g(BR.x + 6).side).toBe(1);
    expect(g(BR.x - 6).side).toBe(-1);
    expect(g(BR.x + 1).side).toBe(1);
    expect(g(BR.x - 1).side).toBe(-1);
    expect(g(BR.x + .99, 0).side).toBe(1);
    expect(g(BR.x + .99, 1).side).toBe(-1);
    expect(g(BR.x - .5, 2).side).toBe(1);
    expect(g(BR.x, 3).side).toBe(-1);
  });
  test('기둥은 방 중심 반대편 pillarOffset 이고 방 안쪽(가장자리 1.2)으로 잘리며, 벽 지점은 벽 − anchorMargin 에 시전 때의 보스 z 다', () => {
    const e = K.chainsExpectedGeometry(BR, BR.x + 6, 0, 33, CH);
    expect(e.pillar).toEqual({ x: BR.x - 8.4, z: BR.z });
    expect(e.anchor).toEqual({ x: BR.x + 14 - 1.2, z: 33 });
    const small = { ...BR, w: 14, h: 28 };
    expect(K.chainsExpectedGeometry(small, small.x + 6, 0, 30, CH).pillar.x).toBe(small.x - 5.8);   // 7 − 1.2 로 잘림
    expect(K.chainsExpectedGeometry(small, small.x - 6, 0, 30, CH).pillar.x).toBe(small.x + 5.8);
  });
  test('tenths: 경계에서 올림·내림 두 구현의 문구를 모두 허용한다', () => {
    expect(K.tenths(4.9, 'ceil')).toEqual(['4.9']);
    expect(K.tenths(4.90000000001, 'ceil')).toEqual(['5.0', '4.9']);
    expect(K.tenths(.95, 'floor')).toEqual(['0.9']);
    expect(K.tenths(1.2 - 1e-12, 'floor')).toEqual(['1.1', '1.2']);
  });
});

describe('거수 사슬 종합(analyzeChains)', () => {
  test('정상 세션(끊김 3번·노출·unchained·보스 처치)은 모든 항목을 통과하고 AUTO 수용(끊김 ≥ 1)도 통과한다', () => {
    const s = chainSession();
    const a = analyzeCh(s);
    expect(failing(a)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.windowCount).toBe(3);
    expect(a.cutCount).toBe(3);
    expect(a.geometry.pulled).toBe(3);
    expect(a.geometry.casts.map((c: any) => c.wantSide)).toEqual([1, -1, 1]);
    expect(a.filters.basis).toBe('output');
    expect(a.toasts).toMatchObject({ attach: 1, opened: 3, freed: 1, wantFreed: 1 });
    expect(a.windows.every((w: any) => w.hold.seconds >= 1.2 - FRAME)).toBe(true);
    expect(a.result.ok).toBe(true);
  });
  test('놓친 창(영웅이 기둥 밖)은 window ± 1/60 로 끝나고 misses 로 세며, 이어지는 끊김도 통과한다', () => {
    const s = chainSession({}, [{ ix: IMPACTS[0], mode: 'miss' }, { ix: IMPACTS[1] }]);
    const a = analyzeCh(s, {}, { autoCuts: true });
    expect(failing(a)).toEqual(['toasts'].filter(() => false));
    expect(a.ok).toBe(true);
    expect(a.missCount).toBe(1);
    expect(a.cutCount).toBe(1);
    expect(a.windows[0].endKind).toBe('miss');
    expect(Math.abs(a.windows[0].length - 5)).toBeLessThanOrEqual(FRAME + 1e-9);
    expect(a.toasts.wantFreed).toBe(0);
  });
  test('마지막 고리 없이 끝난 망치는 broken 으로 세고(독립 집계 일치), 이어진 망치는 창을 연다', () => {
    const s = new ChainSim();
    s.tick(5); s.appear();
    s.heroAt(BR.x, BR.z + 6); s.tick(10);
    s.startCast(IMPACTS[0]); s.tick(40); s.endCast(); s.tick(5);   // 마지막 고리 없이 끝남
    s.cycle({ ix: IMPACTS[1] });
    s.tick(10); s.killBoss();
    const a = analyzeCh(s, {}, { autoCuts: true });
    expect(a.counts.derived.broken).toBe(1);
    expect(a.ok).toBe(true);
    const lazy = new ChainSim({ noBroken: true });
    lazy.tick(5); lazy.appear(); lazy.heroAt(BR.x, BR.z + 6); lazy.tick(10);
    lazy.startCast(IMPACTS[0]); lazy.tick(40); lazy.endCast(); lazy.tick(5);
    lazy.cycle({ ix: IMPACTS[1] }); lazy.tick(10); lazy.killBoss();
    const b = analyzeCh(lazy, {}, { autoCuts: true });
    expect(b.acceptance.countsConsistent).toBe(false);
    expect(failing(b)).toEqual(['countsConsistent']);
  });
  test('보스가 창 도중 쓰러지면(truncated) 길이 상한만 보고 통과한다', () => {
    const s = new ChainSim();
    s.tick(5); s.appear(); s.heroAt(BR.x, BR.z + 6); s.tick(10);
    s.startCast(IMPACTS[0]); s.tick(100); s.completeCast(); s.step();
    s.heroAt(BR.x + 9, BR.z + 9); s.tick(100); s.boss.al = 0; s.tick(5);
    const a = analyzeCh(s, {}, { autoCuts: false });
    expect(a.windows[0].endKind).toBe('truncated');
    expect(a.acceptance.windowLength).toBe(true);
    expect(a.ok).toBe(true);
  });
  test('열림 규칙 변이: 다른 시그니처 뒤·트리거 없음·늦은 열림·같은 망치 두 번·끌기 없음·열리지 않음은 각각 해당 항목이 실패한다', () => {
    // 다른 시그니처가 완성된 뒤 열림
    const wrong = new ChainSim(); wrong.tick(5); wrong.appear(); wrong.heroAt(BR.x, BR.z + 6); wrong.tick(10);
    wrong.startCast(IMPACTS[0], 'slam'); wrong.tick(30); wrong.completeCast(); wrong.step(); wrong.boss.bs = 'chase'; wrong.forceOpen(); wrong.tick(310); wrong.killBoss();
    const w = analyzeCh(wrong, {}, { autoCuts: false });
    expect(w.windows[0].reasons).toContain('wrong-signature');
    expect(w.acceptance.noEarlyOpen).toBe(false);
    // 트리거 없음
    const none = new ChainSim(); none.tick(5); none.appear(); none.tick(10); none.forceOpen(); none.tick(310); none.killBoss();
    const n = analyzeCh(none, {}, { autoCuts: false });
    expect(n.windows[0].reasons).toContain('no-trigger');
    expect(n.acceptance.noEarlyOpen).toBe(false);
    // 늦은 열림(3스텝 지연)
    const late = chainSession({ openLag: 3 });
    const l = analyzeCh(late);
    expect(l.windows[0].reasons).toContain('late-open');
    expect(l.acceptance.openTiming).toBe(false);
    // 1스텝 지연은 허용
    expect(analyzeCh(chainSession({ openLag: 1 })).acceptance.openTiming).toBe(true);
    // 같은 망치로 두 번 열림
    const dup = new ChainSim({}); dup.tick(5); dup.appear(); dup.cycle({ ix: IMPACTS[0], mode: 'miss' }); dup.forceOpen(); dup.tick(310); dup.killBoss();
    const d = analyzeCh(dup, {}, { autoCuts: false });
    expect(d.windows.at(-1).reasons.length).toBeGreaterThan(0);
    expect(d.acceptance.openTiming && d.acceptance.noEarlyOpen).toBe(false);
    // 끌기 없이 열림
    const np = chainSession({ noPull: true });
    const p = analyzeCh(np);
    expect(p.windows[0].reasons).toContain('not-pulled');
    expect(p.acceptance.openTiming).toBe(false);
    expect(p.acceptance.pullGeometry).toBe(false);
    // 마지막 고리가 터졌는데 열리지 않음
    const skip = chainSession({ skipOpen: true }, [{ ix: IMPACTS[0], mode: 'miss' }]);
    const sk = analyzeCh(skip, {}, { autoCuts: false });
    expect(sk.acceptance.noMissedOpen).toBe(false);
    expect(sk.missed.length).toBe(1);
  });
  test('끌기 방향·기둥·벽 지점 변이(방향 반대·기둥 거리·벽 x·벽 z)는 독립 계산과 달라 pullGeometry 가 실패한다', () => {
    expect(failing(analyzeCh(chainSession({ wrongSide: true })))).toContain('pullGeometry');
    const off = analyzeCh(chainSession({ pillarOffset: 7 }));
    expect(off.acceptance.pullGeometry).toBe(false);
    expect(off.geometry.bad[0].kind).toBe('geometry');
    expect(analyzeCh(chainSession({ anchorShift: 1 })).acceptance.pullGeometry).toBe(false);
    expect(analyzeCh(chainSession({ anchorZShift: 2 })).acceptance.pullGeometry).toBe(false);
    // 벽 z 오차 .3 은 허용(시전 시작 행과 컨트롤러가 본 스텝의 차이)
    expect(analyzeCh(chainSession({ anchorZShift: .3 })).acceptance.pullGeometry).toBe(true);
    // 방 정보를 읽지 못하면 실패
    expect(analyzeCh(chainSession(), { room: null }).acceptance.pullGeometry).toBe(false);
    // 착탄점이 중심 안쪽이면 창 번호 짝홀(독립 계산이 같은 규칙을 쓴다)
    const mid = chainSession({}, [{ ix: BR.x + .4 }, { ix: BR.x + .4 }, { ix: BR.x - .4 }]);
    const m = analyzeCh(mid);
    expect(m.geometry.casts.map((c: any) => c.wantSide)).toEqual([1, -1, 1]);
    expect(m.ok).toBe(true);
  });
  test('끌기 상태 변이: 끌기가 없는 행에 pullSide 가 남거나 chained 가 아닌데 pulling 이면 실패한다', () => {
    const s = chainSession();
    const bad = s.rows.map((r: any) => ({ ...r }));
    const idle = bad.find((r: any) => r.cs === 'exposed'); idle.sd = 1;
    expect(K.analyzeChains(chainObs(s, { rows: bad }), CH).acceptance.pullGeometry).toBe(false);
    const bad2 = s.rows.map((r: any) => ({ ...r }));
    bad2.find((r: any) => r.cs === 'open').pu = 1;
    expect(K.analyzeChains(chainObs(s, { rows: bad2 }), CH).acceptance.pullGeometry).toBe(false);
  });
  test('버티기 변이: 짧은 hold·기둥 밖(반경 2.5)·동작 state·피격은 컨트롤러가 끊어도 holdBeforeCut 이 실패한다', () => {
    const base = analyzeCh(chainSession());
    expect(base.acceptance.holdBeforeCut).toBe(true);
    const short = analyzeCh(chainSession({ hold: .8 }));
    expect(short.acceptance.holdBeforeCut).toBe(false);
    expect(short.windows[0].hold.seconds).toBeLessThan(1.2 - FRAME);
    // 컨트롤러 반경을 4 로 넓혀 영웅이 기둥에서 2.5 떨어진 채 끊김
    const far = analyzeCh(chainSession({ holdRadius: 4, heroOffset: 2.5 }));
    expect(far.acceptance.holdBeforeCut).toBe(false);
    expect(analyzeCh(chainSession({ heroOffset: 1.5 })).acceptance.holdBeforeCut).toBe(true);   // 반경 1.6 안은 통과
    // 공격 state 인데 hold 가 쌓임
    const act = analyzeCh(chainSession({ ignoreState: true, heroState: 'attack' }));
    expect(act.acceptance.holdBeforeCut).toBe(false);
    // 피격(hp 감소)이 있었는데 hold 가 이어짐
    const hurt = analyzeCh(chainSession({ ignoreHurt: true, hurtAt: 30 }));
    expect(hurt.acceptance.holdBeforeCut).toBe(false);
    // 끊김 행에서 cuts 가 두 번 늘어나면 실패
    const s = chainSession();
    const rows = s.rows.map((r: any) => ({ ...r }));
    const k = rows.findIndex((r: any) => r.cs === 'exposed');
    for (let i = k; i < rows.length; i++) rows[i].cu += 1;
    expect(K.analyzeChains(chainObs(s, { rows }), CH).acceptance.holdBeforeCut).toBe(false);
  });
  test('창·노출 길이와 시계 변이: 6초 창·4초 노출·windowLeft 시계 어긋남·끝나지 않은 창은 실패한다', () => {
    const longWin = analyzeCh(chainSession({}, [{ ix: IMPACTS[0], mode: 'miss' }], { ...CH, window: 6 }));
    expect(longWin.acceptance.windowLength).toBe(false);
    const shortExp = analyzeCh(chainSession({}, undefined, { ...CH, exposed: 4 }));
    expect(shortExp.acceptance.exposedLength).toBe(false);
    const s = chainSession();
    const rows = s.rows.map((r: any) => ({ ...r }));
    const open = rows.filter((r: any) => r.cs === 'open');
    open[10].wl -= .05;   // windowLeft 가 게임 시간보다 빨리 줄어듦
    expect(K.analyzeChains(chainObs(s, { rows }), CH).acceptance.windowLength).toBe(false);
    // 노출 시계가 멈춤
    const rows2 = s.rows.map((r: any) => ({ ...r }));
    rows2.filter((r: any) => r.cs === 'exposed')[7].el += .02;
    expect(K.analyzeChains(chainObs(s, { rows: rows2 }), CH).acceptance.exposedLength).toBe(false);
    // 끝나지 않은 창(마지막 행이 open)
    const cut = new ChainSim(); cut.tick(5); cut.appear(); cut.heroAt(BR.x, BR.z + 6); cut.tick(5); cut.startCast(IMPACTS[0]); cut.tick(50); cut.completeCast(); cut.step(); cut.heroAt(BR.x + 9, BR.z + 9); cut.tick(30);
    const un = analyzeCh(cut, {}, { autoCuts: false });
    expect(un.windows[0].endKind).toBe('unterminated');
    expect(un.acceptance.windowLength).toBe(false);
    // 노출이 끝난 뒤 사슬이 남았는데 unchained 로 가면 실패
    const rows3 = s.rows.map((r: any) => ({ ...r }));
    const e1 = rows3.findIndex((r: any) => r.cs === 'exposed');
    let j = e1; while (rows3[j].cs === 'exposed') j++;
    rows3[j].cs = 'unchained';
    expect(K.analyzeChains(chainObs(s, { rows: rows3 }), CH).acceptance.exposedLength).toBe(false);
  });
  test('exposed 묶임 변이: 새 공격·yaw 변경·추격 스텝 속도는 각각 실패한다', () => {
    const s = chainSession();
    const clone = () => s.rows.map((r: any) => ({ ...r }));
    const acc = (rows: any[], over: any = {}) => K.analyzeChains(chainObs(s, { rows, ...over }), CH).acceptance;
    const a = clone(); a.filter((r: any) => r.cs === 'exposed').slice(10).forEach((r: any) => { r.sq += 1; });
    expect(acc(a).noNewAttack).toBe(false);
    const b = clone(); b.filter((r: any) => r.cs === 'exposed').slice(20).forEach((r: any) => { r.by += .3; });
    expect(acc(b).yawFixed).toBe(false);
    const c = clone(); c.filter((r: any) => r.cs === 'exposed' && r.bs === 'chase')[3].bvx = .5;
    expect(acc(c).pinnedStill).toBe(false);
    // 속도가 0 인 이동(넉백)은 보고만 한다
    const e = clone(); e.filter((r: any) => r.cs === 'exposed').slice(5).forEach((r: any) => { r.bx += .8; });
    const ae = K.analyzeChains(chainObs(s, { rows: e }), CH);
    expect(ae.acceptance.pinnedStill).toBe(true);
    expect(ae.exposures[0].moveMax).toBeCloseTo(.8, 6);
    // 노출 첫 행은 같은 스텝의 컨트롤러·추격 분기 순서가 갈릴 수 있어 앞 행이 exposed 인 스텝만 본다
    const f = clone(); const firstExposed = f.find((r: any) => r.cs === 'exposed'); firstExposed.bvx = .5;
    expect(acc(f).pinnedStill).toBe(true);
  });
  test('open 묶임(PLAN 3.6): 먼 추격 스텝만 쫓지 않음(vel·이동 속도 ≤ 초당 1.8)으로 판정하고, 사거리 안 새 공격·yaw 변화는 허용하며 보고한다', () => {
    const s = chainSession();
    const clone = () => s.rows.map((r: any) => ({ ...r }));
    const an = (rows: any[], over: any = {}) => K.analyzeChains(chainObs(s, { rows, ...over }), CH);
    const openChase = (rows: any[]) => rows.filter((r: any) => r.cs === 'open' && r.bs === 'chase');
    const base = an(s.rows);
    expect(base.acceptance.pinnedStill).toBe(true);
    expect(base.pin.farChaseSteps).toBeGreaterThanOrEqual(15);   // 기둥 쪽 영웅(8.4 밖)과 추격 중인 보스: 판정 대상이 실제로 있다(창 3개)
    expect(base.pin.farLimit).toBeCloseTo(FAR, 9);
    // 먼 추격 스텝에서 vel 은 정확히 0 이어야 한다: 추격 속도 3.4·감속된 추격 1.7(리뷰 P3-1)·1.9 → 실패, 0 → 통과
    for (const [vx, ok] of [[3.4, false], [1.7, false], [1.9, false], [0, true]] as [number, boolean][]) {
      const r = clone(); openChase(r)[3].bvx = vx;
      expect(an(r).acceptance.pinnedStill).toBe(ok);
    }
    // vel 은 0 인데 위치가 초당 3.6 으로 따라오면(추격) 실패, 초당 1.2(넉백 정도)는 통과
    const chase = clone(); openChase(chase).forEach((r: any, i: number) => { r.bz += .06 * i; });
    expect(an(chase).acceptance.pinnedStill).toBe(false);
    const drift = clone(); openChase(drift).forEach((r: any, i: number) => { r.bz += .02 * i; });
    expect(an(drift).acceptance.pinnedStill).toBe(true);
    // 영웅이 사거리 안이면(앞뒤 모두) 묶지 않으므로 추격해도 통과, 한쪽만 안이면 판정 대상이 아니다, 둘 다 밖이면 실패
    const near = (rows: any[], dist: number[], vx = 3.4) => {
      const chaseRows = openChase(rows);
      chaseRows.slice(0, dist.length).forEach((r: any, i: number) => { r.hx = r.bx; r.hz = r.bz + dist[i]; });
      chaseRows[dist.length - 1].bvx = vx;
      return rows;
    };
    expect(an(near(clone(), [2, 2])).acceptance.pinnedStill).toBe(true);
    expect(an(near(clone(), [5, 3.5])).acceptance.pinnedStill).toBe(true);   // 뒤 행이 기준 안쪽
    expect(an(near(clone(), [3.5, 5])).acceptance.pinnedStill).toBe(true);   // 앞 행이 기준 안쪽
    expect(an(near(clone(), [FAR + .01, FAR + .01])).acceptance.pinnedStill).toBe(false);
    expect(an(near(clone(), [FAR - .01, FAR - .01])).acceptance.pinnedStill).toBe(true);
    // 보스 사거리를 도구가 못 읽었으면(null) open 묶임을 판정할 수 없어 실패한다
    const unknown = an(s.rows, { bossRange: null });
    expect(unknown.acceptance.pinnedStill).toBe(false);
    expect(unknown.pin.rangeKnown).toBe(false);
    // 사거리가 더 크면 기준이 넓어져 같은 거리의 스텝이 판정에서 빠진다(range 는 페이지에서 읽은 값을 쓴다)
    const wide = clone(); openChase(wide)[3].bvx = 3.4;
    expect(an(wide).acceptance.pinnedStill).toBe(false);
    expect(an(wide, { bossRange: 20 }).acceptance.pinnedStill).toBe(true);
  });
  test('open 에서 영웅이 사거리 안일 때의 새 공격·yaw 변화는 통과하고 보고되며, 노출 안 새 공격은 여전히 실패한다', () => {
    const s = chainSession();
    const clone = () => s.rows.map((r: any) => ({ ...r }));
    const an = (rows: any[]) => K.analyzeChains(chainObs(s, { rows }), CH);
    const rows = clone();
    const win = rows.filter((r: any) => r.cs === 'open' && r.cw === 1);
    // 창 도중 영웅이 보스 사거리 안으로 들어와(2칸) 돌아서 치는 보스: yaw 변화 + 새 공격 1회(그 뒤 공격이 이어지다 창 끝에서 원래 번호로 돌아오게 하지 않고 창 안 행만 바꾼다)
    const tail = win.slice(60, 68);
    tail.forEach((r: any) => { r.hx = r.bx; r.hz = r.bz + 2; r.by += .5; r.sq += 1; });
    const a = an(rows);
    expect(a.acceptance.yawFixed).toBe(true);
    expect(a.acceptance.noNewAttack).toBe(true);
    expect(a.windows[0].yawChanged).toBe(tail.length);
    expect(a.windows[0].pin.newAttacks).toBe(1);   // 번호가 올라간 스텝만 센다(원래 번호로 돌아오는 스텝은 새 공격이 아님)
    expect(a.windows[0].pin.newAttacksInRange).toBe(1);
    expect(a.windows[0].pin.newAttacksOutOfRange).toBe(0);
    // 영웅이 사거리 밖인데 새 공격이 생기면 통과하되 사거리 밖 수로 따로 보고한다
    const far = clone();
    far.filter((r: any) => r.cs === 'open' && r.cw === 1).slice(60).forEach((r: any) => { r.sq += 1; });
    const f = an(far);
    expect(f.windows[0].pin.newAttacksInRange).toBe(0);
    expect(f.windows[0].pin.newAttacksOutOfRange).toBe(1);
    expect(f.acceptance.noNewAttack).toBe(true);
    expect(f.pin.newAttacks).toBeGreaterThanOrEqual(1);
    // 노출 안에서는 영웅이 가까워도 새 공격은 실패다
    const ex = clone();
    ex.filter((r: any) => r.cs === 'exposed').slice(15).forEach((r: any) => { r.sq += 1; r.hx = r.bx; r.hz = r.bz + 1.5; });
    expect(an(ex).acceptance.noNewAttack).toBe(false);
  });
  test('피해 배율(PLAN 3.6): (1 + weaken × k) × (exposed 이면 exposedMult). 정상 표본은 휘청 220/240/260%·약화 110/120/130%·unchained 130% 를 모두 통과한다', () => {
    const s = chainSession();
    const a = analyzeCh(s);
    expect(a.acceptance.multiplier).toBe(true);
    expect(a.filters.basis).toBe('output');
    // 모의 기록 자체를 이 파일이 따로 확인한다(도구 값이 아니라 계약 숫자)
    const out = (st: string, dmg: number) => s.filters.filter((f: any) => f.st === st && f.dmg === dmg).map((f: any) => Math.round(f.out * 1e6) / 1e6);
    expect(out('exposed', 100)).toEqual([220, 220, 240, 240, 260, 260]);
    expect(out('chained', 30)[0]).toBe(30);                    // 첫 창 전: 약화 없음
    expect(out('chained', 30).slice(1).map((v: number) => Math.round(v * 10) / 10)).toEqual([33, 36]);
    expect(out('open', 25).map((v: number) => Math.round(v * 10) / 10)).toEqual([25, 27.5, 30]);
    expect(out('unchained', 40).map((v: number) => Math.round(v * 10) / 10)).toEqual([52]);
    expect(a.filters.weakenedCalls).toBeGreaterThanOrEqual(4);
    expect(a.filters.kMax).toBe(3);
    expect(a.filters.byState.exposed.minK).toBe(1);
    expect(a.filters.byState.unchained.minK).toBe(3);
  });
  test('피해 배율 변이: 약화 무시(1배)·휘청 2배만·휘청 1배/3배·창 밖 배율·unchained 약화 누락은 multiplier 가 실패한다', () => {
    const kinds = (o: any) => [...new Set(analyzeCh(chainSession(o)).filters.bad.map((b: any) => b.kind))].sort();
    const ok = (o: any) => analyzeCh(chainSession(o)).acceptance.multiplier;
    expect(ok({})).toBe(true);
    // 약화를 아예 무시: 휘청은 2배만(220% 가 아님), 끊은 뒤의 chained·open 도 1배
    expect(ok({ noWeaken: true })).toBe(false);
    expect(kinds({ noWeaken: true })).toEqual(['exposed-multiplier', 'weaken-multiplier']);
    // 휘청 동안에만 약화가 빠짐: 휘청 2배만
    expect(ok({ noWeakenExposed: true })).toBe(false);
    expect(kinds({ noWeakenExposed: true })).toEqual(['exposed-multiplier']);
    // unchained 에서 약화가 빠짐(damageVeil 을 지워 버린 구현)
    expect(ok({ noWeakenFree: true })).toBe(false);
    expect(kinds({ noWeakenFree: true })).toEqual(['weaken-multiplier']);
    expect(ok({ exposedMult: 1 })).toBe(false);
    expect(ok({ exposedMult: 1.5 })).toBe(false);
    expect(ok({ exposedMult: 3 })).toBe(false);
    expect(ok({ multOutside: true })).toBe(false);
  });
  test('피해 배율은 컨트롤러 cuts 가 아니라 도구가 센 끊김 수로 대조한다(컨트롤러가 틀린 수를 곱하면 잡힌다)', () => {
    // 곱하는 끊김 수가 하나 더 많음(행의 cuts 는 맞음) / 끊김이 한 번에 2씩 늘어 행 cuts 도 같이 틀림
    expect(analyzeCh(chainSession({ filterCutsBias: 1 })).acceptance.multiplier).toBe(false);
    const doubled = analyzeCh(chainSession({ cutStep: 2 }), {}, { autoCuts: false });
    expect(doubled.acceptance.multiplier).toBe(false);
    expect(doubled.filters.bad[0]).toMatchObject({ kind: 'exposed-multiplier', k: 1 });   // 도구는 open → exposed 전이 하나로 k = 1 을 센다
    expect(doubled.acceptance.objectiveText).toBe(false);                                // 목표창 % 도 도구의 k 로 계산해 어긋남을 잡는다
    // 반대로 행의 cu 가 틀려도(필터 기록은 맞음) 배율 판정은 컨트롤러 값에 기대지 않으므로 통과하고, 집계 판정이 따로 실패한다
    const s = chainSession();
    const rows = s.rows.map((r: any) => ({ ...r }));
    const k = rows.findIndex((r: any) => r.cs === 'exposed');
    for (let i = k; i < rows.length; i++) { rows[i].cu += 1; rows[i].cl -= 1; }
    const a = K.analyzeChains(chainObs(s, { rows }), CH);
    expect(a.acceptance.multiplier).toBe(true);
    expect(a.acceptance.countsConsistent).toBe(false);
  });
  test('피해 배율의 k 경계: 호출 순간 state 가 exposed 이면 그 스텝의 끊김을 포함하고, 그 밖의 state 는 같은 스텝의 끊김을 포함하지 않는다', () => {
    const s = chainSession();
    const cutN = s.rows.find((r: any) => r.cs === 'exposed').n;
    // 추가한 호출 하나의 판정만 본다(exposedDamage 합계는 기록과 따로 맞춰야 하므로 bad 목록만 확인)
    const extraBad = (extra: any) => K.checkChainsFilters([...s.filters, extra], s.rows, CH).badCount;
    const withExtra = (extra: any[]) => extraBad(extra[0]) === 0;
    expect(withExtra([{ n: cutN, dmg: 100, out: 220, st: 'exposed' }])).toBe(true);
    expect(withExtra([{ n: cutN, dmg: 100, out: 200, st: 'exposed' }])).toBe(false);
    expect(withExtra([{ n: cutN, dmg: 100, out: 100, st: 'open' }])).toBe(true);     // 컨트롤러 갱신보다 앞선 호출: 아직 끊기지 않음(k = 0)
    expect(withExtra([{ n: cutN, dmg: 100, out: 110, st: 'open' }])).toBe(false);
    expect(withExtra([{ n: cutN + 1, dmg: 100, out: 110, st: 'open' }])).toBe(true);
    // idle·ended 는 1배
    expect(withExtra([{ n: 1, dmg: 10, out: 10, st: 'idle' }])).toBe(true);
    expect(withExtra([{ n: 1, dmg: 10, out: 11, st: 'idle' }])).toBe(false);
    expect(withExtra([{ n: s.rows.at(-1).n, dmg: 10, out: 13, st: 'ended' }])).toBe(false);
    expect(withExtra([{ n: s.rows.at(-1).n, dmg: 10, out: 10, st: 'ended' }])).toBe(true);
  });
  test('exposedDamage 는 exposed 출력 합계(basis output). 증분 합계·불일치·노출 밖 증가·기록 누락은 실패한다', () => {
    const s = chainSession();
    const rows = s.rows.map((r: any) => ({ ...r }));
    rows.forEach((r: any) => { if (r.n >= rows.at(-1).n - 2) r.ed += 40; });
    expect(K.analyzeChains(chainObs(s, { rows }), CH).acceptance.multiplier).toBe(false);
    expect(K.analyzeChains(chainObs(s, { filters: null }), CH).acceptance.multiplier).toBe(false);
    // 증분(출력 − 입력) 합계로 읽는 구현은 basis 'bonus' 로 보고되고 실패한다
    const bonus = analyzeCh(chainSession({ edBasisBonus: true }));
    expect(bonus.acceptance.multiplier).toBe(false);
    expect(bonus.filters.basis).toBe('bonus');
    expect(bonus.filters.badCount).toBe(0);
    // exposedDamage 가 노출 밖에서 늘어도 실패
    const out = s.rows.map((r: any) => ({ ...r }));
    const k = out.findIndex((r: any) => r.cs === 'chained' && r.cu === 1);
    for (let i = k; i < out.length; i++) out[i].ed += 10;
    expect(K.analyzeChains(chainObs(s, { rows: out }), CH).acceptance.multiplier).toBe(false);
  });
  test('표본 없음은 auto 프로필(requireCalls)에서만 실패이고, 수동 chains 프로필에서는 보고(exposedCalls 0)다', () => {
    const nohit = chainSession({}, [{ ix: IMPACTS[0], hits: 0 }]);
    const auto = analyzeCh(nohit, {}, { autoCuts: true });
    expect(auto.filters.exposedCalls).toBe(0);
    expect(auto.acceptance.multiplier).toBe(false);
    const manualProfile = analyzeCh(nohit, {}, { autoCuts: false });
    expect(manualProfile.filters.exposedCalls).toBe(0);
    expect(manualProfile.acceptance.multiplier).toBe(true);
    expect(manualProfile.filters.requireCalls).toBe(false);
  });
  test('부착·집계·lastCutT 변이: 부착 지연·부착 토스트 누락·끊김 수 불일치·놓침 두 번 세기·lastCutT 어긋남은 각각 실패한다', () => {
    expect(analyzeCh(chainSession({ attachAt: 12 })).acceptance.attach).toBe(false);
    const early = chainSession();
    const rows = early.rows.map((r: any) => ({ ...r }));
    rows.find((r: any) => r.cs === 'chained').cl = 2;
    expect(K.analyzeChains(chainObs(early, { rows }), CH).acceptance.attach).toBe(false);
    const nt = analyzeCh(chainSession({ noAttachToast: true }));
    expect(nt.acceptance.attachToast).toBe(false);
    expect(nt.acceptance.toasts).toBe(false);
    expect(analyzeCh(chainSession({ doubleMiss: true }, [{ ix: IMPACTS[0], mode: 'miss' }, { ix: IMPACTS[1] }]), {}, { autoCuts: false }).acceptance.countsConsistent).toBe(false);
    const lc = chainSession();
    const r2 = lc.rows.map((r: any) => ({ ...r }));
    r2.filter((r: any) => r.cu === 1 && r.lc !== null).slice(12).forEach((r: any) => { r.lc += .2; });
    expect(K.analyzeChains(chainObs(lc, { rows: r2 }), CH).acceptance.lastCut).toBe(false);
    const r3 = lc.rows.map((r: any) => ({ ...r }));
    r3.find((r: any) => r.cs === 'chained' && r.cu === 0).lc = 3;
    expect(K.analyzeChains(chainObs(lc, { rows: r3 }), CH).acceptance.lastCut).toBe(false);
    // 전이 그래프 위반(chained → exposed)
    const r4 = lc.rows.map((r: any) => ({ ...r }));
    const o = r4.findIndex((r: any) => r.cs === 'open'); r4[o].cs = 'unchained';
    expect(K.analyzeChains(chainObs(lc, { rows: r4 }), CH).acceptance.attach).toBe(false);
    // 끊김이 하나도 없으면 AUTO 수용이 실패한다
    const noCut = chainSession({}, [{ ix: IMPACTS[0], mode: 'miss' }]);
    expect(analyzeCh(noCut, {}, { autoCuts: true }).acceptance.autoCuts).toBe(false);
    expect(analyzeCh(noCut, {}, { autoCuts: false }).acceptance.autoCuts).toBeUndefined();
  });
});

describe('거수 사슬 목표창·토스트·결과', () => {
  test('정상 세션의 목표창 표본은 범주별 정확한 문구이고 plain·pull·open·exposed 가 모두 관측된다', () => {
    const o = K.checkChainsObjective(chainSession().rows, CH);
    expect(o.ok).toBe(true);
    expect(o.counts.plain).toBeGreaterThan(0);
    expect(o.counts.pull).toBeGreaterThan(0);
    expect(o.counts.open).toBeGreaterThan(0);
    expect(o.counts.exposed).toBeGreaterThan(0);
    expect(o.lagCount).toBe(0);
  });
  test('상태가 바뀐 직후 갱신 주기(0.1초 + 2스텝) 안의 앞 상태 문구는 갱신 대기로 세고 통과, 주기를 넘으면 실패한다', () => {
    const ok = K.checkChainsObjective(chainSession({ lag: 6 }).rows, CH);
    expect(ok.ok).toBe(true);
    expect(ok.lagCount).toBeGreaterThan(0);
    const late = K.checkChainsObjective(chainSession({ lag: 12 }).rows, CH);
    expect(late.ok).toBe(false);
    expect(late.bad[0].why).toBe('text');
  });
  test('패널이 고정 주기로 다시 그릴 때: 주기 8스텝(실측 0.133초)이면 같은 범주의 앞 행 문구가 남아도 통과(stepLag 보고), 주기 14스텝이면 실패한다', () => {
    const ok = K.checkChainsObjective(chainSession({ refresh: 8 }).rows, CH);
    expect(ok.ok).toBe(true);
    expect(ok.stepLagCount).toBeGreaterThan(0);
    expect(ok.stepLagMax).toBeLessThanOrEqual(8);
    const slow = K.checkChainsObjective(chainSession({ refresh: 14 }).rows, CH);
    expect(slow.ok).toBe(false);
    expect(slow.bad.some((b: any) => b.why === 'text')).toBe(true);
  });
  test('노출 문구의 받는 피해 %는 도구가 센 끊김 수 k 로 계산한다: 첫 끊김 220%, 둘째 240%, 셋째 260%', () => {
    const s = chainSession();
    const pcts = [...new Set(s.rows.filter((r: any) => r.cs === 'exposed' && typeof r.dom === 'string').map((r: any) => r.dom.match(/받는 피해 (\d+)%/)[1]))];
    expect(pcts).toEqual(['220', '240', '260']);
    expect(K.chainsExposedPct(CH, 1)).toBe(220);
    expect(K.chainsExposedPct(CH, 2)).toBe(240);
    expect(K.chainsExposedPct(CH, 3)).toBe(260);
    expect(K.chainsExposedTexts(CH, 4.9, 2)).toEqual(['사슬 끊김 · 휘청 4.9초 · 받는 피해 240%']);
    // 항상 220% 라고 쓰면 둘째·셋째 끊김에서 어긋난다(도구 k 와 다름)
    const stuck = K.checkChainsObjective(chainSession({ domOverride: (cat: string, row: any) => (cat === 'exposed' ? '거수의 사슬' + T.exposedDom(ceil1(row.el), 220) : undefined) }).rows, CH);
    expect(stuck.ok).toBe(false);
    expect(stuck.bad.every((b: any) => b.cat === 'exposed')).toBe(true);
    // 약화를 빼고 200% 로 쓰는 문구, 옛 계약 150% 는 첫 끊김부터 어긋난다
    for (const pct of [200, 150]) {
      const r = K.checkChainsObjective(chainSession({ domOverride: (cat: string, row: any) => (cat === 'exposed' ? '거수의 사슬' + T.exposedDom(ceil1(row.el), pct) : undefined) }).rows, CH);
      expect(r.ok).toBe(false);
    }
  });
  test('문구 변이: 열림 남은 시간·hold·제목·분수·퍼센트가 어긋나면 실패한다', () => {
    const mut = (fn: (cat: string, row: any) => string | undefined) => K.checkChainsObjective(chainSession({ domOverride: fn }).rows, CH);
    expect(mut((cat, row) => (cat === 'open' ? '거수의 사슬' + T.openDom(ceil1(row.wl + .1), floor1(row.hd)) : undefined)).ok).toBe(false);
    expect(mut((cat, row) => (cat === 'open' ? '거수의 사슬' + T.openDom(ceil1(row.wl), floor1(row.hd + .1)) : undefined)).ok).toBe(false);
    expect(mut((cat, row) => (cat === 'open' ? '거수의 사슬' + '기둥 열림 ' + ceil1(row.wl) + '초 · 행동 없이 ' + floor1(row.hd) + '/1.0초' : undefined)).ok).toBe(false);
    expect(mut(cat => (cat === 'plain' ? '거수의 사슬' + T.plain(1) : undefined)).ok).toBe(false);
    expect(mut((cat, row) => (cat === 'exposed' ? '거수의 사슬' + '사슬 끊김 · 휘청 ' + ceil1(row.el) + '초 · 받는 피해 200%' : undefined)).ok).toBe(false);
    expect(mut((cat, row) => (cat === 'exposed' ? T.exposedDom(ceil1(row.el), 220) : undefined)).ok).toBe(false);   // 제목 없음
    expect(mut(cat => (cat === 'pull' ? '거수의 사슬' + '사슬이 망치 쪽으로 끌림' : undefined)).ok).toBe(false);
  });
  test('보스가 쓰러진 행의 문구(정화 완료)는 판정하지 않고, 36스텝 이어진 plain 에 표본이 없으면 실패한다', () => {
    const s = chainSession();
    const rows = s.rows.map((r: any) => ({ ...r }));
    const dead = rows.filter((r: any) => r.al === 0);
    expect(dead.length).toBeGreaterThan(0);
    dead.forEach((r: any) => { r.dom = '거수 정화 완료'; });
    expect(K.checkChainsObjective(rows, CH).ok).toBe(true);
    const missing = rows.map((r: any) => ({ ...r }));
    const first = missing.find((r: any) => typeof r.dom === 'string' && r.cs === 'chained');
    delete first.dom;
    const m = K.checkChainsObjective(missing, CH);
    expect(m.ok).toBe(false);
    expect(m.missing.length).toBe(1);
  });
  test('토스트: 부착 1회·열림 창마다 1회·끊김 n/3 순서·마지막에 모두 끊김 1회. 어긋나면 실패한다', () => {
    const s = chainSession();
    const ok = K.checkChainsToasts(s.toasts, CH, { windows: 3, cuts: 3, controllerWindows: 3, free: true });
    expect(ok.ok).toBe(true);
    const bad = (fn: (t: any[]) => any[], opts: any = {}) => K.checkChainsToasts(fn([...s.toasts]), CH, { windows: 3, cuts: 3, controllerWindows: 3, free: true, ...opts }).ok;
    expect(bad(t => t.filter(x => x.msg !== T.open || x !== t.find((y: any) => y.msg === T.open)))).toBe(false);
    expect(bad(t => [...t, t[0]])).toBe(false);
    expect(bad(t => [...t, { msg: T.free }])).toBe(false);
    expect(bad(t => t.filter(x => x.msg !== T.free))).toBe(false);
    expect(bad(t => [...t, { msg: T.cut(4) }])).toBe(false);
    expect(bad(t => [...t, { msg: '거수의 사슬 풀림' }])).toBe(false);
    expect(bad(t => t.filter(x => x.msg !== T.cut(2)))).toBe(false);
    expect(bad(t => [...t].reverse())).toBe(false);
    expect(bad(t => t, { windows: 2 })).toBe(false);
    expect(bad(t => t, { controllerWindows: 4 })).toBe(false);
    // 보스 전술 토스트(정확히 같은 문장)는 누출로 세지 않는다
    const tactic = '용재 망치가 내려칠 때 사슬이 망치 쪽으로 끌리고 반대편에 사슬 기둥이 섭니다.';
    expect(bad(t => [...t, { msg: tactic }])).toBe(false);
    expect(bad(t => [...t, { msg: tactic }], { encounterTactic: tactic })).toBe(true);
    // 끊김 토스트의 n 이 컨트롤러와 어긋나면 실패(모의: 첫 끊김이 2/3 으로 표시)
    expect(K.checkChainsToasts(chainSession({ cutToastN: 2 }).toasts, CH, { windows: 3, cuts: 3, controllerWindows: 3, free: true }).ok).toBe(false);
  });
  test('결과: 고정 객체 · 마지막 관측값과 같음 · 결과 줄 · aria 요소 하나. 하나라도 어긋나면 실패한다', () => {
    const s = chainSession();
    const base = chainObs(s);
    const last = s.rows.at(-1);
    expect(K.checkChainsResult(base.result, last, base.resultText, base.resultLines, CH).ok).toBe(true);
    const bad = (over: any) => K.checkChainsResult({ ...base.result, chains: { ...base.result.chains, ...over } }, last, base.resultText, base.resultLines, CH).ok;
    expect(bad({ cuts: 2 })).toBe(false);
    expect(bad({ windows: 4 })).toBe(false);
    expect(bad({ misses: 1 })).toBe(false);
    expect(bad({ broken: 1 })).toBe(false);
    expect(bad({ exposedDamage: base.result.chains.exposedDamage + 1 })).toBe(false);
    expect(bad({ count: 2 })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ exposedDamage: 1.5 })).toBe(false);
    expect(K.checkChainsResult({ ...base.result, chains: undefined }, last, base.resultText, base.resultLines, CH).ok).toBe(false);
    expect(K.checkChainsResult(base.result, last, '원정 결과', base.resultLines, CH).ok).toBe(false);
    expect(K.checkChainsResult(base.result, last, base.resultText, [], CH).ok).toBe(false);
    expect(K.checkChainsResult(base.result, last, base.resultText, [...base.resultLines, ...base.resultLines], CH).ok).toBe(false);
    expect(K.checkChainsResult(base.result, last, base.resultText, [{ aria: '거수의 사슬 결과', text: '거수의 사슬 끊음 2/3 · 기둥 창 3번 · 놓침 0번' }], CH).ok).toBe(false);
    expect(K.chainsResultLine({ cuts: 3, count: 3, windows: 4, misses: 1 })).toBe('거수의 사슬 끊음 3/3 · 기둥 창 4번 · 놓침 1번');
  });
});

describe('chains 프로필(checkChainsManual · checkChainsPause)', () => {
  /** 수동 세션: AUTO 로 거수가 붙은 뒤 끈다 → 기둥 밖에서 열림을 기다림 → 기둥 안 hold ≥ .5 → 공격 키 → hold 0 → 다시 버텨 끊김. */
  function manual(o: any = {}) {
    const s = new ChainSim(o);
    s.tick(5); s.appear(); s.tick(3);
    s.hero.au = 0; s.marks = [{ mk: 'manual-start', n: s.n }];
    s.heroAt(BR.x, BR.z + 6, 'move'); s.tick(20);
    s.startCast(IMPACTS[0]); s.tick(5);
    s.walk(s.pillar.x + (o.outsideAtOpen ? 0 : 3.4), s.pillar.z + (o.outsideAtOpen ? 0 : 0), 'move');
    s.tick(70);
    s.completeCast(); s.step();
    s.walk(s.pillar.x, s.pillar.z, 'idle');
    const need = Math.round((o.attackAt ?? .5) / FRAME);
    s.tickUntil(() => s.hd >= (o.attackAt ?? .5) - 1e-9 || s.st !== 'open', 300);
    s.marks.push({ mk: 'attack-key', n: s.n });
    s.heroAt(s.pillar.x, s.pillar.z, 'attack'); s.tick(o.attackSteps ?? 3); s.heroAt(s.pillar.x, s.pillar.z, 'idle');
    if (o.noReset) s.hd = .6;
    s.tickUntil(() => s.st !== 'open', 400);
    // 끊김 직후 휘청 동안 보스에게 걸어가 공격 키를 몇 번 눌러 친다(배율 표본). 걸음은 스텝당 .12 라 순간이동이 아니다.
    if (o.fight) {
      s.walk(s.boss.bx + 2.5, s.boss.bz, 'move');
      for (let i = 0; i < 3; i++) { s.heroAt(s.hero.x, s.hero.z, 'attack'); s.tick(3); s.hurtBoss(60); s.heroAt(s.hero.x, s.hero.z, 'idle'); s.tick(5); }
    }
    s.marks.push({ mk: 'manual-end', n: s.n });
    s.hero.au = o.autoOnAfter === false ? 0 : 1;
    s.tick(30);
    void need;
    return s;
  }
  const mk = (o: any = {}) => { const s: any = manual(o); return s; };
  test('정상 수동 세션: 기둥 밖에서 열림 → hold ≥ .5 → 공격 키 → hold 0 → 다시 버텨 끊김이 모두 통과한다', () => {
    const s = mk();
    const r = K.checkChainsManual(s.rows, s.marks, CH, { room: BR });
    expect(r).toMatchObject({ ok: true });
    expect(r.outside).toBe(true);
    expect(r.preHold).toBeGreaterThanOrEqual(.5 - FRAME);
    expect(r.cutHold.startN).toBeGreaterThan(s.marks[1].n);
  });
  test('수동 변이: AUTO 켜짐·순간이동·기둥 안에서 열림·공격 전 hold 부족·hold 가 0 이 되지 않음·표식 누락은 실패한다', () => {
    const s = mk();
    const run = (rows: any[], marks = s.marks) => K.checkChainsManual(rows, marks, CH, { room: BR });
    const au = s.rows.map((r: any) => ({ ...r })); au.find((r: any) => r.n > s.marks[0].n + 3).au = 1;
    expect(run(au).ok).toBe(false);
    const tp = s.rows.map((r: any) => ({ ...r })); tp.filter((r: any) => r.n > s.marks[0].n)[10].hx += 4;
    expect(run(tp).teleports).toBeGreaterThan(0);
    expect(run(tp).ok).toBe(false);
    expect(run(mk({ outsideAtOpen: true }).rows, mk({ outsideAtOpen: true }).marks).outside).toBe(false);
    const early = mk({ attackAt: .2 });
    expect(K.checkChainsManual(early.rows, early.marks, CH, { room: BR }).attackOk).toBe(false);
    const noReset = mk({ noReset: true, attackSteps: 0 });
    expect(K.checkChainsManual(noReset.rows, noReset.marks, CH, { room: BR }).ok).toBe(false);
    expect(run(s.rows, s.marks.filter((m: any) => m.mk !== 'attack-key')).ok).toBe(false);
    expect(run(s.rows, s.marks.filter((m: any) => m.mk !== 'manual-end')).reason).toBe('missing-marks');
    expect(run(s.rows, [{ mk: 'manual-start', n: 999999 }, ...s.marks.slice(1)]).ok).toBe(false);
    const dead = s.rows.map((r: any) => ({ ...r })); dead.find((r: any) => r.n > s.marks[0].n + 5).ha = 0;
    expect(run(dead).ok).toBe(false);
    expect(K.checkChainsManual(s.rows, s.marks, CH, { room: null }).ok).toBe(false);
  });
  test('끊김 직후 휘청 동안 보스를 치면 배율 표본이 생기고(220%), 치지 않으면 표본이 없어도 수동 프로필은 실패가 아니라 보고다', () => {
    const fought = mk({ fight: true });
    const run = K.checkChainsManual(fought.rows, fought.marks, CH, { room: BR, range: RANGE });
    expect(run.ok).toBe(true);
    expect(run.teleports).toBe(0);
    const f = K.checkChainsFilters(fought.filters, fought.rows, CH, { cuts: 1, requireCalls: false });
    expect(f.ok).toBe(true);
    expect(f.exposedCalls).toBe(3);
    expect(f.byState.exposed).toMatchObject({ calls: 3, minK: 1, maxK: 1 });
    expect(fought.filters.filter((x: any) => x.st === 'exposed').every((x: any) => Math.abs(x.out - 132) < 1e-9)).toBe(true);   // 60 × 220%
    // 같은 표본을 약화 무시(2배)로 만들면 실패한다
    const wrong = mk({ fight: true, noWeakenExposed: true });
    expect(K.checkChainsFilters(wrong.filters, wrong.rows, CH, { cuts: 1 }).ok).toBe(false);
    // 치지 않은 수동 세션: 표본 없음
    const idle = mk();
    const quiet = K.checkChainsFilters(idle.filters, idle.rows, CH, { cuts: 1, requireCalls: false });
    expect(quiet.exposedCalls).toBe(0);
    expect(quiet.ok).toBe(true);
    expect(K.checkChainsFilters(idle.filters, idle.rows, CH, { cuts: 1, requireCalls: true }).ok).toBe(false);
  });
  const snap = (over: any = {}, chain: any = {}) => ({ elapsed: 12.5, paused: false, chain: { cs: 'open', hd: .4, wl: 3.2, by: 1.2, sq: 5, bx: 150, bz: 29, ...chain }, ...over });
  test('창 안 정지: 게임 시간·windowLeft·hold 불변, 재개 뒤 windowLeft 는 흐른 시간만큼, hold 는 이어짐', () => {
    const before = snap(), paused = snap({ paused: true }), still = snap({ paused: true });
    const resumed = snap({ elapsed: 12.5 + 6 * FRAME, paused: false }, { hd: .4 + 6 * FRAME, wl: 3.2 - 6 * FRAME });
    const r = K.checkChainsPause({ before, paused, still, resumed, steps: 6 });
    expect(r.ok).toBe(true);
    expect(r.holdKept).toBe(true);
    const ck = (over: any) => K.checkChainsPause({ before, paused: over.paused ?? paused, still: over.still ?? still, resumed: over.resumed ?? resumed, steps: 6 }).ok;
    expect(ck({ still: snap({ paused: true, elapsed: 13 }) })).toBe(false);   // 정지 중 게임 시간이 흐름
    expect(ck({ still: snap({ paused: true }, { wl: 3.1 }) })).toBe(false);   // windowLeft 가 줆
    expect(ck({ still: snap({ paused: true }, { hd: .5 }) })).toBe(false);   // hold 가 늚
    expect(ck({ paused: snap({ paused: true }, { hd: 0 }) })).toBe(false);   // 정지 직후 hold 가 지워짐
    expect(ck({ still: snap({ paused: true }, { by: 2 }) })).toBe(false);   // 보스 yaw 변화
    expect(ck({ still: snap({ paused: true }, { sq: 6 }) })).toBe(false);   // 새 공격
    expect(ck({ resumed: snap({ elapsed: 12.5 + 6 * FRAME }, { hd: 0, wl: 3.2 - 6 * FRAME }) })).toBe(false);   // 재개 뒤 hold 가 0 으로 지워짐
    expect(ck({ resumed: snap({ elapsed: 12.5 + 6 * FRAME }, { hd: .4 + 6 * FRAME, wl: 3.2 }) })).toBe(false);   // windowLeft 가 흐르지 않음
    expect(ck({ resumed: snap({ elapsed: 12.5 }, { hd: .4, wl: 3.2 }) })).toBe(false);   // 재개 뒤 시간이 흐르지 않음
    expect(ck({ resumed: snap({ elapsed: 12.5 + 6 * FRAME }, { cs: 'chained', hd: 0, wl: 0 }) })).toBe(false);
    expect(K.checkChainsPause({ before: snap({}, { hd: .1 }), paused, still, resumed, steps: 6 }).ok).toBe(false);   // 정지 직전 hold 부족
    expect(K.checkChainsPause({ before: snap({}, { cs: 'chained' }), paused, still, resumed, steps: 6 }).ok).toBe(false);
  });
});

describe('screens 사슬 순간(checkChainMoment) · 기준선 누출', () => {
  const shot = (chain: any) => ({ capture: { chain: { bo: 1, al: 1, spn: 0, cs: 'chained', pu: 1, sd: 1, hd: 0, wl: 0, el: 0, cl: 3, dom: '거수의 사슬' + T.pull, ...chain } } });
  test('끌기 중 · 기둥 열림(hold > 0) · 끊김(exposed, 노출 시작 .5초 뒤) 순간을 상태와 목표창 문구로 판정한다', () => {
    expect(K.checkChainMoment(shot({}), CH, 'chain-pull').ok).toBe(true);
    expect(K.checkChainMoment(shot({ pu: 0 }), CH, 'chain-pull').ok).toBe(false);
    expect(K.checkChainMoment(shot({ dom: '거수의 사슬' + T.plain(3) }), CH, 'chain-pull').ok).toBe(false);
    expect(K.checkChainMoment(shot({ dom: T.pull }), CH, 'chain-pull').ok).toBe(false);
    const open = { cs: 'open', pu: 0, sd: 1, hd: .4, wl: 3.2, dom: '거수의 사슬' + T.openDom('3.2', '0.4') };
    expect(K.checkChainMoment(shot(open), CH, 'chain-open').ok).toBe(true);
    expect(K.checkChainMoment(shot({ ...open, hd: 0 }), CH, 'chain-open').ok).toBe(false);
    expect(K.checkChainMoment(shot({ ...open, dom: '거수의 사슬' + T.pull }), CH, 'chain-open').ok).toBe(false);
    // 받는 피해 % = round((1 + weaken × k) × exposedMult × 100), k 는 프로브가 센 끊김 수(kc). 첫 끊김 220%, 둘째 240%.
    const cut = { cs: 'exposed', pu: 0, sd: 0, el: 4.2, cl: 2, kc: 1, dom: '거수의 사슬' + T.exposedDom('4.2', 220) };
    expect(K.checkChainMoment(shot(cut), CH, 'chain-cut').ok).toBe(true);
    expect(K.checkChainMoment(shot({ ...cut, el: 4.9 }), CH, 'chain-cut').ok).toBe(false);
    expect(K.checkChainMoment(shot({ ...cut, dom: '거수의 사슬' + T.exposedDom('4.2', 200) }), CH, 'chain-cut').ok).toBe(false);   // 약화 무시
    expect(K.checkChainMoment(shot({ ...cut, dom: '거수의 사슬' + T.exposedDom('4.2', 150) }), CH, 'chain-cut').ok).toBe(false);   // 옛 계약
    expect(K.checkChainMoment(shot({ ...cut, kc: 2 }), CH, 'chain-cut').ok).toBe(false);                                            // 두 번째 끊김은 240%
    expect(K.checkChainMoment(shot({ ...cut, kc: 2, dom: '거수의 사슬' + T.exposedDom('4.2', 240) }), CH, 'chain-cut').ok).toBe(true);
    expect(K.checkChainMoment(shot({ ...cut, kc: 3, dom: '거수의 사슬' + T.exposedDom('4.2', 260) }), CH, 'chain-cut').ok).toBe(true);
    expect(K.checkChainMoment(shot({ ...cut, kc: undefined }), CH, 'chain-cut').ok).toBe(false);                                  // 도구 집계 없음
    expect(K.checkChainMoment({ capture: {} }, CH, 'chain-cut').ok).toBe(false);
    expect(K.checkChainMoment(shot({ al: 0 }), CH, 'chain-pull').ok).toBe(false);
    expect(K.checkChainMoment(shot({}), CH, 'unknown').ok).toBe(false);
    expect([...K.CHAIN_MOMENTS]).toEqual(['chain-pull', 'chain-open', 'chain-cut']);
  });
  test('기준선 누출: 토스트·목표창·결과 화면에 사슬 문구가 없고 관측이 있어야 통과한다', () => {
    const toasts = [{ msg: '보스의 기척이 느껴진다…' }, { msg: '사슬이 당기는 반대편으로 빠지세요' }];
    const doms = ['심장로 냉각 4/4 · 완료', '잿빛 재벼림 거수'];
    expect(K.checkChainsLeak(toasts, doms, '원정 결과 심장로 냉각 4/4 · 완료').ok).toBe(true);
    expect(K.checkChainsLeak([...toasts, { msg: T.attach }], doms).ok).toBe(false);
    expect(K.checkChainsLeak(toasts, [...doms, T.openDom('5.0', '0.0')], '').ok).toBe(true);   // 열림 문구 자체는 '기둥 열림'이라 누출어가 아니다
    expect(K.checkChainsLeak(toasts, [...doms, '사슬 끊김 · 휘청'], '').ok).toBe(false);
    expect(K.checkChainsLeak(toasts, doms, '거수의 사슬 끊음 0/3').ok).toBe(false);
    expect(K.checkChainsLeak([], doms).ok).toBe(false);
    expect(K.checkChainsLeak(toasts, []).ok).toBe(false);
  });
});

describe('거수 사슬 짝 비교(compareChainsTargetsOk · compareChainRuns)', () => {
  const defBase = { id: 'ashforge_heart_furnaces_deep', release: 'ember-chains', shockWindow: true, gates: [1, 2] };
  const cand = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', furnacesOk: true, chainsOk: true, routeDefinition: { ...defBase, chains: CH }, ...over });
  const base = (over: any = {}) => ({ head: 'b'.repeat(40), status: 'pass', runStatus: 'pass', furnacesOk: true, chainsOk: null, routeDefinition: { ...defBase }, ...over });
  test('후보 정의에는 chains 가 있고 기준선에는 없으며 나머지 정의가 같고 HEAD 가 다르고 양쪽 판정이 통과해야 한다', () => {
    expect(K.compareChainsTargetsOk(cand(), base())).toBe(true);
    expect(K.compareChainsTargetsOk(cand({ chainsOk: false }), base())).toBe(false);
    expect(K.compareChainsTargetsOk(cand({ chainsOk: null }), base())).toBe(false);
    expect(K.compareChainsTargetsOk(cand({ furnacesOk: false }), base())).toBe(false);
    expect(K.compareChainsTargetsOk(cand(), base({ furnacesOk: false }))).toBe(false);
    expect(K.compareChainsTargetsOk(cand(), base({ head: 'a'.repeat(40) }))).toBe(false);
    expect(K.compareChainsTargetsOk(cand(), base({ routeDefinition: { ...defBase, chains: CH } }))).toBe(false);   // 기준선에 chains 가 있음
    expect(K.compareChainsTargetsOk(cand(), base({ routeDefinition: null }))).toBe(false);   // 기준선 정의 없음(다른 기준선)
    expect(K.compareChainsTargetsOk(cand({ routeDefinition: { ...defBase } }), base())).toBe(false);   // 후보에 chains 없음
    expect(K.compareChainsTargetsOk(cand(), base({ routeDefinition: { ...defBase, shockWindow: false } }))).toBe(false);   // 사슬 밖 정의가 다름
    expect(K.compareChainsTargetsOk(cand({ status: 'fail' }), base())).toBe(false);
    expect(K.compareChainsTargetsOk(cand(), base({ runStatus: 'fail' }))).toBe(false);
    expect(K.compareChainsTargetsOk(null, base())).toBe(false);
  });
  const side = (time: number, over50: number, over: any = {}) => ({ time, runOver50: over50, steps: 70000, samples: [], furnaceRooms: [2, 4], kills: 40, ...over });
  test('게이트는 50ms 초과 cand ≤ base + 2 하나이고, 시간 비·처치 수·사슬 결과는 보고 항목이다', () => {
    const r = K.compareChainRuns(side(300, 3, { chainsSummary: { cuts: 3 } }), side(100, 1));
    expect(r.ok).toBe(true);
    expect(r.gates).toEqual({ slow: true });
    expect(r.report.time.ratio).toBe(3);
    expect(r.report.kills).toEqual({ cand: 40, base: 40 });
    expect(r.report.chains).toEqual({ cuts: 3 });
    expect(K.compareChainRuns(side(100, 4), side(100, 1)).ok).toBe(false);
    expect(K.compareChainRuns(side(100, 3), side(100, 1)).ok).toBe(true);
    expect(K.compareChainRuns(side(100, 0), side(100, null as any)).ok).toBe(false);
    expect(K.compareChainRuns(side(null as any, 0), side(100, 0)).ok).toBe(true);   // 시간 비는 게이트가 아니다
    expect(K.compareChainRuns(side(100, 0), side(100, 0)).report.over50PerThousandSteps.cand).toBe(0);
  });
  test('runOrder: 어느 쪽이 먼저 돌았는지 보고한다', () => {
    expect(K.runOrder('2026-10-16T01:00:00Z', '2026-10-16T02:00:00Z')).toBe('cand-first');
    expect(K.runOrder('2026-10-16T03:00:00Z', '2026-10-16T02:00:00Z')).toBe('base-first');
    expect(K.runOrder('x', 'y')).toBe('unknown');
    expect(K.compareChainRuns(side(1, 0, { started: '2026-10-16T01:00:00Z' }), side(1, 0, { started: '2026-10-16T02:00:00Z' })).report.order).toBe('cand-first');
  });
});

describe('리뷰 P2-1: 사슬을 끄는 것은 chained 에서 시작한 용재 망치뿐이다', () => {
  const room = { x: 0, z: 0, w: 28, h: 28 };
  // 행 0: 이전 창(seq 4) open 중 거수가 사거리 안 영웅에게 망치(seq 5)를 시작 → 1~4: 창 놓침 뒤 chained 로 이어지는 같은 시전(마지막 고리 cq 5 는 행 2).
  const rows = (startState = 'open', pullAt = -1) => {
    const base = (n: number, o: any) => ({ n, t: n * FRAME, bo: 1, al: 1, bs: 'attack', sp: 'kiln_hammer', pk: 'kiln_hammer', sq: 5, cq: 4, ix: 6, iz: 1, bx: 3, bz: 0,
      pu: 0, sd: 0, qx: 0, qz: 0, ax: 0, az: 0, ...o });
    const rs = [base(0, { cs: startState, sd: startState === 'open' ? -1 : 0, qx: 8.4, ax: -12.8 }), base(1, { cs: 'chained' }), base(2, { cs: 'chained', cq: 5 }),
      base(3, { cs: 'chained', cq: 5 }), base(4, { cs: 'chained', bs: 'chase', cq: 5 })];
    if (pullAt >= 0) Object.assign(rs[pullAt], { pu: 1, sd: 1, qx: -8.4, qz: 0, ax: 12.8, az: 0 });
    return rs;
  };
  const judge = (rs: any[]) => K.checkChainsGeometry(rs, CH, room, K.chainCasts(rs, CH), [{ startIdx: 0, endIdx: 0, seq: 4 }]);
  test('open 에서 시작한 망치가 chained 로 이어져도 끌기가 없으면 통과(그 시전은 끌기·창 대상이 아니다)', () => {
    const g = judge(rows());
    expect(g.bad ?? []).toEqual([]);
  });
  test('open·exposed 에서 시작한 망치에 끌기가 보이면 pull-outside-chained 로 실패한다', () => {
    for (const st of ['open', 'exposed']) {
      const g = judge(rows(st, 1));
      expect(g.ok).toBe(false);
      expect(g.bad.some((b: any) => b.kind === 'pull-outside-chained' && b.state === st)).toBe(true);
    }
  });
});
