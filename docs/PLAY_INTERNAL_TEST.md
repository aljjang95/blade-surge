# Play 내부 테스트 트랙 + 라이선스 테스터 결제 E2E 절차 — 2026-10-25

> **실행 직전 준비 문서**다. 작성 세션은 Play 상품 `--apply`, 플래그 변경, 배포, AAB 업로드를 하지 않았다.
> 이 절차는 PC와 **실기기**(Galaxy S26 Ultra 또는 Tab S7+, `docs/BM_HANDOFF.md` 4번)가 필요하다. 클라우드에서는 로컬 증거(AAB 빌드, SQL 조회)까지만 한다.
> 판매 상품은 4종(소환 보석 지급 포함 `starter_pack_v1`, 광고 제거 `remove_ads_v1`, 월정액 `monthly_card_v1`, 시즌 패스 `season_pass_s1`)이다. **영웅 직접 판매(`hero_*_v1`, `hero_all_v1`)는 소환 전용 결정(docs/GACHA_HANDOFF.md, BM_DESIGN 12.1-1)으로 판매하지 않으며** 카탈로그에서 `enabled:false, gate:'gacha-only'`라 등록·판매·테스트 대상이 아니다. 보석 팩 3종(`gems_*`)도 gate `paid-gem-split`로 꺼져 있다.

근거 코드·문서: `docs/BM_HANDOFF.md` 4·5번, `docs/BM_DESIGN.md` 3~6·9장, `docs/CLOUD_AAB_BUILD.md`, `worker/v1/iap.ts`(`billingReason`, `intent`, `verify`, `processPurchase`), `worker/v1/play.ts`(`testPurchaseContext`/`testPurchase` -> `test`), `worker/v1/rtdn.ts`, `src/shared/iap-catalog.js`, `wrangler.jsonc`.

## 0. 먼저 알아 둘 것(코드 근거)

- 결제가 열리는 조건은 `billingReason`의 순서다: `IAP_ENABLED='true'` -> D1 스키마 v3 이상 -> `PLAY_SA_JSON` 바인딩. 이유 코드: `billing-disabled`, `iap-schema-missing`, `credential-route-unavailable`.
- 라이선스 테스터의 구매는 Play 응답에 `testPurchaseContext`(일회) / `testPurchase`(구독)가 붙어 `test=true`가 된다. **`IAP_ALLOW_TEST !== 'true'`이면 `422 test-purchase-not-allowed`로 거부**한다(iap.ts). 테스트 구매는 지급은 되지만 `iap_grants.price_krw=0`, 퍼널 `first_purchase` 미기록(매출·결제율에서 제외).
- `IAP_TEST_ACCOUNTS`는 **웹 결제(포트원) 테스트 채널**용 account_id 허용 목록이다(portone.ts `testAllowed`). Play 라이선스 테스트에는 필요 없다. Play 쪽 안전장치는 "라이선스 테스터만 `test=true`를 만들 수 있다"는 Play 자체 규칙이며, 그래서 `IAP_ALLOW_TEST=true` 동안에도 일반 이용자의 실결제(`test=false`)는 정상 경로로 지급된다는 점에 주의한다(= 내부 트랙 한정 테스트 동안만 `IAP_ENABLED=true`, 테스트 뒤 즉시 원복. 운영 개방은 별도 확인).
- 이 절차 동안 `WEB_BILLING_ENABLED`는 `false` 유지.
- 선행: `V1_ENABLED=true`(docs/V1_ROLLOUT.md p0 이상)와 D1 스키마 v3 이상(0003). 테스트 계정은 그림자(`shadow`)여도 된다(영웅 상품이 없으므로 `server-authority-required` 제약에 걸리지 않는다).

## 1. 사전 확인(읽기 전용)

```sh
node tools/play-iap-register.mjs                    # dry-run: 등록될 요청 8건 출력(네트워크 없음)
NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --probe   # 현재 등록 상태 GET 2개(클라우드 프록시 경유)
node tools/v1-rollout.mjs --check https://blade.tllhouse.com    # V1 상태
node tools/v1-rollout.mjs --stage play-test                     # 이 절차 요약 출력
```

