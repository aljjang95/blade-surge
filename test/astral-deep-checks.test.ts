import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/astral-deep-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEF: any = (ROUTE_OBJECTIVES as any).astral_deep;
const RING: any = DEF.ring;

// 방 배치: 판정은 방 위치를 setup 으로 받는다. 방 id 마다 x = id * 40, z = 0 (심층: 2·5 보물, 4·7 정예, 1·3·6 일반).
const room = (id: number) => ({ id, x: id * 40, z: 0 });
const CX = room(7).x, CZ = 0;
/** 고리 방(22 × 24) 안 좌표. */
const SETUP: any = {
  gates: DEF.gates.map((g: any) => ({ id: g.roomId, roomX: room(g.roomId).x, roomZ: 0, x: room(g.roomId).x, z: 0, answer: g.answer,
    pads: DEF.choices.map((c: any) => ({ id: c.id, x: room(g.roomId).x + c.dx, z: c.dz })) })),
  ring: { roomId: 7, roomX: CX, roomZ: CZ, cx: CX, cz: CZ, minX: CX - 11, maxX: CX + 11, minZ: -12, maxZ: 12,
    marks: RING.marks.map((m: number[]) => ({ x: CX + m[0], z: CZ + m[1] })) },
};
const SG = (k: number) => SETUP.gates[k];
const padOf = (k: number, id: string) => SG(k).pads.find((p: any) => p.id === id);
const wrongPadOf = (k: number) => SG(k).pads.find((p: any) => p.id !== SG(k).answer);
const ringMark = (i: number) => SETUP.ring.marks[i];
const SAFE = { x: CX + 4.5, z: CZ + 4.5 };   // 중심에서 7.07, 성표에서 5.1 떨어진 안전한 점

// 문구는 PLAN 3.1·3.2 의 계약 문장을 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const LABELS = ['1번 성좌 · 끊어진 별길', '2번 성좌 · 되돌아온 빛', '3번 성좌 · 가라앉은 닻별', '4번 성좌 · 귀환 좌표'];
const TXT = {
  all: '모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다', open: '성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요',
  hit: '파편 집결 피격 · 파편이 모이면 중심 밖으로', done: '외곽 고리 정화 · 레비아탄의 봉인이 풀립니다',
  start: (limit: number) => '외곽 고리 정화 시작 · ' + limit + '초', collapse: (limit: number) => '외곽 고리 붕괴 · 성표가 흐려졌습니다 · 다시 ' + limit + '초',
  mark: (k: number) => '성표 정화 · ' + k + '/4', ready: (k: number, current: boolean) => LABELS[k] + ' 정화 · ' + (current ? '모래시계 단서를 읽으세요' : '복원 순서 대기'),
  restore: (k: number) => LABELS[k] + ' 복원 완료 · ' + (k + 1) + '/4',
  tactic: '보스 전술 문구 · 별빛을 삼킨 레비아탄에게는 파편이 모입니다',
};
const objDom = (pr: number, action: string) => '별자리 복원 ' + pr + '/4 ' + action + ' 0.6/1';
const ringDom = (left: number) => '외곽 고리 정화 0/4 파편이 모이면 중심 밖으로 · ' + Math.ceil(left) + '초';

/** 독립된 집결 위상(PLAN 3.1 식을 다시 적은 모의). */
function shardOf(ck: number) {
  const u = ck - RING.first;
  if (u < 0) return { s: 0, c: -1, a: 0 };
  const cyc = Math.floor(u / RING.period), m = u - cyc * RING.period;
  if (m < RING.warning) return { s: 1, c: cyc, a: m };
  if (m < RING.warning + RING.burst) return { s: 2, c: cyc, a: m - RING.warning };
  return { s: 0, c: cyc, a: m - RING.warning - RING.burst };
}
const inRect = (x: number, z: number) => x >= SETUP.ring.minX && x <= SETUP.ring.maxX && z >= SETUP.ring.minZ && z <= SETUP.ring.maxZ;
const d2 = (a: any, b: any) => Math.hypot(a.x - b.x, a.z - b.z);

/** 영웅 방어로 줄어든 실제 체력 감소 비(기사 관측 .038 / .08). 규칙이 넘긴 값(hr)과 실제 감소를 따로 본다. */
const MIT = .476;

/**
 * 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 표식은 같은 스텝의 행을 하나 더 넣는다.
 * 규칙(조율판 엔진 · 외곽 고리)은 PLAN 3.1 과 일반판 엔진의 문장대로 모의한다. 판정 함수가 이 모의의 정상 경로를 통과하고 깨뜨린 경로를 잡는지 본다.
 * flags 는 일부러 어긋나게 만드는 장치다(gateRooms 순서, readNeed · holdNeed 부족, 방 2 미리 정화, 4/4 전 열림, 봉인 조기 해제, 같은 cycle 두 번 피격, 피해 값, 붕괴 뒤 성표 유지, 완료 때 hold 초기화).
 */
class Sim {
  rows: any[] = []; toasts: any[] = []; n = 0; hero = { x: 0, z: 0 }; hp = 100; hrNow: number[] = []; hn = 0;
  pr = 0; rem = 7; sl = 1; au = 1; ps = 'move'; rm = 0; foreign = 0;
  rs = 0; hd = 0; se = ''; mi = 0; wrongLatch = false; confirm: string | null = null; moveDone = false;
  g: any[]; rg: any; pendingOpen = false; hitCycles = new Set<number>(); doubled = false; cond = 0; inside = 0; domNext: string | null = null; flags: any; pauseNext = false;
  constructor(flags: any = {}) {
    this.flags = flags;
    const rooms: number[] = flags.gateRooms ?? DEF.gates.map((x: any) => x.roomId);
    this.g = rooms.map(id => ({ id, rdy: 0, av: 0, at: 0, cl: 0, dc: 0, al: 0, pd: 0 }));
    this.rg = { ph: 0, ck: 0, lf: 0, lim: 0, el: 0, co: 0, sh: 0, pu: 0, m: RING.marks.map(() => ({ h: 0, d: 0 })) };
    this.snap({ mk: 'start' });
  }
  get readNeed() { return this.flags.readNeed ?? DEF.readSeconds; }
  get holdNeed() { return this.flags.holdNeed ?? DEF.holdSeconds; }
  phaseCode() {
    if (this.pr >= 4) return 4;
    if (!this.g[this.pr].av) return 0;
    return this.wrongLatch ? 3 : this.rs + 1e-9 >= DEF.readSeconds ? 2 : 1;
  }
  heldIndex() { return this.rg.m.findIndex((m: any) => !m.d && m.h > 0); }
  snap(extra: any = {}) {
    const c = this.rg, live = c.ph === 1 || c.ph === 2, sd = live ? shardOf(c.ck) : { s: 0, c: -1, a: 0 };
    const ph = this.phaseCode();
    const row: any = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: this.hp, mhp: 100, al: 1, rm: this.rm, pr: this.pr, sl: this.sl, rem: this.rem,
      au: this.au, ah: 0, ps: this.ps, rs: this.rs, hd: this.hd, ph, rv: this.rs + 1e-9 >= DEF.readSeconds ? 1 : 0, se: this.se, mi: this.mi, hn: this.hn,
      ec: this.pr < 4 ? this.g[this.pr].al + this.foreign : 0, g: this.g.map(x => ({ ...x })),
      rg: { ph: c.ph, rid: 7, ck: c.ck, lf: c.lf, lim: c.lim, el: c.el, co: c.co, sh: c.sh, pu: c.pu, ho: this.heldIndex(), m: c.m.map((m: any) => ({ h: m.h, d: m.d })), sd }, ...extra };
    if (this.domNext) { row.dom = this.domNext; this.domNext = null; }
    if (this.hrNow.length) { row.hr = this.hrNow; this.hrNow = []; }
    if (this.pauseNext) row.pz = 1;
    this.rows.push(row); return row;
  }
  /** 규칙이 최대 체력 × raw 를 hurt 에 넘기고 방어로 MIT 배만 깎인다. */
  hurt(raw: number) { this.hrNow.push(raw); this.hn++; this.hp -= raw * 100 * MIT; }
  toast(msg: string, kind = 'gold') { this.toasts.push({ n: this.n, t: this.n * FRAME, msg, kind }); }
  at(x: number, z = 0) { this.hero = { x, z }; }
  // ---- 규칙 모의: 일반판 조율판 엔진(update) ----
  gateUpdate() {
    for (const q of this.g) q.av = 0;
    const gate = this.g[this.pr];
    if (!gate) { this.rs = 0; this.hd = 0; this.se = ''; this.confirm = null; return; }
    const sg = SG(this.pr);
    gate.av = gate.rdy && gate.al === 0 && gate.pd === 0 && gate.dc && !this.foreign && d2(this.hero, sg) <= DEF.readRadius ? 1 : 0;
    if (!gate.av) { this.rs = 0; this.hd = 0; this.se = ''; this.confirm = null; return; }
    const pad = sg.pads.find((p: any) => d2(this.hero, p) <= DEF.radius);
    if (this.wrongLatch) {
      this.hd = 0; this.rs = 0;
      if (!pad) this.wrongLatch = false;
    } else if (this.rs + 1e-9 < this.readNeed) {
      this.rs = Math.min(this.readNeed, this.rs + FRAME); this.hd = 0; this.se = '';
    } else {
      const cur = pad ? pad.id : '';
      if (cur !== this.se) { this.hd = 0; this.confirm = null; }
      this.se = cur;
      const confirming = this.confirm !== null && this.confirm === cur;
      this.hd = pad ? Math.min(this.holdNeed, this.hd + FRAME) : 0;
      if (confirming) {
        this.confirm = null;
        if (cur === DEF.gates[this.pr].answer) {
          gate.at = 1; gate.av = 0; gate.cl = 1; this.pr++; this.rs = 0; this.hd = 0; this.se = ''; this.rem--;
          this.toast(TXT.restore(this.pr - 1));
          if (this.pr === 4) this.toast(TXT.all);
        } else {
          this.mi++; this.wrongLatch = true; this.rs = 0; this.hd = 0; this.se = '';
          const wrong = DEF.choices.find((c: any) => c.id === cur), clue = DEF.choices.find((c: any) => c.id === DEF.gates[this.pr].answer);
          this.toast(wrong.code + ' ' + wrong.glyph + ' 오답 · 단서는 ' + clue.code + ' ' + clue.glyph + ' · 판 밖으로 나와 다시 읽으세요.');
        }
      } else if (pad && this.hd + 1e-9 >= this.holdNeed) this.confirm = cur;
    }
  }
  // ---- 규칙 모의: 외곽 고리 ----
  ringUpdate() {
    const c = this.rg, f = this.flags;
    if (this.pendingOpen) {
      c.ph = 1; c.ck = 0; this.pendingOpen = false; this.toast(TXT.open);
      if (f.unsealEarly) this.sl = 0;
      return;
    }
    if (c.ph !== 1 && c.ph !== 2) return;
    c.ck += FRAME;
    if (c.ph === 1) {
      if (inRect(this.hero.x, this.hero.z) && this.inside++ >= (f.startDelay ?? 0)) { c.ph = 2; c.el = 0; c.lim = RING.limit; c.lf = c.lim; this.toast(TXT.start(c.lim)); }
    } else { c.el += FRAME; c.lf -= FRAME; }
    if (c.ph === 2) {
      c.m.forEach((m: any, i: number) => {
        if (m.d) return;
        m.h = d2(this.hero, ringMark(i)) <= RING.markRadius ? m.h + FRAME : 0;
        if (m.h + 1e-9 >= RING.holdSeconds) {
          m.d = 1; c.pu++; if (f.resetOnDone) m.h = 0;
          if (c.pu < 4) this.toast(TXT.mark(c.pu));
        }
      });
      if (c.pu === RING.marks.length) { c.ph = 3; this.sl = f.sealStays ? 1 : 0; this.toast(TXT.done); return; }
    }
    const sd = shardOf(c.ck);
    if (sd.s === 2 && d2(this.hero, { x: CX, z: CZ }) <= RING.core && (!this.hitCycles.has(sd.c) || (f.doubleHit && !this.doubled))) {
      if (this.hitCycles.has(sd.c)) this.doubled = true;
      this.hitCycles.add(sd.c); c.sh++; this.hurt(f.hitDamage ?? RING.damage); this.toast(TXT.hit, 'red');
    }
    if (c.ph === 2 && c.lf <= 1e-9) {
      c.co++; this.hurt(f.collapseDamage ?? RING.collapseDamage); c.lf = c.lim; this.toast(TXT.collapse(c.lim), 'red');
      if (!f.keepPurified) { c.pu = 0; c.m.forEach((m: any) => { m.h = 0; m.d = 0; }); } else c.m.forEach((m: any) => { if (!m.d) m.h = 0; });
    }
  }
  step(extra: any = {}) {
    this.n++;
    this.gateUpdate();
    this.ringUpdate();
    const openAt = this.flags.openAt3 ? this.pr >= 3 : this.pr === 4 && this.rem === 0;
    if (openAt && this.rg.ph === 0 && !this.pendingOpen) { this.cond++; if (this.cond > (this.flags.openDelay ?? 0)) this.pendingOpen = true; }
    return this.snap(extra);
  }
  run(k: number) { for (let i = 0; i < k; i++) this.step(); }
  until(cond: () => boolean, max = 6000) { for (let i = 0; i < max; i++) { if (cond()) return; this.step(); } throw new Error('until: 조건에 닿지 못함 (n=' + this.n + ')'); }
  mark(label: string) { return this.snap({ mk: label }); }
  // ---- 시나리오 조각 ----
  clearRoom(id: number) { this.rem--; this.rm = id; this.at(room(id).x, 0); this.step(); }
  discover(k: number) { this.g[k].dc = 1; this.rm = this.g[k].id; this.at(SG(k).x, -5); this.step(); }
  fight(k: number) { this.g[k].al = 4; this.run(20); this.g[k].al = 0; this.step(); this.g[k].rdy = 1; this.toast(TXT.ready(k, this.pr === k)); this.step(); }
  /** 모래시계 반경 안에서 단서를 읽고 정답 판에서 유지해 복원한다. */
  restore(k: number) {
    const answer = DEF.gates[k].answer;
    this.at(SG(k).x, -5);
    for (let s = 1; s <= 70 && this.rs + 1e-9 < this.readNeed; s++) { if (s === 36) this.domNext = objDom(this.pr, '모래시계 단서 1초 읽기'); this.step(); }
    this.at(padOf(k, answer).x, padOf(k, answer).z);
    for (let s = 1; s <= 140 && this.pr === k; s++) { if (s === 36) this.domNext = objDom(this.pr, '월드 단서와 같은 판에서 1초 유지'); this.step(); }
    this.step();
  }
  /** 정상 진행의 앞부분: 방 1 정리 → 방 2(성좌 2번)는 먼저 정리돼 대기 → 방 3(성좌 1번)이 준비돼 차례를 맞음. */
  prefix() {
    this.clearRoom(1);
    this.discover(1); this.fight(1); this.run(5);
    this.discover(0); this.fight(0);
    return this;
  }
  /** 1번 복원 뒤: 방 2 복원 → 방 4 정리 → 방 5 → 방 6 → 방 7 정리, 고리 열림까지. opts.inside 면 열리는 스텝에 영웅이 고리 방 안(서쪽 문 안쪽)에 있다. 아니면 동쪽 밖. */
  afterFirst(opts: { inside?: boolean } = {}) {
    this.at(SG(1).x, -5); this.step(); this.restore(1);
    this.clearRoom(4);
    this.discover(2); this.fight(2); this.restore(2);
    this.discover(3); this.fight(3); this.restore(3);
    this.rem--; this.rm = 7; this.at(CX + 15, 0); this.step();   // 조건이 처음 관측되는 스텝
    this.at(opts.inside ? CX - 10 : CX + 15, 0); this.step();     // 다음 update 에 열림
    return this;
  }
  /** 정상 진행: 성좌 4곳(방 3 → 2 → 5 → 6), 정예방 4·7 정리, 고리 열림까지. */
  toOpen(opts: { inside?: boolean } = {}) { this.prefix(); this.restore(0); return this.afterFirst(opts); }
  /** AUTO 처럼 중심(core)을 지나지 않고 성표를 하나씩 정화한다. 열려 있고 영웅이 밖이면 서쪽 문 안쪽으로 들어서며 시작한다. */
  autoRing(order = [0, 1, 2, 3]) {
    if (this.rg.ph === 1) { this.run(3); this.at(CX - 10, 0); this.step(); }
    order.forEach((i, k) => {
      if (this.rg.m[i].d) return;
      this.at(ringMark(i).x, ringMark(i).z);
      for (let s = 1; s <= 80 && !this.rg.m[i].d && this.rg.ph === 2; s++) { if (k === 0 && s === 36) this.domNext = ringDom(this.rg.lf); this.step(); }
    });
    this.run(30);
    return this;
  }
  result(over: any = {}) {
    const c = this.rg, doneRow = this.rows.find(r => r.rg.ph === 3);
    return { win: true, ro: { id: DEF.id, complete: true, progress: 4, target: 4, mistakes: this.mi, rooms: [3, 2, 5, 6],
      constellations: DEF.gates.map((g: any) => ({ stationId: g.stationId, roomId: g.roomId, label: g.label, choice: g.answer })),
      ring: { purified: c.ph === 3, marks: c.m.filter((m: any) => m.d).length, collapses: c.co, shardHits: c.sh, seconds: doneRow?.rg.el ?? 0 }, ...over } };
  }
}

