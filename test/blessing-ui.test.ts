import { afterEach, beforeEach, expect, test } from 'bun:test';
import { REEL_TIMINGS, REEL_OVERSHOOT, TICK_MIN_INTERVAL, planReels, cellsForReel, reelAt, timelineAt, eventsBetween, stopOrder, shouldTick, stopVibration, stripOffset } from '../src/ui/blessing-reel-timeline.js';
import { heldPreRunBoons, launchWithBlessing } from '../src/ui/blessing-launch.js';
import { boonEffectText } from '../src/ui/blessing-glyphs.js';
import { blessingOddsHtml } from '../src/ui/blessing-odds.js';
import { EVENT_SOUNDS, EVENT_SOUND_FILES } from '../src/engine/combat-sound-library.js';
import { oddsTable } from '../src/game/blessing-core.js';
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

test('보관 각인 → preRunBoons(등급 n이면 같은 id n번)', () => {
  expect(heldPreRunBoons({ id: 'tide_breath', grade: 3 })).toEqual(['tide_breath', 'tide_breath', 'tide_breath']);
  expect(heldPreRunBoons(null)).toEqual([]);
});

test('출격 시작 성공 뒤에만 소모한다: 시작 직전 넘기고, 성공이면 보관이 비워진다', async () => {
  const { app, eco, battle, calls } = fakeApp(2);
  const seen: { atStart: string[] | null } = { atStart: null };
  const out = await launchWithBlessing(app, async () => { seen.atStart = battle.preRunBoons; expect(eco.blessingState().held).not.toBeNull(); return true; });
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
