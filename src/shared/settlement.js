// MMO P1-E: 런 정산 순수 함수 (docs/MMO_DESIGN.md 3.4.1 T1 개연성, 3.4.2 지급).
// 보상 수치는 클라이언트 입력이 아니라 서버 데이터(stageDef·lootTable)와 서버 lootSeed로 계산한다.
// 클라이언트가 바꿀 수 있는 사실은 처치 수·경과 시간·별 등뿐이며 T1 상한이 막는다.
import { stageDef, ENEMIES, STAGES_PER_CHAPTER, CHAPTERS } from '../data/stages.js';
import { applyDifficulty, resolveDifficulty, tormentTierOf } from '../game/difficulty.js';
import { lootTable, dropItemLevel } from '../data/loot-tables.js';
import { recordGearDex } from '../game/gear-dex.js';
import { validItemLevel } from '../data/item-tier.js';
import { HEROES, heroStats } from '../data/heroes.js';
import { monsterXp } from '../game/rpg-core.js';
import { seededStream } from './rng.js';
import { rollKillLoot, sumLoot } from './loot-roll.js';
import PLAUSIBILITY from '../data/plausibility-table.json';
import { ecoClock, isChapterOpen } from '../data/chapter-open.js';

export const RULES_VERSION = 'p1-1';
export const KILL_RANKS = Object.freeze(['normal', 'elite', 'boss']);
export const SETTLE_FIELDS = Object.freeze(['win', 'elapsedMs', 'kills', 'summonedKills', 'roomsCleared', 'hpLost', 'revives',
  'consumables', 'damageDealt', 'inputDigest', 'stars', 'fullClear']);
export const PLAUSIBILITY_TABLE = PLAUSIBILITY;

/** '1-1' → { ch, st }. 범위 밖이면 null. */
export function parseStageCode(code) {
  const m = typeof code === 'string' ? code.match(/^(\d{1,2})-(\d{1,2})$/) : null;
  if (!m) return null;
  const ch = Number(m[1]), st = Number(m[2]);
  return ch >= 1 && ch <= CHAPTERS.length && st >= 1 && st <= STAGES_PER_CHAPTER ? { ch, st } : null;
}

/** 출격과 같은 규칙으로 난이도를 해석한 스테이지 스냅샷. */
export function campaignStage(save, code, difficulty) {
  const at = parseStageCode(code);
  if (!at) return null;
  return applyDifficulty(stageDef(at.ch, at.st), resolveDifficulty(save, at.ch, at.st, difficulty));
}
/**
 * 계급별 대표 골드·경험치. 실제 적 정의가 아니라 스테이지 명단의 평균이라 서버와 클라이언트가 같은 값을 쓴다.
 * 시드 드랍 모드(서버 티켓이 있는 판)에서만 쓰며 연습 모드의 기존 처치 드랍은 바뀌지 않는다.
 */
export function stageRankValues(stage) {
  const R = stage.rosterFor();
  const avg = (ids, key) => { const vals = ids.map((id) => Number(ENEMIES[id]?.[key]) || 0).filter((v) => v > 0); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1; };
  const bossId = stage.encounter?.enemyId;
  const boss = ENEMIES[stage.dungeonBossId] || ENEMIES[bossId] || {};
  const normalIds = [...R.trash, ...R.ranged], eliteIds = [...R.elite];
  const make = (gold, exp) => ({ gold: Math.max(1, Math.round(gold)), exp: monsterXp({ exp }, stage.scale, false) });
  return {
    normal: make(avg(normalIds, 'gold'), avg(normalIds, 'exp')),
    elite: make(avg(eliteIds, 'gold'), avg(eliteIds, 'exp')),
    boss: make(Number(boss.gold) || 10, Number(boss.exp) || 100),
  };
}

/** 처치 하나의 드랍. stream은 계급(+':s' 소환체), killIndex는 그 stream의 순번(0부터). */
export function killDrops(stage, lootSeed, rank, killIndex, { summoned = false, values = stageRankValues(stage) } = {}) {
  const table = lootTable(stage.ch, rank, stage.difficultyId || 'story');
  const rng = seededStream(lootSeed, summoned ? rank + ':s' : rank, killIndex);
  return rollKillLoot(table, rng, { baseGold: values[rank].gold, scale: stage.scale, summoned, rank, itemLevel: dropItemLevel(stage) });
}

