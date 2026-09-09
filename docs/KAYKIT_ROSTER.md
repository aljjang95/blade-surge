# KayKit 캐릭터와 Blender 제작 원본

2026-09-09 대표님 요청: 무료 캐릭터 팩을 전부 활용하고, 기존 캐주얼 캐릭터 정체성과 앱 내부 장비 관리를 유지한다. 기존 TLL AI3D 작업은 다른 게임용으로 보존한다.

| 무료 팩 | 캐릭터 | 게임 역할 |
|---|---|---|
| Adventurers 2.0 | Knight | 아르카 · 기사/수호 기사 |
| Adventurers 2.0 | Barbarian | 드라칸 · 광전사 |
| Adventurers 2.0 | Mage | 리아 · 마법사 |
| Adventurers 2.0 | Rogue | 카인 · 도적/기존 바람 추적자 전직 |
| Adventurers 2.0 | Ranger | 실바 · 신규 독립 궁수, 신규·기존 저장 무료 지급 |
| Skeletons 1.1 | Minion, Warrior, Rogue, Mage | 캠페인·원정 적 편성 및 기존 동행 리그 |

무료 모험가 5종과 스켈레톤 4종을 사용한다. Rogue의 후드 외형은 기존 casual-v2에서 유지한다. 유료 EXTRA/SOURCE 캐릭터는 이 무료 에셋 범위에 포함하지 않는다.

- 공식 출처: [Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), [Skeletons](https://kaylousberg.itch.io/kaykit-skeletons). 두 무료 팩은 CC0이며 상업 사용·수정 가능하다.
- Adventurers 2.0 FREE ZIP SHA-256: `abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479`.
- 배포 모델 `public/models/Ranger.glb`: 1,243,280 bytes, SHA-256 `4a1db924132836b29b1a63f55b8031e06eb6ec103037017864859786982727cb`.
- 원본 라이선스: `public/models/KAYKIT_ADVENTURERS_LICENSE.txt`.

## 실바 제작

Blender 5.2.1 LTS와 공식 Blender MCP를 실제 연결해 별도 공방 파일에서 제작했다. 무료 Ranger의 얼굴·중형 리그·화살통·활을 보존하고, 숲색 재킷·어깨 망토·가죽 손목 보호대·분할 코트·장화·가방을 직접 만들었다. 기존 4명의 외형 파일은 변경하지 않았다.

23관절에 연결된 의상과 왼손 활, 직접 제작한 `Bow_Shoot` 동작을 내보냈다. 동일 KayKit 중형 리그의 기존 40개 CC0 동작을 관절명으로 연결해 총 41개 동작을 제공한다. 런타임 리그에 없는 IK 제어 보조 트랙만 제외하며 실제 관절 누락은 패킹 오류로 처리한다.

- 편집 가능한 원본: 작업 결과 `outputs/Silva-Ranger.blend`.
- 제작 코드: `tools/art/author-ranger.py` (Blender MCP), `tools/art/pack-ranger.mjs` (기존 중형 리그 모션 결합).
- 초상화 `public/img/ranger-portrait.webp`는 실제 배포 캐릭터의 Blender 렌더다. 스킬에 쓰는 `public/img/expansion/ranger.webp`는 앞선 GUI 이미지 배치의 실제 궁수 원화다.
- 이식 후 GLB를 Blender에 다시 가져와 Idle/Bow_Shoot/Running_A를 렌더해 확인했다. 원본 장면과 이전 3D 작업물을 덮어쓰지 않았다.

## 게임 동작

5단 콤보에서 일반 화살·3방향 사격·관통·강화 마무리를 사용한다. 집중은 기본 공격과 회피로 얻고 강화 사격에 소비한다. 기본 스킬 3개, 궁극기 1개, 레벨 10/20 각성 2개를 제공한다. 현재 도적의 바람 추적자 전직은 그대로 유지한다.

화살은 실제 활의 세계 좌표에서 발사되고 방향·피격·마무리 타격음이 연결된다. 새 화살은 공용 지오메트리와 회수되는 개별 재질을 사용한다. 단어 없는 기존 도적 기합과 중립 안내 음성을 재사용하며, 다른 캐릭터 이름을 외치는 스킬 음성은 사용하지 않는다.

방어구는 기존 착용 시스템으로 몸통·어깨·허리 관절에 붙는다. 신규·기존 저장 무료 지급, 기존 성장값 보존, 전 동작 계약, 6종 방어구와 4자세, 화살 충돌·재질 회수는 실제 코드/GLB 기반 회귀 검사에 포함된다.
