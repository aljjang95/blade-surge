# 시작 호환성과 시작 실패 안내

2026-10-15 공개 사고(소유자 화면: 0%, '인터넷 연결과 브라우저의 WebGL 2 지원을 확인해 주세요', '다시 시도')에 대한 시작 경로 정리다. 기존 안내는 App 생성자와 boot() 의 모든 예외를 같은 문구로 보여 줘 원인을 구분할 수 없었다.

## 동작

- 렌더러는 `src/platform/startup-compat.js` 의 `acquireWebGL2Context` 로 게임 캔버스에 WebGL2 컨텍스트를 하나만 만든다. 속성은 Three r170 이 직접 만들던 값과 같고, `powerPreference: 'high-performance'` 요청이 null 을 주거나 예외를 던지면 `'default'` 로 한 번만 다시 시도한다(최대 2회). 두 번 모두 실패하면 마지막 예외를 cause 로 보존한 채 브라우저가 실제로 제공하는 것(API 유무·WebGL1 가능 여부)으로 분류한다. 이미 손실된 컨텍스트가 오면 캔버스가 그 컨텍스트에 묶여 다시 요청해도 같은 객체가 오므로 재시도하지 않고 BS-GFX-06 으로 알린다. 캔버스나 `getContext` 가 없는 것은 그래픽 지원 문제가 아니므로 원래 예외 그대로 `BS-APP-RENDERER` 가 된다.
- 만든 컨텍스트를 Three 에 넘기고 기존 불투명 클리어(`setClearAlpha(1)`)를 유지한다. 외부 컨텍스트(alpha true)를 받은 Three r170 은 컨텍스트 복구 때 배경 상태를 새로 만들며 클리어 알파를 0 으로 되돌리므로, Renderer 가 Three 의 복구 처리 뒤에 1 을 다시 맞춘다. 현재 장면은 불투명 배경이라 이 차이로 인한 화면 회귀는 관측되지 않았고, 기존 경로와 같은 수명주기 상태를 유지하기 위한 보정이다. Three 의 무속성 진단 호출이 기본 속성(antialias 켜짐) 컨텍스트를 캔버스에 묶고 실패한 렌더러의 캔버스 리스너를 남기던 경로가 없어진다.
- MediaQueryList 변경 구독(`onMediaQueryChange`)은 `addEventListener` 가 있으면 그것만, 없는 구형 브라우저는 `addListener` 로 한 번만 구독한다. 앱 화면 모드(standalone/fullscreen)와 동작 줄이기 설정 구독이 이 경로를 쓴다.
- 시작 단계(`renderer`, `effects`, `input`, `save`, `interface`, `platform`, `settings`, `assets`, `world`, `shaders`, `start`, `lobby`)를 기록해 실패를 분류한다. 실패 화면은 원인별 제목·안내·오류 코드·'다시 시도'·'문의용 정보 보기'(복사)를 보여 준다.
- '다시 시도'는 사용자가 누를 때 한 번만 새로고침한다. 자동 새로고침, 저장 삭제, 캐시 삭제, 외부 전송은 없다. 문의용 정보는 오류 코드·단계·번들 파일 이름·WebGL 2 API 유무·그래픽 실패 때 WebGL 2 요청 결과(정해진 선택·결과 문구만)·저장 공간 접근 가능 여부·시각만 담는다.
- 사이트 데이터 차단 브라우저는 `localStorage` getter 자체가 SecurityError 를 던진다. 성채 명령창과 메이플 창 관리자의 기본 저장소 조회를 try 안으로 옮겨 시작을 막지 않게 했다. 저장 불가 상태는 기존 안내('현재 진행은 이 창에서만 유지됩니다')와 출격 차단을 그대로 유지한다.

## 오류 코드

| 코드 | 의미 | 안내 |
| --- | --- | --- |
| BS-GFX-01 | 브라우저에 WebGL2 API 가 없음 | 최신 브라우저로 열기 |
| BS-GFX-02 | WebGL2 API 는 있으나 컨텍스트 거절, WebGL1 은 가능 | 브라우저 업데이트·다른 브라우저 |
| BS-GFX-03 | WebGL 전체 사용 불가 | 하드웨어 가속 켜기·브라우저 재시작 |
| BS-GFX-04 | 컨텍스트는 만들었으나 Three 초기화 실패 | 탭 정리 후 재시도·다른 브라우저 |
| BS-GFX-05 | 셰이더 링크 실패(`shaders` 단계) | 재시도·다른 브라우저 |
| BS-GFX-06 | WebGL2 요청이 이미 손실된 컨텍스트를 돌려줌 | 탭·앱 정리 후 재시도·브라우저 재시작 |
| BS-LOAD-01 | `assets` 단계 로딩 실패 | 인터넷 연결 확인 |
| BS-APP-<단계> | 그 밖의 시작 오류 | 그래픽 문제로 확인되지 않았음을 밝히고 코드 전달 요청 |

## 검증 도구

`node tools/startup-fault-qa.mjs --dist <dist> --label <새 이름> --out work/startup-incident [--mode candidate|baseline] [--scenarios ...] [--capture all|failure-ui|none] [--viewport WxH]` 는 지정한 빌드를 루프백 임의 포트에서 서빙하고 Chromium 에서 정상, 고성능 요청 거절(null)·예외, 두 요청 모두 예외, localStorage getter 거부, 사이트 데이터 차단 프로필, 구형 MediaQueryList, 컨텍스트 손실·복구, `--disable-webgl2`, GPU·소프트웨어 래스터 끔, WebGL2 API 제거를 점검한다. 같은 이름의 보고서가 있으면 덮어쓰지 않고 멈춘다.

- candidate 모드는 시나리오마다 명시 기대(실제 WebGL2 요청 순서·속성, 100% 준비와 App 생성, 로비 도달, 경로 카드 → 출격 준비 → 입장(영상 건너뛰기) 실제 UI 진입, 전투 시계 증가, 컨텍스트 속성·불투명 클리어, 캔버스 수명주기 리스너 중복 없음, 미디어 쿼리 구독 1회, page error 없음, 실패 코드·0%·복사 정보 일치·자동 새로고침 없음·다시 시도 1회·저장 보존)를 검사하고 하나라도 어기면 종료 코드 1 이다.
- 저장 불가 시나리오의 기대는 정상 로비, `storageStatus='unavailable'`, 실제 저장 경고, 비활성 출격 버튼과 '저장 공간을 확인해 주세요.' 사유, 전투 미시작, 기존 저장 보존이다. 비활성 출격 버튼을 강제로 누르지 않는다.
- baseline 모드는 같은 검사를 관측으로만 기록하며 PASS 판정을 내지 않는다(종료 코드 0).
- 화면 캡처 실패는 `captureErrors` 로 따로 기록하고 기능 판정을 막지 않는다. `--capture failure-ui` 는 실패 화면·출격 차단 화면·오류 화면만 캡처한다.

클라우드 SwiftShader 결과이며 실제 Android·iOS·GPU·발열·고객 환경 검증이 아니다.
