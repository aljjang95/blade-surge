# V3 독립 검토

판정: **SEVERITY=CONCERN — 실제 게임 검증 대기**. 검토한 정지 렌더와 코드에서 출시를 차단할 확정 결함은 발견하지 못했다. 이 판정은 게임 플레이·GPU 실행·기기 품질 통과를 뜻하지 않는다.

검토일: 2026-09-16. 구현 작성과 분리된 독립 reviewer가 수행했다. 구현·자산은 수정하지 않았고 이 검토 문서만 작성했다.

- 기준 구현 HEAD: `a30a3ec8fcba6e46cf9290c64ea5a19cb1a5950e`.
- 검토 manifest SHA-256: `03dd9daf1a32536ee75e199c1d4ab837c0c6151d85030f7bbdb22ddbc60c7ae6`.
- 기준선: `1fcd4d82679b24c8073d2fc27631e2664840ad3f`.
- 정본 checkout: `C:/Users/Administrator/Developer/repos/blade-surge`.
- 이관 전 `C:/APEXHUB/blade-surge`에서 직접 연 20개 이미지와 정본의 SHA-256을 대조하여 동일함을 확인했다.

## 직접 확인한 범위

1. `art/heroes-v3/`의 knight/barbarian/mage/rogue/ranger 각각 baseline, three-quarter, profile, clay PNG를 이미지 도구로 직접 열어 확인했다. 총 20장이며 front PNG는 이번 독립 검토 범위에 포함하지 않았다.
2. 기존 코드 대비 camera-control, battle-framing, battle-base, input, hero-beacon, fx, rpg-battle, renderer, hero-identity, assets 변경을 읽고 입력 소유권·해제, 가까운 위협과 수동 구도, 표식의 리소스 해제, 기존 스킨 보존 경로를 검토했다.
3. manifest의 다섯 출력 GLB와 다섯 원본 GLB SHA-256을 실제 파일과 독립 대조하여 모두 일치함을 확인했다.
4. 기존 자동 검사의 소스와 증거 경계를 검토했다. 메인이 보고한 전체 검사 및 CPU 포즈 검사를 반복 실행하지 않았다. CPU 검사는 이미지 참조를 메모리 복사본에서 제외하므로 GPU/텍스처/실제 애니메이션 외관의 증거가 아니다.

## 아트 관찰

- knight/rogue 곡면 어깨가 몸에 부착된 형태로 읽히고 이전 판금 겹침 문제는 검토한 각도에서 해소되었다.
- mage 허리의 작은 겹침 조각은 연속 띠로 정리되었다. three-quarter/profile/clay에서 이전 speck 결함을 확인하지 못했다.
- 각 영웅의 기존 얼굴·무기와 주요 실루엣은 같은 조건 baseline 대비 유지된다. 남청/적갈/보라/청록의 의상 면적 대비가 강화되었다.
- **낮은 우선순위 polish concern:** `tools/art/build-heroes-v3.py:134`의 ranger 잎 어깨가 `ranger-profile.png`에서 목 아래에 거의 수평으로 돌출되어 얇은 판처럼 읽힌다. three-quarter/clay에서도 층 사이가 평평하다. 몸을 감싸는 곡률과 돌출 폭을 조절하는 후보를 비교할 수 있다. 실제 게임 크기에서의 영향은 아직 검증하지 않았다.
- **낮은 우선순위 polish concern:** `barbarian-profile.png`의 둥근 상완에 적갈색/피부색 경계가 톱니처럼 보인다. 새 색 대비에서 두드러지는 기존 형상 접합으로 보이며 확정 회귀로 분류하지 않는다. 수정한다면 원본을 보존한 별도 후보에서 경계 맞춤만 검증한다.

이 두 polish concern은 단독 출시 차단 사유가 아니다. 이후 자산이 바뀌면 변경된 이미지·해시에 한해서 재검토한다.

Blender 담당자는 동일 profile을 확인한 뒤 이번 후보를 유지하기로 했다. 담당자 설명상 ranger는 원본 활 포즈와 upperarm 부착 때문에 잎이 전방으로 눕고, barbarian 경계는 원본 구체의 재질 분할에서 온다. 이 설명을 추가 수정 완료의 증거로 처리하지 않으며 두 관찰은 현재 후보의 외관 한계로 남긴다.

## 코드 검토 결과와 남은 경계

검토 범위에서 확정된 차단 결함을 발견하지 못했다. ranger V3는 392 vertices의 장식 fitting이며 기존 TLL 스킨을 보존하는 경로와 맞는다. 입력원별 공격 해제, pause/blur 시 카메라 capture 종료, 수동 프리셋의 군중 줌 제외, beacon material/texture 해제가 코드에 존재한다. 코드 존재만으로 실제 이벤트 전달·GPU 결과를 통과 처리하지 않는다.

