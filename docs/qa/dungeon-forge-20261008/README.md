# 던전 단조 에셋 검증 — 2026-10-08

기준 소스는 `678caf52a19ffda2240bfd7882278c4c0b77c49d`다. 검증은 Chromium 153.0.8010.0의 실제 WebGL2/SwiftShader에서 실행했다. Android 실기기·실제 터치·모바일 GPU·발열 승인은 포함하지 않는다.

## 자료의 구분

- `baseline-metrics.json`: 변경 전 clean 빌드의 전체 층 완주 기준선. 성능 계측에는 한글 폰트 fixture를 주입하지 않았다.
- `pre-repair-native-qa-v1.json`~`v4.json`: 초기 후보 원본 기록. v1 캡처 timeout, v2 과거 숨겨진 버튼 사용, v3 공격 방향과 반대의 fixture 배치는 하네스 실패다. v4의 자동 51개 PASS는 이후 발견한 시각 결함을 승인하지 않는다.
- `pre-repair-visual-review.json`, `rejected-wardrobe-mage.png`: 실제 장비창 잘림의 실패 증거. `pre-repair-native-contact.png`는 당시 전투 경로의 확인 자료다.
- `models-visual-review.json`, `models-report-12models.json`: 수정된 무기 8종·몬스터 4종의 실제 렌더와 2,065개 자세 검사. 함께 저장한 원본 PNG는 손잡이·날 방향·리그 결합을 보여준다. 모든 패널을 같은 조명으로 렌더했으며 클레이 패널은 형태 확인용이다.
- `monster-rig-review.json`: 새 몬스터 4종의 기존 23개 클립 × 5시점 변형과 기존 본체 그림자 선택을 실제 Three 리그로 확인한 CPU 검사. GPU 시각 승인을 대신하지 않는다.
- `floor-rng-review.json`: 지도 전용 난수 진행·타일 커버리지와 전역 UUID 난수 소비 차이를 구분한 검토. 전역 난수 순서 동일성을 주장하지 않는다.
- `release-readiness.json`: 오프라인 배포 PC와 설치되지 않은 cloud vault로 인한 공개 배포 차단, 인증 PC에서의 재개 명령. 머지는 배포 증거가 아니다.
- `independent-source-review.json`: 실제 5영웅·11개 무기 노드의 그립 수정 전후 수치, 소스 해시, 공유 자원·리그·VFX 검토. 지적한 그립 오류는 수정 후 해소됐으며 추가 소스 결함은 발견하지 못했다.
- `rejected-qa-v5-accumulator.json`: 투영 경계의 top/bottom 초기 Infinity 부호가 잘못된 하네스 실패. 제품을 바꾸지 않고 검사기를 고친 뒤 새 실행으로 재검증했다.
- `final-wardrobe-and-floor-qa.json`, `final-visual-review.json`: 최종 68개 검사와 17개 원본 화면의 직접 시각 검토 PASS. 5영웅 × 3화면폭 × 3회전의 45개 투영 경계, mount/unmount, 로딩·셰이더·JavaScript 오류를 확인했다. 검은 바닥 두 곳은 기존 석재 장식이며 GPT 바닥이 아래에 있음을 실제 raycast로 확인했다.

통합 검사는 `bun run check`(타입 검사·1,787 tests PASS, 4 skip, 빌드 PASS)로 수행했다. 초기 encounter 합계 1MB 초과는 기존 제한을 유지한 채 작은 베벨을 줄여 수정했다. 그립 중심 정렬 오류는 소켓 원점과 방향을 보존하도록 수정했다.

초기 단위·브라우저·시각 실패를 최종 성공으로 덮어쓰지 않는다. 스크린샷용 한글 폰트는 QA 브라우저에만 임시 공급했으며 앱 CSS·배송 폰트·계측 환경은 바꾸지 않았다. 선택적 외부 폰트 CDN과 서비스 워커의 운영 동작은 이 로컬 검사 범위 밖이다.

## 성능 게이트

`candidate-metrics.json`과 `metrics-compare.txt`는 전체 층 절대 밴드 및 기본 상대 기준을 모두 통과했다. 평균 처리 시간 1.36→1.33ms, 드로우콜 388→399이며 +15%/+20% 회귀 한도와 절대 420 draw 한도를 유지했다. 같은 시드·선택 기록·시작 레벨로 12/12 구역을 승리로 완료했다. 예외 시리즈나 실패 표본 제외를 사용하지 않았다.

`baseline-*.png`와 `candidate-*.png`는 계측 환경의 원본 캡처다. 후보 세 장을 기준선과 직접 비교해 지면·무기·몬스터·효과의 로딩과 스케일을 확인했다. 폰트 fixture가 없는 계측 캡처의 한글 사각형은 제품 문자 검수 증거로 사용하지 않는다.

## 자연 RAF와 요청 취소의 한정 판정

`natural-v4-final/`은 늦게 나타난 출석 모달로 진행이 막힌 첫 검사다. `natural-v4-run2/`는 실제 입력 기능 10개를 통과했으나 로비 음원 취소로 strict 네트워크 FAIL을 남긴 원본이다. 결과를 PASS로 덮어쓰지 않았다.

`media-handoff-v1/report.json`은 동일 빌드에서 로비 재생·전투 진입·포기·결과·로비 귀환의 기능 6개를 확인한 별도 원시 관측이다. `qualification-original.json`은 최초 판정이며 `qualification.json`은 동봉한 같은 원시 자료로 재실행한 판정이다. 정확한 report 해시와 한 요청의 native CDP 순서를 연결하고 14개 오류 control을 거부했다. 원래 자연 실행에는 CDP 증거가 없으므로 이 한정 판정을 소급 적용하지 않는다.

재현: 저장소 루트에서 `node docs/qa/dungeon-forge-20261008/qualify-media-handoff.mjs`. 원본 report는 수정하지 않으며 파생 판정 파일만 작성한다. 결과 화면 PNG는 초기 애니메이션 프레임이므로 결과 미술 승인 자료가 아니다. 들리는 음질·실기기·운영 배포 승인은 포함하지 않는다.