const linesOf = (ro: any) => [
  { aria: '별자리 복원 결과', text: '별자리 복원 ' + ro.progress + '/' + ro.target + ' · ' + LABELS.join(' → ') + ' · 오답 ' + ro.mistakes + '회' },
  { aria: '외곽 고리 정화 결과', text: '외곽 고리 정화 ' + (ro.ring.purified ? '완료' : '미완료') + ' · 성표 ' + ro.ring.marks + '/4 · 파편 피격 ' + ro.ring.shardHits + '회 · 붕괴 ' + ro.ring.collapses + '회' },
];
const auto = (s: Sim, over: any = {}, opts: any = {}) => {
  const res = s.result(), ro = over.ro ?? res.ro, lines = linesOf(ro);
  return K.analyzeAuto({ rows: s.rows, setup: SETUP, result: ro, resultText: '결과 ' + lines.map(l => l.text).join(' / '), resultLines: lines, win: true,
    toasts: s.toasts, encounterTactic: null, ...over }, DEF, opts);
};
const mut = (rows: any[], fn: (rows: any[]) => void) => { const c = structuredClone(rows); fn(c); return c; };
function legitRun(flags: any = {}) { const s = new Sim(flags).toOpen(); s.autoRing(); return s; }
const failed = (a: any) => Object.entries(a.acceptance).filter(([, v]) => v !== true).map(([k]) => k);

/** choice 시나리오: 1번 성좌가 준비된 순간 AUTO 끔 → 모래시계 근처에서 읽기 → 오답 판 1초 → 판 밖에서 다시 읽기 → 정답 판 1초 → 복원 → AUTO 가 나머지를 이어받아 완주. */
function choiceRun(over: { hurtDuring?: boolean } = {}) {
  const s = new Sim().prefix();
  s.au = 0; s.ps = 'idle';
  s.mark('ch-manual');
  s.at(SG(0).x, -5);
  s.until(() => s.phaseCode() === 2);
  s.mark('ch-read1');
  const wrong = wrongPadOf(0);
  s.at(wrong.x, wrong.z);
  s.until(() => s.mi === 1);
  s.mark('ch-wrong');
  if (over.hurtDuring) s.hurt(.05);
  s.at(SG(0).x, 0);
  s.until(() => s.phaseCode() === 2);
  s.mark('ch-reread');
  const ans = padOf(0, DEF.gates[0].answer);
  s.at(ans.x, ans.z);
  s.until(() => s.pr === 1);
  s.mark('ch-correct');
  s.au = 1; s.ps = 'move';
  return s.afterFirst().autoRing();
}
/** ring 시나리오: 고리 open 에서 AUTO 끔 → (방 밖 3초 대기 | 이미 방 안) → 진입 → 중심 core 에서 두 cycle 피격 → 성표 하나 정화 → 안전한 곳에서 붕괴 → AUTO → 4/4. */
function ringRun(over: { inside?: boolean; flags?: any; waitSteps?: number; earlyEnter?: number } = {}) {
  const s = new Sim(over.flags ?? {}).toOpen({ inside: over.inside });
  s.au = 0; s.ps = 'idle';
  s.mark('rg-manual');
  if (over.inside) s.step();
  else if (over.earlyEnter) { s.run(over.earlyEnter); s.at(CX - 10, 0); s.run((over.waitSteps ?? 180) - over.earlyEnter); } else s.run(over.waitSteps ?? 180);
  s.mark('rg-wait-end');
  if (!over.inside) { s.at(CX - 10, 0); s.step(); }
  s.mark('rg-started');
  s.at(CX, CZ);
  s.until(() => s.rg.sh === 1); s.mark('sh1');
  s.until(() => shardOf(s.rg.ck).s === 0); s.mark('sh1-end');
  s.until(() => s.rg.sh === 2); s.mark('sh2');
  s.until(() => shardOf(s.rg.ck).s === 0); s.mark('sh2-end');
  s.at(ringMark(0).x, ringMark(0).z);
  s.until(() => s.rg.pu === 1); s.mark('pu1');
  s.at(SAFE.x, SAFE.z);
  s.until(() => s.rg.co === 1); s.mark('collapse');
  s.mark('rg-auto'); s.au = 1; s.ps = 'move';
  return s.autoRing();
}

describe('정의·setup', () => {
  test('공유 정의가 계약과 같고, 어긋나면 어긋난 항목을 알린다', () => {
    expect(K.checkDefinition(DEF)).toEqual({ ok: true, issues: [] });
    expect(K.checkDefinition(null).ok).toBe(false);
    const fields = (def: any) => K.checkDefinition(def).issues.map((i: any) => i.field);
    expect(fields({ ...DEF, gates: [DEF.gates[1], DEF.gates[0], DEF.gates[2], DEF.gates[3]] })).toEqual(expect.arrayContaining(['rooms', 'labels']));
    expect(fields({ ...DEF, ring: { ...RING, limit: 30 } })).toEqual(['ring']);
    expect(fields({ ...DEF, ring: { ...RING, marks: [[-6, 0], [0, -6], [6, 0], [0, 7]] } })).toEqual(['ring']);
    expect(fields({ ...DEF, ring: undefined })).toEqual(['ring']);
    expect(fields({ ...DEF, readSeconds: 2 })).toEqual(['readSeconds']);
    expect(fields({ ...DEF, kind: 'constellations' })).toEqual(['kind']);
    expect(fields({ ...DEF, gates: DEF.gates.map((g: any, i: number) => (i === 2 ? { ...g, answer: 'circle' } : g)) })).toEqual(['answers']);
    expect(fields({ ...DEF, choices: [...DEF.choices].reverse() })).toEqual(['choices']);
  });
  test('정적 setup 이 정의의 오프셋과 맞는지 본다', () => {
    expect(K.checkSetup(SETUP, DEF).ok).toBe(true);
    const moved = (patch: (s: any) => void) => { const s = structuredClone(SETUP); patch(s); return K.checkSetup(s, DEF); };
    expect(moved(s => { s.ring.marks[1].z += 1; }).checks.marks).toBe(false);
    expect(moved(s => { s.ring.cx += 1; }).checks.center).toBe(false);
    expect(moved(s => { s.ring.roomId = 6; }).checks.room).toBe(false);
    expect(moved(s => { s.ring.minX = s.ring.cx - 3; }).checks.coreInside).toBe(false);
    expect(moved(s => { s.gates[1].pads[0].x += 1; }).checks.gates).toBe(false);
    expect(moved(s => { s.gates[0].answer = 'triangle'; }).checks.gates).toBe(false);
    expect(K.checkSetup(null, DEF).ok).toBe(false);
  });
});

