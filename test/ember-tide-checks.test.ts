import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/ember-tide-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEF: any = (ROUTE_OBJECTIVES as any).ember_deep;

// 방 배치와 종류(심층 레이아웃: 2·3 정예, 4 일반). 판정은 방 id·좌표·종류를 인자로 받는다(정예방은 증원 1회).
const ROOMS = [{ id: 2, x: 36, z: 36, type: 'elite' }, { id: 3, x: 72, z: 0, type: 'elite' }, { id: 4, x: 72, z: 36, type: 'normal' }];
const REINFORCEMENTS = 1;
const PAD_OFFSET = 3.5;
const WARNING_ROWS = 84, VENT_ROWS = 48;
// 목표창·토스트·라벨 문구는 PLAN 3.0·3.1 의 계약 문장을 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const TXT = { closed: '밀물이 빠진 뒤 옮겨 간 조작판으로 이동', avoid: '밀물을 피한 뒤 옮겨 간 조작판으로 이동', open: '청록 조작판에서 2초 유지', old: '망치 충격파 뒤 옮겨 간 조작판으로 이동', oldAvoid: '망치 충격파를 피한 뒤 옮겨 간 조작판으로 이동' };
const LABELS = ['1번 냉각 밸브 · 좌현 화물칸', '2번 냉각 밸브 · 우현 화물칸', '3번 냉각 밸브 · 기관실 격벽'];
const TOAST_HIT = '밀물 피해 · 밀물 뒤 옮겨 간 조작판으로 이동';
const readyToast = (i: number) => LABELS[i] + ' 방어 완료 · 밀물이 빠진 뒤 청록 조작판에서 2초 유지';
const coolToast = (i: number) => LABELS[i] + ' 개방 · 냉각 밸브 ' + (i + 1) + '/3 개방';

/**
 * 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 건너뛴 스텝은 skip 으로 센다.
 * 밸브 i 의 조작판은 side = i % 2 ? -1 : 1 이고 pad.x = room.x - side * 3.5 다. 밀물 띠는 조작판 반대편(room.x + side * 3.5)이다.
 */
class Sim {
  rows: any[] = []; n = 0; pr = 0; hd = 0; sl = 1; au = 1; ah = 0; ps = 'move'; hero = { x: 0, z: 0 }; hp = 100; rem: number; g: any[];
  coolT: number[] = []; domNext: string | null = null; toasts: any[] = [];
  constructor(public def: any = DEF, public rooms: any[] = ROOMS, public reinforcements = REINFORCEMENTS) {
    this.g = def.gates.map((gate: any, i: number) => ({ id: gate.roomId, rd: 0, at: 0, cl: 0, fw: 0, dc: 0, al: 0, pd: 0, ph: 0, sk: 0, po: 0,
      px: rooms[i].x - (i % 2 ? -1 : 1) * PAD_OFFSET, pz: rooms[i].z, ht: 0, vn: 0, pv: 0, lb: '대기', vc: 0x3d8cff, pc: 0x56e6d5, vv: 0 }));
    this.rem = def.gates.length + 1;
    this.snap({ mk: 'start' });
  }
  snap(extra: any = {}) {
    const row: any = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: this.hp, mhp: 100, al: 1, rm: 0, pr: this.pr, hd: this.hd, sl: this.sl, rem: this.rem,
      au: this.au, ah: this.ah, ps: this.ps, g: this.g.map(x => ({ ...x })), ...extra };
    if (this.domNext) { row.dom = this.domNext; this.domNext = null; }
    this.rows.push(row); return row;
  }
  step(extra: any = {}) { this.n++; return this.snap(extra); }
  skip(k: number) { this.n += k; }
  mark(label: string) { return this.snap({ mk: label }); }
  pad(i: number) { return { x: this.g[i].px, z: this.g[i].pz }; }
  /** 영웅을 gate i 조작판 위(dx, dz 만큼 떨어진 곳)에 둔다. */
  onPad(i: number, dx = 0, dz = 0) { const p = this.pad(i); this.hero = { x: p.x + dx, z: p.z + dz }; }
  /** 밀물 띠 한가운데(조작판 반대편). */
  inStrip(i: number, dx = 0) { this.hero = { x: this.rooms[i].x * 2 - this.g[i].px + dx, z: this.rooms[i].z }; }
  title() { return this.def.copy.title + ' ' + this.pr + '/' + this.def.gates.length; }
  /** 현재 밸브의 목표창 문구(계약 문장). */
  text(i: number) {
    const g = this.g[i], hot = g.ph === 1 || g.ph === 2;
    return this.title() + (hot ? TXT.avoid : g.po === 1 ? TXT.open : TXT.closed);
  }
  sample(i: number) { this.domNext = this.text(i); }
  discover(i: number) { const g = this.g[i]; g.dc = 1; g.vv = 1; this.skip(10); this.step(); }
  /** 적 처치. 정예방은 증원 waves 회를 모두 겪은 뒤. */
  fight(i: number, { waves = this.reinforcements }: any = {}) {
    const g = this.g[i];
    g.al = 5; this.skip(30); this.step(); g.al = 0;
    if (this.rooms[i].type === 'elite') for (let w = 1; w <= waves; w++) { g.fw = w; this.step(); if (w < waves) { g.al = 4; this.skip(30); this.step(); g.al = 0; } }
  }
  /** ready. 이 순간 shocks 0 · 닫힘 · 가열이다. 뷰는 닫힌 조작판(밀물 대기)을 보인다. */
  readyUp(i: number, { dirty = false }: any = {}) {
    const g = this.g[i];
    g.rd = 1; g.sk = 0; g.po = 0; g.ph = 0; g.pv = 1; g.lb = '밀물 대기';
    if (dirty) g.al = 1;
    this.step();
  }
  /** 닫힌 조작판 위 대기(유지 0). 한 스텝씩 행이 남는다. */
  closedWait(i: number, rows: number, { sample = true }: any = {}) {
    this.onPad(i, .3, 0);
    for (let k = 1; k <= rows; k++) { if (sample && k === 40) this.sample(i); this.step(); }
  }
  /** 경고(warning) → 밀물(vent) → 물 빠짐 복귀(armed 면 shocks + 1, 조작판이 반대편으로 옮겨 가 열림). hit 는 밀물 중 띠에 서 있다가 한 번 맞는 모의. */
  tideCycle(i: number, { warning = WARNING_ROWS, vent = VENT_ROWS, here = true, hit = false, flip = true, sk = true }: any = {}) {
    const g = this.g[i];
    if (here) this.onPad(i, .3, 0);
    g.ph = 1; g.vn = 1; for (let k = 1; k <= warning; k++) { if (k === 40) this.sample(i); this.step(); }
    g.ph = 2;
    for (let k = 1; k <= vent; k++) {
      if (k === 40) this.sample(i);
      if (hit && k === 3) { this.inStrip(i); g.ht++; this.hp -= 6; this.toasts.push(TOAST_HIT); this.step(); continue; }
      this.step();
    }
    const room = this.rooms[i];
    g.ph = 0; g.vn = 0; g.po = 1; g.lb = '조작 2초';
    if (sk) g.sk++;
    if (flip) g.px = g.px < room.x ? room.x + PAD_OFFSET : room.x - PAD_OFFSET;
    this.step();
  }
  /** 열린 조작판 위 유지: hd 가 1/60 씩 늘어난다(기본 119행 = 2초 − 1/60). */
  hold(i: number, { rows = Math.round(this.def.holdSeconds / FRAME) - 1, dom = true, closedAt = -1 }: any = {}) {
    this.skip(40); this.onPad(i, .2, 0);
    for (let k = 1; k <= rows; k++) {
      this.hd = k * FRAME;
      const g = this.g[i];
      if (k === closedAt) { g.po = 0; g.ph = 1; }
      if (dom && k === 36) this.sample(i);
      this.step();
    }
  }
  cool(i: number) {
    const g = this.g[i];
    this.hd = 0; g.at = 1; g.cl = 1; this.pr++; this.rem--; g.ph = 3; g.po = 0; g.pv = 0; g.vn = 0; g.lb = '냉각 완료';
    this.toasts.push(coolToast(i));
    this.coolT[i] = (this.n + 1) * FRAME;
    return this.step();
  }
  unseal({ remaining = 0 } = {}) { this.skip(72); this.sl = 0; this.rem = remaining; this.step(); }
}

