# 몬스터·던전 정체성 감사 (현황 "before")

2026-10-28 몬스터 정체성 레인. 캡처는 swiftshader 소프트웨어 렌더라 **색·GPU 성능 판단 근거가 아니다**(몸·구성·환경 키가 무엇인지 보는 용도). 증거 이미지: `work/qa/identity/before-ch{N}-{관문}.png` 28장과 `before-report.json`(커밋 안 함). 캡처 대상은 1~7장 각 X-1 / X-3 / X-5 / X-10. 의상 작업(`chapter-dress`) 적용 전 상태이며, 표의 값은 report json과 코드에서 읽은 것만 쓴다. 보고서 asset 열은 `def.model`이 `monster-roster.js`를 거쳐 정해진 라이브러리 ID다.

## 1. 요약

1. 캠페인 1~7장이 쓰는 몸은 **라이브러리 16종 + 7장 Tripo 3종 = 19종**이다(코드 계산: 관문 로스터·보스·던전 보스 변종 93개 정의가 이 19개 몸으로 모인다. 전체 `ENEMIES`는 180개 정의). 1장 해골 `bone_knight` 하나가 1·3·4·5·6·7장 관문에 나온다.
2. 장 전용 몸은 **7장 Tripo 3종뿐**(`tll_ch7_bellringer`, `tll_ch7_midboss`, `tll_ch7_finalboss`). 캡처 4관문에서는 보스 둘(7-5 오르벤, 7-10 카델)만 확인됐고 종지기는 화면에 없었다. 7장 일반 몹은 1장 해골·원령 그대로다.
3. 장 사이 차이는 대부분 **tint와 scale**이다. 라이브러리 몸의 tint는 재질색과 32% lerp(`actor.js:71`)라 약하다. 보스 scale은 5관문 1.95, 10관문 2.25로 전 장 같고, 보스 tint는 장 대표색 한 가지다.
4. 환경(하늘·안개·조명)은 **장이 아니라 던전 경로 단위**다(`arena.js:375`에서 경로 키 `DUNGEON_ATMOSPHERES`가 장 테마 `THEMES`를 덮어씀). 한 장 안에서도 경로가 섞여 1-3·2-3·3-3·5-x는 `tribunal`(분홍보라 안개 `#875577`)이 된다.
5. 바닥 타일은 장·경로와 무관한 같은 킷이다(`dungeon-surface.js`, 레이아웃이 있는 던전은 전부 `floor_tile_large`). 벽은 장 입력 없이 레이아웃에서 만든다(`dungeon-walls.js`). 차이는 하늘·안개·조명 색, 장 테마별 지역 건축, BGM에만 있다.

판정 표기: ♻ 같은 몸 재사용 / 🎨 몸은 같고 tint·scale만 다름 / ⚠ 세계관 불일치(`docs/WORLD_BIBLE.md` 2장 "지역 정체성 체크리스트"와 대조).

## 2. 장별 표 (X-1 / X-3 / X-5 / X-10 실화면 기준)

적 칸은 `이름 → asset (tint, scale)` 형식이다. tint 없음은 생략하고 scale이 1이면 생략한다. 보스는 굵게 쓴다. 안개색은 report의 `fog.color`, 밀도는 전 관문 0.026이다.

