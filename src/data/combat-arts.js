export const COMBAT_ARTS = [
  {id:'rupture',name:'파열',description:'균형 파괴 중 첫 마무리: 반경 5 안의 다른 적 최대 2명에게 공격력 60% 피해와 밀치기 4.',radius:5,targets:2,damage:.6,push:4},
  {id:'aegis',name:'수호',description:'균형 파괴 중 첫 마무리: 최대 체력 12% 보호막을 5초간 얻습니다. 중첩되지 않습니다.',shield:.12,duration:5},
  {id:'flow',name:'순환',description:'균형 파괴 중 첫 마무리: 남은 시간이 가장 긴 일반 스킬 1개의 대기시간을 2초 줄입니다. 궁극기·각성 제외.',seconds:2},
];

// 마을 교관 기술은 기존 스킬의 전투 변형이다. 실제 타격은 skills.js가
// 이 레지스트리의 skillId/variant를 읽어 적용하고, 스탯만 바꾸는 상품은 두지 않는다.
export const TOWN_COMBAT_ARTS = Object.freeze([
  { skillId: 'shield_bash', variant: 'aftershock', verb: '추가 충격파' },
  { skillId: 'quake', variant: 'aftershock', verb: '추가 충격파' },
  { skillId: 'fireball', variant: 'split', verb: '분열 투사체' },
  { skillId: 'poison_bomb', variant: 'wide', verb: '확장 독무' },
  { skillId: 'ranger_volley', variant: 'extra', verb: '추가 화살' },
  { skillId: 'judgment', variant: 'pull', verb: '시전 전 진공' },
  { skillId: 'whirlwind', variant: 'wide', verb: '확장 범위' },
  { skillId: 'chain', variant: 'bind', verb: '상태이상 강화' },
  { skillId: 'flurry', variant: 'echo', verb: '추가 타격' },
  { skillId: 'ranger_binding', variant: 'root', verb: '속박 강화' },
  { skillId: 'holy_slash', variant: 'nova', verb: '추가 참격' },
  { skillId: 'bloodquake', variant: 'echo', verb: '추가 붕괴' },
  { skillId: 'blizzard', variant: 'wide', verb: '확장 결계' },
  { skillId: 'night_parade', variant: 'wide', verb: '확장 흡인' },
  { skillId: 'ranger_pierce', variant: 'star', verb: '판정 강화' },
]);
