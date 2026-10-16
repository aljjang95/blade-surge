# 궁수(실바) 플레이 감각 교정 — 리그·활·수동 조준

2026-10-15, 기준 `47363486f6f5e773b12cf311c88287244fa67547`. 궁수 레인 작업 기록이며 통합·리뷰·배포는 root 가 맡는다.

## 실제 사용 경로와 원인

게임의 실바는 `public/models/Ranger.glb`보다 라이브러리 1단계 몸체 `hero_ranger_t1`(Tripo 메시 + Mixamo 사양 리그, 클립 9개)를 먼저 쓴다(`loadModel` → `loadHeroModel`). 활은 KayKit `Ranger.glb`의 `handslot.l` 자식을 Mixamo 왼손 본의 소켓으로 복제해 붙이고, forge-bow-v2 형상으로 바꾼다. 갑옷 2·3단계와 여우 아바타는 같은 골격으로 묶인 메시 전용 GLB 이며 1단계 클립을 공유한다. `Ranger.glb`·`heroes-v3/ranger-v3.glb`는 라이브러리 로드가 실패할 때의 폴백이다.

원인은 `tools/asset-library/blender_merge_mixamo.py`가 Mixamo FBX 액션을 리타깃 없이 `action.copy()`로 붙인 데 있다. Blender 포즈 회전은 각 본의 rest 기준 상대값이라, 이 리그처럼 팔 rest 축이 Mixamo 표준과 다르면 같은 값이 다른 자세가 된다. 원본 `idle`에서는 활을 쥔 왼손이 머리 위로 솟는다(`test/ranger-library-model.test.ts`의 원인 재현 테스트). 그 결과 클립마다 활이 다른 방향으로 튀고, 사격 중에는 몸이 뒤로 돈다. 추가로 다음 문제가 있었다.

- `bow_shoot`는 5초 클립인데 0.46초 콤보로 압축되어 당김·발사가 읽히지 않는다.
- 게임 회피는 0.32초(1.6배속)만 보여 주는데 `dodge`는 2.33초 구르기여서 첫 22%만 보인다.
- `Dodge_Backward`가 없어 무방향 백스텝이 뒤로 미끄러지면서 앞구르기를 재생한다.
- forge 활의 시위는 정적 형상이어서 손을 따라오지 않는다.
- 수동 기본 공격은 AUTO 일 때만 조준하고(`this.auto` 조건), 사격 중에는 멈춰 선다.

## Blender 교정 (실제 실행)

`art-src/ranger/author_ranger_library_v1.py`를 Blender 4.3.2(`/usr/bin/blender`) 배경 모드로 실행해 원본 GLB 를 읽기만 한다. 몸통·다리는 원본 클립을 유지하고, 양팔은 가슴(Spine2) 기준 IK 목표와 손 회전 목표로 다시 저작한 뒤 시각 키로 굽는다. 활은 왼손 본 아래의 고정 그립 소켓 `RangerBowGrip_L`(활 로컬 축 = 그립 축)로 한 번만 정의한다. 손 회전은 각 자세에서 지정한 활 자세에 고정 그립의 역을 곱해 유도하므로, 모든 클립에서 손과 활의 상대 좌표가 같다. 오른손에는 시위 노크 소켓 `RangerDrawNock_R`를 둔다. 손가락은 원본 값도 어긋나 있어 쥠·당김 고정 자세로 덮는다.

| 클립 | 길이 | 내용 |
|---|---|---|
| idle / run | 9.92s / 0.67s | 원본 몸통·다리, 활은 낮게 쥔 대각선(달리기는 팔 흔들림) |
| dodge | 0.50s | 원본 구르기를 12프레임으로 리타이밍(게임에 보이는 0.51초에 맞춤) |
| Dodge_Backward | 0.50s | 같은 구르기를 시간 역순으로 재생한 백스텝(새 클립, KayKit 논리 키) |
| bow_shoot | 1.00s | 준비→노크(3f)→만작(7–10f)→발사(10.08f = 위상 0.42)→팔로스루→회수(24f = 준비 자세) |
| hit / death / cheer / interact / cast_shoot | 원본 길이 | 원본 몸통 + 가드·환호·손 뻗기 팔 |

