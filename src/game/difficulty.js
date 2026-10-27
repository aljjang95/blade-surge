/** 캠페인 난이도 — 같은 던전을 다시 도전할 이유와 보상 선택을 만든다. */
import { HELL_DIFFICULTY, TORMENT } from '../data/content-90d.js';

// 지옥은 지역 10관문을 모두 악몽(순위 2) 이상으로 클리어해야 열린다. endgame-core 를 불러오면 순환 참조라 저장값만 직접 읽는다.
const chapterAtNightmare = (save, key) => {
  const ch = Number(String(key).split('-')[0]), peak = save?.endgame?.peak;
  if (!Number.isInteger(ch) || !peak || typeof peak !== 'object') return false;
  for (let st = 1; st <= 10; st++) if (!((peak[`${ch}-${st}`] ?? -1) >= 2)) return false;
  return true;
};
/** 난이도 정의. 고통 단계 1~50은 아래에서 'torment-N' 키로 더해진다. */
export const DIFFICULTIES = /** @type {Record<string, any>} */ ({
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
});

export const DIFFICULTY_ORDER = ['story', 'adept', 'nightmare', 'hell'];

// ---------- 고통 단계(TORMENT, docs/SPEC_720H.md 3.2) ----------
// 단계 id 는 'torment-1' ~ 'torment-50'. 지옥 다음 난이도라 DIFFICULTY_ORDER(최고 기록 순위·드랍 보고서 행)에는 넣지 않고
// DIFFICULTIES 에는 단계마다 넣어 서버 런 티켓·런 기록의 Object.hasOwn(DIFFICULTIES, id) 검사가 그대로 통과한다.
const TORMENT_ID = /^torment-([1-9]\d?)$/;
const HELL_RANK = DIFFICULTY_ORDER.indexOf('hell');
export const tormentId = (tier) => `torment-${tier}`;
/** 난이도 id 의 고통 단계(1~maxTier). 고통 단계가 아니면 0. */
export function tormentTierOf(id) {
  const m = typeof id === 'string' ? TORMENT_ID.exec(id) : null, tier = m ? Number(m[1]) : 0;
  return tier >= 1 && tier <= TORMENT.maxTier ? tier : 0;
}
/** 단계 n 의 적 체력·공격 배율(지옥 대비) M(n) = 1 + A·(1 − e^(−n/τ)) + B·n. */
export const tormentMul = (tier) => 1 + TORMENT.curve.A * (1 - Math.exp(-tier / TORMENT.curve.tau)) + TORMENT.curve.B * tier;
/** 단계 n 의 EXP 배율(지옥 대비, 처치·완료 공통) = expBase + expStep×n. */
export const tormentExpMul = (tier) => TORMENT.expBase + TORMENT.expStep * tier;
/** 단계 n 의 배율: 적 체력·공격 = 지옥 × M(n), 보상 = 지옥 × (1 + rewardStep×n), EXP = 지옥 × tormentExpMul(n). */
export function tormentScale(tier) {
  const n = Number.isSafeInteger(tier) ? Math.max(0, Math.min(TORMENT.maxTier, tier)) : 0, mul = tormentMul(n);
  return { tier: n, enemyHp: HELL_DIFFICULTY.enemyHp * mul, enemyAtk: HELL_DIFFICULTY.enemyAtk * mul,
    enemyDensity: HELL_DIFFICULTY.enemyDensity, rewardMul: HELL_DIFFICULTY.rewardMul * (1 + TORMENT.rewardStep * n), expMul: HELL_DIFFICULTY.expMul * tormentExpMul(n) };
}
/** 저장에서 읽은 고통 단계 상태. 해금 단계 = 최고 클리어 단계 + 1(최대 maxTier), 지옥을 한 지역도 못 끝냈으면 0. */
export function tormentUnlockedTier(save) {
  const peak = save?.endgame?.peak;
  if (!peak || typeof peak !== 'object') return 0;
  const cleared = new Map();
  for (const [key, rank] of Object.entries(peak)) {
    const ch = Number(String(key).split('-')[0]);
    if (Number.isInteger(ch) && rank >= HELL_RANK) cleared.set(ch, (cleared.get(ch) || 0) + 1);
  }
  if (![...cleared.values()].some((n) => n >= 10)) return 0;
  const best = Number.isSafeInteger(save.endgame.torment?.best) ? save.endgame.torment.best : 0;
  return Math.min(TORMENT.maxTier, Math.max(0, best) + 1);
}
/** 고통 단계는 그 관문을 지옥으로 이미 클리어한 곳에서만 열린다. */
const stageClearedAtHell = (save, key) => (save?.endgame?.peak?.[key] ?? -1) >= HELL_RANK;
for (let tier = 1; tier <= TORMENT.maxTier; tier++) {
  DIFFICULTIES[tormentId(tier)] = {
    id: tormentId(tier), name: `고통 ${tier}단계`, short: `T${tier}`, tone: 'blood', tormentTier: tier, energy: 0,
    description: '에너지 없이 끝없이 도는 지옥 위의 난이도. 하루 첫 판 이후는 골드·재료가 줄고 경험치는 그대로',
    ...tormentScale(tier), combatExpMul: tormentExpMul(tier),
    unlock: (save, key) => tier <= tormentUnlockedTier(save) && stageClearedAtHell(save, key),
  };
}
/** 이 관문에서 고를 수 있는 고통 단계(1~해금 단계). 지옥 클리어 전이면 빈 목록. */
export function availableTorments(save, ch, st) {
  const key = difficultyKey(ch, st), top = tormentUnlockedTier(save);
  return !stageClearedAtHell(save, key) ? [] : Array.from({ length: top }, (_, i) => DIFFICULTIES[tormentId(i + 1)]);
}

export function difficultyKey(ch, st) { return `${ch}-${st}`; }

export function availableDifficulties(save, ch, st) {
  const key = difficultyKey(ch, st);
  return DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]).map((def) => ({
    ...def,
    unlocked: !!def.unlock(save, key),
  }));
}

export function resolveDifficulty(save, ch, st, requested = 'story') {
  const tier = tormentTierOf(requested);
  if (tier) {
    // 요청한 단계가 아직 닫혀 있으면 해금된 가장 높은 단계로 내린다(지옥 클리어 전이면 아래 일반 규칙).
    const top = Math.min(tier, tormentUnlockedTier(save));
    if (top >= 1 && stageClearedAtHell(save, difficultyKey(ch, st))) return DIFFICULTIES[tormentId(top)];
    requested = 'hell';
  }
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
  // 고통 단계는 에너지 0, 권장 레벨은 영웅 레벨 상한(낮은 장 저레벨 EXP 가중 방지). 서버 정산도 같은 함수를 쓴다.
  const torment = d.tormentTier ? { energy: 0, recommendedLevel: TORMENT.recLevel } : null;
  return { ...stage, ...torment, difficultyId: d.id, difficultyName: d.name, campaignDifficulty: d, rewards };
}
