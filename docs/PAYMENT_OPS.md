# 결제 운영 (웹 카드 결제 · 환불 · 대사 · 켜고 끄는 순서)

작성: 2026-10-30. 코드 정본은 `worker/v1/portone.ts`(웹 결제), `worker/v1/iap.ts`(지급·역분개), `src/shared/iap-catalog.js`(상품). 이 문서는 운영 절차이며 결제 스위치 값은 바꾸지 않는다.
모든 SQL은 **읽기 전용 SELECT**다(운영 D1은 `wrangler d1 execute apex-rsi --remote --json --command "..."`). 개인정보(이메일 등)는 장부에 없고 계정은 `account_id`(`p_...`)로만 식별한다.

## 1. 환불 접수 경로

- 고객은 `public/support.html`의 고객지원 이메일(aljjang95@gmail.com, 제목 "블레이드 서지 문의")로 접수한다. 전화는 010-8804-8903.
- 접수 시 받을 것: 결제 수단(웹 카드/Play), 결제 시각, 상품명, 게임 내 계정 정보(설정 → 계정에서 보이는 식별 정보). 카드번호·비밀번호는 받지 않는다.
- 웹 결제 환불은 아래 3장(포트원 콘솔 수동 취소)으로 처리한다. Play 결제는 Google Play 환불 경로(서버가 Play 취소 알림으로 회수)이며 이 문서 범위 밖이다.
- 청약철회 기준은 `public/refund.html`을 따른다. 미사용 여부는 2장으로 확인한다.

## 2. 미사용 재화 확인 (읽기 전용 SQL)

테이블·열은 `worker/v1/migrations/*.sql` 기준이다. 보석은 총액(`gems`)과 그중 유료 몫(`paidGems`)으로 나뉘고, 소비는 무료부터 줄어든다. 계정 목록 조회용 투영 열은 `accounts.gems_free`(무료 몫), `accounts.gems_paid`(유료 몫)다.

```sql
-- (a) 계정의 웹 결제 내역
SELECT payment_id, product_id, amount_krw, state, test, created_at, granted_at, cancelled_at
FROM iap_web_payments WHERE account_id = '<account_id>' ORDER BY created_at;

-- (b) 그 결제로 나간 지급(보상 JSON, 역분개 여부). token_hash 는 iap_web_payments.token_hash 와 같다.
SELECT g.grant_id, g.product_id, g.rewards, g.price_krw, g.granted_at, g.reversed_at, g.debt
FROM iap_grants g WHERE g.account_id = '<account_id>' ORDER BY g.granted_at;

-- (c) 현재 보석 잔액(무료/유료 분리)과 계정 상태
SELECT account_id, status, gems_free, gems_paid, gold, level, last_seen FROM accounts WHERE account_id = '<account_id>';

-- (d) 지급·역분개 원장(월렛 원장). kind 'iap:<상품>' = 지급, 'iap-void:<상품>' = 환불 회수
SELECT op_id, kind, delta, at FROM wallet_ledger WHERE account_id = '<account_id>' AND kind LIKE 'iap%' ORDER BY at;

-- (e) 보유 권한(광고 제거·시즌 패스 등)과 회수 여부
SELECT ent_key, starts_at, expires_at, revoked_at FROM iap_entitlements WHERE account_id = '<account_id>';

-- (f) 계정당 1회 상품 소진 여부와 미상환 부채(회수 못 한 부족분)
SELECT once_key, reversed_at FROM iap_grants WHERE account_id = '<account_id>' AND once_key IS NOT NULL;
SELECT reward_key, amount, updated_at FROM iap_debt WHERE account_id = '<account_id>';

-- (g) Play 구매 기록(웹과 별개): 같은 계정이 Play 로도 샀는지
SELECT product_id, kind, state, test, created_at FROM iap_purchases WHERE account_id = '<account_id>' ORDER BY created_at;
```

판단 기준(참고): 스타터 팩은 보석 1,000·골드 50,000·SSR 소환권 1을 한 번에 주므로 (c)(d)로 해당 보상이 소비됐는지 본다. 광고 제거·시즌 패스는 권한이라 (e)로 확인한다. 소비된 재화가 있어도 환불은 회수 시 0 아래로 내려가지 않고 부족분이 `iap_debt`로 남는다(`reverseToken`). 청약철회 가능 여부의 최종 판단은 대표님(`public/refund.html` 기준).

## 3. 포트원 콘솔 수동 취소 절차

서버는 취소·환불 API를 **호출하지 않는다**(조회만). 돈을 돌려주는 일은 사람이 포트원 관리자 콘솔에서 한다. 실제 돈이 움직이므로 대표님이 직접 하거나 대표님 확인 뒤에만 한다.

