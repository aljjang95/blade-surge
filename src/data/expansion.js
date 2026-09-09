import { stageDef } from './stages.js';
import { EXPEDITION_ITEMS, EXPEDITION_SETS } from './expedition-items.js';

export const MATERIALS = [
  { id: 'glass_leaf', name: '유리 잎', description: '유리 정원에서 얻는 바람의 결정' },
  { id: 'ember_core', name: '잿불 핵', description: '잿불 금고의 제련 재료' },
  { id: 'star_dust', name: '별가루', description: '별빛 서고의 얼음 결정' },
];
export const CONSUMABLES = [
  { id: 'hp_tonic', name: '회복 물약', description: '최대 체력 35% 회복', effect: { heal: 0.35 } },
  { id: 'overdrive', name: '과충전 물약', description: '12초 동안 공격력 25% 증가', effect: { atk: 0.25, duration: 12 } },
  { id: 'aegis', name: '수호 물약', description: '12초 동안 받는 피해 30% 감소', effect: { reduction: 0.3, duration: 12 } },
];
// Uses the existing enhancement inventory keys (STONE_KEY tiers 1/2/3).
export const MATERIAL_REFINING = [
  { id: 'glass_leaf', name: '강화석 정련', gold: 120, stones: 5 },
  { id: 'ember_core', name: '상급 강화석 정련', gold: 240, stones2: 2 },
  { id: 'star_dust', name: '전설 강화석 정련', gold: 360, stones3: 1 },
];
const dungeon = (id, name, theme, ch, minLevel, material, description) => {
  const base = stageDef(ch, 1);
  return { id, name, theme, minLevel, energy: 4, description,
    stage: { ...base, code: id, name, title: name, scale: 1 + (minLevel - 1) * 0.18, energy: 4, recPower: 2600 + (minLevel - 1) * 450,
      waves: base.waves.slice(0, 2).map(w => w.slice(0, 9)), objective: description },
    rewards: { gold: 280 + minLevel * 80, xp: 80 + minLevel * 20, materials: { [material]: 3 }, consumables: { hp_tonic: 1 } } };
};
export const DUNGEONS = [
  dungeon('glass_garden', '유리 정원', 'garden', 1, 1, 'glass_leaf', '정원의 망령을 정화하고 유리 잎을 회수하세요.'),
  dungeon('ember_vault', '잿불 금고', 'forge', 2, 2, 'ember_core', '제련소의 오크를 돌파하고 잿불 핵을 확보하세요.'),
  dungeon('star_archive', '별빛 서고', 'frost', 3, 3, 'star_dust', '얼어붙은 서고의 수호자를 물리치세요.'),
];
export const JOBS = [
  { id: 'guardian', name: '수호 기사', heroId: 'knight', baseHero: 'knight', questId: 'first_oath', description: '기사 기반 · 생존과 보호에 특화' },
  { id: 'ranger', name: '바람 추적자', heroId: 'rogue', baseHero: 'rogue', questId: 'garden_scout', description: '도적 기반 · 민첩한 공격에 특화' },
];
export const RECIPES = [
  ...EXPEDITION_ITEMS.map(item => ({ id: `craft_${item.id}`, name: `${item.name} 제작`, description: '재료로 지정 장비를 확정 제작합니다.', itemId: item.id, gold: 12500, materials: { [EXPEDITION_SETS.find(s => s.id === item.set).material]: 9 } })),
  { id: 'storm_blade', name: '뇌명검 제작', itemId: 'w_storm', gold: 12500, materials: { glass_leaf: 9 } },
  { id: 'phoenix_blade', name: '불사조의 검 제작', itemId: 'w_phoenix', gold: 12500, materials: { ember_core: 12 } },
  { id: 'frost_blade', name: '한설검 제작', itemId: 'w_rime', gold: 12500, materials: { star_dust: 12 } },
  { id: 'brew_tonic', name: '회복 물약 제조', gold: 60, materials: { glass_leaf: 1 }, consumables: { hp_tonic: 2 } },
  { id: 'brew_overdrive', name: '과충전 물약 제조', gold: 90, materials: { ember_core: 1 }, consumables: { overdrive: 2 } },
  { id: 'brew_aegis', name: '수호 물약 제조', gold: 90, materials: { star_dust: 1 }, consumables: { aegis: 2 } },
];
const quest = (id, name, stat, target, rewards) => ({ id, name, description: name, stat, target, rewards });
export const EXPEDITION_QUESTS = [
  quest('first_oath', '탐험가의 서약 보상 받기', 'welcome', 1, { gold: 300, xp: 30, consumables: { hp_tonic: 2 } }),
  quest('garden_scout', '유리 정원 1회 클리어', 'glass_garden', 1, { xp: 60, materials: { glass_leaf: 3 } }),
  quest('campaign_scout', '캠페인 첫 승리', 'campaignWins', 1, { gold: 400, xp: 60 }),
  quest('garden_keeper', '유리 정원 3회 클리어', 'glass_garden', 3, { gold: 600, xp: 80 }),
  quest('ember_keeper', '잿불 금고 1회 클리어', 'ember_vault', 1, { xp: 90, materials: { ember_core: 3 } }),
  quest('star_keeper', '별빛 서고 1회 클리어', 'star_archive', 1, { xp: 100, materials: { star_dust: 3 } }),
  quest('first_craft', '장비 또는 물약 1회 제작', 'crafts', 1, { gold: 500, xp: 50 }),
  quest('field_medic', '전투에서 소모품 3회 사용', 'consumed', 3, { xp: 70, consumables: { aegis: 2 } }),
  quest('arena_debut', 'AI 결투장 첫 승리', 'arenaWins', 1, { gold: 300, xp: 60 }),
  quest('arena_veteran', 'AI 결투장 5회 승리', 'arenaWins', 5, { gold: 700, xp: 120 }),
  quest('expedition_veteran', '탐험 던전 10회 클리어', 'dungeonWins', 10, { gold: 1200, xp: 180 }),
];
export const ARENA_RIVALS = [
  { id: 'rookie', name: '연습 기사', heroId: 'knight', minLevel: 1, rating: 100, scale: 0.9 },
  { id: 'duelist', name: '바람의 결투가', heroId: 'rogue', minLevel: 2, rating: 300, scale: 1.25 },
  { id: 'champion', name: '서리의 챔피언', heroId: 'mage', minLevel: 4, rating: 600, scale: 1.7 },
].map(r => ({ ...r, description: 'AI 상대 연습 결투 · 에너지 무료', energy: 0, stage: { ...stageDef(1, 1), code: `arena_${r.id}`, name: r.name, scale: r.scale }, rewards: { gold: 60, xp: 25, rating: 15 } }));
export const accountLevelXp = level => 150 + (level - 1) * 75;
