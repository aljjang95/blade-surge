# 흑철 용기사(avatar_barbarian_ironwyrm) 통합 시도 — 보류 (2026-10-28)

## 결론
Tripo 결과물(이미지 10240e80-cd7a-48b8-8430-f37bc722bf50, 3D aa3cb744-e42b-4135-b1a4-36f2e527a2e8)은 사실 비율(약 8등신)이라
광전사 1단계(hero_barbarian_t1, 3등신 치비) 공유 골격에 메시를 굽히지 않고 묶을 수 없다. 게임에 넣지 않았다(manifest·avatars.js 변경 없음).
재생성이 필요하다(아래 브리프). 런타임은 아바타 메시를 영웅의 기존 1단계 뼈에 이름으로 다시 묶고(`swapLibraryHeroBody`),
1단계 클립은 모든 뼈에 이동 트랙이 있어 뼈 길이를 몸마다 바꿀 수 없다.

## 비율 비교 (바인드 자세, 메시 키로 나눔)
| 몸 | 메시 키 | Head 관절 높이/키 | 양 어깨(Arm) 관절 폭/키 | 다리(UpLeg→Foot)/키 | Hips/키 |
|---|---|---|---|---|---|
| hero_barbarian_t1 | 1.80 | 0.66 | 0.43 | 0.30 | 0.43 |
| avatar_barbarian_werewolf(출시분) | 0.98 | 0.78 | 0.28 | 0.37 | 0.48 |
| ironwyrm(이번) | 0.98 | 0.89 | 0.17 | 0.46 | 0.55 |

## 재결합 시도 (tools/art/rebind-library-body.mjs, 회전만)
정리: `blender_clean_weights.py --decor-hue 0-360 --decor-sat 0 --decor-val 0 --braid-hue 300-301 --head-min 0.6 --smooth-cape 8`(늑대인간 인자).
| 인자 | 배율 | 키 | 관절 어긋남(손/위팔/머리끝) | 화면 |
|---|---|---|---|---|
| `--scale=fit --lift=0.018 --collapse=…Hand(손가락)` | 1.287 | 1.26m | 0.38 / 0.28 / 0.42m | 대기에서 견갑·위팔이 날개처럼 머리 옆으로 솟음 |
| `--scale=height` (같은 나머지) | 1.839 | 1.81m | 0.44 / 0.46 / – | 어깨가 더 크게 부풀어 오름 |
| fit + 어깨 합치기 + `--no-aim=(Left|Right)Hand$` | 1.287 | 1.26m | 같음 | 변화 없음 |
원인: 1단계 위팔 관절은 몸 중심에서 0.39m, 이 몸의 어깨는 0.11~0.16m라 팔을 내리면 회전 중심 안쪽 메시(견갑)가 위로 돈다. 무기 소켓(1단계 손 뼈)이 보이는 손에서 약 0.38m 떨어진다(늑대인간 0.15m).
얼굴도 드라칸(1단계 붉은 머리 치비 얼굴)이 아니라 수염 난 사실형 얼굴이다.

## 원본 보관
- R2 `blade-surge-handoff/tripo-originals/avatar_barbarian_ironwyrm/`(비공개 버킷): SHA256SUMS, tpose.png, raw.glb, retopo.glb, rigged.fbx, rigged.glb, rigged_fbx_textures/*.PNG. 내려받아 SHA256SUMS·텍스처 해시 일치 확인.
- 이 폴더: rigged.glb, tpose.png, SHA256SUMS, tripo_task.txt. 원격 브랜치 `tmp/ironwyrm-xfer`에도 전부 있다.
- 남은 것: PC 공용 라이브러리 TLL-Asset-Foundry(`archive_asset.py`, G: 드라이브) 보관.
- 군더더기 Icosphere(42정점)는 GLB 안에 없다. Blender glTF 가져오기가 만드는 뼈 표시 모양이고, 정리 결과(내보내기)에도 메시는 하나뿐이다.

## 재생성 브리프 (Tripo 크레딧 사용 전 대표님 확인)
1. 원화: 늑대인간 v2처럼 광전사 1단계 원화에서 출발한다. 같은 얼굴(붉은 머리 치비 얼굴, 수염 없음), 같은 3등신 비율·큰 머리·넓은 어깨·짧고 굵은 다리, 무기 없는 A/T포즈, 흰 배경.
   옷만 이번 컨셉으로 바꾼다: 뿔 달린 용 해골 투구(얼굴·두 눈을 가리지 않게 이마 위), 검은 용비늘 판금 + 붉은 이음새, 비늘 하의, 짧은 적흑 망토(허리 위까지).
2. Tripo: HD 모델 + H3.1, 스마트 리토폴 11,000, Humanoid + Mixamo 리그(65관절). 늑대인간 t6 실측 120 크레딧.
3. 이후 파이프라인은 늑대인간과 같다(정리 → 회전만 재결합 → ingest --avatar → 초상).
