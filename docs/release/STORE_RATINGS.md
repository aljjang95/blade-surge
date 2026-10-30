# 스토어 등급·앱 콘텐츠·인앱 상품 기록 — 블레이드 서지

> 레인 `store-rating#1` · 2026-10-30 · 앱 `com.theluxurylord.bladesurge`(Play 앱 ID 4972354349803875793, 개발자 계정 "The Luxury Lord" 7448740095720525626). 답안 원본: [IARC_ANSWERS.md](IARC_ANSWERS.md), 판정: [RATING_DECISION.md](RATING_DECISION.md). 스크린샷은 커밋하지 않는다(릴레이 화면 캡처는 파일로 저장되지 않아 이번엔 없음).

## 1. 결과 요약

| 스토어 | 항목 | 상태 | 등급 / 인증 ID | 시각(UTC) |
|---|---|---|---|---|
| Google Play | 콘텐츠 등급(IARC) | ⛔ **대표님 대기** — 설문 1단계에 'IARC 이용 약관 동의' 필수 체크박스와 연락 이메일 칸(비어 있음)이 있어 멈춤. 아무것도 저장하지 않음 | 없음 | 2026-10-30 13:2x 확인 |
| Google Play | 개인정보처리방침·로그인 세부정보·타깃층·데이터 보안·광고 ID·정부/금융/건강 앱 | 🟡 작성 중 한도로 중단 — 마지막 동작이 어느 선언의 저장 버튼 직전. **어느 선언이 저장됐는지 미확인**(다음 세션에서 readText로 확인) | — | 2026-10-30 14:2x |
| Google Play | 인앱 상품 등록 | ⛔ API 403 `The caller does not have permission`(onetimeproducts PATCH). 읽기(GET·edits)는 됨 | — | 2026-10-30 13:0x |
| 원스토어 | 앱 상태·자체등급분류(IARC) | ⛔ **대표님 대기** — 금고 쿠키는 있으나 ONEconsole 서버 로그인 만료(로그인 폼, 계정 `tllhouse`) | 없음 | 2026-10-30 13:1x |

## 2. Google Play 상세

### 2.1 IARC — 대표님 할 일 (약 5분)
1. Play Console → 블레이드 서지 → 정책 → 앱 콘텐츠 → 콘텐츠 등급 → 설문지 시작.
2. 이메일: 개발자 계정 연락 이메일. 'IARC 이용 약관 동의' 체크(약관 동의라 에이전트가 하지 않음).
3. 이후 문항은 [IARC_ANSWERS.md](IARC_ANSWERS.md) 표대로(에이전트가 이어서 입력 가능 — 체크만 해 두시면 됨).
4. 제출 뒤 한국(GRAC)·ESRB·PEGI 등급과 **IARC 인증 ID**를 이 표에 기록. 원스토어 ONEconsole은 다른 스토어의 IARC 인증 ID 등록을 받으므로 같은 ID로 원스토어 등급도 처리할 수 있다.

참고: 앱 콘텐츠 목록에서 콘텐츠 등급 버튼은 '선언 수정'으로 보였으나 설문은 신규 시작 상태였다(기존 등급 유무 미확인).

### 2.2 앱 콘텐츠 답안(지휘 확정, 코드 근거)
| 선언 | 답 | 근거 |
|---|---|---|
| 개인정보처리방침 | https://blade.tllhouse.com/privacy.html | public/privacy.html |
| 로그인 세부정보 | 특별한 액세스 없이 전 기능(게스트 로그인) | 게스트·Google 연동 |
| 광고 포함 | 예 | AdMob 전면 광고 SDK(android/app/build.gradle), 서버 스위치 `BLADESURGE_*_ADS_ENABLED`로 켜짐(worker/store.ts) |
| 광고 ID | 사용 — 광고 또는 마케팅 | AdMob·UMP |
| 타깃층 | 16~17세, 18세 이상 | 국내 15세 판정과 어긋나지 않게 보수적으로(13~15 구간엔 14세 이하 포함). 대안: 13~15 추가 |
| 정부·금융·건강 앱 | 아니요 / 해당 없음 | |
| 데이터 보안 | 아래 표 | |

