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
});

/** 동행(해골 술사)도 무료 KayKit 대신 라이브러리 해골 마법사를 쓴다. */
export const COMPANION_ASSET = 'skeleton_mage';

export function monsterRosterEntry(model) {
  return Object.hasOwn(MONSTER_ROSTER, model) ? MONSTER_ROSTER[model] : null;
}

