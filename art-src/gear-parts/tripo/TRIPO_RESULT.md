# Blade Gear 장비 아이콘 9종 → Tripo Studio 이미지→3D 결과 (2026-10-24)

- 설정: 이미지→3D, 모델 H3.1(Best Quality), 텍스처 켬(2K, PBR, Ultra Mesh 기본값), 리토폴·리깅 미사용, 삼각형 기본 폴리카운트(상한 2,000,000), 정적 메시. 8K 텍스처는 끔.
- 내보내기: GLB, 텍스처 2K (내보내기는 크레딧 소모 없음).
- 크레딧(Studio 구독분): 시작 10,890 → 종료 10,485. 이번 실행 소모 405 (9건 × 45). 한도 700 이내. 재시도 0회, 실패 0건.
- 사용 계정: 대표님 평소 Chrome의 Tripo Studio 로그인 세션(aljjang95). 허용 호스트(tripo3d.ai)만 사용.
- 보관: 각 GLB를 archive_asset.py로 TLL-Asset-Foundry에 `blade_gear_<이름>_pc`(kind=prop, status=generated)로 복사. 덮어쓰기 없음. 모두 성공.
- 미리보기: 화면 스크린샷 1장씩 `tripo\<이름>_preview.png`. helm_n·helm_e·helm_l은 정면, 나머지는 Tripo 기본 사선 시점(정면 아님).

| 이름 | Tripo task id | 소모 | 삼각형 수 | GLB 크기(B) | sha256 |
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

## 참고
- Downloads의 원본 파일명은 Tripo 자동 제목(예: "medieval helmet 3d model.glb")이라 이름과 무관하다. 한 건씩 내보내고 즉시 이동해 매칭했다.
- 폴리카운트가 약 190만으로 매우 무겁다(파일 약 57~60MB). 게임 런타임용은 후속 리토폴·LOD가 필요하다.
- 잔여 작업: 없음. git은 건드리지 않았다.
