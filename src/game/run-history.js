import { HEROES } from '../data/heroes.js';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { DUNGEONS, ARENA_RIVALS } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { conquestForRun, expeditionConquest } from '../data/expedition-conquests.js';
import { DIFFICULTIES } from './difficulty.js';
import { RIFT_RULES } from './journey-rifts.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : null;
const level = value => Number.isSafeInteger(value) && value >= 1 && value <= 80 ? value : null;
const hero = value => typeof value === 'string' && Object.hasOwn(HEROES, value) ? value : null;
const campaign = value => {
  const parts = typeof value === 'string' && /^([1-9]\d*)-([1-9]\d*)$/.exec(value);
  return parts && Number(parts[1]) <= CHAPTERS.length && Number(parts[2]) <= STAGES_PER_CHAPTER ? parts : null;
};

/** Only catalog identities survive saves; legacy floors cannot reveal the original expedition. */
export function normalizeRunRoute(value) {
  if (!object(value)) return null;
  if (value.kind === 'campaign') {
    if (!campaign(value.id)) return null;
    return { kind: 'campaign', id: value.id, difficultyId: typeof value.difficultyId === 'string' && Object.hasOwn(DIFFICULTIES, value.difficultyId) ? value.difficultyId : null };
  }
  if (value.kind !== 'dungeon' || !DUNGEONS.some(d => d.id === value.id) || !['standard', 'deep'].includes(value.depth)) return null;
  if (value.depth === 'deep' && !expeditionDepth(value.id)) return null;
  const conquestId = value.conquestId ?? null, riftId = value.riftId ?? null;
  if (conquestId !== null && !conquestForRun(value.id, value.depth, conquestId)) return null;
  if (riftId !== null && (value.depth !== 'standard' || conquestId || !RIFT_RULES.some(r => r.id === riftId))) return null;
  return { kind: 'dungeon', id: value.id, depth: value.depth, conquestId, riftId };
}

export function runRouteForStage(stage) {
  if (!stage || stage.party || stage.expedition?.kind === 'arena') return null;
  return normalizeRunRoute(stage.expedition
    ? { kind: stage.expedition.kind, id: stage.expedition.id, depth: stage.expedition.depth || 'standard', conquestId: stage.expedition.conquestId, riftId: stage.riftId }
    : { kind: 'campaign', id: stage.code, difficultyId: stage.difficultyId });
}

/** Unknown values remain missing instead of inventing zero-performance or manual-play evidence. */
export function normalizeRunDetails(value) {
  if (!object(value)) return null;
  const seconds = typeof value.timeSec === 'number' && Number.isFinite(value.timeSec) && value.timeSec >= 0 && value.timeSec <= 86400 ? value.timeSec : null;
  return { route: normalizeRunRoute(value.route), heroId: hero(value.heroId), heroLevel: level(value.heroLevel),
    control: ['manual', 'auto', 'mixed'].includes(value.control) ? value.control : 'unknown',
    perfects: count(value.perfects), breaks: count(value.breaks), timeSec: seconds };
}

export function runHistoryContext(stage, heroId, heroLevel) {
  const route = runRouteForStage(stage);
  return Object.freeze({ route: route && Object.freeze(route), heroId: hero(heroId), heroLevel: level(heroLevel) });
}

export function runDetailsForBattle(battle) {
  const context = battle.run?.historyContext;
  const seen = battle.run?.controlSeen;
  return normalizeRunDetails({ route: context?.route ?? runRouteForStage(battle.stage), heroId: context?.heroId ?? battle.heroId,
    heroLevel: context?.heroLevel ?? battle.growthStart?.level,
    control: seen === 1 ? 'manual' : seen === 2 ? 'auto' : seen === 3 ? 'mixed' : 'unknown',
    perfects: battle.run?.perfects, breaks: battle.run?.breaks, timeSec: battle.result?.time ?? battle.elapsed });
}

export function runRouteLabel(value) {
  const route = normalizeRunRoute(value);
  if (!route) return null;
  if (route.kind === 'campaign') {
    const [, ch, st] = campaign(route.id), stage = stageDef(Number(ch), Number(st));
    return `캠페인 ${route.id} · ${stage.title || stage.name}${route.difficultyId ? ` · ${DIFFICULTIES[route.difficultyId].name}` : ''}`;
  }
  const def = route.depth === 'deep' ? expeditionDepth(route.id) : DUNGEONS.find(d => d.id === route.id);
  return `${def.name} · ${route.depth === 'deep' ? '심층 원정' : '기본 원정'}${route.conquestId ? ` · ${expeditionConquest(route.conquestId).name}` : ''}${route.riftId ? ` · ${RIFT_RULES.find(r => r.id === route.riftId).name}` : ''}`;
}

export function runDetailsLabel(value) {
  const details = normalizeRunDetails(value);
  if (!details) return '상세 기록 없음 · 이전 출격의 영웅과 숙련 수치는 보존되지 않았습니다.';
  const name = details.heroId ? HEROES[details.heroId].name : '영웅 미기록';
  const controls = { manual: '수동', auto: 'AUTO', mixed: '수동·AUTO 혼합', unknown: '조작 미기록' };
  return `${name}${details.heroLevel ? ` · 출격 Lv.${details.heroLevel}` : ''} · ${controls[details.control]} · 시간 ${details.timeSec === null ? '미기록' : `${Math.floor(details.timeSec)}초`} · 정확 회피 ${details.perfects ?? '미기록'} · 균형 붕괴 ${details.breaks ?? '미기록'}`;
}

/** Read-only cost hint. Existing departure methods still own access, charging and refunds. */
export function retryEnergyForResult(result) {
  const depth = result.depth || 'standard';
  if (result.kind === 'arena') return ARENA_RIVALS.find(r => r.id === result.id)?.energy ?? null;
  if (result.kind !== 'dungeon' || !['standard', 'deep'].includes(depth)) return null;
  const def = depth === 'deep' ? expeditionDepth(result.id) : DUNGEONS.find(d => d.id === result.id);
  return def?.energy ?? null;
}
