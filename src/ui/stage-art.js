import { ENEMIES } from '../data/stages.js';
import { resolveEnemyPortrait } from '../data/encounter-art.js';

/** 스테이지 대표 보스 초상. meta.js 의 stageKeyArt 와 같은 규칙이며 meta.js 전체를 끌어오지 않으려고 따로 둔다. */
export const stageKeyArtOf = (stage) => {
  const id = stage.dungeonBossId || stage.encounter?.dungeonBossId || stage.encounter?.enemyId;
  return resolveEnemyPortrait(id, ENEMIES[id]);
};