`tools/art/pack-ranger-library.mjs`는 원본 GLB 의 메시·스킨·재질·텍스처 바이트를 그대로 두고, 구운 클립과 두 소켓 노드만 이름으로 옮겨 `public/models/heroes-next/ranger-library-t1-v1.glb`를 만든다. 관절 rest TRS 가 원본과 다르면(0.01cm·1e-6) 실패한다. 실측 드리프트는 0.00025cm·3.4e-8이다. 같은 입력으로 두 번 실행하면 바이트가 같다.

| 파일 | SHA-256 |
|---|---|
| 원본 `asset-library/normalized/hero_ranger_t1.glb`(변경 없음) | `2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23` |
| 교정본 `public/models/heroes-next/ranger-library-t1-v1.glb` | `5bbc7e7bce7f496b765350895e26c99cf22b106e8f5d1ae8c2a4211842af7f2b` |
| `art-src/ranger/ranger-library-v1.blend`(미리보기 활 포함, 내보내기 제외) | `8dd8e47ead1cfcf6ddd8e16b5e3c49b389909c9c610c05027f9b68a751c9aa6e` |

출처·라이선스는 원본과 같다(owner-generated Tripo 구독 메시, Mixamo 기반 몸통·다리 클립). 팔·활 클립은 같은 골격에서 이 저장소의 스크립트로 저작했다. 외부 다운로드는 쓰지 않았다.

재현:

```sh
bun tools/art/export-ranger-runtime-bow.mjs art-src/ranger/runtime-bow-preview.obj   # .blend 미리보기용(선택)
blender -b --factory-startup --python art-src/ranger/author_ranger_library_v1.py -- asset-library/normalized/hero_ranger_t1.glb <out> art-src/ranger/runtime-bow-preview.obj
node tools/art/pack-ranger-library.mjs asset-library/normalized/hero_ranger_t1.glb <out>/ranger-library-anim-v1.glb public/models/heroes-next/ranger-library-t1-v1.glb
node tools/art/update-ranger-revision.mjs
```

## 런타임 연결

- `src/data/ranger-library-revision-v1.json`: 원본 SHA 와 교정본 SHA·경로·클립 길이를 고정한다. `resolveAssetSource`는 `hero_ranger_t1`이 정확히 그 원본일 때만 교정본을 받는다(`revisedLibraryFile`). 맞지 않으면 예외를 던진다. manifest 와 원본 GLB 는 그대로다.
- `assets.js`: 왼손 소켓은 저작 그립이 있으면 `fitAuthoredGrip`으로 KayKit 활 노드의 고유 회전을 상쇄해 그립과 같은 자리·방향에 놓는다. 그립이 없으면 기존 `fitLibrarySocket`을 쓴다. 2·3단계·아바타는 `adoptRangerSockets`로 1단계 소켓을 이어받는다. 활의 정적 시위 성분(56 tris)만 떼어 내고 두 마디 원기둥 시위(`Bow_String_Upper/Lower`, 공유 지오메트리)를 붙인다.
- `poseRangerBowString(model, drawing)`: 발사 전 상태(콤보 타격 전·스킬 시전 전)이고, 오른손 노크 소켓이 활 뒤쪽 당김 통로 안에 있을 때만 시위가 손을 따라간다. 그 밖에는 쉼 노크점에 둔다. 프레임 할당이 없다.

## 수동 조준·이동 사격 (`src/game/ranger-aim.js`, `player.js`)

