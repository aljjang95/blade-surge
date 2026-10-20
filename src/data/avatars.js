// 캐시 아바타는 전투 수치와 분리된 순수 외형 상품이다.
export const AVATARS = Object.freeze([
  Object.freeze({ id: 'avatar_knight_sakura', heroId: 'knight', name: '벚꽃 무사 갑주', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.' }),
  Object.freeze({ id: 'avatar_barbarian_oni', heroId: 'barbarian', name: '용암 오니 군주', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.' }),
  Object.freeze({ id: 'avatar_mage_astral', heroId: 'mage', name: '별빛 천문 예복', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.' }),
  Object.freeze({ id: 'avatar_rogue_crow', heroId: 'rogue', name: '밤까마귀 망토', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.' }),
  Object.freeze({ id: 'avatar_ranger_fox', heroId: 'ranger', name: '설원 여우 사냥꾼', price: 2980, desc: '순수 외형이며 성능에 영향을 주지 않습니다.' }),
]);

export const AVATAR_BY_ID = Object.freeze(Object.fromEntries(AVATARS.map((avatar) => [avatar.id, avatar])));
export const AVATAR_IDS = Object.freeze(AVATARS.map((avatar) => avatar.id));
