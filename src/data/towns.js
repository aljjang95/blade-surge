import { DUNGEONS } from './expansion.js';
import { ITEM_BY_ID } from './items.js';

const orderedDungeons = [...DUNGEONS].sort((a, b) => a.minLevel - b.minLevel);
const dungeonGroups = [0, 1, 2].map((index) => orderedDungeons.slice(index * 4, index * 4 + 4));

export const TOWNS = Object.freeze([
  Object.freeze({ id: 'oathhold', name: '서약의 성채', subtitle: 'OATHHOLD CITADEL', tier: 1, theme: 'oathhold', dungeonIds: dungeonGroups[0].map(d => d.id), requiredClears: 0, requiredLevel: 1 }),
  Object.freeze({ id: 'emberport', name: '잿불 항구', subtitle: 'EMBERPORT HARBOR', tier: 2, theme: 'emberport', dungeonIds: dungeonGroups[1].map(d => d.id), requiredClears: 3, requiredLevel: 5 }),
  Object.freeze({ id: 'starcrest', name: '별마루 설원', subtitle: 'STARCREST SNOWFIELD', tier: 3, theme: 'starcrest', dungeonIds: dungeonGroups[2].map(d => d.id), requiredClears: 3, requiredLevel: 15 }),
]);

// 무기·갑옷 오퍼의 appearanceTier는 아이템 정의 값을 그대로 노출한다(UI 표시용 사본).
const offer = (id, townId, itemId, rarity, gold, materials) => ({ id, townId, itemId, rarity,
  ...(ITEM_BY_ID[itemId]?.appearanceTier ? { appearanceTier: ITEM_BY_ID[itemId].appearanceTier } : {}),
  price: { gold, materials } });
const supply = (id, townId, consumableId, gold, materials) => ({ id, townId, consumableId, price: { gold, materials } });

export const TOWN_SHOP = Object.freeze([
  offer('oathhold_blade', 'oathhold', 'w_town_oath', 'S', 1800, { glass_leaf: 4 }),
  offer('oathhold_mail', 'oathhold', 'a_town_oath', 'S', 1800, { glass_leaf: 4 }),
  offer('oathhold_silver', 'oathhold', 'r_silver', 'S', 1500, { glass_leaf: 3 }),
  offer('oathhold_swift', 'oathhold', 'b_swift', 'S', 1500, { glass_leaf: 3 }),
  supply('oathhold_tonic', 'oathhold', 'hp_tonic', 120, { glass_leaf: 1 }),
  offer('emberport_blade', 'emberport', 'w_town_ember', 'E', 9000, { ember_core: 8 }),
  offer('emberport_mail', 'emberport', 'a_town_ember', 'E', 9000, { ember_core: 8 }),
  offer('emberport_ruby', 'emberport', 'r_ruby', 'E', 6500, { ember_core: 6 }),
  offer('emberport_bloodstep', 'emberport', 'b_blood', 'U', 8000, { ember_core: 7 }),
  supply('emberport_overdrive', 'emberport', 'overdrive', 260, { ember_core: 2 }),
  offer('starcrest_blade', 'starcrest', 'w_town_star', 'L', 24000, { star_dust: 14 }),
  offer('starcrest_mail', 'starcrest', 'a_town_star', 'L', 24000, { star_dust: 14 }),
  offer('starcrest_abyss', 'starcrest', 'r_abyss', 'L', 22000, { star_dust: 12 }),
  offer('starcrest_sky', 'starcrest', 'b_sky', 'L', 22000, { star_dust: 12 }),
  supply('starcrest_aegis', 'starcrest', 'aegis', 420, { star_dust: 3 }),
]);

const trainer = (id, townId, heroId, skillId, variant, name, description, gold, materials, level) => ({
  id, townId, heroId, skillId, variant, name, description, price: { gold, materials }, requires: { level },
});

