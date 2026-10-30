# 스토어 등급·앱 콘텐츠·인앱 상품 기록 — 블레이드 서지

> 레인 `store-rating#1` · 2026-10-30 · 앱 `com.theluxurylord.bladesurge`(Play 앱 ID 4972354349803875793, 개발자 계정 "The Luxury Lord" 7448740095720525626). 답안 원본: [IARC_ANSWERS.md](IARC_ANSWERS.md), 판정: [RATING_DECISION.md](RATING_DECISION.md). 스크린샷은 커밋하지 않는다(릴레이 화면 캡처는 파일로 저장되지 않아 이번엔 없음).

## 1. 결과 요약 (2026-10-31 갱신)

| 스토어 | 항목 | 상태 | 등급 / 인증 ID | 시각(UTC) |
|---|---|---|---|---|
| Google Play | 콘텐츠 등급(IARC) | ✅ 설문 작성·저장(대표님 채팅 지시 "전부 너가해줘"로 IARC 이용 약관 동의, 연락 이메일 aljjang95@gmail.com). 게시 개요에 '새 설문지 제출'로 대기 | **한국 GRAC 12세 이상**(폭력성·확률형 아이템) · ESRB Everyone 10+(판타지 폭력·가벼운 유혈) · PEGI 12 · IARC 일반 12+ · USK 12 · 대만 15+ · 사우디 12 · 호주 '성인'(M) · 브라질 18+(확률형 구매). **IARC 인증 ID는 Google 검토 전송 뒤 발급** — 아직 없음 | 2026-10-30 15:0x |
| Google Play | 개인정보처리방침·로그인 세부정보·광고 ID·정부/금융/건강 앱·타깃층(16~17, 18+)·데이터 보안 | ✅ 모두 저장(앱 콘텐츠 '주의 필요' 0개) | — | 2026-10-30 15:1x |
| Google Play | 검토 전송 | ⛔ 게시 개요가 "앱 대시보드 필수 단계를 완료해야 전송 가능"으로 잠김 — 내부 테스트 AAB 등 앱 설정 단계 남음(이 레인 범위 밖, production 금지) | — | |
| Google Play | 인앱 상품 등록 | ⛔ API 403 `The caller does not have permission`. 콘솔의 일회성 제품 화면은 정상(결제 프로필 문제 아님) → 클라우드 Play 프록시(`PLAY_SA_JSON`)가 쓰는 서비스 계정에 이 앱의 '스토어 등록정보 관리' 권한이 없는 것으로 판단 | — | 2026-10-30 13:0x |
| 원스토어 | 앱 상태·자체등급분류(IARC) | ⛔ **대표님 로그인 대기** — 금고 쿠키는 있으나 ONEconsole 서버 로그인 만료(계정 `tllhouse`, 비밀번호 입력은 대표님만) | 없음 | 2026-10-30 13:1x |

**판정 메모:** RATING_DECISION.md는 15세를 신청 기준으로 정했다. IARC 결과는 한국 12세로 나왔다. 계획대로 표기는 더 높은 쪽(15세)에 맞추는 원칙을 유지한다. 게임위 결정서를 받은 뒤 다시 검토한다. Play 스토어에는 IARC 결과(12세)가 자동으로 표시된다.

**설문에서 보수적으로 고른 답(기록):** 사람처럼 행동하는 판타지 생물 '예'(해골·골렘), 실존 동물 대상 폭력 '예'(늑대 몬스터), 폭력 관련 험악한 소리·어두운 색채 '예', 폭력 묘사는 '멀리서 잦음', 선혈은 '가벼움/제한적'으로 답했다. 채팅 관련 답은 차단 예·신고 예·채팅 중재(금칙어) 예·친구 전용 아님이다. 데이터 보안의 계정 생성 방식은 OAuth(Google 연동)로 답했다. 게스트 계정은 기기에서 자동으로 만들어져 사용자가 직접 만드는 계정이 아니므로 '기타'에서 뺐다.

## 2. Google Play 상세