/** 정상 세션: 방 2 → 3 → 4 순서로 발견 → 처치 → ready → 닫힌 대기 → 밀물 → 열린 유지 → 개방. 준비·개방 토스트와 밀물 피해(over.hit)를 sim.toasts 에 남긴다. */
function tideSession(over: any = {}) {
  const s = new Sim();
  for (let i = 0; i < 3; i++) {
    s.discover(i);
    if (i === 2) s.rem -= 1;   // 나머지 구역(방 1) 정화
    s.fight(i, over['fight' + i]);
    s.readyUp(i, over['ready' + i]);
    s.toasts.push(readyToast(i));
    if (!over.noWait) s.closedWait(i, 60);
    s.tideCycle(i, { here: !over.noWait, ...(over['tide' + i] ?? {}) });
    s.hold(i, over['hold' + i]);
    if (over.unsealEarly && i === 2) s.sl = 0;
    s.cool(i);
  }
  if (!over.unsealEarly) s.unseal(over.unseal);
  s.mark('end');
  return s;
}
const resultOf = (def: any, over: any = {}) => ({ id: def.id, label: def.copy.title, complete: true, progress: def.gates.length, target: def.gates.length, rooms: def.gates.map((g: any) => g.roomId), overheatHits: 0, ...over });
const lineOf = (def: any) => def.copy.title + ' ' + def.gates.length + '/' + def.gates.length + ' · 완료';
const analyze = (s: Sim, over: any = {}, opts: any = {}) => {
  const hits = s.g.reduce((n, g) => n + g.ht, 0);
  return K.analyzeTide({ rows: s.rows, result: resultOf(DEF, { overheatHits: hits }), resultText: '원정 결과 ' + lineOf(DEF) + ' 전투 시간', resultLines: [{ aria: DEF.copy.title + ' 결과', text: lineOf(DEF) }],
    win: true, rooms: s.rooms, toasts: s.toasts.map((msg, n) => ({ n, t: n, msg, kind: 'gold' })), viewAB: [], ...over }, DEF, { reinforcements: s.reinforcements, ...opts });
};
const failing = (a: any) => Object.entries(a.acceptance).filter(([, ok]) => !ok).map(([name]) => name);
const COOL = (rows: any[], over: any = {}) => K.checkCoolings(rows, DEF, { reinforcements: REINFORCEMENTS, rooms: ROOMS, ...over });

describe('공유 정의와 계약 상수', () => {
  test('심층 밸브 3곳(2·3·4)은 밀물 창과 파란 밀물 띠를 갖고, 정의가 PLAN 계약과 같다', () => {
    expect(DEF.gates.map((g: any) => g.roomId)).toEqual([2, 3, 4]);
    expect(DEF.shockWindow).toBe(true);
    expect(DEF.ventColor).toBe(0x3d8cff);
    expect(K.checkDefinition(DEF)).toEqual({ ok: true, issues: [] });
  });
  test('정의가 계약과 어긋나면 어긋난 항목을 알린다(띠 색·문구·방 순서·수치)', () => {
    const bad = (patch: any) => K.checkDefinition({ ...DEF, ...patch });
    expect(bad({ ventColor: 0xff863e }).issues.map((i: any) => i.field)).toEqual(['ventColor']);
    expect(bad({ copy: { ...DEF.copy, vent: '망치 충격파' } }).issues.map((i: any) => i.field)).toEqual(['copy.vent']);
    expect(bad({ gates: [DEF.gates[1], DEF.gates[0], DEF.gates[2]] }).ok).toBe(false);
    expect(bad({ shockWindow: false }).ok).toBe(false);
    expect(bad({ ventSeconds: 1 }).issues.map((i: any) => i.field)).toEqual(['ventSeconds']);
    expect(K.checkDefinition(null).ok).toBe(false);
  });
  test('제목·결과 줄·열림 문구는 정의 copy 와 holdSeconds 로 만든다', () => {
    expect(K.valveTitle(DEF)).toBe('냉각 밸브 개방');
    expect(K.resultLineOf(DEF)).toBe('냉각 밸브 개방 3/3 · 완료');
    expect(K.holdPhraseOf(DEF)).toBe(TXT.open);
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

describe('밸브 개방 판정(checkCoolings)', () => {
  test('정상 세션은 개방 3회·순서 [2,3,4]·유지 ≥ 2초 − 1/60·전 표본 열림으로 통과한다', () => {
    const r = COOL(tideSession().rows);
    expect(r.count).toBe(3);
    expect(r.observedOrder).toEqual([2, 3, 4]);
    expect(r.cools.every((c: any) => c.hold.seconds >= DEF.holdSeconds - FRAME - 1e-6)).toBe(true);
    expect(Object.values(r.ok).every(Boolean)).toBe(true);
    expect(r.violations).toEqual([]);
  });
  test('순서 위반: 개방한 밸브의 방 id 가 정의 순서와 다르면 order 가 실패한다', () => {
    const s = tideSession();
    const i = s.rows.findIndex((r, k) => k > 0 && r.pr > s.rows[k - 1].pr);
    for (let k = i; k < s.rows.length; k++) s.rows[k].g[0].id = 99;
    const r = COOL(s.rows);
    expect(r.ok.order).toBe(false);
    expect(r.violations.some((v: any) => v.kind === 'order')).toBe(true);
  });
  test('유지 부족: 118행(2초 − 2/60)만 채우고 개방하면 hold 가 실패한다', () => {
    const r = COOL(tideSession({ hold1: { rows: 118 } }).rows);
    expect(r.ok.hold).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'hold').roomId).toBe(3);
  });
  test('닫힌 상태 유지: 유지 도중 조작판이 닫혔는데 hold 가 이어지면 padOpen 이 실패한다', () => {
    const r = COOL(tideSession({ hold0: { closedAt: 50 } }).rows);
    expect(r.ok.padOpen).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'closed-pad').closedRows).toBeGreaterThan(0);
  });
  test('밀물 횟수가 0 인데 열린 표본이면(독립 관측이 padOpen 과 어긋나면) 열림으로 인정하지 않는다', () => {
    const s = tideSession();
    for (const row of s.rows) if (row.hd > 0 && row.pr === 0) row.g[0].sk = 0;
    expect(COOL(s.rows).ok.padOpen).toBe(false);
  });
  test('증원 전 개방: 정예방의 forgeWave 가 증원 횟수보다 작으면 reinforcements 가 실패한다', () => {
    const r = COOL(tideSession({ fight0: { waves: 0 } }).rows);
    expect(r.ok.reinforcements).toBe(false);
    expect(r.violations.find((v: any) => v.kind === 'forge').roomId).toBe(2);
  });
  test('방에 적이 남은 채 개방하면 enemies 가 실패한다', () => {
    expect(COOL(tideSession({ ready2: { dirty: true } }).rows).ok.enemies).toBe(false);
  });
  test('영웅이 유지 중 조작판 반경 밖(2.5)이면 inside 가 실패하고, 반경 1.6 을 넘는 1.7 도 실패한다', () => {
    const s = tideSession();
    for (const row of s.rows) if (row.hd > 0 && row.pr === 2) row.x += 2.5;
    expect(COOL(s.rows).ok.inside).toBe(false);
    const t = tideSession();
    for (const r of t.rows) if (r.pr === 0 && r.hd > 0) { r.x = r.g[0].px + 1.7; r.z = r.g[0].pz; }
    const c = COOL(t.rows);
    expect(c.cools[0].inside.ok).toBe(false);
    expect(c.cools[0].inside.limit).toBeLessThan(DEF.radius + .02);
  });
  test('개방 중 앞 밸브가 attuned 가 아니거나 개방 전에 방이 cleared 였으면 gateState 가 실패한다', () => {
    const s = tideSession();
    const early = s.rows.findIndex(r => r.n > 0 && r.g[2].dc === 1);
    s.rows[early].g[2].cl = 1;
    expect(COOL(s.rows).ok.state).toBe(false);
  });
  test('개방이 2회뿐이면 count 가 실패한다', () => {
    const s = tideSession();
    const i = s.rows.findIndex(r => r.pr === 3);
    expect(COOL(s.rows.slice(0, i)).ok.count).toBe(false);
  });
});

