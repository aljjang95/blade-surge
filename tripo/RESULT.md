# 초보자 마을 Tripo 소품 결과 (2026-10-25)

- 시작 크레딧(Studio 표시값): 10,485
- 끝 크레딧(Studio 표시값): 9,765 (사용 720 / 상한 900)
- 이번 실행 상한: 900 / 설정: Image to 3D, HD Model(H3.1), 텍스처·PBR 기본(55), 리토폴 Triangle + Smart Mesh(35), GLB 2k 내보내기

| 대상 | task id | 재시도 | 크레딧 | 크기 | sha256 | 삼각형 | 비고 |
|---|---|---|---|---|---|---|---|
| sv_cottage | 4b3f6489-0aae-4b8f-94b9-2277dab416de | 0 | 90 (55+35) | 9,040,740 B | 75f508fc214f9aaa6d48f0ca5f34c009d0bc8d17e4f42a711dee76653fdd0296 | 8,419 | 원본 181만 면. 보관 blade_sv_cottage |
| sv_forge | 9dd4c87c-048c-468f-a55d-dc0cf3db1116 | 0 | 90 (55+35) | 8,926,716 B | cbd6a2014b44f78ab9bb538449142630e8e59c8b1cfe72178096c33496369313 | 8,680 | 원본 189만 면. 보관 blade_sv_forge |
| sv_board | 5754058c-e621-4648-98dd-a0cb943b82ef | 0 | 90 (55+35) | 7,306,868 B | 8dfcb94b61d588cf4af50295414fb202dd4b577ed2e44ce5e5f0df68bcec83b2 | 3,736 | 목표 약 3,000보다 큼. 보관 blade_sv_board |
| sv_dummy | f1a65bb7-036f-42a9-834c-f65e9b0fa330 | 0 | 90 (55+35) | 8,987,756 B | 9855c9d3408792d27b7d53eb9e95feab932e733f499e7fc8ff8cbe09173c2ae1 | 2,305 | 목표 약 2,000. 보관 blade_sv_dummy |
| sv_portal | 3d1ce9bb-1e05-4047-8d64-d40261ee6b2c | 0 | 90 (55+35) | 8,488,648 B | 287ef5748775695f41b9b26b0381a2034750578dd5db6742329b0f541d39faa9 | 5,226 | 안쪽 빈 아치 유지. 보관 blade_sv_portal |
| sv_statue | e8474ead-a805-4198-9eb0-a63becd76fd7 | 0 | 90 (55+35) | 7,935,020 B | c001596718f6b06e578bd15104f9a32ad105143f19261519f8e8c716d2f818ab | 5,387 | 보관 blade_sv_statue. 생성 버튼 첫 클릭이 먹지 않아 한 번 더 눌렀으나 크레딧은 한 번만 차감 |
| sv_fountain | fa1ad072-2a28-4f33-a0de-11b06ee11ba8 | 0 | 90 (55+35) | 8,607,924 B | 4b40c515d1aeb19d8bd89a0262f26c661ebd0511ff1155fa137ba99e93ee872a | 5,104 | 보관 blade_sv_fountain |
| sv_stall | b010b8f3-0859-453b-b8bd-576c9dda0b58 | 0 | 90 (55+35) | 9,323,236 B | 110b52089d3ef75d0c40418098fb8b68573819df328e54972550d36d9a5cb0cf | 5,471 | **결함: 차양(천막) 윗면에 검은 구멍 2~3개**(리토폴 후 front·top 캡처에서 보임). 재시도 안 함 — 필요하면 리토폴 값을 올려 재실행. 보관 blade_sv_stall |

- 미리보기 front.png·top.png는 Studio 화면 캡처(top은 축 기즈모 클릭 뷰).
- 참고: Studio 화면은 백그라운드에서 갱신이 멈춰서 완료 확인은 페이지 새로고침으로 했다. 리토폴 입력값이 작을수록(3,000·2,000) 결과가 약 15% 크게 나온다.
- 실행 중 한 번 Studio 상단이 "Sign up/Log in"으로 보이고 앱 목록이 비는 일시 현상이 있었으나 새로고침하니 로그인 상태가 유지되어 로그인·비밀번호 입력은 하지 않았다.
- 모든 GLB는 TLL-Asset-Foundry/props/blade_sv_<이름>/ 에 보관(상태 generated).
