# Blade Surge BM 설계 — Google Play 결제·상품·지급·환불·퍼널 (D10a·D10b·D11)

> 2026-10-22 · 브랜치 `claude/blade-bm-billing` · 기준 `docs/MMO_DESIGN.md` 3.4.4·6장, `docs/COMMERCE-SERVER-CONTRACT-20260923.md` 8개 요구.
> 이 문서는 **설계와 구현 경계**다(11장: 영웅 해금·웹 결제 포트원). Play 콘솔 상품 등록·가격 공개·실제 구매·운영 활성화(`IAP_ENABLED=true`)는 하지 않았다(대표님 확인 사항).

## 0. 결정 요약

| # | 결정 | 이유 | 버린 선택지 |
|---|---|---|---|
| 1 | 결제 서버는 MMO v1 계정(`/api/v1/iap/*`)에 붙인다 | 지급이 v1 원장(`wallet_ledger`)·문서 CAS와 같은 D1 배치여야 원자·멱등이 된다. 권한은 계정 단위라 기기를 바꿔도 복원된다 | 기존 `/api/store`(광고 제거 전용, 구글 ID 토큰 세션) 확장 — 계정·원장이 없어 다상품 지급을 원자로 못 묶는다. 기존 경로는 그대로 둔다 |
| 2 | 클라이언트 결제는 이미 앱에 들어 있는 **공식 Play Billing Library 9.1.0**(`BladeStore` 플러그인)을 확장한다 | 구글 공식 라이브러리이고 앱에 이미 서명·검증된 경로(구독·보류 결제·자동 재연결)가 있다. 새 서드파티 의존성 0 | RevenueCat(외부 서버로 영수증이 나감, 유료), cordova-plugin-purchase(구독 v2 API 지원 지연·플러그인 계층 추가) |
| 3 | 지급 근거는 **Play Developer API 서버 조회 결과뿐** | 클라이언트 결과·RTDN 본문은 위조 가능. 서버가 토큰으로 다시 읽은 상태만 믿는다 | 기기 서명 검증(`originalJson`+공개키) — 오프라인 검증은 환불·취소 상태를 모른다 |
| 4 | 결제 권한(광고 제거·월정액·시즌 패스)은 **문서 밖 `iap_entitlements` 표**가 정본 | 그림자 모드 스냅샷 정화가 결제 필드를 지운다(로컬 세이브는 결제 증거가 아님). 명령 직전에 서버가 덮어쓴다 | 문서 필드에 저장 — 클라이언트 스냅샷이 지우거나 위조할 수 있다 |
| 5 | 월정액은 **Play 자동 갱신 구독**(기본 요금제 `monthly`, P1M, 유예 3일) | 해지·환불·유예·보류가 RTDN·`subscriptionsv2`로 표준화된다. 갱신마다 지급이 주문 id로 멱등 | 30일 소모품(한국식 "월정액 상품") — 재구매를 매달 유도해야 하고 갱신 이벤트가 없다 |
| 6 | 시즌 패스는 시즌마다 다른 **비소모 상품 id**(`season_pass_s1`) | 시즌 안 1회·복원 자동·환불 시 권한 철회가 비소모 규칙과 같다. 다음 시즌은 새 id | 소모품 + 서버 1회 제한 — 복원이 서버 의존이 되고 실수로 2번 사면 환불 대상 |
| 7 | 보석 팩은 카탈로그에 넣되 **판매 비활성**(`gate: paid-gem-split`) | 유료/무료 보석 분리 저장·무료 먼저 소비·환불 역분개가 없으면 환불 계산이 불가능하다(MMO_DESIGN 6.4) | 지금 판매 — 환불 시 어떤 보석이 유료였는지 모른다 |
| 8 | RTDN은 받되 **환불 대사는 시간당 `voidedpurchases` 크론이 최종 안전망** | Pub/Sub 설정 전에도 환불이 반영되고, RTDN을 놓쳐도 3일 안 이벤트는 다시 잡는다 | RTDN만 — 설정 누락·전송 실패 시 환불이 영영 반영 안 됨 |

## 1. 장르 최상위 모바일 ARPG BM 조사 (공개 정보 기반 요약)

