# Sanctuary + Combat Link V2

## Owner correction and scope

대표님은 V1의 그래픽과 재미 향상이 체감되지 않는다고 평가했다. V1의 기술 PASS를 미적 만족이나 재미의 증명으로 재사용하지 않는다.
최초 시각 후보의 역사적 기준은 main `9dc60d2c50cec28b70d137f41b3a7f252cb32e4d`다. 이번 릴리스 검증·병합 기준은 main `2dd1918c0471f2e207de1f925e2622f6d65b9ab3`이며, 실제 rollback 기준은 배포 영수증의 직전 운영 버전이다. 같은 모바일 가로 화면과 같은 캐릭터·플레이 단계에서 비교한다.
APEX Universal Harness 안의 현재 Blade Surge 작업만 수행한다. 이전 owner-goal와 Living Constitution을 상속한다. 타 프로젝트/새 provider/권한/가격/과금 변경은 없다.
기존 전투·Blender 도구와 QA 어댑터를 재사용한다. 새 외부 하네스나 배경 감독자는 만들지 않는다.

## 시각적 후보

- 평평한 원경 대신 두 겹의 아치, 실제 입체 수목, 문장 직물, 조각 기둥, 조명 기구, 스테인드글라스를 만든다.
- Blender 원본 `art/sanctuary-v2/sanctuary-v2.blend`의 개별 구성 요소와 카메라/조명은 편집 가능하다.
- 게임용 `public/models/sanctuary-v2/sanctuary-v2.glb`: 8배치, 35,371삼각형, 3,353,184 bytes. 실제 지오메트리 기반 5-ray AO를 vertex colour로 내보낸다.
- 이 기능은 영웅 모델을 추가 교체하지 않는다. 통합본은 최신 main의 V3 영웅·카메라·입력 수정을 보존한다. 이미지 위에 모델을 얹은 목업을 인게임 증거로 쓰지 않는다.
- 메인 조명과 청색 주변광을 분리하고 석재는 Lambert, 금속은 PBR, 창/등은 unlit으로 예산을 나눈다.
- 로비에서 세 기예의 무료 선택을 바로 노출한다. 기존 저장 서비스를 통해 적용한다.
- 전투의 일반 피해 숫자는 4개, 치명/마무리 우선 표시는 8개 내에서 추가한다. 실제 피해·피격·보상 계산은 이 표시 제한과 별개다.
- 화면 전체 흔들림·방사형 블러·색수차·움직이는 그레인을 추가하지 않는다.

## 체감 가능한 전투 변경: 마무리 → 기본 스킬

캠페인에서 직접 기본 콤보 마무리가 실제 명중하면 3초간 연계 기회가 열린다. 이때 기본 스킬이 실제 발동하면 현재 기예를 실행한다.
파열은 기존 공격력 60%/최대2명, 수호는 기존 최대HP12%/5초, 순환은 기존 일반 스킬1개/CD-2초를 재사용한다.
숫자를 무조건 올린 것이 아니라 발동 조건을 추가한 것이다. **발동 빈도와 전투 결과는 달라질 수 있으며, 밸런스가 동일하다고 주장하지 않는다.**
최소 간격은 8초다. 새 장비·레벨 해금·재화·영구 스탯은 필요 없다. 궁극기와 각성 스킬은 이 추가 연계의 마무리로 쓰지 않는다.
기존 균형 파괴 기예 경로는 유지한다. 같은 스킬에서 이미 기예가 발동했으면 추가 연계를 중복 실행하지 않는다.

### Safety boundaries

연계는 적중한 기본 공격의 token/발사 주체/생명 epoch를 검사한다. 한 번의 광역 마무리로 창을 반복 연장하지 않는다.
스킬 입력만으로 지급하지 않고 해당 스킬의 실제 cast 지점에서 소비한다. 빗나감, 취소, 사망 후 부활, 다른 영웅, 일시정지, 결과 정산 후에는 과거 기회를 지급하지 않는다.
파티·원정·정복·AI 경기장은 추가 연계를 끈다. 다른 모드의 보상/목표/네트워크 계약을 확장하지 않는다.
기예 선택은 원래 Arsenal transaction을 사용하며 저장 실패를 성공으로 표시하지 않는다.
일시정지 진입은 준비된 기회를 즉시 취소한다. 이미 소비한 연계의 8초 활성 게임시간 간격은 초기화하지 않는다.
연계 파열은 원래 마무리 대상을 제외한 가까운 다른 적 최대 2명만 타격한다. 토큰만 있고 실제 발사 주체가 없는 타격은 연계를 적립하지 않는다.
준비 안내와 발동은 기준점에서 12유닛 이내라는 동일한 거리 조건을 사용한다. 거리 밖에서는 준비 안내를 숨기며, 원래 3초가 지나기 전에 복귀하면 남은 기회를 사용한다. 왕복이나 거리 밖 스킬 사용으로 만료·재사용 간격을 늘리지 않는다.

## Verification

- `bun test` / `tsc --noEmit` / native Vite build.
- `tools/experience-combat-qa.mjs`: 새 Lv1·빈 인벤토리에서 실제 이동/기본 공격 입력 뒤 기존 스킬 버튼으로 파열·수호·순환 효과를 확인한다. 제어된 입력이며 인간 플레이테스트로 부르지 않는다.
- `tools/oath-behavior-qa.mjs`: 메뉴·취소·네브·전투 설계, 영웅별 가림, 10회 전환 자원, 640×360과 세로 opt-in을 확인한다.
- `tools/oath-performance-qa.mjs <baseline>`: 같은 브라우저/품질/해상도 ABBA. 매 표본 실제 render 1회와 readPixels 완료를 확인한다. 예전 gl.finish 단독 표본은 성능 승인에 쓰지 않는다.
- `tools/art/verify-sanctuary-v2.py`: 저장한 .blend를 다시 열어 runtime GLB와 재export bytes를 대조한다.
- 기존 natural full-floor, 3빌드, 저장·직행 optional flags, MP, 회피, 파티와 원정 회귀를 별도로 유지한다.
- 독립 reviewer가 exact diff와 실제 전후 캡처를 본다. builder의 PASS 선언은 승인 근거가 아니다.

## Primary reference and reused domain baseline

- Blender glTF material/vertex-colour export: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html
- Epic environment-lighting principles (분위기·가독성·표면 구분의 참고; 엔진 교체는 아님): https://dev.epicgames.com/documentation/unreal-engine/artist-02-light-a-scene
- Reused project contracts: `APEX_COMBAT_CRAFT_PATCH.md`, `OATHHALL_VISUAL_V1.md`, existing frame/collision/save/proc tests.

광원과 공간 구성의 참고일 뿐 특정 작품의 아트나 전투 수치를 복제하지 않았다.
사람의 재미 선호·미적 만족, 실제 Android/iOS 멀티터치·발열·FPS는 기술 검증과 분리한다. 프로덕션 반영은 exact-head 검증과 독립 검토 후 기존 rollback/lease 가드로 진행한다.
