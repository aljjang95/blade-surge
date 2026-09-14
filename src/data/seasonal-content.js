/**
 * Twelve deterministic seasonal frontiers keep the expedition board moving
 * without making a player's progress depend on a server clock.  Each season
 * rotates authored routes and a readable modifier; the battle simulation
 * remains local and the same date always resolves to the same offer.
 */
export const SEASONAL_SEASONS = Object.freeze([
  { id: 'bell-thaw', name: '종의 해빙', months: [0], routes: ['bellfall_crypt', 'glass_garden'], modifiers: ['첫 공명 뒤 회복 물약 효과 +20%', '보물방 재료 +1'], tagline: '얼어붙은 종문이 다시 울립니다.' },
  { id: 'ember-rise', name: '잿불의 상승', months: [1], routes: ['ashforge_catacomb', 'ember_vault'], modifiers: ['과열 경고가 0.3초 더 길어집니다', '엘리트 처치 EXP +25%'], tagline: '꺼지지 않는 망치가 지하를 깨웁니다.' },
  { id: 'starfall', name: '별비의 기록', months: [2], routes: ['astral_leviathan_spire', 'star_archive'], modifiers: ['별빛 파편 획득량 +2', '외곽 고리 이동속도 +10%'], tagline: '기록되지 않은 별이 첨탑에 떨어집니다.' },
  { id: 'tidewake', name: '밀물의 각성', months: [3], routes: ['eclipse_hydra_vault', 'cinder_tide_lock'], modifiers: ['물결 경고가 색으로 강조됩니다', '보스 반격 창 +0.25초'], tagline: '검은 수문 너머에서 역류가 깨어납니다.' },
  { id: 'crown-bloom', name: '왕관의 개화', months: [4], routes: ['glass_garden', 'nightglass_observatory'], modifiers: ['정화 제단 체류 보너스 2배', '첫 방 피해 -15%'], tagline: '빈 왕관에 새 싹이 돋습니다.' },
  { id: 'homecoming', name: '귀환의 달', months: [5], routes: ['bellfall_crypt', 'astral_leviathan_spire'], modifiers: ['동료 부활 대기시간 -20%', '마지막 방 골드 +30%'], tagline: '돌아오는 길을 함께 잇습니다.' },
  { id: 'glass-monsoon', name: '유리 장마', months: [6], routes: ['eclipse_hydra_vault', 'bellfall_crypt'], modifiers: ['파편 폭발 범위 -10%', '보물방 등장 확률 +15%'], tagline: '비처럼 쏟아지는 유리 조각을 뚫습니다.' },
  { id: 'forge-longnight', name: '제련 장야', months: [7], routes: ['ashforge_catacomb', 'cinder_tide_lock'], modifiers: ['연속 타격 20회마다 과충전', '용광로 방벽 피해 -12%'], tagline: '긴 밤에도 불씨는 꺼지지 않습니다.' },
  { id: 'observatory-wind', name: '관측소의 바람', months: [8], routes: ['astral_leviathan_spire', 'nightglass_observatory'], modifiers: ['기록 파편이 안전지대를 표시합니다', '원거리 적 투사체 -15%'], tagline: '거꾸로 흐르는 별바람을 읽습니다.' },
  { id: 'eclipse-hunt', name: '일식 사냥', months: [9], routes: ['eclipse_hydra_vault', 'star_archive'], modifiers: ['보스 체력 -8%, 공격속도 +8%', '완벽 회피 시 재사용 대기시간 -1초'], tagline: '해가 사라진 짧은 틈을 노립니다.' },
  { id: 'ash-memorial', name: '재의 추모', months: [10], routes: ['ashforge_catacomb', 'ember_vault'], modifiers: ['쓰러진 적이 잿불을 남깁니다', '소모품 제작 비용 -15%'], tagline: '남은 온기를 다음 사람에게 건넵니다.' },
  { id: 'last-constellation', name: '마지막 성좌', months: [11], routes: ['astral_leviathan_spire', 'nightglass_observatory'], modifiers: ['마지막 별자리 보상 2배', '보스 시그니처 경고 +0.2초'], tagline: '한 해의 모든 기록이 한 줄로 이어집니다.' },
]);

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const UTC_YEAR_START = year => Date.UTC(year, 0, 1);

export function seasonForDate(date = new Date()) {
  const month = date instanceof Date ? date.getUTCMonth() : new Date(date).getUTCMonth();
  return SEASONAL_SEASONS.find(season => season.months.includes(month)) || SEASONAL_SEASONS[0];
}

export function weeklyFrontier(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const season = seasonForDate(d);
  const week = Math.max(0, Math.floor((d.getTime() - UTC_YEAR_START(d.getUTCFullYear())) / MS_PER_WEEK));
  const routeId = season.routes[week % season.routes.length];
  const modifier = season.modifiers[week % season.modifiers.length];
  return Object.freeze({ seasonId: season.id, name: season.name, tagline: season.tagline, routeId, modifier, week });
}
