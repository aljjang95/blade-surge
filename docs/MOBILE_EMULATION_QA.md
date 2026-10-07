# 모바일 브라우저 에뮬레이션 QA

`tools/mobile-qa.mjs`는 정적 배포 빌드의 실제 native 입력과 브라우저 생명주기를 검증한다. Pixel 7과 iPhone 13 프로필의 viewport·DPR·UA·touch를 Chromium에 적용한다. iPhone 프로필은 Safari 엔진이나 실제 iPhone 검증이 아니다. 물리 GPU·발열·청음·Android OS 검증은 별도다.

기존 `mobile-browser-qa.mjs`의 여러 엔진·레이아웃·offline 검증, `mobile-settings-qa.mjs`의 설정·미디어 UI, `mobile-world-contact-qa.mjs`의 월드 접촉 범위를 대체하지 않는다. 이번 도구는 정확한 배포 SHA, 자연 clock의 회전 직후 tap/hold, Xvfb 실제 tab visibility, 상세 native media trace에 집중하며 기존 `conquest-media-observer.mjs`·`qa-media-checkpoints.mjs`를 재사용한다.

패키지 진입점은 `bun run qa:mobile --help`다.

```sh
DISPLAY=:99 node tools/mobile-qa.mjs \
  --origin=http://127.0.0.1:5175 \
  --expected-sha=0f166d56202002b6d1a2563f77469eee77a846f1 \
  --artifact-dir=/workspace/blade-surge/dist \
  --out=/workspace/scratch/bladesurge-mobile-qa/run-unique \
  --headed --empty-fonts-css --chrome=/usr/bin/chromium
```

공개 배포 후에는 root의 배포 완료 확인과 정확한 SHA를 사용해 `--origin=https://blade.tllhouse.com`으로 실행한다. `--artifact-dir`의 보존된 local dist(기본 repo/dist)가 expected SHA·clean 상태인지 확인하고 served version·compiled index·JS/CSS를 exact bytes/해시 비교한다. 경로 탈출을 거부하고 마지막에 버전이 바뀌지 않았는지 다시 확인한다. 출력 디렉터리는 새 경로여야 하며 실패 원본을 덮어쓰지 않는다. `--profiles=android` 또는 `iphone`으로 범위를 좁힐 수 있다. 차단된 클라우드 외부 폰트 환경에서만 `--empty-fonts-css`를 사용하며, 실제 폰트 다운로드 성공 증거로 해석하지 않는다.

실제 touch joystick·짧은 공격·홀드·스킬, CDP screen orientation 변경의 trusted orientation/resize 이벤트, pause, 다른 native 탭의 `document.hidden`과 foreground 명시 재개, 에너지를 사용하는 원정 입장, 실제 포기 정산·저장·reload를 확인한다. 화면 회전 직후 짧은 공격은 별도 관찰이며 실패를 안정화 뒤 입력의 통과로 덮지 않는다. `app.step`, 상태 주입·teleport·보상 지급·testPause·프레임 가속은 사용하지 않는다.

회전 직후 UI geometry가 아직 화면 밖이면 hit guard를 풀지 않고 `notDispatched`와 좌표 오류를 기록한다. 실제 touch를 전달한 뒤 공격 상태를 관측하지 못한 `dispatchedButNotAccepted`와 구분한다. trusted orientation 자체와 안정화 뒤 입력은 계속 필수 게이트다. 전달하지 않은 touch를 제품의 입력 유실로 보고하지 않는다.

배경 visibility 검증에는 headed Chromium과 실제 X server가 필요하다. headless에서 다른 탭을 열어도 `document.hidden`이 발생하지 않는 환경이면 해당 단계가 실패하고 제한이 남는다. visibility/freeze 이벤트를 JS로 합성하거나 게임 pause를 호출해 실제 OS/브라우저 이벤트처럼 표시하지 않는다. Xvfb는 가상 화면이며 실제 스마트폰 화면이 아니다.

