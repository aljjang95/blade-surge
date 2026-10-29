// 방치(오프라인) 보급 + 복귀 보상(docs/RPG_ESSENTIALS.md E2). 순수 규칙: 시계는 호출자가 넘긴다(endgameNow = 서버 시각 우선).
// 마지막 수령 뒤 흐른 시간만큼 최고 클리어 관문 골드·강화석이 쌓인다(상한 12시간). 로비에 들어오면 자동 안내하므로
// 마지막 수령 시각 ≈ 마지막 접속이다. 그 간격이 7일 이상이면 복귀 보상을 함께 준다(30일에 한 번).
import { stageDef, CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';

const H = 3600000, DAY = 86400000;
export const IDLE = Object.freeze({
  capHours: 12,
  minMinutes: 30, // 이보다 짧으면 자동 안내를 띄우지 않는다(메뉴에서는 언제든 수령)
  goldRunShare: 0.4, // 시간당 = 최고 클리어 관문 기본 골드 × 0.4 (관문 30 ≈ 2천/시간, 12시간 ≈ 2.4만). 0.8은 sim:90d 라이트 일수입 +36%라 반으로
  stonesPerHour: 0.3,
  comeback: Object.freeze({ awayDays: 7, cooldownDays: 30, minCleared: 3,
    rewards: Object.freeze({ gems: 300, energy: 60, sweep: 5, stones2: 10, tickets: 2 }) }),
});

const safeTime = (v, d) => (Number.isSafeInteger(v) && v >= 0 ? v : d);
/** 저장 정규화. 없는 저장(도입 전)은 fallback(보통 fresh 의 지금 시각)에서 시작한다 — 과거분을 소급하지 않는다. */
export function normalizeIdle(raw, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : { since: 0, comebackAt: 0 };
  const r = raw && typeof raw === 'object' ? raw : {};
  return { since: safeTime(r.since, safeTime(base.since, 0)), comebackAt: safeTime(r.comebackAt, safeTime(base.comebackAt, 0)) };
}

/** 최고 클리어 관문 수(progress.unlocked 는 다음 관문 번호). */
export const clearedStages = (progress) => Math.max(0, Math.min(CHAPTERS.length * STAGES_PER_CHAPTER, (Number.isSafeInteger(progress?.unlocked) ? progress.unlocked : 1) - 1));

/** 읽기 전용 견적. */
export function idleQuote(state, progress, nowMs) {
  const st = normalizeIdle(state), now = safeTime(nowMs, 0), cleared = clearedStages(progress);
  const away = Math.max(0, now - st.since), minutes = Math.floor(Math.min(away, IDLE.capHours * H) / 60000);
  let rewards = {};
  if (cleared > 0 && minutes > 0) {
    const ch = Math.ceil(cleared / STAGES_PER_CHAPTER), s = ((cleared - 1) % STAGES_PER_CHAPTER) + 1, hours = minutes / 60;
    const gold = Math.floor(stageDef(ch, s).rewards.gold * IDLE.goldRunShare * hours), stones = Math.floor(IDLE.stonesPerHour * hours);
    rewards = Object.fromEntries(Object.entries({ gold, stones }).filter(([, n]) => n > 0));
  }
  const cb = IDLE.comeback;
  const comeback = cleared >= cb.minCleared && away >= cb.awayDays * DAY && now - st.comebackAt >= cb.cooldownDays * DAY;
  return { minutes, capped: away >= IDLE.capHours * H, awayDays: Math.floor(away / DAY), cleared, rewards, comeback,
    comebackRewards: comeback ? { ...cb.rewards } : null, ready: Object.keys(rewards).length > 0 || comeback,
    notable: comeback || minutes >= IDLE.minMinutes && Object.keys(rewards).length > 0, fullAt: st.since + IDLE.capHours * H };
}

/** 수령. 시계가 뒤로 갔으면(since > now) 보상 없이 기준만 지금으로 당긴다. */
export function claimIdle(state, progress, nowMs) {
  const now = safeTime(nowMs, 0);
  if (state.since > now) { state.since = now; return { ok: false, error: 'clock' }; }
  const q = idleQuote(state, progress, now);
  if (!q.ready) return { ok: false, error: 'empty' };
  state.since = now;
  if (q.comeback) state.comebackAt = now;
  const rewards = { ...q.rewards };
  if (q.comeback) for (const [k, n] of Object.entries(q.comebackRewards)) rewards[k] = (rewards[k] || 0) + n;
  return { ok: true, rewards, minutes: q.minutes, comeback: q.comeback, awayDays: q.awayDays };
}