describe('유지 표본의 조작판 상태(checkHoldWindows)', () => {
  test('정상 세션은 모든 유지 표본이 열려 있다', () => {
    expect(K.checkHoldWindows(tideSession().rows).ok).toBe(true);
  });
  test('개방에 이르지 못한 유지라도 닫힌 조작판에서 hold > 0 이면 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => r.pr === 0 && r.g[0].rd === 1 && r.g[0].po === 0 && r.hd === 0 && r.n > 0)!;
    row.hd = FRAME;
    const r = K.checkHoldWindows(s.rows);
    expect(r.ok).toBe(false);
    expect(r.badCount).toBe(1);
  });
  test('유지 표본이 하나도 없으면 실패한다', () => {
    expect(K.checkHoldWindows(tideSession().rows.filter(r => !(r.hd > 0))).ok).toBe(false);
  });
});

describe('닫힌 대기(checkWaiting)', () => {
  test('ready 인데 닫힌 조작판 위에서 유지 0 으로 기다린 표본이 1개 이상이면 통과한다', () => {
    const r = K.checkWaiting(tideSession().rows, DEF, { required: true });
    expect(r.ok).toBe(true);
    expect(r.samples).toBeGreaterThanOrEqual(60);
  });
  test('닫힌 대기 미관측: 영웅이 닫힌 조작판 근처에 간 적이 없으면 실패한다', () => {
    const r = K.checkWaiting(tideSession({ noWait: true }).rows, DEF, { required: true });
    expect(r.samples).toBe(0);
    expect(r.ok).toBe(false);
    expect(K.checkWaiting(tideSession({ noWait: true }).rows, DEF, { required: false }).ok).toBe(true);
  });
  test('대기 표본에서 그 밸브의 방이 이미 cleared 면 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => r.n > 0 && K.isWaitRow(r, DEF))!;
    row.g[0].cl = 1;
    expect(K.checkWaiting(s.rows, DEF).ok).toBe(false);
  });
  test('대기는 규칙 반경(def.radius) 안에서만 센다: 반경 밖(1.7)의 유지 0 은 닫힘의 증거가 아니다', () => {
    const s = tideSession();
    const row = s.rows.find(r => r.n > 0 && K.isWaitRow(r, DEF))!;
    const g = row.g[row.pr];
    row.x = g.px + 1.55; row.z = g.pz; expect(K.isWaitRow(row, DEF)).toBe(true);
    row.x = g.px + 1.7; expect(K.isWaitRow(row, DEF)).toBe(false);
  });
});

describe('준비 시점(checkReadyTiming)', () => {
  const run = (s: Sim) => K.checkReadyTiming(s.rows, DEF, { reinforcements: REINFORCEMENTS, rooms: ROOMS });
  test('정상: 방 발견·적 0·정예방 증원 1회 뒤에 ready', () => {
    const r = run(tideSession());
    expect(r.ok).toBe(true);
    expect(r.gates.map((g: any) => g.forgeWave)).toEqual([1, 1, 0]);
  });
  test('정예방이 증원 전에 ready 가 되면 실패한다', () => {
    const r = run(tideSession({ fight1: { waves: 0 } }));
    expect(r.ok).toBe(false);
    expect(r.gates[1].ok).toBe(false);
  });
  test('적이 남은 채 ready 가 되거나 발견 전에 ready 면 실패한다', () => {
    expect(run(tideSession({ ready0: { dirty: true } })).ok).toBe(false);
    const s = tideSession();
    s.rows.find(r => r.g[2].rd === 1)!.g[2].dc = 0;
    expect(run(s).ok).toBe(false);
  });
  test('ready 전에 그 밸브가 현재 차례일 때 유지가 올라가면 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => r.n > 0 && r.pr === 0 && r.g[0].rd === 0)!;
    row.hd = FRAME;
    expect(run(s).ok).toBe(false);
  });
});

describe('순서 대기(checkOrderWait)', () => {
  /** 방 4(밸브 index 2)를 먼저 정리해 ready 가 된 상태(적 0)에서 앞 밸브를 마저 개방하는 세션. */
  function earlyThird(over: any = {}) {
    const s = new Sim();
    s.discover(0); s.fight(0); s.readyUp(0);
    s.discover(2); s.fight(2); s.readyUp(2);
    if (over.attuned) { s.g[2].at = 1; s.step(); }
    if (over.cleared) { s.g[2].cl = 1; s.step(); }
    s.closedWait(0, 30); s.tideCycle(0); s.hold(0); s.cool(0);
    return s;
  }
  test('뒤 밸브가 먼저 정리돼도 개방·정화가 없으면 통과한다(관측됨)', () => {
    const r = K.checkOrderWait(earlyThird().rows, DEF);
    expect(r.observed).toBe(true);
    expect(r.gates).toEqual([2]);
    expect(r.ok).toBe(true);
  });
  test('앞 밸브 개방 전에 뒤 밸브가 attuned 이거나 방이 cleared 면 실패한다', () => {
    expect(K.checkOrderWait(earlyThird({ attuned: true }).rows, DEF).ok).toBe(false);
    expect(K.checkOrderWait(earlyThird({ cleared: true }).rows, DEF).ok).toBe(false);
  });
  test('관측되지 않았으면 통과하되 observed 는 false 이고, 관측을 요구하면 실패한다', () => {
    const s = tideSession();
    const r = K.checkOrderWait(s.rows, DEF);
    expect(r.observed).toBe(false);
    expect(r.ok).toBe(true);
    expect(K.checkOrderWait(s.rows, DEF, { required: true }).ok).toBe(false);
  });
});

describe('밀물 주기(checkTideCycle)', () => {
  const run = (s: Sim) => K.checkTideCycle(s.rows, DEF, { rooms: ROOMS });
  test('정상: 경고 1.4초 · 밀물 0.8초, 준비 뒤 밀물 끝에서만 shocks + 1, 조작판이 반대편(± 3.5)으로 옮겨 간다', () => {
    const r = run(tideSession());
    expect(r.ok).toBe(true);
    expect(r.durations.warning.every((d: any) => Math.abs(d.seconds - DEF.warningSeconds) < 1e-6)).toBe(true);
    expect(r.durations.vent.every((d: any) => Math.abs(d.seconds - DEF.ventSeconds) < 1e-6)).toBe(true);
    expect(r.shockEnds).toBe(3);
    expect(r.flips).toBe(3);
  });
  test('경고가 1.0초로 짧거나 밀물이 1.2초로 길면 실패한다', () => {
    expect(run(tideSession({ tide0: { warning: 60 } })).bad.some((b: any) => b.kind === 'duration' && b.phase === 'warning')).toBe(true);
    expect(run(tideSession({ tide1: { vent: 72 } })).bad.some((b: any) => b.kind === 'duration' && b.phase === 'vent')).toBe(true);
    expect(run(tideSession({ tide0: { warning: 60 } })).ok).toBe(false);
  });
  test('준비 뒤 시작된 밀물이 끝났는데 shocks 가 늘지 않으면 실패한다', () => {
    // 허용 오차는 2프레임이다: 경고가 2프레임 길면 통과하고 3프레임 길면 실패한다.
    expect(run(tideSession({ tide0: { warning: WARNING_ROWS + 2 } })).bad.filter((b: any) => b.kind === 'duration')).toEqual([]);
    expect(run(tideSession({ tide0: { warning: WARNING_ROWS + 3 } })).bad.some((b: any) => b.kind === 'duration')).toBe(true);
    expect(run(tideSession({ tide0: { vent: VENT_ROWS - 3 } })).bad.some((b: any) => b.kind === 'duration')).toBe(true);
  });
  test('준비 뒤 시작된 밀물이 끝났는데 shocks 가 늘지 않으면 실패한다 (shocks)', () => {
    const r = run(tideSession({ tide0: { sk: false } }));
    expect(r.bad.some((b: any) => b.kind === 'shocks')).toBe(true);
    expect(r.ok).toBe(false);
  });
  test('준비 전에 시작된 밀물(ready 0)이 끝났는데 shocks 가 늘면 실패하고, 늘지 않으면 통과한다', () => {
    const unarmed = (sk: boolean) => {
      const s = new Sim();
      s.discover(0); s.fight(0);
      s.tideCycle(0, { sk });
      return s;
    };
    expect(run(unarmed(true)).bad.some((b: any) => b.kind === 'shocks')).toBe(true);
    expect(run(unarmed(false)).bad.filter((b: any) => b.kind === 'shocks')).toEqual([]);
  });
  test('조작판이 밀물 끝에서 옮겨 가지 않거나 다른 시점에 움직이면 실패한다', () => {
    expect(run(tideSession({ tide2: { flip: false } })).bad.some((b: any) => b.kind === 'pad-flip')).toBe(true);
    const s = tideSession();
    const row = s.rows.find(r => r.g[0].rd === 1 && r.g[0].ph === 0 && r.n > 0)!;
    row.g[0].px += 1;
    expect(run(s).bad.some((b: any) => b.kind === 'pad-moved')).toBe(true);
  });
  test('경고·밀물이 한 번도 관측되지 않으면 실패한다', () => {
    const s = new Sim();
    s.discover(0); s.fight(0); s.readyUp(0); s.closedWait(0, 30);
    expect(run(s).ok).toBe(false);
  });
});

