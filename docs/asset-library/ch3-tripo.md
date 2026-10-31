# 3장 Tripo 몬스터 몸 (tll_ch3_*)

3장(거꾸로 흐르는 서리 도서관) 3종과 손 소켓 prop 3종. Tripo 생성 2026-10-28(원본 브랜치 `claude/tripo-ch3-frost`, 머지 대상 아님 — `asset-library/incoming/tll_ch3` 만 가져옴). 수집·연결 2026-10-28. 이번 작업에서 Tripo 재생성·크레딧 사용 없음.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch3_librarian` | 서리 해골 사서 `ch3_librarian` 외 4갈래 | 1.6 | 10,959 / 12,000 | 2,372,956 | soldier | `bone_knight` | 등에 얼어붙은 책 더미, 둥근 안경 |
| `tll_ch3_censor` | 망령 검열관 `ch3_censor` 외 3갈래 | 1.7 | 10,201 / 12,000 | 1,948,596 | caster, hover 0.25 | `skeleton_mage` | 검은 눈가리개 띠, 다리 대신 두루마리 자락(다리 본 고정) |
| `tll_ch3_ordin` | 기록관 오르딘 `frost_midboss` | 2.2 | 10,756 / 20,000 | 2,139,880 | brute, boss | `goblin_brute` | 가슴 얼음 석판, 두루마리 띠 |
| `tll_ch3_shelfshield` | 서가 방패(prop) | 0.8 | 3,700 / 4,000 | 599,196 | — | — | Tripo 4,182 → 데시메이트 3,700(원본 브랜치에서 처리) |
| `tll_ch3_tome` | 펼친 금서(prop) | 0.35 | 3,716 / 4,000 | 471,916 | — | — | |
| `tll_ch3_seal` | 봉인 도장 철퇴(prop) | 1.0 | 3,700 / 4,000 | 512,024 | — | — | Tripo 4,286 → 데시메이트 3,700, 주축 세움(49.2°) |

- 텍스처 1k, 재질 1개, 뼈 65(Tripo Mixamo 규격). `bun run assets:verify` 통과(74개).
- 클립 키: `bone_knight`·`goblin_brute` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `skeleton_mage` 기증 = attackJump 대신 raise, summon(14). `impacts` 는 기증자 manifest 값 그대로(`ingest.mjs --impactsFrom`).
- 이식 보고: 사서 hipsRatio 0.488(65/65 본), 검열관 0.447(55/65 본, 다리 본 고정), 오르딘 0.342(65/65 본).

## 출처(provenance)

manifest 각 항목 `provenance.taskId` 는 원본 `tasks.json` 의 `workspace_task_id`, `prompt` 는 파이프라인 머리말 + 원화(T자세/소품) 프롬프트 전문, `rawSha256` 은 Tripo 원본 파일(캐릭터 `rigged.glb`, prop 원본 GLB)의 sha256(`--rawSource`).

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch3_librarian` | `302993fb-f9e2-4e52-b516-d8b75bdc05db` | `a7497b88b387dff9e320f92c8dfd0a7f82f8e3c6c1e54d8d3d3b967fb014b1f6` |
| `tll_ch3_censor` | `b2f11866-4602-4002-921d-a48f42197d97` | `46ed43d9d91d0d908b7a9a20365243174c2646de8e92b860bcec4009b411ba8f` (rigged.glb) |
| `tll_ch3_ordin` | `161080b2-23c1-4c38-86f0-f226ecd616d3` | `2e7b186b3d8cf9f6f9fe9d28893a3a5af9866f1d8d58d4f235ae7b033ed5feb9` |
| `tll_ch3_shelfshield` | `e79c2260-ed0f-4a27-81ce-c0f78cc559de` | `8fe44ec726561a93959aedc0e5ca0b8b3487d4ef52998952dafd80321daec773` (3,700 판) |
| `tll_ch3_tome` | `0ae7cf3b-8e3d-4cb9-ab31-6f2e34e8e844` | `d1e1134fb20c231fd9fd16f441e80345664bd7476ec1730f387cb75ec856d214` |
| `tll_ch3_seal` | `c719dfce-b4e9-451f-b2e5-965df751976a` | `18b8baef0785ab8eac5a7c2daad9b3ef3e513892bcfd27796092bb47338cda3d` (3,700 판, 세우기 전) |

