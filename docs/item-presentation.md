# 아이템 표현 단일 규칙 (2026-10-15)

같은 itemId는 인벤 · 장착 칸 · 비교/강화 시트 · 제작 · 전리품 · 소환 결과에서 **같은 3D 원본을 같은 카메라 · 조명으로 구운 그림**을 쓴다. 선택한 장비는 시트의 '3D로 보기'에서 같은 원본을 실제 3D로 돌려 볼 수 있다. 3D와 무관한 2D 일러스트를 장비 그림으로 섞지 않는다.

**영웅 문맥 정체성(2026-10-15 보강)**: 무기는 영웅마다 실제로 드는 모양이 다르다(검성 U/L 양손 대검, 드라칸 도끼 · E 등급 쌍도끼, 리아 마법봉/대마법 지팡이, 카인 단검 · S 이상 쌍단검, 실바 장궁). 영웅이 정해진 화면은 `itemVisual(item, { heroId })`로 **그 영웅이 실제로 드는 형태의 그림**을 쓰고, 선택 3D도 같은 형태 · 같은 빌더로 만든다. 그래서 가방 그림, 상세 머리 그림, 3D 보기, 전투 장착이 같은 모양이다. 영웅이 정해지지 않은 화면(도감 · 소환 구성품)만 기본 형태(일반 무기 = 한손검, 병기고 = 원본 모델)를 쓴다.

## 정본 경로

| 장비 | 형상 원본 | 기본 썸네일(문맥 없음) | 영웅 문맥 썸네일 |
|---|---|---|---|
| 기본 · 등급 장비 118종 | `item-forge`(gearLook) · `armor-appearance` | 기존 `/img/gear/<id>.webp` (`tools/art/gear-icon-studio`) | 무기만 `/img/item-renders/forms/<id>--<형태>.webp` |
| 테마 세트 · 원정 · 소환 장비 52종 | 같은 `item-forge` · `armor-appearance` | `/img/item-renders/<id>.webp` | 무기만 위와 같음 |
| 병기고 24종 | `/models/armory-v1/<id>.glb` 원본 | `/img/item-renders/<id>.webp` | 무기 × 리아 · 카인 · 실바만 장식 조합 그림 |

방어구 · 반지 · 신발은 영웅마다 모양이 바뀌지 않으므로 문맥이 있어도 기본 그림을 쓴다. 검성 N/S/E 한손검(23쌍)과 검성 · 드라칸의 병기고 전용 모델도 기본 그림이 곧 실제 모양이다.

## 형태 해석 (한 곳에서만)

- `src/data/item-presentation-forms.json`: `tools/item-visual-forms.mjs`가 실제 `LOOKS[영웅].weapon[등급]` → `ITEM_WEAPON_FORMS`와 `weaponLook`의 병기고 판정에서 만든 표. `bun tools/item-visual-forms.mjs --check`와 `test/item-visual-forms.test.ts`가 실제 규칙과 표를 비교한다. 규칙이 바뀌면 표와 그림을 다시 만든다.
- `src/ui/item-visual-forms.js` `resolveItemForm(item, heroId)`: 순수 함수(three · DOM 없음). `{ variant, form, count, formKey, label, nodes, renderKey }`. `variant`는 `canonical` · `hero-form` · `armory-own` · `armory-ornament`.
- `src/ui/item-presentation.js` `itemVisual(item, { heroId })`: 기존 필드에 `heroId · contextual · variant · form · formCount · formKey · formLabel · visualKey · caption`을 더한다. `visualKey`가 같으면 그림도 같다(기본 그림 = itemId, 영웅 형태 = `id@형태`). `itemIconHtml(item, attrs, { heroId })` · `itemIconNode(item, className, { heroId })`는 `data-item-form` · `data-item-hero`를 남긴다. 영웅 형태 그림의 존재는 테스트가 매니페스트 · 파일로 보장하고(출처 매니페스트는 런타임 번들에 싣지 않는다), 그림을 못 읽으면 기본(다른 형태) 그림 대신 중립 부위 실루엣으로 바꾼다.
- `src/ui/item-visual-model.js` `buildItemVisualModel(item, form)`: 썸네일 스튜디오와 선택 3D가 함께 쓰는 유일한 모델 빌더.

## 병기고 무기와 장식형 영웅

