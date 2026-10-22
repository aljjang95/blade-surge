// 90일 콘텐츠 계약(docs/CONTENT_90D.md). 지옥 난이도·무한의 성·시즌 이벤트 달력의 수치는 여기 한곳에 둔다.
// 숫자는 tools/sim-90d.mjs 가 같은 모듈을 읽어 3 페르소나 90일 진행으로 검증한다(--assert).
// 표시 문구와 실제 효과는 같은 항목에서 나온다. 효과가 구현되지 않은 이벤트를 문구만으로 추가하지 않는다.

const frozen = (value) => Object.freeze(value);

/** 시즌 1 시작: 2026-10-26(월) 05:00 KST. 주차·일차는 journey-core 의 05:00 KST 경계와 같다. */
export const SEASON = frozen({
  startMs: Date.UTC(2026, 9, 25, 20, 0, 0),
  weeks: 13,
  name: '균열의 계절',
});

/**
 * 지옥(HELL): 지역 10관문을 모두 악몽으로 클리어하면 그 지역에서 열린다(MMO_DESIGN 7.2).
 * 배율은 difficulty.js 가 읽는다. 보상 배율이 커도 loot-tables 의 난이도 행이 상위 강화석·초월석 가중을 함께 올린다.
 */
export const HELL_DIFFICULTY = frozen({
  id: 'hell', name: '지옥', short: 'HELL', tone: 'blood',
  description: '지역 악몽을 모두 넘은 영웅만 들어서는 최상위 난이도',
  enemyHp: 2.8, enemyAtk: 2.1, enemyDensity: 1.25, rewardMul: 2.4, expMul: 2.2,
});

/**
 * 무한의 성. 10층 한 구간이 캠페인 한 지역을 돌며(1~10층 = 1지역 ... 61~70층 = 다시 1지역),
 * 5층은 중간 보스, 10층은 지역 최종 보스(X-5 / X-10 규칙)다. 층 맵·몬스터·보스는 원본 관문의 자산을 그대로 쓴다.
 * 적 배율(scale)은 원본 관문이 아니라 층 번호로 정한다: baseScale × 층^exponent (1층 ≈ 2-8, 100층 ≈ 캠페인 6-10 의 4.6배).
 * 거듭제곱 곡선이라 초반 층은 빠르게, 후반 층은 성장 속도에 맞춰 하루 1층 안팎으로 오른다(tools/sim-90d.mjs).
 */
export const TOWER = frozen({
  name: '무한의 성',
  unlockStageIdx: 21,           // 2-10 을 처음 클리어하면(진행도 21 = 3-1 해금) 열린다
  baseScale: 8.9,               // 1층 적 배율(≈ 2-8 관문)
  exponent: 0.55,               // 층 적 배율 = baseScale × 층^0.55
  capBase: 30,                  // 시즌 1주차 도전 가능 최고 층
  capPerWeek: 15,               // 주차마다 상한 +15층
  capMax: 300,
  minutesPerFloor: 3.5,
  firstClear: frozen({ gold: 300, goldGrowth: 1.035, stones: 2, stones2Every: 5, stones3Every: 10, gemsEvery: 10, gems: 50, transcendEvery: 25 }),
  // 주간 보급: 이번 주에 한 층 이상 돌파했으면 최고 층 구간에 맞춰 한 번 받는다.
  weeklyChest: frozen([
    frozen({ floor: 1, gold: 3000, stones: 10, stones2: 0, stones3: 0, gems: 0 }),
    frozen({ floor: 20, gold: 6000, stones: 15, stones2: 4, stones3: 0, gems: 50 }),
    frozen({ floor: 40, gold: 10000, stones: 20, stones2: 8, stones3: 1, gems: 80 }),
    frozen({ floor: 70, gold: 16000, stones: 25, stones2: 12, stones3: 2, gems: 120 }),
    frozen({ floor: 100, gold: 24000, stones: 30, stones2: 16, stones3: 4, gems: 160 }),
    frozen({ floor: 150, gold: 32000, stones: 35, stones2: 20, stones3: 6, gems: 200 }),
  ]),
});

