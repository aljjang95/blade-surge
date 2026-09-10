export const COMBAT_ARTS = [
  {id:'rupture',name:'파열',description:'균형 파괴 중 첫 마무리: 반경 5 안의 다른 적 최대 2명에게 공격력 60% 피해와 밀치기 4.',radius:5,targets:2,damage:.6,push:4},
  {id:'aegis',name:'수호',description:'균형 파괴 중 첫 마무리: 최대 체력 12% 보호막을 5초간 얻습니다. 중첩되지 않습니다.',shield:.12,duration:5},
  {id:'flow',name:'순환',description:'균형 파괴 중 첫 마무리: 남은 시간이 가장 긴 일반 스킬 1개의 대기시간을 2초 줄입니다. 궁극기·각성 제외.',seconds:2},
];
