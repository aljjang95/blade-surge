// 몬스터 로스터 — 스테이지 데이터의 기존 모델 이름을 대표님이 Tripo로 만든 라이브러리 몬스터에 연결한다.
// 2026-10-14 대표님 지시: KayKit·Quaternius 무료 몬스터를 전면 철회한다. 여기 없는 몬스터 모델은 쓰지 않는다.
// asset: 우선 라이브러리 ID, fallback: asset 이 manifest 에 없거나 로드 실패할 때 쓸 인간형 라이브러리 ID.
// scale: 라이브러리 정규화 키(heightM)에 곱하는 배율. 철회한 무료 모델의 실제 키(리그 배율 포함)와 같아지도록 맞췄다.
// 적 정의의 def.scale 은 그 위에 그대로 곱하므로 기존 화면 밀도·판독 크기를 유지한다.
// 비행 높이는 manifest 의 hover(모델 단위)에 실제 적용 배율을 곱해 Actor 가 계산한다.

/** @typedef {{ asset: string, fallback: string, scale?: number }} MonsterRosterEntry */

/** @type {Readonly<Record<string, MonsterRosterEntry>>} */
export const MONSTER_ROSTER = Object.freeze({
  // ---- 해골 계열 ----
  Skeleton_Minion: { asset: 'bone_knight', fallback: 'bone_knight', scale: 0.86 },
  Skeleton_Warrior: { asset: 'bone_knight', fallback: 'bone_knight', scale: 1.03 },
  Skeleton_Vanguard: { asset: 'bone_knight', fallback: 'bone_knight', scale: 0.86 },
  Skeleton_Bulwark: { asset: 'bone_knight', fallback: 'bone_knight', scale: 1.03 },
  Skeleton_Rogue: { asset: 'shadow_soldier', fallback: 'bone_knight', scale: 1 },
  Skeleton_Skirmisher: { asset: 'shadow_soldier', fallback: 'bone_knight', scale: 1 },
  Skeleton_Mage: { asset: 'skeleton_mage', fallback: 'skeleton_mage', scale: 1.05 },
  Skeleton_Runekeeper: { asset: 'skeleton_mage', fallback: 'skeleton_mage', scale: 1.05 },
  // ---- 2족 대형 ----
  Big_Orc: { asset: 'goblin_brute', fallback: 'goblin_brute', scale: 0.77 },
  Big_Orc_Skull: { asset: 'goblin_chief', fallback: 'goblin_brute', scale: 0.74 },
  Big_Tribal: { asset: 'goblin_raider', fallback: 'goblin_brute', scale: 1.07 },
  Big_Demon: { asset: 'demon_lord', fallback: 'demon_lord', scale: 0.69 },
  Big_BlueDemon: { asset: 'demon_lord', fallback: 'demon_lord', scale: 0.63 },
  Big_Yeti: { asset: 'frost_yeti', fallback: 'frost_yeti', scale: 0.66 },
  Big_MushroomKing: { asset: 'mushroom_shaman', fallback: 'skeleton_mage', scale: 0.99 },
  Big_Ninja: { asset: 'shadow_soldier', fallback: 'bone_knight', scale: 0.76 },
  Big_Alien: { asset: 'shadow_soldier', fallback: 'demon_lord', scale: 0.79 },
  Big_Cactoro: { asset: 'treant', fallback: 'goblin_brute', scale: 0.76 },
  // ---- 작은 몸체 ----
  Blob_GreenBlob: { asset: 'slime', fallback: 'goblin_raider', scale: 1.22 },
  Blob_PinkBlob: { asset: 'slime', fallback: 'goblin_raider', scale: 1.33 },
  Blob_GreenSpikyBlob: { asset: 'slime', fallback: 'goblin_raider', scale: 2.71 },
  Blob_Mushnub: { asset: 'mushroom_shaman', fallback: 'goblin_raider', scale: 1.41 },
  Blob_Mushnub_Evolved: { asset: 'mushroom_shaman', fallback: 'goblin_raider', scale: 1.89 },
  Blob_Orc: { asset: 'goblin_raider', fallback: 'goblin_brute', scale: 1.06 },
  // ---- 비행 ----
  Flying_Ghost: { asset: 'void_wisp', fallback: 'skeleton_mage', scale: 1.17 },
  Flying_Ghost_Skull: { asset: 'void_wisp', fallback: 'skeleton_mage', scale: 1.15 },
  Flying_Dragon: { asset: 'ember_drake', fallback: 'demon_lord', scale: 0.61 },
  Flying_Dragon_Evolved: { asset: 'ember_drake', fallback: 'demon_lord', scale: 1.04 },
  Flying_Armabee: { asset: 'fire_phoenix', fallback: 'goblin_raider', scale: 0.69 },
  Flying_Armabee_Evolved: { asset: 'fire_phoenix', fallback: 'goblin_raider', scale: 0.77 },
  Flying_Hywirl: { asset: 'fire_phoenix', fallback: 'skeleton_mage', scale: 1.01 },
  Flying_Squidle: { asset: 'star_owl', fallback: 'skeleton_mage', scale: 0.94 },
  Flying_Glub: { asset: 'star_owl', fallback: 'skeleton_mage', scale: 0.92 },
  Flying_Goleling_Evolved: { asset: 'frost_golem', fallback: 'frost_yeti', scale: 0.63 },
  // ---- 지역 최종 보스(기존 KayKit 리그 장식 변형을 대체) ----
  Skeleton_BellKing: { asset: 'bone_knight', fallback: 'bone_knight', scale: 1.03 },
  Big_KilnTyrant: { asset: 'demon_lord', fallback: 'demon_lord', scale: 0.69 },
  Big_ArchiveMonarch: { asset: 'frost_yeti', fallback: 'frost_yeti', scale: 0.66 },
  Flying_AbyssRegent: { asset: 'ember_drake', fallback: 'demon_lord', scale: 1.04 },
  Skeleton_HollowRegent: { asset: 'treant', fallback: 'goblin_chief', scale: 0.92 },
  Skeleton_OathRemnant: { asset: 'goblin_chief', fallback: 'goblin_brute', scale: 1.03 },
  // ---- 7장 종탑 도시(2026-10-27): asset 은 Tripo 로 만들 예정인 라이브러리 ID 이고, 아직 manifest 에 없으면 fallback 실루엣을 쓴다.
  // 에셋 레인이 GLB 를 asset-library 에 수집해 manifest 에 같은 ID 를 올리면 코드 변경 없이 바뀐다(docs/SPEC_720H.md S7).
  // 종지기: 두건 쓴 해골 사제 실루엣. 수문 기사: 갑주 해골 기사. 대종의 주인: 큰 돌덩이 몸통의 거신.
  Bell_Ringer: { asset: 'tll_ch7_bellringer', fallback: 'skeleton_mage', scale: 1.05,
    // 몸에서 분리한 종추 곤봉(prop). grip 은 곤봉 로컬 m(손잡이 가운데), at/rot 은 오른손 본 기준.
    weapon: { asset: 'tll_ch7_bellringer_club', hand: 'right', grip: [0, 0.44, 0.055], at: [0, 0.09, 0], rot: [0, 0, -90] } },
  Bell_Warden: { asset: 'tll_ch7_midboss', fallback: 'bone_knight', scale: 0.53, fallbackScale: 1.1,
    weapon: { asset: 'tll_ch7_midboss_flail', hand: 'right', grip: [-0.12, 1.45, -0.22], at: [0, 0.12, 0], rot: [0, 0, -90] } },
  // scale 은 Tripo 몸 기준이다. 몸 로드 실패로 대체 모델이 서면 예전 값(fallbackScale)을 쓴다(대체 모델 키·판정 반경 유지).
  Bell_Sovereign: { asset: 'tll_ch7_finalboss', fallback: 'frost_golem', scale: 0.5, fallbackScale: 0.72 },
  // ---- 1·2장 전용 Tripo 몸(2026-10-28, docs/asset-library/ch1-ch2-tripo.md) ----
  // 장 전용 적 id(stages.js CHAPTER_SPECIES)와 1·2장 중간 보스만 쓴다. scale 은 heightM × scale × def.scale 이
  // 목표 키(관꾼 1.6m·원령 1.7m·장인 1.7m·임프 1.2m)가 되게 맞췄다. 보스는 크기 띠(size-bands)가 영웅×1.8 이상을 보장한다.
  // fallback 은 몸 로드 실패 때 서던 예전 몸이고, fallbackScale 은 그때의 예전 배율이다.
  Ch1_CoffinBearer: { asset: 'tll_ch1_coffinbearer', fallback: 'bone_knight', scale: 1.05, fallbackScale: 0.86 },
  Ch1_Mourner: { asset: 'tll_ch1_mourner', fallback: 'void_wisp', scale: 0.8, fallbackScale: 1.17,
    weapon: { asset: 'tll_ch1_handbell', hand: 'right', grip: [0, 0.33, 0], at: [0, 0.07, 0.02], rot: [0, 0, 180] } },
  Ch1_TombKnight: { asset: 'tll_ch1_tombknight', fallback: 'bone_knight', scale: 0.85, fallbackScale: 1.03,
    weapon: { asset: 'tll_ch1_clapper', hand: 'right', grip: [0, 0.22, 0], at: [0, 0.08, 0.02], rot: [0, 0, 90] },
    offhand: { asset: 'tll_ch1_tombshield', hand: 'left', grip: [0, 0.42, 0.05], at: [0, 0.05, 0.08], rot: [90, 0, 0] } },
  // 묘비 방패병: 관꾼 해골 몸에 세렌의 묘비 방패를 왼손에 들린다(1장 방패 역할 skel_shield 자리).
  Ch1_TombGuard: { asset: 'tll_ch1_coffinbearer', fallback: 'bone_knight', scale: 1.05, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch1_tombshield', hand: 'left', grip: [0, 0.42, 0.05], at: [0, 0.05, 0.08], rot: [90, 0, 0] } },
  Ch2_Smith: { asset: 'tll_ch2_smith', fallback: 'goblin_brute', scale: 1, fallbackScale: 0.77,
    weapon: { asset: 'tll_ch2_hammer', hand: 'right', grip: [0, 0.17, 0], at: [0, 0.07, 0.02], rot: [0, 0, -90] } },
  // rot 은 2026-10-28 근접 캡처(work/tmp/weapon-tune.mjs)로 고른 값: 철퇴·모루 철퇴는 머리가 위, 장인 망치는 머리가 아래로 늘어지고,
  // 손종·등잔은 손끝 너머로 매단다. 묘비 방패는 왼손에 앞을 보게 든다.
  // 등잔은 위 손잡이 고리를 쥐고 아래로 늘어뜨린다(발광 Glow 재질은 라이브러리 tllAuthored 로 유지된다).
  Ch2_EmberImp: { asset: 'tll_ch2_emberimp', fallback: 'goblin_raider', scale: 1.2, fallbackScale: 1.07,
    weapon: { asset: 'tll_ch2_lantern', hand: 'right', grip: [0, 0.28, 0], at: [0, 0.05, 0.01], rot: [0, 0, 180] } },
  // 혼령 자리 임프(던전 대장의 혜성 불씨·밤유리 서기관, 원본 def.scale 1.25): 같은 등잔 임프를 1.0 자리와 같은 키로 맞춘다.
  Ch2_EmberImpSpirit: { asset: 'tll_ch2_emberimp', fallback: 'goblin_raider', scale: 0.96, fallbackScale: 0.86,
    weapon: { asset: 'tll_ch2_lantern', hand: 'right', grip: [0, 0.28, 0], at: [0, 0.05, 0.01], rot: [0, 0, 180] } },
  Ch2_Igran: { asset: 'tll_ch2_igran', fallback: 'goblin_brute', scale: 0.75, fallbackScale: 0.77,
    weapon: { asset: 'tll_ch2_anvil_hammer', hand: 'right', grip: [0, 0.3, 0], at: [0, 0.08, 0.02], rot: [0, 0, 90] } },
  // ---- 3장 전용 Tripo 몸(2026-10-28, docs/asset-library/ch3-tripo.md) ----
  // 서리 해골 사서 1.6m(등에 얼어붙은 책 더미)·망령 검열관 1.7m(눈가리개 띠, 두루마리 자락으로 떠 있음)·기록관 오르딘 2.2m(frost_midboss).
  // scale 은 heightM × scale × def.scale 이 영웅(1.8m)의 0.9~1.0배가 되게 맞췄다. 검열관은 원본 종 크기(원령 1.25, 주술사 1.0)가 달라 항목을 나눴다.
  // rot 은 2026-10-28 근접 후보 캡처(같은 장면에 4개 세워 비교)로 골랐다: 서가 방패는 책 면이 앞(묘비 방패와 손 축이 달라 180° 돌림),
  // 금서는 펼친 면이 위·앞, 봉인 도장 철퇴는 머리가 위로 서서 몸 바깥으로 40° 기운다.
  Ch3_Librarian: { asset: 'tll_ch3_librarian', fallback: 'shadow_soldier', scale: 1.05, fallbackScale: 1 },
  // 서가 방패 사서: 왼손에 책이 꽂힌 얼음 서가 방패(skel_shield 자리).
  Ch3_ShelfGuard: { asset: 'tll_ch3_librarian', fallback: 'bone_knight', scale: 1.05, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch3_shelfshield', hand: 'left', grip: [0, 0.4, 0.05], at: [0, 0.05, 0.08], rot: [90, 180, 0] } },
  Ch3_Censor: { asset: 'tll_ch3_censor', fallback: 'void_wisp', scale: 0.8, fallbackScale: 1.17 },
  // 금서를 든 검열관(주술사·사제 자리): 오른손에 펼친 금서.
  Ch3_CensorTome: { asset: 'tll_ch3_censor', fallback: 'skeleton_mage', scale: 1.0, fallbackScale: 1.05,
    weapon: { asset: 'tll_ch3_tome', hand: 'right', grip: [0, 0.1, 0], at: [0, 0.08, 0.04], rot: [90, 0, 0] } },
  Ch3_Ordin: { asset: 'tll_ch3_ordin', fallback: 'frost_golem', scale: 0.8, fallbackScale: 0.63,
    weapon: { asset: 'tll_ch3_seal', hand: 'right', grip: [0, 0.25, 0], at: [0, 0.08, 0.02], rot: [90, 0, 40] } },
  // ---- 4장 전용 Tripo 몸(2026-10-29, docs/asset-library/ch4-tripo.md) ----
  // 따개비 수부 1.6m(허리 닻사슬·어깨 따개비)·미끼등 아귀 1.25m(이마 미끼등, 두 다리로 서서 hover 없음)·등대지기 마렌 2.2m(tide_midboss).
  // scale 은 heightM × scale × def.scale 이 영웅(1.8m)의 0.9~1.0배(수부)·약 0.73배(아귀)가 되게 맞췄다. 원본 종 크기가 다른 자리
  // (원령 1.25·골렘 수호자 1.15·해골 망령 1.2)는 항목을 나눴다.
  Ch4_Drowned: { asset: 'tll_ch4_drowned', fallback: 'bone_knight', scale: 1.08, fallbackScale: 0.86 },
  Ch4_DrownedDrift: { asset: 'tll_ch4_drowned', fallback: 'void_wisp', scale: 0.86, fallbackScale: 1.17 },
  // 판자 방패 수부: 왼손에 난파선 판자 방패(골렘 수호자 shield 행동 자리).
  Ch4_PlankGuard: { asset: 'tll_ch4_drowned', fallback: 'bone_knight', scale: 0.95, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch4_plankshield', hand: 'left', grip: [0, 0.4, 0.05], at: [0, 0.05, 0.08], rot: [0, 0, 0] } },
  Ch4_Lurer: { asset: 'tll_ch4_lurer', fallback: 'star_owl', scale: 1.05, fallbackScale: 0.92 },
  Ch4_LurerGlim: { asset: 'tll_ch4_lurer', fallback: 'void_wisp', scale: 0.88, fallbackScale: 1.15 },
  // 등대지기 마렌: 오른손에 긴 장대 등롱.
  Ch4_Maren: { asset: 'tll_ch4_maren', fallback: 'mushroom_shaman', scale: 0.8, fallbackScale: 0.99,
    weapon: { asset: 'tll_ch4_lantern', hand: 'right', grip: [0, 0.45, 0], at: [0, 0.08, 0.02], rot: [160, 0, 0] } },
  // ---- 5장 전용 Tripo 몸(2026-10-29, docs/asset-library/ch5-tripo.md) ----
  // 새벽 가면 닌자 1.6m(금빛 해 가면·보라 목도리)·왕관 병사 1.7m(투구 위 작은 금관)·왕관 고리 주술사 1.6m(머리 위 떠 있는 금빛 고리,
  // 두 다리로 서서 hover 없음)·첫 기사 아스텔 2.4m(crown_midboss). scale 은 heightM × scale × def.scale 이 영웅(1.8m)의 0.9~1.0배가 되게 맞췄다.
  Ch5_DawnNinja: { asset: 'tll_ch5_dawnninja', fallback: 'shadow_soldier', scale: 1.05, fallbackScale: 0.76,
    weapon: { asset: 'tll_ch5_dawnblade', hand: 'right', grip: [0, 0.12, 0], at: [0, 0.07, 0.02], rot: [90, 0, 0] } },
  // 맨손 닌자(견습·봉화 닌자 자리): 단검 없이.
  Ch5_DawnNinjaBare: { asset: 'tll_ch5_dawnninja', fallback: 'shadow_soldier', scale: 1.05, fallbackScale: 0.76 },
  // 혼령 자리 닌자(던전 대장이 부르는 종의 잔영·혜성 불씨, 원본 def.scale 1.25~1.3): 불투명 맨손 닌자를 영웅 키로 맞춘다.
  Ch5_DawnNinjaSpirit: { asset: 'tll_ch5_dawnninja', fallback: 'shadow_soldier', scale: 0.82, fallbackScale: 0.6 },
  // 새벽 견습 닌자(임프 자리): 한 뼘 작은 맨손 닌자, 등에 연습용 목검(의상 squireBokken).
  Ch5_DawnNinjaSquire: { asset: 'tll_ch5_dawnninja', fallback: 'shadow_soldier', scale: 0.9, fallbackScale: 0.66 },
  Ch5_CrownSoldier: { asset: 'tll_ch5_crownsoldier', fallback: 'shadow_soldier', scale: 1.0, fallbackScale: 0.79 },
  // 칙령 징집병(낭독 주술사가 부르는 꼬마 오크 자리): 한 뼘 작은 왕관 병사.
  Ch5_CrownLevy: { asset: 'tll_ch5_crownsoldier', fallback: 'shadow_soldier', scale: 0.86, fallbackScale: 0.68 },
  // 성벽 검 방패병: 왼손에 검을 엮은 큰 방패(해골 방패병 shield 행동 자리).
  Ch5_SwordWall: { asset: 'tll_ch5_crownsoldier', fallback: 'bone_knight', scale: 0.97, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch5_swordwall', hand: 'left', grip: [0, 0.45, 0.05], at: [0, 0.05, 0.08], rot: [0, 0, 0] } },
  Ch5_Seer: { asset: 'tll_ch5_seer', fallback: 'skeleton_mage', scale: 1.0, fallbackScale: 1.05 },
  // 첫 기사 아스텔: 오른손에 넓은 맹세 대검.
  Ch5_Astel: { asset: 'tll_ch5_astel', fallback: 'bone_knight', scale: 0.73, fallbackScale: 1.03,
    weapon: { asset: 'tll_ch5_oathsword', hand: 'right', grip: [0, 0.3, 0], at: [0, 0.08, 0.02], rot: [0, 0, 90] } },
  // ---- 6장 전용 Tripo 몸(2026-10-29, docs/asset-library/ch6-tripo.md) ----
  // 귀환 열차 승객 잔향 1.6m(얼굴 없는 잿빛 코트·빈 이름표 다발)·빈 의자의 증인 2.2m(homecoming_midboss, 등에 빈 의자).
  // 원령 자리(def.scale 1.25)는 항목을 나눴다.
  Ch6_Passenger: { asset: 'tll_ch6_passenger', fallback: 'bone_knight', scale: 1.1, fallbackScale: 0.86,
    offhand: { asset: 'tll_ch6_suitcase', hand: 'left', grip: [0, 0.45, 0], at: [0, 0.05, 0.02], rot: [0, 0, 180] } },
  Ch6_PassengerBare: { asset: 'tll_ch6_passenger', fallback: 'bone_knight', scale: 1.1, fallbackScale: 0.86 },
  Ch6_PassengerSmall: { asset: 'tll_ch6_passenger', fallback: 'shadow_soldier', scale: 0.97, fallbackScale: 0.76 },
  Ch6_PassengerDrift: { asset: 'tll_ch6_passenger', fallback: 'void_wisp', scale: 0.85, fallbackScale: 1.17 },
  // 가방 방패 승객: 여행 가방을 왼손에 방패처럼 앞으로 든다(가시 방벽·골렘 수호자 shield 행동 자리).
  Ch6_PassengerTrunk: { asset: 'tll_ch6_passenger', fallback: 'bone_knight', scale: 0.97, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch6_suitcase', hand: 'left', grip: [0, 0.08, 0.05], at: [0, 0.05, 0.08], rot: [90, 0, 0] } },
  Ch6_Witness: { asset: 'tll_ch6_witness', fallback: 'goblin_chief', scale: 0.8, fallbackScale: 1.03 },
  // ---- 7장 전용 Tripo 몸(2026-10-29, docs/asset-library/ch7-tripo.md) ----
  // 해골 시민 1.6m(중절모·황동 단추 조끼, 금빛 눈)·굽쇠 주술사 1.6m(석회빛 두건 법복, 어깨·허리의 금 간 작은 종).
  // scale 은 heightM × scale × def.scale 이 영웅(1.8m)의 0.85~1.0배가 되게 맞췄다. 원본 종 크기가 다른 자리
  // (폭탄 슬라임 0.5 × visualScale 0.65·해골 망령 1.2·원령 1.25)는 항목을 나눴다.
  // 해골 시민: 왼손에 타종 명부를 안는다(해골 병사 자리, 관문·보스 지원병).
  Ch7_Citizen: { asset: 'tll_ch7_citizen', fallback: 'bone_knight', scale: 1.1, fallbackScale: 0.86,
    offhand: { asset: 'tll_ch7_ledger', hand: 'left', grip: [0, 0.2, 0], at: [0, 0.05, 0.04], rot: [0, 0, 180] } },
  Ch7_CitizenBare: { asset: 'tll_ch7_citizen', fallback: 'bone_knight', scale: 1.1, fallbackScale: 0.86 },
  // 늦은 시민(해골 자객 자리): 오른손에 1장 손종(tll_ch1_handbell)을 쥐고 뛴다 — 맨손 시민들과 손 윤곽으로 갈린다(의상 lateScarf).
  Ch7_CitizenLate: { asset: 'tll_ch7_citizen', fallback: 'bone_knight', scale: 1.1, fallbackScale: 0.86,
    weapon: { asset: 'tll_ch1_handbell', hand: 'right', grip: [0, 0.33, 0], at: [0, 0.07, 0.02], rot: [0, 0, 180] } },
  // 명부 방패 시민: 타종 명부를 왼손에 방패처럼 앞으로 든다(해골 방패병 shield 행동 자리).
  Ch7_CitizenLedger: { asset: 'tll_ch7_citizen', fallback: 'bone_knight', scale: 1.0, fallbackScale: 1.03,
    offhand: { asset: 'tll_ch7_ledger', hand: 'left', grip: [0, 0.1, 0.05], at: [0, 0.05, 0.08], rot: [90, 0, 0] } },
  // 종루 짐꾼 시민(뼈 오크 자리): 조금 큰 맨손 시민, 등에 종추(의상 clapperBack).
  Ch7_CitizenHauler: { asset: 'tll_ch7_citizen', fallback: 'goblin_chief', scale: 1.12, fallbackScale: 1.03 },
  // 폭음 시민(폭탄 슬라임 자리): 원본 def.scale 0.5 × visualScale 0.65 를 되돌려 0.87배 키로 선다(판정 반경은 원본 그대로).
  Ch7_CitizenFuse: { asset: 'tll_ch7_citizen', fallback: 'shadow_soldier', scale: 3.0, fallbackScale: 2.2 },
  // 굽쇠 주술사: 오른손에 긴 황동 굽쇠 지팡이(해골 주술사 자리).
  Ch7_Tuner: { asset: 'tll_ch7_tuner', fallback: 'skeleton_mage', scale: 1.05, fallbackScale: 1.05,
    weapon: { asset: 'tll_ch7_tuningfork', hand: 'right', grip: [0, 0.55, 0], at: [0, 0.08, 0.02], rot: [160, 0, 0] } },
  // 명부 낭송 주술사(해골 사제 자리): 지팡이 대신 왼손에 타종 명부.
  Ch7_TunerLedger: { asset: 'tll_ch7_tuner', fallback: 'skeleton_mage', scale: 1.0, fallbackScale: 1.05,
    offhand: { asset: 'tll_ch7_ledger', hand: 'left', grip: [0, 0.2, 0], at: [0, 0.05, 0.04], rot: [0, 0, 180] } },
  Ch7_TunerEcho: { asset: 'tll_ch7_tuner', fallback: 'skeleton_mage', scale: 0.88, fallbackScale: 0.88 },
  Ch7_TunerDrift: { asset: 'tll_ch7_tuner', fallback: 'void_wisp', scale: 0.85, fallbackScale: 1.17 },
  // ---- 컨셉 던전 전용 보스(2026-10-17): 다른 던전·심층·캠페인 최종 보스가 쓰지 않는 기존 자산 ----
  // 빙하 수문의 거신: 얼음 결정 골렘(Glaciertitan). 표시 키 2.4m × 0.72 × 보스 배율 2.5 ≈ 4.3m.
  Big_TidegateTitan: { asset: 'frost_golem', fallback: 'frost_yeti', scale: 0.72 },
  // 도르래 거수: 가시 갑옷 병사 몸체에 황동 색조. 2.3m × 0.9 × 2.45 ≈ 5.1m.
  Big_PulleyColossus: { asset: 'shadow_soldier', fallback: 'goblin_brute', scale: 0.9 },
});

/** 동행(해골 술사)도 무료 KayKit 대신 라이브러리 해골 마법사를 쓴다. */
export const COMPANION_ASSET = 'skeleton_mage';

export function monsterRosterEntry(model) {
  return Object.hasOwn(MONSTER_ROSTER, model) ? MONSTER_ROSTER[model] : null;
}

/**
 * 실제 로드된 라이브러리 에셋이 대체 모델이고 fallbackScale 이 있으면 그 값을, 아니면 scale 을 쓴다.
 * @param {{ asset?: string, scale?: number, fallbackScale?: number } | null | undefined} roster
 * @param {{ id?: string } | null} [libraryAsset]
 */
export function monsterRosterScale(roster, libraryAsset = null) {
  if (!roster) return 1;
  if (roster.fallbackScale !== undefined && libraryAsset && libraryAsset.id !== roster.asset) return roster.fallbackScale;
  return roster.scale || 1;
}
