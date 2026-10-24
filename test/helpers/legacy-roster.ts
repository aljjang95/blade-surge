/** 이 정책 전의 저장처럼 다섯 영웅을 모두 소유한 상태(정책 1)로 만든다. 영웅 상태·재화는 건드리지 않는다. */
export function grandfather<T extends { s: any }>(eco: T): T {
  eco.s.roster = { policy: 1, owned: Object.keys(eco.s.heroes), starter: null, starterChosen: true, paid: [] };
  return eco;
}
