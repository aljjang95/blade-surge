# PWA 및 모바일 릴리즈 QA — 2026-09-13

설정 → 게임 앱에서 홈 화면 설치 방법과 새 버전 상태를 확인합니다. Android는 브라우저의 앱 설치 메뉴, iPhone은 Safari 공유 메뉴의 홈 화면 추가를 안내합니다. 브라우저가 설치 프롬프트를 제공하면 실제 프롬프트를 사용합니다. 전투·파티 중에는 업데이트로 자동 새로고침하지 않습니다. 연결이 끊긴 상태로 새로 열면 연결 안내를 표시하며, 전체 게임의 오프라인 실행을 제공하지 않습니다.

이번 변경은 자동 그래픽 설정 유지, 터치 기기의 캔버스 픽셀 예산, 주소창·키보드로 줄어든 화면 높이 대응, 입력 초기화, 작은 화면의 조작 버튼 배치, WebGL 복구와 설치 상태 동기화를 포함합니다. 그래픽 복구 후 활성 전투는 사용자가 계속을 눌러 재개합니다. 모델 원본의 환경 맵도 함께 갱신해 복구 후 영웅을 바꿔도 재질이 유지됩니다.

## 확인한 결과

`bun run check`: **557 tests / 58,410 assertions / 0 failures**, TypeScript 검사와 production build 통과. 독립 검토에서 발견한 모델 캐시의 오래된 환경 맵과 페이지 종료 시 다른 창의 저장을 덮어쓰는 경로를 수정했습니다.

| 로컬 엔진 | 버전 | 화면 6종 | 오프라인 안내 → 온라인 복귀 | Web Audio |
|---|---|---:|---|---|
| Chromium | 151.0.7922.34 | 6/6 PASS | HTTP 200, Service Worker 응답 확인 | API 존재·사용자 활성화 확인 |
| Firefox | 153.0 | 6/6 PASS | HTTP 200, Service Worker 응답 확인 | API 존재·사용자 활성화 확인 |
| WebKit | 26.5 | 6/6 PASS | HTTP 200, Service Worker 응답 확인 | Windows 엔진에 API 없음, 명시한 무음 대체 동작 확인 |

화면은 **320×568, 390×844, 412×915, 667×375, 844×390, 1024×768**입니다. 총 **18 cases / 165 checks**, 콘솔 오류·페이지 오류·온라인 요청 실패·조작 영역 잘림은 모두 0입니다. 2026-09-13 10:09:15Z–10:17:15Z, 479.8초간 실행했습니다. 요약은 [pwa-mobile-20260913.json](pwa-mobile-20260913.json)에 있습니다.

이 매트릭스의 빌드는 `index-BKsPMFQS.js` / `index-B3k7WcPV.css`, PWA release `68bd200fb57fa9e896ca`입니다. 이후 추가한 짧은 세로 화면의 파티 HP창·로비 메뉴·네브·재화 위치 변경은 아래 후속 검증으로 별도 확인합니다. 매트릭스 결과를 마지막 CSS 변경의 증거로 대신하지 않습니다. 원본 보고서 SHA-256은 `d10674e0b47adb8001c3b918972e6cdab9daaf3cf659a4602bfe746aa489a284`입니다.

## 입력과 성능 검사 범위

- 시작·설정·출격·공격·스킬·일시정지·재개에 실제 테스트 엔진의 touchscreen tap을 사용했습니다. 이동은 보이는 조이스틱 중심의 mouse drag, 회전은 viewport resize입니다. 공격 애니메이션·스킬 cooldown을 관찰했으며 적 피해나 던전 완주 검증으로 확대하지 않습니다.
- 여섯 스킬·공격·회피·물약·조이스틱의 화면 안 배치, 겹침, 중심점 접근성을 확인했습니다. 자동 그래픽의 요청값을 보존하고 터치 캔버스의 low 600,000 / mid 1,000,000 / high 1,500,000 픽셀 상한을 검사했습니다. 실물 휴대폰의 FPS·발열 수치로 해석하지 않습니다.
- Chromium에 Pixel 7 Android UA, WebKit에 iPhone UA를 적용해 설치 안내를 확인했습니다. Firefox는 모바일 모드 제약으로 viewport와 touch만 적용했습니다. OS를 에뮬레이트한 결과가 아닙니다.
- WebKit 설정창은 지원하지 않는 mouse wheel 대신 프로그램 스크롤 후 실제 tap으로 검사했습니다. 네이티브 손가락 스크롤 검증은 아닙니다.
- 소유한 localhost 프록시의 TCP 연결을 실제 끊어 오프라인 안내를 검사했습니다. Firefox의 `setOffline`·요청 가로채기 조합에서 나온 `NS_ERROR_OFFLINE`은 실패 증거로 보존하고 실제 연결 실패 방식으로 재검증했습니다. 프록시는 종료했습니다.
- 게임 상태·능력치·시간을 바꾸는 fixture 없이 `window.app`는 관찰에만 사용했습니다. 첫 실패 이후 미실행 단계는 PASS로 바꾸지 않습니다.

## IAB 수동 확인

320×568 세로와 667×375 가로의 전투 버튼을 직접 확인했습니다. 실제 설정 화면에서 업데이트 적용 → 새 부팅 → `updateAvailable=false`를 확인했습니다. WebGL 손실을 명시적으로 주입했을 때 복구 안내가 표시되고, 복원 후 실제 법사 선택을 통해 22개 캐시 재질의 오래된 환경 맵이 0개임을 확인했습니다. 이 과정의 콘솔 오류·경고는 없었습니다. 전투 중 복구는 일시정지를 유지하고 계속 버튼으로 재개했습니다.

