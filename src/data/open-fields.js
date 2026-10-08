import { stageDef } from './stages.js';

// 야외 원정도 기존 입장권·충돌·구역 정화·보스 봉인·정산 경로를 공유한다.
const make = (id, field, name, theme, chapter, material, description, layout) => {
  const base = stageDef(chapter, 1);
  const objective = '모든 전투 구역 정화 → 봉인 해제 → 지역 수호자 처치';
  return { id, field, name, theme, minLevel: 1, energy: 4, subtitle: 'OPEN FIELD · ' + name,
    art: `/img/fields/${field}-v1.webp`, accent: { meadow: '#99d47d', coast: '#70d5e9', mountain: '#bbd3ef', city: '#eac18a' }[field],
    description, objective, tactic: description + ' ' + objective, layout, rosterMode: 'field',
    bossEnemy: base.encounter.enemyId, bossHp: 8500, bossName: name + ' 수호자',
    stage: { ...base, chapter: { ...base.chapter, theme }, theme, code: id, name, title: name,
      energy: 4, scale: 1, recPower: 2600, objective, story: null, dungeon: null },
    rewards: { gold: 360, xp: 100, materials: { [material]: 3 }, consumables: { hp_tonic: 1 } },
  };
};
const layout = (field, spacing, size, width, cells, edges, labels) => ({ field, spacing, size, width, cells, edges,
  types: cells.map((_, i) => i === 0 ? 'start' : i === cells.length - 1 ? 'boss' : i === 3 ? 'treasure' : i === 4 ? 'elite' : 'normal'), labels });

export const FIELD_DUNGEONS = [
  make('windmeadow', 'meadow', '바람결 초원', 'garden', 1, 'glass_leaf', '넓은 들판의 두 샛길을 돌아 적을 모은 뒤 회전베기와 강타로 돌파하세요.',
    layout('meadow', [44,40], [36,32], 18, [[0,0],[1,0],[1,1],[0,1],[2,1],[3,1]],
      [[0,1],[1,2],[2,3],[3,0],[2,4],[4,5]], ['초원 야영지','바람 언덕','꽃의 갈림길','잃어버린 보급품','돌무리 전장','고목의 공터'])),
  make('sunbreak_coast', 'coast', '해오름 해안', 'tide', 4, 'glass_leaf', '파도가 닿는 모래섬과 넓은 나무다리를 따라 전진하세요. 물결 예고선의 빈틈으로 무리를 유인하세요.',
    layout('coast', [36,34], [28,24], 12, [[0,0],[1,0],[1,1],[2,1],[3,1],[3,2]],
      [[0,1],[1,2],[2,3],[3,4],[4,5]], ['해안 나루','부서진 닻','산호 모래톱','밀려온 화물','등대 앞마당','귀항의 등대'])),
  make('skywind_pass', 'mountain', '하늘바람 산길', 'frost', 3, 'star_dust', '바위 능선의 굽은 길을 오르세요. 좁은 고개로 적을 모으고 넓은 정상에서 강타의 빈틈을 찾으세요.',
    layout('mountain', [34,34], [24,24], 10, [[0,0],[1,0],[1,1],[0,1],[0,2],[1,2],[2,2]],
      [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], ['등산로 입구','솔바람 능선','바위 고개','산악 보급소','메아리 협곡','정상 직전','구름 위 정상'])),
  make('dawnward_city', 'city', '새벽항 도시', 'crown', 5, 'ember_core', '광장과 두 시장길을 오가며 적을 유인하세요. 건물 사이의 위험 예고를 피해 중앙 광장으로 돌파하세요.',
    layout('city', [38,38], [28,28], 12, [[0,0],[1,0],[0,1],[1,1],[2,1],[3,1]],
      [[0,1],[0,2],[1,3],[2,3],[3,4],[4,5]], ['서문 광장','북쪽 시장길','남쪽 시장길','상인의 창고','종탑 대로','왕립 분수 광장'])),
];