describe('밀물 띠 피해(checkTideHits)', () => {
  const run = (s: Sim) => K.checkTideHits(s.rows, DEF, { rooms: ROOMS });
  test('피해 없는 세션은 통과하고 total 0', () => {
    const r = run(tideSession());
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
  });
  test('밀물 중 띠 안에서 분출당 한 번 맞으면 통과하고 최대 체력 대비 하락 비율을 남긴다', () => {
    const r = run(tideSession({ tide0: { hit: true } }));
    expect(r.ok).toBe(true);
    expect(r.total).toBe(1);
    expect(r.hits[0].inside).toBe(true);
    expect(r.hits[0].ratio).toBeCloseTo(.06, 6);
  });
  test('밀물 아닌 단계에서 hits 가 늘거나 띠 밖에서 늘면 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => r.g[0].rd === 1 && r.g[0].ph === 0 && r.n > 0)!;
    for (const r of s.rows) if (r.n >= row.n) r.g[0].ht = 1;
    expect(run(s).bad.some((b: any) => b.kind === 'not-vent')).toBe(true);
    const t = tideSession({ tide0: { hit: true } });
    for (const r of t.rows) if (r.g[0].ht === 1) { r.x = ROOMS[0].x - 20; }
    expect(run(t).bad.some((b: any) => b.kind === 'outside-strip')).toBe(true);
  });
  test('한 밀물에서 두 번 늘어나면 실패한다', () => {
    const s = tideSession({ tide1: { hit: true } });
    const i = s.rows.findIndex(r => r.g[1].ht === 1);
    for (let k = i + 1; k < s.rows.length; k++) if (s.rows[k].g[1].ph === 2) s.rows[k].g[1].ht = 2;
    expect(run(s).bad.some((b: any) => b.kind === 'repeat')).toBe(true);
  });
  test('현재 차례가 아닌 밸브의 hits 가 늘면 실패한다', () => {
    const s = tideSession({ tide0: { hit: true } });
    for (const r of s.rows) if (r.g[0].ht === 1) r.pr = 1;
    expect(run(s).bad.some((b: any) => b.kind === 'not-current')).toBe(true);
  });
});

describe('봉인 해제·결과', () => {
  test('정상 세션: 해제는 progress = 3 이고 남은 구역 0 인 마지막 개방 뒤다', () => {
    const u = K.checkUnseal(tideSession().rows, DEF);
    expect(u.ok).toBe(true);
    expect(u.progress).toBe(3);
  });
  test('조기 봉인 해제: 마지막 개방 스텝에서 이미 풀려 있으면 실패한다', () => {
    expect(K.checkUnseal(tideSession({ unsealEarly: true }).rows, DEF).ok).toBe(false);
  });
  test('구역이 남은 채 해제되면(rem > 0) 실패하고, 해제된 적이 없어도 실패한다', () => {
    expect(K.checkUnseal(tideSession({ unseal: { remaining: 1 } }).rows, DEF).ok).toBe(false);
    expect(K.checkUnseal(tideSession().rows.map(r => ({ ...r, sl: 1 })), DEF).ok).toBe(false);
  });
  test('결과 객체: 정상 통과, 이름·id·progress·rooms·complete·패배는 실패한다', () => {
    expect(K.checkResultFields(resultOf(DEF), DEF, true).ok).toBe(true);
    expect(K.checkResultFields(resultOf(DEF, { label: '냉각선 복구' }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { label: undefined }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { id: 'cinder_cooling_deep' }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { progress: 2 }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { target: 4 }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { rooms: [2, 4, 3] }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { complete: false }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF), DEF, false).ok).toBe(false);
    expect(K.checkResultFields(null, DEF, true).ok).toBe(false);
  });
  test('overheatHits: 0 이상의 정수여야 하고 관측한 gate.hits 합계와 같아야 한다', () => {
    expect(K.checkResultFields(resultOf(DEF, { overheatHits: 2 }), DEF, true, { hitsTotal: 2 }).ok).toBe(true);
    expect(K.checkResultFields(resultOf(DEF, { overheatHits: 1 }), DEF, true, { hitsTotal: 2 }).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { overheatHits: undefined }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { overheatHits: -1 }), DEF, true).ok).toBe(false);
    expect(K.checkResultFields(resultOf(DEF, { overheatHits: 1.5 }), DEF, true).ok).toBe(false);
  });
  test('결과 줄과 줄 요소(aria-label)', () => {
    expect(K.checkResultLine('원정 결과 냉각 밸브 개방 3/3 · 완료 보상', DEF).ok).toBe(true);
    expect(K.checkResultLine('원정 결과 냉각 밸브 개방 2/3 · 완료', DEF).ok).toBe(false);
    expect(K.checkResultLine('심장로 냉각 4/4 · 완료', DEF).ok).toBe(false);
    expect(K.checkResultElement([{ aria: '냉각 밸브 개방 결과', text: '냉각 밸브 개방 3/3 · 완료' }], DEF).ok).toBe(true);
    expect(K.checkResultElement([{ aria: '냉각 밸브 개방 결과', text: '냉각 밸브 개방 3/3' }], DEF).ok).toBe(false);
    expect(K.checkResultElement([{ aria: '냉각선 복구 결과', text: '냉각 밸브 개방 3/3 · 완료' }], DEF).ok).toBe(false);
    expect(K.checkResultElement([], DEF).ok).toBe(false);
  });
});

describe('목표창 문구(checkObjectiveSamples)', () => {
  const run = (s: Sim) => K.checkObjectiveSamples(s.rows, DEF, COOL(s.rows).cools);
  test('정상 세션: 닫힘·경고·밀물·열림 문구가 표본마다 맞고 밸브마다 표본이 있다', () => {
    const r = run(tideSession());
    expect(r.ok).toBe(true);
    expect(r.open).toBeGreaterThanOrEqual(3);
    expect(r.closed).toBeGreaterThanOrEqual(3);
    expect(r.avoid).toBeGreaterThanOrEqual(3);
  });
  test('재벼림 문구(망치 충격파)가 나오면 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => typeof r.dom === 'string' && r.dom.includes(TXT.closed))!;
    row.dom = row.dom.replace(TXT.closed, TXT.old);
    expect(run(s).ok).toBe(false);
    const t = tideSession();
    const avoid = t.rows.find(r => typeof r.dom === 'string' && r.dom.includes(TXT.avoid))!;
    avoid.dom = avoid.dom.replace(TXT.avoid, TXT.oldAvoid);
    expect(run(t).ok).toBe(false);
  });
  test('상태와 어긋난 문구(열림인데 닫힘 문구)나 제목 누락은 실패한다', () => {
    const s = tideSession();
    const open = s.rows.find(r => typeof r.dom === 'string' && r.dom.includes(TXT.open))!;
    open.dom = open.dom.replace(TXT.open, TXT.closed);
    expect(run(s).ok).toBe(false);
    const t = tideSession();
    const any = t.rows.find(r => typeof r.dom === 'string')!;
    any.dom = '냉각선 복구 0/3' + any.dom.slice(any.dom.indexOf('밀'));
    expect(run(t).ok).toBe(false);
  });
  test('닫힘 표본이 하나도 없거나 열림 표본이 하나도 없으면 실패한다', () => {
    const noClosed = tideSession();
    for (const r of noClosed.rows) if (typeof r.dom === 'string' && r.dom.includes(TXT.closed)) delete r.dom;
    expect(run(noClosed).ok).toBe(false);
    const noOpen = tideSession();
    for (const r of noOpen.rows) if (typeof r.dom === 'string' && r.dom.includes(TXT.open)) delete r.dom;
    expect(run(noOpen).ok).toBe(false);
  });
  test('표본이 없으면 실패한다', () => {
    const s = tideSession();
    for (const r of s.rows) delete r.dom;
    expect(run(s).ok).toBe(false);
  });
});