describe('정상 AUTO 경로', () => {
  const a = auto(legitRun());
  test('모든 판정이 통과한다', () => { expect(failed(a)).toEqual([]); expect(a.ok).toBe(true); });
  test('복원 순서 [3,2,5,6], 복원마다 읽기 1초와 유지 1초가 직전에 관측된다', () => {
    expect(a.restorations.observedOrder).toEqual([3, 2, 5, 6]);
    expect(a.restorations.count).toBe(4);
    for (const e of a.restorations.events) {
      expect(e.read.readBeforeHold).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(e.hold.seconds).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(e.read.span).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(e.pad.selected).toBe(true);
    }
  });
  test('방 2 성좌는 1번 복원 전에 준비되고 그동안 방 2 는 미정화다', () => {
    expect(a.turn.early.rows).toBeGreaterThan(20);
    expect(a.turn.early.clean).toBe(true);
    expect(a.turn.gates).toContain(1);
  });
  test('고리는 4/4 와 모든 구역 정화 뒤 닫혀 있다 열리고(clock 0), 봉인은 고리 완료 스텝에 풀린다', () => {
    expect(a.open.ok).toBe(true);
    expect(a.open.clock).toBe(0);
    expect(a.open.progress).toBe(4);
    expect(a.open.remaining).toBe(0);
    expect(a.open.lag).toBe(1);
    expect(a.seal.firstUnsealed).toBe(a.seal.doneIdx);
    expect(a.start.limit).toBe(20);
    expect(a.counts.collapses).toBe(0);
    expect(a.counts.purified).toBe(4);
  });
  test('성표 4개는 모두 0 에서 시작한 1초 유지로 정화되고, 목표창 표본은 선택 단계와 고리 정화 중을 포함한다', () => {
    expect(a.marks.count).toBe(4);
    expect(a.marks.order.sort()).toEqual([0, 1, 2, 3]);
    expect(a.objective.kinds.select).toBeGreaterThanOrEqual(1);
    expect(a.objective.kinds.run).toBeGreaterThanOrEqual(1);
  });
  test('성표를 어떤 순서로 정화해도(순서 자유) 통과하고, 완료 때 hold 를 0 으로 되돌려도 통과한다', () => {
    expect(auto(new Sim().toOpen().autoRing([2, 0, 3, 1])).ok).toBe(true);
    const s = legitRun({ resetOnDone: true });
    expect(failed(auto(s))).toEqual([]);
  });
  test('4/4 성표 토스트가 있어도 없어도 통과한다', () => {
    const s = legitRun();
    const withFinal = [...s.toasts];
    withFinal.splice(withFinal.findIndex(t => t.msg === TXT.done), 0, { n: 1, t: 1, msg: TXT.mark(4), kind: 'gold' });
    expect(auto(s, { toasts: withFinal }).acceptance.toasts).toBe(true);
    const twice = [...withFinal, { n: 2, t: 2, msg: TXT.mark(4), kind: 'gold' }];
    expect(auto(s, { toasts: twice }).acceptance.toasts).toBe(false);
  });
});

describe('성좌 4곳: 복원 순서·읽기·유지', () => {
  test('복원 순서가 [2,3,5,6] 이면 순서 판정이 실패한다', () => {
    const a = auto(legitRun({ gateRooms: [2, 3, 5, 6] }));
    expect(a.acceptance.restoreOrder).toBe(false);
    expect(a.restorations.violations.some((v: any) => v.kind === 'order')).toBe(true);
    expect(a.ok).toBe(false);
  });
  test('방 2 성좌가 1번 복원 전에 정화(cleared)되면 실패한다', () => {
    const s = new Sim().prefix();
    s.g[1].cl = 1;   // 차례가 아닌 성좌 방이 정리만으로 정화됨
    s.restore(0); s.afterFirst().autoRing();
    const a = auto(s);
    expect(a.acceptance.turnRooms).toBe(false);
    expect(a.turn.bad.some((b: any) => b.kind === 'cleared-before-attune')).toBe(true);
  });
  test('차례가 아닌 성좌가 attuned 로 보이면(복원 순서 위반) 실패한다', () => {
    const bad = mut(legitRun().rows, rows => { const r = rows.find((x: any) => x.pr === 1 && x.g[2].at === 0); r.g[2].at = 1; });
    expect(K.checkTurnRooms(bad, DEF).ok).toBe(false);
  });
  test('방 2 성좌가 한 번도 먼저 준비되지 않았으면 early 요구에서 실패하고, 요구하지 않으면 통과한다', () => {
    const noEarly = new Sim();
    noEarly.clearRoom(1); noEarly.discover(0); noEarly.fight(0); noEarly.restore(0);
    noEarly.discover(1); noEarly.fight(1); noEarly.restore(1); noEarly.clearRoom(4);
    noEarly.discover(2); noEarly.fight(2); noEarly.restore(2); noEarly.discover(3); noEarly.fight(3); noEarly.restore(3);
    noEarly.rem--; noEarly.at(CX + 15, 0); noEarly.step(); noEarly.step(); noEarly.autoRing();
    expect(K.checkTurnRooms(noEarly.rows, DEF, { requireEarly: true }).ok).toBe(false);
    expect(K.checkTurnRooms(noEarly.rows, DEF, { requireEarly: false }).ok).toBe(true);
    expect(auto(noEarly, {}, { requireEarly: false }).ok).toBe(true);
  });
  test('단서 읽기가 1초에 못 미치면 실패한다', () => {
    const a = auto(legitRun({ readNeed: .5 }));
    expect(a.acceptance.restoreRead).toBe(false);
    expect(a.restorations.violations.some((v: any) => v.kind === 'read')).toBe(true);
  });
  test('판 유지가 1초에 못 미치면 실패한다', () => {
    const a = auto(legitRun({ holdNeed: .5 }));
    expect(a.acceptance.restoreHold).toBe(false);
    expect(a.restorations.violations.some((v: any) => v.kind === 'hold')).toBe(true);
  });
  test('읽는 도중 전투 중 적이 있었거나 모래시계에서 8 보다 멀었거나 available 이 꺼진 행이 있으면 실패한다', () => {
    const s = legitRun();
    const ev = (rows: any[]) => K.checkRestorations(rows, DEF, { setup: SETUP });
    const find = (rows: any[]) => { const i = rows.findIndex((x: any) => x.pr === 0 && x.rs > 0.3 && x.rs < 0.5); return rows[i]; };
    expect(ev(s.rows).ok.available).toBe(true);
    expect(ev(mut(s.rows, rows => { find(rows).ec = 1; })).ok.available).toBe(false);
    expect(ev(mut(s.rows, rows => { const r = find(rows); r.x = SG(0).x + 9; })).ok.available).toBe(false);
    expect(ev(mut(s.rows, rows => { find(rows).g[0].av = 0; })).ok.available).toBe(false);
    expect(ev(mut(s.rows, rows => { find(rows).g[0].al = 2; })).ok.available).toBe(false);
  });
  test('복원 스텝에 확정 판이 정답이 아니거나 영웅이 정답 판 반경 밖이면 실패한다', () => {
    const s = legitRun();
    const ev = (rows: any[]) => K.checkRestorations(rows, DEF, { setup: SETUP });
    const holdRow = (rows: any[]) => rows.find((x: any) => x.pr === 0 && x.hd > 0.5);
    expect(ev(mut(s.rows, rows => { holdRow(rows).se = 'triangle'; })).ok.hold).toBe(false);
    expect(ev(mut(s.rows, rows => { holdRow(rows).x += 2; })).ok.hold).toBe(false);
  });
  test('유지가 연속이 아니거나(중간 행 없음) 0 에서 시작하지 않았으면 실패한다', () => {
    const s = legitRun();
    const ev = (rows: any[]) => K.checkRestorations(rows, DEF, { setup: SETUP });
    const cut = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.pr === 0 && x.hd > 0.5); rows.splice(i, 1); });
    expect(ev(cut).ok.hold).toBe(false);
    const late = mut(s.rows, rows => { const r = rows.find((x: any) => x.pr === 0 && x.hd > 0); r.hd += .2; });
    expect(ev(late).ok.hold).toBe(false);
  });
  test('복원 스텝에 오답 수가 늘거나, 앞 성좌가 attuned 가 아니거나, 정화 전에 방이 cleared 였으면 실패한다', () => {
    const s = legitRun();
    const ev = (rows: any[]) => K.checkRestorations(rows, DEF, { setup: SETUP });
    const stepOf = (rows: any[], pr: number) => rows.find((x: any, i: number) => i > 0 && x.pr === pr && rows[i - 1].pr === pr - 1);
    expect(ev(mut(s.rows, rows => { stepOf(rows, 1).mi = 1; })).ok.state).toBe(false);
    expect(ev(mut(s.rows, rows => { stepOf(rows, 2).g[0].at = 0; })).ok.state).toBe(false);
    expect(ev(mut(s.rows, rows => { stepOf(rows, 1).g[0].cl = 0; })).ok.state).toBe(false);
    expect(ev(mut(s.rows, rows => { stepOf(rows, 2).g[3].at = 1; })).ok.state).toBe(false);
  });
  test('복원이 한 번에 둘 늘거나 4 번 미만이면 개수 판정이 실패한다', () => {
    const s = legitRun();
    const jump = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.pr === 1); for (let k = i; k < rows.length; k++) { if (rows[k].pr === 1) rows[k].pr = 2; } });
    expect(K.checkRestorations(jump, DEF, { setup: SETUP }).ok.count).toBe(false);
    const few = s.rows.filter((x: any) => x.pr < 3 || x.n < s.rows.find((y: any) => y.pr === 3).n);
    expect(K.checkRestorations(few, DEF, { setup: SETUP }).ok.count).toBe(false);
  });
  test('준비 전에 읽기가 시작되거나 발견 전·적이 남은 채 ready 면 실패한다', () => {
    const s = legitRun();
    expect(K.checkReadyTiming(s.rows, DEF).ok).toBe(true);
    const early = mut(s.rows, rows => { const r = rows.find((x: any) => x.pr === 0 && x.rs > 0); const i = rows.indexOf(r); rows[i].g[0].rdy = 0; for (let k = 0; k < i; k++) rows[k].g[0].rdy = 0; rows[i - 1].rs = .1; rows[i - 1].g[0].rdy = 0; });
    expect(K.checkReadyTiming(early, DEF).ok).toBe(false);
    expect(K.checkReadyTiming(mut(s.rows, rows => { const r = rows.find((x: any) => x.g[2].rdy === 1); r.g[2].al = 1; }), DEF).ok).toBe(false);
    expect(K.checkReadyTiming(mut(s.rows, rows => { const r = rows.find((x: any) => x.g[2].rdy === 1); r.g[2].dc = 0; }), DEF).ok).toBe(false);
  });
});