export const TOWN_TRAINER = Object.freeze([
  trainer('oathhold_knight_aftershock', 'oathhold', 'knight', 'shield_bash', 'aftershock', '철벽의 여진', '철벽 강타 뒤 작은 충격파가 한 번 더 터집니다.', 1600, { glass_leaf: 4 }, 3),
  trainer('oathhold_barbarian_aftershock', 'oathhold', 'barbarian', 'quake', 'aftershock', '대지의 여진', '대지 분쇄가 짧은 지연 후 두 번째 파동을 남깁니다.', 1600, { glass_leaf: 4 }, 3),
  trainer('oathhold_mage_split', 'oathhold', 'mage', 'fireball', 'split', '분열 화염', '화염구가 갈라져 옆으로 번집니다.', 1600, { glass_leaf: 4 }, 3),
  trainer('oathhold_rogue_wide', 'oathhold', 'rogue', 'poison_bomb', 'wide', '넓은 독무', '독무의 진공과 피해 범위가 넓어집니다.', 1600, { glass_leaf: 4 }, 3),
  trainer('oathhold_ranger_extra', 'oathhold', 'ranger', 'ranger_volley', 'extra', '추가 추적탄', '삼중 추적탄이 네 발로 발사됩니다.', 1600, { glass_leaf: 4 }, 3),
  trainer('emberport_knight_pull', 'emberport', 'knight', 'judgment', 'pull', '인력의 심판', '심판의 빛이 낙하 전에 적을 중심으로 끌어옵니다.', 5200, { ember_core: 8 }, 8),
  trainer('emberport_barbarian_wide', 'emberport', 'barbarian', 'whirlwind', 'wide', '잿불 회오리', '회오리 참격의 타격 반경이 넓어집니다.', 5200, { ember_core: 8 }, 8),
  trainer('emberport_mage_bind', 'emberport', 'mage', 'chain', 'bind', '빙결 연쇄', '번개 사슬의 첫 연쇄가 더 오래 기절시킵니다.', 5200, { ember_core: 8 }, 8),
  trainer('emberport_rogue_echo', 'emberport', 'rogue', 'flurry', 'echo', '그림자 잔향', '환영 난무가 마지막 잔상 찌르기를 추가합니다.', 5200, { ember_core: 8 }, 8),
  trainer('emberport_ranger_root', 'emberport', 'ranger', 'ranger_binding', 'root', '뿌리 속박', '숲의 속박이 적을 잠시 더 묶습니다.', 5200, { ember_core: 8 }, 8),
  trainer('starcrest_knight_nova', 'starcrest', 'knight', 'holy_slash', 'nova', '성검의 여명', '성검 일섬이 주변에 작은 추가 참격을 남깁니다.', 14000, { star_dust: 14 }, 15),
  trainer('starcrest_barbarian_blood', 'starcrest', 'barbarian', 'bloodquake', 'echo', '설원의 혈진', '혈왕의 대지붕괴가 두 번째 붕괴를 더 강하게 일으킵니다.', 14000, { star_dust: 14 }, 15),
  trainer('starcrest_mage_blizzard', 'starcrest', 'mage', 'blizzard', 'wide', '극야의 폭풍', '빙결 폭풍의 결계와 타격 반경이 넓어집니다.', 14000, { star_dust: 14 }, 15),
  trainer('starcrest_rogue_parade', 'starcrest', 'rogue', 'night_parade', 'wide', '별그림자 행렬', '야행의 흡인 반경이 넓어집니다.', 14000, { star_dust: 14 }, 15),
  trainer('starcrest_ranger_pierce', 'starcrest', 'ranger', 'ranger_pierce', 'star', '별빛 관통', '바람 관통탄의 판정 반경과 밀치기가 커집니다.', 14000, { star_dust: 14 }, 15),
]);

export const TOWN_SHOP_BY_ID = Object.fromEntries(TOWN_SHOP.map(item => [item.id, item]));
export const TOWN_TRAINER_BY_ID = Object.fromEntries(TOWN_TRAINER.map(item => [item.id, item]));

export function freshTownState() {
  return { currentTownId: 'oathhold', unlockedTownIds: ['oathhold'], purchased: [], learned: {} };
}

export function normalizeTownState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const validTowns = new Set(TOWNS.map(town => town.id));
  const unlocked = new Set(['oathhold']);
  if (Array.isArray(source.unlockedTownIds)) for (const id of source.unlockedTownIds) if (validTowns.has(id)) unlocked.add(id);
  const purchased = Array.isArray(source.purchased) ? [...new Set(source.purchased.filter(id => TOWN_SHOP_BY_ID[id]))] : [];
  const learned = {};
  if (source.learned && typeof source.learned === 'object' && !Array.isArray(source.learned)) {
    for (const [heroId, ids] of Object.entries(source.learned)) {
      if (Array.isArray(ids)) learned[heroId] = [...new Set(ids.filter(id => TOWN_TRAINER_BY_ID[id]?.heroId === heroId))];
    }
  }
  const stats = source._migrationExpedition?.stats || source.expedition?.stats || {};
  const heroes = source._migrationHeroes || source.heroes || {};
  const heroLevel = Math.max(...Object.values(heroes).map(hero => Number(hero?.level) || 1), 1);
  for (let index = 1; index < TOWNS.length; index++) {
    const town = TOWNS[index], previous = TOWNS[index - 1];
    const cleared = previous.dungeonIds.filter(id => Number(stats[id]) > 0).length;
    if (cleared >= town.requiredClears && heroLevel >= town.requiredLevel) unlocked.add(town.id);
  }
  const currentTownId = validTowns.has(source.currentTownId) && unlocked.has(source.currentTownId) ? source.currentTownId : 'oathhold';
  return { currentTownId, unlockedTownIds: [...unlocked], purchased, learned };
}
