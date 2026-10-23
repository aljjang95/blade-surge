# t4 PC 결과 (Tripo Studio, H3.1, 삼각형 리토폴 11,000 지정, Humanoid+Mixamo 리그, 애니메이션 없음)

시작 크레딧 표시 13005 (2026-10-23). 끝 크레딧 11885 (총 1,120 사용: 10건 × 110 + rogue_t2u 재리그 20. 상한 2,000 이내, API 지갑·추가 구매 없음)

공통: 원화는 Codex CLI(`codex exec -i <참고 이미지> -`, 이미지 생성 도구)로 대상마다 a안 1장 생성(프롬프트는 대상 폴더 `prompt.txt`). 10장 모두 a안을 채택(b안은 만들지 않음 — 정체성·등급 차이·눈 노출 모두 합격으로 판단, 불합격이면 b를 만들 계획이었음). 내보내기는 **GLB, 텍스처 2K, 스켈레톤 켬, 애니메이션 0**(애니메이션 탭에서 `걷기` 프리셋 재생·팔다리 움직임 확인 후 같은 화면에서 내보냄). 건마다 생성 55 + 리토폴 35 + 리그 20 = 110 크레딧. 생성 화면의 "8K 텍스처" 토글은 켜진 기본값이었으나 내보내기에서 2K를 골랐다.
미리보기: 정면·3/4(좌우 약 35° 드래그)·위(상하 드래그, 대략 40~55°) 3장 저장. 각도는 마우스 드래그라 정밀 각이 아니다(근사). knight_t1s의 3/4·위 미리보기는 저해상도(627px).
아카이브: `G:/내 드라이브/10_스톡라이브러리/04_그래픽3D템플릿/TLL-Asset-Foundry/characters/blade_<대상>_pc/raw/rigged_2k_weighted.glb`.