/**
 * 시즌 13주 이벤트 달력. 효과 종류는 endgame-core.applyEventRewards 가 실제로 적용하는 것만 쓴다.
 *  - campaignGold: 캠페인·지옥 완료 골드 배율 / campaignExp: 캠페인 완료 EXP 배율
 *  - stoneBonus: 캠페인 완료 강화석 +n / towerFirstClear: 무한의 성 첫 돌파 보상 배율
 * days: 'all' 이면 그 주 내내, 'weekend' 면 토·일(05:00 KST 경계)만.
 */
export const EVENT_WEEKS = frozen([
  { week: 0, id: 'muster', name: '출정식', tagline: '첫 주는 모든 캠페인 완료 골드 +50%', days: 'all', effects: [['campaignGold', 1.5]] },
  { week: 1, id: 'tower-open', name: '성문 개방', tagline: '무한의 성 첫 돌파 보상 ×1.5', days: 'all', effects: [['towerFirstClear', 1.5]] },
  { week: 2, id: 'forge-weekend', name: '대장간 주말', tagline: '주말 캠페인 완료 강화석 +3', days: 'weekend', effects: [['stoneBonus', 3]] },
  { week: 3, id: 'veteran-week', name: '숙련자의 주', tagline: '캠페인 완료 EXP +30%', days: 'all', effects: [['campaignExp', 1.3]] },
  { week: 4, id: 'gold-rush', name: '황금 주말', tagline: '주말 캠페인 완료 골드 ×2', days: 'weekend', effects: [['campaignGold', 2]] },
  { week: 5, id: 'climb', name: '등반 축제', tagline: '무한의 성 첫 돌파 보상 ×1.5 · EXP +20%', days: 'all', effects: [['towerFirstClear', 1.5], ['campaignExp', 1.2]] },
  { week: 6, id: 'forge-weekend-2', name: '대장간 주말 II', tagline: '주말 캠페인 완료 강화석 +4', days: 'weekend', effects: [['stoneBonus', 4]] },
  { week: 7, id: 'hell-gate', name: '지옥문 주간', tagline: '캠페인 완료 골드 +30% · 강화석 +2', days: 'all', effects: [['campaignGold', 1.3], ['stoneBonus', 2]] },
  { week: 8, id: 'gold-rush-2', name: '황금 주말 II', tagline: '주말 캠페인 완료 골드 ×2', days: 'weekend', effects: [['campaignGold', 2]] },
  { week: 9, id: 'climb-2', name: '등반 축제 II', tagline: '무한의 성 첫 돌파 보상 ×2', days: 'all', effects: [['towerFirstClear', 2]] },
  { week: 10, id: 'veteran-week-2', name: '숙련자의 주 II', tagline: '캠페인 완료 EXP +30% · 강화석 +2', days: 'all', effects: [['campaignExp', 1.3], ['stoneBonus', 2]] },
  { week: 11, id: 'last-forge', name: '마지막 담금질', tagline: '주말 캠페인 완료 강화석 +5 · 골드 ×1.5', days: 'weekend', effects: [['stoneBonus', 5], ['campaignGold', 1.5]] },
  { week: 12, id: 'season-finale', name: '시즌 피날레', tagline: '무한의 성 첫 돌파 보상 ×2 · 캠페인 골드 +50%', days: 'all', effects: [['towerFirstClear', 2], ['campaignGold', 1.5]] },
].map((week) => frozen({ ...week, effects: frozen(week.effects.map(([kind, value]) => frozen({ kind, value }))) })));

export const EVENT_EFFECT_KINDS = frozen(['campaignGold', 'campaignExp', 'stoneBonus', 'towerFirstClear']);

/**
 * 진행 시뮬레이터의 "실전 요구 전투력" 모델: k × 적배율^exp × 난이도 압박(√(체력×공격)·√밀도) × (탑이면 tower).
 * 현행 스토리 캠페인이 하루 30분 기준 약 7일에 끝나는 실측(tools/progression-estimate.mjs)에 맞춰 보정했다.
 * 게임 판정에는 쓰지 않는다(전투는 실제 조작으로 승패가 난다). 로비의 권장 전투력 표시는 기존 recPower 그대로다.
 */
export const POWER_NEED = frozen({ k: 2700, exp: 0.6, tower: 1 });