### 2.1 IARC — (완료, 아래는 기록용 원래 절차)
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
| 타깃층 | 16~17세, 18세 이상(저장됨) | 국내 15세 판정과 어긋나지 않게 보수적으로(13~15 구간엔 14세 이하 포함). 대안: 13~15 추가 |
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
- 2026-10-31 재확인: `apex-cloud-play@…`의 블레이드 서지 권한 창에서 **'앱 정보 관리'(인앱 상품 관리 포함)가 계정 권한으로 부여돼 있음**(회색 체크 = 계정 권한 상속). 프록시는 블레이드 서지·등불·카롬·바둑 리뷰 GET이 모두 200(계정 수준 읽기 권한). 따라서 "앱 권한 부족" 가설은 약하고, ① 프록시 `PLAY_SA_JSON`이 다른 계정(예: `play-console-cli@apex-hub-501808`)이거나 ② 새 monetization API 쪽 다른 원인일 수 있다. 다음: PC에서 `PLAY_SA_JSON`의 client_email(공개 식별자)만 확인 → 그 계정 권한 비교. 세션 권한 정책이 실제 상품 생성 재시도를 막아 이 세션에서는 추가 시도하지 않음.
- 서비스 계정 `apex-cloud-play@cloudtarot-android.iam.gserviceaccount.com`은 이 앱에 이미 11개 권한('주문 및 구독 관리' 포함, '앱 정보 관리'는 계정 수준 상속)이 있다. 그런데도 PATCH가 403이므로, 클라우드 Play 프록시(`PLAY_SA_JSON`)가 **다른 서비스 계정**일 가능성이 높다(사용자 및 권한의 다른 서비스 계정 6개는 열어보지 않음). 다음: 프록시 SA 이메일을 PC `admin.ps1`·Secrets Store 기록에서 확인 → 그 계정에 이 앱 한정 '스토어 등록정보 관리'+'주문 및 구독 관리'.
- 권한이 생기면: `NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --apply --i-have-owner-approval --register-only` — 활성화 요청 없이 8개 생성(remove_ads 4,900 · starter 1,200 · monthly_card 5,900(기본 요금제 DRAFT) · season_pass_s1 9,900 · growth_pack 12,000 · 보석 300/980/1,980 = 3,900/12,000/22,000). 영웅·아바타·웹 전용은 제외. 판매 시작(활성화)은 대표님 금액 확인 뒤.