### 1장 잊힌 종의 정원 (체크리스트: 청록·묘비 회색 / 관을 멘 해골, 떠도는 원령)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 1-1 | procession → memorial | `#5c7d73` | 해골 병사·해골 방패병 → bone_knight (0.95 / 1.05), 원령·해골 망령 → void_wisp (1.25 / 1.2), 대원령(정예) → void_wisp (#a0d0ff, 1.7) | ♻ 병사·방패병이 같은 몸. ⚠ void_wisp가 PNG에서 보라색이라 청록 팔레트와 어긋남 |
| 1-3 | tribunal → tribunal | `#875577` | 해골 자객 → shadow_soldier, 해골 병사·방패병 → bone_knight, 원령 → void_wisp, 폭탄 슬라임 → slime (#ffd060, 0.5) | ⚠ 환경이 분홍보라(장 색 청록 아님). ♻ 해골 계열 |
| 1-5 | tribunal → tribunal | `#875577` | **애도의 기사 세렌 → bone_knight (#87cbb0, 1.95)**, 해골 방패병 → bone_knight, 뼈 오크 → goblin_chief, 해골 주술사 → skeleton_mage | ♻🎨 보스가 졸개 방패병과 같은 몸, 색+크기만 다름. ⚠ 환경 tribunal |
| 1-10 | procession → memorial | `#5c7d73` | **종왕 에일른 → bone_knight (#87cbb0, 2.25)**, 해골 병사 → bone_knight, 원령 → void_wisp, 해골 자객 → shadow_soldier | ♻🎨 5관문 보스와 같은 몸·같은 tint, scale만 1.95→2.25 |

### 2장 불씨 왕국의 용광로 (주황·쇳물 / 어깨 넓은 일꾼(오크), 불씨(임프))

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 2-1 | kiln → kiln | `#8e3a24` | 가시 방벽 → treant (1.1), 임프 → mushroom_shaman, 부족 전사 → goblin_raider, 화염 정령 → fire_phoenix, 푸른 악마(정예) → demon_lord (#a0c0ff, 1.4) | ⚠ "불씨 임프"가 버섯 주술사 몸. ⚠ "가시 방벽"이 나무정령 몸. 🎨 푸른 악마 정예가 뒤 보스와 같은 몸 |
| 2-3 | tribunal → tribunal | `#875577` | 폭발 임프 → mushroom_shaman (#ff9060), 가시 방벽 → treant, 부족 전사 → goblin_raider, 임프 → mushroom_shaman, 화염 정령·독침벌 → fire_phoenix | ⚠ 환경이 용광로 주황이 아니라 분홍보라. ♻ 임프/폭발 임프는 색만 다름 🎨 |
| 2-5 | kiln → kiln | `#8e3a24` | **대장장이 이그란 → goblin_brute (#ed925d, 1.95)**, 오크 전사 → goblin_brute, 꼬마 오크·부족 전사 → goblin_raider, 부족 주술사 → goblin_raider (#ffd0a0) | ♻🎨 보스가 졸개 오크 전사와 같은 몸. 부족 주술사도 전사와 같은 몸(색만 다름) |
| 2-10 | kiln → kiln | `#8e3a24` | **화왕 발드 → demon_lord (#ed925d, 2.25)**, 오크 전사 → goblin_brute, 꼬마 오크·부족 전사 → goblin_raider | ♻🎨 2-1 정예 푸른 악마와 같은 몸(색·크기만) |

### 3장 거꾸로 흐르는 서리 도서관 (하늘색·종이 흰색 / 떠다니는 해골 머리, 얼음 거울)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 3-1 | archive → archive | `#4a688c` | 해골 방패병 → bone_knight, 부패 슬라임 → slime, 원령·해골 망령 → void_wisp | ♻ 1장과 같은 몸 구성(해골·원령·슬라임). 해골 망령(떠다니는 머리)은 체크리스트 부합이나 1장과 같은 몸 |
| 3-3 | tribunal → tribunal | `#875577` | 서리굴 잠행꾼 → goblin_raider (#9fd8ff), 해골 방패병 → bone_knight, 골렘 수호자 → frost_golem (1.15), 원령 → void_wisp, 부패 슬라임 → slime, 해골 주술사 → skeleton_mage | ⚠ 환경이 서리 하늘색이 아님. 🎨 잠행꾼은 2장 부족 전사와 같은 몸에 하늘색 tint |
| 3-5 | archive → archive | `#4a688c` | **기록관 오르딘 → frost_golem (#a3ceef, 1.95)**, 원령 → void_wisp, 부패 슬라임 → slime, 해골 방패병 → bone_knight, 해골 망령 → void_wisp | ♻🎨 졸개는 전부 1장 몸. 보스 몸 frost_golem은 4장 일반 몹 골렘 수호자와 같은 몸 |
| 3-10 | archive → archive | `#4a688c` | **서리왕 이셀 → frost_yeti (#a3ceef, 2.25)**, 원령 → void_wisp, 부패 슬라임 → slime, 해골 방패병 → bone_knight | ♻🎨 졸개가 3-5와 같은 구성 |

### 4장 별이 잠긴 심해 (청록·심해 남색 / 촉수·눈알·버섯)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 4-1 | beacon → beacon | `#378686` | 골렘 수호자 → frost_golem (1.15), 부유 촉수·심연 눈알 → star_owl, 심연 슬라임 → slime | ♻ 촉수와 눈알이 같은 몸(star_owl). ♻ 골렘은 3장과 같은 몸 |
| 4-3 | beacon → beacon | `#378686` | 골렘 수호자 → frost_golem, 심연 눈알·부유 촉수 → star_owl, 진화한 독침벌 → fire_phoenix, 심연 슬라임 → slime, 심연 폭탄 → slime (#ff70ff) | ♻ 독침벌은 2장 화염 정령과 같은 fire_phoenix. 🎨 심연 폭탄은 슬라임 색만 다름 |
| 4-5 | beacon → beacon | `#378686` | **등대지기 마렌 → mushroom_shaman (#65c5d1, 1.95)**, 부유 촉수 → star_owl, 심연 슬라임 → slime, 이계 침입자 → shadow_soldier, 심연 주시자 → star_owl (#d0b0ff, 1.05) | ⚠ 등대지기(사람)가 버섯 주술사 몸. ♻ 이 몸은 2장 임프와 같은 몸 |
| 4-10 | beacon → beacon | `#378686` | **해왕 네레이스 → ember_drake (#65c5d1, 2.25)**, 부유 촉수 → star_owl, 심연 슬라임 → slime, 이계 침입자 → shadow_soldier, 심연 주시자 → star_owl (#d0b0ff) | ♻🎨 ember_drake는 tribunal·beacon·lostShip·emptyThrones 4개 경로의 던전 보스 변종도 쓰는 몸(3절) |

### 5장 새벽을 먹는 왕관 (금색·새벽 보라 / 닌자·악마의 날카로운 윤곽)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 5-1 | tribunal → tribunal | `#875577` | 심연 폭탄 → slime (#ff70ff), 해골 방패병 → bone_knight, 임프 → mushroom_shaman, 화염 정령 → fire_phoenix | ⚠ 닌자·악마 윤곽이 아니라 해골·슬라임·버섯이 대부분(닌자 0마리). 환경 보라는 체크리스트 "새벽 보라"와 근접 |
| 5-3 | tribunal → tribunal | `#875577` | 그림자 닌자 → shadow_soldier, 이계 침입자 → shadow_soldier, 임프 → mushroom_shaman, 심연 폭탄 → slime, 해골 방패병 → bone_knight, 심연 주시자 → star_owl (#d0b0ff) | ♻ 닌자와 이계 침입자가 같은 몸. 닌자는 4마리뿐, 임프 12마리가 주력 |
| 5-5 | tribunal → tribunal | `#875577` | **첫 기사 아스텔 → bone_knight (#e0c184, 1.95)**, 그림자 닌자 → shadow_soldier, 해골 방패병 → bone_knight, 이계 침입자 → shadow_soldier, 심연 주시자 → star_owl | ♻🎨 보스가 졸개 해골 방패병과 같은 몸(금색 tint만) |
| 5-10 | tribunal → tribunal | `#875577` | **새벽을 먹는 빈 왕관 → treant (#e0c184, 2.25)**, 그림자 닌자 → shadow_soldier, 해골 방패병 → bone_knight, 이계 침입자·심연 주시자 | ⚠ 보스 '빈 왕관'이 나무정령(treant) 몸. 2장 가시 방벽과 같은 몸 |

### 6장 함께 잇는 귀환로 (청록, 1장과 같은 귀환 색 / 다섯 지역 적의 혼합)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 6-1 | procession → memorial | `#5c7d73` | 해골 방패병·해골 병사 → bone_knight, 원령·해골 망령 → void_wisp | ♻ 1-1과 같은 경로·같은 해골+원령 구성(정예 대원령만 빠짐). "다섯 지역 혼합"이 아님 |
| 6-3 | addresses → confluence | `#50886b` | 그림자 닌자·해골 자객 → shadow_soldier, 원령·해골 망령 → void_wisp, 임프 → mushroom_shaman, 해골 주술사 → skeleton_mage, 폭탄 슬라임 → slime (#ffd060, 0.5) | 혼합 의도에는 부합(해골·닌자·임프 섞임). ♻ 모두 앞 장 몸 재사용, 6장 전용 몸 없음 |
| 6-5 | tribunal → tribunal | `#875577` | **공허한 서약의 잔향 → bone_knight (#87cbb0, 1.95)**, 해골 방패병 → bone_knight, 뼈 오크 → goblin_chief, 해골 병사, 해골 주술사 → skeleton_mage | ♻🎨 1-5 세렌과 같은 몸·같은 tint·같은 scale, 졸개 구성도 같음. ⚠ 환경 분홍보라(귀환 청록 아님) |
| 6-10 | confluence → confluence | `#50886b` | **마지막 고립의 잔향 → goblin_chief (#87cbb0, 2.25)**, 부유 촉수 → star_owl, 원령 → void_wisp, 이계 침입자 → shadow_soldier, 심연 눈알 → star_owl | ♻🎨 졸개는 4장·1장 몸 혼합. 보스는 뼈 오크 몸 |

### 7장 금 간 종탑의 도시 (바랜 황동 / 두건 쓴 종지기, 금 간 대종)

| 관문 | 경로 → 환경키 | 안개 | 적 type → asset | 판정 |
|---|---|---|---|---|
| 7-1 | bellstreet → belltower | `#7b796c` | 해골 방패병·해골 병사 → bone_knight, 원령 → void_wisp, 해골 주술사 → skeleton_mage | ⚠ 종지기 없이 1장 해골·원령 그대로(화면 28마리 중 Tripo 0). ♻ |
| 7-3 | belfry → belltower | `#7b796c` | 해골 방패병·해골 병사 → bone_knight, 해골 망령·원령 → void_wisp, 해골 주술사 → skeleton_mage, 폭탄 슬라임 → slime (#ffd060, 0.5) | ⚠ 같음. 1-3과 같은 폭탄 슬라임(같은 tint·scale) |
| 7-5 | belfry → belltower | `#7b796c` | **종탑 수문 기사 오르벤 → tll_ch7_midboss (#c9b07a, 1.95)**, 해골 방패병·해골 자객·원령·해골 망령 | 전용 몸(Tripo). 졸개는 ♻ 1장 구성 |
| 7-10 | crackedNave → belltower | `#7b796c` | **금 간 대종의 주인 카델 → tll_ch7_finalboss (#c9b07a, 2.25)**, 원령 → void_wisp, 뼈 오크 → goblin_chief, 해골 병사, 해골 사제 → skeleton_mage (#b0ffc0) | 전용 몸(Tripo). 졸개는 ♻ 1장 구성, 해골 사제는 1장 초록 tint 그대로 |

장별 소견(코드): 7장 Tripo 몸이 manifest에 없으면 대체 실루엣을 쓰는 구조지만(`monster-roster.js` 7장 주석), 캡처 시점에는 두 보스가 `tll_ch7_*`로 로드됐다. 종지기(`Bell_Ringer`)는 `DUNGEON_ROSTERS`의 7장 세 경로 trash 8칸에 들어 있으나 캡처 4관문 화면에서는 나오지 않았다(미관측, 방 구성에 따라 다름).

## 3. asset 재사용 표

관문 로스터(`combatRosterFor`)·보스·던전 보스 변종 기준으로 코드에서 계산했다. "쓰는 장"은 그 몸을 쓰는 적이 한 번이라도 편성되는 장이다. 적 이름은 대표만 적었다.

| asset | 쓰는 장 | 쓰는 적 (대표) |
|---|---|---|
| bone_knight | 1,3,4,5,6,7 | 해골 병사·방패병·대장, 애도의 기사 세렌, 종왕 에일른, 첫 기사 아스텔, 공허한 서약의 잔향, 종탑 순찰대장 |
| void_wisp | 1,3,4,6,7 | 원령, 해골 망령, 대원령, 서고 경비대장 |
| shadow_soldier | 1,3,4,5,6,7 | 해골 자객, 그림자 닌자, 이계 침입자 |
| slime | 1,3,4,5,6,7 | 폭탄·부패·심연 슬라임, 심연 폭탄 |
| goblin_chief | 1,2,3,5,6,7 | 뼈 오크, 골편 군주, 마지막 고립의 잔향, 시청 종루의 종지기 |
| mushroom_shaman | 1,2,4,5,6 | 임프, 폭발 임프, 버섯 왕, 등대지기 마렌 |
| skeleton_mage | 1,3,6,7 | 해골 주술사, 해골 사제 |
| ember_drake | 1,2,3,4,5,6 | 새끼 용, 해왕 네레이스, 흑요룡·환영 여왕 계열 던전 보스 |
| treant | 1,2,5,6 | 가시 방벽, 새벽을 먹는 빈 왕관, 온실의 성역수 |
| frost_yeti | 1,2,3,4,5,6 | 설산 거인, 서리왕 이셀, 던전 보스 변종(밤유리 기록관·유성기사 등) |
| goblin_brute | 2,6 | 오크 전사, 오크 족장, 대장장이 이그란 |
| goblin_raider | 2,3,5,6 | 꼬마 오크, 부족 전사, 서리굴 잠행꾼 |
| fire_phoenix | 2,4,5,6 | 화염 정령, 독침벌 |
| demon_lord | 2,5,6 | 푸른 악마, 화왕 발드, 새벽의 집행관 |
| frost_golem | 3,4,6 | 골렘 수호자, 기록관 오르딘, 침몰 선단 대장 |
| star_owl | 4,5,6 | 부유 촉수, 심연 눈알, 심연 주시자 |
| tll_ch7_bellringer | 7 | 종지기, 종루의 타종 관리인 |
| tll_ch7_midboss | 7 | 종탑 수문 기사 오르벤, 수문 감시자 |
| tll_ch7_finalboss | 7 | 금 간 대종의 주인 카델, 대예배당 종 수호자 |

읽는 법: 한 장만 쓰는 몸은 7장 Tripo 3종뿐이다. `bone_knight`·`slime`·`shadow_soldier`·`ember_drake`·`frost_yeti`는 각각 6개 장에 걸친다. 몸 이름과 어긋나는 사례는 `Big_Cactoro`(가시 방벽)→treant, `Blob_Mushnub`(임프)→mushroom_shaman, `Big_MushroomKing`(마렌)→mushroom_shaman, `Skeleton_HollowRegent`(빈 왕관)→treant다.

## 4. 순환 복사와 난이도

- **무한의 성(1~6장 복사)**: `towerFloorSource`가 `TOWER_CYCLE_CHAPTERS = 6`으로 1~6장 관문을 순환하고, `towerStage`는 `stageDef(ch, st)`를 펼쳐 쓴다. 층 정의가 적 배율·보상·코드만 바꾸므로 적 몸·tint·환경은 해당 관문과 같다. 7장은 순환에 들어가지 않는다.
- **원정**: 전용 로스터를 쓴다(`expansion.js`의 `roster`: 예 `glass_shardling`, `glass_tollmage`, `glass_warden`, `mossbound_scout`, `verdigris_rootcaller`). 새 몸이 아니라 기존 라이브러리 몸에 tint를 입힌 리스킨이다(예 `glass_shardling`=slime류 `Blob_GreenSpikyBlob` #7fffe1, `glass_warden`=`Skeleton_Bulwark` 해골 방패병, `mossbound_scout`=`Big_Cactoro` #8ee6a8). 환경은 `VISUAL_BY_ROUTE`가 원정 경로 id로 정한다(`glass_garden`→memorial, `ember_vault`→kiln, `star_archive`→archive 등).
- **지옥·고통**: `difficulty.js`의 `DIFFICULTIES`는 `enemyHp`·`enemyAtk`·`enemyDensity`·보상 배율만 바꾸고 모델·tint·환경 필드가 없다. `applyDifficulty`는 `stage`를 그대로 펼쳐 이어 붙이므로 외형은 스토리 난이도와 같다(강해져도 모습이 안 바뀜).

## 5. 던전 환경: 장별로 바뀌는 것과 공용인 것

**경로 단위로 바뀌는 값** (`dungeon-visuals.js` `VISUAL_BY_ROUTE` → `DUNGEON_VISUALS`와 `arena.js` `DUNGEON_ATMOSPHERES`)

| 환경키 | 경로 | 안개(report) | 하늘 horizon (코드) |
|---|---|---|---|
| memorial | procession, greenhouse | `#5c7d73` | 0x8ab9a9 |
| kiln | kiln, uprising | `#8e3a24` | 0xd35632 |
| archive | archive, reverseRiver | `#4a688c` | 0x6f98ca |
| beacon | beacon, lostShip | `#378686` | 0x55c4c2 |
| tribunal | tribunal, emptyThrones | `#875577` | 0xc77da9 |
| confluence | confluence, addresses | `#50886b` | 0x78c79c |
| belltower | bellstreet, belfry, crackedNave | `#7b796c` | 0xb4b09a |

관문 10개가 어떤 환경키를 받는지(`dungeonVisualFor`로 계산):

| 장 | 환경키별 관문 | 종류 수 |
|---|---|---|
| 1 | memorial 1,2,4,7,10 / tribunal 3,5,9 / confluence 6 / archive 8 | 4 |
| 2 | kiln 1,2,4,5,7,10 / tribunal 3,9 / archive 6 / confluence 8 | 4 |
| 3 | archive 1,2,5,7,8,10 / tribunal 3,9 / confluence 4 / memorial 6 | 4 |
| 4 | beacon 1,3,5,8,10 / confluence 2,6,9 / archive 4 / tribunal 7 | 4 |
| 5 | tribunal 1,3,4,5,8,10 / memorial 2 / beacon 6 / confluence 7,9 | 4 |
| 6 | memorial 1 / kiln 2,7 / confluence 3,6,10 / beacon 4,9 / tribunal 5 / archive 8 | 5 |
| 7 | belltower 1~10 | 1 |

1~5장은 각 장의 환경 키가 10관문 중 5~6개에 그치고 나머지는 다른 장의 환경이다(X-3 관문은 1·2·3·5장 모두 tribunal). 7장만 전 관문이 한 환경(belltower)이다. 환경 밀도는 전 관문 0.026(캠페인 안개 밀도 고정값, `arena.js`).

**장 테마 단위로 바뀌는 값**: 지역 건축·벽면 구조물(`region-architecture.js`가 `theme`별로 garden/forge/frost/tide/crown/crypt 분기, 7장은 `landmark === 'belltower'`이면 별도 팔레트), 장 기믹(`CHAPTERS[].mechanic`: 종의 공명·냉각로 과열·지연 기록·밀물·왕관의 심판·귀환의 공명·어긋난 타종), BGM.

**BGM**(`music.js`): 캠페인 전투곡은 장 테마가 정한다. `CHAPTER_REGION`이 6장을 `homecoming`, 7장을 `belltower`로 따로 보고 나머지는 `regions/{garden|forge|frost|tide|crown}`이다(1~5장 = garden/forge/frost/tide/crown, 6장 = homecoming). 7장은 전용 곡 계획 `region-belltower`가 `fallback: 'regions/frost'`, `status: 'external-gui-pending'`, `todo: '전용 BGM'`이라 **임시로 frost(3장 서리 서고 곡)를 쓴다**. 7장 마을 곡 `town-bellspire`도 같은 fallback이다. 곡은 경로와 무관하게 장 단위라 환경(경로)과 BGM(장)이 서로 다른 기준으로 고른다.

**공용인 값**: 바닥 타일(`floor_tile_large`), 벽 조각 생성 방식(`dungeon-walls.js`), 안개 밀도 0.026, 방 조명 구조(`HemisphereLight` 1 + `DirectionalLight` 2 + 방 안 `PointLight` 다수. report의 1-1 기준 PointLight 18개, torch 색은 환경키 값). 카메라 구도(y·z·fov·yaw)는 `DUNGEON_VISUALS`가 환경키별로 따로 갖는다.

## 6. 결론: "정체성 없는 몬스터" 원인 3가지

1. **몸이 모자라 장 사이에서 돌려 쓴다.** 19개 몸으로 93개 정의를 돌려 쓰고, 해골 `bone_knight`·`slime`·`shadow_soldier`는 6개 장에 나온다. 장 전용 몸은 7장 Tripo 3종뿐이고, 그것도 보스 둘이 확인된 상태다. 몸 이름과 사연이 어긋나는 곳(마렌=버섯, 빈 왕관=나무정령, 임프=버섯, 보라 원령)이 세계관과 충돌한다.
2. **장 정체성을 몸이 아니라 tint·scale에 맡겼다.** 라이브러리 몸의 tint는 32% lerp라 약하고, 보스 scale은 전 장 1.95/2.25 고정이며 보스 몸이 졸개와 같은 경우가 많다(세렌·에일른·이그란·오르딘·아스텔·6장 잔향). 일반 졸개는 tint가 없어 장이 바뀌어도 같은 해골·원령으로 보인다(3·5·6·7장).
3. **환경이 장이 아니라 던전 경로를 따라가 장 색이 섞인다.** 같은 장의 X-3 관문은 `tribunal` 분홍보라가 되고(1·2·3·5장), 5장 관문 6개가 tribunal, 6장은 환경 5종이 섞인다. 바닥·벽 킷은 전 장 공용이고 BGM은 장 단위, 7장은 임시 frost 곡이다. 그래서 환경·몸·소리가 같은 장 색으로 모이지 못한다.

대응은 `docs/MONSTER_ART_BIBLE.md`(장별 실루엣·팔레트·의상 소품, 던전 환경 키트, 새 Tripo 몸 교체 순서)를 따른다. 의상 구현은 `src/data/chapter-dress.js` / `src/game/chapter-dress.js`, 몸 교체는 `monster-roster.js`의 asset 한 줄이다.
