# 블레이드 서지 스토어 출시 계약

사용자는 ONE Store·Google Play·Apps in Toss 출시와 광고·인앱 결제 및 출시 설문 작성을 승인했다. 기존 웹 운영과 원본 모델·BGM·사용자 저장을 유지한다. 고객 웹·API·지원·개인정보 주소는 기존 `https://blade.tllhouse.com`이며 Cloudflare `blade-surge`의 custom domain 연결·활성 zone·인증서 ID를 실제 조회했다. 다른 제품의 hostname이나 SDK·자격증명·서명은 바꾸지 않는다.

기존 정본 체크아웃은 `C:/Users/heart/Documents/ChatGPT/블레이드 서지`다. 새 `블레이드 서지 2` 폴더는 HEAD·remote·소스가 없는 빈 초기 저장소여서 기존 작업을 이관/복제하거나 덮지 않는다.

Android package `com.theluxurylord.bladesurge`는 유지하며 googleplay/onestore flavor에 각 결제 SDK가 하나만 포함된다. 앱인토스는 SDK 3.8.0과 공식 `ait build` 포맷, `blade-surge` 앱 이름으로 별도 빌드한다. `tools/build-channel.mjs`는 `work/store-builds/{channel}/web`을 사용하며 공개 `dist`를 덮지 않는다. 실제 artifact 해시가 생긴 뒤 공통 release-targets manifest와 설치된 `validate-release-targets.mjs`로 채널·호스트를 대조한다. debug 파일을 서명된 운영 APK/AAB로 부르지 않는다.

첫 유료 상품은 비소모품 ‘광고 제거’다. 기존 현금 보석·VIP·패스는 검증 전 비활성 경계를 유지한다. 보석/가챠 게임의 로컬 저장을 유료 권한 원장으로 승격하지 않는다. 구매·복원은 채널에 고정된 SDK, 발급된 사용자 인증, 서버 카탈로그·주문 의도, 실제 provider 확인과 원장을 거친다. 성공 callback만으로 보상을 주지 않고 결제 중 게임/음악/입력 소유권을 보존한다. 취소·보류·타임아웃·환불·중복·다른 계정 replay는 성공과 분리한다.

앱인토스 실제 등록: workspace 42391(승인됨), miniAppId 85379, appName blade-surge, `intoss://blade-surge`. 첫 생성은 앱 이름만 저장됐고 앱정보+번들 동시 최초 검수가 필요하다는 실제 응답을 보존했다. 같은 앱을 새로 만들지 않는다. 상품 ID `ait.0000085379.795abd69.3e2153580e.1772243239`, NON_CONSUMABLE, 승인된 상품·판매 INACTIVE. 공급가 3,900원과 VAT 포함 판매가 4,290원은 콘솔 readback이며 최종 가격은 SDK가 표시한다. 광고 그룹 `ait.v2.live.b311470e6321418c`는 INTERSTITIAL·ENABLED·제한 없음으로 readback했다. 광고는 로비에서 사용자가 명시적으로 요청하는 전환 흐름에만 배치하며 전투/입장/결제 중 겹쳐 띄우거나 광고 보상을 가짜 지급하지 않는다.

인증 경계: 앱인토스는 SDK 일회용 code를 서버 mTLS로 교환한다. 클라이언트 anonymous hash·localStorage ID는 사용자 인증으로 쓰지 않는다. 공식 API의 인증서 CN은 미니앱에 묶이므로 현재 Cloudflare에 있는 밥친구·타로 인증서를 빌려 쓰지 않는다. Google OIDC는 현재 등록한 audience·서명·issuer·만료를 검사하고 Publisher 자격증명도 Blade 범위가 증명되기 전 다른 제품 값을 가져오지 않는다. Cloudflare Secrets Store runtime 바인딩을 사용할 권한은 확인됐으나 Blade 전용 게시자·서명·mTLS가 없다는 실제 metadata와 전용 설정 부재를 구분한다. 원시 키를 사용자에게 요청하거나 출력하지 않는다.

사실 기반 설문 초안: 무료 다운로드 게임, 선택 유료 비소모품·전면 광고 포함, 판타지 몬스터 전투/무기/보스 공포 요소 있음, 실제 현금 환전·카지노·베팅 없음. 성적 내용·마약·신분 위조를 제품이 제공한다고 쓰지 않는다. 기존 가챠/랜덤 장비 요소는 질문에서 숨기지 않는다. 대상 고객은 성인이며 플랫폼 등급은 각 채널의 실제 질문/판정 결과로 확정한다. 광고 SDK는 기기 식별자·앱 활동·진단 등 데이터를 처리할 수 있으므로 ‘전혀 수집 안 함’을 자동 선택하지 않는다. 계정/정산/주소/게임 등급 증명서/사업자 법적 식별자는 확인한 실제 정보만 사용한다. 형식만 채웠다는 이유로 제출·승인·공개 상태를 만들어 넣지 않는다.

공식 근거: [앱인토스 인앱 결제](https://developers-apps-in-toss.toss.im/guide/monetization/in-app-payment), [사용자 인증 code 교환](https://developers-apps-in-toss.toss.im/api/user-key), [주문 상태 API](https://developers-apps-in-toss.toss.im/api/iap), [SDK CORS/mTLS](https://developers-apps-in-toss.toss.im/documentation/integration/server-api), [Play Billing](https://developer.android.com/google/play/billing/integrate), [ONE IAP V21](https://onestore-dev.gitbook.io/dev/tools/billing/v21).

실기기·Safari·OS 방향 잠금·Toss 앱의 결제/광고 sandbox·게시자 권한·서명·심사·공개는 별도 gate다. Chromium touch와 에뮬레이터를 실제 휴대폰 수락으로 보고하지 않는다. 기존 로컬 오디오 ERR_ABORTED 원본은 보존한다. 재감사의 다섯 기능/미디어·AudioContext 시계는 통과했지만 같은 URL의 일부 cancellation에 부족한 native suspension 기록을 전체 청감 승인으로 바꾸지 않는다.