describe('토스트(checkToasts)', () => {
  const list = (msgs: string[]) => msgs.map((msg, n) => ({ n, t: n, msg, kind: 'gold' }));
  const full = () => [readyToast(0), coolToast(0), readyToast(1), coolToast(1), readyToast(2), coolToast(2)];
  test('준비·개방 토스트가 밸브마다 1회, 개방은 순서대로면 통과한다', () => {
    expect(K.checkToasts(list(full()), DEF, { overheatHits: 0 }).ok).toBe(true);
  });
  test('밀물 피해 토스트 횟수는 결과의 overheatHits 와 같아야 한다', () => {
    expect(K.checkToasts(list([...full(), TOAST_HIT, TOAST_HIT]), DEF, { overheatHits: 2 }).ok).toBe(true);
    expect(K.checkToasts(list([...full(), TOAST_HIT]), DEF, { overheatHits: 2 }).ok).toBe(false);
    expect(K.checkToasts(list(full()), DEF, { overheatHits: 1 }).ok).toBe(false);
  });
  test('준비 토스트 누락·중복, 개방 순서 뒤바뀜은 실패한다', () => {
    expect(K.checkToasts(list(full().filter(m => m !== readyToast(1))), DEF).ok).toBe(false);
    expect(K.checkToasts(list([...full(), readyToast(0)]), DEF).ok).toBe(false);
    expect(K.checkToasts(list([readyToast(0), coolToast(1), readyToast(1), coolToast(0), readyToast(2), coolToast(2)]), DEF).ok).toBe(false);
  });
  test('재벼림 문구 토스트(망치 충격파 뒤 · 충격파 피해)는 실패한다', () => {
    const old = full().map(m => m.replace('밀물이 빠진 뒤', '망치 충격파 뒤'));
    expect(K.checkToasts(list(old), DEF).ok).toBe(false);
    const leak = K.checkToasts(list([...full(), '망치 충격파 피해 · 충격파 뒤 옮겨 간 조작판으로 이동']), DEF, { overheatHits: 0 });
    expect(leak.ok).toBe(false);
    expect(leak.leaked.length).toBe(1);
  });
  test('보스 전술 토스트(stage.encounter.tactic 과 정확히 같음)의 시그니처 망치 문구는 면제하고, 한 글자라도 다르면 누출로 센다', () => {
    const tactic = '각 냉각 밸브 구역의 적을 처치한 뒤 … 파란 밀물 띠 안에 있으면 피해를 입습니다. 용광로 개방: 중앙 통로 → 바깥 통로 과열 · 용재 망치: 발밑 강타를 피한 뒤 고리 안으로';
    const ok = K.checkToasts(list([...full(), tactic]), DEF, { overheatHits: 0, encounterTactic: tactic });
    expect(ok.ok).toBe(true); expect(ok.tacticToasts).toBe(1);
    expect(K.checkToasts(list([...full(), tactic]), DEF, { overheatHits: 0 }).ok).toBe(false);
    expect(K.checkToasts(list([...full(), tactic + ' ']), DEF, { overheatHits: 0, encounterTactic: tactic }).ok).toBe(false);
    expect(K.checkToasts(list([...full(), tactic, '밀물 피해 · 망치 충격파 뒤 옮겨 간 조작판으로 이동']), DEF, { overheatHits: 0, encounterTactic: tactic }).ok).toBe(false);
  });
});

describe('밸브 뷰(checkTideView)', () => {
  const run = (s: Sim) => K.checkTideView(s.rows, DEF);
  test('정상: 띠 색 파랑, 닫힌 라벨 밀물 대기, 경고·밀물에만 띠가 보인다', () => {
    const r = run(tideSession());
    expect(r.ok).toBe(true);
    expect(r.labelRows).toBeGreaterThan(0);
    expect(r.hotRows).toBeGreaterThan(0);
  });
  test('띠 색이 주황(0xff863e)이면 실패한다', () => {
    const s = tideSession();
    for (const r of s.rows) for (const g of r.g) g.vc = 0xff863e;
    const r = run(s);
    expect(r.ok).toBe(false);
    expect(r.colorBad.length).toBeGreaterThan(0);
  });
  test('닫힌 라벨이 충격파 대기이거나 다른 문구면 실패한다', () => {
    const s = tideSession();
    for (const r of s.rows) for (const g of r.g) if (g.lb === '밀물 대기') g.lb = '충격파 대기';
    const r = run(s);
    expect(r.ok).toBe(false);
    expect(r.labelBad.length).toBeGreaterThan(0);
    expect(r.leakBad.length).toBeGreaterThan(0);
  });
  test('라벨을 관측할 수 없으면(lb null) 라벨은 요구하지 않고 observable false 로 알린다', () => {
    const s = tideSession();
    for (const r of s.rows) for (const g of r.g) g.lb = null;
    const r = run(s);
    expect(r.labelObservable).toBe(false);
    expect(r.ok).toBe(true);
  });
  test('경고·밀물 중 띠가 숨어 있거나 가열 중 띠가 보이면 실패한다', () => {
    const hidden = tideSession();
    for (const r of hidden.rows) for (const g of r.g) if (g.ph === 1) g.vn = 0;
    expect(run(hidden).ok).toBe(false);
    const shown = tideSession();
    for (const r of shown.rows) for (const g of r.g) if (g.ph === 0 && g.rd === 1) g.vn = 1;
    expect(run(shown).ok).toBe(false);
  });
  test('뷰 관측이 없으면(vc -1, vn -1) 통과하지 않는다', () => {
    const s = tideSession();
    for (const r of s.rows) for (const g of r.g) { g.vc = -1; g.vn = -1; }
    expect(run(s).ok).toBe(false);
  });
  test('방 발견 표시 동기(보고)와 뷰 A/B 요약(보고)', () => {
    const s = tideSession();
    expect(K.checkViewSync(s.rows, DEF).mismatchCount).toBe(0);
    s.rows.find(r => r.n > 0 && r.g[1].dc === 1)!.g[1].vv = 0;
    expect(K.checkViewSync(s.rows, DEF).mismatchCount).toBeGreaterThan(0);
    const ab = K.summarizeViewAB([{ on: 40, offView: 30 }, { on: 41, offView: 30 }, { on: null, offView: null }]);
    expect(ab).toMatchObject({ samples: 2, recorded: 3, max: 11, min: 10 });
    expect(K.summarizeViewAB([]).max).toBe(null);
  });
});

