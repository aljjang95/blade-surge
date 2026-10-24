# 마을·지역 진행 + 영웅 라이브러리 계약 v1 (2026-10-12)

> 2026-10-24: 광장 던전 관문 배정은 서비스 마을 목록 대신 캠페인 지역 마을(`src/game/region-dungeon-gate.js` gateIds)을 따른다. 상인·교관·이동석·해금 조건은 이 계약 그대로다. [../region-dungeon-unlock.md](../region-dungeon-unlock.md)

## 1. 지역(마을) 진행 — 소유: Sol-A
- 마을 3곳. 기존 성채 광장이 1번 마을이다. DUNGEONS 12개를 minLevel 순으로 4개씩 나눠 배정한다.
  - town1 `oathhold` 서약의 성채(기존 테마, 1~4번째 던전)
  - town2 `emberport` 잿불 항구 마을(따뜻한 주황·항구, 5~8번째)
  - town3 `starcrest` 별마루 설원 마을(푸른 설원·별빛, 9~12번째)
- 해금: 이전 마을 던전 4곳 중 3곳 이상 '클리어'(실제 승리 기록, 기존 저장 기록 재사용) + 영웅 레벨 조건. 해금은 저장에 남고 되돌리지 않는다. 기존 저장은 마이그레이션으로 town1만 해금(이미 조건을 충족한 저장은 즉시 해금).
- 각 마을에 상인(장비·소모품)과 스킬 교관이 있다. 상위 마을일수록 상점 장비 등급·기본 능력치가 높다(새 장비 정의는 items.js 기존 형식을 따르고 강화·세트 시스템과 호환).
- 스킬 교관: 마을별로 배울 수 있는 기술(영웅별)을 판다. 골드·재료로 습득하고, 실제 전투에 영향을 주는 기존 스킬 체계(skills.js, combat-arts.js, 스킬 강화)를 재사용한다. 스탯만 올리는 상품 금지(PRD §5) — 최소 각 기술은 기존 스킬의 새 변형(범위·진공·추가 타격·상태이상 등 동작 변화)을 연다.
- 공개 API(파일 `src/game/town-service.js`, 클래스 `TownService(eco)`):
  - `towns()` → [{id,name,subtitle,tier,theme,dungeonIds,unlocked,progress:{cleared,required},requirement:{text}}]
  - `currentTownId()`, `travel(id)` → {ok, reason?}
  - `shop(townId)` → [{id,itemId|consumableId,name,rarity,price:{gold,materials?},stockLeft?,owned?}], `buy(townId, offerId)` → {ok, reason?, granted}
  - `trainer(townId, heroId)` → [{id,name,description,heroId,learned,price,requires}], `learn(townId, offerId, heroId)` → {ok, reason?}
  - `onChange(fn)` 구독(선택). 모든 변경은 기존 economy 저장 트랜잭션 안에서 처리.
- 데이터: `src/data/towns.js`(TOWNS, TOWN_SHOP, TOWN_TRAINER). 테스트: `test/town-*.test.ts`.

## 2. 마을·던전·필드 장면과 UI — 소유: Sonnet
- 성채 광장 장면(citadel-hub-scene)을 마을 테마(town.theme)별로 다르게 구성: 바닥·조명·안개·건물 실루엣·소품 배치, 해당 마을 던전 게이트 4개만 표시, 상인·교관 NPC 위치, 다른 마을로 가는 '이동석(waystone)'.
- Tripo 라이브러리 소품(manifest kind 'prop', 필드 `tags`: ['town:emberport','building'] 등)이 있으면 그것을 쓰고, 없으면 기존 절차적/기존 GLB로 폴백.
- UI: 마을 이동(지도·잠김 사유·진행도), 상인 패널(등급 색, 가격, 구매), 교관 패널(영웅별 기술, 습득 상태). 기존 storybook.css 톤을 따른다.
- 던전·필드: region-architecture / open-field-scene / arena 방 장식을 지역 테마에 맞게 보강(라이브러리 소품 인스턴싱 사용). drawCalls ≤ 420 유지.

## 3. 영웅 라이브러리 — 소유: Sol-B
- manifest 항목 `{kind:'character', role:'hero', heroId, clips:{...}}`. 기존 몬스터 항목(role 없음)은 그대로 유효.
- 영웅 논리 클립 키(라이브러리 GLB 안의 애니메이션 이름 = 키):
  idle, run, dodge, hit, death, cheer, interact, slash_h, slash_d, stab, spin, chop, jump_attack, block, cast_shoot, cast_long, cast_raise, throw, bow_shoot
  각 영웅은 자기 콤보·스킬이 쓰는 키만 필수(아래 매핑 표로 계산). 없는 키는 가장 가까운 키로 폴백.
- KayKit 애니 이름 → 논리 키 매핑은 `src/data/hero-library.js`에 둔다(예: 1H_Melee_Attack_Slice_Horizontal→slash_h, 2H_Melee_Attack_Spin(ning)→spin, Spellcast_Shoot→cast_shoot, Bow_Shoot→bow_shoot, Dodge_Forward→dodge, Hit_A/B→hit, Death_A/B→death, Block_Hit→block, Jump_Full_Short→jump_attack, Throw→throw, Running_A→run 등).
- 기존 ModelContract(`materials:'authored'`, aliases, sockets, scale) 경로로 연결한다. 소켓: handslot.r → mixamorig:RightHand(또는 Tripo 리그의 오른손 본 이름 자동 탐색), handslot.l → 왼손.
- 영웅 GLB는 무기 없이 만든다. 게임의 기존 무기 장착(forged-weapons, look.js 장비 외형)은 손 소켓에 그대로 붙는다. KayKit 전용 갑옷 오버레이는 라이브러리 영웅에서 끈다.
- 로드 실패 시 기존 영웅 모델 폴백. 로비 쇼케이스·동행·파티 복제도 같은 경로.

