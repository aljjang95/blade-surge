// 알림 배지(빨간 점) 집계(docs/RPG_ESSENTIALS.md E1). 화면과 무관한 순수 함수라 테스트가 같은 판정을 쓴다.
// 무료로 지금 받을 수 있는 것만 센다. 결제·소환권처럼 해소에 다른 행동이 필요한 것은 넣지 않는다.
import { GEAR_DEX_MILESTONES, milestoneReached, milestoneClaimed } from './gear-dex.js';

/** 성장 여정 창에서 받을 수 있는 보상 수(여정 단계 + 일일·주간 의뢰). snap = JourneyService.snapshot(). */
export function journeyClaimable(snap) {
  if (!snap) return 0;
  const ready = (rows) => (Array.isArray(rows) ? rows.filter((r) => r?.ready).length : 0);
  return ready(snap.steps) + ready(snap.contracts?.daily) + ready(snap.contracts?.weekly);
}

/** 무한의 성 주간 보급 상자를 지금 받을 수 있는가. summary = Economy.towerSummary(). */
export const towerChestReady = (summary) => !!(summary?.unlocked && summary.chest?.ready);

/** 보유 영웅 전체의 장비 도감 마일스톤 중 달성했지만 받지 않은 수. */
export function gearDexClaimable(save, heroIds) {
  if (!save?.gearDex || !Array.isArray(heroIds)) return 0;
  let n = 0;
  for (const heroId of heroIds) for (const m of GEAR_DEX_MILESTONES) if (!milestoneClaimed(save, heroId, m.id) && milestoneReached(save, heroId, m.id)) n++;
  return n;
}
