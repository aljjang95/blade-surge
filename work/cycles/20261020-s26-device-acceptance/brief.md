# 20261020-s26-device-acceptance — S26 Ultra 실기기 전투·AUTO·VFX·화면·발열 확인

- 저장소/기준: aljjang95/blade-surge @ origin/main bcaa852 · 2026-10-20T10:35Z · 점유 01a158db-074e-78e1-8406-2847614edd59 (루프 영웅별-mirelo-효과음등급-과금자동-타겟-평타auto-클리어스킬-vf 4번 덩어리, 지휘 01a15674-a908-7b63-8bfd-ac335363916a)
- 왜 지금: 루프 dod D10(실기기 터치·발열)만 남음. 지금까지 모든 화면 검증은 데스크톱 브라우저 터치 모드였다.
- 이번에 하지 않는 것: 새 기능, 경제 수치 변경, 결제 SDK. 실기기에서 결함이 나오면 그 결함만 고친다.
- 환경 개선: 실기기 Chrome을 adb 실제 터치 + CDP 상태 읽기로 한 번에 돌리는 재사용 QA 도구(tools/gogo-qa-20261020-s26.mjs). 지금까지는 실기기 절차가 스크립트로 없어 매번 손으로 했다.
- 설계도: 없음(검증 사이클, 화면 변경 없음)

## 사용자 관찰 결과
- 전: 폰에서 실제로 손가락으로 했을 때 전투·AUTO·스킬 연출·상점 화면·발열이 괜찮은지 근거가 없다.
- 후: S26 Ultra Chrome에서 정식 호스트를 실제 터치로 돌린 기록(화면·소리 이벤트·프레임·온도)이 있고, 나온 결함은 고쳐 배포돼 있다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | S26 Chrome에서 정식 호스트를 열고 실제 터치로 로비 → 출격 준비 → 원정 시작 → 전투에 들어가며, 공격 버튼 탭이 자동 조준 평타로 적 HP를 줄이고 조이스틱 드래그가 영웅을 움직인다 | S26 실기기 adb 터치 + CDP 상태 로그 + 화면 캡처 | integration | D10, 지휘 브리프 1 |
| A2 | AUTO 버튼 탭으로 스테이지 1개를 사망 없이 클리어하고, 결과 화면 전리품 카드의 장착·판매·강화가 실제 터치로 동작한다(능력치·골드·강화 단계 변화) | S26 실기기 로그·캡처 | integration | D10, 지휘 브리프 2 |
| A3 | 스킬(궁극기 포함) 시전 VFX와 SSR·SSSR 오라가 화면 중앙 플레이 영역을 가리지 않고 보이며, 효과음 재생 이벤트(AudioBufferSourceNode start, AudioContext running)가 실제로 발생한다 | S26 실기기 캡처 + 재생 이벤트 로그 | integration | D10, 지휘 브리프 3, AGENTS UI 규칙 |
| A4 | 소환·초월·상점·스킬 초기화 화면이 S26 가로 화면에서 잘리거나 겹치지 않고(요소 사각형이 화면 안, 버튼끼리 겹침 없음) 실제 터치로 열고 닫힌다 | S26 실기기 캡처 + 사각형 검사 로그 | integration | D10, 지휘 브리프 4 |
| A5 | 10분 이상 연속 전투에서 렌더 fps·p95 프레임·성능 단계와 배터리 온도·열 상태를 1분 이하 간격으로 기록하고, 지속 프레임 저하(1분 평균 fps가 목표의 70% 미만이 2분 이상)나 과열(thermal status 3 이상, 배터리 45°C 이상)이 없다. 있으면 원인을 고치고 재측정한다 | S26 실기기 측정 로그(dumpsys battery·thermalservice + app.frameGovernor) | integration | D10, 지휘 브리프 5 |
| A6 | 측정한 정식 호스트 빌드 SHA가 version.json과 같고, 고친 것이 있으면 typecheck·전체 테스트·빌드 → land → tools/deploy.mjs 배포 → 정식 호스트 SHA 일치까지 확인된다 | version.json 읽기 + 배포 영수증 | integration | D9·D10 |

## 계약
- 도구: tools/gogo-qa-20261020-s26.mjs. adb forward tcp:<port> localabstract:chrome_devtools_remote → CDP(WebSocket)로 정식 호스트 탭 하나를 새로 열어 상태만 읽고, 모든 게임 입력은 adb shell input(tap·swipe·motionevent)으로 보낸다. 입력 묶음 전마다 dumpsys window mCurrentFocus가 com.android.chrome이 아니면 즉시 멈춘다.
- 주입: 상태 준비(튜토리얼 완료·영웅 등급·재화)는 CDP evaluate로 하고 보고서에 injected로 남긴다. 결과 판정에 쓰지 않는다.
- 기기 설정: 화면 꺼짐 방지(stay_on_while_plugged_in)를 바꾸면 원래 값을 기록하고 끝에 되돌린다. 볼륨·밝기·앱 전환 금지. 끝나면 연 탭만 닫고 forward를 지운다.

## 레인
| lane | 모델·effort | 도구·스킬 | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| integration | Opus(지휘, 기기는 단일 운영자) | adb·CDP 실기기 QA, apex-proof-of-done | integration | work/cycles/20261020-s26-device-acceptance, tools/gogo-qa-20261020-s26.mjs, 결함 수정 시 해당 src | 전 기준 증거 |

## 검증 계획
- 정적: 수정이 생기면 bun run typecheck, bun test --timeout 30000, bun run build
- 런타임: 정식 호스트 https://blade.tllhouse.com
- 실기기: Galaxy S26 Ultra(SM-S948N) Chrome, device-lock s26-ultra 아래. 연결이 안 되면 external_gate(무선 디버깅 켜기·페어링 코드)로 남긴다.

## 배포 계획
- 수정이 없으면 배포 없음(bcaa852 유지). 있으면 pdev land → tools/deploy.mjs --auth=wrangler → version.json 읽기.
- 롤백: 현재 배포 08a3624f(Worker fcdf5007, main bcaa852), 그 이전 cf670d84/b511ebbc.

## 위험
- S26은 대표님 본인 폰: 매 입력 전 전경 앱 확인, 다른 앱이면 중단.
- 10분 측정 중 화면 꺼짐: stay_on 설정은 원래 값으로 복원.

## 한도
capacity CONTINUE(anthropic 주간 66% 사용, 5시간 21%)
