import { ALL_DUNGEONS, ARENA_RIVALS } from '../data/expansion.js';
import { FIELD_DUNGEONS } from '../data/open-fields.js';
import { EXPEDITION_ROUTES as ROUTES } from '../data/expedition-routes.js';
import { ENEMIES } from '../data/stages.js';
import { Floor } from './world.js';
import { expeditionDepth, depthStage } from '../data/expedition-depths.js';
import { conquestForRun } from '../data/expedition-conquests.js';
import { frontierFromSnapshot, frontierEffectForStage } from '../data/seasonal-content.js';
import { gardenMasteryForStage, gardenMasteryDiagonals } from '../data/garden-mastery.js';
const DUNGEONS = Object.freeze([...ALL_DUNGEONS, ...ROUTES.filter(route => !ALL_DUNGEONS.some(dungeon => dungeon.id === route.id))]);

export const EXPEDITION_LAYOUTS = {
  // 필드와 컨셉 던전(world 레인)은 카탈로그 항목이 레이아웃을 직접 가진다.
  ...Object.fromEntries([...FIELD_DUNGEONS, ...ALL_DUNGEONS.filter(d => d.layout)].map(d => [d.id, d.layout])),
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
Object.assign(EXPEDITION_LAYOUTS, {
  rootbound_grotto: { spacing: [30, 28], size: [22, 20], width: 7, cells: [[0,0],[1,0],[1,1],[2,1],[2,0],[3,0],[4,0]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','treasure','normal','elite','treasure','boss'] },
  hollowbell_arboretum: { spacing: [28, 30], size: [20, 22], width: 7, cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[3,0],[4,0]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','treasure','normal','elite','treasure','boss'] },
  slagwater_foundry: { spacing: [34, 25], size: [24, 17], width: 8, cells: [[0,0],[1,0],[2,0],[2,1],[3,1],[4,1],[5,1]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','elite','treasure','normal','elite','boss'] },
  emberwake_drydock: { spacing: [32, 24], size: [22, 18], width: 8, cells: [[0,0],[1,0],[1,1],[2,1],[3,1],[3,0],[4,0]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','treasure','normal','elite','treasure','boss'] },
  aurora_icewell: { spacing: [27, 32], size: [18, 22], width: 7, cells: [[0,0],[0,1],[1,1],[1,2],[2,2],[2,1],[3,1]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','treasure','normal','elite','treasure','boss'] },
  crownfall_glacier: { spacing: [31, 27], size: [22, 18], width: 7, cells: [[0,0],[1,0],[1,-1],[2,-1],[3,-1],[3,0],[4,0]], edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]], types: ['start','normal','elite','normal','treasure','elite','boss'] },
});
// Keep fallback advice on the same contract as the published route card.
const TACTICS = Object.fromEntries(ROUTES.map(d => [d.id, d.tactic]));
const BELLFALL_SUPPORT_CASTING = ROUTES.find(dungeon => dungeon.id === 'bellfall_crypt').supportCasting;
const DUELS = {
  rookie: { enemyId: 'garden_captain', pattern: ['slam','spin'], behavior: 'shield', hp: 6500, tactic: '푸른 가드 때 공격을 멈추고 강타 뒤 반격하세요. 강한 타격 4회로 방패를 깰 수 있습니다.' },
  duelist: { enemyId: 'garden_captain', pattern: ['dash','spin','dash'], dodge: 0.22, hp: 8500, tactic: '회피하는 결투사의 돌진을 옆으로 피하세요. 회전이 끝나는 순간이 빈틈입니다.' },
  champion: { enemyId: 'frost_captain', pattern: ['fan','soulrain','slam'], dodge: 0.08, hp: 10500, tactic: '탄막과 낙하 원을 피해 접근하세요. 체력이 줄면 공격 순서가 바뀝니다.' },
  thunder_lancer: { enemyId: 'tide_captain', pattern: ['dash','tide_sweep','slam'], dodge: 0.14, hp: 12000, tactic: '번개 창의 직선 경고를 옆으로 피하고 돌진이 끝난 뒤 반격하세요.' },
  sunwarden: { enemyId: 'forge_captain', pattern: ['kiln_vents','slam','spin'], behavior: 'shield', hp: 13800, tactic: '빛의 고리 바깥에서 과열선을 피한 뒤 방패가 열린 순간에 집중하세요.' },
  void_oracle: { enemyId: 'frost_captain', pattern: ['archive_retrace','fan','archive_hourglass'], dodge: 0.16, hp: 15800, tactic: '보랏빛 파편이 멈춘 자리만 밟고, 되감긴 기록 경로로 돌아가지 마세요.' },
};

/** 종락 기본 개인 원정만 기존 주술사의 지원을 읽고 끊을 수 있게 한다. */
export function supportCastingForStage(stage) {
  const expedition = stage?.expedition;
  if (stage?.party || stage?.riftId || expedition?.riftId || expedition?.conquestId ||
      expedition?.kind !== 'dungeon' || expedition.id !== 'bellfall_crypt' || expedition.depth !== 'standard') return null;
  return BELLFALL_SUPPORT_CASTING;
}

/** Accept IDs only: caller-provided scale, rewards and encounter data cannot replace the catalog.
 * @param {string} kind @param {string} id @param {object|null} eco
 * @param {{depth?: string, conquestId?: string|null, frontier?: object|null}} [options]
 */
export function buildExpeditionStage(kind, id, eco, { depth = 'standard', conquestId = null, frontier = null } = {}) {
  const catalog = kind === 'dungeon' ? DUNGEONS : kind === 'arena' ? ARENA_RIVALS : null;
  const def = catalog?.find(d => d.id === id);
  if (!def) throw new RangeError('알 수 없는 탐험입니다.');
  if (!['standard', 'deep'].includes(depth) || (depth === 'deep' && kind !== 'dungeon')) throw new RangeError('알 수 없는 원정 난이도입니다.');
  const deep = depth === 'deep' ? expeditionDepth(id) : null;
  if (depth === 'deep' && !deep) throw new RangeError('이 필드는 기본 원정만 지원합니다.');
  const conquest = conquestForRun(id, depth, conquestId);
  if (conquestId !== null && (!conquest || kind !== 'dungeon')) throw new RangeError('알 수 없는 전술 공략입니다.');
  const base = deep ? depthStage(id) : def.stage;
  const duel = kind === 'arena' ? DUELS[id] : null;
  const enemyId = duel?.enemyId || deep?.bossEnemy || def.bossEnemy || base.encounter.enemyId;
  const candidateFrontier = frontierFromSnapshot(frontier);
  const activeFrontier = kind === 'dungeon' && depth === 'standard' && candidateFrontier?.routeId === id ? candidateFrontier : null;
  const enemy = { ...ENEMIES[enemyId], ...(duel || {}), name: deep?.bossName || def.bossName || (kind === 'arena' ? `${def.name} · AI` : `${def.name} 수호자`) };
  if (!deep) enemy.summon = undefined;
  if (duel) enemy.portrait = def.portrait;
  if (!duel) enemy.hp = deep?.bossHp || def.bossHp || (id === 'ember_vault' ? 10500 : id === 'star_archive' ? 11500 : 8500);
  if (activeFrontier?.effects.kind === 'bossStatMultiplier') enemy.hp = Math.floor(enemy.hp * activeFrontier.effects.value);
  const stage = { ...base, boss: true, finale: false, story: null, ...(activeFrontier ? { frontier: activeFrontier } : {}), expedition: { kind, id, depth, ...(def.rosterMode ? { rosterMode: def.rosterMode } : {}), ...(conquest ? { conquestId } : {}),
    mechanics: deep?.mechanics || { attunement: id === 'glass_garden' || id === 'bellfall_crypt', reinforcements: id === 'ember_vault' || id === 'cinder_tide_lock' ? 2 : 0 } },
    theme: def.theme, ...(def.field ? { field: def.field } : {}),
    code: deep?.name || def.name, name: deep?.name || def.name, title: conquest ? `${deep.name} · ${conquest.name}` : deep?.name || def.name,
    objective: conquest?.objective || deep?.objective || (duel ? `AI 모의 결투 · 150초 제한 · ${duel.tactic}` : def.objective || TACTICS[id]),
    encounter: { ...base.encounter, enemyId, name: enemy.name, label: deep ? 'DEEP EXPEDITION' : kind === 'arena' ? 'AI DUEL' : 'DUNGEON BOSS', tactic: deep ? deep.tactic || base.encounter.tactic : duel?.tactic || def.tactic || TACTICS[id] },
    expeditionEnemy: enemy,
  };
  if (def.roster) stage.rosterFor = () => def.roster;
  const mastery = gardenMasteryForStage(stage);
  // AI arena uses the matching atmosphere with the already-loaded original rigs.
  if (id === 'champion') stage.chapter = { ...base.chapter, theme: 'frost' };
  return { ...stage, ...(mastery ? { encounterVersion: mastery.version } : {}) };
}

export function buildExpeditionWorld(stage) {
  const { kind, id, depth } = stage.expedition;
  const layout = depth === 'deep' ? expeditionDepth(id)?.layout : EXPEDITION_LAYOUTS[kind === 'arena' ? 'arena' : id];
  if (!layout) throw new RangeError('탐험 동선이 없습니다.');
  const seed = [...(id + (depth === 'deep' ? ':deep' : ''))].reduce((n, c) => n * 31 + c.charCodeAt(0), 17) >>> 0;
  const world = new Floor(stage.idx, stage.theme || stage.chapter.theme, seed, layout);
  world.expeditionRouteId = id;
  world.expeditionDepth = depth;
  if (kind === 'dungeon' && id === 'glass_garden' && depth === 'standard' &&
      !stage.party && !stage.riftId && !stage.expedition.riftId && !stage.expedition.conquestId) {
    // 기존 방·봉인·난수 진행을 만든 뒤 보물방과 장치방 사이의 실제 순환만 연다.
    const treasure = world.rooms[2], tactics = world.rooms[3];
    world.corridors.push(...world.lShape(treasure, tactics));
    treasure.links.push(tactics.id); tactics.links.push(treasure.id);
    world.linkPending.push([[treasure.gx, treasure.gy], [tactics.gx, tactics.gy]]);
    world.buildMask();
    const mastery = gardenMasteryForStage(stage);
    if (mastery) {
      tactics.label = mastery.label;
      tactics.gardenMastery = Object.freeze({ version: mastery.version, approachRoomIds: mastery.approachRoomIds,
        diagonals: gardenMasteryDiagonals(tactics) });
    }
  }
  return world;
}

/**
 * 무리 졸개: 원정 방 무리를 두껍게 하는 작고 약한 근접 잡몹(같은 종, 0.8배 크기, 이름 뒤 '졸개').
 * 실제 체력·AI·피해로 싸우고 방 정화 조건에 들어간다. 처치하면 궁극기·MP·연속 처치·세트 발동 같은
 * 전투 자원은 채우지만 장비·골드·경험치·도감·의뢰 처치 수와 전술/경로 목표 명단에는 들어가지 않는다.
 * 방 보상 예산은 기존 명단과 방 정화 보상 그대로다.
 */
export const PACK_FOLLOWER = Object.freeze({ hp: .5, atk: .65, scale: .8, min: 3, max: 7 });

/** 졸개 정의는 원래 종 정의를 복사해 크기·체력·공격과 표시 이름만 바꾼다. */
export function packFollowerDef(def) {
  if (!def) return def;
  return { ...def, name: `${def.name} 졸개`, hp: def.hp * PACK_FOLLOWER.hp, atk: def.atk * PACK_FOLLOWER.atk,
    scale: def.scale * PACK_FOLLOWER.scale, exp: 0, gold: 0, elite: false, boss: false, packFollower: true };
}

/** 원정 개인 던전의 일반·정예·보물방에만 붙인다. 파티·전술 공략·균열·투기장·보스방은 기존 명단 그대로다. */
export function expeditionFollowers(stage, room, rosterLength) {
  const expedition = stage?.expedition;
  if (!expedition || expedition.kind !== 'dungeon' || stage.party || stage.riftId || expedition.riftId || expedition.conquestId) return [];
  if (!room || !['normal', 'elite', 'treasure'].includes(room.type) || !(rosterLength > 0)) return [];
  const R = stage.rosterFor?.(room.type);
  const pool = (R?.trash || []).filter(id => { const def = ENEMIES[id]; return def && !def.ranged && !def.elite && !def.boss && def.behavior !== 'shaman'; });
  if (!pool.length) return [];
  const share = room.type === 'elite' ? .7 : room.type === 'treasure' ? .6 : .85;
  const n = Math.max(PACK_FOLLOWER.min, Math.min(PACK_FOLLOWER.max, Math.round(rosterLength * share)));
  const list = [];
  for (let i = 0; i < n; i++) list.push(pool[(i + room.id) % pool.length]);
  return list;
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
  if (id === 'glass_garden') {
    const roster = room.type === 'treasure' ? [R.trash[0],R.trash[2],R.ranged[0]] : [R.trash[0],R.trash[1],R.trash[2],R.trash[0],R.ranged[0],R.trash[4]];
    const mastery = gardenMasteryForStage(stage);
    // 다른 다섯 자리의 생성 순서를 지키고 중복 잡몹 한 자리만 기존 분쇄형으로 바꾼다.
    if (mastery && room.id === mastery.roomId && room.type === 'normal') roster[mastery.replacementSlot] = mastery.replacementEnemyId;
    return roster;
  }
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
    const effect = frontierEffectForStage(game.stage);
    const healMultiplier = effect?.kind === 'potionHealMultiplier' ? effect.value : 1;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * .35 * healMultiplier));
  } else if (id === 'overdrive') {
    if ((p.tonicAtkT || 0) > 0) return false;
    p.tonicAtkT = 12;
  } else if (id === 'aegis') {
    if ((p.tonicGuardT || 0) > 0) return false;
    p.tonicGuardT = 12;
  } else return false;
  return true;
}