| 게임 | 핵심 상품 | 가져올 패턴 | 피할 패턴 |
|---|---|---|---|
| 디아블로 이모탈 | 배틀 패스(무료/유료/프리미엄+), 월정액 성격의 "보물 창고", 소량 첫 구매 팩 | 시즌 패스가 매출의 바닥을 깐다. 이미 달성한 단계 보상을 소급 지급해 시즌 후반 구매도 손해가 아니게 | 전설 보석처럼 PvP 능력치에 직결되는 확률형 상품(규제·평판 리스크) |
| 원신 | 공월 축복(30일 월정액: 즉시 300 + 매일 90), 기행(시즌 패스), 첫 충전 2배 | **월정액 = 결제율의 핵심 입구**(저가·매일 접속 습관). 첫 충전 2배는 상품별 1회 | 과도한 가챠 의존 |
| 리니지W·오딘 | 월정액(성장·편의), 다단계 패키지, 한정 시간 팩 | 결제율보다 ARPPU를 올리는 고가 패키지는 나중 단계 | 확률형 장비 강화 판매(국내 확률 공개 의무·이용자 반발) |
| 아처로·궁수의 전설 2 | 광고 제거(단독 상품 또는 월정액 혜택), ₩1,200 내외 스타터 팩 | **광고 제거 단독 상품**은 광고 노출 이용자의 첫 결제 전환 도구. 스타터 팩은 72시간 노출 창 | — |
| 메이플스토리M·로스트아크M | 캐시 외형(남에게 보임), 시즌 패스 | 마을·파티에서 보이는 외형이 비과금 격차 없이 결제 동기를 만든다(MMO 레이어와 연결, 다음 덩어리) | — |

결론(블레이드 서지 1차 판매 4종): **광고 제거(첫 결제 입구) · 첫 구매 스타터 팩(₩1,200, 1회) · 월정액(정기 결제 비중) · 시즌 패스(시즌 바닥 매출)**. 이 4종이 결제율 1%의 레버이고, 보석 팩·외형·VIP는 유료 보석 분리와 MMO 마을이 준비된 뒤(MMO_DESIGN 6.2) 연다.

## 2. 상품 정본

정본 파일: `src/shared/iap-catalog.js`(서버·클라이언트·등록 스크립트 공용). Play 등록 정의 `store/googleplay/iap-products.json`은 카탈로그에서 생성한다.

| 상품 id | Play 유형 | 가격 후보 | 지급 | 판매 |
|---|---|---|---|---|
| `remove_ads_v1` | 일회성·비소모(acknowledge만) | ₩4,900 | 권한 `ads_removed`(영구) | 켬 |
| `starter_pack_v1` | 일회성·소모(지급 뒤 consume) | ₩1,200 | SSR 확정권 1·보석 1,000·골드 50,000, **계정당 1회** | 켬 |
| `monthly_card_v1` | 구독, 기본 요금제 `monthly`(P1M) | ₩5,900/월 | 결제 주기(성공 주문)마다 보석 1,200 + 기간 중 매일 보석 100(수령 명령) | 켬 |
| `season_pass_s1` | 일회성·비소모 | ₩9,900 | 권한 `pass:s1`, 시즌 종료(2027-01-25 00:00 KST)까지 프리미엄 줄 | 켬 |
| `hero_<id>_v1` 5종 (knight·barbarian·mage·rogue·ranger) | 일회성·비소모 (웹·Play) | ₩5,900 | 권한 `hero:<id>`(영구, 11장) | 켬(웹은 `WEB_BILLING_ENABLED` 별도) |
| `hero_all_v1` | 일회성·비소모 (웹·Play) | ₩17,900 | 권한 `hero:*` 5개 한 번에 | 켬(웹은 별도) |
| `gems_300_v1` 외 2종 | 일회성·소모 | ₩3,900~₩25,000 | 보석 | **끔**(유료 보석 분리 전) |

가격은 후보다. 근거: 스타터 ₩1,200·월정액 ₩5,900·패스 ₩9,900은 기존 `shop.js` 목업과 MMO_DESIGN 6.2 가정이고, 광고 제거 ₩4,900은 국내 캐주얼·ARPG 광고 제거 단독 상품의 흔한 구간(₩3,900~₩6,500) 중간값이다. 판매가 정본은 Play 콘솔 등록값이며, 클라이언트는 **Play가 돌려준 현지화 가격 문자열만** 표시한다(카탈로그 가격으로 대체 표시하지 않는다).

## 3. 결제 흐름

```
클라이언트(로비 상점)                       서버 /api/v1/iap                      Google Play
 GET /iap/catalog  ───────────────────▶ 판매 상품·자격(eligible)
 listCatalog(Play 가격) ◀──────────────────────────────────────────────── ProductDetails
 POST /iap/intent {productId} ────────▶ 자격·지급보류 검사, obfuscatedAccountId(난수) 발급
 purchaseCatalog(obf) ────────────────────────────────────────────────▶ 결제 시트
                                ◀──────────────────────────────────── purchaseToken
 POST /iap/verify {productId, token} ─▶ productsv2/subscriptionsv2 조회 ──▶ 상태·obf·상품
                                         obf == 이 계정 발급값? 상품 일치? 테스트 허용?
                                         D1 배치: 문서 보상 + wallet_ledger(iap:<hash>) + iap_grants
                                                  + iap_purchases + iap_entitlements + funnel(first_purchase)
                                         그 뒤 acknowledge / consume ─────▶
 ◀── grants·reversals·entitlements
 Economy.applyIapState(처음 보는 opId만 1회 반영)
```

