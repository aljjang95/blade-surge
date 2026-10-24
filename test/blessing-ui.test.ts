import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { decorFamilies, REEL_TIMINGS, REEL_OVERSHOOT, TICK_MIN_INTERVAL, planReels, cellsForReel, reelAt, timelineAt, eventsBetween, stopOrder, shouldTick, stopVibration, stripOffset } from '../src/ui/blessing-reel-timeline.js';
import { heldPreRunBoons, launchWithBlessing, startPersonalExpedition } from '../src/ui/blessing-launch.js';
import { boonEffectText } from '../src/ui/blessing-glyphs.js';
import { blessingOddsHtml, inertBackground, trapTab } from '../src/ui/blessing-odds.js';
import { EVENT_SOUNDS, EVENT_SOUND_FILES } from '../src/engine/combat-sound-library.js';
import { oddsTable, dayKey } from '../src/game/blessing-core.js';
import { Economy } from '../src/game/economy.js';

// ---------- 릴 타임라인 ----------
test('기본 연출: 릴은 1.20·1.70·2.20s 순서로 멈추고 2.40s에 선택 가능', () => {
  const plan = planReels();
  expect(plan.reels.map(r => r.stop)).toEqual([1.2, 1.7, 2.2]);
  expect(plan.ready).toBe(2.4);
  expect(stopOrder(plan)).toEqual([0, 1, 2]);
  const at = (t: number) => timelineAt(plan, t).reels.map(r => r.stopped);
  expect(at(1.19)).toEqual([false, false, false]);
  expect(at(1.2)).toEqual([true, false, false]);
  expect(at(1.69)).toEqual([true, false, false]);
  expect(at(1.7)).toEqual([true, true, false]);
  expect(at(2.2)).toEqual([true, true, true]);
  expect(timelineAt(plan, 2.39).ready).toBe(false);
  expect(timelineAt(plan, 2.4).ready).toBe(true);
  const ev = eventsBetween(plan, 0, 3);
  expect(ev.map(e => `${e.type}${e.reel ?? ''}@${e.at}`)).toEqual(['stop0@1.2', 'stop1@1.7', 'stop2@2.2', 'ready@2.4']);
});

test('일정 속도 → 멈춤 직전 급감속 → 결과 칸을 6% 지나 튕긴 뒤 정확히 결과 칸에 선다', () => {
  const plan = planReels();
  for (const r of plan.reels) {
    // 일정 구간: 속도가 같다.
    const a = reelAt(r, r.decelStart * 0.3), b = reelAt(r, r.decelStart * 0.9);
    expect(a.phase).toBe('spin'); expect(a.velocity).toBeCloseTo(b.velocity, 9);
    expect(r.speed).toBeGreaterThan(10);
    // 감속 구간: 단조 증가하며 속도가 줄어든다.
    let prev = -Infinity, prevVel = Infinity;
    for (let t = r.decelStart; t < r.stop; t += 0.01) {
      const s = reelAt(r, t);
      expect(s.phase).toBe('decel'); expect(s.pos).toBeGreaterThanOrEqual(prev); expect(s.velocity).toBeLessThanOrEqual(prevVel + 1e-9);
      prev = s.pos; prevVel = s.velocity;
    }
    expect(reelAt(r, r.stop - 1e-6).pos).toBeCloseTo(r.final, 3);
    expect(r.endSpeed / r.speed).toBeLessThan(0.25);
    // 튕김: 최대 6%, 끝나면 결과 칸.
    let peak = 0;
    for (let t = r.stop; t < r.stop + r.settle; t += 0.002) peak = Math.max(peak, reelAt(r, t).pos - r.final);
    expect(peak).toBeCloseTo(REEL_OVERSHOOT, 3);
    expect(reelAt(r, r.stop + r.settle + 0.01).pos).toBe(r.final);
    expect(Number.isInteger(r.final)).toBe(true);
    expect(cellsForReel(plan, r.index)).toBe(r.final + 2);
  }
});