dry-run이 내놓는 등록 대상(2026-10-25 확인): `remove_ads_v1` ₩4,900, `starter_pack_v1` ₩1,200, `monthly_card_v1` ₩5,900/월(기본 요금제 `monthly`, P1M), `season_pass_s1` ₩9,900 — 영웅 상품 없음(테스트로 고정: `test/play-iap-register.test.ts`).

## 2. Play 콘솔 상품 등록 — 대표님 확인 후

1. 대표님 한 줄 확인: "Play 콘솔에 광고 제거 ₩4,900 / 스타터 ₩1,200 / 월정액 ₩5,900 / 시즌 패스 ₩9,900을 등록합니다(세금 분류·환불 문구 포함)."
2. 등록(승인 뒤에만): `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --apply --i-have-owner-approval`. 첫 실패에서 멈춘다. 필드 중 `apply 전 확인`으로 주석된 항목(구독 `listings.benefits`, `legacyCompatible`, `taxAndComplianceSettings`)은 첫 응답으로 확인하고 막히면 콘솔에서 보정한다.
3. 확인: `--probe`가 4개 상품 id를 돌려주는지. 구독은 기본 요금제 `monthly`가 활성인지.

## 3. 내부 테스트 트랙 AAB

1. 클라우드(리눅스) 빌드(서명 없는 AAB, 커밋한 clean 소스에서만): `bun install --frozen-lockfile && bun run build:aab:cloud -- --version-code <이전보다 큰 정수> --version-name 1.0.<n>` (`docs/CLOUD_AAB_BUILD.md`). 출력의 `AAB_PATH`·`AAB_SHA256`을 기록.
2. 서명+업로드(원격 서명 서비스, 키 값은 세션에 오지 않음): `apex play <AAB_PATH> BLADESURGE_PLAY internal completed "내부 테스트: 결제 E2E"`. 금고 이름 `BLADESURGE_PLAY` -> 패키지 `com.theluxurylord.bladesurge`. production 트랙은 별도 승인 없이는 코드가 막는다 — 이 절차는 internal만.
3. Play 콘솔 확인: 테스트 및 출시 > 내부 테스트 > 릴리스가 "사용 가능"인지, 새 versionCode.
4. 이 AAB는 현재 main 기준이어야 한다(V1·결제 클라이언트 코드 포함). 로컬 증거까지만 클라우드에서 확인하고 설치·결제는 6장 실기기.

## 4. 테스터 등록

- **라이선스 테스터**(결제를 무료 테스트 카드로): Play Console > 설정 > 라이선스 테스트 > 테스터 Gmail 추가, 라이선스 응답 `RESPOND_NORMALLY`. 테스트 구매는 서버에서 `test=true`로 보인다.
- **내부 테스트 테스터**(앱 설치): 내부 테스트 > 테스터 > 이메일 목록 만들기 > 같은 Gmail 추가 후 저장. 목록당 최대 100명.
- 테스터 계정으로 로그인한 기기에서 아래 설치 링크를 연다. 같은 Gmail이 기기의 Play 스토어 기본 계정이어야 한다.
- 이메일 주소는 문서·저장소·로그에 쓰지 않는다(대표님이 콘솔에 직접 입력).

## 5. 내부 트랙 설치 링크

- 콘솔 > 내부 테스트 > 테스터 탭 > "참여 링크 복사"(형식 `https://play.google.com/apps/internaltest/<토큰>`). 토큰은 콘솔에서만 얻는다(저장소에 적지 않는다). 링크를 연 뒤 "테스터 되기" -> Play 스토어에서 설치.
- 설치된 versionCode가 3장에서 올린 값인지 앱 정보로 확인.

## 6. 실기기 결제 E2E (PC + 실기기)

사전: 기기 잠금 규칙(`device-lock`), 한 번에 한 세션. S26은 대표님 개인 폰이므로 전경 앱이 테스트 앱일 때만 입력한다.

### 6.1 플래그 켜기(테스트 동안만) — 대표님 한 줄 확인

"내부 테스트 동안만 `IAP_ENABLED=true`, `IAP_ALLOW_TEST=true`로 배포합니다(테스트 뒤 원복)."
wrangler.jsonc 두 줄만 수정 -> PR -> 머지 -> PC에서 `node tools/deploy.mjs --auth=wrangler` -> `version.json` readback(docs/V1_ROLLOUT.md 4.1과 같은 경로). `IAP_TEST_ACCOUNTS`는 비워 둔다(웹 결제용).
확인: 앱에서 `GET /iap/catalog`가 `billing:true`(이유 필드 없음)이고 4개 상품 `eligible:true`.