describe('외곽 고리 열림·시작·제한 시간·시계', () => {
  const openIdx = (rows: any[]) => rows.findIndex((x: any) => x.rg.ph !== 0);
  const runIdx = (rows: any[]) => rows.findIndex((x: any) => x.rg.ph === 2);
  test('4/4 전에 열리면 실패한다', () => {
    const a = auto(legitRun({ openAt3: true }));
    expect(a.acceptance.ringOpen).toBe(false);
    expect(a.open.earlyCount).toBeGreaterThan(0);
    expect(a.open.progress).toBe(3);
  });
  test('정예방이 남은 채(rem 1) 열리면 실패한다', () => {
    const s = legitRun();
    const bad = mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.ph !== 0) r.rem = 1; }));
    expect(K.checkRingOpen(bad, DEF).ok).toBe(false);
    const attuned = mut(s.rows, rows => { rows[openIdx(rows)].g[2].at = 0; });
    expect(K.checkRingOpen(attuned, DEF).ok).toBe(false);
  });
  test('열리는 스텝에 시간이 흐르거나 조건 관측보다 세 스텝 뒤에 열리면 실패한다', () => {
    const s = legitRun();
    expect(K.checkRingOpen(mut(s.rows, rows => { rows[openIdx(rows)].rg.ck = FRAME; }), DEF).ok).toBe(false);
    expect(K.checkRingOpen(s.rows, DEF).lag).toBe(1);
    const late = legitRun({ openDelay: 2 });
    expect(K.checkRingOpen(late.rows, DEF).lag).toBe(3);
    expect(auto(late).acceptance.ringOpen).toBe(false);
    expect(auto(legitRun({ openDelay: 0 })).acceptance.ringOpen).toBe(true);
  });
  test('고리 방 id 가 정의와 다르거나 phase 가 거꾸로 가면 실패한다', () => {
    const s = legitRun();
    expect(K.checkRingOpen(mut(s.rows, rows => rows.forEach((r: any) => { r.rg.rid = 6; })), DEF).ok).toBe(false);
    expect(K.checkRingOpen(mut(s.rows, rows => { rows[runIdx(rows) + 10].rg.ph = 1; }), DEF).ok).toBe(false);
    expect(K.checkRingOpen(mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.rg.ph === 3); rows[i + 3].rg.ph = 2; }), DEF).ok).toBe(false);
  });
  test('방 사각형 안에 들어선 첫 스텝에 시작하고 limit 은 20 이다', () => {
    const s = legitRun();
    const st = K.checkRingStart(s.rows, DEF, SETUP);
    expect(st.ok).toBe(true);
    expect(st.limit).toBe(20);
    expect(st.waited).toBeGreaterThan(0);
    expect(auto(s).acceptance.ringLimit).toBe(true);
  });
  test('방 밖에서 시작했거나 늦게 시작했거나 limit 이 20 이 아니면 실패한다', () => {
    const s = legitRun();
    const i = runIdx(s.rows);
    expect(K.checkRingStart(mut(s.rows, rows => { rows[i].x = CX - 15; }), DEF, SETUP).ok).toBe(false);
    const lateRows = mut(s.rows, rows => { const o = openIdx(rows); rows[o + 2].x = CX - 5; rows[o + 2].z = 1; });
    const late = K.checkRingStart(lateRows, DEF, SETUP);
    expect(late.ok).toBe(false);
    expect(late.lateCount).toBe(1);
    const lim = mut(s.rows, rows => { rows[i].rg.lim = 12; rows[i].rg.lf = 12; });
    expect(K.checkRingStart(lim, DEF, SETUP).ok).toBe(false);
    expect(K.checkRingLimit(lim, DEF).ok).toBe(false);
    expect(K.checkRingStart(mut(s.rows, rows => { rows[i].rg.el = 1; }), DEF, SETUP).ok).toBe(false);
    expect(K.checkRingStart(mut(s.rows, rows => { rows[i].rg.sh = 1; }), DEF, SETUP).ok).toBe(false);
    expect(K.checkRingStart(mut(s.rows, rows => { rows[i].rg.pu = 1; }), DEF, SETUP).ok).toBe(false);
    expect(K.checkRingLimit(mut(s.rows, rows => { rows[i + 5].rg.lf = -1; }), DEF).ok).toBe(false);
  });
  test('열릴 때 영웅이 이미 방 안이면 다음 스텝에 시작한다(늦은 시작이 아니다)', () => {
    const s = new Sim().toOpen({ inside: true }); s.autoRing();
    const st = K.checkRingStart(s.rows, DEF, SETUP);
    expect(st.ok).toBe(true);
    expect(st.n).toBe(st.openN + 1);
    expect(auto(s).acceptance.ringStart).toBe(true);
  });
  test('고리 시계는 게임 시간만큼 흐르고, 일시정지 스텝은 값이 정확히 같을 때만 면제된다', () => {
    const s = legitRun();
    expect(K.checkRingClock(s.rows).ok).toBe(true);
    const i = runIdx(s.rows) + 8;
    const same = mut(s.rows, rows => { rows[i].pz = 1; rows[i].rg.ck = rows[i - 1].rg.ck; rows[i].rg.lf = rows[i - 1].rg.lf; rows[i].rg.el = rows[i - 1].rg.el; });
    const exempt = K.checkRingClock(same);
    expect(exempt.pauseEntry.length).toBe(1);
    expect(exempt.bad.some((b: any) => b.n === s.rows[i].n)).toBe(false);
    const off = mut(s.rows, rows => { rows[i].pz = 1; rows[i].rg.lf = rows[i - 1].rg.lf - 0.001; });
    expect(K.checkRingClock(off).bad.some((b: any) => b.n === s.rows[i].n)).toBe(true);
    const noPause = mut(s.rows, rows => { rows[i].rg.lf = rows[i - 1].rg.lf; rows[i].rg.el = rows[i - 1].rg.el; rows[i].rg.ck = rows[i - 1].rg.ck; });
    expect(K.checkRingClock(noPause).bad.some((b: any) => b.n === s.rows[i].n)).toBe(true);
    const doubled = mut(s.rows, rows => { for (let k = i; k < rows.length; k++) rows[k].rg.lf -= .05; });
    expect(K.checkRingClock(doubled).ok).toBe(false);
    const clock = mut(s.rows, rows => { for (let k = i; k < rows.length; k++) rows[k].rg.ck += .1; });
    expect(K.checkRingClock(clock).bad.some((b: any) => b.kind === 'clock')).toBe(true);
  });
});

describe('파편 집결·피격·성표·붕괴', () => {
  test('집결 상태·cycle·age 는 clock 에서 계산한 값과 같고 예고와 터짐이 모두 관측된다', () => {
    const s = legitRun();
    const ok = K.checkShards(s.rows, DEF);
    expect(ok.ok).toBe(true);
    expect(ok.seen.warning).toBeGreaterThan(0);
    expect(ok.seen.burst).toBeGreaterThan(0);
    const pick = (rows: any[], state: number) => rows.find((x: any) => x.rg.ph === 2 && x.rg.sd.s === state && Math.abs(shardOf(x.rg.ck).a - 0.7) < .4 && x.rg.sd.a > .2);
    expect(K.checkShards(mut(s.rows, rows => { pick(rows, 1).rg.sd.s = 0; }), DEF).badCount).toBeGreaterThan(0);
    expect(K.checkShards(mut(s.rows, rows => { pick(rows, 1).rg.sd.c += 1; }), DEF).bad[0].kind).toBe('cycle');
    expect(K.checkShards(mut(s.rows, rows => { pick(rows, 1).rg.sd.a += .4; }), DEF).bad[0].kind).toBe('age');
    expect(K.checkShards(mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.sd.s === 2) r.rg.sd.s = 0; })), DEF).ok).toBe(false);
  });
  test('집결 길이(예고 1.5 · 터짐 .5 · 주기 4.5 · 첫 1초)가 계약과 다르면 실패한다', () => {
    const s = legitRun();
    // 터짐을 1초로 늘린 것처럼 보이는 행: 터짐 직후 calm 이어야 할 행이 burst 로 읽힌다.
    const stretched = mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.ph === 2 && r.rg.sd.s === 0 && r.rg.sd.c >= 0 && shardOf(r.rg.ck).s === 0 && r.rg.ck - RING.first - r.rg.sd.c * RING.period < 1.5 + .5 + .3) r.rg.sd.s = 2; }));
    expect(K.checkShards(stretched, DEF).ok).toBe(false);
    const early = mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.ph === 2 && r.rg.ck < 1 && r.rg.sd.s === 0) { r.rg.sd.s = 1; r.rg.sd.c = 0; r.rg.sd.a = 0; } }));
    expect(K.checkShards(early, DEF).ok).toBe(false);
  });
  test('수동 고리(방 밖 대기): 두 cycle 피격, 성표 하나 정화, 붕괴 1회, AUTO 가 4/4 로 마무리한다', () => {
    const s = ringRun();
    const a = auto(s, {}, { clean: false });
    expect(failed(a)).toEqual([]);
    const m = K.analyzeRingManual(s.rows, DEF, SETUP);
    expect(m.ok).toBe(true);
    expect(m.start.mode).toBe('waited-outside');
    expect(m.hits.cycle2).toBe(m.hits.cycle1 + 1);
    expect(m.hits.all.total).toBe(2);
    expect(m.purify.purified).toBe(1);
    expect(m.collapse.purified).toBe(0);
    expect(m.final.purified).toBe(4);
    expect(m.final.collapses).toBe(1);
    // 같은 trace 로 AUTO 판정(clean)은 붕괴가 있어 실패한다.
    expect(auto(s).acceptance.autoCounts).toBe(false);
  });
  test('같은 cycle 안에서 피해가 두 번 늘면 실패한다', () => {
    const s = ringRun({ flags: { doubleHit: true } });
    expect(K.checkShardHits(s.rows, DEF, SETUP).bad.some((b: any) => b.kind === 'double')).toBe(true);
    expect(K.analyzeRingManual(s.rows, DEF, SETUP).ok).toBe(false);
  });
  test('피해 값이 정의 .06 이 아니면 strict 에서 실패한다', () => {
    const s = ringRun({ flags: { hitDamage: .1 } });
    expect(K.checkShardHits(s.rows, DEF, SETUP, { strict: true }).bad.some((b: any) => b.kind === 'damage')).toBe(true);
    expect(K.checkShardHits(s.rows, DEF, SETUP).ok).toBe(true);   // strict 가 아니면 값은 보지 않는다
    expect(K.analyzeRingManual(s.rows, DEF, SETUP).hits.ok).toBe(false);
    // 감소 비가 0 인 무적 피격이나 hr 기록이 없는 피격도 strict 에서는 통과하지 않는다.
    const good = ringRun();
    const noHr = mut(good.rows, rows => rows.forEach((r: any) => { delete r.hr; }));
    expect(K.checkShardHits(noHr, DEF, SETUP, { strict: true }).ok).toBe(false);
    const shield = mut(good.rows, rows => { for (let i = 1; i < rows.length; i++) if (rows[i].rg.sh > rows[i - 1].rg.sh) rows[i].hp = rows[i - 1].hp; });
    expect(K.checkShardHits(shield, DEF, SETUP, { strict: true }).bad.some((b: any) => b.kind === 'damage')).toBe(true);
  });
  test('core 밖(성표 위)에서 피해가 늘거나, core 깊숙이 있었는데 늘지 않으면 실패한다', () => {
    const s = ringRun();
    const first = s.rows.findIndex((x: any, i: number) => i > 0 && x.rg.sh > s.rows[i - 1].rg.sh);
    const away = mut(s.rows, rows => { for (let k = first - 1; k <= first; k++) { rows[k].x = CX + 8; rows[k].z = CZ; } });
    expect(K.checkShardHits(away, DEF, SETUP).bad.some((b: any) => b.kind === 'unexplained')).toBe(true);
    const removed = mut(s.rows, rows => { for (let k = first; k < rows.length; k++) rows[k].rg.sh -= 1; });
    const missed = K.checkShardHits(removed, DEF, SETUP, { strictMissed: true });
    expect(missed.missed.length).toBe(1);
    expect(missed.bad.some((b: any) => b.kind === 'missed')).toBe(true);
    expect(K.checkShardHits(removed, DEF, SETUP).missed.length).toBe(1);   // AUTO 에서는 기록만
    expect(K.checkShardHits(removed, DEF, SETUP).ok).toBe(true);
    // 경계 바로 안쪽(3.4)은 피격이고 바로 밖(core + .2 넘음)은 설명되지 않는다.
    const edgeIn = mut(s.rows, rows => { for (let k = first - 1; k <= first; k++) { rows[k].x = CX + RING.core; rows[k].z = CZ; } });
    expect(K.checkShardHits(edgeIn, DEF, SETUP).bad.some((b: any) => b.kind === 'unexplained')).toBe(false);
    const edgeOut = mut(s.rows, rows => { for (let k = first - 1; k <= first; k++) { rows[k].x = CX + RING.core + .5; rows[k].z = CZ; } });
    expect(K.checkShardHits(edgeOut, DEF, SETUP).bad.some((b: any) => b.kind === 'unexplained')).toBe(true);
  });
  test('성표: 같은 성표를 벗어나면 hold 가 초기화되고, 벗어났는데 hold 가 남아 있으면 실패한다', () => {
    const s = legitRun();
    expect(K.checkMarks(s.rows, DEF, SETUP).ok).toBe(true);
    const row = (rows: any[]) => rows.findIndex((x: any) => x.rg.ph === 2 && x.rg.m[0].h > 0.3 && !x.rg.m[0].d);
    const away = mut(s.rows, rows => { rows[row(rows)].x += 3; });
    expect(K.checkMarks(away, DEF, SETUP).bad.some((b: any) => b.kind === 'held-away')).toBe(true);
    const two = mut(s.rows, rows => { rows[row(rows)].rg.m[1].h = .4; });
    expect(K.checkMarks(two, DEF, SETUP).bad.some((b: any) => b.kind === 'two-held')).toBe(true);
    const idx = mut(s.rows, rows => { rows[row(rows)].rg.ho = 2; });
    expect(K.checkMarks(idx, DEF, SETUP).bad.some((b: any) => b.kind === 'held-index')).toBe(true);
    const noIdx = mut(s.rows, rows => { rows[row(rows)].rg.ho = -1; });
    expect(K.checkMarks(noIdx, DEF, SETUP).ok).toBe(false);
  });
  test('성표 정화는 0 에서 시작한 1초 유지여야 하고, purified 는 done 성표 수와 같다', () => {
    const s = legitRun();
    const i = s.rows.findIndex((x: any) => x.rg.pu === 1);
    const quick = mut(s.rows, rows => { for (let k = i - 40; k < i; k++) rows[k].rg.m[0].h = 0; });   // 유지가 40스텝 앞에서 끊긴 것처럼
    expect(K.checkMarks(quick, DEF, SETUP).ok).toBe(false);
    const count = mut(s.rows, rows => { rows[i + 2].rg.pu = 3; });
    expect(K.checkMarks(count, DEF, SETUP).bad.some((b: any) => b.kind === 'count')).toBe(true);
    const down = mut(s.rows, rows => { const k = rows.findIndex((x: any) => x.rg.pu === 2); rows[k + 3].rg.pu = 1; rows[k + 3].rg.m[0].d = 0; rows[k + 3].rg.m[1].d = 0; rows[k + 3].rg.m[0].d = 1; });
    expect(K.checkMarks(down, DEF, SETUP).ok).toBe(false);
    const undone = mut(s.rows, rows => { const k = rows.findIndex((x: any) => x.rg.pu === 2); rows[k + 3].rg.pu = 1; rows[k + 3].rg.m[0].d = 0; });
    const u = K.checkMarks(undone, DEF, SETUP);
    expect(u.bad.some((b: any) => b.kind === 'undone')).toBe(true);
    expect(u.bad.some((b: any) => b.kind === 'purified-down')).toBe(true);
    const far = mut(s.rows, rows => { for (let k = i - 10; k <= i; k++) { rows[k].x += 2; } });
    expect(K.checkMarks(far, DEF, SETUP).ok).toBe(false);
  });
  test('붕괴: 시간 초과 스텝에만, 성표 초기화 · 시간 limit 로 되돌림 · 피해 .06', () => {
    const s = ringRun();
    const c = K.checkCollapses(s.rows, DEF, { strict: true });
    expect(c.ok).toBe(true);
    expect(c.collapses.length).toBe(1);
    expect(c.collapses[0].raw).toEqual([0.06]);
    expect(c.collapses[0].purified).toBe(0);
  });
  test('붕괴 뒤에도 purified 가 그대로이거나 성표가 done 으로 남으면 실패한다', () => {
    const s = ringRun({ flags: { keepPurified: true } });
    const c = K.checkCollapses(s.rows, DEF, { strict: true });
    expect(c.bad.some((b: any) => b.kind === 'marks-kept')).toBe(true);
    expect(c.ok).toBe(false);
    expect(K.analyzeRingManual(s.rows, DEF, SETUP).collapse.ok).toBe(false);
  });
  test('붕괴 피해 값이 .06 이 아니거나 시간이 남았는데 붕괴하거나 limit 로 되돌리지 않으면 실패한다', () => {
    const dmg = ringRun({ flags: { collapseDamage: .12 } });
    expect(K.checkCollapses(dmg.rows, DEF, { strict: true }).bad.some((b: any) => b.kind === 'damage')).toBe(true);
    const s = ringRun();
    const i = s.rows.findIndex((x: any, k: number) => k > 0 && x.rg.co > s.rows[k - 1].rg.co);
    const early = mut(s.rows, rows => { rows[i - 1].rg.lf = 5; });
    expect(K.checkCollapses(early, DEF).bad.some((b: any) => b.kind === 'not-expired')).toBe(true);
    const noReset = mut(s.rows, rows => { for (let k = i; k < i + 5; k++) rows[k].rg.lf = 3; });
    expect(K.checkCollapses(noReset, DEF).bad.some((b: any) => b.kind === 'limit')).toBe(true);
    const wrongLimit = mut(s.rows, rows => { rows[i].rg.lim = 30; rows[i].rg.lf = 30; });
    expect(K.checkCollapses(wrongLimit, DEF).ok).toBe(false);
    const twice = mut(s.rows, rows => { rows[i].rg.co = 2; });
    expect(K.checkCollapses(twice, DEF).ok).toBe(false);
    const hold = mut(s.rows, rows => { rows[i].rg.m[1].h = .3; });
    expect(K.checkCollapses(hold, DEF).bad.some((b: any) => b.kind === 'marks-kept')).toBe(true);
    const held = mut(s.rows, rows => { rows[i].rg.ho = 1; });
    expect(K.checkCollapses(held, DEF).bad.some((b: any) => b.kind === 'marks-kept')).toBe(true);
  });
  test('붕괴는 시간이 바닥난 스텝이 아니면 일어나지 않고, 붕괴 없이 limit 를 넘기는 시계도 잡힌다', () => {
    const s = legitRun();
    const spurious = mut(s.rows, rows => { const k = rows.findIndex((x: any) => x.rg.ph === 2) + 20; for (let j = k; j < rows.length; j++) rows[j].rg.co = 1; });
    expect(K.checkCollapses(spurious, DEF).bad.some((b: any) => b.kind === 'not-expired')).toBe(true);
    expect(auto(s, { rows: spurious }).acceptance.collapses).toBe(false);
  });
  test('완료는 앞 행이 running 이고 성표가 모두 done 일 때만 처음 관측된다', () => {
    const s = legitRun();
    expect(K.checkRingDone(s.rows, DEF).ok).toBe(true);
    const i = s.rows.findIndex((x: any) => x.rg.ph === 3);
    expect(K.checkRingDone(mut(s.rows, rows => { rows[i].rg.pu = 3; rows[i].rg.m[3].d = 0; }), DEF).ok).toBe(false);
    expect(K.checkRingDone(mut(s.rows, rows => { rows[i + 4].rg.ph = 2; }), DEF).ok).toBe(false);
    expect(K.checkRingDone(mut(s.rows, rows => { rows[i + 4].rg.co = 1; }), DEF).ok).toBe(false);
    expect(K.checkRingDone(mut(s.rows, rows => { rows[i - 1].rg.ph = 1; }), DEF).ok).toBe(false);
    expect(K.checkRingDone(mut(s.rows, rows => { rows.splice(i - 1, 1); }), DEF).ok).toBe(false);
  });
});

