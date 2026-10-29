// 신규 7일 여정(docs/RPG_ESSENTIALS.md E3). 첫 접속일부터 하루에 한 칸씩 열리는 21개 미션 + 전부 완료 상자.
// 진척은 새 카운터 없이 저장에 이미 있는 값(관문·레벨·강화·처치·소환·출석·탑·여정)에서 읽으므로 서버도 같은 판정을 한다.
// 하루 경계는 의뢰와 같은 05:00 KST(periodAt). 시작일로부터 14일(7일 + 유예 7일)이 지나면 닫힌다.
import { periodAt } from './journey-core.js';

const r = (o) => Object.freeze(o);
const m = (id, day, stat, target, name, rewards) => r({ id, day, stat, target, name, rewards: r(rewards) });
export const NEWBIE = r({ days: 7, openDays: 14 });
export const NEWBIE_MISSIONS = r([
  m('d1a', 1, 'cleared', 3, '관문 3개 클리어', { gold: 5000, stones: 5 }),
  m('d1b', 1, 'kills', 60, '적 60마리 처치', { gems: 30 }),
  m('d1c', 1, 'attend', 1, '출석 보상 1회 받기', { energy: 30 }),
  m('d2a', 2, 'cleared', 8, '관문 8개 클리어', { gold: 8000, stones: 8 }),
  m('d2b', 2, 'enhance', 3, '장비 강화 3회', { stones: 10 }),
  m('d2c', 2, 'level', 10, '영웅 Lv.10 달성', { gems: 40 }),
  m('d3a', 3, 'cleared', 12, '관문 12개 클리어', { gold: 10000, sweep: 2 }),
  m('d3b', 3, 'pulls', 10, '소환 10회', { tickets: 1 }),
  m('d3c', 3, 'steps', 2, '성장 여정 2단계 보상 받기', { gems: 40 }),
  m('d4a', 4, 'cleared', 16, '관문 16개 클리어', { gold: 12000, stones2: 3 }),
  m('d4b', 4, 'enhance', 10, '장비 강화 10회', { protect: 1 }),
  m('d4c', 4, 'level', 18, '영웅 Lv.18 달성', { gems: 50 }),
  m('d5a', 5, 'cleared', 20, '관문 20개 클리어', { gold: 15000, sweep: 3 }),
  m('d5b', 5, 'kills', 1000, '적 1,000마리 처치', { stones2: 5 }),
  m('d5c', 5, 'attend', 5, '출석 보상 5회 받기', { gems: 50 }),
  m('d6a', 6, 'cleared', 24, '관문 24개 클리어', { gold: 18000, stones2: 5 }),
  m('d6b', 6, 'tower', 3, '무한의 성 3층 돌파', { energy: 60 }),
  m('d6c', 6, 'level', 25, '영웅 Lv.25 달성', { gems: 60 }),
  m('d7a', 7, 'cleared', 30, '관문 30개 클리어', { gold: 25000, stones3: 1 }),
  m('d7b', 7, 'enhance', 25, '장비 강화 25회', { bless: 1 }),
  m('d7c', 7, 'attend', 7, '출석 보상 7회 받기', { gems: 80 }),
]);
export const NEWBIE_FINAL = r({ ssrTicket: 1, gems: 300 });
const BY_ID = Object.fromEntries(NEWBIE_MISSIONS.map((x) => [x.id, x]));

const int = (v, d = 0) => (Number.isSafeInteger(v) && v >= 0 ? v : d);
/** 저장 정규화. 도입 전 저장은 fallback 의 시작일(=오늘)부터 — 기존 이용자도 한 번 참여한다(출시 기념). */
export function normalizeNewbie(raw, fallback) {
  const o = raw && typeof raw === 'object' ? raw : {}, f = fallback && typeof fallback === 'object' ? fallback : { start: 0 };
  const claimed = [...new Set((Array.isArray(o.claimed) ? o.claimed : []).filter((id) => typeof id === 'string' && BY_ID[id]))];
  return { start: int(o.start, int(f.start, 0)), claimed, final: o.final === true };
}

/** 저장에서 진척 값을 읽는다. */
export function newbieStats(save) {
  const s = save || {}, heroes = s.heroes && typeof s.heroes === 'object' ? Object.values(s.heroes) : [];
  return {
    cleared: Math.max(0, int(s.progress?.unlocked, 1) - 1), kills: int(s.quests?.kills), enhance: int(s.quests?.enh), pulls: int(s.totalPulls),
    attend: int(s.daily?.day), level: heroes.reduce((a, h) => Math.max(a, int(h?.level, 1)), 1), tower: int(s.endgame?.tower?.best),
    steps: Array.isArray(s.journey?.claimedSteps) ? s.journey.claimedSteps.length : 0,
  };
}

/** 읽기 전용 화면 모델. */
export function newbieView(state, save, nowMs) {
  const st = normalizeNewbie(state), today = periodAt(nowMs).day, dayNo = today - st.start + 1;
  const open = dayNo >= 1 && dayNo <= NEWBIE.openDays, stats = newbieStats(save);
  const rows = NEWBIE_MISSIONS.map((x) => { const cur = Math.min(stats[x.stat] || 0, x.target), unlocked = open && dayNo >= x.day, claimed = st.claimed.includes(x.id);
    return { ...x, cur, unlocked, complete: cur >= x.target, claimed, ready: unlocked && cur >= x.target && !claimed }; });
  const allClaimed = rows.every((x) => x.claimed);
  return { open, dayNo: Math.max(1, Math.min(NEWBIE.days, dayNo)), daysLeft: Math.max(0, NEWBIE.openDays - dayNo + 1), rows,
    done: rows.filter((x) => x.claimed).length, final: st.final, finalReady: open && allClaimed && !st.final,
    claimable: rows.filter((x) => x.ready).length + (open && allClaimed && !st.final ? 1 : 0) };
}

export function claimNewbie(state, save, nowMs, id) {
  const v = newbieView(state, save, nowMs);
  if (!v.open) return { ok: false, error: 'closed' };
  if (id === 'final') { if (!v.finalReady) return { ok: false, error: v.final ? 'claimed' : 'incomplete' }; state.final = true; return { ok: true, rewards: { ...NEWBIE_FINAL } }; }
  const row = v.rows.find((x) => x.id === id);
  if (!row) return { ok: false, error: 'unknown' };
  if (row.claimed) return { ok: false, error: 'claimed' };
  if (!row.unlocked) return { ok: false, error: 'locked' };
  if (!row.complete) return { ok: false, error: 'incomplete' };
  state.claimed.push(id); return { ok: true, rewards: { ...row.rewards } };
}

