# 7장 Tripo 몬스터 몸 (tll_ch7_citizen·tll_ch7_tuner)

7장(금 간 종탑의 도시) 일반 몹 2종과 손 소켓 prop 2종. Tripo 생성 2026-10-29(원본 브랜치 `claude/tripo-ch7-belltower`, 머지 대상 아님 — `asset-library/incoming/tll_ch7` 만 가져옴, Git 제외). 수집·연결 2026-10-29. 이번 작업에서 Tripo 재생성·크레딧 사용 없음. 이미 있던 7장 Tripo 몸(종지기 `tll_ch7_bellringer`, 오르벤·카델)은 그대로 둔다.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch7_citizen` | 해골 시민 `ch7_citizen` 외 4갈래 | 1.6 | 10,663 / 12,000 | 2,084,020 | soldier | `bone_knight` | 중절모·황동 단추 조끼·목수건, 금빛 눈 |
| `tll_ch7_tuner` | 굽쇠 주술사 `ch7_tuner` 외 3갈래 | 1.6 | 10,770 / 12,000 | 2,300,968 | caster | `skeleton_mage` | 석회빛 두건 법복, 어깨·허리의 금 간 작은 종 |
| `tll_ch7_ledger` | 타종 명부(prop) | 0.4 | 3,640 / 4,000 | 465,832 | — | — | 황동 모서리 두꺼운 명부 |
| `tll_ch7_tuningfork` | 황동 굽쇠 지팡이(prop) | 1.5 | 3,486 / 4,000 | 513,208 | — | — | 원본이 이미 세로라 세우기 없음 |

- 텍스처 1k(WebP), 재질 1개. 두 몸 모두 Tripo 가 1K 로 내보내 `--texLimit` 은 쓰지 않았다. `bun run assets:verify` 통과(93개).
- 뼈: `rigged.fbx` 는 Mixamo 65관절, `rigged.glb` 는 끝 관절을 뺀 53본(시민)·52본(주술사). 끝 관절은 가중치 없는 잎 뼈라 GLB 그대로 썼다(5·6장 문서와 같은 판단).
- 클립 키: `bone_knight` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `skeleton_mage` 기증 = attackJump 대신 raise, summon(14). `impacts` 는 기증자 값 그대로.
- 이식 보고: 시민 hipsRatio 0.459(53/53 본), 주술사 0.478(52/52 본).

## 출처(provenance)

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch7_citizen` | `b80b12cf-6dc4-4c95-82e9-f5738b3984f4` | `73244f5257d3330468e8bc07729e405e6d0db854bf082501a7a709543a9c903e` |
| `tll_ch7_tuner` | `558a9835-78a4-4062-a6f9-71f25e7f585b` | `5eb7f63cdce17439020944ddccaa12b53587135446931a714e3d1a69f05e0e48` |
| `tll_ch7_ledger` | `289826cc-8baf-440b-bc59-b217c4949939` | `04e3488c6f6c7e7abf3d07c7706539ec92049791cc3c381b07fdeb3b6d933efe` |
| `tll_ch7_tuningfork` | `36892984-dbc7-4976-b939-2cecaf982847` | `c95f514161dea29536525a41e44b31b9a525eedb845a04a2c45f499167a67695` |