test('건너뛰기: 탭한 순간 남은 릴이 모두 결과 칸에 즉시 멈추고 바로 선택 가능(결과 칸은 그대로)', () => {
  const plan = planReels(), skipAt = 0.5;
  const before = timelineAt(plan, 0.49, skipAt);
  expect(before.reels.every(r => !r.stopped)).toBe(true);
  const after = timelineAt(plan, 0.5, skipAt);
  expect(after.ready).toBe(true);
  after.reels.forEach((r, i) => { expect(r.stopped).toBe(true); expect(r.pos).toBe(plan.reels[i].final); });
  const ev = eventsBetween(plan, 0.49, 0.5, skipAt);
  expect(ev.filter(e => e.type === 'stop').map(e => e.reel)).toEqual([0, 1, 2]);
  expect(ev.every(e => e.at === skipAt)).toBe(true);
  expect(ev.at(-1)?.type).toBe('ready');
  // 이미 멈춘 1번 릴 뒤에 건너뛰면 남은 2·3번만 멈춤 사건이 나온다.
  const late = eventsBetween(plan, 1.29, 1.31, 1.3);
  expect(late.filter(e => e.type === 'stop').map(e => e.reel)).toEqual([1, 2]);
  // 건너뛰기 뒤 다시 계산해도 같은 결과 칸.
  expect(timelineAt(plan, 5, skipAt).reels.map(r => r.pos)).toEqual(plan.reels.map(r => r.final));
});

test('짧게 모드는 0.6초 안에 끝나고 같은 순서로 멈춘다', () => {
  const plan = planReels({ short: true });
  expect(plan.ready).toBe(0.6);
  expect(plan.reels.map(r => r.stop)).toEqual([...REEL_TIMINGS.short.stops]);
  expect(Math.max(...plan.reels.map(r => r.stop))).toBeLessThanOrEqual(0.6);
  expect(stopOrder(plan)).toEqual([0, 1, 2]);
  expect(timelineAt(plan, 0.6).reels.every(r => r.stopped)).toBe(true);
  expect(eventsBetween(plan, 0, 1).map(e => e.type)).toEqual(['stop', 'stop', 'stop', 'ready']);
});

test('째깍은 초당 약 12회 상한, 진동은 멈춤 25ms·III [40,30,80]', () => {
  expect(TICK_MIN_INTERVAL).toBeCloseTo(1 / 12, 9);
  let last = -1, n = 0;
  for (let t = 0; t < 1; t += 1 / 120) if (shouldTick(t, last)) { last = t; n++; }
  expect(n).toBeLessThanOrEqual(13); expect(n).toBeGreaterThanOrEqual(11);
  expect(stopVibration(1)).toBe(25); expect(stopVibration(2)).toBe(25);
  expect(stopVibration(3)).toEqual([40, 30, 80]);
});

test('띠 위치 → Y 이동: 칸 번호가 늘면 띠가 아래로 흐르고 결과 칸이 창 가운데 온다', () => {
  const cells = 20, cell = 100, view = 150;
  expect(stripOffset(1, cells, cell, view)).toBeGreaterThan(stripOffset(0, cells, cell, view));
  // 결과 칸(sequence s)은 DOM 위에서 (cells-1-s)번째 → 가운데가 view/2.
  const s = 18, y = stripOffset(s, cells, cell, view);
  expect(y + (cells - 1 - s + 0.5) * cell).toBe(view / 2);
});

// ---------- 효과음 등록 ----------
test('전운 효과음 5종이 사건 효과음으로 등록돼 미리 불러온다', () => {
  for (const key of ['blessingLever', 'blessingTick', 'blessingStop', 'blessingGold', 'blessingPick'] as const) {
    expect(EVENT_SOUNDS[key]).toMatch(/event\/blessing_/);
    expect(EVENT_SOUND_FILES).toContain(EVENT_SOUNDS[key]);
  }
});

