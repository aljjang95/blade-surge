// 방치(오프라인) 보급 + 복귀 보상(docs/RPG_ESSENTIALS.md E2). 순수 규칙: 시계는 호출자가 넘긴다(endgameNow = 서버 시각 우선).
// 마지막 수령(since) 뒤 흐른 시간만큼 최고 클리어 관문 골드·강화석이 쌓인다(상한 12시간).
// 복귀 보상은 마지막 접속(seen) 기준이다: 로비에 30분마다 접속 표시(markSeen)를 남기므로, 보급 팝업을 닫기만 해도
// 매일 오는 이용자는 복귀로 잡히지 않는다. 7일 이상 비웠다 오면 30일에 한 번.
import { stageDef, CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';

const H = 3600000, DAY = 86400000;
export const IDLE = Object.freeze({
  capHours: 12,
  minMinutes: 30, // 이보다 짧으면 자동 안내를 띄우지 않는다(메뉴에서는 언제든 수령)
  // 지금은 강화석만 쌓는다(시간당 0.2, 12시간 2.4개). 골드는 sim:90d 밴드가 막는다 — 실측: 0.8 라이트 일 골드 +36% · 0.4 미드 지옥 6-10 67일
  // · 0.25 68일·정체 9일 · 0.12 미드 D90 룬 전투력 35.9% · 0.05 시드 3에서 35.2%(밴드 35% 이하, 기준선이 경계 34.4%).
  // 골드 비율(goldRunShare)은 곡선 레인이 밴드를 다시 잡을 때 올린다(docs/RPG_ESSENTIALS.md E2).
  goldRunShare: 0,
  stonesPerHour: 0.2,
  seenEveryMs: 30 * 60000, // 접속 표시 간격(서버 명령 수를 줄인다)
  comeback: Object.freeze({ awayDays: 7, cooldownDays: 30, minCleared: 3,
    rewards: Object.freeze({ gems: 300, energy: 60, sweep: 5, stones2: 10, tickets: 2 }) }),
});

const safeTime = (v, d) => (Number.isSafeInteger(v) && v >= 0 ? v : d);
/** 저장 정규화. 없는 저장(도입 전)은 fallback(보통 fresh 의 지금 시각)에서 시작한다 — 과거분을 소급하지 않는다. */
export function normalizeIdle(raw, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const since = safeTime(r.since, safeTime(base.since, 0));
  return { since, seen: safeTime(r.seen, safeTime(base.seen, since)), comebackAt: safeTime(r.comebackAt, safeTime(base.comebackAt, 0)) };
}

/** 최고 클리어 관문 수(progress.unlocked 는 다음 관문 번호). */
export const clearedStages = (progress) => Math.max(0, Math.min(CHAPTERS.length * STAGES_PER_CHAPTER, (Number.isSafeInteger(progress?.unlocked) ? progress.unlocked : 1) - 1));

/** 읽기 전용 견적. 시계가 기록보다 뒤면(since·seen > now) 아무것도 쌓이지 않는다. */
export function idleQuote(state, progress, nowMs) {
  const st = normalizeIdle(state), now = safeTime(nowMs, 0), cleared = clearedStages(progress);
  const away = Math.max(0, now - st.since), minutes = Math.floor(Math.min(away, IDLE.capHours * H) / 60000);
  let rewards = {};
  if (cleared > 0 && minutes > 0) {
    const ch = Math.ceil(cleared / STAGES_PER_CHAPTER), s = ((cleared - 1) % STAGES_PER_CHAPTER) + 1, hours = minutes / 60;
    const gold = Math.floor(stageDef(ch, s).rewards.gold * IDLE.goldRunShare * hours), stones = Math.floor(IDLE.stonesPerHour * hours);
    rewards = Object.fromEntries(Object.entries({ gold, stones }).filter(([, n]) => n > 0));
  }
  const cb = IDLE.comeback, absent = now - st.seen;
  const comeback = cleared >= cb.minCleared && absent >= cb.awayDays * DAY && now - st.comebackAt >= cb.cooldownDays * DAY;
  return { minutes, capped: away >= IDLE.capHours * H, awayDays: Math.floor(Math.max(0, absent) / DAY), cleared, rewards, comeback,
    comebackRewards: comeback ? { ...cb.rewards } : null, ready: Object.keys(rewards).length > 0 || comeback,
    notable: comeback || minutes >= IDLE.minMinutes && Object.keys(rewards).length > 0 };
}

/** 기록이 지금보다 하루 넘게 앞서면(기기 날짜가 크게 틀렸다가 바로잡힘) 지금으로 내린다. 하루 안쪽은 되돌림 반복 수령 방지로 그대로 둔다. */
function healFuture(state, now) {
  if (state.since > now + DAY) state.since = now;
  if (state.seen > now + DAY) state.seen = now;
}

/** 수령. 시계가 기록보다 뒤면 거부만 한다(기록을 당기지 않는다 — 되돌렸다 복구해 12시간분을 반복 수령하는 것을 막음). */
export function claimIdle(state, progress, nowMs) {
  const now = safeTime(nowMs, 0);
  healFuture(state, now);
  if (state.since > now || state.seen > now) return { ok: false, error: 'clock' };
  const q = idleQuote(state, progress, now);
  if (!q.ready) return { ok: false, error: 'empty' };
  state.since = now; state.seen = now;
  if (q.comeback) state.comebackAt = now;
  const rewards = { ...q.rewards };
  if (q.comeback) for (const [k, n] of Object.entries(q.comebackRewards)) rewards[k] = (rewards[k] || 0) + n;
  return { ok: true, rewards, minutes: q.minutes, comeback: q.comeback, awayDays: q.awayDays };
}

/** 접속 표시. 복귀 보상이 걸려 있으면(아직 안 받음) 남기지 않아 보상을 지우지 않는다. 바뀌면 true. */
export function markSeen(state, progress, nowMs) {
  const now = safeTime(nowMs, 0);
  const healed = state.seen > now + DAY;
  healFuture(state, now);
  if (healed) return true;
  if (state.seen > now || now - state.seen < IDLE.seenEveryMs) return false;
  if (idleQuote(state, progress, now).comeback) return false;
  state.seen = now; return true;
}

/** 외부 저장 가져오기(서버 정화): 지금부터 다시 쌓고, 복귀 보상은 30일 뒤부터. */
export const importedIdle = (nowMs) => ({ since: nowMs, seen: nowMs, comebackAt: nowMs });
