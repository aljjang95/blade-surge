# 인계: 3개월 넷째 덩어리 — 2장 진입 곡선·연패 장비 안내·강화 버튼

- 브랜치·PR: `claude/3m-ch2-entry` · draft PR #471 (머지·배포는 지휘)
- 결과표·판정: `docs/playtest/2026-10-31-ch2-entry.md`
- 게임 변경(배포 필요):
  - 2장 위협 보정: `src/game/squads.js`의 `CH2_THREAT`
  - AUTO 쇳물 회피: `region-traits.js`의 `autoEscape`, `player.js`
  - 2연패 성장 카드 순서: `loss-streak.js`, `growth.js`, `ui.js`
  - 아이템 시트 강화 칸 위치: `ux-pass.css`
- 판정: 2-1·2-5·2-10은 "1.1배 승, 1.0배 미만 패"에 맞음. 2-2는 1.09배에서 반반(약간 어려움). 2-8은 0.92배 승(n=1).
- 성장 봇 a: 보정 전에는 2-2에서 4연패로 막혔고, 보정 후에는 80분 안에 2-4까지 감.

## 다음 덩어리 후보
1. AUTO 잠복 예고 원 회피. 2-2 최대 피해원이다. 1장 곡선 재측정이 함께 필요하다.
2. 3-1·3-5 진입 곡선 스윕(`tools/qa/stage-power-sweep.mjs`).
3. 2-8 표본 확대.
