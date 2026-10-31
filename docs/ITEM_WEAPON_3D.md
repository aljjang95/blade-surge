# 장비 무기 3D (Tripo GLB)

장비 무기 id별 Tripo GLB를 검성(knight kit) 손 무기로 쓰는 경로. 아이콘의 정체성을 그대로 옮긴 3D가 전투·로비·착용(`applyLook`), 드롭 모델(`loot-models.js`), 아이템 상세 3D 미리보기(`item-visual-model.js`)에 같은 진입점으로 나온다.

## 범위

- 영웅 무기 8형태 전부: `sword`·`greatsword`·`axe`·`greataxe`·`wand`·`staff`·`dagger`·`bow`(`forged-weapons.js` `FORGED_WEAPON_FORMS`). 어떤 영웅이 등급별로 어느 형태를 드는지는 `look.js` `LOOKS`가 정한다.
- 매니페스트 키는 `(id, form)`. 같은 장비 id가 형태마다 GLB를 하나씩 가질 수 있고(검성 검 + 광전사 도끼 …), 요청 형태의 항목이 없으면 항상 null → 절차적 무기. 같은 id의 다른 형태 모델은 붙지 않는다.
- 파일명: `sword`·`greatsword`는 기존 그대로 `public/models/item-weapons/<id>.glb`(기존 42자루는 이동하지 않음), 나머지 형태는 `<id>--<form>.glb`.

## 규약 (등록 도구가 강제)

| 항목 | 규약 |
|---|---|
| 길이축 | 가장 긴 축이 +Y. 날 끝이 +Y, 손잡이 끝이 -Y(활은 위아래 대칭) |
| 원점 | 손잡이 중간. 전체 길이의 아래 18% 지점(허용 5~40%, 활은 중앙 40~60%). 길이축 min<0<max 필수(`fitForgedWeapon` 계약). 형태별 권장값은 아래 표 |
| 구성 | 메시 1개, 프리미티브 1개, 재질 1개, 노드 변환 항등 |
| 예산 | 삼각형 목표 3000, 상한 4000. 파일 2MB 이하 |
| 재질 | 텍스처 1024px 이하, GLB 안에 포함. 정점색(COLOR_0)·스킨·애니메이션 없음 |
| 빛 | 런타임이 `MeshStandardMaterial`(emissive 0, emissiveMap 없음)로 다시 만든다. 강화 빛은 `look.js`가 emissive를 칠하고, `excludeFromBloom`·광륜(`syncWeaponHalo`: 메시 bbox 긴 축·원점 먼 쪽 45%를 날로 봄)은 절차적 무기와 같은 경로로 동작한다 |

## 형태별 템플릿 규약 (형태 GLB는 이 좌표로 만든다)

`fitForgedWeapon`은 템플릿(`public/models/dungeon-forge-v2/forge-<form>-v2.glb`)에만 도끼 PI(Y축)·활 rotateX(PI/2) 보정을 하고, 장비 GLB 지오메트리도 같은 맞춤을 거친다. 그래서 GLB는 보정 전의 템플릿 좌표(+Y 길이축, 원점 = 손잡이)로 만든다. 실측(템플릿 bbox):

| 형태 | 손잡이 원점(길이 대비, 아래에서) | 가로 방향 규약 | 권장 prep 플래그 |
|---|---|---|---|
| sword | .156 | 날 폭이 X | `--grip-ratio 0.16` |
| greatsword | .12 | 날 폭이 X | `--grip-ratio 0.12` |
| axe | .244 | 날(머리)이 +X | `--grip-ratio 0.24 --wide-x --face-x pos` |
| greataxe | .209 | 양날 대칭(X 폭이 큼) | `--grip-ratio 0.21 --wide-x` |
| wand | .168 | — | `--grip-ratio 0.17` |
| staff | .21 | — | `--grip-ratio 0.21` |
| dagger | .216 | — | `--grip-ratio 0.22` |
| bow | .5 | 활대 대칭. 활대 중간 굽이가 -X, 손잡이가 +X | `--grip-ratio 0.5 --wide-x --face-x neg --face-region all` |

- `--wide-x`: 길이축을 +Y로 맞춘 뒤, 수평 두 폭 중 큰 쪽이 glTF X에 오게 길이축 둘레로 90도 돌린다.
- `--face-x pos|neg`(`--wide-x` 뒤에 적용): `--face-region`(`top`=길이 위쪽 40%, `all`=전체; 기본 top) 정점의 중심 X가 손잡이 높이(원점 ±5%) 가로 중심 기준으로 요청한 쪽이 아니면 길이축 둘레로 180도 돌린다. 도끼는 머리(위쪽)가 +X, 활은 전체 중심(굽이)이 -X.
- 두 플래그 모두 기본 꺼짐이라 안 쓰면 prep 출력은 이전과 바이트 동일하다. 선택한 회전은 보고 JSON `orient`(`wideX`·`faceX`·`faceCentroidX`)에 남는다. 이 두 플래그는 Blender로 실행해 확인한 것이 아니라 코드만 검토했다(이 환경에 Blender 없음): 첫 사용 때 `--report`의 `orient`와 bbox를 확인한다.

