# 4장 Tripo 몬스터 몸 (tll_ch4_*)

4장(별이 잠긴 심해) 3종과 손 소켓 prop 2종. Tripo 생성 2026-10-29(원본 `asset-library/incoming/tll_ch4`, Git 제외). 수집·연결 2026-10-29. 이번 작업에서 Tripo 재생성·크레딧 사용 없음.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch4_drowned` | 따개비 수부 `ch4_drowned` 외 6갈래 | 1.6 | 10,915 / 12,000 | 2,280,280 | soldier | `bone_knight` | 어깨·모자 따개비와 해초, 허리 닻사슬 |
| `tll_ch4_lurer` | 미끼등 아귀 `ch4_lurer` 외 3갈래 | 1.25 | 10,456 / 12,000 | 2,045,908 | caster | `skeleton_mage` | 이마 미끼등(몸의 일부), 두 다리로 서서 hover 없음 |
| `tll_ch4_maren` | 등대지기 마렌 `tide_midboss` | 2.2 | 10,578 / 20,000 | 2,152,256 | brute, boss | `goblin_brute` | 머리가 꺼진 등대 등실, 비옷·고무장화 |
| `tll_ch4_plankshield` | 난파선 판자 방패(prop) | 0.8 | 3,783 / 4,000 | 570,240 | — | — | 데시메이트 없음 |
| `tll_ch4_lantern` | 장대 등롱(prop) | 2.0 | 3,726 / 4,000 | 619,356 | — | — | 이미 세로로 서 있어 세우기 없음. 1.7 → 2.0 으로 다시 수집(마렌 키에 맞춤) |

- 텍스처 1k, 재질 1개, 뼈 65(Tripo Mixamo 규격). `bun run assets:verify` 통과(79개).
- 클립 키: `bone_knight`·`goblin_brute` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `skeleton_mage` 기증 = attackJump 대신 raise, summon(14). `impacts` 는 기증자 manifest 값 그대로(`ingest.mjs --impactsFrom`).
- 이식 보고: 수부 hipsRatio 0.463(65/65 본), 아귀 0.361(65/65 본, 다리 고정 없음), 마렌 0.416(65/65 본).

## 출처(provenance)

manifest 각 항목 `provenance.taskId` 는 원본 `tasks.json` 의 `workspace_task_id`, `prompt` 는 파이프라인 머리말 + 원화(T자세/소품) 프롬프트 전문, `rawSha256` 은 Tripo 원본 파일의 sha256(`--rawSource`).

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch4_drowned` | `aacd1d6f-a2d0-44b8-8ebd-f18dce6726e6` | `00f24e843eba44aa856a83f34661f67aef4603930820c63f87d305e27ec5e50d` |
| `tll_ch4_lurer` | `9c811150-36e7-48a8-91d1-67b4f402a0bc` | `9771452ec046801f212e963a8ce96175c815603da56c94d40650cde0e071e5a8` (rigged.glb) |
| `tll_ch4_maren` | `b089750f-11f7-4776-9358-23443d24fd3f` | `5ac5199503e00053f247f66a4264c9729c8e198f5642a0df72647b90b8a09e20` (rigged.glb) |
| `tll_ch4_plankshield` | `4c2d8317-217c-48be-8c66-e416404a03b4` | `64b79a8c49c4298d4b1dff4844fcd4023af46a6ac6828025d718b6ce5d302c1e` |
| `tll_ch4_lantern` | `ca5711c7-fc5e-4bdc-8c24-fd3340220c98` | `811c7319d5a25b2f9c3a0fe79da0d8265af30a09442a8340664c8c9ae13b8011` |

