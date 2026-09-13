// Finite, authored follow-up goals. They reuse a region's deep run and cost;
// repeating one never repeats its first-success bonus.
export const EXPEDITION_CONQUESTS = [
  { id: 'garden_dawn', dungeonId: 'glass_garden', name: '첫 종의 방향', previous: null,
    kind: 'altars', order: [2, 3], target: 2, mark: '새벽의 공명',
    objective: 'A 제단 → B 제단 순서로 공명하고 수호자를 처치하세요.',
    detail: '미니맵의 A는 북쪽 제단, B는 남쪽 제단입니다. A를 먼저 울리면 수호자가 강타와 회전을 사용합니다.',
    firstRewards: { gold: 1600, materials: { glass_leaf: 4 } } },
  { id: 'garden_dusk', dungeonId: 'glass_garden', name: '마지막 종의 메아리', previous: 'garden_dawn',
    kind: 'altars', order: [3, 2], target: 2, mark: '황혼의 공명',
    objective: 'B 제단 → A 제단 순서로 공명하고 수호자를 처치하세요.',
    detail: 'B를 먼저 울리면 수호자가 소환과 낙하 공격을 사용합니다. 순서를 놓쳐도 원정을 마칠 수 있습니다.',
    firstRewards: { gold: 2000, materials: { glass_leaf: 5 } } },
  { id: 'vault_signal', dungeonId: 'ember_vault', name: '끊어진 신호', previous: null,
    kind: 'priority', priority: 'first', target: 2, mark: '침묵의 선단',
    objective: '두 화물칸에서 표식 신호수를 가장 먼저 처치하고 압류관을 쓰러뜨리세요.',
    detail: '신호수를 먼저 처치한 화물칸은 증원이 취소됩니다. 다른 적을 먼저 처치하면 그 방의 증원 1회가 유지됩니다.',
    firstRewards: { gold: 2400, materials: { ember_core: 4 } } },
  { id: 'vault_manifest', dungeonId: 'ember_vault', name: '운반책의 행선지', previous: 'vault_signal',
    kind: 'priority', priority: 'last', target: 2, mark: '되찾은 항로',
    objective: '두 화물칸에서 호위 4명을 먼저, 표식 운반책을 마지막에 처치하세요.',
    detail: '호위를 모두 처치한 뒤 운반책을 제압하면 증원이 취소됩니다. 광역기 범위를 조절하며 압류관까지 돌파하세요.',
    firstRewards: { gold: 2800, materials: { ember_core: 5 } } },
  { id: 'archive_break', dungeonId: 'star_archive', name: '명령의 균열', previous: null,
    kind: 'breaks', target: 2, mark: '끊어낸 명령',
    objective: '길잡이의 균형을 2회 붕괴시킨 뒤 처치하세요.',
    detail: '명중한 기본 공격과 스킬이 균형을 깎습니다. 연속 공격으로 회복할 틈을 주지 마세요.',
    firstRewards: { gold: 3200, materials: { star_dust: 4 } } },
  { id: 'archive_opening', dungeonId: 'star_archive', name: '돌아오는 이름', previous: 'archive_break',
    kind: 'openings', target: 3, mark: '귀환의 증인',
    objective: '길잡이의 균형 붕괴 중 직접 공격을 3회 명중하고 처치하세요.',
    detail: 'BREAK가 나타나는 짧은 틈에 기본 공격이나 스킬을 이어가세요. 지속 피해와 동행의 공격은 세지 않습니다.',
    firstRewards: { gold: 3600, materials: { star_dust: 5 } } },
];

export const expeditionConquest = id => EXPEDITION_CONQUESTS.find(c => c.id === id);
export function conquestForRun(dungeonId, depth, conquestId) {
  const def = expeditionConquest(conquestId);
  return depth === 'deep' && def?.dungeonId === dungeonId ? def : null;
}
