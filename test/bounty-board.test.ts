import { expect, test } from 'bun:test';
import { normalizeBounty, availableBounties, bountyDef, bountyId, parseBountyId, judgeBounty, completeBounty, grantHunterXp, buyBountyItem, boardOpen } from '../src/game/bounty-board.js';
import { HUNTER_RANK, HUNTER_TITLES, BOUNTY_SHOP, rankReward } from '../src/data/bounties.js';

const save = (stars: Record<string, number> = {}, peak: Record<string, number> = {}) => ({ progress: { stars }, endgame: { peak } });
const open = () => { const s: Record<string, number> = {}; for (let i = 1; i <= 10; i++) s[`1-${i}`] = 3; return s; };

test('normalize: garbage input becomes a clean rank-1 state', () => {
  for (const raw of [null, undefined, 5, 'x', [], { done: 'x', rank: -3, xp: 'a', shop: 7 }]) {
    const s = normalizeBounty(raw);
    expect(s.rank).toBe(1); expect(s.xp).toBe(0); expect(s.marks).toBe(0); expect(s.done).toEqual({}); expect(s.shop.week).toBe(-1);
  }
  const s = normalizeBounty({ done: { 'story:1-1': 3, 'story:1-2': 9, 'bad:1-1': 1, 'story:x': 1 }, rank: 999, titles: ['bounty_novice', 'nope'], shop: { bought: { stones_bundle: 2, zzz: 5 } } });
  expect(s.done).toEqual({ 'story:1-1': 3 }); expect(s.rank).toBe(HUNTER_RANK.max); expect(s.titles).toEqual(['bounty_novice']); expect(s.shop.bought).toEqual({ stones_bundle: 2 });
});

test('board unlocks at 1-10 clear', () => {
  const nine = open(); delete nine['1-10'];
  expect(boardOpen(save(nine))).toBe(false); expect(availableBounties(normalizeBounty(null), save(nine))).toEqual([]);
  expect(boardOpen(save(open()))).toBe(true); expect(availableBounties(normalizeBounty(null), save(open())).length).toBeGreaterThan(0);
});

test('ids: build/parse round trip and rejects', () => {
  expect(parseBountyId(bountyId('story', 1, 4, 'trial'))).toMatchObject({ tier: 'story', ch: 1, st: 4, kind: 'trial' });
  for (const bad of ['', 'story:1-4', 'story:1-4:zzz', 'xx:1-4:hunt', 'story:0-4:hunt', 'story:1-99:hunt', 'story:1-4:wanted', 'story:99-1:hunt', 'story:a-b:hunt']) expect(parseBountyId(bad)).toBeNull();
  expect(parseBountyId('story:1-10:wanted')).not.toBeNull(); expect(bountyDef('nope')).toBeNull();
});

test('trial judge: pass, fail, no-fact, lost', () => {
  const def = bountyDef('story:1-1:trial')!; const t = def.trial;
  const good: any = { win: true, timeSec: 0, hitsTaken: 0, maxCombo: 999, potionsUsed: 0 };
  expect(judgeBounty(def, good).ok).toBe(true);
  const bad: any = { win: true, timeSec: 9999, hitsTaken: 999, maxCombo: 0, potionsUsed: 9 };
  expect(judgeBounty(def, bad)).toMatchObject({ ok: false, reason: 'trial' });
  const noFact: any = { win: true }; expect(judgeBounty(def, noFact)).toMatchObject({ ok: false, reason: 'no-fact' });
  expect(judgeBounty(def, { ...good, win: false })).toMatchObject({ ok: false, reason: 'lost' });
  expect(judgeBounty(def, null)).toMatchObject({ ok: false, reason: 'lost' });
  expect(judgeBounty(null, good)).toMatchObject({ ok: false, reason: 'unknown' });
  expect(t!.fact).toBeTruthy();
  const hunt = bountyDef('story:1-1:hunt')!; expect(judgeBounty(hunt, { win: true }).ok).toBe(true);
});

