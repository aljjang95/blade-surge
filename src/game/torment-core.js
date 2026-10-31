// 고통 단계(TORMENT) 진행 규칙 — docs/SPEC_720H.md 3.2. 저장 모양은 endgame.torment = { best, today: { day, runs } }(endgame-core normalizeEndgame).
// 순수 규칙이다: 시계는 호출자가 넘기고(nowMs), 저장·보상은 Economy.completeStage 트랜잭션이 맡는다.
import { SEASON, TORMENT } from '../data/content-90d.js';
import { STAGES_PER_CHAPTER } from '../data/stages.js';
import { normalizeEndgame } from './endgame-core.js';

const DAY_MS = 86400000, MAX_RUNS = 100000;

/** 시즌 시작(05:00 KST) 기준 일차 + 1(0 = 기록 없음, 시즌 전은 1). 하루 판 수 감쇠가 이 경계를 쓴다. */
export const tormentDayId = (nowMs) => Math.min(MAX_RUNS, Math.max(0, Math.floor(((Number.isFinite(nowMs) ? nowMs : 0) - SEASON.startMs) / DAY_MS)) + 1);

/** 오늘 판 수에 맞춘 상태(읽기 전용). 풀 보상 판이 몇 번 남았는지 보여 준다. */
export function tormentStatus(state, nowMs) {
  const tm = normalizeEndgame(state).torment, runs = tm.today.day >= tormentDayId(nowMs) ? tm.today.runs : 0;
  return { best: tm.best, nextTier: Math.min(TORMENT.maxTier, tm.best + 1), runsToday: runs, fullRuns: TORMENT.fullRuns, fullLeft: Math.max(0, TORMENT.fullRuns - runs) };
}

/**
 * 고통 단계 한 판 완료를 센다. 오늘 첫 fullRuns 판은 full=true(보상 100%), 그 뒤는 false(골드·재료 decayMul, EXP 100%).
 * 일차는 앞으로만 간다: 기기 시계를 되돌려도 오늘 판 수가 0 으로 돌아가지 않는다.
 * 지역 최종 보스(X-10)를 클리어하면 최고 단계가 오른다(요청한 단계가 해금 단계 이하일 때만 — 호출자가 해금을 이미 검사한다).
 */
export function recordTormentRun(state, { tier, st, nowMs }) {
  const tm = state.torment, day = tormentDayId(nowMs);
  if (day > tm.today.day) { tm.today.day = day; tm.today.runs = 0; }
  const full = tm.today.runs < TORMENT.fullRuns, before = tm.best;
  tm.today.runs = Math.min(MAX_RUNS, tm.today.runs + 1);
  if (st === STAGES_PER_CHAPTER && Number.isSafeInteger(tier) && tier >= 1 && tier <= TORMENT.maxTier && tier <= before + 1) tm.best = Math.max(before, tier);
  return { full, runs: tm.today.runs, best: tm.best, newBest: tm.best > before };
}
