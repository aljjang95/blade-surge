// 업적(docs/RPG_ESSENTIALS.md E4). 평생 누적 목표를 단계별로 받는다. 진척은 저장에 이미 있는 값에서 읽어
// 새 카운터·훅 없이 서버도 같은 판정을 한다. 단계는 차례로만 받을 수 있다(건너뛰기 없음).
import { newbieStats } from './newbie-event.js';

const f = Object.freeze;
const a = (id, name, stat, tiers) => f({ id, name, stat, tiers: f(tiers.map(([target, rewards]) => f({ target, rewards: f(rewards) }))) });
export const ACHIEVEMENTS = f([
  a('slayer', '학살자', 'kills', [[500, { gold: 10000 }], [3000, { gems: 50 }], [15000, { stones2: 10 }], [60000, { gems: 100 }], [200000, { stones3: 3 }], [600000, { gems: 200 }]]),
  a('conqueror', '정복자', 'cleared', [[10, { gold: 20000 }], [20, { gems: 80 }], [30, { stones2: 10 }], [45, { gems: 120 }], [60, { stones3: 3 }], [70, { gems: 200 }]]),
  a('veteran', '숙련 용사', 'level', [[15, { gold: 15000 }], [30, { gems: 60 }], [45, { stones2: 10 }], [60, { gems: 120 }], [70, { stones3: 2 }], [80, { gems: 200 }]]),
  a('smith', '대장장이', 'enhance', [[10, { stones: 20 }], [50, { protect: 1 }], [150, { stones2: 15 }], [400, { bless: 1 }], [1000, { stones3: 4 }], [2500, { bless: 2 }]]),
  a('summoner', '소환술사', 'pulls', [[10, { tickets: 1 }], [50, { gems: 80 }], [150, { tickets: 2 }], [400, { gems: 150 }], [1000, { ssrTicket: 1 }]]),
  a('climber', '탑 등반가', 'tower', [[5, { gold: 30000 }], [20, { gems: 80 }], [50, { stones2: 15 }], [100, { gems: 150 }], [150, { stones3: 4 }], [210, { gems: 250 }]]),
  a('faithful', '개근', 'attend', [[7, { gems: 50 }], [30, { gems: 100 }], [60, { tickets: 2 }], [100, { gems: 200 }], [180, { ssrTicket: 1 }]]),
  a('company', '동료 수집가', 'heroes', [[2, { gems: 50 }], [4, { tickets: 1 }], [6, { gems: 120 }], [9, { tickets: 2 }], [12, { gems: 250 }]]),
  a('wayfarer', '여정의 끝', 'steps', [[3, { gold: 20000 }], [6, { gems: 100 }]]),
]);
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((x) => [x.id, x]));

/** claimed = { [id]: 받은 단계 수 }. */
export function normalizeAchievements(raw) {
  const src = raw && typeof raw === 'object' && raw.claimed && typeof raw.claimed === 'object' ? raw.claimed : {};
  const claimed = {};
  for (const [id, n] of Object.entries(src)) if (BY_ID[id] && Number.isSafeInteger(n) && n > 0) claimed[id] = Math.min(n, BY_ID[id].tiers.length);
  return { claimed };
}

export function achievementStats(save, ownedHeroCount = 0) { return { ...newbieStats(save), heroes: ownedHeroCount }; }

export function achievementRows(state, stats) {
  const st = normalizeAchievements(state);
  return ACHIEVEMENTS.map((x) => {
    const got = st.claimed[x.id] || 0, next = x.tiers[got] || null, cur = stats[x.stat] || 0;
    return { id: x.id, name: x.name, stat: x.stat, tier: got, tiers: x.tiers.length, cur, target: next?.target ?? x.tiers[x.tiers.length - 1].target,
      rewards: next?.rewards ?? null, done: !next, ready: !!next && cur >= next.target };
  });
}
export const achievementClaimable = (state, stats) => achievementRows(state, stats).filter((r) => r.ready).length;

export function claimAchievement(state, stats, id) {
  const row = achievementRows(state, stats).find((r) => r.id === id);
  if (!row) return { ok: false, error: 'unknown' };
  if (row.done) return { ok: false, error: 'claimed' };
  if (!row.ready) return { ok: false, error: 'incomplete' };
  state.claimed[id] = row.tier + 1; return { ok: true, rewards: { ...row.rewards }, tier: row.tier + 1 };
}
