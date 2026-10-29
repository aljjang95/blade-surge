// 서버 처치 원장(docs/SERVER_AUTHORITY_GATES.md). 서버 정산이 개연성 검사를 통과한 처치 수와 종을 누적한다.
// slain = { seeded, kills: { [enemyId]: n } }. 서버 권위 계정은 서버 값이 정본이고, 로컬 전용 저장은 같은 형태를 기기에서 쓴다.
import { ENEMIES, stageDef, chapterSpeciesId, CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';

export const SLAIN_MAX = 1_000_000_000;
/** 정산 한 판이 보고할 수 있는 종 수 상한(형식 검사). */
export const SPECIES_PER_RUN = 64;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const known = (id) => typeof id === 'string' && !BLOCKED.has(id) && Object.hasOwn(ENEMIES, id);
const count = (v) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, SLAIN_MAX) : 0);

/** 저장 정규화. 알 수 없는 종·0 이하는 버린다. seeded 가 없으면 도입 전 저장(false). */
export function normalizeSlain(raw, { seeded = false } = {}) {
  const kills = {};
  const src = record(raw) && record(raw.kills) ? raw.kills : {};
  for (const id of Object.keys(src).sort()) if (known(id) && count(src[id])) kills[id] = count(src[id]);
  return { seeded: record(raw) && typeof raw.seeded === 'boolean' ? raw.seeded : seeded, kills };
}

/** 저장의 slain 을 정규화된 객체로 보장한다(변경 경로 전용). */
export function slainOf(save) {
  if (!record(save.slain) || !record(save.slain.kills) || typeof save.slain.seeded !== 'boolean') save.slain = normalizeSlain(save.slain);
  return save.slain;
}

/** 처치 기록. 알 수 없는 종은 무시한다. */
export function recordSlain(save, id, n = 1) {
  if (!known(id) || !count(n)) return false;
  const slain = slainOf(save);
  slain.kills[id] = Math.min(SLAIN_MAX, (slain.kills[id] || 0) + count(n));
  return true;
}

/** 1마리 이상 처치한 종 수(도감 보상 stat 'species'). */
export function slainSpecies(save) {
  const kills = record(save?.slain) && record(save.slain.kills) ? save.slain.kills : {};
  let n = 0;
  for (const id of Object.keys(kills)) if (known(id) && count(kills[id])) n++;
  return n;
}

const poolCache = new Map();
/**
 * 한 관문에서 처치될 수 있는 종(서버 상한 검사용). 전투 명단·보상 명단·관문 보스·던전 보스 + 각 종의 소환 종,
 * 그리고 장 전용 몸 id(chapterSpeciesId)까지. 난이도는 편성을 바꾸지 않으므로 관문 번호로 캐시한다.
 */
export function stageSpeciesPool(stage) {
  const key = stage?.code;
  if (key && poolCache.has(key)) return poolCache.get(key);
  const raw = new Set();
  const add = (id) => { if (typeof id === 'string') raw.add(id); };
  const roster = (R) => { if (R) for (const k of ['trash', 'ranged', 'elite']) for (const id of R[k] || []) add(id); };
  roster(stage?.combatRosterFor?.()); roster(stage?.rosterFor?.());
  for (const w of stage?.waves || []) for (const id of w) add(id);
  add(stage?.encounter?.enemyId); add(stage?.dungeonBossId); add(stage?.encounter?.dungeonBossId);
  // 소환 종은 장 전용 몸으로 바뀐 뒤 다시 소환할 수 있으므로(예: 1-8 기록 대장 → 밤유리 서기관 → 서리 거울) 더 늘지 않을 때까지 펼친다.
  const pool = new Set(), queue = [...raw];
  while (queue.length) {
    const id = queue.pop();
    // 전투 생성은 항상 장 전용 몸으로 바꾼 id(battle-base spawnEnemy → chapterSpeciesId)라 바뀐 id 만 풀에 넣는다(원본 id 위조 차단, 교차 리뷰).
    for (const x of [chapterSpeciesId(stage, id)]) {
      if (!known(x) || pool.has(x)) continue;
      pool.add(x);
      if (typeof ENEMIES[x].summon === 'string') queue.push(ENEMIES[x].summon);
    }
  }
  const frozen = Object.freeze(pool);
  if (key) poolCache.set(key, frozen);
  return frozen;
}

/** 1번 관문부터 floor 번 관문(들어갈 수 있는 마지막 관문 = progress.unlocked)까지의 종 풀 합집합(가져오기 상한 검사). */
export function poolUpToFloor(floor) {
  const out = new Set();
  const last = Number.isSafeInteger(floor) ? Math.max(0, Math.min(CHAPTERS.length * STAGES_PER_CHAPTER, floor)) : 0;
  for (let f = 1; f <= last; f++) {
    const ch = Math.ceil(f / STAGES_PER_CHAPTER), st = f - (ch - 1) * STAGES_PER_CHAPTER;
    for (const id of stageSpeciesPool(stageDef(ch, st))) out.add(id);
  }
  return out;
}

