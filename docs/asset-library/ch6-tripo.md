# 6장 Tripo 몬스터 몸 (tll_ch6_*)

6장(함께 잇는 귀환로, 잔향 장) 2종과 손 소켓 prop 1종. Tripo 생성 2026-10-29(원본 브랜치 `claude/tripo-ch6-homecoming`, 머지 대상 아님 — `asset-library/incoming/tll_ch6` 만 가져옴, Git 제외). 수집·연결 2026-10-29. 이번 작업에서 Tripo 재생성·크레딧 사용 없음.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch6_passenger` | 귀환 열차 승객 잔향 `ch6_passenger` 외 9갈래 | 1.6 | 10,113 / 12,000 | 1,776,724 | soldier | `bone_knight` | 얼굴 없는 잿빛 코트·목도리, 목에 빈 이름표 다발 |
| `tll_ch6_witness` | 빈 의자의 증인 `homecoming_midboss` | 2.2 | 10,470 / 20,000 | 1,881,108 | brute, boss | `goblin_brute` | 깊은 두건, 등에 끈으로 묶은 빈 의자, 가슴 청록 빛 구멍 |
| `tll_ch6_suitcase` | 낡은 여행 가방(prop) | 0.5 | 3,717 / 4,000 | 549,556 | — | — | |

- 텍스처 1k(WebP), 재질 1개. 증인은 Tripo 2K 텍스처를 `ingest.mjs --texLimit 1024` 로 1K 로 줄였다. `bun run assets:verify` 통과(89개).
- 뼈: `rigged.fbx` 는 Mixamo 65관절, `rigged.glb` 는 끝 관절을 뺀 52본. 끝 관절은 가중치 없는 잎 뼈라 GLB 그대로 썼다(5장 문서와 같은 판단).
- 증인은 Tripo 가 "Not Ready for Auto-Rigging"(등의 의자, 내린 팔)을 띄운 뒤 강행 리깅했다. 포즈 시트(`blender_pose_sheet_clips.py`, idle·walk·attack·attackHeavy·attackSpin·attackJump·roar·hit·death 앞/옆)에서 찢어짐·뒤틀림은 보이지 않았고, 의자는 등뼈를 따라 함께 움직인다. 큰 동작(attackSpin·attackJump)에서 망토 자락이 의자와 함께 늘어나는 정도라 클립을 바꾸지 않았다.
- 클립 키: `bone_knight`·`goblin_brute` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `impacts` 는 기증자 값 그대로.
- 이식 보고: 승객 hipsRatio 0.378(52/52 본), 증인 0.388(52/52 본).

## 출처(provenance)

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch6_passenger` | `710e7a51-8c75-4206-ab94-0f18c8cb4eea` | `950f1e8d156a2b75a7607f22cee8504a7e39e04ee96d9251c5e8d34120955995` |
| `tll_ch6_witness` | `7d69ab3b-1a2f-41cb-a1de-1b3736d696a2` | `494e58de90fbf98b60f6d82e62c46aaf75f8033f678d2d75ed32adaafdb431b5` |
| `tll_ch6_suitcase` | `18236527-af64-417e-bc53-2f3e9f814f67` | `b80303fe9d919cc649ce5c4add38fbbc040c9ccac818e449a91f296f5bd76239` |

