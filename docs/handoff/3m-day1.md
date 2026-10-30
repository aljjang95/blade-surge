# 인계: 3개월 플레이타임 첫 덩어리 — 현상금 의뢰판 (`3month-highend#1`, 2026-10-30)

## 끝난 것
- PR #448 머지(2d204db) → 운영 배포. readback: `https://blade.tllhouse.com/version.json` sha 2d204db9, dirty=false. deploymentId 496f5a6b…, PC `D:\Work\tasks\blade-deploy-2d204db`.
- 계약 `docs/BOUNTY_BOARD.md`. 규칙 `src/data/bounties.js`·`src/game/bounty-board.js`, 게임 연결 `src/game/bounty-service.js`·`src/ui/bounty.js`, 시뮬레이터 `tools/sim-90d.mjs`, 장부 표 `tools/playtime-bounty-units.mjs`.
- 리뷰: Sonnet 독립 경제 리뷰(P1 2건: 의뢰 판 처치 경험치·명성·룬 처치 누수, 수배 의뢰 목표 미검증 → 고침). Codex 3회(P1 1·P2 7 → 모두 고침, 보안 지적 0).
- 검사: 머지된 main `bun run check` 6392 pass / 0 fail, build·출격 스모크 통과, `sim:90d --assert` 밴드 통과.

## 장부 diff (verified)
| 구간 | 전 | 후 |
|---|---|---|
| P1 첫날 | 2.4h (gap 5.1h) | **7.61h 통과** |
| P2 첫 주 | 42.55h (gap 5.45h) | **48.39h 통과** |
- 추가 단위 `bounty-rank-2`~`bounty-rank-26`(25행, 사냥꾼 등급 = 약 20~30분마다 새 목표). 분 = 1~3일차 "할 일 없음" 감소분만(이중 계산 없음). `tower-011`은 현재 sim 1일차 p50 15층이라 P1로 이동.
- 근거: `bun tools/playtime-bounty-units.mjs` (마라톤 16시드, sha256 `e9bbfcd408eb…`, 두 번 실행 동일 = dod D1 재현).

## 시뮬레이터 출력(마라톤 p50)
- 할 일 없음 1/2/3일차: 312/371/246분 → 9/169/80분. 의뢰 295/206/234분, 사냥꾼 등급 14/20/26.
- 대가: 마라톤 D7 전투력 46224→40713, 고통 T1 3일→5일, D90 고통 27→25(모두 밴드 안).
- 2·3일차 잔여 공백은 열린 의뢰 소진(장 개방 일정에 묶임) — 다음 덩어리 후보.

## 운영 실제 입력 표본 (헤드리스 Chromium·SwiftShader, 실기기 아님) — `work/cycles/3m-day1/live/receipt.json`
- B 현상금 의뢰판(390x700 인앱 UA, 터치 CDP): 저장 주입(1-10 클리어·에너지 0) → 메뉴 → 의뢰판 → story:1-1:hunt 출발 → AUTO 승리. 보상 줄 골드 +160·증표 +1·경험치 +10, 저장 값 일치, 재진입 시 의뢰 사라짐(21→20), 버튼 44px+·겹침 0·가로 스크롤 없음, 출발 시 에너지 0 소모 없음. 콘솔 에러 0.
- A 신규 이용자(390x700 인앱): 타이틀 16s → 영웅 선택 26s → 1-1 전투 84s. 소프트웨어 렌더라 20분 안에 1-1 클리어 못 함(구역 6/12) — 게임 결함 판정 불가, 실기기 표본 필요.
- 관찰(범위 밖, 담당 레인에 넘김): 전투 중 튜토리얼 카드(3/5)가 상단 HP·MP·가방 버튼을 덮음(`a-390x700-battle-input.png`). 로비 "세로로 계속하기" 회전 안내가 한 번 뜸.

## 남은 것
- dod D2·D3: 실기기(또는 GPU) 첫 1시간 실제 입력 표본 — 대표님 체험 단계.
- 의뢰 분(3/4/6분)은 시간 모델 → 텔레메트리로 교체.
- 데스크톱 1280x800에 28px 버튼 1개(모바일은 통과).
- 서버 권위 0% 기간이라 `eco.s.bounty`는 기기 전용.

## 대표님이 해 볼 것
blade.tllhouse.com → 1-10까지 클리어 → 메뉴 › 모험 › **현상금 의뢰판** → 에너지 없이 의뢰 출발, 등급이 오르는지.