- **지급은 서버 응답 뒤에만** 로컬에 반영한다(`Economy.applyIapState`, 적용한 opId를 세이브 `iapApplied`에 기록해 1회만).
- 보류(PENDING) 결제: 서버는 `pending`으로 기록만 하고 지급하지 않는다. 승인되면 RTDN 또는 다음 `sync()`의 재검증이 지급한다.
- 앱이 결제 직후 죽은 경우: ① 토큰은 Play `queryPurchases`에 남아 다음 로비 진입 `sync()`가 다시 verify ② RTDN이 obfuscatedAccountId로 계정을 찾아 서버에서 지급 → 클라이언트는 `/iap/state`로 받아 반영.
- ack/consume 실패: DB 지급은 확정, `acked=false`. 미확정 구매는 기기에 남으므로 다음 verify가 재시도한다. 3일 안에 끝내 ack하지 못하면 Play가 자동 환불 → 아래 환불 경로로 역분개.

## 4. 지급 규칙

1. 지급 단위 id(`grant_id` = `wallet_ledger.op_id`): 일회 상품 `iap:<sha256(play:token)>`, 구독 `iap:<token_hash>:<sha256(order:latestSuccessfulOrderId) 앞 24자>`. 같은 id는 D1 기본키·`wallet_ledger` 제약으로 두 번 들어가지 않는다(동시 요청 테스트로 확인).
2. 보상은 카탈로그 `grant`만. 클라이언트가 보낸 가격·보상·기간은 받지 않는다(알 수 없는 필드 400). 보상 키는 허용 목록(`gems, gold, ssrTicket, tickets, stones, transcendStones`) 밖이면 서버 오류로 닫는다. 골드는 VIP 배율 없이 지급한다.
3. 스타터 팩 계정당 1회는 의도(intent) 단계와 **검증 단계 둘 다에서** 강제한다. 다른 토큰으로 두 번째 구매가 성사되면(두 기기 동시 결제 등) 지급도 ack/consume도 하지 않고 `declined`로 기록한다 → Play가 3일 안에 자동 환불한다. 동시 검증 경합은 `iap_grants.once_key` UNIQUE가 한 건만 통과시킨다. 첫 구매가 환불되면 결박이 풀려 다시 살 수 있다.
4. 월정액: 성공 주문마다 1회 즉시 보석, 권한 만료 = Play `expiryTime`. 해지 예약(CANCELED)은 만료까지 유지, 유예(IN_GRACE_PERIOD)는 권한 유지·새 지급 없음, 보류(ON_HOLD)·일시정지·만료는 권한 종료. 업그레이드·재구독의 `linkedPurchaseToken` 권한은 새 토큰이 대신한다. 매일 100은 기존 `claimMonthly` 명령이 서버 권한(`monthlyUntil`)을 얹어 실행한다.
5. 시즌 패스: 권한 종료 = 시즌 종료 시각(서버 시계). 이미 달성한 단계의 프리미엄 보상도 받을 수 있다(기존 `claimPass`).
6. 테스트 구매(`testPurchaseContext`)는 `IAP_ALLOW_TEST=true`(내부 테스트 트랙)일 때만 지급, 매출·결제율 집계에서 제외(`price_krw=0`, `first_purchase` 미기록).

## 5. 환불·취소·분쟁

| 사건 | 감지 | 처리 |
|---|---|---|
| 일회 상품 환불·차지백 | RTDN `voidedPurchaseNotification`(Play `voidedpurchases`에서 같은 토큰을 확인한 뒤에만), 시간당 `voidedpurchases` 대사, verify 때 `CANCELLED` | 토큰의 미역분개 지급을 모두 되돌린다: 재화는 **0 아래로 내리지 않고** 모자란 만큼 `iap_debt` 잔액에 더함, 권한 `revoked_at`, 구매 `refunded`(이후 재지급 없음, 환불·지급 경합은 배치 가드가 원자적으로 막음) |
| 구독 한 주기 환불 | 위와 같음(주문 id 포함) | **그 주문(order_hash)의 지급만** 역분개하고, 권한은 Play `subscriptionsv2` 재조회 결과로 다시 맞춘다(아직 활성이면 유지, 조회 실패 시 지금 종료). 토큰 전체를 refunded로 고정하지 않는다 |
| 구독 해지 | `subscriptionsv2` CANCELED | 만료까지 유지, 갱신 없음 |
| 환불 남용 | 90일 안 역분개 2건 이상 | `sanctions.payout_hold` 30일 + `audit_flags` → 새 결제 시작(intent) 403 |
| 청약철회·미사용 환불 요청 | 고객 문의 | Play 콘솔에서 환불(대표님/운영자). 환불되면 위 자동 경로가 역분개 |

클라이언트는 `/iap/state`의 `reversals`(opId `void:<grant_id>`)를 1회만 반영해 같은 양을 차감한다(하한 0).