// ---------- 카드 문구·확률 시트 ----------
test('등급 n 효과 문구는 각인 효과 × n, 연쇄는 2명 상한', () => {
  expect(boonEffectText('ember_edge', 2)).toBe('공격력 +10%');
  expect(boonEffectText('tide_breath', 1)).toBe('최대 체력 +6%');
  expect(boonEffectText('storm_eye', 3)).toBe('연쇄 2명');
  expect(boonEffectText('stone_reserve', 3)).toBe('완료 명성 +12%');
});

test('확률 시트 숫자는 oddsTable 에서 오고, 천장 포함 실효는 17.5%(17.9% 아님)', () => {
  const table = oddsTable(), html = blessingOddsHtml(table);
  for (const g of table.grades) expect(html).toContain(g.text);
  for (const b of table.perBoon) { expect(html).toContain(String(b.name)); for (const g of b.grades) expect(html).toContain(g.text); }
  expect(html).toContain(table.baseAtLeastOneIII.text);
  expect(table.baseAtLeastOneIII.text).toBe('14.3%');
  expect(table.effective.atLeastOneIIIPerRoll.text).toBe('17.5%');
  expect(html).toContain('17.5%');
  expect(html).not.toContain('17.9');
  expect(html).toContain(table.pity.text);
  expect(html).toContain(table.prices.text);
  expect(html).toContain('구분 없이 차감');
  for (const f of table.families) for (const g of f.grades) expect(html).toContain(g.text);
});

// ---------- 출격 연결 ----------
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function fakeApp(heldGrade = 2) {
  const eco = new Economy();
  eco.s.blessing = { ...eco.blessingState(), held: { id: 'ember_edge', grade: heldGrade } };
  const calls: string[][] = [];
  const battle = { preRunBoons: null as string[] | null, setPreRunBoons(ids: string[]) { this.preRunBoons = ids.length ? [...ids] : null; calls.push([...ids]); return ids; } };
  return { app: { eco, battle }, eco, battle, calls };
}

const snapshotOf = (eco: any) => { const b = eco.blessingState(); return { held: b.held, offer: b.offer, runGemRolls: b.runGemRolls, runRolls: b.runRolls, rollSeq: b.rollSeq }; };

test('보관 각인 → preRunBoons(등급 n이면 같은 id n번)', () => {
  expect(heldPreRunBoons({ id: 'tide_breath', grade: 3 })).toEqual(['tide_breath', 'tide_breath', 'tide_breath']);
  expect(heldPreRunBoons(null)).toEqual([]);
});

test('소모는 시작 직전에 먼저 저장하고 각인을 넘긴다: 시작 시점엔 이미 비워져 있고 결과는 소모됨', async () => {
  const { app, eco, battle, calls } = fakeApp(2);
  const seen: { atStart: string[] | null } = { atStart: null };
  const out = await launchWithBlessing(app, async () => { seen.atStart = battle.preRunBoons; expect(eco.blessingState().held).toBeNull(); return true; });
  expect(seen.atStart).toEqual(['ember_edge', 'ember_edge']);
  expect(out).toEqual({ started: true, consumed: true, preRunBoons: ['ember_edge', 'ember_edge'] });
  expect(eco.blessingState().held).toBeNull();
  expect(calls).toEqual([['ember_edge', 'ember_edge']]);
});

test('출격 시작 실패(false·로딩 오류)면 소모하지 않고 넘긴 각인을 거둔다', async () => {
  for (const start of [async () => false, async () => { throw new Error('asset load'); }]) {
    const { app, eco, battle } = fakeApp(1);
    let threw = false;
    try { const out = await launchWithBlessing(app, start); expect(out.started).toBe(false); expect(out.consumed).toBe(false); }
    catch { threw = true; }
    expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 1 });
    expect(battle.preRunBoons).toBeNull();
    if (threw) expect(start.toString()).toContain('throw');
  }
});