| 대상 | 원화 | Tripo task id(워크스페이스 id) | 재시도 | 크레딧 | rigged.glb (크기 · sha256) | 삼각형/관절 | check-weights / check-joints | 얼굴 3각도 | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| knight_t1s | a | ae08ba95-9849-41f9-9249-aa84a11d455d | 0 | 110 | 10,652,160 B · d89688d8ac0b6db8a259e7eefad263a53a078ffe9075335833358402253cd0aa | 10,723 / 65 | ok=true, v16170, multiInfluence 13828 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임 | 걷기 미리보기 정상. 왼어깨뿐 아니라 양어깨 모두 철판(원화가 양쪽 견갑) |
| knight_t2u | a | 2e9879b9-6cce-4ea8-8d48-d40219fa1c87 | 0 | 110 | 10,570,428 B · 5e3503c8b7cd424a40e8dc608ba7fe98c34509fe4b2e7292183d9e5cf47ed117 | 10,939 / 65 | ok=true, v15184, multiInfluence 13245 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임 | 걷기 미리보기 정상. 번개 날개 지느러미·하늘색 발광 |
| rogue_t1s | a | 061e6bfc-ebdd-4dc3-9701-290d234ded7e | 0 | 110 | 9,839,752 B · c5b01e7a58e8390aa74de15d56a1cab6c822100a796c4d119ef5fb80bc4234db | 10,992 / 65 | ok=true, v16762, multiInfluence 13733 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈·붉은 눈 보임(목도리가 입만 가림) | 걷기 미리보기 정상(목도리 흔들림). 목도리 끝은 몸 옆으로 길게 뻗음(다리 사이 아님) |
| rogue_t2u | a | d387ae62-d107-4884-93b4-78470d3ec53b | 리그 1회 재시도 | 130 (55+35+20 + 재리그 20) | 9,757,372 B · a0a960d2df4775c84120ba9e956665775f0a67872afee7fd7a3d0c0131cc0483 | 10,871 / **66** | check-weights ok=true, v16935, multiInfluence 15159 / **check-joints 실패: joints 66, withTranslation 65** | 정면·3/4·위 모두 두 눈 보임 | **관절 검사 미달**: 스킨에 `neutral_bone`(index 65, 이동값 없음) 1개가 추가돼 66개. 걷기 미리보기 화면에서 같은 설정으로 재내보내기 1회 + 리그 재실행 후 재내보내기 1회(`rigged` 두 번째 파일 9,758,220 B)도 똑같이 66개. 다른 9건은 모두 65개. 클라우드에서 neutral_bone 제거·병합 필요(가중치 확인 필요). 파일은 첫 내보내기 결과 그대로 보관. 위 55° 미리보기는 카메라가 거의 정면+약간 위(근사) |
| mage_t1s | a | d1a12cf8-1dfc-4b39-90b2-2321315a2f41 | 0 | 110 | 10,969,996 B · bb85305b74d09512f76332b40010e477d75ca8d0f71d32eecd42715e4ac14ea7 | 10,574 / 65 | ok=true, v16194, multiInfluence 13809 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임(모자챙이 눈썹 위) | 걷기 미리보기 정상. 가슴 은 코르셋·어깨 은 견갑·초록 브로치 |
| mage_t2u | a | 21b97002-19e1-4d48-8e6b-0330186ef405 | 0 | 110 | 10,078,372 B · 3891195a93b8c9b1fc9fb73fdbf0e631a29d1976e892b62292265b3af453ec8d | 10,042 / 65 | ok=true, v15699, multiInfluence 13656 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임 | 걷기 미리보기 정상(미리보기 일시정지 시점 포즈). 얼음 결정 어깨·모자 끝 결정, 붉은색 없음 |
| ranger_t1s | a | 3d19c499-36d2-4cfa-bff6-36907b96724f | 0 | 110 | 10,199,204 B · daad155fd4fba1d59b348cee13a878670415e6ec6f5e928d51d9db7e5c2a5467 | 11,180 / 65 | ok=true, v17313, multiInfluence 15969 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임(앞머리 양옆으로 갈라짐) | 걷기 미리보기 정상(땋은 머리·팔다리 움직임). 철판은 왼어깨 견갑·흉판 띠·정강이 각반 |
| ranger_t2u | a | 2503822d-7b66-43f5-aead-4cf677ae684a | 0 | 110 | 10,592,220 B · bc9727dc2a127663e44eed645bc890c8c41794061fd928b6b659a92a33050b14 | 11,168 / 65 | ok=true, v17783, multiInfluence 16267 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임 | 걷기 미리보기 정상. 불꽃 깃털 견갑·불꽃 망토 끝 |
| barbarian_t1s | a | 1679bfe5-7ee8-417a-8e3c-fa1155a2150e | 0 | 110 | 11,495,504 B · 99aafcf4cdbf8959f9285dcfd851ffb4dea051a62ec89561003f404fa569c46a | 11,491 / 65 | ok=true, v18751, multiInfluence 17994 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임(볼 문양 한 줄씩, 뿔 투구가 이마 덮지 않음) | 걷기 미리보기 정상. 양어깨 철판 견갑·가슴 철판·벨트 버클 초록 보석 |
| barbarian_t2u | a | 7e9b82cc-0f8f-425e-92b8-1257163ace7f | 0 | 110 | 11,331,792 B · 969fd0fe4358ebab4a2d1c7a36d17d619df46b5ba742dd3f3ffdb00e0eb18c3b | 11,155 / 65 | ok=true, v18640, multiInfluence 17640 / joints 65, withTranslation 65 | 정면·3/4·위 모두 두 눈 보임 | 걷기 미리보기 정상. 흑자색 갑옷·보라 고리 장식(견갑에 붙음)·가슴 보라 수정, 털 망토는 회색 |

## 남은 것·주의 (클라우드가 처리)
- **rogue_t2u 관절 66개(neutral_bone 추가)**: check-joints 불합격. 같은 화면 재내보내기 1회·리그 재실행 1회로도 동일. 클라우드에서 `neutral_bone` 제거(가중치 0 확인 후)하거나 Tripo 리그를 다시 돌려 재시도.
- 미리보기 각도는 마우스 드래그 근사(3/4는 대략 20~35°, 위는 대략 15~30°)이며 knight_t1s의 3/4·위만 저해상도(627px). 얼굴 3각도 점검은 이 근사 각도 기준.
- 원화는 a안만 만들고 b안은 생성하지 않았다(모두 합격으로 판단). knight_t1s는 양쪽 어깨에 견갑이 있어 브리프의 "왼어깨 견갑"보다 한쪽 더 많다. 등급별 실루엣 차이는 클라우드 비교 렌더에서 최종 판정.
- 세션 중 Chrome이 한 번 꺼져(확장 연결 끊김) 다시 띄움. rogue_t2u 생성은 그 사이 서버에서 끝나 있었고 손실 없음.
- 아카이브: 10건 모두 `blade_<대상>_pc`로 TLL-Asset-Foundry/characters에 보관(raw/rigged_2k_weighted.glb + preview_front).
