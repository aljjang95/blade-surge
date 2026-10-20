# 캐릭터 에셋 로스터

현재 게임 적·보스·동행은 `asset-library/manifest.json`의 소유 생성 라이브러리 자산을 `src/data/monster-roster.js`로 선택한다. Tripo/Mixamo 제작 몬스터가 없거나 로드에 실패하면 같은 manifest의 지정 fallback만 사용한다.

| 범위 | 런타임 자산 | 계약 |
|---|---|---|
| 영웅 | Adventurers 계열과 TLL 영웅 라이브러리 | 기존 영웅 외형·장비·저장 ID 유지 |
| 적·보스 | `bone_knight`, `skeleton_mage`, `goblin_brute`, `goblin_raider`, `goblin_chief`, `shadow_soldier`, `frost_yeti`, `demon_lord`, `mushroom_shaman`, `slime`, `ember_drake`, `void_wisp`, `fire_phoenix`, `star_owl` | profile·hover·impacts·논리 클립은 manifest가 소유 |
| 동행 | `skeleton_mage` | companion 별칭은 library 논리 클립을 사용 |

KayKit Adventurers 영웅 원본과 해당 라이선스 기록은 영웅 호환성을 위해 보존한다. 무료 몬스터 GLB와 encounter 장식 조립 파일은 런타임·빌드에서 제거했다. 적 모델 이름은 저장·스테이지 호환성을 위해 유지하고 실제 자산 선택은 로스터에서만 한다.

검증 기준은 `bun run typecheck`, `bun test`, `bun run build`와 `rg` 무료 몬스터 참조 검사다. 이 문서는 소유 생성 자산의 Tripo 원본·리깅·애니메이션 provenance를 대신하지 않는다.
