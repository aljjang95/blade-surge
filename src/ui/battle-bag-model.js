// 인게임 가방 시트의 순수 모델. DOM·렌더와 분리해 테스트한다.
// 전투 중에는 보기 전용이며, 저장 스키마를 바꾸지 않는다(NEW 기준은 전투 시작 시점의 invSeq).
import { ITEM_BY_ID, RARITY_INFO, rarityRank } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { VAULT_OWNER } from '../game/gear-vault.js';
import { compareLoot } from './loot-compare.js';

const fmt = (n) => Number(n).toLocaleString('ko-KR');
const MAX_ROWS = 60;

/** 현재 착용과 비교한 한 줄. 판매가는 전투 중 의미가 없어 전투력 변화만 쓴다. */
export function bagCompareLine(cmp) {
  if (!cmp) return '';
  if (cmp.verdict === 'equipped') return '착용 중';
  if (cmp.verdict === 'better') return '▲ 전투력 +' + fmt(cmp.powerDelta);
  if (cmp.verdict === 'worse') return '▼ 전투력 ' + fmt(cmp.powerDelta);
  if (cmp.verdict === 'same') return '= 전투력 같음';
  return '';
}

/** 전투 시작 이후 들어온 장비 수와 그중 다른 영웅 장비 수. 배지용이라 목록을 만들지 않는다. */
export function bagCounts(eco, invSeqAtStart, heroId) {
  const inv = eco?.s?.inventory;
  if (!Array.isArray(inv) || !Number.isInteger(invSeqAtStart)) return { fresh: 0, foreign: 0 };
  let fresh = 0, foreign = 0;
  for (const inst of inv) {
    if (!(inst.uid >= invSeqAtStart) || !ITEM_BY_ID[inst.id] || inst.owner === VAULT_OWNER) continue;
    fresh++;
    if ((inst.owner ?? eco.s.selected) !== heroId) foreign++;
  }
  return { fresh, foreign };
}

function row(eco, heroId, inst, invSeqAtStart, worn) {
  const def = ITEM_BY_ID[inst.id], ownerId = inst.owner ?? eco.s.selected, foreign = ownerId !== heroId;
  const equipped = !foreign && worn.has(inst.uid);
  const cmp = foreign ? null : equipped ? { verdict: 'equipped', powerDelta: 0, sell: 0 } : compareLoot(eco, heroId, inst.uid);
  return {
    uid: inst.uid, inst, def, enh: inst.enh || 0, rarity: def.rarity, rarityName: RARITY_INFO[def.rarity]?.name || '', color: RARITY_INFO[def.rarity]?.color || '#ccc',
    ownerId, foreign, ownerName: foreign ? (HEROES[ownerId]?.name || '다른 영웅') : '', isNew: Number.isInteger(invSeqAtStart) && inst.uid >= invSeqAtStart,
    equipped, cmp, line: foreign ? '' : bagCompareLine(cmp),
  };
}

/**
 * @param {any} eco
 * @param {{ invSeqAtStart?: number, heroId: string, limit?: number }} opt
 * @returns {{ heroId: string, run: any[], runTotal: number, all: any[], allTotal: number, fresh: number, foreign: number }}
 */
export function bagModel(eco, { invSeqAtStart, heroId, limit = MAX_ROWS }) {
  const inv = (eco?.s?.inventory || []).filter((x) => ITEM_BY_ID[x.id] && x.owner !== VAULT_OWNER);
  const worn = new Set(Object.values(eco?.s?.heroes?.[heroId]?.equip || {}).filter((u) => u !== null && u !== undefined));
  const runSrc = Number.isInteger(invSeqAtStart) ? inv.filter((x) => x.uid >= invSeqAtStart).sort((a, b) => b.uid - a.uid) : [];
  const allSrc = inv.filter((x) => (x.owner ?? eco.s.selected) === heroId)
    .sort((a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0) || b.uid - a.uid);
  const run = runSrc.slice(0, limit).map((x) => row(eco, heroId, x, invSeqAtStart, worn));
  const all = allSrc.slice(0, limit).map((x) => row(eco, heroId, x, invSeqAtStart, worn));
  return { heroId, run, runTotal: runSrc.length, all, allTotal: allSrc.length, fresh: runSrc.length, foreign: runSrc.filter((x) => (x.owner ?? eco.s.selected) !== heroId).length };
}