describe('종합(analyzeTide)', () => {
  test('정상 세션은 모든 판정을 통과한다', () => {
    const a = analyze(tideSession());
    expect(failing(a)).toEqual([]);
    expect(a.ok).toBe(true);
  });
  test('밀물 피해가 있는 정상 세션도 통과한다(결과 overheatHits 와 토스트가 관측 합계와 맞는다)', () => {
    const a = analyze(tideSession({ tide1: { hit: true } }));
    expect(failing(a)).toEqual([]);
    expect(a.hits.total).toBe(1);
  });
  test('판정마다 실패 입력이 해당 항목만 실패시킨다', () => {
    expect(failing(analyze(tideSession({ hold1: { rows: 118 } })))).toContain('holdDuration');
    expect(failing(analyze(tideSession({ fight0: { waves: 0 } })))).toEqual(expect.arrayContaining(['reinforcements', 'readyTiming']));
    expect(failing(analyze(tideSession({ noWait: true })))).toContain('waiting');
    expect(failing(analyze(tideSession({ unsealEarly: true })))).toContain('unseal');
    expect(failing(analyze(tideSession(), { result: resultOf(DEF, { overheatHits: 3 }) }))).toEqual(['resultFields', 'toasts']);
    expect(failing(analyze(tideSession(), { resultText: '냉각 밸브 개방 2/3 · 완료' }))).toEqual(['resultLine']);
    expect(failing(analyze(tideSession(), { resultLines: [] }))).toEqual(['resultElement']);
    expect(failing(analyze(tideSession(), { toasts: [] }))).toEqual(['toasts']);
    expect(failing(analyze(tideSession({ tide0: { warning: 60 } })))).toContain('tideCycle');
    expect(failing(analyze(tideSession({ tide0: { hit: true } }), { result: resultOf(DEF, { overheatHits: 0 }) }))).toEqual(expect.arrayContaining(['resultFields']));
  });
  test('정의가 계약과 어긋나면 definition 이 실패한다(띠 색)', () => {
    const s = tideSession();
    const a = K.analyzeTide({ rows: s.rows, result: resultOf(DEF), resultText: lineOf(DEF), resultLines: [{ aria: '냉각 밸브 개방 결과', text: lineOf(DEF) }], win: true, rooms: ROOMS,
      toasts: s.toasts.map((msg: string) => ({ msg })) }, { ...DEF, ventColor: 0xff863e }, { reinforcements: 1 });
    expect(failing(a)).toEqual(expect.arrayContaining(['definition', 'tideView']));
  });
  test('재벼림 목표창 문구가 섞이면 objectiveText 만 실패한다', () => {
    const s = tideSession();
    const row = s.rows.find(r => typeof r.dom === 'string' && r.dom.includes(TXT.closed))!;
    row.dom = row.dom.replace(TXT.closed, TXT.old);
    expect(failing(analyze(s))).toEqual(['objectiveText']);
  });
});

