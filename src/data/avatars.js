// 캐시 아바타는 전투 수치와 분리된 순수 외형 상품이다.
// portrait: 상점 카드 초상(512² webp). node tools/art/avatar-portrait/render.mjs <id> 로 게임 렌더 + 테마 배경을 합성해 굽는다. 없으면 영웅 초상을 쓴다.
export const AVATARS = Object.freeze([
  Object.freeze({ id: 'avatar_knight_sakura', heroId: 'knight', name: '벚꽃 무사 갑주', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_knight_sakura-v1.webp' }),
  Object.freeze({ id: 'avatar_barbarian_oni', heroId: 'barbarian', name: '용암 오니 군주', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_barbarian_oni-v1.webp' }),
  Object.freeze({ id: 'avatar_mage_astral', heroId: 'mage', name: '별빛 천문 예복', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_mage_astral-v1.webp' }),
  Object.freeze({ id: 'avatar_rogue_crow', heroId: 'rogue', name: '밤까마귀 망토', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_rogue_crow-v1.webp' }),
  Object.freeze({ id: 'avatar_ranger_fox', heroId: 'ranger', name: '설원 여우 사냥꾼', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_ranger_fox-v1.webp' }),
  // 할로윈 2차(t5)
  Object.freeze({ id: 'avatar_knight_pumpkin', heroId: 'knight', name: '호박등 기사', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_knight_pumpkin-v1.webp' }),
  Object.freeze({ id: 'avatar_mage_pumpkin', heroId: 'mage', name: '호박 마녀', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_mage_pumpkin-v1.webp' }),
  Object.freeze({ id: 'avatar_barbarian_werewolf', heroId: 'barbarian', name: '늑대인간 족장', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_barbarian_werewolf-v1.webp' }),
  Object.freeze({ id: 'avatar_rogue_vampire', heroId: 'rogue', name: '흡혈 백작', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_rogue_vampire-v1.webp' }),
  Object.freeze({ id: 'avatar_ranger_blackcat', heroId: 'ranger', name: '검은 고양이 사냥꾼', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.', portrait: '/img/tll/avatars/avatar_ranger_blackcat-v1.webp' }),
]);

export const AVATAR_BY_ID = Object.freeze(Object.fromEntries(AVATARS.map((avatar) => [avatar.id, avatar])));
export const AVATAR_IDS = Object.freeze(AVATARS.map((avatar) => avatar.id));
