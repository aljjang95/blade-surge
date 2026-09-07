import { normalizeSave as normalizeBaseSave } from './save-base.js';
import { ENEMIES } from '../data/stages.js';
import { normalizeRpg } from './rpg-core.js';

/** Additive migration: inventory, currency, campaign and hero records retain their existing validation. */
export function normalizeSave(raw, fresh) {
  const save = normalizeBaseSave(raw, fresh);
  save.rpg = normalizeRpg(raw.rpg, Object.keys(ENEMIES));
  return save;
}
