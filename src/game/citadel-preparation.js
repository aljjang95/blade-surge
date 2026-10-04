import { DUNGEONS, CONSUMABLES } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { HEROES } from '../data/heroes.js';
import { frontierForRoute } from '../data/seasonal-content.js';
import { capturePersonalGoal, normalizePersonalGoal, summarizePersonalRuns } from './run-personal-goals.js';
import { runRouteLabel } from './run-history.js';
import { personalContextLabel, personalControlLabel } from '../ui/personal-goal-labels.js';
import { mapTacticsForStage } from '../data/map-tactics.js';

const definitions = (id, depth) => depth === 'deep' ? expeditionDepth(id) : DUNGEONS.find(def => def.id === id);
// Basic catalog stages include a roster callback. Preserve that callback while
// copying their plain data; this preview never passes its copy to Battle.start.
const copyDefinition = value => Array.isArray(value) ? value.map(copyDefinition)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyDefinition(item)])) : value;
const sameRoute = (left, right) => left?.kind === right.kind && left.id === right.id && left.depth === right.depth
  && left.conquestId === right.conquestId && left.riftId === right.riftId;

function accessFor(app, definition, depth) {
  const energy = app.eco?.s?.energy;
  const access = app.expedition?.dungeonAccess?.(definition.id, { depth });
  let error = !access?.ok ? access?.error || '출격 준비 상태를 확인해 주세요.' : '';
  if (!error && app.expedition.s.pending) error = '진행 중인 전투를 먼저 마쳐 주세요.';
  if (!error && app.expeditionUI?.result?.saveError) error = '전리품 정산을 먼저 저장해 주세요.';
  if (!error && app.party?.party?.status === 'lobby') error = '파티 준비를 마친 뒤 개인 원정을 선택해 주세요.';
  if (!error && (app.stageStarting || app.battle?.active || (app.mode && app.mode !== 'lobby'))) error = '진행 중인 출격을 먼저 마쳐 주세요.';
  if (!error && app.eco?.storageStatus === 'unavailable') error = '저장 공간을 확인해 주세요.';
  if (!error && (!Number.isFinite(energy) || energy < definition.energy)) error = `에너지가 부족합니다. 보유 ${Number.isFinite(energy) ? energy : 0} / 필요 ${definition.energy}`;
  return { ok: !error, error, energy: Number.isFinite(energy) ? energy : null, cost: definition.energy };
}

function goalFor(state, currentContext) {
  const saved = normalizePersonalGoal(state?.personalGoal);
  if (!saved) return { selected: false, status: 'none', context: null, routeLabel: '', contextLabel: '',
    metric: null, baseline: null, target: null, matches: false, mismatches: [], comparisonCount: 0 };
  const context = saved.context, mismatches = [];
  if (!sameRoute(context.route, currentContext.route)) mismatches.push('route');
  if (context.heroId !== currentContext.heroId) mismatches.push('hero');
  if (context.heroLevel !== currentContext.heroLevel) mismatches.push('level');
  if (context.control !== currentContext.control) mismatches.push('control');
  const receipt = capturePersonalGoal(state), summary = summarizePersonalRuns(state.history, context);
  const matches = mismatches.length === 0;
  return { selected: true,
    status: !receipt ? summary.count ? 'no-target' : 'no-baseline' : matches ? 'matching' : 'mismatch',
    context, routeLabel: runRouteLabel(context.route), contextLabel: personalContextLabel(context), metric: saved.metric,
    baseline: receipt?.baseline ?? null, target: receipt?.target ?? null, matches, mismatches, comparisonCount: summary.count };
}

/** Read-only gate preview. Existing departure, settlement and consumption methods retain every write. */
export function citadelPreparation(app, routeId, depth = 'standard') {
  if (!DUNGEONS.some(def => def.id === routeId)) return { ok: false, error: '알 수 없는 던전입니다.', routeId, depth };
  if (!['standard', 'deep'].includes(depth)) return { ok: false, error: '알 수 없는 원정 단계입니다.', routeId, depth };
  const definition = definitions(routeId, depth);
  if (!definition) return { ok: false, error: '이 지역에는 해당 원정 단계가 없습니다.', routeId, depth };
  const state = app.eco?.s || {}, heroId = state.selected, heroState = state.heroes?.[heroId];
  const control = state.journey?.autoBattle === true ? 'auto' : 'manual';
  const hero = { id: heroId ?? null, name: HEROES[heroId]?.name || '영웅 미선택', level: heroState?.level ?? null,
    control, controlLabel: personalControlLabel(control) };
  const route = { kind: 'dungeon', id: routeId, depth, conquestId: null, riftId: null };
  const expedition = app.expedition?.s || {};
  return { ok: true, routeId, depth, definition: copyDefinition(definition), access: accessFor(app, definition, depth),
    depthOptions: ['standard', 'deep'].flatMap(option => {
      const def = definitions(routeId, option);
      return def ? [{ depth: option, label: option === 'deep' ? '심층 원정' : '기본 원정',
        definition: copyDefinition(def), access: accessFor(app, def, option) }] : [];
    }),
    hero,
    mapTactics: mapTacticsForStage({ expedition: route }),
    potions: CONSUMABLES.map((potion, index) => ({ id: potion.id, name: potion.name, description: potion.description,
      key: ['U', 'I', 'O'][index], count: expedition.consumables?.[potion.id] ?? 0 })),
    // Authored fixed payout only: field loot, seasonal adjustments and account-level bonuses are separate.
    rewards: { base: structuredClone(definition.rewards), firstClear: depth === 'deep'
      ? { eligible: expedition.depthWins?.[routeId] === 0, rewards: structuredClone(definition.firstRewards) } : null },
    frontier: depth === 'standard' ? frontierForRoute(routeId) : null,
    personalGoal: goalFor(state.masterworks, { route, heroId, heroLevel: hero.level, control }) };
}
