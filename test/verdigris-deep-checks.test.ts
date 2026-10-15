import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import * as checks from '../tools/verdigris-deep-checks.mjs';

// 판정 함수는 JS 모듈이라 매개변수 기본값에서 좁은 타입이 추론된다. 입력 형태는 이 파일이 만든 관측 행이므로 any 로 다룬다.
const K: any = checks;
const FRAME: number = K.FRAME;
const DEF: any = (ROUTE_OBJECTIVES as any).verdigris_deep;
const CH: any = DEF.channel;

// 방 배치: 판정은 방 id·좌표·종류를 인자로 받는다(심층 레이아웃: 2·5 보물, 4·7 정예, 1·3·6 일반).
const ROOMS = Array.from({ length: 9 }, (_, id) => ({ id, x: id * 40, z: 0,
  type: id === 0 ? 'start' : id === 8 ? 'boss' : id === 4 || id === 7 ? 'elite' : id === 2 || id === 5 ? 'treasure' : 'normal' }));
const room = (id: number) => ROOMS[id];
const SETUP: any = { roomId: 7, roomX: room(7).x, roomZ: 0, minX: room(7).x - 12, maxX: room(7).x + 12, minZ: -10, maxZ: 10,
  startX: room(7).x + CH.startLine, finishX: room(7).x + CH.finishLine, entry: { x: room(7).x + CH.entry[0], z: CH.entry[1] }, exit: { x: room(7).x + CH.exit[0], z: CH.exit[1] } };
const BAND_X = (i: number) => SETUP.roomX + CH.bands[i];

// 문구는 PLAN 3.1·3.2 의 계약 문장을 그대로 적는다(판정 함수의 상수를 가져오지 않는다).
const TXT = {
  open: '포자 수로 개방 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로', hit: '포자 물결 피격 · 물결이 지나간 뒤 건너기', done: '포자 수로 돌파 · 녹청 거수의 봉인이 풀립니다',
  start: (limit: number) => '포자 수로 돌파 시작 · ' + limit + '초', flood: (limit: number) => '포자 수로 범람 · 다시 ' + limit + '초',
  tactic: '보스 전술 문구 · 포자 수로를 건넌 거수에게는 공명 파동이 있다',
};
const LABELS = ['뿌리 샘 제단', '이끼 못 제단', '덩굴 회랑 제단', '포자 정원 제단'];
const purifyText = (k: number) => LABELS[k] + ' 정화 · ' + (k + 1) + '/4 · ' + (k < 3 ? '뿌리 빛이 ' + LABELS[k + 1] + '으로 옮겨 갑니다' : '모든 구역을 정화하면 포자 수로가 열립니다');
const holdDom = (pr: number) => '생명 제단 정화 ' + pr + '/4 뿌리 빛 제단 중심에서 2초 유지 0.6/2';
const runDom = (left: number) => '포자 수로 돌파 4/4 포자 물결이 지나간 뒤 동쪽 출구로 · ' + Math.ceil(left) + '초';
const ceilLimit = (dist: number) => Math.ceil(dist / 3 + 6);
/** 띠 사이의 안전한 틈과 도착선 바깥(방 중심 기준 x). */
const gapsX = () => [(CH.bands[0] + CH.bands[1]) / 2, (CH.bands[1] + CH.bands[2]) / 2, (CH.bands[2] + CH.bands[3]) / 2, CH.finishLine + .5];

/** 독립된 띠 위상(PLAN 3.1 식을 반복문 없이 다시 적은 모의). */
function bandOf(i: number, ck: number) {
  const u = ck - CH.first - i * CH.lag;
  if (u < 0) return { s: 0, c: -1, a: 0 };
  const cyc = Math.floor(u / CH.period), m = u - cyc * CH.period;
  if (m < CH.warning) return { s: 1, c: cyc, a: m };
  if (m < CH.warning + CH.burst) return { s: 2, c: cyc, a: m - CH.warning };
  return { s: 0, c: cyc, a: m - CH.warning - CH.burst };
}

/**
 * 페이지 프로브가 남기는 행을 같은 규칙으로 만들어 내는 모의 세션. 한 스텝에 행 하나, 표식은 같은 스텝의 행을 하나 더 넣는다.
 * 규칙(포자 폭발·띠 피해·범람·돌파)은 PLAN 3.1 의 문장대로 모의한다. 판정 함수가 이 모의의 정상 경로를 통과하고 깨뜨린 경로를 잡는지 본다.
 */
/** 영웅 방어로 줄어든 실제 체력 감소 비(smoke-cand-order-1 기사 관측 .038 / .08). 규칙이 넘긴 값(hr)과 실제 감소를 따로 본다. */
const MIT = .476;

