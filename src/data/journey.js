/** Milestones reuse real saved progression. Rewards are settled by the caller's transaction. */
export const JOURNEY_STEPS = [
  ['oath','모험가의 첫 서약','탐험 퀘스트에서 탐험가의 서약 보상을 받으세요.','quests',500],
  ['garden','첫 정원 정화','유리 정원에서 실제 전투를 한 번 완료하세요.','dungeons',1000],
  ['craft','내 손으로 만든 준비','공방에서 장비나 물약을 한 번 제작하세요.','forge',1500],
  ['equip','몸을 지킬 장비','현재 선택한 영웅에게 갑옷을 장착하세요.','heroes',1000],
  ['enhance','한 단계 더 단단하게','현재 영웅의 장착 장비를 +1 이상으로 강화하세요.','heroes',1500],
  ['mastery','남겨진 경험','명성으로 영구 숙련을 하나 습득하세요.','mastery',2000],
].map(([id,name,description,action,gold])=>({id,name,description,action,rewards:{gold,stones:10}}));

/**
 * Counted player actions. Callers report them through recordJourneyAction inside
 * the same save transaction that spends the action's cost:
 * pulls = gacha pulls resolved (10-pull counts 10), upgrades = paid equipment
 * enhance attempts (success or failure), bossAttempts = boss fights started (retries count).
 */
export const JOURNEY_ACTION_STATS = ['pulls', 'upgrades', 'bossAttempts'];

export const DAILY_CONTRACTS = [
  {id:'first_dungeon',name:'오늘의 첫 원정',description:'실전 재료 던전 1회 완료',stat:'wins',target:1,rewards:{gold:600,consumables:{hp_tonic:1}}},
  {id:'rotation',name:'오늘의 원정지',description:'오늘 지정된 재료 던전 1회 완료',stat:'rotation',target:1,rewards:{gold:800},rotationMaterials:2},
  {id:'three_dungeons',name:'세 번의 귀환',description:'실전 재료 던전 3회 완료',stat:'wins',target:3,rewards:{gold:1200,consumables:{overdrive:1}}},
  {id:'daily_pulls',name:'오늘의 소환',description:'소환 10회 진행',stat:'pulls',target:10,rewards:{gold:700,stones:5}},
  {id:'daily_upgrades',name:'대장간의 담금질',description:'장비 강화 3회 시도',stat:'upgrades',target:3,rewards:{gold:500,stones:10}},
  {id:'daily_boss',name:'수호자에게 다시',description:'보스전 1회 도전',stat:'bossAttempts',target:1,rewards:{gold:400,consumables:{aegis:1}}},
];
export const WEEKLY_CONTRACTS = [
  {id:'seven_dungeons',name:'한 주의 발자취',description:'이번 주 실전 재료 던전 7회 완료',stat:'wins',target:7,rewards:{gold:3000,materials:{glass_leaf:3,ember_core:3,star_dust:3}}},
  {id:'diverse_dungeons',name:'세 곳의 기록',description:'이번 주 서로 다른 재료 던전 3곳 완료',stat:'distinct',target:3,rewards:{gold:2000,consumables:{hp_tonic:3,aegis:1}}},
  {id:'weekly_pulls',name:'한 주의 소환',description:'이번 주 소환 30회 진행',stat:'pulls',target:30,rewards:{gold:2500,stones:20}},
  {id:'weekly_upgrades',name:'단련의 한 주',description:'이번 주 장비 강화 10회 시도',stat:'upgrades',target:10,rewards:{gold:2000,stones:25}},
  {id:'weekly_boss',name:'꺾이지 않는 도전',description:'이번 주 보스전 5회 도전',stat:'bossAttempts',target:5,rewards:{gold:1500,consumables:{overdrive:2,hp_tonic:2}}},
];
