# 병행 실제 플레이 검증

정본 Three.js/WebGL2 전투와 현재 React/R3F 연출을 그대로 실행한다. `tools/parallel-play-qa.mjs`는 서로 저장소가 격리된 세 Chromium context에서 키보드·마우스·터치 입력을 보내며 자연 프레임 루프를 관찰한다. `app.step`, 시간, PRNG, 캐릭터 능력치, 저장 값과 승패를 주입하지 않는다.

수동 경로는 이동·공격·일시정지·복귀, 포인터 AUTO 전환 뒤 추가 캔버스 클릭 없이 WASD 복구, Tab/Enter로 AUTO를 조작할 때 UI 포커스와 키 입력 경계 유지를 확인한다. 터치 경로는 조이스틱과 공격의 동시 소유권·취소·세로/가로 viewport를 확인한다. 성장 경로는 유리 정원 기본 원정을 AUTO로 자연 승리하고 실제 결과창이 열린 뒤 보상·장비·단일 원정 기록·입장권 정산을 확인한다. 세 경로 모두 로비 복귀와 새로고침 후 저장을 확인한다.

## 실행

깨끗한 후보 커밋을 빌드하고 production preview를 실행한다. 개발 서버나 공개 서비스에서는 실행하지 않는다. 다른 작업이 후보 소스나 빌드를 바꾸지 않도록 유지한다.

```powershell
bun run build
bun run preview -- --host 127.0.0.1 --port 5189 --strictPort
```

다른 터미널에서 현재 커밋 SHA와 아직 존재하지 않는 출력 디렉터리를 지정한다. 부모 디렉터리는 먼저 만들어 두고 이전 증거는 덮어쓰지 않는다.

```powershell
$candidateSha = git rev-parse HEAD
node tools/parallel-play-qa.mjs --expected-sha=$candidateSha --origin=http://127.0.0.1:5189 --angle=d3d11 --out=C:/Work/records/blade-play-NEW
```

`--angle=d3d11`은 Windows ANGLE 경로다. 다른 호스트에서는 `--angle=default`를 쓰며 실제 WebGL2 renderer를 영수증에서 확인한다. GPU 사용 여부를 옵션 이름만으로 추정하지 않는다. `--profile=manual|touch|growth`로 단일 경로를 재현할 수 있다. Chromium은 프로젝트 Playwright 버전에 맞는 설치를 사용한다.

출력에는 실행한 driver 사본, 소스·production index·version SHA-256, 각 단계 전후 상태, renderer, 오류 원문과 스크린샷이 포함된다. 소스 HEAD·작업 트리·제공된 빌드는 시작과 종료에 검사한다. 기능 실패·런타임 오류·HTTP 오류는 종료 코드 1이다. 네트워크 취소 원문도 보존하지만 이 기능 검사로 미디어 취소의 적법성이나 미디어 품질을 승인하지 않는다.

## 검증 경계

2026-10-08 수정 전 실제 마우스 AUTO ON→OFF 뒤 버튼 포커스가 남아 `KeyD`가 입력되지 않는 결함을 재현했다. 입력 엔진의 UI 키 차단은 유지하고 성공한 포인터 전환만 AUTO 버튼 포커스를 해제한다. Enter/Space 클릭, 저장 실패, 다른 컨트롤로 이동한 포커스는 유지한다.

승리 판정과 결과창 사이에는 기존 1.6초 전투 연출 지연이 있다. 결과 객체가 생긴 즉시 보상 정산을 요구하지 않고, 자연 결과창이 나타난 뒤 정산을 검사한다. 초기 임시 harness의 조기 정산 실패는 게임 결함의 증거가 아니다.

병행 기능 플레이의 wall time은 FPS 판정에 쓰지 않는다. 성능 metrics는 다른 플레이와 겹치지 않게 별도로 실행한다. viewport/CDP 터치는 실제 Android의 GPU·터치·발열·오디오 증거가 아니며, `functional-pass`도 배포 승인이나 독립 리뷰 통과가 아니다. 기존 전체 테스트의 `region-architecture-batching` geometry 해시 실패는 별도로 보고하고 기준값을 통과 목적으로 바꾸지 않는다.