/** 스테이지·난이도별 T1 상한. 표에 없는 값은 보수 기본값을 쓴다. */
export function plausibilityFor(stage) {
  const key = `${stage.code}:${stage.difficultyId || 'story'}`;
  const row = PLAUSIBILITY.stages?.[key] || {};
  const d = PLAUSIBILITY.defaults;
  // 방 수는 맵 배치의 성질이라 난이도와 무관하다(difficulty.js 는 방을 건드리지 않는다). 난이도 행이 아직 없으면 같은 관문의 story 행 방 수를 쓴다 —
  // 그렇지 않으면 보정된 장도 기본값 17방(기준 13방)으로 폴백해 완전 정화가 나올 수 없다. 처치·시간 상한은 난이도마다 달라 기본값 그대로 둔다.
  const layoutRooms = row.maxRooms ?? PLAUSIBILITY.stages?.[`${stage.code}:story`]?.maxRooms;
  return {
    minClearMs: row.minClearMs ?? d.minClearMs,
    kills: { normal: row.kills?.normal ?? d.kills.normal, elite: row.kills?.elite ?? d.kills.elite, boss: row.kills?.boss ?? d.kills.boss },
    summonedKills: row.summonedKills ?? d.summonedKills,
    maxRooms: layoutRooms ?? d.maxRooms,
    dpsPerAtk: PLAUSIBILITY.dpsPerAtk, damageSlack: PLAUSIBILITY.damageSlack,
    maxRevives: PLAUSIBILITY.maxRevives, wallClockSlack: PLAUSIBILITY.wallClockSlack,
  };
}

/**
 * 서버가 계산하는 별·풀클리어. facts.stars·fullClear는 호환을 위해 형식만 검사하고 값은 절대 쓰지 않는다.
 * 클라이언트 전투(battle-base.victory)와 같은 문턱을 쓰되, 서버가 아는 사실만으로 보수적으로 판단한다:
 *  - 체력 비율 = 1 - hpLost / maxHp (hpLost는 승리 시점의 잃은 체력, 부활이 있으면 별은 1개)
 *  - 탐색 비율 = roomsCleared / 기준 방 수. 방 배치는 클라이언트가 만들어 서버가 총 방 수를 모르므로, 개연성 표의
 *    스테이지별 최대 방 수(관측 최대 + 4)에서 4를 뺀 값을 기준으로 삼는다.
 * 기준을 못 채우면 1별·fullClear=false다. 위조 {stars:3, fullClear:true}는 이 계산을 지나야 보상이 된다.
 */
export function referenceRooms(stage) { return Math.max(1, plausibilityFor(stage).maxRooms - 4); }
export function serverRating(stage, facts, maxHp) {
  const rooms = Math.max(0, facts.roomsCleared ?? 0), ref = referenceRooms(stage);
  const explored = Math.min(1, rooms / ref), hpRatio = 1 - Math.min(1, Math.max(0, facts.hpLost ?? 0) / Math.max(1, maxHp));
  const stars = (facts.revives ?? 0) > 0 ? 1 : (hpRatio > 0.6 && explored > 0.8) ? 3 : (hpRatio > 0.3 || explored > 0.6) ? 2 : 1;
  const fullClear = !!facts.win && rooms >= Math.ceil(ref * 0.9);
  return { stars, fullClear, hpRatio, explored };
}

const finiteInt = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;

