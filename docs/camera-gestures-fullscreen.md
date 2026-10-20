# 카메라 제스처·전체 화면 계약

## 빈 화면 제스처

- 전투와 로비 모두 빈 world(전투 `#gl`, 로비 `#gl`·`#tab-home`)의 터치를 `src/engine/world-gesture.js`의 `WorldTouchGesture`가 추적한다.
- 상태: 대기 → 8px 문턱을 넘으면 회전 → 두 번째 빈 화면 손가락이 닿으면 핀치 → 한 손가락을 떼면 남은 손가락의 현재 위치를 새 기준으로 바로 회전한다. 세 번째 손가락은 받지 않는다.
- 회전 시작 시 기준점을 문턱만큼 손가락 쪽으로 옮겨 시점이 튀지 않는다. 탭(문턱 미만)은 시점을 바꾸지 않고 기본 동작도 막지 않는다.
- 포인터 캡처는 회전·핀치에 들어갈 때 pointerdown 대상 요소에 건다(터치 암묵 캡처와 같은 요소라 다른 요소의 lostpointercapture가 생기지 않는다).
- 제외: 전투 `#joy`, 행동·스킬 버튼, 입력 요소, 링크, 모달·dialog, `details`/`summary`, Maple 창·퀵바. 로비는 기존 `CAMERA_UI`(성채 조이스틱·상호작용·메뉴·상단·하단 바)를 유지한다. 조이스틱 손가락과 빈 화면 회전·핀치는 동시에 동작한다.
- 정리: pointercancel, 자기 표면의 lostpointercapture, blur, pagehide, resize, orientationchange, visibilitychange(hidden), `input.clear()`, 일시정지·모달·전투 종료·영웅 사망(`player.alive === false`)·로비 비활성.
- 마우스 오른쪽 드래그, 휠, 확대/축소/복원 버튼, 패드 방향키는 기존 그대로다.
- 옛 '시점' 패드(`#battle-camera-pad`, `#lobby-camera-pad`)는 `camera-gestures.css`에서 1px로 숨기고 `:focus-visible`일 때만 원래 자리에 보인다. 키보드 회전 경로가 남는다.

## 전체 화면

- 웹: 사용자 탭 안에서 await 없이 `requestFullscreen({ navigationUI: 'hide' })`를 호출한다. `navigationUI`는 힌트라 OS 막대가 실제로 숨었다는 증거로 쓰지 않는다.
- 결과 `active`/`unavailable`(거절)/`unsupported`(API 없음, 예: iPhone Safari)에 따라 안내 문구가 다르다. 시작 버튼은 API가 있을 때만 "전체화면 · 가로로 시작"을 표시한다. API가 없으면 홈 화면 설치를 안내한다.
- 네이티브(Capacitor 8.5.1): `SystemBars.setStyle({ style: DARK })`와 `SystemBars.hide()`를 시작할 때와 백그라운드에서 복귀할 때마다 요청한다. `systemBars: 'requested'`는 플러그인이 호출을 받았다는 뜻일 뿐 실제 OS 숨김의 증거가 아니다.
- safe area: `native-app.css`가 `--sat/--sab/--sal/--sar`를 `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`로 다시 정의한다(Android WebView 140 미만의 env 버그 대응).

## 검증 범위

- 단위 테스트: `test/camera-lifecycle.test.ts`, `test/lobby-camera-controls.test.ts`, `test/native-app.test.ts`, `test/app-mode.test.ts`.
- 로컬 Chromium CDP 터치 스모크: `node tools/camera-gesture-qa.mjs --url=http://127.0.0.1:<port>/`. 에뮬레이션이며 실기기 조작감·발열·OS 막대 숨김 검증이 아니다.