| 데이터 유형 | 수집 | 공유 | 필수/선택 | 목적 |
|---|---|---|---|---|
| 사용자 ID(계정 id·로그인 해시·닉네임) | 예 | 아니요 | 필수 | 앱 기능·계정 관리·보안 |
| 이름·이메일 등 | 아니요 | | | Google 연동은 식별자 해시만 저장 |
| 구매 기록 | 예 | 아니요 | 선택 | 앱 기능·보안 |
| 앱 내 메시지(채팅·DM·게시글) | 예 | 아니요 | 선택 | 앱 기능 |
| 앱 상호작용(퍼널·진행) | 예 | 아니요 | 필수 | 앱 기능·분석 |
| 진단(제보 첨부·AdMob) | 예 | 예(AdMob) | 선택 | 앱 기능·분석·광고 |
| 기기 또는 기타 ID(광고 ID) | 예 | 예(AdMob) | 선택 | 광고 |
| 대략적 위치(AdMob IP 지역) | 예 | 예(AdMob) | 선택 | 광고 |
전송 중 암호화 예(usesCleartextTraffic=false), 삭제 요청 예(앱 설정 회원 탈퇴, support.html). 미확인: 빌드 산출물의 병합 권한(AD_ID 포함 여부, `aapt dump permissions`).

### 2.3 인앱 상품
- 서비스 계정 `apex-cloud-play@cloudtarot-android.iam.gserviceaccount.com`은 이 앱에 이미 11개 권한('주문 및 구독 관리' 포함, '앱 정보 관리'는 계정 수준 상속)이 있다. 그런데도 PATCH가 403이므로, 클라우드 Play 프록시(`PLAY_SA_JSON`)가 **다른 서비스 계정**일 가능성이 높다(사용자 및 권한의 다른 서비스 계정 6개는 열어보지 않음). 다음: 프록시 SA 이메일을 PC `admin.ps1`·Secrets Store 기록에서 확인 → 그 계정에 이 앱 한정 '스토어 등록정보 관리'+'주문 및 구독 관리'.
- 권한이 생기면: `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --apply --i-have-owner-approval --register-only` — 활성화 요청 없이 8개 생성(remove_ads 4,900 · starter 1,200 · monthly_card 5,900(기본 요금제 DRAFT) · season_pass_s1 9,900 · growth_pack 12,000 · 보석 300/980/1,980 = 3,900/12,000/22,000). 영웅·아바타·웹 전용은 제외. 판매 시작(활성화)은 대표님 금액 확인 뒤.

## 3. 원스토어
- 대표님 할 일: 클라우드 데스크톱 브라우저에서 ONEconsole(계정 `tllhouse`) 로그인 한 번 → 에이전트가 `apex vault capture onestore` 후 앱 상태 확인·등급 진행.
- 등급 절차(공식 개발자 가이드, 2026-10-30 확인): ONEconsole에서 IARC 설문 작성, 또는 **다른 스토어에서 받은 IARC 인증 ID 등록**([IARC](https://onestore-dev.gitbook.io/dev/docs/apps/product/common-info/age-rating/iarc)). 원스토어가 자체등급분류사업자라는 점은 2차 출처(기사)만 확인.
- 결제(공식 가이드): ONE store IAP(수수료 20%, 중소 감면 50%) 또는 **외부결제**(개발사 PG 직접 연동, 수수료 5%, 거래내역 전송 API·구매ID 안내 의무)가 모두 허용된다. **결제 방식은 최초 상품 등록 때만 고를 수 있고 이후 변경·재등록 전환 불가**([외부결제](https://onestore-dev.gitbook.io/dev/tools/billing/billing_3rd-party), [FAQ](https://onestore-dev.gitbook.io/dev/help/faq/apps), [수수료](https://onestore-dev.gitbook.io/dev/docs/payment/service_fee/korea)). 현재 onestore flavor는 IAP SDK 21.04.00 → IAP 경로가 기본. 외부결제를 원하면 상품 등록 전에 결정.
- 참고: ONEconsole 공지에 2026-10-30 개발자센터 이용약관·소프트웨어 판매약관 개정 안내가 있다(동의 화면은 열지 않음).

## 4. `src/data/game-rating.js` 채널별 값(payment-readiness 레인 반영용)
- 아직 확정된 스토어 등급 없음: play·onestore 모두 `status: 'pending'`. IARC 제출 뒤 한국 등급·IARC 인증 ID를 채운다.
