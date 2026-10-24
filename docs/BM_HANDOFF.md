# BM(D10·D11) 인계 — 2026-10-22 (2026-10-24 영웅 해금·웹 결제 추가)

PR #231 머지(main `419c99b`). 설계·규칙 정본은 [BM_DESIGN.md](BM_DESIGN.md). 아래는 운영 개방까지 남은 일이며 순서대로 한다.

| # | 할 일 | 담당 | 상태 |
|---|---|---|---|
| 1 | D1 `blade-surge-commerce-production`에 `worker/v1/migrations/0003_iap_funnel.sql` 적용(스키마 v3). 미적용이면 결제만 `iap-schema-missing`으로 닫힘 | 코디네이터 | 미적용 |
| 2 | 배포에 Secrets Store 바인딩 `PLAY_SA_JSON`(apex-shared-apis/`APEX_CLOUD_PLAY_SA_JSON`, 존재 확인함) 포함 확인. `IAP_ENABLED`·`IAP_ALLOW_TEST`는 false 유지 | 코디네이터 | wrangler.jsonc 반영됨 |
| 3 | Play 콘솔 인앱 상품 4종 등록·가격 공개: `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs`(dry-run 확인) → `--apply --i-have-owner-approval`. 가격·세금 분류·환불 문구 확인 | **대표님 확인 후** | 미등록(현재 0개) |
| 4 | 내부 테스트 트랙 AAB(이 main) + 라이선스 테스터로 `IAP_ENABLED=true`·`IAP_ALLOW_TEST=true` 실기기 결제: 구매→지급→환불→역분개 | 대표님 기기 + 에이전트 | 미실행 |
| 5 | RTDN: GCP Pub/Sub 토픽 + push 구독(`https://blade.tllhouse.com/api/v1/iap/rtdn`, OIDC 서비스 계정) → Play 콘솔 수익 창출 설정에 토픽 등록 → `RTDN_AUDIENCE`·`RTDN_PUSH_SUBJECT` 설정 → 테스트 알림 확인 | 에이전트(GCP 권한 필요) | 미설정 |
| 6 | 블레이드 전용 Play 서비스 계정(이 앱 재무 권한만) 분리 후 바인딩 교체 | 에이전트 | 후속 |
| 8 | **영웅 해금 웹 결제(11장)**: D1에 `0004_web_payments.sql` 원격 적용(스키마 v4) | 코디네이터 | 미적용(코드·로컬 테스트만) |
| 9 | 포트원 실결제 채널(KG이니시스 실연동) 생성 → `PORTONE_CHANNEL_KEY` 설정, 시크릿 `APEX_CLOUD_PORTONE_API_SECRET` 바인딩 포함 확인 | 에이전트(콘솔 로그인 필요) + 대표님 | 채널 키 비어 있음 |
| 10 | **V1 개방 게이트**: 기존 이용자 보호용 서버 증거 경로(컷오버 이전 서버 기록 또는 서버 서명 이관 증명) 설계·구현. 그 전에는 서버 가져오기가 항상 정책 2(BM_DESIGN 11.6) | 에이전트 | 미구현 |
| 11 | 테스트 채널 + `IAP_ALLOW_TEST=true` 웹 결제 1회(구매→지급→콘솔 취소→회수) 확인 | 에이전트 + 대표님 결제 화면 | 미실행 |
| 12 | `WEB_BILLING_ENABLED=true`(영웅 ₩5,900·전원 ₩17,900 **공개 전 대표님 확인**) | 대표님 확인 | 꺼짐 |
| 13 | Play 영웅 상품 6종 등록(`tools/play-iap-register.mjs`가 이제 포함) | **대표님 확인 후** | 미등록 |
| 7 | 운영 개방: `IAP_ALLOW_TEST=false`, `IAP_ENABLED=true`(가격 공개·판매 시작은 대표님 확인) | 대표님 확인 | 대기 |

## 후속 개발(다음 덩어리)
- 영웅 해금 후속: 컷오버 시 로컬 무료 해금·paid 처리(11.6-2), `save.created` 위조 완화(서명 기한 토큰, 11.6-1), 웹 결제 취소 API 자동화(현재 조회만), 포트원 웹훅(시크릿 확보 후), 실결제 금액 `price_krw` 교체.
- app 연결: `setupBilling`(src/platform/billing-service.js)이 `app.heroPurchase`를 주입한다. UI(레인 A)는 `app.heroPurchase?.available()`이 true일 때만 구매 버튼을 보인다.
- 유료/무료 보석 분리·무료 먼저 소비·부채 중 소비 차단 → 보석 팩 판매 게이트 해제(서버 권위 컷오버와 함께).
- 실결제 금액(Play orders API)으로 `price_krw` 교체.
- 홈 프로모 버튼(스타터·월정액)이 결제 연결 뒤에도 돌아오지 않는 기존 구조 수정.
- 스타터 팩 72시간 노출 창, 외형 상품, VIP.
- 결제율 보고: `node tools/funnel-report.mjs --days 30`의 SQL을 운영 D1에서 실행(목표 1%).
