# 인계: 클리어 루프 레인 (2026-10-29 05:35Z)

대표님 피드백(1-1 결과 화면): 카드 3택 보상, 클리어 직후 판매·강화 상점, 무기 수리, 인플레 방지, 인게임 가방, 따라다니는 동료 정체성. 설계는 `docs/CLEAR_LOOP.md`.

## 끝난 것
- PR #390 머지 `d144d25`, PC `deploy.mjs --auth=wrangler` 배포, `version.json` sha d144d259 readback 일치(04:47Z): 전투 중 가방 시트(일시정지 없음, 이번 판·전체 가방, 다른 영웅 ◆), 네브 이름표·첫 등장 소개 띠·일시정지 동료 줄.

## 진행 중 — PR #401 (브랜치 `claude/clear-loop`, 마지막 커밋 `f3df337`, 최신 main 합침)
- 규칙: `src/game/clear-loop.js`(카드 해시 생성·정규화·감쇠, 무기 내구도·수리 비용), `Economy` wearWeapon/dealClearCards/settlePendingCard/applyClearCard/pickClearCard/repairQuote/repairItem, `/cmd pickClearCard·repairItem`, `clearCard` 서버 권위 적용 키(그림자 패리티 제외), legacy 가져오기에서 카드 삭제.
- 화면: `src/ui/clear-loop.{js,css}`, `clear-loop-view.js` — 카드 뒤집기·선택 연출, 요약 칩, 정비소(수리·판매·분해·강화·일괄 판매), 장비 화면 무기 내구도·수리.
- 강화 전승: 정비소 행 '전승' 버튼은 `meta.openTransfer(uid, heroId)`가 있을 때만(성장·경제 레인 #398 소유) 호출만 한다.
- 리뷰: Codex 코드·보안 지적 3건, GPT-6.1 Sol 교차 리뷰 4건 모두 반영. f3df337 재리뷰(코드·보안)와 `bun run check` 진행 중이었다. 직전 check(490c306+main) 6180 pass / 0 fail.

## 남은 일 (순서)
1. PR #401 재리뷰 결과 확인 → 지적 있으면 반영 → 최신 main 합치고 `bun run check` → squash 머지.
2. 배포: PC 깨끗한 detached worktree에서 최신 origin/main SHA로 `node tools/deploy.mjs --auth=wrangler` → `https://blade.tllhouse.com/version.json` sha readback.
3. 운영에서 844×390 카드 선택·정비소·수리 캡처/영상, #398 머지 뒤 '전승' 버튼 줄 넘침 확인.
4. 지휘 세션(session_01H8mx3U9qK3w3SjT5hPBKSr)에 "어디서 무엇을 보면 되는지" 한 줄, `apex done`.

## 다음 행동
PR #401 리뷰 상태 확인(`f3df337`).
