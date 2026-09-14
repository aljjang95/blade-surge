import { DUNGEONS, ARENA_RIVALS } from '../data/expansion.js';
import { ENEMIES } from '../data/stages.js';
import { Floor } from './world.js';
import { expeditionDepth, depthStage } from '../data/expedition-depths.js';
import { conquestForRun } from '../data/expedition-conquests.js';

export const EXPEDITION_LAYOUTS = {
  glass_garden: { spacing: [30, 30], size: [20, 20], width: 6, cells: [[0,0],[1,0],[1,-1],[2,0],[3,0]], edges: [[0,1],[1,2],[1,3],[3,4]], types: ['start','normal','treasure','normal','boss'] },
  ember_vault: { spacing: [34, 26], size: [24, 16], width: 8, cells: [[0,0],[1,0],[2,0]], edges: [[0,1],[1,2]], types: ['start','elite','boss'] },
  star_archive: { spacing: [28, 34], size: [16, 24], width: 6, cells: [[0,0],[0,1],[1,1],[1,2]], edges: [[0,1],[1,2],[2,3]], types: ['start','normal','elite','boss'] },
  bellfall_crypt: { spacing: [28, 30], size: [18, 18], width: 7, cells: [[0,0],[1,0],[1,-1],[1,1],[2,-1],[2,1],[3,0],[4,0]], edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]], types: ['start','normal','treasure','normal','elite','treasure','normal','boss'] },
  cinder_tide_lock: { spacing: [32, 24], size: [22, 16], width: 8, cells: [[0,0],[1,0],[2,0],[2,1],[3,1],[4,1],[4,0]], edges: [[0,1],[1,2],[2,3],[2,4],[3,4],[4,5],[5,6]], types: ['start','normal','elite','treasure','normal','elite','boss'] },
  nightglass_observatory: { spacing: [27, 32], size: [18, 22], width: 7, cells: [[0,0],[0,1],[-1,1],[1,1],[-1,2],[1,2],[0,2],[0,3]], edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]], types: ['start','normal','treasure','normal','elite','treasure','normal','boss'] },
  eclipse_hydra_vault: { spacing: [31, 29], size: [22, 20], width: 8, cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[2,1],[3,1],[4,1],[4,0]], edges: [[0,1],[1,2],[1,4],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]], types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
  ashforge_catacomb: { spacing: [34, 25], size: [24, 17], width: 8, cells: [[0,0],[1,0],[2,0],[2,1],[3,1],[3,0],[4,0],[5,0]], edges: [[0,1],[1,2],[2,3],[2,5],[3,4],[4,6],[5,6],[6,7]], types: ['start','normal','elite','normal','treasure','elite','treasure','boss'] },
  astral_leviathan_spire: { spacing: [28, 34], size: [18, 24], width: 7, cells: [[0,0],[0,1],[1,1],[1,2],[0,2],[-1,2],[-1,3],[0,3],[1,3]], edges: [[0,1],[1,2],[2,3],[1,4],[4,5],[5,6],[6,7],[7,8],[3,8]], types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
  verdigris_sanctum: { spacing: [30, 28], size: [20, 20], width: 7, cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[2,1],[3,1],[4,1],[5,1]], edges: [[0,1],[1,2],[1,4],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]], types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
  sable_mirage_basin: { spacing: [31, 27], size: [22, 18], width: 7, cells: [[0,0],[0,1],[1,1],[1,0],[2,0],[2,-1],[3,-1],[3,0],[4,0]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[2,6]], types: ['start','normal','elite','normal','treasure','elite','normal','treasure','boss'] },
  comet_bastion: { spacing: [29, 32], size: [20, 24], width: 7, cells: [[0,0],[1,0],[1,1],[2,1],[2,0],[3,0],[3,-1],[4,-1],[5,-1]], edges: [[0,1],[1,2],[1,3],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]], types: ['start','normal','treasure','normal','elite','normal','elite','treasure','boss'] },
  arena: { spacing: [32, 32], size: [24, 24], width: 8, cells: [[0,0],[1,0]], edges: [[0,1]], types: ['start','boss'] },
};
const TACTICS = {
  glass_garden: '정화 후 옆길 제단 중심에 2초 머물러 유리 잎을 회수하고 수호자를 처치하세요.',
  ember_vault: '좁은 제련로에서 두 차례 증원을 격파하고 과열 경고선을 피해 금고 수호자를 처치하세요.',
  star_archive: '긴 서가의 원거리 수호자를 먼저 격파하고 지연 폭발을 피해 기록관을 처치하세요.',
  bellfall_crypt: '종문이 켜진 순서를 기억해 반대쪽 안전 지대로 이동하세요. 마지막 공명 뒤에만 긴 반격 창이 열립니다.',
  cinder_tide_lock: '밸브가 번갈아 과열됩니다. 경고선 바깥에서 증원을 끊고 망치가 떨어진 뒤 중앙을 가로지르세요.',
  nightglass_observatory: '방금 지나온 세 자리가 역순으로 폭발합니다. 모래시계가 닫히기 전에 바깥 고리로 이동하세요.',
  eclipse_hydra_vault: '물결이 지나간 통로가 잠시 안전합니다. 세 머리가 동시에 들리면 중앙에서 벗어나세요.',
  ashforge_catacomb: '사슬이 끌리는 방향의 반대편으로 이동한 뒤 망치 충격파가 지나가면 냉각로를 활성화하세요.',
  astral_leviathan_spire: '모래시계가 가리킨 별자리만 밟고, 기록 파편이 모이면 외곽 고리로 빠져나오세요.',
  verdigris_sanctum: '뿌리 문양이 켜진 순서대로 제단을 밟고, 포자 폭발 전에 외곽 수로로 빠지세요.',
  sable_mirage_basin: '모래 발자국이 사라지는 쪽은 환영입니다. 보라색 모래시계가 멈춘 순간만 공격하세요.',
  comet_bastion: '푸른 궤도선 안쪽은 안전합니다. 유성 경고가 겹치면 중앙을 버리고 고리 바깥을 도세요.',
};
const DUELS = {
  rookie: { enemyId: 'garden_captain', pattern: ['slam','spin'], behavior: 'shield', hp: 6500, tactic: '푸른 가드 때 공격을 멈추고 강타 뒤 반격하세요. 강한 타격 4회로 방패를 깰 수 있습니다.' },
  duelist: { enemyId: 'garden_captain', pattern: ['dash','spin','dash'], dodge: 0.22, hp: 8500, tactic: '회피하는 결투사의 돌진을 옆으로 피하세요. 회전이 끝나는 순간이 빈틈입니다.' },
  champion: { enemyId: 'frost_captain', pattern: ['fan','soulrain','slam'], dodge: 0.08, hp: 10500, tactic: '탄막과 낙하 원을 피해 접근하세요. 체력이 줄면 공격 순서가 바뀝니다.' },
  thunder_lancer: { enemyId: 'tide_captain', pattern: ['dash','tide_sweep','slam'], dodge: 0.14, hp: 12000, tactic: '번개 창의 직선 경고를 옆으로 피하고 돌진이 끝난 뒤 반격하세요.' },
  sunwarden: { enemyId: 'forge_captain', pattern: ['kiln_vents','slam','spin'], behavior: 'shield', hp: 13800, tactic: '빛의 고리 바깥에서 과열선을 피한 뒤 방패가 열린 순간에 집중하세요.' },
  void_oracle: { enemyId: 'frost_captain', pattern: ['archive_retrace','fan','archive_hourglass'], dodge: 0.16, hp: 15800, tactic: '보랏빛 파편이 멈춘 자리만 밟고, 되감긴 기록 경로로 돌아가지 마세요.' },
};

