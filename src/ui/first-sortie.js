// 신규 계정의 첫 출격 추천. 저장된 진행만 읽고 아무것도 쓰지 않는다.
// 첫 출격은 던전이 아니라 조작 안내가 붙는 캠페인 1-1 이다(시작방이 비어 있는 던전은 첫 30초가 죽는다).
import { stageDef } from '../data/stages.js';
import { stageKeyArtOf } from './stage-art.js';
import { recentDungeonRun } from './dungeon-landing.js';

export const FIRST_SORTIE_ID = 'campaign:1-1';

/**
 * 신규 계정 판정: 캠페인 별 기록 없음 + 1-1 만 열려 있음 + 던전 정복·최근 원정 없음.
 * 이미 던전이나 다른 스테이지를 해 본 기존 계정은 그대로 던전 추천을 쓴다.
 * @param {{ progress?: { unlocked?: number, stars?: Record<string, number> } }} save
 * @param {{ history?: unknown, dungeonsCleared?: number }} [context]
 */
export function isFirstSortie(save, { history = [], dungeonsCleared = 0 } = {}) {
  const progress = save?.progress;
  if (!progress) return false;
  if (Object.values(progress.stars || {}).some((stars) => stars > 0)) return false;
  if ((progress.unlocked || 1) > 1) return false;
  if (dungeonsCleared > 0 || recentDungeonRun(history)) return false;
  return true;
}

/**
 * 던전 로비 모델(dungeonLanding 결과)에 첫 출격 캠페인 1-1 을 덧씌운다. 카드·진행 수치는 기존 모델 그대로다.
 * @param {any} base dungeonLanding 의 결과  @param {{ energy?: number }} [state]
 */
export function firstSortieModel(base, { energy = null } = {}) {
  const stage = stageDef(1, 1);
  const current = Number.isFinite(energy) ? Number(energy) : null;
  return {
    ...base,
    campaign: Object.freeze({ ch: stage.ch, st: stage.st }),
    reason: 'campaign', label: '첫 출격 · 캠페인 1-1', outcome: null, notice: '',
    depth: 'standard', depthLabel: `캠페인 ${stage.code}`,
    name: stage.title, art: stageKeyArtOf(stage) || base.art, accent: stage.chapter?.color || base.accent,
    description: '조작 안내와 함께 시작하는 첫 전투입니다. 클리어하면 추천 던전이 열립니다.',
    unlocked: true, lockReason: '', cost: stage.energy, energy: current, enoughEnergy: current !== null && current >= stage.energy,
    rewards: [{ id: 'gold', amount: stage.rewards.gold, name: '골드' }, { id: 'gems', amount: stage.rewards.firstGems, name: '첫 클리어 보석' }],
    wins: 0, selectedId: null,
  };
}