### 6.2 구매 -> 지급

기기에서 상품별로 한 번씩(스타터, 광고 제거, 월정액, 패스) 구매. 흐름: `intent`(obfuscatedAccountId) -> Play 결제 시트 -> `verify`(서버가 Play 조회·소유 확인) -> D1 배치 지급 -> acknowledge/consume.

테스트 계정 찾기와 확인(PC, SELECT만; `<DB>`=`blade-surge-commerce-production`):

```sh
npx wrangler d1 execute <DB> --remote --command "SELECT product_id, kind, state, test, acked, consumed, created_at FROM iap_purchases WHERE test = 1 ORDER BY created_at DESC LIMIT 10"
npx wrangler d1 execute <DB> --remote --command "SELECT g.grant_id, g.product_id, g.price_krw, g.rewards, g.reversed_at FROM iap_grants g JOIN iap_purchases p ON p.token_hash = g.token_hash WHERE p.test = 1 ORDER BY g.granted_at DESC LIMIT 10"
npx wrangler d1 execute <DB> --remote --command "SELECT ent_key, starts_at, expires_at, revoked_at FROM iap_entitlements WHERE token_hash IN (SELECT token_hash FROM iap_purchases WHERE test = 1) ORDER BY starts_at DESC LIMIT 10"
npx wrangler d1 execute <DB> --remote --command "SELECT kind, COUNT(*) AS n FROM wallet_ledger WHERE kind LIKE 'iap:%' AND at >= (strftime('%s','now')-3600)*1000 GROUP BY kind"
```

기대(상품별):

| 상품 | `iap_purchases` | `iap_grants`.rewards | `iap_entitlements` | 클라이언트 |
|---|---|---|---|---|
| `starter_pack_v1` | consumable, `granted`, `consumed=1`, `acked` | SSR 확정권 1·보석 1,000·골드 50,000, `price_krw=0`(test) | 없음 | 같은 상품 재구매는 `not-eligible`(계정당 1회) |
| `remove_ads_v1` | non_consumable, `granted`, `acked=1` | 보상 없음(권한) | `ads_removed`, `expires_at` NULL | 광고 꺼짐 |
| `monthly_card_v1` | subscription, `granted`, `expires_at` 있음 | 보석 1,200(주문당 1회) | 월정액 권한 | `claimMonthly`로 매일 100 |
| `season_pass_s1` | non_consumable, `granted` | 보상 없음 | `pass:s1`, 시즌 종료까지 | 프리미엄 줄 열림 |

그리고 `GET /iap/state`(앱이 자동 호출)가 같은 `grants`를 내려주고 클라이언트가 한 번만 반영했는지(`iapApplied`), 화면 재화가 지급량과 같은지 확인. 퍼널 `first_purchase`는 test라 **기록되지 않아야 한다**:
`SELECT step, COUNT(*) FROM funnel_milestones WHERE step = 'first_purchase' GROUP BY step`(테스트 계정 몫이 늘지 않음).

멱등 확인: 같은 구매 토큰으로 `verify`를 다시 호출해도 지급이 늘지 않는다(앱 재시작 후 `sync()`로 재검증, `iap_grants` 행 수 불변). 확정 못 한 구매(`acked=0`)는 재시도로 ack된다.

### 6.3 환불 -> 역분개

