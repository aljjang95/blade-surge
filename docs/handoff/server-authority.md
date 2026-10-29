# 인계: 블레이드 서지 서버 권위 컷오버 게이트 레인 (2026-10-30)

`[gogo-chunk:blade-server#authority]`. 계약 정본: `docs/SERVER_AUTHORITY_GATES.md`.

## 끝난 것
- **#435 squash 머지(27ca3f4)**: 서버 처치 원장·여정 단계 서버 명령·도감 보상.
  - A1·A2: 정산 사실 `species`(RULES_VERSION p1-2). 서버 권위 계정 정산만 `quests.kills`·`slain`에 누적. 상한 = 관문 개연성 표 + 서버 시계 비율(wallMs/minClearMs) + 실제 생성 id 종 풀(소환 끝까지) + 보스·정예 종 계급 상한. 멱등은 티켓 상태 + 원장 `run:<id>`. 클라이언트는 서버 값 우선 + `killDrift`.
  - A3: `/cmd claimJourneyStep(id)` — 서버는 attest 판정(갑옷·강화는 서버 문서, 기기 전용 단계는 순서 + 클리어 관문 바닥값, 기기 원정·숙련 기록은 읽지 않음). `journey.claimedSteps`는 서버 정본(스냅샷은 서버 값, 가져오기는 attest 완료 접두사만, 문서 적용 시 claimedSteps만 덮음). d3c·wayfarer·7일 최종 상자(1회) 서버 권위에서 열림.
  - A4: 업적 `hunter`(slain 종 수 10/25/50/80/120).
  - A5: **D1 스키마 변경 없음** → 단독 마이그레이션 PR·운영 D1 적용 해당 없음. 되돌리기 = revert 후 배포. 가져오기 1회 병합(진행 범위 풀·처치 상한·서버 바닥), `quests.kills` 상한 3,000 + 20,000×경과일.
  - A6: `bun run check` 6,339 pass / 0 fail(9d0c446) + main 병합 뒤 `bun run test` 6,341 pass·typecheck·build 통과, `sim:90d` 밴드 통과. `V1_SERVER_AUTHORITY_PERCENT`=0 유지, 결제 플래그 무변경.
- 리뷰: Codex 코드 P1 1·P2 4 + 보안 Medium 2, 독립 Sonnet 교차 리뷰 P1 3 모두 반영 또는 스레드 답변. 최종 head Codex 코드·보안 지적 없음.

## 남은 게이트(컷오버 전)
1. 여정 일일·주간 의뢰(`claimContract`) 진척·보상 — 원정·던전 서버 런 필요.
2. 기기 증언 단계(서약·정원·제작·숙련)의 실제 판정 — 원정·숙련 서버 이전.
3. 무한의 성 서버 런(7일 여정 d6b·업적 climber).
4. 처치 이벤트 서버 검증(입력 재생) — 지금은 보고 처치에 상한만(기존 시드 드랍과 같은 신뢰 경계). Codex 보안 스레드 r4416823473에 근거 기록.
5. 그림자 기간에 기기에서 새로 잡은 종은 서버 `slain`에 안 들어감(컷오버 뒤 다시 잡으면 쌓임).

## 참고
- 테스트: `test/server-authority-gates.test.ts`(49개, 위조·중복·경계). `tools/tests/rpg-battle-contract.test.mjs`는 rpg-battle.js 소스 주입 목록에 `slainOf`·`recordSlain`을 넣어야 한다.
- 배포: PC `C:\Work\tasks\blade-deploy-27ca3f4.ps1`(로그 `.log`).
