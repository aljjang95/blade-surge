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
| 10 | **V1 개방 게이트**: 기존 이용자 보호용 서버 증거 경로(소셜 프로필 생성 시각 → 정책 1, 증거 없는 주장 → 소환권 10 보상 1회, BM_DESIGN 11.2·11.6). 회귀 `test/v1-legacy-guard.test.ts` | 에이전트 | 구현(PR 대기) |
| 11 | 테스트 채널 + `IAP_ALLOW_TEST=true` + 테스터 계정만 `IAP_TEST_ACCOUNTS` 웹 결제 1회(구매→지급→콘솔 취소→회수) 확인 | 에이전트 + 대표님 결제 화면 | 미실행 |
| 12 | `WEB_BILLING_ENABLED=true`(**영웅 상품은 소환 전용 결정으로 신규 판매 닫힘(`gate:'gacha-only'`, GACHA_HANDOFF)** — 이 행의 영웅 ₩5,900·₩17,900은 재개 시에만; 보석 등 나머지 상품은 **공개 전 대표님 확인**) | 대표님 확인 | 꺼짐 |
| 13 | Play 영웅 상품 6종 등록(`tools/play-iap-register.mjs`) — 소환 전용 결정(GACHA_HANDOFF)으로 신규 판매가 닫혀 있어 **등록 보류**(기존 영수증 검증·복구 경로만 유지) | **대표님 확인 후** | 보류 |
| 7 | 운영 개방: `IAP_ALLOW_TEST=false`, `IAP_ENABLED=true`(가격 공개·판매 시작은 대표님 확인) | 대표님 확인 | 대기 |

## 후속 개발(다음 덩어리)
- 영웅 해금 후속: 컷오버 시 로컬 무료 해금·paid 처리(11.6-2), `save.created` 위조 완화(서명 기한 토큰, 11.6-1), 웹 결제 취소 API 자동화(현재 조회만), 포트원 웹훅(시크릿 확보 후), 실결제 금액 `price_krw` 교체.
- app 연결: `setupBilling`(src/platform/billing-service.js)이 `app.heroPurchase`를 주입한다. UI(레인 A)는 `app.heroPurchase?.available()`이 true일 때만 구매 버튼을 보인다.
- 유료/무료 보석 분리·무료 먼저 소비·부채 중 소비 차단 → 보석 팩 판매 게이트 해제(서버 권위 컷오버와 함께).
- 실결제 금액(Play orders API)으로 `price_krw` 교체.
- 홈 프로모 버튼(스타터·월정액)이 결제 연결 뒤에도 돌아오지 않는 기존 구조 수정.
- 스타터 팩 72시간 노출 창, 외형 상품, VIP.
- 결제율 보고: `node tools/funnel-report.mjs --days 30`의 SQL을 운영 D1에서 실행(목표 1%).

## 수익화 2단계 인계 (2026-10-25, gogo-chunk:monetize-2)
- **끝남(main 머지)**
  - #284 `83824cf` 기존 이용자 보호: 소셜 프로필 생성 시각(서버 기록) < `HERO_STARTER_POLICY_SINCE`(2026-10-24 16:26:22 KST)면 정책 1. 증거가 없는데 정책 1을 주장하면 정책 2 + 소환권 10을 한 번 준다. `bun run check` 통과(5,348). 교차 리뷰는 GitHub Codex 한도, PC OpenCodex 응답 없음으로 Sonnet 독립 리뷰가 대신 함. P1 1건(정책 1 계정 스냅샷의 재화 절삭) 수정.
  - #285 `596ca16` 실행 직전 준비: `docs/V1_ROLLOUT.md`, `tools/v1-rollout.mjs`(dry-run 전용), `docs/PLAY_INTERNAL_TEST.md`, 죽은 영웅 listing 제거. 롤백은 `legacy_saves.status='shadow'`로 되돌림(그림자 동기화 유지).
  - 영웅 직접 판매(hero_*)는 `gacha-only`로 신규 판매가 닫혀 있다. 기존 영수증 복구 경로는 유지.
- **확인한 값**: Play 내부 트랙 최신 versionCode = **2**. 커밋하지 않은 편집으로 조회한 뒤 삭제함. 상품 등록 dry-run 8요청(remove_ads ₩4,900 · starter ₩1,200 · monthly ₩5,900/월 · season_pass ₩9,900), 오류 없음.
- **막힘: AAB 빌드**: 클라우드에서 `bun run build:aab:cloud -- --version-code 3`이 Gradle 의존성 단계에서 실패함. Maven Central 429와 저장소별 간헐 404가 원인이며 재시도 5회, 프록시 설정, refresh 모두 실패. → 시간을 두고 클라우드에서 재시도하거나 PC 빌드 후 `apex play <aab> BLADESURGE_PLAY internal`(versionCode 3 이상).
- **대표님 한 줄 확인 뒤 집행할 것** (V1_ROLLOUT 7장)
  1. 운영 D1 0003·0004 적용
  2. 첫 배포(#284 포함, `V1_ENABLED=true`, 퍼센트 0)
  3. 5→25→100%. G2(서버 결과를 먼저 받는 소환)가 끝나기 전에는 p0까지만.
  4. `play-iap-register --apply`(가격 공개)
  5. 라이선스 테스터 결제 E2E(PC·실기기)