/** 정산 입력 형식 검사. 음수·NaN·소수·알 수 없는 필드는 여기서 걸린다. */
export function validateFacts(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return 'schema';
  for (const k of Object.keys(facts)) if (!SETTLE_FIELDS.includes(k)) return 'unknown-field';
  if (typeof facts.win !== 'boolean') return 'win';
  if (!finiteInt(facts.elapsedMs, 6 * 3600 * 1000)) return 'elapsed';
  if (!facts.kills || typeof facts.kills !== 'object' || Array.isArray(facts.kills)) return 'kills';
  for (const k of Object.keys(facts.kills)) if (!KILL_RANKS.includes(k)) return 'kills';
  for (const k of KILL_RANKS) if (!finiteInt(facts.kills[k] ?? 0, 100000)) return 'kills';
  if (facts.summonedKills !== undefined) {
    if (!facts.summonedKills || typeof facts.summonedKills !== 'object' || Array.isArray(facts.summonedKills)) return 'kills';
    for (const k of Object.keys(facts.summonedKills)) if (!KILL_RANKS.includes(k) || !finiteInt(facts.summonedKills[k], 100000)) return 'kills';
  }
  if (!finiteInt(facts.roomsCleared ?? 0, 1000)) return 'rooms';
  if (!finiteInt(facts.hpLost ?? 0, 1e12)) return 'hp';
  if (!finiteInt(facts.revives ?? 0, 1000)) return 'revives';
  if (!finiteInt(facts.damageDealt ?? 0, 1e15)) return 'damage';
  if (facts.consumables !== undefined && (typeof facts.consumables !== 'object' || facts.consumables === null || Array.isArray(facts.consumables)
    || Object.values(facts.consumables).some((n) => !finiteInt(n, 1000)))) return 'consumables';
  if (facts.inputDigest !== undefined && (typeof facts.inputDigest !== 'string' || !/^[A-Za-z0-9_-]{0,128}$/.test(facts.inputDigest))) return 'digest';
  if (facts.stars !== undefined && !(Number.isInteger(facts.stars) && facts.stars >= 1 && facts.stars <= 3)) return 'stars';
  if (facts.fullClear !== undefined && typeof facts.fullClear !== 'boolean') return 'fullClear';
  return null;
}

/**
 * T1 개연성 검사. 위반이 하나라도 있으면 'rejected'(지급 0), 피해 상한만 소폭(20% 이내) 넘으면 'soft'(보상 50%).
 * @param {{ heroAtk: number, maxHp: number, wallMs: number }} ctx 서버가 본 영웅 공격력·최대 체력, 서버 시계 경과
 */
export function plausibility(stage, facts, ctx) {
  const p = plausibilityFor(stage), issues = [];
  const kills = (k) => facts.kills[k] ?? 0, summoned = (k) => facts.summonedKills?.[k] ?? 0;
  if (ctx.wallMs < p.minClearMs && facts.win) issues.push('too-fast-wall');
  if (facts.elapsedMs < p.minClearMs && facts.win) issues.push('too-fast');
  if (facts.elapsedMs > ctx.wallMs * p.wallClockSlack + 5000) issues.push('elapsed-exceeds-wall');
  for (const k of KILL_RANKS) if (kills(k) > p.kills[k]) issues.push('kills-' + k);
  if (KILL_RANKS.reduce((a, k) => a + summoned(k), 0) > p.summonedKills) issues.push('kills-summoned');
  if ((facts.roomsCleared ?? 0) > p.maxRooms) issues.push('rooms');
  if ((facts.revives ?? 0) > p.maxRevives) issues.push('revives');
  if ((facts.hpLost ?? 0) > ctx.maxHp * ((facts.revives ?? 0) + 1) * 1.05 + 1) issues.push('hp-lost');
  if (Object.values(facts.consumables || {}).some((n) => n > 0)) issues.push('consumables');
  if (facts.win && kills('boss') < 1) issues.push('no-boss');
  const damageCap = Math.max(1, ctx.heroAtk) * p.dpsPerAtk * Math.max(1, facts.elapsedMs) / 1000;
  const damage = facts.damageDealt ?? 0;
  let soft = false;
  if (damage > damageCap * (1 + p.damageSlack)) issues.push('damage');
  else if (damage > damageCap) soft = true;
  return { verdict: issues.length ? 'rejected' : soft ? 'soft' : 'ok', issues };
}

/** 장비 하나를 Economy.addItem과 같은 형태로 인벤토리에 넣는다. owner = 그 판을 뛴 영웅(docs/GEAR_OWNERSHIP_VAULT.md). */
export function grantLootItem(eco, item, tp = 0, owner = eco.s.selected) {
  // il(스테이지 장비 레벨)은 killDrops 가 굴림 결과에 실어 주는 값이다. 고통 단계 장비(tp)에는 붙이지 않는다.
  const il = tp > 0 ? 0 : validItemLevel(item.il);
  const inst = { uid: eco.s.invSeq++, id: item.id, enh: 0, ...(tp > 0 ? { tp } : {}), ...(il ? { il } : {}), owner: eco.s.heroes?.[owner] ? owner : eco.s.selected };
  eco.s.inventory.push(inst);
  recordGearDex(eco.s, 'drop', inst.owner, inst.id);   // pushItem 과 같은 등재 지점(직접 얻은 드랍)
  return inst;
}

