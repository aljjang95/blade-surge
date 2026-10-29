# 장비 무기 3D (Tripo GLB)

장비 무기 id별 Tripo GLB를 검성(knight kit) 손 무기로 쓰는 경로. 아이콘의 정체성을 그대로 옮긴 3D가 전투·로비·착용(`applyLook`), 드롭 모델(`loot-models.js`), 아이템 상세 3D 미리보기(`item-visual-model.js`)에 같은 진입점으로 나온다.

## 범위

- 검성의 `sword`(N/S/E, `1H_Sword`)와 `greatsword`(U/L, `2H_Sword`)만. 무기 모양은 (영웅 kit, 등급)이 정한다.
- 도끼·지팡이·완드·단검·활과 다른 영웅은 이번 범위 밖이라 기존 절차적 무기(`item-forge.js` `buildItemGeometry`)를 그대로 쓴다.
- 매니페스트의 `form`이 요청 형태와 다르면 항상 null → 절차적 무기. 검성 외 영웅에게 검 모델이 붙지 않는다.

## 규약 (등록 도구가 강제)

| 항목 | 규약 |
|---|---|
| 길이축 | 가장 긴 축이 +Y. 날 끝이 +Y, 손잡이 끝이 -Y |
| 원점 | 손잡이 중간. 전체 길이의 아래 18% 지점(허용 5~40%). 길이축 min<0<max 필수(`fitForgedWeapon` 계약) |
| 구성 | 메시 1개, 프리미티브 1개, 재질 1개, 노드 변환 항등 |
| 예산 | 삼각형 목표 3000, 상한 4000. 파일 2MB 이하 |
| 재질 | 텍스처 1024px 이하, GLB 안에 포함. 정점색(COLOR_0)·스킨·애니메이션 없음 |
| 빛 | 런타임이 `MeshStandardMaterial`(emissive 0, emissiveMap 없음)로 다시 만든다. 강화 빛은 `look.js`가 emissive를 칠하고, `excludeFromBloom`·광륜(`syncWeaponHalo`: 메시 bbox 긴 축·원점 먼 쪽 45%를 날로 봄)은 절차적 무기와 같은 경로로 동작한다 |

## 런타임 흐름

1. `src/data/item-weapon-glb.json` `{ items: [{ id, form, file, sha256, bytes, triangles, source: { tripoTaskId, concept } }] }` (처음엔 빈 배열).
2. `forgeHeroWeapons`(영웅 무기 템플릿 로딩)와 상세 미리보기가 `preloadItemWeaponGlbs()`를 한 번만 await. 실패는 항목별로 `console.warn` 1회 후 null.
3. `item-forge.js`: `buildItemGeometry`(GLB 지오메트리 복제), `acquireItemGeometry`(캐시 키에 `:glb`), `createItemMaterial(item, form)`(GLB 재질 복제)가 `itemWeaponGlb(id, form)`이 있을 때만 분기. 소켓 맞춤은 기존 `fitForgedWeapon`이 그대로 한다.
4. 프레임 루프에서는 할당이 없다(선로드 캐시 조회만). 시뮬레이션 결정성(`app.step`)과 무관한 표시 경로다.

## 제작 흐름

Tripo 원화(아이콘 정체성) → H3.1 생성 → Retopo 3000 → `blender_weapon_prep` → `register-item-weapon` → `bun run check`.

```bash
blender -b --python-exit-code 1 --python tools/asset-library/blender_weapon_prep.py -- \
  --input <tripo.glb> --output <prepped.glb> --report <report.json> \
  [--grip-ratio 0.18] [--grip-end bottom|top] [--flip] [--target 3000] [--max 4000] [--texture-max 1024]
node tools/art/register-item-weapon.mjs --id <itemId> --form sword|greatsword --input <prepped.glb> --taskId <tripoTaskId> [--concept "..."]
bun run check
```

- 정리 스크립트: 모든 메시 합치기(재질 1개) → 가장 긴 축을 +Y로 → `--flip`/`--grip-end top`으로 손잡이를 아래로 → 원점을 손잡이 끝에서 길이×grip-ratio 지점으로 → 삼각형 감축 → 정점색·스킨·애니 제거 → 텍스처 축소 → GLB와 JSON 보고(삼각형, bbox, 원점 검사). 규약 위반이면 종료 코드 1.
- 날이 -Y로 나오면 `--flip`. 손잡이가 위에 있으면 `--grip-end top`.
- 등록 도구: `public/models/item-weapons/<id>.glb` 복사, sha256·bytes·triangles 기록, 규약·예산 검사(위반이면 아무것도 쓰지 않고 실패).
- 시험용 픽스처는 `test/fixtures/item-weapon-sword-prepped.glb`(forge-sword-v2를 눕혀 정리 스크립트로 복원한 것). 매니페스트에는 넣지 않는다.

## 다음 단계 (2026-10-29)

- 나머지 검성 무기 38자루의 우선순위·참조 아이콘: `art-src/gear-icons/weapon-3d-queue.json`(2차 기본 드롭 11 → 3차 U 테마 9 → 4차 도감·마을 15 → 5차 원정 3). 병기고 6종은 병기고 GLB 경로, 소환 2종은 검 형태가 아니라 제외.
- 다른 직업 형태(광전사 도끼, 마법사 지팡이, 도적 쌍단검, 궁수 활) 후보: 대표님 요청 취지("아이콘 정체성대로 보이는 무기")상 다음 단계. 매니페스트 키를 `{id, form}`으로 넓히고 형태별 원화를 같은 아이콘 정체성으로 만든다. 그때 `public/img/item-renders/forms/` 215장(옛 그림)도 같은 톤으로 다시 그린다.
