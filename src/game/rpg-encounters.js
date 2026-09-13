import { CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';
import { DUNGEONS, ARENA_RIVALS } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { RIFT_RULES } from './journey-rifts.js';

export const CAMPAIGN_FLOOR_CAP = CHAPTERS.length * STAGES_PER_CHAPTER;

/** @typedef {{kind:'campaign',floor:number}|{kind:'dungeon',id:string,depth:'standard'|'deep',riftId?:string}|{kind:'arena',id:string}} Encounter */

/** Only catalogue identifiers are stored. Titles always come from shipped content.
 * @returns {Encounter|null}
 */
export function normalizeEncounter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, 'kind')) return null;
  if (raw.kind === 'campaign') return Object.hasOwn(raw, 'floor') && Number.isSafeInteger(raw.floor) && raw.floor >= 1 && raw.floor <= CAMPAIGN_FLOOR_CAP
    ? { kind: 'campaign', floor: raw.floor } : null;
  if (!Object.hasOwn(raw, 'id')) return null;
  if (raw.kind === 'dungeon' && Object.hasOwn(raw, 'depth') && DUNGEONS.some(d => d.id === raw.id) && ['standard', 'deep'].includes(raw.depth)
    && (raw.depth !== 'deep' || expeditionDepth(raw.id))) {
    const location = { kind: 'dungeon', id: raw.id, depth: raw.depth };
    if (Object.hasOwn(raw, 'riftId') && raw.riftId != null) {
      if (raw.depth !== 'standard' || !RIFT_RULES.some(r => r.id === raw.riftId)) return null;
      location.riftId = raw.riftId;
    }
    return location;
  }
  if (raw.kind === 'arena' && ARENA_RIVALS.some(r => r.id === raw.id)) return { kind: 'arena', id: raw.id };
  return null;
}

export function normalizeExpeditionEncounter(raw) {
  const encounter = normalizeEncounter(raw);
  return encounter?.kind !== 'campaign' ? encounter : null;
}

export function stageExpeditionEncounter(stage) {
  return stage?.expedition ? normalizeExpeditionEncounter({ ...stage.expedition, ...(stage.riftId ? { riftId: stage.riftId } : {}) }) : null;
}

export function encounterLocationLabel(raw) {
  const encounter = normalizeEncounter(raw);
  if (!encounter) return null;
  if (encounter.kind === 'campaign') {
    const chapter = CHAPTERS[Math.floor((encounter.floor - 1) / STAGES_PER_CHAPTER)];
    return chapter.id + '-' + (((encounter.floor - 1) % STAGES_PER_CHAPTER) + 1) + ' · ' + chapter.name;
  }
  if (encounter.kind === 'arena') return 'AI 결투 · ' + ARENA_RIVALS.find(r => r.id === encounter.id).name;
  if (encounter.riftId) return DUNGEONS.find(d => d.id === encounter.id).name + ' · ' + RIFT_RULES.find(r => r.id === encounter.riftId).name;
  return encounter.depth === 'deep' ? '심층 · ' + expeditionDepth(encounter.id).name
    : '원정 · ' + DUNGEONS.find(d => d.id === encounter.id).name;
}

export function encounterLevelLabel(stage, level) {
  if (stage?.party) return '파티';
  const encounter = stageExpeditionEncounter(stage);
  if (encounter?.kind === 'arena') return 'AI 결투';
  if (encounter?.kind === 'dungeon') return encounter.riftId ? '균열' : encounter.depth === 'deep' ? '심층' : '원정';
  return 'Lv.' + (Number.isSafeInteger(level) && level > 0 ? level : 1);
}
