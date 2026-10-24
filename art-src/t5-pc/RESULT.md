# t5 PC 결과 (이어받은 실행)

시작 크레딧 표시 11775 (2026-10-24, Studio 구독분). 끝 크레딧: (진행 중)

# t5 PC 결과 (진행 중)

2026-10-23 22:32 PC Claude 실행기가 시작 직후 PC Claude 계정 주간 한도(10-29 15:00 KST 재설정)로 멈췄다. 그 전에 끝난 것만 기록한다.

- 원화(Codex CLI): 부츠 boots_n·boots_e·boots_l concept_a, 아바타 5종 concept_a(mage_pumpkin은 b도) + concept.png, 상점 초상 배경 10장(portrait-bg/, 프롬프트 prompts.txt). gen_done.txt = 원화 단계 끝.
- Tripo: avatar_knight_pumpkin 1건 — rigged.glb 10,486,804 B · sha256 e15a797db75d4f37ac47733e8e82ad5d69a7b93ee94450a2168aacb663d484c1, check-weights ok=true(v17329, multiInfluence 14038), check-joints 65/65, 미리보기 정면·3/4·위 3장. task id·크레딧 기록 없음(실행기 로그 소실).
- 남은 Tripo: 아바타 4종(mage_pumpkin, rogue_vampire, ranger_blackcat, barbarian_werewolf), 부츠 3종(정적 메시, 리그 없음).
- 원화 원본은 TLL-Asset-Foundry 보관 전(Tripo 단계에서 함께 보관).


## 부츠 3종 (2026-10-24, Tripo Studio, 정적 메시·리그 없음)
설정: 텍스처 켬(생성 화면 8K 기본값, 내보내기 2K), 삼각형 리토폴 3000 지정(스마트 메시 P1.0 켬), GLB 2K 내보내기. 모델 버전 선택 화면은 기본값 그대로(H3.1 표시 확인은 못 함, 화면에 버전 표기 없음). 건마다 생성 55 + 리토폴 35 = 90 크레딧. 미리보기: preview_front.jpg(기본 정면 시점)·preview_top.jpg(위에서 내려다본 시점, 마우스 드래그 근사). 아카이브: TLL-Asset-Foundry/props/blade_<대상>_pc/.

| 대상 | 원화 | 워크스페이스 id | 재시도 | 크레딧 | model.glb (크기 · sha256) | 삼각형 | 검사 | 비고 |
|---|---|---|---|---|---|---|---|---|
| boots_n | a | 418fed9b-b164-48f2-8987-3e7680969c39 | 0 | 90 | 3,877,832 B · 5bf444e912c0fca43aa72b7fe9983aa234c099a0a499416a839b94b17d44fa47 | 2,662 | 화면 면 수 확인(리그 없음, 스크립트 검사 해당 없음) | 갈색 가죽·강철 띠·초록 리벳 보임 |
| boots_e | a | ea226015-fbd5-479b-ad31-3543b3883c93 | 0 | 90 | 7,789,592 B · 71f2e0c62703a2a97f2bdd7d3dc775add82b358bb5f345aa7573030a3ff6e527 | 3,322 | 화면 면 수 확인 | 강철 판금·남색 이음·파란 보석. 내보내기 직후 화면이 다른 에셋으로 넘어가는 현상 1회(파일은 정상) |
| boots_l | a | 305aff84-f872-4f57-a3bc-3df98b610426 | 0 | 90 | 7,737,120 B · 44658ee2b81f8205ffa5fc795f1df9927444cc7951a4fdd05a43a605ad38b567 | 3,257 | 화면 면 수 확인 | 금장·날개 장식·주황 보석. 원화가 정면 시점이라 미리보기 정면이 곧 원화 각도 |

## 아바타 4종 (2026-10-24, 생성 55 + 리토폴 35 + 리그 20 = 110, 삼각형 11,000 지정, Humanoid+Mixamo)

| 대상 | 원화 | 워크스페이스 id | 재시도 | 크레딧 | rigged.glb | 삼각형/관절 | 검사 | 비고 |
|---|---|---|---|---|---|---|---|---|
| avatar_mage_pumpkin | b(concept.png=b) | e88671c8-13c8-4abc-8825-588c20f55c8b | 0 | 110 (55+35+20) | 10,757,312 B · ed159778aede06dc835e9326db7919b0b5e11adac94c30f7210fef9fa9b8e634 | 10,580 / 65 | check-weights ok=true, v16267, multiInfluence 11303 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임(모자챙이 눈썹 위). 걷기 미리보기 정상. 내보내기 GLB 2K·스켈레톤 켬·애니메이션 0 |
