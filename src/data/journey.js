/** Milestones reuse real saved progression. Rewards are settled by the caller's transaction. */
export const JOURNEY_STEPS = [
  ['oath','모험가의 첫 서약','탐험 퀘스트에서 탐험가의 서약 보상을 받으세요.','quests',500],
  ['garden','첫 정원 정화','유리 정원에서 실제 전투를 한 번 완료하세요.','dungeons',1000],
  ['craft','내 손으로 만든 준비','공방에서 장비나 물약을 한 번 제작하세요.','forge',1500],
  ['equip','몸을 지킬 장비','현재 선택한 영웅에게 갑옷을 장착하세요.','heroes',1000],
  ['enhance','한 단계 더 단단하게','현재 영웅의 장착 장비를 +1 이상으로 강화하세요.','heroes',1500],
  ['mastery','남겨진 경험','명성으로 영구 숙련을 하나 습득하세요.','mastery',2000],
].map(([id,name,description,action,gold])=>({id,name,description,action,rewards:{gold,stones:10}}));

export const DAILY_CONTRACTS = [
  {id:'first_dungeon',name:'오늘의 첫 원정',description:'실전 재료 던전 1회 완료',stat:'wins',target:1,rewards:{gold:600,consumables:{hp_tonic:1}}},
  {id:'rotation',name:'오늘의 원정지',description:'오늘 지정된 재료 던전 1회 완료',stat:'rotation',target:1,rewards:{gold:800},rotationMaterials:2},
  {id:'three_dungeons',name:'세 번의 귀환',description:'실전 재료 던전 3회 완료',stat:'wins',target:3,rewards:{gold:1200,consumables:{overdrive:1}}},
];
export const WEEKLY_CONTRACTS = [
  {id:'seven_dungeons',name:'한 주의 발자취',description:'이번 주 실전 재료 던전 7회 완료',stat:'wins',target:7,rewards:{gold:3000,materials:{glass_leaf:3,ember_core:3,star_dust:3}}},
  {id:'diverse_dungeons',name:'세 곳의 기록',description:'이번 주 서로 다른 재료 던전 3곳 완료',stat:'distinct',target:3,rewards:{gold:2000,consumables:{hp_tonic:3,aegis:1}}},
];