**부채 상환**: 미상환 잔액(`iap_debt`, `/iap/state`의 `debt`)은 이후 서버 지급에서 먼저 상계한다 — ① 다음 결제 지급(클라이언트에는 순 지급량만 내려가고 상환분은 `iap_grants.repaid`에 기록) ② 서버 권위 정산(`/runs/settle`, 영수증 `debtRepaid`). 상환에 쓴 지급이 다시 환불되면 그만큼 부채가 되살아난다. 그림자 모드의 로컬 획득분은 로컬이 정본이라 서버가 상계할 수 없다 → 부채 중 소비 차단은 서버 권위 컷오버와 함께(10장).

**환불 대사 커서**: 시간당 크론은 D1 `iap_meta.voided_reconciled_until`(마지막 성공 시각)에서 1시간 겹쳐 읽고, 처음이거나 오래 멈췄으면 최대 30일(voidedpurchases 보관 한도) 전부터 읽는다. 항목별 실패는 격리하고 실패가 하나라도 있으면 커서를 전진시키지 않는다. 판매를 끈 동안(`IAP_ENABLED=false`)에도 스키마·자격 증명만 있으면 대사는 돈다.

## 6. RTDN

- 엔드포인트 `POST https://blade.tllhouse.com/api/v1/iap/rtdn`(Origin 검사 예외, Pub/Sub이 호출).
- 인증: Pub/Sub push 구독의 OIDC 토큰. `aud = RTDN_AUDIENCE`(위 URL), `sub = RTDN_PUSH_SUBJECT`(푸시용 서비스 계정 고유 ID), 서명은 구글 JWKS. 토큰은 만료 전 재사용될 수 있어 발급 후 1시간까지 받는다. 설정이 비면 503(재전송)으로 닫힌다.
- 본문은 계기일 뿐: 토큰으로 Play를 다시 조회해 3장 경로로 처리한다. `messageId` 해시로 멱등. 다른 패키지·모르는 상품·계정 미결박은 200으로 기록하고 끝, 일시 오류는 503으로 재전송을 받는다.
- 처리할 수 없으면 버리지 않고 503으로 재전송을 받는다(Pub/Sub 최대 7일 재시도): 스키마·자격 증명이 없을 때, 판매를 끈 동안의 구매 알림, `voidedpurchases`에서 아직 확인되지 않은 환불 알림. 환불 알림은 판매를 꺼도 처리한다.
- 인증 전 전체 요청 한도 분당 600회(위조 요청 폭주 차단).

## 7. 결제 퍼널(D11)

단계: `install → tutorial_complete → shop_view → paysheet_open → purchase_start → first_purchase`.

- 클라이언트는 앞 4단계만 계정당 단계별 1회 `/api/v1/funnel`로 보낸다(로컬 퍼널 이벤트 재사용). `purchase_start`는 서버가 intent 때, `first_purchase`는 **서버 검증 지급 때만** 기록한다(클라이언트가 결제 성공을 주장할 수 없다).
- 저장: `funnel_milestones(account_id, step, first_at, cohort_day)`, `funnel_active(day, account_id)`. 기기·IP·자유 문자열·클라이언트 시각 없음. 계정 id는 가명(`p_…`).
- 보고서 `funnelReport(db, fromDay, toDay)`(`worker/v1/funnel.ts`): 설치 코호트 단계별 수·전환율, 기간 활성 계정, 결제자(테스트·역분개 제외), 매출, **결제율 = 결제자 ÷ 활성 계정, 목표 1%**. 운영 조회는 `tools/funnel-report.mjs`가 같은 SQL을 출력한다.

## 8. 위협 모델 요약

| 위협 | 대응 | 시험 |
|---|---|---|
| 위조·재사용 영수증(남의 토큰) | obfuscatedAccountId = 계정별 서버 난수, Play 응답 값과 일치해야 지급. 토큰 해시를 첫 소유 계정에 결박 | `남의 영수증·다른 상품·변조 토큰은 지급 0` |
| 클라이언트가 보상·가격 조작 | 보상은 카탈로그만, 알 수 없는 필드 400 | 같은 테스트 |
| 중복 지급(재전송·경합) | grant_id 기본키 + wallet_ledger op_id, CAS 배치 | `동시에 같은 토큰…`, `재전송은 멱등` |
| RTDN 위조 | OIDC 서명·aud·sub 검사 + 본문 불신(Play 재조회) | `OIDC 토큰이 없거나…` |
| 환불 후 재화 유지 | RTDN·크론·verify 3경로 역분개, 환불 토큰 재지급 금지, 남용 보류 | `voidedpurchases 대사…` |
| 테스트 구매로 무료 획득 | `IAP_ALLOW_TEST` 기본 false | `라이선스 테스트 구매…` |
| 자격 증명 유출 | 서비스 계정은 Secrets Store 바인딩(`PLAY_SA_JSON`)에서만 읽고, 토큰·제공자 오류 원문을 응답·로그에 싣지 않음. 토큰 원문 DB 미저장 | `오류 매핑…(원문 미노출)` |
| 결제 남용·API 비용 | `/iap/intent·verify` 계정당 10분 30회, `/iap/catalog·state` 분당 60회, RTDN 분당 600회 | — |
| 계정당 1회 상품 중복 지급 | 검증 단계 재확인 + once_key UNIQUE, 초과분은 ack 안 함 → Play 자동 환불 | `스타터 팩 두 번째 구매…` |
| 환불·지급 경합 | 지급 배치 안의 환불 가드(CHECK 위반으로 배치 전체 롤백) | — |
| 그림자 스냅샷이 유료 재화를 깎음/패스 중복 수령 | 정화 상한에 서버 지급분 가산, 유효 패스의 수령 기록 보존 | `그림자 스냅샷 정화와 유료 재화` |

