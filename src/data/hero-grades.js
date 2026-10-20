// 영웅 등급(SR → SSR → SSSR 초월). 등급은 영웅마다 시작값(def.rarity)이 있고 초월로만 오른다.
// 등급이 능력치 배율, 스킬 피해, 재사용 대기, 궁극기 충전, 전용 연출(signature)을 함께 정한다.
// 전투(Player/BattleBase), 성장 UI, 상점이 모두 이 파일만 읽는다.
export const GRADE_ORDER = Object.freeze(['SR', 'SSR', 'SSSR']);

export const GRADE_RULES = Object.freeze({
  SR: Object.freeze({ id: 'SR', label: 'SR', color: '#b26bff', statMul: 1.5, skillMul: 1, cdMul: 1, ultGain: 0, signature: false, auraColor: 0xb26bff }),
  SSR: Object.freeze({ id: 'SSR', label: 'SSR', color: '#ffcf5a', statMul: 2, skillMul: 1.2, cdMul: 0.92, ultGain: 0.1, signature: false, auraColor: 0xffcf5a }),
  SSSR: Object.freeze({ id: 'SSSR', label: 'SSSR', color: '#ff5a8a', statMul: 2.6, skillMul: 1.45, cdMul: 0.85, ultGain: 0.2, signature: true, auraColor: 0xff5a8a }),
});

// 초월 비용: 목표 등급 기준. shards = 중복 소환 조각, transcendStones = 초월석, gold = 골드.
export const GRADE_UP_COST = Object.freeze({
  SSR: Object.freeze({ shards: 60, transcendStones: 10, gold: 300000 }),
  SSSR: Object.freeze({ shards: 120, transcendStones: 30, gold: 1500000 }),
});

export const gradeRank = (grade) => GRADE_ORDER.indexOf(grade);
export function heroBaseGrade(def) { return gradeRank(def?.rarity) >= 0 ? def.rarity : 'SR'; }
export function normalizeGrade(def, grade) {
  const base = heroBaseGrade(def);
  return gradeRank(grade) >= gradeRank(base) ? grade : base;
}
export function heroGrade(def, state) { return normalizeGrade(def, state?.grade); }
export function gradeRules(grade) { return GRADE_RULES[grade] || GRADE_RULES.SR; }
export function nextGrade(grade) { const i = gradeRank(grade); return i >= 0 && i < GRADE_ORDER.length - 1 ? GRADE_ORDER[i + 1] : null; }
export function gradeUpCost(grade) { const next = nextGrade(grade); return next ? GRADE_UP_COST[next] : null; }
