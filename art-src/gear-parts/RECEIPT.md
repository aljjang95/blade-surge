# 장비 외형 파츠 아트 영수증 (2026-10-24, blade-gear-parts)

## 요약
- 설계도 시안 3장(concepts/concept-a|b|c.png, Codex CLI 이미지 생성, 참조 = 현재 기사 렌더 `refs/knight_hero_s.png`·`refs/knight_lobby.png`). 각 장 = 로비 / 장비 상세·룬 소켓 390x844 / N·E·L 3열 비교 한 보드. A 중후한 판금, B 밝은 손그림(현재 톤), C 룬 발광 다크판타지. 1920px로 축소한 사본.
- 파츠 참조 9장(refs/<파트>_<n|e|l>.png, 1024px 축소 사본). 스타일 B 톤 기본, 흰 배경 단독, 3/4 정면. helm=오픈 페이스, pauldron·gauntlet=오른쪽 한 짝.
- 프롬프트 전문: `prompts/*.txt`.
- Tripo Studio(대표님 평소 Chrome, aljjang95 로그인 유지): 이미지→3D, H3.1(Best Quality), 텍스처 켬 2K PBR, 리토폴·리깅 안 씀(기본 삼각형), 정적 메시, GLB 2K 내보내기. 재시도 0, 실패 0.
- **Tripo 구독 크레딧: 시작 10,890 → 종료 10,485 (소비 405 = 9건 x 45, 상한 700 이내).**
- 원본 GLB는 건당 약 57~60MB(삼각형 약 190만, 클라우드에서 리토폴·LOD 필요)라 커밋하지 않음. 보관 위치(Drive 공용 라이브러리):
  `G:\내 드라이브\10_스톡라이브러리\04_그래픽3D템플릿\TLL-Asset-Foundry\props\blade_gear_<파트>_pc\` (kind=prop, status=generated, 덮어쓰기 없음).
  PC 원본 작업 폴더: `C:\Work\tasks\blade-gear-art\tripo\<파트>.glb`.
- 미리보기: `tripo/<파트>_preview.png` (helm 3종은 정면, 나머지는 Tripo 기본 시점), Tripo 쪽 기록 원문 `tripo/TRIPO_RESULT.md`.

## 파트별 (Tripo task id / 크레딧 / 삼각형 / GLB 바이트 / sha256)
| 파트 | task id | 크레딧 | 삼각형 | 바이트 | sha256 |
|---|---|---|---|---|---|
| helm_n | 3eae8e2d-e600-492d-bc86-0c3b4dcc3166 | 45 | 1,954,808 | 58,174,664 | 684f6bf36ebe441e327f683b1afa9d78f92f3ae76ac03bd2b5d3c68c116e393d |
| helm_e | b43702ab-ae9c-4d74-81b6-7c7167fe0a23 | 45 | 1,892,535 | 57,514,868 | 35d37dc801f50297998c11a70a872ae76b2b567af99d4ac46cdced8c495b0ada |
| helm_l | bb5089ab-7e12-4db8-8211-4ba2b3a7a666 | 45 | 1,935,498 | 58,998,300 | 1eec820df81b5fa06759a347bbc6a8320b5e7e9a63ca8b94b84c6d907ff91dcc |
| pauldron_n | 1538b413-a790-43d5-9e32-57005e9da51c | 45 | 1,916,300 | 57,120,312 | 903a7b65b44a265572154dfc35c0a01c0641c9a54fb9f08cb1ea00e1d3558f0b |
| pauldron_e | 135fade7-8b65-4d3c-b361-2df6309b4b04 | 45 | 1,895,446 | 56,973,892 | 34f082840bb7bf3b83ba59767d9beb1b96af6fa3fefc9117c2b60c36c52e5213 |
| pauldron_l | ce95c828-c7c2-42d7-8bf7-0484ddd4758a | 45 | 1,938,742 | 59,008,452 | e015ba09063a2a1f5ffed9466f60d82149c1af1d65c37d4634f3c375a1b82f0f |
| gauntlet_n | d234549e-d721-4109-81b9-22d643e03cae | 45 | 1,925,988 | 57,339,584 | 6cd7c9c9b0c0cc0017b9862d24ea36f9a488b1c59a2e0aea791a41c3814386cb |
| gauntlet_e | f3630c14-aa1d-4592-a5c6-52080ca69324 | 45 | 1,965,634 | 59,898,952 | cde88d5b0c3a64099925f11b5665e58289bb90b06c402bfd593c825d9c9a36c9 |
| gauntlet_l | 4a3a5618-1f26-44e3-826f-9c511361a586 | 45 | 1,896,362 | 58,362,216 | d178373ac5c45875f35856cb3350fb9f1ff40a3658769e98f306fc29496f70ed |

## 미확인
- GLB 내부 재질 색(중립 톤 여부)·방향·스케일은 클라우드 Blender 단계에서 확인 필요(PC에서는 미리보기 스크린샷만).
- 시안 보드 3장은 생성만 했고 대표님 선택 전.
