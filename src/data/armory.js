// Six original four-piece sets. Uses the existing U drop roll and fragment forge.
const specs = [
  ['anchor', '정박자의 맹세', 0x56c8bf, '회피한 자리에 닻을 남겨 0.6초 뒤 주변 적을 끌어온다. 재사용 4초', '닻의 흡인 범위가 3에서 4.5로 증가', ['계류검', '항만 흉갑', '닻고리', '잠수 장화']],
  ['echo', '잔향의 결투', 0xb3a0ef, '같은 적에게 3회 명중 후 회피하면 표식을 터뜨린다. 표식 유지 4초', '표식 피해가 공격력 60%에서 100%로 증가', ['소리굽쇠 검', '공명 갑주', '여운의 반지', '잔음 각반']],
  ['mercy', '등불의 순례', 0xf2c77f, '명중 5회를 모아 다음 일반 스킬 사용 시 체력 2% 회복', '모은 빛의 회복량이 체력 4%로 증가', ['등대 지팡이', '순례 외투', '불씨 고리', '길잡이 장화']],
  ['lance', '매의 사냥', 0x90c87b, '4 이상 떨어진 적에게 명중하면 0.8초간 둔화. 재사용 3초', '둔화 지속 1.4초. 보스에게는 항상 0.4초', ['날개 창', '깃털 흉갑', '매눈 인장', '비상 각반']],
  ['relay', '길쌈의 기예', 0xeb9b8f, '연속 세 번 서로 다른 적에게 명중하면 궁극기 게이지 3 회복', '궁극기 게이지 회복량이 6으로 증가', ['북실 단검', '직조 갑옷', '실타래 고리', '교차 장화']],
  ['aegis', '보루의 약속', 0x94b6e6, '일반 스킬 사용 후 3초 안에 회피하면 피해 감소 15%를 1초간 획득', '회피 후 피해 감소가 25%로 증가', ['성문 대검', '보루 판금', '성벽 인장', '수비대 철화']],
];
const slots = ['weapon', 'armor', 'ring', 'boots'];
const stats = [{ atk: 72 }, { hp: 468, def: 11 }, { atk: 32 }, { hp: 234, atk: 14 }];
export const ARMORY_SETS = specs.map(([key, name, color, two, four]) => ({
  id: `arm_${key}`, name, color, themed: true,
  icon: `/img/armory-v1/arm_${key}_ring.png`,
  two: { procs: [`arm_${key}`], text: two },
  four: { procs: [`arm_${key}`, `arm_${key}_master`], text: `${two} · ${four}` },
}));
export const ARMORY_ITEMS = specs.flatMap(([key, , , , , names], design) => slots.map((slot, i) => ({
  id: `arm_${key}_${slot}`, name: names[i], rarity: 'U', slot, set: `arm_${key}`,
  ...stats[i], icon: `/img/armory-v1/arm_${key}_${slot}.png`,
  armoryDesign: design, modelNode: `arm_${key}_${slot}`,
})));
