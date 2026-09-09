// New expedition equipment reuses verified proc handlers and existing illustrated icons.
export const EXPEDITION_SETS = [
  { id: 'glasswarden', name: '유리 파수꾼', source: 'storm', material: 'glass_leaf', icon: '/img/set_storm.webp', color: 0x7fd9ff, themed: true, two: { procs: ['storm_chain'], text: '콤보 마무리로 연쇄 번개' }, four: { procs: ['storm_chain', 'blood_leech'], text: '연쇄 번개 + 처치 시 체력 3% 회복' } },
  { id: 'emberknight', name: '잿불 기사', source: 'phoenix', material: 'ember_core', icon: '/img/set_phoenix.webp', color: 0xffa040, themed: true, two: { procs: ['phoenix_burn'], text: '궁극기 시 화염 폭발' }, four: { procs: ['phoenix_burn', 'rune_charge'], text: '화염 폭발 + 콤보 룬 장전 후 회피 참격' } },
  { id: 'starreader', name: '별빛 기록자', source: 'frost', material: 'star_dust', icon: '/img/set_frost.webp', color: 0x8fd8e8, themed: true, two: { procs: ['frost_shatter'], text: '타격으로 서리 중첩과 결정 파편' }, four: { procs: ['frost_shatter', 'gravity_pull'], text: '서리 결정 + 콤보 흡인 범위 2배' } },
];
const slots = { weapon: { label: '검', atk: 72 }, armor: { label: '갑옷', hp: 468, def: 11 }, ring: { label: '반지', atk: 32 }, boots: { label: '장화', hp: 234, atk: 14 } };
export const EXPEDITION_ITEMS = EXPEDITION_SETS.flatMap(set => Object.entries(slots).map(([slot, values]) => {
  const { label, ...stats } = values;
  return { id: `exp_${set.id}_${slot}`, name: `${set.name}의 ${label}`, slot, rarity: 'U', set: set.id, ...stats, icon: `/img/it_${set.source}_${slot}.webp` };
}));
