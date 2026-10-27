// 고통 단계 UI 모델(순수 함수) — 관문 선택의 난이도 줄과 결과 화면 띠가 읽는다. 규칙·수치는 difficulty.js / torment-core.js / content-90d.js 가 정본이고,
// 여기서는 그 값을 화면용 문구·상태로 바꾸기만 한다(docs/SPEC_720H.md 3.2, 4절 UI 행).
import { TORMENT } from '../data/content-90d.js';
import { DIFFICULTY_ORDER, DIFFICULTIES, tormentId, tormentTierOf, tormentMul, tormentExpMul, tormentUnlockedTier, difficultyKey } from './difficulty.js';
import { LEGEND_KEYSTONES, legendExpFor } from './legend-rank.js';

/** 서버 권위 계정은 지옥·고통 단계 정산이 아직 서버에 없어 출격이 막힌다(main.js startStage 와 같은 문구). */
export const SERVER_HELL_LOCK = '서버 계정의 지옥·고통 단계 정산을 준비 중입니다.';
const HELL_RANK = DIFFICULTY_ORDER.indexOf('hell');
const STAGES = 10;
const fmtMul = (value) => `×${value >= 100 ? Math.round(value) : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/0$/, '')}`;
export const DIFFICULTY_REQUIREMENT = Object.freeze({ story: '기본 난이도', adept: '1개 스테이지 클리어', nightmare: '이 스테이지 ★3', hell: '지역 10관문 악몽 클리어' });

/** 이 관문에서 고통 단계가 닫혀 있는 이유. 열려 있으면 null. */
export function tormentLock(save, ch, st, { serverAuthority = false } = {}) {
  if (serverAuthority) return { code: 'server', reason: SERVER_HELL_LOCK };
  const peak = save?.endgame?.peak && typeof save.endgame.peak === 'object' ? save.endgame.peak : {};
  if (tormentUnlockedTier(save) < 1) {
    let done = 0;
    for (let n = 1; n <= STAGES; n++) if ((peak[`${ch}-${n}`] ?? -1) >= HELL_RANK) done++;
    return { code: 'region', reason: `지옥 ${ch}장 10관문 클리어 시 T1 (${done}/10)` };
  }
  if ((peak[difficultyKey(ch, st)] ?? -1) < HELL_RANK) return { code: 'stage', reason: '이 관문을 지옥으로 먼저 클리어하면 고통 단계에 도전할 수 있어요' };
  return null;
}

/** 선택한 단계 하나의 화면용 정보. status 는 Economy.tormentStatus() 결과. */
export function tormentInfo(tier, status) {
  const n = Number.isSafeInteger(tier) ? Math.max(1, Math.min(TORMENT.maxTier, tier)) : 1;
  const fullRuns = Number(status?.fullRuns) || TORMENT.fullRuns, fullLeft = Math.max(0, Math.min(fullRuns, Number.isFinite(status?.fullLeft) ? status.fullLeft : fullRuns));
  const enemy = tormentMul(n), reward = 1 + TORMENT.rewardStep * n, exp = tormentExpMul(n), decayPct = Math.round(TORMENT.decayMul * 100);
  const decayed = fullLeft <= 0;
  return {
    tier: n, enemyMul: enemy, rewardMul: reward, expMul: exp, energy: 0, fullRuns, fullLeft, decayed, decayPct,
    enemyText: `적 체력·공격 지옥 ${fmtMul(enemy)}`, rewardText: `재화·재료 ${fmtMul(reward)}`, expText: `경험치 ${fmtMul(exp)}`, energyText: '에너지 0',
    fullText: decayed ? '오늘 풀 보상 판 모두 사용' : `오늘 풀 보상 ${fullLeft}/${fullRuns}판 남음`,
    decayNote: decayed ? `오늘은 재화 ${decayPct}%, 경험치 100%` : '',
  };
}

/**
 * 관문 선택의 난이도 줄 모델.
 * @param {{ save: any, ch: number, st: number, current: string, status?: any, serverAuthority?: boolean, lastTier?: number }} input
 *   current = 이 관문에서 실제로 적용되는 난이도 id(eco.difficultyFor 결과). lastTier = 마지막으로 고른 단계(없으면 0).
 */
export function difficultyPicker({ save, ch, st, current, status = null, serverAuthority = false, lastTier = 0 }) {
  const key = difficultyKey(ch, st), activeTier = tormentTierOf(current);
  const options = DIFFICULTY_ORDER.map((id) => {
    const def = DIFFICULTIES[id], opened = !!def.unlock(save, key), server = serverAuthority && id === 'hell';
    return { id, name: def.name, unlocked: opened && !server, rewardMul: def.rewardMul, expMul: def.expMul, active: current === id,
      requirement: server ? SERVER_HELL_LOCK : opened ? '' : DIFFICULTY_REQUIREMENT[id] };
  });
  const lock = tormentLock(save, ch, st, { serverAuthority }), top = lock ? 0 : tormentUnlockedTier(save);
  const tier = activeTier || (top >= 1 ? Math.max(1, Math.min(top, Number.isSafeInteger(lastTier) && lastTier > 0 ? lastTier : top)) : 0);
  options.push({ id: 'torment', name: '고통', unlocked: !lock, active: activeTier > 0, requirement: lock ? lock.reason : '', lockCode: lock?.code || '' });
  const best = Number.isSafeInteger(save?.endgame?.torment?.best) ? save.endgame.torment.best : 0;
  return {
    options, current, activeTier,
    torment: { unlocked: !lock, reason: lock?.reason || '', lockCode: lock?.code || '', top, best, tier, canDown: !lock && tier > 1, canUp: !lock && tier < top, id: tier ? tormentId(tier) : '', info: tier ? tormentInfo(tier, status) : null },
  };
}

const keystoneName = (id) => LEGEND_KEYSTONES.find((k) => k.id === id)?.name || id;
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

/** 결과 화면 한 줄 띠. reward = Economy.completeStage 영수증. 해당 없으면 null. */
export function resultStrip(reward) {
  const t = reward?.torment, l = reward?.legend;
  const parts = [];
  if (t && Number.isSafeInteger(t.tier)) {
    const bits = [`고통 ${t.tier}단계`];
    if (t.newBest) bits.push(`새 최고 기록 T${t.best}${t.best < TORMENT.maxTier ? ` · T${t.best + 1} 열림` : ''}`); else bits.push(`최고 T${t.best}`);
    bits.push(t.full ? `풀 보상 판 · 남은 풀 보상 ${t.fullLeft}판` : `오늘 풀 보상 끝 · 재화 ${Math.round(TORMENT.decayMul * 100)}%, 경험치 100%`);
    parts.push({ kind: 'torment', tone: t.newBest ? 'best' : t.full ? 'full' : 'decay', text: bits.join(' · ') });
  }
  if (l && l.gained > 0) {
    const bits = [`전설 EXP +${fmt(l.gained)}`];
    if (l.ranks > 0) bits.push(`전설 ${fmt(l.rank)}단계 (+${l.ranks}) · 점수 +${l.ranks}`);
    else bits.push(`전설 ${fmt(l.rank)}단계 ${Math.min(99, Math.floor((l.exp / Math.max(1, legendExpFor(l.rank))) * 100))}%`);
    if (l.keystones?.length) bits.push(`새 키스톤 ${l.keystones.map(keystoneName).join('·')}`);
    parts.push({ kind: 'legend', tone: l.keystones?.length ? 'keystone' : l.ranks > 0 ? 'rank' : 'exp', text: bits.join(' · ') });
  }
  return parts.length ? { parts, text: parts.map((p) => p.text).join('  |  ') } : null;
}
