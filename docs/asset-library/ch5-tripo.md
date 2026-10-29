# 5장 Tripo 몬스터 몸 (tll_ch5_*)

5장(새벽을 먹는 왕관) 4종과 손 소켓 prop 3종. Tripo 생성 2026-10-29(원본 브랜치 `claude/tripo-ch5-crown`, 머지 대상 아님 — `asset-library/incoming/tll_ch5` 만 가져옴, Git 제외). 수집·연결 2026-10-29. 이번 작업에서 Tripo 재생성·크레딧 사용 없음.

## 요약

| 키 | 역할(게임) | heightM | 삼각형 / 예산 | 크기(B) | 프로필 | 클립 기증자 | 비고 |
|---|---|---|---|---|---|---|---|
| `tll_ch5_dawnninja` | 새벽 가면 닌자 `ch5_dawnninja` 외 2갈래 | 1.6 | 10,685 / 12,000 | 1,882,912 | soldier | `shadow_soldier` | 금빛 해 가면·보라 두건·긴 목도리 |
| `tll_ch5_crownsoldier` | 왕관 병사 `ch5_crownsoldier` 외 2갈래 | 1.7 | 10,638 / 12,000 | 2,038,352 | soldier | `bone_knight` | 둥근 투구 위 작은 금관, 보라 망토 |
| `tll_ch5_seer` | 왕관 고리 주술사 `ch5_seer` 외 2갈래 | 1.6 | 10,575 / 12,000 | 2,250,732 | caster | `skeleton_mage` | 머리 위 금빛 고리(몸의 일부), 두 다리로 서서 hover 없음 |
| `tll_ch5_astel` | 첫 기사 아스텔 `crown_midboss` | 2.4 | 10,519 / 20,000 | 2,110,824 | soldier, boss | `bone_knight` | 큰 투구에 왕관, 찢긴 왕실 깃발 망토 |
| `tll_ch5_dawnblade` | 새벽 단검(prop) | 0.7 | 3,700 / 4,000 | 528,700 | — | — | 주축 세움(31.5°) |
| `tll_ch5_swordwall` | 성벽 검 방패(prop) | 0.9 | 3,699 / 4,000 | 551,844 | — | — | |
| `tll_ch5_oathsword` | 맹세 대검(prop) | 1.6 | 3,563 / 4,000 | 576,584 | — | — | 주축 세움(31.1°) |

- 텍스처 1k(WebP), 재질 1개. 아스텔은 Tripo 가 2K 로 내보내 보스 상한(2048)이 그대로 남아 `ingest.mjs --texLimit 1024`(이번에 추가한 선택값, `blender_normalize.py --texLimit`)로 이전 장과 같은 1K 로 줄였다. `bun run assets:verify` 통과(89개).
- 뼈: Tripo `rigged.fbx` 는 Mixamo 65관절이지만 이번 `rigged.glb` 내보내기는 끝 관절(`*_End`, 손가락 4번)을 빼 52본(닌자 53본)이다. 끝 관절은 가중치가 없는 잎 뼈라 클립 이식(52/52 본 매핑)·런타임 소품 소켓(Head·Spine·Hand)·verify 어디에도 쓰이지 않아 GLB 그대로 썼다(FBX→GLB 변환 경로는 쓰지 않음).
- 클립 키: `bone_knight`·`shadow_soldier` 기증 = idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, hit, hitHeavy, death, roar(13). `skeleton_mage` 기증 = attackJump 대신 raise, summon(14). `impacts` 는 기증자 manifest 값 그대로(`ingest.mjs --impactsFrom`).
- 닌자는 빠른 병사 클립(`shadow_soldier`, 그림자 닌자·해골 자객이 쓰던 몸)을 썼다. `shadow_soldier` 는 손가락 뼈가 없어 몸통·팔다리 23본만 옮겨지고 손가락은 쉬는 자세로 남는다.
- 이식 보고: 닌자 hipsRatio 0.557(23/53 본, 손가락 제외), 병사 0.391(52/52), 주술사 0.413(52/52), 아스텔 0.480(52/52).

## 출처(provenance)

manifest 각 항목 `provenance.taskId` 는 원본 `tasks.json` 의 `workspace_task_id`, `prompt` 는 파이프라인 머리말 + 원화(T자세/소품) 프롬프트 전문, `rawSha256` 은 Tripo 원본 파일(캐릭터 `rigged.glb`, prop 원본 GLB — 세우기 전)의 sha256(`--rawSource`).