test('보관 각인이 없으면 아무것도 넘기지 않는다(파티·결투 시작 경로는 이 함수를 거치지 않는다)', async () => {
  const eco = new Economy();
  const battle = { calls: 0, setPreRunBoons() { this.calls++; return []; } };
  const out = await launchWithBlessing({ eco, battle }, async () => true);
  expect(out).toEqual({ started: true, consumed: false, preRunBoons: [] });
  expect(battle.calls).toBe(0);
});

// ---------- 리뷰 반영: 출격 순서·초기화 ----------
test('선택 없이 출격해도 성공하면 후보(offer)·준비 굴림 수가 초기화되어 다음 보석 비용이 30으로 돌아온다', async () => {
  const eco = new Economy();
  eco.s.blessing = { ...eco.blessingState(), held: null, charms: 0, freeDay: dayKey(Date.now()), runGemRolls: 2, runRolls: 3, offer: { candidates: [{ id: 'ember_edge', grade: 1 }, { id: 'tide_breath', grade: 1 }, { id: 'storm_eye', grade: 2 }], guaranteed: false, picked: -1 } };
  const battle = { calls: 0, setPreRunBoons() { this.calls++; return []; } };
  const out = await launchWithBlessing({ eco, battle }, async () => true);
  expect(out.started).toBe(true);
  const b = eco.blessingState();
  expect(b.offer).toBeNull(); expect(b.runGemRolls).toBe(0); expect(b.runRolls).toBe(0);
  expect(battle.calls).toBe(0);
  expect(eco.blessingQuote().cost.gems).toBe(30);
});

test('출격 시작 실패면 굴림 상태도 건드리지 않고 되돌린다(후보·굴림 수 유지는 소모 전 상태가 아니라 보관 각인만 복원)', async () => {
  const { app, eco } = fakeApp(2);
  const out = await launchWithBlessing(app, async () => false);
  expect(out.started).toBe(false); expect(out.consumed).toBe(false);
  expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 2 });
});

test('소모 저장이 실패하면 출격하지 않고 setPreRunBoons 도 부르지 않는다(보관 각인 그대로)', async () => {
  const { app, eco, calls } = fakeApp(2);
  eco.save = () => false;
  let started = 0;
  const out = await launchWithBlessing(app, async () => { started++; return true; });
  expect(out).toEqual({ started: false, consumed: false, preRunBoons: [], saveFailed: true });
  expect(started).toBe(0); expect(calls).toEqual([]);
  expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 2 });
});

test('출격 시작이 예외로 실패해도 보관 각인을 복원하고 넘긴 각인을 거둔다(같은 일회용 각인은 한 번만 쓰인다)', async () => {
  const { app, eco, battle } = fakeApp(3);
  let threw = false;
  try { await launchWithBlessing(app, async () => { expect(eco.blessingState().held).toBeNull(); throw new Error('asset load'); }); } catch { threw = true; }
  expect(threw).toBe(true);
  expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 3 });
  expect(battle.preRunBoons).toBeNull();
  // 성공 쪽은 소모 후 다시 복원할 수 없다.
  const ok = await launchWithBlessing(app, async () => true);
  expect(ok.consumed).toBe(true);
  expect(eco.blessingState().held).toBeNull();
  expect(eco.blessingRestore(null).ok).toBe(false);
  expect(eco.blessingRestore(snapshotOf(eco)).ok).toBe(false);
});

test('blessingRestore 는 다른 각인을 이미 보관 중이면 덮어쓰지 않는다', () => {
  const { eco } = fakeApp(1);
  expect(eco.blessingRestore({ ...snapshotOf(eco), held: { id: 'tide_breath', grade: 2 } }).ok).toBe(false);
  expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 1 });
});

