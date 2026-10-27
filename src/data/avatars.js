// 아바타 = 던파식 풀셋 외형(머리·상의·하의·외투 네 부위가 한 몸으로 만들어진 전신 몸체).
// 몸 위에 부위 메시를 따로 입히면 체형과 어긋나 깨지므로(2026-10-27 대표님 지적) 부위는 수집 단위이고, 네 부위가 모이면 풀셋 몸체가 열린다.
// 풀셋을 착용하면 작은 편의 효과(AVATAR_FULLSET_EFFECT)가 붙는다. 전투력·정산·드랍에는 들어가지 않는다(docs/AVATAR_FULLSET.md).
// portrait: 상점 카드 초상(512² webp). node tools/art/avatar-portrait/render.mjs <id> 로 게임 렌더 + 테마 배경을 합성해 굽는다. 없으면 영웅 초상을 쓴다.
/** 아바타 부위. 이벤트·업적 보상은 부위 단위로 줄 수 있고, 보석·유료 상품은 풀셋을 한 번에 준다. */
export const AVATAR_PARTS = Object.freeze(['head', 'top', 'bottom', 'cloak']);
export const AVATAR_PART_LABEL = Object.freeze({ head: '머리', top: '상의', bottom: '하의', cloak: '외투' });
/**
 * 풀셋 착용 효과. 이동속도·줍기 범위만 올린다(공격·체력·드랍·골드는 건드리지 않아 sim:90d 진행 밴드와 무관).
 * 대안이던 스킬 +1·골드 +5% 는 유료 상품의 전투·경제 우위가 되어 버렸다.
 */
export const AVATAR_FULLSET_EFFECT = Object.freeze({ speedPct: 0.05, pickupPct: 0.3 });
const FULLSET_DESC = '풀셋 효과: 이동속도 +5% · 줍기 범위 +30% (공격·체력·보상에는 영향 없음)';
export const AVATARS = Object.freeze([
  Object.freeze({ id: 'avatar_knight_sakura', heroId: 'knight', name: '벚꽃 무사 갑주', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_knight_sakura-v1.webp' }),
  Object.freeze({ id: 'avatar_barbarian_oni', heroId: 'barbarian', name: '용암 오니 군주', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_barbarian_oni-v1.webp' }),
  Object.freeze({ id: 'avatar_mage_astral', heroId: 'mage', name: '별빛 천문 예복', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_mage_astral-v1.webp' }),
  Object.freeze({ id: 'avatar_rogue_crow', heroId: 'rogue', name: '밤까마귀 망토', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_rogue_crow-v1.webp' }),
  Object.freeze({ id: 'avatar_ranger_fox', heroId: 'ranger', name: '설원 여우 사냥꾼', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_ranger_fox-v1.webp' }),
  // 할로윈 2차(t5)
  Object.freeze({ id: 'avatar_knight_pumpkin', heroId: 'knight', name: '호박등 기사', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_knight_pumpkin-v1.webp' }),
  Object.freeze({ id: 'avatar_mage_pumpkin', heroId: 'mage', name: '호박 마녀', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_mage_pumpkin-v1.webp' }),
  Object.freeze({ id: 'avatar_barbarian_werewolf', heroId: 'barbarian', name: '늑대인간 족장', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_barbarian_werewolf-v2.webp' }),
  Object.freeze({ id: 'avatar_rogue_vampire', heroId: 'rogue', name: '흡혈 백작', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_rogue_vampire-v1.webp' }),
  Object.freeze({ id: 'avatar_ranger_blackcat', heroId: 'ranger', name: '검은 고양이 사냥꾼', price: 2980, desc: FULLSET_DESC, portrait: '/img/tll/avatars/avatar_ranger_blackcat-v1.webp' }),
]);

export const AVATAR_BY_ID = Object.freeze(Object.fromEntries(AVATARS.map((avatar) => [avatar.id, avatar])));
export const AVATAR_IDS = Object.freeze(AVATARS.map((avatar) => avatar.id));

/**
 * 유료 풀셋 상품 avatar_fullset_<heroId>_v1 이 지급하는 아바타(영웅당 하나). 몸체 자산이 준비된 영웅만 넣는다.
 * 카탈로그·결제·환불은 BM 레인 소유이고, 지급은 economy.grantAvatarFullset(heroId) 하나로만 한다.
 */
export const AVATAR_FULLSET_SKU_PREFIX = 'avatar_fullset_';
export const avatarFullsetSku = (heroId) => AVATAR_FULLSET_SKU_PREFIX + heroId + '_v1';
export const AVATAR_PREMIUM_BY_HERO = Object.freeze({});

/**
 * 전투 스탯에 풀셋 이동속도를 얹는다(새 객체 반환, 원본 불변). 출격과 전투 중 레벨업 재계산이 같은 함수를 쓴다.
 * 파티는 장비를 싣지 않는 기존 규칙대로 적용하지 않는다.
 */
export function withAvatarSpeed(stats, bonus, { party = false } = {}) {
  const pct = party ? 0 : bonus?.avatar?.speedPct || 0;
  return pct ? { ...stats, spd: stats.spd * (1 + pct) } : stats;
}

/** 착용 중인 아바타의 풀셋 효과. 아바타가 없으면 null. */
export function avatarFullsetEffect(avatarId) {
  return avatarId && AVATAR_BY_ID[avatarId] ? AVATAR_FULLSET_EFFECT : null;
}
