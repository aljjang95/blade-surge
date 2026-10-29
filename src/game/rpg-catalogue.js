import { ENEMIES, CHAPTERS, STAGES_PER_CHAPTER, chapterSpeciesSwap, stageDef } from '../data/stages.js';
import { monsterLevel, monsterStats, monsterXp } from './rpg-core.js';

/** Derived from shipped encounters, not a second monster database. */
export function buildCatalogue() {
  const entries = new Map(Object.entries(ENEMIES).map(([id, def]) => [id, { id, def, locations: [] }]));
  for (const ch of CHAPTERS) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(ch.id, st), roster = stage.rosterFor();
    // 장 전용 종(CHAPTER_SPECIES: 1~7장 Tripo 몸)은 보상 명단의 원래 적 자리에 실제로 나오므로 출현 위치를 함께 잡는다.
    // 6장(잔향)은 경로의 고향 장 몸도 함께 나온다(chapterSpeciesSwap).
    const swap = chapterSpeciesSwap(ch.id, stage.dungeon.id) || {};
    const base = [...roster.trash, ...roster.ranged, ...roster.elite];
    const ids = new Set([...base, ...base.filter(id => swap[id]).map(id => swap[id]), stage.dungeonBossId || stage.encounter.enemyId]);
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
