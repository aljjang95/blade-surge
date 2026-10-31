import { DUNGEONS } from './expansion.js';
import { ITEM_BY_ID } from './items.js';
import { RARITY_BUY_LEVEL } from './shop-gates.js';

export const TOWNS = Object.freeze([
  Object.freeze({ id: 'oathhold', name: '서약의 성채', subtitle: 'OATHHOLD CITADEL', tier: 1, theme: 'oathhold', fieldId: 'windmeadow', dungeonIds: ['glass_garden', 'eclipse_hydra_vault', 'ember_vault', 'bellfall_crypt', 'rootbound_grotto', 'hollowbell_arboretum'], requiredClears: 0, requiredLevel: 1 }),
  Object.freeze({ id: 'emberport', name: '잿불 항구', subtitle: 'EMBERPORT HARBOR', tier: 2, theme: 'emberport', fieldId: 'dawnward_city', dungeonIds: ['cinder_tide_lock', 'ashforge_catacomb', 'star_archive', 'nightglass_observatory', 'slagwater_foundry', 'emberwake_drydock'], requiredClears: 4, requiredLevel: 5 }),
  Object.freeze({ id: 'starcrest', name: '별마루 설원', subtitle: 'STARCREST SNOWFIELD', tier: 3, theme: 'starcrest', fieldId: 'skywind_pass', dungeonIds: ['astral_leviathan_spire', 'verdigris_sanctum', 'sable_mirage_basin', 'comet_bastion', 'aurora_icewell', 'crownfall_glacier'], requiredClears: 4, requiredLevel: 15 }),
]);

export const TOWN_FIELDS = Object.freeze({ oathhold: 'windmeadow', emberport: 'dawnward_city', starcrest: 'skywind_pass' });

// 의뢰 목표 종류는 원정 정산이 실제로 아는 값만 쓴다(src/game/town-progress.js): dungeon · field · elite · treasure · kills.
// 저장 호환을 위해 id는 그대로 두고 목표만 바꿨다(2026-10-28, 진행이 오르지 않던 채집·이벤트 목표 정리).
export const TOWN_REQUESTS = Object.freeze([
  { id: 'oathhold_daily_clear', townId: 'oathhold', kind: 'daily', name: '성채 주변 정화', description: '아무 던전이나 한 번 클리어하세요.', target: { type: 'dungeon', amount: 1 }, rewards: { gold: 450, materials: { glass_leaf: 1 } } },
  { id: 'oathhold_repeat_gather', townId: 'oathhold', kind: 'repeatable', name: '바람 들판 순찰', description: '필드 원정을 한 번 마치세요.', target: { type: 'field', amount: 1 }, rewards: { gold: 280, materials: { glass_leaf: 2 } } },
  { id: 'emberport_daily_elite', townId: 'emberport', kind: 'daily', name: '항구의 정예 경계', description: '원정에서 정예 몬스터를 세 마리 쓰러뜨리세요.', target: { type: 'elite', amount: 3 }, rewards: { gold: 900, materials: { ember_core: 1 } } },
  { id: 'emberport_repeat_event', townId: 'emberport', kind: 'repeatable', name: '배수문 소탕', description: '원정에서 몬스터 300마리를 쓰러뜨리세요.', target: { type: 'kills', amount: 300 }, rewards: { gold: 650, materials: { ember_core: 2 } } },
  { id: 'starcrest_daily_treasure', townId: 'starcrest', kind: 'daily', name: '빙정호의 잔광', description: '원정에서 숨은 보물 방을 찾으세요.', target: { type: 'treasure', amount: 1 }, rewards: { gold: 1500, materials: { star_dust: 1 } } },
  { id: 'starcrest_repeat_clear', townId: 'starcrest', kind: 'repeatable', name: '설원 순찰', description: '던전을 세 번 클리어하세요.', target: { type: 'dungeon', amount: 3 }, rewards: { gold: 1100, materials: { star_dust: 2 } } },
]);
export const TOWN_REQUEST_BY_ID = Object.freeze(Object.fromEntries(TOWN_REQUESTS.map(request => [request.id, request])));

