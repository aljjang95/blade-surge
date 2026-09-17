# V3 검증 경계와 RSI

기준선: `1fcd4d82679b24c8073d2fc27631e2664840ad3f`, 동일한 기존 live SHA를 서비스 버전 API로 확인했다. 기준 빌드는 로컬 `work/overhaul-v3/baseline`에 고정했다.

## 적용 후보

Blender 5.2.1 LTS로 다섯 영웅의 별도 복장을 제작했다. 원본 얼굴/리그/클립·성장 수치는 보존한다. 다섯 개 GLB와 편집 원본, 동일 조건 전후·정면·측면·클레이 렌더는 `art/heroes-v3/`와 `public/models/heroes-v3/`에 있다.

전투 카메라는 근처 위협에만 반응하고 이동·락온 편향을 제한한다. 혼전에서도 플레이어의 머리 위 표식·발밑 방향·가려진 얼굴을 읽도록 했다. 타격은 국소 방향성 섬광과 짧은 입자로 표현하고 전체 화면 흔들림은 추가하지 않았다. 입력원별 소유권과 pause/blur 정리를 분리했다.

## 실제 수행한 검증

- 로컬 Bun 타입 검사·전체 테스트·production build.
- 실제 영웅 GLB 5종의 필수 애니메이션 69개, 207 포즈 수치 검사. 원본 이미지 참조만 메모리 복사본에서 제외한 CPU 검사이며 실제 렌더 증거가 아니다.
- Blender에서 각 파일을 렌더하고 직접 이미지를 열었다. 기준과 후보는 동일한 스튜디오 카메라/조명이다.
- 독립 코드 리뷰: 자산 원본 보존, 관절 이름, 자원 해제, 기존 shader preparation 경로 확인. 실제 게임 GPU 실행 검증은 남아 있다.
- 독립 이미지 리뷰에서 복잡한 어깨 접합을 지적했다. 별도 수정으로 덧댄 판금을 곡면 갑옷으로 교체하고 광전사 돌기·마법사 허리 겹침을 정리했다.

## RSI에서 발견하고 수정한 것

1. 원본 GLB의 이름 없는 하위 메시가 Blender에서 다른 이름으로 표시되어 미리보기 얼굴이 숨겨졌다. 원본을 바꾸지 않고 디코딩한 검사용 복사본에서 상위 부위 이름을 전달했다.
2. Blender가 가져온 원본의 현재 포즈와 바인딩되지 않은 복장 T-pose가 달랐다. 스튜디오용 복장에도 같은 원본 armature를 적용했다. 런타임 GLB는 별도로 rest fitting을 내보낸다.
3. 덧댄 어깨판과 기존 둥근 어깨의 겹침을 독립 리뷰가 지적했다. 후보에서 해당 어깨만 교체하고 baseline render에는 원본을 유지했다.

원본은 `main`에 그대로 있으며 브랜치 폐기 또는 해당 커밋 revert로 되돌릴 수 있다. 기존 배포 도구의 lease/clean HEAD/선행 live SHA/rollback 검증을 유지한다. 이 작업은 제품 한 개의 foreground 개선이며 전 세션 수집·Supervisor 활성화·예약 RSI 실행을 뜻하지 않는다.

## 아직 수행하지 못한 검증

현재 세션은 IAB가 `Browser is not available: iab`를 반환했다. 사용자 전역 IAB 규칙에 따라 Chrome/Playwright로 바꾸어 실행하지 않았다. 게임 검증에 한한 로컬 Playwright 예외를 요청했으며 답변 전에는 다음 작업을 실행하지 않는다.

- 동일 빌드의 실제 전투 전후 화면, 저사양·reduced motion, 카메라 회전/재중심과 실제 입력.
- 일반전·혼전·보스·승리/패배·재출격, FPS가 아닌 명시된 환경의 frame time과 GPU 자원 회수.
- 실제 기기 멀티터치·발열·오디오 청취·대표님 FELT.
- 승인된 기존 배포 도구를 통한 원격 반영 및 새 live SHA.

따라서 현재 산출물은 **검증 중인 개선 후보**이며 하이엔드 완성·전체 게임 QA 통과·운영 배포 완료로 표시하지 않는다.

## 재개 순서

IAB를 사용할 수 있으면 해당 브라우저에서 검증한다. 로컬 Playwright 예외가 승인되면 `node tools/oath-behavior-qa.mjs --baseline --source=work/overhaul-v3/baseline`, `node tools/oath-behavior-qa.mjs`, `node tools/knight-build-qa.mjs`, 관련 실제 카메라/타격 입력 추가 검사와 캡처를 실행한다. 실패는 기준을 낮추지 않고 후보를 수정한다.

관련 검증과 독립 검토 후 clean commit/PR merge, `node tools/deploy.mjs --auth=wrangler` 및 live 버전·실제 플레이 확인으로 이어간다. Wrangler 인증/lease는 실행 시 다시 확인하며 확인하지 않은 계정 상태를 준비 완료로 주장하지 않는다.

## 2026-09-17 승인 후 실제 브라우저 검증 추가

기존 “IAB 사용 불가로 실제 게임 검증 미수행” 기록은 당시 사실로 보존한다. 이후 사용자 승인 아래 로컬 설치 Chrome을 명시해 동일 후보 HEAD `a30a3ec8fcba6e46cf9290c64ea5a19cb1a5950e`를 추가 검증했다.

- `tools/overhaul-v3-gameplay-qa.mjs`: 23/23 PASS, browser exception 0. 카메라 회전/줌, 네 방향 yaw의 camera-relative 수동 이동, pause/capture 정리, 독립 공격 입력, 근접 실피해, 880×400·640×360 high/low/reduced-motion 가시성을 실행했다.
- `tools/knight-build-qa.mjs`: 세 전투 build의 실제 스킬 피해·보스전 승리 3/3 PASS, browser error 0, 외부 write 0. GPU는 이 환경의 Chrome/ANGLE SwiftShader로 기록되므로 실제 단말 GPU 성능 증거로 확대하지 않는다.
- Blender 5.2.1 LTS 재오픈/GLB import/hash 검증 5/5 PASS.
- `bun run check`: typecheck + **896 pass / 1 skip / 0 fail (102 files)** + production build PASS.

이로써 로컬 자동화로 확인 가능한 실제 입력/전투/작은 화면/저품질·reduced-motion 게이트는 증거가 생겼다. 물리 기기 멀티터치·발열·주관적 오디오/FELT, 장시간 실제 GPU 성능 및 운영 배포 후 live 검증은 계속 분리한다. 운영 승격은 clean commit/merge 및 기존 lease/live-SHA/rollback 가드를 통과한 뒤 판단한다.