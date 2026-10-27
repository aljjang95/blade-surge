// 전설 수련 판 UI 모델(순수 함수). 규칙은 legend-rank.js 가 정본이고, 여기서는 화면에 그릴 값(현재/다음 효과, 찍기 가능 수, 키스톤 진행, 재분배 비용)만 만든다.
import { LEGEND, LEGEND_BRANCHES, LEGEND_NODES, LEGEND_KEYSTONES, legendExpFor, nodeValue, normalizeLegend, respecCost } from './legend-rank.js';

export const LEGEND_UNLOCK_LEVEL = 80;
const PERCENT_STATS = new Set(['atkPct', 'hpPct', 'crit', 'critDmg', 'ultGain', 'bossDmgPct', 'regenPct', 'dodgeRecoverPct', 'openShieldPct', 'radiusPct', 'vacuumPct', 'cdr', 'speedPct', 'goldPct', 'dropPct', 'stonePct', 'fragmentPct', 'pickupPct', 'rarityPct']);
export const STAT_LABEL = Object.freeze({
  atkPct: '공격력', hpPct: '체력', def: '방어', crit: '치명', critDmg: '치명 피해', ultGain: '궁극기 충전', bossDmgPct: '보스 피해', regenPct: '체력 재생',
  dodgeRecoverPct: '구르기 회복', openShieldPct: '첫 방패', radiusPct: '몰이 반경', vacuumPct: '진공 세기', cdr: '재사용 대기 감소', speedPct: '이동 속도',
  goldPct: '골드', dropPct: '드랍 확률', stonePct: '강화석', fragmentPct: '세트 조각', pickupPct: '줍기 범위', rarityPct: '희귀 등급 확률',
});
const CAP_OF = Object.freeze({ goldPct: LEGEND.caps.goldPct, dropPct: LEGEND.caps.dropPct });
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

/** 효과값 표시. 비율은 % 한 자리, 방어는 정수. */
export function statText(stat, value) {
  if (PERCENT_STATS.has(stat)) return `+${(value * 100).toFixed(1)}%`;
  return `+${Math.floor(value)}`;
}

/**
 * @param {any} legendRaw  저장의 legend (정규화한다)
 * @param {{ maxHeroLevel?: number, gold?: number, power?: (state: any) => number | null }} [options]
 *   power: 가설 전설 상태(점수를 찍은 뒤)의 출전 영웅 전투력을 돌려주는 함수(없으면 전투력 미리보기를 생략한다).
 */
export function legendBoard(legendRaw, { maxHeroLevel = 1, gold = 0, power = null } = {}) {
  const state = normalizeLegend(legendRaw);
  const reached = maxHeroLevel >= LEGEND_UNLOCK_LEVEL || state.rank > 0 || state.exp > 0;
  const need = legendExpFor(state.rank);
  const basePower = typeof power === 'function' ? power(state) : null;
  const preview = (nodeId, n) => {
    if (typeof power !== 'function' || basePower === null || state.points < n || (state.nodes[nodeId] || 0) + n > LEGEND.maxNodeLevel) return null;
    const next = { ...state, nodes: { ...state.nodes, [nodeId]: (state.nodes[nodeId] || 0) + n }, points: state.points - n };
    const after = power(next);
    return Number.isFinite(after) ? { before: basePower, after, delta: after - basePower } : null;
  };
  const branches = LEGEND_BRANCHES.map((branch) => {
    const nodes = LEGEND_NODES.filter((node) => node.branch === branch.id).map((node) => {
      const level = state.nodes[node.id] || 0, maxed = level >= LEGEND.maxNodeLevel, room = LEGEND.maxNodeLevel - level;
      const value = nodeValue(node, level), next = maxed ? null : nodeValue(node, level + 1);
      const maxN = Math.min(state.points, room), canFive = reached && state.points >= 5 && room >= 5;
      const cap = CAP_OF[node.stat];
      return {
        id: node.id, branch: branch.id, name: node.name, stat: node.stat, statLabel: STAT_LABEL[node.stat] || node.stat,
        level, max: LEGEND.maxNodeLevel, maxed, value, next, valueText: statText(node.stat, value), nextText: next === null ? '최대' : statText(node.stat, next),
        deltaText: next === null ? '' : `(+${PERCENT_STATS.has(node.stat) ? ((next - value) * 100).toFixed(2) + '%p' : Math.floor(next) - Math.floor(value)})`,
        capText: cap ? `합계 상한 ${Math.round(cap * 100)}%` : '',
        canOne: reached && maxN >= 1, canFive, canMax: reached && maxN >= 1, maxN,
        previewOne: preview(node.id, 1), previewFive: canFive ? preview(node.id, 5) : null,
        reason: !reached ? `영웅 Lv.${LEGEND_UNLOCK_LEVEL} 달성 후` : maxed ? '최대 단계입니다' : state.points < 1 ? '남은 점수가 없습니다' : '',
      };
    });
    const keystones = LEGEND_KEYSTONES.filter((k) => k.branch === branch.id).map((k) => ({ id: k.id, name: k.name, effect: k.effect, unlockRank: k.unlockRank, open: state.rank >= k.unlockRank, remaining: Math.max(0, k.unlockRank - state.rank) }));
    const nextKeystone = keystones.find((k) => !k.open) || null;
    return { id: branch.id, name: branch.name, tagline: branch.tagline, spent: nodes.reduce((a, n) => a + n.level, 0), nodes, keystones, openKeystones: keystones.filter((k) => k.open).length, nextKeystone };
  });
  const upcoming = branches.flatMap((b) => (b.nextKeystone ? [{ ...b.nextKeystone, branch: b.id, branchName: b.name }] : [])).sort((a, b) => a.unlockRank - b.unlockRank)[0] || null;
  const spent = branches.reduce((a, b) => a + b.spent, 0), cost = respecCost(state), canAfford = Number(gold) >= cost;
  return {
    locked: !reached, lockReason: reached ? '' : `영웅 Lv.${LEGEND_UNLOCK_LEVEL} 달성 시 열립니다 (지금 최고 Lv.${Math.max(1, Math.floor(maxHeroLevel))})`,
    maxHeroLevel, rank: state.rank, exp: state.exp, need, pct: Math.min(100, Math.floor((state.exp / Math.max(1, need)) * 100)), points: state.points, spent,
    expText: `${fmt(state.exp)} / ${fmt(need)}`,
    respec: { spent, cost, canAfford, enabled: reached && spent > 0, reason: spent <= 0 ? '되돌릴 점수가 없습니다' : canAfford ? '' : `골드가 부족합니다 (필요 ${fmt(cost)})` },
    branches, upcoming,
    upcomingText: upcoming ? `다음 키스톤 · ${upcoming.name} (${upcoming.branchName}) ${upcoming.unlockRank}단계 · ${upcoming.remaining}단계 남음` : '모든 키스톤이 열렸습니다',
  };
}