// ---------- 리뷰 반영: 확률 시트 접근성 ----------
function fakeEl(name: string, attrs: Record<string, string> = {}) {
  const a = new Map(Object.entries(attrs));
  return { name, hasAttribute: (k: string) => a.has(k), setAttribute: (k: string, v: string) => { a.set(k, v); }, removeAttribute: (k: string) => { a.delete(k); } };
}
test('시트가 열리면 뒤 준비 영역은 inert, 닫으면 해제(원래 inert 였던 것은 그대로)', () => {
  const sheet = fakeEl('sheet'), shade = fakeEl('shade'), a = fakeEl('a'), b = fakeEl('b', { inert: '' });
  const host = { children: [a, b, shade, sheet] } as any;
  const restore = inertBackground(host, [shade, sheet] as any);
  expect(a.hasAttribute('inert')).toBe(true); expect(b.hasAttribute('inert')).toBe(true);
  expect(sheet.hasAttribute('inert')).toBe(false); expect(shade.hasAttribute('inert')).toBe(false);
  restore();
  expect(a.hasAttribute('inert')).toBe(false); expect(b.hasAttribute('inert')).toBe(true);
});

test('시트 안 Tab 순환: 마지막에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 마지막으로, 시트 밖 초점은 안으로', () => {
  const mk = (name: string) => ({ name, hidden: false, closest: () => null, focus() { focused = this; } });
  let focused: any = null;
  const items = [mk('close'), mk('toggle1'), mk('toggle2')];
  const sheet = { querySelectorAll: () => items, contains: (el: any) => items.includes(el) } as any;
  const ev = (shiftKey: boolean) => { const e = { key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } }; return e; };
  let e = ev(false); expect(trapTab(e, sheet, items[2] as any)).toBe(true); expect(e.prevented).toBe(true); expect(focused).toBe(items[0]);
  e = ev(true); expect(trapTab(e, sheet, items[0] as any)).toBe(true); expect(focused).toBe(items[2]);
  e = ev(false); expect(trapTab(e, sheet, items[0] as any)).toBe(false); expect(e.prevented).toBe(false);
  e = ev(true); expect(trapTab(e, sheet, {} as any)).toBe(true); expect(focused).toBe(items[2]);
  expect(trapTab({ key: 'Enter', preventDefault() {} }, sheet, items[0] as any)).toBe(false);
});

// ---------- 리뷰 반영: 장식 난수는 전투 난수를 쓰지 않는다 ----------
test('릴 장식 문양: 연출 3종(기본·짧게·움직임 줄이기 이전 계획)에서 Math.random 호출 0회, 같은 시드면 같은 배치', () => {
  const spy = spyOn(Math, 'random');
  try {
    const fams = ['ember', 'tide', 'storm', 'stone'];
    for (const opts of [{}, { short: true }, { short: true, reduced: true }]) {
      const plan = planReels(opts);
      plan.reels.forEach((r, i) => {
        const cells = cellsForReel(plan, i), fin = r.final;
        const make = () => decorFamilies({ seed: `ember_edge:2:${i}:${plan.short ? 's' : 'f'}`, cells, fin, resultFam: 'tide', families: fams });
        const a = make();
        expect(a).toEqual(make());
        expect(a[fin]).toBeNull();
        for (const n of [fin - 1, fin + 1]) if (a[n]) expect(a[n]).not.toBe('tide');
      });
    }
    expect(spy).toHaveBeenCalledTimes(0);
  } finally { spy.mockRestore(); }
});

// ---------- 2차 리뷰: 공통 진입점·전운 상태 통째 복원 ----------
test('준비 창이 아닌 진입점(훅 없음)으로 출발해도 각인이 setPreRunBoons 로 넘어가고 소모된다', async () => {
  const { app, eco, battle, calls } = fakeApp(2);
  let started = 0;
  const ok = await startPersonalExpedition(app, async () => { started++; expect(eco.blessingState().held).toBeNull(); return true; });
  expect(ok).toBe(true); expect(started).toBe(1);
  expect(calls).toEqual([['ember_edge', 'ember_edge']]);
  expect(battle.preRunBoons).toEqual(['ember_edge', 'ember_edge']);
  expect(eco.blessingState().held).toBeNull();
});