- 대상: 살아 있고, 등장·잠복(`spawning`)·무적이 아니며, 사거리(화살 도달 거리 + 몸 반경) 안에 있고, Floor 보행 마스크 직선 시야가 열린 적이다. 기존 대상이 유효하면 유지하고(이력 여유 15%), 아니면 가장 가까운 적, 동률이면 적 목록 순서로 고른다. 난수를 쓰지 않는다.
- 공격 시작 시점에 대상을 향하고, 발사 전까지 대상을 따라 돈다. 발사 시점(`doComboHit` tick 0)에는 다시 확인해 죽거나 가려진 대상을 버린다. 그때 다른 유효 대상이 있으면 그 대상, 없으면 현재 방향으로 쏜다. 화살 수는 콤보 데이터 그대로이며(보통 1발), 위치를 옮기거나 AUTO 로 바꾸지 않는다.
- 대상이 없으면 기존 규칙(이동 입력이 있으면 그 입력 방향, 없으면 현재 방향)으로 쏜다.
- 사격 중 이동: 입력 방향으로 이동 속도의 55%까지 부드럽게 따라가고, 몸은 조준 방향을 유지한다. 상체는 `bow_shoot`의 상체 트랙(`RangerBowUpper`), 하체는 대기/달리기 하체 트랙을 속도에 따라 섞는다. 조준 반대 방향으로 물러서면 달리기 다리를 역재생한다.
- 회피 중 공격 입력은 회피 0.16초 뒤 사격으로 이어지며, 회피 속도와 남은 무적 시간을 이어 받는다. 그 전에 누른 입력은 전환 시점까지 보존한다.
- AUTO 궁수, 다른 영웅, 스킬·궁극기, 경제·퍼즐 투사체 판정은 바꾸지 않았다. 조준 대상은 `lockTarget`에도 넣으므로 기존 대상 표시 UI 와 카메라 선행(최대 0.65 유닛)이 수동 궁수에서도 동작한다.

## 검증

- `test/ranger-library-model.test.ts`(7): 원본·교정본 SHA, 메시·재질 보존과 rest 동일, 원인 재현(원본 idle 왼손 > 머리+0.2), 9개 클립 × 6시점에서 활=그립(≤0.5°, ≤0.1mm)과 대기·달리기 활 손 높이, 만작 시위-노크 소켓 0.1mm 이내와 발사 뒤 쉼 시위 복귀, 시위 성분 분리, 2·3단계·여우 아바타 소켓·클립 공유와 몸체 교체 유지.
- `test/ranger-aim-assist.test.ts`(11): 대상 선택·잠금·무효(사망·등장·무적·사거리·벽)·동률 결정성, 실제 Player·원정 Floor 로 측면 이동 사격, 후퇴 사격과 뒷걸음 다리, 발사 전 대상 사망, 대상 없음, 실제 벽 가림, 회피→사격, AUTO·기사 경로 불변, 고정 시드 리플레이 결정성.
- `tools/art/ranger-pose-capture.mjs` + `ranger-pose-studio.html`: 같은 자세(idle·run·dodge·백스텝·노크·만작·발사 직후·회수)를 기준선(원본 GLB 로 요청 교체)과 교정본으로 게임 재질에서 캡처한다.
- `tools/art/ranger-playability-smoke.mjs`: 실제 앱(Vite dev, 루프백)·격리 저장·실제 키보드 입력·고정 스텝으로 측면 이동 사격, 후퇴 사격, 회피→사격, 대상 없음, AUTO 를 확인한다.

## 한계

뷰포트·헤드리스(SwiftShader) 검증이며 실제 Android/GPU/터치/발열 검증이 아니다. 전체 `bun run check`와 heavy browser metrics 는 통합 후 root 가 직렬로 실행한다. 손가락은 고정 쥠 자세이고, 화살을 시위에 메기는 메시(`Arrow`)는 기존처럼 숨긴다. 만작 근접 화면은 큰 후드가 일부 가린다.


## 후속: v2 전신 축 교정

게임은 이제 v1 대신 `ranger-library-v2`(전신 rest 축 리타깃·실제 스킨 접지·사망/피격/구르기 리타이밍·새 백스텝·rapid 사격)를 쓴다. 원인·재현·해시·한계는 [hero-animation-axis-v2.md](hero-animation-axis-v2.md)에 있다. 이 문서의 v1 기록은 이력으로 남긴다.