test('completeBounty: rewards once, never twice, locked tiers refuse', () => {
  const st = normalizeBounty(null), sv = save(open()), r: any = { win: true, timeSec: 0, hitsTaken: 0, maxCombo: 999, potionsUsed: 0 };
  const a = completeBounty(st, sv, 'story:1-1:hunt', r);
  expect(a.ok).toBe(true); expect(a.rewards!.gold).toBeGreaterThan(0); expect(st.marks).toBe(1); expect(st.completed).toBe(1);
  expect(completeBounty(st, sv, 'story:1-1:hunt', r)).toMatchObject({ ok: false, reason: 'done' }); expect(st.completed).toBe(1);
  expect(completeBounty(st, sv, 'adept:1-1:hunt', r)).toMatchObject({ ok: false, reason: 'locked' });
  expect(completeBounty(st, save(), 'story:1-1:hunt', r)).toMatchObject({ ok: false, reason: 'locked' });
  expect(completeBounty(st, sv, 'story:1-1:trial', { win: true })).toMatchObject({ ok: false, reason: 'no-fact' });
  expect((st.done as Record<string, number>)['story:1-1']).toBe(1);
  expect(completeBounty(st, save(open(), { '1-1': 1 }), 'adept:1-1:hunt', r).ok).toBe(true);
  expect(completeBounty(st, sv, 'bogus', r)).toMatchObject({ ok: false, reason: 'unknown' });
});

test('available list ordering and wanted only on x-10', () => {
  const list = availableBounties(normalizeBounty(null), save(open()));
  expect(list[0].id).toBe('story:1-1:hunt');
  expect(list.filter((d: any) => d.kind === 'wanted').map((d: any) => d.st)).toEqual([10]);
  expect(availableBounties(normalizeBounty(null), save(open()), { limit: 2 })).toHaveLength(2);
});

test('rank-up grants titles and rank rewards', () => {
  const st = normalizeBounty(null);
  const ups = grantHunterXp(st, 10000);
  expect(ups.length).toBeGreaterThan(5); expect(st.rank).toBe(ups.at(-1)!.rank);
  for (const u of ups) expect(u.reward).toEqual(rankReward(u.rank));
  expect(ups.find((u: any) => u.rank === 5)!.title!.id).toBe('bounty_novice');
  for (const t of HUNTER_TITLES) if (t.rank <= st.rank) expect(st.titles).toContain(t.id);
  const max = normalizeBounty(null); grantHunterXp(max, 1e9); expect(max.rank).toBe(HUNTER_RANK.max); expect(max.xp).toBe(0);
  const s2 = normalizeBounty(null); expect(grantHunterXp(s2, 1)).toEqual([]); expect(s2.rank).toBe(1);
});

test('shop: weekly reset, minRank, once, marks', () => {
  const st = normalizeBounty(null); st.marks = 1000;
  for (let i = 0; i < 3; i++) expect(buyBountyItem(st, 'stones_bundle', 5).ok).toBe(true);
  expect(buyBountyItem(st, 'stones_bundle', 5)).toMatchObject({ ok: false, reason: 'weekly' });
  expect(buyBountyItem(st, 'stones_bundle', 6).ok).toBe(true);
  expect(buyBountyItem(st, 'stones2_bundle', 6)).toMatchObject({ ok: false, reason: 'rank' });
  st.rank = 15; expect(buyBountyItem(st, 'stones2_bundle', 6).ok).toBe(true); expect(buyBountyItem(st, 'stones2_bundle', 6)).toMatchObject({ ok: false, reason: 'weekly' });
  expect(buyBountyItem(st, 'banner_crimson', 6).ok).toBe(true); expect(buyBountyItem(st, 'banner_crimson', 7)).toMatchObject({ ok: false, reason: 'owned' });
  expect(st.owned).toContain('banner_crimson');
  const poor = normalizeBounty(null); poor.marks = BOUNTY_SHOP[0].cost - 1; expect(buyBountyItem(poor, 'stones_bundle', 1)).toMatchObject({ ok: false, reason: 'marks' });
  expect(buyBountyItem(poor, 'nothing', 1)).toMatchObject({ ok: false, reason: 'unknown' });
});
