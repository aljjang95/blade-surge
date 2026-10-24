# t6 PC 결과 — 늑대인간 족장 재생성 + Asset Foundry 보관

크레딧(Tripo Studio 구독분, 이번 실행 상한 300): 시작 표시 11065 → 끝 표시 10890, 사용 175 (최종 채택 경로 120 = 생성 65 + 스마트 리토폴 35 + 리그 20, 폐기한 첫 시도 55). API 지갑·추가 구매·플랜 변경 없음.

이전 '중단' 기록(원화 미생성)은 실행기 인코딩 문제였고 지금은 고쳐졌다. 원화 a/b가 만들어져 아래대로 진행했다.

## 1) avatar_barbarian_werewolf (v2, 볼 문양 한 줄)

원화 판정: concept_a·concept_b 모두 양쪽 볼에 줄 한 개씩, 턱 줄·이마 페인트 없음, 눈썹은 머리색 붉은 눈썹, 옷·포즈·흰 배경·두 눈 보임은 concept_t5와 같다. a는 줄이 굵은 막대, b는 가늘고 짧은 가로 줄이라 '한 줄'에 더 가깝다 → **b를 concept.png로 채택**(a는 보존).

| 대상 | 원화 | 워크스페이스 id | 재시도 | 크레딧 | rigged.glb (크기 · sha256) | 삼각형/관절 | 검사 | 비고 |
|---|---|---|---|---|---|---|---|---|
| avatar_barbarian_werewolf (v2) | b | c9d9d834-993c-4b54-9769-6ada1db30d99 | 1 (아래 참고) | 채택 경로 120 (65+35+20), 폐기분 55 | 8,367,188 B · f1896ed8e48e7aae693c0f6b26990bbb4f0a6532317cb390aafde1c5572fb219 | 10,875 / 65 (정점 20,482) | check-weights ok=true (v20487, multiInfluence 19634) / check-joints joints 65, jointsWithTranslation 65 | 정면·3/4·위(약 55°) 미리보기 모두 두 눈 보이고 볼 줄 한 개씩. 걷기 미리보기 확인 후 같은 화면에서 GLB 2K·스켈레톤 켬·애니메이션 0 내보내기 |

- 재시도 사유: 첫 시도는 Tripo 기본값(P2.0 스마트 메시, 4개 생성 설정) 경로로 만들고 리토폴 삼각형 11,000 → 텍스처 2K → 리그(Humanoid+Mixamo)까지 했으나, 내보낸 GLB가 관절 51(65 아님)·multiInfluence 0·withTranslation 0으로 검사 실패. 같은 모델을 재리그(20)해도 같아 폐기했다. 브리프대로 HD 모델 + H3.1 + 텍스처 켬(8K 생성, 내보내기 2K)으로 다시 생성(65)하고 스마트 리토폴 삼각형 11,000(35) → 리그(20)하니 통과했다.
- 미리보기 3장은 Tripo 화면 캡처를 드래그로 돌린 근사 각도(위 미리보기는 약 40~55°).
- 폐기한 첫 시도의 파일은 저장하지 않았다(다운로드 폴더에만 있음).

## 2) TLL-Asset-Foundry 보관 (덮어쓰기 없음, `archive_asset.py`, 상태 generated)

기준 폴더: `G:/내 드라이브/10_스톡라이브러리/04_그래픽3D템플릿/TLL-Asset-Foundry/characters/`

| 이름 | 파일 | 보관 경로 | sha256 |
|---|---|---|---|
| blade_avatar_knight_pumpkin_pc (신규 보관, 같은 이름 없었음) | rigged.glb | .../blade_avatar_knight_pumpkin_pc/raw/rigged.glb | e15a797db75d4f37ac47733e8e82ad5d69a7b93ee94450a2168aacb663d484c1 (t5 RESULT 기록값과 같음) |
| 〃 | concept.png | .../blade_avatar_knight_pumpkin_pc/preview/concept.png | cef23e2d1de0fb27e5457677c3155e512c6040cc16a1bc71827091b149b29f4c |
| blade_avatar_barbarian_werewolf_pc_v2 | rigged.glb | .../blade_avatar_barbarian_werewolf_pc_v2/raw/rigged.glb | f1896ed8e48e7aae693c0f6b26990bbb4f0a6532317cb390aafde1c5572fb219 |
| 〃 | concept.png (= concept_b) | .../preview/concept.png | f33ed68d401893dbe526955a6c1b66eca73ed6f64e8a5f4525f0f4708a57fe38 |
| 〃 | preview_front.png | .../preview/preview_front.png | 492372376623879a16b85aec9f209865b8f83c0a1c435eec7eb0388b5161e1d1 |
| 〃 | preview_34.png | .../preview/preview_34.png | c70cef944874804c772171f810c40adbf96749cb6d0237f15b33ba858089bade |
| 〃 | preview_top55.png | .../preview/preview_top55.png | be288a039e2dd73e9cfd20b3c05b3b910858d515829c6824928ea588faf2fd0e |

기존 `blade_avatar_barbarian_werewolf_pc`(t5 원본, 볼 문양 여러 줄)는 그대로 남아 있다.
