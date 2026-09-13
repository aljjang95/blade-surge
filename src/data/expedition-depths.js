import { stageDef } from './stages.js';

// Authored follow-up expeditions. The base material runs keep their original
// price and rewards; these routes unlock at explicit campaign milestones.
export const EXPEDITION_DEPTHS = [
  {
    id: 'glass_garden', depth: 'deep', name: '유리정원 · 종의 뿌리', unlockCode: '2-10', minLevel: 1,
    energy: 6, chapter: 1, stage: 5, scale: 7.5, bossHp: 16000,
    description: '용광로를 멈춘 뒤에도 정원 아래 남은 명령이 종을 울립니다. 두 갈래 봉인 제단을 정화하고 뿌리의 감시자를 해방하세요.',
    objective: '두 갈래 제단에서 각각 2초간 공명 → 뿌리의 감시자 처치',
    bossName: '종의 뿌리를 지키는 자', art: '/img/expansion/glass_garden.webp',
    layout: { spacing: [36,36], size: [20,20], width: 6,
      cells: [[0,0],[1,0],[1,-1],[1,1],[2,-1],[2,1],[2,0],[3,0]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]],
      types: ['start','normal','treasure','treasure','normal','elite','normal','boss'] },
    mechanics: { attunement: true, reinforcements: 0 },
    rewards: { gold: 1400, xp: 300, materials: { glass_leaf: 6 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1000, materials: { glass_leaf: 3 } },
  },
  {
    id: 'ember_vault', depth: 'deep', name: '잿불금고 · 침몰한 운반선', unlockCode: '4-10', minLevel: 2,
    energy: 6, chapter: 4, stage: 5, scale: 14, bossHp: 20000,
    description: '해왕의 사슬 아래 가라앉은 운반선에 빼앗긴 불씨가 남아 있습니다. 밀물 사이의 화물칸을 돌파하고 압류관의 명령을 끊으세요.',
    objective: '화물칸 두 곳의 증원 격파 → 밀물을 피하며 선단 압류관 처치',
    bossName: '가라앉은 선단의 압류관', art: '/img/expansion/ember_vault.webp',
    layout: { spacing: [36,36], size: [22,20], width: 7,
      cells: [[0,0],[1,0],[1,1],[2,0],[2,1],[3,1]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,4],[4,5]],
      types: ['start','normal','elite','elite','normal','boss'] },
    mechanics: { attunement: false, reinforcements: 1 },
    rewards: { gold: 2200, xp: 450, materials: { ember_core: 8 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1800, materials: { ember_core: 3 } },
  },
  {
    id: 'star_archive', depth: 'deep', name: '별빛서고 · 귀환의 관측소', unlockCode: '6-10', minLevel: 3,
    energy: 6, chapter: 6, stage: 10, scale: 22, bossHp: 24000,
    description: '귀환로가 이어진 밤, 관측소에서 아직 돌아오지 못한 이들의 이름이 발견됩니다. 기록의 좌표를 복원해 마지막 길잡이를 깨우세요.',
    objective: '기록 제단 두 곳 복원 → 교차 회랑 정화 → 귀환의 길잡이 처치',
    bossName: '남겨진 이름의 길잡이', art: '/img/expansion/star_archive.webp',
    layout: { spacing: [36,36], size: [20,20], width: 6,
      cells: [[0,0],[0,1],[-1,1],[1,1],[-1,2],[1,2],[0,2],[0,3]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]],
      types: ['start','normal','treasure','treasure','elite','normal','normal','boss'] },
    mechanics: { attunement: true, reinforcements: 0 },
    rewards: { gold: 3200, xp: 600, materials: { star_dust: 10 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 2600, materials: { star_dust: 3 } },
  },
];

export const expeditionDepth = id => EXPEDITION_DEPTHS.find(d => d.id === id);
export const campaignFinished = progress => Number(progress?.stars?.['6-10']) > 0;
export function depthStage(id) {
  const def = expeditionDepth(id);
  if (!def) throw new RangeError('알 수 없는 심층 원정입니다.');
  return { ...stageDef(def.chapter, def.stage), scale: def.scale, energy: def.energy,
    recPower: Math.floor(2600 * def.scale), dungeon: null, epilogueFinale: false };
}