1. 2장 (a)로 `payment_id`와 금액·상태(`granted`)를 확인한다.
2. 포트원 관리자 콘솔(admin.portone.io)에 로그인 → 해당 상점 → **결제 내역**에서 `payment_id`(결제 건 ID)로 검색한다. (콘솔 메뉴 이름은 변경될 수 있으니 화면에서 확인.)
3. 결제 상세에서 상태가 `결제 완료(PAID)`인지, 금액이 (a)의 `amount_krw`와 같은지 확인한다. 테스트 채널 결제(`test=1`)는 실제 돈이 아니다.
4. **결제 취소** 버튼 → 전체 취소(부분 취소는 서버가 `PARTIAL_CANCELLED`로 보고 회수하므로 의도한 경우만) → 취소 사유 입력 → 확인. 이 단계가 환불 집행이다.
5. 취소 직후 서버는 아직 모른다. 서버 크론 `reconcileWebPayments`가 `granted` 건을 주기적으로 포트원 `GET /payments/{id}`로 다시 조회한다(지급 30일 이내는 약 6시간마다, 그 뒤는 7일마다, 400일 창, 크론 1회 최대 25건). 상태가 `CANCELLED`/`PARTIAL_CANCELLED`로 보이면 `settleWebPayment`가 `reverseToken`을 불러 **권한 철회·보상 역분개**(유료 몫부터 차감, 부족분은 `iap_debt`, 계정당 1회 상품은 `once_key` 해제)를 하고 장부를 `cancelled`로 바꾼다. 판매 스위치(`WEB_BILLING_ENABLED`)가 꺼져 있어도 시크릿과 스키마만 있으면 대사는 돈다.
6. 급하면 크론을 기다리지 않고 취소 후 6시간 안에 아래 4장 SQL로 회수 여부를 확인한다. 회수가 안 되면 5장 대사 스크립트로 `cancel_not_reflected`를 확인한다.

## 4. 회수 확인 SQL

```sql
-- 취소 반영 여부: state 가 cancelled, cancelled_at 이 채워졌는지
SELECT payment_id, state, cancelled_at, checked_at FROM iap_web_payments WHERE payment_id = '<payment_id>';

-- 지급이 역분개됐는지(reversed_at), 부족분(debt)이 있는지
SELECT grant_id, product_id, reversed_at, debt FROM iap_grants WHERE token_hash = (SELECT token_hash FROM iap_web_payments WHERE payment_id = '<payment_id>');

-- 권한 회수
SELECT ent_key, revoked_at FROM iap_entitlements WHERE token_hash = (SELECT token_hash FROM iap_web_payments WHERE payment_id = '<payment_id>');

-- 회수 원장 (kind 'iap-void:...')
SELECT op_id, kind, at FROM wallet_ledger WHERE kind LIKE 'iap-void:%' AND account_id = '<account_id>' ORDER BY at DESC LIMIT 5;

-- 포트원에서 취소됐는데 아직 서버가 granted 인 건(오래 남으면 점검). 포트원 쪽 상태는 5장 스크립트가 비교한다.
SELECT payment_id, granted_at, checked_at FROM iap_web_payments WHERE state = 'granted' ORDER BY COALESCE(checked_at, 0) ASC LIMIT 20;
```

## 5. 웹훅

- `POST /api/v1/iap/web/webhook`가 구현됐다(별도 레인, 이 브랜치 기준 코드에는 아직 병합 전이므로 병합 후 코드를 다시 확인한다). 포트원 Standard Webhooks 서명을 검증하며 타임스탬프 허용 오차는 ±5분이다. 바인딩 이름은 `PORTONE_WEBHOOK_SECRET`이고, **시크릿이 없으면 503으로 닫힌다**.
- 웹훅 본문은 신뢰하지 않는다. **`paymentId`만 믿고** 서버가 포트원 `GET /payments/{id}`로 **재조회**해서 기존 `settleWebPayment` 경로(금액·통화·storeId·채널 검증)로 처리한다. 웹훅이 오지 않아도 위 크론 대사가 같은 일을 하므로 웹훅은 지연을 줄이는 보조다.
- 포트원 콘솔의 웹훅 URL·시크릿 등록은 콘솔 변경이므로 대표님 확인 후 한다(이 문서 작업에서는 하지 않음).

## 6. 일별 대사 스크립트 `tools/payment-reconcile.mjs`

서버 장부(`iap_web_payments`)와 포트원 결제 목록을 날짜 범위(기본 어제, KST)로 비교한다. 읽기 전용이며 쓰기 SQL을 만들지 않는다.

```bash
# 1) 조회 SQL 출력
node tools/payment-reconcile.mjs --print-sql --date 2026-10-29
# 2) 운영자가 그 SELECT 를 실행해 JSON 으로 저장
wrangler d1 execute apex-rsi --remote --json --command "<출력된 SELECT>" > d1.json
# 3) 대사 (포트원은 $APEX_CLOUD_URL/p/portone GET /payments 만 사용, 키는 프록시가 붙임)
node tools/payment-reconcile.mjs --d1-json d1.json --date 2026-10-29
# 오프라인 비교: --portone-json p.json (GET /payments 응답 JSON), 테스트 채널 포함: --include-test
```