Tripo HD 원본(리토폴 전 raw.glb) 보관 위치는 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/ch4/<키>/raw.glb`(수부·판자 방패·장대 등롱). **`tll_ch4_lurer`·`tll_ch4_maren` 은 HD 원본 복구 불가**: 원본 내보내기가 Tripo 내보내기 창(형식 선택 오인식·브라우저 CDP 시간 초과)으로 실패한 뒤 리토폴로지가 HD 모델을 제자리에서 덮어썼다(재생성 75 크레딧씩 필요, tasks.json 기록). 그래서 두 몸의 `rawSha256` 은 리깅 모델 `rigged.glb` 기준이다. 크레딧 기록(몸 95씩 + 소품 75씩)은 원본 `tasks.json`(raw, Git 제외)에 있다. 원화는 GPT Image 2.5 무료 한도(구독 크레딧 0). 라이선스 `owner-generated (Tripo subscription)`, 무료 에셋 없음.

## 처리 순서 (재현 명령)

Blender 5.2.3 LTS 리눅스판(`/opt/blender`, 1~3장 문서와 같은 설치)을 썼다.

1. `asset-library/incoming/tll_ch4/<몸>/` 를 `asset-library/raw/tll_ch4_<몸>/`(Git 제외)에 복사하고 `SHA256SUMS` 대조(모두 OK).
2. 클립 이식 `tools/asset-library/blender_retarget_clips.py`(3장과 같은 명령, 다리 고정 없음):
   ```bash
   /opt/blender/blender -b --python-exit-code 1 --python tools/asset-library/blender_retarget_clips.py -- \
     --target asset-library/raw/<키>/rigged.glb --donor asset-library/normalized/<기증자>.glb \
     --output work/tmp/retarget/<키>.glb --report work/tmp/retarget/<키>.json
   ```
3. 수집:
   ```bash
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <키> --input work/tmp/retarget/<키>.glb \
     --rawSource asset-library/raw/<키>/rigged.glb --height <m> --map '<13~14키 동일 매핑>' --taskId <id> --prompt '<…>' \
     --profile <soldier|caster|brute> --impactsFrom <기증자> [--boss true]
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <prop> --input <prop.glb> --kind prop --height <m> --rawSource <원본> --taskId <id> --prompt '<…>'
   ```
   수집 뒤 manifest 에 `provenance.rawArchive` 를 적었다(원본이 있는 3개).

## 게임 연결

- `src/data/stages.js` `CHAPTER_SPECIES[4]`: 4장 **전투 방 편성(combatRosterFor)** 과 소환·정예 접두사·관문 지원병(`chapterSpeciesId`)에서만 바꾼다. 새 적 id 는 원래 적 정의 하나를 그대로 복사하고 이름·모델만 다르다. 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 90일 경제 밴드가 움직이지 않는다. 원정·5장(왕관, 같은 이계 침입자·심연 폭탄·심연 주시자)·확장 던전은 바뀌지 않는다.

| 원래 적 | 새 id | 이름 | 모델(몸) | 구분 |
|---|---|---|---|---|
| `squidle` | `ch4_drowned` | 따개비 수부 | `Ch4_Drowned` | 맨몸 |
| `blob_pink` | `ch4_drowned_line` | 따개비 덮인 수부 | `Ch4_Drowned` | 해초 녹색 몸빛 |
| `alien` | `ch4_drowned_anchor` | 닻 끄는 수부 | `Ch4_Drowned` | 등에 닻사슬(anchorChain), 돌격 역할 유지 |
| `mushnub` | `ch4_drowned_coral` | 산호 핀 수부 | `Ch4_Drowned` | 어깨 산호(coralGrowth) |
| `golem_guard` | `ch4_plankguard` | 판자 방패 수부 | `Ch4_PlankGuard` | 왼손 판자 방패(shield 행동) |
| `skel_minion` | `ch4_deckhand` | 갑판 수부 | `Ch4_Drowned` | 어두운 몸빛(합류 경로 4-2·4-6·4-9) |
| `ghost` | `ch4_drowned_drift` | 떠밀려 온 수부 | `Ch4_DrownedDrift` | 창백한 몸빛, 불투명(합류 경로) |
| `glub` | `ch4_lurer` | 미끼등 아귀 | `Ch4_Lurer` | 맨몸 |
| `bomb_abyss` | `ch4_lurer_bomb` | 경고등 아귀 | `Ch4_Lurer` | 붉은 발광, 원본 분홍 색조 제거 |
| `abyss_seer` | `ch4_lurer_seer` | 빛주머니 아귀 | `Ch4_Lurer` | 빛 주머니(glowPouches), 청록 색조, 지원 소환은 수부 |
| `ghost_skull` | `ch4_lurer_glim` | 깜빡이 아귀 | `Ch4_LurerGlim` | 청록 발광 조금 세게, 불투명(합류 경로) |

  `armabee_evo`(진화한 독침벌)와 정예(심연 골렘·버섯 왕·새끼 용·해골 대장)는 옛 몸 그대로 소수로 남긴다.
- 일반 방 새 몸 비율(`composeRoom(R, st, room, s.idx, 16)` 10방×16): 4-1 100%, 4-2 100%, 4-3 90%, 4-4 89%, 4-5 91%, 4-6 100%, 4-7 93%, 4-8 93%, 4-9 100%, 4-10 92%(나머지는 진화한 독침벌). `test/chapter-dress.test.ts` 가 85% 이상을 검사한다.
- 4장 관문·보스가 부르는 지원병(summon `squidle`)은 `ch4_drowned` 로 바꿨다(지원병 루프에 `['tide', 4]` 추가).
- `src/data/encounter-models.js` `CAMPAIGN_MODELS`: `tide_midboss → Ch4_Maren`. 4장 1관문 대장(`tide_captain`)은 얼음 골렘 그대로(concept-boss-loop 공유 경계 불변).
- `src/data/monster-roster.js`: `Ch4_Drowned`·`Ch4_DrownedDrift`·`Ch4_PlankGuard`·`Ch4_Lurer`·`Ch4_LurerGlim`·`Ch4_Maren`. 원본 종 크기가 다른 자리(원령 1.25·골렘 수호자 1.15·해골 망령 1.2)는 항목을 나눠 보이는 키를 맞췄다. 판자 방패 `offhand` rot `[0, 0, 0]`(판자 면이 앞), 장대 등롱 `weapon` rot `[160, 0, 0]`(등롱이 머리 위로).
- `src/data/chapter-dress.js`: 4장 몸은 이미 남색·청록이라 `DEEP_*` 재배치를 걸지 않고 발광·몸빛만 준다. 몸에 이미 있는 따개비·허리 닻사슬·이마 미끼등과 겹치는 소품(`barnacles`·`lureLamp`)은 뺐다. 마렌은 머리가 등대 등실이고 손에 등롱을 들어 등대 렌즈·빛 주머니 소품을 뺐다.
- `src/game/region-traits.js`: 4장 지역 동사(부유 촉수의 `촉수 낚아채기`)는 원래 적 id 에 묶여 있어, `regionSpeciesVerb` 가 `speciesSourceId`(장 전용 종 → 복사한 원래 종)로 찾아 따개비 수부에 그대로 붙는다(`test/region-traits.test.ts`). 밀물·소용돌이(undertow)는 모델과 무관하다.
- `src/data/stages.js` `OPAQUE_SPIRIT_BODIES` 에 `Ch4_DrownedDrift`·`Ch4_LurerGlim` 추가(원령·해골 망령의 `ghostly` 반투명을 물려받지 않음). `BODY_TINTS`: 경고등 아귀는 원본 분홍 색조를 빼고(남색 몸과 섞이면 붉은 색조도 보라가 됨) 의상 붉은 발광으로, 빛주머니 아귀는 청록 색조.
- 도감(`src/data/lore.js`): 4장 전투 편성에 나오는 11종 모두 추가.
- 보이는 키(영웅 1.8 m 대비, 크기 띠 보정 없음): 수부 1.64~1.75 m(0.91~0.97), 아귀 1.31~1.38 m(0.73~0.77), 마렌 3.43 m(1.91).
- 근접 확인: `node tools/dress-closeup.mjs 4 work/qa/ch4 after`(줄 5~7).

## 남은 것

- swiftshader 캡처 기준이며 실기기 GPU 화면·밀집 전투 가독성은 확인하지 않았다.
- 빛주머니 아귀의 빛 주머니 소품은 정면 대기 자세에서 작게 보인다(지원 소환 원형 표시로 구분됨). 따개비 덮인 수부의 해초 몸빛 차이도 약하다.
- 아귀·마렌의 Tripo HD 원본은 복구 불가(위 출처).
