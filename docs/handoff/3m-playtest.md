# 인계: 3개월 둘째 덩어리 — R7 QA 첫 플레이 표본

- 브랜치·PR: `claude/3m-playtest-first-hour` · draft PR #459 (머지·배포는 지휘)
- 결과표·결함: `docs/playtest/2026-10-30-first-hour.md`
- 코드 변경: `src/ui/tutorial.css`(세로 튜토리얼 카드 HUD 겹침 수정)만. 나머지는 QA 도구·장부·문서.
- 배포 필요: 있음(CSS 변경은 사용자에게 보이는 변경). 머지 뒤 지휘가 land 절차로 배포·readback. 재측정은 배포 후 `tools/qa/tutorial-hud-overlap.mjs --origin=https://blade.tllhouse.com`.

## 다음 덩어리 후보 (이 덩어리에서 구현하지 않음)
1. **봇 성장 행동 추가**: 결과 화면 "스킬 강화 ›"·"더 좋은 장비"·소환·훈련을 따라 1-3 벽을 넘는지, 첫 강화·첫 소환·현상금 의뢰판 시각 측정. 이어서 프로필 b(844x390, 첫 1시간) 완주 → dod D3.
2. 2·3일차 의뢰 소진 공백(마라톤 312분 "할 일 없음") 구현.
3. 인앱 가로 전환 안내가 첫 장면인 점 검토(세로 이용자 첫 탭 1회 추가).