class Sim {
  hrNow: number[] = [];
  rows: any[] = []; toasts: any[] = []; n = 0; hero = { x: 0, z: 0 }; hp = 100; pr = 0; lm = 0; moveT = 0; bu = 0; hd = 0; sl = 1; au = 1; ps = 'move'; rm = 0; rem = 7;
  g: any[]; ch: any; wrongT = 0; cooldown = 0; hit = new Set<string>(); fd = 18; pendingOpen = false; pendingMove = false; domNext: string | null = null; autoDom = false;
  constructor(gateRooms: number[] = DEF.gates.map((x: any) => x.roomId)) {
    this.g = gateRooms.map(id => ({ id, rd: 0, at: 0, cl: 0, fw: 0, dc: 0, al: 0, pd: 0 }));
    this.ch = { ph: 0, rid: 7, ck: 0, lf: 0, lim: 0, el: 0, fl: 0, sh: 0 };
    this.snap({ mk: 'start' });
  }
  lit() { return this.pr < 4 ? this.g[this.pr].id : -1; }
  snap(extra: any = {}) {
    const c = this.ch, live = c.ph === 1 || c.ph === 2;
    const row: any = { n: this.n, t: this.n * FRAME, x: this.hero.x, z: this.hero.z, hp: this.hp, mhp: 100, al: 1, rm: this.rm, pr: this.pr, hd: this.hd, sl: this.sl, rem: this.rem,
      au: this.au, ah: 0, ps: this.ps, bu: this.bu, lt: this.lit(), lm: this.lm, lT: this.n * FRAME - this.moveT, g: this.g.map(x => ({ ...x })),
      ch: { ph: c.ph, rid: c.rid, ck: c.ck, lf: c.lf, lim: c.lim, el: c.el, fl: c.fl, sh: c.sh, b: CH.bands.map((_: number, i: number) => {
        const b = bandOf(i, c.ck); return { x: BAND_X(i), h: CH.bandHalf, s: live ? b.s : 0, a: b.a, c: live ? b.c : -1 }; }) }, ...extra };
    if (c.fdNow !== undefined) { row.ch.fd = c.fdNow; c.fdNow = undefined; }
    if (this.domNext) { row.dom = this.domNext; this.domNext = null; }
    if (this.hrNow.length) { row.hr = this.hrNow; this.hrNow = []; }
    this.rows.push(row); return row;
  }
  /** 규칙이 최대 체력 × raw 를 hurt 에 넘기고 방어로 MIT 배만 깎인다. */
  hurt(raw: number) { this.hrNow.push(raw); this.hp -= raw * 100 * MIT; }
  toast(msg: string, kind = 'gold') { this.toasts.push({ n: this.n, t: this.n * FRAME, msg, kind }); }
  inRoom7(x: number, z: number) { return x >= SETUP.minX && x <= SETUP.maxX && z >= SETUP.minZ && z <= SETUP.maxZ; }
  step(extra: any = {}) {
    this.n++;
    if (this.pendingMove) { this.moveT = this.n * FRAME; this.pendingMove = false; }
    // 포자 폭발: 정화 전 준비된 비점등 제단 중심에 wrongStep.seconds 머묾, 쿨다운 동안은 모으지 않음.
    this.cooldown = Math.max(0, this.cooldown - FRAME);
    const j = this.g.findIndex((q, k) => k > this.pr && q.rd && !q.at && Math.hypot(this.hero.x - room(q.id).x, this.hero.z - room(q.id).z) <= DEF.radius);
    this.wrongT = j >= 0 && this.cooldown <= 0 ? this.wrongT + FRAME : 0;
    if (j >= 0 && this.wrongT + 1e-9 >= DEF.wrongStep.seconds) { this.wrongT = 0; this.cooldown = DEF.wrongStep.cooldown; this.bu++; this.hurt(DEF.wrongStep.damage); }
    const c = this.ch;
    if (this.pendingOpen) { c.ph = 1; c.ck = 0; this.pendingOpen = false; this.toast(TXT.open); }
    else if (c.ph === 1 || c.ph === 2) {
      c.ck += FRAME;
      const inStart = this.inRoom7(this.hero.x, this.hero.z) && this.hero.x <= SETUP.startX + .01;
      if (c.ph === 1 && inStart) {
        c.ph = 2; c.el = 0; c.lim = ceilLimit(this.fd); c.lf = c.lim; c.fdNow = this.fd; this.toast(TXT.start(c.lim));
      } else if (c.ph === 2) {
        c.el += FRAME; c.lf -= FRAME;
      }
      if (c.ph === 1 || c.ph === 2) {
        // 분출 중인 띠 안이면 분출(띠, cycle)마다 한 번 피해.
        CH.bands.forEach((_: number, i: number) => {
          const b = bandOf(i, c.ck), key = i + ':' + b.c;
          if (b.s === 2 && this.inRoom7(this.hero.x, this.hero.z) && Math.abs(this.hero.x - BAND_X(i)) <= CH.bandHalf && !this.hit.has(key)) {
            this.hit.add(key); c.sh++; this.hurt(CH.damage); this.toast(TXT.hit, 'red');
          }
        });
      }
      if (c.ph === 2 && this.inRoom7(this.hero.x, this.hero.z) && this.hero.x >= SETUP.finishX && c.el > 0) {
        c.ph = 3; this.sl = 0; this.toast(TXT.done);
      } else if (c.ph === 2 && c.lf <= 1e-9) {
        c.fl++; this.hurt(CH.floodDamage); c.lim = ceilLimit(this.fd); c.lf = c.lim; c.fdNow = this.fd; this.toast(TXT.flood(c.lim), 'red');
      }
    }
    if (this.autoDom && c.ph === 2 && this.n % 40 === 0) this.domNext = runDom(c.lf);
    return this.snap(extra);
  }
  run(k: number) { for (let i = 0; i < k; i++) this.step(); }
  until(cond: () => boolean, max = 6000) { for (let i = 0; i < max; i++) { if (cond()) return; this.step(); } throw new Error('until: 조건에 닿지 못함 (n=' + this.n + ')'); }
  mark(label: string) { return this.snap({ mk: label }); }
  at(x: number, z = 0) { this.hero = { x, z }; }
  band(i: number) { return bandOf(i, this.ch.ck); }
  // ---- 시나리오 조각 ----
  clearRoom(id: number) { this.rem--; this.rm = id; this.at(room(id).x, 0); this.step(); }
  discover(k: number) { this.g[k].dc = 1; this.rm = this.g[k].id; this.step(); }
  fight(k: number) { this.g[k].al = 4; this.run(20); this.g[k].al = 0; this.domNext = '생명 제단 정화 ' + this.pr + '/4 뿌리 빛 제단 · 이 구역의 적 처치'; this.step(); this.g[k].rd = 1; this.step(); }
  purify(k: number, toasts = true) {
    const r = room(this.g[k].id);
    this.at(r.x, 0);
    for (let s = 1; s <= 119; s++) { this.hd = s * FRAME; if (s === 40) this.domNext = holdDom(this.pr); this.step(); }
    this.hd = 0; this.g[k].at = 1; this.g[k].cl = 1; this.pr = k + 1; this.rem--; this.pendingMove = k + 1 < 4;
    if (k + 1 < 4) this.lm = k + 1;
    this.step();
    if (toasts) { this.toast(LABELS[k] + ' 정화 완료 · ' + (k + 1) + '/4'); this.toast(purifyText(k)); }
  }
  /** 정상 진행: 제단 4곳(2 → 5 → 3 → 6), 정예방 4·7 정리, 수로 열림까지. 영웅은 수로 방 동쪽(출발선 밖)에 선다. */
  toOpen() {
    this.clearRoom(1);
    this.discover(0); this.fight(0); this.purify(0);
    this.clearRoom(4);
    this.discover(1); this.fight(1); this.purify(1);
    this.discover(2); this.fight(2); this.purify(2);
    this.discover(3); this.fight(3); this.purify(3);
    this.rm = 7; this.at(SETUP.roomX + 4, 0);
    this.clearRoom7();
    return this;
  }
  clearRoom7() {
    this.rem--; this.at(SETUP.roomX + 4, 0); this.step();     // 조건이 처음 관측되는 스텝
    this.pendingOpen = true; this.step();                      // 다음 update 에 열림
  }
  /** AUTO 처럼 안전한 틈(띠 사이)만 밟으며 출발선 → 도착선. 피격 없음. */
  autoCross() {
    this.run(120);
    this.at(SETUP.startX - 1, 0); this.step();   // 시작
    this.autoDom = true;
    gapsX().forEach((gx: number, i: number, list: number[]) => { this.at(SETUP.roomX + gx, 0); if (i === 0) this.domNext = runDom(this.ch.lf); this.run(i === list.length - 1 ? 1 : 90); });
    this.run(10);
    return this;
  }
  result(over: any = {}) {
    const c = this.ch;
    return { win: true, ro: { id: 'verdigris_root_heart_deep', label: '생명 제단 정화', complete: true, progress: 4, target: 4, rooms: [2, 5, 3, 6], sporeBursts: this.bu,
      channel: { crossed: true, floods: c.fl, sporeHits: c.sh, seconds: this.rows.find(r => r.ch.ph === 3)?.ch.el ?? 0 }, ...over } };
  }
}

const auto = (s: Sim, over: any = {}, opts: any = {}) => {
  const res = s.result(), ro = over.ro ?? res.ro, ch = ro.channel ?? { crossed: true, floods: 0, sporeHits: 0 };
  const lines = [{ aria: '생명 제단 정화 결과', text: '생명 제단 정화 4/4 · 완료' }, { aria: '포자 수로 돌파 결과', text: '포자 수로 돌파 ' + (ch.crossed ? '완료' : '미완료') + ' · 포자 피격 ' + ch.sporeHits + '회 · 범람 ' + ch.floods + '회' }];
  return K.analyzeAuto({ rows: s.rows, setup: SETUP, rooms: ROOMS, result: ro, resultText: '결과 ' + lines.map(l => l.text).join(' / '), resultLines: lines, win: true,
    toasts: s.toasts, encounterTactic: null, ...over }, DEF, opts);
};
const mut = (rows: any[], fn: (rows: any[]) => void) => { const c = structuredClone(rows); fn(c); return c; };
function legitRun() { const s = new Sim().toOpen(); s.autoCross(); return s; }
const failed = (a: any) => Object.entries(a.acceptance).filter(([, v]) => v !== true).map(([k]) => k);
const withRows = (s: Sim, rows: any[]) => ({ ...s, rows, toasts: s.toasts, result: () => s.result() } as any as Sim);

describe('정의·setup', () => {
  test('공유 정의가 계약과 같고, 어긋나면 어긋난 항목을 알린다', () => {
    expect(K.checkDefinition(DEF).ok).toBe(true);
    const swapped = { ...DEF, gates: [DEF.gates[0], DEF.gates[2], DEF.gates[1], DEF.gates[3]] };
    const r = K.checkDefinition(swapped);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i: any) => i.field)).toContain('rooms');
    expect(K.checkDefinition({ ...DEF, channel: { ...CH, period: 5 } }).ok).toBe(false);
    expect(K.checkDefinition({ ...DEF, hiddenOrder: false }).ok).toBe(false);
    expect(K.checkDefinition({ ...DEF, wrongStep: { ...DEF.wrongStep, damage: .1 } }).ok).toBe(false);
    expect(K.checkDefinition(null).ok).toBe(false);
  });
  test('수로 setup 이 정의의 오프셋과 맞는지 본다', () => {
    expect(K.checkChannelSetup(SETUP, DEF).ok).toBe(true);
    expect(K.checkChannelSetup({ ...SETUP, startX: SETUP.startX + .5 }, DEF).ok).toBe(false);
    expect(K.checkChannelSetup({ ...SETUP, roomId: 6 }, DEF).ok).toBe(false);
    expect(K.checkChannelSetup(null, DEF).ok).toBe(false);
  });
});