/**
 * 정산 사실의 species 를 관문 풀과 처치 합으로 자른다. id 정렬 순서로 total 을 넘지 않게 채운다.
 * @returns {{ species: Record<string, number>, dropped: number }}
 */
export function clampSpecies(species, pool, total, { boss = Infinity, elite = Infinity } = {}) {
  const out = {};
  let left = Number.isSafeInteger(total) && total > 0 ? total : 0, dropped = 0;
  // 계급 상한: 보스 종은 보스 처치 수까지, 정예 종은 정예 처치 수까지(정예 접사로 일반 종이 정예가 될 수는 있어도 그 반대는 없다).
  const rankLeft = { boss: Math.max(0, boss), elite: Math.max(0, elite) };
  if (!record(species)) return { species: out, dropped };
  for (const id of Object.keys(species).sort()) {
    const n = count(species[id]);
    if (!n) continue;
    if (!known(id) || !pool.has(id)) { dropped += n; continue; }
    const rank = ENEMIES[id].boss ? 'boss' : ENEMIES[id].elite ? 'elite' : null;
    const take = Math.min(n, left, rank ? rankLeft[rank] : Infinity);
    if (rank) rankLeft[rank] -= take;
    dropped += n - take; left -= take;
    if (take) out[id] = take;
  }
  return { species: out, dropped };
}

/**
 * 가져오기·첫 스냅샷의 1회 병합: 기기 기록(slain.kills 와 rpg.bestiary 중 큰 값)을 진행 범위 종 풀과 처치 합 상한으로 자르고,
 * 서버가 이미 가진 값은 바닥값으로 둔다. 결과는 seeded: true.
 * @param {any} raw 기기 저장 원본 @param {{ server?: any, floor: number, killsCap: number }} opts
 */
export function trustedSlain(raw, { server, floor, killsCap }) {
  const sv = normalizeSlain(server);
  if (sv.seeded) return sv;
  const device = {};
  const fromSlain = record(raw?.slain) && record(raw.slain.kills) ? raw.slain.kills : {};
  const fromBestiary = record(raw?.rpg) && record(raw.rpg.bestiary) ? raw.rpg.bestiary : {};
  for (const id of new Set([...Object.keys(fromSlain), ...Object.keys(fromBestiary)])) {
    const n = Math.max(count(fromSlain[id]), count(record(fromBestiary[id]) ? fromBestiary[id].kills : 0));
    if (n) device[id] = n;
  }
  const { species } = clampSpecies(device, poolUpToFloor(floor), killsCap);
  const kills = { ...sv.kills };
  for (const [id, n] of Object.entries(species)) kills[id] = Math.max(kills[id] || 0, n);
  return normalizeSlain({ seeded: true, kills });
}

/**
 * 서버 정산 처치 원장 적용. 판정을 통과한 처치 수(계급별 + 소환)를 quests.kills 에, 종을 slain 에 더한다.
 * wallMs(서버 시계 경과)·minClearMs·killCap(관문 처치 상한 합)을 주면 경과 비율만큼만 인정한다.
 * @returns {{ kills: number, species: number, dropped: number }}
 */
export function applyKillLedger(save, stage, facts, { wallMs, minClearMs, killCap } = {}) {
  const ranks = ['normal', 'elite', 'boss'];
  let total = ranks.reduce((a, k) => a + (facts.kills?.[k] ?? 0) + (facts.summonedKills?.[k] ?? 0), 0);
  // 시간 근거: 개연성 검사의 최소 시간은 승리에만 걸린다. 그래서 원장은 서버 시계로 잰 경과(wallMs)가 최소 클리어 시간에 못 미치면
  // 그 비율만큼만 관문 처치 상한을 인정한다(티켓 직후 패배 정산으로 상한 처치를 찍는 위조 차단, Codex 보안 리뷰 PR #435).
  if (Number.isFinite(wallMs) && minClearMs > 0 && killCap > 0) total = Math.min(total, Math.floor(killCap * Math.min(1, Math.max(0, wallMs) / minClearMs)));
  if (record(save.quests)) save.quests.kills = Math.min(SLAIN_MAX, (Number.isSafeInteger(save.quests.kills) ? save.quests.kills : 0) + total);
  const rankCap = (k) => (facts.kills?.[k] ?? 0) + (facts.summonedKills?.[k] ?? 0);
  const { species, dropped } = clampSpecies(facts.species, stageSpeciesPool(stage), total, { boss: rankCap('boss'), elite: rankCap('elite') });
  for (const [id, n] of Object.entries(species)) recordSlain(save, id, n);
  return { kills: total, species: Object.keys(species).length, dropped };
}