| 키 | taskId | rawSha256 |
|---|---|---|
| `tll_ch5_dawnninja` | `678edb47-cc3f-4935-b309-f3b46452bb25` | `d55f12ae2e458997579b217bc2ea3b36d355d3210ed2e628a34c6eef690c6472` |
| `tll_ch5_crownsoldier` | `c91afd5b-6e3d-4946-9986-5164a46571de` | `c28ed049881136feeaa5d9fb8abf0790cfc925a537de03b5a40ccf972e8be1f5` |
| `tll_ch5_seer` | `52df39e2-3a8b-431d-81f1-b1aa103ae537` | `b65c2c3930b857a3f7c1900e85b0bd2484f937987d2717825dabf5eb628ef2b4` |
| `tll_ch5_astel` | `7bf0c202-058b-43e6-8f5f-79526767bff1` | `97213a8814edc004737c05583f88dbe43e8d72511febccf144850be2dda181dd` |
| `tll_ch5_dawnblade` | `10c73594-208d-4f5b-ba1b-f82376dc2b2a` | `34ad2620030aac0ff84d978d71a2003c513068137c08c9e3607c2d86e4010965` |
| `tll_ch5_swordwall` | `af5c734a-3ee0-4cfd-aafe-ea176d872e6e` | `f278c401b73c6007c9dc4a39d6bfb7b27a429ae968c5dc1c2024b12db2544139` |
| `tll_ch5_oathsword` | `a62f34fb-032f-4370-bf74-a46e87ad3d74` | `65aee50adb499ef5e192598d40c9cacc84b51efe0c6716bd84ef5c652d063f82` |

Tripo HD 원본(리토폴 전 raw.glb)은 manifest `provenance.rawArchive`: R2 `blade-surge-handoff/tripo-originals/ch5/<키>/raw.glb`(7개 모두). 크레딧 기록(몸 95씩 + 소품 75씩)은 원본 `tasks.json`(raw, Git 제외)에 있다. 원화는 GPT Image 2.5 무료 한도(구독 크레딧 0). 라이선스 `owner-generated (Tripo subscription)`, 무료 에셋 없음.

## 처리 순서 (재현 명령)

Blender 5.2.3 LTS 리눅스판(`/opt/blender`, 1~4장 문서와 같은 설치)을 썼다.

1. `asset-library/incoming/tll_ch5/<몸>/` 를 `asset-library/raw/tll_ch5_<몸>/`(Git 제외)에 복사하고 `SHA256SUMS` 대조(모두 OK).
2. 클립 이식(다리 고정 없음):
   ```bash
   /opt/blender/blender -b --python-exit-code 1 --python tools/asset-library/blender_retarget_clips.py -- \
     --target asset-library/raw/<키>/rigged.glb --donor asset-library/normalized/<기증자>.glb \
     --output work/tmp/retarget/<키>.glb --report work/tmp/retarget/<키>.json
   ```
3. 새벽 단검·맹세 대검은 `tools/asset-library/blender_prop_upright.py` 로 주축을 세로로 세운 뒤 수집. 성벽 검 방패는 그대로.
4. 수집:
   ```bash
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <키> --input work/tmp/retarget/<키>.glb \
     --rawSource asset-library/raw/<키>/rigged.glb --height <m> --map '<13~14키 동일 매핑>' --taskId <id> --prompt '<…>' \
     --profile <soldier|caster> --impactsFrom <기증자> [--boss true --texLimit 1024]
   BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --id <prop> --input <prop.glb> --kind prop --height <m> --rawSource <원본> --taskId <id> --prompt '<…>'
   ```
   수집 뒤 manifest 에 `provenance.rawArchive` 를 적었다.

## 게임 연결

- `src/data/stages.js` `CHAPTER_SPECIES[5]`: 5장 **전투 방 편성(combatRosterFor)** 과 소환·정예 접두사·관문 지원병(`chapterSpeciesId`)에서만 바꾼다. 새 적 id 는 원래 적 정의 하나를 그대로 복사하고 이름·모델만 다르다(색조만 일부 뺌). 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 90일 경제 밴드가 움직이지 않는다. 원정·다른 장·확장 던전은 바뀌지 않는다. 왕관 일반 방에 나오는 9종을 모두 바꾸고 정예(푸른 악마·새끼 용·해골 대장)만 옛 몸으로 남긴다.