## 런타임 흐름

1. `src/data/item-weapon-glb.json` `{ items: [{ id, form, file, sha256, bytes, triangles, source: { tripoTaskId, concept } }] }` (처음엔 빈 배열).
2. `forgeHeroWeapons`(영웅 무기 템플릿 로딩)와 상세 미리보기가 `preloadItemWeaponGlbs()`를 한 번만 await. 실패는 항목별로 `console.warn` 1회 후 null.
3. `item-forge.js`: `buildItemGeometry`(GLB 지오메트리 복제), `acquireItemGeometry`(캐시 키에 `:glb`), `createItemMaterial(item, form)`(GLB 재질 복제)가 `itemWeaponGlb(id, form)`(키 `${id}:${form}`)이 있을 때만 분기. 소켓 맞춤은 기존 `fitForgedWeapon`이 그대로 한다.
4. 프레임 루프에서는 할당이 없다(선로드 캐시 조회만). 시뮬레이션 결정성(`app.step`)과 무관한 표시 경로다.

## 제작 흐름

Tripo 원화(아이콘 정체성, Nano Banana 9:16) → H3.1 생성(2K·PBR·Polycount 3000이면 Retopo 생략, 실측 자루당 약 86크레딧) → `blender_weapon_prep` → `register-item-weapon` → `bun run check`.

```bash
blender -b --python-exit-code 1 --python tools/asset-library/blender_weapon_prep.py -- \
  --input <tripo.glb> --output <prepped.glb> --report <report.json> \
  [--grip-ratio 0.18] [--grip-end bottom|top] [--flip] [--wide-x] [--face-x pos|neg] [--face-region top|all] [--target 3000] [--max 4000] [--texture-max 1024]
node tools/art/register-item-weapon.mjs --id <itemId> --form sword|greatsword|axe|greataxe|wand|staff|dagger|bow --input <prepped.glb> --taskId <tripoTaskId> [--concept "..."]
bun run check
```

- 정리 스크립트: 모든 메시 합치기(재질 1개) → 가장 긴 축을 +Y로 → `--flip`/`--grip-end top`으로 손잡이를 아래로 → 원점을 손잡이 끝에서 길이×grip-ratio 지점으로 → 삼각형 감축 → 정점색·스킨·애니 제거 → 텍스처 축소 → GLB와 JSON 보고(삼각형, bbox, 원점 검사). 규약 위반이면 종료 코드 1.
- 장식(헤일로 등)이 날 뒤에 떠서 생성되면 `blender_weapon_center_islands.py`로 본체 두께 중심에 맞춘 뒤 prep을 다시 돌린다(4차 gear_weapon_l_2·l_3).
- 날이 -Y로 나오면 `--flip`. 손잡이가 위에 있으면 `--grip-end top`.
- 등록 도구: `public/models/item-weapons/<id>.glb` 복사, sha256·bytes·triangles 기록, 규약·예산 검사(위반이면 아무것도 쓰지 않고 실패).
- 시험용 픽스처는 `test/fixtures/item-weapon-sword-prepped.glb`(forge-sword-v2를 눕혀 정리 스크립트로 복원한 것). 매니페스트에는 넣지 않는다.

## 다음 단계 (2026-10-30)

- 2차(기본 드롭 11: w_iron·w_wood·w_cleaver·w_steel·w_bronze·w_guard·w_flame·w_rune·w_knight·w_dragon·w_sun) 등록 완료. 1차 4자루와 합쳐 매니페스트 15자루. 3차(U 테마 9) 전부 등록(w_storm·w_blood·w_gravity·w_phoenix·w_rime·w_plague·w_sigil·w_chain·w_void, 총 24자루). 4차 도감·마을 15 + 5차 원정 3 등록(총 42자루), w_blood는 검붉은 날로 재생성(2026-10-30, Tripo heartytn 계정).
- 나머지 검성 무기(1·2차 제외)의 우선순위·참조 아이콘: `art-src/gear-icons/weapon-3d-queue.json`(2차 기본 드롭 11 → 3차 U 테마 9 → 4차 도감·마을 15 → 5차 원정 3). 병기고 6종은 병기고 GLB 경로, 소환 2종은 검 형태가 아니라 제외.
- 다른 직업 형태(광전사 도끼, 마법사 지팡이, 도적 단검, 궁수 활): 런타임·등록 도구는 8형태를 받도록 넓혔다(매니페스트 키 `(id, form)`). 형태별 원화를 같은 아이콘 정체성으로 만들어 등록한다. 그때 `public/img/item-renders/forms/` 215장(옛 그림)도 같은 톤으로 다시 그린다.

- 활은 prep 뒤 `blender_bow_align.py`로 손잡이→활 끝 벡터를 +X 로 맞추고 prep(`--grip-ratio 0.5`, 회전 플래그 없이)을 다시 돌린다. `--face-x`의 무게중심 판정은 활에서 방향이 반반 갈렸다(2026-10-30 2차, 1차 w_hunter·w_rusty 활 반대 방향 수정).