describe('정상 AUTO 경로', () => {
  const s = legitRun();
  const a = auto(s);
  test('모든 판정이 통과한다', () => { expect(failed(a)).toEqual([]); expect(a.ok).toBe(true); });
  test('정화 순서 [2,5,3,6], 점등 이동 3번, 끝에서 lit null', () => {
    expect(a.altars.observedOrder).toEqual([2, 5, 3, 6]);
    expect(a.lit.finalMoves).toBe(3);
    expect(s.rows.at(-1).lt).toBe(-1);
    expect(s.rows.find((r: any) => r.pr === 1).lt).toBe(5);
    expect(s.rows.find((r: any) => r.pr === 3).lt).toBe(6);
  });
  test('수로는 열림 다음 스텝에 닫혀 있다 열리고, 시작 limit 는 계약 식이며, 봉인은 돌파 스텝에 풀린다', () => {
    expect(a.open.lag).toBe(1);
    expect(a.open.clock).toBe(0);
    expect(a.start.limit).toBe(12);
    expect(a.start.waited).toBeGreaterThanOrEqual(1.9);
    expect(a.limit.rows[0].exact).toBe(12);
    expect(a.seal.firstUnsealed).toBe(a.seal.doneIdx);
    expect(a.counts).toMatchObject({ floods: 0, sporeHits: 0, bursts: 0 });
  });
  test('목표창 표본은 제단 유지와 수로 돌파 중 양쪽을 포함한다', () => {
    expect(a.objective.kinds.hold).toBeGreaterThanOrEqual(4);
    expect(a.objective.kinds.run).toBeGreaterThanOrEqual(1);
  });
  test('채워진 순서·개수가 하나라도 틀어지면 결과 판정이 실패한다', () => {
    expect(K.checkResultFields(s.result().ro, DEF, true, { bursts: 0, floods: 0, sporeHits: 0 }).ok).toBe(true);
    expect(K.checkResultFields(s.result().ro, DEF, false).ok).toBe(false);
  });
});

describe('점등·제단 순서', () => {
  test('길 순서 [2,3,5,6] 로 정화하면 순서와 점등 판정이 모두 실패한다', () => {
    const s = new Sim([2, 3, 5, 6]).toOpen(); s.autoCross();
    const f = failed(auto(s));
    expect(f).toContain('altarOrder');
    expect(f).toContain('litMoves');
  });
  test('점등이 옮겨 가지 않거나 끝난 뒤에도 남으면 litMoves 가 실패한다', () => {
    const s = legitRun();
    const stuck = mut(s.rows, rows => rows.forEach(r => { if (r.pr >= 1 && r.pr < 4) r.lt = 2; }));
    expect(failed(auto(withRows(s, stuck)))).toContain('litMoves');
    const stays = mut(s.rows, rows => rows.forEach(r => { if (r.pr === 4) r.lt = 6; }));
    expect(failed(auto(withRows(s, stays)))).toContain('litMoves');
  });
  test('litMoves 가 4 까지 늘거나 정화 없이 늘면 실패한다', () => {
    const s = legitRun();
    const four = mut(s.rows, rows => rows.forEach(r => { if (r.pr === 4) r.lm = 4; }));
    expect(K.checkLit(four, DEF).ok).toBe(false);
    const early = mut(s.rows, rows => { const i = rows.findIndex(r => r.pr === 0 && r.n > 30); for (let k = i; k < rows.length && rows[k].pr === 0; k++) rows[k].lm = 1; });
    const bad = K.checkLit(early, DEF);
    expect(bad.ok).toBe(false);
    expect(bad.bad.map((b: any) => b.kind)).toContain('moved-without-purify');
  });
  test('litT 가 이동 뒤 게임 시간과 어긋나면 실패한다', () => {
    const s = legitRun();
    const skewed = mut(s.rows, rows => rows.forEach(r => { if (r.pr === 2) r.lT += 1; }));
    expect(K.checkLit(skewed, DEF).bad.map((b: any) => b.kind)).toContain('litT-clock');
    // 1초 뒤에 값이 멈춰도(상한) 통과하지만, 이동과 상관없이 0 으로 되돌아가면 실패한다.
    const capped = mut(s.rows, rows => rows.forEach(r => { r.lT = Math.min(r.lT, 1.2); }));
    expect(K.checkLit(capped, DEF).ok).toBe(true);
    const reset = mut(s.rows, rows => rows.forEach(r => { if (r.pr === 2 && r.lT > 1.5) r.lT = 0; }));
    expect(K.checkLit(reset, DEF).bad.map((b: any) => b.kind)).toContain('litT-clock');
  });
  test('비점등 제단 방은 정화 전에 정리됨으로 보이면 안 된다 (제단 attuned 와 같은 행에서만)', () => {
    const s = legitRun();
    const early = mut(s.rows, rows => rows.forEach(r => { if (r.pr < 2) r.g[2].cl = 1; }));
    expect(K.checkUnlit(early, DEF).bad.map((b: any) => b.kind)).toContain('cleared-before-attune');
    expect(failed(auto(withRows(s, early)))).toContain('unlitRooms');
    // cleared 가 attuned 보다 한 행 늦으면 같은 스텝에 바뀌지 않은 것이다.
    const late = mut(s.rows, rows => { const i = rows.findIndex(r => r.g[0].at === 1); rows[i].g[0].cl = 0; });
    expect(K.checkUnlit(late, DEF).ok).toBe(false);
  });
  test('먼저 정리된 비점등 제단은 정화·정리 없이 준비 상태만 관측된다', () => {
    const s = new Sim();
    s.clearRoom(1); s.discover(0); s.fight(0); s.purify(0);
    s.discover(2); s.fight(2);               // 방 3 이 차례보다 먼저 준비됨
    s.run(10);
    const r = K.checkUnlit(s.rows, DEF, { required: true });
    expect(r.observed).toBe(true);
    expect(r.gates).toEqual([2]);
    expect(r.ok).toBe(true);
    const wrong = mut(s.rows, rows => rows.forEach(x => { if (x.pr === 1) x.g[2].at = 1; }));
    expect(K.checkUnlit(wrong, DEF).bad.map((b: any) => b.kind)).toContain('attuned-out-of-turn');
    expect(K.checkUnlit(legitRun().rows, DEF, { required: true }).ok).toBe(false);   // 관측되지 않았는데 관측을 요구하면 실패
  });
  test('유지가 2초 모자라거나 점등되지 않은 제단에서 정화하면 실패한다', () => {
    const s = legitRun();
    const short = mut(s.rows, rows => { const i = rows.findIndex(r => r.pr === 1); for (let k = i - 40; k < i; k++) rows[k].hd = 0; });
    expect(K.checkAltars(short, DEF, { rooms: ROOMS }).ok.hold).toBe(false);
    const unlit = mut(s.rows, rows => { const i = rows.findIndex(r => r.pr === 1); for (let k = i - 20; k < i; k++) rows[k].lt = 3; });
    expect(K.checkAltars(unlit, DEF, { rooms: ROOMS }).ok.lit).toBe(false);
    const away = mut(s.rows, rows => { const i = rows.findIndex(r => r.pr === 1); rows[i - 5].x += 5; });
    expect(K.checkAltars(away, DEF, { rooms: ROOMS }).ok.inside).toBe(false);
  });
});