| 원래 적 | 새 id | 이름 | 모델(몸) | 구분 |
|---|---|---|---|---|
| `ninja` | `ch5_dawnninja` | 새벽 가면 닌자 | `Ch5_DawnNinja` | 오른손 새벽 단검, 지역 동사 `그림자 걸음` 유지 |
| `imp` | `ch5_dawnninja_squire` | 새벽 견습 닌자 | `Ch5_DawnNinjaBare` | 맨손, 바랜 보라 몸빛 |
| `bomb_abyss` | `ch5_dawnninja_flare` | 봉화 닌자 | `Ch5_DawnNinjaBare` | 붉은 금 발광(자폭 경고), 원본 분홍 색조 제거 |
| `alien` | `ch5_crownsoldier` | 왕관 병사 | `Ch5_CrownSoldier` | 맨몸, 돌격 역할 유지 |
| `bone_orc` | `ch5_crownsoldier_chain` | 금사슬 왕관 병사 | `Ch5_CrownSoldier` | 어두운 강철 몸빛, 분쇄 역할 유지 |
| `skel_shield` | `ch5_swordwall` | 성벽 검 방패병 | `Ch5_SwordWall` | 왼손 성벽 검 방패(shield 행동) |
| `abyss_seer` | `ch5_seer` | 왕관 고리 주술사 | `Ch5_Seer` | 맨몸, 원본 연보라 색조 제거 |
| `hywirl` | `ch5_seer_ember` | 새벽불 주술사 | `Ch5_Seer` | 따뜻한 몸빛·금빛 발광 |
| `tribal_shaman` | `ch5_seer_herald` | 칙령 낭독 주술사 | `Ch5_Seer` | 등에 맹세 깃발(oathBanner), 원본 살구 색조 제거 |

- 일반 방 새 몸 비율(`composeRoom(R, st, room, s.idx, 16)` 10방×16): 5-1~5-10 모두 100%. `test/chapter-dress.test.ts` 가 85% 이상을 검사한다.
- 5장 관문·보스가 부르는 지원병(summon `ninja`)은 `ch5_dawnninja` 로 바꿨다(지원병 루프에 `['crown', 5]` 추가). 주술사 갈래가 복사한 원본 지원 소환(`orc_blob`·`squidle`)은 수치 보존을 위해 그대로 두었다.
- `src/data/encounter-models.js` `CAMPAIGN_MODELS`: `crown_midboss → Ch5_Astel`. 관문 대장·수문장·최종 보스(빈 왕관)는 그대로.
- `src/data/monster-roster.js`: `Ch5_DawnNinja`·`Ch5_DawnNinjaBare`·`Ch5_CrownSoldier`·`Ch5_SwordWall`·`Ch5_Seer`·`Ch5_Astel`. 손 소켓 rot: 새벽 단검 `[90, 0, 0]`(날이 앞), 성벽 검 방패 `[0, 0, 0]`(검 면이 앞), 맹세 대검 `[0, 0, 90]`(세렌 철퇴와 같은 bone_knight 손 축 — 처음 `[90, 0, 0]` 은 날이 몸을 관통해 바꿨다).
- `src/data/chapter-dress.js`: 몸이 이미 새벽 보라·금이라 `CROWN_*` 재배치·색조를 걸지 않고 발광·몸빛만 준다. 몸에 있는 해 가면·금관 투구·떠 있는 금빛 고리와 겹치는 소품(`dawnMask`·`soldierCirclet`·`crownRing`)은 뺐다. 금사슬 병사의 `goldChains` 소품은 병사 몸에서 머리 위로 떠 보여 뺐다. 아스텔은 왕관·깃발 망토·대검이 몸·손에 있어 뿔 왕관·성벽 검 방패·맹세 깃발 소품을 뺐다.
- `src/game/region-traits.js`: 왕관 지역 동사 `그림자 걸음`(blink)은 원래 적 id `ninja` 에 묶여 있어 `regionSpeciesVerb` 가 `speciesSourceId` 로 찾아 새벽 가면 닌자에 그대로 붙는다(같은 닌자 몸이지만 원본이 임프·심연 폭탄인 갈래에는 붙지 않는다, `test/region-traits.test.ts`). 칙령 기수(decree)는 분대 역할 기준이라 모델과 무관하다. `MOB_ROLE_ENEMIES`(돌격·측면 침투·분쇄)는 정의 복사 전에 붙어 갈래가 그대로 이어받는다.
- 도감(`src/data/lore.js`): 5장 전투 편성에 나오는 9종 모두 추가.
- 보이는 키(영웅 1.8 m 대비, heightM × scale × def.scale): 닌자 1.68 m(0.93), 왕관 병사 1.70 m(0.94)·방패병 1.73 m(0.96), 주술사 1.60~1.68 m(0.89~0.93), 아스텔 3.42 m(1.90).
- 근접 확인: `node tools/dress-closeup.mjs 5 work/qa/ch5 after`(줄 5~7).

## 남은 것

- swiftshader 캡처 기준이며 실기기 GPU 화면·밀집 전투 가독성은 확인하지 않았다.
- 새벽불 주술사·견습 닌자는 원본 몸과 몸빛 차이만 있어 정면 대기 자세에서 구분이 약하다(칙령 낭독 주술사는 깃발로 구분됨).
- 주술사 갈래의 지원 소환은 원본 그대로 꼬마 오크·부유 촉수가 나온다(수치 보존).