describe('보스 봉인', () => {
  test('고리 완료 전까지 잠겨 있다 완료 스텝에 풀린다', () => {
    const s = legitRun();
    const seal = K.checkSeal(s.rows, DEF);
    expect(seal.ok).toBe(true);
    expect(seal.firstUnsealed).toBe(seal.doneIdx);
    const delayed = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.rg.ph === 3); rows[i].sl = 1; });
    expect(K.checkSeal(delayed, DEF).ok).toBe(true);   // 한 스텝 뒤 해제까지는 같은 update 의 관측 차이로 본다
    const late = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.rg.ph === 3); rows[i].sl = 1; rows[i + 1].sl = 1; });
    expect(K.checkSeal(late, DEF).ok).toBe(false);
  });
  test('4/4 와 모든 구역 정화로 이미 풀려 있거나(고리 열림 때 해제) 고리 완료 뒤에도 풀리지 않으면 실패한다', () => {
    const early = auto(legitRun({ unsealEarly: true }));
    expect(early.acceptance.sealed).toBe(false);
    expect(early.seal.reason).toBe('early-or-inconsistent');
    const never = auto(legitRun({ sealStays: true }));
    expect(never.acceptance.sealed).toBe(false);
    expect(never.seal.reason).toBe('never-unsealed');
  });
  test('풀린 뒤 다시 잠기거나 처음부터 열려 있으면 실패한다', () => {
    const s = legitRun();
    const relock = mut(s.rows, rows => { rows[rows.length - 3].sl = 1; });
    expect(K.checkSeal(relock, DEF).relocked).toBe(1);
    expect(K.checkSeal(relock, DEF).ok).toBe(false);
    const open = mut(s.rows, rows => { rows[0].sl = 0; });
    expect(K.checkSeal(open, DEF).startsSealed).toBe(false);
    expect(K.checkSeal(open, DEF).ok).toBe(false);
    expect(K.checkSeal(mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.rg.ph === 3); rows[i].rem = 1; rows.slice(i).forEach((r: any) => { r.rem = 1; }); }), DEF).ok).toBe(false);
  });
});

describe('관측 누락은 실패다', () => {
  test('읽기 · 유지 · 단계 · 선택 · 오답 수 · 피해 호출 수 · 성좌 칸 · 고리 칸이 -1 · null · undefined 이면 통과하지 않는다', () => {
    const s = legitRun();
    expect(K.checkObservation(s.rows, DEF).ok).toBe(true);
    const cases: [string, (r: any) => void][] = [
      ['rs null', r => { r.rs = null; }], ['hd 없음', r => { delete r.hd; }], ['ph 알 수 없음', r => { r.ph = 9; }], ['ph 읽지 못함', r => { r.ph = -1; }], ['rv 읽지 못함', r => { r.rv = -1; }],
      ['se null', r => { r.se = null; }], ['mi 읽지 못함', r => { r.mi = -1; }], ['hn null', r => { r.hn = null; }], ['ec 없음', r => { delete r.ec; }],
      ['성좌 칸 누락', r => { delete r.g[1].dc; }], ['성좌 하나 누락', r => { r.g.pop(); }], ['ring 없음', r => { r.rg = null; }], ['성표 하나 누락', r => { r.rg.m[1] = null; }],
      ['성표 done 알 수 없음', r => { r.rg.m[0].d = 2; }], ['집결 상태 알 수 없음', r => { r.rg.sd.s = 9; }], ['집결 cycle 읽지 못함', r => { r.rg.sd.c = null; }],
      ['held 읽지 못함', r => { r.rg.ho = null; }], ['clock NaN', r => { r.rg.ck = NaN; }], ['collapses null', r => { r.rg.co = null; }], ['고리 방 id 없음', r => { delete r.rg.rid; }],
    ];
    for (const [name, apply] of cases) {
      const rows = mut(s.rows, list => apply(list.find((r: any) => r.rg.ph === 2 && r.rg.sd.s === 1)));
      const o = K.checkObservation(rows, DEF);
      expect({ name, ok: o.ok }).toEqual({ name, ok: false });
      expect(auto(s, { rows }).acceptance.observation).toBe(false);
    }
  });
  test('-1 이 정상 값인 칸(held · cycle)은 읽혔을 때 -1 이어도 통과한다', () => {
    const s = legitRun();
    const idle = s.rows.find((r: any) => r.rg.ph === 0);
    expect(idle.rg.ho).toBe(-1);
    expect(idle.rg.sd.c).toBe(-1);
    expect(K.checkObservation([idle], DEF).ok).toBe(true);
  });
  test('고리 숫자는 단계에 맞게만 요구한다(idle 의 초기값은 규칙에 맡기고, 정화 중 left · limit 을 못 읽으면 실패)', () => {
    const s = legitRun();
    const idleBlank = mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.ph === 0) { r.rg.ck = null; r.rg.lf = null; r.rg.lim = null; r.rg.el = null; r.rg.sd.a = null; } }));
    expect(K.checkObservation(idleBlank, DEF).ok).toBe(true);
    expect(K.checkObservation(mut(s.rows, rows => { rows.find((r: any) => r.rg.ph === 2).rg.lf = null; }), DEF).ok).toBe(false);
    expect(K.checkObservation(mut(s.rows, rows => { rows.find((r: any) => r.rg.ph === 1).rg.ck = null; }), DEF).ok).toBe(false);
    expect(K.checkObservation(mut(s.rows, rows => { rows.find((r: any) => r.rg.ph === 1).rg.sd.a = null; }), DEF).ok).toBe(false);
  });
});