1. Play 콘솔 > 주문 관리에서 테스트 주문을 환불/취소(라이선스 테스트 주문의 환불 가능 여부·반영 지연은 콘솔에서 확인 — 되지 않으면 이 항목을 "미검증"으로 보고하고 6.4의 RTDN 테스트 알림으로 경로만 확인).
2. 반영 경로: RTDN(`voidedPurchaseNotification` -> Play `voidedpurchases`로 같은 토큰 확인 후에만) 또는 시간당 크론(`17 * * * *`, `reconcileVoided`, 판매를 꺼도 돎). RTDN 미설정이면 크론이 최대 약 1시간 + 대사 지연 후 반영.
3. 확인:
```sh
npx wrangler d1 execute <DB> --remote --command "SELECT product_id, state FROM iap_purchases WHERE test = 1 ORDER BY updated_at DESC LIMIT 10"        # refunded
npx wrangler d1 execute <DB> --remote --command "SELECT grant_id, product_id, reversed_at, debt FROM iap_grants WHERE reversed_at IS NOT NULL ORDER BY reversed_at DESC LIMIT 10"
npx wrangler d1 execute <DB> --remote --command "SELECT kind, COUNT(*) AS n FROM wallet_ledger WHERE kind LIKE 'iap-void:%' GROUP BY kind"           # 역분개 원장
npx wrangler d1 execute <DB> --remote --command "SELECT account_id, reward_key, amount FROM iap_debt WHERE amount > 0"                                    # 0 아래로 못 내린 부족분
npx wrangler d1 execute <DB> --remote --command "SELECT ent_key, revoked_at FROM iap_entitlements WHERE revoked_at IS NOT NULL ORDER BY revoked_at DESC LIMIT 10"
npx wrangler d1 execute <DB> --remote --command "SELECT key, value FROM iap_meta"                                                                       # voided_reconciled_until 전진
```
기대: 구매 `refunded`, 지급 `reversed_at` 채워짐, 원장 `iap-void:<상품>` 행, 권한 `revoked_at`, 재화는 0 아래로 내려가지 않고 모자란 만큼 `iap_debt`. 앱에서 `/iap/state`의 `reversals`가 한 번만 반영되어 재화가 줄고 권한(광고 제거·패스·월정액)이 풀린다. 스타터는 `once_key`가 풀려 재구매 가능.

### 6.4 RTDN (선택, 설정돼 있을 때)

`RTDN_AUDIENCE`·`RTDN_PUSH_SUBJECT`가 설정된 뒤 Play 콘솔 수익 창출 설정의 "테스트 알림 보내기" -> `SELECT kind, outcome, received_at FROM iap_rtdn ORDER BY received_at DESC LIMIT 5`에 `test` 행. 설정 전이면 엔드포인트는 503 `rtdn-not-configured`(Pub/Sub이 재전송)이므로 정상이다.

### 6.5 합격 기준

- 4개 상품 모두 구매 -> 지급이 정확히 1회(DB·화면 일치), 재검증 멱등.
- 테스트 구매는 매출·first_purchase에 안 잡힘.
- 환불 -> 역분개(원장·권한·부채)가 DB와 화면에서 일치. (환불 불가 시 "미검증"으로 보고)
- 실결제(`test=0`) 구매가 한 건도 없었음: `SELECT COUNT(*) FROM iap_purchases WHERE test = 0`이 0.
- 증거: 기기 스크린샷(구매 시트·결과 화면), 위 SQL 결과(계정 id 가림), 설치 versionCode, `AAB_SHA256`, 배포 sha.

## 7. 끝난 뒤 — 플래그 원복(대표님 한 줄 확인)

"내부 테스트가 끝나 `IAP_ENABLED`, `IAP_ALLOW_TEST`를 다시 false로 배포합니다."
wrangler.jsonc 두 줄을 `"false"`로 -> PR -> 머지 -> `node tools/deploy.mjs --auth=wrangler` -> readback.
확인: `GET /iap/catalog`가 `billing:false, reason:'billing-disabled'`. `IAP_TEST_ACCOUNTS`는 계속 빈 값, `WEB_BILLING_ENABLED`는 계속 `false`.
테스트 행(`test=1`)은 지우지 않는다(원장 보존, 매출 집계에서 이미 제외).
운영 개방(`IAP_ENABLED=true`, `IAP_ALLOW_TEST=false`)과 가격 공개는 별도로 대표님 확인 후(BM_DESIGN 9장 6번).

## 8. 이 문서를 쓴 세션이 하지 않은 것

Play 상품 등록, AAB 빌드·업로드, 테스터 등록, 플래그 변경·배포, 실기기 결제, 운영 D1 조회. 위 모든 명령은 집행 시점에 실행해 결과로 이 절차의 기대값을 확인해야 한다(특히 6.3의 라이선스 테스트 주문 환불 반영 방식은 미검증 가정).
