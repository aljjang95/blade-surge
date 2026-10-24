import { ALL_DUNGEONS as DUNGEONS, accountLevelXp } from '../data/expansion.js';

/** 정산된 기존 진행과 해금 판정만 읽는다. 지도를 보거나 선택해도 저장을 바꾸지 않는다. */
// 지역 마을이 아직 열리지 않은 던전은 여정·카드·추천에서 뺀다. 순서는 현재 마을 지역 → 다른 열린 지역 → 소급 보존.
// 판정을 모르는 서비스(테스트 대역 등)는 기존처럼 전체 목록이다.
export function dungeonJourney(service) {
  const regions = service.regionDungeons?.() || null;
  const byId = new Map(DUNGEONS.map(dungeon => [dungeon.id, dungeon]));
  /** @type {ReadonlyArray<(typeof DUNGEONS)[number]>} */
  const list = regions ? /** @type {any[]} */ (regions.visibleIds.map(id => byId.get(id)).filter(Boolean)) : DUNGEONS;
  const nodes = list.map((dungeon, index) => {
    const access = service.dungeonAccess(dungeon.id, { depth: 'standard' });
    const wins = service.s.stats[dungeon.id] || 0;
    return { dungeon, index, wins, cleared: wins > 0, unlocked: access.ok, reason: access.error, region: regions?.byId[dungeon.id]?.region || 0 };
  });
  // 추천: 입장 가능한 첫 미정복 → 첫 미정복(잠금 사유 표시) → 입장 가능한 첫 던전. 보이지 않는 던전은 후보가 아니다.
  const current = nodes.find(node => !node.cleared && node.unlocked) || nodes.find(node => !node.cleared) || nodes.find(node => node.unlocked);
  const teaser = regions?.teaser ? { ...regions.teaser, dungeons: regions.teaserIds.map(id => byId.get(id)).filter(Boolean) } : null;
  return { nodes, current, cleared: nodes.filter(node => node.cleared).length,
    nextLocked: nodes.find(node => !node.unlocked && !node.cleared), teaser, currentRegion: regions?.current || 1 };
}

export function dungeonContinuation(service, result) {
  if (!result?.win || result.saveError || result.kind !== 'dungeon' || result.depth !== 'standard' || result.riftId || result.conquestId) return null;
  if (!DUNGEONS.some(dungeon => dungeon.id === result.id)) return null;
  const current = dungeonJourney(service).current;
  if (!current || current.cleared || current.dungeon.id === result.id) return null;
  if (current.unlocked) return { ...current.dungeon, claimQuestIds: [], claimXp: 0 };
  // 다음 지역에 필요한 경험치만 기존의 수령 가능한 무료 퀘스트에서 계산한다.
  // 미리보기는 정산하지 않는다. 실제 지급은 다음 버튼의 명시적 터치에서만 실행한다.
  let level = service.s.level, xp = service.s.xp, claimXp = 0;
  const claimQuestIds = [];
  const quests = service.snapshot().quests.filter(quest => quest.ready && !quest.claimed && quest.rewards.xp > 0)
    .sort((a, b) => b.rewards.xp - a.rewards.xp);
  for (const quest of quests) {
    xp += quest.rewards.xp; claimXp += quest.rewards.xp; claimQuestIds.push(quest.id);
    while (level < 50 && xp >= accountLevelXp(level)) { xp -= accountLevelXp(level); level++; }
    if (level >= current.dungeon.minLevel) return { ...current.dungeon, claimQuestIds, claimXp };
  }
  return null;
}
