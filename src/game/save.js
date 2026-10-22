import { normalizeSave as normalizeBaseSave } from './save-base.js';
import { ENEMIES } from '../data/stages.js';
import { normalizeRpg } from './rpg-core.js';
import { normalizeMasterworks } from './masterworks-core.js';
import { normalizeJourney } from './journey-core.js';
import { normalizeArsenal } from './arsenal-core.js';
import { normalizeEndgame, migrateEndgame } from './endgame-core.js';

/** Additive migration: inventory, currency, campaign and hero records retain their existing validation. */
export function normalizeSave(raw, fresh) {
  const save = normalizeBaseSave(raw, fresh);
  save.rpg = normalizeRpg(raw.rpg, Object.keys(ENEMIES));
  save.masterworks = normalizeMasterworks(raw.masterworks);
  save.journey = normalizeJourney(raw.journey);
  save.arsenal = normalizeArsenal(raw.arsenal);
  // 엔드게임 도입 전 저장은 별점(스토리 클리어)과 최근 전투 기록의 난이도 승리를 최고 난이도 기록으로 이월한다.
  save.endgame = raw.endgame && typeof raw.endgame === 'object' ? normalizeEndgame(raw.endgame) : migrateEndgame(save);
  return save;
}