describe('토스트·문구 누출', () => {
  const base = () => legitRun();
  const tactic = TXT.tactic;
  const without = (s: Sim, msg: string) => s.toasts.filter(t => t.msg !== msg);
  test('정상 토스트는 통과하고 순서·횟수가 맞는다', () => {
    const s = base();
    const t = K.checkToasts(s.toasts, DEF, { shardHits: 0, collapses: 0, mistakes: 0, startLimit: 20, purifyCounts: [1, 2, 3, 4] });
    expect(t.ok).toBe(true);
    expect(t.sequence).toBe(true);
    expect(t.ready.map((r: any) => r.ok)).toEqual([true, true, true, true]);
    expect(t.markExpect).toEqual([TXT.mark(1), TXT.mark(2), TXT.mark(3)]);
  });
  test('복원 토스트가 빠지거나 두 번 뜨거나 순서가 바뀌면 실패한다', () => {
    const s = base();
    expect(K.checkToasts(without(s, TXT.restore(1)), DEF).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: TXT.restore(2) }], DEF).ok).toBe(false);
    const swapped = [...s.toasts], a = swapped.findIndex(t => t.msg === TXT.restore(1)), b = swapped.findIndex(t => t.msg === TXT.restore(2));
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    const sw = K.checkToasts(swapped, DEF);
    expect(sw.ok).toBe(false);
    expect(sw.ordered).toBe(false);
  });
  test('준비 토스트: 성좌마다 한 번, 준비된 순간이 차례면 읽으세요 · 아니면 복원 순서 대기', () => {
    const s = base();
    const t = (toasts: any[], readyCurrent: any = [true, false, true, true]) => K.checkToasts(toasts, DEF, { readyCurrent });
    expect(t(s.toasts).ready.map((r: any) => r.ok)).toEqual([true, true, true, true]);
    expect(t(without(s, TXT.ready(2, true))).ok).toBe(false);
    expect(t([...s.toasts, { msg: TXT.ready(2, true) }]).ok).toBe(false);
    // 방 2 는 1번 복원 전에 준비됐으므로 '복원 순서 대기' 여야 하고 차례 문구로 뜨면 실패한다.
    const wrongVariant = s.toasts.map(x => (x.msg === TXT.ready(1, false) ? { ...x, msg: TXT.ready(1, true) } : x));
    expect(t(wrongVariant).ready[1].ok).toBe(false);
    expect(t(wrongVariant).ok).toBe(false);
    // 준비 토스트가 복원 토스트보다 늦으면 실패한다.
    const late = [...without(s, TXT.ready(3, true)), { msg: TXT.ready(3, true) }];
    expect(t(late).ready[3].ok).toBe(false);
  });
  test('4/4 뒤 안내 · 고리 열림 · 시작 · 완료 토스트는 한 번씩 순서대로다', () => {
    const s = base();
    for (const msg of [TXT.all, TXT.open, TXT.done]) {
      expect(K.checkToasts(without(s, msg), DEF).ok).toBe(false);
      expect(K.checkToasts([...s.toasts, { msg }], DEF).ok).toBe(false);
    }
    expect(K.checkToasts(without(s, TXT.start(20)), DEF).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: TXT.start(20) }], DEF).ok).toBe(false);
    const reordered = [...without(s, TXT.done)]; reordered.splice(reordered.findIndex(t => t.msg === TXT.open), 0, { msg: TXT.done });
    expect(K.checkToasts(reordered, DEF).sequence).toBe(false);
  });
  test('시작 limit 문구가 시작 스텝의 limit 과 다르거나 피격·붕괴·오답 토스트 수가 결과와 다르면 실패한다', () => {
    const s = base();
    expect(K.checkToasts(s.toasts, DEF, { startLimit: 11 }).startOk).toBe(false);
    expect(K.checkToasts(s.toasts, DEF, { shardHits: 1 }).ok).toBe(false);
    expect(K.checkToasts(s.toasts, DEF, { collapses: 1 }).collapseOk).toBe(false);
    expect(K.checkToasts(s.toasts, DEF, { mistakes: 1 }).mistakesOk).toBe(false);
    const m = ringRun();
    expect(K.checkToasts(m.toasts, DEF, { shardHits: 2, collapses: 1, startLimit: 20, collapseLimits: [20] }).ok).toBe(true);
    expect(K.checkToasts(m.toasts, DEF, { shardHits: 2, collapses: 1, collapseLimits: [19] }).collapseOk).toBe(false);
    expect(K.checkToasts(m.toasts, DEF, { shardHits: 3, collapses: 1 }).ok).toBe(false);
    expect(K.checkToasts(m.toasts, DEF, { shardHits: 2, collapses: 1, purifyCounts: [1, 2, 3, 4] }).markOk).toBe(false);   // 붕괴 뒤 1 → 2 → 3 → 4 가 이어져야 성표 토스트가 맞는다
    expect(K.checkToasts(m.toasts, DEF, { shardHits: 2, collapses: 1, purifyCounts: [1, 1, 2, 3, 4] }).markOk).toBe(true);
    const c = choiceRun();
    expect(K.checkToasts(c.toasts, DEF, { mistakes: 1 }).ok).toBe(true);
    expect(K.checkToasts(c.toasts, DEF, { mistakes: 0 }).ok).toBe(false);
    expect(K.wrongToast(DEF, 0, 'triangle')).toBe('A △ 오답 · 단서는 B ○ · 판 밖으로 나와 다시 읽으세요.');
    expect(c.toasts.some(t => t.msg === K.wrongToast(DEF, 0, 'triangle'))).toBe(true);
  });
  test('이전 보물방 공명 문구와 일반판 조율판 문구는 누출이다', () => {
    const s = base();
    expect(K.checkToasts([...s.toasts, { msg: '보물방 공명 완료' }], DEF).leaked).toEqual(['보물방 공명 완료']);
    expect(K.checkToasts([...s.toasts, { msg: '1번 조율판 · 첫 항로 정화' }], DEF).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: '2번 조율판 복원' }], DEF).leaked.length).toBe(1);
  });
  test('보스 전술 토스트는 그 순간의 전술 문자열과 정확히 같을 때만 금지어를 면제받는다', () => {
    const s = base();
    const withTactic = [...s.toasts, { msg: tactic + ' 공명' }];
    const exact = [...s.toasts, { msg: tactic + ' 공명', tac: tactic + ' 공명' }];
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: null }).ok).toBe(false);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: tactic + ' 공명' }).ok).toBe(true);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: tactic + ' 공명' }).tacticToasts).toBe(1);
    // 한 글자라도 다르면 면제되지 않는다(마침표 하나, 공백 한 칸).
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: tactic + ' 공명.' }).ok).toBe(false);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: (tactic + ' 공명').replace('파편이', '파편이  ') }).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: tactic + ' 공명 ' }], DEF, { encounterTactic: tactic + ' 공명' }).ok).toBe(false);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: '' }).ok).toBe(false);
    // 토스트가 뜬 순간의 tac 이 있으면 그 값과, 없으면 인자와 비교한다.
    expect(K.checkToasts(exact, DEF).ok).toBe(true);
    expect(K.checkToasts([...s.toasts, { msg: tactic + ' 공명', tac: tactic + ' 공명.' }], DEF, { encounterTactic: tactic + ' 공명' }).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: tactic + ' 공명', tac: null }], DEF, { encounterTactic: tactic + ' 공명' }).ok).toBe(true);
    expect(K.checkToasts([...s.toasts, { msg: tactic + ' 공명', tac: null }], DEF).ok).toBe(false);
  });
});

