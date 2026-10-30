# 장비 아트 레인 인계 (2026-10-30)

레인: `[gogo-chunk:blade-gear#art]`, 지휘 세션 `session_01WdQ7BZ8wnZNiuZbp6S4HPr`(theluxurylord). 이전 지휘 `session_01H8mx3U9qK3w3SjT5hPBKSr`.

## 끝난 것
- 장비 아이콘 새 톤 전부 운영 반영: 60종(#380) + 139종(#385). 남은 옛 그림은 영웅 형태별 무기 `public/img/item-renders/forms/` 215장뿐.
- 검성 무기 3D(Tripo GLB) 24자루 운영 반영(4·5차 18자루는 #445로 총 42자루) — 경로·규약은 `docs/ITEM_WEAPON_3D.md`.
  - 1차 4자루 + GLB 경로(#418, 685c49f): 리뷰 P0(재질 그룹 없음 → 안 그려짐) 수정, 금속·거칠기 맵 유지, 발광은 색 텍스처로 곱하고 0.4배.
  - 2차 11자루 + 밝기 보정(#430, 2dbc711 배포·readback): Tripo 강철(albedo sRGB≈100, 금속맵≈0.85)이 어둡게 가라앉아 금속 상한 0.3·색 1.35배.
  - 3차 9자루(#432, 473097c).
- 증거: 844×390 SwiftShader 영웅 화면 캡처에서 화면 메시 삼각형 = 매니페스트(절차적 검 456/1420과 구분), 절차적 기준샷과 쥐는 방향 동일, 강화 +0/+10/+15 차이 확인. GPU 프레임 판단은 아님.

## 남은 것
1. (4·5차·w_blood 끝, 위 결과 참고)
2. 다른 직업 형태(도끼·지팡이·쌍단검·활) 3D와 `forms/` 215장 재작화 — 매니페스트 키를 `{id, form}`으로 확장.

## 4·5차 결과 (2026-10-30, PR #445)
- 배포 1ad55e4(version.json sha 일치, dirty=false), 19자루 GLB 200·빌드 산출물 크기 일치. 영웅 화면 844×390 +0/+10/+15 캡처 18장에서 화면 무기 삼각형 = 매니페스트(SwiftShader, 실기기 아님).
- 대표님 지정 전용 Tripo 계정(heartytn 라벨, 로그인은 대표님이 클라우드 데스크톱에서 직접)으로 18자루 + w_blood 재생성. 공유 계정·`tripo` 금고는 쓰지 않음. 로그인 식별자는 저장소에 적지 않는다.
- 브리프 `art-src/gear-icons/weapon-3d-brief-w4.json`, 원본 R2 `tripo-3d/weapons/<id>/`(w_blood는 `-v2`).
- 흐름: Image(Nano Banana, 9:16, 무료 쿼터) → Model H3.1(2K·PBR·Triangle·Polycount 3000), 리토폴로지 불필요. 실측: 화면 표시 45, 첫 자루 직전·직후 45 차감, 19자루 전체는 23,895 → 22,255(1,640 = 원화 포함 자루당 약 86) — 화면 가격보다 크게 잡을 것. 모델 GLB는 meshopt 압축이라 gltf-transform으로 풀고 prep.
- l_2·l_3 헤일로가 날 뒤에 떠서 `blender_weapon_center_islands.py`로 보정.

## Tripo 비용 실측 (화면 가격을 믿지 말 것)
- 생성 H3.1(2K·PBR) 45, 리토폴로지는 화면 5인데 25가 빠지는 경우가 많음 → 자루당 50~70으로 계산. GLB 내보내기(기본 GLB 2k)는 직전·직후 잔량 측정 3회 모두 0.
- 컨셉 이미지(Nano Banana 2)도 장당 약 8로 보임(미확정).
- 단계마다 시작 전 잔량을 기록하고, 공유 계정이므로 하한 300 아래로 내려가는 단계는 시작하지 않는다.

## 도구
- `tools/art/gear-icon-brief.mjs`, `tools/art/icon-collage-split.py`, `tools/art/import-icon-batch.py`(아이콘).
- `tools/asset-library/blender_weapon_prep.py` → `tools/art/register-item-weapon.mjs`(무기 3D). Blender 5.0 공식 tarball을 스크래치에 받아 헤드리스(EEVEE는 libEGL 없음 → Cycles CPU 프리뷰).
- 원본: R2 `blade-surge-handoff/tripo-3d/weapons/<id>/<id>.glb`·`<id>-concept.png`.
