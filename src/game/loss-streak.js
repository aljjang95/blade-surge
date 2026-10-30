// 같은 스테이지 연속 패배(세션 메모리)와 그에 따른 결과 화면 성장 카드 순서. 순수 함수: 저장 스키마를 건드리지 않는다.

/** 연패 2회부터 성장 카드를 맨 앞에 올린다. */
export const LOSS_STREAK_PUSH = 2;

/** 스테이지 식별 키. 같은 코드라도 난이도가 다르면 다른 스테이지로 센다. */
export const lossStageKey = (stage) => stage ? String(stage.code || stage.id || '') + ':' + String(stage.difficultyId || '') : '';

/**
 * 결과 한 건을 반영한 연속 패배 카운터.
 * @param {{key:string, n:number}|null|undefined} prev @param {string} key @param {boolean} win
 * @returns {{key:string, n:number}}
 */
export function nextLossStreak(prev, key, win) {
  if (win || !key) return { key: '', n: 0 };
  return { key, n: prev?.key === key ? prev.n + 1 : 1 };
}

// 낮을수록 위. 더 좋은 장비 장착 → 강화(확정·확률) → 소환 → 나머지(원래 순서 유지).
const rank = (o) => o.kind === 'gear' && o.mode === 'equipBest' ? 0
  : o.kind === 'equipment' && o.mode === 'equip' ? 1
  : o.kind === 'equipment' ? 2
  : o.kind === 'summon' ? 3 : 4;

/**
 * 연패 중이면 성장 카드를 장착 → 강화 → 소환 순으로 안정 정렬한다. 아니면 원래 순서 그대로.
 * @template T @param {T[]} options @param {number} streak @returns {T[]}
 */
export function orderGrowthOptions(options, streak) {
  if (!(streak >= LOSS_STREAK_PUSH)) return options;
  return options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
}