`rawSha256` 은 캐릭터 `rigged.glb`·prop 원본 GLB 기준(원본 `SHA256SUMS` 와 대조해 모두 OK). Tripo HD 원본(raw.glb)은 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/ch7/<키>/raw.glb`. 크레딧 기록(몸 95씩 + 소품 75씩)은 원본 `tasks.json`(Git 제외). 원화는 GPT Image 2.5 무료 한도. 라이선스 `owner-generated (Tripo subscription)`.

## 처리 순서

5장 문서(`docs/asset-library/ch5-tripo.md`)와 같은 명령이다(시민 `bone_knight --profile soldier`, 주술사 `skeleton_mage --profile caster`, 두 prop 은 세우기 없이 prop 수집). 수집 뒤 manifest 에 `provenance.rawArchive` 를 적었다.

## 게임 연결

- `src/data/stages.js` `CHAPTER_SPECIES[7]`: 7장 **전투 방 편성(combatRosterFor)** 과 소환·정예 접두사·관문 지원병(`chapterSpeciesId`)에서만 바꾼다. 새 적 id 는 원래 적 정의 하나를 그대로 복사하고 이름·모델만 다르다(해골 사제 갈래만 색조를 뺌). 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 90일 경제 밴드가 움직이지 않는다. 원정·무한의 성·다른 장(1~6장)·7장 확장 던전 보스(감시자·타종 관리인·종 수호자)는 바뀌지 않는다.

| 원래 적 | 새 id | 이름 | 모델(몸) | 구분 |
|---|---|---|---|---|
| `skel_minion` | `ch7_citizen` | 해골 시민 | `Ch7_Citizen` | 왼손에 타종 명부(안음), 관문·보스 지원병 |
| `skel_rogue` | `ch7_citizen_late` | 늦은 해골 시민 | `Ch7_CitizenBare` | 맨손, 먼지 낀 석회 몸빛 |
| `skel_shield` | `ch7_citizen_ledger` | 명부 방패 시민 | `Ch7_CitizenLedger` | 명부를 앞에 방패로(shield 행동) |
| `bone_orc` | `ch7_citizen_hauler` | 종루 짐꾼 시민 | `Ch7_CitizenHauler` | 조금 큰 키, 그을린 청동 몸빛, 등에 종추(clapperBack) |
| `bomb_slime` | `ch7_citizen_fuse` | 폭음 시민 | `Ch7_CitizenFuse` | 그을린 황동 몸빛·붉은 금 발광(자폭 경고) |
| `skel_mage` | `ch7_tuner` | 굽쇠 주술사 | `Ch7_Tuner` | 오른손 굽쇠 지팡이 |
| `skel_priest` | `ch7_tuner_cantor` | 명부 낭송 주술사 | `Ch7_TunerLedger` | 지팡이 대신 왼손 명부, 원본 연두 색조 제거 |
| `ghost_skull` | `ch7_tuner_echo` | 울림 잔향 주술사 | `Ch7_TunerEcho` | 맨손, 옅은 석회빛, 불투명(`ghostly` 제거) |
| `ghost` | `ch7_tuner_drift` | 떠도는 조율사 | `Ch7_TunerDrift` | 맨손, 옅은 회녹빛, 불투명(`ghostly` 제거) |

- **선택: 원령도 주술사 갈래로 바꿨다.** 원령은 7-1 일반 방의 31%라 소수로 남기면 85% 목표를 넘지 못한다. 대신 원래 7장 의상에 이미 쓰던 부패 슬라임(경로 6~10에서 약 12%)과 정예 3종(해골 대장·망령 기사·뼈 군주)을 옛 몸으로 남겨 두 몸만 반복되는 단조로움을 줄였다. 종지기는 이미 7장 전용 Tripo 몸이라 그대로다.
- 일반 방 새 몸 비율(`composeRoom(R, st, room, s.idx, 16)` 10방×16, 종지기 포함): 7-1~7-5 100%, 7-6 88%, 7-7 88%(87.5), 7-8~7-10 88%. `test/chapter-dress.test.ts` 가 85% 이상과 보상 명단 불변을 검사한다.
- 관문·보스 지원병(belltower_* summon `skel_minion`)은 `ch7_citizen`(지원병 루프에 `['belltower', 7]`). 해골 사제 갈래의 지원 소환(`skel_minion`)은 런타임 `chapterSpeciesId` 로 해골 시민이 된다. 확장 던전 보스 3종은 정의를 바꾸지 않았다.
- `src/game/region-traits.js`: 정규식 `SKELETAL` 은 바꾸지 않았다. 기반 브랜치의 `isSkeletalSpecies(model, speciesId)` 가 원본 종이 해골일 때만 다른 장 Tripo 몸을 부활시키므로 `망각의 잔향`은 교체 전과 같은 자리(해골 병사·자객·방패병·뼈 오크·주술사·사제·해골 망령)에서 그대로 켜지고, 원령·폭탄 슬라임 자리(몸은 해골이어도)는 교체 전처럼 부활하지 않는다(`test/region-traits.test.ts`). 7장 종 동사(REGION_SPECIES_VERBS)는 없고, 종지기 `bellringer` 행동은 그대로다.
- `src/data/monster-roster.js`: `Ch7_Citizen`·`Ch7_CitizenBare`·`Ch7_CitizenLedger`·`Ch7_CitizenHauler`·`Ch7_CitizenFuse`·`Ch7_Tuner`·`Ch7_TunerLedger`·`Ch7_TunerEcho`·`Ch7_TunerDrift`. 손 소켓: 안은 명부 grip `[0, 0.2, 0]` rot `[0, 0, 180]`, 명부 방패 grip `[0, 0.1, 0.05]` rot `[90, 0, 0]`, 굽쇠 지팡이 grip `[0, 0.55, 0]` rot `[160, 0, 0]`(갈래가 위, 종 모양 끝이 바닥).
- `src/data/chapter-dress.js` 7장: 몸이 이미 바랜 황동(#e0c68c)·석회 회색이라 `BRASS_*` 재배치를 걸지 않고 발광·몸빛만 준다. 손 소품·몸의 종과 겹치는 `bellLedger`·`tuningFork`·`spiritBell` 소품은 뺐다(테스트로 검사).
- 도감(`src/data/lore.js`): 9종 모두 7장 전투 편성에 나오므로 추가(소환 전용 id 없음).
- 보이는 키(영웅 1.8 m 대비, heightM × scale × def.scale × visualScale): 시민 1.67 m(0.93), 명부 방패 1.68 m(0.93), 짐꾼 1.79 m(0.99), 폭음 시민 1.56 m(0.87), 주술사·낭송 1.68 m(0.93), 울림 잔향 1.69 m(0.94), 떠도는 조율사 1.70 m(0.94).
- 근접 확인: `node tools/dress-closeup.mjs 7 work/qa/ch7 after`(줄 4~6).

## 함께 고친 것

- `src/engine/readability-view.js`(#394 전투 가독성 추적선): fragmentShader 한 줄의 `//` 주석이 `float dash` 선언을 삼켜 컴파일이 실패하고 모든 출격이 "던전을 준비하지 못했습니다"로 끝났다(근접 캡처가 6·7장 모두 실패해 찾음). 주석을 따로 줄로 뺐다. main 에도 같은 결함이 있다.

## 남은 것

- swiftshader 캡처 기준이며 실기기 GPU 화면·밀집 전투 가독성은 확인하지 않았다.
- 늦은 시민·종루 짐꾼·폭음 시민은 같은 맨손 몸이라 정면 대기 자세에서 몸빛·등 종추·발광으로만 구분된다. 울림 잔향 주술사와 떠도는 조율사도 몸빛 차이만 있다.
- 근접 캡처 줄은 이웃 개체가 화면 앞을 가리는 구도가 있어 개체별 정면 캡처로 판정했다.
