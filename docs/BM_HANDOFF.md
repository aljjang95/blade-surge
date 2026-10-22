# BM(D10·D11) 인계 — 2026-10-22

PR #231 머지(main `419c99b`). 설계·규칙 정본은 [BM_DESIGN.md](BM_DESIGN.md). 아래는 운영 개방까지 남은 일이며 순서대로 한다.

| # | 할 일 | 담당 | 상태 |
|---|---|---|---|
| 1 | D1 `blade-surge-commerce-production`에 `worker/v1/migrations/0003_iap_funnel.sql` 적용(스키마 v3). 미적용이면 결제만 `iap-schema-missing`으로 닫힘 | 코디네이터 | 미적용 |
| 2 | 배포에 Secrets Store 바인딩 `PLAY_SA_JSON`(apex-shared-apis/`APEX_CLOUD_PLAY_SA_JSON`, 존재 확인함) 포함 확인. `IAP_ENABLED`·`IAP_ALLOW_TEST`는 false 유지 | 코디네이터 | wrangler.jsonc 반영됨 |
| 3 | Play 콘솔 인앱 상품 4종 등록·가격 공개: `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs`(dry-run 확인) → `--apply --i-have-owner-approval`. 가격·세금 분류·환불 문구 확인 | **대표님 확인 후** | 미등록(현재 0개) |
| 4 | 내부 테스트 트랙 AAB(이 main) + 라이선스 테스터로 `IAP_ENABLED=true`·`IAP_ALLOW_TEST=true` 실기기 결제: 구매→지급→환불→역분개 | 대표님 기기 + 에이전트 | 미실행 |
| 5 | RTDN: GCP Pub/Sub 토픽 + push 구독(`https://blade.tllhouse.com/api/v1/iap/rtdn`, OIDC 서비스 계정) → Play 콘솔 수익 창출 설정에 토픽 등록 → `RTDN_AUDIENCE`·`RTDN_PUSH_SUBJECT` 설정 → 테스트 알림 확인 | 에이전트(GCP 권한 필요) | 미설정 |
| 6 | 블레이드 전용 Play 서비스 계정(이 앱 재무 권한만) 분리 후 바인딩 교체 | 에이전트 | 후속 |
| 7 | 운영 개방: `IAP_ALLOW_TEST=false`, `IAP_ENABLED=true`(가격 공개·판매 시작은 대표님 확인) | 대표님 확인 | 대기 |

## 후속 개발(다음 덩어리)
- 유료/무료 보석 분리·무료 먼저 소비·부채 중 소비 차단 → 보석 팩 판매 게이트 해제(서버 권위 컷오버와 함께).
- 실결제 금액(Play orders API)으로 `price_krw` 교체.
- 홈 프로모 버튼(스타터·월정액)이 결제 연결 뒤에도 돌아오지 않는 기존 구조 수정.
- 스타터 팩 72시간 노출 창, 외형 상품, VIP.
- 결제율 보고: `node tools/funnel-report.mjs --days 30`의 SQL을 운영 D1에서 실행(목표 1%).