describe('포자 수로 열림·시작·시계', () => {
  test('4/4 전에 열리면 실패한다', () => {
    const s = legitRun();
    const rows = mut(s.rows, r => { const i = r.findIndex((x: any) => x.pr === 2); for (let k = i; k < i + 30; k++) { r[k].ch.ph = 1; r[k].ch.ck = (k - i) * FRAME; } });
    expect(K.checkChannelOpen(rows, DEF).ok).toBe(false);
    expect(failed(auto(withRows(s, rows)))).toContain('channelOpen');
  });
  test('정예방이 남은 채(rem 1) 열리면 실패한다', () => {
    const s = new Sim();
    s.clearRoom(1); s.discover(0); s.fight(0); s.purify(0); s.clearRoom(4); s.discover(1); s.fight(1); s.purify(1); s.discover(2); s.fight(2); s.purify(2); s.discover(3); s.fight(3); s.purify(3);
    s.at(SETUP.roomX + 4, 0); s.step(); s.pendingOpen = true; s.step();     // 방 7 을 정리하지 않고 열림
    expect(s.rows.at(-1).rem).toBe(1);
    expect(K.checkChannelOpen(s.rows, DEF).ok).toBe(false);
  });
  test('열리는 스텝에 시간이 흐르거나 조건 관측보다 두 스텝 뒤에 열리면 실패한다', () => {
    const s = legitRun();
    const ticking = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 1); rows[i].ch.ck = FRAME; });
    expect(K.checkChannelOpen(ticking, DEF).ok).toBe(false);
    const lazy = new Sim(); lazy.clearRoom(1); lazy.discover(0); lazy.fight(0); lazy.purify(0); lazy.clearRoom(4); lazy.discover(1); lazy.fight(1); lazy.purify(1);
    lazy.discover(2); lazy.fight(2); lazy.purify(2); lazy.discover(3); lazy.fight(3); lazy.purify(3); lazy.rem--; lazy.at(SETUP.roomX + 4, 0); lazy.run(3); lazy.pendingOpen = true; lazy.step();
    const o = K.checkChannelOpen(lazy.rows, DEF);
    expect(o.lag).toBe(3);
    expect(o.ok).toBe(false);
  });
  test('phase 가 거꾸로 가면 실패한다', () => {
    const s = legitRun();
    const back = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 2); rows[i + 5].ch.ph = 1; });
    expect(K.checkChannelOpen(back, DEF).ok).toBe(false);
  });
  test('출발선 서쪽에 들어선 첫 스텝에 시작하고 제한 시간은 ceil(거리 / 3 + 6) 이다', () => {
    const s = legitRun();
    const start = K.checkChannelStart(s.rows, DEF, SETUP);
    expect(start.ok).toBe(true);
    expect(start.inZone).toBe(true);
    expect(K.checkChannelLimit(s.rows, DEF).ok).toBe(true);
    // 17 칸이면 5.67 + 6 = 11.67 → 12, 18 칸이면 12, 19 칸이면 12.33 → 13
    for (const [dist, limit] of [[17, 12], [18, 12], [19, 13], [3, 7]] as [number, number][]) {
      const t = new Sim(); t.fd = dist; t.toOpen(); t.autoCross();
      expect(t.rows.find((r: any) => r.ch.ph === 2).ch.lim).toBe(limit);
      expect(K.checkChannelLimit(t.rows, DEF).ok).toBe(true);
    }
  });
  test('제한 시간 식이 내림이거나 거리를 못 재면 실패한다', () => {
    const s = legitRun();
    const floor = mut(s.rows, rows => { for (const r of rows) if (r.ch.ph === 2 && r.ch.fd !== undefined) { r.ch.lim = 11; r.ch.lf = 11; } });
    expect(K.checkChannelLimit(floor, DEF).ok).toBe(false);
    const blind = mut(s.rows, rows => { for (const r of rows) delete r.ch.fd; });
    const l = K.checkChannelLimit(blind, DEF);
    expect(l.startMeasured).toBe(false);
    expect(l.ok).toBe(false);
    const wrongLeft = mut(s.rows, rows => { const r = rows.find((x: any) => x.ch.fd !== undefined); r.ch.lf = 5; });
    expect(K.checkChannelLimit(wrongLeft, DEF).ok).toBe(false);
  });
  test('출발선 안에 이미 있었는데 시작하지 않았거나(늦은 시작) 방 밖에서 시작하면 실패한다', () => {
    const s = legitRun();
    const late = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 2); rows[i - 2].x = SETUP.startX - 1; });
    const l = K.checkChannelStart(late, DEF, SETUP);
    expect(l.lateCount).toBeGreaterThan(0);
    expect(l.ok).toBe(false);
    const outside = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 2); rows[i].x = SETUP.minX - 3; });
    expect(K.checkChannelStart(outside, DEF, SETUP).ok).toBe(false);
    const east = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 2); rows[i].x = SETUP.startX + 1; });
    expect(K.checkChannelStart(east, DEF, SETUP).ok).toBe(false);
  });
  test('수로 시계는 게임 시간만큼 흐르고, 일시정지 스텝은 값이 정확히 같을 때만 면제된다', () => {
    const s = legitRun();
    expect(K.checkChannelClock(s.rows).ok).toBe(true);
    const i = s.rows.findIndex((x: any) => x.ch.ph === 2 && x.n > s.rows.find((r: any) => r.ch.ph === 2).n + 5);
    const same = mut(s.rows, rows => { rows[i].pz = 1; rows[i].ch.ck = rows[i - 1].ch.ck; rows[i].ch.lf = rows[i - 1].ch.lf; rows[i].ch.el = rows[i - 1].ch.el; });
    const exempt = K.checkChannelClock(same);
    expect(exempt.pauseEntry.length).toBe(1);
    // 면제된 스텝 바로 다음 쌍은 한 스텝 건너뛴 값 차이가 되므로, 같은 값 행 뒤를 이어 붙여 본다.
    expect(exempt.bad.some((b: any) => b.n === s.rows[i].n)).toBe(false);
    const off = mut(s.rows, rows => { rows[i].pz = 1; rows[i].ch.lf = rows[i - 1].ch.lf - 0.001; });
    expect(K.checkChannelClock(off).bad.some((b: any) => b.n === s.rows[i].n)).toBe(true);
    const noPause = mut(s.rows, rows => { rows[i].ch.lf = rows[i - 1].ch.lf; rows[i].ch.el = rows[i - 1].ch.el; rows[i].ch.ck = rows[i - 1].ch.ck; });
    expect(K.checkChannelClock(noPause).bad.some((b: any) => b.n === s.rows[i].n)).toBe(true);
    const doubled = mut(s.rows, rows => { for (let k = i; k < rows.length; k++) rows[k].ch.lf -= .05; });
    expect(K.checkChannelClock(doubled).ok).toBe(false);
  });
});