## 9. 운영 적용 순서(코디네이터·대표님)

1. D1 `blade-surge-commerce-production`에 `worker/v1/migrations/0003_iap_funnel.sql` 적용(스키마 v3). 0003 미적용이면 결제만 `iap-schema-missing`으로 닫히고 v1 나머지는 그대로 동작.
2. 배포에 Secrets Store 바인딩 `PLAY_SA_JSON` → `apex-shared-apis/APEX_CLOUD_PLAY_SA_JSON`이 포함된다(wrangler.jsonc). 2026-10-22 Cloudflare API(읽기, 이름만)로 스토어 `apex-shared-apis`(id `3d9b8481…`)에 이 시크릿이 `active`·scope `workers`로 있음을 확인했다 — 바인딩이 배포를 깨지 않는다. 이 시크릿은 apex 프록시와 같은 공용 서비스 계정이므로 **블레이드 전용 서비스 계정(이 앱 재무 권한만) 분리는 후속**이다. 같은 서비스 계정으로 2026-10-22 읽기 프로브: `voidedpurchases` 200, 가짜 토큰 `productsv2`/`subscriptionsv2` 400(권한 있음, 토큰 무효) — 재무 데이터 권한 확인.
3. **대표님 확인 후** Play 콘솔 상품 등록: `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs`(dry-run으로 본문 확인) → `--apply --i-have-owner-approval`. 2026-10-22 현재 Play 등록 상품 0개(`oneTimeProducts`·`subscriptions` 204).
4. 내부 테스트 트랙에 이 브랜치 AAB 업로드, 라이선스 테스터로 `IAP_ENABLED=true`·`IAP_ALLOW_TEST=true` 검증(구매→지급→환불→역분개).
5. RTDN: GCP Pub/Sub 토픽 + push 구독(엔드포인트 6장, OIDC 서비스 계정) → Play 콘솔 수익 창출 설정에 토픽 등록 → `RTDN_AUDIENCE`·`RTDN_PUSH_SUBJECT` 설정 → 콘솔 "테스트 알림"으로 `test` 기록 확인.
6. 운영 개방: `IAP_ALLOW_TEST=false`, `IAP_ENABLED=true`. 가격 공개·판매 시작은 대표님 확인.

## 10. 남은 것

- 실제 기기 결제(내부 테스트 트랙 라이선스 테스터)·Play 콘솔 등록·RTDN Pub/Sub 설정 — 대표님 확인 뒤.
- 새 Java 메서드는 이 컨테이너에 Android SDK가 없어 컴파일 검증 전이다(AAB 빌드 경로 `docs/CLOUD_AAB_BUILD.md`에서 확인).
- 유료/무료 보석 분리(`gems_paid`)·무료 먼저 소비·부채 상환·부채 중 소비 차단 → 보석 팩 판매 게이트. 서버 권위 컷오버와 함께.
- 스타터 팩 72시간 노출 창·외형 상품·VIP는 다음 덩어리(MMO 마을과 함께).
- 매출 집계 `price_krw`는 카탈로그 후보가(KRW)다. 실결제 금액·통화는 Play 주문 API(orders) 연동 뒤 교체한다(테스트 구매는 0).
- 블레이드 전용 Play 서비스 계정 분리(현재 apex 공용 `APEX_CLOUD_PLAY_SA_JSON`).
- 원스토어·앱인토스 채널은 기존 `/api/store`(광고 제거) 그대로. 다상품 결제는 Google Play만.

## 11. 영웅 해금 (시작 영웅 1명 + 해금) — 수익화 1단계 레인 B

> 2026-10-24 대표님 지시: 첫 실행은 영웅 1명으로 시작, 나머지는 과금으로 열린다. **웹에서 먼저 매출, 이후 Play 출시.** 아래 가격·스위치는 모두 **후보/꺼짐**이며 **공개 전 대표님 확인**이 필요하다.
> 클라이언트의 소유 규칙·시작 영웅 선택·무료 해금 UI는 레인 A(`src/data/hero-roster.js`, 경제). 이 장은 서버 권한·결제 채널(레인 B).