/** Accept IDs only: caller-provided scale, rewards and encounter data cannot replace the catalog.
 * @param {string} kind @param {string} id @param {object|null} eco
 * @param {{depth?: string, conquestId?: string|null}} [options]
 */
export function buildExpeditionStage(kind, id, eco, { depth = 'standard', conquestId = null } = {}) {
  const catalog = kind === 'dungeon' ? DUNGEONS : kind === 'arena' ? ARENA_RIVALS : null;
  const def = catalog?.find(d => d.id === id);
  if (!def) throw new RangeError('알 수 없는 탐험입니다.');
  if (!['standard', 'deep'].includes(depth) || (depth === 'deep' && kind !== 'dungeon')) throw new RangeError('알 수 없는 원정 난이도입니다.');
  const deep = depth === 'deep' ? expeditionDepth(id) : null;
  const conquest = conquestForRun(id, depth, conquestId);
  if (conquestId !== null && (!conquest || kind !== 'dungeon')) throw new RangeError('알 수 없는 전술 공략입니다.');
  const base = deep ? depthStage(id) : def.stage;
  const duel = kind === 'arena' ? DUELS[id] : null;
  const enemyId = duel?.enemyId || deep?.bossEnemy || def.bossEnemy || base.encounter.enemyId;
  const enemy = { ...ENEMIES[enemyId], ...(duel || {}), name: deep?.bossName || def.bossName || (kind === 'arena' ? `${def.name} · AI` : `${def.name} 수호자`) };
  if (!deep) enemy.summon = undefined;
  if (duel) enemy.portrait = def.portrait;
  if (!duel) enemy.hp = deep?.bossHp || def.bossHp || (id === 'ember_vault' ? 10500 : id === 'star_archive' ? 11500 : 8500);
  const stage = { ...base, boss: true, finale: false, story: null, expedition: { kind, id, depth, ...(def.rosterMode ? { rosterMode: def.rosterMode } : {}), ...(conquest ? { conquestId } : {}),
    mechanics: deep?.mechanics || { attunement: id === 'glass_garden' || id === 'bellfall_crypt', reinforcements: id === 'ember_vault' || id === 'cinder_tide_lock' ? 2 : 0 } },
    theme: def.theme,
    code: deep?.name || def.name, name: deep?.name || def.name, title: conquest ? `${deep.name} · ${conquest.name}` : deep?.name || def.name,
    objective: conquest?.objective || deep?.objective || (duel ? `AI 모의 결투 · 150초 제한 · ${duel.tactic}` : def.objective || TACTICS[id]),
    encounter: { ...base.encounter, enemyId, name: enemy.name, label: deep ? 'DEEP EXPEDITION' : kind === 'arena' ? 'AI DUEL' : 'DUNGEON BOSS', tactic: deep ? deep.tactic || base.encounter.tactic : duel?.tactic || def.tactic || TACTICS[id] },
    expeditionEnemy: enemy,
  };
  if (def.roster) stage.rosterFor = () => def.roster;
  // AI arena uses the matching atmosphere with the already-loaded original rigs.
  if (id === 'champion') stage.chapter = { ...base.chapter, theme: 'frost' };
  return stage;
}