describe('띠 위상·피격·범람', () => {
  test('띠 상태·cycle·age 는 clock 에서 계산한 값과 같다', () => {
    const s = legitRun();
    const b = K.checkBands(s.rows, DEF, SETUP);
    expect(b.ok).toBe(true);
    expect(b.seen.burst).toBeGreaterThan(0);
    const flipped = mut(s.rows, rows => { const r = rows.find((x: any) => x.ch.ph >= 1 && x.ch.ck > 2.2 && x.ch.ck < 2.6); r.ch.b[0].s = r.ch.b[0].s === 2 ? 0 : 2; });
    expect(K.checkBands(flipped, DEF, SETUP).bad.map((x: any) => x.kind)).toContain('state');
    const cycle = mut(s.rows, rows => { const r = rows.find((x: any) => x.ch.ck > 6.2); r.ch.b[1].c += 1; });
    expect(K.checkBands(cycle, DEF, SETUP).ok).toBe(false);
    const off = mut(s.rows, rows => { rows.find((x: any) => x.ch.ck > 3).ch.b[2].x += .5; });
    expect(K.checkBands(off, DEF, SETUP).bad.map((x: any) => x.kind)).toContain('geometry');
  });
  test('경고·분출 길이와 서쪽부터의 지연이 계약 값과 같다', () => {
    const expect0 = K.bandExpect(CH, 0, 2.0);       // u = 1.0 → 분출 시작
    expect(expect0.state).toBe(2);
    expect(K.bandExpect(CH, 0, 1.5).state).toBe(1);
    expect(K.bandExpect(CH, 0, .5)).toMatchObject({ state: 0, cycle: -1 });
    expect(K.bandExpect(CH, 1, 2.3).state).toBe(1);       // 둘째 띠는 .8 늦다
    expect(K.bandExpect(CH, 0, 2.9)).toMatchObject({ state: 0, cycle: 0 });
    expect(K.bandExpect(CH, 0, 6.2)).toMatchObject({ state: 2, cycle: 1 });
  });
  test('수동 수로: 분출당 한 번만 피해, 다음 cycle 에 다시 한 번, 범람 1회와 limit 재계산, 도착에 봉인 해제', () => {
    const s = manualChannel();
    const m = K.analyzeChannelManual(s.rows, DEF, SETUP);
    expect(m.ok).toBe(true);
    expect(m.hits.cycle2).toBe(m.hits.cycle1 + 1);
    expect(m.flood.floods.floods[0].limit).toBe(ceilLimit(21));
    expect(m.wait.seconds).toBeGreaterThanOrEqual(2.5);
    expect(m.seal.ok).toBe(true);
    const a = auto(s, {}, { clean: false });
    expect(failed(a)).toEqual([]);
    expect(auto(s).acceptance.autoFloods).toBe(false);     // AUTO 판정은 범람 0 을 요구한다
  });
  test('같은 분출 안에서 피해가 두 번 늘면 실패한다', () => {
    const s = manualChannel();
    const i = s.rows.findIndex((r: any) => r.mk === 'hit1');
    const doubled = mut(s.rows, rows => { for (let k = i + 8; k < rows.length; k++) rows[k].ch.sh += 1; });
    const h = K.checkChannelHits(doubled, DEF, SETUP);
    expect(h.bad.map((b: any) => b.kind)).toContain('double');
    expect(K.analyzeChannelManual(doubled, DEF, SETUP).ok).toBe(false);
  });
  test('분출 중 띠 안에 있었는데 피해가 늘지 않았거나, 띠 밖인데 늘면 실패한다', () => {
    const s = manualChannel();
    const i = s.rows.findIndex((r: any) => r.mk === 'hit1');
    const missed = mut(s.rows, rows => { for (let k = i - 1; k < rows.length; k++) rows[k].ch.sh -= 1; });
    const m = K.checkChannelHits(missed, DEF, SETUP, { strictMissed: true });
    expect(m.missed.length).toBeGreaterThan(0);
    expect(m.ok).toBe(false);
    const outside = mut(s.rows, rows => { for (let k = i - 6; k <= i + 2; k++) rows[k].x = SETUP.startX - 1; });
    expect(K.checkChannelHits(outside, DEF, SETUP).bad.map((b: any) => b.kind)).toContain('unexplained');
  });
  test('피해 비율이 6% 가 아니면 strict 에서 실패한다', () => {
    const s = manualChannel();
    expect(K.checkChannelHits(s.rows, DEF, SETUP, { strict: true }).ok).toBe(true);
    let i = s.rows.findIndex((r: any) => r.mk === 'hit1' );
    const kinds = (rows: any[]) => K.checkChannelHits(rows, DEF, SETUP, { strict: true }).bad.map((b: any) => b.kind);
    // 표식 행은 같은 스텝의 두 번째 행이다. 피해가 기록된 스텝 행(hr 이 있는 마지막 행)을 고친다.
    while (i > 0 && !Array.isArray(s.rows[i].hr)) i--;
    expect(s.rows[i].hr).toEqual([CH.damage]);
    // 규칙이 넘긴 값이 6% 가 아니다.
    expect(kinds(mut(s.rows, rows => { rows[i].hr = [.05]; }))).toContain('damage');
    // hurt 기록이 없다(관측 누락).
    expect(kinds(mut(s.rows, rows => { delete rows[i].hr; }))).toContain('damage');
    // 실제 체력이 줄지 않았다(무적 등).
    expect(kinds(mut(s.rows, rows => { const d = rows[i - 1].hp - rows[i].hp; for (let k = i; k < rows.length; k++) rows[k].hp += d; }))).toContain('damage');
    // 실제 감소가 6% 를 넘는다(같은 스텝의 다른 피해).
    expect(kinds(mut(s.rows, rows => { for (let k = i; k < rows.length; k++) rows[k].hp -= 5; }))).toContain('damage');
  });
  test('범람은 제한 시간이 바닥난 스텝에만, 재계산한 limit 으로 일어난다', () => {
    const s = manualChannel();
    expect(K.checkFloods(s.rows, DEF, { strict: true }).ok).toBe(true);
    const i = s.rows.findIndex((r: any) => r.mk === 'flood');
    const early = mut(s.rows, rows => { for (let k = i - 120; k <= i; k++) rows[k].ch.fl = 1; rows[i - 120].ch.lf = 6; });
    expect(K.checkFloods(early, DEF).bad.map((b: any) => b.kind)).toContain('not-expired');
    const stale = mut(s.rows, rows => { for (const k of [i - 1, i]) { rows[k].ch.lim = 12; rows[k].ch.lf = 12; } });
    expect(K.checkFloods(stale, DEF).bad.map((b: any) => b.kind)).toContain('limit');
    expect(K.checkChannelLimit(stale, DEF).ok).toBe(false);
  });
  test('도착은 앞 행이 running 이고 도착선 위에서만 처음 관측된다', () => {
    const s = legitRun();
    expect(K.checkChannelDone(s.rows, DEF, SETUP).ok).toBe(true);
    const west = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 3); rows[i].x = SETUP.finishX - 2; });
    expect(K.checkChannelDone(west, DEF, SETUP).ok).toBe(false);
    const missed = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 3); rows[i - 3].x = SETUP.finishX + 1; });
    expect(K.checkChannelDone(missed, DEF, SETUP).insideCount).toBeGreaterThan(0);
    const regress = mut(s.rows, rows => { const i = rows.findIndex((x: any) => x.ch.ph === 3); rows[i + 4].ch.ph = 2; });
    expect(K.checkChannelDone(regress, DEF, SETUP).ok).toBe(false);
  });
});

describe('보스 봉인', () => {
  test('돌파 전 내내 잠겨 있다 돌파 스텝에 풀린다', () => {
    const s = legitRun();
    expect(K.checkSeal(s.rows, DEF).ok).toBe(true);
  });
  test('돌파 전에 풀리면 실패한다', () => {
    const s = legitRun();
    const early = mut(s.rows, rows => { const d = rows.findIndex((x: any) => x.ch.ph === 3); for (let k = d - 20; k < rows.length; k++) rows[k].sl = 0; });
    expect(K.checkSeal(early, DEF).ok).toBe(false);
    expect(failed(auto(withRows(s, early)))).toContain('sealed');
    const afterFour = mut(s.rows, rows => { const o = rows.findIndex((x: any) => x.ch.ph === 1); for (let k = o; k < rows.length; k++) rows[k].sl = 0; });
    expect(K.checkSeal(afterFour, DEF).afterDone).toBe(false);
  });
  test('돌파 뒤에도 풀리지 않거나 다시 잠기면 실패한다', () => {
    const s = legitRun();
    const never = mut(s.rows, rows => rows.forEach(r => { r.sl = 1; }));
    expect(K.checkSeal(never, DEF).reason).toBe('never-unsealed');
    const relock = mut(s.rows, rows => { rows.at(-1).sl = 1; });
    expect(K.checkSeal(relock, DEF).ok).toBe(false);
    const late = mut(s.rows, rows => { const d = rows.findIndex((x: any) => x.ch.ph === 3); for (let k = d; k < d + 5; k++) rows[k].sl = 1; });
    expect(K.checkSeal(late, DEF).ok).toBe(false);
  });
});

