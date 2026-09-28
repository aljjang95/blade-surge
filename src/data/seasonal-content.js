/**
 * 시즌 프론티어는 표시 문구와 실제 전투·정산 효과를 같은 계약으로 가진다.
 * 출격 ticket에는 이 계약의 스냅샷을 저장해 주간이 바뀌어도 시작 시점의
 * 효과로 정산한다. 목록에 없는 효과를 문구만으로 추가하지 않는다.
 */
export const FRONTIER_EFFECTS = Object.freeze({
  potion_heal: Object.freeze({ id: 'potion_heal', kind: 'potionHealMultiplier', value: 1.2, label: '회복 물약 효과 +20%' }),
  treasure_material: Object.freeze({ id: 'treasure_material', kind: 'treasureMaterialBonus', value: 1, label: '보물방 재료 +1' }),
  telegraph_lead: Object.freeze({ id: 'telegraph_lead', kind: 'telegraphLead', value: 0.3, label: '지역·보스 문양 경고 +0.3초' }),
  elite_exp: Object.freeze({ id: 'elite_exp', kind: 'eliteXpMultiplier', value: 1.25, label: '정예 처치 EXP +25%' }),
  route_material: Object.freeze({ id: 'route_material', kind: 'routeMaterialBonus', value: 2, label: '지역 재료 보상 +2' }),
  route_speed: Object.freeze({ id: 'route_speed', kind: 'moveSpeedMultiplier', value: 1.1, label: '출격 이동속도 +10%' }),
  warning_color: Object.freeze({ id: 'warning_color', kind: 'warningColor', value: 0x78f7ff, label: '지역·보스 문양 경고를 청록색으로 강조' }),
  counter_window: Object.freeze({ id: 'counter_window', kind: 'bossCounterWindow', value: 0.25, label: '완벽 회피 반격 창 +0.25초' }),
  first_room_guard: Object.freeze({ id: 'first_room_guard', kind: 'firstRoomDamageMultiplier', value: 0.85, label: '첫 전투 방 정화 전 받는 피해 -15%' }),
  hazard_radius: Object.freeze({ id: 'hazard_radius', kind: 'hazardRadiusMultiplier', value: 0.9, label: '지역 위험 문양의 반경·띠 너비 -10%' }),
  projectile_guard: Object.freeze({ id: 'projectile_guard', kind: 'projectileDamageMultiplier', value: 0.85, label: '적 투사체 피해 -15%' }),
  boss_hunt: Object.freeze({ id: 'boss_hunt', kind: 'bossStatMultiplier', value: 0.92, label: '보스 체력 -8%' }),
  perfect_reset: Object.freeze({ id: 'perfect_reset', kind: 'perfectCooldownReduction', value: 1, label: '완벽 회피 시 일반 스킬 대기시간 -1초' }),
  ash_drop: Object.freeze({ id: 'ash_drop', kind: 'goldPerKill', value: 2, label: '처치 골드 +2' }),
  final_reward: Object.freeze({ id: 'final_reward', kind: 'rewardMultiplier', value: 2, label: '기본 완료 골드·EXP·재료·물약 2배' }),
  signature_lead: Object.freeze({ id: 'signature_lead', kind: 'bossSignatureLead', value: 0.2, label: '보스 시그니처 경고 +0.2초' }),
});

const EFFECT_IDS = Object.freeze([
  ['potion_heal', 'treasure_material'], ['telegraph_lead', 'elite_exp'],
  ['route_material', 'route_speed'], ['warning_color', 'counter_window'],
  ['first_room_guard', 'hazard_radius'], ['projectile_guard', 'final_reward'],
  ['hazard_radius', 'treasure_material'], ['boss_hunt', 'counter_window'],
  ['warning_color', 'projectile_guard'], ['boss_hunt', 'perfect_reset'],
  ['ash_drop', 'route_material'], ['final_reward', 'signature_lead'],
]);

