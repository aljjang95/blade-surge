import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { fieldDropsAllowed } from '../src/game/drops.js';
import { BOUNTY_TRIALS } from '../src/data/bounties.js';

const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => { values = new Map(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => values.delete(k) } }); });
afterEach(() => { if (old) Object.defineProperty(globalThis, 'localStorage', old); else Reflect.deleteProperty(globalThis, 'localStorage'); });

function make(cleared = 10) {
  const eco = new Economy();
  for (let i = 1; i <= cleared; i++) eco.s.progress.stars[`1-${i}`] = 3;
  eco.s.progress.unlocked = Math.max(eco.s.progress.unlocked, cleared + 1);
  return eco;
}
const winResult = (extra = {}) => ({ win: true, fullClear: true, stars: 3, time: 100, maxCombo: 40, revives: 0, kills: 20, ...extra });

test('trial facts are all exposed by the battle result', () => {
  const exposed = new Set(['time', 'revives', 'maxCombo', 'stars']);
  expect(BOUNTY_TRIALS.length).toBe(4);
  for (const t of BOUNTY_TRIALS) expect(exposed.has(t.fact)).toBe(true);
});

test('board stays closed before 1-10 and bounty state survives a save reload', () => {
  const locked = make(9);
  expect(locked.bountySummary().open).toBe(false);
  expect(locked.bounties().length).toBe(0);
  expect(locked.startBounty('story:1-1:hunt').ok).toBe(false);
  const eco = make();
  expect(eco.bountySummary().open).toBe(true);
  const def = eco.bounties(1)[0];
  const start = eco.startBounty(def.id), result = winResult();
  expect(start.ok).toBe(true);
  expect(eco.settleBounty(result, start.stage).ok).toBe(true);
  expect(new Economy().bountySummary().completed).toBe(1);
});

test('start gives an energy-free marked stage and settle pays exactly once', () => {
  const eco = make();
  const def = eco.bounties(8).find((d: any) => d.kind === 'hunt')!;
  const start = eco.startBounty(def.id);
  expect(start.ok).toBe(true);
  expect(start.stage.energy).toBe(0);
  expect(start.stage.bounty.id).toBe(def.id);
  expect(fieldDropsAllowed(start.stage)).toBe(false);
  expect(fieldDropsAllowed({ ch: 1, st: 1 })).toBe(true);

  const energy = eco.s.energy, stars = JSON.stringify(eco.s.progress.stars), unlocked = eco.s.progress.unlocked, peak = JSON.stringify(eco.s.endgame.peak);
  const gold = eco.s.gold, stones = eco.s.stones, exp = eco.hero(eco.s.selected).exp;
  const result = winResult();
  const first = eco.settleBounty(result, start.stage);
  expect(first.ok).toBe(true);
  expect(eco.s.gold).toBe(gold + def.rewards.gold + 0);
  expect(eco.s.stones).toBe(stones + first.rewards!.stones);
  expect(eco.s.bounty.marks).toBe(def.rewards.marks);
  // same result object again, and the same bounty with a fresh result: both rejected, nothing granted.
  const afterGold = eco.s.gold, afterMarks = eco.s.bounty.marks;
  expect(eco.settleBounty(result, start.stage).ok).toBe(false);
  expect(eco.settleBounty(winResult(), start.stage)).toMatchObject({ ok: false, reason: 'done' });
  expect(eco.s.gold).toBe(afterGold);
  expect(eco.s.bounty.marks).toBe(afterMarks);
  expect(eco.startBounty(def.id)).toMatchObject({ ok: false, reason: 'done' });

  expect(eco.s.energy).toBe(energy);
  expect(JSON.stringify(eco.s.progress.stars)).toBe(stars);
  expect(eco.s.progress.unlocked).toBe(unlocked);
  expect(JSON.stringify(eco.s.endgame.peak)).toBe(peak);
  expect(eco.hero(eco.s.selected).exp).toBe(exp);
});

test('a lost run or a missed trial grants nothing and keeps the bounty open', () => {
  const eco = make();
  const trial = eco.bounties(999).find((d: any) => d.kind === 'trial')!;
  const start = eco.startBounty(trial.id), gold = eco.s.gold;
  expect(eco.settleBounty({ win: false }, start.stage)).toMatchObject({ ok: false, reason: 'lost' });
  expect(eco.settleBounty({ win: true, stars: 1, time: 9999, maxCombo: 0, revives: 5, kills: 1 }, start.stage)).toMatchObject({ ok: false, reason: 'trial' });
  expect(eco.settleBounty({ win: true }, start.stage)).toMatchObject({ ok: false });
  expect(eco.s.gold).toBe(gold);
  expect(eco.startBounty(trial.id).ok).toBe(true);
  expect(eco.settleBounty(winResult(), start.stage).ok).toBe(true);
});

test('locked tiers and campaign stages cannot settle as bounties', () => {
  const eco = make();
  expect(eco.startBounty('hell:1-1:hunt')).toMatchObject({ ok: false, reason: 'locked' });
  expect(eco.startBounty('story:2-1:hunt')).toMatchObject({ ok: false, reason: 'locked' });
  expect(eco.startBounty('story:1-1:wanted').ok).toBe(false);
  expect(eco.settleBounty(winResult(), { ch: 1, st: 1 })).toMatchObject({ ok: false, reason: 'not-bounty' });
});

test('bounty shop buys through the economy with marks and weekly limit', () => {
  const eco = make();
  expect(eco.buyBounty('stones_bundle')).toMatchObject({ ok: false, reason: 'marks' });
  eco.bountySummary(); eco.s.bounty.marks = 100;
  const stones = eco.s.stones;
  const a = eco.buyBounty('stones_bundle');
  expect(a.ok).toBe(true);
  expect(eco.s.stones).toBe(stones + 6);
  expect(eco.s.bounty.marks).toBe(88);
  expect(eco.buyBounty('stones_bundle').ok).toBe(true);
  expect(eco.buyBounty('stones_bundle').ok).toBe(true);
  expect(eco.buyBounty('stones_bundle')).toMatchObject({ ok: false, reason: 'weekly' });
  expect(eco.buyBounty('banner_crimson').ok).toBe(true);
  expect(eco.buyBounty('banner_crimson')).toMatchObject({ ok: false, reason: 'owned' });
  expect(eco.buyBounty('stones2_bundle')).toMatchObject({ ok: false, reason: 'rank' });
  expect(eco.bountyShop().find((x: any) => x.id === 'stones_bundle')!.soldOut).toBe(true);
  expect(new Economy().s.bounty.owned).toContain('banner_crimson');
});

test('의뢰 스테이지는 지역 전투 명단(combatRosterFor)을 잃지 않는다', () => {
  const eco: any = make();
  const id = eco.bounties(1)[0].id, out = eco.startBounty(id);
  expect(typeof out.stage.combatRosterFor).toBe('function');
});
