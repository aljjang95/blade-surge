# Blade Surge BM 설계 — Google Play 결제·상품·지급·환불·퍼널 (D10a·D10b·D11)

> 2026-10-22 · 브랜치 `claude/blade-bm-billing` · 기준 `docs/MMO_DESIGN.md` 3.4.4·6장, `docs/COMMERCE-SERVER-CONTRACT-20260923.md` 8개 요구.
> 이 문서는 **설계와 구현 경계**다. Play 콘솔 상품 등록·가격 공개·실제 구매·운영 활성화(`IAP_ENABLED=true`)는 하지 않았다(대표님 확인 사항).

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