`rawSha256` 은 캐릭터 `rigged.glb`·prop 원본 GLB 기준. Tripo HD 원본(raw.glb)은 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/ch6/<키>/raw.glb`. 크레딧 기록은 원본 `tasks.json`(Git 제외). 라이선스 `owner-generated (Tripo subscription)`.

## 처리 순서

5장 문서(`docs/asset-library/ch5-tripo.md`)와 같은 명령이다(승객 `bone_knight`, 증인 `goblin_brute --boss true --texLimit 1024`, 여행 가방은 세우기 없이 prop 수집).

## 설계 선택: 잔향 장의 몸

6장은 "다섯 지역에 남은 명령의 잔향"을 걷는 장이라, 그동안 `chapterSpeciesId` 가 6장을 일부러 빼서 1~5장 적이 옛 몸 그대로 나왔다. 1~5장이 모두 Tripo 전용 몸을 갖게 되면서 6장만 옛 몸이 남고 6장 고유의 얼굴도 없었다. 선택:

1. **6장 고유 몸 = 귀환 열차 승객 잔향.** 경로마다 가장 흔한 근접 졸병 자리 10종(`skel_minion`·`ghost`·`skel_rogue`·`imp`·`tribal`·`cacto_wall`·`golem_guard`·`squidle`·`mushnub`·`frost_burrower`)을 승객 갈래로 바꿔 일반 방의 41~63%가 새 몸이다. 각 갈래는 원래 적 하나를 그대로 복사하고, 고향 지역의 흔적을 몸빛으로(그을린 짐꾼·이끼·바닷물빛·서리 하늘빛·푸른 철빛) 나누며, 손의 여행 가방(늘어뜨림·방패)으로 실루엣을 나눈다.
2. **나머지 = 경로 고향 장 전용 몸의 잔향.** `chapterSpeciesSwap(6, 던전)` 이 그 경로의 고향 장(`DUNGEON_HOME`: 행렬·온실·심판정·주소지 → 1장, 용광로 → 2장, 서고 → 3장, 등대·합류 수로 → 4장) 표 위에 승객 표를 덮는다. 예: 6-4 귀항 등대는 경고등 아귀·빛주머니 아귀·따개비 덮인 수부가, 6-8 서고는 곰팡이 핀 사서·검열관이 나온다. 의상은 원래 6장 규칙(`chapterDressFor` echo 분기)이 그 id 의 고향 장 의상을 찾아 귀환 청록 발광으로 덧입힌다 — 몸·의상·발광이 같은 "잔향" 규칙으로 맞물린다.
3. 승객 갈래에 고향 장 몸(예: 1장 관꾼)을 쓰지 않은 이유: 그러면 6장 고유의 얼굴이 사라진다. 고향 장 몸을 쓰지 않고 승객만 쓰지 않은 이유: 잔향(다섯 지역을 순례하는 귀환로)이라는 장의 개념이 사라진다. 그래서 약 절반씩 나눴다.
4. 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 경제 밴드는 움직이지 않는다. 지역 특성 `망각의 잔향`(평타 처치 해골 1회 부활, `SKELETAL`)은 그대로 해골·1장 몸에만 걸린다 — 해골 몸이던 자리가 승객(해골 병사·자객)이나 4·3장 몸(합류 수로의 해골 망령 → 깜빡이 아귀, 서고의 해골 사제·주술사 → 검열관)으로 바뀐 경로(6-1·6-3·6-5·6-6·6-8·6-10)는 부활 대상이 줄고(1장 묘비 방패병·곡하는 원령 갈래와 뼈 오크는 계속 부활), 용광로·등대 경로는 원래 해골이 없어 변화가 없다. 안내 문구가 "해골"이라 승객을 `SKELETAL` 에 넣지 않았다.

| 원래 적 | 새 id | 이름 | 모델(몸) | 구분 |
|---|---|---|---|---|
| `skel_minion` | `ch6_passenger` | 귀환 열차 승객 | `Ch6_Passenger` | 왼손에 여행 가방(늘어뜨림), 보스 지원병 |
| `ghost` | `ch6_passenger_drift` | 떠도는 승객 잔향 | `Ch6_PassengerDrift` | 더 바랜 몸빛, 불투명(원령 `ghostly` 제거) |
| `skel_rogue` | `ch6_passenger_hurry` | 서두르는 승객 | `Ch6_PassengerBare` | 맨손 |
| `imp` | `ch6_passenger_child` | 꼬마 승객 | `Ch6_PassengerSmall` | 작은 키(0.86) |
| `tribal` | `ch6_passenger_porter` | 짐꾼 승객 | `Ch6_Passenger` | 그을음 갈색 몸빛 + 가방 |
| `cacto_wall` | `ch6_passenger_trunk` | 가방 방패 승객 | `Ch6_PassengerTrunk` | 가방을 앞에 방패로(shield 행동) |
| `golem_guard` | `ch6_passenger_gate` | 개찰구 승객 | `Ch6_PassengerTrunk` | 푸른 철빛 몸빛 + 가방 방패 |
| `squidle` | `ch6_passenger_tide` | 바닷길 승객 | `Ch6_PassengerBare` | 바닷물빛 몸빛 + 따개비(barnacles) |
| `mushnub` | `ch6_passenger_moss` | 이끼 낀 승객 | `Ch6_PassengerBare` | 이끼 녹색 몸빛 |
| `frost_burrower` | `ch6_passenger_lost` | 길 잃은 승객 | `Ch6_PassengerBare` | 서리 하늘빛 몸빛, 원본 하늘색 색조 제거 |

- 일반 방 비율(10방×16): 승객 몸 6-1 63%·6-2 50%·6-3 56%·6-4 50%·6-5 46%·6-6 60%·6-7 41%·6-8 59%·6-9 49%·6-10 60%. 승객 + 고향 장 Tripo 몸 합계 6-1 100%·6-2 88%·6-3 68%·6-4 91%·6-5 63%·6-6 100%·6-7 74%·6-8 100%·6-9 89%·6-10 100%(나머지는 고향 장 표에 없는 옛 몸: 뼈 오크·폭탄 슬라임·닌자·화염 정령·진화한 독침벌 등). `test/chapter-dress.test.ts` 가 승객 40~65% 를 검사한다.
- `homecoming_*` 관문·보스 지원병(summon `skel_minion`)은 `ch6_passenger` 로 바꿨다(지원병 루프에 `['homecoming', 6]`).
- `src/data/encounter-models.js` `CAMPAIGN_MODELS`: `homecoming_midboss → Ch6_Witness`. 최종 보스(고립의 잔향)는 그대로.
- `src/data/monster-roster.js`: `Ch6_Passenger`·`Ch6_PassengerBare`·`Ch6_PassengerSmall`·`Ch6_PassengerDrift`·`Ch6_PassengerTrunk`·`Ch6_Witness`. 손 소켓: 늘어뜨린 가방 grip `[0, 0.45, 0]` rot `[0, 0, 180]`(손잡이를 쥐고 아래로), 가방 방패 grip `[0, 0.08, 0.05]` rot `[90, 0, 0]`(처음 0.25·0.4 는 얼굴을 가려 내렸다).
- `src/data/chapter-dress.js` 6장: 증인은 두건·등의 의자가 몸에 있어 상복 베일·맹세 깃발 소품을 빼고 잔향 발광만 준다. 승객 갈래는 밝은 잿빛 몸이 6장 청록 조명에서 하얗게 날아가 몸빛을 한 톤 누르고(`#8a9896` 0.35) 발광을 약하게(`#0a2420`) 둔다.
- `src/game/rpg-catalogue.js`·`test/content-identity.test.ts`: 도감 출현 위치가 `chapterSpeciesSwap(장, 던전)` 을 써 6장 경로별 고향 장 몸까지 잡는다. 도감(`lore.js`)에는 승객 갈래 10종을 추가했다(고향 장 몸은 이미 1~4장 항목이 있다).
- 보이는 키: 승객 1.67~1.76 m(0.93~0.98), 꼬마 1.55 m(0.86), 떠도는 승객 1.70 m(0.94), 가방 방패 1.71~1.78 m(0.95~0.99), 증인 3.43 m(1.91).
- 근접 확인: `node tools/dress-closeup.mjs 6 work/qa/ch6 after`(줄 4~7, 마지막 줄은 고향 장 몸의 잔향).

## 남은 것

- swiftshader 캡처 기준이며 실기기 GPU 화면은 확인하지 않았다.
- 6장 청록 조명에서 승객 갈래의 몸빛 차이(짐꾼·바닷길·이끼)가 약하게 보이고, 바닷길 승객의 따개비 소품은 작다. 가방 방패는 턱을 조금 가린다.
- `망각의 잔향` 부활 대상이 6장 일부 경로에서 줄었다(위 설계 선택 4).