### 11.1 상품과 가격 후보

| 상품 | 가격 후보 | 근거 |
|---|---|---|
| `hero_<id>_v1` (영웅 1명) | ₩5,900 | 국내 모바일 RPG 캐릭터/영웅 단품 패키지는 ₩5,000~₩12,000대가 흔하고, 기존 월정액 ₩5,900(한 달 구독)과 같은 가격대로 두어 "영구 소유 1명 = 한 달 구독 값"으로 설명된다. 시즌 패스 ₩9,900보다 낮아 첫 결제 문턱을 넘기기 쉽다 |
| `hero_all_v1` (다섯 전원) | ₩17,900 | 시작 영웅 1명은 무료이므로 실제로는 4명을 사는 상품이다. 4명 개별 합 ₩23,600 대비 **약 24% 할인**(₩5,700 절약). 패스(₩9,900)·월정액(₩5,900)과 합쳐도 단일 결제로 부담스럽지 않은 상한 |

- **웹·Play 동일가.** 가격표는 `src/shared/iap-catalog.js` 한 곳이며 서버는 클라이언트가 보낸 금액을 받지 않는다. 클라이언트는 웹에서 intent가 돌려준 서버 금액, Play에서 Play가 돌려준 현지화 가격 문자열을 표시한다.
- **수수료 차이(순매출이 다르다, 가격은 같게 둔다):** 웹은 포트원 + KG이니시스 결제 수수료(카드 대략 3% 안팎, 계약 조건 확인 필요) 뿐이고 Google Play는 연 매출 100만 달러까지 15%, 초과분 30%(구독은 15%). 같은 ₩5,900에서 웹이 순매출이 더 높으므로 "웹 먼저"가 매출에 유리하다. 가격을 달리하면(웹 할인) 스토어 정책·형평 문제가 생길 수 있어 동일가를 기본으로 한다.
- **무과금 경로:** 보석 + 캠페인 진행으로 영웅을 여는 `unlockHeroFree`는 레인 A 수치 참조(`src/data/hero-roster.js`, `docs/CONTENT_90D.md`). 이 장은 그 수치를 정하지 않는다. 유료 상품은 "시간 단축" 성격으로 유지하고, 무과금도 전원을 열 수 있어야 한다는 전제를 지킨다.
- 상품은 비소모(non_consumable) 권한이라 `hero_all_v1`을 사도 이미 가진 개별 영웅 권한이 중복 행으로 남을 뿐 문제가 없다. 전원을 가진 계정은 모든 영웅 상품이 `not-eligible`이다(웹 intent·Play intent·카탈로그 `eligible`).

### 11.2 서버 권위

- 영웅 소유의 정본은 `iap_entitlements`의 `hero:<id>` 권한이다(`summarizeEntitlements().heroes`). `grant.entitlement` 하나만 받던 구조를 `grant.entitlements`(배열)도 받도록 확장했고 기존 상품·Play 흐름은 그대로다.
- 서버는 권한이 바뀔 때마다 계정 문서의 `roster.paid`를 권한 목록으로 맞춘다: 지급 커밋 안에서(원자), 철회 직후 `syncRosterPaid`, 그리고 매 `/cmd`·`/me` 직전 `overlayEntitlements`.
- 로컬 편집으로 서버 모드의 소유가 늘지 않는다: `legacy-sanitize`(`/import`·`/shadow/snapshot`)는 클라이언트가 보낸 `roster.paid`·`owned`를 버린다.
  - `paid` = 서버 권한 그대로.
  - 정책 1(5명 소유, 기존 이용자 보호)은 서버 문서가 이미 정책 1이거나, 원본에 roster가 없고(또는 정책 1이고) `save.created < HERO_GRANDFATHER_BEFORE_MS`일 때만. 그 밖에는 정책 2 + 시작 영웅 1명(서버가 기억하는 선택 > 원본 시작 영웅 > 원본 selected > knight) + 서버 문서가 이미 가진 owned.
  - `HERO_GRANDFATHER_BEFORE_MS`(wrangler var) 기본값 `1792886400000` = `Date.UTC(2026, 9, 25)`(이번 배포 예정일 추정). **개방(배포) 시점에 실제 배포 시각으로 갱신한다.** 값이 없거나 잘못되면 정화 모듈의 같은 기본값을 쓴다.
- 환불·취소로 권한이 빠지면 `paid`에서 빠지고 영웅 데이터(레벨·장비)는 그대로 둔다(잠금만 다시 걸림, 레인 A가 선택 영웅을 시작 영웅으로 되돌림).

### 11.3 웹 결제 채널 (포트원 V2)