describe('관측 누락은 실패다', () => {
  test('lit · litMoves · litT · bursts · 제단 칸 · 수로 칸이 -1 · null · undefined 이면 통과하지 않는다', () => {
    const s = legitRun();
    expect(K.checkObservation(s.rows, DEF).ok).toBe(true);
    const cases: [string, (r: any) => void][] = [
      ['lt 속성 없음', r => { r.lt = -2; }], ['lm 읽지 못함', r => { r.lm = -1; }], ['lT null', r => { r.lT = null; }], ['bu undefined', r => { delete r.bu; }],
      ['제단 칸 누락', r => { delete r.g[1].dc; }], ['channel 없음', r => { r.ch = null; }], ['띠 하나 누락', r => { r.ch.b[1] = null; }], ['띠 상태 알 수 없음', r => { r.ch.b[0].s = 9; }],
      ['clock NaN', r => { r.ch.ck = NaN; }],
    ];
    for (const [name, apply] of cases) {
      const rows = mut(s.rows, list => apply(list.find((r: any) => r.ch.ph === 2)));
      const o = K.checkObservation(rows, DEF);
      expect({ name, ok: o.ok }).toEqual({ name, ok: false });
      expect(auto(withRows(s, rows)).acceptance.observation).toBe(false);
    }
  });
  test('수로 숫자는 단계에 맞게만 요구한다(idle 의 초기값은 규칙에 맡기고, 돌파 중 left · limit 을 못 읽으면 실패)', () => {
    const s = legitRun();
    const idleBlank = mut(s.rows, rows => rows.forEach(r => { if (r.ch.ph === 0) { r.ch.ck = null; r.ch.lf = null; r.ch.lim = null; r.ch.el = null; r.ch.b.forEach((b: any) => { b.a = null; b.c = null; }); } }));
    expect(K.checkObservation(idleBlank, DEF).ok).toBe(true);
    const runBlank = mut(s.rows, rows => { rows.find((r: any) => r.ch.ph === 2).ch.lf = null; });
    expect(K.checkObservation(runBlank, DEF).ok).toBe(false);
    const openBlank = mut(s.rows, rows => { rows.find((r: any) => r.ch.ph === 1).ch.ck = null; });
    expect(K.checkObservation(openBlank, DEF).ok).toBe(false);
    const bandBlank = mut(s.rows, rows => { rows.find((r: any) => r.ch.ph === 1).ch.b[2].a = null; });
    expect(K.checkObservation(bandBlank, DEF).ok).toBe(false);
  });
  test('화면 순간도 관측 필드가 하나라도 누락이면 실패한다', () => {
    const s = new Sim(); s.discover(0); s.rm = 2;
    const shot = { capture: structuredClone(s.rows.at(-1)) };
    expect(K.checkScreenMoment(shot, DEF, 'lit').ok).toBe(true);
    shot.capture.lT = -1;
    const r = K.checkScreenMoment(shot, DEF, 'lit');
    expect(r.state).toBe(true);
    expect(r.observed).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('토스트·문구 누출', () => {
  const base = () => legitRun();
  const tactic = TXT.tactic;
  test('정상 토스트는 통과하고 순서·횟수가 맞는다', () => {
    const s = base();
    const t = K.checkToasts(s.toasts, DEF, { sporeHits: 0, floods: 0, startLimit: 12, floodLimits: [] });
    expect(t.ok).toBe(true);
    expect(t.ordered && t.sequence).toBe(true);
    expect(t.startToasts).toEqual(['포자 수로 돌파 시작 · 12초']);
  });
  test('정화 토스트가 빠지거나 두 번 뜨거나 순서가 바뀌면 실패한다', () => {
    const s = base();
    expect(K.checkToasts(s.toasts.filter((t: any) => t.msg !== purifyText(2)), DEF).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, s.toasts.find((t: any) => t.msg === purifyText(1))], DEF).ok).toBe(false);
    const swapped = [...s.toasts]; const a = swapped.findIndex(t => t.msg === purifyText(1)), b = swapped.findIndex(t => t.msg === purifyText(2));
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    expect(K.checkToasts(swapped, DEF).ordered).toBe(false);
  });
  test('이전 보물방 공명 문구와 일반판 번호 문구는 누출이다', () => {
    const s = base();
    expect(K.checkToasts([...s.toasts, { msg: '보물방 제단 공명 2초' }], DEF).leaked).toEqual(['보물방 제단 공명 2초']);
    expect(K.checkToasts([...s.toasts, { msg: '2번 생명 제단 · 중심 2초' }], DEF).ok).toBe(false);
  });
  test('보스 전술 토스트는 그 순간의 전술 문자열과 정확히 같을 때만 금지어를 면제받는다', () => {
    const s = base();
    const withTactic = [...s.toasts, { msg: tactic }];
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: null }).ok).toBe(false);
    const exempt = K.checkToasts(withTactic, DEF, { encounterTactic: tactic });
    expect(exempt.ok).toBe(true);
    expect(exempt.tacticToasts).toBe(1);
    // 한 글자만 달라도 면제되지 않는다(공백 한 칸, 마침표 하나).
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: tactic + '.' }).ok).toBe(false);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: tactic.replace('공명 파동', '공명  파동') }).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: tactic + ' ' }], DEF, { encounterTactic: tactic }).ok).toBe(false);
    expect(K.checkToasts(withTactic, DEF, { encounterTactic: '' }).ok).toBe(false);
  });
  test('토스트가 뜬 순간의 tactic(tac)을 함께 남기면 그 값과 정확히 같을 때만 면제된다', () => {
    const s = base();
    const exact = [...s.toasts, { msg: tactic, tac: tactic }];
    expect(K.checkToasts(exact, DEF).ok).toBe(true);
    expect(K.checkToasts(exact, DEF).tacticToasts).toBe(1);
    expect(K.checkToasts([...s.toasts, { msg: tactic, tac: tactic + '.' }], DEF).ok).toBe(false);
    expect(K.checkToasts([...s.toasts, { msg: tactic, tac: tactic + '.' }], DEF, { encounterTactic: tactic }).ok).toBe(false);   // 그 순간의 tac 이 우선한다
    expect(K.checkToasts([...s.toasts, { msg: tactic, tac: null }], DEF, { encounterTactic: tactic }).ok).toBe(true);           // tac 을 못 읽었으면 인자로 대신한다
    expect(K.checkToasts([...s.toasts, { msg: tactic, tac: null }], DEF).ok).toBe(false);
  });
  test('시작 limit 문구가 시작 스텝의 limit 과 다르거나 피격·범람 토스트 수가 결과와 다르면 실패한다', () => {
    const s = base();
    expect(K.checkToasts(s.toasts, DEF, { startLimit: 11 }).startOk).toBe(false);
    expect(K.checkToasts(s.toasts, DEF, { sporeHits: 1 }).ok).toBe(false);
    expect(K.checkToasts(s.toasts, DEF, { floods: 1 }).floodOk).toBe(false);
    const m = manualChannel();
    const t = K.checkToasts(m.toasts, DEF, { sporeHits: 2, floods: 1, startLimit: 12, floodLimits: [13] });
    expect(t.ok).toBe(true);
    expect(K.checkToasts(m.toasts, DEF, { sporeHits: 2, floods: 1, startLimit: 12, floodLimits: [12] }).floodOk).toBe(false);
  });
});

describe('목표창·결과 문구', () => {
  test('유지 표본이 제단 단계 문구와 어긋나면 실패한다', () => {
    const s = legitRun();
    const bad = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('2초 유지')); r.dom = '생명 제단 정화 1/4 중심에서 2초 유지'; });
    expect(K.checkObjectiveSamples(bad, DEF).ok).toBe(false);
    const leak = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('2초 유지')); r.dom += ' 공명'; });
    expect(K.checkObjectiveSamples(leak, DEF).ok).toBe(false);
    const wrongSeconds = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('동쪽 출구')); r.dom = runDom(r.ch.lf + 5); });
    expect(K.checkObjectiveSamples(wrongSeconds, DEF).ok).toBe(false);
    expect(K.checkObjectiveSamples(s.rows, DEF).ok).toBe(true);
  });
  test('10Hz 갱신이라 남은 초가 한 칸 위여도 통과하고, 두 칸 위면 실패한다', () => {
    const s = legitRun();
    const one = mut(s.rows, rows => { const r = rows.find((x: any) => typeof x.dom === 'string' && x.dom.includes('동쪽 출구')); r.dom = runDom(r.ch.lf + 1); });
    expect(K.checkObjectiveSamples(one, DEF).ok).toBe(true);
  });
  test('결과 필드: 순서·개수·횟수·초가 어긋나면 실패한다', () => {
    const s = legitRun();
    const ok = s.result().ro, f = (patch: any, win = true) => K.checkResultFields({ ...ok, ...patch }, DEF, win, { bursts: 0, floods: 0, sporeHits: 0, seconds: ok.channel.seconds }).ok;
    expect(f({})).toBe(true);
    expect(f({ rooms: [2, 3, 5, 6] })).toBe(false);
    expect(f({ progress: 3 })).toBe(false);
    expect(f({ label: '생명 제단 조율' })).toBe(false);
    expect(f({ sporeBursts: undefined })).toBe(false);
    expect(f({ sporeBursts: 1 })).toBe(false);
    expect(f({ channel: undefined })).toBe(false);
    expect(f({ channel: { ...ok.channel, crossed: false } })).toBe(false);
    expect(f({ channel: { ...ok.channel, floods: 1 } })).toBe(false);
    expect(f({ channel: { ...ok.channel, sporeHits: 2 } })).toBe(false);
    expect(f({ channel: { ...ok.channel, seconds: ok.channel.seconds + 1 } })).toBe(false);
    expect(f({ channel: { ...ok.channel, seconds: NaN } })).toBe(false);
    expect(f({}, false)).toBe(false);
  });
  test('결과 화면 두 줄과 줄 요소(aria-label)가 있어야 한다', () => {
    const ro = legitRun().result().ro;
    const lines = [{ aria: '생명 제단 정화 결과', text: '생명 제단 정화 4/4 · 완료' }, { aria: '포자 수로 돌파 결과', text: '포자 수로 돌파 완료 · 포자 피격 0회 · 범람 0회' }];
    expect(K.checkResultLines('x ' + lines.map(l => l.text).join(' '), DEF, ro).ok).toBe(true);
    expect(K.checkResultLines('생명 제단 정화 4/4 · 완료', DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(lines[1].text, DEF, ro).ok).toBe(false);
    expect(K.checkResultLines(lines.map(l => l.text).join(' ').replace('0회 · 범람', '1회 · 범람'), DEF, ro).ok).toBe(false);
    expect(K.checkResultElements(lines, DEF, ro).ok).toBe(true);
    expect(K.checkResultElements([lines[0]], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([lines[0], lines[1], lines[1]], DEF, ro).ok).toBe(false);
    expect(K.checkResultElements([lines[0], { ...lines[1], text: '포자 수로 돌파 미완료 · 포자 피격 0회 · 범람 0회' }], DEF, ro).ok).toBe(false);
  });
});