- 종료 코드 0 = 일치, 2 = 차이 있음, 1 = 입력·호출 오류.
- 차이 종류: `missing_on_portone`(서버만 지급), `missing_on_server`(포트원 PAID인데 서버 미지급 — 돈은 받았고 상품은 안 나감, 최우선), `amount_mismatch`, `cancel_not_reflected`(포트원 취소가 아직 서버에 안 반영), `cancelled_but_paid`.
- 포트원 목록 조회는 `GET /payments?requestBody={"page":{"number":0,"size":100},"filter":{...}}` 형식을 쓴다. 공식 문서(developers.portone.io)에서 `GetPaymentsBody { page, filter }`, `filter.timestampType`(CREATED_AT/STATUS_CHANGED_AT), `page.totalCount`를 확인했다. `filter.from`/`until`/`storeId`, 쿼리 파라미터 이름 `requestBody`, 응답 `items`는 2026-10-30 포트원 공식 server-sdk(`portone-io/server-sdk` `PaymentFilterInput`·`GetPaymentsBody`·`GetPaymentsResponse`·`getPayments`)와 대조해 스크립트와 같음을 확인했다. 안 맞는 응답이 오면 `--portone-json`으로 콘솔·API 응답을 넘긴다. 이 레인에서는 실제 포트원 호출을 하지 않았다.

## 7. 켜는 순서 (결제 공개)

⓪ D1 마이그레이션 `0004`(웹 결제 표 `iap_web_payments`)와 `0008`(결제수단 대조용 `iap_web_pay_methods` 표)을 적용한다. 웹 결제만 스키마 v8이 필요하다(v8 미만이면 웹 결제는 열리지 않는다). 적용 뒤 `SELECT version FROM v1_schema`로 확인.
⓪' 게임물 등급분류: 웹 등급번호가 `src/data/game-rating.js`의 `GAME_RATING`(`status: 'rated'` + `number`)에 들어와야 서버가 웹 실채널 판매를 연다. 없으면 의도 발급이 503 `rating-required`로 거절된다. 등급 신청·번호 수령은 대표님 몫(`docs/GRAC_RATING_DRAFT.md`).
① 포트원 실채널 생성 — KG 새 MID 승인 후 포트원에서 새 KG이니시스 채널 생성 → 채널 키를 `PORTONE_CHANNEL_KEY`로 설정(키 값은 채팅·Git 금지, Secrets Store/Worker 시크릿). 웹훅을 쓰면 `PORTONE_WEBHOOK_SECRET`도 같은 방식으로.
② 테스트 계정 결제 E2E — 테스트 계정 플래그(`account_flags.flag='test'`) 또는 테스트 채널로 결제 → 지급 → 포트원 콘솔 취소 → 크론(또는 웹훅) 회수까지 3·4장 SQL로 확인, 6장 대사 0건 차이.
③ `WEB_BILLING_ENABLED=true`.
④ `V1_SERVER_AUTHORITY_PERCENT` 단계 상향(0 → 소수 % → 단계적으로, 단계마다 지표·대사 확인. 서버 권위 계정이 늘어야 서버 지급이 유효하다).
⑤ 대표님 금액 확인 후 공개 — 웹 최대 1회 결제액 ₩9,900, 상품 3종(₩1,200·₩4,900·₩9,900)을 보여 드리고 확인 받는다. 공개 게시·가격 공개는 집행 직전 확인.

켠 뒤 첫 주: 매일 6장 대사를 돌리고 `missing_on_server`가 0인지 본다.

## 8. 끄는 순서 (롤백)

1. 신규 판매만 멈춤: `WEB_BILLING_ENABLED`를 끈다(`false`). 이미 결제된 건의 취소 회수 대사는 시크릿과 스키마만 있으면 계속 돈다.
2. 문제가 결제 채널이면 `PORTONE_CHANNEL_KEY`를 제거(채널 키가 없으면 의도 발급이 `web-not-configured` 503).
3. 서버 권위 롤백이 필요하면 `V1_SERVER_AUTHORITY_PERCENT`를 이전 단계로 낮춘다(`docs/V1_ROLLOUT.md` 절차 확인 후; 이미 서버 권위가 된 계정의 되돌림 영향은 해당 문서 참고).
4. 이미 낸 결제의 환불은 3장으로 개별 처리하고 4장 SQL로 회수를 확인한다. 롤백 후에도 6장 대사로 누락(`missing_on_server`)이 없는지 확인한다.
5. 롤백 시각·사유·영향 건수를 `docs/HANDOFF_*.md` 또는 PR에 기록한다.