```
브라우저                           서버 /api/v1/iap/web                      포트원
 POST /intent {productId} ───────▶ 판매·채널·미보유·보류 검사
                         ◀─────── paymentId(서버 생성)·금액(카탈로그)·storeId·channelKey·orderName·customData
 requestPayment(SDK, redirectUrl)  ───────────────────────────────────────────▶ 결제창
 POST /complete {paymentId} ─────▶ GET /payments/{id}  (Authorization: PortOne <시크릿>) ─▶ 단건 조회
                                   status=PAID · amount.total=카탈로그가 · KRW · storeId · 채널 · customData · 내 의도
                                   → grantOnce(원장 op_id 'iap:<sha256(portone:paymentId)>', 권한, roster.paid) ──▶ 응답(grants·entitlements)
```

- **지급 근거는 서버의 포트원 조회뿐**이다. 결제 금액은 브라우저가 결제창에 넘기므로 PAID여도 금액·통화·storeId·채널이 서버 의도와 한 글자라도 다르면 지급하지 않고 의도를 `failed`로 만들고 `audit_flags`(`web-payment-mismatch`)를 남긴다(돈이 나갔으므로 사람이 취소해야 한다. 취소 API는 코드에 없다).
- 멱등: 같은 paymentId를 몇 번·동시에 보내도 `wallet_ledger.op_id` 유일성과 `iap_grants` 선검사로 한 번만 지급(동시 3건 테스트). 남의 paymentId·서버가 발급하지 않은 paymentId는 같은 404(`payment-unknown`).
- 저장: 새 표 `iap_web_payments`(마이그레이션 `0004_web_payments.sql`, 스키마 v4)가 paymentId ↔ 계정·상품·금액·storeId·채널을 결박한다. 지급·권한·원장은 Play와 같은 `iap_purchases`/`iap_grants`/`iap_entitlements`/`wallet_ledger`를 재사용한다(키 접두사 `portone:`).
- **취소 회수:** `complete` 때 CANCELLED/PARTIAL_CANCELLED가 보이면 권한 철회·지급 역분개·`roster.paid` 회수. 시간당 크론(`17 * * * *`)이 최근 30일 지급분을 다시 조회해 취소를 회수하고, 최근 48시간의 미완료 의도(결제창에서 결제했지만 `complete`가 안 온 경우: 탭 종료·리다이렉트 실패)가 PAID면 지급한다. 한 번에 최대 25건만 조회(호출 수 상한, 가장 오래 안 본 건부터, 실패 항목도 순서를 뒤로 보낸다). 판매 스위치를 꺼도 회수는 계속 돈다. 취소된 결제는 이후 조회가 PAID로 보여도 다시 지급하지 않는다.
- 남용 방어: 계정당 시간당 열린 의도 10건, `/iap/*` 속도 제한 공유(10분 30회), 지급 보류(`payout_hold`) 계정은 intent 거부, 환불 남용 감지는 Play와 같은 `abuseCheck`.
- 중복 결제(동시 의도 두 건 결제 등)는 지급·회수는 정상이지만 `audit_flags`(`web-duplicate-payment`)로 표시해 사람이 환불하게 한다.
- 클라이언트: `src/platform/hero-purchase.js`가 `app.heroPurchase = { available(), buy(productId) }`를 제공한다. 웹 채널에서 서버가 `/me` flags.`webBilling`을 알렸을 때만 `available()`=true(기본 false). 성공(`ok:true`)은 서버 complete가 granted/already였고 `applyIapState` 저장이 성공한 뒤에만. Play 채널은 기존 `billing-service`로 위임. SDK는 `https://cdn.portone.io/v2/browser-sdk.js`를 동적으로 불러온다(npm·lock 변경 없음). 모바일 리다이렉트 복귀·끊긴 결제는 `resume()`이 보류 paymentId로 `complete`를 다시 보낸다(보류는 localStorage, 48시간).
- CSP: 지금 배포에는 CSP 헤더가 없다. 도입한다면 `script-src https://cdn.portone.io`와 포트원 결제창 iframe/PG 도메인 허용이 필요하다.

### 11.4 서버 스위치·설정 (모두 기본 꺼짐)

| 이름 | 값 | 의미 |
|---|---|---|
| `V1_ENABLED` | `false` | 기존. 꺼지면 `/api/v1` 전체 503 |
| `IAP_ENABLED` | `false` | 기존. Play 결제 판매. **웹 결제와 독립** |
| `WEB_BILLING_ENABLED` | `false` | 웹 결제 스위치. 꺼지면 `/iap/web/*` 전부 503(`web-billing-disabled`), `flags.webBilling=false` |
| `PORTONE_STORE_ID` | `store-75d3b0fa-…` | 비밀 아님 |
| `PORTONE_CHANNEL_KEY` | `""` | 실결제 채널 키(비밀 아님). **비어 있으면 intent 거부**(`web-not-configured`) |
| `PORTONE_TEST_CHANNEL_KEY` | `channel-key-2ec7…` | `IAP_ALLOW_TEST=true`일 때만 사용. 이름이 '신기충만 - KG이니시스 테스트'라 실결제 채널로 쓰지 않는다. 테스트 지급은 매출 0·퍼널 '첫 결제' 제외 |
| `PORTONE_API_SECRET` | Secrets Store | `apex-shared-apis/APEX_CLOUD_PLAY…`와 같은 스토어의 `APEX_CLOUD_PORTONE_API_SECRET`. 조회(GET)에만 사용, 값은 로그·응답에 나가지 않는다 |
| `HERO_GRANDFATHER_BEFORE_MS` | `1792886400000` | 11.2. 개방 시점에 갱신 |

