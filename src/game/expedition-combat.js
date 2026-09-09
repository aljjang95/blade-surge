import { DUNGEONS, ARENA_RIVALS } from '../data/expansion.js';
import { ENEMIES } from '../data/stages.js';
import { Floor } from './world.js';

export const EXPEDITION_LAYOUTS = {
  glass_garden: { spacing: [30, 30], size: [20, 20], width: 6, cells: [[0,0],[1,0],[1,-1],[2,0],[3,0]], edges: [[0,1],[1,2],[1,3],[3,4]], types: ['start','normal','treasure','normal','boss'] },
  ember_vault: { spacing: [34, 26], size: [24, 16], width: 8, cells: [[0,0],[1,0],[2,0]], edges: [[0,1],[1,2]], types: ['start','elite','boss'] },
  star_archive: { spacing: [28, 34], size: [16, 24], width: 6, cells: [[0,0],[0,1],[1,1],[1,2]], edges: [[0,1],[1,2],[2,3]], types: ['start','normal','elite','boss'] },
  arena: { spacing: [32, 32], size: [24, 24], width: 8, cells: [[0,0],[1,0]], edges: [[0,1]], types: ['start','boss'] },
};
const TACTICS = {
  glass_garden: '정화 후 옆길 제단 중심에 2초 머물러 유리 잎을 회수하고 수호자를 처치하세요.',
  ember_vault: '좁은 제련로에서 두 차례 증원을 격파하고 과열 경고선을 피해 금고 수호자를 처치하세요.',
  star_archive: '긴 서가의 원거리 수호자를 먼저 격파하고 지연 폭발을 피해 기록관을 처치하세요.',
};
const DUELS = {
  rookie: { enemyId: 'garden_captain', pattern: ['slam','spin'], behavior: 'shield', hp: 6500, tactic: '푸른 가드 때 공격을 멈추고 강타 뒤 반격하세요. 강한 타격 4회로 방패를 깰 수 있습니다.' },
  duelist: { enemyId: 'garden_captain', pattern: ['dash','spin','dash'], dodge: 0.22, hp: 8500, tactic: '회피하는 결투사의 돌진을 옆으로 피하세요. 회전이 끝나는 순간이 빈틈입니다.' },
  champion: { enemyId: 'frost_captain', pattern: ['fan','soulrain','slam'], dodge: 0.08, hp: 10500, tactic: '탄막과 낙하 원을 피해 접근하세요. 체력이 줄면 공격 순서가 바뀝니다.' },
};

/** Accept IDs only: caller-provided scale, rewards and encounter data cannot replace the catalog. */
export function buildExpeditionStage(kind, id, eco) {
  const catalog = kind === 'dungeon' ? DUNGEONS : kind === 'arena' ? ARENA_RIVALS : null;
  const def = catalog?.find(d => d.id === id);
  if (!def) throw new RangeError('알 수 없는 탐험입니다.');
  const base = def.stage;
  const duel = kind === 'arena' ? DUELS[id] : null;
  const enemyId = duel?.enemyId || base.encounter.enemyId;
  const enemy = { ...ENEMIES[enemyId], ...(duel || {}), name: kind === 'arena' ? `${def.name} · AI` : `${def.name} 수호자`, summon: undefined };
  if (!duel) enemy.hp = id === 'ember_vault' ? 10500 : id === 'star_archive' ? 11500 : 8500;
  const stage = { ...base, boss: true, finale: false, story: null, expedition: { kind, id },
    code: def.name, name: def.name, title: def.name,
    objective: duel ? `AI 모의 결투 · 150초 제한 · ${duel.tactic}` : TACTICS[id],
    encounter: { ...base.encounter, enemyId, name: enemy.name, label: kind === 'arena' ? 'AI DUEL' : 'DUNGEON BOSS', tactic: duel?.tactic || TACTICS[id] },
    expeditionEnemy: enemy,
  };
  // AI arena uses the matching atmosphere with the already-loaded original rigs.
  if (id === 'champion') stage.chapter = { ...base.chapter, theme: 'frost' };
  return stage;
}

export function buildExpeditionWorld(stage) {
  const { kind, id } = stage.expedition;
  const layout = EXPEDITION_LAYOUTS[kind === 'arena' ? 'arena' : id];
  if (!layout) throw new RangeError('탐험 동선이 없습니다.');
  const seed = [...id].reduce((n, c) => n * 31 + c.charCodeAt(0), 17) >>> 0;
  return new Floor(stage.idx, stage.chapter.theme, seed, layout);
}

export function expeditionRoster(stage, room) {
  if (room.type === 'start') return [];
  if (room.type === 'boss') return [stage.encounter.enemyId];
  const R = stage.rosterFor(room.type), id = stage.expedition.id;
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