export const SEASONAL_SEASONS = Object.freeze([
  { id: 'bell-thaw', name: '종의 해빙', months: [0], routes: ['verdigris_sanctum', 'glass_garden'], effectIds: EFFECT_IDS[0], tagline: '얼어붙은 종문이 다시 울립니다.' },
  { id: 'ember-rise', name: '잿불의 상승', months: [1], routes: ['ashforge_catacomb', 'ember_vault'], effectIds: EFFECT_IDS[1], tagline: '꺼지지 않는 망치가 지하를 깨웁니다.' },
  { id: 'starfall', name: '별비의 기록', months: [2], routes: ['comet_bastion', 'star_archive'], effectIds: EFFECT_IDS[2], tagline: '기록되지 않은 별이 첨탑에 떨어집니다.' },
  { id: 'tidewake', name: '밀물의 각성', months: [3], routes: ['sable_mirage_basin', 'cinder_tide_lock'], effectIds: EFFECT_IDS[3], tagline: '검은 수문 너머에서 역류가 깨어납니다.' },
  { id: 'crown-bloom', name: '왕관의 개화', months: [4], routes: ['verdigris_sanctum', 'nightglass_observatory'], effectIds: EFFECT_IDS[4], tagline: '빈 왕관에 새 싹이 돋습니다.' },
  { id: 'homecoming', name: '귀환의 달', months: [5], routes: ['comet_bastion', 'astral_leviathan_spire'], effectIds: EFFECT_IDS[5], tagline: '돌아오는 길을 함께 잇습니다.' },
  { id: 'glass-monsoon', name: '유리 장마', months: [6], routes: ['sable_mirage_basin', 'bellfall_crypt'], effectIds: EFFECT_IDS[6], tagline: '비처럼 쏟아지는 유리 조각을 뚫습니다.' },
  { id: 'forge-longnight', name: '제련 장야', months: [7], routes: ['ashforge_catacomb', 'comet_bastion'], effectIds: EFFECT_IDS[7], tagline: '긴 밤에도 불씨는 꺼지지 않습니다.' },
  { id: 'observatory-wind', name: '관측소의 바람', months: [8], routes: ['astral_leviathan_spire', 'verdigris_sanctum'], effectIds: EFFECT_IDS[8], tagline: '거꾸로 흐르는 별바람을 읽습니다.' },
  { id: 'eclipse-hunt', name: '일식 사냥', months: [9], routes: ['eclipse_hydra_vault', 'sable_mirage_basin'], effectIds: EFFECT_IDS[9], tagline: '해가 사라진 짧은 틈을 노립니다.' },
  { id: 'ash-memorial', name: '재의 추모', months: [10], routes: ['ashforge_catacomb', 'verdigris_sanctum'], effectIds: EFFECT_IDS[10], tagline: '남은 온기를 다음 사람에게 돌려줍니다.' },
  { id: 'last-constellation', name: '마지막 성좌', months: [11], routes: ['comet_bastion', 'nightglass_observatory'], effectIds: EFFECT_IDS[11], tagline: '한 해의 모든 기록이 한 줄로 이어집니다.' },
].map(season => Object.freeze({ ...season })));

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const UTC_YEAR_START = year => Date.UTC(year, 0, 1);
const asDate = value => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

export function seasonForDate(date = new Date()) {
  const month = asDate(date).getUTCMonth();
  return SEASONAL_SEASONS.find(season => season.months.includes(month)) || SEASONAL_SEASONS[0];
}

export function frontierEffect(effectId) { return typeof effectId === 'string' && Object.hasOwn(FRONTIER_EFFECTS, effectId) ? FRONTIER_EFFECTS[effectId] : null; }

export function weeklyFrontier(date = new Date()) {
  const d = asDate(date), year = d.getUTCFullYear(), season = seasonForDate(d);
  const week = Math.max(0, Math.floor((d.getTime() - UTC_YEAR_START(year)) / MS_PER_WEEK));
  const index = week % season.routes.length;
  const effect = frontierEffect(season.effectIds[index]);
  return Object.freeze({ year, seasonId: season.id, name: season.name, tagline: season.tagline,
    routeId: season.routes[index], week, effectId: effect.id, modifier: effect.label, effects: effect });
}