test('공통 진입점: 준비 창 훅은 소모 저장 뒤에 불리고, 저장 실패면 훅·출격 없이 준비 창 안내만, 훅이 없으면 앱 토스트', async () => {
  const { app, eco } = fakeApp(1);
  const order: string[] = [];
  await startPersonalExpedition(app, async () => { order.push('start'); return true; }, { beforeStart: () => order.push(`close:${eco.blessingState().held === null}`) });
  expect(order).toEqual(['close:true', 'start']);
  const f = fakeApp(1); f.eco.save = () => false;
  const notes: string[] = [], toasts: string[] = [];
  let ran = 0;
  expect(await startPersonalExpedition(f.app, async () => { ran++; return true; }, { beforeStart: () => notes.push('close'), onBlessingSaveFailed: () => notes.push('strip') }, (m) => toasts.push(m))).toBe(false);
  expect(notes).toEqual(['strip']); expect(toasts).toEqual([]); expect(ran).toBe(0);
  expect(await startPersonalExpedition(f.app, async () => true, {}, (m) => toasts.push(m))).toBe(false);
  expect(toasts.length).toBe(1);
  expect(f.eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 1 });
});

test('파티·결투 시작 경로는 startExpedition/startPersonalExpedition 을 거치지 않으므로 각인을 넘기지 않는다', async () => {
  const { app, eco, calls } = fakeApp(2);
  // 파티·결투는 launchWithBlessing 을 호출하지 않는다 → setPreRunBoons 호출 0, 보관 각인 그대로.
  expect(calls).toEqual([]);
  expect(eco.blessingState().held).toEqual({ id: 'ember_edge', grade: 2 });
  const fs = await import('node:fs');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e: any) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const partyFiles = walk('src/party').filter((f) => f.endsWith('.js') || f.endsWith('.jsx'));
  for (const f of partyFiles) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/startExpedition|setPreRunBoons/);
  expect(app).toBeTruthy();
});

function rolled() {
  const { app, eco, battle } = fakeApp(2);
  eco.s.gems = 1000;
  eco.s.blessing = { ...eco.blessingState(), runGemRolls: 2, runRolls: 3, rollSeq: 7, offer: { candidates: [{ id: 'ember_edge', grade: 1 }, { id: 'tide_breath', grade: 1 }, { id: 'storm_eye', grade: 2 }], guaranteed: false, picked: -1 } };
  return { app, eco, battle };
}

test('보관 각인 + 보석 재굴림 뒤 출격 실패 → held·offer·runGemRolls·runRolls 모두 원래대로(다음 보석 비용 유지)', async () => {
  const { app, eco } = rolled();
  const before = JSON.stringify(snapshotOf(eco)), cost = eco.blessingQuote().cost;
  for (const start of [async () => false, async () => { throw new Error('asset load'); }]) {
    try { await launchWithBlessing(app, start); } catch { /* 예외 경로 */ }
    expect(JSON.stringify(snapshotOf(eco))).toBe(before);
    expect(eco.blessingQuote().cost).toEqual(cost);
  }
});

test('소모 뒤 새 굴림이 끼어들면 복원이 덮어쓰지 않는다', async () => {
  const { app, eco } = rolled();
  await launchWithBlessing(app, async () => {
    eco.s.blessing = { ...eco.blessingState(), rollSeq: 8, runRolls: 1 };
    return false;
  });
  const b = eco.blessingState();
  expect(b.held).toBeNull(); expect(b.offer).toBeNull(); expect(b.rollSeq).toBe(8); expect(b.runRolls).toBe(1);
});
