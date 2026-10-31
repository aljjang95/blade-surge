# 1·2장 Tripo 몬스터 몸 (tll_ch1_* · tll_ch2_*)

1장(잊힌 종의 정원) 3종, 2장(불씨 왕국의 용광로) 3종, 손 소켓 무기 prop 6종. Tripo 생성 2026-10-28(원본 브랜치 `claude/tripo-ch1-garden` e445d8ef, `claude/tripo-ch2-forge` 146c81eb, 머지 대상 아님). 수집·연결 2026-10-28. 이번 작업에서 Tripo 재생성·크레딧 사용 없음.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch1_coffinbearer` | 관꾼 해골 `ch1_coffinbearer` | 1.6 | 10,946 / 12,000 | 2,264,280 | soldier | `bone_knight` | 관을 등에 멘 몸 |
| `tll_ch1_mourner` | 곡하는 원령 `ch1_mourner` | 1.7 | 10,646 / 12,000 | 1,974,080 | caster, hover 0.25 | `skeleton_mage` | 다리 본 고정, 후드 십자 장식 텍스처 제거 |
| `tll_ch1_tombknight` | 애도의 기사 세렌 `garden_midboss` | 2.0 | 10,835 / 20,000 | 2,180,392 | soldier, boss | `bone_knight` | 오른손 철퇴·왼손 묘비 방패 |
| `tll_ch2_smith` | 앞치마 오크 장인 `ch2_smith` | 1.7 | 10,256 / 12,000 | 2,087,672 | brute | `goblin_brute` | |
| `tll_ch2_emberimp` | 불씨 임프 `ch2_emberimp` | 1.0 | 10,497 / 12,000 | 2,105,560 | caster | `skeleton_mage` | 원거리 주술(tribal_shaman 자리) |
| `tll_ch2_igran` | 대장장이 이그란 `forge_midboss` | 2.4 | 11,220 / 20,000 | 2,229,812 | brute, boss | `goblin_brute` | |
| `tll_ch1_handbell` | 원령 손종(prop) | 0.4 | 3,727 / 4,000 | 433,568 | — | — | |
| `tll_ch1_tombshield` | 세렌 묘비 방패(prop) | 0.85 | 3,700 / 4,000 | 484,868 | — | — | |
| `tll_ch1_clapper` | 세렌 종추 철퇴(prop) | 0.85 | 3,880 / 4,000 | 513,312 | — | — | Tripo 4,002 → 3,880 데시메이트 판(e445d8ef), 주축 세움 |
| `tll_ch2_hammer` | 장인 대장 망치(prop) | 0.6 | 3,915 / 4,000 | 418,024 | — | — | 주축 세움(25.1°) |
| `tll_ch2_lantern` | 임프 질그릇 등잔(prop) | 0.3 | 3,643 / 4,000 | 356,796 | — | — | 재질 Clay + Glow(emissiveTexture, 런타임 발광 유지) |
| `tll_ch2_anvil_hammer` | 이그란 모루 철퇴(prop) | 1.1 | 3,957 / 4,000 | 566,264 | — | — | |

- 텍스처 1k, 재질 1개, 뼈 65(Tripo Mixamo 규격). `bun run assets:verify` 통과(68개).
- 클립 키: `bone_knight`·`goblin_brute` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `skeleton_mage` 기증 = attackJump 대신 raise, summon(14). `impacts` 는 기증자 manifest 값 그대로(`ingest.mjs --impactsFrom`).

## 출처(provenance)

manifest 각 항목 `provenance.taskId` 는 원본 `tasks.json` 의 `workspace_task_id`, `prompt` 는 파이프라인 머리말 + 원화(T자세) 프롬프트 전문, `rawSha256` 은 Tripo 원본 파일(캐릭터 `rigged.glb`, prop 원본 GLB)의 sha256(`--rawSource`).

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch1_coffinbearer` | `e4af41a7-9f77-4f23-904a-31718383e247` | `ddfdad5e3e86d0652c2a72011f4a4a35c083f5002548fc8d0ffb2e8126abb56a` |
| `tll_ch1_mourner` | `a0a1c871-65ef-4cc3-8bd2-5d5bb6b0db15` | `d514c01ce51439cd66c08a7203ed6f6d536b597ef6502960b17d458aba29a646` |
| `tll_ch1_tombknight` | `cf83e15d-42b8-4ef8-9be0-973bbaf7e5cd` | `108df554705f7d02cb7b60208d53e4e606689ff98f0c2039ac843837117c7cd7` |
| `tll_ch2_smith` | `291b2212-dddb-4f7c-a9b7-8f976d556b09` | `97fcc32574b7aeae784dc306ee11f09f556afe8a17337fb06dd9304b9b4aa603` |
| `tll_ch2_emberimp` | `9e1dd8ff-ab28-469e-8084-bf9ffaeb1f30` | `4a783aee7302567d969aed9f46158327e778e2b7554f32d98b32a92a8db7c088` |
| `tll_ch2_igran` | `0055790a-774c-4447-a13e-f4e7d0c97b22` | `c044bbf04808da1318800782d85703db55e9499462b232de9d5ab78dd4b038ac` |
| `tll_ch1_handbell` | `6bd0d095-22de-42df-b204-18c35192261f` | `5001169082d8a1ed8b1684bdc47b065998241cf82b2f04cf358d7ac870d46ab3` |
| `tll_ch1_tombshield` | `e2fe9b3f-cd0d-4b72-ad25-6e11b6011b29` | `40ca99d53433796fc1b8d69e1c7796679c19a64949c848fbb7eaa9a94120c16e` |
| `tll_ch1_clapper` | `048d50f5-3ef1-4856-9774-248e136cea17` | `6fb18809942ba71b447dce0232ab38eb8f6b60f3ca68ec55f15c4722adb8495d` (3,880 판) |
| `tll_ch2_hammer` | `13196785-642c-48df-a7ff-87c39f00ca1f` | `d68b40bbe31375c3a7594c8c84dcae6edba685bfc8b91268ba4bc8ba2f567097` |
| `tll_ch2_lantern` | `bfe84f52-4c00-461e-8a6d-995ac07108ac` | `5d149f9e4361f379ccc3b2568ca2cb6b6486c09c8bdf802dfb4091bca2b08036` |
| `tll_ch2_anvil_hammer` | `c0535636-7073-4e85-bd53-815275c9d912` | `59ef1436c582adf1e8a75e4da0e8118b8334e857464df88407b7caf6205ff34b` |