/** 현재 주간 프론티어 route에서만 활성화한다. 다른 던전은 효과를 빌려 쓰지 않는다. */
export function frontierForRoute(routeId, date = new Date()) {
  const frontier = weeklyFrontier(date);
  return frontier.routeId === routeId ? frontier : null;
}

export function frontierSnapshot(frontier) {
  const valid = frontierFromSnapshot(frontier);
  if (!valid) return null;
  return Object.freeze({ year: valid.year, seasonId: valid.seasonId, week: valid.week, routeId: valid.routeId, effectId: valid.effectId });
}

/** 저장 ticket의 시즌·주·route·효과 조합이 authored 목록과 일치하는지 확인한다. */
export function frontierFromSnapshot(snapshot) {
  const season = SEASONAL_SEASONS.find(item => item.id === snapshot?.seasonId);
  if (!season || !Number.isSafeInteger(snapshot?.year) || snapshot.year < 1970 || snapshot.year > 9999 ||
      !Number.isSafeInteger(snapshot.week) || snapshot.week < 0 || snapshot.week > 52 ||
      typeof snapshot.routeId !== 'string' || typeof snapshot.effectId !== 'string') return null;
  const weekStart = UTC_YEAR_START(snapshot.year) + snapshot.week * MS_PER_WEEK;
  const monthStart = Date.UTC(snapshot.year, season.months[0], 1);
  const monthEnd = Date.UTC(snapshot.year, season.months[0] + 1, 1);
  if (weekStart >= monthEnd || weekStart + MS_PER_WEEK <= monthStart) return null;
  const index = snapshot.week % season.routes.length;
  if (season.routes[index] !== snapshot.routeId || season.effectIds[index] !== snapshot.effectId) return null;
  const effect = frontierEffect(snapshot.effectId);
  return Object.freeze({ year: snapshot.year, seasonId: season.id, week: snapshot.week, routeId: snapshot.routeId,
    effectId: effect.id, modifier: effect.label, effects: effect });
}

/** Seasonal effects belong to solo standard expeditions only. */
export function frontierEffectForStage(stage) {
  if (stage?.party || stage?.riftId || stage?.expedition?.kind !== 'dungeon' ||
      stage.expedition.depth !== 'standard' || stage.expedition.conquestId) return null;
  const frontier = frontierFromSnapshot(stage.frontier);
  return frontier?.routeId === stage.expedition.id ? frontier.effects : null;
}

const TREASURE_LIMITS = Object.freeze({ glass_garden: 1, bellfall_crypt: 2 });
const boundedRooms = (value, routeId) => Number.isSafeInteger(value) && value >= 0 ? Math.min(TREASURE_LIMITS[routeId] || 0, value) : 0;

/** 정산·소탕이 같은 ticket 효과를 사용하도록 보상 적용을 한곳에 둔다. */
export function applyFrontierRewards(rewards, frontier, { treasureRooms = 0 } = {}) {
  const out = structuredClone(rewards || {}), active = frontierFromSnapshot(frontier), effect = active?.effects;
  if (!effect) return out;
  const material = Object.keys(out.materials || {})[0];
  if (effect.kind === 'treasureMaterialBonus' && material) out.materials[material] += boundedRooms(treasureRooms, active.routeId) * effect.value;
  else if (effect.kind === 'routeMaterialBonus' && material) out.materials[material] += effect.value;
  else if (effect.kind === 'rewardMultiplier') {
    for (const key of ['gold', 'xp', 'rating']) if (Number.isFinite(out[key])) out[key] = Math.floor(out[key] * effect.value);
    for (const values of [out.materials, out.consumables]) for (const key of Object.keys(values || {})) values[key] = Math.floor(values[key] * effect.value);
  }
  return out;
}