describe('목표창·결과 문구', () => {
  const dom = (rows: any[], kind: string) => rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes(kind));
  test('선택·고리 정화 표본이 단계 문구와 어긋나면 실패한다', () => {
    const s = legitRun();
    expect(K.checkObjectiveSamples(s.rows, DEF).ok).toBe(true);
    const bad = mut(s.rows, rows => { dom(rows, '같은 판').dom = '별자리 복원 3/4 월드 단서와 같은 판에서 1초 유지'; });
    expect(K.checkObjectiveSamples(bad, DEF).ok).toBe(false);
    const action = mut(s.rows, rows => { dom(rows, '같은 판').dom = '별자리 복원 0/4 모래시계 단서 1초 읽기'; });
    expect(K.checkObjectiveSamples(action, DEF).ok).toBe(false);
    const leak = mut(s.rows, rows => { dom(rows, '같은 판').dom += ' 공명'; });
    expect(K.checkObjectiveSamples(leak, DEF).ok).toBe(false);
    const wrongSeconds = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('중심 밖으로')); r.dom = ringDom(r.rg.lf + 5); });
    expect(K.checkObjectiveSamples(wrongSeconds, DEF).ok).toBe(false);
    const title = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('중심 밖으로')); r.dom = r.dom.replace('외곽 고리 정화', '포자 수로 돌파'); });
    expect(K.checkObjectiveSamples(title, DEF).ok).toBe(false);
  });
  test('10Hz 갱신이라 남은 초가 한 칸 위여도 통과하고, 두 칸 위면 실패한다', () => {
    const s = legitRun();
    const one = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('중심 밖으로')); r.dom = ringDom(r.rg.lf + 1); });
    expect(K.checkObjectiveSamples(one, DEF).ok).toBe(true);
    const two = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('중심 밖으로')); r.dom = ringDom(r.rg.lf + 2); });
    expect(K.checkObjectiveSamples(two, DEF).ok).toBe(false);
  });
  test('선택 단계 표본이나 고리 정화 중 표본이 하나도 없으면 실패한다', () => {
    const s = legitRun();
    expect(K.checkObjectiveSamples(mut(s.rows, rows => rows.forEach((r: any) => { if (typeof r.dom === 'string' && r.dom.includes('같은 판')) delete r.dom; })), DEF).ok).toBe(false);
    expect(K.checkObjectiveSamples(mut(s.rows, rows => rows.forEach((r: any) => { if (typeof r.dom === 'string' && r.dom.includes('중심 밖으로')) delete r.dom; })), DEF).ok).toBe(false);
    expect(K.checkObjectiveSamples(mut(s.rows, rows => rows.forEach((r: any) => { delete r.dom; })), DEF).ok).toBe(false);
  });
  test('결과 필드: 순서·개수·횟수·초가 어긋나면 실패한다', () => {
    const s = legitRun();
    const ok = s.result().ro, f = (patch: any, win = true) => K.checkResultFields({ ...ok, ...patch }, DEF, win, { mistakes: 0, collapses: 0, shardHits: 0, seconds: ok.ring.seconds }).ok;
    expect(f({})).toBe(true);
    expect(f({ rooms: [2, 3, 5, 6] })).toBe(false);
    expect(f({ progress: 3 })).toBe(false);
    expect(f({ complete: false })).toBe(false);
    expect(f({ id: 'astral_constellations_standard' })).toBe(false);
    expect(f({ mistakes: 1 })).toBe(false);
    expect(f({ mistakes: undefined })).toBe(false);
    expect(f({ constellations: undefined })).toBe(false);
    expect(f({ constellations: ok.constellations.slice(0, 3) })).toBe(false);
    expect(f({ constellations: ok.constellations.map((c: any, i: number) => (i === 1 ? { ...c, choice: 'circle' } : c)) })).toBe(false);
    expect(f({ constellations: ok.constellations.map((c: any, i: number) => (i === 0 ? { ...c, label: '1번 조율판 · 첫 항로' } : c)) })).toBe(false);
    expect(f({ ring: undefined })).toBe(false);
    expect(f({ ring: { ...ok.ring, purified: false } })).toBe(false);
    expect(f({ ring: { ...ok.ring, purified: 4 } })).toBe(true);
    expect(f({ ring: { ...ok.ring, purified: 3 } })).toBe(false);
    expect(f({ ring: { ...ok.ring, marks: 3 } })).toBe(false);
    expect(f({ ring: { ...ok.ring, collapses: 1 } })).toBe(false);
    expect(f({ ring: { ...ok.ring, shardHits: 2 } })).toBe(false);
    expect(f({ ring: { ...ok.ring, seconds: ok.ring.seconds + 1 } })).toBe(false);
    expect(f({ ring: { ...ok.ring, seconds: NaN } })).toBe(false);
    expect(f({}, false)).toBe(false);
  });
  test('결과 화면 두 줄과 줄 요소(aria-label)가 있어야 하고 별자리 줄은 한 번만 나온다', () => {
    const ro = legitRun().result().ro, lines = linesOf(ro);
    const body = lines.map(l => l.text).join(' ');
    expect(lines[0].text).toBe('별자리 복원 4/4 · ' + LABELS.join(' → ') + ' · 오답 0회');
    expect(lines[1].text).toBe('외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 0회 · 붕괴 0회');
    expect(K.checkResultLines('결과 ' + body, DEF, ro).ok).toBe(true);
    expect(K.checkResultLines(lines[0].text, DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(lines[1].text, DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(body + ' ' + lines[0].text, DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(body.replace('오답 0회', '오답 1회'), DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(body.replace('붕괴 0회', '붕괴 2회'), DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(body.replace('외곽 고리 정화 완료', '외곽 고리 정화 미완료'), DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(undefined as any, DEF, ro).ok).toBe(false);
    expect(K.checkResultElements(lines, DEF, ro).ok).toBe(true);
    expect(K.checkResultElements([lines[0]], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([lines[0], lines[1], lines[1]], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([lines[0], lines[0], lines[1]], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([lines[0], { ...lines[1], text: lines[1].text.replace('완료', '미완료') }], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([{ ...lines[0], aria: '조율판 복원 결과' }, lines[1]], DEF, ro).ok).toBe(false);
  });
});

describe('choice: 성좌 수동(오답 → 재시도 → 정답)', () => {
  const s = choiceRun();
  const ch = K.analyzeChoice(s.rows, DEF, SETUP);
  test('오답 판 1초 + 다음 프레임에 mistakes +1 · retry · 진행 불변 · hurt 호출 0, 다시 읽고 정답 판으로 복원한다', () => {
    expect(ch.ok).toBe(true);
    expect(ch.wrong.mistakes).toBe(1);
    expect(ch.wrong.phase).toBe(3);
    expect(ch.wrong.pad).toBe('triangle');
    expect(ch.hurts.total).toBe(0);
    expect(ch.retry.retryRows).toBeGreaterThan(0);
    expect(ch.retry.readingRows).toBeGreaterThan(30);
    expect(ch.correct.progress).toBe(1);
    expect(ch.correct.cleared).toBe(1);
  });
  test('같은 trace 가 AUTO 판정도 통과한다(오답 1회가 보고와 결과 줄에 그대로 나온다)', () => {
    const a = auto(s);
    expect(failed(a)).toEqual([]);
    expect(a.counts.mistakes).toBe(1);
    expect(a.result.got.mistakes).toBe(1);
  });
  test('그동안 hurt 가 한 번이라도 불리면 실패한다', () => {
    const h = choiceRun({ hurtDuring: true });
    const r = K.analyzeChoice(h.rows, DEF, SETUP);
    expect(r.hurts.total).toBe(1);
    expect(r.hurts.ok).toBe(false);
    expect(r.ok).toBe(false);
  });
  test('오답 수가 둘 늘거나 retry 가 아니거나 진행이 달라지거나 오답 판이 정답 판이면 실패한다', () => {
    const run = (patch: (rows: any[]) => void) => K.analyzeChoice(mut(s.rows, patch), DEF, SETUP);
    const at = (rows: any[], label: string) => rows.find((x: any) => x.mk === label);
    expect(run(rows => { at(rows, 'ch-wrong').mi = 2; }).wrong.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-wrong').ph = 2; }).wrong.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-wrong').pr = 1; }).wrong.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-wrong').hd = .5; }).wrong.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-wrong').se = 'triangle'; }).wrong.ok).toBe(false);
    const pad = (rows: any[]) => { const w = at(rows, 'ch-wrong'); rows.forEach((x: any) => { if (x.n < w.n && x.n >= w.n - 60 && x.hd > 0) x.se = 'circle'; }); };
    expect(run(pad).wrong.wrongPad).toBe(false);
    expect(run(pad).ok).toBe(false);
    const early = (rows: any[]) => { const w = at(rows, 'ch-wrong'); rows.forEach((x: any) => { if (x.n === w.n - 20) x.mi = 1; }); };
    expect(run(early).wrong.ok).toBe(false);
  });
  test('오답 판 유지가 1초에 못 미치거나 끊겼으면 실패한다', () => {
    const r = K.analyzeChoice(mut(s.rows, rows => { const w = rows.find((x: any) => x.mk === 'ch-wrong'); const i = rows.findIndex((x: any) => x.n === w.n - 30 && !x.mk); rows.splice(i, 1); }), DEF, SETUP);
    expect(r.wrong.ok).toBe(false);
    const away = K.analyzeChoice(mut(s.rows, rows => { const w = rows.find((x: any) => x.mk === 'ch-wrong'); rows.find((x: any) => x.n === w.n - 3 && !x.mk).x += 4; }), DEF, SETUP);
    expect(away.wrong.ok).toBe(false);
  });
  test('판 밖에서 다시 읽지 않았거나(retry 그대로) 읽기가 이어붙었으면 재시도 판정이 실패한다', () => {
    const run = (patch: (rows: any[]) => void) => K.analyzeChoice(mut(s.rows, patch), DEF, SETUP);
    const at = (rows: any[], label: string) => rows.find((x: any) => x.mk === label);
    expect(run(rows => { at(rows, 'ch-reread').ph = 3; }).retry.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-reread').rs = .4; }).retry.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-reread').pr = 1; }).retry.ok).toBe(false);
    // 읽기가 오답 확정 이전부터 이어졌다고 읽히면(읽기 구간 시작이 오답 확정 앞) 실패한다.
    expect(run(rows => { const w = at(rows, 'ch-wrong'), r = at(rows, 'ch-reread'); rows.forEach((x: any) => { if (x.n >= w.n && x.n <= r.n) x.rs = Math.max(x.rs, .2); }); }).retry.ok).toBe(false);
  });
  test('정답 판 확정이 아니거나 확정 전에 정화됐거나 오답 수가 달라지면 정답 판정이 실패한다', () => {
    const run = (patch: (rows: any[]) => void) => K.analyzeChoice(mut(s.rows, patch), DEF, SETUP);
    const at = (rows: any[], label: string) => rows.find((x: any) => x.mk === label);
    expect(run(rows => { at(rows, 'ch-correct').pr = 0; }).correct.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-correct').g[0].cl = 0; }).correct.ok).toBe(false);
    expect(run(rows => { at(rows, 'ch-correct').mi = 2; }).correct.ok).toBe(false);
    expect(run(rows => { const r = at(rows, 'ch-reread'); const k = rows.findIndex((x: any) => x === r); rows[k + 3].g[0].cl = 1; }).correct.ok).toBe(false);
  });
  test('수동 구간에 AUTO 가 켜져 있거나 공격 입력이 있거나 표식이 빠지면 실패한다', () => {
    const run = (patch: (rows: any[]) => void) => K.analyzeChoice(mut(s.rows, patch), DEF, SETUP);
    expect(run(rows => { rows.find((x: any) => x.mk === 'ch-read1').au = 1; }).keyboard.ok).toBe(false);
    expect(run(rows => { rows.find((x: any) => x.mk === 'ch-wrong').ah = 1; }).ok).toBe(false);
    expect(run(rows => { const m = rows.find((x: any) => x.mk === 'ch-reread'); const i = rows.indexOf(m) + 20; rows[i].ps = 'attack'; rows[i - 1].ps = 'attack'; }).keyboard.ok).toBe(false);
    expect(K.analyzeChoice(s.rows.filter((x: any) => x.mk !== 'ch-reread'), DEF, SETUP).reason).toBe('missing-marks');
    expect(run(rows => { rows.find((x: any) => x.mk === 'ch-manual').g[0].rdy = 0; }).start.ok).toBe(false);
    expect(run(rows => { rows.find((x: any) => x.mk === 'ch-read1').rs = .5; }).read.ok).toBe(false);
    expect(run(rows => { const r = rows.find((x: any) => x.mk === 'ch-read1'); r.x = SG(0).x + 12; }).read.ok).toBe(false);
  });
});

describe('ring: 고리 수동(대기 → 진입 → 피격 → 정화 → 붕괴 → AUTO)', () => {
  test('방 밖에서 3초 기다리는 동안 running 이 아니고, 진입 첫 스텝에 running · limit 20', () => {
    const s = ringRun();
    const r = K.analyzeRingManual(s.rows, DEF, SETUP);
    expect(r.ok).toBe(true);
    expect(r.start.mode).toBe('waited-outside');
    expect(r.start.seconds).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(r.start.insideRows).toBe(0);
    expect(r.start.limit).toBe(20);
    expect(r.keyboard.ok).toBe(true);
    expect(r.collapse.outside.ok).toBe(true);
  });
  test('열림 순간 이미 방 안이면 mode 가 inside-at-open 이고 열린 다음 스텝에 running 으로 대신한다', () => {
    const s = ringRun({ inside: true });
    const r = K.analyzeRingManual(s.rows, DEF, SETUP);
    expect(r.start.mode).toBe('inside-at-open');
    expect(r.start.startN).toBe(r.start.openN + 1);
    expect(r.ok).toBe(true);
    expect(failed(auto(s, {}, { clean: false }))).toEqual([]);
    // 열린 다음 스텝에 시작하지 않으면(시작이 늦음) 실패한다.
    const late = ringRun({ inside: true, flags: { startDelay: 5 } });
    const lr = K.analyzeRingManual(late.rows, DEF, SETUP);
    expect(lr.start.ok).toBe(false);
    expect(auto(late, {}, { clean: false }).acceptance.ringStart).toBe(false);
  });
  test('대기가 3초에 못 미치거나 대기 중 running 이 되면 실패한다', () => {
    expect(K.analyzeRingManual(ringRun({ waitSteps: 60 }).rows, DEF, SETUP).start.ok).toBe(false);
    const early = K.analyzeRingManual(ringRun({ earlyEnter: 60 }).rows, DEF, SETUP);
    expect(early.start.ok).toBe(false);
    expect(early.start.notOpenRows).toBeGreaterThan(0);
    expect(early.ok).toBe(false);
  });
  test('방 밖이라고 했는데 영웅이 방 안에 있는 행이 대기 구간에 섞이면 실패한다', () => {
    const s = ringRun();
    const r = K.analyzeRingManual(mut(s.rows, rows => { const m = rows.find((x: any) => x.mk === 'rg-manual'); const k = rows.indexOf(m) + 50; rows[k].x = CX - 5; }), DEF, SETUP);
    expect(r.start.insideRows).toBe(1);
    expect(r.start.ok).toBe(false);
  });
  test('첫 피격 · 같은 집결 안 추가 없음 · 다음 cycle 에서 한 번 더: 어긋나면 실패한다', () => {
    const s = ringRun();
    const run = (patch: (rows: any[]) => void) => K.analyzeRingManual(mut(s.rows, patch), DEF, SETUP);
    const at = (rows: any[], label: string) => rows.find((x: any) => x.mk === label);
    expect(run(rows => { at(rows, 'sh1-end').rg.sh = 2; }).hits.marksOk).toBe(false);
    expect(run(rows => { at(rows, 'sh2').rg.sd.c = at(rows, 'sh1').rg.sd.c; }).hits.marksOk).toBe(false);
    expect(run(rows => { at(rows, 'sh2').rg.sh = 3; }).hits.ok).toBe(false);
    expect(run(rows => { at(rows, 'sh1').x = CX + 9; }).hits.ok).toBe(false);
    expect(run(rows => { at(rows, 'rg-started').rg.lim = 15; }).start.ok).toBe(false);
  });
  test('성표 정화 · 붕괴 · 완료의 어긋남은 실패한다', () => {
    const s = ringRun();
    const run = (patch: (rows: any[]) => void) => K.analyzeRingManual(mut(s.rows, patch), DEF, SETUP);
    const at = (rows: any[], label: string) => rows.find((x: any) => x.mk === label);
    expect(run(rows => { at(rows, 'pu1').rg.pu = 2; }).purify.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').rg.co = 2; }).collapse.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').rg.pu = 1; }).collapse.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').rg.m[2].d = 1; }).collapse.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').x = ringMark(1).x; at(rows, 'collapse').z = ringMark(1).z; }).collapse.outside.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').x = CX + 1; at(rows, 'collapse').z = CZ; }).collapse.outside.ok).toBe(false);
    expect(run(rows => { at(rows, 'collapse').rg.lf = 7; }).collapse.ok).toBe(false);
    expect(run(rows => { rows.at(-1).rg.co = 2; }).final.ok).toBe(false);
    expect(run(rows => { rows.at(-1).sl = 1; }).final.ok).toBe(false);
    expect(K.analyzeRingManual(ringRun({ flags: { sealStays: true } }).rows, DEF, SETUP).final.ok).toBe(false);
    expect(K.analyzeRingManual(ringRun({ flags: { keepPurified: true } }).rows, DEF, SETUP).ok).toBe(false);
  });
  test('수동 구간에 AUTO 가 켜져 있거나 표식이 빠지면 실패한다', () => {
    const s = ringRun();
    expect(K.analyzeRingManual(mut(s.rows, rows => { rows.find((x: any) => x.mk === 'sh1').au = 1; }), DEF, SETUP).keyboard.ok).toBe(false);
    expect(K.analyzeRingManual(mut(s.rows, rows => { rows.find((x: any) => x.mk === 'sh2').ah = 1; }), DEF, SETUP).ok).toBe(false);
    const missing = K.analyzeRingManual(s.rows.filter((x: any) => x.mk !== 'collapse'), DEF, SETUP);
    expect(missing.reason).toBe('missing-marks');
    expect(missing.missing).toEqual(['collapse']);
  });
  test('분석 함수는 관측이 깨져도 예외를 던지지 않고 실패로 끝난다', () => {
    const s = ringRun();
    const broken = mut(s.rows, rows => rows.forEach((r: any) => { if (r.rg.ph === 2) r.rg.m = null; }));
    expect(() => K.analyzeRingManual(broken, DEF, SETUP)).not.toThrow();
    expect(K.analyzeRingManual(broken, DEF, SETUP).ok).toBe(false);
    const c = choiceRun();
    const brokenChoice = mut(c.rows, rows => rows.forEach((r: any) => { r.g = null; }));
    expect(() => K.analyzeChoice(brokenChoice, DEF, SETUP)).not.toThrow();
    expect(K.analyzeChoice(brokenChoice, DEF, SETUP).ok).toBe(false);
    expect(() => auto(legitRun(), { rows: brokenChoice })).not.toThrow();
  });
});

