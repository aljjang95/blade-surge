// 현상금 의뢰판(docs/BOUNTY_BOARD.md). 에너지가 바닥난 뒤에도 이미 정화한 관문에서 고유 의뢰를 하나씩 끝낸다.
// 의뢰 = (난이도 단계 × 관문 × 종류). 관문을 그 단계로 처음 클리어하면 그 관문의 의뢰가 열리고, 각 의뢰는 한 번만 받는다.
// 판 자체는 연습 판처럼 에너지·필드 전리품·처치 경험치가 없고(fieldDropsAllowed false), 의뢰 보상만 지급한다.

/** 의뢰 종류. minutes 는 시뮬레이터 시간 모델(관문 한 판 MIN_STAGE 3분 기준 + 조건 재시도 여유). */
export const BOUNTY_KINDS = Object.freeze({
  hunt: { id: 'hunt', name: '수배 처치', bit: 1, xp: 10, marks: 1, goldShare: .4, minutes: 3, description: '이 관문의 수배 정예를 찾아 처치하세요.' },
  trial: { id: 'trial', name: '조건 의뢰', bit: 2, xp: 14, marks: 2, goldShare: .5, minutes: 4, description: '정해진 조건을 지키며 관문을 끝내세요.' },
  wanted: { id: 'wanted', name: '지역 수배범', bit: 4, xp: 30, marks: 5, goldShare: 1, minutes: 6, description: '각성한 지역 수호자를 쓰러뜨리세요(정예 접두 1개).' },
});
export const BOUNTY_KIND_ORDER = Object.freeze(['hunt', 'trial', 'wanted']);

/** 난이도 단계별 보상 배율·추가 시간(분). 단계 rank 는 difficulty.js DIFFICULTY_ORDER 순서. */
export const BOUNTY_TIERS = Object.freeze({
  story: { rank: 0, name: '스토리', goldMul: 1, xpMul: 1, extraMin: 0 },
  adept: { rank: 1, name: '숙련', goldMul: 1.4, xpMul: 1.2, extraMin: 1 },
  nightmare: { rank: 2, name: '악몽', goldMul: 1.9, xpMul: 1.4, extraMin: 1 },
  hell: { rank: 3, name: '지옥', goldMul: 2.6, xpMul: 1.7, extraMin: 1 },
});
export const BOUNTY_TIER_ORDER = Object.freeze(['story', 'adept', 'nightmare', 'hell']);

/**
 * 조건 의뢰의 조건. 관문마다 결정적으로 하나(키 해시). fact 는 전투 결과 객체의 필드, 없으면 그 조건은 실패로 본다.
 * 값은 쉬움 쪽에서 시작한다: 의뢰는 이미 클리어한 관문이라 숙련을 가르치는 목적이다.
 */
export const BOUNTY_TRIALS = Object.freeze([
  { id: 'swift', name: '신속', text: '제한 시간 {n}초 안에 클리어', fact: 'timeSec', op: 'lte', base: 240 },
  { id: 'guard', name: '버티기', text: '받은 피격 {n}회 이하로 클리어', fact: 'hitsTaken', op: 'lte', base: 12 },
  { id: 'chain', name: '연격', text: '최대 연속 타격 {n} 이상', fact: 'maxCombo', op: 'gte', base: 25 },
  { id: 'nopotion', name: '맨몸', text: '물약 없이 클리어', fact: 'potionsUsed', op: 'lte', base: 0 },
]);

/** 사냥꾼 등급: 등급 r → r+1 에 필요한 경험치. 의뢰 4~8개(대략 20~30분)마다 한 등급. */
export const HUNTER_RANK = Object.freeze({ max: 60, need: (rank) => 40 + 5 * rank });

/** 5등급마다 칭호. 칭호는 효과 없음(표시 전용). */
export const HUNTER_TITLES = Object.freeze([
  { rank: 5, id: 'bounty_novice', name: '견습 추적자' },
  { rank: 10, id: 'bounty_tracker', name: '종소리 추적자' },
  { rank: 15, id: 'bounty_ember', name: '잿불 사냥꾼' },
  { rank: 20, id: 'bounty_frost', name: '서리 기록 사냥꾼' },
  { rank: 25, id: 'bounty_tide', name: '심해 수배꾼' },
  { rank: 30, id: 'bounty_crown', name: '왕관 사냥꾼' },
  { rank: 35, id: 'bounty_homecoming', name: '귀환로 수호자' },
  { rank: 40, id: 'bounty_belltower', name: '종탑 집행자' },
  { rank: 45, id: 'bounty_veteran', name: '노련한 현상금 사냥꾼' },
  { rank: 50, id: 'bounty_master', name: '의뢰판의 주인' },
  { rank: 55, id: 'bounty_legend', name: '전설의 추적자' },
  { rank: 60, id: 'bounty_apex', name: '정점의 사냥꾼' },
]);

/** 등급 보상(등급에 도달한 순간 1회): 강화석 소량. 전투력 곡선을 흔들지 않는 크기(sim:90d 밴드로 가드). */
export const rankReward = (rank) => ({ stones: 2 + Math.floor(rank / 5) });

/**
 * 현상금 상인(증표 고정가 교환, 유료·무작위 없음). 주간 한도가 있는 품목은 주(시즌 절대 주)마다 다시 열린다.
 * 칭호 장식은 표시 전용이다.
 */
export const BOUNTY_SHOP = Object.freeze([
  { id: 'stones_bundle', name: '강화석 꾸러미', cost: 12, weekly: 3, grant: { stones: 6 } },
  { id: 'stones2_bundle', name: '상급 강화석 꾸러미', cost: 30, weekly: 1, minRank: 15, grant: { stones2: 2 } },
  { id: 'banner_crimson', name: '사냥꾼 깃발: 진홍', cost: 40, once: true, grant: { cosmetic: 'banner_crimson' } },
  { id: 'banner_frost', name: '사냥꾼 깃발: 서리', cost: 60, once: true, minRank: 20, grant: { cosmetic: 'banner_frost' } },
]);
