import { ENEMIES, CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { monsterLevel, monsterStats, monsterXp } from './rpg-core.js';

/** Derived from shipped encounters, not a second monster database. */
export function buildCatalogue() {
  const entries = new Map(Object.entries(ENEMIES).map(([id, def]) => [id, { id, def, locations: [] }]));
  for (const ch of CHAPTERS) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(ch.id, st), roster = stage.rosterFor();
    // 전투 방 편성(combatRosterFor)이 장 전용 종(1·2장 Tripo 몸)으로 바꾼 적도 실제 출현 위치로 잡는다.
    const combat = stage.combatRosterFor?.();
    const ids = new Set([...roster.trash, ...roster.ranged, ...roster.elite, ...(combat ? [...combat.trash, ...combat.ranged, ...combat.elite] : []), stage.dungeonBossId || stage.encounter.enemyId]);
    for (const id of ids) {
      const entry = entries.get(id);
      if (entry) entry.locations.push({ floor: stage.idx, code: stage.code, chapter: ch.name, chapterId: ch.id, scale: stage.scale });
    }
  }
  return [...entries.values()].map(entry => {
    const first = entry.locations[0];
    return { ...entry, rank: entry.def.boss ? '보스' : entry.def.elite ? '정예' : '일반',
      level: monsterLevel(first?.floor || 1, entry.def),
      stats: monsterStats(entry.def, first?.scale || 1),
      xp: monsterXp(entry.def, first?.scale || 1),
      reference: first ? `${first.code} 기준` : '기본 데이터 기준' };
  });
}