describe('screens', () => {
  const files = (label: string, k: number) => Array.from({ length: k }, (_, i) => label + '-' + i + '.png');
  const moments = ['read', 'select', 'ringOpen', 'warning', 'burst'];
  test('순간마다 PNG 3장과 상태 JSON 3장이 있어야 한다', () => {
    expect(K.MOMENTS).toEqual(moments);
    const shots = moments.map(label => ({ label, reached: true, files: files(label, 3), stateFiles: files(label, 3) }));
    expect(K.checkScreens(shots, moments, 3).ok).toBe(true);
    expect(K.checkScreens(shots.slice(0, 4), moments, 3).ok).toBe(false);
    expect(K.checkScreens([{ ...shots[0], files: files('read', 2) }, ...shots.slice(1)], moments, 3).ok).toBe(false);
    expect(K.checkScreens([{ ...shots[0], stateFiles: [] }, ...shots.slice(1)], moments, 3).ok).toBe(false);
    expect(K.checkScreens([{ label: 'read', reached: false }, ...shots.slice(1)], moments, 3).ok).toBe(false);
  });
  test('read · select 는 route.phase 로, 고리 순간은 고리 상태로 맞아야 한다', () => {
    const c = choiceRun();
    const readRow = c.rows.find((r: any) => r.ph === 1 && r.rs > .3), selectRow = c.rows.find((r: any) => r.ph === 2 && r.rv === 1), combatRow = c.rows.find((r: any) => r.ph === 0);
    const look = (row: any, label: string) => K.checkScreenMoment({ capture: row }, DEF, label, SETUP);
    expect(look(readRow, 'read').ok).toBe(true);
    expect(look(readRow, 'read').phase).toBe('read');
    expect(look(readRow, 'select').ok).toBe(false);
    expect(look(selectRow, 'select').ok).toBe(true);
    expect(look(selectRow, 'read').ok).toBe(false);
    expect(look(combatRow, 'read').ok).toBe(false);
    expect(look({ ...readRow, g: readRow.g.map((g: any) => ({ ...g, av: 0 })) }, 'read').ok).toBe(false);
    const g = ringRun();
    const openRow = g.rows.find((r: any) => r.rg.ph === 1), runRow = g.rows.find((r: any) => r.rg.ph === 2);
    expect(look(openRow, 'ringOpen').ok).toBe(true);
    expect(look(runRow, 'ringOpen').ok).toBe(false);
    const warn = g.rows.find((r: any) => r.rg.ph === 2 && r.rg.sd.s === 1 && Math.hypot(r.x - CX, r.z - CZ) < 1), burst = g.rows.find((r: any) => r.rg.ph === 2 && r.rg.sd.s === 2 && Math.hypot(r.x - CX, r.z - CZ) < 1);
    expect(look(warn, 'warning').ok).toBe(true);
    expect(look(warn, 'burst').ok).toBe(false);
    expect(look(burst, 'burst').ok).toBe(true);
    expect(look(burst, 'warning').ok).toBe(false);
    expect(look(burst, 'burst').shard).toBe('burst');
    expect(look({ ...burst, x: CX + 30 }, 'burst').ok).toBe(false);    // 영웅이 고리 방 밖
    expect(K.checkScreenMoment({ capture: burst }, DEF, 'burst').ok).toBe(false);   // setup 이 없으면 방 안을 확인할 수 없다
    expect(look(null, 'burst').ok).toBe(false);
  });
  test('화면 순간도 관측 필드가 하나라도 누락이면 실패한다', () => {
    const c = choiceRun();
    const row = structuredClone(c.rows.find((r: any) => r.ph === 1 && r.rs > .3));
    expect(K.checkScreenMoment({ capture: row }, DEF, 'read', SETUP).ok).toBe(true);
    row.hn = null;
    const r = K.checkScreenMoment({ capture: row }, DEF, 'read', SETUP);
    expect(r.state).toBe(true);
    expect(r.observed).toBe(false);
    expect(r.ok).toBe(false);
    const g = ringRun();
    const burst = structuredClone(g.rows.find((x: any) => x.rg.ph === 2 && x.rg.sd.s === 2));
    burst.rg.sd.c = null;
    expect(K.checkScreenMoment({ capture: burst }, DEF, 'burst', SETUP).observed).toBe(false);
  });
});

describe('기준선 비교', () => {
  const side = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', heroId: 'knight', seed: 20261015, depth: 'deep', reseedOn: true, viewport: { width: 844, height: 390 },
    motion: 'reduce', quality: 'low', routeDefinition: DEF, deepOk: true, ...over });
  const base = (over: any = {}) => side({ head: 'b'.repeat(40), routeDefinition: null, deepOk: null, ...over });
  const run = (time: number, over50: number, extra: any = {}) => ({ time, runOver50: over50, steps: 6000, samples: [], deepRooms: [3, 2, 5, 6, 7], ...extra });
  test('후보는 정의가 있고 기준선은 없어야 하며 HEAD 가 다르고 양쪽이 pass 여야 한다', () => {
    expect(K.compareTargetsOk(side(), base())).toBe(true);
    expect(K.compareTargetsOk(side({ deepOk: false }), base())).toBe(false);
    expect(K.compareTargetsOk(side({ deepOk: null }), base())).toBe(false);
    expect(K.compareTargetsOk(side(), side({ head: 'b'.repeat(40) }))).toBe(false);
    expect(K.compareTargetsOk(side(), base({ head: 'a'.repeat(40) }))).toBe(false);
    expect(K.compareTargetsOk(side({ routeDefinition: { ...DEF, id: 'astral_constellations_standard' } }), base())).toBe(false);
    expect(K.compareTargetsOk(side(), base({ status: 'fail' }))).toBe(false);
    expect(K.compareTargetsOk(side({ runStatus: 'fail' }), base())).toBe(false);
    expect(K.compareTargetsOk(base(), side())).toBe(false);
    expect(K.compareTargetsOk(null, base())).toBe(false);
  });
  test('설정(영웅·시드·depth·재시드·viewport·motion·quality)이 하나라도 다르면 비교가 성립하지 않는다', () => {
    const a = side();
    expect(K.compareSetup(a, { ...a }).ok).toBe(true);
    for (const patch of [{ heroId: 'mage' }, { seed: 1 }, { depth: 'standard' }, { reseedOn: false }, { viewport: { width: 640, height: 360 } }, { motion: 'no-preference' }, { quality: 'default' }]) {
      expect(K.compareSetup(a, { ...a, ...patch }).ok).toBe(false);
    }
    expect(K.compareSetup({ ...a, motion: undefined }, { ...a, motion: undefined }).ok).toBe(false);
  });
  test('시간 비 ≤ 2.0 과 50ms 초과 ≤ 기준선 + 2 를 짝마다 판정한다', () => {
    const r = K.compareRuns(run(150, 3), run(100, 1));
    expect(r.ok).toBe(true);
    expect(r.time.ratio).toBeCloseTo(1.5, 6);
    expect(K.compareRuns(run(200, 3), run(100, 1)).ok).toBe(true);             // 정확히 2.0
    expect(K.compareRuns(run(200.1, 3), run(100, 1)).gates.time).toBe(false);
    expect(K.compareRuns(run(150, 4), run(100, 1)).gates.slow).toBe(false);    // 기준선 + 3
    expect(K.compareRuns(run(150, 3), run(100, 1)).gates.slow).toBe(true);     // 기준선 + 2
    expect(K.compareRuns(run(null as any, 0), run(100, 0)).ok).toBe(false);    // 패배(시간 없음)는 통과하지 않는다
    expect(K.compareRuns(run(100, undefined as any), run(100, 0)).gates.slow).toBe(false);
  });
  test('보고 항목: 성좌·고리 방 첫 진입 draw call 증가와 50ms 초과율, 실행 순서', () => {
    const c = run(100, 1, { samples: [{ label: 'roomEnter', roomId: 3, calls: 130 }, { label: 'roomEnter', roomId: 7, calls: 128 }], started: '2026-10-15T10:00:00Z' });
    const b = run(100, 1, { samples: [{ label: 'roomEnter', roomId: 3, calls: 120 }, { label: 'roomEnter', roomId: 7, calls: 129 }], started: '2026-10-15T10:30:00Z' });
    const r = K.compareRuns(c, b);
    expect(r.report.roomEnterDrawCalls.pairs.find((p: any) => p.room === 3).increase).toBe(10);
    expect(r.report.roomEnterDrawCalls.maxIncrease).toBe(10);
    expect(r.report.roomEnterDrawCalls.matched).toBe(2);
    expect(r.report.over50PerThousandSteps.cand).toBeCloseTo(1 / 6, 6);
    expect(r.report.order).toBe('cand-first');
    expect(K.runOrder('x', 'y')).toBe('unknown');
  });
});

describe('통계 보조', () => {
  test('percentile · stepStats', () => {
    expect(K.percentile([], .5)).toBeNull();
    expect(K.percentile([5, 1, 3, 2, 4], .5)).toBe(3);
    const st = K.stepStats([1, 60, 10, 51, 50]);
    expect(st).toMatchObject({ n: 5, max: 60, over: 2 });
  });
});
