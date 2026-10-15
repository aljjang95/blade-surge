// 던전 우선 로비의 읽기 전용 모델. 저장된 진행·해금·최근 원정 기록만 읽고 아무것도 쓰지 않는다.
// 추천 정책: 최근 실제 원정 경로가 지금 입장 가능하면 그것, 아니면 던전 여정의 다음 던전.
import { ALL_DUNGEONS as DUNGEONS, MATERIALS } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { normalizeRunRoute } from '../game/run-history.js';
import { dungeonJourney } from './dungeon-journey.js';

export const LANDING_REASON_LABEL = Object.freeze({
  recent: '최근 원정',
  journey: '추천 던전',
  fallback: '추천 던전',
  none: '던전',
});

/** 원정 기록(masterworks.history)의 마지막 던전 경로. 캠페인·결투장·손상 기록은 건너뛴다. */
export function recentDungeonRun(history) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const route = normalizeRunRoute(entry?.details?.route);
    if (route?.kind !== 'dungeon') continue;
    return { route, outcome: entry.outcome === 'victory' ? 'victory' : 'defeat' };
  }
  return null;
}

const definitionFor = (id, depth) => depth === 'deep' ? expeditionDepth(id) : DUNGEONS.find((dungeon) => dungeon.id === id);

/**
 * @param {{ expedition: { s: any, dungeonAccess: (id: string, options: { depth: string }) => { ok: boolean, error?: string|null } }, history?: unknown, energy?: number }} input
 */
export function dungeonLanding({ expedition, history, energy }) {
  const journey = dungeonJourney(expedition);
  const recent = recentDungeonRun(history);
  const open = journey.nodes.filter((node) => node.unlocked).length;
  let pick = null, notice = '';
  if (recent) {
    const dungeon = DUNGEONS.find((entry) => entry.id === recent.route.id);
    const access = dungeon ? expedition.dungeonAccess(dungeon.id, { depth: recent.route.depth }) : null;
    if (dungeon && access?.ok) pick = { dungeon, depth: recent.route.depth, reason: 'recent' };
    else if (dungeon) notice = `최근 원정 ${dungeon.name}${recent.route.depth === 'deep' ? ' 심층' : ''}은 지금 입장할 수 없습니다. ${access?.error || ''}`.trim();
  }
  if (!pick && journey.current) pick = { dungeon: journey.current.dungeon, depth: 'standard', reason: recent ? 'fallback' : 'journey' };
  if (!pick) return { dungeon: null, depth: 'standard', reason: 'none', label: LANDING_REASON_LABEL.none, notice, open, total: DUNGEONS.length, cleared: journey.cleared };
  const definition = definitionFor(pick.dungeon.id, pick.depth) || pick.dungeon;
  const access = expedition.dungeonAccess(pick.dungeon.id, { depth: pick.depth });
  const cost = Number(definition.energy) || 0;
  const current = Number.isFinite(energy) ? Number(energy) : null;
  const rewards = Object.entries(definition.rewards?.materials || {}).map(([id, amount]) => ({
    id, amount, name: MATERIALS.find((material) => material.id === id)?.name || id,
  }));
  const node = journey.nodes.find((entry) => entry.dungeon.id === pick.dungeon.id);
  return {
    dungeon: pick.dungeon,
    depth: pick.depth,
    depthLabel: pick.depth === 'deep' ? '심층 원정' : '기본 원정',
    name: definition.name || pick.dungeon.name,
    art: definition.art || pick.dungeon.art,
    accent: definition.accent || pick.dungeon.accent || '#d9c5a0',
    description: definition.description || pick.dungeon.description || '',
    reason: pick.reason,
    label: LANDING_REASON_LABEL[pick.reason],
    outcome: pick.reason === 'recent' ? recent.outcome : null,
    notice,
    unlocked: !!access?.ok,
    lockReason: access?.ok ? '' : access?.error || '입장 조건을 확인해 주세요.',
    cost,
    energy: current,
    enoughEnergy: current !== null && current >= cost,
    rewards,
    wins: node?.wins || 0,
    open,
    total: DUNGEONS.length,
    cleared: journey.cleared,
  };
}
