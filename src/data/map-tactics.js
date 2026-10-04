// 첫 기본 원정의 선택형 환경 제어. 보상·봉인·필수 정화 조건과 분리한다.
export const GARDEN_MAP_TACTICS = Object.freeze({
  id: 'garden_plinths_standard', roomId: 3,
  operatorRadius: 1.4, effectRadius: 6,
  windupSeconds: .35, gatherSeconds: .6,
  gatherForce: 30, releaseForce: 14,
  options: Object.freeze([
    Object.freeze({ id: 'gather', label: '집결', side: -1 }),
    Object.freeze({ id: 'release', label: '방출', side: 1 }),
  ]),
});

export function mapTacticsForStage(stage) {
  const expedition = stage?.expedition;
  if (stage?.party || stage?.riftId || expedition?.riftId || expedition?.conquestId ||
      expedition?.kind !== 'dungeon' || expedition.depth !== 'standard' || expedition.id !== 'glass_garden') return null;
  return GARDEN_MAP_TACTICS;
}
