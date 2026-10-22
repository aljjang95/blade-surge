/** 캠페인 난이도 — 같은 던전을 다시 도전할 이유와 보상 선택을 만든다. */
import { HELL_DIFFICULTY } from '../data/content-90d.js';

// 지옥은 지역 10관문을 모두 악몽(순위 2) 이상으로 클리어해야 열린다. endgame-core 를 불러오면 순환 참조라 저장값만 직접 읽는다.
const chapterAtNightmare = (save, key) => {
  const ch = Number(String(key).split('-')[0]), peak = save?.endgame?.peak;
  if (!Number.isInteger(ch) || !peak || typeof peak !== 'object') return false;
  for (let st = 1; st <= 10; st++) if (!((peak[`${ch}-${st}`] ?? -1) >= 2)) return false;
  return true;
};
export const DIFFICULTIES = {
  story: {
    id: 'story', name: '스토리', short: 'STORY', tone: 'calm',
    description: '전투 흐름을 익히는 표준 난이도',
    enemyHp: 1, enemyAtk: 1, enemyDensity: 1, rewardMul: 1, expMul: 1,
    unlock: () => true,
  },
  adept: {
    id: 'adept', name: '숙련', short: 'ADEPT', tone: 'ember',
    description: '적이 단단해지고 보상이 커지는 실전 난이도',
    enemyHp: 1.28, enemyAtk: 1.16, enemyDensity: 1.08, rewardMul: 1.32, expMul: 1.25,
    unlock: (save) => (save.progress?.unlocked || 1) > 1,
  },
  nightmare: {
    id: 'nightmare', name: '악몽', short: 'NIGHTMARE', tone: 'void',
    description: '강화된 적과 추가 압박, 최고의 클리어 보상',
    enemyHp: 1.62, enemyAtk: 1.38, enemyDensity: 1.18, rewardMul: 1.78, expMul: 1.65,
    unlock: (save, key) => (save.progress?.stars?.[key] || 0) >= 3,
  },
  hell: { ...HELL_DIFFICULTY, unlock: chapterAtNightmare },
};

export const DIFFICULTY_ORDER = ['story', 'adept', 'nightmare', 'hell'];

export function difficultyKey(ch, st) { return `${ch}-${st}`; }

export function availableDifficulties(save, ch, st) {
  const key = difficultyKey(ch, st);
  return DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]).map((def) => ({
    ...def,
    unlocked: !!def.unlock(save, key),
  }));
}

export function resolveDifficulty(save, ch, st, requested = 'story') {
  const list = availableDifficulties(save, ch, st);
  const wanted = list.find((def) => def.id === requested);
  if (wanted?.unlocked) return wanted;
  return list.find((def) => def.unlocked) || DIFFICULTIES.story;
}

/** 전투에 붙일 난이도 스냅샷. 원본 stageDef 객체를 변형하지 않는다. */
export function applyDifficulty(stage, difficulty) {
  const d = difficulty || DIFFICULTIES.story;
  const rewards = stage.rewards ? {
    ...stage.rewards,
    gold: Math.floor(stage.rewards.gold * d.rewardMul),
    exp: Math.floor(stage.rewards.exp * d.expMul),
    bp: Math.floor(stage.rewards.bp * Math.min(1.45, d.rewardMul)),
    dropChance: Math.min(1, stage.rewards.dropChance * (0.9 + d.rewardMul * 0.1)),
  } : stage.rewards;
  return { ...stage, difficultyId: d.id, difficultyName: d.name, campaignDifficulty: d, rewards };
}
