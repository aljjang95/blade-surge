# Google Play 프로덕션 출시 준비 (2026-10-31)

레인 app-release#1. 대표님 지시(2026-10-31 "앱결제·앱광고까지 받아서 출시")가 Play production 출시 요청을 겸한다. production 트랙은 PC 1회용 승인(`admin.ps1 -ApproveRelease com.theluxurylord.bladesurge -ApproveSha256 <서명 전 AAB sha256>`) 없이는 서명·Play 프록시가 막는다(75-cloud-session).

## 1. 현재 상태 (API readback 2026-10-31 05:48 KST)

| 항목 | 상태 | 근거 |
|---|---|---|
| 내부 테스트 트랙 | ✅ versionCode 5 (1.0.5) completed | edits.tracks/internal readback |
| production·alpha·beta | 비어 있음 | 같은 readback |
| 앱 콘텐츠(IARC 12+, 데이터 보안, 광고 ID, 타깃층, 개인정보) | ✅ 저장 | docs/release/STORE_RATINGS.md |
| **스토어 등록정보** | ⛔ **제목만 있음**: 짧은/전체 설명·아이콘·피처 그래픽·스크린샷 0장, 연락처 미설정 | edits.listings/ko-KR, images readback |
| 인앱 상품 4종 | ⛔ 0개(API 403 → 지휘가 콘솔 UI로 등록 중) | `tools/play-iap-register.mjs --probe` |
| 원격 자산(호스트) | ✅ 622/622, problems 0(앱 매니페스트 기준) | `tools/check-remote-assets.mjs` |
| 결제·광고 서버 스위치 | 🟡 PR #474 draft(IAP_ENABLED·AdMob) | |
| RTDN | ⛔ 미설정(시간당 voided 대사가 안전망) | wrangler `RTDN_*` 비어 있음 |

## 2. 스토어 등록정보 — 준비본은 있음, 업로드만 남음

`store/googleplay/`에 준비본이 있다(2026-10-29 커밋): ko-KR·en-US 제목·짧은 설명·전체 설명(확률형 아이템 포함 문구), 아이콘 512, 피처 1024x500, 휴대폰·7인치·10인치 스크린샷 각 8장. 업로드 도구 `bash tools/play-listing-upload.sh [--dry-run]`(연락처 웹 https://blade.tllhouse.com, 이메일, 문구, 이미지 교체 후 edit commit).

스크린샷 최신화 판단: 장면(타이틀·로비·전투·보스 궁극기·원정 결과·지도·영웅 장비·장비 상세)은 10-29 빌드 기준이다. 그 뒤 바뀐 것은 무기 GLB 스트리밍(외형 같음)·결제 화면 문구라 장면 의미는 그대로다. 상점·결제 확인 창 스크린샷은 포함돼 있지 않다. → **지금 준비본으로 올리고**, 결제 개방 뒤 상점 장면 1장 추가를 후속으로 둔다.

## 3. 출시 노트 (ko-KR, 500자 이내)

```
블레이드 서지 정식 출시!
· 영웅 수집, 20개 던전, 보스전 궁극기
· 원정·장비 강화·각인으로 나만의 빌드
· 첫 구매 스타터 팩, 광고 제거, 시즌 1 패스, 월정액
· 일부 그래픽은 처음 접속 때 내려받습니다(와이파이 권장)
```
en-US:
```
Blade Surge is live!
· Heroes, 20 dungeons and boss ultimates
· Expeditions, gear upgrades and engravings
· Starter pack, ad removal, Season 1 pass, monthly card
· Some graphics download on first launch (Wi-Fi recommended)
```

## 4. 출시 순서

1. 스토어 등록정보 업로드(`tools/play-listing-upload.sh`) → 게시 개요의 "앱 대시보드 필수 단계" 해소 확인.
2. 인앱 상품 4종 등록·활성(지휘, 콘솔 UI).
3. PR #475(원스토어 시크릿 바인딩, 시크릿 생성 뒤) → PR #474(IAP_ENABLED·AdMob) 머지·배포·readback.
4. 내부 트랙 vc5로 라이선스 테스터 결제 E2E(Tab S7+): 구매→서버 지급→환불→역분개, 광고 노출 위치(전투 밖) 확인.
5. PC 1회용 승인(서명 전 AAB sha256 `cbf6ab66391c649ede4a3193a26085ca54e1e04f5b7e96687a448b11b1cc0a9b`) → `apex play <vc5 AAB> BLADESURGE_PLAY production completed "<출시 노트>"` → tracks/production readback.
   - vc5를 그대로 승격할지, 결제 스위치 머지 뒤 main으로 vc8을 다시 빌드할지: 앱 코드는 서버 플래그만 읽으므로 vc5 그대로 가능. 새 앱 코드가 main에 들어오면 vc8.
6. 출시 뒤 `IAP_ALLOW_TEST=false` 후속 PR, 퍼널 보고(`tools/funnel-report.mjs`).

## 5. 대표님 몫
- AdMob 결제 정보(지급 계좌·세금 정보) 입력 — 광고 수익 지급 조건.
- (Play) 결제 프로필 확인이 콘솔에서 요구되면 그 화면만.