Playwright 기본 세션의 focus override가 문서를 항상 visible로 고정할 수 있어, 도구는 소유한 임시 Chromium 프로필을 직접 실행하고 공식 `connectOverCDP({noDefaults:true})`로 연결한다. 모바일 DPR/UA/touch/orientation은 native CDP 설정을 사용하고, PNG도 `Page.captureScreenshot`으로 저장해 Playwright가 화면을 이전 viewport로 복원하지 않게 한다. 조이스틱은 실제 `.joy-base` 중심과 hit-test를 사용한다. pause의 홀드 해제 검사는 native 마우스 click으로 열린 메뉴를 사용하며, 이동/공격/스킬/재개/정산은 native CDP touch다. 서비스 워커 네트워크는 우회하므로 새 PWA 캐시 업데이트 인증은 별도다.

일반 UI tap은 public `scrollIntoViewIfNeeded`로 scroll container 안의 버튼을 드러내고, 진입 CSS animation 동안의 잘못된 좌표를 피하도록 `waitForElementState('stable')`로 실제 자연 프레임의 geometry 안정화를 관측한다. 이 UI reveal은 programmatic scrolling이며 손가락 스크롤 품질 인증이 아니다. 회전 직후 진단 tap에는 이 대기·스크롤을 적용하지 않고 native 이벤트·hit 좌표를 그대로 남긴다.

숨긴 탭의 native touch 종료 응답은 foreground 복귀까지 보류될 수 있다. 실제 hidden·pause·입력 해제를 읽은 뒤 native foreground로 먼저 복귀하고 touch를 종료한다. CDP 호출은 30초, 화면 캡처는 60초 제한을 두고, 전체 35분 deadline도 소유 Chromium을 정리한다. 외부 개입으로 해제한 진단 실행은 무인 전체 통과로 보고하지 않는다.

미디어는 문서별 timeOrigin과 JS 인스턴스의 src/currentTime/paused/readyState/connect/disconnect, CDP native player 원시 이벤트, 정확한 requestId·frame/loader·Range·200/206·Content-Range·시작/응답/실패 clock을 기록한다. `ERR_ABORTED` 원본은 삭제하거나 화이트리스트로 무시하지 않는다. 기존 엄격 classifier의 JS 상관 결과도 원래 native player의 suspension과 정확한 요청 연결을 입증하지 못하면 원인 미확정이다. 늦게 수신된 player 이벤트를 수신 당시 문서에 귀속시키지 않는다. 음원 재생은 실제 청음 증거가 아니다.

산출물은 report·재현 driver·observer 사본·프로필별 PNG·최종 격리 저장 상태다. runtime/HTTP 오류, 원시 실패 요청, 미디어 미확정, 실제 화면 검토를 별도로 보고한다. 자연 프레임 timeout은 동시에 실행하는 Android emulator 등 CPU 경쟁의 영향을 받을 수 있으므로 모바일 FPS나 성능 비교로 쓰지 않는다.

2026-10-07 도구 진단 원본은 `/workspace/scratch/bladesurge-mobile-qa/`에 보존했다. 첫 `local-0f166d5-1301`은 잘못된 joystick 중심·Playwright viewport 복원·강제 visible 때문에 전체 실패다. `native-v2`의 모달 animation 좌표, `android-v3`의 scroll 밖 버튼, `android-v4`의 회전 중 화면 밖 좌표도 각각 원본 실패를 유지한다. `native-v5`는 Android 기능 9개와 회전 관찰 1개를 기록했지만, hidden touch 응답을 외부 native foreground 개입으로 해제했으므로 별도 `qualification.json`에서 assisted 진단으로 한정하고 iPhone 반복을 중단했다. 이 도구 결함들을 제품 입력 손실로 단정하거나 기존 12:17 공격 timeout의 원인으로 소급하지 않는다.