Tripo HD 원본(리토폴 전 raw.glb) 보관 위치는 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/ch3/<키>/raw.glb`(사서·오르딘·서가 방패·금서·도장 철퇴). **`tll_ch3_censor` 만 HD 원본 복구 불가**: 원본 내보내기가 Tripo 내보내기 창 변경으로 실패한 뒤 리토폴로지가 HD 모델을 제자리에서 덮어썼다(재생성 75 크레딧 필요, tasks.json 기록). 그래서 검열관의 `rawSha256` 은 리깅 모델 `rigged.glb` 기준이다. 크레딧 기록(몸 95 + 소품 75씩)은 원본 `tasks.json`(raw, Git 제외)에 있다. 라이선스 `owner-generated (Tripo subscription)`, 무료 에셋 없음.

## 처리 순서 (재현 명령)

Blender 5.2.3 LTS 리눅스판(`/opt/blender`, 1·2장 문서와 같은 설치)을 썼다.

1. `asset-library/incoming/tll_ch3/<몸>/` 를 `asset-library/raw/tll_ch3_<몸>/`(Git 제외)에 복사하고 `SHA256SUMS` 대조(모두 OK).
2. 클립 이식 `tools/asset-library/blender_retarget_clips.py`:
   ```bash
   /opt/blender/blender -b --python-exit-code 1 --python tools/asset-library/blender_retarget_clips.py -- \
     --target asset-library/raw/<키>/rigged.glb --donor asset-library/normalized/<기증자>.glb \
     --output work/tmp/retarget/<키>.glb --report work/tmp/retarget/<키>.json
   # 검열관만: --freeze 'UpLeg|Leg$|Foot|Toe'
   ```
   점검 스틸은 `tools/asset-library/blender_pose_sheet_clips.py`(idle·walk·attack·cast·death 앞/옆).
3. 봉인 도장 철퇴(49.2°)는 `tools/asset-library/blender_prop_upright.py` 로 주축을 세로로 세운 뒤 수집. 서가 방패·금서는 그대로.
4. 수집:
   ```bash
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <키> --input work/tmp/retarget/<키>.glb \
     --rawSource asset-library/raw/<키>/rigged.glb --height <m> --map '<13~14키 동일 매핑>' --taskId <id> --prompt '<…>' \
     --profile <soldier|caster|brute> --impactsFrom <기증자> [--hover 0.25] [--boss true]
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <prop> --input <prop.glb> --kind prop --height <m> --rawSource <원본> --taskId <id> --prompt '<…>'
   ```
   수집 뒤 manifest 에 `provenance.rawArchive` 를 적었다.

## 게임 연결

- `src/data/stages.js` `CHAPTER_SPECIES[3]`: 3장 **전투 방 편성(combatRosterFor)** 에서만 바꾼다. 새 적 id 는 원래 적 정의를 그대로 복사하고 이름·모델만 다르다. 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 90일 경제 밴드가 움직이지 않는다. 원정·6장(귀환로)·7장은 바뀌지 않는다(`chapterSpeciesId`).

| 원래 적 | 새 id | 이름 | 모델(몸) | 구분 |
|---|---|---|---|---|
| `ghost` | `ch3_censor` | 망령 검열관 | `Ch3_Censor` | 맨몸 |
| `ghost_skull` | `ch3_censor_slip` | 쪽지 날리는 검열관 | `Ch3_Censor` | 얼어붙은 쪽지(frozenPages) |
| `skel_mage` | `ch3_censor_tome` | 금서 낭독 검열관 | `Ch3_CensorTome` | 오른손 금서 |
| `skel_priest` | `ch3_censor_quill` | 깃펜 든 검열관 | `Ch3_CensorTome` | 금서 + 얼음 깃펜 관 |
| `skel_shield` | `ch3_shelfguard` | 서가 방패 사서 | `Ch3_ShelfGuard` | 왼손 서가 방패 |
| `skel_rogue` | `ch3_librarian` | 서리 해골 사서 | `Ch3_Librarian` | 맨몸 |
| `bone_orc` | `ch3_keykeeper` | 열쇠지기 사서 | `Ch3_Librarian` | 어두운 몸빛 + 열쇠 꾸러미 |
| `frost_burrower` | `ch3_icecrawler` | 얼음 밑 사서 | `Ch3_Librarian` | 머리 얼음 결정 |
| `blob_green` | `ch3_moldkeeper` | 곰팡이 핀 사서 | `Ch3_Librarian` | 푸른 이끼색 몸빛 |

  `golem_guard` 와 정예(설산 거인·대원령·심연 골렘)는 옛 몸 그대로다. 부패 슬라임은 3-1·3-2 일반 방의 31%를 차지해 그대로 두면 새 몸 비율이 63~69%에 머물러 사서 갈래로 바꿨다.
- 일반 방 새 몸 비율(`composeRoom(R, st, room, s.idx, 16)` 10방×16): 3-1 100%, 3-2~3-7 94%, 3-8 93%, 3-9·3-10 94%.
- 3장 관문·보스가 부르는 지원병(summon `ghost`)도 `ch3_censor` 로 바꿨다(1·2장 루프에 `['frost', 3]` 추가).
- `src/data/encounter-models.js` `CAMPAIGN_MODELS`: `frost_midboss → Ch3_Ordin`.
- `src/data/monster-roster.js`: `Ch3_Librarian`·`Ch3_ShelfGuard`·`Ch3_Censor`·`Ch3_CensorTome`·`Ch3_Ordin`. 손 소켓 rot 은 후보 4개를 같은 장면에 세워 앞·옆에서 찍어 골랐다: 서가 방패 `[90, 180, 0]`(묘비 방패와 손 축이 달라 180° 돌려 책 면이 앞), 금서 `[90, 0, 0]`(펼친 면이 위·앞), 봉인 도장 철퇴 `[90, 0, 40]`(머리가 위, 몸 바깥으로 기울어 정면에서 보임).
- `src/data/chapter-dress.js`: 사서는 `FROST_BONE`, 검열관은 발광만(재배치가 몸 무늬를 지움). 몸에 이미 있거나 손에 든 실루엣(책 더미 `bookStackBack`·서가 방패 `shelfShield`·금서 `openTome`·봉인 도장 `censorSeal`)과 겹치는 소품은 뺐다. 오르딘도 도장·금서 소품을 뺐다.
- `src/game/region-traits.js`: 3장 지역 특성(서리 손톱)은 모델과 무관하게 적의 타격에 걸려 바꿀 것이 없다. `SKELETAL`(망각의 잔향)은 정원·종탑 전용이라 3장 몸을 넣지 않았다.
- 보이는 키(영웅 1.8 m 대비): 사서 1.60~1.76 m(0.89~0.98), 검열관 1.63~1.79 m(0.91~0.99, +hover 0.25), 오르딘 3.43 m(1.91, 크기 띠 적용 전).
- 근접 확인: `node tools/dress-closeup.mjs 3 work/qa/ch3 after`(줄 5~7).

## 남은 것

- 검열관은 흰 법복 무늬가 텍스처에 있어 원령의 `ghostly`(반투명·푸른 발광)를 빼고 불투명으로 둔다(`stages.js` OPAQUE_SPIRIT_BODIES). swiftshader 캡처 기준이며 실기기 GPU 화면은 확인하지 않았다.
- 얼음 밑 사서는 잠복형이라 근접 캡처에서 땅속 자세로 찍힌다(솟구침 장면은 별도 확인 필요).

- 깃펜 검열관(skel_priest 자리)의 지원 소환(skel_minion)은 `ch3_pagebearer`(사서 몸+얼어붙은 책장)로 나온다.