// 마을 이야기 장마다 한 줄(18자 이하, docs/WORLD_BIBLE.md 0장). 긴 글 대신 장면 하나만 떠올리게 한다.
const TOWN_STORY_TEXT = Object.freeze({
  oathhold: ['이름 없는 묘비에 꽃이 놓였다', '바람 들판에 지워진 길이 있다', '모두의 이름을 다시 부른다'],
  emberport: ['꺼지지 않는 화로가 운다', '항구 뒷골목에 식은 그릇', '불씨를 나눠 들고 돌아간다'],
  starcrest: ['별 하나가 얼어 있다', '설원 아래 거꾸로 흐르는 길', '얼린 별을 함께 녹인다'],
});
export const TOWN_STORY = Object.freeze(Object.fromEntries(TOWNS.map(town => [town.id, Object.freeze([
  { id: `${town.id}_chapter_1`, name: `${town.name}의 첫 증언`, text: TOWN_STORY_TEXT[town.id][0], target: { type: 'dungeon', amount: 1 }, rewards: { gold: 500, xp: 40 } },
  { id: `${town.id}_chapter_2`, name: `${town.name}의 숨은 길`, text: TOWN_STORY_TEXT[town.id][1], target: { type: 'field', amount: 1 }, rewards: { gold: 800, materials: { [town.id === 'oathhold' ? 'glass_leaf' : town.id === 'emberport' ? 'ember_core' : 'star_dust']: 2 } } },
  { id: `${town.id}_chapter_3`, name: `${town.name}의 귀환 맹세`, text: TOWN_STORY_TEXT[town.id][2], target: { type: 'dungeon', amount: 4 }, rewards: { gold: 1400, xp: 100 } },
])] )));

export const TOWN_BLACKSMITH = Object.freeze({
  oathhold: Object.freeze(['storm_blade', 'brew_tonic']),
  emberport: Object.freeze(['phoenix_blade', 'brew_overdrive']),
  starcrest: Object.freeze(['frost_blade', 'brew_aegis']),
});