검성 · 드라칸은 병기고 무기를 전용 모델로 손에 든다(기본 그림 그대로, 캡션 '아르카 착용 · 병기고 전용 모델'). 리아 · 카인 · 실바는 게임 규칙상 **기본 무기(대장간 v2)를 그대로 들고 병기고 모델을 0.22배 장식으로 손 소켓에 붙인다**(`armory-assets` · `look.js`, 이번 작업에서 바꾸지 않음). 그래서 이 18쌍은 활 · 지팡이 · 쌍단검으로 바꾸지 않고, 실제 영웅 GLB에 `forgeHeroWeapons`를 적용한 기본 무기와 실제 `applyArmoryAppearance`가 만든 장식을 같은 상대 크기로 합쳐 굽는다. 전투에서는 장식이 손잡이와 겹쳐 잘 보이지 않으므로, 그림과 3D 보기는 장식을 같은 크기 · 같은 방향으로 손잡이 옆에 세워 둔다. 캡션은 '리아 착용 · 대마법 지팡이 + 병기고 장식'이다. 실바는 활이 왼손 · 장식이 오른손이라 같은 규칙으로 옆에 놓는다.

## 렌더 재현

```sh
bun x vite --host 127.0.0.1 --port 5497 --strictPort   # 다른 터미널(루프백)
node tools/item-render-variants.mjs --url http://127.0.0.1:5497 [--verify-canonical] [--review <검수판 폴더>]
node tools/item-render-variants.mjs --url http://127.0.0.1:5497 --only arm_aegis_weapon@ornament-bow,...   # 일부만 다시 굽기
```

`tools/item-render-variants.html`은 `item-render-studio.html`과 같은 768px 투명 렌더 · RoomEnvironment · 반구광 1 + 방향광 2 · 직교 카메라 · 부위별 3/4 시선 · 85% 프레이밍을 쓰고, 드라이버가 256×256 WebP(quality 92, effort 6)로 줄인다. `--verify-canonical`은 기존 `/img/item-renders/` 무기 그림을 새 스튜디오로 다시 찍어 SHA를 대조한다(이번 실행 19/19 바이트 일치 = 같은 조명 · 구도 · 인코딩). 매니페스트 `src/data/item-presentation-variants.json`은 key · 영웅 · 형태 · 파일 · 바이트 · sha256 · 점유율과 형상 원본(텍스트 sourceHashes, GLB assetHashes) 해시를 기록한다. 원본이 바뀌면 테스트가 실패하므로 다시 굽는다. 영웅 GLB(`/models/Mage.glb` · `Rogue.glb` · `Ranger.glb`)가 바뀌면 장식 조합 18장만 `--only`로 다시 구우면 된다.

기본 76종은 기존 `tools/item-render-studio`와 `src/data/item-presentation.json` 그대로다(파일 · 해시 변경 없음).

## 3D 미리보기

`src/ui/item-preview-3d.js` `mountItemPreview(host, item, { heroId })`는 시트에서 버튼을 누를 때만 동적으로 불러오고, 시트 하나에 WebGL 렌더러 하나만 만든다. 시트가 닫히거나 다른 모달로 바뀌면 렌더러 · 형상 · 재질 · 환경맵을 해제하고 `forceContextLoss`를 부른다. 같은 `resolveItemForm` · `buildItemVisualModel` · 조명을 쓰고 **첫 시점은 썸네일과 같은 3/4 각도**다. 끌어서 돌리거나, 캔버스에 초점을 둔 뒤 ←/→로 돌리고 Home으로 처음 각도로 돌아간다. 동작 줄이기 설정이면 자동 회전하지 않는다. 캡션은 `previewCaption(item, heroId)` = `itemVisual(...).caption`(예: '실바 착용 · 장궁', '아르카 착용 · 양손 대검').

- 방어구: 기사 casual-v2 리그 바인드 포즈의 원형이다. 영웅에게는 등급 외형으로 보인다. 1:1 몸체 교체를 주장하지 않는다.

## 한계

- 대장간 무기는 전투에서 원래 무기 노드 크기에 맞춰 늘려 붙는다(`fitForgedWeapon`). 그림과 3D 보기는 같은 형상을 맞춤 전 비율로 보여 준다. 실루엣 · 재질 · 형태는 같고 길이 비율은 영웅 손 크기에 따라 조금 다르다. 전투의 등급 발광 · 강화 오라는 그림에 넣지 않는다.
- 아바타 몸체 · 라이브러리 영웅 단계에서도 무기 노드 규칙(LOOKS)은 같다. 아바타별 별도 무기 모양은 없다.
- SwiftShader 헤드리스 렌더 결과이며 실기기 GPU 색 재현은 확인하지 않았다.
- 화면 호출부의 `heroId` 전달은 통합 작업이다(아래). 전달 전 화면은 기본 형태 그림을 그대로 쓴다.
