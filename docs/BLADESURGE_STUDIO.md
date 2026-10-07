# Blade Surge 제작 Studio

이번 환경 팩은 `src/game/citadel-hub-scene.js`에서 실제 마을/외곽에 인스턴싱으로 연결했다. 숲·마을은 청크 단위로 배치하고 기존 관문/NPC/충돌/상호작용을 유지한다. 라이브러리의 고립 미리보기와 실제 걷는 카메라 검증을 분리한다. 통합된 마을의 시야·도달성·성능, 물리 휴대전화 GPU·터치·발열은 해당 새 빌드의 실제 QA 근거로 판단한다.

신규 환경 팩은 `public/models/environment/studio-kit/manifest.json`의 실제6종 GLB를 자동으로 읽는다. 제작 사운드는 `public/sfx/crafted/**/manifest.json`의 실제 MP3만 목록/선택 재생하며 한 개 플레이어를 사용한다. SHA-256은 실제 바이트와 비교하고, 길이/peak/RMS는 manifest의 제작 기록이라고 명시한다. 원본 영웅 보이스는 수정하거나 새 목소리로 대체하지 않는다.

실제 GLB 라이브러리, 부서별 소유 작업/차단 상태, 첫 플레이 스토리보드를 하나의 로컬 도구로 확인한다. 기존 게임의 Vite/Three.js와 Blender 제작 파이프라인을 재사용한다. 게임 실행 루프나 APEX의 정책/하네스를 추가하지 않는다.

저장소 루트에서 현재 lockfile로 의존성을 설치한 뒤 실행한다.

```sh
bun run studio
# 또는 직접 실행:
node tools/studio-server.mjs
# http://127.0.0.1:4310
# 다른 포트: node tools/studio-server.mjs --port=4311
```

`public/models/**/*.glb` 실제 파일을 읽어 목록을 만들고 GLB 2 헤더/청크/JSON, 저장 메시의 삼각형 수, 재질 정의, 뼈, clip 이름, 파일 크기와 SHA-256을 표시한다. 같은 폴더/상위 팩의 `manifest.json`에 연결된 해시는 실제 파일과 대조한다. manifest가 없거나 비교할 해시가 없으면 미기록으로 표시한다. 이는 리깅 품질, 실제 renderer의 draw call, 게임 채택/완료, 실기기 성능 승인이 아니다.

기존 Three.js r170 GLTFLoader/MeshoptDecoder/OrbitControls로 모델을 읽고 정면·3/4·뒤 시점, 실제 GLB의 애니메이션 clip과 PNG 저장을 제공한다. 미리보기 조명은 제작 검사용이며 실제 마을·전투 조명을 대신하지 않는다. 다른 모델로 바꾸면 이전 geometry/material/texture와 애니메이션을 정리한다. 숨겨진 탭에서는 렌더와 갱신을 중단한다.

제작 보드는 `tools/studio/board.json`을, 시나리오/장면 라이브러리는 `tools/studio/storyboard.json`을 읽는다. 화면이 열려 있는 동안 5초마다 읽고, 에셋 목록/HEAD 관측은 최대10초 캐시를 사용한다. 각 부서는 자기 항목의 소유 파일·작업·다음 확인·차단과 실제 근거만 갱신한다. 검증되지 않은 일을 완료나 PASS로 적지 않는다. 화면은 파일 기반 공유 기록이며 에이전트의 영구 실행이나 메시지 전송 시스템이 아니다.

2026-10-07의 출시 목표는 10월9일이다. 첫인상(마을/숲/영웅)과 타격(이펙트/소리/동작)의 큰 실제 변화, 다음날 실제 입력/완주/저장/성능 검증, 최종날 증거에 따른 출시 판단 순서로 작업한다. 기존 얼굴·리그·직업·스킬·저장을 보존하고, 자동 지표와 미술/재미 만족을 구분한다. 이전 교정의 근거는 `_autopipe/lobby-identity.md`, `docs/EXPERIENCE_CEILING_V2.md`, `docs/BLADE_SURGE_OVERHAUL_V3.md`, `docs/AAA_QUALITY_LOOP.md`다.

서버는 `127.0.0.1`에만 bind하고 정확한 loopback Host, GET/HEAD만 허용한다. UI 파일, 고정된 Three.js 모듈, 실제 GLB와 그 GLB가 참조하는 로컬 이미지/버퍼만 제공한다. 경로 이탈·symlink·외부 URI를 거절하고 일반 프로젝트 파일/환경 파일/자격증명은 제공하지 않는다. 보드·스토리보드 JSON 읽기와 Git HEAD/branch/현재 tracked 변경 관측 외에 명령 실행 API는 없다. 저장·계정·결제·배포·외부 발송 기능은 없다.

현재 검증 결과는 이 도구를 만든 작업의 실제 보고서/로그로 판단한다. 새 후보에 과거 빌드의 PASS를 옮기지 않는다. 물리 휴대전화 GPU·멀티터치·발열·오디오 청감과 대표님의 최종 체감은 별도 확인한다.

2026-10-07 로컬 Studio에서는 GLB134개 구조 읽기 오류0, 환경kit6종/제작MP312종의 실제 SHA 대조를 확인했다. 실제 Chromium에서 Knight/Rogue5회 교체와 clip재생의 live WebGL texture수가7개로 유지되고, 클릭한 MP3decode/play,6부서/6장면,보드JSON5초갱신과 원문복원,390px세탭의 수평넘침0을 확인했다. CSP가 MeshoptWASM/내장blob texture를 막던 실패와 모바일 catalog의65px 넘침 원본은 보존하고 수리 결과를 별도 기록했다. 로컬 근거는 `/workspace/scratch/bladesurge-studio-qa/final-report.json`과 실제PNG5장이다. 그 경로가 없는 새 환경은 검증을 다시 실행한다. 이 결과는 게임 전체 검사/출시·실기기·청감 품질을 대신하지 않는다.