// 무기·갑옷 오퍼의 appearanceTier는 아이템 정의 값을 그대로 노출한다(UI 표시용 사본).
// 장비 오퍼는 등급별 최소 영웅 레벨(shop-gates.js RARITY_BUY_LEVEL)을 requires로 가진다(E 5 · U 10 · L 20).
// 가격 원칙(docs/balance-audit-2026-10-24.md): 골드 가격 > 판매가(RARITY_INFO.sell) — 사서 되파는 차익이 없다.
// 등급 곡선 S 1.5~1.8천 < E 6.5~9천 < U 1.5만 < L 5만~5.2만(+마을 재료).
const offer = (id, townId, itemId, rarity, gold, materials) => ({ id, townId, itemId, rarity,
  ...(ITEM_BY_ID[itemId]?.appearanceTier ? { appearanceTier: ITEM_BY_ID[itemId].appearanceTier } : {}),
  ...(RARITY_BUY_LEVEL[rarity] > 1 ? { requires: { level: RARITY_BUY_LEVEL[rarity] } } : {}),
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
  offer('emberport_bloodstep', 'emberport', 'b_blood', 'U', 15000, { ember_core: 7 }),
  supply('emberport_overdrive', 'emberport', 'overdrive', 260, { ember_core: 2 }),
  offer('starcrest_blade', 'starcrest', 'w_town_star', 'L', 52000, { star_dust: 14 }),
  offer('starcrest_mail', 'starcrest', 'a_town_star', 'L', 52000, { star_dust: 14 }),
  offer('starcrest_abyss', 'starcrest', 'r_abyss', 'L', 50000, { star_dust: 12 }),
  offer('starcrest_sky', 'starcrest', 'b_sky', 'L', 50000, { star_dust: 12 }),
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
  return { version: 2, currentTownId: 'oathhold', unlockedTownIds: ['oathhold'], purchased: [], learned: {},
    fields: Object.fromEntries(TOWNS.map(town => [town.id, { visited: 0, gathered: 0, elite: 0, treasure: 0, event: 0 }])),
    requests: { day: '', active: [], completed: [], progress: {} },
    blacksmith: { crafted: [], enhancements: {} },
    story: Object.fromEntries(TOWNS.map(town => [town.id, { stage: 0, progress: {} }])),
  };
}

export function normalizeTownState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const validTowns = new Set(TOWNS.map(town => town.id));
  const unlocked = new Set(['oathhold']);
  const hasPersistedUnlocks = Array.isArray(source.unlockedTownIds);
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
  // towns 필드가 없던 구 저장은 당시 4개 구성의 3곳 클리어 해금을 보존한다.
  if (!hasPersistedUnlocks) {
    const legacyGroups = [
      ['glass_garden', 'eclipse_hydra_vault', 'ember_vault', 'bellfall_crypt'],
      ['cinder_tide_lock', 'ashforge_catacomb', 'star_archive', 'nightglass_observatory'],
    ];
    for (let index = 1; index < legacyGroups.length + 1; index++) {
      const legacyClears = legacyGroups[index - 1].filter(id => Number(stats[id]) > 0).length;
      if (legacyClears >= 3 && heroLevel >= TOWNS[index].requiredLevel) unlocked.add(TOWNS[index].id);
    }
  }
  const fields = {};
  for (const town of TOWNS) {
    const input = source.fields?.[town.id];
    fields[town.id] = {
      visited: Number.isSafeInteger(input?.visited) ? Math.max(0, input.visited) : 0,
      gathered: Number.isSafeInteger(input?.gathered) ? Math.max(0, input.gathered) : 0,
      elite: Number.isSafeInteger(input?.elite) ? Math.max(0, input.elite) : 0,
      treasure: Number.isSafeInteger(input?.treasure) ? Math.max(0, input.treasure) : 0,
      event: Number.isSafeInteger(input?.event) ? Math.max(0, input.event) : 0,
    };
  }
  const requestsSource = source.requests && typeof source.requests === 'object' && !Array.isArray(source.requests) ? source.requests : {};
  const validRequestIds = new Set(TOWN_REQUESTS.map(request => request.id));
  const active = Array.isArray(requestsSource.active) ? [...new Set(requestsSource.active.filter(id => validRequestIds.has(id)))] : [];
  const completed = Array.isArray(requestsSource.completed) ? [...new Set(requestsSource.completed.filter(id => validRequestIds.has(id)))] : [];
  const progress = {};
  if (requestsSource.progress && typeof requestsSource.progress === 'object' && !Array.isArray(requestsSource.progress)) {
    for (const [id, value] of Object.entries(requestsSource.progress)) if (validRequestIds.has(id) && Number.isSafeInteger(value)) progress[id] = Math.max(0, value);
  }
  const blacksmithSource = source.blacksmith && typeof source.blacksmith === 'object' && !Array.isArray(source.blacksmith) ? source.blacksmith : {};
  const recipeIds = new Set(Object.values(TOWN_BLACKSMITH).flat());
  const crafted = Array.isArray(blacksmithSource.crafted) ? [...new Set(blacksmithSource.crafted.filter(id => recipeIds.has(id)))] : [];
  const enhancements = {};
  if (blacksmithSource.enhancements && typeof blacksmithSource.enhancements === 'object' && !Array.isArray(blacksmithSource.enhancements)) {
    for (const [uid, value] of Object.entries(blacksmithSource.enhancements)) if (/^\d+$/.test(uid) && Number.isSafeInteger(value)) enhancements[uid] = Math.max(0, value);
  }
  const story = {};
  for (const town of TOWNS) {
    const input = source.story?.[town.id], stage = Number.isSafeInteger(input?.stage) ? Math.max(0, Math.min(3, input.stage)) : 0;
    const storyProgress = {};
    if (input?.progress && typeof input.progress === 'object' && !Array.isArray(input.progress)) for (const [key, value] of Object.entries(input.progress)) if (Number.isSafeInteger(value)) storyProgress[key] = Math.max(0, value);
    story[town.id] = { stage, progress: storyProgress };
  }
  const day = typeof requestsSource.day === 'string' ? requestsSource.day.slice(0, 20) : '';
  const currentTownId = validTowns.has(source.currentTownId) && unlocked.has(source.currentTownId) ? source.currentTownId : 'oathhold';
  return { version: 2, currentTownId, unlockedTownIds: [...unlocked], purchased, learned, fields,
    requests: { day, active, completed, progress }, blacksmith: { crafted, enhancements }, story };
}