## 3. 원스토어
- 대표님 할 일: 클라우드 데스크톱 브라우저에서 ONEconsole(계정 `tllhouse`) 로그인 한 번 → 에이전트가 `apex vault capture onestore` 후 앱 상태 확인·등급 진행.
- 등급 절차(공식 개발자 가이드, 2026-10-30 확인): ONEconsole에서 IARC 설문 작성, 또는 **다른 스토어에서 받은 IARC 인증 ID 등록**([IARC](https://onestore-dev.gitbook.io/dev/docs/apps/product/common-info/age-rating/iarc)). 원스토어가 자체등급분류사업자라는 점은 2차 출처(기사)만 확인.
- 결제(공식 가이드): ONE store IAP(수수료 20%, 중소 감면 50%) 또는 **외부결제**(개발사 PG 직접 연동, 수수료 5%, 거래내역 전송 API·구매ID 안내 의무)가 모두 허용된다. **결제 방식은 최초 상품 등록 때만 고를 수 있고 이후 변경·재등록 전환 불가**([외부결제](https://onestore-dev.gitbook.io/dev/tools/billing/billing_3rd-party), [FAQ](https://onestore-dev.gitbook.io/dev/help/faq/apps), [수수료](https://onestore-dev.gitbook.io/dev/docs/payment/service_fee/korea)). 현재 onestore flavor는 IAP SDK 21.04.00 → IAP 경로가 기본. 외부결제를 원하면 상품 등록 전에 결정.
- 참고: ONEconsole 공지에 2026-10-30 개발자센터 이용약관·소프트웨어 판매약관 개정 안내가 있다(동의 화면은 열지 않음).

## 4. `src/data/game-rating.js` 채널별 값(payment-readiness 레인 반영용)
- 아직 확정된 스토어 등급 없음: play·onestore 모두 `status: 'pending'`. IARC 제출 뒤 한국 등급·IARC 인증 ID를 채운다.

## 5. 원스토어 우선 전략 (지휘 2026-10-31) — 근거와 준비 상태

### 5.1 카롬 마스터 선례 (aljjang95/carom-master, 2026-10-31 확인)
- `public/legal/game-info.html`: 이용등급 "전체이용가 — **원스토어 IARC 대한민국 결과**"를 표시한다. 등급분류 경로는 "원스토어 IARC · 대한민국(KR)", IARC 인증 ID는 `7b6a5e95-a731-8010-8150-3f8dc1e042f7`(발급 2026-09-08)이다. 같은 페이지에 "GRAC 직접 심사 번호는 별도로 기재하지 않습니다. 위 IARC 인증 ID는 GRAC 직접 심사 번호가 아닙니다."라고 적혀 있다.
- `docs/RELEASE-CHECKPOINT-20260909.md`: 원스토어에서 받은 등급을 다른 채널(토스)에 재사용하는 것을 전제로, 기존 IARC 인증 ID·발급일·상품 ID로 증빙 방법을 문의했다(새 등급분류 신청 아님).
- `docs/BUSINESS.md`, `docs/PORTONE-OPERATIONS.md`: KG 추가 MID 신청과 정식 릴리스 전 게이트로 "게임제작업·배급업 등록 + 등급분류·표시"를 둔다. `scripts/release-gates.ts`는 `ratingAuthority`로 `IARC` 또는 `GRAC`를 허용한다.
- **결론:** 카롬은 원스토어 IARC 결과와 IARC 인증 ID로 웹 등급 표시와 KG MID 준비를 했다. 블레이드 서지도 같은 경로가 가능하다. 다만 RATING_DECISION.md 3장(직접 운영하는 웹은 자체등급분류 대체 불가라는 해석)과 충돌하므로, 이 해석 차이는 지휘·대표님 결정으로 기록한다. 카롬은 GRAC 직접 번호가 아니라고 명시해 표시했다.

### 5.2 등급 번호를 받는 가장 빠른 길
- 원스토어 공식 가이드: ONEconsole에서 IARC 설문을 직접 작성하거나, **다른 스토어에서 받은 IARC 인증 ID를 등록**할 수 있다.
- Play IARC 설문은 이미 저장했다(한국 12세). 인증 ID는 Play 검토 전송 뒤에 발급되는데, 검토 전송은 대시보드 필수 단계 때문에 잠겨 있다. 그래서 **원스토어에서 직접 설문하는 쪽이 더 빠르다.** 같은 IARC 엔진이라 한국 결과는 12세가 나올 것으로 예상한다.
- 15세 신청 원칙과의 관계: IARC 결과는 문항 답으로 정해진다. 원하는 등급을 직접 고를 수 없다. 사실대로 답하면 12세가 나온다. 표시를 15세로 올리는 것은 사업자 판단이고, 15세로 표시하는 것은 허용된다(높은 쪽).

### 5.3 원스토어 출시용 서명 (확인 결과)
- 서명 금고에 `BLADESURGE_ONESTORE`가 **없다**. 원스토어 키는 BADUK_ONESTORE·HLB_ACADEMY_ONESTORE·SINGICHUNGMAN_ONESTORE·TLLREMOTE_RELEASE뿐이다. 또 APK 서명 허용 목록은 `BADUK_ONESTORE`만 있다(75-cloud-session).
- 필요한 일:
  1. PC에서 `admin.ps1 -AddSigning BLADESURGE_ONESTORE -SigningAlias bladesurge-onestore`로 업로드 키를 생성한다.
  2. apex-skill-forge `claude/cloud/broker/signer`의 APK 허용 목록에 `BLADESURGE_ONESTORE → com.theluxurylord.bladesurge`를 추가하는 PR을 낸다.
  3. `-DeploySigner`를 실행한다.
  4. 출시 APK마다 `-ApproveRelease <패키지> -ApproveSha256 <해시>`로 1회용 승인을 받는다.
- 등급 설문 자체는 바이너리 없이 앱 등록만으로 진행할 수 있다(원스토어 가이드상 상품 기본 정보 단계). 그래서 서명 키는 등급과 병렬로 준비하면 된다.

### 5.4 지금 막힌 것
- ONEconsole 로그인 만료. 대표님이 클라우드 데스크톱에서 `tllhouse` 계정으로 로그인 한 번 하면 된다. 그 뒤 앱 등록 확인 → (없으면) 앱 등록 → IARC 설문 순서로 진행한다.

### 5.5 지휘 결정 (2026-10-31)
- 카롬 선례대로 진행한다. **원스토어 IARC 인증 ID로 웹 등급을 표시하고 KG MID를 준비한다.** 등급은 IARC 결과(12세)를 그대로 쓴다.
- RATING_DECISION 3장 해석(직접 운영 웹은 자체등급분류로 대체할 수 없음)과 다르다. 이 차이는 **위험 '중'**으로 남긴다. 게임위/GCRB 서면 질의 초안은 web-rating 레인이 맡는다.
- 원스토어 IARC는 직접 설문으로 받는다. 서명 키는 apex-skill-forge 레인이 맡는다. 이 레인은 앱 등록과 IARC 설문까지만 맡는다.
- 로그인은 지휘 세션의 클라우드 데스크톱에서 받는다. 로그인되면 지휘 세션이 `apex vault capture onestore`로 금고를 갱신한 뒤 이 레인에 알린다.

## 6. Play 내부 테스트 AAB (2026-10-31)
- 빌드: versionCode **4** / versionName 1.0.4. 서명 없는 googleplay 릴리스(docs/CLOUD_AAB_BUILD.md 절차), 132,415,568 B, sha256 `cc46e4d586566e8db64a2c497f07f54b8de7306feb39f1440bc600834a601c3b`. Play에 올라간 최댓값은 3이었다.
- 업로드: `apex play … BLADESURGE_PLAY internal`를 2회 시도했고 둘 다 `503 signer_busy`로 실패했다. 응답의 `holdingBytes:0`, `requestBytes:142,901,328`로 보아, 다른 요청이 점유한 것이 아니라 **서명기 요청 본문 한도(약 100MB) 초과**로 판단한다.
- 다음(출시 레인 claude/app-release 범위): AAB 축소(Play Asset Delivery 팩 분리 또는 에셋 압축), 서명기 한도 상향, PC 업로드 중 하나를 고른다. 내부 트랙 업로드가 끝나야 대시보드 단계를 마치고 검토 전송 → IARC 인증 ID 발급으로 이어진다.