// ---------- order ----------
/** order 프로필 모의 세션: 1번 밸브를 키보드로(AUTO 꺼짐) 닫힌 체류 → 첫 밀물 → 열린 유지 1초 → 이탈 → 닫힌 체류 → 열린 유지로 개방. 모든 행이 스텝 단위다. */
function orderSession(over: any = {}) {
  const s = new Sim();
  s.discover(0); s.fight(0); s.readyUp(0);
  s.au = 0; s.mark('manual-start');
  s.onPad(0, 1, 0); s.mark('pad1');
  const room = ROOMS[0], g = s.g[0];
  const dwell1 = over.shortDwell ? 5 : 60;
  for (let k = 1; k <= dwell1; k++) { if (over.attack && k === 20) { s.ah = 1; s.ps = 'attack'; } s.step(); }
  s.ah = 0; s.ps = 'move';
  g.ph = 1; g.vn = 1; for (let k = 0; k < (over.shortDwell ? 3 : WARNING_ROWS); k++) s.step();
  g.ph = 2; for (let k = 0; k < (over.shortDwell ? 3 : VENT_ROWS); k++) s.step();
  g.ph = 0; g.vn = 0; g.sk = 1; g.po = 1; g.px = room.x + PAD_OFFSET; s.step(); s.mark('tide1');
  s.skip(70); s.onPad(0, .2, 0);
  const partial = over.noPartial ? 20 : 70;
  for (let k = 1; k <= partial; k++) { s.hd = k * FRAME; if (over.holdClosed && k === 10) { g.po = 0; g.ph = 1; } s.step(); }
  s.mark('partial');
  s.hd = 0; s.hero = { x: g.px - PAD_OFFSET, z: g.pz }; if (over.holdClosed) { g.po = 1; g.ph = 0; } s.step(); s.mark('exit');
  g.ph = 1; g.vn = 1; g.po = 0; s.step(); s.mark('warn');
  s.onPad(0, .4, 0);
  for (let k = 0; k < (over.shortDwell ? 3 : WARNING_ROWS); k++) { if (over.holdWhileClosed && k === 30) s.hd = FRAME; else s.hd = 0; s.step(); }
  s.hd = 0;
  g.ph = 2; for (let k = 0; k < (over.shortDwell ? 3 : VENT_ROWS); k++) s.step();
  g.ph = 0; g.vn = 0; g.sk = 2; g.po = 1; g.px = room.x - PAD_OFFSET; s.step(); s.mark('dwell-end');
  s.skip(70); s.onPad(0, .2, 0);
  const finalRows = over.finalShort ? 100 : 119;
  for (let k = 1; k <= finalRows; k++) { s.hd = k * FRAME; s.step(); }
  s.cool(0); s.mark('cooled');
  return s;
}
describe('order 프로필(analyzeOrder)', () => {
  const run = (s: Sim) => K.analyzeOrder(s.rows, DEF, { rooms: ROOMS });
  test('정상 키보드 세션: 닫힌 체류 합계 ≥ 2초 · 유지 ≥ 1.0 뒤 3.0 밖 이탈 · 새 유지로 개방이 통과한다', () => {
    const a = run(orderSession());
    expect(a.ok).toBe(true);
    expect(a.dwell.seconds).toBeGreaterThanOrEqual(2);
    expect(a.partial.abortedMax).toBeGreaterThanOrEqual(1);
    expect(a.partial.exitDistance).toBeGreaterThanOrEqual(3);
    expect(a.final.seconds).toBeGreaterThanOrEqual(DEF.holdSeconds - FRAME - 1e-6);
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
    expect(run(orderSession({ noPartial: true })).partial.ok).toBe(false);
  });
  test('열린 유지가 중간에 닫히면(닫힌 상태의 hold) partial 구간이 열림으로 인정되지 않는다', () => {
    expect(run(orderSession({ holdClosed: true })).partial.ok).toBe(false);
  });
  test('최종 유지가 2초 − 1/60 에 못 미치면 final 이 실패한다', () => {
    expect(run(orderSession({ finalShort: true })).final.ok).toBe(false);
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
  test('정지 중 게임 시간·밀물 주기·progress 불변, hold 0, 재개 뒤 0 에서 새로 시작이면 통과한다', () => {
    expect(K.checkPause(good()).ok).toBe(true);
  });
  test('정지 중 게임 시간이 흐르면 실패한다', () => {
    const g = good(); g.still.elapsed = 10 + 120 * FRAME;
    expect(K.checkPause(g).frozen).toBe(false);
  });
  test('정지 중 밀물 주기(age)가 흐르면 실패한다', () => {
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
  test('재개 뒤 첫 개방의 유지가 재개 이후에 0 에서 시작해 2초 − 1/60 이상이고 열려 있으면 통과한다', () => {
    const s = new Sim();
    s.discover(0); s.fight(0); s.readyUp(0); s.closedWait(0, 30); s.tideCycle(0);
    s.skip(40); s.onPad(0, .2, 0);
    for (let k = 1; k <= 50; k++) { s.hd = k * FRAME; s.step(); }
    s.hd = 0; s.step(); s.mark('resume');
    s.hold(0); s.cool(0);
    const r = K.analyzePauseCooling(s.rows, DEF, { rooms: ROOMS, reinforcements: REINFORCEMENTS });
    expect(r.ok).toBe(true);
    expect(r.runStartN).toBeGreaterThan(r.resumeN);
  });
  test('재개 전 시작한 유지가 이어져 개방하면(재개 뒤 새 유지가 아니면) 실패한다', () => {
    const s = new Sim();
    s.discover(0); s.fight(0); s.readyUp(0); s.closedWait(0, 30); s.tideCycle(0);
    s.skip(40); s.onPad(0, .2, 0);
    s.hd = 10 * FRAME; s.step(); s.mark('resume');
    for (let k = 11; k <= 119; k++) { s.hd = k * FRAME; s.step(); }
    s.cool(0);
    expect(K.analyzePauseCooling(s.rows, DEF, { rooms: ROOMS, reinforcements: REINFORCEMENTS }).ok).toBe(false);
  });
  test('resume 표식이 없으면 판정 불가', () => {
    expect(K.analyzePauseCooling(tideSession().rows, DEF, { rooms: ROOMS }).reason).toBe('missing-mark');
  });
});

// ---------- keys ----------
describe('keys 프로필(checkKeys · describeBaselineKeys)', () => {
  const kRow = (n: number, x: number, kd = 1, extra: any = {}) => ({ n, t: n * FRAME, x, z: 0, kd, en: 1, pa: 0, ...extra });
  const EVENTS = [{ phase: 'walk', op: 'down', key: 'KeyD' }, { phase: 'walk', op: 'up', key: 'KeyD' }, { phase: 'hold', op: 'down', key: 'KeyD' }, { phase: 'release', op: 'up', key: 'KeyD' }];
  /** 정상 세션: 누른 채 30스텝 이동(0.1/스텝) → 정지 → 재개 뒤 키 이벤트 없이 계속 이동 → keyup 뒤 3스텝 감속하고 멈춤. over 로 어긋남을 만든다. */
  function keysData(over: any = {}) {
    const x0 = 10, speed = over.holdSpeed ?? .1;
    const hold = Array.from({ length: over.holdLen ?? 30 }, (_, i) => kRow(i + 1, x0 + speed * (i + 1), over.holdKd ?? 1));
    const x1 = hold.at(-1)?.x ?? x0;
    const frozenAt = (paused: boolean, x = x1, elapsed = 5) => ({ elapsed, x, z: 0, paused });
    const pause = { before: frozenAt(false), paused: frozenAt(true), still: frozenAt(true, over.pauseDrift ? x1 + .3 : x1, over.pauseElapsed ?? 5) };
    const rs = over.resumeSpeed ?? .1;
    const resume = Array.from({ length: over.resumeLen ?? 30 }, (_, i) => kRow(100 + i, x1 + rs * (i + 1), (over.resumeKd ?? ((i: number) => 1))(i), { en: over.resumeEnabled === false ? 0 : 1 }));
    const x2 = resume.at(-1)?.x ?? x1;
    const release = Array.from({ length: over.releaseLen ?? 30 }, (_, i) => kRow(200 + i, x2 + (over.slide ? .1 * (i + 1) : .1 * Math.min(i + 1, 3)), over.releaseKd ?? 0));
    return { x0, hold, pause, resumeX0: x1, resume, release, events: over.events ?? EVENTS, interrupted: over.interrupted ?? null };
  }
  test('정상: 재개 뒤 키 이벤트 없이 30스텝 안에 x 가 0.5 이상 늘고 KeyD true, keyup 뒤 멈추고 KeyD false', () => {
    const r = K.checkKeys(keysData());
    expect(r.ok).toBe(true);
    expect(r.holdMoved).toBeGreaterThanOrEqual(.5);
    expect(r.resumeGain).toBeGreaterThanOrEqual(.5);
    expect(r.movedAtStep).toBeLessThanOrEqual(30);
    expect(r.pauseEvents).toEqual([]);
    expect(r.resumeEvents).toEqual([]);
  });
  test('수리 전(기준선) 동작: 재개 뒤 키가 지워져 이동하지 않고 KeyD 가 false 면 resumed 가 실패한다', () => {
    const r = K.checkKeys(keysData({ resumeSpeed: 0, resumeKd: () => 0 }));
    expect(r.precondition).toBe(true);
    expect(r.resumed).toBe(false);
    expect(r.ok).toBe(false);
  });
  test('x 는 늘었지만 KeyD 가 false 면(다른 입력으로 움직임) 실패하고, KeyD true 인데 0.5 못 가도 실패한다', () => {
    expect(K.checkKeys(keysData({ resumeKd: () => 0 })).resumed).toBe(false);
    expect(K.checkKeys(keysData({ resumeSpeed: .01 })).resumed).toBe(false);
    expect(K.checkKeys(keysData({ resumeKd: (i: number) => (i < 5 ? 1 : 0) })).resumed).toBe(false);
  });
  test('재개 단계에서 입력 이벤트를 보냈으면(재입력 우회) 이동해도 실패한다', () => {
    const r = K.checkKeys(keysData({ events: [...EVENTS.slice(0, 3), { phase: 'resume', op: 'down', key: 'KeyD' }, EVENTS[3]] }));
    expect(r.resumed).toBe(true);
    expect(r.events).toBe(false);
    expect(r.ok).toBe(false);
  });
  test('정지 단계의 이벤트, hold 의 down 이 2번, release 의 up 이 없으면 events 가 실패한다', () => {
    expect(K.checkKeys(keysData({ events: [...EVENTS, { phase: 'pause', op: 'up', key: 'KeyD' }] })).events).toBe(false);
    expect(K.checkKeys(keysData({ events: [EVENTS[2], EVENTS[2], EVENTS[3]] })).events).toBe(false);
    expect(K.checkKeys(keysData({ events: EVENTS.slice(0, 3) })).events).toBe(false);
    expect(K.checkKeys(keysData({ events: [] })).events).toBe(false);
  });
  test('keyup 뒤 계속 미끄러지거나 KeyD 가 true 로 남으면 released 가 실패한다', () => {
    expect(K.checkKeys(keysData({ slide: true })).released).toBe(false);
    expect(K.checkKeys(keysData({ releaseKd: 1 })).released).toBe(false);
    expect(K.checkKeys(keysData({ releaseLen: 10 })).released).toBe(false);
  });
  test('사전 조건: 누른 채 이동이 0.5 에 못 미치거나(벽) 정지 중 위치가 변하면 precondition 이 실패한다', () => {
    expect(K.checkKeys(keysData({ holdSpeed: .005 })).precondition).toBe(false);
    expect(K.checkKeys(keysData({ pauseDrift: true })).precondition).toBe(false);
    expect(K.checkKeys(keysData({ pauseElapsed: 5.5 })).precondition).toBe(false);
    expect(K.checkKeys(keysData({ holdKd: 0 })).precondition).toBe(false);
    expect(K.checkKeys(keysData({ holdLen: 12 })).precondition).toBe(false);
  });
  test('재개 뒤 입력이 꺼진 채(enabled 0)였거나 단계가 끊겼으면 실패한다', () => {
    expect(K.checkKeys(keysData({ resumeEnabled: false })).resumed).toBe(false);
    expect(K.checkKeys(keysData({ interrupted: { segment: 'resume', reason: 'paused' } })).ok).toBe(false);
    expect(K.checkKeys(keysData({ resumeLen: 12 })).resumed).toBe(false);
  });
  test('기준선 기록은 판정하지 않고 이동 여부만 알린다', () => {
    const moved = K.describeBaselineKeys(keysData());
    expect(moved).toMatchObject({ judged: false, moved: true, stoppedAfterRelease: true });
    const stuck = K.describeBaselineKeys(keysData({ resumeSpeed: 0, resumeKd: () => 0 }));
    expect(stuck).toMatchObject({ judged: false, moved: false, keyDownAtEnd: false });
    expect(K.describeBaselineKeys({ x0: 0 }).moved).toBe(false);
  });
});

// ---------- screens ----------
describe('screens 프로필', () => {
  const cap = (gOver: any = {}, rowOver: any = {}) => ({ capture: { pr: 0, hd: 0, g: [{ id: 2, dc: 1, at: 0, cl: 0, rd: 1, ph: 0, sk: 0, po: 0, vn: 0, pv: 1, lb: '밀물 대기', vc: 0x3d8cff, ra: null, ...gOver }], ...rowOver }, elapsed: 12 });
  const GOOD: Record<string, any> = {
    closed: cap(), warning: cap({ ph: 1, vn: 1 }), vent: cap({ ph: 2, vn: 1 }),
    open: cap({ po: 1, sk: 1, ph: 0, lb: '조작 2초' }, { hd: 1.2 }), opened: cap({ at: 1, cl: 1, ph: 3, po: 0, pv: 0, vn: 0, lb: '냉각 완료', ra: .2 }, { pr: 1 }),
  };
  test('모든 순간에 도달하고 PNG 가 viewport 개수만큼 있어야 한다', () => {
    const labels = [...K.MOMENTS];
    const full = labels.map(label => ({ label, reached: true, files: ['a', 'b', 'c'] }));
    expect(K.checkScreens(full, labels, 3).ok).toBe(true);
    expect(K.checkScreens(full.map((s, i) => (i === 2 ? { label: s.label, reached: false } : s)), labels, 3).ok).toBe(false);
    expect(K.checkScreens(full.map((s, i) => (i === 3 ? { ...s, files: ['a', 'b'] } : s)), labels, 3).ok).toBe(false);
    expect(K.MOMENTS).toEqual(['closed', 'warning', 'vent', 'open', 'opened']);
  });
  test('순간마다 촬영 스텝의 관측 상태와 뷰 표시가 맞으면 통과하고 gate 상태를 돌려준다', () => {
    for (const label of K.MOMENTS) {
      const r = K.checkScreenMoment(GOOD[label], DEF, label);
      expect(r.ok).toBe(true);
    }
    expect(K.checkScreenMoment(GOOD.closed, DEF, 'closed').gate).toMatchObject({ id: 2, rd: 1, po: 0, lb: '밀물 대기' });
  });
  test('관측 상태가 라벨과 다르면 실패한다(닫힘을 찍었는데 열림, 경고를 찍었는데 가열)', () => {
    expect(K.checkScreenMoment(GOOD.open, DEF, 'closed').ok).toBe(false);
    expect(K.checkScreenMoment(GOOD.closed, DEF, 'warning').ok).toBe(false);
    expect(K.checkScreenMoment(GOOD.warning, DEF, 'vent').ok).toBe(false);
    expect(K.checkScreenMoment(GOOD.closed, DEF, 'open').ok).toBe(false);
    expect(K.checkScreenMoment(GOOD.closed, DEF, 'opened').ok).toBe(false);
    expect(K.checkScreenMoment({ capture: null }, DEF, 'closed').ok).toBe(false);
    expect(K.checkScreenMoment(GOOD.closed, DEF, 'nothing').ok).toBe(false);
  });
  test('닫힌 순간의 라벨이 충격파 대기이거나, 경고·밀물 순간 띠가 숨었거나 색이 주황이면 실패한다', () => {
    expect(K.checkScreenMoment(cap({ lb: '충격파 대기' }), DEF, 'closed').ok).toBe(false);
    expect(K.checkScreenMoment(cap({ ph: 1, vn: 0 }), DEF, 'warning').ok).toBe(false);
    expect(K.checkScreenMoment(cap({ ph: 2, vn: 1, vc: 0xff863e }), DEF, 'vent').ok).toBe(false);
  });
  test('열림은 유지 ≥ 1.0 이어야 하고, 개방 직후는 개방 뒤 0.1초 이상이며 띠가 숨어 있어야 한다', () => {
    expect(K.checkScreenMoment(cap({ po: 1, sk: 1 }, { hd: .5 }), DEF, 'open').ok).toBe(false);
    expect(K.checkScreenMoment(cap({ po: 1, sk: 1, pv: 0 }, { hd: 1.2 }), DEF, 'open').ok).toBe(false);
    expect(K.checkScreenMoment(cap({ at: 1, cl: 1, ra: .05, vn: 0 }, { pr: 1 }), DEF, 'opened').ok).toBe(false);
    expect(K.checkScreenMoment(cap({ at: 1, cl: 1, ra: .2, vn: 1 }, { pr: 1 }), DEF, 'opened').ok).toBe(false);
  });
});

// ---------- 기준선 비교 ----------
describe('기준선 비교(compareTargetsOk · compareSetup · compareRuns)', () => {
  const side = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', tideOk: true, routeDefinition: DEF, ...over });
  const base = (over: any = {}) => side({ head: 'b'.repeat(40), routeDefinition: null, tideOk: null, ...over });
  test('기준선 정의 없음 · 후보 ember_deep 정의 있음 · HEAD 가 다르고 후보 판정 통과여야 한다', () => {
    expect(K.compareTargetsOk(side(), base())).toBe(true);
    expect(K.compareTargetsOk(side({ tideOk: false }), base())).toBe(false);
    expect(K.compareTargetsOk(side({ tideOk: null }), base())).toBe(false);
    expect(K.compareTargetsOk(side(), side({ head: 'b'.repeat(40) }))).toBe(false);   // 기준선에도 정의가 있으면 다른 빌드가 아니다
    expect(K.compareTargetsOk(side(), base({ head: 'a'.repeat(40) }))).toBe(false);   // 같은 HEAD
    expect(K.compareTargetsOk(side({ routeDefinition: { ...DEF, id: 'cinder_cooling_deep' } }), base())).toBe(false);   // 후보 정의가 ember_deep 이 아님
    expect(K.compareTargetsOk(side(), base({ status: 'fail' }))).toBe(false);
    expect(K.compareTargetsOk(side(), base({ runStatus: 'fail' }))).toBe(false);
    expect(K.compareTargetsOk(side({ runStatus: 'fail' }), base())).toBe(false);
    expect(K.compareTargetsOk(null, base())).toBe(false);
  });
  test('후보와 기준선이 뒤바뀌면 합격하지 않는다', () => {
    expect(K.compareTargetsOk(base({ tideOk: true }), side())).toBe(false);
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
  const runSide = (time: number, over50: number, over: any = {}) => ({ time, runOver50: over50, steps: 70000, samples: [], valveRooms: [2, 3, 4], ...over });
  test('게이트: 시간 비 ≤ 2.0 · 50ms 초과 ≤ 기준선 + 2 (한 짝씩)', () => {
    const r = K.compareRuns(runSide(150, 3), runSide(100, 1));
    expect(r.ok).toBe(true);
    expect(r.gates).toEqual({ time: true, slow: true });
    expect(K.compareRuns(runSide(201, 0), runSide(100, 0)).gates.time).toBe(false);
    expect(K.compareRuns(runSide(200, 0), runSide(100, 0)).gates.time).toBe(true);
    expect(K.compareRuns(runSide(100, 4), runSide(100, 1)).gates.slow).toBe(false);
    expect(K.compareRuns(runSide(100, 3), runSide(100, 1)).gates.slow).toBe(true);
    expect(K.compareRuns(runSide(100, 4), runSide(100, 1)).ok).toBe(false);
  });
  test('완주 시간이 없는(패배) 실행이나 50ms 집계가 없는 실행은 통과하지 못한다', () => {
    expect(K.compareRuns(runSide(null as any, 0), runSide(100, 0)).gates.time).toBe(false);
    expect(K.compareRuns(runSide(100, 0), runSide(null as any, 0)).gates.time).toBe(false);
    expect(K.compareRuns(runSide(100, null as any), runSide(100, 0)).gates.slow).toBe(false);
    expect(K.compareRuns(runSide(100, 0), runSide(100, null as any)).gates.slow).toBe(false);
  });
  test('밸브 방 첫 진입 draw call 증가·50ms 초과율·load·실행 순서는 보고 항목이며 게이트를 막지 않는다', () => {
    const sample = (roomId: number, calls: number) => ({ label: 'roomEnter', roomId, calls });
    const cand = runSide(100, 0, { samples: [sample(2, 40), sample(3, 44), sample(4, 41)], started: '2026-10-15T10:00:00Z', load: { start: { avg1: 1.5 }, end: { avg1: 2.5 } } });
    const bs = runSide(100, 0, { samples: [sample(2, 30), sample(3, 30), sample(4, 41)], started: '2026-10-15T10:30:00Z', load: { start: { avg1: 2.0 }, end: { avg1: 3.0 } } });
    const r = K.compareRuns(cand, bs);
    expect(r.report.roomEnterDrawCalls.maxIncrease).toBe(14);
    expect(r.report.roomEnterDrawCalls.matched).toBe(3);
    expect(r.ok).toBe(true);
    expect(r.report.over50PerThousandSteps.cand).toBe(0);
    expect(r.report.order).toBe('cand-first');
    expect(r.report.load.base.end.avg1).toBe(3.0);
    expect(K.compareRuns(bs, cand).report.order).toBe('base-first');
  });
  test('실행 순서는 시각을 읽을 수 없으면 unknown, 같으면 same-time', () => {
    expect(K.runOrder(undefined, '2026-10-15T10:00:00Z')).toBe('unknown');
    expect(K.runOrder('2026-10-15T10:00:00Z', '2026-10-15T10:00:00Z')).toBe('same-time');
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
    expect(K.overPer1000(7, 70000)).toBeCloseTo(.1, 9);
    expect(K.overPer1000(7, 0)).toBe(null);
  });
});