/** order 시나리오: 방 2 정화 → 점등이 방 5 로 → AUTO 가 방 3 을 정리해 준비시킴 → 수동으로 방 3 중심 → 폭발 1회 → 2초 넘게 머묾. */
function orderRun(over: { dwell?: number; second?: boolean } = {}) {
  const s = new Sim();
  s.clearRoom(1); s.discover(0); s.fight(0); s.purify(0);
  s.discover(2); s.fight(2); s.run(5);
  s.at(room(3).x + 1.5, 0); s.step();
  s.au = 0; s.ps = 'idle';
  s.mark('manual-start');
  s.until(() => s.bu === 1);
  s.mark('burst1');
  s.run(over.dwell ?? 130);
  s.mark('dwell-end');
  return s;
}
describe('order: 비점등 제단 포자 폭발', () => {
  test('1초 머문 뒤 폭발 한 번(8%), 진행 불변, 2초 넘게 있어도 정화되지 않는다', () => {
    const s = orderRun();
    const o = K.analyzeOrder(s.rows, DEF, { rooms: ROOMS });
    expect(o.ok).toBe(true);
    expect(o.lit.moved).toBe(true);
    expect(o.burst.gate).toBe(2);
    expect(o.burst.raw).toEqual([.08]);
    expect(o.burst.ratio).toBeCloseTo(.08 * MIT, 5);
    expect(o.burst.dwellBefore).toBeGreaterThanOrEqual(1);
    expect(o.dwell.seconds).toBeGreaterThanOrEqual(2);
    expect(s.rows.at(-1).g[2].at).toBe(0);
  });
  test('폭발 피해가 8% 가 아니면 실패한다', () => {
    const s = orderRun();
    const m = s.rows.findIndex((r: any) => r.mk === 'burst1');
    let i = m;
    while (i > 0 && !Array.isArray(s.rows[i].hr)) i--;
    expect(s.rows[i].hr).toEqual([DEF.wrongStep.damage]);
    expect(K.analyzeOrder(mut(s.rows, rows => { rows[i].hr = [.06]; }), DEF, { rooms: ROOMS }).burst.ok).toBe(false);
    expect(K.analyzeOrder(mut(s.rows, rows => { delete rows[i].hr; }), DEF, { rooms: ROOMS }).burst.ok).toBe(false);
    expect(K.analyzeOrder(mut(s.rows, rows => { for (let k = i; k < rows.length; k++) rows[k].hp -= 5; }), DEF, { rooms: ROOMS }).burst.ok).toBe(false);
  });
  test('1초가 되기 전에 폭발했다고 읽히면 실패한다', () => {
    const s = orderRun();
    const early = mut(s.rows, rows => {
      const b = rows.findIndex((r: any) => r.mk === 'burst1');
      for (let k = b - 41; k <= b - 2; k++) { rows[k].x = room(3).x + 9; }
    });
    const o = K.analyzeOrder(early, DEF, { rooms: ROOMS });
    expect(o.burst.ok).toBe(false);
    expect(o.wrong.bad.map((b: any) => b.kind)).toContain('dwell');
  });
  test('폭발 뒤 머문 시간이 2초에 못 미치거나 그 사이 정화되면 실패한다', () => {
    const short = orderRun({ dwell: 80 });
    expect(K.analyzeOrder(short.rows, DEF, { rooms: ROOMS }).dwell.ok).toBe(false);
    const s = orderRun();
    const cleared = mut(s.rows, rows => { const b = rows.findIndex((r: any) => r.mk === 'dwell-end'); rows[b].g[2].at = 1; rows[b].g[2].cl = 1; });
    expect(K.analyzeOrder(cleared, DEF, { rooms: ROOMS }).dwell.ok).toBe(false);
    const held = mut(s.rows, rows => { const b = rows.findIndex((r: any) => r.mk === 'dwell-end'); rows[b - 3].hd = .05; });
    expect(K.analyzeOrder(held, DEF, { rooms: ROOMS }).dwell.ok).toBe(false);
  });
  test('두 번째 폭발이 쿨다운 안에 늘거나 머무는 중 반경을 벗어나면 실패한다', () => {
    const s = orderRun();
    const twice = mut(s.rows, rows => { const d = rows.findIndex((r: any) => r.mk === 'dwell-end'); for (let k = d - 20; k < rows.length; k++) rows[k].bu += 1; });
    const o = K.analyzeOrder(twice, DEF, { rooms: ROOMS });
    expect(o.ok).toBe(false);
    expect(o.wrong.bad.map((b: any) => b.kind)).toContain('cooldown');
    const left = mut(s.rows, rows => { const d = rows.findIndex((r: any) => r.mk === 'dwell-end'); for (let k = d - 70; k <= d; k++) rows[k].x = room(3).x + 6; });
    expect(K.analyzeOrder(left, DEF, { rooms: ROOMS }).dwell.ok).toBe(false);
    // 넉백으로 한두 스텝 반경을 벗어난 것은 통과한다(도구가 키로 되돌린다).
    const bump = mut(s.rows, rows => { const d = rows.findIndex((r: any) => r.mk === 'dwell-end'); rows[d - 40].x = room(3).x + 3.4; });
    expect(K.analyzeOrder(bump, DEF, { rooms: ROOMS }).dwell.ok).toBe(true);
  });
  test('수동 구간에 AUTO 가 켜져 있거나 공격 입력·동작이 있으면 실패한다', () => {
    const s = orderRun();
    const auto1 = mut(s.rows, rows => { const m = rows.findIndex((r: any) => r.mk === 'burst1'); rows[m - 4].au = 1; });
    expect(K.analyzeOrder(auto1, DEF, { rooms: ROOMS }).keyboard.ok).toBe(false);
    const swing = mut(s.rows, rows => { const m = rows.findIndex((r: any) => r.mk === 'burst1'); rows[m - 4].ps = 'attack'; });
    expect(K.analyzeOrder(swing, DEF, { rooms: ROOMS }).keyboard.ok).toBe(false);
    const held = mut(s.rows, rows => { const m = rows.findIndex((r: any) => r.mk === 'burst1'); rows[m - 4].ah = 1; });
    expect(K.analyzeOrder(held, DEF, { rooms: ROOMS }).keyboard.ok).toBe(false);
  });
  test('점등이 옮겨 가기 전에 시작한 수동 구간이나 표식 누락은 실패다', () => {
    const s = orderRun();
    const skip = mut(s.rows, rows => rows.forEach(r => { if (r.pr === 1) { r.lm = 0; r.lt = 2; } }));
    expect(K.analyzeOrder(skip, DEF, { rooms: ROOMS }).lit.ok).toBe(false);
    const nomark = s.rows.filter((r: any) => r.mk !== 'burst1');
    expect(K.analyzeOrder(nomark, DEF, { rooms: ROOMS })).toMatchObject({ ok: false, reason: 'missing-marks' });
  });
});