390×844 파티 입장창에서 코드를 입력하고 화면을 390×400으로 줄인 뒤 참가·닫기 버튼 접근과 잘못된 코드 안내를 확인했습니다. 이는 줄어든 viewport 검사이며 실물 키보드 검증이 아닙니다. IAB의 터치 이벤트 주입 API는 지원하지 않아 네이티브 스와이프 검증을 주장하지 않습니다.

## 최종 파티 배치 검증

**4개 실제 브라우저 / 12 layouts PASS**입니다. 독립 Chromium 컨텍스트에서 서로 다른 영웅과 긴 이름을 선택하고, 로컬 workerd·Durable Object 서버를 통해 파티 생성 → 세 명 참가 → 네 명 준비 → 출격을 실제 UI로 수행했습니다. 네 클라이언트 모두 WebSocket을 송수신하고 전투에 진입했습니다. 320×568·390×844·667×375 각각에서 4개 HP칩의 화면 잘림·상호 겹침·카메라·공격·회피·여섯 스킬과의 겹침이 없었고 콘솔·페이지 오류도 0입니다. 게임 상태·시간·능력치·레이아웃 fixture는 사용하지 않았습니다.

부팅·파티 생성은 390×844에서 수행하고 전투 화면을 세 크기로 변경했습니다. 320px 로비에서 발견한 파티 버튼 가림은 메뉴 3열로 수정했고, IAB 실제 클릭과 최종 solo smoke의 중심점 검사로 별도 확인합니다. 동시에 여러 WebGL 컨텍스트를 준비할 때의 navigation 대기와 초대 방 만료 실패는 보존했습니다. 모든 클라이언트를 먼저 부팅한 후 방을 생성하는 절차로 검증을 완료했습니다.

파티 검증 빌드의 PWA release는 `e33b240c172bbd5afc0f`입니다. 이후 변경은 로비 재화 아이콘 크기와 네브의 가시 로비 selector 한정이며, 파티 HP 규칙은 그대로입니다. [파티 결과 JSON](pwa-party-mobile-20260913.json), [320px 전투 화면](pwa-mobile-20260913/party-320x568.png), [667px 전투 화면](pwa-mobile-20260913/party-667x375.png)에 증거를 남겼습니다.

최종 `index-DdpMaJSc.js` / `index-CuSsu7-M.css`에서 **3개 엔진 × 320×568·390×844 = 6/6 cases, 57 checks PASS**입니다. 파티 버튼 중심점 접근·보석 표시의 화면 안 배치와 각 엔진의 실제 TCP 연결 실패 후 SW 오프라인 안내·온라인 복귀까지 재확인했습니다. 콘솔·페이지·요청 오류는 0이며 148.8초간 실행했습니다. [최종 회귀 JSON](pwa-mobile-release-20260913.json)의 PWA release는 `48f6586f247a8db1daa4`, 원본 SHA-256은 `9a6bb82b3c5eb4563e796dd160441d296a23677c237b82c5ac1df68f5f83db0f`입니다.

검증한 앱 번들의 SHA-256은 `edf93e0a924281600bc184a96704c17f9975880be576463ce407b9d22cbb2af6`, CSS는 `6a028fd59cda68ddc41269be3f2281200671ae1aa9c102078e50d30f70393068`입니다. 위 로컬 검증의 version.json은 커밋 전이므로 기준 SHA와 `dirty=true`를 보존했습니다. 이를 운영 버전으로 표시하지 않으며 릴리즈 시 clean merge SHA와 배포된 version.json을 별도로 대조합니다.

## 재현과 제한

```powershell
bun run check
$env:BLADE_PREVIEW_PORT='5224'
node tools/preview-local.mjs
# 다른 터미널
node tools/mobile-browser-qa.mjs --url=http://127.0.0.1:5224 --engines=chromium,firefox,webkit --viewports=320x568,390x844,412x915,667x375,844x390,1024x768 --out=work/pwa-mobile-final.json
# 실제 로컬 파티 서버와 별도의 4인 브라우저 검사
node node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port 5225 --var APP_ORIGIN:http://127.0.0.1:5225 --persist-to work/pwa-party-state
node tools/mobile-party-qa.mjs --url=http://127.0.0.1:5225
```

Playwright 엔진 설치가 필요하면 프로젝트 버전에 맞춰 `node node_modules/playwright/cli.js install chromium firefox webkit`을 사용합니다. 테스트는 localhost만 대상으로 하며 기존 로그인 브라우저를 이용하지 않습니다. 원본 JSON과 PNG는 `work/pwa-mobile-final.json`, `work/pwa-mobile-final.artifacts/`에 보존했습니다. 초기 실패는 `work/pwa-mobile-smoke*.json`, `work/pwa-mobile-matrix1.json`, `work/pwa-firefox-controls-rerun.json`, `work/pwa-webkit-final-smoke.json`에 남겼습니다.

**실물 iPhone/Android, 실제 Safari·삼성 인터넷 등 개별 앱, 홈 화면 설치 완료, 네이티브 멀티터치·키보드·회전 센서, 출력된 소리·진동, 장시간 발열·배터리는 미검증입니다.** 연결된 Android 실기기는 없었습니다. 로컬 엔진 통과를 모든 모바일 브라우저의 인증으로 부르지 않습니다. 스토어 출시·결제·광고 실서비스 연결은 이 PWA 패치의 완료 범위와 별도입니다.