/** 보고된 처치 수(상한 내)만큼 시드 드랍을 재생성해 합친다. */
export function rollRunLoot(stage, lootSeed, facts) {
  const values = stageRankValues(stage), sum = sumLoot([]);
  let combatExp = 0;
  for (const rank of KILL_RANKS) {
    for (let k = 0; k < (facts.kills[rank] ?? 0); k++) { sumLoot(killDrops(stage, lootSeed, rank, k, { values }), sum); combatExp += values[rank].exp; }
    for (let k = 0; k < (facts.summonedKills?.[rank] ?? 0); k++) sumLoot(killDrops(stage, lootSeed, rank, k, { summoned: true, values }), sum);
  }
  return { ...sum, combatExp };
}

/** 서버 시점 영웅 전투력 요약(티켓 hero_hash와 T1 상한 기준). */
export function heroCombatProfile(eco, heroId) {
  const def = HEROES[heroId], hero = eco.hero(heroId);
  if (!def || !hero) return null;
  const stats = heroStats(def, hero, eco.heroEquipBonus(heroId));
  return { atk: Math.max(1, Math.floor(stats.atk || 1)), maxHp: Math.max(1, Math.floor(stats.hp || 1)), level: hero.level };
}

/**
 * 판정이 끝난 정산을 EconomyCore에 적용한다. 반환값이 영수증의 got/loot다.
 * verdict 'soft'는 골드·재료 수량을 절반으로 줄인다(첫 클리어 보석·경험치·장비는 그대로).
 */
export function applySettlement(eco, stage, ticket, facts, verdict) {
  if (verdict === 'rejected') return { got: [], loot: [], ups: 0, first: false, exp: 0, combatExp: 0 };
  // 아직 열리지 않은 지역의 판은 보상 없이 거부한다(서버는 요청 시각, 클라이언트는 신뢰 시계로 같은 함수를 쓴다).
  if (!isChapterOpen(stage.ch, ecoClock(eco))) return { got: [], loot: [], ups: 0, first: false, exp: 0, combatExp: 0, closed: true };
  const heroId = ticket.heroId;
  const loot = rollRunLoot(stage, ticket.lootSeed, facts);
  const half = (n) => verdict === 'soft' ? Math.floor(n / 2) : n;
  if (!facts.win) {
    // 패배: 기존처럼 전투 중 처치 경험치만 남는다(필드 재화는 정산되지 않는다).
    const ups = eco.addHeroExp(heroId, loot.combatExp, { silent: true });
    return { got: [], loot: [], ups, first: false, exp: 0, combatExp: loot.combatExp, win: false };
  }
  // 정산 난수(풀클리어 장비·더블·보스 소환권)도 lootSeed 고정 stream을 쓴다.
  const previousRng = eco.rng;
  eco.rng = seededStream(ticket.lootSeed, 'stage', 0);
  try {
    const ledger = eco.beginFieldRewards(stage, heroId);
    if (ledger) {
      ledger.exp = loot.combatExp;
      ledger.heroShards = half(loot.heroShards); ledger.transcendStones = half(loot.transcendStones);
      for (const [id, n] of Object.entries(loot.materials)) ledger.materials[id] = half(n);
    }
    const tormentTp = tormentTierOf(stage.difficultyId), items = loot.items.map((item) => grantLootItem(eco, item, tormentTp, heroId));
    const rating = serverRating(stage, facts, heroCombatProfile(eco, heroId)?.maxHp ?? 1);
    const receipt = eco.completeStage(stage, rating.stars, {
      fieldGold: half(loot.gold), fieldStones: half(loot.stones), fieldStones2: half(loot.stones2), fieldStones3: half(loot.stones3),
      fieldFragments: half(loot.fragments), fieldLoot: items, fullClear: rating.fullClear,
      // 클리어 카드(docs/CLEAR_LOOP.md)는 의심 판정(soft)·방을 하나도 깨지 않은 보고에는 주지 않는다(보안 리뷰: 가짜 승리로 카드 보상을 키우지 않게).
      clearCards: verdict !== 'soft' && (facts.roomsCleared | 0) > 0,
    });
    return { got: receipt.got, loot: receipt.loot, ups: receipt.ups, first: receipt.first, exp: receipt.exp, combatExp: receipt.combatExp, passUps: receipt.passUps, win: true, stars: rating.stars, fullClear: rating.fullClear };
  } finally { eco.rng = previousRng; }
}