다음 증거는 이번 reviewer에게 제공되지 않았고 직접 검증하지 않았다:

- 동일 환경에서의 실제 게임 전후 캡처 및 플레이 동작.
- 일반전·혼전·보스·승리/패배·재출격, 회전 후 이동·동시 입력·pause 복귀.
- 작은 화면, low/reduced motion, 실제 GPU 오류·리소스 회수.
- 기기 멀티터치·발열·오디오 청취·사용자 FELT.
- 새 운영 live SHA와 운영 플레이 확인.

IAB 사용 불가 상태와 대체 브라우저 승인 경계에 따라 이 reviewer는 브라우저 자동화를 실행하지 않았다. 정지 렌더는 Blender 스튜디오 결과이며 게임 화면이 아니다. 실제 플레이 증거 검토 전에는 출시 PASS 또는 하이엔드 완성으로 승격하지 않는다.

## 검토 시점 출력 GLB SHA-256

| 영웅 | SHA-256 |
|---|---|
| knight | `1a462698a80c3205ad400a8215cae24720caf9369454e4f935174be51e1f0a99` |
| barbarian | `f6eaa6efc41aa78fdc558dd1f6a9ea4dd90201ccb3b8043d22efb624b6309d04` |
| mage | `ef437a50724928a8e22c75d5ff7ddf5d4b7d061ba3e38553c2d2094bb60d1fac` |
| rogue | `cf16c0e0c4cc226f32f60909f694f696394479048f6a97b76af14ce5cba04648` |
| ranger | `25a4ff71bf959bd9ffa41cd4c068a13f47eb6992502a09b764266345b7cb948b` |

## 후속 Supervisor 실제 브라우저 검증 — 2026-09-17

이 절은 위 독립 reviewer의 당시 판정을 덮어쓰지 않는다. reviewer가 요구했던 실제 게임 증거 중 자동화로 재현 가능한 부분을 별도 Supervisor가 사용자 승인 이후 같은 정본 checkout에서 수행한 후속 증거다.

- 기준 HEAD: `a30a3ec8fcba6e46cf9290c64ea5a19cb1a5950e`.
- Chrome `153.0.8010.37`, 로컬 production build, 격리된 저장 상태에서 `tools/overhaul-v3-gameplay-qa.mjs` 실행: **23/23 PASS**, browser exception 0.
- 우클릭 카메라 회전, wheel zoom, yaw -90/0/90/170에서 camera-relative 수동 이동, pause 시 camera capture 해제, 독립 공격 입력원 release, 실제 근접 피해, 880×400/640×360 high 및 low+reduced-motion 플레이어 가시 경계를 실행 검증했다.
- 보고서: `work/overhaul-v3/gameplay/report.json`, SHA-256 `c5d92b99ace1ddeb22a2f0af064e56509739f6653bd739b5fbb430be6ea04039`. 캡처: `contact.png`, `battle-880-high.png`, `battle-880-low-reduced.png`, `battle-640-high.png`, `battle-640-low-reduced.png`.
- 외부 요청 1건은 Google Fonts CSS GET이며 QA route가 차단했다. 따라서 이 실행은 외부 폰트 네트워크 성공을 주장하지 않는다.
- 기존 `tools/knight-build-qa.mjs`도 같은 Chrome에서 **PASS**: 실제 WebGL renderer 문자열을 기록했고, 세 preset 변형(return/fissure/pierce)의 실제 스킬 피해와 보스전 승리 3/3, browser error 0, 외부 write 0을 확인했다. 보고서 SHA-256 `25d3eb6ed03911cbd287827915d7f8a07e8979c509f0a3c0960297814f73850e`.
- Blender 5.2.1 LTS에서 `tools/art/verify-heroes-v3.py` 재실행: 다섯 `.blend` 재오픈, packed reference, 다섯 delivery GLB 재import 및 해시 검증 **PASS**.
- `bun run check` 재실행: typecheck, **896 pass / 1 skip / 0 fail (102 files)**, production build PASS.

따라서 위 목록의 “동일 환경 실제 게임 동작”, “카메라 회전 후 이동·동시 입력·pause”, “작은 화면·low/reduced motion”, “실제 보스전”은 후속 자동 브라우저 증거가 추가되었다. 다만 물리 기기 멀티터치·발열·주관적 오디오/FELT, 장시간 실제 GPU 성능/누수, 운영 배포 후 live SHA와 운영 플레이는 이 절의 증거가 아니며 별도 게이트로 남는다.