Tripo HD 원본(리토폴 전 raw.glb) 보관 위치는 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/{ch1,ch2}/<키>/raw.glb`(지휘 세션 안내 기준). **`tll_ch2_smith` 만 HD 원본 복구 불가**(체인 실행 뒤 내보내 리깅 모델만 받음, tasks.json 기록). 철퇴는 4,002 원판이 보관되지 않았다. 크레딧 기록은 원본 `tasks.json`(raw, Git 제외)에 있다. 라이선스 `owner-generated (Tripo subscription)`, 무료 에셋 없음.

## 처리 순서 (재현 명령)

Blender 5.2.3 LTS 리눅스판(공식 `download.blender.org/release/Blender5.2/blender-5.2.3-linux-x64.tar.xz`, sha256 `78486c018b4443efe5e75ab54c290ed8c15abafd249b862c2c9ce2530a918eec` 대조)을 `/opt/blender-5.2.3-linux-x64`(링크 `/opt/blender`)에 설치했다. 워크벤치 렌더에는 `libegl1 libgl1-mesa-dri` 가 필요하다.

1. 원본을 `asset-library/raw/<키>/`(Git 제외)에 복사하고 `SHA256SUMS` 대조.
2. 클립 이식 `tools/asset-library/blender_retarget_clips.py`:
   ```bash
   /opt/blender/blender -b --python-exit-code 1 --python tools/asset-library/blender_retarget_clips.py -- \
     --target asset-library/raw/<키>/rigged.glb --donor asset-library/normalized/<기증자>.glb \
     --output work/tmp/retarget/<키>.glb --report work/tmp/retarget/<키>.json
   # 원령만: --freeze 'UpLeg|Leg$|Foot|Toe' --erase '{"box":[-0.05,-0.3,0.80,0.05,0.0,0.98],"ref":[0.07,-0.3,0.80,0.14,0.0,0.92]}'
   ```
   같은 이름 본끼리 매 프레임 월드 회전 변화량을 옮기고, 본 방향을 기증자 휴식 방향으로 돌리는 정렬 회전으로 T자세 팔을 기증자 A자세에 맞춘다(7장 선례의 팔 T→A 보정과 같은 결과). 엉덩이 이동은 엉덩이 높이 비율(0.34~0.46)로 줄인다. 점검 스틸은 `tools/asset-library/blender_pose_sheet_clips.py`.
3. 철퇴(43.5°)·대장 망치(25.1°)는 `tools/asset-library/blender_prop_upright.py` 로 주축을 세로로 세운 뒤 수집.
4. 수집:
   ```bash
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <키> --input work/tmp/retarget/<키>.glb \
     --rawSource asset-library/raw/<키>/rigged.glb --height <m> --map '<13~14키 동일 매핑>' --taskId <id> --prompt '<…>' \
     --profile <soldier|caster|brute> --impactsFrom <기증자> [--hover 0.25] [--boss true]
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <prop> --input <prop.glb> --kind prop --height <m> --rawSource <원본> --taskId <id> --prompt '<…>'
   ```

## 세계관 수정

- 곡하는 원령 후드 꼭대기 앞쪽의 십자 장식: 상자 안 앞면 210개 면의 UV 영역(15,181 px)을 옆 후드 천의 중앙값 색으로 덮었다. 장식의 입체 돋을새김(형상)은 남아 있어 근접 시 어두운 천 주름처럼 보인다(지오메트리는 고치지 않았다).
- 애도의 기사 투구의 청록 이음새(세로·가로 틈)는 투구 바이저 홈이라 그대로 두었다.

## 게임 연결

- `src/data/stages.js` `CHAPTER_SPECIES`: 1·2장 **전투 방 편성(combatRosterFor)** 에서만 `skel_minion→ch1_coffinbearer`, `ghost→ch1_mourner`, `orc→ch2_smith`, `tribal_shaman→ch2_emberimp` 로 바꾼다. 새 적 id 는 원래 적 정의를 그대로 복사하고 이름·모델만 다르다. 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 90일 경제 밴드가 움직이지 않는다. 6장(귀환로, 같은 garden 테마)과 3·4·5·7장은 바뀌지 않는다.
- 1·2장 관문·보스가 부르는 지원병(summon)도 전용 몸 id 로 바꿨다(garden_* → ch1_coffinbearer, forge_* → ch2_smith).
- `src/data/encounter-models.js` `CAMPAIGN_MODELS`: `garden_midboss → Ch1_TombKnight`, `forge_midboss → Ch2_Igran`.
- `src/data/monster-roster.js`: `Ch1_CoffinBearer`·`Ch1_Mourner`·`Ch1_TombKnight`·`Ch2_Smith`·`Ch2_EmberImp`·`Ch2_Igran`. 무기는 `weapon`(오른손) 외에 `offhand`(왼손) 항목을 새로 받는다(`src/game/enemies.js`, `src/ui/enemy-preview.js`). 손 소켓: 원령 손종, 세렌 철퇴(오른손)·묘비 방패(왼손), 장인 대장 망치, 임프 등잔, 이그란 모루 철퇴. rot 은 후보 4개를 같은 장면에 세워 찍어 골랐다.
- `src/data/chapter-dress.js`: 새 종은 원래 종의 색 그대로, 몸에 이미 있거나 손에 든 실루엣(관·두건·조종·앞치마·등 망치·머리 불꽃·등잔·베일·묘비 방패·칼 다발)과 겹치는 소품만 뺐다.
- 보이는 키(영웅 1.8 m 대비, 크기 띠 적용 후): 관꾼 1.60 m(0.89), 원령 1.70 m(0.94, +hover), 세렌 3.31 m(1.84), 장인 1.70 m(0.94), 임프 1.20 m(0.67), 이그란 3.51 m(1.95).