/** channel 시나리오(수동): 수로 열림 → AUTO 끔 → 출발선 밖 3초 대기 → 진입 → 첫 띠에서 분출 두 번 → 서쪽에서 범람 → 키보드로 도착. */
function manualChannel(over: { wait?: number } = {}) {
  const s = new Sim().toOpen();
  s.au = 0; s.ps = 'idle';
  s.autoDom = true;
  s.mark('ch-manual');
  s.at(SETUP.roomX + 4, 0);
  s.run(over.wait ?? 180);
  s.mark('ch-wait-end');
  s.at(SETUP.startX - 1, 0);
  s.step();
  s.mark('ch-started');
  s.until(() => s.band(0).s === 1);
  s.at(BAND_X(0), 0);
  s.until(() => s.ch.sh >= 1);
  s.mark('hit1');
  s.until(() => s.band(0).s === 0);
  s.mark('hit1-end');
  s.until(() => s.ch.sh >= 2);
  s.mark('hit2');
  s.until(() => s.band(0).s === 0);
  s.mark('hit2-end');
  s.at(SETUP.startX - 1.5, 0);
  s.fd = 21;
  s.until(() => s.ch.fl >= 1);
  s.mark('flood');
  const gaps = gapsX();
  for (const gx of gaps.slice(0, -1)) { s.at(SETUP.roomX + gx, 0); s.run(40); }
  s.at(SETUP.roomX + gaps.at(-1)!, 0); s.step();
  s.mark('ch-done');
  s.run(20);
  s.au = 1;
  return s;
}
describe('channel: 수동 수로 돌파', () => {
  test('출발선 밖에서 기다리는 동안은 시작하지 않고, 진입한 첫 스텝에 시작한다', () => {
    const s = manualChannel();
    const m = K.analyzeChannelManual(s.rows, DEF, SETUP);
    expect(m.wait.ok).toBe(true);
    expect(m.wait.notOpenRows).toBe(0);
    expect(m.start.ok).toBe(true);
    expect(m.start.startN).toBe(m.start.markN);
  });
  test('대기가 짧거나 대기 중 시작해 버리거나 영웅이 이미 출발선 안이면 실패한다', () => {
    const short = manualChannel({ wait: 60 });
    expect(K.analyzeChannelManual(short.rows, DEF, SETUP).wait.ok).toBe(false);
    const s = manualChannel();
    const started = mut(s.rows, rows => { const w = rows.findIndex((r: any) => r.mk === 'ch-manual'); for (let k = w + 20; k < w + 40; k++) rows[k].ch.ph = 2; });
    expect(K.analyzeChannelManual(started, DEF, SETUP).wait.ok).toBe(false);
    const inside = mut(s.rows, rows => { const w = rows.findIndex((r: any) => r.mk === 'ch-manual'); rows[w + 30].x = SETUP.startX - 2; });
    const r = K.analyzeChannelManual(inside, DEF, SETUP);
    expect(r.wait.ok).toBe(false);
    expect(r.ok).toBe(false);
  });
  test('같은 분출 안 두 번째 피격, 다음 cycle 이 아닌 피격, 범람 없음은 모두 실패한다', () => {
    const s = manualChannel();
    const i = s.rows.findIndex((r: any) => r.mk === 'hit1');
    const sameCycleTwice = mut(s.rows, rows => { const e = rows.findIndex((r: any) => r.mk === 'hit1-end'); for (let k = e - 5; k < rows.length; k++) rows[k].ch.sh += 1; });
    expect(K.analyzeChannelManual(sameCycleTwice, DEF, SETUP).hits.ok).toBe(false);
    const noFlood = mut(s.rows, rows => rows.forEach(r => { r.ch.fl = 0; }));
    expect(K.analyzeChannelManual(noFlood, DEF, SETUP).flood.ok).toBe(false);
    const sameCycle = mut(s.rows, rows => { const h2 = rows.findIndex((r: any) => r.mk === 'hit2'); rows[h2].ch.b[0].c = rows[i].ch.b[0].c; });
    expect(K.analyzeChannelManual(sameCycle, DEF, SETUP).hits.marksOk).toBe(false);
  });
  test('도착에서 봉인이 풀리지 않으면 수동 판정이 실패한다', () => {
    const s = manualChannel();
    const stuck = mut(s.rows, rows => rows.forEach(r => { r.sl = 1; }));
    expect(K.analyzeChannelManual(stuck, DEF, SETUP).seal.ok).toBe(false);
    expect(K.analyzeChannelManual(stuck, DEF, SETUP).ok).toBe(false);
  });
  test('수동 구간에 AUTO 가 켜져 있으면 실패한다', () => {
    const s = manualChannel();
    const w = s.rows.findIndex((r: any) => r.mk === 'ch-wait-end');
    const autoOn = mut(s.rows, rows => { rows[w + 3].au = 1; });
    expect(K.analyzeChannelManual(autoOn, DEF, SETUP).keyboard.ok).toBe(false);
  });
});

describe('screens', () => {
  const files = (label: string, k: number) => Array.from({ length: k }, (_, i) => label + '-' + i + '.png');
  test('순간마다 PNG 3장과 상태 JSON 3장이 있어야 한다', () => {
    const shots = ['lit', 'moved'].map(label => ({ label, reached: true, files: files(label, 3), stateFiles: files(label, 3) }));
    expect(K.checkScreens(shots, ['lit', 'moved'], 3).ok).toBe(true);
    expect(K.checkScreens([shots[0]], ['lit', 'moved'], 3).ok).toBe(false);
    expect(K.checkScreens([{ ...shots[0], files: files('lit', 2) }, shots[1]], ['lit', 'moved'], 3).ok).toBe(false);
    expect(K.checkScreens([{ ...shots[0], stateFiles: [] }, shots[1]], ['lit', 'moved'], 3).ok).toBe(false);
    expect(K.checkScreens([{ label: 'lit', reached: false }, shots[1]], ['lit', 'moved'], 3).ok).toBe(false);
  });
  test('순간 이름은 route 상태와 맞아야 한다', () => {
    const s = new Sim();
    s.clearRoom(1); s.discover(0); s.rm = 2;
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'lit').ok).toBe(true);
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'moved').ok).toBe(false);
    s.fight(0); s.purify(0); s.run(10);
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'moved').ok).toBe(true);
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'lit').ok).toBe(false);
    s.discover(2); s.fight(2); s.rm = 3;
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'unlit').ok).toBe(true);
    s.rm = 5; s.step();
    expect(K.checkScreenMoment({ capture: s.rows.at(-1) }, DEF, 'unlit').ok).toBe(false);   // 영웅이 그 방 안이 아니다
  });
  test('수로 순간은 서쪽 첫 띠의 상태와 같아야 하고, 영웅은 수로 방 안이어야 한다', () => {
    const s = manualChannel();
    const pick = (state: number) => s.rows.find((r: any) => r.ch.ph === 2 && r.ch.b[0].s === state);
    expect(K.checkScreenMoment({ capture: { ...pick(1), rm: 3 } }, DEF, 'warning').ok).toBe(false);   // 영웅이 수로 방 안이 아니다
    expect(K.checkScreenMoment({ capture: pick(1) }, DEF, 'warning').ok).toBe(true);
    expect(K.checkScreenMoment({ capture: pick(2) }, DEF, 'burst').ok).toBe(true);
    expect(K.checkScreenMoment({ capture: pick(0) }, DEF, 'calm').ok).toBe(true);
    expect(K.checkScreenMoment({ capture: pick(2) }, DEF, 'calm').ok).toBe(false);
    expect(K.checkScreenMoment({ capture: pick(1) }, DEF, 'burst').bands).toHaveLength(4);
    expect(K.checkScreenMoment({ capture: null }, DEF, 'burst').ok).toBe(false);
  });
});

describe('기준선 비교', () => {
  const side = (over: any = {}) => ({ head: 'a'.repeat(40), status: 'pass', runStatus: 'pass', heroId: 'knight', seed: 20261015, depth: 'deep', reseedOn: true, viewport: { width: 844, height: 390 },
    motion: 'reduce', quality: 'low', routeDefinition: DEF, altarOk: true, ...over });
  const base = (over: any = {}) => side({ head: 'b'.repeat(40), routeDefinition: null, altarOk: null, ...over });
  const run = (time: number, over50: number, extra: any = {}) => ({ time, runOver50: over50, steps: 6000, samples: [], altarRooms: [2, 5, 3, 6, 7], ...extra });
  test('후보는 정의가 있고 기준선은 없어야 하며 HEAD 가 다르고 양쪽이 pass 여야 한다', () => {
    expect(K.compareTargetsOk(side(), base())).toBe(true);
    expect(K.compareTargetsOk(side({ altarOk: false }), base())).toBe(false);
    expect(K.compareTargetsOk(side({ altarOk: null }), base())).toBe(false);
    expect(K.compareTargetsOk(side(), side({ head: 'b'.repeat(40) }))).toBe(false);
    expect(K.compareTargetsOk(side(), base({ head: 'a'.repeat(40) }))).toBe(false);
    expect(K.compareTargetsOk(side({ routeDefinition: { ...DEF, id: 'verdigris_life_altars' } }), base())).toBe(false);
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
  test('보고 항목: 제단·수로 방 첫 진입 draw call 증가와 50ms 초과율, 실행 순서', () => {
    const c = run(100, 1, { samples: [{ label: 'roomEnter', roomId: 2, calls: 130 }, { label: 'roomEnter', roomId: 5, calls: 128 }], started: '2026-10-15T10:00:00Z' });
    const b = run(100, 1, { samples: [{ label: 'roomEnter', roomId: 2, calls: 120 }, { label: 'roomEnter', roomId: 5, calls: 129 }], started: '2026-10-15T10:30:00Z' });
    const r = K.compareRuns(c, b);
    expect(r.report.roomEnterDrawCalls.pairs.find((p: any) => p.room === 2).increase).toBe(10);
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