export function buildExpeditionWorld(stage) {
  const { kind, id, depth } = stage.expedition;
  const layout = depth === 'deep' ? expeditionDepth(id)?.layout : EXPEDITION_LAYOUTS[kind === 'arena' ? 'arena' : id];
  if (!layout) throw new RangeError('탐험 동선이 없습니다.');
  const seed = [...(id + (depth === 'deep' ? ':deep' : ''))].reduce((n, c) => n * 31 + c.charCodeAt(0), 17) >>> 0;
  return new Floor(stage.idx, stage.theme || stage.chapter.theme, seed, layout);
}

export function expeditionRoster(stage, room) {
  if (room.type === 'start') return [];
  if (room.type === 'boss') return [stage.encounter.enemyId];
  const R = stage.rosterFor(room.type), id = stage.expedition.id;
  if (stage.expedition.depth === 'deep') {
    const conquest = conquestForRun(id, 'deep', stage.expedition.conquestId);
    if (conquest?.kind === 'priority' && room.type === 'elite') return conquest.priority === 'first'
      ? [R.ranged[0], R.elite[0], R.trash[0], R.trash[2], R.trash[5]]
      : [R.elite[0], R.ranged[0], R.trash[0], R.trash[2], R.trash[5]];
    if (room.type === 'treasure') return [R.trash[1],R.trash[4],R.ranged[0],R.ranged[1]];
    if (room.type === 'elite') return [R.elite[0],R.trash[0],R.trash[2],R.trash[5],R.ranged[0]];
    return id === 'star_archive'
      ? [R.trash[1],R.trash[4],R.trash[5],R.ranged[0],R.ranged[1],R.ranged[2]]
      : [R.trash[0],R.trash[1],R.trash[2],R.trash[4],R.trash[5],R.ranged[0],R.ranged[1]];
  }
  if (stage.expedition.rosterMode) {
    if (room.type === 'treasure') return [R.trash[0], R.trash[2], R.ranged[0], R.trash[4]];
    if (room.type === 'elite') return [R.elite[0], R.trash[0], R.trash[2], R.trash[5], R.ranged[0]];
    return [R.trash[0], R.trash[1], R.trash[2], R.trash[3], R.ranged[0], R.ranged[1], R.elite[0]];
  }
  if (id === 'glass_garden') return room.type === 'treasure' ? [R.trash[0],R.trash[2],R.ranged[0]] : [R.trash[0],R.trash[1],R.trash[2],R.trash[0],R.ranged[0],R.trash[4]];
  if (id === 'ember_vault') return [R.elite[0],R.trash[0],R.trash[1],R.trash[3],R.ranged[0],R.trash[4]];
  return [R.ranged[0],R.ranged[1],R.ranged[2],R.trash[1],R.trash[5],...(room.type === 'elite' ? [R.elite[0]] : [])];
}

export function canApplyBattleConsumable(game, id) {
  const p = game.player;
  if (!game.active || game.paused || !p?.alive || game.bossDefeated) return false;
  if (id === 'hp_tonic') return p.hp < p.maxHp;
  if (id === 'overdrive') return !(p.tonicAtkT > 0);
  if (id === 'aegis') return !(p.tonicGuardT > 0);
  return false;
}

export function applyBattleConsumable(game, id) {
  if (!canApplyBattleConsumable(game, id)) return false;
  const p = game.player;
  if (id === 'hp_tonic') {
    if (p.hp >= p.maxHp) return false;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * .35));
  } else if (id === 'overdrive') {
    if ((p.tonicAtkT || 0) > 0) return false;
    p.tonicAtkT = 12;
  } else if (id === 'aegis') {
    if ((p.tonicGuardT || 0) > 0) return false;
    p.tonicGuardT = 12;
  } else return false;
  return true;
}
