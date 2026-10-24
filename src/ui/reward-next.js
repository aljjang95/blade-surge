import { rewardNextAction } from '../game/reward-next-action.js';

/** 결과 보상 → 지금 쓸 곳. 게임 재화만 쓰는 화면으로만 이동하고 결제·상점은 열지 않는다. */
export const currentRewardAction = (app, mode, got) => rewardNextAction({ mode, got, eco: app.eco });

/** 목적지 화면을 연다(로비로 나온 뒤 호출). 아무 것도 소비·구매하지 않는다. */
export function openRewardTarget(app, target) {
  const meta = app.meta;
  if (target.tab === 'journey') { app.journeyView?.open(target.journeyTab || 'tower'); return; }
  if (target.tab === 'heroes') {
    meta.heroSel = target.heroId; meta.openTab('heroes');
    if (target.uid != null) meta.showEnhance(target.uid, target.heroId);
    return;
  }
  meta.openTab(target.tab, target.banner);
}
