import { DUNGEONS, accountLevelXp } from '../data/expansion.js';

/** 정산된 기존 진행과 해금 판정만 읽는다. 지도를 보거나 선택해도 저장을 바꾸지 않는다. */
export function dungeonJourney(service) {
  const nodes = DUNGEONS.map((dungeon, index) => {
    const access = service.dungeonAccess(dungeon.id, { depth: 'standard' });
    const wins = service.s.stats[dungeon.id] || 0;
    return { dungeon, index, wins, cleared: wins > 0, unlocked: access.ok, reason: access.error };
  });
  const current = nodes.find(node => !node.cleared) || nodes.find(node => node.unlocked);
  return { nodes, current, cleared: nodes.filter(node => node.cleared).length,
    nextLocked: nodes.find(node => !node.unlocked && !node.cleared) };
}

export function dungeonContinuation(service, result) {
  if (!result?.win || result.saveError || result.kind !== 'dungeon' || result.depth !== 'standard' || result.riftId || result.conquestId) return null;
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
