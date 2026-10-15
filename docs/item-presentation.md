# 아이템 표현 단일 규칙 (2026-10-15)

같은 itemId는 인벤 · 장착 칸 · 비교/강화 시트 · 제작 · 전리품 · 소환 결과에서 **같은 3D 원본을 같은 카메라 · 조명으로 구운 같은 그림**을 쓴다. 선택한 장비는 시트의 '3D로 보기'에서 같은 원본을 실제 3D로 돌려 볼 수 있다. 3D와 무관한 2D 일러스트를 장비 그림으로 섞지 않는다.

## 정본 경로

| 장비 | 형상 원본 | 썸네일 |
|---|---|---|
| 기본 · 등급 장비 118종 | `item-forge`(gearLook) · `armor-appearance` | 기존 `/img/gear/<id>.webp` (`tools/art/gear-icon-studio`) |
| 테마 세트 · 원정 · 소환 장비 52종 | 같은 `item-forge` · `armor-appearance` | 새 `/img/item-renders/<id>.webp` |
| 병기고 24종 | `/models/armory-v1/<id>.glb` 원본 | 새 `/img/item-renders/<id>.webp` |

이전에는 테마 세트 · 원정 장비가 3D와 무관한 그림(`/img/it_<세트>_<부위>.webp`)을 썼고, 원정 장비는 다른 세트의 그림을 그대로 공유했다. 병기고는 다른 조명의 Blender 렌더, 소환 장비 8종은 그림이 없어 다른 등급의 그림으로 대체됐다. 지금은 194종 모두 서로 다른 3D 렌더 그림을 갖는다(테스트로 고정).

`src/ui/item-presentation.js`의 `itemVisual(item)`이 유일한 선택 규칙이다. 반환값은 `{ itemId, slot, rarity, iconUrl, fallbackUrl, fallback, renderSet, source, modelKey }`. 그림을 못 읽으면 `fallbackUrl`(중립 부위 실루엣)로 한 번만 바꾸며 다른 장비 그림으로 대체하지 않는다. 사용하는 곳: gear-panel(착용 칸 · 가방 · 시트), maple-inventory/equipment(E/I 창), meta(세트 제작 · 소환 결과), ui(전리품 · 보상 칩), journey, town-ui, arsenal, gacha-contents.

`src/expansion/hub.jsx`(원정 결과 전리품 · 제작 공방 레시피)는 이 레인 소유가 아니어서 아직 `ITEM_ICON`을 쓴다. 같은 함수로 바꾸는 패치는 root 요청에 있다.

## 렌더 재현

```sh
bun x vite --host 127.0.0.1 --port 5391 --strictPort   # 다른 터미널
node tools/item-render-studio.mjs --url http://127.0.0.1:5391 --review <검수판 폴더>
```

`tools/item-render-studio.html`은 gear-icon-studio와 같은 768px 투명 렌더 · RoomEnvironment · 반구광 1 + 방향광 2 · 직교 카메라 · 부위별 3/4 각도 · 85% 프레이밍을 쓰고, 드라이버가 256×256 WebP로 줄인다. 투명 · 크기 · 점유율(0.5~0.95)을 검사하고 `src/data/item-presentation.json`에 id · 원본 종류 · sha256 · 점유율과 형상 원본 파일 해시를 기록한다. 원본 파일이 바뀌면 `test/item-presentation.test.ts`가 실패하므로 다시 굽는다. 이번 실행: 76종, 브라우저 오류 0, 합계 약 0.9MB.

## 3D 미리보기 범위

`src/ui/item-preview-3d.js`는 시트에서 버튼을 누를 때만 동적으로 불러오고, 시트 하나에 WebGL 렌더러 하나만 만든다. 시트가 닫히거나 다른 모달로 바뀌면 렌더러 · 형상 · 재질 · 환경맵을 해제하고 `forceContextLoss`를 부른다. 컨텍스트를 잃거나 불러오기에 실패하면 '목록 그림은 같은 장비입니다' 안내로 바꾼다. 끌어서 회전하며 동작 줄이기 설정이면 자동 회전하지 않는다.

- 무기: 선택 영웅이 실제로 드는 형태(`LOOKS`의 무기 노드 → `ITEM_WEAPON_FORMS`)로 만든다. 궁수는 활, 마도사는 지팡이/완드, 기사의 U/L 등급은 양손검이다. 목록 그림은 한손검 기준의 같은 장비이며 시트 안내문에 이 차이를 적는다.
- 병기고 무기: 기사 · 광전사는 원본 GLB가 무기 자리에 붙고, 다른 직업은 기본 무기를 유지하고 장식으로 붙는다(기존 `armory-assets` 규칙). 안내문이 이를 구분한다.
- 방어구: 기사 casual-v2 리그 바인드 포즈의 원본 형상이다. 실제 영웅에게는 모델에 따라 이 장비의 색 · 재질 또는 등급 단계 몸체로 보인다. 1:1 몸체 교체를 주장하지 않는다.

## 한계

- 썸네일은 한 가지 각도 · 한 가지 무기 형태다. 직업별 형태별 썸네일(약 350장)은 만들지 않았다.
- SwiftShader 헤드리스 렌더 결과이며 실기기 GPU 색 재현은 확인하지 않았다.
- 영웅·장비 화면의 R3F '착용 모습' 패널(`src/expansion/wardrobe.jsx`)은 이 레인 소유가 아니며, 헤드리스 캡처에서는 기준선과 후보 모두 비어 보였다.