닫히는 순서(fail-closed): 스위치 → D1 스키마 v4 → 시크릿 바인딩 → storeId·채널 키.

### 11.5 환불·회수 정책

- 웹: 포트원 콘솔/PG에서 사람이 취소하면(코드는 취소를 호출하지 않는다) 다음 `complete` 또는 시간당 크론이 CANCELLED/PARTIAL_CANCELLED를 보고 영웅 권한을 회수한다. 부분 취소도 전체 회수(보수적).
- Play: 기존 환불 대사(`voidedpurchases`·RTDN)가 그대로 `hero:*` 권한을 철회한다(`reverseToken`이 `roster.paid`도 맞춘다).
- 회수는 잠금만 다시 건다. 성장 데이터는 지우지 않으므로 재구매하면 그대로 복원된다.

### 11.6 남는 위험 (정직하게)

1. **`save.created` 위조로 정책 1(5명 무료) 주장 가능.** 기준은 클라이언트가 보내는 로컬 세이브의 `created`뿐이고, 서버가 계정을 만든 시각은 V1 개방 전이라 모든 계정이 기준 시각 이후여서 쓸 수 없다. 완화: 계정당·설치당 1회 임포트, 서버 문서가 이미 진행됐으면(rev>1) 임포트 거부, 서버 문서가 한 번 정책 2로 확정되면 정책 1로 돌아가지 못함, 기준 시각을 배포 시각에 맞춰 앞으로 갈수록 의미가 줄어듦. 완전한 차단은 불가능하며(웹 로컬 세이브는 조작 가능) 영향은 "무료로 영웅 4명 추가"에 한정된다. 필요하면 개방 시점에 로컬 세이브에 서버 서명 기한 토큰을 심는 후속 안을 검토한다.
2. 그림자 모드(로컬이 정본) 동안 로컬 `paid`·무료 해금은 서버 문서에 반영되지 않는다. 컷오버 시 서버 `unlockHeroFree`로 다시 열거나 보석을 환급해야 할 수 있다(레인 A와 합의 필요).
3. 웹 결제 금액 변조는 지급 단계에서 막지만 PG에서는 이미 결제가 끝나 있다. 사람이 취소해야 한다(`audit_flags` 확인). 취소 API 자동화는 이번에 만들지 않았다.
4. 포트원 조회 API 장애 시 `complete`는 502, 크론은 건너뛰고 다음 시간에 다시 시도한다. 그동안 취소 회수가 늦는다(최대 ~1시간 + 장애 시간).
5. 크론 상한(25건/시간)보다 30일 지급분이 많아지면 한 건을 다시 보는 간격이 길어진다. 매출이 늘면 상한·간격을 조정한다.
6. 포트원 웹훅은 이번에 넣지 않았다(웹훅 시크릿 없음). 크론 + `complete`로 대신한다.
7. 가격·수수료 근거는 공개 정보 기반 추정이다. 실제 계약 수수료와 대표님 최종 금액으로 교체한다.

### 11.7 개방 순서 (코디네이터·대표님)

1. D1 `blade-surge-commerce-production`에 `0004_web_payments.sql` 원격 적용(스키마 v4). 미적용이면 웹 결제만 `web-schema-missing`으로 닫힘(Play·나머지 v1은 그대로).
2. 포트원 콘솔에서 **실결제 채널**(KG이니시스 실연동)을 만들고 채널 키를 `PORTONE_CHANNEL_KEY`에 설정. 시크릿 `APEX_CLOUD_PORTONE_API_SECRET` 바인딩이 배포에 포함됐는지 확인.
3. `HERO_GRANDFATHER_BEFORE_MS`를 실제 배포 시각으로 갱신.
4. 테스트 채널 + `IAP_ALLOW_TEST=true`로 내부 결제(구매→지급→포트원 콘솔 취소→회수) 한 번 확인.
5. `WEB_BILLING_ENABLED=true`. 단, **가격(₩5,900 / ₩17,900)과 상품 문구를 대표님이 확인한 뒤에만 공개.**
6. 이후 Play: `tools/play-iap-register.mjs`가 영웅 6종도 등록 대상에 포함한다(dry-run으로 확인 → 대표님 확인 후 `--apply`).
